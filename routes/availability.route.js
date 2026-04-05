import { Router } from "express";
import {
  deleteAvailabilityByUser,
  getAvailabilityByUser,
  upsertAvailability,
} from "../controllers/availability.controller.js";
import { checkAuthentication } from "../middlewares/auth.middleware.js";

const router = Router();

router.post("/", checkAuthentication, upsertAvailability);
router.get("/user/:userId", checkAuthentication, getAvailabilityByUser);
router.delete("/user/:userId", checkAuthentication, deleteAvailabilityByUser);

export default router;
