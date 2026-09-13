# SRE, security, and adjacent closed-product workflow surfaces

Inspected on 2026-09-13. This dossier records representative execution paths,
observed contracts, and falsifiable requirements. It is not a claim that every
path in every repository was audited or that the downloaded systems were run.
No production account, infrastructure, security target, scanner, or corpus
installer was used. Public source availability is distinct from redistribution
permission and from access to a proprietary backend.

## Provenance and inspection depth

The acquisition records contain the exact UTC acquisition time, local directory,
revision, file count, observed license files and hashes, and outcome. The
repositories were shallow-cloned as inert data with the project acquisition
helper. No submodule, Git LFS content, installation hook, or target was executed.

| Alias | Upstream and pinned revision | Files | Classification and inspection depth |
| --- | --- | ---: | --- |
| H | https://github.com/HolmesGPT/holmesgpt at `459f4d7ae463419a095212442ef5f8818dd0abcc` | 1804 | Public investigation implementation; traced issue entry, active LLM/tool loop, approval token, safeguard, and Prometheus range-query paths. Apache-2.0 at repository root. |
| R | https://github.com/rootlyhq/rootly-mcp-server at `5915e2174bd86e0d653c418d7a1305b82ee8189e` | 98 | Public MCP adapter, not the Rootly SaaS implementation; traced current server construction, OpenAPI transformation, active HTTP transport, and related-incident tools. Apache-2.0. |
| V | https://github.com/resolve-ai-oss/resolve-ai-plugins at `d6627cc32863f8f5f79bab4de1fb886f458b0236` | 93 | Public skill pack and remote MCP configuration, not Resolve's investigation engine. Apache-2.0 and NOTICE. |
| S | https://github.com/KeygraphHQ/shannon at `25b90b0611f15ab945e051dfee8ae78600d3a002` | 369 | Public security workflow implementation; traced current Temporal/Pi orchestration, queues, partial coverage, cancellation, durable report finalization, and executor selection. AGPL-3.0 overall, with separately attributed MIT and Apache-2.0 material. |
| X | https://github.com/xbow-engineering/validation-benchmarks at `a16cb1ba0701b20d63913846536fc7b0672082af` | 6756 | Historical public benchmark targets and build metadata, not XBOW's agent or product. Root Apache-2.0; bundled third-party code retains its own terms. Inspected metadata/build contracts only. |
| N | https://github.com/horizon3ai/h3-cli at `96326ac46f21e28abee5a0e43bebc94206205964` | 142 | Public API CLI implementation plus MCP deployment documentation; the MCP server implementation and NodeZero engine were not acquired. No license file was established by the acquisition helper. |
| D | https://github.com/DataDog/datadog-agent at `ce94853454777d3d1b68f555fd8d89d49f3be1bf` | 26568 | Public telemetry-agent source, explicitly **not** the Bits investigation harness. Inspection was limited to repository/license orientation and the agent command entry. User-space Apache-2.0 and BPF GPL-2.0; additional third-party terms exist. |

Aliases below resolve to `corpus/<owner>--<repository>` using these exact
revisions. A reference such as `H:holmes/main.py:163-189` means that path and
inclusive line range in the pinned checkout, not a moving branch. A public
permalink can be formed from the table's repository URL, `/blob/<revision>/`,
the path, and a line anchor. These are static source observations unless stated
otherwise.

Acquisition manifests:

- [Five primary repositories](../manifests/sre-security.json).
- [Horizon3 CLI](../manifests/sre-security-extra.json).
- [Datadog telemetry source](../manifests/sre-security-telemetry.json).
- [Official documents and Torq export](../manifests/sre-security-docs.json).
- [Harvey and Hebbia public surfaces](../manifests/sre-security-adjacent-docs.json).

Documentation snapshots are under `corpus/public-docs-sre-security/`, with SHA-256
hashes and resolved URLs in their manifest. HTML and YAML were kept inert. The
Torq YAML export has no established separate redistribution license. Its
discovery article is the durable retrieval reference; its public attachment
URL contains an expiring signature. No authentication was needed to acquire it.

## HolmesGPT: investigation is a bounded evidence loop

