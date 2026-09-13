# Constrained original DefaultAgent comparison

Revision note: the analysis immediately below is the historical reference-01
record. The new frozen, diagnostically assisted reference-02 result is appended
under "Reference-02 revision". Reference-01's failed source-stability gate remains
failed; the new run does not replace or relabel it.

The bounded run produced a successful original-agent last-occurrence repair and
two observed Foundry history-binding failures. The bucket reference arm was
interrupted by a provider HTTP 503. The campaign is blocked from a clean aggregate
comparison because the final source-drift check also detected concurrent edits.
Preserve the individual raw observations without pooling them into a win rate.

The run used the actual cloned mini-swe-agent DefaultAgent and an actual
Ling-generated Foundry workflow. This is diagnostic evidence on two tiny Python
repair tasks under custom narrow tools, not SWE-bench, full CLI, TUI, separate
SWE-agent-repository or commercial-product parity.

## Results

| Task | Arm | Runtime status | Executor calls | Operations | Submitted | Hidden cases | Task success | Complete model/oracle evidence |
|---|---|---|---:|---:|---|---:|---|---|
| bucket | reference | /usr/bin/bwrap exited with 1 | 2 | 1 | false | 23/70 | false | false |
| bucket | foundry | uncertain | 1 | 0 | false | 23/70 | false | true |
| last-occurrence | foundry | uncertain | 1 | 0 | false | 16/60 | false | true |
| last-occurrence | reference | Submitted | 3 | 3 | true | 60/60 | true | true |

Run-level exception: null. Comparison gate:
"Relevant sources changed during the campaign; inspect the exact source-bound records".
Run source drift: ["src/evaluation.mjs","skills/domain-healthcare/SKILL.md","skills/domain-robotics/SKILL.md","skills/domain-science/SKILL.md","skills/runtime-native/SKILL.md"].
Artifact hash mismatches at report creation: [].
Missing arms or incomplete model/oracle evidence cannot be scored as model failures.
Success requires a submission, a successful original/native runtime exit and all
independent hidden cases. Merely accepting a workflow or exiting Python with zero
is insufficient. Per-arm generation latency and observed cost are recorded in
`research/reference-swe/comparison-evidence.json`.

The bucket reference arm made one completed response containing four JSON
operations; the shared parser returned a visible format error. Its second
provider invocation returned HTTP 503 with "Endpoint is unavailable" after
75,329 ms, with no completed response or session export. This arm is an
infrastructure-interrupted observation, not a model task failure. Its raw process
is `research/reference-swe/runs/20260913-reference-01/bucket-reference/call-2/generation.json`.

Both Foundry arms record an actual ERR_ASSERTION at
`root/repair-loop:0/act`: the supplied history omits the executor's just-returned
assistant message. The runtime conservatively records `effect.uncertain`
because the capability declares non-idempotent effects. Audit counters show
zero dispatched environment operations in both arms; the initial buggy modules
remain unchanged. The original last-occurrence arm performed write, test and
finish in three calls and passed all 60 hidden cases, including unchanged inputs.

The drift detector found changes to src/evaluation.mjs and four skill files,
including runtime-native. Frozen source snapshots and the exact generated prompt
remain available; the aggregate source-stability gate remains failed. Do not
relabel this as a fully stable frozen-source campaign or claim parity.

## Actual construction and failure interpretation

Architecture consumed 1 observed completed Ling calls, with
1 recorded construction attempts, under
the preregistered maximum of three. The accepted candidate is
`research/reference-swe/runs/20260913-reference-01/candidate-workflow.json`; its Foundry canonical digest is
`51f1e6584630e42a348d0a6833090d341b1cf8b27af43303333da5280691adc2`. No candidate bytes were hand-patched.

The accepted candidate's action arguments use `previous.messages` instead of
`nodes.query.messages` (candidate lines 67–73). That omits the immediately
preceding assistant response. Subsequent iterations also expect
`previous.messages`, although the native runtime carries the body-output object
containing `query` and `act`. Root acceptance reads
`nodes.repair-loop.last.done` rather than the action's nested result. The first
history mismatch is checked at the shared operation boundary; the other two
defects are source inspection findings, not claims that those paths were reached.

