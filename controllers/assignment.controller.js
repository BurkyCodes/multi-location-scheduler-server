import ShiftAssignment from "../models/ShiftAssignment.js";
import { createCrudController } from "./crud.controller.js";

const assignmentController = createCrudController(ShiftAssignment, {
  populate: "shift_id user_id assigned_by manager_override.approved_by",
});

export const createAssignment = assignmentController.createOne;
export const getAssignments = assignmentController.getAll;
export const getAssignmentById = assignmentController.getById;
export const updateAssignment = assignmentController.updateById;
export const deleteAssignment = assignmentController.deleteById;
