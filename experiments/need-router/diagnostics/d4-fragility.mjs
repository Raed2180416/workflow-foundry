// D4: tolerance fragility on archived records and kinetics rows (DESIGN §2 "Fragility", §7 M0 item 10; PREREG-NEED-V1 §5).
// An oracle's numeric tolerance is a hidden slider: halve it or double it and the pass flags, the utilities and possibly the
// NEED label change. This recomputes each archived row's pass flag from the oracle's own recorded details at the tolerance
// scaled by 0.5 and by 2, then recomputes the labels with metrics.fragility over the whole (V, N, W) grid.
//   records   pass = fieldAccuracy >= 0.97 AND pairF1 >= 0.95 AND extra, missing <= floor(0.02 E)   (beds/records/score.mjs:82)
//             at factor f: fieldAccuracy >= 1 - 0.03 f, pairF1 >= 1 - 0.05 f, slack floor(0.02 f E)   (0.985/0.975/1% and 0.94/0.90/4%)
//   kinetics  pass = evaluator valid AND the exclusion set exact AND every condition within TOL = 0.10 on Vmax and Km (beds/kinetics/world.mjs:13)
//             at factor f: TOL f (0.05 and 0.20); the evaluator-health check (reference fit within TOL) is scaled too
// The nominal recompute (f = 1) must reproduce every archived pass flag; any mismatch is reported and blocks the claim.
// Rows without recorded oracle details keep their nominal flag at every factor (counted as `unrecomputable`).
// Evidence grade: LEGACY/dev.
import { needTable, needLabels, fragility, GRID, HEADLINE } from '../metrics.mjs';
import { toMatrix, LEGACY_REGISTRY } from './legacy.mjs';
import { mean, round } from './common.mjs';

export const RECORDS_RULE = Object.freeze({ fieldAccuracy: 0.97, pairF1: 0.95, entitySlack: 0.02, source: 'beds/records/score.mjs:82' });
export const KINETICS_TOL = 0.10;
export const KINETICS_SOURCE = 'beds/kinetics/world.mjs:13';
export const FACTORS = Object.freeze([0.5, 2]);
const EPS = 1e-12;

/** Records pass at tolerance factor f (null when the row's details cannot be re-evaluated). */
export function recordsPassAt(d, f) {
  if (!d) return null;
  if (d.reason) return false;   // schema-invalid, row-in-multiple-records: no tolerance involved
  if (![d.entities, d.extra, d.missing, d.fieldAccuracy, d.pairF1].every(Number.isFinite)) return null;
  const slack = Math.floor(RECORDS_RULE.entitySlack * f * d.entities + EPS);
  return d.fieldAccuracy >= 1 - (1 - RECORDS_RULE.fieldAccuracy) * f - EPS && d.pairF1 >= 1 - (1 - RECORDS_RULE.pairF1) * f - EPS && d.extra <= slack && d.missing <= slack;
}
/** Kinetics pass at tolerance factor f. */
export function kineticsPassAt(d, f) {
  if (!d) return null;
  if (d.reason) return false;
  if (!Array.isArray(d.perCondition) || !Array.isArray(d.referenceRelErrors) || !d.excluded) return null;
  const tol = KINETICS_TOL * f + EPS;
  const evaluatorValid = d.referenceRelErrors.every(e => e.vmax <= tol && e.km <= tol);
  return evaluatorValid && d.excluded.exact === true && (d.unknownConditions ?? []).length === 0 && (d.duplicateConditions ?? []).length === 0
    && d.perCondition.every(c => c.vmaxRelErr <= tol && c.kmRelErr <= tol);
}
export const PASS_AT = Object.freeze({ records: recordsPassAt, kinetics: kineticsPassAt });

const passRate = (rows, mode, f) => { const r = rows.filter(x => x.mode === mode); return mean(r.map(x => (f(x) ? 1 : 0))); };

