// E7 world health ($0, no model calls; DESIGN §18 step 1: "health of the world alone", before the oracle exists). Per
// difficulty over a seed range: case and class counts, tail share, fallbacks (class plans the generator could not place
// and replaced by a straight report), the generator's timing self-check (DESIGN §4.9), the censoring proxy (planned
// closures inside the horizon by epoch, DESIGN §4.8) and, with --walk, a run of the rule-following walker arm through the
// real host (suppressed guarded steps, arm errors, failed effects, planned vs scheduled counterparty steps).
//   node beds/ebed/e7/tools/world-health.mjs [--seeds 1001-1010] [--difficulties 2,3,4,5] [--mix tail] [--scale base] [--walk]
//   node beds/ebed/e7/tools/world-health.mjs --seed 1001 --difficulty 3 --case i0042      # one case's planned timeline
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { generateWorld, timingProblems } from '../world.mjs';
import { systems } from '../systems.mjs';
import { actors } from '../actors.mjs';
import { walkerArm } from './walker.mjs';
import { createHost } from '../../host/host.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const here = path.dirname(fileURLToPath(import.meta.url));

if (arg('--case', null)) {
  const w = generateWorld({ seed: Number(arg('--seed', '1001')), difficulty: Number(arg('--difficulty', '3')), mix: arg('--mix', 'tail') });
  const c = arg('--case');
  const t = w.truth.cases[c];
  if (!t) { console.error(`no case ${c}`); process.exit(1); }
  const { steps = [], ...rest } = t;
  console.log(JSON.stringify(rest, null, 1));
  for (const s of steps) console.log(`  step k${s.k} ${s.at} ${s.action.padEnd(10)} guard ${s.guard.join('|').padEnd(10)} ${JSON.stringify({ ...s.payload, number: undefined, action: undefined })}`);
  for (const e of w.arrivals.filter(x => w.truth.eventCase[x.id] === c)) console.log(`  arrival ${e.at} ${e.type} ${JSON.stringify(e.payload)}`);
  process.exit(0);
}

const [s0, s1] = arg('--seeds', '1001-1010').split('-').map(Number);
const diffs = arg('--difficulties', '2,3,4,5').split(',').map(Number);
const mix = arg('--mix', 'tail'), scale = arg('--scale', 'base');
const walk = process.argv.includes('--walk');
const ANSWER = { type: 'object', required: ['decision'], additionalProperties: false, properties: { decision: { enum: ['approve', 'reject'] } } };
const binding = { id: 'ebed-e7', family: { id: 'ebed-e7', item: 'E7', profile: 'bare', sweeps: [], subject: { object: 'incident', key: 'number' } }, systems, actors,
  specE: readFileSync(path.join(here, '..', 'spec', 'SPEC-E.md'), 'utf8'),
  schemas: { decisions: { type: 'object', properties: {}, additionalProperties: true }, humanTasks: { majorIncidentApproval: { description: 'approve or reject a major incident', answerSchema: ANSWER } } } };

for (const d of diffs) {
  const agg = { worlds: 0, cases: 0, tail: 0, arrivals: 0, fallbacks: 0, timing: 0, ms: 0, classes: {}, epochs: {}, walk: { suppressed: 0, armErrors: 0, failed: 0, mismatch: 0, ms: 0 } };
  for (let seed = s0; seed <= (s1 ?? s0); seed++) {
    const t = Date.now();
    const w = generateWorld({ seed, difficulty: d, mix, scale });
    agg.ms += Date.now() - t;
    agg.worlds += 1;
    agg.arrivals += w.arrivals.length;
    agg.fallbacks += w.truth.fallbacks.length;
    const problems = timingProblems(w);
    agg.timing += problems.length;
    for (const p of problems.slice(0, 3)) console.log(`  TIMING seed ${seed} d${d}: ${p}`);
    for (const tc of Object.values(w.truth.cases)) {
      agg.cases += 1; if (tc.tail) agg.tail += 1;
      agg.classes[tc.class] = (agg.classes[tc.class] ?? 0) + 1;
      const e = (agg.epochs[tc.epoch] ??= { cases: 0, done: 0 });
      e.cases += 1; if (Date.parse(tc.plannedEnd) <= Date.parse(w.horizonEnd)) e.done += 1;
    }
    if (walk) {
      const t1 = Date.now();
      const host = createHost({ item: binding, world: w, arm: walkerArm() });
      await host.run();
      agg.walk.ms += Date.now() - t1;
      const rows = host.journal.contentRows();
      agg.walk.suppressed += rows.filter(r => r.type === 'counterparty.suppressed').length;
      agg.walk.armErrors += rows.filter(r => r.type === 'arm.error').length;
      agg.walk.failed += rows.filter(r => r.type === 'ledger' && !r.committed && !r.injected).length;
      const scheduled = {};
      for (const r of rows.filter(x => x.type === 'counterparty.step')) scheduled[r.case] = (scheduled[r.case] ?? 0) + 1;
      for (const [c, tc] of Object.entries(w.truth.cases)) {
        if (!tc.subject || tc.backlog || Date.parse(tc.plannedEnd) > Date.parse(w.horizonEnd)) continue;     // censored at the horizon
        if ((scheduled[c] ?? 0) !== tc.steps.length + (tc.caller.reply?.via ? 1 : 0) + (tc.caller.confirm?.via ? 1 : 0)) agg.walk.mismatch += 1;
      }
    }
  }
  const epochs = Object.entries(agg.epochs).sort().map(([k, v]) => `${k} ${v.done}/${v.cases} (${(100 * v.done / v.cases).toFixed(1)}%)`).join(', ');
  console.log(`d${d}: worlds ${agg.worlds}, cases ${agg.cases} (tail ${(100 * agg.tail / agg.cases).toFixed(1)}%), arrivals ${agg.arrivals}, fallbacks ${agg.fallbacks}, timing problems ${agg.timing}, ${(agg.ms / agg.worlds).toFixed(0)} ms/world`);
  console.log(`   planned closures inside the horizon: ${epochs}`);
  console.log(`   classes: ${Object.entries(agg.classes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (walk) console.log(`   walker: suppressed steps ${agg.walk.suppressed}, arm errors ${agg.walk.armErrors}, failed effects ${agg.walk.failed}, cases with planned != scheduled ${agg.walk.mismatch}, ${(agg.walk.ms / agg.worlds / 1000).toFixed(2)} s/world`);
}
