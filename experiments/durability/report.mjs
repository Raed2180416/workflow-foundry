// DUR-1 report: applies every decision rule of PREREG-DUR-1 §10 (analyze.mjs) to the models built from the run
// (model.mjs) and prints the owner table first (§14.1). $0, analyst side. Every part that did not run reads NOT RUN; a
// rule never infers a missing input.
//
// results = {
//   worlds: { [stream]: [spec] },  exposure: { [stream]: streamExposure },
//   arms: { 'S-H*' | 'MH-H' | 'REF-S' | 'REF-M' | 'R-static' | 'R-maint0' | 'R-maint2' | 'R-maint7' | 'R-ceil' | 'MH-stale' | ...:
//           { [unit]: { [stream]: model } } },               (model.mjs modelOf, with attribution for S-H*, MH-H, REF-M)
//   certs: { [lineage]: { [stream]: [cert] } },             (model.mjs certifyRecord of MH-H)
//   windows: { pairs: [{ lineage, window, case, heal, agent, healSilent, agentSilent }], agentUsdPerCase, aox?: {...} } | null,
//   ld: [analysis] | null, adv: { ... } | null, redTeam: [{ target, redTeamBest, blindBest }] | null,
//   costs: { coUsd: { [change]: usd }, agentProjected: { [stream]: usd } },
//   sDropped: bool, m6: {...} | null,
// }
import { RULES, k0, d1, d2, d3, d4, d5, d6, d8 as d8Rule, d10, d11, primaryLevels, healRequiringCells, cellDurability, durableShare, curves, exposedPass,
  silentLoud, VISIBLE, falseIncidents, rootCauseScaffold, ownerTable, ttd } from './analyze.mjs';
import { onsetDay, certifiedOfCells, critRegressionDays } from './model.mjs';
import { CHANGES, CHANGE_IDS, UNANNOUNCED, T0_MS, DAY_MS } from './schedule.mjs';

const median = xs => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sday = (k, ms) => 14 * (k - 1) + Math.floor((ms - T0_MS) / DAY_MS) + 1;
/** The changes whose windows are routed (prereg §7): D-3's falsifier median is over these. */
export const WINDOWED = Object.freeze(['E1', 'R1', 'R2s', 'E2s']);
/** Exposure order for the class of an unattributed case: P1 LAST (P1 exposes nearly every order after W2 d6; review M5). */
export const CLASS_ORDER = Object.freeze([...CHANGE_IDS.filter(c => c !== 'P1'), 'P1']);

/**
 * The scenario classes of a case (§8.1; review M5): by ATTRIBUTION first, multi-label: the classes of every change whose
 * incremental twin repairs the case (inducedOf(k) -> { [change]: [case] }); otherwise the class of the first change it is
 * exposed to in CLASS_ORDER (P1 last); otherwise IP. Returns an array.
 */
export function classOfCase(exposureK, inducedOf = null) {
  return (k, c) => {
    if (c === null) return [];
    const ind = inducedOf ? inducedOf(k) ?? {} : {};
    const byAttr = [...new Set(Object.entries(ind).filter(([, list]) => (list instanceof Set ? list.has(c) : list?.includes?.(c))).map(([ch]) => CHANGES[ch]?.cls).filter(Boolean))];
    if (byAttr.length) return byAttr;
    for (const id of CLASS_ORDER) if (exposureK(k)?.[id]?.has(c)) return [CHANGES[id].cls];
    return ['IP'];
  };
}

/** Final-week cases (placed W6 d8-d14) of one model: { n, pass }. */
export function finalWeekCases(model) {
  const w = model?.worlds?.[6];
  if (!w) return { n: 0, pass: 0 };
  const lo = T0_MS + 7 * DAY_MS;
  const xs = Object.values(w.cases).filter(c => c.graded && c.placedAt >= lo);
  return { n: xs.length, pass: xs.filter(c => c.pass).length };
}
/** Final-week success of one model. */
export function finalWeek(model) { const f = finalWeekCases(model); return f.n ? f.pass / f.n : NaN; }
/** Final-week success pooled over a unit's streams (review M3: a median over streams hid the worst stream). */
export const finalWeekPooled = byStream => { let n = 0, p = 0; for (const m of Object.values(byStream ?? {})) { const f = finalWeekCases(m); n += f.n; p += f.pass; } return n ? p / n : NaN; };

