#!/usr/bin/env node
// WIP COPY (2026-10-15): experiments/autobench/run.mjs at sha256 e46bf1d89692f50568410903c7e5a4f1f009fa910637ed84c5f1a8e608d0057b plus
// the pipeline-harness registry (PIPELINE_HARNESSES / PIPELINE_STUBS: codeowned + secondreader, arm A0+SR). Kept apart from
// run.mjs so that runs launched with the current run.mjs can still --resume (launch.json pins the runner hash). Merge in a
// window with no autobench run active or resumable: if run.mjs still has the hash above, `git mv`/`mv` this file onto it and
// delete these six lines; otherwise re-apply the registry hunks (`diff run.mjs run-sr-wip.mjs`). Then run
// `node --test experiments/autobench/test/*.test.mjs`. Until then, A0+SR runs use this file.
// AutomationBench runner (experiments/autobench; notes: research/automationbench-20261014/NOTES.md).
//
// Per task: bridge.py prepares the task exactly as the official eval loads it; per fork, a bridge process serves the
// official 'api' tools through a file mailbox while ONE sandboxed `claude -p` session (src/executors/claude-code.mjs)
// works the task with the official prompt content (system prompt + user message; the harness adds only how the tools
// are reached); then the official rubric grades the live world into a host-only directory. With --k > 1 the k forks
// start from copies of the same exported initial world and the final result is the majority of their final-state
// diffs (generator outputs masked). Live files stay outside the repo; results are copied in at the end.
//
//   node experiments/autobench/run.mjs --model claude-haiku-5-5 --subset 30 --seed 1 --cap 10 [--k 3] [--concurrency 4]
//   node experiments/autobench/run.mjs --model claude-haiku-5-5 --tasks <domain>.<task>,<domain>.<task> --cap 2
//   node experiments/autobench/run.mjs --scripted steps.json --tasks ...     ($0: no model; steps.json = {task: [{calls}]})
//   node experiments/autobench/run.mjs --dry-run --subset 12                 (select + prepare + print one prompt; $0)
//   node experiments/autobench/run.mjs --harness foundry --pool devTrain --subset 6 --model claude-haiku-5-5 --cap 1
//                                                                            (arm A1: harness/foundry.mjs; dev tasks only
//                                                                             unless --harness-hash matches the frozen one)
// Options: --domains sales,hr (default: the six scored domains; 'simple' is allowed) --budget 0.75 (USD per session)
//   --max-steps 50 --timeout-min 20 --det record|seed|off --effort low|medium|high --tools Bash --keep (workdirs)
//   --run-id ID --live DIR --out DIR (default research/automationbench-20261014/runs/<run-id>) --no-copy
//   --pool dev|devTrain|devCheck|test|testRef (select from SPLIT-v1.json; with --subset N: N stratified, seeded)
//   --harness foundry --harness-hash H --cli-max-turns N|off (A1 step guard, default max-steps - 1)
//   --test-run AB-v1 (A0 only: the preregistered test run may hold test-split tasks)
//   --date-note (AM-9: both arms say the session date is the host's, not the task's; recorded in the summary)
//   --harness codeowned [--node-models role=model,...] (arm A1-C: harness/codeowned.mjs, the host-run pipeline; every model
//                                                        call of the pipeline counts toward the 50 responses; --scripted stub = $0)
//   --harness secondreader [--node-models role=model,...] (arm A0+SR: harness/secondreader.mjs, A0 unchanged + one clean-context
//                                                        reader call + at most one repair session; same accounting; --scripted stub = $0)
// Every fork is audited host-side after its session (accounting.mjs): model responses as the official loop counts them,
// world usage, the H3 rule (more than max-steps responses, or a world step issued by response >= max-steps) and L5
// (other models, network or package commands, benchmark references, no host transcript); a violation scores as a fail
// in the headline and the live grade is kept as liveFinal.
// Split hygiene (PREREG-AB-v1 §1.3, §6.1), every arm and mode: test-split tasks are refused before anything is prepared,
// except A1 given the frozen harness hash and A0 given --test-run AB-v1 (model runs only; never a dry or scripted run).
// A run that holds devCheck or test tasks is sealed: no per-task grade is logged, and the repo copy keeps the per-task
// records in results.sealed.jsonl (read only after the go/no-go or the analysis, PREREG §5, §6.3).
// Environment faults (a rate or usage limit, the model unavailable, no sandbox; experiments/lib ENV_FAULTS) are not task
// outcomes: the task's record goes to results.faults.jsonl, no new session starts, and the run stops without a headline
// (exit 3). `--resume` with the same command keeps every recorded task and reruns the rest; a resume whose settings or
// runner differ from launch.json is refused.
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, appendFileSync, writeFileSync, constants as fsc } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { runClaudeCode, WORK_ROOT, nestedModelUses, DEFAULT_KEEP_RO } from '../../src/executors/claude-code.mjs';
import { CHILD_ENV_ALLOWED, loadPolicy, modelById } from '../../src/models/policy.mjs';
import { BRIDGE, CORPUS, PUBLIC_DOMAINS, REPO, TOOL_CLIENT, adapterText, bridgeJson, listTasks, materializeWorkdir, readJson, scriptedRunner, sha256, startServe, stratifiedSubset, writeJson } from './lib.mjs';
import { auditSession, readCalls, readStream, worldUsage } from './accounting.mjs';
import { assertDevOnly, domainOf, loadSplit } from './split.mjs';
import { HARNESS_ID, HARNESS_VERSION, cliVersion, collectLedger, harnessConfig, harnessManifest, harnessSystemPrompt, writeCliGuard } from './harness/foundry.mjs';
import { ENV_FAULTS } from '../lib/runner.mjs';

