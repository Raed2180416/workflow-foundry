// E8 adapter for the condition tracker (task #60). Analyst-side; the app tracker never imports it.
//
// - viewOfTrace(trace): trace API v1 (experiments/tracker/trace.mjs, an allowlist projection of the host journal: no truth, no oracle)
//   → the tracker's RunView. Effects are what the workflow emitted (applied) and what it proposed in refused tick outputs (refused),
//   in time order; inbound messages, effects used as triggers and the final records are sources.
// - e8Vocabulary(): every channel is a system op of SPEC-E §2 (beds/ebed/e8/systems.mjs), with its argument paths from the op's own
//   schema; every inbound source is a message type the WORLD sends (observed in a trace's inbound list, which no build controls), with
//   its payload paths; record sources are the systems' non-hidden tables. Nothing a build chooses enters the vocabulary.
// - PROBES: the 2026-10-14 probe's three hand-written properties (TRACKER-DESIGN.md §6) ported to templates; test/e8-probe.test.mjs
//   requires the same verdicts on lineages 1 and 3 and on B1-O, with B1-O failing through its refused proposals.
import { normId } from '../../app/core/tracker/checks.mjs';
import { systems } from '../../beds/ebed/e8/index.mjs';

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const byTime = (a, b) => (Date.parse(a.at ?? 0) - Date.parse(b.at ?? 0)) || (a.order - b.order);

/** Paths of a JSON schema (properties, array items as [*]), up to `depth` levels. */
export function schemaPaths(schema, prefix = '', depth = 3) {
  if (!isObj(schema) || depth < 0) return [];
  const out = [];
  if (schema.type === 'object' || schema.properties) {
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      const p = prefix ? `${prefix}.${k}` : k;
      out.push(p);
      if (sub?.type === 'array' || sub?.items) out.push(...schemaPaths(sub.items, `${p}[*]`, depth - 1));
      else if (sub?.type === 'object' || sub?.properties) out.push(...schemaPaths(sub, p, depth - 1));
    }
  }
  return out;
}
/** Paths of an observed JSON value (objects and arrays of objects), up to `depth` levels. */
function valuePaths(v, prefix, depth = 3, out = new Set()) {
  if (depth < 0) return out;
  if (Array.isArray(v)) { for (const x of v.slice(0, 20)) if (isObj(x)) valuePaths(x, `${prefix}[*]`, depth - 1, out); return out; }
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v)) { const p = `${prefix}.${k}`; out.add(p); if (isObj(x) || Array.isArray(x)) valuePaths(x, p, depth - 1, out); }
  return out;
}

const RESULT_PATHS = ['result.status', 'result.items[*].status', 'result.items[*].index', 'result.error.code', 'result.error.retryable', 'result.error.status', 'result.at'];
const EFFECT_META = ['key', 'after', 'subject', ...RESULT_PATHS];

/** The E8 vocabulary from the systems and the inbound side of practice traces (world-produced). */
export function e8Vocabulary({ traces = [] } = {}) {
  const channels = {}, sources = {};
  for (const sys of systems) for (const [op, def] of Object.entries(sys.ops)) {
    if (op === 'status') continue;
    const ch = `${sys.id}.${op}`;
    channels[ch] = { describe: `${ch}: ${def.description}`, fields: [...schemaPaths(def.args, 'args'), ...EFFECT_META] };
    sources[`effect:${ch}`] = { describe: `each ${ch} effect the workflow emitted (as a trigger)`, columns: Object.fromEntries([...channels[ch].fields].map(f => [f, {}])) };
  }
  channels['humanTask.create'] = { describe: 'a human task the workflow declared', fields: ['task.id', 'task.kind', 'task.role', 'task.subject', 'task.dueAt', 'task.form', 'subject'] };
  channels['timer.set'] = { describe: 'a timer the workflow declared', fields: ['id', 'dueAt', 'subject'] };
  const inbound = new Map();
  for (const t of traces) for (const m of t.inbound ?? []) {
    if (!inbound.has(m.type)) inbound.set(m.type, new Set(['at', 'source']));
    valuePaths(m.payload, 'payload', 3, inbound.get(m.type));
  }
  for (const [type, paths] of [...inbound].sort()) sources[`inbound:${type}`] = { describe: `each ${type} message the world delivered`, columns: Object.fromEntries([...paths].sort().map(p => [p, {}])) };
  for (const sys of systems) for (const [table, def] of Object.entries(sys.tables)) {
    if (def.hidden) continue;
    sources[`records:${sys.id}.${table}`] = { describe: `final rows of ${sys.id}.${table}`, columns: Object.fromEntries(Object.keys(def.fields.properties ?? def.fields).map(f => [f, {}])) };
  }
  return { kind: 'e8', version: 'tracker-vocab-e8/1', channels, sources };
}

