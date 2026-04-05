import ShiftAssignment from "../models/ShiftAssignment.js";
import Shift from "../models/Shift.js";
import Schedule from "../models/Schedule.js";
import User from "../models/User.js";
import StaffSkill from "../models/StaffSkill.js";
import StaffLocationCertification from "../models/StaffLocationCertification.js";
import StaffPreference from "../models/StaffPreference.js";
import Availability from "../models/Availability.js";
import ClockEvent from "../models/ClockEvent.js";
import SwapRequest from "../models/SwapRequest.js";
import asyncHandler from "../utils/asyncHandler.js";
import { sendUserNotification } from "../services/notificationEvents.service.js";
import {
  CANONICAL_TIMEZONES,
  normalizeTimezone as normalizeSupportedTimezone,
  toIanaTimezone,
} from "../utils/timezone.js";

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

const normalizeTimezone = (timezone) => {
  return normalizeSupportedTimezone(timezone, {
    fallback: CANONICAL_TIMEZONES.EAST_AFRICA,
    restrictToAllowed: true,
  });
};

const getLocalParts = (date, timezone) => {
  const safeTimezone = normalizeTimezone(timezone);
  const ianaTimezone = toIanaTimezone(safeTimezone);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: ianaTimezone,
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

const weekdayLabel = (weekday) => {
  const names = {
    0: "Sunday",
    1: "Monday",
    2: "Tuesday",
    3: "Wednesday",
    4: "Thursday",
    5: "Friday",
    6: "Saturday",
  };
  return names[weekday] || String(weekday);
};

const previousWeekday = (weekday) => (weekday + 6) % 7;

const overlapByMinutes = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

const containsByMinutes = (outerStart, outerEnd, innerStart, innerEnd) =>
  outerStart <= innerStart && outerEnd >= innerEnd;

const matchesEntryLocation = (entry, locationId) =>
  !entry.location_id || entry.location_id.toString() === locationId.toString();

const matchesNormalizedTimezone = (entry, timezone) =>
  normalizeTimezone(entry?.timezone) === normalizeTimezone(timezone);

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
      !matchesNormalizedTimezone(entry, timezone)
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
      !matchesNormalizedTimezone(entry, timezone)
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
    if (!matchesEntryLocation(window, locationId) || !matchesNormalizedTimezone(window, timezone)) {
      return false;
    }

    const windowStart = toMinutes(window.start_time_local);
    const windowEnd = toMinutes(window.end_time_local);
    if (windowStart === null || windowEnd === null) {
      return false;
    }

    // Same-day availability window.
    if (window.weekday === weekday && windowEnd > windowStart) {
      return containsByMinutes(windowStart, windowEnd, segStart, segEnd);
    }

    // Overnight recurring window, e.g. 22:00-06:00.
    if (windowEnd <= windowStart) {
      // Coverage on the window's own day: start -> 24:00.
      if (window.weekday === weekday) {
        return containsByMinutes(windowStart, 1440, segStart, segEnd);
      }
      // Carry-over coverage on next day: 00:00 -> end.
      if (window.weekday === previousWeekday(weekday)) {
        return containsByMinutes(0, windowEnd, segStart, segEnd);
      }
    }

    return false;
  });
};

