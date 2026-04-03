import { Router } from "express";
import {
  getNotificationPreferenceByUser,
  getStaffPreferenceByUser,
  upsertNotificationPreference,
  upsertStaffPreference,
} from "../controllers/preference.controller.js";

const router = Router();

router.post("/staff", upsertStaffPreference);
router.get("/staff/user/:userId", getStaffPreferenceByUser);
router.post("/notifications", upsertNotificationPreference);
router.get("/notifications/user/:userId", getNotificationPreferenceByUser);

export default router;
