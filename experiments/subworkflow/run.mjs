#!/usr/bin/env node
// SW-1 runner: arms x golive tasks. Each (arm, task) unit runs the task's 4 channel intake nodes under the arm; the
// parent is code (it sums the node totals into the group totals) and the bed's oracles score nodes and the task.
// Resumable: model calls are journaled in <run-dir>/journal.sqlite with run ids fixed per (run tag, arm, task), so a re-run
// serves completed calls from the journal at $0 (ModelPort crash recovery); units already in results.jsonl are skipped.
// Spend cap: --cap-usd over every journal under the runs root (pilot and eval together). Since SW-1c (review defect 11) a
// unit is admitted only if spend + a reservation for every unit in flight and for itself stays within the cap (cap.mjs;
// --unit-reserve-usd, default 4 nodes x the node budget), so units in flight cannot overshoot it; SW-1 and SW-1b checked
// spend alone before each unit (SW-1b ended $0.066 over its $4.85 cap).
// --trigger world|observable (SW-1c, review defect 3): how a parent-directed arm picks the nodes it routes through a
// sub-workflow. 'world' (the default; SW-1 and SW-1b) reads the bed's analyst-side channel kind; 'observable' uses the
// frozen trigger.mjs rule on the node's own input. Each node row records both.
// launch.json records the argv, the sha256 of every file the SW-1 preregs pin plus the SW-1c files, and the Claude CLI
// version (review defect 13; the journal also records it per call as engine_version).
//
//   node experiments/subworkflow/run.mjs --run-dir research/subworkflow-20261021/runs/<id> --tasks <manifest.json>
//        [--arms A0,A1,A1T,A2] [--concurrency 3 (units)] [--model-concurrency N (model calls; default = concurrency)] [--cap-usd 5]
//        [--runs-root research/subworkflow-20261021/runs]
//   node experiments/subworkflow/run.mjs --run-dir ... --split dev --seeds 11,12 --difficulties 2,3   (pilot)
//   --layout blocks (SW-1b, added after eval-1): the backlog exports in the 'blocks' layout (beds/golive/layouts.mjs); a
//   manifest task's own "layout" wins. 'delimited' (the default) generates exactly the eval-1 tasks.
import { readFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createModelPort } from '../lib/models.mjs';
import { ENV_FAULTS } from '../lib/runner.mjs';
import * as bed from '../../beds/golive/index.mjs';
import * as layouts from '../../beds/golive/layouts.mjs';
import { runNode, ARMS, ARM_CONFIG, NODE_MODEL, NODE_BUDGET_USD } from './node.mjs';
import { admit, unitReserveUsd } from './cap.mjs';
import { observableTrigger } from './trigger.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The files PREREG-SW-1 / PREREG-SW-1b pin, plus the SW-1c files (PREREG-SW-1c).
export const PINNED = ['beds/golive/index.mjs', 'beds/golive/world.mjs', 'beds/golive/layouts.mjs', 'beds/lib/rng.mjs', 'experiments/subworkflow/dsl.mjs',
  'experiments/subworkflow/templates.mjs', 'experiments/subworkflow/bind.mjs', 'experiments/subworkflow/node.mjs', 'experiments/subworkflow/prompts.mjs',
  'experiments/subworkflow/prompts-open.mjs', 'experiments/subworkflow/prompts-c.mjs', 'experiments/subworkflow/run.mjs', 'experiments/subworkflow/cap.mjs',
  'experiments/subworkflow/trigger.mjs', 'experiments/subworkflow/vote.mjs', 'experiments/subworkflow/provenance.mjs', 'experiments/subworkflow/analyze.mjs',
  'experiments/subworkflow/analyze-sw1c.mjs', 'experiments/subworkflow/audit.mjs', 'experiments/subworkflow/stats.mjs',
  'research/subworkflow-20261021/tasks-sw1c-p.json', 'research/subworkflow-20261021/tasks-sw1c-b.json',
  'experiments/jit/call-host.mjs', 'src/sandbox.mjs', 'src/validate.mjs', 'experiments/lib/models.mjs', 'experiments/lib/runner.mjs', 'policy/models.json'];
