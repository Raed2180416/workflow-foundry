// E8 bed health ($0, no model calls): both reference runs on dev worlds, per difficulty. Reports divergences of the
// reference runs (each must pass every case it completes: oracle self-consistency, contract §5.6), oracle errors,
// critical violations, the completed/censored pools and the censored share per epoch (K1: >= 80% completed in every
// epoch except the last, contract §6), and wall time. Seeds: E-bed dev block 1001-1199 (bed health).
//   node beds/ebed/e8/tools/health.mjs [--seeds 1001-1010] [--difficulties 2,3,4,5] [--json out.json]
import { writeFileSync } from 'node:fs';
import { generateWorld, referenceRuns } from '../index.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const [s0, s1] = arg('--seeds', '1001-1010').split('-').map(Number);
const diffs = arg('--difficulties', '2,3,4,5').split(',').map(Number);
const mix = arg('--mix', 'tail');
const rows = [];
for (const d of diffs) {
  const agg = { d, worlds: 0, cases: 0, completed: 0, refFail: 0, oracleErrors: 0, critical: 0, ms: 0, epochs: {} };
  for (let seed = s0; seed <= (s1 ?? s0); seed++) {
    const world = generateWorld({ seed, difficulty: d, mix });
    const t = Date.now();
    const r = await referenceRuns(world);
    agg.ms += Date.now() - t;
    agg.worlds += 1;
    for (const timing of ['earliest', 'latest']) {
      const v = r.verdicts[timing];
      agg.oracleErrors += v.oracleErrors.length;
      agg.critical += v.critical.length;
      for (const cv of v.cases) if (cv.firstDivergence) { agg.refFail += 1; rows.push({ d, seed, timing, case: cv.case, class: cv.class, div: cv.firstDivergence }); }
    }
    for (const cv of r.verdicts.earliest.cases) {
      agg.cases += 1;
      const pool = r.pools[cv.case];
      if (pool === 'completed') agg.completed += 1;
      const e = (agg.epochs[cv.epoch] ??= { cases: 0, completed: 0 });
      e.cases += 1; if (pool === 'completed') e.completed += 1;
    }
  }
  const epochs = Object.fromEntries(Object.entries(agg.epochs).sort().map(([k, v]) => [k, `${v.completed}/${v.cases} (${(100 * v.completed / v.cases).toFixed(1)}%)`]));
  console.log(`d${d}: worlds ${agg.worlds}, cases ${agg.cases}, completed ${agg.completed}, reference divergences ${agg.refFail}, oracle errors ${agg.oracleErrors}, critical ${agg.critical}, ${(agg.ms / agg.worlds / 1000).toFixed(2)} s/world`);
  console.log('   completed by epoch:', JSON.stringify(epochs));
  rows.push({ summary: { ...agg, epochs } });
}
for (const r of rows.filter(x => x.div).slice(0, 20)) console.log('  DIVERGENCE', JSON.stringify(r).slice(0, 500));
const out = arg('--json', null);
if (out) writeFileSync(out, JSON.stringify(rows, null, 1));
