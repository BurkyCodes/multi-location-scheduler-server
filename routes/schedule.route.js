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
import { checkAuthentication } from "../middlewares/auth.middleware.js";
import { requireManager } from "../middlewares/role.middleware.js";

const router = Router();

router.get("/", checkAuthentication, getSchedules);
router.get("/:id", checkAuthentication, getScheduleById);
router.post("/", checkAuthentication, requireManager, createSchedule);
router.patch("/:id", checkAuthentication, requireManager, updateSchedule);
router.delete("/:id", checkAuthentication, requireManager, deleteSchedule);
router.post("/:id/publish", checkAuthentication, requireManager, publishSchedule);
router.post("/:id/unpublish", checkAuthentication, requireManager, unpublishSchedule);

export default router;
