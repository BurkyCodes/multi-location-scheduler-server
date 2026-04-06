import Notification from "../models/Notification.js";
import DeviceToken from "../models/DeviceToken.js";
import NotificationPreference from "../models/NotificationPreference.js";
import User from "../models/User.js";
import UserRole from "../models/UserRole.js";
import admin, { isFirebaseReady } from "../config/firebase.js";
import { publishRealtimeEventToUser } from "./realtimeEvents.service.js";
import { sendNotificationEmail } from "./email.service.js";

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._id) return value._id.toString();
  return value.toString();
};

const toSafeDataPayload = (data = {}) =>
  Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value ?? "")]));

const DEFAULT_CHANNELS = { in_app: true, email: false };
const resolveChannels = (preference) => {
  const inApp = preference?.channels?.in_app;
  const email = preference?.channels?.email;
  const safeInApp = typeof inApp === "boolean" ? inApp : DEFAULT_CHANNELS.in_app;
  const safeEmail = typeof email === "boolean" ? email : DEFAULT_CHANNELS.email;
  return { in_app: safeInApp, email: safeEmail };
};

export const sendUserNotification = async ({
  user_id,
  title,
  message,
  category,
  priority = "normal",
  link,
  icon,
  data = {},
  type = "in-app",
  idempotency_key = null,
}) => {
  const userId = toIdString(user_id);
  if (!userId) {
    return { status: "skipped", reason: "Missing user_id" };
  }

  const [user, preference] = await Promise.all([
    User.findById(userId).select("email name"),
    NotificationPreference.findOne({ user_id: userId }).select("channels"),
  ]);
  const channels = resolveChannels(preference);

  if (idempotency_key && channels.in_app) {
    const existing = await Notification.findOne({
      user_id: userId,
      idempotency_key,
      status: { $ne: "deleted" },
    });
    if (existing) {
      return {
        in_app: {
          status: "deduplicated",
          notification_id: existing._id,
        },
      };
    }
  }

  const result = {
    channels,
  };

  if (channels.in_app) {
    const notification = await Notification.create({
      org_user_id: userId,
      user_id,
      title,
      message,
      type,
      category,
      priority,
      link,
      icon,
      data,
      idempotency_key,
      delivery_status: "sent",
      status: "unread",
    });
    publishRealtimeEventToUser(userId, "notification_created", {
      notification_id: notification._id.toString(),
      category: notification.category || category || "",
      title: notification.title || title || "Notification",
      message: notification.message || message || "",
      createdAt: notification.createdAt,
    });
    result.in_app = { status: "sent", notification_id: notification._id };
  } else {
    result.in_app = { status: "skipped", reason: "Disabled by preference" };
  }

  if (channels.email) {
    result.email = await sendNotificationEmail({
      to: user?.email,
      title,
      message,
      link,
      data: { ...data, idempotency_key },
    });
  } else {
    result.email = { status: "skipped", reason: "Disabled by preference" };
  }

  if (!channels.in_app) {
    result.push = { status: "skipped", reason: "Disabled by preference" };
    return result;
  }

  if (!isFirebaseReady()) {
    result.push = { status: "skipped", reason: "Firebase not configured" };
    return result;
  }

  const tokenRows = await DeviceToken.find({
    org_user_id: userId,
    is_active: true,
  }).select("fcm_token");
  const tokens = tokenRows.map((item) => item.fcm_token);

  if (!tokens.length) {
    result.push = { status: "skipped", reason: "No active device tokens" };
    return result;
  }

  const response = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: {
      title: title || "Notification",
      body: message || "",
      ...(icon ? { imageUrl: icon } : {}),
    },
    data: {
      category: category || "",
      link: link || "",
      ...toSafeDataPayload(data),
    },
  });

  const staleTokens = [];
  response.responses.forEach((item, index) => {
    if (!item.success) {
      const code = item.error?.code;
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        staleTokens.push(tokens[index]);
      }
    }
  });

  if (staleTokens.length) {
    await DeviceToken.updateMany(
      { fcm_token: { $in: staleTokens } },
      { $set: { is_active: false } }
    );
  }

  result.push = {
    status: "sent",
    success_count: response.successCount,
    failure_count: response.failureCount,
    total_devices: tokens.length,
  };

  return result;
};

export const sendBulkNotifications = async (userIds = [], payload = {}) => {
  const uniqueUserIds = [...new Set(userIds.map(toIdString).filter(Boolean))];
  const results = await Promise.allSettled(
    uniqueUserIds.map((id) =>
      sendUserNotification({
        ...payload,
        user_id: id,
      })
    )
  );

  return {
    total: uniqueUserIds.length,
    sent: results.filter((item) => item.status === "fulfilled").length,
    failed: results.filter((item) => item.status === "rejected").length,
  };
};

export const getActiveUsersByRole = async (role) => {
  const roleDoc = await UserRole.findOne({ role }).select("_id");
  if (!roleDoc) return [];

  return User.find({
    role_id: roleDoc._id,
    status: "active",
    is_active: true,
  }).select("_id name location_ids");
};

export const getActiveManagersForLocation = async (locationId) => {
  const roleDoc = await UserRole.findOne({ role: "manager" }).select("_id");
  if (!roleDoc) return [];

  return User.find({
    role_id: roleDoc._id,
    status: "active",
    is_active: true,
    location_ids: locationId,
  }).select("_id name location_ids");
};
