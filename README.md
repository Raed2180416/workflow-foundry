# Workflow Foundry

An experimental, local-first system for teaching an existing agent to **design,
test, inspect, revise and reuse executable workflows**. The workflow-construction
process lives in portable skills and domain references. The host runtime owns
capabilities, evidence checks, state, budgets and approval boundaries.

This repository contains working software and preserved research experiments.
It is **not a claim that an agent can safely automate every domain**, or that a
generated workflow matches a commercial specialist product. A passing JSON schema,
a successful model response and a verified task outcome are different results.

## Start from this checkout

Requirements: Node 24 or newer. The optional free-model bridge additionally needs
Linux, bubblewrap and an already installed OpenCode binary under `/usr`. It does
not download model weights, inherit account credentials or select paid fallback
models. Other agents use the MCP interface or a host-provided generator adapter.

Install the pinned source-checkout dependencies without package lifecycle scripts:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node bin/foundry.mjs doctor
npm test
```

Install the skills and MCP configuration into an **existing task project** with
one command. Replace the project path; the command below uses this checkout as
the installed runtime:

```sh
node bin/foundry.mjs install --project /absolute/path/to/task-project --client opencode
```

The other client names are `claude`, `codex`, `cursor` and `generic`. Add
`--dry-run` to inspect the exact changes, or `--no-hooks` to omit advisory hooks.
The installer preserves compatible configuration, refuses conflicting files,
records restoration data and does not grant client trust or tool approvals.
The generic option writes an importable MCP template; it cannot configure an
unknown client automatically. Keep the runtime at its installed absolute path.
See [packaging and installation](docs/PACKAGING.md) for exact paths and limitations.

There is no published package or GitHub installation URL yet. The package remains
private until a deliberate release and license decision. The downloaded research
corpus is not bundled into the installable product.

## Use an existing agent

After the client has loaded the project skills and approved its MCP configuration,
ask it to use `workflow-foundry` for the desired task. Its normal sequence is:

```text
task or queued change request
  -> current capabilities and relevant skills
  -> candidate workflow
  -> schema / dependency / capability validation
  -> execution and independent task tests
  -> version-bound proposal
  -> inspect / apply / reuse
```

The MCP server exposes capability and skill discovery, design context, validation,
candidate storage, queued requests, proposals, execution/resume and run inspection.
It has no tool for manufacturing human answers or approving its own risky actions.

Use `foundry_trial` to test an exact draft before consuming its request with an
applied proposal. Trials have separate persistent state and a restricted local
capability policy; they do not silently execute against production tools. After
an applied program fails, `foundry_request_repair` can open a bounded, evidence-
linked diagnostic request for the next version without reopening the old request
or changing the user's goal. The new lifecycle paths are separately tested offline;
earlier failed TUI sessions remain failed evidence.

The [trial and repair lifecycle](docs/REPAIR-LIFECYCLE.md) documents the exact
request, capability, budget and evidence boundaries. `foundry_delivery` rejects
old-proposal/new-run mixtures. Diagnostic repair does not authorize a changed goal
or turn a locally passing assertion into independent task qualification.

These boundaries apply to operations routed through Foundry. Installing this MCP
does **not** sandbox the surrounding agent or remove its existing shell, filesystem
or other MCP tools. An agent retaining a direct privileged tool can act outside
Foundry. Consequential deployments need enforcement at the actual tool/OS boundary;
the advisory client hooks are not that enforcement layer.

For object inputs, `foundry_run` expects an actual object:

```json
{"workflowId":"NumericRollup","input":{"values":[3,7,11]}}
```

The distinct `foundry_run_json` interface accepts a deliberately serialized JSON
document in `inputJson`. It supports scalar, array and null inputs or clients that
cannot transmit nested objects. It parses exactly once and still enforces the
saved workflow's input schema. A JSON-looking string is never silently treated
as an object by `foundry_run`.

## Inspect a workflow visually

This deterministic example verifies the installed execution and visualization
path; it is a hand-authored example, not a model-generation result:

```sh
mkdir -p /absolute/path/to/foundry-demo
node bin/foundry.mjs run examples/hello.json \
  --input '{"name":"Raed"}' --workspace /absolute/path/to/foundry-demo
