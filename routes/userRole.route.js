import { Router } from "express";
import {
  createUserRole,
  deleteUserRole,
  getUserRoleById,
  getUserRoles,
  updateUserRole,
} from "../controllers/userRole.controller.js";
import { checkAuthentication } from "../middlewares/auth.middleware.js";
import { requireAdmin } from "../middlewares/role.middleware.js";

const router = Router();

router.post("/", checkAuthentication, requireAdmin, createUserRole);
router.get("/", checkAuthentication, getUserRoles);
router.get("/:id", checkAuthentication, getUserRoleById);
router.patch("/:id", checkAuthentication, requireAdmin, updateUserRole);
router.delete("/:id", checkAuthentication, requireAdmin, deleteUserRole);

export default router;
