import { FoundryError } from './data.mjs';

const CODEX_MARKER = 'HELD_OUT_OPENAI_CODEX_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';
const COPILOT_VSCODE_MARKER = 'HELD_OUT_GITHUB_COPILOT_VSCODE_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';
const COPILOT_CLOUD_MARKER = 'HELD_OUT_GITHUB_COPILOT_CODING_AGENT_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';
const HEBBIA_MARKER = 'HELD_OUT_HEBBIA_MATRIX_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';
const NOVA_MARKER = 'HELD_OUT_AMAZON_NOVA_ACT_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';
const JULES_MARKER = 'HELD_OUT_GOOGLE_JULES_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';
const PAPERQA_MARKER = 'HELD_OUT_FUTUREHOUSE_PAPERQA2_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';

const CODEX_THREAD_OPS = Object.freeze(['archive', 'fork', 'resume', 'start']);
const JULES_SURFACES = Object.freeze(['api', 'cli', 'gemini-cli', 'web']);
const PAPERQA_TOOLS = Object.freeze(['citation-traversal', 'gather-evidence', 'generate-answer', 'paper-search']);
const HARNESS_OWNS = Object.freeze(['agent-loop', 'context-assembly', 'tool-execution', 'tool-exposure']);

export const INDUSTRY_MOTIFS = {
  'openai-codex': [
    {
      id: 'app-server-jsonrpc-stdio',
      why: 'OpenAI 2026 “Unlocking the Codex harness”: CLI, IDE, macOS app and web are clients of one Codex App Server. Transport is bidirectional JSON-RPC over stdio (JSONL). The App Server hosts Codex core threads, translates client requests into core ops and core’s internal event stream into a small stable notification set. A REST-chat wrapper around the model is not this protocol.',
      inspect: c => c.surfaces?.share === 'app-server' && c.transport?.kind === 'jsonrpc-stdio' && c.transport?.bidirectional === true
    },
    {
      id: 'thread-durable-container',
      why: 'Same post + app-server-protocol ThreadStart/Resume/Fork/Archive: a Thread is the durable conversation container. Turns live inside it. Clients reconnect and catch up; the browser tab is not the source of truth. Observed protocol_v1.md: Session has at most one Task; parallelism is one Codex process per thread of work.',
      inspect: c => c.thread?.kind === 'durable-container' && Array.isArray(c.thread?.ops) && CODEX_THREAD_OPS.every(op => c.thread.ops.includes(op)) && c.thread?.clientIsSourceOfTruth === false && c.session?.maxConcurrentTasks === 1
    },
    {
      id: 'server-initiated-approval-pause',
      why: 'App Server is fully bidirectional: the server initiates requests (exec approval, file-change approval, MCP elicitation) and pauses the turn until the client responds. protocol_v1: a Task is blocked by user approval. Fire-and-forget tool execution is the naive reconstruction.',
      inspect: c => c.approvals?.kind === 'server-initiated' && c.approvals?.pausesTurn === true
    },
    {
      id: 'task-ends-when-turn-yields-nothing',
      why: 'Observed protocol_v1.md (entities 3–4) and live run_turn: a Turn is one model request + tool/patch execution; a Turn yielding no function-call/tool output to feed another sampling terminates the inner turn (assistant-only completes). “Model said done” without the no-output conjunct is not this stop rule. Extra user-turn input is a separate motif: live App Server steers rather than aborting.',
      inspect: c => c.loop?.taskEndsWhen === 'turn-yields-no-output'
    },
    {
      id: 'web-container-not-tab',
      why: 'Unlocking the Codex harness: Codex Web provisions a container, launches the App Server binary inside it, and streams HTTP/SSE to the browser. Because tabs close, the web app cannot be the source of truth; work continues if the tab disappears. Loop-on-the-tab is the coupling they removed.',
      inspect: c => c.web?.kind === 'container-app-server' && c.web?.tabIsSourceOfTruth === false && c.web?.survivesTabClose === true
    },
    {
      id: 'resume-rejoin-vs-fork-copy',
      why: 'App Server thread.rs + thread_lifecycle: resume of a running thread rejoins the same durable container and replays pending approval requests on the new connection. Fork copies a frozen prefix into a new thread. lastTurnId (inclusive) cannot combine with beforeTurnId (exclusive). You cannot fork through an in-progress turn. Listing start/resume/fork/archive as ops is not this ideology.',
      inspect: c => c.thread?.resume?.kind === 'same-thread-rejoin' && c.thread?.resume?.replaysPendingApprovals === true && c.thread?.fork?.kind === 'new-history-copy' && c.thread?.fork?.lastTurnIdExclusiveWithBeforeTurnId === true && c.thread?.fork?.cannotForkInProgressTurn === true
    },
    {
      id: 'compaction-summary-last',
      why: 'core/compact.rs: mid-turn compaction injects initial context BeforeLastUserMessage because the model is trained to see the compaction summary as the last history item. Pre-turn/manual compact uses DoNotInject. thread/compact/start is a first-class op. Drop-oldest or inject-after-summary is the wrong protocol.',
      inspect: c => c.compaction?.firstClassOp === true && c.compaction?.midTurnInjection === 'before-last-user-message' && c.compaction?.summaryLast === true
    },
    {
      id: 'approval-orthogonal-to-sandbox',
      why: 'AskForApproval (untrusted|on-request|granular|never) and SandboxMode (read-only|workspace-write|danger-full-access) are two sliders. Combining permissions AND sandbox on thread start/resume/fork/settings is invalid_request. Folding them into permissionLevel is the naive reconstruction.',
      inspect: c => c.isolation?.approvalPolicyKind === 'ask-for-approval' && c.isolation?.sandboxModeKind === 'sandbox-mode' && c.isolation?.combiningPermissionsAndSandbox === 'invalid' && c.isolation?.foldedIntoPermissionLevel === false
    },
    {
      id: 'lazy-thread-rollout',
      why: 'thread/start does not write a rollout until the first user message. An unused thread is not guaranteed to survive restart. Resume/read of an unmaterialized thread is invalid_request (“no rollout found”). Clients must not treat start as “history now exists on disk.”',
      inspect: c => c.thread?.rolloutUntil === 'first-user-message' && c.thread?.unusedSurvivesRestart === false
    },
    {
      id: 'extra-input-steers-not-abort',
      why: 'Live App Server start_or_steer_turn / turn/steer: extra user-turn input steers the current Task and returns the active turn id. Abort is turn/interrupt, not a new user message. protocol_v1 “additional user-turn input aborts the current task” is stale (the spec admits code may not match).',
      inspect: c => c.loop?.userInputSteersTask === true && c.loop?.userInputAbortsTask === false && c.loop?.abort === 'turn-interrupt'
    }
  ],
  'github-copilot-vscode': [
    {
      id: 'harness-is-the-product',
      why: 'VS Code 2026-05-15 “The Coding Harness Behind GitHub Copilot”: the model only produces text. The harness owns context assembly, tool exposure, tool execution and the agent loop. Copilot is multi-provider, so a new model needs per-model system prompts, tool sets and conversation management — not a picker flip.',
      inspect: c => Array.isArray(c.harness?.owns) && HARNESS_OWNS.every(x => c.harness.owns.includes(x)) && c.model?.interchangeable === true && c.model?.perModelCalibration === true
    },
    {
      id: 'prompt-rebuilt-every-round',
      why: 'Same post: a user turn contains many rounds. Each round rebuilds the prompt (system + context + history + all tool results so far) so the model sees the latest workspace, including an edit from three rounds ago. Append-only transcripts that freeze the workspace snapshot are a different harness.',
      inspect: c => c.prompt?.rebuild === 'every-round' && c.prompt?.seesLatestWorkspace === true && c.loop?.kind === 'turn-of-rounds'
    },
    {
      id: 'stop-hooks-can-refuse',
      why: 'Same post: the loop is bounded by a tool-call limit, cancellation between rounds, and stop hooks. Stop hooks inspect agent state and may refuse to finish, pushing the agent to keep working. Empty tool-calls is not an unconditional halt.',
      inspect: c => c.stopHooks?.canRefuseFinish === true && c.loop?.stop === 'no-tool-calls-or-stop-hooks'
    },
    {
      id: 'custom-agent-restricts-tools',
      why: 'Same post: custom agents (`.agent.md`) can restrict the tool set to a subset. MCP/extensions can add tools; users can toggle tools. A fixed global tool catalog is the thing they refused so agent modes stay specialized.',
      inspect: c => c.customAgents?.file === '.agent.md' && c.customAgents?.canRestrictTools === true
    }
  ],
  'github-copilot-coding-agent': [
    {
      id: 'actions-ephemeral-not-ide',
      why: 'GitHub docs “About Copilot cloud agent”: this product is not IDE agent mode. Coding happens in an ephemeral GitHub Actions environment. Docs explicitly contrast it with agent mode that edits the local workspace. Mixing the two is the named confusion.',
      inspect: c => c.environment?.kind === 'github-actions-ephemeral' && c.environment?.ideAgentMode === false && c.environment?.laptop === false
    },
    {
      id: 'issue-comments-frozen-at-assign',
      why: 'GitHub how-to “kick-off-a-task”: Copilot receives issue title, description and existing comments at assignment time. It does not see comments added after assignment; follow-up belongs on the pull request. A live issue-thread listener is a different product.',
      inspect: c => c.issue?.seesCommentsAfterAssignment === false && c.followUp?.surface === 'pull-request'
    },
    {
      id: 'hard-59-minute',
      why: 'Same about-coding-agent: each session has a maximum execution time of 59 minutes. Hard limit, cannot be extended or bypassed. Shorter is allowed via timeout-minutes in copilot-setup-steps.yml. Eternal cloud loops are what they refused.',
      inspect: c => c.limits?.maxMinutes === 59 && c.limits?.extendable === false
    },
    {
      id: 'firewall-bash-not-mcp',
      why: 'GitHub “customize the agent firewall”: by default internet is limited. The firewall only applies to processes started by the agent via its Bash tool. It does not apply to MCP servers or processes started in Copilot setup steps. A harness that claims whole-VM egress control is over-claiming their published coverage.',
      inspect: c => c.firewall?.appliesTo === 'agent-bash-tool' && c.firewall?.appliesToMcp === false && c.firewall?.appliesToSetupSteps === false && c.firewall?.warnsOnBlocked === true
    },
    {
      id: 'one-repo-one-pr',
      why: 'About-coding-agent limitations: Copilot can only change the specified repository, work on one branch at a time, and open exactly one pull request per assigned task. Multi-repo / multi-PR runs are out of protocol.',
      inspect: c => c.scope?.repos === 1 && c.scope?.branchesAtATime === 1 && c.scope?.pullRequestsPerTask === 1
    }
  ],
  'hebbia-matrix': [
    {
      id: 'orchestrator-never-tools',
      why: 'Hebbia 2025-06-17 Matrix Agent 2.0: the orchestrator never directly invokes tools. It passes a text “detailed objective” to a named subagent. It is given the subagent’s name and capability description only — not the tools inside. Agent 1.0’s tool-soup caused mis-invocations; isolation is the ideology.',
      inspect: c => c.orchestrator?.invokesTools === false && c.orchestrator?.dispatch === 'text-objective-to-subagent'
    },
    {
      id: 'typed-hierarchical-context',
      why: 'Same post: they wrote their own framework because OSS agent frameworks lacked strongly typed hierarchical context classes. A single overloaded context bag is the failure mode they named. Developers must reuse an existing context class rather than adding fields.',
      inspect: c => c.context?.kind === 'typed-hierarchical' && c.context?.singleOverloadedBag === false
    },
    {
      id: 'history-tagged-by-agent',
      why: 'Same post: every message in message_history is tagged with the producing agent so subagents can filter. The orchestrator must not see which columns the Read Matrix subagent opened; the output agent may. Untagged shared transcripts reintroduce needle-in-haystack.',
      inspect: c => c.history?.taggedByAgent === true && c.history?.subagentsFilter === true
    },
    {
      id: 'specialized-subagents-not-tool-soup',
      why: 'Same post: Read vs Output (and other) subagents are isolated so tool-use hallucinations collapse. Each subagent can be tested alone. Bundling every tool into one agent is Agent 1.0, which they threw away.',
      inspect: c => Array.isArray(c.subagents) && c.subagents.includes('read') && c.subagents.includes('output') && c.toolHallucinationMitigation === 'isolate-per-subagent'
    }
  ],
  'amazon-nova-act': [
    {
      id: 'atomic-commands-not-high-level-goal',
      why: 'Amazon AGI 2025-03-31 Nova Act: high-level goal prompting still needs hovering. The SDK breaks workflows into reliable atomic commands (search, checkout, date-pick, dismiss popup). High-level-as-the-unit is the thing they refused. Distinct from OpenAI CUA’s screenshot + virtual-mouse PRA loop.',
      inspect: c => c.commands?.kind === 'atomic' && c.commands?.highLevelGoalAsUnit === false
    },
    {
      id: 'python-interleaved-with-nl',
      why: 'Same post + AWS ML 2025-07-28: developers interleave Python (tests, breakpoints, asserts, thread pools) with natural-language atomic commands, and may drop to Playwright for passwords and other sensitive actuation. A pure-NL computer-use loop is a different product.',
      inspect: c => c.script?.language === 'python' && c.script?.interleaveNaturalLanguage === true && c.script?.playwrightFallback === true
    },
    {
      id: 'unified-train-model-sdk-browser',
      why: 'Amazon Science 2025-12-02: they train the custom Nova model, SDK, orchestrator and browser controllers as one system in RL gyms. Bolting a general model onto a separate browser tool is the reliability failure they named.',
      inspect: c => c.training?.unified === true && c.training?.boltOnComponents === false
    },
    {
      id: 'playwright-for-secrets',
      why: 'Nova Act intro: alternate direct Playwright manipulation “to further strengthen reliability (e.g., for entering passwords)”. The model typing credentials is out of protocol.',
      inspect: c => c.secrets?.entry === 'playwright-not-model'
    }
  ],
  'google-jules': [
    {
      id: 'cloud-vm-not-laptop',
      why: 'Google Labs 2025-05-20 Jules: clones the repository into a secure Google Cloud VM and works asynchronously. “Works on real codebases: Jules doesn’t need a sandbox” here means it takes full project context in that VM — not that isolation is absent, and not Cognition’s dedicated-kernel microVM + hypervisor snapshot. Do not mix.',
      inspect: c => c.environment?.kind === 'gcp-cloud-vm' && c.environment?.async === true && c.environment?.laptop === false && c.environment?.microvmDedicatedKernel === false
    },
    {
      id: 'plan-before-diff',
      why: 'Same post: visible workflow shows plan and reasoning before making changes. User steerability: modify the plan before, during, and after execution. Mutate-then-show-diff is the opposite protocol.',
      inspect: c => c.plan?.beforeDiff === true && Array.isArray(c.steer?.moments) && ['after', 'before', 'during'].every(m => c.steer.moments.includes(m))
    },
    {
      id: 'critic-after-replan',
      why: 'Google Developers 2025-11-19: the critic agent re-engages after replanning so longer tasks stay on track. A one-shot critic at the end is not this protocol.',
      inspect: c => c.critic?.reengagesAfterReplan === true
    },
    {
      id: 'surfaces-share-project',
      why: 'Same Gemini-3-in-Jules post: web, Jules Tools CLI, Gemini CLI extension and Jules API share the same view of the project so you can move between surfaces without losing context.',
      inspect: c => c.surfaces?.share === 'same-project-view' && Array.isArray(c.surfaces?.kinds) && JULES_SURFACES.every(s => c.surfaces.kinds.includes(s))
    },
    {
      id: 'repoless-allowed',
      why: 'google-labs-code/jules-sdk: sessions can run without a GitHub repository (“repoless”) as preconfigured VM images with Node/Python/Rust/Bun. GitHub clone is the common path, not a hard requirement.',
      inspect: c => c.repoless?.allowed === true && c.repoless?.kind === 'preconfigured-vm-image'
    }
  ],
  'futurehouse-paperqa2': [
    {
      id: 'agentic-rag-four-tools',
      why: 'FutureHouse 2024-09-19 PaperQA2: the agent orchestrates Paper Search, Gather Evidence, Generate Answer, and Citation Traversal. Dumping retrieved chunks into one prompt is the commercial-RAG default they rejected for accuracy.',
      inspect: c => Array.isArray(c.tools) && PAPERQA_TOOLS.every(t => c.tools.includes(t))
    },
    {
      id: 'rcs-summaries-not-raw-chunks',
      why: 'Same post: Gather Evidence is two-phase — embed-rank then embarrassingly parallel LLM re-rank + contextual summarization (RCS). Only the summaries are injected into the answer prompt (≈5.6× compression from 9k-char chunks). Raw-chunk answers are out of protocol. Weaker models (GPT-3.5) made RCS worse than skipping it.',
      inspect: c => c.gather?.kind === 'rcs' && c.gather?.answerSees === 'summaries-not-raw-chunks'
    },
    {
      id: 'citation-traversal-from-high-rcs',
      why: 'Same post: citation traversal walks one degree forward (future citers) and back (past references) from papers whose RCS score is ≥ 8. Traversing the whole graph or traversing low-score papers is not this recall tool.',
      inspect: c => c.citationTraversal?.degrees === 1 && c.citationTraversal?.direction === 'forward-and-back' && c.citationTraversal?.minRcs === 8
    },
    {
      id: 'accuracy-over-cost',
      why: 'PaperQA2’s stated design goal is accuracy, not cost or latency. RCS top-k depth couples compute to accuracy (monotonic until saturation ~20–30). Cost-first RAG that skips RCS or citation traversal is a different product.',
      inspect: c => c.objective?.primary === 'accuracy' && c.objective?.costFirst === false && c.rcs?.computeCoupledToAccuracy === true
    }
  ]
};

