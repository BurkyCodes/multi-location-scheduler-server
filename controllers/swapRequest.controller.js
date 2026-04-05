import SwapRequest from "../models/SwapRequest.js";
import ShiftAssignment from "../models/ShiftAssignment.js";
import User from "../models/User.js";
import asyncHandler from "../utils/asyncHandler.js";
import { createCrudController } from "./crud.controller.js";
import { evaluateAssignmentRules } from "./assignment.controller.js";
import {
  getActiveManagersForLocation,
  sendBulkNotifications,
  sendUserNotification,
} from "../services/notificationEvents.service.js";

const swapController = createCrudController(SwapRequest, {
  populate:
    "requester_id from_assignment_id target_user_id requested_assignment_id claimed_by_user_id manager_id",
});

const assignmentShiftPopulate = {
  path: "shift_id",
  select: "location_id required_skill_id starts_at_utc ends_at_utc location_timezone status",
};

const getUserWithRole = async (userId) =>
  User.findById(userId).populate({ path: "role_id", select: "role" });

const ensurePending = (swapRequest, expectedStatus) =>
  swapRequest.status === expectedStatus;

const isExpired = (swapRequest) =>
  swapRequest.expires_at && new Date(swapRequest.expires_at) < new Date();

const toId = (value) => (value ? value.toString() : null);

export const createSwapRequest = asyncHandler(async (req, res) => {
  const {
    type = "swap",
    requester_id,
    from_assignment_id,
    target_user_id,
    requested_assignment_id,
    expires_at,
    note,
  } = req.body;

  if (!requester_id || !from_assignment_id) {
    return res.status(400).json({
      success: false,
      message: "requester_id and from_assignment_id are required",
    });
  }

  if (req.userId && toId(req.userId) !== toId(requester_id)) {
    return res.status(403).json({
      success: false,
      message: "You can only create swap requests for yourself",
    });
  }

  const fromAssignment = await ShiftAssignment.findById(from_assignment_id).populate(
    assignmentShiftPopulate
  );
  if (!fromAssignment || !fromAssignment.shift_id) {
    return res.status(404).json({
      success: false,
      message: "Original assignment or shift not found",
    });
  }

  if (toId(fromAssignment.user_id) !== toId(requester_id)) {
    return res.status(409).json({
      success: false,
      message: "Only the owner of the original assignment can request a swap",
    });
  }

  const doc = await SwapRequest.create({
    type,
    requester_id,
    from_assignment_id,
    target_user_id,
    requested_assignment_id,
    expires_at,
    note,
    status: "pending_peer_acceptance",
  });

  const shift = fromAssignment.shift_id;

  let candidateUsers = [];
  if (target_user_id) {
    const target = await getUserWithRole(target_user_id);
    if (target && target.role_id?.role === "staff") {
      candidateUsers = [target];
    }
  } else {
    const users = await User.find({
      _id: { $ne: requester_id },
      status: "active",
      is_active: true,
    }).populate({ path: "role_id", select: "role" });

    const staffCandidates = users.filter((item) => item.role_id?.role === "staff");
    for (const candidate of staffCandidates) {
      const violations = await evaluateAssignmentRules({
        user: candidate,
        shift,
        excludeAssignmentId: fromAssignment._id,
      });
      if (!violations.length) {
        candidateUsers.push(candidate);
      }
    }
  }

  await sendBulkNotifications(
    candidateUsers.map((item) => item._id),
    {
      title: "Swap request available",
      message: "A staff swap request is available for a shift you can take.",
      category: "swap_requested",
      priority: "normal",
      data: {
        swap_request_id: doc._id.toString(),
        from_assignment_id: from_assignment_id.toString(),
        shift_id: shift._id.toString(),
      },
    }
  );

  const managers = await getActiveManagersForLocation(shift.location_id);
  await sendBulkNotifications(
    managers.map((item) => item._id),
    {
      title: "New swap request submitted",
      message: "A new swap request has been submitted for your location.",
      category: "swap_requested",
      priority: "normal",
      data: {
        swap_request_id: doc._id.toString(),
        from_assignment_id: from_assignment_id.toString(),
        shift_id: shift._id.toString(),
      },
    }
  );

  const populated = await SwapRequest.findById(doc._id).populate(
    "requester_id from_assignment_id target_user_id requested_assignment_id claimed_by_user_id manager_id"
  );

  return res.status(201).json({ success: true, data: populated });
});
export const deleteSwapRequest = swapController.deleteById;

