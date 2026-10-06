import { FoundryError } from './data.mjs';

const TEMPORAL_MARKER = 'HELD_OUT_TEMPORAL_DURABLE_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';
const RESTATE_MARKER = 'HELD_OUT_RESTATE_SERVICES_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';
const INNGEST_MARKER = 'HELD_OUT_INNGEST_STEPS_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';
const FIN_MARKER = 'HELD_OUT_INTERCOM_FIN_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';

const SERVICE_TYPES = Object.freeze(['basic-service', 'virtual-object', 'workflow']);
const FIN_HIGH_RISK = Object.freeze(['financial', 'jailbreak', 'legal', 'medical', 'minors', 'self-harm']);
const QUERY_CLASSES = Object.freeze(['action-led', 'informational', 'personalized']);
const IR_NODE_KINDS = Object.freeze(['human', 'task', 'wait']);

export const FOUNDRY_IR_LIMITS = Object.freeze({
  delayMsMax: 3600000,
  budgetSchemaMaxMs: 2592000000,
  budgetPolicyCapMs: 3600000,
  timerDispatch: 'persisted-wake-reinvoke',
  compensateKind: false,
  continueAsNew: false,
  waitCrashRestartsDeadline: true,
  singleWriterPerKey: false,
  eventCronTrigger: false,
  constructionDrivesGenerator: false
});

export const DURABLE_MOTIFS = {
  'temporal-durable': [
    {
      id: 'workflow-deterministic-replay',
      why: 'Temporal docs (workflow-execution, retry-policies): a Workflow Execution is recovered by replaying event history. Workflow code must be deterministic; HTTP, clocks, random and LLM calls are not workflow code. Replay is not “restart the function and hope”. Observed: Commands generated during replay are checked against existing Event History.',
      inspect: c => c.workflow?.deterministic === true && c.workflow?.ioAllowed === false && c.workflow?.replay === 'event-history'
    },
    {
      id: 'activities-retry-not-workflow',
      why: 'Temporal retry-policies encyclopedia: Activities retry by default (transient/intermittent). Workflow Executions do not retry by default. Retrying the whole workflow replays the same deterministic path and does not fix a permanent failure. Side effects live in Activities, which are expected to be idempotent.',
      inspect: c => c.activities?.retryDefault === true && c.workflow?.retryDefault === false && c.activities?.idempotent === true
    },
    {
      id: 'durable-timer-not-sleep',
      why: 'Temporal TypeScript timers docs: Workflow sleep/timer is persisted. A Worker or Temporal Service can be down for the whole delay; when both are back the timer resolves. Sleep does not tie up the process; millions of timers can run on one Worker. process.sleep / holding a thread is the thing they refused. Dispatch is the Temporal timer service, not a process sleep and not “the worker will re-invoke later if someone remembers”.',
      inspect: c => c.wait?.kind === 'durable-timer' && c.wait?.holdsProcess === false && c.wait?.dispatch === 'timer-service'
    },
    {
      id: 'hitl-as-signal',
      why: 'Temporal workflow-message-passing: HITL is a Signal (async write), Query (non-blocking read) or Update (sync tracked write) against a running Workflow Execution. A chat message into an LLM loop is not this channel; the wait must survive Worker death because the Workflow is the durable object.',
      inspect: c => c.hitl?.kind === 'signal' && c.hitl?.survivesWorkerDeath === true && c.hitl?.query === true
    },
    {
      id: 'continue-as-new-unbounded',
      why: 'Temporal workflow-execution: a single Execution is size-limited. Unbounded or long-running work Continue-As-New (new run, same Workflow Id, truncated history). Growing one event history forever is the failure mode.',
      inspect: c => c.continueAsNew === true
    },
    {
      id: 'saga-compensation-lifo',
      why: 'Temporal saga-pattern guide: when forward progress is impossible (policy, cancellation), unwind side-effecting steps through a LIFO compensation stack. Compensation failures use the same pause-and-fix loop so a stuck rollback does not leave a partial unwind. Catch-and-ignore is not compensation.',
      inspect: c => c.compensation?.kind === 'saga-lifo' && c.compensation?.failure === 'pause-and-fix'
    }
  ],
  'restate-services': [
    {
      id: 'three-service-types',
      why: 'Restate docs/foundations/services: three types, not one workflow/activity shape. Basic Service = stateless durable handlers. Virtual Object = keyed entity, single writer per key. Workflow = exactly-once run handler per ID plus shared handlers. Folding carts, sessions and agents into a Temporal-style workflow is the mapping they refuse.',
      inspect: c => Array.isArray(c.serviceTypes) && SERVICE_TYPES.every(t => c.serviceTypes.includes(t)) && c.foldsEverythingIntoWorkflow === false
    },
    {
      id: 'virtual-object-single-writer',
      why: 'Same page: Virtual Objects serialize write access per key (queue-per-key) while running concurrently across keys and allowing concurrent shared (read-only) handlers. Two writers on the same cart/session/agent is the race they removed from application code.',
      inspect: c => c.virtualObject?.singleWriterPerKey === true && c.virtualObject?.sharedHandlersConcurrent === true
    },
    {
      id: 'ctx-run-journaled-steps',
      why: 'Restate what-is-durable-execution + services examples: wrap side effects in ctx.run(); the journal is the source of truth. Crash recovery replays completed steps from the journal and does not re-execute them. Restate claims handlers are plain async — the journal, not a determinism discipline on the whole function, is the recovery mechanism.',
      inspect: c => c.steps?.kind === 'ctx.run' && c.steps?.replayCompleted === true && c.steps?.reexecuteCompleted === false
    },
    {
      id: 'awakeable-hitl',
      why: 'Restate vs Temporal page + workflow example: external resolvers (approvals, email-link clicks) are awakeables or durable promises, not chat into an LLM. Signup workflow waits on ctx.promise; a shared handler resolves it. Worker death must not drop the wait.',
      inspect: c => c.hitl?.kind === 'awakeable-or-promise' && c.hitl?.survivesWorkerDeath === true
    },
    {
      id: 'keyed-state-not-history-spill',
      why: 'Restate vs Temporal: Virtual Object K/V is keyed durable state in the runtime. Temporal holds state in workflow variables and spills to an external DB when event history grows. Restate’s named refusal is “no continue-as-new, no external store for entity state”.',
      inspect: c => c.state?.kind === 'keyed-kv' && c.state?.externalDbForEntity === false
    }
  ],
  'inngest-steps': [
    {
      id: 'step-memoization',
      why: 'Inngest how-functions-are-executed: each step is a unit of work that will not be re-executed if it already succeeded; its result is memoized in a managed function state store. The function then resumes from the top and the SDK injects prior step data. Re-running completed work on crash is the thing they removed.',
      inspect: c => c.steps?.memoizeCompleted === true && c.steps?.reexecuteCompleted === false && c.steps?.eachStepSeparateRequest === true
    },
    {
      id: 'nondeterministic-in-step-run',
      why: 'Same page callout: each step executes as a separate HTTP request. Non-deterministic logic (DB, API) MUST be inside step.run() so it is not re-fired when the handler is replayed from the top. Putting fetch() in the handler body is an execution bug, not a style choice.',
      inspect: c => c.steps?.nonDeterministicMustBeInStep === true
    },
    {
      id: 'durable-sleep',
      why: 'Inngest durable execution: sleeps and waits persist outside the invocation. Holding the serverless request open for a 30-day delay is the failure mode of non-durable functions.',
      inspect: c => c.wait?.kind === 'durable-sleep' && c.wait?.holdsProcess === false
    },
    {
      id: 'no-user-managed-workers',
      why: 'Same page: no queues to configure, no workers to deploy, no infra to manage. Functions run on the user’s compute, including serverless. Temporal’s worker-pool model is a different product; claiming Inngest requires you to run a worker fleet is the wrong reconstruction.',
      inspect: c => c.workers?.userManages === false && c.workers?.compute === 'your-own-including-serverless'
    },
    {
      id: 'event-driven-trigger',
      why: 'Inngest functions are triggered by events (and crons), not by a poll loop inside an agent. The example import-contacts function triggers on contacts/csv.uploaded.',
      inspect: c => c.trigger?.kind === 'event'
    }
  ],
  'intercom-fin': [
    {
      id: 'refine-then-route-before-llm',
      why: 'Intercom Fin AI Engine help (2026-05-14): Phase 1 refines the query AND checks whether a Workflows automation or Custom Answer should trigger, plus safety filters, BEFORE the LLM generates. A wrapper that sends the raw ticket to a model first is the cheaper approach they named as the hallucination failure.',
      inspect: c => c.preLlm?.refineQuery === true && c.preLlm?.checksWorkflowsAndCustomAnswers === true && c.preLlm?.safetyFilter === true && c.preLlm?.llmFirst === false
    },
    {
      id: 'rag-not-bare-llm',
      why: 'Same article Phase 2: bespoke RAG (retrieve from approved content/data/actions, augment, then generate). Low certainty → clarify, do not send. Distinct from Sierra’s supervisor constellation: Fin’s answering engine is retrieval-grounded, not “model plus output intercept”.',
      inspect: c => c.generate?.kind === 'rag' && c.generate?.lowConfidence === 'clarify' && c.generate?.bareLlm === false
    },
    {
      id: 'validate-after-generate',
      why: 'Phase 3: after generation, check confidence, accuracy, and grounding in knowledge sources as source of truth. Ungrounded output is not sent. Model self-attestation is not this gate.',
      inspect: c => c.validate?.afterGenerate === true && c.validate?.ungrounded === 'do-not-send'
    },
    {
      id: 'high-risk-handoff',
      why: 'Fin AI Agent explained: Fin always hands off when it detects high-risk content including self-harm, harmful content involving minors, jailbreak attempts, or high-risk medical, legal, or financial advice. The model does not get to “handle it carefully”.',
      inspect: c => Array.isArray(c.escalate?.highRisk) && FIN_HIGH_RISK.every(x => c.escalate.highRisk.includes(x)) && c.escalate?.owner === 'human'
    },
    {
      id: 'procedures-not-consultingware',
      why: 'Intercom 2026-04-14 “The hardest percentages”: informational Q&A is not the hard problem. Action-led queries (refund, damaged order) are Procedures — a product CX ops owns (SOP editor, branching, connectors, simulations), not a forward-deployed engineer’s bespoke prompt. Consultingware is the named industry failure.',
      inspect: c => c.actionLed?.kind === 'procedures' && c.actionLed?.consultingware === false && c.actionLed?.owner === 'cx-ops'
    },
    {
      id: 'query-classes-three',
      why: 'Same post: every query is informational (text from knowledge), personalized (user-unique data), or action-led (multi-system process). Treating all three as one chat completion is the wrapper they refused.',
      inspect: c => Array.isArray(c.queryClasses) && QUERY_CLASSES.every(x => c.queryClasses.includes(x))
    }
  ]
};

