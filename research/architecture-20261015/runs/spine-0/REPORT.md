# SPINE-0 + LAT-0 + OUT-0: the S1 claim row, the meter, and the first latency and origin readings (2026-10-15)

> **Status: DEVELOPMENT EVIDENCE.** This is a $0 back-fill of existing run outputs (dev seeds, dev-train, synthetic sets). Nothing here is a claim.
>
> [PREDICTION.md](PREDICTION.md) was written at 08:50 UTC, before any adapter code or back-filled number existed (file times). The autosave then committed it together with the code, in `17d7482`. `backfill.mjs` prints the prediction and the MDE table before it reads any run output.

**Cost and boundaries.**
- **Cost: $0.** No model, Jev or paid call was made.
- **Nothing frozen was edited:** no file in `src/`, `policy/models.json`, `experiments/lib/`, `experiments/c0/`, `beds/lib/`, the need-router stamped files or the AB-v1 harness files.
- **Two stamped files are imported read-only:**
  - `experiments/need-router/prereg-rules.mjs`, for the §12 meter;
  - `experiments/lib/stats.mjs`, for Clopper–Pearson intervals.
- **Not read:** `beds/sealed/` and credential files.
- **No AB-v1 test task was opened.** The adapter reads only finished runs with `testSplitTasks: 0`, and would skip and report any other run. None was skipped.
- **Repository state.** Written at HEAD `b1fe87e`. Nothing was committed by hand; the autosave commits.

**Tags.**
- [code]: observed in code or data at the stated path.
- [doc]: quoted from a report, not re-derived.
- [I]: my design or inference.
- [arith]: my arithmetic.

## 1. What was built

All of it is in new directories. FIRST-CLASS-PROGRAMS gives the paths:
- §0.1 and §6.5 put S1 at `experiments/claims/`;
- §8.5 puts F8 under `experiments/timing/`;
- §6.5 puts the transfer table under `experiments/outside/`.

| Path | What |
|---|---|
| `experiments/claims/schema.mjs` | **`claim-row/0`**: one record per arm × task × run, with the S6 timing fields inside it. Also `validateClaimRow`, `validateRows`, `fieldCoverage` and `policyModelIds`. |
| `experiments/claims/meter.mjs` | The §12 meter, through the need router's own `rowCharge`/`hasObservedCost`. `Meter` reserves a start's bound before launch and refuses when meter + bound > cap or when the in-flight limit is reached. It also settles and sets aside. |
| `experiments/claims/origin.mjs` | Five origin classes in three groups (our bed, third party, real log). Bed registry with S5 tiers, and the F6 `census`. |
| `experiments/claims/adapters/*.mjs` | E8, need router (M1, M1-d5, M1-R), AutomationBench, J-Q and J-NEED-2 back-fill. |
| `experiments/claims/backfill.mjs` | CLI. Prints the MDE and the prediction, back-fills, validates (stops on any invalid row), writes the outputs and checks P1–P6. |
| `experiments/timing/report.mjs` | LAT-0 tables. |
| `experiments/outside/transfer.mjs` | OUT-0 skeleton, exact McNemar and its MDE. |
| `*/test/*.test.mjs` | 20 tests in 5 files, all passing. |

**Outputs in this directory:**

| File | Contents |
|---|---|
| `claims.jsonl.gz` | 1,514 rows, gzipped (the plain file is 7.5 MB because of provenance). Read it with `loadClaims()`. |
| `coverage.json` | Per field and per adapter, with every reason a field is not supplied. |
| `census.json` | The F6 origin census. |
| `latency.json` | The F8 tables. |
| `transfer.json` | The OUT-0 skeleton. |
| `predictions.json` | The P1–P6 readings. |
| `run.json` | HEAD, row counts, uncompressed sha256 `372987e1…`, and the AutomationBench runs read. |

**Claim row fields** [code `experiments/claims/schema.mjs`]:

