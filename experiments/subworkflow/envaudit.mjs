#!/usr/bin/env node
// SW-1 environment-fault audit (post hoc; analysis side, not part of the frozen pipeline). The runner marks a unit
// 'env-fault' only when a node's own call fails with an environment code. A rate limit inside a sub-workflow's judge
// step is different: the child run stops, the node's construct loop treats it as a failed round and repairs or falls
// back, and the unit can end 'complete' with an environment-shaped path. This audit reads the journal and lists, for
// every unit's last complete row, each failed call of an environment class (rate limit, unavailable, timeout, protocol)
// made inside that row's wall-clock window under its run id, per node, with the node's path, so contaminated nodes can
// be reported and excluded in a sensitivity line. It also re-sums each unit's spend from the journal (all attempts).
//   node experiments/subworkflow/envaudit.mjs --results <results.jsonl> --journal <journal.sqlite> [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
export const ENV_CODES = Object.freeze(['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT', 'MODEL_PROTOCOL']);

export function audit(resultsText, db) {
  const last = new Map();
  for (const l of resultsText.split('\n').filter(Boolean)) {
    const r = JSON.parse(l);
    if (r.status === 'complete') last.set(r.unit, r);
    else if (!last.has(r.unit) || last.get(r.unit).status !== 'complete') last.set(r.unit, r);
  }
  const q = db.prepare(`SELECT node_key, error_code, created_at FROM model_calls WHERE run_id = ? AND ok = 0 AND error_code IN (${ENV_CODES.map(() => '?').join(',')}) AND created_at BETWEEN ? AND ?`);
  const spendQ = db.prepare('SELECT COALESCE(SUM(cost_usd),0) AS c, COUNT(*) AS n, SUM(ok=0) AS failed FROM model_calls WHERE run_id = ?');
  const units = [];
  for (const r of last.values()) {
    if (r.status !== 'complete') continue;
    const end = Date.parse(r.at), start = end - r.wallMs - 1000;
    const rows = q.all(r.runId, ...ENV_CODES, start, end + 1000);
    const byNode = {};
    for (const x of rows) { const ch = x.node_key.split('.')[0]; (byNode[ch] ??= []).push(`${x.error_code}@${x.node_key.slice(ch.length + 1)}`); }
    const s = spendQ.get(r.runId);
    units.push({ unit: r.unit, arm: r.arm, envCalls: rows.length,
      nodes: Object.entries(byNode).map(([channel, calls]) => { const n = r.nodes.find(x => x.channel === channel); return { channel, kind: n?.kind, path: n?.path, pass: n?.pass, calls }; }),
      rowCostUsd: r.costUsd, journalCostUsd: Math.round(s.c * 1e6) / 1e6, journalCalls: s.n, journalFailed: s.failed });
  }
  return units;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = new DatabaseSync(args.journal, { readOnly: true });
  const units = audit(readFileSync(args.results, 'utf8'), db);
  const hit = units.filter(u => u.envCalls);
  console.log(`${units.length} complete units; ${hit.length} with environment-class failed calls inside their final window`);
  for (const u of hit) console.log(`  ${u.unit}: ${u.nodes.map(n => `${n.channel} (${n.kind}, ${n.path}, pass=${n.pass}): ${n.calls.join(', ')}`).join(' | ')}`);
  const drift = units.filter(u => Math.abs(u.journalCostUsd - u.rowCostUsd) > 1e-5);
  console.log(`row cost vs journal cost (all attempts of the run id; tolerance $0.00001 for per-call rounding): ${drift.length} units differ`);
  for (const u of drift.slice(0, 20)) console.log(`  ${u.unit}: row $${u.rowCostUsd} journal $${u.journalCostUsd} (${u.journalCalls} calls, ${u.journalFailed} failed)`);
  if (args.json) writeFileSync(args.json, JSON.stringify({ units }, null, 1));
}
