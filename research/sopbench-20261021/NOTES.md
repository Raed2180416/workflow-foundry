# SOP-Bench: what it is, how it scores, our bridge, parity and the raw dev baseline

2026-10-21, phase 1 of the SOP-Bench adaptation (brief: research/composition-20261021/PLAN.md "External replication").
Source: amazon-science/sop-bench at `f6d4385` (pin, licence, outcome: [ACQUISITION.md](ACQUISITION.md)). Paths below are
relative to `corpus/sop-bench/src/amazon_sop_bench/` unless they start with `experiments/` or `research/`.

Evidence labels: **[code]** read in the source at the pin; **[measured]** computed with the command given; **[doc]** a claim
in the README or the paper, not checked; **[inference]** our reading. **Everything here is development and diagnostic
evidence: dev rows only, nothing sealed has been read or run.** The data is CC BY-NC 4.0: no row content is quoted below
except label names and field names.

## 1. Summary

- SOP-Bench is 14 procedure directories in the release (the paper reports 13; `order_fulfillment` is extra). Each has a
  natural-language SOP, Bedrock tool specs, a `tools.py` of plain-Python mock tools over the SOP's own CSV, and a labelled
  test file (30–274 rows; 2,154 labelled rows in all). The task: given the input columns of one row, follow the SOP with the
  tools and output the row's output columns (1 to 7 categorical fields). [code]
- Upstream's score (TSR) is the share of rows whose parsed answer "matches" the ground truth. The match is **lenient**:
  lower-cased, `_`/`-` folded, and **substring containment in either direction** counts (`evaluation/parser.py:515-517`), so
  "not approved" matches "approved" and one string listing every label matches every row. We reproduce it exactly and add a
  **strict** metric (same normalisation, no containment). [code, measured §5]
- Five validity findings in the release, each measured or read in code (§7): content_flagging's tools are random (the
  ground truth is reachable on about 36% of draws); upstream's loader passes the answer column to the agent for content_flagging and
  order_fulfillment and cannot load warehouse_package_inspection; aircraft_inspection's and patient_intake's tools return the
  answer columns themselves; for multi-field SOPs upstream scores the reasoning trace, where tool results count as answers.
- Our bridge serves each SOP's own tools to a sandboxed agent through the AutomationBench file mailbox, on a **row-filtered
  world** (a dev run cannot reach a sealed row even by naming its key). Parity at $0: the scripted oracle scores 100% on both
  metrics through the bridge, wrong answers 0%, our verdicts equal upstream's own `Evaluator.run_single_task` verdicts on
  every compared answer, and the JS scorer port agrees with upstream's Python on every answer it covers (§5).
- The split is frozen: 70 build, 193 repair, 1,891 sealed rows; `splitSha256 1d957beb…` ([SPLIT.json](SPLIT.json)).
- Raw baseline (Haiku 5.5 agent per row, 247 dev rows, K = 1): **73.8% strict macro** on our 12-SOP valid set (70.4% on
  all 13 run), against 38% for a majority-label baseline, at **$0.0022 per row** ($0.54 in total). §8.

## 2. The benchmark at the pin [code, measured]

Command: `corpus/sop-bench-venv/bin/python -I experiments/sopbench/bridge.py stats --upstream corpus/sop-bench` (from a
neutral directory). "Rows" are the labelled rows of `test_set_with_outputs.csv`, the file upstream's loader reads
(`benchmarks/registry.py:40`, `TEST_FILES`); "paper n" is the paper's Table 3 (`[doc]`), which also counts the unlabelled
`test_set_without_outputs.csv` rows of some SOPs. Split = build / repair / sealed (SPLIT.json).