export const INTENT_MOTIFS = {
  'intent:durable-business-process': [
    {
      id: 'side-effects-isolated-from-replay',
      why: 'Cross-family (Temporal Activities, Restate ctx.run, Inngest step.run, Foundry task nodes): crash recovery must replay recorded results of completed side effects, not re-fire them. An LLM loop that retries the whole conversation re-charges the card.',
      inspect: c => c.orchestration?.retryWholeWorkflow === false && c.orchestration?.sideEffects !== 'in-orchestrator' && ['task-nodes', 'activities', 'ctx.run', 'step.run'].includes(c.orchestration?.sideEffects) && c.orchestration?.sideEffectsIdempotent === true
    },
    {
      id: 'durable-timer-not-process-sleep',
      why: 'Temporal timers, Inngest durable sleep, Foundry wait with persisted wakeAt: a 30-day wait cannot hold a process. process.sleep dies with the box. Honest Foundry limit: schema delayMs max is 1 hour, so a production lattice still requires maxDelay unbounded-or-months at the protocol layer even if the current IR field cannot hold 30 days.',
      inspect: c => c.wait?.kind === 'durable-timer' && c.wait?.holdsProcess === false && c.wait?.maxDelay === 'unbounded-or-months' && ['timer-service', 'persisted-wake-reinvoke'].includes(c.wait?.dispatch)
    },
    {
      id: 'hitl-survives-worker-death',
      why: 'Temporal Signal, Restate awakeable, Foundry human node (awaiting_human in the run event log), Harvey fresh-worker-from-run-record: approval is a durable wait, not a chat turn in an in-memory agent.',
      inspect: c => c.hitl?.survivesWorkerDeath === true && ['signal', 'awakeable-or-promise', 'human-node'].includes(c.hitl?.kind)
    },
    {
      id: 'compensate-irreversible-effects',
      why: 'Temporal saga guide: pay/ship/provision must unwind LIFO on cancel. Coding-agent “just retry the session” leaves money moved. Compensation failure must pause-and-fix, not catch-and-ignore.',
      inspect: c => c.compensation?.kind === 'saga-lifo' && c.compensation?.onCancel === 'compensate' && c.compensation?.failure === 'pause-and-fix'
    },
    {
      id: 'workers-ephemeral-history-durable',
      why: 'Temporal workers, Harvey Spectre run-record, Cursor cloud Temporal loop, Foundry run event log: the process is not the durable object. In-process agent memory is the thing every durable-execution vendor removed.',
      inspect: c => c.workers?.kind === 'ephemeral' && ['event-history', 'journal', 'run-event-log', 'keyed-kv'].includes(c.workers?.state)
    },
    {
      id: 'not-a-coding-agent-loop',
      why: 'Anti-overfit: mini-SWE / Codex / Copilot loops optimize bash, context, and stop tokens. A claims-processing or refund workflow that emits bash-only + linear LM history is the wrong product, even if schema-valid.',
      inspect: c => c.shape !== 'coding-agent-loop' && c.orchestration?.kind !== 'llm-loop' && !(Array.isArray(c.actions) && c.actions.some(a => a.kind === 'bash'))
    },
    {
      id: 'retries-bounded-poison-parks',
      why: 'Temporal retry-policies encyclopedia: Activity retries are bounded (maxAttempts / backoff); unbounded retry of a permanent failure is a poison message that burns workers. Restate/Inngest park or dead-letter exhausted invocations. A coding-agent “just retry the session” is the opposite.',
      inspect: c => c.retries?.unbounded === false && ['park', 'dead-letter', 'pause-and-fix'].includes(c.retries?.exhausted)
    },
    {
      id: 'in-flight-code-pinned',
      why: 'Temporal Worker Deployment Versioning / getVersion: in-flight executions must complete on the code they started with (or a compatible patch). Shipping new workflow code over open runs is a replay break. Restate versions services the same way. An LLM session has no in-flight pin.',
      inspect: c => c.versioning?.inFlightPinned === true
    },
    {
      id: 'ir-limits-named-not-papered',
      why: 'Foundry workflow IR is not Temporal. schema delayMs maximum is 3600000 (1 hour); budget schema allows 2592000000 but runtime policyDefaults cap maxDurationMs at 3600000; there is no compensate node kind and no continue-as-new; wait dispatch is persisted-wake-reinvoke (someone must re-invoke execute); recover() only resets running task nodes, so a wait crashed between charge and waiting restarts wakeAt from Date.now()+delayMs. A construction that papers over these limits as if the IR were a timer-service saga engine is a lie. Protocol maxDelay unbounded-or-months still lives on wait.*, not by claiming delayMs can hold 30 days.',
      inspect: c => c.ir?.kind === 'foundry-workflow' && c.ir?.delayMsMax === 3600000 && c.ir?.compensateKind === false && c.ir?.continueAsNew === false && c.ir?.timerDispatch === 'persisted-wake-reinvoke' && c.ir?.waitCrashRestartsDeadline === true && c.ir?.budgetPolicyCapMs === 3600000
    }
  ],
  'intent:coding-agent-session': [
    {
      id: 'host-owns-stop',
      why: 'mini-SWE completion token+returncode, OpenHands host stuck-detector, Copilot stop hooks: the host decides the session is done. Model-says-done is the naive reconstruction.',
      inspect: c => c.stop?.owner === 'host' && c.stop?.modelSaysDone !== true
    },
    {
      id: 'untrusted-exec-isolated',
      why: 'Devin microVM, Factory Droid sandbox, Agency secrets-outside-sandbox: generated code is untrusted. A durable business workflow does not need a microVM; a coding agent that inherits the user’s shell does.',
      inspect: c => c.isolation?.untrustedExec === true
    },
    {
      id: 'saga-not-required',
      why: 'Anti-overfit the other way: a coding session is not an invoice saga. Requiring LIFO compensation on every SWE harness would reject mini-SWE for a motif that is not its ideology.',
      inspect: c => c.compensation?.kind !== 'saga-lifo' || c.compensation?.required === false
    }
  ],
  'intent:cx-supervised-conversation': [
    {
      id: 'pre-llm-or-input-filter',
      why: 'Fin Phase 1 (workflows/custom answers/safety before LLM) and Sierra input-filter supervisors: the raw user utterance is not the model prompt.',
      inspect: c => c.preLlm?.llmFirst === false || (c.supervisors ?? []).some(s => s.role === 'input-filter')
    },
    {
      id: 'post-generate-gate',
      why: 'Fin validate-after-generate and Sierra output-intercept: ungrounded or policy-violating text is not sent. Distinct mechanisms, same ideology — the model is not the last gate.',
      inspect: c => c.validate?.afterGenerate === true || (c.supervisors ?? []).some(s => s.role === 'output-intercept')
    },
    {
      id: 'high-risk-not-model-owned',
      why: 'Fin automatic handoff on medical/legal/financial/self-harm/minors/jailbreak. A coding-agent “just ask the model to be careful” fails CX production.',
      inspect: c => c.escalate?.owner === 'human' && Array.isArray(c.escalate?.highRisk) && c.escalate.highRisk.includes('medical')
    },
    {
      id: 'actions-are-procedures-or-guardrails',
      why: 'Fin Procedures (CX-ops-owned SOPs) and Sierra deterministic guardrails (30-day return): refunds are not a free-form tool loop.',
      inspect: c => c.actionLed?.kind === 'procedures' || c.guardrails?.kind === 'deterministic'
    }
  ],
  'intent:graph-automation': [
    {
      id: 'nodes-plus-connections',
      why: 'n8n: a workflow is a nodes+connections graph, not a linear agent step list. Zapier/Lindy sit in this class; they are not a second coding harness.',
      inspect: c => c.topology?.kind === 'nodes-connections'
    },
    {
      id: 'per-node-error-join',
      why: 'n8n continueOnFail / onError is a per-node join policy, not graph-wide try/catch and not fail-the-run.',
      inspect: c => (c.nodes ?? []).some(n => n.continueOnFail === true || ['continueRegularOutput', 'continueErrorOutput'].includes(n.onError ?? ''))
    },
    {
      id: 'separate-error-path',
      why: 'n8n Error Trigger is a published separate workflow, not an in-graph catch node. Durable graph automation keeps failure inspectable as its own run.',
      inspect: c => c.errorHandling?.kind === 'separate-error-workflow'
    }
  ]
};