node bin/foundry.mjs serve --workspace /absolute/path/to/foundry-demo --port 4177
```

Open the loopback address printed by the server. The canvas is a projection of
the saved program and real run state. Inspect node arguments, conditions,
dependencies, nested map/loop frames, outputs and failure evidence. A run stays
bound to the exact workflow hash that created it even after a newer version is
applied.

Natural-language changes create durable requests. With the default server, an
existing MCP-connected agent consumes those requests and submits proposals. The
UI does not pretend to rewrite workflows without an agent. The optional model
bridge below enables a serial request processor inside the local service.

The sidebar also exposes [draft trials and diagnostic repairs](docs/UI-TRIALS.md).
Their graphs stay bound to the exact candidate hash, including rejected-input
drafts; they are never substituted with the current saved workflow. Trial views
do not offer production execution or human-approval controls.

## Enable model-backed creation and revision

Select an exact model identifier observed in the installed OpenCode free-provider
catalog. The following identifier was successfully observed in this project's
September 13, 2026 experiments; the adapter checks current zero-price metadata
and exported session identity on every call instead of assuming availability:

```sh
node bin/foundry.mjs serve \
  --workspace /absolute/path/to/foundry-demo --port 4177 \
  --agent opencode-free --model opencode/ling-3.0-flash-fin-free \
  --rounds 3 --generation-timeout 300000
```

Type the task or revision into the visual editor. The model receives the current
task, capability schemas, relevant skills and exact prior workflow version. The
host validates the response, preserves rejected attempts and creates a proposal.
By default, applying the proposed version is an explicit UI action. `--auto-apply`
can apply candidates after the configured checks, but without an independent
evaluator they remain **task-unqualified**.

A host-owned suite supplies actual outcome tests and counterexamples for bounded
development. The included numeric-batch example has seven explicit cases:

```sh
node bin/foundry.mjs generate \
  --task "$(cat examples/batch-task.md)" --domain software \
  --agent opencode-free --model opencode/ling-3.0-flash-fin-free \
  --rounds 3 --generation-timeout 300000 \
  --suite examples/batch-suite.json --auto-apply \
  --workspace /absolute/path/to/foundry-demo
```

Raw prompts, responses, validation, execution cases and model provenance remain
under that workspace's `.foundry/`. A provider outage, exhausted generation budget
or failed task oracle remains a failure; the system does not silently substitute
a hand-written solution. A held-out suite cannot drive the iterative repair loop.

The service can also use `--suite FILE`, but that evaluator is configured for the
service lifetime. When a user changes the intended output contract, define the
changed independent suite explicitly and restart with it. Arbitrary natural-language
intent is not automatically converted into a trustworthy evaluation oracle.

The optional bridge uses **noninteractive OpenCode JSON events**. It is distinct
from the separately recorded **actual TUI** experiments; one cannot substitute
for the other when reporting results.

## Workflow and execution semantics

An explicit provider HTTP 429 pauses the configured generator and leaves later
requests pending without dispatch. No automatic retries, alternate accounts or
paid fallbacks run. The UI displays the pause. Restart deliberately only after
provider availability returns; the system does not invent a quota-reset time.

The portable JSON IR has explicit task, assertion, human-question, wait, bounded
map and bounded loop nodes. Ordinary dependencies form a DAG. References address
JSON values rather than executing expressions. Native body results retain their
node names; a nested output is not implicitly the final node's value.

Dependencies require successful prerequisites by default. A skipped guard cannot
silently admit a dependent effect. Alternative branches use an explicit
`all_resolved` join and must handle absent/error outputs deliberately. See the
installed `runtime-native` skill and [architecture](docs/ARCHITECTURE.md).

The runtime records dispatch intentions and completion receipts in SQLite, verifies
the event chain against the checkpoint head, bounds steps/cost/time/concurrency,
and excludes a second live owner of the same run. Completed work is retained on
resume. An ambiguous non-idempotent effect becomes **uncertain**, rather than being
blindly repeated. Arbitrary remote services do not gain exactly-once semantics
merely by being connected through MCP.

Host capability contracts can require exact, typed, fresh observations before an
effect. Those checks cannot be disabled by generated node prose, a permissive
join or a human-answer node. They enforce a declared deployment policy; they do
not choose the correct domain action or prove the requested outcome.

## Connect domain tools and other runtimes

Pending native runs bind their execution-engine identity. A source/runtime upgrade
cannot silently resume them under different semantics. Retain the original frozen
engine for recovery or perform a separately reviewed new execution. This is a
compatibility check, not a sandbox or attestation of remote model behavior.

Built-in capabilities cover bounded JSON/text operations, scoped artifacts and
an explicitly labeled incident simulator. Real browser, repository, production,
clinical or laboratory work needs actual domain capabilities and external controls.

An explicitly selected trusted component manifest can expose chosen tools from
a real MCP server:

```sh
node bin/foundry.mjs capabilities --components /absolute/path/to/trusted-components.json
node bin/foundry.mjs mcp --workspace /absolute/path/to/task-project \
  --components /absolute/path/to/trusted-components.json
