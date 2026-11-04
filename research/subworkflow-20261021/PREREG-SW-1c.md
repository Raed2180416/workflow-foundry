# PREREG-SW-1c: the questions the review of RESULT-SW-1 left open

**Status: design, arms, tasks, decision rules, predictions and experiment code frozen on 2026-11-04. NOT LAUNCHED.**
The owner's SW-1 budget ($5 Haiku for SW-1 + SW-1b) has $0.084 left, so no part of this plan has run. Launching needs an
owner budget decision (estimate below). Written after the review of RESULT-SW-1 (RESULT-SW-1.md §12); every arm here
answers one of its findings. Code: [experiments/subworkflow/](../../experiments/subworkflow/) (SW-1c arms in `node.mjs`
and `prompts-c.mjs`; the SW-1 / SW-1b arms are unchanged, `test/frozen-arms.test.mjs`).

**Evidence label.** Development evidence on fresh held-out seeds (split `test`, seeds 211+, never used by SW-1 or SW-1b)
of a development bed; not sealed. K=1 per (arm, task). The bed, templates and prompts still share one author.

## What each part answers

| part | review finding | question | arms |
|---|---|---|---|
| A | defects 1, 2 ([70], [75] node decides) | Does a node realise on its own that it needs a sub-workflow, once the offer is not misread? Who should build when the offer is held equal? | A0, A1, A1H, A1T, A2 |
| B | defect 5 (baseline) and defect 4 (route when directed) | Is the sub-workflow machinery needed, or does a node with a code tool, or with the gate and retries, do as well? With the request protocol fixed, does the governing builder tie self-build? | A0G, A0C, A1F, A2FC |
| D | defect 3 (trigger) | At the need boundary, does the frozen observable trigger route as well as the oracle trigger, and better than the node's own decision? | A0, A1F, A1FO, A1H |

Arms (all Haiku 5.5, `claude-haiku-5-5`, the repo's Claude CLI ModelPort; node and builder reasoning=medium; node budget
$0.15, child carve ≤ $0.06, depth ≤ 2, ≤ 3 repairs, as SW-1):

- **A0, A1, A2, A1T, A1F**: exactly as in SW-1 (byte-identical calls). A1T (node decides, fills a library template itself)
  was built and piloted for SW-1 but not run in eval-1.
- **A1H**: A1 with the self-build offer reworded: "the harness checks it, runs its code and model steps for you ... you
  need no code tool of your own" (`prompts-c.mjs`). No template catalogue. A1H vs A1 isolates the wording; A1T vs A2 holds
  the offer content (catalogue, "the harness runs it") equal and varies who fills the template.
- **A0G**: A0 plus the code-owned contract gate every sub-workflow answer passes, with up to 3 retries on its feedback.
- **A0C**: the node with a sandboxed code tool and no sub-workflow machinery: up to 5 turns, each one JavaScript program
  over its inputs (no imports, network, files or clock); "run" shows it the value, "answer" makes the value its answer
  through the same gate; then a logged direct-answer fallback. No judge step: any free-text judgment is the node's own,
  written into its program.
- **A2FC**: A2F plus the two $0 fixes: a request that leaves out an input the answer contract depends on (spec, notes,
  export) goes back to the node once before the builder starts, and the note vote (`vote.mjs`) on template-built specs.
- **A1FO**: A1F routed by the frozen observable trigger (`trigger.mjs`: records in the export > 40) instead of the world's
  channel kind. A1F stays the oracle trigger (an upper bound for any trigger).

## Tasks

- **P'** (parts A, B): `tasks-sw1c-p.json` (sha256 `48716c6fe3d36109ff31f7eee9821f6060f3be74980fcac62d1538ad9457f970`), golive@1.0.0
  test seeds 211-214 at d5 and d4, interleaved: 8 tasks, 16 backlog nodes (119-289 rows) and 16 simple nodes per arm.
- **B** (part D): `tasks-sw1c-b.json` (sha256 `5f33e1b1af398cd09e369c0ebe3cd1ea6d95b10c6c451ad1d4a3e81989290b25`), seeds 211-216 at d3 and d2,
  interleaved: 12 tasks, 24 backlog nodes. d2 backlogs hold 28-36 records (the size trigger does not fire), d3 backlogs
  44-56 (it fires). In eval-1 A0 failed 3/8 d3 backlogs; in pilot-1 the deciding arms failed 4 of 6 d2 backlogs answered
  directly, so the need is genuinely uncertain on both sides of the threshold.

## Endpoints and decision rules

- **Primary:** backlog-node oracle pass. **Decision statistic:** the exact sign-flip test with the task as the unit
  (`stats.mjs`; review defect 12); the node-level McNemar p is reported next to it. Secondary: task pass, $ per task, $ per
  passing backlog node, the decision on backlog nodes and its stated reasons (deciding arms), gate retries, code-tool
  turns, returned requests.
