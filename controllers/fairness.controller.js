import FairnessSnapshot from "../models/FairnessSnapshot.js";
import Shift from "../models/Shift.js";
import ShiftAssignment from "../models/ShiftAssignment.js";
import StaffPreference from "../models/StaffPreference.js";
import User from "../models/User.js";
import { createCrudController } from "./crud.controller.js";
import asyncHandler from "../utils/asyncHandler.js";
import {
  CANONICAL_TIMEZONES,
  normalizeTimezone as normalizeSupportedTimezone,
  toIanaTimezone,
} from "../utils/timezone.js";

const DEFAULT_DESIRED_HOURS_PER_WEEK = 40;
const DEFAULT_ANALYTICS_WINDOW_DAYS = 28;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const SCHEDULING_TOLERANCE_HOURS = 1;

const fairnessController = createCrudController(FairnessSnapshot, {
  populate: "location_id metrics.user_id generated_by",
});

export const createFairnessSnapshot = fairnessController.createOne;
export const getFairnessSnapshots = fairnessController.getAll;
export const getFairnessSnapshotById = fairnessController.getById;
export const updateFairnessSnapshot = fairnessController.updateById;
export const deleteFairnessSnapshot = fairnessController.deleteById;

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
    weekday: "short",
    hour: "2-digit",
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
  return { weekday: weekdayMap[map.weekday], hour: Number(map.hour || 0) };
};

const roundToTwo = (value) => Math.round(value * 100) / 100;

const isStaffUser = (user) => user?.role_id?.role === "staff";

const computeOverlapHours = (rangeStart, rangeEnd, shiftStart, shiftEnd) => {
  const overlapStart = Math.max(rangeStart.getTime(), shiftStart.getTime());
  const overlapEnd = Math.min(rangeEnd.getTime(), shiftEnd.getTime());
  if (overlapEnd <= overlapStart) return 0;
  return (overlapEnd - overlapStart) / ONE_HOUR_MS;
};

const isAutoPremiumShift = (shift) => {
  const local = getLocalParts(shift.starts_at_utc, shift.location_timezone);
  // Evening premium window: Friday/Saturday shifts starting at or after 18:00 local time.
  return (local.weekday === 5 || local.weekday === 6) && local.hour >= 18;
};

const isPremiumShift = (shift) => Boolean(shift.is_premium) || isAutoPremiumShift(shift);

const computeFairnessScore = (premiumCounts) => {
  if (premiumCounts.length === 0) return 100;
  const sum = premiumCounts.reduce((acc, value) => acc + value, 0);
  if (sum === 0) return 100;
  const sumSquares = premiumCounts.reduce((acc, value) => acc + value * value, 0);
  if (sumSquares === 0) return 100;
  // Jain fairness index converted to a 0-100 score.
  const jainIndex = (sum * sum) / (premiumCounts.length * sumSquares);
  return roundToTwo(jainIndex * 100);
};

export const getSaturdayNightDistribution = asyncHandler(async (req, res) => {
  const { location_id, from, to } = req.query;
  const fromDate = from ? new Date(from) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();

  const assignmentFilter = { status: "assigned" };

  const assignments = await ShiftAssignment.find(assignmentFilter)
    .populate({
      path: "shift_id",
      select: "location_id starts_at_utc location_timezone",
      match: {
        ...(location_id ? { location_id } : {}),
        starts_at_utc: { $gte: fromDate, $lte: toDate },
      },
    })
    .populate({ path: "user_id", select: "name email phone_number" });

  const distribution = new Map();

  assignments.forEach((assignment) => {
    if (!assignment.shift_id || !assignment.user_id) return;
    const local = getLocalParts(
      assignment.shift_id.starts_at_utc,
      assignment.shift_id.location_timezone
    );
    // Saturday evening/night bucket starts at 18:00 in shift location timezone.
    if (local.weekday !== 6 || local.hour < 18) return;

    const key = assignment.user_id._id.toString();
    if (!distribution.has(key)) {
      distribution.set(key, {
        user_id: assignment.user_id._id,
        name: assignment.user_id.name || assignment.user_id.email,
        saturday_night_shift_count: 0,
      });
    }
    distribution.get(key).saturday_night_shift_count += 1;
  });

  const data = Array.from(distribution.values()).sort(
    (a, b) => b.saturday_night_shift_count - a.saturday_night_shift_count
  );

  return res.json({
    success: true,
    from: fromDate,
    to: toDate,
    location_id: location_id || null,
    data,
  });
});

