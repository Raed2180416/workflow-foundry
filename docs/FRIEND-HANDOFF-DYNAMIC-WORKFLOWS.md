# Dynamic Workflow / Harness Research — Friend Handoff

**Status:** active research implementation, September 2026
**Primary repository:** `/home/raed/Projects/workflow-foundry`
**Primary branch:** `research/workflow-foundry-20260913`
**Current committed source at this handoff:** `3ee3e46517e6b8aa741fbaadad51c9376e9af14e`
**Primary local product name:** Workflow Foundry
**Relationship to the larger program:** a procedural/workflow layer intended to plug into ARC + AMP + the Neural Core, not replace them.

This document is meant to let another engineer/researcher continue the work without needing the original chat history. It explains the thesis, how it evolved, what was actually built, what was researched, what succeeded, what failed, what is still unproven, and the exact continuation path.

The most important fact to keep in mind is that there are **two very different levels of progress**:

1. The **software substrate** is real and fairly mature: there is a typed workflow IR, a persistent runtime, evidence and authority boundaries, human steering, trial/repair/proposal lifecycles, a visual UI, client installers, MCP integration, runtime adapters, domain skills, and a substantial adversarial regression suite.
2. The **ambitious research claim** is not solved: we have not shown that a cheap/modest model plus these external skills can reliably construct specialist-grade, highly complex harnesses across domains without routine human checking.

Do not collapse those two claims. The system is useful research infrastructure even if the maximal thesis eventually needs a different cognitive mechanism.

---

## 1. The original idea

The project started from a simple observation: most serious AI-agent systems become useful only after somebody hand-builds a highly domain-specific harness around the model.

Examples include:

- coding agents with repository search, test loops, patch semantics, context selection and completion rules;
- browser agents with observation/action loops, DOM grounding, retries and failure recovery;
- SRE agents with evidence gathering, safety gates and runbook-style procedures;
- laboratory/science agents with experimental protocols and instrument constraints;
- robotics systems with planners, schedulers, fleet state and physical authority boundaries;
- clinical/healthcare systems with structured records, validation and consequential-action controls.

The expensive part is often not merely the model. It is the **procedure around the model**: what to inspect, in what order, what to remember, what constitutes enough evidence, which actions are legal, which failures should trigger repair, when a human should be asked, and what tests determine whether the task is truly done.

The research question became:

> Instead of hand-building a new static harness for every domain, can we teach an existing agent how to **build the right harness/workflow for the task at hand**, validate it, run it, inspect it, revise it from evidence and human feedback, and then crystallize successful workflows for reuse?

The desired end state is closer to a **Workflow Foundry** than a fixed agent framework. Given a difficult task and a real capability catalog, the agent should be able to compose a task-specific procedural program rather than relying on one universal hard-coded loop.

---

## 2. How the idea evolved

The initial thought included training a small specialist “harness model.” That is no longer a required architectural assumption.

The current approach is:

1. Put the workflow-engineering knowledge into carefully written, portable `SKILL.md` packages.
2. Split that knowledge into:
   - generic workflow-construction principles;
   - runtime semantics;
   - human-steering principles;
   - independent evaluation principles;
   - component/tool-integration rules;
   - domain packs;
   - adapter-specific rules.
3. Give an ordinary existing model the current task, actual capability contracts, relevant skills, and prior workflow state.
4. Require the model to output a typed executable workflow rather than prose.
5. Use deterministic host checks plus independent outcome tests to evaluate the candidate.
6. Preserve failed candidates and diagnostic evidence.
7. Revise through version-bound proposals rather than silently mutating the running program.
8. Save successful workflows and patterns so future tasks can start from accumulated procedural knowledge rather than rebuilding from zero.

A small trained/distilled workflow architect may still make sense later, but it should be an optimization or learned refinement layer, not a prerequisite for proving the architecture.

---

## 3. Relationship to ARC, AMP and the Neural Core

This work is part of the larger ARC program, but the boundaries matter.

### ARC

ARC is the persistent external cognitive/operating substrate: state, authority, tools, evidence, memory, environment interaction, durable processes and broader agent OS concerns.

For Workflow Foundry, ARC should eventually own or provide things such as:

- real action authority;
- trusted capability catalogs;
- durable task state;
- evidence provenance;
- environment leases and isolation;
- long-running execution;
- cross-agent coordination;
- operating-system and external-service enforcement.

Workflow Foundry should not pretend that installing an MCP server magically creates those properties. A model with an unrestricted shell outside Foundry can still bypass Foundry entirely.

### AMP

AMP is an existing semantic/context/cognition interface and compiler seam in the broader program. This project deliberately did **not** redefine AMP as “the workflow compiler.”

The intended future seam is that AMP can provide structured task/context/state material to a workflow architect, and/or compile the relevant external state into the active cognitive context. That integration must be proven against AMP’s real interfaces rather than established by naming convention.

Current AMP work is spread across more than one Git repository/worktree family; see the publication/state section near the end of this document.

### Neural Core

The Neural Core research asks a more fundamental question: can the active cognition itself learn to understand, select, generate and revise “ways of thinking,” rather than relying entirely on large static parameter spaces and hand-authored reasoning loops?

Workflow Foundry is complementary to that thesis:

- today, explicit skills and workflow IR externalize procedural cognition;
- a future Neural Core could become the adaptive architect that creates/revises those procedures;
- ARC can hold large persistent state while the active cognitive mechanism stays compact;
- successful external workflows provide inspectable traces and training/research material for learning procedural adaptation later.

Do not conflate the current Foundry implementation with the Neural Core breakthrough. Foundry is the explicit external procedure layer; the Neural Core aims at learned adaptive cognition itself.

---

## 4. What Workflow Foundry is trying to become

The target experience is:

