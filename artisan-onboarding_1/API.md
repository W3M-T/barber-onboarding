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

## Resources

Mini-tabs of reference material. Admins upload documents; employees read them.

**Visibility cascades.** A published document inside a `draft` or `admins` category
must not be reachable — including by direct id. Resolve the parent category on every
document read; otherwise a document is exposed the moment someone learns its id.

**Role comes from the session.** `?include=all` is a *request*, honored only when the
caller is an admin and silently downgraded otherwise. Do not return `403` — a 403
confirms drafts exist.

### `GET /resources/categories[?include=all]`
The mini-tabs, ordered by `sort_order`. → `Store.listResourceCategories(includeAll)`
```json
[ { "id":"rc_1099ny","name":"1099 Resources — New York","shortName":"1099 · NY",
    "blurb":"First principles for tracking income…","status":"published",
    "visibility":"everyone","taxYear":2026,"reviewedOn":"2026-08-01",
    "audienceNote":"For anyone paid as an independent contractor…","sortOrder":2 } ]
```

### `POST /resources/categories`
Create a tab. Always created as `draft`. → `Store.addResourceCategory(data)`
Body: `{ "name":string, "shortName"?:string, "blurb"?:string }` → the created category.

### `PATCH /resources/categories/:categoryId`
→ `Store.updateResourceCategory(id, patch)`
Body: any of `{ name, shortName, blurb, status, visibility, audienceNote, taxYear, reviewedOn }`

### `PUT /resources/categories/order`
Rewrite `sort_order` from a full ordered list. → `Store.reorderResourceCategories(ids)`
Body: `{ "ids": string[] }` → the reordered categories.

### `DELETE /resources/categories/:categoryId`
Cascades to sections, documents and figures. → `Store.deleteResourceCategory(id)`
→ `{ "id":"rc_x","deleted":true }`

### `GET /resources/categories/:categoryId/sections[?include=all]`
Authored prose for the tab. → `Store.listResourceSections(categoryId, includeAll)`
```json
[ { "id":"sec_income","categoryId":"rc_1099ny","heading":"Tracking income",
    "body":["…"],"bullets":["…"],"body2":["…"],"sortOrder":4 } ]
```

### `PUT /resources/categories/:categoryId/sections`
Replace the whole set for one category. → `Store.saveResourceSections(categoryId, sections)`
Body: `{ "sections":[{ "id"?:string,"heading":string,"body":string[],"bullets":string[] }] }`

### `GET /resources/categories/:categoryId/figures[?include=all]`
Year-stamped values referenced from prose as `{{token}}`.
→ `Store.listResourceFigures(categoryId, includeAll)`
```json
[ { "id":"fig_mile","categoryId":"rc_1099ny","token":"mileage","taxYear":2026,
    "value":"72.5¢/mile through 30 June, 76¢/mile from 1 July",
    "label":"Standard business mileage rate","sourceUrl":"https://www.irs.gov/…" } ]
```

### `PATCH /resources/figures/:figureId`
Correct a figure without a code change — the point of the table.
→ `Store.updateResourceFigure(id, patch)`
Body: any of `{ value, label, sourceUrl, taxYear }`

### `GET /resources/categories/:categoryId/documents[?include=all]`
→ `Store.listResourceDocuments(categoryId, includeAll)`

**This response never carries file bytes.** A base64 PDF inside a list response is the
difference between a page that opens and one that stalls.
```json
[ { "id":"doc_setaside","categoryId":"rc_1099ny","kind":"file","status":"published",
    "title":"Quarterly set-aside worksheet","description":"Print it, fill it in…",
    "fileName":"set-aside-worksheet.pdf","downloadName":"set-aside-worksheet.pdf",
    "mimeType":"application/pdf","byteSize":2826,"version":1,"openCount":3,
    "updatedOn":"2026-08-01","url":null,"hasFile":true,"sortOrder":1 } ]
```

### `POST /resources/categories/:categoryId/documents`
Create a document. Always created as `draft`. → `Store.addResourceDocument(categoryId, data)`

