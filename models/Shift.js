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
          // During update validators (findOneAndUpdate/findByIdAndUpdate),
          // `this` is a Query, not a document.
          const startsAtRaw =
            this instanceof mongoose.Query ? this.get("starts_at_utc") : this.starts_at_utc;
          if (!startsAtRaw) {
            return true;
          }

          const startsAt = new Date(startsAtRaw);
          const endsAt = new Date(value);
          if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
            return false;
          }

          return endsAt > startsAt;
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
