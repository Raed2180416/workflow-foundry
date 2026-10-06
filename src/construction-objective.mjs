import { clone, digest, FoundryError } from './data.mjs';
import { validateWorkflow } from './validate.mjs';
import { createDefaultRegistry } from './capabilities.mjs';
import { FOUNDRY_IR_LIMITS } from './construction-durable.mjs';

export const OBJECTIVE_FAMILY_ID = 'objective-composition';
const registry = createDefaultRegistry();

export const IR_UNSUPPORTED = Object.freeze([
  'delayMsMax:3600000',
  'compensateKind:false',
  'continueAsNew:false',
  'timerDispatch:persisted-wake-reinvoke',
  'waitCrashRestartsDeadline:true',
  'budgetPolicyCapMs:3600000',
  'singleWriterPerKey:false',
  'eventCronTrigger:false',
  'constructionDrivesGenerator:false'
]);

export const REQUIREMENT_LIBRARY = Object.freeze([
  { id: 'human-gate', cue: /\b(humans?|approv\w*|sign-?off|hitl|handoffs?|escalat\w*|reviewers?|supervisors?|accept\w*|discards?)\b/i, why: 'HITL is a human node that survives a worker restart, not a chat turn into an LLM loop.' },
  { id: 'high-risk-not-model-owned', cue: /\b(medical|legal|financial|refunds?|jailbreak|minors?|self-harm|finance|invoices?|loans?|statements?)\b/i, why: 'High-risk classes escalate to a human; the model does not own send.' },
  { id: 'durable-wait', cue: /\b(waits?|delays?|sleeps?|pauses?|timers?|(?:30|thirty)[\s-]*days?|months?)\b/i, why: 'Waits are wait nodes with delayMs; months-scale is unsupported and named.' },
  { id: 'compensation-named-limit', cue: /\b(compensat\w*|rollbacks?|undos?|sagas?)\b/i, why: 'Foundry has no compensate kind; requesting it must appear in envelope.unsupported.' },
  { id: 'branching', cue: /\b(branch(?:es|ing)?|if\b|error path|on error|routers?|otherwise|else\b|separate error)\b/i, why: 'Branching is when-conditions or onError continue, not a hidden LLM choice.' },
  { id: 'recovery', cue: /\b(retr(?:y|ies|ying)|recover\w*|flak\w*|poison|dead-?letter|parks?)\b/i, why: 'Retries are bounded on task nodes; poison park is named unsupported.' },
  { id: 'isolation', cue: /\b(sandboxes?|isolat\w*|untrusted|github issue|patch|code migrat\w*)\b/i, why: 'Untrusted execution is isolated; the host owns stop.' },
  { id: 'pre-post-llm-gate', cue: /\b(customer support|refunds?|help center|\bcx\b|chat agents?|conversations?|damaged orders?)\b/i, why: 'CX is a pre-filter plus post-generate gate, not llm-first.' },
  { id: 'map-fanout', cue: /\b(each\b|every\b|matches|batches?|fan-?outs?|games?)\b/i, why: 'Fan-out is a bounded map node, not an unbounded agent swarm.' },
  { id: 'loop-until', cue: /\b(until\b|iterat\w*|loops?|retr(?:y|ies|ying)\s+flak\w*)\b/i, why: 'Iteration is a bounded loop node, not an unbounded agent loop.' },
  { id: 'research-grounding', cue: /\b(research\w*|papers?|citations?|sources?|evidence|ungrounded)\b/i, why: 'Research outputs are gated on grounding, not free generation.' },
  { id: 'verification', cue: /\b(verif\w*|evaluat\w*|scor\w*|accept\w*|asserts?|checks?|tests?|health|ground(?:ed|ing)?)\b/i, why: 'Production workflows fail closed on acceptance checks, not self-attestation.' }
]);

const UNGROUNDED = Object.freeze([
  { id: 'telepathy', cue: /\b(telepath\w*|read(?:ing)? minds|mind-?reads?)\b/i },
  { id: 'magic', cue: /\b(magic spells?|warp drives?|time travel|quantum consciousness)\b/i }
]);

