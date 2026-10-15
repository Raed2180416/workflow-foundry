#!/usr/bin/env node
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
//   node experiments/autobench/run.mjs --model claude-haiku-5-5 --tasks sales.multi_hop_lookup,hr.x --cap 2
//   node experiments/autobench/run.mjs --scripted steps.json --tasks ...     ($0: no model; steps.json = {task: [{calls}]})
//   node experiments/autobench/run.mjs --dry-run --subset 12                 (select + prepare + print one prompt; $0)
// Options: --domains sales,hr (default: the six scored domains; 'simple' is allowed) --budget 0.75 (USD per session)
//   --max-steps 50 --timeout-min 20 --det record|seed|off --effort low|medium|high --tools Bash --keep (workdirs)
//   --run-id ID --live DIR --out DIR (default research/automationbench-20261014/runs/<run-id>) --no-copy
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, appendFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { runClaudeCode, WORK_ROOT, nestedModelUses } from '../../src/executors/claude-code.mjs';
import { loadPolicy, modelById } from '../../src/models/policy.mjs';
import { BRIDGE, CORPUS, PUBLIC_DOMAINS, REPO, TOOL_CLIENT, adapterText, bridgeJson, listTasks, materializeWorkdir, readJson, scriptedRunner, sha256, startServe, stratifiedSubset, writeJson } from './lib.mjs';

export const DEFAULTS = Object.freeze({ k: 1, budgetUsd: 0.75, concurrency: 4, maxSteps: 50, timeoutMin: 20, det: 'record', tools: ['Bash'], seed: '1' });

function provenance(policy) {
  const git = args => { try { return execFileSync('git', ['-C', CORPUS, ...args], { encoding: 'utf8' }).trim(); } catch { return null; } };
  const file = p => (existsSync(p) ? sha256(readFileSync(p)) : null);
  return { automationbenchCommit: git(['rev-parse', 'HEAD']), uvLockSha256: file(path.join(CORPUS, 'uv.lock')), bridgeSha256: file(BRIDGE),
    toolClientSha256: file(TOOL_CLIENT), runnerSha256: file(new URL(import.meta.url).pathname), policyHash: policy?.hash ?? null,
    policyVersion: policy?.policy?.policyVersion ?? null, node: process.version };
}

/** A hard USD cap over reserved session budgets: a session starts only if spent + reserved + its budget <= cap. */
export function makeLedger(capUsd) {
  const l = { capUsd, spent: 0, reserved: 0, unknown: 0 };
  l.tryReserve = b => { if (l.spent + l.reserved + b <= capUsd + 1e-9) { l.reserved += b; return true; } return false; };
  // Wait while in-flight sessions may still settle below their budgets; give up only when the budget cannot fit even
  // with nothing in flight.
  l.reserve = async b => { while (!l.tryReserve(b)) { if (l.reserved <= 1e-9) return false; await new Promise(r => setTimeout(r, 250)); } return true; };
  l.settle = (b, r) => {
    l.reserved -= b;
    const known = typeof r?.costUsd === 'number' && Number.isFinite(r.costUsd);
    l.spent += known ? r.costUsd : (r?.costUpperUsd ?? b);
    if (!known && r) l.unknown += 1;
  };
  return l;
}

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } });
  await Promise.all(workers);
}

