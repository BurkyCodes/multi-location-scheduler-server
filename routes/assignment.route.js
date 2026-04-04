import { Router } from "express";
import {
  clockInAssignment,
  clockOutAssignment,
  createAssignment,
  deleteAssignment,
  getCoverageSuggestions,
  getAssignmentById,
  getAssignments,
  updateAssignment,
} from "../controllers/assignment.controller.js";
import { checkAuthentication } from "../middlewares/auth.middleware.js";
import { requireManager } from "../middlewares/role.middleware.js";

const router = Router();

router.get("/", checkAuthentication, getAssignments);
router.get("/coverage/:shift_id", checkAuthentication, requireManager, getCoverageSuggestions);
router.get("/:id", checkAuthentication, getAssignmentById);
router.post("/:id/clock-in", checkAuthentication, clockInAssignment);
router.post("/:id/clock-out", checkAuthentication, clockOutAssignment);
router.post("/", checkAuthentication, requireManager, createAssignment);
router.patch("/:id", checkAuthentication, requireManager, updateAssignment);
router.delete("/:id", checkAuthentication, requireManager, deleteAssignment);

export default router;