const GOLD_CODEX = {
  schemaVersion: '1.0', id: 'openai-codex-harness', familyId: 'openai-codex',
  surfaces: { share: 'app-server', kinds: ['cli', 'ide', 'macos-app', 'web'] },
  transport: { kind: 'jsonrpc-stdio', bidirectional: true },
  thread: {
    kind: 'durable-container', ops: ['start', 'resume', 'fork', 'archive'], clientIsSourceOfTruth: false,
    resume: { kind: 'same-thread-rejoin', replaysPendingApprovals: true },
    fork: { kind: 'new-history-copy', lastTurnIdExclusiveWithBeforeTurnId: true, cannotForkInProgressTurn: true },
    rolloutUntil: 'first-user-message', unusedSurvivesRestart: false
  },
  session: { maxConcurrentTasks: 1, parallelism: 'one-codex-per-thread' },
  approvals: { kind: 'server-initiated', pausesTurn: true },
  loop: { taskEndsWhen: 'turn-yields-no-output', userInputAbortsTask: false, userInputSteersTask: true, abort: 'turn-interrupt' },
  compaction: { firstClassOp: true, midTurnInjection: 'before-last-user-message', summaryLast: true },
  isolation: { approvalPolicyKind: 'ask-for-approval', sandboxModeKind: 'sandbox-mode', combiningPermissionsAndSandbox: 'invalid', foldedIntoPermissionLevel: false },
  web: { kind: 'container-app-server', tabIsSourceOfTruth: false, survivesTabClose: true }
};

