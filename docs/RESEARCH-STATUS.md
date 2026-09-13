# Research and implementation checkpoint — 2026-09-13

This is a local research implementation, with passing executable integration
controls and preserved unsuccessful model experiments. The proposed general
capability—an inexpensive model reliably constructing difficult specialist
workflows without routine human checking—has **not** been established.

## Ready to inspect locally

Source: `/home/raed/Projects/workflow-foundry`.

Prepared demo: `/home/raed/Projects/workflow-foundry-demo-20260913`.
The demo contains an unchanged workflow produced in an actual OpenCode TUI
session, its model-origin receipt, a real run, and ten independent exposed local
replay checks. Those ten checks pass. The original full TUI request-to-locator
chain remains failed; this replay does not revise its result. No additional model
request was used to prepare the demo.

```sh
cd /home/raed/Projects/workflow-foundry
node bin/foundry.mjs serve \
  --workspace /home/raed/Projects/workflow-foundry-demo-20260913 \
  --port 4177
```

Open the loopback address printed by the server. The demo's project-local
OpenCode skills, MCP configuration and advisory hook were installed with receipt
`b41f4ccc-e104-4384-b812-8a1266b3cfe9`. Global agent configuration was not changed.
No model bridge is enabled by the command above. New natural-language requests
remain queued until handled by a connected host agent.

The demo program is `NumericRollup`, hash
`d8641d0a5e7bd0333941d0efcd5f1a7e408e1396c6c6c55ff9680b550a1d4c9e`.
The sample run is `1cbd35a1-3407-43b0-aca1-b527c9dc16fd`; its actual
`totals.json` is `{ "count": 3, "total": 21 }`. `model-origin.json`,
`demo-suite.json`, `demo-evaluation.json`, and `demo-run.json` give the exact
scope. `setup-attempt-01.json` separately preserves a host-script API mistake;
the model program was not repaired by hand.

## Implemented mechanisms

The repository contains fourteen original generic, domain and runtime skills;
typed workflow and capability contracts; schema and conservative structural
dataflow checks; a bounded native executor; persistent runs and hash-checked
events; exact effect preconditions; human questions and distinct approvals;
version-bound requests/proposals; isolated candidate trials; diagnostic failure
lineage; exact delivery receipts; and a bounded model-generation/evaluation loop.

The visual inspector shows the actual program/run version, nested controls,
arguments, outputs, failure evidence, draft trials and change proposals. It can
enqueue natural-language requests and display generation progress through a
configured provider. It does not simulate a model rewrite in browser JavaScript.

Project-local installers support OpenCode, Claude Code, Codex, Cursor and a generic
MCP template. Real stdio/configuration controls are separate from actual client
trust, discovery and hook behavior. Installing Foundry does not sandbox other
tools already available to the surrounding agent.

The native runtime is the broadest execution target. LangGraph exports have a
qualified narrow serial profile with real local execution controls. n8n exports
have a narrower contract and generated-code checks; an actual deployed n8n engine
run remains unqualified. Unsupported semantics are rejected rather than flattened.

## Research coverage

The acquisition corpus contains 48 unique public repositories and 111,480 tracked
files. Across the original dossiers and the protocol addendum, 196 pinned source
spans cover 135 paths in those repositories. This is representative source-bound
deconstruction, not a claim that every acquired file was inspected. There are
33 public-document records: 29 byte snapshots and four web-only entries. Exact
revision, license, acquisition and inspection boundaries are in
`docs/SOURCE-COVERAGE.md` and `research/manifests/`.

Closed-product source was not obtainable merely by downloading its SDK or reading
its website. Proprietary implementations remain unavailable; their public
interfaces and claims are labeled accordingly. No product credentials were
acquired, purchased services used, or real production/laboratory/clinical/security
work executed as part of corpus inspection.

The original `/home/raed/.agentic-os` checkout was audited read-only. Its current
graph entry points are more developed than the old facade-only description, but
several terminal/application paths remain incomplete. Concrete old steering and
dependency counterexamples are preserved in `research/dossiers/arc-existing.md`.
The existing dirty files and pre-existing Holt/canon failures were not repaired
incidentally. The related UI worktree could not be inspected through the available
path access and is explicitly outside the completed audit.

## What the actual models did

| Experiment | Observation | Supported conclusion |
|---|---|---|
| Big Pickle, baseline versus skills | Initial normal-case improvements did not survive the later malformed-evidence challenge; some guided candidates acted on invalid evidence. | More procedural text alone is not a demonstrated reliability mechanism. |
| Ling SRE simulation, same candidate across host conditions | A skills-only candidate moved from 41/55 to 55/55 under mandatory host evidence checks. A separate host-conditioned candidate also passed 55/55 with enforcement. | The measured boundary improvement belongs to host enforcement, not to better model reasoning or commercial SRE parity. |
| Typed-input actual MCP TUI | R1 generated and executed a valid object-input workflow but failed final inspection/locator delivery. R2 repaired and ran a workflow but mixed old-proposal/new-run versions. R3 received HTTP 429 before generation. | The explicit input contract worked in real model-owned calls; the complete lifecycle was not qualified. |
| Exact R1 candidate replay | Seven actual MCP controls passed on the unchanged candidate; the prepared demo later passed ten exposed local cases. | That exact program works for those cases. The original full TUI failure remains a failure. |
| Actual mini-SWE DefaultAgent comparison | The original agent completed a bucket repair with 70/70 hidden checks. The generated workflow produced code passing the same 70 checks, but a provider limit prevented final submission. | Promising partial task behavior, not whole-task parity. The other task's calls were provider-unavailable and are not model scores. |
| Fresh model-backed visual creation | Three actual provider outputs: two malformed JSON documents and one empty nested acceptance array. No candidate reached execution; no revision call occurred. | The visual generation path is connected, but successful autonomous creation/revision was not demonstrated in this bounded campaign. |