- **Safety (every arm):** 0 problems in the independent audit (`audit.mjs`, all closed child events), 0 effects run,
  depth ≤ 2, no node over $0.15 by more than one call, quarantined proposals reported.
- **Route rule** (as SW-1): (i) an arm failing safety is out; (ii) clustered p < 0.05: more passes wins; (iii) else ≥ 3 more
  passing backlog nodes of 16 (P') or 24 (B): preferred, labelled suggestive; (iv) else ≥ 15% lower $ per passing backlog
  node; (v) else a tie, stating the unmeasured properties the choice rests on.

| question | comparison | rule |
|---|---|---|
| A1 wording (defect 1) | A1H vs A1: backlog nodes on which the node chose a sub-workflow; "no code tool" reasons; pass | report; the wording is fixed if A1H chooses a sub-workflow on ≥ 2x A1's backlog nodes and gives ≤ 2 "no code tool" reasons |
| who builds, offer held equal (defect 1) | A1T vs A2 | route rule |
| [70] literal: does the node's own decision beat the baseline? (defect 2) | A0 vs A1H, A0 vs A1T, A0 vs A2 (and A0 vs A1) | route rule per pair; "yes" only for an arm that wins by (ii) or (iii) |
| is the machinery needed? (defect 5) | A0 vs A0G, A0 vs A0C, A0C vs A1F | route rule; "needed" iff A1F beats A0C by (ii) or (iii) |
| route when directed, fixes in (defect 4) | A2FC vs A1F | route rule |
| trigger at the boundary (defect 3) | A1FO vs A1F, A1H vs A1FO, A0 vs A1FO on B | route rule; also the trigger's regret: B backlog nodes A1FO answered directly and failed while A1F passed |

**Power, stated before the run:** with 16 backlog nodes per arm in P', only large effects reach (ii): a clustered p < 0.05
needs about 5 or more tasks moving one way with none against. Most P' comparisons will end at (iii) or (v); they are
development evidence either way.

**Predictions on record:** (1) A1H chooses a sub-workflow on ≥ 10/16 P' backlog nodes (A1 in eval-1: 6/32) and gives
≤ 2 "no code tool" reasons; (2) A1T vs A2 a tie by (iii)-(v) (|difference| ≤ 2 nodes); (3) A0G within 2 backlog nodes of
A0 (the gate flags 2 of 45 failing one-pass answers in eval-1, `runs/eval-1/review-posthoc.md`); (4) A0C between A0 and
A1F, at least 3 nodes below A1F (free-text judgments stay in one pass); (5) A2FC vs A1F a tie (|difference| ≤ 1);
(6) on B, A1FO passes fewer d2 backlogs than A1F (it answers them directly) and the same d3 backlogs; A1H beats A0 on d3.

## Protocol

```
# part A (P'), then part B (P'), then part D (B); SW-1c spend is counted over runs/sw1c only
node experiments/subworkflow/run.mjs --run-dir research/subworkflow-20261021/runs/sw1c/a --runs-root research/subworkflow-20261021/runs/sw1c \
  --tasks research/subworkflow-20261021/tasks-sw1c-p.json --arms A0,A1,A1H,A1T,A2 --concurrency 2 --model-concurrency 5 --cap-usd <owner cap>
node experiments/subworkflow/run.mjs --run-dir research/subworkflow-20261021/runs/sw1c/b --runs-root research/subworkflow-20261021/runs/sw1c \
  --tasks research/subworkflow-20261021/tasks-sw1c-p.json --arms A0G,A0C,A1F,A2FC --concurrency 2 --model-concurrency 5 --cap-usd <owner cap>
node experiments/subworkflow/run.mjs --run-dir research/subworkflow-20261021/runs/sw1c/d --runs-root research/subworkflow-20261021/runs/sw1c \
  --tasks research/subworkflow-20261021/tasks-sw1c-b.json --arms A0,A1F,A1FO,A1H --concurrency 2 --model-concurrency 5 --cap-usd <owner cap>
node experiments/subworkflow/analyze-sw1c.mjs --results research/subworkflow-20261021/runs/sw1c/a/results.jsonl,research/subworkflow-20261021/runs/sw1c/b/results.jsonl,research/subworkflow-20261021/runs/sw1c/d/results.jsonl \
  --json research/subworkflow-20261021/runs/sw1c/analysis.json
```

- **Budget (estimate from eval-1's per-task costs, P' and B):** part A about $1.65, part B about $1.20, part D about $0.85;
  $3.70 in all. With the runner's reservation ($0.60 per unit in flight, `cap.mjs`), a cap of **$4.25** leaves room to
  finish at concurrency 2. Run order A, B, D; if the cap stops a part, the analysis covers the tasks complete in every arm of
  a pair, and the stop is reported.
- **Before launch:** the owner's budget decision; the $0 suite passes on the launch tree (after the engine v2 merge);
  `launch.json` records the CLI version and the sha256 of every pinned file, engine files included (`run.mjs` PINNED).
- A unit that ends in an environment fault (rate limit, unavailable, launch/protocol) or a crash is re-run once with the
  same command; a second fault is recorded and the unit dropped from every pair. A code change after launch is a deviation.

## Frozen experiment code (sha256)

Engine-side files (`experiments/jit/call-host.mjs`, `src/sandbox.mjs`, `src/validate.mjs`, `experiments/lib/models.mjs`,
`experiments/lib/runner.mjs`, `policy/models.json`) change with the engine v2 merge; they are pinned at launch in
`launch.json`, not here.

| file | sha256 |
|---|---|
| beds/golive/index.mjs | 0442be3460c50a9f0726122ec5b7093de9fe6dfec6bf6797677846897642093b |
| beds/golive/world.mjs | 4348938f1435a063a5bcd255d52b432a1f6e3360153d29fb2da0af848650a813 |
| beds/golive/layouts.mjs | 6e0e888b7e3b1506a6e80d83042cbeadd9cf264cc10c602761efcc06c57d68fa |
| beds/lib/rng.mjs | a2094022a04d6336428fd0317a6f602c8f13cbd84ba12243bb2c9bed97d516a8 |
| experiments/subworkflow/dsl.mjs | b0ff5d6a42b4c329b87b0be0fb4e08779e022ed469eb524d7da61c5aeb2ecc8b |
| experiments/subworkflow/templates.mjs | 21006d08516f9001688fd24be0e680e2475448fd09b8b4eaaa76da80780b9c02 |
| experiments/subworkflow/bind.mjs | bcaab9e3e2e5bbf4eec6015a84d1605e887ebf6bf296184ab9ef4a673526213c |
| experiments/subworkflow/node.mjs | 712bd7b4eaeb78768c68206735f2e039567ea7207a2f2db4b33359667ff222ff |
| experiments/subworkflow/prompts.mjs | 9077aec9c5aeaa97ab234c4b12b8fd3cf374d18204f02558eb327db660657862 |
| experiments/subworkflow/prompts-open.mjs | 8837653aaf3e0a9286561855e06b9bf7644e2564c648327087777bbd5a46cc1f |
| experiments/subworkflow/prompts-c.mjs | 4e7b5928b13d2cddd548260308e31ec80e9decad7f9e4c1e0d09810c08eb2faa |
| experiments/subworkflow/run.mjs | 3e1acf5f03103a08bcdaa03a2a59d405793cda3f2f812f0e7cc802ebb2a63799 |
| experiments/subworkflow/cap.mjs | f4e1d8dafb1bdc35c460003529b5b754c987e9abe8925f6d1abf2eef57b58451 |
| experiments/subworkflow/trigger.mjs | 0383a1297701672b0051241d548f03c6b95ad7730982abe9b0c415180693a850 |
| experiments/subworkflow/vote.mjs | 953efe4d755505edfad36cb2d8a1a274eabea08807fc2dc71ea3d4c59068400f |
| experiments/subworkflow/provenance.mjs | 8be7cd97394f5ee714e2b7710c3fd764a562d51bb3e54da2db1e0d85bf1b145f |
| experiments/subworkflow/audit.mjs | 55b371da5e41305ea714eb64b3661375d1160018970a14ba41ef71bdcf4a4527 |
| experiments/subworkflow/stats.mjs | aaf5e016578d14b6cf46dfa0fac73f00fea25ff38bbab88c305a9f47c1bfb46f |
| experiments/subworkflow/analyze-sw1c.mjs | 102288bb810d5ddbb611b4d92ef8f270a635dd62f8ccb65e29daff34a075def5 |
| experiments/subworkflow/manifest-sw1c.mjs | f978059927eaabd23a3f0a7e200220c68548b9a4798e425a5a91d45fca264012 |
| research/subworkflow-20261021/tasks-sw1c-p.json | 48716c6fe3d36109ff31f7eee9821f6060f3be74980fcac62d1538ad9457f970 |
| research/subworkflow-20261021/tasks-sw1c-b.json | 5f33e1b1af398cd09e369c0ebe3cd1ea6d95b10c6c451ad1d4a3e81989290b25 |

`prompts.mjs`, `templates.mjs` and `bind.mjs` equal their PREREG-SW-1 hashes; `node.mjs`, `run.mjs` and `dsl.mjs` changed after SW-1 / SW-1b (RESULT-SW-1 §12), with the frozen arms' model calls pinned by `test/frozen-arms.test.mjs`.