const summarizeGrade = g => g && ({ partial_credit: g.partial_credit, task_completed_correctly: g.task_completed_correctly, n_scored: g.n_scored, n_passed: g.n_passed,
  failed_types: [...new Set((g.assertion_results ?? []).filter(a => !a.excluded && !a.passed).map(a => a.type))].sort(), grade_error: g.error ?? null });

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
  let policy = null;
  if (!scripted && !opt.dryRun) {
    policy = loadPolicy();
    const entry = modelById(policy.policy, opt.model); // refuses ids the policy does not list
    if (entry.provider !== 'claude-cli') throw new Error(`model ${opt.model} is not served by the claude-cli provider`);
    if (!(opt.capUsd > 0)) throw new Error('--cap (hard USD cap for the run) is required for model runs');
  }
  const runId = opt.runId ?? `ab-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-${sha256(String(Math.random())).slice(0, 6)}`;
  const live = opt.liveRoot ?? path.join(WORK_ROOT, 'autobench', runId);
  mkdirSync(live, { recursive: true });
  const domains = opt.domains ?? PUBLIC_DOMAINS;

  // 1. selection
  let tasks = opt.tasks;
  if (!tasks?.length) {
    const all = await listTasks(domains, { liveDir: live });
    tasks = stratifiedSubset(all, opt.subset ?? 12, opt.seed, domains);
  }
  const taskDomains = [...new Set(tasks.map(t => t.split('.')[0]))];
  log(`[autobench] run ${runId}: ${tasks.length} tasks, k=${opt.k}, live ${live}`);

  // 2. prepare (one official dataset build)
  const prep = path.join(live, 'prep');
  await bridgeJson(['prepare', '--domains', taskDomains.join(','), '--tasks', tasks.join(','), '--out', prep, '--det', opt.det, '--max-steps', String(opt.maxSteps)], { liveDir: live });
  if (opt.dryRun) {
    const p = readJson(path.join(prep, tasks[0], 'prompt.json')), cat = readJson(path.join(prep, tasks[0], 'catalog.json'));
    return { summary: { runId, dryRun: true, tasks, live, systemPrompt: `${p.system}\n\n${adapterText(cat, opt.maxSteps)}`, user: p.user }, results: [] };
  }

  // 3. sessions
  const ledger = makeLedger(scripted ? Infinity : opt.capUsd);
  const jobs = tasks.flatMap((task, ti) => Array.from({ length: opt.k }, (_, fork) => ({ task, ti, fork })));
  const forks = new Map(tasks.map(t => [t, []]));
  const resultsFile = path.join(live, 'results.jsonl');
  const results = [];
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
        turns: f.turns ?? null, durationMs: f.durationMs ?? null, sessionError: f.sessionError ?? null, harnessError: f.harnessError ?? null, skipped: f.skipped ?? null, nestedModelUses: f.nestedModelUses ?? 0 })),
      vote, final: final ? summarizeGrade(final) : null, costUsd: fs.reduce((s, f) => s + (f.costUsd ?? f.costUpperUsd ?? 0), 0) };
    results.push(rec);
    appendFileSync(resultsFile, JSON.stringify(rec) + '\n');
    log(`[autobench] ${task}: ${rec.final ? `pc=${rec.final.partial_credit.toFixed(3)} pass=${rec.final.task_completed_correctly}` : 'no grade'}${vote?.agreement !== undefined ? ` vote=${vote.agreement}` : ''} $${rec.costUsd.toFixed(4)}`);
  };
  const remaining = new Map(tasks.map(t => [t, opt.k]));

  await pool(jobs, opt.concurrency, async ({ task, ti, fork }) => {
    const pdir = path.join(prep, task);
    const meta = readJson(path.join(pdir, 'meta.json'));
    const hostDir = path.join(live, 'host', task, `fork-${fork}`);
    const workdir = path.join(live, 'w', `${String(ti).padStart(4, '0')}-${fork}`);
    const rec = { fork, hostDir };
    if (!(await ledger.reserve(opt.budgetUsd))) {
      rec.skipped = `cap: spent ${ledger.spent.toFixed(4)} + reserved ${ledger.reserved.toFixed(4)} + ${opt.budgetUsd} > ${opt.capUsd}`;
    } else {
      let r = null, bridge = null;
      try {
        rmSync(workdir, { recursive: true, force: true });
        const catalog = readJson(path.join(pdir, 'catalog.json')), prompt = readJson(path.join(pdir, 'prompt.json'));
        materializeWorkdir(workdir, catalog);
        bridge = startServe({ liveDir: live, input: path.join(pdir, 'input.json'), world: path.join(pdir, 'world0.json'), mailbox: path.join(workdir, '.tools'),
          hostDir, det: opt.det, maxSteps: opt.maxSteps, fork, expectContract: meta.contract_sha256 });
        await bridge.ready;
        r = await runner({ model: opt.model, prompt: prompt.user, systemPrompt: `${prompt.system}\n\n${adapterText(catalog, opt.maxSteps)}`, workdir, files: {},
          budgetUsd: opt.budgetUsd, timeoutMs: opt.timeoutMin * 60_000, effort: opt.effort ?? null, tools: opt.tools, task: { name: task, fork } });
        Object.assign(rec, { costUsd: r.costUsd ?? null, costUnknown: Boolean(r.costUnknown), costUpperUsd: r.costUpperUsd ?? opt.budgetUsd, turns: r.turns ?? null,
          durationMs: r.durationMs ?? null, sessionError: r.error?.code ?? null, nestedModelUses: nestedModelUses(r.toolUses ?? []) });
        const done = await bridge.stop();
        rec.steps = done.steps;
        rec.grade = readJson(path.join(hostDir, 'grade.json'));
      } catch (e) {
        rec.harnessError = String(e?.message ?? e).slice(0, 800);
        bridge?.kill();
      } finally {
        ledger.settle(opt.budgetUsd, r ?? { costUsd: 0 });
        if (existsSync(path.join(workdir, '.executor-transcript.jsonl'))) cpSync(path.join(workdir, '.executor-transcript.jsonl'), path.join(hostDir, 'transcript.jsonl'));
        if (!opt.keep) rmSync(workdir, { recursive: true, force: true });
      }
    }
    forks.get(task).push(rec);
    remaining.set(task, remaining.get(task) - 1);
    if (remaining.get(task) === 0) await finishTask(task);
  });

  // 4. summary
  results.sort((a, b) => tasks.indexOf(a.task) - tasks.indexOf(b.task));
  const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const pass = r => (r.final ? r.final.task_completed_correctly : 0), pc = r => (r.final ? r.final.partial_credit : 0);
  const byDomain = Object.fromEntries(taskDomains.map(d => { const rs = results.filter(r => r.domain === d); return [d, { n: rs.length, pass_rate: mean(rs.map(pass)), mean_partial_credit: mean(rs.map(pc)) }]; }));
  const fork0 = results.map(r => r.forks.find(f => f.fork === 0)).filter(Boolean);
  const summary = {
    runId, label: scripted ? 'scripted (no model)' : `model ${opt.model}`, model: scripted ? null : opt.model, scripted, evidence: 'development/diagnostic (public AutomationBench set; not held-out)',
    selection: opt.tasks?.length ? { tasks: opt.tasks } : { subset: opt.subset ?? 12, seed: opt.seed, domains }, tasks,
    k: opt.k, det: opt.det, maxSteps: opt.maxSteps, budgetUsdPerSession: opt.budgetUsd, capUsd: scripted ? null : opt.capUsd, tools: opt.tools, effort: opt.effort ?? null,
    n: results.length, n_graded: results.filter(r => r.final).length,
    pass_rate: mean(results.map(pass)), mean_partial_credit: mean(results.map(pc)), by_domain: byDomain,
    ...(opt.k > 1 ? { fork0_pass_rate: mean(fork0.map(f => f.task_completed_correctly ?? 0)), any_fork_pass_rate_diagnostic: mean(results.map(r => (r.forks.some(f => f.task_completed_correctly === 1) ? 1 : 0))),
      majority_rate: mean(results.map(r => (r.vote?.majority ? 1 : 0))) } : {}),
    cost: { spentUsd: ledger.spent, unknownCostSessions: ledger.unknown, sessions: jobs.length, skipped: results.flatMap(r => r.forks).filter(f => f.skipped).length },
    errors: results.flatMap(r => r.forks.filter(f => f.sessionError || f.harnessError).map(f => ({ task: r.task, fork: f.fork, sessionError: f.sessionError, harnessError: f.harnessError }))),
    provenance: provenance(policy), live, finishedAt: new Date().toISOString(),
  };
  writeJson(path.join(live, 'summary.json'), summary);
  // 5. copy results into the repo (summary + per-task records; transcripts, worlds and grades with assertions stay live)
  const out = opt.outDir === null ? null : (opt.outDir ?? path.join(REPO, 'research/automationbench-20261014/runs', runId));
  if (out) {
    mkdirSync(out, { recursive: true });
    cpSync(path.join(live, 'summary.json'), path.join(out, 'summary.json'));
    writeFileSync(path.join(out, 'results.jsonl'), results.map(r => JSON.stringify(r)).join('\n') + '\n');
    summary.copiedTo = out;
  }
  return { summary, results };
}

