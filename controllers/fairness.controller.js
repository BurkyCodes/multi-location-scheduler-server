import FairnessSnapshot from "../models/FairnessSnapshot.js";
import { createCrudController } from "./crud.controller.js";

const fairnessController = createCrudController(FairnessSnapshot, {
  populate: "location_id metrics.user_id generated_by",
});

export const createFairnessSnapshot = fairnessController.createOne;
export const getFairnessSnapshots = fairnessController.getAll;
export const getFairnessSnapshotById = fairnessController.getById;
export const updateFairnessSnapshot = fairnessController.updateById;
export const deleteFairnessSnapshot = fairnessController.deleteById;
