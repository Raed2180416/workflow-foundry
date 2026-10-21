#!/usr/bin/env node
// Markdown table of a SOP-Bench run (research/sopbench-20261021/runs/<run-id>/results.jsonl): per SOP rows, upstream and
// strict pass rates, cost, steps, and why the strict misses missed (no final_output, a wrong field, upstream-only passes).
//   node experiments/sopbench/table.mjs research/sopbench-20261021/runs/raw-haiku-dev [--paper]
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Claude 4 Opus, SOP-Bench paper v2 Table 4 (arXiv 2506.08119v2; read 2026-10-21 through a fetch-and-summarise tool, to be
// re-checked against the PDF before external use). Different model, agents (Bedrock FC and LangChain ReAct), prompts,
// rows (all labelled rows, not our dev rows) and scorer (upstream's lenient one, with its legacy-mode input leak).
export const PAPER_OPUS4 = Object.freeze({
  patient_intake: [0.92, 1.0], email_intent: [0.98, 0.98], referral_abuse_detection_v1: [0.95, 0.97], aircraft_inspection: [0.45, 0.97],
  referral_abuse_detection_v2: [0.98, 0.96], video_classification: [0.79, 0.94], dangerous_goods: [0.73, 0.83], warehouse_package_inspection: [0.56, 0.65],
  traffic_spoofing_detection: [0.79, 0.6], customer_service: [0.56, 0.56], video_annotation: [0.37, 0.38], know_your_business: [0.43, 0.31], content_flagging: [0.36, 0.27],
});

const pct = x => (x === null || x === undefined ? '-' : `${(100 * x).toFixed(0)}%`);
export function table(dir, { paper = true } = {}) {
  const rs = readFileSync(path.join(dir, 'results.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const sops = [...new Set(rs.map(r => r.sop))];
  const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const lines = [`| SOP | rows | upstream | strict | upstream-only passes | no final_output | $/row | steps (mean) |${paper ? ' paper Opus 4 FC / ReAct |' : ''}`,
    `|---|---|---|---|---|---|---|---|${paper ? '---|' : ''}`];
  const agg = { n: 0, up: [], st: [], cost: 0 };
  for (const s of sops) {
    const x = rs.filter(r => r.sop === s);
    const up = mean(x.map(r => (r.final.upstream ? 1 : 0))), st = mean(x.map(r => (r.final.strict ? 1 : 0)));
    const upOnly = x.filter(r => r.final.upstream && !r.final.strict).length;
    const noFo = x.filter(r => !/<final_output>/i.test(r.answerText ?? '')).length;
    const cost = x.reduce((a, r) => a + (r.costUsd ?? 0), 0);
    agg.n += x.length; agg.up.push(up); agg.st.push(st); agg.cost += cost;
    const p = PAPER_OPUS4[s];
    lines.push(`| ${s} | ${x.length} | ${pct(up)} | ${pct(st)} | ${upOnly} | ${noFo} | ${(cost / x.length).toFixed(4)} | ${mean(x.map(r => r.steps ?? 0)).toFixed(1)} |${paper ? ` ${p ? `${pct(p[0])} / ${pct(p[1])}` : 'not in Table 4'} |` : ''}`);
  }
  const micro = k => mean(rs.map(r => (r.final[k] ? 1 : 0)));
  lines.push(`| **all (macro over SOPs)** | ${agg.n} | ${pct(mean(agg.up))} | ${pct(mean(agg.st))} | | | ${(agg.cost / agg.n).toFixed(4)} | |${paper ? ' 68% / 72% (13 SOPs) |' : ''}`);
  lines.push(`| **all (micro over rows)** | ${agg.n} | ${pct(micro('upstream'))} | ${pct(micro('strict'))} | | | total $${agg.cost.toFixed(4)} | |${paper ? ' |' : ''}`);
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(table(process.argv[2], { paper: !process.argv.includes('--no-paper') }));
