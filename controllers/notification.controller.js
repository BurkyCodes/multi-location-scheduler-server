import Notification from "../models/Notification.js";
import DeviceToken from "../models/DeviceToken.js";
import admin, { isFirebaseReady } from "../config/firebase.js";
import asyncHandler from "../utils/asyncHandler.js";
import { createCrudController } from "./crud.controller.js";

const notificationController = createCrudController(Notification, {
  populate: "user_id related_shift_id related_swap_request_id",
});

export const createNotification = notificationController.createOne;
export const getNotifications = notificationController.getAll;
export const getNotificationById = notificationController.getById;
export const updateNotification = notificationController.updateById;
export const deleteNotification = notificationController.deleteById;

const resolveOrgUserId = (req) => req.body.org_user_id || req.query.org_user_id || req.userOrgId;

export const registerDeviceToken = asyncHandler(async (req, res) => {
  const { garage_id, fcm_token, device_type, device_name } = req.body;
  const org_user_id = resolveOrgUserId(req);

  if (!org_user_id || !fcm_token) {
    return res.status(400).json({
      success: false,
      message: "org_user_id and fcm_token are required",
    });
  }

  const token = await DeviceToken.findOneAndUpdate(
    { fcm_token },
    {
      org_user_id,
      user_id: req.userId || undefined,
      garage_id,
      fcm_token,
      device_type: device_type || "web",
      device_name,
      is_active: true,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return res.status(200).json({
    success: true,
    message: "Device token registered successfully",
    data: token,
  });
});

export const unregisterDeviceToken = asyncHandler(async (req, res) => {
  const { fcm_token } = req.body;
  const org_user_id = resolveOrgUserId(req);

  if (!fcm_token) {
    return res.status(400).json({ success: false, message: "fcm_token is required" });
  }

  const filter = { fcm_token };
  if (org_user_id) filter.org_user_id = org_user_id;

  const token = await DeviceToken.findOneAndUpdate(filter, { is_active: false }, { new: true });

  if (!token) {
    return res.status(404).json({ success: false, message: "Device token not found" });
  }

  return res.status(200).json({
    success: true,
    message: "Device token unregistered successfully",
  });
});

export const sendNotification = asyncHandler(async (req, res) => {
  const {
    org_user_id: bodyOrgUserId,
    user_id,
    garage_id,
    title,
    message,
    category,
    priority = "normal",
    link,
    icon,
    data = {},
    channels = ["in-app"],
  } = req.body;

  const org_user_id = bodyOrgUserId || req.userOrgId;

  if (!org_user_id && !user_id) {
    return res.status(400).json({
      success: false,
      message: "org_user_id or user_id is required",
    });
  }

  if (!channels.length) {
    return res.status(400).json({ success: false, message: "channels[] is required" });
  }

  const results = {};

  if (channels.includes("in-app")) {
    const saved = await Notification.create({
      org_user_id,
      user_id,
      garage_id,
      title,
      message,
      type: "in-app",
      category,
      priority,
      link,
      icon,
      data,
      delivery_status: "sent",
      status: "unread",
    });

    results["in-app"] = { status: "sent", notification_id: saved._id };
  }

  if (channels.includes("push")) {
    if (!isFirebaseReady()) {
      results.push = { status: "skipped", reason: "Firebase not configured" };
    } else if (!org_user_id) {
      results.push = { status: "skipped", reason: "org_user_id is required for push" };
    } else {
      const rows = await DeviceToken.find({ org_user_id, is_active: true }).select("fcm_token");
      const tokens = rows.map((x) => x.fcm_token);

      if (!tokens.length) {
        results.push = { status: "skipped", reason: "No active device tokens" };
      } else {
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
            ...Object.fromEntries(
              Object.entries(data).map(([key, value]) => [key, String(value)])
            ),
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

        results.push = {
          status: "sent",
          success_count: response.successCount,
          failure_count: response.failureCount,
          total_devices: tokens.length,
        };
      }
    }
  }

  return res.status(202).json({
    success: true,
    message: "Notification processed",
    data: results,
  });
});

export const getUserNotifications = asyncHandler(async (req, res) => {
  const org_user_id = req.params.orgUserId || req.query.org_user_id || req.userOrgId;
  const { page = 1, limit = 20, status, category } = req.query;

  if (!org_user_id) {
    return res.status(400).json({ success: false, message: "org_user_id is required" });
  }

  const filter = {
    org_user_id,
    status: { $ne: "deleted" },
  };

  if (status) filter.status = status;
  if (category) filter.category = category;

  const pageNum = Number.parseInt(page, 10);
  const limitNum = Number.parseInt(limit, 10);
  const skip = (pageNum - 1) * limitNum;

  const [notifications, total] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
    Notification.countDocuments(filter),
  ]);

  return res.status(200).json({
    success: true,
    data: notifications,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

export const getUnreadCount = asyncHandler(async (req, res) => {
  const org_user_id = req.params.orgUserId || req.query.org_user_id || req.userOrgId;

  if (!org_user_id) {
    return res.status(400).json({ success: false, message: "org_user_id is required" });
  }

  const unread_count = await Notification.countDocuments({
    org_user_id,
    status: "unread",
  });

  return res.status(200).json({ success: true, unread_count });
});

export const markNotificationRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findByIdAndUpdate(
    req.params.id,
    { read_at: new Date(), status: "read" },
    { new: true }
  );

  if (!notification) {
    return res.status(404).json({ success: false, message: "Notification not found" });
  }

  return res.json({ success: true, data: notification });
});

export const markAllNotificationsRead = asyncHandler(async (req, res) => {
  const org_user_id = req.params.orgUserId || req.body.org_user_id || req.userOrgId;

  if (!org_user_id) {
    return res.status(400).json({ success: false, message: "org_user_id is required" });
  }

  const result = await Notification.updateMany(
    { org_user_id, status: "unread" },
    { $set: { status: "read", read_at: new Date() } }
  );

  return res.status(200).json({
    success: true,
    message: "All notifications marked as read",
    modified_count: result.modifiedCount,
  });
});

export const softDeleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findByIdAndUpdate(
    req.params.id,
    { status: "deleted" },
    { new: true }
  );

  if (!notification) {
    return res.status(404).json({ success: false, message: "Notification not found" });
  }

  return res.status(200).json({ success: true, message: "Notification deleted" });
});
