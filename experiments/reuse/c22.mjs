#!/usr/bin/env node
// C2-2 driver (research/reuse-20261021/PREREG-C2-2.md): consumer conformance (conformance.mjs) as the gate for reusing
// program A's proven dangerous_goods workflow in program B, preregistered on fresh suppliers, with four supplier kinds
// aimed at its blind spots (gen-c22.mjs). $0: the entry is a code-only workflow; no model is called anywhere.
//
//   node experiments/reuse/c22.mjs devcheck                   on C2-1's test set (C2-2's dev): history runs with traces,
//                                                             G0-15 ∧ b3c post-hoc  -> runs/c2-1/devcheck-c22.json
//   node experiments/reuse/c22.mjs gen      --seed c2-test-2  manifest              -> runs/c2-2/manifest-c22.json
//   node experiments/reuse/c22.mjs freeze                     FREEZE-C2-2.json (code, manifest, prereg hashes)
//   node experiments/reuse/c22.mjs run                        the entry on every history product and stream item (records
//                                                             with traces under LIVE_ROOT/c2-2/, outside the repo)
//   node experiments/reuse/c22.mjs analyze                    every gate, every metric -> runs/c2-2/summary-c22.json
// Options: --concurrency N (default 4).
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { artifactFiles } from '../sopbench/exec.mjs';
import { itemsOf, subtaskOf, worldsOf } from './gen-b.mjs';
import { makeWorld } from './world-b.mjs';
import { runArtifact } from './host.mjs';
import { gateAll, traceDoc } from './gate.mjs';
import { loadProfiles } from './registry.mjs';
import { ctxOf, gradeItem, PROVEN_ID } from './c2.mjs';
import { admitByConformance, gateItem, widenedProfiles, CONFORMANCE_VERSION } from './conformance.mjs';
import { C22_SOURCES, HIST_SMALL, generateC22, historyOf, kindOf, labelOf, worldsC22 } from './gen-c22.mjs';
import { clustersOf, crossedOf, reuseBoundRule, reuseBoundRule2 } from '../lib/stats.mjs';
import { HERE, LIVE_ROOT, RESEARCH, appendJsonl, mean, readJson, readJsonl, sha256, usd, writeJson } from './lib.mjs';
import { strictOf } from './build-b.mjs';

export const RUN_ID = 'c2-2';
export const C22_SEED = 'c2-test-2';
export const FREEZE_FILE = path.join(RESEARCH, 'FREEZE-C2-2.json');
export const PREREG_FILE = path.join(RESEARCH, 'PREREG-C2-2.md');
export const OUT = path.join(RESEARCH, 'runs', RUN_ID);
export const LIVE = path.join(LIVE_ROOT, RUN_ID);
export const MANIFEST_FILE = path.join(OUT, 'manifest-c22.json');
export const PRIMARY = 'G0-M3+b3c';
/** Projection inputs, fixed before the run from C2-1's lineage-1 builds (summary-test.json): mean USD and wall per build,
 * and the agent's measured USD per item. Used only for the labelled cost projection. */
export const C21_UNIT = Object.freeze({ buildUsd: 0.0506, buildWallMs: 241291, agentUsdPerItem: 0.00134, agentMsPerItem: 11449 });
export const FROZEN_CODE = Object.freeze(['c22.mjs', 'conformance.mjs', 'gen-c22.mjs', 'gen-b.mjs', 'program-b.mjs', 'world-b.mjs', 'gate.mjs', 'host.mjs', 'registry.mjs', 'lib.mjs', 'c2.mjs', 'build-b.mjs',
  '../jit/profile.mjs', '../lib/stats.mjs', '../sopbench/exec.mjs', '../sopbench/scorer.mjs', '../sopbench/kit/sop.mjs']);
export const codeHashes = () => Object.fromEntries(FROZEN_CODE.map(f => [f, sha256(readFileSync(path.join(HERE, f), 'utf8'))]));

async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }

/** The proven entry as C2-1 registered it (LIVE_ROOT/c2-1: the proof bank, the registry, the profiles). */
function entryCtx() {
  const ctx = ctxOf('c2-1', 'test');
  const entry = ctx.registry.get(PROVEN_ID);
  if (!entry) throw new Error(`${PROVEN_ID} is not registered under LIVE_ROOT/c2-1`);
  return { ctx, entry, profiles: loadProfiles(entry), files: artifactFiles(entry.artifact.dir) };
}

