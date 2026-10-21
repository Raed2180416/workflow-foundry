#!/usr/bin/env node
// P0 of the A1-C v2 evaluation (research/automationbench-20261014/A1C-V2-DESIGN.md §8): the v2 ledger, adjudication and
// mapping nodes on the recorded dev60 inventories, with no world and no act session. DEVELOPER TOOL, in-sample development
// evidence. PAID unless --scripted (the $0 stand-ins of harness/v2/codeowned-stubs.mjs).
//   node experiments/autobench/replay/ledger-replay.mjs --model claude-haiku-5-5 --cap 1.5 --out DIR [--run DIR] [--tasks a,b]
//        [--concurrency 3] [--inventory recorded|v2] [--scripted]
// Per task it writes DIR/<task>/{compiled.json, brief.txt, replies/} and, for the run, DIR/summary.json with the P0 rules'
// inputs: the reader parse rate (rule: >= 177 of 180), and the automatic coverage of the failing scored assertions of the
// recorded final grade by v2's checks against v1's (rule: report; wrong-entity and wrong-value proxies must not increase).
// The pre-send lint rule is evaluated on these outputs by replay-gate.mjs --lint --from DIR.
// Model ids come only from the policy file; every call is a one-turn, no-tool node in the executor sandbox, as in the
// pipeline; a hard USD cap is reserved per call before it starts.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DATE_NOTE } from '../lib.mjs';
import { DEFAULT_RUN, aligned, alignScore, assertionLiterals, checkLiterals, inventoryV2, recompileV2, recorded, runTaskList } from './lib.mjs';
import { dateOf, isLoadStamp, renderInventory } from '../harness/v2/inventory.mjs';
import { ADJUDICATE_SYSTEM, LEDGER_SYSTEM, adjudicatePrompt, conflictSpans, ledgerPrompt, mergeLedgers, normalizeLedger, parseJsonReply, readerFailed, renderLedger, settleByCode, sourceMap } from '../harness/v2/ledger.mjs';
import { PCMAP_SYSTEM, pcmapPrompt, postconditionsFromLedger } from '../harness/v2/postconditions.mjs';
import { renderChecks } from '../harness/v2/checker.mjs';
import { PIPELINE_DEFAULTS } from '../harness/v2/codeowned.mjs';

/** A one-turn, no-tool model call (the pipeline's model node), or the scripted stand-in. */
async function nodeCaller({ model, scripted, work, budgetUsd, ledger }) {
  if (scripted) {
    const { stubNodeRunner } = await import('../harness/v2/codeowned-stubs.mjs');
    const run = stubNodeRunner();
    return async (name, system, prompt) => { const dir = path.join(work, name); mkdirSync(dir, { recursive: true }); const r = await run({ model: 'stub', prompt, systemPrompt: system, workdir: dir, task: { name } }); return { text: r.result, costUsd: 0 }; };
  }
  const { runClaudeCode, DEFAULT_KEEP_RO } = await import('../../../src/executors/claude-code.mjs');
  const { loadPolicy, modelById } = await import('../../../src/models/policy.mjs');
  const { writeCliGuard } = await import('../harness/foundry.mjs');
  const policy = loadPolicy();
  if (modelById(policy.policy, model).provider !== 'claude-cli') throw new Error(`model ${model} is not served by the claude-cli provider`);
  const guard = writeCliGuard(path.join(work, 'guard'), { maxTurns: 1, target: 'claude' });
  return async (name, system, prompt) => {
    if (!ledger.reserve(budgetUsd)) throw new Error(`cap reached: ${ledger.spent.toFixed(4)} spent + ${budgetUsd} > ${ledger.cap}`);
    const dir = path.join(work, name); mkdirSync(dir, { recursive: true });
    let r;
    try { r = await runClaudeCode({ model, prompt, systemPrompt: system, workdir: dir, files: {}, budgetUsd, timeoutMs: 240_000, tools: [], binary: guard.binary, keepRo: [...DEFAULT_KEEP_RO, guard.dir] }); }
    finally { ledger.settle(budgetUsd, r); }
    return { text: r?.result ?? null, costUsd: r?.costUsd ?? null, error: r?.error?.code ?? null };
  };
}
const makeLedger = cap => { const l = { cap, spent: 0, reserved: 0 }; l.reserve = b => (l.spent + l.reserved + b <= cap + 1e-9 ? ((l.reserved += b), true) : false); l.settle = (b, r) => { l.reserved -= b; l.spent += typeof r?.costUsd === 'number' ? r.costUsd : b; }; return l; };

