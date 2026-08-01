#!/usr/bin/env node
/* ==========================================================================
   Artisan Barber — Onboarding
   Headless test runner

   Opens index.html?selftest=1 in a bundled Chromium, lets tests.js run, and
   reads the results back out of the dumped DOM. Exits non-zero if anything
   failed, so it drops straight into CI.

   No npm dependencies — this is plain Node driving a browser binary that is
   already on the machine. The app itself stays dependency-free too.

     node run-tests.mjs                 # find a browser automatically
     node run-tests.mjs --json          # machine-readable output
     CHROME_BIN=/path/to/chrome node run-tests.mjs
   ========================================================================== */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = resolve(HERE, 'index.html');
const JSON_OUT = process.argv.includes('--json');
const TIMEOUT_MS = 60_000;

/* ---- locate a Chromium ------------------------------------------------- */

function candidates() {
  const out = [];
  if (process.env.CHROME_BIN) out.push(process.env.CHROME_BIN);

  /* Playwright's browser cache, whatever revision happens to be installed. */
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (existsSync(pw)) {
    let entries = [];
    try { entries = readdirSync(pw); } catch { /* unreadable cache is not fatal */ }
    /* headless_shell first: smaller and purpose-built for exactly this. */
    for (const dir of entries.filter(d => d.startsWith('chromium_headless_shell'))) {
      out.push(join(pw, dir, 'chrome-linux', 'headless_shell'));
    }
    for (const dir of entries.filter(d => d.startsWith('chromium-'))) {
      out.push(join(pw, dir, 'chrome-linux', 'chrome'));
      out.push(join(pw, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
    }
  }

  out.push(
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable', '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  );
  return out;
}

function findBrowser() {
  for (const path of candidates()) if (path && existsSync(path)) return path;
  return null;
}

/* ---- run --------------------------------------------------------------- */

function dumpDom(browser, url) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(browser, [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--allow-file-access-from-files',
      '--virtual-time-budget=25000',
      '--dump-dom',
      url,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`browser timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => {
      clearTimeout(timer);
      if (!stdout) reject(new Error(`browser exited ${code} with no output\n${stderr.slice(0, 2000)}`));
      else resolvePromise({ stdout, stderr, code });
    });
  });
}

function extractReport(dom) {
  const m = dom.match(/<script type="application\/json" id="test-results">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/* ---- report ------------------------------------------------------------ */

const RED = s => `\x1b[31m${s}\x1b[0m`;
const GREEN = s => `\x1b[32m${s}\x1b[0m`;
const DIM = s => `\x1b[2m${s}\x1b[0m`;

function die(msg) {
  console.error(RED('✗ ' + msg));
  process.exit(1);
}

const browser = findBrowser();
if (!browser) {
  die('no Chromium found. Set CHROME_BIN=/path/to/chrome, or install Chrome/Chromium.\n' +
      '  Looked in: ' + candidates().slice(0, 6).join(', ') + ' …');
}
if (!existsSync(PAGE)) die(`index.html not found next to this script (${PAGE})`);

if (!JSON_OUT) console.log(DIM(`browser: ${browser}`));

let dom;
try {
  ({ stdout: dom } = await dumpDom(browser, `file://${PAGE}?selftest=1`));
} catch (err) {
  die(`could not run the browser: ${err.message}`);
}

const report = extractReport(dom);
if (!report) {
  if (/SELFTEST LOAD ERROR/.test(dom)) {
    die('tests.js failed to load. Keep it in the same folder as index.html.');
  }
  die('no test results in the page. tests.js may have thrown before reporting.\n' +
      '  Re-run in a browser with index.html?selftest=1 and check the console.');
}

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.failed ? 1 : 0);
}

for (const f of report.failures) {
  console.log(RED(`✗ ${f.label}`));
  console.log(`  ${f.message}`);
  if (f.stack) console.log(DIM(f.stack.split('\n').map(l => '    ' + l.trim()).join('\n')));
  console.log('');
}

const summary = `${report.passed}/${report.total} passed · ${report.suites} suites · ${report.durationMs}ms`;
console.log(report.failed ? RED(`✗ ${summary} · ${report.failed} FAILED`) : GREEN(`✓ ${summary}`));
process.exit(report.failed ? 1 : 0);
