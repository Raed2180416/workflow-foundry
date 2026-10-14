// Specificity check for E8 (E-BED §9.1, K1: >= 3 independently written correct solvers, 0 false rejects). Runs each
// solver under specificity/ out of process (sandbox arm) on dev worlds and grades it with the oracle and the reference
// pools. Every completed-pool case a solver fails is printed with its first divergence for adjudication: either the
// solver is wrong (cite the spec sentence it breaks) or the grader is (fix it with a rule-cited window, never a per-item
// exception). $0. Seeds: E-bed dev block 1241-1249 (specificity solvers and Track C rehearsal).
//   node beds/ebed/e8/tools/specificity-run.mjs [--solvers s1-state-machine.mjs,...] [--seeds 1241-1243] [--difficulties 2,3,4,5]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWorld, referenceRuns, oracle, binding } from '../index.mjs';
import { createHost } from '../../host/host.mjs';
import { sandboxArm } from '../../host/sandbox-arm.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const dir = path.join(here, '..', 'specificity');
const solvers = (arg('--solvers', null)?.split(',') ?? readdirSync(dir).filter(f => f.endsWith('.mjs')).sort());
const [s0, s1] = arg('--seeds', '1241-1243').split('-').map(Number);
const diffs = arg('--difficulties', '2,3,4,5').split(',').map(Number);
const verbose = Number(arg('--show', '6'));
const out = [];
for (const d of diffs) for (let seed = s0; seed <= (s1 ?? s0); seed++) {
  const w = generateWorld({ seed, difficulty: d, mix: 'tail' });
  const { pools } = await referenceRuns(w);
  for (const f of solvers) {
    const arm = sandboxArm({ id: f, solverSource: readFileSync(path.join(dir, f), 'utf8'), timeoutMs: 20_000 });
    const host = createHost({ item: binding, world: w, arm, callTimeoutMs: 25_000 });
    try { await host.run(); } finally { arm.close(); }
    const v = oracle(w, host.journal.contentRows(), { pools, arm: f });
    const comp = v.cases.filter(c => c.pool === 'completed');
    const fails = comp.filter(c => !c.pass);
    const armErrors = host.journal.contentRows().filter(r => r.type === 'arm.error').length;
    out.push({ solver: f, seed, d, completed: comp.length, failed: fails.length, critical: v.critical.length, armErrors,
      fails: fails.map(c => ({ case: c.case, class: c.class, armCensored: c.armCensored, first: c.firstDivergence, openLids: c.openLids })) });
    console.log(`${f.padEnd(24)} d${d} seed ${seed}: ${comp.length - fails.length}/${comp.length} pass, critical ${v.critical.length}, arm errors ${armErrors}`);
    for (const c of fails.slice(0, verbose)) console.log(`     ${c.case} ${c.class}${c.armCensored ? ' (open at horizon)' : ''} ${JSON.stringify(c.firstDivergence ?? { openLids: c.openLids.slice(0, 3) }).slice(0, 300)}`);
  }
}
const j = arg('--json', null);
if (j) writeFileSync(j, JSON.stringify(out, null, 1));
const tot = out.reduce((a, r) => ({ completed: a.completed + r.completed, failed: a.failed + r.failed }), { completed: 0, failed: 0 });
console.log(`total: ${tot.completed - tot.failed}/${tot.completed} completed cases pass`);