| Group | Fields |
|---|---|
| Identity | `id`, `emitted` (runner or derived), `program`, `experiment`, `arm`, `run`, `trial`, `rowKind` (task, build, repair, set-aside) |
| Models and harness | `models[]` (role and id; ids checked against `policy/models.json` models and judgment models); `harness` (id, version, and hashes: runner, bridge, harness manifest, arm, policy, spec) |
| Task and origin | `task` (key, bed, family, unit, split, cases); `origin` (class, group); `fidelity[]` (world, tier M0–M4, manifest); `evidence` (class, K) |
| Verdict | kind, pass, successes, total, score, censored, excluded, and the oracle id and sha |
| Dollars | run, build, world, upkeep, imputed, reservedUnsettled, reported, repriced, bound, starts, **charged** (§12 meter), observed |
| Timing (S6) | wallMs, wallMsBounds, timeToFirstEffectMs, timeToDoneMs, startedAt/endedAt, stages[]; components (model, non-model, tool, mock, and waits: rate limit, Retry-After, queue, human); concurrency (configured, observedMax); businessTime.simulatedMs, never mixed with wall time |
| Links | `envFaults[]`; refs (build, setAsideOf, supersedes, supersededBy); `source` (adapter, and the path and sha256 of each input file) |

**Provenance.** A row with `emitted: 'derived'` carries a provenance entry for each of the 27 tracked fields.

| Kind | Meaning |
|---|---|
| copied | taken verbatim from an output field |
| computed | computed from outputs by a stated rule |
| code | a constant of the runner at its launch commit |
| doc | quoted from a report |
| missing | the outputs cannot supply it; the reason is given |
| n/a | the field does not apply |

The validator rejects a missing or n/a field that has a value, and a supplied field that has none. **No value is filled in.**

**Regressions the tests check.**
- **The meter reproduces PREREG-NEED-V1 §12:** `m1` $28.9957, `m1-d5` $33.9199, M1-R final rows $17.8934.
- **J-Q counts equal `result.json`:**

  | Screen | Planted texts flagged | Clean texts flagged |
  |---|---|---|
  | regex | 39 | 7 |
  | Jev @0.5 | 89 | 2 |
  | Haiku | 88 | 1 |

- **J-NEED-2 matches its report:** Jev 612/864 and Haiku 474/864 task-level property answers.
- **E8:** agent-H s12 10/14; B1L-H s12 14/14; B1-O 281/1,022.
- **AutomationBench:** each run's dollars and strict passes equal its `summary.json`.

## 2. Prediction check

| | Predicted | Observed | Reading |
|---|---|---|---|
| **P1** origin | third-party ≤ 10% of verdict rows and ≤ 15% of metered USD; real-process 0 (refuted > 20%) | **11.0%** (160/1,459), **3.7%** of USD, real-process **0** | **inconclusive** |
| **P2** meter | charged ≥ 2.5× reported; ≥ 80% of the gap from M1/M1-R timeouts (refuted < 1.5×) | **2.92×** ($104.77 vs $35.89); M1/M1-R are **93%** of the gap | **supported** |
| **P3** M1 tails | p99/p50 ≥ 10 for each arm at d3 (refuted < 5) | none **8.6**, medium **6.2** | **inconclusive** |
| **P4** AutomationBench first effect | median share of wall before the first write ≥ 0.40 (refuted < 0.25) | **0.68** over 144 rows; 0.63–0.73 with ±2 s on the reconstructed start | **supported** |
| **P5** E8 s12 | every 14/14 built arm ahead of agent-H at both wall bounds | 80.5 s, 102.2 s and 125.1 s per success, against agent-H 252.5 s at its lower bound; the intervals separate | **supported** (a check: the inputs were seen) |
| **P6** coverage | time to first effect ≤ 40%, model split ≤ 40%, waits 0% (refuted ≥ 50%) | **37.4%**, **42.7%**, **0%** | **inconclusive** |

**P6 beside its degenerate cases** [arith, supplementary]. The 486 one-call rows (M1 and J-NEED-2 Haiku) supply both fields by construction. Counting only rows where the first effect comes before done, and where a non-model time was measured:
- time to first effect is supplied on **9.5%** of rows (the AutomationBench sessions);
- a model-versus-rest split is supplied on **10.6%** (the E8 builds and AutomationBench).

**P3's tail is censored at the timeout.** At d3 both arms' p90 and p99 sit at the 300 s cap (283.6–300.2 s). M1-R re-ran those trials at 600 s, and its p90/p99 for effort medium sit at that cap too (600.1 and 600.2 s). The true tail is unknown.

## 3. LAT-0: the F8 latency table

How to read it:
- **Wall time** is compute wall time.
- **Per verified success** is the summed wall time divided by the verified successes.
- **Brackets** hold an interval from the success count only (two-sided 95% Clopper–Pearson). At K = 1 there is no run-to-run variance, so these figures are descriptive.
- **Percentiles** are nearest rank; at n < 100, p99 is the maximum.

### 3.1 E8, the matched sized world (1232, d2, size 12; 14 completed cases)

