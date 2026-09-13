# Software, browser, skill and framework deconstruction

Observed on **2026-09-13**. This dossier reports source inspection and design deductions. The corpus checkouts were not installed or executed. A separate adapter-validation pass ran pinned PyPI LangGraph wheels in an isolated environment; see the [LangGraph validation record](../../adapters/langgraph/VALIDATION.md) and [n8n validation limits](../../adapters/n8n/VALIDATION.md). No provider benchmarks, hosted services, model comparisons or commercial parity were verified by this worker's research pass.

## Provenance and inspection depth

The acquisition ledger is [`../manifests/software.json`](../manifests/software.json). It contains the requested 16 repositories plus the MCP specification and the current successor to OpenAI's deprecated skills catalog. Every entry records its public URL, full commit, acquisition timestamp, tracked-file count, license-file evidence and inert-clone outcome. All 18 repository URLs were checked against their public upstream pages. The [evidence registry](software-browser-evidence.json) adds full-file SHA-256 digests to the revision/path/line spans. Its [readable index](software-browser-evidence.md) links each span to the pinned upstream revision. Regenerate and verify it with `node research/build-software-evidence.mjs`.

Acquisition used shallow Git clones, disabled hooks and LFS smudging, did not initialize submodules and did not run package scripts. Checkouts live in ignored `corpus/owner--repo/` directories. They are research data, not installed plugins. A successful acquisition proves source availability at that revision, not application health.

| Source | Pinned revision prefix | Tracked files | Available layer / inspection depth | Observed licensing boundary |
|---|---|---:|---|---|
| openai/codex | `1715e5507673` | 7,804 | CLI implementation; detailed approval, sandbox retry and skill-selection paths | Root Apache-2.0; vendor and bundled components have additional notices/licenses |
| openai/symphony | `e0ccc83720a4` | 131 | Specification and Elixir reference orchestrator; runner, workflow parser, workspace path checks | Apache-2.0 |
| openai/skills | `49f948faa925` | 783 | Deprecated skill catalog; selected CI and skill-creation recipes | Per-skill licenses; includes restricted vendor material |
| SWE-agent/SWE-agent | `3ea751c087f3` | 409 | Agent implementation; detailed recovery, termination and reviewer paths | MIT |
| SWE-agent/mini-swe-agent | `04d809ceab9d` | 221 | Small agent implementation; complete default agent and local environment | MIT |
| anthropics/skills | `34040c9c5685` | 419 | Skill pack; detailed skill-creation evaluation and trigger recipe | Mixed; many Apache-2.0 examples, document skills expressly source-available |
| anthropics/claude-agent-sdk-python | `37a52c9fb3f0` | 144 | Public SDK/control transport; detailed lifecycle, permission and subprocess boundary | MIT SDK does not disclose or license the delegated Claude CLI implementation |
| browser-use/browser-harness | `afbcc381b963` | 190 | Browser daemon/helpers/MCP surface; detailed CLI, wrappers and recovery tracking | MIT; hosted browser services remain external |
| browser-use/browser-use | `50f205533fe1` | 518 | Agent library; detailed observe/act loop, batch guards, stopping and judge | MIT; optional cloud services remain external |
| browserbase/stagehand | `b771930d2b4d` | 1,236 | SDK plus extension runtime; detailed action and cache client paths | MIT source; inspected cache-key computation/storage is delegated to an external service |
| Skyvern-AI/skyvern | `35cfb314f477` | 5,541 | Application/workflow engine; detailed safe-block execution and script/agent fallback | Root AGPL-3.0; not a whole-tree or deployment licensing opinion |
| simular-ai/Agent-S | `3aa272d23d29` | 127 | Agent implementation; current S3 worker, grounding handoff and comparative judge | Apache-2.0 |
| agentskills/agentskills | `69ef37e9424c` | 139 | Standard and reference tools; complete format/disclosure specification | Root/reference tools Apache-2.0; `docs/LICENSE` CC-BY-4.0 |
| langchain-ai/langgraph | `e539ac122f41` | 673 | Framework; detailed interrupt/resume, join and compilation interfaces | MIT; hosted deployment services are separate |
| langchain-ai/langchain | `348c9dc57259` | 3,125 | Framework/provider integrations; agent factory and human-review middleware | MIT root; preserve package/component notices |
| n8n-io/n8n | `4169b55bf3b3` | 28,585 | Source-available engine and integrations; detailed retry/wait/sub-workflow contracts | Sustainable Use License, Enterprise exceptions and component-specific licenses |
| modelcontextprotocol/modelcontextprotocol | `cc2a84f5ca54` | 951 | Specification/schema; tools, output/errors and cancellation version 2026-07-28 | MIT-to-Apache contribution transition; non-specification docs CC-BY-4.0 |
| openai/plugins | `1dc195897af4` | 5,386 | Current plugin examples; packaging/marketplace specification and scaffold recipe | Per-plugin/per-skill licenses; not uniformly permissive |

