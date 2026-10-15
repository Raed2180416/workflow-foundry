// Need router (claim C7; research/need-router-20261014/DESIGN.md §3). $0, pure, no model calls, no I/O.
//
// v0 (kept unchanged below for its callers and tests): pick an execution mode for a task family before execution, at
// the owner's slider V ($ per verified success) and the declared horizon H. argmax_m H * (V * p̂(m) - ĉ(m)) - F̂(m),
// with priorPredictor (pooled TRAIN rates, feature-blind) and knnPredictor (k nearest TRAIN families), evaluated
// leave-one-family-out (lofo).
//
// Review of v0 against DESIGN §3 (2026-10-14), each fixed in v1 below:
//   R1 utility: H·(V·p − c) − F has no silent-miss term (W/V)·q and no routing term r/(N·V) (DESIGN §2).
//   R2 ties: `u > best + 1e-12` keeps the first mode in Map order on an exact tie, not the cheaper one, and there is no
//      δ acceptable set (FLOOR_POINTS = 0.03).
//   R3 hard requirements are an untyped `allowed` hook: no requirement vocabulary, no engine-support flag, and nothing
//      stops a caller from turning a word cue in untrusted task text into a forced mode.
//   R4 knnPredictor's default key set is every key present in `features`, which would include the four prose counts
//      and any banned key a caller passes; the v1 router reads only the 8-key trusted whitelist.
//   R5 lofo is leave-one-FAMILY-out; DESIGN §4 needs leave-one-CLUSTER-out (families sharing a world are correlated).
//      v1 policies are scored inside evaluate.mjs's cluster folds; v0 lofo stays for its tests.
//   R6 no structural rule, no leaf calculator, no needsWorkflow output, no decision card.
//
// v1 (DESIGN §3): stage 0 a typed hard-requirement guard (typed fields only; word cues only raise "ask the user");
// stage 1 the structural rule H0, intrinsic(x) = logInputTokens >= θ_tok OR maxListLength >= θ_fan, fitted on TRAIN;
// stage 2 the leaf calculator (per rule leaf, the mean TRAIN stats per mode, so any (V, N, W) cell can be decided) or,
// as the secondary policy, the kNN stage (k nearest TRAIN jobs on the trusted features, k by leave-one-cluster-out).
// Utility per task in success-equivalents: u = s − c/V − B/(N·V) − (W/V)·q − r/(N·V) (metrics.needUtility); an
// abstention (null delivery) costs nothing beyond its dollars, so the predicted abstain share 1 − p − q is reported but
// not charged. The choice (decideModes, router default `delta: 0`) is the exact best predicted utility, exact ties to
// the cheaper mode in $ per task at the declared N, then registry order: DESIGN §3 stage 2's "best mean TRAIN utility",
// and the same rule as the SBS-train yardstick (metrics.rankModes). The δ acceptable set A = {m : u_m >= u_max − δ}
// (`acceptDelta`, δ = 0.03, DESIGN §2) is computed and reported beside the choice. Choosing the cheapest member of A
// ("δ ties", `delta: DELTA`) is kept as an option for the preregistered sensitivity only: review 2026-10-15 found that
// it gives away up to δ = 0.03 per task (the minimum useful effect) against the exact-best SBS-train yardstick, and that
// it is not monotone in N (below).
// Monotonicity, stated exactly:
//   in V (fixed N, W), any δ: the chosen mode's success-equivalent value p − (W/V)·q and its $ per task never decrease
//     as V rises (proof at decideModes); at W = 0 that value is p itself. p alone can fall when W > 0 (a mode that
//     abstains instead of delivering wrong answers can win at a higher V); that is the W·q term working, not a defect.
//     So a slider check on raw realised p can trip on a correct router at W = V; F7's check must read p − (W/V)·q, or
//     run at W = 0 (pinned in test/router-v1.test.mjs: s 0.7, q 0.3, c 0.01 at V = $1; s 0.6, q 0, c 0.5 at V = $10).
//   in N (fixed V, W), exact choice (the default): the chosen build cost never decreases as N rises (upper envelope of
//     lines in 1/N). When every mode with a build cost is a workflow mode (no-workflow modes have B = 0), the chosen
//     class is monotone too: once a workflow is chosen at N it stays chosen at every larger N (DESIGN §6; proof at
//     decideModes). With δ ties neither holds (pinned counterexample NON_MONOTONE_N in test/router-fixtures.mjs).
// Abstention (router level): when the structure cannot be read (a rule feature is missing), H0 is not fitted (PREREG §6
// minimum: 2 confident positives from 2 TRAIN clusters and 2 confident negatives from 2 clusters), the job's leaf is
// empty, a forced job has no workflow mode, or no available mode has TRAIN support, the decision falls back (pooled TRAIN
// stats, or today's default agent-H) and `abstain.reasons` says why. It is logged, not scored, in v1, like askFlag.
// Leaf statistics compare modes on the same jobs: a mode missing from any TRAIN job of a leaf is not priced in that leaf
// and is listed in `unsupported` (the kNN stage already pooled this way).
// Inputs: the job's 8 trusted features, its typed requirements, its declared verifier and runnable modes, word-cue ids
// (ask only), and TRAIN jobs' per-mode stats. Never a family id, bed version, kind, oracle, reference or result file.
//
// Second review (2026-10-15). STATUS (checked 2026-10-15 06:50 UTC against this file; an earlier version of this note
// said every item was fixed and tested in test/router-review2.test.mjs, a file that does not exist):
//   E1 DONE, tested (test/router-v1.test.mjs "structural rule", test/router-review.test.mjs D7): H0's fit and its LOCO
//      estimate are the preregistered rule (PREREG §6; prereg-rules.mjs thetaFitStatus, fitOrRule, locoFolds): candidates
//      from the confident items only, midpoints only (never a job's own value), ties to the larger thresholds key by key
//      (θ_tok first); a LOCO fold is undefined only when its training part lacks a confident class.
//      FINDING for the PREREG owner: the key-by-key tie is lexicographic, so a larger θ_tok can be bought with a much
//      smaller θ_fan and more workflow calls, against DESIGN §3's "ties go to the larger threshold (fewer workflow calls)".
//      On the planted world of test/router-fixtures.mjs it gives θ = (4.705, 0.886), 9 TRAIN workflow calls and 4 of 24
//      held-out jobs misrouted. `thetaTie: 'fewest-calls'` (THETA_TIES) implements DESIGN's rule on the same midpoint
//      candidates (fewest TRAIN workflow calls, then the larger thresholds key by key); both outcomes are pinned in
//      test/router-review3.test.mjs R5. The default stays PREREG §6's rule until a §13 addendum changes it.
// Third review (2026-10-15), each fixed here or in card.mjs/voi.mjs with a test in test/router-review3.test.mjs:
//   R1 (E2) a run-time cascade is attached only when the chosen mode IS the cascade mode (priced from its derived rows,
//      evaluated as that mode); a pure choice carries cascade null, and the task-4 checkpoint only rides the construct-H
//      cascade (only there can tasks "fall back").
//   R2 (E3) card.mjs probePlan prices the preregistered bundle PROBE_BUNDLE (two direct-H draws, one agent-H run) jointly
//      (voi.mjs bundleValue): EVSI over the joint update, cost the sum of its draws; the gate is that plan. A probe that
//      is not delivered caps k by kMax, never by H (voi.mjs).
//   R3 (E4, E9) probeRecord refuses modes outside PROBEABLE, draws beyond PROBE_BUNDLE, and observations that do not name
//      their probe rows (label-run's `<job>|<mode>|<draw>`) and their deployable signal kind (PROBE_SIGNALS); the card
//      carries both; probeFromRows builds a probe from need-probe-row/1 rows and verifyProbeRows checks a card against
//      probes.jsonl. The pass-to-success mapping (PROBE_MAPPING, TBD-FREEZE) is in `fitted`, so routerSha names it.
//   R4 FROZEN_FILES is the one list of frozen sources (PREREG §6 "Shas", seven files): card.mjs CODE_FILES and evaluate.mjs
//      ROUTER_FILES are this array.
//   R6 (E10) the kNN stage abstains (structure-unknown, pooled stats) when a trusted feature its distance reads is missing.
//   R7 `fitted.probe` names the prior kind, the mapping, the bundle and the signals; features.mjs is a frozen file.
//   R9 (E5) one function, probePriors, gives the probe prior to both decide's update and probePlan's EVSI; the kind is a
//      fitted option (`probePrior`, default 'pooled-tasks', the PREREG §6 text as read so far; owner decision pending).
//   R10 itemsFromContext refuses a negative derived q, c or B (an accounting error), clamping only float noise.
//   R11 (E8) a probe that is not null must observe at least one mode with k >= 1.
//   Not code: R5 (θ tie) and R8 (the exact-best leaf choice, δ ties a sensitivity only) need a PREREG §13 addendum.
//   E7 (masked top mode returned as `masked`) stays open; E6 (sealed cards) belongs to evaluate.mjs.
import {
  labelTable, utilities, score, singleBest,
  MODES, CASCADES, DELTA, HEADLINE, makeCell, cellKey, classOf as registryClassOf, modeInfo, needUtility, perTaskUsd, bestOf, rankModes,
} from './metrics.mjs';
import { thetaFitStatus, locoFolds, fitOrRule } from './prereg-rules.mjs';

/** Per-mode label summary of one family: { p, perTaskUsd, fixedUsd, n }. */
export function cellSummary(table, f) {
  return new Map(table.modes.map(m => {
    const c = table.cell(f, m);
    const v = [...c.tasks.values()];
    return [m, { s: v.filter(x => x.success).length, n: v.length, perTaskUsd: v.reduce((a, x) => a + x.costUsd, 0) / v.length, fixedUsd: c.fixedUsd }];
  }));
}

/** Pool summaries of several families into one prediction per mode (Beta(a,b) shrinkage on the success rate). */
function pool(sums, weights, { a = 1, b = 1 } = {}) {
  const modes = [...sums[0].keys()];
  return new Map(modes.map(m => {
    let s = 0, n = 0, c = 0, fx = 0, w = 0;
    sums.forEach((S, i) => { const x = S.get(m); s += weights[i] * x.s; n += weights[i] * x.n; c += weights[i] * x.perTaskUsd; fx += weights[i] * x.fixedUsd; w += weights[i]; });
    return [m, { p: (s + a) / (n + a + b), perTaskUsd: c / w, fixedUsd: fx / w, n }];
  }));
}

export function priorPredictor(train) {
  const sums = train.families.map(f => cellSummary(train, f));
  const pred = pool(sums, sums.map(() => 1));
  return () => pred;
}

