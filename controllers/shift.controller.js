import Shift from "../models/Shift.js";
import { createCrudController } from "./crud.controller.js";

const shiftController = createCrudController(Shift, {
  populate: "schedule_id location_id required_skill_id created_by updated_by",
});

export const createShift = shiftController.createOne;
export const getShifts = shiftController.getAll;
export const getShiftById = shiftController.getById;
export const updateShift = shiftController.updateById;
export const deleteShift = shiftController.deleteById;
