import User from "../models/User.js";
import { createCrudController } from "./crud.controller.js";

const userController = createCrudController(User);

export const createUser = userController.createOne;
export const getUsers = userController.getAll;
export const getUserById = userController.getById;
export const updateUser = userController.updateById;
export const deleteUser = userController.deleteById;
