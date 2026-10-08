// Workflow IR helpers shared by detect, localise, ops, scan and learn: pure functions over plain workflow JSON.
import { createHash } from 'node:crypto';

export const canonical = v => { const visit = x => Array.isArray(x) ? x.map(visit) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, visit(x[k])])) : x; return JSON.stringify(visit(v)); };
export const digest = v => createHash('sha256').update(canonical(v)).digest('hex');
export const clone = v => JSON.parse(JSON.stringify(v));
export const isRef = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.hasOwn(v, '$ref');
export function refsIn(value, found = []) {
  if (value && typeof value === 'object') { if (isRef(value)) found.push(value.$ref); for (const c of Object.values(value)) refsIn(c, found); }
  return found;
}
// `nodes.X.a.b` -> { id: 'X', path: ['a','b'] }; anything else -> null.
export const nodeRef = ref => { const p = String(ref).split('.'); return p[0] === 'nodes' && p[1] ? { id: p[1], path: p.slice(2) } : null; };

// A node key is `root/map:3/node`: frames separated by '/', loop/map iteration after ':'. Walk the trail to the node definition.
export function resolveNode(workflow, nodeKey) {
  const parts = String(nodeKey).split('/').slice(1);
  let flow = workflow, node = null;
  for (const part of parts) {
    const id = part.replace(/:\d+$/, '');
    node = (flow?.nodes ?? []).find(n => n.id === id) ?? null;
    if (!node) return null;
    flow = node.body;
  }
  return node;
}
export const topFrame = nodeKey => String(nodeKey).split('/')[1]?.replace(/:\d+$/, '') ?? null;
export const shapeKey = nodeKey => String(nodeKey).replace(/:\d+/g, '');

export function findNodeDeep(workflow, id, trail = []) {
  for (const n of workflow.nodes ?? []) {
    if (n.id === id) return { node: n, trail, flow: workflow };
    if (n.body) { const r = findNodeDeep(n.body, id, [...trail, n.id]); if (r) return r; }
  }
  return null;
}

export function topoOrder(workflow) {
  const byId = new Map(workflow.nodes.map(n => [n.id, n])), order = [], seen = new Set();
  const visit = id => { if (seen.has(id) || !byId.has(id)) return; seen.add(id); for (const d of byId.get(id).needs ?? []) visit(d); order.push(id); };
  for (const n of workflow.nodes) visit(n.id);
  return new Map(order.map((id, i) => [id, i]));
}
export function ancestorsOf(workflow, id) {
  const byId = new Map(workflow.nodes.map(n => [n.id, n])), out = new Set(), stack = [...(byId.get(id)?.needs ?? [])];
  while (stack.length) { const x = stack.pop(); if (out.has(x)) continue; out.add(x); stack.push(...(byId.get(x)?.needs ?? [])); }
  return out;
}

// Every refs-bearing part of a node, including context inputs and (output-bound) checks.
export function nodeRefs(node) {
  const { body, source, instructions, returns, context, checks, ...rest } = node;
  const refs = [...refsIn(rest)];
  for (const s of context?.inputs ?? []) if (typeof s.ref === 'string') refs.push(s.ref);
  if (checks) refs.push(...refsIn(checks));
  return refs;
}
// Top-level fields of node `id` that other nodes read (`nodes.id.f...`); '*' when the whole output is read.
export function downstreamFields(workflow, id) {
  const fields = new Set();
  const scan = flow => { for (const n of flow.nodes ?? []) { if (n.id !== id || flow !== workflow) for (const r of [...nodeRefs(n), ...refsIn(n.when ?? null)]) { const nr = nodeRef(r); if (nr?.id === id) fields.add(nr.path[0] ?? '*'); } if (n.body) scan(n.body); } };
  scan(workflow);
  for (const r of refsIn(workflow.acceptance ?? [])) { const nr = nodeRef(r); if (nr?.id === id) fields.add(nr.path[0] ?? '*'); }
  return fields;
}

