// LEGACY rows: loaders and normalisation for the archived runs the M0 diagnostics read (DESIGN §7 M0 item 10).
//   P1 records v3        research/need-router-20261014/archive/p1/results.jsonl            (rescued; 8 arms x 12 tasks x 3 trials)
//   C0 dev round         research/need-router-20261014/archive/c0-dev/{results,constructions}.jsonl  (rescued; records, codefix)
//   JIT streams          research/jit-20261008/runs/<experiment>/<arm>/results.jsonl       (committed; via harvest.mjs)
// Every row is tagged `legacy: true`, `evidence: 'LEGACY'` and carries its source path. If the rescued archive is absent
// (a container without it) the loader falls back to the git-ignored experiments/runs/ copy and says so in `sources`.
// A unit is one task run: `${taskKey}#t${trial}` for P1 and C0 (trials share a task, hence a seed and a taskHash), the
// taskKey for the single-draw JIT streams. A LEGACY job is one archived experiment with its modes paired on its units.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { readJsonl, ARCHIVE_DIR, REPO, rel, abs, sourceOf, listDir } from './common.mjs';
import { readStreams, harvest, modeOf, LEGACY_TAG, FIXED_COMPONENTS } from '../harvest.mjs';
import { labelSetModes, classOf } from '../metrics.mjs';

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
/** The model that ran an archived agent session (the price table is keyed by it). */
export const AGENT_MODEL = Object.freeze({ 'b0agent-haiku': 'claude-haiku-5-5', 'B0-haiku': 'claude-haiku-5-5', 'B0-opus': 'claude-opus-5-5' });
export const JIT_MODES = Object.freeze({
  'agent-haiku': 'agent-H', 'agent-sonnet': 'agent-S', 'agent-opus': 'agent-O',
  'jit-HH': 'jit-HH', 'jit-OH': 'jit-OH', 'jit-SH': 'jit-SH', 'static-b1h': 'static-b1h',
});
/**
 * The ceiling rule (DESIGN §2): L_today keeps the workflow modes whose workflow was written by the cheap builder, the one the router deploys today
 * (Haiku 5.5: construct-H, agent-H+proc); L_ceiling also admits what a frontier model or a person wrote (build-O, the references). Applied to every
 * LEGACY workflow mode by the one field that decides it, the AUTHOR of the workflow (not the model that executes it):
 *   haiku    the cheap builder: L_today
 *   opus     a frontier model (the analogue of build-O): ceiling. wf-O and script-O (C0 Opus builder), jit-OH (Opus compiler), hand-H and hand-S
 *            (the P1 workflow an Opus agent hand-wrote; the executor, Haiku or Sonnet, is not its author)
 *   sonnet   a mid-tier model that is not the cheap builder and that no v1 mode builds with: ceiling, by the same rule (jit-SH, Sonnet compiler).
 *            This is a decision, not a measurement: DESIGN §2 names Haiku as today's builder and admits only build-O and the references beyond it.
 * `ceiling` is derived from `builder`, so no workflow mode can be added without saying who wrote its workflow (a test asserts it).
 */
export const CHEAP_BUILDER = 'haiku';
const WF = (kind, builder) => ({ cls: 'workflow', kind, builder, ...(builder === CHEAP_BUILDER ? {} : { ceiling: true }) });
/**
 * Mode registry in the shape metrics.needTable takes. cls is the binary need class; JIT is counted as workflow (an assumption, stated in the report).
 * `ceiling: true` marks an arm that DESIGN §2 admits to L_ceiling only, derived from `builder` by the rule above (hand-H and hand-S run the workflow an
 * Opus agent hand-wrote after studying the family, P1_HAND_AUTHORING; wf-O and script-O are built by an Opus builder, jit-OH compiled by Opus, jit-SH by
 * Sonnet). L_today uses the cheap-builder workflow modes only (labelSetModes drops the ceiling arms). No LEGACY mode carries
 * `prebuilt`: that flag switches off metrics.needTable's guard against a built or guided mode with no build row, so a mode whose build was paid
 * for must be charged (the guard is what caught the missing P1 authoring cost).
 */
