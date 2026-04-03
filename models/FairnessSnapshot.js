import mongoose from "mongoose";

const { Schema } = mongoose;

const staffFairnessMetricSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    assigned_hours: {
      type: Number,
      default: 0,
      min: 0,
    },
    desired_hours: {
      type: Number,
      default: 0,
      min: 0,
    },
    premium_shift_count: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
);

const fairnessSnapshotSchema = new Schema(
  {
    location_id: {
      type: Schema.Types.ObjectId,
      ref: "locations",
    },
    period_start: {
      type: Date,
      required: [true, "Period start is required"],
    },
    period_end: {
      type: Date,
      required: [true, "Period end is required"],
    },
    fairness_score: {
      type: Number,
      min: 0,
      max: 100,
      required: [true, "Fairness score is required"],
    },
    metrics: {
      type: [staffFairnessMetricSchema],
      default: [],
    },
    generated_by: {
      type: Schema.Types.ObjectId,
      ref: "users",
    },
  },
  {
    timestamps: true,
  }
);

fairnessSnapshotSchema.index({ location_id: 1, period_start: 1, period_end: 1 });

export default mongoose.model("fairness_snapshots", fairnessSnapshotSchema);
