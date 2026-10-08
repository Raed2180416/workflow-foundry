#!/usr/bin/env node
// Runs every control of this item and prints (or writes) the numbers the README quotes.
//   node controls/run-controls.mjs [--per-kind 4] [--mutant-seeds 1] [--write] [--baseline]
//   --write     controls/report.json          --baseline   fixtures/baseline.json (the original's wall time; part of the freeze)
// Controls: (A) the ORIGINAL executed on the mocks, judged in both modes; (B) the JavaScript port and the improved reference against it;
// (C) broken variants of the original; (D) plan-level bad controls and the references over many seeds.
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import * as bed from '../index.mjs';
import { instanceFor, inputsOf, KINDS } from '../scenarios.mjs';
import { judge, outcomeFromPlan } from '../oracle.mjs';
import { isolation } from '../runner.mjs';
import { MUTANTS } from './mutants.mjs';
import { effectSignature, originalText, runOriginal } from './original.mjs';
import { solveFaithful } from './reference.mjs';
import { dockerAvailable } from './record-docker-probes.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? dflt : Number(process.argv[i + 1]); };
const PER_KIND = arg('per-kind', 4), MUTANT_SEEDS = arg('mutant-seeds', 1);
const stats = xs => { const s = [...xs].sort((a, b) => a - b); return { n: s.length, median: s[Math.floor((s.length - 1) / 2)], p90: s[Math.min(s.length - 1, Math.floor(0.9 * s.length))], mean: Math.round(s.reduce((a, b) => a + b, 0) / (s.length || 1)), max: s.at(-1) }; };
const instancesFor = n => Array.from({ length: n }, (_, j) => KINDS.map((_, i) => instanceFor({ seed: i + KINDS.length * j, split: 'dev', difficulty: 5 }))).flat();

const report = { schema: 'rbench-item-controls/1', item: bed.ITEM.id, harnessVersion: bed.VERSION, host: { node: process.version, cpus: os.cpus().length, isolation: isolation(), dockerCompose: dockerAvailable() } };

// (A) + (B) -------------------------------------------------------------------------------------------------------------------------------------
const wall = [], byKind = {}, diffs = [];
let runs = 0, passOriginal = 0, passIntent = 0, same = 0;
const mutantInstances = instancesFor(Math.max(1, MUTANT_SEEDS));
for (const inst of instancesFor(PER_KIND)) {
  const { observation, outcome } = await runOriginal(inst);
  wall.push(observation.wallMs);
  const o = judge(inst, 'original', outcome), i = judge(inst, 'intent', outcome);
  const port = outcomeFromPlan(inst, solveFaithful(inputsOf(inst)));
  const portSame = effectSignature(port) === effectSignature(outcome);
  if (!portSame) diffs.push({ kind: inst.kind, seed: inst.seed, executed: JSON.parse(effectSignature(outcome)).status, port: JSON.parse(effectSignature(port)).status });
  runs++; if (o.pass) passOriginal++; if (i.pass) passIntent++; if (portSame) same++;
  const k = (byKind[inst.kind] ??= { runs: 0, originalMode: 0, intentMode: 0, intentViolations: {}, portIdentical: 0 });
  k.runs++; if (o.pass) k.originalMode++; if (i.pass) k.intentMode++; if (portSame) k.portIdentical++;
  for (const v of i.details.violations ?? []) k.intentViolations[v] = (k.intentViolations[v] ?? 0) + 1;
  if (!o.pass) console.error('ORIGINAL FAILED ITS OWN ORACLE', inst.kind, inst.seed, JSON.stringify(o.details));
}
report.originalExecuted = { runs, passOriginalMode: passOriginal, passIntentMode: passIntent, wallMs: stats(wall), byKind };
report.portVsExecuted = { compared: runs, identicalEffects: same, differences: diffs };
console.log(`(A) original executed: ${passOriginal}/${runs} in original mode, ${passIntent}/${runs} in intent mode; wall ms ${JSON.stringify(stats(wall))}`);
console.log(`(B) port vs executed original: identical effects on ${same}/${runs}`);
for (const [kind, k] of Object.entries(byKind)) console.log(`    ${kind.padEnd(26)} original-mode ${k.originalMode}/${k.runs}  intent-mode ${k.intentMode}/${k.runs} ${Object.keys(k.intentViolations).length ? JSON.stringify(k.intentViolations) : ''}`);

