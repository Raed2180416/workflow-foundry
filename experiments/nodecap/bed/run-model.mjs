#!/usr/bin/env node
// NC-1 model run (PREREG-NODECAP-1): every task once per arm (U, A, C, B), interleaved per task in a frozen rotation, with one model:
//   --model scripted  the competent script: a $0 rehearsal of exactly this pipeline (development evidence)
//   --model haiku     the class-M model of policy/models.json (claude-haiku-5-5) through the repo's claude-cli provider (paid)
// Spend: a hard cap over the whole run (--cap, USD). Before each episode the runner requires spent + reserve <= cap, where the reserve is one
// episode's worst case, maxRuns x (runCap + callCap): the runtime refuses a run whose cost passes runCap (a call can overshoot it by at most
// its own cap), the CLI stops a call at callCap (--max-budget-usd), and a call whose spend is unknown counts at that bound.
// Foundry-arm episodes are also replayed on a fresh world at $0 (V5-H). Episodes ending in an environment fault are re-run once at the end.
//
// Amendment 1 (PREREG-NODECAP-1-AMEND-1, `--protocol amend1`): the same 12 tasks and the four frozen arms U, A, C, B, K = 2 episodes per
// arm per task (replicate r runs the frozen order with the arm rotation shifted by 2(r-1)), a $1 cap, the sha256 manifest verified before
// any paid call, each episode's journal (every prompt, response, usage and spend) archived in the run directory, and resume: a run that
// aborted on consecutive environment faults exits 75, and `--resume` continues it from the saved report without re-running any episode
// that ran (run-amend1.sh is the detached loop around it).
// Usage: node experiments/nodecap/bed/run-model.mjs --model haiku --out research/nodecap-20261021/runs/haiku-2026-10-21 [--cap 3] [--tasks T01]
//        node experiments/nodecap/bed/run-model.mjs --protocol amend1 --model haiku --out <dir> [--resume]
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASKS } from './tasks.mjs';
import { runEpisode } from './episode.mjs';
import { ARMS, analyze, analyzeK } from './analyze.mjs';
import { chromiumPath } from '../../../src/capabilities/cua.mjs';
import { loadPolicy } from '../../../src/models/policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const arg = (name, fallback = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const flag = name => process.argv.includes(`--${name}`);
// Frozen run parameters (PREREG-NODECAP-1 §2 and §7).
export const PARAMS = Object.freeze({ runCapUsd: 0.20, callCapUsd: 0.05, maxRuns: 2, maxTurns: 12, envFaults: ['MODEL_UNAVAILABLE', 'MODEL_RATE_LIMIT', 'MODEL_TIMEOUT'], abortAfterConsecutiveEnvFaults: 3 });
/** The frozen episode order: tasks T01..T12; within task i the arms U, A, C, B rotated left by i mod 4. */
export const ORDER = TASKS.flatMap((t, i) => ARMS.map((_, j) => ({ task: t.id, arm: ARMS[(i + j) % ARMS.length] })));
/** The four arms of PREREG-NODECAP-1 (arm S, added by the cost review, runs in the scripted bed only). */
export const FROZEN_ARMS = Object.freeze(['U', 'A', 'C', 'B']);
/** PREREG-NODECAP-1-AMEND-1: the protocol `--protocol amend1` fixes (no flag can change these for a paid run). */
export const AMEND1 = Object.freeze({ id: 'amend1', arms: FROZEN_ARMS, k: 2, capUsd: 1, maxResumes: 6,
  prereg: 'research/nodecap-20261021/PREREG-NODECAP-1-AMEND-1.md', manifest: 'research/nodecap-20261021/PREREG-NODECAP-1-AMEND-1.sha256' });
/** Exit code of a run that stopped on consecutive environment faults (EX_TEMPFAIL): the detached loop waits and resumes it. */
export const EXIT_ENV_ABORT = 75;
/**
 * The episode order of K replicates over `arms`: replicate r (1-based) runs tasks T01..T12, and within task i the arms rotated left by
 * (i + 2(r - 1)) mod |arms|. Replicate 1 over U, A, C, B is exactly the NC-1 order; replicate 2 puts every arm in a different position.
 */
