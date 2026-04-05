import dotenv from "dotenv";
import connectDB from "./config/db.js";
import { createApp } from "./app.js";
import seedDatabaseIfNeeded from "./utils/seedData.js";
import migrateUserStatus from "./utils/migrateUserStatus.js";
import { startShiftReminderJob } from "./utils/shiftReminderJob.js";

dotenv.config();

const app = createApp();
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();
    await migrateUserStatus();
    await seedDatabaseIfNeeded();
    startShiftReminderJob();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Swagger docs: http://localhost:${PORT}/api/docs`);
    });
  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
};

startServer();
