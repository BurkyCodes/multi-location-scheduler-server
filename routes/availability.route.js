import { Router } from "express";
import {
  deleteAvailabilityByUser,
  getAvailabilityByUser,
  upsertAvailability,
} from "../controllers/availability.controller.js";

const router = Router();

router.post("/", upsertAvailability);
router.get("/user/:userId", getAvailabilityByUser);
router.delete("/user/:userId", deleteAvailabilityByUser);

export default router;
