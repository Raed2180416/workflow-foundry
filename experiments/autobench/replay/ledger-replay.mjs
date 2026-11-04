#!/usr/bin/env node
// P0 of the A1-C v2 evaluation (research/automationbench-20261014/A1C-V2-DESIGN.md §5): the v2 ledger, adjudication and
// mapping nodes on the recorded dev60 inventories, with no world and no act session. DEVELOPER TOOL, in-sample development
// evidence. PAID unless --scripted (the $0 stand-ins of harness/v2/codeowned-stubs.mjs).
//   node experiments/autobench/replay/ledger-replay.mjs --model claude-haiku-5-5 --cap 2 --out DIR [--run DIR] [--tasks a,b]
//        [--concurrency 3] [--inventory recorded|v2] [--scripted] [--resume]
// Per task it writes DIR/<task>/{row.json, compiled.json, brief.txt, replies/} and, for the run, DIR/summary.json with the
// P0 rules' inputs: the reader parse rate over ALL tasks (denominator tasks x K, always 180 for dev60: a task that failed
// or met the cap counts its readers as not parsed), and the automatic coverage of the failing scored assertions of the
// recorded final grade by v2's checks against v1's (wrong-entity and wrong-value proxies must not increase).
// Accounting (review of 2026-10-21, B1/M1):
//   - a waiting USD ledger as run.mjs's: a call reserves its budget before it starts, WAITS while other calls are in
//     flight, and is refused only when nothing is in flight and it still does not fit (then the run stops: exit 4);
//   - an environment fault (experiments/lib/runner.mjs ENV_FAULTS) is never scored: the task is recorded as a fault, no new
//     task starts, the run exits 3, and `--resume` re-runs faulted and missing tasks (finished tasks and their spend are
//     kept); a timeout counts as a reader that did not parse and is reported separately;
//   - every call's served model is read back from its transcript and must be the requested model (L5);
//   - every row, a fault's and a capped task's included, records the spend its calls settled on the ledger (`settledUsd`,
//     summed over attempts): a resumed run starts its ledger at the total settled by every earlier attempt, so `--cap`
//     is a hard total across resumes (re-review 2026-10-21, minor 4).
// The summary names its task count `taskCount` (never `tasks`: run directories' `tasks` lists are task names, which the
// exposure scans read; re-review 2026-10-21, M-1).
// Node working directories are named by task index, never by task name. The pre-send lint rule is evaluated on these
// outputs by replay-gate.mjs --lint --from DIR. Model ids come only from the policy file.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DATE_NOTE } from '../lib.mjs';
import { auditSession, readStream } from '../accounting.mjs';
import { ENV_FAULTS } from '../../lib/runner.mjs';
import { DEFAULT_RUN, aligned, alignScore, assertionLiterals, checkLiterals, inventoryV2, recompileV2, recorded, runTaskList } from './lib.mjs';
import { dateOf, isLoadStamp, renderInventory } from '../harness/v2/inventory.mjs';
import { ADJUDICATE_SYSTEM, LEDGER_SYSTEM, adjudicatePrompt, conflictSpans, ledgerPrompt, mergeLedgers, normalizeLedger, parseJsonReply, readerFailed, renderLedger, settleByCode, sourceMap } from '../harness/v2/ledger.mjs';
import { PCMAP_SYSTEM, pcmapPrompt } from '../harness/v2/postconditions.mjs';
import { renderChecks } from '../harness/v2/checker.mjs';
import { PIPELINE_DEFAULTS } from '../harness/v2/codeowned.mjs';

export const CAP = 'CAP_REACHED';
export const TIMEOUT = 'EXECUTOR_TIMEOUT';

/** run.mjs's waiting USD ledger: reserve before a call (waiting while calls are in flight), settle at the reported cost
 * (at the reservation when none was reported). */