/** A fork whose session met an environment fault: not a task outcome (the run stops and the task reruns on --resume). */
export const isEnvFault = f => ENV_FAULTS.has(f?.sessionError);

export const DEFAULTS = Object.freeze({ k: 1, budgetUsd: 0.75, concurrency: 4, maxSteps: 50, timeoutMin: 20, det: 'record', tools: ['Bash'], seed: '1' });
/** The A0 test-run acknowledgement (PREREG-AB-v1 §6): `--test-run AB-v1`. */
export const TEST_RUN_TOKEN = 'AB-v1';
/** Arm A1-C's harness id (harness/codeowned.mjs, loaded only when selected). */
export const CODEOWNED = 'codeowned';
/** Host-run pipeline harnesses (every model call is a node; loaded only when selected) and their $0 stand-ins. */
export const PIPELINE_HARNESSES = Object.freeze({ [CODEOWNED]: './harness/codeowned.mjs', secondreader: './harness/secondreader.mjs' });
export const PIPELINE_STUBS = Object.freeze({ [CODEOWNED]: './harness/codeowned-stubs.mjs', secondreader: './harness/secondreader-stubs.mjs' });

/** The cost- and prompt-relevant variables the CLI child inherits (the policy's closed childEnv list): name -> value or
 * null. The executor passes these through from the host shell, so they are recorded per run. */
export const childEnvSnapshot = (env = process.env) => Object.fromEntries(CHILD_ENV_ALLOWED.map(k => [k, typeof env[k] === 'string' ? env[k] : null]));

function provenance(policy, { cli = null } = {}) {
  const git = args => { try { return execFileSync('git', ['-C', CORPUS, ...args], { encoding: 'utf8' }).trim(); } catch { return null; } };
  const file = p => (existsSync(p) ? sha256(readFileSync(p)) : null);
  return { automationbenchCommit: git(['rev-parse', 'HEAD']), uvLockSha256: file(path.join(CORPUS, 'uv.lock')), bridgeSha256: file(BRIDGE),
    toolClientSha256: file(TOOL_CLIENT), runnerSha256: file(new URL(import.meta.url).pathname), policyHash: policy?.hash ?? null,
    policyVersion: policy?.policy?.policyVersion ?? null, policyFileSha256: file(path.join(REPO, 'policy/models.json')), node: process.version,
    cli, childEnv: childEnvSnapshot() };
}

/** A hard USD cap over reserved session budgets: a session starts only if spent + reserved + its budget <= cap. */
export function makeLedger(capUsd) {
  const l = { capUsd, spent: 0, reserved: 0, unknown: 0, knownUsd: 0, unknownUpperUsd: 0 };
  l.tryReserve = b => { if (l.spent + l.reserved + b <= capUsd + 1e-9) { l.reserved += b; return true; } return false; };
  // Wait while in-flight sessions may still settle below their budgets; give up only when the budget cannot fit even
  // with nothing in flight.
  l.reserve = async b => { while (!l.tryReserve(b)) { if (l.reserved <= 1e-9) return false; await new Promise(r => setTimeout(r, 250)); } return true; };
  l.settle = (b, r) => {
    l.reserved -= b;
    const known = typeof r?.costUsd === 'number' && Number.isFinite(r.costUsd);
    const c = known ? r.costUsd : (r?.costUpperUsd ?? b);
    l.spent += c;
    if (known) l.knownUsd += c; else { l.unknownUpperUsd += c; if (r) l.unknown += 1; }
  };
  return l;
}

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } });
  await Promise.all(workers);
}

/** The session transcript into the host directory, only if it is a regular file: the workdir is agent-writable, so a
 * planted symlink must not make the host copy (or later read) a file the sandbox hid. */
function copyTranscript(workdir, hostDir) {
  const src = path.join(workdir, '.executor-transcript.jsonl');
  try { if (!lstatSync(src).isFile()) return; } catch { return; }
  try { copyFileSync(src, path.join(hostDir, 'transcript.jsonl'), fsc.COPYFILE_EXCL); } catch {}
}

const summarizeGrade = g => g && ({ partial_credit: g.partial_credit, task_completed_correctly: g.task_completed_correctly, n_scored: g.n_scored, n_passed: g.n_passed,
  failed_types: [...new Set((g.assertion_results ?? []).filter(a => !a.excluded && !a.passed).map(a => a.type))].sort(), grade_error: g.error ?? null });

/** Tasks from the frozen split (SPLIT-v1.json): a named pool, all of it in domain order, or n stratified and seeded. */
export function poolTasks(pool, { subset, seed, domains = PUBLIC_DOMAINS, split = loadSplit() } = {}) {
  const pools = { dev: split.dev, devTrain: split.dev.filter(t => !split.devCheck.includes(t)), devCheck: split.devCheck, test: split.test, testRef: split.testRef };
  if (!pools[pool]) throw new Error(`unknown pool ${pool} (one of ${Object.keys(pools).join(', ')})`);
  const rows = pools[pool].map(t => ({ task: t, domain: domainOf(t) })).filter(r => domains.includes(r.domain));
  return subset ? stratifiedSubset(rows, subset, seed, domains) : domains.flatMap(d => rows.filter(r => r.domain === d).map(r => r.task));
}

