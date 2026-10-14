# Need router v1: the program (2026-10-14)

Status: design only. Nothing in this program has been paid for yet. No label exists. Numbers from earlier
work are development evidence (dev seeds, one build or one stream, K = 1) unless stated otherwise. They are
not held-out results.

This file is the final program. Companions: [PREREG-SKELETON.md](PREREG-SKELETON.md) is the preregistration to
fill in and freeze before any label is paid for. [SOURCES.md](SOURCES.md) lists the prior art and says what was
actually read. Inputs were five reader reports (design docs, evidence matrix, harness, beds, prior art), a judged
merge of three candidate designs, and an adversarial critique, all dated 2026-10-14. Appendix A records what I did
with each critique point. Appendix B lists every number used and where it comes from.

Tags: [M] measured or read in a repository file, [I] my inference, [D] a design intent, not a result.

---

## Owner summary

**What the need router is.** Before an agent starts on a job, a small piece of code looks at the job and says
one of three things: "no workflow, one call is enough", "no workflow, let an agent do it", or "build a workflow
first, then run it". It says why, what it expects the job to cost, and how often it expects a correct result. It
reads only what is known before the work: the job's size and shape, how often the job will recur, what a correct
result is worth to you, what a wrong one costs, and hard requirements such as approvals or waits.

**Did we drift? Yes.** Since 10-08, everything called "router" here decided *when to compile* a workflow after an
agent had already done 2–5 tasks of the same kind (`experiments/jit/router.mjs`). Your question, decided before
the agent works, has had zero runs. The kinetics result you were given (13/14 correct against 7/14 for a Haiku
agent, at about 18 times the cost per success) is mostly an Opus agent: 11 of the 14 deliveries were Opus
sessions, and the compiled workflow delivered 3 and passed 2 (recounted today from
`research/jit-20261008/runs/jit-r0-kinetics/`). It says little about workflows.

**What is new today.** On E8, our hardest task family (a 14-day order saga), the same Haiku builder made a useless
workflow in one shot (0%) and a perfect one when it could run its workflow against practice worlds while building
(1,022/1,022 cases, $0.39 to build). Opus in one shot scored 27.5% for $7.63 (`research/enterprise-20261014/
B1-E8-DEV.md`; one build each, dev worlds). Testing while building was the lever. So testing is part of this
program, not a side issue.

