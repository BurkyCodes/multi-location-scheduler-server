import mongoose from "mongoose";

const { Schema } = mongoose;

const deviceTokenSchema = new Schema(
  {
    org_user_id: {
      type: String,
      required: true,
      index: true,
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "users",
    },
    garage_id: {
      type: String,
    },
    fcm_token: {
      type: String,
      required: true,
      unique: true,
    },
    device_type: {
      type: String,
      enum: ["web", "android", "ios"],
      default: "web",
    },
    device_name: {
      type: String,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

deviceTokenSchema.index({ org_user_id: 1, is_active: 1 });

export default mongoose.model("device_tokens", deviceTokenSchema);
