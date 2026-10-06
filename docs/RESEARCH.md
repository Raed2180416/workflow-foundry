# Research log

The distilled history of the Workflow Foundry research: the thesis, what was
tried, what happened, and what is still open. Raw evidence (run directories,
receipts, frozen databases) is not in git; see "Archives" in the
[README](../README.md#archives-and-history). Negative results are kept on purpose.

## Thesis

Most useful agent systems depend on a hand-built, domain-specific harness: what to
inspect, in what order, what counts as enough evidence, which actions are legal,
when to repair or ask a human, and how to tell that the task is really done. The
question is whether an existing agent can instead **build the right workflow for
the task at hand**, then validate it, run it, inspect it, revise it from evidence
and human feedback, and keep successful workflows for reuse.

Two claims have to stay separate:

1. **The substrate** is real: a typed workflow IR, a persistent runtime, evidence
   and authority boundaries, human steering, trial/repair/proposal lifecycles, a
   visual UI, installers, MCP, adapters, domain skills and an adversarial test suite.
2. **The research claim** is open: nobody has shown that a cheap or modest model
   plus these skills can reliably construct specialist-grade harnesses across
   domains without routine human checking.

### How the idea evolved

It started with training a small specialist "harness model". That is no longer
required. The current approach is:

- put workflow-engineering knowledge into portable `SKILL.md` packs (generic
  construction, runtime semantics, steering, evaluation, components, domains, adapters);
- give an ordinary model the task, the real capability contracts, the relevant skills
  and the prior workflow state;
- require typed executable workflow JSON, not prose;
- judge it with deterministic host checks plus independent outcome tests;
- keep failed candidates and revise through version-bound proposals.

A distilled workflow architect may come later as an optimization. It is not a
prerequisite.

### Relation to ARC, AMP and the Neural Core

- **ARC** is the durable operating substrate: authority, trusted capability
  catalogs, task state, provenance, isolation and long-running execution. Foundry
  does not provide those just by being an MCP server. An agent with an unrestricted
  shell can still bypass it.
- **AMP** is the semantic/context interface. It is **not** the workflow compiler.
  Foundry owns its own IR. Integration must be proven against AMP's real
  interfaces, not by naming convention.
- **Neural Core** asks whether active cognition can learn to generate and revise
  its own "ways of thinking". Foundry is the explicit, external procedure layer. A
  future Neural Core could act as its architect, and Foundry traces could serve as
  training material. Do not conflate the two.

## Outcome, falsifier and promotion criteria

**Intended outcome.** An existing modest agent builds a task-specific workflow from
explicit engineering process, domain knowledge and capability contracts. It can
inspect the workflow visually, revise it from natural language, execute it under
bounded authority, and reuse evidence-backed versions. Success means executable
task outcomes, not attractive Markdown or a diagram.

**Falsifier.** The hypothesis is falsified for a tested envelope in two cases: the
skill system does not improve held-constant model behavior, or it reaches reference
success only through hidden human repair, stronger executors, excessive budgets or
weakened verification. A falsifying result changes the mechanism. It does not
erase the negative evidence.

**Promotion criteria.** All of these are required:

- no known critical failure in the declared envelope;
- an evaluator that fails on injected bad cases;
- reproducible environment, source and model records;
- successful restart and stale-edit probes;
- predeclared performance margins against an accessible reference.

A scalar rating or a model's confidence cannot override these gates.

## Timeline

| When | Where | What |
|---|---|---|
| 2026-09-13 to 09-15 | Grok research stack, then ChatGPT/Codex | Core product: runtime, store, MCP, skills, UI, packaging, evals. Pushed 09-15 (`3954dce`). |
| 2026-09-15 to 09-17 | Local only (`~/Projects/grok-research-stack`) | Consequence study: construction modules, outcome repair, outcome history, free/local provider adapters. Not pushed until 10-06. |
| 2026-09-17 09:16 UTC | `continuation-checkpoint-20260917` | **Last real research checkpoint.** No campaign left running. See [research/checkpoint-20260917/](../research/checkpoint-20260917/). |
| 2026-10-06 | Codex recovery, finished in Claude Code | Recovered the unpushed source, reran the tests, published the evidence release, cleaned up the repository. |
| 2026-10-06 | Cloud session (Phase 0) | Node 24, environment probe, model policy file, OpenCode (version, sha256) allowlist, recorded skips, D6 decided (LangGraph/n8n adapters deleted), local CPU models via llama.cpp, Claude models via the session's `claude -p`. Suite: 605 tests, 590 pass, 0 fail, 15 recorded skips. |

## Experiment ledger

All of these are diagnostic development runs on OpenCode free models
(`opencode/big-pickle`, `opencode/ling-3.0-flash-fin-free`). Haiku 4.5 was never tested.

| Experiment (date) | Result | Supported conclusion |
|---|---|---|
| TUI smoke (09-13) | 1st attempt: denied writes from a sandbox path-permission error. 2nd: correct file. | The harness works. This was one environment smoke, not a success rate. |
| Matched incident pair, Big Pickle (09-13) | Baseline timed out with no candidate. Skills arm: 7/8 states. After one declared correction round, both arms 8/8. Wrong-type follow-on: skills arm **0/21** (21 false successes), baseline 7/21. | Procedural skill text alone is not a reliability mechanism. Passing the original cases says little. |
| SRE host-evidence campaign (09-13) | Skills-only candidate: 41/55 on default registry, **55/55** with mandatory host evidence contracts. Host-conditioned candidate: 55/55 with contracts, 34/55 without. | The gain belongs to **host-side evidence enforcement**, not better model reasoning. |
| Installed skills + MCP TUI (09-13) | Both bounded sessions failed the full chain (no run, no locator file, no final answer within 240 s). A deterministic MCP control on the unchanged candidate passed. | The server path works. The model/client path was not qualified. |
| Typed MCP TUI R1–R3 (09-13) | R1 ran correctly (`{count:3,total:21}`) but missed the locator write and `foundry_inspect`. R2 repaired v1 → v2, then delivered the **old proposal with the new run** and was rejected. R3 got HTTP 429 with no model work. Independent replay of R1's candidate passed 7 exposed checks. | No complete request-to-delivery qualification. R2 motivated the trial / repair / exact-delivery lifecycle. |
| mini-SWE-agent reference comparison (09-13) | Reference-01 was invalid because of source drift. Reference-02 bucket task: original DefaultAgent 70/70 and submitted. Foundry workflow repaired code to 70/70 but hit HTTP 429 before submitting. Second task: both arms hit provider unavailability. | Promising partial coding behavior. There is **no** parity or noninferiority result. |
| Visual product demo, Ling (09-13) | Three attempts: invalid JSON at offset 1837, invalid JSON at offset 1884, then valid JSON with an empty nested acceptance rejected by the schema. Nothing executed. | Parser diagnostics and nested-acceptance checks were tightened. No candidate was hand-repaired. |
| Outcome repair checkpoint (09-17) | Run "succeeded" with a wrong artifact. Unsatisfied outcome recorded, same-builder model repair passed 5 dev + 8 withheld cases, v2 applied, re-run satisfied. Independent partitions: repaired 98/98, faulty 80/98 (196 executions). Suite 645 tests, 641 pass, 4 opt-in skips. Opt-in run: 82 checks pass. | A working model-in-the-loop repair mechanism on **one synthetic objective**. The fault and expectation were supplied. This is not general intent satisfaction. |
| Free-provider construction (09-17) | Big Pickle returned one 150 s HTTP 200 stream with reasoning only: no answer, no usage. | An error-precedence bug was fixed and tested offline (23 checks). No successful hosted rerun yet. |

## Failure → fix chains

The working method: preserve the failure, find the causal weakness, fix the general
mechanism, requalify without rewriting history.

- **Malformed model JSON**: parser diagnostics now carry offset, line and context for repair.
- **Empty nested acceptance**: nested map/loop bodies need nonempty, non-vacuous acceptance.
- **Skipped guard admitting a downstream effect**: prerequisites must succeed by default. Alternatives need an explicit `all_resolved`.
- **Dangling SQLite symlink**: fixed `lstat`/ENOENT handling.
- **Cancellation racing terminal work**: cancellation is checked before acceptance and terminal classification.
- **Unsafe generated schemas**: a bounded schema compiler rejects async, remote, format and regex hazards.
- **TUI object/string ambiguity**: `foundry_run` takes a real object. `foundry_run_json` parses serialized JSON exactly once.
- **OpenCode path-permission mismatch**: equivalent authorized path spellings are allowed without wildcards.
- **Old proposal + new run**: added draft trials, evidence-linked repair requests and exact delivery binding.
- **Component environment leakage**: component processes get an explicit environment allowlist.
- **Event-tail corruption**: event-chain and head verification were strengthened.
- **Weak local assertions**: independent task qualification stays outside the generated workflow.
- **Free-provider HTTP 429**: pauses the generator. No hidden retry, alternate account or paid fallback.
- **Provider abort precedence (09-17)**: the first terminal cause is recorded before shared cancellation.
- **Historical inspection ancestor gaps (09-17)**: every ancestor proposal and repair is now checked against its own request.

### Retired self-audit dossiers (one line each)

These 09-13 independent-worker audits were removed from the tree. Their tests remain in `tests/`.

- Control/recovery: 25 control tests. Two cancellation-classification failures (AbortError reported as an ordinary failure) were reproduced, fixed, and then passed 25/25.
- Runtime security: 16 cases. Failures included symlink artifact-parent creation and uninstall edit loss. All fixed. The final run passed 16/16.
- Evidence contract: 55/55 after fixing fallback to older evidence and an event-head replacement that hid truncated history.
- Generator/evaluator/provider: the first audits were 51/82. Defects included symlinked artifact ancestors, malformed provider events, hidden assistant-level drift and split UTF-8. The prime fixed them.
- Dataflow construction: 48 tests. The checker rejects reference-01's impossible `last.done` wrapper. Construction behavior only.
- MCP repair lifecycle: MCP had no draft trial or repair request, which is why R2 could not bind its repaired version. That gap led to `foundry_trial`, `foundry_request_repair` and `foundry_delivery`.
- OpenCode environment: OpenCode 1.18.29 isolated with bubblewrap. Non-git worktree roots caused the path-permission mismatch above.

## What is still unproven

Not established: general cross-domain reliability, held-out generalization,
commercial parity, noninferiority to mature specialist harnesses, clinical, robot or
production SRE/security safety, arbitrary worst-case correctness, "skills alone
improve reasoning", Haiku 4.5 performance, n8n runtime parity, outcome-contract
identification from unseen objectives, and cross-world continuation.

Validated so far:

1. Typed, inspectable procedural workflows are a workable substrate.
2. Host-owned evidence and authority enforcement prevents classes of invalid model actions.
3. Independent outcome tests are essential, because a workflow can certify itself incorrectly.
4. Version/hash binding catches "old proposal + new run" false successes.
5. Failure-preserving repair loops beat silently editing failed model output.
6. Modest models sometimes produce useful or nearly useful procedures. The evidence is sparse and was interrupted by provider limits.

## Longer-term directions

- **Learned workflow architect**: distill from good traces and compare against the skill-only baseline.
- **Workflow-pattern memory**: reusable motifs with provenance, applicability, known failures, required capabilities, outcome evidence and revision history. Covers reuse vs adapt vs reject, and whether repeated task families get cheaper.
- **ARC integration**: Foundry is the procedure, ARC provides authority and durability, AMP supplies context, and the Neural Core is the future learned architect.
- **Counterexample-driven design**: stale evidence, wrong types, partial output, missing tools, contradictions, uncertain effects, crash retries, stale proposals, malicious retrieved text, provider interruption, version drift, weak self-authored acceptance.
- **Learned evaluator assistance**: only behind calibrated uncertainty and evidence requirements. A generator never certifies itself.

## Safety and publication rules

1. Never commit `.env`, tokens, credentials, account exports, model weights or large caches.
2. Never commit `.foundry/` runtime and model traces, or `corpus/` third-party clones wholesale.
3. No `git reset --hard`, `git clean` or force push to "simplify" the repository. Preserve dirty work first.
4. Treat project-local `.mcp.json`, `.codex/config.toml` and similar files as machine-specific until reviewed.
5. Keep raw failed experiments locally even when they are excluded from git.
6. "Everything" means all source and history needed to continue, not every secret or transient host byte.
