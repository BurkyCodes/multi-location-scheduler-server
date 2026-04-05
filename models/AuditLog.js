import mongoose from "mongoose";

const { Schema } = mongoose;

const auditLogSchema = new Schema(
  {
    actor_user_id: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: [true, "Actor user is required"],
    },
    location_id: {
      type: Schema.Types.ObjectId,
      ref: "locations",
    },
    entity_type: {
      type: String,
      enum: [
        "schedule",
        "shift",
        "shift_assignment",
        "swap_request",
        "availability",
        "notification_preference",
      ],
      required: [true, "Entity type is required"],
    },
    entity_id: {
      type: Schema.Types.Mixed,
      default: null,
    },
    action: {
      type: String,
      required: [true, "Action is required"],
      trim: true,
    },
    before_state: {
      type: Schema.Types.Mixed,
      default: null,
    },
    after_state: {
      type: Schema.Types.Mixed,
      default: null,
    },
    reason: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

auditLogSchema.index({ location_id: 1, createdAt: -1 });
auditLogSchema.index({ entity_type: 1, entity_id: 1, createdAt: -1 });

export default mongoose.model("audit_logs", auditLogSchema);
