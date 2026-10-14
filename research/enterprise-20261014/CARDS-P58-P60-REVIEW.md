# Cards P58–P60: adversarial review of v1 and what was done about it

E-BED §8.1 step 1, part "cards-blind". Date: 2026-10-14. Cost: $0, no model calls.

**Blind sessions must not read this file.** It quotes the bar set and reports how the oracle-side libraries read the
same cases. That is why it sits under `research/enterprise-20261014/`, which `cards/FROZEN-P58-P60.json` already lists as
not read by card authors.

## What was reviewed and who changed what

- **v1.** The cards P58 (decision table), P59 (saga planner) and P60 (SLA clock), authored blind and frozen in commit
  `26f4f7b` (`experiments/library/cards/FROZEN-P58-P60.json`, schema `card-freeze/1`).
- **The review.** An adversarial review found no P0, 4 P1 and 10 P2. The reviewer's probe and mutant scripts were
  scratch files and are not in the repository.
- **Amendment A1.** It changes `P59/card.json`, `P59/skeleton.mjs`, `P60/card.json` and `P60/skeleton.mjs`. P59 and P60
  are now v2. P58 stays the blind v1. Every fixture is byte-identical to v1. The freeze file is now schema `card-freeze/2`,
  with `history[]` for the v1 digests, `amendments[]` for A1 and a `blindAddendum`.
- **What the amending session saw.** It is not blind:
  - It read the review, which quotes BAR-SET's G18 definition. The review names E5, E7, E8 (with its fraud-check step
    and at-least-once delivery), E11 and E12, BAR-SET §3 precedence levels and the G17 codes, and it reports the
    oracle-side readings described under R4 below.
  - It grepped E-BED.md for its freeze rules. That printed lines 466, 568, 687, 755, 757, 759, 908 and 957: the step
    table, the rule "spec-E is written only after the P58–P60 cards are frozen", and one-line item outlines.
  - It read `beds/ebed/lib/README.md` lines 125–145, the mutation check and the "Not done here" list.
  - It read no item specification and no oracle source (`beds/ebed/lib/*.mjs`).
- **What A1 is based on.** Both changes fix internal-consistency defects, argued from the cards' own contracts. A1 adds
  nothing from the bar. The coverage gaps in finding 8 were left alone on purpose.
- **Timing.** No spec-E existed when A1 was made, so the order "cards frozen before any spec-E" still holds for v2.

## Disposition at a glance

| # | Sev | Finding (short) | Verified | Disposition |
|---|-----|-----------------|----------|-------------|
| R1 | P1 | P60 breach (business minutes) inconsistent with `dueAt` | yes | **fixed** in P60 v2; regression test and 3 mutants |
| R2 | P1 | P59 idempotency keys distinct only within one saga | yes | **fixed** in P59 v2; regression test and 2 mutants |
| R3 | P1 | fixtures and suite leave semantic mutants alive | yes | **fixed** in the test file: 52 mutants, all killed; the frozen fixtures alone still kill 26 of 52 (deviation, see below) |
| R4 | P1 | step-3 differential not run; the two sides already disagree | yes | **deferred** to the step-3 owner (cross-part); the card side of the 4 readings is pinned in a test and listed below |
| 5 | P2 | P58: float SUM, `not(<10)` on null, PRIORITY ties, misleading edition message, citation | yes (4 of 5; citation not checked) | deferred to a blind P58 v2 |
| 6 | P2 | P60 event-based pause under-counts in the worked example | yes | deferred (documentation and design question) |
| 7 | P2 | P60 DST fold and midnight-gap handling | yes | deferred to a P60 v3 |
| 8 | P2 | coverage gaps against the bar | yes (by absence) | accepted as measured gaps for L9; deliberately not patched |
| 9 | P2 | blindness disclosure incomplete; a weak "fraud-check" signal | yes | disclosure **fixed** (FROZEN `blindAddendum`); the signal cannot be settled and is recorded here |
| 10 | P2 | P59: one duplicate log entry deopts the whole batch | yes | deferred |
| 11 | P2 | P59: two invariants are tautological; a stuck undo blocks sibling undos under PARALLEL_UNDO | yes | deferred |
| 12 | P2 | rule tables ride in `schema` slots, so they are checked only at run time | yes | deferred (cross-part: assembler) |
| 13 | P2 | P60: one case past HORIZON_DAYS deopts the whole batch | yes | deferred |
| 14 | P2 | the freeze is checked only against a file in the same directory | yes | **fixed**: digests copied below and checked by the test; v1 blobs are also checked against git |