const mergeIntervals = (intervals) => {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const prev = merged[merged.length - 1];
    if (current.start <= prev.end) {
      prev.end = Math.max(prev.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
};

const getRecurringCoverageIntervals = (
  recurringWindows,
  weekday,
  segStart,
  segEnd,
  locationId,
  timezone
) => {
  const intervals = [];
  recurringWindows.forEach((window) => {
    if (!matchesEntryLocation(window, locationId) || !matchesNormalizedTimezone(window, timezone)) {
      return;
    }

    const windowStart = toMinutes(window.start_time_local);
    const windowEnd = toMinutes(window.end_time_local);
    if (windowStart === null || windowEnd === null) return;

    // Same-day window.
    if (window.weekday === weekday && windowEnd > windowStart) {
      const start = Math.max(segStart, windowStart);
      const end = Math.min(segEnd, windowEnd);
      if (end > start) intervals.push({ start, end });
      return;
    }

    if (windowEnd <= windowStart) {
      // Overnight recurring window contributes current-day coverage from start -> 24:00.
      if (window.weekday === weekday) {
        const start = Math.max(segStart, windowStart);
        const end = Math.min(segEnd, 1440);
        if (end > start) intervals.push({ start, end });
        return;
      }

      // Carry-over segment from previous weekday overnight window: 00:00 -> end.
      if (window.weekday === previousWeekday(weekday)) {
        const start = Math.max(segStart, 0);
        const end = Math.min(segEnd, windowEnd);
        if (end > start) intervals.push({ start, end });
      }
    }
  });

  return mergeIntervals(intervals);
};

const getUncoveredIntervals = (segStart, segEnd, coveredIntervals) => {
  const uncovered = [];
  let cursor = segStart;
  coveredIntervals.forEach((item) => {
    if (item.start > cursor) {
      uncovered.push({ start: cursor, end: item.start });
    }
    cursor = Math.max(cursor, item.end);
  });
  if (cursor < segEnd) {
    uncovered.push({ start: cursor, end: segEnd });
  }
  return uncovered;
};

const minutesToLabel = (minutes) => {
  if (minutes === 1440) return "24:00";
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
};

const formatUncoveredSegments = (weekday, date, uncovered) =>
  uncovered.map(
    (gap) => `${weekdayLabel(weekday)} ${date} ${minutesToLabel(gap.start)}-${minutesToLabel(gap.end)}`
  );

const evaluateAvailability = (availability, shift) => {
  const shiftTimezone = normalizeTimezone(shift.location_timezone);
  const start = getLocalParts(shift.starts_at_utc, shiftTimezone);
  const end = getLocalParts(shift.ends_at_utc, shiftTimezone);
  const localShiftLabel = `${start.date} ${start.time} -> ${end.date} ${end.time} (${shiftTimezone})`;

  if (!availability) {
    return {
      rule: "availability_hours",
      message: `Staff has no availability profile configured for shift ${localShiftLabel}`,
    };
  }
  const shiftStartMinutes = toMinutes(start.time);
  const shiftEndMinutes = toMinutes(end.time);
  if (shiftStartMinutes === null || shiftEndMinutes === null) {
    return {
      rule: "availability_hours",
      message: `Could not interpret local shift time for availability validation: ${localShiftLabel}`,
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
        shiftTimezone
      )
    ) {
      return {
        rule: "availability_hours",
        message: `Shift ${localShiftLabel} violates availability exception: marked unavailable for ${start.date} ${start.time}-${end.time}`,
      };
    }

    if (
      hasAvailableException(
        exceptions,
        start.date,
        shiftStartMinutes,
        shiftEndMinutes,
        shift.location_id,
        shiftTimezone
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
        shiftTimezone
      )
    ) {
      const coveredIntervals = getRecurringCoverageIntervals(
        recurring,
        start.weekday,
        shiftStartMinutes,
        shiftEndMinutes,
        shift.location_id,
        shiftTimezone
      );
      const uncovered = getUncoveredIntervals(
        shiftStartMinutes,
        shiftEndMinutes,
        coveredIntervals
      );

      return {
        rule: "availability_hours",
        message: `Shift ${localShiftLabel} is outside recurring availability coverage for gap(s): ${formatUncoveredSegments(
          start.weekday,
          start.date,
          uncovered
        ).join("; ")}`,
      };
    }

    return null;
  }

  // Overnight shift handling: validate start-day and end-day segments.
  const startSeg = { start: shiftStartMinutes, end: 1440 };
  const endSeg = { start: 0, end: shiftEndMinutes };
  const hasEndSegment = endSeg.end > endSeg.start;

  if (
    hasUnavailableException(
      exceptions,
      start.date,
      startSeg.start,
      startSeg.end,
      shift.location_id,
      shiftTimezone
    ) ||
    (hasEndSegment &&
      hasUnavailableException(
        exceptions,
        end.date,
        endSeg.start,
        endSeg.end,
        shift.location_id,
        shiftTimezone
      ))
  ) {
    return {
      rule: "availability_hours",
      message: `Shift ${localShiftLabel} crosses unavailable exception coverage (${start.date} ${start.time}-24:00 or ${end.date} 00:00-${end.time})`,
    };
  }

  const coveredByExceptions =
    hasAvailableException(
      exceptions,
      start.date,
      startSeg.start,
      startSeg.end,
      shift.location_id,
      shiftTimezone
    ) &&
    (!hasEndSegment ||
      hasAvailableException(
        exceptions,
        end.date,
        endSeg.start,
        endSeg.end,
        shift.location_id,
        shiftTimezone
      ));

  if (coveredByExceptions) {
    return null;
  }

  const startCovered = hasRecurringCoverage(
    recurring,
    start.weekday,
    startSeg.start,
    startSeg.end,
    shift.location_id,
    shiftTimezone
  );
  const endCovered = hasRecurringCoverage(
    recurring,
    end.weekday,
    endSeg.start,
    endSeg.end,
    shift.location_id,
    shiftTimezone
  );
  const normalizedEndCovered = hasEndSegment ? endCovered : true;

  if (!startCovered || !normalizedEndCovered) {
    const missingSegments = [];
    if (!startCovered) {
      const startCoveredIntervals = getRecurringCoverageIntervals(
        recurring,
        start.weekday,
        startSeg.start,
        startSeg.end,
        shift.location_id,
        shiftTimezone
      );
      const startUncovered = getUncoveredIntervals(
        startSeg.start,
        startSeg.end,
        startCoveredIntervals
      );
      missingSegments.push(...formatUncoveredSegments(start.weekday, start.date, startUncovered));
    }
    if (hasEndSegment && !normalizedEndCovered) {
      const endCoveredIntervals = getRecurringCoverageIntervals(
        recurring,
        end.weekday,
        endSeg.start,
        endSeg.end,
        shift.location_id,
        shiftTimezone
      );
      const endUncovered = getUncoveredIntervals(
        endSeg.start,
        endSeg.end,
        endCoveredIntervals
      );
      missingSegments.push(...formatUncoveredSegments(end.weekday, end.date, endUncovered));
    }

    return {
      rule: "availability_hours",
      message: `Shift ${localShiftLabel} is outside recurring availability coverage for segment(s): ${missingSegments.join(
        "; "
      )}`,
    };
  }

  return null;
};

const getLocalWeekBucket = (dateValue, timezone) => {
  const local = getLocalParts(dateValue, timezone);
  const [year, month, day] = local.date.split("-").map(Number);
  const localDate = new Date(Date.UTC(year, month - 1, day));
  const diffToMonday = (local.weekday + 6) % 7;
  localDate.setUTCDate(localDate.getUTCDate() - diffToMonday);
  return localDate.toISOString().slice(0, 10);
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

export const evaluateAssignmentRules = async ({ user, shift, excludeAssignmentId = null }) => {
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

  const shiftTimezone = normalizeTimezone(shift.location_timezone);
  const targetWeekBucket = getLocalWeekBucket(shift.starts_at_utc, shiftTimezone);
  const weeklyHours = existingShifts.reduce((sum, existing) => {
    const existingWeekBucket = getLocalWeekBucket(existing.starts_at_utc, shiftTimezone);
    if (existingWeekBucket === targetWeekBucket) {
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

const getLatestWorkSession = (assignment) =>
  assignment.work_sessions[assignment.work_sessions.length - 1];

const toIdString = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value._id) return value._id.toString();
  return value.toString();
};

const getRole = (user) => user?.role_id?.role || null;

const toClockState = (workStatus) => {
  if (workStatus === "clocked_in") return "clocked_in";
  if (workStatus === "paused") return "paused";
  if (workStatus === "clocked_out") return "clocked_out";
  return "not_started";
};

const calculateTrackingMinutes = (assignment, now = new Date()) => {
  const sessions = assignment.work_sessions || [];
  let totalWorkedMinutes = 0;
  let activeSessionWorkedMinutes = 0;

  sessions.forEach((session) => {
    if (!session.clock_in_utc) return;

    const start = new Date(session.clock_in_utc);
    if (Number.isNaN(start.getTime())) return;

    const hasClockOut = Boolean(session.clock_out_utc);
    const end = hasClockOut ? new Date(session.clock_out_utc) : now;
    if (Number.isNaN(end.getTime()) || end <= start) return;

    const grossMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
    const pausedMinutes = Math.max(0, Number(session.paused_minutes || 0));
    let workedMinutes = Math.max(0, grossMinutes - pausedMinutes);

    if (!hasClockOut && assignment.active_pause?.started_at_utc) {
      const pauseStart = new Date(assignment.active_pause.started_at_utc);
      if (!Number.isNaN(pauseStart.getTime())) {
        const extraPaused = Math.max(
          0,
          Math.round((now.getTime() - pauseStart.getTime()) / 60000)
        );
        workedMinutes = Math.max(0, workedMinutes - extraPaused);
      }
    }

    if (hasClockOut) {
      workedMinutes = Math.max(0, Number(session.duration_minutes ?? workedMinutes));
    }

    totalWorkedMinutes += workedMinutes;
    if (!hasClockOut) {
      activeSessionWorkedMinutes = workedMinutes;
    }
  });

  return { totalWorkedMinutes, activeSessionWorkedMinutes };
};

const toTrackingResponse = (assignment, now = new Date()) => {
  const shift = assignment.shift_id || {};
  const shiftStart = shift?.starts_at_utc ? new Date(shift.starts_at_utc) : null;
  const shiftEnd = shift?.ends_at_utc ? new Date(shift.ends_at_utc) : null;
  const clockState = toClockState(assignment.work_status);
  const { totalWorkedMinutes, activeSessionWorkedMinutes } = calculateTrackingMinutes(
    assignment,
    now
  );
  const hasValidShiftStart = shiftStart && !Number.isNaN(shiftStart.getTime());
  const hasValidShiftEnd = shiftEnd && !Number.isNaN(shiftEnd.getTime());

  return {
    assignment_id: assignment._id,
    status: assignment.status,
    clock_state: clockState,
    can_clock_in: assignment.status === "assigned" && clockState === "not_started",
    can_pause: assignment.status === "assigned" && clockState === "clocked_in",
    can_resume: assignment.status === "assigned" && clockState === "paused",
    can_clock_out:
      assignment.status === "assigned" &&
      (clockState === "clocked_in" || clockState === "paused"),
    is_shift_active:
      Boolean(hasValidShiftStart && hasValidShiftEnd) &&
      now >= shiftStart &&
      now <= shiftEnd,
    is_shift_upcoming: Boolean(hasValidShiftStart) && shiftStart > now,
    total_worked_minutes: totalWorkedMinutes,
    active_session_worked_minutes: activeSessionWorkedMinutes,
    shift: shift
      ? {
          id: toIdString(shift._id || shift),
          starts_at_utc: shift.starts_at_utc || null,
          ends_at_utc: shift.ends_at_utc || null,
          timezone: shift.location_timezone || null,
          status: shift.status || null,
          location: shift.location_id
            ? {
                id: toIdString(shift.location_id),
                name: shift.location_id?.name || null,
              }
            : null,
          required_skill: shift.required_skill_id
            ? {
                id: toIdString(shift.required_skill_id),
                name: shift.required_skill_id?.name || null,
                code: shift.required_skill_id?.code || null,
              }
            : null,
        }
      : null,
    last_activity: assignment.activity_log?.[assignment.activity_log.length - 1] || null,
  };
};

const toDateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getRangeBounds = ({ from, to, period = "week" }) => {
  const now = new Date();
  const toDate = toDateOrNull(to) || now;
  const fromDate =
    toDateOrNull(from) ||
    new Date(toDate.getTime() - (period === "month" ? 30 : 7) * 24 * 60 * 60 * 1000);
  return { fromDate, toDate };
};

const overlapMinutes = (startA, endA, startB, endB) => {
  const start = Math.max(startA.getTime(), startB.getTime());
  const end = Math.min(endA.getTime(), endB.getTime());
  return end > start ? Math.round((end - start) / 60000) : 0;
};

const toWeekBucket = (dateValue) => {
  const date = new Date(dateValue);
  const day = date.getUTCDay(); // 0=Sun
  const diffToMonday = (day + 6) % 7;
  const weekStart = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  weekStart.setUTCDate(weekStart.getUTCDate() - diffToMonday);
  return weekStart.toISOString().slice(0, 10);
};

const toMonthBucket = (dateValue) => {
  const date = new Date(dateValue);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}`;
};

const canManagerAccessShift = (manager, shift) =>
  Boolean(
    shift?.location_id &&
      (manager.location_ids || []).some(
        (id) => id.toString() === shift.location_id.toString()
      )
  );

export const getWorkedHoursAnalytics = asyncHandler(async (req, res) => {
  const currentUser = await getCurrentUser(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const role = currentUser.role_id?.role;
  const requestedUserId = req.query.user_id || null;
  const period = req.query.period === "month" ? "month" : "week";
  const { fromDate, toDate } = getRangeBounds({
    from: req.query.from,
    to: req.query.to,
    period,
  });

  if (fromDate >= toDate) {
    return res.status(400).json({
      success: false,
      message: "from must be earlier than to",
    });
  }

  if (role === "staff" && requestedUserId && requestedUserId !== currentUser._id.toString()) {
    return res.status(403).json({
      success: false,
      message: "Staff can only access their own worked-hours data",
    });
  }

  const filter = { status: "assigned" };
  if (requestedUserId) {
    filter.user_id = requestedUserId;
  } else if (role === "staff") {
    filter.user_id = currentUser._id;
  }

  const assignments = await ShiftAssignment.find(filter)
    .populate({
      path: "shift_id",
      select: "location_id starts_at_utc ends_at_utc location_timezone",
      match: {
        starts_at_utc: { $lt: toDate },
        ends_at_utc: { $gt: fromDate },
      },
    })
    .populate({
      path: "user_id",
      select: "name email phone_number role_id location_ids",
      populate: { path: "role_id", select: "role" },
    });

  const visibleAssignments = assignments.filter((assignment) => {
    if (!assignment.shift_id || !assignment.user_id) return false;
    if (role === "admin") return true;
    if (role === "manager") return canManagerAccessShift(currentUser, assignment.shift_id);
    return assignment.user_id._id.toString() === currentUser._id.toString();
  });

  const byUser = new Map();

  visibleAssignments.forEach((assignment) => {
    const user = assignment.user_id;
    const userKey = user._id.toString();
    if (!byUser.has(userKey)) {
      byUser.set(userKey, {
        user_id: user._id,
        name: user.name || user.email || user.phone_number || "Unknown",
        total_worked_minutes: 0,
        buckets: {},
      });
    }

    const target = byUser.get(userKey);
    (assignment.work_sessions || []).forEach((session) => {
      if (!session.clock_in_utc || !session.clock_out_utc) return;
      const sessionStart = new Date(session.clock_in_utc);
      const sessionEnd = new Date(session.clock_out_utc);
      const grossMinutes = overlapMinutes(fromDate, toDate, sessionStart, sessionEnd);
      if (grossMinutes <= 0) return;
      const sessionWindowStart = new Date(
        Math.max(fromDate.getTime(), sessionStart.getTime())
      );
      const sessionWindowEnd = new Date(Math.min(toDate.getTime(), sessionEnd.getTime()));

      const pausedMinutes = (assignment.pause_history || []).reduce((sum, pause) => {
        if (!pause.started_at_utc || !pause.ended_at_utc) return sum;
        const pauseStart = new Date(pause.started_at_utc);
        const pauseEnd = new Date(pause.ended_at_utc);
        return sum + overlapMinutes(sessionWindowStart, sessionWindowEnd, pauseStart, pauseEnd);
      }, 0);
      const minutes = Math.max(0, grossMinutes - pausedMinutes);
      if (minutes <= 0) return;

      const bucketKey =
        period === "month" ? toMonthBucket(sessionStart) : toWeekBucket(sessionStart);
      target.total_worked_minutes += minutes;
      target.buckets[bucketKey] = (target.buckets[bucketKey] || 0) + minutes;
    });
  });

  const employees = Array.from(byUser.values())
    .map((item) => ({
      ...item,
      total_worked_hours: Number((item.total_worked_minutes / 60).toFixed(2)),
      buckets: Object.entries(item.buckets)
        .sort(([a], [b]) => (a > b ? 1 : -1))
        .map(([bucket, minutes]) => ({
          bucket,
          worked_minutes: minutes,
          worked_hours: Number((minutes / 60).toFixed(2)),
        })),
    }))
    .sort((a, b) => b.total_worked_minutes - a.total_worked_minutes);

  return res.json({
    success: true,
    period,
    from: fromDate,
    to: toDate,
    count: employees.length,
    data: employees,
  });
});

export const getAssignmentOperationalInsights = asyncHandler(async (req, res) => {
  const currentUser = await getCurrentUser(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  if (!["admin", "manager"].includes(currentUser.role_id?.role)) {
    return res.status(403).json({
      success: false,
      message: "Only admin or manager can access assignment insights",
    });
  }

  const { shift_id, user_id } = req.query;
  const { fromDate, toDate } = getRangeBounds({
    from: req.query.from,
    to: req.query.to,
    period: "week",
  });

  let shift = null;
  if (shift_id) {
    shift = await Shift.findById(shift_id).select(
      "location_id required_skill_id location_timezone starts_at_utc ends_at_utc"
    );
    if (!shift) {
      return res.status(404).json({ success: false, message: "Shift not found" });
    }
    if (
      currentUser.role_id?.role === "manager" &&
      !hasLocationAccess(currentUser, shift.location_id)
    ) {
      return res.status(403).json({
        success: false,
        message: "Managers can only access insights for assigned locations",
      });
    }
  }

  const sundayNightChaos = shift
    ? {
        shift_id: shift._id,
        fastest_path: [
          "Call GET /api/assignments/coverage/:shift_id to get immediate replacement candidates",
          "Assign one of the suggestions via POST /api/assignments",
          "If no candidates, relax constraints manually with manager override and capture reason",
        ],
        suggestions: await buildAlternatives({ shift, excludedUserIds: [], limit: 5 }),
      }
    : {
        fastest_path: [
          "Provide shift_id and call GET /api/assignments/coverage/:shift_id",
          "Use returned suggestions to assign the replacement quickly",
        ],
      };

  const scopeUsersFilter =
    currentUser.role_id?.role === "manager"
      ? { location_ids: { $in: currentUser.location_ids || [] } }
      : {};

  const scopedUsers = await User.find({
    ...scopeUsersFilter,
    status: "active",
    is_active: true,
  }).populate({ path: "role_id", select: "role" });

  const staffUsers = scopedUsers.filter((user) => user.role_id?.role === "staff");
  const staffIds = staffUsers.map((user) => user._id);

  const [preferences, weekAssignments] = await Promise.all([
    StaffPreference.find({ user_id: { $in: staffIds } }).select(
      "user_id max_hours_per_week desired_hours_per_week"
    ),
    ShiftAssignment.find({
      status: "assigned",
      user_id: { $in: staffIds },
    }).populate({
      path: "shift_id",
      select: "location_id starts_at_utc ends_at_utc",
      match: {
        starts_at_utc: { $lt: toDate },
        ends_at_utc: { $gt: fromDate },
        ...(currentUser.role_id?.role === "manager"
          ? { location_id: { $in: currentUser.location_ids || [] } }
          : {}),
      },
    }),
  ]);

  const prefByUser = new Map(
    preferences.map((pref) => [pref.user_id.toString(), pref])
  );
  const overtimeByUser = new Map();

  weekAssignments.forEach((entry) => {
    if (!entry.shift_id) return;
    const key = entry.user_id.toString();
    const current = overtimeByUser.get(key) || 0;
    overtimeByUser.set(
      key,
      current + computeDurationHours(entry.shift_id.starts_at_utc, entry.shift_id.ends_at_utc)
    );
  });

  const overtimeTrap = staffUsers
    .map((staff) => {
      const hours = overtimeByUser.get(staff._id.toString()) || 0;
      const pref = prefByUser.get(staff._id.toString());
      const max = pref?.max_hours_per_week || DEFAULT_WEEKLY_HOURS_LIMIT;
      return {
        user_id: staff._id,
        name: staff.name || staff.email || staff.phone_number,
        assigned_hours_in_window: Number(hours.toFixed(2)),
        max_hours_per_week: max,
        at_risk: hours > max,
      };
    })
    .filter((row) => row.at_risk)
    .sort((a, b) => b.assigned_hours_in_window - a.assigned_hours_in_window);

  const timezoneTangle = user_id
    ? await (async () => {
        const certs = await StaffLocationCertification.find({
          user_id,
          is_active: true,
        }).populate({ path: "location_id", select: "name timezone" });
        const availability = await Availability.findOne({ user_id });
        const locationTimezones = [
          ...new Set(certs.map((item) => item.location_id?.timezone).filter(Boolean)),
        ];
        const availabilityTimezones = [
          ...new Set(
            [
              ...(availability?.recurring_windows || []).map((item) => item.timezone),
              ...(availability?.exceptions || []).map((item) => item.timezone),
            ].filter(Boolean)
          ),
        ];
        return {
          user_id,
          certified_location_timezones: locationTimezones,
          availability_timezones: availabilityTimezones,
          note: "Availability windows are interpreted per shift location timezone; cross-timezone certifications can produce unexpected local-hour mismatches unless availability is set per timezone.",
        };
      })()
    : {
        note: "Provide user_id to inspect timezone compatibility across certifications and availability windows.",
      };

  const simultaneousAssignment = {
    protection: "per-user assignment lock",
    lock_window_ms: ASSIGNMENT_LOCK_MS,
    expected_behavior:
      "When two managers assign the same staff at once, one request acquires the lock and proceeds; the other gets a 409 conflict and must retry.",
  };

  const fairnessComplaint = {
    verification_path: [
      "GET /api/fairness-snapshots/saturday-night-distribution",
      "GET /api/fairness-snapshots/manager-analytics",
    ],
    note: "Use the distribution list plus fairness score to confirm whether premium shifts are balanced.",
  };

  const regretSwapQuery = { status: { $in: ["pending_peer_acceptance", "pending_manager_approval"] } };
  if (user_id) {
    regretSwapQuery.requester_id = user_id;
  }
  const pendingSwaps = await SwapRequest.find(regretSwapQuery).select(
    "_id requester_id status from_assignment_id requested_assignment_id expires_at"
  );

  const regretSwap = {
    pending_requests_count: pendingSwaps.length,
    cancellable_statuses: ["pending_peer_acceptance", "pending_manager_approval"],
    implication:
      "Requester can cancel while still pending. Once manager-approved/completed, cancellation is blocked by workflow state.",
    sample_requests: pendingSwaps.slice(0, 10),
  };

  return res.json({
    success: true,
    period: { from: fromDate, to: toDate },
    scenarios: {
      sunday_night_chaos: sundayNightChaos,
      overtime_trap: {
        at_risk_staff: overtimeTrap,
        note: "Any staff listed here exceeds max_hours_per_week in the selected window.",
      },
      timezone_tangle: timezoneTangle,
      simultaneous_assignment: simultaneousAssignment,
      fairness_complaint: fairnessComplaint,
      regret_swap: regretSwap,
    },
  });
});

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

  return res.json({
    success: true,
    shift_id: shift._id,
    suggestions,
    recommendations: suggestions,
  });
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
        recommendations: suggestions,
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

    await sendUserNotification({
      user_id: user_id,
      title: "New shift assignment",
      message: "You have been assigned a new shift.",
      category: "shift_assigned",
      priority: "high",
      idempotency_key: `shift_assigned:${assignment._id}:${user_id}`,
      data: {
        assignment_id: assignment._id.toString(),
        shift_id: shift_id.toString(),
      },
    });

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

  const role = getRole(currentUser);
  const assignmentFilter = {};

  if (role === "manager") {
    const shiftIds = (
      await Shift.find({ location_id: { $in: currentUser.location_ids || [] } }).select("_id")
    ).map((item) => item._id);
    assignmentFilter.shift_id = { $in: shiftIds };
  } else if (role === "staff") {
    assignmentFilter.user_id = currentUser._id;
  }

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

  const role = getRole(currentUser);
  if (role === "manager" && !hasLocationAccess(currentUser, assignment.shift_id?.location_id)) {
    return res.status(403).json({
      success: false,
      message: "Managers can only access assignments for assigned locations",
    });
  }
  if (
    role === "staff" &&
    toIdString(assignment.user_id) !== toIdString(currentUser._id)
  ) {
    return res.status(403).json({
      success: false,
      message: "Staff can only access their own assignments",
    });
  }

  return res.json({ success: true, data: assignment });
});

export const getMyShiftTracking = asyncHandler(async (req, res) => {
  const currentUser = await getCurrentUser(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const assignments = await ShiftAssignment.find({
    user_id: currentUser._id,
    status: "assigned",
  })
    .populate({
      path: "shift_id",
      select:
        "location_id required_skill_id starts_at_utc ends_at_utc location_timezone status",
      populate: [
        { path: "location_id", select: "name timezone" },
        { path: "required_skill_id", select: "name code" },
      ],
    })
    .sort({ createdAt: -1 });

  const now = new Date();
  const trackingItems = assignments
    .filter((assignment) => assignment.shift_id)
    .map((assignment) => toTrackingResponse(assignment, now))
    .sort((a, b) => {
      const aTime = a?.shift?.starts_at_utc ? new Date(a.shift.starts_at_utc).getTime() : Infinity;
      const bTime = b?.shift?.starts_at_utc ? new Date(b.shift.starts_at_utc).getTime() : Infinity;
      return aTime - bTime;
    });

  const activeAssignment =
    trackingItems.find((item) => item.clock_state === "clocked_in" || item.clock_state === "paused") ||
    trackingItems.find((item) => item.is_shift_active) ||
    null;

  return res.json({
    success: true,
    data: {
      now_utc: now,
      active_assignment: activeAssignment,
      assignments: trackingItems,
    },
  });
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
        recommendations: suggestions,
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

    if (String(nextUserId) !== String(assignment.user_id)) {
      await sendUserNotification({
        user_id: nextUserId,
        title: "Shift reassigned to you",
        message: "A shift has been reassigned to you.",
        category: "shift_assigned",
        priority: "high",
        idempotency_key: `shift_reassigned:${updated._id}:${nextUserId}`,
        data: {
          assignment_id: updated._id.toString(),
          shift_id: shift._id.toString(),
        },
      });
    }

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
  const shiftStart = assignment?.shift_id?.starts_at_utc
    ? new Date(assignment.shift_id.starts_at_utc)
    : null;
  if (shiftStart && !Number.isNaN(shiftStart.getTime()) && eventTime < shiftStart) {
    return res.status(409).json({
      success: false,
      message: `Shift doesn't start till ${shiftStart.toLocaleString()}`,
      data: { starts_at_utc: shiftStart.toISOString() },
    });
  }

  assignment.work_sessions.push({ clock_in_utc: eventTime, paused_minutes: 0 });
  assignment.work_status = "clocked_in";
  assignment.active_pause = undefined;
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

export const pauseAssignment = asyncHandler(async (req, res) => {
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
      message: "Not authorized to pause this assignment",
    });
  }

  const reason = (req.body?.reason || "").trim();
  if (!reason) {
    return res.status(400).json({
      success: false,
      message: "Pause reason is required",
    });
  }

  const lastSession = getLatestWorkSession(assignment);
  if (!lastSession || lastSession.clock_out_utc) {
    return res.status(409).json({
      success: false,
      message: "Cannot pause. No active work session found.",
    });
  }

  if (assignment.active_pause?.started_at_utc) {
    return res.status(409).json({
      success: false,
      message: "Cannot pause. Assignment is already paused.",
    });
  }

  const eventTime = new Date();
  assignment.active_pause = {
    started_at_utc: eventTime,
    reason,
  };
  assignment.work_status = "paused";
  assignment.activity_log.push({
    type: "pause",
    actor_user_id: req.userId,
    at_utc: eventTime,
    note: reason,
  });
  await assignment.save();

  return res.json({ success: true, message: "Assignment paused", data: assignment });
});

