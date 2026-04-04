import Shift from "../models/Shift.js";
import Schedule from "../models/Schedule.js";
import Location from "../models/Location.js";
import Skill from "../models/Skill.js";
import User from "../models/User.js";
import asyncHandler from "../utils/asyncHandler.js";

const isShiftLockedByCutoff = (shiftStartUtc, cutoffHours) => {
  const cutoffMoment = new Date(
    new Date(shiftStartUtc).getTime() - cutoffHours * 60 * 60 * 1000
  );
  return new Date() >= cutoffMoment;
};
const hasLocationAccess = (user, locationId) => {
  if (!locationId) return false;
  return (user.location_ids || []).some((id) => id.toString() === locationId.toString());
};
const normalizeShiftTimes = (startsAtUtc, endsAtUtc) => {
  const start = new Date(startsAtUtc);
  let end = new Date(endsAtUtc);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  // Support overnight entry when end is entered earlier than start on same local day.
  if (end <= start) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }
  return { starts_at_utc: start, ends_at_utc: end };
};
const formatInTimezone = (dateValue, timezone) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(dateValue));
const toShiftResponse = (shift) => {
  const data = shift.toObject ? shift.toObject() : shift;
  return {
    ...data,
    starts_at_local: formatInTimezone(data.starts_at_utc, data.location_timezone),
    ends_at_local: formatInTimezone(data.ends_at_utc, data.location_timezone),
  };
};

export const createShift = asyncHandler(async (req, res) => {
  const {
    schedule_id,
    location_id,
    required_skill_id,
    starts_at_utc,
    ends_at_utc,
    headcount_required,
    is_premium,
    status,
  } = req.body;

  if (
    !schedule_id ||
    !location_id ||
    !required_skill_id ||
    !starts_at_utc ||
    !ends_at_utc ||
    !headcount_required
  ) {
    return res.status(400).json({
      success: false,
      message:
        "schedule_id, location_id, required_skill_id, starts_at_utc, ends_at_utc and headcount_required are required",
    });
  }

  const [schedule, location, skill] = await Promise.all([
    Schedule.findById(schedule_id),
    Location.findById(location_id),
    Skill.findById(required_skill_id),
  ]);

  if (!schedule) {
    return res.status(404).json({ success: false, message: "Schedule not found" });
  }
  if (!location) {
    return res.status(404).json({ success: false, message: "Location not found" });
  }
  if (!skill) {
    return res.status(404).json({ success: false, message: "Skill not found" });
  }

  if (!hasLocationAccess(req.authUser, location._id)) {
    return res.status(403).json({
      success: false,
      message: "Managers can only manage shifts for assigned locations",
    });
  }

  if (schedule.location_id.toString() !== location._id.toString()) {
    return res.status(400).json({
      success: false,
      message: "Shift location_id must match schedule location_id",
    });
  }

  if (
    schedule.status === "published" &&
    isShiftLockedByCutoff(starts_at_utc, schedule.edit_cutoff_hours ?? 48)
  ) {
    return res.status(409).json({
      success: false,
      message: "Cannot add shift because schedule cutoff time has passed",
    });
  }

  const normalizedTimes = normalizeShiftTimes(starts_at_utc, ends_at_utc);
  if (!normalizedTimes) {
    return res
      .status(400)
      .json({ success: false, message: "starts_at_utc and ends_at_utc must be valid dates" });
  }

  const shift = await Shift.create({
    schedule_id,
    location_id,
    required_skill_id,
    starts_at_utc: normalizedTimes.starts_at_utc,
    ends_at_utc: normalizedTimes.ends_at_utc,
    location_timezone: location.timezone,
    headcount_required,
    is_premium,
    status,
    created_by: req.userId,
    updated_by: req.userId,
  });

  const populated = await Shift.findById(shift._id).populate(
    "schedule_id location_id required_skill_id created_by updated_by"
  );

  return res.status(201).json({ success: true, data: toShiftResponse(populated) });
});

export const getShifts = asyncHandler(async (req, res) => {
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
    : {};

  const shifts = await Shift.find(filter)
    .populate("schedule_id location_id required_skill_id created_by updated_by")
    .sort({ createdAt: -1 });

  return res.json({
    success: true,
    count: shifts.length,
    data: shifts.map((item) => toShiftResponse(item)),
  });
});

