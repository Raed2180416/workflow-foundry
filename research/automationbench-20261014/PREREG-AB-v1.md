# Preregistration AB-v1: Haiku 5.5 + Foundry harness on AutomationBench, official protocol, public test split

Status: **FROZEN for the split and every rule below, 2026-10-15, before any Foundry harness for AutomationBench exists.**
The A1 harness itself is frozen later, by hash, in a dated **Harness-freeze addendum** (§15) that must exist before the
first test-split session. Changes after this point go only into §16 (Amendments), dated and with a reason. Nothing in this
file is a capability result.

| Field | Value |
|---|---|
| Experiment id | AB-v1 |
| Question | What strict pass rate does `claude-haiku-5-5` + Foundry harness reach on a held-out half of AutomationBench's public set under the official protocol, and is it higher than raw `claude-haiku-5-5` on the same tasks? |
| Claims tested | **C-AB1** (comparative, §10): on the 300 test tasks, A1's strict pass rate is higher than A0's. **C-AB2** (descriptive): A1's strict pass rate, mean partial credit and cost per task on the test split, as a publishable public-set score. ROADMAP link: C1, cheap-model execution with frontier-written, task-agnostic templates |
| Evidence class | Dev split: `development`. Test split: `sealed` (held-out). It is read once, by this preregistration, with every arm it will ever hold declared here (§3) |
| Split | [SPLIT-v1.json](SPLIT-v1.json), file sha256 `63bbe80794338f666d8a614ce56f9afa6efd75cd577e2b4a6c3817baa22a0ec7`, split sha256 `3f149b5afeed7bd0a4086f7f6f77b7241502f6397d3e6e09428358f2519276ba` |
| Pre-registration commit | The first commit that adds this file (the autosave commits it; find it with `git log --diff-filter=A --format=%H -- research/automationbench-20261014/PREREG-AB-v1.md`). The Harness-freeze addendum records the SHA |
| Repository HEAD when written | `276ef142f237565784ad86ee32ab8e9c87d29def` |
| Corpus | `zapier/AutomationBench` at `4a8e1061254004d9dac807054eed33fad7d1ff14`, package 1.0.6, MIT, uv.lock sha256 `c7d275af…c521` ([ACQUISITION.md](ACQUISITION.md)) |
| Date | 2026-10-15 |

Tags: **[B]** set by the workflow brief for this experiment, **[M]** measured or read in a repository file today,
**[P]** a choice this preregistration makes.

---

## 0. What the author had seen before writing

The author is an Opus 5.5 subagent. Before writing it had read [NOTES.md](NOTES.md), [ACQUISITION.md](ACQUISITION.md), the raw-Haiku
subset60 summary and per-task rows, part of `failures-classified.json`, the corpus README's leaderboard section, and
ROADMAP §4.3 and §6. It had also grepped the repository and `/var/tmp/foundry-work` for public task names to build the
exposure list.

To build the split it loaded the official datasets in AutomationBench's venv (`python -I`, minimal environment). It
printed **task names only**: assertions and worlds were in memory but were neither printed nor read. It did not read any
test-split task's prompt, world or assertions, and did not open `beds/sealed/` or any credential file. No model was
called. The prediction in §13 therefore rests on dev-side evidence (the subset60 run) and the public leaderboard only.

## 1. Beds and splits

### 1.1 The split [B, M]

Built by `node experiments/autobench/split.mjs --write` (sha256 of `split.mjs` at writing:
`0118555eb889a92f0fce675357f9be9849b7aadf9fbc7192a4cb46e68bc3b1bd`) and checked by
`node experiments/autobench/split.mjs --check`, which recomputes the split from the corpus listing and returns `ok: true`.
Tests: `node --test experiments/autobench/test/split.test.mjs` (3 pass).

- **Universe.** The 600 scored public tasks: 100 each in sales, marketing, operations, support, finance and hr. The 200
  `simple` tasks are excluded. Universe sha256 `6f0c3f869b6a3f8eb8bdf06c0ed24e38e88bc814a0709961a780e5e3c9171dfb`.
- **Rule** (verbatim in the JSON). Per domain, order the tasks by `sha256('ab-split-v1:' + taskName)`, ascending. The
  base test set is the first 50. Every *exposed* task (§1.2) is forced into dev. For each forced task in the base test
  set, taken in hash order, move it to dev and move the lowest-hash dev task of the same domain that is neither forced
  nor already in test into test. The result: test is the first 50 non-forced tasks of each domain in hash order, and
  dev is the rest.
- **Counts.** Test is 300 tasks (50 per domain) and dev is 300 (50 per domain). Every one of the 103 exposed tasks is in
  dev, including all 60 subset60 tasks.
- **List hashes.** Each hash is the sha256 of the compact JSON array sorted by code unit:
  - dev: `6e1cc09611b6b7efe501eab6bde2456bd07ca6c377114ebdc88b1a088030bcc9`
  - test: `719db32530844bf3424329eb8a2f7ccbf6788f87b6161868863abb8865d29af4`
- **devCheck.** 60 tasks, 10 per domain: the non-exposed dev tasks ordered by `sha256('ab-devcheck-v1:' + task)`, first
  10 per domain. A dev hold-back for go/no-go looks (§5). sha256 `74cf7615…25a7`.
- **testRef.** 60 tasks, 10 per domain: the test tasks ordered by `sha256('ab-ref-v1:' + task)`, first 10 per domain.
  These are the only test tasks the optional reference arms may run on (§3). sha256 `ce246e29…a1b2`.

### 1.2 Forced swaps and the exposure set [B, P]

The brief requires every subset60 task in dev. This preregistration widens that to **every scored task exposed before
the freeze**, because a test task whose assertions an agent has already read is not held out. The widening only moves
tasks from test to dev.