export function walkNodes(flow, visit) {
  for (const node of flow?.nodes ?? []) {
    visit(node);
    if (node.body) walkNodes(node.body, visit);
  }
}

export function nodeKindsOf(workflow) {
  const kinds = new Set();
  walkNodes(workflow, node => kinds.add(node.kind));
  return [...kinds].sort();
}

export function maxDelayMs(workflow) {
  let max = 0;
  walkNodes(workflow, node => {
    if (node.kind === 'wait' && Number.isFinite(node.delayMs)) max = Math.max(max, node.delayMs);
  });
  return max;
}

function hasKind(workflow, kind) {
  let found = false;
  walkNodes(workflow, node => { if (node.kind === kind) found = true; });
  return found;
}

function hasTool(workflow, tool) {
  let found = false;
  walkNodes(workflow, node => { if (node.tool === tool) found = true; });
  return found;
}

function hasWhenOrOnError(workflow) {
  let found = false;
  walkNodes(workflow, node => {
    if (node.when || node.onError === 'continue') found = true;
  });
  return found;
}

function retriesBounded(workflow) {
  let ok = true;
  let seen = false;
  walkNodes(workflow, node => {
    if (node.kind !== 'task') return;
    seen = true;
    const n = node.retry?.maxAttempts;
    if (!Number.isInteger(n) || n < 1 || n > 10) ok = false;
  });
  return seen && ok;
}

function requestedBeyondIr(text) {
  const out = [];
  if (/\b((?:30|thirty)[\s-]*days?|months?|weeks?)\b/i.test(text)) out.push({ limit: 'delayMsMax', requested: 'days-or-months-scale' });
  if (/\b(compensat\w*|sagas?)\b/i.test(text)) out.push({ limit: 'compensateKind', requested: 'saga-compensate' });
  if (/\btimer[- ]service\b/i.test(text)) out.push({ limit: 'timerDispatch', requested: 'timer-service' });
  if (/\b(crons?|event triggers?|schedules?)\b/i.test(text)) out.push({ limit: 'eventCronTrigger', requested: 'event-or-cron' });
  return out;
}

export function extractRequirements(objective) {
  const text = typeof objective === 'string' ? objective.trim() : '';
  if (!text) return { code: 'OBJECTIVE_REQUIRED', message: 'An objective string is required' };
  const ungrounded = UNGROUNDED.filter(u => u.cue.test(text)).map(u => u.id);
  const requirements = REQUIREMENT_LIBRARY.filter(r => r.cue.test(text)).map(r => r.id);
  if (ungrounded.length) return { code: 'UNGROUNDED_OBJECTIVE', message: `Objective requests capabilities this compiler cannot ground: ${ungrounded.join(', ')}`, ungrounded, requirements };
  if (!requirements.length) return { code: 'UNKNOWN_OBJECTIVE', message: 'Objective matched no grounded requirement; refusing a generic identity workflow', requirements: [], ungrounded: [] };
  if (!requirements.includes('verification')) requirements.push('verification');
  return { requirements, ungrounded: [], requestedBeyondIr: requestedBeyondIr(text), text };
}

function task(id, description, needs, tool, args, extra = {}) {
  return {
    id, kind: 'task', needs, description, tool, args,
    timeoutMs: extra.timeoutMs ?? 5000,
    retry: extra.retry ?? { maxAttempts: extra.maxAttempts ?? 2, backoffMs: 100 },
    ...(extra.when ? { when: extra.when } : {}),
    ...(extra.onError ? { onError: extra.onError } : {}),
    ...(extra.join ? { join: extra.join } : {})
  };
}

function human(id, question, needs = []) {
  return {
    id, kind: 'human', needs, description: question,
    question, answerSchema: { type: 'object', additionalProperties: false, required: ['approved'], properties: { approved: { type: 'boolean' }, note: { type: 'string' } } }
  };
}

