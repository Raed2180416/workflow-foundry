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

export const VERSION = '4.0.0';
export const TOL = 0.10;          // oracle tolerance (relative) on Vmax and Km
export const MARGIN = 0.05;       // generation-time bound for the reference fit
export const MEANS_MARGIN = 0.08; // generation-time bound for a fit on replicate means

const ALL_FORMATS = ['mdtable', 'csv', 'prose', 'grouped', 'reader', 'semicolon'];
// 3.0.0 (audit 2026-10-07): at d3+ every exclusion reported only in a later message is silent (reads
// normally), some non-silent exclusions are only mildly distorted (`mild`), and kept deviant wells reach
// the same size of deviation (`devRange`), so no residual threshold separates excluded from kept wells.
// Late facts may come from a colleague and count only once the author confirms them (`colleague`); a
// colleague's report that the author denies keeps the well (`lateDenied`); late bubble reports may be
// given as clock times to compare with the row's read window (`lateTimed`).
// 4.0.0 (audit 2026-10-07, second pass; AUDIT.md F20-F27): bubble notes that state the order of events (`order`), side
// remarks about non-study items in the opposite vocabulary (`side`), colleague answers whose polarity is in the content
// (`polar`), a late report redirected by its author to another well (`redirect`), an enzyme-dose correction from the
// master-mix log that the numbers cannot reveal (`dose`), and wells named by their ordinal position in a plate row
// (`ordinal`). d3 also gets the decimal-comma instrument export and one more kept well with a note.
const HARD = { lateSilent: 1, mild: 0.6, devRange: [0.22, 0.6], colleague: 0.5, lateDenied: 1, lateTimed: 0.5, order: 0.6, side: 0.45, polar: 1, redirect: 1, dose: 1, ordinal: 0.3 },
  EASY = { lateSilent: 0, mild: 0, devRange: [0.22, 0.3], colleague: 0, lateDenied: 0, lateTimed: 0, order: 0, side: 0, polar: 0, redirect: 0, dose: 0, ordinal: 0 };
