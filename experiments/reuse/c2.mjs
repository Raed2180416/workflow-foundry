#!/usr/bin/env node
// C2-1 driver (research/reuse-20261021/PREREG-C2-1.md): a proven workflow reused by a second program, gated by its input
// and trace profiles, against rebuilding from scratch with the same builder and against a per-item agent.
//
//   node experiments/reuse/c2.mjs gen      --run-id c2-1 --set dev|test             manifest (no SOP-Bench text) -> research/.../runs/<id>/
//   node experiments/reuse/c2.mjs reuse    --run-id c2-1 --set test                 the proven entry on every item + all gate verdicts ($0)
//   node experiments/reuse/c2.mjs freeze   --run-id c2-1 --set test                 FREEZE-C2-1.json: code, manifest, entry and prereg hashes
//   node experiments/reuse/c2.mjs build    --run-id c2-1 --set test --lineage 1     same builder, one lineage per supplier (Haiku, paid)
//   node experiments/reuse/c2.mjs built    --run-id c2-1 --set test                 every finished build on its supplier's items ($0)
//   node experiments/reuse/c2.mjs agent    --run-id c2-1 --set test --k 1           Haiku agent per item (paid)
//   node experiments/reuse/c2.mjs analyze  --run-id c2-1 --set test                 arms, metrics, M3 rule -> summary (analyze.mjs)
// Options: --sources S0,S2 (subset, dev smoke) --limit N (items per source, dev smoke) --concurrency N --cap USD
// Per-item records live under LIVE_ROOT/<run-id>/<set>/ (they hold SOP-Bench-derived text); the repo gets the manifest and
// aggregates. Paid phases on the test set refuse to start unless the freeze file matches the code (PREREG §7). Every paid
// session is reserved against one ledger for the whole experiment (LIVE_ROOT/spend.jsonl, cap $2.90: the brief's $3).
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { artifactFiles } from '../sopbench/exec.mjs';
import { createModelPort } from '../lib/models.mjs';
import { generate, itemsOf, subtaskOf, worldsOf, bankTextsOf } from './gen-b.mjs';
import { makeWorld } from './world-b.mjs';
import { runArtifact } from './host.mjs';
import { gateAll, gateInput, gateTraceDoc, learnInputProfile, learnTraceProfile, traceDoc } from './gate.mjs';
import { contractHashOf, contractOf, createRegistry, loadProfiles } from './registry.mjs';
import { normaliseClass, sourcesOfSet } from './program-b.mjs';
import { buildForSource, strictOf } from './build-b.mjs';
import { runAgentItem, AGENT_DEFAULTS } from './agent-b.mjs';
import { isEnvFault } from '../sopbench/run.mjs';
import { saveProfile } from './prove.mjs';
import { HERE, LIVE_ROOT, RESEARCH, appendJsonl, readJson, readJsonl, sha256, writeJson } from './lib.mjs';

export const PROVEN_ID = 'sopbench-p2:dangerous_goods';
export const SEEDS = Object.freeze({ dev: 'c2-dev-1', test: 'c2-test-1' });
export const SPEND_CAP_USD = 2.9;
export const SPEND_FILE = path.join(LIVE_ROOT, 'spend.jsonl');
export const FREEZE_FILE = path.join(RESEARCH, 'FREEZE-C2-1.json');
/** The files whose hashes the freeze pins (everything that decides an arm's answer, a gate verdict or a metric). */
export const FROZEN_CODE = Object.freeze(['lib.mjs', 'world-b.mjs', 'program-b.mjs', 'gen-b.mjs', 'registry.mjs', 'gate.mjs', 'host.mjs', 'prove.mjs', 'build-b.mjs', 'agent-b.mjs', 'c2.mjs', 'analyze.mjs',
  '../jit/profile.mjs', '../sopbench/build.mjs', '../sopbench/exec.mjs', '../sopbench/run.mjs', '../sopbench/scorer.mjs', '../sopbench/kit/run-solver.mjs', '../sopbench/kit/check.mjs', '../sopbench/kit/sop.mjs', '../sopbench/tool.mjs', '../lib/stats.mjs']);

