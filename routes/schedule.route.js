import { Router } from "express";
import {
  createSchedule,
  deleteSchedule,
  getScheduleById,
  getSchedules,
  publishSchedule,
  unpublishSchedule,
  updateSchedule,
} from "../controllers/schedule.controller.js";

const router = Router();

router.post("/", createSchedule);
router.get("/", getSchedules);
router.get("/:id", getScheduleById);
router.patch("/:id", updateSchedule);
router.delete("/:id", deleteSchedule);
router.post("/:id/publish", publishSchedule);
router.post("/:id/unpublish", unpublishSchedule);

export default router;
