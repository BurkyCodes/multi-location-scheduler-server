import StaffLocationCertification from "../models/StaffLocationCertification.js";
import asyncHandler from "../utils/asyncHandler.js";
import { createCrudController } from "./crud.controller.js";
import { sendUserNotification } from "../services/notificationEvents.service.js";
import { logAuditChange } from "../services/auditLog.service.js";

const certificationController = createCrudController(StaffLocationCertification, {
  populate: "user_id location_id certified_by decertified_by",
});

export const createCertification = asyncHandler(async (req, res) => {
  const { user_id, location_id } = req.body;
  const existing = await StaffLocationCertification.findOne({
    user_id,
    location_id,
  });

  const certification = existing
    ? await StaffLocationCertification.findByIdAndUpdate(
        existing._id,
        {
          ...req.body,
          is_active: true,
          decertified_at: null,
          decertified_by: null,
          decertified_reason: null,
          certified_at: req.body?.certified_at || new Date(),
        },
        { new: true, runValidators: true }
      )
    : await StaffLocationCertification.create(req.body);

  const populated = await StaffLocationCertification.findById(certification._id).populate(
    "user_id location_id certified_by decertified_by"
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

  await logAuditChange({
    actor_user_id: req.userId,
    entity_type: "certification",
    action: existing ? "recertify" : "create",
    before_state: existing?.toObject ? existing.toObject() : existing,
    after_state: populated?.toObject ? populated.toObject() : populated,
    reason: existing
      ? "Certification reactivated; historical records preserved"
      : undefined,
  });

  return res.status(201).json({ success: true, data: populated });
});
export const getCertifications = certificationController.getAll;
export const getCertificationById = certificationController.getById;
export const updateCertification = certificationController.updateById;
export const deleteCertification = certificationController.deleteById;

export const decertifyCertification = asyncHandler(async (req, res) => {
  const certification = await StaffLocationCertification.findById(req.params.id).populate(
    "user_id location_id certified_by decertified_by"
  );
  if (!certification) {
    return res.status(404).json({ success: false, message: "Certification not found" });
  }

  const before = certification.toObject();
  const reason = String(req.body?.reason || "").trim() || "Decertified by manager/admin";

  certification.is_active = false;
  certification.decertified_at = new Date();
  certification.decertified_by = req.userId;
  certification.decertified_reason = reason;
  await certification.save();

  const populated = await StaffLocationCertification.findById(certification._id).populate(
    "user_id location_id certified_by decertified_by"
  );

  await sendUserNotification({
    user_id: populated.user_id?._id || populated.user_id,
    title: "Location certification removed",
    message:
      "You are no longer certified for this location. Historical assignments remain unchanged.",
    category: "certification_updated",
    priority: "normal",
    data: {
      certification_id: populated._id.toString(),
      location_id: (
        populated.location_id?._id ||
        populated.location_id ||
        ""
      ).toString(),
      reason,
    },
  });

  await logAuditChange({
    actor_user_id: req.userId,
    entity_type: "certification",
    action: "decertify",
    before_state: before,
    after_state: populated?.toObject ? populated.toObject() : populated,
    reason:
      "Staff decertified from location. Historical assignments kept for reporting/audit; future assignment checks will block this location.",
  });

  return res.json({
    success: true,
    message:
      "Staff decertified. Historical records are retained; only future assignment eligibility is affected.",
    data: populated,
  });
});
