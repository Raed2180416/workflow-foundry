#!/usr/bin/env node
// GQA-1 cost-matched restart report ($0, POST HOC; review finding M3). Same restart curve as cost-matched.mjs (imported, so
// the frozen script stays byte-identical), with two additions decided after the A2 runs and recorded in RESULT-GQA-1 §6.5:
//   - a workflow-random target also carries the cost of the construction it borrows from its paired workflow run (the
//     construct and construct-repair calls): a stand-alone random-exploration pipeline has to pay for it, while
//     analyze.mjs counts only its judge calls;
//   - the pooled group of every frozen-prompt Haiku agent run (gqa1, gqa1nb, gqa1v), and the live matched agent's per-run
//     numbers for comparison.
//   node experiments/gameqa-web/cost-matched-report.mjs analysis/report-log-rescore.json analysis/analyze.json RUNS_DIR > analysis/cost-matched.json
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { restartCurve } from './cost-matched.mjs';

/** USD of the construct (and construct-repair) calls of `${tag}-workflow-r${rep}` in runsDir. */
export function constructionUsd(runsDir, tag, rep) {
  const f = path.join(runsDir, `${tag}-workflow-r${rep}`, 'calls.jsonl');
  if (!existsSync(f)) return 0;
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    .filter(r => typeof r.ok === 'boolean' && String(r.nodeKey).startsWith('construct')).reduce((a, r) => a + (r.costUsd ?? 0), 0);
}
const r5 = x => Math.round(x * 1e5) / 1e5, r3 = x => Math.round(x * 1000) / 1000;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [rescoreFile, analyzeFile, runsDir] = process.argv.slice(2);
  if (!rescoreFile || !analyzeFile || !runsDir) { console.error('usage: cost-matched-report.mjs REPORT_LOG_RESCORE.json ANALYZE.json RUNS_DIR'); process.exit(2); }
  const rescore = JSON.parse(readFileSync(rescoreFile, 'utf8')), analysis = JSON.parse(readFileSync(analyzeFile, 'utf8'));
  const targets = {};
  for (const [k, v] of Object.entries(analysis.arms)) {
    if (!/workflow/.test(v.arm) || v.model !== 'claude-haiku-5-5') continue;
    const borrowed = v.arm === 'workflow-random' ? v.reps.reduce((a, r) => a + constructionUsd(runsDir, v.tag, r), 0) / v.n : 0;
    targets[k] = { usdPerRun: r5(v.usdTotal / v.n + borrowed), ...(borrowed ? { judgeOnlyUsdPerRun: r5(v.usdTotal / v.n), borrowedConstructionUsdPerRun: r5(borrowed) } : {}), foundMinMean: v.foundMinMean };
  }
  const plain = rescore.runs.filter(r => r.arm === 'agent' && /^gqa1(nb|v)?-agent-r\d+$/.test(r.run));
  const out = { note: 'POST HOC (review finding M3). Expected distinct bugs over k restarts of the frozen-prompt Haiku agent (all its runs pooled: gqa1, gqa1nb, gqa1v; S2/S2v show the budget line changes nothing), exact over all k-subsets, on every report ever listed, against the per-run spend of each Haiku workflow arm (workflow-random including the construction it borrows). The live cost-matched answer is gqa2/agent-matched.', targets, groups: {} };
  for (const metric of ['final', 'ever']) {
    const curve = restartCurve(plain.map(r => ({ bugs: r[metric].bugs, usd: r.usd })));
    const atTarget = Object.fromEntries(Object.entries(targets).map(([t, v]) => {
      const reach = curve.find(c => c.usd >= v.usdPerRun);
      return [t, reach ? { k: reach.k, usd: reach.usd, expectedBugs: reach.expectedBugs, gap: r3(v.foundMinMean - reach.expectedBugs) }
        : { reachable: false, maxUsd: curve.at(-1).usd, expectedBugsAtMax: curve.at(-1).expectedBugs, gapAtMax: r3(v.foundMinMean - curve.at(-1).expectedBugs) }];
    }));
    out.groups[`frozen-prompt Haiku agent, ${plain.length} runs (${metric} lists)`] = { curve, atTarget };
  }
  const am = analysis.arms['gqa2/agent-matched'];
  if (am) out.liveMatchedAgent = { foundMin: am.foundMin, mean: am.foundMinMean, usdPerRun: r5(am.usdTotal / am.n) };
  console.log(JSON.stringify(out, null, 1));
}
