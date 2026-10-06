import { FoundryError } from './data.mjs';
import {
  CLOSED_MOTIFS, CLOSED_NAIVE, CLOSED_RESPECTING, CLOSED_FAMILY_SPECS, CLOSED_CATALOG, interpretClosed
} from './construction-closed.mjs';
import {
  INDUSTRY_MOTIFS, INDUSTRY_NAIVE, INDUSTRY_RESPECTING, INDUSTRY_FAMILY_SPECS, INDUSTRY_CATALOG, interpretIndustry
} from './construction-industry.mjs';
import {
  DURABLE_MOTIFS, DURABLE_NAIVE, DURABLE_RESPECTING, DURABLE_FAMILY_SPECS, DURABLE_CATALOG, INTENT_MOTIFS, interpretDurable
} from './construction-durable.mjs';

export const TOKEN = 'COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT';
const AI_SOCKETS = new Set(['ai_languageModel', 'ai_memory', 'ai_tool', 'ai_outputParser']);

const MINI_MARKER = 'HELD_OUT_MINI_SWE_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';
const N8N_MARKER = 'HELD_OUT_N8N_AGENT_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';
const DEVIN_MARKER = 'HELD_OUT_DEVIN_CLOUD_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';
const CURSOR_MARKER = 'HELD_OUT_CURSOR_SHADOW_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';
const LANGGRAPH_MARKER = 'HELD_OUT_LANGGRAPH_DURABLE_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';
const OPENHANDS_MARKER = 'HELD_OUT_OPENHANDS_STUCK_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';
const SIERRA_MARKER = 'HELD_OUT_SIERRA_AGENT_OS_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';
const CUA_MARKER = 'HELD_OUT_OPENAI_CUA_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';

