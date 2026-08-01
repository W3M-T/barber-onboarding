/* ==========================================================================
   Artisan Barber — Onboarding
   SELF-TEST HARNESS

   Loaded only when index.html is opened with ?selftest=1 (or #selftest).
   Never loads during normal use, so the shipped app stays dependency-free.

   How it works
   ------------
   index.html's inline script declares DB / Store / state / helpers at the top
   level of a classic script. Classic scripts share one global lexical scope,
   so this file — injected as a classic <script> after the initial refresh() —
   can reach all of them directly. No modules, no bundler, no imports.

   Running
   -------
   Browser : open index.html?selftest=1 — results render in an overlay panel.
   CLI     : node run-tests.mjs — headless, exits non-zero on failure.

   Writing a test
   --------------
     suite('Area', () => {
       test('does the thing', async () => {
         const e = await Store.getEmployee('emp_jordan');
         eq(e.role, 'Assistant Stylist');
       });
     });

   Every test starts from a pristine seed: the harness snapshots DB before the
   first test and restores it (plus UI globals and the dynamic screens) between
   tests, then awaits refresh(). Tests never need to clean up after themselves.
   ========================================================================== */
(function () {
'use strict';

/* ===================== framework ======================================== */

const SUITES = [];
let _collecting = null;

function suite(name, fn) {
  if (_collecting) throw new Error('suite() cannot be nested');
  _collecting = { name, tests: [] };
  SUITES.push(_collecting);
  try { fn(); } finally { _collecting = null; }
}
function test(name, fn) {
  if (!_collecting) throw new Error('test() must be called inside suite()');
  _collecting.tests.push({ name, fn });
}

class Fail extends Error {
  constructor(msg) { super(msg); this.name = 'AssertionError'; }
}

/* Render a value compactly for failure messages. */
function show(v) {
  if (typeof v === 'string') return JSON.stringify(v.length > 120 ? v.slice(0, 117) + '…' : v);
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length > 8 ? `Array(${v.length})` : JSON.stringify(v);
  if (typeof v === 'object') { const s = JSON.stringify(v); return s && s.length > 160 ? s.slice(0, 157) + '…' : s; }
  return String(v);
}
function why(msg, detail) { return msg ? `${msg} — ${detail}` : detail; }

/* ---- assertions ---- */
function ok(cond, msg)            { if (!cond) throw new Fail(why(msg, `expected truthy, got ${show(cond)}`)); }
function notOk(cond, msg)         { if (cond) throw new Fail(why(msg, `expected falsy, got ${show(cond)}`)); }
function eq(actual, expected, msg){ if (!Object.is(actual, expected)) throw new Fail(why(msg, `expected ${show(expected)}, got ${show(actual)}`)); }
function neq(actual, other, msg)  { if (Object.is(actual, other)) throw new Fail(why(msg, `expected value to differ from ${show(other)}`)); }
function deepEq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Fail(why(msg, `expected ${show(expected)}, got ${show(actual)}`));
}
function gt(actual, floor, msg)   { if (!(actual > floor)) throw new Fail(why(msg, `expected ${show(actual)} > ${show(floor)}`)); }
function gte(actual, floor, msg)  { if (!(actual >= floor)) throw new Fail(why(msg, `expected ${show(actual)} >= ${show(floor)}`)); }
function lt(actual, ceil, msg)    { if (!(actual < ceil)) throw new Fail(why(msg, `expected ${show(actual)} < ${show(ceil)}`)); }
function lte(actual, ceil, msg)   { if (!(actual <= ceil)) throw new Fail(why(msg, `expected ${show(actual)} <= ${show(ceil)}`)); }
function len(subject, n, msg) {
  const actual = subject == null ? -1 : subject.length;
  if (actual !== n) throw new Fail(why(msg, `expected length ${n}, got ${actual}`));
}
function has(haystack, needle, msg) {
  const found = typeof haystack === 'string' ? haystack.includes(needle)
              : Array.isArray(haystack) ? haystack.includes(needle) : false;
  if (!found) throw new Fail(why(msg, `expected ${show(haystack)} to contain ${show(needle)}`));
}
function lacks(haystack, needle, msg) {
  const found = typeof haystack === 'string' ? haystack.includes(needle)
              : Array.isArray(haystack) ? haystack.includes(needle) : false;
  if (found) throw new Fail(why(msg, `expected ${show(haystack)} NOT to contain ${show(needle)}`));
}
function match(str, re, msg) {
  if (typeof str !== 'string' || !re.test(str)) throw new Fail(why(msg, `expected ${show(str)} to match ${re}`));
}
async function throwsAsync(fn, msg) {
  try { await fn(); } catch (e) { return e; }
  throw new Fail(why(msg, 'expected the call to reject, but it resolved'));
}

/* ---- DOM helpers ---- */
const q  = sel => document.querySelector(sel);
const qa = sel => Array.from(document.querySelectorAll(sel));
const text = sel => { const el = typeof sel === 'string' ? q(sel) : sel; return el ? el.textContent.trim() : null; };
const html = sel => { const el = typeof sel === 'string' ? q(sel) : sel; return el ? el.innerHTML : null; };
const shown = sel => { const el = typeof sel === 'string' ? q(sel) : sel; return !!el && el.classList.contains('active'); };
function click(sel) {
  const el = typeof sel === 'string' ? q(sel) : sel;
  if (!el) throw new Fail(`click target not found: ${sel}`);
  el.click();
  return el;
}
/* The app renders handlers as inline onclick="fn('id')" strings. This pulls the
   argument back out so tests can assert on wiring without eval. */
function handlerArg(el, fnName) {
  const attr = el && el.getAttribute && el.getAttribute('onclick');
  if (!attr) return null;
  const m = attr.match(new RegExp(fnName + "\\('([^']*)'"));
  return m ? m[1] : null;
}

/* ===================== isolation ======================================== */

/* Snapshot the seed before anything mutates it. refresh() only reads, so DB is
   still pristine at load time. */
const PRISTINE = JSON.stringify(DB);

function restoreDB() {
  const snap = JSON.parse(PRISTINE);
  /* Mutate in place — DB is a const binding, so it can never be reassigned. */
  for (const key of Object.keys(DB)) { if (!(key in snap)) delete DB[key]; }
  for (const key of Object.keys(snap)) {
    const next = snap[key];
    if (Array.isArray(next)) {
      if (!Array.isArray(DB[key])) DB[key] = [];
      DB[key].length = 0;
      for (const row of next) DB[key].push(row);
    } else if (next && typeof next === 'object') {
      if (!DB[key] || typeof DB[key] !== 'object') DB[key] = {};
      for (const k of Object.keys(DB[key])) delete DB[key][k];
      Object.assign(DB[key], next);
    } else {
      DB[key] = next;
    }
  }
}

/* Dynamic screens are built by innerHTML and would otherwise leak between tests. */
const DYNAMIC_SCREENS = ['#s-member', '#s-meeting', '#a-employee', '#resPanel', '#resPanelAdmin', '#resTabs', '#resTabsAdmin'];

async function resetApp() {
  restoreDB();
  rescheduleId = null;
  editId = null;
  uploadTargetId = null;
  resOpen = null;
  resOpenAdmin = null;
  editCatId = null;
  docTargetCatId = null;
  docReplaceId = null;
  /* Revokes any live object URL and unsets the scroll lock the overlay sets. */
  closeViewer();
  for (const sel of DYNAMIC_SCREENS) { const el = q(sel); if (el) el.innerHTML = ''; }
  const form = q('#memberForm'); if (form) form.style.display = 'none';
  const catForm = q('#catForm'); if (catForm) catForm.style.display = 'none';
  await refresh();
  setMode('employee');           /* also lands on s-home via go() */
}

/* ===================== runner =========================================== */

async function run() {
  const started = Date.now();
  const results = [];
  let passed = 0, failed = 0;

  for (const s of SUITES) {
    for (const t of s.tests) {
      const label = `${s.name} › ${t.name}`;
      let error = null;
      try {
        await resetApp();
        await t.fn();
        passed++;
      } catch (e) {
        failed++;
        error = { message: e && e.message ? e.message : String(e), kind: e instanceof Fail ? 'assertion' : 'error',
                  stack: e && e.stack ? String(e.stack).split('\n').slice(0, 4).join('\n') : null };
      }
      results.push({ suite: s.name, test: t.name, label, ok: !error, error });
    }
  }

  /* Leave the app in a clean, usable state for anyone poking at the page. */
  try { await resetApp(); } catch (_) { /* reporting matters more than cleanup */ }

  const report = {
    total: passed + failed, passed, failed,
    durationMs: Date.now() - started,
    suites: SUITES.length,
    failures: results.filter(r => !r.ok).map(r => ({ label: r.label, ...r.error })),
    results,
  };
  publish(report);
  return report;
}

/* ===================== reporting ======================================== */

function publish(report) {
  window.__TESTS__ = report;

  /* Machine-readable marker — run-tests.mjs greps for this in --dump-dom output. */
  const marker = document.createElement('script');
  marker.type = 'application/json';
  marker.id = 'test-results';
  marker.textContent = JSON.stringify({
    total: report.total, passed: report.passed, failed: report.failed,
    durationMs: report.durationMs, suites: report.suites, failures: report.failures,
  });
  document.body.appendChild(marker);

  const line = `[selftest] ${report.passed}/${report.total} passed` + (report.failed ? `, ${report.failed} FAILED` : '');
  (report.failed ? console.error : console.log)(line);
  for (const f of report.failures) console.error(`  ✗ ${f.label}\n    ${f.message}`);

  renderPanel(report);
}

function renderPanel(report) {
  const style = document.createElement('style');
  style.textContent = `
  #selftest-panel{position:fixed;inset:auto 0 0 0;z-index:9999;max-height:62vh;display:flex;flex-direction:column;
    font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:12px;line-height:1.5;
    background:#111214;color:#EFEDE7;border-top:2px solid ${report.failed ? '#C0553F' : '#9A7736'};
    box-shadow:0 -10px 30px rgba(0,0,0,.35)}
  #selftest-panel .st-head{display:flex;align-items:center;gap:12px;padding:10px 16px;flex:none;
    border-bottom:1px solid #2A2C31;cursor:pointer;user-select:none}
  #selftest-panel .st-badge{padding:3px 10px;border-radius:999px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;font-size:10px;
    background:${report.failed ? '#C0553F' : '#9A7736'};color:#111}
  #selftest-panel .st-meta{color:#9B968B}
  #selftest-panel .st-body{overflow:auto;padding:4px 16px 16px}
  #selftest-panel .st-suite{margin-top:12px;color:#C29A4B;letter-spacing:.1em;text-transform:uppercase;font-size:10px}
  #selftest-panel .st-row{display:flex;gap:8px;padding:2px 0}
  #selftest-panel .st-row.bad{color:#F0A08C}
  #selftest-panel .st-err{white-space:pre-wrap;color:#F0A08C;padding:2px 0 6px 20px;opacity:.9}
  #selftest-panel.closed .st-body{display:none}
  @media print{#selftest-panel{display:none}}`;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'selftest-panel';
  const bySuite = new Map();
  for (const r of report.results) {
    if (!bySuite.has(r.suite)) bySuite.set(r.suite, []);
    bySuite.get(r.suite).push(r);
  }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = [...bySuite.entries()].map(([name, rows]) => {
    const failedHere = rows.filter(r => !r.ok).length;
    return `<div class="st-suite">${esc(name)} · ${rows.length - failedHere}/${rows.length}</div>` +
      rows.map(r => `<div class="st-row ${r.ok ? '' : 'bad'}"><span>${r.ok ? '✓' : '✗'}</span><span>${esc(r.test)}</span></div>` +
        (r.ok ? '' : `<div class="st-err">${esc(r.error.message)}</div>`)).join('');
  }).join('');

  panel.innerHTML =
    `<div class="st-head"><span class="st-badge">${report.failed ? 'FAIL' : 'PASS'}</span>` +
    `<strong>${report.passed}/${report.total} passed</strong>` +
    `<span class="st-meta">${report.suites} suites · ${report.durationMs}ms</span>` +
    `<span class="st-meta" style="margin-left:auto">click to collapse</span></div>` +
    `<div class="st-body">${body}</div>`;
  panel.querySelector('.st-head').addEventListener('click', () => panel.classList.toggle('closed'));
  document.body.appendChild(panel);
}

/* ==========================================================================
   SUITES
   ========================================================================== */

/* --- placeholder proof-of-pipeline suite; real suites are appended below --- */
suite('Harness', () => {
  test('reaches the app globals', () => {
    ok(typeof DB === 'object' && DB, 'DB should be reachable from tests.js');
    ok(typeof Store === 'object' && Store, 'Store should be reachable');
    ok(typeof state === 'object' && state, 'state should be reachable');
    eq(typeof refresh, 'function');
  });

  test('restores the seed between tests', async () => {
    eq(DB.employees.length, 4, 'seed should start with four employees');
    DB.employees.push({ id: 'emp_ghost', name: 'Ghost' });
    eq(DB.employees.length, 5);
  });

  test('the previous test’s mutation is gone', () => {
    eq(DB.employees.length, 4, 'resetApp() should have restored the seed');
    notOk(DB.employees.some(e => e.id === 'emp_ghost'), 'leaked row from a prior test');
  });

  test('refresh() repopulates state', () => {
    eq(state.me.employee.id, CURRENT_USER);
    gt(state.team.length, 0);
    gt(state.meetings.length, 0);
  });
});

/* ===== AUTHORED SUITES (assembled) ===== */

/* --- seed --- */
suite('Seed · referential integrity', () => {
  const ids = rows => new Set(rows.map(r => r.id));

  test('every employeeMeetings row points at a real employee', () => {
    const known = ids(DB.employees);
    for (const em of DB.employeeMeetings) {
      ok(known.has(em.employeeId), `${em.id}.employeeId "${em.employeeId}" should resolve to a seeded employee`);
    }
  });

  test('every employeeMeetings row points at a real meeting', () => {
    const known = ids(DB.meetings);
    for (const em of DB.employeeMeetings) {
      ok(known.has(em.meetingId), `${em.id}.meetingId "${em.meetingId}" should resolve to a seeded meeting`);
    }
  });

  test('employeeMeetings holds at most one row per employee + meeting', () => {
    const seen = new Set();
    for (const em of DB.employeeMeetings) {
      const key = em.employeeId + '|' + em.meetingId;
      notOk(seen.has(key), `employee_meetings is UNIQUE(employee_id, meeting_id); ${key} appears twice (${em.id})`);
      seen.add(key);
    }
  });

  test('employeeMeetings rows exist only for applicable meetings', () => {
    for (const em of DB.employeeMeetings) {
      const emp = DB.employees.find(e => e.id === em.employeeId);
      const applicable = _applicableMeetings(emp).some(m => m.id === em.meetingId);
      ok(applicable, `${em.id} assigns role-only ${em.meetingId} to ${emp.id}, who is not eligible for it`);
    }
  });

  test('every employee has an instance for each applicable meeting', () => {
    for (const emp of DB.employees) {
      for (const m of _applicableMeetings(emp)) {
        const inst = _instances(emp.id).find(i => i.meetingId === m.id);
        ok(inst, `${emp.id} should be seeded with an employee_meetings row for applicable meeting ${m.id}`);
      }
    }
  });

  test('every checklistItems.groupId resolves to a real group', () => {
    const known = ids(DB.checklistGroups);
    for (const it of DB.checklistItems) {
      ok(known.has(it.groupId), `${it.id}.groupId "${it.groupId}" should resolve to a seeded checklist group`);
    }
  });

  test('every checklistState row resolves to a real employee and item', () => {
    const emps = ids(DB.employees), items = ids(DB.checklistItems);
    for (const s of DB.checklistState) {
      ok(emps.has(s.employeeId), `checklistState references unknown employee "${s.employeeId}"`);
      ok(items.has(s.itemId), `checklistState references unknown item "${s.itemId}"`);
    }
  });

  test('checklistState holds at most one row per employee + item', () => {
    const seen = new Set();
    for (const s of DB.checklistState) {
      const key = s.employeeId + '|' + s.itemId;
      notOk(seen.has(key), `checklist_state PK is (employee_id, item_id); ${key} appears twice`);
      seen.add(key);
    }
  });

  test('every slot points at a real meeting', () => {
    const known = ids(DB.meetings);
    for (const s of DB.slots) {
      ok(known.has(s.meetingId), `${s.id}.meetingId "${s.meetingId}" should resolve to a seeded meeting`);
    }
  });

  test('every meeting is bookable — Store.listSlots returns at least one time', async () => {
    for (const m of DB.meetings) {
      const slots = await Store.listSlots(m.id);
      gt(slots.length, 0, `${m.id} has no seeded slots, so the employee could never book it`);
    }
  });

  test('every team hostsMeetingIds entry resolves to a real meeting', () => {
    const known = ids(DB.meetings);
    for (const t of DB.team) {
      for (const mid of t.hostsMeetingIds) {
        ok(known.has(mid), `${t.id} claims to host unknown meeting "${mid}"`);
      }
    }
  });

  test('every meeting has exactly one hosting team member', () => {
    for (const m of DB.meetings) {
      const hosts = DB.team.filter(t => t.hostsMeetingIds.includes(m.id));
      len(hosts, 1, `${m.id} should be hosted by exactly one team member, got [${hosts.map(h => h.id)}]`);
    }
  });

  test('each meeting defaultHost names the team member who hosts it', () => {
    for (const m of DB.meetings) {
      const host = DB.team.find(t => t.hostsMeetingIds.includes(m.id));
      const firstName = String(m.defaultHost || '').split('·')[0].trim();
      eq(firstName, host.name.split(/\s+/)[0], `${m.id}.defaultHost "${m.defaultHost}" should name its host (${host.name})`);
    }
  });
});

/* --- seed --- */
suite('Seed · id conventions', () => {
  /* id prefix documented in API.md ("emp_jordan, mtg_handbook, tm_charlie,
     slot_3, em_1, grp_setup, itm_i9") and in the schema.sql column comments. */
  const TABLES = [
    ['meetings', 'mtg_'], ['team', 'tm_'], ['slots', 'slot_'], ['employees', 'emp_'],
    ['employeeMeetings', 'em_'], ['checklistGroups', 'grp_'], ['checklistItems', 'itm_']
  ];

  test('every row carries the documented prefix for its type', () => {
    for (const [table, prefix] of TABLES) {
      for (const row of DB[table]) {
        ok(typeof row.id === 'string' && row.id.startsWith(prefix) && row.id.length > prefix.length,
          `DB.${table} id "${row.id}" should start with "${prefix}" and have a suffix`);
      }
    }
  });

  test('employee ids are not mistakable for employeeMeetings ids', () => {
    /* emp_ and em_ share a stem; the suffix rule keeps them apart. */
    for (const e of DB.employees) match(e.id, /^emp_[a-z][a-z0-9]*$/, `employee id "${e.id}" should look like emp_<slug>`);
    for (const em of DB.employeeMeetings) match(em.id, /^em_\d+$/, `employee-meeting id "${em.id}" should look like em_<n>`);
  });

  test('ids are unique within each collection', () => {
    for (const [table] of TABLES) {
      const list = DB[table].map(r => r.id);
      eq(new Set(list).size, list.length, `DB.${table} contains a duplicate id`);
    }
  });

  test('ids are unique across the whole seed', () => {
    const all = TABLES.flatMap(([table]) => DB[table].map(r => r.id));
    const dupes = all.filter((id, i) => all.indexOf(id) !== i);
    len(dupes, 0, `ids must be globally stable and unambiguous; duplicated: ${dupes}`);
  });

  test('newId() keeps the prefix convention for rows created at runtime', async () => {
    const member = await Store.addTeamMember({ name: 'Nina Patel', role: 'Barber' });
    match(member.id, /^tm_\d+$/, 'a created team member should get a tm_ id');
    const slot = await Store.addSlot('mtg_acd', { when: 'Mon Jul 20 · 9:00 AM', host: 'Charlie · Owner' });
    match(slot.id, /^slot_\d+$/, 'a created slot should get a slot_ id');
    neq(member.id, slot.id, 'newId() must not hand out the same suffix twice');
    notOk(DB.team.filter(t => t.id === member.id).length > 1, 'a created id must not collide with a seeded one');
  });

  test('content is keyed by the documented singleton id', async () => {
    const c = await Store.getContent();
    eq(c.id, 'singleton', 'content is a single-row table keyed "singleton" (schema.sql CHECK constraint)');
    ok(!Array.isArray(DB.content), 'DB.content should be one row object, not a collection');
  });
});

/* --- seed --- */
suite('Seed · meetings', () => {
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

  test('steps run 1..N with no gaps or repeats', async () => {
    const ms = await Store.listMeetings();
    deepEq(ms.map(m => m.step).sort((a, b) => a - b), ms.map((_, i) => i + 1),
      'meetings.step should be a dense 1..N sequence');
  });

  test('step matches sortOrder', async () => {
    for (const m of await Store.listMeetings()) {
      eq(m.sortOrder, m.step, `${m.id} displays step ${m.step} but sorts at ${m.sortOrder}`);
    }
  });

  test('roman numerals match the step number', async () => {
    for (const m of await Store.listMeetings()) {
      eq(m.roman, ROMAN[m.step], `${m.id} is step ${m.step}, so its numeral should read ${ROMAN[m.step]}`);
    }
  });

  test('listMeetings returns them in step order', async () => {
    const ms = await Store.listMeetings();
    deepEq(ms.map(m => m.step), [1, 2, 3, 4], 'Store.listMeetings should hand back rows already ordered by sort_order');
  });

  test('every meeting carries the copy the detail screen renders', async () => {
    for (const m of await Store.listMeetings()) {
      ok(m.title && m.title.trim(), `${m.id} needs a title`);
      ok(m.shortTitle && m.shortTitle.trim(), `${m.id} needs a shortTitle (used by nextStep and the rail)`);
      ok(m.purpose && m.purpose.trim(), `${m.id} needs a purpose`);
      ok(m.topicsLabel && m.topicsLabel.trim(), `${m.id} needs a topicsLabel to head its topic list`);
      ok(typeof m.durationMin === 'number' && m.durationMin > 0, `${m.id}.durationMin should be a positive number`);
    }
  });

  test('every meeting has non-empty topics and prep arrays', async () => {
    for (const m of await Store.listMeetings()) {
      ok(Array.isArray(m.topics), `${m.id}.topics should be an array`);
      gt(m.topics.length, 0, `${m.id} renders a topics list, so it must not be empty`);
      ok(m.topics.every(t => typeof t === 'string' && t.trim()), `${m.id}.topics should hold non-empty strings`);
      ok(Array.isArray(m.prep), `${m.id}.prep should be an array`);
      gt(m.prep.length, 0, `${m.id} renders a "what to bring" list, so it must not be empty`);
      ok(m.prep.every(p => typeof p === 'string' && p.trim()), `${m.id}.prep should hold non-empty strings`);
    }
  });

  test('boundary is either null or real copy', async () => {
    for (const m of await Store.listMeetings()) {
      ok(m.boundary === null || (typeof m.boundary === 'string' && m.boundary.trim()),
        `${m.id}.boundary should be null or a non-empty note, got ${JSON.stringify(m.boundary)}`);
    }
  });

  test('exactly one meeting requires acknowledgment, and it is the handbook', async () => {
    const ack = (await Store.listMeetings()).filter(m => m.requiresAck);
    len(ack, 1, `exactly one step collects an acknowledgment, got [${ack.map(m => m.id)}]`);
    eq(ack[0].id, 'mtg_handbook', 'the handbook meeting is the one that requires acknowledgment');
  });

  test('exactly one meeting is roleOnly, and it is the Assistant Stylist Program', async () => {
    const only = (await Store.listMeetings()).filter(m => m.roleOnly);
    len(only, 1, `exactly one step is role-gated, got [${only.map(m => m.id)}]`);
    eq(only[0].id, 'mtg_assistant', 'the Assistant Stylist Program is the role-gated step');
  });

  test('roleOnly and requiresAck are real booleans on every row', () => {
    for (const m of DB.meetings) {
      eq(typeof m.roleOnly, 'boolean', `${m.id}.roleOnly should be a boolean`);
      eq(typeof m.requiresAck, 'boolean', `${m.id}.requiresAck should be a boolean`);
    }
  });

  test('every defaultHost is one the admin host picker can represent', () => {
    for (const m of state.meetings) {
      const sel = q('#host_' + m.id);
      ok(sel, `the admin "Meeting times" card for ${m.id} should render a host picker`);
      const opts = Array.from(sel.options).map(o => o.textContent.trim());
      has(opts, m.defaultHost, `${m.id}.defaultHost "${m.defaultHost}" is not offered by the host picker`);
      eq(sel.value, m.defaultHost, `the host picker for ${m.id} should preselect its seeded default host`);
    }
  });
});

/* --- seed --- */
suite('Seed · checklist template', () => {
  test('group sortOrder values are unique and dense', () => {
    const orders = DB.checklistGroups.map(g => g.sortOrder);
    eq(new Set(orders).size, orders.length, `checklistGroups sortOrder must be unique, got [${orders}]`);
    deepEq(orders.slice().sort((a, b) => a - b), orders.map((_, i) => i + 1),
      'checklistGroups sortOrder should be a dense 1..N sequence');
  });

  test('every group kind is one of the two enum values', () => {
    for (const g of DB.checklistGroups) {
      has(['manual', 'auto'], g.kind, `${g.id}.kind "${g.kind}" is outside the checklist_kind enum`);
    }
  });

  test('exactly one group is kind auto', () => {
    const auto = DB.checklistGroups.filter(g => g.kind === 'auto');
    len(auto, 1, `exactly one checklist group is derived, got [${auto.map(g => g.id)}]`);
    eq(auto[0].id, 'grp_meetings', 'the derived group is "Required meetings"');
  });

  test('the auto group has no rows in checklistItems', () => {
    const auto = DB.checklistGroups.find(g => g.kind === 'auto');
    const rows = DB.checklistItems.filter(it => it.groupId === auto.id);
    len(rows, 0, `${auto.id} is a view over employee_meetings and must not have stored items, got [${rows.map(r => r.id)}]`);
  });

  test('the auto group has no rows in checklistState', () => {
    const auto = DB.checklistGroups.find(g => g.kind === 'auto');
    const itemIds = new Set(DB.checklistItems.filter(it => it.groupId === auto.id).map(it => it.id));
    const rows = DB.checklistState.filter(s => itemIds.has(s.itemId) || String(s.itemId).startsWith('meeting:'));
    len(rows, 0, 'derived meeting lines are read-only and must never be persisted in checklist_state');
  });

  test('every manual group has at least one item', () => {
    for (const g of DB.checklistGroups.filter(x => x.kind === 'manual')) {
      gt(DB.checklistItems.filter(it => it.groupId === g.id).length, 0,
        `${g.id} is a manual group and would render as an empty card with no items`);
    }
  });

  test('item sortOrder is unique and dense within each group', () => {
    for (const g of DB.checklistGroups) {
      const orders = DB.checklistItems.filter(it => it.groupId === g.id).map(it => it.sortOrder);
      if (!orders.length) continue;
      eq(new Set(orders).size, orders.length, `${g.id} has duplicate item sortOrder values [${orders}]`);
      deepEq(orders.slice().sort((a, b) => a - b), orders.map((_, i) => i + 1),
        `${g.id} item sortOrder should be a dense 1..N sequence`);
    }
  });

  test('every group and item has display copy', () => {
    for (const g of DB.checklistGroups) {
      ok(g.title && g.title.trim(), `${g.id} needs a title`);
      ok(g.subtitle && g.subtitle.trim(), `${g.id} needs a subtitle`);
    }
    for (const it of DB.checklistItems) {
      ok(it.label && it.label.trim(), `${it.id} needs a label`);
    }
  });

  test('getChecklist surfaces every seeded manual item exactly once', async () => {
    const groups = await Store.getChecklist(CURRENT_USER);
    const rendered = groups.filter(g => g.kind === 'manual').flatMap(g => g.items.map(i => i.id));
    deepEq(rendered.slice().sort(), DB.checklistItems.map(it => it.id).sort(),
      'the manual groups should expose exactly the seeded checklist_items rows');
  });

  test('the auto group is derived from the employee applicable meetings', async () => {
    const groups = await Store.getChecklist(CURRENT_USER);
    const auto = groups.find(g => g.kind === 'auto');
    const me = DB.employees.find(e => e.id === CURRENT_USER);
    deepEq(auto.items.map(i => i.id), _applicableMeetings(me).map(m => 'meeting:' + m.id),
      'the auto group should mirror the applicable meetings, in step order');
    ok(auto.items.every(i => i.locked), 'derived meeting lines are read-only');
  });

  test('seeded checklistState covers only the current user', () => {
    for (const s of DB.checklistState) {
      eq(s.employeeId, CURRENT_USER,
        `the seed documents state for the signed-in employee only; found a row for ${s.employeeId}`);
    }
  });

  test('seeded checklistState done flags are booleans and reach the read model', async () => {
    for (const s of DB.checklistState) eq(typeof s.done, 'boolean', `checklistState.${s.itemId}.done should be a boolean`);
    const groups = await Store.getChecklist(CURRENT_USER);
    const byId = new Map(groups.flatMap(g => g.items).map(i => [i.id, i]));
    for (const s of DB.checklistState) {
      eq(byId.get(s.itemId).done, s.done, `checklist read should reflect seeded state for ${s.itemId}`);
    }
  });
});

/* --- seed --- */
suite('Seed · employees', () => {
  test('exactly one employee is flagged isCurrentUser', () => {
    const flagged = DB.employees.filter(e => e.isCurrentUser);
    len(flagged, 1, `exactly one seeded employee is the signed-in user, got [${flagged.map(e => e.id)}]`);
  });

  test('the flagged employee is CURRENT_USER', async () => {
    const flagged = DB.employees.filter(e => e.isCurrentUser)[0];
    eq(flagged.id, CURRENT_USER, 'isCurrentUser must agree with the CURRENT_USER the app resolves against');
    const me = await Store.getEmployee(CURRENT_USER);
    ok(me, 'CURRENT_USER should resolve to a seeded employee row');
    ok(me.isCurrentUser, 'the employee behind CURRENT_USER should carry the flag');
  });

  test('every employee progress is a whole number between 0 and 100', async () => {
    for (const e of await Store.listEmployees()) {
      eq(typeof e.progress, 'number', `${e.id}.progress should be a number`);
      eq(e.progress, Math.round(e.progress), `${e.id}.progress should be a whole percentage, got ${e.progress}`);
      gte(e.progress, 0, `${e.id}.progress should not be negative`);
      lte(e.progress, 100, `${e.id}.progress should not exceed 100`);
    }
  });

  test('no seeded progress sits below the value the app derives', () => {
    /* progress is documented as derived (API.md, schema.sql); _bumpProgress only
       ever raises it, so a seed row below the derived floor is unreachable state. */
    for (const e of DB.employees) {
      const appl = _applicableMeetings(e);
      const done = _instances(e.id).filter(i => i.status === 'complete').length;
      const floor = Math.round(20 + (appl.length ? done / appl.length : 0) * 80);
      gte(e.progress, floor, `${e.id} has ${done}/${appl.length} meetings complete, so progress should be at least ${floor}`);
    }
  });

  test('progress of 100 means every applicable meeting is complete', () => {
    for (const e of DB.employees.filter(x => x.progress === 100)) {
      const pending = _applicableMeetings(e).filter(m => {
        const inst = _instances(e.id).find(i => i.meetingId === m.id);
        return !inst || inst.status !== 'complete';
      });
      len(pending, 0, `${e.id} shows 100% but still owes [${pending.map(m => m.id)}]`);
    }
  });

  test('employee initials match initialsOf(name)', () => {
    for (const e of DB.employees) {
      eq(e.initials, initialsOf(e.name), `${e.id}.initials is cached from the name and should be ${initialsOf(e.name)}`);
    }
  });

  test('every employee carries the fields the roster renders', () => {
    for (const e of DB.employees) {
      ok(e.name && e.name.trim(), `${e.id} needs a name`);
      ok(e.role && e.role.trim(), `${e.id} needs a role`);
      match(e.dayLabel, /^Day \d+$/, `${e.id}.dayLabel should read like "Day 4", got ${JSON.stringify(e.dayLabel)}`);
      eq(typeof e.eligibleForAsp, 'boolean', `${e.id}.eligibleForAsp should be a boolean`);
      eq(typeof e.trainingAccess, 'boolean', `${e.id}.trainingAccess should be a boolean`);
      eq(typeof e.adminNotes, 'string', `${e.id}.adminNotes should default to a string, never null`);
    }
  });

  test('ASP eligibility is seeded on more than one employee, and not on all', () => {
    const eligible = DB.employees.filter(e => e.eligibleForAsp);
    gt(eligible.length, 0, 'the role-gated step needs at least one eligible employee to be exercised');
    lt(eligible.length, DB.employees.length, 'at least one employee must be ineligible so the "na" path is exercised');
  });

  test('nextStep derives from the seed for every employee', async () => {
    for (const e of await Store.listEmployees()) {
      ok(e.nextStep && e.nextStep.trim(), `${e.id}.nextStep should be derived, not blank`);
      ok(e.nextStep === 'Complete' || /^Step (I|II|III|IV|V)+ · /.test(e.nextStep),
        `${e.id}.nextStep should read "Step <numeral> · <title>" or "Complete", got ${JSON.stringify(e.nextStep)}`);
    }
  });
});

/* --- seed --- */
suite('Seed · team', () => {
  test('team member initials match initialsOf(name)', () => {
    for (const t of DB.team) {
      eq(t.initials, initialsOf(t.name),
        `${t.id}.initials is a cached derivation of the name; initialsOf("${t.name}") is ${initialsOf(t.name)}`);
    }
  });

  test('sortOrder is unique and dense', () => {
    const orders = DB.team.map(t => t.sortOrder);
    eq(new Set(orders).size, orders.length, `team sortOrder must be unique, got [${orders}]`);
    deepEq(orders.slice().sort((a, b) => a - b), orders.map((_, i) => i + 1),
      'team sortOrder should be a dense 1..N sequence');
  });

  test('listTeam hands back members in sortOrder', async () => {
    const team = await Store.listTeam();
    deepEq(team.map(t => t.sortOrder), team.map((_, i) => i + 1),
      'Store.listTeam should return rows already ordered by sort_order');
  });

  test('every member carries the fields the roster card renders', () => {
    for (const t of DB.team) {
      ok(t.name && t.name.trim(), `${t.id} needs a name`);
      ok(t.role && t.role.trim(), `${t.id} needs a role`);
      ok(t.bio && t.bio.trim(), `${t.id} needs a bio`);
      eq(typeof t.experience, 'string', `${t.id}.experience should be a string (empty when unknown), never null`);
      ok(Array.isArray(t.specialties), `${t.id}.specialties should be an array`);
      ok(t.specialties.every(s => typeof s === 'string' && s.trim()), `${t.id}.specialties should hold non-empty strings`);
      ok(Array.isArray(t.hostsMeetingIds), `${t.id}.hostsMeetingIds should be an array`);
    }
  });

  test('no member ships with a baked-in photo', () => {
    for (const t of DB.team) {
      eq(t.photoUrl, null, `${t.id}.photoUrl should start null — headshots are uploaded, not seeded`);
    }
  });

  test('every seeded host is also a shop artisan the employee can look up', async () => {
    const team = await Store.listTeam();
    const hosts = new Set(DB.meetings.map(m => String(m.defaultHost || '').split('·')[0].trim()));
    for (const h of hosts) {
      ok(team.some(t => t.name.split(/\s+/)[0] === h), `meeting host "${h}" should appear on "Meet the shop"`);
    }
  });
});

/* --- seed --- */
suite('Seed · schedule labels', () => {
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const labels = () => [
    ...DB.slots.map(s => ({ id: s.id, when: s.when })),
    ...DB.employeeMeetings.filter(x => x.when).map(x => ({ id: x.id, when: x.when }))
  ];

  test('every when label has the documented "Ddd Mon D · h:mm AM" shape', () => {
    for (const { id, when } of labels()) {
      match(when, /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} · \d{1,2}:\d{2} (AM|PM)$/,
        `${id}.when "${when}" does not match the seed label format`);
    }
  });

  test('every when label parses to a real date', () => {
    for (const { id, when } of labels()) {
      const d = parseWhen(when);
      ok(d instanceof Date && !isNaN(d.getTime()), `parseWhen could not read ${id}.when "${when}"`);
      const [, mon, day] = when.split('·')[0].trim().split(/\s+/);
      eq(d.getMonth(), MON.indexOf(mon), `${id}.when "${when}" should parse into ${mon}`);
      eq(d.getDate(), Number(day), `${id}.when "${when}" should parse to day ${day}`);
    }
  });

  test('every when label names the right weekday for its date', () => {
    /* parseWhen hardcodes 2026, so a label saying "Mon" must be a Monday in 2026. */
    for (const { id, when } of labels()) {
      const stated = when.trim().split(/\s+/)[0];
      const actual = DOW[parseWhen(when).getDay()];
      eq(stated, actual, `${id}.when "${when}" falls on a ${actual} in 2026, not a ${stated}`);
    }
  });

  test('every status is inside the meeting_status enum', () => {
    for (const em of DB.employeeMeetings) {
      has(['pending', 'scheduled', 'complete'], em.status, `${em.id}.status "${em.status}" is outside the enum`);
    }
  });

  test('pending instances have no time and booked ones do', () => {
    for (const em of DB.employeeMeetings) {
      if (em.status === 'pending') eq(em.when, null, `${em.id} is pending, so it must not carry a time`);
      else ok(em.when && em.when.trim(), `${em.id} is ${em.status}, so it must carry the time it was booked for`);
    }
  });

  test('scheduled instances point at a slot that still exists', async () => {
    for (const em of DB.employeeMeetings.filter(x => x.status === 'scheduled')) {
      const slots = await Store.listSlots(em.meetingId);
      ok(slots.some(s => s.when === em.when),
        `${em.id} is booked for "${em.when}", which is not an offered slot for ${em.meetingId}`);
    }
  });

  test('every instance host matches the meeting default host', () => {
    for (const em of DB.employeeMeetings) {
      const m = DB.meetings.find(x => x.id === em.meetingId);
      eq(em.host, m.defaultHost, `${em.id}.host should be the host of ${em.meetingId}`);
    }
  });

  test('every slot host matches the meeting default host', () => {
    for (const s of DB.slots) {
      const m = DB.meetings.find(x => x.id === s.meetingId);
      eq(s.host, m.defaultHost, `${s.id}.host should be the host of ${s.meetingId}`);
    }
  });

  test('a meeting never offers the same time twice', () => {
    for (const m of DB.meetings) {
      const whens = DB.slots.filter(s => s.meetingId === m.id).map(s => s.when);
      eq(new Set(whens).size, whens.length, `${m.id} offers a duplicated slot time: [${whens}]`);
    }
  });

  test('acknowledgedAt is set only on meetings that require acknowledgment', () => {
    for (const em of DB.employeeMeetings.filter(x => x.acknowledgedAt)) {
      const m = DB.meetings.find(x => x.id === em.meetingId);
      ok(m.requiresAck, `${em.id} records an acknowledgment for ${em.meetingId}, which does not require one`);
      eq(em.status, 'complete', `${em.id} is acknowledged, so the meeting should be complete`);
    }
  });

  test('acknowledgedAt is an ISO timestamp on the day of the meeting', () => {
    for (const em of DB.employeeMeetings.filter(x => x.acknowledgedAt)) {
      match(em.acknowledgedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, `${em.id}.acknowledgedAt should be an ISO-8601 UTC timestamp`);
      const met = parseWhen(em.when);
      const ackDay = em.acknowledgedAt.slice(0, 10);
      const expected = met.getFullYear() + '-' + pad2(met.getMonth() + 1) + '-' + pad2(met.getDate());
      eq(ackDay, expected, `${em.id} was acknowledged on ${ackDay} but met on ${expected}`);
    }
  });

  test('unacknowledged instances say so with null, not undefined', () => {
    for (const em of DB.employeeMeetings) {
      ok(em.acknowledgedAt === null || typeof em.acknowledgedAt === 'string',
        `${em.id}.acknowledgedAt should be null or a timestamp, got ${JSON.stringify(em.acknowledgedAt)}`);
    }
  });
});

/* --- seed --- */
suite('Seed · content', () => {
  test('content is a singleton row with both fields', async () => {
    const c = await Store.getContent();
    deepEq(Object.keys(c).sort(), ['id', 'trainingUrl', 'welcomeMessage'],
      'the content row holds exactly the fields API.md documents');
  });

  test('welcomeMessage is real copy', async () => {
    const c = await Store.getContent();
    eq(typeof c.welcomeMessage, 'string', 'welcomeMessage should be a string');
    gt(c.welcomeMessage.trim().length, 20, 'welcomeMessage is the first thing a new hire reads; it should not be a stub');
  });

  test('trainingUrl is a well-formed https URL', async () => {
    const c = await Store.getContent();
    match(c.trainingUrl, /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i,
      `trainingUrl should be an absolute https URL, got ${JSON.stringify(c.trainingUrl)}`);
    const u = new URL(c.trainingUrl);
    eq(u.protocol, 'https:', 'the training platform link must not be plain http');
    ok(u.hostname.includes('.'), 'trainingUrl should point at a real host');
  });

  test('the admin content form is seeded from the content row', async () => {
    const c = await Store.getContent();
    eq(q('#welcomeTxt').value, c.welcomeMessage, 'the Content screen should load the seeded welcome message');
    eq(q('#trainUrl').value, c.trainingUrl, 'the Content screen should load the seeded training link');
  });
});

/* --- reads --- */
suite('Store reads · content', () => {
  test('getContent returns the singleton settings row', async () => {
    const c = await Store.getContent();
    eq(c.id, 'singleton', 'content is a single-row table keyed "singleton"');
    eq(c.trainingUrl, 'https://training.artisanbarber.com', 'trainingUrl should come straight from the row');
    match(c.welcomeMessage, /^Welcome to Artisan\./, 'welcomeMessage should be the seeded copy');
  });

  test('getContent hands back a detached copy, not the live row', async () => {
    const first = await Store.getContent();
    first.welcomeMessage = 'mutated by the caller';
    first.trainingUrl = 'https://evil.example';
    const second = await Store.getContent();
    neq(second.welcomeMessage, 'mutated by the caller', 'mutating a read result must not reach the store');
    eq(second.trainingUrl, 'https://training.artisanbarber.com', 'trainingUrl should be untouched by caller mutation');
    eq(DB.content.welcomeMessage, second.welcomeMessage, 'DB row should still match what the read returns');
  });

  test('getContent reflects a write through updateContent', async () => {
    await Store.updateContent({ trainingUrl: 'https://lms.artisanbarber.com' });
    const c = await Store.getContent();
    eq(c.trainingUrl, 'https://lms.artisanbarber.com', 'the read must see the patched value');
    match(c.welcomeMessage, /^Welcome to Artisan\./, 'an unpatched field must be left alone');
  });
});

/* --- reads --- */
suite('Store reads · listTeam', () => {
  const ids = rows => rows.map(r => r.id);

  test('returns every seeded artisan', async () => {
    const team = await Store.listTeam();
    len(team, 5, 'the seed has five team members');
    deepEq(ids(team), ['tm_charlie', 'tm_bobby', 'tm_juan', 'tm_kris', 'tm_cathy'],
      'team should come back in sortOrder 1..5');
  });

  test('orders by sortOrder rather than by position in the table', async () => {
    DB.team.reverse();                       // table order now disagrees with sortOrder
    const team = await Store.listTeam();
    deepEq(ids(team), ['tm_charlie', 'tm_bobby', 'tm_juan', 'tm_kris', 'tm_cathy'],
      'sortOrder must win over the physical row order');
    eq(DB.team[0].id, 'tm_cathy', 'the read must not re-sort the underlying table in place');
  });

  test('reordering sortOrder reorders the result', async () => {
    DB.team.find(t => t.id === 'tm_cathy').sortOrder = 0;
    DB.team.find(t => t.id === 'tm_charlie').sortOrder = 9;
    const team = await Store.listTeam();
    deepEq(ids(team), ['tm_cathy', 'tm_bobby', 'tm_juan', 'tm_kris', 'tm_charlie'],
      'changing sortOrder must change the order the read returns');
  });

  test('carries the display fields the team screen needs', async () => {
    const charlie = (await Store.listTeam()).find(t => t.id === 'tm_charlie');
    eq(charlie.name, 'Charlie', 'name should round-trip');
    eq(charlie.initials, 'CH', 'initials are cached on the row and agree with initialsOf()');
    eq(charlie.role, 'Founder & Owner', 'role should round-trip');
    eq(charlie.photoUrl, null, 'seeded members have no headshot yet');
    deepEq(charlie.hostsMeetingIds, ['mtg_handbook', 'mtg_acd'], 'host links should round-trip');
    deepEq(charlie.specialties, ['Shop culture', 'Training support'], 'specialties should round-trip');
  });

  test('returns a deep copy — nested arrays are not shared with the store', async () => {
    const team = await Store.listTeam();
    team[0].specialties.push('Sabotage');
    team[0].name = 'Not Charlie';
    const again = await Store.listTeam();
    len(again[0].specialties, 2, 'pushing into a returned array must not reach DB.team');
    eq(again[0].name, 'Charlie', 'renaming a returned row must not reach DB.team');
  });
});

/* --- reads --- */
suite('Store reads · listMeetings', () => {
  const ids = rows => rows.map(r => r.id);

  test('returns the four step templates in step order', async () => {
    const meetings = await Store.listMeetings();
    len(meetings, 4, 'the seed has four onboarding steps');
    deepEq(ids(meetings), ['mtg_handbook', 'mtg_frontdesk', 'mtg_assistant', 'mtg_acd'],
      'meetings should come back in sortOrder 1..4');
    deepEq(meetings.map(m => m.roman), ['I', 'II', 'III', 'IV'], 'roman numerals should follow the same order');
  });

  test('orders by sortOrder rather than by position in the table', async () => {
    DB.meetings.reverse();
    const meetings = await Store.listMeetings();
    deepEq(ids(meetings), ['mtg_handbook', 'mtg_frontdesk', 'mtg_assistant', 'mtg_acd'],
      'sortOrder must win over the physical row order');
    eq(DB.meetings[0].id, 'mtg_acd', 'the read must not re-sort the underlying table in place');
  });

  test('reordering sortOrder reorders the result', async () => {
    DB.meetings.find(m => m.id === 'mtg_acd').sortOrder = 0;
    const meetings = await Store.listMeetings();
    deepEq(ids(meetings), ['mtg_acd', 'mtg_handbook', 'mtg_frontdesk', 'mtg_assistant'],
      'changing sortOrder must change the order the read returns');
  });

  test('carries the full template payload for one step', async () => {
    const handbook = (await Store.listMeetings()).find(m => m.id === 'mtg_handbook');
    eq(handbook.step, 1, 'step should round-trip');
    eq(handbook.durationMin, 45, 'durationMin should round-trip');
    eq(handbook.roleOnly, false, 'the handbook meeting applies to everyone');
    eq(handbook.requiresAck, true, 'the handbook meeting needs an acknowledgment');
    eq(handbook.defaultHost, 'Charlie · Owner', 'defaultHost should round-trip');
    eq(handbook.topicsLabel, 'This platform provides', 'topicsLabel should round-trip');
    eq(handbook.boundary, null, 'the handbook meeting has no scope note');
    len(handbook.topics, 6, 'the handbook meeting lists six topics');
    len(handbook.prep, 3, 'the handbook meeting lists three prep items');
  });

  test('marks exactly one step as role-only', async () => {
    const roleOnly = (await Store.listMeetings()).filter(m => m.roleOnly);
    len(roleOnly, 1, 'only the Assistant Stylist Program is role-gated');
    eq(roleOnly[0].id, 'mtg_assistant', 'the role-gated step is mtg_assistant');
  });
});

/* --- reads --- */
suite('Store reads · listSlots', () => {
  const ids = rows => rows.map(r => r.id);

  test('filters to the requested meeting only', async () => {
    const slots = await Store.listSlots('mtg_frontdesk');
    len(slots, 3, 'the front desk meeting has three seeded times');
    deepEq(ids(slots), ['slot_3', 'slot_4', 'slot_5'], 'only the front desk slots should come back');
    ok(slots.every(s => s.meetingId === 'mtg_frontdesk'), 'every returned slot must belong to the requested meeting');
  });

  test('every seeded slot is reachable through exactly one meeting', async () => {
    const meetings = await Store.listMeetings();
    let total = 0;
    for (const m of meetings) total += (await Store.listSlots(m.id)).length;
    eq(total, DB.slots.length, 'the per-meeting reads should partition all 11 slots');
    eq(total, 11, 'the seed has eleven slots');
  });

  test('returns an empty list for an unknown meeting id', async () => {
    deepEq(await Store.listSlots('mtg_nope'), [], 'an unknown meeting id must yield no slots, not an error');
  });

  test('returns an empty list when no meeting id is given', async () => {
    deepEq(await Store.listSlots(), [], 'a missing meeting id must not leak every slot in the table');
    deepEq(await Store.listSlots(null), [], 'a null meeting id must not leak every slot in the table');
  });

  test('carries when and host on each slot', async () => {
    const slots = await Store.listSlots('mtg_handbook');
    len(slots, 2, 'the handbook meeting has two seeded times');
    eq(slots[0].when, 'Thu Jul 16 · 10:00 AM', 'the slot label should round-trip verbatim');
    eq(slots[0].host, 'Charlie · Owner', 'the slot host should round-trip');
  });

  test('picks up a slot added through the store', async () => {
    const created = await Store.addSlot('mtg_handbook', { when: 'Sat Jul 18 · 8:00 AM', host: 'Kris · Barber' });
    const slots = await Store.listSlots('mtg_handbook');
    len(slots, 3, 'the new slot should be visible to the next read');
    ok(slots.some(s => s.id === created.id), 'the created slot id should appear in the meeting listing');
    lacks((await Store.listSlots('mtg_acd')).map(s => s.id), created.id, 'the new slot must not leak into another meeting');
  });

  test('returns copies — mutating a slot does not reach the store', async () => {
    const slots = await Store.listSlots('mtg_handbook');
    slots[0].when = 'Never';
    eq((await Store.listSlots('mtg_handbook'))[0].when, 'Thu Jul 16 · 10:00 AM',
      'mutating a returned slot must not reach DB.slots');
  });
});

/* --- reads --- */
suite('Store reads · listEmployees & getEmployee', () => {
  test('returns the whole roster', async () => {
    const roster = await Store.listEmployees();
    len(roster, 4, 'the seed has four onboarding employees');
    deepEq(roster.map(e => e.id).sort(), ['emp_jordan', 'emp_leo', 'emp_maya', 'emp_sam'],
      'every seeded employee should be listed');
  });

  test('attaches a derived nextStep to every row', async () => {
    const roster = await Store.listEmployees();
    ok(roster.every(e => typeof e.nextStep === 'string' && e.nextStep.length > 0),
      'nextStep is derived server-side and must be present on every roster row');
  });

  test('nextStep names the first incomplete step', async () => {
    const by = Object.fromEntries((await Store.listEmployees()).map(e => [e.id, e]));
    eq(by.emp_jordan.nextStep, 'Step II · Front Desk & Concierge',
      'Jordan finished the handbook, so step II is next');
    eq(by.emp_sam.nextStep, 'Step I · Handbook Meeting',
      'Sam has nothing complete yet, so step I is next');
  });

  test('nextStep skips role-only steps the employee is not eligible for', async () => {
    const maya = await Store.getEmployee('emp_maya');
    eq(maya.eligibleForAsp, false, 'Maya is not in the Assistant Stylist Program');
    eq(maya.nextStep, 'Step IV · Continued Development intro',
      'step III is role-only, so a non-eligible employee should skip straight to IV');
  });

  test('nextStep reads "Complete" once every applicable step is done', async () => {
    const leo = await Store.getEmployee('emp_leo');
    eq(leo.nextStep, 'Complete', 'Leo has completed all three of his applicable meetings');
  });

  test('nextStep advances after a meeting is completed', async () => {
    await Store.completeEmployeeMeeting('emp_jordan', 'mtg_frontdesk');
    const jordan = await Store.getEmployee('emp_jordan');
    eq(jordan.nextStep, 'Step III · Assistant Stylist Program',
      'with steps I and II done, an ASP-eligible employee moves to step III');
  });

  test('nextStep picks up a newly assigned role-only step', async () => {
    const before = await Store.getEmployee('emp_maya');
    eq(before.nextStep, 'Step IV · Continued Development intro', 'baseline: Maya skips step III');
    await Store.assignProgram('emp_maya');
    const after = await Store.getEmployee('emp_maya');
    eq(after.nextStep, 'Step III · Assistant Stylist Program',
      'once assigned to the program, step III becomes her next step');
  });

  test('getEmployee returns the same shape as the roster row', async () => {
    const fromList = (await Store.listEmployees()).find(e => e.id === 'emp_jordan');
    const direct = await Store.getEmployee('emp_jordan');
    deepEq(direct, fromList, 'GET /employees/:id must match the row from GET /employees');
  });

  test('getEmployee carries the stored employee fields', async () => {
    const e = await Store.getEmployee('emp_jordan');
    eq(e.name, 'Jordan Rivera', 'name should round-trip');
    eq(e.initials, 'JR', 'initials should round-trip');
    eq(e.role, 'Assistant Stylist', 'role should round-trip');
    eq(e.dayLabel, 'Day 4', 'dayLabel should round-trip');
    eq(e.eligibleForAsp, true, 'Jordan is ASP-eligible in the seed');
    eq(e.trainingAccess, false, 'Jordan has no training access yet');
    eq(e.progress, 45, 'progress should round-trip from the row');
    match(e.adminNotes, /Handbook acknowledged/, 'adminNotes should round-trip');
  });

  test('getEmployee returns null for an unknown id', async () => {
    eq(await Store.getEmployee('emp_nobody'), null, 'an unknown employee id must resolve to null');
    eq(await Store.getEmployee(''), null, 'an empty id must resolve to null');
    eq(await Store.getEmployee(undefined), null, 'a missing id must resolve to null');
  });

  test('getEmployee returns a detached copy', async () => {
    const e = await Store.getEmployee('emp_jordan');
    e.name = 'Somebody Else';
    e.progress = 999;
    const again = await Store.getEmployee('emp_jordan');
    eq(again.name, 'Jordan Rivera', 'mutating a read result must not reach DB.employees');
    eq(again.progress, 45, 'mutating a read result must not reach DB.employees');
  });

  test('the roster read sees writes made through the store', async () => {
    await Store.setTrainingAccess('emp_jordan', true);
    await Store.setEmployeeNotes('emp_jordan', 'Cleared for the floor.');
    const e = (await Store.listEmployees()).find(x => x.id === 'emp_jordan');
    eq(e.trainingAccess, true, 'the roster read must reflect the access flip');
    eq(e.adminNotes, 'Cleared for the floor.', 'the roster read must reflect the saved note');
  });
});

/* --- reads --- */
suite('Store reads · listEmployeeMeetings', () => {
  const mids = rows => rows.map(r => r.meetingId);

  test('returns every applicable step for an eligible employee', async () => {
    const rows = await Store.listEmployeeMeetings('emp_jordan');
    len(rows, 4, 'Jordan is ASP-eligible, so all four steps apply');
    deepEq(mids(rows), ['mtg_handbook', 'mtg_frontdesk', 'mtg_assistant', 'mtg_acd'],
      'applicable meetings come back in sortOrder');
    ok(rows.every(r => r.applicable === true), 'every row returned by default is applicable');
  });

  test('omits role-only steps for an employee who is not eligible', async () => {
    const rows = await Store.listEmployeeMeetings('emp_maya');
    len(rows, 3, 'Maya is not ASP-eligible, so only three of the four steps apply');
    lacks(mids(rows), 'mtg_assistant', 'the role-only step must not appear by default');
    deepEq(mids(rows), ['mtg_handbook', 'mtg_frontdesk', 'mtg_acd'], 'remaining steps keep their order');
  });

  test('includeAll surfaces the role-only step as not-required', async () => {
    const rows = await Store.listEmployeeMeetings('emp_maya', true);
    len(rows, 4, 'include=all returns every template so an admin can assign it');
    deepEq(mids(rows), ['mtg_handbook', 'mtg_frontdesk', 'mtg_assistant', 'mtg_acd'],
      'include=all keeps the templates in sortOrder');
    const asp = rows.find(r => r.meetingId === 'mtg_assistant');
    eq(asp.status, 'na', 'a role-only step the employee is not eligible for reports status "na"');
    eq(asp.applicable, false, 'the ineligible step is flagged not applicable');
    eq(asp.hasInstance, false, 'no employee_meetings row exists for an unassigned role-only step');
    eq(asp.when, null, 'an unassigned step has no time');
    eq(asp.acknowledgedAt, null, 'an unassigned step has no acknowledgment');
    eq(asp.roleOnly, true, 'the template flag still comes through');
  });

  test('includeAll changes nothing for an employee who is already eligible', async () => {
    const plain = await Store.listEmployeeMeetings('emp_jordan');
    const all = await Store.listEmployeeMeetings('emp_jordan', true);
    deepEq(all, plain, 'when every template applies, include=all must return the identical payload');
  });

  test('assigning the program flips the role-only step from na to pending', async () => {
    const before = (await Store.listEmployeeMeetings('emp_maya', true)).find(r => r.meetingId === 'mtg_assistant');
    eq(before.status, 'na', 'baseline: not required');
    await Store.assignProgram('emp_maya');
    const after = (await Store.listEmployeeMeetings('emp_maya')).find(r => r.meetingId === 'mtg_assistant');
    ok(after, 'after assignment the step must appear in the default listing');
    eq(after.status, 'pending', 'a freshly assigned step is pending, not na');
    eq(after.applicable, true, 'the assigned step is now applicable');
    eq(after.hasInstance, true, 'assignment creates the employee_meetings row');
  });

  test('merges the template fields onto every row', async () => {
    const handbook = (await Store.listEmployeeMeetings('emp_jordan')).find(r => r.meetingId === 'mtg_handbook');
    eq(handbook.step, 1, 'step comes from the template');
    eq(handbook.roman, 'I', 'roman comes from the template');
    eq(handbook.title, 'Handbook Meeting', 'title comes from the template');
    eq(handbook.shortTitle, 'Handbook Meeting', 'shortTitle comes from the template');
    eq(handbook.durationMin, 45, 'durationMin comes from the template');
    eq(handbook.requiresAck, true, 'requiresAck comes from the template');
    eq(handbook.roleOnly, false, 'roleOnly comes from the template');
    eq(handbook.topicsLabel, 'This platform provides', 'topicsLabel comes from the template');
    eq(handbook.boundary, null, 'boundary comes from the template');
    match(handbook.purpose, /employee handbook/, 'purpose comes from the template');
    len(handbook.topics, 6, 'topics comes from the template');
    len(handbook.prep, 3, 'prep comes from the template');
  });

  test('merges the instance fields onto every row', async () => {
    const handbook = (await Store.listEmployeeMeetings('emp_jordan')).find(r => r.meetingId === 'mtg_handbook');
    eq(handbook.status, 'complete', 'status comes from the employee_meetings row');
    eq(handbook.when, 'Mon Jul 6 · 10:00 AM', 'when comes from the employee_meetings row');
    eq(handbook.host, 'Charlie · Owner', 'host comes from the employee_meetings row');
    eq(handbook.acknowledgedAt, '2026-07-06T10:45:00Z', 'acknowledgedAt comes from the employee_meetings row');
    eq(handbook.hasInstance, true, 'a seeded instance means hasInstance is true');
  });

  test('an applicable step with no instance reports pending, not na', async () => {
    const i = DB.employeeMeetings.findIndex(x => x.id === 'em_7');   // Maya × ACD
    DB.employeeMeetings.splice(i, 1);
    const acd = (await Store.listEmployeeMeetings('emp_maya')).find(r => r.meetingId === 'mtg_acd');
    eq(acd.applicable, true, 'the ACD step applies to everyone');
    eq(acd.status, 'pending', 'an applicable step with no row yet is pending');
    eq(acd.hasInstance, false, 'there is no employee_meetings row to merge');
    eq(acd.when, null, 'no row means no time');
    eq(acd.acknowledgedAt, null, 'no row means no acknowledgment');
  });

  test('host falls back to the template defaultHost when the instance has none', async () => {
    DB.employeeMeetings.find(x => x.id === 'em_2').host = null;      // Jordan × front desk
    const row = (await Store.listEmployeeMeetings('emp_jordan')).find(r => r.meetingId === 'mtg_frontdesk');
    eq(row.host, 'Bobby · Manager', 'a hostless instance should fall back to the meeting defaultHost');
  });

  test('host falls back to defaultHost when there is no instance at all', async () => {
    const asp = (await Store.listEmployeeMeetings('emp_leo', true)).find(r => r.meetingId === 'mtg_assistant');
    eq(asp.hasInstance, false, 'Leo has no Assistant Stylist row');
    eq(asp.host, 'Juan · Senior Stylist', 'with no instance the host must be the template defaultHost');
    await Store.updateMeeting('mtg_assistant', { defaultHost: 'Kris · Barber' });
    const after = (await Store.listEmployeeMeetings('emp_leo', true)).find(r => r.meetingId === 'mtg_assistant');
    eq(after.host, 'Kris · Barber', 'changing the template defaultHost must change the fallback');
  });

  test('the instance host wins over the template defaultHost', async () => {
    await Store.updateMeeting('mtg_handbook', { defaultHost: 'Kris · Barber' });
    const row = (await Store.listEmployeeMeetings('emp_jordan')).find(r => r.meetingId === 'mtg_handbook');
    eq(row.host, 'Charlie · Owner', 'a booked instance keeps the host it was booked with');
  });

  test('orders by the template sortOrder, not by the employee_meetings row order', async () => {
    DB.meetings.find(m => m.id === 'mtg_acd').sortOrder = 0;
    const rows = await Store.listEmployeeMeetings('emp_jordan');
    deepEq(mids(rows), ['mtg_acd', 'mtg_handbook', 'mtg_frontdesk', 'mtg_assistant'],
      'reordering the templates must reorder an employee journey');
  });

  test('reflects scheduling and completion writes', async () => {
    await Store.scheduleEmployeeMeeting('emp_jordan', 'mtg_acd', 'Mon Jul 20 · 9:00 AM');
    let acd = (await Store.listEmployeeMeetings('emp_jordan')).find(r => r.meetingId === 'mtg_acd');
    eq(acd.status, 'scheduled', 'the read must show the booking');
    eq(acd.when, 'Mon Jul 20 · 9:00 AM', 'the read must show the chosen time');
    eq(acd.host, 'Charlie · Owner', 'the host is resolved from the chosen slot');
    await Store.completeEmployeeMeeting('emp_jordan', 'mtg_acd');
    acd = (await Store.listEmployeeMeetings('emp_jordan')).find(r => r.meetingId === 'mtg_acd');
    eq(acd.status, 'complete', 'the read must show the completion');
  });

  test('returns an empty list for an unknown employee', async () => {
    deepEq(await Store.listEmployeeMeetings('emp_nobody'), [], 'an unknown employee has no meeting journey');
    deepEq(await Store.listEmployeeMeetings('emp_nobody', true), [],
      'include=all must not invent a journey for an unknown employee');
  });

  /* The schedule endpoint accepts a role-only meeting for an ineligible employee and
     creates the row; the default journey read then filters it straight back out. Either
     end may own the fix, so this asserts only that the booking cannot silently vanish. */
  test('a booking the store accepted must not vanish from the journey', async () => {
    let rejected = false;
    try { await Store.scheduleEmployeeMeeting('emp_maya', 'mtg_assistant', 'Thu Jul 16 · 3:30 PM'); }
    catch (_) { rejected = true; }
    const asp = (await Store.listEmployeeMeetings('emp_maya')).find(r => r.meetingId === 'mtg_assistant');
    ok(rejected || asp,
      'a booking must either be refused up front or appear in the employee journey — it must not be stored and then hidden');
    if (asp) eq(asp.status, 'scheduled', 'a booking that is shown must carry the status it was stored with');
  });

  test('returns detached copies of the merged rows', async () => {
    const rows = await Store.listEmployeeMeetings('emp_jordan');
    rows[0].status = 'cancelled';
    rows[0].topics.push('Sabotage');
    const again = await Store.listEmployeeMeetings('emp_jordan');
    eq(again[0].status, 'complete', 'mutating a merged row must not reach the store');
    len(again[0].topics, 6, 'mutating a nested array must not reach the meeting template');
  });
});

/* --- reads --- */
suite('Store reads · getChecklist', () => {
  const gids = groups => groups.map(g => g.id);
  const iids = group => group.items.map(i => i.id);
  const groupOf = (groups, id) => groups.find(g => g.id === id);

  test('returns the four groups in sortOrder', async () => {
    const groups = await Store.getChecklist('emp_jordan');
    len(groups, 4, 'the template has four checklist groups');
    deepEq(gids(groups), ['grp_employment', 'grp_setup', 'grp_meetings', 'grp_training'],
      'groups come back in sortOrder 1..4');
    deepEq(groups.map(g => g.kind), ['manual', 'manual', 'auto', 'manual'],
      'only the meetings group is derived');
  });

  test('reordering group sortOrder reorders the result', async () => {
    DB.checklistGroups.find(g => g.id === 'grp_meetings').sortOrder = 0;
    const groups = await Store.getChecklist('emp_jordan');
    deepEq(gids(groups), ['grp_meetings', 'grp_employment', 'grp_setup', 'grp_training'],
      'the auto group should lead once its sortOrder is lowest');
    eq(groups[0].kind, 'auto', 'the group that moved is still the derived one');
  });

  test('groups carry their title and subtitle', async () => {
    const employment = groupOf(await Store.getChecklist('emp_jordan'), 'grp_employment');
    eq(employment.title, 'Employment requirements', 'title should round-trip');
    match(employment.subtitle, /Paperwork first/, 'subtitle should round-trip');
  });

  test('manual items come back in sortOrder within their group', async () => {
    const setup = groupOf(await Store.getChecklist('emp_jordan'), 'grp_setup');
    len(setup.items, 8, 'shop setup has eight manual items');
    deepEq(iids(setup), ['itm_profile', 'itm_headshot', 'itm_contact', 'itm_avail', 'itm_dress', 'itm_sched', 'itm_sysaccess', 'itm_resources'],
      'items follow their sortOrder inside the group');
  });

  test('reordering item sortOrder reorders the items', async () => {
    DB.checklistItems.find(i => i.id === 'itm_sysaccess').sortOrder = 0;
    const setup = groupOf(await Store.getChecklist('emp_jordan'), 'grp_setup');
    deepEq(iids(setup), ['itm_sysaccess', 'itm_profile', 'itm_headshot', 'itm_contact', 'itm_avail', 'itm_dress', 'itm_sched', 'itm_resources'],
      'changing an item sortOrder must change the order it is returned in');
  });

  test('items never leak across groups', async () => {
    const groups = await Store.getChecklist('emp_jordan');
    deepEq(iids(groupOf(groups, 'grp_training')), ['itm_taccess', 'itm_login', 'itm_open', 'itm_ackfuture'],
      'the training group holds exactly its four items');
    const manualIds = groups.filter(g => g.kind === 'manual').flatMap(iids);
    len(manualIds, 18, 'the six + eight + four manual items should each appear exactly once');
    eq(new Set(manualIds).size, 18, 'no manual item should be duplicated across groups');
  });

  test('manual items merge the employee state and are unlocked', async () => {
    const employment = groupOf(await Store.getChecklist('emp_jordan'), 'grp_employment');
    const i9 = employment.items.find(i => i.id === 'itm_i9');
    deepEq(i9, { id: 'itm_i9', label: 'Form I-9 process', done: true, locked: false },
      'a manual item is exactly {id,label,done,locked}');
    const ec = employment.items.find(i => i.id === 'itm_ec');
    eq(ec.done, false, 'an item with no checklist_state row defaults to not done');
    ok(employment.items.every(i => i.locked === false), 'every manual item must be togglable');
  });

  test('an employee with no checklist state gets everything unchecked', async () => {
    const groups = await Store.getChecklist('emp_sam');
    notOk(DB.checklistState.some(s => s.employeeId === 'emp_sam'), 'fixture: Sam has no seeded state rows');
    const manual = groups.filter(g => g.kind === 'manual').flatMap(g => g.items);
    len(manual, 18, 'Sam still gets the full manual template');
    ok(manual.every(i => i.done === false), 'with no state rows every manual item must read done:false');
    ok(manual.every(i => i.locked === false), 'manual items stay unlocked regardless of state');
  });

  test('the auto group is derived from the meeting journey', async () => {
    const meetings = groupOf(await Store.getChecklist('emp_jordan'), 'grp_meetings');
    eq(meetings.kind, 'auto', 'the meetings group is derived');
    deepEq(iids(meetings), ['meeting:mtg_handbook', 'meeting:mtg_frontdesk', 'meeting:mtg_assistant', 'meeting:mtg_acd'],
      'auto item ids are namespaced as meeting:<meetingId> and follow meeting sortOrder');
    deepEq(meetings.items.map(i => i.status), ['complete', 'scheduled', 'pending', 'pending'],
      'each auto item mirrors the status of its employee_meetings row');
    deepEq(meetings.items.map(i => i.done), [true, false, false, false],
      'an auto item is done only when its meeting is complete');
    ok(meetings.items.every(i => i.locked === true), 'auto items are read-only');
  });

  test('an auto item has the documented shape', async () => {
    const meetings = groupOf(await Store.getChecklist('emp_jordan'), 'grp_meetings');
    deepEq(meetings.items[0],
      { id: 'meeting:mtg_handbook', label: 'Attend Handbook Meeting', done: true, locked: true, status: 'complete' },
      'an auto item is exactly {id,label,done,locked,status}');
  });

  test('the auto item label flags a role-only meeting', async () => {
    const meetings = groupOf(await Store.getChecklist('emp_jordan'), 'grp_meetings');
    const asp = meetings.items.find(i => i.id === 'meeting:mtg_assistant');
    eq(asp.label, 'Attend Assistant Stylist Program (your role)',
      'a role-only step should be labelled as role-specific');
  });

  test('the auto group only lists meetings that apply to the employee', async () => {
    const meetings = groupOf(await Store.getChecklist('emp_maya'), 'grp_meetings');
    len(meetings.items, 3, 'Maya is not ASP-eligible, so her auto group has three lines');
    lacks(iids(meetings), 'meeting:mtg_assistant', 'a step she is not eligible for must not appear');
    deepEq(meetings.items.map(i => i.status), ['complete', 'complete', 'scheduled'],
      'her three lines mirror her employee_meetings rows');
  });

  test('an applicable meeting with no instance shows as pending in the auto group', async () => {
    const i = DB.employeeMeetings.findIndex(x => x.id === 'em_7');   // Maya × ACD
    DB.employeeMeetings.splice(i, 1);
    const acd = groupOf(await Store.getChecklist('emp_maya'), 'grp_meetings')
      .items.find(it => it.id === 'meeting:mtg_acd');
    ok(acd, 'the line must still appear even with no employee_meetings row');
    eq(acd.status, 'pending', 'a missing row reads as pending');
    eq(acd.done, false, 'a missing row is not complete');
  });

  test('completing a meeting ticks its auto line', async () => {
    await Store.completeEmployeeMeeting('emp_jordan', 'mtg_frontdesk');
    const line = groupOf(await Store.getChecklist('emp_jordan'), 'grp_meetings')
      .items.find(it => it.id === 'meeting:mtg_frontdesk');
    eq(line.status, 'complete', 'the auto line must follow the meeting status');
    eq(line.done, true, 'a completed meeting ticks its checklist line');
  });

  test('assigning the program adds a line to the auto group', async () => {
    await Store.assignProgram('emp_maya');
    const meetings = groupOf(await Store.getChecklist('emp_maya'), 'grp_meetings');
    len(meetings.items, 4, 'the newly applicable step joins the auto group');
    has(iids(meetings), 'meeting:mtg_assistant', 'the assigned step appears as a checklist line');
  });

  test('reflects a manual toggle written through the store', async () => {
    await Store.setChecklistItem('emp_jordan', 'itm_ec', true);
    let ec = groupOf(await Store.getChecklist('emp_jordan'), 'grp_employment').items.find(i => i.id === 'itm_ec');
    eq(ec.done, true, 'the read must show the item as done');
    await Store.setChecklistItem('emp_jordan', 'itm_ec', false);
    ec = groupOf(await Store.getChecklist('emp_jordan'), 'grp_employment').items.find(i => i.id === 'itm_ec');
    eq(ec.done, false, 'unticking must be visible to the next read too');
  });

  test('checklist state is scoped per employee', async () => {
    await Store.setChecklistItem('emp_sam', 'itm_i9', true);
    const sam = groupOf(await Store.getChecklist('emp_sam'), 'grp_employment').items.find(i => i.id === 'itm_i9');
    const jordan = groupOf(await Store.getChecklist('emp_jordan'), 'grp_employment').items.find(i => i.id === 'itm_tax');
    eq(sam.done, true, 'Sam’s toggle applies to Sam');
    eq(jordan.done, true, 'Jordan’s own seeded state is untouched');
    const maya = groupOf(await Store.getChecklist('emp_maya'), 'grp_employment').items.find(i => i.id === 'itm_i9');
    eq(maya.done, false, 'one employee’s toggle must not bleed into another’s checklist');
  });

  test('a locked meeting line cannot be forced done through checklist state', async () => {
    await throwsAsync(() => Store.setChecklistItem('emp_jordan', 'meeting:mtg_acd', true),
      'API.md marks meeting:* items read-only, so the write must be refused');
    const line = groupOf(await Store.getChecklist('emp_jordan'), 'grp_meetings')
      .items.find(it => it.id === 'meeting:mtg_acd');
    eq(line.done, false, 'auto lines are driven by employee_meetings, never by checklist_state');
    eq(line.status, 'pending', 'the derived status must ignore any stray checklist_state row');
  });

  /* Same gap seen from the checklist side: the row exists in employee_meetings but the
     auto group is built from applicability alone, so the line never appears. */
  test('a booked meeting must not be missing from the auto group', async () => {
    let rejected = false;
    try { await Store.scheduleEmployeeMeeting('emp_maya', 'mtg_assistant', 'Thu Jul 16 · 3:30 PM'); }
    catch (_) { rejected = true; }
    const ids = iids(groupOf(await Store.getChecklist('emp_maya'), 'grp_meetings'));
    ok(rejected || ids.includes('meeting:mtg_assistant'),
      'a meeting stored against the employee must either have been refused or be listed in the group it drives');
  });

  test('returns an empty list for an unknown employee', async () => {
    deepEq(await Store.getChecklist('emp_nobody'), [], 'an unknown employee id must yield no checklist');
    deepEq(await Store.getChecklist(undefined), [], 'a missing employee id must yield no checklist');
  });

  test('returns detached copies of the groups and items', async () => {
    const groups = await Store.getChecklist('emp_jordan');
    groups[0].title = 'Hijacked';
    groups[0].items[0].done = false;
    groups[0].items.push({ id: 'itm_fake', label: 'Fake', done: true, locked: false });
    const again = await Store.getChecklist('emp_jordan');
    eq(again[0].title, 'Employment requirements', 'mutating a returned group must not reach the template');
    eq(again[0].items[0].done, true, 'mutating a returned item must not reach checklist_state');
    len(again[0].items, 6, 'pushing into a returned array must not add rows to the template');
  });
});

/* --- mutations-meetings --- */
suite('Store.scheduleEmployeeMeeting', () => {
  const rowsFor = (empId, meetingId) =>
    DB.employeeMeetings.filter(r => r.employeeId === empId && r.meetingId === meetingId);

  test('books a pending meeting: status becomes scheduled and the label is stored', async () => {
    const inst = await Store.scheduleEmployeeMeeting('emp_jordan', 'mtg_acd', 'Fri Jul 17 · 4:00 PM');
    eq(inst.status, 'scheduled', 'the returned instance should report the booked status');
    eq(inst.when, 'Fri Jul 17 · 4:00 PM', 'the returned instance should carry the chosen time label');
    const row = rowsFor('emp_jordan', 'mtg_acd')[0];
    eq(row.status, 'scheduled', 'the employee_meetings row should be persisted as scheduled');
    eq(row.when, 'Fri Jul 17 · 4:00 PM', 'the chosen time label should be persisted');
  });

  test('the booking is visible through listEmployeeMeetings', async () => {
    await Store.scheduleEmployeeMeeting('emp_jordan', 'mtg_acd', 'Mon Jul 20 · 9:00 AM');
    const meets = await Store.listEmployeeMeetings('emp_jordan');
    const acd = meets.find(m => m.meetingId === 'mtg_acd');
    eq(acd.status, 'scheduled', 'the read model should report the meeting as scheduled');
    eq(acd.when, 'Mon Jul 20 · 9:00 AM', 'the read model should report the booked time');
    ok(acd.hasInstance, 'a booked meeting should report hasInstance');
  });

  test('resolves the host from the slot that matches the chosen time', async () => {
    /* Seeded slots all share their meeting's defaultHost, so add one that differs. */
    await Store.addSlot('mtg_acd', { when: 'Sat Jul 18 · 1:00 PM', host: 'Kris · Barber' });
    const inst = await Store.scheduleEmployeeMeeting('emp_jordan', 'mtg_acd', 'Sat Jul 18 · 1:00 PM');
    eq(inst.host, 'Kris · Barber', 'the host should come from the matching slot, not the meeting default');
    eq(rowsFor('emp_jordan', 'mtg_acd')[0].host, 'Kris · Barber', 'the slot host should be persisted');
  });

  test('falls back to the meeting defaultHost when the label matches no slot', async () => {
    /* Change the default so the fallback is distinguishable from the row's existing host. */
    await Store.updateMeeting('mtg_acd', { defaultHost: 'Kris · Barber' });
    eq(rowsFor('emp_jordan', 'mtg_acd')[0].host, 'Charlie · Owner', 'precondition: the row starts with the seeded host');
    const inst = await Store.scheduleEmployeeMeeting('emp_jordan', 'mtg_acd', 'Time TBD');
    eq(inst.when, 'Time TBD', 'a free-text label should still be stored');
    eq(inst.status, 'scheduled', 'a free-text label should still mark the meeting scheduled');
    eq(inst.host, 'Kris · Barber', 'with no matching slot the host should fall back to the meeting defaultHost');
  });

  test('slot lookup is scoped to the meeting — another meeting’s time does not import its host', async () => {
    /* 'Wed Jul 15 · 9:30 AM' is slot_3, which belongs to mtg_frontdesk (Bobby). */
    const inst = await Store.scheduleEmployeeMeeting('emp_jordan', 'mtg_acd', 'Wed Jul 15 · 9:30 AM');
    neq(inst.host, 'Bobby · Manager', 'a slot from a different meeting must not set the host');
    eq(inst.host, 'Charlie · Owner', 'the host should fall back to mtg_acd’s defaultHost');
  });

  test('creates the employee_meetings row when the employee has no instance yet', async () => {
    const i = DB.employeeMeetings.findIndex(r => r.employeeId === 'emp_sam' && r.meetingId === 'mtg_frontdesk');
    DB.employeeMeetings.splice(i, 1);                       // fixture: employee with a missing instance
    const before = DB.employeeMeetings.length;
    const inst = await Store.scheduleEmployeeMeeting('emp_sam', 'mtg_frontdesk', 'Thu Jul 16 · 2:00 PM');
    eq(DB.employeeMeetings.length, before + 1, 'exactly one employee_meetings row should be inserted');
    len(rowsFor('emp_sam', 'mtg_frontdesk'), 1, 'the employee/meeting pair should be unique');
    eq(inst.employeeId, 'emp_sam', 'the new row should belong to the employee');
    eq(inst.meetingId, 'mtg_frontdesk', 'the new row should point at the meeting');
    eq(inst.status, 'scheduled', 'a freshly created instance should be scheduled, not pending');
    eq(inst.when, 'Thu Jul 16 · 2:00 PM', 'the new row should carry the chosen time');
    eq(inst.host, 'Bobby · Manager', 'the new row should take the host from the matching slot');
    eq(inst.acknowledgedAt, null, 'a new instance should not be pre-acknowledged');
    ok(typeof inst.id === 'string' && inst.id.length > 0, 'the new row should get a stable string id');
  });

  test('a newly created instance shows up in listEmployeeMeetings', async () => {
    const i = DB.employeeMeetings.findIndex(r => r.employeeId === 'emp_sam' && r.meetingId === 'mtg_frontdesk');
    DB.employeeMeetings.splice(i, 1);
    await Store.scheduleEmployeeMeeting('emp_sam', 'mtg_frontdesk', 'Thu Jul 16 · 2:00 PM');
    const meets = await Store.listEmployeeMeetings('emp_sam');
    len(meets, 4, 'an eligible employee should still see all four applicable meetings');
    const fd = meets.find(m => m.meetingId === 'mtg_frontdesk');
    eq(fd.status, 'scheduled', 'the recreated instance should read back as scheduled');
    eq(fd.when, 'Thu Jul 16 · 2:00 PM', 'the recreated instance should read back with its time');
  });

  test('books the instance assignProgram just created', async () => {
    await Store.assignProgram('emp_maya');
    const inst = await Store.scheduleEmployeeMeeting('emp_maya', 'mtg_assistant', 'Fri Jul 17 · 10:00 AM');
    eq(inst.status, 'scheduled', 'the assigned program step should become scheduled');
    eq(inst.host, 'Juan · Senior Stylist', 'the host should come from the chosen assistant-program slot');
    len(rowsFor('emp_maya', 'mtg_assistant'), 1, 'assign-then-schedule should not duplicate the instance');
  });

  test('rebooking replaces the time in place instead of adding a row', async () => {
    const before = DB.employeeMeetings.length;
    eq(rowsFor('emp_jordan', 'mtg_frontdesk')[0].when, 'Wed Jul 15 · 9:30 AM', 'precondition: seeded booking');
    await Store.scheduleEmployeeMeeting('emp_jordan', 'mtg_frontdesk', 'Mon Jul 20 · 11:00 AM');
    eq(DB.employeeMeetings.length, before, 'rebooking must not append an employee_meetings row');
    len(rowsFor('emp_jordan', 'mtg_frontdesk'), 1, 'the employee/meeting pair must stay unique');
    const row = rowsFor('emp_jordan', 'mtg_frontdesk')[0];
    eq(row.id, 'em_2', 'the original row should be updated in place');
    eq(row.when, 'Mon Jul 20 · 11:00 AM', 'the new time should replace the old one');
    eq(row.status, 'scheduled', 'a rebooked meeting stays scheduled');
  });

  test('rebooking keeps an existing acknowledgment', async () => {
    await Store.acknowledgeEmployeeMeeting('emp_sam', 'mtg_handbook');
    const acked = rowsFor('emp_sam', 'mtg_handbook')[0].acknowledgedAt;
    ok(acked, 'precondition: the handbook meeting is acknowledged');
    await Store.scheduleEmployeeMeeting('emp_sam', 'mtg_handbook', 'Fri Jul 17 · 9:00 AM');
    eq(rowsFor('emp_sam', 'mtg_handbook')[0].acknowledgedAt, acked, 'rescheduling must not clear the acknowledgment');
  });

  test('scheduling one employee does not touch another employee’s instance', async () => {
    await Store.scheduleEmployeeMeeting('emp_sam', 'mtg_frontdesk', 'Mon Jul 20 · 11:00 AM');
    eq(rowsFor('emp_jordan', 'mtg_frontdesk')[0].when, 'Wed Jul 15 · 9:30 AM', 'Jordan’s booking should be untouched');
    eq(rowsFor('emp_jordan', 'mtg_frontdesk')[0].status, 'scheduled', 'Jordan’s status should be untouched');
  });

  test('the employee schedule() flow persists and re-renders', async () => {
    await schedule('mtg_acd', 'Fri Jul 17 · 4:00 PM');
    const m = state.me.meetings.find(x => x.meetingId === 'mtg_acd');
    eq(m.status, 'scheduled', 'state should be refreshed from the Store after booking');
    eq(m.when, 'Fri Jul 17 · 4:00 PM', 'state should carry the booked time');
    eq(rescheduleId, null, 'booking should clear the reschedule flag');
    has(html('#rail'), 'Fri Jul 17 · 4:00 PM', 'the meeting rail should show the booked time');
  });

  test('rejects unknown employee and meeting ids instead of writing an orphan row', async () => {
    const before = DB.employeeMeetings.length;
    await throwsAsync(() => Store.scheduleEmployeeMeeting('emp_nobody', 'mtg_acd', 'Fri Jul 17 · 4:00 PM'),
      'scheduling for an unknown employee should reject (404), not create a row');
    await throwsAsync(() => Store.scheduleEmployeeMeeting('emp_jordan', 'mtg_nope', 'Fri Jul 17 · 4:00 PM'),
      'scheduling an unknown meeting should reject (404), not create a row');
    eq(DB.employeeMeetings.length, before, 'no employee_meetings row should be created for unknown ids');
  });
});

/* --- mutations-meetings --- */
suite('Store.completeEmployeeMeeting', () => {
  const rowsFor = (empId, meetingId) =>
    DB.employeeMeetings.filter(r => r.employeeId === empId && r.meetingId === meetingId);

  test('marks a pending meeting complete', async () => {
    const inst = await Store.completeEmployeeMeeting('emp_jordan', 'mtg_acd');
    eq(inst.status, 'complete', 'the returned instance should report completion');
    eq(rowsFor('emp_jordan', 'mtg_acd')[0].status, 'complete', 'completion should be persisted');
    const meets = await Store.listEmployeeMeetings('emp_jordan');
    eq(meets.find(m => m.meetingId === 'mtg_acd').status, 'complete', 'the read model should report completion');
  });

  test('is idempotent — completing twice leaves one row still complete', async () => {
    const before = DB.employeeMeetings.length;
    await Store.completeEmployeeMeeting('emp_jordan', 'mtg_acd');
    const second = await Store.completeEmployeeMeeting('emp_jordan', 'mtg_acd');
    eq(second.status, 'complete', 'the second completion should still report complete');
    eq(DB.employeeMeetings.length, before, 'completing twice must not append a row');
    len(rowsFor('emp_jordan', 'mtg_acd'), 1, 'the employee/meeting pair must stay unique');
  });

  test('completing a scheduled meeting keeps its time and host', async () => {
    const inst = await Store.completeEmployeeMeeting('emp_jordan', 'mtg_frontdesk');
    eq(inst.status, 'complete', 'the scheduled meeting should become complete');
    eq(inst.when, 'Wed Jul 15 · 9:30 AM', 'completion should not discard the booked time');
    eq(inst.host, 'Bobby · Manager', 'completion should not discard the host');
  });

  test('creates the employee_meetings row when the instance is missing', async () => {
    const i = DB.employeeMeetings.findIndex(r => r.employeeId === 'emp_sam' && r.meetingId === 'mtg_acd');
    DB.employeeMeetings.splice(i, 1);
    const before = DB.employeeMeetings.length;
    const inst = await Store.completeEmployeeMeeting('emp_sam', 'mtg_acd');
    eq(DB.employeeMeetings.length, before + 1, 'exactly one row should be inserted');
    eq(inst.status, 'complete', 'the created row should be complete');
    eq(inst.when, null, 'a meeting completed without a booking has no time label');
    eq(inst.host, 'Charlie · Owner', 'the created row should default to the meeting host');
  });

  test('recomputes the employee’s cached progress', async () => {
    const before = await Store.getEmployee('emp_sam');
    eq(before.progress, 20, 'precondition: seeded progress');
    await Store.completeEmployeeMeeting('emp_sam', 'mtg_handbook');
    const after1 = await Store.getEmployee('emp_sam');
    eq(after1.progress, 40, 'one of four applicable meetings complete should read 40%');
    await Store.completeEmployeeMeeting('emp_sam', 'mtg_frontdesk');
    const after2 = await Store.getEmployee('emp_sam');
    eq(after2.progress, 60, 'two of four applicable meetings complete should read 60%');
  });

  test('progress reaches 100 when every applicable meeting is complete', async () => {
    await Store.completeEmployeeMeeting('emp_maya', 'mtg_acd');
    const maya = await Store.getEmployee('emp_maya');
    eq(maya.progress, 100, 'all three applicable meetings complete should read 100%');
  });

  test('progress never drops below the value already cached', async () => {
    /* Maya sits at a cached 80 with 2 of 3 done, which recomputes to 73. */
    await Store.completeEmployeeMeeting('emp_maya', 'mtg_handbook');
    const maya = await Store.getEmployee('emp_maya');
    eq(maya.progress, 80, 'a re-completion must not walk cached progress backwards');
  });

  test('advances the derived nextStep', async () => {
    const before = await Store.getEmployee('emp_sam');
    eq(before.nextStep, 'Step I · Handbook Meeting', 'precondition: the first step is next');
    await Store.completeEmployeeMeeting('emp_sam', 'mtg_handbook');
    const after = await Store.getEmployee('emp_sam');
    eq(after.nextStep, 'Step II · Front Desk & Concierge', 'nextStep should move to the following step');
  });

  test('drives the auto checklist group', async () => {
    await Store.completeEmployeeMeeting('emp_jordan', 'mtg_acd');
    const groups = await Store.getChecklist('emp_jordan');
    const auto = groups.find(g => g.id === 'grp_meetings');
    const item = auto.items.find(it => it.id === 'meeting:mtg_acd');
    ok(item.done, 'the auto checklist line should tick when the meeting completes');
    ok(item.locked, 'auto checklist lines stay read-only');
    eq(item.status, 'complete', 'the auto line should carry the meeting status');
  });

  test('the admin adminComplete() flow refreshes the employee view', async () => {
    await adminComplete('emp_jordan', 'mtg_acd');
    const me = state.me.meetings.find(m => m.meetingId === 'mtg_acd');
    eq(me.status, 'complete', 'state should be refreshed after the admin marks it complete');
    eq(text('#statMeet'), '2 / 4', 'the home meeting counter should reflect the new completion');
  });

  test('rejects unknown ids without writing an orphan row', async () => {
    const before = DB.employeeMeetings.length;
    await throwsAsync(() => Store.completeEmployeeMeeting('emp_nobody', 'mtg_acd'),
      'completing for an unknown employee should reject (404)');
    eq(DB.employeeMeetings.length, before, 'a rejected completion must not leave a row for a non-existent employee');
    await throwsAsync(() => Store.completeEmployeeMeeting('emp_jordan', 'mtg_nope'),
      'completing an unknown meeting should reject (404)');
    eq(DB.employeeMeetings.length, before, 'a rejected completion must not leave a row for a non-existent meeting');
  });
});

/* --- mutations-meetings --- */
suite('Store.acknowledgeEmployeeMeeting', () => {
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
  const rowsFor = (empId, meetingId) =>
    DB.employeeMeetings.filter(r => r.employeeId === empId && r.meetingId === meetingId);

  test('stores a parseable ISO timestamp', async () => {
    const inst = await Store.acknowledgeEmployeeMeeting('emp_sam', 'mtg_handbook');
    ok(typeof inst.acknowledgedAt === 'string', 'acknowledgedAt should be stored as a string');
    match(inst.acknowledgedAt, ISO, 'acknowledgedAt should be an ISO-8601 UTC timestamp');
    ok(!Number.isNaN(Date.parse(inst.acknowledgedAt)), 'acknowledgedAt should be parseable as a date');
    eq(new Date(inst.acknowledgedAt).toISOString(), inst.acknowledgedAt, 'acknowledgedAt should round-trip through Date');
  });

  test('leaves the meeting status, time and host alone', async () => {
    const before = clone(rowsFor('emp_sam', 'mtg_handbook')[0]);
    eq(before.status, 'scheduled', 'precondition: the handbook meeting is booked, not complete');
    const inst = await Store.acknowledgeEmployeeMeeting('emp_sam', 'mtg_handbook');
    eq(inst.status, 'scheduled', 'acknowledging must not change the meeting status');
    eq(inst.when, before.when, 'acknowledging must not change the booked time');
    eq(inst.host, before.host, 'acknowledging must not change the host');
  });

  test('a pending meeting stays pending after acknowledgment', async () => {
    const inst = await Store.acknowledgeEmployeeMeeting('emp_jordan', 'mtg_acd');
    eq(inst.status, 'pending', 'acknowledging an unbooked meeting must not schedule it');
    eq(inst.when, null, 'acknowledging must not invent a time');
    ok(inst.acknowledgedAt, 'the acknowledgment should still be recorded');
  });

  test('acknowledging twice updates one row rather than appending', async () => {
    const before = DB.employeeMeetings.length;
    await Store.acknowledgeEmployeeMeeting('emp_sam', 'mtg_handbook');
    const second = await Store.acknowledgeEmployeeMeeting('emp_sam', 'mtg_handbook');
    eq(DB.employeeMeetings.length, before, 'a repeat acknowledgment must not append a row');
    len(rowsFor('emp_sam', 'mtg_handbook'), 1, 'the employee/meeting pair must stay unique');
    match(second.acknowledgedAt, ISO, 'the repeat acknowledgment should still store a valid timestamp');
  });

  test('surfaces through listEmployeeMeetings', async () => {
    const inst = await Store.acknowledgeEmployeeMeeting('emp_sam', 'mtg_handbook');
    const meets = await Store.listEmployeeMeetings('emp_sam');
    const hb = meets.find(m => m.meetingId === 'mtg_handbook');
    eq(hb.acknowledgedAt, inst.acknowledgedAt, 'the read model should expose the stored acknowledgment');
    ok(hb.requiresAck, 'the handbook step is the one that requires acknowledgment');
  });

  test('does not touch another employee’s acknowledgment', async () => {
    await Store.acknowledgeEmployeeMeeting('emp_sam', 'mtg_handbook');
    eq(rowsFor('emp_jordan', 'mtg_handbook')[0].acknowledgedAt, '2026-07-06T10:45:00Z',
      'Jordan’s seeded acknowledgment should be untouched');
  });

  test('the ackHandbook() flow records the acknowledgment for the current user', async () => {
    /* Clear the seeded acknowledgment so the button path has work to do. */
    DB.employeeMeetings.find(r => r.employeeId === CURRENT_USER && r.meetingId === 'mtg_handbook').acknowledgedAt = null;
    await refresh();
    await ackHandbook('mtg_handbook');
    const hb = state.me.meetings.find(m => m.meetingId === 'mtg_handbook');
    ok(hb.acknowledgedAt, 'state should be refreshed with the new acknowledgment');
    match(hb.acknowledgedAt, ISO, 'the acknowledgment written by the UI should be a valid ISO timestamp');
  });
});

/* --- mutations-meetings --- */
suite('Store.assignProgram', () => {
  const rowsFor = (empId, meetingId) =>
    DB.employeeMeetings.filter(r => r.employeeId === empId && r.meetingId === meetingId);

  test('flips eligibleForAsp and returns the updated employee', async () => {
    const before = await Store.getEmployee('emp_maya');
    notOk(before.eligibleForAsp, 'precondition: Maya is not yet in the program');
    const emp = await Store.assignProgram('emp_maya');
    ok(emp.eligibleForAsp, 'the returned employee should be eligible');
    ok(DB.employees.find(e => e.id === 'emp_maya').eligibleForAsp, 'eligibility should be persisted');
  });

  test('creates exactly one mtg_assistant instance', async () => {
    const before = DB.employeeMeetings.length;
    await Store.assignProgram('emp_maya');
    eq(DB.employeeMeetings.length, before + 1, 'exactly one employee_meetings row should be inserted');
    len(rowsFor('emp_maya', 'mtg_assistant'), 1, 'the program step should exist once for the employee');
    const row = rowsFor('emp_maya', 'mtg_assistant')[0];
    eq(row.status, 'pending', 'a newly assigned step starts pending');
    eq(row.when, null, 'a newly assigned step has no time yet');
    eq(row.host, 'Juan · Senior Stylist', 'the new row should default to the meeting host');
    eq(row.acknowledgedAt, null, 'a newly assigned step is not acknowledged');
  });

  test('is idempotent on a second call', async () => {
    await Store.assignProgram('emp_maya');
    const after1 = DB.employeeMeetings.length;
    const emp = await Store.assignProgram('emp_maya');
    eq(DB.employeeMeetings.length, after1, 'assigning twice must not append a second row');
    len(rowsFor('emp_maya', 'mtg_assistant'), 1, 'the program step must stay unique per employee');
    ok(emp.eligibleForAsp, 'the employee should still be eligible after a repeat call');
  });

  test('no-ops for an employee who is already eligible and has the instance', async () => {
    const before = DB.employeeMeetings.length;
    await Store.assignProgram('emp_sam');
    eq(DB.employeeMeetings.length, before, 'nothing should be inserted for an already-assigned employee');
    len(rowsFor('emp_sam', 'mtg_assistant'), 1, 'Sam should still have exactly one program row');
    eq(rowsFor('emp_sam', 'mtg_assistant')[0].status, 'pending', 'the existing row should not be reset');
  });

  test('listEmployeeMeetings then returns four applicable meetings', async () => {
    const before = await Store.listEmployeeMeetings('emp_maya');
    len(before, 3, 'precondition: a non-eligible employee sees three meetings');
    await Store.assignProgram('emp_maya');
    const after = await Store.listEmployeeMeetings('emp_maya');
    len(after, 4, 'an assigned employee should see all four meetings');
    const asp = after.find(m => m.meetingId === 'mtg_assistant');
    ok(asp.applicable, 'the program step should now be applicable');
    ok(asp.hasInstance, 'the program step should now have an instance');
    eq(asp.status, 'pending', 'the program step should be pending until it is booked');
  });

  test('adds the program step to the auto checklist group', async () => {
    await Store.assignProgram('emp_maya');
    const auto = (await Store.getChecklist('emp_maya')).find(g => g.id === 'grp_meetings');
    len(auto.items, 4, 'the auto group should list one line per applicable meeting');
    const line = auto.items.find(it => it.id === 'meeting:mtg_assistant');
    ok(line, 'the assistant program should appear on the checklist');
    has(line.label, '(your role)', 'role-only steps are labelled as role-based');
    notOk(line.done, 'a freshly assigned step is not done');
  });

  test('re-derives nextStep to the newly applicable step', async () => {
    const before = await Store.getEmployee('emp_maya');
    eq(before.nextStep, 'Step IV · Continued Development intro', 'precondition: the ACD intro was next');
    await Store.assignProgram('emp_maya');
    const after = await Store.getEmployee('emp_maya');
    eq(after.nextStep, 'Step III · Assistant Stylist Program', 'the earlier program step should become next');
  });

  test('does not change cached progress on its own', async () => {
    await Store.assignProgram('emp_maya');
    eq(DB.employees.find(e => e.id === 'emp_maya').progress, 80, 'assigning a step is not a completion');
  });

  test('rejects an unknown employee id', async () => {
    const before = DB.employeeMeetings.length;
    const err = await throwsAsync(() => Store.assignProgram('emp_nobody'),
      'assigning a program to an unknown employee should reject (404)');
    match(String(err.message), /not found/i, 'the rejection should say the employee was not found');
    eq(DB.employeeMeetings.length, before, 'no row should be created for an unknown employee');
  });
});

/* --- mutations-meetings --- */
suite('Store employee-field mutations', () => {
  test('setTrainingAccess stores a real boolean true for a truthy value', async () => {
    const emp = await Store.setTrainingAccess('emp_jordan', 'yes');
    eq(emp.trainingAccess, true, 'a truthy value should be coerced to boolean true');
    eq(DB.employees.find(e => e.id === 'emp_jordan').trainingAccess, true, 'the coerced boolean should be persisted');
  });

  test('setTrainingAccess stores a real boolean false for a falsy value', async () => {
    const emp = await Store.setTrainingAccess('emp_maya', 0);
    eq(emp.trainingAccess, false, 'a falsy value should be coerced to boolean false');
    eq(DB.employees.find(e => e.id === 'emp_maya').trainingAccess, false, 'the coerced boolean should be persisted');
  });

  test('setTrainingAccess round-trips through the roster read', async () => {
    await Store.setTrainingAccess('emp_jordan', true);
    const roster = await Store.listEmployees();
    ok(roster.find(e => e.id === 'emp_jordan').trainingAccess, 'the roster should report the new access flag');
    await Store.setTrainingAccess('emp_jordan', false);
    const roster2 = await Store.listEmployees();
    notOk(roster2.find(e => e.id === 'emp_jordan').trainingAccess, 'the roster should report access revoked');
  });

  test('the admin roster counter follows training access', async () => {
    eq(text('#statAccess'), '2', 'precondition: two seeded employees are still pending access');
    await Store.setTrainingAccess('emp_jordan', true);
    await refresh();
    eq(text('#statAccess'), '1', 'confirming access should shrink the pending count');
  });

  test('setTrainingAccess touches only the named employee', async () => {
    await Store.setTrainingAccess('emp_jordan', true);
    eq(DB.employees.find(e => e.id === 'emp_maya').trainingAccess, true, 'Maya’s seeded access should be untouched');
    eq(DB.employees.find(e => e.id === 'emp_sam').trainingAccess, false, 'Sam’s seeded access should be untouched');
  });

  test('setTrainingAccess rejects an unknown employee id', async () => {
    const err = await throwsAsync(() => Store.setTrainingAccess('emp_nobody', true),
      'setting access on an unknown employee should reject (404)');
    match(String(err.message), /not found/i, 'the rejection should say the employee was not found');
    eq(DB.employees.length, 4, 'a failed update must not create an employee');
  });

  test('setEmployeeNotes stores the text', async () => {
    const emp = await Store.setEmployeeNotes('emp_sam', 'Shadowing Juan on Thursday.');
    eq(emp.adminNotes, 'Shadowing Juan on Thursday.', 'the returned employee should carry the new note');
    eq(DB.employees.find(e => e.id === 'emp_sam').adminNotes, 'Shadowing Juan on Thursday.', 'the note should be persisted');
  });

  test('setEmployeeNotes can clear a note to an empty string', async () => {
    const emp = await Store.setEmployeeNotes('emp_jordan', '');
    eq(emp.adminNotes, '', 'an empty note should be stored as an empty string');
    eq(DB.employees.find(e => e.id === 'emp_jordan').adminNotes, '', 'clearing should be persisted, not ignored');
  });

  test('setEmployeeNotes round-trips through getEmployee', async () => {
    await Store.setEmployeeNotes('emp_leo', 'Fully on the books.');
    const leo = await Store.getEmployee('emp_leo');
    eq(leo.adminNotes, 'Fully on the books.', 'the note should be readable back through the Store');
  });

  test('setEmployeeNotes rejects an unknown employee id', async () => {
    const err = await throwsAsync(() => Store.setEmployeeNotes('emp_nobody', 'hello'),
      'noting an unknown employee should reject (404)');
    match(String(err.message), /not found/i, 'the rejection should say the employee was not found');
  });
});

/* --- mutations-meetings --- */
suite('Store.setChecklistItem', () => {
  const rowFor = (empId, itemId) =>
    DB.checklistState.find(r => r.employeeId === empId && r.itemId === itemId);

  test('creates a checklist_state row when the employee has none', async () => {
    const before = DB.checklistState.length;
    notOk(rowFor('emp_sam', 'itm_i9'), 'precondition: Sam has no seeded checklist state');
    const res = await Store.setChecklistItem('emp_sam', 'itm_i9', true);
    eq(DB.checklistState.length, before + 1, 'exactly one checklist_state row should be inserted');
    deepEq(res, { employeeId: 'emp_sam', itemId: 'itm_i9', done: true }, 'the mutation should return the stored row');
    eq(rowFor('emp_sam', 'itm_i9').done, true, 'the new row should be marked done');
  });

  test('updates the existing row instead of inserting a duplicate', async () => {
    const before = DB.checklistState.length;
    ok(rowFor('emp_jordan', 'itm_i9').done, 'precondition: the seeded item is done');
    await Store.setChecklistItem('emp_jordan', 'itm_i9', false);
    eq(DB.checklistState.length, before, 'updating must not append a checklist_state row');
    len(DB.checklistState.filter(r => r.employeeId === 'emp_jordan' && r.itemId === 'itm_i9'), 1,
      'the employee/item pair must stay unique');
    eq(rowFor('emp_jordan', 'itm_i9').done, false, 'the existing row should be updated');
  });

  test('toggling back to false persists false', async () => {
    await Store.setChecklistItem('emp_sam', 'itm_dd', true);
    eq(rowFor('emp_sam', 'itm_dd').done, true, 'precondition: the item was checked');
    const res = await Store.setChecklistItem('emp_sam', 'itm_dd', false);
    eq(res.done, false, 'unchecking should report done:false');
    eq(rowFor('emp_sam', 'itm_dd').done, false, 'unchecking should persist as false, not be dropped');
    const groups = await Store.getChecklist('emp_sam');
    const item = groups.find(g => g.id === 'grp_employment').items.find(it => it.id === 'itm_dd');
    notOk(item.done, 'the checklist read should show the item unchecked again');
  });

  test('coerces the done flag to a boolean', async () => {
    const on = await Store.setChecklistItem('emp_sam', 'itm_ec', 1);
    eq(on.done, true, 'a truthy flag should be stored as boolean true');
    eq(rowFor('emp_sam', 'itm_ec').done, true, 'the persisted value should be a boolean, not the raw input');
    const off = await Store.setChecklistItem('emp_sam', 'itm_ec', '');
    eq(off.done, false, 'a falsy flag should be stored as boolean false');
    eq(rowFor('emp_sam', 'itm_ec').done, false, 'the persisted value should be boolean false');
  });

  test('shows up in getChecklist for that employee only', async () => {
    await Store.setChecklistItem('emp_sam', 'itm_lic', true);
    const sam = (await Store.getChecklist('emp_sam')).find(g => g.id === 'grp_employment');
    ok(sam.items.find(it => it.id === 'itm_lic').done, 'Sam’s checklist should show the item done');
    const jordan = (await Store.getChecklist('emp_jordan')).find(g => g.id === 'grp_employment');
    notOk(jordan.items.find(it => it.id === 'itm_lic').done, 'another employee’s checklist should be unaffected');
  });

  test('the tick() flow updates the current user’s checklist and progress', async () => {
    const before = progressCounts();
    await tick('itm_ec', true);
    ok(findItem('itm_ec').done, 'state should be refreshed with the ticked item');
    eq(progressCounts().done, before.done + 1, 'the progress counter should advance by one');
    eq(progressCounts().total, before.total, 'ticking should not change the number of checklist lines');
  });

  test('rejects auto-group meeting items, which are not writable', async () => {
    const before = DB.checklistState.length;
    await throwsAsync(() => Store.setChecklistItem('emp_jordan', 'meeting:mtg_acd', true),
      'meeting:* lines are derived and must not be writable through the checklist endpoint');
    eq(DB.checklistState.length, before, 'no checklist_state row should be written for a derived item');
  });
});

/* --- mutations-meetings --- */
suite('Store mutations · unknown ids reject', () => {
  test('updateTeamMember rejects an unknown member id', async () => {
    const before = DB.team.length;
    const err = await throwsAsync(() => Store.updateTeamMember('tm_nobody', { name: 'Ghost' }),
      'editing an unknown team member should reject (404)');
    match(String(err.message), /not found/i, 'the rejection should say the member was not found');
    eq(DB.team.length, before, 'a failed edit must not create a member');
  });

  test('setTeamPhoto rejects an unknown member id', async () => {
    const err = await throwsAsync(() => Store.setTeamPhoto('tm_nobody', 'data:image/png;base64,AAAA'),
      'setting a photo on an unknown team member should reject (404)');
    match(String(err.message), /not found/i, 'the rejection should say the member was not found');
    eq(DB.team.length, 5, 'a failed photo write must not create a member');
  });

  test('updateMeeting rejects an unknown meeting id', async () => {
    const err = await throwsAsync(() => Store.updateMeeting('mtg_nope', { defaultHost: 'Kris · Barber' }),
      'patching an unknown meeting should reject (404)');
    match(String(err.message), /not found/i, 'the rejection should say the meeting was not found');
    eq(DB.meetings.length, 4, 'a failed patch must not create a meeting');
  });

  test('failed employee mutations leave the seed untouched', async () => {
    await throwsAsync(() => Store.assignProgram('emp_nobody'), 'assignProgram should reject for an unknown employee');
    await throwsAsync(() => Store.setTrainingAccess('emp_nobody', true), 'setTrainingAccess should reject for an unknown employee');
    await throwsAsync(() => Store.setEmployeeNotes('emp_nobody', 'x'), 'setEmployeeNotes should reject for an unknown employee');
    eq(DB.employees.length, 4, 'no employee row should have been created');
    eq(DB.employeeMeetings.length, 14, 'no employee_meetings row should have been created');
  });
});

/* --- mutations-content --- */
suite('Store · addTeamMember', () => {
  test('derives two-letter initials from a first and last name', async () => {
    const m = await Store.addTeamMember({ name: 'Jamie Diaz', role: 'Barber' });
    eq(m.initials, 'JD', 'initials should come from the first letter of each of the first two names');
  });

  test('derives initials from the first two letters of a single-word name', async () => {
    const m = await Store.addTeamMember({ name: 'renata', role: 'Barber' });
    eq(m.initials, 'RE', 'a one-word name should yield its first two letters, uppercased');
  });

  test('uses only the first two words when a name has three', async () => {
    const m = await Store.addTeamMember({ name: 'Ana Maria Cruz', role: 'Stylist' });
    eq(m.initials, 'AM', 'initials should use the first two name parts only');
  });

  test('assigns the next sortOrder above the current maximum', async () => {
    const max = DB.team.reduce((n, t) => Math.max(n, t.sortOrder || 0), 0);
    const m = await Store.addTeamMember({ name: 'Nia Blake', role: 'Barber' });
    eq(m.sortOrder, max + 1, 'a new member should sort immediately after the current last member');
  });

  test('respects a raised maximum sortOrder rather than the row count', async () => {
    DB.team.find(t => t.id === 'tm_charlie').sortOrder = 12;   // fixture: a roster with gaps
    const m = await Store.addTeamMember({ name: 'Nia Blake', role: 'Barber' });
    eq(m.sortOrder, 13, 'sortOrder should be max(sortOrder) + 1, not team.length + 1');
  });

  test('defaults bio, specialties, photoUrl, experience and hosted meetings', async () => {
    const m = await Store.addTeamMember({ name: 'Nia Blake', role: 'Barber' });
    eq(m.experience, '', 'experience should default to an empty string');
    eq(m.photoUrl, null, 'a brand-new member has no headshot yet');
    deepEq(m.specialties, [], 'specialties should default to an empty list');
    deepEq(m.hostsMeetingIds, [], 'a new member hosts no meetings until assigned');
    ok(m.bio && m.bio.length > 0, 'bio should fall back to placeholder copy so the profile card is never blank');
  });

  test('keeps the values it is given instead of the defaults', async () => {
    const m = await Store.addTeamMember({
      name: 'Nia Blake', role: 'Barber', experience: '6 yrs experience',
      specialties: ['Fades', 'Beard work'], bio: 'Sharp fades, sharper opinions.'
    });
    eq(m.experience, '6 yrs experience', 'experience should be stored as supplied');
    eq(m.bio, 'Sharp fades, sharper opinions.', 'a supplied bio should not be replaced by the default');
    deepEq(m.specialties, ['Fades', 'Beard work'], 'specialties should be stored as supplied');
  });

  test('mints a fresh tm_ id that does not collide with the seed', async () => {
    const before = (await Store.listTeam()).map(t => t.id);
    const m = await Store.addTeamMember({ name: 'Nia Blake', role: 'Barber' });
    match(m.id, /^tm_/, 'team ids should keep the tm_ prefix');
    notOk(before.includes(m.id), 'a new member must not reuse an existing id');
  });

  test('grows the roster by exactly one row and appends it last', async () => {
    const before = await Store.listTeam();
    const m = await Store.addTeamMember({ name: 'Nia Blake', role: 'Barber' });
    const after = await Store.listTeam();
    len(after, before.length + 1, 'adding one member should add exactly one row');
    eq(after[after.length - 1].id, m.id, 'the new member should land at the end of the ordered roster');
    deepEq(after.slice(0, before.length), before, 'existing members should be untouched and keep their order');
  });

  test('the added member is readable through listTeam with derived fields', async () => {
    const m = await Store.addTeamMember({ name: 'Nia Blake', role: 'Kids Specialist' });
    const row = (await Store.listTeam()).find(t => t.id === m.id);
    ok(row, 'the new member should be returned by a subsequent listTeam');
    eq(row.name, 'Nia Blake', 'listTeam should return the stored name');
    eq(row.role, 'Kids Specialist', 'listTeam should return the stored role');
    eq(row.initials, 'NB', 'listTeam should return the derived initials');
  });

  test('the added member reaches both the shop wall and the admin roster', async () => {
    const m = await Store.addTeamMember({ name: 'Nia Blake', role: 'Kids Specialist' });
    await refresh();
    const cards = qa('#teamGrid .member');
    len(cards, 6, 'the shop wall should show all six members after the add');
    eq(handlerArg(cards[5], 'openMember'), m.id, 'the last card should open the newly added member');
    has(text(cards[5]), 'Nia Blake', 'the new member card should show the name');
    has(text(cards[5]), 'NB', 'the new member card should show the derived initials in place of a photo');
    has(text('#teamCount'), 'Six', 'the "N artisans" count should follow the roster size');
    has(text('#teamAdmin'), 'Nia Blake', 'the admin roster should list the new member too');
  });

  test('does not alias the specialties array the caller passed in', async () => {
    const tags = ['Fades'];
    const m = await Store.addTeamMember({ name: 'Nia Blake', role: 'Barber', specialties: tags });
    tags.push('Beard work');                    // the caller keeps using its own array afterwards
    const row = (await Store.listTeam()).find(t => t.id === m.id);
    deepEq(row.specialties, ['Fades'], 'the stored row must not share a reference with the caller array');
  });

  test('renders a member name as text, never as markup', async () => {
    await Store.addTeamMember({ name: 'Alex <span class="pwned">x</span>', role: 'Barber' });
    await refresh();
    notOk(q('#teamGrid .pwned'), 'markup inside a member name must be escaped, not parsed into the page');
    notOk(q('#teamAdmin .pwned'), 'the admin roster must escape member names too');
  });
});

/* --- mutations-content --- */
suite('Store · updateTeamMember', () => {
  test('re-derives initials when the name changes', async () => {
    const m = await Store.updateTeamMember('tm_juan', { name: 'Juan Ramirez' });
    eq(m.name, 'Juan Ramirez', 'the new name should be stored');
    eq(m.initials, 'JR', 'initials should be re-derived from the new name');
  });

  test('leaves initials alone when only the role changes', async () => {
    const before = (await Store.listTeam()).find(t => t.id === 'tm_cathy');
    const m = await Store.updateTeamMember('tm_cathy', { role: 'Senior Kids Specialist' });
    eq(m.role, 'Senior Kids Specialist', 'the new role should be stored');
    eq(m.initials, before.initials, 'a role-only edit must not touch the cached initials');
    eq(m.name, before.name, 'a role-only edit must not touch the name');
  });

  test('leaves initials alone when the name is resubmitted unchanged', async () => {
    const before = (await Store.listTeam()).find(t => t.id === 'tm_charlie');
    const m = await Store.updateTeamMember('tm_charlie', { name: before.name, bio: 'Still setting the standard.' });
    eq(m.bio, 'Still setting the standard.', 'the bio edit should be stored');
    eq(m.initials, before.initials, 'resubmitting the same name is not a name change and must not rewrite initials');
  });

  test('an empty patch leaves every field untouched', async () => {
    const before = (await Store.listTeam()).find(t => t.id === 'tm_bobby');
    const after = await Store.updateTeamMember('tm_bobby', {});
    eq(after.name, before.name, 'name should survive an empty patch');
    eq(after.initials, before.initials, 'initials should survive an empty patch');
    eq(after.role, before.role, 'role should survive an empty patch');
    eq(after.experience, before.experience, 'experience should survive an empty patch');
    eq(after.bio, before.bio, 'bio should survive an empty patch');
    deepEq(after.specialties, before.specialties, 'specialties should survive an empty patch');
    eq(after.photoUrl, before.photoUrl, 'photoUrl should survive an empty patch');
    eq(after.sortOrder, before.sortOrder, 'sortOrder should survive an empty patch');
    deepEq(after.hostsMeetingIds, before.hostsMeetingIds, 'hosted meetings should survive an empty patch');
  });

  test('explicitly undefined fields are ignored rather than blanked', async () => {
    const before = (await Store.listTeam()).find(t => t.id === 'tm_bobby');
    const after = await Store.updateTeamMember('tm_bobby', {
      name: undefined, role: undefined, experience: undefined, bio: undefined, specialties: undefined
    });
    eq(after.name, before.name, 'an undefined name must not blank the stored name');
    eq(after.initials, before.initials, 'an undefined name must not re-derive initials');
    eq(after.role, before.role, 'an undefined role must not blank the stored role');
    eq(after.experience, before.experience, 'an undefined experience must not blank the stored experience');
    eq(after.bio, before.bio, 'an undefined bio must not blank the stored bio');
    deepEq(after.specialties, before.specialties, 'undefined specialties must not blank the stored list');
  });

  test('patching one field leaves the neighbouring fields alone', async () => {
    const before = (await Store.listTeam()).find(t => t.id === 'tm_kris');
    const after = await Store.updateTeamMember('tm_kris', { bio: 'Two decades of tailored scissor work.' });
    eq(after.bio, 'Two decades of tailored scissor work.', 'the patched bio should be stored');
    eq(after.name, before.name, 'a bio edit must not touch the name');
    eq(after.role, before.role, 'a bio edit must not touch the role');
    eq(after.experience, before.experience, 'a bio edit must not touch the experience line');
    deepEq(after.specialties, before.specialties, 'a bio edit must not touch specialties');
  });

  test('an empty string is a real value and clears the field', async () => {
    const after = await Store.updateTeamMember('tm_bobby', { experience: '', specialties: [] });
    eq(after.experience, '', 'an empty experience string should clear the field, not be ignored');
    deepEq(after.specialties, [], 'an empty specialties array should clear the list');
  });

  test('never touches the headshot', async () => {
    const url = 'data:image/png;base64,iVBORw0KGgo=';
    await Store.setTeamPhoto('tm_kris', url);
    const after = await Store.updateTeamMember('tm_kris', { name: 'Kristopher Vance', role: 'Master Barber' });
    eq(after.photoUrl, url, 'editing profile fields must not drop the stored headshot');
  });

  test('persists so later reads and renders see the edit', async () => {
    await Store.updateTeamMember('tm_juan', { name: 'Juan Ramirez', role: 'Lead Stylist' });
    const row = (await Store.listTeam()).find(t => t.id === 'tm_juan');
    eq(row.name, 'Juan Ramirez', 'listTeam should return the edited name');
    eq(row.role, 'Lead Stylist', 'listTeam should return the edited role');
    await refresh();
    has(text('#teamAdmin'), 'Juan Ramirez', 'the admin roster should show the edited name');
    has(text('#teamGrid'), 'Lead Stylist', 'the shop wall should show the edited role');
  });

  test('does not alias the specialties array the caller passed in', async () => {
    const tags = ['Mentorship'];
    await Store.updateTeamMember('tm_juan', { specialties: tags });
    tags.push('Injected');
    const row = (await Store.listTeam()).find(t => t.id === 'tm_juan');
    deepEq(row.specialties, ['Mentorship'], 'the stored row must not share a reference with the caller array');
  });

  test('rejects an unknown member id', async () => {
    const err = await throwsAsync(() => Store.updateTeamMember('tm_nobody', { role: 'Barber' }),
      'patching a member that does not exist should fail loudly');
    match(String(err.message), /not found/i, 'the error should say the team member was not found');
  });

  test('a rejected update leaves the roster untouched', async () => {
    const before = await Store.listTeam();
    await throwsAsync(() => Store.updateTeamMember('tm_nobody', { role: 'Barber' }));
    deepEq(await Store.listTeam(), before, 'a failed update must not modify any row');
  });
});

/* --- mutations-content --- */
suite('Store · deleteTeamMember', () => {
  test('removes exactly one row and reports the deletion', async () => {
    const before = await Store.listTeam();
    const res = await Store.deleteTeamMember('tm_kris');
    deepEq(res, { id: 'tm_kris', deleted: true }, 'delete should acknowledge with the id it removed');
    const after = await Store.listTeam();
    len(after, before.length - 1, 'exactly one member should be gone');
    notOk(after.some(t => t.id === 'tm_kris'), 'the deleted member should no longer appear in listTeam');
  });

  test('leaves the surviving members and their order intact', async () => {
    const before = await Store.listTeam();
    await Store.deleteTeamMember('tm_juan');
    const after = await Store.listTeam();
    deepEq(after.map(t => t.id), before.filter(t => t.id !== 'tm_juan').map(t => t.id),
      'the remaining roster should keep its original relative order');
    deepEq(after.find(t => t.id === 'tm_bobby'), before.find(t => t.id === 'tm_bobby'),
      'an untouched member should come back exactly as it was');
  });

  test('deleting an unknown id neither throws nor changes the roster', async () => {
    const before = await Store.listTeam();
    await Store.deleteTeamMember('tm_nobody');
    const after = await Store.listTeam();
    len(after, before.length, 'deleting a member that does not exist must not remove anybody');
    deepEq(after, before, 'a no-op delete must leave the roster exactly as it was');
  });

  test('deleting the same member twice is safe', async () => {
    await Store.deleteTeamMember('tm_cathy');
    const before = await Store.listTeam();
    await Store.deleteTeamMember('tm_cathy');
    deepEq(await Store.listTeam(), before, 'a repeated delete should be an idempotent no-op');
  });

  test('the removed member disappears from both team views', async () => {
    await Store.deleteTeamMember('tm_cathy');
    await refresh();
    len(qa('#teamGrid .member'), 4, 'the shop wall should be one card shorter');
    lacks(text('#teamGrid'), 'Cathy', 'the deleted member should be off the shop wall');
    lacks(text('#teamAdmin'), 'Cathy', 'the deleted member should be off the admin roster');
    has(text('#teamCount'), 'Four', 'the "N artisans" count should follow the roster size down');
  });

  test('the admin roster wires each row to its own member id', async () => {
    const rows = qa('#teamAdmin .tm-row');
    len(rows, 5, 'the admin roster should list every seeded member');
    const buttons = Array.from(rows[0].querySelectorAll('button'));
    eq(handlerArg(buttons[0], 'pickHeadshot'), 'tm_charlie', 'the upload button should target the row member');
    eq(handlerArg(buttons[1], 'openEditMember'), 'tm_charlie', 'the edit button should target the row member');
    eq(handlerArg(buttons[2], 'removeMember'), 'tm_charlie', 'the remove button should target the row member');
  });
});

/* --- mutations-content --- */
suite('Store · setTeamPhoto', () => {
  const URL_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
  const URL_B = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

  test('stores the data URL on the target member', async () => {
    const m = await Store.setTeamPhoto('tm_charlie', URL_A);
    eq(m.photoUrl, URL_A, 'setTeamPhoto should return the member carrying the new photo');
    const row = (await Store.listTeam()).find(t => t.id === 'tm_charlie');
    eq(row.photoUrl, URL_A, 'the photo should persist for later reads');
  });

  test('replacing a photo overwrites the previous one', async () => {
    await Store.setTeamPhoto('tm_charlie', URL_A);
    const m = await Store.setTeamPhoto('tm_charlie', URL_B);
    eq(m.photoUrl, URL_B, 'the second upload should replace the first, not append');
  });

  test('null clears the photo back to null', async () => {
    await Store.setTeamPhoto('tm_charlie', URL_A);
    const m = await Store.setTeamPhoto('tm_charlie', null);
    eq(m.photoUrl, null, 'passing null should clear the headshot');
    const row = (await Store.listTeam()).find(t => t.id === 'tm_charlie');
    eq(row.photoUrl, null, 'the cleared photo should stay cleared on re-read');
  });

  test('an empty string also clears the photo to null', async () => {
    await Store.setTeamPhoto('tm_charlie', URL_A);
    const m = await Store.setTeamPhoto('tm_charlie', '');
    eq(m.photoUrl, null, 'an empty payload means "no photo" and should normalise to null');
  });

  test('touches only the targeted member', async () => {
    const before = await Store.listTeam();
    await Store.setTeamPhoto('tm_bobby', URL_A);
    const after = await Store.listTeam();
    eq(after.find(t => t.id === 'tm_bobby').photoUrl, URL_A, 'the target should get the photo');
    deepEq(after.filter(t => t.id !== 'tm_bobby'), before.filter(t => t.id !== 'tm_bobby'),
      'no other member should be affected by a photo upload');
  });

  test('leaves the rest of the member record alone', async () => {
    const before = (await Store.listTeam()).find(t => t.id === 'tm_bobby');
    const after = await Store.setTeamPhoto('tm_bobby', URL_A);
    eq(after.name, before.name, 'a photo upload must not change the name');
    eq(after.initials, before.initials, 'a photo upload must not change the cached initials');
    eq(after.role, before.role, 'a photo upload must not change the role');
    eq(after.bio, before.bio, 'a photo upload must not change the bio');
    eq(after.sortOrder, before.sortOrder, 'a photo upload must not reorder the roster');
  });

  test('rejects an unknown member id', async () => {
    const err = await throwsAsync(() => Store.setTeamPhoto('tm_nobody', URL_A),
      'uploading to a member that does not exist should fail loudly');
    match(String(err.message), /not found/i, 'the error should say the team member was not found');
  });

  test('a stored photo replaces the initials in both team views', async () => {
    await Store.setTeamPhoto('tm_charlie', URL_A);
    await refresh();
    const card = qa('#teamGrid .member')[0];
    const img = card.querySelector('.photo img');
    ok(img, 'the shop wall should render an img once a headshot exists');
    eq(img.getAttribute('src'), URL_A, 'the card image should point at the stored data URL');
    eq(img.getAttribute('alt'), 'Charlie', 'the card image should be labelled with the member name');
    const row = qa('#teamAdmin .tm-row')[0];
    ok(row.querySelector('.tm-thumb img'), 'the admin thumbnail should show the photo');
    has(text(row), 'Photo set', 'the admin row should report that a photo exists');
    has(html(row), 'Replace photo', 'the upload button should offer replacement once a photo exists');
  });

  test('clearing a photo puts the initials back in both team views', async () => {
    await Store.setTeamPhoto('tm_charlie', URL_A);
    await refresh();
    await Store.setTeamPhoto('tm_charlie', null);
    await refresh();
    const card = qa('#teamGrid .member')[0];
    notOk(card.querySelector('.photo img'), 'the card should fall back to initials once the photo is cleared');
    has(text(card), 'Headshot', 'the placeholder "Headshot" tag should return');
    const row = qa('#teamAdmin .tm-row')[0];
    has(text(row), 'No photo yet', 'the admin row should report the member has no photo again');
    has(html(row), 'Upload headshot', 'the button should offer an upload again');
  });

  test('removeHeadshot() clears the photo through the admin UI', async () => {
    await Store.setTeamPhoto('tm_bobby', URL_A);
    await refresh();
    await removeHeadshot('tm_bobby');
    const row = (await Store.listTeam()).find(t => t.id === 'tm_bobby');
    eq(row.photoUrl, null, 'the Remove-photo control should clear the stored headshot');
    eq(state.team.find(t => t.id === 'tm_bobby').photoUrl, null, 'the refreshed state should show no photo');
  });
});

/* --- mutations-content --- */
suite('Store · slots', () => {
  test('attaches a new slot to the meeting it was added for', async () => {
    const row = await Store.addSlot('mtg_handbook', { when: 'Mon Aug 3 · 8:00 AM', host: 'Charlie · Owner' });
    match(row.id, /^slot_/, 'slot ids should keep the slot_ prefix');
    eq(row.meetingId, 'mtg_handbook', 'the slot should belong to the meeting it was created under');
    eq(row.when, 'Mon Aug 3 · 8:00 AM', 'the slot should carry the requested time label');
    eq(row.host, 'Charlie · Owner', 'the slot should carry the requested host');
  });

  test('the new slot shows up in listSlots for that meeting', async () => {
    const before = await Store.listSlots('mtg_handbook');
    const row = await Store.addSlot('mtg_handbook', { when: 'Mon Aug 3 · 8:00 AM', host: 'Charlie · Owner' });
    const after = await Store.listSlots('mtg_handbook');
    len(after, before.length + 1, 'the meeting should gain exactly one time');
    deepEq(after.slice(0, before.length), before, 'existing times should keep their order');
    eq(after[after.length - 1].id, row.id, 'the new time should be appended last');
  });

  test('adding a slot does not disturb the other meetings', async () => {
    const others = ['mtg_frontdesk', 'mtg_assistant', 'mtg_acd'];
    const before = {};
    for (const id of others) before[id] = await Store.listSlots(id);
    await Store.addSlot('mtg_handbook', { when: 'Mon Aug 3 · 8:00 AM', host: 'Charlie · Owner' });
    for (const id of others) deepEq(await Store.listSlots(id), before[id], `slots for ${id} should be untouched`);
  });

  test('slots added to different meetings stay separated', async () => {
    const a = await Store.addSlot('mtg_frontdesk', { when: 'Tue Aug 4 · 9:00 AM', host: 'Bobby · Manager' });
    const b = await Store.addSlot('mtg_acd', { when: 'Tue Aug 4 · 3:00 PM', host: 'Charlie · Owner' });
    const front = await Store.listSlots('mtg_frontdesk');
    const acd = await Store.listSlots('mtg_acd');
    ok(front.some(s => s.id === a.id), 'the front-desk time should be listed under the front-desk meeting');
    notOk(front.some(s => s.id === b.id), 'the ACD time must not leak into the front-desk list');
    ok(acd.some(s => s.id === b.id), 'the ACD time should be listed under the ACD meeting');
    notOk(acd.some(s => s.id === a.id), 'the front-desk time must not leak into the ACD list');
  });

  test('the new time renders on that meeting admin card only', async () => {
    await Store.addSlot('mtg_handbook', { when: 'Mon Aug 3 · 8:00 AM', host: 'Charlie · Owner' });
    await refresh();
    const cards = qa('#slotCards .card');
    len(cards, 4, 'there should be one scheduling card per meeting');
    has(text(cards[0]), 'Mon Aug 3 · 8:00 AM', 'the handbook card should list the new time');
    len(cards[0].querySelectorAll('.slot'), 3, 'the handbook card should now show three times');
    lacks(text(cards[1]), 'Mon Aug 3 · 8:00 AM', 'the front-desk card must not show the handbook time');
  });

  test('the admin "+ Add a time" button adds a pooled time for that meeting', async () => {
    const before = await Store.listSlots('mtg_handbook');
    await addSlot('mtg_handbook');                       // the UI helper, not Store.addSlot
    const after = await Store.listSlots('mtg_handbook');
    len(after, before.length + 1, 'the button should add exactly one time');
    const added = after[after.length - 1];
    has(SLOT_POOL, added.when, 'the added time should come from the prototype slot pool');
    notOk(before.some(s => s.when === added.when), 'the button should not add a duplicate of an existing time');
    eq(added.host, meetingTpl('mtg_handbook').defaultHost, 'a pooled time should use the meeting default host');
  });

  test('rejects a slot for a meeting that does not exist', async () => {
    const err = await throwsAsync(
      () => Store.addSlot('mtg_nope', { when: 'Mon Aug 3 · 8:00 AM', host: 'Charlie · Owner' }),
      'adding a time to an unknown meeting should fail rather than orphan the row');
    match(String(err.message), /not found/i, 'the error should say the meeting was not found');
  });
});

/* --- mutations-content --- */
suite('Store · updateMeeting', () => {
  test('changes the default host and persists it', async () => {
    const m = await Store.updateMeeting('mtg_handbook', { defaultHost: 'Kris · Barber' });
    eq(m.defaultHost, 'Kris · Barber', 'updateMeeting should return the meeting with its new host');
    const row = (await Store.listMeetings()).find(x => x.id === 'mtg_handbook');
    eq(row.defaultHost, 'Kris · Barber', 'the new host should persist for later reads');
  });

  test('does not clobber any other template field', async () => {
    const before = (await Store.listMeetings()).find(m => m.id === 'mtg_handbook');
    await Store.updateMeeting('mtg_handbook', { defaultHost: 'Kris · Barber' });
    const after = (await Store.listMeetings()).find(m => m.id === 'mtg_handbook');
    for (const key of Object.keys(before)) {
      if (key === 'defaultHost') continue;
      deepEq(after[key], before[key], `changing the host must leave "${key}" untouched`);
    }
  });

  test('leaves the other meetings alone', async () => {
    const before = (await Store.listMeetings()).filter(m => m.id !== 'mtg_handbook');
    await Store.updateMeeting('mtg_handbook', { defaultHost: 'Kris · Barber' });
    const after = (await Store.listMeetings()).filter(m => m.id !== 'mtg_handbook');
    deepEq(after, before, 'a host change on one meeting must not touch the others');
  });

  test('an empty patch leaves the meeting exactly as it was', async () => {
    const before = (await Store.listMeetings()).find(m => m.id === 'mtg_frontdesk');
    const after = await Store.updateMeeting('mtg_frontdesk', {});
    deepEq(after, before, 'an empty patch should be a no-op');
  });

  test('ignores fields outside the documented patch body', async () => {
    const before = (await Store.listMeetings()).find(m => m.id === 'mtg_acd');
    const after = await Store.updateMeeting('mtg_acd', { title: 'Renamed', roleOnly: true, sortOrder: 99 });
    eq(after.title, before.title, 'the meeting title is not editable through this endpoint');
    eq(after.roleOnly, before.roleOnly, 'eligibility rules must not be editable through the host patch');
    eq(after.sortOrder, before.sortOrder, 'step ordering must not be editable through the host patch');
  });

  test('rejects an unknown meeting id', async () => {
    const err = await throwsAsync(() => Store.updateMeeting('mtg_nope', { defaultHost: 'Kris · Barber' }),
      'patching a meeting that does not exist should fail loudly');
    match(String(err.message), /not found/i, 'the error should say the meeting was not found');
  });

  test('setMeetingHost() drives the change from the admin select', async () => {
    await setMeetingHost('mtg_frontdesk', 'Juan · Senior Stylist');
    eq(DB.meetings.find(m => m.id === 'mtg_frontdesk').defaultHost, 'Juan · Senior Stylist',
      'choosing a host in the admin UI should write through to the meeting template');
    eq(q('#host_mtg_frontdesk').value, 'Juan · Senior Stylist', 'the host select should re-render on the new value');
    eq(q('#host_mtg_handbook').value, 'Charlie · Owner', 'other meetings host selects should be unaffected');
  });

  test('a new default host is inherited by times added afterwards', async () => {
    await Store.updateMeeting('mtg_handbook', { defaultHost: 'Kris · Barber' });
    await refresh();
    await addSlot('mtg_handbook');
    const slots = await Store.listSlots('mtg_handbook');
    eq(slots[slots.length - 1].host, 'Kris · Barber', 'times added after a host change should use the new host');
    /* The admin UI offers no per-slot host control — every slot's host is a copy
       of the meeting default taken at creation. Leaving old slots behind meant
       the times listed under a meeting booked the previous host, so slots that
       still carry the old default move with it. A slot deliberately set to
       someone else would keep its own host. */
    eq(slots[0].host, 'Kris · Barber', 'times still on the old default follow the host change');
  });
});

/* --- mutations-content --- */
suite('Store · updateContent', () => {
  test('patches the welcome message without touching the training link', async () => {
    const before = await Store.getContent();
    const after = await Store.updateContent({ welcomeMessage: 'Welcome to the chair.' });
    eq(after.welcomeMessage, 'Welcome to the chair.', 'the welcome message should be updated');
    eq(after.trainingUrl, before.trainingUrl, 'patching the welcome message must not blank the training link');
  });

  test('patches the training link without touching the welcome message', async () => {
    const before = await Store.getContent();
    const after = await Store.updateContent({ trainingUrl: 'https://learn.example.com' });
    eq(after.trainingUrl, 'https://learn.example.com', 'the training link should be updated');
    eq(after.welcomeMessage, before.welcomeMessage, 'patching the training link must not blank the welcome message');
  });

  test('both fields can be patched in one call', async () => {
    const after = await Store.updateContent({ welcomeMessage: 'Hello.', trainingUrl: 'https://learn.example.com' });
    eq(after.welcomeMessage, 'Hello.', 'the welcome message should be updated');
    eq(after.trainingUrl, 'https://learn.example.com', 'the training link should be updated');
  });

  test('sequential single-field patches accumulate instead of overwriting', async () => {
    await Store.updateContent({ welcomeMessage: 'Hello.' });
    await Store.updateContent({ trainingUrl: 'https://learn.example.com' });
    const c = await Store.getContent();
    eq(c.welcomeMessage, 'Hello.', 'the earlier welcome edit should survive a later link edit');
    eq(c.trainingUrl, 'https://learn.example.com', 'the later link edit should be stored');
  });

  test('an empty patch changes nothing', async () => {
    const before = await Store.getContent();
    const after = await Store.updateContent({});
    deepEq(after, before, 'an empty patch should leave the content row exactly as it was');
  });

  test('explicitly undefined fields are ignored rather than blanked', async () => {
    const before = await Store.getContent();
    const after = await Store.updateContent({ welcomeMessage: undefined, trainingUrl: undefined });
    eq(after.welcomeMessage, before.welcomeMessage, 'an undefined welcome message must not blank the stored copy');
    eq(after.trainingUrl, before.trainingUrl, 'an undefined training link must not blank the stored URL');
  });

  test('an empty string is a real value and clears the field', async () => {
    const after = await Store.updateContent({ welcomeMessage: '' });
    eq(after.welcomeMessage, '', 'clearing the welcome message should store an empty string, not be ignored');
    neq(after.trainingUrl, '', 'clearing one field must not clear the other');
  });

  test('returns the whole singleton content row', async () => {
    const after = await Store.updateContent({ welcomeMessage: 'Hello.' });
    eq(after.id, 'singleton', 'content is a single settings row and keeps its id');
    ok('trainingUrl' in after, 'the response should carry the full row, not just the patched field');
  });

  test('the saved content reloads into the admin form', async () => {
    await Store.updateContent({ welcomeMessage: 'Hello.', trainingUrl: 'https://learn.example.com' });
    await refresh();
    eq(state.content.welcomeMessage, 'Hello.', 'refresh() should pull the new welcome message into state');
    eq(q('#welcomeTxt').value, 'Hello.', 'the admin textarea should show the saved welcome message');
    eq(q('#trainUrl').value, 'https://learn.example.com', 'the admin input should show the saved training link');
  });

  test('saveWelcome() writes the textarea through without dropping the link', async () => {
    const before = await Store.getContent();
    q('#welcomeTxt').value = 'Welcome to the chair.';
    await saveWelcome();
    const after = await Store.getContent();
    eq(after.welcomeMessage, 'Welcome to the chair.', 'Save changes should persist the edited welcome message');
    eq(after.trainingUrl, before.trainingUrl, 'saving the welcome message must not blank the training link');
  });

  test('saveTrainingLink() writes the input through without dropping the message', async () => {
    const before = await Store.getContent();
    q('#trainUrl').value = 'https://learn.example.com';
    await saveTrainingLink();
    const after = await Store.getContent();
    eq(after.trainingUrl, 'https://learn.example.com', 'Save link should persist the edited training URL');
    eq(after.welcomeMessage, before.welcomeMessage, 'saving the link must not blank the welcome message');
  });

  test('the saved welcome message reaches the employee home screen', async () => {
    await Store.updateContent({ welcomeMessage: 'Welcome to the chair, Jordan.' });
    await refresh();
    has(text('#s-home'), 'Welcome to the chair, Jordan.',
      'the welcome message an admin edits is what new hires should read on Home');
  });

  test('the saved training link reaches the employee training screen', async () => {
    await Store.updateContent({ trainingUrl: 'https://learn.example.com' });
    await refresh();
    has(html('#s-training'), 'https://learn.example.com',
      'the Training screen should surface the training URL the admin configured');
  });
});

/* --- invariants --- */
suite('Invariants · clone isolation', () => {

  test('listTeam() hands back a deep clone — mutating it cannot corrupt DB', async () => {
    const team = await Store.listTeam();
    const charlie = team.find(t => t.id === 'tm_charlie');
    ok(charlie, 'listTeam() should surface the seeded tm_charlie');
    charlie.name = 'MUTATED';
    charlie.specialties[0] = 'overwritten';
    charlie.specialties.push('injected');
    charlie.hostsMeetingIds.length = 0;

    const row = DB.team.find(t => t.id === 'tm_charlie');
    eq(row.name, 'Charlie', 'renaming a returned member must not rename the stored row');
    deepEq(row.specialties, ['Shop culture', 'Training support'], 'the nested specialties array must not be shared with the caller');
    deepEq(row.hostsMeetingIds, ['mtg_handbook', 'mtg_acd'], 'the nested hostsMeetingIds array must survive caller mutation');
  });

  test('a mutated listTeam() result does not leak into the next read', async () => {
    const first = await Store.listTeam();
    first[0].name = 'MUTATED';
    first[0].specialties.push('injected');
    const second = await Store.listTeam();
    eq(second[0].name, 'Charlie', 'the second read must come back from the untouched store');
    len(second[0].specialties, 2, 'the second read must not see the array the first caller grew');
  });

  test('two listTeam() reads return distinct identities, not the same reference', async () => {
    const a = await Store.listTeam();
    const b = await Store.listTeam();
    neq(a, b, 'each read should hand back a fresh array');
    neq(a[0], b[0], 'each read should hand back fresh row objects');
    neq(a[0].specialties, b[0].specialties, 'nested arrays should be fresh on every read');
    deepEq(a, b, 'distinct identities should still carry identical data');
  });

  test('listTeam() rows are never the stored rows themselves', async () => {
    const team = await Store.listTeam();
    for (const t of team) {
      const row = DB.team.find(x => x.id === t.id);
      neq(t, row, `${t.id} should be a clone, not the stored object`);
      neq(t.specialties, row.specialties, `${t.id}.specialties should be cloned, not aliased`);
    }
  });

  test('listMeetings() deep-clones the nested topics and prep arrays', async () => {
    const meetings = await Store.listMeetings();
    const handbook = meetings.find(m => m.id === 'mtg_handbook');
    handbook.title = 'MUTATED';
    handbook.topics[0] = 'overwritten';
    handbook.topics.push('injected topic');
    handbook.prep.length = 0;

    const stored = DB.meetings.find(m => m.id === 'mtg_handbook');
    eq(stored.title, 'Handbook Meeting', 'renaming a returned meeting must not rename the template');
    len(stored.topics, 6, 'pushing onto a returned topics array must not grow the stored meeting');
    eq(stored.topics[0], 'Meeting scheduling', 'the stored topics array must be untouched');
    len(stored.prep, 3, 'emptying a returned prep array must not empty the stored one');
  });

  test('two listMeetings() reads return distinct identities', async () => {
    const a = await Store.listMeetings();
    const b = await Store.listMeetings();
    neq(a, b, 'each read should hand back a fresh array');
    neq(a[0], b[0], 'each read should hand back fresh meeting objects');
    neq(a[0].topics, b[0].topics, 'the nested topics array should be fresh on every read');
    deepEq(a, b, 'distinct identities should still carry identical data');
  });

  test('getEmployee() returns a deep clone', async () => {
    const e = await Store.getEmployee('emp_jordan');
    e.name = 'MUTATED';
    e.progress = 999;
    e.eligibleForAsp = false;
    e.adminNotes = '';

    const stored = DB.employees.find(x => x.id === 'emp_jordan');
    eq(stored.name, 'Jordan Rivera', 'mutating a read result must not rename the stored employee');
    eq(stored.progress, 45, 'progress is server-owned and must not be writable through a read result');
    eq(stored.eligibleForAsp, true, 'eligibility must not be writable through a read result');
    neq(stored.adminNotes, '', 'admin notes must not be clearable through a read result');

    const again = await Store.getEmployee('emp_jordan');
    eq(again.name, 'Jordan Rivera', 'the next read must be unaffected by the previous caller');
    eq(again.progress, 45, 'the next read must be unaffected by the previous caller');
  });

  test('two getEmployee() reads return distinct identities', async () => {
    const a = await Store.getEmployee('emp_jordan');
    const b = await Store.getEmployee('emp_jordan');
    neq(a, b, 'each read should hand back a fresh object');
    neq(a, DB.employees.find(x => x.id === 'emp_jordan'), 'a read must never hand back the stored row');
    deepEq(a, b, 'distinct identities should still carry identical data');
  });

  test('getEmployee() never persists its derived nextStep onto the stored row', async () => {
    const e = await Store.getEmployee('emp_jordan');
    ok(e.nextStep, 'the read model should expose the derived nextStep');
    const stored = DB.employees.find(x => x.id === 'emp_jordan');
    notOk('nextStep' in stored, 'nextStep is derived per read and must never be written back to the employees table');
    await Store.listEmployees();
    notOk('nextStep' in stored, 'listEmployees() must not write its derived nextStep back either');
  });

  test('listEmployeeMeetings() deep-clones the template it merges in', async () => {
    const mine = await Store.listEmployeeMeetings('emp_jordan');
    const handbook = mine.find(m => m.meetingId === 'mtg_handbook');
    handbook.topics.push('injected');
    handbook.prep[0] = 'overwritten';
    handbook.status = 'pending';
    handbook.when = null;

    const tpl = DB.meetings.find(m => m.id === 'mtg_handbook');
    len(tpl.topics, 6, 'the merged summary must not alias the template topics array');
    eq(tpl.prep[0], 'A valid photo ID for your I-9', 'the merged summary must not alias the template prep array');

    const inst = DB.employeeMeetings.find(x => x.employeeId === 'emp_jordan' && x.meetingId === 'mtg_handbook');
    eq(inst.status, 'complete', 'status must not be writable through a read result');
    neq(inst.when, null, 'the booked time must not be erasable through a read result');
  });

  test('two listEmployeeMeetings() reads return distinct identities', async () => {
    const a = await Store.listEmployeeMeetings('emp_jordan');
    const b = await Store.listEmployeeMeetings('emp_jordan');
    neq(a, b, 'each read should hand back a fresh array');
    neq(a[0], b[0], 'each read should hand back fresh summary objects');
    neq(a[0].topics, b[0].topics, 'the nested topics array should be fresh on every read');
    deepEq(a, b, 'distinct identities should still carry identical data');
  });

  test('getChecklist() deep-clones its nested items arrays', async () => {
    const list = await Store.getChecklist('emp_jordan');
    const employment = list.find(g => g.id === 'grp_employment');
    const before = employment.items.length;
    employment.title = 'MUTATED';
    employment.items[0].label = 'MUTATED';
    employment.items[0].done = false;
    employment.items.push({ id: 'itm_injected', label: 'nope', done: true, locked: false });

    const again = await Store.getChecklist('emp_jordan');
    const fresh = again.find(g => g.id === 'grp_employment');
    eq(fresh.title, 'Employment requirements', 'the group title must come from the untouched template');
    len(fresh.items, before, 'pushing onto a returned items array must not grow the group');
    eq(fresh.items[0].id, 'itm_i9', 'the first item must still be the seeded one');
    eq(fresh.items[0].label, 'Form I-9 process', 'relabelling a returned item must not rewrite the template');
    eq(fresh.items[0].done, true, 'flipping a returned item must not rewrite checklist_state');
    notOk(DB.checklistItems.some(it => it.id === 'itm_injected'), 'pushing into the returned items must never insert a template row');
  });

  test('two getChecklist() reads return distinct identities', async () => {
    const a = await Store.getChecklist('emp_jordan');
    const b = await Store.getChecklist('emp_jordan');
    neq(a, b, 'each read should hand back a fresh array');
    neq(a[0], b[0], 'each read should hand back fresh group objects');
    neq(a[0].items, b[0].items, 'the nested items array should be fresh on every read');
    neq(a[0].items[0], b[0].items[0], 'the item objects themselves should be fresh on every read');
    deepEq(a, b, 'distinct identities should still carry identical data');
  });

  test('getContent() and listSlots() also return clones', async () => {
    const content = await Store.getContent();
    content.welcomeMessage = 'MUTATED';
    content.trainingUrl = 'https://evil.example';
    neq(DB.content.welcomeMessage, 'MUTATED', 'the settings row must not be writable through a read');
    eq(DB.content.trainingUrl, 'https://training.artisanbarber.com', 'the settings row must not be writable through a read');

    const slots = await Store.listSlots('mtg_handbook');
    len(slots, 2, 'the handbook meeting has two seeded times');
    slots[0].when = 'MUTATED';
    slots.push({ id: 'slot_injected', meetingId: 'mtg_handbook', when: 'never', host: 'nobody' });
    eq(DB.slots.find(s => s.id === 'slot_1').when, 'Thu Jul 16 · 10:00 AM', 'editing a returned slot must not edit the stored one');
    notOk(DB.slots.some(s => s.id === 'slot_injected'), 'pushing onto a returned slot list must not insert a row');
  });

  test('mutations return clones too', async () => {
    const member = await Store.updateTeamMember('tm_kris', { role: 'Master Barber' });
    eq(DB.team.find(t => t.id === 'tm_kris').role, 'Master Barber', 'the patch should have been applied');
    member.role = 'MUTATED';
    member.specialties.push('injected');
    eq(DB.team.find(t => t.id === 'tm_kris').role, 'Master Barber', 'the returned resource must be a clone, not the stored row');
    len(DB.team.find(t => t.id === 'tm_kris').specialties, 2, 'nested arrays on a mutation result must be cloned too');

    const inst = await Store.completeEmployeeMeeting('emp_jordan', 'mtg_acd');
    inst.status = 'pending';
    eq(DB.employeeMeetings.find(x => x.employeeId === 'emp_jordan' && x.meetingId === 'mtg_acd').status, 'complete',
      'the returned instance must be a clone, not the stored row');
  });

  test('reads sort a copy and never reorder the stored tables', async () => {
    DB.meetings.reverse();
    DB.team.reverse();
    DB.checklistGroups.reverse();
    const meetingOrder = DB.meetings.map(m => m.id);
    const teamOrder = DB.team.map(t => t.id);
    const groupOrder = DB.checklistGroups.map(g => g.id);

    const meetings = await Store.listMeetings();
    const team = await Store.listTeam();
    const groups = await Store.getChecklist('emp_jordan');

    deepEq(meetings.map(m => m.id), ['mtg_handbook', 'mtg_frontdesk', 'mtg_assistant', 'mtg_acd'], 'listMeetings() must order by sortOrder');
    deepEq(team.map(t => t.id), ['tm_charlie', 'tm_bobby', 'tm_juan', 'tm_kris', 'tm_cathy'], 'listTeam() must order by sortOrder');
    deepEq(groups.map(g => g.id), ['grp_employment', 'grp_setup', 'grp_meetings', 'grp_training'], 'getChecklist() must order groups by sortOrder');

    deepEq(DB.meetings.map(m => m.id), meetingOrder, 'reading must not reorder DB.meetings in place');
    deepEq(DB.team.map(t => t.id), teamOrder, 'reading must not reorder DB.team in place');
    deepEq(DB.checklistGroups.map(g => g.id), groupOrder, 'reading must not reorder DB.checklistGroups in place');
  });

  test('state holds clones, never live DB rows', async () => {
    const storedMe = DB.employees.find(e => e.id === CURRENT_USER);
    const storedCharlie = DB.team.find(t => t.id === 'tm_charlie');
    neq(state.me.employee, storedMe, 'state.me.employee should be a clone of the stored row');
    neq(state.team[0], storedCharlie, 'state.team rows should be clones of the stored rows');

    state.me.employee.progress = 999;
    state.team[0].name = 'MUTATED';
    state.me.checklist[0].items[0].done = false;

    eq(storedMe.progress, 45, 'writing to state must never reach the employees table');
    eq(storedCharlie.name, 'Charlie', 'writing to state must never reach the team table');
    eq(DB.checklistState.find(s => s.employeeId === CURRENT_USER && s.itemId === 'itm_i9').done, true,
      'writing to state must never reach checklist_state');
  });
});

/* --- invariants --- */
suite('Invariants · progress derivation', () => {
  const emp = id => DB.employees.find(e => e.id === id);
  const progressOf = async id => (await Store.getEmployee(id)).progress;

  test('follows 20 + 80 × (completed ÷ applicable) at every step', async () => {
    len(_applicableMeetings(emp('emp_sam')), 4, 'seed check: Sam is ASP-eligible, so four meetings apply');
    await Store.completeEmployeeMeeting('emp_sam', 'mtg_handbook');
    eq(await progressOf('emp_sam'), 40, '1 of 4 complete should be 20 + 80×(1/4)');
    await Store.completeEmployeeMeeting('emp_sam', 'mtg_frontdesk');
    eq(await progressOf('emp_sam'), 60, '2 of 4 complete should be 20 + 80×(2/4)');
    await Store.completeEmployeeMeeting('emp_sam', 'mtg_assistant');
    eq(await progressOf('emp_sam'), 80, '3 of 4 complete should be 20 + 80×(3/4)');
    await Store.completeEmployeeMeeting('emp_sam', 'mtg_acd');
    eq(await progressOf('emp_sam'), 100, '4 of 4 complete should be 20 + 80×(4/4)');
  });

  test('the denominator really is the applicable count', async () => {
    /* Same start line for both, but Sam has four applicable meetings and Maya three,
       so one identical completion has to be worth more to Maya. */
    for (const row of DB.employeeMeetings) { row.status = 'pending'; row.when = null; }
    emp('emp_sam').progress = 0;
    emp('emp_maya').progress = 0;

    await Store.completeEmployeeMeeting('emp_sam', 'mtg_handbook');
    await Store.completeEmployeeMeeting('emp_maya', 'mtg_handbook');

    eq(await progressOf('emp_sam'), 40, 'ASP-eligible: 1 of 4 applicable → 20 + 80×(1/4)');
    eq(await progressOf('emp_maya'), 47, 'not eligible: 1 of 3 applicable → 20 + 80×(1/3), rounded');
    neq(await progressOf('emp_sam'), await progressOf('emp_maya'), 'the applicable count must change the result');
  });

  test('is monotonic — a recomputation below the stored value never lowers it', async () => {
    eq(emp('emp_maya').progress, 80, 'seed check: Maya is stored at 80');
    /* Maya has 2 of 3 applicable meetings complete, so the formula computes 73. */
    await Store.completeEmployeeMeeting('emp_maya', 'mtg_handbook');   // already complete — no new credit
    eq(await progressOf('emp_maya'), 80, 'progress must never drop below what is already stored');
  });

  test('is monotonic — a lower computed value cannot claw back credit', async () => {
    emp('emp_sam').progress = 90;                                     // credited by some other path
    await Store.completeEmployeeMeeting('emp_sam', 'mtg_handbook');   // computes 40
    eq(await progressOf('emp_sam'), 90, 'a completion must never reduce progress');
  });

  test('reaches exactly 100 when every applicable meeting is complete', async () => {
    for (const m of _applicableMeetings(emp('emp_jordan'))) {
      await Store.completeEmployeeMeeting('emp_jordan', m.id);
    }
    eq(await progressOf('emp_jordan'), 100, 'a fully complete journey should read 100, not more');
  });

  test('never exceeds 100', async () => {
    await Store.completeEmployeeMeeting('emp_maya', 'mtg_acd');        // 3 of 3 applicable → 100
    eq(await progressOf('emp_maya'), 100, 'all three applicable meetings complete should be 100');
    /* The route that used to push progress past 100 is now closed at the source:
       a role-only step cannot be completed for someone who is not eligible. */
    await throwsAsync(() => Store.completeEmployeeMeeting('emp_maya', 'mtg_assistant'),
      'a role-only meeting must not be completable for an ineligible employee');
    lte(await progressOf('emp_maya'), 100, 'progress is a 0..100 value and must be capped');
  });

  test('counts completed APPLICABLE meetings only in the numerator', async () => {
    emp('emp_maya').progress = 0;
    /* Maya has two of her three applicable meetings complete in the seed.
       Re-completing one is idempotent but still recomputes progress. */
    await Store.completeEmployeeMeeting('emp_maya', 'mtg_handbook');
    eq(await progressOf('emp_maya'), 73,
      'only Maya’s two applicable completions should count: 20 + 80×(2/3)');
    /* And an instance for a step she is not eligible for cannot be created at
       all, so it can never reach the numerator. */
    await throwsAsync(() => Store.completeEmployeeMeeting('emp_maya', 'mtg_assistant'));
    eq(await progressOf('emp_maya'), 73, 'a refused completion must not move progress');
  });

  test('is always a whole number inside 0..100', async () => {
    await Store.completeEmployeeMeeting('emp_maya', 'mtg_acd');
    for (const e of await Store.listEmployees()) {
      eq(e.progress, Math.round(e.progress), `${e.id}: progress should be a whole percentage`);
      gte(e.progress, 0, `${e.id}: progress should not be negative`);
      lte(e.progress, 100, `${e.id}: progress should not exceed 100`);
    }
  });

  test('assign-program widens the denominator for later completions', async () => {
    await Store.assignProgram('emp_maya');
    len(_applicableMeetings(emp('emp_maya')), 4, 'assigning the program makes the role-only step applicable');
    await Store.completeEmployeeMeeting('emp_maya', 'mtg_acd');
    eq(await progressOf('emp_maya'), 80, '3 of 4 applicable → 20 + 80×(3/4)');
  });

  test('without the program that same completion finishes the journey', async () => {
    await Store.completeEmployeeMeeting('emp_maya', 'mtg_acd');
    eq(await progressOf('emp_maya'), 100, '3 of 3 applicable → 100, proving the denominator moved');
  });

  test('only mutations move progress — reads are side-effect free', async () => {
    const before = JSON.stringify(DB);
    await Store.getContent();
    await Store.listTeam();
    await Store.listMeetings();
    await Store.listSlots('mtg_acd');
    await Store.listEmployees();
    await Store.getEmployee('emp_jordan');
    await Store.listEmployeeMeetings('emp_jordan');
    await Store.listEmployeeMeetings('emp_maya', true);
    await Store.getChecklist('emp_jordan');
    await refresh();
    eq(JSON.stringify(DB), before, 'no read path, and no render pass, may write to the database');
  });
});

/* --- invariants --- */
suite('Invariants · next step', () => {
  const emp = id => DB.employees.find(e => e.id === id);

  test('returns the first non-complete applicable step in step order', () => {
    eq(_nextStep(emp('emp_jordan')), 'Step II · Front Desk & Concierge',
      'Jordan finished step I, so step II is next');
  });

  test('formats as "Step <roman> · <shortTitle>"', () => {
    match(_nextStep(emp('emp_sam')), /^Step [IVX]+ · \S/, 'the next step should read as roman numeral plus short title');
    eq(_nextStep(emp('emp_sam')), 'Step I · Handbook Meeting', 'a scheduled-but-not-complete step is still the next step');
  });

  test('returns "Complete" once every applicable step is done', () => {
    eq(_nextStep(emp('emp_leo')), 'Complete', 'Leo has completed all three of his applicable meetings');
  });

  test('skips a role-only step for an employee who is not eligible', () => {
    eq(_nextStep(emp('emp_maya')), 'Step IV · Continued Development intro',
      'step III is role-only and Maya is not eligible, so it must be skipped');
  });

  test('an ineligible employee reads Complete without ever touching the role-only step', async () => {
    await Store.completeEmployeeMeeting('emp_maya', 'mtg_acd');
    eq(_nextStep(emp('emp_maya')), 'Complete', 'the skipped role-only step must not block completion');
    notOk(_instances('emp_maya').some(i => i.meetingId === 'mtg_assistant'), 'no instance should exist for a skipped step');
  });

  test('surfaces the role-only step for an eligible employee', async () => {
    await Store.completeEmployeeMeeting('emp_jordan', 'mtg_frontdesk');
    eq(_nextStep(emp('emp_jordan')), 'Step III · Assistant Stylist Program',
      'Jordan is eligible, so the role-only step is part of his journey');
  });

  test('a step with no instance row at all still counts as incomplete', () => {
    const i = DB.employeeMeetings.findIndex(x => x.employeeId === 'emp_jordan' && x.meetingId === 'mtg_frontdesk');
    DB.employeeMeetings.splice(i, 1);
    eq(_nextStep(emp('emp_jordan')), 'Step II · Front Desk & Concierge', 'a missing instance is not a completed step');
  });

  test('follows sortOrder, not the row order of the meetings table', () => {
    DB.meetings.reverse();
    eq(_nextStep(emp('emp_jordan')), 'Step II · Front Desk & Concierge', 'step order comes from sortOrder, not array position');
  });

  test('assign-program reopens the journey with the newly applicable step', async () => {
    await Store.completeEmployeeMeeting('emp_maya', 'mtg_acd');
    eq(_nextStep(emp('emp_maya')), 'Complete', 'precondition: Maya is finished before the program is assigned');
    await Store.assignProgram('emp_maya');
    eq(_nextStep(emp('emp_maya')), 'Step III · Assistant Stylist Program', 'a newly applicable step becomes the next step');
  });

  test('the value Store publishes matches the helper for every employee', async () => {
    const list = await Store.listEmployees();
    len(list, 4, 'seed check: four employees on the roster');
    for (const row of list) {
      eq(row.nextStep, _nextStep(emp(row.id)), `listEmployees() nextStep for ${row.id} should mirror _nextStep`);
      eq((await Store.getEmployee(row.id)).nextStep, row.nextStep, `getEmployee(${row.id}).nextStep should agree with the roster`);
    }
  });
});

/* --- invariants --- */
suite('Invariants · applicable meetings', () => {
  const emp = id => DB.employees.find(e => e.id === id);
  const ALL = ['mtg_handbook', 'mtg_frontdesk', 'mtg_assistant', 'mtg_acd'];

  test('includes the role-only step only for an eligible employee', () => {
    deepEq(_applicableMeetings(emp('emp_jordan')).map(m => m.id), ALL, 'an eligible employee gets all four steps');
    deepEq(_applicableMeetings(emp('emp_maya')).map(m => m.id), ['mtg_handbook', 'mtg_frontdesk', 'mtg_acd'],
      'an ineligible employee must not be assigned the role-only step');
  });

  test('always comes back sorted by sortOrder', () => {
    DB.meetings.reverse();
    deepEq(_applicableMeetings(emp('emp_jordan')).map(m => m.id), ALL, 'sortOrder decides the order, not the table order');
    const orders = _applicableMeetings(emp('emp_maya')).map(m => m.sortOrder);
    deepEq(orders, orders.slice().sort((a, b) => a - b), 'sortOrder should come back ascending');
  });

  test('never reorders or mutates the meetings table', () => {
    const before = DB.meetings.map(m => m.id);
    _applicableMeetings(emp('emp_maya'));
    _applicableMeetings(emp('emp_jordan'));
    deepEq(DB.meetings.map(m => m.id), before, 'the helper must sort a copy, not the table');
    len(DB.meetings, 4, 'the helper must not add or drop template rows');
  });

  test('returns a fresh array on every call', () => {
    const a = _applicableMeetings(emp('emp_jordan'));
    const b = _applicableMeetings(emp('emp_jordan'));
    neq(a, b, 'each call should build its own array');
    a.length = 0;
    len(_applicableMeetings(emp('emp_jordan')), 4, 'emptying one result must not affect the next call');
  });

  test('assign-program flips the applicable set and creates exactly one instance', async () => {
    len(_applicableMeetings(emp('emp_maya')), 3, 'seed check: Maya starts with three applicable meetings');
    await Store.assignProgram('emp_maya');
    len(_applicableMeetings(emp('emp_maya')), 4, 'assigning the program adds the role-only step');
    len(_instances('emp_maya').filter(i => i.meetingId === 'mtg_assistant'), 1, 'exactly one instance row should be created');
    await Store.assignProgram('emp_maya');
    len(_instances('emp_maya').filter(i => i.meetingId === 'mtg_assistant'), 1, 'assign-program must be idempotent');
  });

  test('listEmployeeMeetings() returns exactly the applicable meetings', async () => {
    const mine = await Store.listEmployeeMeetings('emp_maya');
    deepEq(mine.map(m => m.meetingId), _applicableMeetings(emp('emp_maya')).map(m => m.id),
      'the default view is the applicable set, in sortOrder');
    ok(mine.every(m => m.applicable === true), 'every row in the default view is applicable');
    notOk(mine.some(m => m.status === 'na'), 'the default view never contains a not-required step');
  });

  test('listEmployeeMeetings(includeAll) adds the non-applicable step as "na"', async () => {
    const all = await Store.listEmployeeMeetings('emp_maya', true);
    deepEq(all.map(m => m.meetingId), ALL, 'include=all still comes back in sortOrder');
    const roleOnly = all.find(m => m.meetingId === 'mtg_assistant');
    eq(roleOnly.applicable, false, 'the role-only step is not applicable to Maya');
    eq(roleOnly.status, 'na', 'a non-applicable step reports status "na" so the admin can assign it');
    eq(roleOnly.hasInstance, false, 'no instance row should exist for a non-applicable step');
  });

  test('the employee view and the admin view agree for an eligible employee', async () => {
    const mine = await Store.listEmployeeMeetings('emp_jordan');
    const all = await Store.listEmployeeMeetings('emp_jordan', true);
    deepEq(mine.map(m => m.meetingId), all.map(m => m.meetingId), 'an eligible employee has nothing extra to reveal');
    ok(all.every(m => m.applicable === true), 'every step applies to an eligible employee');
    notOk(all.some(m => m.status === 'na'), 'no step should read "na" for an eligible employee');
  });
});

/* --- invariants --- */
suite('Invariants · async data seam', () => {

  test('every Store method is an async function', () => {
    const names = Object.keys(Store);
    gte(names.length, 20, 'sanity check: Store should expose the whole documented API surface');
    for (const n of names) {
      eq(typeof Store[n], 'function', `Store.${n} should be a function`);
      eq(Store[n].constructor.name, 'AsyncFunction', `Store.${n} must be async so its body can become a fetch()`);
    }
  });

  test('reads return a promise, not a value', async () => {
    const p = Store.listTeam();
    ok(p instanceof Promise, 'listTeam() should return a Promise');
    notOk(Array.isArray(p), 'the array must only be reachable after awaiting');
    ok(Array.isArray(await p), 'awaiting should yield the array');
  });

  test('mutations return a promise resolving to the affected resource', async () => {
    const p = Store.setTrainingAccess('emp_sam', true);
    ok(p instanceof Promise, 'setTrainingAccess() should return a Promise');
    const row = await p;
    eq(row.id, 'emp_sam', 'a mutation returns the affected resource so the client can re-render');
    eq(row.trainingAccess, true, 'the returned resource reflects the write');
  });

  test('render functions are synchronous and read only from state', async () => {
    DB.team.push({ id: 'tm_ghost', sortOrder: 99, name: 'Ghost', initials: 'G', role: 'Phantom',
      experience: '', photoUrl: null, bio: 'Never fetched.', specialties: [], hostsMeetingIds: [] });
    eq(renderAll(), undefined, 'renderAll() is synchronous and returns nothing');
    len(qa('#teamGrid .member'), 5, 'a DB row nobody fetched must not reach the screen');
    len(state.team, 5, 'state should still hold what the last refresh() fetched');
    await refresh();
    len(qa('#teamGrid .member'), 6, 'after refresh() the row is in state and therefore on screen');
  });

  test('refresh() is the single async boundary that repopulates state', async () => {
    await Store.setEmployeeNotes(CURRENT_USER, 'note written straight to the store');
    neq(state.me.employee.adminNotes, 'note written straight to the store', 'state should be stale until refresh() runs');
    await refresh();
    eq(state.me.employee.adminNotes, 'note written straight to the store', 'refresh() should pull the write back into state');
  });
});

/* --- invariants --- */
suite('Invariants · derived checklist group', () => {
  const emp = id => DB.employees.find(e => e.id === id);
  const autoOf = list => list.find(g => g.kind === 'auto');

  /* The auto group is a view over employee_meetings; assert it line by line. */
  async function assertAgrees(empId, when) {
    const group = autoOf(await Store.getChecklist(empId));
    ok(group, `${when}: an auto group should exist`);
    deepEq(group.items.map(i => i.id), _applicableMeetings(emp(empId)).map(m => 'meeting:' + m.id),
      `${when}: the auto group mirrors the applicable meetings, in order`);
    for (const it of group.items) {
      const meetingId = it.id.slice('meeting:'.length);
      const inst = _instances(empId).find(i => i.meetingId === meetingId);
      const status = inst ? inst.status : 'pending';
      eq(it.status, status, `${when}: ${meetingId} should report the stored instance status`);
      eq(it.done, status === 'complete', `${when}: ${meetingId} done must equal (status === 'complete')`);
      eq(it.locked, true, `${when}: ${meetingId} is derived, so it must be read-only`);
    }
    return group;
  }

  test('agrees with the seeded meeting statuses', async () => {
    const group = await assertAgrees(CURRENT_USER, 'seed');
    len(group.items, 4, 'Jordan is eligible, so four meetings are tracked');
    deepEq(group.items.map(i => i.done), [true, false, false, false], 'only the handbook meeting is complete in the seed');
  });

  test('still agrees after a completion', async () => {
    await Store.completeEmployeeMeeting(CURRENT_USER, 'mtg_frontdesk');
    const group = await assertAgrees(CURRENT_USER, 'after complete');
    eq(group.items[1].done, true, 'completing step II should tick its derived line');
  });

  test('still agrees after scheduling', async () => {
    await Store.scheduleEmployeeMeeting(CURRENT_USER, 'mtg_acd', 'Fri Jul 17 · 4:00 PM');
    const group = await assertAgrees(CURRENT_USER, 'after schedule');
    eq(group.items[3].status, 'scheduled', 'the derived line should follow the instance to "scheduled"');
    eq(group.items[3].done, false, 'a scheduled meeting is not a completed checklist line');
  });

  test('still agrees after assign-program', async () => {
    len(autoOf(await Store.getChecklist('emp_maya')).items, 3, 'seed check: Maya is not eligible for the role-only step');
    await Store.assignProgram('emp_maya');
    const group = await assertAgrees('emp_maya', 'after assign-program');
    len(group.items, 4, 'assigning the program adds a tracked line');
    has(group.items.map(i => i.id), 'meeting:mtg_assistant', 'the newly applicable meeting should appear');
  });

  test('tracks only applicable meetings, whatever instances exist', async () => {
    await throwsAsync(() => Store.completeEmployeeMeeting('emp_maya', 'mtg_assistant'),
      'a non-applicable step cannot be completed');
    const group = await assertAgrees('emp_maya', 'after a refused non-applicable completion');
    len(group.items, 3, 'a completion against a non-applicable step must not add a checklist line');
  });

  test('has no template or state rows behind it', () => {
    const g = DB.checklistGroups.find(x => x.kind === 'auto');
    eq(g.id, 'grp_meetings', 'grp_meetings is the derived group');
    notOk(DB.checklistItems.some(it => it.groupId === g.id), 'the auto group is a view, so it owns no checklist_items rows');
    notOk(DB.checklistState.some(s => String(s.itemId).indexOf('meeting:') === 0), 'no checklist_state rows should exist for derived lines');
  });

  test('locked tracks the group kind for every line', async () => {
    for (const g of await Store.getChecklist(CURRENT_USER)) {
      for (const it of g.items) {
        eq(it.locked, g.kind === 'auto', `${g.id}/${it.id}: only derived lines may be locked`);
      }
    }
  });

  test('a manual write cannot fake a derived line', async () => {
    await throwsAsync(() => Store.setChecklistItem(CURRENT_USER, 'meeting:mtg_acd', true),
      'a derived line is not a writable endpoint');
    const item = autoOf(await Store.getChecklist(CURRENT_USER)).items.find(i => i.id === 'meeting:mtg_acd');
    eq(item.done, false, 'a derived line stays false until the meeting itself is completed');
    eq(item.status, 'pending', 'a derived line reports the meeting status, never stored state');
  });

  test('a write to a derived line is not stored', async () => {
    await throwsAsync(() => Store.setChecklistItem(CURRENT_USER, 'meeting:mtg_acd', true));
    notOk(DB.checklistState.some(s => s.itemId === 'meeting:mtg_acd'),
      'meeting:* items are not writable, so no checklist_state row should be created');
  });

  test('the rendered checklist shows derived lines as read-only and in sync', async () => {
    go('s-checklist');
    len(qa('#checkGroups .check-group'), 4, 'all four groups should render');
    const locked = qa('#checkGroups .check-item input[disabled]');
    len(locked, 4, 'the four derived lines render as disabled checkboxes');
    eq(locked.filter(b => b.checked).length, 1, 'only the completed meeting is ticked in the seed');
    await Store.completeEmployeeMeeting(CURRENT_USER, 'mtg_frontdesk');
    await refresh();
    eq(qa('#checkGroups .check-item input[disabled]').filter(b => b.checked).length, 2,
      'completing a meeting should tick its derived line on screen');
  });

  test('derived lines feed the same progress counter as manual ones', async () => {
    const before = progressCounts();
    eq(before.total, 22, '18 manual items plus 4 derived meeting lines');
    eq(before.done, 6, '5 seeded manual items plus the completed handbook meeting');
    await Store.completeEmployeeMeeting(CURRENT_USER, 'mtg_acd');
    await refresh();
    const after = progressCounts();
    eq(after.total, 22, 'completing a meeting must not change the item count');
    eq(after.done, before.done + 1, 'a derived line moves the same counter manual items use');
  });
});

/* --- invariants --- */
suite('Invariants · referential integrity', () => {

  test('every employee_meetings row points at a real employee and a real meeting', async () => {
    await Store.completeEmployeeMeeting('emp_sam', 'mtg_acd');
    await Store.assignProgram('emp_maya');
    await Store.scheduleEmployeeMeeting('emp_leo', 'mtg_acd', 'Mon Jul 20 · 9:00 AM');
    for (const row of DB.employeeMeetings) {
      ok(DB.employees.some(e => e.id === row.employeeId), `row ${row.id} references unknown employee ${row.employeeId}`);
      ok(DB.meetings.some(m => m.id === row.meetingId), `row ${row.id} references unknown meeting ${row.meetingId}`);
    }
  });

  test('at most one employee_meetings row per (employee, meeting)', async () => {
    await Store.scheduleEmployeeMeeting('emp_maya', 'mtg_acd', 'Mon Jul 20 · 9:00 AM');
    await Store.completeEmployeeMeeting('emp_maya', 'mtg_acd');
    await Store.acknowledgeEmployeeMeeting('emp_maya', 'mtg_acd');
    await Store.assignProgram('emp_maya');
    await Store.assignProgram('emp_maya');
    const seen = new Set();
    for (const row of DB.employeeMeetings) {
      const key = row.employeeId + '|' + row.meetingId;
      notOk(seen.has(key), `duplicate employee_meetings row for ${key}`);
      seen.add(key);
    }
  });

  test('mutations never create rows for ids that do not exist', async () => {
    try { await Store.scheduleEmployeeMeeting('emp_nobody', 'mtg_handbook', 'Thu Jul 16 · 10:00 AM'); } catch (_) { /* rejecting is the right outcome */ }
    try { await Store.scheduleEmployeeMeeting(CURRENT_USER, 'mtg_nope', 'Thu Jul 16 · 10:00 AM'); } catch (_) { /* rejecting is the right outcome */ }
    notOk(DB.employeeMeetings.some(r => r.employeeId === 'emp_nobody'), 'no row may reference an unknown employee');
    notOk(DB.employeeMeetings.some(r => r.meetingId === 'mtg_nope'), 'no row may reference an unknown meeting');
  });

  test('a mutation that throws leaves no half-written row behind', async () => {
    const rows = DB.employeeMeetings.length;
    await throwsAsync(() => Store.completeEmployeeMeeting('emp_nobody', 'mtg_handbook'),
      'completing a meeting for an unknown employee must fail');
    eq(DB.employeeMeetings.length, rows, 'a failed mutation must not grow the employee_meetings table');
    notOk(DB.employeeMeetings.some(r => r.employeeId === 'emp_nobody'), 'the row written before the failure must be rolled back');
  });

  test('newId() never reuses an id already in the database', async () => {
    const a = await Store.addSlot('mtg_acd', { when: 'Thu Jul 16 · 4:30 PM', host: 'Charlie · Owner' });
    const b = await Store.addSlot('mtg_acd', { when: 'Fri Jul 17 · 11:30 AM', host: 'Charlie · Owner' });
    neq(a.id, b.id, 'two inserts must not collide');
    const ids = DB.slots.map(s => s.id);
    eq(new Set(ids).size, ids.length, 'slot ids must stay unique');
    const teamIds = DB.team.map(t => t.id);
    eq(new Set(teamIds).size, teamIds.length, 'team ids must stay unique');
  });
});

/* --- helpers --- */
suite('Helpers · initialsOf', () => {
  test('a single word takes its first two letters, uppercased', () => {
    eq(initialsOf('Charlie'), 'CH', 'one-word names slice two characters off the front');
    eq(initialsOf('Kris'), 'KR', 'one-word names slice two characters off the front');
  });

  test('two words take the first letter of each', () => {
    eq(initialsOf('Juan Hernandez'), 'JH', 'two words should give one initial each');
    eq(initialsOf('Maya Chen'), 'MC', 'two words should give one initial each');
  });

  test('three or more words still use only the first two words', () => {
    eq(initialsOf('Mary Jane Watson'), 'MJ', 'extra words beyond the second are ignored');
    eq(initialsOf('Jean Luc Picard Jr'), 'JL', 'extra words beyond the second are ignored');
  });

  test('collapses extra internal whitespace between words', () => {
    eq(initialsOf('Ana    Lopez'), 'AL', 'runs of spaces should not create empty name parts');
    eq(initialsOf('Ana\tLopez'), 'AL', 'tabs count as whitespace between name parts');
    eq(initialsOf('Ana\nLopez'), 'AL', 'newlines count as whitespace between name parts');
  });

  test('ignores leading and trailing whitespace', () => {
    eq(initialsOf('   Ana Lopez   '), 'AL', 'surrounding whitespace should be trimmed first');
    eq(initialsOf('  Charlie  '), 'CH', 'a padded single word still slices two characters');
  });

  test('an empty string falls back to the placeholder', () => {
    eq(initialsOf(''), '?', 'an empty name should render the "?" placeholder');
  });

  test('a whitespace-only string falls back to the placeholder', () => {
    eq(initialsOf('   '), '?', 'a whitespace-only name has no parts, so "?" is correct');
    eq(initialsOf('\t\n '), '?', 'mixed whitespace still yields no name parts');
  });

  test('a null-ish name falls back to the placeholder instead of throwing', () => {
    eq(initialsOf(null), '?', 'null should be coerced to the "?" placeholder');
    eq(initialsOf(undefined), '?', 'undefined should be coerced to the "?" placeholder');
  });

  test('lowercase input is uppercased', () => {
    eq(initialsOf('kris'), 'KR', 'initials must always be uppercase');
    eq(initialsOf('juan hernandez'), 'JH', 'initials must always be uppercase');
    eq(initialsOf('  ana   lopez '), 'AL', 'trimming and uppercasing apply together');
  });

  test('a single-letter name returns just that letter', () => {
    eq(initialsOf('X'), 'X', 'slicing two characters off a one-letter name yields one letter');
    eq(initialsOf('c'), 'C', 'a one-letter lowercase name is uppercased');
  });

  test('a single-letter first word still pairs with the second word', () => {
    eq(initialsOf('J Rivera'), 'JR', 'one initial from each of the first two words');
  });

  test('Store.addTeamMember derives initials through initialsOf', async () => {
    const row = await Store.addTeamMember({ name: 'ariana grande', role: 'Barber' });
    eq(row.initials, 'AG', 'a new member’s initials should be derived and uppercased');
    await refresh();
    const inState = state.team.find(t => t.id === row.id);
    ok(inState, 'the new member should be readable back through state.team');
    eq(inState.initials, 'AG', 'the derived initials should survive the round trip');
    has(html('#teamGrid'), 'AG', 'the team wall should render the derived initials');
  });

  test('Store.updateTeamMember recomputes initials when the name changes', async () => {
    await Store.updateTeamMember('tm_juan', { name: 'Juan Carlos Hernandez' });
    await refresh();
    const t = state.team.find(x => x.id === 'tm_juan');
    eq(t.initials, 'JC', 'renaming should recompute initials from the new name');
  });

  test('every seeded team member’s initials agree with initialsOf', () => {
    for (const t of DB.team) {
      eq(t.initials, initialsOf(t.name),
        `seeded initials for ${t.name} should match what initialsOf() would derive`);
    }
  });
});

/* --- helpers --- */
suite('Helpers · parseWhen', () => {
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const seedWhens = () => DB.slots.map(s => ({ src: 'slots/' + s.id, when: s.when }))
    .concat(DB.employeeMeetings.filter(e => e.when).map(e => ({ src: 'employeeMeetings/' + e.id, when: e.when })));

  test('parses a standard "Wed Jul 15 · 9:30 AM" label', () => {
    const d = parseWhen('Wed Jul 15 · 9:30 AM');
    eq(d.getFullYear(), 2026, 'the year is hardcoded to 2026');
    eq(d.getMonth(), 6, 'Jul is month index 6');
    eq(d.getDate(), 15, 'the day-of-month comes from the third token');
    eq(d.getHours(), 9, 'a morning hour passes through unchanged');
    eq(d.getMinutes(), 30, 'the minutes come from the time token');
    eq(d.getSeconds(), 0, 'seconds should default to zero');
  });

  test('every month abbreviation it knows maps to the right month index', () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    months.forEach((abbr, i) => {
      const d = parseWhen(`Mon ${abbr} 5 · 9:00 AM`);
      eq(d.getMonth(), i, `${abbr} should parse to month index ${i}`);
      eq(d.getFullYear(), 2026, `${abbr} should still land in the hardcoded year 2026`);
    });
  });

  test('the month abbreviations used by the seed all parse', () => {
    const abbrs = Array.from(new Set(seedWhens().map(x => x.when.split('·')[0].trim().split(/\s+/)[1])));
    gt(abbrs.length, 0, 'the seed should contain at least one dated label');
    for (const a of abbrs) {
      const d = parseWhen(`Mon ${a} 1 · 9:00 AM`);
      ok(!isNaN(d.getTime()), `month abbreviation "${a}" appears in the seed and must be parseable`);
    }
  });

  test('PM hours before noon shift by twelve', () => {
    eq(parseWhen('Thu Jul 16 · 2:00 PM').getHours(), 14, '2 PM should become hour 14');
    eq(parseWhen('Thu Jul 16 · 3:30 PM').getHours(), 15, '3:30 PM should become hour 15');
    eq(parseWhen('Wed Jul 22 · 11:59 PM').getHours(), 23, '11:59 PM should become hour 23');
  });

  test('AM hours before noon pass through unchanged', () => {
    eq(parseWhen('Fri Jul 17 · 9:00 AM').getHours(), 9, '9 AM should stay hour 9');
    eq(parseWhen('Mon Jul 20 · 11:00 AM').getHours(), 11, '11 AM should stay hour 11');
    eq(parseWhen('Mon Jul 20 · 1:05 AM').getHours(), 1, '1:05 AM should stay hour 1');
  });

  test('12:00 PM is noon, not midnight', () => {
    const d = parseWhen('Wed Jul 15 · 12:00 PM');
    eq(d.getHours(), 12, 'noon must stay hour 12 and not be bumped to 24');
    eq(d.getMinutes(), 0, 'noon minutes should be zero');
  });

  test('12:00 AM is midnight, not noon', () => {
    const d = parseWhen('Wed Jul 15 · 12:00 AM');
    eq(d.getHours(), 0, 'midnight must become hour 0');
    eq(d.getMinutes(), 0, 'midnight minutes should be zero');
  });

  test('12:45 PM and 12:45 AM stay on opposite sides of the clock', () => {
    eq(parseWhen('Wed Jul 15 · 12:45 PM').getHours(), 12, '12:45 PM is early afternoon');
    eq(parseWhen('Wed Jul 15 · 12:45 AM').getHours(), 0, '12:45 AM is just after midnight');
  });

  test('the AM/PM marker is case-insensitive', () => {
    eq(parseWhen('Thu Jul 16 · 2:00 pm').getHours(), 14, 'lowercase "pm" should still shift the hour');
    eq(parseWhen('Thu Jul 16 · 9:00 am').getHours(), 9, 'lowercase "am" should still parse');
    eq(parseWhen('Thu Jul 16 · 12:00 aM').getHours(), 0, 'mixed-case "aM" should still be midnight');
  });

  test('the label’s weekday token is ignored when computing the date', () => {
    const a = parseWhen('Mon Jul 15 · 9:30 AM');
    const b = parseWhen('Wed Jul 15 · 9:30 AM');
    eq(a.getTime(), b.getTime(), 'only the month and day drive the parsed date');
  });

  test('every slot label in the seed round-trips without an Invalid Date', () => {
    len(DB.slots, 11, 'the seed should still ship eleven bookable slots');
    for (const s of DB.slots) {
      const d = parseWhen(s.when);
      ok(!isNaN(d.getTime()), `slot ${s.id} ("${s.when}") must parse to a real Date`);
      eq(d.getFullYear(), 2026, `slot ${s.id} should land in the hardcoded year 2026`);
      gte(d.getHours(), 0, `slot ${s.id} should have a sane hour`);
      lte(d.getHours(), 23, `slot ${s.id} should have a sane hour`);
    }
  });

  test('every scheduled employee-meeting label in the seed round-trips too', () => {
    const dated = DB.employeeMeetings.filter(e => e.when);
    gt(dated.length, 0, 'the seed should contain dated employee meetings');
    for (const e of dated) {
      const d = parseWhen(e.when);
      ok(!isNaN(d.getTime()), `employee meeting ${e.id} ("${e.when}") must parse to a real Date`);
    }
  });

  test('slot labels name the weekday their parsed date actually falls on', () => {
    for (const s of DB.slots) {
      const d = parseWhen(s.when);
      const named = s.when.trim().split(/\s+/)[0];
      eq(WEEKDAYS[d.getDay()], named,
        `slot ${s.id} says "${named}" but ${s.when} parses to a ${WEEKDAYS[d.getDay()]}`);
    }
  });

  test('every dated label in the seed names the weekday it parses to', () => {
    for (const row of seedWhens()) {
      const d = parseWhen(row.when);
      const named = row.when.trim().split(/\s+/)[0];
      eq(WEEKDAYS[d.getDay()], named,
        `${row.src} is labelled "${named}" but "${row.when}" parses to a ${WEEKDAYS[d.getDay()]} in 2026`);
    }
  });

  test('a slot picked in the UI parses back to the same instant', async () => {
    const slot = DB.slots.find(s => s.meetingId === 'mtg_acd');
    await schedule('mtg_acd', slot.when);
    const m = state.me.meetings.find(x => x.meetingId === 'mtg_acd');
    eq(m.when, slot.when, 'scheduling should store the slot label verbatim');
    const d = parseWhen(m.when);
    ok(!isNaN(d.getTime()), 'the stored label must remain parseable after scheduling');
    eq(d.getFullYear(), 2026, 'the parsed booking should land in 2026');
  });
});

/* --- helpers --- */
suite('Helpers · pad2 & fmtICS', () => {
  test('pad2 zero-pads single digits', () => {
    eq(pad2(0), '00', 'zero should render as "00"');
    eq(pad2(1), '01', 'one should render as "01"');
    eq(pad2(9), '09', 'nine should render as "09"');
  });

  test('pad2 leaves two-digit numbers alone', () => {
    eq(pad2(10), '10', 'ten needs no padding');
    eq(pad2(23), '23', 'twenty-three needs no padding');
    eq(pad2(59), '59', 'fifty-nine needs no padding');
  });

  test('pad2 returns a string, not a number', () => {
    eq(typeof pad2(7), 'string', 'pad2 must produce a string for concatenation');
    eq(typeof pad2(12), 'string', 'pad2 must produce a string for concatenation');
  });

  test('fmtICS zero-pads a single-digit month, day, hour and minute', () => {
    /* 2026-01-05 09:07 local */
    eq(fmtICS(new Date(2026, 0, 5, 9, 7)), '20260105T090700',
      'every single-digit component should be padded to two characters');
  });

  test('fmtICS uses a one-based month', () => {
    eq(fmtICS(new Date(2026, 11, 31, 23, 59)).slice(0, 8), '20261231',
      'December (month index 11) should serialise as 12');
    eq(fmtICS(new Date(2026, 6, 15, 9, 30)).slice(0, 8), '20260715',
      'July (month index 6) should serialise as 07');
  });

  test('fmtICS always emits the basic-format ICS timestamp shape', () => {
    const samples = [
      new Date(2026, 0, 1, 0, 0),
      new Date(2026, 6, 15, 9, 30),
      new Date(2026, 6, 16, 14, 0),
      new Date(2026, 11, 31, 23, 59),
    ];
    for (const d of samples) {
      match(fmtICS(d), /^\d{8}T\d{6}$/, `fmtICS should emit YYYYMMDDTHHMMSS for ${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
      len(fmtICS(d), 15, 'an ICS basic-format timestamp is exactly 15 characters');
    }
  });

  test('fmtICS pins seconds to 00', () => {
    eq(fmtICS(new Date(2026, 6, 15, 9, 30, 42)).slice(-2), '00',
      'the exporter writes minute-precision times, so seconds are always 00');
  });

  test('fmtICS round-trips a parseWhen result', () => {
    eq(fmtICS(parseWhen('Wed Jul 15 · 9:30 AM')), '20260715T093000',
      'a slot label should serialise straight into an ICS timestamp');
    eq(fmtICS(parseWhen('Thu Jul 16 · 2:00 PM')), '20260716T140000',
      'PM conversion should survive into the ICS timestamp');
    eq(fmtICS(parseWhen('Wed Jul 15 · 12:00 AM')), '20260715T000000',
      'midnight should serialise as 000000, not 120000');
  });

  test('every seeded slot serialises to a well-formed ICS timestamp', () => {
    for (const s of DB.slots) {
      match(fmtICS(parseWhen(s.when)), /^\d{8}T\d{6}$/,
        `slot ${s.id} ("${s.when}") should serialise cleanly`);
    }
  });
});

/* --- helpers --- */
suite('Helpers · statusChip', () => {
  const styleText = () => qa('style').map(s => s.textContent).join('\n');

  test('a complete status renders the complete chip', () => {
    eq(statusChip('complete'), '<span class="chip complete">Complete</span>',
      'complete meetings get the brass "Complete" chip');
  });

  test('a scheduled status renders the scheduled chip', () => {
    eq(statusChip('scheduled'), '<span class="chip scheduled">Scheduled</span>',
      'booked meetings get the blue "Scheduled" chip');
  });

  test('an na status renders the muted "Not required" chip', () => {
    eq(statusChip('na'), '<span class="chip na">Not required</span>',
      'role-only steps that do not apply read as "Not required"');
  });

  test('any other status falls back to the neutral "Not scheduled" chip', () => {
    eq(statusChip('pending'), '<span class="chip">Not scheduled</span>',
      'pending is the normal fall-through case');
    eq(statusChip('anything-else'), '<span class="chip">Not scheduled</span>',
      'an unknown status should not blow up or render an empty chip');
    eq(statusChip(undefined), '<span class="chip">Not scheduled</span>',
      'a missing status should still render a readable chip');
    eq(statusChip(null), '<span class="chip">Not scheduled</span>',
      'a null status should still render a readable chip');
  });

  test('every chip it emits is a single well-formed span', () => {
    for (const s of ['complete', 'scheduled', 'na', 'pending']) {
      const host = document.createElement('div');
      host.innerHTML = statusChip(s);
      len(host.children, 1, `statusChip('${s}') should render exactly one element`);
      eq(host.firstElementChild.tagName, 'SPAN', `statusChip('${s}') should render a <span>`);
      ok(host.firstElementChild.classList.contains('chip'), `statusChip('${s}') should carry the base .chip class`);
      gt(host.firstElementChild.textContent.trim().length, 0, `statusChip('${s}') should have visible label text`);
    }
  });

  test('the class names it emits exist in the stylesheet', () => {
    const css = styleText();
    has(css, '.chip{', 'the base .chip rule should exist');
    has(css, '.chip.complete', 'statusChip emits "chip complete", so that rule must exist');
    has(css, '.chip.scheduled', 'statusChip emits "chip scheduled", so that rule must exist');
    has(css, '.chip.na', 'statusChip emits "chip na", so that rule must exist');
  });

  test('the emitted classes actually change how the chip paints', () => {
    const host = document.createElement('div');
    host.innerHTML = statusChip('complete') + statusChip('scheduled') + statusChip('na') + statusChip('pending');
    document.body.appendChild(host);
    try {
      const kids = Array.from(host.children);
      const complete = kids[0], scheduled = kids[1], na = kids[2], plain = kids[3];
      const bg = el => getComputedStyle(el).backgroundColor;
      eq(getComputedStyle(na).opacity, '0.55', '.chip.na should dim the chip');
      eq(getComputedStyle(plain).opacity, '1', 'a plain chip should not be dimmed');
      neq(bg(complete), bg(plain), '.chip.complete should paint its own background');
      neq(bg(scheduled), bg(plain), '.chip.scheduled should paint its own background');
      neq(bg(complete), bg(scheduled), 'complete and scheduled must be visually distinguishable');
    } finally {
      host.remove();
    }
  });

  test('the rail uses statusChip for each meeting status', () => {
    const rail = html('#rail');
    has(rail, statusChip('complete'), 'the completed handbook step should carry the complete chip');
    has(rail, statusChip('scheduled'), 'the booked front-desk step should carry the scheduled chip');
    has(rail, statusChip('pending'), 'the untouched steps should carry the neutral chip');
  });
});

/* --- helpers --- */
suite('Helpers · progressCounts', () => {
  test('counts every item across every checklist group, including the auto one', () => {
    const counts = progressCounts();
    const manual = DB.checklistItems.length;                  /* 17 template items */
    const auto = state.me.checklist.find(g => g.id === 'grp_meetings').items.length;
    eq(auto, 4, 'Jordan is ASP-eligible, so all four meetings appear in the auto group');
    eq(counts.total, manual + auto, 'the total must span the manual template items and the derived meeting rows');
    eq(counts.total, 22, 'seed: 18 manual checklist items plus 4 applicable meetings');
    eq(counts.done, 6, 'seed: 5 ticked checklist rows plus the one completed handbook meeting');
  });

  test('the auto group contributes its completed meetings to the done count', () => {
    const meetings = state.me.checklist.find(g => g.id === 'grp_meetings');
    const autoDone = meetings.items.filter(i => i.done).length;
    eq(autoDone, 1, 'only the handbook meeting is complete in the seed');
    const manualDone = DB.checklistState.filter(s => s.employeeId === CURRENT_USER && s.done).length;
    eq(manualDone, 5, 'the seed ticks five manual checklist rows for Jordan');
    eq(progressCounts().done, manualDone + autoDone, 'done should be the sum of both kinds');
  });

  test('ticking a manual item moves done up by one and leaves total alone', async () => {
    const before = progressCounts();
    await tick('itm_ec', true);
    const after = progressCounts();
    eq(after.done, before.done + 1, 'checking one box should add exactly one to done');
    eq(after.total, before.total, 'checking a box must not change the total');
  });

  test('un-ticking a manual item moves done back down', async () => {
    const before = progressCounts();
    await tick('itm_i9', false);
    const after = progressCounts();
    eq(after.done, before.done - 1, 'unchecking a seeded item should drop done by one');
    eq(after.total, before.total, 'unchecking must not change the total');
  });

  test('completing a meeting moves the auto group’s done count up', async () => {
    const before = progressCounts();
    await Store.completeEmployeeMeeting(CURRENT_USER, 'mtg_acd');
    await refresh();
    const after = progressCounts();
    eq(after.done, before.done + 1, 'a completed meeting counts as a done checklist row');
    eq(after.total, before.total, 'completing a meeting must not change the total');
  });

  test('an employee with no role-only step has a smaller auto group', async () => {
    const maya = await Store.getChecklist('emp_maya');
    const auto = maya.find(g => g.id === 'grp_meetings');
    len(auto.items, 3, 'Maya is not ASP-eligible, so her auto group skips the role-only step');
    await Store.assignProgram('emp_maya');
    const after = await Store.getChecklist('emp_maya');
    len(after.find(g => g.id === 'grp_meetings').items, 4,
      'assigning the program should add the role-only row to her auto group');
  });

  test('done never exceeds total, in any state', async () => {
    const check = label => {
      const counts = progressCounts();
      lte(counts.done, counts.total, `done must never exceed total (${label})`);
      gte(counts.done, 0, `done must never go negative (${label})`);
      gt(counts.total, 0, `total must stay positive while the template has items (${label})`);
    };
    check('seed');
    await tick('itm_ec', true);
    check('after ticking an item');
    await tick('itm_i9', false);
    check('after unticking an item');
    for (const m of ['mtg_handbook', 'mtg_frontdesk', 'mtg_assistant', 'mtg_acd']) {
      await Store.completeEmployeeMeeting(CURRENT_USER, m);
    }
    await refresh();
    check('after completing every meeting');
    for (const it of DB.checklistItems) await Store.setChecklistItem(CURRENT_USER, it.id, true);
    await refresh();
    check('after ticking everything');
    const counts = progressCounts();
    eq(counts.done, counts.total, 'with everything finished, done should equal total');
  });

  test('drives the progress bar and the home ring off the same numbers', () => {
    const counts = progressCounts();
    const pct = Math.round(counts.done / counts.total * 100);
    eq(q('#checkBar').style.width, pct + '%', 'the checklist bar should show the computed percentage');
    eq(text('#ringPct'), pct + '%', 'the home ring should show the same percentage');
    eq(text('#statCheck'), `${counts.done} / ${counts.total}`, 'the home stat should show the same counts');
  });
});

/* --- helpers --- */
suite('Helpers · byOrder', () => {
  test('sorts ascending by sortOrder', () => {
    const rows = [{ id: 'c', sortOrder: 3 }, { id: 'a', sortOrder: 1 }, { id: 'b', sortOrder: 2 }];
    deepEq(rows.slice().sort(byOrder).map(r => r.id), ['a', 'b', 'c'], 'byOrder should sort smallest-first');
  });

  test('returns a negative, positive or zero comparison', () => {
    lt(byOrder({ sortOrder: 1 }, { sortOrder: 2 }), 0, 'a lower sortOrder should compare first');
    gt(byOrder({ sortOrder: 5 }, { sortOrder: 2 }), 0, 'a higher sortOrder should compare last');
    eq(byOrder({ sortOrder: 2 }, { sortOrder: 2 }), 0, 'equal sortOrders should compare equal');
  });

  test('treats a missing sortOrder as 0', () => {
    eq(byOrder({}, { sortOrder: 0 }), 0, 'an absent sortOrder should behave like 0');
    lt(byOrder({}, { sortOrder: 1 }), 0, 'a row with no sortOrder should sort before sortOrder 1');
    gt(byOrder({ sortOrder: 1 }, {}), 0, 'sortOrder 1 should sort after a row with none');
  });

  test('treats null and undefined sortOrders as 0', () => {
    eq(byOrder({ sortOrder: null }, {}), 0, 'null should be coerced to 0');
    eq(byOrder({ sortOrder: undefined }, {}), 0, 'undefined should be coerced to 0');
    eq(byOrder({ sortOrder: 0 }, {}), 0, 'an explicit 0 matches a missing value');
  });

  test('a row with no sortOrder sorts to the front of a real list', () => {
    const rows = [{ id: 'b', sortOrder: 2 }, { id: 'none' }, { id: 'a', sortOrder: 1 }];
    deepEq(rows.slice().sort(byOrder).map(r => r.id), ['none', 'a', 'b'],
      'the unordered row should land before every positive sortOrder');
  });

  test('Store.listTeam returns the roster in sortOrder', async () => {
    const team = await Store.listTeam();
    deepEq(team.map(t => t.sortOrder), team.map(t => t.sortOrder).slice().sort((a, b) => a - b),
      'listTeam should hand back an ascending roster');
    eq(team[0].id, 'tm_charlie', 'sortOrder 1 (Charlie) should come first');
  });

  test('Store.listMeetings returns the journey in step order', async () => {
    const meetings = await Store.listMeetings();
    deepEq(meetings.map(m => m.id), ['mtg_handbook', 'mtg_frontdesk', 'mtg_assistant', 'mtg_acd'],
      'meetings should come back in their sortOrder, which matches the roman-numeral steps');
  });
});

/* --- helpers --- */
suite('Helpers · meetingTpl & findItem', () => {
  test('meetingTpl resolves every seeded meeting id', () => {
    for (const seeded of DB.meetings) {
      const m = meetingTpl(seeded.id);
      ok(m, `meetingTpl should resolve the seeded id ${seeded.id}`);
      eq(m.id, seeded.id, 'the resolved template should be the one asked for');
      eq(m.title, seeded.title, `meetingTpl('${seeded.id}') should carry the seeded title`);
    }
  });

  test('meetingTpl resolves a known id to its full template', () => {
    const m = meetingTpl('mtg_handbook');
    eq(m.title, 'Handbook Meeting', 'the handbook template should come back by id');
    eq(m.roman, 'I', 'the template should carry its roman numeral');
    eq(m.durationMin, 45, 'the template should carry its duration');
  });

  test('meetingTpl resolves role-only meetings too, regardless of the viewer', () => {
    const m = meetingTpl('mtg_assistant');
    ok(m, 'the role-only template is still part of the meeting catalogue');
    eq(m.roleOnly, true, 'the Assistant Stylist step is flagged role-only');
  });

  test('meetingTpl returns undefined for an unknown id', () => {
    eq(meetingTpl('mtg_does_not_exist'), undefined, 'an unknown meeting id should resolve to undefined');
    eq(meetingTpl(''), undefined, 'an empty id should resolve to undefined');
    eq(meetingTpl(undefined), undefined, 'a missing id should resolve to undefined');
  });

  test('findItem finds a manual item in the first group', () => {
    const it = findItem('itm_i9');
    ok(it, 'itm_i9 lives in the employment group and should be findable');
    eq(it.label, 'Form I-9 process', 'the found item should carry its label');
    eq(it.done, true, 'itm_i9 is ticked in the seed');
  });

  test('findItem finds items in the middle and last groups', () => {
    const setup = findItem('itm_headshot');
    ok(setup, 'itm_headshot lives in the shop-setup group');
    eq(setup.done, false, 'the headshot item is not ticked in the seed');
    const training = findItem('itm_ackfuture');
    ok(training, 'itm_ackfuture lives in the last group and should still be reachable');
    eq(training.locked, false, 'manual items are not locked');
  });

  test('findItem finds derived items in the auto meetings group', () => {
    const it = findItem('meeting:mtg_handbook');
    ok(it, 'auto-derived meeting rows should be findable by their prefixed id');
    eq(it.done, true, 'the handbook meeting is complete in the seed');
    eq(it.locked, true, 'auto rows are locked against manual ticking');
    eq(it.status, 'complete', 'auto rows carry the underlying meeting status');
  });

  test('findItem returns null when the item is absent', () => {
    eq(findItem('itm_not_a_real_item'), null, 'an unknown item id should return null, not undefined');
    eq(findItem('meeting:mtg_nope'), null, 'an unknown derived id should return null');
    eq(findItem(''), null, 'an empty id should return null');
  });

  test('findItem sees a tick made through the Store', async () => {
    eq(findItem('itm_login').done, false, 'the login item starts unticked');
    await tick('itm_login', true);
    eq(findItem('itm_login').done, true, 'findItem should reflect the refreshed state');
    eq(text('#statTrain'), 'Confirmed', 'the home stat reads training access off findItem');
  });
});

/* --- helpers --- */
suite('Helpers · addToCalendar (.ics export)', () => {
  /* Capture the export without letting the browser actually download anything:
     Blob records the file text synchronously, createObjectURL/revokeObjectURL are
     neutralised, and the anchor's click is intercepted. Everything is restored in
     a finally block so a failing assertion cannot poison later tests. */
  function captureExport(fn) {
    const realBlob = window.Blob;
    const realCreate = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    const realClick = HTMLAnchorElement.prototype.click;
    const files = [], anchors = [];
    let revokes = 0;
    window.Blob = function (chunks, opts) {
      files.push({ text: (chunks || []).join(''), type: (opts && opts.type) || '' });
      return { __selftestBlob: true };
    };
    URL.createObjectURL = () => 'blob:selftest/' + files.length;
    URL.revokeObjectURL = () => { revokes++; };
    HTMLAnchorElement.prototype.click = function () {
      anchors.push({ download: this.download, inDom: document.body.contains(this) });
    };
    try {
      fn();
    } finally {
      window.Blob = realBlob;
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
      HTMLAnchorElement.prototype.click = realClick;
    }
    return { files, anchors, revokes };
  }

  /* Export once and hand back the .ics text. */
  const icsFor = meetingId => {
    const cap = captureExport(() => addToCalendar(meetingId));
    len(cap.files, 1, `exporting ${meetingId} should produce exactly one calendar file`);
    return cap.files[0].text;
  };
  const line = (ics, key) => {
    const found = ics.split('\r\n').find(l => l.indexOf(key + ':') === 0);
    return found ? found.slice(key.length + 1) : null;
  };
  const stampToDate = s => new Date(
    +s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15));

  test('a scheduled meeting produces exactly one calendar file and one download', () => {
    const cap = captureExport(() => addToCalendar('mtg_frontdesk'));
    len(cap.files, 1, 'exporting a booked meeting should build exactly one file');
    eq(cap.files[0].type, 'text/calendar', 'the blob should be typed as a calendar file');
    len(cap.anchors, 1, 'the export should trigger exactly one download click');
    eq(cap.anchors[0].download, 'artisan-mtg_frontdesk.ics', 'the file should be named after the meeting');
    ok(cap.anchors[0].inDom, 'the anchor must be in the document when it is clicked');
    eq(cap.revokes, 1, 'the object URL should be revoked once the download has fired');
  });

  test('the export is a well-formed VCALENDAR', () => {
    const ics = icsFor('mtg_frontdesk');
    const lines = ics.split('\r\n');
    eq(lines[0], 'BEGIN:VCALENDAR', 'an ICS file opens with BEGIN:VCALENDAR');
    eq(lines[lines.length - 1], 'END:VCALENDAR', 'an ICS file closes with END:VCALENDAR');
    has(ics, 'VERSION:2.0', 'the calendar should declare iCalendar 2.0');
    has(ics, 'PRODID:', 'the calendar should declare a PRODID');
    has(ics, 'BEGIN:VEVENT', 'the calendar should wrap a VEVENT');
    has(ics, 'END:VEVENT', 'the VEVENT should be closed');
    has(ics, '\r\n', 'ICS lines are CRLF-delimited');
  });

  test('the event carries DTSTART, DTEND, a UID and a DTSTAMP', () => {
    const ics = icsFor('mtg_frontdesk');
    match(line(ics, 'DTSTART'), /^\d{8}T\d{6}$/, 'DTSTART should be a basic-format timestamp');
    match(line(ics, 'DTEND'), /^\d{8}T\d{6}$/, 'DTEND should be a basic-format timestamp');
    match(line(ics, 'DTSTAMP'), /^\d{8}T\d{6}$/, 'DTSTAMP should be a basic-format timestamp');
    has(line(ics, 'UID'), 'mtg_frontdesk', 'the UID should identify the meeting');
    has(line(ics, 'UID'), '@artisanbarber', 'the UID should be domain-qualified');
    lacks(ics, 'NaN', 'no timestamp component should have failed to parse');
  });

  test('DTSTART matches the meeting time the employee actually booked', () => {
    const m = state.me.meetings.find(x => x.meetingId === 'mtg_frontdesk');
    eq(m.when, 'Wed Jul 15 · 9:30 AM', 'seed: Jordan’s front-desk meeting is booked for Wed Jul 15');
    eq(line(icsFor('mtg_frontdesk'), 'DTSTART'), '20260715T093000', 'DTSTART should be the booked slot, serialised');
  });

  test('DTEND is exactly durationMin after DTSTART', () => {
    const m = state.me.meetings.find(x => x.meetingId === 'mtg_frontdesk');
    eq(m.durationMin, 45, 'seed: the front-desk meeting runs 45 minutes');
    const ics = icsFor('mtg_frontdesk');
    const start = stampToDate(line(ics, 'DTSTART'));
    const end = stampToDate(line(ics, 'DTEND'));
    gt(end.getTime(), start.getTime(), 'the event must not end before it starts');
    eq((end - start) / 60000, m.durationMin, 'the event length should be the meeting’s durationMin');
    eq(line(ics, 'DTEND'), '20260715T101500', '9:30 AM plus 45 minutes is 10:15 AM');
  });

  test('a 30-minute meeting exports a 30-minute event, not a fixed 45', async () => {
    const slot = DB.slots.find(s => s.meetingId === 'mtg_acd');
    await schedule('mtg_acd', slot.when);
    const m = state.me.meetings.find(x => x.meetingId === 'mtg_acd');
    eq(m.durationMin, 30, 'seed: the Continued Development intro runs 30 minutes');
    const ics = icsFor('mtg_acd');
    const mins = (stampToDate(line(ics, 'DTEND')) - stampToDate(line(ics, 'DTSTART'))) / 60000;
    eq(mins, 30, 'DTEND should follow DTSTART by the meeting’s own duration');
  });

  test('SUMMARY carries the meeting title and DESCRIPTION carries the host', () => {
    const ics = icsFor('mtg_frontdesk');
    const summary = line(ics, 'SUMMARY');
    has(summary, 'Front Desk & Concierge Standards', 'SUMMARY should name the meeting');
    has(summary, 'Artisan Onboarding', 'SUMMARY should be branded so it reads well in a calendar');
    has(line(ics, 'DESCRIPTION'), 'Bobby · Manager', 'DESCRIPTION should name the host');
    has(ics, 'LOCATION:', 'the event should carry a location');
  });

  test('a completed meeting can still be exported', () => {
    const m = state.me.meetings.find(x => x.meetingId === 'mtg_handbook');
    eq(m.status, 'complete', 'seed: Jordan’s handbook meeting is already complete');
    const ics = icsFor('mtg_handbook');
    eq(line(ics, 'DTSTART'), '20260706T100000', 'DTSTART should be the recorded meeting time');
    has(line(ics, 'SUMMARY'), 'Handbook Meeting', 'SUMMARY should name the completed meeting');
  });

  test('a meeting with no time produces no file and says so', () => {
    const m = state.me.meetings.find(x => x.meetingId === 'mtg_assistant');
    eq(m.status, 'pending', 'seed: the Assistant Stylist step is unscheduled');
    eq(m.when, null, 'an unscheduled meeting has no time');
    const cap = captureExport(() => addToCalendar('mtg_assistant'));
    len(cap.files, 0, 'no calendar file should be built without a time');
    len(cap.anchors, 0, 'no download should be triggered without a time');
    eq(cap.revokes, 0, 'nothing should be revoked when nothing was created');
    eq(text('#toast'), 'Pick a time first', 'the user should be told to pick a time');
  });

  test('an unknown meeting id produces no file', () => {
    const cap = captureExport(() => addToCalendar('mtg_not_mine'));
    len(cap.files, 0, 'a meeting outside the user’s journey should not export');
    len(cap.anchors, 0, 'a meeting outside the user’s journey should not download');
    eq(text('#toast'), 'Pick a time first', 'the guard message should still be shown');
  });

  test('the export leaves no stray anchor behind in the document', () => {
    const before = qa('a[download]').length;
    captureExport(() => addToCalendar('mtg_frontdesk'));
    eq(qa('a[download]').length, before, 'the temporary download anchor should be removed again');
  });

  test('exporting twice describes the same single event both times', () => {
    const first = icsFor('mtg_frontdesk');
    const second = icsFor('mtg_frontdesk');
    eq(first.split('BEGIN:VEVENT').length - 1, 1, 'each export should contain exactly one event');
    eq(line(first, 'DTSTART'), line(second, 'DTSTART'), 'repeated exports should describe the same event');
    eq(line(first, 'SUMMARY'), line(second, 'SUMMARY'), 'repeated exports should carry the same summary');
  });

  test('an unparseable stored time does not crash the export', async () => {
    /* adminAssignTime() writes the literal string 'Time TBD' when a meeting has
       no slots, so this state is reachable straight from the admin UI. */
    const inst = DB.employeeMeetings.find(x => x.employeeId === CURRENT_USER && x.meetingId === 'mtg_assistant');
    inst.status = 'scheduled';
    inst.when = 'Time TBD';
    await refresh();
    let thrown = null;
    let cap = { files: [] };
    try {
      cap = captureExport(() => addToCalendar('mtg_assistant'));
    } catch (e) {
      thrown = e;
    }
    ok(!thrown, 'addToCalendar must guard an unparseable stored time instead of throwing — it threw: ' +
      (thrown ? thrown.message : 'nothing'));
    if (cap.files.length) {
      lacks(cap.files[0].text, 'NaN', 'if a file is produced anyway it must not contain NaN timestamps');
    }
  });

  test('every front-desk slot can be booked and exported cleanly', async () => {
    for (const slot of DB.slots.filter(s => s.meetingId === 'mtg_frontdesk')) {
      await schedule('mtg_frontdesk', slot.when);
      const ics = icsFor('mtg_frontdesk');
      match(line(ics, 'DTSTART'), /^\d{8}T\d{6}$/, `"${slot.when}" should serialise to a valid DTSTART`);
      eq(line(ics, 'DTSTART').slice(0, 4), '2026', `"${slot.when}" should land in the hardcoded year`);
      lacks(ics, 'NaN', `"${slot.when}" should not produce NaN timestamps`);
    }
  });
});

/* --- render --- */
suite('render · navigation', () => {

  test('employee nav renders one button per entry plus its section header', () => {
    deepEq(qa('#nav .navbtn').map(b => text(b)),
      ['Home', 'Meet the shop', 'My checklist', 'Meetings', 'Training access', 'Resources', 'Questions'],
      'employee nav should list every NAV.employee entry in declared order');
    deepEq(qa('#nav .nav-label').map(l => text(l)), ['Onboarding', 'Reference'],
      'employee nav groups the reference sections under their own header');
  });

  test('each nav button carries the screen id it navigates to', () => {
    deepEq(qa('#nav .navbtn').map(b => handlerArg(b, 'go')),
      ['s-home', 's-team', 's-checklist', 's-meetings', 's-training', 's-resources', 's-help'],
      'every nav button should be wired to go() with its own screen id');
  });

  test('exactly one nav button is active and it names the current screen', () => {
    const active = qa('#nav .navbtn.active');
    len(active, 1, 'exactly one nav button should carry .active');
    eq(handlerArg(active[0], 'go'), current, 'the highlighted nav button should be the current screen');
    eq(current, 's-home', 'the app should land on Home in employee mode');
  });

  test('clicking a nav button moves both the screen and the highlight', () => {
    const btn = qa('#nav .navbtn').find(b => handlerArg(b, 'go') === 's-checklist');
    ok(btn, 'there should be a nav button for the checklist screen');
    click(btn);
    eq(current, 's-checklist', 'clicking the nav button should set the current screen');
    ok(shown('#s-checklist'), 'the checklist screen should be visible after clicking its nav button');
    const active = qa('#nav .navbtn.active');
    len(active, 1, 'still exactly one nav button should be highlighted after navigating');
    eq(text(active[0]), 'My checklist', 'the highlight should move to the checklist entry');
  });

  test('go() leaves exactly one active screen on the whole page', () => {
    for (const id of ['s-team', 's-checklist', 's-meetings', 's-training', 's-help', 's-home']) {
      go(id);
      const active = qa('.screen.active');
      len(active, 1, `go('${id}') should leave exactly one .screen active`);
      eq(active[0].id, id, `go('${id}') should activate that screen and no other`);
    }
  });

  test('admin mode swaps the whole nav for the admin entries', () => {
    setMode('admin');
    deepEq(qa('#nav .navbtn').map(b => text(b)),
      ['Overview', 'Team & photos', 'Meeting times', 'Content', 'Resources'],
      'admin nav should list every NAV.admin entry in declared order');
    deepEq(qa('#nav .nav-label').map(l => text(l)), ['Manage'],
      'admin nav should render its own section header');
    const active = qa('#nav .navbtn.active');
    len(active, 1, 'exactly one admin nav button should be highlighted');
    eq(handlerArg(active[0], 'go'), 'a-overview', 'admin mode should highlight Overview');
  });

  test('a dynamic detail screen never highlights an unrelated section', () => {
    openMember('tm_kris');
    eq(current, 's-member', 'opening a profile should make the member screen current');
    const active = qa('#nav .navbtn.active');
    lte(active.length, 1, 'at most one nav button may be highlighted');
    for (const b of active) {
      eq(handlerArg(b, 'go'), current, 'a highlighted nav button must match the current screen');
    }
  });
});

/* --- render --- */
suite('render · mode switch and identity', () => {

  test('admin mode darkens the shell, flips the toggle and lands on the overview', () => {
    setMode('admin');
    ok(document.body.classList.contains('admin'), 'body should carry the admin class in admin mode');
    ok(q('#btnAdm').classList.contains('on'), 'the Admin toggle should read as selected');
    notOk(q('#btnEmp').classList.contains('on'), 'the Employee toggle should no longer read as selected');
    eq(current, 'a-overview', 'admin mode should land on the overview screen');
    ok(shown('#a-overview'), 'the admin overview should be the visible screen');
    len(qa('.screen.active'), 1, 'switching mode should leave exactly one screen active');
  });

  test('admin mode rewrites the identity block', () => {
    setMode('admin');
    eq(text('#whoName'), 'Charlie', 'admin mode should show the admin name');
    eq(text('#whoRole'), 'Owner · Admin', 'admin mode should show the admin role');
    eq(text('#whoAv'), 'C', 'admin mode should show the admin monogram');
    eq(text('#modeSub'), 'Onboarding · Back of house', 'the brand subtitle should say back of house');
  });

  test('employee mode restores the identity from state.me.employee', () => {
    setMode('admin');
    setMode('employee');
    const me = state.me.employee;
    eq(text('#whoName'), me.name, 'the identity name should come back from the employee record');
    eq(text('#whoRole'), me.role + ' · ' + me.dayLabel, 'the identity role should read "role · day"');
    eq(text('#whoAv'), me.initials, 'the avatar should show the employee initials');
    eq(text('#modeSub'), 'Onboarding · Front of house', 'the brand subtitle should say front of house');
    notOk(document.body.classList.contains('admin'), 'the admin class should be removed again');
    ok(q('#btnEmp').classList.contains('on'), 'the Employee toggle should read as selected');
    notOk(q('#btnAdm').classList.contains('on'), 'the Admin toggle should no longer read as selected');
    eq(current, 's-home', 'employee mode should land on Home');
  });

  test('the identity block follows the employee record rather than fixed copy', async () => {
    const me = DB.employees.find(e => e.id === CURRENT_USER);
    me.role = 'Master Barber';
    me.dayLabel = 'Day 12';
    me.initials = 'JX';
    await refresh();
    eq(text('#whoRole'), 'Master Barber · Day 12', 'the identity role should re-render from the record');
    eq(text('#whoAv'), 'JX', 'the avatar should re-render from the record');
  });
});

/* --- render --- */
suite('render · meetings rail', () => {

  test('one step per applicable meeting, in step order, with the roman numeral', () => {
    const steps = qa('#rail .step');
    len(steps, 4, 'the seeded user is eligible for all four meetings');
    deepEq(steps.map(s => text(s.querySelector('.numeral'))), ['I', 'II', 'III', 'IV'],
      'the rail should number the steps I through IV in order');
    const titles = state.me.meetings.slice().sort((a, b) => a.step - b.step).map(m => m.title);
    steps.forEach((s, i) => has(text(s.querySelector('h3')), titles[i],
      'each step heading should name its meeting'));
  });

  test('each step card is wired to its own meeting id', () => {
    deepEq(qa('#rail .step-card').map(c => handlerArg(c, 'openMeeting')),
      ['mtg_handbook', 'mtg_frontdesk', 'mtg_assistant', 'mtg_acd'],
      'each step should open the meeting it displays');
  });

  test('each step shows the status chip for its own status', () => {
    deepEq(qa('#rail .step').map(s => text(s.querySelector('.step-right .chip'))),
      ['Complete', 'Scheduled', 'Not scheduled', 'Not scheduled'],
      'the rail chips should mirror the seeded meeting statuses');
    deepEq(qa('#rail .step').map(s => s.className.replace('step', '').trim()),
      ['complete', 'scheduled', 'pending', 'pending'],
      'each step should carry its status as a class so the CSS can style it');
  });

  test('only the role-only step carries a Your role chip', () => {
    const roleChips = qa('#rail .step .chip.role');
    len(roleChips, 1, 'exactly one step is role-only in the seed');
    eq(text(roleChips[0]), 'Your role', 'the role-only step should be chipped "Your role"');
    ok(qa('#rail .step')[2].querySelector('.chip.role'), 'the Assistant Stylist step is the role-only one');
  });

  test('the step meta line shows the host and, when booked, the time', () => {
    const metas = qa('#rail .step .meta').map(m => text(m));
    eq(metas[0], 'Charlie · Owner · Mon Jul 6 · 10:00 AM', 'a completed step should show host and time');
    eq(metas[1], 'Bobby · Manager · Wed Jul 15 · 9:30 AM', 'a scheduled step should show host and time');
    eq(metas[2], 'Juan · Senior Stylist', 'an unscheduled step should show the host alone');
  });

  test('an employee outside the role-only program gets a three-step rail', async () => {
    DB.employees.find(e => e.id === CURRENT_USER).eligibleForAsp = false;
    await refresh();
    len(qa('#rail .step'), 3, 'the role-only step should drop out of the rail');
    len(qa('#rail .chip.role'), 0, 'no "Your role" chip should remain');
    deepEq(qa('#rail .step-card').map(c => handlerArg(c, 'openMeeting')),
      ['mtg_handbook', 'mtg_frontdesk', 'mtg_acd'], 'only applicable meetings should be railed');
    deepEq(qa('#rail .numeral').map(n => text(n)), ['I', 'II', 'IV'],
      'the remaining steps keep their own numerals');
  });

  test('scheduling a meeting re-renders that step as booked', async () => {
    await Store.scheduleEmployeeMeeting(CURRENT_USER, 'mtg_assistant', 'Thu Jul 16 · 3:30 PM');
    await refresh();
    const step = qa('#rail .step')[2];
    ok(step.classList.contains('scheduled'), 'the rescheduled step should switch to the scheduled class');
    eq(text(step.querySelector('.step-right .chip')), 'Scheduled', 'its chip should now read Scheduled');
    has(text(step.querySelector('.meta')), 'Thu Jul 16 · 3:30 PM', 'its meta line should show the booked time');
  });
});

/* --- render --- */
suite('render · meeting detail', () => {

  test('renders the purpose, every topic and every prep line', () => {
    openMeeting('mtg_frontdesk');
    eq(current, 's-meeting', 'opening a meeting should make the meeting screen current');
    ok(shown('#s-meeting'), 'the meeting screen should be the visible one');
    const m = state.meetings.find(x => x.id === 'mtg_frontdesk');
    has(text('#s-meeting'), m.purpose, 'the purpose should be rendered');
    has(text('#s-meeting'), m.topicsLabel, 'the topics heading should use the meeting label');
    const lines = qa('#s-meeting .topic-list li').map(li => text(li));
    for (const t of m.topics) has(lines, t, 'every topic should be listed');
    for (const p of m.prep) has(lines, p, 'every prep line should be listed');
    len(lines, m.topics.length + m.prep.length, 'topics and prep should be the only list lines');
  });

  test('the detail head shows the step numeral, duration and title', () => {
    openMeeting('mtg_acd');
    eq(text('#s-meeting .detail-head .numeral'), 'IV', 'the head should show the roman numeral');
    has(text('#s-meeting .eyebrow'), 'Step IV of IV', 'the eyebrow should place the step in the journey');
    has(text('#s-meeting .eyebrow'), 'about 30 min', 'the eyebrow should show the meeting duration');
    eq(text('#s-meeting h1'), 'Artisan Continued Development', 'the head should show the meeting title');
  });

  test('the acknowledgment block appears only for the meeting that requires it', () => {
    openMeeting('mtg_handbook');
    has(text('#s-meeting'), 'Handbook acknowledgment', 'the handbook meeting requires an acknowledgment');
    ok(q('#ackBtn'), 'the handbook meeting should render an acknowledge button');
    openMeeting('mtg_frontdesk');
    lacks(text('#s-meeting'), 'Handbook acknowledgment', 'no other meeting requires an acknowledgment');
    notOk(q('#ackBtn'), 'no other meeting should render an acknowledge button');
  });

  test('an already-acknowledged handbook renders a disabled confirmation', () => {
    openMeeting('mtg_handbook');
    const b = q('#ackBtn');
    eq(b.disabled, true, 'the acknowledge button should be disabled once acknowledged');
    has(text(b), 'Acknowledged', 'the acknowledge button should read as done');
  });

  test('an unacknowledged handbook renders a live acknowledge button', async () => {
    DB.employeeMeetings.find(x => x.id === 'em_1').acknowledgedAt = null;
    await refresh();
    openMeeting('mtg_handbook');
    const b = q('#ackBtn');
    eq(b.disabled, false, 'the acknowledge button should be usable while unacknowledged');
    eq(text(b), 'Acknowledge handbook', 'the acknowledge button should invite the action');
  });

  test('a pending meeting renders every slot as a bookable button', () => {
    openMeeting('mtg_assistant');
    const seeded = DB.slots.filter(s => s.meetingId === 'mtg_assistant');
    const buttons = qa('#s-meeting .slot');
    len(buttons, seeded.length, 'a pending meeting should offer every slot on file');
    deepEq(buttons.map(b => text(b)), seeded.map(s => s.when), 'the slot labels should be the stored times');
    for (const b of buttons) {
      eq(handlerArg(b, 'schedule'), 'mtg_assistant', 'each slot should schedule its own meeting');
    }
    has(text('#s-meeting'), 'Pick a time', 'a pending meeting should invite the user to pick a time');
    lacks(text('#s-meeting'), 'Reschedule', 'a pending meeting has nothing to reschedule');
  });

  test('a scheduled meeting shows the booked panel and no slot picker', () => {
    openMeeting('mtg_frontdesk');
    has(text('#s-meeting'), "You're booked", 'a scheduled meeting should confirm the booking');
    has(text('#s-meeting'), 'Wed Jul 15 · 9:30 AM', 'the booked panel should show the booked time');
    has(text('#s-meeting'), 'Bobby · Manager', 'the booked panel should show the host');
    has(text('#s-meeting'), 'Reschedule', 'a scheduled meeting should offer a reschedule');
    len(qa('#s-meeting .slot'), 0, 'a scheduled meeting should not show the slot picker');
  });

  test('a complete meeting shows neither slot picker nor Reschedule', () => {
    openMeeting('mtg_handbook');
    len(qa('#s-meeting .slot'), 0, 'a completed meeting should not offer slots');
    lacks(text('#s-meeting'), 'Reschedule', 'a completed meeting should not offer a reschedule');
    lacks(text('#s-meeting'), 'Pick a time', 'a completed meeting should not ask for a time');
    has(text('#s-meeting'), 'Done and noted', 'a completed meeting should say so');
  });

  test('reschedule mode re-opens the picker over a booked meeting', () => {
    reschedule('mtg_frontdesk');
    has(text('#s-meeting'), 'Choose a new time', 'reschedule mode should re-title the picker');
    len(qa('#s-meeting .slot'), DB.slots.filter(s => s.meetingId === 'mtg_frontdesk').length,
      'reschedule mode should offer every slot again');
    has(text('#s-meeting'), 'Keep Wed Jul 15 · 9:30 AM', 'reschedule mode should offer to keep the booked time');
  });

  test('cancelling a reschedule returns the booked panel', () => {
    reschedule('mtg_frontdesk');
    cancelReschedule('mtg_frontdesk');
    len(qa('#s-meeting .slot'), 0, 'cancelling should close the slot picker');
    has(text('#s-meeting'), "You're booked", 'cancelling should restore the booked panel');
  });

  test('the head status chip matches each meeting status', () => {
    openMeeting('mtg_handbook');
    eq(text('#s-meeting .detail-head .chip'), 'Complete', 'a completed meeting is chipped Complete');
    openMeeting('mtg_frontdesk');
    eq(text('#s-meeting .detail-head .chip'), 'Scheduled', 'a booked meeting is chipped Scheduled');
    openMeeting('mtg_acd');
    eq(text('#s-meeting .detail-head .chip'), 'Not scheduled', 'a pending meeting is chipped Not scheduled');
  });

  test('the scope note renders only for meetings that declare a boundary', () => {
    openMeeting('mtg_handbook');
    len(qa('#s-meeting .note'), 0, 'the handbook meeting declares no boundary');
    openMeeting('mtg_frontdesk');
    len(qa('#s-meeting .note'), 1, 'a meeting with a boundary should render one scope note');
    has(text('#s-meeting .note'), state.meetings.find(m => m.id === 'mtg_frontdesk').boundary,
      'the scope note should quote the meeting boundary');
  });

  test('a meeting outside the journey does not switch screens', async () => {
    DB.employees.find(e => e.id === CURRENT_USER).eligibleForAsp = false;
    await refresh();
    openMeeting('mtg_assistant');
    eq(current, 's-home', 'an inapplicable meeting should leave the user where they were');
    notOk(shown('#s-meeting'), 'the meeting screen should not be shown for an inapplicable meeting');
    has(text('#toast'), 'part of your onboarding', 'the user should be told why nothing happened');
  });

  test('an unknown meeting id does not switch screens', () => {
    openMeeting('mtg_does_not_exist');
    eq(current, 's-home', 'an unknown meeting id should not navigate anywhere');
    notOk(shown('#s-meeting'), 'the meeting screen should stay hidden for an unknown id');
  });

  test('a meeting with no times explains that instead of rendering buttons', async () => {
    DB.slots = DB.slots.filter(s => s.meetingId !== 'mtg_assistant');
    await refresh();
    openMeeting('mtg_assistant');
    len(qa('#s-meeting .slot'), 0, 'there are no slots to render');
    has(text('#s-meeting'), 'No times available yet', 'the empty picker should explain itself');
  });
});

/* --- render --- */
suite('render · checklist', () => {

  test('one group per checklist group, with title and subtitle', () => {
    const groups = qa('#checkGroups .check-group');
    len(groups, 4, 'the seed defines four checklist groups');
    len(groups, state.me.checklist.length, 'every group in state should render');
    deepEq(groups.map(g => text(g.querySelector('h2'))), state.me.checklist.map(g => g.title),
      'each group heading should be its stored title');
    deepEq(groups.map(g => text(g.querySelector('.gsub'))), state.me.checklist.map(g => g.subtitle),
      'each group should render its stored subtitle');
  });

  test('every item of every group renders one row', () => {
    const groups = qa('#checkGroups .check-group');
    groups.forEach((g, i) => len(g.querySelectorAll('.check-item'), state.me.checklist[i].items.length,
      'each group should render exactly its own items'));
    len(qa('#checkGroups .check-item'), 22, 'the seeded user has 22 checklist rows in total');
  });

  test('auto-group items render a disabled checkbox plus a status chip', () => {
    const idx = state.me.checklist.findIndex(g => g.kind === 'auto');
    eq(idx, 2, 'the meetings group is the auto-derived one');
    const rows = Array.from(qa('#checkGroups .check-group')[idx].querySelectorAll('.check-item'));
    len(rows, 4, 'the auto group mirrors the four applicable meetings');
    for (const r of rows) {
      eq(r.querySelector('input[type=checkbox]').disabled, true,
        'auto items must not be togglable by hand');
      ok(r.querySelector('.auto .chip'), 'auto items should carry a meeting status chip');
      notOk(r.querySelector('input').getAttribute('onchange'), 'auto items should not be wired to tick()');
    }
    deepEq(rows.map(r => text(r.querySelector('.auto .chip'))),
      ['Complete', 'Scheduled', 'Not scheduled', 'Not scheduled'],
      'the auto chips should mirror the meeting statuses');
    deepEq(rows.map(r => r.querySelector('input').checked), [true, false, false, false],
      'only the completed meeting should be checked');
  });

  test('the role-only auto item is labelled as belonging to the role', () => {
    has(text(qa('#checkGroups .check-group')[2]), 'Attend Assistant Stylist Program (your role)',
      'the role-only meeting item should say it is role-based');
  });

  test('manual items render an enabled checkbox wired to tick()', () => {
    const row = qa('#checkGroups .check-group')[0].querySelector('.check-item');
    const box = row.querySelector('input');
    eq(box.disabled, false, 'manual items should be togglable');
    eq(box.id, 'ck_itm_i9', 'each manual checkbox should be identified by its item id');
    match(box.getAttribute('onchange'), /^tick\('itm_i9',this\.checked\)$/,
      'a manual checkbox should call tick() with its own item id');
    eq(row.querySelector('label').getAttribute('for'), 'ck_itm_i9',
      'the label should be bound to its checkbox');
  });

  test('checked state and the done class mirror the stored checklist', () => {
    const rows = qa('#checkGroups .check-item');
    rows.forEach(r => eq(r.classList.contains('done'), r.querySelector('input').checked,
      'a row should be struck through exactly when its box is checked'));
    len(rows.filter(r => r.querySelector('input').checked), 6,
      'the seed has five manual items done plus one completed meeting');
  });

  test('ticking an item re-renders it as done and moves the bar', async () => {
    const before = q('#checkBar').style.width;
    await tick('itm_ec', true);
    const box = q('#ck_itm_ec');
    eq(box.checked, true, 'the ticked item should re-render checked');
    ok(box.closest('.check-item').classList.contains('done'), 'the ticked row should re-render as done');
    neq(q('#checkBar').style.width, before, 'the progress bar should advance after a tick');
  });

  test('the progress bar width equals the checklist completion percentage', () => {
    const { done, total } = progressCounts();
    eq(q('#checkBar').style.width, Math.round(done / total * 100) + '%',
      'the bar width should be the rounded completion percentage');
  });

  test('completing a meeting flows into the auto group with no manual tick', async () => {
    await Store.completeEmployeeMeeting(CURRENT_USER, 'mtg_frontdesk');
    await refresh();
    const rows = qa('#checkGroups .check-group')[2].querySelectorAll('.check-item');
    eq(rows[1].querySelector('input').checked, true, 'the auto item should follow the meeting status');
    eq(text(rows[1].querySelector('.auto .chip')), 'Complete', 'its chip should read Complete');
    ok(rows[1].classList.contains('done'), 'its row should render as done');
  });
});

/* --- render --- */
suite('render · home', () => {

  test('the ring percentage and dash offset agree with progressCounts()', () => {
    const { done, total } = progressCounts();
    const pct = Math.round(done / total * 100);
    eq(text('#ringPct'), pct + '%', 'the ring label should be the checklist completion percentage');
    const offset = parseFloat(q('#ringFill').style.strokeDashoffset);
    lt(Math.abs(offset - (289 - 289 * pct / 100)), 0.01,
      'the ring stroke offset should be the unfilled fraction of the 289-unit circumference');
  });

  test('the seeded user starts at six of twenty-two checklist items', () => {
    const { done, total } = progressCounts();
    eq(total, 22, 'the seeded user has 22 checklist items');
    eq(done, 6, 'the seeded user has six of them done');
    eq(text('#statCheck'), '6 / 22', 'the checklist stat should read done over total');
    eq(text('#ringPct'), '27%', 'six of twenty-two rounds to 27%');
  });

  test('the meetings stat counts completed over applicable meetings', () => {
    eq(text('#statMeet'), '1 / 4', 'one of the seeded user four meetings is complete');
  });

  test('the training stat follows the login checklist item', async () => {
    eq(text('#statTrain'), 'Not yet', 'the seeded user has not confirmed their login');
    await Store.setChecklistItem(CURRENT_USER, 'itm_login', true);
    await refresh();
    eq(text('#statTrain'), 'Confirmed', 'confirming the login should flip the training stat');
  });

  test('up next names the first incomplete meeting', () => {
    eq(text('#upNext .numeral'), 'II', 'the first incomplete meeting is step II');
    eq(text('#upNext h3'), 'Front Desk & Concierge Standards', 'up next should name that meeting');
    has(text('#upNext .sub'), 'Wed Jul 15 · 9:30 AM', 'a booked next step should show its time');
    has(text('#upNext .sub'), 'Bobby · Manager', 'a booked next step should show its host');
    const btn = q('#upNext button');
    eq(text(btn), 'View details', 'a booked next step should offer the details');
    eq(handlerArg(btn, 'openMeeting'), 'mtg_frontdesk', 'the button should open the meeting it names');
  });

  test('an unscheduled next step invites the user to pick a time', async () => {
    const inst = DB.employeeMeetings.find(x => x.id === 'em_2');
    inst.status = 'pending';
    inst.when = null;
    await refresh();
    has(text('#upNext .sub'), 'Not scheduled yet', 'an unbooked next step should say so');
    has(text('#upNext .sub'), 'Bobby · Manager', 'an unbooked next step should still name the host');
    eq(text(q('#upNext button')), 'Pick a time', 'an unbooked next step should offer the picker');
  });

  test('the up-next card is replaced once every meeting is complete', async () => {
    for (const em of DB.employeeMeetings.filter(x => x.employeeId === CURRENT_USER)) em.status = 'complete';
    await refresh();
    has(text('#upNext'), 'All 4 meetings complete.', 'the finished state should count the meetings');
    notOk(q('#upNext .numeral'), 'the finished card should drop the step numeral');
    notOk(q('#upNext button'), 'the finished card should drop the call to action');
    eq(text('#statMeet'), '4 / 4', 'the meetings stat should agree with the finished card');
  });

  test('the home stats re-render after a checklist change', async () => {
    await Store.setChecklistItem(CURRENT_USER, 'itm_ec', true);
    await refresh();
    eq(text('#statCheck'), '7 / 22', 'the checklist stat should count the newly ticked item');
    eq(text('#ringPct'), Math.round(7 / 22 * 100) + '%', 'the ring should move with the checklist stat');
  });
});

/* --- render --- */
suite('render · training screen', () => {

  /* confirmLogin() writes the button label imperatively, and the harness restores
     data but not DOM text a previous test typed in — so put the page back to its
     as-loaded label before asserting what a fresh render produces. */
  const AS_LOADED = 'Confirm my login works';

  test('KNOWN ISSUE: a login already confirmed in state renders as confirmed', async () => {
    q('#loginBtn').textContent = AS_LOADED;
    await Store.setChecklistItem(CURRENT_USER, 'itm_login', true);
    await refresh();
    go('s-training');
    eq(text('#loginBtn'), '✓ Login confirmed',
      'the login button is derived state and should render confirmed on any re-render, not only in the moment the user clicks it');
  });

  test('confirming the login updates both the button and the home stat', async () => {
    q('#loginBtn').textContent = AS_LOADED;
    eq(text('#statTrain'), 'Not yet', 'the seeded user has not confirmed their login yet');
    await confirmLogin();
    eq(text('#loginBtn'), '✓ Login confirmed', 'the button should acknowledge the confirmation');
    eq(text('#statTrain'), 'Confirmed', 'the home training stat should agree');
    ok(findItem('itm_login').done, 'the matching checklist item should be recorded as done');
  });
});

/* --- render --- */
suite('render · team wall and member profile', () => {

  test('one card per team member, in roster order, wired to openMember', () => {
    const cards = qa('#teamGrid .member');
    len(cards, 5, 'the seed ships five artisans');
    len(cards, state.team.length, 'every team member should get a card');
    deepEq(cards.map(c => text(c.querySelector('h3'))), state.team.map(t => t.name),
      'cards should be titled and ordered by the roster');
    deepEq(cards.map(c => handlerArg(c, 'openMember')), state.team.map(t => t.id),
      'each card should open its own profile');
    deepEq(cards.map(c => text(c.querySelector('.mrole'))), state.team.map(t => t.role),
      'each card should show the member role');
  });

  test('a member without a photo shows their monogram', () => {
    const cards = qa('#teamGrid .member');
    cards.forEach((c, i) => {
      notOk(c.querySelector('.photo img'), 'no seeded member has a photo yet');
      eq(text(c.querySelector('.photo .mono')), state.team[i].initials,
        'the placeholder should be the member initials');
      ok(c.querySelector('.tag-cam'), 'the placeholder should be tagged as a missing headshot');
    });
  });

  test('a member with a photo shows the image instead of the monogram', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    await Store.setTeamPhoto('tm_kris', png);
    await refresh();
    const card = qa('#teamGrid .member').find(c => handlerArg(c, 'openMember') === 'tm_kris');
    const img = card.querySelector('.photo img');
    ok(img, 'a member with a photoUrl should render an image');
    eq(img.getAttribute('src'), png, 'the image should point at the stored photo');
    eq(img.getAttribute('alt'), 'Kris', 'the image should be labelled with the member name');
    notOk(card.querySelector('.photo .mono'), 'the monogram should give way to the photo');
    notOk(card.querySelector('.tag-cam'), 'the missing-headshot tag should disappear');
  });

  test('the count word matches the roster size', async () => {
    eq(text('#teamCount'), 'Five', 'five members should read as "Five"');
    await Store.deleteTeamMember('tm_cathy');
    await refresh();
    eq(text('#teamCount'), 'Four', 'the count word should follow a removal');
    len(qa('#teamGrid .member'), 4, 'the removed member should leave the wall');
  });

  test('a newly added member appears on the wall', async () => {
    const row = await Store.addTeamMember({ name: 'Nina Reyes', role: 'Barber', specialties: ['Fades'] });
    await refresh();
    const card = qa('#teamGrid .member').find(c => handlerArg(c, 'openMember') === row.id);
    ok(card, 'the new member should get a card');
    eq(text(card.querySelector('h3')), 'Nina Reyes', 'the card should carry the new name');
    eq(text(card.querySelector('.photo .mono')), 'NR', 'the card should derive a monogram');
    eq(text('#teamCount'), 'Six', 'the count word should follow the addition');
  });

  test('openMember renders bio, specialties and one button per hosted meeting', () => {
    openMember('tm_charlie');
    eq(current, 's-member', 'opening a profile should make the member screen current');
    ok(shown('#s-member'), 'the member screen should be the visible one');
    const t = state.team.find(x => x.id === 'tm_charlie');
    eq(text('#s-member h1'), t.name, 'the profile should be titled with the member name');
    has(text('#s-member'), t.bio, 'the profile should render the bio');
    has(text('#s-member .mrole'), t.role, 'the profile should render the role');
    has(text('#s-member .mrole'), t.experience, 'the profile should render the experience line');
    for (const s of t.specialties) has(text('#s-member'), s, 'every specialty should be rendered');
    const hosts = qa('#s-member .md-hosts button');
    len(hosts, 2, 'Charlie hosts two of the onboarding meetings');
    deepEq(hosts.map(b => handlerArg(b, 'openMember_toMeeting')), ['mtg_handbook', 'mtg_acd'],
      'each host button should jump to the meeting it names');
    has(text(hosts[0]), 'Step I', 'the host button should name the step');
    has(text(hosts[0]), 'Handbook Meeting', 'the host button should name the meeting');
  });

  test('a member with no experience renders no dangling separator', () => {
    openMember('tm_juan');
    eq(text('#s-member .mrole'), 'Senior Stylist', 'an empty experience should not leave a separator');
  });

  test('a member who hosts nothing gets no onboarding block', () => {
    openMember('tm_kris');
    lacks(text('#s-member'), 'In your onboarding', 'Kris hosts no onboarding meeting');
    len(qa('#s-member .md-hosts'), 0, 'no host block should be rendered');
  });

  test('specialties render both as header tags and as chips in the specialties card', () => {
    openMember('tm_bobby');
    const t = state.team.find(x => x.id === 'tm_bobby');
    len(qa('#s-member .md-body .tags .chip'), t.specialties.length, 'every specialty should tag the header');
    len(qa('#s-member .card .chip.role'), t.specialties.length, 'every specialty should chip the card');
  });

  test('an unknown member id falls back to the team wall', () => {
    openMember('tm_does_not_exist');
    eq(current, 's-team', 'an unknown member should send the user back to the wall');
  });
});

/* --- render --- */
suite('render · admin roster', () => {

  test('one row per employee with name, day label, role and next step', () => {
    setMode('admin');
    const rows = qa('#rosterBody tr.row');
    len(rows, 4, 'the seed ships four onboarding employees');
    deepEq(rows.map(r => text(r.querySelector('strong'))), state.employees.map(e => e.name),
      'each row should be titled with the employee name');
    deepEq(rows.map(r => text(r.querySelector('.who-role'))), state.employees.map(e => e.dayLabel),
      'each row should show the day label');
    deepEq(rows.map(r => text(r.children[1])), state.employees.map(e => e.role),
      'each row should show the role');
    deepEq(rows.map(r => handlerArg(r, 'openEmp')), state.employees.map(e => e.id),
      'each row should open its own employee');
  });

  test('the next-step column names the first incomplete meeting', () => {
    setMode('admin');
    deepEq(qa('#rosterBody tr.row').map(r => text(r.children[3])), [
      'Step II · Front Desk & Concierge',
      'Step IV · Continued Development intro',
      'Complete',
      'Step I · Handbook Meeting'
    ], 'the next-step column should walk each employee journey in order');
  });

  test('the progress bar width matches the stored progress', () => {
    setMode('admin');
    qa('#rosterBody tr.row').forEach((r, i) => {
      eq(r.querySelector('.mini-bar i').style.width, state.employees[i].progress + '%',
        'the bar should be as wide as the employee progress');
      has(text(r.children[2]), state.employees[i].progress + '%',
        'the progress cell should also print the number');
    });
  });

  test('training access renders as a chip per employee', () => {
    setMode('admin');
    deepEq(qa('#rosterBody tr.row').map(r => text(r.children[4])),
      ['Pending', 'Confirmed', 'Confirmed', 'Pending'],
      'the access column should mirror each trainingAccess flag');
  });

  test('#statAccess counts the employees still awaiting training access', async () => {
    setMode('admin');
    eq(text('#statAccess'), '2', 'two seeded employees are still waiting');
    await Store.setTrainingAccess('emp_jordan', true);
    await refresh();
    eq(text('#statAccess'), '1', 'granting access should drop the count');
    await Store.setTrainingAccess('emp_maya', false);
    await refresh();
    eq(text('#statAccess'), '2', 'revoking access should raise the count again');
  });

  test('the headline onboarding count is derived, not a literal', async () => {
    setMode('admin');
    DB.employees.push({
      id: 'emp_nina', name: 'Nina Reyes', initials: 'NR', role: 'Barber', dayLabel: 'Day 1',
      eligibleForAsp: false, trainingAccess: false, progress: 0, isCurrentUser: false, adminNotes: ''
    });
    await refresh();
    len(qa('#rosterBody tr.row'), 5, 'the roster table should list the new employee');
    /* The tile reads "Currently onboarding", so it counts people who still have
       a next step — Leo has finished and is on the books, and should not be
       counted as still onboarding. */
    eq(text(qa('#a-overview .stat b')[0]), '4',
      'the headline should count employees whose journey is not yet complete');
    await Store.completeEmployeeMeeting('emp_nina', 'mtg_handbook');
    await Store.completeEmployeeMeeting('emp_nina', 'mtg_frontdesk');
    await Store.completeEmployeeMeeting('emp_nina', 'mtg_acd');
    await refresh();
    eq(text(qa('#a-overview .stat b')[0]), '3', 'finishing a journey should drop the count');
  });
});

/* --- render --- */
suite('render · admin employee detail', () => {

  test('renders a row per meeting, including steps outside the employee role', async () => {
    setMode('admin');
    await openEmp('emp_maya');
    eq(current, 'a-employee', 'opening an employee should make the detail screen current');
    ok(shown('#a-employee'), 'the employee detail screen should be the visible one');
    const rows = qa('#a-employee .emp-meet');
    len(rows, 4, 'admin sees all four meetings so a role-only step can still be assigned');
    deepEq(rows.map(r => text(r.querySelector('.numeral'))), ['I', 'II', 'III', 'IV'],
      'the journey should be numbered in step order');
    deepEq(rows.map(r => text(r.querySelector('strong'))),
      ['Handbook Meeting', 'Front Desk & Concierge', 'Assistant Stylist Program', 'Continued Development intro'],
      'each row should use the meeting short title');
  });

  test('role-only rows are labelled and the rest read as required for all', async () => {
    setMode('admin');
    await openEmp('emp_jordan');
    deepEq(qa('#a-employee .emp-meet .who-role').map(el => text(el)),
      ['Required for all', 'Required for all', 'Role-based step', 'Required for all'],
      'only the role-only meeting should be labelled as role-based');
  });

  test('Assign to this role appears only for an ineligible role-only step', async () => {
    setMode('admin');
    await openEmp('emp_maya');
    const rows = qa('#a-employee .emp-meet');
    const asp = rows[2];
    eq(text(asp.querySelector('.chip')), 'Not required', 'an unassigned role-only step reads Not required');
    const btns = Array.from(asp.querySelectorAll('button'));
    len(btns, 1, 'an unassigned role-only step should offer exactly one action');
    eq(text(btns[0]), 'Assign to this role', 'that action should be the assignment');
    eq(handlerArg(btns[0], 'assignProgram'), 'emp_maya', 'the assignment should target this employee');
    rows.filter((r, i) => i !== 2).forEach(r => lacks(text(r), 'Assign to this role',
      'no other row should offer a role assignment'));
  });

  test('an eligible employee gets scheduling actions instead of the assign button', async () => {
    setMode('admin');
    await openEmp('emp_jordan');
    const asp = qa('#a-employee .emp-meet')[2];
    lacks(text(asp), 'Assign to this role', 'an eligible employee is already on the program');
    has(text(asp), 'Assign time', 'a pending step should offer a time');
    has(text(asp), 'Mark complete', 'a pending step should also be completable');
  });

  test('Mark complete is offered for anything not complete and withheld once complete', async () => {
    setMode('admin');
    await openEmp('emp_jordan');
    const rows = qa('#a-employee .emp-meet');
    eq(text(rows[0].querySelector('.chip')), 'Complete', 'the handbook meeting is already complete');
    len(rows[0].querySelectorAll('button'), 0, 'a completed step should offer no actions');
    has(text(rows[1]), 'Mark complete', 'a scheduled step should still be completable');
    lacks(text(rows[1]), 'Assign time', 'a scheduled step already has a time');
    has(text(rows[3]), 'Assign time', 'a pending step should offer a time');
    has(text(rows[3]), 'Mark complete', 'a pending step should also be completable');
    const btn = Array.from(rows[1].querySelectorAll('button')).find(b => text(b) === 'Mark complete');
    eq(handlerArg(btn, 'adminComplete'), 'emp_jordan', 'the completion should target this employee');
  });

  test('a finished employee shows completion chips and no completion actions', async () => {
    setMode('admin');
    await openEmp('emp_leo');
    const rows = qa('#a-employee .emp-meet');
    deepEq(rows.map(r => text(r.querySelector('.chip'))),
      ['Complete', 'Complete', 'Not required', 'Complete'],
      'a finished employee should read complete on every applicable step');
    for (const i of [0, 1, 3]) {
      lacks(text(rows[i]), 'Mark complete', 'a completed step should not offer completion');
    }
  });

  test('the access switch reflects the stored flag in aria-checked and its class', async () => {
    setMode('admin');
    await openEmp('emp_jordan');
    let sw = q('#a-employee .switch');
    eq(sw.getAttribute('aria-checked'), 'false', 'an employee without access reads aria-checked false');
    notOk(sw.classList.contains('on'), 'an employee without access should not render the on state');
    await openEmp('emp_maya');
    sw = q('#a-employee .switch');
    eq(sw.getAttribute('aria-checked'), 'true', 'an employee with access reads aria-checked true');
    ok(sw.classList.contains('on'), 'an employee with access should render the on state');
  });

  test('the notes textarea is prefilled from the employee record', async () => {
    setMode('admin');
    await openEmp('emp_jordan');
    eq(q('#noteBox').value, DB.employees.find(e => e.id === 'emp_jordan').adminNotes,
      'the notes box should be prefilled with the stored note');
    await openEmp('emp_sam');
    eq(q('#noteBox').value, '', 'an employee with no note should get an empty box');
  });

  test('the detail header shows the employee identity and progress', async () => {
    setMode('admin');
    await openEmp('emp_maya');
    eq(text('#a-employee h1'), 'Maya Chen', 'the header should name the employee');
    eq(text('#a-employee .avatar'), 'MC', 'the header should show the employee monogram');
    has(text('#a-employee .sub'), 'Front Desk Concierge', 'the header should show the role');
    has(text('#a-employee .sub'), 'Day 11', 'the header should show the day label');
    has(text('#a-employee .sub'), '80% onboarded', 'the header should show the stored progress');
  });
});

/* --- render --- */
suite('render · admin meeting times and content', () => {

  test('one card per meeting, showing its own slots', () => {
    setMode('admin');
    go('a-slots');
    const cards = qa('#slotCards .card');
    len(cards, 4, 'there is one card per onboarding meeting');
    len(cards, state.meetings.length, 'every meeting should get a card');
    cards.forEach((c, i) => {
      const m = state.meetings[i];
      eq(text(c.querySelector('h3')), m.title, 'each card should be titled with the meeting');
      eq(text(c.querySelector('.numeral')), m.roman, 'each card should show the step numeral');
      deepEq(Array.from(c.querySelectorAll('.slot')).map(s => text(s)),
        DB.slots.filter(s => s.meetingId === m.id).map(s => s.when),
        'each card should list exactly its own times');
    });
  });

  test('the host select preselects the meeting default host', () => {
    setMode('admin');
    go('a-slots');
    for (const m of state.meetings) {
      const sel = q('#host_' + m.id);
      ok(sel, 'each meeting card should render a host select');
      eq(sel.value, m.defaultHost, 'the host select should report the stored default host');
      eq(sel.selectedOptions[0].textContent, m.defaultHost, 'the selected option should be the stored host');
    }
  });

  test('the role-only meeting card says it is assigned by role', () => {
    setMode('admin');
    go('a-slots');
    const cards = qa('#slotCards .card');
    eq(text(cards[2].querySelector('.sub')), 'Assigned to relevant roles only',
      'the role-only meeting should be described as such');
    eq(text(cards[0].querySelector('.sub')), 'Required for all new hires',
      'every other meeting should be described as required');
  });

  test('a newly added time renders on its own meeting card', async () => {
    setMode('admin');
    go('a-slots');
    await Store.addSlot('mtg_handbook', { when: 'Fri Jul 24 · 1:00 PM', host: 'Charlie · Owner' });
    await refresh();
    const card = qa('#slotCards .card')[0];
    len(card.querySelectorAll('.slot'), 3, 'the handbook card should now list three times');
    has(text(card), 'Fri Jul 24 · 1:00 PM', 'the new time should be rendered');
    len(qa('#slotCards .card')[1].querySelectorAll('.slot'), 3, 'the other cards should be untouched');
  });

  test('a meeting with no times says so instead of rendering an empty row', async () => {
    DB.slots.length = 0;
    await refresh();
    setMode('admin');
    go('a-slots');
    len(qa('#slotCards .slot'), 0, 'there are no times to render');
    len(qa('#slotCards .card').filter(c => text(c).includes('No times yet.')), 4,
      'every card should explain that it has no times');
  });

  test('KNOWN ISSUE: the host select reports the stored host even when it is off the built-in list', async () => {
    DB.meetings.find(m => m.id === 'mtg_handbook').defaultHost = 'Cathy · Kids Specialist';
    await refresh();
    setMode('admin');
    go('a-slots');
    eq(q('#host_mtg_handbook').value, 'Cathy · Kids Specialist',
      'the host control must not silently misreport who hosts the meeting');
  });

  test('renderContentForm syncs both fields from state.content', async () => {
    setMode('admin');
    go('a-content');
    eq(q('#welcomeTxt').value, state.content.welcomeMessage, 'the welcome field should mirror state');
    eq(q('#trainUrl').value, state.content.trainingUrl, 'the training url field should mirror state');
    await Store.updateContent({ welcomeMessage: 'New welcome copy.', trainingUrl: 'https://learn.example.com' });
    await refresh();
    eq(q('#welcomeTxt').value, 'New welcome copy.', 'the welcome field should re-sync after a save');
    eq(q('#trainUrl').value, 'https://learn.example.com', 'the training url field should re-sync after a save');
  });
});

/* --- render --- */
suite('render · admin team and photos', () => {

  test('one row per team member with thumb, details and three actions', () => {
    setMode('admin');
    go('a-team');
    const rows = qa('#teamAdmin .tm-row');
    len(rows, state.team.length, 'every team member should get an admin row');
    deepEq(rows.map(r => text(r.querySelector('strong'))), state.team.map(t => t.name),
      'admin rows should be ordered like the roster');
    rows.forEach((r, i) => {
      eq(text(r.querySelector('.tm-thumb .mono')), state.team[i].initials,
        'a member without a photo should show their monogram');
      has(text(r), 'No photo yet', 'a member without a photo should be flagged');
      const btns = Array.from(r.querySelectorAll('button'));
      deepEq(btns.map(b => text(b)), ['Upload headshot', 'Edit', 'Remove'],
        'each row should offer upload, edit and remove');
      eq(handlerArg(btns[0], 'pickHeadshot'), state.team[i].id, 'upload should target this member');
      eq(handlerArg(btns[1], 'openEditMember'), state.team[i].id, 'edit should target this member');
      eq(handlerArg(btns[2], 'removeMember'), state.team[i].id, 'remove should target this member');
    });
  });

  test('a member with a photo swaps the monogram for an image and relabels the button', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    await Store.setTeamPhoto('tm_bobby', png);
    await refresh();
    setMode('admin');
    go('a-team');
    const row = qa('#teamAdmin .tm-row')
      .find(r => handlerArg(r.querySelector('button'), 'pickHeadshot') === 'tm_bobby');
    ok(row, 'the member should still have an admin row');
    const img = row.querySelector('.tm-thumb img');
    ok(img, 'the thumb should become an image');
    eq(img.getAttribute('src'), png, 'the thumb should point at the stored photo');
    notOk(row.querySelector('.tm-thumb .mono'), 'the monogram should give way to the photo');
    has(text(row), 'Photo set', 'the row should report that a photo exists');
    eq(text(row.querySelector('button')), 'Replace photo', 'the upload button should offer a replacement');
  });

  test('the edit form prefills every field from the member record', () => {
    setMode('admin');
    go('a-team');
    openEditMember('tm_juan');
    const t = state.team.find(x => x.id === 'tm_juan');
    eq(q('#memberForm').style.display, 'block', 'editing should reveal the form');
    eq(text('#memberFormTitle'), 'Edit Juan Hernandez', 'the form should be titled for the member');
    eq(q('#mfName').value, t.name, 'the name should be prefilled');
    eq(q('#mfRole').value, t.role, 'the role should be prefilled');
    eq(q('#mfSince').value, '', 'an empty experience should stay empty');
    eq(q('#mfTags').value, 'Mentorship, Precision fades', 'specialties should be prefilled comma-separated');
    eq(q('#mfBio').value, t.bio, 'the bio should be prefilled');
    eq(q('#mfPhotoRow').style.display, 'none', 'a member with no photo gets no remove-photo row');
  });

  test('the add form opens blank', () => {
    setMode('admin');
    go('a-team');
    openEditMember('tm_juan');
    openAddMember();
    eq(text('#memberFormTitle'), 'Add team member', 'the form should be titled for a new member');
    eq(q('#mfName').value, '', 'the name should be cleared');
    eq(q('#mfRole').value, '', 'the role should be cleared');
    eq(q('#mfTags').value, '', 'the specialties should be cleared');
    eq(q('#mfBio').value, '', 'the bio should be cleared');
    eq(q('#memberForm').style.display, 'block', 'adding should reveal the form');
  });

  test('a member with a photo gets a remove-photo control in the edit form', async () => {
    await Store.setTeamPhoto('tm_kris', 'data:image/png;base64,iVBORw0KGgo=');
    await refresh();
    setMode('admin');
    go('a-team');
    openEditMember('tm_kris');
    eq(q('#mfPhotoRow').style.display, 'block', 'the remove-photo row should be revealed');
    eq(handlerArg(q('#mfPhotoRow button'), 'removeHeadshot'), 'tm_kris',
      'the remove control should target this member');
  });
});

/* --- render --- */
suite('render · toast', () => {

  test('toast shows the message and reveals the banner', () => {
    toast('Saved it');
    eq(text('#toast'), 'Saved it', 'the toast should print the message it was given');
    ok(q('#toast').classList.contains('show'), 'the toast should be revealed');
  });

  test('a later toast replaces the earlier message', () => {
    toast('First');
    toast('Second');
    eq(text('#toast'), 'Second', 'the newest message should win');
    ok(q('#toast').classList.contains('show'), 'the toast should stay revealed');
  });

  test('an action reports itself through the toast', async () => {
    await tick('itm_ec', true);
    eq(text('#toast'), 'Checked off', 'ticking an item should confirm through the toast');
    ok(q('#toast').classList.contains('show'), 'the confirmation should be visible');
  });
});

/* --- flows --- */
suite('Flows · employee · picking a time', () => {
  /* Inline onclick handlers are async; the prototype's stand-in latency resolves
     in microtasks, so draining the queue is enough to let a click finish. */
  const settle = async () => { for (let i = 0; i < 300; i++) await Promise.resolve(); };
  /* Find the element wired to fn('arg') — the app renders handlers inline. */
  const action = (scope, fn, arg) => qa(scope + ' [onclick]').find(el => {
    const a = el.getAttribute('onclick') || '';
    return a.indexOf(fn + '(') === 0 && (arg == null || a.indexOf("'" + arg + "'") > -1);
  });

  test('picking a slot books the meeting and swaps the picker for the booked panel', async () => {
    go('s-meetings');
    const step = action('#rail', 'openMeeting', 'mtg_assistant');
    ok(step, 'the rail should list step III for an ASP-eligible hire');
    has(text(step), 'Not scheduled', 'step III should start out unscheduled');
    click(step);
    ok(shown('#s-meeting'), 'clicking a rail step should open the meeting detail screen');
    has(text('#s-meeting'), 'Pick a time', 'a pending meeting should open on the slot picker');
    const slots = qa('#s-meeting .slot');
    len(slots, 3, 'step III should offer its three seeded times');
    eq(text(slots[0]), 'Thu Jul 16 · 3:30 PM', 'the first offered time should be the first seeded slot');

    click(slots[0]);
    await settle();

    const inst = DB.employeeMeetings.find(x => x.employeeId === CURRENT_USER && x.meetingId === 'mtg_assistant');
    eq(inst.status, 'scheduled', 'picking a slot should move the instance to scheduled');
    eq(inst.when, 'Thu Jul 16 · 3:30 PM', 'the instance should store the time that was clicked');
    ok(shown('#s-meeting'), 'the app should stay on the meeting detail after booking');
    has(text('#s-meeting'), "You're booked", 'the picker should be replaced by the booked panel');
    has(text('#s-meeting'), 'Thu Jul 16 · 3:30 PM', 'the booked panel should name the chosen time');
    eq(text('#s-meeting .detail-head .chip'), 'Scheduled', 'the detail header chip should read Scheduled');
    len(qa('#s-meeting .slot'), 0, 'the slot picker should be gone once a time is chosen');
  });

  test('booking adopts the host attached to the chosen slot', async () => {
    go('s-meetings');
    click(action('#rail', 'openMeeting', 'mtg_assistant'));
    click(qa('#s-meeting .slot')[0]);
    await settle();
    const inst = DB.employeeMeetings.find(x => x.employeeId === CURRENT_USER && x.meetingId === 'mtg_assistant');
    eq(inst.host, 'Juan · Senior Stylist', 'the booked instance should take the host from the slot');
    has(text('#s-meeting'), 'Juan · Senior Stylist', 'the booked panel should name the host');
  });

  test('the rail and the meetings stat follow the booking', async () => {
    go('s-meetings');
    click(action('#rail', 'openMeeting', 'mtg_assistant'));
    click(qa('#s-meeting .slot')[1]);
    await settle();
    const step = qa('#rail .step')[2];
    ok(step.classList.contains('scheduled'), 'the rail step should carry the scheduled state class');
    has(text(step), 'Scheduled', 'the rail step should show the Scheduled chip');
    has(text(step), 'Fri Jul 17 · 10:00 AM', 'the rail meta should show the booked time');
    eq(text('#statMeet'), '1 / 4', 'booking a time should not count as completing a meeting');
  });

  test('the home Up next card follows the booking', async () => {
    /* Put step II back in the pending state so it is genuinely "up next". */
    const em = DB.employeeMeetings.find(x => x.id === 'em_2');
    em.status = 'pending'; em.when = null;
    await refresh();

    has(text('#upNext'), 'Front Desk & Concierge Standards', 'step II should be up next');
    has(text('#upNext'), 'Not scheduled yet', 'an unbooked up-next meeting should say so');
    eq(text('#upNext button'), 'Pick a time', 'the up-next button should invite picking a time');

    click(q('#upNext button'));
    ok(shown('#s-meeting'), 'the up-next button should open the meeting detail');
    const slot = qa('#s-meeting .slot').find(s => text(s) === 'Thu Jul 16 · 2:00 PM');
    ok(slot, 'step II should offer the Thursday afternoon slot');
    click(slot);
    await settle();

    has(text('#upNext'), 'Thu Jul 16 · 2:00 PM', 'the up-next card should show the time just booked');
    has(text('#upNext'), 'Bobby · Manager', 'the up-next card should show the host');
    lacks(text('#upNext'), 'Not scheduled yet', 'the up-next card should no longer say unscheduled');
    eq(text('#upNext button'), 'View details', 'a booked up-next meeting should offer details, not a picker');
  });

  test('a meeting with no available times tells the employee to check back', async () => {
    DB.slots = DB.slots.filter(s => s.meetingId !== 'mtg_assistant');
    await refresh();
    go('s-meetings');
    click(action('#rail', 'openMeeting', 'mtg_assistant'));
    len(qa('#s-meeting .slot'), 0, 'no slots should render no slot buttons');
    has(text('#s-meeting'), 'No times available yet', 'an empty picker should explain itself');
  });
});

/* --- flows --- */
suite('Flows · employee · rescheduling', () => {
  const settle = async () => { for (let i = 0; i < 300; i++) await Promise.resolve(); };
  const action = (scope, fn, arg) => qa(scope + ' [onclick]').find(el => {
    const a = el.getAttribute('onclick') || '';
    return a.indexOf(fn + '(') === 0 && (arg == null || a.indexOf("'" + arg + "'") > -1);
  });
  const openFrontDesk = () => { go('s-meetings'); click(action('#rail', 'openMeeting', 'mtg_frontdesk')); };

  test('Reschedule reopens the picker with a keep-the-current-time escape hatch', () => {
    openFrontDesk();
    has(text('#s-meeting'), "You're booked", 'a scheduled meeting should open on the booked panel');
    click(action('#s-meeting', 'reschedule', 'mtg_frontdesk'));
    eq(rescheduleId, 'mtg_frontdesk', 'Reschedule should arm the picker for that meeting');
    has(text('#s-meeting'), 'Choose a new time', 'the picker should announce it is a re-pick');
    len(qa('#s-meeting .slot'), 3, 'every seeded time for step II should be offered again');
    const keep = action('#s-meeting', 'cancelReschedule', 'mtg_frontdesk');
    ok(keep, 'the re-pick should offer a way back to the current booking');
    eq(text(keep), 'Keep Wed Jul 15 · 9:30 AM', 'the escape hatch should name the time being kept');
  });

  test('choosing a different slot moves the meeting to the new time', async () => {
    openFrontDesk();
    click(action('#s-meeting', 'reschedule', 'mtg_frontdesk'));
    const other = qa('#s-meeting .slot').find(s => text(s) !== 'Wed Jul 15 · 9:30 AM');
    ok(other, 'a reschedule needs at least one alternative time');
    click(other);
    await settle();

    const inst = DB.employeeMeetings.find(x => x.id === 'em_2');
    eq(inst.when, 'Thu Jul 16 · 2:00 PM', 'the instance should hold the newly chosen time');
    eq(inst.status, 'scheduled', 'rescheduling should leave the meeting scheduled');
    eq(rescheduleId, null, 'the reschedule flag should clear once a new time is chosen');
    has(text('#s-meeting'), "You're booked", 'the booked panel should come back after re-picking');
    has(text('#s-meeting'), 'Thu Jul 16 · 2:00 PM', 'the booked panel should show the new time');
    has(text(qa('#rail .step')[1]), 'Thu Jul 16 · 2:00 PM', 'the rail should show the new time too');
  });

  test('keeping the current time restores the booked panel and changes nothing', () => {
    openFrontDesk();
    click(action('#s-meeting', 'reschedule', 'mtg_frontdesk'));
    click(action('#s-meeting', 'cancelReschedule', 'mtg_frontdesk'));

    eq(rescheduleId, null, 'cancelling should disarm the picker');
    has(text('#s-meeting'), "You're booked", 'cancelling should restore the booked panel');
    has(text('#s-meeting'), 'Wed Jul 15 · 9:30 AM', 'the original time should still be shown');
    len(qa('#s-meeting .slot'), 0, 'the slot picker should be gone again');
    const inst = DB.employeeMeetings.find(x => x.id === 'em_2');
    eq(inst.when, 'Wed Jul 15 · 9:30 AM', 'cancelling must not touch the stored time');
    eq(inst.status, 'scheduled', 'cancelling must not touch the stored status');
  });

  test('leaving the meeting detail cancels a half-finished reschedule', () => {
    openFrontDesk();
    click(action('#s-meeting', 'reschedule', 'mtg_frontdesk'));
    click('#s-meeting .back');
    ok(shown('#s-meetings'), 'the back button should return to the journey');
    eq(rescheduleId, null, 'walking away from the picker should disarm it');
    click(action('#rail', 'openMeeting', 'mtg_frontdesk'));
    has(text('#s-meeting'), "You're booked",
      're-opening the meeting should show the existing booking, not a stale re-pick screen');
  });
});

/* --- flows --- */
suite('Flows · employee · handbook acknowledgment', () => {
  const settle = async () => { for (let i = 0; i < 300; i++) await Promise.resolve(); };
  const action = (scope, fn, arg) => qa(scope + ' [onclick]').find(el => {
    const a = el.getAttribute('onclick') || '';
    return a.indexOf(fn + '(') === 0 && (arg == null || a.indexOf("'" + arg + "'") > -1);
  });
  const unacknowledge = async () => {
    DB.employeeMeetings.find(x => x.id === 'em_1').acknowledgedAt = null;
    await refresh();
  };
  const openHandbook = () => { go('s-meetings'); click(action('#rail', 'openMeeting', 'mtg_handbook')); };

  test('acknowledging stamps the instance and disables the button', async () => {
    await unacknowledge();
    openHandbook();
    const btn = q('#ackBtn');
    ok(btn, 'the handbook step should offer an acknowledge button');
    notOk(btn.disabled, 'the button should start enabled while the handbook is unacknowledged');
    eq(text(btn), 'Acknowledge handbook', 'the button should invite acknowledgment');

    click(btn);
    await settle();

    const inst = DB.employeeMeetings.find(x => x.id === 'em_1');
    ok(inst.acknowledgedAt, 'acknowledging should stamp acknowledgedAt on the instance');
    match(inst.acknowledgedAt, /^\d{4}-\d{2}-\d{2}T/, 'acknowledgedAt should be an ISO timestamp');
    const after = q('#ackBtn');
    ok(after.disabled, 'the button should be disabled once the handbook is acknowledged');
    has(text(after), 'Acknowledged', 'the button should read back as acknowledged');
  });

  test('re-rendering the meeting keeps the acknowledgment locked in', async () => {
    await unacknowledge();
    openHandbook();
    click(q('#ackBtn'));
    await settle();
    go('s-meetings');
    click(action('#rail', 'openMeeting', 'mtg_handbook'));
    const btn = q('#ackBtn');
    ok(btn.disabled, 're-opening the meeting should keep the acknowledge button disabled');
    has(text(btn), 'Acknowledged', 're-opening should keep the acknowledged label');
    ok(state.me.meetings.find(m => m.meetingId === 'mtg_handbook').acknowledgedAt,
      'state should still carry the acknowledgment after a refresh');
  });

  test('a handbook acknowledged before this session opens already locked', () => {
    openHandbook();
    const btn = q('#ackBtn');
    ok(btn, 'the seeded handbook meeting should still show the acknowledgment block');
    ok(btn.disabled, 'a previously acknowledged handbook should not invite a second acknowledgment');
    has(text(btn), 'Acknowledged', 'the seeded acknowledgment should be reflected in the label');
  });

  test('only the handbook step asks for an acknowledgment', () => {
    go('s-meetings');
    click(action('#rail', 'openMeeting', 'mtg_frontdesk'));
    notOk(q('#ackBtn'), 'a meeting without requiresAck should render no acknowledge button');
    lacks(text('#s-meeting'), 'Handbook acknowledgment', 'step II should not show the acknowledgment block');
  });
});

/* --- flows --- */
suite('Flows · employee · checklist and progress', () => {
  const settle = async () => { for (let i = 0; i < 300; i++) await Promise.resolve(); };
  const bar = () => q('#checkBar').style.width;
  const offset = () => parseFloat(q('#ringFill').style.strokeDashoffset);

  test('the seeded checklist agrees with the ring and the counter', () => {
    go('s-checklist');
    eq(text('#statCheck'), '6 / 22', 'five seeded manual items plus the completed handbook meeting');
    eq(text('#ringPct'), '27%', 'the home ring should show the same 6 of 22');
    eq(bar(), '27%', 'the checklist bar should match the ring');
  });

  test('ticking an item moves the bar, the ring and the counter together', async () => {
    go('s-checklist');
    const before = offset();
    const box = q('#ck_itm_ec');
    ok(box, 'the emergency-contact item should render a checkbox');
    notOk(box.checked, 'that item starts unchecked in the seed');

    click(box);
    await settle();

    eq(text('#statCheck'), '7 / 22', 'the home counter should count the newly ticked item');
    eq(text('#ringPct'), '32%', 'the ring percentage should move with the counter');
    eq(bar(), '32%', 'the checklist bar should move with the counter');
    lt(offset(), before, 'the ring stroke should fill further as progress rises');
    const row = q('#ck_itm_ec').closest('.check-item');
    ok(row.classList.contains('done'), 'the ticked row should be styled as done');
    ok(DB.checklistState.some(s => s.employeeId === CURRENT_USER && s.itemId === 'itm_ec' && s.done),
      'the tick should be persisted as a checklist_state row');
  });

  test('unticking moves them all back', async () => {
    go('s-checklist');
    click(q('#ck_itm_ec'));
    await settle();
    const box = q('#ck_itm_ec');
    ok(box.checked, 'the re-rendered checkbox should come back checked');

    click(box);
    await settle();

    eq(text('#statCheck'), '6 / 22', 'unticking should give the item back');
    eq(text('#ringPct'), '27%', 'the ring should fall back with it');
    eq(bar(), '27%', 'the bar should fall back with it');
    notOk(q('#ck_itm_ec').checked, 'the checkbox should render unchecked again');
    const row = DB.checklistState.find(s => s.employeeId === CURRENT_USER && s.itemId === 'itm_ec');
    eq(row.done, false, 'the stored row should be flipped back to not-done, not deleted');
  });

  test('a tick survives navigating away and back', async () => {
    go('s-checklist');
    click(q('#ck_itm_dress'));
    await settle();
    go('s-home');
    eq(text('#statCheck'), '7 / 22', 'home should show the tick made on the checklist screen');
    go('s-checklist');
    ok(q('#ck_itm_dress').checked, 'returning to the checklist should show the item still ticked');
  });

  test('meeting-driven items are read-only for the employee', () => {
    go('s-checklist');
    const group = qa('#checkGroups .check-group')[2];
    has(text(group), 'Required meetings', 'the third group should be the auto meetings group');
    const boxes = Array.from(group.querySelectorAll('input[type=checkbox]'));
    len(boxes, 4, 'the auto group should mirror the four applicable meetings');
    ok(boxes.every(b => b.disabled), 'auto items must not be tickable by hand');
    ok(boxes[0].checked, 'the completed handbook meeting should show as done');
    notOk(boxes[1].checked, 'the still-scheduled step II should not show as done');
    has(text(group), 'Scheduled', 'the auto group should surface each meeting status as a chip');
  });
});

/* --- flows --- */
suite('Flows · employee · training access', () => {
  const settle = async () => { for (let i = 0; i < 300; i++) await Promise.resolve(); };
  const action = (scope, fn, arg) => qa(scope + ' [onclick]').find(el => {
    const a = el.getAttribute('onclick') || '';
    return a.indexOf(fn + '(') === 0 && (arg == null || a.indexOf("'" + arg + "'") > -1);
  });

  test('confirming the login ticks itm_login and flips the home stat', async () => {
    go('s-training');
    eq(text('#statTrain'), 'Not yet', 'training access starts unconfirmed for Jordan');
    notOk(findItem('itm_login').done, 'the login checklist item starts undone');

    click('#loginBtn');
    await settle();

    ok(findItem('itm_login').done, 'confirming should tick the login checklist item');
    ok(DB.checklistState.some(s => s.employeeId === CURRENT_USER && s.itemId === 'itm_login' && s.done),
      'the confirmation should be persisted');
    eq(text('#statTrain'), 'Confirmed', 'the home training stat should flip to Confirmed');
    eq(text('#statCheck'), '7 / 22', 'the checklist counter should include the login item');
    match(text('#loginBtn'), /confirmed/i, 'the button should read back as confirmed');
    go('s-checklist');
    ok(q('#ck_itm_login').checked, 'the checklist screen should show the login item ticked');
  });

  test('opening the training platform ticks itm_open', async () => {
    go('s-training');
    notOk(findItem('itm_open').done, 'the open-the-platform item starts undone');
    const btn = action('#s-training', 'openTraining');
    ok(btn, 'the training screen should offer a button that opens the platform');

    click(btn);
    await settle();

    ok(findItem('itm_open').done, 'opening the platform should tick its checklist item');
    eq(text('#statCheck'), '7 / 22', 'the checklist counter should include it');
    eq(text('#statTrain'), 'Not yet', 'opening the platform is not the same as confirming a login');
  });

  test('the confirm-login button stays in step with the checklist item', async () => {
    go('s-training');
    click('#loginBtn');
    await settle();
    match(text('#loginBtn'), /confirmed/i, 'confirming should be reflected on the button');

    /* The same item is an ordinary, tickable row on the checklist screen. */
    go('s-checklist');
    click(q('#ck_itm_login'));
    await settle();
    notOk(findItem('itm_login').done, 'unticking the login item should undo the confirmation');
    eq(text('#statTrain'), 'Not yet', 'the home stat re-derives from the checklist item');

    go('s-training');
    match(text('#loginBtn'), /confirm my login/i,
      'the training button should re-derive from state on every render — set once imperatively, it keeps claiming a confirmation the checklist no longer has');
  });
});

/* --- flows --- */
suite('Flows · employee · navigation', () => {
  const action = (scope, fn, arg) => qa(scope + ' [onclick]').find(el => {
    const a = el.getAttribute('onclick') || '';
    return a.indexOf(fn + '(') === 0 && (arg == null || a.indexOf("'" + arg + "'") > -1);
  });

  test('opens a team member from the wall and comes back', () => {
    go('s-team');
    ok(shown('#s-team'), 'the nav should land on Meet the shop');
    const card = qa('#teamGrid .member')[2];
    eq(handlerArg(card, 'openMember'), 'tm_juan', 'the third card should be Juan');

    click(card);

    ok(shown('#s-member'), 'clicking a card should open the member screen');
    notOk(shown('#s-team'), 'the team grid should be hidden while the profile is open');
    has(text('#s-member'), 'Juan Hernandez', 'the profile should name the member');
    has(text('#s-member'), 'Senior Stylist', 'the profile should show their role');
    has(text('#s-member'), 'Precision fades', 'the profile should list their specialties');

    click('#s-member .back');

    ok(shown('#s-team'), 'the back button should return to Meet the shop');
    notOk(shown('#s-member'), 'the profile should be hidden again');
    eq(text('#nav .navbtn.active'), 'Meet the shop', 'the sidebar should highlight where we landed');
  });

  test('jumps from a host profile into the meeting they host', () => {
    go('s-team');
    click(qa('#teamGrid .member')[2]);
    const jump = action('#s-member', 'openMember_toMeeting', 'mtg_assistant');
    ok(jump, 'the profile should link to the step this member hosts');
    click(jump);
    ok(shown('#s-meeting'), 'the link should open the meeting detail');
    has(text('#s-meeting'), 'Assistant Stylist Program', 'the right meeting should open');
  });

  test('the sidebar tracks the screen the user is on', () => {
    go('s-checklist');
    eq(text('#nav .navbtn.active'), 'My checklist', 'the checklist nav item should be active');
    ok(shown('#s-checklist'), 'the checklist screen should be visible');
    go('s-meetings');
    eq(text('#nav .navbtn.active'), 'Meetings', 'the meetings nav item should be active');
    notOk(shown('#s-checklist'), 'only one screen should be active at a time');
    len(qa('.screen.active'), 1, 'exactly one screen should be active');
  });
});

/* --- flows --- */
suite('Flows · admin · employee detail into the employee view', () => {
  const settle = async () => { for (let i = 0; i < 300; i++) await Promise.resolve(); };
  const action = (scope, fn, arg) => qa(scope + ' [onclick]').find(el => {
    const a = el.getAttribute('onclick') || '';
    return a.indexOf(fn + '(') === 0 && (arg == null || a.indexOf("'" + arg + "'") > -1);
  });
  const openEmpRow = async i => { click(qa('#rosterBody tr')[i]); await settle(); };

  test('marking a meeting complete reaches the rail, the auto checklist and progress', async () => {
    setMode('admin');
    ok(shown('#a-overview'), 'admin mode should land on the roster');
    eq(handlerArg(qa('#rosterBody tr')[0], 'openEmp'), 'emp_jordan', 'the first roster row should be Jordan');
    await openEmpRow(0);
    ok(shown('#a-employee'), 'clicking a roster row should open the employee detail');

    const btn = qa('#a-employee [onclick]').find(el => {
      const a = el.getAttribute('onclick') || '';
      return a.indexOf('adminComplete(') === 0 && a.indexOf('mtg_frontdesk') > -1;
    });
    ok(btn, 'step II should offer a Mark complete button');
    click(btn);
    await settle();

    has(text(qa('#a-employee .emp-meet')[1]), 'Complete', 'the admin journey row should now read Complete');
    notOk(qa('#a-employee [onclick]').some(el => (el.getAttribute('onclick') || '').indexOf('adminComplete(') === 0
      && (el.getAttribute('onclick') || '').indexOf('mtg_frontdesk') > -1),
      'a completed meeting should no longer offer Mark complete');

    setMode('employee');
    const step = qa('#rail .step')[1];
    ok(step.classList.contains('complete'), 'the employee rail should mark step II complete');
    has(text(step), 'Complete', 'the rail chip should read Complete');
    eq(text('#statMeet'), '2 / 4', 'the meetings stat should count the newly completed meeting');

    const group = qa('#checkGroups .check-group')[2];
    const boxes = Array.from(group.querySelectorAll('input[type=checkbox]'));
    ok(boxes[1].checked, 'the auto checklist item for step II should now be ticked');
    eq(text('#statCheck'), '7 / 22', 'the checklist counter should include the auto meeting item');
    eq(text('#ringPct'), '32%', 'the home ring should move with it');
    eq(state.me.employee.progress, 60, 'completing a second of four meetings should recompute progress to 60%');
  });

  test('assigning the Assistant Stylist program adds step III to an ineligible employee', async () => {
    setMode('admin');
    const before = await Store.listEmployeeMeetings('emp_maya');
    len(before, 3, 'Maya should start with three applicable meetings');
    await openEmpRow(1);

    const assign = action('#a-employee', 'assignProgram', 'emp_maya');
    ok(assign, 'a role-only step should offer an assign button for an ineligible employee');
    click(assign);
    await settle();

    const after = await Store.listEmployeeMeetings('emp_maya');
    len(after, 4, 'the program should become applicable, taking Maya from three meetings to four');
    const step3 = after.find(m => m.meetingId === 'mtg_assistant');
    ok(step3, 'step III should now be part of the journey');
    eq(step3.status, 'pending', 'the new step should start unscheduled');
    ok(DB.employees.find(e => e.id === 'emp_maya').eligibleForAsp, 'the employee record should be marked eligible');

    notOk(action('#a-employee', 'assignProgram', 'emp_maya'), 'the assign button should disappear once assigned');
    has(text(qa('#a-employee .emp-meet')[2]), 'Assistant Stylist Program', 'step III should still be listed');
    has(text(qa('#a-employee .emp-meet')[2]), 'Not scheduled', 'step III should now be schedulable');
    has(text(qa('#rosterBody tr')[1]), 'Step III', 'the roster next-step should move to the newly assigned step');
  });

  test('toggling training access updates the roster chip and the awaiting-access stat', async () => {
    setMode('admin');
    eq(text('#statAccess'), '2', 'two seeded employees are waiting on training access');
    has(text(qa('#rosterBody tr')[0]), 'Pending', 'Jordan should start pending');
    await openEmpRow(0);

    const sw = q('#a-employee .switch');
    ok(sw, 'the employee detail should offer an access switch');
    notOk(sw.classList.contains('on'), 'the switch should start off');
    eq(sw.getAttribute('aria-checked'), 'false', 'the switch should report its state to assistive tech');

    click(sw);
    await settle();

    ok(DB.employees.find(e => e.id === 'emp_jordan').trainingAccess, 'the toggle should persist on the employee');
    ok(q('#a-employee .switch').classList.contains('on'), 'the switch should re-render as on');
    eq(q('#a-employee .switch').getAttribute('aria-checked'), 'true', 'aria-checked should follow');
    eq(text('#statAccess'), '1', 'one fewer employee should be awaiting access');
    has(text(qa('#rosterBody tr')[0]), 'Confirmed', 'the roster chip should read Confirmed');

    click(q('#a-employee .switch'));
    await settle();

    notOk(DB.employees.find(e => e.id === 'emp_jordan').trainingAccess, 'toggling again should turn access back off');
    eq(text('#statAccess'), '2', 'the awaiting-access stat should go back up');
    has(text(qa('#rosterBody tr')[0]), 'Pending', 'the roster chip should read Pending again');
  });

  test('a saved note persists across a refresh and a re-render', async () => {
    setMode('admin');
    await openEmpRow(3);
    has(text('#a-employee'), 'Sam Okafor', 'the fourth roster row should open Sam');
    const box = q('#noteBox');
    eq(box.value, '', 'Sam starts with no notes');
    const note = "Sam's setup: ID & direct deposit still pending.";
    box.value = note;

    click(action('#a-employee', 'saveNote', 'emp_sam'));
    await settle();

    eq(DB.employees.find(e => e.id === 'emp_sam').adminNotes, note, 'the note should be stored on the employee');
    await refresh();
    await openEmpRow(3);
    eq(q('#noteBox').value, note, 're-opening the employee should show the saved note, encoding intact');
  });

  test('an admin assigning a time with no slots must not leave an unusable booking', async () => {
    DB.slots = DB.slots.filter(s => s.meetingId !== 'mtg_acd');
    await refresh();
    setMode('admin');
    await openEmpRow(0);

    const btn = qa('#a-employee [onclick]').find(el => {
      const a = el.getAttribute('onclick') || '';
      return a.indexOf('adminAssignTime(') === 0 && a.indexOf('mtg_acd') > -1;
    });
    ok(btn, 'a pending meeting should offer Assign time');
    click(btn);
    await settle();

    const inst = DB.employeeMeetings.find(x => x.employeeId === 'emp_jordan' && x.meetingId === 'mtg_acd');
    /* Rather than booking an unusable placeholder, the admin is told to add a
       time first — so there is nothing for parseWhen() to choke on later. */
    notOk(inst && inst.when, 'no time should be booked when the meeting has none to offer');
    neq(inst && inst.status, 'scheduled', 'the meeting must not be marked scheduled without a real time');
  });
});

/* --- flows --- */
suite('Flows · admin · meeting times and hosts', () => {
  const settle = async () => { for (let i = 0; i < 300; i++) await Promise.resolve(); };
  const action = (scope, fn, arg) => qa(scope + ' [onclick]').find(el => {
    const a = el.getAttribute('onclick') || '';
    return a.indexOf(fn + '(') === 0 && (arg == null || a.indexOf("'" + arg + "'") > -1);
  });

  test('a time added by an admin shows up in the employee picker', async () => {
    setMode('admin');
    go('a-slots');
    len(state.slots['mtg_acd'], 3, 'step IV starts with three seeded times');
    click(action('#slotCards', 'addSlot', 'mtg_acd'));
    await settle();

    const when = 'Tue Jul 21 · 10:30 AM';
    len(state.slots['mtg_acd'], 4, 'the new time should join the meeting');
    ok(DB.slots.some(s => s.meetingId === 'mtg_acd' && s.when === when), 'the slot should be stored against the meeting');
    has(text(qa('#slotCards .card')[3]), when, 'the admin slot card should list the new time');

    setMode('employee');
    go('s-meetings');
    click(action('#rail', 'openMeeting', 'mtg_acd'));
    const offered = qa('#s-meeting .slot').map(el => text(el));
    len(offered, 4, 'the employee picker should offer all four times');
    has(offered, when, 'the employee should be offered the time the admin just added');
  });

  test('changing the host reaches the employee-facing meeting detail', async () => {
    /* No instance yet for this step, so the meeting template's host is what shows. */
    DB.employeeMeetings = DB.employeeMeetings.filter(x => x.id !== 'em_3');
    await refresh();
    setMode('admin');
    go('a-slots');

    const sel = q('#host_mtg_assistant');
    ok(sel, 'each meeting card should offer a host picker');
    eq(sel.value, 'Juan · Senior Stylist', 'the picker should start on the seeded host');
    sel.value = 'Kris · Barber';
    sel.dispatchEvent(new Event('change'));
    await settle();

    eq(DB.meetings.find(m => m.id === 'mtg_assistant').defaultHost, 'Kris · Barber', 'the host should be saved on the meeting');
    eq(q('#host_mtg_assistant').value, 'Kris · Barber', 'the re-rendered picker should keep the saved host selected');

    setMode('employee');
    go('s-meetings');
    has(text(qa('#rail .step')[2]), 'Kris · Barber', 'the rail should show the new host');
    click(action('#rail', 'openMeeting', 'mtg_assistant'));
    has(text('#s-meeting'), 'Kris · Barber', 'the meeting detail should show the new host');
  });

  test('a time booked after a host change is hosted by the new host', async () => {
    setMode('admin');
    go('a-slots');
    const sel = q('#host_mtg_assistant');
    sel.value = 'Kris · Barber';
    sel.dispatchEvent(new Event('change'));
    await settle();

    setMode('employee');
    go('s-meetings');
    click(action('#rail', 'openMeeting', 'mtg_assistant'));
    click(qa('#s-meeting .slot')[0]);
    await settle();

    const inst = DB.employeeMeetings.find(x => x.employeeId === CURRENT_USER && x.meetingId === 'mtg_assistant');
    eq(inst.host, 'Kris · Barber',
      'the times listed under a meeting belong to that meeting host — changing the host must not leave slots booking the previous one');
    has(text('#s-meeting'), 'Kris · Barber', 'the booked panel should name the current host');
  });

  test('adding a time does not disturb the other meetings', async () => {
    setMode('admin');
    go('a-slots');
    click(action('#slotCards', 'addSlot', 'mtg_handbook'));
    await settle();
    len(state.slots['mtg_handbook'], 3, 'the handbook meeting should gain one time');
    len(state.slots['mtg_frontdesk'], 3, 'step II should be untouched');
    len(state.slots['mtg_assistant'], 3, 'step III should be untouched');
    len(state.slots['mtg_acd'], 3, 'step IV should be untouched');
    eq(DB.slots.filter(s => s.meetingId === 'mtg_handbook').length, 3, 'only one row should have been inserted');
  });
});

/* --- flows --- */
suite('Flows · admin · team roster', () => {
  const settle = async () => { for (let i = 0; i < 300; i++) await Promise.resolve(); };
  const action = (scope, fn, arg) => qa(scope + ' [onclick]').find(el => {
    const a = el.getAttribute('onclick') || '';
    return a.indexOf(fn + '(') === 0 && (arg == null || a.indexOf("'" + arg + "'") > -1);
  });
  const fillForm = f => {
    q('#mfName').value = f.name; q('#mfRole').value = f.role;
    q('#mfSince').value = f.since || ''; q('#mfTags').value = f.tags || ''; q('#mfBio').value = f.bio || '';
  };
  const save = () => click(action('#memberForm', 'saveMember'));

  test('adds a member through the form and puts them on Meet the shop', async () => {
    setMode('admin');
    go('a-team');
    click(action('#a-team', 'openAddMember'));
    eq(q('#memberForm').style.display, 'block', 'the add button should reveal the form');

    fillForm({ name: 'Rico Vega', role: 'Barber', since: '5 yrs experience', tags: 'Fades, Beard work', bio: 'Sharp fades and a steady hand.' });
    save();
    await settle();

    len(state.team, 6, 'the shop should gain a member');
    const rico = state.team.find(t => t.name === 'Rico Vega');
    ok(rico, 'the new member should be in state');
    eq(rico.initials, 'RV', 'initials should be derived from the name');
    eq(rico.role, 'Barber', 'the role should be saved');
    deepEq(rico.specialties, ['Fades', 'Beard work'], 'comma-separated specialties should be split and trimmed');
    eq(q('#memberForm').style.display, 'none', 'saving should close the form');
    has(text('#teamAdmin'), 'Rico Vega', 'the admin roster should list the new member');

    setMode('employee');
    go('s-team');
    has(text('#teamGrid'), 'Rico Vega', 'the new member should appear on Meet the shop');
    eq(text('#teamCount'), 'Six', 'the team count copy should follow');
    const card = qa('#teamGrid .member').find(el => handlerArg(el, 'openMember') === rico.id);
    ok(card, 'the new card should be wired to the stable id the server returned');
    click(card);
    has(text('#s-member'), 'Rico Vega', 'the profile should open for the new member');
    has(text('#s-member'), '5 yrs experience', 'the profile should show their experience');
    has(text('#s-member'), 'Sharp fades and a steady hand.', 'the profile should show their bio');
  });

  test('edits a member and the change reaches both views', async () => {
    setMode('admin');
    go('a-team');
    click(action('#teamAdmin', 'openEditMember', 'tm_kris'));
    eq(editId, 'tm_kris', 'editing should target the clicked member');
    eq(text('#memberFormTitle'), 'Edit Kris', 'the form should say who is being edited');
    eq(q('#mfName').value, 'Kris', 'the form should be pre-filled');
    eq(q('#mfTags').value, 'Tailored cuts, Guest rapport', 'specialties should round-trip into the form');

    q('#mfRole').value = 'Master Barber';
    q('#mfTags').value = 'Tailored cuts, Hot towel shaves';
    save();
    await settle();

    len(state.team, 5, 'editing must not add a member');
    eq(editId, null, 'the edit target should be cleared after saving');
    const kris = state.team.find(t => t.id === 'tm_kris');
    eq(kris.role, 'Master Barber', 'the role change should be saved');
    deepEq(kris.specialties, ['Tailored cuts', 'Hot towel shaves'], 'the specialties change should be saved');
    has(text('#teamAdmin'), 'Master Barber', 'the admin roster should show the new role');

    setMode('employee');
    go('s-team');
    has(text('#teamGrid'), 'Master Barber', 'Meet the shop should show the new role');
  });

  test('removes a member once the confirm is accepted', async () => {
    const realConfirm = window.confirm;
    let asked = null;
    try {
      window.confirm = msg => { asked = msg; return true; };
      setMode('admin');
      go('a-team');
      click(action('#teamAdmin', 'removeMember', 'tm_cathy'));
      await settle();
    } finally {
      window.confirm = realConfirm;
    }
    ok(asked && asked.indexOf('Cathy') > -1, 'removal should confirm by name first');
    len(state.team, 4, 'the member should be gone from state');
    notOk(DB.team.some(t => t.id === 'tm_cathy'), 'the row should be deleted');
    lacks(text('#teamAdmin'), 'Cathy', 'the admin roster should drop the member');

    setMode('employee');
    go('s-team');
    lacks(text('#teamGrid'), 'Cathy', 'Meet the shop should drop the member');
    eq(text('#teamCount'), 'Four', 'the team count copy should follow');
  });

  test('declining the confirm keeps the member', async () => {
    const realConfirm = window.confirm;
    try {
      window.confirm = () => false;
      setMode('admin');
      go('a-team');
      click(action('#teamAdmin', 'removeMember', 'tm_cathy'));
      await settle();
    } finally {
      window.confirm = realConfirm;
    }
    len(state.team, 5, 'declining the confirm must not delete anyone');
    ok(DB.team.some(t => t.id === 'tm_cathy'), 'the row should still be there');
    has(text('#teamAdmin'), 'Cathy', 'the admin roster should still list the member');
  });

  test('refuses to save a member without a name or a role', async () => {
    setMode('admin');
    go('a-team');
    click(action('#a-team', 'openAddMember'));

    fillForm({ name: '   ', role: 'Barber' });
    save();
    await settle();
    len(state.team, 5, 'a nameless member must not be created');
    eq(text('#toast'), 'Add a name', 'the admin should be told what is missing');
    eq(q('#memberForm').style.display, 'block', 'the form should stay open to be fixed');

    fillForm({ name: 'Rico Vega', role: '' });
    save();
    await settle();
    len(state.team, 5, 'a member with no role must not be created');
    eq(text('#toast'), 'Add a role', 'the admin should be told what is missing');
    eq(q('#memberForm').style.display, 'block', 'the form should still be open');
  });

  test('cancelling the form leaves the roster alone', () => {
    setMode('admin');
    go('a-team');
    click(action('#teamAdmin', 'openEditMember', 'tm_bobby'));
    q('#mfRole').value = 'Something else entirely';
    click(action('#memberForm', 'cancelMember'));
    eq(q('#memberForm').style.display, 'none', 'cancel should close the form');
    eq(editId, null, 'cancel should clear the edit target');
    eq(state.team.find(t => t.id === 'tm_bobby').role, 'Master Stylist · Manager', 'cancel must not save the edit');
  });
});

/* --- flows --- */
suite('Flows · admin · content', () => {
  const settle = async () => { for (let i = 0; i < 300; i++) await Promise.resolve(); };
  const action = (scope, fn, arg) => qa(scope + ' [onclick]').find(el => {
    const a = el.getAttribute('onclick') || '';
    return a.indexOf(fn + '(') === 0 && (arg == null || a.indexOf("'" + arg + "'") > -1);
  });

  test('saving the welcome message updates the content record and survives a refresh', async () => {
    setMode('admin');
    go('a-content');
    eq(q('#welcomeTxt').value, DB.content.welcomeMessage, 'the form should render the stored message');
    const msg = 'Welcome to Artisan — glad to have you behind the chair.';
    q('#welcomeTxt').value = msg;

    click(action('#a-content', 'saveWelcome'));
    await settle();

    eq(state.content.welcomeMessage, msg, 'state should carry the saved message');
    eq(DB.content.welcomeMessage, msg, 'the content record should be updated');
    await refresh();
    eq(q('#welcomeTxt').value, msg, 'the form should re-render with the saved message');
  });

  test('saving the training link updates the content record', async () => {
    setMode('admin');
    go('a-content');
    const url = 'https://learn.artisanbarber.com/onboarding';
    q('#trainUrl').value = url;

    click(action('#a-content', 'saveTrainingLink'));
    await settle();

    eq(state.content.trainingUrl, url, 'state should carry the saved URL');
    eq(DB.content.trainingUrl, url, 'the content record should be updated');
    eq(state.content.welcomeMessage, DB.content.welcomeMessage, 'saving one field must not clobber the other');
    await refresh();
    eq(q('#trainUrl').value, url, 'the form should re-render with the saved URL');
  });

  test('the welcome message an admin saves is the one new hires read', async () => {
    setMode('admin');
    go('a-content');
    const msg = 'Welcome to Artisan — glad to have you behind the chair.';
    q('#welcomeTxt').value = msg;
    click(action('#a-content', 'saveWelcome'));
    await settle();

    setMode('employee');
    has(text('#s-home'), 'glad to have you behind the chair',
      'the Content screen promises "what new hires read here" — the saved welcome message should render on the employee home');
  });
});

/* --- robustness --- */
suite('Robustness · HTML injection through admin-controlled text', () => {
  const PAYLOAD = '<img src=x onerror="window.__XSS__=1">';
  const settle = () => new Promise(r => setTimeout(r, 0));

  /* The payload is only dangerous if the browser parses it. Two probes: a live
     element carrying the marker src, and the side effect its handler would have
     caused. Both must stay negative. */
  async function assertInert(where) {
    await settle();
    notOk(q('img[src="x"]'), where + ': the payload must never become a live <img> element');
    notOk(window.__XSS__, where + ': the injected handler must never run');
  }

  test('a script payload in a team member name renders as literal text', async () => {
    delete window.__XSS__;
    await Store.updateTeamMember('tm_kris', { name: PAYLOAD });
    await refresh();
    await assertInert('the team wall');
    has(text('#teamGrid'), PAYLOAD, 'the reader should see the payload spelled out as text');
  });

  test('a script payload in a team member role renders as literal text', async () => {
    delete window.__XSS__;
    await Store.updateTeamMember('tm_kris', { role: PAYLOAD });
    await refresh();
    await assertInert('the team wall');
    has(text('#teamGrid'), PAYLOAD, 'the role should be shown verbatim');
  });

  test('a script payload in a team member experience renders as literal text', async () => {
    delete window.__XSS__;
    await Store.updateTeamMember('tm_kris', { experience: PAYLOAD });
    await refresh();
    setMode('admin');
    go('a-team');
    await assertInert('the admin team roster');
    has(text('#teamAdmin'), PAYLOAD, 'the experience line should be shown verbatim');
  });

  test('a script payload in a team member bio renders as literal text', async () => {
    delete window.__XSS__;
    await Store.updateTeamMember('tm_kris', { bio: PAYLOAD });
    await refresh();
    await assertInert('the team wall');
    openMember('tm_kris');
    await assertInert('the member profile');
    has(text('#s-member'), PAYLOAD, 'the bio should be shown verbatim on the profile');
  });

  test('a script payload in a specialty renders as literal text', async () => {
    delete window.__XSS__;
    await Store.updateTeamMember('tm_kris', { specialties: [PAYLOAD, 'Fades'] });
    await refresh();
    await assertInert('the team wall');
    openMember('tm_kris');
    await assertInert('the member profile');
    has(text('#s-member'), PAYLOAD, 'the specialty chip should show the payload verbatim');
  });

  test('a specialty containing a closing tag cannot break the card structure', async () => {
    const before = qa('#teamGrid .member').length;
    await Store.updateTeamMember('tm_kris', {
      specialties: ['</div></div><div class="member">ghost card</div>', 'Fades']
    });
    await refresh();
    len(qa('#teamGrid .member'), before, 'the grid should still hold exactly one card per team member');
    const card = qa('#teamGrid .member').find(el => handlerArg(el, 'openMember') === 'tm_kris');
    ok(card, 'the Kris card should still be wired to openMember');
    len(Array.from(card.querySelectorAll('.chip')), 2, 'both specialty chips should be inside the same card');
  });

  test('a script payload in an admin note renders as literal text', async () => {
    delete window.__XSS__;
    await Store.setEmployeeNotes('emp_jordan', PAYLOAD);
    await refresh();
    setMode('admin');
    await openEmp('emp_jordan');
    await assertInert('the employee detail screen');
    eq(q('#noteBox').value, PAYLOAD, 'the note should round-trip into the textarea verbatim');
  });

  test('a note that closes the textarea cannot break the card structure', async () => {
    delete window.__XSS__;
    const NOTE = 'Careful: </textarea></div><div class="card">injected</div>';
    await Store.setEmployeeNotes('emp_jordan', NOTE);
    await refresh();
    setMode('admin');
    await openEmp('emp_jordan');
    len(qa('#a-employee > .card'), 3, 'the employee screen should still have exactly its three cards');
    len(qa('#a-employee textarea'), 1, 'there should still be exactly one notes textarea');
    eq(q('#noteBox').value, NOTE, 'the note should round-trip verbatim');
    await assertInert('the employee detail screen');
  });

  test('a script payload in a slot label renders as literal text for the admin', async () => {
    delete window.__XSS__;
    await Store.addSlot('mtg_assistant', { when: PAYLOAD, host: 'Juan · Senior Stylist' });
    await refresh();
    setMode('admin');
    go('a-slots');
    await assertInert('the meeting-times screen');
    has(text('#slotCards'), PAYLOAD, 'the slot label should be shown verbatim');
  });

  test('a script payload in a slot label renders as literal text in the picker', async () => {
    delete window.__XSS__;
    await Store.addSlot('mtg_assistant', { when: PAYLOAD, host: 'Juan · Senior Stylist' });
    await refresh();
    openMeeting('mtg_assistant');
    await assertInert('the time picker');
    const btn = qa('#s-meeting .slot').find(b => b.textContent.trim() === PAYLOAD);
    ok(btn, 'a slot button labelled with the literal payload should be offered');
  });

  test('a script payload in the welcome message never reaches the DOM as markup', async () => {
    delete window.__XSS__;
    await Store.updateContent({ welcomeMessage: PAYLOAD });
    await refresh();
    setMode('admin');
    go('a-content');
    await assertInert('the content screen');
    eq(q('#welcomeTxt').value, PAYLOAD, 'the welcome message should load into the editor verbatim');
  });

  test('a script payload in the training URL never reaches the DOM as markup', async () => {
    delete window.__XSS__;
    await Store.updateContent({ trainingUrl: PAYLOAD });
    await refresh();
    setMode('admin');
    go('a-content');
    await assertInert('the content screen');
    eq(q('#trainUrl').value, PAYLOAD, 'the URL should load into the editor verbatim');
  });

  test('a javascript: training URL is never turned into a live link', async () => {
    delete window.__XSS__;
    await Store.updateContent({ trainingUrl: 'javascript:window.__XSS__=1' });
    await refresh();
    setMode('employee');
    go('s-training');
    await settle();
    notOk(
      qa('a').some(a => /^\s*javascript:/i.test(a.getAttribute('href') || '')),
      'a javascript: URL must never be written into an href'
    );
    notOk(window.__XSS__, 'nothing should have executed');
  });

  test('a javascript: headshot URL is stripped before it reaches an img src', async () => {
    delete window.__XSS__;
    await Store.setTeamPhoto('tm_kris', 'javascript:window.__XSS__=1');
    await refresh();
    await settle();
    notOk(
      qa('img').some(i => /^\s*javascript:/i.test(i.getAttribute('src') || '')),
      'safeUrl must strip a javascript: photo URL'
    );
    notOk(window.__XSS__, 'nothing should have executed');
  });

  test('a data:text/html headshot URL is stripped before it reaches an img src', async () => {
    delete window.__XSS__;
    await Store.setTeamPhoto('tm_kris', 'data:text/html,<img src=x onerror="window.__XSS__=1">');
    await refresh();
    await assertInert('the team wall');
    notOk(
      qa('img').some(i => /^\s*data:text\/html/i.test(i.getAttribute('src') || '')),
      'only image data URLs may reach an img src'
    );
  });
});

/* --- robustness --- */
suite('Robustness · attributes and inline handler wiring', () => {
  const settle = () => new Promise(r => setTimeout(r, 0));

  test('a quote-breaking name cannot escape the headshot alt attribute', async () => {
    delete window.__XSS__;
    const ATTR = '" onmouseover="window.__XSS__=1';
    await Store.setTeamPhoto('tm_kris', 'data:image/png;base64,iVBORw0KGgo=');
    await Store.updateTeamMember('tm_kris', { name: ATTR });
    await refresh();
    await settle();
    const img = qa('#teamGrid img').find(i => i.getAttribute('alt') === ATTR);
    ok(img, 'the entire payload should sit inside alt="" as literal text');
    notOk(img.getAttribute('onmouseover'), 'no onmouseover attribute may be created');
    notOk(window.__XSS__, 'nothing should have executed');
  });

  test('a quote-breaking employee name cannot escape the note placeholder', async () => {
    delete window.__XSS__;
    const ATTR = '" onmouseover="window.__XSS__=1';
    DB.employees.find(e => e.id === 'emp_sam').name = ATTR;
    await refresh();
    setMode('admin');
    await openEmp('emp_sam');
    await settle();
    const box = q('#noteBox');
    ok(box, 'the notes textarea should still render');
    notOk(box.getAttribute('onmouseover'), 'no onmouseover attribute may be created');
    has(box.getAttribute('placeholder'), '"', 'the raw quote belongs inside the placeholder as literal text');
    notOk(window.__XSS__, 'nothing should have executed');
  });

  test('an apostrophe in a name does not corrupt the openMember wiring', async () => {
    const m = await Store.addTeamMember({ name: "Ronan O'Brien", role: 'Barber', specialties: ['Fades'] });
    await refresh();
    const card = qa('#teamGrid .member').find(el => handlerArg(el, 'openMember') === m.id);
    ok(card, 'handlerArg should read the new member id straight back out of the onclick attribute');
    has(text(card), "Ronan O'Brien", 'the apostrophe should render as a literal apostrophe');
    click(card);
    ok(shown('#s-member'), 'clicking the card should open the member detail screen');
    has(text('#s-member'), "Ronan O'Brien", 'and it should resolve to the right member');
  });

  test('an id containing an apostrophe still resolves through the inline onclick', async () => {
    DB.team.push({
      id: "tm_o'brien", sortOrder: 9, name: 'Ronan OBrien', initials: 'RO', role: 'Barber',
      experience: '', photoUrl: null, bio: 'Sharp fades.', specialties: ['Fades'], hostsMeetingIds: []
    });
    await refresh();
    const card = qa('#teamGrid .member').find(el => text(el).includes('Ronan OBrien'));
    ok(card, 'the member should appear on the wall');
    click(card);
    ok(shown('#s-member'), 'a quote-containing id must not break the handler');
    has(text('#s-member'), 'Ronan OBrien', 'the click should resolve the member whose id contains an apostrophe');
  });

  test('a backslash in an id does not corrupt the inline onclick', async () => {
    DB.team.push({
      id: 'tm_back\\slash', sortOrder: 9, name: 'Dana Reyes', initials: 'DR', role: 'Barber',
      experience: '', photoUrl: null, bio: 'Clean lines.', specialties: [], hostsMeetingIds: []
    });
    await refresh();
    const card = qa('#teamGrid .member').find(el => text(el).includes('Dana Reyes'));
    ok(card, 'the member should appear on the wall');
    click(card);
    ok(shown('#s-member'), 'a backslash in the id must not break the handler');
    has(text('#s-member'), 'Dana Reyes', 'the click should resolve the right member');
  });

  test('scheduling through a slot button passes the exact label back', async () => {
    const WHEN = "Thu Jul 16 · 5:00 PM (Charlie's chair)";
    await Store.addSlot('mtg_assistant', { when: WHEN, host: 'Juan · Senior Stylist' });
    await refresh();
    openMeeting('mtg_assistant');
    const btn = qa('#s-meeting .slot').find(b => b.textContent.trim() === WHEN);
    ok(btn, 'the slot button should carry the label verbatim');
    click(btn);
    const row = () => DB.employeeMeetings.find(x => x.employeeId === CURRENT_USER && x.meetingId === 'mtg_assistant');
    for (let i = 0; i < 200 && !(row() && row().when === WHEN); i++) await new Promise(r => setTimeout(r, 0));
    eq(row().when, WHEN, 'the apostrophe in the slot label must survive the round trip through onclick');
    eq(row().status, 'scheduled', 'and the meeting should end up booked');
  });
});

/* --- robustness --- */
suite('Robustness · empty and boundary data', () => {
  test('an employee with no applicable meetings still renders sane counts', async () => {
    DB.meetings.length = 0;
    DB.employeeMeetings.length = 0;
    DB.slots.length = 0;
    await refresh();
    len(state.me.meetings, 0, 'there should be no applicable meetings');
    eq(text('#statMeet'), '0 / 0', 'the meetings stat should read 0 / 0');
    eq(html('#rail').trim(), '', 'the journey rail should be empty rather than broken');
  });

  test('an employee with no applicable meetings gets sensible up-next copy', async () => {
    DB.meetings.length = 0;
    DB.employeeMeetings.length = 0;
    DB.slots.length = 0;
    await refresh();
    gt(text('#upNext').length, 0, 'the up-next card must still say something');
    lacks(text('#upNext'), 'All 0 meetings complete',
      'with nothing assigned the card must not congratulate the user on finishing zero meetings');
  });

  test('a meeting with no slots shows the "no times" message to the employee', async () => {
    const keep = DB.slots.filter(s => s.meetingId !== 'mtg_assistant');
    DB.slots.length = 0;
    keep.forEach(s => DB.slots.push(s));
    await refresh();
    openMeeting('mtg_assistant');
    len(qa('#s-meeting .slots .slot'), 0, 'no time buttons should be offered');
    has(text('#s-meeting'), 'No times available yet',
      'the picker must explain there are no times instead of leaving an empty gap');
  });

  test('a meeting with no slots shows the "no times yet" message to the admin', async () => {
    const keep = DB.slots.filter(s => s.meetingId !== 'mtg_assistant');
    DB.slots.length = 0;
    keep.forEach(s => DB.slots.push(s));
    await refresh();
    setMode('admin');
    go('a-slots');
    const card = qa('#slotCards .card').find(c => text(c).includes('Assistant Stylist Program'));
    ok(card, 'the Assistant Stylist card should still render');
    has(text(card), 'No times yet', 'the empty slot list needs its own message');
  });

  test('a team member with no specialties renders without an empty chip', async () => {
    await Store.updateTeamMember('tm_kris', { specialties: [] });
    await refresh();
    const card = qa('#teamGrid .member').find(el => handlerArg(el, 'openMember') === 'tm_kris');
    ok(card, 'the card should still render');
    len(Array.from(card.querySelectorAll('.chip')), 0, 'no specialty chips should be drawn');
    openMember('tm_kris');
    ok(shown('#s-member'), 'the profile should still open');
    len(qa('#s-member .chip'), 0, 'and the profile should show no specialty chips');
  });

  test('a checklist group with no items still renders its heading', async () => {
    const keep = DB.checklistItems.filter(it => it.groupId !== 'grp_setup');
    DB.checklistItems.length = 0;
    keep.forEach(i => DB.checklistItems.push(i));
    await refresh();
    const groups = qa('#checkGroups .check-group');
    len(groups, 4, 'all four groups should still render');
    const setup = groups.find(g => text(g.querySelector('h2')) === 'Shop setup');
    ok(setup, 'the emptied group should keep its heading');
    len(Array.from(setup.querySelectorAll('.check-item')), 0, 'and show no items');
  });

  test('a completely empty checklist does not divide by zero', async () => {
    DB.checklistItems.length = 0;
    DB.meetings.length = 0;
    DB.employeeMeetings.length = 0;
    DB.slots.length = 0;
    await refresh();
    deepEq(progressCounts(), { done: 0, total: 0 }, 'there is nothing to count');
    eq(q('#checkBar').style.width, '0%', 'the progress bar should sit at zero, not NaN%');
    eq(text('#ringPct'), '0%', 'the ring should read 0%, not NaN%');
  });

  test('an emptied team roster renders without crashing', async () => {
    for (const t of DB.team.slice()) await Store.deleteTeamMember(t.id);
    await refresh();
    len(state.team, 0, 'the roster should be empty');
    eq(html('#teamGrid').trim(), '', 'the wall should render nothing rather than a broken card');
    eq(text('#teamCount'), 'Zero', 'the count word should read "Zero", not "undefined"');
    eq(html('#teamAdmin').trim(), '', 'the admin roster should be empty too');
  });

  test('a roster larger than the count-word table falls back to a numeral', async () => {
    for (let i = 0; i < 6; i++) await Store.addTeamMember({ name: 'Extra ' + i, role: 'Barber' });
    await refresh();
    eq(state.team.length, 11, 'eleven members now');
    eq(text('#teamCount'), '11', 'past "Ten" the copy must fall back to the number, not "undefined"');
  });

  test('a very long name and bio render without throwing', async () => {
    const longName = ('Alessandra Beaumont ').repeat(120).trim();
    const longBio = 'x'.repeat(20000);
    let err = null;
    try {
      await Store.updateTeamMember('tm_kris', { name: longName, bio: longBio });
      await refresh();
      openMember('tm_kris');
      setMode('admin');
      go('a-team');
    } catch (e) { err = e; }
    ok(!err, 'long text must not throw: ' + (err && err.message));
    eq(initialsOf(longName), 'AB', 'initials should still come from the first two words');
  });

  test('accented and whitespace-heavy names produce sane initials', () => {
    eq(initialsOf('José Álvarez'), 'JÁ', 'accented letters should survive');
    eq(initialsOf('   Kris   '), 'KR', 'surrounding whitespace should be ignored');
    eq(initialsOf('Ana  María  Ruiz'), 'AM', 'the first two words win');
    eq(initialsOf(''), '?', 'a blank name should fall back to a placeholder');
    eq(initialsOf(null), '?', 'so should a missing name');
  });

  test('an emoji name does not produce a broken half-character', () => {
    const ini = initialsOf('🧔 Bond');
    notOk(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(ini),
      'initials must never be cut mid-surrogate-pair: got ' + JSON.stringify(ini));
  });

  test('a single-emoji name keeps the whole emoji', () => {
    eq(initialsOf('💈'), '💈', 'a one-word emoji name should come back whole');
  });
});

/* --- robustness --- */
suite('Robustness · malformed input to the calendar helpers', () => {
  const MALFORMED = ['Time TBD', 'Wed Jul 15', 'Wed Jul 15 · sometime', 'Wed Foo 15 · 9:30 AM', '', 'TBD · TBD'];
  const attempt = fn => { try { return { value: fn() }; } catch (e) { return { error: e }; } };
  const isInvalidDate = v => v instanceof Date && Number.isNaN(v.getTime());

  test('parseWhen reads a well-formed label correctly', () => {
    const d = parseWhen('Wed Jul 15 · 9:30 AM');
    eq(d.getFullYear(), 2026, 'year');
    eq(d.getMonth(), 6, 'July is month index 6');
    eq(d.getDate(), 15, 'day of month');
    eq(d.getHours(), 9, 'hour');
    eq(d.getMinutes(), 30, 'minute');
  });

  test('parseWhen handles the 12 AM / 12 PM edges', () => {
    eq(parseWhen('Wed Jul 15 · 12:00 PM').getHours(), 12, 'noon is 12:00');
    eq(parseWhen('Wed Jul 15 · 12:00 AM').getHours(), 0, 'midnight is 00:00');
    eq(parseWhen('Wed Jul 15 · 1:05 PM').getHours(), 13, 'afternoon hours shift by 12');
  });

  test('parseWhen never invents a plausible date from a malformed label', () => {
    for (const label of MALFORMED) {
      const r = attempt(() => parseWhen(label));
      ok(r.error || isInvalidDate(r.value),
        'parseWhen(' + JSON.stringify(label) + ') must fail rather than return a usable Date, got ' + String(r.value));
    }
  });

  test('parseWhen rejects a malformed label with a descriptive error', () => {
    for (const label of MALFORMED) {
      const r = attempt(() => parseWhen(label));
      if (!r.error) continue;
      notOk(r.error instanceof TypeError,
        'parseWhen(' + JSON.stringify(label) + ') should raise a descriptive Error naming the bad label, not a bare ' +
        'TypeError from dereferencing undefined: ' + r.error.message);
    }
  });

  test('add-to-calendar survives a placeholder time the app itself writes', async () => {
    /* adminAssignTime stores the literal string 'Time TBD' when a meeting has no
       slots, and the employee is then offered a normal "Add to calendar" button. */
    const keep = DB.slots.filter(s => s.meetingId !== 'mtg_acd');
    DB.slots.length = 0;
    keep.forEach(s => DB.slots.push(s));
    await refresh();
    setMode('admin');
    await adminAssignTime('emp_jordan', 'mtg_acd');
    await refresh();
    const inst = DB.employeeMeetings.find(x => x.employeeId === 'emp_jordan' && x.meetingId === 'mtg_acd');
    notOk(inst && inst.when, 'the app no longer writes a placeholder label at all');

    /* The source of the bad label is closed, but the export must still survive a
       label that reaches it some other way — a hand-edited row, or an import. */
    const forced = _ensureInstance('emp_jordan', 'mtg_acd');
    forced.when = 'Time TBD';
    forced.status = 'scheduled';
    await refresh();
    setMode('employee');
    openMeeting('mtg_acd');
    let err = null;
    try { addToCalendar('mtg_acd'); } catch (e) { err = e; }
    ok(!err, 'an unparseable label should produce a toast, not an uncaught ' +
      (err && err.name) + ': ' + (err && err.message));
  });

  test('fmtICS pads every field to the RFC 5545 width', () => {
    eq(fmtICS(new Date(2026, 0, 5, 9, 7)), '20260105T090700', 'single-digit fields must be zero-padded');
    eq(pad2(0), '00', 'pad2 handles zero');
    eq(pad2(7), '07', 'pad2 handles a single digit');
    eq(pad2(11), '11', 'pad2 leaves two digits alone');
  });
});

/* --- robustness --- */
suite('Robustness · headshot upload', () => {
  const settle = () => new Promise(r => setTimeout(r, 0));
  async function waitFor(fn) {
    for (let i = 0; i < 300; i++) { if (fn()) return true; await settle(); }
    return false;
  }

  test('onHeadshot ignores a change event with no file', () => {
    uploadTargetId = 'tm_kris';
    let err = null;
    try { onHeadshot({ target: { files: [], value: 'C:\\fake\\path.png' } }); } catch (e) { err = e; }
    ok(!err, 'an empty file list must be a no-op, not a crash: ' + (err && err.message));
    eq(DB.team.find(t => t.id === 'tm_kris').photoUrl, null, 'nothing should have been stored');
  });

  test('onHeadshot refuses a file that is not an image', async () => {
    uploadTargetId = 'tm_kris';
    const file = new File(['not really a picture'], 'payload.html', { type: 'text/html' });
    onHeadshot({ target: { files: [file], value: '' } });
    await settle();
    await settle();
    eq(DB.team.find(t => t.id === 'tm_kris').photoUrl, null, 'a non-image file must never be stored as a headshot');
    eq(text('#toast'), 'Choose an image file', 'and the admin should be told why');
  });

  test('onHeadshot refuses a file with no MIME type at all', async () => {
    uploadTargetId = 'tm_kris';
    const file = new File(['bytes'], 'mystery', { type: '' });
    onHeadshot({ target: { files: [file], value: '' } });
    await settle();
    await settle();
    eq(DB.team.find(t => t.id === 'tm_kris').photoUrl, null, 'an untyped file must not be stored');
  });

  test('onHeadshot with no upload target does nothing', () => {
    uploadTargetId = null;
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'x.png', { type: 'image/png' });
    let err = null;
    try { onHeadshot({ target: { files: [file], value: '' } }); } catch (e) { err = e; }
    ok(!err, 'an upload with no target must be a no-op: ' + (err && err.message));
    notOk(DB.team.some(t => t.photoUrl), 'no member should have gained a photo');
  });

  test('onHeadshot stores a real image and renders it as a data URL', async () => {
    uploadTargetId = 'tm_kris';
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const file = new File([png], 'headshot.png', { type: 'image/png' });
    onHeadshot({ target: { files: [file], value: '' } });
    const stored = await waitFor(() => {
      const t = state.team.find(x => x.id === 'tm_kris');
      return t && t.photoUrl;
    });
    ok(stored, 'FileReader should have resolved and the photo been saved');
    match(DB.team.find(t => t.id === 'tm_kris').photoUrl, /^data:image\/png;base64,/,
      'the stored value should be a png data URL');
    setMode('admin');
    go('a-team');
    const img = q('#teamAdmin img');
    ok(img, 'the admin thumbnail should render the uploaded image');
    match(img.getAttribute('src'), /^data:image\/png;base64,/, 'and safeUrl should let a real image data URL through');
    eq(uploadTargetId, null, 'the upload target should be cleared once the upload lands');
  });

  test('removing a headshot clears it everywhere', async () => {
    await Store.setTeamPhoto('tm_kris', 'data:image/png;base64,iVBORw0KGgo=');
    await refresh();
    await removeHeadshot('tm_kris');
    eq(DB.team.find(t => t.id === 'tm_kris').photoUrl, null, 'the stored photo should be gone');
    const card = qa('#teamGrid .member').find(el => handlerArg(el, 'openMember') === 'tm_kris');
    ok(card, 'the card should still render');
    notOk(card.querySelector('img'), 'and fall back to the initials monogram');
  });
});

/* --- robustness --- */
suite('Robustness · malformed data reaching the Store', () => {
  test('a non-array specialties value cannot break the whole render pass', async () => {
    let renderErr = null;
    try { await Store.updateTeamMember('tm_kris', { specialties: 'Fades, Beard work' }); } catch (e) { /* rejecting is fine */ }
    try { await refresh(); } catch (e) { renderErr = e; }
    ok(!renderErr, 'PATCH /team/:id should reject or normalise a non-array specialties value; instead the render pass threw: ' +
      (renderErr && renderErr.message));
    ok(Array.isArray(state.team.find(t => t.id === 'tm_kris').specialties),
      'specialties must still be an array after the write');
  });

  test('a non-array specialties value on create cannot break the render pass', async () => {
    let renderErr = null;
    try { await Store.addTeamMember({ name: 'Nia Fox', role: 'Barber', specialties: 'Fades' }); } catch (e) { /* rejecting is fine */ }
    try { await refresh(); } catch (e) { renderErr = e; }
    ok(!renderErr, 'POST /team should reject or normalise a non-array specialties value; instead the render pass threw: ' +
      (renderErr && renderErr.message));
  });

  test('opening an unknown employee id does not throw', async () => {
    let err = null;
    try { await openEmp('emp_ghost'); } catch (e) { err = e; }
    ok(!err, 'openEmp should fall back gracefully for an unknown id, the way openMember falls back to the team page: ' +
      (err && err.message));
  });

  test('opening an unknown team member id falls back to the team page', () => {
    let err = null;
    try { openMember('tm_ghost'); } catch (e) { err = e; }
    ok(!err, 'openMember should not throw on an unknown id: ' + (err && err.message));
    ok(shown('#s-team'), 'it should land the user back on "Meet the shop"');
  });

  test('opening a meeting that is not in the journey is refused politely', () => {
    let err = null;
    try { openMeeting('mtg_nope'); } catch (e) { err = e; }
    ok(!err, 'openMeeting should not throw on an unknown id: ' + (err && err.message));
    notOk(shown('#s-meeting'), 'and it should not open an empty meeting screen');
  });

  test('an auto-group checklist item is not writable', async () => {
    const before = DB.checklistState.length;
    await throwsAsync(() => Store.setChecklistItem(CURRENT_USER, 'meeting:mtg_handbook', true),
      'PUT /checklist/:itemId must reject meeting:* items — API.md marks them read-only');
    eq(DB.checklistState.length, before, 'no checklist_state row should have been written');
  });

  test('an unknown checklist item id is rejected instead of creating an orphan row', async () => {
    const before = DB.checklistState.length;
    await throwsAsync(() => Store.setChecklistItem(CURRENT_USER, 'itm_does_not_exist', true),
      'an unknown itemId should 404 rather than insert a row that violates the checklist_state foreign key');
    eq(DB.checklistState.length, before, 'no orphan row should have been written');
  });

  test('an unknown employee id is rejected by the checklist write', async () => {
    const before = DB.checklistState.length;
    await throwsAsync(() => Store.setChecklistItem('emp_ghost', 'itm_i9', true),
      'an unknown employeeId should 404 rather than insert a row that violates the checklist_state foreign key');
    eq(DB.checklistState.length, before, 'no orphan row should have been written');
  });

  test('a stored host that is not in the dropdown is still shown accurately', async () => {
    await Store.updateMeeting('mtg_acd', { defaultHost: 'Nadia · Apprentice' });
    await refresh();
    setMode('admin');
    go('a-slots');
    const sel = q('#host_mtg_acd');
    ok(sel, 'the host select should render');
    eq(sel.value, 'Nadia · Apprentice',
      'the dropdown must show the host that is actually stored, not silently fall back to the first option');
  });

  test('a corrupt progress value cannot overflow the roster bar', async () => {
    DB.employees.find(e => e.id === 'emp_sam').progress = 250;
    await refresh();
    setMode('admin');
    const row = qa('#rosterBody tr').find(r => handlerArg(r, 'openEmp') === 'emp_sam');
    ok(row, 'the roster row should render');
    const width = parseFloat(row.querySelector('.mini-bar i').style.width);
    lte(width, 100, 'a corrupt progress value must not draw a bar wider than its track');
  });
});

/* ===== END AUTHORED SUITES ===== */

/* ===================== Resources ========================================= */

suite('Resources · seed integrity', () => {
  test('every child row points at a real category', () => {
    const catIds = DB.resourceCategories.map(c => c.id);
    for (const r of DB.resourceSections)  has(catIds, r.categoryId, `orphan section ${r.id}`);
    for (const r of DB.resourceDocuments) has(catIds, r.categoryId, `orphan document ${r.id}`);
    for (const r of DB.resourceFigures)   has(catIds, r.categoryId, `orphan figure ${r.id}`);
  });

  test('ids are unique and carry their documented prefix', () => {
    const check = (rows, prefix) => {
      const seen = new Set();
      for (const r of rows) {
        notOk(seen.has(r.id), `duplicate id ${r.id}`);
        seen.add(r.id);
        match(r.id, new RegExp('^' + prefix + '_'), `${r.id} should start with ${prefix}_`);
      }
    };
    check(DB.resourceCategories, 'rc');
    check(DB.resourceSections, 'sec');
    check(DB.resourceDocuments, 'doc');
    check(DB.resourceFigures, 'fig');
  });

  test('documents declare a status and a kind the UI can render', () => {
    for (const d of DB.resourceDocuments) {
      has(['draft', 'published'], d.status, `${d.id} has an unknown status`);
      has(['file', 'link'], d.kind, `${d.id} has an unknown kind`);
      if (d.kind === 'link') ok(d.url, `${d.id} is a link with no url`);
      if (d.kind === 'file') ok(d.dataUrl, `${d.id} is a file with no bytes`);
    }
  });

  test('no uploaded file is an SVG', () => {
    for (const d of DB.resourceDocuments) {
      neq(d.mimeType, 'image/svg+xml', `${d.id} is an SVG — a script container, never allowlisted`);
    }
  });

  test('every {{token}} used in prose resolves to a figure', () => {
    for (const sec of DB.resourceSections) {
      const figs = DB.resourceFigures.filter(f => f.categoryId === sec.categoryId).map(f => f.token);
      const text = [].concat(sec.body || [], sec.bullets || [], sec.body2 || []).join(' ');
      const used = text.match(/\{\{(\w+)\}\}/g) || [];
      for (const raw of used) {
        has(figs, raw.slice(2, -2), `section ${sec.id} references ${raw} but no such figure exists`);
      }
    }
  });

  test('every figure is year-stamped and cites a source', () => {
    for (const f of DB.resourceFigures) {
      ok(f.taxYear, `${f.id} has no taxYear — an unstamped figure silently reads as current`);
      match(String(f.sourceUrl), /^https:\/\//, `${f.id} should cite a primary source`);
      ok(f.label, `${f.id} has no label`);
    }
  });

  test('the 1099 category is stamped and carries an audience note', () => {
    const c = DB.resourceCategories.find(x => x.id === 'rc_1099ny');
    ok(c, 'the 1099 category should exist');
    eq(c.taxYear, 2026);
    ok(c.reviewedOn, 'a tax page needs a reviewed date');
    ok(c.audienceNote, 'a tax page needs to say who it is for');
  });

  test('the seed exercises more than one category shape', () => {
    const cats = DB.resourceCategories;
    gte(cats.length, 4, 'seed at least four tabs so the model is exercised, not just demonstrated');
    ok(cats.some(c => c.status === 'draft'), 'at least one draft tab, to prove drafts are invisible');
    ok(DB.resourceDocuments.some(d => d.kind === 'link'), 'at least one link-out document');
    ok(DB.resourceSections.length > 0, 'at least one tab with authored prose');
  });
});

suite('Resources · Store reads and visibility', () => {
  test('employees see only published categories', async () => {
    const mine = await Store.listResourceCategories(false);
    ok(mine.every(c => c.status === 'published'), 'a draft category leaked to the employee list');
    notOk(mine.some(c => c.id === 'rc_pay'), 'rc_pay is a draft and must be absent, not greyed out');
  });

  test('admins see every category, ordered', async () => {
    const all = await Store.listResourceCategories(true);
    eq(all.length, DB.resourceCategories.length);
    const orders = all.map(c => c.sortOrder);
    deepEq(orders, orders.slice().sort((a, b) => a - b), 'categories should come back in sortOrder');
  });

  test('employees see only published documents', async () => {
    const docs = await Store.listResourceDocuments('rc_1099ny', false);
    ok(docs.every(d => d.status === 'published'), 'a draft document leaked');
  });

  test('list reads never carry file bytes', async () => {
    const docs = await Store.listResourceDocuments('rc_1099ny', true);
    for (const d of docs) {
      eq(d.dataUrl, undefined, `${d.id} shipped its bytes in a list response`);
      ok('hasFile' in d, `${d.id} should report hasFile instead`);
    }
  });

  test('a draft category hides its published documents from employees', async () => {
    await Store.updateResourceCategory('rc_1099ny', { status: 'draft' });
    const docs = await Store.listResourceDocuments('rc_1099ny', false);
    len(docs, 0, 'documents in an unpublished category must not be listed');
    const secs = await Store.listResourceSections('rc_1099ny', false);
    len(secs, 0, 'sections in an unpublished category must not be listed');
  });

  test('visibility cascades to direct-id access', async () => {
    await Store.updateResourceCategory('rc_1099ny', { status: 'draft' });
    const f = await Store.getResourceDocFile('doc_setaside', false);
    eq(f, null, 'a published document inside a draft category must not be fetchable by id');
    await throwsAsync(() => Store.openResourceDocument('doc_setaside', false),
      'opening a document in a draft category should be refused');
  });

  test('an admins-only category is invisible to employees', async () => {
    await Store.updateResourceCategory('rc_shop', { visibility: 'admins' });
    const mine = await Store.listResourceCategories(false);
    notOk(mine.some(c => c.id === 'rc_shop'), 'an admins-only category leaked');
    eq(await Store.getResourceDocFile('doc_handbook', false), null, 'its documents leaked too');
    ok((await Store.listResourceCategories(true)).some(c => c.id === 'rc_shop'), 'admins should still see it');
  });

  test('getResourceDocFile returns bytes for a visible document', async () => {
    const f = await Store.getResourceDocFile('doc_setaside', false);
    ok(f, 'the worksheet should be fetchable');
    match(f.dataUrl, /^data:application\/pdf;base64,/, 'expected a PDF data URL');
    ok(f.downloadName, 'a sanitised download name should be present');
  });

  test('a link document has no bytes to fetch', async () => {
    eq(await Store.getResourceDocFile('doc_irs_gig', false), null, 'a link has no file');
  });

  test('unknown ids read as empty rather than throwing', async () => {
    len(await Store.listResourceDocuments('rc_nope', true), 0);
    len(await Store.listResourceSections('rc_nope', true), 0);
    eq(await Store.getResourceDocFile('doc_nope', true), null);
  });

  test('reads are deep clones', async () => {
    const a = await Store.listResourceSections('rc_1099ny', false);
    a[0].heading = 'MUTATED';
    a[0].body.push('injected');
    const b = await Store.listResourceSections('rc_1099ny', false);
    neq(b[0].heading, 'MUTATED', 'mutating a read corrupted DB');
    notOk(b[0].body.includes('injected'), 'a nested array was shared with DB');
  });
});

suite('Resources · Store mutations', () => {
  test('a new category starts as a draft', async () => {
    const c = await Store.addResourceCategory({ name: 'Benefits', shortName: 'Benefits' });
    eq(c.status, 'draft', 'new tabs must not be published by accident');
    eq(c.visibility, 'everyone');
    gt(c.sortOrder, 0);
    notOk((await Store.listResourceCategories(false)).some(x => x.id === c.id));
  });

  test('deleting a category takes its children with it', async () => {
    const secsBefore = DB.resourceSections.filter(x => x.categoryId === 'rc_1099ny').length;
    gt(secsBefore, 0, 'fixture sanity');
    await Store.deleteResourceCategory('rc_1099ny');
    len(DB.resourceSections.filter(x => x.categoryId === 'rc_1099ny'), 0, 'orphaned sections');
    len(DB.resourceDocuments.filter(x => x.categoryId === 'rc_1099ny'), 0, 'orphaned documents');
    len(DB.resourceFigures.filter(x => x.categoryId === 'rc_1099ny'), 0, 'orphaned figures');
  });

  test('reordering rewrites sortOrder', async () => {
    const ids = (await Store.listResourceCategories(true)).map(c => c.id);
    const flipped = [ids[1], ids[0]].concat(ids.slice(2));
    await Store.reorderResourceCategories(flipped);
    const after = (await Store.listResourceCategories(true)).map(c => c.id);
    deepEq(after, flipped, 'the new order should stick');
  });

  test('an uploaded document lands as a draft with a sanitised download name', async () => {
    const d = await Store.addResourceDocument('rc_shop', {
      kind: 'file', title: 'Payroll', dataUrl: 'data:application/pdf;base64,AAA',
      mimeType: 'application/pdf', byteSize: 3, fileName: '../../etc/pay roll?.pdf',
    });
    eq(d.status, 'draft', 'uploads must not publish themselves');
    /* The whole path is discarded and only the basename survives, then anything
       outside [A-Za-z0-9._-] collapses to a hyphen. */
    eq(d.downloadName, 'pay-roll-.pdf', 'directory segments and unsafe characters should be stripped');
    lacks(d.downloadName, '/', 'a download name must never contain a path separator');
    lacks(d.downloadName, '..', 'a download name must never contain a traversal segment');
  });

  test('replacing a file bumps the version and keeps the identity', async () => {
    const before = (await Store.listResourceDocuments('rc_shop', true)).find(d => d.id === 'doc_handbook');
    const after = await Store.replaceResourceDocumentFile('doc_handbook', {
      dataUrl: 'data:application/pdf;base64,BBB', mimeType: 'application/pdf',
      byteSize: 3, fileName: 'new.pdf', updatedOn: '2026-08-02',
    });
    eq(after.id, before.id, 'replace must not mint a new id');
    eq(after.version, before.version + 1);
    eq(after.title, before.title, 'replace swaps bytes, not metadata');
  });

  test('opening a document increments its counter and nothing else', async () => {
    const before = (await Store.listResourceDocuments('rc_1099ny', false)).find(d => d.id === 'doc_setaside');
    await Store.openResourceDocument('doc_setaside', false);
    const after = (await Store.listResourceDocuments('rc_1099ny', false)).find(d => d.id === 'doc_setaside');
    eq(after.openCount, before.openCount + 1);
    notOk(DB.resourceViews, 'no per-employee read receipts — see RESOURCES-SCOPE.md §7');
  });

  test('saving sections replaces the set for that category only', async () => {
    const otherBefore = DB.resourceSections.filter(x => x.categoryId !== 'rc_1099ny').length;
    await Store.saveResourceSections('rc_1099ny', [{ heading: 'Only one', body: ['Hello'], bullets: [] }]);
    len(DB.resourceSections.filter(x => x.categoryId === 'rc_1099ny'), 1);
    eq(DB.resourceSections.filter(x => x.categoryId !== 'rc_1099ny').length, otherBefore,
      'other categories should be untouched');
  });

  test('a figure can be corrected without a code change', async () => {
    const f = await Store.updateResourceFigure('fig_mile', { value: '99¢/mile', taxYear: 2027 });
    eq(f.value, '99¢/mile');
    eq(f.taxYear, 2027);
  });

  test('unknown ids reject', async () => {
    await throwsAsync(() => Store.updateResourceCategory('rc_nope', { name: 'x' }));
    await throwsAsync(() => Store.updateResourceDocument('doc_nope', { title: 'x' }));
    await throwsAsync(() => Store.replaceResourceDocumentFile('doc_nope', {}));
    await throwsAsync(() => Store.updateResourceFigure('fig_nope', { value: 'x' }));
    await throwsAsync(() => Store.addResourceDocument('rc_nope', { title: 'x' }));
  });
});

suite('Resources · employee UI', () => {
  test('the nav offers Resources under a Reference header', () => {
    const labels = qa('#nav .navbtn').map(b => b.textContent.trim());
    has(labels, 'Resources');
    has(qa('#nav .nav-label').map(el => el.textContent.trim()), 'Reference');
  });

  test('the tab strip is a real tablist', () => {
    go('s-resources');
    const strip = q('#resTabs');
    eq(strip.getAttribute('role'), 'tablist');
    const tabs = qa('#resTabs [role="tab"]');
    gt(tabs.length, 0, 'expected tabs');
    len(tabs.filter(t => t.getAttribute('aria-selected') === 'true'), 1, 'exactly one tab is selected');
    len(tabs.filter(t => t.getAttribute('tabindex') === '0'), 1, 'roving tabindex: one stop, not many');
    eq(q('#resPanel').getAttribute('role'), 'tabpanel');
    eq(q('#resPanel').getAttribute('aria-labelledby'), 'tab-emp-' + resOpen, 'panel should name its tab');
  });

  test('draft categories never reach the employee tab strip', () => {
    go('s-resources');
    const ids = qa('#resTabs [role="tab"]').map(t => t.getAttribute('data-cat'));
    lacks(ids, 'rc_pay', 'a draft tab appeared for an employee');
  });

  test('arrow keys move the selection and wrap around', () => {
    go('s-resources');
    const first = qa('#resTabs [role="tab"]')[0].getAttribute('data-cat');
    resTabKey({ key: 'ArrowRight', preventDefault(){} }, 'emp');
    neq(resOpen, first, 'ArrowRight should advance the selection');
    resTabKey({ key: 'Home', preventDefault(){} }, 'emp');
    eq(resOpen, first, 'Home should return to the first tab');
    resTabKey({ key: 'ArrowLeft', preventDefault(){} }, 'emp');
    eq(resOpen, qa('#resTabs [role="tab"]').slice(-1)[0].getAttribute('data-cat'), 'ArrowLeft should wrap to the end');
  });

  test('selecting a tab swaps the panel', () => {
    go('s-resources');
    selectResourceTab('rc_1099ny', 'emp');
    has(text('#resPanel'), '1099 Resources', 'the 1099 panel should render');
    selectResourceTab('rc_shop', 'emp');
    has(text('#resPanel'), 'Shop documents');
    lacks(text('#resPanel'), 'The one idea everything else rests on', 'prose from the other tab leaked');
  });

  test('figure tokens are substituted and year-stamped', () => {
    go('s-resources');
    selectResourceTab('rc_1099ny', 'emp');
    const figs = qa('#resPanel .fig');
    gt(figs.length, 0, 'expected at least one substituted figure');
    lacks(html('#resPanel'), '{{', 'an unresolved token reached the page');
    ok(figs.some(f => f.querySelector('sup')), 'each figure should carry the year it applies to');
  });

  test('the tax page carries its disclaimer', () => {
    go('s-resources');
    selectResourceTab('rc_1099ny', 'emp');
    has(text('#resPanel'), 'not tax or legal advice');
  });

  test('the 1099 page keeps the owner’s framing', () => {
    go('s-resources');
    selectResourceTab('rc_1099ny', 'emp');
    const t = text('#resPanel');
    has(t, 'Tracking income');
    has(t, 'Tracking expenses');
    has(t, 'Filing and paying');
    /* Explicitly not an empowerment page and not a programme brand. */
    lacks(t.toLowerCase(), 'be your own boss');
    lacks(t.toLowerCase(), 'pro contractor');
  });

  test('documents render with view and download affordances', () => {
    go('s-resources');
    selectResourceTab('rc_1099ny', 'emp');
    const rows = qa('#resPanel .doc-row');
    gt(rows.length, 0);
    const labels = rows.map(r => r.textContent);
    ok(labels.some(l => l.includes('Quarterly set-aside worksheet')));
    ok(qa('#resPanel .doc-actions button').some(b => b.textContent.trim() === 'View'));
  });

  test('a link document opens out rather than into the viewer', () => {
    go('s-resources');
    selectResourceTab('rc_1099ny', 'emp');
    const link = qa('#resPanel .doc-row a').find(a => a.textContent.includes('Open'));
    ok(link, 'expected an external link affordance');
    match(link.getAttribute('href'), /^https:\/\//);
    eq(link.getAttribute('rel'), 'noopener noreferrer', 'external links need rel=noopener');
  });

  test('employees never see admin controls', () => {
    go('s-resources');
    selectResourceTab('rc_shop', 'emp');
    const t = html('#resPanel');
    lacks(t, 'deleteDoc(');
    lacks(t, 'toggleDocStatus(');
    lacks(t, 'replaceDoc(');
  });

  test('an empty tab shows an empty state rather than nothing', async () => {
    const c = await Store.addResourceCategory({ name: 'Empty', shortName: 'Empty' });
    await Store.updateResourceCategory(c.id, { status: 'published' });
    await refresh();
    selectResourceTab(c.id, 'emp');
    has(text('#resPanel'), 'No documents in this tab yet');
  });

  test('with no published categories the screen still renders', async () => {
    for (const c of DB.resourceCategories.slice()) await Store.deleteResourceCategory(c.id);
    await refresh();
    go('s-resources');
    eq(html('#resTabs'), '', 'no tabs to draw');
    has(text('#resPanel'), 'No resources have been published yet');
  });
});

suite('Resources · viewer', () => {
  test('opening a PDF builds an object URL and shows the overlay', async () => {
    await openDoc('doc_setaside');
    ok(q('#viewer').classList.contains('open'), 'the overlay should be open');
    ok(viewerUrl, 'an object URL should be live');
    const frame = q('#vBody iframe');
    ok(frame, 'a PDF renders in an iframe');
    match(frame.getAttribute('src'), /^blob:/, 'never a data: URL at the top level');
    eq(document.body.style.overflow, 'hidden', 'the page behind should not scroll');
  });

  test('closing revokes the object URL and restores scrolling', async () => {
    await openDoc('doc_setaside');
    closeViewer();
    notOk(q('#viewer').classList.contains('open'));
    eq(viewerUrl, null, 'the object URL should be revoked, not leaked');
    eq(html('#vBody'), '', 'the frame should be torn down');
    eq(document.body.style.overflow, '');
  });

  test('only one object URL is ever live', async () => {
    await openDoc('doc_setaside');
    const first = viewerUrl;
    await openDoc('doc_mileage');
    neq(viewerUrl, first, 'a second open should mint a fresh URL');
    ok(viewerUrl, 'and hold exactly one');
  });

  test('Escape closes the viewer', async () => {
    await openDoc('doc_setaside');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    notOk(q('#viewer').classList.contains('open'), 'Escape should close the overlay');
  });

  test('opening a document counts as an open', async () => {
    const before = DB.resourceDocuments.find(d => d.id === 'doc_setaside').openCount;
    await openDoc('doc_setaside');
    eq(DB.resourceDocuments.find(d => d.id === 'doc_setaside').openCount, before + 1);
  });

  test('safeFileUrl passes blobs and allowlisted data URLs, strips the rest', () => {
    match(safeFileUrl('blob:http://x/abc'), /^blob:/);
    match(safeFileUrl('data:application/pdf;base64,AAA'), /^data:application\/pdf/);
    eq(safeFileUrl('javascript:alert(1)'), '', 'javascript: must be stripped');
    eq(safeFileUrl('data:text/html;base64,AAA'), '', 'data:text/html must be stripped');
    eq(safeFileUrl('data:image/svg+xml;base64,AAA'), '', 'SVG must never be allowlisted');
  });

  test('the handbook meeting opens a real document instead of a stub', async () => {
    openMeeting('mtg_handbook');
    const btn = qa('#s-meeting button').find(b => b.textContent.includes('Open the handbook'));
    ok(btn, 'the handbook button should be present');
    eq(handlerArg(btn, 'openDoc'), 'doc_handbook', 'it should open the seeded handbook document');
  });
});

suite('Resources · admin UI', () => {
  test('the admin nav offers Resources', () => {
    setMode('admin');
    has(qa('#nav .navbtn').map(b => b.textContent.trim()), 'Resources');
  });

  test('admins see drafts, marked as drafts', () => {
    setMode('admin');
    go('a-resources');
    const ids = qa('#resTabsAdmin [role="tab"]').map(t => t.getAttribute('data-cat'));
    has(ids, 'rc_pay', 'admins should see the draft tab');
    has(text('#catAdmin'), 'Draft');
  });

  test('publishing a tab makes it visible to employees', async () => {
    setMode('admin');
    await toggleCategoryStatus('rc_pay');
    setMode('employee');
    go('s-resources');
    has(qa('#resTabs [role="tab"]').map(t => t.getAttribute('data-cat')), 'rc_pay');
  });

  test('unpublishing a tab removes it from the employee view', async () => {
    setMode('admin');
    await toggleCategoryStatus('rc_shop');
    setMode('employee');
    go('s-resources');
    lacks(qa('#resTabs [role="tab"]').map(t => t.getAttribute('data-cat')), 'rc_shop');
  });

  test('publishing a document makes it readable', async () => {
    setMode('admin');
    await toggleDocStatus('doc_paysched');
    await Store.updateResourceCategory('rc_pay', { status: 'published' });
    await refresh();
    const docs = await Store.listResourceDocuments('rc_pay', false);
    ok(docs.some(d => d.id === 'doc_paysched'), 'the published document should now be listed');
  });

  test('adding a tab through the form works end to end', async () => {
    setMode('admin');
    go('a-resources');
    openAddCategory();
    q('#cfName').value = 'Benefits';
    q('#cfShort').value = 'Benefits';
    q('#cfBlurb').value = 'Health cover and time off.';
    await saveCategory();
    ok(state.resources.allCategories.some(c => c.name === 'Benefits'), 'the tab should exist');
    eq(q('#catForm').style.display, 'none', 'the form should close');
  });

  test('deleting a tab names the consequence and removes the children', async () => {
    setMode('admin');
    const orig = window.confirm;
    let asked = '';
    try {
      window.confirm = msg => { asked = msg; return true; };
      await deleteCategory('rc_1099ny');
    } finally { window.confirm = orig; }
    has(asked, 'document', 'the confirm should say what else is deleted');
    notOk(DB.resourceCategories.some(c => c.id === 'rc_1099ny'));
    len(DB.resourceSections.filter(x => x.categoryId === 'rc_1099ny'), 0);
  });

  test('cancelling a delete changes nothing', async () => {
    setMode('admin');
    const orig = window.confirm;
    const before = DB.resourceCategories.length;
    try { window.confirm = () => false; await deleteCategory('rc_1099ny'); }
    finally { window.confirm = orig; }
    eq(DB.resourceCategories.length, before, 'declining the confirm must not delete');
  });

  test('reordering moves a tab', async () => {
    setMode('admin');
    const before = state.resources.allCategories.map(c => c.id);
    await moveCategory(before[1], -1);
    const after = state.resources.allCategories.map(c => c.id);
    eq(after[0], before[1], 'the moved tab should now be first');
  });

  test('the sections editor round-trips edits', async () => {
    setMode('admin');
    go('a-resources');
    selectResourceTab('rc_1099ny', 'adm');
    const first = state.resources.sections['rc_1099ny'][0];
    q('#sh_' + first.id).value = 'Renamed heading';
    q('#sb_' + first.id).value = 'One paragraph.\n\nAnd another.';
    q('#sl_' + first.id).value = 'bullet one\nbullet two';
    await saveSections('rc_1099ny');
    const saved = state.resources.sections['rc_1099ny'][0];
    eq(saved.heading, 'Renamed heading');
    len(saved.body, 2, 'blank lines separate paragraphs');
    len(saved.bullets, 2, 'newlines separate bullets');
  });

  test('the upload guard rejects the wrong type and oversized files', async () => {
    setMode('admin');
    go('a-resources');
    selectResourceTab('rc_shop', 'adm');
    const before = DB.resourceDocuments.length;

    pickDoc('rc_shop');
    onDocFile({ target: { files: [new File(['x'], 'evil.svg', { type: 'image/svg+xml' })], value: '' } });
    eq(DB.resourceDocuments.length, before, 'an SVG must never be accepted');

    pickDoc('rc_shop');
    const big = new File([new Uint8Array(RESOURCE_MAX_BYTES + 1)], 'big.pdf', { type: 'application/pdf' });
    onDocFile({ target: { files: [big], value: '' } });
    eq(DB.resourceDocuments.length, before, 'an oversized file must be rejected');

    onDocFile({ target: { files: [], value: '' } });
    eq(DB.resourceDocuments.length, before, 'an empty picker must be a no-op');
  });

  test('a valid upload lands as a draft in the right tab', async () => {
    setMode('admin');
    go('a-resources');
    const before = DB.resourceDocuments.length;
    pickDoc('rc_shop');
    onDocFile({ target: { files: [new File(['%PDF-1.4 x'], 'Fire safety.pdf', { type: 'application/pdf' })], value: '' } });
    /* FileReader is async — wait for the row to appear rather than sleeping. */
    for (let i = 0; i < 50 && DB.resourceDocuments.length === before; i++) await new Promise(r => setTimeout(r, 0));
    eq(DB.resourceDocuments.length, before + 1, 'the upload should have created a row');
    const added = DB.resourceDocuments[DB.resourceDocuments.length - 1];
    eq(added.categoryId, 'rc_shop');
    eq(added.status, 'draft', 'uploads must not self-publish');
    eq(added.title, 'Fire safety', 'the extension should be dropped from the title');
    eq(added.downloadName, 'Fire-safety.pdf', 'the download name should be sanitised');
  });
});

suite('Resources · escaping', () => {
  test('a category name containing markup renders inert', async () => {
    delete window.__XSS__;
    const c = await Store.addResourceCategory({ name: '<img src=x onerror="window.__XSS__=1">Bad', shortName: 'Bad' });
    await Store.updateResourceCategory(c.id, { status: 'published' });
    await refresh();
    go('s-resources');
    selectResourceTab(c.id, 'emp');
    notOk(window.__XSS__, 'the payload executed');
    eq(q('img[src="x"]'), null, 'the payload became a live element');
    has(text('#resPanel'), '<img src=x', 'the literal text should be visible');
  });

  test('a document title containing markup renders inert', async () => {
    delete window.__XSS__;
    const d = await Store.addResourceDocument('rc_shop', {
      kind: 'file', title: '<img src=y onerror="window.__XSS__=1">', dataUrl: 'data:application/pdf;base64,AAA',
      mimeType: 'application/pdf', byteSize: 3, fileName: 'x.pdf',
    });
    await Store.updateResourceDocument(d.id, { status: 'published' });
    await refresh();
    go('s-resources');
    selectResourceTab('rc_shop', 'emp');
    notOk(window.__XSS__, 'the payload executed');
    eq(q('img[src="y"]'), null, 'the payload became a live element');
  });

  test('authored prose cannot inject markup', async () => {
    delete window.__XSS__;
    await Store.saveResourceSections('rc_shop', [{
      heading: 'Hi <b>there</b>',
      body: ['<img src=z onerror="window.__XSS__=1">'],
      bullets: ['</div><script>window.__XSS__=1</script>'],
    }]);
    await refresh();
    go('s-resources');
    selectResourceTab('rc_shop', 'emp');
    notOk(window.__XSS__, 'the payload executed');
    eq(q('img[src="z"]'), null);
    eq(q('#resPanel .article b'), null, 'raw HTML in a heading should not become an element');
  });

  test('a figure value cannot inject markup', async () => {
    delete window.__XSS__;
    await Store.updateResourceFigure('fig_se', { value: '<img src=w onerror="window.__XSS__=1">' });
    await refresh();
    go('s-resources');
    selectResourceTab('rc_1099ny', 'emp');
    notOk(window.__XSS__, 'a figure value executed');
    eq(q('img[src="w"]'), null);
  });

  test('an unknown token is left visible rather than silently dropped', async () => {
    await Store.saveResourceSections('rc_shop', [{ heading: 'T', body: ['Rate is {{no_such_token}}.'], bullets: [] }]);
    await refresh();
    go('s-resources');
    selectResourceTab('rc_shop', 'emp');
    has(text('#resPanel'), '{{no_such_token}}', 'a missing figure should be obvious, not invisible');
  });

  test('a link document cannot smuggle a javascript: URL', async () => {
    const d = await Store.addResourceDocument('rc_shop', { kind: 'link', title: 'Bad link', url: 'javascript:window.__XSS__=1' });
    await Store.updateResourceDocument(d.id, { status: 'published' });
    await refresh();
    go('s-resources');
    selectResourceTab('rc_shop', 'emp');
    const bad = qa('#resPanel a').find(a => (a.getAttribute('href') || '').startsWith('javascript:'));
    notOk(bad, 'a javascript: href reached the page');
  });
});

/* ===================== go ================================================ */

run();

})();
