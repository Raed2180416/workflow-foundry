# Evidence map: is the built workflow good enough in the worst case, and does it detect, adapt and heal as the world changes?

*Written 2026-10-21 about 22:55 UTC from repository evidence only, read at main-tree HEAD `48712cca` plus the read-only
gap-closure worktree `.claude/worktrees/wf_0f86d12b-ab5-2` (branch `worktree-wf_0f86d12b-ab5-2`, commits `e519ca6d` and
`38e42fb7`). Nothing was run and no model was called. `beds/sealed/`, AutomationBench devCheck/test tasks and sealed SOP-Bench
outputs were not read. Every number carries a `file:line` or a run path. Paths are relative to `/home/user/workflow-foundry`
unless they start with `.claude/worktrees/`.*

**The owner's question (2026-10-21), as recorded in `research/decisions-20261021.md:47`:** "Assuming [the router] is met, then
the actual workflow that's created, is it good enough in the worst case and does it adapt and heal as it does real work? Have
we tested its performance as it changes?" Earlier forms are in `research/REQUIREMENTS-COVERAGE-20261021.md:22` (A4) and `:23`
(A5).

**Evidence levels used below**
- **dev-is**: development, in-sample. The seeds were inspected, or the instrument was tuned on them.
- **dev-oos**: development, out of sample. Dev seeds that the author or the tuning never saw.
- **post hoc**: a rule chosen after the data was seen.
- **held-out**: fresh test seeds under a frozen preregistration.
- **sealed**: a separate author, unseen families.

**K** is the number of independent lineages, builds or streams behind a number. **Interim** marks uncommitted data from a run
that is still going. Interim data is reported only so the map is current; it is not a result.

---

## 1. The answer in brief

| # | Dimension | What the repo shows | Strongest number | Level, K | What has never been tested |
|---|---|---|---|---|---|
| 1 | Worst case: adversarial or out-of-profile input, fault worlds, red team | Fault worlds exist only for E8 and are scored. No red team has ever run against a built workflow. Out-of-profile behaviour was seen only as silent misses on drift segments | E8 fault battery: restart and delayed duplicate leave journals identical. A crash after apply collapses 1 of 6 composed builds (ch-e8-2: 23/43 with 26 critical). A same-instant duplicate costs every subject 8 cases on 1161 d2, and only composed builds commit effects twice (`research/composition-20261021/RESULT-COMP1.md:299-301,332,357-363`) | dev-is, K = 3 builds per arm | The J2 defect miner (`research/jit-20261008/PROOF-LEDGER.md:121`). The W-bed R8 fault overlay: its hooks are no-ops and throw if a fault is requested (`beds/wbed/lib/faults.mjs:1-3,38-42`). The red-team pass that D24 asks for (`research/decisions-20261021.md:47`) |
| 2 | Detecting change while running | Guards and deopts fire on drift where static code stays silent. But the in-control deopt and disagreement rate is 25–60%, so every outcome monitor tried fails the bar. The input-profile detector worked only post hoc and in sample | The count rule `recompileOnDeopts: 2` catches 3 of 4 drifts with 8 false alarms in 71 pre-drift tasks. CUSUM catches 0 of 4. The frozen input profile alarms 1 task after the drift with 0 false alarms, post hoc (`research/jit-20261008/DEV-NOTES.md:856-858,883`) | dev-is, K = 1 per arm | The input-profile detector on a held-out family. Detection in any E8, AutomationBench-R or OT-0 stream. Silent misses are not detected: 10–75% of compiled deliveries (`DEV-NOTES.md:526-532`) |
| 3 | Adapting: deopt, recompile, re-plan | Deopt to an interpreter followed by recompile works on records. On kinetics the success comes from the Opus interpreter, not from the compiled path. No re-plan or adaptive sub-workflow has been tested | Records S→H: 22/24, both drift deopts re-solved, 1 recompile (`DEV-NOTES.md:62-70`). R0-K: compiled code delivered 3 of 14 tasks (2 pass); 11 of 11 Opus-delivered tasks passed (`DEV-NOTES.md:1283,1347`) | dev-is, K = 1 | Adaptive in-node sub-workflow creation (`REQUIREMENTS-COVERAGE-20261021.md:23`). Adaptation by any E8-built program. Any run past one drift step |
| 4 | Healing: classify, patch, replay, against retry and regeneration | 10-08: diagnosis 3/3, 2 real fixes, the date-order incident unhealed after 16 attempts, did not beat retry. COMP-1: an announced spec change was patched locally 6/6. FH-1 (interim): the contract-verified heal recovers every failing case on 3 of 4 finished incidents with 0 regressions | 10-08: H-cfx fixed 3/3 against 0/3 (blocked by governance); H-p1 fixed 88/88 on its injected error class; H-rec 0 of 16 (`research/heal-20261008/DESIGN.md:968,978,1013-1020`). COMP-1 M5: 8/8 changed cases, 0 collateral, $0.02–0.05 per patch (`RESULT-COMP1.md:407-424`) | dev-is, K = 1 per incident | Heal on the 6 mined E8 latent defects (`beds/ebed/e8/README.md:168-176`). The retroactive sweep (K5, `PROOF-LEDGER.md:136`). T4a and T4b (`PROOF-LEDGER.md:85-86`). Heal where the change is not announced to the patcher |
| 5 | Performance over time across changes | Only 24-task streams with one drift step have ever run, plus one patched rule change on E8 and one policy change in OT-0. The 80-tick, 5-epoch design has never been run, and none of its items or harness prerequisites exist | Records O→H is oracle-durable only from idx 18, confirmed at idx 23 for $7.53. S→H is durable from idx 3, confirmed at idx 8 for $2.29, then relapses once. H→H and every kinetics arm never become durable in the system view (`DEV-NOTES.md:526-532`) | dev-is, K = 1 | TTD per epoch, maintenance $ per world change, break-even tick, forgetting, heal propagation (`research/replicate-20261008/DESIGN-STREAMS.md:703-729`). All of these are designed only |
| 6 | Against a hand-crafted reference and against an agent on the same stream | Agent comparisons exist on 24-task dev streams and on one 14-case E8 world. No hand-crafted reference has ever run against a built workflow on a stream. No Opus 5.5 xhigh arm has run on any stream | E8 sized world: built 14/14, agent-H + validator 12/14, agent-H 10/14, Opus one-shot build 5/14 (`research/enterprise-20261014/B1-E8-DEV.md:177`; `research/enterprise-20261014/AGENTV-E8-PREREG.md:250`). Records: Opus agent 24/24 at $13.54, JIT S→H 22/24 at $8.99 (`DEV-NOTES.md:428-429`) | dev-is, K = 1 (E8 builds K = 3) | H-best against built (V1–V7, `DESIGN-STREAMS.md:742-753`). The W-bed references against JIT or library arms. Opus xhigh: the only Opus agent stream ran at `agentEffort: null` (`research/jit-20261008/runs/jit-dev-records-1/agent-claude-opus-5-5/arm.json:14`) |
| 7 | Cost of all of it | On flat families verification and compile cost erase the compiled path's advantage over a Haiku agent. E8 builds are cheap once and $0 per world. Patches and heals cost cents | Kinetics JIT $1.29–3.07 per success against the Haiku agent's $0.124 (`DEV-NOTES.md:446-448,444`). R0-K $2.55 against $0.139 per success (`:1282-1283`). E8 build $0.39–1.73, then $0 per world (`RESULT-COMP1.md:438-455`) | dev-is, K = 1 | Maintenance $ per change over a long stream. The W cost of a wrong delivery (K11, `PROOF-LEDGER.md:142`). Opus xhigh cost on the same streams |

