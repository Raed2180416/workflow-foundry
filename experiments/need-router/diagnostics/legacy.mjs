// LEGACY rows: loaders and normalisation for the archived runs the M0 diagnostics read (DESIGN §7 M0 item 10).
//   P1 records v3        research/need-router-20261014/archive/p1/results.jsonl            (rescued; 8 arms x 12 tasks x 3 trials)
//   C0 dev round         research/need-router-20261014/archive/c0-dev/{results,constructions}.jsonl  (rescued; records, codefix)
//   JIT streams          research/jit-20261008/runs/<experiment>/<arm>/results.jsonl       (committed; via harvest.mjs)
// Every row is tagged `legacy: true`, `evidence: 'LEGACY'` and carries its source path. If the rescued archive is absent
// (a container without it) the loader falls back to the git-ignored experiments/runs/ copy and says so in `sources`.
// A unit is one task run: `${taskKey}#t${trial}` for P1 and C0 (trials share a task, hence a seed and a taskHash), the
// taskKey for the single-draw JIT streams. A LEGACY job is one archived experiment with its modes paired on its units.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readJsonl, ARCHIVE_DIR, REPO, rel, abs, sourceOf, listDir } from './common.mjs';
import { readStreams, harvest, modeOf, LEGACY_TAG } from '../harvest.mjs';

export const JIT_RUNS_DIR = path.join(REPO, 'research/jit-20261008/runs');
export const TIMEOUT_BOUND_USD = 1;   // DESIGN §1: a timed-out direct call is charged at the per-call bound, never $0

// Archived arm -> mode name. Names follow the v1 registry where an analogue exists (direct-H, agent-H, agent-O); the rest are
// LEGACY-only modes with no v1 analogue (hand-written workflows, Foundry workflows, static solvers, JIT).
export const P1_MODES = Object.freeze({
  'b0call-haiku-none': 'direct-H', 'b0call-haiku-med': 'direct-H-med', 'b0ncall-haiku-med': 'direct-H-notes',
  'b0call-haiku45-none': 'direct-H45', 'b0call-sonnet-med': 'direct-S', 'b0agent-haiku': 'agent-H',
  'fhand-haiku': 'hand-H', 'fhand-sonnet': 'hand-S',
});
export const C0_MODES = Object.freeze({
  'B0-haiku': 'agent-H', 'B0-opus': 'agent-O', 'F-haiku': 'wf-H', 'F-opus': 'wf-O', 'B1-haiku': 'script-H', 'B1-opus': 'script-O',
});
export const JIT_MODES = Object.freeze({
  'agent-haiku': 'agent-H', 'agent-sonnet': 'agent-S', 'agent-opus': 'agent-O',
  'jit-HH': 'jit-HH', 'jit-OH': 'jit-OH', 'jit-SH': 'jit-SH', 'static-b1h': 'static-b1h',
});
/** Mode registry in the shape metrics.needTable takes. cls is the binary need class; JIT is counted as workflow (an assumption, stated in the report). */
export const LEGACY_REGISTRY = Object.freeze({
  'direct-H': { cls: 'no-workflow', kind: 'none' }, 'direct-H-med': { cls: 'no-workflow', kind: 'none' }, 'direct-H-notes': { cls: 'no-workflow', kind: 'none' },
  'direct-H45': { cls: 'no-workflow', kind: 'none' }, 'direct-S': { cls: 'no-workflow', kind: 'none' },
  'agent-H': { cls: 'no-workflow', kind: 'none' }, 'agent-S': { cls: 'no-workflow', kind: 'none' }, 'agent-O': { cls: 'no-workflow', kind: 'none' },
  'hand-H': { cls: 'workflow', kind: 'guided', prebuilt: true }, 'hand-S': { cls: 'workflow', kind: 'guided', prebuilt: true },
  'wf-H': { cls: 'workflow', kind: 'built' }, 'wf-O': { cls: 'workflow', kind: 'built' },
  'script-H': { cls: 'workflow', kind: 'built' }, 'script-O': { cls: 'workflow', kind: 'built' }, 'static-b1h': { cls: 'workflow', kind: 'built' },
  'jit-HH': { cls: 'workflow', kind: 'jit' }, 'jit-OH': { cls: 'workflow', kind: 'jit' }, 'jit-SH': { cls: 'workflow', kind: 'jit' },
});
export const LEGACY_JOB_DEFS = Object.freeze([
  { id: 'p1-records', kind: 'p1', family: 'records', oracle: 'records' },
  { id: 'c0-dev-records', kind: 'c0', family: 'records', oracle: 'records', experiment: 'c0-dev-records' },
  { id: 'c0-dev-codefix', kind: 'c0', family: 'codefix', oracle: 'exact', experiment: 'c0-dev-codefix' },
  { id: 'jit-dev-records-1', kind: 'jit', family: 'records', oracle: 'records' },
  { id: 'jit-r0-records', kind: 'jit', family: 'records', oracle: 'records' },
  { id: 'jit-dev-kinetics-1', kind: 'jit', family: 'kinetics', oracle: 'kinetics' },
  { id: 'jit-r0-kinetics', kind: 'jit', family: 'kinetics', oracle: 'kinetics' },
]);

