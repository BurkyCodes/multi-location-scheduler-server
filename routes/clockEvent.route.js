import { Router } from "express";
import {
  createClockEvent,
  deleteClockEvent,
  getClockEventById,
  getClockEvents,
  updateClockEvent,
} from "../controllers/clockEvent.controller.js";
import { checkAuthentication } from "../middlewares/auth.middleware.js";
import { requireManagerOrAdmin } from "../middlewares/role.middleware.js";

const router = Router();

router.post("/", checkAuthentication, requireManagerOrAdmin, createClockEvent);
router.get("/", checkAuthentication, getClockEvents);
router.get("/:id", checkAuthentication, getClockEventById);
router.patch("/:id", checkAuthentication, requireManagerOrAdmin, updateClockEvent);
router.delete("/:id", checkAuthentication, requireManagerOrAdmin, deleteClockEvent);

export default router;