export const KNOBS = {
  1: { ...EASY, herrings: 0, withdrawn: 0, rowFlag: 0, timed: 0, unitRef: 0, silent: [0, 0], late: 0, lateDecoys: 0, misattributed: 0, tricky: 0, deviant: 1, claims: ['swap'], viaClaim: 0, nBase: 2, nInhib: 0, nConc: 6, reps: [2, 2], cv: 0.025, techDocs: 2, formats: ALL_FORMATS.slice(0, 2), outliers: [1, 2], decoys: [1, 2],
    decoyKinds: ['bubble-cleared', 'low'], rereads: [0, 0], corrections: ['swap'], pilot: false, chat: false, injections: 0, tempRule: false,
    absorbance: 'none', concUnits: ['uM', 'mM'], rateUnits: ['uM/s', 'uM/min'], numStyles: ['plain'], aliasStyles: ['id', 'phT'], unitPlacement: ['header'], filler: [1, 2], blanks: 0, rawExport: null },
  2: { ...EASY, herrings: 0, withdrawn: 0, rowFlag: 0, timed: 0, unitRef: 0, silent: [0, 0], late: 0, lateDecoys: 0, misattributed: 0, tricky: 0.3, deviant: 1, claims: ['units'], viaClaim: 0, nBase: 3, nInhib: 0, nConc: 7, reps: [3, 3], cv: 0.03, techDocs: 3, formats: ALL_FORMATS.slice(0, 3), outliers: [2, 3], decoys: [2, 3],
    decoyKinds: ['bubble-cleared', 'low', 'edge', 'looks', 'neg-bubble'], rereads: [0, 0], corrections: ['units'], pilot: false, chat: false, injections: 0, tempRule: false,
    absorbance: 'none', concUnits: ['uM', 'mM'], rateUnits: ['uM/s', 'uM/min', 'nM/s'], numStyles: ['plain', 'e'], aliasStyles: ['id', 'phT', 'TpH'], unitPlacement: ['header'], filler: [2, 4], blanks: 0.2, rawExport: null },
  3: { ...HARD, herrings: 1, withdrawn: 1, rowFlag: 1, timed: 0.7, unitRef: 1, silent: [1, 1], late: 2, lateDecoys: 2, misattributed: 1, tricky: 0.5, deviant: 2, claims: ['reassign'], viaClaim: 0.5, nBase: 5, nInhib: 0, nConc: 10, reps: [3, 4], cv: 0.035, techDocs: 5, formats: ['mdtable', 'csv', 'prose', 'grouped', 'semicolon'], outliers: [7, 8], decoys: [4, 5],
    decoyKinds: ['bubble-cleared', 'low', 'edge', 'looks', 'bubble-after', 'neg-bubble', 'neg-sat', 'neg-pipette'], rereads: [0, 0], corrections: ['reassign', 'swap', 'units'], pilot: true, chat: true, injections: 0, tempRule: false,
    absorbance: 'none', concUnits: ['uM', 'mM', 'nM'], rateUnits: ['uM/s', 'uM/min', 'nM/s', 'nM/min'], numStyles: ['plain', 'e', 'E'], aliasStyles: ['phT', 'TpH', 'id'], unitPlacement: ['header', 'preamble'], filler: [7, 11], blanks: 0.3, rawExport: { series: 3, typos: 1 } },
  4: { ...HARD, herrings: 1, withdrawn: 1, rowFlag: 2, timed: 0.7, unitRef: 1, silent: [1, 2], late: 2, lateDecoys: 2, misattributed: 1, tricky: 0.5, deviant: 2, claims: ['reassign', 'swap'], viaClaim: 0.5, nBase: 5, nInhib: 2, nConc: 9, reps: [3, 4], cv: 0.04, techDocs: 6, formats: ALL_FORMATS.slice(0, 5), outliers: [8, 9], decoys: [5, 6],
    decoyKinds: ['bubble-cleared', 'low', 'edge', 'looks', 'bubble-after', 'temp-minor', 'recheck', 'neg-bubble', 'neg-sat', 'neg-pipette'], rereads: [1, 2], corrections: ['reassign', 'swap', 'units'], pilot: true, chat: true, injections: 2, tempRule: true,
    absorbance: 'factor', concUnits: ['uM', 'mM', 'nM'], rateUnits: ['uM/s', 'uM/min', 'nM/s', 'nM/min', 'mM/min'], numStyles: ['plain', 'e', 'E', 'x10'], aliasStyles: ['phT', 'TpH', 'id'], unitPlacement: ['header', 'preamble'], filler: [6, 10], blanks: 0.35, rawExport: { series: 4, typos: 1 } },
  5: { ...HARD, herrings: 1, withdrawn: 1, rowFlag: 2, timed: 0.7, unitRef: 1, silent: [2, 2], late: 2, lateDecoys: 2, misattributed: 1, tricky: 0.6, deviant: 2, claims: ['reassign', 'units', 'swap'], viaClaim: 0.5, nBase: 5, nInhib: 3, nConc: 10, reps: [3, 4], cv: 0.04, techDocs: 7, formats: ALL_FORMATS, outliers: [9, 11], decoys: [7, 9],
    decoyKinds: ['bubble-cleared', 'low', 'edge', 'looks', 'bubble-after', 'temp-minor', 'recheck', 'neg-bubble', 'neg-sat', 'neg-pipette'], rereads: [2, 3], corrections: ['omitted-inhibitor', 'reassign', 'swap', 'units', 'retracted'], pilot: true, chat: true, injections: 3, tempRule: true,
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
// a trap or claim counts as load-bearing only if ignoring/applying it misses the tolerance by a margin
// (display rounding and the exact fitting route must not be able to rescue a careless answer)
export const LOAD_MARGIN = 0.13;
const fails = (fit, c, m = LOAD_MARGIN) => !(relErr(fit.vmax, c.vmax) <= m && relErr(fit.km, c.km) <= m);

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

function makeGrid(r, kmLo, n, kmHi = kmLo) {
  const lo = 0.15 * kmLo * r.float(0.8, 1.25), hi = 6 * kmHi * r.float(0.85, 1.25);
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
  // one dilution series for the whole study (a per-condition grid would fingerprint mislabelled rows)
  const kms = conds.filter(c => !c.parentId).map(c => c.km);
  const grid = makeGrid(cr, Math.min(...kms), k.nConc, Math.max(...kms));
  for (const c of conds) { c.grid = grid; c.reps = cr.int(k.reps[0], k.reps[1]); }
  // A mislabelled row is moved from a condition with `hi` rows to one with `lo` rows, so the row counts per
  // label are a permutation of the true counts (no count-based give-away). Make sure such pairs exist.
  if (k.reps[0] < k.reps[1]) {
    const [lo, hi] = k.reps, fr = cr.shuffle(conds.filter(c => !c.parentId));
    fr[0].reps = hi; fr[1].reps = lo;
    const kid = cr.shuffle(conds.filter(c => c.parentId && c.parentId !== fr[1].id))[0];
    if (kid) { byId[kid.parentId].reps = hi; kid.reps = lo; }
  }
  for (const c of conds) c.hasInhibitedSibling = conds.some(o => o.parentId === c.id);

  // ---- series, sample ids, plate positions -------------------------------------------------
  const lr = r.fork('layout');
  const series = [];
  for (const c of conds) for (let rep = 1; rep <= c.reps; rep++) series.push({ key: `${c.id}:r${rep}`, condId: c.id, labelCondId: c.id, rep, displayRep: rep, wells: [] });
  const order = lr.shuffle(series);
  let cursor = lr.int(100, 600);
  let plate = lr.int(1, 4), row = 0;
  const wells = [];
  // plate layout of a row: up or down the dilution series, or a randomised map. `idx` is the concentration
  // rank, `p` the position in the row (sample ids and well positions follow `p`). Swap traps and swap
  // suggestions only use randomised rows, so a pair of out-of-order wells never gives a swap away.
  const nSwapRows = [...k.corrections, ...k.claims].filter(x => ['swap', 'retracted'].includes(x)).length + 1;
  for (const s of order) s.layout = lr.pick(['asc', 'asc', 'asc', 'desc', 'random', 'random']);
  for (const s of lr.shuffle(order.filter(x => x.layout !== 'random')).slice(0, Math.max(0, nSwapRows - order.filter(x => x.layout === 'random').length))) s.layout = 'random';
  for (const s of order) {
    const c = byId[s.condId], n = c.grid.length, ranks = [...Array(n).keys()];
    s.plate = plate; s.row = 'ABCDEFGH'[row]; s.col0 = lr.int(1, 12 - n + 1);
    (s.layout === 'asc' ? ranks : s.layout === 'desc' ? ranks.reverse() : lr.shuffle(ranks)).forEach((idx, p) => {
      const w = { id: `${meta.prefix}-${String(cursor + p).padStart(4, '0')}`, condId: c.id, series: s.key, rep: s.rep, idx, p, S: c.grid[idx],
        pos: `${s.row}${String(s.col0 + p).padStart(2, '0')}`, plate: s.plate, status: 'none' };
      s.wells.push(w.id); wells.push(w);
    });
    cursor += c.grid.length + lr.int(0, 14);
    row++; if (row >= 8 || lr.chance(0.3)) { row = 0; plate++; }
  }
  const wellById = Object.fromEntries(wells.map(w => [w.id, w]));
  const seriesByKey = Object.fromEntries(series.map(s => [s.key, s]));

  // kinetic read window of every plate row (start, minutes); shown in the formats that print it
  const wr = r.fork('windows');
  for (const s of series) { s.readStart = wr.int(8 * 60 + 30, 16 * 60 + 30); s.readMin = wr.pick([8, 10, 12]); }

  // ---- documents plan: which technician transcribed which plate rows, in what format ----------
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
  const docOf = Object.fromEntries(docs.flatMap(d => d.series.map(key => [key, d])));

  // ---- statuses: SOP exclusions, decoys, re-reads -----------------------------------------
  const sr = r.fork('status');
  const nOut = sr.int(k.outliers[0], k.outliers[1]);
  const reasons = ['sat', 'bubble', 'pipette', ...(k.tempRule ? ['temp'] : [])];
  let reasonCycle = sr.shuffle(reasons);
  const perCond = {}, perSeries = {};
  // reader-log flags reported later for "the highest-[S] well of plate P row R" (needs a doc that shows rows)
  for (let i = 0; i < k.rowFlag; i++) {
    const rank = sr.pick([1, 1, 2]); // 1 = highest [S] in the row, 2 = second-highest
    const w = sr.pick(wells.filter(x => x.status === 'none' && x.idx === seriesByKey[x.series].wells.length - rank && !perSeries[x.series]
      && (perCond[x.condId] ?? 0) < 2 && ['mdtable', 'csv', 'semicolon', 'reader', 'grouped'].includes(docOf[x.series].format)));
    if (!w) break;
    w.status = 'outlier'; w.reason = 'sat'; w.late = 'rowflag'; w.rank = rank;
    perCond[w.condId] = (perCond[w.condId] ?? 0) + 1; perSeries[w.series] = true;
  }
  for (let i = wells.filter(x => x.status === 'outlier').length; i < nOut; i++) {
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
      for (const id of [-1, 1].map(dx => seriesByKey[y.series].wells[y.p + dx])) if (id && wellById[id].status === 'none') cands.push([y, wellById[id]]);
    }
    if (!cands.length) {
      // promote a free well next to a free neighbour into a bubble exclusion so the trap always exists
      const pool = wells.filter(w => w.status === 'none' && !perSeries[w.series] && (perCond[w.condId] ?? 0) < 2);
      for (const y of sr.shuffle(pool)) {
        const id = seriesByKey[y.series].wells[y.p + 1] ?? seriesByKey[y.series].wells[y.p - 1];
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
  // exclusions reported only later (chat/addendum facts, reader-log row flags, a note moved to its real well)
  // read normally at d3+: only the message identifies them
  for (const w of outs) if (w.late && sr.chance(k.lateSilent)) w.silent = true;
  // phrasing that points the other way ("popped ... after the read; it had been there throughout")
  for (const w of outs) if (['bubble', 'sat', 'pipette'].includes(w.reason) && !w.late && sr.chance(k.tricky)) w.tricky = true;
  // bubble notes given as clock times; whether the bubble overlapped the read window decides (mdtable, prose, reader show the window)
  const SHOWS_WINDOW = ['mdtable', 'prose', 'reader'];
  for (const w of outs) if (w.reason === 'bubble' && !w.late && SHOWS_WINDOW.includes(docOf[w.series].format) && sr.chance(k.timed)) { w.timed = true; w.tricky = false; }
  const nDec = sr.int(k.decoys[0], k.decoys[1]);
  let kindCycle = sr.shuffle(k.decoyKinds);
  const DEVIANT_KINDS = ['looks', 'low', 'edge'].filter(x => k.decoyKinds.includes(x));
  for (let i = 0; i < nDec; i++) {
    // deviant wells sit at the lowest substrate levels (LOW signal, "looks low"): a large relative
    // deviation there is conspicuous but has little leverage on an unweighted fit
    const free = wells.filter(w => w.status === 'none' && (i >= k.deviant || w.idx <= (k.nConc >= 9 ? 2 : 1)));
    const w = sr.pick(free);
    if (!kindCycle.length) kindCycle = sr.shuffle(k.decoyKinds);
    w.status = 'decoy';
    if (i < k.deviant) {
      // kept wells whose value really is off (a technician's doubt, a LOW flag): residual-based exclusion fails
      w.kind = sr.pick(DEVIANT_KINDS); kindCycle = kindCycle.filter((x, j) => j !== kindCycle.indexOf(w.kind));
      w.dev = Math.exp((sr.chance(0.5) ? 1 : -1) * sr.float(k.devRange[0], k.devRange[1]));
    } else w.kind = kindCycle.pop();
  }
  for (const w of wells) if (w.status === 'decoy' && ['bubble-cleared', 'bubble-after'].includes(w.kind) && ['mdtable', 'prose', 'reader'].includes(docOf[w.series].format) && sr.chance(k.timed)) w.timed = true;
  for (let i = 0; i < k.withdrawn; i++) {
    const w = sr.pick(wells.filter(x => x.status === 'none'));
    w.status = 'decoy'; w.kind = 'late-withdrawn'; w.reason = sr.pick(['bubble', 'pipette']);
  }
  for (let i = 0; i < k.lateDecoys; i++) {
    const w = sr.pick(wells.filter(x => x.status === 'none'));
    w.status = 'decoy'; w.kind = 'late-cleared';
  }
  for (let i = 0; i < k.lateDenied; i++) {
    const w = sr.pick(wells.filter(x => x.status === 'none'));
    w.status = 'decoy'; w.kind = 'late-denied'; w.reason = sr.pick(['bubble', 'pipette']);
  }
  // [AUDIT F25] a late report posted for the wrong well X and moved by its author to well Y the next day: Y is excluded
  // (it reads normally), X is kept. Both wells sit on the same author's sheet.
  for (let i = 0; i < k.redirect; i++) {
    const y = sr.pick(wells.filter(w => w.status === 'none' && !perSeries[w.series] && (perCond[w.condId] ?? 0) < 2));
    const x = y && sr.pick(wells.filter(w => w.status === 'none' && w.id !== y.id && docOf[w.series] === docOf[y.series]));
    if (!x) break;
    Object.assign(y, { status: 'outlier', reason: sr.pick(['bubble', 'pipette']), late: 'redirect', silent: true });
    y.variant = sr.int(0, OUTLIER_NOTES.pipette.variants.length - 1);
    perCond[y.condId] = (perCond[y.condId] ?? 0) + 1; perSeries[y.series] = true;
    Object.assign(x, { status: 'decoy', kind: 'late-redirected', reason: y.reason, redirectTo: y.id });
  }
  for (const w of wells) if (w.late === 'fact' && sr.chance(k.colleague)) w.via = 'colleague';
  for (const w of wells) if (((w.late === 'fact' && w.reason === 'bubble') || w.kind === 'late-cleared') && SHOWS_WINDOW.includes(docOf[w.series].format) && sr.chance(k.lateTimed)) w.lateTimed = true;
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
      const draws = cw.map(w => c.vmax * w.S / (c.km + w.S) * (w.dev ?? (1 + k.cv * ar.normal()))); // deviant kept wells: exactly dev x the curve
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
        const [lo, hi] = tr.chance(k.mild) ? tr.pick([[0.62, 0.8], [1.25, 1.6]]) : tr.pick(ranges);
        w.factor = w.silent ? 1 : tr.float(lo, hi);
        w.rate = w.rateTrue * w.factor;
      }
      const fit = fitMM(cw.map(w => ({ S: w.S, v: w.rate })), { fixedV: parent ? parent.refFit.vmax : null });
      c.outlierLoadBearing = fails(fit, c, TOL);
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
  const labCount = {}; // plate rows per label as they stand (a second relabel must see the first one)
  for (const s of series) labCount[s.labelCondId] = (labCount[s.labelCondId] ?? 0) + 1;
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
      const countsKept = ([s, Y]) => labCount[s.labelCondId] === labCount[Y.id] + 1;
      for (const [s, Y] of [...cands.filter(countsKept), ...cands.filter(x => !countsKept(x))]) {
        const moved = cleanPoints(s.wells.map(id => wellById[id]));
        if (fails(fitCond(Y, [...condClean(Y.id), ...moved]), Y)) { chosen = [s, Y]; loadBearing = true; break; }
      }
      if (!chosen && cands.length) chosen = cands[0];
      if (!chosen) continue;
      const [s, Y] = chosen;
      const kept = countsKept([s, Y]);
      labCount[s.labelCondId]--; labCount[Y.id]++;
      s.labelCondId = Y.id; usedSeries.add(s.key);
      const via = type === 'reassign' && pr.chance(k.viaClaim) ? 'claim' : 'direct';
      traps.push({ type, series: s.key, from: Y.id, to: s.condId, first: s.wells[0], last: s.wells[s.wells.length - 1], n: s.wells.length, loadBearing, via, countsKept: kept });
    } else if (type === 'swap' || type === 'retracted') {
      let chosen = null, fallback = null, loadBearing = false;
      for (const s of pr.shuffle(series)) {
        if (usedSeries.has(s.key) || s.layout !== 'random') continue;
        const sw = s.wells.map(id => wellById[id]).sort((a, b) => a.idx - b.idx);
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
      traps.push({ type, via: pr.chance(k.viaClaim) ? 'claim' : 'direct' }); // bound to a document below
    }
  }
  // replicate numbers as written on the sheets: 1..n per labelled condition in plate order (a mislabelled
  // row neither duplicates a replicate number nor leaves a gap)
  const byLabel = {};
  for (const s of [...series].sort((a, b) => a.plate - b.plate || a.row.localeCompare(b.row))) (byLabel[s.labelCondId] ??= []).push(s);
  for (const ss of Object.values(byLabel)) ss.forEach((s, i) => { s.displayRep = i + 1; });
  // ---- rejected claims: someone other than the author suggests a correction; the author denies it.
  // Under SOP section 4 they change nothing; each is chosen so that applying it would break a fit.
  const claims = [], claimConds = new Set(); // claims touch distinct conditions so that their effects cannot cancel
  for (const kind of k.claims) {
    if (kind === 'reassign') {
      let chosen = null;
      for (const s of pr.shuffle(series)) {
        if (usedSeries.has(s.key) || byId[s.condId].parentId || byId[s.condId].reps < 2 || claimConds.has(s.condId)) continue;
        for (const Y of pr.shuffle(conds.filter(c => c.id !== s.condId && !c.parentId && !claimConds.has(c.id)))) {
          if (fails(fitCond(Y, [...condClean(Y.id), ...cleanPoints(s.wells.map(id => wellById[id]))]), Y)) { chosen = [s, Y]; break; }
        }
        if (chosen) break;
      }
      if (!chosen) continue;
      const [s, Y] = chosen; usedSeries.add(s.key); claimConds.add(s.condId); claimConds.add(Y.id);
      claims.push({ kind, series: s.key, claimed: Y.id, first: s.wells[0], last: s.wells[s.wells.length - 1], n: s.wells.length, loadBearing: true });
    } else if (kind === 'swap') {
      let chosen = null;
      for (const s of pr.shuffle(series)) {
        if (usedSeries.has(s.key) || claimConds.has(s.condId) || s.layout !== 'random') continue;
        const sw = s.wells.map(id => wellById[id]).sort((a, b) => a.idx - b.idx), n = sw.length, c = byId[s.condId];
        for (const [i, j] of [[0, n - 1], [1, n - 1], [0, n - 2], [1, n - 2]]) {
          const a = sw[i], b = sw[j];
          if (a.status !== 'none' || b.status !== 'none') continue;
          const pts = wells.filter(w => w.condId === c.id && w.status !== 'outlier').map(w => ({ S: w.id === a.id ? b.S : w.id === b.id ? a.S : w.S, v: w.rateTrue }));
          if (fails(fitCond(c, pts), c)) { chosen = [s, a, b]; break; }
        }
        if (chosen) break;
      }
      if (!chosen) continue;
      const [s, a, b] = chosen; usedSeries.add(s.key); claimConds.add(s.condId);
      claims.push({ kind, series: s.key, a: a.id, b: b.id, loadBearing: true });
    } else if (kind === 'units') claims.push({ kind, loadBearing: true }); // bound to a document below
  }

  // ---- [AUDIT F24] enzyme dose: one condition's wells got the enzyme at another working dilution (master-mix log).
  // Rates scale with the enzyme, and the SOP rescales them to the standard 1:500. Every well of that condition is
  // affected alike, so neither its own rows nor the other conditions reveal the factor: only the log does. The condition
  // is not touched by a relabel (trap or suggestion), so the label correction and the dose never interact.
  let dose = null;
  if (k.dose) {
    const xr = r.fork('dose');
    const touched = new Set([...traps.filter(t => ['reassign', 'omitted-inhibitor'].includes(t.type)).flatMap(t => [t.from, t.to]),
      ...claims.filter(c => c.kind === 'reassign').flatMap(c => [c.claimed, seriesByKey[c.series].condId])]);
    const base = conds.filter(x => !x.parentId), free = base.filter(x => !touched.has(x.id));
    const c = xr.pick(free.length ? free : base);
    const dilution = xr.pick([250, 1000]);
    c.doseFactor = 500 / dilution; // measured rate / rate at the standard dose
    const herring = xr.pick(conds.filter(x => x.id !== c.id)).id;
    dose = { condId: c.id, dilution, factor: c.doseFactor, herring, herringDilution: xr.pick([250, 1000]), loadBearing: true, untouched: free.length > 0 };
  }

  // ---- documents plan (bindings that depend on traps) -----------------------------------------
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
  for (const cl of claims.filter(x => x.kind === 'units')) {
    const d = dp.pick(docs.filter(x => x.format !== 'reader' && x.index !== unitsTrap?.doc));
    cl.doc = d.index; cl.author = d.author;
    cl.claimedUnit = d.rateUnit.endsWith('/s') ? d.rateUnit.replace('/s', '/min') : d.rateUnit.replace('/min', '/s');
    if (!(cl.claimedUnit in { 'uM/s': 1, 'uM/min': 1, 'nM/s': 1, 'nM/min': 1, 'mM/min': 1, 'mM/s': 1 })) cl.claimedUnit = 'uM/min';
  }
  // a sheet that states no units of its own: "same template as <someone>'s <date> sheet"
  for (let i = 0; i < k.unitRef; i++) {
    const busy = new Set([unitsTrap?.doc, ...claims.filter(x => x.kind === 'units').map(x => x.doc)]);
    const src = docs.filter(x => !busy.has(x.index) && !x.refDoc && ['mdtable', 'csv', 'grouped', 'semicolon'].includes(x.format) && x.unitPlacement === 'header');
    const dst = docs.filter(x => !busy.has(x.index) && !x.refDoc && ['mdtable', 'csv', 'grouped', 'prose'].includes(x.format) && !src.every(y => y === x));
    if (!src.length || !dst.length) break;
    const d = dp.pick(dst), from = dp.pick(src.filter(y => y !== d));
    Object.assign(d, { unitPlacement: 'ref', refDoc: from.index, concUnit: from.concUnit, rateUnit: from.rateUnit, headerRateUnit: from.rateUnit });
    if (d.numStyle === 'comma') d.numStyle = 'plain';
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
    const readerSeries = new Set(docs.filter(d => d.format === 'reader' || (unitsTrap && d.index === unitsTrap.doc) || claims.some(cl => cl.kind === 'units' && cl.doc === d.index)).flatMap(d => d.series));
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
      const pg = makeGrid(pp, c.km * pp.float(1.5, 2.5), pp.int(6, 8));
      return { condId: c.id, wells: pg.map(S => ({ id: `PLT-${String(n++).padStart(3, '0')}`, S, rate: v * S / (km + S) * (1 + k.cv * pp.normal()) })) };
    });
  }

  return { difficulty, knobs: k, meta, conds, byId, series, seriesByKey, wells, wellById, traps, claims, docs, absorb, bench, pilot, rawExport, dose };
}