| SOP | rows | paper n | split | output columns | inputs | tools | SOP chars | labels per column |
|---|---|---|---|---|---|---|---|---|
| aircraft_inspection | 112 | 150 | 5/15/92 | `aircraft_ready`, `mechanical_inspection_result`, `electrical_inspection_result`, `component_incident_response`, `component_mismatch_response`, `cross_check_response`, `cross_check_reporting_response` | 15 | 7 | 4,256 | 3 each |
| content_flagging | 168 | 226 | 5/15/148 | `final_decision` | 16 | 4 | 3,784 | 4 |
| customer_service | 156 | 208 | 5/15/136 | `final_resolution_status` | 4 | 10 | 7,639 | 4 |
| dangerous_goods | 274 | 327 | 5/15/254 | `hazard_class` | 5 | 4 | 4,095 | 5 |
| email_intent | 186 | 122 | 5/15/166 | `seller_intent`, `action` | 4 | 5 | 4,034 | 4/4 |
| know_your_business | 90 | 122 | 5/15/70 | `escalation_status` | 8 | 8 | 7,261 | 3 |
| order_fulfillment | 30 | (not in paper) | 5/2/23 | `expected_output` | 9 | 4 | 1,673 | 5 |
| patient_intake | 66 | 90 | 5/11/50 | `prescription_insurance_validation`, `insurance_validation`, `life_style_risk_level`, `overall_risk_level`, `user_registration`, `pharmacy_check` | 14 | 6 | 3,893 | 2/2/3/3/2/2 |
| referral_abuse_detection_v1 | 200 | 200 | 5/15/180 | `enforcement_action` | 1 | 3 | 7,308 | 2 |
| referral_abuse_detection_v2 | 200 | 200 | 5/15/180 | `final_decision` | 1 | 6 | 11,888 | 7 |
| traffic_spoofing_detection | 200 | 200 | 5/15/180 | `enforcement_action` | 11 | 6 | 4,246 | 4 |
| video_annotation | 125 | 168 | 5/15/105 | `final status` | 1 | 26 (20 stubs) | 30,477 | 2 |
| video_classification | 197 | 198 | 5/15/177 | `final_decision` | 2 | 10 (5 stubs) | 5,920 | 4 |
| warehouse_package_inspection | 150 | 200 | 5/15/130 | `resolution_status` | 15 | 7 | 3,323 | 3 |

- **Tools** read the SOP's CSV with `pd.read_csv` on every call and look the row up by a key (`aircraft_id`, `product_id`,
  `account_id`, …); key columns are unique in every SOP [measured, `stats` key_duplicates]. Exceptions: order_fulfillment and
  warehouse_package_inspection compute from arguments and in-memory tables only; email_intent reads the unlabelled
  `test_set_without_outputs.csv`, which is row-aligned with the labelled file [measured, World alignment].
- **Stubs**: 20 of video_annotation's 26 tools and 5 of video_classification's 10 have the body `pass` (return `None`): the
  release ships video_annotation as the paper's "bloated registry" (§6).
- **Dependencies** of `tools.py`: stdlib, `pandas`, `python-dateutil`; one file imports upstream's logger. No tool calls a
  model, the network or a subprocess [code: grep for boto3/bedrock/requests/urllib/subprocess finds none in tools.py].
- **Determinism** [code, measured]: `content_flagging` draws `random.random()` in `calculateBotProbabilityIndex` and its
  device-consistency helper (tools.py:42, 100), and the decision depends on it (§7.1). `warehouse_package_inspection` draws
  `uuid4` report ids and `datetime.now()` dates (tools.py:279, 293, 311, 427): cosmetic, not in any decision. The video SOPs
  shuffle their own copy of the tool specs (`random.shuffle(toolspec_json)`, not used by the loader). A probe calling every
  tool twice with each dev row's own values found no other nondeterminism (`bridge.py probe`, dev rows only).

## 3. Our harness [code: experiments/sopbench/]

- **bridge.py** (runs in `corpus/sop-bench-venv`, `python -I`, neutral cwd, minimal env): loads upstream modules by path with
  stub packages (`upstream.py`; ACQUISITION.md lists them), runs the SOP's `tools.py` as upstream's loader does
  (`benchmarks/loader.py:254-302`) and executes calls through upstream's own `ToolManager.execute_tool`
  (`tools/manager.py:94-157`). Commands: stats, rows, prepare, serve, replay, grade, official, probe.
