#!/usr/bin/env node
// C2-3 driver (research/reuse-20261021/PREREG-C2-3.md): the Haiku agent WITH the supplier's 15 labelled history products
// (agent-h.mjs) on C2-1's 235 test items, K = 2 repetitions, against C2-1's recorded arms (SCRATCH and REUSE per lineage,
// the post-hoc REUSE-G0, the no-history AGENT). Answers review finding 2 (the agent baseline saw no label).
//
//   node experiments/reuse/c23.mjs blocks  --run-id c2-dev --set dev | --run-id c2-1 --set test
//        the per-supplier history blocks (LIVE, SOP-Bench text) and their sha256 (repo: runs/c2-3/blocks-<set>.json)
//   node experiments/reuse/c23.mjs agent   --run-id c2-dev --set dev --k 1 [--sources S2,S3] [--limit 2]   dev smoke (paid)
//   node experiments/reuse/c23.mjs freeze                                     FREEZE-C2-3.json (refuses if any test record exists)
//   node experiments/reuse/c23.mjs agent   --run-id c2-1 --set test --k 1|2 [--concurrency 2]               (paid, frozen)
//   node experiments/reuse/c23.mjs analyze                                    runs/c2-3/summary.json
// Spend goes through C2-1's ledger (LIVE_ROOT/spend.jsonl, cap $2.90 for the whole C2 experiment).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ctxOf, spendLedger, SPEND_CAP_USD } from './c2.mjs';
import { itemsOf, subtaskOf, worldsOf } from './gen-b.mjs';
import { makeWorld } from './world-b.mjs';
import { AGENT_DEFAULTS } from './agent-b.mjs';
import { AGENT_H_LIMITS, AGENT_H_VERSION, historyBlock, runAgentHItem } from './agent-h.mjs';
import { composeArm, GATES, PRIMARY_GATE, pairedShipmentBootstrap } from './analyze.mjs';
import { admitAll, composeConformanceArm } from './posthoc.mjs';
import { decideShipment, sameDecision, SOURCES } from './program-b.mjs';
import { isEnvFault } from '../sopbench/run.mjs';
import { assertNoRecordsBeforeFreeze } from './freeze-guard.mjs';
import { HERE, RESEARCH, appendJsonl, mean, readJson, readJsonl, sha256, usd, writeJson } from './lib.mjs';

export const FREEZE_FILE = path.join(RESEARCH, 'FREEZE-C2-3.json');
export const PREREG_FILE = path.join(RESEARCH, 'PREREG-C2-3.md');
export const OUT = path.join(RESEARCH, 'runs', 'c2-3');
export const RECORDS = 'agent-h.jsonl';
export const FROZEN_CODE = Object.freeze(['c23.mjs', 'agent-h.mjs', 'agent-b.mjs', 'world-b.mjs', 'gen-b.mjs', 'program-b.mjs', 'c2.mjs', 'lib.mjs', 'analyze.mjs', 'posthoc.mjs', 'freeze-guard.mjs',
  '../sopbench/run.mjs', '../sopbench/scorer.mjs', '../sopbench/lib.mjs', '../autobench/accounting.mjs', '../lib/stats.mjs', '../../src/executors/claude-code.mjs']);
export const codeHashes = () => Object.fromEntries(FROZEN_CODE.map(f => [f, sha256(readFileSync(path.join(HERE, f), 'utf8'))]));

/** The history products of a supplier, in the order SCRATCH's builder saw them (build ids, then repair ids). */
export const historyIds = (manifest, source) => [...manifest.sources[source].build, ...manifest.sources[source].repair];

function blocksOf(ctx) {
  const worlds = worldsOf(ctx.manifest, { toolOrder: ctx.toolOrder, makeWorld });
  const byId = new Map(ctx.manifest.products.map(p => [p.id, p]));
  return Object.fromEntries(Object.keys(ctx.manifest.sources).map(s => [s, historyBlock({ products: historyIds(ctx.manifest, s).map(id => byId.get(id)), world: worlds[s], bankTexts: ctx.bankTexts })]));
}
const blockHashes = blocks => Object.fromEntries(Object.entries(blocks).map(([s, b]) => [s, { sha256: sha256(b), chars: b.length }]));