/** k nearest training families by standardized Euclidean distance over numeric features (missing = training mean). */
export function knnPredictor(train, features, { k = 3, keys = null } = {}) {
  const fams = train.families;
  const ks = keys ?? [...new Set(fams.flatMap(f => Object.keys(features[f] ?? {})))].sort();
  const mean = {}, sd = {};
  for (const key of ks) {
    const xs = fams.map(f => features[f]?.[key]).filter(Number.isFinite);
    mean[key] = xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0;
    sd[key] = xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - mean[key]) ** 2, 0) / (xs.length - 1)) || 1 : 1;
  }
  const z = f => ks.map(key => ((Number.isFinite(features[f]?.[key]) ? features[f][key] : mean[key]) - mean[key]) / sd[key]);
  const sums = new Map(fams.map(f => [f, cellSummary(train, f)]));
  return f => {
    const q = z(f);
    const near = fams.map(g => ({ g, d: Math.hypot(...z(g).map((x, i) => x - q[i])) })).sort((a, b) => a.d - b.d || (a.g < b.g ? -1 : 1)).slice(0, Math.min(k, fams.length));
    return pool(near.map(x => sums.get(x.g)), near.map(x => 1 / (1 + x.d)));
  };
}

/**
 * The router: (family, V) -> mode. `predict(f)` gives Map(mode -> {p, perTaskUsd, fixedUsd}); `horizon(f)` the declared
 * volume; `allowed(f)` an optional rule that returns the modes a family's hard requirements permit (null = all).
 */
export function expectedUtilityRouter({ predict, horizon, allowed = () => null }) {
  return (f, V) => {
    const pred = predict(f);
    const ok = allowed(f);
    let best = null, bu = -Infinity;
    for (const [m, x] of pred) {
      if (ok && !ok.includes(m)) continue;
      const H = horizon(f);
      const u = H * (V * x.p - x.perTaskUsd) - x.fixedUsd;
      if (u > bu + 1e-12) { bu = u; best = m; }
    }
    if (best === null) throw new Error(`no allowed mode for ${f}`);
    return best;
  };
}

/** Restrict a label table to some families (same modes). */
export function subTable(table, fams) {
  const rows = [], fixed = [];
  for (const f of fams) for (const m of table.modes) {
    const c = table.cell(f, m);
    for (const [t, x] of c.tasks) rows.push({ family: f, mode: m, task: t, success: x.success, costUsd: x.costUsd });
    if (c.fixedUsd) fixed.push({ family: f, mode: m, fixedUsd: c.fixedUsd });
  }
  return labelTable(rows, fixed);
}

/**
 * Leave-one-family-out evaluation at slider V. `makeRouter(trainTable)` returns (f, V) -> mode for unseen f. For each
 * held-out family the SBS is the fixed mode best on that fold's training families. Returns the summed score over folds
 * in metrics.score's terms, plus per-family picks.
 */
export function lofo(table, makeRouter, V, { horizon = null } = {}) {
  const U = utilities(table, V, { horizon });
  let vbs = 0, router = 0, sbs = 0, correct = 0;
  const per = [];
  for (const f of table.families) {
    const trainFams = table.families.filter(g => g !== f);
    const train = subTable(table, trainFams);
    const r = makeRouter(train);
    const sbsMode = singleBest(utilities(train, V, { horizon }));
    const u = U.get(f), best = Math.max(...u.values()), pick = r(f, V);
    vbs += best; router += u.get(pick); sbs += u.get(sbsMode);
    correct += u.get(pick) >= best - 1e-9 ? 1 : 0;
    per.push({ family: f, pick, sbsMode, oracle: [...u].filter(([, x]) => x >= best - 1e-9).map(([m]) => m) });
  }
  const headroom = vbs - sbs;
  return { V, folds: table.families.length, vbs, sbs, router, regret: vbs - router, closedGap: headroom > 1e-9 ? (router - sbs) / headroom : null, headroom, accuracy: correct / table.families.length, per };
}

export { score };

// ==================================================================================================== v1 (DESIGN §3)

/** The router's trusted structure features (DESIGN §1): features.mjs's 12-key census whitelist minus the 4 prose counts. */
export const TRUSTED_FEATURES = Object.freeze(['logInputTokens', 'logSchemaLeaves', 'itemLists', 'maxListLength', 'freeText', 'multiSource', 'conventionsInProse', 'verifiable']);
/** H0's keys (stage 1): too big for one context, or too wide. */
export const RULE_KEYS = Object.freeze(['logInputTokens', 'maxListLength']);
/** The intrinsic-need reading (C7a) the rule is fitted on: V = $1, W = V, N = 1. */
export const N1 = makeCell(1, 1, 1);
/** RX6-lite (D5): under this measured guard recall, the guard asks instead of inferring "no requirement". */
export const GUARD_RECALL_MIN = 0.9;
/** Today's default mode (DESIGN §6 value decomposition starts at always-agent-H): the fallback of last resort. */
export const DEFAULT_MODE = 'agent-H';
/** Engine constructs a forced job needs (DESIGN §3 stage 0; the E3 engine column). */
export const ENGINE_CONSTRUCTS = Object.freeze(['state', 'wait.signal', 'human-task', 'compensation']);
/**
 * Typed hard requirements (DESIGN §1 "declared fields") and the engine constructs each needs. Names normalise from the
 * spaced forms in prereg/stages.json ("effects with authority", "audit beyond the journal"). Anything else is refused.
 */
export const REQUIREMENT_TYPES = Object.freeze({
  'durable-wait': Object.freeze(['state', 'wait.signal']),
  schedule: Object.freeze(['state', 'wait.signal']),
  'human-approval': Object.freeze(['human-task']),
  'effects-with-authority': Object.freeze(['compensation']),
  'audit-beyond-journal': Object.freeze(['state']),
});
/**
 * Word cues read from untrusted task text (REQUIREMENT_LIBRARY ids, src/construction-objective.mjs; shapeOf word classes,
 * experiments/library/index.mjs) and the typed requirement each hints at. A cue never forces a mode: it only raises
 * "ask the user" when the hinted requirement is not declared. Cues with no hard-requirement reading are ignored.
 */
export const CUE_HINTS = Object.freeze({
  'human-gate': 'human-approval', 'high-risk-not-model-owned': 'human-approval', 'durable-wait': 'durable-wait',
  'compensation-named-limit': 'effects-with-authority', humanWords: 'human-approval', timeWords: 'schedule', effectVerbs: 'effects-with-authority',
});
/** Declared verifiers (prereg/stages.json values, normalised) that can arbitrate between two different answers without our oracle; a schema cannot. */
export const DEPLOYABLE_VERIFIERS = Object.freeze(['tests', 'executable-tests', 'acceptance-check', 'owner-acceptance-check']);
/** NR-probe's probeable modes (DESIGN §3, PREREG §6). A probe on any other mode is refused. */
export const PROBEABLE = Object.freeze(['direct-H', 'agent-H']);
/**
 * The preregistered probe (DESIGN §3, PREREG §6 "kMax 2 (two direct-H draws, one agent-H run)"): the one bundle
 * label-run.mjs runProbes draws on the probe example. It is priced, and charged, as one probe.
 */
export const PROBE_BUNDLE = Object.freeze({ id: 'prereg-bundle', draws: Object.freeze({ 'direct-H': 2, 'agent-H': 1 }) });
/**
 * Deployable probe signals (DESIGN §3, PREREG §6: never the bed oracle) and how one trial of each reads label-run's
 * need-probe-row/1 rows. An observation names its signal kind and its rows; verifyProbeRows recomputes its passes.
 */
export const PROBE_SIGNALS = Object.freeze({
  schemaValid: Object.freeze({ rowsPerTrial: 1, modes: Object.freeze(['direct-H', 'agent-H']), rule: 'the draw delivered a schema-valid answer (row.schemaValid === true)' }),
  deployableVerdict: Object.freeze({ rowsPerTrial: 1, modes: Object.freeze(['direct-H', 'agent-H']), rule: "the family-handed deployable check passed (row.deployableVerdict === 'pass')" }),
  agreement: Object.freeze({ rowsPerTrial: 2, modes: Object.freeze(['direct-H']), rule: 'two direct-H answers were delivered and agree (equal, non-null outputHash)' }),
});
/** Fields a probe row must never carry (an oracle reading would make the probe a label peek). */
export const ORACLE_FIELDS = Object.freeze(['pass', 'score', 'passAt', 'oracle', 'oracleVerdict', 'reference']);
/**
 * How a deployable pass enters NR-probe's Beta update (PREREG §6: TBD-FREEZE). The id is in `fitted.probe.mapping`, so
 * routerSha names it; the Freeze addendum replaces it with the frozen mapping.
 */
export const PROBE_MAPPING = Object.freeze({ id: 'pass-as-success/unfrozen', frozen: false, rule: 'each deployable pass counts as one verified success in the Beta update (TBD-FREEZE, PREREG §6)' });
/** NR-probe priors: 'empirical-bayes' (default, review E5) or 'pooled-tasks' (the PREREG §6 text, Beta(1 + s·T, 1 + (1 − s)·T)). */
export const PROBE_PRIORS = Object.freeze(['empirical-bayes', 'pooled-tasks']);
/**
 * H0's tie rules among equally accurate θ pairs: 'prereg' (PREREG §6 as written: the larger thresholds key by key,
 * θ_tok first; prereg-rules.mjs fitOrRule) or 'fewest-calls' (DESIGN §3: fewest TRAIN workflow calls, then the larger
 * thresholds key by key). Same midpoint candidates either way. The default is 'prereg' until a §13 addendum says otherwise.
 */
export const THETA_TIES = Object.freeze(['prereg', 'fewest-calls']);
/**
 * The frozen artefact's sources (PREREG §6 "Shas", the A-Freeze analysis stamp; DESIGN §3): the one list card.mjs hashes
 * into routerSha (CODE_FILES) and evaluate.mjs seals in the envelope (ROUTER_FILES).
 */
export const FROZEN_FILES = Object.freeze(['features.mjs', 'router.mjs', 'voi.mjs', 'metrics.mjs', 'evaluate.mjs', 'card.mjs', 'prereg-rules.mjs']);
/** Default cap on the empirical-Bayes prior's concentration, in TRAIN jobs' worth of tasks (κ <= priorJobsCap × tasksPerJob). */
export const PRIOR_JOBS_CAP = 2;

/**
 * H0's fitting minimum (PREREG-NEED-V1 §6, prereg-rules.mjs thetaFitStatus): θ is fitted only with at least 2 confident
 * N = 1 positives (workflow) from at least 2 TRAIN clusters and 2 confident negatives from 2 clusters. Below it H0 is
 * "not fitted": every job reads structure-unknown and NR-static has one leaf, the pooled TRAIN stats.
 */
export const RULE_MINIMUM = Object.freeze({ minPos: 2, minPosClusters: 2, minNeg: 2, minNegClusters: 2 });

const EPS = 1e-12;
const finite = Number.isFinite;
const fmt = x => (x === Infinity ? '+inf' : x === -Infinity ? '-inf' : Number(x).toFixed(3));
const enc = x => (x === Infinity ? '+inf' : x === -Infinity ? '-inf' : x);
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Only the trusted keys, only finite values. Every v1 entry point reads features through this. */
export function trustedFeatures(f) {
  return Object.freeze(Object.fromEntries(TRUSTED_FEATURES.filter(k => finite(f?.[k])).map(k => [k, f[k]])));
}

