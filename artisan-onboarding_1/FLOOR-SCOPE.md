# Floor — feature scope

Two things that arrived together and are deliberately kept apart:

- **The hourly box.** Every hour of a shift, a person can see what they are meant to be doing.
  Admin authors it per role and adjusts it whenever.
- **Bounties.** Weekly, monthly and quarterly work that is not tied to an hour, picked up by
  whoever has spare time.

This document records the decisions. Where two reasonable designs existed, the one not taken is
named, so the choice does not get re-litigated later.

---

## 1. They are two different animals, and the schema says so

The tempting simplification is "a bounty is just a duty without an hour." It breaks both.

| | Hourly duty | Bounty |
| --- | --- | --- |
| Identified by | *(role, weekday, hour)* | *(bounty, period)* |
| Lifetime | Recurs forever, unchanged | One instance per period, then a new one |
| Completion | Ticked per person **per day**, then the day resets | Claimed → done, or missed |
| Retention | A rolling 14 days | Forever — the miss is the record |
| Assigned to | A role | Claimed by one person at a time |

Both are tickable, but they are ticked against different things and kept for different lengths of
time. A duty's tick answers *"what is still outstanding on this shift"* and is worthless a
fortnight later. A bounty's outcome answers *"did the quarterly deep-clean happen"* and is the
whole point in November.

Collapsing them forces one of two bad outcomes: bounties lose their instancing and you cannot
tell a done bounty from a never-done one, or duties inherit permanent per-period history and the
feature becomes an attendance record.

---

## 2. Data model

| Table | Prefix | What it is |
| --- | --- | --- |
| `duty_schedules` | `sch_` | One per role. Owns the standing duties and the day rules. |
| `duty_standing` | `std_` | A duty true for the whole shift. Child of the schedule. |
| `duty_blocks` | `blk_` | One hour of a day. Carries `hour` and `dayKey`. |
| `duty_items` | `dut_` | One duty line inside a block. A row, because it is tickable — see §4. |
| `duty_checks` | — | `(employee, local date, duty item)`. The daily checklist. Rolling 14 days. |
| `bounties` | `bty_` | A bounty definition: what, how long, how often, who may take it. |
| `bounty_instances` | `bi_` | One per bounty per period. Holds the claim and the outcome. |

`bounties` → `bounty_instances` is deliberately the same template/instance shape as
`meetings` → `employee_meetings`. The seed-integrity tests already know how to verify that
pattern, and a second, differently-shaped instancing mechanism in one small app is a cost with
no payoff.

**Schedules are keyed by role, not by person.** Two front desk concierges do the same job; a
per-person schedule means authoring the same eight hours twice and watching them drift. Where a
person genuinely differs from their role, that is a role, and it costs one row.

**Rejected:** `duty_` as a prefix for both schedules and blocks (ambiguous at a glance in a
stack trace); per-person schedules; a single `duties` table with a nullable `hour` column, which
makes "standing" and "hour-specific" the same shape and loses the §3 win.

---

## 3. Standing duties vs. hour-specific duties

"Consistent hourly duties" is really two lists:

- **Standing** — true for every hour of the shift. *Greet every arrival within fifteen seconds.
  Keep the book current. Waiting area presentable.*
- **Hour-specific** — what makes 10am different from 4pm. *Confirm tomorrow's appointments.
  Restock retail before the evening rush.*

Without the split, an admin retypes six standing items into eight hourly boxes, and the eight
copies drift apart the first time one of them changes. With it, the 4pm box holds only what is
actually true of 4pm, which is the entire point of looking at it.

The UI shows standing duties once, persistently, above the current hour — not repeated into
every block.

---

## 4. The hourly box is also a daily checklist

**Decision: each duty is tickable, per person, per day. Reference *and* checklist.**

### The reversal, recorded

This was first built reference-only. The argument was that *"so they always know what to do every
hour"* is about knowing rather than proving, and that per-hour completion buys a per-employee
activity record plus a question with no good answer: **what does an unchecked 2pm mean at 6pm?**
Not done? Done but not clicked? Covered by someone else? Slow afternoon?

The owner overrode that, and the word used was *"also"* — the box keeps saying what the hour is
**for**, and gains ticking on top. That is their call to make, and it is a defensible one: an
opening and closing routine that nobody can confirm is a routine that quietly stops happening.