export function makeLedger(cap, { spent = 0, pollMs = 50 } = {}) {
  const l = { cap, spent, reserved: 0, unknown: 0, calls: 0, waits: 0 };
  l.tryReserve = b => (l.spent + l.reserved + b <= cap + 1e-9 ? ((l.reserved += b), true) : false);
  l.reserve = async b => { let waited = false; while (!l.tryReserve(b)) { if (l.reserved <= 1e-9) return false; if (!waited) { l.waits += 1; waited = true; } await new Promise(r => setTimeout(r, pollMs)); } l.calls += 1; return true; };
  l.settle = (b, cost) => { l.reserved -= b; if (typeof cost === 'number' && Number.isFinite(cost)) l.spent += cost; else { l.spent += b; l.unknown += 1; } };
  return l;
}

/** What the ledger books for a call: its reported cost, or its reservation when it reported none. */
export const settledOf = (budgetUsd, cost) => (typeof cost === 'number' && Number.isFinite(cost) ? cost : budgetUsd);
/** Wrap a raw call (name, system, prompt) -> {text, costUsd, error, models?, settledUsd} with the ledger: a call that
 * cannot be reserved returns {error: CAP} without running; `settledUsd` is what the ledger booked for it. */
export function metered(ledger, budgetUsd, raw) {
  return async (name, system, prompt) => {
    if (!(await ledger.reserve(budgetUsd))) return { text: null, costUsd: 0, error: CAP, settledUsd: 0 };
    let r = null;
    try { r = await raw(name, system, prompt); } catch (e) { r = { text: null, costUsd: null, error: ENV_FAULTS.has(e?.code) ? e.code : 'NODE_ERROR', message: String(e?.message ?? e).slice(0, 300) }; }
    finally { ledger.settle(budgetUsd, r?.costUsd); }
    return { ...r, settledUsd: settledOf(budgetUsd, r?.costUsd) };
  };
}
/** The spend a row.json records (older rows: their reported cost). */
export const rowSpend = r => r?.settledUsd ?? r?.costUsd ?? 0;

/** A one-turn, no-tool model call (the pipeline's model node) through the ledger, or the scripted stand-in. */
async function nodeCaller({ model, scripted, work, budgetUsd, ledger }) {
  if (scripted) {
    const { stubNodeRunner } = await import('../harness/v2/codeowned-stubs.mjs');
    const run = stubNodeRunner();
    return metered(ledger, 0, async (name, system, prompt) => { const dir = path.join(work, name); mkdirSync(dir, { recursive: true }); const r = await run({ model: 'stub', prompt, systemPrompt: system, workdir: dir, task: { name } }); return { text: r.result, costUsd: 0, error: null, models: [] }; });
  }
  const { runClaudeCode, DEFAULT_KEEP_RO } = await import('../../../src/executors/claude-code.mjs');
  const { loadPolicy, modelById } = await import('../../../src/models/policy.mjs');
  const { writeCliGuard } = await import('../harness/foundry.mjs');
  const policy = loadPolicy();
  if (modelById(policy.policy, model).provider !== 'claude-cli') throw new Error(`model ${model} is not served by the claude-cli provider`);
  const guard = writeCliGuard(path.join(work, 'guard'), { maxTurns: 1, target: 'claude' });
  return metered(ledger, budgetUsd, async (name, system, prompt) => {
    const dir = path.join(work, name); mkdirSync(dir, { recursive: true });
    const r = await runClaudeCode({ model, prompt, systemPrompt: system, workdir: dir, files: {}, budgetUsd, timeoutMs: 240_000, tools: [], binary: guard.binary, keepRo: [...DEFAULT_KEEP_RO, guard.dir] });
    const audit = auditSession({ events: readStream(r.transcript ?? path.join(dir, '.executor-transcript.jsonl')), calls: [], maxSteps: 50, expectModel: model });
    return { text: r?.result ?? null, costUsd: r?.costUsd ?? null, error: r?.error?.code ?? null, models: audit.models ?? [], modelViolations: (audit.violations ?? []).filter(v => v.startsWith('L5: model')) };
  });
}

class Fault extends Error { constructor(code) { super(`environment fault ${code}`); this.code = code; } }

/** v2 compile from fresh v2 replies (the pipeline's steps 2-3 without the world). `node` names the call's working
 * directory (task index + node, never the task name). */
