import UserRole from "../models/UserRole.js";
import { createCrudController } from "./crud.controller.js";

const userRoleController = createCrudController(UserRole, {
  populate: "user_id location_ids",
});

export const createUserRole = userRoleController.createOne;
export const getUserRoles = userRoleController.getAll;
export const getUserRoleById = userRoleController.getById;
export const updateUserRole = userRoleController.updateById;
export const deleteUserRole = userRoleController.deleteById;
