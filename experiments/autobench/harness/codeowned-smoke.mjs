#!/usr/bin/env node
// $0 scripted smoke of arm A1-C (no model): run.mjs --harness codeowned with the scripted stand-ins of
// codeowned-stubs.mjs on devTrain tasks (1 per domain, seeded). The stand-ins use only what each node is given; the
// sessions make the writes their brief's checks describe. This checks plumbing (inventory through the bridge, ledger
// verbatim copying and union, checks before acting, act, re-read and evaluation, code-owned termination and repair,
// accounting over every node) on real dev worlds, not capability: its scores are not evidence of anything.
//
//   node experiments/autobench/harness/codeowned-smoke.mjs [--per-domain 1] [--seed a1c-smoke-1] [--out DIR|none] [--concurrency 2]
// (the recorded smoke used --seed 11: the six dev-first6 tasks of the a1-dev-first6 diagnosis)
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORK_ROOT } from '../../../src/executors/claude-code.mjs';
import { PUBLIC_DOMAINS, REPO } from '../lib.mjs';
import { poolTasks, runTasks } from '../run.mjs';
import { stubNodeRunner, stubSessionRunner } from './codeowned-stubs.mjs';

export async function smoke({ perDomain = 1, seed = 'a1c-smoke-1', out, concurrency = 2, log, tasks = null, dateNote = true } = {}) {
  const list = tasks ?? poolTasks('devTrain', { subset: perDomain * PUBLIC_DOMAINS.length, seed });
  // A scripted smoke always starts from a fresh live directory (the runner refuses to reuse one without --resume).
  const runId = `a1c-smoke-scripted-${seed}`, liveRoot = path.join(WORK_ROOT, 'autobench', runId);
  rmSync(liveRoot, { recursive: true, force: true });
  return runTasks({ tasks: list, harness: 'codeowned', runner: stubSessionRunner({ skipLast: true }), nodeRunner: stubNodeRunner(), det: 'record', k: 1, concurrency, dateNote,
    runId, liveRoot, outDir: out === 'none' ? null : (out ?? path.join(REPO, 'research/automationbench-20261014/runs/a1c-smoke-scripted')), log });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const a = Object.fromEntries(argv.map((x, i) => (x.startsWith('--') ? [x.slice(2), argv[i + 1]] : null)).filter(Boolean));
  const { summary, results } = await smoke({ perDomain: Number(a['per-domain'] ?? 1), seed: a.seed ?? 'a1c-smoke-1', out: a.out, concurrency: Number(a.concurrency ?? 2), tasks: a.tasks ? a.tasks.split(',') : null });
  const rows = results.map(r => {
    const f = r.forks[0], p = f.pipeline ?? {};
    return { task: r.task, steps: f.steps, responses: f.session?.modelResponses, nodes: (f.session?.nodes ?? []).map(n => `${n.name}:${n.responses}r/${n.steps ?? 0}s`).join(' '),
      codeSteps: f.session?.codeSteps, sessionSteps: f.session?.sessionSteps, inventory: p.inventory, ledger: p.ledger, checks: p.checks, termination: p.termination, writes: f.usage?.writes,
      pass: r.final?.task_completed_correctly ?? null, partialCredit: r.final?.partial_credit ?? null, violations: f.session?.violations ?? null, errors: f.sessionError ?? f.harnessError ?? null, pipelineError: p.error ? String(p.error).slice(0, 300) : null };
  });
  process.stdout.write(JSON.stringify({ runId: summary.runId, arm: summary.arm, harness: summary.harness, n: summary.n, pass_rate: summary.pass_rate, mean_partial_credit: summary.mean_partial_credit,
    cost: summary.cost.spentUsd, accounting: summary.accounting, errors: summary.errors, copiedTo: summary.copiedTo ?? null, rows }, null, 1) + '\n');
}
