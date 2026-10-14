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
// clusters and decides the held-out one; its SBS is chosen on the same training clusters). --split heldout fits on every
// TRAIN job and decides the held-out jobs. Forced jobs (a typed hard requirement) are their own stratum, never primary.
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
  rng, hashString, MODES, CASCADES, GRID, HEADLINE, SLIDER_CELLS, V_GRID, DELTA, makeCell, cellKey, classOf, modeInfo, labelSetModes,
  withCascades, withoutSelfCheckCredit, needLabels, rankModes, bestOf, sbsGlobal, coverage, fragility, selfTestRates, envFaults,
  signFlipTest, clusterBootstrapDelta,
} from './metrics.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

/** The router's trusted structure features (DESIGN §1): the 12-key census whitelist minus the four prose counts. */
export const TRUSTED_FEATURES = Object.freeze(['logInputTokens', 'logSchemaLeaves', 'itemLists', 'maxListLength', 'freeText', 'multiSource', 'conventionsInProse', 'verifiable']);
/** Prose counts of untrusted task text: inputs to the keyword baseline only. */
export const PROSE_FEATURES = Object.freeze(['effectVerbs', 'timeWords', 'humanWords', 'promptWords']);
export const MIN_USEFUL = 0.03;                     // minimum useful effect, success-equivalents per task (decision 1)
export const CO_PRIMARY = Object.freeze(['NR-static', 'NR-probe']);
export const N1 = makeCell(1, 1, 1);                // the intrinsic-need reading (C7a): V = $1, W = V, N = 1
export const SEED_RANGES = Object.freeze({ example: [601, 609], train: [610, 650], heldout: [8801, 8824], e2e: [8825, 8836], drift: [8837, 8848] });
export const MATRIX_FORMAT = `A labels root holds one directory per stage (or is one): jobs.json, matrix.jsonl, builds.jsonl, decisions.jsonl.
jobs.json      { "<job>": { cluster, split: train|heldout|sealed|e2e, family, kind?, band?, forced?, near?, features: {<8 trusted keys>, <prose keys>?},
                 requirements?: [typed hard requirements], verifier?, modes?|masked?, text?, paraphrases?, exampleSeeds?, exampleHashes?,
                 tolerance?: { scoreThreshold }, metamorph?: { of: <job>, expect: same|different } } }   (label-free; written before labels)
matrix.jsonl   one row per job x mode x task x replicate: { job, mode, task, rep, seed, taskHash, pass, delivered, schemaValid, selfVerdict,
                 deployableVerdict, score?, passAt?, usdRepriced, usdReported, usdImputed, ms, tokens, error, at? }   (metrics.mjs needTable)
builds.jsonl   one row per job x built/guided mode x lineage: { job, mode, rep, usd, usdImputed?, failed, minutes, artifactSha, runSolverCalls,
                 hiddenPathAttempts, nestedModelAttempts, scoreChecks, probeSeeds }
decisions.jsonl recorded policies: { policy: judge-H|NR-probe|NR-probe-oracle, job, cell: <cell key>|null, mode, routingUsd, pred?: {p, usd}, needsWorkflow? }`;

const avg = xs => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);
const opaque = id => `j${createHash('sha256').update(String(id)).digest('hex').slice(0, 12)}`;
const firstAvailable = (prefs, available) => { const m = prefs.find(x => available.includes(x)); if (!m) throw new Error(`none of ${prefs.join(', ')} is available (${available.join(', ')})`); return m; };

// ----------------------------------------------------------------------------------------------------------- loading
const readJsonl = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map((l, i) => { try { return JSON.parse(l); } catch { throw new Error(`${file}:${i + 1}: not JSON`); } }) : []);

/**
 * Read a labels root. trainOnly (the sealed envelope, L6): matrix and build rows of non-TRAIN jobs are never kept, and a
 * stage directory without a TRAIN job is not opened beyond its jobs.json and decisions.jsonl (label-free files).
 */
