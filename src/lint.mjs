// Strict construction lint (ROADMAP-AMENDMENTS R-15; review lane 5 §3.6; C0 REPORT-dev §6.1).
//
// Static checks on a SCHEMA-VALID workflow that reject patterns the C0 dev round showed to fool a builder
// and the run verdict. Every finding has a stable code, a path, a severity and a typed repair, so a
// constructor (or a repair loop) can act on it without parsing prose. The validator calls this when asked for
// `strict`; `foundry lint` prints it. The lint is structural: it recognizes the declared form of a guard, not
// whether the guard is any good. Its rules were written from the C0 dev artifacts, so firing on them is
// not independent evidence that a rule predicts failures (that needs artifacts built after the lint is frozen).
import { digest, references } from './data.mjs';
import { bindOutput } from './dataflow.mjs';
import { assessWorkflow, flowsOf } from './acceptance.mjs';
import { loadPolicy } from './models/policy.mjs';

export const LINT_PROFILE = 'strict-construction/1';
export const LINT_RULES = Object.freeze({
  ACCEPTANCE_EXISTENCE_ONLY: { severity: 'error', summary: 'Acceptance only checks that an answer exists' },
  VERIFY_NOT_GATING: { severity: 'error', summary: 'A verify node with gate:false that nothing reads cannot block the answer' },
  ERROR_COLLECTION: { severity: 'error', summary: 'A map collects item failures and nothing gates on the recorded failed count' },
  ESCALATION_WITHOUT_CHECKS: { severity: 'warning', summary: 'Check-triggered escalation or resampling is configured on a node that has no checks' },
  GLOBAL_READ_UNGUARDED: { severity: 'warning', summary: 'One model read conditions every item and has no evidence quote, no k-sample agreement and no stronger class' },
  CLASS_ABOVE_DEFAULT_UNJUSTIFIED: { severity: 'warning', summary: 'A model node starts above the workflow default class without model.justification' },
  NO_ORACLE_DECLARED: { severity: 'warning', summary: 'The workflow declares that no oracle exists; its runs end "unverified"' },
  ORACLE_DECLARATION_REDUNDANT: { severity: 'warning', summary: 'The workflow declares no oracle although its acceptance already holds a gating check' },
  LINT_RULE_SKIPPED: { severity: 'warning', summary: 'A lint rule could not run on this workflow' }
});

const READ_ROLES = new Set(['extract', 'classify', 'judge', 'route']);
const EVIDENCE = /evidence|quote|span|excerpt|citation|verbatim/i;
const DEFAULT_ORDER = ['S', 'M', 'L', 'F'];
const refsOf = value => { try { return references(value ?? null); } catch { return []; } };
const nodeIdOf = ref => { const [root, id] = String(ref).split('.'); return root === 'nodes' ? id ?? null : null; };
const usesModel = node => node.kind === 'agent' || (node.kind === 'verify' && node.method === 'agent');
const checksOf = node => node.kind === 'agent' ? node.checks ?? [] : [];

let defaultPolicy;
function policyFor(modelPolicy) {
  const policy = modelPolicy?.policy ?? modelPolicy;
  if (policy?.classOrder) return policy;
  if (defaultPolicy === undefined) { try { defaultPolicy = loadPolicy().policy; } catch { defaultPolicy = { classOrder: DEFAULT_ORDER, models: [] }; } }
  return defaultPolicy;
}

const finding = (code, path, message, { node, repair, details, severity } = {}) =>
  ({ code, severity: severity ?? LINT_RULES[code].severity, path, ...(node ? { node } : {}), message, repair, ...(details ? { details } : {}) });

// References a node makes, including its context inputs and (rewritten) output checks.
function nodeRefs(node) {
  const { body, source, instructions, returns, context, checks, ...rest } = node;
  const refs = [...refsOf(rest)];
  for (const spec of context?.inputs ?? []) if (typeof spec.ref === 'string') refs.push(spec.ref);
  if (checks) refs.push(...refsOf(bindOutput(checks)));
  return refs;
}
function evidencePaths(schema, trail = [], depth = 0, out = []) {
  if (!schema || typeof schema !== 'object' || depth > 6) return out;
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    if (EVIDENCE.test(key)) out.push([...trail, key].join('.'));
    evidencePaths(child, [...trail, key], depth + 1, out);
  }
  if (schema.items && !Array.isArray(schema.items)) evidencePaths(schema.items, trail, depth + 1, out);
  return out;
}

function buildContext(workflow, modelPolicy) {
  const policy = policyFor(modelPolicy), order = policy.classOrder;
  const indexOf = cls => { const i = order.indexOf(cls); return i < 0 ? null : i; };
  const startClass = node => node.model?.class ?? policy.models?.find(m => m.id === node.model?.id)?.class ?? null;
  const modelNodes = [];
  for (const { flow, path } of flowsOf(workflow)) for (const node of flow.nodes) if (usesModel(node)) modelNodes.push({ node, path: `${path}.${node.id}` });
  const startIndices = modelNodes.map(({ node }) => indexOf(startClass(node))).filter(i => i !== null);
  const declared = workflow.defaultClass === undefined ? null : indexOf(workflow.defaultClass);
  const defaultIndex = declared ?? (startIndices.length ? Math.min(...startIndices) : null);
  return { workflow, assessment: assessWorkflow(workflow), order, indexOf, startClass, modelNodes, defaultIndex,
    defaultSource: declared !== null ? 'declared' : 'derived (the cheapest class any model node starts on)' };
}

