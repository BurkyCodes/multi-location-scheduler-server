import mongoose from "mongoose";

const { Schema } = mongoose;

const swapRequestSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["swap", "drop", "pickup"],
      required: [true, "Request type is required"],
    },
    status: {
      type: String,
      enum: [
        "pending_peer_acceptance",
        "pending_manager_approval",
        "processing",
        "approved",
        "rejected",
        "cancelled",
        "expired",
      ],
      default: "pending_peer_acceptance",
    },
    requester_id: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: [true, "Requester is required"],
    },
    from_assignment_id: {
      type: Schema.Types.ObjectId,
      ref: "shift_assignments",
      required: [true, "Original assignment is required"],
    },
    target_user_id: {
      type: Schema.Types.ObjectId,
      ref: "users",
    },
    requested_assignment_id: {
      type: Schema.Types.ObjectId,
      ref: "shift_assignments",
    },
    claimed_by_user_id: {
      type: Schema.Types.ObjectId,
      ref: "users",
    },
    manager_id: {
      type: Schema.Types.ObjectId,
      ref: "users",
    },
    expires_at: {
      type: Date,
    },
    cancelled_reason: {
      type: String,
      trim: true,
    },
    note: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

swapRequestSchema.index({ requester_id: 1, status: 1 });
swapRequestSchema.index({ from_assignment_id: 1, status: 1 });
swapRequestSchema.index({ expires_at: 1, status: 1 });

export default mongoose.model("swap_requests", swapRequestSchema);