1. A user points an agent at a project/task.
2. The agent loads Workflow Foundry skills and connects to the Foundry MCP/runtime.
3. The agent inspects:
   - the user’s objective;
   - the deployment envelope;
   - the real capability catalog;
   - risks and authority boundaries;
   - available domain packs;
   - prior reusable workflows/patterns;
   - independent success oracles where available.
4. It constructs a task-specific workflow.
5. The workflow is statically validated.
6. The exact candidate can be trialed in a restricted environment.
7. Independent tests/counterexamples are run.
8. The candidate is proposed as a versioned replacement.
9. A human or host policy applies it when appropriate.
10. The workflow executes with persistent evidence and bounded authority.
11. The agent inspects the real run state rather than assuming completion from its own prose.
12. Failures can create evidence-linked repair requests.
13. The user can ask for a natural-language modification.
14. The agent proposes a structurally revised next version without invalidating historical runs.
15. Proven workflows/patterns can be reused on future tasks.

The desired abstraction is therefore:

```text
task
  -> design context
  -> candidate workflow
  -> deterministic validation
  -> isolated trial
  -> independent outcome checks
  -> version-bound proposal
  -> application / execution
  -> inspect real evidence
  -> failure-linked repair or human revision
  -> crystallize reusable procedure
```

---

## 5. Why this is not just another agent loop

The project is deliberately trying to separate several concepts that common agent frameworks often blur together.

### Task contract

The requested outcome, deployment envelope, budget, legal effects and independently defined acceptance criteria belong to the task/host side. A generated workflow cannot silently weaken the task in order to declare itself successful.

### Workflow

An immutable versioned procedural program. It describes nodes, dependencies, conditions, bounded iteration, capability calls, assertions and human questions.

### Run

One execution of one exact workflow version, pinned to:

- workflow hash;
- capability registry identity;
- native execution-engine identity;
- durable event/checkpoint state.

### Proposal

A candidate replacement workflow tied to:

- the prior workflow hash;
- a change request;
- rationale/impact/evidence.

Stale proposals are rejected. Existing runs remain pinned to the version that created them.

### Independent task qualification

A workflow can satisfy its own local assertions while still being wrong. The system therefore distinguishes:

- schema validity;
- structural/dataflow validity;
- local workflow acceptance;
- task-outcome qualification by an independent host-owned evaluator.

This separation became one of the most important lessons from the experiments.

---

## 6. The workflow IR and execution semantics

The current portable IR supports these node kinds:

- `task`
- `assert`
- `human`
- `wait`
- `map`
- `loop`

Top-level dependencies are a DAG. Iteration is explicit and bounded inside `map` and `loop` instead of being an unbounded hidden cycle.

Important semantics:

- `needs` encodes dependency edges.
- Dependencies use successful prerequisites by default.
- A skipped guard cannot silently authorize its dependent effect.
- Alternative-branch joins must use explicit `all_resolved` semantics.
- JSON references are structured traversal, not arbitrary executable templates.
- Conditions use a bounded operator language rather than injected JS/shell.
- Nested execution state is namespaced.
- Every nested action counts against parent budgets.
- Unsupported semantics in an adapter must be rejected rather than silently approximated.

The runtime lives mainly in:

- `schemas/workflow.schema.json`
- `src/data.mjs`
- `src/validate.mjs`
- `src/capabilities.mjs`
- `src/store.mjs`
- `src/runtime.mjs`
- `src/foundry.mjs`

---

## 7. Capability contracts and authority

Generated workflows do not get to define their own permissions.

The capability registry is host-owned and records things such as:

- input schema;
- output schema;
- implementation identity;
- side-effect class;
- risk;
- approval policy;
- timeout/cancellation behavior;
- cost;
- idempotency/reconciliation support;
- mandatory evidence preconditions.

The current system distinguishes pure/local work from idempotent effects and non-idempotent effects.

Before a real effect, the host can require exact typed observations. Those evidence requirements cannot be disabled by changing model prose, a permissive graph join or a human-answer node.

This matters because one of the strongest empirical findings so far is that **host enforcement improved reliability much more clearly than adding more skill text**.

---

## 8. Persistence, crash behavior and effect safety

Run state lives in SQLite.

The runtime records intention before dispatch and records completion/evidence transactionally. Event history is hash-checked against the checkpoint chain.

Important behavior:

- completed work is not normally rerun after resume;
- a second live owner of the same run is excluded;
- a pure/idempotent operation may be retried under the declared policy;
- an incomplete non-idempotent effect becomes `uncertain` instead of being blindly repeated;
- timeout without confirmed cancellation can also become uncertain;
- pending runs bind the execution-engine identity so source/runtime upgrades do not silently change semantics underneath an old run;
- capability/schema incompatibility fails closed rather than mutating old meaning.

This is not an exactly-once distributed transaction system for arbitrary external services. Reconciliation remains necessary for real-world effects.

---

## 9. Human steering

Human intervention is treated as a first-class part of workflow design rather than an embarrassment to hide.

The human-steering skill teaches the architect to ask only when the answer materially changes:

- the objective;
- risk;
- architecture;
- authority;
- an irreducible preference.

It should inspect factual state first instead of asking the user questions it could answer itself.

Human questions and approvals are distinct:

- a `human` node can request information/preference;
- approval authority is a runtime/host decision bound to the exact action and arguments;
- the model cannot write a human answer into the graph and thereby grant itself permission.

Natural-language revision requests become durable, version-bound requests and proposals. Request consumption, proposal publication and workflow-head movement use compare-and-swap/atomic persistence so crashes cannot produce a half-applied semantic change.

---

## 10. Candidate trials, failure repair and exact delivery

Observed TUI failures led to a more explicit lifecycle.

### Draft trials

`foundry_trial` runs an exact candidate before it is applied as the reusable workflow head.

Trials:

- use separate persistent state;
- bind the exact candidate hash;
- use a restricted capability policy by default;
- do not consume the user request;
- do not become the reusable workflow head;
- do not count as general deployment qualification.

### Failure-linked repair

After an applied program fails terminally, `foundry_request_repair` can create a bounded diagnostic descendant that points at the actual failure evidence while preserving the original goal and version lineage.

This avoids a failure mode seen in the real TUI where the model created a repaired workflow but no longer had a valid request/proposal relationship for the new version.

### Exact delivery

`foundry_delivery` verifies that the request, proposal, applied workflow version/hash, run and inspected evidence all refer to the same program.

This exists because a real model session mixed a proposal for version 1 with a successful run of version 2. The system correctly rejected the joined receipt.

---

## 11. Visual workflow UI

The UI is under:

- `web/index.html`
- `web/app.js`
- `web/style.css`
- HTTP service logic in `src/http.mjs`

It shows the actual saved program and run state, including:

- workflow graph;
- nested map/loop bodies;
- node arguments;
- capability/tool details;
- retries and conditions;
- run events and outputs;
- failures;
- draft trials;
- input-rejected trials;
- natural-language requests;
- proposals/changes;
- workflow version/hash;
- human questions;
- repair lineage;
- recent runs;
- capability and skill catalogs.

The browser does **not** fake AI workflow rewriting. In default mode, a natural-language request is queued for a real connected host agent. There is a separate optional model-backed bridge.

At the latest preserved checkpoint, the local replay demo was responding at:

```text
http://127.0.0.1:34509
```

The demo uses the historical model-generated `NumericRollup` workflow but replays it deterministically with the provider disabled. It is intentionally labeled as a replay, not a retroactive success claim for the original TUI experiment.

Demo workspace:

```text
/home/raed/Projects/workflow-foundry/.foundry/interactive-demo-UddFTA
```

Separate portable demo project:

```text
/home/raed/Projects/workflow-foundry-demo-20260913
```

The demo workflow hash is:

```text
d8641d0a5e7bd0333941d0efcd5f1a7e408e1396c6c6c55ff9680b550a1d4c9e
```

The latest preserved interactive run id is:

```text
591514c6-9130-414c-8e83-defcc0f5e4a8
```

Its local artifact is:

```json
{"count":3,"total":21}
```

The original TUI chain still has `originalTuiPassed: false`.

---

## 12. Installation and client/plugin model

The aim is that another agent/project can install the procedural layer with a single local command.

Current form:

```sh
node bin/foundry.mjs install --project /absolute/path/to/task-project --client <client>
```

Supported clients:

- `opencode`
- `claude`
- `cursor`
- `codex`
- `generic`

The installer can write project-local configurations such as:

- OpenCode: `opencode.json` or `opencode.jsonc`, project MCP, optional advisory plugin;
- Claude Code: `.mcp.json`, `.claude/settings.json`, optional `PostToolUse` advisory hook;
- Cursor: `.cursor/mcp.json`;
- Codex: `.codex/config.toml`;
- Generic: `workflow-foundry.mcp.json`.

Skills are copied project-locally.

Installation journals live under the target project’s `.foundry/install/<id>.json`.

Uninstall restores only when the current file still matches what Foundry installed or the exact previous bytes it recorded. Conflicts fail closed.

The installer deliberately does not:

- modify global settings;
- grant trust or approval;
- elevate permissions;
- sandbox unrelated host tools;
- silently enable research-corpus servers.

---

## 13. External components and MCP tools

`src/components.mjs` can connect an explicitly host-selected trusted component manifest to a real MCP server.

The important boundary is:

- tool schemas are discovered from the actual server;
- side-effect classification, approval, idempotency, cost and risk remain host-owned;
- external tools become names like `mcp.<server-id>.<tool-name>`;
- model-authored component manifests are not automatically trusted;
- research corpus servers are never auto-enabled.

The component environment was hardened after a review found that SDK/process defaults could otherwise leak more host environment than intended. External component processes now use an explicit allowlist.

---

## 14. Runtime adapters

### Native runtime

This is the reference execution semantics and the broadest qualified target.

### LangGraph

A restricted profile exists and was exercised against a pinned local Python/LangGraph runtime. Unsupported semantics are rejected instead of flattened.

### n8n

An export adapter exists with generated-code/local checks, but there is **no qualified real n8n engine/import execution yet**.

Do not claim n8n parity or native-equivalent behavior.

---

## 15. Portable skills built so far

The current package exposes 14 skill areas:

1. `workflow-foundry`
2. `runtime-native`
3. `human-steering`
4. `workflow-evaluation`
5. `component-integration`
6. `domain-software`
7. `domain-browser`
8. `domain-sre`
9. `domain-security`
10. `domain-science`
11. `domain-robotics`
12. `domain-healthcare`
13. `runtime-langgraph`
14. `runtime-n8n`

The generic workflow skill teaches the architect to:

- define the deployment envelope before designing the graph;
- inspect actual available capabilities rather than hallucinating tools;
- mark assumptions and unknowns;
- map requested outcomes to independent checks;
- encode dependencies and joins explicitly;
- treat retrieved/source text as untrusted data;
- bound retries, time, cost and stopping;
- separate human preference from action approval;
- validate with the actual validator;
- run representative and negative cases;
- include known-bad candidates in evaluator development;
- preserve failed versions;
- never promote based on model confidence alone;
- perform workflow changes through version-bound proposals.

---

## 16. Domain/product deconstruction research

The project intentionally studied real harnesses and systems rather than inventing the architecture in a vacuum.

The acquisition corpus contains **49 repository records / 48 distinct public repositories** and **111,480 tracked upstream files**.

The source-bound dossiers currently cite **196 pinned source spans across 135 files covering all 48 acquired repositories**.

There are also **33 public-product document records**, consisting of 29 byte snapshots and four web-only entries.

Important categories studied include:

- software engineering agents;
- browser automation agents;
- agent skills/procedural packages;
- MCP servers/protocol implementations;
- orchestration frameworks;
- SRE/incident systems;
- security tooling;
- scientific/lab agents;
- healthcare agents;
- robotics/fleet-management systems;
- LangChain/LangGraph;
- n8n;
- mini-SWE-agent / SWE-agent;
- OpenCode/Codex/Claude-related public interfaces.

Representative acquired public repositories include:

- `SWE-agent/mini-swe-agent`
- `SWE-agent/SWE-agent`
- `langchain-ai/langgraph`
- `langchain-ai/langchain`
- `n8n-io/n8n`
- `browser-use/browser-use`
- `browserbase/stagehand`
- `Skyvern-AI/skyvern`
- `simular-ai/Agent-S`
- `openai/codex`
- `openai/skills`
- `openai/plugins`
- `anthropics/skills`
- `anthropics/claude-agent-sdk-python`
- `modelcontextprotocol/modelcontextprotocol`
- `modelcontextprotocol/typescript-sdk`
- `DataDog/datadog-agent`
- `HolmesGPT/holmesgpt`
- `rootlyhq/rootly-mcp-server`
- `Future-House/aviary`
- `NVIDIA-BioNeMo/bionemo-agent-toolkit`
- `open-rmf/*`
- `FormantIO/*`
- `MaxNaeg/safe_lab_agents`
- `ajhcs/healthcare-agents`
- `xbow-engineering/validation-benchmarks`

The actual corpus is intentionally ignored/unbundled from the product source tree:

```text
/home/raed/Projects/workflow-foundry/corpus/
```

Do **not** push the corpus wholesale to a new GitHub repo. The projects have different licenses and the fact that they were cloned for local research does not grant blanket redistribution rights.

The key source-coverage ledger is:

```text
docs/SOURCE-COVERAGE.md
```

Important dossiers include:

```text
research/dossiers/software-browser-skills.md
research/dossiers/science-robotics-healthcare.md
research/dossiers/sre-security.md
research/dossiers/protocol-adapter-deconstruction.md
research/dossiers/arc-existing.md
research/dossiers/runtime-security-review.md
research/dossiers/control-runtime-review.md
research/dossiers/evidence-contract-review.md
research/dossiers/generator-evaluator-review.md
research/dossiers/dataflow-construction-review.md
research/dossiers/mcp-repair-lifecycle.md
research/dossiers/reference-swe-comparison.md
research/dossiers/opencode-environment.md
```

### Evidence discipline

The research distinguishes:

- actual implementation source;
- public SDKs;
- public docs;
- standards/specifications;
- benchmarks;
- closed products whose internals are unavailable.

A public SDK or product website is **not** treated as proprietary internal source.

---

## 17. ARC audit findings relevant to Foundry

Workflow Foundry audited the existing `/home/raed/.agentic-os` source read-only during the research phase.

The audit found that ARC is more developed than an older “fixed phase loop” description suggested, but still incomplete.

Key observations recorded in `research/dossiers/arc-existing.md`:

- modern graph control is reachable in the current daemon;
- the terminal candidate-author/application path remains incomplete in the inspected version;
- older phase-adapter paths memoize a coordinator result and retain legacy semantics;
- older natural-language steering appended prompt text instead of performing authoritative graph revision;
- an older plan-ledger path could treat blocked prerequisites as ordering-only and release successors;
- an older steering channel could mark a message consumed before durable application, creating crash/replay hazards;
- the primary TUI was not entirely stale and did read verified runtime projection in important paths.

Foundry did not modify those ARC paths as part of this project.

---

## 18. Actual model experiments

The models matter because the research thesis is about whether modest/cheap agents can use these skills and runtime contracts to construct useful workflows.

Actual free OpenCode model identifiers observed during the research include:

```text
opencode/big-pickle
opencode/ling-3.0-flash-fin-free
```

For the Ling catalog used in the experiments, recorded metadata showed zero input/output/cache price, 262,144 context, 32,768 output, tool calls and reasoning support.

**Haiku 4.5 was not tested.**

### A. Big Pickle baseline vs skills

Some guided candidates looked better on initial normal cases, but later malformed-evidence challenges caused failures. Some skill-guided workflows acted on invalid evidence.

Supported conclusion:

> Procedural skill text alone is not a demonstrated reliability mechanism.

### B. SRE host-evidence campaign

The same generated workflow was replayed under different host enforcement profiles.

Results:

| Constructed with | Executed with | Score |
|---|---|---:|
| skills-only candidate | default registry | 41/55 |
| same skills-only candidate | mandatory host evidence contracts | 55/55 |
| host-conditioned candidate | host evidence contracts | 55/55 |
| same host-conditioned candidate | default registry | 34/55 |

The mandatory host evidence contracts eliminated the invalid-evidence effects in the measured fixture.

Supported conclusion:

> The strong measured gain belongs to host-side evidence enforcement. It should not be described as proof that the model reasoned better.

See:

```text
evals/SRE-RESULTS-20260913.md
```

### C. Actual OpenCode TUI + typed Foundry MCP

Three bounded real TUI sessions were attempted.

#### R1

The model:

- loaded native skills;
- generated a candidate;
- validated it;
- proposed/applied it;
- successfully ran it with object input;
- produced `{count:3,total:21}`.

The overall chain still failed because:

- it did not make the required successful locator write under the frozen evaluator configuration;
- it did not perform the required `foundry_inspect` call.

The locator-write failure exposed an evaluator/client path-spelling mismatch tied to OpenCode’s observed worktree root. That evaluator issue was narrowed for R2.

#### R2

The model’s first candidate had an incorrect acceptance rule (`total == count`) and correctly failed execution.

It then generated a repaired version 2 and ran it successfully.

However, it tried to deliver the old version-1 proposal together with the successful version-2 run. Exact workflow binding rejected the result.

