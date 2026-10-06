// Hidden truth for the `kinetics` bed: conditions with Michaelis-Menten (and, at d4+,
// competitive-inhibition) parameters, the well layout, noisy initial rates, which wells the SOP
// excludes, decoy notes, re-reads and the mislabel/units traps. Pure function of the seed.
//
// Noise is rejection-sampled per condition so that an unweighted NLLS fit of the correctly
// cleaned data lands within MARGIN of the generating parameters (oracle tolerance is TOL), and
// traps are chosen so that ignoring each one pushes the affected fit outside TOL.
import { rng } from '../lib/rng.mjs';
import { fitMM, fitMMMeans, relErr } from './fit.mjs';
import { ENZYMES, SUBSTRATES, INHIBITORS, PEOPLE, PIS, READERS, BENCH_CODES, OUTLIER_NOTES } from './pools.mjs';

export const VERSION = '2.0.0';
export const TOL = 0.10;          // oracle tolerance (relative) on Vmax and Km
export const MARGIN = 0.05;       // generation-time bound for the reference fit
export const MEANS_MARGIN = 0.08; // generation-time bound for a fit on replicate means

const ALL_FORMATS = ['mdtable', 'csv', 'prose', 'grouped', 'reader', 'semicolon'];
export const KNOBS = {
  1: { silent: [0, 0], late: 0, lateDecoys: 0, misattributed: 0, tricky: 0, deviant: 1, claims: ['swap'], viaClaim: 0, nBase: 2, nInhib: 0, nConc: 6, reps: [2, 2], cv: 0.025, techDocs: 2, formats: ALL_FORMATS.slice(0, 2), outliers: [1, 2], decoys: [1, 2],
    decoyKinds: ['bubble-cleared', 'low'], rereads: [0, 0], corrections: ['swap'], pilot: false, chat: false, injections: 0, tempRule: false,
    absorbance: 'none', concUnits: ['uM', 'mM'], rateUnits: ['uM/s', 'uM/min'], numStyles: ['plain'], aliasStyles: ['id', 'phT'], unitPlacement: ['header'], filler: [1, 2], blanks: 0, rawExport: null },
  2: { silent: [0, 0], late: 0, lateDecoys: 0, misattributed: 0, tricky: 0.3, deviant: 1, claims: ['units'], viaClaim: 0, nBase: 3, nInhib: 0, nConc: 7, reps: [3, 3], cv: 0.03, techDocs: 3, formats: ALL_FORMATS.slice(0, 3), outliers: [2, 3], decoys: [2, 3],
    decoyKinds: ['bubble-cleared', 'low', 'edge', 'looks', 'neg-bubble'], rereads: [0, 0], corrections: ['units'], pilot: false, chat: false, injections: 0, tempRule: false,
    absorbance: 'none', concUnits: ['uM', 'mM'], rateUnits: ['uM/s', 'uM/min', 'nM/s'], numStyles: ['plain', 'e'], aliasStyles: ['id', 'phT', 'TpH'], unitPlacement: ['header'], filler: [2, 4], blanks: 0.2, rawExport: null },
  3: { silent: [1, 1], late: 1, lateDecoys: 1, misattributed: 0, tricky: 0.5, deviant: 1, claims: ['reassign'], viaClaim: 0.5, nBase: 5, nInhib: 0, nConc: 10, reps: [3, 4], cv: 0.035, techDocs: 5, formats: ALL_FORMATS.slice(0, 4), outliers: [4, 5], decoys: [3, 4],
    decoyKinds: ['bubble-cleared', 'low', 'edge', 'looks', 'bubble-after', 'neg-bubble', 'neg-sat', 'neg-pipette'], rereads: [0, 0], corrections: ['reassign', 'units'], pilot: true, chat: true, injections: 0, tempRule: false,
    absorbance: 'none', concUnits: ['uM', 'mM', 'nM'], rateUnits: ['uM/s', 'uM/min', 'nM/s', 'nM/min'], numStyles: ['plain', 'e', 'E'], aliasStyles: ['phT', 'TpH', 'id'], unitPlacement: ['header', 'preamble'], filler: [7, 11], blanks: 0.3, rawExport: { series: 3, typos: 1 } },
  4: { silent: [1, 2], late: 1, lateDecoys: 1, misattributed: 1, tricky: 0.5, deviant: 2, claims: ['reassign', 'swap'], viaClaim: 0.5, nBase: 5, nInhib: 2, nConc: 9, reps: [3, 4], cv: 0.04, techDocs: 6, formats: ALL_FORMATS.slice(0, 5), outliers: [6, 8], decoys: [5, 6],
    decoyKinds: ['bubble-cleared', 'low', 'edge', 'looks', 'bubble-after', 'temp-minor', 'recheck', 'neg-bubble', 'neg-sat', 'neg-pipette'], rereads: [1, 2], corrections: ['reassign', 'swap', 'units'], pilot: true, chat: true, injections: 2, tempRule: true,
    absorbance: 'factor', concUnits: ['uM', 'mM', 'nM'], rateUnits: ['uM/s', 'uM/min', 'nM/s', 'nM/min', 'mM/min'], numStyles: ['plain', 'e', 'E', 'x10'], aliasStyles: ['phT', 'TpH', 'id'], unitPlacement: ['header', 'preamble'], filler: [6, 10], blanks: 0.35, rawExport: { series: 4, typos: 1 } },
  5: { silent: [2, 2], late: 2, lateDecoys: 1, misattributed: 1, tricky: 0.6, deviant: 2, claims: ['reassign', 'units', 'swap'], viaClaim: 0.5, nBase: 5, nInhib: 3, nConc: 10, reps: [3, 4], cv: 0.04, techDocs: 7, formats: ALL_FORMATS, outliers: [8, 11], decoys: [7, 9],
    decoyKinds: ['bubble-cleared', 'low', 'edge', 'looks', 'bubble-after', 'temp-minor', 'recheck', 'neg-bubble', 'neg-sat', 'neg-pipette'], rereads: [2, 3], corrections: ['reassign', 'omitted-inhibitor', 'swap', 'units', 'retracted'], pilot: true, chat: true, injections: 3, tempRule: true,
    absorbance: 'epsilon', concUnits: ['uM', 'mM', 'nM'], rateUnits: ['uM/s', 'uM/min', 'nM/s', 'nM/min', 'mM/min'], numStyles: ['plain', 'e', 'E', 'x10'], aliasStyles: ['phT', 'TpH', 'kelvin', 'bench', 'id'], unitPlacement: ['header', 'preamble'], filler: [8, 12], blanks: 0.4, rawExport: { series: 5, typos: 2 }, superseded: true },
};