### End-to-end trace

`H:holmes/main.py:163-189` builds an investigation prompt from configured toolsets
and the issue's raw context, then invokes `ToolCallingLLM.call`. The issue is
context data, not an independent source of runtime authority.

`H:holmes/core/tool_calling_llm.py:620-739` is the synchronous wrapper over the
streaming control loop. The active loop at `1084-1536` limits iterations, prepares
or compacts context, calls the model, dispatches tools, appends their observations,
and repeats. At `1154-1161`, the last iteration removes tools. At `1319-1348`,
the model's absence of tool calls causes `ANSWER_END`. That event means the
conversation produced its answer; it does not independently establish a repaired
service or a causally proven root cause.

`H:holmes/core/tool_calling_llm.py:911-1037` resolves a tool, parses arguments,
checks the duplicate-call safeguard, invokes the tool, and records its result.
Malformed argument JSON is logged and replaced with an empty argument object at
`951-957`; the downstream tool must still reject missing required arguments.
Large output handling at `1006-1021` can preserve evidence outside the immediate
model message. Threaded execution at `1368-1399` permits parallel observations;
requesting cancellation of futures does not prove that already running external
operations stopped.

### Evidence, permissions, and tool contract

`H:holmes/core/tools.py:64-109` distinguishes success, error, no data, approval,
and frontend-pause states and carries structured result details. The Foundry
adapter should preserve these distinctions rather than flattening every result
into text or an empty array.

`H:holmes/core/tools.py:353-427` checks approval before invocation, including
configured tool approval rules. `H:holmes/utils/approval_tokens.py:76-115` binds a
signed token to the tool-call identifier, tool name, and argument digest. The
token implementation has a time-to-live and signature validation; the inspected
token claims do not include the target's current resource version or a consumed
one-use nonce. This is a bounded observation about that token, not proof that no
other deployment layer can enforce stronger rules. A workflow needing freshness
must verify it outside the model immediately before dispatch.

The representative telemetry tool is
`H:holmes/plugins/toolsets/prometheus/prometheus.py:1755-1869`. Its range-query
inputs include query, description, output interpretation, start/end, step,
timeout, and maximum points. It normalizes timestamps and adjusts resolution
before constructing the query-range request. Preserve the actual interval and
resolution in evidence so a graph with coarser sampling cannot masquerade as an
equivalent fine-grained measurement.

There is a concrete executor constraint in the same file at `623-682`: the AMP
signed-request branch does not propagate the requested timeout, explicitly noted
at `648-649`, while the other inspected branches supply timeout arguments. An
outer deadline or a rejected adapter is needed when bounded completion is a
hard workflow requirement. A prompt saying “stop after 60 seconds” cannot supply
that missing execution guarantee.

### Failure modes and comparison limits

`H:holmes/core/safeguards.py:8-50` can reject repeated tool names and arguments;
its comment assumes read-only duplicate calls. That is not an effect ledger.
An identical read can be necessary after a changed resource or after waiting for
recovery. The falsifying case is a stale first measurement followed by a valid
fresh read using identical query arguments.

The observed model-loop completion is useful for a diagnostic assistant, but a
recovery workflow must add its own post-change service oracle. The extracted
model/tool orchestration can inform a substitute executor, subject to provider
and schema compatibility. This run did not install Holmes, call a model through
it, provision telemetry, or measure its incident-resolution performance.

## Rootly: a broad API adapter needs deliberate capability selection

### Active construction and request path

`R:src/rootly_mcp_server/server.py:636-835` resolves the server settings,
transforms an OpenAPI schema, constructs the authenticated HTTP wrapper, and
builds a FastMCP server. The current execution path uses
`AuthenticatedHTTPXClient` from `transport.py`; conclusions about a different
client implementation must not be attributed to this path.

`R:src/rootly_mcp_server/server_defaults.py:195-263` and
`R:src/rootly_mcp_server/server.py:674-682` show that the active defaults include
write operations unless restricted. DELETE configuration is separate and defaults
to an empty list on this path. Therefore “writes available by default” does not
mean “all delete endpoints available.” An omitted capability subset is also not
equivalent to an explicitly empty deny-all subset.

