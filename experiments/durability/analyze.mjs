// DUR-1 analysis: every metric of PREREG-DUR-1 §9 and the decision rules K-0, D-1 ... D-11 (§10), on a normalised result
// model (BUILD-PLAN row 17). $0, analyst side. Pure functions first (a golden synthetic stream tests them), then the
// adapter that builds the model from the run directory, and the report (owner table first, §14).
//
// Units (template B7): the build unit is the LINEAGE (a built program and every version healed from it); heal outcomes are
// counted in CELLS (lineage x stream x change), never in cases; agents are one harness whose unit is the routed case,
// clustered by window; a comparison of agents with built arms resamples lineages and windows (D-3). No function here
// pools cases across lineages for an arm-versus-arm test. Gaps under 3 points are noise (FLOOR, stats-builds.mjs:60).
import { pairedPermutation } from '../lib/stats.mjs';
import { wilcoxonExact, holm, nonInferiority, clopperPearson, NI_MARGIN } from '../lib/stats-ebed.mjs';
import { FLOOR } from '../lib/stats-builds.mjs';
import { certifyHeal, HEAL, checkManifest, EffortMissingError } from '../lib/certify.mjs';
import { ENV_FAULT_LIMIT } from '../jit/stats.mjs';
import { rng } from '../../beds/lib/rng.mjs';
import { DAY_MS, T0_MS, HORIZON_DAYS, UNANNOUNCED, CHANGES } from './schedule.mjs';

export const RULES = Object.freeze({
  K0: { minFlagShare: 0.5, withinDays: 1, changes: ['R1', 'E1'] },
  D1: { floor: FLOOR, durableSupport: 0.80, durableFalsify: 0.50, w6Tolerance: 0.03, w6FalsifyLineages: 3, critRegressionDays: 2, critRegressionFalsifyLineages: 2 },
  D2: { cellPass: 0.50, cellFail: 1.50, shareOfAgentPass: 0.10, shareOfAgentFail: 0.25 },
  D3: { margin: NI_MARGIN, B: 10_000, seed: 'dur1/d3', medianTtdFalsify: 2 },
  D4: { tolerance: 0.03, lineagesEqual: 7, falsifyLineages: 5, floor: FLOOR, ttdSlack: 1 },
  D5: { carveoutDays: 2, minCaseDelta: 1, deltaShare: 0.01, w1FalseIncidents: 1 },
  D6: { recallPass: 0.9, recallFail: 0.5, withinDays: 1, w1FalseIncidents: 1, m6Delay: 4 },
  D7: { margin: 0.10, costShare: 0.05 },
  D8: { minHealed: 5, of: 6 },
  D10: { e2sDurable: 2 / 3, u1sLoudShare: 0.8, u1sLoudDays: 2 },
  TTD: { exceptionShare: 0.02, minExceptions: 1, minJudgeableDays: 3 },
  ALPHA: 0.05,
});

const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const median = xs => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const rate = (p, n) => (n ? p / n : NaN);
const sdayOf = (k, ms) => 14 * (k - 1) + Math.floor((ms - T0_MS) / DAY_MS) + 1;   // stream day of a time in world k

// ---------------------------------------------------------------------------------------------------------------------
// Model (per arm x unit x stream): { worlds: { [k]: { cases: { [c]: Case }, induced: { [change]: [c] }, base: [c] } },
// incidents, promotions, sessions, usd }. Case = { graded, pass, critical, placedAt, firstAt, lastAt, topic, class,
// epoch, signals: { m1?, m2?, m3?, m5? } (first attributable signal time per channel) }.

/** One-sided exact sign-flip p (prereg §10 D-1): p/2 when the mean difference is positive, else 1 - p/2. */
export function signFlipOneSided(diffs) {
  const r = pairedPermutation(diffs, diffs.map(() => 0));
  return { ...r, pOne: r.meanDiff > 0 ? r.p / 2 : 1 - r.p / 2 };
}

/** Graded cases of a world, optionally filtered. */
const gradedOf = (w, pred = () => true) => Object.entries(w?.cases ?? {}).filter(([, c]) => c.graded && pred(c));

