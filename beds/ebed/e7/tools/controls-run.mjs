// Run the E7 controls on attack worlds ($0) and report, per control and difficulty: worlds where the control failed at
// least one completed case, the failure rate over all completed cases and over its target cases (necessity: the cases
// where the removed construct matters, controls.mjs targetCases), critical violations, and the layers and codes of
// first divergences. Pools come from the two reference runs of each world (contract §6).
// Seeds: E-bed E7 rehearsal block, attacks 1211-1222 (DESIGN §13: triviality, necessity, gaming attacks).
//   node beds/ebed/e7/tools/controls-run.mjs [--seeds 1211-1214] [--difficulties 2,3,4,5] [--controls a,b] [--size n] [--json out.json]
import { writeFileSync } from 'node:fs';
import { generateWorld, referenceRuns, oracle } from '../index.mjs';
import { CONTROLS, runControl, targetCases } from '../controls.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const [s0, s1] = arg('--seeds', '1211-1214').split('-').map(Number);
const diffs = arg('--difficulties', '2,3,4,5').split(',').map(Number);
const only = arg('--controls', null)?.split(',');
const size = arg('--size', null);
const out = [];
for (const d of diffs) {
  const worlds = [];
  for (let seed = s0; seed <= (s1 ?? s0); seed++) {
    const w = generateWorld({ seed, difficulty: d, mix: 'tail', ...(size ? { size: Number(size) } : {}) });
    worlds.push({ w, pools: (await referenceRuns(w)).pools });
  }
  for (const ctl of CONTROLS.filter(c => !only || only.includes(c.id))) {
    if (d < (ctl.minDifficulty ?? 2)) continue;
    const t = Date.now();
    const agg = { control: ctl.id, kind: ctl.kind, d, worlds: 0, worldsFailed: 0, completed: 0, failed: 0, target: 0, targetFailed: 0, critical: 0, codes: {}, criticalCodes: {} };
    for (const { w, pools } of worlds) {
      const v = oracle(w, await runControl(ctl.id, w), { pools });
      const comp = v.cases.filter(x => x.pool === 'completed');
      const fails = comp.filter(x => !x.pass);
      agg.worlds += 1; agg.completed += comp.length; agg.failed += fails.length; agg.critical += v.critical.length;
      for (const c of v.critical) agg.criticalCodes[c.code] = (agg.criticalCodes[c.code] ?? 0) + 1;
      if (fails.length) agg.worldsFailed += 1;
      for (const f of fails) { const k = f.firstDivergence ? `L${f.firstDivergence.layer}:${f.firstDivergence.code}` : 'armCensored'; agg.codes[k] = (agg.codes[k] ?? 0) + 1; }
      const tgt = targetCases(w, ctl.id);
      if (tgt) { const set = new Set(tgt); const tc = comp.filter(x => set.has(x.case)); agg.target += tc.length; agg.targetFailed += tc.filter(x => !x.pass).length; }
    }
    agg.seconds = (Date.now() - t) / 1000;
    out.push(agg);
    const tgt = ctl.kind === 'necessity' ? `, target cases ${agg.targetFailed}/${agg.target} failed (${agg.target ? (100 * agg.targetFailed / agg.target).toFixed(0) : '-'}%)` : '';
    const crit = agg.critical ? `, critical ${agg.critical} ${JSON.stringify(agg.criticalCodes)}` : '';
    console.log(`d${d} ${ctl.kind.padEnd(9)} ${ctl.id.padEnd(26)} worlds failed ${agg.worldsFailed}/${agg.worlds}, cases ${agg.failed}/${agg.completed} failed${tgt}${crit}  ${JSON.stringify(Object.fromEntries(Object.entries(agg.codes).sort((a, b) => b[1] - a[1]).slice(0, 3)))}`);
  }
}
const j = arg('--json', null);
if (j) writeFileSync(j, JSON.stringify(out, null, 1));
