# RESULT-DUR-1: the run stopped itself at Stage Z; no capability number yet (2026-11-04)

- **Status: VOID.** No arm ran. The chain stopped at 20:32:08Z under the frozen stop rule (PREREG-DUR-1 §13.2, Stage Z
  row), before exposure, the static arms, K-0 and every paid arm. Nothing more may be spent until a dated amendment is
  committed (§13.2, §13.3).
- **Spend:** $1.4886 of $80, all P1 (the sealed author, `claude-opus-5-5`, effort xhigh, 15 turns,
  `runs/spend.jsonl`). Mercury tokens: 0. This write-up and the $0 diagnostics are analysis work outside the $80
  (§12) and were not metered on the ledger.
- **Evidence label:** development. This document reports **no capability result**. Every number in it describes the
  test bench or earlier work. The diagnostics in §4 and §6 are **post hoc**: they were made after the stop, run only the
  reference policy (oracle side, as Stage Z itself does), and saw no arm outcome on any stream world.
- **Commits** (branch `worktree-wf_bd674a6e-71f-11`, not pushed): prereg frozen `f2c57596` at code `5790d89a`; F-A
  `738b7977`; sealed author and F-B `740b33a0`; run records and the first diagnosis `a6e6d385`; this document is in the
  commit that adds it. `freeze.mjs check A` and `check B` both pass after this document and its diagnostics were added.
- **Not read:** the sealed bundle (`/var/tmp/foundry-work/dur1-sealed/bundle.json`; counts only), `beds/sealed/`,
  AutomationBench devCheck/test tasks.

## 0. The owner's question, answered in plain words

> "Is [the created workflow] good enough in the worst case and does it adapt and heal as it does real work? Have we
> tested its performance as it changes?" (2026-10-21, `research/decisions-20261021.md:47`, D24)

**We still do not know. DUR-1 has not tested it yet.** DUR-1 was built to answer this question. It stopped before
running the workflow, because its own validity checks found defects in the test bench. Four defects were found: three
by the checks and one by hand afterwards. None is a defect in the workflow. All four can be fixed at $0. The checks are
designed to stop the run when the bench is wrong, and they did, before any money went to the arms. The $1.49 spent so
far is still valid, and $78.51 remains.

- **Worst case: unknown.** No built E8 workflow has run on a changing stream. So there is no worst-world or
  worst-class number, no count of silent wrong answers, and no comparison with the hand-crafted reference or the
  per-tick agent.
- **Adapting and healing: unknown in a stream.** The run never measured whether the monitor notices change (K-0 did
  not run). No heal ran, so there is no measure of whether heals hold, how fast they land (TTD) or what upkeep costs.
- **Performance as things change: not tested.** Worlds W1 to W6 have no arm results on any stream (§3). The prereg's
  predictions (static programs 0.60–0.90 on changed cases, healed programs 0.88–0.99, upkeep about $0.3–0.8 per
  lineage-stream) are still priors, not data.
- **Beating Opus 5.5 xhigh at a fraction of the cost: not tested.** A-Ox (P8) did not run.

**What earlier, smaller work says.** This is development evidence on one family with small K. It does not come from
DUR-1. The rows marked "via the map" are quoted from `EVIDENCE-MAP.md` §1 and were not re-checked here.
- *Healing build defects, with a precise verifier* (FH-1, read directly, `research/heal-20261021/RESULT-FH1.md:18-51`):
  one Haiku session per program, with the 13 capability contracts as its verifier, removed 357 of 475 recurring
  failing cases (75.2%). It regressed none and cost $1.142 in total. Retry recovered 0 and regeneration about 27.5.
  These were heals on **unchanged** worlds. FH-1 did not test a world that changes under the program.
- *Patching an announced change* (COMP-1 M5, via the map): 8 of 8 changed cases fixed, with 0 collateral, at
  $0.02–0.05 per patch. That was one change.
- *Worst case* (via the map): the only scored worst-case data is the E8 fault battery. Under a crash after apply, 1 of 6
  composed builds collapses (23/43, with 26 critical). No red team has ever run against a built workflow.
- *Noticing change* (via the map): every outcome monitor tried so far failed the bar. A count rule caught 3 of 4 drifts,
  with 8 false alarms. CUSUM caught 0 of 4. A frozen input-profile detector alarmed 1 task after the drift with 0 false
  alarms, but only post hoc and in sample. Invariance contracts flagged 0 of 18 wrong compiled answers.
- *Over time* (via the map): only 24-task streams with one drift step have run. On records, S→H became durable and then
  relapsed once. H→H and every kinetics arm never became durable in the system view.
