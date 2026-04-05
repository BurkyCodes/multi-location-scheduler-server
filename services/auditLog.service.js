import AuditLog from "../models/AuditLog.js";
import Shift from "../models/Shift.js";

const ENTITY_TYPE_BY_COLLECTION = Object.freeze({
  schedules: "schedule",
  shifts: "shift",
  shift_assignments: "shift_assignment",
  swap_requests: "swap_request",
  availabilities: "availability",
  notification_preferences: "notification_preference",
});

const toId = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value._id) return value._id.toString();
  return value.toString();
};

const resolveLocationId = async ({ entityType, beforeState, afterState }) => {
  const directLocationId =
    toId(afterState?.location_id) || toId(beforeState?.location_id) || null;
  if (directLocationId) return directLocationId;

  if (entityType === "shift_assignment") {
    const shiftId = toId(afterState?.shift_id) || toId(beforeState?.shift_id);
    if (!shiftId) return null;
    const shift = await Shift.findById(shiftId).select("location_id");
    return toId(shift?.location_id);
  }

  return null;
};

export const inferAuditEntityType = (Model) => {
  const collection = Model?.collection?.name;
  return ENTITY_TYPE_BY_COLLECTION[collection] || null;
};

export const logAuditChange = async ({
  actor_user_id,
  entity_type,
  action,
  before_state = null,
  after_state = null,
  reason,
}) => {
  if (!actor_user_id || !entity_type || !action) return null;

  const location_id = await resolveLocationId({
    entityType: entity_type,
    beforeState: before_state,
    afterState: after_state,
  });

  const entity_id =
    toId(after_state?._id) || toId(after_state?.id) || toId(before_state?._id) || toId(before_state?.id);

  return AuditLog.create({
    actor_user_id,
    location_id,
    entity_type,
    entity_id: entity_id || undefined,
    action,
    before_state,
    after_state,
    reason,
  });
};
