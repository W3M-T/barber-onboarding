# Testing

The app is a single self-contained `index.html` with no build step and no
dependencies. The harness preserves all three: it adds no framework, no bundler,
and no restructuring of the app to make it importable.

## Running

```
open index.html?selftest=1     # in a browser — results render in an overlay panel
node run-tests.mjs             # headless — exits non-zero on failure
node run-tests.mjs --json      # machine-readable
CHROME_BIN=/path/to/chrome node run-tests.mjs
```

`run-tests.mjs` has **no npm dependencies**. It finds a Chromium already on the
machine, opens the page with `--dump-dom`, and reads a JSON results marker back out
of the DOM.

Nothing loads during normal use — `tests.js` is injected only when the URL carries
`?selftest=1` or `#selftest`.

## How it works

`index.html` declares `DB`, `Store`, `state` and the render functions at the top
level of a classic `<script>`. Classic scripts share one global lexical scope, so
`tests.js` — injected as a classic script after the initial `refresh()` — reaches
all of them directly. No imports, no exports, no seam to maintain.

## Isolation

Before every test the harness restores the pristine `DB` seed, clears the dynamic
screens, resets the UI globals, closes the document viewer (revoking any live object
URL), then awaits `refresh()` and returns to the employee view.

**Tests never clean up after themselves.** If a test needs a fixture, it creates it
and moves on.

## Writing a test

```js
suite('Area', () => {
  test('does the thing', async () => {
    const e = await Store.getEmployee('emp_jordan');
    eq(e.role, 'Assistant Stylist', 'the seeded role should survive a read');
  });
});
```

Assertions: `ok` `notOk` `eq` `neq` `deepEq` `gt` `gte` `lt` `lte` `len` `has`
`lacks` `match` `throwsAsync`.

DOM helpers: `q` `qa` `text` `html` `shown` `click` `handlerArg`.

`handlerArg(el, 'openMember')` pulls the argument back out of an inline
`onclick="openMember('tm_charlie')"`, so wiring can be asserted without `eval`.

Every assertion takes a message saying what *should* have happened, so a CI failure
is readable without opening the file.

### Rules

1. **Never depend on generated ids.** `newId()` increments a counter that is not
   reset between tests. Capture the id from the return value.
2. **Never depend on wall-clock time or randomness.** The CLI runner uses
   `--virtual-time-budget`, which fast-forwards timers. `parseWhen()` hardcodes 2026.
3. **Assert intended behaviour, not current behaviour.** If the code is wrong, the
   test should fail — then fix the code, not the test.
4. **If you stub a global, restore it in `finally`** so a failure cannot poison
   later tests.

## What is covered

- **Seed integrity** — referential integrity across every table, id prefix
  conventions, uniqueness, and the invariants the architecture comments claim.
- **`Store` reads** — ordering, filtering, derived fields, the applicable-meeting
  rules, and checklist merging.
- **`Store` mutations** — the meeting lifecycle, team CRUD, slots, content, and the
  resource categories, documents, sections and figures.
- **Architectural invariants** — clone isolation, progress monotonicity, and
  derived-value correctness.
- **Pure helpers** — `initialsOf`, `parseWhen` (including the 12 AM/PM boundaries),
  `fmtICS`, and the `.ics` export.
- **Render layer** — navigation, every screen, both views, and the empty states.
- **End-to-end flows** — scheduling, rescheduling, acknowledging, ticking checklist
  items, and the seam where an admin action shows up in the employee view.
- **Escaping** — HTML injection through every admin-controlled field that reaches
  the DOM, and apostrophes in names that would otherwise break inline handlers.
- **Resources** — visibility cascade (a published document inside a draft category
  must not be reachable by direct id), the upload allowlist and size cap, download-name
  sanitisation, the tablist keyboard contract, and the viewer's object-URL lifecycle.

## Adding it to CI

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with: { node-version: '22' }
- run: node artisan-onboarding_1/run-tests.mjs
```

Ubuntu runners ship Chrome at a path the runner already probes. Set `CHROME_BIN` if
yours does not.