Prototype sends `{ dataUrl }`. In production this is `multipart/form-data` with field
`file`; the server **sniffs magic bytes**, requires the sniffed type to match the
declared one against the allowlist (`application/pdf`, `image/png`, `image/jpeg`,
`image/webp` — **never `image/svg+xml`**), scans the file, stores it in object storage,
and derives `downloadName` from the basename. `413` over the size cap, `415` off the
allowlist.

### `PATCH /resources/documents/:documentId`
→ `Store.updateResourceDocument(id, patch)`
Body: any of `{ title, description, status, sortOrder, url, updatedOn }`

### `PUT /resources/documents/:documentId/file`
Swap the bytes, keeping id, title, description and order; bumps `version`.
→ `Store.replaceResourceDocumentFile(id, file)`

### `DELETE /resources/documents/:documentId`
→ `Store.deleteResourceDocument(id)` → `{ "id":"doc_x","deleted":true }`

### `GET /resources/documents/:documentId/file`
The bytes, fetched only on view or download. → `Store.getResourceDocFile(id, includeAll)`

Prototype returns `{ dataUrl }`. In production return a **short-lived signed URL** and
load it straight into the viewer — do not copy it into a blob, and do not cache it.
Serve from a separate origin with `Content-Disposition` and a restrictive CSP.
`404` (not `403`) when the document or its category is not visible to the caller.

### `POST /resources/documents/:documentId/open`
Increment the aggregate open counter. → `Store.openResourceDocument(id, includeAll)`

Aggregate only. There is deliberately **no per-employee read receipt** — see
`RESOURCES-SCOPE.md` §7.

---

## Floor — hourly duties

The hourly box does two jobs: it says what an hour is *for*, and each duty ticks off
as a **daily checklist**. Four things keep the checklist from becoming a performance
record, and all four are load-bearing (`FLOOR-SCOPE.md` §4): ticks are keyed to the
**local date** and every day starts clean, retention is a **rolling 14 days**, admin
reads a **count for the role and never a per-person breakdown**, and a duty is never
marked `missed`.

Schedules are keyed by **role**, not by person.

### `GET /floor/schedules`
Every role schedule, with a standing-duty count and the list of weekdays that have
their own blocks. → `Store.listDutySchedules()`

```json
[{ "id":"sch_frontdesk","role":"Front Desk Concierge","name":"Front desk — the hour by hour",
   "blurb":"…","closedDays":["mon","sun"],"sortOrder":1,
   "standingCount":6,"overrideDays":["sat"] }]
```

`standingCount` and `overrideDays` are **derived**; the client never writes them.

### `GET /floor/schedules/:role`
One schedule, or `null`. → `Store.getDutySchedule(role)`

### `PATCH /floor/schedules/:scheduleId`
Body `{ closedDays }`. → `Store.setScheduleClosedDays(id, days)`

Unknown weekday keys are **dropped, not stored** — an unrecognised day would silently
never match and the schedule would look correct while behaving wrongly. Valid keys are
`mon tue wed thu fri sat sun`.

### `GET /floor/schedules/:scheduleId/standing`
→ `Store.listStandingDuties(scheduleId)`

### `POST /floor/schedules/:scheduleId/standing`
Body `{ label, detail? }`. `label` is required and trimmed. → `Store.addStandingDuty(...)`

### `DELETE /floor/standing/:standingId`
→ `Store.deleteStandingDuty(id)`

### `GET /floor/schedules/:scheduleId/blocks[?day=]`
→ `Store.listDutyBlocks(scheduleId, dayKey?)`

`dayKey` is `default` or a weekday. Omit it for every block in the schedule.

### `POST /floor/schedules/:scheduleId/blocks`
Body `{ dayKey, hour, label?, duties? }`. → `Store.addDutyBlock(...)`

`400` when `hour` is not an integer `0..23`, and `409` when that `(schedule, day, hour)`
already exists — **one block per hour per day**, or "what am I doing at 2pm" stops having
one answer.

### `PATCH /floor/blocks/:blockId`
Body `{ label?, note?, duties? }`. → `Store.updateDutyBlock(id, patch)`

