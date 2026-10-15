// Need router v1 evaluator (research/need-router-20261014/DESIGN.md §5, §6; PREREG-SKELETON.md §7-§10). $0: pure scoring
// over a label matrix, no model calls. It fits label-free policies on TRAIN jobs, decides every evaluation job and cell,
// and scores the decisions against the paired labels (metrics.mjs), with the baselines, the exact sign-flip test, the
// preregistered readings, the leak tests L1-L8, the metamorphic attacks, the power simulation and the sealed envelope.
//
//   node experiments/need-router/evaluate.mjs --labels research/need-router-20261014/runs --split <train|heldout> \
//        --report research/need-router-20261014/analysis/<id>/ [--router <module>] [--decisions <committed.json>] \
//        [--reps 2000] [--boot 10000] [--perms 1000] [--seed 1] [--label-set today|ceiling]
//   node experiments/need-router/evaluate.mjs --labels <dir> --commit-decisions <out.json> [--router <module>]
//   node experiments/need-router/evaluate.mjs --power [--sims 2000] [--json]
//
// --split train is the development reading: leave-one-cluster-out over TRAIN clusters (each fold fits on the other
// clusters' rows only and decides the held-out one; its SBS is chosen on the same training clusters); it loads TRAIN rows
// only. --split heldout (sealed, e2e) needs --decisions: it fits on TRAIN rows only, scores the sealed decisions and
// checks them against that fit (L6); the split's own rows are only scored, never fitted on. Forced jobs (a typed hard
// requirement) are their own stratum, never primary. Every declared job of the split that lacks rows or a declared mode
// is dropped and listed (PREREG §5); a masked mode gets the pre-registered substitute, counted (PREREG §7).
//
// Policies see a PUBLIC VIEW of a job only: an opaque id, the 8 trusted structure features, the typed hard
// requirements, the declared verifier and the modes the job can run. Never the family id, bed version, `kind`, the task
// text, any label or result. Shortcut baselines (keyword, NONE_RULE, kind-only, family-identity) are declared as such and
// also get a SHORTCUT VIEW (family, kind, text, prose counts); a policy that is not declared a shortcut never does.
// Recorded policies (judge-H, NR-probe, NR-probe-oracle) are read from decisions.jsonl, with their routing dollars.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { canonical, sha256 } from '../../beds/lib/canonical.mjs';
import { holm, clopperPearson } from '../lib/stats-ebed.mjs';
import { wilson } from '../lib/stats.mjs';
import { NONE_RULE } from '../library/construct.mjs';
import { REQUIREMENT_LIBRARY } from '../../src/construction-objective.mjs';
import { loadLedger, seedRefusals } from '../jit/seeds.mjs';
import { WHITELIST } from './features.mjs';
import {
  rng, hashString, MODES, CASCADES, GRID, HEADLINE, SLIDER_CELLS, V_GRID, FIRST_PASS, makeCell, cellKey, classOf, modeInfo, labelSetModes,
  withCascades, withoutSelfCheckCredit, needLabels, rankModes, bestOf, sbsGlobal, coverage, fragility, selfTestRates, envFaults,
  signFlipTest, clusterBootstrapDelta, firstPassShort,
} from './metrics.mjs';
import { balancedAccuracyInterval, c7aReading, thetaFitStatus, missingDataRule } from './prereg-rules.mjs';
import { aFreezeShas, gitHistory, PREREG_FILE } from './prereg-check.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

/** The router's trusted structure features (DESIGN §1): the 12-key census whitelist minus the four prose counts. */
export const TRUSTED_FEATURES = Object.freeze(['logInputTokens', 'logSchemaLeaves', 'itemLists', 'maxListLength', 'freeText', 'multiSource', 'conventionsInProse', 'verifiable']);
/** Prose counts of untrusted task text: inputs to the keyword baseline only. */
export const PROSE_FEATURES = Object.freeze(['effectVerbs', 'timeWords', 'humanWords', 'promptWords']);
export const MIN_USEFUL = 0.03;                     // minimum useful effect, success-equivalents per task (decision 1)
export const CO_PRIMARY = Object.freeze(['NR-static', 'NR-probe']);
export const N1 = makeCell(1, 1, 1);                // the intrinsic-need reading (C7a): V = $1, W = V, N = 1
export const SEED_RANGES = Object.freeze({ example: [601, 609], train: [610, 650], heldout: [8801, 8824], e2e: [8825, 8836], drift: [8837, 8848], sealed: null });
export const MATRIX_FORMAT = `A labels root holds one directory per stage (or is one): jobs.json, matrix.jsonl, builds.jsonl, decisions.jsonl.
jobs.json      { "<job>": { cluster, split: train|heldout|sealed|e2e, family, kind?, band?, forced?, near?, features: {<8 trusted keys>, <prose keys>?},
                 requirements?: [typed hard requirements], verifier?, modes?|masked? (the declared menu), text?, paraphrases?, exampleSeeds (L4), exampleHashes?,
                 tolerance?: { scoreThreshold }, metamorph?: { of: <job>, expect: same|different } } }   (label-free; written before labels)
matrix.jsonl   (or label-run's rows.jsonl; never both) one row per job x mode x task x replicate: { job, mode, task, rep, seed, taskHash, pass, delivered, schemaValid,
                 selfVerdict, deployableVerdict, score?, passAt?, usdRepriced (required: one meter), usdReported, usdImputed, repriced, armHash, void?, ms, tokens,
                 error, at?, stamp? }   (metrics.mjs needTable: LEGACY rows refused, one armHash per (job, mode), repriced: false leaves the job unlabelled,
                 one stamp.settingsSha per (job, mode) and one stamp.priceTable per table)
builds.jsonl   (builds.final.jsonl preferred) one row per job x built/guided mode x lineage: { job, mode, rep, usdRepriced (or usd, equal; required: one meter), usdImputed?,
                 repriced?, failed, minutes, artifactSha, runSolverCalls, hiddenPathAttempts, nestedModelAttempts, scoreChecks, probeSeeds, stamp? }
decisions.jsonl recorded policies: { policy: judge-H|NR-probe|NR-probe-oracle, job, cell: <cell key>|null, mode, routingUsd (required), pred?: {p, usd}, needsWorkflow?,
                 probe?: { ran, modes, k, costUsd } }   (an NR-probe decision is charged at least the dollars of the job's probe rows it used)
probes.jsonl   label-run's NR-probe rows: { job, mode, draw, usdRepriced, usdImputed, ... } (deployable signals only)
report.json    label-run's stage report (its priceTable id: one meter across every stage); STAMP.json the stage's engine stamp (PREREG §4.4)`;

const avg = xs => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);
const opaque = id => `j${createHash('sha256').update(String(id)).digest('hex').slice(0, 12)}`;

// ----------------------------------------------------------------------------------------------------------- loading
const readJsonl = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map((l, i) => { try { return JSON.parse(l); } catch { throw new Error(`${file}:${i + 1}: not JSON`); } }) : []);

/**
 * Read a labels root. trainOnly (the sealed envelope, L6, and the development split): matrix, build and probe rows of
 * non-TRAIN jobs are never kept, and a stage directory without a TRAIN job is not opened beyond its jobs.json and
 * decisions.jsonl (label-free files). Each stage's price-table id (label-run report.json) and engine stamp (STAMP.json) are
 * returned in `stageInfo`. A stage holding both matrix.jsonl and rows.jsonl is refused. label-run's per-arm environment-fault
 * table (arm-faults.jsonl: trial and build attempts and faults per job and mode, K4) is returned in `armFaults`: rows.jsonl
 * never holds a faulted attempt, so the table is the only place an arm over the 25% limit shows.
 */
export function loadLabels(root, { trainOnly = false } = {}) {
  const dirs = existsSync(path.join(root, 'jobs.json')) ? [root]
    : readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => path.join(root, d.name)).filter(d => existsSync(path.join(d, 'jobs.json'))).sort();
  const meta = {}, rows = [], builds = [], decisions = [], probes = [], stageInfo = [], skipped = { stages: [], rows: 0 }, stages = [], armFaults = [];
  const readJsonIf = f => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
  for (const dir of dirs) {
    const J = JSON.parse(readFileSync(path.join(dir, 'jobs.json'), 'utf8'));
    for (const [id, m] of Object.entries(J)) {
      if (meta[id] && canonical(meta[id]) !== canonical(m)) throw new Error(`job ${id} is described differently in two stages`);
      meta[id] = m;
    }
    decisions.push(...readJsonl(path.join(dir, 'decisions.jsonl')));
    const hasTrain = Object.values(J).some(m => m.split === 'train');
    if (trainOnly && !hasTrain) { skipped.stages.push(path.relative(ROOT, dir)); continue; }
    stages.push(path.relative(ROOT, dir));
    // label-run.mjs --out names: rows.jsonl (matrix rows) and builds.final.jsonl (its builds.jsonl is the append log).
    const twoMatrices = ['matrix.jsonl', 'rows.jsonl'].filter(n => existsSync(path.join(dir, n)));
    if (twoMatrices.length > 1) throw new Error(`${path.relative(ROOT, dir)}: both matrix.jsonl and rows.jsonl exist; keep one (which file holds the labels must not be a silent choice)`);
    const pick = names => names.map(n => path.join(dir, n)).find(f => existsSync(f)) ?? path.join(dir, names[0]);
    for (const [file, out] of [[pick(['matrix.jsonl', 'rows.jsonl']), rows], [pick(['builds.final.jsonl', 'builds.jsonl']), builds], [path.join(dir, 'probes.jsonl'), probes]]) for (const r of readJsonl(file)) {
      if (trainOnly && meta[r.job]?.split !== 'train') { skipped.rows += 1; continue; }
      out.push(r);
    }
    armFaults.push(...readJsonl(path.join(dir, 'arm-faults.jsonl')).filter(r => !trainOnly || meta[r.job]?.split === 'train'));
    const rep = readJsonIf(path.join(dir, 'report.json')), stamp = readJsonIf(path.join(dir, 'STAMP.json')), launch = readJsonIf(path.join(dir, 'LAUNCH.json'));
    // LAUNCH.json (label-run, written before the first paid call): the launch time and the envelopes the stage launched against (L6).
    stageInfo.push({ stage: path.basename(dir), splits: [...new Set(Object.values(J).map(m => m.split))].sort(), priceTable: rep?.priceTable ?? null,
      stamp: stamp ? sha256(canonical(stamp)) : null, launchedAt: launch?.launchedAt ?? null, launchEnvelopes: launch?.envelopes ?? [] });
  }
  return { meta, rows, builds, decisions, probes, stageInfo, stages, skipped, armFaults };
}

// ------------------------------------------------------------------------------------------------------------- views
/** What a policy may see of a job (label-free, identity-free). */
export function publicView(job, meta, modes) {
  const f = meta?.features ?? {};
  return Object.freeze({
    id: opaque(job), features: Object.freeze(Object.fromEntries(TRUSTED_FEATURES.filter(k => Number.isFinite(f[k])).map(k => [k, f[k]]))),
    requirements: Object.freeze([...(meta?.requirements ?? [])]), verifier: meta?.verifier ?? null, modes: Object.freeze([...modes]),
  });
}
/** The public view plus the identity and text fields that only declared shortcut baselines may read. */
export function shortcutView(job, meta, modes) {
  const f = meta?.features ?? {};
  return Object.freeze({ ...publicView(job, meta, modes), family: meta?.family ?? null, kind: meta?.kind ?? null, text: meta?.text ?? null,
    prose: Object.freeze(Object.fromEntries(PROSE_FEATURES.filter(k => Number.isFinite(f[k])).map(k => [k, f[k]]))) });
}
const isForced = m => !!m?.forced || (m?.requirements?.length ?? 0) > 0;

// ------------------------------------------------------------------------------------------------ menus (PREREG §5, §7)
/** A job's declared menu: jobs.json `modes`, else every non-ceiling base mode of the registry; minus `masked`. */
export function declaredMenu(m, registry = MODES) {
  const base = Object.keys(registry).filter(k => !registry[k].ceiling);
  return (Array.isArray(m?.modes) ? m.modes : base).filter(x => !(m?.masked ?? []).includes(x));
}
/** The modes a job may be routed to, in `modes` order: a base mode on its menu, or a cascade whose two modes both are. */
export function menuOf(m, modes, registry = MODES) {
  const menu = declaredMenu(m, registry);
  return modes.filter(x => { const i = x.indexOf('->'); return i > 0 ? menu.includes(x.slice(0, i)) && menu.includes(x.slice(i + 2)) : menu.includes(x); });
}
/**
 * Pairing screen before the paired build (PREREG §5 missing data): a job whose rows cannot be paired (a mode without a row
 * on some of the job's tasks, a live lineage with tasks missing, a built mode with build rows but no task rows, build rows
 * with no task rows at all: a stage stopped at its cap, a crashed arm) is set aside with the gap named, instead of making
 * needTable throw for the whole evaluation. Its rows and builds are kept by the caller and reported, never scored.
 * Malformed rows (unknown modes, a lineage row without a build row) still throw in needTable.
 */
export function pairable(rows, builds = []) {
  const K = (j, m) => `${j}\u0000${m}`, repOf = x => x.rep ?? x.replicate ?? x.lineage ?? x.trial ?? 0;
  const dead = b => b.failed || !!b.void || (b.hiddenPathAttempts ?? 0) > 0 || (b.nestedModelAttempts ?? 0) > 0;
  const lin = new Map(), tasks = new Map(), cover = new Map(), modesOf = new Map();
  const note = (j, m) => { if (!modesOf.has(j)) modesOf.set(j, new Set()); modesOf.get(j).add(m); };
  for (const b of builds) { const m = b.mode ?? b.arm, L = lin.get(K(b.job, m)) ?? new Map(); L.set(repOf(b), b); lin.set(K(b.job, m), L); note(b.job, m); }
  for (const r of rows) {
    const m = r.mode ?? r.arm, t = r.task ?? r.taskKey, k = K(r.job, m);
    if (!tasks.has(r.job)) tasks.set(r.job, new Set());
    tasks.get(r.job).add(t); note(r.job, m);
    const byRep = cover.get(k) ?? new Map(); if (!byRep.has(repOf(r))) byRep.set(repOf(r), new Set()); byRep.get(repOf(r)).add(t); cover.set(k, byRep);
  }
  const gaps = new Map();
  for (const [j, ms] of modesOf) {
    const T = tasks.get(j);
    if (!T) { gaps.set(j, `no rows (${builds.filter(b => b.job === j).length} build row(s) kept)`); continue; }
    const why = [];
    for (const m of ms) {
      const L = lin.get(K(j, m)), byRep = cover.get(K(j, m)) ?? new Map();
      if (L) {
        for (const [rep, b] of L) { if (dead(b)) continue; const c = byRep.get(rep)?.size ?? 0; if (c < T.size) why.push(`${m} lineage ${rep}: rows for ${c} of ${T.size} tasks`); }
      } else {
        const c = new Set([...byRep.values()].flatMap(x => [...x])).size;
        if (c < T.size) why.push(`${m}: rows for ${c} of ${T.size} tasks`);
      }
    }
    if (why.length) gaps.set(j, why.join('; '));
  }
  return { rows: rows.filter(r => !gaps.has(r.job)), builds: builds.filter(b => !gaps.has(b.job)), gaps };
}

/**
 * The missing-data rule (PREREG §5; prereg-rules.mjs missingDataRule) over the declared jobs of a population: a job with
 * no rows, or missing any non-ceiling mode of its declared menu (no rows for it, or short of its first-pass replicates or
 * lineages), leaves the population and is listed with its missing modes and the reason. A job with rows for a non-ceiling
 * mode its menu does not declare (a masked mode, say) throws: that is a data error, not missing data.
 */
export function missingData(table, jobs, meta, { registry = MODES, firstPass = FIRST_PASS, gaps = new Map() } = {}) {
  const items = [], why = new Map();
  for (const j of jobs) {
    const menu = declaredMenu(meta[j], registry), required = menu.filter(m => !modeInfo(m, registry).ceiling);
    if (!table.jobs.includes(j)) { items.push({ id: j, cluster: meta[j]?.cluster ?? null, required, present: [] }); why.set(j, gaps.get(j) ?? 'no rows'); continue; }
    const present = table.modesOf(j).filter(m => !modeInfo(m, registry).cascade);
    const undeclared = present.filter(m => !modeInfo(m, registry).ceiling && !menu.includes(m));
    if (undeclared.length) throw new Error(`job ${j}: rows for ${undeclared.join(', ')}, which its jobs.json menu does not declare (modes/masked)`);
    const short = Object.fromEntries(required.map(m => [m, present.includes(m) ? firstPassShort(table, j, m, firstPass) : 'no rows']).filter(([, r]) => r));
    items.push({ id: j, cluster: meta[j]?.cluster ?? null, required, present: required.filter(m => !short[m]) });
    if (Object.keys(short).length) why.set(j, Object.entries(short).map(([m, r]) => `${m}: ${r}`).join('; '));
  }
  const r = missingDataRule(items);
  const dropped = r.dropped.map(d => ({ ...d, reason: why.get(d.job) }));
  return { kept: r.kept, dropped, line: `dropped ${dropped.length}: ${dropped.map(d => `${d.job} (${d.reason})`).join('; ') || 'none'}` };
}

