// `need-constraint` bed: one-off generation tasks whose acceptance is a programmatic constraint check
// (many correct answers exist). Interface per beds/CONTRACT.md. Routing anchor for the need router
// (experiments/need-router), not a Tier-A bed: the oracle and the solvers are trusted host code.
import { types } from 'node:util';
import { rng } from '../lib/rng.mjs';
import { checkNames, checkOrder, checkSchedule, checkSentence, tokenize } from './check.mjs';
import { SUBTYPES, VERSION, build, subtypeOf } from './gen.mjs';
import { solveOrder, solveSchedule, solveSentence, solveNames } from './solve.mjs';

export { subtypeOf, SUBTYPES };

export const family = {
  id: 'need-constraint',
  domain: 'constraint-checked generation (routing anchor)',
  version: VERSION,
  kind: 'oneshot',
  role: 'need-anchor',
  description: 'One-off generation tasks accepted by a programmatic constraint check, with many correct answers: (a) N fictional product names under letter/length/forbidden-sequence rules and pairwise distinct, (b) one sentence of k1..k2 words containing given words in order and none of a forbidden set, (c) an ordering of items under precedence/adjacency/position statements, (d) a weekly rota under availability, staffing-count and shift-limit rules. Difficulty scales the number of items and constraints. Hypothesis (not measured here): one direct call suffices.',
};

export const FIELD = { names: 'names', sentence: 'sentence', order: 'order', schedule: 'schedule' };

// Portable schema subset (beds/CONTRACT.md; the allowlist is PORTABLE_KEYWORDS in src/schema-subset.mjs): no pattern /
// oneOf / uniqueItems / $ref / format, and no minProperties / maxProperties either. "Exactly one of these four
// properties, the one the prompt names" therefore cannot be written into this static schema; `{}` and a two-property
// object are schema-valid here. The oracle fails them as a field mismatch (details.fieldMismatch), not as a schema
// error, so details.schemaValid always agrees with this schema; outputSchemaFor(task) is the strict per-task schema.
export const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    names: { type: 'array', maxItems: 40, items: { type: 'string', minLength: 1, maxLength: 40 }, description: 'names task: the product names' },
    sentence: { type: 'string', maxLength: 600, description: 'sentence task: the single sentence' },
    order: { type: 'array', maxItems: 40, items: { type: 'string', minLength: 1, maxLength: 60 }, description: 'order task: item names from position 1 to the last position' },
    schedule: {
      type: 'array', maxItems: 200, description: 'schedule task: one row per person per slot',
      items: {
        type: 'object', additionalProperties: false, required: ['day', 'shift', 'person'],
        properties: { day: { type: 'string', minLength: 1, maxLength: 40 }, shift: { type: 'string', minLength: 1, maxLength: 40 }, person: { type: 'string', minLength: 1, maxLength: 40 } },
      },
    },
  },
};

export const PASS_RULE = 'every active rule category holds: names (count, letters-only, length, start/end letters, required/banned letters, forbidden sequences, repeats, vowels, reserved names, distinctness, distinct initials, letter quota); sentence (single-sentence form, word window, required words in order, forbidden words, optional extras); order (a permutation and every constraint statement); schedule (known rows, exact slot counts, availability, one shift per day, weekly limits, pair/rest/lead/trainee/streak rules). Any valid answer passes; nothing is compared with the reference answer.';

// ---------------------------------------------------------------- output validation
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// minLength / maxLength count code points, like Ajv (src/validate.mjs) does for the published schema.
const codePoints = v => [...v].length;

/** Violations of the PUBLISHED outputSchema only: `schemaViolations(o).length === 0` iff validateData(outputSchema, o) accepts o. */
export function schemaViolations(output) {
  const errors = [];
  if (!isObj(output)) return ['output must be a JSON object'];
  const keys = Object.keys(output);
  for (const k of keys) if (!Object.hasOwn(outputSchema.properties, k)) errors.push(`unexpected field '${k}'`);
  const str = (v, spec, label) => {
    if (typeof v !== 'string') { errors.push(`${label} must be a string`); return; }
    if (spec.minLength !== undefined && codePoints(v) < spec.minLength) errors.push(`${label} is too short`);
    if (spec.maxLength !== undefined && codePoints(v) > spec.maxLength) errors.push(`${label} is too long`);
  };
  for (const k of keys) {
    const spec = outputSchema.properties[k]; if (!spec) continue;
    const v = output[k];
    if (spec.type === 'string') { str(v, spec, `'${k}'`); continue; }
    if (!Array.isArray(v)) { errors.push(`'${k}' must be an array`); continue; }
    if (v.length > spec.maxItems) { errors.push(`'${k}' has more than ${spec.maxItems} items`); continue; }
    for (let i = 0; i < v.length; i++) {
      if (k !== 'schedule') { str(v[i], spec.items, `'${k}[${i}]'`); continue; }
      const row = v[i];
      if (!isObj(row)) { errors.push(`'schedule[${i}]' must be an object`); continue; }
      for (const f of Object.keys(row)) if (!Object.hasOwn(spec.items.properties, f)) errors.push(`'schedule[${i}]' has unexpected field '${f}'`);
      for (const f of spec.items.required) { if (!Object.hasOwn(row, f)) errors.push(`'schedule[${i}]' lacks '${f}'`); else str(row[f], spec.items.properties[f], `'schedule[${i}].${f}'`); }
    }
  }
  return errors;
}