const NAIVE_CODEX = {
  schemaVersion: '1.0', id: 'openai-codex-harness', familyId: 'openai-codex',
  surfaces: { share: 'per-client-chat', kinds: ['prompt-box'] },
  transport: { kind: 'rest-request-response', bidirectional: false },
  thread: {
    kind: 'browser-tab', ops: ['send'], clientIsSourceOfTruth: true,
    resume: { kind: 'new-thread', replaysPendingApprovals: false },
    fork: { kind: 'same-thread-rename', lastTurnIdExclusiveWithBeforeTurnId: false, cannotForkInProgressTurn: false },
    rolloutUntil: 'thread-start', unusedSurvivesRestart: true
  },
  session: { maxConcurrentTasks: 8, parallelism: 'in-process-tasks' },
  approvals: { kind: 'fire-and-forget', pausesTurn: false },
  loop: { taskEndsWhen: 'model-says-done', userInputAbortsTask: true, userInputSteersTask: false, abort: 'new-user-message' },
  compaction: { firstClassOp: false, midTurnInjection: 'after-summary', summaryLast: false },
  isolation: { approvalPolicyKind: 'permission-level', sandboxModeKind: 'folded', combiningPermissionsAndSandbox: 'allowed', foldedIntoPermissionLevel: true },
  web: { kind: 'loop-in-tab', tabIsSourceOfTruth: true, survivesTabClose: false },
  claimedMotifs: ['app-server-jsonrpc-stdio', 'thread-durable-container', 'server-initiated-approval-pause', 'task-ends-when-turn-yields-nothing', 'web-container-not-tab', 'resume-rejoin-vs-fork-copy', 'compaction-summary-last', 'approval-orthogonal-to-sandbox', 'lazy-thread-rollout', 'extra-input-steers-not-abort'],
  selfAttestedSuccess: true
};

