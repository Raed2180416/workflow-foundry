import { FoundryError } from './data.mjs';

const HARVEY_MARKER = 'HELD_OUT_HARVEY_SPECTRE_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';
const CURSOR_CLOUD_MARKER = 'HELD_OUT_CURSOR_CLOUD_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';
const FACTORY_MISSIONS_MARKER = 'HELD_OUT_FACTORY_MISSIONS_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';
const FACTORY_SAFETY_MARKER = 'HELD_OUT_FACTORY_DROID_SAFETY_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';
const AGENCY_MARKER = 'HELD_OUT_SIERRA_AGENCY_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER';

const HOOK_EVENTS = Object.freeze([
  'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification',
  'Stop', 'SubagentStop', 'PreCompact', 'SessionStart', 'SessionEnd'
]);

export const CLOSED_MOTIFS = {
  'harvey-spectre': [
    {
      id: 'durable-run-not-worker',
      why: 'Harvey 2026-04-07 Spectre: the durable object is the run record (ownership, sharing, attachments, history, artifacts, provider session refs), not the worker process. Workers are short-lived slices. A follow-up does not wake an old container; the control plane appends interaction state, starts a fresh worker, restores archived provider session context. Cognition snapshots memory+process-tree; Spectre refuses to reanimate sandboxes. Different ideology, both public.',
      inspect: c => c.durableObject === 'run-record' && c.workers?.kind === 'ephemeral' && c.workers?.reanimateSandbox === false && c.workers?.resume === 'fresh-worker-from-archived-session'
    },
    {
      id: 'sandbox-not-control-plane',
      why: 'Same Spectre post: the worker is powerful inside the sandbox and strictly defined at the boundary. It must not mutate the control-plane database. Config and tools are injected at run start; credentials are scoped and short-lived; ambient desktop inheritance is the enterprise failure mode they named.',
      inspect: c => c.sandbox?.mutatesControlPlane === false && c.sandbox?.credentials === 'injected-at-start' && c.sandbox?.ambientDesktop === false && c.sandbox?.tools === 'injected-at-start'
    },
    {
      id: 'surfaces-share-run',
      why: 'Spectre: Slack, web, CLI and scheduled work all point at the same durable run. The prompt box is not the primary interface; every client inventing its own session is the named failure mode.',
      inspect: c => c.surfaces?.share === 'same-durable-run' && Array.isArray(c.surfaces?.kinds) && ['cli', 'scheduled', 'slack', 'web'].every(x => c.surfaces.kinds.includes(x))
    },
    {
      id: 'scheduled-as-ordinary-runs',
      why: 'Spectre: cron materializes ordinary runs with ordinary visibility, history and artifacts. A parallel background-job world is the thing they refused so automation stays inspectable with the same tools.',
      inspect: c => c.scheduled?.kind === 'ordinary-runs' && c.scheduled?.parallelJobWorld === false
    }
  ],
  'cursor-cloud': [
    {
      id: 'dedicated-vm-environment',
      why: 'Cursor 2026-06-02 cloud-agent-lessons (Josh Ma): cloud agents run on dedicated VMs. Local agents inherit a laptop environment for free; in the cloud, missing environment shows up as silent quality drop, not a crash. The development environment is the product.',
      inspect: c => c.environment?.kind === 'dedicated-vm' && c.environment?.inheritedLaptop === false && c.environment?.product === 'full-dev-environment'
    },
    {
      id: 'temporal-not-work-stealing',
      why: 'Same post: work-stealing workers that loop an agent to completion transplanted the local loop and ran at one nine of reliability. They migrated to Temporal rather than rebuilding durable execution. The agent loop lives in Temporal, not on the VM, so pods can hibernate independently.',
      inspect: c => c.execution?.kind === 'temporal' && c.execution?.workStealing === false && c.execution?.loopOnVm === false
    },
    {
      id: 'short-workflows-not-eternal',
      why: 'Same post: eternal agent workflows blocked version upgrades. Current shape is multiple shorter workflows that exit after a single task. Activities were split so timeouts/retries cover async tool calls, subagents and inference outages.',
      inspect: c => c.workflows?.kind === 'short-task-exit' && c.workflows?.eternal === false
    },
    {
      id: 'loop-decoupled-from-vm',
      why: 'Same post: keep the agent loop, the machine state and the conversation state as decoupled components. Hibernate/resume VMs between messages; checkpoint, restore and fork VM images. Loop-on-VM is the coupling they left.',
      inspect: c => c.decoupled?.loop === 'temporal' && c.decoupled?.machine === 'vm' && c.decoupled?.conversation === 'separate' && c.vm?.hibernate === true && c.vm?.checkpointRestoreFork === true
    },
    {
      id: 'computer-use-subagent',
      why: 'Same post: computer use is a dedicated subagent type with its own model routing, prompting and screen recording. VNC and Chrome belong to the shared environment so the parent can also drive Playwright. Scaffolding exists because models are not ready to own computer use; the parent still decides when to invoke it.',
      inspect: c => c.computerUse?.kind === 'dedicated-subagent' && c.computerUse?.environmentShared === true
    }
  ],
  'factory-missions': [
    {
      id: 'fresh-agents-narrow-goals',
      why: 'Factory 2026-04-10 Missions: an agent trajectory is append-only and models seek coherence, so a broad session accumulates irrelevant and adversarial context. Missions break work into focused units handled by fresh agents with narrowly scoped goals. One long session is the failure mode.',
      inspect: c => c.context?.trajectory === 'append-only' && c.context?.freshAgents === true && c.context?.selfEval === 'forbidden'
    },
    {
      id: 'orchestrator-does-not-implement',
      why: 'Same post: the orchestrator plans, decomposes and steers, and must not accumulate granular implementation context. It delegates investigation and implementation. It does not drive validation directly — the system injects validators at milestones.',
      inspect: c => c.roles?.orchestrator?.implements === false && c.roles?.orchestrator?.validates === false && Array.isArray(c.roles?.orchestrator?.owns) && ['plan', 'decompose', 'steer'].every(x => c.roles.orchestrator.owns.includes(x))
    },
    {
      id: 'validator-not-implementer',
      why: 'Same post: an implementer is worse at evaluating its own work than a fresh reviewer (self-evaluation bias). Workers iterate until they believe the work is correct, but final judgment is an independent validator. Validators do not implement fixes; they surface issues to the orchestrator, which creates fix features for future workers.',
      inspect: c => c.roles?.worker?.judgesCorrectness === false && c.roles?.validator?.implements === false && c.roles?.validator?.judgesCorrectness === true
    },
    {
      id: 'contract-before-features',
      why: 'Same post: TDD at two levels. Workers write tests before code. At mission level the orchestrator writes a validation contract (testable behavioral assertions) before defining features, so the contract is not contaminated by an already-planned implementation. User-testing validators then exercise the system as a black box.',
      inspect: c => c.tdd?.workerTestsFirst === true && c.tdd?.missionContractBeforeFeatures === true && c.validation?.blackBoxUserTesting === true && c.validation?.injectAtMilestones === true
    }
  ],
  'factory-droid-safety': [
    {
      id: 'deterministic-not-model',
      why: 'Factory docs Agent Safety & Controls: LLMs are powerful but untrusted. Enterprise security is built on deterministic controls that do not depend on model behavior (command allow/deny/block, hooks, sandbox, egress). Prompt policy is complementary steering, not enforcement.',
      inspect: c => c.llm?.trusted === false && c.controls?.kind === 'deterministic' && c.controls?.dependOnModel === false
    },
    {
      id: 'kernel-sandbox-fail-closed',
      why: 'Factory sandbox docs: OS-level isolation — macOS Seatbelt, Linux/WSL2 bubblewrap+seccomp, network via HTTP/SOCKS filtering proxy. If isolation primitives are unavailable, commands/hooks are blocked (per-command) or Droid refuses to start (whole-process). Running unsandboxed is not a fallback.',
      inspect: c => c.sandbox?.kind === 'os-kernel' && c.sandbox?.macOS === 'seatbelt' && c.sandbox?.linux === 'bubblewrap-seccomp' && c.sandbox?.unavailable === 'block' && Array.isArray(c.sandbox?.mode) && c.sandbox.mode.includes('per-command') && c.sandbox.mode.includes('whole-process')
    },
    {
      id: 'blocklist-no-approval',
      why: 'Factory command controls: allowlist runs, denylist needs confirmation, blocklist has no approval path even under full autonomy / --skip-permissions-unsafe. Before matching, Droid resolves the actual program so wrappers, absolute paths, quoting and command substitution cannot bypass a block.',
      inspect: c => c.commands?.block === 'no-approval-path' && c.commands?.deny === 'confirm' && c.commands?.resolveActualProgram === true
    },
    {
      id: 'shield-fail-closed-large-diff',
      why: 'Droid Shield scans staged diffs before git commit and git push, blocks likely secrets, and fails closed when a diff is too large to scan. A skip-if-too-big scanner is the opposite protocol.',
      inspect: c => c.shield?.gitCommitPush === true && c.shield?.failClosedOnLargeDiff === true
    },
    {
      id: 'hooks-are-enforcement',
      why: 'Nine lifecycle hook events (PreToolUse…SessionEnd). There are no separate pre-git/pre-command/post-edit hooks; those are PreToolUse/PostToolUse with matchers. PreToolUse can return permissionDecision allow|deny|ask. allowManagedHooksOnly ignores project/user hooks.',
      inspect: c => Array.isArray(c.hooks?.events) && HOOK_EVENTS.every(e => c.hooks.events.includes(e)) && c.hooks?.managedOnlyPossible === true
    }
  ],
  'sierra-agency': [
    {
      id: 'control-plane-vs-runners',
      why: 'Sierra 2026-07-29 Agency: a native Kubernetes app with a stateless control plane (CreateRunnerInstance/DeleteRunnerInstance, IAM, templates, DynamoDB state, pod translation) and a fleet of stateful runners (dedicated compute, persistent volumes). Packing sandboxes onto one VM was the prototype they outgrew.',
      inspect: c => c.controlPlane?.kind === 'stateless' && c.runners?.kind === 'stateful-pods'
    },
    {
      id: 'secrets-outside-sandbox',
      why: 'Same post: agents should not have API keys or secrets accessible by default — a jailbroken agent would exfiltrate them. All inference goes through an LLM proxy outside the sandbox that injects real keys just-in-time and does token accounting without the agent’s cooperation.',
      inspect: c => c.secrets?.inSandbox === false && c.secrets?.llm === 'proxy-outside-sandbox-jit-keys'
    },
    {
      id: 'hibernate-via-queues',
      why: 'Same post: unattended agents spend most of their time waiting (2–4 orders of magnitude more runners in 8 days than in 8 hours). Hibernation is transparent because applications do not reach runners directly; they pass messages on input/output queues. Direct RPC to a sleeping pod is the coupling they removed.',
      inspect: c => c.hibernation?.enabled === true && c.hibernation?.communication === 'message-queues' && c.hibernation?.notDirectlyReachable === true
    },
    {
      id: 'replay-from-checkpoint',
      why: 'Same post: a runner is an FSM. The output queue is an ordered append-only log of a singleton. Restore replays from the last checkpoint event. Checkpoint/delta payloads are opaque to the control plane — application-specific. Keep-alive is what they refused so idle agents can be spun down.',
      inspect: c => c.restore?.kind === 'replay-output-queue-from-checkpoint' && c.restore?.keepAlive === false
    },
    {
      id: 'hardened-runner-identity',
      why: 'Same post: non-root, drop all capabilities, read-only rootfs, filtering egress proxy, isolated nodepools, and control-plane coordination carries runner pod identity so one instance cannot impersonate another.',
      inspect: c => c.hardening?.nonRoot === true && c.hardening?.dropCapabilities === true && c.hardening?.readOnlyRootfs === true && c.hardening?.egressProxy === true && c.hardening?.isolatedNodepool === true && c.hardening?.podIdentity === true
    }
  ]
};