/**
 * What the portable subset cannot say: exactly one property, and (with `subtype`) the one this task asks for.
 * Empty for a non-object (that is a schema violation). A non-empty result is a field mismatch, not a schema error.
 */
export function fieldViolations(output, subtype = null) {
  if (!isObj(output)) return [];
  const errors = []; const keys = Object.keys(output);
  if (keys.length !== 1) errors.push(`exactly one field must be present (got ${keys.length})`);
  if (subtype && keys.length === 1 && keys[0] !== FIELD[subtype]) errors.push(`this task needs the field '${FIELD[subtype]}'`);
  return errors;
}

/** Schema violations plus field violations; with `subtype`, also requires exactly that subtype's field. */
export function validateOutput(output, subtype = null) {
  return [...schemaViolations(output), ...fieldViolations(output, subtype)];
}

/**
 * The strict schema for one task (a task, or a subtype name): the published property definition with that
 * property required and nothing else allowed. Portable subset only. validateData(outputSchemaFor(task), o) accepts o
 * iff the oracle reports details.schemaValid && !details.fieldMismatch for o. Depends on the seed alone.
 */
export function outputSchemaFor(taskOrSubtype) {
  const subtype = typeof taskOrSubtype === 'string' ? taskOrSubtype : Number.isSafeInteger(taskOrSubtype?.seed) ? subtypeOf(taskOrSubtype.seed) : null;
  if (!SUBTYPES.includes(subtype)) throw new TypeError('outputSchemaFor needs a task or one of the subtype names');
  const field = FIELD[subtype];
  return { type: 'object', additionalProperties: false, required: [field], properties: { [field]: clone(outputSchema.properties[field]) } };
}

