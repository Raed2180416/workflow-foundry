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
// Labels are L_today (the headline fields: cheap-builder workflows only) with L_ceiling beside it (DESIGN §2; LEGACY_REGISTRY marks every workflow not
// written by the cheap builder `ceiling`: the hand-written, Opus-built, Opus-compiled and Sonnet-compiled ones). A job whose L_today has no workflow-class
// mode is `vacuous`: its label can only be no-workflow.
// Build costs are charged (legacy.mjs: the P1 hand workflow's >= $24.91 authoring included).
// UNLABELLED cells (DESIGN §2 "One cost meter": a cell where a contending mode has more than 30% of its dollars imputed is left unlabelled; metrics.needLabels
// sets `unlabelled`, a reason string) have no NEED label and no best mode to compare: they are reported as `unlabelled` with the reason, counted per job, and
// left out of the label counts, the workflow cells, the flip counts, the best-mode-change counts and fragility. A cell labelled at x1 that is unlabelled at
// another factor is not a flip either (nothing to compare); it is counted apart as `lostLabelCells`.
// Evidence grade: LEGACY/dev.
import { needTable, needLabels, GRID, HEADLINE } from '../metrics.mjs';
import { toMatrix, labelSetsOf, LEGACY_REGISTRY } from './legacy.mjs';
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

