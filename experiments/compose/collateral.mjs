// Move 8 $0 step (ATTACK.md §6, Move 8; research/blockers-20261021/MOVE2-COMP.md): per-case pass vectors of the six
// composed programs, their drift-D1 patches and the monolith lineages, on the drifted dev worlds (review-timeout-clears,
// 1165 d2 s30, 1166 d3 s30) and the nine undrifted grading worlds (1232-1234 x d2, d3, d5). From them: the collateral a
// patch caused (cases other than the drift-converted ones whose outcome changed) against the collateral a rebuild would
// cause (independent builds of one arm disagree on cases nobody asked to change). $0, no model calls, runtime 1 (the
// frozen harness), development evidence. Resumable per (program, world).
//   nice -n 15 node experiments/compose/collateral.mjs [--only <label,...>] [--worlds drift|grading|all]
//        [--out research/blockers-20261021/move8/collateral]
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { sandboxArm } from '../../beds/ebed/host/sandbox-arm.mjs';
import { DRIFTS, driftedItem, driftedBinding, driftWorld } from './drift.mjs';
import { poolsFor, assess, runArm } from './run.mjs';
import { subjectOf } from './fault-run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const RUNS = 'research/composition-20261021/runs';
const MONO = 'research/enterprise-20261014/runs';
export const DRIFT = 'review-timeout-clears';
export const DRIFT_WORLDS = Object.freeze([{ seed: 1165, d: 2, size: 30 }, { seed: 1166, d: 3, size: 30 }]);
export const GRADING_WORLDS = Object.freeze([1232, 1233, 1234].flatMap(seed => [2, 3, 5].map(d => ({ seed, d, size: null }))));

export const PROGRAMS = Object.freeze([
  ...['ch-e8-1', 'ch-e8-2', 'ch-e8-3', 'cht-e8-1', 'cht-e8-2', 'cht-e8-3'].flatMap(l => [
    { label: l, arm: l.startsWith('cht') ? 'C-H-T' : 'C-H', patched: false, spec: `program:${RUNS}/${l}/program` },
    { label: `${l}-d1`, arm: l.startsWith('cht') ? 'C-H-T' : 'C-H', patched: true, of: l, spec: `program:${RUNS}/${l}-d1/program` }]),
  ...['b1lh-e8-1', 'b1lh-e8-2', 'b1lh-e8-3'].map(l => ({ label: l, arm: 'B1L-H (raw)', patched: false, spec: `solver:${MONO}/${l}/solver.mjs` })),
  ...['b1nh-e8-2', 'b1nh-e8-3'].map(l => ({ label: l, arm: 'B1N-H (repaired)', patched: false, spec: `solver:${MONO}/${l}/solver.mjs` })),
]);

/** Per-case outcome vector of one run: { case: pass } over completed cases. */
export function vectorOf(a) {
  const failing = new Set(a.oracle.failing.map(f => f.case));
  return a.oracleCompleted.reduce((o, c) => { o[c] = !failing.has(c); return o; }, {});
}

/**
 * collateral(va, vb, { exclude }) → { compared, changed, aPassBFail, aFailBPass, cases }: cases completed in both runs,
 * outside `exclude` (the drift-converted cases), whose outcome differs.
 */
export function collateral(va, vb, { exclude = [] } = {}) {
  const ex = new Set(exclude);
  const both = Object.keys(va).filter(c => Object.hasOwn(vb, c) && !ex.has(c)).sort();
  const changed = both.filter(c => va[c] !== vb[c]);
  return { compared: both.length, changed: changed.length, aPassBFail: changed.filter(c => va[c]).length, aFailBPass: changed.filter(c => vb[c]).length, cases: changed };
}

async function runOne({ prog, world, item, binding, pools }) {
  const subject = subjectOf(prog.spec, { mode: 'strict' });
  const arm = sandboxArm({ id: prog.label, solverSource: subject.source, timeoutMs: 20_000 });
  try {
    const r = await runArm({ world, arm, binding, callTimeoutMs: 25_000 });
    const a = assess({ world, rows: r.rows, pools, item, ...(item !== e8.oracleItem ? { rules: DRIFTS[DRIFT].rules } : {}), manifest: subject.manifest });
    const completed = Object.entries(pools).filter(([, p]) => p === 'completed').map(([c]) => c);
    return { status: r.status, armErrors: a.armErrors, oracle: `${a.oracle.passed}/${a.oracle.completed}`, vector: vectorOf({ ...a, oracleCompleted: completed }) };
  } finally { arm.close(); }
}