const textOf = v => JSON.stringify(v ?? null);
/** Compensation pairs the platform declares (beds/ebed/e8/systems.mjs `reverses`): { 'billing.refund': 'billing.charge', ... }. */
export const REVERSES = Object.freeze(Object.fromEntries(systems.flatMap(sys => Object.entries(sys.ops).filter(([, d]) => d.reverses).map(([op, d]) => [`${sys.id}.${op}`, d.reverses]))));
/** RunView of one E8 practice run from its trace (trace API v1). */
export function viewOfTrace(trace, { id = 'run' } = {}) {
  let order = 0;
  const raw = [];
  for (const e of trace.effects ?? []) raw.push({ order: order++, id: e.id, at: e.at, channel: `${e.system}.${e.op}`, status: 'applied', subject: e.subject ?? normId(e.args?.orderId),
    fields: { args: e.args ?? null, key: e.key ?? null, after: e.after ?? null, result: e.result ?? null, subject: e.subject ?? null } });
  for (const r of trace.refused ?? []) (r.proposed ?? []).forEach((p, k) => raw.push({ order: order++, id: `${r.id}:${k}`, at: r.at, channel: `${p.system}.${p.op}`, status: 'refused',
    subject: r.subject ?? normId(p.args?.orderId), fields: { args: p.args ?? null, key: p.key ?? null, after: p.after ?? null, result: null, subject: r.subject ?? null } }));
  for (const t of trace.tasks ?? []) raw.push({ order: order++, id: `task-${t.task?.id ?? order}`, at: t.at, channel: 'humanTask.create', status: 'applied', subject: normId(t.task?.subject), fields: { task: t.task, subject: normId(t.task?.subject) } });
  for (const t of trace.timers ?? []) raw.push({ order: order++, id: `timer-${t.id}-${order}`, at: t.at, channel: 'timer.set', status: 'applied', subject: null, fields: { id: t.id, dueAt: t.dueAt, subject: null } });
  raw.sort(byTime);
  const effects = raw.map((e, i) => ({ id: e.id, seq: i + 1, at: e.at, channel: e.channel, status: e.status, subject: e.subject ?? null, fields: e.fields, text: textOf(e.fields.args ?? e.fields) }));
  const sources = {};
  for (const m of trace.inbound ?? []) (sources[`inbound:${m.type}`] ??= []).push({ id: m.id, at: m.at, subject: normId(m.payload?.orderId ?? m.payload?.orderRef ?? (typeof m.payload?.fulfilmentRef === 'string' ? m.payload.fulfilmentRef.replace(/-F\d+\s*$/i, '') : null)),
    names: [], fields: { at: m.at, source: m.source ?? null, payload: m.payload ?? null } });
  for (const e of effects) (sources[`effect:${e.channel}`] ??= []).push({ id: e.id, at: e.at, isEffect: true, subject: e.subject, names: [], fields: e.fields });
  for (const [q, rows] of Object.entries(trace.records ?? {})) sources[`records:${q}`] = rows.map((r, i) => ({ id: `${q}#${i}`, at: null, subject: normId(r.orderId), names: [], fields: r }));
  return { id, now: null, horizon: trace.horizon ?? null, sources, effects, reverses: REVERSES };
}

/** The probe's three properties (TRACKER-DESIGN.md §6, with the §6.3 string-key correction) as template checks. */
export const PROBES = Object.freeze({
  // SPEC-E line 161-162: a partial reserve is followed by a reserve of the same fulfilment that reuses only original keys, with no
  // release of that fulfilment first.
  162: { template: 'when-then', source: 'effect:inventory.reserve', filter: [{ path: 'result.status', op: 'eq', value: 'partial' }], channel: 'inventory.reserve',
    link: { item: 'args.fulfilmentId', effect: 'args.fulfilmentId', op: 'eq' }, require: [{ path: 'args.items[*].key', op: 'subsetOf', itemPath: 'args.items[*].key' }],
    within: { anchor: '@at', min: 0, max: 120 }, forbidBefore: { channel: 'inventory.release', where: [] } },
  // SPEC-E line 47: a reserve batch keys each item, the batch itself carries no key (read on what the workflow tried, refused or not).
  47: { template: 'field', channel: 'inventory.reserve', where: [], require: [{ path: 'key', op: 'absent' }, { path: 'args.items', op: 'nonEmpty' }, { path: 'args.items[*].key', op: 'nonEmpty' }] },
  // R1.1, SPEC-E line 104: within 60 min of placedAt, orders.create for that order.
  104: { template: 'when-then', source: 'inbound:order.placed', filter: [], channel: 'orders.create', link: { item: '@subject', effect: '@subject', op: 'id' },
    within: { anchor: 'payload.placedAt', min: 0, max: 60 } },
});