const GOLD_COPILOT_VSCODE = {
  schemaVersion: '1.0', id: 'github-copilot-vscode-harness', familyId: 'github-copilot-vscode',
  harness: { owns: ['context-assembly', 'tool-exposure', 'tool-execution', 'agent-loop'] },
  model: { interchangeable: true, perModelCalibration: true },
  prompt: { rebuild: 'every-round', seesLatestWorkspace: true },
  loop: { kind: 'turn-of-rounds', stop: 'no-tool-calls-or-stop-hooks' },
  stopHooks: { canRefuseFinish: true },
  customAgents: { file: '.agent.md', canRestrictTools: true }
};

const NAIVE_COPILOT_VSCODE = {
  schemaVersion: '1.0', id: 'github-copilot-vscode-harness', familyId: 'github-copilot-vscode',
  harness: { owns: ['prompt'] },
  model: { interchangeable: true, perModelCalibration: false },
  prompt: { rebuild: 'never', seesLatestWorkspace: false },
  loop: { kind: 'single-call', stop: 'empty-tool-calls' },
  stopHooks: { canRefuseFinish: false },
  customAgents: { file: null, canRestrictTools: false },
  claimedMotifs: ['harness-is-the-product', 'prompt-rebuilt-every-round', 'stop-hooks-can-refuse', 'custom-agent-restricts-tools'],
  selfAttestedSuccess: true
};

const GOLD_COPILOT_CLOUD = {
  schemaVersion: '1.0', id: 'github-copilot-coding-agent-harness', familyId: 'github-copilot-coding-agent',
  environment: { kind: 'github-actions-ephemeral', ideAgentMode: false, laptop: false },
  issue: { seesCommentsAfterAssignment: false },
  followUp: { surface: 'pull-request' },
  limits: { maxMinutes: 59, extendable: false },
  firewall: { appliesTo: 'agent-bash-tool', appliesToMcp: false, appliesToSetupSteps: false, warnsOnBlocked: true },
  scope: { repos: 1, branchesAtATime: 1, pullRequestsPerTask: 1 }
};

const NAIVE_COPILOT_CLOUD = {
  schemaVersion: '1.0', id: 'github-copilot-coding-agent-harness', familyId: 'github-copilot-coding-agent',
  environment: { kind: 'ide-agent-mode', ideAgentMode: true, laptop: true },
  issue: { seesCommentsAfterAssignment: true },
  followUp: { surface: 'issue-thread' },
  limits: { maxMinutes: null, extendable: true },
  firewall: { appliesTo: 'whole-vm', appliesToMcp: true, appliesToSetupSteps: true, warnsOnBlocked: false },
  scope: { repos: 'multi', branchesAtATime: 8, pullRequestsPerTask: 8 },
  claimedMotifs: ['actions-ephemeral-not-ide', 'issue-comments-frozen-at-assign', 'hard-59-minute', 'firewall-bash-not-mcp', 'one-repo-one-pr'],
  selfAttestedSuccess: true
};

const GOLD_HEBBIA = {
  schemaVersion: '1.0', id: 'hebbia-matrix-harness', familyId: 'hebbia-matrix',
  orchestrator: { invokesTools: false, dispatch: 'text-objective-to-subagent' },
  context: { kind: 'typed-hierarchical', singleOverloadedBag: false },
  history: { taggedByAgent: true, subagentsFilter: true },
  subagents: ['read', 'output'],
  toolHallucinationMitigation: 'isolate-per-subagent'
};

const NAIVE_HEBBIA = {
  schemaVersion: '1.0', id: 'hebbia-matrix-harness', familyId: 'hebbia-matrix',
  orchestrator: { invokesTools: true, dispatch: 'direct-tools' },
  context: { kind: 'one-bag', singleOverloadedBag: true },
  history: { taggedByAgent: false, subagentsFilter: false },
  subagents: ['god-agent'],
  toolHallucinationMitigation: 'bigger-prompt',
  claimedMotifs: ['orchestrator-never-tools', 'typed-hierarchical-context', 'history-tagged-by-agent', 'specialized-subagents-not-tool-soup'],
  selfAttestedSuccess: true
};

const GOLD_NOVA = {
  schemaVersion: '1.0', id: 'amazon-nova-act-harness', familyId: 'amazon-nova-act',
  commands: { kind: 'atomic', highLevelGoalAsUnit: false },
  script: { language: 'python', interleaveNaturalLanguage: true, playwrightFallback: true },
  training: { unified: true, boltOnComponents: false },
  secrets: { entry: 'playwright-not-model' },
  perception: { kind: 'not-cua-screenshot-loop' }
};

const NAIVE_NOVA = {
  schemaVersion: '1.0', id: 'amazon-nova-act-harness', familyId: 'amazon-nova-act',
  commands: { kind: 'high-level-goal', highLevelGoalAsUnit: true },
  script: { language: 'none', interleaveNaturalLanguage: false, playwrightFallback: false },
  training: { unified: false, boltOnComponents: true },
  secrets: { entry: 'model-types-password' },
  perception: { kind: 'screenshots' },
  claimedMotifs: ['atomic-commands-not-high-level-goal', 'python-interleaved-with-nl', 'unified-train-model-sdk-browser', 'playwright-for-secrets'],
  selfAttestedSuccess: true
};

const GOLD_JULES = {
  schemaVersion: '1.0', id: 'google-jules-harness', familyId: 'google-jules',
  environment: { kind: 'gcp-cloud-vm', async: true, laptop: false, microvmDedicatedKernel: false },
  plan: { beforeDiff: true },
  steer: { moments: ['before', 'during', 'after'] },
  critic: { reengagesAfterReplan: true },
  surfaces: { share: 'same-project-view', kinds: ['web', 'cli', 'api', 'gemini-cli'] },
  repoless: { allowed: true, kind: 'preconfigured-vm-image' }
};

const NAIVE_JULES = {
  schemaVersion: '1.0', id: 'google-jules-harness', familyId: 'google-jules',
  environment: { kind: 'laptop', async: false, laptop: true, microvmDedicatedKernel: true },
  plan: { beforeDiff: false },
  steer: { moments: ['after'] },
  critic: { reengagesAfterReplan: false },
  surfaces: { share: 'per-client-session', kinds: ['web'] },
  repoless: { allowed: false, kind: 'github-required' },
  claimedMotifs: ['cloud-vm-not-laptop', 'plan-before-diff', 'critic-after-replan', 'surfaces-share-project', 'repoless-allowed'],
  selfAttestedSuccess: true
};

