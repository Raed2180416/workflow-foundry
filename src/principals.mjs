// Principals for human nodes (compromise D1; research/business-20261021/ATTACK-FABLE.md §3.1 I1; research/engine-20261021/ENGINE-BUMP.md §5).
//
// The vocabulary is OT-0's constitution (experiments/constitution/schema/constitution-v0.schema.json): roles [{id, description}] and
// principals [{id, kind: human | service | customer-class, roles: [role id]}]; a principal id ending in "*" names a class whose members
// are actors with that prefix (cust:* covers cust:42). The role matrix is the HOST's: a constitution document (or the same two lists)
// handed to the runtime, never a field of the workflow and never chosen by a model. The workflow only names roles:
//
//   human node   "principal": {"role": R, "threshold": {"amount": <number or $ref>, "above": T, "role": R2}}
//                the answering actor must hold R; when the amount is above T it must also hold R2 (delegation of authority, the
//                constitution's approval-above-threshold). An amount that cannot be read, or that untrusted data decided, counts as
//                above (fail closed: injected text cannot talk an amount under the threshold).
//   workflow     "segregation": [{"nodes": [A, B, ...]}]   the actors who answer the named human nodes of one run are pairwise distinct
//                (the constitution's sodExclude between the entering and the approving duty).
//
// Static validation (validate.mjs) checks the structure always, and with a role matrix solves the workflow satisfiability problem
// (list colouring over the segregation constraints; steps are few, so backtracking is exact): it returns a satisfying assignment as
// evidence, or names why none exists.
import { digest, FoundryError } from './data.mjs';

const KINDS = new Set(['human', 'service', 'customer-class']);
const ROLE = /^[A-Za-z][A-Za-z0-9_.:-]{0,59}$/;
const bad = message => new FoundryError('PRINCIPALS_INVALID', message);

/** A host role matrix, checked: {roles: Set, principals: [{id, kind, roles, prefix}], hash}. Extra keys (a whole constitution) are ignored. */
export function roleMatrix(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.roles) || !Array.isArray(doc.principals)) throw bad('A role matrix needs roles [] and principals [] (the OT-0 constitution shape)');
  if (doc.roles.length > 500 || doc.principals.length > 10000) throw bad('A role matrix holds at most 500 roles and 10000 principals');
  const roles = new Set();
  for (const role of doc.roles) {
    const id = typeof role === 'string' ? role : role?.id;
    if (typeof id !== 'string' || !ROLE.test(id) || roles.has(id)) throw bad(`Role ids are unique names of 1-60 characters (${JSON.stringify(id)})`);
    roles.add(id);
  }
  const seen = new Set(), principals = [];
  for (const p of doc.principals) {
    if (!p || typeof p.id !== 'string' || !p.id || p.id.length > 80 || seen.has(p.id)) throw bad(`Principal ids are unique strings of 1-80 characters (${JSON.stringify(p?.id)})`);
    if (!KINDS.has(p.kind)) throw bad(`Principal ${p.id}: kind is one of ${[...KINDS].join(', ')}`);
    if (!Array.isArray(p.roles) || p.roles.some(r => !roles.has(r))) throw bad(`Principal ${p.id}: every role must be one of the matrix's roles`);
    seen.add(p.id);
    principals.push(Object.freeze({ id: p.id, kind: p.kind, roles: Object.freeze([...new Set(p.roles)].sort()), prefix: p.id.endsWith('*') ? p.id.slice(0, -1) : null }));
  }
  const hash = digest({ roles: [...roles].sort(), principals: principals.map(({ id, kind, roles: r }) => ({ id, kind, roles: r })).sort((a, b) => (a.id < b.id ? -1 : 1)) });
  return Object.freeze({ roles, principals: Object.freeze(principals), hash });
}

/** The principal an actor id names: an exact id, else the class with the longest matching prefix. */
export function principalOf(matrix, actor) {
  if (typeof actor !== 'string' || !actor || actor.length > 200) return null;
  const exact = matrix.principals.find(p => !p.prefix && p.id === actor);
  if (exact) return exact;
  return matrix.principals.filter(p => p.prefix !== null && actor.startsWith(p.prefix) && actor.length > p.prefix.length)
    .sort((a, b) => b.prefix.length - a.prefix.length)[0] ?? null;
}

/** The roles a human node's answer needs, bound when its question is asked: {roles, threshold?: {amount, above, role, above: bool, why}}. */
export function requirementOf(principal, { amount = undefined, trusted = true } = {}) {
  const roles = [principal.role];
  if (!principal.threshold) return { roles };
  const t = principal.threshold, readable = typeof amount === 'number' && Number.isFinite(amount);
  const why = !readable ? 'amount unreadable' : !trusted ? 'amount derived from untrusted data' : amount > t.above ? 'amount above threshold' : null;
  if (why && !roles.includes(t.role)) roles.push(t.role);
  return { roles, threshold: { amount: readable ? amount : null, limit: t.above, role: t.role, applied: !!why, ...(why ? { why } : {}) } };
}

