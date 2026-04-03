import mongoose from "mongoose";

const { Schema } = mongoose;

const scheduleSchema = new Schema(
  {
    location_id: {
      type: Schema.Types.ObjectId,
      ref: "locations",
      required: [true, "Location is required"],
    },
    week_start_date: {
      type: Date,
      required: [true, "Week start date is required"],
    },
    status: {
      type: String,
      enum: ["draft", "published", "unpublished"],
      default: "draft",
    },
    edit_cutoff_hours: {
      type: Number,
      default: 48,
      min: 0,
    },
    published_by: {
      type: Schema.Types.ObjectId,
      ref: "users",
    },
    published_at: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

scheduleSchema.index({ location_id: 1, week_start_date: 1 }, { unique: true });
scheduleSchema.index({ status: 1, week_start_date: 1 });

export default mongoose.model("schedules", scheduleSchema);