/** Detection onsets of unannounced changes for one arm: per (unit, stream, change) the first attributable signal on an exposed case after the onset. */
export function detectionOnsets(armModels, worldsOf, exposureOf, { channels = ['m1', 'm2', 'm3', 'm5'] } = {}) {
  const out = [];
  for (const [unit, byStream] of Object.entries(armModels)) for (const [stream, m] of Object.entries(byStream)) {
    const worlds = worldsOf(stream);
    for (const c of UNANNOUNCED) {
      const spec = worlds.find(w => w.changes.some(x => x.id === c && x.startsHere));
      if (!spec) continue;
      const onsetMs = spec.changes.find(x => x.id === c).onsetMs;
      if (onsetMs === null) continue;
      const ex = exposureOf(stream)(spec.k)?.[c] ?? new Set();
      if (!ex.size) continue;
      const w = m.worlds[spec.k];
      let first = null;
      for (const x of ex) { const s = w?.cases?.[x]?.signals ?? {}; for (const ch of channels) if (typeof s[ch] === 'number' && s[ch] >= onsetMs && (first === null || s[ch] < first)) first = s[ch]; }
      out.push({ change: c, lineage: unit, stream, detectedDelayDays: first === null ? null : (first - onsetMs) / DAY_MS, announcedFired: false });
    }
  }
  return out;
}

/**
 * U1s loudness (D-10): per lineage-stream, the delay from the first true complaint about a U1s-exposed case to an incident
 * that opened or escalated (verifier-blind or a defect incident holding a U1s-exposed case), in world-days.
 */
export function u1sLoud(healRecords, exposureOf, worldsOf) {
  const out = [];
  for (const [unit, byStream] of Object.entries(healRecords)) for (const [stream, rec] of Object.entries(byStream)) {
    const worlds = worldsOf(stream);
    const spec = worlds.find(w => w.changes.some(x => x.id === 'U1s' && x.startsHere));
    if (!spec) continue;
    const ex = exposureOf(stream)(spec.k)?.U1s ?? new Set();
    const w = rec.worlds.find(x => x.k === spec.k);
    const firstTrue = (w?.complaints ?? []).filter(c => c.kind === 'true' && ex.has(c.case)).sort((a, b) => a.at - b.at)[0];
    if (!firstTrue) { out.push({ lineage: unit, stream, firstComplaint: null, loudWithinDays: null, note: 'no true complaint about a U1s-exposed case' }); continue; }
    const loud = (rec.incidents ?? []).filter(i => i.opened.k === spec.k && (i.kind === 'verifier-blind' || i.evidence?.some(e => e.k === spec.k && ex.has(e.case))))
      .map(i => i.opened.at).filter(t => t >= firstTrue.at).sort((a, b) => a - b)[0];
    out.push({ lineage: unit, stream, firstComplaint: firstTrue.at, loudWithinDays: loud === undefined ? null : (loud - firstTrue.at) / DAY_MS });
  }
  return out;
}

/** Heal-requiring cells (review M4): S-H* has >= 1 c-induced failure AND S-H*'s own TTD for the cell is infinite. */
export function healRequiringCellsStrict({ stat, exposureOf, onsetOf }) {
  const any = healRequiringCells(stat);
  const staticRows = cellDurability({ cells: any, armModel: stat, exposureOf, onsetOf });
  const cells = staticRows.filter(r => r.status === 'not-durable').map(({ lineage, stream, change }) => ({ lineage, stream, change }));
  return { cells, any, staticRows };
}

/**
 * Per class worst-lineage silent failing rate (D-5 c; review M6): per stream and class, MH-H's worst lineage against the
 * worst reference unit (REF-M on s1, REF-S off s1). Returns null when a reference is missing (fail closed).
 */
export function perClassWorstOf({ heal, refm, refs, classOfFor }) {
  const out = [];
  const rateOf = (byUnit, s, channels) => {
    const per = {};
    for (const [u, b] of Object.entries(byUnit ?? {})) {
      const m = b[s]; if (!m) continue;
      for (const row of silentLoud(m, channels, classOfFor(s, m))) { const x = ((per[row.cls] ??= {})[u] ??= { silent: 0, n: 0 }); x.silent += row.silent; x.n += row.n; }
    }
    return per;
  };
  const streams = new Set(Object.values(heal).flatMap(b => Object.keys(b)));
  for (const s of streams) {
    const ref = s === 's1' ? refm : refs;
    if (!ref || !Object.values(ref).some(b => b[s])) return null;
    const h = rateOf(heal, s, VISIBLE.heal), r = rateOf(ref, s, s === 's1' ? VISIBLE.heal : VISIBLE.static);
    for (const [cls, byU] of Object.entries(h)) {
      const worst = Math.max(...Object.values(byU).map(x => (x.n ? x.silent / x.n : 0)));
      const rr = Object.values(r[cls] ?? {});
      const refWorst = rr.length ? Math.max(...rr.map(x => (x.n ? x.silent / x.n : 0))) : 0;
      out.push({ stream: s, cls, healWorst: worst, refWorst, n: Math.max(...Object.values(byU).map(x => x.n)), ref: s === 's1' ? 'REF-M' : 'REF-S' });
    }
  }
  return out;
}