const GOLD_HARVEY = {
  schemaVersion: '1.0', id: 'harvey-spectre-harness', familyId: 'harvey-spectre',
  durableObject: 'run-record',
  workers: { kind: 'ephemeral', reanimateSandbox: false, resume: 'fresh-worker-from-archived-session' },
  sandbox: { mutatesControlPlane: false, credentials: 'injected-at-start', ambientDesktop: false, tools: 'injected-at-start' },
  surfaces: { share: 'same-durable-run', kinds: ['slack', 'web', 'cli', 'scheduled'] },
  scheduled: { kind: 'ordinary-runs', parallelJobWorld: false },
  harness: { kind: 'provider-adapter', events: 'stable-internal-shape' }
};

const NAIVE_HARVEY = {
  schemaVersion: '1.0', id: 'harvey-spectre-harness', familyId: 'harvey-spectre',
  durableObject: 'worker-process',
  workers: { kind: 'long-lived', reanimateSandbox: true, resume: 'wake-old-container' },
  sandbox: { mutatesControlPlane: true, credentials: 'ambient-desktop', ambientDesktop: true, tools: 'inherit-laptop' },
  surfaces: { share: 'per-client-session', kinds: ['prompt-box'] },
  scheduled: { kind: 'parallel-cron-jobs', parallelJobWorld: true },
  harness: { kind: 'sdk-wrapper', events: 'provider-native' },
  claimedMotifs: ['durable-run-not-worker', 'sandbox-not-control-plane', 'surfaces-share-run', 'scheduled-as-ordinary-runs'],
  selfAttestedSuccess: true
};