/** Per-world success curve of one stream result: [{ k, n, pass, rate }] plus per-day (by placement day). */
export function curves(sr) {
  const worlds = Object.entries(sr.worlds).map(([k, w]) => { const g = gradedOf(w); const p = g.filter(([, c]) => c.pass).length; return { k: Number(k), n: g.length, pass: p, rate: rate(p, g.length) }; });
  const days = {};
  for (const [k, w] of Object.entries(sr.worlds)) for (const [, c] of gradedOf(w)) { const d = sdayOf(Number(k), c.placedAt); (days[d] ??= { n: 0, pass: 0 }); days[d].n += 1; if (c.pass) days[d].pass += 1; }
  return { worlds, days: Object.entries(days).map(([d, v]) => ({ streamDay: Number(d), ...v, rate: rate(v.pass, v.n) })).sort((a, b) => a.streamDay - b.streamDay) };
}

/** Pass counts on the completed cases of W2-W6 exposed to at least one change (exposure: { [k]: { [change]: Set } }). */
export function exposedPass(sr, exposure, { worlds = [2, 3, 4, 5, 6], except = null } = {}) {
  let n = 0, pass = 0;
  for (const k of worlds) {
    const w = sr.worlds[k]; if (!w) continue;
    const ex = new Set(Object.entries(exposure?.[k] ?? {}).filter(([c]) => !except || !except.includes(c)).flatMap(([, s]) => [...s]));
    for (const [c, v] of gradedOf(w)) if (ex.has(c)) { n += 1; if (v.pass) pass += 1; }
  }
  return { n, pass, rate: rate(pass, n) };
}

/**
 * TTD of one change on one stream for one arm (prereg §9 item 3). E = the cases exposed to c placed at or after its onset
 * (all worlds from its start), ordered by stream day of placement. bad(case) = a c-induced failure (oracle view) or, for
 * the system view, "an attributable signal". TTD = first day t (counted from the onset) such that among E's cases placed
 * on or after t at most max(1, floor(0.02 n)) are bad through the end of the stream and at least 3 world-days with an E
 * case remain; Infinity if none; 'unjudgeable' if fewer than 3 such days remain at every candidate t.
 */
export function ttd({ cases, onsetDay, bad, rules = RULES.TTD }) {
  // cases: [{ sday, case }] (stream day of placement), all exposed and placed >= onset.
  const E = [...cases].filter(x => x.sday >= onsetDay).sort((a, b) => a.sday - b.sday);
  if (!E.length) return { ttd: null, status: 'no-exposure', n: 0 };
  const days = [...new Set(E.map(x => x.sday))];
  let judgeable = false;
  for (const t of days) {
    const rest = E.filter(x => x.sday >= t);
    const restDays = new Set(rest.map(x => x.sday)).size;
    if (restDays < rules.minJudgeableDays) break;
    judgeable = true;
    const allowed = Math.max(rules.minExceptions, Math.floor(rules.exceptionShare * rest.length));
    const nBad = rest.filter(x => bad(x.case, x)).length;
    if (nBad <= allowed) return { ttd: t - onsetDay, status: 'durable', n: E.length, at: t, bad: nBad, allowed };
  }
  return { ttd: judgeable ? Infinity : null, status: judgeable ? 'not-durable' : 'unjudgeable', n: E.length };
}

/** Heal-requiring cells: (lineage, stream, change) where S-H* has >= 1 change-induced failure of the change on the stream. */
export function healRequiringCells(staticModel) {
  const cells = [];
  for (const [lineage, byStream] of Object.entries(staticModel)) for (const [stream, sr] of Object.entries(byStream)) {
    const changes = new Set();
    for (const w of Object.values(sr.worlds)) for (const [c, list] of Object.entries(w.induced ?? {})) if (list.length) changes.add(c);
    for (const c of changes) cells.push({ lineage, stream, change: c });
  }
  return cells;
}

/** Durability of each cell under an arm: { cell, ttd, durable, certified? } (TTD in the oracle view). */
export function cellDurability({ cells, armModel, exposureOf, onsetOf, certifiedOf = null }) {
  return cells.map(cell => {
    const sr = armModel[cell.lineage]?.[cell.stream];
    if (!sr) return { ...cell, status: 'missing' };
    const E = [];
    const inducedSet = new Set();
    for (const [k, w] of Object.entries(sr.worlds)) {
      for (const c of exposureOf(cell.stream, Number(k), cell.change) ?? []) { const v = w.cases[c]; if (v?.graded) E.push({ sday: sdayOf(Number(k), v.placedAt), case: `${k}/${c}` }); }
      for (const c of w.induced?.[cell.change] ?? []) inducedSet.add(`${k}/${c}`);
    }
    const t = ttd({ cases: E, onsetDay: onsetOf(cell.stream, cell.change), bad: c => inducedSet.has(c) });
    const durable = t.status === 'durable';
    const certified = certifiedOf ? certifiedOf(cell) : null;
    return { ...cell, ...t, durable, certified, certifiedDurable: durable && certified === 'accept' };
  });
}

