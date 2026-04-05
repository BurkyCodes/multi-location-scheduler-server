import User from "../models/User.js";
import UserRole from "../models/UserRole.js";
import asyncHandler from "../utils/asyncHandler.js";
import { createCrudController } from "./crud.controller.js";

const userPopulate = [
  {
    path: "role_id",
    select: "role",
  },
  {
    path: "location_ids",
    select: "name code timezone",
  },
];

const userController = createCrudController(User, {
  populate: userPopulate,
});

const validateLocationAssignmentForRole = (roleName, locationIds) => {
  if (roleName === "admin") {
    return null;
  }

  const count = Array.isArray(locationIds) ? locationIds.length : 0;
  if (roleName === "manager" && count < 1) {
    return "Managers must be assigned to at least one location";
  }

  if (roleName === "staff" && count !== 1) {
    return "Staff must be assigned to exactly one location";
  }

  return null;
};

export const createUser = asyncHandler(async (req, res) => {
  const { role_id, location_ids } = req.body;

  if (!role_id) {
    return res.status(400).json({
      success: false,
      message: "role_id is required when creating staff members",
    });
  }

  const role = await UserRole.findById(role_id).select("role");
  if (!role) {
    return res.status(404).json({ success: false, message: "Role not found" });
  }

  const locationValidationError = validateLocationAssignmentForRole(
    role.role,
    location_ids
  );
  if (locationValidationError) {
    return res.status(400).json({
      success: false,
      message: locationValidationError,
    });
  }

  const payload = {
    ...req.body,
    status: req.body.status || "active",
  };

  const created = await User.create(payload);
  const populated = await User.findById(created._id).populate(userPopulate);

  return res.status(201).json({ success: true, data: populated });
});

const getCurrentUserWithRole = async (userId) =>
  User.findById(userId).populate({ path: "role_id", select: "role" });

const hasSharedLocation = (a = [], b = []) => {
  const aSet = new Set(a.map((id) => id.toString()));
  return b.some((id) => aSet.has(id.toString()));
};

export const getUsers = asyncHandler(async (req, res) => {
  const currentUser = await getCurrentUserWithRole(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const role = currentUser.role_id?.role;
  const query = User.find();

  if (role === "manager") {
    const staffRole = await UserRole.findOne({ role: "staff" }).select("_id");
    if (!staffRole) {
      return res.json({ success: true, count: 0, data: [] });
    }

    query.where({
      role_id: staffRole._id,
      location_ids: { $in: currentUser.location_ids || [] },
    });
  } else if (role !== "admin") {
    query.where({ _id: currentUser._id });
  }

  query.populate(userPopulate).sort({ createdAt: -1 });
  const users = await query;

  return res.json({ success: true, count: users.length, data: users });
});

export const getUserById = asyncHandler(async (req, res) => {
  const currentUser = await getCurrentUserWithRole(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const targetUser = await User.findById(req.params.id).populate(userPopulate);
  if (!targetUser) {
    return res.status(404).json({ success: false, message: "Resource not found" });
  }

  const role = currentUser.role_id?.role;
  if (role === "admin") {
    return res.json({ success: true, data: targetUser });
  }

  if (role === "manager") {
    const targetRole = targetUser.role_id?.role;
    if (
      targetRole === "staff" &&
      hasSharedLocation(currentUser.location_ids || [], targetUser.location_ids || [])
    ) {
      return res.json({ success: true, data: targetUser });
    }

    return res.status(403).json({
      success: false,
      message: "Managers can only access staff from their assigned locations",
    });
  }

  if (targetUser._id.toString() !== currentUser._id.toString()) {
    return res.status(403).json({
      success: false,
      message: "You can only access your own user record",
    });
  }

  return res.json({ success: true, data: targetUser });
});

export const updateUser = asyncHandler(async (req, res) => {
  const existing = await User.findById(req.params.id).select("role_id location_ids");
  if (!existing) {
    return res.status(404).json({ success: false, message: "Resource not found" });
  }

  const nextRoleId = req.body.role_id || existing.role_id;
  const role = await UserRole.findById(nextRoleId).select("role");
  if (!role) {
    return res.status(404).json({ success: false, message: "Role not found" });
  }

  const nextLocationIds = Object.prototype.hasOwnProperty.call(req.body, "location_ids")
    ? req.body.location_ids
    : existing.location_ids;

  const locationValidationError = validateLocationAssignmentForRole(
    role.role,
    nextLocationIds
  );
  if (locationValidationError) {
    return res.status(400).json({
      success: false,
      message: locationValidationError,
    });
  }

  const updated = await User.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).populate(userPopulate);

  return res.json({ success: true, data: updated });
});
export const deleteUser = userController.deleteById;