/**
 * A (V, N, W) cell from a makeCell result or a plain { V, N, W?, wOverV?, key? }. W/V comes from `wOverV`, else from `W`
 * (as metrics.cellKey reads it), else 1 (W = V, the headline). A W and a wOverV that disagree, or a key that does not
 * name the cell's V, N and W, are refused: a plain cell's W is never silently read as W = V.
 */
export function resolveCell(cell) {
  if (!cell || typeof cell !== 'object') throw new Error('a cell must be an object { V, N, W? | wOverV? }');
  const { V, N } = cell, hasW = cell.W !== undefined && cell.W !== null, hasR = cell.wOverV !== undefined && cell.wOverV !== null;
  if (!(finite(V) && V > 0) || !(finite(N) && N >= 1)) throw new Error(`a cell needs finite V > 0 and N >= 1 (got V=${V} N=${N})`);
  if (hasW && !(finite(cell.W) && cell.W >= 0)) throw new Error(`cell W must be a finite number >= 0 (got ${cell.W})`);
  if (hasR && !(finite(cell.wOverV) && cell.wOverV >= 0)) throw new Error(`cell wOverV must be a finite number >= 0 (got ${cell.wOverV})`);
  if (hasW && hasR && Math.abs(cell.W - cell.wOverV * V) > 1e-9 * Math.max(1, Math.abs(cell.W))) throw new Error(`cell W = ${cell.W} and wOverV = ${cell.wOverV} disagree at V = ${V}`);
  const c = makeCell(V, N, hasR ? cell.wOverV : hasW ? cell.W / V : 1);
  if (cell.key !== undefined && cell.key !== c.key) throw new Error(`cell key "${cell.key}" does not name its V, N and W ("${c.key}")`);
  return c;
}

/** Canonical id of a typed hard requirement (a string or { type }); unknown types throw (refused, never guessed). */
export function requirementType(r) {
  const raw = typeof r === 'string' ? r : r && typeof r === 'object' && typeof r.type === 'string' ? r.type : null;
  if (raw === null) throw new Error(`a hard requirement must be a type name or { type }: ${JSON.stringify(r)}`);
  const id = raw.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-the-/g, '-');
  if (!REQUIREMENT_TYPES[id]) throw new Error(`unknown hard-requirement type "${raw}" (known: ${Object.keys(REQUIREMENT_TYPES).join(', ')})`);
  return id;
}

/**
 * Stage 0, the hard guard (code, never learned). Typed requirements force the workflow class; `engine` (an array of
 * constructs, or { constructs }) flags what the engine lacks, null = not declared. Word cues (`job.cues`) and a low
 * measured guard recall only raise "ask". Returns { forced, requirement, requirements, engineSupport, ask }.
 */
export function guardStage(job = {}, { engine = null, recall = null } = {}) {
  const requirements = [];
  for (const r of job.requirements ?? []) { const t = requirementType(r); if (!requirements.includes(t)) requirements.push(t); }
  const forced = requirements.length > 0, needed = [...new Set(requirements.flatMap(t => REQUIREMENT_TYPES[t]))].sort();
  let engineSupport;
  if (!forced) engineSupport = { ok: true, needed, missing: [], declared: engine !== null };
  else if (engine === null) engineSupport = { ok: null, needed, missing: [], declared: false };
  else { const have = new Set(Array.isArray(engine) ? engine : engine.constructs ?? []); const missing = needed.filter(c => !have.has(c)); engineSupport = { ok: !missing.length, needed, missing, declared: true }; }
  const cues = [...new Set((job.cues ?? []).map(String))].filter(c => Object.hasOwn(CUE_HINTS, c)).sort(), reasons = [];
  for (const c of cues) if (!requirements.includes(CUE_HINTS[c])) reasons.push(`word cue ${c} hints ${CUE_HINTS[c]}, which is not declared`);
  if (recall !== null && recall < GUARD_RECALL_MIN && !forced) reasons.push(`guard recall ${fmt(recall)} < ${GUARD_RECALL_MIN}: ask instead of inferring no requirement`);
  return { forced, requirement: requirements[0] ?? null, requirements, engineSupport, ask: { raised: reasons.length > 0, reasons, cues } };
}

/** Stage 1, H0 at fixed thresholds: { intrinsic: true | false | null (a rule key is missing and none fired), reason, missing }. */
export function intrinsicOf(features, thresholds) {
  const fired = [], below = [], missing = [];
  for (const [k, t] of Object.entries(thresholds)) {
    const v = features?.[k];
    if (t === Infinity) { below.push(`${k}: θ = +inf, never fires`); continue; }
    if (!finite(v)) { missing.push(k); continue; }
    (v >= t ? fired : below).push(`${k} ${fmt(v)} ${v >= t ? '>=' : '<'} θ ${fmt(t)}`);
  }
  if (fired.length) return { intrinsic: true, reason: fired.join('; '), missing };
  if (missing.length) return { intrinsic: null, reason: `structure unreadable: ${missing.join(', ')} missing`, missing };
  return { intrinsic: false, reason: below.join('; ') || 'no rule keys', missing };
}

/**
 * Balanced accuracy of need calls `pred` against truths `y`: { value, why, tp, fn, tn, fp }. It is undefined (value null,
 * with the reason) when one class is absent: a one-class "balanced accuracy" would be a single recall under another name.
 */
export function balancedAccuracyOf(pred, y) {
  let tp = 0, fn = 0, tn = 0, fp = 0;
  pred.forEach((p, i) => { if (y[i]) { if (p) tp += 1; else fn += 1; } else if (p) fp += 1; else tn += 1; });
  const pos = tp + fn, neg = tn + fp;
  if (!pos || !neg) return { value: null, why: `balanced accuracy undefined: ${pos} positive and ${neg} negative confident item(s) scored (one class absent)`, tp, fn, tn, fp };
  return { value: (tp / pos + tn / neg) / 2, why: null, tp, fn, tn, fp };
}

/** PREREG §6's fitting minimum over confident items ({ cluster, workflow }): prereg-rules.mjs thetaFitStatus itself. */
export function ruleFitStatus(conf, minimum = RULE_MINIMUM) {
  return thetaFitStatus(conf, { ...RULE_MINIMUM, ...minimum });
}

const RULE_METHOD = 'PREREG §6: prereg-rules.mjs thetaFitStatus (minimum), fitOrRule on the confident items (midpoints, ties to the larger θ key by key)';
const RULE_METHOD_FEWEST = 'PREREG §6 minimum and midpoint candidates (thetaFitStatus); ties to the fewest TRAIN workflow calls, then the larger θ key by key (DESIGN §3; thetaTie fewest-calls)';
const callsOf = (pool, keys, th) => pool.filter(f => keys.some((k, j) => (finite(f[k]) ? f[k] : -Infinity) >= th[j])).length;

/**
 * H0's θ on confident items ({ features, workflow }) under a tie rule (THETA_TIES). 'prereg' is prereg-rules.mjs
 * fitOrRule itself. 'fewest-calls' visits the same candidates (per key +∞ and the midpoints between adjacent distinct
 * confident values, largest first) and keeps, among the pairs of highest balanced accuracy, the one that fires on the
 * fewest of `pool` (the features of every TRAIN item of the fit, confident or not), then the larger thresholds key by key.
 */
function fitTheta(conf, keys, { tie = 'prereg', pool = null } = {}) {
  if (tie === 'prereg') return fitOrRule(conf, keys);
  const pos = conf.filter(x => x.workflow).length, neg = conf.length - pos;
  if (!pos || !neg) throw new Error('fitTheta needs confident items of both classes (check thetaFitStatus first)');
  const cands = keys.map(k => { const v = [...new Set(conf.map(x => x.features[k]).filter(finite))].sort((a, b) => a - b); return [Infinity, ...v.slice(1).map((x, i) => (x + v[i]) / 2).reverse()]; });
  const P = (pool ?? conf.map(x => x.features));
  let best = null;
  const visit = (i, th) => {
    if (i === keys.length) {
      let tp = 0, tn = 0;
      for (const x of conf) { const call = keys.some((k, j) => (finite(x.features[k]) ? x.features[k] : -Infinity) >= th[j]); if (x.workflow) tp += call ? 1 : 0; else tn += call ? 0 : 1; }
      const ba = (tp / pos + tn / neg) / 2, calls = callsOf(P, keys, th);
      if (!best || ba > best.ba + 1e-12 || (Math.abs(ba - best.ba) <= 1e-12 && calls < best.calls)) best = { ba, th: [...th], calls };
      return;
    }
    for (const t of cands[i]) visit(i + 1, [...th, t]);
  };
  visit(0, []);
  return { thresholds: Object.fromEntries(keys.map((k, i) => [k, best.th[i]])), balancedAccuracy: best.ba };
}
const checkTie = tie => { if (!THETA_TIES.includes(tie)) throw new Error(`thetaTie must be one of ${THETA_TIES.join(', ')}, got ${tie}`); return tie; };

/**
 * Fit H0's thresholds by the preregistered rule (PREREG §6): thetaFitStatus is the gate (at least 2 confident N = 1
 * positives from 2 TRAIN clusters and 2 negatives from 2 clusters), then prereg-rules.mjs fitOrRule on the CONFIDENT
 * items only: candidates per key are +∞ and the midpoints between adjacent distinct confident values (never a job's own
 * value), the highest in-sample balanced accuracy wins, ties go to the larger thresholds key by key (θ_tok first). LOCO
 * (ruleLoco) is the reported estimate. Below the minimum the rule is not fitted: `fitted: false`, `why`, every θ = +∞ and
 * no balanced accuracy; decide then reads the structure as unknown and abstains (`rule-unfitted`) rather than calling
 * every job "no workflow". `workflowCalls` counts the TRAIN items the fitted rule fires on. `tie: 'fewest-calls'` breaks
 * ties by that count instead (DESIGN §3; THETA_TIES), pending a PREREG §13 addendum.
 */
export function fitStructuralRule(items, { keys = RULE_KEYS, cell = N1, minimum = RULE_MINIMUM, tie = 'prereg' } = {}) {
  checkTie(tie);
  const val = (it, k) => (finite(it.features[k]) ? it.features[k] : -Infinity);
  const conf = items.filter(it => it.label(cell)?.confident), y = conf.map(it => it.label(cell).label === 'workflow');
  const status = ruleFitStatus(conf.map((it, i) => ({ cluster: it.cluster, workflow: y[i] })), minimum);
  const counts = { confident: conf.length, pos: status.pos, neg: status.neg, posClusters: status.posClusters, negClusters: status.negClusters };
  const method = tie === 'prereg' ? RULE_METHOD : RULE_METHOD_FEWEST;
  if (!status.fit) return { keys: [...keys], thresholds: Object.fromEntries(keys.map(k => [k, Infinity])), trainBalancedAccuracy: null, ...counts, workflowCalls: 0, fitted: false, why: status.why, tie, method };
  const fit = fitTheta(conf.map((it, i) => ({ features: it.features, workflow: y[i] })), [...keys], { tie, pool: items.map(it => it.features) });
  const fires = it => keys.some(k => val(it, k) >= fit.thresholds[k]);
  return { keys: [...keys], thresholds: { ...fit.thresholds }, trainBalancedAccuracy: fit.balancedAccuracy, ...counts, workflowCalls: items.filter(fires).length, fitted: true, why: null, tie, method };
}