export function orderFor({ arms = FROZEN_ARMS, k = 1, tasks = TASKS } = {}) {
  return Array.from({ length: k }, (_, r) => tasks.flatMap((t, i) => arms.map((_, j) => ({ task: t.id, arm: arms[(i + 2 * r + j) % arms.length], rep: r + 1 })))).flat();
}
export const slotKey = s => `${s.task}|${s.arm}|${s.rep ?? 1}`;
export const spendOf = r => (r.cost?.usd ?? 0) + (r.cost?.unknownUpperUsd ?? 0);
/**
 * Resume state from a saved report: every row stands except the slots the runner marked not run because it aborted (those are run now).
 * Rows that ran (passed, failed, harness error, environment fault, spend cap) are never re-run on resume; the once-at-the-end re-run of an
 * environment-fault episode (PREREG-NODECAP-1 §6) still applies to an original that has no re-run yet. Spend counts every row, superseded
 * ones included.
 */
export function resumeState(rows) {
  const kept = rows.filter(r => !String(r.notRun ?? '').startsWith('aborted'));
  return { rows: kept, done: new Set(kept.filter(r => (r.attempt ?? 1) === 1).map(slotKey)), spent: kept.reduce((a, r) => a + spendOf(r), 0) };
}
/** Environment-fault originals still owed their single re-run. */
export const owedReruns = rows => rows.filter(r => PARAMS.envFaults.includes(r.error) && (r.attempt ?? 1) === 1 && !r.superseded
  && !rows.some(o => o !== r && slotKey(o) === slotKey(r) && (o.attempt ?? 1) === 2));
/** Every line of a sha256sum manifest whose file no longer has that hash (or is missing). */
export function manifestMismatches(manifestPath, root = ROOT) {
  return readFileSync(manifestPath, 'utf8').trim().split('\n').filter(Boolean).map(l => /^([0-9a-f]{64})\s+\*?(.+)$/.exec(l)).filter(Boolean).filter(([, h, f]) => {
    try { return createHash('sha256').update(readFileSync(path.join(root, f))).digest('hex') !== h; } catch { return true; } }).map(([, , f]) => f);
}