export async function replayTask({ rec, inv, call, P = PIPELINE_DEFAULTS, out, node = n => n }) {
  const system = P.systemToReaders ? rec.prompt.system : null;
  const sources = sourceMap(rec.prompt.user, inv, { system, dateNote: true, windowMs: P.loadStampWindowMs });
  const costs = [], models = new Set(), modelViolations = [];
  const take = r => {
    if (ENV_FAULTS.has(r?.error)) throw new Fault(r.error);
    costs.push(r?.costUsd ?? null);
    for (const m of r?.models ?? []) models.add(m);
    modelViolations.push(...(r?.modelViolations ?? []));
    if (r?.error === CAP) throw Object.assign(new Error('cap reached'), { code: CAP });
    return r;
  };
  mkdirSync(path.join(out, 'replies'), { recursive: true });
  const reader = async (k, name) => {
    const text = renderInventory(inv, { maxChars: P.ledgerInventoryChars, order: k === 0 ? null : k });
    const r = take(await call(node(name), LEDGER_SYSTEM, ledgerPrompt({ request: rec.prompt.user, system, inventoryText: text, precedents: inv.precedents ?? [], dateNote: DATE_NOTE })));
    writeFileSync(path.join(out, 'replies', `${name}.txt`), String(r.text ?? ''));
    return { text: r.text, error: r.error ?? null, completed: !r.error && typeof r.text === 'string' && r.text.length > 0, parsed: !readerFailed(parseJsonReply(r.text)) };
  };
  const reads = await Promise.all(Array.from({ length: P.K }, (_, k) => reader(k, `ledger-${k + 1}`)));
  const first = reads.map(x => ({ ...x }));
  const failed = reads.map((x, k) => (x.parsed ? -1 : k)).filter(k => k >= 0);
  let reasked = null;
  // The pipeline's re-ask rule: one more reader when >= reaskWhenFailed failed, only for a reply that completed unparsed.
  if (P.reaskWhenFailed && failed.length >= P.reaskWhenFailed) {
    const k = failed.find(i => reads[i].completed);
    if (k === undefined) reasked = { reader: null, parsed: false, skipped: 'no failed reader completed its reply' };
    else { const again = await reader(k, `ledger-${k + 1}b`); reasked = { reader: k + 1, parsed: again.parsed }; if (again.parsed) reads[k] = again; }
  }
  const texts = reads.map(x => x.text);
  // Adjudication and mapping replies are requested for this compile's own open points and judged items.
  const ledgers = texts.map((t, k) => normalizeLedger(parseJsonReply(t), sources, { reader: k + 1 }));
  const pre = mergeLedgers(ledgers, { sources, entityKeyMerge: P.entityKeyMerge });
  const { open } = settleByCode(pre.conflicts, sources);
  let adj = null;
  if (open.length) { const r = take(await call(node('adjudicate'), ADJUDICATE_SYSTEM, adjudicatePrompt({ request: rec.prompt.user, conflicts: open, sourceSpans: conflictSpans(open, sources), dateNote: DATE_NOTE }))); adj = r.text; writeFileSync(path.join(out, 'replies', 'adjudicate.txt'), String(adj ?? '')); }
  const firstCompile = recompileV2({ rec, inv, P, replies: texts, adjudicate: adj, pcmap: null });
  const judgedItems = [...new Set(firstCompile.pcs.filter(p => p.type === 'judged' && p.polarity === 'positive').map(p => p.item))].map(id => firstCompile.merged.items.find(i => i.id === id)).filter(Boolean);
  let pm = null;
  if (P.pcmap && judgedItems.length) { const r = take(await call(node('pcmap'), PCMAP_SYSTEM, pcmapPrompt({ items: judgedItems, inventoryText: renderInventory(inv, { maxChars: 40_000 }), dateNote: DATE_NOTE }))); pm = r.text; writeFileSync(path.join(out, 'replies', 'pcmap.txt'), String(pm ?? '')); }
  const c = recompileV2({ rec, inv, P, replies: texts, adjudicate: adj, pcmap: pm });
  return { ...c, readers: P.K, parsedFirstPass: first.filter(x => x.parsed).length, parsedAfterReask: reads.filter(x => x.parsed).length, unparsedCompleted: reads.filter(x => !x.parsed && x.completed).length,
    timeouts: first.filter(x => x.error === TIMEOUT).length, otherErrors: first.filter(x => x.error && x.error !== TIMEOUT).length, readerCalls: P.K + (reasked?.reader ? 1 : 0), reasked,
    costUsd: costs.reduce((s, x) => s + (x ?? 0), 0), unknownCost: costs.filter(x => x === null).length, models: [...models], modelViolations };
}

