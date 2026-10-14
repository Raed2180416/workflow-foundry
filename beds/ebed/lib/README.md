# E-bed oracle-side libraries (`beds/ebed/lib/`)

E-BED §8.1 step 3: the exact, boring building blocks that E-bed item oracles (`beds/ebed/<item>/transition.mjs`,
`oracle.mjs`) are built from. Pure functions, integer milliseconds and integer minor units, no wall clock, no
randomness, no dependency beyond Node 24 and `beds/lib/canonical.mjs` (`beds/lib/rng.mjs` in tests).

**Status (2026-10-14): built and adversarially reviewed; the step-3 gate is half met.** The gate in E-BED §8.1 is "unit
tests; differential vs step 1 cards on golden suites". The unit-test half passes (63 tests); the differential half
against the P58-P60 cards is not done (see "Not done here"). Review dispositions are at the end of this file.

**Independence.** Written in a session that did not read the library cards `experiments/library/cards/P58*`, `P59*`,
`P60*` (or `FROZEN-P58-P60.json`) and shares no code with them (E-BED §2.4, BED-CONTRACT v1.1 §1). Semantics come from
the public sources listed below and from E-BED / BAR-SET / BED-CONTRACT text. The host (`beds/ebed/host/`) is not
imported either: the oracle must not depend on the code it grades.

## Modules

| file | gap / pattern | what | main exports | refusal codes |
|---|---|---|---|---|
| `time.mjs` | G16 | instants (ISO with offset in, epoch ms inside), civil dates, a pinned time-zone rule table (35 zones, US/EU/AU/NZ DST rules, valid for local dates 2020-01-01 .. 2037-12-31; UTC and `UTC±HH:MM` 1900-2199), local-time disambiguation | `toMs`, `formatInstant`, `offsetAt`, `fromLocal`, `wallStart`, `localParts`, `dayBounds`, `laterOf`, `transitionsOf` | `TIME_INVALID`, `DATE_INVALID`, `TZ_UNKNOWN`, `TZ_RANGE`, `TZ_GAP`, `TZ_AMBIGUOUS` |
| `calendar.mjs` | G16 | business calendars: weekly hours, whole-day and partial holidays, business days, business time, roll conventions, time-zone binding by precedence | `calendar`, `isBusinessDay`, `addBusinessDays`, `businessDaysBetween`, `rollDate`, `businessMs`, `addBusinessMs`, `businessIntervals`, `bindTimeZone` | `CAL_INVALID`, `CAL_NO_BUSINESS_TIME`, `TZ_UNBOUND` |
| `editions.mjs` | G18 | effective-dated editions chosen by anchor date; optional knowledge time (`published`, `asOf`) | `selectEdition`, `checkEditions` | `EDITION_UNRESOLVED`, `EDITION_INVALID` |
| `dtable.mjs` | G17 (P58-like) | DMN 1.3 decision tables: all seven hit policies and four aggregations, S-FEEL unary tests, typed inputs, input/output values, defaults, an exact static checker (gaps, overlaps, ANY conflicts, priority ties, shadowed rules), precedence levels, CSV tables | `decide`, `evaluate`, `checkTable`, `firstLevel`, `compileTable`, `parseUnaryTests`, `tableFromCsv` | `HIT_POLICY`, `DT_SYNTAX`, `DT_TYPE`, `DT_DOMAIN`, `DT_OUTPUT_VALUE`, `DT_INVALID`; checker `TABLE_GAP`, `TABLE_OVERLAP`, `TABLE_SHADOWED`, `TABLE_TOO_LARGE` |
| `clock.mjs` | G15 (P60-like) | obligation clock: start / pause / resume / stop / reset / cancel; wall or business-time targets; due instant, warnings, inclusive or exclusive breach, monotone across cancel and reset (generations); day-count deadlines | `clockAt`, `defineClock`, `dueByDays` | `CLOCK_INVALID`, `CLOCK_ILLEGAL`, `CLOCK_ORDER` |
| `saga.mjs` | P59-like | saga planner: query unknown outcomes, continue, retry forward past a pivot, or compensate committed units (items included) in reverse commit order, a batch's items as one unordered group; deterministic idempotency keys; the failure-point table; plans as logical effects | `planSaga`, `failurePoints`, `sagaKey`, `compensationEffects`, `stepStates` | `SAGA_INVALID`, `SAGA_INPUT` |
| `ledger.mjs` | §2.8 layers 2-3 | allowed-window effect matching with the contract's divergence codes; key and multiplicity invariants; conservation identities; X12 835 balancing | `matchEffects`, `allowedWindow`, `keyViolations`, `atMostOnce`, `exactlyOnce`, `identity`, `identityByGroup`, `netsToZero`, `doubleEntry`, `balance835` | `LEDGER_INVALID`, `LEDGER_ORDER`; divergences `outside-allowed`, `duplicate`, `early`, `missed`, `order`, `key-split`, `key-reuse`; critical `duplicate-money` |
| `errors.mjs` | | `EbedLibError` with `code`; `freezeDeep`; `codeOf` (tests) | | |
| `index.mjs` | | re-exports everything | | |

