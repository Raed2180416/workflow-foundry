#!/usr/bin/env node
// P1 failure anatomy (descriptive, after the look-2 analysis; research/automationbench-20261014/P1-RESULT-HEADLINE.md).
// Reads grade summaries only: pass flags, assertion types and counts, and v2's own termination category, from the repo
// copies of the look-2 arms and VL-1's per-task pass vectors. No task text, no transcripts, no model. $0.
//   node experiments/autobench/replay/p1-anatomy.mjs [--json]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const R = path.join(fileURLToPath(new URL('../../../', import.meta.url)), 'research/automationbench-20261014/runs');
const rows = d => readFileSync(path.join(R, d, 'results.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const pv = JSON.parse(readFileSync(path.join(R, 'vl1-look2/pass-vectors.json'), 'utf8'));
const pass = {};
for (const t of pv.perTask) pass[t.task] = Object.fromEntries(Object.entries(t.forks).map(([k, v]) => [k, v.pass ? 1 : 0]));
for (const [arm, dir] of [['v1', 'a1c-v1-look2'], ['v2', 'a1c-v2-look2']]) for (const r of rows(dir)) pass[r.task][arm] = r.final.task_completed_correctly ? 1 : 0;

const fails = rows('a1c-v2-look2').filter(r => !r.final.task_completed_correctly);
const OTHERS = ['opus', 'sonnet-a1', 'v1', 'v1m', 'v2m', 'haiku-a0'];
const kind = t => /not_/.test(t) ? 'forbidden' : /contains|has_note|with_fields/.test(t) ? 'content' : 'missing-effect';
const byCategory = {};
for (const r of fails) {
  const c = r.forks[0].pipeline.termination.category, o = pass[r.task];
  const x = byCategory[c] ??= { failures: 0, solvedByAnyOther: 0, ...Object.fromEntries(OTHERS.map(k => [k, 0])), kinds: {} };
  x.failures += 1;
  x.solvedByAnyOther += OTHERS.some(k => o[k]) ? 1 : 0;
  for (const k of OTHERS) x[k] += o[k] ?? 0;
  const ks = [...new Set((r.final.failed_types ?? []).map(kind))].sort().join('+');
  x.kinds[ks] = (x.kinds[ks] ?? 0) + 1;
}
const has = re => fails.filter(r => (r.final.failed_types ?? []).some(t => re.test(t))).length;
const domain = {};
for (const r of fails) domain[r.domain] = (domain[r.domain] ?? 0) + 1;
const out = {
  failures: fails.length,
  byCategory,
  failedByEveryArm: fails.filter(r => !OTHERS.some(k => pass[r.task][k])).length,
  tasksSolvedByAnyArm: Object.values(pass).filter(o => Object.values(o).some(Boolean)).length,
  oneAssertionMisses: fails.filter(r => r.final.n_scored - r.final.n_passed === 1).length,
  partialCreditAtLeast08: fails.filter(r => r.final.partial_credit >= 0.8).length,
  meanPartialCredit: +(fails.reduce((a, r) => a + r.final.partial_credit, 0) / fails.length).toFixed(3),
  byDomain: domain,
  assertionFamilies: {
    gmailSentToWithBodyContains: has(/^gmail_message_sent_to_with_body_contains$/),
    slackMustExistOrBeInChannel: has(/^slack_message_(exists|in_channel|sent_to_channel)$/),
    mustNot: has(/not_/),
  },
};
if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 1));
else { console.table(Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, { ...v, kinds: JSON.stringify(v.kinds) }]))); const { byCategory: _, ...rest } = out; console.log(rest); }
