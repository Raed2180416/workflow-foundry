// AUDIT step 4 driver: run attacks/trivial_solver.py (inside the namespace sandbox) on generated tasks
// and score its output with the oracle.
//   node beds/codefix/attacks/trivial.mjs [difficulty=3] [seeds=30] [split=dev] [firstSeed=1]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generate, oracle } from '../index.mjs';
import { build } from '../build.mjs';
import { runScriptSandboxed } from '../sandbox.mjs';

export const SOLVER = readFileSync(fileURLToPath(new URL('./trivial_solver.py', import.meta.url)), 'utf8');

// Only task.inputs is handed to the solver (prompt is fixed boilerplate).
export function trivialSolve(task, { timeoutMs = 120000 } = {}) {
  const res = runScriptSandboxed(SOLVER, { inputs: task.inputs }, { timeoutMs });
  const line = res.stdout.trim().split('\n').pop() || '';
  try { return { output: JSON.parse(line), error: null }; } catch { return { output: { patched_source: '' }, error: res.stderr.slice(-300) || `status ${res.status}` }; }
}

export function measure({ difficulty = 3, seeds = 30, split = 'dev', firstSeed = 1, verbose = false } = {}) {
  const rows = [];
  for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
    const task = generate({ seed, split, difficulty });
    const t0 = performance.now();
    const { output, error } = trivialSolve(task);
    const v = oracle(task, output);
    const b = build({ seed, split, difficulty });
    rows.push({ seed, domain: b.domain.id, bugs: b.bugs.map(id => `${id}:${b.domain.sites[id].op}`), pass: v.pass, score: +v.score.toFixed(2), ms: Math.round(performance.now() - t0), error });
    if (verbose) console.log(JSON.stringify(rows.at(-1)));
  }
  return { difficulty, split, seeds, passed: rows.filter(r => r.pass).length, rows };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [d = 3, n = 30, split = 'dev', first = 1] = process.argv.slice(2);
  const res = measure({ difficulty: +d, seeds: +n, split, firstSeed: +first, verbose: true });
  console.log(`d${res.difficulty} ${res.split}: trivial solver passes ${res.passed}/${res.seeds} (${(100 * res.passed / res.seeds).toFixed(1)}%)`);
}