export const updateSwapRequest = asyncHandler(async (req, res) => {
  const restrictedFields = [
    "status",
    "requester_id",
    "from_assignment_id",
    "requested_assignment_id",
    "claimed_by_user_id",
    "manager_id",
  ];

  const blocked = restrictedFields.find((field) => field in req.body);
  if (blocked) {
    return res.status(400).json({
      success: false,
      message: `${blocked} cannot be updated directly. Use workflow endpoints.`,
    });
  }

  const updated = await SwapRequest.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).populate(
    "requester_id from_assignment_id target_user_id requested_assignment_id claimed_by_user_id manager_id"
  );

  if (!updated) {
    return res.status(404).json({ success: false, message: "Swap request not found" });
  }

  return res.json({ success: true, data: updated });
});

export const getSwapRequests = asyncHandler(async (_req, res) => {
  const docs = await SwapRequest.find()
    .populate("requester_id target_user_id requested_assignment_id claimed_by_user_id manager_id")
    .populate({
      path: "from_assignment_id",
      populate: [
        {
          path: "shift_id",
          select: "title name starts_at_utc ends_at_utc location_timezone status",
          populate: {
            path: "location_id",
            select: "name timezone",
          },
        },
        { path: "user_id", select: "name email" },
      ],
    })
    .sort({ createdAt: -1 });

  return res.json({ success: true, count: docs.length, data: docs });
});

export const getSwapRequestById = asyncHandler(async (req, res) => {
  const doc = await SwapRequest.findById(req.params.id)
    .populate("requester_id target_user_id requested_assignment_id claimed_by_user_id manager_id")
    .populate({
      path: "from_assignment_id",
      populate: [
        {
          path: "shift_id",
          select: "title name starts_at_utc ends_at_utc location_timezone status",
          populate: {
            path: "location_id",
            select: "name timezone",
          },
        },
        { path: "user_id", select: "name email" },
      ],
    });

  if (!doc) {
    return res.status(404).json({ success: false, message: "Swap request not found" });
  }

  return res.json({ success: true, data: doc });
});

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

