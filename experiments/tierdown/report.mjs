#!/usr/bin/env node
// Markdown tables for RESULT-TIERDOWN.md from the frozen data files (no model calls).
//   node experiments/tierdown/report.mjs <data dir>
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { readJsonl } from './archive.mjs';
import { nodeTable, injectTable, mergeInject } from './analyze.mjs';

const dir = process.argv[2] ?? 'research/tierdown-20261021/data';
const f = (x, d = 3) => (x == null || Number.isNaN(x) ? '—' : Number(x).toFixed(d));
const usd = x => (x == null ? '—' : `$${Number(x).toFixed(4)}`);
const short = t => t.replace('claude-haiku-5-5', 'haiku').replace('mercury-3', 'mercury');
const s = x => (x == null ? '—' : `${(x / 1000).toFixed(1)} s`);

for (const slice of ['C', 'H']) {
  const files = [`answers-${slice}.jsonl`, `answers-${slice}-rule.jsonl`].map(x => path.join(dir, x)).filter(existsSync);
  const answers = files.flatMap(readJsonl);
  if (!answers.length) continue;
  console.log(`\n### Node replays, slice ${slice}\n`);
  // K = answers asked per decision (always 1 here); k = the reference judge's vote size, which a model tier is charged
  // (review #5). Reference latency here is the SUM of the reference calls (concurrent vote samples added up); the wall
  // time per decision is in the injection detail (inject-H-v2.json decisions[].refWallMs, review #6).
  console.log('| site | tier | K asked | ref k | answered | usable | mean leaf agreement | exact | tier $/decision (x k) | ref $/decision | tier p50 / p95 | ref p50 / p95 (sum of calls) | not usable |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const n of nodeTable(answers).filter(n => n.tier !== 'memo')) {
    const ks = [...new Set(answers.filter(a => a.site === n.site && a.tier === n.tier).map(a => a.samples ?? 1))].join('/');
    console.log(`| ${n.site} | ${short(n.tier)} | 1 | ${ks} | ${n.answered} | ${n.usable} | ${f(n.agreement)} | ${f(n.exactRate, 2)} | ${usd(n.tierUsdPerDecision)} | ${usd(n.refUsdPerDecision)} | ${s(n.tierLatencyP50)} / ${s(n.tierLatencyP95)} | ${s(n.refLatencyP50)} / ${s(n.refLatencyP95)} | ${n.errors.map(([k, v]) => `${k} ${v}`).join(', ') || '—'} |`);
  }
  const memo = nodeTable(answers).filter(n => n.tier === 'memo');
  console.log(`\nMemo: ${memo.reduce((a, n) => a + n.usable, 0)} hits in ${memo.reduce((a, n) => a + n.answered, 0)} delivery decisions.`);
  // The corrected injection (review 2026-11-04) when present, else the original files.
  const v2 = path.join(dir, `inject-${slice}-v2.json`), injFile = existsSync(v2) ? v2 : path.join(dir, `inject-${slice}.json`);
  if (!existsSync(injFile)) continue;
  const extra = path.join(dir, `inject-${slice}-provisional.json`);
  const inj = injectTable(mergeInject([injFile, ...(!existsSync(v2) && existsSync(extra) ? [extra] : [])].map(f => JSON.parse(readFileSync(f, 'utf8')))).rows);
  console.log(`\n(${path.basename(injFile)}; pass→fail counts deopts of passing units, review #10)`);
  console.log(`\n### End-to-end injection, slice ${slice} (every other judge at its archived answer)\n`);
  console.log('| assignment | units | pass→fail | fail→pass | deopt/crash | unmeasured | incomplete | judge $ (tier + fallbacks + deopt) | reference $ |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const [name, t] of Object.entries(inj).filter(([k]) => !k.endsWith('@memo') && k !== 'B-ref'))
    console.log(`| ${short(name)} | ${t.units} | ${t.passFail} | ${t.failPass} | ${t.deopts} | ${t.unmeasured} | ${t.incomplete} | ${usd(t.judgeUsd)} | ${usd(t.refUsd)} |`);
}
