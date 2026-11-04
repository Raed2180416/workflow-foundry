#!/usr/bin/env node
// $0 descriptive table for the GQA-1 agent-type runs (agent, agent-persist): how the solo agent spent its budget.
// Per run: model calls (turns), runs played, ticks played (of 8,000), refused finishes (agent-persist), whether its notes
// give a budget as the reason to stop, and the oracle's foundMin. Analysis only; no arm reads it.
//   node experiments/gameqa-web/agent-behaviour.mjs [RUNS_DIR] > agent-behaviour.json
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = process.argv[2] ?? path.join(ROOT, 'research/gameqa-20261021/runs');
const read = (d, f) => (existsSync(path.join(d, f)) ? JSON.parse(readFileSync(path.join(d, f), 'utf8')) : null);
const STOP_FOR_BUDGET = /budget (is|was) (nearly|almost) (spent|exhausted)|stay within the (small )?usd budget|budget is (tight|small|low)|\$0\.25/i;
const rows = [];
for (const name of readdirSync(dir).sort()) {
  const d = path.join(dir, name), meta = read(d, 'meta.json');
  if (!meta || !['agent', 'agent-persist'].includes(meta.arm)) continue;
  const s = read(d, 'stats.json')?.stats ?? {}, score = read(d, 'score.json');
  const calls = readFileSync(path.join(d, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(c => typeof c.ok === 'boolean');
  const finishes = calls.filter(c => c.value?.action === 'finish').length;
  rows.push({ run: name, arm: meta.arm, transport: meta.transport ?? 'cli', turns: calls.length, runs: s.runs, ticks: s.exploreTicks, finishAnswers: finishes,
    refusedFinishes: s.refusedFinishes ?? 0, stoppedBeforeLastTurn: Boolean(s.finished) && calls.length < (meta.budgets?.maxTurns ?? 40),
    notesCiteBudgetStop: calls.some(c => STOP_FOR_BUDGET.test(c.value?.notes ?? '')), seeds: [...new Set((s.played ?? []).map(p => p.seed))].length,
    reports: score?.summary?.reports, foundMin: score?.summary?.foundMin, usd: Math.round((meta.cost?.spent ?? 0) * 1e5) / 1e5, wallS: Math.round(meta.wallMs / 1000) });
}
console.log(JSON.stringify(rows, null, 1));