/** D4 for one LEGACY job whose oracle has a numeric tolerance. Labels are L_today (headline fields) with L_ceiling beside it when the job has ceiling arms. */
export function fragilityOfJob(job, { cells = GRID } = {}) {
  const recompute = PASS_AT[job.oracle];
  if (!recompute) return null;
  const at = (r, f) => { const v = recompute(r.details, f); return v === null ? r.pass : v; };
  const unrecomputable = job.rows.filter(r => recompute(r.details, 1) === null).length;
  const mismatch = job.rows.filter(r => recompute(r.details, 1) !== null && recompute(r.details, 1) !== r.pass);
  const passAt = r => Object.fromEntries(FACTORS.map(f => [String(f), at(r, f)]));
  const { rows, builds } = toMatrix(job, { passAt });
  const opts = { registry: LEGACY_REGISTRY };
  const sets = labelSetsOf(job.pairing.modes);
  // One label set over the whole grid: the labels at x0.5, x1 and x2 (needLabels over the table recomputed at each factor).
  const viewOf = modes => {
    const labelsAt = f => needLabels(needTable(rows.map(r => ({ ...r, pass: f === 1 ? r.pass : r.passAt[String(f)] })), builds, opts), { cells, reps: 0, modes });
    const L = Object.fromEntries([1, ...FACTORS].map(f => [String(f), labelsAt(f)]));
    const E = (f, c) => L[String(f)].at(job.id, c);
    const head = f => {
      const e = E(f, HEADLINE);
      return { label: e.unlabelled ? 'unlabelled' : e.label, unlabelled: e.unlabelled ?? null, top: e.unlabelled ? null : e.top, acceptable: e.unlabelled ? null : e.acceptable, u: Object.fromEntries([...e.u].map(([m, u]) => [m, round(u, 4)])) };
    };
    const headline = Object.fromEntries([1, ...FACTORS].map(f => [String(f), head(f)]));
    const comparable = f => !headline['1'].unlabelled && !headline[String(f)].unlabelled;
    // Per cell: nominal label (or its absence) and the label at each factor. Only a cell labelled at x1 and at the factor can flip or change its best mode.
    const flippedCells = [], lostLabelCells = [], topChanged = [], nominal = cells.map(c => ({ ...E(1, c), cell: c.key }));
    for (const c of cells) {
      const n = E(1, c);
      if (n.unlabelled) continue;
      const atF = Object.fromEntries(FACTORS.map(f => [String(f), E(f, c)]));
      if (FACTORS.some(f => atF[String(f)].unlabelled)) lostLabelCells.push(c.key);
      const live = FACTORS.filter(f => !atF[String(f)].unlabelled);
      if (live.some(f => atF[String(f)].label !== n.label)) flippedCells.push({ cell: c.key, nominal: n.label, ...Object.fromEntries(FACTORS.map(f => [String(f), atF[String(f)].unlabelled ? 'unlabelled' : atF[String(f)].label])) });
      if (live.some(f => atF[String(f)].top !== n.top)) topChanged.push(c.key);
    }
    // The nominal label over the grid: how many cells say workflow, no-workflow or either (and how many are unlabelled, with why), and which cells say workflow (where a break-even V or N is read from).
    const labelCounts = { workflow: 0, 'no-workflow': 0, either: 0 }, reasons = {};
    for (const e of nominal) { if (e.unlabelled) reasons[e.unlabelled] = (reasons[e.unlabelled] ?? 0) + 1; else labelCounts[e.label] += 1; }
    const unlabelledCells = nominal.filter(e => e.unlabelled).length;
    return {
      modes, headline, labelCounts, workflowCells: nominal.filter(e => !e.unlabelled && e.label === 'workflow').map(e => e.cell),
      headlineFlips: { half: comparable(0.5) && headline['0.5'].label !== headline['1'].label, double: comparable(2) && headline['2'].label !== headline['1'].label },
      headlineTopChanges: { half: comparable(0.5) && headline['0.5'].top !== headline['1'].top, double: comparable(2) && headline['2'].top !== headline['1'].top },
      grid: { cells: cells.length, labelled: cells.length - unlabelledCells, unlabelled: unlabelledCells, unlabelledReasons: reasons, flipped: flippedCells.length, fragile: flippedCells.length > 0, flippedCells, lostLabelCells: lostLabelCells.length, topChangedCells: topChanged.length },
    };
  };
  const today = viewOf(sets.today.modes), ceiling = sets.ceiling ? viewOf(sets.ceiling.modes) : null;
  const modes = job.pairing.modes;
  const passRates = Object.fromEntries(modes.map(m => [m, { nominal: round(passRate(job.rows, m, r => r.pass), 4), half: round(passRate(job.rows, m, r => at(r, 0.5)), 4), double: round(passRate(job.rows, m, r => at(r, 2)), 4) }]));
  const passes = job.rows.filter(r => r.pass).length, fails = job.rows.length - passes;
  const lostAtHalf = job.rows.filter(r => r.pass && !at(r, 0.5)).length, gainedAtDouble = job.rows.filter(r => !r.pass && at(r, 2)).length;
  return {
    job: job.id, oracle: job.oracle, family: job.family, tolerance: job.oracle === 'records' ? RECORDS_RULE : { tol: KINETICS_TOL, source: KINETICS_SOURCE },
    units: job.pairing.paired, modes, rows: job.rows.length, sources: job.sources,
    builds: job.builds.map(b => ({ mode: b.mode, usd: round(b.usd, 4), ...(b.lowerBound ? { lowerBound: true } : {}) })),
    reproduction: { rows: job.rows.length, mismatches: mismatch.length, unrecomputable, mismatchRows: mismatch.slice(0, 5).map(r => `${r.mode}/${r.unit}`) },
    failuresWithWrongExclusion: job.oracle === 'kinetics' ? job.rows.filter(r => !r.pass && r.details?.excluded?.exact === false).length : null,
    rowFlips: { passes, fails, lostAtHalf, gainedAtDouble, lostShare: passes ? round(lostAtHalf / passes, 4) : null, gainedShare: fails ? round(gainedAtDouble / fails, 4) : null },
    passRates,
    labelSets: { today: sets.today, ceiling: sets.ceiling },
    // L_today: the headline fields below. L_ceiling (jobs with ceiling arms only): the same fields in `ceiling`.
    headline: today.headline, labelCounts: today.labelCounts, workflowCells: today.workflowCells, headlineFlips: today.headlineFlips, headlineTopChanges: today.headlineTopChanges, grid: today.grid,
    ceiling: ceiling ? { headline: ceiling.headline, labelCounts: ceiling.labelCounts, workflowCells: ceiling.workflowCells, headlineFlips: ceiling.headlineFlips, headlineTopChanges: ceiling.headlineTopChanges, grid: ceiling.grid } : null,
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
      vacuousJobs: per.filter(p => p.labelSets.today.vacuous).map(p => p.job), ceilingJobs: per.filter(p => p.ceiling).map(p => p.job),
      ceilingFragileJobs: per.filter(p => p.ceiling?.grid.fragile).map(p => p.job), ceilingFragileAtHeadline: per.filter(p => p.ceiling && (p.ceiling.headlineFlips.half || p.ceiling.headlineFlips.double)).map(p => p.job),
      rowsTotal: per.reduce((s, p) => s + p.rows, 0), lostAtHalf: per.reduce((s, p) => s + p.rowFlips.lostAtHalf, 0), gainedAtDouble: per.reduce((s, p) => s + p.rowFlips.gainedAtDouble, 0),
      nominalReproduced: reproduced, flippedCells: per.reduce((s, p) => s + p.grid.flipped, 0), cells: per.reduce((s, p) => s + p.grid.cells, 0),
      labelledCells: per.reduce((s, p) => s + p.grid.labelled, 0), unlabelledCells: per.reduce((s, p) => s + p.grid.unlabelled, 0), unlabelledByJob: Object.fromEntries(per.map(p => [p.job, { today: p.grid.unlabelled, ceiling: p.ceiling ? p.ceiling.grid.unlabelled : null }])),
      topChangedCells: per.reduce((s, p) => s + p.grid.topChangedCells, 0), jobsWithTopChange: per.filter(p => p.grid.topChangedCells > 0).map(p => p.job),
    },
  };
}