/**
 * The preregistered leave-one-cluster-out balanced accuracy of H0 (PREREG §6; prereg-rules.mjs locoFolds and fitOrRule).
 * Each fold refits θ by fitOrRule on the confident items of the other clusters. A fold is undefined only when its training
 * part has no confident positive or no confident negative (locoFolds): it is listed with its reason and excluded from the
 * estimate, never scored as θ = +∞. A held-out confident item whose structure cannot be read (a rule key missing and
 * nothing fired, where decide would abstain) is skipped and counted, never scored as "no workflow". The pooled estimate
 * is null, with `why`, when the scored items hold one class only. `tie` is the fit's tie rule (THETA_TIES), applied per fold.
 */
export function ruleLoco(items, { keys = RULE_KEYS, cell = N1, tie = 'prereg' } = {}) {
  checkTie(tie);
  const clusters = [...new Set(items.map(it => it.cluster))].sort();
  if (clusters.length < 2) return null;
  const conf = items.filter(it => it.label(cell)?.confident).map(it => ({ it, cluster: it.cluster, workflow: it.label(cell).label === 'workflow' }));
  const lf = locoFolds(conf, clusters), pred = [], y = [], folds = [], skipped = [];
  for (const f of lf.folds) {
    const fold = { heldOutCluster: f.held, defined: f.defined, trainPos: f.trainPos, trainNeg: f.trainNeg, thresholds: null, scored: 0, skipped: 0,
      why: f.defined ? null : `undefined (PREREG §6): the training part has ${f.trainPos} confident positive(s) and ${f.trainNeg} confident negative(s)` };
    if (f.defined) {
      const r = fitTheta(conf.filter(x => x.cluster !== f.held).map(x => ({ features: x.it.features, workflow: x.workflow })), [...keys], { tie, pool: items.filter(it => it.cluster !== f.held).map(it => it.features) });
      fold.thresholds = Object.fromEntries(Object.entries(r.thresholds).map(([k, t]) => [k, enc(t)]));
      for (const x of conf.filter(z => z.cluster === f.held)) {
        const call = intrinsicOf(x.it.features, r.thresholds).intrinsic;
        if (call === null) { fold.skipped += 1; skipped.push({ id: x.it.id, cluster: f.held, why: 'structure unreadable (a rule key is missing and none fired): decide abstains, so LOCO does not score it' }); continue; }
        pred.push(call); y.push(x.workflow); fold.scored += 1;
      }
    }
    folds.push(fold);
  }
  const ba = balancedAccuracyOf(pred, y);
  return { balancedAccuracy: ba.value, why: ba.why, confident: pred.length, counts: { tp: ba.tp, fn: ba.fn, tn: ba.tn, fp: ba.fp }, skipped: skipped.length, skippedItems: skipped,
    defined: lf.defined, undefined: lf.undefined, folds, tie, method: tie === 'prereg' ? 'PREREG §6: prereg-rules.mjs locoFolds and fitOrRule' : 'PREREG §6: prereg-rules.mjs locoFolds; θ per fold under thetaTie fewest-calls' };
}

function checkStats(st, where) {
  for (const k of ['s', 'q', 'c', 'B']) if (!finite(st?.[k])) throw new Error(`${where}: ${k} must be a finite number`);
  if (st.s < -1e-9 || st.s > 1 + 1e-9 || st.q < -1e-9 || st.q > 1 + 1e-9 || st.s + st.q > 1 + 1e-9 || st.c < -1e-9 || st.B < -1e-9) throw new Error(`${where}: stats out of range ${JSON.stringify(st)}`);
  const z = x => (Math.abs(x) < 1e-12 ? 0 : x);
  return Object.freeze({ s: z(st.s), q: z(st.q), c: z(st.c), B: z(st.B) });
}

/**
 * A TRAIN item: { id, cluster, features, stats: { <mode>: { s, q, c, B } } (or a Map), label(cell) -> { label, confident }
 * (or labels: { <cell key>: {...} }) }. s = verified-success rate, q = delivered wrong rate, c = $ per task, B = build $.
 */
export function trainItem(x) {
  if (!x || typeof x.id !== 'string' || x.cluster === undefined) throw new Error('a TRAIN item needs a string id and a cluster');
  const entries = x.stats instanceof Map ? [...x.stats] : Object.entries(x.stats ?? {});
  const statsMap = new Map(entries.map(([m, st]) => [m, checkStats(st, `${x.id}/${m}`)]));
  const label = typeof x.label === 'function' ? x.label : cell => x.labels?.[cellKey(cell)] ?? null;
  return Object.freeze({ id: x.id, cluster: String(x.cluster), features: trustedFeatures(x.features), statsMap, label });
}

/** Weighted mean stats per mode over items ({s, q, c, B, n}); `complete` keeps modes every item has. Order-stable. */
function poolStats(items, weights = null, { complete = false } = {}) {
  const acc = new Map();
  items.forEach((it, i) => {
    const w = weights ? weights[i] : 1;
    for (const [m, st] of it.statsMap) {
      const a = acc.get(m) ?? { s: 0, q: 0, c: 0, B: 0, w: 0, n: 0 };
      a.s += w * st.s; a.q += w * st.q; a.c += w * st.c; a.B += w * st.B; a.w += w; a.n += 1;
      acc.set(m, a);
    }
  });
  const out = new Map();
  for (const [m, a] of acc) if (!complete || a.n === items.length) out.set(m, Object.freeze({ s: a.s / a.w, q: a.q / a.w, c: a.c / a.w, B: a.B / a.w, n: a.n }));
  return out;
}

/**
 * Stage 2's decision rule over predicted per-mode stats (Map mode -> {s, q, c, B}) at one (V, N, W) cell. The choice is
 * the cheapest member of { m : u_m >= u_max − delta } in $ per task at N (c + B/N), then the higher utility, then the
 * earlier mode in `order`: delta = 0 is the exact best with exact ties to the cheaper mode (the router's default), and
 * delta = δ gives "δ ties" (this function's default, kept for its callers and the sensitivity). `acceptable` is the
 * reported acceptable set A = { m : u_m >= u_max − max(delta, acceptDelta) } (DESIGN §2), ranked; it always holds the
 * choice. Returns { mode, best (exact argmax), tie (mode ≠ best), acceptable, U, usd, maxU }.
 *
 * Monotone in V (fixed N, W). Write u_m = a_m − k_m·t with t = 1/V, a_m = s_m − (W/V)·q_m (constant in V, W being a
 * multiple of V) and k_m = c_m + B_m/N. Let H be chosen at t1 and X at t2 < t1. If k_X < k_H, X was not in A at t1 (it
 * would have been chosen), so u_X(t1) < u_M(t1) − δ for the best M at t1, where k_M >= k_H > k_X (H was the cheapest in
 * A); u_X − u_M only falls as t falls, so X is not in A at t2 either, a contradiction. So k_X >= k_H. If k_X > k_H, H is
 * not in A at t2 (it would be chosen), so u_X(t2) > u_H(t2), hence a_X − a_H > (k_X − k_H)·t2 > 0; if k_X = k_H the
 * utility tie-break gives a_X >= a_H. Hence a (success-equivalents) and $ per task never fall as V rises (any delta).
 *
 * Monotone in N (fixed V, W) for delta = 0. Write u_m = α_m − b_m·t with t = 1/N and b_m = B_m/V (the routing term
 * r/(N·V) is common to every mode and moves no comparison). The exact best traces the upper envelope of these lines, so
 * as t falls the chosen b, hence the chosen build cost, never decreases (exact ties go to the cheaper c + B/N, which
 * keeps this). For the class: if the mode chosen at N has B > 0, every later choice has B > 0, so it is a workflow mode
 * whenever every mode with a build cost is one (no-workflow modes have B = 0). If it has B = 0, a later choice with
 * B = 0 is the best of the B = 0 modes, whose order (u, then c, then `order`) does not depend on N: the same mode. So
 * once a workflow is chosen at N it stays chosen at every larger N. With delta > 0 neither statement holds.
 */
export function decideModes(pred, cell, { delta = DELTA, acceptDelta = delta, order = null, routingUsd = 0 } = {}) {
  if (!(finite(delta) && delta >= 0) || !(finite(acceptDelta) && acceptDelta >= 0)) throw new Error(`decideModes: delta and acceptDelta must be finite and >= 0 (got ${delta}, ${acceptDelta})`);
  const ms = (order ?? [...pred.keys()]).filter(m => pred.has(m));
  if (!ms.length) throw new Error('decideModes: no mode to decide among');
  const e = ms.map((mode, i) => { const st = pred.get(mode); return { mode, i, u: needUtility(st, cell, routingUsd), usd: perTaskUsd(st, cell) }; });
  const best = bestOf(e);
  const pool = e.filter(x => x.u >= best.u - delta - EPS), A = e.filter(x => x.u >= best.u - Math.max(delta, acceptDelta) - EPS);
  const pick = [...pool].sort((a, b) => (Math.abs(a.usd - b.usd) > EPS ? a.usd - b.usd : Math.abs(a.u - b.u) > EPS ? b.u - a.u : a.i - b.i))[0];
  return { mode: pick.mode, best: best.mode, tie: pick.mode !== best.mode, acceptable: rankModes(A), U: new Map(e.map(x => [x.mode, x.u])), usd: new Map(e.map(x => [x.mode, x.usd])), maxU: best.u };
}

const PRIOR_FLOOR = 1e-3;   // a Beta parameter floor: a leaf whose jobs all pass (or all fail) still gets a proper prior

/**
 * NR-probe's prior for one mode in one leaf, from the per-job verified-success rates `rates` of the leaf's TRAIN jobs.
 * 'empirical-bayes' (default; review E5): a Beta whose mean is the leaf mean μ and whose concentration κ is the method-of-
 * moments estimate of the between-job dispersion, corrected for the binomial noise of tasksPerJob tasks per job
 * (Var(rate) = μ(1 − μ)·(1 + (n − 1)ρ)/n, ρ = 1/(κ + 1)); κ is clamped to [kappaMin, kappaMax], and is kappaMax (the cap,
 * priorJobsCap jobs' worth of tasks) when the dispersion cannot be estimated (one job, every job at 0 or 1, or a spread
 * within binomial noise). A probe of a few draws therefore moves a job's rate as far as jobs in the leaf actually differ.
 * 'pooled-tasks' (the PREREG §6 text): Beta(1 + μ·T, 1 + (1 − μ)·T), T = jobs × tasksPerJob, which treats every TRAIN
 * task of the leaf as a draw of this job's rate (review E5: a probe then hardly moves anything).
 * Returns { a, b, kappa, mu, jobs, kind, why }.
 */
