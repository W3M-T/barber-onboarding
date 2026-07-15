# Artisan Onboarding — API Contract

The frontend talks to the backend through one data-access layer (`Store` in
`index.html`). Every method below is already called by the UI; each maps to one
endpoint. To go live, replace each `Store` method body with the matching
`fetch`. Nothing else in the UI changes.

- Base path: `/api`
- All requests/responses are JSON.
- IDs are stable strings (`emp_jordan`, `mtg_handbook`, `tm_charlie`, `slot_3`,
  `em_1`, `grp_setup`, `itm_i9`). Never positional indexes.
- The current user is resolved from the session/auth token. Where an endpoint is
  scoped to "me," the server uses the authenticated employee; the prototype uses
  a fixed `CURRENT_USER`.
- Mutations return the affected resource so the client can re-fetch and re-render.

Tables referenced below are defined in `schema.sql`.

---

## Content

### `GET /content`
Single settings row. → `Store.getContent()`
```json
{ "id": "singleton",
  "welcomeMessage": "Welcome to Artisan…",
  "trainingUrl": "https://training.artisanbarber.com" }
```

### `PATCH /content`
Update either field. → `Store.updateContent(patch)`
Body: `{ "welcomeMessage"?: string, "trainingUrl"?: string }`
Returns the updated content object.

---

## Meetings (step templates)

### `GET /meetings`
All step templates, ordered by `sort_order`. → `Store.listMeetings()`
```json
[ { "id":"mtg_handbook","step":1,"roman":"I","title":"Handbook Meeting",
    "shortTitle":"Handbook Meeting","durationMin":45,"roleOnly":false,
    "requiresAck":true,"defaultHost":"Charlie · Owner",
    "purpose":"…","topicsLabel":"This platform provides",
    "topics":["…"],"prep":["…"],"boundary":null,"sortOrder":1 } ]
```

### `PATCH /meetings/:meetingId`
Currently used to change the default host. → `Store.updateMeeting(id, patch)`
Body: `{ "defaultHost"?: string }` → returns the updated meeting.

### `GET /meetings/:meetingId/slots`
Available times for one meeting. → `Store.listSlots(meetingId)`
```json
[ { "id":"slot_3","meetingId":"mtg_frontdesk",
    "when":"Wed Jul 15 · 9:30 AM","host":"Bobby · Manager" } ]
```

### `POST /meetings/:meetingId/slots`
Add a time. → `Store.addSlot(meetingId, { when, host })`
Body: `{ "when": string, "host": string }` → returns the created slot.

---

## Team

### `GET /team`
Shop artisans, ordered by `sort_order`. → `Store.listTeam()`
```json
[ { "id":"tm_charlie","name":"Charlie","initials":"C","role":"Founder & Owner",
    "experience":"Est. 2017","bio":"…","specialties":["Shop culture"],
    "photoUrl":null,"hostsMeetingIds":["mtg_handbook","mtg_acd"],"sortOrder":1 } ]
```

### `POST /team`
Create a member. Server derives `initials`, assigns `id` + `sortOrder`.
→ `Store.addTeamMember(data)`
Body: `{ "name":string, "role":string, "experience"?:string,
         "specialties"?:string[], "bio"?:string }` → returns the created member.

### `PATCH /team/:memberId`
Edit fields (re-derives `initials` if name changes).
→ `Store.updateTeamMember(id, patch)`
Body: any of `{ name, role, experience, specialties, bio }` → updated member.

### `DELETE /team/:memberId`
Remove a member. → `Store.deleteTeamMember(id)` → `{ "id":"tm_x","deleted":true }`

### `PUT /team/:memberId/photo`
Set/replace the headshot. → `Store.setTeamPhoto(id, dataUrl)`
Prototype sends a base64 data URL in `{ "photoUrl": string }`. In production this
should be a multipart upload (`multipart/form-data`, field `photo`); the server
stores the file and returns the member with a hosted `photoUrl`.
Sending `null`/empty (or `DELETE /team/:memberId/photo`) clears the photo.

---

## Employees (admin roster)

### `GET /employees`
Roster with derived summary fields. → `Store.listEmployees()`
```json
[ { "id":"emp_jordan","name":"Jordan Rivera","initials":"JR",
    "role":"Assistant Stylist","dayLabel":"Day 4","eligibleForAsp":true,
    "trainingAccess":false,"progress":45,"adminNotes":"…",
    "nextStep":"Step II · Front Desk & Concierge" } ]
```
`nextStep` and `progress` are derived server-side (see schema notes).

