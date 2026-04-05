# ShiftSync Server (Coastal Eats Multi-Location Scheduler)

Backend API for a multi-location restaurant staff scheduling platform.

## Scope
This repository contains the **server/API** for ShiftSync. It covers:
- Role-aware access for admin/manager/staff
- Scheduling, shifts, assignments, swap workflows
- Constraint checks (skill, certification, availability, overlap, rest gap)
- Fairness analytics endpoints
- Notification persistence + optional Firebase push
- Audit log model and export/list endpoints

## Tech Stack
- Node.js + Express 5
- MongoDB + Mongoose
- JWT authentication
- Swagger UI (`/api/docs`)

## Local Setup
1. Install dependencies:
```bash
npm install
```
2. Configure environment variables in `.env`:
```env
MONGO_URI=<your_mongodb_connection_string>
LOGIN_SECRET=<your_jwt_secret>
FIREBASE_SERVICE_ACCOUNT_PATH=<optional path to Firebase service account JSON>
```
3. Start server:
```bash
npm run dev
```
4. Open API docs:
- `http://localhost:5000/api/docs`

## Seed Data
On startup, the API seeds baseline data when collections are empty:
- Roles: `admin`, `manager`, `staff`
- 4 locations (max enforced):
  - `LAX`, `SEA` (Pacific timezone)
  - `NBO`, `DAR` (East Africa timezone)
- Users:
  - 1 admin (`admin@example.com`)
  - 1 manager (`manager1@example.com`)
  - 4 staff (`staff1@example.com` ... `staff4@example.com`)

## How To Log In As Each Role
Use `POST /api/v1/auth/login`.

Example body:
```json
{
  "email": "admin@example.com",
  "password": "1234"
}
```

Notes:
- Password/PIN is a 4-digit numeric value.
- On first login for a user without PIN set, submitted 4-digit value becomes their PIN.
- Reuse the returned `accessToken` as `Authorization: Bearer <token>`.

Role emails:
- Admin: `admin@example.com`
- Manager: `manager1@example.com`
- Staff: `staff1@example.com` (or `staff2/3/4@example.com`)

## Requirement Coverage (Current)
### Implemented
- Manager-scoped schedule and shift management by assigned locations
- Assignment rule enforcement:
  - No overlapping shifts for same staff
  - Minimum 10-hour rest gap
  - Required skill match
  - Active certification for location
  - Availability window check (including overnight shifts)
  - Weekly max-hours cap using staff preference (default 40)
- Existing assignees are re-validated before shift updates are applied
- Shift headcount cannot be reduced below currently assigned staff count
- Constraint violation responses include rule + reason
- Alternative candidate suggestions for coverage
- Swap/drop/pickup flow with peer acceptance + manager approval
- Atomic swap acceptance and manager decision locking reduce concurrent acceptance/approval races
- Pending swap cancellation by requester
- Assignment concurrency lock for same user (reduces simultaneous assignment races)
- Fairness analytics:
  - Hours distribution by staff
  - Premium shift distribution (Fri/Sat evening)
  - Fairness score + under/over scheduled lists
- Notification persistence with read/unread flows
- Notification idempotency key support to deduplicate retry-generated in-app notifications
- Clock-in/pause/resume/clock-out tracking
- Manager recovery endpoint for missing clock-out events: `POST /api/assignments/:id/recover-clock-out`

### Partially Implemented / Missing
- Real-time update transport (WebSocket/SSE) is not implemented yet
- Labor law engine is incomplete:
  - Missing automated daily 8/12 hour and 6th/7th consecutive-day enforcement
  - `LaborAlert` exists but no full automatic rule pipeline
- Swap/drop limits and expiry rules are incomplete:
  - No hard cap of 3 pending requests per staff
  - No automatic 24-hour-before-shift expiry for drop requests unless `expires_at` is set externally
- Pending swap auto-cancel when shift is edited is not implemented
- Full automatic audit logging on every mutation is not wired; audit logs currently rely on explicit create calls
- Some endpoints still need stricter auth/authorization hardening

## Evaluation Scenario Mapping
1. Sunday Night Chaos
- Use `GET /api/assignments/coverage/:shift_id` for immediate candidates.
- Assign via `POST /api/assignments`.

2. Overtime Trap
- Assignment validation blocks projected weekly overtime beyond configured max hours.
- Manager can inspect analytics via `GET /api/assignments/insights` and fairness endpoints.

3. Timezone Tangle
- Availability is evaluated in shift location timezone.
- Cross-timezone certifications are supported, but timezone vocabulary is currently restricted to configured canonical zones.

4. Simultaneous Assignment
- Per-user assignment lock returns `409` conflict to one requester when competing assignment operations occur.

5. Fairness Complaint
- Use:
  - `GET /api/fairness-snapshots/saturday-night-distribution`
  - `GET /api/fairness-snapshots/manager-analytics`

6. Regret Swap
- Requester can cancel while status is pending peer acceptance/manager approval.
- Approved/rejected/expired states are non-cancellable.

## Assumptions For Intentional Ambiguities
1. De-certifying staff from a location
- Historical assignments remain intact for reporting/audit consistency.
- Future assignment validation fails if certification is inactive.

2. Desired hours vs availability
- Availability is a hard constraint.
- Desired hours is a planning/fairness signal, not a hard assignment blocker.

3. Consecutive-day calculation
- Any worked time on a day counts as a worked day (1 hour and 11 hours both count as 1 day).

4. Shift edited after swap approval
- Approved swap remains valid unless manager manually reassigns/cancels.
- Pending swap auto-cancel on shift edit is still pending implementation.

5. Location near timezone boundary
- Each location uses a single canonical timezone; all shifts at that location inherit it.

## Additional Edge Cases To Cover (Beyond Prompt)
1. Shift exactly touching boundaries (e.g., end at 14:00, next starts 14:00) should not be marked overlapping.
2. Rest gap exactly 10 hours should pass; 9h59m should fail.
3. Availability overnight window + DST transition hour skip/repeat.
4. Staff with location-scoped availability for one branch but assignment at another branch same timezone.
5. Shift reassignment while assignee is already clocked in elsewhere.
6. Manager edits shift start time after assignments exist; re-validate all assignees automatically.
7. Headcount reduction below already-assigned count.
8. Simultaneous manager approval actions on the same swap request.
9. Accepting staff becomes deactivated between peer acceptance and manager approval.
10. Delete/deactivate skill used by future scheduled shifts.
11. User role change (staff -> manager) while they still own future assignments.
12. Duplicate notification generation on retries/idempotency failures.
13. Cross-location weekly overtime when staff works in two timezones crossing UTC week boundary.
14. Audit log export for large date ranges (pagination/streaming).
15. Clock-out missing due to network loss; recovery and correction workflow.
16. Schedule publish/unpublish race with cutoff time crossing mid-request.
17. Expired swap request accepted at the same moment by two staff users.
18. Staff timezone preference differing from location timezone (display consistency).

## Testing
Run current integration test:
```bash
npm test
```

Current test coverage is focused on swap accept/manager approval. Additional tests are recommended for assignment constraints, labor rules, realtime events, and concurrent operations.

## Security / Ops Notes
- Do not commit real secrets in `.env`.
- Rotate any leaked DB credentials or JWT secrets immediately.
- Add endpoint-level authorization checks where missing.
- Add idempotency keys for write-heavy workflow endpoints.