export function leafPrior(rates, { kind = 'empirical-bayes', tasksPerJob = 12, kappaMax = PRIOR_JOBS_CAP * tasksPerJob, kappaMin = 1 } = {}) {
  if (!PROBE_PRIORS.includes(kind)) throw new Error(`probe prior must be one of ${PROBE_PRIORS.join(', ')}, got ${kind}`);
  if (!rates.length || !rates.every(r => finite(r) && r >= -1e-9 && r <= 1 + 1e-9)) throw new Error('leafPrior needs at least one rate in [0, 1]');
  const J = rates.length, mu = Math.min(1, Math.max(0, rates.reduce((a, x) => a + x, 0) / J));
  if (kind === 'pooled-tasks') { const T = J * tasksPerJob; return { a: 1 + mu * T, b: 1 + (1 - mu) * T, kappa: 2 + T, mu, jobs: J, kind, why: `pooled tasks: T = ${J} job(s) x ${tasksPerJob}` }; }
  if (!(finite(kappaMax) && kappaMax >= kappaMin && kappaMin > 0)) throw new Error(`leafPrior: need 0 < kappaMin <= kappaMax (got ${kappaMin}, ${kappaMax})`);
  let kappa = kappaMax, why;
  const w = mu * (1 - mu);
  if (J < 2) why = 'one TRAIN job: between-job dispersion not estimable, κ at the cap';
  else if (w <= 1e-12) why = `every TRAIN job at rate ${mu}: dispersion not estimable, κ at the cap`;
  else if (tasksPerJob < 2) why = 'one task per job: the binomial noise hides the dispersion, κ at the cap';
  else {
    const v = rates.reduce((a, x) => a + (x - mu) ** 2, 0) / (J - 1), rho = (tasksPerJob * v / w - 1) / (tasksPerJob - 1);
    if (rho <= 0) why = `spread of ${J} job rates within binomial noise (variance ${v.toFixed(4)}): κ at the cap`;
    else { kappa = Math.min(kappaMax, Math.max(kappaMin, 1 / rho - 1)); why = `method of moments over ${J} job rates (variance ${v.toFixed(4)}, ρ ${rho.toFixed(4)})${kappa === kappaMax ? ', capped' : kappa === kappaMin ? ', floored' : ''}`; }
  }
  return { a: Math.max(PRIOR_FLOOR, mu * kappa), b: Math.max(PRIOR_FLOOR, (1 - mu) * kappa), kappa, mu, jobs: J, kind, why };
}

/**
 * NR-probe's update (DESIGN §3): each observed mode's prior Beta(a, b) updated with the probe's deployable passes,
 * s = (a + passes)/(a + b + n). `priors`: { <mode>: { a, b } } (or a Map), the router's leaf priors (leafPrior); without
 * `priors`, the 'pooled-tasks' prior Beta(1 + s·T, 1 + (1 − s)·T), T = support jobs × tasksPerJob, from the prediction
 * itself. `observations`: { <mode>: { passes, n } }. An observation on a mode the prediction lacks, or without a prior,
 * is refused, never ignored. Mapping a deployable pass to a success is the caller's (TBD-FREEZE). q is capped so p + q <= 1.
 */
export function withProbe(pred, { observations = {}, tasksPerJob = 12, priors = null } = {}) {
  const out = new Map(pred);
  for (const [m, o] of Object.entries(observations)) {
    const st = pred.get(m);
    if (!st) throw new Error(`probe observation for ${m}: the router has no prediction for this mode (refused, never ignored)`);
    if (!(Number.isInteger(o?.n) && o.n >= 0 && Number.isInteger(o.passes) && o.passes >= 0 && o.passes <= o.n)) throw new Error(`probe observation for ${m} needs integers 0 <= passes <= n`);
    let a, b;
    if (priors) {
      const pr = priors instanceof Map ? priors.get(m) : priors[m];
      if (!(pr && finite(pr.a) && pr.a > 0 && finite(pr.b) && pr.b > 0)) throw new Error(`probe observation for ${m}: no prior for this mode`);
      ({ a, b } = pr);
    } else { const T = (st.n ?? 1) * tasksPerJob; a = 1 + st.s * T; b = 1 + (1 - st.s) * T; }
    const s = (a + o.passes) / (a + b + o.n);
    out.set(m, Object.freeze({ ...st, s, q: Math.min(st.q, 1 - s) }));
  }
  return out;
}

function standardizer(items, keys = TRUSTED_FEATURES) {
  const mu = {}, sd = {};
  for (const k of keys) {
    const xs = items.map(it => it.features[k]).filter(finite);
    mu[k] = xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0;
    sd[k] = xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - mu[k]) ** 2, 0) / (xs.length - 1)) || 1 : 1;
  }
  const z = f => keys.map(k => ((finite(f[k]) ? f[k] : mu[k]) - mu[k]) / sd[k]);
  // The keys the distance reads (a key no TRAIN item has is 0 for everyone and moves no distance).
  const used = keys.filter(k => items.some(it => finite(it.features[k])));
  return { z, mu, sd, used, missingOf: f => used.filter(k => !finite(f?.[k])) };
}
function nearestOf(pool, std, features, k) {
  const q = std.z(features);
  return pool.map(it => ({ it, d: Math.hypot(...std.z(it.features).map((x, i) => x - q[i])) }))
    .sort((a, b) => a.d - b.d || byId(a.it, b.it)).slice(0, Math.min(k, pool.length));
}
const knnPred = nb => poolStats(nb.map(x => x.it), nb.map(x => 1 / (1 + x.d)), { complete: true });

/**
 * k for the kNN stage by leave-one-cluster-out on TRAIN at the headline cell (ties to the first k listed). A held-out
 * item with a missing kNN feature (decide abstains there) or with no mode in common with its neighbours' prediction is
 * skipped, and a cluster with nothing scored drops out of the mean: both are counted per k in `skipped`, never lost.
 */
function chooseK(items, { ks, order, delta }) {
  const clusters = [...new Set(items.map(it => it.cluster))].sort(), scores = {}, skipped = {};
  if (clusters.length < 2) return { k: ks[0], scores: null, skipped: null };
  let k = ks[0], bestU = -Infinity;
  for (const kk of ks) {
    const sk = { missingFeatures: [], noCommonMode: [], clusters: [] };
    const per = clusters.map(c => {
      const pool = items.filter(it => it.cluster !== c), std = standardizer(pool), us = [];
      for (const it of items.filter(x => x.cluster === c)) {
        if (std.missingOf(it.features).length) { sk.missingFeatures.push(it.id); continue; }
        const pred = knnPred(nearestOf(pool, std, it.features, kk)), cand = new Map([...pred].filter(([m]) => it.statsMap.has(m)));
        if (cand.size) us.push(needUtility(it.statsMap.get(decideModes(cand, HEADLINE, { delta, order }).mode), HEADLINE));
        else sk.noCommonMode.push(it.id);
      }
      if (!us.length) sk.clusters.push(c);
      return us.length ? us.reduce((a, x) => a + x, 0) / us.length : null;
    }).filter(x => x !== null);
    scores[kk] = per.length ? per.reduce((a, x) => a + x, 0) / per.length : null;
    skipped[kk] = { items: sk.missingFeatures.length + sk.noCommonMode.length, missingFeatures: sk.missingFeatures, noCommonMode: sk.noCommonMode, clusters: sk.clusters };
    if (scores[kk] !== null && scores[kk] > bestU + EPS) { bestU = scores[kk]; k = kk; }
  }
  return { k, scores, skipped };
}

/**
 * NR-probe's prior per mode in one leaf: the ONE function both decide's probe update (withProbe) and card.mjs probePlan's
 * EVSI read (review E5, third review R9), from the per-job verified-success rates of the leaf's TRAIN items. `kind` is
 * leafPrior's ('pooled-tasks': Beta(1 + s·T, 1 + (1 − s)·T), T = support jobs × tasksPerJob, the PREREG §6 text as read so
 * far; 'empirical-bayes': the method-of-moments Beta). Returns { <mode>: { a, b, kappa, mu, jobs, kind } }.
 */
export function probePriors(leafItems, modes, { kind = 'pooled-tasks', tasksPerJob = 12 } = {}) {
  return Object.fromEntries(modes.map(m => {
    const rates = leafItems.map(it => it.statsMap.get(m)?.s).filter(finite);
    if (rates.length !== leafItems.length) throw new Error(`probePriors: mode ${m} is missing from some TRAIN job of the leaf (leaf stats compare modes on the same jobs)`);
    const { a, b, kappa, mu, jobs } = leafPrior(rates, { kind, tasksPerJob });
    return [m, Object.freeze({ a, b, kappa, mu, jobs, kind })];
  }));
}

const BUNDLE_TOTAL = Object.values(PROBE_BUNDLE.draws).reduce((a, k) => a + k, 0);
/** label-run's probe-row id (its ctx.probes key): `<job>|<mode>|<draw>`. */
export const probeRowId = row => `${row.job}|${row.mode}|${row.draw}`;
function parseRowId(id) {
  if (typeof id !== 'string') return null;
  const i = id.lastIndexOf('|'), j = id.lastIndexOf('|', i - 1);
  if (j <= 0 || i <= j + 1 || !/^\d+$/.test(id.slice(i + 1))) return null;
  return { job: id.slice(0, j), mode: id.slice(j + 1, i), draw: Number(id.slice(i + 1)) };
}

/**
 * The provenance rules a probe's observations must meet (DESIGN §3, PREREG §6; third review R3, R11), as a list of
 * problems (empty = valid). probeRecord throws on them and card.mjs validateCard reports them, so both apply one rule set:
 * at least one observed mode; only PROBEABLE modes; each observation { passes, n >= 1, signal (PROBE_SIGNALS, allowed for
 * its mode), rows } names exactly n × rowsPerTrial distinct probe rows of its own mode, each a draw of the preregistered
 * bundle (PROBE_BUNDLE: draw < its draws for the mode); every row names one job (`jobId` when given); k (when given) is
 * at least the rows drawn and at most the bundle's draws.
 */