- *Against the agent and Opus* (via the map), on one sized E8 world: the built program passed 14/14, the Haiku agent
  with a validator 12/14, and an Opus one-shot build 5/14. No Opus xhigh arm has run on any stream.

**What it takes to get the answer.** One $0 amendment (§7) and a $0 re-run of the gates on all 18 worlds. Then Stage Z
runs at $0. It gives the first per-world curves for the nine static programs, their silent and loud failure counts
under the monitor, and K-0 (is the monitor blind?). The paid rows follow in the order of §8.

## 1. What ran

| Step | Time (UTC) | Outcome | Cost |
|---|---|---|---|
| K-5 disk pauses | 18:57, 19:27 | free disk 1.20 GB, then 1.10 GB, below the 1.2 GB line; 60 min waited (environment, never scored) | $0 |
| $0 dry run on the frozen code | 19:57–20:12 | 19/19 steps; plumbing only, never evidence (`runs/dry-preflight/`) | $0 |
| P1 sealed author | 20:12–20:19 | gates passed on attempt 1; `SEALED.json` sha256 `e12137a9…`, counts only | $1.4886 |
| F-B | — | 135 files, every digest equal to Appendix D (`740b33a0`) | $0 |
| Stage Z: V-11 | 20:20–20:29 | 9/9 lineages reproduce 1,022/1,022 on grading worlds 1232–1234 (`runs/stagez/V11.json`) | $0 |
| Stage Z: s1 gates | 20:29–20:32 | V-1 fails on s1-W5; V-3 fails on s1-W2 (E1) and s1-W4 (L1); **stop, exit 5** (`runs/stagez/STOP.json`) | $0 |
| exposure, static arms, K-0, WC-1, P0, P2–P9, analysis | — | not run | $0 |

What the stop does tell us:
- **The starting programs are what FH-1 certified.** V-11 passed 9/9.
- **The sealed changes are well formed.** On its four validation worlds (1223–1226), the author's R2s exposed 32–43
  completed cases (floor 10), and the unchanged reference failed 31–41 of them. E2s exposed 60–72 (floor 10). U1s
  exposed 15–26 (floor 6), and the unchanged reference failed all of them. Every bad control failed. On the stream
  worlds (counts only), R2s, E2s and U1s clear their floors 3.5–7 times over (§3).
- **Every gate failure is in a designer-written change** (E1, L1, and ADV through L1). The sealed author had to pass a
  floor gate before it could seal. The designer's own operators were never put through the same gate on the real seeds
  (R5).

## 2. The frozen decision rules, applied verbatim

**The rule that fired.** §13.2, Stage Z row: *"Stage Z: V-1, V-2, V-3 (an exposure floor) or V-11 fails; K-1 or V-6
anywhere; K0.json missing | stop (exit 5, `runs/stagez/STOP.json`); a dated amendment before any paid step."*
Input: `STOP.json`, which reads *"V-3 s1-W2: E1 8 completed exposed < floor 10 | V-3 s1-W4: L1 2 completed exposed <
floor 8 | V-1 s1-W5: earliest fails o0021 (outside-allowed )"*. **Verdict: fired.** The chain stopped and no paid step
may run before a dated amendment.

For every other rule below, the input is missing because the stop came first. Each verdict applies the rule's own
wording to that absence, including its fail-closed clauses.

