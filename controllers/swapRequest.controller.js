import SwapRequest from "../models/SwapRequest.js";
import ShiftAssignment from "../models/ShiftAssignment.js";
import User from "../models/User.js";
import asyncHandler from "../utils/asyncHandler.js";
import { evaluateAssignmentRules } from "./assignment.controller.js";
import {
  getActiveManagersForLocation,
  sendBulkNotifications,
  sendUserNotification,
} from "../services/notificationEvents.service.js";
import { logAuditChange } from "../services/auditLog.service.js";
import {
  publishRealtimeEventForLocation,
  publishRealtimeEventToUsers,
} from "../services/realtimeEvents.service.js";

const MAX_PENDING_SWAP_DROP_REQUESTS = 3;
const DROP_AUTO_EXPIRY_HOURS_BEFORE_SHIFT = 24;

const PENDING_SWAP_STATUSES = ["pending_peer_acceptance", "pending_manager_approval", "processing"];

const computeDropAutoExpiry = (shiftStartsAtUtc) =>
  new Date(new Date(shiftStartsAtUtc).getTime() - DROP_AUTO_EXPIRY_HOURS_BEFORE_SHIFT * 60 * 60 * 1000);

const normalizeSwapExpiry = ({ type, providedExpiresAt, shiftStartsAtUtc }) => {
  const provided =
    providedExpiresAt && !Number.isNaN(new Date(providedExpiresAt).getTime())
      ? new Date(providedExpiresAt)
      : null;
  if (type !== "drop") {
    return provided;
  }
  const autoExpiry = computeDropAutoExpiry(shiftStartsAtUtc);
  if (!provided) return autoExpiry;
  return provided < autoExpiry ? provided : autoExpiry;
};

const shouldAutoExpireDrop = ({ swapRequest, shiftStartsAtUtc }) => {
  if (swapRequest?.type !== "drop") return false;
  if (swapRequest?.status !== "pending_peer_acceptance") return false;
  const autoExpiry = computeDropAutoExpiry(shiftStartsAtUtc);
  return new Date() >= autoExpiry;
};

const expireUnclaimedDropRequests = async () => {
  const pendingDrops = await SwapRequest.find({
    type: "drop",
    status: "pending_peer_acceptance",
  }).populate({
    path: "from_assignment_id",
    populate: {
      path: "shift_id",
      select: "starts_at_utc",
    },
  });

  const now = new Date();
  const expiredIds = [];
  pendingDrops.forEach((request) => {
    const shiftStart = request?.from_assignment_id?.shift_id?.starts_at_utc;
    if (!shiftStart) return;
    const autoExpiry = computeDropAutoExpiry(shiftStart);
    if (now >= autoExpiry) {
      expiredIds.push(request._id);
    }
  });

  if (expiredIds.length) {
    await SwapRequest.updateMany(
      { _id: { $in: expiredIds } },
      { $set: { status: "expired" } }
    );
  }
};

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

