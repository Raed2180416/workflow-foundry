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
// every interval. Seeded, so results are reproducible.

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
export function bootstrap(table, choose, V, { reps = 2000, seed = 1, alpha = 0.05, horizon = null, sbsMode = null, routingCostUsd, families = table.families, tieUsd = 0 } = {}) {
  const r = rng(seed);
  const pick = arr => arr[Math.floor(r() * arr.length)];
  const point = score(utilities(table, V, { horizon, families }), choose, V, { sbsMode, routingCostUsd, tieUsd });
  const stats = { regret: [], closedGap: [], accuracy: [], router: [], vbs: [], sbs: [] };
  for (let i = 0; i < reps; i++) {
    const fams = families.map(() => pick(families));
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