/** One run of the entry on a product in a world; graded against `expected` (a label string). */
async function runEntry(ec, { product, world, live, tag, expected }) {
  const task = subtaskOf(product, ec.ctx.bankTexts);
  const run = await runArtifact({ files: ec.files, sdkDir: ec.entry.sdk.dir, catalog: ec.ctx.catalog, outputColumns: ['hazard_class'], task, world, live, tag });
  const doc = traceDoc(run);
  const cls = run.status === 'done' ? gradeItem(run.answer, { hazard_class: expected }).cls : null;
  const correct = run.status === 'done' && strictOf(run.answer, { hazard_class: expected });
  return { task, run, doc, cls, correct };
}

// ------------------------------------------------------------------------------------------------ gates ($0, offline)
/**
 * Every gate's verdict for every stream item. hist: Map source -> [{ id, conform, task, doc }] in pool order;
 * stream: [{ id, source, shipment, correct, task, doc, variants }] (variants: gate.mjs gateAll on A's profiles).
 */
export function gateVerdicts({ profiles, hist, stream }) {
  const adm = {}, wide = {};
  for (const [source, hs] of hist) {
    const small = hs.slice(0, HIST_SMALL);
    adm[source] = { all15: admitByConformance(small.map(h => ({ id: h.id, conform: h.conform })), { rule: 'all' }),
      all60: admitByConformance(hs.map(h => ({ id: h.id, conform: h.conform })), { rule: 'all' }),
      m3: admitByConformance(hs.map(h => ({ id: h.id, conform: h.conform })), { rule: 'm3' }) };
    wide[source] = { p15: widenedProfiles(profiles, small), p60: widenedProfiles(profiles, hs) };
  }
  return stream.map(s => {
    const a = adm[s.source], w = wide[s.source];
    const b3 = s.variants.g2.accept && s.variants.g3.accept;
    const c15 = gateItem(w.p15, s.task, s.doc), c60 = gateItem(w.p60, s.task, s.doc);
    return { id: s.id, source: s.source, shipment: s.shipment, correct: s.correct, gates: {
      b0: true, b3, 'G0-15': a.all15.admit, 'G0-15+b3c': a.all15.admit && c15.accept, 'G0-60': a.all60.admit, 'G0-M3': a.m3.admit, 'G0-M3+b3c': a.m3.admit && c60.accept, oracle: s.correct },
      b3cReasons: c60.accept ? null : c60.reasons };
  }).map(v => ({ ...v, admission: adm[v.source] }));
}

const pct = (a, b) => (b ? a / b : null);
/** Gate metrics over verdicts: accepted, wrong accepted, deopt, false deopt, catch, by supplier, M3 on admitted. */
export function gateMetrics(verdicts, gate, { sources = null } = {}) {
  const vs = sources ? verdicts.filter(v => sources.includes(v.source)) : verdicts;
  const acc = vs.filter(v => v.gates[gate]), ref = vs.filter(v => !v.gates[gate]), harmful = vs.filter(v => !v.correct);
  const admitted = acc.map(v => ({ parent: v.shipment, entry: PROVEN_ID, wrong: !v.correct }));
  const deoptSources = [...new Set(ref.map(v => v.source))];
  return { items: vs.length, accepted: acc.length, reuseRate: pct(acc.length, vs.length), wrongReuse: acc.filter(v => !v.correct).length, wrongReuseRate: pct(acc.filter(v => !v.correct).length, acc.length),
    deopt: ref.length, deoptRate: pct(ref.length, vs.length), falseDeopt: ref.filter(v => v.correct).length, falseDeoptRate: pct(ref.filter(v => v.correct).length, ref.length),
    harmful: harmful.length, catchRate: pct(harmful.filter(v => !v.gates[gate]).length, harmful.length), buildsNeeded: deoptSources.length,
    m3: admitted.length ? { parentExact: (({ decision, upper, nEff }) => ({ decision, upper, nEff }))(reuseBoundRule(clustersOf(admitted), { method: 'exact' })),
      crossedExact: (({ decision, upper, nEff, entries }) => ({ decision, upper, nEff, entries }))(reuseBoundRule2(crossedOf(admitted))) } : null,
    bySource: Object.fromEntries([...new Set(vs.map(v => v.source))].map(s => { const r = vs.filter(v => v.source === s); return [s, { items: r.length, entryRight: r.filter(v => v.correct).length,
      accepted: r.filter(v => v.gates[gate]).length, wrong: r.filter(v => v.gates[gate] && !v.correct).length, falseDeopt: r.filter(v => !v.gates[gate] && v.correct).length }]; })) };
}