function wait(id, delayMs, needs = []) {
  return { id, kind: 'wait', needs, description: 'Bounded durable wait (Foundry delayMs max 1 hour)', delayMs };
}

function assertNode(id, checks, needs = []) {
  return { id, kind: 'assert', needs, description: 'Fail closed on acceptance evidence', checks };
}

function domainOf(requirements) {
  if (requirements.includes('isolation')) return 'software';
  if (requirements.includes('pre-post-llm-gate')) return 'customer-support';
  if (requirements.includes('research-grounding')) return 'research';
  if (requirements.includes('map-fanout')) return 'evaluation';
  if (requirements.includes('durable-wait')) return 'business';
  if (requirements.includes('high-risk-not-model-owned')) return 'finance';
  if (requirements.includes('branching')) return 'automation';
  return 'general';
}

function unsupportedFor(extracted) {
  const extra = (extracted.requestedBeyondIr ?? []).map(r => `requested:${r.requested};limit:${r.limit}`);
  return [...IR_UNSUPPORTED, ...extra];
}

function authoringFlags(autoApply = false) {
  return Object.freeze({
    inspectable: true,
    editable: true,
    versioned: true,
    freezeable: true,
    validateBeforeSave: true,
    humanAcceptDiscard: true,
    evidenceBound: true,
    autoApply
  });
}

function envelope(extracted, extraAssumptions = [], extraRisks = []) {
  const beyond = (extracted.requestedBeyondIr ?? []).map(r => `${r.limit} cannot execute ${r.requested}`);
  return {
    assumptions: ['Local Foundry IR only', 'Capabilities are the default registry', 'Claim input is caller-supplied and requires independent verification', ...extraAssumptions],
    risks: ['Named IR limits are not vendor protocols', ...beyond, ...extraRisks],
    successCriteria: ['Local acceptance checks pass on supplied data', 'Unsupported IR requests stay named and unexecuted'],
    unsupported: unsupportedFor(extracted)
  };
}

function naiveCandidate(extracted, { objectiveId = 'freeform' } = {}) {
  const workflow = {
    schemaVersion: '1.0',
    id: `ObjNaive${digest(extracted.text).slice(0, 8)}`,
    version: 1,
    title: 'Naive linear identity',
    goal: extracted.text.slice(0, 10000),
    domain: 'general',
    envelope: { assumptions: ['None'], risks: ['None'], successCriteria: ['Something ran'] },
    budget: { maxSteps: 10, maxConcurrency: 1, maxDurationMs: 2592000000, maxCost: 0 },
    nodes: [task('pass', 'Schema-valid identity with no production motifs', [], 'core.identity', { ok: true }, { maxAttempts: 1 })],
    acceptance: [{ op: 'exists', value: { $ref: 'nodes.pass.ok' } }]
  };
  return {
    schemaVersion: '1.0',
    familyId: OBJECTIVE_FAMILY_ID,
    objectiveId,
    objective: extracted.text,
    workflow,
    requirements: [],
    ungrounded: [],
    requestedBeyondIr: [],
    irLimits: FOUNDRY_IR_LIMITS,
    authoring: authoringFlags(true),
    selfAttestedSuccess: true,
    claimedMotifs: ['schema-valid-workflow', 'human-gate-when-required']
  };
}

function branchNodes(needs, value = { ok: true }) {
  return [
    task('fetch', 'Local fetch-result placeholder', needs, 'core.identity', value, { onError: 'continue' }),
    task('okPath', 'Continue when fetch succeeded', ['fetch'], 'core.identity', { branch: 'ok' }, {
      join: 'all_resolved',
      when: { op: 'eq', left: { $ref: 'nodes.fetch.ok', default: false }, right: true }
    }),
    task('errPath', 'Handle fetch failure within this scope', ['fetch'], 'core.identity', { branch: 'error' }, {
      // A handled_error predecessor is resolved, but is not all_success.
      join: 'all_resolved',
      when: { op: 'ne', left: { $ref: 'nodes.fetch.ok', default: false }, right: true }
    }),
    task('join', 'Join success and error paths with explicit absent slots', ['okPath', 'errPath'], 'core.collect', {
      items: [{ $ref: 'nodes.okPath.branch', default: null }, { $ref: 'nodes.errPath.branch', default: null }]
    }, { join: 'all_resolved' })
  ];
}

