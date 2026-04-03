import mongoose from "mongoose";

const { Schema } = mongoose;

const userRoleSchema = new Schema(
  {
    role: {
      type: String,
      enum: ["admin", "manager", "staff"],
      required: [true, "Role is required"],
    },
  },
  {
    timestamps: true,
  }
);



export default mongoose.model("user_roles", userRoleSchema);
