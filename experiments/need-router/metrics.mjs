// Need-router scoring (claim C7, ROADMAP §2.8). $0, pure functions, no model calls.
//
// The router picks one execution mode per task family (direct call, agent, construct-before, JIT, reuse, escalation)
// given what is known before execution and the owner's slider V (dollars per verified success). Its score is taken
// against labels from paired runs: every mode run on the same tasks of a family, each task verified by the family's
// oracle, every dollar counted (build, per-task execution, verification, fallbacks).
//
// Terms are those of per-instance algorithm selection (Rice 1976; ASlib, Bischl et al. 2016), with families as the
// instances:
//   utility U(f, m; V, H) = H * (V * p(f,m) - c(f,m)) - F(f,m)
//       p = verified-success rate per task, c = mean per-task cost, F = one-off cost (build, compile, probe), H = horizon
//       (tasks the family will see; default: the number of labelled tasks).
//   VBS   virtual best: the best mode per family (the oracle router).
//   SBS   single best fixed mode: the one mode with the highest total utility, chosen on TRAINING families and then
//         scored on the evaluation families (choosing it on the evaluation families flatters the baseline less, and is
//         reported beside it as `sbsInSample`).
//   regret       VBS - router, summed over families.
//   closed gap   (router - SBS) / (VBS - SBS): 1 = as good as the oracle, 0 = no better than the best fixed mode,
//                negative = worse. Undefined when VBS = SBS (no headroom: then no router can show value).
// Uncertainty: a two-level bootstrap. Families are resampled with replacement; within a family the task ids are
// resampled once and shared by every mode (the runs are paired), so label noise from finite tasks is carried into
// every interval. Seeded, so results are reproducible. `clusterOf` adds a cluster level above the family.
//
// The v1 program (research/need-router-20261014/DESIGN.md §2, §5) adds, below the v0 API (which is kept unchanged):
// a job x mode x task x replicate matrix (`needTable`), utility in success-equivalents per task with the wrong-delivery
// (W·q) and routing (r) terms, lineage-aware hierarchical resampling (cluster -> task -> replicate or lineage),
// cross-fitted VBS*, acceptable sets and NEED labels with their bootstrap confidence and coverage, the fragility
// recompute, SBS per cell and SBS-global, self-test false-pass rates (F11), and the exact sign-flip permutation test
// with test-inversion bounds.
import { FLOOR_POINTS, ENV_FAULT_LIMIT, ENV_FAULT_CODES } from '../jit/stats.mjs';

/** A deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Normalize labels. Input rows: { family, mode, task, success: boolean, costUsd: number } (one per task run) and,
 * optionally, fixed costs { family, mode, fixedUsd } (build/compile/probe, paid once per family). Returns
 * { families: [ids], modes: [ids], cell(f, m) -> { tasks: Map(task -> {success, costUsd}), fixedUsd } }.
 * Every (family, mode) cell must cover the same task ids (paired design); a gap throws, never silently drops.
 */
export function labelTable(rows, fixed = []) {
  const cells = new Map();
  const key = (f, m) => `${f}\u0000${m}`;
  const families = [], modes = [];
  for (const r of rows) {
    if (typeof r.success !== 'boolean' || !Number.isFinite(r.costUsd) || r.costUsd < 0) throw new Error(`bad label row ${JSON.stringify(r)}`);
    if (!families.includes(r.family)) families.push(r.family);
    if (!modes.includes(r.mode)) modes.push(r.mode);
    const c = cells.get(key(r.family, r.mode)) ?? { tasks: new Map(), fixedUsd: 0 };
    if (c.tasks.has(r.task)) throw new Error(`duplicate label ${r.family}/${r.mode}/${r.task}`);
    c.tasks.set(r.task, { success: r.success, costUsd: r.costUsd });
    cells.set(key(r.family, r.mode), c);
  }
  for (const x of fixed) {
    const c = cells.get(key(x.family, x.mode));
    if (!c) throw new Error(`fixed cost for an unlabelled cell ${x.family}/${x.mode}`);
    if (!Number.isFinite(x.fixedUsd) || x.fixedUsd < 0) throw new Error(`bad fixed cost ${JSON.stringify(x)}`);
    c.fixedUsd += x.fixedUsd;
  }
  for (const f of families) {
    const ids = modes.map(m => cells.get(key(f, m)));
    if (ids.some(c => !c)) throw new Error(`family ${f} lacks a mode: ${modes.filter((m, i) => !ids[i])}`);
    const ref = [...ids[0].tasks.keys()].sort().join('|');
    for (const [i, c] of ids.entries()) if ([...c.tasks.keys()].sort().join('|') !== ref) throw new Error(`unpaired tasks in ${f}/${modes[i]}`);
  }
  return { families, modes, cell: (f, m) => cells.get(key(f, m)), taskIds: f => [...cells.get(key(f, modes[0])).tasks.keys()].sort() };
}

/** Utility of one cell over a (possibly resampled) list of task ids. */
export function cellUtility(cell, taskIds, V, H = taskIds.length) {
  let s = 0, c = 0;
  for (const t of taskIds) { const x = cell.tasks.get(t); s += x.success ? 1 : 0; c += x.costUsd; }
  const n = taskIds.length;
  return H * (V * (s / n) - c / n) - cell.fixedUsd;
}

/** Utility of every mode per family: Map(f -> Map(m -> U)). `sample` maps a family to its task ids (default: all). */
export function utilities(table, V, { horizon = null, sample = null, families = table.families } = {}) {
  const out = new Map();
  for (const f of families) {
    const ids = sample?.get(f) ?? table.taskIds(f);
    const H = typeof horizon === 'function' ? horizon(f) : horizon ?? ids.length;
    out.set(f, new Map(table.modes.map(m => [m, cellUtility(table.cell(f, m), ids, V, H)])));
  }
  return out;
}

const argmax = m => [...m.entries()].reduce((b, e) => (e[1] > b[1] ? e : b))[0];

/** The single best fixed mode on a set of families (ties broken by mode order, deterministic). */
export function singleBest(U, families = [...U.keys()]) {
  const modes = [...U.get(families[0]).keys()];
  const tot = new Map(modes.map(m => [m, families.reduce((s, f) => s + U.get(f).get(m), 0)]));
  return argmax(tot);
}

/**
 * Score a router on evaluation families. `choose(f, V)` returns a mode id (it must not see labels; see leakTest).
 * `routingCostUsd(f)` adds the router's own cost (probes, judge calls). `sbsMode` is the fixed mode chosen on training
 * families; when absent the in-sample SBS is used and the result says so.
 */
export function score(U, choose, V, { sbsMode = null, routingCostUsd = () => 0, tieUsd = 0 } = {}) {
  const fams = [...U.keys()];
  let vbs = 0, router = 0, sbs = 0, correct = 0;
  const inSample = singleBest(U, fams);
  const sbsUsed = sbsMode ?? inSample;
  const per = [];
  for (const f of fams) {
    const u = U.get(f);
    const best = Math.max(...u.values());
    const pick = choose(f, V);
    if (!u.has(pick)) throw new Error(`router chose unknown mode ${pick} for ${f}`);
    const got = u.get(pick) - routingCostUsd(f);
    vbs += best; router += got; sbs += u.get(sbsUsed);
    const ok = u.get(pick) >= best - tieUsd;
    correct += ok ? 1 : 0;
    per.push({ family: f, pick, oracle: [...u.entries()].filter(([, x]) => x >= best - tieUsd).map(([m]) => m), regret: best - got });
  }
  const headroom = vbs - sbs;
  return {
    V, families: fams.length, vbs, sbs, router, regret: vbs - router,
    closedGap: headroom > 1e-9 ? (router - sbs) / headroom : null, headroom,
    accuracy: correct / fams.length, sbsMode: sbsUsed, sbsInSample: inSample, sbsFromTraining: sbsMode !== null, per,
  };
}

/** A two-level paired bootstrap of the router's score. Returns point estimates and percentile intervals. */
export function bootstrap(table, choose, V, { reps = 2000, seed = 1, alpha = 0.05, horizon = null, sbsMode = null, routingCostUsd, families = table.families, tieUsd = 0, clusterOf = null } = {}) {
  const r = rng(seed);
  const pick = arr => arr[Math.floor(r() * arr.length)];
  const point = score(utilities(table, V, { horizon, families }), choose, V, { sbsMode, routingCostUsd, tieUsd });
  const stats = { regret: [], closedGap: [], accuracy: [], router: [], vbs: [], sbs: [] };
  // Cluster level (optional): resample clusters, keep every family of each drawn cluster.
  const clusters = clusterOf ? [...new Set(families.map(clusterOf))] : null;
  for (let i = 0; i < reps; i++) {
    const fams = clusters ? clusters.map(() => pick(clusters)).flatMap(c => families.filter(f => clusterOf(f) === c)) : families.map(() => pick(families));
    // Duplicate families get distinct keys so each draw keeps its own task resample.
    const sample = new Map(), U = new Map();
    fams.forEach((f, j) => {
      const ids = table.taskIds(f);
      const draw = ids.map(() => pick(ids));
      sample.set(`${f}#${j}`, draw);
      const H = typeof horizon === 'function' ? horizon(f) : horizon ?? ids.length;
      U.set(`${f}#${j}`, new Map(table.modes.map(m => [m, cellUtility(table.cell(f, m), draw, V, H)])));
    });
    const s = score(U, (k, v) => choose(k.slice(0, k.lastIndexOf('#')), v), V,
      { sbsMode, tieUsd, routingCostUsd: routingCostUsd ? k => routingCostUsd(k.slice(0, k.lastIndexOf('#'))) : undefined });
    for (const k of Object.keys(stats)) if (s[k] !== null) stats[k].push(s[k]);
  }
  const q = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))]; };
  const ci = Object.fromEntries(Object.entries(stats).map(([k, xs]) => [k, { lo: q(xs, alpha / 2), hi: q(xs, 1 - alpha / 2), n: xs.length }]));
  return { point, ci, reps, seed };
}