The structure-only evaluator accepted the two-node loop shape. The generator's
raw `deploymentQualified:true` is retained with its explicit evaluator envelope:
generic loop structure only, no task qualification. This field does not establish
working dataflow or correct repairs. Frozen output and raw failures are preserved;
repairing the architecture would require a separately labeled future condition.

## Source and documented interface conformance

Upstream: https://github.com/SWE-agent/mini-swe-agent, commit
`04d809ceab9df28f9adaed044884180159172930`, package version 2.4.6, MIT license.
Acquisition is recorded in `research/manifests/software.json:229–245`; the
original license remains in the clone and the frozen source snapshot.

Original implementation:
`corpus/SWE-agent--mini-swe-agent/src/minisweagent/agents/default.py:88–157`
owns run/step/query/execute_actions, call accounting, history and exit handling.
Its serialize/save methods are at lines 159–190. Custom Model/Environment protocols
are in `src/minisweagent/__init__.py:43–70`. The adapter imports and instantiates
that original class; it does not reproduce its agent loop. Official documentation:
https://mini-swe-agent.com/latest/advanced/control_flow/ and
https://mini-swe-agent.com/latest/advanced/environments/ .

The imported package creates a global configuration directory, attempts a dotenv
read, and configures logging (`__init__.py:26–36`, `utils/log.py:7–32`). The
reference process runs with an empty isolated `MSWEA_GLOBAL_CONFIG_DIR`, silent
startup, no credential environment and no host home or network. Dependencies are
exact-pinned wheels in the owned environment; no upstream install hooks ran.

Original settings changed deliberately: custom system/instance templates, custom
Model/Environment adapters, five steps, 300 seconds, and cost_limit=0 (disables
the original monetary ceiling; the shared provider instead requires explicit
zero prices and exported zero cost). Default bash parsing, local environment,
provider classes, default YAML and CLI integration are not exercised. Each model
response carries one operation; malformed JSON creates the same visible error
observation in either arm. This is a constrained reference integration.

The native arm uses actual `WorkflowGenerator`, selected installed skills,
schema and custom capabilities. Native loop nodes schedule each query and action,
carry the message list, and decide when to stop. Each capability performs exactly
one model query or one operation. Host bookkeeping verifies provenance and
budgets; it contains no repair policy or hidden agent loop.

## Fairness, isolation and evidence

Both arms use only `opencode/ling-3.0-flash-fin-free` through the existing
`src/opencode-free.mjs` noninteractive product bridge. Each completed call has
raw version/catalog/generation/export records. Completed export checks:
7/7. Total observed
reported cost across completed receipts: 0.
The bridge's metadata describes a product smoke transport; these executions are
the separately labeled constrained comparison, never TUI evidence.

Initial executor-prompt hash equality by task: {"bucket":{"reference":"d496d22a0ac1b83ad10d27dd4dd3601f349b56fb086be2604dcf0c028d560064","foundry":"d496d22a0ac1b83ad10d27dd4dd3601f349b56fb086be2604dcf0c028d560064","identical":true},"last-occurrence":{"foundry":"4e1f844716a4a2eabbe3ecb2857bafbe16971a39830a28e9184ea54688ef7d1b","reference":"4e1f844716a4a2eabbe3ecb2857bafbe16971a39830a28e9184ea54688ef7d1b","identical":true}}.
Architecture task-leak checks: [{"task":"bucket","functionNameAbsent":true,"solutionCasesAbsent":true},{"task":"last-occurrence","functionNameAbsent":true,"solutionCasesAbsent":true}]. The frozen
architect prompt uses only the generic workflow/API contract, schema and skills;
actual task definitions, code and test cases enter executor inputs after
construction. Hidden expected outputs remain on the evaluator side.