export const resumeAssignment = asyncHandler(async (req, res) => {
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
      message: "Not authorized to resume this assignment",
    });
  }

  const pauseStart = assignment.active_pause?.started_at_utc
    ? new Date(assignment.active_pause.started_at_utc)
    : null;
  if (!pauseStart) {
    return res.status(409).json({
      success: false,
      message: "Cannot resume. Assignment is not currently paused.",
    });
  }

  const lastSession = getLatestWorkSession(assignment);
  if (!lastSession || lastSession.clock_out_utc) {
    return res.status(409).json({
      success: false,
      message: "Cannot resume. No active work session found.",
    });
  }

  const eventTime = new Date();
  const pauseMinutes = Math.max(
    0,
    Math.round((eventTime.getTime() - pauseStart.getTime()) / 60000)
  );

  lastSession.paused_minutes = (lastSession.paused_minutes || 0) + pauseMinutes;
  assignment.pause_history.push({
    started_at_utc: pauseStart,
    ended_at_utc: eventTime,
    reason: assignment.active_pause?.reason || "Pause",
    duration_minutes: pauseMinutes,
  });
  assignment.active_pause = undefined;
  assignment.work_status = "clocked_in";
  assignment.activity_log.push({
    type: "resume",
    actor_user_id: req.userId,
    at_utc: eventTime,
    note: req.body?.note || "Resume work",
  });

  await assignment.save();
  return res.json({ success: true, message: "Assignment resumed", data: assignment });
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

  const lastSession = getLatestWorkSession(assignment);
  if (!lastSession || lastSession.clock_out_utc) {
    return res.status(409).json({
      success: false,
      message: "Cannot clock out. No active work session found.",
    });
  }

  const eventTime = new Date();
  if (assignment.active_pause?.started_at_utc) {
    const pauseStart = new Date(assignment.active_pause.started_at_utc);
    const pauseMinutes = Math.max(
      0,
      Math.round((eventTime.getTime() - pauseStart.getTime()) / 60000)
    );
    lastSession.paused_minutes = (lastSession.paused_minutes || 0) + pauseMinutes;
    assignment.pause_history.push({
      started_at_utc: pauseStart,
      ended_at_utc: eventTime,
      reason: assignment.active_pause?.reason || "Pause",
      duration_minutes: pauseMinutes,
    });
    assignment.active_pause = undefined;
  }

  lastSession.clock_out_utc = eventTime;
  lastSession.duration_minutes = Math.max(
    0,
    Math.round((eventTime.getTime() - new Date(lastSession.clock_in_utc).getTime()) / 60000) -
      (lastSession.paused_minutes || 0)
  );
  assignment.work_status = "clocked_out";
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

