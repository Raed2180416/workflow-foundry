// Requirement tracker, the runner and CLI (TRACKER-DESIGN.md §3–§5, §7). Runs candidate builds on the practice worlds
// (model-written solvers only out of process: beds/ebed/host/sandbox-arm.mjs), projects each run to a trace v1, runs
// every trustworthy property over every trace (sandboxed, checks.mjs), applies the §3 status rules and G3, and writes,
// per build, a ledger copy with statuses and evidence plus report.md. `calibrate` (G4, evaluation only) runs the bed's
// reference runs and necessity controls instead of builds: analyst-side, in process, never shown to a builder.
//
//   node experiments/tracker/run.mjs extract   --text <user text> [--out DIR] [--model ID] [--samples N] [--budget USD]
//   node experiments/tracker/run.mjs ledger    --text <user text> --entries <gold.json> [--out DIR]          ($0: a frozen list)
//   node experiments/tracker/run.mjs edit      --ledger <ledger.json> --text <user text> --edits <edits.json>
//   node experiments/tracker/run.mjs write     --ledger <ledger.json> [--model ID] [--escalate ID|none] [--budget USD] [--reasoning low]
//   node experiments/tracker/run.mjs check     --ledger <ledger.json> --build <solver.mjs> [--build ...] [--out DIR] [--worlds 1235:2,1236:3,1237:5] [--size N]
//   node experiments/tracker/run.mjs calibrate --ledger <ledger.json> [--teeth <teeth.json>] [--out DIR] [--worlds ...]
//   node experiments/tracker/run.mjs all       --text <user text> --build <solver.mjs> [--build ...] [--out DIR] [--budget USD]
//
// Model calls (extract, write) go through experiments/lib/models.mjs createModelPort (journaled in <out>/journal.sqlite,
// priced by the provider) and a hard spend cap (--budget, default $2; every call and escalation is also appended to
// <out>/model-calls.jsonl). Model ids default from policy/models.json (class M; the next class for the one escalation).
// check / calibrate / ledger / edit cost $0.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createHost } from '../../beds/ebed/host/host.mjs';
import { sandboxArm } from '../../beds/ebed/host/sandbox-arm.mjs';
import { PRACTICE } from '../ebed/smoke-service.mjs';
import { projectTrace, E8_SUBJECT, FILE_PREFIXES } from './trace.mjs';
import { buildLedger, applyEdits, readLedger, writeLedger } from './ledger.mjs';
import { extractLedger, budgetedPort, defaultModels, checkModelId, BudgetError } from './extract.mjs';
import { runProperties, runContrast, writeCheck, needsCheck, statusOf, suspects } from './checks.mjs';
import { renderReport, excerptLines, healthOf } from './report.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = s => createHash('sha256').update(s).digest('hex');
const rel = p => path.relative(ROOT, path.resolve(p)) || p;
export const DEFAULT_OUT = '/var/tmp/foundry-work/tracker';

// ---------------------------------------------------------------------------------------------------------------
// Runs and traces.
/** Wrap an arm so the reference files it was given are kept (what the workflow had; the trace's t.files). */
export function captureFiles(arm) {
  const files = {};
  return { files, arm: { ...arm, id: arm.id, tick(input, ctx) { for (const [p, v] of Object.entries(ctx.files ?? {})) if (FILE_PREFIXES.some(x => p.startsWith(x))) files[p] = v; return arm.tick(input, ctx); }, close: arm.close } };
}
/** Final business records: every arm-visible table (hidden tables are mock-internal and never shown). */
export function recordsOf(host) {
  const out = {};
  for (const [id, sys] of host.systems) for (const [t, def] of Object.entries(sys.def.tables)) if (!def.hidden) out[`${id}.${t}`] = sys.query(t, {}, false, { unbounded: true });
  return out;
}