/** Automatic coverage of one assertion by a set of checks: 'full' (entity and value), 'entity', 'literal', or null. */
export function coverage(pcs, a) {
  const s = Math.max(0, ...pcs.map(p => alignScore(p, a)));
  return s >= 3 ? 'full' : s === 2 ? 'entity' : s === 1 ? 'literal' : null;
}
/** Automatic proxies (review by hand) for wrong-entity and wrong-value checks: hard checks aligned with no assertion
 * (wrongEntity), and hard checks aligned by entity only whose values match none of the aligned assertions' (wrongValue). */
export function wrongProxies(pcs, assertions) {
  let entity = 0, value = 0;
  for (const p of pcs.filter(x => x.hard && x.type !== 'judged')) {
    const A = aligned(p, assertions);
    if (!A.length) { entity += 1; continue; }
    if (A.every(x => x.s === 2) && checkLiterals(p).length && A.some(x => assertionLiterals(x.a).length)) value += 1;
  }
  return { wrongEntity: entity, wrongValue: value };
}

/** The run summary. The parse-rate denominator is tasks x K whatever happened to a task; faulted tasks are listed and
 * the rule is not applicable while any remains (resume first). */
export function summarize({ tasks, rows, K, model = null, scripted = false, ledger = null }) {
  const byTask = new Map(rows.map(r => [r.task, r]));
  const scored = tasks.map(t => byTask.get(t)).filter(r => r && !r.fault);
  const ok = scored.filter(r => !r.error);
  const faults = tasks.filter(t => byTask.get(t)?.fault).map(t => ({ task: t, code: byTask.get(t).fault }));
  const missing = tasks.filter(t => !byTask.has(t));
  const sum = k => ok.reduce((s, r) => s + (r[k] ?? 0), 0);
  const cov = side => { const c = ok.flatMap(r => r[side]); return { failingScored: c.length, full: c.filter(x => x === 'full').length, entity: c.filter(x => x === 'entity').length, literal: c.filter(x => x === 'literal').length, none: c.filter(x => x === null).length }; };
  const prox = side => ({ wrongEntity: ok.reduce((s, r) => s + r[side].wrongEntity, 0), wrongValue: ok.reduce((s, r) => s + r[side].wrongValue, 0) });
  const complete = !faults.length && !missing.length;
  const of = tasks.length * K;
  return {
    evidence: 'development/diagnostic, in-sample (devTrain dev60 recorded inventories; v2 nodes; no world, no act)', scripted, model: scripted ? null : model, taskCount: tasks.length, complete,
    readers: { of, parsedFirstPass: sum('parsedFirstPass'), parsedAfterReask: sum('parsedAfterReask'), unparsedCompleted: sum('unparsedCompleted'), timeouts: sum('timeouts'), otherErrors: sum('otherErrors'),
      failedTasks: scored.filter(r => r.error).map(r => ({ task: r.task, error: String(r.error).split('\n')[0].slice(0, 200), capped: Boolean(r.capped) })), reasks: ok.filter(r => r.reasked?.reader).length,
      rule: `>= 177 of ${of} on parsedAfterReask (the pipeline's ledgers); timeouts and failed or capped tasks count as not parsed; environment faults are not scored: resume until none remain`,
      ruleApplicable: complete, met: complete ? sum('parsedAfterReask') >= Math.ceil(of * 177 / 180) : null },
    faults, missing, models: { seen: [...new Set(ok.flatMap(r => r.models ?? []))].sort(), violations: ok.reduce((s, r) => s + (r.modelViolations?.length ?? 0), 0), expected: scripted ? null : model },
    coverage: { v1: cov('coveredV1'), v2: cov('coveredV2') }, proxies: { v1: prox('proxiesV1'), v2: prox('proxiesV2'), rule: 'wrong-entity and wrong-value must not increase (proxies; review by hand)' },
    contentLimits: sum('contentLimits'), bodyNot: sum('bodyNot'), satisfiabilityDrops: sum('satisfiabilityDrops'),
    costUsd: rows.reduce((s, r) => s + (r.costUsd ?? 0), 0), settledUsd: rows.reduce((s, r) => s + rowSpend(r), 0), ledger: ledger ? { cap: ledger.cap, spent: ledger.spent, unknownCostCalls: ledger.unknown, calls: ledger.calls, waits: ledger.waits } : null, rows: tasks.map(t => byTask.get(t)).filter(Boolean),
  };
}

