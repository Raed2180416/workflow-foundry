// Run the E8 controls on attack worlds ($0) and report, per control and difficulty: worlds where the control failed at
// least one completed case, the failure rate over all completed cases and over its target classes (necessity), and the
// layers and codes of first divergences. Pools come from the two reference runs of each world (contract §6).
// Seeds: E-bed attack block 1211-1222 (E-BED §6 seeds: triviality, necessity, gaming attacks).
//   node beds/ebed/e8/tools/controls-run.mjs [--seeds 1211-1214] [--difficulties 2,3,4,5] [--controls a,b] [--json out.json]
import { writeFileSync } from 'node:fs';
import { generateWorld, referenceRuns, oracle } from '../index.mjs';
import { CONTROLS, runControl, targetCases } from '../controls.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const [s0, s1] = arg('--seeds', '1211-1214').split('-').map(Number);
const diffs = arg('--difficulties', '2,3,4,5').split(',').map(Number);
const only = arg('--controls', null)?.split(',');
const out = [];
for (const d of diffs) {
  const worlds = [];
  for (let seed = s0; seed <= (s1 ?? s0); seed++) { const w = generateWorld({ seed, difficulty: d, mix: 'tail' }); worlds.push({ w, pools: (await referenceRuns(w)).pools }); }
  for (const ctl of CONTROLS.filter(c => !only || only.includes(c.id))) {
    if (d < (ctl.minDifficulty ?? 2)) continue;
    const agg = { control: ctl.id, kind: ctl.kind, d, worlds: 0, worldsFailed: 0, completed: 0, failed: 0, target: 0, targetFailed: 0, critical: 0, codes: {} };
    for (const { w, pools } of worlds) {
      const v = oracle(w, await runControl(ctl.id, w), { pools });
      const comp = v.cases.filter(x => x.pool === 'completed');
      const fails = comp.filter(x => !x.pass);
      agg.worlds += 1; agg.completed += comp.length; agg.failed += fails.length; agg.critical += v.critical.length;
      if (fails.length) agg.worldsFailed += 1;
      for (const f of fails) { const k = f.firstDivergence ? `L${f.firstDivergence.layer}:${f.firstDivergence.code}` : 'armCensored'; agg.codes[k] = (agg.codes[k] ?? 0) + 1; }
      const tgt = targetCases(w, ctl.id);
      if (tgt) { const set = new Set(tgt); const tc = comp.filter(x => set.has(x.case)); agg.target += tc.length; agg.targetFailed += tc.filter(x => !x.pass).length; }
    }
    out.push(agg);
    const tgt = agg.target ? `, target classes ${agg.targetFailed}/${agg.target} failed (${(100 * agg.targetFailed / agg.target).toFixed(0)}%)` : '';
    console.log(`d${d} ${ctl.kind.padEnd(9)} ${ctl.id.padEnd(27)} worlds failed ${agg.worldsFailed}/${agg.worlds}, cases ${agg.failed}/${agg.completed} failed${tgt}, critical ${agg.critical}  ${JSON.stringify(Object.fromEntries(Object.entries(agg.codes).sort((a, b) => b[1] - a[1]).slice(0, 3)))}`);
  }
}
const j = arg('--json', null);
if (j) writeFileSync(j, JSON.stringify(out, null, 1));