export const MOTIFS = {
  'mini-swe-agent': [
    {
      id: 'bash-only-action',
      why: 'Observed mini-swe docs/faq.md and docs/index.md: the default agent has no tools other than bash and does not use the LM tool-calling interface, so any model and any bash environment work without installing an ACI. SWE-agent is the tool/history-processor fork.',
      inspect: c => Array.isArray(c.actions) && c.actions.length === 1 && c.actions[0]?.kind === 'bash' && !c.actions.some(a => a.kind === 'tool-call')
    },
    {
      id: 'stateless-process-group',
      why: 'Observed local.py _run (Popen + start_new_session + os.killpg on timeout), not the FAQ claim of subprocess.run. FAQ why-no-shell-session: persistent shells make termination detection flaky (PID/prompt heuristics), let a bad command kill the session, and let interrupts poison later output. cd/export do not persist; prefix them per action.',
      inspect: c => c.environment?.persistentShell === false && c.environment?.shell === 'stateless-popen-pgroup' && c.environment?.kill === 'process-group'
    },
    {
      id: 'completion-token-stdout',
      why: 'Observed local.py _check_finished: completion is stdout first line COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT after lstrip, AND returncode must be 0. control_flow.md omits the returncode==0 conjunct — code wins. Model text saying done is not submission.',
      inspect: c => c.stop?.kind === 'stdout-first-line' && c.stop?.token === TOKEN && c.stop?.requireReturncode === 0
    },
    {
      id: 'host-limits',
      why: 'Host owns step, cost, wall-time and consecutive format-error ceilings (DefaultAgent.query / InterruptAgentFlow LimitsExceeded, FormatError). The model cannot declare itself finished by omitting a limit key. costLimit may be null; the key must still exist.',
      inspect: c => c.hostLimits && ['stepLimit', 'costLimit', 'wallTimeMs', 'maxConsecutiveFormatErrors'].every(k => Object.hasOwn(c.hostLimits, k))
    },
    {
      id: 'linear-history-as-trajectory',
      why: 'Observed FAQ: history is completely linear; every step appends to LM messages. That trajectory is the FT/RL object. Summarized scratchpads are a different agent (SWE-agent history processors).',
      inspect: c => c.memory?.kind === 'linear-lm-messages' && c.loop?.history === 'linear-lm-messages'
    },
    {
      id: 'interrupt-exceptions',
      why: 'Observed docs/advanced/control_flow.md: Submitted, LimitsExceeded, FormatError, TimeoutError, UserInterruption inherit InterruptAgentFlow. run() catches them, appends their messages, and stops only on role=exit. Flags/state machines are the thing they rejected so subclassing stays easy.',
      inspect: c => c.controlFlow?.kind === 'interrupt-exceptions' && c.controlFlow?.usesFlags === false
    }
  ],
  'n8n-agent': [
    {
      id: 'continue-on-fail-join',
      why: 'Observed workflow-execute.ts continuesOnError: a node continues when continueOnFail is true or onError is continueRegularOutput|continueErrorOutput. That is a per-node join policy, not a graph-wide try/catch and not fail-the-run.',
      inspect: c => (c.nodes ?? []).some(n => n.continueOnFail === true || ['continueRegularOutput', 'continueErrorOutput'].includes(n.onError ?? ''))
    },
    {
      id: 'ai-socket-edges',
      why: 'Observed packages/workflow/src/schemas.ts NodeConnectionTypeSchema: an Agent is not a prompt node. Language model, memory, tool and output parser arrive on extra edge types (ai_languageModel, ai_memory, ai_tool, ai_outputParser), not main.',
      inspect: c => (c.connections ?? []).some(e => AI_SOCKETS.has(e.type))
    },
    {
      id: 'error-trigger-separate',
      why: 'Observed ERROR_TRIGGER_NODE_TYPE n8n-nodes-base.errorTrigger and workflow settings errorWorkflow. Error Trigger is a published separate workflow assigned to a failing workflow, not an in-graph catch node sharing the same node list. Best-practice guide: published Error Trigger workflows assigned per workflow.',
      inspect: c => c.errorHandling?.kind === 'separate-error-workflow' && typeof c.errorHandling?.errorWorkflowId === 'string' && !(c.nodes ?? []).some(n => n.type === 'errorTrigger')
    },
    {
      id: 'expression-dataflow',
      why: 'n8n dataflow is the expression language (={{$json...}}), not free JavaScript in the graph compiler.',
      inspect: c => c.dataflow?.language === 'n8n-expression'
    },
    {
      id: 'nodes-plus-connections',
      why: 'An n8n workflow is a nodes+connections JSON graph, not a linear step list. Topology kind is part of the product, not an implementation detail.',
      inspect: c => c.topology?.kind === 'nodes-connections'
    }
  ],
  'cognition-devin-cloud': [
    {
      id: 'microvm-not-container',
      why: 'Cognition 2026-04-23 (cognition.com/blog/what-we-learned-building-cloud-agents): agents generate untrusted code; a shared kernel is an escape surface onto other sessions’ filesystems, credentials and network. Isolation is a dedicated kernel per session (microVM), not a container.',
      inspect: c => c.isolation?.kind === 'microvm' && c.isolation?.dedicatedKernel === true && c.isolation?.sharedKernel === false
    },
    {
      id: 'hypervisor-snapshot-idle',
      why: 'Same Cognition post: real engineering has async gaps (CI, review) of minutes to days. Containers cannot snapshot memory+process-tree+filesystem, shut compute down, and restore. Keep-alive burns compute; reschedule loses the session. Persistence is a hypervisor snapshot with idle compute off.',
      inspect: c => c.persistence?.kind === 'hypervisor-snapshot' && c.persistence?.idleCompute === 'off' && Array.isArray(c.persistence?.captures) && ['memory', 'process-tree', 'filesystem'].every(x => c.persistence.captures.includes(x))
    },
    {
      id: 'sidekick-own-cache',
      why: 'Cognition 2026-06-29 Devin Fusion: Advisor/Smart Friend tools re-send task context and miss the prefix cache. A sidekick is a full agent with its own persistent cached context, not a query-another-model tool.',
      inspect: c => c.routing?.kind === 'sidekick' && c.routing?.sidekick?.fullAgent === true && c.routing?.sidekick?.ownCachedContext === true && c.routing?.sidekick?.advisorTool === false
    },
    {
      id: 'switch-at-compaction',
      why: 'Devin Fusion: model switch is performed at context compaction, which would cache-miss anyway. Mid-turn switches are forbidden because they dump the prefix cache (Cognition notes ~5 minute cache expiry as the surrounding constraint).',
      inspect: c => c.routing?.modelSwitch?.onlyAt === 'compaction'
    },
    {
      id: 'lead-keeps-judgment',
      why: 'Devin Fusion: the main agent takes minimal actions, delegates mechanical work, and keeps plan / ambiguity / final review. Their own counterexample: when judgment is the deliverable, delegating coding backfires (score 54→27 on a gated React feature).',
      inspect: c => c.lead?.default === 'delegate-and-monitor' && Array.isArray(c.lead?.owns) && ['plan', 'ambiguity', 'final-review'].every(x => c.lead.owns.includes(x))
    }
  ],
  'cursor-shadow-workspace': [
    {
      id: 'hidden-shadow-not-user-buffer',
      why: 'Cursor 2024-09 shadow-workspace (Arvid Lunnemark): AI lint iteration must not steal the user’s window, show incomplete edits, or write experimental bytes into the user’s buffer. The edit is applied in a hidden Electron window (show:false) and lints come back as observations.',
      inspect: c => c.shadow?.kind === 'hidden-window' && c.shadow?.userVisible === false && c.lintLoop?.mutateUserBuffer === false && c.lintLoop?.observation === 'lsp-from-shadow'
    },
    {
      id: 'reuse-one-shadow',
      why: 'Same post: a naive extra window is ~2x memory. The shadow is reused across requests, opt-in, auto-killed after idle, and is not one window per AI.',
      inspect: c => c.shadow?.reuseAcrossRequests === true && c.shadow?.onePerAi === false
    },
    {
      id: 'pause-ais-to-interleave',
      why: 'Same post: AIs can be paused indefinitely without noticing (they have no intrinsic sense of time); humans cannot. Multiple AIs are multiplexed onto one shadow by resetting folder state between them, like a scheduler, not like concurrent human editors.',
      inspect: c => c.interleave?.pauseAis === true && c.interleave?.reason === 'ais-do-not-notice-time'
    }
  ],
  'langgraph-durable': [
    {
      id: 'interrupt-durable-hole',
      why: 'Observed langgraph/types.py interrupt(): first invocation raises GraphInterrupt and surfaces a value to the client. This is not an error and not try/catch. HITL must survive process death.',
      inspect: c => c.interrupt?.kind === 'durable-hole' && c.interrupt?.raises === 'GraphInterrupt' && c.interrupt?.notError === true
    },
    {
      id: 'resume-reexecutes-node',
      why: 'Same docstring: a client resumes with Command; the graph resumes from the start of the node, re-executing all logic. interrupt() is not a yield that continues at the next line. Multiple interrupts in one node are matched by order, scoped to the task.',
      inspect: c => c.interrupt?.resume === 'Command' && c.interrupt?.reexecuteNodeFromStart === true
    },
    {
      id: 'checkpointer-required',
      why: 'interrupt() requires a checkpointer because the feature is persistence of graph state, not an in-memory pause. Compile without a checkpointer and the durable hole does not exist.',
      inspect: c => c.interrupt?.requiresCheckpointer === true && c.checkpoint?.requiredForInterrupt === true
    }
  ],
  'openhands-stuck': [
    {
      id: 'host-pattern-match',
      why: 'Observed software-agent-sdk stuck_detector.py: stuck is a host scan of the event stream (repeating action-observation, action-error, monologue, alternating pairs), not the model saying it is stuck. Windowed to 20 events since the last user message so file-backed logs are not fully materialized.',
      inspect: c => c.stuck?.kind === 'host-pattern-match' && c.stuck?.modelSelfReport === false && c.stuck?.window === 20 && c.stuck?.since === 'last-user-message'
    },
    {
      id: 'action-error-nudge-once',
      why: 'Same file get_action_error_nudge: when an action-error streak first hits the threshold the host nudges once (do not repeat the same call). is_stuck on that pattern fires only after one extra repeat past the threshold. A frozen streak must not re-nudge every iteration.',
      inspect: c => c.stuck?.actionErrorNudgeOnce === true && c.stuck?.thresholds?.action_error === 3 && c.stuck?.thresholds?.action_observation === 4
    },
    {
      id: 'context-window-loop-unimplemented',
      why: 'stuck_detector.py _is_stuck_context_window_error returns False with TODO blocked by OpenHands/agent-sdk#282. Docs/comments describe scenario 5; the code does not implement it. Pretending condensation-loop detection works is a lie about the source.',
      inspect: c => c.stuck?.contextWindowErrorLoop?.implemented === false
    }
  ],
  'sierra-agent-os': [
    {
      id: 'supervisors-not-monolith',
      why: 'Sierra 2025-10-02 enterprise-grade-agents: at scale a 1-in-10k hallucination is daily. Production agents are managed by several supervisory agents (“Jiminy Crickets”) with their own models, independently evaluable, with individually controlled agency. A single prompt is not a brand-safe harness.',
      inspect: c => Array.isArray(c.supervisors) && c.supervisors.length >= 2 && c.supervisors.some(s => s.role === 'input-filter') && c.supervisors.some(s => s.role === 'output-intercept')
    },
    {
      id: 'deterministic-guardrails',
      why: 'Sierra 2024-06-03 Agent Development Life Cycle: goals are declarative and flexible; guardrails (e.g. returns only within 30 days) are deterministic and cannot be crossed by the creative agent. Prompt-only business logic is the failure mode.',
      inspect: c => c.goals?.kind === 'declarative' && c.guardrails?.kind === 'deterministic' && Number.isInteger(c.guardrails?.returnWindowDays)
    },
    {
      id: 'immutable-agent-release',
      why: 'Same Sierra post: an agent release is an immutable snapshot of source, prompts, model versions and knowledge, enabling instant rollback and A/B. Live-mutable prompts are not a release.',
      inspect: c => c.release?.kind === 'immutable-snapshot' && Array.isArray(c.release?.includes) && ['source', 'prompts', 'model-versions', 'knowledge'].every(x => c.release.includes.includes(x))
    },
    {
      id: 'constellation-failover',
      why: 'Sierra 2025-12-03 constellation-of-models: Agent OS routes task-level work across many models and fails over when a provider degrades. Model choice is not a single-agent dropdown.',
      inspect: c => c.models?.kind === 'constellation' && c.models?.providerFailover === true && c.models?.routing === 'task-level'
    }
  ],
  'openai-cua': [
    {
      id: 'pixels-not-apis',
      why: 'OpenAI Computer-Using Agent (operator announcement): CUA processes raw pixel screenshots and uses a virtual mouse/keyboard so it can operate GUIs without OS- or web-specific APIs. Site APIs are a different product. Historical precursor: Adept ACT-1 (2022) used a custom viewport rendering and UI-element action space; Adept was acqui-hired by Amazon in 2024 — do not claim ACT-1 ships.',
      inspect: c => c.perception?.kind === 'screenshots' && c.action?.kind === 'virtual-mouse-keyboard' && c.action?.siteApi === false
    },
    {
      id: 'perception-reasoning-action',
      why: 'Same CUA post: each turn adds screenshots to context, reasons with an inner monologue over current and past screenshots/actions, then clicks/scrolls/types until done or user input is needed.',
      inspect: c => c.loop?.kind === 'perception-reasoning-action' && c.loop?.innerMonologue === true
    },
    {
      id: 'confirm-sensitive',
      why: 'CUA seeks user confirmation for sensitive actions such as entering login details or responding to CAPTCHA. A harness that types credentials autonomously is not this protocol.',
      inspect: c => c.safety?.confirmSensitive === true && Array.isArray(c.safety?.sensitive) && c.safety.sensitive.includes('login') && c.safety.sensitive.includes('captcha')
    }
  ],
  ...CLOSED_MOTIFS,
  ...INDUSTRY_MOTIFS,
  ...DURABLE_MOTIFS,
  ...INTENT_MOTIFS
};

