#!/usr/bin/env node
// Build the stream model: one record per JIT stream experiment (experiments/runs/jit/<experiment>/<arm-slug>/), for the streams page.
//
//   node tools/run-view/index-streams.mjs [--root experiments/runs/jit] [--configs experiments/jit/configs] [--experiment NAME ...] --out streams.json
//        [--notes-chars 1200] [--allow-heldout-notes]
//
// Data layout: research/jit-20261008/SPEC.md §6.3 and experiments/jit/stream.mjs (arm.json, results.jsonl, events.jsonl, faults.jsonl, versions/v<n>-<tag>/
// {compile.json, solve.mjs, BUILD-NOTES.md}). What this does and does not do:
//   * Read-only. Every file is read, never written, locked or renamed; the streams may be running (the files grow while we read them). A partial last line
//     is skipped (report.mjs readJsonl), a version folder whose compile.json is not written yet reads as "writing", and an arm.json caught mid-write is retried.
//   * Totals, curves, steady state and break-even come from experiments/jit/report.mjs (loadRun, buildReport, renderMarkdown), unchanged: the page's summary
//     table and report.md are the same numbers. This file only adds what the report does not keep: per-row details, the arm's event log, the versions.
//   * Rows keep ids, codes, numbers and the oracle's NUMERIC fields only (as index-runs.mjs does): no answer, no mismatch text, no hidden truth.
//   * BUILD-NOTES.md is builder-written text about the traced tasks. An excerpt travels for development streams; for a held-out (test) or unknown split it is
//     withheld unless --allow-heldout-notes. Strings from files are untrusted: the page renders them as text only.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadRun, buildReport, renderMarkdown } from '../../experiments/jit/report.mjs';

export const STREAMS_SCHEMA = 'foundry-jit-streams/1';
const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, '..', '..');
export const DEFAULT_ROOT = path.join(REPO, 'experiments/runs/jit');
export const DEFAULT_CONFIGS = path.join(REPO, 'experiments/jit/configs');
const parse = text => { try { return JSON.parse(text); } catch { return null; } };
const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const readJsonl = file => { try { return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(parse).filter(Boolean); } catch { return []; } };
const num = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const r6 = x => num(x) == null ? null : Math.round(x * 1e6) / 1e6;
const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const str = (v, n = 120) => typeof v === 'string' ? clip(v, n) : v == null ? null : clip(String(v), n);
const isDir = p => { try { return statSync(p).isDirectory(); } catch { return false; } };
const relLabel = p => { const r = path.relative(REPO, p); return r && !r.startsWith('..') && !path.isAbsolute(r) ? r.split(path.sep).join('/') : path.basename(p); };
// A synchronous pause for a retry (a file caught mid-write by a running stream). No timers: index building stays synchronous.
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function retrying(fn, tries = 4) { let last; for (let i = 0; i < tries; i++) { try { return fn(); } catch (error) { last = error; pause(40 * (i + 1)); } } throw last; }

// ------------------------------------------------------------------------------------------------------------------------------ labels
/** The arm as report.mjs's markdown names it (static:<folder>). */
export const shortSpec = s => String(s ?? '').replace(/^static:.*\/([^/]+)\/solve\.mjs$/, 'static:$1');
const shortModel = m => String(m ?? '').replace(/^claude-/, '');
/** A readable arm name: "agent haiku-5-5", "static B1-haiku-records-k1", "jit sonnet-5-5 / haiku-5-5" (interpreter / compiler). */
export function armLabel(spec) {
  const s = String(spec ?? ''), i = s.indexOf(':'), kind = s.slice(0, i), rest = s.slice(i + 1);
  if (kind === 'agent') return `agent ${shortModel(rest)}`;
  if (kind === 'static') return `static ${shortSpec(s).slice('static:'.length)}`;
  if (kind === 'jit') { const [a, b] = rest.split('/'); return `jit ${shortModel(a)} / ${shortModel(b)}`; }
  return s;
}

