import { Router } from "express";
import {
  createFairnessSnapshot,
  deleteFairnessSnapshot,
  getFairnessSnapshotById,
  getFairnessSnapshots,
  updateFairnessSnapshot,
} from "../controllers/fairness.controller.js";

const router = Router();

router.post("/", createFairnessSnapshot);
router.get("/", getFairnessSnapshots);
router.get("/:id", getFairnessSnapshotById);
router.patch("/:id", updateFairnessSnapshot);
router.delete("/:id", deleteFairnessSnapshot);

export default router;
