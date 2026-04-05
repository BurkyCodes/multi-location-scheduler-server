import mongoose from "mongoose";

const { Schema } = mongoose;

const notificationSchema = new Schema(
  {
    org_user_id: {
      type: String,
      index: true,
    },
    garage_id: {
      type: String,
    },
    channel_id: {
      type: String,
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "users",
    },
    type: {
      type: String,
      enum: [
        "in-app",
        "push",
        "email",
        "sms",
        "whatsapp",
        "shift_assigned",
        "shift_changed",
        "schedule_published",
        "swap_requested",
        "swap_updated",
        "coverage_needed",
        "overtime_warning",
        "availability_changed",
      ],
    },
    category: {
      type: String,
    },
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
    },
    title: {
      type: String,
      trim: true,
    },
    message: {
      type: String,
      trim: true,
    },
    channel: {
      type: String,
      enum: ["in_app", "email", "push", "sms", "whatsapp"],
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
    data: {
      type: Schema.Types.Mixed,
      default: {},
    },
    idempotency_key: {
      type: String,
      trim: true,
      default: null,
    },
    icon: {
      type: String,
    },
    link: {
      type: String,
    },
    delivery_status: {
      type: String,
      enum: ["sent", "failed", "pending"],
      default: "sent",
    },
    status: {
      type: String,
      enum: ["read", "unread", "deleted"],
      default: "unread",
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
notificationSchema.index({ org_user_id: 1, status: 1, createdAt: -1 });
notificationSchema.index(
  { user_id: 1, idempotency_key: 1 },
  {
    unique: true,
    partialFilterExpression: {
      idempotency_key: { $type: "string" },
    },
  }
);

export default mongoose.model("notifications", notificationSchema);
