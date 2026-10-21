# SOP-Bench phase 2: build once, run frozen on sealed rows (design, not run)

2026-10-21. Status: **design for review; nothing in this file has run.** Phase 1 (acquisition, bridge, parity, frozen split,
dev baseline) is in [NOTES.md](NOTES.md). Every number below that is not a measurement is labelled an estimate.

## 0. The claim under test

PLAN.md (composition, 2026-10-21): "This is where the '90%+ reliable on recurring procedures' claim is tested on someone
else's benchmark." Concretely: **a workflow constructed once per SOP by Haiku 5.5, from the SOP text, the tool specs and 5
build rows, with the SOP's sections as typed sub-workflows, repaired only on dev repair rows and then frozen, answers
SOP-Bench's sealed rows with strict pass^3 ≥ 0.90, and more reliably than the Haiku agent acting per row through the same
mock tools.** Both arms, the tools, the scorer and the rows are fixed before the sealed run.

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
  child sandboxes) for no correctness gain. It stays a stretch variant (§9) for the one case where it fits: referral abuse v1
  and v2 share their `investigate_account` and `analyze_traffic_patterns` sections.
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
- Sealed records go to `results.sealed.jsonl`; no per-row grade is printed while the run is open.

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

Measured unit costs (phase 1, dev rows; NOTES.md §8): the Haiku agent cost $0.0008–0.0052 per row, mean about $0.003
(cache-heavy, 2–10 steps). E8's Haiku builder: $0.39 per build.

| Item | Count | Unit (estimate) | Estimate | Hard cap |
|---|---|---|---|---|
| Builds (Haiku, effort high) | 12 SOPs (+1 for minimal video_annotation, +3 V2 bloated) = 16 | $0.4–1.5 | $6–24 | $3 each |
| Repairs | ≤ 2 per build = 32 | $0.2–0.8 | $3–26 | $1.50 each |
| Host checks and repair-row runs (W-H judges only) | 16 × 20 rows | ≤ $0.005 | ≤ $2 | |
| W-H sealed runs (judge calls only; most SOPs are code-only) | 1,693 × 3 | $0–0.003 | $0–15 | $0.05 per run |
| A-H sealed runs | 1,693 × 3 | $0.003 | ~$15 | $0.25 per session |
| Ablation V1 (both arms, both cells) | 105 × 3 × 2 × 2 = 1,260 runs | ≤ $0.006 | ≤ $8 | |
| Ablation V2 | 3 × 40 × 3 × 2 × 2 = 1,440 runs | ≤ $0.004 | ≤ $6 | |
| **Total** | | | **$30–95, most likely ≈ $45** | **run cap $120** |

The wide range is the builder: E8's single build is one data point; SOP texts are longer and the repair loop is new. The run
stops at the cap like phase 1 (`--cap`), and a builder that hits its budget is a failed build (the SOP then has no W-H
workflow: every sealed run of that SOP counts as a W-H fail). Wall time: phase 1 ran ≈ 3 agent rows per minute at
concurrency 3 on 4 shared CPUs; 5,079 A-H runs ≈ 28 h at that pace, so the sealed run needs concurrency 6–8 or a quieter
machine; W-H runs are sandbox-bound (≈ 2–5 s each plus judges).

## 11. Order of work and gates

1. ($0) `tools/sop.mjs`, `--world build`, `build.mjs`, `exec.mjs`, a scripted reference workflow for two SOPs (hand-written,
   to prove the W path end to end: build-world isolation, section contracts, deopt, grading), tests.
2. (≈ $10) Pilot: build + repair on 3 SOPs (dangerous_goods, customer_service, email_intent), dev rows only. Gate: the
   loop works and costs are within 2× the estimate; otherwise revise this design before step 3.
3. Builds and repairs for the remaining SOPs; freeze (commit `FREEZE-*.json`).
4. Sealed run, both arms, k = 3; ablations; report against §7.

## 12. Risks we already see

- **Ambiguous SOPs**: dangerous_goods' SOP gives no score-to-class cut-offs ("map the score to Hazard Class A–D" with no
  thresholds; phase-1 agent transcript), so build rows must carry the rule; with 5 build rows a builder may fit the wrong
  bands. That is the bed working as intended (repair rows exist for it), but it caps both arms.
- **Date-relative rules**: know_your_business ("license is not expired for more than 42 days") and referral v2 ("within 90
  days") never say "as of when"; the ground truth was generated at an unknown date. Both arms meet it alike.
- **Lenient upstream scorer**: never the headline (§7).
- **Orchestration-only SOPs** inflate any macro; reported with and without.
- **Small SOPs**: order_fulfillment has 23 sealed rows; its interval will be wide.
