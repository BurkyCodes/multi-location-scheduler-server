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

export const upsertStaffPreference = upsertByUser(StaffPreference);
export const getStaffPreferenceByUser = getByUser(StaffPreference);
export const upsertNotificationPreference = upsertByUser(NotificationPreference);
export const getNotificationPreferenceByUser = getByUser(NotificationPreference);
