import AuditLog from "../models/AuditLog.js";
import asyncHandler from "../utils/asyncHandler.js";

export const createAuditLog = asyncHandler(async (req, res) => {
  const auditLog = await AuditLog.create(req.body);
  res.status(201).json({ success: true, data: auditLog });
});

export const getAuditLogs = asyncHandler(async (req, res) => {
  const filter = {};

  if (req.query.location_id) {
    filter.location_id = req.query.location_id;
  }
  if (req.query.entity_type) {
    filter.entity_type = req.query.entity_type;
  }
  if (req.query.entity_id) {
    filter.entity_id = req.query.entity_id;
  }
  if (req.query.start_date || req.query.end_date) {
    filter.createdAt = {};
    if (req.query.start_date) filter.createdAt.$gte = new Date(req.query.start_date);
    if (req.query.end_date) filter.createdAt.$lte = new Date(req.query.end_date);
  }

  const logs = await AuditLog.find(filter)
    .populate("actor_user_id location_id")
    .sort({ createdAt: -1 });

  res.json({ success: true, count: logs.length, data: logs });
});