const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const max = xs => (xs.length ? Math.max(...xs) : null);
/** Host-side accounting over the forks of a run (both arms): usage, step accounting, ledgers, H3 overrides. */
function accountingSummary(results) {
  const fs = results.flatMap(r => r.forks).filter(f => !f.skipped);
  const num = (f, k1, k2) => f[k1]?.[k2];
  const col = (k1, k2) => fs.map(f => num(f, k1, k2)).filter(x => typeof x === 'number');
  const stat = (k1, k2) => ({ mean: mean(col(k1, k2)), max: max(col(k1, k2)) });
  const ledgers = fs.filter(f => f.ledger);
  return {
    modelResponses: stat('session', 'modelResponses'), toolResponses: stat('session', 'toolResponses'), numTurnsCli: stat('session', 'numTurns'),
    worldSteps: stat('usage', 'worldSteps'), worldCalls: stat('usage', 'worldCalls'), reads: stat('usage', 'reads'), searches: stat('usage', 'searches'), writes: stat('usage', 'writes'),
    stoppedByStepGuard: fs.filter(f => f.session?.stopReason === 'max_turns').length,
    extraModelCalls: fs.reduce((s, f) => s + (f.session?.extraModelCalls ?? 0), 0),
    compactions: fs.reduce((s, f) => s + (f.session?.compactions ?? 0), 0),
    capViolations: results.filter(r => r.headlineOverride).length,
    l5Violations: fs.filter(f => (f.session?.violations ?? []).some(v => v.startsWith('L5'))).length,
    models: [...new Set(fs.flatMap(f => f.session?.models ?? []))].sort(),
    ledger: ledgers.length ? { collected: ledgers.filter(f => f.ledger.present).length, of: ledgers.length, items: { mean: mean(ledgers.filter(f => f.ledger.present).map(f => f.ledger.items)), max: max(ledgers.filter(f => f.ledger.present).map(f => f.ledger.items)) },
      withPlan: ledgers.filter(f => f.ledger.hasPlan).length, withVerification: ledgers.filter(f => f.ledger.hasVerification).length } : null,
  };
}

/**
 * runTasks(opts) -> { summary, results }. opts: { model, tasks?, subset?, seed?, domains?, k, capUsd, budgetUsd,
 * concurrency, maxSteps, timeoutMin, det, effort, tools, runId, liveRoot, outDir|null, keep, runner, dryRun, log }.
 * `runner` defaults to runClaudeCode (sandboxed); tests and --scripted pass a scripted runner (no model, $0).
 */
