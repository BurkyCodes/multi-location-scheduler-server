import Availability from "../models/Availability.js";
import asyncHandler from "../utils/asyncHandler.js";

export const upsertAvailability = asyncHandler(async (req, res) => {
  const { user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ success: false, message: "user_id is required" });
  }

  const availability = await Availability.findOneAndUpdate(
    { user_id },
    req.body,
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );

  return res.status(201).json({ success: true, data: availability });
});

export const getAvailabilityByUser = asyncHandler(async (req, res) => {
  const availability = await Availability.findOne({ user_id: req.params.userId });

  if (!availability) {
    return res
      .status(404)
      .json({ success: false, message: "Availability not found for user" });
  }

  return res.json({ success: true, data: availability });
});

export const deleteAvailabilityByUser = asyncHandler(async (req, res) => {
  const availability = await Availability.findOneAndDelete({
    user_id: req.params.userId,
  });

  if (!availability) {
    return res
      .status(404)
      .json({ success: false, message: "Availability not found for user" });
  }

  return res.json({ success: true, message: "Availability deleted" });
});