/** Cost and latency projection per item (labelled projection: C2-1 unit costs; builds for every supplier with a deopt). */
export function projection(m, { nSources, runMsPerItem }) {
  const buildUsd = m.buildsNeeded * C21_UNIT.buildUsd, buildMs = m.buildsNeeded * C21_UNIT.buildWallMs;
  const scratchUsd = nSources * C21_UNIT.buildUsd, scratchMs = nSources * C21_UNIT.buildWallMs;
  return { reuseUsdPerItem: usd(buildUsd / m.items), scratchUsdPerItem: usd(scratchUsd / m.items), agentUsdPerItem: C21_UNIT.agentUsdPerItem,
    reuseMsPerItem: Math.round(runMsPerItem + buildMs / m.items), scratchMsPerItem: Math.round(runMsPerItem + scratchMs / m.items), agentMsPerItem: C21_UNIT.agentMsPerItem,
    // REUSE and SCRATCH share the builds on refused items; on accepted items REUSE takes the entry's answer. So
    // acc(REUSE) − acc(SCRATCH) = (accepted items the build gets wrong − wrong accepted) / items ≥ − wrong accepted / items.
    accuracyGapLowerBound: m.items ? -m.wrongReuse / m.items : null };
}

// ------------------------------------------------------------------------------------------------ devcheck (C2-1 data)
async function cmdDevcheck({ concurrency }) {
  const ec = entryCtx(), { ctx } = ec;
  const worlds = worldsOf(ctx.manifest, { toolOrder: ctx.toolOrder, makeWorld });
  const byId = new Map(ctx.manifest.products.map(p => [p.id, p]));
  const outFile = path.join(ctx.setLive, 'history-c22.jsonl');
  const have = new Set(readJsonl(outFile).map(r => r.id));
  const jobs = Object.entries(ctx.manifest.sources).flatMap(([source, spec]) => [...spec.build, ...spec.repair].filter(id => !have.has(id)).map(id => ({ source, p: byId.get(id) })));
  await pool(jobs, concurrency, async ({ source, p }) => {
    const r = await runEntry(ec, { product: p, world: worlds[source], live: ctx.setLive, tag: `c22-hist-${p.index}`, expected: p.truth.hazard_class });
    appendJsonl(outFile, { id: p.id, source, conform: r.correct, answer: r.cls, label: p.truth.hazard_class, status: r.run.status, durationMs: r.run.durationMs, doc: r.doc });
  });
  const histRecs = readJsonl(outFile);
  const hist = new Map(Object.entries(ctx.manifest.sources).map(([s, spec]) => [s, [...spec.build, ...spec.repair].map(id => { const h = histRecs.find(x => x.id === id); return { ...h, task: subtaskOf(byId.get(id), ctx.bankTexts) }; })]));
  const reuse = readJsonl(path.join(ctx.setLive, 'reuse.jsonl'));
  const stream = reuse.map(r => ({ id: r.id, source: r.source, shipment: r.shipment, correct: r.correct, task: subtaskOf(byId.get(r.id), ctx.bankTexts), doc: r.doc, variants: r.variants }));
  const verdicts = gateVerdicts({ profiles: ec.profiles, hist, stream });
  const gates = ['b3', 'G0-15', 'G0-15+b3c', 'oracle'];
  const out = { kind: 'c22-devcheck', note: 'POST-HOC on C2-1 test data (C2-2 dev): G0-15 and G0-15 with b3c (profiles widened with the conforming history)', conformanceVersion: CONFORMANCE_VERSION,
    admission: Object.fromEntries([...hist.keys()].map(s => [s, verdicts.find(v => v.source === s)?.admission.all15 ?? null])),
    gates: Object.fromEntries(gates.map(g => [g, gateMetrics(verdicts, g)])),
    b3cRefusals: verdicts.filter(v => v.gates['G0-15'] && !v.gates['G0-15+b3c']).map(v => ({ id: v.id, source: v.source, correct: v.correct })) };
  writeJson(path.join(ctx.out, 'devcheck-c22.json'), out);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(out.gates).map(([g, m]) => [g, { accepted: m.accepted, wrong: m.wrongReuse, falseDeopt: m.falseDeopt, catch: m.catchRate, builds: m.buildsNeeded }])), null, 1));
  console.log('b3c refusals among G0-admitted:', JSON.stringify(out.b3cRefusals));
}

