# E-bed oracle-side libraries (`beds/ebed/lib/`)

E-BED §8.1 step 3: the exact, boring building blocks that E-bed item oracles (`beds/ebed/<item>/transition.mjs`,
`oracle.mjs`) are built from. Pure functions, integer milliseconds and integer minor units, no wall clock, no
randomness, no dependency beyond Node 24 and `beds/lib/canonical.mjs` (`beds/lib/rng.mjs` in tests).

**Independence.** Written in a session that did not read the library cards `experiments/library/cards/P58*`, `P59*`,
`P60*` (or `FROZEN-P58-P60.json`) and shares no code with them (E-BED §2.4, BED-CONTRACT v1.1 §1). Semantics come from
the public sources listed below and from E-BED / BAR-SET / BED-CONTRACT text. The host (`beds/ebed/host/`) is not
imported either: the oracle must not depend on the code it grades.

## Modules

| file | gap / pattern | what | main exports | refusal codes |
|---|---|---|---|---|
| `time.mjs` | G16 | instants (ISO with offset in, epoch ms inside), civil dates, a pinned time-zone rule table (35 zones, US/EU/AU/NZ DST rules, valid 2020-2037; UTC and `UTC±HH:MM` 1900-2199), local-time disambiguation | `toMs`, `formatInstant`, `offsetAt`, `fromLocal`, `wallStart`, `localParts`, `dayBounds`, `laterOf`, `transitionsOf` | `TIME_INVALID`, `DATE_INVALID`, `TZ_UNKNOWN`, `TZ_RANGE`, `TZ_GAP`, `TZ_AMBIGUOUS` |
| `calendar.mjs` | G16 | business calendars: weekly hours, whole-day and partial holidays, business days, business time, roll conventions, time-zone binding by precedence | `calendar`, `isBusinessDay`, `addBusinessDays`, `businessDaysBetween`, `rollDate`, `businessMs`, `addBusinessMs`, `businessIntervals`, `bindTimeZone` | `CAL_INVALID`, `CAL_NO_BUSINESS_TIME`, `TZ_UNBOUND` |
| `editions.mjs` | G18 | effective-dated editions chosen by anchor date; optional knowledge time (`published`, `asOf`) | `selectEdition`, `checkEditions` | `EDITION_UNRESOLVED`, `EDITION_INVALID` |
| `dtable.mjs` | G17 (P58-like) | DMN 1.3 decision tables: all seven hit policies and four aggregations, S-FEEL unary tests, typed inputs, input/output values, defaults, an exact static checker (gaps, overlaps, ANY conflicts, priority ties, shadowed rules), precedence levels, CSV tables | `decide`, `evaluate`, `checkTable`, `firstLevel`, `compileTable`, `parseUnaryTests`, `tableFromCsv` | `HIT_POLICY`, `DT_SYNTAX`, `DT_TYPE`, `DT_DOMAIN`, `DT_OUTPUT_VALUE`, `DT_INVALID`; checker `TABLE_GAP`, `TABLE_OVERLAP`, `TABLE_SHADOWED`, `TABLE_TOO_LARGE` |
| `clock.mjs` | G15 (P60-like) | obligation clock: start / pause / resume / stop / reset / cancel; wall or business-time targets; due instant, warnings, inclusive or exclusive breach; day-count deadlines | `clockAt`, `defineClock`, `dueByDays` | `CLOCK_INVALID`, `CLOCK_ILLEGAL`, `CLOCK_ORDER` |
| `saga.mjs` | P59-like | saga planner: query unknown outcomes, continue, retry forward past a pivot, or compensate committed units (items included) in reverse commit order; deterministic idempotency keys; the failure-point table; plans as logical effects | `planSaga`, `failurePoints`, `sagaKey`, `compensationEffects`, `stepStates` | `SAGA_INVALID`, `SAGA_INPUT` |
| `ledger.mjs` | §2.8 layers 2-3 | allowed-window effect matching with the contract's divergence codes; key and multiplicity invariants; conservation identities; X12 835 balancing | `matchEffects`, `allowedWindow`, `keyViolations`, `atMostOnce`, `exactlyOnce`, `identity`, `identityByGroup`, `netsToZero`, `doubleEntry`, `balance835` | `LEDGER_INVALID`, `LEDGER_ORDER`; divergences `outside-allowed`, `duplicate`, `early`, `missed`, `order`, `key-split`, `key-reuse`; critical `duplicate-money` |
| `errors.mjs` | | `EbedLibError` with `code`; `freezeDeep`; `codeOf` (tests) | | |
| `index.mjs` | | re-exports everything | | |

Every refusal is thrown as `EbedLibError` with a code; nothing falls back silently. Calendars and decision tables are
memoised by object identity and **deep-frozen on first use**, so mutating one afterwards throws instead of returning
stale results.

