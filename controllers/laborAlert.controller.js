import LaborAlert from "../models/LaborAlert.js";
import Shift from "../models/Shift.js";
import User from "../models/User.js";
import asyncHandler from "../utils/asyncHandler.js";

const getCurrentUser = async (userId) =>
  User.findById(userId).populate({ path: "role_id", select: "role" });

export const createLaborAlert = asyncHandler(async (req, res) => {
  const created = await LaborAlert.create(req.body);
  const populated = await LaborAlert.findById(created._id).populate(
    "user_id shift_id assignment_id"
  );
  return res.status(201).json({ success: true, data: populated });
});

export const getLaborAlerts = asyncHandler(async (req, res) => {
  const currentUser = await getCurrentUser(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const filter = {};
  if (req.query.user_id) filter.user_id = req.query.user_id;
  if (req.query.type) filter.type = req.query.type;
  if (req.query.severity) filter.severity = req.query.severity;
  if (req.query.resolved === "true") {
    filter.resolved_at = { $ne: null };
  } else if (req.query.resolved === "false") {
    filter.resolved_at = null;
  }

  const role = currentUser.role_id?.role;
  if (role === "staff") {
    filter.user_id = currentUser._id;
  } else if (role === "manager") {
    const shiftIds = (
      await Shift.find({ location_id: { $in: currentUser.location_ids || [] } }).select("_id")
    ).map((item) => item._id);
    filter.shift_id = { $in: shiftIds };
  }

  const alerts = await LaborAlert.find(filter)
    .populate("user_id shift_id assignment_id")
    .sort({ createdAt: -1 });

  return res.json({ success: true, count: alerts.length, data: alerts });
});

export const getLaborAlertById = asyncHandler(async (req, res) => {
  const currentUser = await getCurrentUser(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const alert = await LaborAlert.findById(req.params.id).populate(
    "user_id shift_id assignment_id"
  );
  if (!alert) {
    return res.status(404).json({ success: false, message: "Labor alert not found" });
  }

  const role = currentUser.role_id?.role;
  if (role === "staff" && String(alert.user_id?._id || alert.user_id) !== String(currentUser._id)) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  if (
    role === "manager" &&
    !currentUser.location_ids.some(
      (id) => String(id) === String(alert.shift_id?.location_id || alert.shift_id?.location_id?._id)
    )
  ) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  return res.json({ success: true, data: alert });
});

export const updateLaborAlert = asyncHandler(async (req, res) => {
  const updated = await LaborAlert.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).populate("user_id shift_id assignment_id");

  if (!updated) {
    return res.status(404).json({ success: false, message: "Labor alert not found" });
  }

  return res.json({ success: true, data: updated });
});

export const deleteLaborAlert = asyncHandler(async (req, res) => {
  const deleted = await LaborAlert.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, message: "Labor alert not found" });
  }
  return res.json({ success: true, message: "Labor alert deleted" });
});