`R:src/rootly_mcp_server/spec_transform.py:166-306` filters paths, methods, and
operation identifiers. It can simplify response schemas to permissive objects at
`277-288`. An adapter should validate the evidence envelope it actually needs,
rather than infer complete trustworthy data from successful MCP execution.

`R:src/rootly_mcp_server/transport.py:777-818` constructs an HTTP client with
bounded timeout and connection limits. The request method at `995-1077` checks
path parameters, normalizes query/body shapes, handles per-session authentication,
dispatches the request, records failures, and post-processes responses. There is
one request dispatch in this inspected method, not an automatic generic retry
loop. The response-body unwrapping at `1080-1094` is a concrete example of why
an importer needs to preserve the API's real argument semantics.

### Investigation assistance and recovery semantics

`R:src/rootly_mcp_server/tools/incidents.py:1470-1640` implements a related-incident
search. It accepts an incident identifier or description, clamps the requested
result count, retrieves incident data and a bounded page of historical incidents,
scores similarity, and returns matches. Historical similarity can suggest a
hypothesis; it cannot establish the present incident's cause. The first-page
collection boundary must remain visible when reporting retrieval coverage.

`R:src/rootly_mcp_server/transport.py:1184-1240` annotates an offset-pagination
limit with a structured recommendation to narrow the query or use cursors.
This is a useful recovery pattern: explain a permanent query-shape failure in
machine-actionable terms instead of repeatedly submitting the same request.
The 404 annotation at `1137-1181` is explicitly heuristic and sometimes ambiguous;
preserve that uncertainty rather than turning a hint into a fact about account
entitlement or resource existence.

This public adapter exposes tools, not Rootly's entire incident-response product.
The inspected functions do not establish a universal per-action human approval
protocol. A client may enforce one, and the API account may have separate
permissions. Foundry should select exact low-impact operations and enforce its
task-specific scope regardless of a broader account's available capabilities.
No authenticated Rootly request was made.

## Resolve: reusable skills delegate into a closed investigation engine

`V:plugins/claude/resolve-ai/.mcp.json:1-8` points to the remote HTTP MCP endpoint
`https://app0.resolve.ai/mcp/v2`. The acquired material is a set of instructions
for interacting with that service, not its internal planner or agent runtime.

`V:plugins/claude/resolve-ai/skills/investigate/SKILL.md:23-57` selects an existing
investigation or an alert, retrieves details and evidence, and starts or follows
an investigation through the backend. Its documented confirmation step is useful
evidence of the client contract, but backend enforcement was not tested.

`V:plugins/claude/resolve-ai/skills/apply-fix/SKILL.md:16-23` moves from a theory
and supporting production evidence into local code changes, verification, and
feedback. A passing code check or a created pull request is still different from
verified recovery of the affected production service.

`V:plugins/claude/resolve-ai/skills/steer/SKILL.md:17-47` keeps steering tied to
the active investigation and relevant source observations. The reusable principle
is a scoped revision message containing evidence and the intended change, followed
by re-reading the updated investigation state. It is not permission to rewrite
unrelated workflows or discard contradictory evidence.

`V:plugins/claude/resolve-ai/skills/ask/SKILL.md:37-53` chooses conversation scope
and instructs the host to run a returned `stream_command` verbatim. A portable
Foundry integration should translate supported streaming operations into typed
host actions; it should not grant arbitrary execution authority to a command
string in a tool response. This is a trust-boundary requirement, not a claim
that the official endpoint returned a malicious command.

The official overview snapshot, `resolve-overview.md:13-22`, describes parallel
hypotheses, cross-system evidence, causal timelines, tool use, and accumulated
organizational knowledge. These are vendor descriptions. The public skill pack
does not let us inspect those algorithms or substitute a model inside the
proprietary backend. Changing the model in the MCP client changes the client,
not necessarily the backend investigator. No Resolve account was used.

## Shannon: durable partial outcomes and canonical reports

### Current entry and executor path

The pinned tree is a monorepo whose active worker code is under
`S:apps/worker/src/`. Older descriptions of a root-level, Claude-only runner do
not describe the inspected revision.