/** Run one arm over one world and project the trace. */
export async function runWorld({ item, world, arm, subject = E8_SUBJECT, maxWakeups = 30_000, worldTimeoutMs = 240_000, callTimeoutMs = 25_000, hostOptions = {}, holder = null }) {
  const cap = captureFiles(arm);
  const host = createHost({ item: item.binding, world, arm: cap.arm, callTimeoutMs, maxWakeups, ...hostOptions });
  if (holder) holder.host = host;
  let status, timer;
  const started = Date.now();
  try {
    status = (await Promise.race([host.run(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`world took longer than ${worldTimeoutMs / 1000} s`)), worldTimeoutMs); })])).status;
  } catch (e) { status = `stopped: ${String(e?.message ?? e).slice(0, 200)}`; } finally { clearTimeout(timer); }
  const runMs = Date.now() - started;
  const rows = host.journal.contentRows();
  const t0 = Date.now();
  const trace = projectTrace(rows, { files: cap.files, records: recordsOf(host), subject });
  return { status, rows, trace, runMs, projectMs: Date.now() - t0 };
}

export const practiceWorlds = (item, practice = PRACTICE) => practice.seeds.map((seed, i) => {
  const d = practice.difficulties[i] ?? practice.difficulties[0];
  return { seed, d, world: item.generateWorld({ seed, difficulty: d, mix: 'tail', ...(practice.size ? { size: practice.size } : {}) }) };
});

/** A model-written build on the practice worlds, each run out of process. */
export async function runBuild({ item, solverSource, practice = PRACTICE, log = () => {} }) {
  const out = [];
  for (const { seed, d, world } of practiceWorlds(item, practice)) {
    const arm = sandboxArm({ id: 'tracked', solverSource, timeoutMs: 20_000 });
    let r;
    try { r = await runWorld({ item, world, arm }); } finally { arm.close(); }
    log(`  world ${seed} d${d}: ${r.status}, ${r.trace.effects.length} effects, ${r.trace.refused.length} refused (${(r.runMs / 1000).toFixed(1)} s)`);
    out.push({ world: String(seed), d, ...r, health: healthOf({ world: seed, difficulty: d, status: r.status, rows: r.rows, trace: r.trace }) });
  }
  return out;
}

/** Analyst-side (G4 only): the bed's reference policy, or a control (a reference variant), on one world, in process. */
export async function runReferenceWorld({ item, world, timing = 'earliest', variant, id }) {
  const { referenceArm } = await import('../../beds/ebed/oracle/policy.mjs');
  const holder = {};
  const arm = referenceArm({ item: item.oracleItem, world, timing, variant, ...(id ? { id } : {}), journal: () => ({ committed: holder.host.journal.rows, staged: holder.host.journal.staged }) });
  return runWorld({ item, world, arm, holder, callTimeoutMs: null, maxWakeups: 1_000_000 });
}

// ---------------------------------------------------------------------------------------------------------------
// Checking.
const checkable = r => r.check && r.check.observable !== false && typeof r.check.fn === 'string' && r.check.contrastOk === true;

/** Run every checkable property over every run's trace: Map world → Map id → result. One sandbox per trace. */
export async function propertiesOver(ledger, runs) {
  const props = Object.fromEntries(ledger.requirements.filter(checkable).map(r => [r.id, r.check.fn]));
  const out = new Map();
  for (const run of runs) {
    const res = await runProperties({ props, traces: [{ id: run.world, trace: run.trace }] });
    out.set(run.world, new Map(Object.keys(props).map(id => [id, res.get(`${run.world}\u0000${id}`)])));
  }
  return out;
}

/** Statuses and evidence for one build's runs; returns the per-build ledger copy. */
export function judge(ledger, runs, results, { build = null, maxFailing = 3 } = {}) {
  const copy = structuredClone(ledger);
  copy.build = build;
  copy.worlds = runs.map(r => ({ world: r.world, d: r.d, status: r.status }));
  for (const r of copy.requirements) {
    const perWorld = checkable(r) ? Object.fromEntries(runs.map(run => [run.world, results.get(run.world)?.get(r.id)])) : {};
    const s = statusOf(r.check, perWorld);
    const failing = [];
    for (const run of runs) {
      const res = perWorld[run.world];
      if (!res?.ok) continue;
      for (const inst of res.instances.filter(i => i.ok === false)) {
        if (failing.length >= maxFailing) break;
        failing.push({ world: Number(run.world), subject: inst.subject, at: inst.at, why: inst.why, refs: inst.refs, excerpt: excerptLines(run.trace, inst) });
      }
    }
    r.status = s.status;
    r.evidence = { ...(build ? { build } : {}), worlds: s.worlds, failing, flags: s.flags, ...(s.reason ? { reason: s.reason } : {}), ...(r.confirmed ? {} : { unconfirmed: true }) };
  }
  return copy;
}

