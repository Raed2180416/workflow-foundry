// What can a workflow's acceptance establish? (ROADMAP-AMENDMENTS R-15, R-17; review synthesis W6.)
//
// Static, structural and conservative. It decides whether a run that SUCCEEDED may be called a `pass`:
// only if something that a well-formed but wrong answer can fail gates the run. It cannot judge how good
// a predicate is, only that it is not a presence test. The lint (lint.mjs) and the run verdict (verdict.mjs)
// both read this module, so the validator and the verdict never disagree.
//
// Vocabulary
//   presence predicate   `exists X`, `ne X null|""|[]|{}`, `gt X.length 0`, a comparison of a value with itself:
//                        satisfied by any answer that merely exists (`exists nodes.check.pass` is satisfied by
//                        pass:false, because the key is there).
//   strong leaf          a comparison that touches what nodes produced (`nodes.*`, a loop's `previous`) and is not a
//                        presence predicate; polarity aware (`not exists X` is strong, `any` is only as strong as its
//                        weakest branch). A comparison of the input or of constants alone says nothing about the answer,
//                        and a leaf that a reference's `default` satisfies when the value is missing is a presence test.
//   gate                 a strong acceptance predicate, a strong `assert` node, or a gating verify node that is
//                        not labelled same-model and whose subject (a node's output) the acceptance depends on.
//                        An assert or verify gate vouches only if it ran: the verdict checks that (verdict.mjs).
import { canonical, condition as evaluate, references } from './data.mjs';

export const ACCEPTANCE_GRADES = Object.freeze(['gating', 'existence-only', 'no-oracle', 'unassessed']);
const COMPARISONS = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']);
const isRef = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, '$ref');
// A malformed reference is the base validator's error to report. Here it reads as "no data", which can only
// make a predicate weaker, never stronger.
const refsOf = value => { try { return references(value ?? null); } catch { return []; } };
const unique = list => [...new Set(list)];
const nodeIdOf = ref => { const [root, id] = String(ref).split('.'); return root === 'nodes' ? id ?? null : null; };
const emptyLiteral = value => value === null || value === '' || (Array.isArray(value) && value.length === 0)
  || (value !== null && typeof value === 'object' && !Array.isArray(value) && !isRef(value) && Object.keys(value).length === 0);
const lastSegment = side => String(side.$ref).split('.').pop();
const sizeRef = side => isRef(side) && ['length', 'count'].includes(lastSegment(side));
// A collected map's failed count is never negative, so `gte X.failed 0` holds for every run.
const failedRef = side => isRef(side) && lastSegment(side) === 'failed';
// Only what nodes produced can make a wrong answer fail a check: the input, the item and constants are the same for a right answer.
const dataRef = ref => ['nodes', 'previous'].includes(String(ref).split('.')[0]);
const touchesData = value => refsOf(value).some(dataRef);
// A reference's `default` is the value used when the referenced value is missing, so it plays no part in "is this the same value".
const withoutDefaults = value => Array.isArray(value) ? value.map(withoutDefaults)
  : value && typeof value === 'object' ? (isRef(value) ? { $ref: value.$ref } : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withoutDefaults(v)]))) : value;
const MISSING = Symbol('missing');
// The value a side takes when every referenced value is missing: its defaults, or MISSING when a reference has none (the
// condition then throws MISSING_REFERENCE and the run fails, so absence cannot satisfy it).
const absentValue = value => {
  if (Array.isArray(value)) { const out = value.map(absentValue); return out.includes(MISSING) ? MISSING : out; }
  if (value && typeof value === 'object') {
    if (isRef(value)) return Object.hasOwn(value, 'default') ? value.default : MISSING;
    const out = Object.entries(value).map(([k, v]) => [k, absentValue(v)]);
    return out.some(([, v]) => v === MISSING) ? MISSING : Object.fromEntries(out);
  }
  return value;
};
// Would the comparison (with this polarity) hold when nothing referenced it exists, through reference defaults alone?
function satisfiedByAbsence({ op, left, right }, negated) {
  const [l, r] = [absentValue(left), absentValue(right)];
  if (l === MISSING || r === MISSING) return false;
  try { return evaluate({ op, left: l, right: r }, {}) !== negated; } catch { return false; }
}

