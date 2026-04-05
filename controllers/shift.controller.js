import Shift from "../models/Shift.js";
import Schedule from "../models/Schedule.js";
import Location from "../models/Location.js";
import Skill from "../models/Skill.js";
import User from "../models/User.js";
import ShiftAssignment from "../models/ShiftAssignment.js";
import SwapRequest from "../models/SwapRequest.js";
import asyncHandler from "../utils/asyncHandler.js";
import { evaluateAssignmentRules } from "./assignment.controller.js";
import {
  getActiveUsersByRole,
  sendBulkNotifications,
  sendBulkNotifications as notifyBulk,
} from "../services/notificationEvents.service.js";
import { logAuditChange } from "../services/auditLog.service.js";
import { publishRealtimeEventForLocation } from "../services/realtimeEvents.service.js";
import {
  CANONICAL_TIMEZONES,
  normalizeTimezone as normalizeSupportedTimezone,
  toIanaTimezone,
  toTimezoneLabel,
} from "../utils/timezone.js";

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
const normalizeTimezone = (timezone) => {
  return normalizeSupportedTimezone(timezone, {
    fallback: CANONICAL_TIMEZONES.EAST_AFRICA,
    restrictToAllowed: true,
  });
};
const formatInTimezone = (dateValue, timezone) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: toIanaTimezone(normalizeTimezone(timezone)),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(dateValue));
const toShiftResponse = (shift) => {
  const data = shift.toObject ? shift.toObject() : shift;
  const safeTimezone = normalizeTimezone(data.location_timezone);
  return {
    ...data,
    location_timezone: safeTimezone,
    location_timezone_label: toTimezoneLabel(safeTimezone),
    starts_at_local: formatInTimezone(data.starts_at_utc, safeTimezone),
    ends_at_local: formatInTimezone(data.ends_at_utc, safeTimezone),
  };
};

const PENDING_SWAP_STATUSES = [
  "pending_peer_acceptance",
  "pending_manager_approval",
  "processing",
];