| Arm (solver) | Passed [CI] | Build (+ repair) wall | Run wall on this world | Per success, whole build charged here | Per success, amortised over every graded case | One smoke run (3 practice worlds) |
|---|---|---|---|---|---|---|
| B1L-H lineage 1 | 14/14 [0.77, 1.00] | 18.8 min | **not recorded** | **80.5 s** [80.5, 104.7 s] | 1.1 s (1,036 cases, 10 worlds) | 5.5 s |
| B1N-H lineage 2 (repaired) | 14/14 | 29.2 min | not recorded | 125.1 s [125.1 s, 2.7 min] | 1.7 s | 8.3 s |
| B1N-H lineage 3 (repaired) | 14/14 | 23.8 min | not recorded | 102.2 s [102.2 s, 2.2 min] | 1.4 s | 7.5 s |
| B1-O (Opus, one shot) | 5/14 [0.13, 0.65] | 32.9 min | not recorded | 6.6 min [3.6, 18.4 min] | 6.9 s (286/1,036) | no loop |
| **agent-H** | 10/14 [0.42, 0.92] | – | **42.1–101.7 min** (bounds) | **4.2–10.2 min** [3.3, 17.3 min] | – | – |

- **Built-solver run time was never recorded:** `build.mjs grade()` keeps no clock. The nearest measurement is `smoke.jsonl`: each smoke run took 5.5–8.3 s for three practice worlds (d2, d3 and d5).
- **agent-H has only wall-time bounds.**
  - Run 1 ran 84 clean ticks, then hit 13 `MODEL_RATE_LIMIT` refusals. Its 3,579,695 ms cannot be split between the two parts.
  - The resume took 2,525,184 ms.
  - B1-E8-DEV's "about 1.5 h" lies inside the bounds [doc].
- **B1-O is not ahead of agent-H.** It sits between agent-H's two bounds even before its run time is added [I: the kind of reversal LAT-1 counts].
- **Business time stays on its own clock.** agent-H's ticks spanned 13.7 days of simulated time, never added to wall time.

### 3.2 E8, the nine full worlds (non-superseded gradings; run wall not recorded)

| Arm (grading) | Passed | Build (+ repair) wall | Per success (build only) |
|---|---|---|---|
| B1-H | 21/1,022 | 18.6 min | 53.1 s |
| B1-O | 281/1,022 | 32.9 min | 7.0 s |
| B1L-H lineage 1 (regrade, oracle 2) | 1,022/1,022 | 18.8 min | 1.1 s |
| B1L-H lineage 2 | 974/1,022 | 24.3 min | 1.5 s |
| B1L-H lineage 3 | 1,015/1,022 | 20.2 min | 1.2 s |
| B1N-H lineage 2 | 1,022/1,022 | 29.2 min | 1.7 s |
| B1N-H lineage 3 | 1,022/1,022 | 23.8 min | 1.4 s |

- **B1-H.** Its d2 is 0/155, as B1-E8-DEV says. The 21 passes are at d3 and d5 [code].
- **agent-H** has no full-world row: both runs were killed at the 2-hour job limit (§3.4).

### 3.3 One-call, session and reader arms