const GOLD_CURSOR_CLOUD = {
  schemaVersion: '1.0', id: 'cursor-cloud-harness', familyId: 'cursor-cloud',
  environment: { kind: 'dedicated-vm', inheritedLaptop: false, product: 'full-dev-environment' },
  execution: { kind: 'temporal', workStealing: false, loopOnVm: false },
  workflows: { kind: 'short-task-exit', eternal: false },
  vm: { hibernate: true, checkpointRestoreFork: true },
  decoupled: { loop: 'temporal', machine: 'vm', conversation: 'separate' },
  computerUse: { kind: 'dedicated-subagent', environmentShared: true }
};

const NAIVE_CURSOR_CLOUD = {
  schemaVersion: '1.0', id: 'cursor-cloud-harness', familyId: 'cursor-cloud',
  environment: { kind: 'container-on-laptop-image', inheritedLaptop: true, product: 'ported-local-loop' },
  execution: { kind: 'work-stealing', workStealing: true, loopOnVm: true },
  workflows: { kind: 'eternal', eternal: true },
  vm: { hibernate: false, checkpointRestoreFork: false },
  decoupled: { loop: 'on-vm', machine: 'vm', conversation: 'on-vm' },
  computerUse: { kind: 'parent-tools', environmentShared: false },
  claimedMotifs: ['dedicated-vm-environment', 'temporal-not-work-stealing', 'short-workflows-not-eternal', 'loop-decoupled-from-vm', 'computer-use-subagent'],
  selfAttestedSuccess: true
};