export function loadLabels(root, { trainOnly = false } = {}) {
  const dirs = existsSync(path.join(root, 'jobs.json')) ? [root]
    : readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => path.join(root, d.name)).filter(d => existsSync(path.join(d, 'jobs.json'))).sort();
  const meta = {}, rows = [], builds = [], decisions = [], skipped = { stages: [], rows: 0 }, stages = [];
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
    for (const [file, out] of [['matrix.jsonl', rows], ['builds.jsonl', builds]]) for (const r of readJsonl(path.join(dir, file))) {
      if (trainOnly && meta[r.job]?.split !== 'train') { skipped.rows += 1; continue; }
      out.push(r);
    }
  }
  return { meta, rows, builds, decisions, stages, skipped };
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
const jobModes = (m, defaults) => (m?.modes ? defaults.filter(x => m.modes.includes(x)) : defaults.filter(x => !(m?.masked ?? []).includes(x)));

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
  return { train, modes, registry, classOf: m => classOf(m, registry), peek: evalPeek };
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
    return { mode, pred: { p: e.p, usd: e.usd }, leafSize: r.size };
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
          return { mode: r.mode, pred: r.pred, needsWorkflow: true, guard: { forced: true, requirement: view.requirements[0] } };
        }
        const k = intrinsic(view) ? 'intrinsic' : 'not', r = leaf(k, cell, view.modes);
        return { mode: r.mode, pred: r.pred, needsWorkflow: k === 'intrinsic', structure: { intrinsic: k === 'intrinsic' } };
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
  name: 'fixed-size-rule', role: 'baseline', fit: () => view => {
    const t = tokensOf(view);
    return { mode: firstAvailable(t < 2000 ? ['direct-H', 'agent-H'] : t <= 30000 ? ['agent-H'] : ['construct-H', 'agent-H'], view.modes) };
  },
});
/** experiments/library/construct.mjs NONE_RULE: one call when size band S (< 2K tokens), lists <= 3, one source, no effect verb; else a workflow. */
export const noneRule = () => ({
  name: 'NONE_RULE', role: 'baseline', shortcut: true, fit: () => (view, cell, sv) => {
    const lists = Math.round(10 ** (view.features.maxListLength ?? 0) - 1);
    const none = tokensOf(view) < 2000 && lists <= NONE_RULE.maxListLength && !(view.features.multiSource > 0) && !(sv?.prose?.effectVerbs > 0);
    return { mode: firstAvailable(none ? ['direct-H', 'agent-H'] : ['construct-H', 'agent-H+proc', 'agent-H'], view.modes) };
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
      if (hits.length || prose > 0) return { mode: firstAvailable(['construct-H', 'agent-H+proc'], view.modes), cues: hits };
      const r = nw('all', cell, view.modes);
      return { mode: r.mode, pred: r.pred };
    };
  },
});
/** A `kind`-only router: the leaf calculator over the bed kind (shortcut). */
export const kindRouter = () => ({
  name: 'kind-only', role: 'shortcut', shortcut: true, fit(ctx) {
    const leaf = leafChooser(ctx, it => it.sview.kind ?? '?');
    return (view, cell, sv) => { const r = leaf(sv?.kind ?? '?', cell, view.modes); return { mode: r.mode, pred: r.pred }; };
  },
});
/** Family identity (L3): the TRAIN best mode of the job's family; an unseen family gets the SBS. */
export const familyIdentityRouter = () => ({
  name: 'family-identity', role: 'shortcut', shortcut: true, fit(ctx) {
    const leaf = leafChooser(ctx, it => it.sview.family ?? '?');
    return (view, cell, sv) => { const r = leaf(sv?.family ?? '\u0000unseen', cell, view.modes); return { mode: r.mode, pred: r.pred }; };
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
/** Fixed mode (always-m). */
export const fixedPolicy = mode => ({ name: `always-${mode}`, role: 'baseline', fixed: mode, fit: () => view => ({ mode: firstAvailable([mode], view.modes) }) });
/** SBS-train: the single best fixed mode on the fold's TRAIN jobs, per cell (the yardstick of Δ). */
export const sbsTrain = () => ({ name: 'SBS-train', role: 'yardstick', fit(ctx) { const all = leafChooser(ctx, () => 'all', { complete: true }); return (view, cell) => { const r = all('all', cell, view.modes); return { mode: r.mode, pred: r.pred }; }; } });
/** SBS-global: one fixed mode for every cell (best mean over the V x N slider grid at W = V). */
export const sbsGlobalPolicy = () => ({
  name: 'SBS-global', role: 'baseline', fit(ctx) {
    const ms = ctx.modes.filter(m => ctx.train.every(it => it.modes.includes(m)));
    const rank = rankModes(ms.map(m => ({ mode: m, u: avg(SLIDER_CELLS.map(c => avg(ctx.train.map(it => it.u(c, m))))), usd: avg(SLIDER_CELLS.map(c => avg(ctx.train.map(it => it.usd(c, m))))) })));
    return view => ({ mode: firstAvailable(rank, view.modes) });
  },
});
/** L1 positive control: reads the evaluation labels. Never a router. */
export const peekRouter = () => ({ name: 'peek', role: 'control', peek: true, fit: ctx => (view, cell) => ({ mode: ctx.peek(view, cell).top }) });
/** SBS chosen on the evaluation jobs: an optimistic reference only. */
export const sbsTest = () => ({ name: 'SBS-test', role: 'optimistic', peek: true, fit: ctx => (view, cell) => ({ mode: firstAvailable(ctx.peek(view, cell).sbsTest, view.modes) }) });

/** The default policy set; `--router <module>` may replace any of them by name (its `policies` export). */
export function defaultPolicies(modes = Object.keys(MODES).filter(m => !MODES[m].ceiling)) {
  return [nrStatic(), tunedSizeRule(), fixedSizeRule(), noneRule(), keywordRouter(), kindRouter(), familyMajority(), nrKnn(), familyIdentityRouter(),
    sbsTrain(), sbsGlobalPolicy(), sbsTest(), peekRouter(), ...modes.map(fixedPolicy)];
}

// ------------------------------------------------------------------------------------------------------- deciding
function asDecision(d, avail, who) {
  const x = typeof d === 'string' ? { mode: d } : d;
  if (!x || typeof x.mode !== 'string') throw new Error(`${who}: a decision needs a mode`);
  if (!avail.includes(x.mode)) throw new Error(`${who}: chose ${x.mode}, which this job cannot run (${avail.join(', ')})`);
  if (x.routingUsd != null && !(Number.isFinite(x.routingUsd) && x.routingUsd >= 0)) throw new Error(`${who}: bad routingUsd`);
  return { mode: x.mode, routingUsd: x.routingUsd ?? 0, needsWorkflow: typeof x.needsWorkflow === 'boolean' ? x.needsWorkflow : null, pred: x.pred ?? null, ...(x.guard ? { guard: x.guard } : {}) };
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
 */
export function decideFolds({ labels, meta, folds, policies, modes, cells, registry = MODES, recorded = [] }) {
  const decisions = new Map(), fitted = new Map(), missing = new Map();
  const recNames = [...new Set(recorded.map(r => r.policy))];
  for (const p of policies) { decisions.set(p.name, new Map()); fitted.set(p.name, []); }
  for (const n of recNames) { decisions.set(n, new Map()); missing.set(n, []); }
  for (const fold of folds) {
    const byId = new Map(fold.eval.map(j => [opaque(j), j]));
    const evalPeek = (view, cell) => {
      const j = byId.get(view.id);
      if (!j) throw new Error('peek: unknown job');
      const e = labels.at(j, cell);
      return { top: e.top, sbsTest: rankModes(modes.filter(m => fold.eval.every(x => labels.modesOf(x).includes(m))).map(m => ({ mode: m, u: avg(fold.eval.map(x => labels.u(x, cell, m))), usd: avg(fold.eval.map(x => labels.usd(x, cell, m))) }))) };
    };
    const ctx = makeContext(labels, fold.train, meta, { modes, registry, evalPeek });
    for (const p of policies) {
      const choose = p.fit(p.peek ? ctx : { ...ctx, peek: null });
      fitted.get(p.name).push(choose);
      for (const j of fold.eval) {
        const avail = labels.modesOf(j).filter(m => modes.includes(m)), view = publicView(j, meta[j], avail), sv = p.shortcut ? shortcutView(j, meta[j], avail) : undefined;
        decisions.get(p.name).set(j, new Map(cells.map(c => [c.key, asDecision(choose(view, c, sv), avail, `${p.name}/${j}`)])));
      }
    }
    for (const n of recNames) {
      const L = recordedLookup(recorded, n);
      for (const j of fold.eval) {
        const avail = labels.modesOf(j).filter(m => modes.includes(m)), m = new Map();
        for (const c of cells) { const r = L.get(j, c); if (r) m.set(c.key, asDecision(r, avail, `${n}/${j}`)); }
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

/** Slider calibration at N = 10, W = V: predicted against realised success (±0.10) and $ per task (±30%); realised values non-decreasing in V. */
export function sliderCalibration(labels, decP, jobs, { N = 10, wOverV = 1, Vs = V_GRID, tolP = 0.10, tolUsd = 0.30 } = {}) {
  const positions = Vs.map(V => {
    const c = makeCell(V, N, wOverV), ds = jobs.map(j => [j, decP.get(j).get(c.key)]);
    const real = { p: avg(ds.map(([j, d]) => labels.stats(j, d.mode).s)), usd: avg(ds.map(([j, d]) => labels.usd(j, c, d.mode) + d.routingUsd / N)) };
    const havePred = ds.every(([, d]) => d.pred && Number.isFinite(d.pred.p) && Number.isFinite(d.pred.usd));
    const pred = havePred ? { p: avg(ds.map(([, d]) => d.pred.p)), usd: avg(ds.map(([, d]) => d.pred.usd + d.routingUsd / N)) } : null;
    const miss = !pred || Math.abs(pred.p - real.p) > tolP || (real.usd > 0 ? Math.abs(pred.usd / real.usd - 1) > tolUsd : pred.usd > 0);
    return { V, real, pred, miss };
  });
  const sorted = [...positions].sort((a, b) => a.V - b.V);
  const monotone = sorted.every((x, i) => !i || (x.real.p >= sorted[i - 1].real.p - 1e-9 && x.real.usd >= sorted[i - 1].real.usd - 1e-9));
  const misses = positions.filter(x => x.miss).length, predicted = positions.every(x => x.pred);
  return { positions, misses, monotone, predicted, calibrated: predicted && misses <= 1 && monotone };
}

/** C7a at a cell: the need call against confident, non-fragile labels; balanced accuracy, precision, recall, coverage. */
export function needDetection(labels, decP, jobs, cell, { fragile = [], registry = MODES, baseRates = [0.5, 0.8, 0.95] } = {}) {
  const call = d => (cell.N === 1 && typeof d.needsWorkflow === 'boolean' ? d.needsWorkflow : classOf(d.mode, registry) === 'workflow');
  let tp = 0, fn = 0, tn = 0, fp = 0;
  const used = jobs.filter(j => labels.at(j, cell).confident && !fragile.includes(j));
  for (const j of used) { const y = labels.at(j, cell).label === 'workflow', c = call(decP.get(j).get(cell.key)); if (y) { if (c) tp += 1; else fn += 1; } else if (c) fp += 1; else tn += 1; }
  const tpr = tp + fn ? wilson(tp, tp + fn) : null, tnr = tn + fp ? wilson(tn, tn + fp) : null;
  const ba = tpr && tnr ? { point: (tpr.p + tnr.p) / 2, lo: (tpr.lo + tnr.lo) / 2, hi: (tpr.hi + tnr.hi) / 2 } : null;
  const fpr = tnr ? 1 - tnr.p : null;
  return {
    cell: cell.key, used: used.length, tp, fn, tn, fp, balancedAccuracy: ba, recall: tpr, specificity: tnr, precision: tp + fp ? tp / (tp + fp) : null,
    precisionAtBaseRate: Object.fromEntries(baseRates.map(b => [b, tpr && fpr !== null && tpr.p * (1 - b) + fpr * b > 0 ? (tpr.p * (1 - b)) / (tpr.p * (1 - b) + fpr * b) : null])),
    coverage: coverage(labels, jobs, cell), fragileExcluded: jobs.filter(j => fragile.includes(j)).length,
  };
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
 * The preregistered reading of one co-primary policy (DESIGN §5). headline and perV carry {mean, lo, hi} at the
 * policy's Holm level; vsTuned / vsJudge are paired comparisons (lo > 0 needed); slider is sliderCalibration.
 */
export function readingOf({ headline, perV, vsTuned = null, vsJudge = null, slider = null, withoutNear = null, g1 = null }) {
  const harmful = perV.filter(x => x.hi < 0).map(x => x.V);
  const unmet = [];
  if (!(headline.lo > 0)) unmet.push('lower bound of Δ not > 0');
  if (!(headline.mean >= MIN_USEFUL)) unmet.push(`point Δ < ${MIN_USEFUL}`);
  if (!(vsTuned?.lo > 0)) unmet.push(vsTuned?.complete === false || !vsTuned ? 'no paired comparison with the tuned size rule' : 'does not beat the tuned size rule');
  if (!(vsJudge?.lo > 0)) unmet.push(vsJudge?.complete === false || !vsJudge ? 'no judge-H decisions' : 'does not beat judge-H');
  if (!slider?.calibrated) unmet.push(slider?.predicted === false ? 'slider uncalibrated: no predictions' : 'slider uncalibrated or not monotone');
  if (withoutNear && !(withoutNear.mean > 0)) unmet.push('sign of Δ does not hold with the near cluster dropped');
  if (harmful.length) unmet.push(`harmful at V = ${harmful.join(', ')}`);
  let reading;
  if (g1 === 'REFUTED-PREMISE') reading = 'REFUTED';
  else if (!unmet.length) reading = 'SUPPORTED';
  else if (headline.lo > 0 && headline.mean < MIN_USEFUL) reading = 'SUPERIOR, BELOW USEFUL EFFECT';
  else if (harmful.length) reading = 'HARMFUL';
  else if (perV.every(x => x.hi < MIN_USEFUL)) reading = 'REFUTED';
  else reading = 'INCONCLUSIVE';
  return { reading, usefulSizeShown: reading === 'SUPPORTED' && headline.lo >= MIN_USEFUL, disabledPositions: harmful, unmet: reading === 'SUPPORTED' ? [] : unmet };
}

// ------------------------------------------------------------------------------------------------------ leak tests
/** L4: every evaluation seed is in its split's range and allowed by the owner's ledger; examples are disjoint from evaluation tasks. */
export function seedChecks(table, meta, { ledger = null, ranges = SEED_RANGES } = {}) {
  const L = ledger ?? loadLedger(), problems = [];
  for (const job of table.jobs) {
    const m = meta[job], split = m.split, range = ranges[split], purpose = split === 'train' ? 'need-label' : 'need-heldout', ledgerSplit = split === 'train' ? 'dev' : 'test';
    const seeds = new Set(), hashes = new Set();
    for (const t of table.taskIds(job)) {
      const s = table.seedOf(job, t), h = table.hashOf(job, t);
      if (h) hashes.add(h);
      if (s === null) { problems.push(`${job}/${t}: no seed recorded`); continue; }
      seeds.add(s);
      if (!range || s < range[0] || s > range[1]) problems.push(`${job}/${t}: seed ${s} outside the ${split} range ${range?.join('-') ?? '(none)'}`);
      else for (const why of seedRefusals(L, { bed: m.family ?? '*', split: ledgerSplit, seed: s, purpose })) problems.push(`${job}/${t}: seed ${s}: ${why}`);
    }
    const ex = m.exampleSeeds ?? [ranges.example[0], ranges.example[0] + 1, ranges.example[0] + 2];
    for (const s of ex) { if (s < ranges.example[0] || s > ranges.example[1]) problems.push(`${job}: example seed ${s} outside ${ranges.example.join('-')}`); if (seeds.has(s)) problems.push(`${job}: example seed ${s} is also an evaluation seed`); }
    for (const h of m.exampleHashes ?? []) if (hashes.has(h)) problems.push(`${job}: an example task hash equals an evaluation task hash`);
  }
  return { ok: !problems.length, problems };
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

/** L6: the committed held-out decisions match the decisions recomputed now, and the envelope's hash is intact. */
export function verifyEnvelope(committed, recomputed, { firstHeldoutRowAt = null } = {}) {
  if (!committed) return { ok: false, problems: ['no committed decisions (evaluate.mjs --commit-decisions before the held-out matrix is joined)'] };
  const problems = [];
  if (sha256(canonical(committed.payload)) !== committed.sha256) problems.push('committed payload does not match its sha256');
  const want = new Map(recomputed.payload.decisions.map(d => [`${d.policy}|${d.job}|${d.cell}`, d.mode]));
  let compared = 0;
  for (const d of committed.payload.decisions) {
    const k = `${d.policy}|${d.job}|${d.cell}`;
    if (!want.has(k)) continue;
    compared += 1;
    if (want.get(k) !== d.mode) problems.push(`decision changed after commit: ${k} ${d.mode} -> ${want.get(k)}`);
  }
  const sealed = new Set(committed.payload.decisions.map(d => `${d.policy}|${d.job}|${d.cell}`));
  for (const k of want.keys()) if (!sealed.has(k)) problems.push(`decision not in the envelope: ${k}`);
  if (firstHeldoutRowAt && committed.createdAt && !(committed.createdAt < firstHeldoutRowAt)) problems.push(`envelope created ${committed.createdAt}, not before the first held-out row ${firstHeldoutRowAt}`);
  return { ok: !problems.length, compared, problems: problems.slice(0, 50), more: Math.max(0, problems.length - 50) };
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
  for (const j of Object.keys(meta)) {
    const mm = meta[j].metamorph;
    if (!mm || !meta[mm.of] || (!jobs.includes(j) && !jobs.includes(mm.of))) continue;
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
export const ROUTER_FILES = Object.freeze(['features.mjs', 'router.mjs', 'voi.mjs', 'metrics.mjs', 'evaluate.mjs']);

/**
 * Decide every non-TRAIN job (held-out, sealed, e2e, forced) from TRAIN labels only, and seal the decisions: the payload
 * (decisions, router file shas, TRAIN-row digest) is hashed; the hash is what gets committed before the held-out matrix
 * is joined (L6). `meta` covers every job; `rows`/`builds` must be TRAIN rows only (loadLabels trainOnly).
 */
export function commitDecisions({ rows, builds = [], meta, recorded = [], policies = defaultPolicies(), cells = GRID, reps = 2000, seed = 1, registry = MODES, cascades = CASCADES, labelSet = 'today', createdAt = new Date().toISOString() }) {
  for (const r of rows) if (meta[r.job]?.split !== 'train') throw new Error(`commitDecisions: a non-TRAIN row (${r.job}) was joined before the envelope`);
  const { labels, modes } = buildLabels({ rows, builds, registry, cascades, labelSet, cells, reps, seed });
  const TRAIN = labels.jobs.filter(j => meta[j]?.split === 'train' && !isForced(meta[j]));
  const targets = Object.keys(meta).filter(j => meta[j].split !== 'train' || isForced(meta[j])).sort();
  const ctx = makeContext(labels, TRAIN, meta, { modes, registry });
  const decisions = [];
  for (const p of policies.filter(x => !x.peek)) {
    const choose = p.fit(ctx);
    for (const j of targets) {
      const avail = jobModes(meta[j], modes), view = publicView(j, meta[j], avail), sv = p.shortcut ? shortcutView(j, meta[j], avail) : undefined;
      for (const c of cells) { const d = asDecision(choose(view, c, sv), avail, `${p.name}/${j}`); decisions.push({ policy: p.name, job: j, cell: c.key, mode: d.mode, needsWorkflow: d.needsWorkflow, routingUsd: d.routingUsd }); }
    }
  }
  for (const r of recorded) if (targets.includes(r.job)) decisions.push({ policy: r.policy, job: r.job, cell: r.cell ?? '*', mode: r.mode, needsWorkflow: r.needsWorkflow ?? null, routingUsd: r.routingUsd ?? 0, recorded: true });
  decisions.sort((a, b) => (a.policy + a.job + a.cell < b.policy + b.job + b.cell ? -1 : 1));
  const payload = { schema: 'need-decisions/1', cells: cells.map(c => c.key), policies: [...new Set(decisions.map(d => d.policy))], targets,
    routerShas: Object.fromEntries(ROUTER_FILES.map(f => [f, fileSha(path.join(HERE, f))])), trainRows: sha256(canonical(rows)), trainBuilds: sha256(canonical(builds)), decisions };
  return { createdAt, sha256: sha256(canonical(payload)), payload };
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
      const H = holm([tA.p, tB.p], { alpha });
      const okA = H.reject[0] && tA.mean >= MIN_USEFUL, okB = H.reject[1] && tB.mean >= MIN_USEFUL;
      sup += okA ? 1 : 0; anySup += okA || okB ? 1 : 0;
      const lvl = tA.p <= tB.p ? alpha / 2 : alpha, tl = signFlipTest(dA, { alpha: lvl });
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

function buildLabels({ rows, builds, registry, cascades, labelSet, cells, reps, seed, selfTest = true }) {
  let table = withCascades(rows, builds, presentCascades(rows, cascades), { registry });
  const st0 = selfTestRates(table), st = { ...st0, lineages: st0.lineages.map(withInterval), modes: st0.modes.map(withInterval) };
  // F11 / K9: a lineage (or a whole build path) whose self-check passes too many wrong answers earns no self-check credit.
  const keys = selfTest ? [...st.f11Lineages.map(l => `${l.job}|${l.mode}|${l.rep}`),
    ...table.jobs.flatMap(j => st.f11.filter(m => table.has(j, m)).flatMap(m => { const c = table.cell(j, m); return c.lineage ? c.lineageList.map(l => `${j}|${m}|${l.rep}`) : [...new Set([...c.reps.values()].flat())].map(r => `${j}|${m}|${r}`); }))] : [];
  if (keys.length) table = withoutSelfCheckCredit(table, keys);
  const modes = labelSetModes(table.modes, labelSet, registry);
  return { table, modes, selfTest: st, noCredit: keys, labels: needLabels(table, { cells, reps, seed, modes }) };
}

/**
 * The full evaluation. Returns a report object (renderReport prints it). `committed` is the sealed envelope read from
 * --decisions (required for an L6 pass on a held-out split). Leak tests and metamorphic attacks can be switched off for
 * simulations (leak: false).
 */
export function evaluate({ rows, builds = [], meta, recorded = [], split = 'heldout', policies = defaultPolicies(), cells = GRID, reps = 2000, seed = 1, bootReps = 10000,
  l2Perms = 1000, alpha = 0.05, labelSet = 'today', registry = MODES, cascades = CASCADES, committed = null, ledger = null, leak = true, attacks = true, randomDraws = 1000 }) {
  if (!['train', 'heldout', 'sealed', 'e2e'].includes(split)) throw new Error(`--split must be train, heldout, sealed or e2e, got ${split}`);
  if (!cells.some(c => c.key === HEADLINE.key) || !cells.some(c => c.key === N1.key)) throw new Error('cells must include the headline and the N = 1 cell');
  const built = buildLabels({ rows, builds, registry, cascades, labelSet, cells, reps, seed });
  const { table, modes, labels } = built;
  for (const j of table.jobs) { const m = meta[j]; if (!m) throw new Error(`job ${j} has rows but no jobs.json entry`); if (typeof m.cluster !== 'string' || typeof m.split !== 'string') throw new Error(`job ${j}: cluster and split are required`); }
  const clusterOf = j => meta[j].cluster;
  const TRAIN = table.jobs.filter(j => meta[j].split === 'train' && !isForced(meta[j]));
  const EVAL = split === 'train' ? TRAIN : table.jobs.filter(j => meta[j].split === split && !isForced(meta[j]));
  const FORCED = table.jobs.filter(j => isForced(meta[j]));
  if (!TRAIN.length) throw new Error('no TRAIN jobs');
  if (!EVAL.length) throw new Error(`no ${split} jobs with labels`);
  const trainClusters = [...new Set(TRAIN.map(clusterOf))].sort();
  const folds = split === 'train'
    ? trainClusters.map(c => ({ heldOutCluster: c, train: TRAIN.filter(j => clusterOf(j) !== c), eval: TRAIN.filter(j => clusterOf(j) === c) }))
    : [{ train: TRAIN, eval: EVAL }];
  if (split === 'train' && folds.length < 2) throw new Error('leave-one-cluster-out needs at least two TRAIN clusters');
  const { decisions, fitted, missing } = decideFolds({ labels, meta, folds, policies, modes, cells, registry, recorded });
  const yard = decisions.get('SBS-train');
  if (!yard) throw new Error('the policy set must include SBS-train (the yardstick)');
  const complete = name => decisions.has(name) && EVAL.every(j => decisions.get(name).has(j));
  const nearClusters = new Set(EVAL.filter(j => meta[j].near).map(clusterOf));

  // Primary and secondary scores, every policy, every cell (fixed order).
  const scores = {};
  for (const [name, dec] of decisions) {
    if (!complete(name)) continue;
    scores[name] = Object.fromEntries(cells.map(c => [c.key, scoreCell(labels, dec, yard, EVAL, clusterOf, c, { alpha, registry })]));
  }
  // Co-primaries: Holm over the two (a missing one counts as p = 1), intervals by test inversion at the Holm level.
  const coP = CO_PRIMARY.map(n => scores[n]?.[HEADLINE.key]?.p ?? 1);
  const H = holm(coP, { alpha });
  const order = coP.map((p, i) => i).sort((a, b) => coP[a] - coP[b]);
  const level = Object.fromEntries(CO_PRIMARY.map((n, i) => [n, alpha / (CO_PRIMARY.length - order.indexOf(i))]));
  const g1 = gateG1(labels, TRAIN, clusterOf, { alpha });   // a TRAIN fact, printed with every split
  const fr = fragility(rows, builds, { tolerance: j => meta[j]?.tolerance ?? null, cells: [HEADLINE, N1], modes, makeTable: (r, b, o) => withCascades(r, b, presentCascades(r, cascades), o), tableOpts: { registry } });
  const primary = {};
  for (const n of CO_PRIMARY) {
    if (!complete(n)) { primary[n] = { present: false, reading: 'NOT RUN', missing: missing.get(n) ?? EVAL }; continue; }
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
    primary[n] = { present: true, holmLevel: a, holmAdjustedP: H.adjusted[CO_PRIMARY.indexOf(n)], headline, perV, vsTuned, vsJudge, slider, withoutNear, dropOneCluster: dropOne,
      minDropOneLower: Math.min(...dropOne.map(x => x.lo)), clusterBootstrap: boot,
      random: randomMatched(labels, dec, yard, EVAL, clusterOf, HEADLINE, { draws: randomDraws, seed: seed + 11 }),
      ...readingOf({ headline, perV, vsTuned, vsJudge, slider, withoutNear, g1: g1?.verdict }) };
  }
  // C7a: need detection at N = 1 (H0's intrinsic call) and N = 10, with the comparators.
  const c7a = {};
  for (const n of [...CO_PRIMARY, 'tuned-size-rule', 'fixed-size-rule', 'NONE_RULE', 'keyword', 'NR-knn', 'judge-H']) if (complete(n)) c7a[n] = { N1: needDetection(labels, decisions.get(n), EVAL, N1, { fragile: fr.fragile, registry }), N10: needDetection(labels, decisions.get(n), EVAL, HEADLINE, { fragile: fr.fragile, registry }) };
  const majority = (() => { const conf = EVAL.filter(j => labels.at(j, N1).confident && !fr.fragile.includes(j)); const w = conf.filter(j => labels.at(j, N1).label === 'workflow').length; return { used: conf.length, majorityClass: w * 2 > conf.length ? 'workflow' : 'no-workflow', balancedAccuracy: 0.5 }; })();
  if (c7a['NR-static']) {
    const ba = c7a['NR-static'].N1.balancedAccuracy, tuned = c7a['tuned-size-rule']?.N1.balancedAccuracy?.point ?? null, cov = c7a['NR-static'].N1.coverage.coverage;
    c7a.reading = !ba ? 'INCONCLUSIVE (one class missing among confident labels)' : ba.lo <= 0.5 ? 'REFUTED (F12: lower bound <= 0.5)'
      : ba.lo > 0.5 && (tuned === null || ba.lo > tuned) && cov >= 0.5 ? 'SUPPORTED-DIAGNOSTIC' : 'INCONCLUSIVE';
  }
  // Value decomposition (headline): always-agent-H -> SBS-global -> SBS(cell) -> router -> VBS*.
  const at = (n, k) => scores[n]?.[HEADLINE.key]?.[k] ?? null;
  const decomposition = { 'always-agent-H': at('always-agent-H', 'router'), 'SBS-global': at('SBS-global', 'router'), 'SBS(V,N)': at('SBS-train', 'router'),
    'NR-static': at('NR-static', 'router'), 'NR-probe': at('NR-probe', 'router'), 'VBS*': at('SBS-train', 'vbsStar'), VBS: at('SBS-train', 'vbs') };
  // Convex hull of the fixed modes in (cost, success) at the headline; each policy's distance above it.
  const fixedPts = modes.filter(m => complete(`always-${m}`)).map(m => ({ mode: m, x: scores[`always-${m}`][HEADLINE.key].realized.usdPerTask, y: scores[`always-${m}`][HEADLINE.key].realized.success }));
  const hull = upperHull(fixedPts);
  const hullGap = Object.fromEntries(Object.keys(scores).map(n => { const r = scores[n][HEADLINE.key].realized, h = hullAt(hull, r.usdPerTask); return [n, { usdPerTask: r.usdPerTask, success: r.success, hull: h, aboveHull: h === null ? null : r.success - h }]; }));
  // Validity: voids, env faults, self-test (F11), fragility, coverage; forced stratum; L_ceiling builder gap.
  const ef = envFaults(table);
  const validity = { voided: table.voided, invalidArms: ef.filter(x => x.invalid), selfTest: built.selfTest, noSelfCheckCredit: built.noCredit.length, fragility: fr,
    coverage: { headline: coverage(labels, EVAL, HEADLINE), N1: coverage(labels, EVAL, N1) },
    benchmarkCannotSeparate: coverage(labels, EVAL, HEADLINE).confident / EVAL.length < 0.5,
    imputedUnlabelled: EVAL.filter(j => labels.at(j, HEADLINE).unlabelled).length };
  const forced = FORCED.length ? { jobs: FORCED, note: 'forced stratum: guard recall only, never in the primary population' } : null;
  let ceiling = null;
  if (labelSet === 'today' && table.modes.some(m => modeInfo(m, registry).ceiling)) {
    const L2 = needLabels(table, { cells: [HEADLINE, N1], reps: Math.min(reps, 500), seed, modes: labelSetModes(table.modes, 'ceiling', registry) });
    ceiling = EVAL.map(j => ({ job: j, today: labels.at(j, N1).label, ceiling: L2.at(j, N1).label, routerSaysWorkflow: decisions.get('NR-static')?.get(j)?.get(N1.key)?.needsWorkflow ?? null }))
      .map(x => ({ ...x, builderGap: x.routerSaysWorkflow === true && x.today !== 'workflow' && x.ceiling === 'workflow' }));
  }
  // Leak tests L1-L8 (F6: any failure of L1-L7 blocks every claim; L8 demotes NR-knn).
  let leaks = null;
  if (leak) {
    const peek = scores.peek?.[HEADLINE.key];
    const L1 = { ok: peek ? peek.closedGapVBS === null || peek.closedGapVBS >= 0.95 : false, closedGapVBS: peek?.closedGapVBS ?? null, note: peek?.closedGapVBS === null ? 'no headroom: the control cannot fail' : undefined };
    const L2 = shuffledNull({ labels, meta, folds, policy: policies.find(p => p.name === 'NR-static'), modes, registry, yard, evalJobs: EVAL, clusterOf, perms: l2Perms, seed: seed + 13, real: scores['NR-static']?.[HEADLINE.key]?.delta ?? null });
    const loco = trainClusters.length >= 2 ? trainClusters.map(c => ({ train: TRAIN.filter(j => clusterOf(j) !== c), eval: TRAIN.filter(j => clusterOf(j) === c) })) : [];
    let L3 = { ok: true, assessed: false };
    if (loco.length) {
      const d = decideFolds({ labels, meta, folds: loco, policies: [familyIdentityRouter(), sbsTrain()], modes, cells: [HEADLINE], registry });
      const s = scoreCell(labels, d.decisions.get('family-identity'), d.decisions.get('SBS-train'), TRAIN, clusterOf, HEADLINE, { alpha, registry });
      L3 = { ok: s.delta <= 1e-9, assessed: true, delta: s.delta, closedGap: s.closedGap };
    }
    const L4 = seedChecks(table, meta, { ledger });
    const L5 = importPurity();
    const L6 = split === 'train' ? { ok: true, assessed: false, note: 'development split: no envelope' }
      : verifyEnvelope(committed, commitDecisions({ rows: rows.filter(r => meta[r.job]?.split === 'train'), builds: builds.filter(b => meta[b.job]?.split === 'train'), meta, recorded, policies, cells, reps, seed, registry, cascades, labelSet, createdAt: committed?.createdAt }),
        { firstHeldoutRowAt: rows.filter(r => meta[r.job]?.split !== 'train' && r.at).map(r => r.at).sort()[0] ?? null });
    const L7 = buildIsolation(builds, table, meta);
    const knn = fitted.get('NR-knn')?.[fitted.get('NR-knn').length - 1];
    const L8 = split === 'train' ? { ok: true, assessed: false, note: 'L8 reads held-out jobs' } : nearestClusterTest(knn, EVAL.map(j => ({ job: j, view: publicView(j, meta[j], labels.modesOf(j).filter(m => modes.includes(m))) })));
    leaks = { L1, L2, L3, L4, L5, L6, L7, L8, f6: [L1, L2, L3, L4, L5, L6, L7].some(x => x.ok === false) };
  }
  // Metamorphic attacks with routers fitted on every TRAIN job (the frozen artefact).
  let metamorph = null;
  if (attacks) {
    const ctx = makeContext(labels, TRAIN, meta, { modes, registry });
    metamorph = {};
    for (const p of policies.filter(x => ['primary', 'secondary', 'baseline'].includes(x.role) && !x.fixed && !x.peek)) {
      const ch = p.fit(ctx);
      metamorph[p.name] = metamorphic(ch, EVAL, { meta, labels, policy: p, modesOf: j => (labels.jobs.includes(j) ? labels.modesOf(j).filter(m => modes.includes(m)) : jobModes(meta[j], modes)) });
    }
  }
  const blocked = [];
  if (leaks?.f6) blocked.push('F6: a leak test failed; the evaluator is invalid');
  if (table.voided.length) blocked.push(`${table.voided.length} voided lineage(s): claims blocked until rerun`);
  if (validity.invalidArms.length) blocked.push(`${validity.invalidArms.length} arm(s) over the 25% environment-fault limit`);
  return {
    schema: 'need-evaluation/1', split, grade: split === 'train' ? 'development (leave-one-cluster-out on TRAIN)' : split === 'heldout' ? 'held-out' : split,
    labelSet, cells: cells.map(c => c.key), headline: HEADLINE.key, modes, jobs: { train: TRAIN.length, eval: EVAL.length, forced: FORCED.length, clusters: [...new Set(EVAL.map(clusterOf))].length },
    folds: folds.map(f => ({ heldOutCluster: f.heldOutCluster ?? null, train: f.train.length, eval: f.eval.length })), missingRecorded: Object.fromEntries([...missing].filter(([, v]) => v.length)),
    fittedRule: fitted.get('NR-static')?.map(f => f.fitted) ?? null, primary, holm: { pValues: Object.fromEntries(CO_PRIMARY.map((n, i) => [n, coP[i]])), adjusted: H.adjusted },
    c7a: { ...c7a, majority }, g1, scores, decomposition, hull: { points: fixedPts, hull, gap: hullGap }, validity, forced, ceiling, leaks, metamorph, blocked,
  };
}

/** L2: refit the policy on TRAIN labels permuted among jobs with the same mode set; Δ at the headline per permutation. */
export function shuffledNull({ labels, meta, folds, policy, modes, registry, yard, evalJobs, clusterOf, perms = 1000, seed = 13, real = null, tolerance = DELTA / 3 }) {
  if (!policy || perms <= 0) return { ok: true, assessed: false };
  const r = rng(seed), xs = [];
  for (let b = 0; b < perms; b++) {
    const dec = new Map();
    for (const fold of folds) {
      const groups = new Map();
      for (const j of fold.train) { const k = labels.modesOf(j).join('|'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(j); }
      const perm = new Map();
      for (const g of groups.values()) { const s = [...g]; for (let i = s.length - 1; i > 0; i--) { const k = Math.floor(r() * (i + 1)); [s[i], s[k]] = [s[k], s[i]]; } g.forEach((j, i) => perm.set(j, s[i])); }
      const choose = policy.fit(makeContext(labels, fold.train, meta, { modes, registry, permutation: perm }));
      for (const j of fold.eval) { const avail = labels.modesOf(j).filter(m => modes.includes(m)); dec.set(j, new Map([[HEADLINE.key, asDecision(choose(publicView(j, meta[j], avail), HEADLINE), avail, `L2/${policy.name}`)]])); }
    }
    xs.push(scoreCell(labels, dec, yard, evalJobs, clusterOf, HEADLINE, { registry }).delta);
  }
  const s = [...xs].sort((a, b) => a - b), mean = avg(xs), q95 = s[Math.floor(0.95 * (s.length - 1))];
  return { ok: mean <= tolerance, assessed: true, perms, nullMean: mean, nullMedian: s[Math.floor(s.length / 2)], null95: q95, real, realExceeds95: real === null ? null : real > q95, tolerance };
}

// --------------------------------------------------------------------------------------------------------- report
const f3 = x => (x === null || x === undefined ? '–' : x === Infinity ? '+inf' : x === -Infinity ? '-inf' : typeof x === 'number' ? x.toFixed(3) : String(x));
export function renderReport(R) {
  const L = [];
  L.push(`need router v1 evaluation: ${R.grade}; label set L_${R.labelSet}; headline ${R.headline}`);
  L.push(`jobs: ${R.jobs.train} TRAIN, ${R.jobs.eval} evaluated in ${R.jobs.clusters} cluster(s), ${R.jobs.forced} forced (own stratum)`);
  if (R.blocked.length) for (const b of R.blocked) L.push(`BLOCKED: ${b}`);
  L.push('', 'PRIMARY (C7b): Δ = mean over clusters of (u_policy − u_SBS-train), success-equivalents per task, exact sign-flip test, Holm over 2');
  for (const [n, p] of Object.entries(R.primary)) {
    if (!p.present) { L.push(`  ${n}: NOT RUN (${(p.missing ?? []).length} job(s) without decisions)`); continue; }
    L.push(`  ${n}: Δ ${f3(p.headline.mean)} [${f3(p.headline.lo)}, ${f3(p.headline.hi)}] at one-sided ${(1 - p.holmLevel) * 100}%; Holm p ${f3(p.holmAdjustedP)} -> ${p.reading}${p.usefulSizeShown ? ' (useful size shown)' : ''}`);
    for (const u of p.unmet) L.push(`      unmet: ${u}`);
    L.push(`      per V: ${p.perV.map(x => `$${x.V}: ${f3(x.mean)} [${f3(x.lo)}, ${f3(x.hi)}]`).join('; ')}; drop-one-cluster min lower ${f3(p.minDropOneLower)}; cluster bootstrap [${f3(p.clusterBootstrap?.lo)}, ${f3(p.clusterBootstrap?.hi)}]`);
    L.push(`      random at matched mix: expectation ${f3(p.random.expectation)}, simulated ${f3(p.random.mean)} (95th ${f3(p.random.q95)}); slider ${p.slider.calibrated ? 'calibrated' : 'NOT calibrated'} (${p.slider.misses} miss(es), monotone ${p.slider.monotone})`);
  }
  if (R.g1) L.push('', `GATE G1 (TRAIN headroom VBS* − SBS): ${R.g1.verdict}${R.g1.note ? ` (${R.g1.note})` : ''}`, ...R.g1.cells.map(c => `  ${c.cell}: SBS ${c.sbs}, headroom ${f3(c.headroom)} exact [${f3(c.lo)}, ${f3(c.hi)}], cluster bootstrap [${f3(c.bootstrap?.lo)}, ${f3(c.bootstrap?.hi)}]`));
  L.push('', 'C7a (need detection; confident non-fragile labels; Wilson-based intervals; coverage beside accuracy)');
  for (const [n, x] of Object.entries(R.c7a)) if (x?.N1) L.push(`  ${n.padEnd(16)} N=1 BA ${f3(x.N1.balancedAccuracy?.point)} [${f3(x.N1.balancedAccuracy?.lo)}, ${f3(x.N1.balancedAccuracy?.hi)}] on ${x.N1.used}, coverage ${f3(x.N1.coverage.coverage)}; N=10 BA ${f3(x.N10.balancedAccuracy?.point)}`);
  if (R.c7a.reading) L.push(`  reading (H0): ${R.c7a.reading}`);
  L.push('', 'VALUE DECOMPOSITION (headline, mean u)', `  ${Object.entries(R.decomposition).map(([k, v]) => `${k} ${f3(v)}`).join(' -> ')}`);
  L.push('', 'ALL POLICIES, ALL CELLS (not primary except the headline row of the co-primaries)');
  for (const [n, byCell] of Object.entries(R.scores)) {
    const h = byCell[R.headline];
    L.push(`  ${n.padEnd(22)} Δ ${f3(h.delta)} [${f3(h.lo)}, ${f3(h.hi)}] closed gap ${f3(h.closedGap)} regret ${f3(h.regret)} mode-in-A ${f3(h.modeAccuracy)} workflow share ${f3(h.workflowShare)}; ${Object.entries(byCell).filter(([k]) => k !== R.headline).slice(0, 6).map(([k, s]) => `${k}: ${f3(s.delta)}`).join('; ')}`);
  }
  L.push('', 'VALIDITY', `  voided lineages ${R.validity.voided.length}; invalid arms ${R.validity.invalidArms.length}; F11 build paths ${R.validity.selfTest.f11.join(', ') || 'none'}; fragile jobs ${R.validity.fragility.fragile.length}; coverage ${f3(R.validity.coverage.headline.coverage)}${R.validity.benchmarkCannotSeparate ? ' (the benchmark cannot separate routers)' : ''}`);
  if (R.leaks) L.push('', `LEAK TESTS (F6 ${R.leaks.f6 ? 'TRIPPED' : 'clear'})`, ...['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'].map(k => `  ${k}: ${R.leaks[k].ok === false ? 'FAIL' : R.leaks[k].assessed === false ? 'not assessed' : 'ok'}${R.leaks[k].problems?.length ? ` (${R.leaks[k].problems.slice(0, 3).join('; ')})` : ''}${k === 'L8' && R.leaks.L8.demote ? ' (NR-knn demoted to family-majority)' : ''}`));
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
    const env = commitDecisions({ rows: L.rows, builds: L.builds, meta: L.meta, recorded: L.decisions, policies, reps: num('--reps', 2000), seed: num('--seed', 1) });
    mkdirSync(path.dirname(path.resolve(commitOut)), { recursive: true });
    writeFileSync(commitOut, JSON.stringify(env, null, 1) + '\n');
    writeFileSync(`${commitOut}.sha256`, `${env.sha256}\n`);
    console.log(`sealed ${env.payload.decisions.length} decisions for ${env.payload.targets.length} job(s); sha256 ${env.sha256}; skipped ${L.skipped.stages.length} stage(s) and ${L.skipped.rows} non-TRAIN row(s) unread`);
    process.exit(0);
  }
  const L = loadLabels(root);
  const decFile = arg('--decisions', null), committed = decFile ? JSON.parse(readFileSync(decFile, 'utf8')) : null;
  const R = evaluate({ rows: L.rows, builds: L.builds, meta: L.meta, recorded: L.decisions, split: arg('--split', 'heldout'), policies, committed,
    reps: num('--reps', 2000), bootReps: num('--boot', 10000), l2Perms: num('--perms', 1000), seed: num('--seed', 1), labelSet: arg('--label-set', 'today') });
  const text = renderReport(R), out = arg('--report', null);
  if (out) {
    mkdirSync(out, { recursive: true });
    const { scores, ...rest } = R;
    writeFileSync(path.join(out, 'report.json'), JSON.stringify({ ...rest, scores: Object.fromEntries(Object.entries(scores).map(([n, c]) => [n, Object.fromEntries(Object.entries(c).map(([k, s]) => [k, { ...s, perJob: undefined }]))])) }, null, 1) + '\n');
    writeFileSync(path.join(out, 'report.txt'), text + '\n');
  }
  console.log(text);
}