/**
 * How sure the labels are: per family, the share of task-bootstrap draws in which each mode is the best. A family
 * whose top mode wins < `confident` of draws is ambiguous: a router is not penalised for picking any mode that wins
 * at least `cowinner` of draws (reported, so the benchmark can exclude or tie such families explicitly).
 */
export function labelConfidence(table, V, { reps = 1000, seed = 7, horizon = null, confident = 0.8, cowinner = 0.2 } = {}) {
  const r = rng(seed);
  const out = [];
  for (const f of table.families) {
    const ids = table.taskIds(f);
    const H = typeof horizon === 'function' ? horizon(f) : horizon ?? ids.length;
    const wins = new Map(table.modes.map(m => [m, 0]));
    for (let i = 0; i < reps; i++) {
      const draw = ids.map(() => ids[Math.floor(r() * ids.length)]);
      const u = new Map(table.modes.map(m => [m, cellUtility(table.cell(f, m), draw, V, H)]));
      wins.set(argmax(u), wins.get(argmax(u)) + 1);
    }
    const share = new Map([...wins].map(([m, w]) => [m, w / reps]));
    const top = argmax(share);
    out.push({ family: f, top, share: Object.fromEntries(share), confident: share.get(top) >= confident,
      acceptable: [...share].filter(([, s]) => s >= cowinner).map(([m]) => m) });
  }
  return out;
}

/** Sweep the slider: score at every V; also check the router's picks move toward more reliable modes as V grows. */
export function sliderSweep(table, choose, Vs, opts = {}) {
  const rows = Vs.map(V => ({ V, ...score(utilities(table, V, opts), choose, V, opts) }));
  // Monotonicity: per family, the success rate of the chosen mode should not fall as V rises (a higher value per
  // success never makes a less reliable mode better unless it is also cheaper; violations are listed, not fatal).
  const rate = (f, m) => { const c = table.cell(f, m); let s = 0; for (const x of c.tasks.values()) s += x.success ? 1 : 0; return s / c.tasks.size; };
  const violations = [];
  for (const f of table.families) {
    let prev = null;
    for (const V of [...Vs].sort((a, b) => a - b)) {
      const m = choose(f, V), p = rate(f, m);
      if (prev && p < prev.p - 1e-9) violations.push({ family: f, from: { V: prev.V, mode: prev.m, p: prev.p }, to: { V, mode: m, p } });
      prev = { V, m, p };
    }
  }
  return { rows: rows.map(({ per, ...x }) => x), violations };
}

/**
 * Calibration of a router that predicts, per family and mode, a success rate and a per-task cost before execution.
 * Returns the Brier score of predicted vs realized success rates (per family x mode, task-weighted) and the mean
 * absolute log ratio of predicted to realized cost.
 */
export function calibration(table, predict) {
  let brier = 0, n = 0, logErr = 0, k = 0;
  for (const f of table.families) for (const m of table.modes) {
    const c = table.cell(f, m);
    const pr = predict(f, m);
    if (!pr) continue;
    for (const x of c.tasks.values()) { brier += ((x.success ? 1 : 0) - pr.p) ** 2; n += 1; }
    const mean = [...c.tasks.values()].reduce((s, x) => s + x.costUsd, 0) / c.tasks.size;
    if (pr.costUsd > 0 && mean > 0) { logErr += Math.abs(Math.log(pr.costUsd / mean)); k += 1; }
  }
  return { brier: n ? brier / n : null, costLogErr: k ? logErr / k : null, cells: k };
}

/** Baseline routers, all label-free: each fixed mode, and a uniform random choice (seeded per family and V). */
export function baselines(modes, seed = 3) {
  const fixed = Object.fromEntries(modes.map(m => [`always-${m}`, () => m]));
  const hash = s => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
  return { ...fixed, random: (f, V) => modes[Math.floor(rng(hash(`${seed}|${f}|${V}`))() * modes.length)] };
}

/**
 * Leak test: a router must choose the same modes whatever the evaluation labels say. `makeRouter(table)` builds the
 * router as the harness does (it receives the table so a leak through it is observable); the test builds it twice,
 * once with the real labels and once with a decoy (every success flipped, costs scrambled), and lists every family and
 * V where the choice differs. A router that reads evaluation labels changes its picks; a clean one cannot.
 */
export function leakTest(table, makeRouter, Vs) {
  const decoyRows = [];
  for (const f of table.families) for (const m of table.modes) {
    const c = table.cell(f, m);
    for (const [t, x] of c.tasks) decoyRows.push({ family: f, mode: m, task: t, success: !x.success, costUsd: x.costUsd * 7 + 1 });
  }
  const decoy = labelTable(decoyRows);
  const a = makeRouter(table), b = makeRouter(decoy);
  const diffs = [];
  for (const f of table.families) for (const V of Vs) if (a(f, V) !== b(f, V)) diffs.push({ family: f, V, real: a(f, V), decoy: b(f, V) });
  return { ok: diffs.length === 0, diffs };
}

// =====================================================================================================================
// Need router v1 (DESIGN.md §2, §5). Units: SUCCESS-EQUIVALENTS PER TASK.
//
//   u_m = p_m − c_m/V − B_m/(N·V) − (W/V)·q_m − r/(N·V)
//
// p = rate of oracle-passing DELIVERED answers; c = mean per-task dollars (re-priced, imputed bounds included); B = mean
// build dollars per lineage, failed builds included; q = rate of delivered, schema-valid, wrong answers (silent misses);
// r = the router's own dollars for the job (probes, judge calls), charged to a policy by the scorer, never to a mode.
// An abstention (no answer, or an answer withheld by a failed self-check) costs only its dollars.
//
// Matrix rows (one per job x mode x task x replicate; label-run.mjs writes them; evaluate.mjs MATRIX_FORMAT):
//   { job, mode, task, rep, pass, delivered, schemaValid?, selfVerdict?, deployableVerdict?, score?, passAt?, seed?,
//     taskHash?, usdRepriced | usdReported | costUsd, usdImputed?, usdMeterGap?, ms?, tokens?, error? }
//   usdMeterGap (rows and builds; label-run writes it when the meter gate books a session meterUnverified): the part of
//   usdImputed that is the CLI's own reported figure above the re-price, not a bound. PREREG §5: utility uses the reported
//   figure (cost = usd + imputed is unchanged) and the gap is observed dollars, so it is moved from imputed to usd here
//   and never counts toward the 30%-imputed rule. It may not exceed usdImputed.
//   `pass` is the oracle verdict on the answer the mode produced; `delivered` says an answer was produced at all, BEFORE
//   the self-check gate: the gate is applied here from `selfVerdict`, so that F11 can withdraw its credit (K9).
//   A delivered answer with no `schemaValid` field is read as schema-valid, so a wrong one is charged as a silent miss.
//   Versions and meters (DESIGN §2 "one cost meter", "LEGACY"; ROADMAP §6 rule 13): a row tagged LEGACY (`legacy: true`
//   or `evidence: 'LEGACY'`, harvest.mjs LEGACY_TAG) is refused; the rows of one (job, mode) (of one lineage, for a
//   lineage mode) must carry one `armHash` (a row without one counts as its own version); a row with `repriced: false`
//   (label-run: the cost fell back to the CLI figure or $0) is counted and leaves its job unlabelled; `requireRepriced`
//   (evaluate.mjs sets it) refuses a row without a finite `usdRepriced` instead of falling back to usdReported/costUsd,
//   and a build without `usdRepriced` (or `usd`, label-run's equal copy); a build with `repriced: false` counts like such a
//   row. label-run's `stamp` (recordStamp) is read where present: one `stamp.settingsSha` per (job, mode) across rows and
//   every lineage's build (a later lineage under edited arm settings is refused), one `stamp.priceTable` per table.
//   A voided agent draw (label-run: `void` set, `error: 'VOIDED'`, pass and delivered false; an agent draw is its own
//   lineage of one) scores as a failure and is listed in `table.voidedDraws` (lineage voids stay in `table.voided`).
// Build rows (one per job x mode x lineage, for built or guided modes):
//   { job, mode, rep, usd, usdImputed?, failed?, hiddenPathAttempts?, nestedModelAttempts?, void?, scoreChecks?, ... }
//   A mode with build rows is a LINEAGE mode: `rep` on its task rows names the lineage, every lineage runs every task,
//   and a failed build fails every task of its lineage (its rows may be absent: they are synthesised as $0 failures).
//   hiddenPathAttempts > 0, nestedModelAttempts > 0 or `void` voids a lineage (DESIGN §2 validity gates): by default its
//   rows score as failures and the void is listed (`table.voided`), so a report can block claims until a rerun.