| Bed | Run | Arm | Origin | Passed | p50 | p90 | p99 | Per success [CI] | First effect p50 | First effect / wall | Model share | Concurrency (configured / observed) | USD reported / metered |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| W-bed | m1 (d3) | Haiku, effort none | ours | 38/96 | 34.8 s | 4.7 min | 5.0 min | 4.0 min [3.2, 5.3] | 34.5 s | 1 | 1 | 4 / 4 | $1.59 / $8.59 |
| W-bed | m1 (d3) | Haiku, effort medium | ours | 41/96 | 48.5 s | 5.0 min | 5.0 min | 4.9 min [3.9, 6.4] | 39.3 s | 1 | 1 | 4 / 4 | $1.41 / $20.41 |
| W-bed | m1-d5 | Haiku, effort none | ours | 12/48 | 52.9 s | 5.0 min | 5.0 min | 8.4 min [5.3, 15.3] | 49.7 s | 1 | 1 | 4 / 4 | $3.59 / $11.59 |
| W-bed | m1-d5 | Haiku, effort medium | ours | 13/48 | 87.1 s | 5.0 min | 5.0 min | 11.1 min [7.2, 19.7] | 64.9 s | 1 | 1 | 4 / 4 | $2.33 / $22.33 |
| W-bed | m1-r (600 s) | Haiku, effort none | ours | 2/15 | 4.7 min | 5.7 min | 6.6 min | 31.1 min [10.2, 250] | 4.7 min | 1 | 1 | 4 / 4 | $2.43 / $2.43 |
| W-bed | m1-r | Haiku, effort medium | ours | 2/39 | 6.4 min | 10.0 min | 10.0 min | 133.5 min [39.5, 1,092] | 6.0 min | 1 | 1 | 4 / 4 | $5.47 / $15.47 |
| AutomationBench | raw-haiku-60 (before the split) | A0-raw Haiku | third party | 13/60 | 58.3 s | 87.6 s | 12.5 min | 5.6 min [3.5, 10.0] | 35.0 s | 0.66 | 0.91 | – / **6** | $0.92 / $0.92 |
| AutomationBench | a0-dev60 | A0 Haiku | third party | 12/60 | 60.2 s | 99.4 s | 3.0 min | 5.5 min [3.4, 10.3] | 44.7 s | 0.70 | 0.91 | – / 3 | $0.98 / $0.98 |
| AutomationBench | a0-dev-first6 | A0 Haiku | third party | 0/6 | 52.7 s | 81.2 s | 81.2 s | no success | 29.7 s | 0.43 | 0.85 | – / 2 | $0.085 |
| AutomationBench | a1-dev-first6 | A1 Haiku | third party | 0/6 | 70.8 s | 98.5 s | 98.5 s | no success | 39.4 s | 0.70 | 0.91 | – / 2 | $0.10 |
| AutomationBench | a0s-dev-first6 | A0 Sonnet | third party | 0/6 | 29.7 s | 51.5 s | 51.5 s | no success | 15.9 s | 0.54 | 0.81 | – / 3 | $0.85 |
| AutomationBench | a1s-dev-first6 | A1 Sonnet | third party | 1/6 | 33.2 s | 58.1 s | 58.1 s | 4.2 min [65 s, 165 min] | 25.6 s | 0.61 | 0.87 | – / 3 | $0.95 |
| AutomationBench | simple-sanity (diagnostic) | A0-raw Haiku | third party | 10/10 | 19.5 s | 27.9 s | 35.9 s | 22.3 s [22.3, 32.3 s] | 14.5 s | 0.69 | 0.80 | – / 5 | $0.036 |
| J-NEED-2 | jev-need2 | Haiku property reader | ours | 474/864 cells | 4.3 s | 5.5 s | 20.8 s | 1.3 s per cell | 4.3 s | 1 | 1 | – | $0.073 |

**AutomationBench time to first effect** [code; arith].
- **Source.** The live call log, outside the repository; each row records each file's path and sha256.
- **Rule.** The bridge time of the first `api_fetch` with a mutating method, minus the session start. The start is the last transcript timestamp minus the CLI's `duration_ms`, so the value is approximate to about 2 s; one row clamps at 0.
- **Coverage.** 144 of 160 rows. Ten sessions wrote nothing (n/a), and the six scripted rows have no result event.
- **Reading.** Sessions spend between half and two thirds of their wall time reading and searching before the first write: median 0.68 overall, Sonnet 0.54–0.61.

**Model share.** The model API share of AutomationBench session time is 0.80–0.91. Bridge time and mock time cannot be separated, because the bridge does not time its calls.

**Configured concurrency** is recorded for M1 only: each runner's source at its launch commit, with the sha256 that PREREG records.
- The AutomationBench runner does not store `--concurrency`.
- `raw-haiku-60` shows an observed overlap of **6**, while the default at HEAD is 4 (`run.mjs:43`). A default read from HEAD would have been wrong.

### 3.4 Kept apart: environment faults, censored runs and set-aside attempts

| Run | Kind | Fault | Wall | Starts | USD reported / metered | Simulated span |
|---|---|---|---|---|---|---|
| agent-H s12, run 1 ticks 85–97 | set-aside | `MODEL_RATE_LIMIT` ×13 | not separable | 13 | $0.009 / **$4.81** | 4.2 days |
| agent-H full world 1232 d2, run 1 | censored | job time limit | 2 h [doc] | 197 | $1.88 | 8.1 of 14 days |
| agent-H full world 1232 d2, run 2 | censored | job time limit | 2 h [doc] | 171 | $1.63 | 5.9 days |
| M1-R set-asides (not in the repo) | 4 invalid timeouts from attempt 1, 4 `MODEL_RATE_LIMIT` | – | – | 8 | – / $8.00 [doc PREREG §12] | – |
| J-Q first Jev attempt (not in the repo) | 1,200 `MODEL_AUTH` | – | – | 1,200 | $0 / unbounded: Jev has no per-request dollar bound | – |