/** Durable share over heal-requiring cells (unjudgeable and missing cells are reported, not counted). */
export function durableShare(rows, { certified = false } = {}) {
  const judged = rows.filter(r => ['durable', 'not-durable'].includes(r.status));
  const ok = judged.filter(r => (certified ? r.certifiedDurable : r.durable)).length;
  return { share: rate(ok, judged.length), durable: ok, judged: judged.length, unjudgeable: rows.filter(r => r.status === 'unjudgeable').length, missing: rows.filter(r => r.status === 'missing').length };
}

/**
 * K-0 (kill, $0): on s1, m1-m3 (with the analyst's R1 reading) flag < 50% of S-H*'s change-induced failing cases of R1 or
 * of E1 within 1 world-day of first divergence -> stop before any paid heal. staticS1: { [lineage]: StreamResult }.
 */
export function k0(staticS1, { rules = RULES.K0 } = {}) {
  const out = {};
  for (const ch of rules.changes) {
    let n = 0, flagged = 0;
    for (const sr of Object.values(staticS1)) for (const w of Object.values(sr.worlds)) for (const c of w.induced?.[ch] ?? []) {
      const v = w.cases[c]; if (!v?.graded || v.firstAt === null) continue;
      n += 1;
      const s = ['m1', 'm2', 'm3'].map(m => v.signals?.[m]).filter(x => typeof x === 'number');
      if (s.some(t => t <= v.firstAt + rules.withinDays * DAY_MS)) flagged += 1;
    }
    out[ch] = { n, flagged, share: rate(flagged, n) };
  }
  const kill = Object.values(out).some(x => x.n > 0 && x.share < rules.minFlagShare);
  return { kill, perChange: out, verdict: kill ? 'KILL: the monitor is blind (stop before any paid heal)' : 'pass' };
}

/**
 * D-1 heals, against static (primary). heal/stat: { [lineage]: { [stream]: StreamResult } }; exposure(stream) -> { [k]:
 * { [change]: Set } }. cellRows from cellDurability (certified when available). Returns the verdict and its parts.
 */
export function d1({ heal, stat, exposure, cellRows, critRegressions = {}, holmLevel = 0.025, rules = RULES.D1, w6Except = ['U1s'] }) {
  const lineages = Object.keys(stat).filter(l => heal[l]).sort();
  const per = lineages.map(l => {
    let hn = 0, hp = 0, sn = 0, sp = 0;
    for (const s of Object.keys(stat[l])) {
      if (!heal[l][s]) continue;
      const a = exposedPass(heal[l][s], exposure(s)), b = exposedPass(stat[l][s], exposure(s));
      hn += a.n; hp += a.pass; sn += b.n; sp += b.pass;
    }
    const w = k => { let n = 0, p = 0; for (const s of Object.keys(heal[l])) { const ex = exposure(s); const skip = new Set(Object.entries(ex?.[k] ?? {}).filter(([c]) => w6Except.includes(c)).flatMap(([, x]) => [...x])); for (const [c, v] of gradedOf(heal[l][s].worlds[k])) { if (skip.has(c)) continue; n += 1; if (v.pass) p += 1; } } return rate(p, n); };
    const w6s = k => { let n = 0, p = 0; for (const s of Object.keys(stat[l])) for (const [, v] of gradedOf(stat[l][s].worlds[k])) { n += 1; if (v.pass) p += 1; } return rate(p, n); };
    return { lineage: l, heal: rate(hp, hn), static: rate(sp, sn), diff: rate(hp, hn) - rate(sp, sn), nHeal: hn, nStatic: sn, w1: w(1), w6: w(6), w6Static: w6s(6), w6Heal: w(6) };
  });
  const diffs = per.map(x => x.diff).filter(Number.isFinite);
  const test = diffs.length ? signFlipOneSided(diffs) : { pOne: 1, meanDiff: NaN };
  const wil = diffs.length ? wilcoxonExact(diffs, { alternative: 'greater' }) : null;
  const certified = cellRows.some(r => r.certified !== null && r.certified !== undefined);
  const ds = durableShare(cellRows, { certified });
  const w6Drop = per.filter(x => Number.isFinite(x.w6) && Number.isFinite(x.w1) && x.w6 < x.w1 - rules.w6Tolerance).map(x => x.lineage);
  const w6Worse = per.filter(x => Number.isFinite(x.w6Heal) && Number.isFinite(x.w6Static) && x.w6Heal < x.w6Static - rules.w6Tolerance).map(x => x.lineage);
  const lastingCrit = Object.entries(critRegressions).filter(([, days]) => days > rules.critRegressionDays).map(([l]) => l);
  const supported = test.pOne <= holmLevel && test.meanDiff >= rules.floor && ds.share >= rules.durableSupport && !w6Drop.length && !lastingCrit.length;
  const falsified = ds.share < rules.durableFalsify || w6Worse.length >= rules.w6FalsifyLineages || lastingCrit.length >= rules.critRegressionFalsifyLineages;
  const noCht = per.filter(x => !x.lineage.startsWith('cht')).map(x => x.diff).filter(Number.isFinite);
  return { verdict: supported ? 'SUPPORTED' : falsified ? 'FALSIFIED' : 'INCONCLUSIVE', p: test.pOne, meanDiff: test.meanDiff, wilcoxonP: wil?.p ?? null, perLineage: per,
    durable: { ...ds, certified }, w6Drop, w6Worse, lastingCrit, sensitivityNoCht: noCht.length ? signFlipOneSided(noCht).pOne : null, holmLevel };
}

