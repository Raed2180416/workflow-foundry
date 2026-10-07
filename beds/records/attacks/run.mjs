// Reproduces the AUDIT step-4 triviality table: pass rate of each attack solver per difficulty.
// Usage: node beds/records/attacks/run.mjs [seeds=30] [bedDir=..]   (bedDir lets you score an older bed checkout)
// A thrown error counts as a failed task (the attack produced no answer).
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { budgetSolve } from './budget.mjs';
import { trivialSolve as denseV1 } from './dense-v1.mjs';
import { trivialSolve as denseV2 } from './dense-v2.mjs';

export const ATTACKS = { budget: budgetSolve, 'dense-v1': denseV1, 'dense-v2': denseV2 };
export function attackPassRate(bed, solve, difficulty, seeds, split = 'dev') {
  let pass = 0, crashed = 0;
  for (let seed = 0; seed < seeds; seed++) {
    const task = bed.generate({ seed, split, difficulty });
    let out;
    try { out = solve(task); } catch { crashed++; continue; }
    if (bed.oracle(task, out).pass) pass++;
  }
  return { pass, crashed, seeds };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const seeds = Number(process.argv[2] ?? 30);
  const here = dirname(fileURLToPath(import.meta.url));
  const bedDir = resolve(process.argv[3] ?? resolve(here, '..'));
  const bed = await import(pathToFileURL(resolve(bedDir, 'index.mjs')).href);
  console.log(`bed ${bed.family.id} v${bed.family.version} (${bedDir}), ${seeds} dev seeds per cell; cell = passes/seeds (crashes)`);
  for (const [name, solve] of Object.entries(ATTACKS)) {
    const cells = [1, 2, 3, 4, 5].map(d => { const r = attackPassRate(bed, solve, d, seeds); return `d${d} ${r.pass}/${r.seeds}${r.crashed ? ` (${r.crashed}c)` : ''}`; });
    console.log(name.padEnd(9), cells.join('  '));
  }
}