What follows is not a retreat from the original concern. It is the set of design choices that
answer it, so the feature does the useful thing without becoming the harmful one.

### What makes it a checklist and not a log

**Every day starts clean.** Ticks are keyed `(employee, local date, duty item)`. There is no
carry-over, no streak, no "you missed Tuesday". The unit of the thing is one shift.

**The date is the *local* date.** A shift ending at 6pm in New York is already tomorrow in UTC;
keying on UTC would clear the closing checklist halfway through the close.

**A rolling 14-day retention window**, enforced on read (`DUTY_CHECK_DAYS`). The two questions
this data can honestly answer are *"what is still outstanding right now"* and *"did the opening
actually get done today"*, asked by the person closing. Neither needs last March. Keeping it
forever converts a working tool into a permanent performance record that nobody asked for and
everybody would eventually be judged by — and that is the version of this feature the original
objection was really about.

**Admin sees a count, never a name.** `GET /floor/coverage` aggregates across everyone holding
the role: *9 of 14 ticked, the 6pm close is 0 of 5*. The shop's real question is "did the close
get done". Answering it by person turns a checklist into a scoreboard, and a scoreboard gets
gamed — people tick first and work second. **This is the load-bearing one**; if a later change
adds a per-person admin view, it has undone the mitigation, not extended the feature.

**Nothing becomes "missed".** An unticked duty at midnight simply stops existing as a question.
Manufacturing a `missed` state for duties would recreate the exact problem — a permanent record
of a box someone did not click — and is precisely the difference between a duty and a bounty.

**Ticks are for you, and you can untick.** Unticking is a real undo of the same row, not a second
row and not an audit entry.

### Why duties became rows

`duty_blocks.duties` was a JSON string array. Once something references an individual duty, an
index into that array is not an identity: reorder or delete a line and yesterday's tick lands on
a different duty. So `duty_items` is a table with real ids, and the checks carry a foreign key.

Editing reconciles **by text**: reordering the lines keeps the ticks attached, and rewording a
line produces a new duty with a clean tick — because an edited duty *is* a different duty.

**Rejected:** keying checks by `(block, index)`; keying by a hash of the duty text; a `missed`
state for duties; per-person completion visible to admin; indefinite retention.

---

## 5. Day resolution

Three rules, applied in order, for a given weekday `W`:

1. `W` is in the schedule's `closedDays` → closed. No duties, and the UI says so.
2. Any `duty_blocks` row has `dayKey === W` → **those blocks are the day, entirely.**
3. Otherwise → the `dayKey === 'default'` blocks.

**Whole-day override, not per-hour merge.** If Saturday defines its own blocks, Saturday is
authored on its own; default blocks do not leak into it. A per-hour merge is more flexible and
much harder to reason about — an admin who overrides Saturday 10am and then wonders why the
default 2pm still appears has hit a rule nobody can hold in their head. Standing duties are
unaffected by the override; they are standing.

The cost is real: overriding one hour of Saturday means authoring the rest of Saturday. The UI
mitigates it by seeding a new override from a copy of the default day, so the admin edits rather
than starts blank.

**Rejected:** per-hour override with a merge; a `duty_days` join table (three rules do not need
a table).

---

## 6. Bounties

**Period keys** are derived, never stored as free text: `2026-W31` (ISO 8601 week — the week
containing the first Thursday, so a 1 January can legitimately belong to the prior year),
`2026-08`, `2026-Q3`. Deriving them means "which week is this" has exactly one answer.

**Rollover.** When the current period key differs from an open instance's key, that instance is
marked `missed` and a fresh `open` one is created. Instances are never deleted and a missed one
is never rewritten — **the miss is the record.** A quarterly bounty that silently vanishes at
quarter end is the failure mode this exists to prevent.

**Claiming is a soft lock.** One claimant at a time; claiming a claimed instance is refused.
Two people deep-cleaning the same shelf is precisely the waste bounties are meant to avoid.
Claims can be released, and releasing returns the instance to `open` with no penalty recorded.
A claim that runs into the end of its period also drops its claimant when the instance is marked
`missed` — **a claim is not a commitment**, and a system that permanently records "Maya claimed
this and didn't finish" teaches people not to claim, which costs you exactly the coordination
the lock exists to provide. The miss is recorded against the bounty, not against a person.