async function main() {
  const model = arg('model'), protocol = arg('protocol'), only = arg('tasks')?.split(',') ?? null, resume = flag('resume');
  if (!['scripted', 'haiku'].includes(model)) throw new Error('--model scripted|haiku');
  if (protocol !== null && protocol !== AMEND1.id) throw new Error(`--protocol must be ${AMEND1.id} (or absent: the original NC-1 run)`);
  const amend = protocol === AMEND1.id;
  // Under amend1 a paid run takes arms, K and cap from the amendment only; a scripted rehearsal may narrow K or the tasks.
  if (amend && model === 'haiku' && (arg('cap') || arg('k') || arg('arms') || only)) throw new Error('--protocol amend1 fixes cap, K, arms and tasks for a paid run');
  const cap = amend ? AMEND1.capUsd : Number(arg('cap', '3')), k = amend ? Number(arg('k', String(AMEND1.k))) : Number(arg('k', '1'));
  const arms = amend ? AMEND1.arms : (arg('arms')?.split(',') ?? ARMS);
  if (!(cap > 0 && cap <= 3)) throw new Error('--cap must be in (0, 3] USD (owner budget for NC-1)');
  if (!(Number.isInteger(k) && k >= 1 && k <= 3)) throw new Error('--k must be 1, 2 or 3');
  if (!arms.every(a => ARMS.includes(a))) throw new Error(`--arms must be a subset of ${ARMS.join(',')}`);
  const out = path.resolve(ROOT, arg('out') ?? `research/nodecap-20261021/runs/${model}-${new Date().toISOString().slice(0, 10)}`);
  mkdirSync(path.join(out, 'journal'), { recursive: true });
  const sha = f => createHash('sha256').update(readFileSync(path.join(ROOT, f))).digest('hex');
  const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
  const head = git('rev-parse', 'HEAD'), dirty = git('status', '--porcelain', '--', 'src', 'experiments/nodecap', 'policy', 'package.json', 'package-lock.json') !== '';
  // A paid amendment run starts only on a clean tree whose files match the frozen manifest (nothing refused silently: the reason is thrown).
  if (amend && model === 'haiku') {
    if (dirty) throw new Error('amend1: uncommitted changes under src, experiments/nodecap, policy or package files');
    const bad = manifestMismatches(path.join(ROOT, AMEND1.manifest));
    if (bad.length) throw new Error(`amend1: ${bad.length} file(s) differ from ${AMEND1.manifest}: ${bad.slice(0, 5).join(', ')}`);
  }
  const reportPath = path.join(out, 'report.json'), prior = resume && existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
  if (resume && !prior) throw new Error(`--resume: no report at ${reportPath}`);
  if (prior && (prior.head !== head || prior.protocol !== (protocol ?? null) || prior.model !== (model === 'haiku' ? loadPolicy().policy.models.find(m => m.class === 'M').id : 'scripted')))
    throw new Error('--resume: the saved report was made at another commit, protocol or model');
  const chromium = chromiumPath() ? (await import('playwright')).chromium : null;
  const reserve = PARAMS.maxRuns * (PARAMS.runCapUsd + PARAMS.callCapUsd);
  const policy = loadPolicy(), modelId = policy.policy.models.find(m => m.class === 'M').id;
  const version = (cmd, a) => { try { return execFileSync(cmd, a, { encoding: 'utf8', timeout: 60000 }).trim(); } catch { return null; } };
  const meta = prior ? { ...Object.fromEntries(Object.entries(prior).filter(([key]) => !['rows', 'table', 'safety', 'decisions', 'analysisK', 'spentUsd', 'finishedAt', 'exit'].includes(key))) }
    : { schema: amend ? 'nc1-model/2' : 'nc1-model/1', protocol: protocol ?? null, model: model === 'haiku' ? modelId : 'scripted', policyVersion: policy.policy.policyVersion, cap, reserve, params: PARAMS, arms, k,
      head, dirty, prereg: (() => { try { return sha('research/nodecap-20261021/PREREG-NODECAP-1.md'); } catch { return null; } })(),
      ...(amend ? { amendment: (() => { try { return sha(AMEND1.prereg); } catch { return null; } })(), manifest: (() => { try { return sha(AMEND1.manifest); } catch { return null; } })() } : {}),
      engines: { node: process.version, claude: model === 'haiku' ? version('claude', ['--version']) : null, playwright: (() => { try { return JSON.parse(readFileSync(path.join(ROOT, 'node_modules', 'playwright', 'package.json'), 'utf8')).version; } catch { return null; } })() },
      chromium: !!chromium, startedAt: new Date().toISOString(), resumes: [],
      evidence: model === 'haiku' ? (amend ? `preregistered NC-1 model run, amendment 1 (n = 12 tasks per arm, K = ${k}: directional)` : 'preregistered NC-1 model run (n = 12 per arm, K = 1: directional)')
        : 'development rehearsal: scripted competent model, NOT a capability claim' };
  if (prior) meta.resumes = [...(prior.resumes ?? []), { at: new Date().toISOString(), rowsKept: resumeState(prior.rows).rows.length, rowsBefore: prior.rows.length }];
  const state = prior ? resumeState(prior.rows) : { rows: [], done: new Set(), spent: 0 };
  const rows = state.rows;
  let spent = state.spent, consecutiveEnv = 0, aborted = null;
  const save = () => writeFileSync(reportPath, `${JSON.stringify({ ...meta, spentUsd: spent, ...analyze(rows.filter(r => !r.superseded)),
    ...(amend || k > 1 ? { analysisK: analyzeK(rows, { k, arms }) } : {}), rows }, null, 2)}\n`);
  const one = async ({ task, arm, rep = 1 }, attempt = 1) => {
    if (spent + reserve > cap) return { task, arm, rep, kind: 'competent', attempt, notRun: `spend cap: ${spent.toFixed(4)} spent + ${reserve} reserve > ${cap}` };
    try {
      return { ...(await runEpisode({ task: TASKS.find(t => t.id === task), arm, kind: 'competent', chromium, replay: arm !== 'B', model, runCapUsd: model === 'haiku' ? PARAMS.runCapUsd : 0,
        callCapUsd: PARAMS.callCapUsd, maxRuns: PARAMS.maxRuns, ...(amend ? { archive: path.join(out, 'journal', `${task}-${arm}-r${rep}${attempt > 1 ? `-a${attempt}` : ''}`) } : {}) })), rep, attempt };
    } catch (error) {
      return { task, arm, rep, kind: 'competent', attempt, notRun: `harness error: ${String(error?.code ?? '')} ${String(error?.message ?? error).slice(0, 300)}` };
    }
  };
  const order = (amend || k > 1 || arg('arms') ? orderFor({ arms, k }) : ORDER).filter(s => !only || only.includes(s.task));
  for (const slot of order) {
    if (state.done.has(slotKey(slot))) continue;
    if (aborted) { rows.push({ ...slot, kind: 'competent', notRun: aborted }); continue; }
    const r = await one(slot);
    rows.push(r); spent += spendOf(r);
    consecutiveEnv = PARAMS.envFaults.includes(r.error) ? consecutiveEnv + 1 : 0;
    if (consecutiveEnv >= PARAMS.abortAfterConsecutiveEnvFaults) aborted = `aborted after ${consecutiveEnv} consecutive environment faults`;
    console.error(`${r.task} ${r.arm} r${r.rep ?? 1}: ${r.notRun ?? (r.success ? 'pass' : `fail ${r.error ?? r.status}`)} turns=${r.turns ?? '-'} $${spendOf(r).toFixed(5)} total=$${spent.toFixed(4)}${r.replay ? ` replay:${r.replay.deterministic ? 'same' : 'DIFF'}` : ''}`);
    save();
  }
  // One re-run of each environment-fault episode, at the end, within the cap; the original stays in the report, marked superseded.
  for (const r of owedReruns(rows)) {
    if (aborted) break;
    const again = await one({ task: r.task, arm: r.arm, rep: r.rep ?? 1 }, 2);
    r.superseded = true; rows.push(again); spent += spendOf(again);
    console.error(`${again.task} ${again.arm} r${again.rep ?? 1} (re-run): ${again.notRun ?? (again.success ? 'pass' : `fail ${again.error ?? again.status}`)} total=$${spent.toFixed(4)}`);
    save();
  }
  meta.finishedAt = new Date().toISOString(); meta.exit = aborted ? EXIT_ENV_ABORT : 0;
  save();
  const result = analyze(rows.filter(r => !r.superseded));
  console.log(JSON.stringify({ spentUsd: spent, aborted, table: Object.fromEntries(Object.entries(result.table).map(([a, t]) => [a, { success: t.success, n: t.episodes, P: t.selectionPrecision, R: t.selectionRecall, ctxPerTurn: t.contextTokensPerTurnMean,
    blocked: t.unsafeBlocked, executed: t.unsafeExecuted, proposals: t.proposalsRaised, cost: t.costUsd, wall: t.wallSecondsTotal }])), decisions: result.decisions,
    ...(amend || k > 1 ? { decisionsK: analyzeK(rows, { k, arms }).decisions } : {}),
    replays: rows.filter(r => r.replay).map(r => r.replay.deterministic).reduce((a, d) => ({ ...a, [d ? 'same' : 'diff']: (a[d ? 'same' : 'diff'] ?? 0) + 1 }), {}), out: path.relative(ROOT, out) }, null, 2));
  process.exitCode = aborted ? EXIT_ENV_ABORT : 0;
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