const GOLD_PAPERQA = {
  schemaVersion: '1.0', id: 'futurehouse-paperqa2-harness', familyId: 'futurehouse-paperqa2',
  tools: ['paper-search', 'gather-evidence', 'generate-answer', 'citation-traversal'],
  gather: { kind: 'rcs', answerSees: 'summaries-not-raw-chunks' },
  citationTraversal: { degrees: 1, direction: 'forward-and-back', minRcs: 8 },
  objective: { primary: 'accuracy', costFirst: false },
  rcs: { computeCoupledToAccuracy: true }
};

const NAIVE_PAPERQA = {
  schemaVersion: '1.0', id: 'futurehouse-paperqa2-harness', familyId: 'futurehouse-paperqa2',
  tools: ['search', 'stuff-chunks'],
  gather: { kind: 'embed-then-dump', answerSees: 'raw-chunks' },
  citationTraversal: { degrees: 0, direction: 'none', minRcs: 0 },
  objective: { primary: 'cost', costFirst: true },
  rcs: { computeCoupledToAccuracy: false },
  claimedMotifs: ['agentic-rag-four-tools', 'rcs-summaries-not-raw-chunks', 'citation-traversal-from-high-rcs', 'accuracy-over-cost'],
  selfAttestedSuccess: true
};

export const INDUSTRY_NAIVE = {
  'openai-codex': NAIVE_CODEX,
  'github-copilot-vscode': NAIVE_COPILOT_VSCODE,
  'github-copilot-coding-agent': NAIVE_COPILOT_CLOUD,
  'hebbia-matrix': NAIVE_HEBBIA,
  'amazon-nova-act': NAIVE_NOVA,
  'google-jules': NAIVE_JULES,
  'futurehouse-paperqa2': NAIVE_PAPERQA
};

export const INDUSTRY_RESPECTING = {
  'openai-codex': GOLD_CODEX,
  'github-copilot-vscode': GOLD_COPILOT_VSCODE,
  'github-copilot-coding-agent': GOLD_COPILOT_CLOUD,
  'hebbia-matrix': GOLD_HEBBIA,
  'amazon-nova-act': GOLD_NOVA,
  'google-jules': GOLD_JULES,
  'futurehouse-paperqa2': GOLD_PAPERQA
};

function interpretCodex(harness, input) {
  if (input.op === 'web-tab-close') {
    const ok = harness.web?.survivesTabClose === true && harness.web?.tabIsSourceOfTruth === false && harness.thread?.clientIsSourceOfTruth === false;
    return { continued: ok, sourceOfTruth: ok ? 'server-thread' : 'tab' };
  }
  if (input.op === 'second-task') {
    const one = harness.session?.maxConcurrentTasks === 1;
    return { started: !one, reason: one ? 'one-task-per-session' : 'in-process' };
  }
  if (input.op === 'exec-approval') {
    const pause = harness.approvals?.kind === 'server-initiated' && harness.approvals?.pausesTurn === true;
    return { paused: pause, initiator: pause ? 'server' : 'none' };
  }
  if (input.op === 'fork-thread') {
    const ops = [...(harness.thread?.ops ?? [])].sort();
    const allowed = harness.thread?.kind === 'durable-container' && CODEX_THREAD_OPS.every(op => ops.includes(op));
    return { allowed, ops };
  }
  if (input.probe === 'client-surface') {
    return { transport: harness.transport?.kind ?? null, share: harness.surfaces?.share ?? null, bidirectional: harness.transport?.bidirectional === true };
  }
  if (input.op === 'turn-no-output') {
    const ends = harness.loop?.taskEndsWhen === 'turn-yields-no-output';
    return { taskTerminated: ends };
  }
  if (input.op === 'fork-both-boundaries') {
    const exclusive = harness.thread?.fork?.lastTurnIdExclusiveWithBeforeTurnId === true;
    return { allowed: !exclusive, error: exclusive ? 'invalid_request' : null };
  }
  if (input.op === 'resume-running-approval') {
    const rejoin = harness.thread?.resume?.kind === 'same-thread-rejoin' && harness.thread?.resume?.replaysPendingApprovals === true;
    return { sameThread: rejoin, approvalReplayed: rejoin, turnRestarted: !rejoin };
  }
  if (input.op === 'fork-in-progress-turn') {
    return { allowed: harness.thread?.fork?.cannotForkInProgressTurn !== true };
  }
  if (input.op === 'compact-mid-turn') {
    return {
      injection: harness.compaction?.midTurnInjection ?? null,
      summaryLast: harness.compaction?.summaryLast === true,
      firstClassOp: harness.compaction?.firstClassOp === true
    };
  }
  if (input.op === 'start-permissions-and-sandbox') {
    return { allowed: harness.isolation?.combiningPermissionsAndSandbox !== 'invalid' };
  }
  if (input.op === 'thread-start-empty') {
    const lazy = harness.thread?.rolloutUntil === 'first-user-message';
    return { rolloutExists: !lazy, unusedSurvivesRestart: harness.thread?.unusedSurvivesRestart === true };
  }
  if (input.op === 'extra-user-input') {
    return {
      steered: harness.loop?.userInputSteersTask === true,
      aborted: harness.loop?.userInputAbortsTask === true,
      abort: harness.loop?.abort ?? null
    };
  }
  throw new FoundryError('HARNESS_INTERPRETER', 'Unknown openai-codex probe');
}

function interpretCopilotVscode(harness, input) {
  if (input.op === 'after-edit') {
    const sees = harness.prompt?.rebuild === 'every-round' && harness.prompt?.seesLatestWorkspace === true;
    return { promptSeesEdit: sees };
  }
  if (input.op === 'model-empty-tools') {
    const refuse = harness.stopHooks?.canRefuseFinish === true && input.stopHook === 'continue';
    return { finished: !refuse };
  }
  if (input.op === 'new-model') {
    return { requiresRecalibration: harness.model?.perModelCalibration === true };
  }
  if (input.op === 'restrict-tools') {
    const ok = harness.customAgents?.file === '.agent.md' && harness.customAgents?.canRestrictTools === true;
    return { allowed: ok, file: harness.customAgents?.file ?? null };
  }
  throw new FoundryError('HARNESS_INTERPRETER', 'Unknown github-copilot-vscode probe');
}

function interpretCopilotCloud(harness, input) {
  if (input.op === 'issue-comment-after-assign') {
    const seen = harness.issue?.seesCommentsAfterAssignment === true;
    return { seen, followUp: harness.followUp?.surface ?? null };
  }
  if (input.op === 'run-minutes') {
    const max = harness.limits?.maxMinutes;
    const timedOut = typeof max === 'number' && input.minutes > max;
    return { timedOut, extendable: harness.limits?.extendable === true };
  }
  if (input.op === 'mcp-network') {
    return { firewallApplies: harness.firewall?.appliesToMcp === true };
  }
  if (input.op === 'bash-blocked-host') {
    const applies = harness.firewall?.appliesTo === 'agent-bash-tool';
    return { firewallApplies: applies, warnedOnPr: applies && harness.firewall?.warnsOnBlocked === true };
  }
  if (input.probe === 'environment') {
    return { kind: harness.environment?.kind ?? null, ideAgentMode: harness.environment?.ideAgentMode === true };
  }
  throw new FoundryError('HARNESS_INTERPRETER', 'Unknown github-copilot-coding-agent probe');
}

