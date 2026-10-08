#!/usr/bin/env node
// Build the run index: one row per recorded Foundry run (or experiment trial), joined from workspace stores, model-call journals and experiment result files.
//
//   node tools/run-view/index-runs.mjs --root DIR [--root DIR ...] [--sources FILE.json] [--cache DIR] --out index.json [--stats]
//
// Design: research/review-20261007/06b-run-history.md section 2. What this does and does not do:
//   * Read-only. SQLite files are opened read-only (immutable when there is no WAL data, so no -wal/-shm file is created next to a record). Never through `Store`.
//   * The index holds ids, hashes, codes, numbers and times, plus a few strings that came from files (workflow title, arm, task key). It holds NO prompt, reply,
//     task text or error message. Strings that came from files are untrusted: the page renders them as text only.
//   * Fidelity is explicit. `full` = a surviving workspace store (hash-chained events); `journal-only` = model calls plus a result line (the experiment scripts delete
//     a passing trial's workspace); `result-only` = one result line (baseline arms have no Foundry run). A reader must not infer a rate from the full rows alone.
//   * Joins, first that applies wins, and the row says which: J1 run id (store runs.id = journal run_id = result meta.runId); J2 the naming convention
//     `${arm}:${taskKey}:t${trial}` used as the journal run id of single-call baselines (observed, not a contract); J3 the kept-workspace path
//     `<exp>/<arm>/<task>_t<trial>/ws` (a fallback).
//   * Verdict honesty: the runtime's verdict against the experiment's independent oracle (history-core honestyOf).
//   * Scan cache (--cache): each source's parsed output is kept by (size, mtime, WAL size), so a rescan with nothing new only stats files.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, openSync, readSync, closeSync, existsSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { digest } from '../../src/data.mjs';
import { StoreReader, openReadOnly, hasTable } from './store-adapter.mjs';
import './history-core.js';

const H = globalThis.HistoryCore;
export const INDEX_SCHEMA = H.SCHEMA_INDEX;
const DEFAULT_EXCLUDE = ['node_modules', 'corpus', 'bench', '.git'];
const MAX_DEPTH = 12;
const parse = text => { try { return JSON.parse(text); } catch { return null; } };
const num = v => typeof v === 'number' && Number.isFinite(v) ? v : null;

// ------------------------------------------------------------------------------------------------------------------------------ discovery
/** Walk the roots without following symlinks. Every exclusion is counted, nothing is dropped silently. */
export function discover(roots, { exclude = DEFAULT_EXCLUDE, maxDepth = MAX_DEPTH } = {}) {
  const found = { stores: [], sqlite: [], jsonl: [], skipped: { excludedDirs: 0, symlinks: 0, tooDeep: 0, unreadable: 0 }, errors: [] };
  const skip = new Set(exclude);
  const walk = (dir, depth, rootDir) => {
    if (depth > maxDepth) { found.skipped.tooDeep++; return; }
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (error) { found.skipped.unreadable++; found.errors.push(`${dir}: ${error.code ?? error.message}`); return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) { found.skipped.symlinks++; continue; }
      if (entry.isDirectory()) { if (skip.has(entry.name)) { found.skipped.excludedDirs++; continue; } walk(full, depth + 1, rootDir); continue; }
      if (!entry.isFile()) continue;
      const item = { file: full, root: rootDir };
      if (entry.name === 'foundry.sqlite' && path.basename(dir) === '.foundry') found.stores.push(item);
      else if (/\.sqlite$/.test(entry.name)) found.sqlite.push(item);
      else if (/\.jsonl$/.test(entry.name)) found.jsonl.push(item);
    }
  };
  for (const root of roots) {
    const resolved = path.resolve(root);
    if (!existsSync(resolved)) { found.errors.push(`${resolved}: no such directory`); continue; }
    walk(resolved, 0, resolved);
  }
  return found;
}
const labelOf = item => path.join(path.basename(item.root), path.relative(item.root, item.file)).split(path.sep).join('/');
const sig = file => { try { const s = statSync(file); let wal = 0; try { wal = statSync(`${file}-wal`).size; } catch { /* no WAL */ } return `${s.size}:${Math.round(s.mtimeMs)}:${wal}`; } catch { return null; } };

