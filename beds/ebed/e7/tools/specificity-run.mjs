// Specificity check for E7 (E-BED §9.1, K1: >= 3 independently written correct solvers, 0 false rejects; DESIGN §18
// step 5). Mirrors beds/ebed/e8/tools/specificity-run.mjs: runs each solver under specificity/ (or --dir) out of process
// (sandbox arm) through the real host and grades it with the oracle and the pools of the world's two reference runs.
// Prints, per solver and world: completed-case pass count, critical violations, arm errors, oracle errors and the run
// status; then every completed-pool case a solver fails (up to --show per world on screen, all of them with --json) with
// its first divergence, for adjudication: either the solver is wrong (cite the spec sentence it breaks) or the grader is
// (fix it with a rule-cited window, never a per-item exception). $0 (no model calls).
// Seeds: E7's specificity and Track C rehearsal block 1241-1249 (SEED-LEDGER ebed-e7-rehearsal, DESIGN §13). The default
// is 1242-1244: 1241 was touched at d3 by the part-A walker check (2026-10-14). Dev seeds 1001-1199 are accepted for
// developer checks. The rest of the rehearsal block (author fixtures, attacks, reference validation, the B1 grading
// worlds 1232-1234, the build-loop practice worlds 1235-1237) and every other seed are refused.
// `--shim master-ids` (adjudication 2026-10-15, README E7-B11) is DIAGNOSTIC ONLY, never specificity evidence: it wraps
// each solver (its code untouched) so every master record it reads also carries `id` = the record's S17 id field, to see
// past the one interface guess the three blind solvers got wrong (they keyed master records on `id`, which SPEC-E did
// not state before S17) and grade the rest of their behaviour.
//   node beds/ebed/e7/tools/specificity-run.mjs [--dir <solvers dir>] [--solvers s1.mjs,...] [--seeds 1242-1244]
//        [--difficulties 2,3,4,5] [--size n] [--show 6] [--json out.json] [--shim master-ids]
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWorld, referenceRuns, oracle, binding } from '../index.mjs';
import { createHost } from '../../host/host.mjs';
import { sandboxArm } from '../../host/sandbox-arm.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

/** Seeds this tool may run on: the specificity block of the rehearsal range, or the dev block. */
export function specificitySeedAllowed(seed) {
  return Number.isInteger(seed) && ((seed >= 1241 && seed <= 1249) || (seed >= 1001 && seed <= 1199));
}

/** S17: the id field of each master file's records. */
export const MASTER_ID_FIELDS = Object.freeze({ 'master/cis.json': 'ci', 'master/services.json': 'service', 'master/groups.json': 'group', 'master/users.json': 'userId' });

const SHIM_TAIL = `
// ---- appended by beds/ebed/e7/tools/specificity-run.mjs --shim master-ids (DIAGNOSTIC ONLY; not specificity evidence)
const __SHIM_ID_FIELDS = ${JSON.stringify(MASTER_ID_FIELDS)};
function __shimFiles(files) {
  if (!files || typeof files !== 'object') return files;
  const out = { ...files };
  for (const [p, k] of Object.entries(__SHIM_ID_FIELDS)) {
    if (typeof out[p] !== 'string') continue;
    try {
      const rows = JSON.parse(out[p]);
      if (Array.isArray(rows)) out[p] = JSON.stringify(rows.map(r => (r && typeof r === 'object' && r.id === undefined && r[k] !== undefined ? { id: r[k], ...r } : r)), null, 1);
    } catch { /* leave the file as served */ }
  }
  return out;
}
export function createSolver() {
  const s = __shimmedCreateSolver();
  return { id: s.id, tick(input, ctx) { return s.tick(input, { ...ctx, files: __shimFiles(ctx.files) }); } };
}
export default createSolver;
`;

/**
 * Diagnostic shim (never specificity evidence): the solver source with its `createSolver` wrapped so that `ctx.files`
 * serves every master record with an extra `id` equal to its S17 id field. The solver's own code is not changed.
 */
export function masterIdShim(source) {
  if (!source.includes('export function createSolver()')) throw new Error('--shim master-ids: the solver must declare `export function createSolver()`');
  return source.replace('export function createSolver()', 'function __shimmedCreateSolver()').replace(/^export default createSolver;[ \t]*$/m, '') + SHIM_TAIL;
}