const GOLD_MISSIONS = {
  schemaVersion: '1.0', id: 'factory-missions-harness', familyId: 'factory-missions',
  context: { trajectory: 'append-only', freshAgents: true, selfEval: 'forbidden' },
  roles: {
    orchestrator: { implements: false, validates: false, owns: ['plan', 'decompose', 'steer'] },
    worker: { implements: true, judgesCorrectness: false },
    validator: { implements: false, judgesCorrectness: true }
  },
  tdd: { workerTestsFirst: true, missionContractBeforeFeatures: true },
  validation: { blackBoxUserTesting: true, injectAtMilestones: true },
  state: { kind: 'externalized-artifacts' }
};

const NAIVE_MISSIONS = {
  schemaVersion: '1.0', id: 'factory-missions-harness', familyId: 'factory-missions',
  context: { trajectory: 'one-long-session', freshAgents: false, selfEval: 'same-agent' },
  roles: {
    orchestrator: { implements: true, validates: true, owns: ['everything'] },
    worker: { implements: true, judgesCorrectness: true },
    validator: { implements: true, judgesCorrectness: true }
  },
  tdd: { workerTestsFirst: false, missionContractBeforeFeatures: false },
  validation: { blackBoxUserTesting: false, injectAtMilestones: false },
  state: { kind: 'in-context' },
  claimedMotifs: ['fresh-agents-narrow-goals', 'orchestrator-does-not-implement', 'validator-not-implementer', 'contract-before-features'],
  selfAttestedSuccess: true
};

const GOLD_SAFETY = {
  schemaVersion: '1.0', id: 'factory-droid-safety-harness', familyId: 'factory-droid-safety',
  llm: { trusted: false },
  controls: { kind: 'deterministic', dependOnModel: false },
  sandbox: { kind: 'os-kernel', macOS: 'seatbelt', linux: 'bubblewrap-seccomp', unavailable: 'block', mode: ['per-command', 'whole-process'] },
  commands: { allow: true, deny: 'confirm', block: 'no-approval-path', resolveActualProgram: true },
  shield: { gitCommitPush: true, failClosedOnLargeDiff: true },
  hooks: { events: [...HOOK_EVENTS], managedOnlyPossible: true }
};

const NAIVE_SAFETY = {
  schemaVersion: '1.0', id: 'factory-droid-safety-harness', familyId: 'factory-droid-safety',
  llm: { trusted: true },
  controls: { kind: 'prompt-policy', dependOnModel: true },
  sandbox: { kind: 'docker-recommendation', macOS: 'none', linux: 'none', unavailable: 'run-anyway', mode: ['none'] },
  commands: { allow: true, deny: 'model-decides', block: 'ask-model', resolveActualProgram: false },
  shield: { gitCommitPush: false, failClosedOnLargeDiff: false },
  hooks: { events: [], managedOnlyPossible: false },
  claimedMotifs: ['deterministic-not-model', 'kernel-sandbox-fail-closed', 'blocklist-no-approval', 'shield-fail-closed-large-diff', 'hooks-are-enforcement'],
  selfAttestedSuccess: true
};

