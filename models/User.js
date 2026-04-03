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
    },
    phone_number: {
      type: String,
      required: [true, "Phone number is required"],
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
  },
  {
    timestamps: true,
  },
);

// create index for phone_number
userSchema.index({ phone_number: 1 }, { unique: true });

export default mongoose.model("users", userSchema);