const parseDetails = s => { if (s && typeof s === 'object') return s; try { return s ? JSON.parse(s) : null; } catch { return null; } };
const errCode = e => (e == null ? null : typeof e === 'string' ? e : e.code ?? 'ERROR');
const seedOf = taskKey => Number(String(taskKey).match(/:s(\d+)$/)?.[1] ?? NaN);
const diffOf = taskKey => Number(String(taskKey).match(/:d(\d+):/)?.[1] ?? NaN);

/** Where an archived file lives: the rescued copy if present, else the ignored original (flagged). */
export function archivePath(name, { archiveDir = ARCHIVE_DIR, repo = REPO } = {}) {
  const a = path.join(archiveDir, name);
  if (existsSync(a)) return { file: a, rescued: true };
  const o = path.join(repo, 'experiments/runs', name);
  return { file: o, rescued: false, exists: existsSync(o) };
}

/** One normalised row from a P1 or C0 results line. */
export function normaliseRunRow(r, { modes, source }) {
  const mode = modes[r.arm];
  if (!mode) return null;
  const details = parseDetails(r.oracleDetails);
  const code = errCode(r.error);
  const timeout = code === 'MODEL_TIMEOUT';
  const usdReported = r.costUsd ?? 0;
  const bound = r.meta?.costUpperUsd ?? TIMEOUT_BOUND_USD;
  const imputed = (r.imputedUsd ?? 0) + (timeout ? Math.max(0, TIMEOUT_BOUND_USD - usdReported) : r.costUnknown ? Math.max(0, bound - usdReported) : 0);
  return {
    ...LEGACY_TAG, source,
    experiment: r.experiment, arm: r.arm, mode, family: r.family, taskKey: r.taskKey, taskHash: r.taskHash, trial: r.trial ?? 0,
    unit: `${r.taskKey}#t${r.trial ?? 0}`, seed: seedOf(r.taskKey), difficulty: diffOf(r.taskKey),
    pass: r.pass === true, score: typeof r.score === 'number' ? r.score : null,
    delivered: code === null, schemaValid: details?.reason !== 'schema-invalid', error: code,
    usdReported, usdImputed: imputed, costUnknown: !!r.costUnknown, latencyMs: r.latencyMs ?? null,
    turns: r.meta?.turns ?? null, tools: r.meta?.tools ?? null, calls: r.meta?.calls ?? null, escalations: r.meta?.escalations ?? null,
    verdict: r.meta?.verdict ?? null, tokensOut: r.meta?.tokensOut ?? null, streamUsage: r.meta?.streamUsage ?? null,
    details,
  };
}

export function loadRunFile(name, modes, opts = {}) {
  const { file, rescued, exists } = archivePath(name, opts);
  if (rescued === false && !exists) return { rows: [], source: null, rescued: false, missing: name };
  const source = rel(file);
  const rows = readJsonl(file).map(r => normaliseRunRow(r, { modes, source })).filter(Boolean);
  return { rows, source: sourceOf(file), rescued };
}