const PHS = [5.5, 6.0, 6.5, 7.0, 7.4, 8.0, 8.5, 9.0];
const TEMPS = [20, 25, 30, 37, 42];
const NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
const round3 = x => Number(x.toPrecision(3));
function niceUp(x, minExclusive) {
  // smallest "nice" number >= x (log-nearest), strictly greater than minExclusive
  const e = Math.floor(Math.log10(x));
  const cands = [];
  for (const k of [e - 1, e, e + 1, e + 2]) for (const n of NICE) cands.push(round3(n * 10 ** k));
  cands.sort((a, b) => a - b);
  let best = null, bd = Infinity;
  for (const c of cands) { if (c <= minExclusive) continue; const d = Math.abs(Math.log(c / x)); if (d < bd) { bd = d; best = c; } }
  return best;
}
const rd = (a, b) => Math.abs(a - b) / Math.min(a, b);
const logU = (r, lo, hi) => Math.exp(r.float(Math.log(lo), Math.log(hi)));
const fails = (fit, c) => !(relErr(fit.vmax, c.vmax) <= TOL && relErr(fit.km, c.km) <= TOL);

function makeConditions(r, k) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const combos = [];
    for (const pH of PHS) for (const T of TEMPS) combos.push({ pH, T });
    const picked = r.sample(combos, k.nBase);
    const Km0 = logU(r, 8, 600), V0 = logU(r, 0.05, 4);
    const conds = picked.map(({ pH, T }) => ({ pH, tempC: T, inhibitor: null, parent: null, vmax: V0 * r.float(0.5, 1.8), km: Km0 * r.float(0.5, 2.5) }));
    if (k.nInhib) {
      const parents = r.sample(conds, Math.min(k.nInhib, 2));
      const plan = k.nInhib === 3 ? [[parents[0], r.float(1.8, 2.6)], [parents[0], r.float(4.0, 5.5)], [parents[1], r.float(2.0, 4.5)]]
        : parents.map(p => [p, r.float(2.0, 4.5)]);
      for (const [p, ratio] of plan) {
        const Ki = niceUp(logU(r, 2, 80), 0);
        const I = niceUp(Ki * ratio, 0);
        conds.push({ pH: p.pH, tempC: p.tempC, inhibitor: { uM: I, Ki }, parent: p, vmax: p.vmax, km: p.km * (1 + I / Ki) });
      }
    }
    let ok = true;
    for (let i = 0; i < conds.length && ok; i++) for (let j = i + 1; j < conds.length; j++) {
      if (Math.max(rd(conds[i].vmax, conds[j].vmax), rd(conds[i].km, conds[j].km)) < 0.3) { ok = false; break; }
    }
    // two inhibitor concentrations on one parent must differ in the reported concentration
    if (ok) return conds;
  }
  throw new Error('kinetics: could not draw distinct conditions');
}