// ------------------------------------------------------------------------------------------------- fitting helpers
/** The fitting context of a fold: TRAIN jobs only (optionally with their labels permuted, L2). */
export function makeContext(labels, trainJobs, meta, { modes, registry = MODES, permutation = null, evalPeek = null } = {}) {
  const src = j => (permutation ? permutation.get(j) ?? j : j);
  const train = trainJobs.map(j => {
    const avail = labels.modesOf(j).filter(m => modes.includes(m));
    return {
      view: publicView(j, meta[j], avail), sview: shortcutView(j, meta[j], avail), cluster: meta[j].cluster, modes: avail,
      u: (cell, m) => labels.u(src(j), cell, m), usd: (cell, m) => labels.usd(src(j), cell, m), s: m => labels.stats(src(j), m).s,
      label: cell => labels.at(src(j), cell),
    };
  });
  // SBS-train's ranking per cell (modes present in every TRAIN job, ties to the cheaper): the pre-registered substitute when a
  // policy's mode is masked on a job (PREREG §7 "Masked modes": the next mode of the TRAIN ranking for that cell).
  const ranks = new Map();
  const sbsRank = cell => {
    const k = cellKey(cell);
    if (!ranks.has(k)) {
      const ms = modes.filter(m => train.every(it => it.modes.includes(m)));
      ranks.set(k, rankModes(ms.map(m => ({ mode: m, u: avg(train.map(it => it.u(cell, m))), usd: avg(train.map(it => it.usd(cell, m))) }))));
    }
    return ranks.get(k);
  };
  return { train, modes, registry, classOf: m => classOf(m, registry), peek: evalPeek, sbsRank };
}

/**
 * The first of `prefs` that the job can run; else the pre-registered substitute (PREREG §7): the first available mode of
 * SBS-train's ranking for the cell, marked `fallback` so every substitution is counted and printed per policy.
 */
export function pickOrSubstitute(prefs, view, cell, ctx) {
  const m = prefs.find(x => view.modes.includes(x));
  if (m) return { mode: m };
  const sub = (ctx?.sbsRank?.(cell) ?? []).find(x => view.modes.includes(x)) ?? (ctx?.modes ?? []).find(x => view.modes.includes(x));
  if (!sub) throw new Error(`none of ${prefs.join(', ')} is available (${view.modes.join(', ')}) and no substitute is`);
  return { mode: sub, fallback: { from: prefs[0], to: sub, rule: 'SBS-train ranking (PREREG §7 masked modes)' } };
}

/**
 * Leaf calculator: per leaf and cell, TRAIN modes ranked by mean utility (ties to the cheaper); a leaf with no TRAIN job
 * falls back to every TRAIN job (the SBS). `complete` keeps only modes present in every job of the pool.
 * Returns (leaf, cell, available) -> { mode, pred: {p, usd}, leafSize }.
 */
export function leafChooser(ctx, leafOf, { cls = null, complete = false } = {}) {
  const groups = new Map();
  for (const it of ctx.train) { const k = leafOf(it); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
  const cache = new Map();
  return (leaf, cell, available) => {
    const own = groups.get(leaf), items = own?.length ? own : ctx.train, ck = `${own?.length ? leaf : '\u0000all'}|${cellKey(cell)}`;
    let r = cache.get(ck);
    if (!r) {
      const entries = ctx.modes.filter(m => !cls || ctx.classOf(m) === cls).map(m => {
        const xs = items.filter(it => it.modes.includes(m));
        if (!xs.length || (complete && xs.length < items.length)) return null;
        return { mode: m, u: avg(xs.map(it => it.u(cell, m))), usd: avg(xs.map(it => it.usd(cell, m))), p: avg(xs.map(it => it.s(m))) };
      }).filter(Boolean);
      r = { rank: rankModes(entries), by: new Map(entries.map(e => [e.mode, e])), size: own?.length ?? 0 };
      cache.set(ck, r);
    }
    const mode = r.rank.find(m => available.includes(m));
    if (!mode) throw new Error(`no available mode in leaf ${String(leaf)} (${available.join(', ')})`);
    const e = r.by.get(mode);
    // A masked top mode: the next mode of the leaf's own ranking (PREREG §7), marked so the fallback is counted.
    return { mode, pred: { p: e.p, usd: e.usd }, leafSize: r.size, ...(mode !== r.rank[0] ? { fallback: { from: r.rank[0], to: mode, rule: 'next mode of the leaf ranking (PREREG §7 masked modes)' } } : {}) };
  };
}

const balancedAccuracy = (pred, y) => {
  let tp = 0, tn = 0, pos = 0, neg = 0;
  pred.forEach((p, i) => { if (y[i]) { pos += 1; tp += p ? 1 : 0; } else { neg += 1; tn += p ? 0 : 1; } });
  return pos && neg ? (tp / pos + tn / neg) / 2 : pos ? tp / pos : neg ? tn / neg : 0;
};
export const isIntrinsic = (view, thresholds) => Object.entries(thresholds).some(([k, t]) => (view.features[k] ?? -Infinity) >= t);

/**
 * Fit an OR-of-thresholds rule (H0: logInputTokens >= θ_tok OR maxListLength >= θ_fan) to the confident N = 1 NEED
 * labels of the TRAIN jobs, maximising balanced accuracy. Candidates are +∞, the midpoints between adjacent TRAIN values
 * and the smallest value. Ties go to the rule with fewer workflow calls on TRAIN, then to the larger thresholds.
 */
export function fitRule(ctx, keys, { cell = N1 } = {}) {
  const conf = ctx.train.filter(it => it.label(cell).confident), y = conf.map(it => it.label(cell).label === 'workflow');
  const cands = keys.map(k => {
    const v = [...new Set(ctx.train.map(it => it.view.features[k]).filter(Number.isFinite))].sort((a, b) => a - b);
    return [Infinity, ...v.slice(1).map((x, i) => (x + v[i]) / 2).reverse(), ...(v.length ? [v[0]] : [])];
  });
  let best = null;
  const visit = (i, th) => {
    if (i === keys.length) {
      const pred = it => keys.some((k, j) => (it.view.features[k] ?? -Infinity) >= th[j]);
      const ba = balancedAccuracy(conf.map(pred), y), calls = ctx.train.filter(pred).length;
      if (!best || ba > best.ba + 1e-12 || (Math.abs(ba - best.ba) <= 1e-12 && calls < best.calls)) best = { ba, calls, th: [...th] };
      return;
    }
    for (const t of cands[i]) visit(i + 1, [...th, t]);
  };
  visit(0, []);
  return { thresholds: Object.fromEntries(keys.map((k, i) => [k, best.th[i]])), trainBalancedAccuracy: best.ba, confident: conf.length, workflowCalls: best.calls };
}

function standardizer(views, keys) {
  const mu = {}, sd = {};
  for (const k of keys) {
    const xs = views.map(v => v.features[k]).filter(Number.isFinite);
    mu[k] = xs.length ? avg(xs) : 0;
    sd[k] = xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - mu[k]) ** 2, 0) / (xs.length - 1)) || 1 : 1;
  }
  return v => keys.map(k => ((Number.isFinite(v.features[k]) ? v.features[k] : mu[k]) - mu[k]) / sd[k]);
}
function nearest(items, z, view, k) {
  const q = z(view);
  return items.map(it => ({ it, d: Math.hypot(...z(it.view).map((x, i) => x - q[i])) }))
    .sort((a, b) => a.d - b.d || (a.it.view.id < b.it.view.id ? -1 : 1)).slice(0, Math.min(k, items.length));
}

// ---------------------------------------------------------------------------------------------------------- policies
// A policy: { name, role, fit(ctx) -> choose(view, cell, shortcutView?) -> { mode, routingUsd?, needsWorkflow?, pred? } }.
// role: primary | secondary | baseline | shortcut | yardstick | control (L1) | optimistic (SBS chosen on the test set).

/** NR-static reference (DESIGN §3 stages 0-2): guard, structural rule, leaf calculator. router.mjs's frozen version replaces it via --router. */
export function nrStatic({ keys = ['logInputTokens', 'maxListLength'], name = 'NR-static', guard = true, role = 'primary' } = {}) {
  return {
    name, role, features: keys, reference: true,
    fit(ctx) {
      const rule = fitRule(ctx, keys), intrinsic = v => isIntrinsic(v, rule.thresholds);
      const leaf = leafChooser(ctx, it => (intrinsic(it.view) ? 'intrinsic' : 'not')), wf = leafChooser(ctx, () => 'all', { cls: 'workflow' });
      const choose = (view, cell) => {
        if (guard && view.requirements.length) {
          const r = wf('all', cell, view.modes);
          return { mode: r.mode, pred: r.pred, needsWorkflow: true, guard: { forced: true, requirement: view.requirements[0] }, ...(r.fallback ? { fallback: r.fallback } : {}) };
        }
        const k = intrinsic(view) ? 'intrinsic' : 'not', r = leaf(k, cell, view.modes);
        return { mode: r.mode, pred: r.pred, needsWorkflow: k === 'intrinsic', structure: { intrinsic: k === 'intrinsic' }, ...(r.fallback ? { fallback: r.fallback } : {}) };
      };
      choose.fitted = rule;
      return choose;
    },
  };
}
/** The tuned size rule: one token threshold fitted like H0, then the leaf calculator (no guard). */
export const tunedSizeRule = () => nrStatic({ keys: ['logInputTokens'], name: 'tuned-size-rule', guard: false, role: 'baseline' });
const tokensOf = v => 10 ** (v.features.logInputTokens ?? 0) - 1;
/** The fixed size rule: under 2K tokens direct-H, 2-30K agent-H, over 30K construct-H. */
export const fixedSizeRule = () => ({
  name: 'fixed-size-rule', role: 'baseline', fit: ctx => (view, cell) => {
    const t = tokensOf(view);
    return pickOrSubstitute(t < 2000 ? ['direct-H', 'agent-H'] : t <= 30000 ? ['agent-H'] : ['construct-H', 'agent-H'], view, cell, ctx);
  },
});
/** experiments/library/construct.mjs NONE_RULE: one call when size band S (< 2K tokens), lists <= 3, one source, no effect verb; else a workflow. */
export const noneRule = () => ({
  name: 'NONE_RULE', role: 'baseline', shortcut: true, fit: ctx => (view, cell, sv) => {
    const lists = Math.round(10 ** (view.features.maxListLength ?? 0) - 1);
    const none = tokensOf(view) < 2000 && lists <= NONE_RULE.maxListLength && !(view.features.multiSource > 0) && !(sv?.prose?.effectVerbs > 0);
    return pickOrSubstitute(none ? ['direct-H', 'agent-H'] : ['construct-H', 'agent-H+proc', 'agent-H'], view, cell, ctx);
  },
});
const CUES = REQUIREMENT_LIBRARY.filter(r => r.id !== 'verification');   // extractRequirements adds `verification` to every objective
/** Keyword router: a REQUIREMENT_LIBRARY cue in the task text (or a prose count when there is no text) -> construct-H; else the best TRAIN no-workflow mode. */
export const keywordRouter = () => ({
  name: 'keyword', role: 'baseline', shortcut: true, fit(ctx) {
    const nw = leafChooser(ctx, () => 'all', { cls: 'no-workflow' });
    return (view, cell, sv) => {
      const hits = sv?.text ? CUES.filter(r => r.cue.test(sv.text)).map(r => r.id) : [];
      const prose = sv?.text ? 0 : (sv?.prose?.effectVerbs ?? 0) + (sv?.prose?.timeWords ?? 0) + (sv?.prose?.humanWords ?? 0);
      if (hits.length || prose > 0) return { ...pickOrSubstitute(['construct-H', 'agent-H+proc'], view, cell, ctx), cues: hits };
      const r = nw('all', cell, view.modes);
      return { mode: r.mode, pred: r.pred, ...(r.fallback ? { fallback: r.fallback } : {}) };
    };
  },
});
/** A `kind`-only router: the leaf calculator over the bed kind (shortcut). */
export const kindRouter = () => ({
  name: 'kind-only', role: 'shortcut', shortcut: true, fit(ctx) {
    const leaf = leafChooser(ctx, it => it.sview.kind ?? '?');
    return (view, cell, sv) => { const r = leaf(sv?.kind ?? '?', cell, view.modes); return { mode: r.mode, pred: r.pred, ...(r.fallback ? { fallback: r.fallback } : {}) }; };
  },
});
/** Family identity (L3): the TRAIN best mode of the job's family; an unseen family gets SBS-train itself (complete pool, like SBS-train). */
export const familyIdentityRouter = () => ({
  name: 'family-identity', role: 'shortcut', shortcut: true, fit(ctx) {
    const leaf = leafChooser(ctx, it => it.sview.family ?? '?'), all = leafChooser(ctx, () => 'all', { complete: true });
    const seen = new Set(ctx.train.map(it => it.sview.family ?? '?'));
    return (view, cell, sv) => {
      const r = seen.has(sv?.family ?? '\u0000unseen') ? leaf(sv.family, cell, view.modes) : all('all', cell, view.modes);
      return { mode: r.mode, pred: r.pred, ...(r.fallback ? { fallback: r.fallback } : {}) };
    };
  },
});
/** Family-majority by nearest TRAIN cluster: the majority best mode of the cluster of the nearest TRAIN job (ties by that cluster's mean utility). */
export const familyMajority = () => ({
  name: 'family-majority', role: 'baseline', fit(ctx) {
    const z = standardizer(ctx.train.map(it => it.view), TRUSTED_FEATURES), byCluster = leafChooser(ctx, it => it.cluster);
    return (view, cell) => {
      const c = nearest(ctx.train, z, view, 1)[0].it.cluster, items = ctx.train.filter(it => it.cluster === c);
      const rank = byCluster(c, cell, view.modes), votes = new Map();
      for (const it of items) { const t = it.label(cell).top; if (view.modes.includes(t)) votes.set(t, (votes.get(t) ?? 0) + 1); }
      const top = Math.max(0, ...votes.values());
      const tied = [...votes].filter(([, n]) => n === top).map(([m]) => m);
      const mode = tied.length === 1 ? tied[0] : tied.includes(rank.mode) || !tied.length ? rank.mode : tied[0];
      return { mode, nearestCluster: c };
    };
  },
});
/** NR-knn reference (secondary 1): k nearest TRAIN jobs (k by leave-one-cluster-out on TRAIN), utility-weighted by 1/(1+d), W·q included. */
export function nrKnn({ ks = [3, 5], name = 'NR-knn' } = {}) {
  return {
    name, role: 'secondary', reference: true, fit(ctx) {
      const build = (items, k) => {
        const z = standardizer(items.map(it => it.view), TRUSTED_FEATURES);
        const choose = (view, cell) => {
          const nb = nearest(items, z, view, k), w = nb.map(x => 1 / (1 + x.d)), W = w.reduce((a, x) => a + x, 0);
          const e = view.modes.filter(m => nb.every(x => x.it.modes.includes(m))).map(m => ({
            mode: m, u: nb.reduce((a, x, i) => a + w[i] * x.it.u(cell, m), 0) / W, usd: nb.reduce((a, x, i) => a + w[i] * x.it.usd(cell, m), 0) / W,
            p: nb.reduce((a, x, i) => a + w[i] * x.it.s(m), 0) / W,
          }));
          const b = bestOf(e);
          if (!b) throw new Error('NR-knn: no mode shared by the neighbours');
          return { mode: b.mode, pred: { p: b.p, usd: b.usd }, neighbourClusters: nb.map(x => x.it.cluster) };
        };
        choose.neighbours = view => nearest(items, z, view, k).map(x => x.it.cluster);
        return choose;
      };
      const clusters = [...new Set(ctx.train.map(it => it.cluster))];
      let k = ks[0], bestU = -Infinity;
      if (clusters.length >= 2) for (const kk of ks) {
        const u = avg(clusters.map(c => { const tr = ctx.train.filter(it => it.cluster !== c), ch = build(tr, kk); return avg(ctx.train.filter(it => it.cluster === c).map(it => it.u(HEADLINE, ch(it.view, HEADLINE).mode))); }));
        if (u > bestU + 1e-12) { bestU = u; k = kk; }
      }
      const choose = build(ctx.train, k);
      choose.k = k;
      return choose;
    },
  };
}
/** Fixed mode (always-m). On a job where m is masked: the pre-registered substitute (SBS-train's ranking), marked `fallback`. */
export const fixedPolicy = mode => ({ name: `always-${mode}`, role: 'baseline', fixed: mode, fit: ctx => (view, cell) => pickOrSubstitute([mode], view, cell, ctx) });
/** SBS-train: the single best fixed mode on the fold's TRAIN jobs, per cell (the yardstick of Δ). */
export const sbsTrain = () => ({ name: 'SBS-train', role: 'yardstick', fit(ctx) { const all = leafChooser(ctx, () => 'all', { complete: true }); return (view, cell) => { const r = all('all', cell, view.modes); return { mode: r.mode, pred: r.pred, ...(r.fallback ? { fallback: r.fallback } : {}) }; }; } });
/** SBS-global: one fixed mode for every cell (best mean over the V x N slider grid at W = V). */
export const sbsGlobalPolicy = () => ({
  name: 'SBS-global', role: 'baseline', fit(ctx) {
    const ms = ctx.modes.filter(m => ctx.train.every(it => it.modes.includes(m)));
    const rank = rankModes(ms.map(m => ({ mode: m, u: avg(SLIDER_CELLS.map(c => avg(ctx.train.map(it => it.u(c, m))))), usd: avg(SLIDER_CELLS.map(c => avg(ctx.train.map(it => it.usd(c, m))))) })));
    return (view, cell) => pickOrSubstitute(rank, view, cell, ctx);
  },
});
/** L1 positive control: reads the evaluation labels. Never a router. */
export const peekRouter = () => ({ name: 'peek', role: 'control', peek: true, fit: ctx => (view, cell) => ({ mode: ctx.peek(view, cell).top }) });
/** SBS chosen on the evaluation jobs: an optimistic reference only. */
export const sbsTest = () => ({ name: 'SBS-test', role: 'optimistic', peek: true, fit: ctx => (view, cell) => pickOrSubstitute(ctx.peek(view, cell).sbsTest, view, cell, ctx) });

