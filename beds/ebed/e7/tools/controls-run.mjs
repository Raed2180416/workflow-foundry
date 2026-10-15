// Run the E7 controls on attack worlds ($0) and report, per control and difficulty: worlds where the control failed at
// least one completed case, the failure rate over all completed cases and over its target cases (necessity: the cases
// where the removed construct matters, controls.mjs targetCases), the target cases' share of the completed cases, the
// failures outside the target cases, critical violations, and the layers and codes of first divergences. Pools come
// from the two reference runs of each world (contract §6). A summary over the difficulties closes the output.
// Targets of the 'planned' controls are the cases whose expectation on the planned timeline changes when the construct
// is removed: they come from the oracle's own expectation diff, so their failure is close to certain by construction.
// The truth-predicate targets (timer-first, no-dedupe, no-correlation, no-sod) are defined independently of the oracle.
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
    const agg = { control: ctl.id, kind: ctl.kind, d, worlds: 0, worldsFailed: 0, completed: 0, failed: 0, target: 0, targetFailed: 0, outsideFailed: 0, critical: 0, codes: {}, criticalCodes: {} };
    for (const { w, pools } of worlds) {
      const v = oracle(w, await runControl(ctl.id, w), { pools });
      const comp = v.cases.filter(x => x.pool === 'completed');
      const fails = comp.filter(x => !x.pass);
      agg.worlds += 1; agg.completed += comp.length; agg.failed += fails.length; agg.critical += v.critical.length;
      for (const c of v.critical) agg.criticalCodes[c.code] = (agg.criticalCodes[c.code] ?? 0) + 1;
      if (fails.length) agg.worldsFailed += 1;
      for (const f of fails) { const k = f.firstDivergence ? `L${f.firstDivergence.layer}:${f.firstDivergence.code}` : 'armCensored'; agg.codes[k] = (agg.codes[k] ?? 0) + 1; }
      const tgt = targetCases(w, ctl.id);
      if (tgt) {
        const set = new Set(tgt);
        const tc = comp.filter(x => set.has(x.case));
        agg.target += tc.length; agg.targetFailed += tc.filter(x => !x.pass).length;
        agg.outsideFailed += fails.filter(x => !set.has(x.case)).length;
      }
    }
    agg.seconds = (Date.now() - t) / 1000;
    out.push(agg);
    const tgt = ctl.kind === 'necessity' ? `, target cases ${agg.targetFailed}/${agg.target} failed (${agg.target ? (100 * agg.targetFailed / agg.target).toFixed(0) : '-'}%; ${(100 * agg.target / Math.max(1, agg.completed)).toFixed(1)}% of completed), ${agg.outsideFailed} failed outside the targets` : '';
    const crit = agg.critical ? `, critical ${agg.critical} ${JSON.stringify(agg.criticalCodes)}` : '';
    console.log(`d${d} ${ctl.kind.padEnd(9)} ${ctl.id.padEnd(26)} worlds failed ${agg.worldsFailed}/${agg.worlds}, cases ${agg.failed}/${agg.completed} failed${tgt}${crit}  ${JSON.stringify(Object.fromEntries(Object.entries(agg.codes).sort((a, b) => b[1] - a[1]).slice(0, 3)))}`);
  }
}
// Summary over the difficulties run: per control, completed, failed, target (share of completed), target failed, failed
// outside the targets, critical.
console.log('\nsummary over d' + diffs.join(',d'));
for (const ctl of CONTROLS.filter(c => !only || only.includes(c.id))) {
  const rs = out.filter(r => r.control === ctl.id);
  if (!rs.length) continue;
  const S = k => rs.reduce((n, r) => n + r[k], 0);
  const [completed, failed, target, targetFailed, outside, crit] = ['completed', 'failed', 'target', 'targetFailed', 'outsideFailed', 'critical'].map(S);
  const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : '-');
  const nec = ctl.kind === 'necessity' ? `  target ${target}/${completed} (${pct(target, completed)})  target failed ${targetFailed}/${target} (${pct(targetFailed, target)})  outside failed ${outside}/${completed - target}` : '';
  console.log(`${ctl.kind.padEnd(9)} ${ctl.id.padEnd(26)} failed ${failed}/${completed} (${pct(failed, completed)})${nec}${crit ? `  critical ${crit}` : ''}`);
}
const j = arg('--json', null);
if (j) writeFileSync(j, JSON.stringify(out, null, 1));