/** D4 for one LEGACY job whose oracle has a numeric tolerance. */
export function fragilityOfJob(job, { cells = GRID } = {}) {
  const recompute = PASS_AT[job.oracle];
  if (!recompute) return null;
  const at = (r, f) => { const v = recompute(r.details, f); return v === null ? r.pass : v; };
  const unrecomputable = job.rows.filter(r => recompute(r.details, 1) === null).length;
  const mismatch = job.rows.filter(r => recompute(r.details, 1) !== null && recompute(r.details, 1) !== r.pass);
  const passAt = r => Object.fromEntries(FACTORS.map(f => [String(f), at(r, f)]));
  const { rows, builds } = toMatrix(job, { passAt });
  const opts = { registry: LEGACY_REGISTRY };
  const frag = fragility(rows, builds, { cells, factors: FACTORS, tableOpts: opts });
  const jf = frag.jobs.find(j => j.job === job.id);
  // The same re-flagged rows at each factor over the whole grid: labels (class) and best modes.
  const labelsAt = f => needLabels(needTable(rows.map(r => ({ ...r, pass: f === 1 ? r.pass : r.passAt[String(f)] })), builds, opts), { cells, reps: 0 });
  const L = Object.fromEntries([1, ...FACTORS].map(f => [String(f), labelsAt(f)]));
  const head = f => { const e = L[String(f)].at(job.id, HEADLINE); return { label: e.label, top: e.top, acceptable: e.acceptable, u: Object.fromEntries([...e.u].map(([m, u]) => [m, round(u, 4)])) }; };
  const headline = Object.fromEntries([1, ...FACTORS].map(f => [String(f), head(f)]));
  const topChanged = cells.filter(c => FACTORS.some(f => L[String(f)].at(job.id, c).top !== L['1'].at(job.id, c).top)).map(c => c.key);
  const modes = job.pairing.modes;
  const passRates = Object.fromEntries(modes.map(m => [m, { nominal: round(passRate(job.rows, m, r => r.pass), 4), half: round(passRate(job.rows, m, r => at(r, 0.5)), 4), double: round(passRate(job.rows, m, r => at(r, 2)), 4) }]));
  const passes = job.rows.filter(r => r.pass).length, fails = job.rows.length - passes;
  const lostAtHalf = job.rows.filter(r => r.pass && !at(r, 0.5)).length, gainedAtDouble = job.rows.filter(r => !r.pass && at(r, 2)).length;
  const flippedCells = jf.cells.filter(c => Object.values(c.at).some(l => l !== c.nominal));
  return {
    job: job.id, oracle: job.oracle, family: job.family, tolerance: job.oracle === 'records' ? RECORDS_RULE : { tol: KINETICS_TOL, source: KINETICS_SOURCE },
    units: job.pairing.paired, modes, rows: job.rows.length, sources: job.sources,
    reproduction: { rows: job.rows.length, mismatches: mismatch.length, unrecomputable, mismatchRows: mismatch.slice(0, 5).map(r => `${r.mode}/${r.unit}`) },
    failuresWithWrongExclusion: job.oracle === 'kinetics' ? job.rows.filter(r => !r.pass && r.details?.excluded?.exact === false).length : null,
    rowFlips: { passes, fails, lostAtHalf, gainedAtDouble, lostShare: passes ? round(lostAtHalf / passes, 4) : null, gainedShare: fails ? round(gainedAtDouble / fails, 4) : null },
    passRates, headline,
    headlineFlips: { half: headline['0.5'].label !== headline['1'].label, double: headline['2'].label !== headline['1'].label },
    headlineTopChanges: { half: headline['0.5'].top !== headline['1'].top, double: headline['2'].top !== headline['1'].top },
    grid: { cells: cells.length, flipped: flippedCells.length, fragile: jf.fragile, flippedCells: flippedCells.map(c => ({ cell: c.cell, nominal: c.nominal, ...c.at })), topChangedCells: topChanged.length },
  };
}

/** The fields behind the recorded mismatches of failing records answers (the oracle records at most 12 per answer). */
export function recordsMismatchFields(jobs) {
  const by = {}; let total = 0, answers = 0;
  for (const job of jobs.filter(j => j.oracle === 'records')) for (const r of job.rows) {
    const d = r.details;
    if (r.pass || !d || d.reason || !Array.isArray(d.mismatches)) continue;
    answers += 1;
    for (const m of d.mismatches) { by[m.field] = (by[m.field] ?? 0) + 1; total += 1; }
  }
  const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return { failingAnswers: answers, recordedMismatches: total, byField: by, topField: top[0], topFieldShare: total ? round(top[1] / total, 3) : null };
}

export function runD4(jobs) {
  const per = jobs.map(j => fragilityOfJob(j)).filter(Boolean);
  const reproduced = per.every(p => p.reproduction.mismatches === 0);
  return {
    id: 'D4', grade: 'LEGACY/dev', factors: FACTORS,
    question: 'Do labels flip when the oracle tolerance is halved or doubled? (archived records and kinetics rows)',
    jobs: per, recordsMismatches: recordsMismatchFields(jobs),
    summary: {
      jobs: per.length, fragileJobs: per.filter(p => p.grid.fragile).map(p => p.job), fragileAtHeadline: per.filter(p => p.headlineFlips.half || p.headlineFlips.double).map(p => p.job),
      rowsTotal: per.reduce((s, p) => s + p.rows, 0), lostAtHalf: per.reduce((s, p) => s + p.rowFlips.lostAtHalf, 0), gainedAtDouble: per.reduce((s, p) => s + p.rowFlips.gainedAtDouble, 0),
      nominalReproduced: reproduced, flippedCells: per.reduce((s, p) => s + p.grid.flipped, 0), cells: per.reduce((s, p) => s + p.grid.cells, 0),
      topChangedCells: per.reduce((s, p) => s + p.grid.topChangedCells, 0), jobsWithTopChange: per.filter(p => p.grid.topChangedCells > 0).map(p => p.job),
    },
  };
}
