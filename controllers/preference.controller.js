import StaffPreference from "../models/StaffPreference.js";
import NotificationPreference from "../models/NotificationPreference.js";
import User from "../models/User.js";
import asyncHandler from "../utils/asyncHandler.js";
import { logAuditChange } from "../services/auditLog.service.js";

const getCurrentUser = async (userId) =>
  User.findById(userId).populate({ path: "role_id", select: "role" });

const canAccessUser = async (currentUser, targetUserId) => {
  if (!currentUser) return false;
  const role = currentUser.role_id?.role;
  if (role === "admin") return true;
  if (role === "staff") return String(currentUser._id) === String(targetUserId);
  if (role === "manager") {
    const target = await User.findById(targetUserId).select("location_ids");
    if (!target) return false;
    const managerLocations = new Set((currentUser.location_ids || []).map((id) => id.toString()));
    return (target.location_ids || []).some((id) => managerLocations.has(id.toString()));
  }
  return false;
};

const upsertByUser = (Model) =>
  asyncHandler(async (req, res) => {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ success: false, message: "user_id is required" });
    }
    const currentUser = await getCurrentUser(req.userId);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const allowed = await canAccessUser(currentUser, user_id);
    if (!allowed) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const before = await Model.findOne({ user_id });

    const doc = await Model.findOneAndUpdate({ user_id }, req.body, {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    });

    const entityType =
      Model.modelName === "notification_preferences"
        ? "notification_preference"
        : null;
    if (entityType) {
      await logAuditChange({
        actor_user_id: req.userId,
        entity_type: entityType,
        action: before ? "update" : "create",
        before_state: before?.toObject ? before.toObject() : before,
        after_state: doc?.toObject ? doc.toObject() : doc,
      });
    }

    return res.status(201).json({ success: true, data: doc });
  });

const getByUser = (Model) =>
  asyncHandler(async (req, res) => {
    const currentUser = await getCurrentUser(req.userId);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const allowed = await canAccessUser(currentUser, req.params.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const doc = await Model.findOne({ user_id: req.params.userId });

    if (!doc) {
      return res.status(404).json({ success: false, message: "Preference not found" });
    }

    return res.json({ success: true, data: doc });
  });

const normalizeNotificationPreferencePayload = (payload = {}, existing = null) => {
  const modeInput = String(
    payload.delivery_mode || payload.notification_mode || payload.mode || ""
  ).trim();

  let channels = {
    in_app:
      payload?.channels?.in_app ??
      payload?.in_app_enabled ??
      existing?.channels?.in_app ??
      true,
    email:
      payload?.channels?.email ??
      payload?.email_enabled ??
      existing?.channels?.email ??
      false,
  };

  if (modeInput === "in_app_plus_email") {
    channels = { in_app: true, email: true };
  } else if (modeInput === "in_app_only") {
    channels = { in_app: true, email: false };
  } else if (modeInput === "email_only") {
    channels = { in_app: false, email: true };
  } else if (modeInput === "none") {
    channels = { in_app: false, email: false };
  }

  const delivery_mode =
    channels.in_app && channels.email
      ? "in_app_plus_email"
      : channels.in_app
        ? "in_app_only"
        : channels.email
          ? "email_only"
          : "none";
  return {
    user_id: payload.user_id,
    channels,
    delivery_mode,
    events: payload.events || existing?.events,
  };
};

export const upsertStaffPreference = upsertByUser(StaffPreference);
export const getStaffPreferenceByUser = getByUser(StaffPreference);
export const upsertNotificationPreference = asyncHandler(async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) {
    return res.status(400).json({ success: false, message: "user_id is required" });
  }

  const currentUser = await getCurrentUser(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }
  const allowed = await canAccessUser(currentUser, user_id);
  if (!allowed) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  const before = await NotificationPreference.findOne({ user_id });
  const normalized = normalizeNotificationPreferencePayload(req.body, before);

  const doc = await NotificationPreference.findOneAndUpdate({ user_id }, normalized, {
    new: true,
    upsert: true,
    runValidators: true,
    setDefaultsOnInsert: true,
  });

  await logAuditChange({
    actor_user_id: req.userId,
    entity_type: "notification_preference",
    action: before ? "update" : "create",
    before_state: before?.toObject ? before.toObject() : before,
    after_state: doc?.toObject ? doc.toObject() : doc,
  });

  return res.status(201).json({ success: true, data: doc });
});

export const getNotificationPreferenceByUser = asyncHandler(async (req, res) => {
  const currentUser = await getCurrentUser(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }
  const allowed = await canAccessUser(currentUser, req.params.userId);
  if (!allowed) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  const doc = await NotificationPreference.findOne({ user_id: req.params.userId });
  if (!doc) {
    return res.json({
      success: true,
      data: {
        user_id: req.params.userId,
        channels: {
          in_app: true,
          email: false,
        },
        delivery_mode: "in_app_only",
      },
    });
  }

  return res.json({ success: true, data: doc });
});