| Rule | Decisive text (verbatim) | Input | Verdict |
|---|---|---|---|
| K-0 | "if m1–m3 ... flag < 50% of S-H\*'s change-induced failing cases of R1, E1, L1 or E2s within 1 world-day ...: stop before any paid heal" | not computed; `K0.json` not written | **NOT EVALUATED** (neither fired nor passed) |
| Holm (D-1, D-3) | "if the smaller p exceeds 0.025, neither is supported" | no p-value exists | **neither supported** |
| D-1 (primary) | "Supported iff p ≤ its Holm level, and ... ; if that clause cannot be evaluated ..., D-1 is not supported (fail closed) ... Falsified iff the durable share < 0.50, or ... Otherwise inconclusive." | no MH-H, no S-H\*, no cells | **not supported; not falsified; INCONCLUSIVE (no data)** |
| D-3 (primary) | "Supported iff p ≤ its Holm level. Falsified (the agent adapts better) iff the two-way 95% upper bound of mean d < 0 and the median MH-H TTD ... > 2 world-days" | no routed case | **not supported; not falsified (no data)** |
| D-2 | "Pass iff median maintenance $ per heal-requiring cell ≤ $0.50 and ... Falsified iff > $1.50 or more than 25%" | no session, no A-H | **NOT EVALUATED** |
| D-4 | "Only then may we write 'equal to (or better than) an expert-maintained hand-crafted workflow'" | no final week, no REF-M | **NOT EVALUATED; the sentence may not be written** |
| D-5 | "YES only if MH-H has: (a) ... (e) ... Any other clause missed or not evaluated (a missing input never passes) → PARTIAL" | no clause evaluated; no silent critical case observed because nothing ran | **PARTIAL by the fail-closed clause; it carries no information.** NO cannot fire without a run |
| D-5 without complaints | as D-5 | as D-5 | **PARTIAL by the fail-closed clause (no information)** |
| D-6 | "Pass iff recall ≥ 0.9 in every unannounced class ... fail iff recall < 0.5" | no detection data | **NOT EVALUATED** |
| m6 | "adopted for watch mode iff its delay is ≤ 4 exposed cases ...; otherwise N" | not computed | **N (not adopted), mechanically** |
| D-7 | "'Matches Opus 5.5 xhigh per tick at ≤ 1/20 of the cost' may be written only if ..." | no A-Ox | **the sentence may not be written** |
| D-8 | "Pass iff ≥ 5 of 6 defects are healed durably ... Falsified iff a false complaint promotes a harmful change" | LD-H not run | **NOT EVALUATED** |
| D-9 | descriptive | none | **nothing to describe** |
| D-10 | "'Detects and heals unknown change' may cite only E2s and U1s: E2s durable in ≥ 2/3 ...; U1s loud ..." | none | **the claim may not be written** |
| D-11 | "J2 adds value iff, for ≥ 1 of 2 Opus targets, it finds a valid world with strictly more silent failing cases than the blind baseline" | J2 not run | **NOT SHOWN** |
| Certification | "Every promotion of every built arm gets a `certifyHeal` verdict" | no promotion | **nothing to certify** |
| §14.3 ledger | "No result text is written until every record exists" | no arm ran, so the arm ledger has no record | **satisfied vacuously.** This document contains no result text about any arm. The instrument failures each have a record (§4) |
| Banner, REFUTED | "D-1 falsified ...; D-3 falsified ...; K-0 fires" | none of them evaluated | **the claim is neither supported nor refuted; it is untested** |
| §1 predictions | priors, "not thresholds" | none | **none can be checked** |

## 3. Performance as things change, epoch by epoch

No arm has a number for any world. The table shows what Stage Z saw before it stopped. These are oracle-side counts of
the reference (hand-crafted policy) runs. For sealed changes they are counts only.

| World | Changes in force | Reference completed cases (s1) | Exposure floor checks (completed exposed / floor), s1 / s2 / s3 | Arm results |
|---|---|---|---|---|
| W1 | none | 80, V-1 ok | — | not run |
| W2 | P1, E1 | 82, V-1 ok | P1 38 / 41 / 45 of 10; **E1 8 / 17 / 11 of 10 (s1 misses)** | not run |
| W3 | P1, E1, R1 | 83, V-1 ok | R1 10 / 11 / 13 of 10 | not run |
| W4 | P1, E1, R1, R2s, L1 | 83, V-1 ok | R2s 38 / 37 / 35 of 10; **L1 2 / 2 / 4 of 8 (all miss)** | not run |
| W5 | P1, E1, R1, R2s, L1, F, E2s, ADV | 84; **V-1 fails on o0021** | E2s 65 / 68 / 67 of 10 | not run |
| W6 | P1, R1, R2s, L1, E2s, ADV, E1r, U1s; 2× volume | 153, V-1 ok | E1r 98 / 110 / 98 of 10; U1s 36 / 37 / 33 of 6 | not run |

Sources: `runs/stagez/s1.gates.json`; for s2 and s3, `runs/stagez/DIAGNOSIS-20261104.json` `gatesFrozenCode`, which
ran the frozen gate code on all 18 worlds after the stop. V-2 passes on every changed world: all six bad controls fail
all 15 changed worlds.

## 4. Root cause of every failure

Every failure in this run is a failure of the experiment, not of the workflow. The owner's frame is: what change or
input caused it, which mechanism should have caught it, why that mechanism did not, and the generic fix. The workflow's
mechanisms (monitor, guard, shadow, heal) never ran. Their counterparts in the experiment are its tests, the planned
pre-freeze gates, two code reviews, the $0 dry run, Stage Z and the freeze.

### R1. V-1 fails on s1-W5: the reference fails its own oracle on case o0021

