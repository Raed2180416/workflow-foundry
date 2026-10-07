// Bed family `kinetics` (scientific data analysis): enzyme-kinetics lab notebooks in mixed
// formats and units -> per-condition Michaelis-Menten parameters plus the SOP exclusion set.
// See README.md for knobs, oracle rule and the adversarial content per difficulty.
import { estimateTokens } from '../lib/canonical.mjs';
import { buildWorld, VERSION, TOL, KNOBS } from './world.mjs';
import { renderTask, RATE_FACTOR } from './render.mjs';
import { fitMM, relErr } from './fit.mjs';

export const family = {
  id: 'kinetics',
  domain: 'scientific data analysis',
  version: VERSION,
  kind: 'oneshot',
  description: 'Clean heterogeneous enzyme-kinetics notebook exports (mixed units and formats, SOP exclusions stated in rows or in later messages, notes that look like exclusions but are not, corrections by the author versus rejected suggestions by others, re-reads, competitive inhibition) and fit Vmax/Km per condition.',
};

export const outputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['conditions', 'excluded_samples'],
  properties: {
    conditions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['condition_id', 'vmax', 'km'],
        properties: {
          condition_id: { type: 'string' },
          // portable subset (src/schema-subset.mjs) has no exclusiveMinimum: 0 is schema-valid and simply
          // misses the tolerance (relative error 1)
          vmax: { type: 'number', minimum: 0, description: 'Vmax in µM/s' },
          km: { type: 'number', minimum: 0, description: 'Km in µM' },
        },
      },
    },
    excluded_samples: { type: 'array', items: { type: 'string' } },
  },
};

// ---------------------------------------------------------------------------------------
const cache = new Map();
function build(seed, split, difficulty) {
  if (split !== 'dev' && split !== 'test') throw new Error(`kinetics: split must be 'dev' or 'test' (got ${split})`);
  const d = Number(difficulty);
  const key = `${split}\u0000${seed}\u0000${d}`;
  if (cache.has(key)) return cache.get(key);
  const world = buildWorld({ seed, split, difficulty: d });
  const { prompt, inputs, shown } = renderTask(world, { seed, split, difficulty: d });
  const built = { world, prompt, inputs, shown };
  cache.set(key, built);
  if (cache.size > 48) cache.delete(cache.keys().next().value);
  return built;
}

export function generate({ seed, split = 'dev', difficulty = 3 }) {
  const built = build(seed, split, difficulty);
  // a fresh copy per call: a caller that edits task.inputs must not change later tasks (or the cache)
  const prompt = built.prompt, inputs = structuredClone(built.inputs);
  const d = Number(difficulty);
  const tokens = estimateTokens(prompt) + estimateTokens(inputs);
  return {
    id: `kinetics:${split}:d${d}:${seed}`,
    family: family.id, seed, split, difficulty: d,
    prompt, inputs,
    budget: { inputTokensEstimate: tokens, suggestedMaxActions: 20 + 15 * d, suggestedMaxOutputTokens: 2000 + 500 * d },
  };
}

// ---------------------------------------------------------------------------------------
// Fitting helpers shared by referenceSolve, the oracle self-check and the bad controls.
function fitAll(world, pointsByCond) {
  const fits = {};
  for (const c of world.conds.filter(x => !x.parentId)) fits[c.id] = fitMM(pointsByCond[c.id] ?? []);
  for (const c of world.conds.filter(x => x.parentId)) fits[c.id] = fitMM(pointsByCond[c.id] ?? [], { fixedV: fits[c.parentId].vmax });
  return fits;
}
const toOutput = (world, fits, excluded) => ({
  conditions: world.conds.map(c => ({ condition_id: c.id, vmax: fits[c.id].vmax, km: fits[c.id].km })),
  excluded_samples: [...excluded].sort(),
});
const outlierIds = world => world.wells.filter(w => w.status === 'outlier').map(w => w.id);

// view: how a (possibly careless) reader assembles the points for each condition
function assemble(world, shown, { keepOutliers = false, condOf = w => w.condId, point = (w, s) => ({ S: s.S, v: s.rate }) } = {}) {
  const by = Object.fromEntries(world.conds.map(c => [c.id, []]));
  for (const w of world.wells) {
    if (!keepOutliers && w.status === 'outlier') continue;
    by[condOf(w)].push(point(w, shown[w.id]));
  }
  return by;
}