export async function runTasks(o) {
  const opt = { ...DEFAULTS, ...o };
  const log = opt.log ?? (m => process.stderr.write(m + '\n'));
  const scripted = Boolean(opt.runner);
  const runner = opt.runner ?? runClaudeCode;
  // Arm A1 (harness/foundry.mjs). A0 (no harness) keeps every byte of its prompt and runner arguments.
  const harness = opt.harness ?? null;
  if (harness !== null && harness !== HARNESS_ID && !Object.hasOwn(PIPELINE_HARNESSES, harness)) throw new Error(`unknown harness ${harness} (known: ${[HARNESS_ID, ...Object.keys(PIPELINE_HARNESSES)].join(', ')})`);
  if (harness && opt.k !== 1) throw new Error('the Foundry harness (A1) acts once per task in one world: k > 1 is forked rehearsal (A1F), a separate arm');
  // Pipeline arms (A1-C: harness/codeowned.mjs; A0+SR: harness/secondreader.mjs) are loaded only when selected, so A0 and A1
  // load nothing new.
  const co = harness && Object.hasOwn(PIPELINE_HARNESSES, harness) ? await import(new URL(PIPELINE_HARNESSES[harness], import.meta.url).href) : null;
  const models = co ? co.nodeModels(opt.model, opt.nodeModels) : null;
  const cliMaxTurns = harness === HARNESS_ID ? (opt.cliMaxTurns ?? opt.maxSteps - 1) : null;
  // The guard may be off (0) or tighter, never looser than the official loop (maxSteps - 1 tool-calling responses).
  if (harness === HARNESS_ID && !(Number.isInteger(cliMaxTurns) && cliMaxTurns >= 0 && cliMaxTurns <= opt.maxSteps - 1)) throw new Error(`--cli-max-turns must be off or an integer in 1..${opt.maxSteps - 1}`);
  if (co && scripted && !opt.dryRun && !opt.nodeRunner) throw new Error(`a scripted ${harness === CODEOWNED ? 'A1-C' : harness} run needs scripted model nodes too (nodeRunner; CLI: --scripted stub)`);
  let policy = null;
  if (!scripted && !opt.dryRun) {
    policy = loadPolicy();
    const entry = modelById(policy.policy, opt.model); // refuses ids the policy does not list
    if (entry.provider !== 'claude-cli') throw new Error(`model ${opt.model} is not served by the claude-cli provider`);
    for (const m of new Set(Object.values(models ?? {}))) if (modelById(policy.policy, m).provider !== 'claude-cli') throw new Error(`model ${m} is not served by the claude-cli provider`);
    if (!(opt.capUsd > 0)) throw new Error('--cap (hard USD cap for the run) is required for model runs');
  }
  const runId = opt.runId ?? `ab-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-${sha256(String(Math.random())).slice(0, 6)}`;
  const live = opt.liveRoot ?? path.join(WORK_ROOT, 'autobench', runId);
  mkdirSync(live, { recursive: true });
  const domains = opt.domains ?? PUBLIC_DOMAINS;

  // 1. selection
  let tasks = opt.tasks;
  if (!tasks?.length && opt.pool) tasks = poolTasks(opt.pool, { subset: opt.subset, seed: opt.seed, domains });
  if (!tasks?.length) {
    const all = await listTasks(domains, { liveDir: live });
    tasks = stratifiedSubset(all, opt.subset ?? 12, opt.seed, domains);
  }
  const taskDomains = [...new Set(tasks.map(t => t.split('.')[0]))];
  // Split hygiene (PREREG-AB-v1 §1.3, §6.1), every arm and mode, checked before anything is prepared: dev tasks (and
  // simple) only. Only the test run lifts it: A1 given the frozen harness hash, which must equal the hash recomputed from
  // disk and this run's settings; A0 (a model run) given --test-run AB-v1. A dry run prints a task's prompt and a
  // scripted A0 run grades host-side, so neither ever touches a test task.
  if (opt.testRun != null && opt.testRun !== TEST_RUN_TOKEN) throw new Error(`--test-run must be ${TEST_RUN_TOKEN}`);
  const cli = scripted ? null : cliVersion();
  let manifest = null, guard = null;
  if (harness) {
    manifest = co ? (co.pipelineManifest ?? co.codeownedManifest)((co.pipelineConfig ?? co.codeownedConfig)({ ...opt, cli })) : harnessManifest(harnessConfig({ ...opt, cliMaxTurns, cli }));
    if (opt.harnessHash && opt.harnessHash !== manifest.sha256) throw new Error(`harness hash mismatch: given ${opt.harnessHash}, recomputed ${manifest.sha256} (files or settings changed)`);
  }
  const testRunAuthorized = !opt.dryRun && (harness ? Boolean(opt.harnessHash) : !scripted && opt.testRun === TEST_RUN_TOKEN);
  if (!testRunAuthorized) assertDevOnly(tasks);
  // Resume: a live directory that already holds a run continues only with --resume and the launch settings unchanged.
  const resultsFile = path.join(live, 'results.jsonl'), faultsFile = path.join(live, 'results.faults.jsonl'), launchFile = path.join(live, 'launch.json');
  const launch = { tasks, model: scripted ? null : opt.model ?? null, scripted, harness: manifest?.sha256 ?? null, cliMaxTurns, k: opt.k, det: opt.det,
    maxSteps: opt.maxSteps, budgetUsd: opt.budgetUsd, capUsd: scripted ? null : opt.capUsd, timeoutMin: opt.timeoutMin, effort: opt.effort ?? null,
    tools: opt.tools, dateNote: Boolean(opt.dateNote), runnerSha256: sha256(readFileSync(new URL(import.meta.url))) };
  const readRecords = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
  let kept = [];
  if (!opt.dryRun && (existsSync(resultsFile) || existsSync(launchFile))) {
    if (!opt.resume) throw new Error(`${live} already holds a run: pass --resume to continue it, or use a new --run-id`);
    if (!existsSync(launchFile) || JSON.stringify(readJson(launchFile)) !== JSON.stringify(launch)) throw new Error(`resume refused: the settings or the runner differ from ${launchFile}`);
    kept = readRecords(resultsFile);
  } else if (!opt.dryRun) writeJson(launchFile, launch);
  if (harness && cliMaxTurns > 0) guard = writeCliGuard(path.join(live, 'harness-bin'), { maxTurns: cliMaxTurns, target: opt.cliTarget ?? 'claude' });
  // Sealed run (devCheck go/no-go looks, the test run): per-task grades never reach the log or a plain repo file.
  const split = loadSplit();
  const sealed = opt.sealed ?? tasks.some(t => split.devCheck.includes(t) || split.test.includes(t));
  const harnessId = co ? co.HARNESS_ID : HARNESS_ID, harnessVersion = co ? co.HARNESS_VERSION : HARNESS_VERSION;
  log(`[autobench] run ${runId}: ${tasks.length} tasks, k=${opt.k}, ${harness ? `harness ${harnessId} ${harnessVersion} (${manifest.sha256.slice(0, 12)})` : 'no harness'}, live ${live}`);

  // 2. prepare (one official dataset build)
  const prep = path.join(live, 'prep');
  await bridgeJson(['prepare', '--domains', taskDomains.join(','), '--tasks', tasks.join(','), '--out', prep, '--det', opt.det, '--max-steps', String(opt.maxSteps)], { liveDir: live });
  const systemPromptFor = (p, cat) => (co ? co.actSystemPrompt(p.system, cat, opt.maxSteps, { dateNote: opt.dateNote, brief: '(A1-C work brief: generated per task at run time from the world)' })
    : harness ? harnessSystemPrompt(p.system, cat, opt.maxSteps, { dateNote: opt.dateNote }) : `${p.system}\n\n${adapterText(cat, opt.maxSteps, { dateNote: opt.dateNote })}`);
  if (opt.dryRun) {
    const p = readJson(path.join(prep, tasks[0], 'prompt.json')), cat = readJson(path.join(prep, tasks[0], 'catalog.json'));
    return { summary: { runId, dryRun: true, tasks, live, harness, systemPrompt: systemPromptFor(p, cat), user: p.user }, results: [] };
  }

  // 3. sessions
  const ledger = makeLedger(scripted ? Infinity : opt.capUsd);
  // A resumed run keeps its recorded tasks (each must still match its contract) and counts all earlier spend on the cap.
  const faulted = readRecords(faultsFile);
  for (const r of kept) if (readJson(path.join(prep, r.task, 'meta.json')).contract_sha256 !== r.contract_sha256) throw new Error(`resume refused: the contract of ${r.task} changed`);
  for (const r of [...kept, ...faulted]) {
    const known = r.forks.filter(f => !f.costUnknown).reduce((s, f) => s + (f.costUsd ?? 0), 0);
    ledger.spent += r.costUsd; ledger.knownUsd += known; ledger.unknownUpperUsd += r.costUsd - known; ledger.unknown += r.forks.filter(f => f.costUnknown).length;
  }
  const done = new Set(kept.map(r => r.task));
  if (kept.length) log(`[autobench] resuming ${runId}: ${kept.length}/${tasks.length} tasks kept, ${faulted.length} earlier fault records, $${ledger.spent.toFixed(4)} already spent`);
  const jobs = tasks.flatMap((task, ti) => (done.has(task) ? [] : Array.from({ length: opt.k }, (_, fork) => ({ task, ti, fork }))));
  const forks = new Map(tasks.map(t => [t, []]));
  const results = [...kept];
  let stopped = null;
  const finishTask = async task => {
    const fs = forks.get(task).sort((a, b) => a.fork - b.fork);
    const meta = readJson(path.join(prep, task, 'meta.json'));
    let final = fs[0]?.grade ?? null, vote = null;
    if (opt.k > 1) {
      const hosts = fs.map(f => f.hostDir);
      try {
        await bridgeJson(['vote', '--base', path.join(prep, task, 'world0.json'), '--forks', hosts.join(','), '--out', path.join(live, 'host', task, 'vote.json')], { liveDir: live });
        const v = readJson(path.join(live, 'host', task, 'vote.json'));
        vote = { winner: v.winner, agreement: v.agreement, majority: v.majority, groups: v.groups.map(g => g.forks) };
        final = v.winner === null ? null : fs[v.winner].grade;
      } catch (e) { vote = { error: String(e.message).slice(0, 500) }; final = null; }
    }
    const rec = { task, domain: meta.domain, example_id: meta.example_id, contract_sha256: meta.contract_sha256, k: opt.k,
      forks: fs.map(f => ({ fork: f.fork, ...summarizeGrade(f.grade), steps: f.steps ?? null, costUsd: f.costUsd ?? null, costUnknown: f.costUnknown ?? false,
        turns: f.turns ?? null, durationMs: f.durationMs ?? null, sessionError: f.sessionError ?? null, harnessError: f.harnessError ?? null, skipped: f.skipped ?? null, nestedModelUses: f.nestedModelUses ?? 0,
        session: f.session ?? null, usage: f.usage ?? null, ...(harness === HARNESS_ID ? { ledger: f.ledger ?? null } : {}), ...(co ? { pipeline: f.pipeline ?? null } : {}), accountingError: f.accountingError ?? null })),
      vote, final: final ? summarizeGrade(final) : null, costUsd: fs.reduce((s, f) => s + (f.costUsd ?? f.costUpperUsd ?? 0), 0) };
    // An environment fault (or a fork not started after one) is not an outcome: kept as raw evidence, rerun on --resume.
    if (fs.some(f => f.deferred || isEnvFault(f))) {
      if (fs.some(isEnvFault)) appendFileSync(faultsFile, JSON.stringify({ ...rec, stoppedBy: stopped }) + '\n');
      log(`[autobench] ${task}: deferred (${fs.find(isEnvFault)?.sessionError ?? 'not started after an environment fault'})`);
      return;
    }
    // H3 (host-side step cap) and L5 (PREREG §8): a single-rollout task-run whose session exceeded the official step
    // accounting or broke L5 scores as a fail in the headline; its live grade is kept beside it.
    const over = opt.k === 1 ? fs[0]?.session?.violations ?? [] : [];
    if (over.length && rec.final) {
      rec.liveFinal = rec.final;
      rec.final = { ...rec.final, partial_credit: 0, task_completed_correctly: 0 };
      rec.headlineOverride = `${over.some(v => v.startsWith('L5')) ? 'L5 audit' : 'H3 step cap'}: ${over.join('; ')}`;
    }
    results.push(rec);
    appendFileSync(resultsFile, JSON.stringify(rec) + '\n');
    if (sealed) { log(`[autobench] ${task}: ${rec.final ? 'graded' : 'no grade'} (sealed run: the grade stays in the per-task records)`); return; }
    log(`[autobench] ${task}: ${rec.final ? `pc=${rec.final.partial_credit.toFixed(3)} pass=${rec.final.task_completed_correctly}` : 'no grade'}${rec.headlineOverride ? ` [${rec.headlineOverride}; live pass=${rec.liveFinal.task_completed_correctly}]` : ''}${vote?.agreement !== undefined ? ` vote=${vote.agreement}` : ''} $${rec.costUsd.toFixed(4)}`);
  };
  const remaining = new Map(tasks.map(t => [t, opt.k]));

  await pool(jobs, opt.concurrency, async ({ task, ti, fork }) => {
    const pdir = path.join(prep, task);
    const meta = readJson(path.join(pdir, 'meta.json'));
    const hostDir = path.join(live, 'host', task, `fork-${fork}`);
    const workdir = path.join(live, 'w', `${String(ti).padStart(4, '0')}-${fork}`);
    const rec = { fork, hostDir };
    if (stopped) {
      rec.deferred = stopped;
    } else if (!(await ledger.reserve(opt.budgetUsd))) {
      rec.skipped = `cap: spent ${ledger.spent.toFixed(4)} + reserved ${ledger.reserved.toFixed(4)} + ${opt.budgetUsd} > ${opt.capUsd}`;
    } else {
      let r = null, bridge = null, started = false;
      try {
        rmSync(workdir, { recursive: true, force: true });
        const catalog = readJson(path.join(pdir, 'catalog.json')), prompt = readJson(path.join(pdir, 'prompt.json'));
        materializeWorkdir(workdir, catalog);
        bridge = startServe({ liveDir: live, input: path.join(pdir, 'input.json'), world: path.join(pdir, 'world0.json'), mailbox: path.join(workdir, '.tools'),
          hostDir, det: opt.det, maxSteps: opt.maxSteps, fork, expectContract: meta.contract_sha256 });
        await bridge.ready;
        started = true;
        // A1 adds only: its system prompt (official + A0's tool section + the harness section), the step guard (CLI
        // wrapper, kept read-only outside the workdir) and maxTurns for scripted stand-ins of the guard.
        // A1-C: the host-run pipeline is the "session"; it gets the official prompt, the catalog and the mailbox only.
        const slotId = `${String(ti).padStart(4, '0')}-${fork}`;
        r = co ? await co.runPipeline({ official: { system: prompt.system, user: prompt.user }, catalog, workdir, nodeRoot: path.join(live, 'nodes', slotId), hostDir, guardDir: path.join(live, 'harness-bin', slotId),
          maxSteps: opt.maxSteps, budgetUsd: opt.budgetUsd, timeoutMs: opt.timeoutMin * 60_000, dateNote: opt.dateNote, models, effort: opt.effort ?? null, tools: opt.tools, runner,
          nodeRunner: opt.nodeRunner ?? runner, cliTarget: opt.cliTarget ?? 'claude', scripted, pipeline: opt.pipeline, log })
          : await runner({ model: opt.model, prompt: prompt.user, systemPrompt: systemPromptFor(prompt, catalog), workdir, files: {},
          budgetUsd: opt.budgetUsd, timeoutMs: opt.timeoutMin * 60_000, effort: opt.effort ?? null, tools: opt.tools, task: { name: task, fork },
          ...(harness ? { maxTurns: cliMaxTurns || null } : {}), ...(guard ? { binary: guard.binary, keepRo: [...DEFAULT_KEEP_RO, guard.dir] } : {}) });
        if (co) rec.pipeline = r.pipeline;
        Object.assign(rec, { costUsd: r.costUsd ?? null, costUnknown: Boolean(r.costUnknown), costUpperUsd: r.costUpperUsd ?? opt.budgetUsd, turns: r.turns ?? null,
          durationMs: r.durationMs ?? null, sessionError: r.error?.code ?? null, nestedModelUses: nestedModelUses(r.toolUses ?? []) });
        const done = await bridge.stop();
        rec.steps = done.steps;
        rec.grade = readJson(path.join(hostDir, 'grade.json'));
      } catch (e) {
        rec.harnessError = String(e?.message ?? e).slice(0, 800);
        bridge?.kill();
      } finally {
        // A runner that threw after it started may have spent: count it at its budget (an upper bound), never at 0.
        if (!r && started) Object.assign(rec, { costUsd: null, costUnknown: true, costUpperUsd: opt.budgetUsd });
        ledger.settle(opt.budgetUsd, r ?? (started ? { costUsd: null, costUpperUsd: opt.budgetUsd } : { costUsd: 0 }));
        copyTranscript(workdir, hostDir);
        if (harness === HARNESS_ID && started) { try { rec.ledger = collectLedger(workdir, hostDir); } catch (e) { rec.ledger = { present: false, reason: `error: ${String(e?.message ?? e).slice(0, 200)}` }; } }
        if (!opt.keep) rmSync(workdir, { recursive: true, force: true });
      }
      // Host-side accounting, after the session, from host-captured files only (both arms).
      if (started) {
        try {
          const calls = readCalls(path.join(hostDir, 'calls.jsonl'));
          const events = readStream(path.join(hostDir, 'transcript.jsonl'));
          rec.usage = worldUsage(calls);
          // A1-C: H3 on the sum over every model call of the pipeline and L5 on every node transcript (auditPipeline).
          rec.session = co ? co.auditPipeline({ nodes: r?.nodes ?? [], clientLog: r?.clientLog ?? [], calls, maxSteps: opt.maxSteps, hostDir, scripted })
            : auditSession({ events, calls, maxSteps: opt.maxSteps, fallbackTurns: rec.turns ?? null, expectModel: scripted ? null : opt.model });
          // A model session without a host copy of its transcript (none written, or a planted link refused) cannot be
          // audited: L5 fails it.
          if (!scripted && (co ? !r?.nodes?.length : !events.length)) rec.session.violations.push('L5: no host transcript (step and model accounting unavailable)');
        } catch (e) { rec.accountingError = String(e?.message ?? e).slice(0, 500); }
      }
      if (isEnvFault(rec)) stopped ??= `${rec.sessionError} at ${task} fork ${fork}`;
    }
    forks.get(task).push(rec);
    remaining.set(task, remaining.get(task) - 1);
    if (remaining.get(task) === 0) await finishTask(task);
  });

  // 4. summary
  results.sort((a, b) => tasks.indexOf(a.task) - tasks.indexOf(b.task));
  if (stopped) {
    log(`[autobench] STOPPED on an environment fault (${stopped}): ${results.length}/${tasks.length} tasks recorded, $${ledger.spent.toFixed(4)} spent of $${opt.capUsd}; no summary or headline. Re-run the same command with --resume after the reset.`);
    return { summary: { runId, stopped, recorded: results.length, of: tasks.length, spentUsd: ledger.spent, live }, results, stopped };
  }
  const faultRecords = readRecords(faultsFile);
  const pass = r => (r.final ? r.final.task_completed_correctly : 0), pc = r => (r.final ? r.final.partial_credit : 0);
  const byDomain = Object.fromEntries(taskDomains.map(d => { const rs = results.filter(r => r.domain === d); return [d, { n: rs.length, pass_rate: mean(rs.map(pass)), mean_partial_credit: mean(rs.map(pc)) }]; }));
  const fork0 = results.map(r => r.forks.find(f => f.fork === 0)).filter(Boolean);
  const summary = {
    runId, label: scripted ? 'scripted (no model)' : `model ${opt.model}`, model: scripted ? null : opt.model, scripted,
    evidence: tasks.some(t => split.test.includes(t)) ? 'sealed: PREREG-AB-v1 test split (held-out half of the public set)' : 'development/diagnostic (public AutomationBench set; not held-out)',
    arm: co ? (co.ARM ?? 'A1-C (code-owned harness)') : harness ? 'A1 (harness)' : 'A0 (no harness)', sealed, testSplitTasks: tasks.filter(t => split.test.includes(t)).length,
    harness: co ? { id: co.HARNESS_ID, version: co.HARNESS_VERSION, manifestSha256: manifest.sha256, frozenHashGiven: Boolean(opt.harnessHash), nodeModels: models, pipeline: manifest.config.pipeline,
      extraModelCalls: results.reduce((s, r) => s + r.forks.reduce((t, f) => t + (f.session?.extraModelCalls ?? 0), 0), 0) }
      : harness ? { id: HARNESS_ID, version: HARNESS_VERSION, manifestSha256: manifest.sha256, frozenHashGiven: Boolean(opt.harnessHash), cliMaxTurns, stepGuard: Boolean(guard), extraModelCalls: 0 } : null,
    selection: opt.tasks?.length ? { tasks: opt.tasks } : opt.pool ? { pool: opt.pool, subset: opt.subset ?? null, seed: opt.subset ? opt.seed : null, domains } : { subset: opt.subset ?? 12, seed: opt.seed, domains }, tasks,
    dateNote: Boolean(opt.dateNote), k: opt.k, det: opt.det, maxSteps: opt.maxSteps, budgetUsdPerSession: opt.budgetUsd, capUsd: scripted ? null : opt.capUsd, tools: opt.tools, effort: opt.effort ?? null,
    n: results.length, n_graded: results.filter(r => r.final).length,
    pass_rate: mean(results.map(pass)), mean_partial_credit: mean(results.map(pc)), by_domain: byDomain,
    // The live grades before the H3 step-cap override (equal to the headline when no task-run exceeded the cap).
    live_pass_rate: mean(results.map(r => (r.liveFinal ?? r.final)?.task_completed_correctly ?? 0)),
    mean_cost_per_task_usd: results.length ? results.reduce((s, r) => s + r.costUsd, 0) / results.length : null,
    accounting: accountingSummary(results),
    ...(opt.k > 1 ? { fork0_pass_rate: mean(fork0.map(f => f.task_completed_correctly ?? 0)), any_fork_pass_rate_diagnostic: mean(results.map(r => (r.forks.some(f => f.task_completed_correctly === 1) ? 1 : 0))),
      majority_rate: mean(results.map(r => (r.vote?.majority ? 1 : 0))) } : {}),
    // spentUsd is an upper bound: CLI-reported costs plus every session whose cost is unknown counted at its budget.
    cost: { spentUsd: ledger.spent, knownUsd: ledger.knownUsd, unknownUpperUsd: ledger.unknownUpperUsd, unknownCostSessions: ledger.unknown, sessions: results.reduce((s, r) => s + r.forks.length, 0),
      skipped: results.flatMap(r => r.forks).filter(f => f.skipped).length },
    // Tasks rerun after an environment fault (their fault records stay in results.faults.jsonl, live and repo copy).
    envFaults: { records: faultRecords.length, tasks: [...new Set(faultRecords.map(r => r.task))].length, sessions: faultRecords.reduce((s, r) => s + r.forks.filter(isEnvFault).length, 0), spentUsd: faultRecords.reduce((s, r) => s + r.costUsd, 0) },
    // Pre-registered: a tool use that starts a nested model (CLI or API) spends outside every ledger and voids the run.
    nestedModelUses: results.reduce((s, r) => s + r.forks.reduce((t, f) => t + (f.nestedModelUses ?? 0), 0), 0),
    void: results.some(r => r.forks.some(f => (f.nestedModelUses ?? 0) > 0)) ? 'nested model use in a session transcript' : null,
    errors: results.flatMap(r => r.forks.filter(f => f.sessionError || f.harnessError).map(f => ({ task: r.task, fork: f.fork, sessionError: f.sessionError, harnessError: f.harnessError }))),
    provenance: { ...provenance(policy, { cli }), accountingSha256: sha256(readFileSync(new URL('./accounting.mjs', import.meta.url))), harnessManifestSha256: manifest?.sha256 ?? null },
    live, finishedAt: new Date().toISOString(),
  };
  writeJson(path.join(live, 'summary.json'), summary);
  // 5. copy results into the repo (summary + per-task records; transcripts, worlds and grades with assertions stay live).
  // A sealed run's per-task records go to results.sealed.jsonl: not to be read before the go/no-go or the analysis.
  const out = opt.outDir === null ? null : (opt.outDir ?? path.join(REPO, 'research/automationbench-20261014/runs', runId));
  if (out) {
    mkdirSync(out, { recursive: true });
    cpSync(path.join(live, 'summary.json'), path.join(out, 'summary.json'));
    writeFileSync(path.join(out, sealed ? 'results.sealed.jsonl' : 'results.jsonl'), results.map(r => JSON.stringify(r)).join('\n') + '\n');
    if (faultRecords.length) writeFileSync(path.join(out, sealed ? 'results.faults.sealed.jsonl' : 'results.faults.jsonl'), faultRecords.map(r => JSON.stringify(r)).join('\n') + '\n');
    summary.copiedTo = out;
  }
  return { summary, results };
}

