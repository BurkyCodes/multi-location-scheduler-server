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
  - Labor compliance automation:
    - Daily >8h warning
    - Daily >12h hard block
    - 6th consecutive day warning
    - 7th consecutive day requires manager override with documented reason
- Existing assignees are re-validated before shift updates are applied
- Shift headcount cannot be reduced below currently assigned staff count
- Constraint violation responses include rule + reason
- Alternative candidate suggestions for coverage
- Swap/drop/pickup flow with peer acceptance + manager approval
- Atomic swap acceptance and manager decision locking reduce concurrent acceptance/approval races
- Direct pickup request creation flow is supported (`type: pickup` against active drop requests)
- Pending swap cancellation by requester
- Pending swap/drop cap enforced: max 3 pending swap/drop requests per requester
- Drop requests auto-expire at shift start minus 24 hours (unclaimed drops)
- Pending swap/drop requests tied to a shift are auto-cancelled when that shift is edited
- Assignment concurrency lock for same user (reduces simultaneous assignment races)
- Fairness analytics:
  - Hours distribution by staff
  - Premium shift distribution (Fri/Sat evening)
  - Fairness score + under/over scheduled lists
- Notification persistence with read/unread flows
- Notification idempotency key support to deduplicate retry-generated in-app notifications
- Real-time SSE transport for live schedule/shift/assignment/swap/clock/notification updates
- Clock-in/pause/resume/clock-out tracking
- Manager recovery endpoint for missing clock-out events: `POST /api/assignments/:id/recover-clock-out`
- Labor alert pipeline persists warning/block records and exposes role-scoped labor alert APIs
- Automatic audit logging for create/update/delete mutations in supported scheduling entities:
  - schedules, shifts, shift assignments, swap requests, availabilities, notification preferences
- Additional workflow audit logging for publish/unpublish, swap accept/decision/cancel, and assignment clock actions
- Legacy endpoint hardening added for notifications, availabilities, preferences, skills, certifications, clock events, user roles, and user mutation routes

### Partially Implemented 
- Audit coverage is broad for scheduling domain entities, but legacy/non-scheduling modules may still need additional audit hooks
- Endpoint auth/authorization hardening is applied for major routes, with continuing scope for incremental endpoint-level tightening

## Real-Time Events (SSE)
- Endpoint: `GET /api/realtime/stream`
- Auth:
  - `Authorization: Bearer <token>` header, or
  - `?token=<jwt>` query parameter (used by browser `EventSource`)
- Transport: Server-Sent Events (SSE) with heartbeat every 25 seconds
- Events emitted:
  - `schedule_changed`
  - `shift_changed`
  - `assignment_changed`
  - `swap_changed`
  - `clock_changed`
  - `notification_created`
- Client wiring:
  - `client/src/Layouts/NotificationsBootstrap.jsx` subscribes to SSE and refreshes affected Redux slices in real time.

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
- Pending swap requests are auto-cancelled when related shift details are edited.

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
