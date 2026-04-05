import Schedule from "../models/Schedule.js";
import Shift from "../models/Shift.js";
import User from "../models/User.js";
import asyncHandler from "../utils/asyncHandler.js";
import {
  getActiveUsersByRole,
  sendBulkNotifications,
} from "../services/notificationEvents.service.js";

const normalizeWeekStartDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const isScheduleLockedByCutoff = async (schedule) => {
  const nextShift = await Shift.findOne({ schedule_id: schedule._id })
    .sort({ starts_at_utc: 1 })
    .select("starts_at_utc");

  if (!nextShift?.starts_at_utc) {
    return false;
  }

  const cutoffHours = schedule.edit_cutoff_hours ?? 48;
  const cutoffMoment = new Date(
    new Date(nextShift.starts_at_utc).getTime() - cutoffHours * 60 * 60 * 1000
  );

  return new Date() >= cutoffMoment;
};
const hasLocationAccess = (user, locationId) => {
  if (!locationId) return false;
  return (user.location_ids || []).some((id) => id.toString() === locationId.toString());
};

export const createSchedule = asyncHandler(async (req, res) => {
  const { location_id, week_start_date, edit_cutoff_hours } = req.body;

  if (!location_id || !week_start_date) {
    return res.status(400).json({
      success: false,
      message: "location_id and week_start_date are required",
    });
  }

  const normalizedWeekStart = normalizeWeekStartDate(week_start_date);
  if (!normalizedWeekStart) {
    return res
      .status(400)
      .json({ success: false, message: "week_start_date must be a valid date" });
  }

  if (!hasLocationAccess(req.authUser, location_id)) {
    return res.status(403).json({
      success: false,
      message: "Managers can only manage schedules for assigned locations",
    });
  }

  const existing = await Schedule.findOne({
    location_id,
    week_start_date: normalizedWeekStart,
  });

  if (existing) {
    return res.status(409).json({
      success: false,
      message: "A schedule already exists for this location and week",
    });
  }

  const schedule = await Schedule.create({
    location_id,
    week_start_date: normalizedWeekStart,
    edit_cutoff_hours,
    status: "draft",
  });

  const admins = await getActiveUsersByRole("admin");
  await sendBulkNotifications(
    admins.map((item) => item._id),
    {
      title: "New schedule created",
      message: "A new schedule has been created and is ready for review.",
      category: "schedule_created",
      priority: "normal",
      data: {
        schedule_id: schedule._id.toString(),
        location_id: location_id.toString(),
      },
    }
  );

  return res.status(201).json({ success: true, data: schedule });
});

export const getSchedules = asyncHandler(async (req, res) => {
  const currentUser = await User.findById(req.userId).populate({
    path: "role_id",
    select: "role",
  });
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const isManager = currentUser.role_id?.role === "manager";
  const filter = isManager
    ? { location_id: { $in: currentUser.location_ids || [] } }
    : { status: "published" };

  const schedules = await Schedule.find(filter)
    .populate("location_id published_by")
    .sort({ createdAt: -1 });

  return res.json({ success: true, count: schedules.length, data: schedules });
});

export const getScheduleById = asyncHandler(async (req, res) => {
  const currentUser = await User.findById(req.userId).populate({
    path: "role_id",
    select: "role",
  });
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const schedule = await Schedule.findById(req.params.id).populate(
    "location_id published_by"
  );

  if (!schedule) {
    return res.status(404).json({ success: false, message: "Schedule not found" });
  }

  if (currentUser.role_id?.role !== "manager" && schedule.status !== "published") {
    return res.status(404).json({ success: false, message: "Schedule not found" });
  }

  if (
    currentUser.role_id?.role === "manager" &&
    !hasLocationAccess(currentUser, schedule.location_id)
  ) {
    return res.status(403).json({
      success: false,
      message: "Managers can only access schedules for assigned locations",
    });
  }

  return res.json({ success: true, data: schedule });
});