- **Meter rule as written.** The 12 refused agent-H ticks recorded no dollars and no tokens, so §12 books each at its $0.40 bound.
- **Concurrency.** No row in this table records its configured concurrency.

### 3.5 Verdicts with no timing at all

| Arms | Rows | Why |
|---|---|---|
| J-Q: regex, Jev, Haiku | 600 | regex not timed; the Jev ledger records dispatch only; Haiku calls record no latency |
| J-NEED-2 Jev | 144 | dispatch and completion times only, no duration |
| Every E8 grading | 112 | `grade()` keeps no clock |

## 4. OUT-0: origin census and the transfer skeleton

### 4.1 Origin census (F6)

| Group | Rows | Verdict rows (not excluded or superseded) | Successes | USD reported | USD metered | Beds |
|---|---|---|---|---|---|---|
| Our bed | 1,354 | 1,299 | 7,118 | $31.97 | $100.84 | E8, W-bed, J-Q T7, J-NEED-2 |
| Third party | 160 | 160 | 36 | $3.93 | $3.93 | AutomationBench |
| Real log | **0** | **0** | 0 | $0 | $0 | – |

| Class | Rows |
|---|---|
| ours | 1,354 |
| ours-grounded | 0 (AB-R not run) |
| outside world, our grader | 0 |
| outside world and grader | 160 |
| real process | **0** |

- **The only outside bed is AutomationBench**, at tier M1 relative to its vendors (§5.4).
- **BPI logs feed no verdict row yet.** OUT-2 is their first use.

### 4.2 Matched contrast: practise in a mock first vs act cold

| Bed | Origin | Practise first | Cold | Status | Effect | Discordant | Exact McNemar | MDE at this n |
|---|---|---|---|---|---|---|---|---|
| E8 (1232 d2 s12) | ours | B1L-H lineage 1 | agent-H | observed, K = 1 | +4/14 | 4–0 | p = 0.125 | 6 one way (0.43): **inconclusive** |
| AB-R | ours, grounded | wf-H | agent-H | pending: not run | – | – | – | – |
| AutomationBench | outside world and grader | rehearse-H (MA-0) | agent-H | pending: MA-0 not run | – | – | – | – |

- **F6's number is pending.** It is the outside effect divided by the in-generator effect, and no outside bed carries the matched contrast yet.
- **Amortisation differs.** Build once vs rehearse every task; the table states it.
- **A1 vs A0 (harness vs raw official loop) is a separate contrast**, never paired with E8.
  - On Haiku, `a1-dev-first6` vs `a0-dev-first6`: 0 vs 0 strict, partial credit 0.28 vs 0.33, p = 1.
  - On Sonnet (date note on both arms), `a1s` vs `a0s`: 1 vs 0 strict, 0.67 vs 0.55, p = 1.
  - The MDE is 6 of 6, so both read **inconclusive**.

## 5. The §12 meter on every source

| Source | Reported | Metered | Why they differ |
|---|---|---|---|
| E8 (builds, repairs, agent-H) | $15.07 | $19.87 | 12 refused ticks at their $0.40 bound |
| W-bed M1, M1-d5, M1-R | $16.81 | $80.81 | 64 `MODEL_TIMEOUT` at their $1 bound; equals PREREG's $62.92 + $17.89 |
| AutomationBench (8 runs) | $3.93 | $3.93 | every cost observed |
| J-Q | $0.014 | $0.042 | Jev re-priced from tokens |
| J-NEED-2 | $0.073 | $0.122 | Jev re-priced from tokens |
| **All rows** | **$35.89** | **$104.77** | |
| Plus set-asides held outside the repository | | **$112.77** | M1-R's 8 attempts at $1 [doc] |

**Jev re-pricing** uses $0.042 per million input tokens, which `policy/models.json` marks "second-hand, unverified". Output tokens are unpriced, so the figure is a lower bound.

## 6. What the old outputs cannot supply (never filled in)

