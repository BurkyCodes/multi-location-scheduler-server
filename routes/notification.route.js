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
import { requireManagerOrAdmin } from "../middlewares/role.middleware.js";

const router = Router();

router.post("/push/register", checkAuthentication, registerDeviceToken);
router.post("/push/unregister", checkAuthentication, unregisterDeviceToken);
router.post("/push/send", checkAuthentication, requireManagerOrAdmin, sendNotification);
router.get("/feed/:orgUserId", checkAuthentication, getUserNotifications);
router.get("/feed/:orgUserId/unread-count", checkAuthentication, getUnreadCount);
router.put("/feed/read-all/:orgUserId", checkAuthentication, markAllNotificationsRead);
router.delete("/feed/:id", checkAuthentication, softDeleteNotification);

router.post("/", checkAuthentication, requireManagerOrAdmin, createNotification);
router.get("/", checkAuthentication, requireManagerOrAdmin, getNotifications);
router.get("/:id", checkAuthentication, getNotificationById);
router.patch("/:id", checkAuthentication, requireManagerOrAdmin, updateNotification);
router.delete("/:id", checkAuthentication, requireManagerOrAdmin, deleteNotification);
router.post("/:id/read", checkAuthentication, markNotificationRead);

export default router;