function interpretHebbia(harness, input) {
  if (input.op === 'orchestrator-call-tool') {
    const blocked = harness.orchestrator?.invokesTools === false;
    return { allowed: !blocked, dispatch: harness.orchestrator?.dispatch ?? null };
  }
  if (input.probe === 'context') {
    return { kind: harness.context?.kind ?? null, singleOverloadedBag: harness.context?.singleOverloadedBag === true };
  }
  if (input.op === 'orchestrator-sees-columns-read') {
    const hidden = harness.history?.taggedByAgent === true && harness.history?.subagentsFilter === true && harness.orchestrator?.invokesTools === false;
    return { sees: !hidden };
  }
  if (input.probe === 'subagents') {
    const isolated = harness.toolHallucinationMitigation === 'isolate-per-subagent';
    return { isolated, includes: [...(harness.subagents ?? [])].sort() };
  }
  throw new FoundryError('HARNESS_INTERPRETER', 'Unknown hebbia-matrix probe');
}

function interpretNova(harness, input) {
  if (input.op === 'run') {
    const atomic = harness.commands?.kind === 'atomic' && harness.commands?.highLevelGoalAsUnit === false;
    if (input.shape === 'high-level-goal') return { acceptedAsUnit: !atomic, requiresAtomic: atomic };
    return { acceptedAsUnit: true, requiresAtomic: atomic };
  }
  if (input.op === 'enter-password') {
    return { actor: harness.secrets?.entry ?? null };
  }
  if (input.op === 'python-assert') {
    const ok = harness.script?.language === 'python' && harness.script?.interleaveNaturalLanguage === true;
    return { allowed: ok };
  }
  if (input.probe === 'training') {
    return { unified: harness.training?.unified === true, boltOn: harness.training?.boltOnComponents === true };
  }
  throw new FoundryError('HARNESS_INTERPRETER', 'Unknown amazon-nova-act probe');
}

function interpretJules(harness, input) {
  if (input.op === 'mutate') {
    return { planShownFirst: harness.plan?.beforeDiff === true };
  }
  if (input.op === 'replan') {
    return { criticReengaged: harness.critic?.reengagesAfterReplan === true };
  }
  if (input.probe === 'environment') {
    return {
      kind: harness.environment?.kind ?? null,
      laptop: harness.environment?.laptop === true,
      microvmDedicatedKernel: harness.environment?.microvmDedicatedKernel === true
    };
  }
  if (input.op === 'cli-then-web') {
    const share = harness.surfaces?.share === 'same-project-view';
    return { sameProject: share, surfaces: [...(harness.surfaces?.kinds ?? [])].sort() };
  }
  if (input.op === 'no-github') {
    return { allowed: harness.repoless?.allowed === true, kind: harness.repoless?.kind ?? null };
  }
  throw new FoundryError('HARNESS_INTERPRETER', 'Unknown google-jules probe');
}

function interpretPaperqa(harness, input) {
  if (input.probe === 'answer-context') {
    return { sees: harness.gather?.answerSees ?? null };
  }
  if (input.op === 'high-rcs-paper') {
    const min = harness.citationTraversal?.minRcs;
    const traverse = typeof min === 'number' && input.score >= min && harness.citationTraversal?.degrees === 1;
    return {
      traverse,
      degrees: traverse ? harness.citationTraversal.degrees : 0,
      direction: traverse ? harness.citationTraversal.direction : 'none'
    };
  }
  if (input.op === 'inject-raw-chunks-to-answer') {
    const blocked = harness.gather?.answerSees === 'summaries-not-raw-chunks';
    return { allowed: !blocked };
  }
  if (input.probe === 'tools') {
    return { tools: [...(harness.tools ?? [])].sort() };
  }
  throw new FoundryError('HARNESS_INTERPRETER', 'Unknown futurehouse-paperqa2 probe');
}

export function interpretIndustry(harness, input) {
  if (harness?.familyId === 'openai-codex') return interpretCodex(harness, input);
  if (harness?.familyId === 'github-copilot-vscode') return interpretCopilotVscode(harness, input);
  if (harness?.familyId === 'github-copilot-coding-agent') return interpretCopilotCloud(harness, input);
  if (harness?.familyId === 'hebbia-matrix') return interpretHebbia(harness, input);
  if (harness?.familyId === 'amazon-nova-act') return interpretNova(harness, input);
  if (harness?.familyId === 'google-jules') return interpretJules(harness, input);
  if (harness?.familyId === 'futurehouse-paperqa2') return interpretPaperqa(harness, input);
  return null;
}

const CODEX_SCENARIOS = [
  { id: 'tab-close-survives', input: { op: 'web-tab-close' }, expected: { continued: true, sourceOfTruth: 'server-thread' } },
  { id: 'second-task-blocked', input: { op: 'second-task' }, expected: { started: false, reason: 'one-task-per-session' } },
  { id: 'approval-pauses', input: { op: 'exec-approval' }, expected: { paused: true, initiator: 'server' } },
  { id: 'fork-thread', input: { op: 'fork-thread' }, expected: { allowed: true, ops: ['archive', 'fork', 'resume', 'start'] } },
  { id: 'jsonrpc-stdio', input: { probe: 'client-surface' }, expected: { transport: 'jsonrpc-stdio', share: 'app-server', bidirectional: true } },
  { id: 'turn-no-output-ends-task', input: { op: 'turn-no-output' }, expected: { taskTerminated: true } },
  { id: 'fork-both-boundaries-invalid', input: { op: 'fork-both-boundaries' }, expected: { allowed: false, error: 'invalid_request' } },
  { id: 'resume-replays-approval', input: { op: 'resume-running-approval' }, expected: { sameThread: true, approvalReplayed: true, turnRestarted: false } },
  { id: 'fork-in-progress-blocked', input: { op: 'fork-in-progress-turn' }, expected: { allowed: false } },
  { id: 'compact-summary-last', input: { op: 'compact-mid-turn' }, expected: { injection: 'before-last-user-message', summaryLast: true, firstClassOp: true } },
  { id: 'permissions-and-sandbox-invalid', input: { op: 'start-permissions-and-sandbox' }, expected: { allowed: false } },
  { id: 'lazy-rollout', input: { op: 'thread-start-empty' }, expected: { rolloutExists: false, unusedSurvivesRestart: false } },
  { id: 'extra-user-input-steers', input: { op: 'extra-user-input' }, expected: { steered: true, aborted: false, abort: 'turn-interrupt' } }
];