// ---- enum / boolean leaves of a value under a schema ------------------------------------------------------------------
export function enumLeaves(schema, value, trail = [], out = []) {
  if (!schema || typeof schema !== 'object') return out;
  if (Array.isArray(schema.enum) && schema.enum.every(v => ['string', 'number', 'boolean'].includes(typeof v))) { out.push({ path: trail, domain: schema.enum, value, kind: 'enum' }); return out; }
  if (schema.type === 'boolean') { out.push({ path: trail, domain: [true, false], value, kind: 'boolean' }); return out; }
  if (schema.type === 'object' && value && typeof value === 'object') for (const [k, s] of Object.entries(schema.properties ?? {})) if (Object.hasOwn(value, k)) enumLeaves(s, value[k], [...trail, k], out);
  if (schema.type === 'array' && Array.isArray(value) && schema.items) value.forEach((v, i) => enumLeaves(schema.items, v, [...trail, i], out));
  return out;
}
export const getAt = (value, path) => path.reduce((v, k) => v?.[k], value);
export function setAt(value, path, next) {
  const out = clone(value); let cur = out;
  for (const k of path.slice(0, -1)) cur = cur[k];
  cur[path.at(-1)] = next; return out;
}
// Boolean leaves of a recorded plain value (code-node outputs have no schema): scalars only, depth <= 2, not inside arrays.
export function booleanLeaves(value, trail = [], out = []) {
  if (typeof value === 'boolean') out.push({ path: trail, value, domain: [true, false], kind: 'boolean' });
  else if (value && typeof value === 'object' && !Array.isArray(value) && trail.length < 2) for (const [k, v] of Object.entries(value)) booleanLeaves(v, [...trail, k], out);
  return out;
}

// Nodes with byte-identical definitions (same kind, language, source or instructions, schema): one defect locus (R-16 read as
// "one locus", DESIGN §7.2).
export function cloneGroups(workflow) {
  const groups = new Map();
  for (const n of workflow.nodes ?? []) {
    const sig = n.kind === 'code' || (n.kind === 'verify' && n.method === 'code') ? digest({ k: n.kind, l: n.lang, s: n.source })
      : n.kind === 'agent' ? digest({ k: n.kind, i: n.instructions, r: n.returns, m: n.model, c: n.checks ?? null }) : null;
    if (!sig) continue;
    groups.set(sig, [...(groups.get(sig) ?? []), n.id]);
  }
  return [...groups.values()].filter(g => g.length > 1);
}
export const locusOf = (workflow, id) => cloneGroups(workflow).find(g => g.includes(id)) ?? [id];

// ---- check tracing -----------------------------------------------------------------------------------------------------
// Which output fields did the checks that decided acceptance of `output` actually read? `any` is decided by its first true
// branch, `all` by every branch. A leaf that reads something other than the output (the item, an upstream node) is assumed to
// have held (the run was accepted); only leaves over the output and constants are evaluated. `deps` supplies kit.data.condition
// and kit.validate.bindOutput.
export function checkTrace(checks, output, { condition, bindOutput }) {
  const ctx = { nodes: { _output: output } };
  const bound = bindOutput(checks ?? []);
  const fieldsOf = c => refsIn(c).map(nodeRef).filter(x => x?.id === '_output').map(x => x.path.join('.'));
  const run = c => {
    if (c.op === 'all') { const rs = (c.conditions ?? []).map(run); return { value: rs.every(r => r.value), reads: new Set(rs.flatMap(r => [...r.reads])) }; }
    if (c.op === 'any') { const rs = (c.conditions ?? []).map(run), first = rs.find(r => r.value); return first ? { value: true, reads: new Set(first.reads) } : { value: false, reads: new Set(rs.flatMap(r => [...r.reads])) }; }
    if (c.op === 'not') { const r = run(c.condition); return { value: !r.value, reads: r.reads }; }
    const reads = new Set(fieldsOf(c)), outsiders = refsIn(c).filter(r => nodeRef(r)?.id !== '_output');
    if (outsiders.length) return { value: true, reads };
    try { return { value: condition(c, ctx), reads }; } catch { return { value: false, reads }; }
  };
  const results = bound.map(run);
  return { held: results.every(r => r.value), reads: new Set(results.flatMap(r => [...r.reads])) };
}
export const decisionFields = returns => Object.entries(returns?.properties ?? {}).filter(([, s]) => Array.isArray(s.enum) || s.type === 'boolean').map(([k]) => k);

// Share of answer items that differ between two answers: items are the entries of the single array property, else the whole value.
export function changedShare(a, b) {
  const items = x => { if (x && typeof x === 'object' && !Array.isArray(x)) { const arrs = Object.values(x).filter(Array.isArray); if (arrs.length === 1) return arrs[0]; } return Array.isArray(x) ? x : [x]; };
  const A = new Set(items(a).map(canonical)), B = new Set(items(b).map(canonical)); let same = 0;
  for (const k of B) if (A.has(k)) same++;
  return +(1 - same / Math.max(A.size, B.size, 1)).toFixed(4);
}