// `ne X null`, `gt X.length 0`, `gte X.count 1`, `contains X ""`, `gte X.failed 0` and their mirror images ask only whether
// something is there (or hold for every run).
function presenceShaped({ op, left, right }) {
  const leftRefs = refsOf(left).length > 0, rightRefs = refsOf(right).length > 0;
  const num = value => typeof value === 'number';
  if (op === 'ne') return (leftRefs && !rightRefs && emptyLiteral(right)) || (rightRefs && !leftRefs && emptyLiteral(left));
  if (op === 'contains') return leftRefs && right === '';
  if (op === 'gt') return num(right) && ((sizeRef(left) && right <= 0) || (failedRef(left) && right < 0));
  if (op === 'gte') return num(right) && ((sizeRef(left) && right <= 1) || (failedRef(left) && right <= 0));
  if (op === 'lt') return num(left) && ((sizeRef(right) && left <= 0) || (failedRef(right) && left < 0));
  if (op === 'lte') return num(left) && ((sizeRef(right) && left <= 1) || (failedRef(right) && left <= 0));
  return false;
}

// The leaves of a condition that make it hard to satisfy, each with the polarity it is read under. [] means the condition as a
// whole is a presence test.
export function strongEntries(condition, negated = false) {
  if (!condition || typeof condition !== 'object') return [];
  const children = Array.isArray(condition.conditions) ? condition.conditions : [];
  const allStrong = polarity => children.length > 0 && children.every(child => strongEntries(child, polarity).length > 0);
  switch (condition.op) {
    // not(all(a, b)) = any(not a, not b): every branch must be strong. not(any(a, b)) = all(not a, not b): one suffices.
    case 'all': return negated ? (allStrong(true) ? children.flatMap(child => strongEntries(child, true)) : []) : children.flatMap(child => strongEntries(child, false));
    case 'any': return negated ? children.flatMap(child => strongEntries(child, true)) : (allStrong(false) ? children.flatMap(child => strongEntries(child, false)) : []);
    case 'not': return strongEntries(condition.condition, !negated);
    case 'exists': return negated && touchesData(condition.value) ? [{ leaf: condition, negated }] : [];
    default: {
      if (!COMPARISONS.has(condition.op) || !touchesData([condition.left, condition.right])) return [];
      try { if (canonical(withoutDefaults(condition.left)) === canonical(withoutDefaults(condition.right))) return []; } catch { return []; }
      if (satisfiedByAbsence(condition, negated)) return [];
      if (presenceShaped(condition)) return negated ? [{ leaf: condition, negated }] : [];
      return [{ leaf: condition, negated }];
    }
  }
}
export const strongLeaves = (condition, negated = false) => strongEntries(condition, negated).map(entry => entry.leaf);
export const isStrong = condition => strongLeaves(condition).length > 0;
const leafRefs = leaves => unique(leaves.flatMap(leaf => refsOf(leaf)));
const describeLeaf = leaf => `${leaf.op} ${[leaf.value, leaf.left, leaf.right].filter(v => v !== undefined).map(v => isRef(v) ? v.$ref : JSON.stringify(v)).join(' ')}`;
// Every leaf of a condition tree, strong or not, for explaining what an existence-only acceptance consists of.
const allLeaves = condition => !condition || typeof condition !== 'object' ? []
  : Array.isArray(condition.conditions) ? condition.conditions.flatMap(allLeaves) : condition.condition ? allLeaves(condition.condition) : [condition];

// Every flow of a workflow with its path (the validator's path syntax) and, for a loop body, the loop's `until`.
export function* flowsOf(workflow) {
  const walk = function* (flow, path, until) {
    yield { flow, path, until };
    for (const node of flow.nodes ?? []) if (node.body) yield* walk(node.body, `${path}.${node.id}.body`, node.until ?? null);
  };
  yield* walk(workflow, 'workflow', null);
}

const ancestorsOf = (nodes, seeds) => {
  const byId = new Map(nodes.map(n => [n.id, n])), seen = new Set(), pending = [...seeds];
  while (pending.length) { const id = pending.pop(); if (seen.has(id)) continue; seen.add(id); pending.push(...(byId.get(id)?.needs ?? [])); }
  return seen;
};

