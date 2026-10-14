// Run an E8 solver through the real host on dev worlds and print what an arm author may see: arm errors (invalid
// output, crashes), call and wake-up counts, and the effect results the solver received, by status and error code.
// No grading and no world truth is printed. $0.
//   node beds/ebed/e8/tools/arm-smoke.mjs <solver.mjs> [--seed 1241] [--difficulty 2] [--verbose]
// The solver module exports createSolver() → { id, tick(input, ctx) } (BED-CONTRACT v1.1 §3.1, host README §2).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateWorld, binding } from '../index.mjs';
import { createHost } from '../../host/host.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2];
if (!file) { console.error('usage: arm-smoke.mjs <solver.mjs> [--seed N] [--difficulty D]'); process.exit(2); }
const { createSolver } = await import(pathToFileURL(path.resolve(file)).href);
const seed = Number(arg('--seed', '1241')), difficulty = Number(arg('--difficulty', '2'));
const world = generateWorld({ seed, difficulty, mix: 'tail' });
const arm = createSolver();
const host = createHost({ item: binding, world, arm });
const t = Date.now();
const res = await host.run();
const rows = host.journal.contentRows();
const errors = rows.filter(r => r.type === 'arm.error');
const results = {};
for (const r of rows) if (r.type === 'deliver' && r.event.type === 'effect.result') {
  const p = r.event.payload;
  const items = p.items ?? [{ status: p.status, error: p.error }];
  for (const it of items) { const k = `${p.system}.${p.op} ${it.status}${it.error ? ` ${it.error.code} ${it.error.reason}` : ''}`; results[k] = (results[k] ?? 0) + 1; }
}
console.log(`world seed ${seed} d${difficulty}: ${res.status}, ${res.stats.wakeups} wake-ups, ${res.stats.caseTicks} case-ticks, ${res.stats.instances} instances, ${Date.now() - t} ms`);
console.log(`arm errors: ${errors.length}`);
for (const e of errors.slice(0, process.argv.includes('--verbose') ? 50 : 8)) console.log('  ', e.instance, e.code, JSON.stringify(e.detail).slice(0, 300));
console.log('effect results seen by the solver:');
for (const [k, n] of Object.entries(results).sort()) console.log(`   ${String(n).padStart(5)}  ${k}`);
