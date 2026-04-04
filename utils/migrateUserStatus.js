import User from "../models/User.js";

const migrateUserStatus = async () => {
  // Convert legacy array statuses (e.g. [], ["account_locked"]) to the new enum string.
  await User.collection.updateMany(
    { status: { $type: "array" } },
    [
      {
        $set: {
          status: {
            $cond: [{ $in: ["deactivated", "$status"] }, "deactivated", "active"],
          },
          failed_attempts: {
            $cond: [
              { $in: ["account_locked", "$status"] },
              { $max: [{ $ifNull: ["$failed_attempts", 0] }, 3] },
              { $ifNull: ["$failed_attempts", 0] },
            ],
          },
        },
      },
    ]
  );

  // Ensure missing/null/empty statuses are set to active.
  await User.collection.updateMany(
    {
      $or: [{ status: { $exists: false } }, { status: null }, { status: "" }],
    },
    { $set: { status: "active" } }
  );
};

export default migrateUserStatus;
