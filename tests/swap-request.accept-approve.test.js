import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import request from "supertest";

import { createApp } from "../app.js";
import UserRole from "../models/UserRole.js";
import User from "../models/User.js";
import Location from "../models/Location.js";
import Skill from "../models/Skill.js";
import Schedule from "../models/Schedule.js";
import Shift from "../models/Shift.js";
import ShiftAssignment from "../models/ShiftAssignment.js";
import SwapRequest from "../models/SwapRequest.js";
import StaffSkill from "../models/StaffSkill.js";
import StaffLocationCertification from "../models/StaffLocationCertification.js";
import Availability from "../models/Availability.js";
import StaffPreference from "../models/StaffPreference.js";

process.env.LOGIN_SECRET = process.env.LOGIN_SECRET || "test_login_secret";

const signToken = (userId) =>
  jwt.sign({ id: userId.toString(), userOrgId: "org-test" }, process.env.LOGIN_SECRET);

const authHeader = (userId) => ({ Authorization: `Bearer ${signToken(userId)}` });

const run = async () => {
  const mongoUri = process.env.INTEGRATION_TEST_MONGO_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("Set INTEGRATION_TEST_MONGO_URI (or MONGO_URI) before running this test");
  }

  const runId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  await mongoose.connect(mongoUri, { dbName: process.env.INTEGRATION_TEST_DB_NAME || undefined });
  const app = createApp();
  const createdIds = {
    roles: [],
    users: [],
    locations: [],
    skills: [],
    schedules: [],
    shifts: [],
    assignments: [],
    swaps: [],
    staffSkills: [],
    staffCerts: [],
    availabilities: [],
    preferences: [],
  };

  try {
    const [staffRole, managerRole] = await Promise.all([
      UserRole.create({ role: "staff" }),
      UserRole.create({ role: "manager" }),
    ]);
    createdIds.roles.push(staffRole._id, managerRole._id);

    const [requester, accepter, manager] = await Promise.all([
      User.create({
        name: `Requester ${runId}`,
        phone_number: `+1111${runId}`,
        role_id: staffRole._id,
        status: "active",
        is_active: true,
      }),
      User.create({
        name: `Accepter ${runId}`,
        phone_number: `+1222${runId}`,
        role_id: staffRole._id,
        status: "active",
        is_active: true,
      }),
      User.create({
        name: `Manager ${runId}`,
        phone_number: `+1333${runId}`,
        role_id: managerRole._id,
        status: "active",
        is_active: true,
      }),
    ]);
    createdIds.users.push(requester._id, accepter._id, manager._id);

    const location = await Location.create({
      name: `Main Garage ${runId}`,
      code: `M${String(runId).slice(-2)}`,
      timezone: "Africa/Nairobi",
    });
    createdIds.locations.push(location._id);

    manager.location_ids = [location._id];
    await manager.save();

    const skill = await Skill.create({ name: `Mechanic ${runId}`, code: `mech_${runId}` });
    createdIds.skills.push(skill._id);
    const schedule = await Schedule.create({
      location_id: location._id,
      week_start_date: new Date("2026-04-06T00:00:00.000Z"),
      status: "draft",
      edit_cutoff_hours: 48,
    });
    createdIds.schedules.push(schedule._id);
    const shift = await Shift.create({
      schedule_id: schedule._id,
      location_id: location._id,
      required_skill_id: skill._id,
      starts_at_utc: new Date("2026-04-08T06:00:00.000Z"),
      ends_at_utc: new Date("2026-04-08T14:00:00.000Z"),
      location_timezone: "EAT",
      headcount_required: 1,
      created_by: manager._id,
    });
    createdIds.shifts.push(shift._id);

    const createdStaffSkill = await Promise.all([
      StaffSkill.create({ user_id: requester._id, skill_id: skill._id, is_active: true }),
      StaffSkill.create({ user_id: accepter._id, skill_id: skill._id, is_active: true }),
    ]);
    createdIds.staffSkills.push(...createdStaffSkill.map((doc) => doc._id));

    const createdCerts = await Promise.all([
      StaffLocationCertification.create({
        user_id: requester._id,
        location_id: location._id,
        is_active: true,
      }),
      StaffLocationCertification.create({
        user_id: accepter._id,
        location_id: location._id,
        is_active: true,
      }),
    ]);
    createdIds.staffCerts.push(...createdCerts.map((doc) => doc._id));

    const createdAvailabilities = await Promise.all([
      Availability.create({
        user_id: accepter._id,
        recurring_windows: [
          {
            weekday: 3,
            start_time_local: "00:00",
            end_time_local: "23:59",
            timezone: "EAT",
            location_id: location._id,
          },
        ],
        exceptions: [],
      }),
      Availability.create({
        user_id: requester._id,
        recurring_windows: [
          {
            weekday: 3,
            start_time_local: "00:00",
            end_time_local: "23:59",
            timezone: "EAT",
            location_id: location._id,
          },
        ],
        exceptions: [],
      }),
    ]);
    createdIds.availabilities.push(...createdAvailabilities.map((doc) => doc._id));

    const createdPreferences = await Promise.all([
      StaffPreference.create({ user_id: requester._id, max_hours_per_week: 48 }),
      StaffPreference.create({ user_id: accepter._id, max_hours_per_week: 48 }),
    ]);
    createdIds.preferences.push(...createdPreferences.map((doc) => doc._id));

    const fromAssignment = await ShiftAssignment.create({
      shift_id: shift._id,
      user_id: requester._id,
      assigned_by: manager._id,
      source: "manual",
      status: "assigned",
      activity_log: [],
    });
    createdIds.assignments.push(fromAssignment._id);

    const swapRequest = await SwapRequest.create({
      type: "pickup",
      status: "pending_peer_acceptance",
      requester_id: requester._id,
      from_assignment_id: fromAssignment._id,
      expires_at: new Date("2026-04-09T00:00:00.000Z"),
    });
    createdIds.swaps.push(swapRequest._id);

    const acceptResponse = await request(app)
      .post(`/api/swap-requests/${swapRequest._id}/accept`)
      .set(authHeader(accepter._id))
      .send({});

    assert.equal(acceptResponse.status, 200);
    assert.equal(acceptResponse.body?.success, true);
    assert.equal(acceptResponse.body?.data?.status, "pending_manager_approval");
    assert.equal(
      String(acceptResponse.body?.data?.claimed_by_user_id),
      String(accepter._id)
    );

    const approveResponse = await request(app)
      .post(`/api/swap-requests/${swapRequest._id}/manager-decision`)
      .set(authHeader(manager._id))
      .send({ approve: true });

    assert.equal(approveResponse.status, 200);
    assert.equal(approveResponse.body?.success, true);
    assert.equal(approveResponse.body?.data?.swap_request?.status, "approved");
    assert.equal(
      String(approveResponse.body?.data?.updated_from_assignment?.user_id?._id),
      String(accepter._id)
    );

    const assignmentAfterApprove = await ShiftAssignment.findById(fromAssignment._id);
    assert.equal(String(assignmentAfterApprove.user_id), String(accepter._id));
    assert.equal(assignmentAfterApprove.source, "swap");

    console.log("PASS swap accept/approve integration");
  } finally {
    await Promise.all([
      SwapRequest.deleteMany({ _id: { $in: createdIds.swaps } }),
      ShiftAssignment.deleteMany({ _id: { $in: createdIds.assignments } }),
      Shift.deleteMany({ _id: { $in: createdIds.shifts } }),
      Schedule.deleteMany({ _id: { $in: createdIds.schedules } }),
      StaffPreference.deleteMany({ _id: { $in: createdIds.preferences } }),
      Availability.deleteMany({ _id: { $in: createdIds.availabilities } }),
      StaffLocationCertification.deleteMany({ _id: { $in: createdIds.staffCerts } }),
      StaffSkill.deleteMany({ _id: { $in: createdIds.staffSkills } }),
      Skill.deleteMany({ _id: { $in: createdIds.skills } }),
      User.deleteMany({ _id: { $in: createdIds.users } }),
      UserRole.deleteMany({ _id: { $in: createdIds.roles } }),
      Location.deleteMany({ _id: { $in: createdIds.locations } }),
    ]);
    await mongoose.disconnect();
  }
};

run().catch((error) => {
  console.error("FAIL swap accept/approve integration");
  console.error(error);
  process.exitCode = 1;
});