const GOLD_TEMPORAL = {
  schemaVersion: '1.0', id: 'temporal-durable-harness', familyId: 'temporal-durable',
  workflow: { deterministic: true, ioAllowed: false, retryDefault: false, replay: 'event-history' },
  activities: { retryDefault: true, idempotent: true },
  wait: { kind: 'durable-timer', holdsProcess: false, dispatch: 'timer-service' },
  hitl: { kind: 'signal', query: true, update: true, survivesWorkerDeath: true },
  continueAsNew: true,
  compensation: { kind: 'saga-lifo', failure: 'pause-and-fix' },
  workers: { kind: 'ephemeral', state: 'event-history' },
  transactions: { stateAndTimerAndQueue: true }
};

const NAIVE_TEMPORAL = {
  schemaVersion: '1.0', id: 'temporal-durable-harness', familyId: 'temporal-durable',
  workflow: { deterministic: false, ioAllowed: true, retryDefault: true, replay: 'restart-from-scratch' },
  activities: { retryDefault: false, idempotent: false },
  wait: { kind: 'process-sleep', holdsProcess: true, dispatch: 'none' },
  hitl: { kind: 'chat-message', query: false, update: false, survivesWorkerDeath: false },
  continueAsNew: false,
  compensation: { kind: 'none' },
  workers: { kind: 'in-process', state: 'in-process' },
  transactions: { stateAndTimerAndQueue: false },
  claimedMotifs: ['workflow-deterministic-replay', 'activities-retry-not-workflow', 'durable-timer-not-sleep', 'hitl-as-signal', 'continue-as-new-unbounded', 'saga-compensation-lifo'],
  selfAttestedSuccess: true
};

const GOLD_RESTATE = {
  schemaVersion: '1.0', id: 'restate-services-harness', familyId: 'restate-services',
  serviceTypes: ['workflow', 'basic-service', 'virtual-object'],
  foldsEverythingIntoWorkflow: false,
  virtualObject: { singleWriterPerKey: true, sharedHandlersConcurrent: true },
  steps: { kind: 'ctx.run', replayCompleted: true, reexecuteCompleted: false },
  hitl: { kind: 'awakeable-or-promise', survivesWorkerDeath: true },
  state: { kind: 'keyed-kv', externalDbForEntity: false },
  workers: { kind: 'ephemeral', state: 'journal' }
};

