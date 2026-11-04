// Treatment-delivery gate for a swarm arm (review fix M1, 2026-11-04; for the next rung's prereg, not retro-fitted to
// rung 1). Rung 1's launcher went from calibration to the held-out stage although the calibration record already showed
// the swarm lead starting 0 workers (17:48Z), so $2.25 of held-out spend and 7 fresh seeds measured "A plus an unused
// Agent tool". The gate: before any held-out block, every swarm-arm calibration trial must have started at least
// `minWorkers` workers, counted both by the spawn tree (`meta.workers`) and by the CLI (`subagent_stats.spawned`); and at
// least one of them must have completed. Otherwise the stage stops (exit code 7) for a dated amendment.
//   node experiments/swarm/delivery-gate.mjs <calibrate results.jsonl> [--arm S-swarm-haiku] [--min 2]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const GATE_EXIT = 7;
/** { ok, arm, minWorkers, trials: [{ taskKey, workers, spawned, completed }], reason } */
export function deliveryGate(rows, { arm = 'S-swarm-haiku', minWorkers = 2 } = {}) {
  const trials = rows.filter(r => r.arm === arm).map(r => ({ taskKey: r.taskKey, workers: r.meta?.workers ?? null,
    spawned: r.meta?.subagentStats?.spawned ?? null, completed: r.meta?.subagentStats?.completed ?? null }));
  if (!trials.length) return { ok: false, arm, minWorkers, trials, reason: `no ${arm} calibration trial` };
  const short = trials.filter(t => !(Number(t.workers) >= minWorkers && Number(t.spawned) >= minWorkers && Number(t.completed) >= 1));
  return short.length
    ? { ok: false, arm, minWorkers, trials, reason: `treatment not delivered: ${short.map(t => `${t.taskKey} started ${t.workers ?? '?'} workers (CLI spawned ${t.spawned ?? '?'}, completed ${t.completed ?? '?'})`).join('; ')}; need >= ${minWorkers}` }
    : { ok: true, arm, minWorkers, trials, reason: null };
}

function main() {
  const file = process.argv[2];
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const g = deliveryGate(rows, { arm: arg('--arm', 'S-swarm-haiku'), minWorkers: Number(arg('--min', 2)) });
  console.log(JSON.stringify(g, null, 1));
  process.exit(g.ok ? 0 : GATE_EXIT);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