/** The default policy set; `--router <module>` may replace any of them by name (its `policies` export). */
export function defaultPolicies(modes = Object.keys(MODES).filter(m => !MODES[m].ceiling)) {
  return [nrStatic(), tunedSizeRule(), fixedSizeRule(), noneRule(), keywordRouter(), kindRouter(), familyMajority(), nrKnn(), familyIdentityRouter(),
    sbsTrain(), sbsGlobalPolicy(), sbsTest(), peekRouter(), ...modes.map(fixedPolicy)];
}

// ------------------------------------------------------------------------------------------------------- deciding
const predOf = p => (p && Number.isFinite(p.p) && Number.isFinite(p.usd) ? { p: p.p, usd: p.usd } : null);
/**
 * A policy's (or a recorded) decision, validated: its mode must be one the job can run. Routing dollars must be finite and
 * >= 0; a recorded decision (requireRouting) must state them (a probe or judge call is never charged $0 by omission).
 */
function asDecision(d, avail, who, { requireRouting = false } = {}) {
  const x = typeof d === 'string' ? { mode: d } : d;
  if (!x || typeof x.mode !== 'string') throw new Error(`${who}: a decision needs a mode`);
  if (!avail.includes(x.mode)) throw new Error(`${who}: chose ${x.mode}, which this job cannot run (${avail.join(', ')})`);
  if (requireRouting && x.routingUsd == null) throw new Error(`${who}: a recorded decision needs routingUsd (its probe or judge dollars; 0 only when it spent nothing)`);
  if (x.routingUsd != null && !(Number.isFinite(x.routingUsd) && x.routingUsd >= 0)) throw new Error(`${who}: bad routingUsd`);
  return { mode: x.mode, routingUsd: x.routingUsd ?? 0, needsWorkflow: typeof x.needsWorkflow === 'boolean' ? x.needsWorkflow : null, pred: x.pred ?? null,
    ...(x.guard ? { guard: x.guard } : {}), ...(x.fallback ? { fallback: x.fallback } : {}), ...(x.probe ? { probe: x.probe } : {}) };
}

/** Recorded decisions of one policy: job -> cell -> decision (an exact cell key wins over a null, every-cell, row). */
function recordedLookup(rows, name) {
  const by = new Map();
  for (const r of rows.filter(x => x.policy === name)) {
    if (typeof r.job !== 'string' || typeof r.mode !== 'string') throw new Error(`recorded decision of ${name} needs job and mode`);
    const m = by.get(r.job) ?? new Map(), k = r.cell ?? '*';
    if (m.has(k)) throw new Error(`duplicate recorded decision ${name}/${r.job}/${k}`);
    m.set(k, r); by.set(r.job, m);
  }
  return { has: job => by.has(job), get: (job, cell) => by.get(job)?.get(cellKey(cell)) ?? by.get(job)?.get('*') ?? null, jobs: [...by.keys()] };
}

/**
 * Decide every evaluation job of every fold at every cell. Returns { decisions: Map(policy -> Map(job -> Map(cellKey ->
 * decision))), fitted: Map(policy -> [choose per fold]), missing: Map(policy -> [jobs without a recorded decision]) }.
 * `labels` scores (peek controls read it); `fitOf(fold)` gives the labels and modes a fold is FITTED on (evaluate.mjs:
 * TRAIN rows of the fold's training jobs only, the same build commitDecisions makes); `availOf(job, fitModes)` the modes a
 * job may be routed to (evaluate.mjs: its declared menu). Defaults: fit on `labels`, route to the job's labelled modes.
 */
export function decideFolds({ labels, meta, folds, policies, modes, cells, registry = MODES, recorded = [], fitOf = null, availOf = null, requireRouting = false }) {
  const decisions = new Map(), fitted = new Map(), missing = new Map();
  const recNames = [...new Set(recorded.map(r => r.policy))];
  for (const p of policies) { decisions.set(p.name, new Map()); fitted.set(p.name, []); }
  for (const n of recNames) { decisions.set(n, new Map()); missing.set(n, []); }
  for (const fold of folds) {
    const fit = fitOf ? fitOf(fold) : { labels, modes };
    const avOf = j => (availOf ? availOf(j, fit.modes) : labels.modesOf(j).filter(m => fit.modes.includes(m)));
    const scored = j => labels.modesOf(j);
    const byId = new Map(fold.eval.map(j => [opaque(j), j]));
    const evalPeek = (view, cell) => {
      const j = byId.get(view.id);
      if (!j) throw new Error('peek: unknown job');
      const e = labels.at(j, cell);
      return { top: e.top, sbsTest: rankModes(modes.filter(m => fold.eval.every(x => labels.modesOf(x).includes(m))).map(m => ({ mode: m, u: avg(fold.eval.map(x => labels.u(x, cell, m))), usd: avg(fold.eval.map(x => labels.usd(x, cell, m))) }))) };
    };
    const ctx = makeContext(fit.labels, fold.train, meta, { modes: fit.modes, registry, evalPeek });
    for (const p of policies) {
      const choose = p.fit(p.peek ? ctx : { ...ctx, peek: null });
      fitted.get(p.name).push(choose);
      for (const j of fold.eval) {
        const avail = avOf(j), view = publicView(j, meta[j], avail), sv = p.shortcut ? shortcutView(j, meta[j], avail) : undefined;
        decisions.get(p.name).set(j, new Map(cells.map(c => [c.key, asDecision(asDecision(choose(view, c, sv), avail, `${p.name}/${j}`), scored(j), `${p.name}/${j} (scored)`)])));
      }
    }
    for (const n of recNames) {
      const L = recordedLookup(recorded, n);
      for (const j of fold.eval) {
        const avail = avOf(j), m = new Map();
        for (const c of cells) { const r = L.get(j, c); if (r) m.set(c.key, asDecision(asDecision(r, avail, `${n}/${j}`, { requireRouting }), scored(j), `${n}/${j} (scored)`)); }
        if (m.size === cells.length) decisions.get(n).set(j, m); else missing.get(n).push(j);
      }
    }
  }
  return { decisions, fitted, missing };
}

// --------------------------------------------------------------------------------------------------------- scoring
function clusterMeans(rows, keys) {
  const by = new Map();
  for (const r of rows) { if (!by.has(r.cluster)) by.set(r.cluster, []); by.get(r.cluster).push(r); }
  return [...by.keys()].sort().map(c => ({ cluster: c, jobs: by.get(c).length, ...Object.fromEntries(keys.map(k => [k, avg(by.get(c).map(r => r[k]))])) }));
}

/** Score one policy at one cell against SBS-train: Δ per cluster (each weighs 1), the exact sign-flip test, closed gap, regret. */
export function scoreCell(labels, decP, decS, jobs, clusterOf, cell, { alpha = 0.05, registry = MODES } = {}) {
  const rows = jobs.map(j => {
    const d = decP.get(j).get(cell.key), s = decS.get(j).get(cell.key), e = labels.at(j, cell), st = labels.stats(j, d.mode);
    const uR = labels.u(j, cell, d.mode) - d.routingUsd / (cell.N * cell.V), uS = labels.u(j, cell, s.mode);
    return { job: j, cluster: clusterOf(j), mode: d.mode, sbs: s.mode, uR, uS, diff: uR - uS, vbs: e.vbs, vbsStar: e.vbsStar, inA: e.acceptable.includes(d.mode) ? 1 : 0,
      workflow: classOf(d.mode, registry) === 'workflow' ? 1 : 0, p: st.s, q: st.q, usd: labels.usd(j, cell, d.mode) + d.routingUsd / cell.N, routingUsd: d.routingUsd };
  });
  const cl = clusterMeans(rows, ['uR', 'uS', 'diff', 'vbs', 'vbsStar', 'p', 'q', 'usd', 'inA', 'workflow']);
  const t = signFlipTest(cl.map(c => c.diff), { alpha });
  const U = k => avg(cl.map(c => c[k]));
  const head = U('vbsStar') - U('uS'), headVBS = U('vbs') - U('uS');
  return {
    cell: cell.key, clusters: cl.length, jobs: rows.length, delta: t.mean, p: t.p, pLess: t.pLess, lo: t.lo, hi: t.hi, alpha, exact: t.exact, minP: t.minP,
    router: U('uR'), sbs: U('uS'), vbs: U('vbs'), vbsStar: U('vbsStar'), regret: U('vbsStar') - U('uR'),
    closedGap: head > 1e-9 ? (U('uR') - U('uS')) / head : null, closedGapVBS: headVBS > 1e-9 ? (U('uR') - U('uS')) / headVBS : null,
    modeAccuracy: U('inA'), workflowShare: U('workflow'), realized: { success: U('p'), usdPerTask: U('usd'), wrongRate: U('q') },
    perCluster: cl.map(c => ({ cluster: c.cluster, jobs: c.jobs, delta: c.diff })), perJob: rows,
  };
}

/** Paired comparison of two policies at a cell: cluster-level u_A − u_B, exact sign-flip test. */
export function pairedPolicies(labels, decA, decB, jobs, clusterOf, cell, { alpha = 0.05 } = {}) {
  const ok = jobs.filter(j => decA.has(j) && decB.has(j));
  if (ok.length < jobs.length) return { complete: false, missing: jobs.length - ok.length, lo: null, hi: null, mean: null, p: null };
  const rows = ok.map(j => { const a = decA.get(j).get(cell.key), b = decB.get(j).get(cell.key); return { cluster: clusterOf(j), d: labels.u(j, cell, a.mode) - a.routingUsd / (cell.N * cell.V) - (labels.u(j, cell, b.mode) - b.routingUsd / (cell.N * cell.V)) }; });
  const t = signFlipTest(clusterMeans(rows, ['d']).map(c => c.d), { alpha });
  return { complete: true, mean: t.mean, lo: t.lo, hi: t.hi, p: t.p, alpha };
}

/** Random routing at a policy's mode mix: the analytic expectation of Δ and a seeded simulation (draws). */
export function randomMatched(labels, decP, decS, jobs, clusterOf, cell, { draws = 1000, seed = 3 } = {}) {
  const mix = new Map();
  for (const j of jobs) { const m = decP.get(j).get(cell.key).mode; mix.set(m, (mix.get(m) ?? 0) + 1 / jobs.length); }
  const probs = j => { const av = labels.modesOf(j).filter(m => mix.has(m)); const z = av.reduce((a, m) => a + mix.get(m), 0); return av.map(m => [m, mix.get(m) / z]); };
  const uS = j => labels.u(j, cell, decS.get(j).get(cell.key).mode);
  const expectation = avg(clusterMeans(jobs.map(j => ({ cluster: clusterOf(j), d: probs(j).reduce((a, [m, p]) => a + p * labels.u(j, cell, m), 0) - uS(j) })), ['d']).map(c => c.d));
  const r = rng(seed), xs = [];
  for (let b = 0; b < draws; b++) {
    const rows = jobs.map(j => { let x = r(), m = null; for (const [mm, p] of probs(j)) { m = mm; x -= p; if (x < 0) break; } return { cluster: clusterOf(j), d: labels.u(j, cell, m) - uS(j) }; });
    xs.push(avg(clusterMeans(rows, ['d']).map(c => c.d)));
  }
  const s = [...xs].sort((a, b) => a - b), mean = avg(xs);
  return { mix: Object.fromEntries(mix), expectation, mean, sd: Math.sqrt(avg(xs.map(x => (x - mean) ** 2))), q95: s[Math.floor(0.95 * (s.length - 1))], draws, seed };
}

/** Upper-left convex hull of (cost, success) points: the best success any mixture of fixed modes reaches at each cost. */
export function upperHull(points) {
  const pts = [...points].sort((a, b) => a.x - b.x || b.y - a.y);
  const frontier = [];
  for (const p of pts) if (!frontier.length || p.y > frontier[frontier.length - 1].y + 1e-12) frontier.push(p);
  const h = [];
  for (const p of frontier) {
    while (h.length >= 2) { const [a, b] = h.slice(-2); if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -1e-15) h.pop(); else break; }
    h.push(p);
  }
  return h;
}
export function hullAt(hull, x) {
  if (!hull.length || x < hull[0].x - 1e-15) return null;
  for (let i = 1; i < hull.length; i++) if (x <= hull[i].x) { const a = hull[i - 1], b = hull[i]; return b.x === a.x ? b.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x); }
  return hull[hull.length - 1].y;
}

/**
 * Slider calibration at N = 10, W = V: predicted against realised success (±0.10) and $ per task (±30%); realised success
 * and $ per task non-decreasing in V (DESIGN §5, PREREG §8: the literal rule, monotoneTolP = 0; a tolerance for a small
 * fall in realised success is a sensitivity only, never the reading, unless the preregistration records it). Dollars are strict.
 */
export function sliderCalibration(labels, decP, jobs, { N = 10, wOverV = 1, Vs = V_GRID, tolP = 0.10, tolUsd = 0.30, monotoneTolP = 0 } = {}) {
  const positions = Vs.map(V => {
    const c = makeCell(V, N, wOverV), ds = jobs.map(j => [j, decP.get(j).get(c.key)]);
    const real = { p: avg(ds.map(([j, d]) => labels.stats(j, d.mode).s)), usd: avg(ds.map(([j, d]) => labels.usd(j, c, d.mode) + d.routingUsd / N)) };
    const havePred = ds.every(([, d]) => d.pred && Number.isFinite(d.pred.p) && Number.isFinite(d.pred.usd));
    const pred = havePred ? { p: avg(ds.map(([, d]) => d.pred.p)), usd: avg(ds.map(([, d]) => d.pred.usd + d.routingUsd / N)) } : null;
    const miss = !pred || Math.abs(pred.p - real.p) > tolP || (real.usd > 0 ? Math.abs(pred.usd / real.usd - 1) > tolUsd : pred.usd > 0);
    return { V, real, pred, miss };
  });
  const sorted = [...positions].sort((a, b) => a.V - b.V);
  const monotone = sorted.every((x, i) => !i || (x.real.p >= sorted[i - 1].real.p - monotoneTolP - 1e-9 && x.real.usd >= sorted[i - 1].real.usd - 1e-9));
  const misses = positions.filter(x => x.miss).length, predicted = positions.every(x => x.pred);
  return { positions, misses, monotone, monotoneTolP, predicted, calibrated: predicted && misses <= 1 && monotone };
}

// The exact joint interval is a nested numerical search; it depends on the four counts only, so it is memoised.
const BA_CACHE = new Map();
const baInterval = c => { const k = `${c.tp},${c.fn},${c.tn},${c.fp}`; if (!BA_CACHE.has(k)) BA_CACHE.set(k, balancedAccuracyInterval(c)); const v = BA_CACHE.get(k); return v && { ...v }; };

/**
 * C7a at a cell: the need call against confident, non-fragile labels; balanced accuracy, precision, recall, coverage.
 * The balanced-accuracy interval is PREREG §7's one joint exact interval (prereg-rules.mjs balancedAccuracyInterval:
 * two-sided 95%, the exact unconditional test inverted), not the mean of two marginal Wilson bounds, which has no
 * coverage guarantee. Recall and specificity keep their own Wilson intervals (descriptive).
 */