export const sha256Of = f => { try { return createHash('sha256').update(readFileSync(path.join(REPO, f))).digest('hex'); } catch { return null; } };
function cliVersion() {
  try {
    const policy = JSON.parse(readFileSync(path.join(REPO, 'policy/models.json'), 'utf8'));
    const bin = policy.providers?.['claude-cli']?.binary ?? 'claude';
    return execFileSync(bin, ['--version'], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/', LANG: 'C.UTF-8' }, timeout: 30000, encoding: 'utf8' }).trim().split(/\s+/)[0];
  } catch (e) { return `unknown (${String(e.code ?? e.message).slice(0, 80)})`; }
}

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]] : a), []));
const runDir = path.resolve(args['run-dir'] ?? '');
if (!args['run-dir']) { console.error('--run-dir is required'); process.exit(2); }
const runsRoot = path.resolve(args['runs-root'] ?? path.dirname(runDir));
const arms = (args.arms ?? ARMS.join(',')).split(',');
for (const a of arms) if (!ARMS.includes(a)) { console.error(`unknown arm ${a}`); process.exit(2); }
const concurrency = Number(args.concurrency ?? 3), capUsd = Number(args['cap-usd'] ?? 5), modelConcurrency = Number(args['model-concurrency'] ?? concurrency);
const tag = args.tag ?? path.basename(runDir);
const layout = args.layout ?? 'delimited';
if (!layouts.LAYOUTS.includes(layout)) { console.error(`unknown layout ${layout}`); process.exit(2); }
const triggerMode = args.trigger ?? 'world';
if (!['world', 'observable'].includes(triggerMode)) { console.error(`unknown trigger ${triggerMode}`); process.exit(2); }
const reserveUsd = Number(args['unit-reserve-usd'] ?? unitReserveUsd({ nodes: 4, nodeBudgetUsd: NODE_BUDGET_USD }));
mkdirSync(runDir, { recursive: true });

let tasks;
if (args.tasks) tasks = JSON.parse(readFileSync(args.tasks, 'utf8')).tasks.map(t => ({ seed: t.seed, split: t.split, difficulty: t.difficulty, layout: t.layout ?? layout }));
else tasks = (args.seeds ?? '').split(',').filter(Boolean).flatMap(s => (args.difficulties ?? '2').split(',').map(d => ({ seed: Number(s), split: args.split ?? 'dev', difficulty: Number(d), layout })));
if (!tasks.length) { console.error('no tasks'); process.exit(2); }

const resultsFile = path.join(runDir, 'results.jsonl');
const done = new Set(existsSync(resultsFile) ? readFileSync(resultsFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.status === 'complete').map(r => r.unit) : []);
const { port, policyHash, db } = createModelPort({ journalFile: path.join(runDir, 'journal.sqlite'), allowedModels: [NODE_MODEL], maxBudgetUsdPerCall: 0.25, timeoutMs: 300000,
  concurrency: { [NODE_MODEL]: modelConcurrency } });
writeFileSync(path.join(runDir, 'launch.json'), JSON.stringify({ at: new Date().toISOString(), argv: process.argv.slice(2), arms, tasks: tasks.length, layout, trigger: triggerMode, capUsd, unitReserveUsd: reserveUsd,
  concurrency, modelConcurrency, policyHash, cliVersion: cliVersion(), sha256: Object.fromEntries(PINNED.map(f => [f, sha256Of(f)])), pid: process.pid }, null, 1));

// Spend over every journal under the runs root (each run dir's journal.sqlite).
function spendAll() {
  let total = 0;
  for (const d of existsSync(runsRoot) ? readdirSync(runsRoot) : []) {
    const f = path.join(runsRoot, d, 'journal.sqlite');
    if (!existsSync(f)) continue;
    const h = f === path.join(runDir, 'journal.sqlite') ? db : new DatabaseSync(f, { readOnly: true });
    try { total += h.prepare('SELECT COALESCE(SUM(cost_usd),0) AS c FROM model_calls').get().c; } finally { if (h !== db) h.close(); }
  }
  return Math.round(total * 1e6) / 1e6;
}

const queue = [];
for (const t of tasks) for (const arm of arms) queue.push({ arm, t });
let stopped = null, active = 0;
const log = (...x) => console.log(new Date().toISOString().slice(11, 19), ...x);
log(`SW-1 ${tag}: ${queue.length} units (${tasks.length} tasks x ${arms.join(',')}), ${done.size} already done, cap $${capUsd}, spent so far $${spendAll()}`);