const cancelPendingSwapRequestsForShift = async ({ shiftId, actorUserId }) => {
  const assignmentIds = (
    await ShiftAssignment.find({ shift_id: shiftId }).select("_id")
  ).map((item) => item._id);
  if (!assignmentIds.length) return { cancelled_count: 0 };

  const pendingRequests = await SwapRequest.find({
    status: { $in: PENDING_SWAP_STATUSES },
    $or: [
      { from_assignment_id: { $in: assignmentIds } },
      { requested_assignment_id: { $in: assignmentIds } },
    ],
  });

  if (!pendingRequests.length) return { cancelled_count: 0 };

  const cancelledIds = pendingRequests.map((item) => item._id);
  await SwapRequest.updateMany(
    { _id: { $in: cancelledIds } },
    {
      $set: {
        status: "cancelled",
        cancelled_reason:
          "Automatically cancelled because related shift was edited by manager",
      },
    }
  );

  for (const request of pendingRequests) {
    const notifyIds = [
      request.requester_id,
      request.target_user_id,
      request.claimed_by_user_id,
      request.manager_id,
    ]
      .filter(Boolean)
      .map((id) => id.toString());
    const uniqueNotifyIds = [...new Set(notifyIds)];
    if (uniqueNotifyIds.length) {
      await notifyBulk(uniqueNotifyIds, {
        title: "Swap request cancelled",
        message: "Related shift was edited. Pending swap/drop was cancelled.",
        category: "swap_updated",
        priority: "normal",
        data: {
          shift_id: shiftId.toString(),
          swap_request_ids: cancelledIds.map((id) => id.toString()).join(","),
        },
      });
    }

    await logAuditChange({
      actor_user_id: actorUserId,
      entity_type: "swap_request",
      action: "auto_cancel_shift_edited",
      before_state: request.toObject(),
      after_state: {
        ...request.toObject(),
        status: "cancelled",
        cancelled_reason:
          "Automatically cancelled because related shift was edited by manager",
      },
    });
  }

  return { cancelled_count: cancelledIds.length };
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
    location_timezone: normalizeTimezone(location.timezone),
    headcount_required,
    is_premium,
    status,
    created_by: req.userId,
    updated_by: req.userId,
  });

  const populated = await Shift.findById(shift._id).populate(
    "schedule_id location_id required_skill_id created_by updated_by"
  );

  const admins = await getActiveUsersByRole("admin");
  await sendBulkNotifications(
    admins.map((item) => item._id),
    {
      title: "New shift created",
      message: "A new shift has been created on the schedule.",
      category: "shift_created",
      priority: "normal",
      data: {
        shift_id: shift._id.toString(),
        schedule_id: schedule_id.toString(),
        location_id: location_id.toString(),
      },
    }
  );

  await logAuditChange({
    actor_user_id: req.userId,
    entity_type: "shift",
    action: "create",
    before_state: null,
    after_state: shift.toObject(),
  });
  await publishRealtimeEventForLocation(location_id, "shift_changed", {
    action: "created",
    shift_id: shift._id.toString(),
    schedule_id: schedule_id.toString(),
    location_id: location_id.toString(),
    at: new Date().toISOString(),
  });

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
  if (Object.prototype.hasOwnProperty.call(updateData, "location_timezone")) {
    delete updateData.location_timezone;
  }
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
    updateData.location_timezone = normalizeTimezone(location.timezone);
  } else {
    updateData.location_timezone = normalizeTimezone(shift.location_timezone);
  }

  const projectedHeadcount =
    updateData.headcount_required ?? shift.headcount_required;
  const assignedCount = await ShiftAssignment.countDocuments({
    shift_id: shift._id,
    status: "assigned",
  });
  if (projectedHeadcount < assignedCount) {
    return res.status(409).json({
      success: false,
      message: `headcount_required (${projectedHeadcount}) cannot be below assigned staff count (${assignedCount})`,
      data: {
        assigned_count: assignedCount,
        requested_headcount: projectedHeadcount,
      },
    });
  }

  const projectedShift = {
    _id: shift._id,
    location_id: updateData.location_id || shift.location_id,
    required_skill_id: updateData.required_skill_id || shift.required_skill_id,
    location_timezone: updateData.location_timezone || shift.location_timezone,
    starts_at_utc: updateData.starts_at_utc || shift.starts_at_utc,
    ends_at_utc: updateData.ends_at_utc || shift.ends_at_utc,
  };

  const activeAssignments = await ShiftAssignment.find({
    shift_id: shift._id,
    status: "assigned",
  }).populate({
    path: "user_id",
    select: "name phone_number email role_id status is_active",
    populate: { path: "role_id", select: "role" },
  });

  const impactedAssignments = [];
  for (const assignment of activeAssignments) {
    if (!assignment.user_id) {
      impactedAssignments.push({
        assignment_id: assignment._id,
        user_id: assignment.user_id,
        violations: [{ rule: "user_missing", message: "Assigned staff user not found" }],
      });
      continue;
    }

    const violations = await evaluateAssignmentRules({
      user: assignment.user_id,
      shift: projectedShift,
      excludeAssignmentId: assignment._id,
    });

    if (violations.length) {
      impactedAssignments.push({
        assignment_id: assignment._id,
        user_id: assignment.user_id._id,
        name:
          assignment.user_id.name ||
          assignment.user_id.email ||
          assignment.user_id.phone_number,
        violations,
      });
    }
  }

  if (impactedAssignments.length) {
    return res.status(409).json({
      success: false,
      message:
        "Shift update would invalidate one or more existing assignments. Reassign or edit assignments first.",
      impacted_assignments: impactedAssignments,
    });
  }

  const updated = await Shift.findByIdAndUpdate(req.params.id, updateData, {
    new: true,
    runValidators: true,
  }).populate("schedule_id location_id required_skill_id created_by updated_by");
  const cancelledSwapSummary = await cancelPendingSwapRequestsForShift({
    shiftId: shift._id,
    actorUserId: req.userId,
  });

  await logAuditChange({
    actor_user_id: req.userId,
    entity_type: "shift",
    action: "update",
    before_state: shift.toObject(),
    after_state: updated?.toObject ? updated.toObject() : updated,
  });
  await publishRealtimeEventForLocation(
    updated?.location_id?._id || updated?.location_id || shift.location_id,
    "shift_changed",
    {
      action: "updated",
      shift_id: shift._id.toString(),
      schedule_id: (updated?.schedule_id?._id || updated?.schedule_id || shift.schedule_id).toString(),
      location_id: (
        updated?.location_id?._id ||
        updated?.location_id ||
        shift.location_id
      ).toString(),
      auto_cancelled_pending_swap_requests: cancelledSwapSummary.cancelled_count,
      at: new Date().toISOString(),
    }
  );
  if (cancelledSwapSummary.cancelled_count > 0) {
    await publishRealtimeEventForLocation(
      updated?.location_id?._id || updated?.location_id || shift.location_id,
      "swap_changed",
      {
        action: "auto_cancelled_by_shift_edit",
        shift_id: shift._id.toString(),
        cancelled_count: cancelledSwapSummary.cancelled_count,
        at: new Date().toISOString(),
      }
    );
  }

  return res.json({
    success: true,
    data: toShiftResponse(updated),
    auto_cancelled_pending_swap_requests: cancelledSwapSummary.cancelled_count,
  });
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
  await logAuditChange({
    actor_user_id: req.userId,
    entity_type: "shift",
    action: "delete",
    before_state: shift.toObject(),
    after_state: null,
  });
  await publishRealtimeEventForLocation(shift.location_id, "shift_changed", {
    action: "deleted",
    shift_id: shift._id.toString(),
    schedule_id: shift.schedule_id.toString(),
    location_id: shift.location_id.toString(),
    at: new Date().toISOString(),
  });
  return res.json({ success: true, message: "Shift deleted" });
});