async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }

/** The spend every earlier attempt settled (row.json files under `out`, finished or not): a resumed ledger starts here. */
export function priorSpend(out, tasks) {
  return tasks.map(t => path.join(out, t, 'row.json')).filter(existsSync).map(f => JSON.parse(readFileSync(f, 'utf8'))).reduce((s, r) => s + rowSpend(r), 0);
}

/**
 * Run the replay over `tasks` with `call` (metered). `load(task)` -> {rec, inv}. With `resume`, a task whose row.json
 * holds a finished (non-fault, non-capped) row is kept; a re-run task's row carries the spend of its earlier attempts.
 * Stops starting tasks after the first environment fault or a cap refusal. -> { rows, stop: null | 'fault' | 'cap' }
 */
export async function runReplay({ tasks, load, call, out, concurrency = 3, P = PIPELINE_DEFAULTS, resume = false, log = () => {} }) {
  const rows = [];
  let stop = null;
  const todo = [];
  tasks.forEach((task, idx) => {
    const f = path.join(out, task, 'row.json');
    const old = resume && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
    if (old && !old.fault && !old.capped) { rows.push({ ...old, resumed: true }); return; }
    todo.push({ task, idx, earlier: old ? { usd: rowSpend(old), attempts: old.attempts ?? 1 } : { usd: 0, attempts: 0 } });
  });
  await pool(todo, concurrency, async ({ task, idx, earlier }) => {
    if (stop) return;
    const dir = path.join(out, task);
    mkdirSync(dir, { recursive: true });
    const node = n => `t${String(idx).padStart(3, '0')}/${n}`;
    // This attempt's settled spend, counted call by call (a fault or a cap still keeps what was spent before it). A fault
    // in one reader rejects the readers' Promise.all while its siblings are still in flight: the row waits for them.
    const spend = { usd: 0 }, pending = new Set();
    const taskCall = (...x) => { const p = call(...x).then(r => { spend.usd += r?.settledUsd ?? r?.costUsd ?? 0; return r; }); pending.add(p); p.finally(() => pending.delete(p)).catch(() => {}); return p; };
    let row;
    try {
      const { rec, inv } = await load(task);
      const r = await replayTask({ rec, inv, call: taskCall, P, out: dir, node });
      writeFileSync(path.join(dir, 'compiled.json'), JSON.stringify({ merged: r.merged, pcs: r.pcs, satisfiability: r.pcs.satisfiability, stats: r.pcs.stats, typing: r.typing }, null, 1));
      writeFileSync(path.join(dir, 'brief.txt'), `${renderLedger(r.merged)}\n\n${renderChecks(r.pcs)}\n`);
      const all = (rec.grade?.assertion_results ?? []).filter(x => !x.excluded);
      const failing = all.filter(x => !x.passed);
      const v1pcs = rec.v1?.postconditions?.pcs ?? [];
      row = { task, parsedFirstPass: r.parsedFirstPass, parsedAfterReask: r.parsedAfterReask, unparsedCompleted: r.unparsedCompleted, timeouts: r.timeouts, otherErrors: r.otherErrors, readerCalls: r.readerCalls, reasked: r.reasked,
        costUsd: r.costUsd, unknownCost: r.unknownCost, models: r.models, modelViolations: r.modelViolations, checks: r.pcs.length, hard: r.pcs.filter(p => p.hard).length,
        bodyNot: r.pcs.reduce((s, p) => s + (p.params?.bodyNot?.length ?? 0), 0), contentLimits: r.pcs.stats?.contentLimits ?? 0, satisfiabilityDrops: r.pcs.stats?.satisfiabilityDrops ?? 0,
        failingScored: failing.length, coveredV2: failing.map(x => coverage(r.pcs, x)), coveredV1: failing.map(x => coverage(v1pcs, x)), proxiesV2: wrongProxies(r.pcs, all), proxiesV1: wrongProxies(v1pcs, all) };
      log(`[ledger-replay] ${task}: ${r.parsedAfterReask}/${r.readers} parsed, ${r.pcs.length} checks, $${r.costUsd.toFixed(4)}`);
    } catch (e) {
      if (e instanceof Fault) { row = { task, fault: e.code }; stop ??= 'fault'; log(`[ledger-replay] ${task}: ENVIRONMENT FAULT ${e.code} (not scored; resume)`); }
      else if (e?.code === CAP) { row = { task, error: 'cap reached', capped: true }; stop ??= 'cap'; log(`[ledger-replay] ${task}: cap reached`); }
      else { row = { task, error: String(e?.stack ?? e).slice(0, 1500) }; log(`[ledger-replay] ${task}: ERROR ${String(e?.message ?? e).slice(0, 300)}`); }
    }
    await Promise.allSettled([...pending]);
    row.settledUsd = earlier.usd + spend.usd;
    row.attempts = earlier.attempts + 1;
    writeFileSync(path.join(dir, 'row.json'), JSON.stringify(row, null, 1));
    rows.push(row);
  });
  return { rows, stop };
}