The shared operations are read, whole-module write, fixed public test and finish.
There is no arbitrary shell, path selection or test-edit tool. Candidate Python
runs only inside fresh no-network bubblewrap with read-only candidate/oracle
mounts, empty home, 2 CPU seconds, 4 wall seconds, 256 MiB address space, 64
processes, 64 KiB captured output and 1 MiB file-size limits. Process limits are
applied after namespace creation so host user process counts do not prevent the
sandbox from starting. Host comparisons inspect function return values and input
mutation; Python exit status and candidate text cannot self-certify success.

Freeze: `research/reference-swe/runs/20260913-reference-01/freeze.json`, SHA-256 `c75fd408ee29093f1ef772ba3b668a1e08855a0417480ae2715ff4630a3bc85d`.
Raw sources: `research/reference-swe/runs/20260913-reference-01/source/`. Dependency file hashes are frozen beside it.
Full run artifacts: `research/reference-swe/runs/20260913-reference-01/SHA256SUMS.json`, SHA-256
`415eb4c70526177350376b3d4e524e2ac0eb83cbc8de09983828f37a07f2a96e`. Every included artifact was rehashed for this report.
Files are mode 0400 after closure. Hashes detect changes; this does not establish
protection against a malicious host administrator. Isolated provider state is
excluded from the public manifest; raw provider exports and outputs are included.

## Validation and remaining limits

The 13 targeted conformance tests passed before model calls; final preflight is
`research/reference-swe/preflight-final.tap`. They exercise the actual original
class with a scripted no-model provider, original five-call stopping, malformed
responses, history rejection, correct controls, initial/wrong fixes, test-file
tampering, forged stdout, early exit, input mutation, namespace isolation and CPU
termination. Scripted controls are plumbing evidence, never model outcomes.

Repository doctor passed. Broader test output is
`research/reference-swe/repository-tests.txt` (271 passed, one skipped, zero
failed at that source state). There is no configured repository formatter,
linter or typechecker script. Serena's manual tool was disabled. CoS quality-map
found no GitHub workflows or configured local Semgrep rules; the repository has
no remote. No nested worker was spawned; independent review of the comparison
remains prime's integration responsibility.

The full deterministic security profile ran Betterleaks, OSV and Trivy. OSV and
Trivy initially flagged python-dotenv 1.1.1; the pin was upgraded to 1.2.2 before
freeze. Rescan found no dependency vulnerabilities. Three later Betterleaks
matches are public advisory example strings embedded in the retained initial
scanner report, not application credentials. Both raw reports are retained as
`research/reference-swe/security-initial.json` and `security-after-pin.json`.
No local Semgrep rules were available, so no Semgrep result is claimed.

Development failures are retained separately in `preflight-v2.tap`; v3 and final
preflight pass. The initial namespace-launch defect and the test's interpretation
of bubblewrap exit code 137 were corrected before source/case freeze and any
model call. No concrete task/model outcome was used to patch the frozen campaign.

This small experiment cannot establish general model reasoning improvement,
production safety, harness equivalence, reliability rates or whole-product
parity. Tool confinement, history checks and the external oracle are explicit
host mechanisms. Stochastic provider behavior and custom prompt/adapter choices
remain material conditions. Preserve this condition separately from skills-only,
host-contract incident fixtures, TUI studies and old frozen comparator runs.

## Reference-02 revision

The approved generic message-handoff overlay produced an executable generated
loop on the first actual architect invocation. All five neutral transcript
controls passed and all six deliberate binding/stopping mutations were rejected.
Actual model execution repaired the bucket module to pass 70/70 hidden cases in
both arms. However, the Foundry arm hit HTTP 429 before explicit submission, and
both last-occurrence arms hit HTTP 429 on their first invocation. Only the
original-agent bucket arm completed and qualifies as task success in this run.
The requested completed model-driven comparison on both task families is therefore
unavailable. The provider interruptions are not scored as model losses.

The copied execution closure remained stable. This separates the corrected
construction behavior from provider availability, without retroactively turning
the old drifting-source campaign into a valid comparison.

### Actual outcomes and provider availability

