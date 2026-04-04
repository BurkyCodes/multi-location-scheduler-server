import mongoose from "mongoose";
const Schema = mongoose.Schema;

const userSchema = Schema(
  {
    name: {
      type: String,
      required: false,
    },
    email: {
      type: String,
      required: false,
    },
    country_code: {
      type: String,
      required: false,
      trim: true,
      validate: {
        validator(value) {
          if (!value) return true;
          return /^\+\d{1,4}$/.test(value);
        },
        message: "country_code must be in international format like +1",
      },
    },
    phone_number: {
      type: String,
      required: [true, "Phone number is required"],
    },
    password: {
      type: String,
      required: false,
      select: false,
    },
    is_pin_set: {
      type: Boolean,
      default: false,
    },
    failed_attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ["active", "deactivated"],
      default: "active",
    },
    access_token: {
      type: String,
      required: false,
    },
    refresh_token: {
      type: String,
      required: false,
    },
    is_phone_verified: {
      type: Boolean,
      default: false,
    },
    otp_code: {
      type: String,
      required: false,
      select: false,
    },
    otp_type: {
      type: String,
      required: false,
      select: false,
    },
    otp_expires_at: {
      type: Date,
      required: false,
      select: false,
    },
    role_id: {
      type: Schema.Types.ObjectId,
      ref: "user_roles",
      required: false,
    },
    location_ids: [
      {
        type: Schema.Types.ObjectId,
        ref: "locations",
      },
    ],
    is_active: {
      type: Boolean,
      default: true,
    },
    assignment_lock_until: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

// create index for phone_number
userSchema.index({ phone_number: 1 }, { unique: true });

export default mongoose.model("users", userSchema);
