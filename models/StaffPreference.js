import mongoose from "mongoose";

const { Schema } = mongoose;

const staffPreferenceSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: [true, "User is required"],
      unique: true,
    },
    desired_hours_per_week: {
      type: Number,
      min: 0,
      default: 40,
    },
    max_hours_per_week: {
      type: Number,
      min: 0,
      default: 40,
    },
    min_hours_per_week: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("staff_preferences", staffPreferenceSchema);
