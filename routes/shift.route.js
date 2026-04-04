import { Router } from "express";
import {
  createShift,
  deleteShift,
  getShiftById,
  getShifts,
  updateShift,
} from "../controllers/shift.controller.js";
import { checkAuthentication } from "../middlewares/auth.middleware.js";
import { requireManager } from "../middlewares/role.middleware.js";

const router = Router();

router.get("/", checkAuthentication, getShifts);
router.get("/:id", checkAuthentication, getShiftById);
router.post("/", checkAuthentication, requireManager, createShift);
router.patch("/:id", checkAuthentication, requireManager, updateShift);
router.delete("/:id", checkAuthentication, requireManager, deleteShift);

export default router;