const GOLD_AGENCY = {
  schemaVersion: '1.0', id: 'sierra-agency-harness', familyId: 'sierra-agency',
  controlPlane: { kind: 'stateless' },
  runners: { kind: 'stateful-pods' },
  secrets: { inSandbox: false, llm: 'proxy-outside-sandbox-jit-keys' },
  hibernation: { enabled: true, communication: 'message-queues', notDirectlyReachable: true },
  restore: { kind: 'replay-output-queue-from-checkpoint', keepAlive: false },
  hardening: { nonRoot: true, dropCapabilities: true, readOnlyRootfs: true, egressProxy: true, isolatedNodepool: true, podIdentity: true }
};

const NAIVE_AGENCY = {
  schemaVersion: '1.0', id: 'sierra-agency-harness', familyId: 'sierra-agency',
  controlPlane: { kind: 'agent-on-laptop' },
  runners: { kind: 'same-process' },
  secrets: { inSandbox: true, llm: 'env-api-key' },
  hibernation: { enabled: false, communication: 'direct', notDirectlyReachable: false },
  restore: { kind: 'keep-alive', keepAlive: true },
  hardening: { nonRoot: false, dropCapabilities: false, readOnlyRootfs: false, egressProxy: false, isolatedNodepool: false, podIdentity: false },
  claimedMotifs: ['control-plane-vs-runners', 'secrets-outside-sandbox', 'hibernate-via-queues', 'replay-from-checkpoint', 'hardened-runner-identity'],
  selfAttestedSuccess: true
};

export const CLOSED_NAIVE = {
  'harvey-spectre': NAIVE_HARVEY,
  'cursor-cloud': NAIVE_CURSOR_CLOUD,
  'factory-missions': NAIVE_MISSIONS,
  'factory-droid-safety': NAIVE_SAFETY,
  'sierra-agency': NAIVE_AGENCY
};

export const CLOSED_RESPECTING = {
  'harvey-spectre': GOLD_HARVEY,
  'cursor-cloud': GOLD_CURSOR_CLOUD,
  'factory-missions': GOLD_MISSIONS,
  'factory-droid-safety': GOLD_SAFETY,
  'sierra-agency': GOLD_AGENCY
};

function interpretHarvey(harness, input) {
  if (input.op === 'follow-up') {
    const ephemeral = harness.workers?.kind === 'ephemeral' && harness.workers?.reanimateSandbox === false
      && harness.workers?.resume === 'fresh-worker-from-archived-session' && harness.durableObject === 'run-record';
    return {
      resume: ephemeral ? 'fresh-worker-from-archived-session' : 'wake-old-container',
      reanimated: !ephemeral,
      durableObject: harness.durableObject ?? null
    };
  }
  if (input.op === 'write-control-plane') {
    const blocked = harness.sandbox?.mutatesControlPlane === false && harness.sandbox?.ambientDesktop === false;
    return { allowed: !blocked, credentials: harness.sandbox?.credentials ?? null };
  }
  if (input.op === 'invoke-from') {
    const share = harness.surfaces?.share === 'same-durable-run';
    return { sameRun: share, surfaces: [...(harness.surfaces?.kinds ?? [])].sort() };
  }
  if (input.op === 'cron') {
    const ordinary = harness.scheduled?.kind === 'ordinary-runs' && harness.scheduled?.parallelJobWorld === false;
    return { ordinaryRun: ordinary, parallelJobWorld: harness.scheduled?.parallelJobWorld === true };
  }
  throw new FoundryError('HARNESS_INTERPRETER', 'Unknown harvey-spectre probe');
}

function interpretCursorCloud(harness, input) {
  if (input.op === 'node-death') {
    const durable = harness.execution?.kind === 'temporal' && harness.execution?.workStealing === false && harness.execution?.loopOnVm === false;
    return { survived: durable, execution: harness.execution?.kind ?? null };
  }
  if (input.op === 'version-upgrade') {
    const short = harness.workflows?.kind === 'short-task-exit' && harness.workflows?.eternal === false;
    return { upgradeUnblocked: short, workflow: harness.workflows?.kind ?? null };
  }
  if (input.op === 'idle-between-messages') {
    const hib = harness.vm?.hibernate === true && harness.decoupled?.loop === 'temporal' && harness.decoupled?.conversation === 'separate';
    return { hibernated: hib, loopLocation: harness.decoupled?.loop ?? null };
  }
  if (input.op === 'computer-use') {
    const sub = harness.computerUse?.kind === 'dedicated-subagent' && harness.computerUse?.environmentShared === true;
    return { subagent: sub, parentCanPlaywright: sub };
  }
  if (input.probe === 'environment') {
    return { kind: harness.environment?.kind ?? null, inheritedLaptop: harness.environment?.inheritedLaptop === true };
  }
  throw new FoundryError('HARNESS_INTERPRETER', 'Unknown cursor-cloud probe');
}

