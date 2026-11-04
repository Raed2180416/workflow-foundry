// The information-path budget (research/blockers-20261021/ATTACK.md §3 RC2, §6 Move 6; decision D28): a reader, fork,
// judge or check enters a decision only with its measured agreement against the signals already in it, and one whose
// errors agree with an existing signal's beyond KAPPA_MAX (0.4) is refused as a purchase of variance. n_eff is reported
// beside every aggregate. Pure functions; no I/O; generic (no task, grader or benchmark names).
//
//   cohenKappa(a, b)              agreement of two binary vectors beyond chance (null when undefined)
//   errorsOf(v, y)                1 where a verdict disagrees with the label
//   pairStats(a, b, {y, clusters}) verdict κ, error κ, φ, both-wrong vs both-wrong-if-independent, task-cluster bootstrap CI
//   neffOfSet(vectors)            Kish-style n_eff = k / (1 + (k − 1) ρ̄) from the mean pairwise φ of the vectors
//   admitSignal(cand, existing, {on})  'admit' | 'refuse' | 'provisional' | 'unmeasured' with the reason; `on` names the
//                                 metric and is REQUIRED ('verdicts' = ATTACK's κ; 'errors' = agreement of mistakes)
//   admissionWalk(order, signals, {on, rule})  the rule applied in a purchase order: self-reports and uninformative
//                                 signals are excluded by rule; 'point' admits on the point κ (ATTACK's literal rule, the
//                                 bound reported as `fragile`), 'bound' only when the bootstrap upper bound is under the bar
//   budgetPaths(cands, opts)      greedy information-path budget: admit signals in order of value per dollar (order
//                                 'ratio') or of value (order 'value') while every admitted pair stays under KAPPA_MAX, up
//                                 to a dollar budget; an unpriced signal (costUsd null) is not bought; returns the set and
//                                 its n_eff
//
// v2 (review, 2026-11-04): the metric is explicit. ATTACK's 0.4 bar sits between VERDICT κ values (RL2-judge 0.35, judge-
// judge 0.61-0.70: VERIFIER-LAB §1.2); v1 applied it to ERROR κ by default, where it admitted a judge ATTACK's rule refuses
// (Haiku-Mercury verdict κ 0.46, error κ 0.38). Error κ is the better redundancy measure (two accurate verifiers with
// independent mistakes have a high verdict κ: the test shows it), but a bar calibrated on one metric is not moved to the
// other silently: callers name the metric, and the decision of record follows ATTACK (verdicts) until the owner re-anchors
// the bar on errors. v1's walk also admitted 'provisional' signals, the actor's self-report and a near-constant judge.
export const INFOPATH_VERSION = 'infopath-v2';
export const INFORMATIVE = Object.freeze({ minAcceptRate: 0.05, maxAcceptRate: 0.95, minValue: 0.02 });
export const KAPPA_MAX = 0.4;
export const MIN_ITEMS = 30;

const need = (c, m) => { if (!c) throw new Error(`infopath: ${m}`); };
const bin = v => v.map(x => (x === true || x === 1 ? 1 : x === false || x === 0 ? 0 : null));

/** Cohen's κ of two 0/1 vectors over the items where both are defined. */
export function cohenKappa(a, b) {
  need(a.length === b.length, 'cohenKappa: vectors must have equal length');
  const A = bin(a), B = bin(b);
  let n = 0, n11 = 0, n10 = 0, n01 = 0, n00 = 0;
  for (let i = 0; i < A.length; i++) {
    if (A[i] === null || B[i] === null) continue;
    n++;
    if (A[i] && B[i]) n11++; else if (A[i]) n10++; else if (B[i]) n01++; else n00++;
  }
  if (!n) return { kappa: null, n: 0 };
  const po = (n11 + n00) / n, pa = (n11 + n10) / n, pb = (n11 + n01) / n;
  const pe = pa * pb + (1 - pa) * (1 - pb);
  const kappa = pe >= 1 - 1e-12 ? null : (po - pe) / (1 - pe);
  const den = Math.sqrt(pa * (1 - pa) * pb * (1 - pb));
  const phi = den > 0 ? (n11 / n - pa * pb) / den : null;
  return { kappa, phi, n, po, pe, pa, pb, both: n11 / n, bothIfIndependent: pa * pb };
}

export const errorsOf = (v, y) => bin(v).map((x, i) => (x === null || y[i] === null || y[i] === undefined ? null : Number(x !== (y[i] ? 1 : 0))));

/** Deterministic PRNG (mulberry32) for bootstrap resampling. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Percentile bootstrap over clusters (resample whole clusters with replacement). stat(indexList) -> number | null. */
export function clusterBootstrap(clusters, stat, { B = 1000, seed = 7, level = 0.95 } = {}) {
  const ids = [...new Set(clusters)];
  const members = new Map(ids.map(c => [c, []]));
  clusters.forEach((c, i) => members.get(c).push(i));
  const r = rng(seed), vals = [];
  for (let b = 0; b < B; b++) {
    const idx = [];
    for (let k = 0; k < ids.length; k++) idx.push(...members.get(ids[Math.floor(r() * ids.length)]));
    const v = stat(idx);
    if (v !== null && Number.isFinite(v)) vals.push(v);
  }
  if (!vals.length) return { lo: null, hi: null, B: 0 };
  vals.sort((x, y) => x - y);
  const q = p => vals[Math.min(vals.length - 1, Math.max(0, Math.floor(p * (vals.length - 1))))];
  return { lo: q((1 - level) / 2), hi: q(1 - (1 - level) / 2), B: vals.length };
}

