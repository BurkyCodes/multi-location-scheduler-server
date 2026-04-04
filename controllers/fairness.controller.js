import FairnessSnapshot from "../models/FairnessSnapshot.js";
import ShiftAssignment from "../models/ShiftAssignment.js";
import { createCrudController } from "./crud.controller.js";
import asyncHandler from "../utils/asyncHandler.js";

const fairnessController = createCrudController(FairnessSnapshot, {
  populate: "location_id metrics.user_id generated_by",
});

export const createFairnessSnapshot = fairnessController.createOne;
export const getFairnessSnapshots = fairnessController.getAll;
export const getFairnessSnapshotById = fairnessController.getById;
export const updateFairnessSnapshot = fairnessController.updateById;
export const deleteFairnessSnapshot = fairnessController.deleteById;

const getLocalParts = (date, timezone) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
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