No finding was rejected outright. Finding 8 is not a defect of this part, and the reviewer says so too.

## P1 findings

### R1. P60 breach rule (fixed: P60 v2)

**The defect.** v1 set `breached = elapsed > target`, counting business minutes, while `dueAt` is the instant elapsed
reaches the target.

- Business time does not advance outside the windows. So a target that runs out at the end of a window is not breached
  until the next window opens.
- **Probe.** Start Wed 2026-10-14 15:00 BST with P1 = 120 minutes on a 09–17 Europe/London calendar. Then:
  - At 18:00, v1 gave `breached: false` with `dueAt` 16:00Z already past.
  - A stop at 18:00 gave `met: true`.
  - A stop at 08:59 the next morning was also `met: true`.
- **Effect.** A wake-up at `dueAt` (the envelope's timer, which is the card's own contract) could never observe the
  breach, and no output gave the breach instant.

**The fix.** `breached` is now true when the clock ran past `dueAt`, meaning AS_OF, the stop or the pause came strictly
after it (`P60/skeleton.mjs`, the `due` / `ranUntil` lines).

- Reaching the target exactly is still on time, as in v1.
- `remainingMinutes` stays in business minutes, so it reads 0 while breached outside business hours.

**Tests** (`experiments/library/test/ebed-cards.test.mjs`):
- `P60 v2 (review R1)`, with 9 hand-computed cases: at, one second after and an hour after `dueAt`; stop after it, stop
  the next morning, stop exactly at it; paused exactly at it, paused after it; resumed past it.
- Mutants `v2-breach-by-business-time` (which is the v1 rule), `v2-breach-inclusive` and `v2-breach-at-as-of`.
- All P60 fixtures are unchanged and still pass.

### R2. P59 key distinctness (fixed: P59 v2)

**The defect.** v1 checked `keys-distinct` within one saga only.

- **Probe.** `KEY = (sagaId, step, action) => step + ':' + action` over two sagas returned ok, with both
  `next[0].key = "reserve-stock:do"`.
- **Effect.** A keyed participant would treat the second saga's reserve as a replay of the first, and the effect would
  be lost.

**The fix.** v2 adds two checks, both reported under invariant `keys-distinct` with `detail.why` saying which one fired:
1. Keys must differ across every saga of the run.
2. A probe saga (the id plus the suffix `~probe`) must get keys of its own. This refuses a KEY that drops or truncates
   the saga id even in a run of one saga, which the cross-saga check alone cannot see.

The checklist line and the KEY slot doc were updated to match.

**Tests:**
- `P59 v2 (review R2)`, covering:
  - a KEY with no saga id, on one saga and on two;
  - a KEY that strips the number from the id: ok alone, refused with two sagas, and the detail names both sagas;
  - the worked KEY on two sagas.
- Mutants `v2-keys-probe-deleted` and `v2-keys-across-sagas-deleted`.

### R3. Semantic mutants (fixed in tests; one deviation)

**The mutant set.** The test `E-bed cards (review R3, E-BED §9.5)` applies 52 mutants to the current skeletons:
- the review's 48 semantic mutants, recovered from its scratch mutant directories, with P60's v1 breach mutant replaced
  by its 3 v2 forms;
- the 2 P59 v2 key mutants.

**What kills them.** Each mutant runs on the fixtures plus fixed "killer" cases. It must give a different status,
output or deopt on at least one case than the unmutated card. An identity mutant must survive, which shows the
comparison is sound. A mutant that no longer applies exactly once fails the test, so the list cannot rot silently.
New hand-computed boundary tests:
- P58: overSpeed exactly 30 and exactly 50 in the worked table; a FEEL table with `<=`, `<`, `>=`, `>`, closed and open
  interval ends at the bound, `!=` and `= null` on a null input, and the dash.
- P60: events given out of time order.

**Results** (test diagnostic):

| Card | Mutants | Killed | Killed by the frozen fixtures alone |
|------|---------|--------|-------------------------------------|
| P58 | 19 | 19 | 8 |
| P59 | 15 | 15 | 8 |
| P60 | 18 | 18 | 10 |

The fixture column matches the review's 26 of 48. None of the 5 v2 mutants is killed by the fixtures.