| Field | Supplied | The main reasons it is missing [`coverage.json` `notSupplied`] |
|---|---|---|
| wall time | 656 / 1,514 (2 `doc`) | J-Q and J-NEED-2 Jev untimed; E8 gradings keep no clock; agent-H s12 has bounds only |
| time to first effect | 566 | as an effect before done, **only the 144 AutomationBench sessions**; E8 journals not kept; agent ticks carry the simulated clock only |
| model vs non-model split | 647 | as a measured split, **only 7 E8 builds and 154 AutomationBench sessions** |
| tool time | 0 measured | the "supplied" ones are one-call zeros |
| mock time | 7 measured (E8 smoke runs) | the bridge has no per-call duration |
| waits | **0** | no runner times them; rate limits show up only as refusals |
| configured concurrency | 349 (M1 code, 7 builds) | AutomationBench, J-Q, J-NEED-2, E8 gradings and agent-H do not record it |
| world (mock) cost | 160 (AutomationBench, $0 to us) | E8 world, W-bed rungs and T7 set: authoring cost never recorded (F5) |
| re-priced USD | 344 (Jev only) | M1 `tokensIn` excludes cache; AutomationBench tokens are only in the live transcripts |
| simulated business time | 5 (agent tick spans) | E8 gradings record no world horizon |

## 7. Caveats

- **Live data is local.** AutomationBench time to first effect and the model split come from `/var/tmp/foundry-work/autobench/<run>/` on this machine. Without those files, or with `--no-live` (the tests run that way), the fields are marked missing.
- **Two runs were read before they were committed:** `a0-dev60` and `a1s-dev-first6`, by other agents, finished 08:57 and 08:46 UTC. The autosave has since committed them. The rows carry each input file's sha256.
- **`raw-haiku-60` predates the AB-v1 split** and may overlap its test tasks. Only result rows were read, and the run is labelled.
- **E8 regrades.** The 45 superseded original E8 gradings are kept as rows (`refs.supersededBy`) and excluded from every table and census verdict count.
- **Doc values** are marked `doc`: the killed agent runs' 2 h, B1-H's $3 cap and the M1-R set-asides.
- **Deviations from the plan text [I].**
  - S6 lives inside S1 (§0.1), not in a separate `experiments/timing/schema.mjs`.
  - Derivation is in the adapters, not in `experiments/timing/derive.mjs`.
  - The S5 manifest stub (§10 row 1) was not written, because `experiments/mockfid/` belongs to FID-0. S1 already carries `fidelity[].manifest`, null today.
  - The doc's paths were used rather than `experiments/spine/`.

## 8. What it means for the plan (development reading only)

- **New runners.** A new runner emits `claim-row/0` with `emitted: 'runner'` and meters through `Meter`: reserve before launch, then settle or set aside. Timeouts and refusals are charged at their bound.
- **F8.** The old outputs cannot supply these; S6 in every new runner (from 10-18) is the only way to get them:
  - the first effect inside a session;
  - built-solver run and grading time;
  - waits;
  - mock time;
  - configured concurrency.
- **F6.** No real-process rows; one outside bed, at tier M1; 89% of verdict rows come from our own generators.
- **F5.** No bed's world cost is known except AutomationBench's, which is $0 to us as a clone.
- **E8 speed.** The built workflows beat agent-H per verified success even with the whole build charged to 14 cases. The one-shot Opus build does not. This rests on one generator, one seed and K = 1, and the +4/14 is below the MDE.

## Reproduce

```
node experiments/claims/backfill.mjs
node --test --test-concurrency=1 experiments/claims/test/schema.test.mjs   # also meter, adapters; experiments/timing/test, experiments/outside/test
```

## Review corrections (2026-10-15, applied to the outputs; the text above is the builder's draft)

**Effect on the builder's REPORT.md draft.** Readings P1–P6 keep their verdicts, but the draft needs these updates:
- **P2:** charged $105.57 (was $104.77), ratio 2.94, M1 share 0.92.
- **P3:** both p99 values are the 300 s deadline. It stays inconclusive, and now cannot refute.
- **`usd.world`:** supplied on 0% of rows (was 10.6%).
- **Run filter:** the claim that it "reads only runs with `testSplitTasks: 0`" is wrong. It now checks each run's tasks against the split.
- **Test count:** 22, not 20.

The reviewer's full findings table, 13 items with 12 fixed, is in the workflow journal. Its summary:
- The killed agent-H runs now carry their in-flight start at the bound.
- Per-run split checks were added.
- Runs with k > 1 are rejected.
- Skipped forks are not charged.
- `usd.world` is missing, not 0.
- Deadline-capped latencies are flagged.
- The validator requires a bound.
- The E8 hash fallback was removed, and build errors now reach the meter.
- `--out` resolves absolute paths.
- A null-ratio guard was added.
- Provenance labels were fixed.
