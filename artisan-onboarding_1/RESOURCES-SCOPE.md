# Resources — feature scope

A new top-level **Resources** section holding mini-tabs. Admins upload documents into a
mini-tab; employees read them. The first seeded mini-tab is **1099 Resources — New York**:
first-principles material on tracking income, tracking expenses, and filing taxes.

This document records the decisions. Where two reasonable designs existed, the one not taken
is named, so the choice does not get re-litigated later.

---

## 1. Goals and non-goals

**Goals**
- One place for reference material, organised into mini-tabs the admin controls.
- Admin uploads a file; every employee who can see the tab can read it.
- A 1099 area for New York that is plainly written, correct, and stays correct.

**Non-goals — and these are load-bearing, not throat-clearing**
- **Not a learning-management system.** The product's existing boundary holds: courses,
  videos, assessments and completion tracking live on the separate training site.
- **Not per-person document delivery.** Every document in a tab is visible to everyone who
  can see that tab. Individual tax forms, pay stubs and anything else naming one person are
  explicitly out of scope — see §7.
- **Not acknowledgment capture.** Nothing here collects a signature.
- **Not tax advice.** The 1099 area is reference material. See §8.

### The test that keeps Resources from becoming the LMS

> If anyone would ever need to answer *"who completed this, when, and did they pass?"*,
> it is training, and it belongs on the training site.

Reference material is read at the reader's discretion: no sequence, no assessment, no
completion state. This sentence is repeated in `README.md` and in `schema.sql` so it survives
the next contributor.

---

## 2. Data model

Three research streams proposed three mutually incompatible models. They disagreed on table
names, four id prefixes, whether an article is a document, and whether prose hangs off the
category or off a document. Implementing any two would produce a broken file, so the spine is
fixed here.

**Decision — four tables:**

| Table | Prefix | What it is |
| --- | --- | --- |
| `resource_categories` | `rc_` | A mini-tab. |
| `resource_sections` | `sec_` | Authored prose, **child of the category**. |
| `resource_documents` | `doc_` | An uploaded file, or a link out. |
| `resource_figures` | `fig_` | A year-stamped number referenced from prose. |

**Why sections hang off the category, not off a document.** It lets a mini-tab be *both* a
readable page and a folder of files without a `kind` discriminator on the container. The
rejected alternative (sections as children of a document, plus `leadDocId` on the category)
needs a `kind ENUM('article','file')` on documents — which the same proposal argued against.

**Rejected:** `rd_`, `rtab_`, `rsec_` prefixes; a `resource_views` per-employee read-receipt
table (see §7).

`resource_documents.kind` is `'file' | 'link'` — a link is a pointer out to an authority's own
page, which is how you avoid copying a government PDF that will be superseded.

---

## 3. The staleness mechanism

The single most important content gap: **a hardcoded 2026 figure is wrong in 2027**, and a
tax page whose value is being current fails silently and invisibly.

`resource_figures` holds `(token, taxYear, value, label, sourceUrl)`. Prose references
`{{mileage_rate}}`; the renderer substitutes the value for the category's current `taxYear`
and shows the year and source next to it. An admin corrects a figure without touching code.

Every figure in the seed is stamped with the year it applies to. The 2026 standard mileage
rate is a genuine mid-year split — 72.5¢ for Jan–Jun, 76¢ for Jul–Dec — which is exactly the
kind of detail that makes hardcoding untenable.

Prose is authored so that **no sentence depends on a figure staying still.** Where a number
would go stale and is not worth tracking, the source is named instead of the value.

---

## 4. Access control

| Field | Values | Enforcement |
| --- | --- | --- |
| `status` | `draft` \| `published` | Employees see published only. |
| `visibility` | `everyone` \| `admins` | Admins-only tabs are invisible, not greyed out. |

Both **cascade**: a published document inside a draft or admins-only category is not reachable,
including by direct id. Without this, a document is exposed the moment anyone learns its id.

The client Employee/Admin toggle is presentation only. In production the role comes from the
session, and `?include=all` is a *request* honoured only for admins — silently downgraded
otherwise, never `403`, because a 403 confirms drafts exist.

---

## 5. File upload

**Prototype:** 2 MB cap, enforced with a message naming the reason — the prototype holds file
bytes in memory as a base64 string, so this is a real constraint, not a policy.

**Allowlist:** PDF, PNG, JPEG, WebP. **Never SVG** — an SVG is a script container, and `blob:`
URLs inherit the creating page's origin.

The client MIME check is UX courtesy only and is commented as such: `file.type` is guessed from
the extension, so renaming `payload.html` to `payload.pdf` passes it. Production must sniff
magic bytes, require the sniffed type to match the declared one, and store the sniffed value as
authoritative.

**Filenames** have two separate uses. The original is kept verbatim for display and always
rendered through `esc()`. A sanitised `downloadName` is derived at write time for the `download`
attribute and, in production, for `Content-Disposition`.

**Viewing.** `data URL → Blob → object URL → <iframe>` in an overlay. Never
`window.open(dataUrl)` (Chrome blocks top-level `data:` navigation) and never
`<iframe src="data:application/pdf">`. Exactly one live object URL at a time, revoked on close
*after* the frame is torn down. Formats a browser cannot render get Download only, never a
View button that would disappoint.