function branchResultCheck() {
  // Neither a pair of absent outputs nor two selected paths is a valid result.
  return { op: 'any', conditions: [
    { op: 'eq', left: { $ref: 'nodes.join.items', default: [] }, right: ['ok', null] },
    { op: 'eq', left: { $ref: 'nodes.join.items', default: [] }, right: [null, 'error'] }
  ] };
}

function stepBound(nodes) {
  // Conservative bound for these fixed fragments, including retry attempts and
  // all map/loop iterations. Conditional paths may make the actual count lower.
  return nodes.reduce((total, node) => {
    if (node.kind === 'task') return total + node.retry.maxAttempts;
    if (node.body) return total + 1 + (node.kind === 'map' ? node.maxItems : node.maxIterations) * stepBound(node.body.nodes);
    return total + 1;
  }, 0);
}

function composeNodes(extracted) {
  const req = new Set(extracted.requirements);
  const nodes = [];
  const assumptions = [];
  const risks = [];
  let last = [];

  if (req.has('pre-post-llm-gate') || req.has('high-risk-not-model-owned')) {
    nodes.push(assertNode('preGate', [{ op: 'eq', left: { $ref: 'input.blocked', default: false }, right: false }], []));
    last = ['preGate'];
  }

  if (req.has('isolation')) {
    assumptions.push('Untrusted execution is isolated from the coordinator');
    risks.push('Host owns stop; the model cannot declare done');
    nodes.push(task('isolate', 'Record isolation and host-owned stop', last, 'core.identity', { isolated: true, hostOwnsStop: true }));
    last = ['isolate'];
  }

  if (req.has('human-gate') || req.has('high-risk-not-model-owned')) {
    nodes.push(human('approve', 'Human must accept or discard this proposal before side effects', last));
    last = ['approve'];
    nodes.push(assertNode('approved', [{ op: 'eq', left: { $ref: 'nodes.approve.answer.approved' }, right: true }], last));
    last = ['approved'];
  }

  if (req.has('map-fanout')) {
    if (req.has('branching')) assumptions.push('Each input.matches item supplies its own fetch result; core.identity performs no HTTP request');
    nodes.push({
      id: 'matches',
      kind: 'map',
      needs: last,
      description: req.has('branching') ? 'Branch independently for each supplied item' : 'Score each match with a bounded fan-out',
      items: { $ref: 'input.matches' },
      maxItems: 32,
      body: req.has('branching') ? {
        nodes: branchNodes([], { $ref: 'item' }),
        acceptance: [branchResultCheck()]
      } : {
        nodes: [task('score', 'Score one match', [], 'core.identity', { scored: true })],
        acceptance: [{ op: 'eq', left: { $ref: 'nodes.score.scored' }, right: true }]
      }
    });
    last = ['matches'];
  } else if (req.has('branching')) {
    assumptions.push('Fetch uses a fixed local identity result; no HTTP request is performed');
    nodes.push(...branchNodes(last));
    last = ['join'];
  } else if (!req.has('durable-wait')) {
    nodes.push(task('work', 'Local work placeholder', last, 'core.identity', { done: true }));
    last = ['work'];
  }

  if (req.has('durable-wait')) {
    nodes.push(task('pay', 'Irreversible side effect isolated from wait replay', last, 'core.identity', { paid: true }));
    nodes.push(wait('pause', FOUNDRY_IR_LIMITS.delayMsMax, ['pay']));
    last = ['pause'];
  }

  if (req.has('loop-until')) {
    nodes.push({
      id: 'retryFlaky',
      kind: 'loop',
      needs: last,
      description: 'Retry flaky evaluation with a hard iteration cap',
      maxIterations: 3,
      initial: { attempt: 0 },
      until: { op: 'eq', left: { $ref: 'nodes.probe.ok' }, right: true },
      body: {
        nodes: [task('probe', 'Probe one attempt', [], 'core.identity', { ok: true })],
        acceptance: [{ op: 'exists', value: { $ref: 'nodes.probe.ok' } }]
      }
    });
    last = ['retryFlaky'];
  }

  if (req.has('research-grounding') || req.has('verification')) {
    // Validate the supplied assertion, without manufacturing positive evidence
    // for absence or treating a well-typed false value as true. This does not
    // retrieve sources or independently establish the truth of the claim.
    const schema = { type: 'object', additionalProperties: false, required: ['grounded'], properties: { grounded: { type: 'boolean', const: true } } };
    nodes.push(task('validate', 'Require the supplied claim to be explicitly marked grounded', last, 'core.validate', { value: { $ref: 'input.claim', default: null }, schema }));
    last = ['validate'];
  }

  const lastId = last[0];
  const lastNode = nodes.find(n => n.id === lastId);
  let verifyCheck = { op: 'exists', value: { $ref: `nodes.${lastId}` } };
  if (lastNode?.kind === 'wait') verifyCheck = { op: 'exists', value: { $ref: `nodes.${lastId}.waitedMs` } };
  else if (lastNode?.kind === 'assert') verifyCheck = { op: 'eq', left: { $ref: `nodes.${lastId}.passed` }, right: true };
  else if (lastNode?.kind === 'map') verifyCheck = { op: 'exists', value: { $ref: `nodes.${lastId}.count` } };
  else if (lastNode?.kind === 'loop') verifyCheck = { op: 'exists', value: { $ref: `nodes.${lastId}.iterations` } };
  else if (lastNode?.kind === 'human') verifyCheck = { op: 'exists', value: { $ref: `nodes.${lastId}.answer` } };
  else if (lastNode?.tool === 'core.validate') verifyCheck = { op: 'eq', left: { $ref: `nodes.${lastId}.valid` }, right: true };
  else if (lastNode?.tool === 'core.collect') verifyCheck = { op: 'exists', value: { $ref: `nodes.${lastId}.count` } };
  const verifyChecks = [verifyCheck];
  if (req.has('branching') && !req.has('map-fanout')) verifyChecks.push(branchResultCheck());
  nodes.push(assertNode('verify', verifyChecks, last));
  if (req.has('research-grounding') || req.has('verification')) {
    nodes.push(task('artifact', 'Write an inspectable receipt', ['verify'], 'core.artifact', { name: 'receipt.json', content: '{"status":"composed"}' }));
  }

  return { nodes, assumptions, risks };
}

