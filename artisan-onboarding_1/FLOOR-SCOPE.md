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
| Completion | **None. The hour passes.** | Claimed → done, or missed |
| Assigned to | A role | Claimed by one person at a time |

A duty has no completion state because the hour *is* the state: at 3pm you are doing the 3pm
things, and at 4pm that question is moot. A bounty has completion state because "did the
quarterly deep-clean happen" is a question someone genuinely needs answered in November.

Collapsing them forces one of two bad outcomes: bounties lose their instancing and you cannot
tell a done bounty from a never-done one, or duties gain per-hour rows and the feature becomes a
time clock (§4).

---

## 2. Data model

| Table | Prefix | What it is |
| --- | --- | --- |
| `duty_schedules` | `sch_` | One per role. Owns the standing duties and the day rules. |
| `duty_standing` | `std_` | A duty true for the whole shift. Child of the schedule. |
| `duty_blocks` | `blk_` | An hour-specific duty. Carries `hour` and `dayKey`. |
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

## 4. The hourly box does not track completion

**Decision: reference only. No per-hour, per-person rows. There is no `duty_state` table.**

The stated goal was *"so they always know what to do every hour"* — that is about knowing, not
about proving. Adding a checkbox per hour changes what the feature is:

- It produces a per-employee minute-by-minute activity record, retained indefinitely and
  discoverable, which is a different product with different obligations.
- It creates a question with no good answer: **what does an unchecked 2pm mean at 6pm?** Not
  done? Done but not clicked? Covered by someone else? Slow afternoon, nothing to do? Every
  reading is wrong some of the time, and an admin looking at a wall of unchecked boxes learns
  nothing except that people stop clicking after week two.

This is the same call, for the same reasons, as the Resources decision not to keep per-employee
read receipts (`RESOURCES-SCOPE.md` §7). Bounties carry the completion state, because a bounty
is discrete, finite, and genuinely needs an answer.

Adding tracking later is a new table and a write path. Removing it later means deleting a
history someone has started relying on. Cheap in one direction only.

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
a bounty board with claim/release/complete, period rollover with miss marking, and an admin
editor for all of it.

**v1 backend** — server-derived roles and identity, real timezone handling (the prototype uses
the browser's local time), an audit log on schedule edits, and instance generation on a
scheduled job rather than lazily on read.

**Later** — per-person deviations from a role schedule, shift assignment so the box knows who is
actually working, bounty recurrence beyond the three periods, and photo proof on bounty
completion.

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
