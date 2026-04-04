import { Router } from "express";
import {
  createLocation,
  deleteLocation,
  getLocationById,
  getLocations,
  updateLocation,
} from "../controllers/location.controller.js";
import { checkAuthentication } from "../middlewares/auth.middleware.js";
import { requireManager } from "../middlewares/role.middleware.js";

const router = Router();

router.get("/", checkAuthentication, getLocations);
router.get("/:id", checkAuthentication, getLocationById);
router.post("/", checkAuthentication, requireManager, createLocation);
router.patch("/:id", checkAuthentication, requireManager, updateLocation);
router.delete("/:id", checkAuthentication, requireManager, deleteLocation);

export default router;
