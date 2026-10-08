// Runs every control through the oracle and writes controls/report.json.   node controls/run-controls.mjs [--quick]
// original (the author's YAML on the interpreter) must pass; each mutant of it and each broken control must fail; the T3-only controls
// must pass the ordinary scenarios and fail the probes / the cost cap. Instances: dev seeds 0..19 x difficulties 1,3,5 (+ test seeds 0..4).
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { driveSync } from '../env.mjs';
import { oracle } from '../oracle.mjs';
import { makeOriginal, makeOriginalWholeRunConditions, MUTANTS, makeMutant, ORIGINAL, corpusMatches } from './original.mjs';
import { makeFaithful, makeImproved } from './reference.mjs';
import { BROKEN, T3_ONLY } from './broken.mjs';
import { VERSION, T3_COST } from '../spec.mjs';
import { generate } from '../index.mjs';

const quick = process.argv.includes('--quick');
const instances = [];
for (let seed = 0; seed < (quick ? 4 : 20); seed++) for (const difficulty of [1, 3, 5]) instances.push({ seed, split: 'dev', difficulty });
if (!quick) for (let seed = 0; seed < 5; seed++) instances.push({ seed, split: 'test', difficulty: 3 });

let maxOracleMs = 0, maxGenerateMs = 0;
const timed = (f) => { const t = performance.now(); const r = f(); return [r, performance.now() - t]; };
function judge(variant, make) {
  const per = { runs: 0, pass: 0, failed: {}, cost: [], probesPassed: {}, scoreSum: 0 };
  for (const inst of instances) {
    const [task, gMs] = timed(() => generate({ ...inst, variant }));
    maxGenerateMs = Math.max(maxGenerateMs, gMs);
    const out = make(task);
    const [r, oMs] = timed(() => oracle(task, out));
    maxOracleMs = Math.max(maxOracleMs, oMs);
    per.runs++; per.scoreSum += r.score;
    if (r.pass) per.pass++;
    for (const id of r.details.failed ?? []) per.failed[id] = (per.failed[id] ?? 0) + 1;
    if (r.details.cost) per.cost.push(r.details.cost.selfInflictedWork);
  }
  return { runs: per.runs, pass: per.pass, meanScore: Number((per.scoreSum / per.runs).toFixed(4)), failedScenarios: Object.fromEntries(Object.entries(per.failed).sort()), cost: per.cost.length ? { min: Math.min(...per.cost), max: Math.max(...per.cost) } : undefined };
}
const covers = (res, ids) => ids.every(id => (res.failedScenarios[id] ?? 0) === res.runs);

const coverage = new Set();
const report = {
  schema: 'rbench-controls-report/1', item: ORIGINAL.id, version: VERSION, generatedBy: 'node controls/run-controls.mjs',
  instances: instances.length, instanceSpec: quick ? 'dev seeds 0..3 x d1,3,5' : 'dev seeds 0..19 x d1,3,5 + test seeds 0..4 x d3',
  evidenceStatus: 'development/diagnostic. The original was executed on controls/original-engine.mjs (an interpreter for the YAML subset it uses), NOT on Home Assistant core, which is not installed here. Home Assistant semantics are as documented; nothing was observed on a real instance.',
  originalPinned: { sha256: ORIGINAL.sha256, revision: ORIGINAL.revision, corpusCopyIdentical: corpusMatches() },
};
report.original = {
  T2_core: judge('T2', task => driveSync(task, makeOriginal(coverage))),
  T3_with_probes: judge('T3', task => driveSync(task, makeOriginal())),
  yamlConstructsInterpreted: [...coverage].sort(),
};
report.references = {
  faithful_T1: judge('T1', task => driveSync(task, makeFaithful())),
  faithful_T2: judge('T2', task => driveSync(task, makeFaithful())),
  improved_T3: judge('T3', task => driveSync(task, makeImproved())),
};
report.mutantsOfOriginal = MUTANTS.map(m => { const res = judge('T2', task => driveSync(task, makeMutant(m))); return { name: m.name, describe: m.describe, expectFail: m.expectFail, ...res, rejectedEverywhere: res.pass === 0, expectedFailuresSeenEverywhere: covers(res, m.expectFail) }; });
report.brokenControls = BROKEN.map(b => { const res = judge('T2', task => b.make(task)); return { name: b.name, describe: b.describe, expectFail: b.expectFail, ...res, rejectedEverywhere: res.pass === 0, expectedFailuresSeenEverywhere: covers(res, b.expectFail) }; });
report.t3Controls = T3_ONLY.map(b => {
  const t2 = judge('T2', task => b.make(task)), t3 = judge('T3', task => b.make(task));
  return { name: b.name, describe: b.describe, T2_core: t2, T3: t3, passesCoreRejectedOnT3: t2.pass === t2.runs && t3.pass === 0 };
});
// How much of the oracle rests on the documented reading of "a false condition inside repeat ends only that round"? Run the original under the
// other reading (v0.1.0 of this item: it ends the whole run) and list the scenarios on which the oracle then disagrees.
{ const alt = judge('T2', task => driveSync(task, makeOriginalWholeRunConditions()));
  report.semanticSensitivity = { assumption: 'a false condition inside repeat ends only the current round; inside choose only that option; inside parallel only that branch (documented: home-assistant.io source/_docs/scripts.markdown lines 538-542 and 1504-1506, corpus revision be62035471100102de772b812ac90bf92f786dfc, 2026-10-06; not executed against Home Assistant)',
    alternativeReading: 'a false condition inside a repeat ends the WHOLE run (v0.1.0 of this item, from recall; contradicted by the documentation)', scenariosThatDisagreeUnderTheAlternative: alt.failedScenarios, runs: alt.runs }; }
report.timing = { maxGenerateMs: Number(maxGenerateMs.toFixed(1)), maxOracleMs: Number(maxOracleMs.toFixed(1)), note: 'oracle time includes replaying the whole episode; contract limit is 2 s' };
report.t3CostCap = { ...T3_COST };
writeFileSync(new URL('./report.json', import.meta.url), JSON.stringify(report, null, 1) + '\n');

const o = report.original;
console.log(`instances ${report.instances}; original T2 ${o.T2_core.pass}/${o.T2_core.runs}; original T3 ${o.T3_with_probes.pass}/${o.T3_with_probes.runs} (probes fail: ${Object.keys(o.T3_with_probes.failedScenarios).join(',')})`);
console.log(`faithful T1 ${report.references.faithful_T1.pass}/${report.references.faithful_T1.runs}, T2 ${report.references.faithful_T2.pass}/${report.references.faithful_T2.runs}; improved T3 ${report.references.improved_T3.pass}/${report.references.improved_T3.runs}`);
for (const m of [...report.mutantsOfOriginal, ...report.brokenControls]) if (!m.rejectedEverywhere || !m.expectedFailuresSeenEverywhere) console.log('PROBLEM', m.name, m.pass, m.runs, JSON.stringify(m.failedScenarios));
for (const c of report.t3Controls) console.log('t3 control', c.name, c.passesCoreRejectedOnT3 ? 'ok' : 'PROBLEM', `core ${c.T2_core.pass}/${c.T2_core.runs}, T3 ${c.T3.pass}/${c.T3.runs}`, JSON.stringify(c.T3.cost ?? {}));
console.log(`max generate ${report.timing.maxGenerateMs} ms, max oracle ${report.timing.maxOracleMs} ms`);