// ------------------------------------------------------------------------------------------------------------------------------ discovery
const isArmDir = dir => existsSync(path.join(dir, 'arm.json')) || existsSync(path.join(dir, 'results.jsonl'));
/** Experiments under the root: folders holding at least one arm folder (logs/, smoke/ and calibration/ hold files only and are skipped, by count). */
export function listExperiments(root) {
  const out = [], skipped = [];
  let entries = [];
  try { entries = readdirSync(root, { withFileTypes: true }); } catch (error) { return { experiments: [], skipped: [], error: `${relLabel(root)}: ${error.code ?? error.message}` }; }
  for (const d of entries) {
    if (!d.isDirectory() || d.isSymbolicLink()) continue;
    const dir = path.join(root, d.name);
    let arms = [];
    try { arms = readdirSync(dir, { withFileTypes: true }).filter(x => x.isDirectory() && isArmDir(path.join(dir, x.name))); } catch { /* unreadable: skipped below */ }
    if (arms.length) out.push({ name: d.name, dir }); else skipped.push(d.name);
  }
  return { experiments: out.sort((a, b) => a.name.localeCompare(b.name)), skipped: skipped.sort(), error: null };
}

/** Seeds of a config segment: a list, "a..b" or {from, to} (the forms experiments/jit/stream.mjs normalizeConfig accepts). */
function seedsOf(seeds) {
  if (Array.isArray(seeds)) return seeds.map(Number);
  const m = typeof seeds === 'string' && /^(\d+)\.\.(\d+)$/.exec(seeds);
  const [a, b] = m ? [Number(m[1]), Number(m[2])] : seeds && Number.isInteger(seeds.from) && Number.isInteger(seeds.to) ? [seeds.from, seeds.to] : [null, null];
  return a == null || b < a || b - a > 10000 ? [] : Array.from({ length: b - a + 1 }, (_, i) => a + i);
}
/** The stream's plan from its config file (experiments/jit/configs/*.json naming this experiment): task order, segments, arms. Optional. */
export function planOf(name, configsDir) {
  if (!configsDir || !isDir(configsDir)) return null;
  for (const f of readdirSync(configsDir).filter(x => x.endsWith('.json')).sort()) {
    const c = readJson(path.join(configsDir, f));
    if (!c || c.experiment !== name || !Array.isArray(c.segments)) continue;
    const tasks = [];
    for (const seg of c.segments) for (const seed of seedsOf(seg.seeds)) tasks.push({ idx: tasks.length, seed, difficulty: Number(seg.difficulty ?? 3) });
    return { source: relLabel(path.join(configsDir, f)), familyId: str(c.familyId, 40), split: str(c.split, 16), tasks, arms: Array.isArray(c.arms) ? c.arms.map(a => str(a, 200)) : [],
      jit: c.jit && typeof c.jit === 'object' ? c.jit : null, spendStopUsd: num(c.spendStopUsd), concurrency: num(c.concurrency) };
  }
  return null;
}

// ------------------------------------------------------------------------------------------------------------------------------ rows and events
const ORACLE_KEY = /^[A-Za-z][A-Za-z0-9]{0,23}$/;
/** Only the oracle's top-level numbers survive (counts, F1, accuracy): never the per-field text, the mismatches or the hidden truth. */
export function oracleNumbers(details) {
  const d = typeof details === 'string' ? parse(details) : details, out = {};
  if (!d || typeof d !== 'object' || Array.isArray(d)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(d)) if (n < 12 && ORACLE_KEY.test(k) && num(v) != null) { out[k] = v; n++; }
  return out;
}
const errorOf = (e, content) => !e ? null : typeof e === 'object' ? { code: str(e.code ?? 'ERROR', 40), ...(content && e.message ? { message: clip(e.message, 200) } : {}) } : { code: str(e, 40) };
const perCaseOf = (list, content) => (Array.isArray(list) ? list : []).slice(0, 60).map(c => ({ id: str(c.id, 40), ref: str(c.ref, 60), kind: str(c.kind, 16), status: str(c.status, 16),
  partial: num(c.partial), deoptKind: str(c.deopt?.kind ?? c.deoptKind, 24), ...(content && ['crash', 'timeout'].includes(c.status) && c.note ? { note: clip(c.note, 160) } : {}) }));