const NAIVE_RESTATE = {
  schemaVersion: '1.0', id: 'restate-services-harness', familyId: 'restate-services',
  serviceTypes: ['workflow'],
  foldsEverythingIntoWorkflow: true,
  virtualObject: { singleWriterPerKey: false, sharedHandlersConcurrent: false },
  steps: { kind: 'plain-await', replayCompleted: false, reexecuteCompleted: true },
  hitl: { kind: 'chat-message', survivesWorkerDeath: false },
  state: { kind: 'workflow-variables', externalDbForEntity: true },
  workers: { kind: 'in-process', state: 'in-process' },
  claimedMotifs: ['three-service-types', 'virtual-object-single-writer', 'ctx-run-journaled-steps', 'awakeable-hitl', 'keyed-state-not-history-spill'],
  selfAttestedSuccess: true
};

const GOLD_INNGEST = {
  schemaVersion: '1.0', id: 'inngest-steps-harness', familyId: 'inngest-steps',
  steps: { memoizeCompleted: true, reexecuteCompleted: false, eachStepSeparateRequest: true, nonDeterministicMustBeInStep: true },
  wait: { kind: 'durable-sleep', holdsProcess: false },
  workers: { userManages: false, compute: 'your-own-including-serverless' },
  trigger: { kind: 'event' }
};

const NAIVE_INNGEST = {
  schemaVersion: '1.0', id: 'inngest-steps-harness', familyId: 'inngest-steps',
  steps: { memoizeCompleted: false, reexecuteCompleted: true, eachStepSeparateRequest: false, nonDeterministicMustBeInStep: false },
  wait: { kind: 'process-sleep', holdsProcess: true },
  workers: { userManages: true, compute: 'managed-worker-fleet' },
  trigger: { kind: 'poll-loop' },
  claimedMotifs: ['step-memoization', 'nondeterministic-in-step-run', 'durable-sleep', 'no-user-managed-workers', 'event-driven-trigger'],
  selfAttestedSuccess: true
};

const GOLD_FIN = {
  schemaVersion: '1.0', id: 'intercom-fin-harness', familyId: 'intercom-fin',
  preLlm: { refineQuery: true, checksWorkflowsAndCustomAnswers: true, safetyFilter: true, llmFirst: false },
  generate: { kind: 'rag', lowConfidence: 'clarify', bareLlm: false },
  validate: { afterGenerate: true, ungrounded: 'do-not-send' },
  escalate: { highRisk: ['self-harm', 'minors', 'jailbreak', 'medical', 'legal', 'financial'], owner: 'human' },
  actionLed: { kind: 'procedures', consultingware: false, owner: 'cx-ops' },
  queryClasses: ['informational', 'personalized', 'action-led']
};

const NAIVE_FIN = {
  schemaVersion: '1.0', id: 'intercom-fin-harness', familyId: 'intercom-fin',
  preLlm: { refineQuery: false, checksWorkflowsAndCustomAnswers: false, safetyFilter: false, llmFirst: true },
  generate: { kind: 'bare-llm', lowConfidence: 'send-anyway', bareLlm: true },
  validate: { afterGenerate: false, ungrounded: 'send' },
  escalate: { highRisk: [], owner: 'model' },
  actionLed: { kind: 'free-form-tools', consultingware: true, owner: 'forward-deployed-engineer' },
  queryClasses: ['chat'],
  claimedMotifs: ['refine-then-route-before-llm', 'rag-not-bare-llm', 'validate-after-generate', 'high-risk-handoff', 'procedures-not-consultingware', 'query-classes-three'],
  selfAttestedSuccess: true
};

export const DURABLE_NAIVE = {
  'temporal-durable': NAIVE_TEMPORAL,
  'restate-services': NAIVE_RESTATE,
  'inngest-steps': NAIVE_INNGEST,
  'intercom-fin': NAIVE_FIN
};

export const DURABLE_RESPECTING = {
  'temporal-durable': GOLD_TEMPORAL,
  'restate-services': GOLD_RESTATE,
  'inngest-steps': GOLD_INNGEST,
  'intercom-fin': GOLD_FIN
};

export const INTENT_NAIVE = {
  'durable-business-process': {
    schemaVersion: '1.0', id: 'intent-durable-business', familyId: 'intent:durable-business-process',
    intentClass: 'durable-business-process',
    orchestration: { kind: 'llm-loop', retryWholeWorkflow: true, sideEffects: 'in-orchestrator', deterministic: false, sideEffectsIdempotent: false },
    wait: { kind: 'process-sleep', holdsProcess: true, dispatch: 'none', maxDelay: 'hours' },
    hitl: { kind: 'chat-message', survivesWorkerDeath: false },
    compensation: { kind: 'none', failure: 'ignore' },
    workers: { kind: 'in-process', state: 'in-process' },
    retries: { unbounded: true, exhausted: 'spin' },
    versioning: { inFlightPinned: false },
    stop: { owner: 'model', modelSaysDone: true },
    shape: 'coding-agent-loop',
    actions: [{ kind: 'bash' }],
    claimedMotifs: ['side-effects-isolated-from-replay', 'durable-timer-not-process-sleep', 'hitl-survives-worker-death', 'compensate-irreversible-effects', 'workers-ephemeral-history-durable', 'not-a-coding-agent-loop', 'retries-bounded-poison-parks', 'in-flight-code-pinned', 'ir-limits-named-not-papered'],
    selfAttestedSuccess: true
  },
  'coding-agent-session': {
    schemaVersion: '1.0', id: 'intent-coding-agent', familyId: 'intent:coding-agent-session',
    intentClass: 'coding-agent-session',
    stop: { owner: 'model', modelSaysDone: true },
    isolation: { untrustedExec: false },
    compensation: { kind: 'saga-lifo', required: true },
    claimedMotifs: ['host-owns-stop', 'untrusted-exec-isolated', 'saga-not-required'],
    selfAttestedSuccess: true
  },
  'cx-supervised-conversation': {
    schemaVersion: '1.0', id: 'intent-cx', familyId: 'intent:cx-supervised-conversation',
    intentClass: 'cx-supervised-conversation',
    preLlm: { llmFirst: true },
    generate: { kind: 'bare-llm' },
    validate: { afterGenerate: false },
    supervisors: [],
    escalate: { owner: 'model', highRisk: [] },
    actionLed: { kind: 'free-form-tools' },
    claimedMotifs: ['pre-llm-or-input-filter', 'post-generate-gate', 'high-risk-not-model-owned', 'actions-are-procedures-or-guardrails'],
    selfAttestedSuccess: true
  },
  'graph-automation': {
    schemaVersion: '1.0', id: 'intent-graph', familyId: 'intent:graph-automation',
    intentClass: 'graph-automation',
    topology: { kind: 'linear-steps' },
    nodes: [{ id: 'agent', type: 'agent' }],
    errorHandling: { kind: 'try-catch' },
    claimedMotifs: ['nodes-plus-connections', 'per-node-error-join', 'separate-error-path'],
    selfAttestedSuccess: true
  }
};