export const LEGACY_REGISTRY = Object.freeze({
  'direct-H': { cls: 'no-workflow', kind: 'none' }, 'direct-H-med': { cls: 'no-workflow', kind: 'none' }, 'direct-H-notes': { cls: 'no-workflow', kind: 'none' },
  'direct-H45': { cls: 'no-workflow', kind: 'none' }, 'direct-S': { cls: 'no-workflow', kind: 'none' },
  'agent-H': { cls: 'no-workflow', kind: 'none' }, 'agent-S': { cls: 'no-workflow', kind: 'none' }, 'agent-O': { cls: 'no-workflow', kind: 'none' },
  'hand-H': WF('guided', 'opus'), 'hand-S': WF('guided', 'opus'),
  'wf-H': WF('built', 'haiku'), 'wf-O': WF('built', 'opus'),
  'script-H': WF('built', 'haiku'), 'script-O': WF('built', 'opus'), 'static-b1h': WF('built', 'haiku'),
  'jit-HH': WF('jit', 'haiku'), 'jit-OH': WF('jit', 'opus'), 'jit-SH': WF('jit', 'sonnet'),
});
/** The workflow modes of a registry grouped by the model that wrote their workflow (the field the ceiling rule reads): { cheapBuilder, byBuilder: { haiku: [...], opus: [...], sonnet: [...] } }. */
export function ceilingRule(registry = LEGACY_REGISTRY) {
  const byBuilder = {};
  for (const [mode, info] of Object.entries(registry)) if (info.cls === 'workflow') (byBuilder[info.builder] ??= []).push(mode);
  return { cheapBuilder: CHEAP_BUILDER, ceilingBuilders: Object.keys(byBuilder).filter(b => b !== CHEAP_BUILDER).sort(), byBuilder: Object.fromEntries(Object.entries(byBuilder).sort()) };
}
/** The label-set views of a LEGACY job's modes (DESIGN §2): L_today leaves out the ceiling arms (workflows written by a frontier model or a person),
 *  L_ceiling keeps everything. `vacuous`: L_today has no workflow-class mode, so its label can only be `no-workflow` and says nothing about need. */
export function labelSetsOf(modes, registry = LEGACY_REGISTRY) {
  const today = labelSetModes(modes, 'today', registry), ceiling = labelSetModes(modes, 'ceiling', registry);
  const wf = ms => ms.filter(m => classOf(m, registry) === 'workflow');
  return { today: { modes: today, workflowModes: wf(today), vacuous: wf(today).length === 0 }, ceiling: ceiling.length > today.length ? { modes: ceiling, workflowModes: wf(ceiling), extra: ceiling.filter(m => !today.includes(m)) } : null };
}

/**
 * What the P1 hand workflow (hand-H on Haiku 5.5, hand-S on Sonnet 5.5) cost to write: the records-v3 development calls, 6,752 of them on
 * Haiku 4.5, Haiku 5.5 and Sonnet, at least $24.91 (a lower bound: the Opus agent time that wrote the workflow is unpriced). The figure is in the
 * README cost ledger (README.md:307, "records-v3 hand-workflow development for P1") and is quoted in
 * research/jit-20261008/handoff/workflows/wf_59e7734e-82b.md:98; research/core-20261006/REPORT.md does not contain it (it says only that an Opus
 * agent hand-wrote the workflow, a ceiling). It is a fixed build cost B in DESIGN §2's utility (-B/(N V)): leaving it out made the P1 label
 * `workflow` at every N. Each hand mode is charged the whole of it, because a user who deploys that mode alone pays for the workflow in full.
 */
