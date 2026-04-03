import LaborAlert from "../models/LaborAlert.js";
import { createCrudController } from "./crud.controller.js";

const laborAlertController = createCrudController(LaborAlert, {
  populate: "user_id shift_id assignment_id",
});

export const createLaborAlert = laborAlertController.createOne;
export const getLaborAlerts = laborAlertController.getAll;
export const getLaborAlertById = laborAlertController.getById;
export const updateLaborAlert = laborAlertController.updateById;
export const deleteLaborAlert = laborAlertController.deleteById;