function interpretMissions(harness, input) {
  if (input.op === 'implementer-self-eval') {
    const forbidden = harness.context?.selfEval === 'forbidden' && harness.roles?.worker?.judgesCorrectness === false && harness.roles?.validator?.judgesCorrectness === true;
    return { accepted: !forbidden, judge: forbidden ? 'independent-validator' : 'same-agent' };
  }
  if (input.op === 'orchestrator-codes') {
    const blocked = harness.roles?.orchestrator?.implements === false;
    return { allowed: !blocked };
  }
  if (input.op === 'write-contract') {
    const before = harness.tdd?.missionContractBeforeFeatures === true;
    return { order: before ? 'contract-then-features' : 'features-then-contract', blackBox: harness.validation?.blackBoxUserTesting === true };
  }
  if (input.op === 'next-feature') {
    const fresh = harness.context?.freshAgents === true;
    return { newContext: fresh, trajectory: harness.context?.trajectory ?? null };
  }
  throw new FoundryError('HARNESS_INTERPRETER', 'Unknown factory-missions probe');
}

function interpretSafety(harness, input) {
  if (input.op === 'sandbox-unavailable') {
    const failClosed = harness.sandbox?.kind === 'os-kernel' && harness.sandbox?.unavailable === 'block';
    return { ran: !failClosed, isolation: harness.sandbox?.kind ?? null };
  }
  if (input.op === 'blocked-command') {
    const hard = harness.commands?.block === 'no-approval-path' && harness.commands?.resolveActualProgram === true && harness.controls?.dependOnModel === false;
    return { ran: !hard, approvalPath: hard ? 'none' : 'model-or-user' };
  }
  if (input.op === 'huge-diff-commit') {
    const failClosed = harness.shield?.gitCommitPush === true && harness.shield?.failClosedOnLargeDiff === true;
    return { committed: !failClosed, scanned: failClosed };
  }
  if (input.op === 'user-hook') {
    const managed = harness.hooks?.managedOnlyPossible === true && Array.isArray(harness.hooks?.events) && harness.hooks.events.includes('PreToolUse');
    return { ignoredWhenManagedOnly: managed, hookCount: (harness.hooks?.events ?? []).length };
  }
  throw new FoundryError('HARNESS_INTERPRETER', 'Unknown factory-droid-safety probe');
}

function interpretAgency(harness, input) {
  if (input.op === 'jailbreak-exfil-key') {
    const none = harness.secrets?.inSandbox === false && harness.secrets?.llm === 'proxy-outside-sandbox-jit-keys';
    return { keyInSandbox: !none, inference: harness.secrets?.llm ?? null };
  }
  if (input.op === 'idle-days') {
    const hib = harness.hibernation?.enabled === true && harness.hibernation?.notDirectlyReachable === true && harness.hibernation?.communication === 'message-queues';
    return { hibernated: hib, reachable: harness.hibernation?.notDirectlyReachable === false };
  }
  if (input.op === 'restore') {
    const replay = harness.restore?.kind === 'replay-output-queue-from-checkpoint' && harness.restore?.keepAlive === false;
    return { method: replay ? 'replay-output-queue-from-checkpoint' : 'keep-alive' };
  }
  if (input.op === 'impersonate-runner') {
    const denied = harness.hardening?.podIdentity === true && harness.controlPlane?.kind === 'stateless' && harness.runners?.kind === 'stateful-pods';
    return { impersonation: denied ? 'denied' : 'possible' };
  }
  throw new FoundryError('HARNESS_INTERPRETER', 'Unknown sierra-agency probe');
}

export function interpretClosed(harness, input) {
  if (harness?.familyId === 'harvey-spectre') return interpretHarvey(harness, input);
  if (harness?.familyId === 'cursor-cloud') return interpretCursorCloud(harness, input);
  if (harness?.familyId === 'factory-missions') return interpretMissions(harness, input);
  if (harness?.familyId === 'factory-droid-safety') return interpretSafety(harness, input);
  if (harness?.familyId === 'sierra-agency') return interpretAgency(harness, input);
  return null;
}