/** One check-traces record (compile.mjs checkTraces or stream.mjs compactCheck) reduced to its counts and per-case statuses. */
export function checkOf(ct, content = true) {
  if (!ct || typeof ct !== 'object') return null;
  return { exact: num(ct.exact), cases: num(ct.cases), labeled: num(ct.labeled), exactRate: num(ct.exactRate), partial: num(ct.partial), diffs: num(ct.diffs), deopts: num(ct.deopts),
    deoptKinds: ct.deoptKinds && typeof ct.deoptKinds === 'object' ? Object.fromEntries(Object.entries(ct.deoptKinds).filter(([, v]) => num(v) != null).map(([k, v]) => [str(k, 24), v])) : {},
    crashes: num(ct.crashes), timeouts: num(ct.timeouts), regressions: num(ct.regressions), regressionsPassed: num(ct.regressionsPassed), clean: ct.clean === true, accepted: ct.accepted === true,
    unexplained: Array.isArray(ct.unexplained) ? ct.unexplained.slice(0, 40).map(x => str(x, 40)) : [], error: ct.error ? str(ct.error.code ?? ct.error, 40) : null,
    recheck: ct.recheck ? { capUsd: num(ct.recheck.capUsd) } : null, costUsd: num(ct.costUsd), perCase: perCaseOf(ct.perCase, content) };
}
/** An event as the page shows it: the harness's own fields, with the heavy compile result reduced to counts. */
function compactEvent(e, content) {
  const { arm, ...rest } = e;
  if (rest.kind === 'compile-attempt' && rest.result) return { ...rest, result: { ...rest.result, checkTraces: checkOf(rest.result.checkTraces, content) } };
  return rest;
}
function compactRow(r, content) {
  const s = r.stateAfter;
  return { idx: r.idx, taskId: str(r.taskId, 80), taskKey: str(r.taskKey, 80), seed: num(r.seed), difficulty: num(r.difficulty), delivered: str(r.delivered, 24), pass: r.pass === true, score: num(r.score),
    costUsd: num(r.costUsd), costBreakdown: Object.fromEntries(Object.entries(r.costBreakdown ?? {}).filter(([, v]) => num(v) != null).map(([k, v]) => [str(k, 32), v])), costUnknown: r.costUnknown === true,
    orphanUsd: num(r.orphanUsd), latencyMs: num(r.latencyMs), version: num(r.version), compiledStatus: str(r.compiledStatus, 16), deoptKind: str(r.deoptKind, 24), error: errorOf(r.error, content),
    events: (Array.isArray(r.events) ? r.events : []).map(e => compactEvent(e, content)), oracle: oracleNumbers(r.oracleDetails), at: str(r.at, 40),
    traceId: str(r.traceId, 60), shadowTraceId: str(r.shadowTraceId, 60), adjudicatorTraceId: str(r.adjudicatorTraceId, 60),
    state: s && typeof s === 'object' ? { traces: Array.isArray(s.traces) ? s.traces.length : null, regressions: Array.isArray(s.regressions) ? s.regressions.length : null, version: num(s.version?.n),
      deoptsSinceCompile: num(s.deoptsSinceCompile), compiledOks: num(s.compiledOks), pendingCompile: str(s.pendingCompile, 24), fallbacksUsed: num(s.fallbacksUsed) } : null };
}