/**
 * D-3 against the per-tick agent (primary): d(l, x) = MH-H(l, x) - A-H(x) over the routed cases; two-way bootstrap over
 * lineages and windows (B, seed fixed). pairs: [{ lineage, window, case, heal: 0|1, agent: 0|1 }].
 */
export function twoWayBootstrap(pairs, { B = RULES.D3.B, seed = RULES.D3.seed, margin = RULES.D3.margin } = {}) {
  // The unit rule (template B7): every pair names its lineage (build) and its window (case cluster); a flat case list is refused.
  for (const p of pairs) if (!p.lineage || !p.window || !p.case || ![0, 1].includes(Number(p.heal)) || ![0, 1].includes(Number(p.agent))) throw new Error(`DUR1_UNIT: a D-3 pair needs lineage, window, case and 0/1 outcomes (got ${JSON.stringify(p).slice(0, 120)})`);
  const lineages = [...new Set(pairs.map(p => p.lineage))].sort(), windows = [...new Set(pairs.map(p => p.window))].sort();
  const cell = new Map();
  for (const p of pairs) { const k = `${p.lineage}|${p.window}`; if (!cell.has(k)) cell.set(k, { s: 0, n: 0 }); const c = cell.get(k); c.s += p.heal - p.agent; c.n += 1; }
  const stat = (L, Wn) => { let s = 0, n = 0; for (const l of L) for (const w of Wn) { const c = cell.get(`${l}|${w}`); if (c) { s += c.s; n += c.n; } } return n ? s / n : NaN; };
  const obs = stat(lineages, windows);
  const r = rng(seed, lineages.length, windows.length);
  const boots = [];
  for (let b = 0; b < B; b++) {
    const L = lineages.map(() => lineages[Math.floor(r.next() * lineages.length)]), Wn = windows.map(() => windows[Math.floor(r.next() * windows.length)]);
    const v = stat(L, Wn); if (Number.isFinite(v)) boots.push(v);
  }
  boots.sort((a, b) => a - b);
  const q = x => boots[Math.min(boots.length - 1, Math.max(0, Math.floor(x * boots.length)))];
  return { mean: obs, lo95: q(0.025), hi95: q(0.975), pNI: boots.filter(v => v <= -margin).length / boots.length, lineages: lineages.length, windows: windows.length, B: boots.length };
}
/** The window-only bootstrap (lineages averaged first; nonInferiority of stats-ebed), printed beside D-3, never deciding. */
export function windowOnly(pairs, { B = 2000, seed = 'dur1/d3-window-only' } = {}) {
  // Lineages are averaged first (one number per case), then windows are resampled: the build spread is hidden, which is
  // exactly why it is printed beside D-3 and never decides (stats-ebed nonInferiority needs 0/1 outcomes per side, and a
  // lineage-averaged MH-H outcome is a fraction, so the window-cluster bootstrap is written out here).
  const byCase = new Map();
  for (const p of pairs) { const k = `${p.window}|${p.case}`; if (!byCase.has(k)) byCase.set(k, { window: p.window, h: [], a: p.agent }); byCase.get(k).h.push(p.heal); }
  const byWin = new Map();
  for (const v of byCase.values()) { if (!byWin.has(v.window)) byWin.set(v.window, []); byWin.get(v.window).push(mean(v.h) - v.a); }
  const wins = [...byWin.values()];
  if (!wins.length) return null;
  const all = wins.flat(), est = mean(all);
  const r = rng(seed, wins.length);
  const boots = [];
  for (let b = 0; b < B; b++) { let s = 0, n = 0; for (let j = 0; j < wins.length; j++) { const w = wins[Math.floor(r.next() * wins.length)]; for (const d of w) { s += d; n += 1; } } boots.push(s / n); }
  boots.sort((a, c) => a - c);
  const q = x => boots[Math.min(boots.length - 1, Math.max(0, Math.floor(x * boots.length)))];
  return { estimate: est, lower: q(0.025), upper: q(0.975), windows: wins.length, cases: all.length, pNI: boots.filter(v => v <= -RULES.D3.margin).length / boots.length, decides: false };
}
export function d3({ pairs, medianTtd, holmLevel = 0.05, sDropped = false }) {
  if (!pairs.length) return { verdict: 'NOT RUN', p: 1 };
  const bt = twoWayBootstrap(pairs);
  const supported = bt.pNI <= holmLevel;
  const falsified = bt.hi95 < 0 && medianTtd > RULES.D3.medianTtdFalsify;
  return { verdict: sDropped ? `DIRECTIONAL (${supported ? 'supported' : falsified ? 'falsified' : 'inconclusive'})` : supported ? 'SUPPORTED' : falsified ? 'FALSIFIED' : 'INCONCLUSIVE', p: bt.pNI, ...bt, windowOnly: windowOnly(pairs), holmLevel };
}