function cmdBlocks(ctx) {
  const blocks = blocksOf(ctx), dir = path.join(ctx.setLive, 'agent-h-blocks');
  mkdirSync(dir, { recursive: true });
  for (const [s, b] of Object.entries(blocks)) writeFileSync(path.join(dir, `${s}.txt`), b);
  writeJson(path.join(OUT, `blocks-${ctx.set}.json`), { kind: 'c23-blocks', version: AGENT_H_VERSION, runId: ctx.runId, set: ctx.set, manifestSha256: ctx.manifest.sha256, blocks: blockHashes(blocks) });
  console.log(`blocks ${ctx.set}: ${Object.keys(blocks).length} suppliers, ${Object.values(blocks).reduce((a, b) => a + b.length, 0)} chars (LIVE: ${dir})`);
}

function cmdFreeze() {
  if (existsSync(FREEZE_FILE)) throw new Error(`${FREEZE_FILE} exists; a freeze is never rewritten`);
  if (!existsSync(PREREG_FILE)) throw new Error('write PREREG-C2-3.md first');
  const ctx = ctxOf('c2-1', 'test');
  const guard = assertNoRecordsBeforeFreeze([path.join(ctx.setLive, RECORDS)]);
  const ledger = spendLedger();
  writeJson(FREEZE_FILE, { kind: 'c23-freeze', id: 'C2-3', createdAt: new Date().toISOString(), runId: 'c2-1', set: 'test', manifestSha256: ctx.manifest.sha256,
    preregSha256: sha256(readFileSync(PREREG_FILE, 'utf8')), code: codeHashes(), blocks: blockHashes(blocksOf(ctx)), model: AGENT_DEFAULTS.model,
    limits: { ...AGENT_DEFAULTS, ...AGENT_H_LIMITS }, repetitions: [1, 2], ledgerSpentAtFreezeUsd: usd(ledger.spent()), spendCapUsd: SPEND_CAP_USD, recordsBeforeFreeze: guard });
  console.log(`freeze written: ${FREEZE_FILE}`);
}

export function checkFreeze(ctx, { strict = true } = {}) {
  if (ctx.set !== 'test') return { ok: true, dev: true };
  if (!existsSync(FREEZE_FILE)) { if (strict) throw new Error('test: no FREEZE-C2-3.json'); return { ok: false, missing: true }; }
  const f = readJson(FREEZE_FILE), now = codeHashes(), blocks = blockHashes(blocksOf(ctx));
  const changed = Object.keys(f.code).filter(k => f.code[k] !== now[k]);
  const blocksChanged = Object.keys(f.blocks).filter(s => f.blocks[s].sha256 !== blocks[s]?.sha256);
  const ok = !changed.length && !blocksChanged.length && f.manifestSha256 === ctx.manifest.sha256 && f.preregSha256 === sha256(readFileSync(PREREG_FILE, 'utf8'));
  if (!ok && strict) throw new Error(`C2-3 changed since the freeze: ${[...changed, ...blocksChanged.map(s => `block ${s}`)].join(', ') || 'manifest or prereg'}`);
  return { ok, changed, blocksChanged };
}

async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }

async function cmdAgent(ctx, { k, concurrency = 2, sources = null, limit = null, cap = SPEND_CAP_USD }) {
  const ledger = spendLedger(cap);
  const worlds = worldsOf(ctx.manifest, { toolOrder: ctx.toolOrder, makeWorld });
  const blocks = blocksOf(ctx);
  const outFile = path.join(ctx.setLive, RECORDS);
  const done = new Set(readJsonl(outFile).filter(r => !r.envFault).map(r => `${r.id}#${r.k}`));
  const seen = {};
  // A supplier's items run together (stable sort by supplier, stream order within it) so its history block, a system-
  // prompt prefix, is read from the prompt cache; sessions are independent, so the order changes no answer.
  const order = Object.keys(ctx.manifest.sources);
  const todo = itemsOf(ctx.manifest).items.filter(it => (!sources || sources.includes(it.source)) && (!limit || (seen[it.source] = (seen[it.source] ?? 0) + 1) <= limit)).filter(it => !done.has(`${it.product.id}#${k}`))
    .map((it, i) => ({ it, i })).sort((x, y) => order.indexOf(x.it.source) - order.indexOf(y.it.source) || x.i - y.i).map(x => x.it);
  let stopped = null;
  const t0 = Date.now();
  await pool(todo, concurrency, async it => {
    if (stopped) return;
    if (!(await ledger.reserve(AGENT_H_LIMITS.budgetUsd))) { stopped ??= 'cap'; return; }
    const task = subtaskOf(it.product, ctx.bankTexts);
    const r = await runAgentHItem({ task, truth: it.product.truth, world: worlds[it.source], catalog: ctx.catalog, sopText: ctx.sopText, live: ctx.setLive, tag: `agenth-${k}-${it.product.index}`, block: blocks[it.source] });
    ledger.settle(AGENT_H_LIMITS.budgetUsd, r.costUsd, { phase: 'agent-h', runId: ctx.runId, set: ctx.set, item: it.product.index, k });
    const envFault = isEnvFault({ sessionError: r.sessionError, harnessError: r.harnessError }) || r.harnessError ? (r.sessionError ?? 'HARNESS') : null;
    appendJsonl(outFile, { id: it.product.id, source: it.source, shipment: it.shipment, k, answer: r.cls, correct: r.strict, costUsd: r.costUsd, costUnknown: r.costUnknown, durationMs: r.durationMs,
      turns: r.turns, steps: r.steps, toolCalls: r.toolCalls, toolErrors: r.toolErrors, sessionError: r.sessionError, envFault, nestedModelUses: r.nestedModelUses, violations: r.audit?.violations ?? null,
      models: r.audit?.models ?? null, blockSha256: sha256(blocks[it.source]), answerTail: r.answerText.slice(-400) });
    if (envFault) stopped ??= `environment fault: ${envFault}`;
  });
  const recs = readJsonl(outFile).filter(r => r.k === k);
  console.log(`agent-h ${ctx.set} k=${k}: ${recs.length} recorded (${recs.filter(r => r.envFault).length} faults, ${recs.filter(r => !r.envFault && r.correct).length} correct) in ${((Date.now() - t0) / 1000).toFixed(0)} s; spent so far $${ledger.spent().toFixed(4)}${stopped ? `; stopped: ${stopped}` : ''}`);
  if (stopped) process.exitCode = 3;
}

// ------------------------------------------------------------------------------------------------ analysis ($0)
const pct = (a, b) => (b ? a / b : null);
function shipmentView(out, ships) {
  const by = new Map();
  for (const o of out) (by.get(o.shipment) ?? by.set(o.shipment, []).get(o.shipment)).push(o);
  let correct = 0, holds = 0, wrongBookings = 0;
  for (const [sid, os] of by) {
    const s = ships.get(sid), truth = decideShipment(os.map(o => o.truth), s.mode), got = decideShipment(os.map(o => o.cls ?? 'none'), s.mode);
    if (sameDecision(truth, got)) correct++; else if (got.decision !== 'hold') wrongBookings++;
    if (got.decision === 'hold') holds++;
  }
  return { shipments: by.size, shipAcc: pct(correct, by.size), holds, wrongBookings };
}