// ------------------------------------------------------------------------------------------------------------------------------ result files
const ORACLE_KEYS = ['entities', 'predicted', 'matched', 'extra', 'missing', 'slack', 'pairF1', 'precision', 'recall', 'fieldAccuracy'];
/** Only numeric oracle fields survive (the hidden truth and per-field text are never kept). */
function oracleOf(record) {
  const details = typeof record.oracleDetails === 'string' ? parse(record.oracleDetails) : record.oracleDetails;
  const out = {};
  if (details && typeof details === 'object') {
    for (const k of ORACLE_KEYS) if (num(details[k]) !== null) out[k] = details[k];
    let extra = 0;
    for (const [k, v] of Object.entries(details)) if (extra < 6 && !(k in out) && num(v) !== null && /^[A-Za-z][A-Za-z0-9]{0,23}$/.test(k)) { out[k] = v; extra++; }
  }
  return { pass: record.pass === true, score: num(record.score), details: out };
}
const looksLikeResult = r => r && typeof r === 'object' && typeof r.arm === 'string' && (typeof r.taskKey === 'string' || typeof r.task === 'string') && typeof r.pass === 'boolean' && 'trial' in r;
function sniffJsonl(file) {
  let fd; try { fd = openSync(file, 'r'); const buf = Buffer.alloc(65536); const n = readSync(fd, buf, 0, buf.length, 0); const parts = buf.subarray(0, n).toString('utf8').split('\n'); if (n >= buf.length) parts.pop(); const lines = parts.filter(Boolean).slice(0, 3);     // a partial last line of a big file is not a record; a small file was read whole
    if (!lines.length) return null;
    const recs = lines.map(parse).filter(Boolean);
    if (recs.length && recs.every(looksLikeResult)) return 'results';
    if (recs.length && recs.every(r => r && typeof r.builderModel === 'string' && typeof r.armId === 'string')) return 'constructions';
    return null; } catch { return null; } finally { if (fd !== undefined) closeSync(fd); }
}
export function readResultFile(file) {
  const out = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    const r = parse(line); if (!looksLikeResult(r)) continue;
    const meta = r.meta && typeof r.meta === 'object' ? r.meta : {};
    const at = Date.parse(r.at);
    const models = meta.models && typeof meta.models === 'object' && !Array.isArray(meta.models) ? Object.fromEntries(Object.entries(meta.models).filter(([, v]) => num(v) !== null).map(([k, v]) => [H.safeId(k), v])) : null;
    out.push({ experiment: typeof r.experiment === 'string' ? H.safeId(r.experiment, 60) : null, arm: H.safeId(r.arm, 60), armHash: typeof r.armHash === 'string' ? r.armHash.slice(0, 16) : null, taskKey: H.safeId(r.taskKey ?? r.task, 80), taskHash: typeof r.taskHash === 'string' ? r.taskHash.slice(0, 16) : null,
      trial: num(r.trial) ?? 0, costUsd: num(r.costUsd), imputedUsd: num(r.imputedUsd), latencyMs: num(r.latencyMs), at: Number.isFinite(at) ? at : null, oracle: oracleOf(r),
      runId: typeof meta.runId === 'string' ? meta.runId : null, status: typeof (meta.status ?? r.status) === 'string' ? H.safeId(meta.status ?? r.status, 24) : null,
      verdict: typeof (meta.verdict ?? r.verdict) === 'string' ? H.safeId(meta.verdict ?? r.verdict, 24) : null, calls: num(meta.calls), escalations: num(meta.escalations), models, replayed: meta.replayed === true });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------------------------ journals
/** Aggregate model_calls per run id with plain columns only (no JSON parse of prompts or replies). */
export function readJournalAggregates(db) {
  if (!hasTable(db, 'model_calls')) return null;
  const runs = new Map();
  const get = id => { let r = runs.get(id); if (!r) { r = { n: 0, errors: 0, costUsd: 0, imputedUsd: 0, unknownCalls: 0, first: null, last: null, byModel: H.dict(), escalationsInferred: 0, failed: [] }; runs.set(id, r); } return r; };
  for (const x of db.prepare(`SELECT run_id, COUNT(*) AS n, SUM(ok=0) AS errors, SUM(cost_usd) AS cost, SUM(imputed_usd) AS imputed, SUM(instr(COALESCE(response,''),'"costUnknown":true')>0) AS unknown,
      MIN(created_at - COALESCE(latency_ms,0)) AS first, MAX(created_at) AS last FROM model_calls GROUP BY run_id`).all()) {
    const r = get(x.run_id); Object.assign(r, { n: x.n, errors: x.errors ?? 0, costUsd: x.cost ?? 0, imputedUsd: x.imputed ?? 0, unknownCalls: x.unknown ?? 0, first: x.first, last: x.last });
  }
  for (const x of db.prepare('SELECT run_id, model_id, COUNT(*) AS n, SUM(cost_usd) AS usd FROM model_calls GROUP BY run_id, model_id').all()) get(x.run_id).byModel[H.safeId(x.model_id)] = { n: x.n, usd: x.usd ?? 0 };
  for (const x of db.prepare('SELECT run_id, COUNT(*) AS c FROM (SELECT run_id, node_key, COUNT(DISTINCT model_id) AS m FROM model_calls GROUP BY run_id, node_key HAVING m>1) GROUP BY run_id').all()) get(x.run_id).escalationsInferred = x.c;
  for (const x of db.prepare('SELECT run_id, node_key, error_code, COUNT(*) AS c FROM model_calls WHERE ok=0 GROUP BY run_id, node_key, error_code').all()) {
    const r = get(x.run_id); if (r.failed.length < 20) r.failed.push({ nodeKey: H.safeId(x.node_key, 120), kind: 'model call', code: H.safeId(x.error_code ?? 'ERROR'), class: H.classifyCode(x.error_code), count: x.c, handledBy: 'none' });
  }
  return runs;
}
const callIdsOf = (db, runId) => hasTable(db, 'model_calls') ? db.prepare('SELECT id FROM model_calls WHERE run_id=?').all(runId).map(r => r.id) : [];

// ------------------------------------------------------------------------------------------------------------------------------ stores
/** Index every run in one store: header (any shape), chain check, workflow, folded facts. Opens read-only; one read transaction per run. */
export function readStoreRuns(file) {
  const reader = StoreReader.open(file);
  try {
    const out = { shape: reader.shape, notes: reader.notes, hasJournal: reader.hasJournal(), runs: [] };
    for (const id of reader.runIds()) {
      out.runs.push(reader.snapshot(() => {
        const header = reader.header(id);
        const chain = reader.events(id, { header });
        const { workflow, reason } = reader.workflow(header.workflowHash);
        const facts = H.foldFacts(chain.events, workflow);
        const orphans = reader.hasJournal() ? (() => { const used = new Set(chain.events.filter(e => e.journalId != null).map(e => e.journalId)); const ids = callIdsOf(reader.db, id); return { rows: ids.length, orphans: ids.filter(i => !used.has(i)).length }; })() : null;
        return { id, header: { ...header, verdict: facts.verdict ?? header.verdict }, chain: { ok: chain.ok, reason: chain.reason ?? null, count: chain.count, head: chain.head ? chain.head.slice(0, 16) : null }, firstSeq: reader.firstSeq(id),
          workflow: workflow ? { id: H.safeId(workflow.id, 64), version: H.versionOf(workflow.version), hash: header.workflowHash, title: H.clip(typeof workflow.title === 'string' ? workflow.title : '', 120) } : { id: header.workflowId ? H.safeId(header.workflowId, 64) : null, version: null, hash: header.workflowHash, title: null, missing: reason },
          facts, orphans };
      }));
    }
    return out;
  } finally { reader.close(); }
}

// ------------------------------------------------------------------------------------------------------------------------------ scan with cache
function loadCache(dir) {
  if (!dir) return { version: 1, sources: {} };
  const file = path.join(dir, 'index-cache.json');
  const cache = existsSync(file) ? parse(readFileSync(file, 'utf8')) : null;
  return cache?.version === 1 ? cache : { version: 1, sources: {} };
}
function saveCache(dir, cache) {
  if (!dir) return;
  mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
  const file = path.join(dir, 'index-cache.json');
  writeFileSync(file, JSON.stringify(cache), { mode: 0o600 }); chmodSync(file, 0o600);
}

export function scanSources(roots, { cacheDir = null, exclude, log = () => {} } = {}) {
  const t = { start: performance.now() };
  const found = discover(roots, { exclude });
  t.walkMs = performance.now() - t.start;
  const cache = loadCache(cacheDir), next = { version: 1, sources: {} };
  const stats = { cached: 0, scanned: 0, shapes: {}, errors: [...found.errors], unreadable: [], journals: 0, resultFiles: 0, constructionFiles: 0, nonJournalSqlite: 0 };
  const cached = (file, tag, produce) => {
    const s = sig(file), key = `${file}#${tag}`, hit = cache.sources[key];
    if (s && hit && hit.sig === s) { stats.cached++; next.sources[key] = hit; return hit.data; }
    stats.scanned++;
    const data = produce();
    if (s) next.sources[key] = { sig: s, data };
    return data;
  };
  const stores = [], journals = [], results = [], constructions = [];
  const t1 = performance.now();
  for (const item of found.stores) {
    try {
      const data = cached(item.file, 'store', () => readStoreRuns(item.file));
      stats.shapes[data.shape] = (stats.shapes[data.shape] ?? 0) + 1;
      stores.push({ ...item, label: labelOf(item), data });
      if (data.hasJournal) journals.push({ ...item, label: labelOf(item), data: cached(item.file, 'journal', () => { const db = openReadOnly(item.file); try { return [...readJournalAggregates(db)]; } finally { db.close(); } }), self: true });
    } catch (error) { stats.unreadable.push(`${labelOf(item)}: ${String(error.message ?? error).slice(0, 120)}`); }
  }
  t.storesMs = performance.now() - t1;
  const t2 = performance.now();
  for (const item of found.sqlite) {
    try {
      const data = cached(item.file, 'journal', () => { const db = openReadOnly(item.file); try { const agg = readJournalAggregates(db); return agg ? [...agg] : null; } finally { db.close(); } });
      if (data) { journals.push({ ...item, label: labelOf(item), data }); stats.journals++; } else stats.nonJournalSqlite++;
    } catch (error) { stats.unreadable.push(`${labelOf(item)}: ${String(error.message ?? error).slice(0, 120)}`); }
  }
  t.journalsMs = performance.now() - t2;
  const t3 = performance.now();
  for (const item of found.jsonl) {
    try {
      const kind = cached(item.file, 'sniff', () => sniffJsonl(item.file));
      if (kind === 'results') { results.push({ ...item, label: labelOf(item), data: cached(item.file, 'results', () => readResultFile(item.file)) }); stats.resultFiles++; }
      else if (kind === 'constructions') { constructions.push({ ...item, label: labelOf(item), data: cached(item.file, 'constructions', () => readConstructionFile(item.file)) }); stats.constructionFiles++; }
    } catch (error) { stats.unreadable.push(`${labelOf(item)}: ${String(error.message ?? error).slice(0, 120)}`); }
  }
  t.resultsMs = performance.now() - t3;
  saveCache(cacheDir, next);
  return { found, stores, journals, results, constructions, stats, timings: t };
}
function readConstructionFile(file) {
  return readFileSync(file, 'utf8').split('\n').map(parse).filter(r => r && typeof r.builderModel === 'string').map(r => ({
    label: H.safeId(r.label ?? r.armId, 64), arm: H.safeId(r.armId, 40), family: H.safeId(r.familyId ?? '', 32), builderModel: H.safeId(r.builderModel), builderEffort: H.safeId(r.builderEffort ?? ''), builderCostUsd: num(r.builderCostUsd),
    durationMs: num(r.durationMs), turns: num(r.turns), toolUses: num(r.toolUses), firstPassAtCheck: r.firstPassAtCheck === true || r.firstPassAtCheck === false ? r.firstPassAtCheck : null }));
}

// ------------------------------------------------------------------------------------------------------------------------------ join
const baseJournalId = id => id.replace(/:notes$/, '');
const trialId = r => `${r.arm}:${r.taskKey}:t${r.trial}`;
// A journal run id that NAMES a trial: `${arm}:${taskKey}:t${trial}` (single-call baselines) or the same with a per-run uuid appended (the B1 script arm,
// experiments/lib/arms/b1-script.mjs). Observed conventions, not a contract: a join made this way says J2.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TRIAL_ID = new RegExp(`^(.+:t\\d+)(?::${UUID})?$`, 'i');
const hasUuid = id => new RegExp(UUID, 'i').test(id);
// Two result lines are the same trial when a log repeats a results file (the records-v3 dev-log.jsonl repeats results-live.jsonl without run ids or experiment names,
// with the same timestamp to the millisecond: 305 of 305 repeats): same arm, task, trial and time, and nothing that tells them apart. Lines that name different
// runs or different experiments are never merged, and two trials of one name a second apart are two trials.
const sameTrialLine = (a, b) => (!a.runId || !b.runId || a.runId === b.runId) && (!a.experiment || !b.experiment || a.experiment === b.experiment);
// How close two files are in the folder tree (shared leading path segments): a run's journal and result file live in the same experiment folder.
const nearness = (a, b) => { const x = path.resolve(a).split(path.sep), y = path.resolve(b).split(path.sep); let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++; return i; };
// The result line of a trial is written after its last model call; one written more than this long after it belongs to some other run of the same trial name.
const RESULT_AFTER_MS = 6 * 3600_000, CLOCK_SLACK_MS = 5000;

export function joinSources(scan, { splitOverrides = [], now = Date.now() } = {}) {
  // 1. result lines, de-duplicated (a log can repeat a results file without run ids: keep the line that names a run)
  const byTime = new Map(), resultLines = [];
  for (const file of scan.results) for (const r of file.data) {
    const k = `${r.arm}|${r.taskKey}|${r.trial}|${r.at ?? ''}`, list = byTime.get(k) ?? [];
    const prev = list.find(x => sameTrialLine(x.r, r));
    if (!prev) { const x = { r, file: file.label, path: file.file }; list.push(x); resultLines.push(x); byTime.set(k, list); continue; }
    if ((!prev.r.runId && r.runId) || (!prev.r.runId && !prev.r.experiment && r.experiment)) Object.assign(prev, { r, file: file.label, path: file.file });
  }
  resultLines.sort((a, b) => (a.r.at ?? 0) - (b.r.at ?? 0));
  const resultsByRunId = new Map(), resultsByTrialId = new Map();
  for (const x of resultLines) {
    if (x.r.runId) resultsByRunId.set(x.r.runId, x);              // the latest line for a run id wins
    const t = trialId(x.r); if (!resultsByTrialId.has(t)) resultsByTrialId.set(t, []); resultsByTrialId.get(t).push(x);
  }
  const used = new Set();
  // 2. journals. One run id in two journals is either a COPY of one run (a scratch copy of a journal: the same rows, so the same first call time, to the
  //    millisecond; a copy taken mid-run has fewer rows) or two different runs that share a trial-shaped name (a second workspace that reran `arm:task:t0`).
  //    Copies become one cluster; a run id holding a uuid is always one run. Different runs stay separate rows.
  const clustersByRun = new Map();
  const overlaps = (c, a) => a.first == null || c.first == null || (a.first <= c.last + CLOCK_SLACK_MS && c.first <= a.last + CLOCK_SLACK_MS);
  for (const j of scan.journals) for (const [runId, agg] of j.data) {
    const list = clustersByRun.get(runId) ?? []; clustersByRun.set(runId, list);
    const member = { agg, label: j.label, file: j.file };
    const hit = hasUuid(runId) ? list[0] : list.find(c => c.first == null || agg.first == null || c.members.some(m => m.agg.first === agg.first));
    if (hit) { hit.members.push(member); if (agg.first != null) { hit.first = hit.first == null ? agg.first : Math.min(hit.first, agg.first); hit.last = Math.max(hit.last ?? agg.last, agg.last); } }
    else list.push({ runId, members: [member], first: agg.first, last: agg.last });
  }
  // the copy to read: most calls, then the one nearest the run's own files (a scratch copy elsewhere loses a tie), then the label
  const pick = (cluster, near = []) => {
    const score = m => Math.max(0, ...near.filter(Boolean).map(f => nearness(m.file, f)));
    const best = [...cluster.members].sort((a, b) => b.agg.n - a.agg.n || score(b) - score(a) || (a.label < b.label ? -1 : 1))[0];
    return { agg: best.agg, label: best.label, file: best.file, others: cluster.members.length - 1 };
  };
  // 3. stores: the copy with the longest verified chain wins per run id
  const storeByRun = new Map();
  for (const s of scan.stores) for (const run of s.data.runs) {
    const prev = storeByRun.get(run.id), score = (run.chain.ok ? 1e9 : 0) + run.chain.count;
    if (!prev || score > prev.score) storeByRun.set(run.id, { run, store: s, score, copies: prev ? [...prev.copies, prev.store.label] : [] });
    else prev.copies.push(s.label);
  }
  const rows = [];
  const splitInfo = taskKey => H.splitOf(taskKey, splitOverrides);
  const common = (row, result) => {
    if (result) {
      const r = result.r; used.add(result);
      Object.assign(row, { experiment: r.experiment, arm: r.arm, armHash: r.armHash, taskKey: r.taskKey, taskHash: r.taskHash, trial: r.trial, ...splitInfo(r.taskKey), oracle: r.oracle });
      row.sources.push({ kind: 'results', label: result.file, shape: 'jsonl' });
    } else Object.assign(row, { experiment: null, arm: null, armHash: null, taskKey: null, taskHash: null, trial: null, split: 'unknown', inspected: false, oracle: null });
    return row;
  };
  const finish = row => {
    row.honesty = H.honestyOf(row.verdict, row.oracle);
    row.labels = H.labelsFor(row);
    row.digest = digest({ key: row.key, head: row.integrity?.head ?? null, calls: row.calls?.n ?? 0, cost: row.cost?.usd ?? null, oracle: row.oracle ?? null, verdict: row.verdict?.verdict ?? null }).slice(0, 16);
    rows.push(row);
  };
  const emptyRow = (key, kind, fidelity) => ({ key, kind, fidelity, sources: [], joins: [], workflow: null, startedAt: null, endedAt: null, durationMs: null, status: null, verdict: null, engineHash: null,
    cost: { usd: null, imputedUsd: 0, unknownCalls: 0, source: 'none' }, calls: { n: 0, errors: 0, byModel: {} }, escalations: 0, escalationsInferred: false, escalationList: [], retries: 0, checkFails: 0, failed: [], failedCount: 0, acceptance: null, costTop: [], integrity: { chain: 'n/a', events: 0, head: null, journalRows: null, journalOrphans: null } });
  const lineVerdict = r => r.verdict ? { verdict: r.verdict, code: null, authority: null, source: 'result line' } : null;
  const fromJournal = (row, j) => {
    const a = j.agg;
    row.calls = { n: a.n, errors: a.errors, byModel: Object.fromEntries(Object.entries(a.byModel).map(([m, v]) => [m, { n: v.n, usd: H.round(v.usd, 9) }])) };
    row.cost = { usd: H.round(a.costUsd, 9), imputedUsd: H.round(a.imputedUsd, 9), unknownCalls: a.unknownCalls, source: 'journal' };
    row.escalations = a.escalationsInferred; row.escalationsInferred = a.escalationsInferred > 0;
    // The journal records failed model CALLS (a retried call leaves one), never node outcomes: the row says so and the summary words it that way.
    row.failed = a.failed.map(f => ({ ...f })); row.failedCount = a.errors ?? a.failed.reduce((s, f) => s + (f.count ?? 1), 0); row.failedUnit = 'call';
    row.startedAt = a.first; row.endedAt = a.last; row.durationMs = a.first != null && a.last != null ? a.last - a.first : null;
    row.sources.push({ kind: 'journal', label: j.label, path: j.file, shape: 'model_calls', runIds: j.runIds });
    if (j.others) row.journalCopies = j.others + 1;
  };

  // full runs
  const storeClusters = new Set();
  for (const [runId, { run, store, copies }] of storeByRun) {
    const row = emptyRow(runId, 'run', 'full');
    row.runId = runId;                                               // the store's run id (the key is the same unless the uniqueness pass had to rename it)
    const result = resultsByRunId.get(runId) ?? null, h = run.header, f = run.facts;
    row.sources.push({ kind: 'store', label: store.label, path: store.file, shape: store.data.shape, headerSource: h.headerSource });
    if (copies.length) { row.copies = copies.length + 1; }
    let joined = result;
    row.joins.push(result ? 'J1' : null);
    common(row, result);
    // J3 fallback: a kept trial workspace named <exp>/<arm>/<task>_t<trial>/ws, joined only to a line of THAT experiment folder (or one that names no experiment)
    if (!result) {
      const m = /\/([^/]+)\/([^/]+)\/([^/]+)_t(\d+)\/ws\/\.foundry\/foundry\.sqlite$/.exec(store.file);
      if (m && store.data.runs.length === 1) {
        const hits = resultLines.filter(x => !used.has(x) && !x.r.runId && x.r.arm === m[2] && x.r.taskKey.replace(/[:]/g, '_') === m[3] && String(x.r.trial) === m[4] && (!x.r.experiment || x.r.experiment === m[1]));
        const hit = hits.sort((a, b) => nearness(b.path, store.file) - nearness(a.path, store.file))[0];
        if (hit) { common(row, hit); row.joins[0] = 'J3'; joined = hit; }
      }
    }
    row.joins = row.joins.filter(Boolean);
    row.workflow = run.workflow;
    row.startedAt = f.startedAt ?? h.createdAt; row.endedAt = f.endedAt ?? h.updatedAt; row.durationMs = f.durationMs;
    row.status = H.safeId(h.status ?? f.status, 24);
    // the store's own verdict first; a store with none (an older engine, a run still writing) falls back to the result line's, which says so, so a pass is never missed
    row.verdict = f.verdict ? { verdict: f.verdict.verdict, code: f.verdict.code, authority: f.verdict.authority }
      : h.verdict?.verdict ? { verdict: H.safeId(h.verdict.verdict, 24), code: h.verdict.code ? H.safeId(h.verdict.code) : null, authority: h.verdict.authority ? H.safeId(h.verdict.authority, 24) : null }
      : joined ? lineVerdict(joined.r) : null;
    row.engineHash = (h.engineHash ?? f.engineHash)?.slice(0, 16) ?? null;
    row.calls = { n: f.calls.n, errors: f.calls.errors, byModel: Object.fromEntries(Object.entries(f.calls.byModel)) };   // a plain object (fromEntries defines own keys, "__proto__" included)
    const clusters = clustersByRun.get(runId) ?? [];
    const cluster = clusters.length > 1 ? clusters.find(c => c.first == null || (c.first <= (row.endedAt ?? Infinity) + CLOCK_SLACK_MS && (c.last ?? 0) + CLOCK_SLACK_MS >= (row.startedAt ?? 0))) ?? clusters[0] : clusters[0];
    for (const c of clusters) storeClusters.add(c);                // a run that has a store is never repeated as a journal-only row
    const j = cluster ? pick(cluster, [store.file, joined?.path]) : null;
    const runCost = num(h.cost) ?? f.cost;
    row.cost = { usd: H.round(runCost, 9), imputedUsd: j ? H.round(j.agg.imputedUsd, 9) : 0, unknownCalls: j ? j.agg.unknownCalls : 0, source: 'run' };
    if (j) { row.sources.push({ kind: 'journal', label: j.label, path: j.file, shape: 'model_calls', runIds: [runId] }); if (Math.abs(j.agg.costUsd - runCost) > 1e-6) { row.cost.journalUsd = H.round(j.agg.costUsd, 9); row.cost.disagrees = true; } }
    row.escalationList = f.escalations; row.escalations = f.escalations.length; row.retries = f.retries; row.checkFails = f.checkFails;
    row.failed = f.failed.slice(0, 20); row.failedCount = f.failed.length; row.acceptance = f.acceptance; row.costTop = f.costTop; row.inputHash = f.inputHash?.slice(0, 16) ?? null;
    row.integrity = { chain: run.chain.ok ? 'ok' : 'broken', chainReason: run.chain.reason, events: run.chain.count, head: run.chain.head, firstSeq: run.firstSeq, journalRows: run.orphans?.rows ?? j?.agg.n ?? null, journalOrphans: run.orphans?.orphans ?? null, headerShape: store.data.shape };
    if (run.workflow.missing) row.integrity.workflowMissing = run.workflow.missing;
    finish(row);
  }
  // journal-only runs (no surviving store). A `:notes` journal run belongs to the same trial as its base id.
  const groups = new Map();                                          // base id -> clusters of the base id and of its :notes id, merged by time overlap
  for (const [runId, clusters] of clustersByRun) for (const c of clusters) {
    if (storeClusters.has(c) || storeByRun.has(runId)) continue;
    const base = baseJournalId(runId), list = groups.get(base) ?? []; groups.set(base, list);
    const g = list.find(x => hasUuid(base) || overlaps(x, c));
    if (g) { g.parts.push(c); if (c.first != null) { g.first = g.first == null ? c.first : Math.min(g.first, c.first); g.last = Math.max(g.last ?? c.last, c.last); } }
    else list.push({ base, parts: [c], first: c.first, last: c.last });
  }
  // a trial-named journal joins the result line of the same trial written at or after its last call, the nearest one first (J2); earlier groups claim first
  const allGroups = [...groups.values()].flat().sort((a, b) => (a.last ?? Infinity) - (b.last ?? Infinity));
  for (const g of allGroups) {
    const near = g.parts.flatMap(p => p.members.map(m => m.file));
    const j1 = resultsByRunId.get(g.base) ?? g.parts.map(p => resultsByRunId.get(p.runId)).find(Boolean) ?? null;
    let result = j1 && !used.has(j1) ? j1 : null, joinedBy = result ? 'J1' : null;
    const tm = !result ? TRIAL_ID.exec(g.base) : null;
    if (tm) {
      const cands = (resultsByTrialId.get(tm[1]) ?? []).filter(x => !used.has(x) && !x.r.runId && (g.last == null || x.r.at == null || (x.r.at >= g.last - CLOCK_SLACK_MS && x.r.at - g.last <= RESULT_AFTER_MS)));
      result = cands.sort((a, b) => ((a.r.at ?? 0) - (b.r.at ?? 0)) || Math.max(...near.map(f => nearness(b.path, f))) - Math.max(...near.map(f => nearness(a.path, f))))[0] ?? null;
      if (result) joinedBy = 'J2';
    }
    g.result = result; g.joinedBy = joinedBy;
    if (result) used.add(result);
  }
  for (const [base, list] of groups) for (const g of list) {
    const kind = base.startsWith('construct:') ? 'construction' : 'run';
    const row = emptyRow(list.length > 1 ? `${base}@${pick(g.parts[0]).label}` : base, kind, 'journal-only');
    if (g.joinedBy) row.joins.push(g.joinedBy);
    common(row, g.result);
    // merge the parts (a `:notes` journal run belongs to the same trial); each part is read from its best copy
    const chosen = g.parts.map(p => ({ id: p.runId, ...pick(p, [g.result?.path]) }));
    const merged = { agg: { n: 0, errors: 0, costUsd: 0, imputedUsd: 0, unknownCalls: 0, first: null, last: null, byModel: H.dict(), escalationsInferred: 0, failed: [] }, label: chosen[0].label, file: chosen[0].file, runIds: chosen.map(p => p.id), others: 0 };
    for (const p of chosen) {
      const a = p.agg, m = merged.agg;
      m.n += a.n; m.errors += a.errors; m.costUsd += a.costUsd; m.imputedUsd += a.imputedUsd; m.unknownCalls += a.unknownCalls; m.escalationsInferred += a.escalationsInferred;
      m.first = m.first == null ? a.first : Math.min(m.first, a.first ?? m.first); m.last = m.last == null ? a.last : Math.max(m.last, a.last ?? m.last);
      for (const [k, v] of Object.entries(a.byModel)) { const t = H.own(m.byModel, k) ? m.byModel[k] : (m.byModel[k] = { n: 0, usd: 0 }); t.n += v.n; t.usd += v.usd; }
      m.failed.push(...a.failed);
      merged.others = Math.max(merged.others, p.others);
    }
    fromJournal(row, merged);
    if (g.result) {
      const r = g.result.r;
      row.status = r.status; row.verdict = r.verdict ? { verdict: r.verdict, code: null, authority: null } : null;
      if (row.startedAt == null && r.at != null) { row.endedAt = r.at; row.startedAt = r.at - (r.latencyMs ?? 0); row.durationMs = r.latencyMs; }
    }
    finish(row);
  }
  // result-only trials (nothing else survives)
  for (const x of resultLines) {
    if (used.has(x)) continue;
    const r = x.r, row = emptyRow(`trial:${r.experiment}:${r.arm}:${r.taskKey}:t${r.trial}`, 'trial', 'result-only');
    common(row, x);
    row.status = r.status; row.verdict = r.verdict ? { verdict: r.verdict, code: null, authority: null } : null;
    row.cost = { usd: r.costUsd, imputedUsd: r.imputedUsd ?? 0, unknownCalls: 0, source: 'result' };
    row.calls = { n: r.calls ?? 0, errors: 0, byModel: r.models ? Object.fromEntries(Object.entries(r.models).map(([k, v]) => [k, { n: v, usd: null }])) : {} };
    row.escalations = r.escalations ?? 0;
    row.endedAt = r.at; row.startedAt = r.at != null && r.latencyMs != null ? r.at - r.latencyMs : null; row.durationMs = r.latencyMs;
    finish(row);
  }
  // construction link: arm + family (approximate; the workflow-hash join J4 needs the construction's workflow.json)
  const cons = scan.constructions.flatMap(c => c.data);
  for (const row of rows) {
    const c = cons.find(x => x.arm === row.arm && row.experiment && row.experiment.endsWith(`-${x.family}`));
    if (c) row.builtBy = { builderModel: c.builderModel, builderEffort: c.builderEffort, builderCostUsd: c.builderCostUsd, label: c.label };
  }
  // Every key is unique: the page, its links and compare look a run up by key. Two trials of the same name in two workspaces (gate-g2 and gate-g2b both ran
  // `trial:gate-B0:...`) keep their own rows, told apart by the file they came from.
  const seen = new Map();
  for (const row of rows) seen.set(row.key, (seen.get(row.key) ?? 0) + 1);
  const taken = new Set();
  for (const row of rows) {
    if (seen.get(row.key) > 1) { let k = `${row.key}@${row.sources[0]?.label ?? 'source'}`; for (let n = 2; taken.has(k); n++) k = `${row.key}@${row.sources[0]?.label ?? 'source'}#${n}`; row.key = k; row.digest = digest({ key: row.key, prev: row.digest }).slice(0, 16); }
    taken.add(row.key);
  }
  rows.sort((a, b) => (b.startedAt ?? b.endedAt ?? 0) - (a.startedAt ?? a.endedAt ?? 0) || (a.key < b.key ? -1 : 1));
  return { rows, constructions: cons };
}

// ------------------------------------------------------------------------------------------------------------------------------ build
export function buildIndex({ roots, cacheDir = null, sources = null, exclude, now = Date.now() } = {}) {
  const t0 = performance.now();
  const scan = scanSources(roots, { cacheDir, exclude });
  const t1 = performance.now();
  const { rows, constructions } = joinSources(scan, { splitOverrides: sources?.splitOverrides ?? [], now });
  const t2 = performance.now();
  const shapes = scan.stats.shapes;
  const index = {
    schema: INDEX_SCHEMA, builtAt: new Date(now).toISOString(), roots: roots.map(r => path.basename(path.resolve(r))),
    report: {
      stores: scan.stores.length, storeRuns: scan.stores.reduce((s, x) => s + x.data.runs.length, 0), storeShapes: shapes, journals: scan.journals.length, resultFiles: scan.stats.resultFiles, constructionFiles: scan.stats.constructionFiles,
      resultLinesJoined: rows.filter(r => r.oracle).length, rows: rows.length, byFidelity: Object.fromEntries(['full', 'journal-only', 'result-only'].map(f => [f, rows.filter(r => r.fidelity === f).length])),
      byKind: Object.fromEntries(['run', 'trial', 'construction'].map(f => [f, rows.filter(r => r.kind === f).length])), skipped: scan.found.skipped, unreadable: scan.stats.unreadable, errors: scan.stats.errors, nonJournalSqlite: scan.stats.nonJournalSqlite,
      chainBroken: rows.filter(r => r.integrity?.chain === 'broken').length, scanned: scan.stats.scanned, cached: scan.stats.cached,
      timingsMs: { walk: Math.round(scan.timings.walkMs), stores: Math.round(scan.timings.storesMs), journals: Math.round(scan.timings.journalsMs), results: Math.round(scan.timings.resultsMs), scanTotal: Math.round(t1 - t0), join: Math.round(t2 - t1), total: Math.round(t2 - t0) },
      notes: ['Fidelity: kept workspaces skew to failures; read rates from all rows, not from the full ones.', 'Strings from files (workflow title, arm, task key) are untrusted text.']
    },
    constructions, rows
  };
  return index;
}

// ------------------------------------------------------------------------------------------------------------------------------ CLI
function main() {
  const { values: a } = parseArgs({ options: { root: { type: 'string', multiple: true }, sources: { type: 'string' }, cache: { type: 'string' }, out: { type: 'string' }, stats: { type: 'boolean', default: false }, exclude: { type: 'string', multiple: true } } });
  if (!a.root?.length || !a.out) { console.error('Usage: index-runs.mjs --root DIR [--root DIR ...] [--sources FILE.json] [--cache DIR] --out index.json [--stats]'); process.exit(2); }
  const sources = a.sources ? parse(readFileSync(a.sources, 'utf8')) : null;
  const index = buildIndex({ roots: a.root, cacheDir: a.cache, sources, exclude: a.exclude ? [...DEFAULT_EXCLUDE, ...a.exclude] : undefined });
  mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true });
  writeFileSync(a.out, JSON.stringify(index), { mode: 0o600 }); chmodSync(a.out, 0o600);
  const r = index.report;
  console.log(JSON.stringify(a.stats ? { out: a.out, bytes: statSync(a.out).size, ...r } : { out: a.out, bytes: statSync(a.out).size, rows: r.rows, byFidelity: r.byFidelity, timingsMs: r.timingsMs }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