## Readings (decisions a spec left open; each is pinned by a test)

**Time and calendars**
- Zones come from a pinned rule table, not ICU: oracles must be byte-identical across machines and tzdata releases. A
  test compares all 35 zones with Intl at every 2020-2037 transition (±1 ms, ±1 h) and 40 instants a year (29,340
  offsets, all equal under Node 24.21 / tzdata 2026c).
- Point times use Temporal-style `compatible` disambiguation (gap → later, fold → earlier). Interval endpoints use
  `wallStart`, "the first instant the wall clock reads at least t": a spring-forward day loses the skipped hour; an
  interval spanning a fall-back fold keeps the repeated hour once; an interval lying wholly inside a gap is empty.
- Business day = a date with non-zero business time after holiday closures (a half day still counts).
  `addBusinessDays(d, n)` is the n-th business day strictly after d (d never counts; n = 0 returns d);
  `businessDaysBetween(a, b)` counts (a, b].
- `addBusinessMs(t, x)` is the earliest u with businessMs(t, u) = x, so budgets that run out at a close land on the
  close, not on the next opening.

**Decision tables (DMN 1.3)** — R1-R8 in the `dtable.mjs` header:
- R1 `'-'` does not match null (§10.3.2.9), option `dashMatchesNull` for the §9 reading; null inputs are refused unless
  the input is declared `nullable`.
- R2 no hit returns the default output, else null, for every hit policy (§10.3.2.9 step 2), including C+ / C# / R / O / C.
- R3 C# counts outputs, not distinct outputs (§8.2.10 d).
- R4 COLLECT returns rule order (one admissible "arbitrary order"); compare COLLECT lists as multisets.
- R5 PRIORITY and OUTPUT ORDER compare outputs that have output values, left to right; ties keep rule order and are a
  checker warning.
- R6 OUTPUT ORDER over compound outputs is allowed (§8.2.10 and Figure 8-19), although §10.3.2.9 3.a says "SHALL be
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
- `reset` restarts elapsed and pause totals at the reset instant, in state running. `stop` and `cancel` are terminal.
  Illegal transitions throw `CLOCK_ILLEGAL` (or are listed as anomalies with `onIllegal: 'skip'`); histories must be in
  time order (`CLOCK_ORDER`), retroactive operations being ordinary operations with an earlier `at`.
- Day-count deadlines (`dueByDays`) are not running clocks: n business or calendar days after the anchor's **local
  date in the calendar's zone**, optional roll for calendar days, due at the last second of that local day or at a
  given local time. Pausing a day-count deadline is not expressible (refused by construction).

**Saga planner**
- Compensation set = committed units as observed by status query (MR11, E-BED Errata 17): `unknown` + `committed`
  is compensated; `unknown` with no answer or `pending` blocks with `query-status`; `unknown` + `not-found` is not
  applied and may be re-issued under the same key.
- Order = reverse commit order: reverse `seq` when every committed unit has one (parallel branches), else reverse
  (step, item) order; mixing is refused. Each compensation is chained `after` the previous one.
- Pivot / retriable steps follow the saga literature: failure after a committed pivot retries forward; an abort after
  it is refused. An explicit `abort` (customer cancel, lost timer race, timeout policy) compensates without a failed
  step. Steps declared with `undo: null` are reported in `skipped`, never invented.
- Keys: `sagaKey(saga, step, item, 'do' | 'undo')`, every part percent-encoded, so distinct logical effects get
  distinct keys (the phase restriction was added after the injectivity test found `('a','b','c','do')` and
  `('a','b',null,'c:do')` colliding).

**Ledger**
- Windows are inclusive at both ends. A commit before `earliest` is `early`; no commit by `latest` is `missed`
  (reported at `latest`, the late commit kept as detail); a window still open at the grading instant `end` is `open`
  (not graded). Withdrawn lids (the rulebook no longer requires them) are not failures; effects after withdrawal are
  `outside-allowed`. Keys are per system; `key-split` and `key-reuse` are checked over attempts, committed or not.
- Row-to-lid assignment when several lids match: the lid that already used the row's key, else the first unsatisfied
  one in list order, else the first one (a duplicate).
- 835 balancing: service line SVC02 − ΣCAS = SVC03; claim CLP03 − ΣCAS(claim) − ΣCAS(lines) = CLP04; transaction
  ΣCLP04 − ΣPLB = BPR02 (PLB positive reduces the payment); and ΣSVC02 = CLP03 when lines are present (a validator rule,
  on by default, `requireLineChargeSum: false` to drop it). All amounts are safe integers of cents; sums use BigInt.

## Sources (read as data; nothing copied beyond restated rules)

