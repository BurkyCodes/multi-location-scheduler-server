import asyncHandler from "../utils/asyncHandler.js";
import { inferAuditEntityType, logAuditChange } from "../services/auditLog.service.js";

export const createCrudController = (Model, options = {}) => {
  const { populate = "", entityType: explicitEntityType = null } = options;
  const entityType = explicitEntityType || inferAuditEntityType(Model);

  const createOne = asyncHandler(async (req, res) => {
    const doc = await Model.create(req.body);
    if (req.userId && entityType) {
      await logAuditChange({
        actor_user_id: req.userId,
        entity_type: entityType,
        action: "create",
        before_state: null,
        after_state: doc.toObject ? doc.toObject() : doc,
      });
    }
    res.status(201).json({ success: true, data: doc });
  });

  const getAll = asyncHandler(async (req, res) => {
    const filter = {};
    const query = Model.find(filter);
    if (populate) query.populate(populate);
    const docs = await query.sort({ createdAt: -1 });

    res.json({ success: true, count: docs.length, data: docs });
  });

  const getById = asyncHandler(async (req, res) => {
    const query = Model.findById(req.params.id);
    if (populate) query.populate(populate);
    const doc = await query;

    if (!doc) {
      return res.status(404).json({ success: false, message: "Resource not found" });
    }

    return res.json({ success: true, data: doc });
  });

  const updateById = asyncHandler(async (req, res) => {
    const before = await Model.findById(req.params.id);
    if (!before) {
      return res.status(404).json({ success: false, message: "Resource not found" });
    }

    const doc = await Model.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (req.userId && entityType) {
      await logAuditChange({
        actor_user_id: req.userId,
        entity_type: entityType,
        action: "update",
        before_state: before.toObject ? before.toObject() : before,
        after_state: doc?.toObject ? doc.toObject() : doc,
      });
    }

    return res.json({ success: true, data: doc });
  });

  const deleteById = asyncHandler(async (req, res) => {
    const doc = await Model.findByIdAndDelete(req.params.id);

    if (!doc) {
      return res.status(404).json({ success: false, message: "Resource not found" });
    }

    if (req.userId && entityType) {
      await logAuditChange({
        actor_user_id: req.userId,
        entity_type: entityType,
        action: "delete",
        before_state: doc.toObject ? doc.toObject() : doc,
        after_state: null,
      });
    }

    return res.json({ success: true, message: "Resource deleted" });
  });

  return {
    createOne,
    getAll,
    getById,
    updateById,
    deleteById,
  };
};