const emitSwapRealtime = async (swapRequest, action, extras = {}) => {
  if (!swapRequest) return;
  const swapId = toId(swapRequest._id);
  const fromAssignmentId = toId(swapRequest.from_assignment_id?._id || swapRequest.from_assignment_id);
  const audience = [
    swapRequest.requester_id,
    swapRequest.target_user_id,
    swapRequest.claimed_by_user_id,
    swapRequest.manager_id,
  ]
    .filter(Boolean)
    .map((id) => toId(id));

  const payload = {
    action,
    swap_request_id: swapId,
    from_assignment_id: fromAssignmentId,
    status: swapRequest.status,
    at: new Date().toISOString(),
    ...extras,
  };

  publishRealtimeEventToUsers(audience, "swap_changed", payload);

  const fromAssignment = await ShiftAssignment.findById(fromAssignmentId).populate({
    path: "shift_id",
    select: "location_id",
  });
  const locationId = fromAssignment?.shift_id?.location_id;
  if (locationId) {
    await publishRealtimeEventForLocation(locationId, "swap_changed", {
      ...payload,
      location_id: locationId.toString(),
    });
  }
};

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

  const isOwner = toId(fromAssignment.user_id) === toId(requester_id);
  if (["swap", "drop"].includes(type) && !isOwner) {
    return res.status(409).json({
      success: false,
      message: "Only the owner of the original assignment can request a swap/drop",
    });
  }

  if (["swap", "drop"].includes(type)) {
    const pendingCount = await SwapRequest.countDocuments({
      requester_id,
      type: { $in: ["swap", "drop"] },
      status: { $in: PENDING_SWAP_STATUSES },
    });
    if (pendingCount >= MAX_PENDING_SWAP_DROP_REQUESTS) {
      return res.status(409).json({
        success: false,
        message: `You already have ${pendingCount} pending swap/drop requests. Maximum allowed is ${MAX_PENDING_SWAP_DROP_REQUESTS}.`,
      });
    }
  }

  if (type === "pickup") {
    if (isOwner) {
      return res.status(409).json({
        success: false,
        message: "You cannot pickup your own assignment",
      });
    }

    const existingPendingPickup = await SwapRequest.findOne({
      type: "pickup",
      requester_id,
      from_assignment_id,
      status: { $in: PENDING_SWAP_STATUSES },
    });
    if (existingPendingPickup) {
      return res.status(409).json({
        success: false,
        message: "You already have a pending pickup request for this shift",
      });
    }

    const activeDropRequest = await SwapRequest.findOne({
      type: "drop",
      from_assignment_id,
      status: "pending_peer_acceptance",
    });
    if (!activeDropRequest) {
      return res.status(409).json({
        success: false,
        message: "This shift is not currently offered as an active drop request",
      });
    }

    if (isExpired(activeDropRequest)) {
      activeDropRequest.status = "expired";
      await activeDropRequest.save();
      return res.status(409).json({
        success: false,
        message: "Drop request has expired",
      });
    }

    if (
      shouldAutoExpireDrop({
        swapRequest: activeDropRequest,
        shiftStartsAtUtc: fromAssignment.shift_id.starts_at_utc,
      })
    ) {
      activeDropRequest.status = "expired";
      await activeDropRequest.save();
      return res.status(409).json({
        success: false,
        message: "Drop request has expired (24 hours before shift start)",
      });
    }

    const picker = await getUserWithRole(requester_id);
    if (!picker || picker.role_id?.role !== "staff") {
      return res.status(404).json({
        success: false,
        message: "Pickup requester must be an active staff user",
      });
    }

    const violations = await evaluateAssignmentRules({
      user: picker,
      shift: fromAssignment.shift_id,
      excludeAssignmentId: fromAssignment._id,
    });
    if (violations.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Pickup request constraint violation",
        violations,
      });
    }

    const pickupDoc = await SwapRequest.create({
      type: "pickup",
      requester_id,
      from_assignment_id,
      target_user_id: requester_id,
      claimed_by_user_id: requester_id,
      expires_at: normalizeSwapExpiry({
        type: "drop",
        providedExpiresAt: expires_at || activeDropRequest.expires_at,
        shiftStartsAtUtc: fromAssignment.shift_id.starts_at_utc,
      }),
      note,
      status: "pending_manager_approval",
    });

    await logAuditChange({
      actor_user_id: req.userId,
      entity_type: "swap_request",
      action: "create_pickup",
      after_state: pickupDoc.toObject(),
    });

    await sendUserNotification({
      user_id: fromAssignment.user_id,
      title: "Shift pickup requested",
      message: "A staff member requested to pick up your dropped shift.",
      category: "swap_updated",
      priority: "normal",
      data: {
        swap_request_id: pickupDoc._id.toString(),
        from_assignment_id: from_assignment_id.toString(),
      },
    });

    const managers = await getActiveManagersForLocation(fromAssignment.shift_id.location_id);
    await sendBulkNotifications(
      managers.map((item) => item._id),
      {
        title: "Pickup request awaiting approval",
        message: "A direct pickup request is waiting for manager approval.",
        category: "swap_requested",
        priority: "normal",
        data: {
          swap_request_id: pickupDoc._id.toString(),
          from_assignment_id: from_assignment_id.toString(),
        },
      }
    );

    const populatedPickup = await SwapRequest.findById(pickupDoc._id).populate(
      "requester_id from_assignment_id target_user_id requested_assignment_id claimed_by_user_id manager_id"
    );
    await emitSwapRealtime(populatedPickup, "pickup_created");
    return res.status(201).json({ success: true, data: populatedPickup });
  }

  const doc = await SwapRequest.create({
    type,
    requester_id,
    from_assignment_id,
    target_user_id,
    requested_assignment_id,
    expires_at: normalizeSwapExpiry({
      type,
      providedExpiresAt: expires_at,
      shiftStartsAtUtc: fromAssignment.shift_id.starts_at_utc,
    }),
    note,
    status: "pending_peer_acceptance",
  });
  await logAuditChange({
    actor_user_id: req.userId,
    entity_type: "swap_request",
    action: "create",
    after_state: doc.toObject(),
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
  await emitSwapRealtime(populated, "created");

  return res.status(201).json({ success: true, data: populated });
});
export const deleteSwapRequest = asyncHandler(async (req, res) => {
  const currentUser = await getUserWithRole(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const swapRequest = await SwapRequest.findById(req.params.id);
  if (!swapRequest) {
    return res.status(404).json({ success: false, message: "Swap request not found" });
  }

  const role = currentUser.role_id?.role;
  const isRequester = toId(swapRequest.requester_id) === toId(currentUser._id);
  const isManagerOrAdmin = ["manager", "admin"].includes(role);
  if (!isRequester && !isManagerOrAdmin) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  await SwapRequest.findByIdAndDelete(req.params.id);
  await logAuditChange({
    actor_user_id: req.userId,
    entity_type: "swap_request",
    action: "delete",
    before_state: swapRequest.toObject(),
    after_state: null,
  });
  await emitSwapRealtime(swapRequest, "deleted");
  return res.json({ success: true, message: "Swap request deleted" });
});

export const updateSwapRequest = asyncHandler(async (req, res) => {
  const currentUser = await getUserWithRole(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

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

  const existing = await SwapRequest.findById(req.params.id);
  if (!existing) {
    return res.status(404).json({ success: false, message: "Swap request not found" });
  }

  const role = currentUser.role_id?.role;
  const isRequester = toId(existing.requester_id) === toId(currentUser._id);
  const isManagerOrAdmin = ["manager", "admin"].includes(role);
  if (!isRequester && !isManagerOrAdmin) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  const updated = await SwapRequest.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).populate(
    "requester_id from_assignment_id target_user_id requested_assignment_id claimed_by_user_id manager_id"
  );

  await logAuditChange({
    actor_user_id: req.userId,
    entity_type: "swap_request",
    action: "update",
    before_state: existing.toObject(),
    after_state: updated?.toObject ? updated.toObject() : updated,
  });
  await emitSwapRealtime(updated, "updated");

  return res.json({ success: true, data: updated });
});

export const getSwapRequests = asyncHandler(async (req, res) => {
  const currentUser = await getUserWithRole(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  await expireUnclaimedDropRequests();
  const role = currentUser.role_id?.role;
  const filter = {};
  if (role === "staff") {
    filter.$or = [
      { requester_id: currentUser._id },
      { target_user_id: currentUser._id },
      { claimed_by_user_id: currentUser._id },
    ];
  } else if (role === "manager") {
    const managerShiftIds = (
      await ShiftAssignment.find()
        .populate({
          path: "shift_id",
          select: "location_id",
          match: { location_id: { $in: currentUser.location_ids || [] } },
        })
        .select("_id shift_id")
    )
      .filter((item) => item.shift_id)
      .map((item) => item._id);
    filter.$or = [
      { from_assignment_id: { $in: managerShiftIds } },
      { requested_assignment_id: { $in: managerShiftIds } },
    ];
  }

  const docs = await SwapRequest.find(filter)
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
  const currentUser = await getUserWithRole(req.userId);
  if (!currentUser) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  await expireUnclaimedDropRequests();
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

  const role = currentUser.role_id?.role;
  if (role === "staff") {
    const isRelated = [doc.requester_id, doc.target_user_id, doc.claimed_by_user_id]
      .filter(Boolean)
      .some((id) => toId(id) === toId(currentUser._id));
    if (!isRelated) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
  } else if (role === "manager") {
    const assignmentIds = [doc.from_assignment_id, doc.requested_assignment_id]
      .filter(Boolean)
      .map((item) => toId(item));
    if (!assignmentIds.length) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const managerAssignments = await ShiftAssignment.find({
      _id: { $in: assignmentIds },
    }).populate({
      path: "shift_id",
      select: "location_id",
    });
    const hasManagerAccess = managerAssignments.some((item) =>
      currentUser.location_ids.some(
        (locId) => toId(locId) === toId(item?.shift_id?.location_id)
      )
    );
    if (!hasManagerAccess) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
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
  const beforeState = swapRequest.toObject();
  await swapRequest.save();
  await logAuditChange({
    actor_user_id: req.userId,
    entity_type: "swap_request",
    action: "cancel",
    before_state: beforeState,
    after_state: swapRequest.toObject(),
  });
  await emitSwapRealtime(swapRequest, "cancelled");

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

  if (shouldAutoExpireDrop({ swapRequest, shiftStartsAtUtc: fromAssignment.shift_id.starts_at_utc })) {
    swapRequest.status = "expired";
    await swapRequest.save();
    return res.status(409).json({
      success: false,
      message: "Drop request has expired (24 hours before shift start)",
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

  const acceptedSwapRequest = await SwapRequest.findOneAndUpdate(
    {
      _id: swapRequest._id,
      status: "pending_peer_acceptance",
      ...(swapRequest.target_user_id
        ? { target_user_id: swapRequest.target_user_id }
        : {}),
    },
    {
      $set: {
        claimed_by_user_id: currentUser._id,
        target_user_id: swapRequest.target_user_id || currentUser._id,
        status: "pending_manager_approval",
      },
    },
    { new: true }
  );

  if (!acceptedSwapRequest) {
    return res.status(409).json({
      success: false,
      message: "Swap request was updated by another user. Please refresh and retry.",
    });
  }
  await logAuditChange({
    actor_user_id: req.userId,
    entity_type: "swap_request",
    action: "accept",
    before_state: swapRequest.toObject ? swapRequest.toObject() : swapRequest,
    after_state: acceptedSwapRequest.toObject ? acceptedSwapRequest.toObject() : acceptedSwapRequest,
  });
  await emitSwapRealtime(acceptedSwapRequest, "accepted");

  await sendUserNotification({
    user_id: swapRequest.requester_id,
    title: "Swap request accepted",
    message: "Your swap request was accepted and is waiting for manager approval.",
    category: "swap_updated",
    priority: "normal",
    idempotency_key: `swap_accept:${acceptedSwapRequest._id}:${currentUser._id}`,
    data: {
      swap_request_id: acceptedSwapRequest._id.toString(),
      accepted_by_user_id: currentUser._id.toString(),
    },
  });

  return res.json({ success: true, data: acceptedSwapRequest });
});

const releaseProcessingSwapRequest = async (swapRequestId) => {
  await SwapRequest.findByIdAndUpdate(swapRequestId, {
    $set: { status: "pending_manager_approval", manager_id: null },
  });
};

export const managerDecisionSwapRequest = asyncHandler(async (req, res) => {
  const { approve, manager_id } = req.body;

  if (typeof approve !== "boolean") {
    return res.status(400).json({
      success: false,
      message: "approve must be true or false",
    });
  }

  const actorId = manager_id || req.userId;
  const swapRequest = await SwapRequest.findOneAndUpdate(
    {
      _id: req.params.id,
      status: "pending_manager_approval",
    },
    {
      $set: {
        status: "processing",
        manager_id: actorId,
      },
    },
    { new: true }
  )
    .populate({
      path: "from_assignment_id",
      populate: assignmentShiftPopulate,
    })
    .populate({
      path: "requested_assignment_id",
      populate: assignmentShiftPopulate,
    });

  if (!swapRequest) {
    const existing = await SwapRequest.findById(req.params.id).select("_id status");
    if (!existing) {
      return res.status(404).json({ success: false, message: "Swap request not found" });
    }
    return res.status(409).json({
      success: false,
      message: `Swap request is already ${existing.status}`,
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

  if (!approve) {
    const beforeState = swapRequest.toObject();
    swapRequest.status = "rejected";
    await swapRequest.save();
    await logAuditChange({
      actor_user_id: req.userId,
      entity_type: "swap_request",
      action: "manager_reject",
      before_state: beforeState,
      after_state: swapRequest.toObject(),
    });
    await emitSwapRealtime(swapRequest, "rejected");
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
    await releaseProcessingSwapRequest(swapRequest._id);
    return res.status(404).json({
      success: false,
      message: "Original assignment or shift not found",
    });
  }

  if (fromAssignment.status !== "assigned") {
    await releaseProcessingSwapRequest(swapRequest._id);
    return res.status(409).json({
      success: false,
      message: "Original assignment is no longer active",
    });
  }

  if (toId(fromAssignment.user_id) !== toId(swapRequest.requester_id)) {
    await releaseProcessingSwapRequest(swapRequest._id);
    return res.status(409).json({
      success: false,
      message: "Original assignment no longer belongs to requester",
    });
  }

  const incomingUserId = swapRequest.claimed_by_user_id || swapRequest.target_user_id;
  if (!incomingUserId) {
    await releaseProcessingSwapRequest(swapRequest._id);
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
    await releaseProcessingSwapRequest(swapRequest._id);
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
    await releaseProcessingSwapRequest(swapRequest._id);
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
      await releaseProcessingSwapRequest(swapRequest._id);
      return res.status(404).json({
        success: false,
        message: "Requested assignment or shift not found",
      });
    }

    if (requestedAssignment.status !== "assigned") {
      await releaseProcessingSwapRequest(swapRequest._id);
      return res.status(409).json({
        success: false,
        message: "Requested assignment is no longer active",
      });
    }

    if (toId(requestedAssignment.user_id) !== toId(incomingUser._id)) {
      await releaseProcessingSwapRequest(swapRequest._id);
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
      await releaseProcessingSwapRequest(swapRequest._id);
      return res.status(409).json({
        success: false,
        message: "Requester no longer satisfies assignment constraints for requested shift",
        violations: requesterViolations,
      });
    }
  }

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
  await swapRequest.save();
  await logAuditChange({
    actor_user_id: req.userId,
    entity_type: "swap_request",
    action: "manager_approve",
    before_state: null,
    after_state: swapRequest.toObject(),
  });
  await emitSwapRealtime(swapRequest, "approved");

  await sendUserNotification({
    user_id: requesterUser._id,
    title: "Swap request approved",
    message: "Your swap request was approved.",
    category: "swap_updated",
    priority: "high",
    idempotency_key: `swap_approved:${swapRequest._id}:${requesterUser._id}`,
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
    idempotency_key: `swap_assignment:${swapRequest._id}:${incomingUser._id}`,
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
