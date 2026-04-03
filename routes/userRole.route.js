import { Router } from "express";
import {
  createUserRole,
  deleteUserRole,
  getUserRoleById,
  getUserRoles,
  updateUserRole,
} from "../controllers/userRole.controller.js";

const router = Router();

router.post("/", createUserRole);
router.get("/", getUserRoles);
router.get("/:id", getUserRoleById);
router.patch("/:id", updateUserRole);
router.delete("/:id", deleteUserRole);

export default router;