export function ctxOf(runId, set) {
  const live = path.join(LIVE_ROOT, runId);
  const out = path.join(RESEARCH, 'runs', runId);
  const bank = readJson(path.join(live, 'proof', 'dangerous_goods.bank.json'));
  const prep = readJson(path.join(live, 'proof', 'dangerous_goods.prep.json'));
  const catalog = readJson(prep.catalogFile);
  const sopText = readFileSync(prep.sopFile, 'utf8');
  const manifestFile = path.join(out, `manifest-${set}.json`);
  const manifest = existsSync(manifestFile) ? readJson(manifestFile) : null;
  const registry = createRegistry({ file: path.join(live, 'registry', 'registry.jsonl') });
  return { runId, set, live, out, setLive: path.join(live, set), bank, bankTexts: bankTextsOf(bank), prep, catalog, sopText, manifestFile, manifest, registry,
    toolOrder: catalog.map(t => t.name) };
}

// ------------------------------------------------------------------------------------------------ spend ledger
export function spendLedger(cap = SPEND_CAP_USD, file = SPEND_FILE) {
  const spent = () => readJsonl(file).reduce((a, e) => a + (e.usd ?? 0), 0);
  const l = { reserved: 0 };
  l.spent = spent;
  l.reserve = async b => { for (;;) { if (spent() + l.reserved + b <= cap + 1e-9) { l.reserved += b; return true; } if (l.reserved <= 1e-9) return false; await new Promise(r => setTimeout(r, 500)); } };
  l.settle = (b, usd, meta = {}) => { l.reserved -= b; appendJsonl(file, { at: new Date().toISOString(), usd, ...meta }); };
  return l;
}

// ------------------------------------------------------------------------------------------------ freeze
export function codeHashes() { return Object.fromEntries(FROZEN_CODE.map(f => [f, sha256(readFileSync(path.join(HERE, f), 'utf8'))])); }
function cmdFreeze(ctx) {
  if (ctx.set !== 'test') throw new Error('freeze: the test set only');
  if (existsSync(FREEZE_FILE)) throw new Error(`${FREEZE_FILE} exists; a freeze is never rewritten (amend the prereg instead)`);
  const entry = ctx.registry.get(PROVEN_ID);
  const prereg = path.join(RESEARCH, 'PREREG-C2-1.md');
  if (!existsSync(prereg)) throw new Error('freeze: write PREREG-C2-1.md first');
  const reuse = readJsonl(path.join(ctx.setLive, 'reuse.jsonl'));
  const f = { kind: 'c2-freeze', id: 'C2-1', createdAt: new Date().toISOString(), runId: ctx.runId, manifestSha256: ctx.manifest.sha256, manifestFile: path.relative(RESEARCH, ctx.manifestFile),
    entry: { id: entry.id, contractHash: entry.contractHash, artifactSha256: entry.artifact.sha256, inputProfileSha256: entry.profiles.input.sha256, traceProfileSha256: entry.profiles.trace.sha256 },
    preregSha256: sha256(readFileSync(prereg, 'utf8')), code: codeHashes(), models: { builder: 'claude-haiku-5-5', agent: AGENT_DEFAULTS.model }, spendCapUsd: SPEND_CAP_USD,
    reuseRecordsBeforeFreeze: reuse.length, note: 'The $0 reuse phase (proven entry on every test item, every gate variant) may run before or after this file; nothing paid runs on the test set before it.' };
  writeJson(FREEZE_FILE, f);
  console.log(`freeze written: ${FREEZE_FILE}`);
}
export function checkFreeze(ctx, { strict = true } = {}) {
  if (ctx.set !== 'test') return { ok: true, dev: true };
  if (!existsSync(FREEZE_FILE)) { if (strict) throw new Error('test: no FREEZE-C2-1.json (run freeze after committing the prereg)'); return { ok: false, missing: true }; }
  const f = readJson(FREEZE_FILE), now = codeHashes();
  const changed = Object.keys(f.code).filter(k => f.code[k] !== now[k]);
  const ok = !changed.length && f.manifestSha256 === ctx.manifest.sha256;
  if (!ok && strict) throw new Error(`test: the code or manifest changed since the freeze: ${changed.join(', ') || 'manifest'}`);
  return { ok, changed };
}