export const P1_HAND_AUTHORING = Object.freeze({
  usd: 24.91, lowerBound: true, calls: 6752, modes: Object.freeze(['hand-H', 'hand-S']),
  source: 'README.md:307 (cost ledger, 2026-10-07: records-v3 hand-workflow development for P1; also research/jit-20261008/handoff/workflows/wf_59e7734e-82b.md:98)',
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
/** The JIT stream experiments the diagnostics read: the job ids of the `jit` definitions (each job id is its experiment directory under runs/). */
export const JIT_EXPERIMENTS = Object.freeze(LEGACY_JOB_DEFS.filter(d => d.kind === 'jit').map(d => d.id));

/**
 * Schema validity of an archived answer, RECONSTRUCTED from the oracle's own record: the oracle details say `reason: 'schema-invalid'` when its schema check
 * failed. Schema validity is a deployable signal in principle (a user can run a schema check), but no archived row stored one, so this is read back from
 * the oracle record and is only as good as it. A row without oracle details has no such record: null (not recorded), never "valid". D3 skips a post-hoc
 * signal that any row of a group lacks; the label matrix reads null as schema-valid, which is what a row with no schema field has always meant there.
 */
export const schemaValidOf = details => (details && typeof details === 'object' ? details.reason !== 'schema-invalid' : null);
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
    experiment: r.experiment, arm: r.arm, mode, model: AGENT_MODEL[r.arm] ?? null, family: r.family, taskKey: r.taskKey, taskHash: r.taskHash, trial: r.trial ?? 0,
    unit: `${r.taskKey}#t${r.trial ?? 0}`, seed: seedOf(r.taskKey), difficulty: diffOf(r.taskKey),
    pass: r.pass === true, score: typeof r.score === 'number' ? r.score : null,
    delivered: code === null, schemaValid: schemaValidOf(details), error: code,
    usdReported, usdImputed: imputed, costUnknown: !!r.costUnknown, latencyMs: r.latencyMs ?? null, at: r.at ?? null,
    turns: r.meta?.turns ?? null, tools: r.meta?.tools ?? null, calls: r.meta?.calls ?? null, escalations: r.meta?.escalations ?? null,
    verdict: r.meta?.verdict ?? null, tokensOut: r.meta?.tokensOut ?? null, streamUsage: r.meta?.streamUsage ?? null,
    details,
  };
}

/** Count of rows per arm in `unmapped`, and the total, for an arm that is in no mode table (review of 2026-10-15: they used to vanish without a trace). */
const countBy = (items, keyOf) => items.reduce((a, x) => { const k = keyOf(x); a[k] = (a[k] ?? 0) + 1; return a; }, {});
export function loadRunFile(name, modes, opts = {}) {
  const { file, rescued, exists } = archivePath(name, opts);
  if (rescued === false && !exists) return { rows: [], source: null, rescued: false, missing: name, read: 0, unmapped: {} };
  const source = rel(file), raw = readJsonl(file);
  const rows = raw.map(r => normaliseRunRow(r, { modes, source })).filter(Boolean);
  // A row of an arm with no mode mapping is dropped by normaliseRunRow; the loader counts what it dropped, per arm, so the next archive cannot lose rows silently.
  return { rows, source: sourceOf(file), rescued, read: raw.length, unmapped: countBy(raw.filter(r => !modes[r.arm]), r => String(r.arm)) };
}

/** C0 construction costs per (family, mode): the build of the workflow or solver (constructions.jsonl, one row each). */
export function loadConstructions(opts = {}) {
  const { file, rescued, exists } = archivePath('c0-dev/constructions.jsonl', opts);
  if (rescued === false && !exists) return { builds: [], source: null, rescued: false, read: 0, unmapped: {} };
  const raw = readJsonl(file);
  const builds = raw.map(c => ({
    family: c.familyId, mode: C0_MODES[c.armId], armId: c.armId, usd: c.constructionCostUsd, builderCostUsd: c.builderCostUsd, gatewayCostUsd: c.gatewayCostUsd,
    builderUsage: c.builderUsage ?? null, builderStreamUsage: c.builderStreamUsage ?? null, builderModel: c.builderModel, label: c.label,
  })).filter(b => b.mode);
  return { builds, source: sourceOf(file), rescued, read: raw.length, unmapped: countBy(raw.filter(c => !C0_MODES[c.armId]), c => String(c.armId)) };
}