```

The manifest launches local processes and is therefore trusted host configuration,
not model output. Tool schemas come from the actual server; effect classification,
approval, cost, idempotency and output interpretation remain host decisions. Read
the installed `component-integration` skill and `componentsSchema` in the package's
`src/components.mjs` before binding a new tool. No corpus server is auto-enabled.

LangGraph and n8n exports deliberately support narrower profiles than the native
runtime. Unsupported joins, effects, nested control, retries or human semantics
must be rejected rather than silently flattened. The current profiles and
qualification evidence are in [LangGraph](adapters/langgraph/README.md) and
[n8n](adapters/n8n/README.md). A generated n8n import file is not proof of execution
inside a deployed n8n service.

## Research and qualification

The source corpus spans scientific/lab workflows, robotics, healthcare, SRE,
security, software agents, browser agents, skills, MCP and orchestration frameworks.
[SOURCE-COVERAGE.md](docs/SOURCE-COVERAGE.md) records acquisition classifications,
licenses, exact inspection depth and unavailable proprietary internals. Downloading
a repository does not mean every file has been audited. A public SDK or product
website is not the closed product's implementation.

Repository-only research evidence is under `research/dossiers/` and `evals/`:

| Evidence entry | What it establishes |
|---|---|
| `research/dossiers/arc-existing.md` | Source-bound audit and concrete failure probes of the older ARC control/steering paths; the original checkout is unchanged |
| `evals/RESULTS.md` | Actual Big Pickle TUI construction/repair, including later wrong-type counterexamples that defeated initially passing workflows |
| `evals/SRE-RESULTS-20260913.md` | Matched local evidence-gate ablations; gains from mandatory host checks are attributed to enforcement, not better model reasoning |
| `evals/MCP-TUI-RESULTS-20260913.md` | Preserved installed-skill/MCP TUI failures and separate successful deterministic wire-type controls |
| `research/dossiers/reference-swe-comparison.md` | Bounded actual mini-SWE-agent comparison with model, history and infrastructure limitations stated |
| `docs/PRODUCT-DEMO-PROTOCOL.md` | Bounded visual/model creation and revision protocol, with earlier failures retained |

These are exposed development diagnostics. They do not establish Haiku 4.5
performance, commercial parity, unseen-domain transfer, clinical safety, physical
robot safety or reliability under every possible failure. The public interfaces
do not replace domain-specific review of capabilities, effect policy and outcome
oracles before consequential deployment.

## Test and package

```sh
npm test
FOUNDRY_PACKAGING_E2E=1 node --test tests/packaging.test.mjs
FOUNDRY_UI_E2E=1 node --test tests/ui-browser.test.mjs
FOUNDRY_UI_TRIALS_E2E=1 node --test tests/ui-trials-browser.test.mjs
FOUNDRY_MCP_REPAIR_AUDIT=1 node --test tests/mcp-repair-lifecycle-audit.test.mjs
npm run check
npm pack --ignore-scripts --dry-run
```

Read the opt-in browser test's environment requirements before launching it. The
default test run reports skipped integration lanes explicitly. Test counts and
packaged bytes change during development; use the timestamped receipts for an
exact release candidate rather than copying a stale green count from this README.

`node research/qualify-fresh-install.mjs` separately checks a fresh local npm
consumer using the existing content cache in offline mode, then runs the installed
package through its generated MCP command. It does not reuse a `node_modules`
symlink or test registry availability.

The implementation plan is in [IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md).
The system's useful promise is inspectable, testable procedural composition with
visible failure boundaries—not that a confidence score eliminates uncertainty.
