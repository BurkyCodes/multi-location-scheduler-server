import { Router } from "express";
import {
  clockInAssignment,
  clockOutAssignment,
  createAssignment,
  deleteAssignment,
  getAssignmentOperationalInsights,
  getCoverageSuggestions,
  getAssignmentById,
  getAssignments,
  getMyShiftTracking,
  getWorkedHoursAnalytics,
  pauseAssignment,
  resumeAssignment,
  updateAssignment,
} from "../controllers/assignment.controller.js";
import { checkAuthentication } from "../middlewares/auth.middleware.js";
import { requireManager } from "../middlewares/role.middleware.js";

const router = Router();

router.get("/", checkAuthentication, getAssignments);
router.get("/my/tracking", checkAuthentication, getMyShiftTracking);
router.get("/insights", checkAuthentication, getAssignmentOperationalInsights);
router.get("/worked-hours", checkAuthentication, getWorkedHoursAnalytics);
router.get("/coverage/:shift_id", checkAuthentication, requireManager, getCoverageSuggestions);
router.get("/:id", checkAuthentication, getAssignmentById);
router.post("/:id/clock-in", checkAuthentication, clockInAssignment);
router.post("/:id/pause", checkAuthentication, pauseAssignment);
router.post("/:id/resume", checkAuthentication, resumeAssignment);
router.post("/:id/clock-out", checkAuthentication, clockOutAssignment);
router.post("/", checkAuthentication, requireManager, createAssignment);
router.patch("/:id", checkAuthentication, requireManager, updateAssignment);
router.delete("/:id", checkAuthentication, requireManager, deleteAssignment);

export default router;
