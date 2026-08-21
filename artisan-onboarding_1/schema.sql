-- ============================================================================
-- Artisan Barber — Onboarding Platform
-- Database schema (PostgreSQL)
--
-- This mirrors the normalized data model the frontend already speaks (see the
-- `DB` seed and `Store` layer in index.html, and the endpoint contract in
-- API.md). Every entity the UI references by id maps to a row here.
-- ============================================================================

BEGIN;

-- ---- enums --------------------------------------------------------------
CREATE TYPE meeting_status  AS ENUM ('pending', 'scheduled', 'complete');
CREATE TYPE checklist_kind  AS ENUM ('manual', 'auto');

-- ---- content: single-row settings --------------------------------------
CREATE TABLE content (
  id               TEXT PRIMARY KEY DEFAULT 'singleton',
  welcome_message  TEXT NOT NULL,
  training_url      TEXT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT content_singleton CHECK (id = 'singleton')
);

-- ---- meetings: the onboarding step templates ----------------------------
CREATE TABLE meetings (
  id             TEXT PRIMARY KEY,          -- e.g. 'mtg_handbook'
  step           INT  NOT NULL,             -- 1..N ordering
  roman          TEXT NOT NULL,             -- 'I', 'II', ... (display)
  title          TEXT NOT NULL,
  short_title    TEXT NOT NULL,
  duration_min   INT  NOT NULL DEFAULT 45,
  role_only      BOOLEAN NOT NULL DEFAULT false,  -- assigned only to eligible roles
  requires_ack   BOOLEAN NOT NULL DEFAULT false,  -- e.g. handbook acknowledgment
  default_host   TEXT,                      -- "Charlie · Owner"
  purpose        TEXT NOT NULL,
  topics_label   TEXT NOT NULL,
  topics         JSONB NOT NULL DEFAULT '[]'::jsonb,   -- string[]
  prep           JSONB NOT NULL DEFAULT '[]'::jsonb,   -- string[]
  boundary       TEXT,                      -- nullable scope note
  sort_order     INT NOT NULL DEFAULT 0
);