/** D-1's critical-regression input from the certifications (null if any promoted lineage-stream lacks them: fail closed). */
export function critRegressionsOf(records, certs) {
  const out = {};
  for (const [l, by] of Object.entries(records ?? {})) for (const [s, rec] of Object.entries(by)) {
    if (!(rec.promotions ?? []).length) continue;
    const cs = certs?.[l]?.[s];
    if (!cs || cs.length !== rec.promotions.length || cs.some(c => !c.critRegression)) return null;
    const days = critRegressionDays(rec, cs);
    if (days > 0) out[l] = Math.max(out[l] ?? 0, days);
  }
  return out;
}

/** The whole report. */
export function report(results) {
  const { worlds, exposure, arms, certs = {}, windows = null, ld = null, adv = null, redTeam = null, costs = {}, sDropped = false, m6 = null, records = {}, invalid = [] } = results;
  const worldsOf = s => worlds[s] ?? [];
  const exposureOf = s => k => exposure[s]?.of(k) ?? {};
  const exposureBy = s => Object.fromEntries((worlds[s] ?? []).map(w => [w.k, exposure[s]?.of(w.k) ?? {}]));
  const stat = arms['S-H*'] ?? {}, heal = arms['MH-H'] ?? {};
  const out = { label: 'PREREG-DUR-1 report (development evidence)', curves: {}, rules: {}, invalid };
  for (const [arm, byUnit] of Object.entries(arms)) {
    out.curves[arm] = {};
    for (const [u, byStream] of Object.entries(byUnit)) for (const [s, m] of Object.entries(byStream)) out.curves[arm][`${u}/${s}`] = curves(m).worlds.map(x => [x.k, x.pass, x.n]);
  }
  // K-0 on s1 (S-H*, the W-M0 view: m1-m3 with the analyst's R1 reading).
  const s1Static = Object.fromEntries(Object.entries(stat).filter(([, b]) => b.s1).map(([l, b]) => [l, b.s1]));
  const k0r = Object.keys(s1Static).length ? k0(s1Static) : null;
  out.rules.K0 = k0r ?? { verdict: 'NOT RUN' };
  // Cells and durability (heal-requiring: S-H* has an induced failure AND S-H* itself is not durable on the cell; review M4).
  const exOf = (s, k, c) => exposureOf(s)(k)?.[c];
  const onsetOf = (s, c) => onsetDay(worldsOf(s), c);
  const hr = Object.keys(stat).length ? healRequiringCellsStrict({ stat, exposureOf: exOf, onsetOf }) : { cells: [], any: [], staticRows: [] };
  const cells = hr.cells;
  const cellRows = Object.keys(heal).length ? cellDurability({ cells, armModel: heal, exposureOf: exOf, onsetOf, certifiedOf: Object.keys(certs).length ? certifiedOfCells(certs) : null }) : [];
  // D-1 and D-3 with Holm step-down.
  const critRegressions = critRegressionsOf(records['MH-H'], certs);
  const d1pre = Object.keys(heal).length ? d1({ heal, stat, exposure: exposureBy, cellRows, critRegressions, holmLevel: 1 }) : null;
  const pairs = windows?.pairs ?? [];
  // D-3's falsifier: the median MH-H TTD over the WINDOWED changes' cells, infinite cells included (review M2).
  const windowedTtds = cellRows.filter(r => WINDOWED.includes(r.change) && ['durable', 'not-durable'].includes(r.status)).map(r => r.ttd);
  const medTtdWindowed = windowedTtds.length ? median(windowedTtds) : Infinity;
  const d3pre = pairs.length ? d3({ pairs, medianTtd: medTtdWindowed, holmLevel: 1, sDropped }) : null;
  const levels = primaryLevels(d1pre?.p ?? 1, d3pre?.p ?? 1);
  const d1r = d1pre ? d1({ heal, stat, exposure: exposureBy, cellRows, critRegressions, holmLevel: levels.D1 }) : null;
  const d3r = d3pre ? d3({ pairs, medianTtd: medTtdWindowed, holmLevel: levels.D3, sDropped }) : null;
  out.rules.D1 = d1r ?? { verdict: 'NOT RUN' };
  out.rules.D3 = d3r ? { ...d3r, medianTtdWindowed: medTtdWindowed } : { verdict: 'NOT RUN' };
  out.rules.holm = levels;
  out.cells = { n: cells.length, withInducedFailure: hr.any.length, staticDurableOnThose: durableShare(hr.staticRows),
    rows: cellRows.map(r => ({ lineage: r.lineage, stream: r.stream, change: r.change, status: r.status, ttd: r.ttd, certified: r.certified })), share: durableShare(cellRows), certifiedShare: durableShare(cellRows, { certified: true }) };
  // D-2 cheap.
  const cellCosts = [];
  for (const cell of cells) {
    const m = heal[cell.lineage]?.[cell.stream];
    if (!m) continue;
    const sessionsUsd = (m.sessions ?? []).filter(s => (s.attributedChange ?? null) === cell.change).reduce((a, s) => a + (s.session?.costUsd ?? 0), 0);
    const share = costs.coUsd?.[cell.change] ? costs.coUsd[cell.change] / Math.max(1, cells.filter(c => c.change === cell.change).length) : 0;
    cellCosts.push(sessionsUsd + share);
  }
  const healMarginal = Object.entries(heal).flatMap(([l, b]) => Object.entries(b).map(([s, m]) => ({ lineage: l, stream: s, usd: m.usd })));
  out.rules.D2 = costs.agentProjected && Object.keys(heal).length ? d2({ cellCosts, healMarginal, agentProjected: costs.agentProjected }) : { verdict: 'NOT RUN', medianCellUsd: median(cellCosts) };
  // D-4: final week pooled over streams per lineage; TTD on s1 cells against REF-M's s1 cells (review M2, M3).
  const healFW = Object.fromEntries(Object.keys(heal).map(l => [l, finalWeekPooled(heal[l])]).filter(([, v]) => Number.isFinite(v)));
  const rm2 = finalWeekPooled(arms['R-maint2']?.ref);
  const rst = finalWeekPooled(arms['R-static']?.ref);
  const refm = arms['REF-M'] ? Object.fromEntries(Object.entries(arms['REF-M']).filter(([, b]) => b.s1).map(([u, b]) => [u, finalWeek(b.s1)])) : null;
  const healS1 = median(Object.keys(heal).filter(l => heal[l].s1).map(l => finalWeek(heal[l].s1)).filter(Number.isFinite));
  const s1Ttds = cellRows.filter(r => r.stream === 's1' && ['durable', 'not-durable'].includes(r.status)).map(r => r.ttd);
  let refmTtds = [];
  const refsStat = arms['REF-S'] ?? {}, refmArm = arms['REF-M'] ?? {};
  if (Object.keys(refmArm).length && Object.keys(refsStat).length) {
    const refCells = healRequiringCellsStrict({ stat: Object.fromEntries(Object.entries(refsStat).filter(([u]) => refmArm[u]).map(([u, b]) => [u, { s1: b.s1 }]).filter(([, b]) => b.s1)), exposureOf: exOf, onsetOf }).cells;
    const refRows = cellDurability({ cells: refCells, armModel: refmArm, exposureOf: exOf, onsetOf });
    out.refmCells = refRows.map(r => ({ solver: r.lineage, change: r.change, status: r.status, ttd: r.ttd }));
    refmTtds = refRows.filter(r => ['durable', 'not-durable'].includes(r.status)).map(r => r.ttd);
  }
  out.rules.D4 = Object.keys(heal).length && Number.isFinite(rm2) ? d4({ healFW, rmaint2FW: rm2, rstaticFW: rst, refmFW: refm && Object.keys(refm).length ? refm : null, healS1Median: Number.isFinite(healS1) ? healS1 : null,
    ttdHeal: s1Ttds.length ? median(s1Ttds) : null, ttdRefm: refmTtds.length ? median(refmTtds) : null }) : { verdict: 'NOT RUN' };
  out.finalWeek = { 'MH-H': healFW, 'R-maint2': rm2, 'R-static': rst, 'REF-M': refm };
  // D-5 worst case: units (lineage x world x class); silent critical outside the U1s carve-out.
  const units = [];
  // U1s carve-out (D-5 a; review M8): only U1s-INDUCED failing cases placed up to its first true complaint + 2 world-days are
  // its silent exposure; a case another change also breaks still counts in that change's class.
  const u1Recs = records?.['MH-H'] ?? {};
  const carveOf = (l, s, m) => {
    const rec = u1Recs[l]?.[s];
    const spec = worldsOf(s).find(w => w.changes.some(x => x.id === 'U1s' && x.startsHere));
    if (!rec || !spec) return () => false;
    const ex = exposureOf(s)(spec.k)?.U1s ?? new Set();
    const first = (rec.worlds.find(w => w.k === spec.k)?.complaints ?? []).filter(c => c.kind === 'true' && ex.has(c.case)).sort((a, b) => a.at - b.at)[0];
    const limit = first ? first.at + 2 * DAY_MS : Infinity;
    const induced = new Set(m.worlds?.[spec.k]?.induced?.U1s ?? []);
    return (k, c, v) => k === spec.k && induced.has(c) && (v?.placedAt ?? 0) <= limit;
  };
  const classOfFor = (s, m) => { const base = classOfCase(exposureOf(s), k => m.worlds?.[k]?.induced ?? {}); return (k, c) => base(k, c); };
  let unitsEvaluated = 0;
  for (const [l, b] of Object.entries(heal)) for (const [s, m] of Object.entries(b)) {
    unitsEvaluated += Object.values(m.worlds).filter(w => Object.values(w.cases).some(c => c.graded)).length;
    const cls = classOfFor(s, m), carve = carveOf(l, s, m);
    const classes = (k, c, v) => { const list = cls(k, c); if (!carve(k, c, v)) return list; const ind = m.worlds?.[k]?.induced ?? {}; const others = Object.entries(ind).filter(([ch, xs]) => ch !== 'U1s' && xs.includes(c)).map(([ch]) => CHANGES[ch].cls); return ['U1s-silent-exposure', ...new Set(others)]; };
    for (const row of silentLoud(m, VISIBLE.heal, classes)) {
      const carved = row.cls === 'U1s-silent-exposure';
      units.push({ lineage: l, world: `${s}/W${row.world}`, cls: row.cls, silentCritical: carved ? 0 : row.silentCritical, silentExposure: carved ? row.silentCritical : 0, silent: row.silent, failing: row.failing, n: row.n });
    }
  }
  const w1False = [];
  for (const [, b] of Object.entries(heal)) for (const [, m] of Object.entries(b)) {
    const pass = (k, c) => m.worlds[k]?.cases?.[c]?.pass ?? null;
    w1False.push(falseIncidents((m.incidents ?? []).filter(i => i.opened?.k === 1), (w, c) => pass(1, c)).length);
  }
  const routedSilent = pairs.length && pairs.every(p => p.healSilent !== undefined) ? (() => { const r = d3({ pairs: pairs.map(p => ({ ...p, heal: p.healSilent, agent: p.agentSilent })), medianTtd: 0 }); return { mean: r.mean, hi95: r.hi95 }; })() : null;
  const perClassWorst = Object.keys(heal).length ? perClassWorstOf({ heal, refm: arms['REF-M'] ?? null, refs: arms['REF-S'] ?? null, classOfFor }) : null;
  out.rules.D5 = Object.keys(heal).length ? d5({ units, adv, perClassWorst, routedSilent, w1FalseIncidents: Object.keys(heal).length ? w1False : null, unitsEvaluated }) : { verdict: 'NOT RUN' };
  out.rules.D5.perClassWorst = perClassWorst;
  // D-6 detection (unannounced), with and without complaints.
  out.rules.D6 = Object.keys(heal).length ? d6({ onsets: detectionOnsets(heal, worldsOf, exposureOf), w1FalseIncidents: w1False, m6 }) : { verdict: 'NOT RUN' };
  out.rules.D6noComplaints = Object.keys(heal).length ? d6({ onsets: detectionOnsets(heal, worldsOf, exposureOf, { channels: ['m1', 'm2', 'm3'] }), w1FalseIncidents: w1False }) : { verdict: 'NOT RUN' };
  // D-7 frontier (descriptive).
  out.rules.D7 = windows?.aox ? { verdict: windows.aox.healRate >= windows.aox.aoxRate - RULES.D7.margin && windows.aox.healUsdPerCase <= RULES.D7.costShare * windows.aox.aoxUsdPerCase ? 'MATCHES OPUS PER TICK AT <= 1/20 COST (descriptive)' : 'NOT SHOWN (descriptive)', ...windows.aox } : { verdict: 'NOT RUN' };
  // D-8 LD-H.
  out.rules.D8 = ld?.length ? d8Rule(ld.map(a => ({ defect: a.id, healed: a.healed, durable: a.durable, regressions: a.regressions, falseComplaintHarm: a.falseComplaintHarm > 0 }))) : { verdict: 'NOT RUN' };
  // D-9 stale verifier (descriptive).
  const stale = arms['MH-stale'] ?? null;
  out.rules.D9 = stale ? { verdict: 'descriptive', perLineage: Object.fromEntries(Object.entries(stale).filter(([, b]) => b.s1).map(([l, b]) => [l, { stale: exposedPass(b.s1, exposureBy('s1')).rate, heal: heal[l]?.s1 ? exposedPass(heal[l].s1, exposureBy('s1')).rate : null }])) } : { verdict: 'NOT RUN' };
  // D-10 the unknown.
  const e2sCells = cellRows.filter(r => r.change === 'E2s');
  const u1 = records?.['MH-H'] ? u1sLoud(records['MH-H'], exposureOf, worldsOf) : [];
  out.rules.D10 = Object.keys(heal).length ? { ...d10({ e2sCells, u1sLoud: u1 }), u1s: u1 } : { verdict: 'NOT RUN' };
  // D-11 red team.
  out.rules.D11 = redTeam?.length ? d11(redTeam) : { verdict: 'NOT RUN' };
  // Root-cause scaffold (Q7): failing classes per arm and unhealed cells.
  const failing = [];
  for (const [arm, byUnit] of Object.entries(arms)) {
    const by = new Map();
    for (const [, b] of Object.entries(byUnit)) for (const [s, m] of Object.entries(b)) {
      const cls = classOfFor(s, m);
      for (const [k, w] of Object.entries(m.worlds)) for (const [c, v] of Object.entries(w.cases)) {
        if (v.pass) continue;
        for (const cc of cls(Number(k), c)) {
          const key = `${v.class ?? '?'}|${cc}`;
          if (!by.has(key)) by.set(key, { rule: v.class, changeClass: cc, n: 0, silent: false, examples: [] });
          const e = by.get(key); e.n += 1; if (e.examples.length < 3) e.examples.push(`${s}/W${k}/${c}`);
        }
      }
    }
    failing.push(...[...by.values()].map(f => ({ ...f, arm })));
  }
  const unhealed = cellRows.filter(r => r.status !== 'durable').map(r => ({ change: r.change, lineage: r.lineage, stream: r.stream, reason: r.status === 'not-durable' ? 'not durable' : r.status }));
  const rc = rootCauseScaffold({ arm: 'all', failing, unhealed });
  out.rootCause = { records: rc.records.length, complete: rc.complete, sample: rc.records.slice(0, 12) };
  out.owner = ownerTable({ k0r, d1r, d3r, d2r: out.rules.D2, d4r: out.rules.D4, d5r: out.rules.D5, d6r: out.rules.D6, d8r: out.rules.D8, d10r: out.rules.D10, rc });
  return out;
}

/** Text rendering: the owner table first, then the rule lines. */
export function renderReport(r) {
  const lines = ['# DUR-1 report (development evidence; owner table first)', ''];
  for (const row of r.owner) lines.push(`- ${row.q} [${row.rule}]: ${row.verdict}`);
  lines.push('', '## Rules');
  for (const [k, v] of Object.entries(r.rules)) if (k !== 'holm') lines.push(`- ${k}: ${v.verdict ?? JSON.stringify(v).slice(0, 120)}${v.p !== undefined ? ` (p ${Number(v.p).toFixed(4)})` : ''}`);
  lines.push('', `Cells: ${r.cells.n} heal-requiring; durable ${r.cells.share.durable}/${r.cells.share.judged}; certified-durable ${r.cells.certifiedShare.durable}/${r.cells.certifiedShare.judged}`);
  lines.push(`Root-cause ledger: ${r.rootCause.records} records (${r.rootCause.complete ? 'every record categorised' : 'INCOMPLETE'}; analyst review pending)`);
  return lines.join('\n');
}

export { ttd, sday };