/** Every arm's per-item outcomes and costs, from C2-1's records and C2-3's. */
export function armsOf(ctx) {
  const { items, ships } = itemsOf(ctx.manifest);
  const L = f => readJsonl(path.join(ctx.setLive, f));
  const reuse = L('reuse.jsonl'), builds = L('builds.jsonl').filter(b => !b.envFault), built = L('built.jsonl');
  const reuseBy = new Map(reuse.map(r => [r.id, r])), builtBy = new Map(built.map(b => [`${b.id}#${b.lineage}`, b]));
  const buildRec = new Map(builds.map(b => [`${b.source}#${b.lineage}`, b])), buildOf = (s, l) => buildRec.get(`${s}#${l}`) ?? null;
  const truthOf = new Map(items.map(it => [it.product.id, it.product.truth.hazard_class]));
  const agentRecs = { AGENT: L('agent.jsonl').filter(a => !a.envFault), 'AGENT-H': L(RECORDS).filter(a => !a.envFault) };
  const conf = L('conformance.jsonl'), perSource = Object.fromEntries(Object.keys(ctx.manifest.sources).map(s => [s, { pass: conf.filter(r => r.source === s && r.correct).length, of: conf.filter(r => r.source === s).length }]));
  const conformMs = conf.reduce((a, r) => a + (r.durationMs ?? 0), 0);
  const lineages = [...new Set(builds.map(b => b.lineage))].filter(l => Object.keys(ctx.manifest.sources).every(s => buildRec.has(`${s}#${l}`))).sort();
  const arms = {};
  const withTruth = out => out.map(o => ({ ...o, truth: truthOf.get(o.id) }));
  for (const [name, recs] of Object.entries(agentRecs)) {
    const by = new Map(recs.map(a => [`${a.id}#${a.k}`, a]));
    for (const k of [...new Set(recs.map(a => a.k))].sort()) {
      if (!items.every(it => by.has(`${it.product.id}#${k}`))) continue;
      const { out } = composeArm({ kind: 'agent', k }, { items, reuseBy, builtBy, buildOf, agentBy: by });
      arms[`${name}@k${k}`] = { out, usd: out.reduce((a, o) => a + (o.usd ?? 0), 0), ms: out.reduce((a, o) => a + (o.ms ?? 0), 0), builds: 0 };
    }
  }
  for (const l of lineages) {
    for (const [name, arm] of [[`SCRATCH@L${l}`, { kind: 'scratch', lineage: l }], [`REUSE-b3@L${l}`, { kind: 'reuse', gate: PRIMARY_GATE, lineage: l }]]) {
      const c = composeArm(arm, { items, reuseBy, builtBy, buildOf, agentBy: new Map() });
      const bs = [...c.buildsCharged.values()];
      arms[name] = { out: c.out, usd: bs.reduce((a, b) => a + (b?.costUsd ?? 0), 0), ms: c.out.reduce((a, o) => a + (o.ms ?? 0), 0) + bs.reduce((a, b) => a + (b?.wallMs ?? 0), 0), builds: bs.length };
    }
    const g = composeConformanceArm({ reuse: items.map(it => reuseBy.get(it.product.id)), admit: s => admitAll(perSource[s]), builtBy, lineage: l });
    const bs = [...g.paid].map(s => buildOf(s, l));
    arms[`REUSE-G0@L${l}`] = { out: withTruth(g.out).map(o => ({ ...o, cls: o.route === 'reuse' ? reuseBy.get(o.id).answer : builtBy.get(`${o.id}#${l}`)?.answer ?? null })), usd: bs.reduce((a, b) => a + (b?.costUsd ?? 0), 0),
      ms: g.ms + bs.reduce((a, b) => a + (b?.wallMs ?? 0), 0) + conformMs, builds: bs.length, posthoc: true };
  }
  return { arms, ships, items, lineages, perSource };
}

function metricsOf(name, a, ships) {
  const n = a.out.length, correct = a.out.filter(o => o.correct).length;
  const bySource = Object.fromEntries(Object.keys(SOURCES).map(s => { const os = a.out.filter(o => o.source === s); return [s, `${os.filter(o => o.correct).length}/${os.length}`]; }));
  return { arm: name, items: n, correct, itemAcc: pct(correct, n), unable: a.out.filter(o => o.cls === 'Unable to Decide').length, noAnswer: a.out.filter(o => o.cls == null).length,
    ...shipmentView(a.out, ships), usdTotal: usd(a.usd), usdPerItem: usd(a.usd / n), usdPerCorrect: correct ? usd(a.usd / correct) : null, msPerItemInclBuilds: Math.round(a.ms / n), buildsPaid: a.builds,
    posthoc: !!a.posthoc, bySource };
}