export const acceptSwapRequest = asyncHandler(async (req, res) => {
  const currentUser = await getUserWithRole(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  if (currentUser.role_id?.role !== "staff") {
    return res.status(403).json({
      success: false,
      message: "Only staff can accept swap requests",
    });
  }

  const swapRequest = await SwapRequest.findById(req.params.id)
    .populate({
      path: "from_assignment_id",
      populate: assignmentShiftPopulate,
    })
    .populate({
      path: "requested_assignment_id",
      populate: assignmentShiftPopulate,
    });

  if (!swapRequest) {
    return res.status(404).json({ success: false, message: "Swap request not found" });
  }

  if (!ensurePending(swapRequest, "pending_peer_acceptance")) {
    return res.status(409).json({
      success: false,
      message:
        "Swap request can only be accepted when status is pending_peer_acceptance",
    });
  }

  if (isExpired(swapRequest)) {
    swapRequest.status = "expired";
    await swapRequest.save();
    return res.status(409).json({
      success: false,
      message: "Swap request has expired",
    });
  }

  if (toId(swapRequest.requester_id) === toId(currentUser._id)) {
    return res.status(409).json({
      success: false,
      message: "Requester cannot accept their own swap request",
    });
  }

  if (swapRequest.target_user_id && toId(swapRequest.target_user_id) !== toId(currentUser._id)) {
    return res.status(403).json({
      success: false,
      message: "This swap request is targeted to another staff member",
    });
  }

  const fromAssignment = swapRequest.from_assignment_id;
  if (!fromAssignment || !fromAssignment.shift_id) {
    return res.status(404).json({
      success: false,
      message: "Original assignment or shift not found",
    });
  }

  if (fromAssignment.status !== "assigned") {
    return res.status(409).json({
      success: false,
      message: "Original assignment is no longer active",
    });
  }

  const violations = await evaluateAssignmentRules({
    user: currentUser,
    shift: fromAssignment.shift_id,
    excludeAssignmentId: fromAssignment._id,
  });

  if (violations.length > 0) {
    return res.status(409).json({
      success: false,
      message: "Swap acceptance constraint violation",
      violations,
    });
  }

  if (swapRequest.type === "swap" && swapRequest.requested_assignment_id) {
    const requestedAssignment = swapRequest.requested_assignment_id;
    if (toId(requestedAssignment.user_id) !== toId(currentUser._id)) {
      return res.status(409).json({
        success: false,
        message: "You can only accept with your own requested assignment",
      });
    }
  }

  swapRequest.claimed_by_user_id = currentUser._id;
  if (!swapRequest.target_user_id) {
    swapRequest.target_user_id = currentUser._id;
  }
  swapRequest.status = "pending_manager_approval";
  await swapRequest.save();

  await sendUserNotification({
    user_id: swapRequest.requester_id,
    title: "Swap request accepted",
    message: "Your swap request was accepted and is waiting for manager approval.",
    category: "swap_updated",
    priority: "normal",
    data: {
      swap_request_id: swapRequest._id.toString(),
      accepted_by_user_id: currentUser._id.toString(),
    },
  });

  return res.json({ success: true, data: swapRequest });
});

export const managerDecisionSwapRequest = asyncHandler(async (req, res) => {
  const { approve, manager_id } = req.body;

  if (typeof approve !== "boolean") {
    return res.status(400).json({
      success: false,
      message: "approve must be true or false",
    });
  }

  const swapRequest = await SwapRequest.findById(req.params.id)
    .populate({
      path: "from_assignment_id",
      populate: assignmentShiftPopulate,
    })
    .populate({
      path: "requested_assignment_id",
      populate: assignmentShiftPopulate,
    });

  if (!swapRequest) {
    return res.status(404).json({ success: false, message: "Swap request not found" });
  }

  if (!ensurePending(swapRequest, "pending_manager_approval")) {
    return res.status(409).json({
      success: false,
      message: "Manager decision allowed only when status is pending_manager_approval",
    });
  }

  if (isExpired(swapRequest)) {
    swapRequest.status = "expired";
    swapRequest.manager_id = manager_id || req.userId;
    await swapRequest.save();
    return res.status(409).json({
      success: false,
      message: "Swap request has expired",
    });
  }

  if (!approve) {
    swapRequest.status = "rejected";
    swapRequest.manager_id = manager_id || req.userId;
    await swapRequest.save();
    await sendBulkNotifications([swapRequest.requester_id, swapRequest.claimed_by_user_id], {
      title: "Swap request rejected",
      message: "A manager rejected the swap request.",
      category: "swap_updated",
      priority: "normal",
      data: {
        swap_request_id: swapRequest._id.toString(),
      },
    });
    return res.json({ success: true, data: swapRequest });
  }

  const fromAssignment = swapRequest.from_assignment_id;
  if (!fromAssignment || !fromAssignment.shift_id) {
    return res.status(404).json({
      success: false,
      message: "Original assignment or shift not found",
    });
  }

  if (fromAssignment.status !== "assigned") {
    return res.status(409).json({
      success: false,
      message: "Original assignment is no longer active",
    });
  }

  if (toId(fromAssignment.user_id) !== toId(swapRequest.requester_id)) {
    return res.status(409).json({
      success: false,
      message: "Original assignment no longer belongs to requester",
    });
  }

  const incomingUserId = swapRequest.claimed_by_user_id || swapRequest.target_user_id;
  if (!incomingUserId) {
    return res.status(409).json({
      success: false,
      message: "No accepting staff assigned to this swap request",
    });
  }

  const [incomingUser, requesterUser] = await Promise.all([
    getUserWithRole(incomingUserId),
    getUserWithRole(swapRequest.requester_id),
  ]);

  if (!incomingUser || !requesterUser) {
    return res.status(404).json({
      success: false,
      message: "Requester or accepting staff not found",
    });
  }

  const incomingViolations = await evaluateAssignmentRules({
    user: incomingUser,
    shift: fromAssignment.shift_id,
    excludeAssignmentId: fromAssignment._id,
  });
  if (incomingViolations.length > 0) {
    return res.status(409).json({
      success: false,
      message: "Accepting staff no longer satisfies assignment constraints",
      violations: incomingViolations,
    });
  }

  let requestedAssignment = null;
  if (swapRequest.type === "swap" && swapRequest.requested_assignment_id) {
    requestedAssignment = swapRequest.requested_assignment_id;
    if (!requestedAssignment || !requestedAssignment.shift_id) {
      return res.status(404).json({
        success: false,
        message: "Requested assignment or shift not found",
      });
    }

    if (requestedAssignment.status !== "assigned") {
      return res.status(409).json({
        success: false,
        message: "Requested assignment is no longer active",
      });
    }

    if (toId(requestedAssignment.user_id) !== toId(incomingUser._id)) {
      return res.status(409).json({
        success: false,
        message: "Requested assignment no longer belongs to accepting staff",
      });
    }

    const requesterViolations = await evaluateAssignmentRules({
      user: requesterUser,
      shift: requestedAssignment.shift_id,
      excludeAssignmentId: requestedAssignment._id,
    });

    if (requesterViolations.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Requester no longer satisfies assignment constraints for requested shift",
        violations: requesterViolations,
      });
    }
  }

  const actorId = manager_id || req.userId;
  const now = new Date();

  fromAssignment.user_id = incomingUser._id;
  fromAssignment.source = "swap";
  fromAssignment.assigned_by = actorId;
  fromAssignment.activity_log.push(
    {
      type: "unassigned",
      actor_user_id: actorId,
      note: `Removed from requester due to approved swap ${swapRequest._id}`,
      at_utc: now,
    },
    {
      type: "assigned",
      actor_user_id: actorId,
      note: `Assigned via approved swap ${swapRequest._id}`,
      at_utc: now,
    }
  );

  if (requestedAssignment) {
    requestedAssignment.user_id = requesterUser._id;
    requestedAssignment.source = "swap";
    requestedAssignment.assigned_by = actorId;
    requestedAssignment.activity_log.push(
      {
        type: "unassigned",
        actor_user_id: actorId,
        note: `Removed from accepting staff due to approved swap ${swapRequest._id}`,
        at_utc: now,
      },
      {
        type: "assigned",
        actor_user_id: actorId,
        note: `Assigned to requester via approved swap ${swapRequest._id}`,
        at_utc: now,
      }
    );
  }

  await fromAssignment.save();
  if (requestedAssignment) {
    await requestedAssignment.save();
  }

  swapRequest.status = "approved";
  swapRequest.manager_id = actorId;
  await swapRequest.save();

  await sendUserNotification({
    user_id: requesterUser._id,
    title: "Swap request approved",
    message: "Your swap request was approved.",
    category: "swap_updated",
    priority: "high",
    data: {
      swap_request_id: swapRequest._id.toString(),
      assignment_id: fromAssignment._id.toString(),
    },
  });
  await sendUserNotification({
    user_id: incomingUser._id,
    title: "Shift assigned via swap",
    message: "A manager approved the swap and assigned the shift to you.",
    category: "shift_assigned",
    priority: "high",
    data: {
      swap_request_id: swapRequest._id.toString(),
      assignment_id: fromAssignment._id.toString(),
    },
  });

  const refreshedFromAssignment = await ShiftAssignment.findById(fromAssignment._id).populate(
    "shift_id user_id assigned_by manager_override.approved_by"
  );
  const refreshedRequestedAssignment = requestedAssignment
    ? await ShiftAssignment.findById(requestedAssignment._id).populate(
        "shift_id user_id assigned_by manager_override.approved_by"
      )
    : null;

  return res.json({
    success: true,
    data: {
      swap_request: swapRequest,
      updated_from_assignment: refreshedFromAssignment,
      updated_requested_assignment: refreshedRequestedAssignment,
    },
  });
});