export function probeProblems(observations, { k = null, jobId = null } = {}) {
  const out = [];
  if (!observations || typeof observations !== 'object' || Array.isArray(observations)) return ['probe.observations must be an object { <mode>: { passes, n, signal, rows } }'];
  const entries = Object.entries(observations);
  if (!entries.length) out.push('a probe that ran must observe at least one probeable mode (no observation is no probe: pass probe null)');
  const jobs = new Set();
  let drawn = 0;
  for (const [m, o] of entries) {
    if (!PROBEABLE.includes(m)) { out.push(`observation on ${m}: not a probeable mode (${PROBEABLE.join(', ')}); refused, never used`); continue; }
    if (!(Number.isInteger(o?.n) && o.n >= 1 && Number.isInteger(o.passes) && o.passes >= 0 && o.passes <= o.n)) { out.push(`observation on ${m} needs integers 0 <= passes <= n, n >= 1`); continue; }
    const sig = PROBE_SIGNALS[o.signal];
    if (!sig) { out.push(`observation on ${m} must name its deployable signal kind (${Object.keys(PROBE_SIGNALS).join(', ')}), got ${JSON.stringify(o.signal ?? null)}`); continue; }
    if (!sig.modes.includes(m)) { out.push(`observation on ${m}: signal ${o.signal} reads ${sig.modes.join(', ')} only`); continue; }
    if (!Array.isArray(o.rows) || !o.rows.length) { out.push(`observation on ${m} must name its probe rows (label-run probe-row ids <job>|<mode>|<draw>)`); continue; }
    if (new Set(o.rows).size !== o.rows.length) out.push(`observation on ${m} names a probe row twice`);
    if (o.rows.length !== o.n * sig.rowsPerTrial) out.push(`observation on ${m}: ${o.n} ${o.signal} trial(s) read ${o.n * sig.rowsPerTrial} row(s), it names ${o.rows.length}`);
    const cap = PROBE_BUNDLE.draws[m];
    if (o.rows.length > cap) out.push(`observation on ${m}: ${o.rows.length} draws exceed the preregistered bundle's ${cap} (${PROBE_BUNDLE.id})`);
    for (const id of o.rows) {
      const r = parseRowId(id);
      if (!r) { out.push(`observation on ${m}: ${JSON.stringify(id)} is not a probe-row id <job>|<mode>|<draw>`); continue; }
      if (r.mode !== m) out.push(`observation on ${m} names a ${r.mode} row (${id})`);
      if (!(r.draw < cap)) out.push(`observation on ${m}: row ${id} is draw ${r.draw}, outside the bundle's ${cap} draw(s)`);
      jobs.add(r.job);
    }
    drawn += o.rows.length;
  }
  if (jobs.size > 1) out.push(`probe rows name ${jobs.size} jobs (${[...jobs].sort().join(', ')}): a probe reads one job's rows`);
  if (jobId !== null && jobs.size === 1 && !jobs.has(String(jobId))) out.push(`probe rows are job ${[...jobs][0]}'s, not ${jobId}'s`);
  if (k !== null && !(Number.isInteger(k) && k >= Math.max(1, drawn) && k <= BUNDLE_TOTAL)) out.push(`probe.k must be an integer in [max(1, rows drawn ${drawn}), ${BUNDLE_TOTAL}] (the bundle's draws), got ${k}`);
  return out;
}

/**
 * A probe as `decide` and the card accept it (DESIGN §3: "its cost is charged as r"). `probe` = { observations:
 * { <mode>: { passes, n, signal, rows } }, costUsd, k?, signals?, disagree?, tasksPerJob? }. Refused, never booked at $0: a
 * missing, non-finite or negative costUsd; a probe that drew or observed anything at costUsd 0; k below the observed
 * draws; a tasksPerJob other than the router's (the prior's weight is a fitted parameter). Refused as a leakage path
 * (third review R3, R11; probeProblems): an empty probe, a mode outside PROBEABLE, draws beyond PROBE_BUNDLE, an
 * observation without its signal kind and probe rows, rows of another job (`jobId`). A pass is counted from deployable
 * signals by whoever read the rows (probeFromRows); evaluate checks it against probes.jsonl (verifyProbeRows). Returns
 * { bundle, observations, costUsd, k, modes, signals, disagree } or null for no probe.
 */
export function probeRecord(probe, { tasksPerJob = 12, jobId = null } = {}) {
  if (probe === null || probe === undefined) return null;
  if (typeof probe !== 'object' || Array.isArray(probe)) throw new Error('a probe must be an object { observations, costUsd, ... }');
  const obs = probe.observations ?? {};
  if (!obs || typeof obs !== 'object' || Array.isArray(obs)) throw new Error('probe.observations must be an object { <mode>: { passes, n, signal, rows } }');
  for (const [m, o] of Object.entries(obs)) if (!(Number.isInteger(o?.n) && o.n >= 0 && Number.isInteger(o.passes) && o.passes >= 0 && o.passes <= o.n)) throw new Error(`probe observation for ${m} needs integers 0 <= passes <= n`);
  const drawn = Object.values(obs).reduce((a, o) => a + (Array.isArray(o.rows) ? o.rows.length : o.n), 0), k = probe.k ?? drawn;
  if (!(Number.isInteger(k) && k >= drawn)) throw new Error(`probe.k must be an integer >= the observed draws (${drawn}), got ${probe.k}`);
  if (typeof probe.costUsd !== 'number' || !finite(probe.costUsd) || probe.costUsd < 0) throw new Error(`a probe's costUsd must be a finite number >= 0 (got ${probe.costUsd}): its cost is charged as routing dollars (DESIGN §3)`);
  if ((k > 0 || Object.keys(obs).length > 0) && !(probe.costUsd > 0)) throw new Error(`a probe that drew or observed anything (k = ${k}, ${Object.keys(obs).length} mode(s)) cannot cost $0: state its costUsd (DESIGN §3 charges it as routing dollars)`);
  if (probe.tasksPerJob !== undefined && probe.tasksPerJob !== tasksPerJob) throw new Error(`probe.tasksPerJob ${probe.tasksPerJob} differs from the router's ${tasksPerJob}`);
  const problems = probeProblems(obs, { k, jobId });
  if (problems.length) throw new Error(`probe refused: ${problems.join('; ')}`);
  return Object.freeze({
    bundle: PROBE_BUNDLE.id,
    observations: Object.freeze(Object.fromEntries(Object.entries(obs).sort(([a], [b]) => (a < b ? -1 : 1)).map(([m, o]) => [m, Object.freeze({ passes: o.passes, n: o.n, signal: o.signal, rows: Object.freeze([...o.rows].sort()) })]))),
    costUsd: probe.costUsd, k, modes: Object.keys(obs).sort(), signals: probe.signals ?? null, disagree: probe.disagree === true,
  });
}

const rowCost = r => Math.max(finite(r.usdReported) ? r.usdReported : 0, (finite(r.usdRepriced) ? r.usdRepriced : 0) + (finite(r.usdImputed) ? r.usdImputed : 0));
const oracleFieldsOf = r => ORACLE_FIELDS.filter(f => Object.hasOwn(r, f));
/** Passes per trial of one observation, recomputed from its rows (rows sorted by draw; agreement reads them in pairs). */
function trialPasses(signal, rows) {
  if (signal === 'schemaValid') return rows.map(r => r.schemaValid === true);
  if (signal === 'deployableVerdict') return rows.map(r => r.deployableVerdict === 'pass');
  const out = [];
  for (let i = 0; i + 1 < rows.length; i += 2) { const [x, y] = [rows[i], rows[i + 1]]; out.push(!!(x.delivered && y.delivered && x.outputHash != null && x.outputHash === y.outputHash)); }
  return out;
}

/**
 * NR-probe's observations from label-run's need-probe-row/1 rows of one job (DESIGN §3: deployable signals only). `signals`
 * names the signal kind per probeable mode. Rows of another job, of a mode outside PROBEABLE, beyond the bundle's draws or
 * carrying an oracle field (ORACLE_FIELDS) are refused. The cost is the §12 meter of the rows (max of reported and
 * re-priced plus imputed), so it covers what evaluate.routingChecks measures. `disagree`: two delivered direct-H answers
 * differ. Returns the probe object decide and decisionCard take.
 */
export function probeFromRows(rows, { job, signals = { 'direct-H': 'schemaValid', 'agent-H': 'schemaValid' } } = {}) {
  if (typeof job !== 'string' || !job) throw new Error('probeFromRows needs the job id the rows belong to');
  const mine = (rows ?? []).filter(r => r && r.job === job);
  if (!mine.length) throw new Error(`probeFromRows: no probe row of job ${job}`);
  const observations = {}, used = [];
  for (const m of PROBEABLE) {
    const rs = mine.filter(r => r.mode === m).sort((a, b) => a.draw - b.draw);
    if (!rs.length) continue;
    const signal = signals[m];
    if (!PROBE_SIGNALS[signal]?.modes.includes(m)) throw new Error(`probeFromRows: no deployable signal kind for ${m} (got ${JSON.stringify(signal ?? null)})`);
    for (const r of rs) { const bad = oracleFieldsOf(r); if (bad.length) throw new Error(`probe row ${probeRowId(r)} carries oracle field(s) ${bad.join(', ')}: a probe never reads the oracle`); }
    const per = PROBE_SIGNALS[signal].rowsPerTrial, take = rs.slice(0, Math.floor(rs.length / per) * per), t = trialPasses(signal, take);
    if (!t.length) continue;
    observations[m] = { passes: t.filter(Boolean).length, n: t.length, signal, rows: take.map(probeRowId) };
    used.push(...take);
  }
  const other = mine.filter(r => !PROBEABLE.includes(r.mode));
  if (other.length) throw new Error(`probeFromRows: rows on ${[...new Set(other.map(r => r.mode))].join(', ')}, not a probeable mode`);
  const dh = mine.filter(r => r.mode === 'direct-H' && r.delivered && r.outputHash != null);
  return { observations, costUsd: used.reduce((a, r) => a + rowCost(r), 0), k: used.length, disagree: dh.length >= 2 && new Set(dh.map(r => r.outputHash)).size > 1 };
}

/**
 * A card's (or a probe record's) probe checked against label-run's probes.jsonl rows (for evaluate.mjs, L6/routing): every
 * named row exists, carries no oracle field, and the observation's passes are what its signal kind reads from those rows;
 * the probe's cost covers the rows' dollars. Returns { ok, problems }.
 */
export function verifyProbeRows(probe, rows) {
  const problems = [...probeProblems(probe?.observations, { k: probe?.k ?? null })];
  const byId = new Map((rows ?? []).map(r => [probeRowId(r), r]));
  let usd = 0;
  for (const [m, o] of Object.entries(probe?.observations ?? {})) {
    if (!Array.isArray(o?.rows) || !PROBE_SIGNALS[o.signal]) continue;
    const rs = o.rows.map(id => byId.get(id));
    const missing = o.rows.filter((id, i) => !rs[i]);
    if (missing.length) { problems.push(`${m}: probe row(s) ${missing.join(', ')} not in probes.jsonl`); continue; }
    for (const r of rs) { const bad = oracleFieldsOf(r); if (bad.length) problems.push(`${m}: row ${probeRowId(r)} carries oracle field(s) ${bad.join(', ')}`); usd += rowCost(r); }
    const passes = trialPasses(o.signal, [...rs].sort((a, b) => a.draw - b.draw)).filter(Boolean).length;
    if (passes !== o.passes) problems.push(`${m}: ${o.signal} reads ${passes} pass(es) from its rows, the probe says ${o.passes}`);
  }
  if (finite(probe?.costUsd) && probe.costUsd + 1e-9 < usd) problems.push(`probe cost $${probe.costUsd} < $${usd.toFixed(6)} metered on its rows`);
  return { ok: !problems.length, problems };
}

const CLASSES = Object.freeze(['workflow', 'no-workflow']), KINDS = Object.freeze(['none', 'guided', 'built']);