// ------------------------------------------------------------------------------------------------------------------------------ versions
const FALLBACK_KINDS = new Set(['deopt', 'crash', 'timeout', 'invalid', 'no-version']);
const DECISIONS = new Set(['compile', 'recompile', 'rejected', 'compile-failed', 'void']);
/** Every compile attempt the arm made (versions/v<n>-<tag>/), with its record, its place in the stream and what became of it. */
export function readVersions(armDir, { rows, events, content = true, notesChars = 1200 }) {
  const vroot = path.join(armDir, 'versions');
  if (!isDir(vroot)) return [];
  const attempts = events.filter(e => e.kind === 'compile-attempt' && typeof e.key === 'string');
  const decisions = events.filter(e => DECISIONS.has(e.kind) && num(e.version) != null);
  const rowAt = new Map(rows.map(r => [r.idx, r]));
  const out = [];
  for (const name of readdirSync(vroot).sort()) {
    const m = /^v(\d+)-([A-Za-z0-9]+)$/.exec(name), vdir = path.join(vroot, name);
    if (!m || !isDir(vdir)) continue;
    const n = Number(m[1]);
    const rec = readJson(path.join(vdir, 'compile.json'));
    const ev = attempts.filter(e => e.key.startsWith(`${name}-`)).at(-1) ?? null;
    const builderModel = str(rec?.builderModel ?? ev?.result?.builderModel, 60);
    const mine = decisions.filter(e => e.version === n);
    const adopted = mine.find(e => (e.kind === 'compile' || e.kind === 'recompile') && e.builderModel === builderModel);
    const rejected = mine.find(e => e.kind === 'rejected' && e.builderModel === builderModel);
    const voided = mine.find(e => e.kind === 'void' && e.builderModel === builderModel);
    const failed = mine.find(e => e.kind === 'compile-failed');
    const other = mine.find(e => ['compile', 'recompile', 'rejected'].includes(e.kind) && e.builderModel !== builderModel);
    const fellBack = events.find(e => e.kind === 'fallback-compile' && e.version === n && e.from === builderModel);
    const status = !rec ? 'writing' : voided ? 'voided' : adopted ? 'adopted' : rejected ? 'rejected' : failed ? 'failed' : other ? 'not chosen' : 'pending';
    const attemptIdx = num(ev?.idx ?? adopted?.idx ?? rejected?.idx ?? failed?.idx);
    // Why this compile ran: the stream's pending reason (on the decision, else in the state the previous task left).
    const reason = str(adopted?.reason ?? failed?.reason ?? (attemptIdx != null ? rowAt.get(attemptIdx - 1)?.stateAfter?.pendingCompile : null) ?? null, 24);
    let notes = null;
    const notesFile = path.join(vdir, 'BUILD-NOTES.md');
    const text = existsSync(notesFile) ? (() => { try { return readFileSync(notesFile, 'utf8'); } catch { return null; } })() : typeof rec?.notes === 'string' ? rec.notes : null;
    if (text != null) notes = content ? { source: existsSync(notesFile) ? 'BUILD-NOTES.md' : 'compile.json', chars: text.length, excerpt: clip(text, notesChars) }
      : { source: existsSync(notesFile) ? 'BUILD-NOTES.md' : 'compile.json', chars: text.length, excerpt: null, withheld: 'Held-out stream: builder notes are withheld (--allow-heldout-notes to include them).' };
    const cost = rec ? { builder: num(rec.builderCostUsd), gateway: num(rec.gatewayCostUsd), check: num(rec.checkCostUsd), total: num(rec.compileCostUsd), builderUnknown: rec.builderCostUnknown === true } : null;
    out.push({
      dir: name, version: n, builderModel, builderEffort: str(rec?.builderEffort, 16), kind: str(rec?.kind, 16), attemptIdx, at: str(ev?.at ?? rec?.startedAt, 40), startedAt: str(rec?.startedAt, 40),
      durationMs: num(rec?.durationMs), turns: num(rec?.turns), toolUses: num(rec?.toolUses),
      // the stream's figure (it includes a recheck at the higher cap) first, else the record's
      costUsd: r6(num(ev?.result?.costUsd) ?? cost?.total), cost,
      builderError: str(rec?.builderError?.code ?? ev?.result?.builderError, 40), check: checkOf(rec?.checkTraces ?? ev?.result?.checkTraces, content),
      hasSolve: existsSync(path.join(vdir, 'solve.mjs')), solveSha: str(rec?.artifactSha256 ?? ev?.result?.solveSha, 12), parentSha: str(rec?.parentSha, 12), parent: null,
      traceIds: Array.isArray(rec?.traceIds) ? rec.traceIds.map(x => str(x, 60)) : [], regressionIds: Array.isArray(rec?.regressionIds) ? rec.regressionIds.map(x => str(x, 60)) : [],
      nestedModelAttempts: num(rec?.nestedModelAttempts ?? ev?.result?.nestedModelAttempts) ?? 0, hiddenPathAttempts: num(rec?.hiddenPathAttempts ?? ev?.result?.hiddenPathAttempts) ?? 0,
      status, reason, adoptedAt: num(adopted?.idx), adoptedAs: adopted?.kind ?? null, rejectedWhy: str(rejected?.why, 160), keptVersion: num(rejected?.keep), fellBackTo: str(fellBack?.to, 60),
      chosen: other ? str(other.builderModel, 60) : null, notes, trigger: [],
    });
  }
  // parents by artifact hash; the trigger of each compile: what happened in the stream since the compile before it
  for (const v of out) { const p = v.parentSha ? out.find(x => x.solveSha && x.solveSha === v.parentSha) : null; v.parent = p ? p.dir : v.parentSha ? 'unknown' : null; }
  const compileIdxs = [...new Set(out.map(v => v.attemptIdx).filter(x => x != null))].sort((a, b) => a - b);
  for (const v of out) {
    if (v.attemptIdx == null) continue;
    const prev = compileIdxs.filter(i => i < v.attemptIdx).at(-1) ?? -1;
    const kinds = v.reason === 'regression' ? new Set(['regression']) : FALLBACK_KINDS;
    // (the task of the previous compile counts: its compiled run comes after that compile, so a deopt there counts toward this one)
    v.trigger = rows.filter(r => r.idx >= prev && r.idx < v.attemptIdx)
      .flatMap(r => (r.events ?? []).filter(e => kinds.has(e.kind)).map(e => ({ idx: r.idx, kind: e.kind, deoptKind: str(e.deoptKind, 24) }))).slice(0, 20);
  }
  return out.sort((a, b) => a.version - b.version || (a.attemptIdx ?? 0) - (b.attemptIdx ?? 0) || a.dir.localeCompare(b.dir));
}