**How we will know it works.** Three tests on the same jobs, then one live lane.
1. *Label factory.* Run every mode on the same 12 tasks per job: one Haiku call, a Haiku agent, a Haiku agent
   following a procedure Haiku wrote first, an Opus agent, and a workflow Haiku builds and tests. An independent
   checker (the bed's oracle) scores every answer. A job "needs a workflow" when a workflow mode is clearly best.
   This is most of the work and most of the money.
2. *Workflow self-test.* Each built workflow ships its own check. We count how often that check says "pass" when
   the oracle says "fail". A workflow that cannot tell is not deployable, whatever the router says.
3. *Router test.* Freeze the router. Apply it to task families it never saw. It must beat the best fixed policy
   (for example "always use the Haiku agent") on value per task. Its "needs a workflow" calls must beat a tuned
   size rule.
4. *End to end.* Six unseen jobs go from decision card to build, self-test, run and checked delivery. You may
   overrule any card; overrides are logged and become labels.

**What to expect.** With 7–9 unseen task clusters we can probably learn whether "needs a workflow" can be read
from a task's structure (size, fan-out, hard requirements). Showing that the router beats a fixed policy needs
about 30 unseen families (our own earlier rule); we have about 9, plus yours. Unless the effect is large, the
first held-out reading will be "diagnostic" or "inconclusive". Your 20–30 real tasks are the only route to a firm
answer.

**What it costs.** About $950 if every stage runs (stage caps add to about $1,235). Stages run from $15 to $340
and each stays under the $500 pause. The core, through the first held-out reading and the live lane, is about
$660 (caps about $855).

**What happens first.**
- 10-15 → 10-17, $0: preregistration, label harness, and seven $0 checks on archived runs.
- 10-15/16, about $10: **the first real number.** One Haiku call on 8 W-bed task types (192 calls): does a
  single call already solve any of them? The "needs nothing" control must pass 10/12 or we stop and fix.
- 10-18/19, about $110: the first paired labels, all five modes, on a "needs nothing" control, records, and the
  strongest "needs a workflow" candidate, plus up to 5 of your tasks if they have arrived.
- About 10-29: the first reading on families the router never saw.

**What I need from you** (full list in §9): what a correct result is worth (default $1) and what a wrong one costs
(default: the same); whether an Opus agent counts as "no workflow" (recommended: yes); which "testing" you mean;
20–30 real tasks with acceptance checks by 10-28; approval of the first two stages (caps $15 and $140).

---

## 0. Starting point

**The drift.** THESIS (§1, §4) and ROADMAP §2.8 (`docs/ROADMAP.md:617-659`) describe the owner's goal: a decision
made before execution, from trusted features, with construction before the run. On 10-08 the JIT line inverted
this to "interpret first, compile the hot path" and called the compile decision "the router". `router.mjs` needs
2–5 traces and an observed agent cost before it can say anything (`experiments/jit/router.mjs:57-58`). The only
router evidence (DEV-NOTES D17, `analysis/router-replay/`) tests compile timing inside one family. README:110
still lists the need router as "Design only". [M]

**What is already built for this program** [M]:
- `experiments/need-router/`: `metrics.mjs` (label table, utility, SBS/VBS, closed gap, bootstrap, label
  confidence, slider sweep, calibration, leak test), `harvest.mjs` and `replay.mjs` (archived streams), `features.mjs`
  (12-key whitelist from example seeds), `router.mjs` (prior and kNN predictors, expected-utility router, LOFO),
  `voi.mjs` (value of information for probes). 34 tests pass (`node --test experiments/need-router/test/*.test.mjs`,
  run today). `router.mjs` and `voi.mjs` came in autosave commits and have not been reviewed.
- `research/need-router-20261014/features-census.json` (14 families, d3 and d5) and `replay-archived.{json,txt}`.
- Anchor beds `beds/need-qa` and `beds/need-constraint` are being written by another workflow (task #56).

**What has been measured** (all dev, mostly K = 1; Appendix B has sources):
- Flat families (records, kinetics, codefix, incident d3) have labels for some modes, on disjoint seed sets. No
  family has every mode on the same tasks.
- On records at N = 10, the no-workflow class wins at every V if an Opus agent counts as no workflow: at V = $1
  the Haiku agent leads (0.52 against 0.48 for the C0 static solver), at V = $10 the Opus agent leads (0.94 against
  0.65 success-equivalents per task) [I, from measured cells]. At N = 24 the static solver edges ahead at V = $1, so
  the answer moves with N, as it should.
- The positive class, jobs that should need a workflow (W-bed R1–R6, E8), has almost no measurement. E8 has
  construct-before results from today (above) and an agent-H paired run in flight (task #58).

**Why testing is the decision.** Whether a job needs a workflow is counterfactual. It can only be measured by
running every mode on the same tasks and scoring them with an independent oracle. So the program is a label factory
first, a frozen router second, a held-out read third, and a live lane last.

---

## 1. The decision

**Unit.** A *job* = (task family, difficulty band, declared volume N, value V of a verified success, cost W of a
wrong delivery, available verifier, typed hard requirements). A single request is a job with N = 1. A recurring
family is a job with its declared N. The router decides once per job, before the work, and the decision is pinned.
For an N = 1 job the router reads the task itself. For a recurring bed job it reads example tasks of the family
(dev seeds 601–609), never the evaluation tasks.

**Answers.** Three classes, five paid modes.

| Mode | Class | Settings (frozen and hashed at M0) | Replicates per task |
|---|---|---|---|
| `direct-H` | no workflow | `b0Call({id:'direct-H', model:'claude-haiku-5-5', reasoning:'none', maxTokens:16000})`. Per-call timeout 600 s (provider setting; P1 used 300 s and 30 of 108 calls hit it). A timeout is charged at the $1 per-call bound (`maxBudgetUsdPerCall`), never $0. Masked on interactive families. | 2 draws |
| `agent-H` | no workflow | `b0Agent({id:'agent-H', model:'claude-haiku-5-5', budgetUsd:2, timeoutMs:15*60e3})` | 2 draws |
| `agent-O` | no workflow (decision 4) | `b0Agent({id:'agent-O', model:'claude-opus-5-5', budgetUsd:4, timeoutMs:20*60e3})`; `budgetUsd:8` when the job's example inputs exceed 30K tokens | 1 draw, plus a racing top-up (§2) |
| `agent-H+proc` | workflow (guided) | Build: one Haiku call (`reasoning:'medium'`) reads example set k (prompts, inputs truncated to 30K tokens, the output schema; no answers, no oracle) and returns `{procedure (≤ 1,500 words), checks[]}`. Run: agent-H settings, plus `PROCEDURE.md` in the workdir and one prompt line telling the agent to follow it and write `checks.json`. | K = 2 procedure lineages (example sets 1, 2); each runs all 12 tasks once |
| `construct-H` | workflow (built) | `construct({arm:'B1', familyId, probeSeeds:<example set k>, difficulty, builderModel:'claude-haiku-5-5', builderEffort:'high', builderBudgetUsd:3, constructionModelUsd:1.5, perTaskUsd:1, minutes:30, scoreChecks:0, models:['claude-haiku-5-5'], selfCheck:true})`, then `b1Script({id, scriptPath, modelPort, perTaskUsd:1})`. With `scoreChecks:0` the builder never sees an oracle score, but it can run its solver on the example inputs (`tools/run-solver`, `experiments/c0/construct.mjs:67-72`): a test loop without an oracle, the analogue of E8's B1L. `selfCheck:true` is new (M0): the builder must also deliver `check.mjs task.json answer.json`, exit 0 or 1, no model calls. | K = 3 lineages (example sets 1–3); each runs all 12 tasks once |

- **Derived at $0 from the paired rows** (no extra runs): `construct-H→agent-H` (on null, crash, schema-invalid
  output, or a failed self-check), `direct-H→agent-H` (null, crash, schema-invalid), `agent-H→agent-O` (null).
- **Ceiling arms, for the L_ceiling label set only:** `build-O` (the construct-H settings with
  `builderModel:'claude-opus-5-5'`, `builderBudgetUsd:8`, K = 1) on r3-hi, r1-hi, kinetics-hi, synth-hi and r3p;
  the frozen W-bed R1 and R3 references with live judges, only if the M0 engine stamp carries `static@v3:` (the paid
  kit E1c does not).
- **Classes.** No workflow = {direct-H, agent-H, agent-O and their cascades}. Workflow = guided {agent-H+proc} plus
  built {construct-H, its cascade, build-O, references}. The binary need label uses these two classes. The three-way
  split (none, guided, built) is reported beside it.
- **Not in v1:** JIT compile timing, library reuse, `template`, `construct+`, `direct-S`, an `ask` mode. Archived JIT
  and C0 rows are LEGACY labels only. Each re-enters in v2 only if the v1 labels show positive-class headroom that no
  v1 mode captures.

**Inputs the router may read.**
- Structure features from `features.mjs`, narrowed to 8 keys: `logInputTokens`, `logSchemaLeaves`, `itemLists`,
  `maxListLength`, `freeText`, `multiSource`, `conventionsInProse`, `verifiable`. The four prose-count keys
  (`effectVerbs`, `timeWords`, `humanWords`, `promptWords`) leave the trusted set: they count words in untrusted
  task text, and they are zero on most families (census: nonzero effect or human words only on codefix and r2).
  They stay as inputs to the keyword baseline.
- Declared fields: N, V, W, verifier (none, schema, executable tests), typed hard requirements (durable wait,
  schedule, human approval, effects with authority, audit beyond the journal).
- **Banned:** family id, bed version, bed `kind`, any oracle, reference, label or result file. These appear only in
  shortcut baselines. A test enforces it (L5).

**Output: the decision card `need-decision/1`.**
`{job, features, featuresHash, guard:{forced, requirement, engineSupport}, structure:{intrinsic, reason}, probe:{ran,
modes, k, signals, costUsd} | null, pred:{<mode>:{p, c, F, q}}, U:{<mode>}, choice:{mode, cascade}, needsWorkflow,
class, askFlag, routingCostUsd, routerSha, propensity:1}`. `askFlag` is set when a probe disagrees with itself and
no deployable verifier exists. It is logged, not scored, in v1.

**Switching.** The decision is pinned for the job. At run time a cascade fires only on null, crash, schema-invalid
output or a failed self-check. A re-route checkpoint after task 4 (switch construct-H to agent-H when 50% or more
of tasks fell back) and an online block-pinned policy are $0 secondaries replayed from the matrix (§3).

---

## 2. Ground truth: the label factory

**The matrix.** `M[job][mode][task][replicate] = {pass, score, delivered, schemaValid, selfVerdict,
deployableVerdict, usdReported, usdRepriced, usdImputed, ms, tokens, error}`.
- 12 evaluation tasks per job, spread evenly over the job's difficulty band. TRAIN tasks use dev 610–621. Held-out
  tasks use test 8801–8812.
- Example sets (dev): set 1 = 601–603, set 2 = 604–606, set 3 = 607–609, at the same difficulties. They feed the
  features (set 1), the builders and procedure writers (set k for lineage k), and the probe (seed 601). They are
  never scored as evaluation tasks.
- A build row holds `{usd, minutes, artifactSha, failed, runSolverCalls, hiddenPathAttempts, nestedModelAttempts}`.
  A failed build fails every task of that lineage in the pure mode.
- `deployableVerdict` is what a user could check without our oracle: schema validity everywhere; plus the
  family-handed tests where they exist (codefix and ownerci visible tests; E8's smoke host).

**Racing replication** (replaces a uniform K, critique change 8). Start at the replicates in the §1 table. After a
first pass, compute P(best class) for each job by the hierarchical bootstrap below. Where it is under 0.8, add one
draw or lineage to the modes inside the acceptable set, up to 4 per mode. agent-O gets a second draw on every task
where it is in the draw-1 acceptable set. Top-ups use no new tasks.

**Utility per task, in success-equivalents:**

```
u_m = p_m − c_m/V − B_m/(N·V) − (W/V)·q_m − r/(N·V)
```

p = oracle pass rate; c = mean per-task cost; B = build cost, failed builds included; q = rate of delivered,
schema-valid, wrong answers (silent misses); r = routing cost (probe and judge calls). An abstention (null, or a
self-check failure that is not delivered) costs nothing beyond its dollars. **Headline cell: V = $1, W = V, N = 10.**
W = V means a silent wrong answer costs as much as a right one is worth. It is the default unless the owner declares
another W before the M0 freeze (decision 3). N = 10 needs no extrapolation from 12 tasks. N = 1 is the
intrinsic-need reading (C7a). N = 100 is labelled "extrapolated, stationarity assumed". Latency is reported per mode
(median); it enters utility only in a sensitivity at an owner-declared λ_t, because wall times in this harness are
confounded by concurrency and stalls (one stall lasted 187 minutes [M, reader B]).

**One cost meter.** Agent arms book the CLI's own session figure (`b0-agent.mjs:57`). Direct calls and script
nodes book gateway pricing. `label-run.mjs` re-prices every row from recorded token usage (`streamUsage`, gateway
`usage`) with one pinned price table, cache reads and writes included, and reports both figures per arm. Utility
uses the re-priced figure. Killed sessions and timeouts are charged at their bound. Every report splits measured
from imputed dollars. A cell with more than 30% of its dollars imputed is left unlabelled.

**Oracle without optimistic bias (VBS\*).** Choosing each task's best mode from single noisy runs flatters the
oracle (Cameron, Hoos and Leyton-Brown 2016). Primary procedure: select each task's mode on replicate 1 and score
it on replicate 2 (for construct-H: select on two lineages, score on the third, rotating). Two-direction averaging,
where every mode has two replicates, is a sensitivity. Task halves are fixed by seed parity. VBS\* ≤ VBS is a
unit test.

**Acceptable set and need labels.**
- δ = 0.03 success-equivalents (`FLOOR_POINTS = 3`, `experiments/jit/stats.mjs:39`). A = {m : u_m ≥ u_max − δ}.
  Ties go to the cheaper mode.
- NEED label = `workflow` or `no-workflow` only when every member of A is in one class. Otherwise `either`.
- Confidence: hierarchical bootstrap (cluster → task → replicate or lineage, 2,000 reps, seeded). A label is
  confident when P(best class) ≥ 0.8.
- Need accuracy is computed on confident labels only, and **coverage** (the share of jobs with a confident label)
  is always printed beside it. Utility statistics use every cell, labelled or not.
- If more than 50% of held-out jobs are `either` or unconfident, the reading is "the benchmark cannot separate
  routers".
- **Fragility.** Where an oracle has a numeric tolerance, labels are recomputed with the tolerance halved and
  doubled (for records, field accuracy ≥ 0.985 and ≥ 0.94 around the 0.97 rule). Jobs whose label flips are
  "fragile": excluded from need accuracy, kept in utility, counted in every report. This is $0.
- **Descriptive label:** the break-even V\*(job, N) at which the best mode changes class.

**Two label sets.** L_today uses construct-H and agent-H+proc as the workflow modes. It is primary, and the router
is trained on it, because the router deploys today's builder. L_ceiling also admits build-O and the references.
When the router says "workflow" and only L_ceiling agrees, that is a builder gap, not a routing error.

**Testing the workflow itself** (critique change 3). Per construct-H lineage and per agent-H+proc lineage:
- false-pass rate = P(self-check pass | oracle fail) among delivered answers; false-fail rate = P(self-check fail |
  oracle pass);
- `runSolverCalls` (how much the builder tested), build minutes and dollars;
- for construct-H, the cascade on self-check failure is scored like any other mode.
A lineage with at least 10 oracle failures and a false-pass rate above 0.2 trips F11 (§5). Its self-check earns no
credit: its deliveries are treated as unverified, like an agent's. E8 supplies the one-shot versus loop contrast
(B1-H, B1-O, B1L-H) at $0 to this program.

**Validity gates.** Each blocks claims until fixed.
- direct-H on wbed-r0 passes at least 10/12 (M1 and NL0). Otherwise stop: the anchor or the harness is broken.
- An arm with more than 25% environment faults is invalid (`ENV_FAULT_LIMIT`, `stats.mjs:42`).
- `taskHash` pairing is asserted across modes. Example and evaluation tasks are disjoint by hash (codefix and
  ownerci have low-difficulty and pool collisions; a collided seed is replaced from the top-up range).
- `hiddenPathAttempts > 0` or `nestedModelAttempts > 0` voids a lineage automatically (today only the second does).
- ownerci construct-H solvers are scanned for module text copied from the examples (the bed's known majority-vote
  leak, AUDIT F10); a hit voids the lineage.
- Archived rows (P1, C0, JIT streams, Stage B) are tagged LEGACY and never pooled with new labels.

---

## 3. Router v1

Two co-primary policies, tested with Holm correction over the two. Everything else is a secondary in a fixed order.

**Stage 0. Hard guard (code, never learned).** A typed hard requirement sets `needsWorkflow = true` and restricts the
choice to the workflow class, flagged "engine support missing" when `state`, `wait.signal`, human-task or
compensation constructs are absent. Forced jobs (E8, runbook) are left out of the primary population and reported
as their own stratum. `REQUIREMENT_LIBRARY` and `shapeOf` word cues only raise "ask the user"; they never force a
mode. RX6-lite (§7) measures guard recall; under 0.9, the guard asks instead of inferring.

**Stage 1. Structural rule (H0).** The preregistered hypothesis: *a job needs a workflow intrinsically when it is too
big or too wide for one context, or when a hard requirement exists; everything else is declared economics (N, V, W,
executor strength).* As a rule:

```
intrinsic(x) = logInputTokens(x) ≥ θ_tok  OR  maxListLength(x) ≥ θ_fan
```

θ_tok and θ_fan are fitted on TRAIN by leave-one-cluster-out to maximise the balanced accuracy of confident N = 1
NEED labels. Ties go to the larger threshold (fewer workflow calls). They are frozen by hash at Freeze. For scale
[M, census]: r0 is about 0.4K tokens, records d3 7.1K, r3 d5 62K with lists up to 1,518 items, r4 d5 155K.

**Stage 2. Leaf calculator.** For each (V, N, W) cell and each rule leaf (intrinsic or not), the mode with the best
mean TRAIN utility among TRAIN jobs in that leaf. The policy is a one-split tree whose leaves are fixed modes. It can
beat the single best fixed mode only if the best mode differs between leaves, which is exactly the claim.

- **NR-static (co-primary A)** = stages 0, 1, 2. No model call before the work.
- **NR-probe (co-primary B)** = stages 0 and 1, then `voi.mjs bestProbe`, then stage 2 with updated rates. Probeable
  modes: direct-H and agent-H, k ≤ 2, on example 601 only. Priors per mode: Beta(1 + s, 1 + n − s) from the TRAIN
  jobs in the job's leaf. Observations are deployable signals only: schema validity, agreement of the two direct-H
  answers, agent-H turns and cost, and family-handed tests. Never the bed oracle: that would be a label peek. The
  probe runs only when net EVSI > 0, and its cost is charged as r. Whether a probe counts as "before the agent
  works" is owner decision 7; if the owner says no, NR-probe becomes a secondary.

**The slider is V.** Positions: Frugal $0.10, Balanced $1 (headline), Careful $10. Each position shows its held-out
operating point (realised success, $ per task, wrong-delivery rate), or "uncalibrated". A budget mode with λ search
(Dekoninck et al.) waits for v2.

**Routing cost.** NR-static costs $0. NR-probe costs about $0.16 per probed job (two Haiku calls at
$0.026–0.030 each [M, `triviality.mjs:55`], one Haiku agent run at about $0.10 [M]). That breaks 10-STATE's
"decision under 2% of the task" at N = 10 for cheap jobs. Utility already charges it, so the 2% figure is reported,
not used as a gate.

**Secondaries** (fixed order; Holm within the family of secondary router tests):
1. `NR-knn`: `knnPredictor` (k ∈ {3, 5}, chosen by LOCO on TRAIN) plus `expectedUtilityRouter` with the W·q term
   added. Demoted to the family-majority baseline if L8 (§6) shows its neighbours come from one TRAIN cluster on 80%
   or more of held-out jobs.
2. `judge-H`: one Haiku typed call per job (spec, a truncated example, N, V, the mode menu), 3 draws, majority vote,
   cost charged. Per-task LLM routing is excluded on cost.
3. `NR-probe-oracle` (upper bound only): a one-example acceptance check by the user (decision 9).
4. Checkpoint re-route after task 4 (§1).
5. Online replay: block-pinned policy, re-decided every 4 tasks with a switching cost, input "N so far", replayed over
   100 random task orders at stream lengths 1, 10 and 100 (Jikes' "future = past" estimate).
6. Portfolio-by-disagreement (analysis only, $0): per cell, P(direct-H wrong and construct-H wrong) against the
   product of the two rates. If they fail together far more than independence predicts (Knight and Leveson's
   finding for N-version software), agreement cannot serve as a verifier.

**The frozen artefact** (hashes go into the preregistration addendum at Freeze): `features.mjs` with the 8-key
whitelist, `router.mjs` after review (W·q term, δ ties, guard stage, leaf calculator, decision card), `voi.mjs`
after review, `evaluate.mjs`, the fitted θ_tok, θ_fan, k and the leaf modes per cell, and the price table.

---

## 4. Families, jobs and splits

Clusters follow the import graph and are frozen in the preregistration with a hypotheses table written before any
label. Families that share a world, generator or library stay in one split. r2 imports `beds/records/pools.mjs`; r3
imports `r1/world.mjs`; r4 imports r1 and r3; r5 imports r1 and r4; r6 imports `wbed/lib/domain.mjs` and `parties.mjs` [M, judge's
check]. So records and every W-bed rung except r3p form one cluster, W, and W sits in TRAIN. r3p imports only
`wbed/lib/{contracts,faults,prng}.mjs`; it is held out but flagged "near" (same author, same library).

Costs are the merged design's per-job estimates at 12 tasks with its replicates [I]. The added arm (agent-H+proc)
and racing add about 25% (folded into the stage totals in §7).

| Split | Cluster | Job (difficulty band) | Hypothesis, written before labels [D] | Est. $ |
|---|---|---|---|---|
| TRAIN | W | records-lo (d1–2) | direct | 12 |
| | | records-hi (d3–5) | agent at low V; slider-sensitive | 18 |
| | | wbed-r0 (d2–5) | direct; the negative control | 7 |
| | | r0-pad (new: R0 plus 10–20 irrelevant documents, about 20K tokens) | direct; breaks the length shortcut | 8 |
| | | wbed-r1-hi (d3–5) | agent at N = 1; workflow at large N | 30 |
| | | wbed-r2-hi (d3–5) | agent or direct; "looks like branching, not worth a workflow" | 20 |
| | | wbed-r3-hi (d4–5) | workflow: the strongest built-in positive | 45 |
| | | r3-mini (new: 2–3 statements) | direct or agent; breaks the fan-out shortcut | 6 |
| | | wbed-stage (new: one R1 list, one R2 document, one R3 difference, one R6 slice; 3 tasks each) | direct on a workflow-looking surface | 8 |
| | | wbed-r6 (d3–4) | open: agent or workflow | 60 |
| | kinetics | kinetics-lo (d1–3), kinetics-hi (d4–5) | direct; slider-sensitive (break-even near $5 per success) | 10, 17 |
| | codefix | codefix (d3–5), codefix-notests (new: visible tests removed) | agent; the no-verifier toggle | 14, 14 |
| | need-qa | trivia and arithmetic anchors (in flight, #56) | direct | 4 |
| HELD-OUT (NL2) | incident | incident (d2–4; d5 is about 248K tokens, cut) | agent | 30 |
| | synth | synth-lo (d1–2), synth-hi (d3–5) | direct; workflow at large N | 10, 22 |
| | ownerci | ownerci (d3–5) | agent; a wrong-reuse trap | 15 |
| | r3p (near) | r3p (d3–5) | workflow at d4–5 | 40 |
| | need-constraint | one-off constraint generation (in flight, #56) | direct | 4 |
| | far-1, far-2 | written after Freeze by an author who has not seen the router code (decision 11) | mixed | about 30 |
| HELD-OUT (NL2b, conditional) | gameqa | agent-H, agent-O, construct-H, agent-H+proc (direct masked) | agent at low d, workflow at high d | about 40 |
| FORCED stratum | runbook (NL2b), E8 (diagnostic) | runbook as gameqa; E8 from the in-flight #58 runs | structure forced by typed requirements | about 40; E8 $0 here |
| SEALED (NL3) | 4 sealed families plus the owner's 20–30 tasks | run once by a session that tuned nothing | unknown | about 160 |

- **Counts.** TRAIN: 4 clusters, 15 jobs. Held-out primary: 7 clusters if both far families are funded (5 if not),
  8 with gameqa. Sealed and owner tasks add about 5. Lane 05's claim threshold for C7b is 30 held-out families; v1
  cannot reach it.
- **Cut:** r4 and r5 (correlated with R1 and R3; about 155K tokens at d5), gridquest (no model has ever run on it),
  the `ask` mode (v2).
- **Admission.** A held-out family is admitted only after an audit by a session that did not write it, before its
  labels are viewed. runbook and gameqa lack AUDIT.md, so NL2b waits for that audit and an agent smoke.

**Seeds** (owner's ledger, decision 8; all ranges checked unclaimed today; held-out ranges respect
`heldoutMinSeed = 8001`):

| Purpose (new) | Split | Range | Use |
|---|---|---|---|
| `need-example` | dev | 601–609 | example sets 1–3; features, builders, procedure writers, probe |
| `need-label` | dev | 610–621 | TRAIN evaluation tasks |
| `need-label` | dev | 622–650 | TRAIN top-ups and collision replacements |
| `need-heldout` | test | 8801–8812 | held-out evaluation tasks |
| `need-heldout` | test | 8813–8824 | held-out top-ups and replacements |
| `need-heldout` | test | 8825–8836 | end-to-end lane (fresh tasks) |
| `need-heldout` | test | 8837–8848 | monthly drift re-check (24 tasks, about $5) |

M1 uses the W-bed's own attack seeds (dev 379–390; r3p 479–490), already in the ledger as `wbed-dev` and
`wbed-r3p-dev`.

---

## 5. Metrics, decision rule, falsifiers

**C7 is split in two** (critique change 1).
- **C7a, need detection.** "Whether a job needs a workflow can be read from its structure and declared hard
  requirements before execution." Metrics: balanced accuracy, precision and recall of the workflow class at N = 1
  (intrinsic need) and N = 10, Wilson intervals, on confident labels, with coverage printed. Compared with the
  majority class, the fixed size rule and the tuned size rule. Proposed claim grade: at least 10 held-out clusters
  including the owner-task set, and coverage of at least 50% (decision 16).
- **C7b, routing value.** "The need router beats the best fixed mode on held-out families, with calibrated slider
  positions" (ROADMAP:805). Claim grade needs at least 30 held-out families (lane 05). v1 reads it at diagnostic
  grade.

**Primary statistic (C7b).** Δ = the mean over held-out clusters, each weighted 1, of (u_router − u_SBS-train), in
success-equivalents per task, in the headline cell (V = $1, W = V, N = 10), on non-forced jobs and L_today labels.
SBS-train is the single best fixed mode on TRAIN jobs for that cell. Computed for NR-static and NR-probe.

**Inference.** With 5–8 held-out clusters, a percentile cluster bootstrap undercovers [I]. Primary: an exact
sign-flip permutation test over cluster-level Δ (2^n patterns; with 7 clusters the smallest p is 1/128 = 0.0078),
with the confidence interval from test inversion. Holm over the two co-primaries, one-sided, α = 0.05. The seeded
cluster bootstrap (10,000 reps) is a sensitivity. A hard floor follows: Holm's first step needs p ≤ 0.025, and with
5 clusters the smallest possible p is 1/32 = 0.031. **With 5 clusters (no far families, no gameqa), no reading can be SUPPORTED.** With 6
clusters the floor is 1/64; with 7, 1/128.

**One headline, the rest in order.** The headline is the cell above. Everything else (V = $0.10 and $10; W = 0 and
W = 10V; N = 1 and 100; L_ceiling) is printed in one fixed-order table marked "not primary". Results are never pooled
across V.

**Readings** (preregistered; applied to each co-primary policy):

| Reading | Condition |
|---|---|
| SUPPORTED | lower bound of Δ > 0, and point ≥ 0.03, and the policy beats the tuned size rule and judge-H (paired lower bound > 0), and the slider is calibrated (at most 1 of 3 positions misses; realised success and $ per task non-decreasing in V), and the sign of Δ holds with r3p dropped. "Useful size shown" only if the lower bound ≥ 0.03. |
| SUPERIOR, BELOW USEFUL EFFECT | lower bound > 0, point < 0.03 |
| REFUTED | upper bound < 0.03 at all three V, or the TRAIN gate G1 refuted |
| HARMFUL | upper bound < 0 at any V; that slider position is disabled |
| INCONCLUSIVE | anything else; the owner decides, with the achieved power printed |

Partial readings, stated in advance:
- NR-static fails but NR-probe is SUPPORTED: "need cannot be read from the spec; a one-example probe is required."
- C7a intervals cover the majority-class baseline: "the router cannot detect need from structure."
- C7a holds but C7b does not: "need is detectable, but routing on it does not pay at these values; ship the rule as
  advice plus the calculator."

**Gate G1 (TRAIN, after NL1).** On cross-fitted VBS\* − SBS headroom, per (V, N) cell at W = V:
- upper bound below 0.03 and below 20% of cost in every cell → REFUTED-PREMISE: stop paid labelling; ship the fixed
  policy, the guards and a V-threshold ladder (the calculator);
- lower bound above 0 in some cell at V = $1 → continue;
- anything else → the owner decides.
This replaces ROADMAP:632–634 if the owner agrees (decision 1).

**Falsifiers** (to add to ROADMAP §4.3, which has none for C7 today):
- F1: G1 refuted.
- F2: held-out Δ upper bound < 0.03 at every V.
- F3: no win over the tuned size rule or judge-H. Ship the rule instead.
- F4: the gain vanishes once guard-forced jobs are excluded. It belongs to the guards.
- F5: padding, keyword, gadget or paraphrase metamorphs flip more than 20% of routes where the labels do not flip.
- F6: any leak test fails. The evaluator is invalid and every claim is blocked.
- F7: the slider is uncalibrated or not monotone.
- F8: in a mixed-stream replay, no slider setting dominates both always-no-workflow and always-construct.
- F9: on owner tasks, regret is worse than SBS (upper bound < 0).
- F10: the gain appears on near held-out families (r3p) but not far ones. The claim is limited to near families.
- F11: a build path's self-check false-pass rate > 0.2 (with ≥ 10 oracle failures). That path is not deployable,
  whatever the router says.
- F12: at N = 1, the structural rule's held-out balanced accuracy has a lower bound ≤ 0.5. Need cannot be read
  from structure; only hard requirements and declared economics remain.

**Expectation, stated in advance.** With 5–8 held-out clusters, only a refutation or a large effect (about 0.15
success-equivalents per task) is likely to be detected. A good but moderate router will probably read SUPERIOR-BELOW-
USEFUL or INCONCLUSIVE. The program's firm outputs are the label matrix, the self-test measurements, C7a at
diagnostic grade, and the calculator.

---

## 6. Controls, leak tests and attacks

**Baselines** (scored from the matrix at $0, except judge-H): each fixed mode and cascade; SBS-train per cell and
SBS-global; SBS chosen on the test set (optimistic reference only); random routing at the router's mode mix (1,000
draws); the fixed size rule (under 2K tokens direct-H, 2–30K agent-H, over 30K construct-H); the **tuned size rule**
(one token threshold fitted by LOCO on TRAIN); `NONE_RULE` (`experiments/library/construct.mjs:58`); the keyword router
(`REQUIREMENT_LIBRARY` → construct-H, `src/construction-objective.mjs:21`); a `kind`-only router; family-majority by
nearest TRAIN cluster; judge-H; NR-probe-oracle. The value is also decomposed: always-agent-H (today's default) →
SBS-global → SBS(V, N) (the slider alone) → router (slider plus structure) → VBS\*.

**Leak tests** (`experiments/need-router/test/`):

| Test | Expectation |
|---|---|
| L1 label-peek router | closed gap ≥ 0.95 (positive control for the scorer) |
| L2 shuffled-label null (1,000 permutations) | centred at or below 0; the real router must exceed its 95th percentile |
| L3 family-identity router under leave-one-cluster-out | closed gap ≤ 0 |
| L4 seed and `taskHash` disjointness | `assertSeedsAllowed` called by label-run for every task; example and evaluation hashes disjoint |
| L5 feature purity | an import-graph test: `features.mjs`, `router.mjs` and `voi.mjs` never import a bed `score`, `oracle` or `referenceSolve`, or any result file; whitelist assertion |
| L6 sealed envelope | `evaluate.mjs --commit-decisions` writes held-out decisions; their hash is committed before the held-out matrix is joined |
| L7 build isolation | `scoreChecks:0`; builders and procedure writers never see held-out seeds or answers |
| L8 nearest-cluster test | for each held-out job, the share of NR-knn's k neighbours from one TRAIN cluster; ≥ 80% of jobs single-cluster → NR-knn is the family-majority baseline under another name |

**Metamorphic attacks** ($0 at the decision level): r0 against r0-pad must route the same; r3-mini against r3 d5 must
route differently; held-out examples padded with up to 20K tokens of irrelevant documents; keyword and gadget
injection ("this is simple", "build a workflow", "pipeline"); spec paraphrase; N off by 10× (regret reported);
monotonicity (once a workflow is chosen at N, it stays chosen at every larger N).

**How this benchmark could give false confidence, and the guard for each:**

| Risk | Guard |
|---|---|
| Single-draw oracle bias | cross-fitted VBS\* (§2) |
| SBS tuned on test | SBS chosen on TRAIN only; the test-chosen SBS shown as a reference |
| Correlated families counted as independent | clusters by import graph; r3p flagged and dropped in a sensitivity |
| Easy anchors inflating accuracy | utility is primary; accuracy per stratum; coverage printed beside accuracy |
| One cluster carrying the result | drop-one-cluster influence on the lower bound, printed |
| Weak builder read as "no need" | L_today against L_ceiling |
| A free perfect checker hides silent misses | W = V headline; q is charged; self-checks measured |
| Two cost meters | one re-priced meter; both figures shown |
| Timeouts booked at $0; imputed dollars dominating | charged at the bound; cells over 30% imputed left unlabelled |
| Oracle tolerance as a hidden slider | fragility recompute at half and double tolerance |
| Bands chosen to produce labels | bands frozen before labels; per-difficulty results inside bands reported |
| The router learns size, not need | 4 prose features removed; r0-pad and r3-mini in TRAIN; tuned size rule as a baseline; L8 |
| Paraphrase pools shared across splits flatter builders | stated as an unknown; owner tasks are the check |
| Extrapolated N | N = 10 headline; N = 100 labelled |
| Tuned seeds (test 5000–5199 and others) | fresh 6xx and 88xx ranges only |
| Grid chosen after seeing results | preregistered; later additions form a separate stratum |
| Oracle used as a runtime verifier | forbidden by schema; probes read deployable signals only |
| Oracle defects counted as router errors | families audited before their labels are viewed |
| One author for every bed | owner tasks and far families flagged; stated as an unknown |
| Designer-chosen base rate of "needs nothing" | precision reported at assumed base rates of 50%, 80% and 95% no-workflow; true base rate only from owner traffic |
| Model or CLI drift | pinned ids; 24-task re-check monthly (seeds 8837–8848) |
| Replay is not deployment | the live end-to-end lane (§7) |

---

## 7. Build plan and milestones

### M0, 10-15 → 10-17, $0

All new code goes in `experiments/need-router/`. Nothing in flight is touched.

1. `research/need-router-20261014/PREREG-NEED-V1.md`, filled from [PREREG-SKELETON.md](PREREG-SKELETON.md), with the
   hypotheses table, frozen and committed before NL0. A machine-readable `prereg/stages.json` holds jobs, arms,
   seeds and caps.
2. `metrics.mjs`: the W·q and r terms; lineage and cluster bootstrap levels; cross-fitted VBS\*; acceptable sets and
   NEED labels; coverage; fragility recompute; SBS per cell and SBS-global; the sign-flip permutation test.
3. `label-run.mjs`, wrapping `runExperiment` (`experiments/lib/runner.mjs:32`) and `construct()`: calls
   `assertSeedsAllowed`; imputes bounds; writes build rows as fixed costs; re-prices every row; voids lineages on
   hidden-path or nested-model attempts; runs racing top-ups; books probe rows. `--dry` with stub ports must give a
   byte-identical report on rerun.
4. New arm pieces: `selfCheck` in `construct()` (one prompt paragraph plus a post-run `check.mjs` call recorded as
   `selfVerdict`); `procedureFile` in `b0Agent` plus a procedure-writer call (`agent-H+proc`); per-seed difficulty
   for `probeSeeds` on banded jobs.
5. `harvest.mjs`: tag LEGACY rows; rescue the git-ignored `experiments/runs/{p1,c0-dev}` JSONL into
   `research/need-router-20261014/archive/`.
6. Review `router.mjs` and `voi.mjs`; add the guard stage, the structural rule, the leaf calculator, δ ties and the
   decision card.
7. `evaluate.mjs`: baselines, metrics, L1–L8, the metamorphic runner, the power simulation, `--commit-decisions`.
8. Generators r0-pad, r3-mini, wbed-stage and codefix-notests, each reusing existing oracles, with controls, tests
   and a README that says "routing anchor, not a Tier-A bed".
9. Tests, the centre of the program: synthetic matrices with planted optima (the router recovers them; VBS\* ≤ VBS;
   the peek router scores 1; a constant SBS scores Δ = 0; random scores its expectation); at most 5% false SUPPORTED
   under null simulations; import-graph, whitelist, determinism and monotonicity checks; seed refusals.
10. **$0 diagnostics on archived rows and the census** (LEGACY-tagged; the first numbers of the program):
    - D0: NR-knn neighbours under LOCO on the census, and the L8 share.
    - D1: shortcut audit — does `logInputTokens` alone reproduce the hypotheses table?
    - D2: co-failure — P(agent-H wrong and static-b1h wrong) against the product, records dev stream.
    - D3: ex-ante against post-hoc (Dekoninck et al.) — do deployable post-hoc signals (schema validity, turns, cost)
      predict the oracle better than structure features?
    - D4: tolerance fragility on archived records and kinetics rows.
    - D5: RX6-lite — guard recall against declared truth on the 449-item corpus overlay and the typed fields of E8
      and runbook.
    - D6: cost-meter delta — CLI-reported against token re-priced, on archived agent rows.
11. Seed-ledger proposal to the owner (§4 table). The ledger is the owner's file; this program does not edit it.
12. Engine stamp for M1–NL3 (ROADMAP §6 rule 13), with `static@v3:` if the references are to run.

### Paid stages

Launch, by the coordinator, for every paid stage:

```
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" LANG="$LANG" TERM="$TERM" CLAUDE_CODE_OAUTH_TOKEN=... \
  node experiments/need-router/label-run.mjs --stage <ID> \
    --prereg research/need-router-20261014/PREREG-NEED-V1.md \
    --work-root /var/tmp/foundry-work/need/<id> \
    --out research/need-router-20261014/runs/<id> [--dry]
node experiments/need-router/evaluate.mjs --labels research/need-router-20261014/runs \
    --split <train|heldout> --report research/need-router-20261014/analysis/<id>/
```

Agent concurrency at most 4. A stage stops at its cap and is analysed as it stands, with no reruns. Estimates are
[I] from measured per-task costs (Appendix B), plus about 25% for agent-H+proc and racing.

| Milestone | When | What | Est. | Cap | What the owner gets |
|---|---|---|---|---|---|
| M0 | 10-15 → 10-17 | code, preregistration, tests, D0–D6 | $0 | – | $0 diagnostic numbers; a frozen protocol |
| **M1** | 10-15/16 (needs no new code) | `node beds/wbed/attacks/triviality.mjs --rung all --difficulty 3 --efforts none,medium --emit /var/tmp/foundry-work/need/m1/`, then the printed `runExperiment` call shape (two `b0Call` arms, `trials: 1`, `envFaultRule: true`), results to `research/need-router-20261014/runs/m1/`. 8 rungs × 12 seeds × 2 efforts = 192 calls. | $10 | $15 | **The first real number:** does one Haiku call suffice on any W rung? It is also the W-bed's preregistered admission gate (R0 ≥ 10/12; the others ≤ 2/12). |
| M1e | when #58 commits | read the in-flight E8 runs: agent-H paired with B1L-H (lineages 1–3), B1-H and B1-O, on the same 9 dev worlds | $0 here | – | the first paired positive-class label: an agent against a tested Haiku workflow on a forced, long-running family (diagnostic) |
| **NL0** | 10-18/19 | records-hi, wbed-r0, wbed-r3-hi with all five modes; build-O and (if stamped) the live-judge R3 reference on r3-hi; up to 5 owner tasks as dev (all modes, one replicate) | $110 | $140 | the first paired five-mode labels next to the negative control; the first self-test false-pass rates; harness and cost-meter validity |
| NL1 | 10-20 → 10-23 | the other 12 TRAIN jobs; build-O on r1-hi and kinetics-hi; judge-H on TRAIN | $272 | $340 | G1 headroom gate; power gate; LOCO dev numbers for C7a and C7b; θ fitted |
| Freeze | 10-24 | fit θ, leaf modes, k and probe settings; hash the router; preregistration addendum; commit held-out decisions | $0 | – | a frozen router and a committed decisions hash |
| NL2 | 10-25 → 10-28 | held-out jobs (§4); build-O on synth-hi and r3p; judge-H on held-out | $206 | $270 | **the first held-out C7a and C7b readings, about 10-29** (diagnostic grade) |
| E2E | 10-29 → 11-02 | 6 held-out non-forced jobs drawn by a seeded draw; decision card → owner may override (logged, 48 h window) → build with self-check → 12 fresh tasks (test 8825–8836) → delivery gated by the deployable verifier; oracle offline | $60 | $80 | the live lane: realised against predicted success and $, overrides as labels |
| NL2b | 10-29 → 11-04, if the audit and smoke pass | gameqa (held-out) and runbook (forced stratum) | $98 | $140 | one more held-out cluster; a guard test |
| NL3 | when the owner's tasks arrive (target 10-28) | 4 sealed families plus 20–30 owner tasks, run once by a session that tuned nothing | $190 | $240 | the sealed reading; the first non-Claude-written, true one-off tasks |
| judge-H | with NL1 and NL2 | about 180 typed calls | $5 | $10 | the "just ask a model" baseline |
| **Total** | | | **about $950** | **about $1,235** | under the $1,500 session soft cap (`policy/models.json:21-23`); every stage under the $500 pause |

Core only (M1, NL0, NL1, NL2, E2E, judge-H): about $663, caps about $855.

**Kill and stop rules** (PREREG-SKELETON §11 has the full list): the R0 control fails → stop; any leak test fails →
block claims; an arm over 25% environment faults → invalid; a stage at its cap → stop and analyse; NL0 cost per job
over 1.5× estimate → re-plan before NL1; G1 refuted → stop paid labelling after NL1.

---

## 8. What plugs in, what pauses

**Plugs in:**
- `experiments/need-router/{metrics,harvest,replay,features,router,voi}.mjs` and their 34 tests: the core.
- `runExperiment` with `b0Call`, `b0Agent` and `b1Script`; `experiments/c0/construct.mjs` (W-bed arm (e) settings plus
  `selfCheck`); `tools/run-solver` as the build-time test loop.
- `beds/wbed/attacks/triviality.mjs` for M1.
- `experiments/jit/stats.mjs` (`FLOOR_POINTS`, `ENV_FAULT_LIMIT`, `pairRows`, `wilson`) and
  `experiments/lib/stats-ebed.mjs` (`holm`, `clopperPearson`, `wilcoxonExact`).
- `shapeOf`, `NONE_RULE` and `REQUIREMENT_LIBRARY` as features and baselines.
- W-bed R1 and R3 references for L_ceiling, if the engine stamp carries `static@v3:`.
- Anchor beds `need-qa` and `need-constraint` from the in-flight anchor workflow (#56).
- E8: the in-flight B1L-H lineages and agent-H paired runs (#58) become the diagnostic positive-class label and the
  guard test case. `experiments/ebed/smoke-service.mjs` is the model for "the family ships a practice sandbox".
- `analysis/verify-economics` supplies c_verify for any verified-delivery presentation.
- `analysis/router-replay`, re-run on paired per-task rows as LEGACY.

**Pause** (decision 13): #46 paid JIT stream track (its held-out ranges stay reserved); #33 JIT Day 3
router-as-compile; #40 composer; #42 judge leverage; #43 reuse C2; W-bed slice-1 arm (a) JIT and R2–R6 reference
authoring (the R1 and R3 live-judge runs stay as ceiling arms); library arm g and P2; Kev/Jev J2 and new ports; E-bed
E9–E13; E3 engine work beyond what E8 admission needs; prompt v5; verify-economics shadow tuning; UI.

**Keep running, untouched:** E8 build and admission (#54); the three blind specificity solvers
(`beds/ebed/e8/specificity/`); the B1 build session (`experiments/ebed/build.mjs`, `/var/tmp/foundry-work/ebed-build/`);
B1L-H lineages 2 and 3 and the agent-H paired run (#58); the oracle mutation run (#59); the anchor beds (#56).

**Document fixes, proposed, not applied here:** README:110 status; ROADMAP §4.3 gains F1–F12 and §5 a need-router
phase; C7 becomes C7a and C7b; `experiments/jit/router.mjs` is renamed in prose to "compile-timing policy"; D17 and
ATTACK's "Router with a slider: Negative" are relabelled as compile timing; THESIS's Kev becomes Jev; the "say no
workflow often" quote (LIBRARY.md:49, HARNESS-INTEGRATION.md:43), which is not in THESIS, is removed; the name
collisions R0, C7 and T1 are disambiguated.

---

## 9. Decisions that need the owner

1. **Kill rule.** Adopt the three-outcome form with five readings (§5), minimum useful effect 0.03
   success-equivalents per task at V = $1. It replaces ROADMAP:632–634.
2. **Slider (R-D1).** V grid {$0.10, $1, $10}, $1 the default and headline; N headline 10, with 1 and 100 reported.
3. **W, the cost of a wrong delivery.** Default W = V. Declare another value before the M0 freeze, or accept it.
   W = 0 and W = 10V are sensitivities.
4. **Frontier agent.** Does an Opus agent with no workflow count as "no workflow"? Recommended: yes. If yes, know
   that on flat families the answer is then decided by model strength, not structure: on records at N = 10 the
   no-workflow class wins at every V (§0).
5. **Meaning of "task".** Recommended: a job, where a single request is N = 1 and a recurring family has a
   declared N.
6. **Which "testing" you meant.** (a) testing the router, (b) testing each workflow before the agent relies on it,
   or both. This design covers both until you answer.
7. **May the router spend a few cents before deciding?** NR-probe runs two Haiku calls and one Haiku agent on one
   example. If you say no, NR-static is the only primary.
8. **Seed ledger** (your file): add purposes `need-example` (dev 601–609), `need-label` (dev 610–650) and
   `need-heldout` (test 8801–8848, held-out).
9. **One-example acceptance check.** May a user's acceptance check on one example be a router input in production?
   This decides whether NR-probe-oracle could ever be primary.
10. **Owner tasks.** 20–30 real tasks with acceptance checks, plus the list of your 10 most frequent recurring tasks
    (decisions 9 and 11 of the review), by 10-28. The first 5 run in NL0 as development tasks; the rest are kept
    for the sealed reading. Without them, no reading goes above diagnostic.
11. **Far families.** Fund 2–4 families written after the freeze by an author who has not seen the router code,
    ideally not Claude. Without them, and without gameqa, there are 5 held-out clusters, and the exact test
    then cannot reach significance at all (§5).
12. **Jev and Haiku judges.** Baseline and feature only, never the mode-picker, in v1.
13. **Pause list.** Approve §8.
14. **Spend.** Approve M1 (cap $15) and NL0 (cap $140) now; NL1 $340, NL2 $270, E2E $80, NL2b $140 and NL3 $240 at
    their gates.
15. **Sealed families.** Spend the 4 sealed families on this program rather than a C0 sealed round.
16. **Claim thresholds.** C7a claim grade at 10 or more held-out clusters including your tasks, with 50% or more
    confident labels; C7b at 30 or more held-out families (lane 05).
17. **Document fixes.** Approve the §8 list.

**My calls, which you may overturn:** the structural rule is primary and kNN secondary; W = V by default; N = 10 is
the headline; agent-H+proc is in v1; JIT is out of v1; all of cluster W is in TRAIN; agent-O starts at one draw.

---

## Appendix A. Critique dispositions

### A.1 The critic's ten ranked changes, and its two added owner decisions

| # | Change proposed | Disposition | One-line reason |
|---|---|---|---|
| 1 | Make the deliverable a need rule, a calculator and one live lane; preregister H0; split C7 into C7a and C7b; replace the 4-job live check with an end-to-end stage | **Accept**, with C7a's claim threshold left to the owner (decision 16) | With 4 TRAIN clusters a two-threshold rule is about all the data can support, and it answers the owner's question in terms he can check. |
| 2 | Add `agent-H+procedure` | **Accept**, K = 2 procedure lineages rather than 3 | It is the owner's sentence read literally and the cheapest workflow; K = 2 keeps the added cost near $100. |
| 3 | Measure the workflow's own testing (`selfVerdict`, false-pass rate, F11) | **Accept and extend** (self-check required of every build; E8 one-shot against loop read at $0) | Today's E8 results (0% one shot, 100% with a test loop, same builder) show the build's testing decides the outcome. |
| 4 | Fix the utility's bias: W = V primary, restore λ_t, charge c_verify | **Partly accept**: W = V headline unless the owner declares otherwise; λ_t only in a sensitivity; verification charged through q·W, not twice | Free silent misses bias the label toward no workflow, but latency here is confounded by concurrency and stalls and cannot carry a headline. |
| 5 | Put VOI probing in the primary decision; add `ask` | **Partly accept**: NR-probe is co-primary (Holm over 2); `ask` is a logged flag, not a scored mode | The routing literature finds ex-ante routing near random out of distribution, so the probe gets a head-on test; no bed scores "ask" yet except R2's review queue. |
| 6 | Owner tasks first; gate NL1 on them | **Partly accept**: up to 5 run in NL0 as dev, the rest kept sealed; NL1 not gated | They are the only real traffic sample, but idling the label factory on an owner deadline costs weeks and buys no information. |
| 7 | Kill the size shortcut: drop the 4 prose features, add a tuned size rule and L8, print kNN neighbours before paying | **Accept**, with L8 recast as a nearest-cluster test | Those features read untrusted text and are near-zero on the census; a leave-one-out family-id classifier is vacuous, so L8 tests whether kNN's neighbours all come from one cluster. |
| 8 | Racing replication; fragility gates; state agent-O's role in VBS\* | **Accept**; agent-O starts at 1 draw with a racing top-up | Uniform K wastes money on clear cells, and the top-up rule keeps the dearest arm affordable while every agent-O cell that can be selected gets a second draw. |
| 9 | One cost meter; auto-void on `hiddenPathAttempts` | **Accept** | Two meters turn a mode comparison into an accounting comparison; the void rule copies the existing `nestedModelAttempts` rule. |
| 10 | Make the online protocol primary for N > 1 | **Reject as primary; accept as secondary** (§3 item 5) | Stretching 12 tasks into 100-task streams re-imports the stationarity assumption; N = 10 headline needs no extrapolation. |
| 15 | Owner decision: which "testing" is meant | **Accept** (decision 6) | The two readings lead to different programs; both are covered until the owner answers. |
| 16 | Owner decision: is a frontier agent "no workflow", and tell the owner what that implies | **Accept**, merged into decision 4 | On records at N = 10 the no-workflow class wins at every V, so the owner should hear it before spending. |

### A.2 The critic's other findings

| Finding | Disposition | One-line reason |
|---|---|---|
| §1.1 workflow-then-agent reading has no arm | Accept (change 2) | Covered by agent-H+proc. |
| §1.2 the router never sees the task | Partly accept | For N = 1 jobs the router now reads the task itself; recurring jobs read examples, as a user would supply them. |
| §1.3 the binary collapses to "is a frontier agent worth it" | Accept | Stated to the owner (decision 4); H0 isolates the structural part. |
| §1.4 "testing" means testing the workflow | Accept (change 3, decision 6) | Measured as false-pass rate and F11. |
| §1.5 no end-to-end run; the design pre-writes its excuse | Accept | E2E stage added; the expectation stays stated in advance, because hiding it would be worse. |
| §1.6 the 13/14 kinetics point is mostly Opus | Accept | Recounted today (9 interpreter, 2 adjudicated, 3 compiled of which 2 passed); in the owner summary. |
| A1 K = 1 on agent-O; δ under the noise floor | Accept (change 8) | Racing top-up and explicit cross-fit; coverage shows how many labels are confident. |
| A2 N endpoints label assumptions | Accept | Headline N = 10; N = 1 is C7a's intrinsic reading; N = 100 labelled extrapolated. |
| A3 oracle tolerance is a hidden slider | Accept | Fragility recompute at half and double tolerance, $0. |
| A4 dropping "either" cells cherry-picks | Accept | Coverage printed beside accuracy; utility uses every cell. |
| A5 paraphrase-pool contamination flatters builders | Accept as an unknown | Cannot be fixed with these beds; owner tasks are the check. |
| A6 bands are labels | Partly accept | Bands frozen before labels and per-difficulty results reported; single-difficulty jobs would triple cost. |
| A7 train on L_ceiling, not L_today | Reject | The router deploys today's builder, so it must learn today's builder; L_ceiling is reported as the builder gap. |
| B1 utility biased against the positive class | Accept (change 4) | W = V headline. |
| B2 kNN equals a baseline | Accept (changes 1, 7) | kNN demoted to secondary; L8 decides whether it is just the baseline. |
| B3 four features read untrusted text | Accept (change 7) | Removed from the trusted set. |
| B4 import-graph disjointness is not distributional distance | Accept, reinterpreted | L8 plus the shortcut audit D1 measure what the features can tell apart. |
| B5 far families will be near on the whitelist | Accept | Only owner tasks are truly far; F10 stays; far authors must not see the router code. |
| C1 untuned size heuristic | Accept | Tuned size rule added. |
| C2 two jobs may carry the result | Accept | SUPPORTED requires the sign to hold with r3p dropped; drop-one-cluster printed. |
| C3 headline multiplicity | Accept | One headline cell; the rest in a fixed-order table. |
| C4 power admitted but not acted on | Accept | Exact sign-flip test as primary inference; the 1/128 floor and the likely INCONCLUSIVE stated in advance. |
| D1 two cost meters | Accept (change 9) | |
| D2 imputed dollars dominate cells | Accept (change 8) | Over 30% imputed → unlabelled. |
| D3 verification priced for nobody | Accept via W = V | Silent misses are charged; c_verify kept for verified-delivery presentations. |
| E1 the negative class is in-house; base rate unknown | Accept | Precision at assumed base rates of 50, 80 and 95%; owner traffic is the only true sample. |
| E2 unaudited and leaky beds in held-out | Accept | Audit by a session that did not write the bed before NL2b; ownerci leak scan voids lineages. |
| F1 isolation audit is manual | Accept (change 9) | Automatic void. |
| F2 replay is not deployment | Accept | The E2E lane. |
| §3.1 static structural analysis | Accept | It is Stage 1. |
| §3.2 two-stage decision with VOI | Accept (change 5) | NR-probe co-primary. |
| §3.3 online with sparse switching | Accept as a secondary (change 10) | |
| §3.4 portfolio with disagreement as verifier | Accept as a $0 analysis | Co-failure measured before any trust in agreement. |
| §3 `ask` first | Partly accept | Logged flag in v1; scored in v2 when a bed or owner task can score it. |
| §4 clinical rules: derivation, validation, impact | Accept as framing | NL1 is derivation, NL2 validation, E2E plus owner overrides a small impact step. |
| §4 racing; flaky-test practice | Accept (change 8) | |
| §4 presolving (SATzilla) | Accept | NR-probe is the presolver. |
| §4 operational profiles | Accept | Owner tasks and the recurrence list. |
| §4 programming by example as detector | Defer to v2 | Needs a `template` tier, which is not built. |
| §4 hedged requests | Reject for v1 | It doubles spend and answers a latency question the owner did not ask. |
| §4 capture-recapture for the miss bound | Reject for v1 | It needs independent verifiers; two Claude judges are not. |
| §4 fractional designs (8 tasks per job) | Reject | N = 10 needs at least 10 tasks per job without extrapolation. |

---

## Appendix B. Numbers used, with sources

| Number | Source |
|---|---|
| R0-K kinetics: JIT O→H 13/14 against Haiku agent 7/14 on 14 shared tasks; JIT deliveries: interpreter 9/9, adjudicated 2/2, compiled 2/3 | recounted today from `research/jit-20261008/runs/jit-r0-kinetics/*/results.jsonl` [M] |
| Haiku agent's 9 misses in R0-K scored 0.786–0.977 (schema-valid near misses) | same rows [M] |
| R0-K $ per success: JIT $2.55, agent $0.139 (18.4×; 21× on the shared tasks) | DEV-NOTES D32 (`research/jit-20261008/DEV-NOTES.md:1232`); reader B recount [M] |
| E8: B1-H $0.49, 0/155 at d2; B1L-H $0.39, 1,022/1,022 (651/651 tail); B1-O $7.63, 281/1,022; agent-H smoke 4/5 at $0.008 per tick | `research/enterprise-20261014/B1-E8-DEV.md` (result tables; commits aca04a0, c24ced4) [M] |
| Records dev stream: agent-H 15/24 at $0.103; agent-O 24/24 at $0.564; static C0 solver 16/24 at $0.050 plus a $1.372 build; JIT S→H 22/24 at $0.374 | DEV-NOTES D10, D12, D25; `research/need-router-20261014/replay-archived.txt`; reader B [M] |
| P1 records: direct-H 25/36 at $0.030 per trial; agent-H 29/36 at $0.111; hand workflow 35/36 at $0.016, authoring (≥ $24.91) excluded; 30 of 108 Haiku calls timed out, booked at $0 | `research/core-20261006/REPORT.md`; reader B [M] |
| C0 dev: B1-haiku 16/16 with 12 oracle-scored probe checks; F-haiku 11/16; probes passed 24/24 and did not predict evaluation; the F run verdict said "pass" on all 5 oracle failures | `research/construction-20261006/REPORT-dev.md:35`; README:109 [M] |
| codefix d3: Haiku agent 8/8 at $0.035 per trial | C0 dev; reader B [M] |
| Input sizes: r0 about 0.4K tokens; records d3 7.1K; r3 d5 62K, lists up to 1,518 items; r4 d5 155K; incident d5 248K | `research/need-router-20261014/features-census.json` (bytes/4) [M] |
| One Haiku call through the CLI costs $0.026–0.030 | `beds/wbed/attacks/triviality.mjs:55` [M] |
| Records at N = 10, success-equivalents per task: u(agent-H) 0.52, u(C0 static) 0.48, u(agent-O) 0.44 at V = $1; u(agent-O) 0.94, u(C0 static) 0.65, u(agent-H) 0.62 at V = $10 (the critic's 9.44, 6.48, 6.15 are the same in dollars) | the critic's arithmetic from the records cells above, rechecked [I] |
| Spend rule: pause before any single experiment over $500; session soft cap $1,500 (self-imposed, not an owner grant) | `policy/models.json:21-23`; README:330 [M] |
| Seed rules: held-out seeds ≥ 8001; dev 601–650 and test 8801–8848 unclaimed | `research/jit-20261008/SEED-LEDGER.json`, `experiments/jit/seeds.mjs:56`, checked today [M] |
| Need-router tests: 34 pass | `node --test experiments/need-router/test/*.test.mjs`, run today [M] |
| Per-job $ estimates | the merged design's estimates from measured per-task costs [I] |
