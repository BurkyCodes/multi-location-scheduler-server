import ShiftAssignment from "../models/ShiftAssignment.js";
import { sendUserNotification } from "../services/notificationEvents.service.js";

let reminderJobTimer = null;
let reminderJobRunning = false;

const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const WINDOW_TOLERANCE_MS = 60 * 1000;

const toIsoTime = (value) => new Date(value).toISOString();

const runReminderTick = async () => {
  if (reminderJobRunning) return;
  reminderJobRunning = true;

  try {
    const now = new Date();
    const targetStartMin = new Date(now.getTime() + THIRTY_MINUTES_MS - WINDOW_TOLERANCE_MS);
    const targetStartMax = new Date(now.getTime() + THIRTY_MINUTES_MS + WINDOW_TOLERANCE_MS);

    const assignments = await ShiftAssignment.find({
      status: "assigned",
      reminder_30min_sent_at: null,
    }).populate({
      path: "shift_id",
      select: "starts_at_utc location_id",
      match: {
        starts_at_utc: {
          $gte: targetStartMin,
          $lte: targetStartMax,
        },
      },
    });

    const actionable = assignments.filter((item) => item.shift_id);
    for (const assignment of actionable) {
      await sendUserNotification({
        user_id: assignment.user_id,
        title: "Shift starts in 30 minutes",
        message: "Your assigned shift starts in 30 minutes. Please prepare to clock in.",
        category: "shift_start_reminder",
        priority: "high",
        data: {
          assignment_id: assignment._id.toString(),
          shift_id: assignment.shift_id._id.toString(),
          starts_at_utc: toIsoTime(assignment.shift_id.starts_at_utc),
        },
      });

      assignment.reminder_30min_sent_at = now;
      await assignment.save();
    }
  } catch (error) {
    console.error("Shift reminder job error:", error.message);
  } finally {
    reminderJobRunning = false;
  }
};

export const startShiftReminderJob = ({ intervalMs = 60000 } = {}) => {
  if (reminderJobTimer) {
    return reminderJobTimer;
  }

  reminderJobTimer = setInterval(runReminderTick, intervalMs);
  return reminderJobTimer;
};

export const stopShiftReminderJob = () => {
  if (reminderJobTimer) {
    clearInterval(reminderJobTimer);
    reminderJobTimer = null;
  }
};