/**
 * Agreement of two signals: verdict κ, error κ against the label y (when given), φ of errors, the both-wrong rate against
 * its value under independence, with task-cluster bootstrap intervals when clusters are given.
 */
export function pairStats(a, b, { y = null, clusters = null, B = 1000, seed = 7 } = {}) {
  const verdict = cohenKappa(a, b);
  const out = { n: verdict.n, verdictKappa: verdict.kappa, verdictPhi: verdict.phi };
  const pick = (v, idx) => idx.map(i => v[i]);
  if (y) {
    const ea = errorsOf(a, y), eb = errorsOf(b, y);
    const e = cohenKappa(ea, eb);
    Object.assign(out, { errorKappa: e.kappa, errorPhi: e.phi, bothWrong: e.both, bothWrongIfIndependent: e.bothIfIndependent, errA: e.pa, errB: e.pb });
    if (clusters) out.errorKappaCI = clusterBootstrap(clusters, idx => cohenKappa(pick(ea, idx), pick(eb, idx)).kappa, { B, seed });
  }
  if (clusters) out.verdictKappaCI = clusterBootstrap(clusters, idx => cohenKappa(pick(a, idx), pick(b, idx)).kappa, { B, seed: seed + 1 });
  return out;
}

/** n_eff of k signals from their mean pairwise φ (ρ̄ floored at 0): k / (1 + (k − 1) ρ̄). */
export function neffOfSet(vectors) {
  const k = vectors.length;
  need(k >= 1, 'neffOfSet: at least one vector');
  if (k === 1) return { k, rhoBar: null, nEff: 1 };
  const phis = [];
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) { const p = cohenKappa(vectors[i], vectors[j]).phi; if (p !== null) phis.push(p); }
  const rhoBar = phis.length ? Math.max(0, phis.reduce((s, x) => s + x, 0) / phis.length) : 0;
  return { k, rhoBar, nEff: k / (1 + (k - 1) * rhoBar), pairs: phis.length };
}

/**
 * Admission of a candidate signal into a decision that already uses `existing` signals: [{ name, verdicts }].
 * Decision on the error κ against the label (on: 'errors', default) or on verdict κ (on: 'verdicts', for forks whose
 * outcome is the label itself). refuse: the point κ with some existing signal exceeds kappaMax; admit: below it and
 * the bootstrap upper bound also below (when clusters are given); provisional: below at the point, above at the bound;
 * unmeasured: fewer than minItems paired items.
 */
export function admitSignal(cand, existing, { y = null, clusters = null, kappaMax = KAPPA_MAX, minItems = MIN_ITEMS, on, B = 500 } = {}) {
  need(on === 'verdicts' || on === 'errors', `admitSignal: name the metric (on: 'verdicts' | 'errors'), got ${on}`);
  need(on === 'verdicts' || y, 'admitSignal: error agreement needs labels y');
  const rows = existing.map(s => {
    const st = pairStats(cand.verdicts, s.verdicts, { y: on === 'errors' ? y : null, clusters, B });
    const k = on === 'errors' ? st.errorKappa : st.verdictKappa;
    const ci = on === 'errors' ? st.errorKappaCI : st.verdictKappaCI;
    return { with: s.name, n: st.n, kappa: k, hi: ci?.hi ?? null, lo: ci?.lo ?? null };
  });
  if (!rows.length) return { name: cand.name, decision: 'admit', reason: 'first signal', rows };
  if (rows.some(r => r.n < minItems)) return { name: cand.name, decision: 'unmeasured', reason: `fewer than ${minItems} paired items`, rows };
  const worst = rows.reduce((m, r) => ((r.kappa ?? -1) > (m.kappa ?? -1) ? r : m), rows[0]);
  if ((worst.kappa ?? 0) > kappaMax) return { name: cand.name, decision: 'refuse', reason: `${on} κ ${worst.kappa.toFixed(2)} with ${worst.with} > ${kappaMax}`, rows };
  if (worst.hi !== null && worst.hi > kappaMax) return { name: cand.name, decision: 'provisional', reason: `${on} κ ${worst.kappa?.toFixed(2)} with ${worst.with}, upper bound ${worst.hi.toFixed(2)} > ${kappaMax}`, rows };
  return { name: cand.name, decision: 'admit', reason: `max ${on} κ ${worst.kappa?.toFixed(2)} (${worst.with}) <= ${kappaMax}`, rows };
}

/**
 * Greedy information-path budget. cands: [{ name, verdicts, costUsd, value }] (value: e.g. balanced accuracy or AUROC
 * minus 0.5; costUsd per decision). Admits in order of value per dollar (free signals first, by value), skipping any whose
 * error κ with an admitted one exceeds kappaMax, until budgetUsd is spent. Returns { chosen, refused, costUsd, nEff }.
 */
