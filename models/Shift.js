import mongoose from "mongoose";

const { Schema } = mongoose;

const shiftSchema = new Schema(
  {
    schedule_id: {
      type: Schema.Types.ObjectId,
      ref: "schedules",
      required: [true, "Schedule is required"],
    },
    location_id: {
      type: Schema.Types.ObjectId,
      ref: "locations",
      required: [true, "Location is required"],
    },
    required_skill_id: {
      type: Schema.Types.ObjectId,
      ref: "skills",
      required: [true, "Required skill is required"],
    },
    starts_at_utc: {
      type: Date,
      required: [true, "Shift start is required"],
    },
    ends_at_utc: {
      type: Date,
      required: [true, "Shift end is required"],
      validate: {
        validator(value) {
          return value > this.starts_at_utc;
        },
        message: "Shift end must be after shift start",
      },
    },
    location_timezone: {
      type: String,
      required: [true, "Location timezone is required"],
    },
    headcount_required: {
      type: Number,
      min: 1,
      required: [true, "Headcount is required"],
    },
    is_premium: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ["open", "filled", "cancelled"],
      default: "open",
    },
    created_by: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: [true, "Creator is required"],
    },
    updated_by: {
      type: Schema.Types.ObjectId,
      ref: "users",
    },
  },
  {
    timestamps: true,
  }
);

shiftSchema.index({ location_id: 1, starts_at_utc: 1, ends_at_utc: 1 });
shiftSchema.index({ schedule_id: 1, status: 1 });
shiftSchema.index({ required_skill_id: 1, starts_at_utc: 1 });

export default mongoose.model("shifts", shiftSchema);