function composeCandidate(extracted, { objectiveId = 'freeform' } = {}) {
  const { nodes, assumptions, risks } = composeNodes(extracted);
  const workflow = {
    schemaVersion: '1.0',
    id: objectiveId === 'freeform' ? `Obj${digest(extracted.text).slice(0, 12)}` : objectiveId,
    version: 1,
    title: extracted.text.slice(0, 200),
    goal: extracted.text.slice(0, 10000),
    domain: domainOf(extracted.requirements),
    envelope: envelope(extracted, assumptions, risks),
    inputSchema: { type: 'object' },
    budget: { maxSteps: Math.max(80, stepBound(nodes)), maxConcurrency: 2, maxDurationMs: FOUNDRY_IR_LIMITS.budgetPolicyCapMs, maxCost: 0 },
    nodes,
    acceptance: [{ op: 'eq', left: { $ref: 'nodes.verify.passed', default: false }, right: true }],
    metadata: {
      sources: ['construction-objective'],
      rationale: 'Keyword-based composition of local Foundry IR with supplied values; requires independent task verification.',
      tags: extracted.requirements
    }
  };
  return {
    schemaVersion: '1.0',
    familyId: OBJECTIVE_FAMILY_ID,
    objectiveId,
    objective: extracted.text,
    workflow,
    requirements: extracted.requirements,
    ungrounded: [],
    requestedBeyondIr: extracted.requestedBeyondIr,
    irLimits: FOUNDRY_IR_LIMITS,
    authoring: authoringFlags(false)
  };
}

