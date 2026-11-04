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
import { onsetDay, certifiedOfCells } from './model.mjs';
import { CHANGES, CHANGE_IDS, UNANNOUNCED, T0_MS, DAY_MS } from './schedule.mjs';

const median = xs => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sday = (k, ms) => 14 * (k - 1) + Math.floor((ms - T0_MS) / DAY_MS) + 1;

/** The scenario class of a case (§8.1): the class of the first scheduled change it is exposed to, else IP. */
export function classOfCase(exposureK) {
  return (k, c) => {
    if (c === null) return null;
    for (const id of CHANGE_IDS) if (exposureK(k)?.[id]?.has(c)) return CHANGES[id].cls;
    return 'IP';
  };
}

/** Final-week success (cases placed W6 d8-d14) of one model. */
export function finalWeek(model) {
  const w = model.worlds[6];
  if (!w) return NaN;
  const lo = T0_MS + 7 * DAY_MS;
  const xs = Object.values(w.cases).filter(c => c.graded && c.placedAt >= lo);
  return xs.length ? xs.filter(c => c.pass).length / xs.length : NaN;
}

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

/** The whole report. */
export function report(results) {
  const { worlds, exposure, arms, certs = {}, windows = null, ld = null, adv = null, redTeam = null, costs = {}, sDropped = false, m6 = null, records = {} } = results;
  const worldsOf = s => worlds[s] ?? [];
  const exposureOf = s => k => exposure[s]?.of(k) ?? {};
  const exposureBy = s => Object.fromEntries((worlds[s] ?? []).map(w => [w.k, exposure[s]?.of(w.k) ?? {}]));
  const stat = arms['S-H*'] ?? {}, heal = arms['MH-H'] ?? {};
  const out = { label: 'PREREG-DUR-1 report (development evidence)', curves: {}, rules: {} };
  for (const [arm, byUnit] of Object.entries(arms)) {
    out.curves[arm] = {};
    for (const [u, byStream] of Object.entries(byUnit)) for (const [s, m] of Object.entries(byStream)) out.curves[arm][`${u}/${s}`] = curves(m).worlds.map(x => [x.k, x.pass, x.n]);
  }
  // K-0 on s1 (S-H*, the W-M0 view: m1-m3 with the analyst's R1 reading).
  const s1Static = Object.fromEntries(Object.entries(stat).filter(([, b]) => b.s1).map(([l, b]) => [l, b.s1]));
  const k0r = Object.keys(s1Static).length ? k0(s1Static) : null;
  out.rules.K0 = k0r ?? { verdict: 'NOT RUN' };
  // Cells and durability.
  const cells = healRequiringCells(stat);
  const cellRows = Object.keys(heal).length ? cellDurability({ cells, armModel: heal, exposureOf: (s, k, c) => exposureOf(s)(k)?.[c], onsetOf: (s, c) => onsetDay(worldsOf(s), c),
    certifiedOf: Object.keys(certs).length ? certifiedOfCells(certs) : null }) : [];
  // D-1 and D-3 with Holm.
  const d1pre = Object.keys(heal).length ? d1({ heal, stat, exposure: exposureBy, cellRows, holmLevel: 1 }) : null;
  const pairs = windows?.pairs ?? [];
  const ttds = cellRows.filter(r => Number.isFinite(r.ttd)).map(r => r.ttd);
  const medTtd = ttds.length ? median(ttds) : Infinity;
  const d3pre = pairs.length ? d3({ pairs, medianTtd: medTtd, holmLevel: 1, sDropped }) : null;
  const levels = primaryLevels(d1pre?.p ?? 1, d3pre?.p ?? 1);
  const d1r = d1pre ? d1({ heal, stat, exposure: exposureBy, cellRows, holmLevel: levels.D1 }) : null;
  const d3r = d3pre ? d3({ pairs, medianTtd: medTtd, holmLevel: levels.D3, sDropped }) : null;
  out.rules.D1 = d1r ?? { verdict: 'NOT RUN' };
  out.rules.D3 = d3r ?? { verdict: 'NOT RUN' };
  out.rules.holm = levels;
  out.cells = { n: cells.length, rows: cellRows.map(r => ({ lineage: r.lineage, stream: r.stream, change: r.change, status: r.status, ttd: r.ttd, certified: r.certified })), share: durableShare(cellRows), certifiedShare: durableShare(cellRows, { certified: true }) };
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
  // D-4.
  const fw = (arm, u, s) => (arms[arm]?.[u]?.[s] ? finalWeek(arms[arm][u][s]) : NaN);
  const healFW = Object.fromEntries(Object.keys(heal).map(l => [l, median(Object.keys(heal[l]).map(s => fw('MH-H', l, s)).filter(Number.isFinite))]));
  const rm2 = median(Object.keys(arms['R-maint2']?.ref ?? {}).map(s => fw('R-maint2', 'ref', s)).filter(Number.isFinite));
  const rst = median(Object.keys(arms['R-static']?.ref ?? {}).map(s => fw('R-static', 'ref', s)).filter(Number.isFinite));
  const refm = arms['REF-M'] ? Object.fromEntries(Object.entries(arms['REF-M']).filter(([, b]) => b.s1).map(([u, b]) => [u, finalWeek(b.s1)])) : null;
  const healS1 = median(Object.keys(heal).filter(l => heal[l].s1).map(l => fw('MH-H', l, 's1')).filter(Number.isFinite));
  out.rules.D4 = Object.keys(heal).length && Number.isFinite(rm2) ? d4({ healFW, rmaint2FW: rm2, rstaticFW: rst, refmFW: refm && Object.keys(refm).length ? refm : null, healS1Median: Number.isFinite(healS1) ? healS1 : null,
    ttdHeal: ttds.length ? median(ttds) : null, ttdRefm: results.refmTtd ?? null }) : { verdict: 'NOT RUN' };
  out.finalWeek = { 'MH-H': healFW, 'R-maint2': rm2, 'R-static': rst, 'REF-M': refm };
  // D-5 worst case: units (lineage x world x class), silent critical outside the U1s carve-out.
  const units = [];
  // U1s carve-out (D-5 a): U1s is silent by design until the world complains, so its exposed cases placed before its first
  // true complaint + 2 world-days form their own class, 'U1s-silent-exposure', reported and not counted against (a).
  const u1Recs = results.records?.['MH-H'] ?? {};
  const carveOf = (l, s) => {
    const rec = u1Recs[l]?.[s];
    const spec = worldsOf(s).find(w => w.changes.some(x => x.id === 'U1s' && x.startsHere));
    if (!rec || !spec) return () => false;
    const ex = exposureOf(s)(spec.k)?.U1s ?? new Set();
    const first = (rec.worlds.find(w => w.k === spec.k)?.complaints ?? []).filter(c => c.kind === 'true' && ex.has(c.case)).sort((a, b) => a.at - b.at)[0];
    const limit = first ? first.at + 2 * DAY_MS : Infinity;
    return (k, c, v) => k === spec.k && ex.has(c) && (v?.placedAt ?? 0) <= limit;
  };
  for (const [l, b] of Object.entries(heal)) for (const [s, m] of Object.entries(b)) {
    const cls = classOfCase(exposureOf(s)), carve = carveOf(l, s);
    for (const row of silentLoud(m, VISIBLE.heal, (k, c, v) => (carve(k, c, v) ? 'U1s-silent-exposure' : cls(k, c) ?? 'IP'))) {
      units.push({ lineage: l, world: `${s}/W${row.world}`, cls: row.cls, silentCritical: row.cls === 'U1s-silent-exposure' ? 0 : row.silentCritical, silentExposure: row.cls === 'U1s-silent-exposure' ? row.silentCritical : 0, silent: row.silent, failing: row.failing });
    }
  }
  const w1False = [];
  for (const [l, b] of Object.entries(heal)) for (const [s, m] of Object.entries(b)) {
    const pass = (k, c) => m.worlds[k]?.cases?.[c]?.pass ?? null;
    w1False.push(falseIncidents((m.incidents ?? []).filter(i => i.opened?.k === 1), (w, c) => pass(1, c)).length);
  }
  const routedSilent = pairs.length && pairs.every(p => p.healSilent !== undefined) ? (() => { const r = d3({ pairs: pairs.map(p => ({ ...p, heal: p.healSilent, agent: p.agentSilent })), medianTtd: 0 }); return { mean: r.mean, hi95: r.hi95 }; })() : null;
  out.rules.D5 = Object.keys(heal).length ? d5({ units, adv, perClassWorst: results.perClassWorst ?? [], routedSilent, w1FalseIncidents: w1False }) : { verdict: 'NOT RUN' };
  // D-6 detection (unannounced), with and without complaints.
  out.rules.D6 = Object.keys(heal).length ? d6({ onsets: detectionOnsets(heal, worldsOf, exposureOf), w1FalseIncidents: w1False, m6 }) : { verdict: 'NOT RUN' };
  out.rules.D6noComplaints = Object.keys(heal).length ? d6({ onsets: detectionOnsets(heal, worldsOf, exposureOf, { channels: ['m1', 'm2', 'm3'] }), w1FalseIncidents: w1False }) : { verdict: 'NOT RUN' };
  // D-7 frontier (descriptive).
  out.rules.D7 = windows?.aox ? { verdict: windows.aox.healRate >= windows.aox.aoxRate - RULES.D7.margin && windows.aox.healUsdPerCase <= RULES.D7.costShare * windows.aox.aoxUsdPerCase ? 'MATCHES OPUS PER TICK AT <= 1/20 COST (descriptive)' : 'NOT SHOWN (descriptive)', ...windows.aox } : { verdict: 'NOT RUN' };
  // D-8 LD-H.
  out.rules.D8 = ld?.length ? d8Rule(ld.map(a => ({ defect: a.id, healed: a.healed, durable: a.durable, regressions: a.regressions, falseComplaintHarm: a.falseComplaintHarm > 0 }))) : { verdict: 'NOT RUN' };
  // D-9 stale verifier (descriptive).
  const stale = arms['MH-stale'] ?? null;
  out.rules.D9 = stale ? { verdict: 'descriptive', perLineage: Object.fromEntries(Object.entries(stale).map(([l, b]) => [l, { stale: exposedPass(b.s1, exposureBy('s1')).rate, heal: heal[l]?.s1 ? exposedPass(heal[l].s1, exposureBy('s1')).rate : null }])) } : { verdict: 'NOT RUN' };
  // D-10 the unknown.
  const e2sCells = cellRows.filter(r => r.change === 'E2s');
  const u1 = results.records?.['MH-H'] ? u1sLoud(results.records['MH-H'], exposureOf, worldsOf) : [];
  out.rules.D10 = Object.keys(heal).length ? { ...d10({ e2sCells, u1sLoud: u1 }), u1s: u1 } : { verdict: 'NOT RUN' };
  // D-11 red team.
  out.rules.D11 = redTeam?.length ? d11(redTeam) : { verdict: 'NOT RUN' };
  // Root-cause scaffold (Q7): failing classes per arm and unhealed cells.
  const failing = [];
  for (const [arm, byUnit] of Object.entries(arms)) {
    const by = new Map();
    for (const [, b] of Object.entries(byUnit)) for (const [s, m] of Object.entries(b)) {
      const cls = classOfCase(exposureOf(s));
      for (const [k, w] of Object.entries(m.worlds)) for (const [c, v] of Object.entries(w.cases)) {
        if (v.pass) continue;
        const key = `${v.class ?? '?'}|${cls(Number(k), c)}`;
        if (!by.has(key)) by.set(key, { rule: v.class, changeClass: cls(Number(k), c), n: 0, silent: false, examples: [] });
        const e = by.get(key); e.n += 1; if (e.examples.length < 3) e.examples.push(`${s}/W${k}/${c}`);
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