export const INTENT_RESPECTING = {
  'durable-business-process': {
    schemaVersion: '1.0', id: 'intent-durable-business', familyId: 'intent:durable-business-process',
    intentClass: 'durable-business-process',
    orchestration: { kind: 'event-sourced-run', retryWholeWorkflow: false, sideEffects: 'task-nodes', deterministic: true, sideEffectsIdempotent: true },
    wait: { kind: 'durable-timer', holdsProcess: false, dispatch: 'persisted-wake-reinvoke', maxDelay: 'unbounded-or-months' },
    hitl: { kind: 'human-node', survivesWorkerDeath: true },
    compensation: { kind: 'saga-lifo', onCancel: 'compensate', failure: 'pause-and-fix' },
    workers: { kind: 'ephemeral', state: 'run-event-log' },
    retries: { unbounded: false, exhausted: 'pause-and-fix' },
    versioning: { inFlightPinned: true, kind: 'workflow-id-run' },
    stop: { owner: 'host' },
    shape: 'durable-workflow',
    ir: {
      kind: 'foundry-workflow',
      nodeKinds: [...IR_NODE_KINDS],
      delayMsMax: FOUNDRY_IR_LIMITS.delayMsMax,
      compensateKind: FOUNDRY_IR_LIMITS.compensateKind,
      continueAsNew: FOUNDRY_IR_LIMITS.continueAsNew,
      timerDispatch: FOUNDRY_IR_LIMITS.timerDispatch,
      waitCrashRestartsDeadline: FOUNDRY_IR_LIMITS.waitCrashRestartsDeadline,
      budgetPolicyCapMs: FOUNDRY_IR_LIMITS.budgetPolicyCapMs
    }
  },
  'coding-agent-session': {
    schemaVersion: '1.0', id: 'intent-coding-agent', familyId: 'intent:coding-agent-session',
    intentClass: 'coding-agent-session',
    stop: { owner: 'host', modelSaysDone: false, kind: 'host-limits-or-token' },
    isolation: { untrustedExec: true },
    compensation: { kind: 'none', required: false },
    shape: 'coding-agent-loop'
  },
  'cx-supervised-conversation': {
    schemaVersion: '1.0', id: 'intent-cx', familyId: 'intent:cx-supervised-conversation',
    intentClass: 'cx-supervised-conversation',
    preLlm: { llmFirst: false, refineQuery: true, checksWorkflowsAndCustomAnswers: true, safetyFilter: true },
    generate: { kind: 'rag', lowConfidence: 'clarify' },
    validate: { afterGenerate: true, ungrounded: 'do-not-send' },
    supervisors: [{ role: 'input-filter' }, { role: 'output-intercept' }],
    escalate: { owner: 'human', highRisk: ['medical', 'legal', 'financial'] },
    actionLed: { kind: 'procedures', consultingware: false },
    guardrails: { kind: 'deterministic' }
  },
  'graph-automation': {
    schemaVersion: '1.0', id: 'intent-graph', familyId: 'intent:graph-automation',
    intentClass: 'graph-automation',
    topology: { kind: 'nodes-connections' },
    nodes: [{ id: 'fetch', type: 'http', onError: 'continueErrorOutput' }, { id: 'agent', type: 'agent' }],
    errorHandling: { kind: 'separate-error-workflow', errorWorkflowId: 'wf-error' }
  }
};

function interpretTemporal(harness, input) {
  if (input.op === 'activity-fail') {
    if (harness.activities?.retryDefault === true && harness.workflow?.retryDefault === false) {
      return { retried: 'activity', workflowRestarted: false };
    }
    if (harness.workflow?.retryDefault === true) return { retried: 'workflow', workflowRestarted: true };
    return { retried: 'none', workflowRestarted: false };
  }
  if (input.op === 'sleep-30-days') {
    const durable = harness.wait?.kind === 'durable-timer' && harness.wait?.holdsProcess === false;
    return { survivedWorkerDeath: durable, holdsProcess: harness.wait?.holdsProcess === true };
  }
  if (input.op === 'workflow-http-call') {
    const forbidden = harness.workflow?.deterministic === true && harness.workflow?.ioAllowed === false;
    return { allowed: !forbidden, location: forbidden ? 'activity' : 'workflow' };
  }
  if (input.op === 'human-approval') {
    const signal = harness.hitl?.kind === 'signal' && harness.hitl?.survivesWorkerDeath === true;
    return { channel: signal ? 'signal' : (harness.hitl?.kind ?? 'chat'), durable: signal };
  }
  if (input.op === 'unbounded-history') {
    return { strategy: harness.continueAsNew === true ? 'continue-as-new' : 'grow-forever' };
  }
  throw new FoundryError('HARNESS_INTERPRETER', 'Unknown temporal-durable probe');
}

function interpretRestate(harness, input) {
  if (input.op === 'two-writes-same-key') {
    const single = harness.virtualObject?.singleWriterPerKey === true;
    return { concurrentWriters: single ? 1 : 2, serialized: single };
  }
  if (input.op === 'crash-mid-handler') {
    const journal = harness.steps?.kind === 'ctx.run' && harness.steps?.replayCompleted === true;
    return { resume: journal ? 'replay-journal' : 'restart-handler', reexecutesCompleted: !journal };
  }
  if (input.op === 'human-approval') {
    const aw = harness.hitl?.kind === 'awakeable-or-promise' && harness.hitl?.survivesWorkerDeath === true;
    return { channel: aw ? 'awakeable-or-promise' : (harness.hitl?.kind ?? 'chat'), durable: aw };
  }
  if (input.probe === 'service-types') {
    return { types: [...(harness.serviceTypes ?? [])].sort(), foldsEverythingIntoWorkflow: harness.foldsEverythingIntoWorkflow === true };
  }
  throw new FoundryError('HARNESS_INTERPRETER', 'Unknown restate-services probe');
}

function interpretInngest(harness, input) {
  if (input.op === 'step-complete-then-crash') {
    const memo = harness.steps?.memoizeCompleted === true && harness.steps?.reexecuteCompleted === false;
    return { reexecutesCompleted: !memo, memoized: memo };
  }
  if (input.op === 'db-call-outside-step') {
    const must = harness.steps?.nonDeterministicMustBeInStep === true;
    return { allowed: !must, requiredLocation: must ? 'step.run' : 'anywhere' };
  }
  if (input.op === 'sleep') {
    const durable = harness.wait?.kind === 'durable-sleep' && harness.wait?.holdsProcess === false;
    return { durable, holdsProcess: harness.wait?.holdsProcess === true };
  }
  if (input.probe === 'workers') {
    return { manageOwnWorkers: harness.workers?.userManages === true, compute: harness.workers?.compute ?? null };
  }
  throw new FoundryError('HARNESS_INTERPRETER', 'Unknown inngest-steps probe');
}