/** The archive files some loader reads (relative to the archive directory); any other JSONL in the archive is rescued but not used. */
export const ARCHIVE_READS = Object.freeze(['p1/results.jsonl', 'c0-dev/results.jsonl', 'c0-dev/constructions.jsonl']);
/** JSONL files in the rescued archive that no diagnostic reads: [{ path (relative to the archive), lines }] (c0-dev/probes.jsonl today). */
export function rescuedNotUsed(archiveDir = ARCHIVE_DIR) {
  const out = [];
  const walk = d => {
    for (const n of listDir(d).sort()) {
      const f = path.join(d, n);
      let st; try { st = statSync(f); } catch { continue; }
      if (st.isDirectory()) walk(f);
      else if (n.endsWith('.jsonl')) { const p = path.relative(archiveDir, f).split(path.sep).join('/'); if (!ARCHIVE_READS.includes(p)) out.push({ path: p, lines: readFileSync(f, 'utf8').split('\n').filter(l => l.trim()).length }); }
    }
  };
  walk(archiveDir);
  return out;
}

/** The arm definition a stream arm ran with (arm.json `def`: perTaskUsd, agentBudgetUsd, ... plus the arm's `kind`), or null. */
export function loadArmDef(root, experiment, armDir) {
  try { const a = JSON.parse(readFileSync(path.join(root, experiment, armDir, 'arm.json'), 'utf8')); return a.def ? { ...a.def, kind: a.kind ?? null } : null; } catch { return null; }
}
/**
 * The per-task dollar bound of a stream row whose cost was not observed (DESIGN §2: killed sessions are charged at their bound). A row that ran an agent
 * session (an `interpret` event, or any agent arm) is bounded by the arm's `agentBudgetUsd`; a row that only called the gateway by its `perTaskUsd`.
 * Returns { usd, field } or null when the arm definition is missing.
 */
export function jitRowBound(def, row) {
  if (!def) return null;
  const agent = def.kind === 'agent' || (row.events ?? []).some(e => e?.kind === 'interpret');
  const field = agent && Number.isFinite(def.agentBudgetUsd) ? 'agentBudgetUsd' : Number.isFinite(def.perTaskUsd) ? 'perTaskUsd' : null;
  return field ? { usd: def[field], field } : null;
}

/** JIT streams as normalised rows, with the harvest's fixed costs and pairing report. `rows` are the paired rows (what the label
 *  tables use); `allRows` are every stream row, with the committed agent trace joined by traceId (turns, tools, stream usage, model).
 *  A row flagged costUnknown is imputed up to its arm's per-task bound exactly as normaliseRunRow does for P1 and C0 rows
 *  (usdImputed = bound - recorded, floored at 0); `job.costNotes` lists each such row. */
