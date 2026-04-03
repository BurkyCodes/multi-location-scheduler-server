import mongoose from "mongoose";

const { Schema } = mongoose;

const staffSkillSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: [true, "Staff user is required"],
    },
    skill_id: {
      type: Schema.Types.ObjectId,
      ref: "skills",
      required: [true, "Skill is required"],
    },
    verified_by: {
      type: Schema.Types.ObjectId,
      ref: "users",
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

staffSkillSchema.index({ user_id: 1, skill_id: 1 }, { unique: true });
staffSkillSchema.index({ skill_id: 1, is_active: 1 });

export default mongoose.model("staff_skills", staffSkillSchema);