// ------------------------------------------------------------------------------------------------ gen / freeze / run
function cmdGen({ seed }) {
  if (existsSync(MANIFEST_FILE)) throw new Error(`${MANIFEST_FILE} exists; a manifest is never regenerated`);
  if (seed !== C22_SEED) throw new Error(`the preregistered seed is ${C22_SEED}`);
  const { ctx } = entryCtx();
  const m = generateC22({ seed, bank: ctx.bank.map(b => ({ row: b.row, total: b.total })) });
  writeJson(MANIFEST_FILE, m);
  const { items } = itemsOf(m);
  console.log(`manifest c2-2: ${m.shipments.length} shipments, ${items.length} stream items, ${m.products.length} products, sha256 ${m.sha256}`);
}

function cmdFreeze() {
  if (existsSync(FREEZE_FILE)) throw new Error(`${FREEZE_FILE} exists; a freeze is never rewritten`);
  if (!existsSync(PREREG_FILE)) throw new Error('write PREREG-C2-2.md first');
  const m = readJson(MANIFEST_FILE), { entry } = entryCtx();
  const live = readJsonl(path.join(LIVE, 'stream.jsonl'));
  writeJson(FREEZE_FILE, { kind: 'c22-freeze', id: 'C2-2', createdAt: new Date().toISOString(), manifestSha256: m.sha256, manifestFile: path.relative(RESEARCH, MANIFEST_FILE),
    preregSha256: sha256(readFileSync(PREREG_FILE, 'utf8')), code: codeHashes(), entry: { id: entry.id, artifactSha256: entry.artifact.sha256, inputProfileSha256: entry.profiles.input.sha256, traceProfileSha256: entry.profiles.trace.sha256 },
    primary: PRIMARY, unitCosts: C21_UNIT, streamRecordsBeforeFreeze: live.length, spendUsd: 0 });
  console.log(`freeze written: ${FREEZE_FILE}`);
}

function checkFreeze({ strict = true } = {}) {
  if (!existsSync(FREEZE_FILE)) { if (strict) throw new Error('no FREEZE-C2-2.json'); return { ok: false, missing: true }; }
  const f = readJson(FREEZE_FILE), now = codeHashes(), m = readJson(MANIFEST_FILE);
  const changed = Object.keys(f.code).filter(k => f.code[k] !== now[k]);
  const ok = !changed.length && f.manifestSha256 === m.sha256 && f.preregSha256 === sha256(readFileSync(PREREG_FILE, 'utf8'));
  if (!ok && strict) throw new Error(`C2-2 changed since the freeze: ${changed.join(', ') || 'manifest or prereg'}`);
  return { ok, changed };
}

