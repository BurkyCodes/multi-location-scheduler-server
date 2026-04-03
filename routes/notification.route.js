import { Router } from "express";
import {
  createNotification,
  deleteNotification,
  getNotificationById,
  getNotifications,
  markNotificationRead,
  updateNotification,
} from "../controllers/notification.controller.js";

const router = Router();

router.post("/", createNotification);
router.get("/", getNotifications);
router.get("/:id", getNotificationById);
router.patch("/:id", updateNotification);
router.delete("/:id", deleteNotification);
router.post("/:id/read", markNotificationRead);

export default router;
