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
//   strong leaf          a comparison that touches runtime data and is not a presence predicate; polarity aware
//                        (`not exists X` is strong, `any` is only as strong as its weakest branch).
//   gate                 a strong acceptance predicate, a strong `assert` node, or a gating verify node that is
//                        not labelled same-model and whose subject the acceptance depends on.
import { canonical, references } from './data.mjs';

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
const sizeRef = side => isRef(side) && ['length', 'count'].includes(String(side.$ref).split('.').pop());

// `ne X null`, `gt X.length 0`, `gte X.count 1` and their mirror images ask only whether something is there.
function presenceShaped({ op, left, right }) {
  const leftRefs = refsOf(left).length > 0, rightRefs = refsOf(right).length > 0;
  if (op === 'ne') return (leftRefs && !rightRefs && emptyLiteral(right)) || (rightRefs && !leftRefs && emptyLiteral(left));
  if (op === 'gt') return sizeRef(left) && typeof right === 'number' && right <= 0;
  if (op === 'gte') return sizeRef(left) && typeof right === 'number' && right <= 1;
  if (op === 'lt') return sizeRef(right) && typeof left === 'number' && left <= 0;
  if (op === 'lte') return sizeRef(right) && typeof left === 'number' && left <= 1;
  return false;
}

// The leaves of a condition that make it hard to satisfy. [] means the condition as a whole is a presence test.
export function strongLeaves(condition, negated = false) {
  if (!condition || typeof condition !== 'object') return [];
  const children = Array.isArray(condition.conditions) ? condition.conditions : [];
  const allStrong = polarity => children.length > 0 && children.every(child => strongLeaves(child, polarity).length > 0);
  switch (condition.op) {
    // not(all(a, b)) = any(not a, not b): every branch must be strong. not(any(a, b)) = all(not a, not b): one suffices.
    case 'all': return negated ? (allStrong(true) ? children.flatMap(child => strongLeaves(child, true)) : []) : children.flatMap(child => strongLeaves(child, false));
    case 'any': return negated ? children.flatMap(child => strongLeaves(child, true)) : (allStrong(false) ? children.flatMap(child => strongLeaves(child, false)) : []);
    case 'not': return strongLeaves(condition.condition, !negated);
    case 'exists': return negated && refsOf(condition.value).length ? [condition] : [];
    default: {
      if (!COMPARISONS.has(condition.op) || !refsOf([condition.left, condition.right]).length) return [];
      try { if (canonical(condition.left) === canonical(condition.right)) return []; } catch { return []; }
      if (presenceShaped(condition)) return negated ? [condition] : [];
      return [condition];
    }
  }
}
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
// through its pass flag while a map's failed count may also be read by a gating verifier.
export function gatedRefs(flow, { until = null } = {}) {
  const found = [];
  const add = (refs, via, node = null) => { for (const ref of refs) found.push({ ref, via, ...(node ? { node } : {}) }); };
  add(leafRefs(flow.acceptance?.flatMap(c => strongLeaves(c)) ?? []), 'acceptance');
  if (until) add(refsOf(until), 'until');
  for (const node of flow.nodes ?? []) {
    if (node.when) add(refsOf(node.when), 'when', node.id);
    if (node.kind === 'assert') add(leafRefs((node.checks ?? []).flatMap(c => strongLeaves(c))), 'assert', node.id);
    if (node.kind === 'verify' && node.gate !== false) add(refsOf([node.subject, node.args]), 'verify', node.id);
  }
  return found;
}
// A verify node's outcome is consumed when a gate or a control condition reads it.
export const verifyConsumed = (gated, id) => gated.some(g => nodeIdOf(g.ref) === id && g.node !== id);
// A collected failed count is consumed when a gate or control reads `.failed`, or a gating verifier reads the map.
export const failuresGated = (gated, id) => gated.some(g => nodeIdOf(g.ref) === id && (g.via === 'verify' || g.ref.split('.')[2] === 'failed'));

export function gradeAcceptance(workflow) {
  if (!workflow || !Array.isArray(workflow.acceptance) || !workflow.acceptance.length) {
    return { grade: 'unassessed', code: 'ACCEPTANCE_UNASSESSED', reason: 'The acceptance contract was not supplied, so nothing can be said about what it establishes', gates: [], weak: [] };
  }
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const gates = [], sameModel = [];
  const predicates = workflow.acceptance.flatMap(c => strongLeaves(c));
  if (predicates.length) gates.push({ type: 'acceptance-predicate', refs: leafRefs(predicates) });
  for (const node of nodes) if (node.kind === 'assert') {
    const leaves = (node.checks ?? []).flatMap(c => strongLeaves(c));
    if (leaves.length) gates.push({ type: 'assert', node: node.id, refs: leafRefs(leaves) });
  }
  // A gating verify stops the run when it fails; it vouches for the answer only if the acceptance depends on what it checked.
  const accepted = unique(refsOf(workflow.acceptance).map(nodeIdOf).filter(Boolean));
  const upstream = ancestorsOf(nodes, accepted);
  const vouch = (node, label) => {
    if (node.independence === 'same-model') sameModel.push(label);
    else gates.push({ type: 'verify', node: label, independence: node.independence });
  };
  for (const node of nodes) {
    if (node.kind !== 'verify' || node.gate === false) continue;
    const subjects = unique(refsOf(node.subject).map(nodeIdOf).filter(Boolean));
    if (!refsOf(node.subject).length || !(upstream.has(node.id) || subjects.some(id => upstream.has(id)))) continue;
    vouch(node, node.id);
  }
  // A verify inside a body that the answer depends on gates every item, unless an enclosing map collects its failures (they are then
  // only as good as the gate on the failed count, which the lint reads separately).
  const nested = (flow, collecting, trail) => {
    for (const node of flow.nodes ?? []) {
      if (node.kind === 'verify' && node.gate !== false && !collecting && refsOf(node.subject).length) vouch(node, `${trail}.${node.id}`);
      if (node.body) nested(node.body, collecting || (node.kind === 'map' && node.failure === 'collect'), `${trail}.${node.id}`);
    }
  };
  for (const node of nodes) if (node.body && upstream.has(node.id)) nested(node.body, node.kind === 'map' && node.failure === 'collect', node.id);
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
    return { acceptance: { grade: 'unassessed', code: 'ACCEPTANCE_UNASSESSED', reason: `The workflow could not be analysed (${String(error.message ?? error).slice(0, 120)})`, gates: [], weak: [] }, ungatedCollectMaps: [], nonGatingVerifies: [] };
  }
}
function analyse(workflow) {
  const acceptance = gradeAcceptance(workflow), ungatedCollectMaps = [], nonGatingVerifies = [];
  if (workflow && Array.isArray(workflow.nodes)) {
    for (const { flow, path, until } of flowsOf(workflow)) {
      const gated = gatedRefs(flow, { until });
      for (const node of flow.nodes) {
        if (node.kind === 'map' && node.failure === 'collect' && !failuresGated(gated, node.id)) ungatedCollectMaps.push({ id: node.id, path: `${path}.${node.id}` });
        // In a discovery workflow a non-gating verify is the confirmer: its pass creates a finding and its failure is "not reproduced".
        if (node.kind === 'verify' && node.gate === false && workflow.discovery !== true && !verifyConsumed(gated, node.id)) nonGatingVerifies.push({ id: node.id, path: `${path}.${node.id}` });
      }
    }
  }
  return { acceptance, ungatedCollectMaps, nonGatingVerifies };
}
