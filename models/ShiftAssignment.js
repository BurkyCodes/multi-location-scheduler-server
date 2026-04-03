import mongoose from "mongoose";

const { Schema } = mongoose;

const managerOverrideSchema = new Schema(
  {
    is_override: {
      type: Boolean,
      default: false,
    },
    override_type: {
      type: String,
      enum: ["seventh_consecutive_day"],
    },
    reason: {
      type: String,
      trim: true,
    },
    approved_by: {
      type: Schema.Types.ObjectId,
      ref: "users",
    },
    approved_at: {
      type: Date,
    },
  },
  { _id: false }
);

const shiftAssignmentSchema = new Schema(
  {
    shift_id: {
      type: Schema.Types.ObjectId,
      ref: "shifts",
      required: [true, "Shift is required"],
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: [true, "Assigned staff is required"],
    },
    assigned_by: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: [true, "Assigner is required"],
    },
    source: {
      type: String,
      enum: ["manual", "swap", "drop_pickup", "auto"],
      default: "manual",
    },
    status: {
      type: String,
      enum: ["assigned", "pending_manager_approval", "cancelled"],
      default: "assigned",
    },
    manager_override: {
      type: managerOverrideSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  }
);

shiftAssignmentSchema.index({ shift_id: 1, user_id: 1 }, { unique: true });
shiftAssignmentSchema.index({ user_id: 1, status: 1 });

export default mongoose.model("shift_assignments", shiftAssignmentSchema);