const GOLD_MINI = {
  schemaVersion: '1.0', id: 'mini-swe-agent-harness', familyId: 'mini-swe-agent',
  loop: { paradigm: 'iterative-action-observation', history: 'linear-lm-messages' },
  actions: [{ kind: 'bash', schema: 'command-string-only' }],
  environment: { shell: 'stateless-popen-pgroup', persistentShell: false, kill: 'process-group', startNewSession: true },
  stop: { kind: 'stdout-first-line', token: TOKEN, requireReturncode: 0, lstrip: true },
  hostLimits: { stepLimit: 3, costLimit: null, wallTimeMs: 300000, maxConsecutiveFormatErrors: 2 },
  memory: { kind: 'linear-lm-messages' },
  controlFlow: { kind: 'interrupt-exceptions', usesFlags: false }
};

const NAIVE_MINI = {
  schemaVersion: '1.0', id: 'mini-swe-agent-harness', familyId: 'mini-swe-agent',
  loop: { paradigm: 'iterative-action-observation' },
  actions: [{ kind: 'tool-call', name: 'bash' }, { kind: 'tool-call', name: 'edit' }],
  environment: { shell: 'persistent', persistentShell: true },
  stop: { kind: 'model-says-done' },
  hostLimits: { stepLimit: 50 },
  memory: { kind: 'summarized-scratchpad' },
  controlFlow: { kind: 'flags', usesFlags: true },
  claimedMotifs: ['bash-only-action', 'stateless-process-group', 'completion-token-stdout', 'host-limits', 'linear-history-as-trajectory', 'interrupt-exceptions'],
  selfAttestedSuccess: true
};

const GOLD_N8N = {
  schemaVersion: '1.0', id: 'n8n-agent-harness', familyId: 'n8n-agent',
  topology: { kind: 'nodes-connections' },
  dataflow: { language: 'n8n-expression' },
  errorHandling: { kind: 'separate-error-workflow', errorWorkflowId: 'wf-error-handler' },
  nodes: [
    { id: 'start', type: 'trigger' },
    { id: 'fetch', type: 'http', onError: 'continueErrorOutput' },
    { id: 'agent', type: 'agent' },
    { id: 'model', type: 'languageModel' },
    { id: 'memory', type: 'memory' },
    { id: 'tool', type: 'tool' }
  ],
  connections: [
    { from: 'start', to: 'fetch', type: 'main' },
    { from: 'fetch', to: 'agent', type: 'main' },
    { from: 'model', to: 'agent', type: 'ai_languageModel' },
    { from: 'memory', to: 'agent', type: 'ai_memory' },
    { from: 'tool', to: 'agent', type: 'ai_tool' }
  ]
};

const NAIVE_N8N = {
  schemaVersion: '1.0', id: 'n8n-agent-harness', familyId: 'n8n-agent',
  topology: { kind: 'linear-steps' },
  dataflow: { language: 'javascript' },
  errorHandling: { kind: 'in-graph-try-catch' },
  nodes: [
    { id: 'start', type: 'trigger' },
    { id: 'fetch', type: 'http' },
    { id: 'agent', type: 'agent' },
    { id: 'error', type: 'errorTrigger' }
  ],
  connections: [
    { from: 'start', to: 'fetch', type: 'main' },
    { from: 'fetch', to: 'agent', type: 'main' }
  ],
  claimedMotifs: ['continue-on-fail-join', 'ai-socket-edges', 'error-trigger-separate', 'expression-dataflow', 'nodes-plus-connections'],
  selfAttestedSuccess: true
};

const GOLD_DEVIN = {
  schemaVersion: '1.0', id: 'cognition-devin-cloud-harness', familyId: 'cognition-devin-cloud',
  isolation: { kind: 'microvm', dedicatedKernel: true, sharedKernel: false },
  persistence: { kind: 'hypervisor-snapshot', idleCompute: 'off', captures: ['memory', 'process-tree', 'filesystem'] },
  routing: {
    kind: 'sidekick',
    sidekick: { fullAgent: true, ownCachedContext: true, advisorTool: false },
    modelSwitch: { onlyAt: 'compaction' }
  },
  lead: { actions: 'minimal', owns: ['plan', 'ambiguity', 'final-review'], default: 'delegate-and-monitor' }
};

const NAIVE_DEVIN = {
  schemaVersion: '1.0', id: 'cognition-devin-cloud-harness', familyId: 'cognition-devin-cloud',
  isolation: { kind: 'container', dedicatedKernel: false, sharedKernel: true },
  persistence: { kind: 'keep-alive-container', idleCompute: 'on', captures: [] },
  routing: {
    kind: 'advisor-tool',
    sidekick: { fullAgent: false, ownCachedContext: false, advisorTool: true },
    modelSwitch: { onlyAt: 'task-start' }
  },
  lead: { actions: 'does-all-work', owns: [], default: 'execute' },
  claimedMotifs: ['microvm-not-container', 'hypervisor-snapshot-idle', 'sidekick-own-cache', 'switch-at-compaction', 'lead-keeps-judgment'],
  selfAttestedSuccess: true
};

const GOLD_CURSOR = {
  schemaVersion: '1.0', id: 'cursor-shadow-workspace-harness', familyId: 'cursor-shadow-workspace',
  shadow: { kind: 'hidden-window', userVisible: false, reuseAcrossRequests: true, onePerAi: false },
  interleave: { pauseAis: true, reason: 'ais-do-not-notice-time' },
  lintLoop: { observation: 'lsp-from-shadow', mutateUserBuffer: false },
  overlay: { intent: 'vfs-folder-proxy', current: 'hidden-electron-window' }
};

const NAIVE_CURSOR = {
  schemaVersion: '1.0', id: 'cursor-shadow-workspace-harness', familyId: 'cursor-shadow-workspace',
  shadow: { kind: 'user-window', userVisible: true, reuseAcrossRequests: false, onePerAi: true },
  interleave: { pauseAis: false, reason: 'concurrent-editors' },
  lintLoop: { observation: 'user-buffer', mutateUserBuffer: true },
  overlay: { intent: 'edit-in-place', current: 'user-window' },
  claimedMotifs: ['hidden-shadow-not-user-buffer', 'reuse-one-shadow', 'pause-ais-to-interleave'],
  selfAttestedSuccess: true
};

const GOLD_LANGGRAPH = {
  schemaVersion: '1.0', id: 'langgraph-durable-harness', familyId: 'langgraph-durable',
  interrupt: { kind: 'durable-hole', raises: 'GraphInterrupt', notError: true, resume: 'Command', reexecuteNodeFromStart: true, requiresCheckpointer: true },
  checkpoint: { requiredForInterrupt: true, enabled: true }
};

const NAIVE_LANGGRAPH = {
  schemaVersion: '1.0', id: 'langgraph-durable-harness', familyId: 'langgraph-durable',
  interrupt: { kind: 'in-memory-yield', raises: 'none', notError: false, resume: 'continue', reexecuteNodeFromStart: false, requiresCheckpointer: false },
  checkpoint: { requiredForInterrupt: false, enabled: false },
  claimedMotifs: ['interrupt-durable-hole', 'resume-reexecutes-node', 'checkpointer-required'],
  selfAttestedSuccess: true
};