/** Holm over the primary family (D-1, D-3) at family-wise one-sided alpha 0.05: the smaller p at 0.025, the other at 0.05. */
export function primaryLevels(pD1, pD3, alpha = RULES.ALPHA) {
  const h = holm({ D1: pD1, D3: pD3 }, { alpha });
  const first = pD1 <= pD3 ? 'D1' : 'D3';
  return { D1: first === 'D1' ? alpha / 2 : alpha, D3: first === 'D3' ? alpha / 2 : alpha, holm: h };
}

/** D-2 cheap: median maintenance $ per heal-requiring cell and MH-H's marginal $ per lineage-stream against A-H's projection. */
export function d2({ cellCosts, healMarginal, agentProjected, rules = RULES.D2 }) {
  const mc = median(cellCosts), share = median(healMarginal.map(x => x.usd / (agentProjected[x.stream] ?? NaN)).filter(Number.isFinite));
  const pass = mc <= rules.cellPass && share <= rules.shareOfAgentPass;
  const fail = mc > rules.cellFail || share > rules.shareOfAgentFail;
  return { verdict: pass ? 'PASS' : fail ? 'FALSIFIED' : 'INCONCLUSIVE', medianCellUsd: mc, medianShareOfAgent: share };
}

/** D-4 durable state >= a human's. finalWeek: { arm: { unit: rate } }; ttdMedian: { 'MH-H': x, 'REF-M': y }. */
export function d4({ healFW, rmaint2FW, rstaticFW, refmFW = null, healS1Median = null, ttdHeal = null, ttdRefm = null, rules = RULES.D4 }) {
  const lineages = Object.keys(healFW);
  const meets = lineages.filter(l => healFW[l] >= rmaint2FW - rules.tolerance).length;
  const below = lineages.filter(l => healFW[l] < rstaticFW - rules.tolerance).length;
  const refmVals = refmFW ? Object.values(refmFW) : [];
  const delta = refmVals.length ? Math.max(rules.floor, Math.max(...refmVals) - Math.min(...refmVals)) : rules.floor;
  const refmOk = refmVals.length && healS1Median !== null ? healS1Median >= Math.min(...refmVals) - delta : null;
  const ttdOk = ttdHeal !== null && ttdRefm !== null ? ttdHeal <= ttdRefm + rules.ttdSlack : null;
  const equal = meets >= rules.lineagesEqual && refmOk !== false && ttdOk !== false && refmOk !== null && ttdOk !== null;
  const better = equal && refmVals.length && healS1Median >= Math.max(...refmVals) + delta && ttdHeal <= ttdRefm;
  return { verdict: better ? 'BETTER' : equal ? 'EQUAL' : below >= rules.falsifyLineages ? 'FALSIFIED' : 'NOT SHOWN', meetsRmaint2: `${meets}/${lineages.length}`, belowRstatic: below, delta, refmOk, ttdOk };
}

