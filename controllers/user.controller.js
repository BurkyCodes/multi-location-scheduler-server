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

export const createUser = asyncHandler(async (req, res) => {
  const { role_id } = req.body;

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

  if (role.role !== "staff") {
    return res.status(400).json({
      success: false,
      message: "This endpoint is for creating staff members only",
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

export const getUsers = userController.getAll;
export const getUserById = userController.getById;
export const updateUser = userController.updateById;
export const deleteUser = userController.deleteById;