**Bottom line.** The repository holds strong instruments and many partial, development-level pieces. It does not hold a test
of the owner's question as asked. No long, multi-change stream has run; no red team has run; no held-out or sealed number
exists for any dimension; and no built workflow has been compared with a hand-crafted reference or with Opus xhigh over the
same changing stream. D24 (`research/decisions-20261021.md:47`) records exactly this as the reason for PREREG-DUR-1.

---

## 2. Coverage matrix (bed and workflow type × dimension)

Codes:
- **M**: measured with a number.
- **m**: measured, but tiny or confounded.
- **B**: instrument built and tested at $0; no arm run.
- **D**: design only.
- **I**: interim, still running.
- **—**: nothing.

The section numbers point to the detail.

| Bed / workflow type | 1 worst | 2 detect | 3 adapt | 4 heal | 5 over time | 6 vs ref / agent | 7 cost |
|---|---|---|---|---|---|---|---|
| records: JIT compiled solvers (S→H, O→H, H→H) | m (silent misses §3) | M §4 | M §5 | m (recompile = heal, §6) | M, 24 tasks, 1 drift §7 | M agent; — ref §8 | M §9 |
| kinetics: JIT (dev stream, R0-K) | m §3 | M §4 | M §5 | m §6 | M, partial §7 | M agent §8 | M §9 |
| records: static C0 solver | m (silent 6 of 8 after drift) | M (never signals) | — | — | M §7 | M §8 | M §9 |
| C0/P1 Foundry IR workflows (10-08 heal incidents) | m (latent lucky passes) | M (fragility, vacuity) | — | M §6 | — | — | M §9 |
| W-bed R1/R3 Opus-written references (arm c) | m (OOS silent miss) | m (deopt `names-read`) | — | — | — | B (frozen, never compared) | — |
| W-bed R4/R5/R3′/R6 beds | B (R5 verify, R3′ planted) | m (R4 profile false refusals) | — | B (R3′ impact) | — | — | — |
| E8 monolith builds (B1L-H, B1N-H; B1-O one shot) | M (fault battery) | — | — (static) | M (N-version repair) | m (in-world epochs, pooled) | M agent §8 | M §9 |
| E8 composed builds (C-H, C-H-T; COMP-1) | M (fault battery) | — | — | M (announced drift patch) | m (1 change) | — | M §9 |
| E8 failure handling (FH-1: H-C, H-N, H-0, R, G) | — | B (contracts as verifier) | — | I §6 | — | — | I §9 |
| E8 constitution layer (OT-0: W-blind, W-S shield, G, W-C) | m (planted malicious change refused) | M (observer, auditor) | M (shield pins the version) | — | m (1 policy change, day 7) | I (agent arms re-running) | m §9 |
| E8 latent defects (mined) | B (6 defects, 16 revealing events) | B | — | B (never run) | — | — | — |
| Library cards P01–P60 | B (drift fixtures deopt) | B | — | B (`sweep.mjs`) | — | — | — |
| AutomationBench-R (12 families) | B (bad controls) | — | — | — | B (week streams, $0 reference only) | D (agent-O, wf-H designed) | D |
| SOP-Bench (build once, run many) | — (no change dimension) | — | — | — | — | sealed run in flight (§8) | — |
| AutomationBench dev60 harness arms | — (one-shot) | — | — | — | — | M one-shot, not a stream | — |
| RS items (n8n 13115/20421/12285) and R-bench pilots | — | — | — | — | D (80 ticks, never built) | D (H-best) | D |
| E7 ITSM/SLA bed | B (edition switch at d4) | — | — | — | — | — | — |
| Engine and orchestration runtime (chaos suite) | M (kill -9, 16 kills) | — | — | — | — | — | — |

---

## 3. (1) Worst case: adversarial or out-of-profile inputs, fault worlds, red team

