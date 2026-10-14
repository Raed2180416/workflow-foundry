// Output schema and exact scorer for W-bed R3' (PROOF-LEDGER J5). The hidden manifest is the list of planted defects as
// (file, function, class). A finding is VERIFIED when its (file, function, class) is a manifest entry; that is the only
// thing the pass rule reads. Precision, recall and F1 are computed per class and pooled (micro), with every false
// positive attributed to a cause (duplicate, unknown location, out-of-scope class, wrong class on a real defect, a caller
// that only inherits a helper's defect, a decoy, a clean function). An optional witness on a verified finding is RUN:
// its arguments must lie in the function's stated domain, and the planted and the correct function must behave
// differently on them. Cost is never read from the output: cost per verified finding takes the host-measured cost.
import { validate } from '../lib/contracts.mjs';
import { CLASSES } from './vocab.mjs';
import { observe, sameObs, argsOk, GEN_TIMEOUT_MS } from './exec.mjs';

export const LIMITS = { findings: 6000 };
/** The pass rule (declared; W-BED §2.2 item 1 analogue for a sweep): micro precision and recall over (file, function,
 *  class), with one false positive always tolerated (so a 6-defect task does not fail on a single extra finding; review
 *  2026-10-14 finding 3). Equivalently: recall >= 0.80 and false positives <= max(1, verified / 9). */
export const PASS = Object.freeze({ precision: 0.9, recall: 0.8, fpTolerated: 1 });
export const passes = (tp, fp, defects) => defects > 0 && tp / defects >= PASS.recall && (fp <= PASS.fpTolerated || tp / (tp + fp) >= PASS.precision);

const str = n => ({ type: 'string', maxLength: n });
export const outputSchema = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: { type: 'array', maxItems: LIMITS.findings, items: { type: 'object', required: ['file', 'function', 'class'],
      properties: { file: str(200), function: str(100), class: { type: 'string', enum: CLASSES }, line: { type: 'integer' },
        witness: { type: 'object', required: ['args'], properties: { args: { type: 'array', maxItems: 8 } } }, note: str(400) } } },
  },
};

export const normFile = s => String(s).trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^(files|repo)\//, '').toLowerCase();
export const keyOf = (file, fn, cls) => `${normFile(file)}|${String(fn).trim()}|${cls}`;
const locOf = (file, fn) => `${normFile(file)}|${String(fn).trim()}`;
const ratio = (a, b) => (b === 0 ? null : a / b);
const f1Of = (p, r) => (p === null || r === null || p + r === 0 ? 0 : (2 * p * r) / (p + r));
const round6 = x => (x === null ? null : Math.round(x * 1e6) / 1e6);

function snapshotOutput(output) {
  try {
    if (output && typeof output === 'object' && Array.isArray(output.findings) && output.findings.length > LIMITS.findings) return { oversized: true };
    return structuredClone(output);
  } catch { return undefined; }
}

/** Is `args` a witness for function record `f` of `world`: valid per its domain, and planted != correct on it. */
export function witnessHolds(world, f, args) {
  if (!argsOk(f, args)) return { ok: false, why: 'outside-domain' };
  const run = ctx => { const o = observe(ctx, f.name, args); return o.throws === 'Timeout' ? observe(ctx, f.name, args, GEN_TIMEOUT_MS) : o; };
  const a = run(world.planted), b = run(world.correct);
  if (a.throws === 'Timeout' || b.throws === 'Timeout') return { ok: false, why: 'timeout' }; // a timeout is never a difference
  return sameObs(a, b) ? { ok: false, why: 'no-difference' } : { ok: true };
}

