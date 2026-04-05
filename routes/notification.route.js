import { Router } from "express";
import {
  createNotification,
  deleteNotification,
  getUnreadCount,
  getNotificationById,
  getNotifications,
  getUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  registerDeviceToken,
  sendNotification,
  softDeleteNotification,
  unregisterDeviceToken,
  updateNotification,
} from "../controllers/notification.controller.js";
import { checkAuthentication } from "../middlewares/auth.middleware.js";

const router = Router();

router.post("/push/register", checkAuthentication, registerDeviceToken);
router.post("/push/unregister", checkAuthentication, unregisterDeviceToken);
router.post("/push/send", sendNotification);
router.get("/feed/:orgUserId", getUserNotifications);
router.get("/feed/:orgUserId/unread-count", getUnreadCount);
router.put("/feed/read-all/:orgUserId", markAllNotificationsRead);
router.delete("/feed/:id", softDeleteNotification);

router.post("/", createNotification);
router.get("/", getNotifications);
router.get("/:id", getNotificationById);
router.patch("/:id", updateNotification);
router.delete("/:id", deleteNotification);
router.post("/:id/read", markNotificationRead);

export default router;