Every refusal is thrown as `EbedLibError` with a code; nothing falls back silently. Calendars and decision tables are
memoised by object identity and **deep-frozen on first use**, so mutating one afterwards throws instead of returning
stale results. The caller's own object is frozen (for example a calendar inside world JSON): pass a copy if it must stay
mutable.

## Readings (decisions a spec left open; each is pinned by a test)

**Time and calendars**
- Zones come from a pinned rule table, not ICU: oracles must be byte-identical across machines and tzdata releases. A
  test compares all 35 zones with Intl at every 2020-2037 transition (±1 ms, ±1 h) and 40 instants a year (29,340
  offsets, all equal under Node 24.21 / tzdata 2026c). The range is by **local date**: every instant whose wall-clock
  date in the zone lies in 2020-01-01 .. 2037-12-31, both edge days in full (their 24:00 end included); anything else
  is `TZ_RANGE`. Zones outside the table (for example Mexico, or Brazil's historical DST) must be added with their
  rules and the Intl differential before an item uses them.
- Point times use Temporal-style `compatible` disambiguation (gap → later, fold → earlier). Interval endpoints use
  `wallStart`, "the first instant the wall clock reads at least t": a spring-forward day loses the skipped hour; an
  interval spanning a fall-back fold keeps the repeated hour once; an interval lying wholly inside a gap is empty.
  Consequence on fold days: hours [01:30, 03:00) on the New York fall-back Sunday hold 150 minutes (01:30 EDT to
  03:00 EST, the second 01:00-01:30 included), not the 120 a count of minutes whose wall clock reads 01:30-02:59 would
  give. E7 DST goldens must state that they use this reading.
- Business day = a date with non-zero business time after holiday closures (a half day still counts; a day whose
  hours lie wholly inside a DST gap does not).
  `addBusinessDays(d, n)` is the n-th business day strictly after d (d never counts; n = 0 returns d);
  `businessDaysBetween(a, b)` counts (a, b].
- `addBusinessMs(t, x)` is the earliest u with businessMs(t, u) = x, so budgets that run out at a close land on the
  close, not on the next opening.

**Decision tables (DMN 1.3)** — R1-R8 in the `dtable.mjs` header:
- R1 `'-'` does not match null (§10.3.2.10, grammar rule 15.c, p. 115: "e != null", or "FEEL(e in (v))" when the input
  has input values v, which is implemented, so a nullable input whose input values list `null` does match `'-'` with
  null). Option `dashMatchesNull` gives the reading of the notation passages (§8.1 p. 66, §8.2.7 p. 71, §9 p. 86: `'-'`
  is satisfied by every value), which are more numerous; §10.3.2.10 is the default because it is the execution
  semantics and the only passage that addresses null. Null inputs are refused unless the input is declared
  `nullable`, so the reading only matters for tables that opt in; an item spec with a nullable input must state it. A
  non-null input outside its input values is refused (`DT_DOMAIN`), stricter than 15.c (which only makes `'-'`
  unsatisfied): in a bed it is a generator or world bug.
- R2 no hit returns the default output, else null, for every hit policy (§10.3.2.10 step 2), including C+ / C# / R / O / C.
- R3 C# counts outputs, not distinct outputs (§8.2.10 d).
- R4 COLLECT returns rule order (one admissible "arbitrary order"); compare COLLECT lists as multisets.
- R5 PRIORITY and OUTPUT ORDER compare outputs that have output values, left to right. PRIORITY with a tie at the top
  between different outputs throws `HIT_POLICY` (undefined result, as R8) and is a checker error; OUTPUT ORDER lists
  tied rules in rule order (compare a tied run as a multiset) and reports the tie as a checker warning.
- R6 OUTPUT ORDER over compound outputs is allowed (§8.2.10 and Figure 8-19), although §10.3.2.10 3.a says "SHALL be
  single output": **a contradiction inside DMN 1.3**, resolved for §8.2.10.
- R7 C+ is exact integer arithmetic (minor units); non-integer sums are refused rather than summed in binary floating
  point. C< / C> take numbers, or dates for date outputs.
- R8 UNIQUE with several hits and ANY with unequal outputs throw `HIT_POLICY` (the spec calls the result undefined).
- S-FEEL only: literal endpoints, no names or arithmetic; strings and booleans compare for equality only (§9 p. 86).
  The spec's interval text has a typo ("(e1..e2) iff o > e1 and o < e1", p. 86); the obvious `o < e2` is implemented.
- The checker is exact for this subset: each input's domain splits into finitely many cells on which every test is
  constant (integers and dates use the witnesses ⌈b⌉−1, b, ⌊b⌋+1 for every boundary b), and the search prunes branches
  where no rule can still match.

**Obligation clock**
- The due instant D is the earliest instant at which active time reaches the target; while running it is projected
  with no further pause; while paused it is null unless already reached.
- A stopped clock's outcome compares the stop instant with D (`inclusive`: met iff stop ≤ D; `exclusive`: stop < D). So a
  ticket stopped at 18:00 against D = 17:00 is breached although no business time passed after 17:00.
- `reset` closes the current generation and starts a new one (elapsed and pause totals from zero at the reset
  instant, state running). `stop` and `cancel` are terminal. Illegal transitions throw `CLOCK_ILLEGAL` (or are listed
  as anomalies with `onIllegal: 'skip'`); histories must be in time order (`CLOCK_ORDER`), retroactive operations being
  ordinary operations with an earlier `at`.
- **Breach is monotone** (BED-CONTRACT v1.1 §5.3): stop, cancel and reset each close a generation at their instant e,
  judged as a stop is (breached iff e > D, or e ≥ D when exclusive). `breached` and `breachedAt` cover every
  generation, so cancelling or resetting an SLA after D does not erase the breach, and for a fixed history `breached`
  is true exactly from `breachedAt` on. Warnings reached before a cancel stay reached; closed generations are kept
  in `generations`. `outcome`, `dueAt`, `warnings` and the totals describe the current generation (a cancelled clock
  has outcome `cancelled` and may be `breached`).
- Day-count deadlines (`dueByDays`) are not running clocks: n business or calendar days after the anchor's **local
  date in the calendar's zone**, optional roll for calendar days, due at the last millisecond of that local day
  (any instant on the due date is on time) or at a given local time. Pausing a day-count deadline is not expressible
  (refused by construction).

**Saga planner**
- Compensation set = committed units as observed by status query (MR11, E-BED Errata 17): `unknown` + `committed`
  is compensated; `unknown` with no answer or `pending` blocks with `query-status`; `unknown` + `not-found` is not
  applied and may be re-issued under the same key.
- Order = reverse commit order: reverse `seq` when every committed unit has one (parallel branches), else reverse step
  order; mixing is refused. Compensations form **groups**: units of one step adjacent in that order are one group with
  no internal order (a batch's items committed in no known order; without `seq`, JavaScript key order is not commit
  order), and each compensation is `after` every compensation of the previous group. Different steps are never
  grouped, so steps, parallel branches with `seq` included, keep strict reverse commit order (E8: "reverse order of
  committed steps").
- A pivot observed per item and partially committed has no plan under failure or abort (`SAGA_INPUT`, "partially
  committed"): a pivot commits as one unit.
- Pivot / retriable steps follow the saga literature: failure after a committed pivot retries forward; an abort after
  it is refused. An explicit `abort` (customer cancel, lost timer race, timeout policy) compensates without a failed
  step. Steps declared with `undo: null` are reported in `skipped`, never invented.
- Keys: `sagaKey(saga, step, item, 'do' | 'undo')`, every part percent-encoded, so distinct logical effects get
  distinct keys (the phase restriction was added after the injectivity test found `('a','b','c','do')` and
  `('a','b',null,'c:do')` colliding). A part that is not well-formed Unicode (a lone surrogate) is `SAGA_INVALID`.

**Ledger**
- Windows are inclusive at both ends. A commit before `earliest` is `early`; no commit by `latest` is `missed`
  (reported at `latest`, the late commit kept as detail); a window still open at the grading instant `end` is `open`
  (not graded). Withdrawn lids (the rulebook no longer requires them) are not failures; effects after withdrawal are
  `outside-allowed`. Keys are per system; `key-split` and `key-reuse` are checked over attempts, committed or not.
- Row-to-lid assignment when several lids match: the lid that already used the row's key, else an unsatisfied lid
  whose window contains the row, else any unsatisfied lid, else a satisfied one (a duplicate); each choice by earliest
  deadline (window latest, then earliest, then lid id). The verdict does not depend on the order lids are listed.
- 835 balancing: service line SVC02 − ΣCAS = SVC03; claim CLP03 − ΣCAS(claim) − ΣCAS(lines) = CLP04; transaction
  ΣCLP04 − ΣPLB = BPR02 (PLB positive reduces the payment); and ΣSVC02 = CLP03 when lines are present (a validator rule,
  on by default, `requireLineChargeSum: false` to drop it). All amounts are safe integers of cents; sums use BigInt.

## Sources (read as data; nothing copied beyond restated rules)

| source | URL | sha256 (retrieved 2026-10-14) | licence | used for |
|---|---|---|---|---|
| OMG DMN 1.3 (formal/21-01-01) | https://www.omg.org/spec/DMN/1.3/PDF | `b591d2417e8320d71cb988c6741fe590a1a85629bf317bc0857ea803bf4bf6a6` | OMG specification; copyright OMG, read for semantics, not redistributed | §8.2.10, §8.2.11, §9 rules 5-12 and p. 86, §10.3.2.10; Figures 8-19, 11-15, 11-17 transcribed as fixtures |
| X12 RFI 2601 (quotes TR3 005010X221 §1.10.2.1.1-2) | https://x12.org/resources/requests-for-interpretation/rfi-2601-claim-line-balancing-relationship-charged-allowed | `387bea2ad3b680d395ebc8c19552a2ecb1859be5f1adb0548d711f9a13426b9e` (HTML) | X12 copyright; identities restated | line and claim balancing |
| BCBSOK PLB segment guide (2018) | https://www.bcbsok.com/docs/provider/ok/claims/ec/ok-pl-segment-835era-2018.pdf | `2588f11f6d1fcd0f54d94a070283caa1975df020118310d9363c835e93a20e82` | payer document; identity restated | transaction balancing, PLB sign |
| IBM APAR PH17298 | https://www.ibm.com/support/pages/apar/PH17298 | `3356c095cf448acc5a7d6f4e8b09682f32c37054373efd0e4a22473dd35ae65d` (HTML) | IBM support page; rule restated | ΣSVC02 = CLP03 |

DST rules: US Energy Policy Act of 2005 (from 2007), EU Directive 2000/84/EC, NSW/VIC/ACT/TAS and NZ rules (from 2007/08),
stated from general knowledge and then checked against the Intl tzdata differential above. Downloads were kept in the
session scratchpad, outside the repository.

## Tests

`node --test --test-concurrency=2 beds/ebed/lib/*.test.mjs` — 63 tests, about 2 s, $0.

| file | tests | what |
|---|---|---|
| `calendar.test.mjs` | 11 | hand-derived dates, transitions, gaps and folds, Thanksgiving / half-day business time, rolls, editions (nested overlaps); the first and last supported days; Intl differential (29,340 offsets) |
| `dtable.test.mjs` | 12 | DMN Figures 8-19, 11-15, 11-17 under every hit policy; R1-R8; S-FEEL grammar and refusals; checker witnesses; precedence levels; CSV |
| `clock.test.mjs` | 7 | hand timelines: warnings, inclusive/exclusive breach, pause across a holiday and a half day, reset, cancel, breach kept across cancel and reset, DST wall clocks, day-count deadlines |
| `saga.test.mjs` | 9 | the 20-row failure-point table of reserve → charge → ship → notify, partial batches as unordered groups, parallel seq order, pivots (partial pivot refused), key injectivity, grading through the ledger |
| `ledger.test.mjs` | 8 | every divergence code on its own trajectory, assignment independent of list order, window and withdrawal boundaries, keys and multiplicity, identities, 835 on a hand-built remittance |
| `property.test.mjs` | 15 | seeded (dev 1001-1199) comparison with naive models: minute-stepping business time and clocks over random calendars in 8 zones, additivity, inverse and minimality, MR3, MR8, clock laws (business ≤ actual, pause monotonicity, breach monotone in the pause set and in query time across stop, cancel and reset), DMN hit policies and the checker against direct evaluation on full input grids, rule-order invariance (Note 2), saga plans against a set/order model, single-mistake ledger mutations (swaps across and inside compensation groups, listing order), 835 single-amount perturbations, cross-process determinism |
| `mutants.test.mjs` | 1 | the mutation list still applies |

**Mutation check** (E-BED §9.5): `node beds/ebed/lib/mutants.mjs --jobs 2` applies 86 mutants (relational boundaries,
rule and calendar swaps, disambiguation swaps, hit-policy and precedence swaps, anchor swaps, deleted guards, deleted
pause conditions, compensation order reversals, missing key parts, sign swaps; since the review also each review fix
undone, F1-F16, and the reviewer's seven surviving mutants, R1-R5 and R12, with F3 for the cancel case) to a temporary
copy and runs the suites. Last run (2026-10-14, after the review fixes): **86 mutants, 86 killed, score 1.000** (about
2 minutes at 2 jobs). History: the builder's first run scored 63/64 (survivor K6, anchor date taken in UTC instead of
the calendar's zone, got a golden); the builder's 64/64 overstated discrimination, since 7 of the reviewer's 14 extra
mutants survived it (review item 8). Four equivalent mutants are documented in `mutants.mjs`.

## Not done here

- **Differential test against the P58-P60 cards** (E-BED §8.1 step 3 gate "differential vs step 1 cards on golden
  suites"): it needs the cards' APIs, and this session was not allowed to read them. A separate session that may read
  both should wire the fixtures in `fixtures.mjs` (and `failurePoints`, the clock goldens) through the cards.
- Item semantics: nothing here knows D365 tolerances, Reg E clocks or network-X rules; items compose these libraries.
- Full FEEL (names, arithmetic, functions, decimals), ServiceNow-style condition-driven SLA attachment, and time zones
  outside the table are refused, not approximated.
- Open readings left to item specs: whether independent parallel branches may compensate in any order (here: strict
  reverse commit order of steps); `'-'` against null for nullable inputs (here: §10.3.2.10); whether an effect after
  a withdrawal but before the deadline is a failure (here: `outside-allowed`); fold-day business time (here: the
  `wallStart` reading, 150 minutes in the example above).

## Review of 2026-10-14 (adversarial review of `bc5c976`)

Every finding was checked by re-running the reviewer's probe scripts against `bc5c976`; all reproduced. The DMN
citations were checked against the PDF text (sha256 above). The new regression tests were run against the `bc5c976`
library code: 17 of the 63 tests fail there, and all pass on the fixed code. 2 P1 and 9 P2 findings, no P0.

| # | sev | finding | disposition |
|---|---|---|---|
| 1 | P1 | Saga: one step's items were chained in `Object.keys` order, which is not commit order (`'2'` before `'10'`), so an arm releasing a partial batch (F4) in true reverse commit order was graded `order`. | **Fixed.** Compensations form groups (a batch is unordered; each compensation is `after` the whole previous group). Tests: `saga.test.mjs` "review P1" (the `'10'`/`'2'` probe, both release orders pass, refund-before-batch enforced, interleaved `seq`); property: groups and `after` sets against a model, swaps inside a group pass and across groups fail. Mutants F1, S7. |
| 1b | P1 (part) | The same total order is forced across `seq`-ordered parallel branches (hotel → car). | **Kept, documented (not a defect under the stated spec).** E8's rulebook says "compensate committed steps in reverse order" and `seq` is the observed commit order, so strict reverse order of steps is the specified reading. Letting independent branches compensate in any order needs the item spec to declare branch independence (for example a `branch` field); no item does yet. Pinned by a test. |
| 2 | P1 | Clock: a cancel or reset after the due instant erased the breach (`breached` true until the cancel, false after) and dropped warnings already reached. | **Fixed.** Stop, cancel and reset close a generation judged as a stop is; `breached` / `breachedAt` cover all generations; closed generations are kept in `generations`. Tests: `clock.test.mjs` "review P1" (the probe's timeline for cancel, reset and stop; inclusive and exclusive); property: breach monotone in query time over 80 random histories with pause, stop, cancel and reset. Mutants F3, F4, F5, K1, K3, K4. |
| 3 | P2 | Ledger verdict depended on the order lids are listed (first unsatisfied in list order). | **Fixed.** Key owner, then an unsatisfied lid whose window contains the row, then any unsatisfied lid, each by earliest deadline. Tests: the probe in both orders, a containing window beating an earlier deadline, listing-order shuffle in the property test. Mutants F6, F7. |
| 4 | P2 | `checkEditions` compared neighbours only: missed A–C, reported a false gap inside A. | **Fixed.** Sweep against every earlier edition and the furthest end seen. Test with the probe's editions. Mutants F8, F9. |
| 5 | P2 | 2020-01-01 and 2037-12-31 threw `TZ_RANGE` (padding day, year probed on a neighbouring instant, 24:00 end). | **Fixed.** No padding day (scan the local days of `a` and `b - 1`); the range is by local date; rules are evaluated with the wall year (no rule has a transition near 1 January); 24:00 of 2037-12-31 is computable. Tests for five zones on both edge days and for the refusals just outside. Mutants F10, F11, F12. The Intl differential is unchanged (29,340 offsets equal). |
| 6 | P2 | R1 cited §10.3.2.9 (that is "Relations between types"); rule 15.c with input values not implemented; out-of-domain inputs throw; default reading is the minority one. | **Citations fixed** (§10.3.2.10, in code, tests and README). **15.c implemented** (`'-'` with input values v is `e in (v)`; evaluation and checker); test, mutant F14. **`DT_DOMAIN` kept** on purpose: stricter than 15.c, an out-of-domain input in a bed is a generator or world bug (R1 says so). **Default kept**: §10.3.2.10 is the execution semantics and the only passage on null; nullable inputs are opt-in, and the item spec must state its reading (listed under "Not done here"); a per-table declaration is deferred until an item has a nullable input. |
| 7 | P2 | PRIORITY ties between different outputs were resolved by rule order (permuting rules changed the result). | **Fixed.** A tie at the top between different outputs throws `HIT_POLICY` (as R8) and is a checker error; OUTPUT ORDER ties stay a warning (rule order inside the tie, compare as a multiset). Tests in R5. Mutants F15, F16. |
| 8 | P2 | Tests discriminated less than "64 of 64": 7 behaviour-changing reviewer mutants survived; the property grid (-7..17) was narrower than the literals (up to 23). | **Fixed.** A golden for each survivor (number midpoint witness, key-based assignment, permitted window, both withdrawal boundaries, warning-reached boundary, warnings kept on cancel); all seven are in `mutants.mjs` now (R1-R5, R12; the cancel case is F3). Grid widened to -7..25. |
| 9 | P2 | End-of-day deadline was 23:59:59.000, so 23:59:59.500 on the due date was late. | **Fixed.** The last millisecond of the local day. Goldens updated; test with 23:59:59.5. Mutant K5. |
| 10 | P2 | The report said step 3 was done; the gate's differential half is not. | **Fixed.** Status line at the top of this file: built and reviewed, gate half met. |
| 11a | P2 | A date whose only hours lie inside a DST gap counted as a business day with 0 business time. | **Fixed.** `isBusinessDay` requires non-zero business time, as the stated definition says. Test; mutant F13. |
| 11b | P2 | Fold day: [01:30, 03:00) counts 150 minutes, not 120 by wall-clock minutes. | **Kept, documented.** It is the stated `wallStart` reading; now spelled out with the numbers, and E7 goldens must state the reading. Test pins 150. |
| 11c | P2 | A partially committed pivot gave a misleading "committed before an earlier failure" error. | **Fixed.** `SAGA_INPUT` "pivot ... is partially committed" under failure or abort; forward continuation still allowed. Test; mutant F2. |
| 11d | P2 | `sagaKey` threw a plain `URIError` on a lone surrogate. | **Fixed.** `SAGA_INVALID`. Test. |
| 11e | P2 | `calendar()` and `compileTable()` deep-freeze the caller's objects (for example world JSON). | **Kept by design, documented.** Freezing is what makes the identity memo safe (a later mutation throws instead of returning a stale result, the defect the builder fixed); not freezing would need content-keyed memoisation on every call. The module table note now says to pass a copy if the object must stay mutable. |
| 11f | P2 | A correction edition with the same effective range and a later publication date cannot be expressed. | **Deferred.** Choosing by publication date is "latest wins", which G18 forbids unless declared; the clean form is an explicit `supersedes: <id>` on the correction, to add when an item has corrections. |
| 11g | P2 | The checker does not report entries partly outside the input values (§8.2.7 "SHOULD be reported"). | **Deferred.** The spec's own Figure 11-17 has `>=50` on Age `[18..120]`, partly outside, so a warning would flag the spec's example (our `checkTable(APPLICATION_RISK_SCORE)` golden is `[]`); entries wholly outside are already `TABLE_SHADOWED`. Could be added later as an info-level issue. |
