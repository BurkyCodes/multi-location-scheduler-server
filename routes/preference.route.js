import { Router } from "express";
import {
  getNotificationPreferenceByUser,
  getStaffPreferenceByUser,
  upsertNotificationPreference,
  upsertStaffPreference,
} from "../controllers/preference.controller.js";
import { checkAuthentication } from "../middlewares/auth.middleware.js";

const router = Router();

router.post("/staff", checkAuthentication, upsertStaffPreference);
router.get("/staff/user/:userId", checkAuthentication, getStaffPreferenceByUser);
router.post("/notifications", checkAuthentication, upsertNotificationPreference);
router.get("/notifications/user/:userId", checkAuthentication, getNotificationPreferenceByUser);

export default router;