This failure directly motivated the newer trial / repair / exact-delivery lifecycle.

#### R3

The provider returned:

```text
HTTP 429 FreeUsageLimitError
```

No model construction occurred and zero tool calls were made. This is classified as provider unavailable, not a model task failure.

The strict campaign result is still:

> no complete request-to-delivery TUI qualification.

See:

```text
evals/MCP-TYPED-TUI-RESULTS-20260913.md
```

### D. Independent replay of the unchanged R1 candidate

With zero additional model calls, the exact original R1 candidate was replayed through real MCP execution.

Exposed controls passed for:

- `[3,7,11]` -> `{count:3,total:21}`
- `[2,5]` -> `{count:2,total:7}`
- `[]` -> `{count:0,total:0}`
- nonnumeric values rejected
- missing `values` rejected
- non-array `values` rejected
- serialized object rejected on the object transport

This establishes that the candidate itself worked for those exposed cases. It does **not** rewrite the original failed TUI integration result.

### E. mini-SWE-agent reference comparison

The project used the actual upstream `SWE-agent/mini-swe-agent` DefaultAgent at commit:

```text
04d809ceab9df28f9adaed044884180159172930
```

Reference-01 was invalid as an aggregate comparison because the source-stability gate detected concurrent source drift. Its partial observations remain historical evidence only.

Reference-02 added a generic message-handoff construction overlay and froze the execution closure.

For the bucket task:

- original DefaultAgent: 3 executor calls, 3 operations, submitted, 70/70 hidden checks, task success;
- generated Foundry workflow: generated an executable loop, made 3 model calls / 2 operations, repaired code to 70/70 hidden checks, but the third model call hit HTTP 429 before final submission.

For the second task family, both arms hit provider unavailability on their first model invocation.

Supported conclusion:

> The generated procedure showed promising partial coding behavior, but there is no whole-task parity or noninferiority result.

See:

```text
research/dossiers/reference-swe-comparison.md
```

### F. Visual model-generation campaign

Three fresh Ling outputs were used to test visual/service-backed workflow generation.

Results:

1. malformed JSON around offset 1837;
2. malformed JSON around offset 1884;
3. syntactically valid JSON but empty nested map-body acceptance, rejected by schema/semantic validation.

No candidate reached execution. No revision call occurred.

The parser/validator feedback was improved from these failures, but the failed candidates were never hand-edited and relabeled as model successes.

See:

```text
docs/PRODUCT-DEMO-RESULTS.md
```

---

## 19. Important failure -> architecture-fix chains

The project should continue using this style: preserve the observed failure, identify the causal weakness, patch the general mechanism, then requalify without rewriting history.

Known chains include:

### Malformed model JSON

Failure: model output failed parsing but feedback was too vague.
Change: parser diagnostics now preserve location/offset/context for repair.

### Empty nested acceptance

Failure: a nested control body could get too far with an invalid/empty acceptance contract.
Change: nested acceptance checks were tightened.

### Skipped guard admitting downstream effect

Failure: early dependency semantics allowed a skipped predecessor to behave too much like an ordering-only predecessor.
Change: prerequisites require success by default; deliberate alternatives use explicit `all_resolved` semantics.

### Dangling SQLite symlink behavior

Failure: existence logic around dangling links was unsafe.
Change: `lstat`/ENOENT handling was fixed.

### Cancellation racing terminal work

Failure: cancellation could race with final non-cancellable work and still reach success.
Change: cancellation is checked before acceptance/terminal classification.

### AJV/schema poisoning / unsupported schema behavior

Failure: generated schemas could exercise unsupported async/remote/format/regex behavior.
Change: a bounded schema compiler rejects unsupported/unsafe constructs.

### TUI object/string transport ambiguity

Failure: previous interface behavior encouraged accidental nested JSON-string arguments.
Change: `foundry_run` requires a real object; a separately named `foundry_run_json` accepts serialized JSON and parses exactly once.

### OpenCode path permission mismatch

Failure: evaluator path rules did not match the actual isolated project worktree root.
Change: equivalent already-authorized task-prefixed spellings were allowed without opening wildcard access.

### Old proposal + new run delivery

Failure: model repaired a workflow but delivered the earlier proposal id with the newer run.
Change: draft trials, evidence-linked repair requests and exact delivery binding were added.

### Component environment leakage

Failure: process/SDK defaults risked inheriting more host environment than intended.
Change: component processes use an explicit environment allowlist.

### Event-tail corruption

Failure: persisted state could otherwise trust an inconsistent event tail.
Change: event-chain/head verification was strengthened.

### Weak local assertions

Failure: a wrong workflow can preserve the user’s goal text and pass its own assertions.
Change: independent task qualification remains outside the generated workflow.

### Free-provider quota exhaustion

Failure: HTTP 429 interrupts generation.
Change: provider-429 pauses the pending generator; there is no hidden retry, alternate account or paid fallback.

---

## 20. Current verification state

The latest preserved full release qualification receipt is:

```text
.foundry/release-qualification/candidate-sseEUg/report.json
```

It ran on 2026-09-13 and records:

- 454 tests;
- 454 pass;
- 0 fail;
- 0 cancelled;
- 0 skipped;
- 0 todo;
- complete suite exit 0;
- fresh offline install pass;
- protocol/source evidence pass;
- doctor pass;
- zero model calls;
- source stable;
- source changes: `[]`;
- source file count: 230;
- source identity:

```text
c04a9490d8b72d38e0d8d8373b7b93a092da0f06d9266989101b8461e4dd9259
```

Fresh-install evidence:

```text
.foundry/qualification-resume-20260913/fresh-install-ZX3Vwz
```

Archive:

```text
contrare-research-workflow-foundry-0.1.0.tgz
sha256 c3d189b9a42f649b55bc59aaf01756387411e0530249c24c59342f2663423402
86 entries
266459 compressed bytes
836405 unpacked bytes
```

