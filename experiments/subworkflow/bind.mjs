// Binding a sub-workflow into its parent node (research/subworkflow-20261021/DESIGN.md §3): a checked spec is registered by
// content hash in the flow-v3 library registry (experiments/jit/call-host.mjs createRegistry) and called through the call
// host as an ordinary flow:call request from the node's root scope. The host enforces what it enforces for every callee:
// unknown hash, recursion, depth (maxDepth), tree size, effects ('none' only), the input and output contracts and the
// budget tree (a child's reservation strictly below what its caller has left). The child runs in process (the host's stub
// mode, its embedding path); its code steps run in src/sandbox.mjs and its model calls go through the child's scope of
// the same ModelPort, so every call is journaled and booked to the span that made it.
import { createRegistry, createCallHost } from '../jit/call-host.mjs';
import { runSpec, checkSpec, canonicalJson, EFFECT_OPS, SPEC_KIND } from './dsl.mjs';

export const ANY_JSON = { type: ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'] };

/** The stub the registry hashes: its text is the canonical spec, so the library hash is content addressed. */
function stubFor(spec, runner) {
  const fn = (input, ctx) => runner(spec, input, ctx);
  const text = `${SPEC_KIND}:${canonicalJson(spec)}`;
  Object.defineProperty(fn, 'toString', { value: () => text });
  return fn;
}
const effectsOf = spec => ((spec.steps ?? []).some(s => EFFECT_OPS.includes(s.op)) ? 'effects' : 'none');

/**
 * One node's binding context. port: the experiment's ModelPort; budgetUsd: the node's whole budget (its own calls, any
 * builder calls and every child); maxDepth: the host's depth limit. The node's own model calls go through `rootPort` so
 * they are booked on the root span; a child is carved from what the root has left.
 */
export function createNodeBinding({ port, budgetUsd, maxDepth = 2, arm = null, taskKey = null, price = { inputPerMTok: 0.1, outputPerMTok: 0.5 }, runId, inputSchema = null, outputSchema }) {
  const registry = createRegistry({ dir: null });
  const host = createCallHost({ registry, modelPort: port, mode: 'stub', maxDepth, arm, taskKey });
  const rootPort = host.port({ budgetUsd });
  const traces = new Map();   // child span path -> its step trace (the host keeps outputs, not traces)
  const runner = async (spec, input, ctx) => {
    try {
      const r = await runSpec(spec, input, { model: ctx.model, call: ctx.call, register: s => register(s, ANY_JSON).hash, budgetUsd: ctx.budgetUsd, runId,
        nodeKey: `${taskKey}.${ctx.path}`, depth: ctx.depth, price });
      traces.set(ctx.path, { ok: true, trace: r.trace, calls: r.calls });
      return { status: 'ok', output: r.output };
    } catch (e) {
      traces.set(ctx.path, { ok: false, trace: e.trace ?? [], calls: e.calls ?? 0, error: { code: e.code ?? 'ERROR', message: String(e.message).slice(0, 800) } });
      return { status: 'deopt', deopt: { kind: e.code ?? 'error', name: e.code ?? null, detail: { message: String(e.message).slice(0, 800) } } };
    }
  };
  function register(spec, output = outputSchema) {
    return registry.register({ stub: stubFor(spec, runner), contract: { input: inputSchema, output, taskTemplate: '' }, effects: effectsOf(spec),
      evidence: { kind: SPEC_KIND, name: spec.name ?? null } });
  }
  const root = () => host.spans().find(s => s.path === 'root');
  const remaining = () => { const r = root(); return Math.max(0, r.budgetUsd - r.spentUsd - r.reservedUsd); };
  return {
    host, registry, rootPort, remaining, traces,
    envelope: ({ inputs, ops, models }) => ({ inputs, ops, models, maxDepth, budgetUsd: remaining() }),
    /** Register (by hash) and call a checked spec from the root scope. Returns { value (the host's answer), hash, trace }. */
    async call(spec, input, { name = 'subworkflow' } = {}) {
      const entry = register(spec);
      const value = await host.request({ v: 1, op: 'call', callee: entry.hash, input, name, budgetUsd: spec.budgetUsd, timeoutMs: 900000 });
      return { value, hash: entry.hash, trace: value.path ? traces.get(value.path) ?? null : null };
    },
  };
}

/** The build-time smoke: run the spec on the node's real input with judgments stubbed (first label) at $0. */
export async function practiceRun(spec, input) {
  try { const r = await runSpec(spec, input, { practice: true, budgetUsd: spec.budgetUsd, runId: 'practice', nodeKey: 'practice' }); return { ok: true, output: r.output, trace: r.trace }; }
  catch (e) { return { ok: false, error: { code: e.code ?? 'ERROR', message: String(e.message).slice(0, 800) }, trace: e.trace ?? [] }; }
}

/**
 * The code-owned contract gate every sub-workflow answer passes, whoever built it: the node answer shape, the node's own
 * channel, unique references, quarantine disjoint from imports, totals equal to the imports, and every reference present
 * in the node's own export (nothing invented). Returns problems (strings).
 */
export function gateProblems(output, { channel, exportText, validate }) {
  const out = [];
  const shape = validate(output);
  if (shape) return [`the answer does not match the intake answer schema: ${shape}`];
  if (output.channel !== channel) out.push(`channel is ${JSON.stringify(output.channel)}, this node is ${JSON.stringify(channel)}`);
  const refs = output.import.map(o => o.ref), seen = new Set(), dup = refs.filter(r => (seen.has(r) ? true : (seen.add(r), false)));
  if (dup.length) out.push(`duplicate imports: ${[...new Set(dup)].slice(0, 5).join(', ')}`);
  const both = output.quarantine.filter(r => seen.has(r));
  if (both.length) out.push(`imported and quarantined: ${both.slice(0, 5).join(', ')}`);
  if (output.totals.orders !== output.import.length) out.push(`totals.orders ${output.totals.orders} but ${output.import.length} imports`);
  const sum = output.import.reduce((s, o) => s + o.usd_cents, 0);
  if (output.totals.usd_cents !== sum) out.push(`totals.usd_cents ${output.totals.usd_cents} but the imports sum to ${sum}`);
  const unknown = [...refs, ...output.quarantine].filter(r => !exportText.includes(r));
  if (unknown.length) out.push(`references not in the export: ${unknown.slice(0, 5).join(', ')}`);
  return out;
}
export { checkSpec };