export const recoverMissingClockOut = asyncHandler(async (req, res) => {
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

  if (
    currentUser.role_id?.role !== "manager" ||
    !hasLocationAccess(currentUser, assignment.shift_id.location_id)
  ) {
    return res.status(403).json({
      success: false,
      message: "Only managers for this location can recover missing clock-out events",
    });
  }

  const reason = (req.body?.reason || "").trim();
  if (!reason) {
    return res.status(400).json({
      success: false,
      message: "reason is required for missing clock-out recovery",
    });
  }

  const lastSession = getLatestWorkSession(assignment);
  if (!lastSession || lastSession.clock_out_utc) {
    return res.status(409).json({
      success: false,
      message: "No active work session requires recovery",
    });
  }

  const eventTime = req.body?.clock_out_utc ? new Date(req.body.clock_out_utc) : new Date();
  if (Number.isNaN(eventTime.getTime())) {
    return res.status(400).json({
      success: false,
      message: "clock_out_utc must be a valid ISO datetime when provided",
    });
  }

  const clockInTime = new Date(lastSession.clock_in_utc);
  if (eventTime <= clockInTime) {
    return res.status(409).json({
      success: false,
      message: "Recovered clock_out_utc must be after clock_in_utc",
    });
  }

  if (assignment.active_pause?.started_at_utc) {
    const pauseStart = new Date(assignment.active_pause.started_at_utc);
    const pauseEnd = eventTime > pauseStart ? eventTime : pauseStart;
    const pauseMinutes = Math.max(
      0,
      Math.round((pauseEnd.getTime() - pauseStart.getTime()) / 60000)
    );

    lastSession.paused_minutes = (lastSession.paused_minutes || 0) + pauseMinutes;
    assignment.pause_history.push({
      started_at_utc: pauseStart,
      ended_at_utc: pauseEnd,
      reason: assignment.active_pause?.reason || "Pause",
      duration_minutes: pauseMinutes,
    });
    assignment.active_pause = undefined;
  }

  lastSession.clock_out_utc = eventTime;
  lastSession.duration_minutes = Math.max(
    0,
    Math.round((eventTime.getTime() - clockInTime.getTime()) / 60000) -
      (lastSession.paused_minutes || 0)
  );

  assignment.work_status = "clocked_out";
  assignment.activity_log.push({
    type: "clock_out",
    actor_user_id: req.userId,
    at_utc: new Date(),
    note: `Recovered missing clock-out: ${reason}`,
  });

  await assignment.save();

  await ClockEvent.create({
    user_id: assignment.user_id,
    shift_id: assignment.shift_id._id,
    location_id: assignment.shift_id.location_id,
    type: "clock_out",
    event_at_utc: eventTime,
    source: "manager",
  });

  return res.json({
    success: true,
    message: "Missing clock-out recovered successfully",
    data: assignment,
  });
});