**Deviation from the wording of §9.5.** §9.5 says "fixtures kill their mutants". The kill set is the fixtures *plus* the
in-file cases, because the fixtures are frozen:
- P58 is still the blind v1, so changing its fixtures needs a blind session.
- For P59 and P60, A1 kept the fixtures byte-identical on purpose, so that the v1 expectations stay a blind record.

If the bar requires fixture-level kills, a blind session should add per-policy fixture variants (the fixtures' `slots`
override) and re-freeze.

### R4. Step-3 differential (deferred, cross-part)

**Why it is deferred.** The gate "differential vs step 1 cards on golden suites" (E-BED §8.1 step 3) belongs to the
oracle side (`beds/ebed/lib/README.md`, "Not done here"). It needs a session allowed to read both sides. This session
deliberately read no oracle source, so that A1 could not be shaped by it. The lib directory is another part's.

**What was done.** The card side of each of the four readings the review found apart is pinned by
`E-bed cards (review R4)`. Neither side should be admitted until the differential runs with these as named ledger rows:

| Reading | Card (pinned) | Oracle side, as the review reports it |
|---------|---------------|---------------------------------------|
| 1. Dash vs null | `-` matches a null input (as Drools / Kogito do) | default (R1, DMN §10.3.2.9) does not match null; P58 positive fixtures v3 and v4 come out null under it |
| 2. Compound OUTPUT_ORDER | refused (`invariant/table-well-formed`) | allowed (DMN 1.3 §8.2.10 Figure 8-19; Drools `sortPairs`) |
| 3. Unknown saga outcomes | an uncertain compensable failure is undone under `if-uncertain`; an uncertain pivot is retried under the same key; no status query | MR11: query the status first and block until it answers |
| 4. Breach boundary | exactly at `dueAt` is on time (exclusive); after A1, any instant past `dueAt` breaches | inclusive boundary |

Reading 4 narrowed with A1: the two sides now differ only on the instant `dueAt` itself. Reading 2 is a refusal rather
than a wrong answer, so the card is conservative there. The citation it gives is wrong, though (see finding 5).

## P2 findings

These are recorded and not fixed, except 9 (the disclosure part) and 14. Each was probed on the current cards.

5. **P58 smaller points.** Next blind P58 version.
   - SUM accepts floats: 0.1 + 0.2 gives `0.30000000000000004`, although the checklist says integer minor units.
   - `not(< 10)` matches a null input, where FEEL gives null.
   - A PRIORITY tie between different outputs is settled silently by rule order. Probe: two rules with equal `fee`
     priority and different `tier` returned rule `a`.
   - Editions listed out of order are refused with the misleading message "a overlaps b".
   - The "DMN 1.1 §10.3.4.6" attribution for refusing compound OUTPUT_ORDER is plausible but was not checked: this
     session read no spec copy.
   - None of these changes an answer on a well-formed integer table, so P58 stays the blind v1.
6. **P60 event-based pause.** With `status:open` in IGNORE_ON, as in the worked example, a ticket going
   waiting-customer → open stays paused (probe: elapsed held at 60). A pause event sorted before `created` at the same
   instant leaves the ticket running (probe: 420 minutes). Next version: document the card as "resume on condition",
   drop `status:open` from the example's IGNORE_ON, and decide on a state-based mode. The reading of S15 as state-based
   is an inference.
7. **P60 DST.**
   - In a fold, `toUtc` takes the later offset: a 01:00–02:00 window on Sun 2026-10-25 in London counts 60 minutes,
     where the wall time is 120.
   - A zone that changes at midnight loses an hour at the day end before the gap: America/Havana, 24×7 with 03-08 a
     holiday, from 03-07 00:00 to 03-10 00:00 local gave 2820, expected 2880.
   - Calendars of 08–18 and 09–17 are not affected. A P60 v3 should use "compatible" disambiguation (the earlier offset
     in a fold, shift forward in a gap) and say so in FROZEN `runtime`.
8. **Coverage gaps against the bar.**
   - P58 has no static gap or overlap check and no precedence levels (BAR-SET §3; G17 TABLE_GAP / TABLE_OVERLAP).
   - P59 has no abort or cancel trigger and no status query (E8).
   - P60 has no cancel, reset, retroactive start, priority retargeting or day-count deadlines (E5, E11 and E12 count
     business days).
   - Patching the cards from the bar would contaminate them, so these are recorded as measured gaps for L9. Their
     absence is the strongest evidence the v1 author was blind.