async function cmdRun({ concurrency }) {
  checkFreeze();
  const ec = entryCtx(), m = readJson(MANIFEST_FILE);
  const worlds = worldsC22(m, { toolOrder: ec.ctx.toolOrder, makeWorld });
  mkdirSync(LIVE, { recursive: true });
  const histFile = path.join(LIVE, 'history.jsonl'), streamFile = path.join(LIVE, 'stream.jsonl');
  const haveH = new Set(readJsonl(histFile).map(r => r.id)), haveS = new Set(readJsonl(streamFile).map(r => r.id));
  const histJobs = Object.keys(m.sources).flatMap(s => historyOf(m, s).filter(p => !haveH.has(p.id)).map(p => ({ s, p })));
  const t0 = Date.now();
  await pool(histJobs, concurrency, async ({ s, p }) => {
    const r = await runEntry(ec, { product: p, world: worlds[s].history, live: LIVE, tag: `h-${p.index}`, expected: labelOf(p) });
    appendJsonl(histFile, { id: p.id, source: s, conform: r.correct, answer: r.cls, label: labelOf(p), truth: p.truth.hazard_class, status: r.run.status, durationMs: r.run.durationMs, doc: r.doc });
  });
  const { items } = itemsOf(m);
  await pool(items.filter(it => !haveS.has(it.product.id)), concurrency, async it => {
    const r = await runEntry(ec, { product: it.product, world: worlds[it.source].stream, live: LIVE, tag: `s-${it.product.index}`, expected: it.product.truth.hazard_class });
    appendJsonl(streamFile, { id: it.product.id, source: it.source, shipment: it.shipment, correct: r.correct, answer: r.cls, truth: it.product.truth.hazard_class, drift: it.product.drift ?? null,
      subBrand: !!it.product.subBrand, status: r.run.status, durationMs: r.run.durationMs, doc: r.doc, variants: gateAll(ec.profiles, r.task, r.doc) });
  });
  console.log(`c2-2 run: ${readJsonl(histFile).length} history runs, ${readJsonl(streamFile).length} stream runs, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

export const GATE_LIST = Object.freeze(['b0', 'b3', 'G0-15', 'G0-15+b3c', 'G0-60', 'G0-M3', 'G0-M3+b3c', 'oracle']);
async function cmdAnalyze() {
  const freeze = checkFreeze({ strict: false });
  const ec = entryCtx(), m = readJson(MANIFEST_FILE);
  const byId = new Map(m.products.map(p => [p.id, p]));
  const histRecs = new Map(readJsonl(path.join(LIVE, 'history.jsonl')).map(r => [r.id, r]));
  const hist = new Map(Object.keys(m.sources).map(s => [s, historyOf(m, s).map(p => ({ ...histRecs.get(p.id), task: subtaskOf(p, ec.ctx.bankTexts) }))]));
  const streamRecs = readJsonl(path.join(LIVE, 'stream.jsonl'));
  const stream = streamRecs.map(r => ({ ...r, task: subtaskOf(byId.get(r.id), ec.ctx.bankTexts) }));
  const verdicts = gateVerdicts({ profiles: ec.profiles, hist, stream });
  const c21 = Object.keys(m.sources).filter(s => kindOf(s).kind === 'c2-1'), tk = Object.keys(m.sources).filter(s => kindOf(s).kind === 't');
  const runMsPerItem = mean(streamRecs.map(r => r.durationMs)) ?? 0;
  const histMsPerSource = Object.fromEntries([...hist].map(([s, hs]) => [s, hs.reduce((a, h) => a + (h.durationMs ?? 0), 0)]));
  const gates = Object.fromEntries(GATE_LIST.map(g => {
    const all = gateMetrics(verdicts, g), c = gateMetrics(verdicts, g, { sources: c21 }), t = gateMetrics(verdicts, g, { sources: tk }), noT1 = gateMetrics(verdicts, g, { sources: Object.keys(m.sources).filter(s => s !== 'T1') });
    return [g, { all, c21Kinds: c, tKinds: t, withoutT1: noT1, projection: projection(all, { nSources: Object.keys(m.sources).length, runMsPerItem }) }];
  }));
  const summary = { kind: 'c22-summary', id: 'C2-2', evidence: 'development evidence (preregistered; self-authored second program and suppliers; not sealed); $0', freeze,
    manifestSha256: m.sha256, items: stream.length, shipments: new Set(stream.map(s => s.shipment)).size, sources: Object.keys(m.sources), primary: PRIMARY,
    historyRuns: [...histRecs.values()].length, statuses: { history: countBy([...histRecs.values()], r => r.status), stream: countBy(streamRecs, r => r.status) },
    admission: Object.fromEntries([...hist.keys()].map(s => [s, verdicts.find(v => v.source === s)?.admission ?? null])),
    conformanceBySource: Object.fromEntries([...hist].map(([s, hs]) => [s, { pass15: hs.slice(0, HIST_SMALL).filter(h => h.conform).length, pass60: hs.filter(h => h.conform).length, of: hs.length }])),
    gates, runMsPerItem: Math.round(runMsPerItem), histMsPerSource,
    b3cRefusedAmongAdmitted: verdicts.filter(v => v.gates['G0-M3'] && !v.gates['G0-M3+b3c']).map(v => ({ id: v.id, source: v.source, correct: v.correct, reasons: v.b3cReasons })),
    generatedAt: new Date().toISOString() };
  writeJson(path.join(OUT, 'summary-c22.json'), summary);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(gates).map(([g, x]) => [g, { acc: x.all.accepted, wrong: x.all.wrongReuse, falseDeopt: x.all.falseDeopt, catch: x.all.catchRate, builds: x.all.buildsNeeded, m3: x.all.m3?.parentExact.decision }])), null, 1));
}
const countBy = (xs, f) => xs.reduce((m, x) => ({ ...m, [f(x)]: (m[f(x)] ?? 0) + 1 }), {});

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = Object.fromEntries(rest.reduce((acc, x, i, xs) => (x.startsWith('--') ? [...acc, [x.slice(2), xs[i + 1]]] : acc), []));
  const concurrency = Number(a.concurrency ?? 4);
  if (cmd === 'devcheck') await cmdDevcheck({ concurrency });
  else if (cmd === 'gen') cmdGen({ seed: a.seed });
  else if (cmd === 'freeze') cmdFreeze();
  else if (cmd === 'run') await cmdRun({ concurrency });
  else if (cmd === 'analyze') await cmdAnalyze();
  else throw new Error(`unknown command ${cmd} (devcheck | gen | freeze | run | analyze)`);
}
export { C22_SOURCES };