-- ---- meeting_slots: available times per meeting -------------------------
CREATE TABLE meeting_slots (
  id           TEXT PRIMARY KEY,            -- 'slot_3'
  meeting_id   TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  when_label   TEXT NOT NULL,              -- "Wed Jul 15 · 9:30 AM" (see note below)
  starts_at    TIMESTAMPTZ,               -- recommended: store a real timestamp too
  host         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_slots_meeting ON meeting_slots(meeting_id);

-- ---- team_members: shop artisans on "Meet the shop" ---------------------
CREATE TABLE team_members (
  id                 TEXT PRIMARY KEY,      -- 'tm_charlie'
  name               TEXT NOT NULL,
  initials           TEXT NOT NULL,         -- derived from name, cached for UI
  role               TEXT NOT NULL,
  experience         TEXT NOT NULL DEFAULT '',
  bio                TEXT NOT NULL DEFAULT '',
  specialties        JSONB NOT NULL DEFAULT '[]'::jsonb,  -- string[]
  photo_url          TEXT,                  -- object-storage URL (see note)
  sort_order         INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- which meetings a team member hosts (many-to-many)
CREATE TABLE team_member_hosts (
  team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  meeting_id     TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  PRIMARY KEY (team_member_id, meeting_id)
);

-- ---- employees: everyone onboarding -------------------------------------
CREATE TABLE employees (
  id                TEXT PRIMARY KEY,       -- 'emp_jordan'
  name              TEXT NOT NULL,
  initials          TEXT NOT NULL,
  role              TEXT NOT NULL,
  day_label         TEXT,                   -- "Day 4" (or derive from start_date)
  start_date        DATE,
  eligible_for_asp  BOOLEAN NOT NULL DEFAULT false,  -- Assistant Stylist Program
  training_access   BOOLEAN NOT NULL DEFAULT false,  -- confirmed access to training site
  progress          INT NOT NULL DEFAULT 0, -- cached/derived 0..100 (see trigger note)
  admin_notes       TEXT NOT NULL DEFAULT '',
  is_current_user   BOOLEAN NOT NULL DEFAULT false,  -- prototype convenience; real auth replaces this
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- employee_meetings: one row per employee per applicable meeting -----
CREATE TABLE employee_meetings (
  id               TEXT PRIMARY KEY,        -- 'em_1'
  employee_id      TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  meeting_id       TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  status           meeting_status NOT NULL DEFAULT 'pending',
  when_label       TEXT,                    -- chosen slot label, nullable
  slot_id          TEXT REFERENCES meeting_slots(id) ON DELETE SET NULL,
  host             TEXT,
  acknowledged_at  TIMESTAMPTZ,             -- non-null once acknowledged (requires_ack meetings)
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, meeting_id)
);
CREATE INDEX idx_empmtg_employee ON employee_meetings(employee_id);

-- ---- checklist template -------------------------------------------------
CREATE TABLE checklist_groups (
  id          TEXT PRIMARY KEY,             -- 'grp_employment'
  title       TEXT NOT NULL,
  subtitle    TEXT NOT NULL DEFAULT '',
  kind        checklist_kind NOT NULL DEFAULT 'manual',  -- 'auto' = derived from employee_meetings
  sort_order  INT NOT NULL DEFAULT 0
);

CREATE TABLE checklist_items (
  id          TEXT PRIMARY KEY,             -- 'itm_i9'
  group_id    TEXT NOT NULL REFERENCES checklist_groups(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_items_group ON checklist_items(group_id);

-- ---- checklist_state: per-employee completion of manual items -----------
CREATE TABLE checklist_state (
  employee_id  TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  item_id      TEXT NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  done         BOOLEAN NOT NULL DEFAULT false,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, item_id)
);

-- ============================================================================
-- Resources: mini-tabs of reference material
--
-- THE BOUNDARY, and it is load-bearing: if anyone would ever need to answer
-- "who completed this, when, and did they pass?", it is training and belongs on
-- the separate training site — not here. Resources is read-at-your-own-pace
-- reference material with no sequence, no assessment and no completion state.
-- See RESOURCES-SCOPE.md.
--
-- Sections hang off the CATEGORY, not off a document, so a mini-tab can be both
-- a readable page and a folder of files without a kind flag on the container.
-- ============================================================================

CREATE TYPE resource_status     AS ENUM ('draft', 'published');
CREATE TYPE resource_visibility AS ENUM ('everyone', 'admins');
CREATE TYPE resource_doc_kind   AS ENUM ('file', 'link');

-- ---- resource_categories: one row per mini-tab --------------------------
CREATE TABLE resource_categories (
  id             TEXT PRIMARY KEY,                 -- 'rc_1099ny'
  name           TEXT NOT NULL,
  short_name     TEXT NOT NULL,                    -- pill label; name is the panel heading
  blurb          TEXT NOT NULL DEFAULT '',
  status         resource_status     NOT NULL DEFAULT 'draft',
  visibility     resource_visibility NOT NULL DEFAULT 'everyone',
  tax_year       INT,                              -- non-null marks a year-sensitive tab
  reviewed_on    DATE,
  audience_note  TEXT NOT NULL DEFAULT '',
  sort_order     INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- resource_sections: authored prose, child of the category -----------
CREATE TABLE resource_sections (
  id           TEXT PRIMARY KEY,                   -- 'sec_income'
  category_id  TEXT NOT NULL REFERENCES resource_categories(id) ON DELETE CASCADE,
  heading      TEXT NOT NULL,
  body         JSONB NOT NULL DEFAULT '[]'::jsonb, -- string[] of paragraphs
  bullets      JSONB NOT NULL DEFAULT '[]'::jsonb, -- string[]
  body2        JSONB NOT NULL DEFAULT '[]'::jsonb, -- paragraphs after the bullets
  sort_order   INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_res_sections_cat ON resource_sections(category_id);

-- ---- resource_figures: year-stamped values referenced from prose --------
-- Prose writes {{token}}; the renderer substitutes the value and shows the year.
-- This is the answer to the staleness problem: a hardcoded 2026 rate is wrong in
-- 2027 and fails silently, so figures are data an admin can correct, not code.
CREATE TABLE resource_figures (
  id           TEXT PRIMARY KEY,                   -- 'fig_mile'
  category_id  TEXT NOT NULL REFERENCES resource_categories(id) ON DELETE CASCADE,
  token        TEXT NOT NULL,                      -- 'mileage'
  tax_year     INT  NOT NULL,
  value        TEXT NOT NULL,                      -- display string, not a number
  label        TEXT NOT NULL,
  source_url   TEXT NOT NULL,
  UNIQUE (category_id, token, tax_year)
);

-- ---- resource_documents: uploaded files and links out -------------------
CREATE TABLE resource_documents (
  id             TEXT PRIMARY KEY,                 -- 'doc_setaside'
  category_id    TEXT NOT NULL REFERENCES resource_categories(id) ON DELETE CASCADE,
  kind           resource_doc_kind NOT NULL DEFAULT 'file',
  status         resource_status   NOT NULL DEFAULT 'draft',
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  file_name      TEXT,                             -- as uploaded; DISPLAY ONLY, always escaped
  download_name  TEXT,                             -- sanitised; used for Content-Disposition
  mime_type      TEXT,                             -- authoritative value is the SNIFFED one
  byte_size      BIGINT,
  storage_url    TEXT,                             -- object-storage key (prototype: base64 in memory)
  url            TEXT,                             -- kind='link' target
  version        INT  NOT NULL DEFAULT 1,
  open_count     INT  NOT NULL DEFAULT 0,          -- aggregate only; see the note below
  updated_on     DATE,
  sort_order     INT  NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT resource_doc_shape CHECK (
    (kind = 'link' AND url IS NOT NULL) OR (kind = 'file' AND file_name IS NOT NULL)),
  CONSTRAINT resource_doc_mime CHECK (
    mime_type IS NULL OR mime_type IN ('application/pdf','image/png','image/jpeg','image/webp'))
);
CREATE INDEX idx_res_docs_cat ON resource_documents(category_id, sort_order);

-- A meeting can point at a document — the Step I handbook button uses this.
ALTER TABLE meetings
  ADD COLUMN resource_document_id TEXT REFERENCES resource_documents(id) ON DELETE SET NULL;

-- ============================================================================
-- Floor: hourly duties and bounties
--
-- The hourly box is BOTH: it says what an hour is for, and each duty ticks off
-- as a daily checklist. What keeps the checklist from becoming a performance
-- record is four things, and all four are load-bearing (FLOOR-SCOPE.md §4):
--
--   1. duty_checks is keyed by LOCAL DATE. Every day starts clean. There is no
--      carry-over, no streak, and nothing ever becomes 'missed' — an unticked
--      duty at midnight simply stops being a question.
--   2. Retention is a rolling window (14 days). The questions this data can
--      honestly answer are "what is outstanding right now" and "did the opening
--      get done today". Neither needs last March.
--   3. Admin reads a COUNT FOR THE ROLE, never a per-person breakdown. The
--      shop's question is "did the close get done"; answering it by name turns
--      a checklist into a scoreboard, and a scoreboard gets gamed.
--   4. Unticking is an UPDATE of the same row, not an append.
--
-- Bounties keep permanent history instead, because "did the quarterly deep-clean
-- happen" is a question someone needs answered in November.
--
-- Schedules are keyed by ROLE, not by person. Two concierges do the same job.
-- ============================================================================

CREATE TYPE duty_day_key   AS ENUM ('default','mon','tue','wed','thu','fri','sat','sun');
CREATE TYPE bounty_period  AS ENUM ('weekly', 'monthly', 'quarterly');
CREATE TYPE bounty_status  AS ENUM ('active', 'archived');
CREATE TYPE bounty_state   AS ENUM ('open', 'claimed', 'done', 'missed');

-- ---- duty_schedules: one per role ---------------------------------------
-- Open hours are NOT stored. A day's span is derived from the blocks that
-- resolve for it, so authoring and opening hours cannot contradict each other.
CREATE TABLE duty_schedules (
  id           TEXT PRIMARY KEY,                 -- 'sch_frontdesk'
  role         TEXT NOT NULL UNIQUE,             -- matches employees.role
  name         TEXT NOT NULL,
  blurb        TEXT NOT NULL DEFAULT '',
  closed_days  JSONB NOT NULL DEFAULT '[]'::jsonb,  -- ['mon']
  sort_order   INT  NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- duty_standing: true for the whole shift, shown once -----------------
CREATE TABLE duty_standing (
  id           TEXT PRIMARY KEY,                 -- 'std_greet'
  schedule_id  TEXT NOT NULL REFERENCES duty_schedules(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT '',
  sort_order   INT  NOT NULL DEFAULT 0
);
CREATE INDEX idx_duty_standing_sch ON duty_standing(schedule_id, sort_order);

-- ---- duty_blocks: what makes 10am different from 4pm --------------------
-- day_key = 'default' is the day most days look like. A weekday key overrides
-- that day ENTIRELY — default blocks do not leak into an overridden day. See
-- FLOOR-SCOPE.md section 5 for why a per-hour merge was rejected.
CREATE TABLE duty_blocks (
  id           TEXT PRIMARY KEY,                 -- 'blk_fd_09'
  schedule_id  TEXT NOT NULL REFERENCES duty_schedules(id) ON DELETE CASCADE,
  day_key      duty_day_key NOT NULL DEFAULT 'default',
  hour         INT  NOT NULL,                    -- 0..23, the hour this governs
  label        TEXT NOT NULL,                    -- 'Open the desk'
  note         TEXT NOT NULL DEFAULT '',
  UNIQUE (schedule_id, day_key, hour),
  CONSTRAINT duty_block_hour CHECK (hour >= 0 AND hour < 24)
);
CREATE INDEX idx_duty_blocks_day ON duty_blocks(schedule_id, day_key, hour);

-- ---- duty_items: one duty line, and the thing a tick points at -----------
-- This is a TABLE and not a JSON array on duty_blocks because duty_checks
-- references individual duties. An index into a JSON array is not an identity:
-- reorder or delete a line and yesterday's tick lands on a different duty.
CREATE TABLE duty_items (
  id          TEXT PRIMARY KEY,                  -- 'dut_fd09_1'
  block_id    TEXT NOT NULL REFERENCES duty_blocks(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  sort_order  INT  NOT NULL DEFAULT 0,
  CONSTRAINT duty_item_text CHECK (btrim(text) <> '')
);
CREATE INDEX idx_duty_items_block ON duty_items(block_id, sort_order);

-- ---- duty_checks: the daily checklist -----------------------------------
-- One row per person per LOCAL DATE per duty. on_date is a DATE, not a
-- timestamp, and it is the shop's local date: a shift ending at 6pm in New York
-- is already tomorrow in UTC, and keying on that clears the closing checklist
-- halfway through the close.
CREATE TABLE duty_checks (
  employee_id   TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  duty_item_id  TEXT NOT NULL REFERENCES duty_items(id) ON DELETE CASCADE,
  on_date       DATE NOT NULL,
  done          BOOLEAN NOT NULL DEFAULT false,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, duty_item_id, on_date)
);
CREATE INDEX idx_duty_checks_date ON duty_checks(on_date);

-- ---- bounties: the definition -------------------------------------------
-- "Bounty" is a NAME, not a reward. No points, no ledger, no balance. Adding a
-- reward means a per-person ledger, reset rules and an approval step; none of
-- that is here and none of it should be inferred from the word.
CREATE TABLE bounties (
  id           TEXT PRIMARY KEY,                 -- 'bty_shelves'
  title        TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT '',
  period       bounty_period NOT NULL,
  size_min     INT  NOT NULL,                    -- estimated minutes; required
  roles        JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [] = anyone may take it
  status       bounty_status NOT NULL DEFAULT 'active',
  sort_order   INT  NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bounty_size CHECK (size_min > 0 AND size_min <= 480)
);

-- ---- bounty_instances: one per bounty per period ------------------------
-- period_key is DERIVED, never free text: '2026-W31' (ISO 8601 week),
-- '2026-08', '2026-Q3'. Instances are never deleted and a missed one is never
-- rewritten — the miss is the record.
CREATE TABLE bounty_instances (
  id            TEXT PRIMARY KEY,                -- 'bi_1'
  bounty_id     TEXT NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
  period_key    TEXT NOT NULL,
  state         bounty_state NOT NULL DEFAULT 'open',
  claimed_by    TEXT REFERENCES employees(id) ON DELETE SET NULL,
  claimed_at    TIMESTAMPTZ,
  completed_by  TEXT REFERENCES employees(id) ON DELETE SET NULL,
  completed_at  TIMESTAMPTZ,
  UNIQUE (bounty_id, period_key),
  CONSTRAINT bounty_instance_shape CHECK (
    (state = 'open'    AND claimed_by IS NULL     AND completed_by IS NULL) OR
    (state = 'claimed' AND claimed_by IS NOT NULL AND completed_by IS NULL) OR
    (state = 'done'    AND completed_at IS NOT NULL) OR
    -- claimed_by is dropped on a miss: a claim is not a commitment, so failing
    -- to finish one must not leave a permanent mark with someone's name on it.
    (state = 'missed'  AND claimed_by IS NULL AND completed_by IS NULL))
);
CREATE INDEX idx_bounty_inst ON bounty_instances(bounty_id, period_key);

COMMIT;

-- ============================================================================
-- Floor implementation notes
-- ----------------------------------------------------------------------------
-- * RETENTION ON duty_checks IS NOT OPTIONAL. The prototype trims to a rolling
--   14 days on read; production wants a nightly
--     DELETE FROM duty_checks WHERE on_date < current_date - INTERVAL '14 days'
--   plus ON DELETE CASCADE from employees, which is already declared. Dropping
--   the window turns a working checklist into a permanent per-employee
--   performance record. See FLOOR-SCOPE.md section 4.
--
-- * DO NOT ADD A PER-PERSON ADMIN VIEW of duty_checks. The aggregate coverage
--   read answers the shop's actual question ("did the close get done") without
--   turning the checklist into a scoreboard people tick first and work second.
--   This is a mitigation the feature depends on, not an unfinished screen.
--
-- * DUTIES ARE NEVER 'missed'. Bounties have that state; duties do not, and
--   adding it recreates exactly what the daily reset exists to avoid.
--
-- * EDITING A BLOCK'S DUTIES reconciles BY TEXT, so reordering lines keeps the
--   day's ticks attached while rewording a line yields a new duty_items row
--   with a clean tick. An edited duty is a different duty.
--
-- * DAY RESOLUTION is three rules in order, for a weekday W:
--     1. W in duty_schedules.closed_days           -> closed
--     2. any duty_blocks row with day_key = W      -> those blocks ARE the day
--     3. otherwise                                 -> day_key = 'default' blocks
--   Standing duties are unaffected by an override; they are standing.
--
-- * PERIOD KEYS are derived from a date, never stored as typed text. The weekly
--   key is ISO 8601 — the week containing the first Thursday — so 1 January can
--   legitimately belong to the previous year's final week. Getting this wrong
--   silently splits one week's bounty across two keys.
--
-- * ROLLOVER should be a scheduled job in production. The prototype does it
--   lazily on read, which is correct but means a bounty is only marked missed
--   once someone looks. A nightly job that closes out the previous period is the
--   v1 shape.
--
-- * claimed_by / completed_by are ON DELETE SET NULL, so offboarding a person
--   preserves the fact that a bounty was done while dropping who did it. The
--   operational question is "was it done"; the name is not worth retaining
--   against a departed employee. This mirrors the Resources read-receipt
--   reasoning in RESOURCES-SCOPE.md section 7.
--
-- * CLAIMS ARE A SOFT LOCK, not a commitment. Releasing a claim records nothing
--   against the person. Treating a claim as a promise teaches people not to
--   claim, which costs you the coordination the lock exists to provide.
--
-- * TIMEZONE. The prototype resolves "now" in the browser's local zone. A shop
--   spanning a DST boundary or an admin travelling will both see the wrong hour.
--   Production should resolve the current hour in the SHOP's zone, stored on the
--   shop record, and never in the client's.
--
-- * THE CONTROL QUESTION. An hour-by-hour duty schedule is close to the
--   strongest available evidence of control in a worker-misclassification
--   analysis. Schedules attach to ROLES so that who has one stays an explicit,
--   visible choice. See FLOOR-SCOPE.md section 9 and RESOURCES-SCOPE.md
--   section 8.
-- ============================================================================

-- ============================================================================
-- Resources implementation notes
-- ----------------------------------------------------------------------------
-- * VISIBILITY CASCADES. A published document inside a draft or admins-only
--   category must NOT be reachable, including by direct id — otherwise the
--   document is exposed the moment someone learns the id. Resolve the parent
--   category on every document read.
--
-- * ROLE COMES FROM THE SESSION, never from the request. `?include=all` is a
--   request, honored only when the caller is an admin and silently downgraded
--   otherwise. Do not return 403 — a 403 confirms that drafts exist.
--
-- * image/svg+xml IS DELIBERATELY ABSENT from resource_doc_mime. An SVG is a
--   script container, and a blob: URL inherits the origin of the page that
--   created it. Do not add it.
--
-- * mime_type must be the value SNIFFED from magic bytes, not the browser's
--   guess. file.type is derived from the extension, so renaming payload.html to
--   payload.pdf passes any client-side check. Reject on sniffed/declared
--   mismatch and store the sniffed value.
--
-- * file_name vs download_name do two different jobs. Keep the uploaded name
--   verbatim for display (always rendered escaped); derive download_name at
--   write time by taking the basename and collapsing anything outside
--   [A-Za-z0-9._-]. An allowlist strips bidi overrides and CR/LF for free,
--   which a blocklist does not.
--
-- * open_count is AGGREGATE ONLY and there is no resource_views table. A
--   per-employee read-receipt table on a tax-information page creates a record
--   of which worker read about misclassification, retained indefinitely and
--   discoverable — and it breaks on contact with reality, because an
--   ON DELETE CASCADE from employees erases it exactly when it would matter.
--   The question admin actually has is "is anyone reading this", which a
--   counter answers. See RESOURCES-SCOPE.md section 7.
--
-- * VERSIONING IS NOT IMPLEMENTED. version is a counter; replacing a file
--   overwrites storage_url. Before claiming old objects are retained, add
--   resource_document_versions (document_id, version, storage_url, byte_size,
--   checksum, replaced_at, replaced_by, PK (document_id, version)) and insert a
--   row before every overwrite.
--
-- * NO WRITE AUDIT EXISTS YET. Add resource_audit_log (id, actor_user_id,
--   action, entity_type, entity_id, detail JSONB, created_at) written by every
--   mutating endpoint, deriving the actor from the session and never from the
--   body.
-- ============================================================================

-- ============================================================================
-- Implementation notes
-- ----------------------------------------------------------------------------
-- * when_label / roman / initials / progress are DENORMALIZED for display. The
--   prototype stores human strings ("Wed Jul 15 · 9:30 AM"). In production,
--   prefer real timestamps (starts_at) and format server- or client-side; keep
--   the label only if you want to preserve exact wording.
--
-- * progress is a cached 0..100 value. Either recompute it in the API on every
--   employee_meetings / checklist_state write, or maintain it with a trigger:
--   completed applicable meetings / total applicable meetings (+ optionally
--   checklist completion). The frontend treats it as read-only.
--
-- * The "Required meetings" checklist group (kind='auto') has NO rows in
--   checklist_items/checklist_state. It is a VIEW over employee_meetings:
--   one line per applicable meeting, done = (status = 'complete').
--
-- * "Applicable" meetings for an employee = all meetings where role_only = false,
--   PLUS role_only meetings when the employee is eligible (e.g. eligible_for_asp).
--   Only create employee_meetings rows for applicable meetings; assigning a
--   program (assign-program) flips eligibility and inserts the missing row.
--
-- * photo_url: the prototype inlines a base64 data URL. In production, upload the
--   image to object storage (S3/GCS) and store the returned URL here.
-- ============================================================================