const rules = {
  acceptance({ assessment: { acceptance: a } }) {
    const out = [];
    if (a.grade === 'existence-only') {
      out.push(finding('ACCEPTANCE_EXISTENCE_ONLY', 'workflow.acceptance',
        `Acceptance only checks that an answer exists${a.weak.length ? ` (${a.weak.join('; ')})` : ''}; a well-formed but wrong answer passes, and the run verdict is "unverified", never "pass"`, {
          repair: { action: 'strengthen-acceptance', hint: 'Add an acceptance condition that a wrong answer can fail (for example eq {"$ref":"nodes.<verify>.pass"} true, or an invariant on the answer such as a count, a total or an id set), or keep a verify node gating with an independence other than same-model, or declare {"oracle":{"mode":"none","reason":"..."}} so runs are reported unverified on purpose' },
          details: { weak: a.weak, sameModelVerifiers: a.sameModel } }));
    }
    if (a.grade === 'no-oracle') {
      out.push(finding('NO_ORACLE_DECLARED', 'workflow.oracle', `The workflow declares no oracle (${a.reason}); its runs end with verdict "unverified", never "pass"`, {
        repair: { action: 'none', hint: 'Intended. Replace the declaration with a gating check as soon as an independent oracle exists.' }, details: { reason: a.reason } }));
      if (a.gates.length) out.push(finding('ORACLE_DECLARATION_REDUNDANT', 'workflow.oracle',
        'The workflow declares no oracle although its acceptance already holds a gating check; the declaration forces verdict "unverified"', {
          repair: { action: 'remove-oracle-declaration', hint: 'Delete the oracle field if the gating check is an independent oracle, or keep it if the check is only a sanity invariant' }, details: { gates: a.gates } }));
    }
    return out;
  },
  verifyGating({ assessment: { nonGatingVerifies, acceptance } }) {
    // In declared no-oracle mode a non-blocking verifier is advisory by design, so it is only a warning.
    const severity = acceptance.grade === 'no-oracle' ? 'warning' : 'error';
    return nonGatingVerifies.map(({ id, path }) => finding('VERIFY_NOT_GATING', path,
      `Verify node ${id} has gate:false and no acceptance, assert or when/until condition reads its result, so it cannot block the answer`, { node: id, severity,
        repair: { action: 'gate-verify', hint: `Remove gate:false so a failed verify stops the run, or read nodes.${id}.pass in acceptance (eq ... true), an assert node or a when condition` } }));
  },
  errorCollection({ assessment: { ungatedCollectMaps } }) {
    return ungatedCollectMaps.map(({ id, path }) => finding('ERROR_COLLECTION', path,
      `Map ${id} collects item failures (failure:"collect") but nothing gates on nodes.${id}.failed; failed items and batches are dropped silently`, { node: id,
        repair: { action: 'gate-failed-count', hint: `Add an acceptance condition or assert node on nodes.${id}.failed (for example lte nodes.${id}.failed 0), read it in a when condition that retries, or use failure:"fail_fast"` } }));
  },
  escalation({ modelNodes }) {
    const out = [];
    for (const { node, path } of modelNodes) {
      const mode = node.escalation?.onCheckFail;
      if (checksOf(node).length || (mode !== 'escalate' && mode !== 'resample')) continue;
      out.push(finding('ESCALATION_WITHOUT_CHECKS', path,
        `Node ${node.id} sets escalation.onCheckFail:"${mode}" but has no checks, so a failed check can never trigger it; only schema failures (E1) can still escalate it`, { node: node.id,
          repair: { action: 'add-checks-or-drop-escalation', hint: 'Add checks that a wrong output fails (verbatim quote in the source, id echo, consistency between fields), or remove onCheckFail/maxResamples and rely on schema escalation' },
          details: { onCheckFail: mode, maxEscalations: node.escalation.maxEscalations ?? null, maxClass: node.model?.maxClass ?? null } }));
    }
    return out;
  },
  globalRead({ workflow, modelNodes, indexOf, startClass, defaultIndex }) {
    // Root flow only: a read whose output conditions every item is a decision the whole run inherits (C0 F-haiku records).
    const nodes = workflow.nodes, maps = new Set(nodes.filter(n => n.kind === 'map').map(n => n.id));
    const refs = new Map(nodes.map(n => [n.id, nodeRefs(n)]));
    const agents = nodes.filter(n => n.kind === 'agent');
    const signatures = new Map();
    const signature = n => {
      if (!signatures.has(n.id)) signatures.set(n.id, digest({ role: n.role ?? null, returns: n.returns, inputs: (n.context?.inputs ?? []).map(i => i.ref !== undefined ? `ref:${i.ref}` : `value:${digest(i.value ?? null)}`).sort() }));
      return signatures.get(n.id);
    };
    const out = [];
    for (const read of agents) {
      if (!READ_ROLES.has(read.role)) continue;
      const consumers = nodes.filter(s => s !== read && refs.get(s.id).some(r => nodeIdOf(r) === read.id) && (s.kind === 'map' || refs.get(s.id).some(r => maps.has(nodeIdOf(r)))));
      if (!consumers.length) continue;
      const fields = evidencePaths(read.returns);
      const quoteChecked = refsOf(bindOutput(checksOf(read))).some(r => nodeIdOf(r) === '_output' && EVIDENCE.test(r.split('.').slice(2).join('.')))
        || nodes.some(n => n.kind === 'verify' && n.gate !== false && refsOf(n.subject).some(r => nodeIdOf(r) === read.id));
      const group = agents.filter(n => signature(n) === signature(read)).map(n => n.id);
      const agreement = group.length >= 2 && nodes.some(n => !group.includes(n.id) && new Set(refs.get(n.id).map(nodeIdOf).filter(id => group.includes(id))).size >= 2);
      const index = indexOf(startClass(read)), stronger = index !== null && defaultIndex !== null && index > defaultIndex;
      if ((fields.length && quoteChecked) || agreement || stronger) continue;
      const missing = ['evidence-quote', 'k-sample-agreement', 'stronger-class'];
      out.push(finding('GLOBAL_READ_UNGUARDED', `workflow.${read.id}`,
        `Node ${read.id} is one model read whose output (${consumers.map(c => c.id).join(', ')} read it) conditions every item, and it has ${fields.length ? 'an evidence field but no check that reads it' : 'no evidence-quote field'}, no k-sample agreement and no stronger class than the workflow default`, { node: read.id,
          repair: { action: 'guard-global-read', hint: 'Return a verbatim evidence quote for each decision and check it against the source, or read the same fact with two or more independent sibling nodes and compare them, or start this node on a stronger class and justify it' },
          details: { missing, evidenceFields: fields, consumers: consumers.map(c => c.id), modelNodeCount: modelNodes.length } }));
    }
    return out;
  },
  classJustification({ modelNodes, indexOf, startClass, defaultIndex, order, workflow, defaultSource }) {
    if (defaultIndex === null) return [];
    return modelNodes.flatMap(({ node, path }) => {
      const cls = startClass(node), index = indexOf(cls);
      if (index === null || index <= defaultIndex || String(node.model.justification ?? '').trim()) return [];
      return [finding('CLASS_ABOVE_DEFAULT_UNJUSTIFIED', path,
        `Node ${node.id} starts on class ${cls}, above the workflow default ${order[defaultIndex]} (${defaultSource}), and has no model.justification`, { node: node.id,
          repair: { action: 'justify-class', hint: `Add model.justification naming the cheaper-class attempt and its result (for example "${order[defaultIndex]} failed 5 of 8 probes"), or start the node on ${order[defaultIndex]} and let maxClass escalate` },
          details: { class: cls, defaultClass: order[defaultIndex], defaultSource, ...(workflow.defaultClass ? { declaredDefault: workflow.defaultClass } : {}) } })];
    });
  }
};

