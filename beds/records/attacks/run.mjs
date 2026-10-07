// Reproduces the AUDIT triviality table: pass rate of each attack solver per difficulty.
// Usage: node beds/records/attacks/run.mjs [seeds=30] [split=test] [seed0=5000] [bedDir=..]
// (bedDir lets you score an older bed checkout). A thrown error counts as a failed task.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { budgetSolve } from './budget.mjs';
import { trivialSolve as denseV1 } from './dense-v1.mjs';
import { trivialSolve as denseV2 } from './dense-v2.mjs';
import { heurSolve as heurV2 } from './heur-v2.mjs';
import { heurSolve as heurV3 } from './heur-v3.mjs';
import { heurSolve as heurV3Full } from './heur-v3-full.mjs';

// Budget = at most 40 lines of at most 160 characters (see AUDIT.md). heur-v3-full is deliberately over it.
export const ATTACKS = { budget: budgetSolve, 'dense-v1': denseV1, 'dense-v2': denseV2, 'heur-v2': heurV2, 'heur-v3': heurV3, 'heur-v3-full': heurV3Full };
export function attackPassRate(bed, solve, difficulty, seeds, split = 'test', seed0 = split === 'test' ? 5000 : 0) {
  let pass = 0, crashed = 0;
  for (let seed = seed0; seed < seed0 + seeds; seed++) {
    const task = bed.generate({ seed, split, difficulty });
    let out;
    try { out = solve(task); } catch { crashed++; continue; }
    if (bed.oracle(task, out).pass) pass++;
  }
  return { pass, crashed, seeds };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const seeds = Number(process.argv[2] ?? 30), split = process.argv[3] ?? 'test';
  const seed0 = Number(process.argv[4] ?? (split === 'test' ? 5000 : 0));
  const here = dirname(fileURLToPath(import.meta.url));
  const bedDir = resolve(process.argv[5] ?? resolve(here, '..'));
  const bed = await import(pathToFileURL(resolve(bedDir, 'index.mjs')).href);
  console.log(`bed ${bed.family.id} v${bed.family.version} (${bedDir}), ${split} seeds ${seed0}..${seed0 + seeds - 1}; cell = passes/seeds (crashes)`);
  for (const [name, solve] of Object.entries(ATTACKS)) {
    const cells = [1, 2, 3, 4, 5].map(d => { const r = attackPassRate(bed, solve, d, seeds, split, seed0); return `d${d} ${r.pass}/${r.seeds}${r.crashed ? ` (${r.crashed}c)` : ''}`; });
    console.log(name.padEnd(13), cells.join('  '));
  }
}