function interpretFin(harness, input) {
  if (input.op === 'incoming-query') {
    const before = harness.preLlm?.checksWorkflowsAndCustomAnswers === true && harness.preLlm?.safetyFilter === true && harness.preLlm?.llmFirst === false;
    return { llmFirst: !before, routedTo: before ? 'workflow-or-custom-answer-or-llm' : 'llm' };
  }
  if (input.op === 'low-confidence') {
    return { action: harness.generate?.lowConfidence === 'clarify' ? 'clarify' : 'send-anyway' };
  }
  if (input.op === 'ungrounded-answer') {
    const block = harness.validate?.afterGenerate === true && harness.validate?.ungrounded === 'do-not-send';
    return { sent: !block, groundedRequired: block };
  }
  if (input.op === 'high-risk-medical') {
    const esc = (harness.escalate?.highRisk ?? []).includes('medical') && harness.escalate?.owner === 'human';
    return { handoff: esc, owner: esc ? 'human' : 'model' };
  }
  if (input.op === 'damaged-order-refund') {
    const proc = harness.actionLed?.kind === 'procedures' && harness.actionLed?.consultingware === false;
    return { handler: proc ? 'procedures' : (harness.actionLed?.kind ?? 'free-form-tools'), productNotServices: proc };
  }
  throw new FoundryError('HARNESS_INTERPRETER', 'Unknown intercom-fin probe');
}

export function interpretDurable(harness, input) {
  if (harness?.familyId === 'temporal-durable') return interpretTemporal(harness, input);
  if (harness?.familyId === 'restate-services') return interpretRestate(harness, input);
  if (harness?.familyId === 'inngest-steps') return interpretInngest(harness, input);
  if (harness?.familyId === 'intercom-fin') return interpretFin(harness, input);
  return null;
}

export function interpretIntent(harness, input, intentClass) {
  const cls = intentClass ?? harness?.intentClass ?? harness?.familyId?.replace(/^intent:/, '');
  if (cls === 'durable-business-process') {
    if (input.op === 'activity-crash') {
      const task = harness.orchestration?.retryWholeWorkflow === false && ['task-nodes', 'activities', 'ctx.run', 'step.run'].includes(harness.orchestration?.sideEffects);
      return { retried: task ? 'task' : 'whole-workflow', workflowRestarted: harness.orchestration?.retryWholeWorkflow === true };
    }
    if (input.op === 'sleep-30-days') {
      const durable = harness.wait?.kind === 'durable-timer' && harness.wait?.holdsProcess === false;
      return { survivedWorkerDeath: durable, holdsProcess: harness.wait?.holdsProcess === true };
    }
    if (input.op === 'cancel-after-pay') {
      const saga = harness.compensation?.kind === 'saga-lifo';
      return { compensated: saga, kind: harness.compensation?.kind ?? 'none' };
    }
    if (input.op === 'worker-death-during-approval') {
      return { hitlIntact: harness.hitl?.survivesWorkerDeath === true, channel: harness.hitl?.kind ?? null };
    }
    if (input.op === 'shape') {
      const coding = harness.shape === 'coding-agent-loop' || harness.orchestration?.kind === 'llm-loop' || (harness.actions ?? []).some(a => a.kind === 'bash');
      return { codingAgentLoop: coding };
    }
    if (input.op === 'permanent-failure') {
      return { unbounded: harness.retries?.unbounded === true, exhausted: harness.retries?.exhausted ?? 'spin' };
    }
    if (input.op === 'compensation-fails') {
      return { handling: harness.compensation?.failure ?? 'ignore' };
    }
    if (input.op === 'ship-new-code') {
      return { inFlightPinned: harness.versioning?.inFlightPinned === true };
    }
    if (input.op === 'ir-limits') {
      return {
        delayMsMax: harness.ir?.delayMsMax ?? null,
        compensateKind: harness.ir?.compensateKind ?? null,
        continueAsNew: harness.ir?.continueAsNew ?? null,
        timerDispatch: harness.ir?.timerDispatch ?? null,
        waitCrashRestartsDeadline: harness.ir?.waitCrashRestartsDeadline ?? null
      };
    }
    throw new FoundryError('HARNESS_INTERPRETER', 'Unknown durable-business-process probe');
  }
  if (cls === 'coding-agent-session') {
    if (input.op === 'model-says-done') return { accepted: harness.stop?.owner !== 'host' };
    if (input.op === 'untrusted-exec') return { isolated: harness.isolation?.untrustedExec === true };
    if (input.op === 'require-saga') return { required: harness.compensation?.kind === 'saga-lifo' && harness.compensation?.required !== false };
    throw new FoundryError('HARNESS_INTERPRETER', 'Unknown coding-agent-session probe');
  }
  if (cls === 'cx-supervised-conversation') {
    if (input.op === 'raw-ticket') {
      const gated = harness.preLlm?.llmFirst === false || (harness.supervisors ?? []).some(s => s.role === 'input-filter');
      return { llmFirst: !gated };
    }
    if (input.op === 'ungrounded') {
      const gated = harness.validate?.afterGenerate === true || (harness.supervisors ?? []).some(s => s.role === 'output-intercept');
      return { sent: !gated };
    }
    if (input.op === 'medical-advice') {
      return { handoff: harness.escalate?.owner === 'human' && (harness.escalate?.highRisk ?? []).includes('medical') };
    }
    throw new FoundryError('HARNESS_INTERPRETER', 'Unknown cx-supervised-conversation probe');
  }
  if (cls === 'graph-automation') {
    if (input.probe === 'topology') return { kind: harness.topology?.kind ?? null };
    if (input.op === 'node-fail') {
      const join = (harness.nodes ?? []).some(n => n.continueOnFail === true || ['continueRegularOutput', 'continueErrorOutput'].includes(n.onError ?? ''));
      return { continued: join, errorHandling: harness.errorHandling?.kind ?? null };
    }
    throw new FoundryError('HARNESS_INTERPRETER', 'Unknown graph-automation probe');
  }
  throw new FoundryError('HARNESS_INTERPRETER', 'Unknown intent class');
}

const TEMPORAL_SCENARIOS = [
  { id: 'activity-retries', input: { op: 'activity-fail' }, expected: { retried: 'activity', workflowRestarted: false } },
  { id: 'sleep-survives-worker', input: { op: 'sleep-30-days' }, expected: { survivedWorkerDeath: true, holdsProcess: false } },
  { id: 'http-not-in-workflow', input: { op: 'workflow-http-call' }, expected: { allowed: false, location: 'activity' } },
  { id: 'approval-is-signal', input: { op: 'human-approval' }, expected: { channel: 'signal', durable: true } },
  { id: 'continue-as-new', input: { op: 'unbounded-history' }, expected: { strategy: 'continue-as-new' } }
];

const RESTATE_SCENARIOS = [
  { id: 'single-writer', input: { op: 'two-writes-same-key' }, expected: { concurrentWriters: 1, serialized: true } },
  { id: 'journal-replay', input: { op: 'crash-mid-handler' }, expected: { resume: 'replay-journal', reexecutesCompleted: false } },
  { id: 'awakeable-approval', input: { op: 'human-approval' }, expected: { channel: 'awakeable-or-promise', durable: true } },
  { id: 'three-types', input: { probe: 'service-types' }, expected: { types: ['basic-service', 'virtual-object', 'workflow'], foldsEverythingIntoWorkflow: false } }
];

const INNGEST_SCENARIOS = [
  { id: 'memoize-completed', input: { op: 'step-complete-then-crash' }, expected: { reexecutesCompleted: false, memoized: true } },
  { id: 'db-must-be-step', input: { op: 'db-call-outside-step' }, expected: { allowed: false, requiredLocation: 'step.run' } },
  { id: 'durable-sleep', input: { op: 'sleep' }, expected: { durable: true, holdsProcess: false } },
  { id: 'no-worker-fleet', input: { probe: 'workers' }, expected: { manageOwnWorkers: false, compute: 'your-own-including-serverless' } }
];