function referenceFits(world, shown) { return fitAll(world, assemble(world, shown)); }

export function referenceSolve(task) {
  const { world, shown } = build(task.seed, task.split, task.difficulty);
  return toOutput(world, referenceFits(world, shown), outlierIds(world));
}

// ---------------------------------------------------------------------------------------
// Schema validation: exactly outputSchema (portable subset), hand-rolled (no dependency on ajv). Arrays are
// walked by index, so holes in a non-JSON array are reported instead of crashing the oracle; numbers must
// be finite JSON numbers >= 0 (schema `minimum: 0`); a value of 0 is valid and fails the tolerance.
const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
// [AUDIT F28] validation stops after MAX_ERRORS errors: a sparse array of length 2^32-1 (possible for a non-JSON caller)
// is rejected at its first holes instead of being walked for minutes
const MAX_ERRORS = 20;
export function validateOutput(out) {
  const errs = [];
  if (!isPlain(out)) return ['output must be an object'];
  for (const k of Object.keys(out)) if (!['conditions', 'excluded_samples'].includes(k)) errs.push(`unexpected property ${k}`);
  if (!Array.isArray(out.conditions)) errs.push('conditions must be an array');
  else for (let i = 0; i < out.conditions.length && errs.length < MAX_ERRORS; i++) {
    const c = out.conditions[i];
    if (!isPlain(c)) { errs.push(`conditions[${i}] must be an object`); continue; }
    for (const k of Object.keys(c)) if (!['condition_id', 'vmax', 'km'].includes(k)) errs.push(`conditions[${i}] unexpected property ${k}`);
    if (!Object.hasOwn(c, 'condition_id') || typeof c.condition_id !== 'string') errs.push(`conditions[${i}].condition_id must be a string`);
    for (const k of ['vmax', 'km']) if (!Object.hasOwn(c, k) || typeof c[k] !== 'number' || !Number.isFinite(c[k]) || c[k] < 0) errs.push(`conditions[${i}].${k} must be a finite number >= 0`);
  }
  if (!Array.isArray(out.excluded_samples)) errs.push('excluded_samples must be an array');
  else for (let i = 0; i < out.excluded_samples.length && errs.length < MAX_ERRORS; i++) if (typeof out.excluded_samples[i] !== 'string') errs.push(`excluded_samples[${i}] must be a string`);
  return errs;
}

export function oracle(task, output) {
  const schemaErrors = validateOutput(output);
  if (schemaErrors.length) return { pass: false, score: 0, details: { reason: 'schema-invalid', schemaErrors } };
  const { world, shown } = build(task.seed, task.split, task.difficulty);
  // Evaluator health: the correctly cleaned data, fitted by standard NLLS, must land within tolerance.
  const ref = referenceFits(world, shown);
  const refErrors = world.conds.map(c => ({ id: c.id, vmax: relErr(ref[c.id].vmax, c.vmax), km: relErr(ref[c.id].km, c.km) }));
  const evaluatorValid = refErrors.every(e => e.vmax <= TOL && e.km <= TOL);

  const seen = new Map(), dupes = [], unknown = [];
  for (const c of output.conditions) {
    if (!Object.hasOwn(world.byId, c.condition_id)) { unknown.push(c.condition_id); continue; }
    if (seen.has(c.condition_id)) dupes.push(c.condition_id);
    seen.set(c.condition_id, c);
  }
  const perCondition = world.conds.map(c => {
    const o = seen.get(c.id);
    if (!o) return { id: c.id, ok: false, missing: true };
    const ev = relErr(o.vmax, c.vmax), ek = relErr(o.km, c.km);
    return { id: c.id, ok: ev <= TOL && ek <= TOL && !dupes.includes(c.id), vmaxRelErr: Number(ev.toFixed(4)), kmRelErr: Number(ek.toFixed(4)) };
  });
  const truthSet = new Set(outlierIds(world));
  const got = new Set(output.excluded_samples);
  const missing = [...truthSet].filter(x => !got.has(x)).sort();
  const extra = [...got].filter(x => !truthSet.has(x)).sort();
  const inter = [...got].filter(x => truthSet.has(x)).length;
  const union = new Set([...truthSet, ...got]).size;
  const jaccard = union ? inter / union : 1;
  const condFrac = perCondition.filter(p => p.ok).length / perCondition.length;
  const setExact = missing.length === 0 && extra.length === 0;
  const pass = evaluatorValid && setExact && condFrac === 1 && unknown.length === 0 && dupes.length === 0;
  // partial credit; unknown or duplicated condition entries dilute it, and only a passing output scores 1
  const raw = (0.75 * condFrac + 0.25 * jaccard) * perCondition.length / (perCondition.length + unknown.length + dupes.length);
  const score = evaluatorValid ? (pass ? 1 : Math.min(0.999, Number(raw.toFixed(4)))) : 0;
  return {
    pass, score,
    details: {
      evaluatorValid, tolerance: TOL, perCondition, unknownConditions: unknown, duplicateConditions: dupes,
      excluded: { exact: setExact, missing, extra, jaccard: Number(jaccard.toFixed(4)), expectedCount: truthSet.size },
      referenceRelErrors: refErrors.map(e => ({ id: e.id, vmax: Number(e.vmax.toFixed(4)), km: Number(e.km.toFixed(4)) })),
    },
  };
}