- **Cause (change and input).** L1's fault on an inventory reserve, placed on a 3-item order with one fulfilment
  (ORD-1175-0021, WH-AMS, SKU-1003 ×1, SKU-1015 ×2, SKU-1019 ×2, epoch ep0). L1 selected this order only because ADV
  changed the world id that seeds L1's draw (R4). Removing L1 or ADV clears the failure. Removing any other change does
  not (`DIAGNOSIS-20261104.json` `v1_s1W5`).
- **Mechanism.** `experiments/durability/changes.mjs:245` puts the F6 reserve fault on reserve #2 whenever the order
  has more than one item. That is the bed's own MR11 rule (`beds/ebed/e8/metamorphic.mjs:450`). The reference (earliest
  timing) sends all three reserves in one emission. Reserve #2 fails. The oracle's expected transition then allows no
  effect for reserve #3, so `beds/ebed/oracle/grade.mjs:154` records a layer-2 `outside-allowed` divergence. It is not
  critical. MR11's rule had only been validated where reserve #2 is the last reserve.
- **What should have caught it.**
  1. BUILD-PLAN §4 step 1: "V-1…V-4 on stream s1 with designer-known changes only", before F-A
     (`BUILD-PLAN.md:90-91`).
  2. Prereg §13.1 step 2: "Stage Z gates on the designer-known parts", before F-B (`PREREG-DUR-1.md:695`).
  3. The same defect class was already seen at build time, on fuzz world 1302: case o0014, ordinal 2 on a
     two-fulfilment order (`BUILD-NOTES.md:97-103`).
- **Why it did not.**
  - Neither 1 nor 2 was run on stream worlds. V-1 and V-2 ran only on the 24-order rehearsal worlds
    (`BUILD-NOTES.md:109`), and the check on the real L1 worlds was left "open" for Stage Z
    (`BUILD-NOTES.md:269-271`).
  - It was computable before the freeze. At $0, s1-W5 with only the designer-known changes (P1, E1, R1, L1, F, ADV; no
    sealed bundle) fails V-1 on o0021 (`runs/stagez/diag/adv-twin-decompose.out.json`).
  - On 3, the build-time instance was generalised to the wrong condition. Prereg §15 item 16 and the build note
    planned "skip `f6-reserve` on multi-fulfilment orders". The real condition is that the faulted reserve is not the
    last one in its emission, which also holds for one fulfilment with three or more items. The planned remedy would
    not have fixed o0021.
  - The dry run uses small worlds by design, so it never produced the case.
- **Generic fix.**
  - A fault operator is valid only if the reference passes on every world it touches. Prove this with a property test
    over many generated worlds with every eligible order faulted, not with one example.
  - Place faults relative to the reference's emission structure: fault the last reserve (A1).
  - Run every $0 gate that needs no sealed material on the real seeds before the freeze (R5).
- **Status.** A1 is verified at $0: V-1 passes on 18/18 worlds and V-2 is unchanged (`DIAGNOSIS-20261104.json`
  `counterfactuals`). **Bed note:** the same rule lives in the bed's MR11, which WC-1 and J2 also use. They class such
  worlds as bed findings and exclude them, so the defect costs search budget there but does not corrupt scores. It
  should be recorded in the E8 bed README by whoever next edits the bed. This document does not edit it.

### R2. V-3: L1 misses its floor of 8 completed exposed cases on W4, on every stream (2, 2, 4)

- **Cause.** L1 injects into a share of 0.15 of the straight orders with an available fulfilment
  (`changes.mjs:216-223`). W4 has 31, 27 and 30 such orders. The injected count is then about Binomial(29, 0.15),
  with a mean of about 4.4. P(≥ 8 injected) is 0.04–0.08 per world, or about 0.0002 for all three streams. And that is
  before cancel kinds blocked by collection runs are skipped, and before counting only completed cases. Even at a share
  of 0.35 the floor is missed on s1 (6) and s2 (5) (`DIAGNOSIS-20261104.json` `counterfactuals`).
- **What should have caught it.** V-3 at design time. The floors in prereg §4.1 carry no derivation (neither
  DESIGN.md nor the prereg gives one). BUILD-PLAN §4 step 1 should also have caught it.
- **Why it did not.**
  - The build treated all of V-3 as needing the sealed bundle: "on the real worlds only after the sealed bundle
    exists" (`BUILD-NOTES.md:110`). L1 is designer-written and needed no sealed bundle.
  - The dry-run worlds have 24 orders, where "floors fail by design" (`BUILD-NOTES.md:88-90`), so the dry run could not
    test the floors either.