/**
 * Fit the v1 router on TRAIN items (trainItem shape, or evaluate.mjs's context through itemsFromContext). Options:
 *   modes        registry order of the modes it may choose (tie-break order); default: the modes seen in TRAIN, MODES order
 *   classOf      mode -> 'workflow' | 'no-workflow' (default metrics.classOf); kindOf: mode -> none | guided | built. Both
 *                are read once per mode at fit time and frozen into `fitted.classes` (so routerSha covers them)
 *   stage        'leaf' (NR-static, primary: stages 0-2) or 'knn' (NR-knn, secondary: stage 0 then the kNN stage)
 *   delta        the choice's tie width: 0 (default) is the exact best, exact ties to the cheaper mode (DESIGN §3 stage 2);
 *                DELTA (0.03) gives "δ ties", the cheapest mode within δ of the best (a preregistered sensitivity only)
 *   acceptDelta  the width of the reported acceptable set (DESIGN §2: 0.03)
 *   ks, k        kNN candidates (chosen by leave-one-cluster-out) or a fixed k
 *   ruleMinimum  H0's fitting minimum (PREREG §6; RULE_MINIMUM); below it H0 is not fitted and NR-static has one leaf
 *   minLeafJobs  a leaf with fewer TRAIN jobs falls back to the pooled stats (an abstention)
 *   engine, guardRecall  the guard's engine constructs and measured recall (null: not declared / not measured)
 *   cascades, checkpointAfter  the run-time cascade specs and the re-route checkpoint (both enter routerSha). A cascade
 *                is chosen as its own mode (its id in `modes`, priced from its derived rows); a pure choice runs pure
 *   tasksPerJob  TRAIN tasks per job, the weight of NR-probe's Beta prior (12, DESIGN §2)
 *   thetaTie     H0's tie rule (THETA_TIES; 'prereg' default, PREREG §6 as written)
 *   probePrior   NR-probe's prior kind (PROBE_PRIORS; 'pooled-tasks' default), read by decide and probePlan alike
 *   probeMapping the pass-to-success mapping's { id, frozen } (PROBE_MAPPING until the Freeze addendum)
 * Returns { decide(job, cell, { routingUsd, probe }), leafTable(cells), neighbours(features), fitted, ... }.
 */
export function fitNeedRouter(train, opts = {}) {
  const { modes = null, classOf = m => registryClassOf(m), kindOf = m => modeInfo(m).kind, stage = 'leaf', ruleKeys = RULE_KEYS, ruleCell: ruleCellIn = N1, delta = 0,
    acceptDelta = DELTA, ks = [3, 5], k = null, ruleMinimum = RULE_MINIMUM, minLeafJobs = 1, engine = null, guardRecall = null, defaultMode = DEFAULT_MODE,
    cascades = CASCADES, checkpointAfter = 4, tasksPerJob = 12, thetaTie = 'prereg', probePrior = 'pooled-tasks', probeMapping = PROBE_MAPPING } = opts;
  if (!['leaf', 'knn'].includes(stage)) throw new Error(`stage must be leaf or knn, got ${stage}`);
  if (!(finite(delta) && delta >= 0)) throw new Error(`delta must be >= 0, got ${delta}`);
  if (!(finite(acceptDelta) && acceptDelta >= 0)) throw new Error(`acceptDelta must be >= 0, got ${acceptDelta}`);
  if (!(Number.isInteger(checkpointAfter) && checkpointAfter >= 1)) throw new Error(`checkpointAfter must be an integer >= 1, got ${checkpointAfter}`);
  if (!(Number.isInteger(tasksPerJob) && tasksPerJob >= 1)) throw new Error(`tasksPerJob must be an integer >= 1, got ${tasksPerJob}`);
  if (!Array.isArray(cascades) || !cascades.every(x => x && ['id', 'primary', 'fallback'].every(f => typeof x[f] === 'string') && Array.isArray(x.on) && x.on.every(o => typeof o === 'string'))) throw new Error('cascades must be [{ id, primary, fallback, on: [string] }]');
  checkTie(thetaTie);
  if (!PROBE_PRIORS.includes(probePrior)) throw new Error(`probePrior must be one of ${PROBE_PRIORS.join(', ')}, got ${probePrior}`);
  if (!(probeMapping && typeof probeMapping.id === 'string' && probeMapping.id && typeof probeMapping.frozen === 'boolean')) throw new Error('probeMapping must be { id: string, frozen: boolean }');
  for (const key of ruleKeys) if (!TRUSTED_FEATURES.includes(key)) throw new Error(`rule key ${key} is not a trusted feature`);
  const ruleCell = resolveCell(ruleCellIn);
  const items = train.map(trainItem).sort(byId);
  if (!items.length) throw new Error('fitNeedRouter needs at least one TRAIN item');
  items.forEach((it, i) => { if (i && it.id === items[i - 1].id) throw new Error(`duplicate TRAIN item ${it.id}`); });
  const seen = [...new Set(items.flatMap(it => [...it.statsMap.keys()]))];
  const registry = Object.keys(MODES);
  const order = modes ? [...modes] : [...seen].sort((a, b) => (registry.indexOf(a) + 1 || 1e9) - (registry.indexOf(b) + 1 || 1e9) || (a < b ? -1 : 1));
  // Class and kind of every mode, read once and frozen: the decision uses these maps only, so routerSha names them.
  const CLASS = new Map(), KIND = new Map();
  for (const m of order) {
    const cl = classOf(m), kd = kindOf(m);
    if (!CLASSES.includes(cl)) throw new Error(`classOf(${m}) must be workflow or no-workflow, got ${cl}`);
    if (!KINDS.includes(kd)) throw new Error(`kindOf(${m}) must be none, guided or built, got ${kd}`);
    CLASS.set(m, cl); KIND.set(m, kd);
  }
  const rule = fitStructuralRule(items, { keys: ruleKeys, cell: ruleCell, minimum: ruleMinimum, tie: thetaTie });
  const loco = ruleLoco(items, { keys: ruleKeys, cell: ruleCell, tie: thetaTie });
  const leafOf = it => { if (!rule.fitted) return null; const x = intrinsicOf(it.features, rule.thresholds).intrinsic; return x === null ? null : x ? 'intrinsic' : 'not'; };
  // Leaf stats compare modes on the same jobs (DESIGN §3 stage 2: "among TRAIN jobs in that leaf"): a mode missing from
  // any job of the leaf is dropped there (listed), as in the kNN stage and SBS-train.
  const leaves = {};
  for (const [leaf, xs] of [['intrinsic', items.filter(it => leafOf(it) === 'intrinsic')], ['not', items.filter(it => leafOf(it) === 'not')], ['pooled', items]]) {
    const stats = poolStats(xs, null, { complete: true });
    // NR-probe's prior per mode (probePriors, the one function the probe update and probePlan share): leaf stage only.
    const priors = stage === 'leaf' && xs.length ? probePriors(xs, [...stats.keys()], { kind: probePrior, tasksPerJob }) : {};
    leaves[leaf] = { jobs: xs.length, items: xs, stats, priors, dropped: [...new Set(xs.flatMap(it => [...it.statsMap.keys()]))].filter(m => !stats.has(m)).sort() };
  }
  const kn = stage === 'knn' ? (() => { const ch = k === null ? chooseK(items, { ks, order, delta }) : { k, scores: null }; return { ...ch, std: standardizer(items) }; })() : null;
  const nearest = features => nearestOf(items, kn.std, trustedFeatures(features), kn.k);

  // A run-time cascade rides a choice only when the chosen mode IS the cascade (third review R1): its pred is then the
  // cascade's derived rows, and evaluate scores that same mode. A pure choice runs pure: no cascade is attached to it.
  const cascadeOf = mode => {
    const s = cascades.find(x => x.id === mode);
    return s ? { id: s.id, primary: s.primary, fallback: s.fallback, on: [...s.on] } : null;
  };

  function decide(job = {}, cell = HEADLINE, { routingUsd = 0, probe = null } = {}) {
    const c = resolveCell(cell);
    const pr = probeRecord(probe, { tasksPerJob, jobId: typeof job.id === 'string' ? job.id : null });
    if (pr && stage !== 'leaf') throw new Error('a probe updates the leaf calculator (NR-probe = stages 0-1, the probe, stage 2); the kNN stage takes no probe');
    if (typeof routingUsd !== 'number' || !finite(routingUsd) || routingUsd < 0) throw new Error(`routingUsd must be a finite number >= 0, got ${routingUsd}`);
    const features = trustedFeatures(job.features);
    const available = job.modes ? order.filter(m => job.modes.includes(m)) : [...order];
    const notInRouter = job.modes ? job.modes.filter(m => !order.includes(m)) : [];
    const guard = guardStage(job, { engine: job.engine ?? engine, recall: guardRecall });
    const structure = rule.fitted ? intrinsicOf(features, rule.thresholds) : { intrinsic: null, reason: `rule-unfitted: ${rule.why}`, missing: [] };
    const reasons = [];
    let pred, source, fallback = null, priors = null, knnBlind = false;
    if (stage === 'leaf') {
      let leaf = structure.intrinsic === null ? null : structure.intrinsic ? 'intrinsic' : 'not';
      if (leaf === null) { reasons.push(`${rule.fitted ? `structure-unknown: ${structure.reason}` : structure.reason}; pooled TRAIN stats used`); leaf = 'pooled'; fallback = 'pooled'; }
      else if (leaves[leaf].jobs < minLeafJobs) { reasons.push(`thin-leaf: ${leaves[leaf].jobs} TRAIN job(s) in leaf ${leaf} (< ${minLeafJobs}); pooled TRAIN stats used`); leaf = 'pooled'; fallback = 'pooled'; }
      pred = leaves[leaf].stats; priors = leaves[leaf].priors; source = { stage, leaf, jobs: leaves[leaf].jobs };
    } else {
      // A trusted feature the distance reads is missing: the job's structure cannot be placed among its neighbours, so
      // the kNN stage abstains to the pooled TRAIN stats, as the leaf stage does (third review R6; chooseK skips such
      // items the same way). Imputing the TRAIN mean would route it silently.
      const missing = kn.std.missingOf(features);
      if (missing.length) {
        reasons.push(`structure-unknown: kNN feature(s) ${missing.join(', ')} missing; pooled TRAIN stats used`); fallback = 'pooled'; knnBlind = true;
        pred = leaves.pooled.stats; source = { stage, k: kn.k, neighbours: null, leaf: 'pooled', jobs: leaves.pooled.jobs };
      } else {
        const nb = nearest(features);
        pred = knnPred(nb); source = { stage, k: kn.k, neighbours: nb.map(x => ({ id: x.it.id, cluster: x.it.cluster, d: x.d })) };
      }
    }
    const routing = routingUsd + (pr?.costUsd ?? 0);
    if (pr) pred = withProbe(pred, { observations: pr.observations, tasksPerJob, priors });
    const supported = available.filter(m => pred.has(m)), unsupported = [...available.filter(m => !pred.has(m)), ...notInRouter];
    let candidates = supported;
    if (guard.forced) {
      const wf = supported.filter(m => CLASS.get(m) === 'workflow');
      if (wf.length) candidates = wf;
      else { reasons.push('forced-without-workflow-mode: a typed requirement forces the workflow class, but no workflow mode is runnable and supported'); fallback = 'all-modes'; }
    }
    let r = null, mode;
    if (!candidates.length) {
      mode = available.includes(defaultMode) ? defaultMode : available[0] ?? null;
      if (mode === null) throw new Error('decide: the job has no mode this router knows');
      reasons.push(`no-supported-mode: no runnable mode has TRAIN support; today's default ${mode} used`); fallback = 'default-mode';
    } else {
      r = decideModes(new Map(candidates.map(m => [m, pred.get(m)])), c, { delta, acceptDelta, order, routingUsd: routing });
      mode = r.mode;
      if (r.maxU < 0) reasons.push(`no-mode-pays: best predicted utility ${fmt(r.maxU)} < 0 at V = ${c.V} (declining is not a v1 mode; the least-bad mode is kept)`);
    }
    // needsWorkflow (C7a) is cell-independent: the guard, else the structural rule (leaf stage), else the kNN stage's own
    // class at the intrinsic-need cell ruleCell (V = $1, W = V, N = 1), whatever the slider says.
    let needsWorkflow;
    if (guard.forced) needsWorkflow = true;
    else if (stage === 'leaf') needsWorkflow = structure.intrinsic;
    else if (knnBlind) needsWorkflow = null;
    else needsWorkflow = r ? CLASS.get(decideModes(new Map(candidates.map(m => [m, pred.get(m)])), ruleCell, { delta, acceptDelta, order }).mode) === 'workflow' : null;
    const verifier = job.verifier == null ? 'none' : String(job.verifier).trim().toLowerCase().replace(/[\s_]+/g, '-');
    const askReasons = [...guard.ask.reasons];
    if (pr?.disagree && !DEPLOYABLE_VERIFIERS.includes(verifier)) askReasons.push(`the probe disagreed with itself and the verifier (${verifier}) cannot arbitrate`);
    const cascade = cascadeOf(mode);
    // The task-4 re-route checkpoint (a $0 secondary, DESIGN §3 item 4) reads "tasks that fell back": only the construct-H
    // cascade has a fallback, so a pure construct-H choice carries none (third review R1).
    const checkpoint = cascade?.primary === 'construct-H' && available.includes('agent-H')
      ? { afterTask: checkpointAfter, switchTo: 'agent-H', when: 'at least half of the tasks so far fell back' } : null;
    const P = r ? candidates : [];
    return {
      stage, mode, best: r?.best ?? null, tie: r?.tie ?? false, acceptable: r?.acceptable ?? [], features, verifier, guard, structure, source,
      pred: Object.fromEntries(P.map(m => { const st = pred.get(m); return [m, { p: st.s, q: st.q, abstain: Math.max(0, 1 - st.s - st.q), c: st.c, F: st.B, usdPerTask: r.usd.get(m), n: st.n }]; })),
      U: Object.fromEntries(P.map(m => [m, r.U.get(m)])), unsupported, needsWorkflow, class: CLASS.get(mode), kind: KIND.get(mode),
      cascade, checkpoint, askFlag: askReasons.length > 0, ask: askReasons, abstain: reasons.length ? { reasons, fallback } : null,
      probe: pr, routingCostUsd: routing, cell: c,
      // NR-probe's prior for each priced mode (leaf stage): what probePlan's EVSI reads and what a probe update starts from.
      priors: priors ? Object.fromEntries(P.filter(m => priors[m]).map(m => [m, priors[m]])) : null,
    };
  }

  const leafTable = (cells = [HEADLINE]) => Object.fromEntries(Object.entries(leaves).filter(([, L]) => L.jobs > 0 && L.stats.size > 0).map(([leaf, L]) => [leaf, Object.fromEntries(cells.map(cc => {
    const x = decideModes(L.stats, resolveCell(cc), { delta, acceptDelta, order }); return [cellKey(cc), { mode: x.mode, best: x.best, tie: x.tie }];
  }))]));
  const statsJson = m => Object.fromEntries([...m].map(([mode, st]) => [mode, { s: st.s, q: st.q, c: st.c, B: st.B, n: st.n }]));
  const fitted = Object.freeze({
    version: 'need-router/1', stage, delta, acceptDelta, ruleKeys: [...ruleKeys], ruleCell: ruleCell.key, minLeafJobs, defaultMode, modes: order, tasksPerJob,
    // NR-probe's frozen parts (third review R3, R7, R9): the prior kind, the pass-to-success mapping, the bundle and the
    // signal kinds, so cards from another prior or mapping carry another routerSha.
    probe: { prior: probePrior, mapping: { id: probeMapping.id, frozen: probeMapping.frozen }, bundle: { id: PROBE_BUNDLE.id, draws: { ...PROBE_BUNDLE.draws } }, probeable: [...PROBEABLE], signals: Object.keys(PROBE_SIGNALS) },
    classes: Object.fromEntries(order.map(m => [m, { class: CLASS.get(m), kind: KIND.get(m) }])),
    cascades: cascades.map(x => ({ id: x.id, primary: x.primary, fallback: x.fallback, on: [...x.on] })),
    checkpoint: { afterTask: checkpointAfter, from: 'construct-H', switchTo: 'agent-H' },
    rule: {
      thresholds: Object.fromEntries(Object.entries(rule.thresholds).map(([key, t]) => [key, enc(t)])), trainBalancedAccuracy: rule.trainBalancedAccuracy, confident: rule.confident,
      workflowCalls: rule.workflowCalls, fitted: rule.fitted, why: rule.why, minimum: { ...RULE_MINIMUM, ...ruleMinimum }, tie: thetaTie,
    },
    loco, leaves: Object.fromEntries(Object.entries(leaves).map(([l, L]) => [l, { jobs: L.jobs, stats: statsJson(L.stats), dropped: [...L.dropped],
      priors: Object.fromEntries(Object.entries(L.priors).map(([m, x]) => [m, { a: x.a, b: x.b }])) }])),
    knn: kn ? { k: kn.k, ks: [...ks], scores: kn.scores, mu: kn.std.mu, sd: kn.std.sd, items: items.map(it => ({ id: it.id, cluster: it.cluster, features: it.features, stats: statsJson(it.statsMap) })) } : null,
    guard: { engine: engine === null ? null : [...(Array.isArray(engine) ? engine : engine.constructs ?? [])].sort(), recall: guardRecall },
    train: { jobs: items.length, clusters: [...new Set(items.map(it => it.cluster))].sort() },
  });
  return {
    stage, delta, acceptDelta, tasksPerJob, probePrior, order, rule, loco, decide, leafTable, fitted, ruleCell,
    k: kn?.k ?? null,
    neighbours: features => (kn ? nearest(features).map(x => x.it.cluster) : null),
  };
}

