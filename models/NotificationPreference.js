import mongoose from "mongoose";

const { Schema } = mongoose;

const notificationPreferenceSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: [true, "User is required"],
      unique: true,
    },
    channels: {
      in_app: {
        type: Boolean,
        default: true,
      },
      email: {
        type: Boolean,
        default: false,
      },
    },
    events: {
      shift_assigned: { type: Boolean, default: true },
      shift_changed: { type: Boolean, default: true },
      schedule_published: { type: Boolean, default: true },
      swap_updates: { type: Boolean, default: true },
      overtime_warnings: { type: Boolean, default: true },
      availability_changes: { type: Boolean, default: true },
    },
  },
  {
    timestamps: true,
  }
);

notificationPreferenceSchema.index({ user_id: 1 });

export default mongoose.model(
  "notification_preferences",
  notificationPreferenceSchema
);