/** check: run each build, judge, apply G3 across builds, write <out>/<label>/{ledger.json, report.md, health.json}. */
export async function checkBuilds({ ledger, builds, item, practice = PRACTICE, out, log = () => {}, keepTraces = false }) {
  const done = [];
  for (const b of builds) {
    const source = readFileSync(b.file, 'utf8');
    const build = { file: rel(b.file), sha256: sha256(source) };
    log(`build ${b.label} (${build.file})`);
    const runs = await runBuild({ item, solverSource: source, practice, log });
    const t0 = Date.now();
    const results = await propertiesOver(ledger, runs);
    log(`  properties: ${Date.now() - t0} ms`);
    done.push({ ...b, build, runs, judged: judge(ledger, runs, results, { build }) });
  }
  const sus = suspects(done.map(d => Object.fromEntries(d.judged.requirements.map(r => [r.id, r.status]))));
  for (const d of done) {
    for (const r of d.judged.requirements) if (sus.has(r.id)) r.evidence.flags.push('suspect');
    const dir = path.join(out, d.label);
    mkdirSync(dir, { recursive: true });
    writeLedger(path.join(dir, 'ledger.json'), d.judged);
    const health = d.runs.map(r => ({ ...r.health, runMs: r.runMs, projectMs: r.projectMs, traceBytes: Buffer.byteLength(JSON.stringify(r.trace)) }));
    writeFileSync(path.join(dir, 'health.json'), JSON.stringify(health, null, 1) + '\n');
    writeFileSync(path.join(dir, 'report.md'), renderReport({ ledger: d.judged, health, worlds: d.runs.map(r => r.world), title: d.label }));
    if (keepTraces) for (const r of d.runs) writeFileSync(path.join(dir, `trace-${r.world}.json`), JSON.stringify(r.trace));
    if (sus.size) log(`  G3: ${sus.size} requirement(s) fail on every build: ${[...sus].join(', ')}`);
  }
  return done;
}

