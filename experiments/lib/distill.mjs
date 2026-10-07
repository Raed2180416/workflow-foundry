// Procedure distillation, per-node assignment search (ROADMAP §2.3 steps 2-4).
//
// Input: journaled model calls from reference runs (normally a frontier assignment on dev tasks whose
// runs passed the oracle). For every agent node, the recorded request (system, prompt, schema) is
// replayed verbatim on candidate models, cheapest first, and the candidate's typed output is
// compared with the reference output. Successive halving drops candidates early; the cheapest
// candidate whose agreement stays at or above the threshold on the full sample is assigned.
// Node-level agreement is a screening signal only: the assignment must still be confirmed end to
// end against the oracle (dev, then sealed), because a node can agree on most leaves and still
// break the task.
import { DatabaseSync } from 'node:sqlite';
import { canonical } from '../../src/data.mjs';

export const nodeIdOf = nodeKey => nodeKey.replace(/:\d+(?=\/|$)/g, '');

/** Successful, non-replayed agent calls of the given runs, grouped by normalised node id. */
export function referenceCalls(journalFile, { runIds, nodes } = {}) {
  const db = new DatabaseSync(journalFile, { readOnly: true });
  try {
    const rows = db.prepare('SELECT run_id, node_key, model_id, request, response, cost_usd, imputed_usd, latency_ms FROM model_calls WHERE ok=1 ORDER BY id').all();
    const byNode = new Map();
    for (const r of rows) {
      if (runIds && !runIds.includes(r.run_id)) continue;
      const request = JSON.parse(r.request ?? 'null'), response = JSON.parse(r.response ?? 'null');
      if (!request?.prompt || request.replayOf != null || response?.replayedFrom != null) continue;
      const node = nodeIdOf(r.node_key);
      if (nodes && !nodes.includes(node)) continue;
      if (!byNode.has(node)) byNode.set(node, []);
      byNode.get(node).push({ runId: r.run_id, nodeKey: r.node_key, modelId: r.model_id, system: request.system ?? '', prompt: request.prompt, schema: request.schema,
        value: response.value, costUsd: r.cost_usd ?? 0, imputedUsd: r.imputed_usd ?? 0, latencyMs: r.latency_ms ?? 0 });
    }
    return byNode;
  } finally { db.close(); }
}

// Leaf-level agreement between two JSON values: the fraction of reference leaves (by path) that the
// candidate reproduces exactly (strings compared trimmed; numbers with a relative tolerance). Extra
// candidate leaves count against it, so padding cannot raise the score.
export function leafAgreement(reference, candidate, { relTol = 1e-9, normalize = s => s.trim() } = {}) {
  const leaves = (v, p = '$', out = new Map()) => {
    if (v !== null && typeof v === 'object') {
      const entries = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
      if (!entries.length) out.set(p, Array.isArray(v) ? '[]' : '{}');
      for (const [k, x] of entries) leaves(x, `${p}/${k}`, out);
    } else out.set(p, v);
    return out;
  };
  const ref = leaves(reference), cand = leaves(candidate);
  if (!ref.size) return canonical(reference) === canonical(candidate) ? 1 : 0;
  let hit = 0;
  for (const [p, v] of ref) {
    if (!cand.has(p)) continue;
    const c = cand.get(p);
    if (typeof v === 'number' && typeof c === 'number') hit += Math.abs(v - c) <= relTol * Math.max(1, Math.abs(v)) ? 1 : 0;
    else if (typeof v === 'string' && typeof c === 'string') hit += normalize(v) === normalize(c) ? 1 : 0;
    else hit += v === c ? 1 : 0;
  }
  const extra = [...cand.keys()].filter(p => !ref.has(p)).length;
  return hit / (ref.size + extra);
}

// Successive halving over candidates (cheapest first) for one node. `rounds` gives the cumulative sample size per
// round; a candidate survives a round when its mean agreement so far is >= threshold and it had no
// more than `maxErrorRate` failed calls. Returns per-candidate statistics and the cheapest survivor.
export async function searchNode({ node, calls, candidates, modelPort, runId, threshold = 0.98, maxErrorRate = 0.1, rounds = [4, 8, 16], decoding = { reasoning: 'none' },
  agreement = leafAgreement, log = () => {} }) {
  const stats = new Map(candidates.map(m => [m, { model: m, n: 0, agreeSum: 0, errors: 0, costUsd: 0, imputedUsd: 0, latencyMs: 0, alive: true, samples: [] }]));
  let done = 0;
  for (const target of rounds) {
    const batch = calls.slice(done, Math.min(target, calls.length));
    if (!batch.length) break;
    for (const s of stats.values()) {
      if (!s.alive) continue;
      for (const [i, c] of batch.entries()) {
        const r = await modelPort.call({ runId, nodeKey: `distill/${node}/${s.model}/${done + i}`, attempt: 0, modelId: s.model, system: c.system, prompt: c.prompt, schema: c.schema, decoding });
        s.n++; s.costUsd += r.costUsd ?? 0; s.imputedUsd += r.imputedUsd ?? 0; s.latencyMs += r.latencyMs ?? 0;
        const a = r.ok ? agreement(c.value, r.value) : 0;
        if (!r.ok) s.errors++;
        s.agreeSum += a; s.samples.push({ index: done + i, ok: !!r.ok, agreement: a, error: r.error?.code ?? null });
      }
      const mean = s.agreeSum / s.n;
      if (mean < threshold || s.errors / s.n > maxErrorRate) s.alive = false;
      log(`${node} ${s.model} n=${s.n} agreement=${mean.toFixed(4)} errors=${s.errors} ${s.alive ? 'alive' : 'dropped'}`);
    }
    done = batch.length + done;
    if (![...stats.values()].some(s => s.alive)) break;
  }
  const rows = [...stats.values()].map(s => ({ ...s, agreement: s.n ? s.agreeSum / s.n : 0, unitCostUsd: s.n ? (s.costUsd + s.imputedUsd) / s.n : null }));
  const survivors = rows.filter(s => s.alive && s.n >= Math.min(calls.length, rounds.at(-1)));
  // candidates are given cheapest first; the first survivor is the assignment
  return { node, sampleSize: done, threshold, candidates: rows, assigned: survivors[0]?.model ?? null };
}