// Which references does a flow use as a gate or as control? `via` says how, because a verify node must be read
// through its pass flag while a map's failed count may also be read by a gating verifier. Conditions count only through
// their strong leaves (`when: exists nodes.V.pass` routes nothing: it holds whatever V said); `leaf` and `negated` are kept
// so a bound on a failed count can be checked against the map's size.
export function gatedRefs(flow, { until = null } = {}) {
  const found = [];
  const add = (entries, via, node = null) => {
    for (const { leaf, negated } of entries) for (const ref of unique(refsOf(leaf))) found.push({ ref, via, leaf, negated, ...(node ? { node } : {}) });
  };
  add(flow.acceptance?.flatMap(c => strongEntries(c)) ?? [], 'acceptance');
  if (until) add(strongEntries(until), 'until');
  for (const node of flow.nodes ?? []) {
    if (node.when) add(strongEntries(node.when), 'when', node.id);
    if (node.kind === 'assert') add((node.checks ?? []).flatMap(c => strongEntries(c)), 'assert', node.id);
    if (node.kind === 'verify' && node.gate !== false) for (const ref of refsOf([node.subject, node.args])) found.push({ ref, via: 'verify', node: node.id });
  }
  return found;
}
// A verify node's outcome is consumed when a gate or a control condition reads it.
export const verifyConsumed = (gated, id) => gated.some(g => nodeIdOf(g.ref) === id && g.node !== id);
// A node's handled error (onError:"continue") is consumed the same way: something that can fail reads its outcome.
export const continuationGated = verifyConsumed;
const FLIP = { lt: 'gt', lte: 'gte', gt: 'lt', gte: 'lte', eq: 'eq', ne: 'ne' };
const NEGATE = { lt: 'gte', lte: 'gt', gt: 'lte', gte: 'lt', eq: 'ne', ne: 'eq' };
// Does a condition on `nodes.M.failed` hold for every possible failed count 0..maxItems (`lte failed 1000` on a map of 10)?
function vacuousFailedBound({ leaf, negated }, ref, maxItems) {
  let op = leaf.op, bound;
  if (isRef(leaf.left) && leaf.left.$ref === ref && typeof leaf.right === 'number') bound = leaf.right;
  else if (isRef(leaf.right) && leaf.right.$ref === ref && typeof leaf.left === 'number') { bound = leaf.left; op = FLIP[op]; }
  else return false;
  if (negated) op = NEGATE[op];
  if (!op) return false;
  const top = Number.isInteger(maxItems) && maxItems >= 0 ? Math.min(maxItems, 1000) : 1000;
  const holds = { lt: f => f < bound, lte: f => f <= bound, gt: f => f > bound, gte: f => f >= bound, eq: f => f === bound, ne: f => f !== bound }[op];
  for (let f = 0; f <= top; f++) if (!holds(f)) return false;
  return true;
}
// A collected failed count is consumed when a gate or control reads `.failed` with a bound some run can break, or a gating
// verifier reads the map.
export const failuresGated = (gated, node) => {
  const id = typeof node === 'string' ? node : node?.id, ref = `nodes.${id}.failed`;
  return gated.some(g => nodeIdOf(g.ref) === id && (g.via === 'verify' || (g.ref === ref && !(g.leaf && vacuousFailedBound(g, ref, node?.maxItems)))));
};

// Can this node be skipped while the run still succeeds: it has a `when`, or something it needs (transitively) has a `when` or
// continues on error (all_success then skips it)? The run verdict checks that a gate actually ran; the lint warns ahead of time.
// Nodes whose output is the same for every run: an assert ({passed:true} once it ran; a failed one stops the run) and a wait.
// Reading them cannot fail a wrong answer. (A code node whose arguments read nothing is constant too, but the lint does not try
// to prove that: see docs/LINT.md, known gaps.)
const constantNodes = nodes => new Set(nodes.filter(node => node.kind === 'assert' || node.kind === 'wait').map(node => node.id));
const readsVarying = (leaf, constant) => refsOf(leaf).some(ref => String(ref).startsWith('previous') || (nodeIdOf(ref) !== null && !constant.has(nodeIdOf(ref))));

const conditionalIn = nodes => {
  const byId = new Map(nodes.map(n => [n.id, n]));
  return node => Boolean(node.when) || [...ancestorsOf(nodes, node.needs ?? [])].some(id => { const n = byId.get(id); return Boolean(n?.when) || n?.onError === 'continue'; });
};