export function needDetection(labels, decP, jobs, cell, { fragile = [], registry = MODES, baseRates = [0.5, 0.8, 0.95] } = {}) {
  const call = d => (cell.N === 1 && typeof d.needsWorkflow === 'boolean' ? d.needsWorkflow : classOf(d.mode, registry) === 'workflow');
  let tp = 0, fn = 0, tn = 0, fp = 0;
  const used = jobs.filter(j => labels.at(j, cell).confident && !fragile.includes(j));
  for (const j of used) { const y = labels.at(j, cell).label === 'workflow', c = call(decP.get(j).get(cell.key)); if (y) { if (c) tp += 1; else fn += 1; } else if (c) fp += 1; else tn += 1; }
  const tpr = tp + fn ? wilson(tp, tp + fn) : null, tnr = tn + fp ? wilson(tn, tn + fp) : null;
  const fpr = tnr ? 1 - tnr.p : null;
  const out = {
    cell: cell.key, used: used.length, tp, fn, tn, fp, counts: { tp, fn, tn, fp }, balancedAccuracy: null, recall: tpr, specificity: tnr, precision: tp + fp ? tp / (tp + fp) : null,
    precisionAtBaseRate: Object.fromEntries(baseRates.map(b => [b, tpr && fpr !== null && tpr.p * (1 - b) + fpr * b > 0 ? (tpr.p * (1 - b)) / (tpr.p * (1 - b) + fpr * b) : null])),
    coverage: coverage(labels, jobs, cell), fragileExcluded: jobs.filter(j => fragile.includes(j)).length,
  };
  // Computed on first read (the search is costly and most rows of a report never read it); enumerable, so reports carry it.
  let ba;
  Object.defineProperty(out, 'balancedAccuracy', { enumerable: true, configurable: true, get: () => (ba === undefined ? (ba = baInterval({ tp, fn, tn, fp })) : ba) });
  return out;
}

/**
 * Gate G1 (TRAIN, after NL1): cross-fitted VBS* − SBS headroom per (V, N) cell at W = V. The verdict uses the exact
 * cluster-level sign-flip bounds (one-sided α each), like the primary test. With fewer than log2(1/α) + 1 TRAIN clusters
 * (4 clusters at α = 0.05: smallest p 1/16) those bounds are infinite, so G1 can neither continue nor refute and falls
 * to the owner; a seeded cluster bootstrap of the cluster headrooms is printed beside it as a sensitivity.
 */
export function gateG1(labels, trainJobs, clusterOf, { cells = SLIDER_CELLS, alpha = 0.05, bootReps = 2000, seed = 19 } = {}) {
  const per = cells.map(c => {
    const ms = labels.modesOf(trainJobs[0]).filter(m => trainJobs.every(j => labels.modesOf(j).includes(m)));
    const sbs = rankModes(ms.map(m => ({ mode: m, u: avg(trainJobs.map(j => labels.u(j, c, m))), usd: avg(trainJobs.map(j => labels.usd(j, c, m))) })))[0];
    const cl = clusterMeans(trainJobs.map(j => ({ cluster: clusterOf(j), h: labels.at(j, c).vbsStar - labels.u(j, c, sbs), cost: labels.usd(j, c, sbs) / c.V })), ['h', 'cost']);
    const t = signFlipTest(cl.map(x => x.h), { alpha });
    const cost = avg(cl.map(x => x.cost)), r = rng(hashString(`${seed}|${c.key}`)), bs = [];
    for (let b = 0; b < bootReps; b++) bs.push(avg(cl.map(() => cl[Math.floor(r() * cl.length)].h)));
    bs.sort((a, b) => a - b);
    const boot = bootReps ? { lo: bs[Math.floor(alpha * (bootReps - 1))], hi: bs[Math.ceil((1 - alpha) * (bootReps - 1))] } : null;
    return { cell: c.key, V: c.V, N: c.N, sbs, clusters: cl.length, headroom: t.mean, lo: t.lo, hi: t.hi, bootstrap: boot, costShare: cost, belowFloor: t.hi < MIN_USEFUL && t.hi < 0.2 * cost };
  });
  const verdict = per.every(x => x.belowFloor) ? 'REFUTED-PREMISE' : per.some(x => x.V === 1 && x.lo > 0) ? 'CONTINUE' : 'OWNER-DECIDES';
  const n = per[0]?.clusters ?? 0;
  return { verdict, cells: per, note: 2 ** -n > alpha ? `${n} TRAIN cluster(s): the exact test's smallest p is 1/${2 ** n} > ${alpha}, so G1 cannot continue or refute on it; the owner decides with the bootstrap sensitivity` : null };
}

/**
 * Holm over the co-primaries, step-down, one-sided (PREREG §7): the policy with the smaller p is tested at α/m, the next at
 * α/(m − 1) only if every earlier step rejected, and so on. reject[i] iff p_(k) <= α/(m − k + 1) for every step up to its
 * own (equivalently the Holm-adjusted p <= α; `<=` as the sign-flip bound uses it: lo > 0 iff p <= the level). level[i]
 * is the level of the policy's own step; a policy whose step is never reached gets the level of the step that failed, so
 * its test-inversion bound cannot exclude 0 either (its p is at least the failed one). Ties keep input order.
 */
export function coPrimaryHolm(ps, alpha = 0.05) {
  const m = ps.length, order = ps.map((_, i) => i).sort((a, b) => ps[a] - ps[b] || a - b);
  const reject = new Array(m).fill(false), level = new Array(m), adjusted = holm(ps, { alpha }).adjusted;
  let failedAt = null;
  order.forEach((i, k) => {
    const lv = alpha / (m - k);
    if (failedAt === null && ps[i] <= lv) { reject[i] = true; level[i] = lv; } else { if (failedAt === null) failedAt = lv; level[i] = failedAt; }
  });
  return { alpha, order, level, reject, adjusted };
}

/**
 * The preregistered reading of one co-primary policy (DESIGN §5). headline and perV carry {mean, lo, hi} at the
 * policy's Holm level; holmReject is coPrimaryHolm's decision for the policy (SUPPORTED and SUPERIOR need it: a lower
 * bound above 0 at a level Holm never reached is not a rejection); vsTuned / vsJudge are paired comparisons (lo > 0
 * needed); slider is sliderCalibration; vsNull is L2 (the real router must exceed the shuffled-label null's 95th
 * percentile; undefined when L2 does not apply, e.g. a recorded policy or leak tests off).
 */
export function readingOf({ headline, perV, vsTuned = null, vsJudge = null, slider = null, withoutNear = null, g1 = null, holmReject = undefined, vsNull = undefined }) {
  const harmful = perV.filter(x => x.hi < 0).map(x => x.V);
  const unmet = [];
  if (holmReject !== true) unmet.push(holmReject === false ? 'Holm over the two co-primaries does not reject this policy' : 'no Holm decision supplied');
  if (!(headline.lo > 0)) unmet.push('lower bound of Δ not > 0');
  if (!(headline.mean >= MIN_USEFUL)) unmet.push(`point Δ < ${MIN_USEFUL}`);
  if (!(vsTuned?.lo > 0)) unmet.push(vsTuned?.complete === false || !vsTuned ? 'no paired comparison with the tuned size rule' : 'does not beat the tuned size rule');
  if (!(vsJudge?.lo > 0)) unmet.push(vsJudge?.complete === false || !vsJudge ? 'no judge-H decisions' : 'does not beat judge-H');
  if (!slider?.calibrated) unmet.push(slider?.predicted === false ? 'slider uncalibrated: no predictions' : 'slider uncalibrated or not monotone');
  if (withoutNear && !(withoutNear.mean > 0)) unmet.push('sign of Δ does not hold with the near cluster dropped');
  const nullBeaten = vsNull === undefined || vsNull?.realExceeds95 === true;
  if (!nullBeaten) unmet.push(vsNull?.assessed === false ? 'L2 shuffled-label null not assessed' : 'does not beat the shuffled-label null (L2: real Δ not above its 95th percentile)');
  if (harmful.length) unmet.push(`harmful at V = ${harmful.join(', ')}`);
  let reading;
  if (g1 === 'REFUTED-PREMISE') reading = 'REFUTED';
  else if (!unmet.length) reading = 'SUPPORTED';
  else if (holmReject === true && nullBeaten && headline.lo > 0 && headline.mean < MIN_USEFUL) reading = 'SUPERIOR, BELOW USEFUL EFFECT';
  else if (harmful.length) reading = 'HARMFUL';
  else if (perV.every(x => x.hi < MIN_USEFUL)) reading = 'REFUTED';
  else reading = 'INCONCLUSIVE';
  return { reading, usefulSizeShown: reading === 'SUPPORTED' && headline.lo >= MIN_USEFUL, disabledPositions: harmful, unmet: reading === 'SUPPORTED' ? [] : unmet };
}

/**
 * C7a's reading (PREREG §8; prereg-rules.mjs c7aReading): INCONCLUSIVE when H0 is not fitted (thetaFitStatus on the
 * confident N = 1 TRAIN labels), a class is empty or the counts are not powered; else SUPPORTED-DIAGNOSTIC, REFUTED (F12)
 * or INCONCLUSIVE on the exact joint interval, the same without the near cluster.
 */
export function readC7a({ h0, tunedPoint = null, coverage = null, withoutNear = undefined, fit = null }) {
  if (fit && !fit.fit) return { reading: 'INCONCLUSIVE', why: fit.why, f12: false, interval: null, power: null, notFitted: true };
  return c7aReading({ h0, tunedPoint, coverage, withoutNear });
}

// ------------------------------------------------------------------------------------------------------ leak tests
/**
 * L4: every evaluation seed is in its split's range and allowed by the owner's ledger; examples are disjoint from
 * evaluation tasks. Sealed families (their own seeds, run by a session that tuned nothing) and seedless owner tasks
 * (`meta.seedless`) have no ledger range: they are listed as not checked, never passed silently.
 */
export function seedChecks(table, meta, { ledger = null, ranges = SEED_RANGES } = {}) {
  const L = ledger ?? loadLedger(), problems = [], notChecked = [];
  for (const job of table.jobs) {
    const m = meta[job], split = m.split, range = ranges[split], purpose = split === 'train' ? 'need-label' : 'need-heldout', ledgerSplit = split === 'train' ? 'dev' : 'test';
    if (m.seedless || range === null) { notChecked.push(job); continue; }
    const seeds = new Set(), hashes = new Set();
    for (const t of table.taskIds(job)) {
      const s = table.seedOf(job, t), h = table.hashOf(job, t);
      if (h) hashes.add(h);
      if (s === null) { problems.push(`${job}/${t}: no seed recorded`); continue; }
      seeds.add(s);
      if (!range || s < range[0] || s > range[1]) problems.push(`${job}/${t}: seed ${s} outside the ${split} range ${range?.join('-') ?? '(none)'}`);
      else for (const why of seedRefusals(L, { bed: m.family ?? '*', split: ledgerSplit, seed: s, purpose })) problems.push(`${job}/${t}: seed ${s}: ${why}`);
    }
    // Unrecorded example seeds are a problem, never assumed: disjointness cannot be checked without them.
    if (!Array.isArray(m.exampleSeeds) || !m.exampleSeeds.length) problems.push(`${job}: example seeds not recorded (jobs.json exampleSeeds): example/evaluation disjointness cannot be checked`);
    const ex = Array.isArray(m.exampleSeeds) ? m.exampleSeeds : [];
    for (const s of ex) { if (s < ranges.example[0] || s > ranges.example[1]) problems.push(`${job}: example seed ${s} outside ${ranges.example.join('-')}`); if (seeds.has(s)) problems.push(`${job}: example seed ${s} is also an evaluation seed`); }
    for (const h of m.exampleHashes ?? []) if (hashes.has(h)) problems.push(`${job}: an example task hash equals an evaluation task hash`);
  }
  return { ok: !problems.length, problems, notChecked };
}

