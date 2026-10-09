// Adapter: Galaxy IWC Generic-variation-analysis-reporting (pilot P1). The job is batch/tabular: its "effects" are the rows of the four
// report tables it publishes (per case = per evaluation job). Log unit: one event per table row (+ one per header), stream = table.
// Expected log = the tables the oracle itself judges against (shipped files for the shipped case; reference.mjs for the derived cases,
// itself validated against the shipped tables by the item's evaluator-health gate).
const ROOT = new URL('../../../../../experiments/replicate/items/galaxy-iwc-variation-reporting-generic-variation-analysis-reporting/', import.meta.url);
const imp = rel => import(new URL(rel, ROOT).href);

export const meta = { id: 'galaxy', title: 'galaxy: Generic-variation-analysis-reporting (P1)', variant: 'T2', difficulty: 3, split: 'dev', logUnit: 'table row of the 4 published tables, per evaluation job' };
let M;
export async function init() {
  if (M) return M;
  const [idx, orc, ctl, ref, ind] = await Promise.all(['index.mjs', 'oracle.mjs', 'controls.mjs', 'reference.mjs', 'independent-solve.mjs'].map(imp));
  M = { idx, orc, ctl, ref, ind };
  return M;
}
export const taskFor = (seed, variant = meta.variant) => M.idx.generate({ seed, split: meta.split, difficulty: meta.difficulty, taskType: variant });

const lines = t => { const ls = String(t ?? '').replace(/\r\n/g, '\n').split('\n'); while (ls.length && ls[ls.length - 1] === '') ls.pop(); return ls; };
function tableEvents(caseId, stream, text, kind) {
  const ls = lines(text), out = [];
  if (typeof text !== 'string') return out;
  ls.forEach((l, i) => out.push({ case: caseId, stream, type: i === 0 ? 'tsv.header' : 'tsv.row', key: { table: kind, cells: l.split('\t') } }));
  return out;
}
function caseEvents(caseId, t) {
  if (!t || typeof t !== 'object') return [];
  const ev = [];
  const af = t.af_recalculated && typeof t.af_recalculated === 'object' ? t.af_recalculated : {};
  for (const id of Object.keys(af)) ev.push(...tableEvents(caseId, `af_recalculated[${id}]`, af[id], 'af_recalculated'));
  for (const k of ['all_variants_all_samples', 'by_variant_report', 'combined_variant_report']) ev.push(...tableEvents(caseId, k, t[k], k));
  return ev;
}
export const logOf = (task, output) => Object.entries(output.cases ?? {}).flatMap(([id, t]) => caseEvents(id, t));
export const expectedLog = task => M.orc.battery(task).flatMap(c => caseEvents(c.caseId, M.orc.expectedOf(c)));
export const oracleOf = (task, output) => { const r = M.idx.oracle(task, output); return { pass: r.pass, score: r.score }; };

const solveAll = (task, fn) => ({ cases: Object.fromEntries(M.orc.battery(task).map(c => [c.caseId, fn(c.inputs, c)])) });
const knob = o => task => solveAll(task, inputs => M.ind.solve(inputs, o));

export function candidates() {
  const C = [];
  const add = (id, cls, kind, decidedBy, make) => C.push({ id: `galaxy/${id}`, cls, kind, decidedBy, make });
  add('independent faithful (second implementation)', undefined, 'reference', undefined, knob({}));
  add('reference.mjs', undefined, 'reference', undefined, M.ctl.referenceSolve);
  add('original (shipped tables + .ga emulator)', undefined, 'reference', undefined, M.ctl.originalControl);
  // dossier-7 classes: wrong that passed oracle v1
  add('W1 skips the DP>=1 prefilter', 'GX-W1', 'class-wrong', 'battery', knob({ prefilter: false }));
  add('W2 by-variant report grouped by POS', 'GX-W2', 'class-wrong', 'battery', knob({ byVariantKey: 'pos' }));
  add('W3 countunique per position hard-coded to 1', 'GX-W3', 'class-wrong', 'battery', knob({ posCounts: 'one' }));
  add('W4 AF threshold label printed with 2 decimals', 'GX-W4', 'class-wrong', 'battery', knob({ labelAf: 'fixed2' }));
  // correct that oracle v1 rejected
  add('C1 multi-effect record keeps the highest-impact effect', 'GX-C1', 'class-correct', 'expected-log', knob({ effectPick: 'maxImpact' }));
  // residual
  add('R1 Math.round instead of Python round at exact ties', 'GX-R1', 'class-residual', 'battery', knob({ round: 'js' }));
  // further knobs of the independent solver (wrong in the item's own tests) and the item's mutation/bad controls
  add('min/max over PASS rows only', undefined, 'control-wrong', undefined, knob({ minmaxPassOnly: true }));
  add('countunique over PASS rows only', undefined, 'control-wrong', undefined, knob({ countPassOnly: true }));
  add('combined table keeps PASS rows only', undefined, 'control-wrong', undefined, knob({ combinedPassOnly: true }));
  add('combined table sorted POS-first', undefined, 'control-wrong', undefined, knob({ combinedPosFirst: true }));
  add('min/max printed raw (same text on these values)', undefined, 'control-correct', undefined, knob({ minmaxFmt: 'raw' }));
  for (const m of M.ref.MUTATIONS) add(`mutation:${m}`, undefined, 'control-wrong', undefined, task => solveAll(task, inputs => M.ref.runJob(inputs, { mutation: m })));
  for (const b of M.ctl.badControls.filter(b => !b.name.startsWith('mutation:'))) add(`bad ${b.name}`, undefined, 'control-wrong', undefined, b.make);
  return C;
}