export function composeObjectiveCandidate(objective, { mode = 'compose', objectiveId = 'freeform' } = {}) {
  const extracted = extractRequirements(objective);
  if (extracted.code) throw new FoundryError(extracted.code, extracted.message, { ungrounded: extracted.ungrounded, requirements: extracted.requirements });
  if (mode === 'naive') return naiveCandidate(extracted, { objectiveId });
  return composeCandidate(extracted, { objectiveId });
}

export function summarizeObjectiveCandidate(candidate) {
  const validation = validateWorkflow(candidate.workflow, { registry });
  return {
    motifs: (OBJECTIVE_MOTIFS[OBJECTIVE_FAMILY_ID] ?? []).filter(m => m.inspect(candidate)).map(m => m.id).sort(),
    nodeKinds: nodeKindsOf(candidate.workflow),
    unsupported: [...(candidate.workflow?.envelope?.unsupported ?? [])].sort(),
    valid: validation.valid
  };
}

function reqHas(candidate, id) {
  return (candidate.requirements ?? []).includes(id);
}

export const OBJECTIVE_MOTIFS = {
  [OBJECTIVE_FAMILY_ID]: [
    {
      id: 'schema-valid-workflow',
      why: 'The composed artifact must be Foundry workflow IR, not a parallel harness JSON clone.',
      inspect: c => validateWorkflow(c.workflow, { registry }).valid === true
    },
    {
      id: 'acceptance-not-self-attested',
      why: 'Acceptance checks are the gate; selfAttestedSuccess is not a pass.',
      inspect: c => Array.isArray(c.workflow?.acceptance) && c.workflow.acceptance.length >= 1 && c.selfAttestedSuccess !== true
    },
    {
      id: 'host-budget-capped',
      why: 'createRun silently caps at policy 1 hour; composition must not pretend a 30-day budget is executable.',
      inspect: c => Number(c.workflow?.budget?.maxDurationMs) <= FOUNDRY_IR_LIMITS.budgetPolicyCapMs
    },
    {
      id: 'ir-limits-named-in-envelope',
      why: 'FOUNDRY_IR_LIMITS must be named on envelope.unsupported rather than papered as Temporal.',
      inspect: c => {
        const u = c.workflow?.envelope?.unsupported ?? [];
        return IR_UNSUPPORTED.every(item => u.includes(item)) && digest(c.irLimits) === digest(FOUNDRY_IR_LIMITS);
      }
    },
    {
      id: 'no-compensate-node',
      why: 'compensate is not an IR node; requesting saga compensation cannot invent one.',
      inspect: c => !hasKind(c.workflow, 'compensate') && (c.workflow?.nodes ?? []).every(n => n.kind !== 'compensate')
    },
    {
      id: 'no-delay-beyond-ir',
      why: 'delayMs above 1 hour is SCHEMA-invalid; closeness cannot pass a months-scale wait node.',
      inspect: c => maxDelayMs(c.workflow) <= FOUNDRY_IR_LIMITS.delayMsMax
    },
    {
      id: 'requested-beyond-ir-named',
      why: 'Every requested capability past IR must appear as requested:* in unsupported.',
      inspect: c => (c.requestedBeyondIr ?? []).every(r => (c.workflow?.envelope?.unsupported ?? []).some(s => s.includes(r.limit)))
    },
    {
      id: 'verification-assert-or-validate',
      why: 'Verification is an assert node or core.validate, not a claimedMotifs string.',
      inspect: c => hasKind(c.workflow, 'assert') || hasTool(c.workflow, 'core.validate')
    },
    {
      id: 'authoring-inspect-version-freeze',
      why: 'Authoring must be inspectable, versioned and freezeable (Foundry save hash), not a canvas-only graph.',
      inspect: c => c.authoring?.inspectable === true && c.authoring?.versioned === true && c.authoring?.freezeable === true && c.authoring?.editable === true && c.authoring?.validateBeforeSave === true
    },
    {
      id: 'human-accept-not-auto-apply',
      why: 'Langflow MCP /assist/run auto-applies; Foundry proposals require human accept/discard.',
      inspect: c => c.authoring?.humanAcceptDiscard === true && c.authoring?.autoApply === false
    },
    {
      id: 'evidence-bound',
      why: 'Trials/repair/qualification bind evidence; a visual copilot graph is not that gate.',
      inspect: c => c.authoring?.evidenceBound === true && Array.isArray(c.workflow?.acceptance) && c.workflow.acceptance.length >= 1
    },
    {
      id: 'human-gate-when-required',
      why: 'Approval, escalation or high-risk send requires a human node.',
      inspect: c => !reqHas(c, 'human-gate') && !reqHas(c, 'high-risk-not-model-owned') ? true : hasKind(c.workflow, 'human')
    },
    {
      id: 'high-risk-human',
      why: 'Medical/legal/financial/refund cannot be model-owned send.',
      inspect: c => !reqHas(c, 'high-risk-not-model-owned') ? true : hasKind(c.workflow, 'human')
    },
    {
      id: 'wait-when-required',
      why: 'A requested wait is a wait node at or under delayMsMax, not process.sleep.',
      inspect: c => !reqHas(c, 'durable-wait') ? true : hasKind(c.workflow, 'wait') && maxDelayMs(c.workflow) <= FOUNDRY_IR_LIMITS.delayMsMax
    },
    {
      id: 'branching-when-required',
      why: 'Error branching is when or onError continue, not n8n continueOnFail papered as the same motif.',
      inspect: c => !reqHas(c, 'branching') ? true : hasWhenOrOnError(c.workflow)
    },
    {
      id: 'recovery-bounded',
      why: 'Retries are bounded 1–10; unbounded poison loops fail.',
      inspect: c => retriesBounded(c.workflow)
    },
    {
      id: 'isolation-named-when-required',
      why: 'Sandbox/untrusted exec must be named on the envelope, not implied by a coding-agent loop.',
      inspect: c => !reqHas(c, 'isolation') ? true : JSON.stringify(c.workflow.envelope).toLowerCase().includes('isolat')
    },
    {
      id: 'map-or-loop-when-required',
      why: 'Game/batch evaluation uses bounded map/loop nodes, not an unbounded agent swarm.',
      inspect: c => {
        if (reqHas(c, 'map-fanout') && !hasKind(c.workflow, 'map')) return false;
        if (reqHas(c, 'loop-until') && !hasKind(c.workflow, 'loop')) return false;
        return true;
      }
    }
  ]
};