| Bed / workflow | Number | Level, K | Source | Untested |
|---|---|---|---|---|
| **E8 composed builds, fault battery** (worlds 1161 d2, 1162 d3, 1164 d5) | **M4a restart:** every journal identical to its fault-free run.<br>**M4b crash after apply:** no double effect; 5 of 6 builds lose 0–3 cases; **ch-e8-2 collapses** (23/43 on 1161; 26, 33 and 54 critical on the three worlds).<br>**M4c delayed duplicate:** identical.<br>**M4d same-instant duplicate:** every subject loses 8 on 1161; composed builds lose 11–14 on 1164 against 10–11 for monoliths; only composed builds commit effects twice (status writes, `cancel-refused` notices, no money).<br>**M4e downstream failure after an effect:** 3 of 6 composed builds complete every compensation everywhere | dev-is, K = 3 per arm | `RESULT-COMP1.md:273-363` (table `:319-350`) | Faults at held-out worlds. Combined faults. Faults across a long stream |
| **E8 monoliths**, same battery | B1L-H l1 and B1N-H l2/l3 lose 0–2 cases under crash. M4d: 35/43 on 1161 (−8). M4e: B1L-H l1 leaves 3/27, 2/34 and 3/41 compensations incomplete | dev-is, K = 3 | `RESULT-COMP1.md:347-355,366,373` | as above |
| **E8 bed controls** (attack worlds 1211–1214) | Every bad and gaming control fails every attack world. Necessity controls fail 57–100% of their targets. `c-oss`, the literal port of the hand-crafted Temporal reference app, fails 52–59% of completed cases and leaves orphaned charges | dev-is | `beds/ebed/e8/README.md:80-96` | This validates the oracle. It says nothing about a built workflow |
| **E8 one-shot builds** | B1-H (Haiku, one shot) 0%. B1-O (Opus, one shot) 281/1,022 (27.5%) with 820 arm errors; batch op keyed at the batch | dev-is, K = 1 | `PROOF-LEDGER.md:165`; `B1-E8-DEV.md:104,117` | — |
| **OT-0: planted malicious constitution change** (v3, day 9: T = €1,000,000 and the proposer grants itself `controller`) | The registry gate refuses it with six reasons | dev-is, n = 1 | `research/org-20261021/README.md:31` | An arm's own C3 judgement (W-C, A-HV, A-F) (`README.md:328`) |
| **JIT records: silent misses on drift** | Static C0: 14/16 at d3, then 2/8 at d4, never signalled.<br>Opus v2 recompile (heal widened a guard): wrong on 6 of 8 d4 tasks in the offline N-version probe.<br>N-version common mode: s214 wrong in 2 independent lineages | dev-is, K = 1 | `DEV-NOTES.md:25-27` (D5); `:51-60` (D9 and erratum); `:37-50` (D8) | — |
| **JIT kinetics** | Silent-miss share of compiled deliveries: H→H 40% (2/5), O→H 10% (1/10), S→H 75% (3/4).<br>R0-K: 1 of 3 compiled deliveries a silent miss (idx 6, 0.893), shipped because adjudication was unresolved | dev-is, K = 1 | `DEV-NOTES.md:530-532,1297,1325` | d5 drift for R0-K (0 of 8 tasks run, `:1419`) |
| **W-bed hand-crafted references**, out of sample (dev 313–324) | R1 34/36 (d4 10/12): 320 d4 deopts `names-read`; **322 d4 is a silent wrong answer** from typo'd name particles outside the fixed list. R3 36/36 | dev-oos, K = 1 | `beds/wbed/references/README.md:166-176`; `PROOF-LEDGER.md:41` | Live judges. A paid run. Streams |
| **Run-time invariance contracts (K4)** | Records `in` relation: **0 of 18** wrong compiled answers flagged, 9 pending; 0 of 37 right answers flagged. Kinetics: 0 of 6 flagged, 6 pending | dev-is, K = 1 | `PROOF-LEDGER.md:135` | The paid part (≤ $10): pending variants with judges replayed; a fresh dev range |
| **Witness coverage (K3)** | Oracle-free witness recall on bad controls: records none 0/168; R3 conservation 72/174; R5 hash-total 144/282 (all 72 decode mistakes). Kinetics count check flags 0 of 6 wrong archived answers | dev-is | `PROOF-LEDGER.md:134` | — |
| **W-bed R5 verify predicate** | 0 misses in 1,100 + 400 wrong decodes (16 misses out of 1,100 without hash totals) | dev-is | `PROOF-LEDGER.md:36`; `DEV-NOTES.md:383-386` | With a built agent node |
| **AST guard diff (A3)** | 10 of 12 hand-written mutants flagged, 0 of 10 refactors. The missed phone-linking mutant drops passes from 15 to 6 | dev-is (mutants by the tool's author) | `DEV-NOTES.md:327-331` | False-alarm rate on real recompiles (`PROOF-LEDGER.md:17`) |
| **Library cards** | 15 cards × {positive, no-match, drift} fixtures. Every drift fixture deopts with its expected kind (36/36 for the first 12 cards) | B, $0 stubs | `PROOF-LEDGER.md:63`; `experiments/library/cards/*/fixtures/drift.json` | With live judges or a built solver |
| **W-bed triviality/necessity attacks** | Dry-run driver only | B | `PROOF-LEDGER.md:42`; `beds/wbed/attacks/triviality.mjs` | Paid one-call attacks |
| **W-bed R3′ planted-defect bed** | Exact manifest; 17 controls fail (0/80) | B | `PROOF-LEDGER.md:124`; `beds/wbed/r3p/` | Every paid gate; the J4 stream |
| **W-bed R8 fault overlay** (schema drift, tool failure, adversarial content) | Hooks are wired and no-op; a fault request throws. Schedule designed: idx 5, 6, 9, 11, 13, 17, 20 | D/B | `beds/wbed/lib/faults.mjs:1-42`; `PROOF-LEDGER.md:39` | Everything |
| **Defect miner red team (J2)** | Not started | — | `PROOF-LEDGER.md:121` | Everything |
| **Engine and orchestration runtime** | Chaos 20/43 on the tree as it is, 32/43 with patches 01–09 (not landed). kill -9 at random points resumes with each effect once (B1, 16 kills, 3 seeds) | dev, Linux | `PROOF-LEDGER.md:203`; `research/orch-20261021/WORST-CASE.md:45` | macOS and no-/proc hosts; runtime faults inside a built workflow's stream |

**What is never measured:** the worst case of a *built* workflow under a search for breaking inputs. Every number above uses
designed controls or naturally occurring drift. ATTACK J2 and the D24 red-team pass are both unrun.

---

## 4. (2) Detecting change and drift while running

| Detector | Number | Level, K | Source | Untested |
|---|---|---|---|---|
| **Guards → deopt** (JIT) | Records: the JIT guards fired on their first d4 tasks (S→H deopts on #16 and #17, both re-solved correctly). Static C0 never signalled (2/8 at d4) | dev-is, K = 1 | `DEV-NOTES.md:25-27` (D5) | Held-out drift |
| **Deopt rates** (system view; in-control noise) | Records deopt rate: S→H 10%, O→H 10%, H→H 19%.<br>Kinetics deopt rate: H→H 44%, O→H 38%, S→H 60% (all guard).<br>R0-K deopt rate: 55% (guard 45%) | dev-is, K = 1 | `DEV-NOTES.md:526-532,1297` | — |
| **Count rule `recompileOnDeopts: 2`** (shipped default, `experiments/jit/stream.mjs:39`) | 3 of 4 drifts detected (delays 0, 1, 0). **8 false alarms** in 71 pre-drift tasks (expected 7.1) | dev-is, K = 1 | `DEV-NOTES.md:856-858` | — |
| **Risk-adjusted CUSUM (K15)** | At ARL0 500: **0 of 4** drifts detected, 0 false alarms. No h meets both halves; 20 sensitivity variants all give 0 alarms. Verdict: **N, keep the count rule** | dev-is, K = 1 | `DEV-NOTES.md:826-906`; `PROOF-LEDGER.md:146`; `experiments/jit/cusum.mjs` | — |
| **Frozen input profile as a detector** (2 novel tasks in a row) | Alarms 1 task after the drift in both families, 0 false alarms. At 1 novel task: delay 0, with 0 false alarms in records and 2 in kinetics. Profile replay: records 0/13 d3 false alarms and 8/8 d4 flagged; kinetics 2/13 d4 false alarms and 8/8 d5 flagged | **post hoc, in-sample** (PARAMS set on these streams; records signal is size-only) | `DEV-NOTES.md:883-893,472`; `experiments/jit/profile.mjs:416,476` | **A frozen test on a held-out family with a drift segment** (`DEV-NOTES.md:904-905`) |
| **Profile as a refusal gate** (W-bed R4, slice 1) | False refusals of in-profile children: 5 of 18 (d3), 13 of 24 (d4). The slice-2a tolerant profile (K8) has not been tested out of sample | dev-is | `PROOF-LEDGER.md:35,139` | K8 |
| **Shadows plus adjudication** | Records S→H: 2 of 4 shadows disagreed, both adjudications picked the correct compiled answer. R0-K: 100% effective shadow rate; 3 of 5 disagreed; 2 were **false regressions at relTol 0.05** (correct–correct pairs 0.085 and 0.074 apart), costing $6.65 (20% of the arm). One unresolved adjudication shipped a wrong compiled answer | dev-is, K = 1 | `DEV-NOTES.md:64,1295,1325-1328,1393` | An order-independent majority rule (`DEV-NOTES.md:284-291`, D16, `test.todo`) |
| **N-version disagreement** | Records probe: 11 of 13 disagreements contained a correct answer. Unanimity was wrong in common mode on s214. E8 9-build ensemble on practice worlds: precision 0.609, recall 0.354, **0 of 92** go-live orders | dev-is | `DEV-NOTES.md:37-50`; `.claude/worktrees/wf_0f86d12b-ab5-2/research/heal-20261021/PREREG-FH1.md:88-97` (branch commit `38e42fb7`) | — |
| **E8 capability contracts** (13, written from SPEC-E) | On practice worlds against the oracle: precision 1.000, recall 1.000 (158 failing orders; 92/92 go-live) | dev-is | `PREREG-FH1.md:90` (branch) | A family without a shipped test suite (`PREREG-FH1.md:199-201`) |
| **Heal-kit oracle-free signals** (C0/P1) | **Fragility:** flipping one field of the global read changes 8.5–48% of the answer.<br>**Check vacuity:** 59 of 90 status judgments are unconstrained.<br>**Cost outlier:** 2–4× the other runs.<br>All three found latent defects on runs that *passed* | dev-is | `research/heal-20261008/DESIGN.md:35-40` | On a stream |
| **OT-0 observer** (OCEL log → clauses C1–C3) | 0 observer-only disagreements over 186 runs and 21,780 cases. **W-S shield:** auditor Q1–Q4 45/45, Q5 36/45. The stale-window measure shows blind builds handling all 28 orders of the post-change band under the old threshold | dev-is | `research/org-20261021/README.md:62-88,103-119,178` | The agent arms (re-running; read only) |
| **AutomationBench-R** | No detector in any family run | — | — | — |

**Reading.** The shipped detector, the count rule, catches drift but cannot stay quiet: while deopts fire on 25–60% of
tasks, nothing based on outcome events meets "≤ 1 false alarm per segment, ≤ 4-task delay" (`DEV-NOTES.md:901-903`). The only
promising detector watches inputs, not outcomes, and it was found post hoc. Silent wrong answers (§3) are invisible to every
deployed detector except a shadow that happens to be drawn.

---

## 5. (3) Adapting: deopt, recompile, re-plan

| Bed / workflow | Number | Level, K | Source | Untested |
|---|---|---|---|---|
| **Records JIT S→H** | 22/24 (d3 14/16, d4 8/8).<br>Delivered by: compiled 19 (17 pass), interpreter 5 (5 pass, warmup plus 2 drift deopts).<br>1 recompile after the drift deopts: the Haiku attempt was rejected and the Opus fallback adopted | dev-is, K = 1 | `DEV-NOTES.md:62-70`; `:429` | — |
| **Records JIT O→H** | 18/24.<br>v1 deopted on an over-strict judge check; the recompile to v2 healed it (D3). v2 widened a guard, and v3's silent misses followed (D9, D12 errata) | dev-is, K = 1 | `DEV-NOTES.md:17-19,98-116,430` | — |
| **Records JIT H→H** | 14/24 at $8.12, against the Haiku agent's 15/24 at $2.46. v4, from a regression-driven recompile at idx 19, passed 4 of 5. 50% silent misses | dev-is, K = 1 | `DEV-NOTES.md:433,454-456,560` | — |
| **Kinetics JIT** (dev stream) | O→H 17/19; the d5 drift brought guard deopts on all three d5 tasks, none with a compiled answer.<br>Compiles: Haiku accepted 1 of 9 (confounded by exact comparison).<br>The Opus fallback produced no new version on H→H (2 rejected, $9.23) | dev-is, K = 1, partial | `DEV-NOTES.md:447,478-487,534-536` | The d5 segment for H→H and S→H (never reached, `:539-556`) |
| **R0-K kinetics O→H** (kit E1c, prompt v4, tolerant compare, strict acceptance) | 8 compile attempts gave 6 versions in 14 tasks (5 recompiles). **Compiled code delivered 3 tasks (2 pass)**; Opus delivered 11, all pass. "The gap is mostly model strength, not mechanism" | dev-is, K = 1 | `DEV-NOTES.md:1283,1293,1347-1351,1408-1419` | d5, K = 2, held-out (`:1419`) |
| **Domain preservation on recompile (v2.2, #41)** | Built; `experiments/jit/test/refusals.test.mjs` | B | `DEV-NOTES.md:56-60` (the D9 consequence) | Its effect on a drift stream |
| **E8 built programs** | Static: they adapt only through what the code already handles. SPEC-E declares the editions (R1.3) and the field-rename error (`beds/ebed/e8/spec/SPEC-E.md:120-122,175-176`). The d5 F5 rename is one incident class (ch-e8-3) | dev-is | `PREREG-FH1.md:44,59` (branch) | Unannounced change |
| **OT-0 W-S shield** | Pins each order to the constitution version in force at placement. The post-change band runs under T₂, 0 of 28 stale (blind builds: 28 of 28 stale) | dev-is | `research/org-20261021/README.md:103-104` | — |
| **Adaptive in-node sub-workflow creation** | Never tested | — | `REQUIREMENTS-COVERAGE-20261021.md:23` | Everything |
| **`flow.plan` bounded runtime dynamism** | Design only | D | `PROOF-LEDGER.md:54` | Everything |

---

## 6. (4) Healing: classify, patch, replay; against retry and regeneration

### 6.1 Auto-heal on IR workflows, 2026-10-08 (C0 and P1 incidents)

All seeds were already inspected. Evidence is dev-is, K = 1 per incident. Spend: $6.414775 over 399 ledger lines; the
campaign total, including the review, is $6.50 (`research/heal-20261008/DESIGN.md:994`).

| Incident | Diagnosis (localisation, $0) | Heal | Retry (recorded) | Source |
|---|---|---|---|---|
| H-rec (records date order, `conf` global read) | Correct: root `conf`, class `UNGUARDED_GLOBAL_READ` (1 of 24 flips fixes it) | **Not healed:** 0 valid of 16 candidates over 4 runs × 4 rounds (3 invalid ops, 3 leak rejects, 8 V3 failures, 1 V1, 1 pending). The closed op grammar cannot write a per-row guard | 0/4, with the workflow's own verdict `pass` 4/4 | `DESIGN.md:978,1025-1027,944`; `PREREG-FH1.md:21` (branch) |
| H-cfx (codefix over-strict check) | Correct: `check1` + `check2`, `OVERSTRICT_CHECK` + `CHECK_VETO_ROUTING` | **2 real fixes** (Haiku, Opus): 3/3 against 0/3, 8/8 regressions pass, cost ratio 0.588. The wrong-default stratum: base 1/3, healed 3/3. **Blocked** by governance (lint debt; relax goes to owner review). The Sonnet candidate fails a new mutant | 0 (deterministic) | `DESIGN.md:968-972,1002,1021-1024` |
| H-p1 (status read, escape hatch) | Correct: `statuses`, `CHECK_ESCAPE_HATCH` | Promoted v3 (k-sample agreement). On the injected error class: parent 0/88, healed 88/88, +15% cost. On the natural pass rate it ties (8/8 against 8/8) | 8/8 | `DESIGN.md:973-975,1013-1020,944` |
| Lint-debt heads (H-rec v2, H-p1 v2) | — | Promoted, but they **fix nothing**: their acceptance rejects 2 of 14 and 4 of 14 bad controls | — | `DESIGN.md:976-977` |

**Why it did not beat retry**, root-caused on the gap-closure branch: H-p1 was a misrouted variance incident; in H-rec
the verifier had zero precision on the failure and the patch scope was too narrow; H-cfx was a governance block on a real
fix (`PREREG-FH1.md:18-27`, branch commit `38e42fb7`). The documented summary is in `docs/RESEARCH.md:117`.

**Heal-kit block and unblock.** On the main tree the kit has refused the live policy since 10-15 (`HEAL_POLICY_DRIFT`), and 66
heal tests skip (`README.md:362`). D20 on the branch decides it: `defaultsByRole` is proved unread, and the class budgets get an
envelope proof. All 2,631 recorded replay keys are unchanged, and the heal suite runs 98 tests with 0 skipped (commit
`e519ca6d`, `experiments/heal/kit.mjs`, `experiments/heal/d20-proof.mjs`). It is not merged into main.

### 6.2 E8 N-version repair (B1N-H) and the announced-drift patch (COMP-1 M5)

| Bed / workflow | Number | Level, K | Source | Caveat |
|---|---|---|---|---|
| **B1N-H**: N-version disagreement repair, no oracle | b1lh-e8-2 974 → 1,022/1,022 ($0.11); b1lh-e8-3 1,015 → 1,022/1,022 ($0.05). The 3-build ensemble had the majority right | dev-is, K = 2 repairs | `B1-E8-DEV.md:146-148` | With 9 builds, 7 share the go-live miss, so the majority is wrong there (`PREREG-FH1.md:116-122`) |
| **COMP-1 M5**: drift D1 `review-timeout-clears` (rule R2.2) | All 6 composed programs pass 8/8 drift-changed cases after one patch session and change no other case. $0.019–0.046 per patch, 1.7–3.6 min. 4 of 6 patches confined to the owner module | dev-is, K = 6 programs, 8 cases on 2 worlds | `RESULT-COMP1.md:387-436` (table `:407-412`) | **The patcher was told the changed passages, before and after** (`:120-125`). This is maintenance on an announced change, not detection. There is no monolith drift row (`:160-164`) |

### 6.3 FH-1: classify → intervene → patch → replay, against retry (R) and regeneration (G), with the verifier as the factor

**Frozen** at `38e42fb7` (branch). Development, Haiku 5.5 only, ≤ $5. The frozen file is
`.claude/worktrees/wf_0f86d12b-ab5-2/research/heal-20261021/PREREG-FH1.md`.

**Measured before the freeze ($0):**
- **Retry (R)** recovers **0**: a second execution gives byte-identical journals on all 11 builds × 12 worlds (`PREREG-FH1.md:66-67`).
- **Regeneration (G)**, leave-one-out over recorded peers: E[net] **+27.5** of 475 failing cases, with E[regressed] 279.5,
  at E[$] 8.07 (`:69-82`).
- **Verifiers on the practice worlds:** the 13 contracts have precision and recall 1.000; the 9-build N-version verifier has
  precision 0.609 and recall 0.354, and 0 of 92 on go-live (`:84-97`).

**Interim, uncommitted.** The run is still going. These are the run records in
`.claude/worktrees/wf_0f86d12b-ab5-2/research/heal-20261021/fh1/runs/*/record.json`, read at 22:51 UTC.
`RESULT-FH1.md` is still a template with placeholders.

| Incident (failing cases) | H-C (contracts): kept net, $ | H-0 (no verifier): kept net, $ | H-N (N-version): kept net, $ |
|---|---|---|---|
| ch-e8-1 (48) | **+48 / −0**, 974 → 1,022, $0.069 | 0, $0.232 | no signal, no session, $0 |
| ch-e8-2 (67) | **+67 / −0**, 955 → 1,022, $0.205 | 0, $0.170 | no signal, $0 |
| ch-e8-3 (136) | +18 / −0, 886 → 904, $0.397 | **+118 / −0**, 886 → 1,004, $0.320 | rejected ("no disagreement resolved"), $0.323 |
| cht-e8-1 (19) | **+19 / −0**, 1,003 → 1,022, $0.036 | not yet | unchanged, $0.166 |
| cht-e8-2 (48) | session running | not yet | no signal, $0 |
| cht-e8-3 (102) | not yet | not yet | +54 / −0, 920 → 974, $0.047 |
| b1lh-e8-2 (48) | not yet | not yet | no signal, $0 |
| b1lh-e8-3 (7) | not yet | not yet | unchanged, $0.067 |

- **Spend so far:** $2.065 over 12 ended sessions (`fh1/spend.jsonl`).
- **Not yet decided:** the frozen rules H1 (against G), H1b (against R) and H2 (verifier precision) (`PREREG-FH1.md:167-178`).
- **Two signals to watch:** the no-verifier arm beat H-C on ch-e8-3 (+118 against +18), and H-N has acted on 3 of 8
  incidents.

### 6.4 Heal instruments built but never run on a heal

| Instrument | What it can do | Status | Source |
|---|---|---|---|
| E8 mined latent defects | 310 reference mutants yield 10 latent mutants, 7 behaviours and **6 admitted defects**, with 16 true and 16 false revealing events in ep2–ep3 and exact sweep manifests | B; L4 is D | `beds/ebed/e8/README.md:150-200`; `PROOF-LEDGER.md:167` |
| Retroactive sweep | Re-executes past inputs on the fixed version, marks suspect callers and relabels judgments | B (`experiments/library/sweep.mjs`, `test/sweep.test.mjs`); K5 not run | `PROOF-LEDGER.md:86,136` |
| T4a drift test, T4b planted-defect test | — | D | `PROOF-LEDGER.md:85-86,113` |
| W-bed R3′ impact | Affected and unaffected callers with exact `wrong` flags | B | `PROOF-LEDGER.md:136`; `beds/wbed/r3p/impact.mjs` |

---

## 7. (5) Performance over time across changes

### 7.1 What has actually run as a stream

| Stream | Shape | Result over time | Level, K | Source |
|---|---|---|---|---|
| `jit-dev-records-1` | 24 tasks; d3 idx 0–15, **one drift step** to d4 at idx 16 | Durability (W = 6, ≥ 0.8), listed as oracle-view from / confirmed ($ cumulative):<br>S→H 3 / 8 ($2.29), 1 relapse, system view does not hold.<br>O→H 18 / 23 ($7.53), knowable only at the end.<br>H→H never.<br>Static C0: not durable (0 / 5, relapse).<br>Silent miss: S→H 11%, O→H 33%, H→H 50%, static 33% | dev-is, K = 1 | `DEV-NOTES.md:516-538`; `research/jit-20261008/analysis/cloud-dev-final/durability-jit-dev-records-1.md` |
| `jit-dev-kinetics-1` | 24 tasks planned, d4 then d5 at idx 16; JIT arms stopped by the usage limit (H→H 12, O→H 19, S→H 13 tasks) | O→H oracle-durable idx 9–14 (v2), ended by a silent miss and the d5 drift; system view never; H→H and S→H never | dev-is, K = 1, partial | `DEV-NOTES.md:530-538,539-556` |
| `jit-r0-kinetics` (R0-K) | 24 planned; O→H stopped at its cap at 14 (all d4) | Never durable (6 versions over 14 rows: 2, 3, 1, 1, 3, 1) | dev-is, K = 1 | `DEV-NOTES.md:1297`; `analysis/r0k/durability-jit-r0-kinetics.md` |
| `jit-r0-records` (laptop) | Agent 24/24 done; JIT H/H stopped by the owner pause at 12/24 (all d3) | "Nothing here is evidence"; no paired read. Committed rows: agent 14/24 at $2.49; JIT 9/12 at $6.62 | none | `DEV-NOTES.md:378-386`; `research/jit-20261008/runs/jit-r0-records/*/results.jsonl` |
| E8 worlds (14 business days, epochs ep0–ep4; new carrier from epoch 1 at d3+; edition switch at d4; F5 field rename at d5) | Closed loop with carry, but graded pooled per world, not per epoch over time | Static builds reach 1,022/1,022 pooled (B1L-H l1, B1N-H) | dev-is, K = 3 | `beds/ebed/e8/README.md:43-49,75-78`; `B1-E8-DEV.md:127-129` |
| COMP-1 drift D1 | One rule change on 2 drifted worlds | 6/6 patched locally (§6.2) | dev-is | `RESULT-COMP1.md:387-436` |
| OT-0 | One policy change (T₁ €500 → T₂ €250 on day 7) plus one planted change (day 9) | Blind builds: 57 refunds above T without approval and 28 of 28 stale. W-S shield: 0 and 0 (§4) | dev-is | `research/org-20261021/README.md:31,103-119,207` |

### 7.2 Designed but never run

**DESIGN-STREAMS** (`research/replicate-20261008/DESIGN-STREAMS.md`):
- **Shape:** 80 ticks in five epochs (E0 base, E1 flaw families, E2 sealed format drift, E3a world change, E3b with a 0–15% fault ramp, E4 revert) (`:229-241`).
- **Mode:** closed-loop carry (`:243-266`).
- **Metrics:** TTD per epoch, held rate, ss$, maintenance$_e, break-even tick, forgetting, heal_propagation (`:675-729`).
- **Verdicts:** V1–V7 and V-H (`:742-753`).
- **Cost:** minimum programme ≈ $500–980 (`:1048-1087`).
- **Status:** its prereg is "DRAFT, not frozen … no RS world has been generated or run" (`PREREG-STREAMS-draft.md:1-4`).
- **Missing pieces:** none of the harness prerequisites P1–P16 exist (`DESIGN-STREAMS.md:986-1007`). `experiments/replicate/streams/` is absent, and `normalizeConfig` still maps `staticFallback: null` to Haiku (`experiments/jit/stream.mjs:336`; this is P2 / G1).

**Other designs:**

| Design | What it would measure | Status | Source |
|---|---|---|---|
| E-bed L3 | Durability under drift; time-to-durable within 8 business days; ≥ 0.75 of sealed drift families | D | `PROOF-LEDGER.md:166` |
| W-bed slice 1 | Includes a second-half drift segment, idx 12–23 | DRAFT, not frozen | `research/jit-20261008/PREREG-WBED-SLICE1.md:1,179` |
| `jit-stream-1` held-out stream A11 (seeds 8001+ / 8101+) | — | DRAFT, H1 cost claim withdrawn | `research/jit-20261008/PREREG-stream.md:1-6`; `PROOF-LEDGER.md:25` |
| AutomationBench-R week streams | 20–60 triggers with carry; a drift re-check block (need-heldout 8837–8840) | Families built at $0; reference only; no arm run | `research/automationbench-20261014/RECURRING-DESIGN.md:28-33,421-433`; `experiments/autobench/families/abr-ops-slawatch/README.md:164-200` |

**Never measured, anywhere:**
- performance across more than one change in a single stream;
- maintenance $ per world change, except the single announced E8 patch;
- TTD per epoch;
- forgetting;
- heal propagation across entrypoints;
- the break-even tick against an agent or a reference.

---

## 8. (6) Against a hand-crafted reference and against an agent over the same stream

### 8.1 Hand-crafted reference

| Reference | What exists | Compared with a built workflow on a stream? | Source |
|---|---|---|---|
| W-bed R1/R3 Opus-written references (arm c), frozen by sha256 | In sample 36/36 and 36/36. Out of sample R1 34/36 (1 deopt, 1 silent wrong), R3 36/36. The one revision is spent | **No.** Any paid run is report-only on unseen dev seeds | `beds/wbed/references/FROZEN.json`; `beds/wbed/references/README.md:136-176`; `PROOF-LEDGER.md:41` |
| RS items: n8n 13115 (126 nodes), 20421 (340 nodes), 12285 (68 nodes) as H-best | Pins and node counts only | **No.** Never built | `DESIGN-STREAMS.md:111-162`; `PREREG-STREAMS-draft.md:1-4` |
| R-bench pilots (5 real user-built workflows) | Conformance works at τ = 1 only. The corpus has too few oracle families, so the **kill rule fired** | No | `DEV-NOTES.md:333-342` (D21); `PROOF-LEDGER.md:44` |
| E8 `c-oss`, a literal port of Temporal's reference app | Fails 52–59% of completed cases | As a bed control only. SPEC-E asks for more than the upstream app implements, so this is not a fair "human vs built" comparison | `beds/ebed/e8/README.md:94-96` |
| E8 reference policy | It *is* the oracle core (100% by construction). The built monoliths equal it on dev grading worlds (1,022/1,022) | Static, pooled; not over a changing stream | `beds/ebed/e8/README.md:75-78`; `B1-E8-DEV.md:80,127` |

### 8.2 Agent on the same stream or world

| Bed | Agent | Built / JIT | Level, K | Source |
|---|---|---|---|---|
| Records dev stream (24) | Opus agent 24/24 ($13.54, effort default); Sonnet 13/24 ($7.05); Haiku 15/24 ($2.46) | JIT S→H 22/24 ($8.99); O→H 18/24 ($7.53); H→H 14/24 ($8.12); static 16/24 ($1.21) | dev-is, K = 1 | `DEV-NOTES.md:428-433` |
| Kinetics dev stream | Haiku 17/24 ($2.10); Sonnet 17/24 ($7.40); no Opus agent | O→H 17/19 (+4 against Haiku on shared tasks, McNemar 4/0, p = 0.125). No JIT arm reaches break-even | dev-is, K = 1, partial | `DEV-NOTES.md:444-452` |
| R0-K kinetics | Haiku agent 15/24 ($2.09); 7/14 on the shared tasks | O→H 13/14 ($33.18, 39× the spend); McNemar 7 against 1, p = 0.070 | dev-is, K = 1 | `DEV-NOTES.md:1282-1351` |
| E8 sized world 1232 d2 s12 (14 cases) | agent-H 10/14 ($1.45, about 1.5 h; 27 invalid outputs); agent-H + validator 12/14 ($1.85 metered) | Built 14/14 each (B1L-H l1, B1N-H l2/l3); B1-O one shot 5/14. A full world takes the agent about 7 h | dev-is, n = 14 (p = 0.125) | `B1-E8-DEV.md:160-194`; `AGENTV-E8-PREREG.md:238-275` |
| OT-0 agent arms (A-HV Haiku + validator, A-F Sonnet, A-F Opus) | The first runs are **void** (session limit); re-runs `*-r1` are in progress | W-C constitution-aware builds: E8 712/1,036, 933/1,036 and **21/1,036** (raw, unanalysed) | interim | `research/org-20261021/runs/void-20261021/VOID.md:1-12`; `research/org-20261021/runs/wc-e8-{1,2,3}/result.json` |
| Opus 5.5 xhigh | **Never run on any stream.** D19 makes it the frontier comparator, queued after the SOP-Bench sealed run | — | — | `research/decisions-20261021.md:43` |
| AutomationBench dev60 | One-shot tasks, not a changing stream (the A1-C Mercury arm 29/60, equal to Sonnet + A1 at 28/60) | — | dev-is | `PROOF-LEDGER.md:201` |

---

## 9. (7) Cost

| Item | $ | Level | Source |
|---|---|---|---|
| Records dev stream, all arms | Opus agent 13.54; JIT S→H 8.99 (compile 4.83 = 54%; pure compiled run $0.0425); O→H 7.53; H→H 8.12 (2.00 imputed); Haiku agent 2.46; Sonnet agent 7.05; static C0 1.21 | dev-is | `DEV-NOTES.md:62-70,428-433` |
| Kinetics dev stream, JIT arms | $64.13 in all, compiles $48.01 (75%), 7.0–8.7× the Haiku agent's whole stream; $/success O→H 1.29, H→H 2.58, S→H 3.07, against Haiku agent 0.124 and Sonnet agent 0.435 | dev-is | `DEV-NOTES.md:444-448,466-469,488-490` |
| R0-K | Agent $2.086 ($0.139 per success). O→H $33.175: compile $24.957 (75.2%), verification $3.362, post-warmup $0.637 per task excluding compile against the agent's $0.087. Projected 24-task total $39.5–65.9 | dev-is | `DEV-NOTES.md:1282-1298,1358-1360,1391` |
| Priced verification (K2/M2) | At the 25% shadow floor the engine as built costs S→H $0.1805 and O→H $0.2183 per task on records, against $0.1027 for the Haiku agent: **the H1 cost claim against the Haiku agent is withdrawn**. On flat families a compiled workflow has no cost advantage once verification is priced | dev-is | `PROOF-LEDGER.md:133`; `DEV-NOTES.md:908-911` (D30) |
| Kinetics comparator gauge (Stage B) | $4.49 | dev | `DEV-NOTES.md:354-357` |
| N-version records probe | $2.50 | dev | `DEV-NOTES.md:37-39` |
| Auto-heal 10-08 | $6.414775 (H-rec 3.11, H-cfx 2.03, H-p1 0.61, retry controls 0.58) | dev | `research/heal-20261008/DESIGN.md:994-995` |
| E8 builds | B1L-H $0.39 / 0.62 / 0.53; B1N-H repairs $0.11 / 0.05; B1-O $7.63; then **$0 per world** | dev | `B1-E8-DEV.md:80,104,127-129,146-148` |
| COMP-1 | $10.77 in all: templates 3.50, C-H 3.12, C-H-T 3.97, **6 drift patches $0.18**. A composed build costs 2–2.6× a monolith | dev | `RESULT-COMP1.md:438-455` |
| E8 agent arms | agent-H $1.45 per 14-case world (plus $1.88 and $1.63 for incomplete full-world runs); agent-H + V $1.85 | dev | `B1-E8-DEV.md:166,177`; `AGENTV-E8-PREREG.md:250` |
| FH-1 | $2.065 so far, interim; G's expected cost $8.07; R $0 | interim | `fh1/spend.jsonl` (branch worktree); `PREREG-FH1.md:82` |
| OT-0 W-C builds | $0.36, $0.64, $1.56; void agent arms $0.46 | dev | `research/org-20261021/runs/wc-e8-*/result.json`; `VOID.md` |
| DESIGN-STREAMS programme | Estimated ≈ $500–980 (minimum) or ≈ $970–1,910 (full) | estimate | `DESIGN-STREAMS.md:1048-1087` |
| D24 envelope for PREREG-DUR-1 | ≤ $80 of development spend | decision | `research/decisions-20261021.md:47` |

**Not measured:**
- maintenance $ per change over a stream;
- the cost of a wrong delivery, W, declared per family (K11);
- latency budgets (K17: `PROOF-LEDGER.md:142,148`);
- Opus xhigh cost on any stream.

---

## 10. Every untested item in one list (the D24 gap)

1. A red team against a built workflow: J2, the defect miner, and the D24 worst-case pass.
2. Injected faults on W-bed (R8) and on JIT streams. E8 has the only fault battery.
3. A long stream with several changes (80 ticks, 5 epochs) and every metric that depends on one: TTD per epoch, maintenance $
   per change, forgetting, heal propagation, break-even.
4. Sealed or unknown drift. Every drift run so far was designed by the author or declared in the spec.
5. A drift detector frozen before the data and tested on a held-out family (the input-profile lead).
6. Heal on mined latent defects (E8 L4: 6 defects ready). The retroactive sweep (K5). T4a and T4b.
7. Heal when the change is not announced to the patcher. COMP-1 M5 gave the patcher the before and after text.
8. FH-1 verdicts. The run is in flight.
9. Any built workflow against the frozen hand-crafted references (W-bed R1/R3) or against an n8n H-best port, on the same
   stream.
10. Opus 5.5 xhigh on any stream or world.
11. K ≥ 2 lineages and held-out seeds for any durability, adaptation or heal number.
12. Adaptive in-node sub-workflow creation, and `flow.plan`.
13. Invariance contracts on fresh data (K4's paid half), and the false-alarm rate of the AST guard on real recompiles (A3).
14. AutomationBench-R arms (agent-H, wf-H, wfN-H, agent-O) over week streams.

---

## 11. Reusable instruments

### 11.1 Code paths

| Purpose | Path | Tests |
|---|---|---|
| Stream harness: warmup, compile, guards and deopt, shadows (`shadowFloor`), adjudication, regressions, recompile on 2 deopts, Opus fallback, resume | `experiments/jit/stream.mjs` (`DEFAULT_JIT` `:39`, `normalizeConfig` `:253`), `resume-streams.mjs`, `report.mjs` | `experiments/jit/test/stream.test.mjs` |
| Run a compiled solver; strict journal replay ($0); memo and resume ports | `experiments/jit/run-compiled.mjs` (`createMemoPort` `:111`, `runCompiled` `:244`) | `test/run-compiled.test.mjs`, `test/replay.test.mjs` |
| Durability, W = 6 and S = 0.8, oracle and system views | `experiments/jit/durability.mjs:45-51` | `test/durability.test.mjs` |
| Input profile: learn, check, tolerant | `experiments/jit/profile.mjs:416,447,476`; `eval-profiles.mjs`, `eval-dump-profiles.mjs` | `test/profile*.test.mjs` |
| CUSUM and count-rule simulator | `experiments/jit/cusum.mjs:186,205` | `test/cusum.test.mjs` (13) |
| Invariance variants (observe or deopt; judges replay or fresh) | `experiments/jit/invariance.mjs:98`, `eval-invariance.mjs`; relations in `beds/<bed>/invariance.mjs`, `beds/lib/metamorphic.mjs` | `test/invariance.test.mjs`, `beds/lib/metamorphic.test.mjs` |
| Tolerant comparator (exclusion set exact) | `experiments/jit/compare.mjs:45,197` | `test/compare.test.mjs`, `test/majority-order.test.mjs` |
| Acceptance (strict, minPartial 0.9); domain preservation on recompile | `experiments/jit/acceptance.mjs:49`; v2.2 | `test/acceptance.test.mjs`, `test/refusals.test.mjs` |
| Priced verification | `experiments/jit/verify-economics.mjs` | `test/verify-economics.test.mjs` (12) |
| Statistics (McNemar, paired power, env-fault rule) | `experiments/jit/stats.mjs` | `test/stats.test.mjs` |
| Seed ledger enforcement | `experiments/jit/seeds.mjs:64`; `experiments/lib/ebed-seeds.mjs` | `experiments/lib/ebed-seed-ledger.test.mjs` |
| Tier-down end-to-end replay | `experiments/jit/tierdown-e2e.mjs` | `test/tierdown-e2e.test.mjs` |
| Heal kit: detect, localise (counterfactual flips), propose (13 ops), verify V0–V8, promote/rollback, learn; live driver; retry control; audit | `experiments/heal/{detect,localise,propose,verify,promote,learn,replay,kit,live,retry-control,audit-live,p1-mechanism}.mjs` | `experiments/heal/test/*.test.mjs`: 92 on main, of which 66 skip on the policy drift; 98 with 0 skipped on the branch |
| FH-1 failure handling (code-level patch, gates H-C / H-N / H-0, grading, baseline, regeneration estimate, ensemble) | Branch only: `experiments/fh/{heal,grade,baseline,analyse,ensemble,freeze}.mjs` | `experiments/fh/test/fh.test.mjs` (8) |
| E8 composition: runtime, 13 capability contracts, fault battery (M4a–e), drift D1, patch-drift driver, patch locality | `experiments/compose/{runtime,capabilities,faults,fault-run,drift,drift-run,patch-drift,validate}.mjs` | `experiments/compose/test/*.test.mjs` |
| E8 builders, smoke loop, N-version repair, agent arms | `experiments/ebed/{build,repair,smoke-service,agent-arm,run-agent}.mjs`; `experiments/tracker/nversion.mjs` | `experiments/ebed/test/` |
| Org layer: constitution, registry gate, overlay, observer (OCEL), shield, guard G, auditor | `experiments/constitution/*.mjs` | 49 tests in `experiments/constitution/test/` |
| Library: drift fixtures, retroactive sweep, composition checker | `experiments/library/cards/*/fixtures/drift.json`, `sweep.mjs`, `check.mjs`, `run.mjs` | `experiments/library/test/{cards,sweep,check}.test.mjs` |
| AutomationBench-R per family: generator, oracle, observable-only reference, bad controls, $0 gates, $0 stream harness | `experiments/autobench/families/<f>/{gen,oracle,reference,controls,gates,harness}.py` | `experiments/autobench/families/<f>/tests/` |

### 11.2 Beds, frozen references and seeds

**Beds with change built in:**
- **records:** d3 → d4 regime switch (ATLAS date order at a dated cutoff, `DEV-NOTES.md:318-323`).
- **kinetics:** d4 → d5.
- **E8:** epochs ep0–ep4; new carrier from epoch 1 (d3); edition switch (d4); F1/F3/F4/F6 faults and the F5 field rename (d5) (`beds/ebed/e8/README.md:43-49`); 13 metamorphic relations; 6 mined latent defects.
- **E7:** edition switch at d4 (`beds/ebed/e7/README.md:63-64`).
- **AutomationBench-R:** 12 week-stream families with carry and a drift re-check block.
- **W-bed R1–R6, R3′:** R8 hooks wired as no-ops.

**Frozen references:**
- W-bed R1/R3 (`beds/wbed/references/FROZEN.json`, sha256 `b267498f…` for R1). The revision is spent.
- E8 reference policy and oracle (bed digest `b9e5a67138d42a7f` in FH-1's freeze).
- E8 `c-oss`.
- Library cards P58–P60 (`experiments/library/cards/FROZEN-P58-P60.json`).
- Archived JIT solver versions and journals: 25 versions and 5,792 calls (`DEV-NOTES.md:562-564`); runs in `research/jit-20261008/runs/`.

---

## 12. Seeds: available and spent

**Ledgers:**
- `research/jit-20261008/SEED-LEDGER.json` (88 ranges; header `updated` 2026-10-15, though range texts were edited later).
- `research/heal-20261008/seed-ledger.json`.
- E8 confinement through `experiments/lib/ebed-seeds.mjs`.

| Bed | Spent (used or inspected) | Available | Reserved, never touched | Ledger lines |
|---|---|---|---|---|
| records, kinetics (JIT) | 201–224 dev (both); kinetics 225–248 (R0-K); burned test 5001–5006 and 6001–6004 | records 225–248 is marked **fresh, but the laptop R0 agent arm ran all 24 and the JIT arm 12** (see §13); 249–272 `jit-oos` (records 249–272 already scored at $0 in row 3 stage 1, `DEV-NOTES.md:320-323`); 273–300 inside `kev-probe-pilot` (allows `jit-dev`; K4 proposes it, `PROOF-LEDGER.md:135`) | held-out A 8001–8024, B 8101–8124 | `:197-260`, `:90`, `:169-196`, `:261-292` |
| W-bed R0–R6, RH | 301–312 (reference validation, now dev); 313–324 (out of sample, R1/R3); 373–378 (author fixtures); 379–390 (attacks) | 325–372 inside `wbed-dev` 301–390 (purpose `jit-dev`) | held-out A–D 8201–8524 | `:307-421` |
| W-bed R3′ | — | dev 401–490 | held-out 8601–8624, 8701–8724 | `:422-469` |
| E8 | **ebed-dev 1001–1199:** 1001–1030 (bed health), 1101–1102 (defect mining), 1161/1162/1164 (faults), 1165/1166 (drift).<br>**Rehearsal 1201–1249:** 1201–1206 fixtures, 1211–1222 attacks, 1231 reference validation, 1232–1234 grading (B1, COMP-1, OT-0, FH-1), 1235–1237 practice, 1241–1249 specificity and Track C | Rehearsal: **1207–1210, 1223–1230, 1238–1240 unassigned** (`:1086-1100`). ebed-dev: the rest of 1001–1199 not named above. Fuzz bases 1301–1310 | held-out A–B 9101–9102, C–D 9103–9104; **sealed (drift families and heal arm, one world per mined defect) 9201–9204**; scale 9301–9302 | `:470-497`, `:498-…`, `:1086-1165` |
| E1–E7, E9–E13 | — (E7 has a bed; no arm run) | dev 1001–1199; rehearsal 1201–1249 per item | held-out 9101–9104, sealed 9201–9204, scale 9301–9302 (E1–E9) | `:574`, `:1006`, … |
| AutomationBench-R (beds = family id, purposes `need-*`) | none for any arm (generators and references only, at $0) | practice 601–609; dev labels 610–613; top-ups 614–621; rehearsal 622–630; reserve 631–650 | held-out 8801–8828; **drift re-check 8837–8840** (sealed until used) | `:1502-1549`; `RECURRING-DESIGN.md:421-433` |
| Heal (records, codefix) | dev 1–3, 101–160; dev 1001–1012 consumed by the V7 fresh gate (3 × 4 per family); test 6001–6004 and 5001–5006 inspected | dev d3/d4 above 1012 not listed | — | `research/heal-20261008/seed-ledger.json` |
| Kev reservations (not for these experiments) | — | — | test 7000–7039, 7040–7199; dev 1–400 probe-pilot (non-exclusive) | `:90-140` |
| Clean test space | — | test ≥ 7200 for every bed, outside the ranges above | — | `:293-306` |

---

## 13. Discrepancies and caveats found while mapping

1. **Records 225–248 is still marked `fresh`**, by design until the export commit. But the agent arm ran all 24 tasks and the JIT
   arm 12, with 9 pass, $6.62 (`research/jit-20261008/runs/jit-r0-records/`; `SEED-LEDGER.json:212-227`). Rows exist and have
   been summarised in `DEV-NOTES.md:378-386`. Treat the range as **seen** for any new design.
2. **No Opus run on any stream was at xhigh.** The dev-stream Opus agent has `agentEffort: null`
   (`runs/jit-dev-records-1/agent-claude-opus-5-5/arm.json:14`). D19 (`decisions-20261021.md:43`) has not been executed on a
   stream.
3. **The heal unblock (D20) and FH-1 live only on the gap-closure branch.** On main, heal still refuses the policy and 66 tests
   skip (`README.md:362`). FH-1 results are uncommitted and its RESULT file is a template.
4. **COMP-1's drift "heal" is maintenance on an announced change.** Its 6/6 does not answer "detects and heals while running"
   (`RESULT-COMP1.md:120-125`).
5. **E8's in-world changes are spec-declared.** Editions are described in R1.3 and the field rename has a documented error
   path (`SPEC-E.md:120-122,175-176`). Passing them is evidence of correct construction, not of adaptation to the unknown.
6. **The E8 oracle inflates critical counts after a case's first divergence.** `beds/ebed/oracle/grade.mjs:104,155`, found by
   OT-0 (`research/org-20261021/README.md:82-88`). Critical counts on already-failing cases, including COMP-1's cht-e8-3 202
   critical, may be overstated.
7. **The R0-K arm stop was tipped by an imputed $3.00 builder-timeout bound.** On measured spend the arm would have continued
   (`DEV-NOTES.md:1353-1358`).
8. **The OT-0 W-C builds are unanalysed.** One of them scores 21/1,036 on the E8 oracle (`runs/wc-e8-3/result.json`). The
   OT-0 agent re-runs are in flight; this map only reads them.
9. **The DESIGN-STREAMS harness prerequisite P2/G1 is still unmet.** `staticFallback: null` still becomes Haiku
   (`experiments/jit/stream.mjs:336`). Any "static, no fallback" arm in PREREG-DUR-1 needs it fixed first.
