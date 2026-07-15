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

COMMIT;

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