/** v2 compile from fresh v2 replies (the pipeline's steps 2-3 without the world). */
export async function replayTask({ rec, inv, call, P = PIPELINE_DEFAULTS, out }) {
  const system = P.systemToReaders ? rec.prompt.system : null;
  const sources = sourceMap(rec.prompt.user, inv, { system, dateNote: true, windowMs: P.loadStampWindowMs });
  const replies = [], costs = [];
  const reader = async (k, name) => { const text = renderInventory(inv, { maxChars: P.ledgerInventoryChars, order: k === 0 ? null : k }); const r = await call(`${rec.task}/${name}`, LEDGER_SYSTEM, ledgerPrompt({ request: rec.prompt.user, system, inventoryText: text, precedents: inv.precedents ?? [], dateNote: DATE_NOTE })); costs.push(r.costUsd); writeFileSync(path.join(out, 'replies', `${name}.txt`), String(r.text ?? '')); return r.text; };
  mkdirSync(path.join(out, 'replies'), { recursive: true });
  const texts = await Promise.all(Array.from({ length: P.K }, (_, k) => reader(k, `ledger-${k + 1}`)));
  const failed = texts.map((t, k) => (readerFailed(parseJsonReply(t)) ? k : -1)).filter(k => k >= 0);
  let reasked = null;
  if (P.reaskWhenFailed && failed.length >= P.reaskWhenFailed) { const t = await reader(failed[0], `ledger-${failed[0] + 1}b`); reasked = { reader: failed[0] + 1, parsed: !readerFailed(parseJsonReply(t)) }; if (reasked.parsed) texts[failed[0]] = t; }
  // Adjudication and mapping replies are requested for this compile's own open points and judged items.
  const ledgers = texts.map((t, k) => normalizeLedger(parseJsonReply(t), sources, { reader: k + 1 }));
  const pre = mergeLedgers(ledgers, { sources, entityKeyMerge: P.entityKeyMerge });
  const { open } = settleByCode(pre.conflicts, sources);
  let adj = null;
  if (open.length) { const r = await call(`${rec.task}/adjudicate`, ADJUDICATE_SYSTEM, adjudicatePrompt({ request: rec.prompt.user, conflicts: open, sourceSpans: conflictSpans(open, sources), dateNote: DATE_NOTE })); costs.push(r.costUsd); adj = r.text; writeFileSync(path.join(out, 'replies', 'adjudicate.txt'), String(adj ?? '')); }
  const first = recompileV2({ rec, inv, P, replies: texts, adjudicate: adj, pcmap: null });
  const judgedItems = [...new Set(first.pcs.filter(p => p.type === 'judged' && p.polarity === 'positive').map(p => p.item))].map(id => first.merged.items.find(i => i.id === id)).filter(Boolean);
  let pm = null;
  if (P.pcmap && judgedItems.length) { const r = await call(`${rec.task}/pcmap`, PCMAP_SYSTEM, pcmapPrompt({ items: judgedItems, inventoryText: renderInventory(inv, { maxChars: 40_000 }), dateNote: DATE_NOTE })); costs.push(r.costUsd); pm = r.text; writeFileSync(path.join(out, 'replies', 'pcmap.txt'), String(pm ?? '')); }
  const c = recompileV2({ rec, inv, P, replies: texts, adjudicate: adj, pcmap: pm });
  const parsed = texts.filter(t => !readerFailed(parseJsonReply(t))).length;
  return { ...c, readers: P.K, parsed, readerCalls: P.K + (reasked ? 1 : 0), parsedFirst: P.K - failed.length, reasked, costUsd: costs.reduce((s, x) => s + (x ?? 0), 0) };
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

function args(argv) { const a = {}; for (let i = 0; i < argv.length; i++) { const k = argv[i].replace(/^--/, ''); if (['scripted'].includes(k)) a[k] = true; else a[k] = argv[++i]; } return a; }
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = args(process.argv.slice(2));
  const runDir = a.run ?? DEFAULT_RUN;
  const tasks = a.tasks ? a.tasks.split(',') : runTaskList(runDir);
  if (!a.out) throw new Error('--out DIR is required');
  if (!a.scripted && !(Number(a.cap) > 0 && a.model)) throw new Error('a paid replay needs --model (a policy id) and --cap (USD); --scripted runs at $0');
  const P = PIPELINE_DEFAULTS;
  const work = path.join(os.tmpdir(), `a1c-v2-ledger-replay-${Date.now()}`);
  const ledger = makeLedger(Number(a.cap ?? 0));
  const call = await nodeCaller({ model: a.model, scripted: Boolean(a.scripted), work, budgetUsd: P.nodeBudgetShare * 0.75, ledger });
  const rows = [];
  await pool(tasks, Number(a.concurrency ?? 3), async task => {
    const out = path.join(a.out, task);
    mkdirSync(out, { recursive: true });
    try {
      const rec = recorded(runDir, task);
      let inv;
      if (a.inventory === 'v2') inv = await inventoryV2({ runDir, task, liveDir: path.join(work, task, 'inv'), clock: rec.clock, request: rec.prompt.user, P });
      else { inv = rec.inventory; inv.clock = rec.clock; const stamp = v => isLoadStamp(v, inv.clock, P.loadStampWindowMs); for (const r of inv.records) r.date = dateOf(r.data, { stamp }); }
      const r = await replayTask({ rec, inv, call, P, out });
      writeFileSync(path.join(out, 'compiled.json'), JSON.stringify({ merged: r.merged, pcs: r.pcs, satisfiability: r.pcs.satisfiability, stats: r.pcs.stats, typing: r.typing }, null, 1));
      writeFileSync(path.join(out, 'brief.txt'), `${renderLedger(r.merged)}\n\n${renderChecks(r.pcs)}\n`);
      const failing = (rec.grade?.assertion_results ?? []).filter(x => !x.excluded && !x.passed);
      const v1pcs = rec.v1.postconditions?.pcs ?? [];
      const all = (rec.grade?.assertion_results ?? []).filter(x => !x.excluded);
      rows.push({ task, parsed: r.parsed, readerCalls: r.readerCalls, parsedFirst: r.parsedFirst, reasked: r.reasked, costUsd: r.costUsd, checks: r.pcs.length, hard: r.pcs.filter(p => p.hard).length,
        bodyNot: r.pcs.reduce((s, p) => s + (p.params?.bodyNot?.length ?? 0), 0), contentLimits: r.pcs.stats.contentLimits, satisfiabilityDrops: r.pcs.stats.satisfiabilityDrops,
        failingScored: failing.length, coveredV2: failing.map(x => coverage(r.pcs, x)), coveredV1: failing.map(x => coverage(v1pcs, x)), proxiesV2: wrongProxies(r.pcs, all), proxiesV1: wrongProxies(v1pcs, all) });
      process.stderr.write(`[ledger-replay] ${task}: ${r.parsed}/${r.readers} parsed, ${r.pcs.length} checks, $${r.costUsd.toFixed(4)}\n`);
    } catch (e) { rows.push({ task, error: String(e?.stack ?? e).slice(0, 1500) }); process.stderr.write(`[ledger-replay] ${task}: ERROR ${String(e?.message ?? e).slice(0, 300)}\n`); }
  });
  rows.sort((x, y) => tasks.indexOf(x.task) - tasks.indexOf(y.task));
  const ok = rows.filter(r => !r.error);
  const cov = side => { const c = ok.flatMap(r => r[side]); return { failingScored: c.length, full: c.filter(x => x === 'full').length, entity: c.filter(x => x === 'entity').length, literal: c.filter(x => x === 'literal').length, none: c.filter(x => x === null).length }; };
  const prox = side => ({ wrongEntity: ok.reduce((s, r) => s + r[side].wrongEntity, 0), wrongValue: ok.reduce((s, r) => s + r[side].wrongValue, 0) });
  const summary = { evidence: 'development/diagnostic, in-sample (devTrain dev60 recorded inventories; v2 nodes; no world, no act)', scripted: Boolean(a.scripted), model: a.scripted ? null : a.model, tasks: rows.length, errors: rows.filter(r => r.error).map(r => r.task),
    readers: { parsed: ok.reduce((s, r) => s + r.parsed, 0), of: ok.length * P.K, firstPass: ok.reduce((s, r) => s + r.parsedFirst, 0), reasks: ok.filter(r => r.reasked).length, rule: '>= 177 of 180' },
    coverage: { v1: cov('coveredV1'), v2: cov('coveredV2') }, proxies: { v1: prox('proxiesV1'), v2: prox('proxiesV2'), rule: 'wrong-entity and wrong-value must not increase (proxies; review by hand)' },
    contentLimits: ok.reduce((s, r) => s + r.contentLimits, 0), bodyNot: ok.reduce((s, r) => s + r.bodyNot, 0), satisfiabilityDrops: ok.reduce((s, r) => s + r.satisfiabilityDrops, 0),
    costUsd: ledger.spent, rows };
  writeFileSync(path.join(a.out, 'summary.json'), JSON.stringify(summary, null, 1));
  const { rows: _r, ...head } = summary;
  process.stdout.write(`${JSON.stringify(head, null, 1)}\n`);
}
