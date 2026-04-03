import { Router } from "express";
import {
  createLocation,
  deleteLocation,
  getLocationById,
  getLocations,
  updateLocation,
} from "../controllers/location.controller.js";

const router = Router();

router.post("/", createLocation);
router.get("/", getLocations);
router.get("/:id", getLocationById);
router.patch("/:id", updateLocation);
router.delete("/:id", deleteLocation);

export default router;