`S:apps/worker/src/temporal/workflows.ts:359-444` validates and initializes the
workflow context and exposes its running state. `594-834` coordinates analysis
lanes, durable producer reconciliation, queue checks, and conditional subsequent
work. Independent branches are bounded, and completed, failed, or unavailable
branches remain distinguishable.

`S:apps/worker/src/ai/pi/pi-executor.ts:232-344` resolves the model, builds
the resource loader, assembles explicit built-in and custom tool names, starts
an in-memory Pi session, and attaches audit and usage tracking. Pi handles
transport retry while Temporal owns agent restarts. The parent aggregates child
usage instead of treating sub-agent work as free. Model selection is a provider
and model identifier contract in `S:apps/worker/src/ai/models.ts:10-32`; this
supports the possibility of executor substitution, subject to supported provider,
tool, context, and authentication behavior. No substituted-model run occurred.

The tool surface is substantial. At
`S:apps/worker/src/ai/pi/pi-executor.ts:58-110`, built-ins include filesystem and
shell tools, while browser-driving agents receive an additional browser skill.
Bounded shell timeouts are loaded. A configuration branch at `85-92` logs a
warning and skips permission-package enforcement when a deny configuration exists
but its package cannot be resolved. The reusable requirement is to refuse startup
when a required guard is unavailable. This is a static observation of that branch,
not an executed escape or a claim about every deployment.

### Evidence validation, joins, and termination

`S:apps/worker/src/services/queue-validation.ts:143-151,215-270` requires the
expected queue and analysis artifacts and validates the presence and structure
of the queue. Malformed or missing artifacts are not silently treated as an
empty successful queue. Error handling at `355-368` fails closed on unexpected
validation failures. `S:apps/worker/src/services/exploitation-checker.ts:39-56`
propagates queue validation errors; a valid empty queue is a distinct state.

`S:apps/worker/src/temporal/workflows.ts:754-866` joins branch work and records
failures instead of erasing them from the result. `1151-1284` finalizes a report
with durable partial-coverage reasons. The final terminal classification at
`1392-1434` distinguishes completed, partial, cancelled, and failed outcomes.
A lane returning no findings is not interchangeable with a lane that never
completed or could not collect evidence.

Retry configuration at `S:apps/worker/src/temporal/workflows.ts:92-170` distinguishes
production and test retry budgets, excludes selected permanent failure types,
and uses different cancellation settlement policies for report work. These
settings should be inspected as actual contracts, not copied blindly: a long
production retry horizon is inappropriate for a small local diagnostic budget.
`S:apps/worker/src/ai/pi/pi-executor.ts:321-351` connects activity cancellation to
session abortion; it is explicitly best-effort while the session unwinds.

### Lost acknowledgement and canonical state

`S:apps/worker/src/temporal/workflows.ts:613-695` reconciles durable producer
outcomes. Its accounting distinguishes missing spend information after recovery
from zero spend. That distinction matters when comparing efficiency after a
crash: successful recovery does not make unobserved execution cost disappear.

`S:apps/worker/src/services/report-finalization.ts:57-98` identifies canonical
report artifacts and checks integrity. At `138-166`, the manifest records the
expected paths and digests. Runtime coverage metadata is applied at `177-205`;
the report model is not the sole authority for what actually ran.

`S:apps/worker/src/services/report-finalization.ts:273-327` verifies an existing
commit against canonical content and compatible inputs. `334-436` locks and
finalizes the report; the adoption path at `375-389` handles a previously committed
result whose acknowledgement was lost. `438-480` treats derived presentation
problems separately from canonical evidence. The reusable mechanism is an
identity-bound commit manifest, verification before adoption, and separate
classification of evidence failures and presentation failures.

This is evidence of state and artifact discipline, not proof that every reported
security finding is true. A schema-valid, internally consistent report can still
contain a mistaken interpretation. Independent controls and target-bound evidence
are necessary for the latter claim.

