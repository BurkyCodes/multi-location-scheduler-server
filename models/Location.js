import mongoose from "mongoose";

const { Schema } = mongoose;

const locationSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Location name is required"],
      trim: true,
    },
    code: {
      type: String,
      required: [true, "Location code is required"],
      trim: true,
      uppercase: true,
    },
    timezone: {
      type: String,
      required: [true, "IANA timezone is required"],
      trim: true,
    },
    address: {
      line_1: { type: String, trim: true },
      line_2: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      postal_code: { type: String, trim: true },
      country: { type: String, trim: true },
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

locationSchema.index({ code: 1 }, { unique: true });

export default mongoose.model("locations", locationSchema);