### `GET /employees/:employeeId`
One employee (same shape as a roster row). → `Store.getEmployee(id)`

### `PATCH /employees/:employeeId`
Update employee fields. → `Store.setTrainingAccess(id,bool)` and
`Store.setEmployeeNotes(id,text)`
Body: `{ "trainingAccess"?: boolean, "adminNotes"?: string }` → updated employee.

### `POST /employees/:employeeId/assign-program`
Make the employee eligible for the Assistant Stylist Program and create the
corresponding `employee_meetings` row if missing. → `Store.assignProgram(id)`
Returns the updated employee.

---

## Employee meetings (per-employee instances)

### `GET /employees/:employeeId/meetings`
The employee's applicable meetings, template + instance merged.
→ `Store.listEmployeeMeetings(employeeId)`
Add `?include=all` to also return non-applicable role-only steps (admin view, so
they can be assigned). → `Store.listEmployeeMeetings(employeeId, true)`
```json
[ { "meetingId":"mtg_handbook","step":1,"roman":"I","title":"Handbook Meeting",
    "shortTitle":"Handbook Meeting","roleOnly":false,"requiresAck":true,
    "durationMin":45,"purpose":"…","topicsLabel":"…","topics":["…"],
    "prep":["…"],"boundary":null,
    "status":"complete","when":"Mon Jul 6 · 10:00 AM","host":"Charlie · Owner",
    "acknowledgedAt":"2026-07-06T10:45:00Z","hasInstance":true,"applicable":true } ]
```
`status` is `pending` | `scheduled` | `complete`, or `na` for a role-only step the
employee isn't eligible for (only appears under `?include=all`).

### `POST /employees/:employeeId/meetings/:meetingId/schedule`
Book (or rebook) a time. Creates the instance if needed; resolves the host from
the chosen slot. → `Store.scheduleEmployeeMeeting(employeeId, meetingId, when)`
Body: `{ "when": string }`  *(prefer `{ "slotId": string }` in production)*
Returns the updated instance.

### `POST /employees/:employeeId/meetings/:meetingId/complete`
Mark attended; recomputes `employees.progress`.
→ `Store.completeEmployeeMeeting(employeeId, meetingId)` → updated instance.

### `POST /employees/:employeeId/meetings/:meetingId/acknowledge`
Record handbook acknowledgment (sets `acknowledged_at`).
→ `Store.acknowledgeEmployeeMeeting(employeeId, meetingId)` → updated instance.

---

## Checklist

### `GET /employees/:employeeId/checklist`
Groups + items merged with the employee's completion state. The `auto` group is
derived from `employee_meetings` and has no stored rows.
→ `Store.getChecklist(employeeId)`
```json
[ { "id":"grp_employment","title":"Employment requirements","subtitle":"…",
    "kind":"manual",
    "items":[ { "id":"itm_i9","label":"Form I-9 process","done":true,"locked":false } ] },
  { "id":"grp_meetings","title":"Required meetings","subtitle":"…","kind":"auto",
    "items":[ { "id":"meeting:mtg_handbook","label":"Attend Handbook Meeting",
                "done":true,"locked":true,"status":"complete" } ] } ]
```
`locked:true` items are read-only (driven by meetings); the UI shows a status
chip instead of a checkbox.

### `PUT /employees/:employeeId/checklist/:itemId`
Toggle one manual item (upsert into `checklist_state`).
→ `Store.setChecklistItem(employeeId, itemId, done)`
Body: `{ "done": boolean }` → `{ "employeeId":"…","itemId":"…","done":true }`
Only valid for items in `manual` groups; `meeting:*` items are not writable.

---

## Notes for implementers

- **Auth & scope.** Employee-facing screens act on the authenticated user; admin
  screens act on `:employeeId`. Enforce role checks server-side — the client
  toggle between "employee" and "admin" is presentation only.
- **Derived values** (`progress`, `nextStep`, the auto checklist group) are
  computed by the server; the client never writes them.
- **Idempotency.** `schedule` / `complete` / `acknowledge` are safe to repeat;
  they set state rather than append. `assign-program` no-ops if already assigned.
- **Errors.** Use standard HTTP codes (`404` unknown id, `400` invalid body,
  `403` wrong role). The client surfaces failures as a toast; on error it should
  re-fetch to stay consistent with the server.