export async function collect({ only = null, which = 'all', outDir, log = console.log }) {
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'vectors.json');
  const doc = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { drift: DRIFT, evidence: 'development (dev worlds), $0, runtime 1 (frozen harness)', worlds: {}, runs: {} };
  const save = () => { writeFileSync(`${file}.tmp`, JSON.stringify(doc)); renameSync(`${file}.tmp`, file); };
  const dir = mkdtempSync(path.join(os.tmpdir(), 'collateral-drift-'));
  try {
    const sets = [];
    if (which === 'drift' || which === 'all') {
      const item = await driftedItem(DRIFT, dir);
      const binding = driftedBinding(DRIFT);
      for (const w of DRIFT_WORLDS) {
        const { world, converted } = driftWorld(e8.generateWorld({ seed: w.seed, difficulty: w.d, mix: 'tail', size: w.size }), DRIFT);
        sets.push({ key: `drift:${w.seed}:d${w.d}`, world, item, binding, converted });
      }
    }
    if (which === 'grading' || which === 'all') {
      for (const w of GRADING_WORLDS) sets.push({ key: `grading:${w.seed}:d${w.d}`, world: e8.generateWorld({ seed: w.seed, difficulty: w.d, mix: 'tail' }), item: e8.oracleItem, binding: e8.binding, converted: [] });
    }
    for (const s of sets) {
      const { pools } = await poolsFor(s.world, { item: s.item, binding: s.binding });
      doc.worlds[s.key] = { converted: s.converted, completed: Object.values(pools).filter(p => p === 'completed').length };
      for (const prog of PROGRAMS) {
        if (only && !only.includes(prog.label)) continue;
        doc.runs[prog.label] ??= {};
        if (doc.runs[prog.label][s.key]) continue;
        const t = Date.now();
        const r = await runOne({ prog, world: s.world, item: s.item, binding: s.binding, pools });
        doc.runs[prog.label][s.key] = { ...r, ms: Date.now() - t };
        save();
        log(`${prog.label} ${s.key}: oracle ${r.oracle} | arm errors ${r.armErrors} | ${Date.now() - t} ms`);
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  return doc;
}

/** The collateral tables from a vectors document. */
export function analyse(doc) {
  const out = { patch: [], rebuild: [] };
  const keys = Object.keys(doc.worlds);
  const conv = k => doc.worlds[k].converted ?? [];
  for (const p of PROGRAMS.filter(x => x.patched)) {
    for (const k of keys.filter(x => x.startsWith('drift:'))) {
      const a = doc.runs[p.of]?.[k], b = doc.runs[p.label]?.[k];
      if (!a || !b) continue;
      const c = collateral(a.vector, b.vector, { exclude: conv(k) });
      const fixed = conv(k).filter(x => Object.hasOwn(b.vector, x) && b.vector[x] && !a.vector[x]).length;
      out.patch.push({ program: p.of, world: k, compared: c.compared, collateral: c.changed, convertedFixed: fixed, converted: conv(k).length });
    }
  }
  const arms = [...new Set(PROGRAMS.map(p => p.arm))];
  for (const arm of arms) {
    for (const patched of [false, true]) {
      const members = PROGRAMS.filter(p => p.arm === arm && p.patched === patched);
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          for (const k of keys) {
            const a = doc.runs[members[i].label]?.[k], b = doc.runs[members[j].label]?.[k];
            if (!a || !b) continue;
            const c = collateral(a.vector, b.vector, { exclude: conv(k) });
            out.rebuild.push({ arm, patched, a: members[i].label, b: members[j].label, world: k, compared: c.compared, collateral: c.changed, aPassBFail: c.aPassBFail, aFailBPass: c.aFailBPass });
          }
        }
      }
    }
  }
  return out;
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.chdir(ROOT);
  const outDir = path.resolve(ROOT, arg('--out', 'research/blockers-20261021/move8/collateral'));
  const doc = await collect({ only: arg('--only', null)?.split(',') ?? null, which: arg('--worlds', 'all'), outDir });
  const tables = analyse(doc);
  writeFileSync(path.join(outDir, 'collateral.json'), JSON.stringify(tables, null, 1));
}