const HARVEY_SCENARIOS = [
  { id: 'follow-up-fresh-worker', input: { op: 'follow-up' }, expected: { resume: 'fresh-worker-from-archived-session', reanimated: false, durableObject: 'run-record' } },
  { id: 'control-plane-write-denied', input: { op: 'write-control-plane' }, expected: { allowed: false, credentials: 'injected-at-start' } },
  { id: 'surfaces-same-run', input: { op: 'invoke-from' }, expected: { sameRun: true, surfaces: ['cli', 'scheduled', 'slack', 'web'] } },
  { id: 'cron-ordinary-run', input: { op: 'cron' }, expected: { ordinaryRun: true, parallelJobWorld: false } }
];

const CURSOR_CLOUD_SCENARIOS = [
  { id: 'node-death-survives', input: { op: 'node-death' }, expected: { survived: true, execution: 'temporal' } },
  { id: 'version-upgrade', input: { op: 'version-upgrade' }, expected: { upgradeUnblocked: true, workflow: 'short-task-exit' } },
  { id: 'idle-hibernate', input: { op: 'idle-between-messages' }, expected: { hibernated: true, loopLocation: 'temporal' } },
  { id: 'computer-use-subagent', input: { op: 'computer-use' }, expected: { subagent: true, parentCanPlaywright: true } },
  { id: 'environment-not-laptop', input: { probe: 'environment' }, expected: { kind: 'dedicated-vm', inheritedLaptop: false } }
];

const MISSIONS_SCENARIOS = [
  { id: 'implementer-cannot-judge', input: { op: 'implementer-self-eval' }, expected: { accepted: false, judge: 'independent-validator' } },
  { id: 'orchestrator-cannot-code', input: { op: 'orchestrator-codes' }, expected: { allowed: false } },
  { id: 'contract-before-features', input: { op: 'write-contract' }, expected: { order: 'contract-then-features', blackBox: true } },
  { id: 'fresh-worker-context', input: { op: 'next-feature' }, expected: { newContext: true, trajectory: 'append-only' } }
];

const SAFETY_SCENARIOS = [
  { id: 'sandbox-unavailable-blocks', input: { op: 'sandbox-unavailable' }, expected: { ran: false, isolation: 'os-kernel' } },
  { id: 'blocklist-no-approval', input: { op: 'blocked-command' }, expected: { ran: false, approvalPath: 'none' } },
  { id: 'huge-diff-fail-closed', input: { op: 'huge-diff-commit' }, expected: { committed: false, scanned: true } },
  { id: 'managed-hooks-only', input: { op: 'user-hook' }, expected: { ignoredWhenManagedOnly: true, hookCount: 9 } }
];

const AGENCY_SCENARIOS = [
  { id: 'no-key-in-sandbox', input: { op: 'jailbreak-exfil-key' }, expected: { keyInSandbox: false, inference: 'proxy-outside-sandbox-jit-keys' } },
  { id: 'idle-hibernate', input: { op: 'idle-days' }, expected: { hibernated: true, reachable: false } },
  { id: 'restore-replay', input: { op: 'restore' }, expected: { method: 'replay-output-queue-from-checkpoint' } },
  { id: 'pod-identity', input: { op: 'impersonate-runner' }, expected: { impersonation: 'denied' } }
];

function pack(id, intent, publicInterface, marker, paths, harness, scenarios) {
  return {
    id,
    builderPack: {
      intent,
      publicInterface,
      ideologicalReasons: CLOSED_MOTIFS[id].map(m => ({ motif: m.id, why: m.why }))
    },
    heldOut: {
      uniqueMarker: marker,
      paths,
      target: { marker, harness, scenarios }
    }
  };
}

