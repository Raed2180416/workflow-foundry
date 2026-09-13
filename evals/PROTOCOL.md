# Workflow Foundry evaluation protocol — version 1

Owner: worker-5. Preregistered 2026-09-13 before comparative model generation.
Status: diagnostic design; no heldout results or product-parity claim exists.

## Question and independent units

Does access to the Foundry construction skills improve an observed free OpenCode
model's ability to construct executable workflows, given the same task, IR
contract, tools, executor and limits? Construction and subsequent execution are
separate experiments. A workflow that validates as JSON has not thereby solved a
task. A hand-written template is a reference fixture, never a model generation.

The experimental unit is a paired task instance, not a validator assertion, node,
retry or model message. Arms A and B use independent new TUI sessions. A receives
the task and necessary IR documentation; B receives the same material plus the
frozen Foundry skill/domain pack. Do not give B a completed workflow example for
the test task. If A receives a complete reference workflow, label that arm a
reference-assisted baseline and keep it separate from the ordinary baseline.

## Diagnostic and heldout split

Diagnostic cases may be inspected and used to revise skills and runtime. Preserve
the original prompt, raw generation and failure for every revision. Any inspected
case, including an initially sealed case, becomes diagnostic once used for a
change. Renaming it or changing identifiers does not restore heldout status.

The independent evaluator must create and seal heldout task inputs and expected
effects before skill freezing; publish hashes, generation procedure, seed and
freeze timestamps before running them. Exclude those files from model and skill
author workspaces. A public file labeled “heldout” is not sealed. Until independent
sealing is implemented, report heldout evaluation as NOT RUN. Cases in this
initial deliverable are exclusively diagnostic.

Reserve a final heldout attempt after diagnostic development stops. Human edits
and skill fixes after observing heldout failures invalidate confirmatory use of
those cases. Retain them as diagnostic and create a new independently sealed set.

## Common construction budget and assignment

For the first diagnostic pair, each arm gets one actual OpenCode TUI session,
240 seconds elapsed time, the same zero-cost provider/model ID, the same app
version, agent, capability policy and IR version. Permit reading supplied task
files and writing output.json only. Deny shell, web, MCP, subagents, external
plugins and access to other runs. Keep temperature and other provider defaults
identical; report defaults as unknown when not observable. Pin the model ID but
do not claim a provider backend revision is pinned without supporting metadata.

The operator sends one task prompt. No steering is allowed before the first
generation is frozen. A later diagnostic correction may send the unchanged
independent validator report once to both arms, with a separate 240-second
budget; preserve first-pass and corrected metrics separately. A failed or
unavailable model call consumes an attempt and must not disappear from results.
Retries caused solely by operator/TUI setup are labeled infrastructure retries.

Alternate AB and BA order across case pairs. Both arms have the same wall-clock
and tool budgets; skill input-token overhead is reported separately rather than
hidden. The TUI is mandatory; `opencode run`, a direct provider API, and generated
fixture substitution are disallowed for construction evidence. CLI metadata and
post-session export are permitted. A catalog entry priced at zero is necessary;
a completed response is required to establish observed availability.

Application turn limits, exact provider tokens, backend sampling seeds and
hard tool-call caps may not all be enforceable through this TUI. Record supported
limits separately from measured or unknown quantities. If a metric's budget
cannot be verified, mark it unknown; do not claim a strict token-matched study.

## Execution controls and metrics

Execute both arms' frozen outputs through the same Foundry executor revision,
tool implementations, synthetic task dataset, initial state, resource budget and
fault schedule. Reset state between arms. If an agent executor is used, pin its
model, prompt, tools and limits independently of the architect model. The initial
deterministic fixture executor is not evidence of autonomous real-world work.

Construction metrics: parse success; IR/schema success; unsupported semantics
detected; explicit task requirements represented; missing mandatory approvals;
unsafe authority; unresolved references; output provenance; first-pass success;
number of correction messages; elapsed time; observed model/tool calls; token
usage when present; cost metadata; amount and kind of human assistance.

