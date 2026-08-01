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
const DYNAMIC_SCREENS = ['#s-member', '#s-meeting', '#a-employee'];

async function resetApp() {
  restoreDB();
  rescheduleId = null;
  editId = null;
  uploadTargetId = null;
  for (const sel of DYNAMIC_SCREENS) { const el = q(sel); if (el) el.innerHTML = ''; }
  const form = q('#memberForm'); if (form) form.style.display = 'none';
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

/* ===================== go ================================================ */

run();

})();
