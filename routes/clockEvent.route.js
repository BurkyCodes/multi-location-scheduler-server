import { Router } from "express";
import {
  createClockEvent,
  deleteClockEvent,
  getClockEventById,
  getClockEvents,
  updateClockEvent,
} from "../controllers/clockEvent.controller.js";

const router = Router();

router.post("/", createClockEvent);
router.get("/", getClockEvents);
router.get("/:id", getClockEventById);
router.patch("/:id", updateClockEvent);
router.delete("/:id", deleteClockEvent);

export default router;