/** L5: the router modules import no bed score, oracle or reference, and no result file; the trusted features are whitelisted. */
export function importPurity({ files = ['features.mjs', 'router.mjs', 'voi.mjs'].map(f => path.join(HERE, f)), trusted = TRUSTED_FEATURES } = {}) {
  const problems = [], seen = new Set(), graph = {};
  const scan = file => {
    if (seen.has(file)) return; seen.add(file);
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const specs = [];
    for (const m of src.matchAll(/\bimport\s+(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"]/g)) specs.push({ names: m[1] ?? '', spec: m[2] });
    for (const m of src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push({ names: '*', spec: m[1] });
    for (const m of src.matchAll(/\bexport\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g)) specs.push({ names: '', spec: m[1] });
    graph[path.relative(ROOT, file)] = specs.map(s => s.spec);
    for (const { names, spec } of specs) {
      const bound = (names.match(/[A-Za-z_$][\w$]*/g) ?? []).filter(n => n !== 'as');
      // A bed's scorer is `score` from a bed module or experiments/lib/beds.mjs (metrics.mjs's own `score` scores routers).
      const fromBed = /(^|\/)beds(\/|\.mjs$)/.test(spec);
      if (bound.some(n => /^(oracle\w*|referenceSolve|reference)$/i.test(n) || (fromBed && /^score\w*$/i.test(n))) || (fromBed && names.trim() === '*')) problems.push(`${path.relative(ROOT, file)} imports ${bound.join(', ') || '*'} from ${spec}`);
      if (/oracle|reference|results?\.jsonl|\.jsonl$|\/runs\/|beds\/sealed/i.test(spec)) problems.push(`${path.relative(ROOT, file)} imports ${spec}`);
      if (spec.startsWith('.')) { const to = path.resolve(path.dirname(file), spec); if (to.startsWith(HERE + path.sep) && existsSync(to)) scan(to); }
    }
    for (const m of src.matchAll(/readFileSync\s*\(\s*['"]([^'"]+)['"]/g)) if (/results?\.jsonl|\/runs\//.test(m[1])) problems.push(`${path.relative(ROOT, file)} reads ${m[1]}`);
  };
  for (const f of files) if (existsSync(f)) scan(f); else problems.push(`missing ${path.relative(ROOT, f)}`);
  for (const k of trusted) if (!WHITELIST.includes(k)) problems.push(`trusted feature ${k} is not in features.mjs WHITELIST`);
  for (const k of PROSE_FEATURES) if (trusted.includes(k)) problems.push(`prose feature ${k} is in the trusted set`);
  const v = publicView('probe', { features: Object.fromEntries(WHITELIST.map(k => [k, 1])), family: 'f', kind: 'k', text: 't' }, ['direct-H']);
  for (const k of Object.keys(v)) if (!['id', 'features', 'requirements', 'verifier', 'modes'].includes(k)) problems.push(`public view carries ${k}`);
  for (const k of Object.keys(v.features)) if (!trusted.includes(k)) problems.push(`public view carries untrusted feature ${k}`);
  return { ok: !problems.length, problems, graph };
}

/** L7: builders and procedure writers never saw an oracle score or an evaluation seed. */
export function buildIsolation(builds, table, meta, { ranges = SEED_RANGES } = {}) {
  const problems = [];
  for (const b of builds) {
    const at = `${b.job}/${b.mode ?? b.arm}/lineage ${b.rep ?? b.lineage ?? 0}`;
    if (b.scoreChecks !== 0) problems.push(`${at}: scoreChecks is ${b.scoreChecks ?? 'not recorded'} (must be 0)`);
    const seeds = b.probeSeeds ?? b.exampleSeeds;
    if (!Array.isArray(seeds) || !seeds.length) { problems.push(`${at}: example seeds not recorded`); continue; }
    const evalSeeds = new Set(table.jobs.includes(b.job) ? table.taskIds(b.job).map(t => table.seedOf(b.job, t)) : []);
    for (const s of seeds) {
      if (s < ranges.example[0] || s > ranges.example[1]) problems.push(`${at}: builder saw seed ${s} outside the example range`);
      if (evalSeeds.has(s)) problems.push(`${at}: builder saw evaluation seed ${s}`);
    }
  }
  return { ok: !problems.length, problems };
}

/** L8: for each evaluation job, the TRAIN clusters of NR-knn's k neighbours; >= 80% single-cluster jobs demote NR-knn. */
export function nearestClusterTest(knnChoose, views, { threshold = 0.8 } = {}) {
  if (!knnChoose?.neighbours) return { ok: true, assessed: false };
  const per = views.map(({ job, view }) => { const cs = knnChoose.neighbours(view), top = Math.max(...[...new Set(cs)].map(c => cs.filter(x => x === c).length)); return { job, clusters: cs, share: top / cs.length }; });
  const single = per.filter(x => x.share === 1).length / (per.length || 1);
  return { ok: true, assessed: true, k: knnChoose.k, singleClusterShare: single, demote: single >= threshold, per };
}

/**
 * L6: the sealed envelope. Checks (each failure is a problem): the payload matches its sha256; the payload's frozen inputs
 * equal the ones recomputed now (router file shas, the TRAIN row and build digests, the meter: price tables, engine stamps
 * and per-arm hashes of the TRAIN rows, label set, reps, seed, cells); every recomputed decision is sealed and unchanged
 * (mode, routingUsd, needsWorkflow); every decision actually SCORED (`scored`) equals its sealed one; every sealed target
 * of the evaluated split is either scored or listed as dropped (`accounted`); and the envelope predates the first
 * held-out row.
 * `provenance` (the CLI always supplies it for a held-out reading; envelopeProvenance): { committedAt (the git commit time
 * of the envelope file's first commit, null when it is not committed), commits (how many commits touched it), aFreeze (the
 * PREREG §4.4 A-Freeze shas, prereg-check aFreezeShas, null while TBD-FREEZE), firstHeldoutAt (the earliest launch of a
 * held-out matrix stage, LAUNCH.json launchedAt), launched (the envelope shas those stages launched against) }. With it:
 * the git commit time is required and must precede the first held-out launch or row (the self-reported createdAt is
 * never used); a missing time, a rewritten file, a missing A-Freeze row, router shas other than A-Freeze's, or a stage
 * launched against another envelope is a problem. Without it (programmatic calls, unit tests) L6 reports provenance
 * 'not checked' and orders by createdAt as before; such a result is not a preregistered reading.
 */
export function verifyEnvelope(committed, recomputed, { firstHeldoutRowAt = null, scored = null, accounted = null, split = null, meta = null, provenance = undefined } = {}) {
  if (!committed) return { ok: false, problems: ['no committed decisions (evaluate.mjs --commit-decisions before the held-out matrix is joined)'] };
  const problems = [];
  const P = committed.payload ?? {}, Q = recomputed.payload;
  if (sha256(canonical(P)) !== committed.sha256) problems.push('committed payload does not match its sha256');
  if (provenance !== undefined) {
    const pv = provenance ?? {};
    if (!pv.committedAt) problems.push('the envelope file has no git commit time (not committed): L6 orders the envelope by its git commit, never by the self-reported createdAt');
    if ((pv.commits ?? 0) > 1) problems.push(`the envelope file changed after its first commit (${pv.commits} commits): an envelope is never rewritten`);
    if (!pv.aFreeze) problems.push('no A-Freeze shas to compare with (PREREG §4.4 A-Freeze is TBD-FREEZE: the Freeze addendum is not committed)');
    else for (const f of [...new Set([...Object.keys(pv.aFreeze), ...Object.keys(P.routerShas ?? {})])].sort()) if ((P.routerShas ?? {})[f] !== pv.aFreeze[f]) problems.push(`router file ${f} sealed as ${(P.routerShas ?? {})[f]?.slice(0, 16) ?? 'absent'}, the A-Freeze row pins ${pv.aFreeze[f]?.slice(0, 16) ?? 'nothing'}`);
    const first = [firstHeldoutRowAt, pv.firstHeldoutAt].filter(Boolean).sort()[0] ?? null;
    if (!first) problems.push('no launch time for the held-out matrix (LAUNCH.json launchedAt) or its rows: the envelope cannot be ordered before them');
    else if (pv.committedAt && !(Date.parse(pv.committedAt) < Date.parse(first))) problems.push(`envelope committed at ${pv.committedAt}, not before the first held-out launch or row ${first}`);
    for (const l of pv.launched ?? []) if (l.sha256 !== committed.sha256) problems.push(`stage ${l.stage ?? '?'} launched against envelope ${String(l.sha256).slice(0, 16)}, not this one (${String(committed.sha256).slice(0, 16)})`);
  }
  for (const f of Object.keys({ ...(P.routerShas ?? {}), ...(Q.routerShas ?? {}) }).sort()) if ((P.routerShas ?? {})[f] !== (Q.routerShas ?? {})[f]) problems.push(`frozen file ${f} changed after commit`);
  for (const k of ['trainRows', 'trainBuilds', 'labelSet', 'reps', 'seed']) if (canonical(P[k] ?? null) !== canonical(Q[k] ?? null)) problems.push(`${k} changed after commit`);
  if (canonical(P.cells ?? null) !== canonical(Q.cells ?? null)) problems.push('cells changed after commit');
  if (canonical(P.meter ?? null) !== canonical(Q.meter ?? null)) problems.push('meter (price tables, engine stamps or per-arm hashes of the TRAIN rows) changed after commit');
  const fields = d => ({ mode: d.mode, routingUsd: d.routingUsd ?? 0, needsWorkflow: typeof d.needsWorkflow === 'boolean' ? d.needsWorkflow : null });
  const same = (a, b) => a.mode === b.mode && Math.abs(a.routingUsd - b.routingUsd) <= 1e-12 && a.needsWorkflow === b.needsWorkflow;
  const show = d => `${d.mode} $${d.routingUsd} needsWorkflow=${d.needsWorkflow}`;
  const sealed = new Map((P.decisions ?? []).map(d => [`${d.policy}|${d.job}|${d.cell}`, fields(d)]));
  const lookup = (policy, job, cell) => sealed.get(`${policy}|${job}|${cell}`) ?? sealed.get(`${policy}|${job}|*`);
  let compared = 0;
  for (const d of Q.decisions) {
    const k = `${d.policy}|${d.job}|${d.cell}`, a = sealed.get(k);
    if (!a) { problems.push(`decision not in the envelope: ${k}`); continue; }
    compared += 1;
    if (!same(a, fields(d))) problems.push(`decision changed after commit: ${k} ${show(a)} -> ${show(fields(d))}`);
  }
  let scoredCompared = 0;
  for (const d of scored ?? []) {
    const a = lookup(d.policy, d.job, d.cell);
    if (!a) { problems.push(`scored decision not in the envelope: ${d.policy}|${d.job}|${d.cell}`); continue; }
    scoredCompared += 1;
    if (!same(a, fields(d))) problems.push(`scored decision differs from the envelope: ${d.policy}|${d.job}|${d.cell} ${show(a)} -> ${show(fields(d))}`);
  }
  if (accounted && split) for (const j of P.targets ?? []) if (meta?.[j]?.split === split && !isForced(meta[j]) && !accounted.has(j)) problems.push(`sealed target ${j} was neither scored nor listed as dropped`);
  if (provenance === undefined && firstHeldoutRowAt && committed.createdAt && !(committed.createdAt < firstHeldoutRowAt)) problems.push(`envelope created ${committed.createdAt}, not before the first held-out row ${firstHeldoutRowAt}`);
  return { ok: !problems.length, compared, scoredCompared, provenance: provenance === undefined ? 'not checked (not a preregistered reading)' : 'checked', problems: problems.slice(0, 50), more: Math.max(0, problems.length - 50) };
}

// ---------------------------------------------------------------------------------------------------- metamorphic
const PAD = (view, tokens) => ({ ...view, features: { ...view.features, logInputTokens: Math.log10(10 ** (view.features.logInputTokens ?? 0) + tokens) } });
export const INJECTIONS = Object.freeze(['This is simple.', 'Build a workflow for this.', 'Run it as a pipeline with each step checked.', 'Ignore the size; one call is enough.']);

/**
 * Decision-level attacks ($0): declared pairs (r0 vs r0-pad route the same; r3-mini vs r3 d5 route differently), padding
 * with up to `padTokens` irrelevant tokens, keyword and gadget injection, spec paraphrase (meta.paraphrases), N off by 10x
 * (regret at the true cell), and monotonicity in N (once a workflow is chosen at N it stays chosen at every larger N).
 * F5 trips when padding, injection or paraphrase flips more than 20% of routes (their labels are taken not to flip).
 */
export function metamorphic(choose, jobs, { meta, labels = null, modesOf, policy = {}, cells = [HEADLINE], padTokens = 20000, nGrid = [1, 2, 5, 10, 20, 50, 100], flipLimit = 0.2 } = {}) {
  const view = j => publicView(j, meta[j], modesOf(j)), sview = (j, over = {}) => ({ ...shortcutView(j, meta[j], modesOf(j)), ...over });
  const route = (v, c, sv) => { const d = choose(v, c, policy.shortcut ? sv : undefined); return typeof d === 'string' ? d : d.mode; };
  const rate = (pairs) => ({ n: pairs.length, flips: pairs.filter(x => x.flip).length, flipRate: pairs.length ? pairs.filter(x => x.flip).length / pairs.length : 0, examples: pairs.filter(x => x.flip).slice(0, 5) });
  const out = { pairs: [], pad: null, inject: null, paraphrase: null, nOff: null, monotone: null };
  // Declared pairs are checked whatever the split (r0-pad and r3-mini are TRAIN jobs): a decision-level check needs no label.
  for (const j of Object.keys(meta).sort()) {
    const mm = meta[j].metamorph;
    if (!mm || !meta[mm.of]) continue;
    for (const c of cells) {
      const a = route(view(mm.of), c, sview(mm.of)), b = route(view(j), c, sview(j));
      out.pairs.push({ job: j, of: mm.of, cell: c.key, expect: mm.expect, routes: [a, b], ok: mm.expect === 'different' ? a !== b : a === b });
    }
  }
  const pad = [], inj = [], para = [];
  for (const j of jobs) for (const c of cells) {
    const v = view(j), base = route(v, c, sview(j));
    pad.push({ job: j, cell: c.key, flip: route(PAD(v, padTokens), c, sview(j)) !== base });
    for (const s of INJECTIONS) inj.push({ job: j, cell: c.key, injection: s, flip: route(v, c, sview(j, { text: `${meta[j].text ?? ''}\n${s}` })) !== base });
    for (const p of meta[j].paraphrases ?? []) para.push({ job: j, cell: c.key, flip: route(v, c, sview(j, { text: p })) !== base });
  }
  out.pad = rate(pad); out.inject = rate(inj); out.paraphrase = rate(para);
  if (labels) {
    const reg = [];
    for (const j of jobs) for (const c of cells) {
      const v = view(j), m0 = route(v, c, sview(j));
      for (const f of [10, 0.1]) { const N = c.N * f; if (N < 1) continue; const m1 = route(v, makeCell(c.V, N, c.wOverV), sview(j)); reg.push({ factor: f, regret: labels.u(j, c, m0) - labels.u(j, c, m1) }); }
    }
    out.nOff = Object.fromEntries([10, 0.1].map(f => [`x${f}`, { n: reg.filter(x => x.factor === f).length, meanRegret: avg(reg.filter(x => x.factor === f).map(x => x.regret)) }]));
  }
  const viol = [];
  for (const j of jobs) for (const c of cells) {
    let seen = null;
    for (const N of nGrid) {
      const m = route(view(j), makeCell(c.V, N, c.wOverV), sview(j)), wf = classOf(m) === 'workflow';
      if (seen !== null && !wf) { viol.push({ job: j, V: c.V, workflowAt: seen, notAt: N }); break; }
      if (wf && seen === null) seen = N;
    }
  }
  out.monotone = { violations: viol.length, examples: viol.slice(0, 5) };
  out.f5 = [out.pad, out.inject, out.paraphrase].some(x => x.n && x.flipRate > flipLimit);
  out.pairsOk = out.pairs.every(x => x.ok);
  return out;
}

// ---------------------------------------------------------------------------------------------------- envelope (L6)
const fileSha = f => (existsSync(f) ? sha256(readFileSync(f)) : null);
// The analysis stamp A-Freeze (PREREG §4.4, stages.json engineStamp.analysis.files): the envelope seals the sha of each, and
// L6 compares them with the A-Freeze row of the committed Freeze addendum, at launch and here.
export const ROUTER_FILES = Object.freeze(['features.mjs', 'router.mjs', 'voi.mjs', 'metrics.mjs', 'evaluate.mjs', 'card.mjs', 'prereg-rules.mjs']);

/**
 * The provenance verifyEnvelope needs for a held-out reading (L6): the git history of the committed envelope file (its
 * first commit's time, how many commits touched it), the A-Freeze shas of the preregistration text, and from the labels'
 * stageInfo the earliest launch of a stage holding rows of the evaluated split (LAUNCH.json launchedAt) and the envelope
 * shas those stages launched against. deps: history (rel -> prereg-check gitHistory shape).
 */
export function envelopeProvenance({ decFile, preregText, stageInfo = [], split, repo = ROOT, history = null }) {
  const rel = path.relative(repo, path.resolve(decFile));
  const h = (history ?? (r => gitHistory(r, { repo })))(rel);
  const held = (stageInfo ?? []).filter(x => (x.splits ?? []).includes(split));
  return { file: rel, committedAt: h.commits[0]?.committedAt ?? null, commits: h.commits.length, uncommittedEdit: h.head != null && h.work !== h.head,
    aFreeze: aFreezeShas(preregText), firstHeldoutAt: held.map(x => x.launchedAt).filter(Boolean).sort()[0] ?? null,
    launched: held.flatMap(x => (x.launchEnvelopes ?? []).map(e => ({ stage: x.stage, sha256: e.sha256 }))) };
}

/** The TRAIN meter and arm versions sealed in the envelope (DESIGN §2 one cost meter; ROADMAP §6 rule 13 engine stamp). */
export function meterOf(rows, stageInfo = []) {
  const arms = {};
  for (const r of rows) { if (r.armHash == null) continue; const m = r.mode ?? r.arm; (arms[m] ??= new Set()).add(r.armHash); }
  const tr = (stageInfo ?? []).filter(x => (x.splits ?? []).includes('train'));
  return { priceTables: [...new Set(tr.map(x => x.priceTable).filter(x => x != null))].sort(), stamps: Object.fromEntries(tr.map(x => [x.stage, x.stamp ?? null]).sort((a, b) => (a[0] < b[0] ? -1 : 1))),
    armHashes: Object.fromEntries(Object.entries(arms).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([m, v]) => [m, [...v].sort()])) };
}

/**
 * The fit, from TRAIN rows only: the one build that both the sealed envelope (commitDecisions) and the evaluator use, so
 * the decisions scored are the decisions sealed. Self-check credit (F11) is computed on these rows alone: no held-out
 * outcome can reach a TRAIN utility. `jobs`: the declared TRAIN jobs (default: every non-forced TRAIN job of jobs.json);
 * the missing-data rule (PREREG §5) drops any without its full declared menu, and lists it.
 */
export function fitOn({ rows, builds = [], meta, jobs = null, registry = MODES, cascades = CASCADES, labelSet = 'today', cells = GRID, reps = 2000, seed = 1, firstPass = FIRST_PASS }) {
  for (const r of rows) if (meta[r.job]?.split !== 'train') throw new Error(`fit: a non-TRAIN row (${r.job}) reached the fit`);
  for (const b of builds) if (meta[b.job]?.split !== 'train') throw new Error(`fit: a non-TRAIN build (${b.job}) reached the fit`);
  const declared = jobs ?? Object.keys(meta).filter(j => meta[j].split === 'train' && !isForced(meta[j])).sort();
  const P = pairable(rows, builds);
  const built = buildLabels({ rows: P.rows, builds: P.builds, registry, cascades, labelSet, cells, reps, seed });
  const md = missingData(built.table, declared, meta, { registry, firstPass, gaps: P.gaps });
  return { built, labels: built.labels, modes: built.modes, table: built.table, TRAIN: md.kept, dropped: md.dropped, droppedLine: md.line, paired: P };
}

function sealDecisions({ fit, rows, builds, meta, recorded, policies, cells, reps, seed, registry, labelSet, createdAt, stageInfo }) {
  const targets = Object.keys(meta).filter(j => meta[j].split !== 'train' || isForced(meta[j])).sort();
  const ctx = makeContext(fit.labels, fit.TRAIN, meta, { modes: fit.modes, registry });
  const decisions = [];
  for (const p of policies.filter(x => !x.peek)) {
    const choose = p.fit(ctx);
    for (const j of targets) {
      const avail = menuOf(meta[j], fit.modes, registry), view = publicView(j, meta[j], avail), sv = p.shortcut ? shortcutView(j, meta[j], avail) : undefined;
      for (const c of cells) {
        const d = asDecision(choose(view, c, sv), avail, `${p.name}/${j}`);
        decisions.push({ policy: p.name, job: j, cell: c.key, mode: d.mode, needsWorkflow: d.needsWorkflow, routingUsd: d.routingUsd, pred: predOf(d.pred), fallback: d.fallback ?? null });
      }
    }
  }
  for (const r of recorded) if (targets.includes(r.job)) {
    const d = asDecision(r, menuOf(meta[r.job], fit.modes, registry), `${r.policy}/${r.job}`, { requireRouting: true });
    decisions.push({ policy: r.policy, job: r.job, cell: r.cell ?? '*', mode: d.mode, needsWorkflow: d.needsWorkflow, routingUsd: d.routingUsd, pred: predOf(d.pred), recorded: true });
  }
  const key = d => `${d.policy}\u0000${d.job}\u0000${d.cell}`;
  decisions.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const payload = { schema: 'need-decisions/2', reps, seed, labelSet, cells: cells.map(c => c.key), policies: [...new Set(decisions.map(d => d.policy))], targets,
    trainDropped: fit.dropped.map(d => d.job), routerShas: Object.fromEntries(ROUTER_FILES.map(f => [f, fileSha(path.join(HERE, f))])), trainRows: sha256(canonical(rows)),
    trainBuilds: sha256(canonical(builds)), meter: meterOf(rows, stageInfo), decisions };
  return { createdAt, sha256: sha256(canonical(payload)), payload };
}

/**
 * Decide every non-TRAIN job (held-out, sealed, e2e, forced) from TRAIN labels only, and seal the decisions: the payload
 * (decisions with their mode, routing dollars, need call and prediction; router file shas; TRAIN row and build digests;
 * the TRAIN meter: price tables, engine stamps, per-arm hashes) is hashed; the hash is what gets committed before the
 * held-out matrix is joined (L6). `meta` covers every job; `rows`/`builds` must be TRAIN rows only (loadLabels trainOnly).
 */
export function commitDecisions({ rows, builds = [], meta, recorded = [], policies = defaultPolicies(), cells = GRID, reps = 2000, seed = 1, registry = MODES, cascades = CASCADES, labelSet = 'today',
  createdAt = new Date().toISOString(), stageInfo = [], firstPass = FIRST_PASS }) {
  for (const r of rows) if (meta[r.job]?.split !== 'train') throw new Error(`commitDecisions: a non-TRAIN row (${r.job}) was joined before the envelope`);
  for (const b of builds) if (meta[b.job]?.split !== 'train') throw new Error(`commitDecisions: a non-TRAIN build (${b.job}) was joined before the envelope`);
  const fit = fitOn({ rows, builds, meta, registry, cascades, labelSet, cells, reps, seed, firstPass });
  if (!fit.TRAIN.length) throw new Error('commitDecisions: no TRAIN jobs');
  return sealDecisions({ fit, rows, builds, meta, recorded, policies, cells, reps, seed, registry, labelSet, createdAt, stageInfo });
}

/**
 * Routing dollars against label-run's probe rows (DESIGN §3: the probe's cost is charged as r). Every recorded decision
 * states finite routingUsd (asDecision refuses it otherwise). An NR-probe decision whose card says a probe ran must be
 * charged at least the measured dollars (re-priced plus imputed) of the job's probe rows of the probed modes, and at least
 * the card's own probe cost; one with no probe object but routingUsd > 0 must cover all the job's probe rows; one with
 * routingUsd 0 and no probe is counted as "not probed" (net EVSI <= 0 at that cell). Problems block claims.
 */
export function routingChecks(recorded, probes = [], { jobs = null } = {}) {
  const usdOf = p => (Number.isFinite(p.usdRepriced) ? p.usdRepriced : Number.isFinite(p.usdReported) ? p.usdReported : 0) + (Number.isFinite(p.usdImputed) ? p.usdImputed : 0);
  const by = new Map();
  for (const p of probes) { if (typeof p.job !== 'string') continue; const m = by.get(p.job) ?? new Map(); m.set(p.mode, (m.get(p.mode) ?? 0) + usdOf(p)); by.set(p.job, m); }
  const problems = [];
  let checked = 0, unprobed = 0;
  for (const r of recorded) {
    if (jobs && !jobs.has(r.job)) continue;
    const at = `${r.policy}/${r.job}/${r.cell ?? '*'}`;
    if (!(Number.isFinite(r.routingUsd) && r.routingUsd >= 0)) { problems.push(`${at}: no finite routingUsd`); continue; }
    if (r.policy !== 'NR-probe') continue;
    const pm = by.get(r.job), all = pm ? [...pm.values()].reduce((a, x) => a + x, 0) : 0;
    if (r.probe && r.probe.ran !== false) {
      checked += 1;
      const ms = Array.isArray(r.probe.modes) && r.probe.modes.length ? r.probe.modes : [...(pm?.keys() ?? [])];
      const measured = ms.reduce((a, m) => a + (pm?.get(m) ?? 0), 0);
      if (!pm) problems.push(`${at}: the card says a probe ran, but the job has no probe rows`);
      else if (r.routingUsd + 1e-9 < measured) problems.push(`${at}: charged $${r.routingUsd} < $${measured.toFixed(6)} measured on its probe rows (${ms.join(', ')})`);
      if (Number.isFinite(r.probe.costUsd) && r.routingUsd + 1e-9 < r.probe.costUsd) problems.push(`${at}: charged $${r.routingUsd} < the card's own probe cost $${r.probe.costUsd}`);
    } else if (pm && r.routingUsd > 0) {
      checked += 1;
      if (r.routingUsd + 1e-9 < all) problems.push(`${at}: charged $${r.routingUsd} < $${all.toFixed(6)} measured on the job's probe rows`);
    } else if (pm) unprobed += 1;
  }
  return { ok: !problems.length, problems: problems.slice(0, 50), more: Math.max(0, problems.length - 50), checked, unprobed, probeJobs: by.size };
}

// ------------------------------------------------------------------------------------------------------- simulation
function normal(r) { const u = r() || 1e-12, v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

/**
 * Power of the primary test at the planned sizes (PREREG §10). Per simulated reading: n clusters, `jobsPerCluster` jobs,
 * `tasks` x `reps` Bernoulli outcomes per mode; the router's mode has success p + Δ_c (Δ_c = Δ + τ·z per cluster), the
 * SBS mode p. Two co-primaries (the second always null), Holm, exact sign-flip test. SUPPORTED-Δ = Holm rejects and the
 * point is >= 0.03: the Δ conditions of SUPPORTED, so its rate bounds the rate of a full SUPPORTED from above.
 */
export function powerSimulation({ clusters = [5, 6, 7, 8], deltas = [0, 0.03, 0.08, 0.15], tau = 0.05, jobsPerCluster = 2, tasks = 12, reps = 2, sims = 2000, seed = 41, alpha = 0.05 } = {}) {
  const out = [];
  for (const n of clusters) for (const delta of deltas) {
    const r = rng(hashString(`${seed}|${n}|${delta}`));
    let sup = 0, anySup = 0, loPos = 0, los = [];
    for (let s = 0; s < sims; s++) {
      const sample = dl => Array.from({ length: n }, () => {
        const dc = dl + tau * normal(r);
        return avg(Array.from({ length: jobsPerCluster }, () => {
          const p = 0.3 + 0.4 * r(), pa = Math.min(1, Math.max(0, p + dc));
          let a = 0, b = 0; for (let k = 0; k < tasks * reps; k++) { a += r() < pa ? 1 : 0; b += r() < p ? 1 : 0; }
          return (a - b) / (tasks * reps);
        }));
      });
      const dA = sample(delta), dB = sample(0);
      const tA = signFlipTest(dA, { alpha }), tB = signFlipTest(dB, { alpha });
      const H = coPrimaryHolm([tA.p, tB.p], alpha);
      const okA = H.reject[0] && tA.mean >= MIN_USEFUL, okB = H.reject[1] && tB.mean >= MIN_USEFUL;
      sup += okA ? 1 : 0; anySup += okA || okB ? 1 : 0;
      const tl = signFlipTest(dA, { alpha: H.level[0] });
      loPos += tl.lo > 0 ? 1 : 0; los.push(tl.lo);
    }
    los = los.filter(Number.isFinite);
    out.push({ clusters: n, delta, sims, pSupportedDelta: sup / sims, pAnySupportedDelta: anySup / sims, pLowerAboveZero: loPos / sims, minP: 2 ** -n, medianLower: los.length ? los.sort((a, b) => a - b)[Math.floor(los.length / 2)] : null });
  }
  return { tau, jobsPerCluster, tasks, reps, alpha, rows: out };
}

/**
 * A synthetic label world with planted truth, for tests and simulations. clusters: [{ id, split, jobs, near? }]; per job
 * `features(r, k)` gives its trusted features and `truth(features, r)` gives per mode { p, q?, c, B? } (q: probability
 * of a delivered wrong answer). Draw modes get `draws[mode]` replicates, lineage modes `lineages[mode]` lineages
 * (with a build row each). Seeds follow the need ranges (TRAIN 610+, held-out 8801+); examples are 601-603.
 */
export function syntheticWorld({ seed = 1, clusters, tasks = 12, modes = ['direct-H', 'agent-H', 'agent-O', 'agent-H+proc', 'construct-H'], features, truth,
  draws = { 'direct-H': 2, 'agent-H': 2, 'agent-O': 1 }, lineages = { 'agent-H+proc': 2, 'construct-H': 3 }, lineageSd = 0 } = {}) {
  const r = rng(seed), rows = [], builds = [], meta = {};
  let k = 0;
  for (const cl of clusters) for (let i = 0; i < cl.jobs; i++, k++) {
    const job = `${cl.id}-j${i}`, f = features(r, k, cl), T = truth(f, r, cl);
    meta[job] = { cluster: cl.id, split: cl.split, family: cl.family ?? cl.id, kind: cl.kind ?? 'oneshot', near: !!cl.near, features: f, exampleSeeds: [601, 602, 603], ...(cl.meta ?? {}) };
    const base = cl.split === 'train' ? 610 : 8801;
    const outcome = (t, rr) => { const x = rr(); return x < t.p ? 'pass' : x < t.p + (t.q ?? 0) ? 'wrong' : 'none'; };
    for (const m of modes) {
      const t = T[m];
      if (!t) continue;
      const L = lineages[m];
      const reps = L ? Array.from({ length: L }, (_, l) => l) : Array.from({ length: draws[m] ?? 1 }, (_, l) => l);
      for (const rep of reps) {
        const tp = L && lineageSd ? { ...t, p: Math.min(1, Math.max(0, t.p + lineageSd * normal(r))) } : t;
        if (L) builds.push({ job, mode: m, rep, usd: t.B ?? 0, failed: false, scoreChecks: 0, probeSeeds: [601 + 3 * rep, 602 + 3 * rep, 603 + 3 * rep], hiddenPathAttempts: 0, nestedModelAttempts: 0 });
        for (let ti = 0; ti < tasks; ti++) {
          const o = outcome(tp, r);
          rows.push({ job, mode: m, task: `t${String(ti).padStart(2, '0')}`, rep, seed: base + ti, taskHash: `h-${job}-${ti}`, pass: o === 'pass', delivered: o !== 'none', schemaValid: true,
            usdRepriced: t.c, usdImputed: 0 });
        }
      }
    }
  }
  return { rows, builds, meta };
}

// --------------------------------------------------------------------------------------------------------- evaluate
const presentCascades = (rows, cascades) => { const present = new Set(rows.map(r => r.mode ?? r.arm)); return cascades.filter(s => present.has(s.primary) && present.has(s.fallback)); };
const withInterval = x => ({ ...x, falsePassCI: x.oracleFail ? clopperPearson(x.falsePass, x.oracleFail, 'two-sided') : null, falseFailCI: x.oraclePass ? clopperPearson(x.falseFail, x.oraclePass, 'two-sided') : null });

/**
 * Labels for one set of rows. The meter is strict (needTable requireRepriced: no fallback from usdRepriced). Self-check
 * credit (F11, K9) is withdrawn per lineage that trips F11, per build path that trips it on THESE rows (pooled over these
 * jobs only), and per build path listed in `inheritF11` (TRAIN's tripped paths, carried into later utility). Pooling never
 * crosses splits: the evaluator builds TRAIN and evaluation rows separately, so held-out outcomes never reach the fit.
 */
function buildLabels({ rows, builds, registry, cascades, labelSet, cells, reps, seed, selfTest = true, inheritF11 = [], strict = true }) {
  let table = withCascades(rows, builds, presentCascades(rows, cascades), { registry, requireRepriced: strict });
  const st0 = selfTestRates(table), st = { ...st0, lineages: st0.lineages.map(withInterval), modes: st0.modes.map(withInterval), inherited: [...inheritF11] };
  const paths = [...new Set([...st.f11, ...inheritF11])];
  // F11 / K9: a lineage (or a whole build path) whose self-check passes too many wrong answers earns no self-check credit.
  const keys = selfTest ? [...st.f11Lineages.map(l => `${l.job}|${l.mode}|${l.rep}`),
    ...table.jobs.flatMap(j => paths.filter(m => table.has(j, m)).flatMap(m => { const c = table.cell(j, m); return c.lineage ? c.lineageList.map(l => `${j}|${m}|${l.rep}`) : [...new Set([...c.reps.values()].flat())].map(r => `${j}|${m}|${r}`); }))] : [];
  if (keys.length) table = withoutSelfCheckCredit(table, keys);
  const modes = labelSetModes(table.modes, labelSet, registry);
  return { table, modes, selfTest: st, noCredit: [...new Set(keys)], labels: needLabels(table, { cells, reps, seed, modes }) };
}

/**
 * The full evaluation. Returns a report object (renderReport prints it). `committed` is the sealed envelope read from
 * --decisions (required for an L6 pass on a non-TRAIN split; its decisions are the ones scored). Leak tests and metamorphic
 * attacks can be switched off for simulations (leak: false).
 *
 * Data flow (review 2026-10-15): every policy is FITTED on labels built from TRAIN rows only (fitOn, the build the envelope
 * seals; per leave-one-cluster-out fold on the fold's training rows only); the evaluated split's rows are labelled
 * separately and only SCORED. The evaluated population is every declared job of the split (jobs.json) and every sealed
 * target of it, under the missing-data rule (PREREG §5): a job without rows or without its full declared menu is dropped
 * and listed, never lost silently. `probes` (label-run probes.jsonl) reconcile NR-probe's routing dollars; `stageInfo`
 * (loadLabels) carries each stage's price table and engine stamp.
 */
export function evaluate({ rows, builds = [], meta, recorded = [], probes = [], stageInfo = [], armFaults = [], split = 'heldout', policies = defaultPolicies(), cells = GRID, reps = 2000, seed = 1, bootReps = 10000,
  l2Perms = 1000, alpha = 0.05, labelSet = 'today', registry = MODES, cascades = CASCADES, committed = null, ledger = null, leak = true, attacks = true, randomDraws = 1000, firstPass = FIRST_PASS,
  envelopeProvenance = undefined }) {
  if (!['train', 'heldout', 'sealed', 'e2e'].includes(split)) throw new Error(`--split must be train, heldout, sealed or e2e, got ${split}`);
  if (!cells.some(c => c.key === HEADLINE.key) || !cells.some(c => c.key === N1.key)) throw new Error('cells must include the headline and the N = 1 cell');
  for (const x of [...rows, ...builds]) { const m = meta[x.job]; if (!m) throw new Error(`job ${x.job} has rows but no jobs.json entry`); if (typeof m.cluster !== 'string' || typeof m.split !== 'string') throw new Error(`job ${x.job}: cluster and split are required`); }
  const clusterOf = j => meta[j].cluster;
  const of = s => x => meta[x.job].split === s;
  const trainRows = rows.filter(of('train')), trainBuilds = builds.filter(of('train'));
  const evalRows = split === 'train' ? [] : rows.filter(of(split)), evalBuilds = split === 'train' ? [] : builds.filter(of(split));
  const ignoredRows = rows.length - trainRows.length - evalRows.length;
  // The fit: TRAIN rows only; with an envelope, at the reps and seed it was sealed with (the same build, so the same fit).
  const fitReps = committed?.payload?.reps ?? reps, fitSeed = committed?.payload?.seed ?? seed;
  if (!trainRows.length) throw new Error('no TRAIN jobs');
  const fit = fitOn({ rows: trainRows, builds: trainBuilds, meta, registry, cascades, labelSet, cells, reps: fitReps, seed: fitSeed, firstPass });
  const TRAIN = fit.TRAIN;
  if (!TRAIN.length) throw new Error('no TRAIN jobs');
  // Scoring labels: TRAIN's own (development split), or the split's rows alone with TRAIN's F11 build paths inherited.
  const P = split === 'train' ? fit.paired : pairable(evalRows, evalBuilds);
  const score = split === 'train' ? (fitReps === reps && fitSeed === seed ? fit.built : buildLabels({ rows: P.rows, builds: P.builds, registry, cascades, labelSet, cells, reps, seed }))
    : buildLabels({ rows: P.rows, builds: P.builds, registry, cascades, labelSet, cells, reps, seed, inheritF11: fit.built.selfTest.f11 });
  const { table, modes, labels } = score;
  let EVAL, droppedEval = [];
  if (split === 'train') EVAL = TRAIN;
  else {
    const declared = [...new Set([...Object.keys(meta).filter(j => meta[j].split === split), ...(committed?.payload?.targets ?? []).filter(j => meta[j]?.split === split)])].filter(j => !isForced(meta[j])).sort();
    const md = missingData(table, declared, meta, { registry, firstPass, gaps: P.gaps });
    EVAL = md.kept; droppedEval = md.dropped;
  }
  const dropped = { train: fit.dropped, eval: droppedEval, line: `dropped ${fit.dropped.length + droppedEval.length}: ${[...fit.dropped, ...droppedEval].map(d => `${d.job} (${d.reason})`).join('; ') || 'none'}` };
  if (!EVAL.length) throw new Error(`no ${split} jobs with labels (${dropped.line})`);
  const FORCED = [...new Set([...fit.table.jobs, ...table.jobs])].filter(j => isForced(meta[j]));
  const trainClusters = [...new Set(TRAIN.map(clusterOf))].sort();
  // Leave-one-cluster-out fits (development split, L3): each fold is fitted on its own training rows only (its F11 too).
  const loco = new Map();
  const locoFit = c => {
    if (!loco.has(c)) {
      const tr = TRAIN.filter(j => clusterOf(j) !== c), keep = x => clusterOf(x.job) !== c;
      loco.set(c, fitOn({ rows: trainRows.filter(keep), builds: trainBuilds.filter(keep), meta, jobs: tr, registry, cascades, labelSet, cells, reps: fitReps, seed: fitSeed, firstPass }));
    }
    return loco.get(c);
  };
  const folds = split === 'train'
    ? trainClusters.map(c => ({ heldOutCluster: c, train: TRAIN.filter(j => clusterOf(j) !== c), eval: TRAIN.filter(j => clusterOf(j) === c) }))
    : [{ train: TRAIN, eval: EVAL }];
  if (split === 'train' && folds.length < 2) throw new Error('leave-one-cluster-out needs at least two TRAIN clusters');
  const fitOf = fold => (fold.heldOutCluster != null ? locoFit(fold.heldOutCluster) : fit);
  const availOf = (j, fm) => menuOf(meta[j], fm, registry);
  const { decisions, fitted, missing } = decideFolds({ labels, meta, folds, policies, modes, cells, registry, recorded, fitOf, availOf, requireRouting: true });
  // A sealed envelope's decisions are the ones scored (L6 then checks them against the recomputed fit and the scored set).
  const peekNames = new Set(policies.filter(p => p.peek).map(p => p.name));
  if (split !== 'train' && Array.isArray(committed?.payload?.decisions)) {
    const env = new Map(committed.payload.decisions.map(d => [`${d.policy}|${d.job}|${d.cell}`, d]));
    for (const [name, byJob] of decisions) {
      if (peekNames.has(name)) continue;
      for (const j of EVAL) {
        const cur = byJob.get(j);
        if (!cur) continue;
        for (const c of cells) { const e = env.get(`${name}|${j}|${c.key}`) ?? env.get(`${name}|${j}|*`); if (e) cur.set(c.key, asDecision(e, labels.modesOf(j), `envelope ${name}/${j}`)); }
      }
    }
  }
  const yard = decisions.get('SBS-train');
  if (!yard) throw new Error('the policy set must include SBS-train (the yardstick)');
  const complete = name => decisions.has(name) && EVAL.every(j => decisions.get(name).has(j));
  const nearClusters = new Set(EVAL.filter(j => meta[j].near).map(clusterOf));
  // Pre-registered substitutes for masked modes (PREREG §7), counted per policy.
  const fallbacks = {};
  for (const [name, byJob] of decisions) {
    let n = 0; const js = new Set();
    for (const j of EVAL) for (const d of byJob.get(j)?.values() ?? []) if (d.fallback) { n += 1; js.add(j); }
    if (n) fallbacks[name] = { decisions: n, jobs: [...js].sort() };
  }

  // Primary and secondary scores, every policy, every cell (fixed order).
  const scores = {};
  for (const [name, dec] of decisions) {
    if (!complete(name)) continue;
    scores[name] = Object.fromEntries(cells.map(c => [c.key, scoreCell(labels, dec, yard, EVAL, clusterOf, c, { alpha, registry })]));
  }
  // Co-primaries: Holm step-down over the two (a missing one counts as p = 1), intervals by test inversion at the Holm level.
  const coP = CO_PRIMARY.map(n => scores[n]?.[HEADLINE.key]?.p ?? 1);
  const H = coPrimaryHolm(coP, alpha);
  const level = Object.fromEntries(CO_PRIMARY.map((n, i) => [n, H.level[i]]));
  const g1 = gateG1(fit.labels, TRAIN, clusterOf, { alpha });   // a TRAIN fact, printed with every split
  const fr = fragility(P.rows, P.builds, { tolerance: j => meta[j]?.tolerance ?? null, cells: [HEADLINE, N1], modes, makeTable: (r, b, o) => withCascades(r, b, presentCascades(r, cascades), o), tableOpts: { registry, requireRepriced: true } });
  // L2 before the readings: a SUPPORTED or SUPERIOR NR-static must beat its shuffled-label null.
  const L2 = leak ? shuffledNull({ labels, meta, folds, policy: policies.find(p => p.name === 'NR-static'), modes, registry, yard, evalJobs: EVAL, clusterOf, perms: l2Perms, seed: seed + 13,
    real: scores['NR-static']?.[HEADLINE.key]?.delta ?? null, fitOf, availOf }) : null;
  const primary = {};
  CO_PRIMARY.forEach((n, i) => {
    if (!complete(n)) { primary[n] = { present: false, reading: 'NOT RUN', missing: missing.get(n) ?? EVAL }; return; }
    const a = level[n], dec = decisions.get(n);
    const at = c => { const t = signFlipTest(clusterMeans(scores[n][c.key].perJob, ['diff']).map(x => x.diff), { alpha: a }); return { V: c.V, mean: t.mean, lo: t.lo, hi: t.hi }; };
    const headline = at(HEADLINE), perV = V_GRID.map(V => at(makeCell(V, 10, 1)));
    const vsTuned = complete('tuned-size-rule') ? pairedPolicies(labels, dec, decisions.get('tuned-size-rule'), EVAL, clusterOf, HEADLINE, { alpha: a }) : null;
    const vsJudge = complete('judge-H') ? pairedPolicies(labels, dec, decisions.get('judge-H'), EVAL, clusterOf, HEADLINE, { alpha: a }) : null;
    const slider = sliderCalibration(labels, dec, EVAL);
    const far = EVAL.filter(j => !nearClusters.has(clusterOf(j)));
    const withoutNear = nearClusters.size ? { mean: far.length ? avg(clusterMeans(scores[n][HEADLINE.key].perJob.filter(x => far.includes(x.job)), ['diff']).map(x => x.diff)) : null, dropped: [...nearClusters] } : null;
    const s = scores[n][HEADLINE.key];
    const dropOne = s.perCluster.map(c => ({ dropped: c.cluster, lo: signFlipTest(s.perCluster.filter(x => x.cluster !== c.cluster).map(x => x.delta), { alpha: a }).lo }));
    const boot = bootReps > 0 ? clusterBootstrapDelta(table, EVAL.map(j => ({ job: j, cluster: clusterOf(j), a: dec.get(j).get(HEADLINE.key).mode, b: yard.get(j).get(HEADLINE.key).mode, routingUsd: dec.get(j).get(HEADLINE.key).routingUsd })), HEADLINE, { reps: bootReps, seed: seed + 7 }) : null;
    const vsNull = n === 'NR-static' && L2 ? L2 : undefined;
    primary[n] = { present: true, holmLevel: a, holmAdjustedP: H.adjusted[i], holmReject: H.reject[i], headline, perV, vsTuned, vsJudge, slider, withoutNear, dropOneCluster: dropOne,
      minDropOneLower: Math.min(...dropOne.map(x => x.lo)), clusterBootstrap: boot, vsNull: vsNull ? { assessed: vsNull.assessed, realExceeds95: vsNull.realExceeds95 ?? null } : null,
      random: randomMatched(labels, dec, yard, EVAL, clusterOf, HEADLINE, { draws: randomDraws, seed: seed + 11 }),
      ...readingOf({ headline, perV, vsTuned, vsJudge, slider, withoutNear, g1: g1?.verdict, holmReject: H.reject[i], vsNull }) };
  });
  // C7a: need detection at N = 1 (H0's intrinsic call) and N = 10, with the comparators; the exact joint interval (PREREG §7).
  const c7a = {};
  for (const n of [...CO_PRIMARY, 'tuned-size-rule', 'fixed-size-rule', 'NONE_RULE', 'keyword', 'NR-knn', 'judge-H']) if (complete(n)) c7a[n] = { N1: needDetection(labels, decisions.get(n), EVAL, N1, { fragile: fr.fragile, registry }), N10: needDetection(labels, decisions.get(n), EVAL, HEADLINE, { fragile: fr.fragile, registry }) };
  const majority = (() => { const conf = EVAL.filter(j => labels.at(j, N1).confident && !fr.fragile.includes(j)); const w = conf.filter(j => labels.at(j, N1).label === 'workflow').length; return { used: conf.length, majorityClass: w * 2 > conf.length ? 'workflow' : 'no-workflow', balancedAccuracy: 0.5 }; })();
  let c7aDetail = null;
  if (c7a['NR-static']) {
    const fitStatus = thetaFitStatus(TRAIN.filter(j => fit.labels.at(j, N1).confident).map(j => ({ job: j, cluster: clusterOf(j), workflow: fit.labels.at(j, N1).label === 'workflow' })));
    const nd = c7a['NR-static'].N1, tunedN1 = c7a['tuned-size-rule']?.N1 ?? null;
    let withoutNear;
    if (nearClusters.size) {
      const far = EVAL.filter(j => !nearClusters.has(clusterOf(j)));
      if (!far.length) withoutNear = null;
      else {
        const a = needDetection(labels, decisions.get('NR-static'), far, N1, { fragile: fr.fragile, registry }), b = complete('tuned-size-rule') ? needDetection(labels, decisions.get('tuned-size-rule'), far, N1, { fragile: fr.fragile, registry }) : null;
        withoutNear = { h0: a.counts, tunedPoint: b?.balancedAccuracy?.point ?? null, coverage: a.coverage.coverage };
      }
    }
    c7aDetail = readC7a({ h0: nd.counts, tunedPoint: tunedN1?.balancedAccuracy?.point ?? null, coverage: nd.coverage.coverage, withoutNear, fit: fitStatus });
    c7a.reading = c7aDetail.reading;
    c7a.why = c7aDetail.why ?? null;
    c7a.h0Fit = fitStatus;
  }
  // Value decomposition (headline): always-agent-H -> SBS-global -> SBS(cell) -> router -> VBS*.
  const at = (n, k) => scores[n]?.[HEADLINE.key]?.[k] ?? null;
  const decomposition = { 'always-agent-H': at('always-agent-H', 'router'), 'SBS-global': at('SBS-global', 'router'), 'SBS(V,N)': at('SBS-train', 'router'),
    'NR-static': at('NR-static', 'router'), 'NR-probe': at('NR-probe', 'router'), 'VBS*': at('SBS-train', 'vbsStar'), VBS: at('SBS-train', 'vbs') };
  // Convex hull of the fixed modes in (cost, success) at the headline; each policy's distance above it.
  const fixedPts = modes.filter(m => complete(`always-${m}`)).map(m => ({ mode: m, x: scores[`always-${m}`][HEADLINE.key].realized.usdPerTask, y: scores[`always-${m}`][HEADLINE.key].realized.success }));
  const hull = upperHull(fixedPts);
  const hullGap = Object.fromEntries(Object.keys(scores).map(n => { const r = scores[n][HEADLINE.key].realized, h = hullAt(hull, r.usdPerTask); return [n, { usdPerTask: r.usdPerTask, success: r.success, hull: h, aboveHull: h === null ? null : r.success - h }]; }));
  // Validity: voids (lineages and agent draws), env faults, self-test (F11, TRAIN and evaluated rows apart), fragility,
  // coverage, dropped jobs, substitutes, routing dollars, the meter; forced stratum; L_ceiling builder gap.
  const tables = split === 'train' ? [fit.table] : [fit.table, table];
  const notCascade = v => !modeInfo(v.mode, registry).cascade;
  // K4: env-fault codes on rows (envFaults), plus label-run's fault table (armFaults: faulted attempts never reach rows).
  const tableJobs = new Set(tables.flatMap(t => t.jobs));
  const ef = [...tables.flatMap(t => envFaults(t)), ...armFaults.filter(x => tableJobs.has(x.job) && x.invalid)
    .map(x => ({ job: x.job, mode: x.mode, rows: x.trialAttempts, faulted: x.trialFaults, share: x.share, buildAttempts: x.buildAttempts, buildFaults: x.buildFaults, buildShare: x.buildShare, invalid: true, source: 'arm-faults' }))];
  const voidedLineages = tables.flatMap(t => t.voided).filter(notCascade), voidedDraws = tables.flatMap(t => t.voidedDraws ?? []).filter(notCascade);
  const routing = routingChecks(recorded, probes, { jobs: new Set(EVAL) });
  const usedStages = (stageInfo ?? []).filter(x => (x.splits ?? []).some(sp => sp === 'train' || sp === split));
  // One meter: the stages' price tables (report.json) and the rows' and builds' own (stamp.priceTable), TRAIN and evaluated together.
  const priceTables = [...new Set([...usedStages.map(x => x.priceTable), ...tables.flatMap(t => t.priceTables ?? [])].filter(x => x != null))].sort();
  const meter = { priceTables, unstamped: usedStages.filter(x => !x.stamp).map(x => x.stage), problems: priceTables.length > 1 ? [`rows priced with ${priceTables.length} price tables (${priceTables.join(', ')}): one meter is required`] : [] };
  const validity = { voided: voidedLineages, voidedDraws, invalidArms: ef.filter(x => x.invalid),
    selfTest: { train: fit.built.selfTest, eval: split === 'train' ? null : score.selfTest, f11: { train: fit.built.selfTest.f11, eval: split === 'train' ? [] : score.selfTest.f11 } },
    noSelfCheckCredit: { train: fit.built.noCredit.length, eval: split === 'train' ? 0 : score.noCredit.length }, fragility: fr,
    coverage: { headline: coverage(labels, EVAL, HEADLINE), N1: coverage(labels, EVAL, N1) },
    benchmarkCannotSeparate: coverage(labels, EVAL, HEADLINE).confident / EVAL.length < 0.5,
    imputedUnlabelled: EVAL.filter(j => labels.at(j, HEADLINE).unlabelled).length, dropped, fallbacks, routing, meter, ignoredRows };
  const forced = FORCED.length ? { jobs: FORCED, note: 'forced stratum: guard recall only, never in the primary population' } : null;
  let ceiling = null;
  if (labelSet === 'today' && table.modes.some(m => modeInfo(m, registry).ceiling)) {
    const L2c = needLabels(table, { cells: [HEADLINE, N1], reps: Math.min(reps, 500), seed, modes: labelSetModes(table.modes, 'ceiling', registry) });
    ceiling = EVAL.map(j => ({ job: j, today: labels.at(j, N1).label, ceiling: L2c.at(j, N1).label, routerSaysWorkflow: decisions.get('NR-static')?.get(j)?.get(N1.key)?.needsWorkflow ?? null }))
      .map(x => ({ ...x, builderGap: x.routerSaysWorkflow === true && x.today !== 'workflow' && x.ceiling === 'workflow' }));
  }
  // Leak tests L1-L8 (F6: any failure of L1-L7 blocks every claim; L8 demotes NR-knn).
  let leaks = null;
  if (leak) {
    const peek = scores.peek?.[HEADLINE.key];
    const L1 = { ok: peek ? peek.closedGapVBS === null || peek.closedGapVBS >= 0.95 : false, closedGapVBS: peek?.closedGapVBS ?? null, note: peek?.closedGapVBS === null ? 'no headroom: the control cannot fail' : undefined };
    let L3 = { ok: true, assessed: false };
    if (trainClusters.length >= 2) {
      const lf = trainClusters.map(c => ({ heldOutCluster: c, train: TRAIN.filter(j => clusterOf(j) !== c), eval: TRAIN.filter(j => clusterOf(j) === c) }));
      const d = decideFolds({ labels: fit.labels, meta, folds: lf, policies: [familyIdentityRouter(), sbsTrain()], modes: fit.modes, cells: [HEADLINE], registry, fitOf: f => locoFit(f.heldOutCluster), availOf });
      const s = scoreCell(fit.labels, d.decisions.get('family-identity'), d.decisions.get('SBS-train'), TRAIN, clusterOf, HEADLINE, { alpha, registry });
      L3 = { ok: s.delta <= 1e-9, assessed: true, delta: s.delta, closedGap: s.closedGap };
    }
    const seedsOk = tables.map(t => seedChecks(t, meta, { ledger }));
    const L4 = { ok: seedsOk.every(x => x.ok), problems: seedsOk.flatMap(x => x.problems), notChecked: seedsOk.flatMap(x => x.notChecked) };
    const L5 = importPurity();
    let L6 = { ok: true, assessed: false, note: 'development split: no envelope' };
    if (split !== 'train') {
      const scored = [];
      for (const [name, byJob] of decisions) if (!peekNames.has(name)) for (const j of EVAL) for (const [ck, d] of byJob.get(j) ?? []) scored.push({ policy: name, job: j, cell: ck, mode: d.mode, routingUsd: d.routingUsd, needsWorkflow: d.needsWorkflow });
      const recomputed = sealDecisions({ fit, rows: trainRows, builds: trainBuilds, meta, recorded, policies, cells, reps: fitReps, seed: fitSeed, registry, labelSet, createdAt: committed?.createdAt ?? null, stageInfo });
      L6 = verifyEnvelope(committed, recomputed, { firstHeldoutRowAt: evalRows.filter(r => r.at).map(r => r.at).sort()[0] ?? null, scored, accounted: new Set([...EVAL, ...droppedEval.map(x => x.job)]), split, meta,
        provenance: envelopeProvenance });
    }
    const iso = [buildIsolation(trainBuilds, fit.table, meta), ...(split === 'train' ? [] : [buildIsolation(evalBuilds, table, meta)])];
    const L7 = { ok: iso.every(x => x.ok), problems: iso.flatMap(x => x.problems) };
    const knn = fitted.get('NR-knn')?.[fitted.get('NR-knn').length - 1];
    const L8 = split === 'train' ? { ok: true, assessed: false, note: 'L8 reads held-out jobs' } : nearestClusterTest(knn, EVAL.map(j => ({ job: j, view: publicView(j, meta[j], menuOf(meta[j], fit.modes, registry)) })));
    leaks = { L1, L2, L3, L4, L5, L6, L7, L8, f6: [L1, L2, L3, L4, L5, L6, L7].some(x => x.ok === false) };
  }
  // Metamorphic attacks with routers fitted on every TRAIN job (the frozen artefact).
  let metamorph = null;
  if (attacks) {
    const ctx = makeContext(fit.labels, TRAIN, meta, { modes: fit.modes, registry });
    metamorph = {};
    for (const p of policies.filter(x => ['primary', 'secondary', 'baseline'].includes(x.role) && !x.fixed && !x.peek)) {
      const ch = p.fit(ctx);
      metamorph[p.name] = metamorphic(ch, EVAL, { meta, labels, policy: p, modesOf: j => menuOf(meta[j], fit.modes, registry) });
    }
  }
  const blocked = [];
  if (leaks?.f6) blocked.push('F6: a leak test failed; the evaluator is invalid');
  if (voidedLineages.length) blocked.push(`${voidedLineages.length} voided lineage(s): claims blocked until rerun`);
  if (voidedDraws.length) blocked.push(`${voidedDraws.length} voided agent draw(s) (nested-model or hidden-path attempts): claims blocked until rerun`);
  if (validity.invalidArms.length) blocked.push(`${validity.invalidArms.length} arm(s) over the 25% environment-fault limit`);
  if (!routing.ok) blocked.push(`routing dollars: ${routing.problems.length + routing.more} problem(s) (a charge below the probe rows it used)`);
  for (const p of meter.problems) blocked.push(`meter: ${p}`);
  return {
    schema: 'need-evaluation/1', split, grade: split === 'train' ? 'development (leave-one-cluster-out on TRAIN)' : split === 'heldout' ? 'held-out' : split,
    labelSet, cells: cells.map(c => c.key), headline: HEADLINE.key, modes,
    jobs: { train: TRAIN.length, eval: EVAL.length, forced: FORCED.length, clusters: [...new Set(EVAL.map(clusterOf))].length, dropped: fit.dropped.length + droppedEval.length },
    folds: folds.map(f => ({ heldOutCluster: f.heldOutCluster ?? null, train: f.train.length, eval: f.eval.length })), missingRecorded: Object.fromEntries([...missing].filter(([, v]) => v.length)),
    fittedRule: fitted.get('NR-static')?.map(f => f.fitted) ?? null, primary,
    holm: { pValues: Object.fromEntries(CO_PRIMARY.map((n, i) => [n, coP[i]])), adjusted: H.adjusted, reject: Object.fromEntries(CO_PRIMARY.map((n, i) => [n, H.reject[i]])), levels: level },
    c7a: { ...c7a, majority, detail: c7aDetail }, g1, scores, decomposition, hull: { points: fixedPts, hull, gap: hullGap }, validity, forced, ceiling, leaks, metamorph,
    falsifiers: { F5: metamorph ? Object.fromEntries(CO_PRIMARY.filter(n => metamorph[n]).map(n => [n, metamorph[n].f5])) : null, F6: leaks?.f6 ?? null,
      F11: validity.selfTest.f11, F12: c7aDetail ? c7aDetail.f12 === true : null }, blocked,
  };
}

/**
 * L2: refit the policy on TRAIN labels permuted among jobs with the same mode set; Δ at the headline per permutation.
 * ok (the leak test, F6) = the null is centred at or below 0 (mean <= `tolerance`, 0 unless the preregistration records
 * another); `realExceeds95` (the real router above the null's 95th percentile) is a condition of a SUPPORTED or SUPERIOR
 * reading (readingOf), not of the leak test. Each fold refits on its own fitting labels (`fitOf`, as decideFolds).
 */
export function shuffledNull({ labels, meta, folds, policy, modes, registry, yard, evalJobs, clusterOf, perms = 1000, seed = 13, real = null, tolerance = 0, fitOf = null, availOf = null }) {
  if (!policy || perms <= 0) return { ok: true, assessed: false };
  const r = rng(seed), xs = [];
  for (let b = 0; b < perms; b++) {
    const dec = new Map();
    for (const fold of folds) {
      const fit = fitOf ? fitOf(fold) : { labels, modes };
      const groups = new Map();
      for (const j of fold.train) { const k = fit.labels.modesOf(j).join('|'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(j); }
      const perm = new Map();
      for (const g of groups.values()) { const s = [...g]; for (let i = s.length - 1; i > 0; i--) { const k = Math.floor(r() * (i + 1)); [s[i], s[k]] = [s[k], s[i]]; } g.forEach((j, i) => perm.set(j, s[i])); }
      const choose = policy.fit(makeContext(fit.labels, fold.train, meta, { modes: fit.modes, registry, permutation: perm }));
      for (const j of fold.eval) {
        const avail = availOf ? availOf(j, fit.modes) : labels.modesOf(j).filter(m => fit.modes.includes(m));
        dec.set(j, new Map([[HEADLINE.key, asDecision(choose(publicView(j, meta[j], avail), HEADLINE), avail, `L2/${policy.name}`)]]));
      }
    }
    xs.push(scoreCell(labels, dec, yard, evalJobs, clusterOf, HEADLINE, { registry }).delta);
  }
  const s = [...xs].sort((a, b) => a - b), mean = avg(xs), q95 = s[Math.floor(0.95 * (s.length - 1))];
  const sd = Math.sqrt(avg(xs.map(x => (x - mean) ** 2)));
  return { ok: mean <= tolerance, assessed: true, perms, nullMean: mean, nullMedian: s[Math.floor(s.length / 2)], null95: q95, mcse: sd / Math.sqrt(perms), real,
    realExceeds95: real === null ? null : real > q95, tolerance };
}

// --------------------------------------------------------------------------------------------------------- report
const f3 = x => (x === null || x === undefined ? '–' : x === Infinity ? '+inf' : x === -Infinity ? '-inf' : typeof x === 'number' ? x.toFixed(3) : String(x));
export function renderReport(R) {
  const L = [];
  L.push(`need router v1 evaluation: ${R.grade}; label set L_${R.labelSet}; headline ${R.headline}`);
  L.push(`jobs: ${R.jobs.train} TRAIN, ${R.jobs.eval} evaluated in ${R.jobs.clusters} cluster(s), ${R.jobs.forced} forced (own stratum)`);
  if (R.blocked.length) for (const b of R.blocked) L.push(`BLOCKED: ${b}`);
  if (R.validity.dropped.train.length || R.validity.dropped.eval.length) L.push(`DROPPED (PREREG §5 missing data; rows kept, not scored): ${R.validity.dropped.line}`);
  if (Object.keys(R.validity.fallbacks).length) L.push(`SUBSTITUTES (PREREG §7 masked modes): ${Object.entries(R.validity.fallbacks).map(([n, x]) => `${n} ${x.decisions} decision(s) on ${x.jobs.length} job(s)`).join('; ')}`);
  L.push('', 'PRIMARY (C7b): Δ = mean over clusters of (u_policy − u_SBS-train), success-equivalents per task, exact sign-flip test, Holm over 2');
  for (const [n, p] of Object.entries(R.primary)) {
    if (!p.present) { L.push(`  ${n}: NOT RUN (${(p.missing ?? []).length} job(s) without decisions)`); continue; }
    L.push(`  ${n}: Δ ${f3(p.headline.mean)} [${f3(p.headline.lo)}, ${f3(p.headline.hi)}] at one-sided ${(1 - p.holmLevel) * 100}%; Holm p ${f3(p.holmAdjustedP)} (${p.holmReject ? 'rejects' : 'does not reject'}) -> ${p.reading}${p.usefulSizeShown ? ' (useful size shown)' : ''}`);
    for (const u of p.unmet) L.push(`      unmet: ${u}`);
    L.push(`      per V: ${p.perV.map(x => `$${x.V}: ${f3(x.mean)} [${f3(x.lo)}, ${f3(x.hi)}]`).join('; ')}; drop-one-cluster min lower ${f3(p.minDropOneLower)}; cluster bootstrap [${f3(p.clusterBootstrap?.lo)}, ${f3(p.clusterBootstrap?.hi)}]`);
    L.push(`      random at matched mix: expectation ${f3(p.random.expectation)}, simulated ${f3(p.random.mean)} (95th ${f3(p.random.q95)}); slider ${p.slider.calibrated ? 'calibrated' : 'NOT calibrated'} (${p.slider.misses} miss(es), monotone ${p.slider.monotone})`);
  }
  if (R.g1) L.push('', `GATE G1 (TRAIN headroom VBS* − SBS): ${R.g1.verdict}${R.g1.note ? ` (${R.g1.note})` : ''}`, ...R.g1.cells.map(c => `  ${c.cell}: SBS ${c.sbs}, headroom ${f3(c.headroom)} exact [${f3(c.lo)}, ${f3(c.hi)}], cluster bootstrap [${f3(c.bootstrap?.lo)}, ${f3(c.bootstrap?.hi)}]`));
  L.push('', 'C7a (need detection; confident non-fragile labels; Wilson-based intervals; coverage beside accuracy)');
  for (const [n, x] of Object.entries(R.c7a)) if (x?.N1) L.push(`  ${n.padEnd(16)} N=1 BA ${f3(x.N1.balancedAccuracy?.point)} [${f3(x.N1.balancedAccuracy?.lo)}, ${f3(x.N1.balancedAccuracy?.hi)}] on ${x.N1.used}, coverage ${f3(x.N1.coverage.coverage)}; N=10 BA ${f3(x.N10.balancedAccuracy?.point)}`);
  if (R.c7a.reading) L.push(`  reading (H0): ${R.c7a.reading}${R.c7a.why ? ` (${R.c7a.why})` : ''}; interval: exact joint (PREREG §7)`);
  L.push('', 'VALUE DECOMPOSITION (headline, mean u)', `  ${Object.entries(R.decomposition).map(([k, v]) => `${k} ${f3(v)}`).join(' -> ')}`);
  L.push('', 'ALL POLICIES, ALL CELLS (not primary except the headline row of the co-primaries)');
  for (const [n, byCell] of Object.entries(R.scores)) {
    const h = byCell[R.headline];
    L.push(`  ${n.padEnd(22)} Δ ${f3(h.delta)} [${f3(h.lo)}, ${f3(h.hi)}] closed gap ${f3(h.closedGap)} regret ${f3(h.regret)} mode-in-A ${f3(h.modeAccuracy)} workflow share ${f3(h.workflowShare)}; ${Object.entries(byCell).filter(([k]) => k !== R.headline).slice(0, 6).map(([k, s]) => `${k}: ${f3(s.delta)}`).join('; ')}`);
  }
  const V = R.validity;
  L.push('', 'VALIDITY', `  voided lineages ${V.voided.length}; voided agent draws ${V.voidedDraws.length}; invalid arms ${V.invalidArms.length}; F11 build paths: TRAIN ${V.selfTest.f11.train.join(', ') || 'none'}, evaluated ${V.selfTest.f11.eval.join(', ') || 'none'}; fragile jobs ${V.fragility.fragile.length}; coverage ${f3(V.coverage.headline.coverage)}${V.benchmarkCannotSeparate ? ' (the benchmark cannot separate routers)' : ''}`,
    `  routing dollars: ${V.routing.ok ? 'reconciled' : 'PROBLEMS'} (${V.routing.checked} NR-probe charge(s) checked against ${V.routing.probeJobs} job(s) with probe rows; ${V.routing.unprobed} not probed)${V.routing.problems.length ? `: ${V.routing.problems.slice(0, 3).join('; ')}` : ''}`,
    `  meter: price tables ${V.meter.priceTables.join(', ') || 'not recorded'}; stages without an engine stamp ${V.meter.unstamped.join(', ') || 'none'}; rows of other splits ignored ${V.ignoredRows}`,
    ...(V.fragility.untested.length ? [`  fragility not testable (delivered rows with a tolerance spec but no score): ${V.fragility.untested.join(', ')} (${V.fragility.unscored.length} row(s))`] : []));
  if (R.leaks) L.push('', `LEAK TESTS (F6 ${R.leaks.f6 ? 'TRIPPED' : 'clear'})`, ...['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'].map(k => `  ${k}: ${R.leaks[k].ok === false ? 'FAIL' : R.leaks[k].assessed === false ? 'not assessed' : 'ok'}${R.leaks[k].problems?.length ? ` (${R.leaks[k].problems.slice(0, 3).join('; ')})` : ''}${k === 'L8' && R.leaks.L8.demote ? ' (NR-knn demoted to family-majority)' : ''}${k === 'L6' && R.leaks.L6.provenance ? `; provenance ${R.leaks.L6.provenance}` : ''}`));
  if (R.metamorph) { L.push('', 'METAMORPHIC ATTACKS'); for (const [n, m] of Object.entries(R.metamorph)) L.push(`  ${n.padEnd(18)} pairs ${m.pairsOk ? 'ok' : 'FAIL'}; pad flips ${f3(m.pad.flipRate)}; injection ${f3(m.inject.flipRate)}; paraphrase ${m.paraphrase.n ? f3(m.paraphrase.flipRate) : '–'}; N-monotone violations ${m.monotone.violations}${m.f5 ? '; F5 TRIPPED' : ''}`); }
  return L.join('\n');
}

// ------------------------------------------------------------------------------------------------------------- CLI
async function loadRouterPolicies(file) {
  if (!file) return defaultPolicies();
  const mod = await import(pathToFileURL(path.resolve(file)).href);
  if (!Array.isArray(mod.policies)) throw new Error(`${file} must export \`policies\` (an array of { name, role, fit })`);
  const by = new Map(defaultPolicies().map(p => [p.name, p]));
  for (const p of mod.policies) by.set(p.name, p);
  return [...by.values()];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; }, num = (k, d) => Number(arg(k, d));
  if (argv.includes('--power')) {
    const P = powerSimulation({ sims: num('--sims', 2000) });
    if (argv.includes('--json')) console.log(JSON.stringify(P, null, 1));
    else { console.log(`power of the primary test (τ ${P.tau}, ${P.jobsPerCluster} jobs x ${P.tasks} tasks x ${P.reps} reps per cluster; Holm over 2; SUPPORTED-Δ bounds SUPPORTED)`); for (const r of P.rows) console.log(`  clusters ${r.clusters}  Δ ${r.delta.toFixed(2)}  P(SUPPORTED-Δ) ${r.pSupportedDelta.toFixed(3)}  P(lower > 0) ${r.pLowerAboveZero.toFixed(3)}  min p ${r.minP.toFixed(4)}`); }
    process.exit(0);
  }
  const root = arg('--labels', null);
  if (!root) { console.error(`usage: evaluate.mjs --labels <dir> --split <train|heldout> --report <dir> | --labels <dir> --commit-decisions <out.json> | --power\n\n${MATRIX_FORMAT}`); process.exit(2); }
  const policies = await loadRouterPolicies(arg('--router', null));
  const commitOut = arg('--commit-decisions', null);
  if (commitOut) {
    if (existsSync(commitOut)) { console.error(`refusing to overwrite a sealed envelope: ${commitOut}`); process.exit(3); }
    const L = loadLabels(root, { trainOnly: true });
    const env = commitDecisions({ rows: L.rows, builds: L.builds, meta: L.meta, recorded: L.decisions, policies, reps: num('--reps', 2000), seed: num('--seed', 1), stageInfo: L.stageInfo });
    mkdirSync(path.dirname(path.resolve(commitOut)), { recursive: true });
    writeFileSync(commitOut, JSON.stringify(env, null, 1) + '\n');
    writeFileSync(`${commitOut}.sha256`, `${env.sha256}\n`);
    console.log(`sealed ${env.payload.decisions.length} decisions for ${env.payload.targets.length} job(s); sha256 ${env.sha256}; skipped ${L.skipped.stages.length} stage(s) and ${L.skipped.rows} non-TRAIN row(s) unread`);
    process.exit(0);
  }
  const split = arg('--split', 'heldout'), decFile = arg('--decisions', null);
  // A development reading never opens held-out rows; a held-out (sealed, e2e) reading needs the sealed envelope (L6).
  if (split !== 'train' && !decFile) { console.error(`--split ${split} joins non-TRAIN labels: it needs --decisions <the committed envelope> (L6); refusing`); process.exit(2); }
  const L = loadLabels(root, { trainOnly: split === 'train' });
  const committed = decFile ? JSON.parse(readFileSync(decFile, 'utf8')) : null;
  // A held-out reading always checks the envelope's provenance (L6): its git commit time and history, the A-Freeze shas of
  // the preregistration (--prereg, default PREREG-NEED-V1.md) and the held-out stages' launch records.
  const preregFile = path.resolve(arg('--prereg', PREREG_FILE));
  const envelopeProvenanceRec = decFile ? envelopeProvenance({ decFile, preregText: existsSync(preregFile) ? readFileSync(preregFile, 'utf8') : null, stageInfo: L.stageInfo, split }) : undefined;
  const R = evaluate({ rows: L.rows, builds: L.builds, meta: L.meta, recorded: L.decisions, probes: L.probes, stageInfo: L.stageInfo, armFaults: L.armFaults, split, policies, committed,
    reps: num('--reps', 2000), bootReps: num('--boot', 10000), l2Perms: num('--perms', 1000), seed: num('--seed', 1), labelSet: arg('--label-set', 'today'), envelopeProvenance: envelopeProvenanceRec });
  const text = renderReport(R), out = arg('--report', null);
  if (out) {
    mkdirSync(out, { recursive: true });
    const { scores, ...rest } = R;
    writeFileSync(path.join(out, 'report.json'), JSON.stringify({ ...rest, scores: Object.fromEntries(Object.entries(scores).map(([n, c]) => [n, Object.fromEntries(Object.entries(c).map(([k, s]) => [k, { ...s, perJob: undefined }]))])) }, null, 1) + '\n');
    writeFileSync(path.join(out, 'report.txt'), text + '\n');
  }
  console.log(text);
}