const COPILOT_VSCODE_SCENARIOS = [
  { id: 'prompt-sees-edit', input: { op: 'after-edit' }, expected: { promptSeesEdit: true } },
  { id: 'stop-hook-refuses', input: { op: 'model-empty-tools', stopHook: 'continue' }, expected: { finished: false } },
  { id: 'new-model-recalibrates', input: { op: 'new-model' }, expected: { requiresRecalibration: true } },
  { id: 'agent-md-restricts', input: { op: 'restrict-tools' }, expected: { allowed: true, file: '.agent.md' } }
];

const COPILOT_CLOUD_SCENARIOS = [
  { id: 'later-issue-comment-unseen', input: { op: 'issue-comment-after-assign' }, expected: { seen: false, followUp: 'pull-request' } },
  { id: 'sixty-minutes-timeout', input: { op: 'run-minutes', minutes: 60 }, expected: { timedOut: true, extendable: false } },
  { id: 'mcp-not-firewalled', input: { op: 'mcp-network' }, expected: { firewallApplies: false } },
  { id: 'bash-firewalled', input: { op: 'bash-blocked-host' }, expected: { firewallApplies: true, warnedOnPr: true } },
  { id: 'not-ide-agent-mode', input: { probe: 'environment' }, expected: { kind: 'github-actions-ephemeral', ideAgentMode: false } }
];

const HEBBIA_SCENARIOS = [
  { id: 'orchestrator-cannot-call-tool', input: { op: 'orchestrator-call-tool' }, expected: { allowed: false, dispatch: 'text-objective-to-subagent' } },
  { id: 'typed-context', input: { probe: 'context' }, expected: { kind: 'typed-hierarchical', singleOverloadedBag: false } },
  { id: 'orchestrator-misses-columns', input: { op: 'orchestrator-sees-columns-read' }, expected: { sees: false } },
  { id: 'isolated-subagents', input: { probe: 'subagents' }, expected: { isolated: true, includes: ['output', 'read'] } }
];

const NOVA_SCENARIOS = [
  { id: 'high-level-not-unit', input: { op: 'run', shape: 'high-level-goal' }, expected: { acceptedAsUnit: false, requiresAtomic: true } },
  { id: 'password-playwright', input: { op: 'enter-password' }, expected: { actor: 'playwright-not-model' } },
  { id: 'python-assert-allowed', input: { op: 'python-assert' }, expected: { allowed: true } },
  { id: 'unified-training', input: { probe: 'training' }, expected: { unified: true, boltOn: false } }
];

const JULES_SCENARIOS = [
  { id: 'plan-before-mutate', input: { op: 'mutate' }, expected: { planShownFirst: true } },
  { id: 'critic-after-replan', input: { op: 'replan' }, expected: { criticReengaged: true } },
  { id: 'not-devin-microvm', input: { probe: 'environment' }, expected: { kind: 'gcp-cloud-vm', laptop: false, microvmDedicatedKernel: false } },
  { id: 'surfaces-same-project', input: { op: 'cli-then-web' }, expected: { sameProject: true, surfaces: ['api', 'cli', 'gemini-cli', 'web'] } },
  { id: 'repoless', input: { op: 'no-github' }, expected: { allowed: true, kind: 'preconfigured-vm-image' } }
];

const PAPERQA_SCENARIOS = [
  { id: 'answer-sees-summaries', input: { probe: 'answer-context' }, expected: { sees: 'summaries-not-raw-chunks' } },
  { id: 'traverse-score-8', input: { op: 'high-rcs-paper', score: 8 }, expected: { traverse: true, degrees: 1, direction: 'forward-and-back' } },
  { id: 'skip-score-7', input: { op: 'high-rcs-paper', score: 7 }, expected: { traverse: false, degrees: 0, direction: 'none' } },
  { id: 'raw-chunks-forbidden', input: { op: 'inject-raw-chunks-to-answer' }, expected: { allowed: false } }
];

function pack(id, intent, publicInterface, marker, paths, harness, scenarios) {
  return {
    id,
    builderPack: {
      intent,
      publicInterface,
      ideologicalReasons: INDUSTRY_MOTIFS[id].map(m => ({ motif: m.id, why: m.why }))
    },
    heldOut: {
      uniqueMarker: marker,
      paths,
      target: { marker, harness, scenarios }
    }
  };
}