`S:apps/worker/src/types/run-state.ts:30-39,244-405,506-547` supplies explicit
partial-reason and state constraints. The canonical report and admission states
at `796-820,1015-1057,1086-1127` support recovery checks and monotonic transitions.
The full system was not installed or executed. Its AGPL and third-party notices
remain in the corpus; the Foundry skills and fixtures are original requirements,
not transplanted implementation code.

## XBOW: historical targets are not the current product

`X:README.md:3-15` now explicitly describes the 2024 benchmark suite as outdated
for measuring current systems, including exposure and saturation concerns. Its
older release-time descriptions must not be read as a present-day guarantee of
uncontaminated evaluation. The official note at
https://xbow.com/blog/benchmarks is preserved as `xbow-benchmarks-note.md` with
its retrieval hash.

`X:README.md:21-26` describes a single-objective flag style of task. The sample
`X:benchmarks/XBEN-003-24/benchmark.json:1-14` contains task metadata and a flag
win condition. The associated YAML includes source-bundling configuration,
which affects what the executor can see and therefore the comparison's threat
model. `X:common.mk:22,56-58` derives a default flag from public benchmark identity
and exposes it in the build path. An evaluator must not give an agent its own
ground truth through source, build logs, or filesystem access.

The benchmark's container healthcheck and startup success are infrastructure
readiness checks, not the task's objective oracle. None of the target containers
were built or run here. The useful transfer is a separately owned evaluator,
explicit task visibility, reproducible worlds, and direct outcome measurement.
The public targets can supply development failure patterns; they cannot establish
current XBOW parity or sealed generalization. No XBOW engine was downloaded.

## Torq: one downloadable workflow exposes importer requirements

The official export guide is
https://kb.torq.io/en/articles/9140014-export-and-import-workflows-in-torq.
Its linked YAML was downloaded without an account as inert research data:
`corpus/public-docs-sre-security/torq-migrate-workflows.yaml`, 5982 bytes,
SHA-256 `3a55b2f262adbc9bf8cc4ee97bde14dc8310c9617c6208cd23b2205ead730521`.
The YAML's custom tag was not executed or passed to an unsafe object constructor.

### Concrete static trace

The export declares source and destination integration parameters at `15-37`,
lists workflows with a page-size parameter at `56-60`, iterates them at `77-82`,
retrieves a revision at `82-89`, imports it at `105-111`, accumulates failed
imports at `127-148`, and exits at `155-171`. These are export semantics visible
in text; account behavior and Torq runtime execution remain untested.

Three inconsistencies are particularly useful as falsifying examples:

1. The destination parameter declared at `27` is named differently from the
   destination reference at `110`. A binder should flag the unresolved name.
2. The failure object at `147` labels an import status but references the retrieval
   step's status. A valid-looking failure report can describe the wrong operation.
3. The exit at `155` is unconditionally successful while failed imports are
   returned separately. A successful platform step cannot by itself prove that
   the intended destination received every required workflow.

These observations apply to the downloaded example. They are not claims of an
executed vulnerability in Torq's platform. The list limit and moving `latest`
revision also motivate completeness and reproducibility checks; absence of a
visible pagination loop in this example does not prove that every Torq integration
lacks pagination support.

### Public product contracts

The approval guide at
https://kb.torq.io/en/articles/9140073-implement-a-workflow-approval-flow-effectively-control-production-changes
describes review of workflow publication and changes. Such review is distinct
from a grant to execute a particular effect on a particular current resource.
The retry guide at
https://kb.torq.io/en/articles/9112337-set-steps-to-automatically-retry-enhancing-workflow-reliability-in-torq
describes configurable attempts, delays, conditions, and failure continuation.
Its prose and timing example should not be treated as a verified scheduler trace.

The agent guide at
https://kb.torq.io/en/articles/12065413-ai-agents-bring-adaptive-intelligence-into-your-workflows
describes workflow tools, structured responses, traces, and a bounded tool-call
loop. Those are documented product features, not an acquired engine. This search
established a downloadable workflow example; it did not establish an open Torq
runtime or unrestricted access to every customer workflow.

## NodeZero and Horizon3: distinguish CLI, MCP server, and test engine