- **Contrast.**
  - R1's operator injects a fixed count (`n = 10`, `changes.mjs:198`) and meets its floor on every stream (10, 11, 13).
  - The sealed author's three operators had to pass a floor gate before sealing (V-13) and clear their floors 3.5–7
    times over.
  - Only the designer's share-based operators never went through the gate that the author had to pass.
- **Generic fix.**
  - One gate for every change author: floors are checked on the real seeds before the freeze.
  - An operator that must meet a floor injects a quota, not a share.
  - Alternatively, the floor is set over the span the change is in force. TTD already pools exposure that way (§9
    item 3). See A3.

### R3. V-3: E1 misses its floor of 10 on W2 on stream s1 (8; s2 17, s3 11)

- **Cause.** E1 starts at W2 d9 00:00 (`schedule.mjs` `CHANGES.E1`). Only orders whose carrier booking falls in the
  last ~6 days, and which complete by the world's end, are exposed. On s1 there are 8 of them. The floor sits inside
  the realised range (8–17), so it fails by chance on about one stream in three.
- **What should have caught it, and why it did not:** as R2. The check was designer-known and computable at $0 before
  the freeze.
- **Not a capability problem.** E1 stays in force from W2 through W5, with 48, 55 and 51 completed exposed cases on s1
  in W3–W5.
- **Generic fix:** as R2 (A3).

### R4. The ADV twin is not like-for-like (found by hand after the stop; no gate saw it)

- **Cause.** ADV builds the world with `generateWorld({ injection: true })`, which appends `-inj` to the world id
  (`beds/ebed/e8/world.mjs:335`). Six draws are keyed on that id:
  - L1's selection (`changes.mjs:218`);
  - F's duplicate placements (`:262`);
  - F's duplicate carrier reports (`:282`);
  - R1's review load (`:200`). This one is latent in the frozen schedule: R1's operator runs only in W3, where ADV is
    off;
  - the bed's own analyst and carrier actors (`beds/ebed/e8/actors.mjs:17`, `:34`).

  The incremental twin twin(W, ADV) removes ADV and so re-draws all of them.
- **Size** (post hoc, $0, designer-known changes only, reference policy only; `runs/stagez/diag/`).
  - The frozen twin differs from W on **91 completed cases** across the six ADV worlds: s1-W5 13, s1-W6 27, s2-W5 6,
    s2-W6 20, s3-W5 11, s3-W6 14.
  - Of these, 70 come from the L1/F re-draws and **21 from the actors' draws alone**.
  - With and without injection, `generateWorld` differs only in id, publicId and documents, on all six worlds.
  - A document-only overlay that keeps the world id differs from the twin on **0** cases in all six.
- **Consequence had it run.**
  - It does not inflate ADV's exposure count. By design every order document is touched (`exposure.mjs:65` with
    `changes.mjs:488`), hence 78 of 84 on s1-W5.
  - It corrupts **attribution**. A change-induced failure is one that fails in W and passes in twin(W, c) (§4.2). A case
    that fails because of an L1 fault or a carrier timing present in W but absent from the twin would have been counted
    as ADV-induced.
  - Through §8.1's multi-label classes, that would have charged L1, F and actor-timing failures in W5–W6 to ADV in
    D-1's heal-requiring cells, in D-5(c)'s per-class rates and in per-change maintenance $ (§9 item 6).
  - It is also what made V-1 fail (R1): ADV moved L1's draw onto o0021.
- **What should have caught it.** A twin-identity check: twin(W, c) must differ from W only in c's own footprint.
- **Why it did not.**
  - The tests check that excluding a change not in force leaves the world identical, and they check R1's twin
    (`experiments/durability/test/world.test.mjs:152`).
  - V-6 checks prefix identity under a version swap.
  - Neither checks the other changes' footprints across a twin. The generator's id carries the injection flag, a
    coupling no review noticed.
- **Generic fix.**
  - Key every random draw on a world key that does not depend on any change.
  - Apply changes that only alter inputs (documents) as overlays after all draws.
  - Add a Stage Z gate (proposed V-15): for every world and every change c in force, the other changes' touched sets,
    fault lists and actor draws are equal in W and twin(W, c).
- **Status.** A2′ (the document overlay) is verified at $0 on the designer-known parts of all six worlds. It is not yet
  verified with the sealed operators in. They run on the same world, so an id-invariant world removes this channel
  unless a sealed operator reads documents. V-15 would check that, counts only.

### R5. The common root: $0 checks that needed no sealed material ran after the freeze and after the paid author

