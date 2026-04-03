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
  const swapRequest = await SwapRequest.findByIdAndUpdate(
    req.params.id,
    {
      status: "cancelled",
      cancelled_reason: req.body.cancelled_reason || "Cancelled by requester",
    },
    { new: true }
  );

  if (!swapRequest) {
    return res.status(404).json({ success: false, message: "Swap request not found" });
  }

  return res.json({ success: true, data: swapRequest });
});

export const managerDecisionSwapRequest = asyncHandler(async (req, res) => {
  const { approve, manager_id } = req.body;
  const status = approve ? "approved" : "rejected";

  const swapRequest = await SwapRequest.findByIdAndUpdate(
    req.params.id,
    { status, manager_id },
    { new: true, runValidators: true }
  );

  if (!swapRequest) {
    return res.status(404).json({ success: false, message: "Swap request not found" });
  }

  return res.json({ success: true, data: swapRequest });
});