export const DELTA = FLOOR_POINTS / 100;            // acceptable-set width: 0.03 success-equivalents (jit/stats.mjs:39)
export const CONFIDENT = 0.8;                       // a label is confident when P(best class) >= 0.8
export const IMPUTED_LIMIT = 0.3;                   // a (job, cell) whose label rests on a mode over 30% imputed dollars is left unlabelled
/** First-pass replicates (draw modes) and lineages (lineage modes) per task, DESIGN §1 table; racing only adds to them. */
export const FIRST_PASS = Object.freeze({ 'direct-H': 2, 'agent-H': 2, 'agent-O': 1, 'agent-H+proc': 2, 'construct-H': 3, 'build-O': 1, 'ref-R1': 1, 'ref-R3': 1 });
export { ENV_FAULT_LIMIT };
export const V_GRID = Object.freeze([0.1, 1, 10]);  // slider positions: Frugal, Balanced (headline), Careful
export const N_GRID = Object.freeze([1, 10, 100]);  // declared volume; 10 is the headline, 100 is extrapolated
export const W_GRID = Object.freeze([1, 0, 10]);    // W as a multiple of V; W = V is the headline

/** A (V, N, W) cell; W is given as a multiple of V. */
export function makeCell(V, N, wOverV = 1) {
  if (!(V > 0) || !(N >= 1) || !(wOverV >= 0)) throw new Error(`bad cell V=${V} N=${N} W/V=${wOverV}`);
  return Object.freeze({ V, N, wOverV, W: wOverV * V, key: `V=${V} N=${N} W=${wOverV}V` });
}
export const cellKey = c => c.key ?? makeCell(c.V, c.N, c.wOverV ?? (c.W ?? c.V) / c.V).key;
export const HEADLINE = makeCell(1, 10, 1);
/** Every cell of the grid in the preregistered fixed order: the headline, then the one-factor departures, then the rest. */
export const GRID = Object.freeze((() => {
  const first = [HEADLINE, makeCell(0.1, 10), makeCell(10, 10), makeCell(1, 10, 0), makeCell(1, 10, 10), makeCell(1, 1), makeCell(1, 100)];
  const rest = [];
  for (const V of V_GRID) for (const N of N_GRID) for (const w of W_GRID) { const c = makeCell(V, N, w); if (!first.some(x => x.key === c.key)) rest.push(c); }
  return [...first, ...rest];
})());

/** The v1 modes, their class (binary need label) and kind (three-way split). Ceiling arms enter L_ceiling only. */
export const MODES = Object.freeze({
  'direct-H': { cls: 'no-workflow', kind: 'none' },
  'agent-H': { cls: 'no-workflow', kind: 'none' },
  'agent-O': { cls: 'no-workflow', kind: 'none' },
  'agent-H+proc': { cls: 'workflow', kind: 'guided' },
  'construct-H': { cls: 'workflow', kind: 'built' },
  'build-O': { cls: 'workflow', kind: 'built', ceiling: true },
  'ref-R1': { cls: 'workflow', kind: 'built', ceiling: true, prebuilt: true },
  'ref-R3': { cls: 'workflow', kind: 'built', ceiling: true, prebuilt: true },
});
/** Derived at $0 from the paired rows (DESIGN §1). Triggers are deployable signals only, never the oracle. */
export const CASCADES = Object.freeze([
  { id: 'construct-H->agent-H', primary: 'construct-H', fallback: 'agent-H', on: ['null', 'crash', 'schema', 'self'] },
  { id: 'direct-H->agent-H', primary: 'direct-H', fallback: 'agent-H', on: ['null', 'crash', 'schema'] },
  { id: 'agent-H->agent-O', primary: 'agent-H', fallback: 'agent-O', on: ['null'] },
]);
/** A mode's registry entry; a cascade `a->b` takes the class and kind of its primary `a`. Unknown modes throw. */
export function modeInfo(mode, registry = MODES) {
  if (registry[mode]) return registry[mode];
  const i = mode.indexOf('->');
  if (i > 0) return { ...modeInfo(mode.slice(0, i), registry), cascade: true };
  throw new Error(`unknown mode ${mode}: add it to the mode registry`);
}
export const classOf = (mode, registry = MODES) => modeInfo(mode, registry).cls;
/** The modes of a label set: L_today leaves out ceiling arms; L_ceiling keeps everything. */
export const labelSetModes = (modes, set = 'today', registry = MODES) => (set === 'ceiling' ? [...modes] : modes.filter(m => !modeInfo(m, registry).ceiling));