export function loadJitJobs(root = JIT_RUNS_DIR, { experiments = JIT_EXPERIMENTS } = {}) {
  if (!existsSync(root)) return { jobs: new Map(), sources: [], skipped: [] };
  // Only the experiments the LEGACY job definitions name are opened. Any other directory under the runs root (a held-out stream committed there later, a
  // new dev experiment) is listed in `skipped` and never read, hashed or fed to a diagnostic: the allow-list is the seed gate for the loader, and D3's
  // assertArchivedSeeds still refuses a task whose seed the ledger reserves for another purpose.
  const present = listDir(root).filter(n => { try { return statSync(path.join(root, n)).isDirectory(); } catch { return false; } }).sort();
  const skipped = present.filter(n => !experiments.includes(n)).map(experiment => ({ experiment, reason: 'not a LEGACY job definition (legacy.mjs LEGACY_JOB_DEFS): not read' }));
  const streams = readStreams(root, { only: experiments });
  const h = harvest(streams);
  const pairedKeys = new Set(h.rows.map(x => `${x.family}\u0000${x.mode}\u0000${x.task}`));
  const jobs = new Map();
  for (const s of streams) {
    const job = jobs.get(s.family) ?? jobs.set(s.family, { rows: [], allRows: [], builds: [], report: null, sources: new Set(), costNotes: [] }).get(s.family);
    job.sources.add(s.source);
    const armDir = path.basename(path.dirname(s.source)), def = loadArmDef(root, s.family, armDir);
    for (const r of s.rows) {
      const details = parseDetails(r.oracleDetails);
      const fixedUsd = Object.entries(r.costBreakdown ?? {}).filter(([k]) => FIXED_COMPONENTS.has(k)).reduce((a, [, v]) => a + v, 0);
      const trace = r.traceId ? loadJitTrace(root, s.family, armDir, r.traceId) : null;
      const usdReported = Math.max(0, r.costUsd - fixedUsd) + (r.orphanUsd ?? 0);
      const bound = r.costUnknown ? jitRowBound(def, r) : null;
      const usdImputed = bound ? Math.max(0, bound.usd - usdReported) : 0;
      const paired = pairedKeys.has(`${s.family}\u0000${s.mode}\u0000${r.taskKey}`);
      const row = {
        ...LEGACY_TAG, source: s.source, experiment: s.family, arm: armDir, mode: JIT_MODES[s.mode] ?? s.mode, model: trace?.model ?? null,
        family: String(r.taskKey).split(':')[0], taskKey: r.taskKey, taskHash: r.taskHash, trial: 0, unit: r.taskKey, seed: r.seed ?? seedOf(r.taskKey), difficulty: r.difficulty ?? diffOf(r.taskKey),
        pass: r.pass === true, score: typeof r.score === 'number' ? r.score : null, delivered: errCode(r.error) === null, schemaValid: schemaValidOf(details),
        error: errCode(r.error), usdReported, usdImputed, costUnknown: !!r.costUnknown, ...(bound ? { boundUsd: bound.usd } : {}), latencyMs: r.latencyMs ?? null, at: r.at ?? null,
        turns: trace?.turns ?? null, tools: trace?.tools ?? null, calls: null, escalations: null, verdict: null, tokensOut: null, streamUsage: trace?.streamUsage ?? null, details,
        traceId: r.traceId ?? null, deliveredBy: r.delivered ?? null, traceCostUsd: trace?.costUsd ?? null,
      };
      job.allRows.push(row);
      if (paired) job.rows.push(row);
      if (r.costUnknown) {
        const why = !bound ? 'no arm.json definition, so no bound: booked as recorded'
          : usdImputed > 0 ? `imputed $${usdImputed.toFixed(3)} up to the $${bound.usd} per-task bound (arm.json ${bound.field})`
            : `already at or above the $${bound.usd} per-task bound (arm.json ${bound.field}), nothing to impute`;
        job.costNotes.push(`${s.family} ${JIT_MODES[s.mode] ?? s.mode} ${r.taskKey}: costUnknown, recorded $${usdReported.toFixed(3)}; ${why}${paired ? '' : ' (outside the paired set)'}`);
      }
    }
  }
  for (const f of h.fixed) if (f.fixedUsd > 0) jobs.get(f.family).builds.push({ mode: JIT_MODES[f.mode] ?? f.mode, usd: f.fixedUsd, source: f.streamSource });
  for (const rep of h.report) jobs.get(rep.family).report = rep;
  for (const j of jobs.values()) { j.sources = [...j.sources].sort(); j.costNotes.sort(); }
  return { jobs, sources: [...new Set(h.report.flatMap(r => r.sources))].sort(), skipped };
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
 * Every archived LEGACY job, paired. Returns { jobs: [{id, kind, family, oracle, rows, builds, pairing, harvest, sources}], sources, notes }.
 * Builds: JIT compile components and external builds from harvest; C0 constructions; for P1 the hand-workflow authoring cost
 * (P1_HAND_AUTHORING, at least $24.91), charged in full to each hand mode. `harvest` carries the stream harvest's pairing report (tasks, paired,
 * dropped modes, notes such as the tasks a mode ran outside the paired set) so the report can show what pairing dropped. `notes` lists every
 * input that could not be loaded, every job that yielded no rows, and every stream row whose unobserved cost was imputed.
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
  // Rows of an arm with no mode mapping are dropped by the loaders; each file's count is a note, and the report prints the accounting (read, dropped) either way.
  const accounting = [['p1/results.jsonl', p1, 'P1_MODES'], ['c0-dev/results.jsonl', c0, 'C0_MODES'], ['c0-dev/constructions.jsonl', cons, 'C0_MODES']].map(([label, x, table]) => {
    const dropped = Object.values(x.unmapped ?? {}).reduce((a, n) => a + n, 0);
    if (dropped) notes.push(`${label}: ${dropped} of ${x.read} rows are from arm(s) with no mode mapping (${Object.entries(x.unmapped).sort().map(([a, n]) => `${a} ${n}`).join(', ')}; legacy.mjs ${table}) and are dropped from every diagnostic`);
    return { file: label, read: x.read ?? 0, dropped, byArm: x.unmapped ?? {} };
  });
  const unused = rescuedNotUsed(archiveDir);
  for (const f of unused) notes.push(`${f.path}: rescued (${f.lines} lines) into the archive but no diagnostic reads it`);
  const jit = loadJitJobs(jitRoot);
  for (const k of jit.skipped) notes.push(`${k.experiment}: skipped, ${k.reason}`);
  for (const def of LEGACY_JOB_DEFS) {
    let rows = [], allRows = null, builds = [], jobSources = [], harvestReport = null, costNotes = [];
    if (def.kind === 'p1') {
      rows = p1.rows; jobSources = p1.source ? [p1.source.path] : [];
      builds = P1_HAND_AUTHORING.modes.map(mode => ({ mode, usd: P1_HAND_AUTHORING.usd, lowerBound: P1_HAND_AUTHORING.lowerBound, source: P1_HAND_AUTHORING.source }));
    } else if (def.kind === 'c0') {
      rows = c0.rows.filter(r => r.experiment === def.experiment);
      builds = cons.builds.filter(b => b.family === def.family).map(b => ({ mode: b.mode, usd: b.usd, source: cons.source?.path }));
      jobSources = [c0.source?.path, cons.source?.path].filter(Boolean);
    } else {
      const j = jit.jobs.get(def.id);
      if (j) { rows = j.rows; allRows = j.allRows; builds = j.builds; jobSources = j.sources; costNotes = j.costNotes;
        // harvest.mjs says "booked as recorded" of a costUnknown row; this loader imputes it to the arm bound (costNotes), so that line is replaced by the cost note.
        harvestReport = j.report ? { tasks: j.report.tasks, paired: j.report.paired, modes: j.report.modes, dropped: j.report.dropped, notes: j.report.notes.filter(n => !/costUnknown \(booked as recorded\)/.test(n)) } : null; }
    }
    if (!rows.length) { notes.push(`${def.id} (${def.kind}): no rows in this container, so the job is skipped and no diagnostic reads it`); continue; }
    const paired = pairJob(rows);
    const kept = new Set(paired.report.modes);
    notes.push(...costNotes);
    jobs.push({ ...def, rows: paired.rows, allRows: allRows ?? rows, builds: builds.filter(b => kept.has(b.mode)), pairing: paired.report, harvest: harvestReport, sources: jobSources });
  }
  if (jit.sources.length) sources.push(...jit.sources.map(p => sourceOf(p, { rescued: true })));
  return { jobs, sources, notes, skipped: jit.skipped, accounting, rescuedNotUsed: unused };
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
