import {
  AuditLog,
  Availability,
  ClockEvent,
  FairnessSnapshot,
  LaborAlert,
  Location,
  Notification,
  NotificationPreference,
  Schedule,
  Shift,
  ShiftAssignment,
  Skill,
  StaffLocationCertification,
  StaffPreference,
  StaffSkill,
  SwapRequest,
  User,
  UserRole,
} from "../models/index.js";

const MODEL_TARGET_COUNT = 4;

const ensureSeeded = async (Model, createDocs) => {
  const existingCount = await Model.countDocuments();
  if (existingCount > 0) {
    return { seeded: false, count: existingCount };
  }

  const docs = createDocs();
  if (!Array.isArray(docs) || docs.length === 0) {
    return { seeded: false, count: 0 };
  }

  await Model.insertMany(docs);
  return { seeded: true, count: docs.length };
};

const getReferenceDocs = async (Model) =>
  Model.find().sort({ createdAt: 1 }).limit(MODEL_TARGET_COUNT);

const cycle = (items, index) => items[index % items.length];

const seedDatabaseIfNeeded = async () => {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;

  await ensureSeeded(UserRole, () => [
    { role: "admin" },
    { role: "manager" },
    { role: "staff" },
    { role: "staff" },
    { role: "manager" },
  ]);

  await ensureSeeded(Location, () =>
    Array.from({ length: MODEL_TARGET_COUNT }, (_, i) => ({
      name: `Coastal Eats Location ${i + 1}`,
      code: `LOC${i + 1}`,
      timezone: i % 2 === 0 ? "Africa/Nairobi" : "Africa/Dar_es_Salaam",
      address: {
        line_1: `${100 + i} Main St`,
        city: i % 2 === 0 ? "Nairobi" : "Dar es Salaam",
        state: i % 2 === 0 ? "Nairobi County" : "Dar es Salaam Region",
        country: i % 2 === 0 ? "Kenya" : "Tanzania",
      },
    }))
  );

  await ensureSeeded(Skill, () =>
    [
      ["Front Desk", "front_desk"],
      ["Kitchen", "kitchen"],
      ["Cashier", "cashier"],
      ["Delivery", "delivery"],
      ["Inventory", "inventory"],
    ].map(([name, code]) => ({ name, code }))
  );

  const roles = await getReferenceDocs(UserRole);
  const locations = await getReferenceDocs(Location);
  const skills = await getReferenceDocs(Skill);

  await ensureSeeded(User, () =>
    Array.from({ length: MODEL_TARGET_COUNT }, (_, i) => ({
      name: `Staff ${i + 1}`,
      email: `staff${i + 1}@example.com`,
      country_code: "+254",
      phone_number: `2547000000${i + 1}`,
      is_pin_set: false,
      is_phone_verified: true,
      role_id: cycle(roles, i)._id,
      location_ids: [cycle(locations, i)._id],
      status: "active",
      is_active: true,
    }))
  );

  const users = await getReferenceDocs(User);

  await ensureSeeded(StaffSkill, () =>
    Array.from({ length: MODEL_TARGET_COUNT }, (_, i) => ({
      user_id: cycle(users, i)._id,
      skill_id: cycle(skills, i)._id,
      verified_by: users[0]?._id,
      is_active: true,
    }))
  );

  await ensureSeeded(StaffLocationCertification, () =>
    Array.from({ length: MODEL_TARGET_COUNT }, (_, i) => ({
      user_id: cycle(users, i)._id,
      location_id: cycle(locations, i)._id,
      certified_by: users[0]?._id,
      certified_at: new Date(now - i * oneDay),
      is_active: true,
    }))
  );

  await ensureSeeded(Availability, () =>
    Array.from({ length: MODEL_TARGET_COUNT }, (_, i) => ({
      user_id: cycle(users, i)._id,
      recurring_windows: [
        {
          weekday: i % 7,
          start_time_local: "09:00",
          end_time_local: "17:00",
          timezone: cycle(locations, i).timezone,
          location_id: cycle(locations, i)._id,
        },
      ],
      exceptions: [],
    }))
  );

  await ensureSeeded(StaffPreference, () =>
    Array.from({ length: MODEL_TARGET_COUNT }, (_, i) => ({
      user_id: cycle(users, i)._id,
      desired_hours_per_week: 35 + i,
      max_hours_per_week: 40 + i,
      min_hours_per_week: 20,
    }))
  );

  await ensureSeeded(NotificationPreference, () =>
    Array.from({ length: MODEL_TARGET_COUNT }, (_, i) => ({
      user_id: cycle(users, i)._id,
      channels: {
        in_app: true,
        email: i % 2 === 0,
      },
      events: {
        shift_assigned: true,
        shift_changed: true,
        schedule_published: true,
        swap_updates: true,
        overtime_warnings: true,
        availability_changes: true,
      },
    }))
  );

  await ensureSeeded(Schedule, () =>
    Array.from({ length: MODEL_TARGET_COUNT }, (_, i) => ({
      location_id: cycle(locations, i)._id,
      week_start_date: new Date(now + i * 7 * oneDay),
      status: i % 2 === 0 ? "published" : "draft",
      edit_cutoff_hours: 48,
      published_by: users[0]?._id,
      published_at: i % 2 === 0 ? new Date(now - i * oneDay) : null,
    }))
  );

  const schedules = await getReferenceDocs(Schedule);

  await ensureSeeded(Shift, () =>
    Array.from({ length: MODEL_TARGET_COUNT }, (_, i) => {
      const startsAt = new Date(now + (i + 1) * oneDay);
      const endsAt = new Date(startsAt.getTime() + 8 * 60 * 60 * 1000);
      return {
        schedule_id: cycle(schedules, i)._id,
        location_id: cycle(locations, i)._id,
        required_skill_id: cycle(skills, i)._id,
        starts_at_utc: startsAt,
        ends_at_utc: endsAt,
        location_timezone: cycle(locations, i).timezone,
        headcount_required: 2,
        is_premium: i % 2 === 0,
        status: "open",
        created_by: users[0]?._id,
        updated_by: users[1]?._id,
      };
    })
  );

  const shifts = await getReferenceDocs(Shift);

  await ensureSeeded(ShiftAssignment, () =>
    Array.from({ length: MODEL_TARGET_COUNT }, (_, i) => ({
      shift_id: cycle(shifts, i)._id,
      user_id: cycle(users, i)._id,
      assigned_by: users[1]?._id || users[0]?._id,
      source: "manual",
      status: "assigned",
      manager_override: { is_override: false },
    }))
  );

  const assignments = await getReferenceDocs(ShiftAssignment);

  await ensureSeeded(SwapRequest, () =>
    Array.from({ length: MODEL_TARGET_COUNT }, (_, i) => ({
      type: cycle(["swap", "drop", "pickup"], i),
      status: "pending_peer_acceptance",
      requester_id: cycle(users, i)._id,
      from_assignment_id: cycle(assignments, i)._id,
      target_user_id: cycle(users, i + 1)._id,
      requested_assignment_id: cycle(assignments, i + 1)._id,
      manager_id: users[1]?._id || users[0]?._id,
      expires_at: new Date(now + (i + 2) * oneDay),
      note: `Swap request ${i + 1}`,
    }))
  );

  const swapRequests = await getReferenceDocs(SwapRequest);

  await ensureSeeded(LaborAlert, () =>
    Array.from({ length: MODEL_TARGET_COUNT }, (_, i) => ({
      user_id: cycle(users, i)._id,
      shift_id: cycle(shifts, i)._id,
      assignment_id: cycle(assignments, i)._id,
      type: cycle(
        [
          "weekly_35_warning",
          "weekly_40_overtime",
          "daily_8_warning",
          "daily_12_block",
          "sixth_day_warning",
        ],
        i
      ),
      severity: i % 3 === 0 ? "block" : "warning",
      message: `Labor alert ${i + 1}`,
      metadata: { source: "seed" },
      resolved_at: null,
    }))
  );

  await ensureSeeded(FairnessSnapshot, () =>
    Array.from({ length: MODEL_TARGET_COUNT }, (_, i) => ({
      location_id: cycle(locations, i)._id,
      period_start: new Date(now - (i + 7) * oneDay),
      period_end: new Date(now - i * oneDay),
      fairness_score: 70 + i,
      metrics: [
        {
          user_id: cycle(users, i)._id,
          assigned_hours: 30 + i,
          desired_hours: 35,
          premium_shift_count: i % 3,
        },
      ],
      generated_by: users[0]?._id,
    }))
  );

  await ensureSeeded(Notification, () =>
    Array.from({ length: MODEL_TARGET_COUNT }, (_, i) => ({
      user_id: cycle(users, i)._id,
      type: cycle(
        [
          "shift_assigned",
          "shift_changed",
          "schedule_published",
          "swap_updated",
          "overtime_warning",
        ],
        i
      ),
      title: `Notification ${i + 1}`,
      message: `This is seeded notification ${i + 1}`,
      channel: i % 2 === 0 ? "in_app" : "email",
      related_shift_id: cycle(shifts, i)._id,
      related_swap_request_id: cycle(swapRequests, i)._id,
      metadata: { seeded: true },
      read_at: null,
    }))
  );

  await ensureSeeded(ClockEvent, () =>
    Array.from({ length: MODEL_TARGET_COUNT }, (_, i) => ({
      user_id: cycle(users, i)._id,
      shift_id: cycle(shifts, i)._id,
      location_id: cycle(locations, i)._id,
      type: i % 2 === 0 ? "clock_in" : "clock_out",
      event_at_utc: new Date(now - i * oneDay),
      source: "system",
    }))
  );

  await ensureSeeded(AuditLog, () =>
    Array.from({ length: MODEL_TARGET_COUNT }, (_, i) => ({
      actor_user_id: cycle(users, i)._id,
      location_id: cycle(locations, i)._id,
      entity_type: cycle(
        [
          "schedule",
          "shift",
          "shift_assignment",
          "swap_request",
          "availability",
        ],
        i
      ),
      action: `seed_action_${i + 1}`,
      before_state: null,
      after_state: { seeded: true, index: i + 1 },
      reason: "Initial startup seed",
    }))
  );

  console.log("Seed check completed");
};

export default seedDatabaseIfNeeded;