/** FNV-1a, for per-job seeds. */
export function hashString(s) { let h = 0x811c9dc5; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
const fin = (...xs) => xs.find(x => typeof x === 'number' && Number.isFinite(x));
const KEY = (...xs) => xs.join('\u0000');
const mean = xs => xs.reduce((a, x) => a + x, 0) / xs.length;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** A LEGACY-tagged row or build (harvest.mjs LEGACY_TAG; the same predicate as harvest.isLegacy, inlined to keep this module pure). */
export const isLegacyRow = x => x?.legacy === true || x?.evidence === 'LEGACY';

/** The meter gate's gap (usdMeterGap, PREREG §5) moved from imputed to observed dollars; the total is unchanged. */
function meterGapSplit(usd, imputed, gapField, at) {
  if (gapField == null) return { usd, imputed, meterGap: 0 };
  const gap = fin(gapField);
  if (gap === undefined || gap < 0) throw new Error(`${at}: usdMeterGap must be finite and >= 0`);
  if (gap > imputed + 1e-9) throw new Error(`${at}: usdMeterGap ${gap} exceeds usdImputed ${imputed} (the gap is part of the imputed dollars label-run books)`);
  const g = Math.min(gap, imputed);
  return { usd: usd + g, imputed: imputed - g, meterGap: g };
}

function normRow(r, { requireRepriced = false } = {}) {
  const job = r.job, mode = r.mode ?? r.arm, task = r.task ?? r.taskKey;
  const at = `${job}/${mode}/${task}`;
  if (typeof job !== 'string' || typeof mode !== 'string' || typeof task !== 'string') throw new Error(`matrix row needs job, mode and task: ${JSON.stringify(r).slice(0, 200)}`);
  if (isLegacyRow(r)) throw new Error(`matrix row ${at}: a LEGACY row is never pooled with new labels (DESIGN §2)`);
  if (typeof r.pass !== 'boolean') throw new Error(`matrix row ${at}: pass must be a boolean`);
  if (typeof r.delivered !== 'boolean') throw new Error(`matrix row ${at}: delivered must be a boolean (a silent miss cannot be charged without it)`);
  if (r.pass && !r.delivered) throw new Error(`matrix row ${at}: a pass with no delivered answer`);
  if (requireRepriced && fin(r.usdRepriced) === undefined) throw new Error(`matrix row ${at}: no finite usdRepriced (one meter: utility uses the re-priced figure, never a fallback to usdReported or costUsd)`);
  const usd0 = requireRepriced ? fin(r.usdRepriced) : fin(r.usdRepriced, r.usdReported, r.costUsd), imputed0 = fin(r.usdImputed, r.imputedUsd) ?? 0;
  if (usd0 === undefined || usd0 < 0 || imputed0 < 0) throw new Error(`matrix row ${at}: dollars must be finite and >= 0`);
  const { usd, imputed, meterGap } = meterGapSplit(usd0, imputed0, r.usdMeterGap, `matrix row ${at}`);
  const rep = r.rep ?? r.replicate ?? r.lineage ?? r.trial ?? 0;
  if (!Number.isInteger(rep) || rep < 0) throw new Error(`matrix row ${at}: rep must be an integer >= 0`);
  if (r.selfVerdict != null && r.selfVerdict !== 'pass' && r.selfVerdict !== 'fail') throw new Error(`matrix row ${at}: selfVerdict must be pass, fail or null`);
  if (r.armHash != null && typeof r.armHash !== 'string') throw new Error(`matrix row ${at}: armHash must be a string`);
  const error = typeof r.error === 'string' ? r.error : r.error?.code ?? null;
  // An explicit void reason, or label-run's VOIDED error code (whether it marks a draw or a lineage is settled in needTable).
  const voidReason = r.void ? (typeof r.void === 'string' ? r.void : 'void') : null;
  const voided = !!voidReason;
  return { job, mode, task, rep, pass: voided ? false : r.pass, delivered: voided ? false : r.delivered, schemaValid: r.schemaValid ?? true, selfVerdict: r.selfVerdict ?? null,
    deployableVerdict: r.deployableVerdict ?? null, score: typeof r.score === 'number' ? r.score : null, passAt: r.passAt ?? null,
    seed: Number.isInteger(r.seed) ? r.seed : null, taskHash: r.taskHash ?? null, usd, imputed, ...(meterGap > 0 ? { meterGap } : {}),
    error: voided ? 'VOIDED' : error, voidReason: voidReason ?? (error === 'VOIDED' ? 'VOIDED' : null), explicitVoid: voided,
    armHash: r.armHash ?? null, notRepriced: r.repriced === false, ...stampOf(r, at) };
}

// label-run's per-row and per-build stamp (recordStamp: { stageSha, settingsSha, prompts, priceTable }): the arm's frozen
// settings hash and the price table, the two parts that must not vary inside one (job, mode).
function stampOf(x, at) {
  const s = x.stamp;
  if (s == null) return { settingsSha: null, priceTable: null };
  if (typeof s !== 'object') throw new Error(`${at}: stamp must be an object`);
  return { settingsSha: s.settingsSha ?? null, priceTable: s.priceTable ?? null };
}

// Per-row values with (1) and without (0) self-check credit: credit lets a failed self-check withhold the answer.
function rowValues(x) {
  const d1 = x.delivered && x.selfVerdict !== 'fail', d0 = x.delivered;
  x.succ1 = x.pass && d1 ? 1 : 0; x.wrong1 = d1 && x.schemaValid && !x.pass ? 1 : 0;
  x.succ0 = x.pass && d0 ? 1 : 0; x.wrong0 = d0 && x.schemaValid && !x.pass ? 1 : 0;
  x.cost = x.usd + x.imputed;
  return x;
}

/**
 * The v1 label matrix. Validates and pairs: every mode of a job covers the job's tasks (lineage modes: every lineage
 * covers every task), one seed and one taskHash per (job, task) across modes, no duplicates, unknown modes refused,
 * LEGACY rows refused, one armHash per (job, mode) (per lineage), one stamp.settingsSha per (job, mode) across rows and
 * builds, one stamp.priceTable per table, and (requireRepriced) the re-priced meter only, for rows and builds alike.
 * A gap throws; nothing is dropped silently. Modes may differ between jobs (direct-H is masked on interactive families);
 * whether a job's modes match its declared menu is checked by the caller (evaluate.mjs missingData, PREREG §5).
 */
export function needTable(rows, builds = [], { registry = MODES, voidPolicy = 'fail', requireRepriced = false } = {}) {
  if (voidPolicy !== 'fail' && voidPolicy !== 'drop') throw new Error(`voidPolicy must be fail or drop, got ${voidPolicy}`);
  const cells = new Map(), jobs = [], modes = [], voided = [], voidedDraws = [], lineages = new Map();
  const add = (list, x) => { if (!list.includes(x)) list.push(x); };
  for (const b of builds) {
    const job = b.job, mode = b.mode ?? b.arm, rep = b.rep ?? b.lineage ?? 0;
    if (typeof job !== 'string' || typeof mode !== 'string' || !Number.isInteger(rep) || rep < 0) throw new Error(`build row needs job, mode and an integer rep: ${JSON.stringify(b).slice(0, 200)}`);
    if (isLegacyRow(b)) throw new Error(`build row ${job}/${mode}/${rep}: a LEGACY build is never pooled with new labels (DESIGN §2)`);
    modeInfo(mode, registry);
    // One meter for builds too: under requireRepriced the build's dollars are its re-priced figure (`usdRepriced`, or `usd`,
    // which label-run writes equal to it), never a fallback to usdReported or costUsd; the two fields must agree.
    if (requireRepriced) {
      if (fin(b.usdRepriced, b.usd) === undefined) throw new Error(`build row ${job}/${mode}/${rep}: no finite usdRepriced (one meter: a build is never charged at usdReported or costUsd)`);
      if (fin(b.usdRepriced) !== undefined && fin(b.usd) !== undefined && Math.abs(b.usdRepriced - b.usd) > 1e-9) throw new Error(`build row ${job}/${mode}/${rep}: usd ${b.usd} and usdRepriced ${b.usdRepriced} disagree (two meters)`);
    }
    const usd0 = requireRepriced ? fin(b.usdRepriced, b.usd) : fin(b.usd, b.usdRepriced, b.usdReported, b.costUsd), imputed0 = fin(b.usdImputed, b.imputedUsd) ?? 0;
    if (usd0 === undefined || usd0 < 0 || imputed0 < 0) throw new Error(`build row ${job}/${mode}/${rep}: dollars must be finite and >= 0`);
    const { usd, imputed } = meterGapSplit(usd0, imputed0, b.usdMeterGap, `build row ${job}/${mode}/${rep}`);
    const k = KEY(job, mode), L = lineages.get(k) ?? new Map();
    if (L.has(rep)) throw new Error(`duplicate build row ${job}/${mode}/lineage ${rep}`);
    const reasons = [];
    if (b.hiddenPathAttempts > 0) reasons.push(`hiddenPathAttempts=${b.hiddenPathAttempts}`);
    if (b.nestedModelAttempts > 0) reasons.push(`nestedModelAttempts=${b.nestedModelAttempts}`);
    if (b.void) reasons.push(typeof b.void === 'string' ? b.void : 'void');
    L.set(rep, { rep, usd, imputed, failed: !!b.failed, voided: reasons.length > 0, reasons, build: b, notRepriced: b.repriced === false,
      ...stampOf(b, `build row ${job}/${mode}/${rep}`) });
    lineages.set(k, L);
  }
  for (const r0 of rows) {
    const r = normRow(r0, { requireRepriced });
    modeInfo(r.mode, registry);
    add(jobs, r.job); add(modes, r.mode);
    const k = KEY(r.job, r.mode), c = cells.get(k) ?? { job: r.job, mode: r.mode, byTask: new Map() };
    const t = c.byTask.get(r.task) ?? new Map();
    if (t.has(r.rep)) throw new Error(`duplicate matrix row ${r.job}/${r.mode}/${r.task}/rep ${r.rep}`);
    t.set(r.rep, r); c.byTask.set(r.task, t); cells.set(k, c);
  }
  for (const k of lineages.keys()) if (!cells.has(k)) { const [job, mode] = k.split('\u0000'); add(jobs, job); add(modes, mode); cells.set(k, { job, mode, byTask: new Map() }); }
  const taskIds = new Map(), seeds = new Map(), hashes = new Map(), priceTables = new Set();
  for (const job of jobs) {
    const all = new Set();
    for (const m of modes) for (const t of cells.get(KEY(job, m))?.byTask.keys() ?? []) all.add(t);
    const ids = [...all].sort();
    if (!ids.length) throw new Error(`job ${job} has no task rows`);
    taskIds.set(job, ids);
    for (const m of modes) {
      const c = cells.get(KEY(job, m));
      if (!c) continue;
      const L = lineages.get(KEY(job, m)), info = modeInfo(m, registry);
      // A built or guided mode without build rows would lose its build cost silently: refuse it.
      if (!L && (info.kind === 'built' || info.kind === 'guided') && !info.prebuilt && !info.cascade) throw new Error(`${job}/${m}: a ${info.kind} mode with no build row (its build cost would be lost)`);
      c.lineage = !!L;
      if (L) {
        for (const [t, reps] of c.byTask) for (const rep of reps.keys()) if (!L.has(rep)) throw new Error(`${job}/${m}/${t}: a row for lineage ${rep}, which has no build row`);
        for (const l of [...L.values()]) {
          if (l.voided) voided.push({ job, mode: m, rep: l.rep, reasons: l.reasons, policy: voidPolicy });
          if (l.voided && voidPolicy === 'drop') { L.delete(l.rep); for (const reps of c.byTask.values()) reps.delete(l.rep); continue; }
          for (const t of ids) {
            const reps = c.byTask.get(t) ?? new Map();
            c.byTask.set(t, reps);
            let x = reps.get(l.rep);
            if (!x) {
              if (!l.failed && !l.voided) throw new Error(`unpaired: ${job}/${m} lineage ${l.rep} has no row for task ${t}`);
              x = { job, mode: m, task: t, rep: l.rep, pass: false, delivered: false, schemaValid: false, selfVerdict: null, deployableVerdict: null,
                score: null, passAt: null, seed: null, taskHash: null, usd: 0, imputed: 0, error: l.failed ? 'BUILD_FAILED' : 'VOIDED', synthetic: true };
            } else if (l.failed && x.pass) throw new Error(`${job}/${m}: lineage ${l.rep} has a failed build but a passing row for ${t}`);
            reps.set(l.rep, l.voided ? { ...x, pass: false, delivered: false, error: 'VOIDED' } : x);
          }
        }
        if (!L.size) throw new Error(`${job}/${m}: every lineage was voided and dropped`);
        c.lineageList = [...L.values()].sort((a, b) => a.rep - b.rep);
        c.lineageMap = L;
      } else {
        for (const t of ids) if (!c.byTask.get(t)?.size) throw new Error(`unpaired: ${job}/${m} has no row for task ${t}`);
      }
      const versions = new Map(), settings = new Set();
      c.notRepriced = 0;
      // Builds are on the meter too: a build label-run could not re-price (`repriced: false`) counts like such a row. The
      // arm settings (stamp.settingsSha) must be one per (job, mode) across every lineage's build and rows: a lineage's own
      // armHash carries its number, so a lineage added later (a racing top-up in another stage) under edited settings
      // would otherwise pool unnoticed. A row or build without a stamp is not compared (armHash covers row sources).
      if (L) for (const l of L.values()) {
        if (l.notRepriced) c.notRepriced += 1;
        if (!info.cascade) { if (l.settingsSha != null) settings.add(l.settingsSha); if (l.priceTable != null) priceTables.add(l.priceTable); }
      }
      for (const [t, reps] of c.byTask) for (const x of reps.values()) {
        if (x.seed !== null) { const s = seeds.get(KEY(job, t)); if (s !== undefined && s !== x.seed) throw new Error(`seed pairing broken: ${job}/${t} has seeds ${s} and ${x.seed}`); seeds.set(KEY(job, t), x.seed); }
        if (x.taskHash) { const h = hashes.get(KEY(job, t)); if (h !== undefined && h !== x.taskHash) throw new Error(`taskHash pairing broken: ${job}/${t} (${m})`); hashes.set(KEY(job, t), x.taskHash); }
        if (!x.synthetic && x.notRepriced) c.notRepriced += 1;
        if (!x.synthetic && !info.cascade) {
          // One arm version per (job, mode), per lineage for a lineage mode (a lineage's arm id carries its number).
          const vk = c.lineage ? x.rep : '*', v = versions.get(vk) ?? new Set();
          v.add(x.armHash ?? '(no armHash)'); versions.set(vk, v);
          if (x.settingsSha != null) settings.add(x.settingsSha);
          if (x.priceTable != null) priceTables.add(x.priceTable);
          // A voided draw: an explicit void reason on any row, or the VOIDED code on a draw mode (on a lineage mode the
          // code comes from the build row's void, already listed in `voided`).
          if (x.voidReason && (x.explicitVoid || !c.lineage)) voidedDraws.push({ job, mode: m, task: t, rep: x.rep, reasons: [x.voidReason], lineage: c.lineage });
        }
        rowValues(x);
      }
      for (const [vk, v] of versions) if (v.size > 1) throw new Error(`${job}/${m}${vk === '*' ? '' : ` lineage ${vk}`}: rows from ${v.size} arm versions (armHash ${[...v].sort().join(', ')}) are never pooled`);
      if (settings.size > 1) throw new Error(`${job}/${m}: rows or builds under ${settings.size} arm settings (stamp.settingsSha ${[...settings].sort().join(', ')}) are never pooled`);
      c.reps = new Map([...c.byTask].map(([t, reps]) => [t, [...reps.keys()].sort((a, b) => a - b)]));
    }
  }
  // One meter (DESIGN §2): every stamped row and build of the table priced with one price table.
  if (priceTables.size > 1) throw new Error(`rows or builds priced with ${priceTables.size} price tables (stamp.priceTable ${[...priceTables].sort().join(', ')}): one meter is required`);
  return {
    jobs, modes, registry, voided, voidedDraws, noCredit: new Set(), priceTables: [...priceTables].sort(),
    cell(job, mode) { const c = cells.get(KEY(job, mode)); if (!c) throw new Error(`no cell ${job}/${mode}`); return c; },
    has: (job, mode) => cells.has(KEY(job, mode)),
    modesOf: job => modes.filter(m => cells.has(KEY(job, m))),
    taskIds: job => taskIds.get(job),
    seedOf: (job, task) => seeds.get(KEY(job, task)) ?? null,
    hashOf: (job, task) => hashes.get(KEY(job, task)) ?? null,
    *rows() { for (const c of cells.values()) for (const reps of c.byTask.values()) yield* reps.values(); },
  };
}

/** The same table with the self-check credit withdrawn from some lineages or draws (keys `job|mode|rep`; F11, K9). */
export const withoutSelfCheckCredit = (table, keys) => ({ ...table, noCredit: new Set([...table.noCredit, ...keys]) });

/**
 * Cascade rows derived at $0 from paired rows (no extra runs): where the primary's row shows a trigger (null answer,
 * crash, schema-invalid answer, failed self-check), the cascade's row is the fallback's paired row (primary rep i pairs
 * with the fallback's rep i mod its count) and pays both; otherwise it is the primary's row. A lineage primary's builds
 * carry over (with their failure and void flags). Returns the table with the cascade modes added.
 */
export function withCascades(rows, builds = [], specs = CASCADES, opts = {}) {
  const base = needTable(rows, builds, opts);
  const outRows = [], outBuilds = [];
  const raw = x => ({ pass: x.pass, delivered: x.delivered, schemaValid: x.schemaValid, selfVerdict: x.selfVerdict, deployableVerdict: x.deployableVerdict,
    score: x.score, passAt: x.passAt, error: x.error, ...(x.seed !== null ? { seed: x.seed } : {}), ...(x.taskHash ? { taskHash: x.taskHash } : {}),
    ...(x.notRepriced ? { repriced: false } : {}) });
  for (const s of specs) for (const job of base.jobs) {
    if (!base.has(job, s.primary) || !base.has(job, s.fallback)) continue;
    const P = base.cell(job, s.primary), F = base.cell(job, s.fallback);
    if (F.lineage) throw new Error(`cascade ${s.id}: a lineage fallback is not supported`);
    const trig = x => (s.on.includes('null') && !x.delivered) || (s.on.includes('crash') && x.error != null) || (s.on.includes('schema') && x.delivered && !x.schemaValid)
      || (s.on.includes('self') && x.selfVerdict === 'fail');
    for (const t of base.taskIds(job)) {
      const preps = P.reps.get(t), freps = F.reps.get(t);
      preps.forEach((rep, i) => {
        const x = P.byTask.get(t).get(rep);
        const row = { job, mode: s.id, task: t, rep, ...raw(x), usdRepriced: x.usd, usdImputed: x.imputed };
        if (trig(x)) {
          const f = F.byTask.get(t).get(freps[i % freps.length]);
          Object.assign(row, raw(f), { usdRepriced: x.usd + f.usd, usdImputed: x.imputed + f.imputed, selfVerdict: null, cascaded: true });
          if (x.seed !== null) row.seed = x.seed;
        }
        outRows.push(row);
      });
    }
    // The build is paid either way; a failed build does not fail the cascade's tasks (the fallback runs them).
    if (P.lineage) for (const l of P.lineageList) outBuilds.push({ ...l.build, job, mode: s.id, rep: l.rep, failed: false, primaryBuildFailed: l.failed });
  }
  return needTable([...rows, ...outRows], [...builds, ...outBuilds], opts);
}

/**
 * Aggregate one (job, mode) cell: { s: success rate, q: silent-miss rate, c: $ per task, B: build $ per lineage }.
 * `tasks` may repeat (bootstrap); `lineages` picks lineages (lineage modes); `repsOf(task, i)` picks replicates (draw
 * modes). Each task weighs 1 and its replicates are averaged (racing top-ups add replicates to some tasks only).
 * Returns null when the selection is empty (a cross-fit half with no data).
 */
export function cellStats(table, job, mode, { tasks = null, lineages = null, repsOf = null } = {}) {
  const c = table.cell(job, mode), T = tasks ?? table.taskIds(job), nc = table.noCredit;
  const credit = rep => !nc.size || !nc.has(`${job}|${mode}|${rep}`);
  let s = 0, q = 0, usd = 0, rawImp = 0, rawUsd = 0;
  if (c.lineage) {
    const Ls = lineages ?? c.lineageList.map(l => l.rep);
    if (!Ls.length || !T.length) return null;
    let B = 0, bImp = 0;
    for (const l of Ls) {
      const L = c.lineageMap.get(l), cr = credit(l);
      B += L.usd + L.imputed; bImp += L.imputed;
      for (const t of T) { const x = c.byTask.get(t).get(l); s += cr ? x.succ1 : x.succ0; q += cr ? x.wrong1 : x.wrong0; usd += x.cost; rawImp += x.imputed; }
    }
    const n = Ls.length * T.length;
    // cImp and BImp: the imputed parts of c and B (the imputed-dollar rule is applied per cell, where B/N weighs in).
    return { s: s / n, q: q / n, c: usd / n, B: B / Ls.length, imputedShare: (rawImp + bImp) / ((usd + B) || 1), n, lineages: Ls.length, cImp: rawImp / n, BImp: bImp / Ls.length };
  }
  let w = 0, imp = 0;
  for (let i = 0; i < T.length; i++) {
    const t = T[i], reps = repsOf ? repsOf(t, i) : c.reps.get(t), m = c.byTask.get(t);
    if (!reps.length) continue;
    let ss = 0, qq = 0, uu = 0, ii = 0;
    for (const rep of reps) { const x = m.get(rep), cr = credit(rep); ss += cr ? x.succ1 : x.succ0; qq += cr ? x.wrong1 : x.wrong0; uu += x.cost; ii += x.imputed; rawImp += x.imputed; rawUsd += x.cost; }
    s += ss / reps.length; q += qq / reps.length; usd += uu / reps.length; imp += ii / reps.length; w += 1;
  }
  if (!w) return null;
  return { s: s / w, q: q / w, c: usd / w, B: 0, imputedShare: rawImp / (rawUsd || 1), n: w, lineages: 0, cImp: imp / w, BImp: 0 };
}

/** The share of a mode's per-task dollars (c + B/N) that is imputed, at a cell (the imputed-dollar rule, DESIGN §2). */
export const imputedShareAt = (st, cell) => { const tot = st.c + st.B / cell.N; return tot > 0 ? ((st.cImp ?? 0) + (st.BImp ?? 0) / cell.N) / tot : 0; };

/** First-pass shortfall of one (job, mode): null when complete, else the reason (PREREG §5 missing data). */
export function firstPassShort(table, job, mode, firstPass = FIRST_PASS) {
  const k = firstPass?.[mode];
  if (!k || !table.has(job, mode)) return null;
  const c = table.cell(job, mode);
  if (c.lineage) return c.lineageList.length < k ? `${c.lineageList.length} of ${k} first-pass lineages` : null;
  const few = table.taskIds(job).filter(t => (c.reps.get(t)?.length ?? 0) < k);
  return few.length ? `${few.length} task(s) with fewer than ${k} first-pass draws` : null;
}

/** u = s − c/V − B/(N·V) − (W/V)·q − r/(N·V), success-equivalents per task. */
export function needUtility(st, cell, routingUsd = 0) {
  return st.s - st.c / cell.V - st.B / (cell.N * cell.V) - cell.wOverV * st.q - routingUsd / (cell.N * cell.V);
}
/** Dollars per task with the build amortised over N (the tie-break: ties go to the cheaper mode). */
export const perTaskUsd = (st, cell) => st.c + st.B / cell.N;

/** Highest utility; exact ties (1e-12) go to the cheaper mode, then to the earlier mode. entries: [{mode, u, usd}]. */
export function bestOf(entries, tol = 1e-12) {
  let b = null;
  for (const e of entries) if (!b || e.u > b.u + tol || (Math.abs(e.u - b.u) <= tol && e.usd < b.usd - 1e-15)) b = e;
  return b;
}
/** Modes ranked best first, with the same tie rule. */
export const rankModes = entries => [...entries].sort((a, b) => (Math.abs(a.u - b.u) > 1e-12 ? b.u - a.u : a.usd - b.usd)).map(e => e.mode);

/**
 * One hierarchical bootstrap draw of a job: tasks resampled once (shared by every mode: the runs are paired), then
 * per mode its lineages (shared by every task: a lineage is one build) or each task's replicates. Returns
 * mode -> stats, resampled lazily and cached so every mode of the draw shares the task resample.
 */
export function drawView(table, job, rand) {
  const ids = table.taskIds(job);
  const tasks = ids.map(() => ids[Math.floor(rand() * ids.length)]);
  const cache = new Map();
  return mode => {
    if (cache.has(mode)) return cache.get(mode);
    const c = table.cell(job, mode);
    const st = c.lineage
      ? cellStats(table, job, mode, { tasks, lineages: c.lineageList.map(() => c.lineageList[Math.floor(rand() * c.lineageList.length)].rep) })
      : cellStats(table, job, mode, { tasks, repsOf: t => { const r = c.reps.get(t); return r.length === 1 ? r : r.map(() => r[Math.floor(rand() * r.length)]); } });
    cache.set(mode, st);
    return st;
  };
}

// Task halves by seed parity (even seeds select), or by sorted position when seeds are missing or one-sided.
function evenHalf(table, job) {
  const ids = table.taskIds(job), seeds = ids.map(t => table.seedOf(job, t));
  const bySeed = seeds.every(s => s !== null) ? new Set(ids.filter((t, i) => seeds[i] % 2 === 0)) : null;
  return bySeed && bySeed.size && bySeed.size < ids.length ? bySeed : new Set(ids.filter((_, i) => i % 2 === 0));
}

// A mode's cross-fit folds: [{ sel, ev }] selections for cellStats. Lineage modes with K >= 2 rotate (select on the
// other lineages, score on one). Draw modes select on replicate 1 (every other replicate) and score on replicate 2;
// a task with one replicate selects when its seed is even and scores when it is odd. A one-lineage mode uses task
// halves. 'two-way' adds the swapped direction wherever the primary has one direction.
function foldsOf(table, job, mode, scheme) {
  const c = table.cell(job, mode), ids = table.taskIds(job), even = evenHalf(table, job);
  if (c.lineage && c.lineageList.length >= 2) {
    const L = c.lineageList.map(l => l.rep);
    return L.map((l, j) => ({ sel: { tasks: ids, lineages: L.filter((_, i) => i !== j) }, ev: { tasks: ids, lineages: [l] } }));
  }
  let a;
  if (c.lineage) {
    const L = [c.lineageList[0].rep];
    a = { sel: { tasks: ids.filter(t => even.has(t)), lineages: L }, ev: { tasks: ids.filter(t => !even.has(t)), lineages: L } };
  } else {
    const pick = (t, first) => { const r = c.reps.get(t); return r.length >= 2 ? r.filter((_, i) => i % 2 === (first ? 0 : 1)) : (even.has(t) === first ? r : []); };
    a = { sel: { tasks: ids, repsOf: t => pick(t, true) }, ev: { tasks: ids, repsOf: t => pick(t, false) } };
  }
  return scheme === 'two-way' ? [a, { sel: a.ev, ev: a.sel }] : [a];
}

/**
 * Cross-fitted VBS* of one job (Cameron, Hoos and Leyton-Brown 2016): in each fold choose the argmax mode on the
 * selection data and score it on independent data; VBS* is the mean over folds (the lcm of the modes' fold counts, so
 * every mode cycles through its folds evenly). Returns cellKey -> { vbsStar, folds: [{select, score}] }.
 */
export function crossFitJob(table, job, modes, cells, { scheme = 'primary' } = {}) {
  if (scheme !== 'primary' && scheme !== 'two-way') throw new Error(`cross-fit scheme must be primary or two-way, got ${scheme}`);
  const F = modes.map(m => foldsOf(table, job, m, scheme));
  const nF = F.reduce((a, f) => (a * f.length) / gcd(a, f.length), 1);
  const out = new Map(cells.map(c => [c.key, { vbsStar: 0, folds: [] }]));
  for (let f = 0; f < nF; f++) {
    const sel = modes.map((m, i) => cellStats(table, job, m, F[i][f % F[i].length].sel));
    const ev = modes.map((m, i) => cellStats(table, job, m, F[i][f % F[i].length].ev));
    for (const c of cells) {
      const a = bestOf(modes.map((m, i) => sel[i] && { mode: m, u: needUtility(sel[i], c), usd: perTaskUsd(sel[i], c), i }).filter(Boolean));
      if (!a || !ev[a.i]) throw new Error(`cross-fit: ${job} has no evaluation data for ${a?.mode ?? 'any mode'} in fold ${f}`);
      const o = out.get(c.key), sc = needUtility(ev[a.i], c);
      o.vbsStar += sc / nF; o.folds.push({ select: a.mode, score: sc });
    }
  }
  return out;
}

/**
 * Labels for every job and cell: per-mode utility, the acceptable set A = {m : u_m >= u_max − δ}, the NEED label
 * (`workflow` / `no-workflow` when every member of A is in one class, else `either`), the three-way kind of A, VBS and
 * cross-fitted VBS*, and the confidence P(best class) from a seeded hierarchical bootstrap (task -> replicate or
 * lineage; the cluster level enters in clusterBootstrapDelta). Confident = a binary label whose class wins >= 0.8 of the
 * draws, at a (job, cell) that is not unlabelled (the imputed-dollar and re-pricing rule, per cell: see pointEntry).
 * reps = 0 skips the bootstrap (nothing confident). `modes` restricts the label set (labelSetModes).
 */
export function needLabels(table, { cells = GRID, reps = 2000, seed = 1, delta = DELTA, confident = CONFIDENT, imputedLimit = IMPUTED_LIMIT, modes = null, crossFit = 'primary' } = {}) {
  const per = new Map(), reg = table.registry;
  for (const job of table.jobs) {
    const ms = table.modesOf(job).filter(m => !modes || modes.includes(m));
    if (!ms.length) throw new Error(`job ${job} has no mode in the label set`);
    const st = new Map(ms.map(m => [m, cellStats(table, job, m)]));
    const over = ms.filter(m => st.get(m).imputedShare > imputedLimit);       // job level, reported; the rule itself is per cell
    const notRep = ms.filter(m => (table.cell(job, m).notRepriced ?? 0) > 0);
    const vx = crossFitJob(table, job, ms, cells, { scheme: crossFit });
    const counts = cells.map(() => ({ workflow: 0, 'no-workflow': 0 }));
    if (reps > 0) {
      const rand = rng(hashString(`${seed}|${job}`));
      for (let b = 0; b < reps; b++) {
        const view = drawView(table, job, rand), bs = ms.map(m => view(m));
        cells.forEach((c, i) => { counts[i][classOf(bestOf(ms.map((m, j) => ({ mode: m, u: needUtility(bs[j], c), usd: perTaskUsd(bs[j], c) }))).mode, reg)] += 1; });
      }
    }
    const byCell = new Map();
    cells.forEach((c, i) => {
      const pBest = reps > 0 ? { workflow: counts[i].workflow / reps, 'no-workflow': counts[i]['no-workflow'] / reps } : null;
      const e = pointEntry(ms, st, c, notRep);
      byCell.set(c.key, { ...e, pBest, confident: !e.unlabelled && e.label !== 'either' && pBest !== null && pBest[e.label] >= confident,
        vbsStar: vx.get(c.key).vbsStar, folds: vx.get(c.key).folds });
    });
    per.set(job, { modes: ms, stats: st, over, notRepriced: notRep, cells: byCell, offGrid: new Map() });
  }
  // A cell's point entry: utilities, acceptable set, NEED label, VBS. Off the label grid it carries no confidence and no VBS*.
  // Unlabelled (DESIGN §2, one cost meter), per (job, cell):
  //  - a mode whose per-task dollars at this cell (c + B/N) are more than `imputedLimit` imputed, and whose utility with
  //    those imputed dollars removed (imputed dollars are bounds, so the true cost lies between) could reach the acceptable
  //    set: the label could rest on imputed dollars. A mode over the limit that stays out of reach either way cannot
  //    change the label and does not unlabel it;
  //  - any mode with a row that label-run could not re-price (`repriced: false`): its dollars are off the one meter, in
  //    either direction, so every cell of the job is unlabelled.
  function pointEntry(ms, st, c, notRep) {
    const entries = ms.map(m => ({ mode: m, u: needUtility(st.get(m), c), usd: perTaskUsd(st.get(m), c) }));
    const top = bestOf(entries);
    const acceptable = rankModes(entries.filter(e => e.u >= top.u - delta - 1e-12));
    const classes = new Set(acceptable.map(m => classOf(m, reg))), kinds = new Set(acceptable.map(m => modeInfo(m, reg).kind));
    const label = classes.size === 1 ? [...classes][0] : 'either';
    const imputedOver = ms.filter(m => {
      const x = st.get(m);
      return imputedShareAt(x, c) > imputedLimit && needUtility(x, c) + ((x.cImp ?? 0) + (x.BImp ?? 0) / c.N) / c.V >= top.u - delta - 1e-12;
    });
    const why = [...(imputedOver.length ? [`imputed dollars over ${imputedLimit} in ${imputedOver.join(', ')}`] : []), ...(notRep.length ? [`rows not re-priced in ${notRep.join(', ')}`] : [])];
    return { cell: c, u: new Map(entries.map(e => [e.mode, e.u])), usd: new Map(entries.map(e => [e.mode, e.usd])), top: top.mode, acceptable, label,
      kind: kinds.size === 1 ? [...kinds][0] : 'mixed', pBest: null, confident: false, vbs: top.u, vbsMode: top.mode, vbsStar: null, folds: null,
      unlabelled: why.length ? why.join('; ') : null, imputedOver };
  }
  const pointOf = (job, cell, mode, k, f) => {
    const p = per.get(job); if (!p) throw new Error(`no labels for job ${job}`);
    const e = p.cells.get(cellKey(cell)), v = e ? e[k].get(mode) : p.stats.has(mode) ? f(p.stats.get(mode), cell) : undefined;
    if (v === undefined) throw new Error(`mode ${mode} not labelled for ${job}`);
    return v;
  };
  const at = (job, cell) => {
    const p = per.get(job); if (!p) throw new Error(`no labels for job ${job}`);
    const k = cellKey(cell), e = p.cells.get(k);
    if (e) return e;
    if (!p.offGrid.has(k)) p.offGrid.set(k, { ...pointEntry(p.modes, p.stats, cell.key ? cell : makeCell(cell.V, cell.N, cell.wOverV ?? 1), p.notRepriced), offGrid: true });
    return p.offGrid.get(k);
  };
  return {
    table, cells, delta, jobs: table.jobs, at,
    modesOf: job => per.get(job).modes,
    stats: (job, mode) => per.get(job).stats.get(mode),
    // Utility and $ per task at any cell: precomputed on the grid, else from the point statistics (no labels there).
    u: (job, cell, mode) => pointOf(job, cell, mode, 'u', needUtility),
    usd: (job, cell, mode) => pointOf(job, cell, mode, 'usd', perTaskUsd),
  };
}

/** Fixed modes ranked by mean utility over `jobs` at a cell (ties to the cheaper); only modes present in every job. */
export function sbsRanking(labels, jobs, cell, { modes = null } = {}) {
  if (!jobs.length) throw new Error('sbsRanking needs at least one job');
  const ms = (modes ?? labels.modesOf(jobs[0])).filter(m => jobs.every(j => labels.modesOf(j).includes(m)));
  if (!ms.length) throw new Error('no mode is present in every job');
  return rankModes(ms.map(m => ({ mode: m, u: mean(jobs.map(j => labels.u(j, cell, m))), usd: mean(jobs.map(j => labels.usd(j, cell, m))) })));
}
/** SBS per cell: the single best fixed mode on `jobs` (TRAIN, non-forced) for that cell. */
export const sbsPerCell = (labels, jobs, cell, opts) => sbsRanking(labels, jobs, cell, opts)[0];
/** The cells SBS-global is chosen over: the V x N slider grid at W = V. */
export const SLIDER_CELLS = Object.freeze(GRID.filter(c => c.wOverV === 1));
/** SBS-global: one fixed mode for every cell, the best mean over `cells` of the mean utility on `jobs`. */
export function sbsGlobal(labels, jobs, cells = SLIDER_CELLS, opts = {}) {
  const ms = (opts.modes ?? labels.modesOf(jobs[0])).filter(m => jobs.every(j => labels.modesOf(j).includes(m)));
  return rankModes(ms.map(m => ({ mode: m, u: mean(cells.map(c => mean(jobs.map(j => labels.u(j, c, m))))), usd: mean(cells.map(c => mean(jobs.map(j => labels.usd(j, c, m))))) })))[0];
}

/** Coverage at a cell: the share of jobs with a confident label, with the other outcomes counted. */
export function coverage(labels, jobs, cell) {
  const out = { n: jobs.length, confident: 0, either: 0, unconfident: 0, unlabelled: 0 };
  for (const j of jobs) {
    const e = labels.at(j, cell);
    if (e.unlabelled) out.unlabelled += 1; else if (e.confident) out.confident += 1; else if (e.label === 'either') out.either += 1; else out.unconfident += 1;
  }
  return { ...out, coverage: jobs.length ? out.confident / jobs.length : null };
}

/**
 * Fragility (DESIGN §2): labels recomputed with each oracle tolerance halved and doubled. A row's pass at a factor is
 * `passAt[factor]` when label-run recorded it (the bed oracle at that tolerance), else, for a job whose tolerance spec
 * is { scoreThreshold } (pass = score >= threshold), score >= 1 − (1 − threshold)·factor. Jobs whose NEED label flips
 * at any factor and cell are fragile: excluded from need accuracy, kept in utility. A delivered row of a job with a tolerance
 * spec but neither passAt nor a score keeps its nominal verdict and is reported (`unscored`, `untested` jobs). $0.
 */
export function fragility(rows, builds, { tolerance = () => null, cells = [HEADLINE], factors = [0.5, 2], modes = null, makeTable = needTable, tableOpts = {} } = {}) {
  // A delivered row of a job with a tolerance spec, with neither passAt[factor] nor a numeric score, cannot be recomputed:
  // it keeps its nominal verdict and is listed (`unscored`), so a job that was never really tested is never passed silently.
  const unscored = [];
  const passAt = (r, f) => {
    if (r.passAt && typeof r.passAt[String(f)] === 'boolean') return r.passAt[String(f)];
    const spec = tolerance(r.job);
    if (spec?.scoreThreshold != null && typeof r.score === 'number') return r.delivered === true && r.score >= 1 - (1 - spec.scoreThreshold) * f;
    if (spec?.scoreThreshold != null && r.delivered === true) unscored.push({ job: r.job, mode: r.mode ?? r.arm, task: r.task ?? r.taskKey, rep: r.rep ?? r.replicate ?? r.lineage ?? r.trial ?? 0, factor: f });
    return r.pass;
  };
  const lab = rs => needLabels(makeTable(rs, builds, tableOpts), { cells, reps: 0, modes });
  const nominal = lab(rows);
  const variants = factors.map(f => [f, lab(rows.map(r => ({ ...r, pass: passAt(r, f) })))]);
  const unscoredBy = new Map();
  for (const u of unscored) if (u.factor === factors[0]) unscoredBy.set(u.job, (unscoredBy.get(u.job) ?? 0) + 1);
  const jobs = nominal.jobs.map(job => {
    const byCell = cells.map(c => ({ cell: c.key, nominal: nominal.at(job, c).label, at: Object.fromEntries(variants.map(([f, L]) => [f, L.at(job, c).label])) }));
    return { job, cells: byCell, fragile: byCell.some(x => Object.values(x.at).some(l => l !== x.nominal)), unscored: unscoredBy.get(job) ?? 0 };
  });
  return { factors, jobs, fragile: jobs.filter(j => j.fragile).map(j => j.job), untested: jobs.filter(j => j.unscored > 0).map(j => j.job),
    unscored: unscored.filter(u => u.factor === factors[0]).map(({ factor, ...u }) => u) };
}

/**
 * Self-test of built and guided workflows (DESIGN §2): per lineage, false-pass = P(self-check pass | oracle fail) and
 * false-fail = P(self-check fail | oracle pass) among delivered answers that carry a self verdict; pooled per mode too.
 * F11 trips when there are >= `minFailures` oracle failures and the false-pass rate exceeds `maxFalsePass`.
 */
export function selfTestRates(table, { minFailures = 10, maxFalsePass = 0.2 } = {}) {
  const lineages = [], pooled = new Map();
  for (const job of table.jobs) for (const mode of table.modesOf(job)) {
    if (modeInfo(mode, table.registry).cascade) continue;
    const c = table.cell(job, mode), by = new Map();
    for (const reps of c.byTask.values()) for (const x of reps.values()) {
      if (!x.delivered || x.selfVerdict === null) continue;
      const k = c.lineage ? x.rep : 'draws', a = by.get(k) ?? { oracleFail: 0, falsePass: 0, oraclePass: 0, falseFail: 0 };
      if (x.pass) { a.oraclePass += 1; if (x.selfVerdict === 'fail') a.falseFail += 1; } else { a.oracleFail += 1; if (x.selfVerdict === 'pass') a.falsePass += 1; }
      by.set(k, a);
    }
    for (const [rep, a] of by) {
      lineages.push({ job, mode, rep, ...a, falsePassRate: a.oracleFail ? a.falsePass / a.oracleFail : null, falseFailRate: a.oraclePass ? a.falseFail / a.oraclePass : null,
        f11: a.oracleFail >= minFailures && a.falsePass / a.oracleFail > maxFalsePass });
      const p = pooled.get(mode) ?? { mode, oracleFail: 0, falsePass: 0, oraclePass: 0, falseFail: 0, lineages: 0 };
      for (const k of ['oracleFail', 'falsePass', 'oraclePass', 'falseFail']) p[k] += a[k];
      p.lineages += 1; pooled.set(mode, p);
    }
  }
  const modes = [...pooled.values()].map(p => ({ ...p, falsePassRate: p.oracleFail ? p.falsePass / p.oracleFail : null, falseFailRate: p.oraclePass ? p.falseFail / p.oraclePass : null,
    f11: p.oracleFail >= minFailures && p.falsePass / p.oracleFail > maxFalsePass }));
  return { lineages, modes, f11: modes.filter(m => m.f11).map(m => m.mode), f11Lineages: lineages.filter(l => l.f11) };
}

/** Environment-fault share per (job, mode) over its rows; over ENV_FAULT_LIMIT the arm is invalid (DESIGN §2, K4). */
export function envFaults(table, { limit = ENV_FAULT_LIMIT, codes = ENV_FAULT_CODES } = {}) {
  const out = [];
  for (const job of table.jobs) for (const mode of table.modesOf(job)) {
    if (modeInfo(mode, table.registry).cascade) continue;
    let n = 0, f = 0;
    for (const reps of table.cell(job, mode).byTask.values()) for (const x of reps.values()) { if (x.synthetic) continue; n += 1; if (codes.includes(x.error)) f += 1; }
    out.push({ job, mode, rows: n, faulted: f, share: n ? f / n : 0, invalid: n > 0 && f / n > limit });
  }
  return out;
}

/**
 * Exact one-sided sign-flip permutation test over cluster-level differences d (statistic: the mean), with bounds by
 * test inversion. Under H0 (Δ = θ, symmetric) every sign pattern of d − θ is equally likely, and a pattern flipping
 * the set F scores at least the observed mean iff mean_F(d) <= θ, so
 *   p(θ) = (1 + #{F ≠ ∅ : mean_F(d) <= θ}) / 2^n           (H1: Δ > θ; `p`)
 * The one-sided lower bound at level 1 − α is the (K+1)-th smallest subset mean, K = floor(α·2^n − 1) (−∞ when K < 0,
 * e.g. n = 5 at α = 0.025: 1/32 > 0.025, so no reading can exclude 0); the upper bound mirrors it. lo > 0 iff p(0) <= α.
 * Exact for n <= exactMax (2^n subsets); a seeded Monte Carlo over sign patterns above.
 */
export function signFlipTest(d, { theta = 0, alpha = 0.05, exactMax = 20, draws = 200000, seed = 29, eps = 1e-12 } = {}) {
  const n = d.length;
  if (!n) return { n, mean: null, p: 1, pLess: 1, lo: -Infinity, hi: Infinity, alpha, exact: true, minP: 1 };
  if (!d.every(Number.isFinite)) throw new Error('signFlipTest needs finite differences');
  const m0 = mean(d);
  let means, total;
  if (n <= exactMax) {
    total = 2 ** n;
    const sums = new Float64Array(total), sizes = new Uint8Array(total);
    means = new Float64Array(total - 1);
    for (let mask = 1; mask < total; mask++) {
      const low = mask & -mask, i = 31 - Math.clz32(low);
      sums[mask] = sums[mask ^ low] + d[i]; sizes[mask] = sizes[mask ^ low] + 1;
      means[mask - 1] = sums[mask] / sizes[mask];
    }
  } else {
    const r = rng(seed), xs = [];
    for (let k = 0; k < draws; k++) { let s = 0, z = 0; for (let i = 0; i < n; i++) if (r() < 0.5) { s += d[i]; z += 1; } if (z) xs.push(s / z); }
    means = Float64Array.from(xs); total = draws + 1;
  }
  means.sort();
  const countLE = x => { let lo = 0, hi = means.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (means[mid] <= x + eps) lo = mid + 1; else hi = mid; } return lo; };
  const countGE = x => { let lo = 0, hi = means.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (means[mid] < x - eps) lo = mid + 1; else hi = mid; } return means.length - lo; };
  const K = Math.floor(alpha * total - 1 + 1e-9);
  return {
    n, mean: m0, alpha, exact: n <= exactMax, minP: 1 / total,
    p: Math.min(1, (1 + countLE(theta)) / total), pLess: Math.min(1, (1 + countGE(theta)) / total),
    lo: K < 0 ? -Infinity : means[Math.min(K, means.length - 1)], hi: K < 0 ? Infinity : means[Math.max(0, means.length - 1 - K)],
  };
}

