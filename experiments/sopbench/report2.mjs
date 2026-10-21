#!/usr/bin/env node
// Markdown tables for SOP-Bench phase 2 from aggregate files only (research/sopbench-20261021/runs/<run>/{build-summary,
// summary}.json): builds (dev rows), the sealed run and the ablation cells. No row content is read.
//   node experiments/sopbench/report2.mjs --builds p2-pilot,p2-main [--sealed p2-sealed] [--cells p2-abl-v1-sealed,...]
import { existsSync } from 'node:fs';
import path from 'node:path';
import { RESEARCH, readJson } from './lib.mjs';

const pct = x => (x === null || x === undefined ? '-' : `${(100 * x).toFixed(1)}%`);
const usd = x => (x === null || x === undefined ? '-' : `$${x.toFixed(3)}`);

export function buildTable(runs) {
  const lines = ['| SOP | run | dev pass (build / repair) | best round | rounds | sessions $ | checks $ | sections per run | judge calls per run |', '|---|---|---|---|---|---|---|---|---|'];
  let total = 0;
  for (const run of runs) {
    const f = path.join(RESEARCH, 'runs', run, 'build-summary.json');
    if (!existsSync(f)) continue;
    const s = readJson(f);
    for (const [sop, x] of Object.entries(s.sops)) {
      const best = x.rounds.find(r => r.round === x.bestRound) ?? {};
      const sess = x.rounds.reduce((a, r) => a + (r.costUsd ?? 0) + (r.judgeUsd ?? 0), 0), checks = x.rounds.reduce((a, r) => a + (r.checkUsd ?? 0), 0);
      total += x.costUsd ?? 0;
      lines.push(`| ${sop} | ${run} | ${x.devPass}/${x.devRows} (${x.buildPass} / ${x.repairPass}) | ${x.bestRound ?? '-'} | ${x.rounds.length} | ${usd(sess)} | ${usd(checks)} | ${best.sectionsPerRun?.toFixed?.(1) ?? '-'} | ${best.judgeCallsPerRun?.toFixed?.(2) ?? '-'} |`);
    }
  }
  lines.push(`| **total** | | | | | ${usd(total)} | | | |`);
  return lines.join('\n');
}

export function sealedTable(run) {
  const s = readJson(path.join(RESEARCH, 'runs', run, 'summary.json'));
  if (!s.analysis) return `(${run}: no analysis: ${s.stopped ?? 'incomplete'})`;
  const a = s.analysis;
  const lines = [`| SOP | rows | W pass^${a.k} | A pass^${a.k} | W pass@1 | A pass@1 | W upstream@1 | A upstream@1 |`, '|---|---|---|---|---|---|---|---|'];
  for (const [sop, x] of Object.entries(a.perSop)) lines.push(`| ${sop} | ${x.W?.rows ?? x.A?.rows} | ${pct(x.W?.passK)} | ${pct(x.A?.passK)} | ${pct(x.W?.passAt1)} | ${pct(x.A?.passAt1)} | ${pct(x.W?.upstreamAt1)} | ${pct(x.A?.upstreamAt1)} |`);
  const W = a.arms.W, A = a.arms.A;
  lines.push(`| **macro** | | **${pct(W?.macroPassK)}** [${pct(W?.ci95?.[0])}, ${pct(W?.ci95?.[1])}] | **${pct(A?.macroPassK)}** [${pct(A?.ci95?.[0])}, ${pct(A?.ci95?.[1])}] | ${pct(W?.macroPassAt1)} | ${pct(A?.macroPassAt1)} | ${pct(W?.macroUpstreamAt1)} | ${pct(A?.macroUpstreamAt1)} |`);
  const d = a.wMinusA ? `W - A = ${pct(a.wMinusA.macro)} [${pct(a.wMinusA.ci95[0])}, ${pct(a.wMinusA.ci95[1])}]` : '';
  return `${lines.join('\n')}\n\n${d}; cost W ${usd(W?.costUsd)} over ${W?.runs} runs, A ${usd(A?.costUsd)} over ${A?.runs} runs; decision ${JSON.stringify(s.decision)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2), a = {};
  for (let i = 0; i < argv.length; i++) a[argv[i].slice(2)] = argv[++i];
  if (a.builds) console.log(buildTable(a.builds.split(',')));
  for (const r of [a.sealed, ...(a.cells ? a.cells.split(',') : [])].filter(Boolean)) console.log(`\n### ${r}\n\n${sealedTable(r)}`);
}
