import mongoose from "mongoose";

const { Schema } = mongoose;

const clockEventSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: [true, "User is required"],
    },
    shift_id: {
      type: Schema.Types.ObjectId,
      ref: "shifts",
      required: [true, "Shift is required"],
    },
    location_id: {
      type: Schema.Types.ObjectId,
      ref: "locations",
      required: [true, "Location is required"],
    },
    type: {
      type: String,
      enum: ["clock_in", "clock_out"],
      required: [true, "Clock event type is required"],
    },
    event_at_utc: {
      type: Date,
      required: [true, "Event time is required"],
    },
    source: {
      type: String,
      enum: ["staff", "manager", "system"],
      default: "staff",
    },
  },
  {
    timestamps: true,
  }
);

clockEventSchema.index({ location_id: 1, event_at_utc: -1 });
clockEventSchema.index({ shift_id: 1, user_id: 1, event_at_utc: 1 });

export default mongoose.model("clock_events", clockEventSchema);