export function requiredMotifsFor(requirements) {
  const always = [
    'schema-valid-workflow', 'acceptance-not-self-attested', 'host-budget-capped',
    'ir-limits-named-in-envelope', 'no-compensate-node', 'no-delay-beyond-ir',
    'requested-beyond-ir-named', 'verification-assert-or-validate',
    'authoring-inspect-version-freeze', 'human-accept-not-auto-apply', 'evidence-bound',
    'recovery-bounded'
  ];
  const extra = [];
  if (requirements.includes('human-gate') || requirements.includes('high-risk-not-model-owned')) extra.push('human-gate-when-required', 'high-risk-human');
  if (requirements.includes('durable-wait')) extra.push('wait-when-required');
  if (requirements.includes('branching')) extra.push('branching-when-required');
  if (requirements.includes('isolation')) extra.push('isolation-named-when-required');
  if (requirements.includes('map-fanout') || requirements.includes('loop-until')) extra.push('map-or-loop-when-required');
  return [...new Set([...always, ...extra])];
}

export function interpretObjective(candidate, input) {
  const workflow = candidate?.workflow;
  if (input.op === 'validate') return { valid: validateWorkflow(workflow, { registry }).valid === true };
  if (input.op === 'delay-bound') return { delayMsMax: maxDelayMs(workflow), withinIr: maxDelayMs(workflow) <= FOUNDRY_IR_LIMITS.delayMsMax };
  if (input.op === 'compensate') return { present: hasKind(workflow, 'compensate') };
  if (input.op === 'human') return { present: hasKind(workflow, 'human') };
  if (input.op === 'auto-apply') return { autoApply: candidate.authoring?.autoApply === true, humanAcceptDiscard: candidate.authoring?.humanAcceptDiscard === true };
  if (input.op === 'unsupported') return { unsupported: [...(workflow?.envelope?.unsupported ?? [])].sort() };
  if (input.op === 'node-kinds') return { kinds: nodeKindsOf(workflow) };
  return { interpreter: 'unknown-op' };
}