/**
 * D-5 worst case. units: [{ lineage, world, cls, silentCritical, silentCritCarveOut? }] (one per lineage x world x class);
 * adv: { silentCritical, maxSilentPerWorld, refsMax }; perClassWorst: [{ cls, healWorst, refWorst, n }]; routed: d-pairs of
 * silent failures; w1FalseIncidents: [count per lineage-world].
 */
export function d5({ units, adv = null, perClassWorst = [], routedSilent = null, w1FalseIncidents = [], rules = RULES.D5 }) {
  const sc = units.filter(u => u.silentCritical > 0);
  const missing = [];
  if (adv && (adv.silentCritical > 0)) missing.push('(b) ADV-SET silent critical');
  if (adv && adv.maxSilentPerWorld > adv.refsMax + Math.max(rules.minCaseDelta, Math.ceil(rules.deltaShare * (adv.n ?? 0)))) missing.push('(b) ADV-SET silent max above REF-S + delta');
  for (const c of perClassWorst) if (c.healWorst > c.refWorst + Math.max(rules.minCaseDelta / Math.max(1, c.n), rules.deltaShare)) missing.push(`(c) class ${c.cls}`);
  if (routedSilent && !(routedSilent.mean <= 0 && routedSilent.hi95 <= 0.05)) missing.push('(d) routed silent failures above the agent');
  if (w1FalseIncidents.some(x => x > rules.w1FalseIncidents)) missing.push('(e) alarm flood on W1');
  const N = units.length;
  const bound = { units: N, events: sc.length, rateUpper: sc.length === 0 ? (N ? 3 / N : null) : clopperPearson(new Set(sc.map(u => `${u.lineage}|${u.world}`)).size, N, 'upper').upper };
  return { verdict: sc.length ? 'NO' : missing.length ? 'PARTIAL' : 'YES', silentCriticalUnits: sc.slice(0, 20), missing, bound,
    wording: 'the worst observed over the stated search (N worlds, M probes), with monitor M; never "worst-case correctness"' };
}

/** D-6 detection: per unannounced class, recall within 1 world-day of onset over (lineage x stream) onsets. */
export function d6({ onsets, w1FalseIncidents = [], m6 = null, rules = RULES.D6 }) {
  // onsets: [{ change, lineage, stream, detectedDelayDays: number | null, announcedFired: bool }]
  const by = {};
  for (const o of onsets) { if (o.announcedFired) continue; (by[o.change] ??= { n: 0, hit: 0 }); by[o.change].n += 1; if (o.detectedDelayDays !== null && o.detectedDelayDays <= rules.withinDays) by[o.change].hit += 1; }
  const recall = Object.fromEntries(Object.entries(by).map(([c, v]) => [c, { ...v, recall: rate(v.hit, v.n) }]));
  const vals = Object.values(recall).map(v => v.recall).filter(Number.isFinite);
  const flood = w1FalseIncidents.some(x => x > rules.w1FalseIncidents);
  const pass = vals.length && vals.every(r => r >= rules.recallPass) && !flood;
  const fail = vals.some(r => r < rules.recallFail);
  return { verdict: pass ? 'PASS' : fail ? 'FAIL' : 'DETECTS MOST, NOT ALL', recall, flood, m6: m6 ?? null };
}

/** D-8 runs expose flaws (LD-H): ld = [{ defect, healed, durable, regressions, falseComplaintHarm }]. */
export function d8(ld, rules = RULES.D8) {
  const healed = ld.filter(x => x.healed && x.durable && x.regressions === 0).length;
  const harm = ld.filter(x => x.falseComplaintHarm).length;
  return { verdict: harm ? 'FALSIFIED' : healed >= rules.minHealed ? 'PASS' : 'NOT SHOWN', healed: `${healed}/${ld.length}`, falseComplaintHarm: harm };
}