// ------------------------------------------------------------------------------------------------ helpers
function cmdGen(ctx) {
  if (ctx.manifest) throw new Error(`${ctx.manifestFile} exists; a manifest is never regenerated`);
  const m = generate({ seed: SEEDS[ctx.set], bank: ctx.bank.map(b => ({ row: b.row, total: b.total })), sources: sourcesOfSet(ctx.set) });
  writeJson(ctx.manifestFile, m);
  const n = m.shipments.reduce((a, s) => a + s.items.length, 0);
  console.log(`manifest ${ctx.set}: ${m.shipments.length} shipments, ${n} eval items, ${m.products.length} products, sha256 ${m.sha256}`);
}

/** Grade a workflow answer for one item: the class it names (normalised) and the strict verdict (SOP-Bench strict scorer). */
export const gradeItem = (answer, truth) => ({ cls: normaliseClass(answer?.hazard_class), correct: strictOf(answer, truth) });

async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }

/** Eval items, optionally narrowed (dev smoke): --sources and --limit per source. */
function selectItems(ctx, { sources = null, limit = null } = {}) {
  const { items } = itemsOf(ctx.manifest);
  const seen = {};
  return items.filter(it => (!sources || sources.includes(it.source)) && (!limit || (seen[it.source] = (seen[it.source] ?? 0) + 1) <= limit));
}