Counts are tracked files, not lines of code or a measure of quality. A disk snapshot of the first 17 clones was about 1.6 GiB including `.git`, with Skyvern about 604 MiB and n8n about 333 MiB. They were acquired but not built. The acquisition helper's license search is a bounded filename heuristic: it can include license-related source files and omit later matching licenses. The table uses inspected root declarations and relevant per-skill declarations; the ledger is not a completed redistribution audit. n8n's explicit split is [F08](software-browser-evidence.md#f08), MCP's transition is [P05](software-browser-evidence.md#p05). Anthropic's `README.md:20-24` explicitly distinguishes document skills from its open-source examples. OpenAI's old catalog defers licensing to each skill directory.

**Current-source correction.** `openai/skills` is deprecated at this pin. Its examples remain useful historical material, but a new Codex installer must inspect `openai/plugins` and client behavior rather than assume the old skill catalog remains the current packaging interface. The successor uses `.codex-plugin/plugin.json` plus optional skills, MCP, app, agent, command and hook surfaces and separate marketplace metadata. This is a packaging mechanism, not proof that every listed companion surface is implemented by every agent client. [S06](software-browser-evidence.md#s06), [S07](software-browser-evidence.md#s07), [S08](software-browser-evidence.md#s08).

## End-to-end control paths

### Codex: authority and tool execution are explicit subsystems

The inspected tool path receives a typed tool request and execution context, decides whether approval is forbidden, needed or skippable, selects a sandbox, dispatches the tool, and reports or retries its outcome. Network approval ownership follows the operation. The retry path handles a sandbox denial differently from an ordinary tool failure. It does not universally turn a failure into an unsandboxed rerun. A previously approved sandboxed attempt may still need a fresh review for a more permissive attempt. [C01](software-browser-evidence.md#c01), [C02](software-browser-evidence.md#c02).

Skill selection has independent identity rules: structured selections resolve enabled canonical or discovery paths before plain-name mentions; ambiguous names do not silently choose an arbitrary skill. Skill injection and implicit invocation instrumentation record what was selected or observed. A telemetry event saying a skill was invoked is weaker evidence than showing that the task's required behavior occurred. The observed code deduplicates invocation tracking per turn; this is not an audited proof that all skill content caches invalidate correctly. [C03](software-browser-evidence.md#c03), [C04](software-browser-evidence.md#c04).

**Transfer:** keep authority outside the model and preserve it through retries; resolve skills by stable identity and version; use skill-use telemetry for diagnostics, not acceptance. **Boundary:** this clone exposes the Codex CLI, not all cloud product behavior, private models or production infrastructure. The entire Codex implementation and its callers were not audited line by line.

### Symphony: a completed agent turn can leave the work item active

The reference runner starts from a tracker issue, prepares a workspace and workflow-derived prompt, launches a Codex app-server session, and runs bounded turns. After a completed turn it refreshes issue state before deciding whether to continue. Workspace hooks and session cleanup surround that lifetime. A maximum-turn stop can return control while the tracked issue remains active, so the orchestrator's continuation policy remains relevant. [C05](software-browser-evidence.md#c05).

The workflow loader separates YAML configuration from the prompt body and returns explicit missing-file or parse failures. These are configuration outcomes, not model task failures. The inspected path helper resolves filesystem components, but this alone is not a complete shell/network sandbox. [C06](software-browser-evidence.md#c06).

**Transfer:** represent turn completion, worker completion, tool completion and task acceptance as different events. Bind continuation to external task state and an overall budget. Do not interpret a returning runner function as an accepted task. **Boundary:** this is a reference orchestrator coupled to issue/workspace and app-server conventions; it is not a universal standalone workflow generator.

### mini-swe-agent: a useful low-complexity baseline with a strong environment dependency

The default loop formats the task, queries a model, executes returned actions in the chosen environment, appends observations and saves trajectory data. Before querying it checks accumulated resource use; format recovery and interrupts are explicit. A pre-call cost check cannot know an unbounded next response cost, so a production envelope also needs provider/output limits or reservation semantics. [C07](software-browser-evidence.md#c07).

The local environment runs shell commands and merges the process environment into the child environment. It recognizes a successful submission sentinel in command stdout. The sentinel indicates that the agent is submitting a result; it does not independently establish that a patch solves a bug. An evaluation must isolate the environment and inspect the resulting artifact with a separate oracle. [C08](software-browser-evidence.md#c08).

**Transfer:** include a simple single-agent loop in every complexity ablation. A large orchestration hierarchy must improve measured reliability enough to pay for extra calls and state. **Boundary:** local environment behavior is not a sandbox guarantee. Do not run untrusted research tasks against the user's home directory simply because the harness is small.

### SWE-agent: recovery can preserve an artifact without establishing success

The larger agent has typed recovery paths. Formatting, blocked actions and incorrect shell syntax can cause a corrected model query. Time, cost, context, environment and other failures may terminate with an attempted patch autosubmission. This salvages useful work while preserving the failure reason; downstream systems must keep those two facts separate. [C09](software-browser-evidence.md#c09).

The optional reviewer/chooser narrows candidate submissions and may ask a model to select among them. An invalid choice can fall back to the first candidate. A caller must not count the existence of a chosen candidate as proof that a valid comparison was made. Foundry's evaluation layer should record grader failure separately and leave the relevant comparison unknown. [C10](software-browser-evidence.md#c10).

**Transfer:** use error classes and separate repair budgets, preserve partial artifacts, retain why a run stopped and explicitly account for invalid evaluators. **Cost:** reviewer and retry loops add model calls and candidate storage. Multiple candidates also consume execution budget and increase benchmark exposure.

### Claude Agent SDK Python: public control plumbing around a delegated runtime

The transport finds a bundled or installed Claude CLI and handles streaming protocol I/O. The public SDK provides permission callbacks, hook routing, SDK-hosted MCP integration and task/control tracking. Reading this code is useful for lifecycle design, but it does not expose the complete delegated Claude agent implementation or make it a model-swappable baseline. [C11](software-browser-evidence.md#c11).

The task lifecycle code documents a race involving background-task bookkeeping and turn boundaries: task completion before a turn result can make an in-flight set appear empty even though a continuation can still follow. It also documents limitations around multiple streamed inputs and closing at an earlier turn boundary. These observations motivate explicit run-terminal signals and a bounded drain of active control work. They are source-documented concerns, not failures reproduced in this run. [C12](software-browser-evidence.md#c12).

**Transfer:** protocol transport success, task-set emptiness and terminal run state need distinct contracts. Keep permission response correlation and stale-response rejection outside generated prompts. **Boundary:** a public SDK license does not establish availability, redistribution rights or internals of the runtime it launches.

### Browser Harness: a reusable actuator surface, not an entire reasoning loop

The CLI accepts Python through stdin, establishes a local or explicitly configured remote daemon, installs helper tracing and executes the supplied code. Cloud auto-bootstrap is separately opted into; the mere existence of an API key is not sufficient. The MCP wrapper establishes the daemon, protects stdio protocol output and converts exceptions into tool errors. [B01](software-browser-evidence.md#b01), [B02](software-browser-evidence.md#b02).

Its exposed capabilities include normal interactions but also raw JavaScript, CDP methods, uploads and HTTP operations. Those differ substantially in authority. A screenshot tool returns path/size metadata in the inspected interface, so a client must not assume that it has received image pixels. The daemon tracks stale-session recovery tasks and cancels/drains them during shutdown with a bounded wait. [B03](software-browser-evidence.md#b03), [B04](software-browser-evidence.md#b04).

**Transfer:** separate typed actuator bindings from the planner; attach host policy to the actual authority of each tool; explicitly describe result media and lifecycle. **Boundary:** reconnecting a daemon does not reconstruct the workflow's business state, verify an earlier submission or restore a lost human approval.

### Browser Use: observation freshness, action batching and a separate judge field

An agent step refreshes browser context, clears stale previous-step outputs before requesting the next model output, executes actions, processes the result and records evidence. Screenshots are requested for trace support even in some configurations that do not use them for model reasoning. [B05](software-browser-evidence.md#b05).

The action batch has two page-change guards. Declared page-changing actions end the sequence; observed URL or focused-target changes also stop remaining actions. This reduces action execution against stale selector state. It does not make a stable URL a sufficient freshness test: same-URL DOM replacement, tenant changes and modal transitions remain useful falsifiers. [B06](software-browser-evidence.md#b06).

The run loop bounds steps and consecutive failures, integrates stop/pause behavior and places a deadline around initial actions. The optional judge consumes the trace and may fail independently. Its verdict is attached without replacing the agent's self-reported success. Foundry must keep self-report, model judgment and task-side acceptance in distinct fields. [B07](software-browser-evidence.md#b07), [B08](software-browser-evidence.md#b08).

**Transfer:** ground actions in versioned observations, invalidate a batch after material context changes, clear outputs before an attempt and preserve evaluator failure. **Cost:** repeated screenshots, extraction, judgment and large histories all consume resources. Their necessity should be measured against cheaper locators and deterministic checks.

### Stagehand: deterministic actions, model fallback and a private cache-service boundary

At this revision Stagehand's SDK communicates with an extension runtime through RPC. Initialization claims a browser resource. An ambiguous initialization failure invalidates the claimed browser rather than confidently returning it as reusable. This is a useful pattern for any resource whose acquisition can succeed while its response is lost. [B09](software-browser-evidence.md#b09).

The action service distinguishes a structured action from a natural-language instruction. Structured actions use deterministic execution; instruction handling captures page state and runs inference. Per-operation usage includes inference and self-healing. Failed deterministic actions can refresh a snapshot and attempt repair when configured. [B10](software-browser-evidence.md#b10), [B11](software-browser-evidence.md#b11).

The inspected cache client explicitly delegates DOM shaping/hash computation, URL normalization, project gating and Redis storage to an external API. An API key and session are required for that cache context. The public source therefore exposes cache decisions and replay behavior, not that entire cache implementation. Cache failure is best-effort and falls back to ordinary execution. [B12](software-browser-evidence.md#b12), [B13](software-browser-evidence.md#b13).

**Design inference to test:** cached action replay can perform an earlier action before a later one fails. A whole-operation fallback after partial replay could repeat an effect unless it reconciles the site's state. This is a counterexample candidate, not an upstream defect reproduced here. **Transfer:** cache artifacts must carry validation/invalidation conditions; replay failure is not evidence that no action occurred. **Boundary:** public SDK/cache-client inspection cannot support a claim of parity with the hosted cache service.

### Skyvern: workflow blocks have persistent lifecycle and stale-output concerns

The inspected safe-block path creates/updates workflow-run records, carries block context, executes the block, converts failures into structured results and handles artifacts. It explicitly clears stale output when a failed loop iteration would otherwise leave a prior iteration's result visible. Both unsuccessful returned results and exceptions matter. [B14](software-browser-evidence.md#b14).

The workflow service distinguishes cached script execution from agent execution and from script-to-agent fallback. A block can require the agent, be uncached or be a non-cacheable type independently of whether ordinary AI fallback is disabled. Fallback telemetry is only marked after that fallback path actually runs. These distinctions make hit rate, repair rate and correctness easier to interpret. [B15](software-browser-evidence.md#b15).

**Transfer:** outputs belong to a particular attempt and iteration; absence and failure must not reuse previous values. Cache statistics must distinguish an intentional agent path from repair after failed replay. **Cost:** this is a substantial application with database writes, browser state and service machinery. Its richer guarantees cannot be reproduced merely by copying a block's prompt into a skill.

### Agent-S: current S3 favors a direct worker with optional reflection

The current S3 entry point uses a non-hierarchical worker, configurable reflection and bounded trajectory retention. The repository contains older architectures too; attributing every historical manager/worker pattern to S3 would be misleading. [B16](software-browser-evidence.md#b16).

The worker combines a current screenshot, grounded task state, optional reflection and previous code-agent results. It requests a formatted single action and translates it to executable GUI code. Failed grounding/formatting can yield a wait action rather than task acceptance, so a bounded outer loop remains necessary. The comparative judge examines screenshots and captions; an invalid verdict leaves no selected trajectory. [B17](software-browser-evidence.md#b17), [B18](software-browser-evidence.md#b18).

**Transfer:** compare a direct actor against reflection and multi-candidate variants under equal budgets. A model replacement must preserve visual grounding and action-format compatibility, not only an API method signature. **Boundary:** a screenshot judge is not a deterministic application-state oracle, and the model's selected trajectory is not automatically correct.

## Skills, MCP and framework contracts

### Skill packaging and selection

Agent Skills defines a portable directory plus `SKILL.md` format, name/description constraints and progressive disclosure: small metadata at discovery, instructions on activation, supporting resources when needed. Its allowed-tools field is experimental. The format does not universally enforce permission, execution isolation, version freshness, trigger calibration or correctness. [S01](software-browser-evidence.md#s01), [S02](software-browser-evidence.md#s02).

Anthropic's skill-creation recipe pairs baseline and skill-assisted outputs, records cost/time and evaluates produced artifacts. Trigger optimization includes difficult negative near-misses. These are useful evaluation patterns. Its suggestion to draft some assertions while outputs are being generated is weaker than Foundry's required sealed oracle: comparison oracles must be frozen before candidate generation, and cases used to improve the skill must remain marked as development cases. [S03](software-browser-evidence.md#s03), [S04](software-browser-evidence.md#s04).

OpenAI's CI skill is deliberately narrow: it handles GitHub Actions checks and identifies other providers as outside that skill's implementation. This is a useful scope contract. It is not evidence that a generic skill already knows every CI system. The new plugin example format introduces additional manifests and client discovery behavior; a single installation command needs per-client adapters and a capability probe, not one copied directory layout. [S05](software-browser-evidence.md#s05), [S07](software-browser-evidence.md#s07), [S08](software-browser-evidence.md#s08).

**Foundry consequence:** a generator selects the minimum applicable skills by stable path/version, explains missing capabilities, and emits typed workflow proposals. Host-side validators determine whether those proposals can run. Skill discovery and task success need separate tests: positive/negative trigger cases for discovery, deterministic deployment cases for behavior.

### MCP boundaries and versioning

The inspected specification version is **2026-07-28**. A host must negotiate the actual supported version instead of combining one version's examples with another SDK's assumptions. Tool annotations are not trusted simply because they arrived through MCP. Structured results are server-produced JSON data, distinct from model structured output, and should be validated against declared schemas. [P01](software-browser-evidence.md#p01), [P02](software-browser-evidence.md#p02).

Protocol errors and tool-execution errors are separate channels. A successful JSON-RPC response can contain `isError: true`; a syntactically valid text payload can still fail the task. Unknown-tool errors, denied operations and invalid schemas should not be retried like transient network failures. [P03](software-browser-evidence.md#p03).

Cancellation behavior is transport-specific at this spec version. Streamable HTTP stream closure is a request-cancellation signal; stdio uses a cancellation notification. Either can race already completed or non-cancellable work. Progress may justify a per-request timeout policy, but a maximum deadline remains necessary. Cancellation is not a transaction rollback or an exactly-once guarantee. [P04](software-browser-evidence.md#p04).

**Foundry consequence:** the MCP adapter needs a typed capability registry, explicit authority, versioned request/result handling, bounded deadlines, unknown-effect status and target-side reconciliation. A generic `run_code` MCP method combines many operations but does not itself create a security boundary or prove their effects.

### LangGraph and LangChain lowering

LangGraph interrupts require a checkpointer and a stable thread context. On resume the interrupted node executes again from its beginning. Consequently an effect before the interrupt can execute twice unless separated or made durably idempotent. Ordered multiple interrupt sites also form a resume contract; changing their order is a workflow migration, not harmless refactoring. [F01](software-browser-evidence.md#f01).

An edge from a list of sources expresses an all-dependencies join. Independently adding incoming edges does not necessarily express the same barrier. Parallel outputs need suitable state/reducer semantics. Serializing an arbitrary graph silently can alter resource use, order, human-wait behavior and deadlines even if the final diagram looks similar. [F02](software-browser-evidence.md#f02).

LangChain's agent factory returns a compiled state graph around model/tool loops and middleware. Its response strategy can depend on model capabilities. Human-review middleware groups selected tool calls, validates the number of decisions and reconstructs their original order. Treating a list of decisions as an unbound generic approval value loses this correspondence. [F03](software-browser-evidence.md#f03), [F04](software-browser-evidence.md#f04).

**Foundry consequence:** preserve input/output and condition semantics, dependency joins, pause/restart behavior, error propagation and budgets. Prefer an explicitly qualified small export profile to an apparently executable translation that drops these guarantees. Model/provider replacement must be evaluated separately from graph compilation.

### n8n lowering

n8n's execution engine carries item data and execution-stack state. Its native retry policy clamps enabled retries to a bounded range and similarly bounds retry delays. A resumed sub-workflow error is specifically excluded from re-execution retries. Blindly copying Foundry retry fields can silently change their meaning. [F05](software-browser-evidence.md#f05).

Wait resumption modifies the execution stack, disables the waiting node when appropriate and removes its earlier run entry from displayed run data. This differs from LangGraph's node re-execution. The Execute Sub-workflow node has versioned parameter and input-mapping conventions; accepting all data requires a different representation from declaring mapped inputs. [F06](software-browser-evidence.md#f06), [F07](software-browser-evidence.md#f07).

**Foundry consequence:** use one explicit state envelope when translating a supported serial workflow, keep task bindings distinct from connector credentials, enforce or reject timeout/retry semantics, and verify output cardinality. An imported JSON file is structural evidence, not a successful n8n run. Human approval, effect reconciliation, loops and parallel joins should remain unsupported until their semantics and replay behavior are exercised on the target runtime.

## Cross-system contracts and falsifiers

The following are requirements deduced from the cited paths. They are not claims that every upstream system violates them. Proposed tests are test designs unless accompanied by an actual test receipt elsewhere in Foundry.

| Principle and evidence | When it applies | Counterexample to test | Executable validation | Cost / tradeoff |
|---|---|---|---|---|
| Distinct terminal events: C05, C12, B07 | Multi-turn, background or judged tasks | Turn returns while continuation or task requirement remains | Feed ordered completion/control events; require run-terminal plus oracle | More lifecycle state and bounded draining |
| Retry preserves authority: C01–C02 | Sandbox/network escalation | First attempt approved, second requests broader authority | Fake tool denies sandbox; verify no expanded call without matching policy | Approval latency when authority changes |
| Submission is an artifact: C08–C10 | Code patch generation | Sentinel/partial patch exists but regression still fails | Reproduce original defect against final patch and require oracle failure | Extra validation execution |
| Fresh browser grounding: B05–B06 | Queued interactions | Same URL but different tenant, modal or target | Fixture mutates DOM/context between actions; next action must reobserve or stop | Extra observations and shorter batches |
| Uncertain effects reconcile: B11–B13, P04 | Cached replay, response loss, timeout | First action commits, second fails, fallback repeats first | Stub server records operation IDs and drops reply; assert no blind duplicate | Receipt storage and reconciliation calls |
| No stale iteration output: B14 | Loops and repeated extraction | Row 2 fails and inherits row 1's output | Inject second-iteration failure; require absent/failed value | Per-attempt identity and clearing |
| Cache provenance is explicit: B12–B15 | Replay and skill reuse | A hit uses an old schema or changed account context | Mutate each cache-key dependency; demand miss or revalidation | Key construction, version tracking |
| Invalid judge stays unknown: C10, B07, B18 | Candidate ranking | Judge timeout, malformed choice or self-report mismatch | Corrupt judge response; forbid a pass or inferred winner | Some comparisons remain inconclusive |
| Pause sites are effect-free: F01, F04 | Human answers/approval | Resume executes a write preceding the pause again | Interrupt/resume fixture counts effect calls and checks answer identity | Additional nodes/checkpoints |
| Joins and item cardinality are preserved: F02, F07 | Framework export | Fan-in starts early or sub-workflow returns zero/many items | Delayed branch and cardinality fixtures; reject ambiguous result | Explicit reducers/envelopes or smaller supported subset |
| Retry budgets are not silently clamped: F05 | Framework export | A requested one-attempt or long-backoff policy changes | Compare target plan with IR; export must reject unsupported values | Fewer exported workflows until adapters improve |
| Skill use is not permission or success: C03–C04, S01–S08 | Generic skill installation | Skill loads but tool absent, denied or wrong version | Trigger test plus missing-capability and wrong-version fixtures | Host-specific installers/probes |
| MCP result status is interpreted: P02–P03 | Tool adapters | Transport succeeds with `isError: true` or wrong schema | Protocol fixtures with all result/error forms | Validation code and schema/version compatibility work |
| Simpler control remains a baseline: C07, B16–B18 | Adding planners/reflection/agents | Extra calls improve self-confidence but not held-out success | Same-task, same-model, equal-budget ablation | Evaluation time; avoids unproductive runtime cost |

## Comparison suitability and experimental controls

**Suitable source-level baselines.** mini-swe-agent gives a small software loop; SWE-agent adds recovery/review complexity; Browser Use and Agent-S expose model-driven execution and grounding; Stagehand exposes deterministic-versus-inference actions; Skyvern exposes workflow/script fallback. They support different task distributions and action spaces. Benchmarking all of them with one undifferentiated task list would confound harness quality with tools, vision, environment and domain suitability.

**Qualified rather than interchangeable baselines.** Symphony is an issue/workspace orchestrator around another agent. Browser Harness is primarily an actuator/helper layer. LangGraph, LangChain and n8n are composition substrates. Skills and MCP are packaging/protocol layers. The Claude SDK delegates core execution to a proprietary CLI. Hosted browser infrastructure and private Stagehand cache internals were not acquired. Compare Foundry against the layer it is replacing, and record layers still supplied by the baseline.

**Model substitution.** A supported model interface is necessary but insufficient. Preserve tool-call syntax, multimodal/grounding requirements, response-schema strategy, context limits, stop events, costs and credential scope. A “same model” run must pin the exact observed provider/model identifier and relevant settings. The architect that designs a workflow and the executor that runs it are separate variables. No cheap-model parity claim follows from source inspection or from a workflow that only validates structurally.

**Protocol for a fair local comparison.** Freeze task inputs, starting repository/browser state, external acceptance oracle, allowed tools, wall-time/call/cost limits and human assistance before generating candidates. Run at least no-skill, generic-skill and generic-plus-domain-skill conditions with identical executors and trusted tools. Record native baseline variants separately, including reflection, reviewers, cache state and multi-candidate selection. Count failed generations, unsupported exports, missing prerequisites and invalid graders; do not drop them from denominators without reporting the rule. Keep development cases and held-out cases separate. Reuse a saved workflow on changed but in-envelope tasks to measure generalization rather than memorization.

**Measurements.** Track deterministic task acceptance, false-success frequency, uncertainty/abstention, tool/model calls, wall time, estimated and measured cost, human interventions, repair cycles, and peak resource use where measurable. Measure cold and warm caches separately. Distinguish an agent's final text, a judge's verdict, a transported artifact and an oracle's decision. Avoid claims about all worst cases; enumerate the tested envelope and the failure families still uncovered.

**Deployment and licensing.** Corpora remain inert. Installing a baseline is a separate scoped action with an isolated environment, pinned dependencies, no credential inheritance and no real side effects. The source-available n8n and vendor-specific skill material should not be redistributed as Foundry content merely because they can be cloned. Foundry's skills are original synthesis with provenance references. No upstream implementation was copied into the runtime by this dossier.

## Requirements extracted for Foundry

Support status below is **source-backed requirement**, not proof of Foundry implementation. Runtime and adapter test reports must establish implementation support independently.

| ID | Requirement and rationale | Evidence | Enforcement owner | Falsifying check |
|---|---|---|---|---|
| SW-01 | Acceptance identifies the exact artifact/revision tested, independent of submission status | C08–C10 | Runtime/evaluator; skill chooses oracle | Old-revision result is presented for changed patch |
| SW-02 | Distinguish turn, task, tool and accepted-run completion | C05, C12 | Runtime/protocol adapter | Pending continuation survives apparent turn completion |
| SW-03 | Preserve typed stop reasons and partial artifacts | C09 | Runtime and evidence store | Timeout patch is classified as accepted |
| SW-04 | Preserve approval scope across sandbox/network retries | C01–C02 | Trusted capability host | Retry receives broader authority from old approval |
| SW-05 | Resolve skill identity/version and reject ambiguous selection | C03–C04 | Installer/discovery; skill metadata assists | Duplicate names silently select a different skill |
| SW-06 | Compare direct single-agent execution with added reviewers/workers | C07, C10 | Evaluation design | Higher cost receives credit without task improvement |
| BR-01 | Bind each action to current page/tab/frame/account context | B05–B06 | Browser binding and runtime | Context changes while queued action still runs |
| BR-02 | Separate browser actuator capabilities by actual authority | B01–B03 | Trusted capability host | Raw CDP bypasses a narrow click-only permission |
| BR-03 | Clear or invalidate output per attempt and iteration | B05, B14 | Runtime/state store | Failed attempt exposes previous attempt's output |
| BR-04 | Reconcile partial replay and unknown effects before retry | B11–B13, P04 | Effect-aware runtime/tool binding | Lost response produces duplicate submission |
| BR-05 | Distinguish cache hit, miss, intentional agent path and repair | B12–B15 | Cache/runtime telemetry | Intentional agent execution is counted as cache failure |
| BR-06 | Preserve self-report, judge and task-side oracle separately | B07, B18 | Evaluator/evidence schema | Judge unavailable becomes pass |
| BR-07 | Resume human takeover only after re-observing browser state | B06, F01 | Browser binding plus skill plan | Human changes tab while old locator is reused |
| BR-08 | Treat visual/caption judges as fallible evaluators | B17–B18 | Evaluation layer | Plausible screenshot hides incorrect persisted record |
| SK-01 | Portable skill metadata is small; details load on demand | S01–S02 | Skill authoring/client adapter | Entire corpus is injected at every task |
| SK-02 | Trigger tests include difficult adjacent-domain negatives | S04 | Skill evaluation | Keyword overlap activates wrong-domain workflow |
| SK-03 | Freeze behavior oracles before generation and reserve held-out tasks | S03 plus Foundry research contract | Evaluation governance | Iterated development case is reported as unseen |
| SK-04 | Installing a skill does not grant tool authority | S02, P01 | Host/client adapter | Skill text changes policy or allowed capabilities |
| SK-05 | Installation probes client-specific manifests and actual capabilities | S06–S08 | Installer | Catalog presence is reported as installed/usable capability |
| MCP-01 | Negotiate protocol version and validate tool/result schema | P01–P03 | MCP adapter | Old-version result is accepted under new schema assumptions |
| MCP-02 | Cancellation requested, confirmed and effect unknown remain distinct | P04 | Runtime/MCP adapter | Stream closure is treated as a rolled-back transaction |
| FW-01 | Export rejects unsupported semantics before creating a misleading executable | F01–F07 | Export validator | Map, retry or permission semantics disappear silently |
| FW-02 | Human pause and resume preserve ordering and answer identity | F01, F04 | Runtime/adapter | Stale or reordered answer resumes a different action |
| FW-03 | Dependency joins and item cardinality match the declared graph | F02, F07 | Compiler/adapter | Child returns multiple items or starts before all dependencies |
| FW-04 | Time, step, concurrency, retry and cost budgets survive target lowering | F05–F06, C07 | Runtime/adapter | Framework defaults clamp, renew or ignore a bound |
| FW-05 | Preserve reference/default/skip/output semantics across languages | B14, F02, F07 | Compiler/adapter | Skipped node becomes `null` output instead of absent |
| EV-01 | Documentation, inspected code and executed behavior have separate evidence classes | C11, B12, all registry records | Evidence store/reporting | Public SDK inspection is called hosted-product parity |

The accompanying original skills are [`domain-software`](../../skills/domain-software/SKILL.md) and [`domain-browser`](../../skills/domain-browser/SKILL.md). They teach workflow construction and recovery choices. They intentionally defer enforceable authority, persistence, schema checks and completion decisions to the host and runtime. Framework skills and export capability matrices document a separate, qualified implementation surface; they must not upgrade this source inspection into benchmark evidence.
