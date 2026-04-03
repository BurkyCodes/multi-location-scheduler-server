import mongoose from "mongoose";

const { Schema } = mongoose;

const laborAlertSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: [true, "User is required"],
    },
    shift_id: {
      type: Schema.Types.ObjectId,
      ref: "shifts",
    },
    assignment_id: {
      type: Schema.Types.ObjectId,
      ref: "shift_assignments",
    },
    type: {
      type: String,
      enum: [
        "weekly_35_warning",
        "weekly_40_overtime",
        "daily_8_warning",
        "daily_12_block",
        "sixth_day_warning",
        "seventh_day_override_required",
      ],
      required: [true, "Alert type is required"],
    },
    severity: {
      type: String,
      enum: ["warning", "block"],
      required: [true, "Severity is required"],
    },
    message: {
      type: String,
      required: [true, "Message is required"],
      trim: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    resolved_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

laborAlertSchema.index({ user_id: 1, createdAt: -1 });
laborAlertSchema.index({ shift_id: 1, severity: 1 });

export default mongoose.model("labor_alerts", laborAlertSchema);
