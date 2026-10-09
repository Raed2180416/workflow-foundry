// Main run: 30 gridquest dev seeds x d3-d5 x P0-P4 (+ variants, + handoff-time sweep). $0, no LLM.
// usage: node --max-old-space-size=1024 run.mjs [--seeds 100..129] [--out out/rows.json]
import { writeFileSync } from 'node:fs';
import { bed, split } from './lib.mjs';
import { controllerTrace, triggers, runHandoff } from './protocols.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const [lo, hi] = arg('--seeds', '100..129').split('..').map(Number);
const out = arg('--out', new URL('./out/rows.json', import.meta.url).pathname);
const DIFFS = [3, 4, 5];
const SWEEP = [5, 10, 20, 30, 45];
const rows = [];
const t00 = Date.now();

for (const d of DIFFS) for (let seed = lo; seed <= hi; seed++) {
  const task = bed.generate({ seed, split, difficulty: d });
  const C = controllerTrace(task);
  if (!C.actionsMatch) throw new Error(`trace mismatch ${d}/${seed}`);
  const trig = triggers(C);
  const bad = C.trace.filter(x => ['blocked', 'failed', 'invalid'].includes(x.outcome)).length;
  const p0 = { pass: C.pass, steps: C.n, failures: bad, ms: Math.round(C.ms * 100) / 100 };
  const res = { P0: p0 };
  if (trig.none) {
    // controller won before any refuted expectation: every protocol is the controller's run
    for (const R of ['ii', 'i']) for (const P of ['P1', 'P2', 'P3', 'P4', 'P4c']) res[`${R}.${P}`] = { ...p0, noHandoff: true };
    res['ii.P3lossy'] = { ...p0, noHandoff: true }; res['ii.P3amn'] = { ...p0, noHandoff: true };
  } else {
    for (const R of ['ii', 'i']) {
      res[`${R}.P1`] = runHandoff(C, task, 'P1', R, trig.P3);
      res[`${R}.P2`] = runHandoff(C, task, 'P2', R, trig.P3);
      res[`${R}.P3`] = runHandoff(C, task, 'P3', R, trig.P3);
      res[`${R}.P4`] = runHandoff(C, task, 'P3', R, trig.P4);
      res[`${R}.P4c`] = runHandoff(C, task, 'P3', R, trig.P4c);
    }
    res['ii.P3lossy'] = runHandoff(C, task, 'P3', 'ii', trig.P3, 'lossy');
    res['ii.P3amn'] = runHandoff(C, task, 'P3', 'ii', trig.P3, 'amn');
  }
  // handoff-time sweep: hand off after h controller actions (or at the controller's end)
  const sweep = {};
  for (const h of SWEEP) {
    const prefix = Math.min(h, C.n);
    const none = C.won && C.n <= h;
    for (const R of ['ii', 'i']) for (const P of ['P2', 'P3']) {
      sweep[`h${h}.${R}.${P}`] = none ? { ...p0, noHandoff: true } : { ...runHandoff(C, task, P, R, prefix), strandedAtHandoff: C.lastRec < prefix };
    }
  }
  rows.push({
    d, seed, B: C.B, optimal: C.W.optimal,
    ctrl: { n: C.n, won: C.won, firstBad: C.firstBad, lastRec: C.lastRec, stranded: C.lastRec < C.n, ms: p0.ms },
    trig, res, sweep,
  });
  process.stderr.write(`d${d} seed ${seed} ctrl n=${C.n} pass=${C.pass} firstBad=${C.firstBad} lastRec=${C.lastRec} P3prefix=${trig.P3} P4prefix=${trig.P4}\n`);
}
writeFileSync(out, JSON.stringify({ meta: { split, seeds: [lo, hi], diffs: DIFFS, sweep: SWEEP, node: process.version, wallSeconds: (Date.now() - t00) / 1000 }, rows }, null, 1));
console.log(`wrote ${out}: ${rows.length} rows in ${(Date.now() - t00) / 1000}s`);
