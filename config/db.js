import mongoose from "mongoose";

const connectDB = async () => {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    throw new Error("MONGO_URI is missing in environment variables");
  }

  try {
    await mongoose.connect(uri, {
      family: 4,
      tls: true,
      tlsAllowInvalidCertificates: false,
      serverSelectionTimeoutMS: 10000,
    });

    console.log("MongoDB connected");
  } catch (error) {
    const atlasLikelyIssue =
      error?.name === "MongooseServerSelectionError" &&
      uri.includes("mongodb+srv://");

    if (atlasLikelyIssue) {
      console.error("Failed to connect to MongoDB Atlas.");
      console.error(
        "Check Atlas Network Access (IP whitelist), DB user/password, and connection string."
      );
      console.error(
        "Atlas Network Access: https://www.mongodb.com/docs/atlas/security/ip-access-list/"
      );
    }

    throw error;
  }
};

export default connectDB;
