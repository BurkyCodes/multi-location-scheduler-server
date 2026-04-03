import mongoose from "mongoose";

const { Schema } = mongoose;

const skillSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Skill name is required"],
      trim: true,
    },
    code: {
      type: String,
      required: [true, "Skill code is required"],
      trim: true,
      lowercase: true,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

skillSchema.index({ code: 1 }, { unique: true });

export default mongoose.model("skills", skillSchema);