`duties` is a string array; blank entries are dropped, so an empty line in the editor's
textarea does not become an empty bullet. The response returns the duties as **rows**
(`{ id, text, sortOrder }`), not strings.

**Reconciliation is by text.** A line whose text is unchanged keeps its `duty_items.id`,
so reordering the list keeps the day's ticks attached to the right duty. A reworded line
becomes a new row with a clean tick — an edited duty *is* a different duty. Removed lines
take their ticks with them.

### `DELETE /floor/blocks/:blockId`
→ `Store.deleteDutyBlock(id)`

### `POST /floor/schedules/:scheduleId/days/:dayKey`
Give a weekday its own schedule, seeded from a **copy** of the default day.
→ `Store.createDayOverride(scheduleId, dayKey)`

`409` if the day already has its own blocks. The copy is new rows — editing them must
never touch the default day.

### `DELETE /floor/schedules/:scheduleId/days/:dayKey`
Drop the override; the day follows the default again.
→ `Store.clearDayOverride(scheduleId, dayKey)`

### `GET /floor/today?role=`
The whole Today screen in one read. → `Store.getFloorDay(role, at?)`

```json
{ "role":"Front Desk Concierge","dayKey":"sat","dayName":"Saturday","hour":14,
  "schedule":{ … },"closed":false,"reason":null,"source":"sat",
  "standing":[ … ],"blocks":[ … ],
  "currentBlock":{ "id":"blk_fd_sat_14","hour":14,"label":"Second wind","duties":[ … ] },
  "nextBlock":{ "hour":15,"label":"Retail hour", … },
  "position":"open" }
```

`position` is `before-open` | `open` | `after-close` | `closed`.
`reason` explains a closed day: `closed` (a rostered day off), `no-blocks` (nothing
authored yet) or `no-schedule` (this role has none). They are **three different
situations** and the client says which.

`source` is `default` or the weekday key, so the UI can tell someone that today runs on
its own schedule.

**Resolution is three rules in order.** Closed day → the day's own blocks → the default
blocks. A weekday override replaces the day *entirely*; default blocks never leak into
it. Standing duties are unaffected by an override.

**A block governs from its hour until the next block's hour**, and the last block governs
to the end of its own hour. That is what lets a sparse schedule (9, 11, 13) answer "what
am I doing at noon".

`at` is a prototype-only test seam. In production resolve "now" in the **shop's**
timezone, stored on the shop record — never in the client's, or a travelling admin and a
DST boundary both produce the wrong hour.

Each duty inside `blocks[].duties` is `{ id, text, sortOrder, done }`, where `done` is
**this employee's** tick for **this local date**. `total` and `done` on the envelope count
the whole day, not the current hour: a 10am duty finished at 11 still counts, and the
person closing needs to see what the morning left outstanding.

This read also trims `duty_checks` past the retention window — see below.

### `PUT /floor/checks/:dutyItemId`
Body `{ done }`. → `Store.setDutyCheck(employeeId, dutyItemId, done, at?)`

One row per `(employee, local date, duty item)`. Unticking is an **update of the same
row**, not an append and not an audit entry. `404` on an unknown duty item or employee —
validate before writing, or a typo leaves a tick against nothing that both read paths
then hide.

`on_date` is the **local** date. A shift ending at 6pm in New York is already tomorrow in
UTC; keying on that would clear the closing checklist halfway through the close.

**Retention is a rolling window** (`DUTY_CHECK_DAYS`, 14). The prototype trims on read;
production wants a nightly `DELETE ... WHERE on_date < current_date - INTERVAL '14 days'`.
This is not a tidiness measure — without it the checklist becomes a permanent
per-employee performance record.

**A duty is never `missed`.** An unticked duty at midnight simply stops being a question.
That state belongs to bounties, and adding it here recreates what the daily reset exists
to avoid.

### `GET /floor/coverage?role=`
Today's completion for a role, **counted across everyone holding it**.
→ `Store.getDayCoverage(role, at?)`

```json
{ "role":"Front Desk Concierge","onDate":"2026-08-21","closed":false,
  "blocks":[{ "id":"blk_fd_09","hour":9,"label":"Open the desk","total":5,"done":5 }] }
```