// ------------------------------------------------------------------------------------------------ reuse ($0)
/** The proven entry on every eval item, in B's world, with every gate verdict (computed for all items; arms decide later). */
async function cmdReuse(ctx, { concurrency = 4, sources, limit } = {}) {
  const entry = ctx.registry.get(PROVEN_ID);
  if (!entry) throw new Error(`${PROVEN_ID} is not registered (run prove.mjs)`);
  const prof = loadProfiles(entry);
  const files = artifactFiles(entry.artifact.dir);
  const worlds = worldsOf(ctx.manifest, { toolOrder: ctx.toolOrder, makeWorld });
  const outFile = path.join(ctx.setLive, 'reuse.jsonl');
  const done = new Set(readJsonl(outFile).map(r => r.id));
  const todo = selectItems(ctx, { sources, limit }).filter(it => !done.has(it.product.id));
  const t0 = Date.now();
  await pool(todo, concurrency, async it => {
    const task = subtaskOf(it.product, ctx.bankTexts);
    const tg = Date.now();
    const g2 = gateInput(prof.input, task);
    const g2Ms = Date.now() - tg;
    const run = await runArtifact({ files, sdkDir: entry.sdk.dir, catalog: ctx.catalog, outputColumns: ['hazard_class'], task, world: worlds[it.source], live: ctx.setLive, tag: `reuse-${it.product.index}` });
    const doc = traceDoc(run);
    const tg3 = Date.now();
    const g3 = gateTraceDoc(prof.trace, doc);
    const g3Ms = Date.now() - tg3;
    const grade = run.status === 'done' ? gradeItem(run.answer, it.product.truth) : { cls: null, correct: false };
    appendJsonl(outFile, { id: it.product.id, index: it.product.index, source: it.source, shipment: it.shipment, edgeKind: it.product.edgeKind, truth: it.product.truth.hazard_class,
      entry: entry.id, status: run.status, answer: grade.cls, correct: grade.correct, deopt: run.deopt, steps: run.steps, costUsd: run.costUsd, durationMs: run.durationMs, sandboxMs: run.sandboxMs, g2Ms, g3Ms,
      g2, g3, variants: gateAll(prof, task, doc), doc });
  });
  const recs = readJsonl(outFile);
  console.log(`reuse ${ctx.set}: ${recs.length} items in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return recs;
}

// ------------------------------------------------------------------------------------------------ build (paid)
/** One lineage of builds: per supplier, the same builder on that supplier's labelled history; each finished build is
 * proved on its examples and registered, scoped to the supplier. */
async function cmdBuild(ctx, { lineage = 1, sources = null, concurrency = 2, cap = SPEND_CAP_USD } = {}) {
  const ledger = spendLedger(cap);
  const byId = new Map(ctx.manifest.products.map(p => [p.id, p]));
  const outFile = path.join(ctx.setLive, 'builds.jsonl');
  const have = new Set(readJsonl(outFile).filter(r => !r.envFault).map(r => `${r.source}#${r.lineage}`));
  const todo = (sources ?? Object.keys(ctx.manifest.sources)).filter(s => !have.has(`${s}#${lineage}`));
  const { port, db } = createModelPort({ journalFile: path.join(ctx.live, 'journal.sqlite'), allowedModels: ['claude-haiku-5-5'], concurrency: { 'claude-cli': 2 } });
  const worldsAll = worldsOf(ctx.manifest, { toolOrder: ctx.toolOrder, makeWorld });
  let stopped = null;
  try {
    await pool(todo, concurrency, async source => {
      if (stopped) return;
      const ex = ids => ids.map(id => ({ product: byId.get(id), task: subtaskOf(byId.get(id), ctx.bankTexts) }));
      const spec = ctx.manifest.sources[source];
      const label = `${source}-L${lineage}`;
      const worldFor = ids => makeWorld({ name: `B:${source}:build`, products: [...worldsAll[source].byId.values()], response: worldsAll[source].response, allowed: ids, toolOrder: ctx.toolOrder });
      const rec = await buildForSource({ label, sopText: ctx.sopText, catalog: ctx.catalog, buildExamples: ex(spec.build), repairExamples: ex(spec.repair), worldFor, live: ctx.setLive,
        modelPort: port, reserve: ledger.reserve, settle: (b, usd) => ledger.settle(b, usd, { phase: 'build', runId: ctx.runId, set: ctx.set, label }), log: m => process.stderr.write(m + '\n') });
      rec.source = source; rec.lineage = lineage;
      if (rec.artifactDir) {
        // Prove and register the build: evidence = the examples it passes; profiles from those examples' inputs and runs.
        const files = artifactFiles(rec.artifactDir);
        const passIds = rec.proof.inputs.map(ix => ctx.manifest.products.find(p => p.index === ix).id);
        const runs = [];
        for (const id of passIds) {
          const p = byId.get(id), task = subtaskOf(p, ctx.bankTexts);
          const run = await runArtifact({ files, catalog: ctx.catalog, outputColumns: ['hazard_class'], task, world: worldFor([...spec.build, ...spec.repair]), live: ctx.setLive, tag: `prove-${label}-${p.index}`, modelPort: port, judgeModels: ['claude-haiku-5-5'] });
          runs.push({ task, run });
        }
        const contract = contractOf({ procedureText: ctx.sopText, catalog: ctx.catalog, inputColumns: Object.keys(runs[0]?.task.inputs ?? {}), outputColumns: ['hazard_class'] });
        const pdir = path.join(ctx.live, 'registry', 'profiles');
        const id = `c2-built:${ctx.set}:${label}`;
        if (runs.length && !ctx.registry.get(id)) ctx.registry.register({ id, contractHash: contractHashOf(contract), contract, scope: { source },
          artifact: { dir: rec.artifactDir, sha256: rec.artifactSha256, files: Object.keys(files).sort() }, sdk: { dir: null, sha256: null },
          origin: { program: 'B (Hazmat Shipment Desk), rebuilt by the SOP-Bench builder loop', evidence: { kind: 'B labelled history (build + repair)', pass: rec.devPass, of: rec.devRows } },
          profiles: { input: saveProfile(pdir, `${id.replace(/[:/]/g, '_')}.input`, learnInputProfile(runs.map(r => r.task))), trace: saveProfile(pdir, `${id.replace(/[:/]/g, '_')}.trace`, learnTraceProfile(runs.map(r => r.run))) } });
        rec.registered = id;
      }
      appendJsonl(outFile, rec);
      if (rec.envFault) stopped ??= `environment fault at ${label}: ${rec.envFault}`;
      if (rec.stopped === 'cap') stopped ??= `the spend cap at ${label}`;
    });
  } finally { db.close(); }
  console.log(`builds lineage ${lineage}: ${readJsonl(outFile).filter(r => r.lineage === lineage).length} recorded; spent so far $${ledger.spent().toFixed(4)}${stopped ? `; stopped: ${stopped}` : ''}`);
  if (stopped) process.exitCode = 3;
}

// ------------------------------------------------------------------------------------------------ built ($0)
async function cmdBuilt(ctx, { concurrency = 4 } = {}) {
  const builds = readJsonl(path.join(ctx.setLive, 'builds.jsonl')).filter(r => r.artifactDir);
  const worlds = worldsOf(ctx.manifest, { toolOrder: ctx.toolOrder, makeWorld });
  const outFile = path.join(ctx.setLive, 'built.jsonl');
  const done = new Set(readJsonl(outFile).map(r => `${r.id}#${r.lineage}`));
  const jobs = [];
  for (const b of builds) {
    const files = artifactFiles(b.artifactDir);
    for (const it of selectItems(ctx, { sources: [b.source] })) if (!done.has(`${it.product.id}#${b.lineage}`)) jobs.push({ b, files, it });
  }
  const needsJudge = builds.some(b => (b.judgeCallsPerRun ?? 0) > 0);
  const mp = needsJudge ? createModelPort({ journalFile: path.join(ctx.live, 'journal.sqlite'), allowedModels: ['claude-haiku-5-5'], concurrency: { 'claude-cli': 2 } }) : null;
  const t0 = Date.now();
  try {
    await pool(jobs, concurrency, async ({ b, files, it }) => {
      const task = subtaskOf(it.product, ctx.bankTexts);
      const run = await runArtifact({ files, catalog: ctx.catalog, outputColumns: ['hazard_class'], task, world: worlds[it.source], live: ctx.setLive, tag: `built-${b.lineage}-${it.product.index}`,
        modelPort: mp?.port ?? null, judgeModels: ['claude-haiku-5-5'] });
      const grade = run.status === 'done' ? gradeItem(run.answer, it.product.truth) : { cls: null, correct: false };
      appendJsonl(outFile, { id: it.product.id, source: it.source, shipment: it.shipment, lineage: b.lineage, build: b.label, status: run.status, answer: grade.cls, correct: grade.correct,
        deopt: run.deopt, costUsd: run.costUsd, judgeCalls: run.judgeCalls, durationMs: run.durationMs, sandboxMs: run.sandboxMs });
    });
  } finally { mp?.db.close(); }
  console.log(`built ${ctx.set}: ${jobs.length} runs in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

// ------------------------------------------------------------------------------------------------ agent (paid)
async function cmdAgent(ctx, { k = 1, concurrency = 3, sources, limit, cap = SPEND_CAP_USD } = {}) {
  const ledger = spendLedger(cap);
  const worlds = worldsOf(ctx.manifest, { toolOrder: ctx.toolOrder, makeWorld });
  const outFile = path.join(ctx.setLive, 'agent.jsonl');
  const done = new Set(readJsonl(outFile).filter(r => !r.envFault).map(r => `${r.id}#${r.k}`));
  const todo = selectItems(ctx, { sources, limit }).filter(it => !done.has(`${it.product.id}#${k}`));
  let stopped = null;
  const t0 = Date.now();
  await pool(todo, concurrency, async it => {
    if (stopped) return;
    if (!(await ledger.reserve(AGENT_DEFAULTS.budgetUsd))) { stopped ??= 'cap'; return; }
    const task = subtaskOf(it.product, ctx.bankTexts);
    const r = await runAgentItem({ task, truth: it.product.truth, world: worlds[it.source], catalog: ctx.catalog, sopText: ctx.sopText, live: ctx.setLive, tag: `agent-${k}-${it.product.index}` });
    ledger.settle(AGENT_DEFAULTS.budgetUsd, r.costUsd, { phase: 'agent', runId: ctx.runId, set: ctx.set, item: it.product.index, k });
    // SOP-Bench's classification (run.mjs isEnvFault): a rate/usage limit, an unavailable model or sandbox, an executor launch
    // or protocol failure, a disk fault; any harness error here too. Never scored: recorded, the phase stops, a resume reruns it.
    const envFault = isEnvFault({ sessionError: r.sessionError, harnessError: r.harnessError }) || r.harnessError ? (r.sessionError ?? 'HARNESS') : null;
    appendJsonl(outFile, { id: it.product.id, source: it.source, shipment: it.shipment, k, answer: r.cls, correct: r.strict, costUsd: r.costUsd, costUnknown: r.costUnknown, durationMs: r.durationMs,
      turns: r.turns, steps: r.steps, toolCalls: r.toolCalls, toolErrors: r.toolErrors, sessionError: r.sessionError, envFault, nestedModelUses: r.nestedModelUses, violations: r.audit?.violations ?? null,
      models: r.audit?.models ?? null, answerTail: r.answerText.slice(-400) });
    if (envFault) stopped ??= `environment fault: ${envFault}`;
  });
  console.log(`agent ${ctx.set} k=${k}: ${readJsonl(outFile).filter(r => r.k === k).length} items recorded in ${((Date.now() - t0) / 1000).toFixed(0)} s; spent so far $${ledger.spent().toFixed(4)}${stopped ? `; stopped: ${stopped}` : ''}`);
  if (stopped) process.exitCode = 3;
}

function parseArgs(argv) {
  const [cmd, ...rest] = argv; const a = { cmd };
  for (let i = 0; i < rest.length; i++) { const k = rest[i]; if (!k.startsWith('--')) throw new Error(`unexpected ${k}`); a[k.slice(2)] = rest[i + 1]?.startsWith('--') || rest[i + 1] === undefined ? true : rest[++i]; }
  return a;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2));
  if (!a['run-id'] || !a.set) throw new Error('--run-id and --set required');
  if (!SEEDS[a.set]) throw new Error('--set dev|test');
  const ctx = ctxOf(a['run-id'], a.set);
  mkdirSync(ctx.setLive, { recursive: true });
  const sources = a.sources ? String(a.sources).split(',') : null, limit = a.limit ? Number(a.limit) : null, cap = a.cap ? Number(a.cap) : SPEND_CAP_USD;
  if (cap > SPEND_CAP_USD) throw new Error(`--cap above the experiment cap $${SPEND_CAP_USD}`);
  if (a.cmd === 'gen') cmdGen(ctx);
  else if (!ctx.manifest) throw new Error(`no manifest for ${a.set}: run gen first`);
  else if (a.cmd === 'reuse') await cmdReuse(ctx, { concurrency: Number(a.concurrency ?? 4), sources, limit });
  else if (a.cmd === 'freeze') cmdFreeze(ctx);
  else if (a.cmd === 'build') { checkFreeze(ctx); await cmdBuild(ctx, { lineage: Number(a.lineage ?? 1), sources, concurrency: Number(a.concurrency ?? 2), cap }); }
  else if (a.cmd === 'built') { checkFreeze(ctx); await cmdBuilt(ctx, { concurrency: Number(a.concurrency ?? 4) }); }
  else if (a.cmd === 'agent') { checkFreeze(ctx); await cmdAgent(ctx, { k: Number(a.k ?? 1), concurrency: Number(a.concurrency ?? 3), sources, limit, cap }); }
  else if (a.cmd === 'analyze') { const { analyze } = await import('./analyze.mjs'); await analyze(ctx, { freeze: checkFreeze(ctx, { strict: false }) }); }
  else throw new Error(`unknown command ${a.cmd}`);
}