| Source id | Exposure | Tasks |
|---|---|---|
| S1-raw-haiku-subset60 | raw Haiku sessions run and graded; transcripts, per-assertion grades and failure classes read ([runs/raw-haiku/subset60](runs/raw-haiku/subset60/)) — required by the brief | 60 |
| S2-recurring-design-grounding | task source (prompt, world, assertions) read and summarised with line spans ([RECURRING-DESIGN.md](RECURRING-DESIGN.md)) | 24 |
| S3-parity-35 | scripted no-model sequences derived host-side from the hidden assertions; per-task scores in [parity.json](parity.json) | 30 |
| S4-parity-per-domain-1 | earlier scripted parity runs, graded host-side (live directories only) | 5 |
| S5-named-in-repo | named in the 2-task parity test, the NOTES worked example, family grounding | 4 |
| **Union** | | **103** |

That gives **55 forced swaps** (sales 9, marketing 11, operations 9, support 10, finance 10, hr 6), each listed in the
JSON with the task moved out, the task moved in, both hash ranks and the reasons:

- **34 swaps come from subset60** (sales 4, marketing 5, operations 7, support 5, finance 7, hr 6). These are the swaps
  the brief's minimum rule alone would have produced.
- **The other 21 come from S2–S5.**

A consequence to disclose (§11): the subset60 and parity picks were seeded-random, but the S2 tasks were chosen by a
person or agent for how well they fit a recurring family. So the test split is a hash-random draw from the 497
non-exposed tasks, not a uniform half of the 600.

### 1.3 Split hygiene from now on [P]

- **Dev runs use dev tasks only.** Every paid or scripted run before the Harness-freeze addendum uses dev tasks (or
  `simple`). `assertDevOnly()` in `split.mjs` is the guard, and the A1 runner must call it unless it was given the frozen
  harness hash (§6.1).
- **No other work opens test tasks.** No family design, note, parity run, scripted fixture or analysis may open a test
  task's prompt, world, assertions or grade before the test run ends. New families ground only on dev tasks.
- **Accidental exposure burns a task.** If a test task is exposed anyway, a dated amendment records it as burned before
  the test run. The headline is then reported both with and without burned tasks, and the version without them is the
  headline.
- **The test split burns after one run.** After the test run, any later harness version's score on these tasks is
  labelled "post-test, not held out".

### 1.4 Oracle [M]

The oracle is the official rubric (`create_rubric()` at the corpus pin), unchanged:

- `task_completed_correctly` (every scored assertion passes) and `partial_credit`.
- An assertion already true at the start is excluded unless the agent breaks it.
- A raising assertion zeroes the task.

The bridge reproduces the official environment exactly (35/35, [parity.json](parity.json)). No assertion, rubric or
grade is ever weakened or edited (ROADMAP §6 rule 4).

## 2. Protocol held constant across arms [B, M]