function parseArgs(argv) {
  const a = {}, flags = new Set(['keep', 'dry-run', 'no-copy']);
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
  let runner;
  if (a.scripted) { const steps = readJson(a.scripted); runner = scriptedRunner(({ name }) => steps[name] ?? []); }
  const { summary } = await runTasks({
    model: a.model, tasks: a.tasks ? a.tasks.split(',').filter(Boolean) : undefined, subset: num(a.subset, undefined), seed: a.seed ?? DEFAULTS.seed,
    domains: a.domains ? a.domains.split(',') : undefined, k: num(a.k, DEFAULTS.k), capUsd: num(a.cap, undefined), budgetUsd: num(a.budget, DEFAULTS.budgetUsd),
    concurrency: num(a.concurrency, DEFAULTS.concurrency), maxSteps: num(a['max-steps'], DEFAULTS.maxSteps), timeoutMin: num(a['timeout-min'], DEFAULTS.timeoutMin),
    det: a.det ?? DEFAULTS.det, effort: a.effort, tools: a.tools ? a.tools.split(',') : DEFAULTS.tools, runId: a['run-id'], liveRoot: a.live,
    outDir: a['no-copy'] ? null : a.out, keep: Boolean(a.keep), dryRun: Boolean(a['dry-run']), runner,
  });
  process.stdout.write(JSON.stringify(summary, null, 1) + '\n');
}