const GOLD_OPENHANDS = {
  schemaVersion: '1.0', id: 'openhands-stuck-harness', familyId: 'openhands-stuck',
  stuck: {
    kind: 'host-pattern-match',
    modelSelfReport: false,
    window: 20,
    since: 'last-user-message',
    actionErrorNudgeOnce: true,
    thresholds: { action_observation: 4, action_error: 3, monologue: 3, alternating_pattern: 6 },
    contextWindowErrorLoop: { implemented: false, issue: '282' }
  }
};

const NAIVE_OPENHANDS = {
  schemaVersion: '1.0', id: 'openhands-stuck-harness', familyId: 'openhands-stuck',
  stuck: {
    kind: 'model-self-report',
    modelSelfReport: true,
    window: null,
    since: 'full-history',
    actionErrorNudgeOnce: false,
    thresholds: { action_observation: 1, action_error: 1, monologue: 1, alternating_pattern: 1 },
    contextWindowErrorLoop: { implemented: true, issue: '282' }
  },
  claimedMotifs: ['host-pattern-match', 'action-error-nudge-once', 'context-window-loop-unimplemented'],
  selfAttestedSuccess: true
};

const GOLD_SIERRA = {
  schemaVersion: '1.0', id: 'sierra-agent-os-harness', familyId: 'sierra-agent-os',
  supervisors: [
    { role: 'input-filter', agency: 'intercept' },
    { role: 'output-intercept', agency: 'observe-or-intercept' }
  ],
  goals: { kind: 'declarative' },
  guardrails: { kind: 'deterministic', returnWindowDays: 30 },
  release: { kind: 'immutable-snapshot', includes: ['source', 'prompts', 'model-versions', 'knowledge'] },
  models: { kind: 'constellation', routing: 'task-level', providerFailover: true }
};

const NAIVE_SIERRA = {
  schemaVersion: '1.0', id: 'sierra-agent-os-harness', familyId: 'sierra-agent-os',
  supervisors: [],
  goals: { kind: 'prompt' },
  guardrails: { kind: 'prompt-only' },
  release: { kind: 'live-mutable-prompt' },
  models: { kind: 'single-dropdown', routing: 'agent-level', providerFailover: false },
  claimedMotifs: ['supervisors-not-monolith', 'deterministic-guardrails', 'immutable-agent-release', 'constellation-failover'],
  selfAttestedSuccess: true
};

const GOLD_CUA = {
  schemaVersion: '1.0', id: 'openai-cua-harness', familyId: 'openai-cua',
  perception: { kind: 'screenshots' },
  action: { kind: 'virtual-mouse-keyboard', siteApi: false },
  loop: { kind: 'perception-reasoning-action', innerMonologue: true },
  safety: { confirmSensitive: true, sensitive: ['login', 'captcha'] }
};

const NAIVE_CUA = {
  schemaVersion: '1.0', id: 'openai-cua-harness', familyId: 'openai-cua',
  perception: { kind: 'dom-html' },
  action: { kind: 'site-api', siteApi: true },
  loop: { kind: 'tool-calling', innerMonologue: false },
  safety: { confirmSensitive: false, sensitive: [] },
  claimedMotifs: ['pixels-not-apis', 'perception-reasoning-action', 'confirm-sensitive'],
  selfAttestedSuccess: true
};

export const NAIVE = {
  'mini-swe-agent': NAIVE_MINI,
  'n8n-agent': NAIVE_N8N,
  'cognition-devin-cloud': NAIVE_DEVIN,
  'cursor-shadow-workspace': NAIVE_CURSOR,
  'langgraph-durable': NAIVE_LANGGRAPH,
  'openhands-stuck': NAIVE_OPENHANDS,
  'sierra-agent-os': NAIVE_SIERRA,
  'openai-cua': NAIVE_CUA,
  ...CLOSED_NAIVE,
  ...INDUSTRY_NAIVE,
  ...DURABLE_NAIVE
};

export const RESPECTING = {
  'mini-swe-agent': GOLD_MINI,
  'n8n-agent': GOLD_N8N,
  'cognition-devin-cloud': GOLD_DEVIN,
  'cursor-shadow-workspace': GOLD_CURSOR,
  'langgraph-durable': GOLD_LANGGRAPH,
  'openhands-stuck': GOLD_OPENHANDS,
  'sierra-agent-os': GOLD_SIERRA,
  'openai-cua': GOLD_CUA,
  ...CLOSED_RESPECTING,
  ...INDUSTRY_RESPECTING,
  ...DURABLE_RESPECTING
};

function interpretMiniSwe(harness, input) {
  const commands = input.commands ?? [];
  let cwd = '/workspace', steps = 0, formatErrors = 0;
  const trace = [], limits = harness.hostLimits ?? {};
  for (const cmd of commands) {
    if (Number.isFinite(limits.stepLimit) && steps >= limits.stepLimit) return { exit: 'LimitsExceeded', steps, cwd, trace };
    if (cmd.kind === 'invalid') {
      formatErrors += 1; steps += 1;
      if (Number.isFinite(limits.maxConsecutiveFormatErrors) && formatErrors >= limits.maxConsecutiveFormatErrors) {
        return { exit: 'FormatErrorLimit', steps, formatErrors, trace };
      }
      trace.push({ kind: 'invalid' }); continue;
    }
    formatErrors = 0; steps += 1;
    if (cmd.kind === 'cd') {
      if (harness.environment?.persistentShell) cwd = cmd.path;
      trace.push({ kind: 'cd', persistent: !!harness.environment?.persistentShell, cwd }); continue;
    }
    if (cmd.kind === 'pwd') { trace.push({ kind: 'pwd', cwd }); continue; }
    const stdout = String(cmd.stdout ?? ''), returncode = cmd.returncode ?? 0;
    if (harness.stop?.kind === 'stdout-first-line') {
      const lines = stdout.replace(/^\s+/, '').split('\n');
      if (lines[0]?.trim() === harness.stop.token && returncode === (harness.stop.requireReturncode ?? 0)) {
        return { exit: 'Submitted', submission: lines.slice(1).join('\n'), steps, trace };
      }
    } else if (harness.stop?.kind === 'model-says-done' && cmd.modelSaysDone) {
      return { exit: 'Submitted', submission: stdout, steps, trace, selfDeclared: true };
    }
    trace.push({ kind: 'exec', returncode, cwd });
  }
  return { exit: 'Running', steps, cwd, trace };
}

function continuesOnError(node) {
  return node?.continueOnFail === true || ['continueRegularOutput', 'continueErrorOutput'].includes(node?.onError ?? '');
}

function interpretN8n(harness, input) {
  if (input.probe === 'agent-model-socket') {
    const agent = (harness.nodes ?? []).find(n => n.type === 'agent');
    const hasAiLanguageModel = (harness.connections ?? []).some(c => c.to === agent?.id && c.type === 'ai_languageModel');
    return { valid: !!(agent && hasAiLanguageModel), hasAiLanguageModel };
  }
  if (input.probe === 'error-workflow') {
    return {
      kind: harness.errorHandling?.kind ?? 'none',
      separate: harness.errorHandling?.kind === 'separate-error-workflow',
      errorWorkflowId: harness.errorHandling?.errorWorkflowId ?? null,
      inGraphErrorNode: (harness.nodes ?? []).some(n => n.type === 'errorTrigger')
    };
  }
  if (input.probe === 'topology') {
    return { kind: harness.topology?.kind ?? null, dataflow: harness.dataflow?.language ?? null };
  }
  const node = (harness.nodes ?? []).find(n => n.id === input.failNode);
  if (!node) return { status: 'missing-node' };
  if (continuesOnError(node)) {
    const scheduled = (harness.connections ?? []).filter(c => c.from === node.id && c.type === 'main').map(c => c.to);
    return {
      status: 'continued',
      errorOutput: node.onError === 'continueErrorOutput',
      regularOutput: node.onError === 'continueRegularOutput' || node.continueOnFail === true,
      scheduled,
      item: { json: { error: input.errorMessage ?? 'node failed' } }
    };
  }
  return { status: 'workflow-error', scheduled: [] };
}