// ------------------------------------------------------------------------------------------------------------------------------ one experiment
const contentPolicy = split => split === 'dev';
export function buildExperiment(dir, { configsDir = DEFAULT_CONFIGS, notesChars = 1200, allowHeldoutNotes = false } = {}) {
  const name = path.basename(dir), errors = [];
  const plan = planOf(name, configsDir);
  let arms;
  try { arms = retrying(() => loadRun(dir)); } catch (error) { return { name, runDir: relLabel(dir), error: `could not read the arms: ${clip(error.message ?? error, 200)}`, arms: [] }; }
  const rep = buildReport(dir, { arms });
  const split = rep.split ?? plan?.split ?? null;
  const content = contentPolicy(split) || allowHeldoutNotes;
  const order = spec => { const i = plan?.arms?.indexOf(spec) ?? -1; return i < 0 ? 100 : i; };
  const out = arms.map((a, k) => {
    const s = rep.arms[k];                                            // buildReport keeps loadRun's order
    const rows = a.rows, events = a.events;
    const billed = new Set(rows.flatMap(r => r.spendIds ?? []));
    const done = new Set(rows.map(r => r.idx));
    // events of tasks this arm has not finished: a task in progress, or the spend of an attempt a crash or fault cut short
    const open = new Map();
    for (const e of events) if (num(e.idx) != null && !done.has(e.idx)) { const o = open.get(e.idx) ?? { idx: e.idx, kinds: [], since: e.at ?? null, last: null }; if (e.kind !== 'spend') o.kinds.push(e.kind); o.last = e.at ?? o.last; open.set(e.idx, o); }
    const half = s.steadyState.fromIdx;
    return {
      spec: s.spec, slug: s.slug ?? path.basename(a.dir), kind: s.kind, label: armLabel(s.spec), short: shortSpec(s.spec), hash: str(a.meta?.hash, 16), order: order(s.spec),
      def: a.meta?.def ? { interpreter: s.kind === 'jit' ? str(s.spec.split(':')[1]?.split('/')[0], 60) : null, compiler: s.kind === 'jit' ? str(s.spec.split('/').at(-1), 60) : null,
        models: Array.isArray(a.meta.def.models) ? a.meta.def.models.map(x => str(x, 60)) : [], jit: a.meta.def.jit ?? null, perTaskUsd: num(a.meta.def.perTaskUsd), agentBudgetUsd: num(a.meta.def.agentBudgetUsd) } : null,
      rows: rows.map(r => compactRow(r, content)),
      events: events.filter(e => e.kind !== 'spend' || !billed.has(e.id)).map(e => compactEvent(e, content)),
      faults: a.faults.map(f => ({ idx: num(f.idx), component: str(f.component, 32), code: str(f.error?.code ?? f.builderError?.code ?? Object.keys(f.metaErrors ?? {}).join(','), 40), at: str(f.at, 40) })),
      inProgress: [...open.values()].sort((x, y) => x.idx - y.idx),
      versions: s.kind === 'jit' ? readVersions(a.dir, { rows, events, content, notesChars }) : [],
      summary: s,                                                      // report.mjs summarizeArm + breakEven + vsAgents, as is (curve included)
      lastHalf: { fromIdx: half, ...s.steadyState, usd: r6(rows.filter(r => r.idx >= half).reduce((t, r) => t + (r.costUsd ?? 0), 0)) },
    };
  }).sort((a, b) => a.order - b.order || a.spec.localeCompare(b.spec));
  // categorical colour slot: the arm's place in the config (stable while arms start and finish), else its place here
  let extra = plan?.arms?.length ?? 0;
  for (const a of out) a.slot = a.order < 100 ? a.order : extra++;
  const maxIdx = Math.max(-1, ...out.flatMap(a => [...a.rows.map(r => r.idx), ...a.inProgress.map(p => p.idx)]));
  const taskCount = Math.max(plan?.tasks.length ?? 0, maxIdx + 1);
  const tasks = Array.from({ length: taskCount }, (_, idx) => {
    const p = plan?.tasks[idx], r = out.map(a => a.rows.find(x => x.idx === idx)).find(Boolean);
    return { idx, seed: r?.seed ?? p?.seed ?? null, difficulty: r?.difficulty ?? p?.difficulty ?? null, taskKey: r?.taskKey ?? null };
  });
  const missingArms = (plan?.arms ?? []).filter(spec => !out.some(a => a.spec === spec)).map(spec => ({ spec, label: armLabel(spec), short: shortSpec(spec) }));
  if (!out.length) errors.push('no arm has written a row or an arm.json yet');
  const { arms: _armSummaries, ...report } = rep;
  return { name, runDir: relLabel(dir), report: { ...report, runDir: relLabel(dir) }, markdown: renderMarkdown(rep), plan, split, content, taskCount, tasks, arms: out, missingArms, errors };
}

