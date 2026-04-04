import { Router } from "express";
import {
  createFairnessSnapshot,
  deleteFairnessSnapshot,
  getFairnessSnapshotById,
  getFairnessSnapshots,
  getSaturdayNightDistribution,
  updateFairnessSnapshot,
} from "../controllers/fairness.controller.js";
import { checkAuthentication } from "../middlewares/auth.middleware.js";
import { requireManager } from "../middlewares/role.middleware.js";

const router = Router();

router.get("/saturday-night-distribution", checkAuthentication, requireManager, getSaturdayNightDistribution);
router.post("/", checkAuthentication, requireManager, createFairnessSnapshot);
router.get("/", checkAuthentication, getFairnessSnapshots);
router.get("/:id", checkAuthentication, getFairnessSnapshotById);
router.patch("/:id", checkAuthentication, requireManager, updateFairnessSnapshot);
router.delete("/:id", checkAuthentication, requireManager, deleteFairnessSnapshot);

export default router;
