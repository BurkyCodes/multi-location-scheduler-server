import StaffLocationCertification from "../models/StaffLocationCertification.js";
import { createCrudController } from "./crud.controller.js";

const certificationController = createCrudController(StaffLocationCertification, {
  populate: "user_id location_id certified_by",
});

export const createCertification = certificationController.createOne;
export const getCertifications = certificationController.getAll;
export const getCertificationById = certificationController.getById;
export const updateCertification = certificationController.updateById;
export const deleteCertification = certificationController.deleteById;