function interpretDevin(harness, input) {
  if (input.event === 'ci-wait') {
    const snap = harness.persistence?.kind === 'hypervisor-snapshot' && harness.persistence?.idleCompute === 'off';
    return {
      compute: snap ? 'off' : 'on',
      snapshot: snap,
      captures: [...(harness.persistence?.captures ?? [])].sort(),
      restoreOn: snap ? 'ci-result' : null,
      lostOnReschedule: harness.persistence?.kind === 'keep-alive-container'
    };
  }
  if (input.probe === 'isolation') {
    return {
      kind: harness.isolation?.kind ?? null,
      dedicatedKernel: !!harness.isolation?.dedicatedKernel,
      sharedKernel: !!harness.isolation?.sharedKernel
    };
  }
  if (input.event === 'delegate-mechanical') {
    const own = harness.routing?.kind === 'sidekick' && harness.routing?.sidekick?.ownCachedContext === true;
    return { cacheMissOnDelegate: !own, sidekickOwnContext: own, advisorTool: !!harness.routing?.sidekick?.advisorTool };
  }
  if (input.event === 'switch-model') {
    const onlyAt = harness.routing?.modelSwitch?.onlyAt ?? null;
    const allowed = onlyAt === input.at;
    return { allowed, at: input.at, onlyAt, reason: allowed ? 'compaction-already-misses' : 'would-cache-miss' };
  }
  if (input.task === 'judgment-is-deliverable') {
    const owns = harness.lead?.owns ?? [];
    return { leadKeepsJudgment: ['plan', 'ambiguity', 'final-review'].every(x => owns.includes(x)) };
  }
  throw new FoundryError('HARNESS_INTERPRETER', 'Unknown cognition-devin-cloud probe');
}

function interpretCursor(harness, input) {
  if (input.op === 'apply-edit') {
    const hidden = harness.shadow?.userVisible === false && harness.lintLoop?.mutateUserBuffer === false;
    return {
      userVisibleMutated: !hidden,
      shadowMutated: harness.shadow?.kind === 'hidden-window',
      lintsFrom: harness.lintLoop?.observation ?? null
    };
  }
  if (input.op === 'two-ais') {
    const reuse = harness.shadow?.reuseAcrossRequests === true && harness.shadow?.onePerAi === false && harness.interleave?.pauseAis === true;
    return { shadowWindows: reuse ? 1 : 2, interleaved: reuse, pauseAis: !!harness.interleave?.pauseAis };
  }
  throw new FoundryError('HARNESS_INTERPRETER', 'Unknown cursor-shadow-workspace probe');
}

function interpretLangGraph(harness, input) {
  const durable = harness.interrupt?.kind === 'durable-hole' && harness.interrupt?.notError === true;
  const needsCp = harness.interrupt?.requiresCheckpointer === true;
  const hasCp = harness.checkpoint?.enabled === true;
  if (input.op === 'first-interrupt') {
    if (needsCp && !hasCp) return { status: 'failed', reason: 'checkpointer-required', durable: false };
    if (!durable) return { status: 'paused-in-memory', durable: false, resumeFrom: 'after-yield', raises: 'none' };
    return { status: 'interrupted', durable: true, resumeFrom: 'node-start', raises: 'GraphInterrupt' };
  }
  if (input.op === 'resume') {
    if (needsCp && !hasCp) return { status: 'failed', reason: 'checkpointer-required', nodeReexecutedFromStart: false };
    if (harness.interrupt?.reexecuteNodeFromStart === true && harness.interrupt?.resume === 'Command') {
      return { status: 'running', interruptReturns: input.value, nodeReexecutedFromStart: true, continuedAfterYield: false };
    }
    return { status: 'running', interruptReturns: input.value, nodeReexecutedFromStart: false, continuedAfterYield: true };
  }
  throw new FoundryError('HARNESS_INTERPRETER', 'Unknown langgraph-durable probe');
}

function interpretOpenHands(harness, input) {
  const stuckCfg = harness.stuck ?? {};
  if (input.probe === 'context-window-error-loop') {
    return {
      stuck: false,
      implemented: stuckCfg.contextWindowErrorLoop?.implemented === true,
      issue: '282'
    };
  }
  if (stuckCfg.kind !== 'host-pattern-match' || stuckCfg.modelSelfReport === true) {
    return {
      stuck: !!input.modelSaysStuck,
      source: 'self-report',
      pattern: input.modelSaysStuck ? 'self-report' : null,
      nudge: null
    };
  }
  const t = stuckCfg.thresholds ?? {};
  let slice = input.events ?? [];
  let lastUser = -1;
  for (let i = 0; i < slice.length; i++) if (slice[i].kind === 'user-message') lastUser = i;
  if (lastUser >= 0) slice = slice.slice(lastUser + 1);
  slice = slice.slice(-(stuckCfg.window ?? 20));
  const actions = [], observations = [];
  for (let i = slice.length - 1; i >= 0; i--) {
    const e = slice[i];
    if (e.kind === 'action' && actions.length < 8) actions.push(e);
    if ((e.kind === 'observation' || e.kind === 'error') && observations.length < 8) observations.push(e);
  }
  const eq = (a, b) => a && b && a.kind === b.kind && a.key === b.key;
  const ao = t.action_observation ?? 4;
  if (actions.length >= ao && observations.length >= ao
    && actions.slice(0, ao).every(a => eq(a, actions[0]))
    && observations.slice(0, ao).every(o => eq(o, observations[0]))
    && observations[0].kind === 'observation') {
    return { stuck: true, source: 'host-pattern-match', pattern: 'repeating-action-observation', nudge: null };
  }
  const ae = t.action_error ?? 3;
  let streak = 0;
  for (let i = 0; i < Math.min(actions.length, observations.length); i++) {
    if (!eq(actions[i], actions[0])) break;
    if (observations[i].kind !== 'error') break;
    streak += 1;
  }
  if (streak > ae) return { stuck: true, source: 'host-pattern-match', pattern: 'repeating-action-error', nudge: null };
  if (streak === ae) return { stuck: false, source: 'host-pattern-match', pattern: 'action-error-nudge', nudge: 'once' };
  let agentCount = 0;
  for (let i = slice.length - 1; i >= 0; i--) {
    const e = slice[i];
    if (e.kind === 'agent-message') agentCount += 1;
    else if (e.kind === 'user-message') break;
    else if (e.kind === 'condensation') continue;
    else break;
  }
  if (agentCount >= (t.monologue ?? 3)) return { stuck: true, source: 'host-pattern-match', pattern: 'monologue', nudge: null };
  const alt = t.alternating_pattern ?? 6;
  if (actions.length >= alt && observations.length >= alt) {
    const ae = actions.slice(0, alt), oe = observations.slice(0, alt);
    const altEq = arr => {
      for (let i = 0; i < alt - 2; i++) if (!eq(arr[i], arr[i + 2])) return false;
      return true;
    };
    if (altEq(ae) && altEq(oe)) {
      return { stuck: true, source: 'host-pattern-match', pattern: 'alternating-action-observation', nudge: null };
    }
  }
  return { stuck: false, source: 'host-pattern-match', pattern: null, nudge: null };
}