**Size is a required field.** "Whenever they have extra time" only works if someone with twenty
minutes can tell which bounties fit in twenty minutes. The employee view sorts and filters by it.

**Role scope.** Empty `roles` means anyone. A non-empty list restricts it. Front desk gets most
of the seeded ones; a few are open to the floor.

**"Bounty" is a name, not a reward.** No points, no ledger, no balance, no leaderboard. Completing
one is visible — that is the whole of it. A reward system means a per-person ledger, rules about
what resets when, and an approval step before a claim counts; none of that is built, and none of
it should be inferred from the word.

---

## 7. Time is injected, never read from the clock

Every read that depends on "now" goes through `_now()`, which tests replace. Reading
`new Date()` inside the resolution logic would make the current-hour tests pass at 2pm and fail
at midnight, and the bounty rollover tests pass for eleven weeks out of twelve.

The seed is stamped in 2026 to match the existing schedule labels, which `parseWhen` already
assumes.

---

## 8. Information architecture

This feature is **the app's second job**, and that is worth saying out loud. Everything already
here is onboarding: finite, sequenced, ends around Day 30. Hourly duties apply to someone in
their third year and never end.

**Employee nav** gains a third header, **Floor**, holding **Today**. Onboarding · Reference ·
Floor. Putting Today under "Onboarding" would be a lie about what it is.

**Admin nav** gains **Floor ops** after Resources: the schedule editor and the bounty manager.

The Today screen leads with the current hour, because that is the question being asked. Standing
duties sit above it, the next hour below it, and the bounties that fit the remaining time sit at
the bottom. Outside open hours it says the shop is closed rather than showing an empty grid.

**Roles without a schedule get a real empty state**, not a blank screen — the signed-in demo
user is an Assistant Stylist, and pretending otherwise would hide the case that matters.

---

## 9. The control question, again

`RESOURCES-SCOPE.md` §8 flagged that detailed operational direction to a worker classified as an
independent contractor can be cited as evidence of *control* in a misclassification analysis.
An hour-by-hour duty schedule is close to the strongest possible version of that evidence — it is
the control test almost verbatim.

For W-2 front desk staff this is ordinary, sensible management and there is nothing to worry
about. If a schedule were ever pointed at barbers engaged as 1099 contractors, the schedule
itself becomes the exhibit.

The product does not and cannot decide this. What it does: schedules are attached to **roles**,
so who has one is an explicit, visible choice rather than something that quietly spreads to
everyone. The seeded schedules cover the two W-2-shaped roles. That is the whole of the
mitigation, and it is deliberately not a disclaimer.

---

## 10. Phasing

**Prototype (this change)** — nav entries, the Today screen with live current-hour resolution,
two seeded role schedules, standing/hour-specific split, closed days and one weekday override,
the daily checklist with per-duty ticks and role-level coverage, a bounty board with
claim/release/complete, period rollover with miss marking, and an admin editor for all of it.

**v1 backend** — server-derived roles and identity, real timezone handling (the prototype uses
the browser's local time), an audit log on schedule edits, retention enforced by a scheduled job
rather than on read, and bounty instance generation likewise.

**Later** — per-person deviations from a role schedule, shift assignment so the box knows who is
actually working and whose checklist it is, bounty recurrence beyond the three periods, and photo
proof on bounty completion.

**Deliberately not on any list:** per-person checklist history visible to an admin, and retention
beyond the rolling window. Both are §4's mitigations, not missing features.

---

## 11. What is seeded

| Schedule | Shape it tests |
| --- | --- |
| Front Desk Concierge | The rich case: full open-hours day, six standing duties, a Saturday override, Monday closed. |
| Assistant Stylist | The light case: proves resolution is per-role and not hardcoded to one schedule. |

Bounties span all three periods, sizes from 20 to 120 minutes, and both role-scoped and
open-to-anyone, so the filtering and the rollover logic have something real to act on.

**Only historical instances are seeded** — three done, two missed, across a past week, month and
quarter. The current period's instances are created on first read, so the seed never has to
guess what week it is, and the seeded rows stay stable ids with stable period keys that the
integrity tests can assert against. It is also what a real system looks like on any given
morning: a record behind you, an open board in front of you.
