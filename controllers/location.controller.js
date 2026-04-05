import Location from "../models/Location.js";
import User from "../models/User.js";
import asyncHandler from "../utils/asyncHandler.js";
import {
  ALLOWED_LOCATION_TIMEZONES,
  normalizeTimezone,
  toTimezoneLabel,
} from "../utils/timezone.js";

const MAX_LOCATIONS = 4;
const MAX_TIMEZONES = 2;

const toLocationResponse = (location) => {
  const data = location.toObject ? location.toObject() : location;
  return {
    ...data,
    timezone_label: toTimezoneLabel(data.timezone),
  };
};

const hasLocationAccess = (user, locationId) => {
  if (!locationId) return false;
  return (user.location_ids || []).some((id) => id.toString() === locationId.toString());
};

const getCurrentUser = async (userId) =>
  User.findById(userId).populate({ path: "role_id", select: "role" });

export const createLocation = asyncHandler(async (req, res) => {
  const locationCount = await Location.countDocuments();
  if (locationCount >= MAX_LOCATIONS) {
    return res.status(409).json({
      success: false,
      message: `Coastal Eats supports a maximum of ${MAX_LOCATIONS} locations`,
    });
  }

  const timezone = normalizeTimezone(req.body.timezone, {
    fallback: "",
    restrictToAllowed: true,
  });
  if (!timezone || !ALLOWED_LOCATION_TIMEZONES.includes(timezone)) {
    return res.status(400).json({
      success: false,
      message: `Timezone must be one of: ${ALLOWED_LOCATION_TIMEZONES.join(", ")}`,
    });
  }
  const distinctTimezones = (await Location.distinct("timezone")).filter(Boolean);
  const nextTimezones = distinctTimezones.includes(timezone)
    ? distinctTimezones
    : [...distinctTimezones, timezone];

  if (timezone && nextTimezones.length > MAX_TIMEZONES) {
    return res.status(409).json({
      success: false,
      message: `Coastal Eats supports a maximum of ${MAX_TIMEZONES} timezones`,
    });
  }

  const location = await Location.create({ ...req.body, timezone });
  return res.status(201).json({ success: true, data: toLocationResponse(location) });
});

export const getLocations = asyncHandler(async (req, res) => {
  const currentUser = await getCurrentUser(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const isManager = currentUser.role_id?.role === "manager";
  const filter = isManager ? { _id: { $in: currentUser.location_ids || [] } } : {};

  const locations = await Location.find(filter).sort({ createdAt: -1 });
  return res.json({
    success: true,
    count: locations.length,
    data: locations.map((item) => toLocationResponse(item)),
  });
});

export const getLocationById = asyncHandler(async (req, res) => {
  const currentUser = await getCurrentUser(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const location = await Location.findById(req.params.id);
  if (!location) {
    return res.status(404).json({ success: false, message: "Location not found" });
  }

  if (
    currentUser.role_id?.role === "manager" &&
    !hasLocationAccess(currentUser, location._id)
  ) {
    return res.status(403).json({
      success: false,
      message: "Managers can only access locations they are assigned to",
    });
  }

  return res.json({ success: true, data: toLocationResponse(location) });
});

export const updateLocation = asyncHandler(async (req, res) => {
  const currentUser = await getCurrentUser(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const location = await Location.findById(req.params.id);
  if (!location) {
    return res.status(404).json({ success: false, message: "Location not found" });
  }

  if (
    currentUser.role_id?.role === "manager" &&
    !hasLocationAccess(currentUser, location._id)
  ) {
    return res.status(403).json({
      success: false,
      message: "Managers can only manage locations they are assigned to",
    });
  }

  const timezone = normalizeTimezone(req.body.timezone || location.timezone, {
    fallback: "",
    restrictToAllowed: true,
  });
  if (!timezone || !ALLOWED_LOCATION_TIMEZONES.includes(timezone)) {
    return res.status(400).json({
      success: false,
      message: `Timezone must be one of: ${ALLOWED_LOCATION_TIMEZONES.join(", ")}`,
    });
  }
  const otherLocations = await Location.find({ _id: { $ne: req.params.id } }).select(
    "timezone"
  );
  const timezoneSet = new Set(
    otherLocations
      .map((item) =>
        normalizeTimezone(item.timezone, {
          fallback: "",
          restrictToAllowed: true,
        })
      )
      .filter(Boolean)
  );
  timezoneSet.add(timezone);

  if (timezoneSet.size > MAX_TIMEZONES) {
    return res.status(409).json({
      success: false,
      message: `Coastal Eats supports a maximum of ${MAX_TIMEZONES} timezones`,
    });
  }

  const updated = await Location.findByIdAndUpdate(req.params.id, { ...req.body, timezone }, {
    new: true,
    runValidators: true,
  });

  return res.json({ success: true, data: toLocationResponse(updated) });
});

export const deleteLocation = asyncHandler(async (req, res) => {
  const currentUser = await getCurrentUser(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const location = await Location.findById(req.params.id);
  if (!location) {
    return res.status(404).json({ success: false, message: "Location not found" });
  }

  if (
    currentUser.role_id?.role === "manager" &&
    !hasLocationAccess(currentUser, location._id)
  ) {
    return res.status(403).json({
      success: false,
      message: "Managers can only manage locations they are assigned to",
    });
  }

  const deleted = await Location.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, message: "Location not found" });
  }
  return res.json({ success: true, message: "Location deleted" });
});