/** Human nodes anywhere in the workflow by id: Map id -> [{node, path}]. */
export function humanNodesOf(workflow) {
  const out = new Map();
  const walk = (nodes, at) => {
    for (const [i, n] of (nodes ?? []).entries()) {
      if (n.kind === 'human') out.set(n.id, [...(out.get(n.id) ?? []), { node: n, path: `${at}[${i}]` }]);
      if (n.body) walk(n.body.nodes, `${at}[${i}].body.nodes`);
    }
  };
  walk(workflow.nodes, 'nodes');
  return out;
}

/** The roles each principal-bearing human node needs at least (below any threshold) and at most (above it). */
const needsOf = node => ({ least: [node.principal.role], most: [...new Set([node.principal.role, ...(node.principal.threshold ? [node.principal.threshold.role] : [])])] });

/** Structural problems of principals and segregation rules (no role matrix needed). -> [{code, message, path}] */
export function principalProblems(workflow) {
  const problems = [], humans = humanNodesOf(workflow);
  (workflow.segregation ?? []).forEach((rule, i) => {
    for (const id of rule.nodes) {
      const found = humans.get(id) ?? [];
      if (!found.length) problems.push({ code: 'SOD_NODE', message: `Segregation rule ${rule.id ?? i} names ${id}, which is not a human node of this workflow`, path: `segregation[${i}]` });
      else if (found.length > 1) problems.push({ code: 'SOD_NODE', message: `Segregation rule ${rule.id ?? i} names ${id}, which is ${found.length} human nodes (ids must name one)`, path: `segregation[${i}]` });
      else if (!found[0].node.principal) problems.push({ code: 'SOD_NODE', message: `Segregation rule ${rule.id ?? i} names ${id}, a human node without a principal requirement: its actor is not identified, so the rule could not be enforced`, path: `segregation[${i}]` });
    }
  });
  return problems;
}

/** The workflow satisfiability problem against a role matrix. -> {problems: [{code, severity, message, path}], assignment|null}
 *  error PRINCIPAL_ROLE_UNHELD: nobody may answer a node (or its above-threshold path); error SOD_UNSATISFIABLE: no distinct actors exist even
 *  below every threshold; warning SOD_UNSATISFIABLE_ABOVE_THRESHOLD: they exist below, not above. Classes count as many distinct actors. */
export function satisfiability(workflow, matrix, { maxNodes = 40 } = {}) {
  const problems = [], humans = [...humanNodesOf(workflow)].filter(([, found]) => found.length === 1 && found[0].node.principal).map(([id, [{ node, path }]]) => ({ id, node, path }));
  const holders = roles => matrix.principals.filter(p => roles.every(r => p.roles.includes(r)));
  for (const h of humans) {
    const { least, most } = needsOf(h.node);
    if (!holders(least).length) problems.push({ code: 'PRINCIPAL_ROLE_UNHELD', severity: 'error', message: `No principal in the role matrix holds ${least.join(' + ')}, so nobody may answer ${h.id}`, path: h.path });
    else if (!holders(most).length) problems.push({ code: 'PRINCIPAL_ROLE_UNHELD', severity: 'error', message: `No principal holds ${most.join(' + ')}, so ${h.id} can never be answered above its threshold`, path: h.path });
  }
  const rules = (workflow.segregation ?? []).map(rule => rule.nodes.filter(id => humans.some(h => h.id === id)));
  const constrained = humans.filter(h => rules.some(nodes => nodes.includes(h.id)));
  if (constrained.length > maxNodes) return { problems: [...problems, { code: 'SOD_NOT_CHECKED', severity: 'warning', message: `${constrained.length} human nodes take part in segregation rules; satisfiability is checked up to ${maxNodes}`, path: 'segregation' }], assignment: null };
  const conflicts = (a, b) => rules.some(nodes => nodes.includes(a) && nodes.includes(b));
  const solve = level => {
    const options = constrained.map(h => ({ id: h.id, candidates: holders(needsOf(h.node)[level]) })).sort((a, b) => a.candidates.length - b.candidates.length);
    const chosen = new Map();
    const place = k => {
      if (k === options.length) return true;
      const { id, candidates } = options[k];
      for (const p of candidates) {
        // A class supplies as many distinct actors as needed; an individual is one actor.
        if (!p.prefix && [...chosen].some(([other, q]) => q.id === p.id && conflicts(id, other))) continue;
        chosen.set(id, p);
        if (place(k + 1)) return true;
        chosen.delete(id);
      }
      return false;
    };
    return place(0) ? Object.fromEntries([...chosen].map(([id, p]) => [id, p.id])) : null;
  };
  const least = rules.length ? solve('least') : {}, most = rules.length && least ? solve('most') : least;
  if (rules.length && !least) problems.push({ code: 'SOD_UNSATISFIABLE', severity: 'error', message: `No assignment of distinct principals satisfies the segregation rules (${(workflow.segregation ?? []).map((r, i) => r.id ?? i).join(', ')}) with the roles the nodes need: the run could never be completed by the people in the role matrix`, path: 'segregation' });
  else if (rules.length && !most) problems.push({ code: 'SOD_UNSATISFIABLE_ABOVE_THRESHOLD', severity: 'warning', message: 'The segregation rules can be met below every threshold but not above one: an above-threshold case could never be completed', path: 'segregation' });
  return { problems, assignment: least ?? null };
}
