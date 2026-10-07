// C0 analysis (frozen with the pre-registration). Per family and pooled: construction outcome, verified
// success, pass^2, execution $/trial, CPS with construction amortised over the evaluation trials, and
// break-even vs B0-opus. Usage: node experiments/c0/analyze.mjs <runs-dir>
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { byArmTask, summarizeArm, pairedBootstrap } from '../lib/stats.mjs';

const dir = process.argv[2] ?? 'experiments/runs/c0-dev';
const read = f => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []);
const recs = read(path.join(dir, 'results.jsonl')), cons = read(path.join(dir, 'constructions.jsonl'));
const consCost = (arm, fam) => cons.filter(c => c.arm === arm && c.familyId === fam).reduce((s, c) => s + (c.constructionCostUsd ?? 0), 0);
const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
console.log('## Constructions\n\n| family | arm | artifact | construction $ | builder $ | gateway $ | minutes | score checks | first pass at check |\n|---|---|---|---|---|---|---|---|---|');
for (const c of cons) console.log(`| ${c.familyId} | ${c.arm} | ${c.artifact ?? 'none'} | ${fmt(c.constructionCostUsd, 2)} | ${fmt(c.builderCostUsd, 2)} | ${fmt(c.gatewayCostUsd, 2)} | ${fmt(c.durationMs / 60000, 1)} | ${c.scoreLog?.length ?? 0} | ${c.firstPassAtCheck ?? '-'} |`);
const families = [...new Set(recs.map(r => r.family))];
console.log('\n## Execution\n\n| family | arm | success | rate | pass^2 | exec $/trial | construction $ | CPS (amortised) | break-even tasks vs B0-opus |\n|---|---|---|---|---|---|---|---|---|');
for (const fam of [...families, 'ALL']) {
  const sub = recs.filter(r => fam === 'ALL' || r.family === fam);
  const byArm = byArmTask(sub);
  const b0 = byArm.get('B0-opus') ? summarizeArm(byArm.get('B0-opus'), { k: 2 }) : null;
  for (const [arm, tasks] of byArm) {
    const cc = fam === 'ALL' ? families.reduce((s, f) => s + consCost(arm, f), 0) : consCost(arm, fam);
    const s = summarizeArm(tasks, { k: 2, extraCostUsd: cc });
    const exec = s.costUsd - cc;
    // break-even: construction is repaid when per-task savings vs B0-opus cover it (per successful task)
    let be = '-';
    if (b0 && cc > 0 && s.successes > 0 && b0.successes > 0) {
      const perSuccExec = exec / s.successes, perSuccB0 = b0.costUsd / b0.successes;
      be = perSuccB0 > perSuccExec ? fmt(cc / (perSuccB0 - perSuccExec), 1) : 'never';
    }
    console.log(`| ${fam} | ${arm} | ${s.successes}/${s.trials} | ${fmt(s.successRate)} | ${fmt(s.passHat2)} | ${fmt(exec / s.trials, 4)} | ${fmt(cc, 2)} | ${fmt(s.cps, 4)} | ${be} |`);
  }
}
const arms = new Set(recs.map(r => r.arm));
console.log('\n## Paired comparisons (family-clustered bootstrap; execution cost only)\n\n| A | B | tasks | success diff [95% CI] | CPS ratio [95% CI] |\n|---|---|---|---|---|');
for (const [a, b] of [['F', 'B1'], ['F', 'B0-opus'], ['F', 'B0-haiku'], ['B1', 'B0-opus']]) {
  if (!arms.has(a) || !arms.has(b)) continue;
  const bs = pairedBootstrap(recs, a, b, { iterations: 10000 });
  console.log(`| ${a} | ${b} | ${bs.tasks} | ${fmt(bs.successDiff.point)} [${fmt(bs.successDiff.lo)}, ${fmt(bs.successDiff.hi)}] | ${fmt(bs.cpsRatio.point)} [${fmt(bs.cpsRatio.lo)}, ${fmt(bs.cpsRatio.hi)}] |`);
}
