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

const router = Router();

router.post("/", createSwapRequest);
router.get("/", getSwapRequests);
router.get("/:id", getSwapRequestById);
router.patch("/:id", updateSwapRequest);
router.delete("/:id", deleteSwapRequest);
router.post("/:id/cancel", cancelSwapRequest);
router.post("/:id/manager-decision", managerDecisionSwapRequest);

export default router;