const FIN_SCENARIOS = [
  { id: 'not-llm-first', input: { op: 'incoming-query' }, expected: { llmFirst: false, routedTo: 'workflow-or-custom-answer-or-llm' } },
  { id: 'low-confidence-clarify', input: { op: 'low-confidence' }, expected: { action: 'clarify' } },
  { id: 'ungrounded-blocked', input: { op: 'ungrounded-answer' }, expected: { sent: false, groundedRequired: true } },
  { id: 'medical-handoff', input: { op: 'high-risk-medical' }, expected: { handoff: true, owner: 'human' } },
  { id: 'refund-is-procedure', input: { op: 'damaged-order-refund' }, expected: { handler: 'procedures', productNotServices: true } }
];

export const INTENT_SCENARIOS = {
  'durable-business-process': [
    { id: 'crash-retries-task', input: { op: 'activity-crash' }, expected: { retried: 'task', workflowRestarted: false } },
    { id: 'sleep-30-days', input: { op: 'sleep-30-days' }, expected: { survivedWorkerDeath: true, holdsProcess: false } },
    { id: 'cancel-compensates', input: { op: 'cancel-after-pay' }, expected: { compensated: true, kind: 'saga-lifo' } },
    { id: 'approval-survives', input: { op: 'worker-death-during-approval' }, expected: { hitlIntact: true, channel: 'human-node' } },
    { id: 'not-coding-loop', input: { op: 'shape' }, expected: { codingAgentLoop: false } },
    { id: 'poison-parks', input: { op: 'permanent-failure' }, expected: { unbounded: false, exhausted: 'pause-and-fix' } },
    { id: 'compensation-pauses', input: { op: 'compensation-fails' }, expected: { handling: 'pause-and-fix' } },
    { id: 'in-flight-pinned', input: { op: 'ship-new-code' }, expected: { inFlightPinned: true } },
    { id: 'ir-limits-named', input: { op: 'ir-limits' }, expected: { delayMsMax: 3600000, compensateKind: false, continueAsNew: false, timerDispatch: 'persisted-wake-reinvoke', waitCrashRestartsDeadline: true } }
  ],
  'coding-agent-session': [
    { id: 'host-stop', input: { op: 'model-says-done' }, expected: { accepted: false } },
    { id: 'isolated-exec', input: { op: 'untrusted-exec' }, expected: { isolated: true } },
    { id: 'saga-not-required', input: { op: 'require-saga' }, expected: { required: false } }
  ],
  'cx-supervised-conversation': [
    { id: 'not-llm-first', input: { op: 'raw-ticket' }, expected: { llmFirst: false } },
    { id: 'ungrounded-blocked', input: { op: 'ungrounded' }, expected: { sent: false } },
    { id: 'medical-handoff', input: { op: 'medical-advice' }, expected: { handoff: true } }
  ],
  'graph-automation': [
    { id: 'topology', input: { probe: 'topology' }, expected: { kind: 'nodes-connections' } },
    { id: 'node-fail-continues', input: { op: 'node-fail' }, expected: { continued: true, errorHandling: 'separate-error-workflow' } }
  ]
};

export const INTENT_CLASSES = Object.freeze({
  'durable-business-process': {
    id: 'durable-business-process',
    domain: 'any-long-running-business-process',
    examples: ['approve invoice then pay, wait 30 days, compensate on cancel', 'onboarding with email-link click', 'loan application pause-and-fix'],
    requiredMotifs: INTENT_MOTIFS['intent:durable-business-process'].map(m => m.id),
    forbiddenShapes: ['coding-agent-loop', 'llm-loop']
  },
  'coding-agent-session': {
    id: 'coding-agent-session',
    domain: 'software',
    examples: ['fix a GitHub issue in a sandbox', 'iterate on a patch with host stop rules'],
    requiredMotifs: INTENT_MOTIFS['intent:coding-agent-session'].map(m => m.id),
    forbiddenShapes: ['durable-business-saga-as-the-loop']
  },
  'cx-supervised-conversation': {
    id: 'cx-supervised-conversation',
    domain: 'customer-support',
    examples: ['refund a damaged order', 'answer from help center then escalate medical'],
    requiredMotifs: INTENT_MOTIFS['intent:cx-supervised-conversation'].map(m => m.id),
    forbiddenShapes: ['free-form-tool-loop']
  },
  'graph-automation': {
    id: 'graph-automation',
    domain: 'workflow-automation',
    examples: ['HTTP fetch then agent then branch on error', 'n8n/Zapier-style integration graph'],
    requiredMotifs: INTENT_MOTIFS['intent:graph-automation'].map(m => m.id),
    forbiddenShapes: ['linear-agent-steps']
  }
});

function pack(id, intent, publicInterface, marker, paths, harness, scenarios) {
  return {
    id,
    builderPack: {
      intent,
      publicInterface,
      ideologicalReasons: DURABLE_MOTIFS[id].map(m => ({ motif: m.id, why: m.why }))
    },
    heldOut: {
      uniqueMarker: marker,
      paths,
      target: { marker, harness, scenarios }
    }
  };
}

export const DURABLE_FAMILY_SPECS = {
  'temporal-durable': pack(
    'temporal-durable',
    'Construct a durable-execution harness matching Temporal’s public protocol: deterministic workflow replay over event history, side effects in Activities that retry by default (workflow does not), durable timers that do not hold a process, HITL as Signal/Query/Update, Continue-As-New for unbounded history, LIFO saga compensation. This is not a coding-agent loop and not LangGraph (resume re-executes the node from start).',
    {
      workflow: 'deterministic, no IO, replay event-history, retryDefault false',
      activities: 'retryDefault true, idempotent',
      wait: 'durable-timer, holdsProcess false',
      hitl: 'signal + query, survives worker death',
      unbounded: 'continue-as-new',
      compensation: 'saga-lifo'
    },
    TEMPORAL_MARKER, ['construction-heldout://temporal-durable', 'heldout/temporal-durable.target.json'], GOLD_TEMPORAL, TEMPORAL_SCENARIOS
  ),
  'restate-services': pack(
    'restate-services',
    'Construct a durable-service harness matching Restate’s public protocol: three service types (basic, virtual object, workflow) rather than folding every problem into workflow/activity; virtual objects single-writer per key; side effects in ctx.run journaled steps; HITL via awakeable/durable promise; entity state is keyed K/V not event-history spill.',
    {
      serviceTypes: ['basic-service', 'virtual-object', 'workflow'],
      virtualObject: 'single writer per key',
      steps: 'ctx.run journal, do not re-execute completed',
      hitl: 'awakeable-or-promise',
      state: 'keyed-kv, no external DB for entity'
    },
    RESTATE_MARKER, ['construction-heldout://restate-services', 'heldout/restate-services.target.json'], GOLD_RESTATE, RESTATE_SCENARIOS
  ),
  'inngest-steps': pack(
    'inngest-steps',
    'Construct a durable-function harness matching Inngest’s public execution model: functions resume from the top; completed steps are memoized; each step is a separate HTTP request; non-deterministic IO must be inside step.run; sleep is durable; the user does not manage a worker fleet — code runs on their compute including serverless; triggers are events.',
    {
      steps: 'memoize completed, separate HTTP request, non-deterministic in step.run',
      wait: 'durable-sleep',
      workers: 'userManages false, compute your-own-including-serverless',
      trigger: 'event'
    },
    INNGEST_MARKER, ['construction-heldout://inngest-steps', 'heldout/inngest-steps.target.json'], GOLD_INNGEST, INNGEST_SCENARIOS
  ),
  'intercom-fin': pack(
    'intercom-fin',
    'Construct a CX-agent harness matching Intercom Fin’s public engine: refine + Workflows/Custom Answer/safety checks BEFORE the LLM; RAG not a bare-LLM wrapper; validate grounding after generate; automatic human handoff on high-risk medical/legal/financial/self-harm/minors/jailbreak; action-led queries are Procedures owned by CX ops, not consultingware. Distinct from Sierra Agent OS (supervisors + constellation).',
    {
      preLlm: 'refine, route workflows/custom answers, safety, not llmFirst',
      generate: 'rag, clarify on low confidence',
      validate: 'after generate, ungrounded do-not-send',
      escalate: { owner: 'human', highRisk: FIN_HIGH_RISK },
      actionLed: 'procedures, not consultingware',
      queryClasses: QUERY_CLASSES
    },
    FIN_MARKER, ['construction-heldout://intercom-fin', 'heldout/intercom-fin.target.json'], GOLD_FIN, FIN_SCENARIOS
  )
};

