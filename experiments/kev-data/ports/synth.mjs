// Generator for the synth bed group (JUDGE-PROGRAM.md §1.2 group S, X1, X2, X4, X5, X7, X8; §2.2 interface, §2.3 rules, §2.5
// variants, §3 splits; JUDGE-BUILD-PLAN.json group "synth").
//
//   S2        value_provenance  where a reported value comes from (own measurement, quoted, projected, instruction-like); the
//                               synth-values tap aligns every claim with one passage (taps/synth-values.mjs)
//   X5:synth  precondition_holds  ranking-policy and standard-condition assumptions against the windows of the task prompt
//   X1:synth  injected_instruction  the bed's injection sentence and its hard negatives, plus train-pool and held-out lines
//   X8:synth  value_consistent  held-out family (test-ood only): a cell value converted by toCanon against the unconverted,
//                               wrong-unit or uncorrected value
//   wave-2 smoke  S3 condition_standard (wave-1 size when the tap fails), S4 variant_form, S1 notice_target, X2:synth,
//                 X4:synth, X7:synth; wave 3: S5 document_kind
//
// Pure: the same (slice, seeds, opts, factory version, bed pin) gives the same records in the same order. Every choice is a
// salted hash of the record key: no Math.random, no clock, no network. Beds are imported through ctx.beds (the frozen copy);
// the port kit (judges/synth.mjs), the tap (taps/synth-values.mjs) and the solvers import no bed. This file never reads the
// held-out directory: held-out wordings and lines reach it only through `opts` (data), supplied by the assembly.
//
// opts (all optional, plain data):
//   ports         port ids to produce ('S2', 'X5:synth', 'X1', ...; default: SLICE_PORTS[slice])
//   difficulties  bed difficulties seeds are spread over (default [3, 4, 5]: the S2 population)
//   rows          { S2: n, 'X5:synth': n, ... } rows to draw (default TARGETS; a shortfall is reported, never padded)
//   wordings      { S2: [{id, text, slice?}], X5: [...], X1: [...], X8: [...] } the held-out wordings (OOD slices; required there)
//   lines         authored lines (train-pool and held-out-store schema): { port, role, label, target?, text, slice?, ... }
//   pools         { dir, digest } train pool files <dir>/X1.jsonl (verified against the digest)
//   builtin       false: no built-in authored lines (ports/synth-lines.mjs) in train-like slices
//   s2Wave        2: the synth-values tap missed its gate; S2 is a wave-2 smoke set and S3 is produced at S2's wave-1 size
//   unseenNames   S5: [{name, kind}] the authored unseen type names (the assembly reads them from the held-out store)
//   cap           false: no 3:1 cap of the S2 train labels (rule 9; tests of volume only)
//   smokeEvery    a wave-2 smoke port draws from one world in `smokeEvery` (default 1: all worlds; the draw is by quota)
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { assertNoReserved } from '../lib/registry.mjs';
import { bump, fail, loadWorld, difficultyOf, DEFAULT_DIFFICULTIES, OOD } from './synth-core.mjs';
import { s2Candidates, s2Records, S2_LABELS, NATURAL_RATES } from './synth-s2.mjs';
import { x5Candidates, x5Records } from './synth-x5.mjs';
import { x1Candidates, x1Records, authoredLines, authoredCandidates } from './synth-x1.mjs';
import { x8Candidates, x8ErratumCandidates, x8Records, heldoutSpans, registerHeldout } from './synth-x8.mjs';
import { s3Candidates, s4Candidates, s5Candidates, s5Unseen, s1Candidates, x2Candidates, x4Candidates, x7Candidates, smokeRecords, sizeOf } from './synth-smoke.mjs';

export const group = 'synth';
export const ports = ['S2', 'X5:synth', 'X1:synth', 'X8:synth', 'S3', 'S4', 'S1', 'S5', 'X2:synth', 'X4:synth', 'X7:synth'];
export const GENERATOR_VERSION = 'synth@1';

