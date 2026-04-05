import StaffLocationCertification from "../models/StaffLocationCertification.js";
import asyncHandler from "../utils/asyncHandler.js";
import { createCrudController } from "./crud.controller.js";
import { sendUserNotification } from "../services/notificationEvents.service.js";

const certificationController = createCrudController(StaffLocationCertification, {
  populate: "user_id location_id certified_by",
});

export const createCertification = asyncHandler(async (req, res) => {
  const certification = await StaffLocationCertification.create(req.body);
  const populated = await StaffLocationCertification.findById(certification._id).populate(
    "user_id location_id certified_by"
  );

  await sendUserNotification({
    user_id: populated.user_id?._id || populated.user_id,
    title: "Location certification added",
    message: "You have been certified for a location.",
    category: "certification_created",
    priority: "normal",
    data: {
      certification_id: populated._id.toString(),
      location_id: (
        populated.location_id?._id ||
        populated.location_id ||
        ""
      ).toString(),
    },
  });

  return res.status(201).json({ success: true, data: populated });
});
export const getCertifications = certificationController.getAll;
export const getCertificationById = certificationController.getById;
export const updateCertification = certificationController.updateById;
export const deleteCertification = certificationController.deleteById;