// ------------------------------------------------------------------------------- evaluate.mjs policies (--router)

/**
 * TRAIN items from evaluate.mjs's fitting context. The context exposes s(m), u(cell, m) and usd(cell, m) per job; q, c
 * and B follow from u = s − c/V − B/(N·V) − (W/V)·q and usd = c + B/N at three cells (checked against s; a negative q, c
 * or B is refused). Label permutations (L2) pass through, since every read goes through the context. Cascade modes in the
 * context (evaluate.mjs derives them from the paired rows) become items' stats like any mode.
 */
export function itemsFromContext(ctx) {
  const a = makeCell(1, 1, 0), b = makeCell(1, 1, 1), h = makeCell(1, 2, 0);
  return ctx.train.map(it => {
    const stats = {};
    for (const m of it.modes) {
      const s = it.s(m), u0 = it.u(a, m), q = u0 - it.u(b, m), usd1 = it.usd(a, m), B = 2 * (usd1 - it.usd(h, m)), c = usd1 - B;
      if (Math.abs(u0 - (s - c - B)) > 1e-9) throw new Error(`itemsFromContext: ${it.view.id}/${m} utility does not decompose as s − c/V − B/(N·V) − (W/V)·q`);
      // A negative q (u at W = 0 below u at W = V), c or B can only come from an accounting error: refused, never clamped
      // to 0 (third review R10). Only float noise (> −1e-9) is clamped.
      for (const [k, x] of [['q', q], ['c', c], ['B', B]]) if (x < -1e-9) throw new Error(`itemsFromContext: ${it.view.id}/${m} derives ${k} = ${x} < 0 (an accounting error in the label context)`);
      stats[m] = { s, q: Math.max(0, q), c: Math.max(0, c), B: Math.max(0, B) };
    }
    return { id: it.view.id, cluster: it.cluster, features: it.view.features, stats, label: cell => it.label(cell) };
  });
}

const toPolicyDecision = d => {
  const p = d.pred[d.mode];
  return {
    mode: d.mode, routingUsd: d.routingCostUsd, needsWorkflow: d.needsWorkflow, guard: d.guard, structure: d.structure, abstain: d.abstain, askFlag: d.askFlag,
    pred: p ? { p: p.p, usd: p.usdPerTask, q: p.q, c: p.c, F: p.F, u: d.U[d.mode] } : null,
  };
};

/** NR-static (co-primary A): stages 0-2, no model call before the work. A policy in evaluate.mjs's sense. */
export function nrStaticPolicy({ name = 'NR-static', role = 'primary', ...opts } = {}) {
  return {
    name, role, features: [...(opts.ruleKeys ?? RULE_KEYS)], frozen: 'router.mjs v1',
    fit(ctx) {
      const R = fitNeedRouter(itemsFromContext(ctx), { modes: ctx.modes, classOf: m => ctx.classOf(m), kindOf: m => modeInfo(m, ctx.registry).kind, ...opts, stage: 'leaf' });
      const ch = (view, cell) => toPolicyDecision(R.decide(view, cell));
      ch.fitted = { thresholds: R.rule.thresholds, trainBalancedAccuracy: R.rule.trainBalancedAccuracy, confident: R.rule.confident, workflowCalls: R.rule.workflowCalls, loco: R.loco, ruleFitted: R.rule.fitted, why: R.rule.why };
      ch.router = R;
      return ch;
    },
  };
}

/** NR-knn (secondary 1): stage 0, then the kNN stage with k by leave-one-cluster-out; exposes neighbours for L8. */
export function nrKnnPolicy({ name = 'NR-knn', role = 'secondary', ...opts } = {}) {
  return {
    name, role, features: [...TRUSTED_FEATURES], frozen: 'router.mjs v1',
    fit(ctx) {
      const R = fitNeedRouter(itemsFromContext(ctx), { modes: ctx.modes, classOf: m => ctx.classOf(m), kindOf: m => modeInfo(m, ctx.registry).kind, ...opts, stage: 'knn' });
      const ch = (view, cell) => toPolicyDecision(R.decide(view, cell));
      ch.neighbours = view => R.neighbours(view.features);
      ch.k = R.k;
      ch.router = R;
      return ch;
    },
  };
}

/** `evaluate.mjs --router experiments/need-router/router.mjs` replaces its reference NR-static and NR-knn with these. */
export const policies = Object.freeze([nrStaticPolicy(), nrKnnPolicy()]);
