#!/usr/bin/env node
// GQA-1 cost-matched restart baseline ($0, POST HOC; review finding M3). H1 compares one workflow run ($0.067) with one
// agent run ($0.004): it is a structure comparison, not a cost-matched one. The cheapest fair counter-baseline is "restart
// the cheap agent until it has spent what the other arm spends, and take the union of the bugs found": for an arm whose
// runs found the bug sets S_1..S_n at costs c_1..c_n, the expected union of k restarts is the mean of |S_i1 u ... u S_ik|
// over all k-subsets (exact), at the mean cost of k runs. This script reads the report-log re-score
// (rescore-union.mjs output, so a bug the agent listed and later dropped still counts) and prints, per agent arm and
// per k, the expected union and its cost, plus the k that matches a target spend.
//   node experiments/gameqa-web/cost-matched.mjs analysis/report-log-rescore.json analysis/analyze.json > analysis/cost-matched.json
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Exact mean size of the union of k sets drawn without replacement from `sets` (arrays of ids), and the number of subsets. */
export function expectedUnion(sets, k) {
  const n = sets.length;
  if (k < 1 || k > n) return { mean: null, subsets: 0 };
  let total = 0, count = 0;
  const pick = (start, acc) => {
    if (acc.length === k) { const u = new Set(acc.flatMap(i => sets[i])); total += u.size; count++; return; }
    for (let i = start; i <= n - (k - acc.length); i++) pick(i + 1, [...acc, i]);
  };
  pick(0, []);
  return { mean: total / count, subsets: count };
}

/** Per k = 1..n: expected union (bugs) and mean cost of k runs. `runs`: [{bugs: [...ids], usd}]. */
export function restartCurve(runs) {
  const sets = runs.map(r => r.bugs), meanCost = runs.reduce((s, r) => s + r.usd, 0) / runs.length;
  return runs.map((_, i) => { const k = i + 1, e = expectedUnion(sets, k); return { k, expectedBugs: Math.round(e.mean * 1000) / 1000, usd: Math.round(k * meanCost * 1e5) / 1e5, subsets: e.subsets }; });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [rescoreFile, analyzeFile] = process.argv.slice(2);
  if (!rescoreFile || !analyzeFile) { console.error('usage: cost-matched.mjs REPORT_LOG_RESCORE.json ANALYZE.json'); process.exit(2); }
  const rescore = JSON.parse(readFileSync(rescoreFile, 'utf8')), analysis = JSON.parse(readFileSync(analyzeFile, 'utf8'));
  const group = run => `${run.run.slice(0, run.run.indexOf(`-${run.arm}-r`))}/${run.arm}`;
  const groups = {};
  for (const r of rescore.runs) (groups[group(r)] ??= []).push(r);
  // pooled: the two plain agent series (same arm and prompt; S2 showed the budget line changes neither the count nor the stop)
  const plain = Object.entries(groups).filter(([k]) => k.endsWith('/agent')).flatMap(([, v]) => v);
  if (plain.length) groups['all plain agent runs'] = plain;
  const targets = Object.fromEntries(Object.entries(analysis.arms).filter(([k]) => /workflow/.test(k)).map(([k, v]) => [k, { usdPerRun: Math.round((v.usdTotal / v.n) * 1e5) / 1e5, foundMinMean: v.foundMinMean }]));
  const out = { note: 'POST HOC (review finding M3). Expected union of bugs over k restarts of an agent arm (exact over all k-subsets of its runs), scored on every report the agent ever listed (rescore-union.mjs), against the per-run spend of the workflow arms. A restart curve that stops below a target spend cannot reach that spend with the runs we have.', targets, curves: {} };
  for (const [k, runs] of Object.entries(groups)) {
    for (const metric of ['final', 'ever']) {
      const curve = restartCurve(runs.map(r => ({ bugs: r[metric].bugs, usd: r.usd })));
      const atTarget = Object.fromEntries(Object.entries(targets).map(([t, v]) => {
        const reach = curve.find(c => c.usd >= v.usdPerRun);
        return [t, reach ? { k: reach.k, usd: reach.usd, expectedBugs: reach.expectedBugs, gap: Math.round((v.foundMinMean - reach.expectedBugs) * 1000) / 1000 } : { reachable: false, maxUsd: curve.at(-1).usd, expectedBugsAtMax: curve.at(-1).expectedBugs, gapAtMax: Math.round((v.foundMinMean - curve.at(-1).expectedBugs) * 1000) / 1000 }];
      }));
      out.curves[`${k} (${metric} lists)`] = { n: runs.length, curve, atTarget };
    }
  }
  console.log(JSON.stringify(out, null, 1));
}
