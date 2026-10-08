// Router v0 (THESIS-JIT §2.6): for each incoming task, decide whether to interpret it with an agent, run a compiled solver,
// or compile one now. The router is the compile decision. The owner's cost/reliability slider sets how much evidence a
// compile needs and how often compiled answers are shadowed by the interpreter.
//
// It is pure: callers pass the per-shape statistics they keep (stream.mjs keeps them per arm), and the router returns a
// decision with its reason. No model calls.
import { createHash } from 'node:crypto';

const canonical = v => v === null || typeof v !== 'object' ? JSON.stringify(v) ?? 'null'
  : Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
const sha = s => createHash('sha256').update(s).digest('hex');

// The shape of a task: what a compiled solver could plausibly be reused for. That is the output schema, the structure of
// the inputs (key paths and value types, not values) and the prompt with its variable parts masked (numbers, quoted text,
// long tokens). Two tasks of one recurring family share a shape; a new family gets a new one.
export function shapeKey(task, outputSchema) {
  const skeleton = (v, depth = 0) => {
    if (depth > 4) return typeof v;
    if (Array.isArray(v)) return v.length ? [skeleton(v[0], depth + 1)] : [];
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, skeleton(v[k], depth + 1)]));
    return typeof v;
  };
  const prompt = String(task?.prompt ?? '').replace(/"[^"\n]{0,200}"|'[^'\n]{0,200}'/g, 'Q').replace(/\d+([.,]\d+)*/g, 'N').replace(/\b\w{25,}\b/g, 'T').slice(0, 4000);
  return sha(canonical({ schema: outputSchema ?? null, inputs: skeleton(task?.inputs ?? {}), files: Object.keys(task?.files ?? {}).length > 0, prompt })).slice(0, 16);
}

// slider: 0 = cheapest, 1 = most reliable.
export const sliderParams = slider => {
  const s = Math.min(1, Math.max(0, Number(slider)));
  return {
    warmup: Math.round(2 + 3 * s),             // traces before the first compile: 2..5
    payback: 1 + 2 * s,                        // compile only if expected savings ≥ payback × compile cost
    shadowBase: 0.05 + 0.45 * s,               // share of compiled runs shadowed by the interpreter: 5%..50%
    shadowGain: 2 + 4 * s,                     // extra shadowing per unit of observed disagreement
    maxDeoptRate: 0.5 - 0.3 * s,               // above this the compiled version is benched (interpret until recompiled)
  };
};

// Deterministic, reproducible sampling of a task for shadowing.
export const sampled = (taskId, p) => p >= 1 || (p > 0 && parseInt(sha(String(taskId)).slice(0, 8), 16) / 0xffffffff < p);

/**
 * stats (per shape): { seen, traces, agentCostMean, compileCostMean, compiledCostMean,
 *   compiled: null | { version, accepted, runs, deopts, shadows, disagreements, wrong } }
 * expectedRemaining: how many more tasks of this shape are expected (from the arrival history or the caller).
 */
export function decide({ taskId, stats, slider = 0.5, expectedRemaining = 0, defaults = { compileCostUsd: 3, compiledCostUsd: 0.05 } }) {
  const P = sliderParams(slider), s = stats ?? { seen: 0, traces: 0 };
  const agentCost = s.agentCostMean ?? null, compileCost = s.compileCostMean ?? defaults.compileCostUsd, compiledCost = s.compiledCostMean ?? defaults.compiledCostUsd;
  const c = s.compiled;
  if (c && c.accepted) {
    const runs = Math.max(1, c.runs ?? 0), deoptRate = (c.deopts ?? 0) / runs, disagreeRate = (c.shadows ? (c.disagreements ?? 0) / c.shadows : 0);
    if ((c.runs ?? 0) >= 4 && deoptRate > P.maxDeoptRate) return { action: 'interpret', recompile: true, reason: `compiled v${c.version} deopts ${(100 * deoptRate).toFixed(0)}% > ${(100 * P.maxDeoptRate).toFixed(0)}%: benched until recompiled` };
    const p = Math.min(1, P.shadowBase + P.shadowGain * disagreeRate);
    return { action: 'run-compiled', shadow: sampled(taskId, p), shadowP: p, reason: `compiled v${c.version}; shadow p=${p.toFixed(2)} (disagree ${(100 * disagreeRate).toFixed(0)}%)` };
  }
  if ((s.traces ?? 0) < P.warmup) return { action: 'interpret', reason: `warming up: ${s.traces ?? 0}/${P.warmup} traces` };
  if (agentCost == null) return { action: 'interpret', reason: 'no agent cost observed yet' };
  const savings = expectedRemaining * (agentCost - compiledCost);
  if (savings < P.payback * compileCost) {
    return { action: 'interpret', reason: `compile not worth it: ${expectedRemaining} expected × ($${agentCost.toFixed(3)} − $${compiledCost.toFixed(3)}) = $${savings.toFixed(2)} < ${P.payback.toFixed(1)} × $${compileCost.toFixed(2)}` };
  }
  return { action: 'compile', reason: `expected savings $${savings.toFixed(2)} ≥ ${P.payback.toFixed(1)} × compile $${compileCost.toFixed(2)}` };
}

// Expected remaining recurrences from the arrival history alone: the shape's share of recent tasks times the expected
// horizon, so a shape seen once in a long history is not compiled for.
export function expectedRemaining({ shapeCount, totalCount, horizon }) {
  if (!totalCount) return 0;
  return Math.round((shapeCount / totalCount) * horizon);
}