// ---------------------------------------------------------------------------------------------------------------
// Writing (model calls, capped).
export async function writeChecks({ ledger, port, writer, escalate, reasoning = 'low', concurrency = 4, runId = 'tracker', log = () => {}, contrastOpts = {} }) {
  const todo = ledger.requirements.filter(needsCheck);
  let next = 0, stopped = null;
  const work = async () => {
    while (next < todo.length && !stopped) {
      const r = todo[next++];
      try {
        r.check = await writeCheck({ port, ledger, entry: r, writer, escalate, reasoning, runId, contrast: c => runContrast(c, contrastOpts),
          onEscalate: e => { port.note?.({ event: 'escalation', ...e }); log(`  ESCALATION ${e.id}: ${e.from} -> ${e.to} after ${e.after} failed attempts (${e.why})`); } });
        log(`  ${r.id} ${r.check.contrastOk ? 'ok' : r.check.observable === false ? 'not observable' : 'NOT TRUSTWORTHY'} (${r.check.attempts.length} call${r.check.attempts.length > 1 ? 's' : ''}${r.check.escalated ? ', escalated' : ''})`);
      } catch (e) {
        if (e instanceof BudgetError || e?.code === 'TRACKER_BUDGET') { stopped = e; break; }
        r.check = { version: r.check?.version ?? 1, fn: null, contrastOk: false, attempts: [], unclear: `writer error: ${String(e?.message ?? e).slice(0, 200)}` };
        log(`  ${r.id} writer error: ${String(e?.message ?? e).slice(0, 200)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, work));
  return { written: todo.filter(r => r.check && !needsCheck(r)).length, pending: ledger.requirements.filter(needsCheck).length, stopped };
}

// ---------------------------------------------------------------------------------------------------------------
// G4 calibration (evaluation only).
/**
 * teeth file: { spans: { "<id>": [line, lineEnd] }, controls: { "<control>": ["<id>", ...] } } (frozen by the analyst before
 * extraction). A control applies on a world when the world's difficulty is at least its minDifficulty (controls.mjs).
 */
export async function calibrate({ ledger, item, teeth = null, practice = PRACTICE, out, log = () => {} }) {
  const { CONTROLS, VARIANTS } = await import('../../beds/ebed/e8/controls.mjs');
  const traces = [];
  for (const { seed, d, world } of practiceWorlds(item, practice)) {
    for (const timing of ['earliest', 'latest']) {
      const r = await runReferenceWorld({ item, world, timing });
      traces.push({ kind: 'reference', name: timing, world: String(seed), d, trace: r.trace });
      log(`  world ${seed} reference ${timing}: ${r.status}, ${r.trace.effects.length} effects`);
    }
    for (const id of Object.keys(teeth?.controls ?? {})) {
      const c = CONTROLS.find(x => x.id === id);
      if (!c || !VARIANTS[id]) { log(`  control ${id}: unknown or not a reference variant; skipped`); continue; }
      if (d < (c.minDifficulty ?? 2)) continue;
      const r = await runReferenceWorld({ item, world, timing: 'earliest', variant: VARIANTS[id].variant(world), id: `control-${id}` });
      traces.push({ kind: 'control', name: id, world: String(seed), d, trace: r.trace });
      log(`  world ${seed} control ${id}: ${r.status}`);
    }
  }
  const props = Object.fromEntries(ledger.requirements.filter(checkable).map(r => [r.id, r.check.fn]));
  const status = new Map();     // `${kind}:${name}:${world}` -> Map id -> statusOf
  for (const [i, t] of traces.entries()) {
    const res = await runProperties({ props, traces: [{ id: String(i), trace: t.trace }] });
    status.set(`${t.kind}:${t.name}:${t.world}`, new Map(ledger.requirements.map(r => [r.id, statusOf(r.check, checkable(r) ? { [t.world]: res.get(`${i}\u0000${r.id}`) } : {})])));
  }
  const failsOn = (id, kind, name, world) => status.get(`${kind}:${name}:${world}`)?.get(id)?.status === 'fail';
  const worlds = [...new Set(traces.map(t => t.world))];
  const falseAlarms = ledger.requirements.filter(r => worlds.some(w => ['earliest', 'latest'].some(n => failsOn(r.id, 'reference', n, w))))
    .map(r => ({ id: r.id, quote: r.quote.slice(0, 100), on: worlds.flatMap(w => ['earliest', 'latest'].filter(n => failsOn(r.id, 'reference', n, w)).map(n => `${w}/${n}`)) }));
  const covering = sid => { const s = teeth?.spans?.[sid]; return s ? ledger.requirements.filter(r => r.span.line >= s[0] && r.span.lineEnd <= s[1]) : []; };
  const pairs = [];
  for (const [ctl, ids] of Object.entries(teeth?.controls ?? {})) {
    const on = traces.filter(t => t.kind === 'control' && t.name === ctl).map(t => t.world);
    if (!on.length) continue;
    for (const sid of ids) {
      const cov = covering(sid);
      const hits = cov.filter(r => on.some(w => failsOn(r.id, 'control', ctl, w)) && !on.some(w => ['earliest', 'latest'].some(n => failsOn(r.id, 'reference', n, w))));
      pairs.push({ control: ctl, id: sid, worlds: on, covering: cov.map(r => r.id), hit: hits.length > 0, by: hits.map(r => r.id) });
    }
  }
  const scored = pairs.filter(p => p.covering.length);
  const result = { worlds: practice, checkable: Object.keys(props).length, requirements: ledger.requirements.length, falseAlarms,
    mutation: { pairs: pairs.length, covered: scored.length, hits: pairs.filter(p => p.hit).length, score: pairs.length ? pairs.filter(p => p.hit).length / pairs.length : null }, pairs,
    byTrace: Object.fromEntries([...status].map(([k, m]) => [k, Object.fromEntries([...m].map(([id, s]) => [id, s.status]))])) };
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'calibration.json'), JSON.stringify(result, null, 1) + '\n');
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// CLI.
function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) { opts._.push(a); continue; }
    const k = a.slice(2);
    const v = rest[i + 1] !== undefined && !rest[i + 1].startsWith('--') ? rest[++i] : true;
    if (k === 'build') (opts.build ??= []).push(v); else opts[k] = v;
  }
  return { cmd, opts };
}
const parseWorlds = (s, size) => {
  const base = s && s !== true ? s.split(',').map(x => x.split(':').map(Number)) : PRACTICE.seeds.map((seed, i) => [seed, PRACTICE.difficulties[i]]);
  return { seeds: base.map(x => x[0]), difficulties: base.map(x => x[1] ?? 2), ...(size ? { size: Number(size) } : {}) };
};
const labelOf = file => path.basename(path.dirname(path.resolve(file))) || path.basename(file, '.mjs');

async function modelPortFor(out, { budget, writer, escalate }) {
  const { createModelPort } = await import('../lib/models.mjs');
  const ids = [...new Set([writer, escalate].filter(Boolean))];
  const { port } = createModelPort({ journalFile: path.join(out, 'journal.sqlite'), allowedModels: ids, maxBudgetUsdPerCall: Math.max(0.05, Math.min(1, budget)) });
  return budgetedPort(port, { capUsd: budget, logFile: path.join(out, 'model-calls.jsonl') });
}

export async function main(argv = process.argv.slice(2), { log = s => console.log(s) } = {}) {
  const { cmd, opts } = parseArgs(argv);
  const e8 = await import('../../beds/ebed/e8/index.mjs');
  const item = { binding: e8.binding, generateWorld: e8.generateWorld, oracleItem: e8.oracleItem };
  const budget = opts.budget !== undefined ? Number(opts.budget) : 2;
  const models = defaultModels();
  const writer = opts.model ? checkModelId(opts.model) : models.writer;
  const escalate = opts.escalate === 'none' ? null : opts.escalate ? checkModelId(opts.escalate) : models.escalate;
  const practice = parseWorlds(opts.worlds, opts.size);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDefault = (name) => opts.out ?? path.join(DEFAULT_OUT, `${name}-${stamp}`);
  const readText = () => { if (!opts.text) throw new Error('--text <user text file> is required'); return readFileSync(opts.text, 'utf8'); };

  if (cmd === 'extract' || cmd === 'all') {
    const text = readText(), out = outDefault('tracker');
    const port = await modelPortFor(out, { budget, writer, escalate });
    const samples = Number(opts.samples ?? 1);
    let first = null;
    for (let s = 0; s < samples; s++) {
      const { ledger } = await extractLedger({ port, modelId: writer, text, source: { file: rel(opts.text) }, sampleIndex: s });
      writeLedger(path.join(out, samples > 1 ? `ledger.s${s}.json` : 'ledger.json'), ledger);
      log(`extract sample ${s}: ${ledger.requirements.length} entries kept, ${ledger.dropped.length} dropped, ${ledger.uncovered.length} uncovered sentences ($${(ledger.extractor.costUsd ?? 0).toFixed(4)})`);
      first ??= ledger;
    }
    if (samples > 1) writeLedger(path.join(out, 'ledger.json'), first);
    if (cmd === 'extract') { log(`spent $${port.spentUsd.toFixed(4)} of $${budget}; ledger in ${out}`); return { out, spentUsd: port.spentUsd }; }
    log(`write: ${writer}${escalate ? ` (escalation: ${escalate})` : ''}`);
    const w = await writeChecks({ ledger: first, port, writer, escalate, reasoning: opts.reasoning ?? 'low', log });
    writeLedger(path.join(out, 'ledger.json'), first);
    log(`written ${w.written}, pending ${w.pending}${w.stopped ? ` (stopped: ${w.stopped.message})` : ''}; spent $${port.spentUsd.toFixed(4)} of $${budget}`);
    if (!opts.build?.length) return { out, spentUsd: port.spentUsd };
    const builds = opts.build.map(f => ({ file: f, label: labelOf(f) }));
    await checkBuilds({ ledger: first, builds, item, practice, out, log, keepTraces: !!opts['keep-traces'] });
    log(`reports in ${out}/<build>/report.md`);
    return { out, spentUsd: port.spentUsd };
  }
  if (cmd === 'ledger') {
    const text = readText(), out = outDefault('tracker');
    const entries = JSON.parse(readFileSync(opts.entries, 'utf8'));
    const ledger = buildLedger({ text, source: { file: rel(opts.text) }, entries: entries.entries ?? entries, extractor: { model: null, prompt: 'gold', file: rel(opts.entries) }, idPrefix: opts.prefix ?? 'G' });
    writeLedger(path.join(out, 'ledger.json'), ledger);
    log(`ledger: ${ledger.requirements.length} entries, ${ledger.dropped.length} dropped, ${ledger.uncovered.length} uncovered; ${path.join(out, 'ledger.json')}`);
    return { out };
  }
  if (!opts.ledger) throw new Error(`usage: run.mjs ${cmd ?? '<command>'} --ledger <ledger.json> ... (see the header of experiments/tracker/run.mjs)`);
  const ledger = readLedger(opts.ledger);
  const out = opts.out ?? path.dirname(path.resolve(opts.ledger));
  if (cmd === 'edit') {
    const edited = applyEdits(ledger, readText(), JSON.parse(readFileSync(opts.edits, 'utf8')));
    writeLedger(opts.ledger, edited);
    log(`edited: ${edited.requirements.length} entries; ${edited.requirements.filter(needsCheck).length} need a property`);
    return { out };
  }
  if (cmd === 'write') {
    const port = await modelPortFor(out, { budget, writer, escalate });
    log(`write: ${writer}${escalate ? ` (escalation: ${escalate})` : ''}; ${ledger.requirements.filter(needsCheck).length} entries need a property; cap $${budget}`);
    const w = await writeChecks({ ledger, port, writer, escalate, reasoning: opts.reasoning ?? 'low', log });
    writeLedger(opts.ledger, ledger);
    log(`written ${w.written}, pending ${w.pending}${w.stopped ? ` (stopped: ${w.stopped.message})` : ''}; spent $${port.spentUsd.toFixed(4)} of $${budget}`);
    return { out, spentUsd: port.spentUsd };
  }
  if (cmd === 'check') {
    if (!opts.build?.length) throw new Error('--build <solver.mjs> is required (repeatable)');
    const builds = opts.build.map(f => ({ file: f, label: labelOf(f) }));
    for (const b of builds) if (!existsSync(b.file)) throw new Error(`no build ${b.file}`);
    await checkBuilds({ ledger, builds, item, practice, out, log, keepTraces: !!opts['keep-traces'] });
    log(`reports in ${out}/<build>/report.md`);
    return { out };
  }
  if (cmd === 'calibrate') {
    const teeth = opts.teeth ? JSON.parse(readFileSync(opts.teeth, 'utf8')) : null;
    const r = await calibrate({ ledger, item, teeth, practice, out, log });
    log(`false alarms on reference runs: ${r.falseAlarms.length}${r.falseAlarms.length ? ` (${r.falseAlarms.map(f => f.id).join(', ')})` : ''}`);
    if (teeth) log(`mutation score: ${r.mutation.hits}/${r.mutation.pairs} pairs${r.mutation.score === null ? '' : ` = ${r.mutation.score.toFixed(2)}`} (${r.mutation.pairs - r.mutation.covered} pairs with no covering requirement)`);
    return { out, result: r };
  }
  throw new Error(`unknown command ${JSON.stringify(cmd)}; see the header of experiments/tracker/run.mjs`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(() => process.exit(0), e => { console.error(e?.stack ?? String(e)); process.exit(1); });
}