/** Run one solver source on one world; returns the row this tool prints and stores. */
export async function runSolver({ world, pools, id, solverSource, timeoutMs = 20_000 }) {
  const arm = sandboxArm({ id, solverSource, timeoutMs });
  const host = createHost({ item: binding, world, arm, callTimeoutMs: timeoutMs + 5_000 });
  let status;
  try { status = (await host.run()).status; } catch (e) { status = `host-error: ${String(e?.message ?? e).slice(0, 200)}`; } finally { arm.close(); }
  const rows = host.journal.contentRows();
  const v = oracle(world, rows, { pools, arm: id });
  const comp = v.cases.filter(c => c.pool === 'completed');
  const fails = comp.filter(c => !c.pass);
  const armErrors = rows.filter(r => r.type === 'arm.error');
  return {
    status, completed: comp.length, passed: comp.length - fails.length, failed: fails.length, critical: v.critical.length,
    armErrors: armErrors.length, oracleErrors: v.oracleErrors.length,
    criticals: v.critical, armErrorSample: armErrors.slice(0, 5).map(e => ({ instance: e.instance ?? null, code: e.code ?? null, detail: String(JSON.stringify(e.detail ?? e.error ?? '')).slice(0, 300) })),
    fails: fails.map(c => ({ case: c.case, class: c.class, subject: c.subject ?? null, armCensored: c.armCensored, first: c.firstDivergence, openLids: c.openLids })),
  };
}

async function main() {
  const dir = path.resolve(arg('--dir', path.join(here, '..', 'specificity')));
  const solvers = arg('--solvers', null)?.split(',') ?? (existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.mjs')).sort() : []);
  if (!solvers.length) { console.error(`no solvers (*.mjs) in ${dir}; pass --dir or --solvers`); process.exit(2); }
  const [s0, s1] = arg('--seeds', '1242-1244').split('-').map(Number);
  const seeds = Array.from({ length: (s1 ?? s0) - s0 + 1 }, (_, i) => s0 + i);
  const bad = seeds.filter(s => !specificitySeedAllowed(s));
  if (bad.length) throw new Error(`seeds ${bad.join(',')} refused: E7 specificity runs on 1241-1249 (rehearsal block) or dev seeds 1001-1199 (DESIGN §13)`);
  const diffs = arg('--difficulties', '2,3,4,5').split(',').map(Number);
  const size = arg('--size', null) === null ? null : Number(arg('--size'));
  const show = Number(arg('--show', '6'));
  const shim = arg('--shim', null);
  if (shim !== null && shim !== 'master-ids') throw new Error(`unknown --shim ${shim} (only master-ids)`);
  if (shim) console.log('DIAGNOSTIC RUN (--shim master-ids): master records carry an extra `id`; these numbers are not specificity evidence');
  const out = [];
  for (const d of diffs) for (const seed of seeds) {
    const w = generateWorld({ seed, difficulty: d, mix: 'tail', ...(size ? { size } : {}) });
    const { pools } = await referenceRuns(w);
    for (const f of solvers) {
      const src = readFileSync(path.join(dir, f), 'utf8');
      const r = await runSolver({ world: w, pools, id: f, solverSource: shim ? masterIdShim(src) : src });
      out.push({ solver: f, seed, d, size, ...(shim ? { shim } : {}), ...r });
      console.log(`${f.padEnd(24)} d${d} seed ${seed}${size ? ` size ${size}` : ''}${shim ? ` [shim ${shim}]` : ''}: ${r.passed}/${r.completed} pass, critical ${r.critical}, arm errors ${r.armErrors}, oracle errors ${r.oracleErrors}${r.status === 'complete' ? '' : `, ${r.status}`}`);
      for (const c of r.criticals.slice(0, show)) console.log(`     CRITICAL ${JSON.stringify(c).slice(0, 300)}`);
      for (const e of r.armErrorSample.slice(0, Math.min(show, 3))) console.log(`     ARM ERROR ${e.instance ?? ''} ${e.code ?? ''} ${e.detail}`);
      for (const c of r.fails.slice(0, show)) console.log(`     ${c.case} ${c.class}${c.armCensored ? ' (open at horizon)' : ''} ${JSON.stringify(c.first ?? { openLids: c.openLids.slice(0, 3) }).slice(0, 300)}`);
    }
  }
  const j = arg('--json', null);
  if (j) writeFileSync(j, JSON.stringify(out, null, 1));
  const sum = rows => rows.reduce((a, r) => ({ completed: a.completed + r.completed, failed: a.failed + r.failed, critical: a.critical + r.critical, armErrors: a.armErrors + r.armErrors }), { completed: 0, failed: 0, critical: 0, armErrors: 0 });
  for (const f of solvers) { const t = sum(out.filter(r => r.solver === f)); console.log(`${f}: ${t.completed - t.failed}/${t.completed} completed cases pass, critical ${t.critical}, arm errors ${t.armErrors}`); }
  const tot = sum(out);
  console.log(`total: ${tot.completed - tot.failed}/${tot.completed} completed cases pass, critical ${tot.critical}, arm errors ${tot.armErrors}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