- **World filter**: the tools module's `pd` is a proxy; `read_csv` of a known SOP file returns a copy of the host-cached frame
  filtered to the run's rows (dev world = the SOP's build + repair rows; full world only with `--sealed` and a freeze file).
  The frame is parsed once with upstream's own call, so dtypes and values equal upstream's.
- **Mailbox**: `tool.mjs` (byte-identical logic to experiments/autobench/tool.mjs) and the hardened `Mailbox` class copied
  verbatim from experiments/autobench/bridge.py (descriptor-relative, `O_NOFOLLOW`, regular single-link files only, exclusive
  temp answers). A step is one `call`/`batch`; at most 10 steps per row (upstream's function-calling agent makes at most 10
  model calls, `agents/function_calling.py:228`).
- **Agent**: one sandboxed `claude -p` session per row (`src/executors/claude-code.mjs`, Bash only, the model id from
  `policy/models.json`), system prompt = how to reach the tools + the tool definitions as upstream's FC agent builds them
  (`function_calling.py:113-135`), user prompt = upstream's FC prompt (`function_calling.py:208-224`) with the SOP and the task
  lines exactly as upstream formats them (`"\n".join(f"{k}: {v}")`, `function_calling.py:203`).
- **Split hygiene**: SPLIT.json lists and hashes; `bridge.py allowed_rows` and `split.mjs assertRows` refuse sealed rows
  unless `--sealed --freeze <file>` names this split; the dev world physically lacks sealed rows; tests prove each refusal
  (`experiments/sopbench/test/sopbench.test.mjs`, on a toy fixture SOP, never on SOP-Bench rows).
- **Deviations from upstream, each deliberate** (they apply to every arm alike):
  1. Answer format: `<final_output>{"<col>": …}</final_output>` with the exact output columns, instead of FC's single
     `<final_decision>` value (multi-field SOPs had no defined format). It is the format upstream's parser tries first
     (`parser.py:67-71`, "matches original eval.ipynb").
  2. We grade the final message only. Upstream grades multi-field SOPs from the **reasoning trace** (`evaluator.py:313-318`),
     whose tool results count as answers when the agent gave none (`parser.py:73-78`, `586-640`).
  3. Inputs for the three "legacy mode" SOPs: upstream passes the whole row, answer included (`loader.py:226-229`); we pass the
     columns of the SOP's own output-free file.
  4. Two upstream crashes are made non-fatal and flagged `upstreamFatal` in the host log: an unknown tool name
     (`manager.py:120-125` raises outside its `try`; the FC loop dies and the row fails) and a tool result `json.dumps` cannot
     encode (`function_calling.py:283`). Our tools return JSON with numpy scalars converted.
  5. The agent loop is Claude Code's (Bash + our client), not Bedrock FC or LangChain ReAct; it can compute in the sandbox.

## 4. How upstream scores, and our two metrics [code]

- `Evaluator.run_single_task` (`evaluation/evaluator.py:273-384`): run the agent; `expected_columns` = the output columns
  (`306-311`); parse the reasoning trace for multi-field SOPs, the final output otherwise (`313-321`); take `decisions` (multi)
  or `decision` (single) (`325-330`); `compare_decisions(pred, expected)` (`333-336`); success = agent ran and matched
  (`350-357`).
- `OutputParser.parse_decision` (`evaluation/parser.py:36-96`): the last `<final_output>{json}</final_output>` (`98-186`),
  then for multi-field the tool results in the trace (`586-640`), then any XML tags (`188-302`), JSON (`304-349`), a Python
  dict (`351-411`) and plain text (`413-436`, more than 100 characters becomes "unknown").
