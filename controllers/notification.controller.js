import Notification from "../models/Notification.js";
import asyncHandler from "../utils/asyncHandler.js";
import { createCrudController } from "./crud.controller.js";

const notificationController = createCrudController(Notification, {
  populate: "user_id related_shift_id related_swap_request_id",
});

export const createNotification = notificationController.createOne;
export const getNotifications = notificationController.getAll;
export const getNotificationById = notificationController.getById;
export const updateNotification = notificationController.updateById;
export const deleteNotification = notificationController.deleteById;

export const markNotificationRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findByIdAndUpdate(
    req.params.id,
    { read_at: new Date() },
    { new: true }
  );

  if (!notification) {
    return res.status(404).json({ success: false, message: "Notification not found" });
  }

  return res.json({ success: true, data: notification });
});
