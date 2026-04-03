import { Router } from "express";
import {
  createLaborAlert,
  deleteLaborAlert,
  getLaborAlertById,
  getLaborAlerts,
  updateLaborAlert,
} from "../controllers/laborAlert.controller.js";

const router = Router();

router.post("/", createLaborAlert);
router.get("/", getLaborAlerts);
router.get("/:id", getLaborAlertById);
router.patch("/:id", updateLaborAlert);
router.delete("/:id", deleteLaborAlert);

export default router;