- `compare_decisions` (`438-584`): per field (all must match, `521-584`), `_compare_single_value` (`464-519`): null-likes
  (`none, null, na, n/a, nan, unknown, ""`) match each other; else lower-case and strip, equal, or equal after `_`/`-` → space,
  **or either contains the other**.
- TSR = correct / total (`evaluation/metrics.py:81-103`), "correct" = the evaluator's success flag (`168-184`).
- **Upstream metric (ours)** = that code itself: `bridge.py grade` builds the Task from the same CSV read and calls the real
  `run_single_task` with a scripted agent returning the answer text. `scorer.mjs upstreamVerdict` is an independent JS port of
  the `<final_output>` branch and the comparison (Python `str()` of JSON values, Python whitespace, last block wins); it
  declines (`covered: false`) where upstream would fall back to its other parsers, and is checked against the Python (§5).
- **Strict metric (ours)**: the last `<final_output>` must parse and contain every output column with a scalar; per column,
  both null-like, or both finite numbers equal, or equal text after lower-case, `_`/`-` → space and whitespace folding. No
  containment, no fallback parsers. Python (`bridge.py strict_verdict`) and JS (`scorer.mjs strictVerdict`) implement it
  separately and must agree. **Strict is the headline for our claims**; upstream's is reported beside it for comparability.

## 5. Parity at $0 [measured]

Command: `node experiments/sopbench/parity.mjs` → [parity.json](parity.json) (2026-10-21; no model; all 263 dev rows of all
14 SOPs). Code at run time: bridge.py sha256 `5a3846f1…`, run.mjs `e049d317…` (the committed bridge only adds the
`worldcheck` command; the committed run.mjs only changes where per-row records are written — verified by hashing the
committed files with those additions removed).

**1. Scripted policies through the full run path** (tool.mjs → mailbox → `bridge serve` on the dev world → `bridge grade`):

| Policy | What it answers | upstream TSR | strict |
|---|---|---|---|
| oracle | the ground truth | **100.0%** (263/263) | **100.0%** |
| wrong | a non-label string | 0.0% | 0.0% |
| labelswap | another dev label of the column | 0.0% | 0.0% |
| **gaming** | every dev label of the column in one string | **99.6%** (262/263; 100% on 13 SOPs, 95% on aircraft) | **0.0%** |
| empty | nothing | 0.0% | 0.0% |

Each scripted row also exercised the error paths (an unknown tool, malformed JSON arguments): 263/263 rows logged the
unknown tool as `upstreamFatal` (it would have ended upstream's FC agent) and still completed.

**2. Upstream's own path on the same calls and answers** (`bridge official`: upstream's `BenchmarkLoader` (13 SOPs; ours
for warehouse, which upstream cannot load), upstream's `ToolManager` on the unfiltered world, the real
`Evaluator.run_single_task` with a scripted agent):
- verdicts: **1,315/1,315 equal** (5 policies × 263 rows);
- tool results: 1,192/1,215 calls equal. The 23 differences are explained: 20 are content_flagging's
  `calculateBotProbabilityIndex` (random, both sides; §2) and 3 are email_intent row 126, whose `product_id` also belongs to
  an earlier, sealed row: upstream's lookup (`df[df.product_id == id].iloc[0]`) returns that other row's price, description
  and stock; our dev world, which lacks the sealed row, returns row 126's own. `bridge.py worldcheck` (every tool fillable
  from a dev row's columns, dev world vs full world, 1,897 calls) finds no other row: **world filtering changes nothing else**.
  In sealed runs the world is upstream's, so this applies to dev rows only.
- upstream task inputs contain the answer column for content_flagging (`final_decision`) and order_fulfillment
  (`expected_output`) — §7.2.