Actual sessions used catalog-observed OpenCode free-provider models, including
`opencode/big-pickle` and `opencode/ling-3.0-flash-fin-free`. **Haiku 4.5 was not
tested.** Exact prompts, model identity, cost metadata, tool events, source closures
and failed candidates remain in the ignored run directories. All cases exposed
during improvement are development/diagnostic evidence, not held-out results.

Free-provider HTTP 429 was recorded explicitly. New model requests were stopped.
The current generator also pauses its pending-request processor after such an
error, retaining later requests without automatic retry or paid/account fallback.
No reset time has been assumed and no future model run is scheduled.

## Fixes derived from observed failures

The new implementation distinguishes object arguments from deliberately serialized
JSON; provides exact parser locations without repairing model bytes; checks nested
acceptance and declared data paths; preserves causal transcript contracts in
neutral construction tests; and offers trial-before-apply and bound diagnostic
repair requests instead of requiring the model to fabricate a joined receipt.

Runtime fixes include atomic workflow-head/proposal/request publication, an
explicit native-engine identity for resumed runs, exact source/effect evidence
binding, skipped-guard protection, ambiguous-effect handling, component environment
allowlisting despite SDK defaults, and event-tail corruption detection. Structural
or trace-conformance passes are labeled separately from task-outcome qualification.

These amendments have offline regression evidence. Where the live provider was
already limited, their effect on model performance remains unmeasured. Neither a
passing local assertion nor unchanged goal text is a proof of semantic fidelity:
the lifecycle audit preserves a wrong-constant workflow that keeps the declared
goal and passes local acceptance while failing the independent artifact check.

## Verification and reproducibility

The earlier complete integration run at 14:10 UTC passed **436/436** tests with
all then-existing opt-in lanes enabled and no skips. It is preserved at
`.foundry/qualification-resume-20260913/complete-suite.txt`; later amendments must
use their own fresh verification receipt, not inherit that count.

The draft/repair audit's final scoped replay passed 20 actual-stdio controls
(Node reports 21 including the parent), with stable source/dependency/history
hashes, no model calls and networking disabled. Its receipt is
`.foundry/verification/mcp-repair-lifecycle-audit-SXc1VJ/results.json`.
The structural dataflow review passed 48 scoped tests and preserves its earlier
false-positive/false-negative counterexamples. Relevant dossiers state exactly
which checks were independent and which full-suite runs saw source changes.

Reproduce the current offline integration lanes explicitly:

```sh
FOUNDRY_UI_E2E=1 \
FOUNDRY_UI_TRIALS_E2E=1 \
FOUNDRY_PACKAGING_E2E=1 \
FOUNDRY_MCP_REPAIR_AUDIT=1 \
npm test
```

Browser controls use local scripted fixtures, not live model performance. Package
controls launch the real generated MCP commands for five client formats but do
not by themselves establish app-level trust/hooks or a fresh dependency install.
Raw archives, screenshots and run traces remain local and outside the distributable
package and source commit. No public package or GitHub remote exists yet.

An additional fresh-install control subsequently closed the development-
`node_modules` reuse gap. `research/qualify-fresh-install.mjs` created a new npm
consumer, installed the local archive and its exact direct production dependency
pins from the existing content cache in offline mode, installed a new project MCP
configuration, and used that actual installed command to execute a workflow with
the exact expected artifact. No dependency-directory symlinks, lifecycle scripts,
account configuration, model calls or online retry were used. This is a fresh
installation on this host with a populated cache, not a clean-machine/network
portability claim or a guarantee that future transitive resolution stays identical.

The successful current-source receipt is
`.foundry/qualification-resume-20260913/fresh-install-nuslVz/report.json`.
Its archive has 85 entries, 264,120 compressed bytes, 829,484 unpacked bytes and
SHA-256 `58eae111c75d59548ca95c395e5427c106effaaa4c2a26496182bfa640b2075d`.
The four controls and before/after package-source equality passed; the actual
installed MCP catalog exposed 20 tools. The previous `fresh-install-lNsGG7`
attempt preserves a host audit-script assumption about npm's JSON output shape
that failed before installation. The corrected script accepts both observed npm
output forms; it did not change product bytes to make the install succeed.

## Next decision-bearing experiments

After provider availability returns, freeze a new executable/skill closure and
test the amended actual TUI lifecycle: draft trials, exact proposal application,
failure-linked repair and delivery receipt. Keep the old results unchanged and
measure model-owned steps rather than replacing them with scripted control calls.

Next rerun visual creation followed by a substantive natural-language revision,
with independent before/after task suites and no hand-edited candidates. The
syntax-feedback and nested-body amendments need actual model evidence, not just
unit tests showing their strings are present.

Complete matched original-harness comparisons on fresh task families after a
small pilot sizes the required provider budget. Keep architect, executor, tools,
runtime costs and human interventions separate. Fresh held-out cases are necessary
before a generalization or noninferiority claim; neither exposed simulations nor
two tiny coding tasks establish the desired cross-domain result.

Finally qualify real domain capabilities and external outcome oracles one envelope
at a time. Physical, clinical, production-security and live infrastructure work
require external authority/safety controls and actual access. An inspectable skill
directory and a green generic runtime cannot manufacture those prerequisites.