// Rows at the 20K curve point (JUDGE-PROGRAM.md §4.3; derivation): a hard port gets 1,935 train rows, split evenly over its train
// families (X5 four, X1 six); evaluation sets per port: calib-in 300, calib-ood 500 (X5 1,000, X1 600), dev-select 200, dev-ood 600
// (X5 1,000), test-in 500; test-ood per axis (S2: template 600, paraphrase 400, adversarial 800 rows, unknowable 300, balanced copy
// 400; X5 and X1 an even share of their in-family axes; X8 the synth family 600). Wave-2 smoke sets: about 300 train and 100 dev-select rows.
export const TARGETS = Object.freeze({
  S2: Object.freeze({ train: 1935, 'calib-in': 300, 'calib-ood': 500, 'dev-select': 200, 'dev-ood': 600, 'test-in': 500, 'test-ood': 2500 }),
  'X5:synth': Object.freeze({ train: 484, 'calib-in': 75, 'calib-ood': 250, 'dev-select': 50, 'dev-ood': 250, 'test-in': 125, 'test-ood': 775 }),
  'X1:synth': Object.freeze({ train: 322, 'calib-in': 50, 'calib-ood': 100, 'dev-select': 33, 'dev-ood': 100, 'test-in': 83, 'test-ood': 692 }),
  'X8:synth': Object.freeze({ 'test-ood': 600 }),
});
export const SMOKE_PORTS = Object.freeze(['S3', 'S4', 'S1', 'S5', 'X2:synth', 'X4:synth', 'X7:synth']);
export const HELD_OUT_PORTS = Object.freeze(['X8:synth']);
export const SLICE_PORTS = Object.freeze({
  train: ['S2', 'X5:synth', 'X1:synth', ...SMOKE_PORTS], 'calib-in': ['S2', 'X5:synth', 'X1:synth'], 'calib-ood': ['S2', 'X5:synth', 'X1:synth'],
  'dev-select': ['S2', 'X5:synth', 'X1:synth', ...SMOKE_PORTS], 'dev-ood': ['S2', 'X5:synth', 'X1:synth'], 'test-in': ['S2', 'X5:synth', 'X1:synth'],
  'test-ood': ['S2', 'X5:synth', 'X1:synth', 'X8:synth'], 'real-reserve': [], 'e2e-reserve': [],
});
export const PLAN_ROWS = Object.freeze({ train: 2742, calib: 1275, testIn: 708, testOOD: 4567, dev: 1233 });

// diagnostics of the last records() run (counts of drops and kept variants, draw reports): read by tests and reports
export const REPORT = { counts: {}, draws: {} };
export const describe = () => REPORT;

function makeContext(slice, opts, ctx) {
  const o = { ...(opts ?? {}) };
  return { slice, ctx, contracts: ctx.contracts, def: ctx.slice, opts: o, ood: OOD.has(slice), counts: {}, targets: TARGETS, bed: null };
}
const wantedPorts = (slice, opts) => {
  const asked = opts.ports ?? SLICE_PORTS[slice] ?? [];
  const want = new Set(asked.map(String).map(p => (['X5', 'X1', 'X2', 'X4', 'X7', 'X8'].includes(p) ? `${p}:synth` : p)));
  // the synth-values tap missed its gate: S2 is a wave-2 smoke set (train and dev-select) and S3 is produced at S2's wave-1 size
  if (opts.s2Wave === 2) {
    if (!opts.ports) { want.add('S3'); if (!['train', 'dev-select'].includes(slice)) want.delete('S2'); }
  }
  if (slice === 'test-ood' && opts.unseenNames?.length && !opts.ports) want.add('S5');
  return want;
};