| Task | Arm | Executor invocations | Operations | Submission | Hidden oracle | Classification |
|---|---|---:|---:|---|---|---|
| bucket | original DefaultAgent | 3 | 3 | Submitted | 70/70 | Task success |
| bucket | generated Foundry | 3 | 2 | No | 70/70 | Provider interrupted before finish; unqualified |
| last-occurrence | generated Foundry | 1 | 0 | No | 16/60 unchanged baseline | Provider unavailable; unscored |
| last-occurrence | original DefaultAgent | 1 | 0 | No | 16/60 unchanged baseline | Provider unavailable; unscored |

Authoritative receipt:
`research/reference-swe/runs/20260913-reference-02/result-v2.json:22-210`.
The raw failing provider calls are `bucket-foundry/call-3/generation.json`,
`last-occurrence-foundry/call-1/generation.json`, and
`last-occurrence-reference/call-1/generation.json` under that run directory.
Each reports HTTP 429 and `FreeUsageLimitError`. Failed invocations have no
completed response/session-export receipt. No task arm was restarted and no
alternate model, paid fallback or extra architect call was used after these
failures. Each arm remains within the preregistered five-invocation ceiling.

The final provider audit inside the frozen runner verified six completed
responses: one architect, three original bucket executor, and two Foundry bucket
executor responses. Every completed response has matching stream/export text,
the exact `opencode/ling-3.0-flash-fin-free` identity, zero observed catalog
pricing, and zero exported reported cost. The three interrupted invocations are
listed separately. See `result-v2.json:224-430`; no completed cost export is
invented for the interrupted calls.

Actual campaign execution ran from `2026-09-13T13:30:36.195Z` through
`2026-09-13T13:35:53.391Z`, before the recorded `13:41:22Z` deadline. Source capture
was at `13:30:35.303Z`. These are the executed campaign timestamps, not latency
estimates or timing claims about preparation. Source isolation and runtime
limits are unchanged from the original constrained integration. The native
loop still owns query/action scheduling and stopping, and actual original
DefaultAgent still owns its run/step/history/stopping through the documented
custom interfaces. This is noninteractive product-bridge evidence, not TUI or
SWE-bench evidence.

### Construction correction and qualification boundary

Prime approved `CONSTRUCTION-RULE-v2.md` as a study-only overlay before source
capture. No global skill or shared source was edited. Its generic rule preserves
the histories before query, after the assistant response, and after the action
observation. The action receives both returned query fields. The next query
receives the action's history through the body-node wrapper in `previous`.
The initializer and final `last` reference retain that same wrapper.

The actual generated workflow binds query history to `previous.act.messages`,
action message/history to `nodes.query.message` and `nodes.query.messages`,
initial history to `initial.act.messages`, stopping to `nodes.act.done`, and
root acceptance to `nodes.repair-loop.last.act.done`. See the immutable
`candidate-workflow.json:1-9,68-129`. Its canonical workflow digest is
`2c5082d4b722f566a4f5ae73d379cabf58485c1ca73475f3cd870c9ea9001d3d`;
its saved file SHA-256 is
`152f8e25b22db8f5f84975221343fb2d4628065eba636d6af3074bb2d52daf15`.
Candidate output was never hand-patched. Mutation controls operate only on
separate diagnostic copies and never replace the actual candidate.

The current generator maps any evaluator `passed:true` into deployment
qualification. This revision therefore uses the actual WorkflowGenerator with
`evaluator:null`, `maxRounds:1`, and an outer ceiling of two architect invocations.
Only one was needed. Its raw job keeps `deploymentQualified:false` and
`evaluation:null` (`architecture-1/job.json:1-15,113-139`). The separate local gate
records `status:"partial"`, `constructionPassed:true`,
`deploymentQualified:false`, and `taskQualified:false`.