// Copies a solver output as plain JSON-like data first: accessors, proxies, non-plain prototypes, holes and deep
// nesting make the output invalid instead of steering or crashing the oracle.
function plainCopy(value, depth = 0) {
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return value;
  if (typeof value !== 'object' || depth > 4 || types.isProxy(value)) throw new TypeError('output is not plain JSON data');
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 1000) throw new TypeError('output contains a non-plain or oversized array');
    const out = [];
    for (let i = 0; i < value.length; i++) {
      const d = Object.getOwnPropertyDescriptor(value, i);
      if (!d || !('value' in d)) throw new TypeError('output contains a sparse array or an accessor');
      out.push(plainCopy(d.value, depth + 1));
    }
    return out;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError('output contains a non-plain object');
  const out = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new TypeError('output contains a symbol key');
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!('value' in d)) throw new TypeError(`output field '${key}' is an accessor`);
    Object.defineProperty(out, key, { value: plainCopy(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  return out;
}

// ---------------------------------------------------------------- generate / rebuild
export function generate({ seed, split = 'dev', difficulty = 3 } = {}) {
  return build(seed, split, difficulty).task;
}

// Small memo of rebuilt cases: rebuilding is deterministic, the cache only saves time when the oracle and the
// controls score the same task repeatedly. Callers never receive cached objects (they are cloned on the way out).
const memo = new Map();
function rebuilt(task) {
  if (!task || !Number.isSafeInteger(task.seed) || !Number.isInteger(task.difficulty) || typeof task.split !== 'string') throw new TypeError('task seed/split/difficulty have the wrong type');
  const key = `${task.seed}|${task.split}|${task.difficulty}`;
  if (memo.has(key)) { const hit = memo.get(key); memo.delete(key); memo.set(key, hit); return hit; }
  const built = build(task.seed, task.split, task.difficulty);
  memo.set(key, built);
  if (memo.size > 16) memo.delete(memo.keys().next().value);
  return built;
}
const clone = v => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------- oracle
export function oracle(task, output) {
  // Never throws: whatever the task or output, it returns a verdict.
  try { return judge(task, output); } catch (error) {
    return { pass: false, score: 0, details: { schemaValid: false, fieldMismatch: true, errors: [`oracle could not read the output: ${String(error?.message ?? error).slice(0, 200)}`] } };
  }
}

function judge(task, rawOutput) {
  if (!task || task.family !== 'need-constraint') return { pass: false, score: 0, details: { error: 'not a need-constraint task' } };
  let spec;
  try { spec = rebuilt(task).spec; } catch (error) { return { pass: false, score: 0, details: { error: `cannot rebuild task: ${error.message}` } }; }
  let output;
  try { output = plainCopy(rawOutput); } catch (error) { return { pass: false, score: 0, details: { schemaValid: false, fieldMismatch: true, errors: [error.message] } }; }
  // details.schemaValid is validity under the PUBLISHED outputSchema, nothing more; the one-field rule is reported apart.
  const schemaErrors = schemaViolations(output); const fieldErrors = fieldViolations(output, spec.subtype);
  const fieldMismatch = !isObj(output) || fieldErrors.length > 0;
  if (schemaErrors.length) return { pass: false, score: 0, details: { schemaValid: false, fieldMismatch, errors: [...schemaErrors, ...fieldErrors] } };
  if (fieldMismatch) return { pass: false, score: 0, details: { schemaValid: true, fieldMismatch: true, subtype: spec.subtype, failed: ['field'], errors: fieldErrors } };
  const result = { names: () => checkNames(spec, output.names), sentence: () => checkSentence(spec, output.sentence), order: () => checkOrder(spec, output.order), schedule: () => checkSchedule(spec, output.schedule) }[spec.subtype]();
  return {
    pass: result.pass, score: result.pass ? 1 : Math.min(result.score, 0.99),
    details: { schemaValid: true, fieldMismatch: false, subtype: spec.subtype, failed: result.checks.filter(c => !c.ok).map(c => c.id), checks: result.checks },
  };
}

// ---------------------------------------------------------------- reference and alternative answers
export function referenceSolve(task) {
  return clone(rebuilt(task).truth.solutions[0]);
}

/**
 * A second valid answer that differs from referenceSolve. variant 0 is the one the generator verified is distinct
 * (a different second solution for order/schedule); higher variants re-run the solver with another stream and fall
 * back to variant 0's answer for order/schedule when the randomised search runs out of budget.
 */
export function altSolve(task, variant = 0) {
  const { spec, truth } = rebuilt(task);
  if (variant === 0 && truth.solutions[1]) return clone(truth.solutions[1]);
  const r = rng('need-constraint', VERSION, task.split, task.seed, task.difficulty, 'alt', variant);
  const found = variantAnswer(spec, truth, r, variant);
  // a randomised search can land on the reference again when a task has few answers: then use the verified second one
  return JSON.stringify(found) === JSON.stringify(truth.solutions[0]) && truth.solutions[1] ? clone(truth.solutions[1]) : found;
}

function variantAnswer(spec, truth, r, variant) {
  switch (spec.subtype) {
    case 'names': return { names: solveNames(spec, r, variant % 2 === 1 ? 'cv' : 'syll') };
    case 'sentence': return { sentence: solveSentence(spec, r, { allowRepeats: true }) };
    case 'order': return { order: solveOrder(spec, { mode: 'random', rng: r }).solutions[0] ?? truth.solutions[1].order };
    case 'schedule': return { schedule: solveSchedule(spec, { mode: 'random', rng: r, maxNodes: 100000 }).solutions[0] ?? truth.solutions[1].schedule };
    default: throw new Error('unknown subtype');
  }
}

// ---------------------------------------------------------------- bad controls (all known-bad, must fail the oracle)
const emptyFor = spec => ({ names: { names: [] }, sentence: { sentence: '' }, order: { order: [] }, schedule: { schedule: [] } }[spec.subtype]);

function swapWords(sentence, a, b) {
  const re = w => new RegExp(`\\b${w}\\b`, 'i');
  let s = sentence.replace(re(a), '\u0001').replace(re(b), a).replace('\u0001', b);
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

function corrupted(task) {
  const { spec } = rebuilt(task); const ref = referenceSolve(task);
  switch (spec.subtype) {
    case 'names': { const names = [...ref.names]; names[names.length - 1] = names[0].toUpperCase(); return { names }; } // duplicate (case-folded)
    case 'sentence': return { sentence: swapWords(ref.sentence, spec.required[0], spec.required[1]) }; // required words out of order
    case 'order': { const order = [...ref.order]; const c = spec.constraints[0]; const i = order.indexOf(c.a); const j = order.indexOf(c.b); [order[i], order[j]] = [order[j], order[i]]; return { order }; }
    case 'schedule': { const schedule = ref.schedule.map(r => ({ ...r })); schedule[0].person = 'Nobody'; return { schedule }; }
    default: throw new Error('unknown subtype');
  }
}

function nearMiss(task) {
  const { spec } = rebuilt(task); const ref = referenceSolve(task);
  switch (spec.subtype) {
    case 'names': { // one name is swapped for a plausible but rule-breaking one (a forbidden letter sequence, or a taken name)
      const pool = []; // [index, replacement]
      ref.names.forEach((nm, i) => {
        for (const f of spec.forbidden) for (let at = 0; at + f.length <= nm.length; at++) pool.push([i, nm.slice(0, at) + f + nm.slice(at + f.length)]);
        for (const taken of spec.reserved) pool.push([i, taken]);
      });
      let best = null;
      for (const [i, replacement] of pool) {
        const names = [...ref.names]; names[i] = replacement;
        const res = checkNames(spec, names);
        if (res.pass) continue;
        const failed = res.checks.filter(c => !c.ok).length;
        if (!best || failed < best.failed) best = { failed, names };
        if (failed === 1) break;
      }
      return { names: best.names };
    }
    case 'sentence': { // a filler word swapped for a forbidden one
      const req = new Set(spec.required); const anchors = [spec.rules.startWord, spec.rules.endWord].filter(Boolean);
      const words = ref.sentence.split(' '); const toks = new Set(tokenize(ref.sentence).map(t => t.toLowerCase()));
      const bad = spec.forbidden.find(w => !toks.has(w)) ?? spec.forbidden[0];
      const i = words.findIndex((w, k) => { const core = w.replace(/[^A-Za-z]/g, '').toLowerCase(); return k > 0 && k < words.length - 1 && !req.has(core) && !anchors.includes(core); });
      const core = words[i].replace(/[^A-Za-z]/g, ''); words[i] = words[i].replace(core, bad);
      return { sentence: words.join(' ') };
    }
    case 'order': { // the reference with two neighbours swapped, choosing a swap that breaks some statement
      let best = null; // the swap that breaks the fewest statement groups
      for (let i = 0; i < ref.order.length - 1; i++) {
        const order = [...ref.order]; [order[i], order[i + 1]] = [order[i + 1], order[i]];
        const res = checkOrder(spec, order);
        if (res.pass) continue;
        const failed = res.checks.filter(c => !c.ok).length;
        if (!best || failed < best.failed) best = { failed, order };
        if (failed === 1) break;
      }
      return best ? { order: best.order } : corruptedFallbackOrder(spec, ref);
    }
    case 'schedule': { // one person swapped for someone else; prefer a swap that breaks exactly one rule category
      let best = null;
      for (let i = 0; i < ref.schedule.length; i++) for (const p of spec.people) {
        if (p.name === ref.schedule[i].person) continue;
        const schedule = ref.schedule.map(r => ({ ...r })); schedule[i].person = p.name;
        const res = checkSchedule(spec, schedule);
        if (res.pass) continue;
        const failed = res.checks.filter(c => !c.ok).length;
        if (!best || failed < best.failed) best = { failed, schedule };
        if (failed === 1) return { schedule };
      }
      return best ? { schedule: best.schedule } : { schedule: ref.schedule.slice(0, -1) };
    }
    default: throw new Error('unknown subtype');
  }
}
function corruptedFallbackOrder(spec, ref) {
  const order = [...ref.order]; const c = spec.constraints[0]; const i = order.indexOf(c.a); const j = order.indexOf(c.b);
  [order[i], order[j]] = [order[j], order[i]];
  return { order };
}

function truncated(task) {
  const { spec } = rebuilt(task); const ref = referenceSolve(task);
  switch (spec.subtype) {
    case 'names': return { names: ref.names.slice(0, -1) };
    case 'sentence': {
      const words = ref.sentence.split(' ');
      const cut = words.findIndex(w => w.replace(/[^A-Za-z]/g, '').toLowerCase() === spec.required[spec.required.length - 1]);
      return { sentence: `${words.slice(0, cut).join(' ').replace(/,$/, '')}.` };
    }
    case 'order': return { order: ref.order.slice(0, -1) };
    case 'schedule': return { schedule: ref.schedule.slice(0, -1) };
    default: throw new Error('unknown subtype');
  }
}

// The reference's content filed under a property of another subtype that the published schema still accepts (a string
// array of at most 40 strings of at most 40 characters): details.schemaValid stays true and the verdict comes from the
// one-field rule. The content is cut to fit, so this is never the reference answer.
function wrongField(task) {
  const { spec } = rebuilt(task); const ref = referenceSolve(task);
  const strings = {
    names: () => ref.names, order: () => ref.order, sentence: () => ref.sentence.split(' '),
    schedule: () => [...new Set(ref.schedule.map(row => row.person))],
  }[spec.subtype]().slice(0, 40).map(v => v.slice(0, 40));
  const target = ['order', 'names'].find(field => field !== FIELD[spec.subtype]);
  return { [target]: strings };
}

export const badControls = [
  { name: 'empty', make: task => emptyFor(rebuilt(task).spec) },
  { name: 'shuffled-or-corrupted', make: corrupted },
  { name: 'plausible-but-wrong', make: nearMiss },
  { name: 'truncated', make: truncated },
  { name: 'wrong-field', make: wrongField },
];
