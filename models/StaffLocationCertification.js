import mongoose from "mongoose";

const { Schema } = mongoose;

const staffLocationCertificationSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: [true, "Staff user is required"],
    },
    location_id: {
      type: Schema.Types.ObjectId,
      ref: "locations",
      required: [true, "Location is required"],
    },
    certified_by: {
      type: Schema.Types.ObjectId,
      ref: "users",
    },
    certified_at: {
      type: Date,
      default: Date.now,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    decertified_at: {
      type: Date,
      default: null,
    },
    decertified_by: {
      type: Schema.Types.ObjectId,
      ref: "users",
      default: null,
    },
    decertified_reason: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

staffLocationCertificationSchema.index({ user_id: 1, location_id: 1 }, { unique: true });
staffLocationCertificationSchema.index({ location_id: 1, is_active: 1 });

export default mongoose.model(
  "staff_location_certifications",
  staffLocationCertificationSchema
);
