import ShiftAssignment from "../models/ShiftAssignment.js";
import Shift from "../models/Shift.js";
import Schedule from "../models/Schedule.js";
import User from "../models/User.js";
import StaffSkill from "../models/StaffSkill.js";
import StaffLocationCertification from "../models/StaffLocationCertification.js";
import StaffPreference from "../models/StaffPreference.js";
import Availability from "../models/Availability.js";
import ClockEvent from "../models/ClockEvent.js";
import asyncHandler from "../utils/asyncHandler.js";

const TEN_HOURS_MS = 10 * 60 * 60 * 1000;
const DEFAULT_WEEKLY_HOURS_LIMIT = 40;
const ASSIGNMENT_LOCK_MS = 15000;

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

const toMinutes = (value) => {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [h, m] = value.split(":").map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
};

const getLocalParts = (date, timezone) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(new Date(date));
  const map = {};
  parts.forEach((item) => {
    map[item.type] = item.value;
  });

  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${map.hour}:${map.minute}`,
    weekday: weekdayMap[map.weekday],
  };
};

const overlapByMinutes = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

const containsByMinutes = (outerStart, outerEnd, innerStart, innerEnd) =>
  outerStart <= innerStart && outerEnd >= innerEnd;

const matchesEntryLocation = (entry, locationId) =>
  !entry.location_id || entry.location_id.toString() === locationId.toString();

const matchesEntryTimezone = (entry, timezone) => entry.timezone === timezone;

const hasUnavailableException = (
  exceptions,
  date,
  segStart,
  segEnd,
  locationId,
  timezone
) => {
  return exceptions.some((entry) => {
    if (
      entry.date !== date ||
      entry.is_available !== false ||
      !matchesEntryLocation(entry, locationId) ||
      !matchesEntryTimezone(entry, timezone)
    ) {
      return false;
    }

    if (!entry.start_time_local || !entry.end_time_local) {
      return true;
    }

    const exStart = toMinutes(entry.start_time_local);
    const exEnd = toMinutes(entry.end_time_local);
    if (exStart === null || exEnd === null) return true;
    return overlapByMinutes(segStart, segEnd, exStart, exEnd);
  });
};

const hasAvailableException = (
  exceptions,
  date,
  segStart,
  segEnd,
  locationId,
  timezone
) => {
  return exceptions.some((entry) => {
    if (
      entry.date !== date ||
      entry.is_available !== true ||
      !matchesEntryLocation(entry, locationId) ||
      !matchesEntryTimezone(entry, timezone)
    ) {
      return false;
    }

    if (!entry.start_time_local || !entry.end_time_local) {
      return true;
    }

    const exStart = toMinutes(entry.start_time_local);
    const exEnd = toMinutes(entry.end_time_local);
    if (exStart === null || exEnd === null) return false;
    return containsByMinutes(exStart, exEnd, segStart, segEnd);
  });
};

const hasRecurringCoverage = (
  recurringWindows,
  weekday,
  segStart,
  segEnd,
  locationId,
  timezone
) => {
  return recurringWindows.some((window) => {
    if (
      window.weekday !== weekday ||
      !matchesEntryLocation(window, locationId) ||
      !matchesEntryTimezone(window, timezone)
    ) {
      return false;
    }

    const windowStart = toMinutes(window.start_time_local);
    const windowEnd = toMinutes(window.end_time_local);
    if (windowStart === null || windowEnd === null) {
      return false;
    }

    if (windowEnd > windowStart) {
      return containsByMinutes(windowStart, windowEnd, segStart, segEnd);
    }

    // Overnight recurring window, e.g. 22:00-06:00.
    return containsByMinutes(windowStart, 1440, segStart, segEnd);
  });
};

const evaluateAvailability = (availability, shift) => {
  if (!availability) {
    return {
      rule: "availability_hours",
      message: "Staff has no availability profile configured",
    };
  }

  const start = getLocalParts(shift.starts_at_utc, shift.location_timezone);
  const end = getLocalParts(shift.ends_at_utc, shift.location_timezone);
  const shiftStartMinutes = toMinutes(start.time);
  const shiftEndMinutes = toMinutes(end.time);
  if (shiftStartMinutes === null || shiftEndMinutes === null) {
    return {
      rule: "availability_hours",
      message: "Could not interpret local shift time for availability validation",
    };
  }

  const exceptions = availability.exceptions || [];
  const recurring = availability.recurring_windows || [];

  if (start.date === end.date) {
    if (
      hasUnavailableException(
        exceptions,
        start.date,
        shiftStartMinutes,
        shiftEndMinutes,
        shift.location_id,
        shift.location_timezone
      )
    ) {
      return {
        rule: "availability_hours",
        message: `Staff unavailable for ${start.date} ${start.time}-${end.time}`,
      };
    }

    if (
      hasAvailableException(
        exceptions,
        start.date,
        shiftStartMinutes,
        shiftEndMinutes,
        shift.location_id,
        shift.location_timezone
      )
    ) {
      return null;
    }

    if (
      !hasRecurringCoverage(
        recurring,
        start.weekday,
        shiftStartMinutes,
        shiftEndMinutes,
        shift.location_id,
        shift.location_timezone
      )
    ) {
      return {
        rule: "availability_hours",
        message: `Shift ${start.time}-${end.time} (${shift.location_timezone}) is outside staff recurring availability`,
      };
    }

    return null;
  }

  // Overnight shift handling: validate start-day and end-day segments.
  const startSeg = { start: shiftStartMinutes, end: 1440 };
  const endSeg = { start: 0, end: shiftEndMinutes };

  if (
    hasUnavailableException(
      exceptions,
      start.date,
      startSeg.start,
      startSeg.end,
      shift.location_id,
      shift.location_timezone
    ) ||
    hasUnavailableException(
      exceptions,
      end.date,
      endSeg.start,
      endSeg.end,
      shift.location_id,
      shift.location_timezone
    )
  ) {
    return {
      rule: "availability_hours",
      message: `Overnight shift ${start.time}-${end.time} crosses an unavailable period`,
    };
  }

  const coveredByExceptions =
    hasAvailableException(
      exceptions,
      start.date,
      startSeg.start,
      startSeg.end,
      shift.location_id,
      shift.location_timezone
    ) &&
    hasAvailableException(
      exceptions,
      end.date,
      endSeg.start,
      endSeg.end,
      shift.location_id,
      shift.location_timezone
    );

  if (coveredByExceptions) {
    return null;
  }

  const startCovered = hasRecurringCoverage(
    recurring,
    start.weekday,
    startSeg.start,
    startSeg.end,
    shift.location_id,
    shift.location_timezone
  );
  const endCovered = hasRecurringCoverage(
    recurring,
    end.weekday,
    endSeg.start,
    endSeg.end,
    shift.location_id,
    shift.location_timezone
  );

  if (!startCovered || !endCovered) {
    return {
      rule: "availability_hours",
      message: `Overnight shift ${start.time}-${end.time} is outside recurring availability coverage`,
    };
  }

  return null;
};

const getUtcWeekRange = (dateValue) => {
  const date = new Date(dateValue);
  const day = date.getUTCDay(); // 0=Sun
  const diffToMonday = (day + 6) % 7;
  const weekStart = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  weekStart.setUTCDate(weekStart.getUTCDate() - diffToMonday);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  return { weekStart, weekEnd };
};

const computeDurationHours = (startsAt, endsAt) => {
  return (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / (60 * 60 * 1000);
};

const getAssignedShifts = async (userId, excludeAssignmentId = null) => {
  const filter = { user_id: userId, status: "assigned" };
  if (excludeAssignmentId) {
    filter._id = { $ne: excludeAssignmentId };
  }

  const assignments = await ShiftAssignment.find(filter).populate({
    path: "shift_id",
    select: "starts_at_utc ends_at_utc location_id",
  });

  return assignments.map((entry) => entry.shift_id).filter(Boolean);
};

const evaluateAssignmentRules = async ({ user, shift, excludeAssignmentId = null }) => {
  const violations = [];

  if (user.status !== "active" || user.is_active === false) {
    violations.push({
      rule: "user_status",
      message: `Staff is ${user.status || "inactive"} and cannot be assigned`,
    });
  }

  if (user.role_id?.role !== "staff") {
    violations.push({
      rule: "staff_role",
      message: "Only users with staff role can be assigned",
    });
  }

  const [hasSkill, hasCertification, availability, preference, existingShifts] =
    await Promise.all([
      StaffSkill.exists({
        user_id: user._id,
        skill_id: shift.required_skill_id,
        is_active: true,
      }),
      StaffLocationCertification.exists({
        user_id: user._id,
        location_id: shift.location_id,
        is_active: true,
      }),
      Availability.findOne({ user_id: user._id }),
      StaffPreference.findOne({ user_id: user._id }),
      getAssignedShifts(user._id, excludeAssignmentId),
    ]);

  if (!hasSkill) {
    violations.push({
      rule: "required_skill",
      message: "Staff does not have the required skill for this shift",
    });
  }

  if (!hasCertification) {
    violations.push({
      rule: "location_certification",
      message: "Staff is not certified for this location",
    });
  }

  const availabilityViolation = evaluateAvailability(availability, shift);
  if (availabilityViolation) {
    violations.push(availabilityViolation);
  }

  const shiftStart = new Date(shift.starts_at_utc).getTime();
  const shiftEnd = new Date(shift.ends_at_utc).getTime();

  for (const existing of existingShifts) {
    const existingStart = new Date(existing.starts_at_utc).getTime();
    const existingEnd = new Date(existing.ends_at_utc).getTime();

    if (shiftStart < existingEnd && shiftEnd > existingStart) {
      violations.push({
        rule: "double_booking",
        message: `Overlap with existing shift ${existing._id}`,
      });
      continue;
    }

    let gapMs = null;
    if (existingEnd <= shiftStart) {
      gapMs = shiftStart - existingEnd;
    } else if (shiftEnd <= existingStart) {
      gapMs = existingStart - shiftEnd;
    }

    if (gapMs !== null && gapMs < TEN_HOURS_MS) {
      violations.push({
        rule: "minimum_rest",
        message: `Minimum 10 hours rest violated (only ${Math.floor(
          gapMs / (60 * 60 * 1000)
        )}h gap)`,
      });
    }
  }

  const { weekStart, weekEnd } = getUtcWeekRange(shift.starts_at_utc);
  const weeklyHours = existingShifts.reduce((sum, existing) => {
    const start = new Date(existing.starts_at_utc);
    if (start >= weekStart && start < weekEnd) {
      return sum + computeDurationHours(existing.starts_at_utc, existing.ends_at_utc);
    }
    return sum;
  }, 0);
  const projectedHours =
    weeklyHours + computeDurationHours(shift.starts_at_utc, shift.ends_at_utc);
  const weeklyHoursLimit = preference?.max_hours_per_week || DEFAULT_WEEKLY_HOURS_LIMIT;
  if (projectedHours > weeklyHoursLimit) {
    violations.push({
      rule: "weekly_overtime",
      message: `Projected weekly hours would be ${projectedHours.toFixed(
        1
      )}, above limit ${weeklyHoursLimit}`,
    });
  }

  return violations;
};

const buildAlternatives = async ({ shift, excludedUserIds = [], limit = 3 }) => {
  const users = await User.find({
    _id: { $nin: excludedUserIds },
    status: "active",
    is_active: true,
  }).populate({ path: "role_id", select: "role" });

  const staffCandidates = users.filter((item) => item.role_id?.role === "staff");
  const suggestions = [];

  for (const candidate of staffCandidates) {
    const violations = await evaluateAssignmentRules({ user: candidate, shift });
    if (violations.length === 0) {
      suggestions.push({
        user_id: candidate._id,
        name: candidate.name || candidate.phone_number,
      });
    }
    if (suggestions.length >= limit) {
      break;
    }
  }

  return suggestions;
};

const acquireUserAssignmentLock = async (userId) => {
  const now = new Date();
  const lockUntil = new Date(now.getTime() + ASSIGNMENT_LOCK_MS);
  const lockedUser = await User.findOneAndUpdate(
    {
      _id: userId,
      $or: [{ assignment_lock_until: { $exists: false } }, { assignment_lock_until: null }, { assignment_lock_until: { $lte: now } }],
    },
    { $set: { assignment_lock_until: lockUntil } },
    { new: true }
  );
  return Boolean(lockedUser);
};

const releaseUserAssignmentLock = async (userId) => {
  await User.findByIdAndUpdate(userId, { $set: { assignment_lock_until: null } });
};

const getCurrentUser = async (userId) =>
  User.findById(userId).populate({ path: "role_id", select: "role" });

export const getCoverageSuggestions = asyncHandler(async (req, res) => {
  const shift = await Shift.findById(req.params.shift_id).select(
    "location_id required_skill_id location_timezone starts_at_utc ends_at_utc"
  );
  if (!shift) {
    return res.status(404).json({ success: false, message: "Shift not found" });
  }

  if (!hasLocationAccess(req.authUser, shift.location_id)) {
    return res.status(403).json({
      success: false,
      message: "Managers can only access coverage for assigned locations",
    });
  }

  const existingAssignments = await ShiftAssignment.find({
    shift_id: shift._id,
    status: "assigned",
  }).select("user_id");
  const excludedUserIds = existingAssignments.map((item) => item.user_id);

  const suggestions = await buildAlternatives({
    shift,
    excludedUserIds,
    limit: Number(req.query.limit || 5),
  });

  return res.json({ success: true, shift_id: shift._id, suggestions });
});

export const createAssignment = asyncHandler(async (req, res) => {
  const { shift_id, user_id, manager_override } = req.body;

  if (!shift_id || !user_id) {
    return res.status(400).json({
      success: false,
      message: "shift_id and user_id are required",
    });
  }

  const [shift, assignedUser] = await Promise.all([
    Shift.findById(shift_id).select(
      "schedule_id location_id required_skill_id location_timezone starts_at_utc ends_at_utc headcount_required"
    ),
    User.findById(user_id).populate({ path: "role_id", select: "role" }),
  ]);

  if (!shift) {
    return res.status(404).json({ success: false, message: "Shift not found" });
  }
  if (!assignedUser) {
    return res.status(404).json({ success: false, message: "Assigned user not found" });
  }

  if (!hasLocationAccess(req.authUser, shift.location_id)) {
    return res.status(403).json({
      success: false,
      message: "Managers can only manage assignments for assigned locations",
    });
  }

  const schedule = await Schedule.findById(shift.schedule_id).select(
    "status edit_cutoff_hours"
  );

  if (!schedule) {
    return res.status(404).json({ success: false, message: "Schedule not found" });
  }

  if (
    schedule.status === "published" &&
    isShiftLockedByCutoff(shift.starts_at_utc, schedule.edit_cutoff_hours ?? 48)
  ) {
    return res.status(409).json({
      success: false,
      message: "Cannot assign staff because schedule cutoff time has passed",
    });
  }

  const lockAcquired = await acquireUserAssignmentLock(assignedUser._id);
  if (!lockAcquired) {
    return res.status(409).json({
      success: false,
      message:
        "Another assignment operation is in progress for this staff member. Please retry.",
    });
  }

  try {
    const assignedCount = await ShiftAssignment.countDocuments({
      shift_id,
      status: "assigned",
    });

    if (assignedCount >= shift.headcount_required) {
      return res.status(409).json({
        success: false,
        message: "Cannot assign staff. Shift headcount is already full",
      });
    }

    const violations = await evaluateAssignmentRules({ user: assignedUser, shift });
    if (violations.length > 0) {
      const suggestions = await buildAlternatives({
        shift,
        excludedUserIds: [assignedUser._id],
        limit: 3,
      });

      return res.status(409).json({
        success: false,
        message: "Assignment constraint violation",
        violations,
        suggestions,
      });
    }

    const assignment = await ShiftAssignment.create({
      shift_id,
      user_id,
      assigned_by: req.userId,
      source: "manual",
      status: "assigned",
      manager_override,
      activity_log: [
        {
          type: "assigned",
          actor_user_id: req.userId,
          note: "Staff assigned to shift",
          at_utc: new Date(),
        },
      ],
    });

    const populated = await ShiftAssignment.findById(assignment._id).populate(
      "shift_id user_id assigned_by manager_override.approved_by"
    );

    return res.status(201).json({ success: true, data: populated });
  } finally {
    await releaseUserAssignmentLock(assignedUser._id);
  }
});

export const getAssignments = asyncHandler(async (req, res) => {
  const currentUser = await getCurrentUser(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const isManager = currentUser.role_id?.role === "manager";
  const shiftFilter = isManager
    ? { location_id: { $in: currentUser.location_ids || [] } }
    : {};
  const shiftIds = isManager
    ? (await Shift.find(shiftFilter).select("_id")).map((item) => item._id)
    : null;

  const assignmentFilter = isManager ? { shift_id: { $in: shiftIds } } : {};

  const assignments = await ShiftAssignment.find(assignmentFilter)
    .populate("shift_id user_id assigned_by manager_override.approved_by")
    .sort({ createdAt: -1 });

  return res.json({ success: true, count: assignments.length, data: assignments });
});

export const getAssignmentById = asyncHandler(async (req, res) => {
  const assignment = await ShiftAssignment.findById(req.params.id).populate(
    "shift_id user_id assigned_by manager_override.approved_by"
  );

  if (!assignment) {
    return res.status(404).json({ success: false, message: "Assignment not found" });
  }

  const currentUser = await getCurrentUser(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  if (
    currentUser.role_id?.role === "manager" &&
    !hasLocationAccess(currentUser, assignment.shift_id?.location_id)
  ) {
    return res.status(403).json({
      success: false,
      message: "Managers can only access assignments for assigned locations",
    });
  }

  return res.json({ success: true, data: assignment });
});

export const updateAssignment = asyncHandler(async (req, res) => {
  const assignment = await ShiftAssignment.findById(req.params.id);
  if (!assignment) {
    return res.status(404).json({ success: false, message: "Assignment not found" });
  }

  const shift = await Shift.findById(assignment.shift_id).select(
    "schedule_id location_id required_skill_id location_timezone starts_at_utc ends_at_utc"
  );
  if (!shift) {
    return res.status(404).json({ success: false, message: "Shift not found" });
  }

  if (!hasLocationAccess(req.authUser, shift.location_id)) {
    return res.status(403).json({
      success: false,
      message: "Managers can only manage assignments for assigned locations",
    });
  }

  const schedule = await Schedule.findById(shift.schedule_id).select(
    "status edit_cutoff_hours"
  );
  if (!schedule) {
    return res.status(404).json({ success: false, message: "Schedule not found" });
  }

  if (
    schedule.status === "published" &&
    isShiftLockedByCutoff(shift.starts_at_utc, schedule.edit_cutoff_hours ?? 48)
  ) {
    return res.status(409).json({
      success: false,
      message: "Assignment cannot be edited because schedule cutoff time has passed",
    });
  }

  const updateData = { ...req.body };
  delete updateData.assigned_by;

  const nextUserId = updateData.user_id || assignment.user_id;
  const assignedUser = await User.findById(nextUserId).populate({
    path: "role_id",
    select: "role",
  });
  if (!assignedUser) {
    return res.status(404).json({ success: false, message: "Assigned user not found" });
  }

  const lockAcquired = await acquireUserAssignmentLock(assignedUser._id);
  if (!lockAcquired) {
    return res.status(409).json({
      success: false,
      message:
        "Another assignment operation is in progress for this staff member. Please retry.",
    });
  }

  try {
    const violations = await evaluateAssignmentRules({
      user: assignedUser,
      shift,
      excludeAssignmentId: assignment._id,
    });

    if (violations.length > 0) {
      const suggestions = await buildAlternatives({
        shift,
        excludedUserIds: [assignedUser._id],
        limit: 3,
      });

      return res.status(409).json({
        success: false,
        message: "Assignment constraint violation",
        violations,
        suggestions,
      });
    }

    const updated = await ShiftAssignment.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true,
        runValidators: true,
      }
    ).populate("shift_id user_id assigned_by manager_override.approved_by");

    return res.json({ success: true, data: updated });
  } finally {
    await releaseUserAssignmentLock(assignedUser._id);
  }
});

export const deleteAssignment = asyncHandler(async (req, res) => {
  const assignment = await ShiftAssignment.findById(req.params.id);
  if (!assignment) {
    return res.status(404).json({ success: false, message: "Assignment not found" });
  }

  const shift = await Shift.findById(assignment.shift_id).select(
    "schedule_id location_id starts_at_utc"
  );
  if (!shift) {
    return res.status(404).json({ success: false, message: "Shift not found" });
  }

  if (!hasLocationAccess(req.authUser, shift.location_id)) {
    return res.status(403).json({
      success: false,
      message: "Managers can only manage assignments for assigned locations",
    });
  }

  const schedule = await Schedule.findById(shift.schedule_id).select(
    "status edit_cutoff_hours"
  );
  if (!schedule) {
    return res.status(404).json({ success: false, message: "Schedule not found" });
  }

  if (
    schedule.status === "published" &&
    isShiftLockedByCutoff(shift.starts_at_utc, schedule.edit_cutoff_hours ?? 48)
  ) {
    return res.status(409).json({
      success: false,
      message: "Assignment cannot be deleted because schedule cutoff time has passed",
    });
  }

  await ShiftAssignment.findByIdAndDelete(req.params.id);
  return res.json({ success: true, message: "Assignment deleted" });
});

export const clockInAssignment = asyncHandler(async (req, res) => {
  const assignment = await ShiftAssignment.findById(req.params.id).populate({
    path: "shift_id",
    select: "location_id starts_at_utc ends_at_utc",
  });

  if (!assignment || !assignment.shift_id) {
    return res.status(404).json({ success: false, message: "Assignment not found" });
  }

  const currentUser = await getCurrentUser(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const isAssignee = assignment.user_id.toString() === req.userId.toString();
  const isManagerWithAccess =
    currentUser.role_id?.role === "manager" &&
    hasLocationAccess(currentUser, assignment.shift_id.location_id);
  if (!isAssignee && !isManagerWithAccess) {
    return res.status(403).json({
      success: false,
      message: "Not authorized to clock in for this assignment",
    });
  }

  const lastSession = assignment.work_sessions[assignment.work_sessions.length - 1];
  if (lastSession && !lastSession.clock_out_utc) {
    return res.status(409).json({
      success: false,
      message: "Cannot clock in. There is already an active work session.",
    });
  }

  const eventTime = new Date();
  assignment.work_sessions.push({ clock_in_utc: eventTime });
  assignment.activity_log.push({
    type: "clock_in",
    actor_user_id: req.userId,
    at_utc: eventTime,
    note: req.body?.note || "Clock in",
  });
  await assignment.save();

  await ClockEvent.create({
    user_id: assignment.user_id,
    shift_id: assignment.shift_id._id,
    location_id: assignment.shift_id.location_id,
    type: "clock_in",
    event_at_utc: eventTime,
    source: isAssignee ? "staff" : "manager",
  });

  return res.json({ success: true, message: "Clocked in successfully", data: assignment });
});

export const clockOutAssignment = asyncHandler(async (req, res) => {
  const assignment = await ShiftAssignment.findById(req.params.id).populate({
    path: "shift_id",
    select: "location_id starts_at_utc ends_at_utc",
  });

  if (!assignment || !assignment.shift_id) {
    return res.status(404).json({ success: false, message: "Assignment not found" });
  }

  const currentUser = await getCurrentUser(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const isAssignee = assignment.user_id.toString() === req.userId.toString();
  const isManagerWithAccess =
    currentUser.role_id?.role === "manager" &&
    hasLocationAccess(currentUser, assignment.shift_id.location_id);
  if (!isAssignee && !isManagerWithAccess) {
    return res.status(403).json({
      success: false,
      message: "Not authorized to clock out for this assignment",
    });
  }

  const lastSession = assignment.work_sessions[assignment.work_sessions.length - 1];
  if (!lastSession || lastSession.clock_out_utc) {
    return res.status(409).json({
      success: false,
      message: "Cannot clock out. No active work session found.",
    });
  }

  const eventTime = new Date();
  lastSession.clock_out_utc = eventTime;
  lastSession.duration_minutes = Math.max(
    0,
    Math.round((eventTime.getTime() - new Date(lastSession.clock_in_utc).getTime()) / 60000)
  );
  assignment.activity_log.push({
    type: "clock_out",
    actor_user_id: req.userId,
    at_utc: eventTime,
    note: req.body?.note || "Clock out",
  });
  await assignment.save();

  await ClockEvent.create({
    user_id: assignment.user_id,
    shift_id: assignment.shift_id._id,
    location_id: assignment.shift_id.location_id,
    type: "clock_out",
    event_at_utc: eventTime,
    source: isAssignee ? "staff" : "manager",
  });

  return res.json({ success: true, message: "Clocked out successfully", data: assignment });
});