function interpretSierra(harness, input) {
  if (input.probe === 'jailbreak-input') {
    const filter = (harness.supervisors ?? []).some(s => s.role === 'input-filter');
    return { intercepted: filter, layer: filter ? 'input-filter' : 'none' };
  }
  if (input.probe === 'policy-violating-output') {
    const out = (harness.supervisors ?? []).some(s => s.role === 'output-intercept');
    return { intercepted: out, mode: out ? 'observe-or-intercept' : 'none' };
  }
  if (input.probe === 'return-policy') {
    const det = harness.guardrails?.kind === 'deterministic' && Number.isInteger(harness.guardrails?.returnWindowDays);
    return { enforced: det ? 'deterministic' : 'prompt-only', returnWindowDays: det ? harness.guardrails.returnWindowDays : null };
  }
  if (input.probe === 'rollback') {
    const snap = harness.release?.kind === 'immutable-snapshot';
    return { canRollback: snap, includes: [...(harness.release?.includes ?? [])].sort() };
  }
  if (input.probe === 'provider-outage') {
    return { failover: harness.models?.kind === 'constellation' && harness.models?.providerFailover === true && harness.models?.routing === 'task-level' };
  }
  throw new FoundryError('HARNESS_INTERPRETER', 'Unknown sierra-agent-os probe');
}

function interpretCua(harness, input) {
  if (input.op === 'act') {
    return {
      observation: harness.perception?.kind ?? null,
      action: harness.action?.kind ?? null,
      usedSiteApi: harness.action?.siteApi === true
    };
  }
  if (input.op === 'login' || input.op === 'captcha') {
    const confirm = harness.safety?.confirmSensitive === true && (harness.safety?.sensitive ?? []).includes(input.op);
    return { requiresUser: confirm, sensitive: true };
  }
  throw new FoundryError('HARNESS_INTERPRETER', 'Unknown openai-cua probe');
}

export function interpretHarness(harness, input) {
  if (harness?.familyId === 'mini-swe-agent') return interpretMiniSwe(harness, input);
  if (harness?.familyId === 'n8n-agent') return interpretN8n(harness, input);
  if (harness?.familyId === 'cognition-devin-cloud') return interpretDevin(harness, input);
  if (harness?.familyId === 'cursor-shadow-workspace') return interpretCursor(harness, input);
  if (harness?.familyId === 'langgraph-durable') return interpretLangGraph(harness, input);
  if (harness?.familyId === 'openhands-stuck') return interpretOpenHands(harness, input);
  if (harness?.familyId === 'sierra-agent-os') return interpretSierra(harness, input);
  if (harness?.familyId === 'openai-cua') return interpretCua(harness, input);
  const closed = interpretClosed(harness, input);
  if (closed != null) return closed;
  const industry = interpretIndustry(harness, input);
  if (industry != null) return industry;
  const durable = interpretDurable(harness, input);
  if (durable != null) return durable;
  throw new FoundryError('HARNESS_INTERPRETER', 'No host interpreter for this family');
}

function aoPairs(n, actionKey, obsKey, obsKind = 'observation') {
  const events = [{ kind: 'user-message', key: 'start' }];
  for (let i = 0; i < n; i++) {
    events.push({ kind: 'action', key: actionKey });
    events.push({ kind: obsKind, key: obsKey });
  }
  return events;
}

function altPairs(n, aKey, bKey) {
  const events = [{ kind: 'user-message', key: 'start' }];
  for (let i = 0; i < n; i++) {
    const key = i % 2 === 0 ? aKey : bKey;
    events.push({ kind: 'action', key });
    events.push({ kind: 'observation', key });
  }
  return events;
}

const MINI_SCENARIOS = [
  { id: 'complete-token-rc0', input: { commands: [{ stdout: `${TOKEN}\nfixed`, returncode: 0 }] }, expected: { exit: 'Submitted', submission: 'fixed', steps: 1, trace: [] } },
  { id: 'complete-token-rc1', input: { commands: [{ stdout: `${TOKEN}\nfixed`, returncode: 1 }] }, expected: { exit: 'Running', steps: 1, cwd: '/workspace', trace: [{ kind: 'exec', returncode: 1, cwd: '/workspace' }] } },
  { id: 'complete-token-lstrip', input: { commands: [{ stdout: `  \n${TOKEN}\nfixed`, returncode: 0 }] }, expected: { exit: 'Submitted', submission: 'fixed', steps: 1, trace: [] } },
  { id: 'stateless-cd', input: { commands: [{ kind: 'cd', path: '/tmp' }, { kind: 'pwd' }] }, expected: { exit: 'Running', steps: 2, cwd: '/workspace', trace: [{ kind: 'cd', persistent: false, cwd: '/workspace' }, { kind: 'pwd', cwd: '/workspace' }] } },
  { id: 'step-limit', input: { commands: [{ stdout: 'a' }, { stdout: 'b' }, { stdout: 'c' }, { stdout: 'd' }] }, expected: { exit: 'LimitsExceeded', steps: 3, cwd: '/workspace', trace: [{ kind: 'exec', returncode: 0, cwd: '/workspace' }, { kind: 'exec', returncode: 0, cwd: '/workspace' }, { kind: 'exec', returncode: 0, cwd: '/workspace' }] } },
  { id: 'format-errors', input: { commands: [{ kind: 'invalid' }, { kind: 'invalid' }] }, expected: { exit: 'FormatErrorLimit', steps: 2, formatErrors: 2, trace: [{ kind: 'invalid' }] } }
];

const N8N_SCENARIOS = [
  { id: 'fetch-fails-continue', input: { failNode: 'fetch', errorMessage: 'upstream 500' }, expected: { status: 'continued', errorOutput: true, regularOutput: false, scheduled: ['agent'], item: { json: { error: 'upstream 500' } } } },
  { id: 'agent-model-socket', input: { probe: 'agent-model-socket' }, expected: { valid: true, hasAiLanguageModel: true } },
  { id: 'error-workflow', input: { probe: 'error-workflow' }, expected: { kind: 'separate-error-workflow', separate: true, errorWorkflowId: 'wf-error-handler', inGraphErrorNode: false } },
  { id: 'topology', input: { probe: 'topology' }, expected: { kind: 'nodes-connections', dataflow: 'n8n-expression' } }
];

const DEVIN_SCENARIOS = [
  { id: 'ci-wait-snapshot', input: { event: 'ci-wait' }, expected: { compute: 'off', snapshot: true, captures: ['filesystem', 'memory', 'process-tree'], restoreOn: 'ci-result', lostOnReschedule: false } },
  { id: 'isolation-kernel', input: { probe: 'isolation' }, expected: { kind: 'microvm', dedicatedKernel: true, sharedKernel: false } },
  { id: 'sidekick-cache', input: { event: 'delegate-mechanical' }, expected: { cacheMissOnDelegate: false, sidekickOwnContext: true, advisorTool: false } },
  { id: 'switch-at-compaction', input: { event: 'switch-model', at: 'compaction' }, expected: { allowed: true, at: 'compaction', onlyAt: 'compaction', reason: 'compaction-already-misses' } },
  { id: 'switch-mid-turn-forbidden', input: { event: 'switch-model', at: 'mid-turn' }, expected: { allowed: false, at: 'mid-turn', onlyAt: 'compaction', reason: 'would-cache-miss' } },
  { id: 'lead-keeps-judgment', input: { task: 'judgment-is-deliverable' }, expected: { leadKeepsJudgment: true } }
];

const CURSOR_SCENARIOS = [
  { id: 'apply-edit-hidden', input: { op: 'apply-edit' }, expected: { userVisibleMutated: false, shadowMutated: true, lintsFrom: 'lsp-from-shadow' } },
  { id: 'two-ais-one-shadow', input: { op: 'two-ais' }, expected: { shadowWindows: 1, interleaved: true, pauseAis: true } }
];