- **What happened.** R1, R2 and R3 were each computable at $0 before the freeze, and the plan said to compute them
  there (BUILD-PLAN §4 step 1; prereg §13.1 step 2).
  - The Fix-phase amendment to §13.1 made the freeze earlier and stricter (`PREREG-DUR-1.md:685-689`). It did not move
    the designer-known gates in front of the freeze.
  - The build notes leave the real-world L1 check "open" (`BUILD-NOTES.md:269-271`) and put V-3 after sealing (`:110`).
  - Two reviews (8 + 5 blockers, 23 + 12 majors) read the code and the prereg. Neither executed the gates on the real
    seeds.
  - The $0 dry run is, by design, a plumbing check on 24-order worlds (`BUILD-NOTES.md:87-90`).
- **Mechanism that should have caught it.** The freeze itself. `freeze.mjs` hashes files. It does not require evidence
  that the frozen instrument passes its own gates on the frozen seeds, and it has no amendment path.
- **Generic fix** (program-wide, for `research/PREREGISTRATION-TEMPLATE.md`):
  - A **pre-freeze gate record**: every gate that can run at $0 without sealed material runs on the real seeds, its
    output digest goes into the freeze, and the freeze tool refuses without it.
  - An amendment path in `freeze.mjs`: a hash-chained `FREEZE-AMEND-n.json` that names the committed amendment file and
    the previous freeze.
- **Cost here.** Small in money: $1.49, still valid, because P1's gates involve none of L1, ADV or F. Larger in time:
  an amendment, a review, a re-freeze, and the gates re-run. The fail-closed design worked: the paid arms did not run on
  a bench that would have misattributed failures.

### R6. Stage Z stops at the first stream that fails

- **Cause.** `experiments/durability/run.mjs:337-343` stops after s1's gates, so the extent on s2 and s3 had to be
  computed by hand after the stop (`DIAGNOSIS-20261104.json`).
- **Generic fix.** Fail closed, but report completely: compute every gate on every world, then stop (A4). Cost: about
  6 more CPU-minutes.

### R7. Two disk pauses (environment)

- **What happened.** K-5 paused at 18:57Z (1.20 GB free) and at 19:27Z (1.10 GB), 60 minutes in all.
- **Cause.** The shared disk and other runs.
- **Status.** The guard worked as designed, and the pauses were never scored. At 21:21Z, 3.7 GB was free.
- **Fix.** None needed in DUR-1.

### The failures the owner named, and why none has a record here

| Failure kind the owner asked about | Count in DUR-1 | Why | Which stage produces it |
|---|---|---|---|
| Silent wrong answers | none observed: **not measured** | no arm ran on any stream world | Stage Z (static arms with W-M0), P2/P3 (MH-H) |
| Epochs where a workflow did not recover | **not measured** | no stream ran | P2/P3; TTD per change |
| Heal attempts that failed or regressed | **0 attempted** | no heal session ran | P0 (rehearsal), P2/P3, P9 |
| Red-team defects | **0 found: J2 not run** | P7 not reached | WC-1 at t0 ($0), P7 |
| Agent or reference did better than the built workflow | **not measured** | no arm, window or reference comparison ran | Stage Z (R-static, R-maint, REF-S), P4, P6, P8 |

## 5. Failure taxonomy with counts

**Gate failures on the frozen code** (all 18 worlds, `DIAGNOSIS-20261104.json`):

| Gate | Failures |
|---|---|
| V-1 | 1 (s1-W5) |
| V-2 | 0 (15 worlds × 6 controls) |
| V-3 | 4 (E1 s1-W2; L1 W4 on s1, s2, s3) |
| V-11 | 0 (9/9) |
| **Total** | **5** |

**Records by the frozen §14.3 categories.** The frozen list was written for arm failures. All four defects found here
fall under its "bed or oracle defect". The list has no category for a miscalibrated instrument, so the
"instrument calibration" sub-label is added here and proposed for the list.

| §14.3 category | Records | Count |
|---|---|---|
| bed or oracle defect: fault operator | R1 (1 case, 1 of 18 worlds) | 1 |
| bed or oracle defect: twin and attribution | R4 (91 completed cases over 6 worlds, designer-known parts) | 1 |
| bed or oracle defect: instrument calibration (proposed sub-label) | R2 (3 of 3 W4 worlds), R3 (1 of 3 W2 worlds) | 2 |
| environment | R7 (2 disk pauses, 60 min) | 1 |
| process (not in the list): gates deferred past the freeze; incomplete stop report | R5 (common cause of R1–R3), R6 | 2 |
| spec misreading, hard-coded value, generic mechanism missing, fault handling, version migration, heal regression, stale verifier, detection miss, misclassification, evidence insufficient, patch wrong, gate rejected a good patch, gate accepted a bad patch, injection, budget or time cap | none: no arm ran | 0 |

