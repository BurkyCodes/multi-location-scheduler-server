import { Location, User, UserRole } from "../models/index.js";

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

const cycle = (items, index) => items[index % items.length];

const ensureBaseRoles = async () => {
  const requiredRoles = ["admin", "manager", "staff"];
  const existingRoles = await UserRole.find({ role: { $in: requiredRoles } }).select("role");
  const existingRoleSet = new Set(existingRoles.map((item) => item.role));
  const missingRoles = requiredRoles
    .filter((role) => !existingRoleSet.has(role))
    .map((role) => ({ role }));

  if (missingRoles.length) {
    await UserRole.insertMany(missingRoles);
  }
};

const seedDatabaseIfNeeded = async () => {
  // Always backfill required roles, even when one or two already exist.
  await ensureBaseRoles();

  const roles = await UserRole.find().sort({ createdAt: 1 });
  const roleByName = new Map(roles.map((role) => [role.role, role]));

  await ensureSeeded(Location, () =>
    [
      {
        name: "Coastal Eats Los Angeles",
        code: "LAX",
        timezone: "PST",
        address: {
          line_1: "100 Main St",
          city: "Los Angeles",
          state: "California",
          country: "USA",
        },
      },
      {
        name: "Coastal Eats Seattle",
        code: "SEA",
        timezone: "PST",
        address: {
          line_1: "200 Main St",
          city: "Seattle",
          state: "Washington",
          country: "USA",
        },
      },
      {
        name: "Coastal Eats Nairobi",
        code: "NBO",
        timezone: "EAT",
        address: {
          line_1: "300 Main St",
          city: "Nairobi",
          state: "Nairobi County",
          country: "Kenya",
        },
      },
      {
        name: "Coastal Eats Dar es Salaam",
        code: "DAR",
        timezone: "EAT",
        address: {
          line_1: "400 Main St",
          city: "Dar es Salaam",
          state: "Dar es Salaam Region",
          country: "Tanzania",
        },
      },
    ]
  );

  const locations = await Location.find().sort({ createdAt: 1 }).limit(MODEL_TARGET_COUNT);

  await ensureSeeded(User, () =>
    [
      {
        name: "Admin 1",
        email: "admin@example.com",
        country_code: "+1",
        phone_number: "15550000000",
        is_pin_set: false,
        is_phone_verified: true,
        role_id: roleByName.get("admin")?._id,
        location_ids: locations.map((location) => location._id),
        status: "active",
        is_active: true,
      },
      {
        name: "Manager 1",
        email: "manager1@example.com",
        country_code: "+1",
        phone_number: "15550000001",
        is_pin_set: false,
        is_phone_verified: true,
        role_id: roleByName.get("manager")?._id,
        location_ids: [locations[0]?._id].filter(Boolean),
        status: "active",
        is_active: true,
      },
      ...Array.from({ length: MODEL_TARGET_COUNT }, (_, i) => ({
        name: `Staff ${i + 1}`,
        email: `staff${i + 1}@example.com`,
        country_code: i < 2 ? "+1" : "+254",
        phone_number: i < 2 ? `1555000000${i + 2}` : `2547000000${i + 2}`,
        is_pin_set: false,
        is_phone_verified: true,
        role_id: roleByName.get("staff")?._id,
        location_ids: [cycle(locations, i)._id],
        status: "active",
        is_active: true,
      })),
    ]
  );
  console.log("Seed check completed (users and locations only)");
};

export default seedDatabaseIfNeeded;