`N:README.md:1-21` identifies an API CLI and links the MCP deployment guide.
`N:bin/h3:208-267` normalizes and dispatches subcommands. The representative
read command at `N:bin/h3-pentests:23-34` builds parameters, calls the GraphQL
wrapper, and formats selected response fields. It does not implement the
NodeZero investigation engine.

`N:bin/h3-gql:152-200` resolves a query and variables, submits it, handles selected
expired or unauthorized token responses with one refresh/retry, and rejects
GraphQL errors. Query submission is visible at `85-111`. No query was executed
here. `N:bin/h3-weaknesses-stream:23-27` delegates to the pagination wrapper;
`N:bin/h3-gql-stream:47-55,82-109` reads pages of twenty until empty or its fixed
page cap is reached. Reaching the cap does not visibly return a separate
incomplete-coverage record in that wrapper. A report built from this stream
must not assume that a normal end of output means all records were observed.

`N:bin/h3:68-90` includes a diagnostic environment command that prints the API-key
variable. It was not run. This illustrates why “read-only diagnostic command” is
not a sufficient permission class: a read can disclose credentials.

`N:mcp/README.md:3-27,178-185` distinguishes a local single-user deployment from
the hosted service and documents a session-isolation limitation for local HTTP
transports. `91-95` distributes the local MCP server as a container image; the
repository does not contain that server's implementation in the inspected `mcp`
directory. The image was neither pulled nor run.

The current official catalog at
https://docs.horizon3.ai/portal/features/mcp/tools/ distinguishes read-only
GraphQL queries from scope-setup operations that create a new assessment. It
marks an older request tool deprecated. This is a concrete reason to inspect
the live authorized tool schema rather than copy the older names in
`N:mcp/README.md:348-354`. The verification feature's public documentation at
https://docs.horizon3.ai/portal/test_types/1cv/ was archived as a product surface;
its engine and real verification behavior were not inspected.

Substituting an LLM at the MCP client does not substitute the proprietary
NodeZero engine. No account, API key, scan, real target, or container was used.
The CLI's missing established license also prevents treating this acquisition
as unrestricted permission to redistribute its code.

## Datadog: telemetry source and Bits investigation are separate artifacts

The previous Bits AI SRE documentation URL resolved during acquisition to
https://docs.datadoghq.com/bits_ai/bits_investigation.md. The preserved
`datadog-bits-sre.md:1-24` calls the product **Bits Investigation** and describes
iterative hypotheses and relevant telemetry. Links at `34-46` point to issue
investigation, configuration, knowledge sources, chat, and evaluation material.
These are public product descriptions; the closed investigation runtime was not
downloaded or authenticated against.

`D:README.md:6-23` identifies a telemetry agent and its licenses.
`D:cmd/agent/main.go:23-69` maps executable names to a command builder and runs
the selected agent command. This is useful source provenance and telemetry
integration context, but it is not evidence of Bits' internal planning,
approval, verification, or model-substitution implementation.

The optional follow-up acquisition of deeper Datadog documentation was blocked
by the tool's safety-status check before execution. It was not retried through
an alternative route. The existing successful main-document snapshot remains
available; no deeper byte-for-byte snapshot is claimed.

## Adjacent public surfaces requested by prime: Harvey and Hebbia

This is a bounded documentation comparison, not a legal or financial-domain
implementation audit. Neither proprietary engine, customer workflow, or account
was acquired. The official pages and their acquisition outcomes are recorded in
`sre-security-adjacent-docs.json`.

Harvey's official agent release notes at
https://help.harvey.ai/release-notes/category/agents record natural-language
workflow drafting on July 24, 2025 and conversational workflow editing on
May 13, 2026. The latter date also records workspace-agent exports for admins.
The same page distinguishes workflow access roles and publication approval.
These establish relevant public product surfaces, not an account-free export
endpoint or inspectable generation algorithm. The current agents page at
https://www.harvey.ai/platform/agents describes plan review, scoped adjustment,
step logs, citations, and reusable custom agents. No performance or correctness
claim was independently tested.