const LANGGRAPH_SCENARIOS = [
  { id: 'first-interrupt-durable', input: { op: 'first-interrupt' }, expected: { status: 'interrupted', durable: true, resumeFrom: 'node-start', raises: 'GraphInterrupt' } },
  { id: 'resume-reexecutes', input: { op: 'resume', value: 42 }, expected: { status: 'running', interruptReturns: 42, nodeReexecutedFromStart: true, continuedAfterYield: false } }
];

const OPENHANDS_SCENARIOS = [
  { id: 'repeat-action-obs-4', input: { events: aoPairs(4, 'ls', 'listing') }, expected: { stuck: true, source: 'host-pattern-match', pattern: 'repeating-action-observation', nudge: null } },
  { id: 'repeat-action-obs-3', input: { events: aoPairs(3, 'ls', 'listing') }, expected: { stuck: false, source: 'host-pattern-match', pattern: null, nudge: null } },
  { id: 'action-error-nudge', input: { events: aoPairs(3, 'rm', 'denied', 'error') }, expected: { stuck: false, source: 'host-pattern-match', pattern: 'action-error-nudge', nudge: 'once' } },
  { id: 'action-error-stuck', input: { events: aoPairs(4, 'rm', 'denied', 'error') }, expected: { stuck: true, source: 'host-pattern-match', pattern: 'repeating-action-error', nudge: null } },
  { id: 'model-says-stuck-ignored', input: { events: aoPairs(1, 'ls', 'listing'), modelSaysStuck: true }, expected: { stuck: false, source: 'host-pattern-match', pattern: null, nudge: null } },
  { id: 'alternating-6', input: { events: altPairs(6, 'ls', 'cat') }, expected: { stuck: true, source: 'host-pattern-match', pattern: 'alternating-action-observation', nudge: null } },
  { id: 'context-window-unimplemented', input: { probe: 'context-window-error-loop' }, expected: { stuck: false, implemented: false, issue: '282' } }
];

const SIERRA_SCENARIOS = [
  { id: 'jailbreak-input', input: { probe: 'jailbreak-input' }, expected: { intercepted: true, layer: 'input-filter' } },
  { id: 'policy-output', input: { probe: 'policy-violating-output' }, expected: { intercepted: true, mode: 'observe-or-intercept' } },
  { id: 'return-window', input: { probe: 'return-policy' }, expected: { enforced: 'deterministic', returnWindowDays: 30 } },
  { id: 'rollback-release', input: { probe: 'rollback' }, expected: { canRollback: true, includes: ['knowledge', 'model-versions', 'prompts', 'source'] } },
  { id: 'provider-outage', input: { probe: 'provider-outage' }, expected: { failover: true } }
];

const CUA_SCENARIOS = [
  { id: 'pixels-mouse', input: { op: 'act' }, expected: { observation: 'screenshots', action: 'virtual-mouse-keyboard', usedSiteApi: false } },
  { id: 'login-confirm', input: { op: 'login' }, expected: { requiresUser: true, sensitive: true } },
  { id: 'captcha-confirm', input: { op: 'captcha' }, expected: { requiresUser: true, sensitive: true } }
];

function pack(id, intent, publicInterface, marker, paths, harness, scenarios) {
  return {
    id,
    builderPack: {
      intent,
      publicInterface,
      ideologicalReasons: MOTIFS[id].map(m => ({ motif: m.id, why: m.why }))
    },
    heldOut: {
      uniqueMarker: marker,
      paths,
      target: { marker, harness, scenarios }
    }
  };
}

export const FAMILY_SPECS = {
  'mini-swe-agent': pack(
    'mini-swe-agent',
    'Construct a production-grade coding-agent micro-harness whose public protocol matches mini-SWE-agent: bash-only actions, independent subprocess execution with process-group kill, stdout completion token requiring returncode 0, host limits, linear LM-message trajectory, InterruptAgentFlow exceptions rather than flags.',
    {
      action: 'A single bash command string. No tool-calling schema.',
      environment: 'Popen with start_new_session and process-group kill; not a persistent shell. Prefix cd/export on every command. FAQ says subprocess.run; the implementation is Popen+killpg.',
      completion: { stdoutFirstLine: TOKEN, requireReturncode: 0, lstrip: true },
      hostLimits: ['stepLimit', 'costLimit', 'wallTimeMs', 'maxConsecutiveFormatErrors'],
      memory: 'linear-lm-messages',
      controlFlow: 'interrupt-exceptions'
    },
    MINI_MARKER, ['construction-heldout://mini-swe-agent', 'heldout/mini-swe-agent.target.json'], GOLD_MINI, MINI_SCENARIOS
  ),
  'n8n-agent': pack(
    'n8n-agent',
    'Construct a production-grade automation-agent micro-harness whose public protocol matches n8n: nodes+connections JSON, per-node continueOnFail/onError join, AI socket edges into an Agent, Error Trigger as a separate workflow, expression dataflow.',
    {
      topology: 'nodes-connections',
      dataflow: 'n8n-expression',
      continueOnError: { continueOnFail: true, onError: ['continueRegularOutput', 'continueErrorOutput'] },
      aiSockets: [...AI_SOCKETS],
      errorHandling: 'separate-error-workflow'
    },
    N8N_MARKER, ['construction-heldout://n8n-agent', 'heldout/n8n-agent.target.json'], GOLD_N8N, N8N_SCENARIOS
  ),
  'cognition-devin-cloud': pack(
    'cognition-devin-cloud',
    'Construct a cloud coding-agent harness matching Cognition’s public Devin protocol: microVM isolation, hypervisor snapshot across async SDLC gaps, sidekick with its own prefix cache, model switch only at compaction, lead keeps judgment.',
    {
      isolation: 'microvm dedicated kernel, not a shared-kernel container',
      persistence: 'hypervisor snapshot of memory, process-tree, filesystem; idle compute off; restore on CI/review',
      routing: 'sidekick full agent with own cached context; not an advisor tool',
      modelSwitch: 'only at compaction',
      lead: 'delegate-and-monitor; owns plan, ambiguity, final-review'
    },
    DEVIN_MARKER, ['construction-heldout://cognition-devin-cloud', 'heldout/cognition-devin-cloud.target.json'], GOLD_DEVIN, DEVIN_SCENARIOS
  ),
  'cursor-shadow-workspace': pack(
    'cursor-shadow-workspace',
    'Construct an editor-agent harness matching Cursor’s public shadow-workspace protocol: hidden window for AI edits/lints, one reused shadow, AIs paused and interleaved because they do not notice time.',
    {
      shadow: 'hidden Electron window, not the user buffer',
      reuse: 'one shadow reused across requests, not one per AI',
      interleave: 'pause AIs and reset overlay state; AIs do not notice time',
      lint: 'LSP observations from the shadow'
    },
    CURSOR_MARKER, ['construction-heldout://cursor-shadow-workspace', 'heldout/cursor-shadow-workspace.target.json'], GOLD_CURSOR, CURSOR_SCENARIOS
  ),
  'langgraph-durable': pack(
    'langgraph-durable',
    'Construct a graph harness matching LangGraph’s public interrupt protocol: interrupt() is a durable hole that raises GraphInterrupt, requires a checkpointer, resumes via Command, and re-executes the node from the start.',
    {
      interrupt: 'durable-hole raising GraphInterrupt, not an error and not a yield',
      resume: 'Command; node re-executes from start; interrupt() then returns the resume value',
      checkpoint: 'required for interrupt'
    },
    LANGGRAPH_MARKER, ['construction-heldout://langgraph-durable', 'heldout/langgraph-durable.target.json'], GOLD_LANGGRAPH, LANGGRAPH_SCENARIOS
  ),
  'openhands-stuck': pack(
    'openhands-stuck',
    'Construct a coding-agent loop-exit harness matching OpenHands SDK stuck detection: host pattern-match on a windowed event stream, one action-error nudge, and an honest unimplemented context-window loop (issue 282).',
    {
      stuck: 'host-pattern-match on events since last user message, window 20',
      thresholds: { action_observation: 4, action_error: 3, monologue: 3, alternating_pattern: 6 },
      nudge: 'once when action-error streak hits threshold; stuck after one extra repeat',
      contextWindowErrorLoop: 'unimplemented; agent-sdk issue 282'
    },
    OPENHANDS_MARKER, ['construction-heldout://openhands-stuck', 'heldout/openhands-stuck.target.json'], GOLD_OPENHANDS, OPENHANDS_SCENARIOS
  ),
  'sierra-agent-os': pack(
    'sierra-agent-os',
    'Construct a customer-experience agent harness matching Sierra’s public Agent OS: independent supervisors, deterministic guardrails vs declarative goals, immutable releases, constellation routing with provider failover.',
    {
      supervisors: ['input-filter', 'output-intercept'],
      goals: 'declarative',
      guardrails: 'deterministic (example: return window in days)',
      release: 'immutable snapshot of source, prompts, model-versions, knowledge',
      models: 'constellation, task-level routing, provider failover'
    },
    SIERRA_MARKER, ['construction-heldout://sierra-agent-os', 'heldout/sierra-agent-os.target.json'], GOLD_SIERRA, SIERRA_SCENARIOS
  ),
  'openai-cua': pack(
    'openai-cua',
    'Construct a computer-use harness matching OpenAI CUA’s public protocol: screenshot perception, virtual mouse/keyboard (not site APIs), perception-reasoning-action with inner monologue, user confirmation for login and captcha.',
    {
      perception: 'screenshots',
      action: 'virtual-mouse-keyboard, siteApi false',
      loop: 'perception-reasoning-action with inner monologue',
      safety: { confirmSensitive: true, sensitive: ['login', 'captcha'] }
    },
    CUA_MARKER, ['construction-heldout://openai-cua', 'heldout/openai-cua.target.json'], GOLD_CUA, CUA_SCENARIOS
  ),
  ...CLOSED_FAMILY_SPECS,
  ...INDUSTRY_FAMILY_SPECS,
  ...DURABLE_FAMILY_SPECS
};

