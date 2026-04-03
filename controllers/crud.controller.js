import asyncHandler from "../utils/asyncHandler.js";

export const createCrudController = (Model, options = {}) => {
  const { populate = "" } = options;

  const createOne = asyncHandler(async (req, res) => {
    const doc = await Model.create(req.body);
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
    const doc = await Model.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!doc) {
      return res.status(404).json({ success: false, message: "Resource not found" });
    }

    return res.json({ success: true, data: doc });
  });

  const deleteById = asyncHandler(async (req, res) => {
    const doc = await Model.findByIdAndDelete(req.params.id);

    if (!doc) {
      return res.status(404).json({ success: false, message: "Resource not found" });
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
