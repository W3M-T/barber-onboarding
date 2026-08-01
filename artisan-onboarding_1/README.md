# Artisan Barber — Onboarding Platform (Prototype)

A clickable, front-end prototype of the shop's new-hire onboarding platform. It's a
single self-contained `index.html` file — no build step, no dependencies, no server.
Just open it in a browser.

The platform is a **guided entry point into the shop**, not a learning-management
system. Full training courses, videos, and assessments live on a separate training
site; this platform introduces new hires, points the way, and confirms they're set up.

The **Resources** section keeps that boundary explicit with one test: *if anyone would
ever need to answer "who completed this, when, and did they pass?", it is training and
belongs on the training site.* Resources is read-at-your-own-pace reference material —
no sequence, no assessment, no completion state.

---

## Two views

Use the **Employee / Admin** toggle in the top-right to switch between them.

### Employee (front of house)
- **Home** — welcome, live onboarding progress ring, "up next" meeting, quick stats.
- **Meet the shop** — profile cards for each artisan with a headshot, role, and short bio.
- **My checklist** — employment requirements, shop setup, required meetings (auto-tracked),
  and external training access. Checkboxes update progress live.
- **Meetings** — the four-step introduction journey. Tap a step to see its purpose and
  topics, acknowledge the handbook, or pick a time.
- **Training access** — where ongoing education lives, how to get into the training site,
  and which program applies to the employee's role.
- **Resources** — mini-tabs of reference material the shop uploads. Includes
  **1099 Resources — New York**: first-principles material on tracking income, tracking
  expenses, and filing taxes. Optional reading; nothing here is assigned or tracked.
- **Questions** — common onboarding FAQ.

### Admin (back of house)
- **Overview** — roster of everyone currently onboarding with progress and next step.
  Tap an employee to assign meetings, mark them complete, add internal notes, and
  confirm training-platform access.
- **Team & photos** — manage who appears on the "Meet the shop" page and **upload a
  headshot** for each artisan (replaces the monogram on their profile card).
- **Meeting times** — create available meeting slots and assign hosts.
- **Content** — edit onboarding-specific content (welcome message, external training
  link, and more). Includes the "later phase" training-site integration items, marked
  as out of scope for the initial release.
- **Resources** — create the mini-tabs employees see, upload documents into them, edit
  the page text, and publish. New tabs and new uploads always start as drafts, and
  drafts are invisible to employees rather than greyed out.

---

## The four-step meeting journey
1. **Handbook Meeting** — policies, expectations, culture, procedures (with handbook acknowledgment).
2. **Front Desk & Concierge Standards** — guest-service and hospitality expectations.
3. **Assistant Stylist Program** — assigned only to relevant roles.
4. **Artisan Continued Development** — introduces the ongoing education system and the training site.

---

## Running it
Open `index.html` in any modern browser. That's it.

## Testing it
```
open index.html?selftest=1     # results render in an overlay panel
node run-tests.mjs             # headless, exits non-zero on failure
```
No install, no dependencies — the runner drives a Chromium already on the machine.
See **`TESTING.md`**.

## Deploying with GitHub Pages
Because the app is a single `index.html`, GitHub Pages can serve it directly:
1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch.**
3. Choose your default branch and the `/ (root)` folder, then **Save**.
4. Your live link appears at the top of the Pages settings after a minute or so.

> Prefer a **private** repo while the content is still a draft — the team names and
> bios are placeholders and shouldn't be publicly indexed until the real details are in.

---

## Architecture (backend-ready)

Although it's a single file, the prototype is structured so a real backend and
database can be dropped in without rewriting the UI:

- **`DB`** — seed data shaped exactly like the SQL tables. Every entity has a
  stable string id (`emp_jordan`, `mtg_handbook`, `tm_charlie`, …) — never an
  array index — with proper relationships (employees ↔ meetings ↔ slots,
  per-employee checklist state, team-member → hosted meetings).
- **`Store`** — the single data-access layer, and the seam where the backend
  plugs in. Every read and write the UI performs goes through a `Store` method,
  and each is annotated with the REST endpoint it maps to. The methods are async
  and return deep clones, so the UI already behaves as if it's talking to a
  server. Going live = replacing each method body with a `fetch`; the UI is
  untouched.
- **`state` + render layer** — the UI reads only from an in-memory `state` cache
  populated by a single `refresh()`, and re-fetches after every mutation.

Companion files:

- **`schema.sql`** — PostgreSQL DDL for every table (content, meetings,
  meeting_slots, team_members + hosts, employees, employee_meetings, checklist
  groups/items/state, resource categories/sections/documents/figures), with keys,
  foreign keys, enums, and implementation notes.
- **`API.md`** — the REST contract: one endpoint per `Store` method, with request
  and response shapes.
- **`RESOURCES-SCOPE.md`** — the Resources feature scope: what was decided, what was
  deliberately left out, and why. Where two designs were reasonable, the one not taken
  is named so it doesn't get re-litigated.
- **`TESTING.md`** — how to run the self-test harness and how to add a suite.

Derived values (onboarding progress, "next step," the auto-tracked meetings
checklist group) are computed rather than stored ad hoc, so the backend owns them.

## Notes / status
- This is a **prototype**: state (checkboxes, scheduling, uploaded headshots, notes)
  lives in memory and resets on refresh. Wiring `Store` to the API in `API.md`
  makes it persistent.
- Team roles and bios are **placeholders** — replace them with the shop's real details.
- Uploaded headshots are held for the browser session only (base64 in memory); in
  production they upload to object storage — see the `photo` note in `API.md`.
- Individual training modules are intentionally **not** managed here (see project scope).