export async function* records(slice, seeds, opts = {}, ctx) {
  const G = makeContext(slice, opts, ctx), want = wantedPorts(slice, G.opts);
  for (const p of want) if (HELD_OUT_PORTS.includes(p) && slice !== 'test-ood') throw fail('HELDOUT_FAMILY', `${p} is a held-out family (test-ood only, §3.4); it is not generated in ${slice}`);
  if (!want.size) return;
  const diffs = G.opts.difficulties ?? DEFAULT_DIFFICULTIES;
  // a reserved world (dev seeds 1-400, the real and e2e reserves outside their slices) never enters a file (§2.3 rule 8)
  assertNoReserved([...seeds].map(seed => ({ bed: 'synth', split: G.def.bedSplit, difficulty: difficultyOf(seed, diffs), seed })), slice);
  const worlds = new Map(), pool = { S2: [], X5: [], X1: [], X8: [], S3: [], S4: [], S5: [], S1: [], 'X2:synth': [], 'X4:synth': [], 'X7:synth': [] };
  const lines = want.has('X1:synth') ? authoredLines(G) : [], perWorldLines = G.opts.authoredPerWorld ?? 2;
  const smoke = new Set([...want].filter(p => SMOKE_PORTS.includes(p) && p !== 'S5'));
  for (const seed of seeds) {
    const W = await loadWorld(G, seed, difficultyOf(seed, diffs));
    worlds.set(seed, W);
    if (want.has('S2')) pool.S2.push(...s2Candidates(G, W));
    if (want.has('X5:synth')) pool.X5.push(...x5Candidates(G, W));
    if (want.has('X1:synth')) pool.X1.push(...x1Candidates(G, W), ...authoredCandidates(G, W, lines, perWorldLines));
    if (want.has('X8:synth')) pool.X8.push(...x8Candidates(G, W), ...x8ErratumCandidates(G, W));
    if (smoke.has('S3')) pool.S3.push(...s3Candidates(G, W));
    if (smoke.has('S4')) pool.S4.push(...s4Candidates(G, W));
    if (smoke.has('S1')) pool.S1.push(...s1Candidates(G, W));
    if (smoke.has('X2:synth')) pool['X2:synth'].push(...x2Candidates(G, W));
    if (smoke.has('X4:synth')) pool['X4:synth'].push(...x4Candidates(G, W));
    if (smoke.has('X7:synth')) pool['X7:synth'].push(...x7Candidates(G, W));
    if (want.has('S5')) pool.S5.push(...(slice === 'test-ood' ? s5Unseen(G, W, G.opts.unseenNames) : s5Candidates(G, W)));
  }
  REPORT.counts = G.counts; REPORT.draws = {};
  if (want.has('S2')) {
    const { records: rs, report } = s2Records(G, pool.S2, worlds);
    REPORT.draws.S2 = report;
    for (const r of rs) { if (G.opts.s2Wave === 2) r.meta.wave = 2; yield r; }
  }
  if (want.has('X5:synth')) { const { records: rs, report } = x5Records(G, pool.X5, worlds); REPORT.draws.X5 = report; for (const r of rs) yield r; }
  if (want.has('X1:synth')) { const { records: rs, report } = x1Records(G, pool.X1, worlds); REPORT.draws.X1 = report; for (const r of rs) yield r; }
  if (want.has('X8:synth')) { const { records: rs, report } = x8Records(G, pool.X8, worlds); REPORT.draws.X8 = report; for (const r of rs) yield r; }
  for (const port of ['S3', 'S4', 'S1', 'S5', 'X2:synth', 'X4:synth', 'X7:synth']) {
    if (!want.has(port)) continue;
    const id = port.split(':')[0], { records: rs, report } = smokeRecords(G, id, pool[port], worlds, port === 'S5' && slice === 'test-ood' ? { n: Math.min(G.opts.unseenNames?.length ?? 0, G.opts.rows?.S5 ?? 1e9) } : {});
    REPORT.draws[id] = report;
    for (const r of rs) { if (id === 'S3' && G.opts.s2Wave === 2) r.meta.wave = 1; yield r; }
  }
}

// ---- class support (§2.7 step 8): label x difficulty, forms = distinct masked surface forms ----------------------------------
export function classSupport(recs, { minForms = 30, label = r => Object.values(r.questions)[0].label } = {}) {
  const cells = {};
  for (const r of recs) {
    const l = label(r), d = `d${r.meta.difficulty}`, c = ((cells[l] ??= {})[d] ??= { rows: 0, forms: new Set(), worlds: new Set() });
    c.rows++; c.forms.add(r.meta.formId); c.worlds.add(r.meta.seed);
  }
  const out = {};
  for (const [l, byD] of Object.entries(cells)) for (const [d, c] of Object.entries(byD)) (out[l] ??= {})[d] = { rows: c.rows, forms: c.forms.size, worlds: c.worlds.size, diagnostic: c.forms.size < minForms };
  return out;
}
export const formsPerLabel = (recs, label = r => Object.values(r.questions)[0].label) => {
  const m = {};
  for (const r of recs) (m[label(r)] ??= new Set()).add(r.meta.formId);
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.size]));
};
export { S2_LABELS, NATURAL_RATES, heldoutSpans, registerHeldout };