The fresh consumer used the existing npm content cache in offline mode, did not reuse an existing `node_modules` symlink, and executed the generated installed MCP command against a real workflow with exact artifact/event checks.

This is strong evidence for **this host/source/package path**, not a guarantee of clean-machine/network portability or arbitrary deployment safety.

---

## 21. How to run the project

From the checkout:

```sh
cd /home/raed/Projects/workflow-foundry
npm ci --ignore-scripts --no-audit --no-fund
node bin/foundry.mjs doctor
npm test
```

Run the complete local release qualification:

```sh
node research/qualify-release.mjs
```

Serve a deterministic workflow workspace:

```sh
node bin/foundry.mjs serve \
  --workspace /absolute/path/to/task-project \
  --port 4177
```

Install into an OpenCode project:

```sh
node bin/foundry.mjs install \
  --project /absolute/path/to/task-project \
  --client opencode
```

Inspect installation changes first:

```sh
node bin/foundry.mjs install \
  --project /absolute/path/to/task-project \
  --client opencode \
  --dry-run
```

Serve with the optional free OpenCode model bridge only when deliberately running a new model experiment:

```sh
node bin/foundry.mjs serve \
  --workspace /absolute/path/to/task-project \
  --port 4177 \
  --agent opencode-free \
  --model opencode/ling-3.0-flash-fin-free \
  --rounds 3 \
  --generation-timeout 300000
```

Do not assume that model identifier is still available or still free. The adapter must re-check the installed provider catalog and zero-price metadata.

---

## 22. Current unfinished model experiment

A post-fix TUI continuation was prepared but **not started**.

Protocol:

```text
.foundry/status-recheck-lTMpVb/tui-continuation-protocol.json
```

Prepared run directory:

```text
evals/runs/mcp-typed-resume01-20260913
```

Request id:

```text
11248722-37fb-4370-ac48-39a45d6e1884
```

Frozen source commit:

```text
3ee3e46517e6b8aa741fbaadad51c9376e9af14e
```

Model:

```text
opencode/ling-3.0-flash-fin-free
```

Protocol ceiling:

- one new actual TUI session;
- 240 seconds;
- no alternate account;
- no alternate model;
- no paid fallback;
- stop on explicit quota.

The intended new evidence chain is:

1. native skill load;
2. request-bound design context;
3. exact candidate validation;
4. successful exact-candidate trial before apply;
5. request-bound proposal and application;
6. model-owned execution and inspection;
7. model-owned exact delivery receipt;
8. model-owned four-field locator;
9. independent artifact/content/type checks.

At this handoff there is no transcript, no `startedAt`, and no result. Do not claim otherwise.

---

## 23. What is still unproven

The central research claim remains open:

> Can a modest inexpensive model, equipped with external workflow-engineering skills and a strong runtime/evaluator, reliably construct highly complex specialist harnesses across domains without routine human checking?

Current evidence is insufficient for:

- general cross-domain reliability;
- held-out generalization;
- commercial-product parity;
- noninferiority to mature specialist harnesses;
- clinical safety;
- real robot safety;
- production SRE/security autonomy;
- arbitrary worst-case correctness;
- the claim that skills alone substantially improve reasoning;
- Haiku 4.5 performance;
- n8n runtime parity.

The strongest validated findings so far are more specific:

1. Typed, inspectable procedural workflows are a workable substrate.
2. Host-owned evidence/authority enforcement can prevent classes of model-generated unsafe/invalid actions.
3. Independent outcome tests are essential because a workflow can self-certify incorrectly.
4. Version/hash binding catches subtle “old proposal + new run” false-success cases.
5. Failure-preserving repair loops are better than silently editing failed model output.
6. Modest models can sometimes generate useful or nearly useful procedures, but current evidence is sparse and interrupted by model-quality/provider limits.

---

## 24. Immediate next experiments

The next person should not spend another week adding random framework features before collecting the decision-bearing evidence below.

### 1. Finish the amended actual-TUI lifecycle experiment

Use the prepared `mcp-typed-resume01-20260913` protocol only if the same free provider is available under the frozen constraints.

The purpose is specifically to test whether the **new** trial/repair/delivery lifecycle closes the concrete failures observed in R1/R2.

Do not rerun the old campaign under the old name and do not rewrite its failures.

### 2. Prove a real natural-language workflow revision

After one successful initial creation, ask for a substantive structural modification, for example:

> Preserve NumericRollup behavior, but add a `values` field to the output artifact.

Require:

- old version and historical runs remain immutable;
- exact request -> proposal -> new version linkage;
- independent before/after task suites;
- no hand-editing of the model candidate.

### 3. Fresh matched specialist-harness comparisons

Use fresh task families not already used to tune the skills/runtime.

For each arm match:

- architect model;
- executor model;
- tool surface;
- task budget;
- call budget;
- wall time;
- human intervention accounting;
- success oracle.

Predeclare the margin before observing results.

Provider unavailable, invalid output and timeout must be kept distinct from model task failure.

### 4. Qualify real domain capabilities one envelope at a time

The current domain packs mostly teach workflow design principles. For actual deployment, add real tools and outcome oracles incrementally:

- repository/software;
- browser;
- local SRE simulator -> authorized test infrastructure;
- other domains only after appropriate authority/safety controls exist.

Do not jump directly to patient/lab/production-security/robotics actions from source-derived skills.

### 5. Start studying workflow retrieval and crystallization

The architecture currently stores workflows, but the maximal Foundry thesis also requires good reuse.

Research questions:

- when should a prior workflow be reused directly vs adapted vs rejected?
- how should procedural fragments be indexed?
- can successful graph motifs become reusable skills automatically?
- how should negative traces affect retrieval?
- can we measure whether the system is actually getting cheaper/faster over repeated task families?