**3. Scorer battery**: 31 answer variants per dev row (8,153 answers) graded by upstream's code (Python) and by the JS port,
and by both strict implementations: **upstream port 6,368/6,368 agree** on the answers it covers (it declines the 1,785
that need upstream's fallback parsers: invalid JSON, no output column, nested objects, list values, XML, plain text, empty);
**strict 8,153/8,153 agree**. What upstream's comparison accepts that strict rejects, out of 263 rows each:
"Final: X" 263, "X (per SOP)" 263, X minus its first and last character 263, "not X" 263, the first word of X 263 (strict
130), all labels in one string 262, Python-dict text with single quotes 207, `{"result": {...}}` 207, `["X"]` 262,
`<final_decision>X</final_decision>` 207, bare text 207 (the 207 are the single-field rows: those parsers do not reach
multi-field columns). Both accept case, `_`/`-` and padding variants, JSON booleans and numbers, upper-case keys, repeated
keys (last wins), extra keys, and take the last of two blocks.

## 6. Published numbers [doc]

The paper (arXiv 2506.08119v2, 2026-02-23; read 2026-10-21 through a fetch-and-summarise tool, to re-check against the PDF
before citing outside): 2,411 tasks in 13 SOPs; Claude 4 Opus averages 0.682 TSR with the FC agent and 0.724 with ReAct
(Table 6); per SOP (Table 4, FC / ReAct) patient_intake 0.92/1.00, email_intent 0.98/0.98, referral v1 0.95/0.97, aircraft
0.45/0.97, referral v2 0.98/0.96, video_classification 0.79/0.94, dangerous_goods 0.73/0.83, warehouse 0.56/0.65,
traffic_spoofing 0.79/0.60, customer_service 0.56/0.56, video_annotation 0.37/0.38, know_your_business 0.43/0.31,
content_flagging 0.36/0.27. The README: FC agents ≈ 64%, ReAct ≈ 55% average over 11 models; "26.7%-94.3%" by domain.
Distractor ablation (§5.2.1): video_annotation, Claude Sonnet 4.5 ReAct, "minimal registry 37% TSR" vs "20.8% TSR in the
bloated condition" of "26 tools (6 task-relevant + 20 distractor tools)". These are other models, other agent loops, all
labelled rows, upstream's lenient scorer and, for content_flagging, an agent that is given the answer (§7.2); they are
context, not a comparison.

## 7. Validity findings and blockers

1. **content_flagging: the ground truth is not reachable by following the tools** [code, measured]. `calculateBotProbabilityIndex`
   returns `random.random()`-based values; trust score and decision are computed from them. Running the SOP's tool chain
   40 times per dev row (`experiments/sopbench/cf_ceiling.py`, bridge dev world): the decision matches the ground truth on
   36.6% and 36.1% of draws (two runs); 8 of 20 rows never match, 4 always; the modal decision matches on 6–7 of 20. Upstream's oracle for this SOP is
   therefore invalid for a capability claim; it is excluded from our primary set (DESIGN.md §6) and reported separately.
2. **Answer leak in upstream's loader** [code, measured]: for SOPs whose metadata lacks `input_columns`, upstream passes the
   whole row as the task input (`loader.py:226-229`): content_flagging's agent sees `final_decision`, order_fulfillment's
   sees `expected_output` (`bridge.py stats`, upstream_loader.outputs_in_inputs). Upstream's numbers on those SOPs measure
   reading the answer as much as following the SOP. We do not pass those columns.
3. **warehouse_package_inspection does not load in upstream** [measured]: `ValueError: … Could not determine expected output`
   (`loader.py:231-237`; it has no `input_columns` and no `expected_output`/`final_decision` column). Our loader uses the
   metadata's `output_columns`.
4. **Orchestration-only SOPs** [code]: every aircraft_inspection tool returns one of its seven answer columns
   (`aircraft_inspection/tools.py`, e.g. `return matched_rows.iloc[0]['aircraft_ready']`), and patient_intake's six tools
   return its six (`patient_intake/tools.py:64,94,126,158,190,226`). Success there means calling the right tools and copying
   their results. Combined with finding 5 below, upstream's multi-field score can pass a row the agent never answered.
5. **Multi-field scoring reads tool results** [code]: `parser.py:73-78`, `586-640`: when the trace has no `<final_output>`, any
   tool result whose JSON keys are output columns is taken as the answer once half the columns are found.
6. **The lenient comparison is gameable** [measured, §5]: one answer listing every label passes every single-field row
   under upstream's metric (substring containment) and fails every row under strict.
7. **Upstream crash modes** [code]: an unknown tool name ends the FC agent's row (finding in §3 deviation 4).
8. **Date-relative rules** [code: sop.txt]: know_your_business ("license is not expired for more than 42 days") and
   referral_abuse_detection_v2 ("within 90 days") do not say "as of when"; both arms meet the same ambiguity.
9. **Underspecified rules** [measured: agent transcript, dev row]: dangerous_goods' SOP asks to map a score to "Hazard Class
   A–D" without cut-offs; the agent assumed equal bands. Build rows are the only source of the rule.
10. **patient_intake: scope** [AGENTS.md]: synthetic, mock tools, no real patient; but AGENTS.md lists "patient/lab
    operations" as out of scope and TRUST-BENCHMARKS.md asked for owner approval for synthetic medical beds. It is in the
    split and the $0 parity, and **excluded from paid runs until the owner decides**.
11. **Licence**: CC BY-NC 4.0 plus per-dataset terms ("No one should take steps to facilitate training AI models on this
    data"): research use only; no training on it; nothing from the clone in git (ACQUISITION.md). Committed run records drop
    the agents' answer texts (they restate row data) and keep their sha256 (`run.mjs redact`).

No blocker on data access, tool dependencies (pure pandas) or LLM-dependent tools (none).

## 8. Raw baseline: the Haiku 5.5 agent per row, dev rows [measured]

Command: `node experiments/sopbench/run.mjs --model claude-haiku-5-5 --cap 7.99 --rows-per-sop 20 --concurrency 3
--run-id raw-haiku-dev` (2026-10-21; summary: [runs/raw-haiku-dev/summary.json](runs/raw-haiku-dev/summary.json); per-row
records outside the repo at `/var/tmp/foundry-work/sopbench-rows/raw-haiku-dev/`; table: `node experiments/sopbench/table.mjs
raw-haiku-dev`). **Dev rows, K = 1, development/diagnostic evidence.** 13 SOPs (patient_intake excluded, §7.10), all 247 dev
rows (build then repair; 20 per SOP, 7 for order_fulfillment), Claude Haiku 5.5 (`claude-haiku-5-5`, policy 2026-10-21.1),
Claude Code 2.1.306, Bash only, 10 tool steps, $0.25 reserved per session, 10 min timeout, default effort.

| SOP | rows | upstream | strict | upstream-only passes | no final_output | $/row | steps (mean) | paper Opus 4 FC / ReAct |
|---|---|---|---|---|---|---|---|---|
| aircraft_inspection | 20 | 60% | 60% | 0 | 0 | 0.0025 | 2.3 | 45% / 97% |
| content_flagging | 20 | 30% | 30% | 0 | 0 | 0.0019 | 3.0 | 36% / 27% |
| customer_service | 20 | 85% | 85% | 0 | 0 | 0.0032 | 6.5 | 56% / 56% |
| dangerous_goods | 20 | 100% | 100% | 0 | 0 | 0.0013 | 1.0 | 73% / 83% |
| email_intent | 20 | 85% | 85% | 0 | 0 | 0.0009 | 0.8 | 98% / 98% |
| know_your_business | 20 | 35% | 35% | 0 | 0 | 0.0026 | 2.6 | 43% / 31% |
| order_fulfillment | 7 | 86% | 86% | 0 | 0 | 0.0011 | 2.0 | not in Table 4 |
| referral_abuse_detection_v1 | 20 | 100% | 100% | 0 | 0 | 0.0017 | 1.6 | 95% / 97% |
| referral_abuse_detection_v2 | 20 | 100% | 100% | 0 | 0 | 0.0022 | 1.3 | 98% / 96% |
| traffic_spoofing_detection | 20 | 70% | 70% | 0 | 0 | 0.0020 | 2.7 | 79% / 60% |
| video_annotation | 20 | 50% | 50% | 0 | 0 | 0.0037 | 2.1 | 37% / 38% |
| video_classification | 20 | 60% | 60% | 0 | 0 | 0.0026 | 4.8 | 79% / 94% |
| warehouse_package_inspection | 20 | 55% | 55% | 0 | 0 | 0.0020 | 2.8 | 56% / 65% |
| **all (macro over SOPs)** | 247 | 70% | 70% | | | 0.0022 | | 68% / 72% (13 SOPs) |
| **all (micro over rows)** | 247 | 70% | 70% | | | total $0.5395 | | |

- **Headline (strict, our valid set: 12 SOPs without content_flagging)**: macro **73.8%**, micro 73.1% (166/227). All 13
  SOPs: macro 70.4%, micro 69.6% (Wilson 95% 63.6–75.0%). Upstream's metric gives the same numbers here: every answer
  had a well-formed `<final_output>` and none relied on containment.
- **Simple baseline** (`node experiments/sopbench/majority.mjs`, $0): the majority label of the 5 build rows answered on
  every dev row scores macro 37.9% strict on the same 13 SOPs (38.2% on the 12). The agent's margin is about 32–36 points.
- **Cost**: $0.5395 for 247 rows, **$0.0022 per row** (range by SOP $0.0009–0.0037), plus $0.0019 for a one-row smoke
  (`raw-haiku-smoke1`). Total phase-1 model spend **$0.54** of the $8 cap. Tokens are almost all cache reads (6.5 M read,
  1.3 M written, 5.7 K output). 3.6 model responses and 2.6 tool steps per row on average; 13.6 s per session.
- **Accounting**: 0 environment faults, 0 L5 violations (only `claude-haiku-5-5` reported; no network or package commands),
  0 nested model uses, 0 unknown-tool or `upstreamFatal` calls; one row hit the 10-step limit (customer_service row 99);
  JS and Python graders agreed on all 247 answers.
- **Where it fails** (dev rows, read from the per-row records): aircraft_inspection fails exactly on the 8 rows where the agent
  called 4–5 of the 7 tools and wrote "None" for the report tools' columns (all 12 rows with 7 calls pass) — a procedure
  step skipped, not a judgment error; know_your_business (35%) and video_annotation (50%) fail on the final escalation /
  acceptance decision; content_flagging (30%) is at the level its random tools allow (§7.1).
- **Against the paper** (Claude 4 Opus, Table 4; §6): different model, agent loop, prompt (answer format), rows (our 20 dev
  rows per SOP against all labelled rows), and scorer; content_flagging and order_fulfillment upstream agents also saw the
  answer. Per SOP, the raw Haiku agent is above both Opus 4 numbers on customer_service, dangerous_goods, referral v1/v2 and
  video_annotation, between them on aircraft_inspection (FC 45%, ReAct 97%), know_your_business (43/31%) and
  traffic_spoofing (79/60%), and below both on email_intent, video_classification and warehouse. The averages (70% here,
  68/72% there) are not comparable beyond "the same range".

## 9. Commands

```
node experiments/sopbench/split.mjs --check                       # SPLIT.json reproduces from the pinned clone
node --test --test-concurrency=1 experiments/sopbench/test/sopbench.test.mjs
node experiments/sopbench/parity.mjs                               # $0; writes research/sopbench-20261021/parity.json
node experiments/sopbench/run.mjs --scripted oracle                # $0, every dev row
node experiments/sopbench/run.mjs --model claude-haiku-5-5 --cap 7.99 --rows-per-sop 20 --concurrency 3 --run-id raw-haiku-dev
node experiments/sopbench/table.mjs research/sopbench-20261021/runs/raw-haiku-dev
```