A new `safeFileUrl()` helper accepts only `blob:` and allowlisted `data:` MIMEs. The existing
`safeUrl()` is left alone — it correctly strips `blob:` for image contexts.

---

## 6. Information architecture

**Employee nav:** Home · Meet the shop · My checklist · Meetings · Training access ·
**Resources** · Questions. Resources and Questions sit under a second "Reference" header.

**Admin nav:** Resources appended after Content.

**Tab strip.** Pills on the page background, brass when active. **Never sticky at any width** —
the sidenav is already a sticky horizontal scroller at ≤880px, and a second sticky strip beneath
it eats the viewport on a phone. The tab strip scrolls away with the page.

**Accessibility.** A real `role="tablist"` with `role="tab"` buttons and one `role="tabpanel"`,
roving `tabindex`, and ArrowLeft/ArrowRight/Home/End with wraparound.

**Checklist.** One generic item — *"Know where shop resources and reference documents live"* — in
Shop setup. Deliberately **no** 1099- or tax-specific checklist item: making a tax page a
completion requirement is precisely the control signal §8 warns about.

**Deferred:** hash deep-linking to a mini-tab. Worth ~20 lines, but `go()` touches no URL today
and `#selftest` already uses the hash. Recorded as the next thing to add, not shipped blind.

---

## 7. What is deliberately not tracked

**No per-employee read receipts.** Aggregate `openCount` only.

A receipts table on a tax-information page creates a record of which worker read about
misclassification, retained indefinitely and discoverable. It also breaks on contact with
reality: the proposed `ON DELETE CASCADE` from `employees` erases the record the moment someone
is offboarded, which is exactly when you would want it.

Admin's actual question is *"is anyone reading this?"* — which a counter answers.

---

## 8. The 1099 area: framing, and one real risk

The shop owner's framing is adopted as written: **not** empowerment content, **not** a
"pro contractor" programme brand. First principles, then mechanics, across three pillars —
tracking income, tracking expenses, filing taxes.

**The risk worth naming.** A business that gives detailed operational direction to workers it
classifies as independent contractors can find that direction cited as evidence of *control* in
a misclassification analysis. The NYS Workers' Compensation Board's own Example 6 is a
booth-renting barber who is "generally considered an employee."

This is not solved by a disclaimer. It is solved by how the material is written:

- It explains **how the tax system works**, never how to run your business. No pricing, no
  hours, no client-handling, no booking guidance.
- It is **optional reference**, never a task, never a checklist item, never assigned.
- It is **not shop-specific**. It cites IRS, NYS Tax, NYSDOL and NYC Finance, and points at
  their pages rather than paraphrasing into house rules.
- It states plainly that classification is determined by law and the facts of the arrangement,
  **not by a job title, a contract, or a licence** — a NYS Area Renter licence is a licensing
  classification and does not establish independent-contractor status.
- It names the NYSDOL misclassification line (866-435-1499) as a neutral fact. Omitting it to
  protect the shop would be the wrong call, and including it costs nothing that honesty does not
  already cost.

A standing disclaimer appears on every article: informational, not tax or legal advice, figures
change, confirm with a professional and with the agency's own page.

**Container mismatch, flagged not solved.** The onboarding checklist seeds *"Form I-9 process"*
and *"Federal and state tax documentation"* — W-2 employee items. A 1099 tab inside a W-2
onboarding flow is a question about who actually works at this shop and how they are engaged.
That is the owner's to answer; it is surfaced here rather than silently resolved.

---

## 9. Phasing

**Prototype (this change)** — nav item, accessible tab strip, four seeded categories, the 1099
page reading well with year-stamped figures, view and download of seeded documents, admin
create/rename/reorder/publish/delete of categories, upload/replace/publish/delete of documents,
a real sections editor, and the Step I handbook button wired to an actual resource document
instead of a stub toast.

**v1 backend** — object storage with short-lived signed URLs, magic-byte sniffing and AV scan,
a write audit log, a document-versions table, server-derived roles, retention and offboarding
rules.

**Later** — hash deep-linking, search across documents, "new since you last looked", per-role
visibility beyond the two-value enum.

---

## 10. Seeded categories

Four, chosen to exercise different shapes rather than to look tidy:

| Tab | Shape it tests |
| --- | --- |
| Shop documents | Files only, no prose. |
| 1099 Resources — New York | Long-form prose + figures + attached worksheets. |
| Health & sanitation | Files plus a link out to a state page. |
| Pay & payroll | Draft — proves unpublished tabs are invisible to employees. |

---

## 11. Sources

Every figure in the seeded 1099 content carries a `sourceUrl` to a primary source: `irs.gov`,
`tax.ny.gov`, `dol.ny.gov`, `dos.ny.gov`, `nyc.gov/finance`. An adversarial verification pass
over the researched claims corrected fifteen of forty-five, including three internal
contradictions — among them an MCTMT threshold that changed to $150,000 for tax years beginning
on or after 1 January 2026, a NYC UBT credit that zeroes at $85,000 of taxable income rather
than $95,000, and sales-tax return forms that pointed at the monthly filer's return instead of
the quarterly one. Numbers on this page are cheap to get wrong and expensive to be wrong about.