function makeGrid(r, km, n) {
  const lo = 0.15 * km * r.float(0.8, 1.25), hi = 6 * km * r.float(0.85, 1.25);
  const out = [];
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const x = lo * (hi / lo) ** (i / (n - 1));
    const v = niceUp(x, prev);
    out.push(v); prev = v;
  }
  return out;
}

function weightedPick(r, items, weightFn) {
  const ws = items.map(weightFn), tot = ws.reduce((a, b) => a + b, 0);
  let x = r.next() * tot;
  for (let i = 0; i < items.length; i++) { if ((x -= ws[i]) < 0) return items[i]; }
  return items[items.length - 1];
}

const sw0 = s => s.wells.length;
const cleanPoints = (wells, useRate = 'rateTrue') => wells.filter(w => w.status !== 'outlier').map(w => ({ S: w.S, v: w[useRate] }));

export function buildWorld({ seed, split, difficulty }) {
  const k = KNOBS[difficulty];
  if (!k) throw new Error(`kinetics: difficulty must be 1..5 (got ${difficulty})`);
  const r = rng('kinetics', VERSION, split, seed, difficulty);
  const meta = (() => {
    const mr = r.fork('meta');
    const enzyme = mr.pick(ENZYMES);
    const people = mr.sample(PEOPLE, k.techDocs + 3);
    return {
      enzyme, prefix: enzyme.code, substrate: mr.pick(SUBSTRATES), inhibitor: mr.pick(INHIBITORS), pi: mr.pick(PIS),
      reader: mr.pick(READERS), altReader: null, techs: people.slice(0, k.techDocs), extras: people.slice(k.techDocs),
      studyCode: `${enzyme.code}-K${mr.int(10, 99)}`, sopCode: `SOP-${enzyme.code}-${mr.int(10, 49)}`, sopRev: mr.int(3, 7),
      startDay: mr.int(0, 300), lot: `${mr.int(7100, 7999)}-${mr.pick(['A', 'B', 'C', 'D'])}`, pilotLot: `${mr.int(6100, 6999)}-${mr.pick(['A', 'B'])}`,
    };
  })();

  // ---- conditions -------------------------------------------------------------------------
  const cr = r.fork('conditions');
  let conds = makeConditions(cr, k);
  conds = cr.shuffle(conds);
  conds.forEach((c, i) => { c.id = `C${i + 1}`; });
  for (const c of conds) { c.parentId = c.parent ? c.parent.id : null; delete c.parent; }
  const byId = Object.fromEntries(conds.map(c => [c.id, c]));
  for (const c of conds) { c.grid = c.parentId ? null : makeGrid(cr, c.km, k.nConc); }
  for (const c of conds) { if (c.parentId) c.grid = byId[c.parentId].grid; c.reps = cr.int(k.reps[0], k.reps[1]); }
  for (const c of conds) c.hasInhibitedSibling = conds.some(o => o.parentId === c.id);

  // ---- series, sample ids, plate positions -------------------------------------------------
  const lr = r.fork('layout');
  const series = [];
  for (const c of conds) for (let rep = 1; rep <= c.reps; rep++) series.push({ key: `${c.id}:r${rep}`, condId: c.id, labelCondId: c.id, rep, displayRep: rep, wells: [] });
  const order = lr.shuffle(series);
  let cursor = lr.int(100, 600);
  let plate = lr.int(1, 4), row = 0;
  const wells = [];
  for (const s of order) {
    const c = byId[s.condId];
    s.plate = plate; s.row = 'ABCDEFGH'[row]; s.col0 = lr.int(1, 12 - c.grid.length + 1);
    c.grid.forEach((S, idx) => {
      const w = { id: `${meta.prefix}-${String(cursor + idx).padStart(4, '0')}`, condId: c.id, series: s.key, rep: s.rep, idx, S,
        pos: `${s.row}${String(s.col0 + idx).padStart(2, '0')}`, plate: s.plate, status: 'none' };
      s.wells.push(w.id); wells.push(w);
    });
    cursor += c.grid.length + lr.int(0, 14);
    row++; if (row >= 8 || lr.chance(0.3)) { row = 0; plate++; }
  }
  const wellById = Object.fromEntries(wells.map(w => [w.id, w]));
  const seriesByKey = Object.fromEntries(series.map(s => [s.key, s]));

  // ---- statuses: SOP exclusions, decoys, re-reads -----------------------------------------
  const sr = r.fork('status');
  const nOut = sr.int(k.outliers[0], k.outliers[1]);
  const reasons = ['sat', 'bubble', 'pipette', ...(k.tempRule ? ['temp'] : [])];
  let reasonCycle = sr.shuffle(reasons);
  const perCond = {}, perSeries = {};
  for (let i = 0; i < nOut; i++) {
    const free = wells.filter(w => w.status === 'none' && (perCond[w.condId] ?? 0) < 2 && !perSeries[w.series]);
    if (!free.length) break;
    const n = k.nConc;
    const w = weightedPick(sr, free, x => (x.idx >= n - 3 ? 3 : 1));
    if (!reasonCycle.length) reasonCycle = sr.shuffle(reasons);
    w.status = 'outlier'; w.reason = reasonCycle.pop();
    if (w.reason === 'pipette') w.variant = sr.int(0, OUTLIER_NOTES.pipette.variants.length - 1);
    perCond[w.condId] = (perCond[w.condId] ?? 0) + 1; perSeries[w.series] = true;
  }
  // a note written on the wrong row: X carries the bubble note, a later message moves it to the neighbour Y
  for (let i = 0; i < k.misattributed; i++) {
    const cands = [];
    for (const y of wells.filter(x => x.status === 'outlier' && x.reason === 'bubble' && !x.late)) {
      for (const id of [-1, 1].map(dx => seriesByKey[y.series].wells[y.idx + dx])) if (id && wellById[id].status === 'none') cands.push([y, wellById[id]]);
    }
    if (!cands.length) {
      // promote a free well next to a free neighbour into a bubble exclusion so the trap always exists
      const pool = wells.filter(w => w.status === 'none' && !perSeries[w.series] && (perCond[w.condId] ?? 0) < 2);
      for (const y of sr.shuffle(pool)) {
        const id = seriesByKey[y.series].wells[y.idx + 1] ?? seriesByKey[y.series].wells[y.idx - 1];
        if (wellById[id].status !== 'none') continue;
        y.status = 'outlier'; y.reason = 'bubble'; perCond[y.condId] = (perCond[y.condId] ?? 0) + 1; perSeries[y.series] = true;
        cands.push([y, wellById[id]]); break;
      }
    }
    const [y, x] = sr.pick(cands);
    y.late = 'misattributed'; y.noteFrom = x.id;
    x.status = 'decoy'; x.kind = 'misattributed'; x.noteFor = y.id;
  }
  const outs = wells.filter(w => w.status === 'outlier');
  // exclusion facts reported only in a later message (chat or addendum), not in the well's row
  for (const w of sr.shuffle(outs.filter(x => ['bubble', 'pipette'].includes(x.reason) && !x.late)).slice(0, k.late)) w.late = 'fact';
  // silent exclusions: the rate reads normally, only the note marks the well (defeats residual-based exclusion)
  const nSilent = sr.int(k.silent[0], k.silent[1]);
  for (const w of sr.shuffle(outs.filter(x => x.reason !== 'temp' && !x.late)).slice(0, nSilent)) w.silent = true;
  // phrasing that points the other way ("popped ... after the read; it had been there throughout")
  for (const w of outs) if (['bubble', 'sat'].includes(w.reason) && !w.late && sr.chance(k.tricky)) w.tricky = true;
  const nDec = sr.int(k.decoys[0], k.decoys[1]);
  let kindCycle = sr.shuffle(k.decoyKinds);
  const DEVIANT_KINDS = ['looks', 'low', 'edge'].filter(x => k.decoyKinds.includes(x));
  for (let i = 0; i < nDec; i++) {
    const free = wells.filter(w => w.status === 'none');
    const w = sr.pick(free);
    if (!kindCycle.length) kindCycle = sr.shuffle(k.decoyKinds);
    w.status = 'decoy';
    if (i < k.deviant) {
      // kept wells whose value really is off (a technician's doubt, a LOW flag): residual-based exclusion fails
      w.kind = sr.pick(DEVIANT_KINDS); kindCycle = kindCycle.filter((x, j) => j !== kindCycle.indexOf(w.kind));
      w.dev = sr.chance(0.5) ? sr.float(1.25, 1.35) : sr.float(0.68, 0.76);
    } else w.kind = kindCycle.pop();
  }
  for (let i = 0; i < k.lateDecoys; i++) {
    const w = sr.pick(wells.filter(x => x.status === 'none'));
    w.status = 'decoy'; w.kind = 'late-cleared';
  }
  const nRe = sr.int(k.rereads[0], k.rereads[1]);
  for (let i = 0; i < nRe; i++) {
    const free = wells.filter(w => w.status === 'none' && w.idx >= 2);
    const w = sr.pick(free);
    w.status = 'reread'; w.kind = i % 2 === 0 ? 'sat-reread' : 'condensation';
  }

  // ---- noise (rejection-sampled per condition) ---------------------------------------------
  const nr = r.fork('noise');
  const ordered = [...conds.filter(c => !c.parentId), ...conds.filter(c => c.parentId)];
  for (const c of ordered) {
    const cw = wells.filter(w => w.condId === c.id);
    const parent = c.parentId ? byId[c.parentId] : null;
    let accepted = false, best = null;
    for (let attempt = 0; attempt < 600 && !accepted; attempt++) {
      const ar = nr.fork(`${c.id}:${attempt}`);
      const draws = cw.map(w => c.vmax * w.S / (c.km + w.S) * (1 + k.cv * ar.normal()) * (w.dev ?? 1));
      cw.forEach((w, i) => { w.rateTrue = draws[i]; });
      const pts = cleanPoints(cw);
      const fit = fitMM(pts, { fixedV: parent ? parent.refFit.vmax : null });
      const mfit = fitMMMeans(pts, { fixedV: parent ? parent.meansFit.vmax : null });
      const err = Math.max(relErr(fit.vmax, c.vmax), relErr(fit.km, c.km));
      const merr = Math.max(relErr(mfit.vmax, c.vmax), relErr(mfit.km, c.km));
      if (!best || err < best.err) best = { err, draws, fit, mfit };
      if (err <= MARGIN && merr <= MEANS_MARGIN) { accepted = true; c.refFit = fit; c.meansFit = mfit; c.noiseAttempts = attempt + 1; }
    }
    if (!accepted) { cw.forEach((w, i) => { w.rateTrue = best.draws[i]; }); c.refFit = best.fit; c.meansFit = best.mfit; c.noiseAttempts = -1; }
  }
  for (const w of wells) w.rate = w.rateTrue;

  // ---- distort SOP-excluded wells (soft-enforce that keeping them breaks the fit) ----------
  const dr = r.fork('distort');
  for (const c of conds) {
    const cw = wells.filter(w => w.condId === c.id);
    const outs = cw.filter(w => w.status === 'outlier');
    if (!outs.length) continue;
    const parent = c.parentId ? byId[c.parentId] : null;
    for (let t = 0; t < 16; t++) {
      const tr = dr.fork(`${c.id}:${t}`);
      for (const w of outs) {
        let ranges;
        if (w.reason === 'pipette') ranges = OUTLIER_NOTES.pipette.variants[w.variant].factors;
        else if (w.reason === 'temp') ranges = [[0.5, 0.7], [1.4, 1.7]];
        else ranges = OUTLIER_NOTES[w.reason].factors;
        const [lo, hi] = tr.pick(ranges);
        w.factor = w.silent ? 1 : tr.float(lo, hi);
        w.rate = w.rateTrue * w.factor;
      }
      const fit = fitMM(cw.map(w => ({ S: w.S, v: w.rate })), { fixedV: parent ? parent.refFit.vmax : null });
      c.outlierLoadBearing = fails(fit, c);
      if (c.outlierLoadBearing) break;
    }
  }
  // temperatures logged per well (used by the temp rule at d4+)
  const tr = r.fork('temps');
  for (const w of wells) {
    const c = byId[w.condId];
    let dT = tr.float(-0.3, 0.3);
    if (w.status === 'outlier' && w.reason === 'temp') dT = (w.factor > 1 ? 1 : -1) * tr.float(1.3, 2.4);
    if (w.status === 'decoy' && w.kind === 'temp-minor') dT = (tr.chance(0.5) ? 1 : -1) * tr.float(0.4, 0.7);
    w.tempC = Math.round((c.tempC + dT) * 10) / 10;
  }
  // re-reads: first read distorted, the re-read (which the SOP says replaces it) is the true value
  for (const w of wells.filter(x => x.status === 'reread')) {
    w.firstRate = w.rateTrue * (tr.chance(0.5) ? tr.float(0.5, 0.7) : tr.float(1.4, 1.7));
  }

  // ---- traps: mislabels, swaps, units, retracted corrections -------------------------------
  const pr = r.fork('traps');
  const traps = [];
  const usedSeries = new Set();
  const fitCond = (c, pts) => fitMM(pts, { fixedV: c.parentId ? byId[c.parentId].refFit.vmax : null });
  const condClean = cid => cleanPoints(wells.filter(w => w.condId === cid));
  for (const type of k.corrections) {
    if (type === 'reassign' || type === 'omitted-inhibitor') {
      const cands = [];
      for (const s of pr.shuffle(series)) {
        if (usedSeries.has(s.key)) continue;
        const X = byId[s.condId];
        if (byId[s.condId].reps < 2) continue;
        const targets = type === 'omitted-inhibitor' ? conds.filter(c => c.parentId === X.id) : conds.filter(c => c.id !== X.id && !c.parentId && !X.parentId);
        for (const Y of pr.shuffle(targets)) cands.push([s, Y]);
      }
      let chosen = null, loadBearing = false;
      for (const [s, Y] of cands) {
        const moved = cleanPoints(s.wells.map(id => wellById[id]));
        if (fails(fitCond(Y, [...condClean(Y.id), ...moved]), Y)) { chosen = [s, Y]; loadBearing = true; break; }
      }
      if (!chosen && cands.length) chosen = cands[0];
      if (!chosen) continue;
      const [s, Y] = chosen;
      s.labelCondId = Y.id; s.displayRep = Y.reps + 1; usedSeries.add(s.key);
      traps.push({ type, series: s.key, from: Y.id, to: s.condId, first: s.wells[0], last: s.wells[s.wells.length - 1], n: s.wells.length, loadBearing });
    } else if (type === 'swap' || type === 'retracted') {
      let chosen = null, fallback = null, loadBearing = false;
      for (const s of pr.shuffle(series)) {
        if (usedSeries.has(s.key)) continue;
        const sw = s.wells.map(id => wellById[id]);
        const n = sw.length;
        const pairs = [[0, n - 1], [0, n - 2], [1, n - 1], [1, n - 2], [0, n - 3], [2, n - 1]];
        for (const [i, j] of pairs) {
          const a = sw[i], b = sw[j];
          if (!a || !b || a.status !== 'none' || b.status !== 'none') continue;
          const c = byId[s.condId];
          const pts = wells.filter(w => w.condId === c.id && w.status !== 'outlier').map(w => ({ S: w.id === a.id ? b.S : w.id === b.id ? a.S : w.S, v: w.rateTrue }));
          fallback ??= [s, a, b];
          if (fails(fitCond(c, pts), c)) { chosen = [s, a, b]; loadBearing = true; break; }
        }
        if (chosen) break;
      }
      chosen ??= fallback;
      if (!chosen) continue;
      const [s, a, b] = chosen;
      usedSeries.add(s.key);
      if (type === 'swap') { a.displayS = b.S; b.displayS = a.S; }
      traps.push({ type, series: s.key, a: a.id, b: b.id, loadBearing });
    } else if (type === 'units') {
      traps.push({ type }); // bound to a document below
    }
  }

  // ---- documents plan ------------------------------------------------------------------------
  const dp = r.fork('docs');
  const docSeries = Array.from({ length: k.techDocs }, () => []);
  dp.shuffle(series).forEach((s, i) => docSeries[i % k.techDocs].push(s.key));
  let fmtCycle = dp.shuffle(k.formats);
  if (k.absorbance !== 'none') fmtCycle = ['reader', ...fmtCycle.filter(f => f !== 'reader')];
  const docs = docSeries.map((keys, i) => {
    const format = fmtCycle[i % fmtCycle.length];
    let rateUnit = dp.pick(k.rateUnits), concUnit = dp.pick(k.concUnits);
    if (format === 'reader') rateUnit = 'mAU/min';
    if (format === 'semicolon') { rateUnit = dp.pick(['uM/min', 'nM/s']); concUnit = dp.pick(['mM', 'uM']); }
    if (difficulty === 1 && i === 0) rateUnit = 'uM/min';
    return {
      index: i, author: meta.techs[i], format, series: keys, rateUnit, headerRateUnit: rateUnit, concUnit,
      numStyle: format === 'semicolon' ? 'comma' : dp.pick(k.numStyles), aliasStyle: dp.pick(k.aliasStyles),
      unitPlacement: format === 'prose' ? dp.pick(['perValue', ...(k.unitPlacement.includes('preamble') ? ['preamble'] : [])]) : (format === 'reader' || format === 'semicolon' ? 'header' : dp.pick(k.unitPlacement)),
      sig: dp.pick([3, 4]), day: i + dp.int(0, 1), mixedRowUnits: format === 'reader' && difficulty >= 5,
    };
  });
  // the units trap needs a doc whose rate unit sits in a header we can falsify
  const unitsTrap = traps.find(t => t.type === 'units');
  if (unitsTrap) {
    const cand = docs.filter(d => ['mdtable', 'csv', 'grouped', 'semicolon'].includes(d.format) && d.unitPlacement === 'header');
    const d = cand.length ? dp.pick(cand) : dp.pick(docs.filter(x => ['mdtable', 'csv', 'grouped'].includes(x.format)));
    d.unitPlacement = 'header';
    const conc = dp.pick(['uM', 'nM']);
    d.rateUnit = `${conc}/min`; d.headerRateUnit = `${conc}/s`;
    unitsTrap.doc = d.index; unitsTrap.author = d.author; unitsTrap.loadBearing = true; // 60x on every rate in the doc
  }
  // absorbance conversion for the reader-format doc
  const absorb = k.absorbance === 'none' ? null
    : k.absorbance === 'factor' ? { mode: 'factor', factor: Number((1 / (6.22 * dp.pick([0.52, 0.55, 0.56, 0.58, 0.6]))).toPrecision(4)) }
      : (() => { const path = dp.pick([0.52, 0.55, 0.56, 0.58, 0.6]); return { mode: 'epsilon', epsilon: 6.22, path, factor: 1 / (6.22 * path) }; })();
  // ---- instrument raw export duplicating some transcribed series (d3+) ---------------------
  let rawExport = null;
  if (k.rawExport) {
    const xr = r.fork('rawexport');
    // never duplicate reader-format series or the units-trap document (the export would defuse the trap)
    const readerSeries = new Set(docs.filter(d => d.format === 'reader' || (unitsTrap && d.index === unitsTrap.doc)).flatMap(d => d.series));
    const cands = xr.shuffle(series.filter(s => !usedSeries.has(s.key) && !readerSeries.has(s.key) && !s.wells.some(id => wellById[id].status === 'reread')));
    const dup = cands.slice(0, k.rawExport.series);
    const typos = [];
    for (const s of dup) {
      if (typos.length >= k.rawExport.typos) break;
      const c = byId[s.condId];
      const sw = s.wells.map(id => wellById[id]).filter(w => w.status === 'none' && w.idx >= sw0(s) - 4);
      for (const w of xr.shuffle(sw)) {
        const f = xr.pick([10, 0.1]);
        const pts = wells.filter(x => x.condId === c.id && x.status !== 'outlier').map(x => ({ S: x.S, v: x.id === w.id ? x.rateTrue * f : x.rateTrue }));
        if (fails(fitCond(c, pts), c)) { w.typo = f; typos.push(w.id); break; }
      }
    }
    rawExport = { series: dup.map(s => s.key), typos, rateUnit: xr.pick(['uM/min', 'nM/s', 'uM/s']), day: xr.int(0, k.techDocs) };
  }
  // bench codes (d5)
  const bench = k.aliasStyles.includes('bench') ? Object.fromEntries(dp.sample(BENCH_CODES, conds.length).map((code, i) => [conds[i].id, code])) : null;

  // ---- pilot plate (distractor data, not part of the study) --------------------------------
  let pilot = null;
  if (k.pilot) {
    const pp = r.fork('pilot');
    const pc = pp.sample(conds.filter(c => !c.parentId), Math.min(2, k.nBase));
    let n = pp.int(1, 40);
    pilot = pc.map(c => {
      const v = c.vmax * pp.float(0.5, 0.65), km = c.km * pp.float(1.6, 2.2);
      return { condId: c.id, wells: c.grid.map(S => ({ id: `PLT-${String(n++).padStart(3, '0')}`, S, rate: v * S / (km + S) * (1 + k.cv * pp.normal()) })) };
    });
  }

  return { difficulty, knobs: k, meta, conds, byId, series, seriesByKey, wells, wellById, traps, docs, absorb, bench, pilot, rawExport };
}