async function worker() {
  while (queue.length && !stopped) {
    const { arm, t } = queue.shift();
    const task = layouts.generate(t), unit = `${arm}:${task.id}`;
    if (done.has(unit)) continue;
    const gate = admit({ spent: spendAll(), active, reserveUsd, capUsd });
    if (!gate.ok) { stopped = gate.why; break; }
    active++;
    const started = Date.now();
    try {
      const { nodes, runId } = await execute(arm, task);
      const envFault = nodes.map(n => n.error?.code).find(c => ENV_FAULTS.has(c)) ?? null;
      const answers = nodes.map(n => n.answer).filter(Boolean);
      const group = { orders: answers.reduce((s, a) => s + a.totals.orders, 0), usd_cents: answers.reduce((s, a) => s + a.totals.usd_cents, 0) };
      const out = { channels: answers, group };
      const o = bed.oracle(task, out);
      const row = { unit, status: envFault ? 'env-fault' : 'complete', envFault, arm, runId, taskId: task.id, seed: task.seed, split: task.split, difficulty: task.difficulty, layout: task.layout ?? 'delimited',
        pass: o.pass, score: o.score, groupOk: o.details?.groupOk ?? null, costUsd: Math.round(nodes.reduce((s, n) => s + n.costUsd, 0) * 1e6) / 1e6, wallMs: Date.now() - started,
        at: new Date().toISOString(), nodes: nodes.map(({ answer, ...n }) => ({ ...n, answer })) };
      appendFileSync(resultsFile, JSON.stringify(row) + '\n');
      log(`${unit} ${row.status} pass=${o.pass} nodes=${nodes.map(n => `${n.kind[0]}${n.pass ? '+' : '-'}${n.path?.[0] ?? '?'}`).join(' ')} $${row.costUsd} ${Math.round(row.wallMs / 1000)}s`);
    } catch (e) {
      log(`${unit} crashed: ${e.stack?.slice(0, 600)}`);
      appendFileSync(resultsFile, JSON.stringify({ unit, status: 'crash', arm, taskId: task.id, error: String(e.message).slice(0, 600), at: new Date().toISOString() }) + '\n');
    } finally { active--; }
  }
}

async function execute(arm, task) {
  const runId = `sw1:${tag}:${arm}:${task.id}`;
  const kinds = new Map(bed.channelKinds(task).map(k => [k.channel, k.kind]));
  // The 4 nodes of a task run concurrently (they are independent channels of one parent).
  const nodes = await Promise.all(task.inputs.channels.map(async c => {
    const input = { channel: c.channel, spec: task.inputs.spec, notes: c.notes, export: c.export };
    // A parent-directed arm routes its legacy-export nodes through a sub-workflow; its other nodes answer directly. Which
    // nodes: the world's channel kind (--trigger world) or the frozen observable rule (--trigger observable).
    const trig = { world: kinds.get(c.channel) === 'backlog', observable: observableTrigger(input) };
    const cfg = ARM_CONFIG[arm], mode = cfg.trigger ?? triggerMode;   // an arm's own trigger (A1FO) wins over --trigger
    const directive = cfg.directive === 'subworkflow' ? (trig[mode] ? 'subworkflow' : 'answer') : cfg.directive;
    const r = await runNode({ port, arm, input, runId, directive, answerSchema: bed.nodeOutputSchema });
    const o = r.output ? bed.nodeOracle(task, c.channel, r.output) : { pass: false, score: 0, details: { error: r.error } };
    const d = o.details ?? {};
    return { channel: c.channel, kind: kinds.get(c.channel), directive, trigger: { ...trig, mode }, pass: o.pass, score: o.score, path: r.path, decision: r.decision, reason: r.reason, error: r.error,
      gate: r.gate ?? null, tool: r.tool ?? null, returned: r.returned ?? null,
      costUsd: r.costUsd, calls: r.calls.length, callLog: r.calls, rounds: r.rounds, fallback: r.fallback, sub: r.sub ? { ...r.sub, spec: undefined } : null, spec: r.sub?.spec ?? null,
      proposals: r.proposals, authority: r.authority, maxDepthSeen: r.maxDepthSeen, ranSpecs: r.ranSpecs, specsRun: r.specsRun, events: r.events, traces: r.traces, answer: r.output,
      oracle: { missing: d.missing ?? null, extra: d.extra ?? null, wrong: d.wrong ?? null, fieldErr: d.fieldErr ?? null, qMissing: d.qMissing ?? null,
        qExtra: d.qExtra ?? null, dupRefs: d.dupRefs ?? null, totalsOk: d.totalsOk ?? null, shape: d.shape ?? null, want: d.want ?? null } };
  }));
  return { nodes, runId };
}

await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, () => worker()));
log(`SW-1 ${tag}: ${stopped ? `stopped: ${stopped}` : 'queue done'}; spent over all runs $${spendAll()}`);
db.close();
