import SwapRequest from "../models/SwapRequest.js";
import asyncHandler from "../utils/asyncHandler.js";
import { createCrudController } from "./crud.controller.js";

const swapController = createCrudController(SwapRequest, {
  populate:
    "requester_id from_assignment_id target_user_id requested_assignment_id claimed_by_user_id manager_id",
});

export const createSwapRequest = swapController.createOne;
export const getSwapRequests = swapController.getAll;
export const getSwapRequestById = swapController.getById;
export const updateSwapRequest = swapController.updateById;
export const deleteSwapRequest = swapController.deleteById;

export const cancelSwapRequest = asyncHandler(async (req, res) => {
  const swapRequest = await SwapRequest.findById(req.params.id);

  if (!swapRequest) {
    return res.status(404).json({ success: false, message: "Swap request not found" });
  }

  if (swapRequest.requester_id?.toString() !== req.userId?.toString()) {
    return res.status(403).json({
      success: false,
      message: "Only the requester can cancel this swap request",
    });
  }

  const cancellableStatuses = ["pending_peer_acceptance", "pending_manager_approval"];
  if (!cancellableStatuses.includes(swapRequest.status)) {
    return res.status(409).json({
      success: false,
      message: `Swap request cannot be cancelled once status is ${swapRequest.status}`,
    });
  }

  swapRequest.status = "cancelled";
  swapRequest.cancelled_reason = req.body.cancelled_reason || "Cancelled by requester";
  await swapRequest.save();

  return res.json({ success: true, data: swapRequest });
});

export const managerDecisionSwapRequest = asyncHandler(async (req, res) => {
  const { approve, manager_id } = req.body;
  const status = approve ? "approved" : "rejected";

  const swapRequest = await SwapRequest.findById(req.params.id);

  if (!swapRequest) {
    return res.status(404).json({ success: false, message: "Swap request not found" });
  }

  if (swapRequest.status !== "pending_manager_approval") {
    return res.status(409).json({
      success: false,
      message: `Manager decision allowed only when status is pending_manager_approval`,
    });
  }

  swapRequest.status = status;
  swapRequest.manager_id = manager_id || req.userId;
  await swapRequest.save();

  return res.json({ success: true, data: swapRequest });
});
