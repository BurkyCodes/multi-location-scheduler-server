import Schedule from "../models/Schedule.js";
import { createCrudController } from "./crud.controller.js";
import asyncHandler from "../utils/asyncHandler.js";

const scheduleController = createCrudController(Schedule, {
  populate: "location_id published_by",
});

export const createSchedule = scheduleController.createOne;
export const getSchedules = scheduleController.getAll;
export const getScheduleById = scheduleController.getById;
export const updateSchedule = scheduleController.updateById;
export const deleteSchedule = scheduleController.deleteById;

export const publishSchedule = asyncHandler(async (req, res) => {
  const schedule = await Schedule.findByIdAndUpdate(
    req.params.id,
    {
      status: "published",
      published_by: req.body.published_by || null,
      published_at: new Date(),
    },
    { new: true, runValidators: true }
  );

  if (!schedule) {
    return res.status(404).json({ success: false, message: "Schedule not found" });
  }

  return res.json({ success: true, data: schedule });
});

export const unpublishSchedule = asyncHandler(async (req, res) => {
  const schedule = await Schedule.findByIdAndUpdate(
    req.params.id,
    { status: "unpublished" },
    { new: true, runValidators: true }
  );

  if (!schedule) {
    return res.status(404).json({ success: false, message: "Schedule not found" });
  }

  return res.json({ success: true, data: schedule });
});
