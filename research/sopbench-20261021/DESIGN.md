# SOP-Bench phase 2: build once, run frozen on sealed rows (design, not run)

2026-10-21. Status: **design for review; nothing in this file has run.** Phase 1 (acquisition, bridge, parity, frozen split,
dev baseline) is in [NOTES.md](NOTES.md). Every number below that is not a measurement is labelled an estimate.

## 0. The claim under test

PLAN.md (composition, 2026-10-21): "This is where the '90%+ reliable on recurring procedures' claim is tested on someone
else's benchmark." Concretely: **a workflow constructed once per SOP by Haiku 5.5, from the SOP text, the tool specs and 5
build rows, with the SOP's sections as typed sub-workflows, repaired only on dev repair rows and then frozen, answers
SOP-Bench's sealed rows with strict pass^3 ≥ 0.90, and more reliably than the Haiku agent acting per row through the same
mock tools.** Both arms, the tools, the scorer and the rows are fixed before the sealed run. Context from phase 1: the raw Haiku agent
scores 73.8% strict pass@1 (macro, 12 valid SOPs, dev rows, K = 1); its pass^3 is not measured yet and can only be lower.

## 1. Arms

| Arm | What runs per sealed row | Model calls per row | Built from |
|---|---|---|---|
| **W-H** (build once) | the frozen `solve.mjs` for that SOP, sandboxed, calling the SOP's tools through the bridge; `flow.judge` (Haiku 5.5) only where the workflow chose a model judgment | 0 to a few Haiku judge calls | one Haiku 5.5 builder session per SOP + at most 2 repair sessions |
| **A-H** (per-row agent) | the phase-1 baseline harness unchanged (`run.mjs`, same prompt, tool client, 10 steps, Bash only, $0.25 session reservation) | one `claude -p` Haiku 5.5 session | nothing (reads the SOP every row) |

Same model in both arms (`claude-haiku-5-5`, policy file), same tools (bridge, full world), same answer format
(`<final_output>` JSON), same graders, same rows, same k.

## 2. SDK and decomposition: decision

**Decision: write the workflows on the flow-v3 SDK (`experiments/jit/flow-v3.mjs`) with SOP sections as typed in-process
sub-workflows (`flow.phase` spans plus a section contract checked by the host port), built and repaired by a SOP-Bench builder
loop modelled on the JIT compile pipeline. Do not use `flow.call` for sections, and do not reuse `compile.mjs` as is.**

Why, from reading both:

- `flow.call(hash, input, …)` (flow-v3.mjs header, FLOW-V3-SLICE1/2) runs a **library entry by hash in its own sandbox**,
  with input-profile gates, carved budgets and refusals. It exists for reuse of compiled solvers across tasks. A SOP section
  is used by one SOP only, has no section-level ground truth to compile a library entry against (SOP-Bench grades only the
  final columns), and would cost a sandboxed child per section per row (about 6 sections × 1,693 sealed rows × 3 ≈ 30,000
  child sandboxes; "6 sections" is an estimate) for no correctness gain. It stays a stretch variant (§9) for the one case
  where it may fit: referral abuse v1 and v2 share two tool-backed steps, `investigate_account` and
  `analyze_traffic_patterns` (v2's return more fields) [inference].
- `compile.mjs` assumes **pure solvers**: a solver gets `task.json` and files, may call the model gateway, and has no effect
  port ("solvers have no effects"). A SOP workflow must call the SOP's mock tools mid-run, in an order it chooses. Its
  acceptance check compares outputs canonically against traces or regression answers, and its inputs come from bed families
  (`loadFamily`). The parts that fit are reused: the Claude Code builder session (`runClaudeCode`), the `run-solver` tool
  pattern, `flow-v3.mjs` copied byte-identical as `tools/flow.mjs`, the model gateway (`MODEL_TOOL`, `startServices`, ledger)
  for `flow.judge`, `runSandboxed` (no network) for the host check, and the regression format (task + expected).
- `flow.phase(name, fn)` already gives named section spans in the trace; `flow.guard`/`flow.invariant` give deopts;
  `flow.judge` gives narrow typed judgments with tiers and checks.

New code (all under `experiments/sopbench/`, nothing in `src/` or `experiments/jit/`):

1. `tools/sop.mjs`, the workflow's tool port: `await sop.call(name, args)` and `sop.batch([...])` over the same file
   mailbox and bridge as the agent (byte-compatible with `tool.mjs`), plus
   `sop.section(name, { input, output, tools }, async (input, port) => …)`: runs inside `flow.phase(name)`, validates `input`
   and the returned value against the declared JSON schemas, gives the body a port that refuses any tool not in `tools`
   (interface honesty: a section that reaches outside its declared effects deopts), and records per section
   `{name, tools used, output}` in the trace.
2. `build.mjs`, the builder loop (§3) and `exec.mjs`, the frozen runner (§5).
3. A bridge option `--world build|dev|full` (today the dev world holds build and repair rows; the build session must see
   only the 5 build rows).

## 3. Build (once per SOP)

**Builder input** (its sandboxed workdir; nothing else is reachable, executor isolation as in phase 1):
`sop.txt`; `catalog.json` (the tool definitions exactly as the agent gets them); `output-schema.json` (the output columns,
all strings); `build/row-<i>/task.json` and `build/row-<i>/expected.json` for the 5 build rows; `tools/flow.mjs` (flow-v3,
byte-identical), `tools/model.mjs` + gateway (Haiku 5.5 judges only), `tools/sop.mjs`; `tools/run-solver` (runs `solve.mjs`
on a build row through a live bridge on the **build-only world**) and `tools/check-build` (all 5 rows, strict scorer).
No agent traces, no repair or sealed rows, no other SOP.

**Builder prompt** (frozen with its hash before the first build): write `solve.mjs` that reads `task.json`, runs the SOP
as a parent orchestrator over one `sop.section(...)` per SOP section that makes a decision or calls a tool (the builder
chooses the boundaries; each section declares input, output and tools), computes every output column in code where the
SOP gives a rule, uses `flow.judge` only for judgments the SOP leaves to reading text (for example an e-mail's intent),
`flow.guard`s inputs it was not built for, and ends with `flow.done({<output columns>})`.

**Session**: Haiku 5.5, effort high, budget $3, 30 min (the E8 B1L-H builder took $0.39 and 19 min,
research/enterprise-20261014/B1-E8-DEV.md). The host then checks the result independently: a pristine copy of the solver
runs on the 5 build rows in `runSandboxed` (no network) with fresh bridges; strict scorer.

## 4. Repair (dev repair rows only), then freeze

- The host runs the candidate on the SOP's repair rows (15, or fewer for small SOPs: SPLIT.json) on the dev world, k = 1.
- If any strict miss: a repair session (Haiku 5.5, effort high, $1.50, 20 min) gets the failing repair rows' task, expected
  output, the solver's output and its trace (sections, tool calls, judge calls), and patches the solver. At most **2 repair
  rounds**. A version is kept only if it does not lose a build or repair row the previous version passed; the best version
  by strict dev pass count wins, ties to the earlier one.
- Repair rows thereby become development evidence; they are never reported as held-out.
- **Freeze** (before any sealed row is touched): `FREEZE-<date>.json` = `{kind: 'sopbench-freeze', splitSha256, sops,
  artifacts: {<sop>: {solveSha256, files}}, sdkSha256 (flow-v3.mjs), toolPortSha256, bridgeSha256, scorerSha256,
  runnerSha256 (both arms), builderPromptSha256, models, k: 3, budgets, decisionRule: §7}`, committed. The bridge and both
  runners refuse sealed rows without it (phase-1 code: `allowed_rows`, `assertRows`).

## 5. Sealed run

- Rows: every sealed row of every SOP in the valid set (§6): 1,693 rows for the 12 SOPs without patient_intake, 1,743 with it.
- **k = 3** independent runs per row and arm (fresh sandbox, fresh bridge on the full world each time), interleaved
  W/A per row so drift in the service hits both arms alike.
- Per run: the answer is graded by the phase-1 graders (upstream verdict through upstream's own `Evaluator.run_single_task`;
  strict verdict in Python and JS, which must agree). An environment fault (rate limit, usage limit, sandbox) is never a
  fail: the run stops and resumes.
- Sealed per-row records go to `results.sealed.jsonl` under `/var/tmp/foundry-work/sopbench-rows/<run-id>/` (outside the
  repo, as every per-row record: CC BY-NC); no per-row grade is printed while the run is open; the repo gets aggregates.

## 6. Valid SOPs (fixed now, before any sealed data is seen)

| SOP | In the primary set | Why |
|---|---|---|
| content_flagging | **no** | its BPI tool draws `random.random()`; following the tool chain reproduces the ground truth on about 36% of draws on dev rows (8 of 20 rows never; `cf_ceiling.py`); upstream also passes the ground-truth column to the agent (legacy-mode leak). Reported separately |
| patient_intake | **owner decision** | synthetic, but a patient-intake procedure: AGENTS.md lists "patient/lab operations" as out of scope and the benchmark note asked for owner approval for synthetic medical beds. Excluded from paid runs until the owner says yes |
| aircraft_inspection | yes, flagged | its 7 tools return the 7 ground-truth columns directly (tools.py, `return matched_rows.iloc[0][<output column>]`): an orchestration-only SOP. Also reported in an "excluding orchestration-only SOPs" macro |
| order_fulfillment | yes, flagged | not in the paper's Table 3/4; 30 rows (23 sealed); upstream legacy mode leaks its answer column (we do not) |
| warehouse_package_inspection | yes | upstream's loader cannot load it (no answer column it recognises); our loader uses `metadata.json` output_columns |
| the other 8 | yes | |

## 7. Decision rule (frozen with the freeze file)

Primary metric: **strict pass^3**, per row 1 if all 3 runs pass strictly; per SOP the mean over its sealed rows; headline
the **macro mean over the valid SOPs**. Uncertainty: a bootstrap over rows within SOPs (10,000 resamples, seed fixed), and
for W − A a paired bootstrap on the same rows.

1. **Reliability claim** ("build-once Haiku workflows are 90%+ reliable on SOP-Bench's recurring procedures"): W-H macro
   strict pass^3 ≥ 0.90 **and** its 95% lower bound ≥ 0.85, and the same holds with the orchestration-only SOPs removed.
2. **Versus the agent**: W-H − A-H ≥ +0.05 macro strict pass^3, paired 95% interval excluding 0.
3. **Cost**: amortised cost per sealed run of W-H, (build + repair + sealed runs) / runs, below A-H's mean cost per run.
4. Otherwise the claim is not supported, and the numbers, the per-SOP table and the failure anatomy go to NOTES and
   docs/RESEARCH.md as a negative result. Upstream-metric numbers are reported beside every strict number, never instead of
   it (NOTES.md §4: the upstream comparison passes "not X" for "X", any answer containing the label, and a list of all labels).

Secondary (reported, not part of the decision): pass@1 (mean over runs), the upstream metric, per-SOP tables, judge calls
per row, deopt rate (a deopt is a fail), section-level checks where a section's declared output name equals an intermediate
CSV column (for example customer_service `is_authenticated`, dangerous_goods `hazard_score`), and interface violations.

## 8. Distractor-tool ablation

Upstream reports it on one SOP: video_annotation, Claude Sonnet 4.5 ReAct, "minimal registry 37% TSR" against "20.8% TSR in
the bloated condition" with "26 tools (6 task-relevant + 20 distractor tools)" (paper v2 §5.2.1, `[doc]`, NOTES.md §6). The
release ships video_annotation **as the bloated registry** (20 tools whose body is `pass`), and video_classification with 5.

- **V1 (upstream's own)**: video_annotation, minimal (the 6 real tools; the bridge refuses the 20 stubs and the catalog drops
  them) vs bloated (as shipped). Both arms; W-H is rebuilt from the minimal catalog for the minimal cell, so each cell is
  build-once under its own catalog. All 105 sealed rows, k = 3.
- **V2 (ours, three more SOPs)**: dangerous_goods, customer_service, know_your_business, each with 20 generated distractors
  (deterministic: near-duplicate names and descriptions of real tools, returning `null` or a plausible decoy, seeded,
  committed). Both arms rebuilt/rerun under the bloated catalog; 40 sealed rows per SOP (seeded subsample fixed in the
  freeze), k = 3.
- Report Δ strict pass^3 (bloated − minimal) per arm with paired intervals. The question: does building once filter the
  distractors (they cost the builder once) where the per-row agent pays for them every row?

## 9. Stretch variants (only after the primary run)

- **W-H-call**: referral v1/v2 with the shared sections compiled once as library entries and called by hash (`flow.call`),
  to measure reuse across two SOPs.
- **W-H-T**: frontier-written decomposition templates (PLAN.md C-H-T) given to the Haiku builder.
- **A-S**: the Sonnet 5.5 agent on the same sealed rows at k = 1, as a stronger-model reference.

## 10. Budgets, caps and cost estimate

Measured unit costs (phase 1, dev rows; NOTES.md §8): the Haiku agent cost **$0.0022 per row** on average ($0.0009–0.0037
by SOP; 247 rows for $0.54), cache-heavy, 2.6 tool steps per row. E8's Haiku builder: $0.39 per build (one data point).

| Item | Count | Unit (estimate unless measured) | Estimate | Hard cap |
|---|---|---|---|---|
| Builds (Haiku, effort high) | 12 SOPs + 1 minimal video_annotation + 3 V2 bloated = 16 | $0.4–1.5 | $6–24 | $3 each |
| Repairs | ≤ 2 per build = ≤ 32 | $0.2–0.8 | $0–26 | $1.50 each |
| Host checks and repair-row runs (W-H judges only) | 16 × 20 rows | ≤ $0.005 | ≤ $2 | |
| W-H sealed runs (judge calls only; most SOPs are code-only) | 1,693 × 3 | $0–0.003 | $0–15 | $0.05 per run |
| A-H sealed runs | 1,693 × 3 | $0.0022 (measured on dev rows) | ≈ $11 | $0.25 per session |
| Ablation V1 (both arms, both cells) | 105 × 3 × 2 × 2 = 1,260 runs | A-H $0.0037 (measured, video_annotation) | ≤ $5 | |
| Ablation V2 | 3 × 40 × 3 × 2 × 2 = 1,440 runs | A-H ≈ $0.002 | ≤ $4 | |
| **Total** | | | **$20–85, most likely ≈ $35** | **run cap $100** |

The range is the builder: E8's single build is one data point; SOP texts are longer and the repair loop is new. The run stops
at the cap like phase 1 (`--cap`), and a builder that hits its budget is a failed build (the SOP then has no W-H workflow:
every sealed run of that SOP counts as a W-H fail). Wall time: phase 1 ran 247 agent rows in 23 minutes at concurrency 3 on
4 shared CPUs (10.6 rows per minute), so the 5,079 A-H sealed runs take ≈ 8 h at that pace (≈ 4 h at concurrency 6); W-H
runs are sandbox-bound (≈ 2–5 s each plus judges).

## 11. Order of work and gates

1. ($0) `tools/sop.mjs`, `--world build`, `build.mjs`, `exec.mjs`, a scripted reference workflow for two SOPs (hand-written,
   to prove the W path end to end: build-world isolation, section contracts, deopt, grading), tests.
2. (≈ $10) Pilot: build + repair on 3 SOPs (dangerous_goods, customer_service, email_intent), dev rows only. Gate: the
   loop works and costs are within 2× the estimate; otherwise revise this design before step 3.
3. Builds and repairs for the remaining SOPs; freeze (commit `FREEZE-*.json`).
4. Sealed run, both arms, k = 3; ablations; report against §7.

## 12. Risks we already see

- **Ambiguous SOPs**: dangerous_goods' SOP gives no score-to-class cut-offs ("map the score to Hazard Class A–D" with no
  thresholds); the phase-1 agent guessed equal bands and scored 20/20 on dev rows, but a builder that fits 5 build rows may
  pick other bands. Repair rows exist for this; the same ambiguity caps both arms.
- **Date-relative rules**: know_your_business ("license is not expired for more than 42 days") and referral v2 ("within 90
  days") never say "as of when"; the ground truth was generated at an unknown date. Both arms meet it alike.
- **Lenient upstream scorer**: never the headline (§7).
- **Orchestration-only SOPs** inflate any macro; reported with and without.
- **Small SOPs**: order_fulfillment has 23 sealed rows; its interval will be wide.

## 13. As built (2026-10-21, before the freeze)

Implementation of §2–§8, with the parameters the freeze records. Deviations from the text above are marked.

- **Code**: `experiments/sopbench/kit/sop.mjs` (the tool port and section contracts: schema-checked input and output per
  section, a per-section tool allow-list, every section a `flow.phase` span, every tool request tagged with its section in
  the host log), `exec.mjs` (a workflow on one row: `runSandboxed`, network off, mailbox + gateway socket only),
  `build.mjs` (builder and repair sessions, host checks, version selection), `kit/run-solver.mjs` and `kit/check.mjs`
  (the builder's own test tools), `sealed.mjs` (both arms, k runs, interleaved, freeze-verified, ablation cells),
  `freeze.mjs`, `distractors.mjs`. Bridge: `--world build|dev` and `--catalog`. The A-H arm is phase 1's per-row code,
  moved into `run.mjs runAgentRow` without a change in behaviour (the 14 tests and a scripted run agree).
- **Builder input** as §3. **Deviation:** a repair session sees all dev rows (build + repair) with their expected answers,
  plus failure files (result, deopt, trace, tool calls with results) for the rows it got wrong, not the failing rows only.
  Repair rows are training data either way (§4).
- **Workflow limits**: at most 40 tool requests per row (the agent: 10 tool steps, each a call or a batch), $0.05 of judge
  calls per run, 180 s per run. The builder prompt states the 40.
- **Pilot gate (§11 step 2)**: passed. `p2-pilot` built dangerous_goods, customer_service and email_intent; all three reach
  20/20 dev rows after at most one repair round, for under $0.40 in total (`runs/p2-pilot/build-summary.json`); Haiku 5.5
  builder sessions cost $0.01–0.22 each, far below the §10 estimate.
- **Ablation catalogs** (`experiments/sopbench/ablation/*.json`, deterministic): they name the real tools (specs taken from
  the pinned clone at run time) and hold only our generated distractor specs, so no upstream text is committed. V1 minimal
  = video_annotation's 6 real tools; V2 bloated = 20 distractors each for dangerous_goods, customer_service and
  know_your_business. Each cell's workflows are built under its own catalog, on dev rows, like the primary ones.
- **Models** are policy ids (`--builder-model`, `--judge-model`, `--agent-model` at freeze time); the harness accepts only
  `claude-cli` models today and says so for any other provider.
- **patient_intake (owner decision D3, `research/decisions-20261021.md`)**: built, repaired, frozen and run sealed k=3 with
  both arms like the others, but as a **separately reported cell**. The primary set stays the 12 SOPs of §6, so the
  primary comparison stays matched to the phase-1 dev baseline, and the decision rule (§7) covers the primary run only.
  The freeze lists `primarySops` (the 12) and `sops` (13: every SOP whose sealed rows it opens, which the bridge checks);
  a cell's sealed summary carries `decision: null` and a `cellNote`.
- **Builds (dev rows: training evidence, not a result)**: 9 of the 12 primary workflows pass all their dev rows;
  traffic_spoofing_detection 15/20 (round 0 kept; neither repair round improved it), video_classification 19/20 and
  warehouse_package_inspection 17/20 (round 1 kept). patient_intake 16/16; the four ablation workflows 20/20.
  Phase-2 spend before the sealed run: $3.53 (primary builds $2.67; `FREEZE-p2.json` `spendBeforeSealedUsd`).
  `node experiments/sopbench/report2.mjs --builds p2-pilot,p2-main,p2-abl-v1,p2-abl-v2,p2-pi` prints the table.
- **What the builder made**: 11 of the 12 primary workflows make no model call at run time (judge calls per run 0); only
  email_intent calls the judge (1.2 calls per run). The Haiku builder compiled each SOP into deterministic typed
  sections (3–12 per run). The sealed run therefore measures how well code fitted on 20 dev rows generalises to the
  sealed rows, against a per-row agent; it is not a comparison of two model loops.
- **Committed workflows were checked for upstream text** (CC BY-NC): the longest run of words shared with an SOP is 20
  (referral_abuse_detection_v1: its violation-to-action label table); no distinctive dev-row value (ids, amounts, free
  text) appears in any workflow's code beyond category labels.
- **Deviation:** `bridge.py`'s catalog loader was changed (catalog files now hold no upstream text) while the p2-main
  build was running. Only `--catalog` runs use it, so no primary build was affected; all ablation builds started after
  the change.
- **Freeze**: `FREEZE-p2.json` with the workflows under `experiments/sopbench/frozen/p2/` (primary, `ablation/`,
  `separate/`) and the vendored SDK (`frozen/p2/sdk/`). Cells: `V1-minimal`, `V2-bloated`, `patient_intake`. Sealed-run
  caps: primary $40, each cell $5, so phase 2 stays under $100 even if every cap were reached.