// ------------------------------------------------------------------------------------------------------------------------------ all
export function buildStreams({ root = DEFAULT_ROOT, configsDir = DEFAULT_CONFIGS, only = null, notesChars = 1200, allowHeldoutNotes = false, now = Date.now() } = {}) {
  const found = listExperiments(root);
  const picked = found.experiments.filter(e => !only?.length || only.includes(e.name));
  const experiments = picked.map(e => buildExperiment(e.dir, { configsDir, notesChars, allowHeldoutNotes }));
  return {
    schema: STREAMS_SCHEMA, builtAt: new Date(now).toISOString(), root: relLabel(root), configs: configsDir && isDir(configsDir) ? relLabel(configsDir) : null,
    skipped: found.skipped, error: found.error, experiments,
    notes: ['A snapshot: running streams keep writing after it was taken. Rerun the export to refresh.',
      'Totals, curves, steady state and break-even are experiments/jit/report.mjs output, unchanged.',
      'K=1 stream per arm: a success gap under 3 tasks is noise (SPEC §7).'],
  };
}

// ------------------------------------------------------------------------------------------------------------------------------ CLI
function main() {
  const { values: a } = parseArgs({ options: { root: { type: 'string' }, configs: { type: 'string' }, experiment: { type: 'string', multiple: true }, out: { type: 'string' },
    'notes-chars': { type: 'string', default: '1200' }, 'allow-heldout-notes': { type: 'boolean', default: false } } });
  if (!a.out) { console.error('Usage: index-streams.mjs [--root experiments/runs/jit] [--configs experiments/jit/configs] [--experiment NAME ...] --out streams.json [--notes-chars N] [--allow-heldout-notes]'); process.exit(2); }
  const model = buildStreams({ root: a.root ? path.resolve(a.root) : DEFAULT_ROOT, configsDir: a.configs ? path.resolve(a.configs) : DEFAULT_CONFIGS, only: a.experiment, notesChars: Number(a['notes-chars']), allowHeldoutNotes: a['allow-heldout-notes'] });
  mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true });
  writeFileSync(a.out, JSON.stringify(model), { mode: 0o600 }); chmodSync(a.out, 0o600);
  console.log(JSON.stringify({ out: a.out, bytes: statSync(a.out).size, experiments: model.experiments.map(e => ({ name: e.name, arms: e.arms.length, rows: e.arms.reduce((s, x) => s + x.rows.length, 0), versions: e.arms.reduce((s, x) => s + x.versions.length, 0), error: e.error ?? null })), skipped: model.skipped }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