export const updateSchedule = asyncHandler(async (req, res) => {
  const schedule = await Schedule.findById(req.params.id);
  if (!schedule) {
    return res.status(404).json({ success: false, message: "Schedule not found" });
  }

  if (!hasLocationAccess(req.authUser, schedule.location_id)) {
    return res.status(403).json({
      success: false,
      message: "Managers can only manage schedules for assigned locations",
    });
  }

  const lockedByCutoff = await isScheduleLockedByCutoff(schedule);
  if (lockedByCutoff) {
    return res.status(409).json({
      success: false,
      message: "Schedule cannot be edited because cutoff time has passed",
    });
  }

  const updateData = { ...req.body };
  const nextLocationId = updateData.location_id || schedule.location_id;
  if (!hasLocationAccess(req.authUser, nextLocationId)) {
    return res.status(403).json({
      success: false,
      message: "Managers can only manage schedules for assigned locations",
    });
  }

  if (updateData.week_start_date) {
    const normalizedWeekStart = normalizeWeekStartDate(updateData.week_start_date);
    if (!normalizedWeekStart) {
      return res
        .status(400)
        .json({ success: false, message: "week_start_date must be a valid date" });
    }
    updateData.week_start_date = normalizedWeekStart;
  }

  if (
    updateData.location_id ||
    Object.prototype.hasOwnProperty.call(updateData, "week_start_date")
  ) {
    const duplicate = await Schedule.findOne({
      _id: { $ne: schedule._id },
      location_id: updateData.location_id || schedule.location_id,
      week_start_date: updateData.week_start_date || schedule.week_start_date,
    });

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "A schedule already exists for this location and week",
      });
    }
  }

  const latestBeforeWrite = await Schedule.findById(schedule._id);
  if (!latestBeforeWrite) {
    return res.status(404).json({ success: false, message: "Schedule not found" });
  }
  const lockedBeforeWrite = await isScheduleLockedByCutoff(latestBeforeWrite);
  if (lockedBeforeWrite) {
    return res.status(409).json({
      success: false,
      message: "Schedule cannot be edited because cutoff time has passed",
    });
  }

  const updated = await Schedule.findByIdAndUpdate(req.params.id, updateData, {
    new: true,
    runValidators: true,
  }).populate("location_id published_by");

  return res.json({ success: true, data: updated });
});

export const deleteSchedule = asyncHandler(async (req, res) => {
  const schedule = await Schedule.findById(req.params.id);
  if (!schedule) {
    return res.status(404).json({ success: false, message: "Schedule not found" });
  }

  if (!hasLocationAccess(req.authUser, schedule.location_id)) {
    return res.status(403).json({
      success: false,
      message: "Managers can only manage schedules for assigned locations",
    });
  }

  const lockedByCutoff = await isScheduleLockedByCutoff(schedule);
  if (lockedByCutoff) {
    return res.status(409).json({
      success: false,
      message: "Schedule cannot be deleted because cutoff time has passed",
    });
  }

  const latestBeforeDelete = await Schedule.findById(schedule._id);
  if (!latestBeforeDelete) {
    return res.status(404).json({ success: false, message: "Schedule not found" });
  }
  const lockedBeforeDelete = await isScheduleLockedByCutoff(latestBeforeDelete);
  if (lockedBeforeDelete) {
    return res.status(409).json({
      success: false,
      message: "Schedule cannot be deleted because cutoff time has passed",
    });
  }

  await Schedule.findByIdAndDelete(req.params.id);
  return res.json({ success: true, message: "Schedule deleted" });
});

export const publishSchedule = asyncHandler(async (req, res) => {
  const schedule = await Schedule.findById(req.params.id);
  if (!schedule) {
    return res.status(404).json({ success: false, message: "Schedule not found" });
  }

  if (!hasLocationAccess(req.authUser, schedule.location_id)) {
    return res.status(403).json({
      success: false,
      message: "Managers can only manage schedules for assigned locations",
    });
  }

  const lockedByCutoff = await isScheduleLockedByCutoff(schedule);
  if (lockedByCutoff) {
    return res.status(409).json({
      success: false,
      message: "Schedule cannot be published because cutoff time has passed",
    });
  }

  const latestBeforePublish = await Schedule.findById(schedule._id);
  if (!latestBeforePublish) {
    return res.status(404).json({ success: false, message: "Schedule not found" });
  }
  const lockedBeforePublish = await isScheduleLockedByCutoff(latestBeforePublish);
  if (lockedBeforePublish) {
    return res.status(409).json({
      success: false,
      message: "Schedule cannot be published because cutoff time has passed",
    });
  }

  schedule.status = "published";
  schedule.published_by = req.userId;
  schedule.published_at = new Date();
  await schedule.save();

  const populated = await Schedule.findById(schedule._id).populate(
    "location_id published_by"
  );
  return res.json({ success: true, data: populated });
});

export const unpublishSchedule = asyncHandler(async (req, res) => {
  const schedule = await Schedule.findById(req.params.id);
  if (!schedule) {
    return res.status(404).json({ success: false, message: "Schedule not found" });
  }

  if (!hasLocationAccess(req.authUser, schedule.location_id)) {
    return res.status(403).json({
      success: false,
      message: "Managers can only manage schedules for assigned locations",
    });
  }

  const lockedByCutoff = await isScheduleLockedByCutoff(schedule);
  if (lockedByCutoff) {
    return res.status(409).json({
      success: false,
      message: "Schedule cannot be unpublished because cutoff time has passed",
    });
  }

  const latestBeforeUnpublish = await Schedule.findById(schedule._id);
  if (!latestBeforeUnpublish) {
    return res.status(404).json({ success: false, message: "Schedule not found" });
  }
  const lockedBeforeUnpublish = await isScheduleLockedByCutoff(latestBeforeUnpublish);
  if (lockedBeforeUnpublish) {
    return res.status(409).json({
      success: false,
      message: "Schedule cannot be unpublished because cutoff time has passed",
    });
  }

  schedule.status = "unpublished";
  await schedule.save();

  const populated = await Schedule.findById(schedule._id).populate(
    "location_id published_by"
  );
  return res.json({ success: true, data: populated });
});
