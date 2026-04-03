import mongoose from "mongoose";

const { Schema } = mongoose;

const notificationSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: [true, "Recipient user is required"],
    },
    type: {
      type: String,
      enum: [
        "shift_assigned",
        "shift_changed",
        "schedule_published",
        "swap_requested",
        "swap_updated",
        "coverage_needed",
        "overtime_warning",
        "availability_changed",
      ],
      required: [true, "Notification type is required"],
    },
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
    },
    message: {
      type: String,
      required: [true, "Message is required"],
      trim: true,
    },
    channel: {
      type: String,
      enum: ["in_app", "email"],
      default: "in_app",
    },
    related_shift_id: {
      type: Schema.Types.ObjectId,
      ref: "shifts",
    },
    related_swap_request_id: {
      type: Schema.Types.ObjectId,
      ref: "swap_requests",
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    read_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

notificationSchema.index({ user_id: 1, createdAt: -1 });
notificationSchema.index({ user_id: 1, read_at: 1 });

export default mongoose.model("notifications", notificationSchema);