Hebbia's official June 2026 update at
https://www.hebbia.com/blog/whats-new-june-disclosure-2026 describes Matrix and
workflow changes. Its current public comparison page at
https://www.hebbia.com/resources/hebbia-vs-rogo describes composable Matrix
workflows and reusable skills. As a vendor-authored comparison, it supports only
what Hebbia publicly describes about its own surface; it is not independent
evidence about either vendor's relative quality. No Matrix export, SDK, model
substitution path, or underlying source was established in this bounded check.

## Extracted requirements and falsifiers

Support labels: **S** = observed in a pinned source path; **D** = public vendor
documentation; **I** = original design inference from that evidence. Every
enforcement proposal below is a Foundry requirement, not a claim that the current
runtime already implements it. The associated domain fixtures are development
specifications with hidden-world and independent-oracle requirements.

| ID | Requirement, evidence, applicability, and enforcement | Falsifier and cost/tradeoff |
| --- | --- | --- |
| `sre-1` | Preserve target, interval, units, denominator, resolution, completeness, and missing-data status. S: H tool envelope `core/tools.py:64-109` and Prometheus `1755-1869`. I: typed evidence envelope checked at every adapter. Applies to telemetry-based conclusions. | `SRE-F02/F03`: empty samples or missing regional traffic cannot prove health. Metadata and per-slice checks increase storage and query cost. |
| `sre-2` | Maintain competing explanations and query evidence that can discriminate them. S: R historical similarity `tools/incidents.py:1470-1640`; D: Resolve overview. I: evidence-linked hypothesis ledger and contradiction checks. | `SRE-F01`: an incident starts before the attractive deployment explanation and affects an unchanged consumer. More queries cost time; stop inconclusively when observations cannot discriminate. |
| `sre-3` | Separate answer completion from sufficient coverage and recovery. S: H `tool_calling_llm.py:1319-1348`; S partial-coverage finalization `workflows.ts:1392-1434`. I: explicit diagnosed, partial, inconclusive, and verified outcomes. | `SRE-F02/F03`: all required branches must remain in the denominator. Strict coverage can reduce apparently successful runs while improving honesty. |
| `sre-4` | Bound total calls and retry time; distinguish transient transport faults from invalid queries and authorization denial. S: R `transport.py:1184-1240`; H AMP timeout limitation `prometheus.py:648-649`. I: adapter deadlines and typed failure policies. | `SRE-F04`: immediate retry of a rate limit or repeated offset error fails. Strong outer deadlines may require process isolation or rejecting an adapter. |
| `sre-5` | Bind an effect grant to exact arguments, principal, target version, workflow revision, expiry, and one-use admission identity. S: H `approval_tokens.py:76-115`; D: Torq publication approval is a separate contract. I: trusted runtime admission checks. | `SRE-F05`: revision or resource drift after approval must block dispatch. Requires authoritative readback and invalidation of stale approvals. |
| `sre-6` | Persist effect intent and reconcile unknown outcomes before retry. S: S durable reconciliation `workflows.ts:613-695` and report adoption `report-finalization.ts:375-389`. I: effect receipt protocol, not duplicate-prompt suppression. | `SRE-F06`: a lost acknowledgement must leave exactly one committed increment. Requires executor-specific receipt/idempotency support; otherwise remain uncertain. |
| `sre-7` | Verify recovery with fresh, sustained per-slice measurements and sufficient request volume. S: telemetry parameters; I: independent domain oracle beyond an LLM's terminal answer. | `SRE-F03/F06`: global averages, a zero-traffic interval, or pre-change data cannot establish recovery. Observation windows add latency. |
| `sre-8` | Convert human changes into version-bound semantic proposals and revalidate affected evidence and authority. S: V steering skill `17-47`; S canonical report input checks `273-327`. I: dependency-aware invalidation. | `SRE-F05`: preserve useful unchanged evidence while rejecting old approval for a changed action. Tracking dependencies is more complex than overwriting a saved prompt. |
| `security-1` | Classify tools by real effects and scoped permissions, including read-related disclosure. S: R active write defaults; N `bin/h3:68-90`; D: NodeZero current tool catalog. I: exact operation/effect manifest. | `SEC-F02`: a setup-named tool creates an assessment despite a read-only task. Requires current schemas and may shrink the available tool set. |
| `security-2` | Evidence and remote tool responses cannot create execution authority. S: V `ask/SKILL.md:50-53`; S conditional permission-package loading `pi-executor.ts:85-92`. I: typed streaming adapters, untrusted-text boundaries, reject missing mandatory guards. | `SEC-F01`: injected log instructions must never dispatch an unapproved tool. A typed adapter needs more engineering than running returned shell strings. |
| `security-3` | Missing/malformed evidence is not a clean result; integrity and substantive truth are different checks. S: S `queue-validation.ts:215-270`; R permissive response transformation. I: validate evidence envelopes and functioning controls. | `SEC-F03/F04`: malformed queues or unreachable controls cannot mean no findings or successful remediation. Strict typing surfaces additional incomplete outcomes. |
| `security-4` | Enforce per-run authority and settled cancellation outside the model; classify ambiguous effects conservatively. S: H approval binding and S `pi-executor.ts:321-351`; I: stronger one-use, version-aware gate and effect ledger. | `SEC-F02/F06`, `SRE-F06`: changed target, repeated effect, or stale report cannot inherit an unrelated grant. Some interrupted operations remain uncertain until externally reconciled. |
| `security-5` | Verification requires the right current target, a working observation path, and benign control observations. D: NodeZero verification surface; I: independent validation contract rather than “could not reproduce.” | `SEC-F04`: a policy update followed by an unreachable endpoint is inconclusive. Controls require additional observations and may expose insufficient access. |
| `security-6` | Preserve every required branch's coverage and adopt only identity-compatible committed artifacts. S: S `workflows.ts:754-866`, `report-finalization.ts:273-327`. I: canonical manifest and explicit partial outcomes. | `SEC-F03/F06`: a missing branch or different target cannot be hidden by an otherwise valid report. Durable state and canonical manifests add storage/coordination work. |
| `security-7` | Validate exported bindings, step schemas, destinations, revisions, and aggregate outcomes before execution. S: Torq YAML `27,110,147,155`. I: typed import validation plus destination-state oracle. | `SEC-F05`: syntactic parsing cannot excuse three inconsistent bindings/status rules. Unsupported platform semantics must block import instead of being silently approximated. |
| `security-8` | Separate public development data from sealed tests; keep ground truth outside model/tool visibility and control executor substitution. S: X README `3-15`, `common.mk:22,56-58`; S model selector and V remote MCP boundary. I: independent evaluator and matched comparison contracts. | Expose the oracle or change backend/tools between arms and invalidate the comparison. New worlds and controlled access are costlier than rerunning published examples. |

