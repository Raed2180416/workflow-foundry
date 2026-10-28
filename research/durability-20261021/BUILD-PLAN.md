# DUR-1 build plan: files, reuse, tests with teeth

*2026-10-22, revised about 04:35Z against main `056d70fa`. For the build agent working in its own durability worktree.
Companion to [DESIGN.md](DESIGN.md) and [PREREG-DUR-1.md](PREREG-DUR-1.md) (DRAFT). Paths are relative to the
worktree root.*

## 0. Ground rules

- Build only in the durability worktree; never edit `/home/user/workflow-foundry` (live experiments run there) and
  never edit the branch `worktree-wf_0f86d12b-ab5-2`. Commit on the worktree branch with the trailers
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_011geBy7JvDqKuqhDyfmzd1U`; do not push; never commit the host
  account e-mail or keys.
- **No paid call during the build.** Every model-facing piece is exercised with stub sessions. The first paid call is
  the sealed-author session after freeze F-A; every other paid call follows freeze F-B (prereg §13.1).
- Tests: `nice -n 15 node --test --test-concurrency=1 <file>`, one file at a time (4 shared CPUs). New tests use small
  worlds (size ≤ 24) so each file runs in under 2 minutes.
- Disk: `df -h /` before any step that writes more than 50 MB; stop below 1.2 GB; temp dirs under
  `/var/tmp/foundry-work/dur1-*`, deleted when the step ends. Journals of $0 runs are not kept (digests only).
- Never read `beds/sealed/` or AutomationBench devCheck/test tasks. The sealed DUR-1 bundle lives in
  `/var/tmp/foundry-work/dur1-sealed/` and is only ever loaded by code that prints counts.
- Model ids only from `policy/models.json`; every paid launch passes an explicit effort (D28 (4)); the runner refuses a
  missing effort.

## 1. Imports (read-only sources, recorded with their commit)

| What | How | Why |
|---|---|---|
| FH-1 heal kit `experiments/fh/*` (heal, grade, baseline, freeze, counterfactual, tests) | `git checkout 9e2a2b61 -- experiments/fh` | DUR-1's patch session, `contractClasses`, `contractFailuresText`, `serveMailbox`, `healTask`, `gateDecision`, `SESSION`, spend ledger, freeze-check pattern. Its imports (`experiments/compose/{build,bundle,trace,capabilities}.mjs`, `experiments/ebed/{build,smoke-service}.mjs`, `experiments/tracker/nversion.mjs`, `src/executors/claude-code.mjs`) are identical on main |
| The commissioned programs | `git checkout 9e2a2b61 -- research/heal-20261021/fh1/runs/<incident>.H-C.k1/program` for the 7 clean-k1 incidents and `…/ch-e8-3.H-C.k2/program`; `b1lh-e8-1` from `research/enterprise-20261014/runs/b1lh-e8-1/` (≈ 1.3 MB) | starting versions (prereg §5 rule); sha256 into `programs.json` |
| FH-1 records needed by the rule | `record.json` of the same runs | the starting-version rule reads "practice contracts after" from them |
| Move 0 certification (only if not on main at F-B) | `git checkout d3bd7acf -- experiments/lib/certify.mjs experiments/lib/gauntlet.mjs experiments/lib/certify.test.mjs experiments/lib/gauntlet.test.mjs` | `certifyHeal` (deterministic mode) for every promotion (prereg §10, *Certification*). Its other imports, `experiments/lib/stats.mjs` and `stats-builds.mjs`, are byte-identical on main and at `d3bd7acf` (blob `514fb8dd…`, `0377e001…`); run both test files once after the checkout |

## 2. Files to build

All new code goes in `experiments/durability/` (new files only; frozen files elsewhere are imported, never edited).
Effort estimates are agent-hours.

| # | File | Purpose | Reuses | Tests with teeth (each must fail on the planted defect named) | h |
|---|---|---|---|---|---|
| 1 | `schedule.mjs` | The frozen schedule (prereg §4.1) as data; `worldsOf(stream)` → per-world seed, size, change set, onsets | — | schedule matches the prereg table (parsed from the markdown table at test time; a one-cell edit to either side fails); seeds pass `assertEbedSeeds`, and 1161–1168, 9101–9104, 9201–9204 are refused | 0.5 |
| 2 | `changes.mjs` | Operators: P1 edition (with placement-dated code rewrite), E1 F5 rename on `carrier.create`, E1r (no rename), R1 (D1 edit + `effectiveFrom` gate on a transition copy; `driftWorld` among orders placed in [d5, d9]), L1 (MR11 `injectFailures` on a seeded 15% subset), F (world part: `dup-delayed` on 10%; arm part: `withCrashRamp`, `withRestart` every 7), ADV (`injection: true` + adversarial complaint), volume; stacking of several transition edits into one copy per world; sealed loader (sha256 check, count-only API) | `drift.mjs` (`DRIFTS`, `driftedItem` pattern, `once`), `faults.mjs` (`withRestart`, `withCrash`), `metamorphic.mjs` (`injectFailures`, `duplicateInbound`), `world.mjs` | per operator: reference (both timings) 100% with 0 oracle errors on a rehearsal-sized world; the change bites (≥ floor exposed cases); every bad control still fails; deterministic (same world hash twice); **effectiveFrom golden**: an order placed 1 minute before the effective time follows the old rule, 1 minute after the new (a gate on `p > eff` instead of `p >= eff` fails it); R1 with the gate at t0 equals `drift.mjs` D1 exactly; stacking R1 + a dummy second edit keeps both (an anchor that occurs twice throws); E1r world has no F5 and `site` is refused; the sealed loader refuses a bundle whose hash differs by one byte | 4 |
| 3 | `exposure.mjs` | Incremental twins and base twin; exposure tags from the reference's expected effects and requests; change-induced and base classification for a version timeline; count-only printing for sealed changes | reference runs (`beds/ebed/oracle/policy.mjs` `referenceArm`), `runWorld` | a planted change that alters no expectation yields 0 exposed (a tag computed from requests only would still pass this); twins of cumulative worlds differ only by the named change (hash of the operator list); sealed changes print counts only (a test captures stdout and fails on any case id) | 2 |
| 4 | `oracle.mjs` | Grading wrapper: per-world item (stacked transition copy), pools, ep4 exemption, critical at first divergence | `e8.oracleItem`, `grade.mjs`, `stats-ebed.mjs` `casePools` | a case with two critical violations counts once; a case whose first divergence is non-critical and a later one critical is not critical (counting violations fails it); ep4 cases are excluded | 1 |
| 5 | `complaints.mjs` | True, false and adversarial complaints from `rng('dur1/…')`; templates from `defects.mjs`; delivery times; topics | `defects.mjs` complaint forms | **arm independence**: two arms with different outcomes on a case get the same u and delay (drawing from an arm-seeded stream fails); false complaints identical across arms; q = 0.5 within a binomial tolerance over 10⁴ draws; delivery after a world's horizon moves to the next world's d1 | 1 |
| 6 | `edetector.mjs` | m6: profile score, smoothed conformal p-value against fixed calibration, power bet, e-CUSUM, reset | `profile.mjs` (`learnProfile`, `checkProfile`, `PARAMS`) | null simulation: 10,000 streams of 600 exchangeable cases give ≤ 0.10 false-alarm probability per stream (a calibration that updates with post-change data, or ε = 1, fails); exactly 4 consecutive maximally novel cases alarm, 3 do not; the calibration is never widened by stream data | 1.5 |
| 7 | `monitor.mjs` | m1–m5 per world-day on a journal prefix; attributable signals; incidents (rules 1–6 of prereg §6.2); verifier-blind rule; payload-derived case index for V-9 | `capabilities.mjs` `evaluateCapabilities` (with `rules`), `observer.mjs` `observe` (C1 only), `indexJournal` | an effect error followed by a success of the same (case, system, op) is not an m1 signal; contracts judged on a prefix do not flag a deadline after the prefix; two false complaints on different topics never open a verifier-blind incident, two on one topic within 3 days do; m4 never attributes to a case; m6 never opens an incident (a planted m6 alarm leaves the incident list unchanged) | 3 |
| 8 | `registry.mjs` | Hash-chained version registry with compare-and-swap; proposer ≠ approver | `experiments/constitution/registry.mjs` pattern | a promotion with a stale expected head is refused; a self-approved proposal is refused; the chain detects an edited past entry | 1 |
| 9 | `heal-adapter.mjs` | Evidence sets (announced: practice 1235–1237 with announced overlays; unannounced: replay of cases the arm saw to completion); `FAILURES.md` = FH-1 classes + **raw effect results** of example cases + quoted complaints; smoke service on those sets; FH-1 session (model, effort, caps from config); heal-until-clean (≤ 2); gate; canary; spend reservation; MH-H→O option | `experiments/fh/heal.mjs` (`contractClasses`, `contractFailuresText`, `serveMailbox`, `healTask`, `gateDecision`, `SESSION`, `spent`), `smoke-service.mjs` | **information hygiene (V-7)**: the import closure of the evidence builder contains no oracle, transition, truth-reading or exposure module (static walk, as `agentv` does for its validator); a planted hidden overlay on practice worlds during an unannounced incident makes the test fail; a case not completed by the alarm time never appears; `FAILURES.md` for a planted `400 field-renamed` contains the error object's `reason`, `field` and `renamedTo` (FH-1's flattened smoke line fails it); the gate rejects FH-1's dry-run swap (`b1lh-e8-2` into `b1lh-e8-3`: raw +7/−48); a red-team world id in any set throws; a stub session runs the whole loop end to end at $0 | 4 |
| 10 | `contracts-owner.mjs` | C-O sessions (announced diff; verifier-blind complaints); output = a rule-reading variant or a contract patch in a copy of `capabilities.mjs`; certification at $0 (prereg §6.4) | `capabilities.mjs`, `drift.mjs` | certification accepts the analyst's D1 reading (`{ reviewTimeout: 'clear' }`) and rejects the base reading under R1 (it flags the drifted reference); a contract patch that flags everything fails the 1% rule | 2 |
| 11 | `stream.mjs` | The driver: per world, run with a version timeline (`timelineArm`: swap at a simulated time, carry kept), evaluate monitors day by day on the prefix, open incidents, heal, canary (scratch run of the candidate through the next day), promote at the day boundary via the registry, re-run the world with the extended timeline, roll back, carry the version and open incidents to the next world; forks (MH-H→O, MH-stale); resume from the last committed step; env-fault handling; `FREEZE.json` check before every paid step | `faults.mjs` `withRestart` (factory swap), `runWorld`, `heal-adapter`, `monitor`, `registry`, `experiments/fh/freeze.mjs` pattern | **prefix identity (V-6)**: after a swap at T, journal rows before T are byte-identical to the previous run (a stub arm with a hidden clock or `Math.random` makes it fail); a rollback restores the incumbent from the next day; a killed run resumes to the same final digest; a paid step refuses to start if any frozen hash differs or `spent + cap > 80` | 5 |
| 12 | `windows.mjs` | Routing arm (selected cases → agent, others → `referenceArm` with the host journal); selection rule; spec-in-force provider (announced spec from its publication); A-H and A-Ox launch through `experiments/agentv/run.mjs` settings with explicit effort and the A-Ox stop rule | `agentv/arm.mjs`, `ebed/agent-arm.mjs`, `oracle/policy.mjs` | **routing identity (V-10)**: routing reference→reference reproduces the plain reference journal digest; routing a mutant on 2 cases changes only those 2 cases' grades; a tick before publication sees the old spec, after it the new; selection is identical on two runs and uses no arm output | 3 |
| 13 | `refm.mjs`, `ld.mjs` | REF-M (S1–S3 under `stream.mjs` with the Opus patcher config); LD-H (latent-defect mutants via `defects.mjs`, manifest complaints, `after`/`before` sets) | `defects.mjs`, `ledger/latent-defects/*.json`, `specificity/*` | a mutant program loads and reproduces its manifest's affected cases; a false-twin complaint alone never opens an incident; S1–S3 static reproduce 100% on two rehearsal worlds | 2 |
| 14 | `knobs.mjs`, `wc-search.mjs` | WC-1: knob DSL (generator-made worlds only; in-spec transforms; OOC flagged), pool generation, Poisson sampling with exact πᵢ, Horvitz–Thompson rates, ESS, CVaR10%, local search with successive halving, LDFI pairs from the reference's effect ledger, fresh-salt confirmation, group transfer | `metamorphic.mjs`, `faults.mjs`, `compensationLedger` (`capabilities.mjs:711`) | **unbiasedness**: on a synthetic population with a known failure rate the HT estimate's mean over 2,000 resamples is within 2 SE (dropping 1/πᵢ fails); ESS equals n for equal weights; LDFI places faults only on steps in the reference's lineage of a good outcome; the DSL refuses an out-of-spec transform and labels OOC worlds; budget counter stops at 400/150 | 4 |
| 15 | `redteam/probe.mjs`, `redteam/validate.mjs`, `redteam/session.mjs` | J2: scenario runner against a target (effects and per-case verdicts), validity gate (bed findings), session driver (25-probe mailbox, ≤ 8 scenarios, ≤ 16 orders each), blind baseline hook | `wc-search.mjs`, `serveMailbox` pattern | the 26th probe is refused; a planted scenario that fails the reference is classed as a bed finding and excluded; a scenario with an out-of-spec transform is rejected | 2 |
| 16 | `shield-harm.mjs` (B-tier, $0 ablation) | Harm policy for `effectPort` (`experiments/constitution/port.mjs:33`) | `port.mjs` | refuses a second charge for a fulfilment and a refund above the charge; passes the reference journal unchanged (a policy that refuses any refund fails) | 1 |
| 17 | `analyze.mjs` | Every metric of prereg §9 and rules K-0, D-1…D-11; TTD (oracle and system views); version matrix; sweep; D-1 exact sign-flip on lineage differences; D-3 two-way (lineage × window) bootstrap; Holm; per-world rule-of-three; ceiling column; owner table; root-cause ledger scaffold; `certifyHeal` evidence builder per promotion (prereg §10 mapping) and the certified-durable share | `stats.mjs` (`pairedPermutation` `:518`), `stats-ebed.mjs` (`wilcoxonExact`, `holm`, `nonInferiority`, `clopperPearson`), `stats-builds.mjs` (`FLOOR`), `certify.mjs` (`certifyHeal`, `headlineRow`, `EffortMissingError`), `jit/stats.mjs` (`ENV_FAULT_LIMIT` `:45`), `jit/durability.mjs` ideas | golden synthetic stream: known TTD (including an unjudgeable late change and a relapse that makes TTD ∞), durable share, silent and loud counts; sign-flip 9 of 9 positive gives one-sided p = 1/512, 8 of 9 with the smallest negative 2/512; Holm on (0.01, 0.04) supports both, on (0.03, 0.04) neither; **unit teeth**: on a synthetic set where one lineage fails every routed case, the two-way bootstrap lower bound is below the window-only bound (a bootstrap that averages lineages first, or pools cases, fails the test), and no function in the file accepts a case list spanning lineages for an arm-versus-arm test; a 2.9-point mean difference never yields "supported" (floor); **certification teeth**: a promotion whose fresh failing stratum is only partly fixed gets `reject` (`partial-fix`), and a code-gate accept alone never counts as a heal; zero-event bound uses world units (a per-case bound fails the test); a missing effort in a launch manifest is an error | 4.5 |
| 18 | `freeze.mjs`, `dur1-chain.sh` | `FREEZE.json` writer and checker (prereg §13.1 list); detached, idempotent launcher in priority order with `--resume`, `df` guard, 30-minute environment-fault wait, ≤ 2 paid workers, Opus rows gated on no other Opus chain running | `experiments/fh/freeze.mjs`, the C9 relaunch pattern | changing one byte of any listed file blocks a paid step; the chain refuses to start a row whose cap does not fit | 1.5 |
| 19 | `test/` | One file per module above | — | — | (in rows) |
| 20 | `power.mjs` | The prereg §11 numbers, reproducible: SD of the 9 as-delivered build rates and its χ² interval; sign-flip MDE (n = 9 and 6) at the SD and its bounds; durable-share, D-4 and D-6 operating characteristics; D-3 two-way-bootstrap power; fixed seeds; prints one JSON whose sha256 goes into `FREEZE.json` | `stats.mjs` `pairedPermutation`, `stats-ebed.mjs` `wilcoxonExact`; the synthesis step's scratch scripts `/tmp/claude-0/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/scratchpad/durability/calc/{power,signflip,d3}.mjs` as the starting point (they import main-tree paths absolutely; make them relative) | the printed SD is 0.0433 for the failing counts (0, 7, 19, 48, 48, 48, 67, 102, 136) of 1,022; the D-3 simulation's size at the margin (true −0.10) is within 0.025 ± 0.01; a run with the same seed prints the same JSON | 1 |

Research files: `research/durability-20261021/{DESIGN.md, PREREG-DUR-1.md, BUILD-PLAN.md, AUTHOR-BRIEF.md,
SEED-CLAIMS.json}`; `runs/` for outputs (gitignored journals, committed digests and records).

**Ledger edit** (one commit, early): append the two dated sentences of prereg Appendix A to the `use` texts of `ebed-dev`
and `ebed-e8-rehearsal`, and add `SEED-CLAIMS.json`. Then run
`nice -n 15 node --test --test-concurrency=1 experiments/lib/ebed-seed-ledger.test.mjs` (must stay green: no new row).

## 3. Stage Z validity gates (executable, $0; each is a test or a script with a pass/fail line)

| Gate | Check | On failure |
|---|---|---|
| V-1 | Reference, both timings, 100% with 0 oracle errors on every stream world, twin, practice-with-overlay world, routed window and ADV-SET world | K-1 stop |
| V-2 | Every bad control fails every changed world | K-1 stop |
| V-3 | Every change meets its exposure floor; the undrifted reference fails ≥ 90% of a rule change's exposed cases | fix the operator before F-B (sealed: the author's revision) |
| V-4 | `effectiveFrom` goldens | fix before F-B |
| V-5 | Contracts under the rule readings in force flag 0 reference cases on every changed world | recorded per change as "verifier impaired" (not a stop) |
| V-6 | Determinism and prefix identity on 2 lineages × 2 stream worlds | fix before F-B |
| V-7 | Information hygiene (static import walk + planted leaks) | fix before F-B |
| V-8 | Complaint draws arm-independent | fix before F-B |
| V-9 | Contracts with a payload-derived case index agree with the truth-indexed contracts on practice worlds (disagreements counted) | if > 0: m2 reported as "truth-indexed" and D-6 also reported without m2 |
| V-10 | Routing identity | fix before F-B |
| V-11 | The 9 starting versions reproduce 1,022/1,022 on grading worlds 1232–1234; two COMP-1 fault-battery rows reproduce their journal digests | stop and investigate |
| V-12 | m6 null simulation and delay | fix before F-B |
| V-13 | Sealed bundle hash and its own count-only gates | author revision |
| V-14 | C-O certification (at P2, before contracts gate anything) | K-2 |

## 4. Order of work and checkpoints

1. Imports (§1), ledger edit, `schedule.mjs`, `oracle.mjs`, `changes.mjs` for the designer-known operators,
   `exposure.mjs` → V-1…V-4 on stream s1 with designer-known changes only.
2. `AUTHOR-BRIEF.md` and the operator API documentation → **freeze F-A** (hash, commit) → the orchestrator launches
   the sealed-author session (P1, the first paid call) → V-13 count-only → bundle hash committed.
3. `complaints.mjs`, `edetector.mjs`, `monitor.mjs`, `registry.mjs`, `heal-adapter.mjs` (stub sessions),
   `stream.mjs` → V-5…V-9, V-11, V-12; a full $0 dry run of MH-H on s1 with a stub patcher.
4. `contracts-owner.mjs` (stub), `windows.mjs` → V-10; `refm.mjs`, `ld.mjs`.
5. `knobs.mjs`, `wc-search.mjs`, `redteam/*`, `shield-harm.mjs` (if time).
6. `analyze.mjs` with the golden stream; `power.mjs` (its output must match prereg §11, else the prereg is corrected
   before F-B); `freeze.mjs`, `dur1-chain.sh`.
7. Review (code and prereg), fixes, then **freeze F-B** in the Fix phase; only then Stage Z proper and P0.

Checkpoint commits after steps 1, 2, 3, 5 and 7. If the build runs past its estimate, the B-tier items (`shield-harm`,
the +SH ablation, the MH-H→O fork) are dropped first and the prereg records it before F-B.

## 5. Estimates

- Build: about 42 agent-hours in total, about 32 without the B-tier items. No model spend.
- Stage Z compute: about 8–12 CPU-h at `nice -n 15` (9 lineages × 18 worlds × (1 + promotions) runs of 10–20 s,
  twins, exposure, REF-S, R-maint; WC-1 ≤ 6 CPU-h per pass).
- Disk: under 300 MB including gzipped journals of paid arms.

## 6. Build risks and their fallbacks

| Risk | Fallback |
|---|---|
| A sealed or designer edit cannot be stacked with R1 in one transition copy (anchor collision) | the author's brief supplies the R1-edited transition as the base; collisions fail V-3 and go back to the author once |
| P1's code rewrite makes the reference diverge (actors keyed to old codes) | restrict the code rename to reports generated after the effective date; if V-1 still fails, P1 keeps only the policy and fee changes (recorded before F-B) |
| `observer.mjs` needs a constitution registry | call clause C1 with an empty registry; test that C1 verdicts equal OT-0's on two recorded runs |
| The routing arm breaks the host's instance bookkeeping (customer actions that start their own instance) | route by the truth case of the instance's first event (harness-side, not an arm input); V-10 decides |
| Daily prefix evaluation of contracts is too slow | evaluate once per world run with per-violation observation times, checked equal to the prefix method on one world |
| `certify.mjs` is not on main at F-B | import it read-only from `d3bd7acf` (§1); if that is refused, use `stats-ebed.mjs` and label heal verdicts "uncertified (Move 0 pending)" |
| Disk (1.9 GB free at 04:27Z, shared) | the program imports are ≈ 1.3 MB; no journal of a $0 run is kept; `df` before Stage Z and before each paid row; pause below 1.2 GB |