// ---------------------------------------------------------------------------------------
// Known-bad controls. Every one must fail on every task at every difficulty.
export const badControls = [
  { name: 'empty', make: () => ({ conditions: [], excluded_samples: [] }) },
  {
    name: 'shuffled-or-corrupted',
    make(task) { // right numbers attached to the wrong conditions
      const ref = referenceSolve(task);
      const n = ref.conditions.length;
      return { ...ref, conditions: ref.conditions.map((c, i) => ({ condition_id: c.condition_id, vmax: ref.conditions[(i + 1) % n].vmax, km: ref.conditions[(i + 1) % n].km })) };
    },
  },
  {
    name: 'plausible-but-wrong:keep-outliers',
    make(task) { // careful units and corrections, but no SOP exclusions at all
      const { world, shown } = build(task.seed, task.split, task.difficulty);
      return toOutput(world, fitAll(world, assemble(world, shown, { keepOutliers: true })), []);
    },
  },
  {
    name: 'plausible-but-wrong:over-exclude-decoys',
    make(task) { // also excludes popped bubbles, LOW flags, edge wells, "looks off" notes...
      const { world } = build(task.seed, task.split, task.difficulty);
      const ref = referenceSolve(task);
      return { ...ref, excluded_samples: [...ref.excluded_samples, ...world.wells.filter(w => w.status === 'decoy').map(w => w.id)].sort() };
    },
  },
  {
    name: 'plausible-but-wrong:ignore-units',
    make(task) { // takes every number at face value as µM and µM/s (corrections and exclusions right)
      const { world, shown } = build(task.seed, task.split, task.difficulty);
      const swapPartner = {};
      for (const t of world.traps.filter(x => x.type === 'swap')) { swapPartner[t.a] = t.b; swapPartner[t.b] = t.a; }
      const pts = assemble(world, shown, { point: (w, s) => ({ S: shown[swapPartner[w.id] ?? w.id].rawS, v: s.rawRate }) });
      return toOutput(world, fitAll(world, pts), outlierIds(world));
    },
  },
  {
    name: 'plausible-but-wrong:ignore-corrections',
    make(task) { // units and exclusions right, but later corrections (labels, swaps, header units) and the raw-export cross-check not applied
      const { world, shown } = build(task.seed, task.split, task.difficulty);
      const pts = assemble(world, shown, { condOf: w => world.seriesByKey[w.series].labelCondId, point: (w, s) => ({ S: s.rowS, v: s.rateHeaderTranscribed ?? s.rateHeader }) });
      return toOutput(world, fitAll(world, pts), outlierIds(world));
    },
  },
  {
    name: 'plausible-but-wrong:one-exclusion-missed',
    make(task) { // everything right except one SOP-excluded well kept in the data and the list
      const { world, shown } = build(task.seed, task.split, task.difficulty);
      const ids = outlierIds(world);
      const keep = ids[ids.length - 1];
      const pts = assemble(world, shown, { keepOutliers: true });
      for (const c of world.conds) pts[c.id] = [];
      for (const w of world.wells) if (w.status !== 'outlier' || w.id === keep) pts[w.condId].push({ S: shown[w.id].S, v: shown[w.id].rate });
      return toOutput(world, fitAll(world, pts), ids.filter(x => x !== keep));
    },
  },
  {
    name: 'plausible-but-wrong:apply-rejected-claims',
    make(task) { // also applies the suggestions that the entry's author rejected (SOP section 4: they are not corrections)
      const { world, shown } = build(task.seed, task.split, task.difficulty);
      const moveTo = {}, swapS = {}, rateScale = {};
      for (const c of world.claims) {
        if (c.kind === 'reassign') for (const id of world.seriesByKey[c.series].wells) moveTo[id] = c.claimed;
        if (c.kind === 'swap') { swapS[c.a] = c.b; swapS[c.b] = c.a; }
        if (c.kind === 'units') { const d = world.docs[c.doc]; for (const key of d.series) for (const id of world.seriesByKey[key].wells) rateScale[id] = RATE_FACTOR[d.rateUnit] / RATE_FACTOR[c.claimedUnit]; }
      }
      const pts = assemble(world, shown, { condOf: w => moveTo[w.id] ?? w.condId, point: (w, s) => ({ S: swapS[w.id] ? shown[swapS[w.id]].S : s.S, v: s.rate * (rateScale[w.id] ?? 1) }) });
      return toOutput(world, fitAll(world, pts), outlierIds(world));
    },
  },
  {
    name: 'plausible-but-wrong:ignore-dose',
    make(task) { // [AUDIT F24] everything right except the enzyme-dose rescaling from the master-mix log (d3+; at d1-d2 there
      // is no dose correction, so this control is the reference with one Km 15% low)
      const { world, shown } = build(task.seed, task.split, task.difficulty);
      if (!world.dose) { const ref = referenceSolve(task); const c0 = world.conds[0]; return { ...ref, conditions: ref.conditions.map(c => (c.condition_id === c0.id ? { ...c, km: c0.km * 0.85 } : c)) }; }
      return toOutput(world, fitAll(world, assemble(world, shown, { point: (w, s) => ({ S: s.S, v: s.rate * s.doseFactor }) })), outlierIds(world));
    },
  },
  {
    name: 'plausible-but-wrong:exclude-by-residual',
    make(task) { // perfect parsing and corrections, but exclusions by a residual rule (>15% off the reference curve) instead of the SOP notes
      const { world, shown } = build(task.seed, task.split, task.difficulty);
      const ref = referenceFits(world, shown);
      const out = world.wells.filter(w => { const f = ref[w.condId], s = shown[w.id]; return Math.abs(s.rate / (f.vmax * s.S / (f.km + s.S)) - 1) > 0.15; }).map(w => w.id);
      const drop = new Set(out);
      const pts = Object.fromEntries(world.conds.map(c => [c.id, []]));
      for (const w of world.wells) if (!drop.has(w.id)) pts[w.condId].push({ S: shown[w.id].S, v: shown[w.id].rate });
      return toOutput(world, fitAll(world, pts), out);
    },
  },
  {
    name: 'near-miss:km-12pct',
    make(task) { // tolerance probe: one Km 12% above truth, everything else from the reference
      const { world } = build(task.seed, task.split, task.difficulty);
      const ref = referenceSolve(task);
      const c0 = world.conds[0];
      return { ...ref, conditions: ref.conditions.map(c => (c.condition_id === c0.id ? { ...c, km: c0.km * 1.12 } : c)) };
    },
  },
];

// Diagnostics for tests and README (not part of the contract).
export function _internals(task) { return build(task.seed, task.split, task.difficulty); }
export function _clearCache() { cache.clear(); }
export { fitAll as _fitAll, assemble as _assemble };
export { KNOBS, TOL };