function parseArgs(argv) {
  const a = {}, flags = new Set(['keep', 'dry-run', 'no-copy', 'date-note', 'resume']);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error(`unexpected argument ${k}`);
    const name = k.slice(2);
    if (flags.has(name)) a[name] = true; else a[name] = argv[++i];
  }
  return a;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2));
  const num = (v, d) => (v === undefined ? d : Number(v));
  let runner, nodeRunner;
  if (a.scripted && Object.hasOwn(PIPELINE_STUBS, a.harness ?? '')) {
    // Scripted pipeline stand-ins ($0; `--scripted stub`): harness/codeowned-stubs.mjs (A1-C), harness/secondreader-stubs.mjs (A0+SR).
    const { stubNodeRunner, stubSessionRunner } = await import(new URL(PIPELINE_STUBS[a.harness], import.meta.url).href);
    runner = stubSessionRunner(); nodeRunner = stubNodeRunner();
  } else if (a.scripted && a.harness) {
    // Scripted A1 stand-in ($0): steps.json = {task: [{calls} | {write: {content, append}} | both]} (harness/scripted-session.mjs).
    const steps = readJson(a.scripted);
    const { scriptedHarnessRunner } = await import('./harness/scripted-session.mjs');
    runner = scriptedHarnessRunner(({ task }) => steps[task.name] ?? []);
  } else if (a.scripted) { const steps = readJson(a.scripted); runner = scriptedRunner(({ name }) => steps[name] ?? []); }
  const { summary, stopped } = await runTasks({
    model: a.model, tasks: a.tasks ? a.tasks.split(',').filter(Boolean) : undefined, subset: num(a.subset, undefined), seed: a.seed ?? DEFAULTS.seed,
    domains: a.domains ? a.domains.split(',') : undefined, k: num(a.k, DEFAULTS.k), capUsd: num(a.cap, undefined), budgetUsd: num(a.budget, DEFAULTS.budgetUsd),
    concurrency: num(a.concurrency, DEFAULTS.concurrency), maxSteps: num(a['max-steps'], DEFAULTS.maxSteps), timeoutMin: num(a['timeout-min'], DEFAULTS.timeoutMin),
    det: a.det ?? DEFAULTS.det, effort: a.effort, tools: a.tools ? a.tools.split(',') : DEFAULTS.tools, runId: a['run-id'], liveRoot: a.live,
    outDir: a['no-copy'] ? null : a.out, keep: Boolean(a.keep), dryRun: Boolean(a['dry-run']), runner, pool: a.pool,
    dateNote: Boolean(a['date-note']), resume: Boolean(a.resume), harness: a.harness ?? null, harnessHash: a['harness-hash'], testRun: a['test-run'], nodeRunner,
    nodeModels: a['node-models'] ? Object.fromEntries(a['node-models'].split(',').filter(Boolean).map(x => x.split('=').map(y => y.trim()))) : undefined, cliMaxTurns: a['cli-max-turns'] === undefined ? undefined : a['cli-max-turns'] === 'off' ? 0 : Number(a['cli-max-turns']),
  });
  process.stdout.write(JSON.stringify(summary, null, 1) + '\n');
  if (stopped) process.exit(3);
}
