#!/usr/bin/env node
// NC-1 model run (PREREG-NODECAP-1): every task once per arm (U, A, C, B), interleaved per task in a frozen rotation, with one model:
//   --model scripted  the competent script: a $0 rehearsal of exactly this pipeline (development evidence)
//   --model haiku     the class-M model of policy/models.json (claude-haiku-5-5) through the repo's claude-cli provider (paid)
// Spend: a hard cap over the whole run (--cap, USD). Before each episode the runner requires spent + reserve <= cap, where the reserve is one
// episode's worst case, maxRuns x (runCap + callCap): the runtime refuses a run whose cost passes runCap (a call can overshoot it by at most
// its own cap), the CLI stops a call at callCap (--max-budget-usd), and a call whose spend is unknown counts at that bound.
// Foundry-arm episodes are also replayed on a fresh world at $0 (V5-H). Episodes ending in an environment fault are re-run once at the end.
// Usage: node experiments/nodecap/bed/run-model.mjs --model haiku --out research/nodecap-20261021/runs/haiku-2026-10-21 [--cap 3] [--tasks T01]
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASKS } from './tasks.mjs';
import { runEpisode } from './episode.mjs';
import { ARMS, analyze } from './analyze.mjs';
import { chromiumPath } from '../../../src/capabilities/cua.mjs';
import { loadPolicy } from '../../../src/models/policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const arg = (name, fallback = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
// Frozen run parameters (PREREG-NODECAP-1 §2 and §7).
export const PARAMS = Object.freeze({ runCapUsd: 0.20, callCapUsd: 0.05, maxRuns: 2, maxTurns: 12, envFaults: ['MODEL_UNAVAILABLE', 'MODEL_RATE_LIMIT', 'MODEL_TIMEOUT'], abortAfterConsecutiveEnvFaults: 3 });
/** The frozen episode order: tasks T01..T12; within task i the arms U, A, C, B rotated left by i mod 4. */
export const ORDER = TASKS.flatMap((t, i) => ARMS.map((_, j) => ({ task: t.id, arm: ARMS[(i + j) % ARMS.length] })));

async function main() {
  const model = arg('model'), cap = Number(arg('cap', '3')), only = arg('tasks')?.split(',') ?? null;
  if (!['scripted', 'haiku'].includes(model)) throw new Error('--model scripted|haiku');
  if (!(cap > 0 && cap <= 3)) throw new Error('--cap must be in (0, 3] USD (owner budget for NC-1)');
  const out = path.resolve(ROOT, arg('out') ?? `research/nodecap-20261021/runs/${model}-${new Date().toISOString().slice(0, 10)}`);
  mkdirSync(out, { recursive: true });
  const chromium = chromiumPath() ? (await import('playwright')).chromium : null;
  const reserve = PARAMS.maxRuns * (PARAMS.runCapUsd + PARAMS.callCapUsd);
  const policy = loadPolicy(), modelId = policy.policy.models.find(m => m.class === 'M').id;
  const sha = f => createHash('sha256').update(readFileSync(path.join(ROOT, f))).digest('hex');
  const meta = { schema: 'nc1-model/1', model: model === 'haiku' ? modelId : 'scripted', policyVersion: policy.policy.policyVersion, cap, reserve, params: PARAMS,
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(), dirty: execFileSync('git', ['status', '--porcelain', '--', 'src', 'experiments/nodecap', 'policy'], { cwd: ROOT, encoding: 'utf8' }).trim() !== '',
    prereg: (() => { try { return sha('research/nodecap-20261021/PREREG-NODECAP-1.md'); } catch { return null; } })(), chromium: !!chromium, startedAt: new Date().toISOString(),
    evidence: model === 'haiku' ? 'preregistered NC-1 model run (n = 12 per arm, K = 1: directional)' : 'development rehearsal: scripted competent model, NOT a capability claim' };
  const rows = [], save = () => writeFileSync(path.join(out, 'report.json'), `${JSON.stringify({ ...meta, spentUsd: spent, ...analyze(rows.filter(r => !r.superseded)), rows }, null, 2)}\n`);
  let spent = 0, consecutiveEnv = 0, aborted = null;
  const spendOf = r => (r.cost?.usd ?? 0) + (r.cost?.unknownUpperUsd ?? 0);
  const one = async ({ task, arm }, attempt = 1) => {
    if (spent + reserve > cap) return { task, arm, kind: 'competent', notRun: `spend cap: ${spent.toFixed(4)} spent + ${reserve} reserve > ${cap}` };
    try {
      return { ...(await runEpisode({ task: TASKS.find(t => t.id === task), arm, kind: 'competent', chromium, replay: arm !== 'B', model, runCapUsd: model === 'haiku' ? PARAMS.runCapUsd : 0,
        callCapUsd: PARAMS.callCapUsd, maxRuns: PARAMS.maxRuns })), attempt };
    } catch (error) {
      return { task, arm, kind: 'competent', attempt, notRun: `harness error: ${String(error?.code ?? '')} ${String(error?.message ?? error).slice(0, 300)}` };
    }
  };
  for (const slot of ORDER.filter(s => !only || only.includes(s.task))) {
    if (aborted) { rows.push({ ...slot, kind: 'competent', notRun: aborted }); continue; }
    const r = await one(slot);
    rows.push(r); spent += spendOf(r);
    consecutiveEnv = PARAMS.envFaults.includes(r.error) ? consecutiveEnv + 1 : 0;
    if (consecutiveEnv >= PARAMS.abortAfterConsecutiveEnvFaults) aborted = `aborted after ${consecutiveEnv} consecutive environment faults`;
    console.error(`${r.task} ${r.arm}: ${r.notRun ?? (r.success ? 'pass' : `fail ${r.error ?? r.status}`)} turns=${r.turns ?? '-'} $${spendOf(r).toFixed(5)} total=$${spent.toFixed(4)}${r.replay ? ` replay:${r.replay.deterministic ? 'same' : 'DIFF'}` : ''}`);
    save();
  }
  // One re-run of each environment-fault episode, at the end, within the cap; the original stays in the report, marked superseded.
  for (const r of rows.filter(r => PARAMS.envFaults.includes(r.error) && r.attempt === 1)) {
    if (aborted) break;
    const again = await one({ task: r.task, arm: r.arm }, 2);
    r.superseded = true; rows.push(again); spent += spendOf(again);
    console.error(`${again.task} ${again.arm} (re-run): ${again.notRun ?? (again.success ? 'pass' : `fail ${again.error ?? again.status}`)} total=$${spent.toFixed(4)}`);
    save();
  }
  meta.finishedAt = new Date().toISOString();
  save();
  const result = analyze(rows.filter(r => !r.superseded));
  console.log(JSON.stringify({ spentUsd: spent, table: Object.fromEntries(Object.entries(result.table).map(([a, t]) => [a, { success: t.success, n: t.episodes, P: t.selectionPrecision, R: t.selectionRecall, ctxPerTurn: t.contextTokensPerTurnMean,
    blocked: t.unsafeBlocked, executed: t.unsafeExecuted, proposals: t.proposalsRaised, cost: t.costUsd, wall: t.wallSecondsTotal }])), decisions: result.decisions,
    replays: rows.filter(r => r.replay).map(r => r.replay.deterministic).reduce((a, d) => ({ ...a, [d ? 'same' : 'diff']: (a[d ? 'same' : 'diff'] ?? 0) + 1 }), {}), out: path.relative(ROOT, out) }, null, 2));
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