export function gradeAcceptance(workflow) {
  if (!workflow || !Array.isArray(workflow.acceptance) || !workflow.acceptance.length) {
    return { grade: 'unassessed', code: 'ACCEPTANCE_UNASSESSED', reason: 'The acceptance contract was not supplied, so nothing can be said about what it establishes', gates: [], weak: [] };
  }
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const gates = [], sameModel = [], conditional = conditionalIn(nodes), constant = constantNodes(nodes);
  const predicates = workflow.acceptance.flatMap(c => strongLeaves(c)).filter(leaf => readsVarying(leaf, constant));
  if (predicates.length) gates.push({ type: 'acceptance-predicate', refs: leafRefs(predicates) });
  for (const node of nodes) if (node.kind === 'assert') {
    const leaves = (node.checks ?? []).flatMap(c => strongLeaves(c)).filter(leaf => readsVarying(leaf, constant));
    if (leaves.length) gates.push({ type: 'assert', node: node.id, refs: leafRefs(leaves), ...(conditional(node) ? { conditional: true } : {}) });
  }
  // A gating verify stops the run when it fails; it vouches for the answer only if the acceptance depends on what it checked,
  // and only if what it checked is something a node produced (a verify of the input or of a constant vouches for nothing).
  const accepted = unique(refsOf(workflow.acceptance).map(nodeIdOf).filter(Boolean));
  const upstream = ancestorsOf(nodes, accepted);
  const vouch = (node, label, isConditional) => {
    if (node.independence === 'same-model') sameModel.push(label);
    else gates.push({ type: 'verify', node: label, independence: node.independence, ...(isConditional ? { conditional: true } : {}) });
  };
  for (const node of nodes) {
    if (node.kind !== 'verify' || node.gate === false) continue;
    const subjects = unique(refsOf(node.subject).map(nodeIdOf).filter(Boolean));
    if (!subjects.some(id => !constant.has(id)) || !(upstream.has(node.id) || subjects.some(id => upstream.has(id)))) continue;
    vouch(node, node.id, conditional(node));
  }
  // A verify inside a body that the answer depends on gates every item, unless an enclosing map collects its failures (they are then
  // only as good as the gate on the failed count, which the lint reads separately).
  const nested = (flow, collecting, trail, outerConditional) => {
    const flowNodes = Array.isArray(flow.nodes) ? flow.nodes : [], inner = conditionalIn(flowNodes);
    for (const node of flowNodes) {
      const isConditional = outerConditional || inner(node);
      if (node.kind === 'verify' && node.gate !== false && !collecting && touchesData(node.subject)) vouch(node, `${trail}.${node.id}`, isConditional);
      if (node.body) nested(node.body, collecting || (node.kind === 'map' && node.failure === 'collect'), `${trail}.${node.id}`, isConditional);
    }
  };
  for (const node of nodes) if (node.body && upstream.has(node.id)) nested(node.body, node.kind === 'map' && node.failure === 'collect', node.id, conditional(node));
  const weak = workflow.acceptance.flatMap(allLeaves).filter(leaf => !predicates.includes(leaf)).map(describeLeaf);
  if (workflow.oracle?.mode === 'none') {
    return { grade: 'no-oracle', code: 'NO_ORACLE_DECLARED', reason: String(workflow.oracle.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 240), gates, weak, sameModel };
  }
  return gates.length
    ? { grade: 'gating', code: null, reason: 'Acceptance holds a check that a wrong answer can fail', gates, weak, sameModel }
    : { grade: 'existence-only', code: 'ACCEPTANCE_EXISTENCE_ONLY', reason: 'Acceptance only checks that an answer exists', gates, weak, sameModel };
}

// Everything the lint and the verdict need to know about one workflow, computed once. Total: a workflow too malformed to analyse is
// `unassessed`, which can never be a pass, so sealing a run can neither throw nor certify what it could not read.
export function assessWorkflow(workflow) {
  try { return analyse(workflow); }
  catch (error) {
    return { acceptance: { grade: 'unassessed', code: 'ACCEPTANCE_UNASSESSED', reason: `The workflow could not be analysed (${String(error.message ?? error).slice(0, 120)})`, gates: [], weak: [] },
      ungatedCollectMaps: [], nonGatingVerifies: [], ungatedContinuations: [] };
  }
}
function analyse(workflow) {
  const acceptance = gradeAcceptance(workflow), ungatedCollectMaps = [], nonGatingVerifies = [], ungatedContinuations = [];
  if (workflow && Array.isArray(workflow.nodes)) {
    for (const { flow, path, until } of flowsOf(workflow)) {
      const gated = gatedRefs(flow, { until });
      for (const node of flow.nodes) {
        if (node.kind === 'map' && node.failure === 'collect' && !failuresGated(gated, node)) ungatedCollectMaps.push({ id: node.id, path: `${path}.${node.id}` });
        // In a discovery workflow a non-gating verify is the confirmer: its pass creates a finding and its failure is "not reproduced".
        if (node.kind === 'verify' && node.gate === false && workflow.discovery !== true && !verifyConsumed(gated, node.id)) nonGatingVerifies.push({ id: node.id, path: `${path}.${node.id}` });
        // onError:"continue" turns a failure into an {ok:false,error} output (state handled_error) that the flow may then accept.
        if (node.onError === 'continue' && ['task', 'agent'].includes(node.kind) && !continuationGated(gated, node.id)) ungatedContinuations.push({ id: node.id, path: `${path}.${node.id}` });
      }
    }
  }
  return { acceptance, ungatedCollectMaps, nonGatingVerifies, ungatedContinuations };
}