/** Score `raw` against the world's manifest. */
export function scoreSweep(world, raw) {
  const out = snapshotOutput(raw);
  const errors = out === undefined ? ['$: not plain JSON-like data'] : out?.oversized ? ['$.findings: oversized'] : validate(outputSchema, out);
  if (errors.length) return { pass: false, score: 0, details: { reason: 'schema-invalid', errors: errors.slice(0, 8) } };
  const scope = world.L.classes;
  const truthAt = new Map(world.manifest.map(m => [locOf(m.file, m.function), m]));
  const fnAt = new Map(world.fns.map(f => [locOf(f.path, f.name), f]));
  const per = Object.fromEntries(scope.map(c => [c, { tp: 0, fp: 0, fn: 0 }]));
  const why = { duplicate: 0, unknown: 0, outOfScope: 0, wrongClass: 0, caller: 0, decoy: 0, clean: 0 };
  const wit = { given: 0, valid: 0, outsideDomain: 0, noDifference: 0, timeout: 0 };
  const seen = new Set(), credited = new Set();
  let tp = 0, fp = 0, viaAlt = 0;
  for (const x of out.findings) {
    const k = keyOf(x.file, x.function, x.class);
    const bump = () => { fp++; if (per[x.class]) per[x.class].fp++; };
    if (seen.has(k)) { why.duplicate++; bump(); continue; }
    seen.add(k);
    const m = truthAt.get(locOf(x.file, x.function));
    if (m && (m.accepted ?? [m.class]).includes(x.class)) {
      if (credited.has(m.id)) { why.duplicate++; bump(); continue; } // the same defect again under its other accepted class
      credited.add(m.id);
      tp++; per[m.class].tp++; // true positives count under the defect's (primary) class
      if (x.class !== m.class) viaAlt++;
      if (x.witness) {
        wit.given++;
        const h = witnessHolds(world, fnAt.get(locOf(m.file, m.function)), x.witness.args);
        if (h.ok) wit.valid++; else if (h.why === 'outside-domain') wit.outsideDomain++; else if (h.why === 'timeout') wit.timeout++; else wit.noDifference++;
      }
      continue;
    }
    bump();
    const f = fnAt.get(locOf(x.file, x.function));
    if (!f) why.unknown++;
    else if (!scope.includes(x.class)) why.outOfScope++;
    else if (f.role === 'defect') why.wrongClass++;
    else if (f.affected) why.caller++;
    else if (f.role === 'decoy') why.decoy++;
    else why.clean++;
  }
  for (const m of world.manifest) if (!credited.has(m.id)) per[m.class].fn++;
  const D = world.manifest.length, n = out.findings.length;
  const precision = ratio(tp, tp + fp), recall = ratio(tp, D);
  const f1 = f1Of(precision, recall);
  const byClass = Object.fromEntries(Object.entries(per).map(([c, x]) => {
    const p = ratio(x.tp, x.tp + x.fp), r = ratio(x.tp, x.tp + x.fn);
    return [c, { ...x, precision: round6(p), recall: round6(r), f1: round6(f1Of(p, r)) }];
  }));
  const macroF1 = Object.values(byClass).reduce((s, x) => s + x.f1, 0) / scope.length;
  const pass = passes(tp, fp, D);
  return { pass, score: round6(f1),
    details: { defects: D, findings: n, verified: tp, verifiedViaAcceptedClass: viaAlt, falsePositives: fp, missed: D - tp, precision: round6(precision), recall: round6(recall), f1: round6(f1),
      macroF1: round6(macroF1), byClass, fpCauses: why, witness: { ...wit, witnessed: wit.valid } } };
}

/** Cost per verified finding for one task: `costUsd` comes from the host journal, never from the solver's output. */
export function costPerVerifiedFinding(result, costUsd) {
  const verified = result?.details?.verified ?? 0, witnessed = result?.details?.witness?.witnessed ?? 0;
  return { costUsd, verified, witnessed, perVerified: verified ? costUsd / verified : null, perWitnessed: witnessed ? costUsd / witnessed : null };
}

/** Pool a stream (or an arm's tasks): rows [{ result, costUsd? }]. Per-class and micro P/R/F1 over pooled counts, pass
 *  rate, and cost per verified finding = total cost / total verified findings (failed tasks' cost included). */
export function aggregateSweeps(rows) {
  const per = {};
  let tp = 0, fp = 0, fn = 0, cost = 0, costKnown = true, passes = 0, witnessed = 0;
  for (const { result, costUsd } of rows) {
    const d = result.details;
    if (result.pass) passes++;
    if (typeof costUsd === 'number') cost += costUsd; else costKnown = false;
    if (!d || d.reason === 'schema-invalid') { continue; }
    tp += d.verified; fp += d.falsePositives; fn += d.missed; witnessed += d.witness.witnessed;
    for (const [c, x] of Object.entries(d.byClass)) { per[c] ??= { tp: 0, fp: 0, fn: 0 }; per[c].tp += x.tp; per[c].fp += x.fp; per[c].fn += x.fn; }
  }
  // schema-invalid tasks still owe their defects to recall
  for (const { result, defects } of rows) if (result.details?.reason === 'schema-invalid' && Number.isInteger(defects)) fn += defects;
  const p = ratio(tp, tp + fp), r = ratio(tp, tp + fn);
  return { tasks: rows.length, passes, passRate: rows.length ? passes / rows.length : null, verified: tp, falsePositives: fp, missed: fn, witnessed,
    precision: round6(p), recall: round6(r), f1: round6(f1Of(p, r)),
    byClass: Object.fromEntries(Object.entries(per).map(([c, x]) => { const pp = ratio(x.tp, x.tp + x.fp), rr = ratio(x.tp, x.tp + x.fn); return [c, { ...x, precision: round6(pp), recall: round6(rr), f1: round6(f1Of(pp, rr)) }]; })),
    costUsd: costKnown ? cost : null, costPerVerifiedFinding: costKnown && tp ? cost / tp : null };
}