export function budgetPaths(cands, { y, clusters = null, kappaMax = KAPPA_MAX, budgetUsd = Infinity, minItems = MIN_ITEMS, order: by = 'ratio', on } = {}) {
  need(by === 'ratio' || by === 'value', `budgetPaths: order must be 'ratio' or 'value', got ${by}`);
  need(on === 'verdicts' || on === 'errors', `budgetPaths: name the metric (on: 'verdicts' | 'errors'), got ${on}`);
  const unpriced = cands.filter(c => c.costUsd === null || c.costUsd === undefined || !Number.isFinite(c.costUsd));
  cands = cands.filter(c => !unpriced.includes(c));
  const order = [...cands].sort((p, q) => {
    if (by === 'value') return q.value - p.value || p.costUsd - q.costUsd;
    const vp = p.costUsd > 0 ? p.value / p.costUsd : Infinity, vq = q.costUsd > 0 ? q.value / q.costUsd : Infinity;
    return vp === vq ? q.value - p.value : vq - vp;
  });
  const chosen = [], refused = unpriced.map(c => ({ name: c.name, reason: 'unpriced (no price on record): not bought' }));
  let cost = 0;
  for (const c of order) {
    if (c.value <= 0) { refused.push({ name: c.name, reason: 'no value over chance' }); continue; }
    if (cost + c.costUsd > budgetUsd + 1e-12) { refused.push({ name: c.name, reason: 'over budget' }); continue; }
    const adm = admitSignal(c, chosen, { y, clusters, kappaMax, minItems, B: 200, on });
    if (adm.decision === 'refuse' || adm.decision === 'unmeasured') { refused.push({ name: c.name, reason: adm.reason }); continue; }
    chosen.push(c); cost += c.costUsd;
  }
  const errs = chosen.map(c => errorsOf(c.verdicts, y));
  return { chosen: chosen.map(c => c.name), refused, costUsd: cost, nEff: chosen.length ? neffOfSet(errs).nEff : 0, kappaMax, on };
}

/** Is a signal informative enough to be bought at all: accept rate inside [5%, 95%] and balanced accuracy > chance + 0.02. */
export function informative(verdicts, y, lim = INFORMATIVE) {
  let tp = 0, fn = 0, tn = 0, fp = 0, n = 0, acc = 0;
  bin(verdicts).forEach((v, i) => { if (v === null || y[i] === null || y[i] === undefined) return; n++; acc += v; if (y[i]) { if (v) tp++; else fn++; } else if (v) fp++; else tn++; });
  const acceptRate = n ? acc / n : null;
  const value = tp + fn && tn + fp ? (tp / (tp + fn) + tn / (tn + fp)) / 2 - 0.5 : null;
  const ok = acceptRate !== null && value !== null && acceptRate >= lim.minAcceptRate && acceptRate <= lim.maxAcceptRate && value > lim.minValue;
  return { ok, acceptRate, value, n };
}

/**
 * The admission rule applied in a purchase order. signals: { name: { verdicts, selfReport?: bool } }. Self-reports are
 * excluded by rule (ATTACK RC3: no decision consumes the actor's own checker), uninformative signals (informative()) are
 * not bought, then admitSignal against every signal admitted so far. rule 'point': admit when the point κ is under the
 * bar (ATTACK's literal rule; `fragile` when the bootstrap upper bound is over it); rule 'bound': admit only when the
 * upper bound is under the bar too ('provisional' signals are held, never admitted). Returns [{ name, decision, reason,
 * fragile, rows }] and the admitted list.
 */
export function admissionWalk(order, signals, { y, clusters = null, on, rule = 'point', kappaMax = KAPPA_MAX, minItems = MIN_ITEMS, B = 500 } = {}) {
  need(rule === 'point' || rule === 'bound', `admissionWalk: rule must be 'point' or 'bound', got ${rule}`);
  const admitted = [], walk = [];
  for (const name of order) {
    const sig = signals[name];
    need(sig, `admissionWalk: unknown signal ${name}`);
    if (sig.selfReport) { walk.push({ name, decision: 'excluded', reason: 'self-report (RC3: no decision consumes it)', rows: [] }); continue; }
    const inf = informative(sig.verdicts, y);
    if (!inf.ok) { walk.push({ name, decision: 'excluded', reason: `uninformative (accept rate ${inf.acceptRate?.toFixed(2)}, value ${inf.value?.toFixed(3)})`, rows: [] }); continue; }
    const res = admitSignal({ name, verdicts: sig.verdicts }, admitted.map(m => ({ name: m, verdicts: signals[m].verdicts })), { y, clusters, on, kappaMax, minItems, B });
    const admit = res.decision === 'admit' || (rule === 'point' && res.decision === 'provisional');
    const decision = admit ? 'admit' : res.decision === 'provisional' ? 'held' : res.decision;
    walk.push({ name, decision, reason: res.reason, fragile: res.decision === 'provisional', rows: res.rows });
    if (admit) admitted.push(name);
  }
  return { walk, admitted, on, rule, kappaMax };
}