/** D-10 the unknown: E2s durable in >= 2/3 of its cells; U1s loud within 2 world-days of its first true complaint in >= 80%. */
export function d10({ e2sCells, u1sLoud, rules = RULES.D10 }) {
  const e = durableShare(e2sCells);
  const l = u1sLoud.length ? u1sLoud.filter(x => x.loudWithinDays !== null && x.loudWithinDays <= rules.u1sLoudDays).length / u1sLoud.length : NaN;
  return { e2s: e, u1sLoudShare: l, verdict: (e.share >= rules.e2sDurable && l >= rules.u1sLoudShare) ? 'DETECTS AND HEALS UNKNOWN CHANGE (dev)' : 'NOT SHOWN' };
}

/** D-11 red team adds value: for >= 1 of 2 Opus targets, a valid world with strictly more silent failing cases than blind search. */
export function d11(targets) {
  const wins = targets.filter(t => t.redTeamBest > t.blindBest);
  return { verdict: wins.length ? 'ADDS VALUE' : 'NO VALUE SHOWN', wins: wins.map(t => t.target) };
}

/** Zero-event bound in (lineage x world) units (never cases): 0 events in N units -> rate <= 3/N per world. */
export const zeroEventBound = N => (N > 0 ? 3 / N : null);

// ---------------------------------------------------------------------------------------------------------------------
// Silent, loud, false incidents

/** Is a failing case silent for an arm? (no visible attributable signal before its last effect + 1 world-day) */
export function silent(c, channels) {
  const deadline = (c.lastAt ?? c.firstAt ?? 0) + DAY_MS;
  return !channels.some(ch => typeof c.signals?.[ch] === 'number' && c.signals[ch] <= deadline);
}
export const VISIBLE = Object.freeze({ heal: ['m1', 'm2', 'm3', 'm5'], healNoComplaints: ['m1', 'm2', 'm3'], static: ['m1'], agent: ['m1'] });

/** Silent and loud failing cases per world and class of one stream result. */
export function silentLoud(sr, channels, classOf = () => 'all') {
  const out = [];
  for (const [k, w] of Object.entries(sr.worlds)) {
    const by = new Map();
    for (const [c, v] of gradedOf(w)) {
      if (v.pass) continue;
      const cls = classOf(Number(k), c, v);
      if (!by.has(cls)) by.set(cls, { world: Number(k), cls, failing: 0, silent: 0, loud: 0, silentCritical: 0, n: 0 });
      const b = by.get(cls); b.failing += 1;
      if (silent(v, channels)) { b.silent += 1; if (v.critical) b.silentCritical += 1; } else b.loud += 1;
    }
    for (const [, v] of gradedOf(w)) { const cls = classOf(Number(k), null, v); if (by.has(cls)) by.get(cls).n += 1; }
    out.push(...by.values());
  }
  return out;
}

/** Incidents whose evidence cases all pass (oracle) = false incidents. */
export function falseIncidents(incidents, passOf) {
  return incidents.filter(i => i.kind !== 'verifier-blind' && i.evidence?.length && i.evidence.every(e => e.case && passOf(e.world, e.case) === true));
}

// ---------------------------------------------------------------------------------------------------------------------
// Certification (D28 (5); prereg §10 Certification): the frozen evidence mapping, then certifyHeal (deterministic mode).

/**
 * certEvidence({ replays, failing, regressions, fresh }) → certifyHeal input.
 *   replays     [digest] of the incumbent's journals on 3 replays of the evidence set (identical = determinism);
 *   failing     [{ case, incumbentPass: false, candidatePass }] the incident's evidence cases failing under the incumbent;
 *   regressions [{ case, incumbentPass: true, candidatePass }] the regression set's cases passing under the incumbent;
 *   fresh       [{ case, rule (incumbent's first-divergence rule or 'pass'), incumbentPass, candidatePass }] stream cases
 *               placed after the promotion, never shown to the patcher.
 */
export function certEvidence({ replays, failing, regressions, fresh, incidentRules = null }) {
  const identical = replays.filter(d => d === replays[0]).length;
  const strata = new Map();
  for (const f of fresh) {
    const key = f.incumbentPass ? 'pass' : (incidentRules && !incidentRules.includes(f.rule) ? 'other' : f.rule ?? 'unknown');
    if (!strata.has(key)) strata.set(key, { stratum: key, failing: false, base: { n: 0, pass: 0 }, cand: { n: 0, pass: 0 } });
    const s = strata.get(key);
    s.base.n += 1; s.cand.n += 1;
    if (f.incumbentPass) s.base.pass += 1; else s.failing = true;
    if (f.candidatePass) s.cand.pass += 1;
  }
  return { mode: 'deterministic', determinism: { replays: replays.length, identical },
    failing: { n: failing.length, fixed: failing.filter(x => x.candidatePass).length },
    regressions: { n: regressions.length, broken: regressions.filter(x => !x.candidatePass).length },
    fresh: [...strata.values()].filter(s => s.stratum !== 'other') };
}
export const certify = e => certifyHeal(e);
export { HEAL, EffortMissingError, checkManifest };