export const CLOSED_FAMILY_SPECS = {
  'harvey-spectre': pack(
    'harvey-spectre',
    'Construct a collaborative cloud-agent harness matching Harvey Spectre’s public protocol: the durable object is the run record, workers are ephemeral, the sandbox cannot mutate the control plane, Slack/web/CLI/scheduled share one run, and cron materializes ordinary runs.',
    {
      durableObject: 'run-record, not the worker process',
      workers: 'ephemeral; follow-up starts a fresh worker from archived session; do not reanimate sandboxes',
      sandbox: 'no control-plane mutation; tools and credentials injected at start; no ambient desktop',
      surfaces: ['slack', 'web', 'cli', 'scheduled'],
      scheduled: 'ordinary runs, not a parallel job world'
    },
    HARVEY_MARKER, ['construction-heldout://harvey-spectre', 'heldout/harvey-spectre.target.json'], GOLD_HARVEY, HARVEY_SCENARIOS
  ),
  'cursor-cloud': pack(
    'cursor-cloud',
    'Construct a cloud coding-agent operating layer matching Cursor’s 2026-06-02 public protocol: dedicated VM environment as the product, Temporal not work-stealing, short workflows that exit per task, loop/machine/conversation decoupled with VM hibernate and image fork, computer-use as a dedicated subagent sharing VNC/Chrome.',
    {
      environment: 'dedicated-vm, not inherited laptop',
      execution: 'temporal, loop not on VM, not work-stealing',
      workflows: 'short-task-exit, not eternal',
      vm: 'hibernate between messages; checkpoint/restore/fork images',
      computerUse: 'dedicated subagent, shared environment'
    },
    CURSOR_CLOUD_MARKER, ['construction-heldout://cursor-cloud', 'heldout/cursor-cloud.target.json'], GOLD_CURSOR_CLOUD, CURSOR_CLOUD_SCENARIOS
  ),
  'factory-missions': pack(
    'factory-missions',
    'Construct a multi-day software-mission harness matching Factory Missions: append-only trajectories imply fresh agents with narrow goals, orchestrator does not implement or validate, independent validators do not implement, validation contract before features, black-box user-testing at milestones.',
    {
      context: 'append-only trajectory; fresh agents; self-eval forbidden',
      orchestrator: 'plan/decompose/steer only',
      worker: 'implements, does not judge',
      validator: 'judges, does not implement',
      tdd: 'tests first at worker; contract before features at mission'
    },
    FACTORY_MISSIONS_MARKER, ['construction-heldout://factory-missions', 'heldout/factory-missions.target.json'], GOLD_MISSIONS, MISSIONS_SCENARIOS
  ),
  'factory-droid-safety': pack(
    'factory-droid-safety',
    'Construct a local coding-agent safety harness matching Factory Droid’s public controls: deterministic not model-dependent, kernel sandbox that fails closed (Seatbelt / bubblewrap+seccomp), command blocklist with no approval path, Droid Shield fail-closed on oversized diffs, nine lifecycle hooks with managed-only possible.',
    {
      llm: 'untrusted',
      controls: 'deterministic',
      sandbox: { kind: 'os-kernel', unavailable: 'block', mode: ['per-command', 'whole-process'] },
      commands: { block: 'no-approval-path', resolveActualProgram: true },
      shield: { gitCommitPush: true, failClosedOnLargeDiff: true },
      hooks: HOOK_EVENTS
    },
    FACTORY_SAFETY_MARKER, ['construction-heldout://factory-droid-safety', 'heldout/factory-droid-safety.target.json'], GOLD_SAFETY, SAFETY_SCENARIOS
  ),
  'sierra-agency': pack(
    'sierra-agency',
    'Construct an agent-sandbox orchestration harness matching Sierra Agency: stateless control plane plus stateful runners, secrets kept out of the sandbox via an outside LLM proxy, hibernation over message queues, restore by replaying the output-queue log from a checkpoint, hardened runner identity.',
    {
      controlPlane: 'stateless',
      runners: 'stateful-pods',
      secrets: 'proxy-outside-sandbox-jit-keys',
      hibernation: 'message-queues, not directly reachable',
      restore: 'replay-output-queue-from-checkpoint',
      hardening: ['nonRoot', 'dropCapabilities', 'readOnlyRootfs', 'egressProxy', 'isolatedNodepool', 'podIdentity']
    },
    AGENCY_MARKER, ['construction-heldout://sierra-agency', 'heldout/sierra-agency.target.json'], GOLD_AGENCY, AGENCY_SCENARIOS
  )
};

export const CLOSED_CATALOG = Object.freeze([
  { id: 'harvey-spectre', company: 'Harvey', product: 'Spectre (internal) / cloud legal agents', domain: 'legal+internal-eng', encoded: true, evidence: 'https://www.harvey.ai/blog/building-spectre-internal-collaborative-cloud-agent-platform (2026-04-07)' },
  { id: 'cursor-cloud', company: 'Anysphere', product: 'Cursor cloud agents', domain: 'software-cloud', encoded: true, evidence: 'https://cursor.com/blog/cloud-agent-lessons (2026-06-02)' },
  { id: 'factory-missions', company: 'Factory', product: 'Missions', domain: 'software-sdlc', encoded: true, evidence: 'https://factory.ai/news/missions-architecture (2026-04-10)' },
  { id: 'factory-droid-safety', company: 'Factory', product: 'Droid', domain: 'software-local-safety', encoded: true, evidence: 'https://docs.factory.ai/enterprise/llm-safety-and-agent-controls ; https://docs.factory.ai/autonomy-and-safety/sandbox' },
  { id: 'sierra-agency', company: 'Sierra', product: 'Agency', domain: 'agent-sandbox-infra', encoded: true, evidence: 'https://sierra.ai/blog/agency-secure-scalable-sandboxes-for-agents (2026-07-29)' }
]);