9. **Blindness disclosure.**
   - The PROOF-LEDGER lines 156–175 the v1 author saw also show claim rows L2 (line 165), L10 (173) and L12 (175). These
     name which items pilot first, which carry N-version oracles, and item sizes. Confirmed against `26f4f7b`.
   - Fixed by FROZEN `blindAddendum`, which the hashes do not cover, so v1's statement stands as written.
   - The weak signal: the P59 drift fixture's "fraud check before capture" matches the extra fraud-check step in the
     bar's E8 version. It may be a generic e-commerce coincidence. Git cannot settle it, because E-BED.md (28d401a, 13:53)
     predates the card files' first autosaves (14:13–14:19).
10. **P59 batch deopt on a duplicate entry.** A repeated `ok` or `undo-ok` fires `guard/log-consistent` and stops every
    saga in the batch (probe: one saga with a duplicate `ok`). At-least-once delivery will hit this. Next version:
    either dedupe exact duplicates before replay, or deopt locally (flow-v3 has local deopt).
11. **P59 invariants.**
    - `undo-covers-completed` and `undo-reverse-order` are computed from the same `order` they check, so the checklist's
      "enforcedBy" overstates them.
    - Under PARALLEL_UNDO, one exhausted undo marks the saga `stuck` and withholds the other ready undos (probe: three
      failed undos of book-courier gave `stuck` with `next: []`).
    - Next version: reword the checklist, and decide whether a stuck undo blocks its siblings. That is a policy choice.
12. **Rule tables in `schema` slots.** `checkSlot` only checks that a schema value is an object (`assemble.mjs:47`), so a
    malformed table shows up as `invariant/table-well-formed` at run time, not as a slot finding. A `data` slot type or
    a check pass over the slots belongs to the library or assembler (outside the engine freeze, but another part).
13. **P60 batch deopt past the horizon.** One case running longer than HORIZON_DAYS deopts every case (probe:
    `guard/within-horizon` for a ticket open since 2026-01-05 with HORIZON_DAYS 60). Next version: return a censored
    case or deopt locally.
14. **Freeze checked only against its own directory.** Fixed:
    - The current and superseded card digests are copied below.
    - The amendment test fails if any of them is missing here.
    - Where git history is present, the same test also hashes each v1 file at `26f4f7b` against `history[]`.
    - PROOF-LEDGER was not touched, because other sessions have uncommitted edits there. The PREREG should carry these
      digests when it is frozen.

## Card digests

The card digest is sha256 over the lines `<path> <file sha256>\n` of the card's files, in path order
(`FROZEN-P58-P60.json`, `digest`).

| Card | Version | State | Card sha256 |
|------|---------|-------|-------------|
| P58 | 1 | current (blind) | `414717d390705ed1f19d7d2631fb47d372a16fdd9db80c8d59975f92b116c7f7` |
| P59 | 2 | current (A1) | `5057a290d01bbfb1f98dab7adafbbab0c7f2b5169956250525737fee26643d21` |
| P60 | 2 | current (A1) | `c63b747a1f6302f1c65696a1d36d82058cfe69a2243d7fd5edbaf8968bcc8280` |
| P59 | 1 | superseded (blind, `26f4f7b`) | `d6d17693db16b91a185cf438265e80c1537824269ea69fcac0420474ea975f1a` |
| P60 | 1 | superseded (blind, `26f4f7b`) | `cd9b392339a9b0e4ce4eb24aa9b8f2a6526d530267b595bd3f9a2dc8de16e4d3` |

## Other notes

- **Catalog.** A1 changes no catalog field (name, family, tier, constructs and J1 are the same), and
  `tools/build-catalog.mjs` regenerates `catalog.json` byte-identically. The retrieval index lines of P58–P60 are
  unchanged too: the version text is among the parts dropped to fit the 30-token line.
- **Results computed earlier.** The review's point stands. Retrieval and the L2 harness see 57 entries since P58–P60
  were added at about 14:25. A result computed before that and compared after it needs a note. Any result that ran
  P59 or P60 before A1 used the v1 semantics.
- **Builder's open question 1 (G18).** BAR-SET.md:447 defines G18 as "edition chosen by anchor date, not run date". The
  cards' convention matches it. BAR-SET says nothing about gaps or announcement dates.