| Item | Value |
|---|---|
| System prompt and user message | The official ones, byte-identical (`row.prompt`), delivered as system prompt and user message. A harness may only *append* text after the official system prompt, as A0's adapter section does |
| Toolset | `api`: `api_search`, `api_fetch`, `base64_encode`, served by `bridge.py serve` through `tool.mjs`. No other path to the world |
| World steps | at most 49 served bridge steps per task (a `call` or `batch` is one step; the 50th model response's calls never run, as in `MultiTurnEnv`); the bridge refuses later steps |
| Model responses | at most **50 per task**, summed over every model call made for the task (§4 H3) |
| Rollouts | one rollout per task per run, in one live world, from the official initial world (`k = 1`, `det = record`) |
| Per-task budget | $0.75 list price over all model calls for the task; 20 min wall timeout |
| Grading | the official rubric on the final live world, host-side; grades never reach the session |
| Environment | corpus pin, uv.lock, Python 3.13.16, the same bridge/tool client, the same executor sandbox, same machine and time window, concurrency 4 task slots |

A0's frozen files today are the same files the subset60 run recorded in its provenance:

| File | sha256 |
|---|---|
| `experiments/autobench/run.mjs` | `14d3577af7dc90bd4c23915f13cadd9678d906c58ece278c174383d8b24091ff` |
| `experiments/autobench/bridge.py` | `285be4f5ba32f569c904897d512524535f6b50c11c05d54e419e5e272f97641a` |
| `experiments/autobench/tool.mjs` | `eac87bd9ab18389d703323ad5cf10d845f00bc625deedf71f516a26b25831262` |
| `experiments/autobench/lib.mjs` | `0685f2344101b039574bf8f02323f8ef82df38e00ad2f014642127cfc30f4052` |
| `src/executors/claude-code.mjs` | `f363c80418bf9bb91e6e8d42adc1345eba24274a56f6d870759ea2eebbe35afc` |
| `policy/models.json` (version 2026-10-15.1) | `9a5a467a3782d98beaa50c4e869d566d6a2ee3cbb6dfd699128971902200f0bc` |

Claude Code CLI 2.1.300.

## 3. Arms

| Arm | Definition | Models (run time) | Runs on | K | Budget | Role |
|---|---|---|---|---|---|---|
| **A0** raw Haiku | The existing runner, unchanged: `run.mjs --model claude-haiku-5-5 --effort high --budget 0.75 --timeout-min 20 --max-steps 50 --det record --k 1 --tools Bash --concurrency 4` (the subset60 settings) | `claude-haiku-5-5` | dev, then test | §6.2 | within the dev and test caps | baseline |
| **A1** Haiku + Foundry harness | Defined by the harness manifest frozen in the addendum (§15); bound by §4 | `claude-haiku-5-5` only | dev, then test | same as A0 | within the dev and test caps | headline |
| A2 Sonnet raw (optional) | A0's runner with `--model claude-sonnet-5-5 --budget 1.50` (Sonnet's list price is 20× Haiku's) | `claude-sonnet-5-5` | testRef only (60), after A0 and A1 test runs are recorded | 1 | cap $30 | reference only, never in a claim |
| A1F forked rehearsal (optional) | A1 plus any practice in a forked copy of the world (§12) | `claude-haiku-5-5` only | dev; testRef only, after A0 and A1 | 1 | cap $15 on test; dev spend within $60 | separately labelled, never headline |

**A0 stays A0 during development.** If shared files change for A1 (runner, bridge, client, lib), two $0 checks must pass
before the test run, or A0 is run from the frozen file versions above:

- For every test task, A0's system prompt (with the adapter text), user message and tool catalog must be byte-identical
  to what the frozen A0 files produce. A host-side script compares hashes and prints only counts.
- The bridge must reproduce parity 35/35 again.

No other arm may run on the test split. An arm not declared here cannot be added after the test run starts.

## 4. A1 constraints: what "official protocol" means for a harness [B, P]

- **H1 Input.** The official system prompt and user message, byte-identical, are the acting model's first system and user
  content. The harness may append instructions after the official system prompt and add its own messages. It may not
  edit, paraphrase, truncate, reorder or omit the official text.
- **H2 World access.** Only the three official tools, through the bridge mailbox. No access to the corpus, the dataset,
  the initial-world dump, the rubric, grades, the task name, `zapier_tools` or host directories. A1 runs in the same
  executor sandbox as A0, verified by the sandbox probe (§8 L4).
- **H3 Step accounting.** At most 49 bridge steps, enforced by the bridge, as for A0. At most 50 model responses per
  task across *all* model calls (acting, planning, checking, summarising, sub-sessions):
  - counted as the executor reports them: `num_turns` per `claude -p` session, one per direct call;
  - a task-run over 50 scores as a **fail** in the headline (its live grade is reported separately);
  - the same rule applies to A0 (subset60 maximum: 23 turns [M]).
- **H4 Models.** Every run-time model call uses `claude-haiku-5-5`, the id in the policy file. No Sonnet, Opus, Jev,
  open-weight or other model at run time. Frontier models may write the harness at build time (architect role) and are
  disclosed.
- **H5 No practice.** A1 acts once, in the one live world, from the official initial state. Not allowed:
  - forks, world copies or exports, dry runs against a copy, rollback, or a re-run of the task;
  - choosing among several attempts.

  Anything of that kind is A1F (§12).
- **H6 No grader signal.** The harness and the agent never see assertions, rubric code or output, partial credit, task
  names, other forks' or other tasks' results, or anything from the test split. The harness may not branch on the
  task's identity.
- **H7 Task-agnostic content.** The harness contains no public task name and no task-specific literal. Generic rules
  learned on dev are allowed (for example "the newest policy found in the world overrides older ones", or "post where
  the policy says"). The leakage scans (§8) enforce the measurable part.
- **H8 Declared knowledge.** Every knowledge source compiled into the harness is listed in the manifest. Examples:
  architect-written guidance from dev failures, and endpoint notes derived from the API schemas shipped with the
  environment (the same index `api_search` searches). Nothing derived from test tasks, rubric code or grades of any
  task may be compiled in.
- **H9 Budget.** Per task: $0.75 over all model calls and 20 min wall, as for A0.
- **H10 Deterministic code.** Allowed without limit inside the sandbox (parsing, ledgers, checks). Every world call it
  makes counts toward the 49 steps.
- **H11 People.** No human in the loop at run time.
- **H12 Routing.** If A1 decides per task whether to act directly or build a task-scoped workflow (the need-router idea),
  it logs the route and its inputs for every task. Route-conditional results are exploratory only (§9.4).

## 5. Development phase (dev split only)

- **dev-train** = dev minus devCheck = 240 tasks, including all 103 exposed tasks. Iterate freely here: run A0 and A1,
  and read transcripts, grades and assertions *as the developer*. Only generic lessons may enter the harness (H7, H8).
- **devCheck** (60 tasks) is for go/no-go only:
  - at most **3 A1 looks** (3 harness versions), plus A0 runs;
  - the developer sees aggregates only: per-arm and per-domain pass rate, partial credit, cost, steps/turns, error
    counts — no per-task transcripts or grades;
  - A0 runs devCheck with K = 2 (one extra run) to measure A0's run-to-run flip rate, which updates the power table in
    the addendum (informational; no rule changes).
- **Dev budget: $60 total** for every dev-split model call by any arm (A0 completion of dev, A1 iterations, devCheck
  looks, any A1F work) [B]. The ledger is the sum of `cost.spentUsd` over dev run summaries. No dev session starts once
  spent + reserved would exceed $60. Planned (non-binding):

  | Item | Planned |
  |---|---|
  | A0 on the 240 dev tasks not yet run (K = 1) | about $4 |
  | A0 second run on devCheck | about $1 |
  | A1 iterations | at most $45 |
  | devCheck looks | at most $10 |

- **Freeze selection.** The frozen harness is the devCheck-evaluated A1 version with the highest devCheck strict pass
  rate; ties go to the lower mean cost, then the later version.
- **Go criteria for the test run** (all must hold):
  - **G1:** the frozen version's devCheck strict pass is at least A0's devCheck strict pass (run 1) + 3 points, paired.
  - **G2:** its devCheck mean cost per task fits §6.2.
  - **G3:** no integrity violation (§8 L1–L5 clean on dev).
  - **G4:** the controls pass (§8).
- **Stop rules.** Development stops at $60, or after the third devCheck look, or on the owner's instruction.
  - If no version meets G1–G4, the **test run does not happen**. "No dev gain for A1" is recorded as a negative result
    in `docs/RESEARCH.md`, and the test split stays sealed and unburned for a later preregistration.
  - An infrastructure stop (provider rate limits on more than 5% of a run's sessions) pauses the run. The affected
    sessions are re-run under §6.3.

## 6. Test run (once)

### 6.1 Preconditions, in order

The **Harness-freeze addendum** (§15) is written and committed before the first test session. It records:

1. The harness manifest and harness hash. The hash is the sha256 of the canonical JSON
   `{files: [{path, sha256}] sorted by path, config: {model, effort, budgets, step limits, executor options}}`, and it
   covers every file A1 reads or runs.
2. The A0 file hashes (§2), the CLI version, the policy version and hash, the claude-cli child environment, and the
   analysis-script hash (§9).
3. The results of the A0 prompt-identity check and the parity re-run (§3), the leakage scans and the sandbox probe
   (§8), and the devCheck go evidence (§5).
4. The computed K (§6.2), the spend cap and the task order (§6.3).

The runner refuses test tasks unless it is given the harness hash and recomputes the same hash from disk at start.

### 6.2 K and the cap [B, P]

- **Cap: $40 for A0 + A1 on the test split together**, as a hard ledger.
- **K rule.** K = 2 runs per task per arm if `projected = 300 × 2 × (A0 mean cost per task on dev + A1 mean cost per task
  on devCheck) × 1.15 ≤ $40`. Otherwise K = 1.
  - K = 1 downgrades C-AB1 in advance to **"directional (K = 1)"** (ROADMAP §4.3: no K = 1 comparative claims).
  - With A0 at about $0.0154 per task [M, subset60], K = 2 needs A1 at or below about $0.042 per task.
- **Run order.** All of run 1 (both arms) first, then run 2, so the cap can only cut run 2.
- **A2 and A1F.** They have their own caps (§3) and start only after the A0 and A1 test runs are complete and recorded.

### 6.3 Order, interleaving, aborts

- **Task order.** Tasks run in order of `sha256('ab-order-v1:' + task)`. For each task, A0 and A1 run back to back in the
  same window. A0 goes first when the first hex digit of `sha256('ab-arm-v1:' + task + '#' + run)` is even, otherwise A1
  goes first. Concurrency is 4 task slots.
- **Aborts.** This mirrors the official `--ensure-complete`.
  - **What counts:** a session that ends on an infrastructure error — provider 429 or rate limit, 5xx or overload,
    network failure, as recorded by the executor, or a bridge `harnessError`.
  - **What happens:** it is re-run from a fresh official initial world, up to 2 more times, and every re-run's cost
    counts.
  - **What does not count:** timeouts, budget exhaustion, step-limit refusals, malformed calls, and exceptions in A1's
    own harness code. These are graded as left.
  - **Never completed:** a task-run that never completes scores 0 (pass 0, partial credit 0) and is listed.
- **Contamination stop.** If more than 10% of the sessions so far hit provider rate limits (the E8 s12 precedent), the
  run pauses until the limit resets and resumes with the same frozen harness. The affected sessions are re-run under the
  abort rule.
- **Interim looks.** Progress counts and spend may be watched. Nothing may change, and no per-task test transcript or
  grade may be read, until the run and the analysis script are done.

### 6.4 After the run

The analysis script runs once. Only after that may anyone read per-task test failures, and doing so burns the split for
later versions (§1.3).

## 7. What counts as a harness change [B, P]

Any change, after the addendum, to anything that can alter what A1's model sees or what A1 does:

- **The harness manifest:** code, prompts, templates, skills, guidance, endpoint notes and configuration.
- **Model settings:** the model id, effort or thinking settings, the per-task budget or timeout, and step accounting.
- **Execution setup:** concurrency, the sandbox profile, the executor, and the Claude Code CLI version.
- **Shared files:** the `claude-cli` and `claude-haiku-5-5` entries of the policy file, and `bridge.py`, `tool.mjs`,
  `lib.mjs`, `run.mjs` or any module they import.
- **The environment:** the corpus commit or the venv.

Changing the analysis script after the addendum is also forbidden. If it proves wrong, an amendment reports both the
frozen and the corrected analysis, and the frozen one stays primary.

A harness change during the test run **invalidates the A1 test result**, and there is no second test run on this split.
The public set has no further unseen tasks, so the honest outcome is "no valid held-out score".

Not a change: documentation, and the run's own output files. Provider-side drift behind a fixed model id is not a
harness change. It is recorded (dates, CLI version) and disclosed.

## 8. Controls and integrity checks

All $0, before the test run, recorded in the addendum. Host-side scripts print counts and file names, never task text.

- **L1 Task-name scan.** No harness file contains any of the 800 public task names. Required count: 0.
- **L2 Prompt-shingle scan.** No harness file contains an 8-word shingle (lowercased, whitespace-normalised) of any test
  task's user message. The official system prompt is excluded. Required count: 0.
- **L3 World-literal scan.** No harness file contains a string of 16 or more characters that occurs as a value in any test
  task's initial world. Each hit is reviewed in the addendum, and a genuine one blocks the freeze.
- **L4 Sandbox probe.** From inside A1's executor sandbox, reads of these must fail:
  - `corpus/AutomationBench`, `research/` and `experiments/autobench/families`;
  - the bridge's `prep` and `host` directories, and `/var/tmp/foundry-work/autobench/*/host`.
- **L5 Transcript audit**, after every dev run and after the test run. Each session may call only `tool.mjs` and
  workdir-local commands. The executor must report only `claude-haiku-5-5` (for A0 and A1). Model responses must be at
  most 50 and bridge steps at most 49. A violation makes that task-run a fail and is listed. Violations in more than 2%
  of test task-runs block C-AB1.
- **C1 No-op control.** On devCheck, a scripted session with no tool calls scores pass 0 on every task.
- **C2 Parity.** `node experiments/autobench/parity.mjs --per-domain 5` must give 35/35 exact if the bridge changed since
  `parity.json`.

## 9. Measurements and analysis

The analysis script is `experiments/autobench/analyze-ab.mjs`. It is written and tested on dev data, and its sha256 is
recorded in the addendum before the test run. The bootstrap seed is the string `ab-v1`, with B = 10000.

### 9.1 Per arm (overall, n = 300, and per domain, n = 50)

- **Strict pass rate** = the mean of `task_completed_correctly`. With 50 tasks per domain this equals the official mean
  over domains.
  - **Headline: run 1** (one rollout per task, as the official protocol).
  - Also reported: the K-run mean.
  - **Wilson 95% interval**, z = 1.959964.
- **Mean partial credit** (official `partial_credit`), with a domain-stratified bootstrap 95% CI.
- **Cost.**
  - Mean, median, p90 and total USD per task, at list price as the CLI reports it (`total_cost_usd`), including
    re-runs.
  - **CPS** = total arm cost ÷ strict passes.
  - The same costs recomputed from journaled tokens at the policy price table.
- **Usage and failures.** Steps and model responses per task (mean, max); timeouts, aborts, re-runs, session errors and
  L5 violations.
- **Guardrail breakage.** The share of tasks where an assertion true at the start ended false, from host-side grade
  files.

### 9.2 Paired comparison A1 vs A0 (test)

- **Primary test: exact McNemar on run 1.** Let b = tasks where A1 passed and A0 failed, and c = the reverse. The test is
  a two-sided binomial test on b against b + c at p = 0.5, with α = 0.05.
- **Reported with it:** b, c, the difference in points, and a domain-stratified paired bootstrap 95% CI.
- **Replication (K = 2):** the same statistics on run 2, plus a paired sign test on per-task K-means.
- **Secondary:** the partial-credit difference (Wilcoxon signed-rank, two-sided; bootstrap CI) and the cost ratio
  A1/A0 (bootstrap CI).
- **Per-domain differences** are reported with no per-domain claim.

### 9.3 Power [M, P]

These figures are exact-McNemar power for n = 300 paired tasks, α = 0.05 two-sided. `c` is the share of tasks A0 passes
and A1 fails. It is unknown until devCheck measures A0's flip rate.

| Gain Δ (points) | c = 0.04 | c = 0.07 | c = 0.10 |
|---|---|---|---|
| +3 | 0.28 | 0.20 | 0.16 |
| +5 | 0.62 | 0.47 | 0.37 |
| +7 | 0.87 | 0.73 | 0.61 |
| +10 | 0.99 | 0.94 | 0.87 |
| +15 | 1.00 | 1.00 | 0.99 |

The design reaches power 0.8 only for gains of about +7 to +10 points. Below that, "directional, no decision" is the
expected outcome, and it is declared here in advance. For scale, the Wilson 95% half-width at n = 300 near 22–30% is
about ±5 points; per domain (n = 50) it is about ±11 to ±13 points.

### 9.4 Exploratory (no claims)

- **Route-conditional A1 results**, if A1 routes (H12). Does a task A1 routes "direct" do as well as A0 on the same
  task?
- **A0 over all 600 public tasks** (dev run 1 plus test run 1). This is an untuned raw-Haiku public-set number through
  the bridge and may be shown as such.
- **A2 and A1F** on testRef (§3, §12).

## 10. Decision rules for C-AB1

- **Supported:** all of the following hold.
  - Run-1 McNemar p < 0.05 with b > c, and a difference of at least 3 points.
  - With K = 2, run 2 shows a difference of at least 3 points in the same direction. Otherwise the result is "not
    replicated".
  - L5 violations affect no more than 2% of task-runs.
- **Directional, no decision:**
  - a difference of at least 3 points with p ≥ 0.05; or
  - K = 1; or
  - a run-2 replication cut short by the cap (reported as "partial replication").
- **Not supported:** a difference under 3 points, or a negative difference. Gaps under 3 points are noise (ROADMAP
  §4.3).
- **Harm:** c > b with p < 0.05. This is reported first.
- **Cost:** reported with no decision.
- **Kill rule:** if C-AB1 is not supported, no "Foundry improves Haiku on AutomationBench" statement is made anywhere. The
  A1 score may still be published under §11 as a score, never as a gain.

## 11. Disclosure list for any published number

Any AB-v1 number published anywhere (README, a post, a leaderboard request, a chart) carries all of these:

1. **Public set only.** The number covers the 300-task test half (SPLIT-v1) of AutomationBench's public 600-task set at
   commit `4a8e106` (package 1.0.6).
   - It is **not** the official private held-out set behind zapier.com/benchmarks, which the README calls "purposely
     harder". It is directional against that leaderboard only.
   - It is not 1:1 comparable with the README's public 600-task table: different task subset, scaffold and effort
     setting.
   - It is a self-reported number, not an official leaderboard entry.
2. **The split.** It is hash-random among the 497 non-exposed tasks. 103 exposed tasks were forced into dev, 21 of them
   for reasons that were not random (§1.2).
3. **The arms.**
   - A1: `claude-haiku-5-5` + Foundry harness, with the harness hash, a one-paragraph description of its components and
     its declared knowledge sources (H8).
   - A0: `claude-haiku-5-5` with the official prompt only, through the same bridge, on the same tasks.
4. **Models and settings.**
   - Run time: `claude-haiku-5-5` only, through Claude Code CLI (version), `claude -p`, effort high, policy version.
   - Architect: `claude-opus-5-5` built the harness on the dev split. It read dev assertions as the developer, never at
     run time.
   - No human task-level assistance.
5. **Protocol adaptations.**
   - Tools are reached through Bash and a file mailbox, not native tool calls, so one model response may run several
     dependent steps in a shell (both arms).
   - Step accounting (49 world steps, 50 model responses over all calls).
   - $0.75 per task and 20 min wall; the abort re-run rule; `det = record`; one rollout per task per run.
6. **The score.**
   - Run-1 strict pass rate with its Wilson 95% interval and n; mean partial credit; per-domain rates.
   - K and the run-2 replication.
   - A0 on the same tasks, the McNemar b, c and p, and the decision label from §10.
7. **Cost.**
   - Mean and total USD per task, and CPS.
   - List prices as reported by the CLI, under its caching flags (`FORCE_PROMPT_CACHING_5M=1`, which lowers reported
     cost).
   - Development spend.
8. **Development.** Dev size, the number of harness versions, the devCheck looks used, and that the architect saw dev
   grades.
9. **Exclusions.**
   - A1F (forked rehearsal) is excluded from the headline.
   - A2 is a reference only.
   - Burned tasks and integrity violations are listed.
   - Any deviation from this file is listed with its amendment.
10. **Benchmark caveat.** The public set has been revised for fairness (CHANGELOG 1.0.5 and 1.0.6), and task-level bugs
    are possible.
11. **The forecast.** The §13 forecast is shown next to the result.

## 12. The forked-rehearsal exclusion [B]

A forked rehearsal is any use of a copy of the task's world before or instead of acting in the scored world:

- exporting or forking the initial world;
- rehearsing actions in a copy, then replaying them;
- running k forks and voting (`run.mjs --k > 1`);
- retrying after a rollback.

It gives the agent more than the official one attempt in one world, so it is **never the headline and never pooled with
A1**. The result cannot be "the better of A1 and A1F". If it runs, it is labelled **A1F (forked rehearsal, not official
protocol)**, runs on testRef only after A0 and A1, and is reported in its own table.

## 13. Prediction (written before any harness exists)

The evidence behind the forecast:

- **A0 on subset60:** 13/60 = 21.7%, Wilson 13–34%, mean partial credit 0.63, $0.0154 per task [M].
- **Failure classes:** of 10 classified failures, 3 were policy or guardrail violations, 3 wrong field, 2 endpoint
  discovery and 2 incomplete multi-step.
- **Near misses:** 11 of the 47 failures scored at least 0.8 partial credit.
- **Public leaderboard:** Sonnet 5 (max) 34.67% and Opus 5 (max) 50.3% on the full public set [doc].

A same-model harness can plausibly fix omissions (unsearched apps, unfinished steps) and some policy-recency mistakes
through a requirement ledger and a final check. It is unlikely to fix judgment errors or literal-wording misses that the
same Haiku model also makes when checking.

| Quantity (test split, run 1) | Point | 80% range |
|---|---|---|
| A0 strict pass | 22% | 18–27% |
| A1 strict pass | **28%** | **22–35%** |
| A1 − A0 | +6 points | 0 to +12 |
| A1 mean partial credit | 0.70 | 0.64–0.76 (A0 about 0.63) |
| A1 mean cost per task | $0.04 | $0.025–0.07 (2–4× A0) |
| P(C-AB1 supported, §10) | 0.40 | |
| P(A1 ≥ 34.67%, the README's public number for Sonnet 5 max) | 0.20 | |
| P(K = 2 affordable under §6.2) | 0.55 | |
| devCheck A1 gain vs test A1 gain | devCheck overstates by about 2 points (selection over ≤ 3 looks) | |

## 14. Cost and threats to validity

### 14.1 Cost [B, P]

| Phase | Cap |
|---|---|
| Dev, all arms | $60 |
| Test, A0 + A1 | $40 |
| A2 (optional, testRef) | $30 |
| A1F (optional, testRef) | $15 |
| **Ceiling** | **$145** |

The ceiling is below the policy's $500 per-experiment pause. Every cost comes from the CLI-reported list price, and every
429 is recorded.

### 14.2 Threats to validity

- **Bridge deviations** affect both arms equally ([NOTES.md](NOTES.md) §9):
  - Bash-mediated tools let shell loops chain dependent calls inside one model response.
  - Claude Code headless instead of the Messages API.
  - Thinking set by CLI effort.
- **Public and private differ.** Public tasks share authoring patterns. Generic lessons from dev tasks may transfer to
  public test tasks better than to the private set, so a public-test gain may overstate a private-set gain.
- **Grader-literal tuning.** Dev assertion reading can teach output habits that match the grader's wording rather than
  the task. H7 and H8 allow only rules grounded in what the world or the prompt says. Residual risk is disclosed.
- **Provider drift.** Haiku served behind a fixed id may change. Interleaving A0 and A1 per task in one window shares
  the drift between them.
- **Rate limits** from other agents' runs on the same subscription. The test run starts only when no other paid run is
  active. The abort and contamination rules apply.
- **Small per-domain n** (50). Per-domain results are exploratory.
- **Exposure scan blind spots.** The scan covered the repository and `/var/tmp/foundry-work` for exact task names. An
  exposure that never wrote a task name (for example a person reading the corpus) cannot be detected. Known exposure is
  all in dev.

## 15. Harness-freeze addendum (to be appended before the test run)

It must contain:

- the date;
- the commit of this file;
- every item in §6.1;
- the dev ledger (spend per run, harness versions, devCheck looks with aggregates);
- the A0 devCheck flip rate and the updated power line;
- K;
- the burned-task list (expected: none).

Once it is appended, nothing in §2–§12 may change.

## 16. Amendments

Dated entries only. Entries AM-1 to AM-7 come from the integrity review of 2026-10-15 (an Opus 5.5 subagent, after the
A1 build and before any paid A1 session). No model was called and no test task's text was read: the exposure check
read task names, header markers and counts only.

**AM-1 (2026-10-15) H3 step counting.** §4 H3 said responses are "counted as the executor reports them: `num_turns` per
`claude -p` session". That count is wrong. In the CLI the subset60 sessions ran on (2.1.299, see AM-5), `num_turns` is
the number of tool results + 1, not the number of model responses. It differed from the real response count in 22 of 60
subset60 sessions (by −1 to +3), and a session re-woken by a background task reported `num_turns` 1 for 16 responses.
From now on, for both arms:

- a model response is one distinct assistant message id across the whole stream;
- each context compaction (`compact_boundary`) counts as one more response;
- `num_turns` is reported beside it (`accounting.mjs`).

The rule itself is unchanged. More than 50 responses, or a world step issued by response 50 or later, fails the
task-run in the headline. A1's CLI step guard (`--max-turns 49`) exists in A1 only. It can stop an A1 session early,
never late, and is disclosed (AM-7).

**AM-2 (2026-10-15) Exposure missed by the freeze, and burned test tasks.** The freeze's exposure scan (§0, §14.2)
covered the repository and `/var/tmp/foundry-work`. It did not cover agent transcripts or the session scratchpad.

*What was found.* The AutomationBench-R families workflow (`wf_c02e0b27-037`) ran before the freeze, from 01:11 to 01:39
UTC on 2026-10-15. Its agent ran a scratch script (`brief.py`) that printed task briefs into its context:

- the user prompt (the first 650–900 characters);
- in the script's first version, also up to 14 assertions per task.

The script wrote nothing to disk. The full lists, the evidence path and the method are in
[EXPOSURE-20261015.json](EXPOSURE-20261015.json).

*Test split.* 34 test-split tasks had their prompt printed, and 12 of these also had their assertions printed. By
§1.2's own standard they are not held out.

| Domain | sales | marketing | operations | support | finance | hr | total |
|---|---|---|---|---|---|---|---|
| Burned | 6 | 5 | 9 | 6 | 4 | 4 | **34** |
| Test tasks left | 44 | 45 | 41 | 44 | 46 | 46 | **266** |

One more test task (`test.namedOnly` in the JSON) was only named in a source-span lookup. It is not burned.

*Dev split.* 17 non-forced dev tasks were also briefed. 6 of them are in devCheck.

*Who saw it.* The agents of the AB-v1 workflow that built the split and the A1 harness never saw the briefs. A count of
test names over the whole transcript store found them only in:

- the families agent;
- the freeze agent's swap list (names only);
- the workflow journal (names only);
- this review (names only).

**Rule from now on (§1.3 applies).**

- The 34 tasks are burned.
- The test run still runs all 300 tasks in both arms.
- The **headline is computed without the burned tasks**:
  - Strict pass rate is the mean over the six domains of each domain's pass rate on its remaining tasks. This is the
    official domain weighting. The pooled mean over the 266 tasks is also reported.
  - McNemar and the bootstrap use the 266 paired tasks.
  - The all-300 numbers are reported beside the headline.
- testRef loses 4 tasks. A2 and A1F run on all 60 and are reported on the 56 that remain.
- `RECURRING-DESIGN.md` and `experiments/autobench/families/` were written by the exposed agent. They are **not allowed
  as A1 knowledge sources** (H8), and A1 developers do not read them.
- The 6 exposed devCheck tasks stay in devCheck. Their exposure went to the families agent, not to the harness
  developer, and it is disclosed.

**Owner decision before the first paid dev session.** The alternative is SPLIT-v2: the same rule, with the forced set
extended by:

- the 51 newly exposed tasks;
- the 6 scripted-smoke tasks (`runs/a1-smoke-scripted`).

That keeps the test split at 300 balanced and unexposed tasks. It is admissible only before any paid dev session,
because a re-split moves dev tasks into test.

*Scan from now on.* `node experiments/autobench/exposure-scan.mjs` scans:

- the repository;
- `/var/tmp/foundry-work`;
- this project's agent transcripts.

Pass `--roots` to add scratchpads. It prints file names and counts only. It runs before the addendum, and its result is
recorded there.

**AM-3 (2026-10-15) L5 implemented; session egress.** The executor sandbox hides the repository, the corpus and the
host-only directories. It does not block the network: the CLI needs its API, and `HTTPS_PROXY` passes into the sandbox
(`src/executors/claude-code.mjs:101-102`, frozen). So a session's Bash could reach the public AutomationBench
repository. L5 is now enforced host-side for both arms (`accounting.mjs` `commandFlags`, `auditSession`). Each of the
following is a violation, and a violation fails the task-run in the headline:

- a model other than the run's model in the stream or the result's `modelUsage`;
- a network or package command (curl, wget, git, pip, npm and so on);
- network code;
- a reference to the benchmark's distribution;
- a missing host transcript.

Request bodies and heredoc text written by the session are excluded. On the 60 subset60 transcripts (749 Bash
commands) this flagged 0 commands.

**AM-4 (2026-10-15) Split hygiene for every arm; sealed runs.** §1.3 required `assertDevOnly` for A1 only. A0 runs, dry
runs (which print a prompt), scripted runs and `parity.mjs` with any other seed or size could open test tasks: for
example, `parity.mjs --per-domain 10` selects 13 test tasks, and `run.mjs --subset 12 --seed 2` selects 5. `run.mjs` now
refuses test-split tasks in every mode before anything is prepared. Only two cases are exempt:

- A1 given the frozen harness hash;
- an A0 model run given `--test-run AB-v1`. A dry or scripted run is never exempt.

A run holding devCheck or test tasks is **sealed**:

- per-task grades are not logged;
- the repo copy writes per-task records to `results.sealed.jsonl`, which is read only after the go/no-go decision (§5)
  or after the analysis (§6.4).

**AM-5 (2026-10-15) Cost flags, CLI version and policy version: corrections.** The subset60 baseline (A0, dev) ran on:

- Claude Code **2.1.299** (§2 said 2.1.300; 2.1.300 is today's CLI);
- policy 2026-10-09.1;
- with `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` and `FORCE_PROMPT_CACHING_5M` **unset**. Every session wrote 1-hour
  prompt-cache entries (`ephemeral_1h_input_tokens`), and `analytics_disabled` was false. The executor passes these
  variables through from the shell. The policy's `childEnv` is not applied by this runner.

§11 item 7 is corrected. Costs are the CLI's list prices under the **recorded** child environment, not under
`FORCE_PROMPT_CACHING_5M=1`. Run provenance now records the CLI version, the child environment and the policy-file
hash. A0's prompt-identity check (§3) must also show the same CLI version and child environment for A0 and A1.

**AM-6 (2026-10-15) Harness manifest scope.** The manifest config now pins:

- the policy *entries* the run uses (the `claude-cli` provider and the model entry). These are the §7 definition. The
  whole policy file changes for other experiments: it went to 2026-10-15.2 today for a Jev entry, so its file hash is in
  run provenance instead;
- the CLI child environment;
- the corpus commit and the uv.lock hash;
- the declared knowledge sources (H8, `KNOWLEDGE` in `harness/foundry.mjs`).

**AM-7 (2026-10-15) Additions to the disclosure list (§11).**

- Session egress, and the L5 counts per arm (AM-3).
- The burned tasks, with the headline on the remainder (AM-2).
- H3 counting (AM-1).
- The A1-only CLI step guard.
- Claude Code's own scaffolding around the official text, in both arms:
  - the CLI's Bash tool definition;
  - [doc, unverified at $0] the CLI's truncation of long command output, where the official loop returns full tool
    messages.
- The official Claude configuration sets thinking from `--reasoning-effort`, either adaptive with `output_config.effort`
  or a token budget, with `max_tokens` 64000 (`eval.py:246-265`). Here thinking follows the CLI's `--effort high`.
- The CLI version and child environment of each run (AM-5).

Two harness wording changes were made by the review before any paid A1 session: "evaluation harness" became "harness",
and the Stop phase now says the final reply stays in the conversation, never in an app. The harness id stays a1-v1.

**AM-8 (2026-10-15) Decision on AM-2, and a rescan before the test run.** Decided by the orchestrating session under the owner's standing authorization ("don't ask me for perms", 2026-10-14). It is recorded here before any paid dev session.

1. SPLIT-v1 is kept. The 34 burned test tasks are excluded, and the headline uses the remaining 266 test tasks, domain-weighted as AM-2 states. There is no re-split: a SPLIT-v2 would move dev tasks into test and gains nothing over excluding the burned ones.
2. Before the test run, `experiments/autobench/exposure-scan.mjs` is re-run over the repository, the live directories and every agent transcript of this session, after the families workflow and any other workflow has finished.
   - Every test task newly found exposed (its prompt or its assertions in any context) is burned by the same AM-2 rule.
   - The scan output and the final headline task list are committed before the A1 hash is frozen.
3. Conditions (b), (c) and (d) of the 2026-10-15 integrity review apply as written:
   - (b) dev pools only, each run capped within the remaining dev budget; devCheck sealed, with at most 3 looks;
   - (c) the first paid run is tiny and checks the CLI step guard and the L5 audit on real A1 transcripts;
   - (d) `RECURRING-DESIGN.md` and `families/` are never A1 knowledge.

**AM-9 (2026-10-15) Host date injected by the CLI: a fidelity defect in both arms.**

*The defect.*
- Claude Code 2.1.300 always injects "Today's date is <host date>." into the session context, as the `currentDate` block.
- The official eval gives the model no date at all.
- The worlds fix their own date (HR and finance in 100 of 100 tasks, NOTES §2). A session therefore sees a wrong "today" (2026-10-15) that conflicts with the world's date, for example 2026-03-20.
- Evidence: A0 rejected the right roster ("Today is 2026-10-15, so this is not this month's cohort"), and A1's ledgers were anchored on the host date (a1-dev-first6 diagnosis).
- `CLAUDE_CODE_OVERRIDE_DATE` has no effect in `-p` mode. This was tested 2026-10-15 at about $0.01, and the line still shows the host date. The CLI exposes no way to drop the line.

*The decision.* Both arms get one neutral sentence in the shared tool section:

> The date shown in your session context belongs to the machine running you, not to this task; take dates from the request and the task's own records.

- It gives no date and no task information. It is the closest the CLI allows to the official "no date".
- It changes A0's execution setup, so A0 is re-run on dev under it, and the shared-file hashes in §2 are re-recorded when the change lands.
- The change lands only after the running `a0-dev60` and `a1-dev60` runs finish, so each run stays on one setup.
- Those two runs, together with an A0 re-run on the same 60 tasks after the fix, measure the date-leak effect itself.

*Disclosures.*
- The subset60 baseline (21.7%) ran with the leaked host date. It is reported as such and superseded by A0 runs under AM-9.
- The published disclosure list gains this item.

**AM-10 (2026-10-15) Owner direction: use whichever model works best.**
The owner asked to try the harness "with haiku or opus whatever works the best". The model therefore becomes a free choice per arm, chosen on dev only.

*New arms.* Each runs on the same devTrain tasks as its Haiku counterpart, with `--date-note` (AM-9):

| Arm | Model and setup | Session budget |
|---|---|---|
| A0-O | raw `claude-opus-5-5`, effort high | $2 |
| A1-O | Opus with the harness | $2 |
| A0-S / A1-S | `claude-sonnet-5-5`, same pattern; optional | – |

*Selection rule, fixed now.*
- The headline configuration is the arm with the highest devTrain strict pass rate.
- A tie within 2 points goes to the lower cost per verified success.
- It is chosen before any devCheck look.
- The test run then runs the chosen configuration once, plus A0-Haiku (the preregistered comparator) and A0 with the same model as the chosen arm.
- Every arm is reported with its model, and with cost per task and per verified success.

*Budgets.* Owner envelope, decision D1:
- Dev rises from $60 to $150, and the Opus arms run only after a 6-task cost probe.
- Test rises from $40 to $150 when the chosen arm uses Opus.
- Caps per run stay enforced in code by `--cap`.

*Model naming in any published claim.* The model and harness are named exactly, for example "claude-opus-5-5 + Foundry harness a1-vN". No headline says "Haiku" unless the chosen arm is Haiku.

**AM-11 (2026-10-15) Owner direction: Sonnet instead of Opus.**
- The owner wrote "Or wait try sonnet instead of opus".
- The Opus probe (`a0o-dev-first6`) was stopped before any task finished. No Opus result exists, and its partial spend is booked in its live directory.
- The alternative-model arms under AM-10 are now A0-S and A1-S: `claude-sonnet-5-5`, effort high, `--date-note`, session budget $1.50.
- The AM-10 selection rule and budgets apply unchanged, with Sonnet in place of Opus.
