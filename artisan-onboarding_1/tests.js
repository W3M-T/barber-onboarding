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