## 6. Corrections to the first diagnosis (`runs/stagez/DIAGNOSIS-20261104.json`)

1. **"The frozen ADV exposure counts (78 of 84 ... 144 ...) are mostly an artefact"** is wrong. Those counts follow from
   the design: exposure(ADV) includes every case whose document ADV touches, which is every order (`exposure.mjs:65`,
   `changes.mjs:488`). The artefact is in the **twin**. It affects attribution, not exposure: 91 completed cases over
   the six worlds (R4).
2. **A2 as proposed** ("seed the R1, L1 and F draws from the world id without -inj") **is not enough.** The bed's
   analyst and carrier actors also draw on `world.id` (`beds/ebed/e8/actors.mjs:17, 34`) and account for 21 of the 91
   cases. **A2′ replaces it:** build the world without injection and overlay the documents, keeping the id. Verified 0
   differences on all six worlds.
3. **"Re-seeds R1's world operator"** is latent in the frozen schedule. R1's operator runs only in W3, where ADV is
   off. It would matter only if the two ever started in the same world.
4. **A2′ alone also clears V-1** on the designer-known parts of the six ADV worlds, because o0021 is no longer
   selected. A1 is still needed: the ordinal-2 defect remains for any order with three or more items that L1 hits.

## 7. The amendment this result supports (proposed, not applied)

Choosing floors and patching the bed change frozen files. These are design decisions for the orchestrator's review.
Every option below was chosen **without any arm outcome**: no arm has run on any stream world, so the amendment is still
blind.

| Id | Change | Verified at $0? |
|---|---|---|
| A1 | L1's reserve fault goes on the last reserve (ordinal = number of items), not the second; identical for 2-item orders | yes: V-1 18/18, V-2 unchanged (first diagnosis) |
| A2′ | ADV is a document-only overlay on the world built without injection; the world id never changes | yes on designer-known parts: twin differences 91 → 0 on all six worlds (`diag/adv-twin-overlay.out.json`); with sealed changes, by V-15 |
| A3 | Exposure floors of persistent changes (L1, E1) count completed exposed cases over every world the change is in force, consistent with how TTD pools exposure. Alternatives: (b) lower the W4 floor; (c) quota injection (L1 injects max(8, ⌈0.15·n⌉) cases). (a) is recommended: it changes the gate, not the load, so no other change loses exposure | to re-run (on s1, L1 = 2 + 3 + 14 touched under A2′; E1 = 8 + 48 + 55 + 51) |
| A4 | Stage Z computes every gate on every world before it stops | to build (about 6 CPU-minutes) |
| A5 | New gate V-15, twin identity: for every world and every change in force, the other changes' touched sets, faults and actor draws are equal in W and twin(W, c); sealed changes counts only | to build |
| A6 | `freeze.mjs amend`: a hash-chained `FREEZE-AMEND-1.json` naming the committed amendment and the previous freeze; Appendix D updated | to build |
| A7 | Before the new freeze: V-1, V-2, V-3, V-15 on all 18 worlds at $0, with their output digest recorded in the freeze | to run (about 1 CPU-hour) |
| A8 (optional) | Move LD-H ($2 inside P9) to right after P3: it answers Q6 at the lowest cost (§8) | reorder only |

**What does not change.**
- P1 stays valid. The author's gates involved none of L1, ADV or F, the bundle's sha256 is unchanged, and
  `.done-P1-author` keeps the chain from re-running it.
- Relaunch after the amendment is committed: move `runs/STOP-chain` and `runs/stagez/STOP.json` aside, then run
  `setsid nohup sh experiments/durability/dur1-chain.sh after-author > research/durability-20261021/runs/chain.log 2>&1 &`.

## 8. Next experiments, ranked by expected gain per dollar