// Runs every rule; a rule that throws is reported, never swallowed.
export function lintWorkflow(workflow, { modelPolicy = null } = {}) {
  const findings = [];
  let ctx;
  try { ctx = buildContext(workflow, modelPolicy); }
  catch (error) {
    findings.push(finding('LINT_RULE_SKIPPED', 'workflow', `The lint could not read this workflow: ${String(error.message ?? error).slice(0, 300)}`,
      { repair: { action: 'fix-workflow', hint: 'Resolve the schema and validation errors first' }, details: { rule: 'context' } }));
    return { profile: LINT_PROFILE, ok: true, counts: { error: 0, warning: 1 }, codes: { LINT_RULE_SKIPPED: 1 }, findings, acceptance: { grade: 'unassessed', code: 'ACCEPTANCE_UNASSESSED', gates: [], weak: [] } };
  }
  for (const [name, rule] of Object.entries(rules)) {
    try { findings.push(...rule(ctx)); }
    catch (error) {
      findings.push(finding('LINT_RULE_SKIPPED', 'workflow', `Lint rule ${name} could not run: ${String(error.message ?? error).slice(0, 300)}`,
        { repair: { action: 'fix-workflow', hint: 'Resolve the validation errors first; the rule needs a well-formed workflow' }, details: { rule: name } }));
    }
  }
  const counts = { error: 0, warning: 0 }, codes = {};
  for (const f of findings) { counts[f.severity]++; codes[f.code] = (codes[f.code] ?? 0) + 1; }
  const { acceptance } = ctx.assessment;
  return { profile: LINT_PROFILE, ok: counts.error === 0, counts, codes, findings,
    acceptance: { grade: acceptance.grade, code: acceptance.code, gates: acceptance.gates, weak: acceptance.weak } };
}