const OBJECTIVE_TEXTS = Object.freeze({
  ObjInvoiceWait: 'Approve invoice then pay, wait 30 days, compensate on cancel',
  ObjCxRefund: 'Refund a damaged order; medical questions escalate to a human',
  ObjCodingSandbox: 'Fix a GitHub issue in a sandbox; the host owns stop',
  ObjHttpBranch: 'HTTP fetch then branch on error with a separate error path',
  ObjGameEval: 'Evaluate a game by running matches, scoring, and retrying flaky runs',
  ObjFinanceReview: 'Review financial statements with human sign-off before sending',
  ObjResearchCite: 'Research a claim and refuse to send ungrounded citations'
});

function objectiveSpec(id, objective) {
  const extracted = extractRequirements(objective);
  if (extracted.code) throw new FoundryError('OBJECTIVE_FIXTURE', extracted.message);
  const composed = composeObjectiveCandidate(objective, { mode: 'compose', objectiveId: id });
  const expected = summarizeObjectiveCandidate(composed);
  const marker = `HELD_OUT_OBJECTIVE_${id}_TARGET_BYTES_v1_DO_NOT_FEED_BUILDER`;
  return {
    id,
    builderPack: {
      objective,
      intent: `Compose a Foundry workflow IR for: ${objective}`,
      publicInterface: {
        nodeKinds: ['task', 'assert', 'human', 'map', 'loop', 'wait'],
        irLimits: FOUNDRY_IR_LIMITS,
        authoring: 'inspect/edit/version/freeze; validate-before-save; human accept/discard; evidence-bound; autoApply false'
      },
      ideologicalReasons: requiredMotifsFor(extracted.requirements).map(motif => ({ motif, why: (OBJECTIVE_MOTIFS[OBJECTIVE_FAMILY_ID].find(m => m.id === motif) ?? {}).why }))
    },
    heldOut: {
      uniqueMarker: marker,
      paths: [`construction-heldout://objective/${id}`, `heldout/objective-${id}.target.json`],
      target: { marker, expected, scenarios: [
        { id: 'validate', input: { op: 'validate' }, expected: { valid: true } },
        { id: 'delay-bound', input: { op: 'delay-bound' }, expected: interpretObjective(composed, { op: 'delay-bound' }) },
        { id: 'compensate', input: { op: 'compensate' }, expected: { present: false } },
        { id: 'human', input: { op: 'human' }, expected: interpretObjective(composed, { op: 'human' }) },
        { id: 'auto-apply', input: { op: 'auto-apply' }, expected: { autoApply: false, humanAcceptDiscard: true } },
        { id: 'node-kinds', input: { op: 'node-kinds' }, expected: interpretObjective(composed, { op: 'node-kinds' }) },
        { id: 'unsupported', input: { op: 'unsupported' }, expected: interpretObjective(composed, { op: 'unsupported' }) }
      ] }
    }
  };
}

export const OBJECTIVE_SPECS = Object.freeze(Object.fromEntries(
  Object.entries(OBJECTIVE_TEXTS).map(([id, text]) => [id, objectiveSpec(id, text)])
));

export function listObjectiveIds() {
  return Object.keys(OBJECTIVE_SPECS).sort();
}

export { OBJECTIVE_TEXTS };