## Fixture inventory and comparison protocol

The six SRE and six security fixtures are in
`skills/domain-sre/references/fixtures.json` and
`skills/domain-security/references/fixtures.json`. Each defines agent-visible
inputs, a hidden world, fault schedule, expected terminal category, declarative
oracle checks, a known-bad trace, and a paired counterfactual. They use mock
operations only and contain no real targets or exploit procedures.

These files are explicitly **not executable simulators**. The prime must implement
their operators against independently owned state before reporting pass rates.
During any model trial, project only `agentVisible` into the task and prevent
access to the hidden fields, expected outcomes, and bad traces. The complete
development files are intentionally inspectable by researchers; that visibility
must not be confused with held-out evaluation.

Measure architect, executor, tools, runtime, task generator, budgets, and human
assistance independently. Reject a trial whose evaluator cannot distinguish the
bad trace from a valid one. Report hard authority/evidence failures separately
from cost and success metrics. Model self-confidence, a schema-valid graph, or
an attractive visualization is not a substitute for the outcome oracle.

For Holmes or Shannon, a future substitution experiment requires compatible
provider/tool behavior and identical task visibility. For Rootly, Resolve, and
NodeZero, a public integration client may still invoke a fixed proprietary
backend. Torq's example export is a design specimen, not a portable copy of Torq.
The Datadog telemetry clone is not Bits. Harvey and Hebbia remain documentation
comparisons. None of these materials supports a current commercial-parity claim.

The independent review of the newly created Foundry runtime, including actual
local regression results and unresolved enforcement limits, is recorded separately
in [runtime-security-review.md](runtime-security-review.md).