Execution metrics: independent task-oracle success; expected terminal state;
effect ledger, duplicate effects, cancellation and timeout behavior; replay and
recovery under injected faults; approval freshness and scope; containment of
untrusted input; evidence supporting completion; discrepancy between reported
success and observed effects. Measure unacceptable side effects independently
of task success. An effect ledger entry is not proof a real service performed it.

Report per-case observations and denominators. A single diagnostic pair supports
no population estimate, statistical superiority or equivalence claim. For a
later adequately sized study, report paired differences and interval estimates,
case/seed clustering and all failed attempts. A noninferiority margin must be
chosen before results and justified by task costs; do not invent a “reasonable
margin” retrospectively or pool incomparable domains.

## Oracle invalidity probes

Before comparative scoring, run deliberately bad artifacts against the evaluator:

| Probe | Required outcome |
| --- | --- |
| Empty graph or no-op that prints success | Reject task success. |
| Valid IR missing a mandatory case requirement | Reject requirement coverage. |
| Self-attested success with no independent effects/evidence | Reject task success. |
| Duplicate an externally observable effect | Detect duplication even if final state looks correct. |
| Wrong or stale approval authorizing a privileged action | Reject authorization. |
| Broken join, dangling dependency, cycle or unsupported adapter behavior | Reject or explicitly classify unsupported. |
| Timeout/cancellation followed by a late success callback | Do not promote to successful completion. |
| Change oracle, expected answer or evaluator from inside task workspace | Deny mutation and invalidate the run if integrity changes. |
| Change artifact after its hash is frozen | Reject provenance; do not score the changed artifact under the old result. |
| Replace model output with a hand-written reference | Reject model-generation attribution. |

Any invalid artifact that passes a required oracle blocks success-rate claims
until the oracle is fixed and both arms are rescored from preserved outputs.
Validator unit tests do not prove every oracle above exists: record the actual
implemented probe inventory and explicitly list missing probes.

## Human intervention

Record each intervention with timestamp, actor (human/operator agent), arm,
reason, exact submitted content, affected artifact hashes, time spent when
observable, and whether it changes task information, authority or implementation.
Keep TUI keystrokes/permission handling separate from domain assistance, but do
not omit either. Every reviewer-supplied workflow node or repaired output counts
as author assistance; hand-edited output cannot be presented as unassisted model
success. Agent-written skills are the treatment; agent-written task solutions
are not a substitute for model results.

## Provenance and data boundaries

Every run lives under ignored `evals/runs/<id>/`, mode 0700, with files mode 0600.
Preserve app version and binary hash, observed model catalog/costs, effective
configuration, task and skill/IR hashes, prompt, raw terminal transcript, terminal
screens, model session export, generated artifact, validator/executor output,
fault schedule, assistance ledger and final classification. Include UTC times.
Do not print, mount or copy host credential files. Do not upload private repos.

The harness gives OpenCode fresh XDG state and an empty view of the host home via
bubblewrap, enables only OpenCode's provider, selects a catalog-observed zero-cost
model for main and small-model calls, and disables sharing, updates, external
plugins, LSP, shell, MCP/subagents and unrelated network tools. Provider requests
still need network access; this is filesystem isolation, not a network allowlist
or a comprehensive hostile-binary sandbox. No paid service or account mutation
is permitted. Stop owned TUI processes after capture.

## Current claim boundary

Harmless TUI smoke results establish only whether the observed free model can
respond and write a synthetic task file under these controls. Later diagnostic
pairs establish behavior on those exact cases. Commercial harness equivalence,
arbitrary worst-case correctness, unattended regulated work and Haiku 4.5
performance remain unmeasured unless separately tested under an authorized,
fair protocol. Unavailable proprietary internals are not benchmark results.
