// C0 analysis (frozen with the pre-registration). Per family and pooled: construction outcome, verified success,
// pass^2, execution $/trial, CPS with construction amortised over the evaluation trials, break-even successes against
// the same model solving directly (B0), and family-clustered paired bootstraps: F vs B1 vs B0 within each builder
// model, and Haiku-built vs Opus-built across. Usage: node experiments/c0/analyze.mjs [<runs-dir>]
// Exclusions (PREREG-dev §5): trials and constructions with nestedModelAttempts > 0 are void; environment-faulted trials
// live in *.faults.jsonl (counted here, never scored); costUnknown trials are charged at their bound and counted.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { byArmTask, summarizeArm, pairedBootstrap } from '../lib/stats.mjs';

const dir = process.argv[2] ?? 'experiments/runs/c0-dev';
const read = f => (existsSync(path.join(dir, f)) ? readFileSync(path.join(dir, f), 'utf8').trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const builderOf = arm => arm.split('-').slice(1).join('-');   // F-opus -> opus, B0-haiku -> haiku
const cons = read('constructions.jsonl'), consFaults = read('construction-faults.jsonl');
const voidCons = new Set(cons.filter(c => c.nestedModelAttempts > 0).map(c => `${c.armId}|${c.familyId}`));
const isVoid = r => (r.meta?.nestedModelAttempts ?? 0) > 0 || voidCons.has(`${r.arm}|${r.family}`);
const allRecs = read('results.jsonl'), recs = allRecs.filter(r => !isVoid(r)), voided = allRecs.filter(isVoid);
const faults = read('results.faults.jsonl'), probes = read('probes.jsonl'), probeFaults = read('probes.faults.jsonl');
// A voided construction's cost leaves the analysis with its trials (it is reported in the constructions table).
const consCost = (armId, fam) => cons.filter(c => c.armId === armId && c.familyId === fam && !voidCons.has(`${c.armId}|${c.familyId}`)).reduce((s, c) => s + (c.constructionCostUsd ?? 0), 0);
const families = [...new Set([...recs.map(r => r.family), ...cons.map(c => c.familyId)])];

// Construction success (PREREG §3): an artifact was delivered and it answered every probe without a harness fault
// (no error, an output to score).
const probeOk = r => r.error == null && !String(r.oracleDetails ?? '').includes('"noOutput":true');
console.log('## Constructions\n\n| family | arm | builder (effort) | artifact | success | probes passed | construction $ | builder $ | gateway $ (cap) | refusals | minutes | score checks | first pass at | nested | void |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const c of cons) {
  const ps = probes.filter(r => r.arm === c.armId && r.family === c.familyId);
  const success = !!c.artifact && ps.length > 0 && ps.every(probeOk);
  const refusals = Object.entries(c.gatewayRefusals ?? {}).map(([k, v]) => `${k}:${v}`).join(' ') || '-';
  console.log(`| ${c.familyId} | ${c.armId} | ${c.builderModel} (${c.builderEffort ?? '?'}) | ${c.artifact ?? 'NONE'} | ${success ? 'yes' : 'no'} | ${ps.filter(r => r.pass).length}/${ps.length} | ${fmt(c.constructionCostUsd, 2)} | ${fmt(c.builderCostUsd, 2)}${c.builderCostUnknown ? ' (bound)' : ''} | ${fmt(c.gatewayCostUsd, 2)} (${c.gatewayCapUsd ?? '-'}) | ${refusals} | ${fmt(c.durationMs / 60000, 1)} | ${c.scoreLog?.length ?? 0} | ${c.firstPassAtCheck ?? '-'} | ${c.nestedModelAttempts ?? '-'} | ${voidCons.has(`${c.armId}|${c.familyId}`) ? 'VOID' : ''} |`);
}
if (consFaults.length) console.log(`\nConstruction environment faults (retried on resume, not outcomes): ${consFaults.length} (${consFaults.map(f => `${f.label ?? `${f.arm}-${f.builder}-${f.familyId}`}:${f.builderError?.code ?? f.error?.code}`).join(', ')})`);
if (probeFaults.length) console.log(`Probe-run environment faults: ${probeFaults.length}`);

console.log('\n## Execution\n\nCPS = all dollars / verified successes; "amortised" includes the construction. Break-even: the number of verified successes after which the construction is repaid against the same model solving directly (B0 of that builder model), "never" if not cheaper per success.\n');
console.log('| family | arm | success | rate | pass^2 | exec $/trial | construction $ | CPS exec | CPS amortised | break-even successes vs B0 | NO_ARTIFACT | env faults (retried) | costUnknown | void |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const fam of [...families, 'ALL']) {
  const inFam = r => fam === 'ALL' || r.family === fam;
  const sub = recs.filter(inFam);
  const byArm = byArmTask(sub);
  for (const [arm, tasks] of [...byArm].sort(([a], [b]) => a.localeCompare(b))) {
    const cc = fam === 'ALL' ? families.reduce((s, f) => s + consCost(arm, f), 0) : consCost(arm, fam);
    const s = summarizeArm(tasks, { k: 2, extraCostUsd: cc }), e = summarizeArm(tasks, { k: 2 });
    const b0Tasks = byArm.get(`B0-${builderOf(arm)}`), b0 = b0Tasks ? summarizeArm(b0Tasks, { k: 2 }) : null;
    let be = '-';
    if (!arm.startsWith('B0-') && b0 && cc > 0 && e.successes > 0 && b0.successes > 0) {
      const perSuccExec = e.costUsd / e.successes, perSuccB0 = b0.costUsd / b0.successes;
      be = perSuccB0 > perSuccExec ? fmt(cc / (perSuccB0 - perSuccExec), 1) : 'never';
    }
    const armRecs = sub.filter(r => r.arm === arm);
    const noArt = armRecs.filter(r => r.error?.code === 'NO_ARTIFACT').length, unk = armRecs.filter(r => r.costUnknown).length;
    const flt = faults.filter(r => r.arm === arm && inFam(r)).length, vd = voided.filter(r => r.arm === arm && inFam(r)).length;
    console.log(`| ${fam} | ${arm} | ${s.successes}/${s.trials} | ${fmt(s.successRate)} | ${fmt(s.passHat2)} | ${fmt(e.costUsd / e.trials, 4)} | ${fmt(cc, 2)} | ${fmt(e.cps, 4)} | ${fmt(s.cps, 4)} | ${be} | ${noArt} | ${flt} | ${unk} | ${vd} |`);
  }
}

const arms = new Set(recs.map(r => r.arm));
const builders = [...new Set([...arms].map(builderOf))].sort();
const constructionUsd = Object.fromEntries([...arms].map(a => [a, Object.fromEntries(families.map(f => [f, consCost(a, f)]))]));
const pairs = [
  ...builders.flatMap(b => [[`F-${b}`, `B1-${b}`], [`F-${b}`, `B0-${b}`], [`B1-${b}`, `B0-${b}`]]),
  ['F-haiku', 'F-opus'], ['B1-haiku', 'B1-opus'], ['F-haiku', 'B0-opus'],
];
console.log('\n## Paired comparisons (family-clustered bootstrap, 10000 resamples)\n\nCPS ratio < 1 favours A. "finite" counts resamples in which both arms had a success.\n');
console.log('| A | B | tasks | success diff [95% CI] | CPS ratio, execution only [95% CI] (finite) | CPS ratio, incl. construction [95% CI] (finite) |\n|---|---|---|---|---|---|');
for (const [a, b] of pairs) {
  if (!arms.has(a) || !arms.has(b)) continue;
  const ex = pairedBootstrap(recs, a, b, { iterations: 10000 });
  const wc = pairedBootstrap(recs, a, b, { iterations: 10000, constructionUsd });
  console.log(`| ${a} | ${b} | ${ex.tasks} | ${fmt(ex.successDiff.point)} [${fmt(ex.successDiff.lo)}, ${fmt(ex.successDiff.hi)}] | ${fmt(ex.cpsRatio.point)} [${fmt(ex.cpsRatio.lo)}, ${fmt(ex.cpsRatio.hi)}] (${ex.cpsRatio.finiteResamples}) | ${fmt(wc.cpsRatio.point)} [${fmt(wc.cpsRatio.lo)}, ${fmt(wc.cpsRatio.hi)}] (${wc.cpsRatio.finiteResamples}) |`);
}
if (voided.length) console.log(`\nVoided trials (nested model use or a voided construction): ${voided.length}`);
