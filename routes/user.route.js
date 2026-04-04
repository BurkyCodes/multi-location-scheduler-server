import { Router } from "express";
import {
  createUser,
  deleteUser,
  getUserById,
  getUsers,
  updateUser,
} from "../controllers/user.controller.js";
import { checkAuthentication } from "../middlewares/auth.middleware.js";
import { requireAdmin } from "../middlewares/role.middleware.js";

const router = Router();

router.post("/", checkAuthentication, requireAdmin, createUser);
router.get("/", checkAuthentication, getUsers);
router.get("/:id", checkAuthentication, getUserById);
router.patch("/:id", checkAuthentication, updateUser);
router.delete("/:id", checkAuthentication, deleteUser);

export default router;
