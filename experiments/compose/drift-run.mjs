// Validate a drift variant (HARNESS.md §4.4) and, given programs, measure a rebuild or patch under it. $0.
//   node experiments/compose/drift-run.mjs [--drift review-timeout-clears] [--worlds 1165:2:30,1166:3:30] [--out <json>]
//        [--subject program:<dir> | solver:<file>]                    an arm under the drift (the drifted spec is served)
//        [--before <program dir> --after <program dir>]               patch locality of a rebuild/patch (no run)
// Checks: the drifted reference policy passes the drifted oracle and the drifted contracts (self-consistency); the stale
// (pre-drift) reference fails exactly the cases the drift changed, under both; any subject is judged on every signal.
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { runReference } from '../../beds/ebed/oracle/policy.mjs';
import { gradeStream } from '../../beds/ebed/oracle/grade.mjs';
import { sandboxArm } from '../../beds/ebed/host/sandbox-arm.mjs';
import { DRIFTS, driftedItem, driftedBinding, driftWorld, patchLocality } from './drift.mjs';
import { evaluateCapabilities } from './capabilities.mjs';
import { poolsFor, assess, brief, runArm } from './run.mjs';
import { subjectOf } from './fault-run.mjs';
import { readProgram } from './bundle.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DEV = s => (s >= 1001 && s <= 1199) || (s >= 1232 && s <= 1234);

export async function driftRun({ drift = 'review-timeout-clears', worlds, subject = null, log = console.log }) {
  const D = DRIFTS[drift];
  const dir = mkdtempSync(path.join(os.tmpdir(), 'compose-drift-'));
  const out = { drift, rule: D.rule, capability: D.capability, date: new Date().toISOString().slice(0, 10), evidence: 'development (dev worlds); $0', worlds: [] };
  try {
    const item = await driftedItem(drift, dir);
    const B = driftedBinding(drift);
    for (const w of worlds) {
      if (!DEV(w.seed)) throw new Error(`seed ${w.seed}: dev seeds only`);
      const { world, converted } = driftWorld(e8.generateWorld({ seed: w.seed, difficulty: w.d, mix: 'tail', size: w.size }), drift);
      const { pools } = await poolsFor(world, { item, binding: B });
      const row = { ...w, converted, drifted: {}, stale: {} };
      for (const timing of ['earliest', 'latest']) {
        const r = await runReference({ item, binding: B, world, timing });
        const a = assess({ world, rows: r.rows, pools, item, rules: D.rules });
        row.drifted[timing] = { oracle: `${a.oracle.passed}/${a.oracle.completed}`, capabilities: `${a.capabilities.passed}/${a.capabilities.completed}` };
      }
      const s = await runReference({ item: e8.oracleItem, binding: B, world, timing: 'earliest' });
      const v = gradeStream({ item, world, rows: s.rows, pools });
      const caps = evaluateCapabilities(world, s.rows, { pools, rules: D.rules, canonicalArgs: item.canonicalArgs });
      row.stale = { oracleFails: v.cases.filter(c => c.pool === 'completed' && !c.pass).map(c => c.case).sort(),
        contractFails: caps.cases.filter(c => c.pool === 'completed' && !c.pass).map(c => ({ case: c.case, failed: c.failed })) };
      row.stale.exactlyTheChangedCases = JSON.stringify(row.stale.oracleFails) === JSON.stringify([...converted].sort()) && JSON.stringify(row.stale.contractFails.map(c => c.case)) === JSON.stringify([...converted].sort());
      if (subject) {
        const arm = subject.source ? sandboxArm({ id: subject.label.slice(0, 60), solverSource: subject.source, timeoutMs: 20_000 }) : null;
        try {
          const r = await runArm({ world, arm, binding: B, callTimeoutMs: 25_000 });
          const a = assess({ world, rows: r.rows, pools, item, rules: D.rules, manifest: subject.manifest });
          row.subject = { label: subject.label, oracle: `${a.oracle.passed}/${a.oracle.completed}`, capabilities: a.capabilities.byCapability, changedCasesPass: converted.filter(c => !a.oracle.failing.some(f => f.case === c)).length, interface: a.interface?.violations ?? null };
          log(`  subject ${brief(a)}`);
        } finally { arm?.close(); }
      }
      out.worlds.push(row);
      log(`${w.seed} d${w.d}: drifted reference ${JSON.stringify(row.drifted)}; stale reference fails ${JSON.stringify(row.stale.oracleFails)} (converted ${JSON.stringify(converted)}, exactly ${row.stale.exactlyTheChangedCases})`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const drift = arg('--drift', 'review-timeout-clears');
  let res;
  if (arg('--before', null)) res = { drift, locality: patchLocality(readProgram(arg('--before')), readProgram(arg('--after')), { rule: DRIFTS[drift].rule }) };
  else {
    const worlds = arg('--worlds', '1165:2:30,1166:3:30').split(',').map(s => { const [seed, d, size] = s.split(':').map(Number); return { seed, d, size }; });
    const subj = arg('--subject', null);
    res = await driftRun({ drift, worlds, subject: subj ? subjectOf(subj) : null });
  }
  console.log(JSON.stringify(res.locality ?? { worlds: res.worlds.length }, null, 1));
  const o = arg('--out', null);
  if (o) { mkdirSync(path.dirname(o), { recursive: true }); writeFileSync(o, JSON.stringify(res, null, 1)); }
}