async function cmdAnalyze() {
  const ctx = ctxOf('c2-1', 'test');
  const freeze = checkFreeze(ctx, { strict: false });
  const { arms, ships, lineages } = armsOf(ctx);
  const metrics = Object.entries(arms).map(([n, a]) => metricsOf(n, a, ships));
  const ks = Object.keys(arms).filter(n => n.startsWith('AGENT-H@')).map(n => Number(n.split('@k')[1]));
  const comparisons = [];
  const cmp = (A, B) => { if (arms[A] && arms[B]) comparisons.push({ a: A, b: B, ...pairedShipmentBootstrap(arms[A].out, arms[B].out) }); };
  for (const k of ks) {
    for (const l of lineages) { cmp(`SCRATCH@L${l}`, `AGENT-H@k${k}`); cmp(`REUSE-G0@L${l}`, `AGENT-H@k${k}`); cmp(`REUSE-b3@L${l}`, `AGENT-H@k${k}`); }
    cmp(`AGENT-H@k${k}`, `AGENT@k${k}`);
  }
  if (ks.length > 1) cmp(`AGENT-H@k${ks[0]}`, `AGENT-H@k${ks[1]}`);
  // P2: REUSE-G0's item outcomes against SCRATCH's, per lineage (items whose correctness differs).
  const p2 = Object.fromEntries(lineages.map(l => { const sc = new Map(arms[`SCRATCH@L${l}`].out.map(o => [o.id, o.correct])); return [`L${l}`, arms[`REUSE-G0@L${l}`].out.filter(o => o.correct !== sc.get(o.id)).map(o => o.id)]; }));
  const hRecs = readJsonl(path.join(ctx.setLive, RECORDS));
  const summary = { kind: 'c23-summary', id: 'C2-3', evidence: 'development evidence (preregistered; self-authored second program and suppliers; not sealed)', freeze,
    items: ctx.manifest ? itemsOf(ctx.manifest).items.length : null, repetitions: ks, metrics, comparisons, p2ItemsWhereReuseG0DiffersFromScratch: p2,
    spend: { agentHUsd: usd(hRecs.reduce((a, r) => a + (r.costUsd ?? 0), 0)), sessions: hRecs.length, envFaults: hRecs.filter(r => r.envFault).length, faultUsd: usd(hRecs.filter(r => r.envFault).reduce((a, r) => a + (r.costUsd ?? 0), 0)),
      violations: hRecs.filter(r => r.violations?.length).length, nestedModelUses: hRecs.filter(r => r.nestedModelUses).length, ledgerTotalUsd: usd(spendLedger().spent()) },
    generatedAt: new Date().toISOString() };
  writeJson(path.join(OUT, 'summary.json'), summary);
  for (const m of metrics) console.log(`${m.arm.padEnd(16)} ${m.correct}/${m.items} = ${(100 * m.itemAcc).toFixed(1)}%  unable ${m.unable}  $${m.usdPerItem}/item  $${m.usdPerCorrect}/correct  ${(m.msPerItemInclBuilds / 1000).toFixed(1)} s`);
  for (const c of comparisons) console.log(`${c.a} − ${c.b}: ${(100 * c.point).toFixed(1)} [${(100 * c.lo).toFixed(1)}, ${(100 * c.hi).toFixed(1)}]`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = Object.fromEntries(rest.reduce((acc, x, i, xs) => (x.startsWith('--') ? [...acc, [x.slice(2), xs[i + 1]]] : acc), []));
  if (cmd === 'freeze') cmdFreeze();
  else if (cmd === 'analyze') await cmdAnalyze();
  else {
    if (!a['run-id'] || !a.set) throw new Error('--run-id and --set required');
    const ctx = ctxOf(a['run-id'], a.set);
    if (!ctx.manifest) throw new Error('no manifest');
    if (cmd === 'blocks') cmdBlocks(ctx);
    else if (cmd === 'agent') {
      if (a.set === 'test') { if (a['run-id'] !== 'c2-1') throw new Error('test runs are c2-1'); checkFreeze(ctx); }
      const cap = a.cap ? Number(a.cap) : SPEND_CAP_USD;
      if (cap > SPEND_CAP_USD) throw new Error(`--cap above $${SPEND_CAP_USD}`);
      await cmdAgent(ctx, { k: Number(a.k ?? 1), concurrency: Number(a.concurrency ?? 2), sources: a.sources ? a.sources.split(',') : null, limit: a.limit ? Number(a.limit) : null, cap });
    } else throw new Error(`unknown command ${cmd} (blocks | agent | freeze | analyze)`);
  }
}
