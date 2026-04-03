import { Router } from "express";
import {
  createAssignment,
  deleteAssignment,
  getAssignmentById,
  getAssignments,
  updateAssignment,
} from "../controllers/assignment.controller.js";

const router = Router();

router.post("/", createAssignment);
router.get("/", getAssignments);
router.get("/:id", getAssignmentById);
router.patch("/:id", updateAssignment);
router.delete("/:id", deleteAssignment);

export default router;