/**
 * Seeded hierarchical cluster bootstrap of Δ = mean over clusters of mean over their jobs of (u_a − u_b) at a cell
 * (cluster -> task -> replicate or lineage; the a and b modes of a job share its task draw). items: [{ job, cluster, a,
 * b, routingUsd? }] (routing dollars are charged to a). The sensitivity beside the exact sign-flip test (DESIGN §5).
 */
export function clusterBootstrapDelta(table, items, cell, { reps = 10000, seed = 5, alpha = 0.05 } = {}) {
  const clusters = [...new Set(items.map(x => x.cluster))];
  if (!clusters.length) return { lo: null, hi: null, reps: 0, seed };
  const by = new Map(clusters.map(c => [c, items.filter(x => x.cluster === c)]));
  const r = rng(seed), out = new Float64Array(reps);
  for (let b = 0; b < reps; b++) {
    let tot = 0;
    for (let k = 0; k < clusters.length; k++) {
      const js = by.get(clusters[Math.floor(r() * clusters.length)]);
      let s = 0;
      for (const x of js) { const v = drawView(table, x.job, r); s += needUtility(v(x.a), cell, x.routingUsd ?? 0) - needUtility(v(x.b), cell); }
      tot += s / js.length;
    }
    out[b] = tot / clusters.length;
  }
  out.sort();
  const q = p => out[Math.min(reps - 1, Math.max(0, Math.floor(p * reps)))];
  return { lo: q(alpha / 2), hi: q(1 - alpha / 2), reps, seed };
}
