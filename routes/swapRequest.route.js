import { Router } from "express";
import {
  cancelSwapRequest,
  createSwapRequest,
  deleteSwapRequest,
  getSwapRequestById,
  getSwapRequests,
  managerDecisionSwapRequest,
  updateSwapRequest,
} from "../controllers/swapRequest.controller.js";
import { checkAuthentication } from "../middlewares/auth.middleware.js";
import { requireManager } from "../middlewares/role.middleware.js";

const router = Router();

router.post("/", checkAuthentication, createSwapRequest);
router.get("/", checkAuthentication, getSwapRequests);
router.get("/:id", checkAuthentication, getSwapRequestById);
router.patch("/:id", checkAuthentication, updateSwapRequest);
router.delete("/:id", checkAuthentication, deleteSwapRequest);
router.post("/:id/cancel", checkAuthentication, cancelSwapRequest);
router.post(
  "/:id/manager-decision",
  checkAuthentication,
  requireManager,
  managerDecisionSwapRequest
);

export default router;