export const getShiftById = asyncHandler(async (req, res) => {
  const shift = await Shift.findById(req.params.id).populate(
    "schedule_id location_id required_skill_id created_by updated_by"
  );

  if (!shift) {
    return res.status(404).json({ success: false, message: "Shift not found" });
  }

  const currentUser = await User.findById(req.userId).populate({
    path: "role_id",
    select: "role",
  });
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }
  if (
    currentUser.role_id?.role === "manager" &&
    !hasLocationAccess(currentUser, shift.location_id._id || shift.location_id)
  ) {
    return res.status(403).json({
      success: false,
      message: "Managers can only access shifts for assigned locations",
    });
  }

  return res.json({ success: true, data: toShiftResponse(shift) });
});

export const updateShift = asyncHandler(async (req, res) => {
  const shift = await Shift.findById(req.params.id);
  if (!shift) {
    return res.status(404).json({ success: false, message: "Shift not found" });
  }

  const schedule = await Schedule.findById(shift.schedule_id);
  if (!schedule) {
    return res.status(404).json({ success: false, message: "Schedule not found" });
  }

  if (!hasLocationAccess(req.authUser, shift.location_id)) {
    return res.status(403).json({
      success: false,
      message: "Managers can only manage shifts for assigned locations",
    });
  }

  const nextStart = req.body.starts_at_utc || shift.starts_at_utc;
  if (
    schedule.status === "published" &&
    isShiftLockedByCutoff(nextStart, schedule.edit_cutoff_hours ?? 48)
  ) {
    return res.status(409).json({
      success: false,
      message: "Shift cannot be edited because cutoff time has passed",
    });
  }

  const updateData = { ...req.body, updated_by: req.userId };
  const nextLocationId = updateData.location_id || shift.location_id;
  if (!hasLocationAccess(req.authUser, nextLocationId)) {
    return res.status(403).json({
      success: false,
      message: "Managers can only manage shifts for assigned locations",
    });
  }

  if (updateData.created_by) {
    delete updateData.created_by;
  }

  if (
    Object.prototype.hasOwnProperty.call(updateData, "starts_at_utc") ||
    Object.prototype.hasOwnProperty.call(updateData, "ends_at_utc")
  ) {
    const normalizedTimes = normalizeShiftTimes(
      updateData.starts_at_utc || shift.starts_at_utc,
      updateData.ends_at_utc || shift.ends_at_utc
    );
    if (!normalizedTimes) {
      return res.status(400).json({
        success: false,
        message: "starts_at_utc and ends_at_utc must be valid dates",
      });
    }
    updateData.starts_at_utc = normalizedTimes.starts_at_utc;
    updateData.ends_at_utc = normalizedTimes.ends_at_utc;
  }

  if (updateData.location_id) {
    const location = await Location.findById(updateData.location_id);
    if (!location) {
      return res.status(404).json({ success: false, message: "Location not found" });
    }
    if (schedule.location_id.toString() !== location._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "Shift location_id must match schedule location_id",
      });
    }
    updateData.location_timezone = location.timezone;
  }

  const updated = await Shift.findByIdAndUpdate(req.params.id, updateData, {
    new: true,
    runValidators: true,
  }).populate("schedule_id location_id required_skill_id created_by updated_by");

  return res.json({ success: true, data: toShiftResponse(updated) });
});

export const deleteShift = asyncHandler(async (req, res) => {
  const shift = await Shift.findById(req.params.id);
  if (!shift) {
    return res.status(404).json({ success: false, message: "Shift not found" });
  }

  const schedule = await Schedule.findById(shift.schedule_id);
  if (!schedule) {
    return res.status(404).json({ success: false, message: "Schedule not found" });
  }

  if (!hasLocationAccess(req.authUser, shift.location_id)) {
    return res.status(403).json({
      success: false,
      message: "Managers can only manage shifts for assigned locations",
    });
  }

  if (
    schedule.status === "published" &&
    isShiftLockedByCutoff(shift.starts_at_utc, schedule.edit_cutoff_hours ?? 48)
  ) {
    return res.status(409).json({
      success: false,
      message: "Shift cannot be deleted because cutoff time has passed",
    });
  }

  await Shift.findByIdAndDelete(req.params.id);
  return res.json({ success: true, message: "Shift deleted" });
});