// (C) -------------------------------------------------------------------------------------------------------------------------------------------
const base = originalText();
report.mutants = [];
for (const m of MUTANTS) {
  const text = m.apply(base);
  const passedOn = [], failedOn = [], wrongVerdicts = [];
  for (const inst of mutantInstances) {
    const { outcome } = await runOriginal(inst, { workflowText: text });
    const r = judge(inst, 'original', outcome);
    (r.pass ? passedOn : failedOn).push(inst.kind);
    if (m.fails(inst) && r.pass) wrongVerdicts.push(`${inst.kind}#${inst.seed}: passed but must fail`);
    if (m.equivalent && !r.pass) wrongVerdicts.push(`${inst.kind}#${inst.seed}: equivalent variant rejected (${r.details.violations})`);
  }
  report.mutants.push({ id: m.id, describe: m.describe, instances: mutantInstances.length, failedOn: [...new Set(failedOn)], passedOn: [...new Set(passedOn)], failedCount: failedOn.length, wrongVerdicts });
  console.log(`(C) ${m.id.padEnd(28)} fails ${String(failedOn.length).padStart(2)}/${mutantInstances.length}${wrongVerdicts.length ? '   WRONG: ' + wrongVerdicts.join('; ') : ''}`);
}

// (D) -------------------------------------------------------------------------------------------------------------------------------------------
report.referenceSolves = {}; report.badControls = {};
for (const variant of bed.VARIANTS) for (const difficulty of [1, 2, 3, 4, 5]) {
  let pass = 0, n = 0;
  for (let seed = 0; seed < 28; seed++) {
    const task = bed.generate({ seed, split: 'dev', difficulty, variant });
    n++; if (bed.oracle(task, bed.referenceSolve(task)).pass) pass++;
    for (const c of bed.badControls) {
      if (!c.applies(task)) continue;
      const r = bed.oracle(task, c.make(task));
      const e = (report.badControls[c.name] ??= { applied: 0, rejected: 0, scoreSum: 0 });
      e.applied++; if (!r.pass) e.rejected++; e.scoreSum += r.score;
    }
  }
  report.referenceSolves[`${variant}.d${difficulty}`] = `${pass}/${n}`;
}
for (const e of Object.values(report.badControls)) { e.meanScore = Number((e.scoreSum / e.applied).toFixed(2)); delete e.scoreSum; }
console.log('(D) reference solves', JSON.stringify(report.referenceSolves));
for (const [name, e] of Object.entries(report.badControls)) console.log(`    ${name.padEnd(30)} rejected ${e.rejected}/${e.applied}, mean score ${e.meanScore}`);

// (E) the same behaviour as a Foundry workflow through the real CLI (--foundry)
if (process.argv.includes('--foundry')) {
  const { runViaFoundry } = await import('./foundry-workflow.mjs');
  const rows = [];
  for (const seed of KINDS.map((_, i) => i)) {
    const task = bed.generate({ seed, split: 'dev', difficulty: 5, variant: 'T3' });
    const r = runViaFoundry(task);
    rows.push({ kind: instanceFor({ seed, split: 'dev', difficulty: 5 }).kind, ran: r.ok, pass: r.ok && bed.oracle(task, r.plan).pass, wallMs: r.wallMs, foundryVerdict: r.verdict, costUsd: r.cost });
  }
  const w = stats(rows.map(r => r.wallMs));
  report.foundryCodeNode = { runs: rows.length, pass: rows.filter(r => r.pass).length, wallMs: w, originalMedianWallMs: stats(wall).median, runsWithinT3Latency: rows.filter(r => r.wallMs <= (bed.baseline()?.wallMsMedian ?? 0)).length, rows };
  console.log(`(E) foundry code node via the CLI: ${report.foundryCodeNode.pass}/${rows.length} pass; wall ms ${JSON.stringify(w)} vs the original's median ${stats(wall).median}`);
}

if (process.argv.includes('--write')) { writeFileSync(new URL('./report.json', import.meta.url), JSON.stringify(report, null, 1) + '\n'); console.log('wrote controls/report.json'); }
if (process.argv.includes('--baseline')) {
  const w = stats(wall);
  writeFileSync(new URL('../fixtures/baseline.json', import.meta.url), JSON.stringify({ schema: 'rbench-baseline/1', measuredOn: '2026-10-08', what: 'wall time of one run of the original workflow on the mocks (runner.mjs), canonical-suite kinds, d5 dev seeds',
    runs: w.n, wallMsMedian: w.median, wallMsP90: w.p90, wallMsMean: w.mean, wallMsMax: w.max, isolation: isolation(),
    note: 'Machine-dependent: bash, curl and (where used) unshare start-up dominate. Includes the runner\'s own overhead (a local mock server, a private /tmp).' }, null, 1) + '\n');
  console.log('wrote fixtures/baseline.json');
}