| source | URL | sha256 (retrieved 2026-10-14) | licence | used for |
|---|---|---|---|---|
| OMG DMN 1.3 (formal/21-01-01) | https://www.omg.org/spec/DMN/1.3/PDF | `b591d2417e8320d71cb988c6741fe590a1a85629bf317bc0857ea803bf4bf6a6` | OMG specification; copyright OMG, read for semantics, not redistributed | §8.2.10, §8.2.11, §9 rules 5-12 and p. 86, §10.3.2.9; Figures 8-19, 11-15, 11-17 transcribed as fixtures |
| X12 RFI 2601 (quotes TR3 005010X221 §1.10.2.1.1-2) | https://x12.org/resources/requests-for-interpretation/rfi-2601-claim-line-balancing-relationship-charged-allowed | `387bea2ad3b680d395ebc8c19552a2ecb1859be5f1adb0548d711f9a13426b9e` (HTML) | X12 copyright; identities restated | line and claim balancing |
| BCBSOK PLB segment guide (2018) | https://www.bcbsok.com/docs/provider/ok/claims/ec/ok-pl-segment-835era-2018.pdf | `2588f11f6d1fcd0f54d94a070283caa1975df020118310d9363c835e93a20e82` | payer document; identity restated | transaction balancing, PLB sign |
| IBM APAR PH17298 | https://www.ibm.com/support/pages/apar/PH17298 | `3356c095cf448acc5a7d6f4e8b09682f32c37054373efd0e4a22473dd35ae65d` (HTML) | IBM support page; rule restated | ΣSVC02 = CLP03 |

DST rules: US Energy Policy Act of 2005 (from 2007), EU Directive 2000/84/EC, NSW/VIC/ACT/TAS and NZ rules (from 2007/08),
stated from general knowledge and then checked against the Intl tzdata differential above. Downloads were kept in the
session scratchpad, outside the repository.

## Tests

`node --test --test-concurrency=2 beds/ebed/lib/*.test.mjs` — 57 tests, about 2 s, $0.

| file | tests | what |
|---|---|---|
| `calendar.test.mjs` | 10 | hand-derived dates, transitions, gaps and folds, Thanksgiving / half-day business time, rolls, editions; Intl differential (29,340 offsets) |
| `dtable.test.mjs` | 12 | DMN Figures 8-19, 11-15, 11-17 under every hit policy; R1-R8; S-FEEL grammar and refusals; checker witnesses; precedence levels; CSV |
| `clock.test.mjs` | 6 | hand timelines: warnings, inclusive/exclusive breach, pause across a holiday and a half day, reset, cancel, DST wall clocks, day-count deadlines |
| `saga.test.mjs` | 7 | the 20-row failure-point table of reserve → charge → ship → notify, partial batches, parallel seq order, pivots, key injectivity, grading through the ledger |
| `ledger.test.mjs` | 7 | every divergence code on its own trajectory, keys and multiplicity, identities, 835 on a hand-built remittance |
| `property.test.mjs` | 14 | seeded (dev 1001-1199) comparison with naive models: minute-stepping business time and clocks over random calendars in 8 zones, additivity, inverse and minimality, MR3, MR8, clock laws (business ≤ actual, pause monotonicity, breach monotone in the pause set), DMN hit policies and the checker against direct evaluation on full input grids, rule-order invariance (Note 2), saga plans against a set/order model, single-mistake ledger mutations, 835 single-amount perturbations, cross-process determinism |
| `mutants.test.mjs` | 1 | the mutation list still applies |

**Mutation check** (E-BED §9.5): `node beds/ebed/lib/mutants.mjs --jobs 2` applies 64 mutants (relational boundaries,
rule and calendar swaps, disambiguation swaps, hit-policy and precedence swaps, anchor swaps, deleted guards, deleted
pause conditions, compensation order reversals, missing key parts, sign swaps) to a temporary copy and runs the suites.
Last run (2026-10-14, final code of this commit): **64 mutants, 64 killed, score 1.000** (about 70 s at 2 jobs). The
first run scored 63/64: the survivor K6 (anchor date taken in UTC instead of the calendar's zone) got a new golden in
`clock.test.mjs`. Two equivalent mutants are documented in `mutants.mjs`.

## Not done here

- **Differential test against the P58-P60 cards** (E-BED §8.1 step 3 gate "differential vs step 1 cards on golden
  suites"): it needs the cards' APIs, and this session was not allowed to read them. A separate session that may read
  both should wire the fixtures in `fixtures.mjs` (and `failurePoints`, the clock goldens) through the cards.
- Item semantics: nothing here knows D365 tolerances, Reg E clocks or network-X rules; items compose these libraries.
- Full FEEL (names, arithmetic, functions, decimals), ServiceNow-style condition-driven SLA attachment, and time zones
  outside the table are refused, not approximated.