/** A paid launch manifest must name an effort for every model node (D28 (4)); refuse otherwise. */
export function assertEfforts(nodes, runId) {
  const missing = nodes.filter(n => n.model && !n.effort).map(n => n.id ?? n.model);
  if (missing.length) throw new EffortMissingError(runId, missing);
  return true;
}

/** Environment-fault validity: an arm or window with > 25% impaired ticks or sessions is invalid (ENV_FAULT_LIMIT). */
export const envInvalid = (impaired, planned) => planned > 0 && impaired / planned > ENV_FAULT_LIMIT;

// ---------------------------------------------------------------------------------------------------------------------
// Root-cause ledger scaffold (prereg §14.3): one record per failing class (first-divergence rule x change class x arm) and
// per unhealed change, with an automatic first category; analyst sessions review it. No result text before it is complete.

export const RC_CATEGORIES = Object.freeze(['spec misreading', 'hard-coded value', 'generic mechanism missing', 'fault handling', 'version migration', 'heal regression',
  'stale verifier', 'detection miss', 'misclassification', 'evidence insufficient', 'patch wrong', 'gate rejected a good patch', 'gate accepted a bad patch',
  'injection', 'budget or time cap', 'environment', 'bed or oracle defect']);
export function rootCauseScaffold({ arm, failing, unhealed }) {
  const recs = [];
  for (const f of failing) recs.push({ arm, key: `${f.rule ?? f.code}|${f.changeClass ?? 'base'}`, n: f.n, category: f.silent ? 'detection miss' : f.changeClass === 'FLT' ? 'fault handling' : f.changeClass ? 'generic mechanism missing' : 'spec misreading', status: 'automatic first pass; analyst review pending', examples: f.examples ?? [] });
  for (const u of unhealed) recs.push({ arm, key: `unhealed|${u.change}|${u.lineage}|${u.stream}`, category: u.reason === 'budget-stop' ? 'budget or time cap' : u.reason === 'needs-human' ? 'patch wrong' : u.reason === 'not detected' ? 'detection miss' : 'evidence insufficient', status: 'automatic first pass; analyst review pending', detail: u });
  return { records: recs, complete: recs.every(r => RC_CATEGORIES.includes(r.category)) };
}

// ---------------------------------------------------------------------------------------------------------------------
// The owner table (prereg §14.1): Q1-Q7 with their verdicts first.

export function ownerTable({ k0r, d1r, d3r, d2r, d4r, d5r, d6r, d8r, d10r, rc }) {
  return [
    { q: 'Q1 good enough in the worst case?', rule: 'D-5, D-11', verdict: d5r?.verdict ?? 'NOT RUN' },
    { q: 'Q2 adapts and heals as it does real work?', rule: 'D-1 (primary), D-6, D-10', verdict: k0r?.kill ? 'KILLED AT K-0' : `${d1r?.verdict ?? 'NOT RUN'}; detection ${d6r?.verdict ?? 'NOT RUN'}; unknown ${d10r?.verdict ?? 'NOT RUN'}` },
    { q: 'Q3 performance tested as it changes?', rule: 'reported', verdict: 'curves per arm (see below)' },
    { q: 'Q4 durable state >= a human\'s?', rule: 'D-4', verdict: d4r?.verdict ?? 'NOT RUN' },
    { q: 'Q5 versus a per-tick agent; beat Opus at a fraction of the cost?', rule: 'D-3 (primary), D-2, D-7', verdict: `${d3r?.verdict ?? 'NOT RUN'}; cost ${d2r?.verdict ?? 'NOT RUN'}` },
    { q: 'Q6 runs expose flaws in a hand-crafted workflow?', rule: 'D-8', verdict: d8r?.verdict ?? 'NOT RUN' },
    { q: 'Q7 every failure figured out?', rule: '§14.3', verdict: rc ? (rc.complete ? `ledger complete (${rc.records.length} records, analyst review pending)` : 'LEDGER INCOMPLETE: no result text') : 'NOT RUN' },
  ];
}