export const DURABLE_CATALOG = Object.freeze([
  { id: 'temporal-durable', company: 'Temporal', product: 'Temporal', domain: 'durable-execution', encoded: true, evidence: 'https://docs.temporal.io/encyclopedia/retry-policies ; https://docs.temporal.io/workflow-execution ; https://docs.temporal.io/guides/saga-pattern ; https://docs.temporal.io/develop/typescript/timers ; https://docs.temporal.io/encyclopedia/workflow-message-passing ; https://www.temporal.io/blog/workflow-engine-principles (2021-04-05)' },
  { id: 'restate-services', company: 'Restate', product: 'Restate', domain: 'durable-execution', encoded: true, evidence: 'https://docs.restate.dev/foundations/services ; https://restate.dev/what-is-durable-execution ; https://restate.dev/vs/temporal' },
  { id: 'inngest-steps', company: 'Inngest', product: 'Inngest', domain: 'durable-execution', encoded: true, evidence: 'https://www.inngest.com/docs/learn/how-functions-are-executed' },
  { id: 'intercom-fin', company: 'Intercom', product: 'Fin', domain: 'customer-support', encoded: true, evidence: 'https://www.intercom.com/help/en/articles/9929230-the-fin-ai-engine (2026-05-14); https://www.intercom.com/blog/the-hardest-percentages/ (2026-04-14); https://www.intercom.com/help/en/articles/7120684-fin-ai-agent-explained' }
]);

export const PRODUCTION_LATTICE = Object.freeze(
  Object.entries(INTENT_MOTIFS).flatMap(([key, motifs]) => motifs.map(m => ({
    id: m.id,
    intentClass: key.replace(/^intent:/, ''),
    why: m.why
  })))
);

const INTENT_MARKERS = Object.freeze({
  'durable-business-process': 'HELD_OUT_INTENT_DURABLE_BUSINESS_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER',
  'coding-agent-session': 'HELD_OUT_INTENT_CODING_AGENT_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER',
  'cx-supervised-conversation': 'HELD_OUT_INTENT_CX_SUPERVISED_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER',
  'graph-automation': 'HELD_OUT_INTENT_GRAPH_AUTOMATION_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER'
});

function intentPack(id, intent, publicInterface) {
  const marker = INTENT_MARKERS[id];
  return {
    id,
    builderPack: {
      intent,
      publicInterface,
      intentClass: id,
      ideologicalReasons: INTENT_MOTIFS[`intent:${id}`].map(m => ({ motif: m.id, why: m.why }))
    },
    heldOut: {
      uniqueMarker: marker,
      paths: [`construction-heldout://intent/${id}`, `heldout/intent-${id}.target.json`],
      target: { marker, harness: INTENT_RESPECTING[id], scenarios: INTENT_SCENARIOS[id] }
    }
  };
}

export const INTENT_SPECS = Object.freeze({
  'durable-business-process': intentPack(
    'durable-business-process',
    'Construct a production-grade durable business process from this intent, not a named vendor clone: side effects isolated from replay and idempotent; durable timers that do not hold a process (timer-service or persisted-wake-reinvoke, months-scale); HITL that survives worker death; LIFO saga compensation that pause-and-fixes on compensation failure; ephemeral workers with durable history; bounded retries that park poison; in-flight executions pinned to code version. Name Foundry IR limits honestly: delayMs max 1 hour, no compensate kind, no continue-as-new, timerDispatch persisted-wake-reinvoke, wait crash restarts the deadline, budget policy cap 1 hour. This is not a coding-agent loop and not Temporal.',
    {
      orchestration: 'side effects in task-nodes|activities|ctx.run|step.run, retryWholeWorkflow false, idempotent',
      wait: 'durable-timer, holdsProcess false, maxDelay unbounded-or-months, dispatch timer-service|persisted-wake-reinvoke',
      hitl: 'signal|awakeable-or-promise|human-node, survives worker death',
      compensation: 'saga-lifo, onCancel compensate, failure pause-and-fix',
      workers: 'ephemeral, state event-history|journal|run-event-log|keyed-kv',
      retries: 'bounded, exhausted park|dead-letter|pause-and-fix',
      versioning: 'inFlightPinned',
      ir: 'foundry-workflow: delayMsMax 3600000, compensateKind false, continueAsNew false, timerDispatch persisted-wake-reinvoke, waitCrashRestartsDeadline true, budgetPolicyCapMs 3600000',
      forbidden: ['coding-agent-loop', 'llm-loop', 'bash-only actions']
    }
  ),
  'coding-agent-session': intentPack(
    'coding-agent-session',
    'Construct a coding-agent session harness: the host owns stop, untrusted execution is isolated, and LIFO saga compensation is not required. Do not force invoice-saga motifs onto a SWE loop.',
    {
      stop: 'host owns done; model-says-done is not submission',
      isolation: 'untrustedExec true',
      compensation: 'not required'
    }
  ),
  'cx-supervised-conversation': intentPack(
    'cx-supervised-conversation',
    'Construct a supervised customer-experience conversation: pre-LLM refine/input-filter, post-generate gate or output intercept, high-risk medical/legal/financial owned by a human, actions as procedures or deterministic guardrails. Not a free-form tool loop.',
    {
      preLlm: 'not llmFirst',
      validate: 'after generate or output-intercept',
      escalate: 'human owns medical+',
      actions: 'procedures or deterministic guardrails'
    }
  ),
  'graph-automation': intentPack(
    'graph-automation',
    'Construct a graph automation harness: nodes+connections topology, per-node continueOnFail/onError join, separate error workflow. Not a linear agent step list.',
    {
      topology: 'nodes-connections',
      join: 'per-node continueOnFail or onError continue*Output',
      errorHandling: 'separate-error-workflow'
    }
  )
});

void FIN_HIGH_RISK;
void QUERY_CLASSES;