**Deliberately not per person, and this is a mitigation the feature depends on.** The
shop's real question is "did the close get done". Answering it by name turns a checklist
into a scoreboard, and a scoreboard gets gamed — people tick first and work second. Do not
add a per-person breakdown to this endpoint; doing so undoes the design rather than
extending it.

A closed day returns `closed: true` with no blocks, because zero-of-zero reads as a
failure while "closed" reads as closed.

---

## Floor — bounties

Weekly, monthly and quarterly work, picked up whenever someone has time.

**"Bounty" is a name, not a reward.** No points, no ledger, no balance, no leaderboard.
Adding one means a per-person ledger, reset rules and an approval step before a claim
counts — none of which exists here.

### `GET /floor/bounties[?include=all]`
Definitions. `include=all` adds archived ones and is admin-only.
→ `Store.listBounties(includeArchived)`

### `POST /floor/bounties`
Body `{ title, detail?, period, sizeMin, roles? }`. → `Store.addBounty(data)`

`period` is `weekly` | `monthly` | `quarterly`. `sizeMin` is **required** and must be
`1..480` — "whenever you have spare time" is unusable if nobody can tell which bounties
fit the time they actually have. `roles` empty means anyone.

### `PATCH /floor/bounties/:bountyId`
→ `Store.updateBounty(id, patch)`

### `PATCH /floor/bounties/:bountyId` `{ status }`
`active` | `archived`. → `Store.setBountyStatus(id, status)`

Archiving takes a bounty off the board and stops it opening new periods. It **does not**
delete its history.

### `GET /floor/bounties/board?role=`
The current period's instances, joined to their definitions and filtered to the role.
→ `Store.listBountyBoard(role, at?)`

```json
[{ "id":"bty_shelves","title":"Deep clean the retail shelves","period":"weekly",
   "periodLabel":"This week","sizeMin":45,"roles":["Front Desk Concierge"],
   "instance":{ "id":"bi_1042","periodKey":"2026-W34","state":"open",
                "claimedBy":null,"claimedAt":null,"completedBy":null,"completedAt":null } }]
```

**This read has a side effect in the prototype**: it opens the current period and closes
out anything older. In production make it a **nightly job** and keep this read pure —
otherwise a bounty is only marked missed once somebody happens to look.

`periodKey` is **derived, never accepted from the client**: `2026-W34` (ISO 8601 week —
the week containing the first Thursday, so 1 January can belong to the previous ISO
year), `2026-08`, `2026-Q3`.

### `GET /floor/bounties/:bountyId/instances[?limit=]`
Most recent periods first. → `Store.listBountyHistory(bountyId, limit)`

### `POST /floor/bounties/instances/:instanceId/claim`
→ `Store.claimBounty(instanceId, employeeId)`

A **soft lock**: one claimant at a time. `409` when someone else holds it; re-claiming
your own is idempotent. `409` when the instance is `done` or `missed`.

### `POST /floor/bounties/instances/:instanceId/release`
→ `Store.releaseBounty(instanceId, employeeId)`

Returns it to `open` and clears the claim. **Nothing is recorded against the person.**
`403` if the caller is not the holder.

### `POST /floor/bounties/instances/:instanceId/complete`
→ `Store.completeBounty(instanceId, employeeId)`

Completing an unclaimed instance claims it on the way, because doing the thing without
claiming it first is normal. `409` when someone else holds it.

### Rollover

When the period key moves on, an `open` or `claimed` instance becomes `missed` and a fresh
`open` one is created. Instances are **never deleted and a missed one is never rewritten**
— the miss is the record, which is the whole reason a quarterly bounty cannot silently
evaporate at quarter end.

A miss **drops its claimant**. A claim is not a commitment, and permanently recording
"claimed this and did not finish" teaches people not to claim, which costs exactly the
coordination the lock exists to provide.

`claimedBy` / `completedBy` are `ON DELETE SET NULL`: offboarding preserves that a bounty
was done while dropping who did it. The operational question is "was it done".

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