function args(argv) { const a = {}; for (let i = 0; i < argv.length; i++) { const k = argv[i].replace(/^--/, ''); if (['scripted', 'resume'].includes(k)) a[k] = true; else a[k] = argv[++i]; } return a; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = args(process.argv.slice(2));
  const runDir = a.run ?? DEFAULT_RUN;
  const tasks = a.tasks ? a.tasks.split(',') : runTaskList(runDir);
  if (!a.out) throw new Error('--out DIR is required');
  if (!a.scripted && !(Number(a.cap) > 0 && a.model)) throw new Error('a paid replay needs --model (a policy id) and --cap (USD); --scripted runs at $0');
  const P = PIPELINE_DEFAULTS;
  mkdirSync(a.out, { recursive: true });
  // A resumed run counts every earlier attempt's settled spend against the cap (faulted and capped attempts included).
  const prior = a.resume ? priorSpend(a.out, tasks) : 0;
  const ledger = makeLedger(a.scripted ? Infinity : Number(a.cap), { spent: prior });
  const work = path.join(os.tmpdir(), `a1c-v2-ledger-replay-${Date.now()}`);
  const call = await nodeCaller({ model: a.model, scripted: Boolean(a.scripted), work, budgetUsd: P.nodeBudgetShare * 0.75, ledger });
  const load = async task => {
    const rec = recorded(runDir, task);
    let inv;
    if (a.inventory === 'v2') inv = await inventoryV2({ runDir, task, liveDir: path.join(work, 'inv', String(tasks.indexOf(task))), clock: rec.clock, request: rec.prompt.user, P });
    else { inv = rec.inventory; inv.clock = rec.clock; const stamp = v => isLoadStamp(v, inv.clock, P.loadStampWindowMs); for (const r of inv.records) r.date = dateOf(r.data, { stamp }); }
    return { rec, inv };
  };
  const { rows, stop } = await runReplay({ tasks, load, call, out: a.out, concurrency: Number(a.concurrency ?? 3), P, resume: Boolean(a.resume), log: m => process.stderr.write(`${m}\n`) });
  const summary = summarize({ tasks, rows, K: P.K, model: a.model, scripted: Boolean(a.scripted), ledger: a.scripted ? null : ledger });
  writeFileSync(path.join(a.out, 'summary.json'), JSON.stringify({ ...summary, stop, priorSpendUsd: prior }, null, 1));
  const { rows: _r, ...head } = summary;
  process.stdout.write(`${JSON.stringify({ ...head, stop }, null, 1)}\n`);
  if (stop === 'fault') { process.stderr.write('[ledger-replay] stopped at an environment fault: wait, then re-run the same command with --resume\n'); process.exit(3); }
  if (stop === 'cap') { process.stderr.write('[ledger-replay] stopped at the cap: re-run with --resume and a higher --cap\n'); process.exit(4); }
}