export const INDUSTRY_FAMILY_SPECS = {
  'openai-codex': pack(
    'openai-codex',
    'Construct a coding-agent harness matching OpenAI Codex’s public App Server protocol: all surfaces are JSON-RPC/stdio clients of one App Server hosting Codex core threads; a Thread is durable (start/resume/fork/archive); resume rejoins the same thread and replays pending approvals, fork copies a frozen prefix (lastTurnId exclusive with beforeTurnId; cannot fork an in-progress turn); compaction is first-class and mid-turn injection keeps the summary last; AskForApproval is orthogonal to SandboxMode (combining permissions+sandbox is invalid); rollout is lazy until first user message; extra user input steers the current Task (abort is turn-interrupt; protocol_v1 abort rule is stale); a Task ends when a turn yields no tool output; web runs the App Server in a container so a closed tab is not the source of truth. Session has at most one Task; parallelism is one Codex process per thread.',
    {
      transport: 'bidirectional JSON-RPC over stdio',
      thread: { kind: 'durable-container', ops: ['start', 'resume', 'fork', 'archive'], resume: 'same-thread-rejoin', fork: 'new-history-copy', rolloutUntil: 'first-user-message' },
      session: { maxConcurrentTasks: 1 },
      approvals: 'server-initiated, pauses turn; orthogonal to sandbox-mode',
      loop: { taskEndsWhen: 'turn-yields-no-output', extraInput: 'steers', abort: 'turn-interrupt' },
      compaction: 'first-class; mid-turn BeforeLastUserMessage; summary last',
      web: 'container-app-server; tab is not source of truth'
    },
    CODEX_MARKER, ['construction-heldout://openai-codex', 'heldout/openai-codex.target.json'], GOLD_CODEX, CODEX_SCENARIOS
  ),
  'github-copilot-vscode': pack(
    'github-copilot-vscode',
    'Construct an editor coding harness matching VS Code Copilot 2026-05-15: the harness owns context assembly, tools and the loop; prompts rebuild every round; a user turn is many rounds; stop hooks can refuse to finish; .agent.md can restrict tools; new models require per-model calibration. This is not Copilot cloud agent.',
    {
      harnessOwns: ['context-assembly', 'tool-exposure', 'tool-execution', 'agent-loop'],
      prompt: 'rebuild every round; latest workspace',
      loop: 'turn-of-rounds; stop hooks may refuse finish',
      customAgents: '.agent.md can restrict tools',
      model: 'interchangeable with per-model calibration'
    },
    COPILOT_VSCODE_MARKER, ['construction-heldout://github-copilot-vscode', 'heldout/github-copilot-vscode.target.json'], GOLD_COPILOT_VSCODE, COPILOT_VSCODE_SCENARIOS
  ),
  'github-copilot-coding-agent': pack(
    'github-copilot-coding-agent',
    'Construct a cloud coding-agent matching GitHub Copilot cloud agent public docs: ephemeral GitHub Actions environment, not IDE agent mode; issue comments frozen at assignment (follow-up on the PR); hard 59-minute session cap; firewall covers only the agent Bash tool (not MCP or setup steps) and warns on the PR; one repo, one branch, one PR per task.',
    {
      environment: 'github-actions-ephemeral, not IDE agent mode',
      issue: 'comments after assignment unseen; follow-up on pull-request',
      limits: { maxMinutes: 59, extendable: false },
      firewall: { appliesTo: 'agent-bash-tool', appliesToMcp: false, appliesToSetupSteps: false },
      scope: { repos: 1, pullRequestsPerTask: 1 }
    },
    COPILOT_CLOUD_MARKER, ['construction-heldout://github-copilot-coding-agent', 'heldout/github-copilot-coding-agent.target.json'], GOLD_COPILOT_CLOUD, COPILOT_CLOUD_SCENARIOS
  ),
  'hebbia-matrix': pack(
    'hebbia-matrix',
    'Construct a document-matrix agent matching Hebbia Matrix Agent 2.0: the orchestrator never calls tools — it dispatches a text objective to a named subagent; context is strongly typed and hierarchical; message history is tagged by producing agent and filtered; Read vs Output subagents are isolated to kill tool-use hallucinations. Agent 1.0 tool-soup is the named failure.',
    {
      orchestrator: 'no tools; text-objective-to-subagent',
      context: 'typed-hierarchical, not one bag',
      history: 'tagged by agent; subagents filter',
      subagents: ['read', 'output']
    },
    HEBBIA_MARKER, ['construction-heldout://hebbia-matrix', 'heldout/hebbia-matrix.target.json'], GOLD_HEBBIA, HEBBIA_SCENARIOS
  ),
  'amazon-nova-act': pack(
    'amazon-nova-act',
    'Construct a browser-actuation harness matching Amazon Nova Act: workflows are atomic commands composed in Python interleaved with NL, not a high-level goal unit; model+SDK+orchestrator+browser are trained as one system; passwords go through Playwright, not the model. Distinct from OpenAI CUA (screenshots + virtual mouse).',
    {
      commands: 'atomic, high-level-goal is not the unit',
      script: 'python interleaved with NL; Playwright fallback',
      training: 'unified, not bolted components',
      secrets: 'playwright-not-model'
    },
    NOVA_MARKER, ['construction-heldout://amazon-nova-act', 'heldout/amazon-nova-act.target.json'], GOLD_NOVA, NOVA_SCENARIOS
  ),
  'google-jules': pack(
    'google-jules',
    'Construct an async coding-agent matching Google Jules: clone into a GCP Cloud VM (not a laptop, not Devin’s dedicated-kernel microVM); show the plan before the diff; critic re-engages after replan; web/CLI/API/Gemini CLI share one project view; repoless sessions are allowed on a preconfigured VM image.',
    {
      environment: 'gcp-cloud-vm, async, not laptop, not dedicated-kernel microVM',
      plan: 'before diff; steer before/during/after',
      critic: 'reengages after replan',
      surfaces: ['web', 'cli', 'api', 'gemini-cli'],
      repoless: 'preconfigured-vm-image'
    },
    JULES_MARKER, ['construction-heldout://google-jules', 'heldout/google-jules.target.json'], GOLD_JULES, JULES_SCENARIOS
  ),
  'futurehouse-paperqa2': pack(
    'futurehouse-paperqa2',
    'Construct a science-RAG harness matching FutureHouse PaperQA2: agentic tools (paper-search, gather-evidence, generate-answer, citation-traversal); Gather Evidence is RCS and the answer prompt sees summaries not raw chunks; citation traversal is one degree forward-and-back from RCS≥8 papers; accuracy is the primary objective and RCS compute is coupled to it.',
    {
      tools: ['paper-search', 'gather-evidence', 'generate-answer', 'citation-traversal'],
      gather: { kind: 'rcs', answerSees: 'summaries-not-raw-chunks' },
      citationTraversal: { degrees: 1, direction: 'forward-and-back', minRcs: 8 },
      objective: 'accuracy, not cost-first'
    },
    PAPERQA_MARKER, ['construction-heldout://futurehouse-paperqa2', 'heldout/futurehouse-paperqa2.target.json'], GOLD_PAPERQA, PAPERQA_SCENARIOS
  )
};

export const INDUSTRY_CATALOG = Object.freeze([
  { id: 'openai-codex', company: 'OpenAI', product: 'Codex', domain: 'software', encoded: true, evidence: 'https://openai.com/index/unlocking-the-codex-harness/ ; https://openai.com/index/unrolling-the-codex-agent-loop/ ; https://developers.openai.com/blog/codex-as-a-platform ; observed /tmp/harness-deconstruct/codex/codex-rs/docs/protocol_v1.md and app-server-protocol ThreadStart/Resume/Fork/Archive' },
  { id: 'github-copilot-vscode', company: 'GitHub / Microsoft', product: 'Copilot in VS Code (editor harness)', domain: 'software-editor', encoded: true, evidence: 'https://code.visualstudio.com/blogs/2026/05/15/agent-harnesses-github-copilot-vscode' },
  { id: 'github-copilot-coding-agent', company: 'GitHub', product: 'Copilot cloud agent', domain: 'software-cloud', encoded: true, evidence: 'https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent ; https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-firewall ; https://github.blog/ai-and-ml/github-copilot/assigning-and-completing-issues-with-coding-agent-in-github-copilot/' },
  { id: 'hebbia-matrix', company: 'Hebbia', product: 'Matrix Agent 2.0', domain: 'legal+finance-documents', encoded: true, evidence: 'https://www.hebbia.com/blog/divide-and-conquer-hebbias-multi-agent-redesign (2025-06-17)' },
  { id: 'amazon-nova-act', company: 'Amazon AGI', product: 'Nova Act', domain: 'computer-use', encoded: true, evidence: 'https://www.amazon.science/blog/nova-act (2025-03-31); https://www.amazon.science/blog/amazon-nova-act-service (2025-12-02); https://aws.amazon.com/blogs/machine-learning/amazon-nova-act-sdk-preview-path-to-production-for-browser-automation-agents/' },
  { id: 'google-jules', company: 'Google Labs', product: 'Jules', domain: 'software-cloud', encoded: true, evidence: 'https://blog.google/innovation-and-ai/models-and-research/google-labs/jules/ (2025-05-20); https://developers.googleblog.com/jules-gemini-3/ (2025-11-19); https://github.com/google-labs-code/jules-sdk/' },
  { id: 'futurehouse-paperqa2', company: 'FutureHouse', product: 'PaperQA2 / Crow-Falcon-Owl platform', domain: 'science', encoded: true, evidence: 'https://www.futurehouse.org/research/engineering-blog-journey-to-superhuman-performance-on-scientific-tasks (2024-09-19); https://www.futurehouse.org/news/launching-futurehouse-platform-ai-agents (2025-05-01)' }
]);