This is one of the important bridges toward AMP/Neural-Core integration.

---

## 25. Recommended longer-term research directions

These are not yet implemented claims; they are the natural next layers.

### Learned workflow architect

Once enough high-quality traces exist, distill or train a compact architect that predicts graph structures, repair strategies and evidence needs from task/context state.

It should be evaluated against the skill-only baseline rather than assumed superior.

### Workflow-pattern memory

Store reusable procedural motifs with:

- provenance;
- applicability conditions;
- known failure cases;
- required capabilities;
- outcome evidence;
- revision history.

### ARC integration

Connect Foundry execution to real ARC authority/evidence mechanisms rather than leaving it as a local independent runtime.

The likely seam is:

- Foundry: explicit procedural program;
- ARC: durable operating substrate/authority;
- AMP: semantic/context compiler/provider;
- Neural Core: future learned adaptive procedure architect.

### Counterexample-driven design

The best progress in the current research came from concrete failures. Keep building adversarial counterexamples around:

- stale evidence;
- wrong data type;
- partial output;
- missing tools;
- contradictory observations;
- uncertain effects;
- retries across crashes;
- stale proposals;
- incomplete human input;
- malicious retrieved text;
- provider interruption;
- version drift;
- weak self-authored acceptance.

### Learned evaluator/oracle assistance

Some real tasks cannot be fully checked with deterministic unit tests. Explore model-assisted evaluators only behind calibrated uncertainty, disagreement and evidence requirements. Never let the same untrusted generator simply declare itself correct.

---

## 26. Repository and publication state at this handoff

### Workflow Foundry

Local source:

```text
/home/raed/Projects/workflow-foundry
```

Branch:

```text
research/workflow-foundry-20260913
```

Committed head before this handoff document was authored:

```text
3ee3e46517e6b8aa741fbaadad51c9376e9af14e
```

At the time publication work began, this repository had no configured Git remote. A dedicated **private** GitHub repository was then created for the handoff:

```text
https://github.com/Raed2180416/workflow-foundry
```

The branch in this section is the continuation branch being published with this document. The repository remains private so this handoff does not silently make a license/public-release decision.

Package metadata currently says:

```text
@contrare-research/workflow-foundry
0.1.0
private: true
```

This package should remain unpublished until a deliberate license/release decision is made.

The third-party research corpus is excluded from the product and should remain excluded from GitHub publication.

### Agentic OS / ARC

Local source:

```text
/home/raed/.agentic-os
```

Existing private GitHub remote:

```text
Raed2180416/agentic-os
```

Primary local branch observed when this document was created:

```text
codex/semantic-v2-product-splice-20260811
```

Head:

```text
4059ac32606acadf22e7c9e21480a6aaf48c65dc
```

Important: the current primary checkout is **not clean**. It now contains much more local state than the earlier two-file dirty baseline, including a large `.agents/skills` relocation/deletion set, a new `.agents/skills.disabled.20260913/` tree, modified project-local Codex/MCP/Serena configuration, backup config files, the untracked Hippocampus finding and `tmp/` content.

Do not reset, clean or blindly commit that working tree. Some of those files are machine-local configuration or generated/backups rather than project source, and some may have been changed by work outside the original Workflow Foundry session.

The existing repository also contains many worktrees/branches, including locked Holt worktrees that explicitly hold work with no durable copy elsewhere. Never delete worktrees just to make publication simpler.

Publication performed during this handoff preserved the **committed** local history without modifying the dirty checkout:

- all 78 local branches other than `main` were pushed non-force to the existing private remote;
- repository tags were pushed;
- the remote now has 79 branch heads, matching the local branch-count total;
- `codex/semantic-v2-product-splice-20260811`, `codex/amp-arc-port-20260908`, and `codex/amp-client-mcp-20260908` are all present remotely at `4059ac32606acadf22e7c9e21480a6aaf48c65dc`;
- local `main` was **not** pushed because remote `main` is ahead/non-fast-forward. No force push, reset or merge was performed merely to make the counts line up;
- the primary checkout still has 137 `git status --porcelain` entries. Those uncommitted/machine-local bytes are intentionally not represented as committed GitHub history.

This means the remote now preserves the committed branch history needed for continuation while the unresolved primary working tree remains exactly where it was for later review.

### AMP

There is **not one clean standalone `/Projects/amp` Git repository** in the current layout.

AMP-related work is spread across at least two repository families:

1. `agentic-os` branches/worktrees, including:

```text
codex/amp-arc-port-20260908
codex/amp-client-mcp-20260908
```

Both of those currently resolve to the `agentic-os` Git common directory.

2. the private `Raed2180416/hippocampus` repository, which contains the much more substantial AMP/source/cognition branch/worktree family. The known source-discovery worktree is:

```text
/home/raed/.codex/worktrees/amp-source-discovery-20260908
```

It is a worktree of:

```text
/home/raed/Projects/hippocampus
```

Branch:

```text
codex/amp-source-discovery-20260908
```

Head observed during this handoff inventory:

```text
0855645f071aa39e6fab22bc02f9cb673757e741
```

That branch contains a large history beyond `main`, including context/cognition/capture/learning/desktop/source-discovery work. The inventory found **53 local branches** in the Hippocampus repository, including roughly fifty AMP-related branches/worktrees rather than only the three older paths originally known from chat context.

During this handoff, all 53 committed local branches were pushed non-force to the existing private `Raed2180416/hippocampus` remote, along with the local tag `codex/amp-operating-context-pre-compiler-20260908`. The remote now reports 53 branch heads, matching the local branch count. The source-discovery branch is present remotely at the exact hash above.

Three AMP worktrees have additional **uncommitted** work which was deliberately left untouched rather than silently folded into a publication commit:

```text
/home/raed/.codex/worktrees/amp-context-activity-20260908
  checked-out branch: codex/amp-internal-operating-packet-20260908
  7 status entries

/home/raed/Projects/amp-cos-integration-20260913
  branch: cos/amp-integration-20260913
  1 status entry

/home/raed/Projects/amp-grok-cognition-20260915
  branch: research/amp-grok-cognition-20260915
  64 status entries
```

The last worktree in particular contains substantial active September 15 cognition/integration work. Its committed branch head is remotely preserved, but its uncommitted working-tree delta remains local and must be reviewed by the owner of that work before any preservation commit is made.

Therefore, if somebody says “push AMP,” the safe interpretation remains:

- publish the relevant AMP branches in their actual owning repositories;
- preserve any unique uncommitted worktree state first;
- do not create a fake monorepo by copying worktree directories together;
- document which branches are canonical for which AMP slices.

---

## 27. Publication safety rules

Before pushing or creating public/private GitHub repositories:

1. Never push `.env`, tokens, credential files or account exports.
2. Never push model weights or large local caches.
3. Never push `.foundry/` private runtime/model traces by default.
4. Never push `corpus/` third-party clones wholesale.
5. Do not push ignored host state merely because the user said “entirety.”
6. Do not run `git reset --hard`, `git clean` or force push to simplify the repository.
7. Preserve dirty work before attempting branch cleanup.
8. Respect locked worktrees and rescue warnings.
9. Treat project-local `.mcp.json`, `.codex/config.toml` and similar files as potential machine-specific configuration until reviewed.
10. Keep raw failed experiments locally even when they are excluded from the publishable repo.

“Entirety” should mean **all meaningful source/history required to continue the work**, not every secret/cache/transient host byte.

---

## 28. Files to read first

If you are taking over the dynamic-workflow research, read these in order:

### Product/architecture

```text
README.md
docs/ARCHITECTURE.md
docs/RESEARCH-STATUS.md
docs/RELEASE-CANDIDATE-20260913.md
docs/IMPLEMENTATION-PLAN.md
docs/REPAIR-LIFECYCLE.md
docs/UI-TRIALS.md
docs/PACKAGING.md
```

### Research coverage

```text
docs/SOURCE-COVERAGE.md
research/dossiers/software-browser-skills.md
research/dossiers/science-robotics-healthcare.md
research/dossiers/sre-security.md
research/dossiers/protocol-adapter-deconstruction.md
research/dossiers/arc-existing.md
research/dossiers/runtime-security-review.md
research/dossiers/control-runtime-review.md
research/dossiers/evidence-contract-review.md
research/dossiers/generator-evaluator-review.md
research/dossiers/dataflow-construction-review.md
research/dossiers/mcp-repair-lifecycle.md
research/dossiers/reference-swe-comparison.md
research/dossiers/opencode-environment.md
```

### Model/evaluation evidence

```text
evals/PROTOCOL.md
evals/RESULTS.md
evals/SRE-CAMPAIGN.md
evals/SRE-RESULTS-20260913.md
evals/MCP-TUI-PROTOCOL.md
evals/MCP-TUI-RESULTS-20260913.md
evals/MCP-TYPED-TUI-PROTOCOL.md
evals/MCP-TYPED-TUI-RESULTS-20260913.md
docs/PRODUCT-DEMO-PROTOCOL.md
docs/PRODUCT-DEMO-RESULTS.md
```

### Core implementation

```text
schemas/workflow.schema.json
src/data.mjs
src/validate.mjs
src/capabilities.mjs
src/store.mjs
src/runtime.mjs
src/foundry.mjs
src/mcp.mjs
src/http.mjs
src/components.mjs
src/hooks.mjs
src/install.mjs
src/opencode-free.mjs
bin/foundry.mjs
```

---

## 29. Things you must not accidentally claim

Do not claim any of the following unless new evidence is created later:

- “The dynamic workflow thesis is solved.”
- “Cheap models now autonomously create expert harnesses.”
- “Haiku 4.5 was tested.”
- “The proprietary systems were cloned/deconstructed from internal source.”
- “n8n runtime parity is proven.”
- “ARC is complete.”
- “Workflow Foundry is AMP.”
- “The original failed TUI runs succeeded after all.”
- “The mini-SWE comparison showed parity.”
- “The SRE 55/55 proves the model reasoned better.”
- “A passing workflow acceptance means the task is independently correct.”
- “The current demo is a fresh successful model generation.”
- “The prepared post-fix TUI run already happened.”

---

## 30. The thesis I would continue testing

The strongest version of the idea still looks worth testing, but it should be stated precisely:

> An agent should not need one permanent handcrafted reasoning loop for every task. Given explicit workflow-engineering knowledge, real typed capabilities, host-owned evidence/authority rules, independent outcome checks, and memory of previous procedures, it may be possible for a comparatively modest architect model to synthesize and revise task-specific executable cognitive workflows that approach specialist-harness quality.

The key design lesson so far is that the “intelligence” of such a system is not only in the model. It is distributed across:

- procedural knowledge;
- capability contracts;
- evidence semantics;
- state persistence;
- authority boundaries;
- independent evaluation;
- repair/versioning;
- workflow reuse;
- and eventually learned adaptive cognition.

The next phase should therefore be less about adding generic framework surface and more about answering three hard questions with frozen experiments:

1. **Can a modest model reliably construct the right procedure?**
2. **Can it detect and structurally repair its procedure when evidence shows the procedure is wrong?**
3. **Does accumulated workflow memory measurably reduce the cost and difficulty of future tasks without making the system brittle?**

If the answer to those becomes strong, Workflow Foundry becomes a credible explicit procedural layer for ARC/AMP and a useful stepping stone toward the Neural Core. If the answer remains weak, the negative evidence should tell us what learned mechanism the Neural Core must supply that explicit skills and static graph synthesis cannot.
