#!/usr/bin/env node
// What the compose loop did (analysis): per arm, how many builds needed a validation repair, a practice-run repair, how often the
// self-review accepted at once or asked for a fix, and how those builds ended. Reads local records.
//   node experiments/ci1-posthoc/loop-stats.mjs <label...>
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const RUNS = process.env.CI1_RUNS ?? '/var/tmp/foundry-work/ci1-20261021/runs';
for (const label of process.argv.slice(2)) {
  const dir = path.join(RUNS, label, 'records');
  if (!existsSync(dir)) { console.log(`${label}: no records`); continue; }
  const recs = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
  const has = (r, kind) => r.repairs.some(x => x.kind === kind);
  const reviewFix = r => r.repairs.filter(x => x.kind === 'review').length;
  const rows = {
    builds: recs.length,
    validationRepair: recs.filter(r => has(r, 'validation')).length,
    practiceRunRepair: recs.filter(r => has(r, 'practice-run')).length,
    reviewAskedFix: recs.filter(r => reviewFix(r) > 0).length,
    reviewFixesTotal: recs.reduce((s, r) => s + reviewFix(r), 0),
    acceptedByReview: recs.filter(r => r.turns.at(-1)?.reviewed === true).length,
    deliveredUnreviewed: recs.filter(r => r.turns.at(-1)?.reviewed === false).length,
    passWhenReviewAskedFix: recs.filter(r => reviewFix(r) > 0 && r.pass).length,
    passWhenPracticeRepaired: recs.filter(r => has(r, 'practice-run') && r.pass).length,
    passWhenValidationRepaired: recs.filter(r => has(r, 'validation') && r.pass).length,
    practiceFailedFinal: recs.filter(r => r.practice.length && r.practice.at(-1).status !== 'succeeded').length,
    meanCalls: Math.round(10 * recs.reduce((s, r) => s + r.cost.calls, 0) / Math.max(1, recs.length)) / 10,
  };
  console.log(`${label}: ${JSON.stringify(rows)}`);
}