export const getManagerFairnessAnalytics = asyncHandler(async (req, res) => {
  const { location_id, from, to } = req.query;
  const fromDate = from
    ? new Date(from)
    : new Date(Date.now() - DEFAULT_ANALYTICS_WINDOW_DAYS * ONE_DAY_MS);
  const toDate = to ? new Date(to) : new Date();

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return res.status(400).json({
      success: false,
      message: "from and to must be valid ISO date values",
    });
  }

  if (fromDate >= toDate) {
    return res.status(400).json({
      success: false,
      message: "from must be earlier than to",
    });
  }

  const managerLocationIds = (req.authUser.location_ids || []).map((id) => id.toString());
  const scopedLocationIds = location_id ? [location_id.toString()] : managerLocationIds;

  if (location_id && !managerLocationIds.includes(location_id.toString())) {
    return res.status(403).json({
      success: false,
      message: "Managers can only access fairness analytics for assigned locations",
    });
  }

  if (scopedLocationIds.length === 0) {
    const periodDays = Math.max((toDate.getTime() - fromDate.getTime()) / ONE_DAY_MS, 0);
    return res.json({
      success: true,
      period: { from: fromDate, to: toDate, days: roundToTwo(periodDays) },
      location_scope: [],
      summary: {
        staff_count: 0,
        total_assigned_hours: 0,
        total_premium_shift_count: 0,
        fairness_score: 100,
      },
      distribution: [],
      under_scheduled: [],
      over_scheduled: [],
      premium_shift_definition: {
        rule: "Shift is premium if is_premium=true or local start is Friday/Saturday at or after 18:00",
      },
    });
  }

  const users = await User.find({
    status: "active",
    is_active: true,
    location_ids: { $in: scopedLocationIds },
  })
    .select("name email phone_number role_id")
    .populate({ path: "role_id", select: "role" });

  const staffUsers = users.filter(isStaffUser);
  const staffIds = staffUsers.map((user) => user._id);

  const [preferences, matchingShifts] = await Promise.all([
    StaffPreference.find({ user_id: { $in: staffIds } }).select("user_id desired_hours_per_week"),
    Shift.find({
      location_id: { $in: scopedLocationIds },
      starts_at_utc: { $lt: toDate },
      ends_at_utc: { $gt: fromDate },
    }).select("_id starts_at_utc ends_at_utc location_timezone is_premium"),
  ]);

  const shiftIds = matchingShifts.map((shift) => shift._id);
  const shiftById = new Map(matchingShifts.map((shift) => [shift._id.toString(), shift]));

  const assignments =
    shiftIds.length === 0
      ? []
      : await ShiftAssignment.find({
          status: "assigned",
          shift_id: { $in: shiftIds },
        }).populate({
          path: "user_id",
          select: "name email phone_number role_id status is_active",
          populate: { path: "role_id", select: "role" },
        });

  const desiredHoursByUser = new Map(
    preferences.map((pref) => [pref.user_id.toString(), pref.desired_hours_per_week ?? DEFAULT_DESIRED_HOURS_PER_WEEK])
  );

  const distributionByUser = new Map();
  const initEntry = (user, fallbackDesired = DEFAULT_DESIRED_HOURS_PER_WEEK) => {
    const key = user._id.toString();
    if (distributionByUser.has(key)) return distributionByUser.get(key);

    const entry = {
      user_id: user._id,
      name: user.name || user.email || user.phone_number || "Unknown staff",
      assigned_hours: 0,
      premium_shift_count: 0,
      premium_shift_hours: 0,
      desired_hours_per_week: desiredHoursByUser.get(key) ?? fallbackDesired,
    };
    distributionByUser.set(key, entry);
    return entry;
  };

  staffUsers.forEach((user) => initEntry(user));

  assignments.forEach((assignment) => {
    if (!assignment.shift_id || !assignment.user_id) return;
    if (assignment.user_id.status !== "active" || assignment.user_id.is_active === false) return;
    if (!isStaffUser(assignment.user_id)) return;

    const shift = shiftById.get(assignment.shift_id.toString());
    if (!shift) return;

    const entry = initEntry(assignment.user_id);
    const overlapHours = computeOverlapHours(
      fromDate,
      toDate,
      new Date(shift.starts_at_utc),
      new Date(shift.ends_at_utc)
    );
    if (overlapHours <= 0) return;

    entry.assigned_hours += overlapHours;
    if (isPremiumShift(shift)) {
      entry.premium_shift_count += 1;
      entry.premium_shift_hours += overlapHours;
    }
  });

  const periodDays = Math.max((toDate.getTime() - fromDate.getTime()) / ONE_DAY_MS, 0);
  const distribution = Array.from(distributionByUser.values()).map((entry) => {
    const desiredHoursForPeriod = (entry.desired_hours_per_week * periodDays) / 7;
    const hoursDelta = entry.assigned_hours - desiredHoursForPeriod;
    const schedulingStatus =
      hoursDelta > SCHEDULING_TOLERANCE_HOURS
        ? "over_scheduled"
        : hoursDelta < -SCHEDULING_TOLERANCE_HOURS
        ? "under_scheduled"
        : "on_target";

    return {
      ...entry,
      assigned_hours: roundToTwo(entry.assigned_hours),
      premium_shift_hours: roundToTwo(entry.premium_shift_hours),
      desired_hours_for_period: roundToTwo(desiredHoursForPeriod),
      hours_delta: roundToTwo(hoursDelta),
      scheduling_status: schedulingStatus,
    };
  });

  distribution.sort((a, b) => b.assigned_hours - a.assigned_hours);

  const premiumCounts = distribution.map((item) => item.premium_shift_count);
  const fairnessScore = computeFairnessScore(premiumCounts);

  const underScheduled = distribution
    .filter((item) => item.scheduling_status === "under_scheduled")
    .map((item) => ({
      user_id: item.user_id,
      name: item.name,
      hours_delta: item.hours_delta,
    }));

  const overScheduled = distribution
    .filter((item) => item.scheduling_status === "over_scheduled")
    .map((item) => ({
      user_id: item.user_id,
      name: item.name,
      hours_delta: item.hours_delta,
    }));

  return res.json({
    success: true,
    period: {
      from: fromDate,
      to: toDate,
      days: roundToTwo(periodDays),
    },
    location_scope: scopedLocationIds,
    summary: {
      staff_count: distribution.length,
      total_assigned_hours: roundToTwo(
        distribution.reduce((sum, item) => sum + item.assigned_hours, 0)
      ),
      total_premium_shift_count: distribution.reduce(
        (sum, item) => sum + item.premium_shift_count,
        0
      ),
      fairness_score: fairnessScore,
    },
    distribution,
    under_scheduled: underScheduled,
    over_scheduled: overScheduled,
    premium_shift_definition: {
      rule: "Shift is premium if is_premium=true or local start is Friday/Saturday at or after 18:00",
    },
  });
});