| Rank | Experiment | Cost | What it answers | Why this rank |
|---|---|---|---|---|
| 1 | AMEND-DUR1-1 (A1–A7), gates re-run on all 18 worlds, re-freeze | $0, about 1 CPU-hour plus a review | nothing on its own, but it unblocks everything below | every DUR-1 number depends on it |
| 2 | Stage Z proper: S-H\*, W-M0, R-static, R-maint(0, 2, 7), R-ceil, REF-S, c-oss on 3 streams; twins, attribution; **K-0** | $0, 8–12 CPU-hours | the first per-world curves of the 9 static programs as the world changes (Q3, static side). Silent and loud failures under m1–m3 (Q1, partly). Reference and Opus-written comparators on the same worlds. Whether the monitor is blind (K-0) | infinite gain per dollar. K-0 also protects the $21 of P2/P3: if it fires, the paid heal rows stop |
| 3 | WC-1 at t0 | $0, ≤ 6 CPU-hours | the worst observed failure per program over a stated search (Q1 at t0); seeds ADV-SET | $0, and the only worst-case search before J2 |
| 4 | P0 rehearsal | ≤ $2 | first paid exercise of the heal and window paths; fixes the window size k | cheap insurance for $34 of P2–P4: no stubbed rehearsal of the paid chain exists (prereg §15 item 18) |
| 5 | P2 + P3: MH-H on s1–s2 (C-O inside) | ≤ $21 | **D-1, the core question**: does healing beat static, durable share, TTD, maintenance $ | the primary rule; heals cost cents per session in FH-1 |
| 6 | LD-H (from P9, if A8 is adopted) | ≤ $2 | D-8: do runs expose and heal flaws in a hand-crafted workflow (the owner's [46][70]) | a direct owner question at $2 |
| 7 | P4: A-H routed windows s1–s2 | ≤ $13 | D-3: does the built workflow match a per-tick Haiku agent where it matters | the second primary rule. Power is low at a true tie (0.59), so it is likely inconclusive if the two arms are equal |
| 8 | P7: J2 red team plus ADV-SET cross-run | ≤ $8 | the worst case under an Opus adversary; D-11; "did healing open new holes?" | the only adversarial test; the owner asked for worst case first |
| 9 | P8: A-Ox probe | ≤ $7 | D-7: success and $ per case against Opus 5.5 xhigh per tick | the owner's frontier bar, but descriptive (≤ 6 cases) |
| 10 | P6: REF-M on s1 | ≤ $6 | D-4: durable state against an expert-maintained (Opus) reference | needed for the "≥ a human's" sentence. R-maint (rank 2, $0) gives the ceiling-with-delay first |
| 11 | P5: stream s3 | ≤ $13 | power for D-1 and D-3; K-4 may drop it | adds no new question; the lowest gain per dollar |
| 12 | P9 rest: MH-stale, MH-H→O | ≤ $3 | D-9 (verifier dependency); a rare Opus patch | descriptive |

**Program-wide, at $0, beside rank 1:**
- Add the pre-freeze gate record (R5) to `research/PREREGISTRATION-TEMPLATE.md`.
- Add a property test for the bed's MR11 fault placement (R1) and record the bed finding in the E8 README. The bed is
  shared and frozen by other experiments, so both changes need their own dated note.
- No new workflow is needed for any of this: D35 holds.

## 9. What this does not show

- **No capability claim of any kind.** Not about the workflow, the monitor, the heal loop, the agent or Opus.
- **The diagnostics in §4 and §6 are post hoc.** They ran the reference policy on designer-known parts of six stream
  worlds. Stage Z does the same before any arm, so the stream seeds stay out-of-sample for every arm (dev-oos). The
  sealed changes were never loaded by these diagnostics.
- **A2′ is verified only without the sealed operators.** A1 is verified with them (first diagnosis, all 18 worlds).
  A3's floors under A2′ still have to be re-run.
- **The earlier evidence quoted in §0 is development evidence on small K.** It is not a substitute for DUR-1. The
  rows marked "via the map" were not re-checked here.

## 10. Files

All under `research/durability-20261021/` unless the path starts elsewhere.
- `RESULT-DUR-1.md`: this document.
- `runs/stagez/STOP.json`, `runs/stagez/s1.gates.json`, `runs/stagez/V11.json`, `runs/chain.log`,
  `runs/chain-author.log`, `runs/spend.jsonl`: the run records (`a6e6d385`).
- `runs/stagez/DIAGNOSIS-20261104.json`: the first $0 diagnosis (gates on all 18 worlds; A1 counterfactual). Corrected
  in §6.
- `runs/stagez/diag/`: the post hoc ADV-twin probes (`adv-twin-decompose.mjs`, `adv-twin-overlay.mjs`) and their
  outputs, with a README. They import the frozen modules read-only; their scratch directory is deleted.
- `SEALED.json`, `FREEZE-A.json`, `FREEZE.json`, `PREREG-DUR-1.md` (frozen), `BUILD-NOTES.md`, `BUILD-PLAN.md`,
  `DESIGN.md`, `EVIDENCE-MAP.md`.
