import AuditLog from "../models/AuditLog.js";
import asyncHandler from "../utils/asyncHandler.js";

export const createAuditLog = asyncHandler(async (req, res) => {
  const payload = {
    ...req.body,
    actor_user_id: req.userId,
  };
  const auditLog = await AuditLog.create(payload);
  const populated = await AuditLog.findById(auditLog._id).populate(
    "actor_user_id location_id",
    "name email phone_number"
  );
  const data = populated?.toObject ? populated.toObject() : populated;
  res.status(201).json({
    success: true,
    data: {
      ...data,
      performed_by: data?.actor_user_id
        ? {
            id: data.actor_user_id?._id || data.actor_user_id,
            name: data.actor_user_id?.name || null,
            email: data.actor_user_id?.email || null,
            phone_number: data.actor_user_id?.phone_number || null,
          }
        : null,
    },
  });
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
    .populate("actor_user_id", "name email phone_number")
    .populate("location_id")
    .sort({ createdAt: -1 });

  const data = logs.map((item) => {
    const log = item.toObject ? item.toObject() : item;
    return {
      ...log,
      performed_by: log?.actor_user_id
        ? {
            id: log.actor_user_id?._id || log.actor_user_id,
            name: log.actor_user_id?.name || null,
            email: log.actor_user_id?.email || null,
            phone_number: log.actor_user_id?.phone_number || null,
          }
        : null,
    };
  });

  res.json({ success: true, count: data.length, data });
});
