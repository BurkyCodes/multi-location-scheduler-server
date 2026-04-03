import mongoose from "mongoose";

const { Schema } = mongoose;

const recurringWindowSchema = new Schema(
  {
    weekday: {
      type: Number,
      min: 0,
      max: 6,
      required: true,
    },
    start_time_local: {
      type: String,
      required: true,
    },
    end_time_local: {
      type: String,
      required: true,
    },
    timezone: {
      type: String,
      required: true,
      trim: true,
    },
    location_id: {
      type: Schema.Types.ObjectId,
      ref: "locations",
    },
  },
  { _id: false }
);

const availabilityExceptionSchema = new Schema(
  {
    date: {
      type: String,
      required: true,
    },
    start_time_local: {
      type: String,
    },
    end_time_local: {
      type: String,
    },
    is_available: {
      type: Boolean,
      required: true,
    },
    timezone: {
      type: String,
      required: true,
      trim: true,
    },
    location_id: {
      type: Schema.Types.ObjectId,
      ref: "locations",
    },
    reason: {
      type: String,
      trim: true,
    },
  },
  { _id: false }
);

const availabilitySchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: [true, "User is required"],
      unique: true,
    },
    recurring_windows: {
      type: [recurringWindowSchema],
      default: [],
    },
    exceptions: {
      type: [availabilityExceptionSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

availabilitySchema.index({ user_id: 1 });

export default mongoose.model("availabilities", availabilitySchema);
