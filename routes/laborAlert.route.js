import { Router } from "express";
import {
  createLaborAlert,
  deleteLaborAlert,
  getLaborAlertById,
  getLaborAlerts,
  updateLaborAlert,
} from "../controllers/laborAlert.controller.js";
import { checkAuthentication } from "../middlewares/auth.middleware.js";
import { requireManagerOrAdmin } from "../middlewares/role.middleware.js";

const router = Router();

router.post("/", checkAuthentication, requireManagerOrAdmin, createLaborAlert);
router.get("/", checkAuthentication, getLaborAlerts);
router.get("/:id", checkAuthentication, getLaborAlertById);
router.patch("/:id", checkAuthentication, requireManagerOrAdmin, updateLaborAlert);
router.delete("/:id", checkAuthentication, requireManagerOrAdmin, deleteLaborAlert);

export default router;
