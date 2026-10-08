#!/usr/bin/env node
// Runs a solver on tasks of this item and prints the oracle's verdicts:
//   node run-solution.mjs <solver.mjs | workflow.json> [--variant T1|T2|T3] [--difficulty 5] [--seeds 0-13] [--split dev] [--json]
// A .mjs solver's default export is solve(inputs) -> plan (sync or async), exactly the SKELETON in the task files. It runs in THIS process
// (arms that execute model-written code must run it in their sandbox and hand only the plan to oracle()). A .json file is a Foundry workflow
// (C0 protocol: node "answer" returns the plan), run through the real `foundry run`. Latency is the wall time of solve() / of the CLI run.
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import * as bed from './index.mjs';

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i < 0 ? dflt : argv[i + 1]; };
const solverPath = argv.find(a => !a.startsWith('--') && a !== opt('variant') && a !== opt('difficulty') && a !== opt('seeds') && a !== opt('split'));
if (!solverPath) { console.error('usage: node run-solution.mjs <solver.mjs> [--variant T2] [--difficulty 5] [--seeds 0-13] [--split dev] [--json]'); process.exit(2); }
const [lo, hi] = String(opt('seeds', '0-13')).split('-').map(Number);
const seeds = Array.from({ length: (hi ?? lo) - lo + 1 }, (_, i) => lo + i);
const variant = opt('variant', 'T2'), difficulty = Number(opt('difficulty', 5)), split = opt('split', 'dev');
const isWorkflow = solverPath.endsWith('.json');
let solve, foundryRun;
if (isWorkflow) {
  const { runViaFoundry } = await import('./controls/foundry-workflow.mjs');
  foundryRun = task => runViaFoundry(task, { workflowFile: path.resolve(solverPath) });
} else {
  ({ default: solve } = await import(pathToFileURL(path.resolve(solverPath)).href));
  if (typeof solve !== 'function') { console.error(`${solverPath} must export default function solve(inputs)`); process.exit(2); }
}

const rows = [];
for (const seed of seeds) {
  const task = bed.generate({ seed, split, difficulty, variant });
  const t0 = performance.now();
  let plan, error = null, foundry = null;
  if (isWorkflow) { foundry = foundryRun(task); plan = foundry.plan; if (!foundry.ok) error = `foundry run: ${foundry.error ?? foundry.status}`; }
  else { try { plan = await solve(structuredClone(task.inputs)); } catch (e) { error = String(e.message ?? e).slice(0, 200); } }
  const latencyMs = isWorkflow ? foundry.wallMs : Math.round(performance.now() - t0);
  const verdict = error ? { pass: false, score: 0, details: { error } } : bed.oracle(task, plan);
  rows.push({ seed, id: task.id, pass: verdict.pass, score: verdict.score, latencyMs, violations: verdict.details?.violations ?? [], target: variant === 'T3' ? bed.meetsTarget(task, { costUsd: foundry?.cost ?? 0, latencyMs }) : undefined });
}
if (argv.includes('--json')) console.log(JSON.stringify(rows, null, 1));
else {
  for (const r of rows) console.log(`${r.pass ? 'PASS' : 'fail'} seed ${String(r.seed).padStart(3)} score ${r.score.toFixed(2)} ${r.latencyMs} ms ${r.violations.join(',')}${r.target ? ` target:${r.target.ok}` : ''}`);
  console.log(`${rows.filter(r => r.pass).length}/${rows.length} passed (${variant}, difficulty ${difficulty}, split ${split})`);
}