/** C0 construction costs per (family, mode): the build of the workflow or solver (constructions.jsonl, one row each). */
export function loadConstructions(opts = {}) {
  const { file, rescued, exists } = archivePath('c0-dev/constructions.jsonl', opts);
  if (rescued === false && !exists) return { builds: [], source: null, rescued: false };
  const builds = readJsonl(file).map(c => ({
    family: c.familyId, mode: C0_MODES[c.armId], armId: c.armId, usd: c.constructionCostUsd, builderCostUsd: c.builderCostUsd, gatewayCostUsd: c.gatewayCostUsd,
    builderUsage: c.builderUsage ?? null, builderStreamUsage: c.builderStreamUsage ?? null, builderModel: c.builderModel, label: c.label,
  })).filter(b => b.mode);
  return { builds, source: sourceOf(file), rescued };
}

/** JIT streams as normalised rows, with the harvest's fixed costs and pairing report. Rows carry the raw-stream fields D3 needs. */
export function loadJitJobs(root = JIT_RUNS_DIR) {
  if (!existsSync(root)) return { jobs: new Map(), sources: [] };
  const streams = readStreams(root);
  const h = harvest(streams);
  const raw = new Map();
  for (const s of streams) for (const r of s.rows) raw.set(`${s.family}\u0000${s.mode}\u0000${r.taskKey}`, { r, s });
  const jobs = new Map();
  for (const x of h.rows) {
    const { r, s } = raw.get(`${x.family}\u0000${x.mode}\u0000${x.task}`);
    const details = parseDetails(r.oracleDetails);
    const row = {
      ...LEGACY_TAG, source: s.source, experiment: x.family, arm: s.arm, mode: JIT_MODES[x.mode] ?? x.mode, family: String(r.taskKey).split(':')[0], taskKey: r.taskKey,
      taskHash: r.taskHash, trial: 0, unit: r.taskKey, seed: r.seed ?? seedOf(r.taskKey), difficulty: r.difficulty ?? diffOf(r.taskKey),
      pass: r.pass === true, score: typeof r.score === 'number' ? r.score : null, delivered: errCode(r.error) === null, schemaValid: details?.reason !== 'schema-invalid',
      error: errCode(r.error), usdReported: x.costUsd, usdImputed: 0, costUnknown: !!r.costUnknown, latencyMs: r.latencyMs ?? null,
      turns: null, tools: null, calls: null, escalations: null, verdict: null, tokensOut: null, streamUsage: null, details,
      traceId: r.traceId ?? null, deliveredBy: r.delivered ?? null,
    };
    (jobs.get(x.family) ?? jobs.set(x.family, { rows: [], builds: [], report: null, sources: new Set() }).get(x.family)).rows.push(row);
    jobs.get(x.family).sources.add(s.source);
  }
  for (const f of h.fixed) if (f.fixedUsd > 0) jobs.get(f.family).builds.push({ mode: JIT_MODES[f.mode] ?? f.mode, usd: f.fixedUsd, source: f.streamSource });
  for (const rep of h.report) jobs.get(rep.family).report = rep;
  for (const j of jobs.values()) j.sources = [...j.sources].sort();
  return { jobs, sources: [...new Set(h.report.flatMap(r => r.sources))].sort() };
}

/**
 * Pair a job's modes on their units (the harvest rule): keep modes that ran at least `minCoverage` of the units any mode ran,
 * restrict every kept mode to the units all of them ran. Reports every dropped mode and unit; nothing is lost silently.
 */
export function pairJob(rows, { minCoverage = 0.5 } = {}) {
  const byMode = new Map();
  for (const r of rows) (byMode.get(r.mode) ?? byMode.set(r.mode, []).get(r.mode)).push(r);
  const all = new Set(rows.map(r => r.unit));
  const unitsOf = m => new Set(byMode.get(m).map(r => r.unit));
  const kept = [...byMode.keys()].filter(m => unitsOf(m).size >= minCoverage * all.size);
  const dropped = [...byMode.keys()].filter(m => !kept.includes(m)).map(m => ({ mode: m, units: byMode.get(m).length }));
  const common = [...all].filter(u => kept.every(m => unitsOf(m).has(u))).sort();
  const keep = new Set(common);
  const out = rows.filter(r => kept.includes(r.mode) && keep.has(r.unit));
  return { rows: out, report: { units: all.size, paired: common.length, modes: kept, dropped, outOfPair: rows.filter(r => kept.includes(r.mode) && !keep.has(r.unit)).length } };
}

