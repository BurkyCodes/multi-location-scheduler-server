import mongoose from "mongoose";

const { Schema } = mongoose;
const MAX_LOCATIONS = 4;

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

locationSchema.pre("save", async function enforceMaxLocations() {
  if (!this.isNew) {
    return;
  }

  const currentCount = await this.constructor.countDocuments();
  if (currentCount >= MAX_LOCATIONS) {
    throw new Error(`A maximum of ${MAX_LOCATIONS} locations is allowed`);
  }
});

locationSchema.pre("insertMany", async function enforceMaxLocationsBulk(docs) {
  const incomingDocs = Array.isArray(docs) ? docs.length : 0;
  if (incomingDocs === 0) {
    return;
  }

  const currentCount = await this.countDocuments();
  if (currentCount + incomingDocs > MAX_LOCATIONS) {
    throw new Error(`A maximum of ${MAX_LOCATIONS} locations is allowed`);
  }
});

export default mongoose.model("locations", locationSchema);
