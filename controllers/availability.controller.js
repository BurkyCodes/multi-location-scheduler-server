import Availability from "../models/Availability.js";
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

export const upsertAvailability = asyncHandler(async (req, res) => {
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

  const before = await Availability.findOne({ user_id });
  const availability = await Availability.findOneAndUpdate(
    { user_id },
    req.body,
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );
  await logAuditChange({
    actor_user_id: req.userId,
    entity_type: "availability",
    action: before ? "update" : "create",
    before_state: before?.toObject ? before.toObject() : before,
    after_state: availability?.toObject ? availability.toObject() : availability,
  });

  return res.status(201).json({ success: true, data: availability });
});

export const getAvailabilityByUser = asyncHandler(async (req, res) => {
  const currentUser = await getCurrentUser(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }
  const allowed = await canAccessUser(currentUser, req.params.userId);
  if (!allowed) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  const availability = await Availability.findOne({ user_id: req.params.userId });

  if (!availability) {
    return res
      .status(404)
      .json({ success: false, message: "Availability not found for user" });
  }

  return res.json({ success: true, data: availability });
});

export const deleteAvailabilityByUser = asyncHandler(async (req, res) => {
  const currentUser = await getCurrentUser(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }
  const allowed = await canAccessUser(currentUser, req.params.userId);
  if (!allowed) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  const availability = await Availability.findOneAndDelete({
    user_id: req.params.userId,
  });

  if (!availability) {
    return res
      .status(404)
      .json({ success: false, message: "Availability not found for user" });
  }
  await logAuditChange({
    actor_user_id: req.userId,
    entity_type: "availability",
    action: "delete",
    before_state: availability?.toObject ? availability.toObject() : availability,
    after_state: null,
  });

  return res.json({ success: true, message: "Availability deleted" });
});
