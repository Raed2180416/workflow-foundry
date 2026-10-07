// Phase 1 analysis (frozen with the pre-registration). Reads results JSONL files, prints per-arm and
// per-difficulty summaries and the pre-registered paired comparisons.
// Usage: node experiments/p1/analyze.mjs experiments/runs/p1/results-hosted.jsonl [more.jsonl]
import { readFileSync } from 'node:fs';
import { byArmTask, summarizeArm, pairedBootstrap, mcnemar } from '../lib/stats.mjs';

const recs = process.argv.slice(2).flatMap(f => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse));
const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const rows = [];
for (const [arm, tasks] of byArmTask(recs)) {
  for (const d of ['all', 'd2', 'd3']) {
    const sub = new Map([...tasks].filter(([k]) => d === 'all' || k.includes(`:${d}:`)));
    if (!sub.size) continue;
    const s = summarizeArm(sub, { k: 3 });
    const trials = [...sub.values()].flatMap(t => t.trials);
    const meanScore = trials.reduce((a, r) => a + (r.score ?? 0), 0) / trials.length;
    const errors = trials.filter(r => r.error).length;
    const imputed = trials.reduce((a, r) => a + (r.imputedUsd ?? 0), 0);
    rows.push({ arm, d, tasks: s.tasks, trials: s.trials, success: `${s.successes}/${s.trials}`, rate: fmt(s.successRate), ci: `[${fmt(s.ci.lo, 2)},${fmt(s.ci.hi, 2)}]`, passHat3: fmt(s.passHat3), meanScore: fmt(meanScore), costUsd: fmt(s.costUsd, 2), cps: fmt(s.cps, 4), costPerTrial: fmt(s.costPerTrial, 4), imputedUsd: fmt(imputed, 4), errors });
  }
}
console.log('| arm | d | tasks | trials | success | rate | 95% CI | pass^3 | mean score | $ total | CPS | $/trial | imputed $ | errors |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.arm} | ${r.d} | ${r.tasks} | ${r.trials} | ${r.success} | ${r.rate} | ${r.ci} | ${r.passHat3} | ${r.meanScore} | ${r.costUsd} | ${r.cps} | ${r.costPerTrial} | ${r.imputedUsd} | ${r.errors} |`);
const PAIRS = [['fhand-haiku', 'b0call-haiku-med'], ['fhand-haiku', 'b0call-haiku-none'], ['fhand-haiku', 'b0ncall-haiku-med'], ['fhand-haiku', 'b0agent-haiku'], ['fhand-haiku', 'b0call-sonnet-med'], ['fhand-sonnet', 'b0call-sonnet-med']];
const arms = new Set(recs.map(r => r.arm));
console.log('\n| A | B | tasks | success diff A−B [95% CI] | CPS ratio A/B [95% CI] | McNemar p |');
console.log('|---|---|---|---|---|---|');
for (const [a, b] of PAIRS) {
  if (!arms.has(a) || !arms.has(b)) continue;
  // Family clustering is not applicable (one family); difficulty level is used as the cluster.
  const clustered = recs.filter(r => r.arm === a || r.arm === b).map(r => ({ ...r, family: r.taskKey.split(':')[2] }));
  const bs = pairedBootstrap(clustered, a, b, { iterations: 10000 });
  const m = mcnemar(recs, a, b);
  console.log(`| ${a} | ${b} | ${bs.tasks} | ${fmt(bs.successDiff.point)} [${fmt(bs.successDiff.lo)}, ${fmt(bs.successDiff.hi)}] | ${fmt(bs.cpsRatio.point)} [${fmt(bs.cpsRatio.lo)}, ${fmt(bs.cpsRatio.hi)}] | ${fmt(m.p)} |`);
}
