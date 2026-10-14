// Need router v0 (claim C7): pick an execution mode for a task family before execution, from what is known then, at
// the owner's slider V ($ per verified success) and the declared horizon H (tasks the family will see). $0, no model
// calls. The decision is expected utility (metrics.mjs): argmax_m H * (V * p̂(m) - ĉ(m)) - F̂(m), where p̂, ĉ, F̂ are
// predicted per mode. Hard requirements (durable waits, approvals, effects that need compensation) are rules that remove
// modes before the utility is compared; they are never learned.
//
// Predictors here learn only from TRAINING families' labels and the evaluation family's pre-execution features:
//   priorPredictor   every family gets the pooled training rates per mode (a feature-blind baseline)
//   knnPredictor     the k nearest training families by standardized feature distance, with Beta(1,1)-shrunk rates
// Evaluation with few families is leave-one-family-out (lofo): the router for family f is trained on every other family,
// and the fixed-mode baseline (SBS) is chosen on those same training families, so no number is in-sample.
import { labelTable, utilities, score, singleBest } from './metrics.mjs';

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
