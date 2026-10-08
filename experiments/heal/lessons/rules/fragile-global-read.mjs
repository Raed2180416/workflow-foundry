// Lesson L-1 (from H-rec): FRAGILE_GLOBAL_READ and PROBE_VALUE_COVERAGE. Reference implementations over the workflow IR, in the
// finding shape of the pinned lint (src/lint.mjs). PROPOSED rules: they reach the constructor only through a new kit hash.
//
// A root-level model read of a per-entity convention table (an array of objects with an identifier string and enum fields) that
// conditions downstream items is fragile when nothing guards its enum fields. Structurally that is the lint's GLOBAL_READ_UNGUARDED
// warning; this rule adds the measurement: an error when a construction-time fragility probe shows that flipping one entry changes
// at least 5% of the answer. PROBE_VALUE_COVERAGE is the matching probe requirement: across the construction probes each enum field
// of such a read must take two values, or the construction record must list it as an untested branch.
import { refsIn, nodeRef, enumLeaves, canonical } from '../../ir.mjs';

export const CODE = 'FRAGILE_GLOBAL_READ', COVERAGE_CODE = 'PROBE_VALUE_COVERAGE';
export const SUMMARY = 'An unguarded model read of a per-entity convention table changes at least 5% of the answer when one entry flips';
const READ_ROLES = new Set(['extract', 'classify', 'judge', 'route']);

// identifier-keyed enum leaves of a node's schema: orders[].numeric_order next to orders[].system
export function conventionLeaves(returns) {
  const out = [];
  for (const [name, arr] of Object.entries(returns?.properties ?? {})) {
    if (arr.type !== 'array' || arr.items?.type !== 'object') continue;
    // the identifier names the entry (the first string property: orders[].system); every other enum / boolean is a convention
    const props = arr.items.properties ?? {}, ids = Object.entries(props).filter(([, s]) => s.type === 'string').map(([k]) => k).slice(0, 1);
    for (const [field, schema] of Object.entries(props)) if ((Array.isArray(schema.enum) || schema.type === 'boolean') && !ids.includes(field)) out.push({ array: name, field, identifier: ids[0] ?? null, domain: schema.enum ?? [true, false] });
  }
  return out;
}

export function check(workflow, { fragility = {} } = {}) {
  const out = [], maps = new Set(workflow.nodes.filter(n => n.kind === 'map').map(n => n.id));
  for (const node of workflow.nodes) {
    if (node.kind !== 'agent' || !READ_ROLES.has(node.role)) continue;
    const leaves = conventionLeaves(node.returns);
    if (!leaves.length) continue;
    const consumers = workflow.nodes.filter(n => n !== node && [...refsIn(n.args ?? {}), ...refsIn(n.items ?? {}), ...(n.context?.inputs ?? []).map(i => i.ref)].some(r => nodeRef(r)?.id === node.id));
    if (!consumers.length) continue;
    const guarded = (node.checks ?? []).length > 0 || workflow.nodes.some(n => n !== node && n.kind === 'agent' && n.role === node.role && canonical(n.returns) === canonical(node.returns));
    if (guarded) continue;
    const measured = fragility[node.id], fragile = typeof measured === 'number' && measured >= 0.05;
    out.push({ code: CODE, severity: fragile ? 'error' : 'warning', path: `workflow.${node.id}`, node: node.id,
      message: `Node ${node.id} reads ${leaves.map(l => `${l.array}[].${l.field}`).join(', ')} once for the whole run and nothing guards it${typeof measured === 'number' ? `; flipping one entry changes ${(measured * 100).toFixed(1)}% of the answer` : ''}`,
      repair: { action: 'guard-global-read', hint: 'Return a verbatim evidence quote per entry and check it, or read the table twice and compare, or start on a stronger class' }, details: { leaves, measured: measured ?? null, consumers: consumers.map(c => c.id) } });
  }
  return out;
}

// Probe requirement: values each convention leaf took across the construction probes.
export function coverage(returns, probeOutputs) {
  const rows = [];
  for (const leaf of conventionLeaves(returns)) {
    const seen = new Map();
    for (const v of probeOutputs) for (const item of v?.[leaf.array] ?? []) { const key = leaf.identifier ? item[leaf.identifier] : leaf.array; (seen.get(key) ?? seen.set(key, new Set()).get(key)).add(canonical(item[leaf.field])); }
    for (const [key, values] of seen) rows.push({ entity: key, field: leaf.field, values: [...values].map(JSON.parse), domain: leaf.domain.length, covered: values.size >= 2 });
  }
  return { code: COVERAGE_CODE, probes: probeOutputs.length, rows, uncovered: rows.filter(r => !r.covered).map(r => `${r.entity}.${r.field}`) };
}