The gate actually executes neutral transcripts for immediate finish, multiple
turns, invalid-operation feedback, finish on the fifth turn and five nonfinishing
turns. Exact history checks and operation counts are enforced at the same
query/action boundaries used in the model arms. The exhaustion case must fail
with `LOOP_EXHAUSTED`. Each of six mutations is rejected: stale action history,
lost recurrence observation, missing initializer wrapper, missing root wrapper,
premature stopping, and ignoring finish. Raw runs are in
`architecture-1/neutral/` and `architecture-1/mutations/`; their top-level receipts
remain partial even when the conformance controls pass. These scripted controls
make zero model calls and provide no coding task solutions or hidden cases.

### Frozen source and dependency identity

`freeze-v2.json` binds 4,769 copied file/symlink entries, including Foundry source,
skills, schemas, installed Node dependencies, the pinned Python environment,
reviewed upstream source and license, the study implementation and tests. The
runner asserts that its own entrypoint resolves inside this copied snapshot.
It verifies the closure before the first call, before each task arm and on exit.
Host executables, their observed linked libraries and Python standard-library
source files are fingerprinted separately (830 entries). This is a frozen source
and package closure with a checked host runtime, not a hermetic OS image or a
snapshot of remotely served model weights.

| Identity | SHA-256 |
|---|---|
| Copied closure manifest | `4bf7d86d40b2ce27e0bf3071e283784d9055711a159d77fd90695c666cfbecfb` |
| Host dependency manifest | `de9a5de108222894f37b0a997d02361f8ed16bdc789f023f6d489a451baab3fa` |
| Freeze receipt | `a45bfee8a848d9cd90e215584fab61c872088da5a6bb945efd8eedf916d3d7b9` |
| Original upstream Git revision | `04d809ceab9df28f9adaed044884180159172930` |

Final frozen-run checks report `closureChanged:[]`, `systemChanged:[]`, and
`sourceStable:true` (`result-v2.json:219-223,432-433`). Changes to the live
repository after capture cannot change the copied executable sources. The
freeze also rehashed all 144 reference-01 manifest-covered artifacts and found
no differences (`freeze-v2.json:21-25`). Its original manifest identity and
failed source-stability result are retained. The old dossier paragraphs above
are historical; the current dossier itself has been extended for this revision.

### Validation, delivery and remaining verification limits

Live preflight: 17/17 tests passed in `preflight-reference02-01.tap`.
The same 17 tests also passed from the frozen snapshot before generation;
the exact command and output are in `frozen-preflight.json`. The tests include
the actual original class, isolated Python oracle positive/negative controls,
input mutation, CPU termination, message provenance, construction counterexamples
and closure modification/addition detection. The unchanged reference-01 graph
continues to fail the new neutral gate before dispatching an operation.

Repository doctor passed and `reference02-repository-tests.tap` reports 304
passed, two skipped, zero failed. Those broader checks apply to the live source
state used for that check; the campaign has its separate frozen-source evidence.
The package has no configured formatter/linter/typechecker script. No Git remote
was configured. Serena returned `PLUGIN_DISABLED`; no Serena analysis is claimed.
No nested worker was launched.

A full CoS security profile was attempted and retained in
`security-reference02.json`. Trivy completed. OSV returned an unavailable resolver
connection/handshake error, so it does not establish a successful current
dependency audit. Betterleaks flagged retained evidence and isolated provider
state; this report does not claim an entirely clean secret scan. The preserved
initial advisory and reference-01 records were not edited to suppress findings.

The additional post-run reconciler `audit-v2.mjs` was prepared and passed
`node --check`, but its execution was blocked by the tool service because it
could not determine the safety status of the request. A separate command to
summarize the security report was also blocked. Neither command was rerouted.
Thus `comparison-v2.json` and `security-reference02-summary.json` were not
produced, and no independent post-seal full-artifact rehash is claimed. The
successful final integrity/export checks cited here are those executed inside
the frozen runner itself, followed by direct inspection of its primary receipts.

The run generated an executable reusable graph, but provider capacity prevented
a completed generated-workflow outcome on either task family and prevented any actual
second-family repair attempt. The successful hidden-oracle bucket observation
does not erase the missing submission. Reference-01's earlier successful
last-occurrence observation remains historical and is not pooled with this
revision. There is no product parity, general reliability or causal superiority
claim from these diagnostic observations.