/**
 * Every archived LEGACY job, paired. Returns { jobs: [{id, kind, family, oracle, rows, builds, pairing, sources}], sources, notes }.
 * Builds: JIT compile components and external builds from harvest; C0 constructions; none for P1 (hand authoring, >= $24.91
 * [core-20261006/REPORT.md], is excluded exactly as the archived report excluded it; the report says so).
 */
export function loadLegacyJobs({ archiveDir = ARCHIVE_DIR, jitRoot = JIT_RUNS_DIR } = {}) {
  const jobs = [], sources = [], notes = [];
  const opts = { archiveDir };
  const p1 = loadRunFile('p1/results.jsonl', P1_MODES, opts);
  const c0 = loadRunFile('c0-dev/results.jsonl', C0_MODES, opts);
  const cons = loadConstructions(opts);
  for (const [label, x] of [['p1/results.jsonl', p1], ['c0-dev/results.jsonl', c0], ['c0-dev/constructions.jsonl', cons]]) {
    if (!x.source) notes.push(`${label}: not in this container (neither the rescued archive nor experiments/runs/): its diagnostics are skipped`);
    else { sources.push({ ...x.source, rescued: x.rescued }); if (!x.rescued) notes.push(`${label}: read from the git-ignored experiments/runs/ copy; run rescue.mjs to commit it`); }
  }
  const jit = loadJitJobs(jitRoot);
  for (const def of LEGACY_JOB_DEFS) {
    let rows = [], builds = [], jobSources = [];
    if (def.kind === 'p1') { rows = p1.rows; jobSources = p1.source ? [p1.source.path] : []; }
    else if (def.kind === 'c0') {
      rows = c0.rows.filter(r => r.experiment === def.experiment);
      builds = cons.builds.filter(b => b.family === def.family).map(b => ({ mode: b.mode, usd: b.usd, source: cons.source?.path }));
      jobSources = [c0.source?.path, cons.source?.path].filter(Boolean);
    } else { const j = jit.jobs.get(def.id); if (j) { rows = j.rows; builds = j.builds; jobSources = j.sources; } }
    if (!rows.length) continue;
    const paired = pairJob(rows);
    const kept = new Set(paired.report.modes);
    jobs.push({ ...def, rows: paired.rows, builds: builds.filter(b => kept.has(b.mode)), pairing: paired.report, sources: jobSources });
  }
  if (jit.sources.length) sources.push(...jit.sources.map(p => sourceOf(p, { rescued: true })));
  return { jobs, sources, notes };
}

/** The matrix rows and build rows metrics.needTable takes for one LEGACY job (single lineage 0 per built mode; every unit is its own task). */
export function toMatrix(job, { passAt = null } = {}) {
  const rows = job.rows.map(r => ({
    job: job.id, mode: r.mode, task: r.unit, rep: 0, pass: r.pass, delivered: r.delivered, schemaValid: r.schemaValid, score: r.score,
    usdReported: r.usdReported, usdImputed: r.usdImputed, seed: Number.isFinite(r.seed) ? r.seed : undefined, taskHash: r.taskHash ?? undefined,
    error: r.error ?? undefined, ...(passAt ? { passAt: passAt(r) } : {}),
  }));
  const builds = job.builds.map(b => ({ job: job.id, mode: b.mode, rep: 0, usd: b.usd }));
  return { rows, builds };
}

/** Agent-session traces of the JIT streams (committed under runs/<exp>/<arm>/traces/<traceId>.json): numeric fields only. */
export function loadJitTrace(root, experiment, armSlug, traceId) {
  const f = path.join(root, experiment, armSlug, 'traces', `${traceId}.json`);
  if (!existsSync(f)) return null;
  const t = JSON.parse(readFileSync(f, 'utf8'));
  return {
    traceId, model: t.model ?? null, costUsd: t.costUsd ?? null, costUnknown: !!t.costUnknown, latencyMs: t.latencyMs ?? null, turns: t.turns ?? null, tools: t.tools ?? null,
    streamUsage: t.streamUsage ?? null, answerValid: t.answerValid ?? null, error: errCode(t.error), file: rel(f),
  };
}
export { abs, listDir, modeOf };
