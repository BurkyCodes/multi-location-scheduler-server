import StaffPreference from "../models/StaffPreference.js";
import NotificationPreference from "../models/NotificationPreference.js";
import asyncHandler from "../utils/asyncHandler.js";

const upsertByUser = (Model) =>
  asyncHandler(async (req, res) => {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ success: false, message: "user_id is required" });
    }

    const doc = await Model.findOneAndUpdate({ user_id }, req.body, {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    });

    return res.status(201).json({ success: true, data: doc });
  });

const getByUser = (Model) =>
  asyncHandler(async (req, res) => {
    const doc = await Model.findOne({ user_id: req.params.userId });

    if (!doc) {
      return res.status(404).json({ success: false, message: "Preference not found" });
    }

    return res.json({ success: true, data: doc });
  });

export const upsertStaffPreference = upsertByUser(StaffPreference);
export const getStaffPreferenceByUser = getByUser(StaffPreference);
export const upsertNotificationPreference = upsertByUser(NotificationPreference);
export const getNotificationPreferenceByUser = getByUser(NotificationPreference);
