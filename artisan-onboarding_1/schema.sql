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

COMMIT;

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