export const PUBLIC_HARNESS_CATALOG = Object.freeze([
  { id: 'cognition-devin-cloud', company: 'Cognition', product: 'Devin', domain: 'software', encoded: true, evidence: 'https://cognition.com/blog/what-we-learned-building-cloud-agents (2026-04-23); https://cognition.com/blog/devin-fusion (2026-06-29)' },
  { id: 'cursor-shadow-workspace', company: 'Anysphere', product: 'Cursor shadow workspace', domain: 'software-editor', encoded: true, evidence: 'https://cursor.com/blog/shadow-workspace (2024-09)' },
  { id: 'sierra-agent-os', company: 'Sierra', product: 'Agent OS', domain: 'customer-support', encoded: true, evidence: 'https://sierra.ai/blog/enterprise-grade-agents (2025-10-02); https://sierra.ai/blog/agent-development-life-cycle (2024-06-03); https://sierra.ai/blog/constellation-of-models (2025-12-03)' },
  { id: 'openai-cua', company: 'OpenAI', product: 'Operator / CUA', domain: 'computer-use', encoded: true, evidence: 'https://openai.com/index/computer-using-agent/' },
  ...CLOSED_CATALOG,
  ...INDUSTRY_CATALOG,
  ...DURABLE_CATALOG,
  { id: 'adept-act1', company: 'Adept (Amazon AGI acqui-hire 2024)', product: 'ACT-1', domain: 'computer-use', encoded: false, note: 'Historical precursor to CUA; product no longer ships. Viewport-rendering motif recorded in openai-cua why-string only. Amazon Nova Act is encoded separately and must not be mixed into CUA gold.' },
  { id: 'windsurf-cascade', company: 'Windsurf / Codeium', product: 'Cascade', domain: 'software-editor', encoded: false, note: 'Editor agent; public protocol thinner than Cursor shadow-workspace / VS Code Copilot harness post.' },
  { id: 'replit-agent', company: 'Replit', product: 'Agent', domain: 'software', encoded: false, note: 'Cloud IDE agent; environment is the product more than a published harness motif.' },
  { id: 'decagon', company: 'Decagon', product: 'Decagon', domain: 'customer-support', encoded: false, note: '2025-11-20 fine-tuning post: specialized small models for intent/AOP/hallucination/escalation, not a checkable loop protocol. Adjacent to Sierra constellation; not encoded as a family.' },
  { id: 'lindy', company: 'Lindy', product: 'Lindy', domain: 'workflow-automation', encoded: false, note: 'Email/workflow agents; n8n already covers nodes+connections ideology.' },
  { id: 'zapier-agents', company: 'Zapier', product: 'Agents', domain: 'workflow-automation', encoded: false, note: 'Adjacent to n8n; not a distinct hostile fixture this round.' },
  { id: 'hebbia-deeper-research', company: 'Hebbia', product: 'Deeper Research', domain: 'legal+finance-research', encoded: false, note: '2025-07-30 ISD citations, context-distillation agent, section-by-section output. Adjacent to hebbia-matrix; not a second family this round so Matrix 2.0 orchestrator-no-tools stays the checkable fixture.' },
  { id: 'hippocratic', company: 'Hippocratic AI', product: 'healthcare agents', domain: 'healthcare', encoded: false, note: 'Safety-voice agents; no public loop protocol sufficient for a held-out fixture.' },
  { id: 'covariant', company: 'Covariant', product: 'RFM', domain: 'robotics', encoded: false, note: 'Foundation model for robots; not a software harness protocol.' },
  { id: 'pagerduty-aiops', company: 'PagerDuty', product: 'AIOps / Agentic SRE', domain: 'sre', encoded: false, note: 'Incident products; Foundry already has SRE evals — not this compiler family.' },
  { id: 'sourcegraph-amp', company: 'Sourcegraph', product: 'Amp', domain: 'software-editor', encoded: false, note: 'Editor agent; no first-party isolation/durability protocol at fixture grade this round.' },
  { id: 'manus', company: 'Manus', product: 'Manus', domain: 'general-agent', encoded: false, note: 'Product marketing; no first-party checkable loop protocol this round.' },
  { id: 'futurehouse-robin', company: 'FutureHouse', product: 'Robin', domain: 'science-discovery', encoded: false, note: '2026 Nature multi-agent discovery orchestrating Crow/Falcon/Finch with humans executing wet lab. PaperQA2 is the encoded checkable RAG protocol; Robin’s lab loop is not a software-harness fixture.' },
  { id: 'salesforce-agentforce', company: 'Salesforce', product: 'Agentforce', domain: 'crm-agents', encoded: false, note: 'Public material is product marketing and Einstein/Data Cloud packaging; no checkable durable-execution or supervisor protocol at fixture grade this round. Distinct from encoded Intercom Fin / Sierra Agent OS.' },
  { id: 'uipath', company: 'UiPath', product: 'Maestro / Agent Builder', domain: 'rpa-orchestration', encoded: false, note: 'RPA + agent orchestration; public protocol thinner than Temporal/n8n fixtures. Not encoded as a family this round.' },
  { id: 'microsoft-power-automate', company: 'Microsoft', product: 'Power Automate', domain: 'workflow-automation', encoded: false, note: 'Cloud flow product; n8n already covers nodes+connections ideology. Not a distinct hostile fixture this round.' },
  { id: 'aws-step-functions', company: 'Amazon Web Services', product: 'Step Functions', domain: 'durable-execution', encoded: false, note: 'ASL state machines are a different product than Temporal/Restate/Inngest. Encoded durable families stay those three plus the intent lattice; Step Functions is an honest negative until a first-party ASL fixture is sealed.' }
]);
