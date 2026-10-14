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

// Portable schema subset (beds/CONTRACT.md): no pattern / oneOf / uniqueItems / $ref / format. Exactly one
// property is filled, the one named in the prompt; the oracle rejects any other combination.
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

/** Schema errors for `output`; with `subtype`, also requires exactly that subtype's field. */
export function validateOutput(output, subtype = null) {
  const errors = [];
  if (!isObj(output)) return ['output must be a JSON object'];
  const keys = Object.keys(output);
  for (const k of keys) if (!Object.hasOwn(outputSchema.properties, k)) errors.push(`unexpected field '${k}'`);
  if (keys.length !== 1) errors.push(`exactly one field must be present (got ${keys.length})`);
  if (subtype && keys.length === 1 && keys[0] !== FIELD[subtype]) errors.push(`this task needs the field '${FIELD[subtype]}'`);
  const str = (v, spec, label) => {
    if (typeof v !== 'string') { errors.push(`${label} must be a string`); return; }
    if (spec.minLength !== undefined && v.length < spec.minLength) errors.push(`${label} is too short`);
    if (spec.maxLength !== undefined && v.length > spec.maxLength) errors.push(`${label} is too long`);
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
    return { pass: false, score: 0, details: { schemaValid: false, errors: [`oracle could not read the output: ${String(error?.message ?? error).slice(0, 200)}`] } };
  }
}

function judge(task, rawOutput) {
  if (!task || task.family !== 'need-constraint') return { pass: false, score: 0, details: { error: 'not a need-constraint task' } };
  let spec;
  try { spec = rebuilt(task).spec; } catch (error) { return { pass: false, score: 0, details: { error: `cannot rebuild task: ${error.message}` } }; }
  let output;
  try { output = plainCopy(rawOutput); } catch (error) { return { pass: false, score: 0, details: { schemaValid: false, errors: [error.message] } }; }
  const errors = validateOutput(output, spec.subtype);
  if (errors.length) return { pass: false, score: 0, details: { schemaValid: false, errors } };
  const result = { names: () => checkNames(spec, output.names), sentence: () => checkSentence(spec, output.sentence), order: () => checkOrder(spec, output.order), schedule: () => checkSchedule(spec, output.schedule) }[spec.subtype]();
  return {
    pass: result.pass, score: result.pass ? 1 : Math.min(result.score, 0.99),
    details: { schemaValid: true, subtype: spec.subtype, failed: result.checks.filter(c => !c.ok).map(c => c.id), checks: result.checks },
  };
}

// ---------------------------------------------------------------- reference and alternative answers
export function referenceSolve(task) {
  return clone(rebuilt(task).truth.solutions[0]);
}

/**
 * A second valid answer that differs from referenceSolve. variant 0 is the one the generator verified is distinct
 * (a different second solution for order/schedule); higher variants re-run the solver with another stream.
 */
export function altSolve(task, variant = 0) {
  const { spec, truth } = rebuilt(task);
  if (variant === 0 && truth.solutions[1]) return clone(truth.solutions[1]);
  const r = rng('need-constraint', VERSION, task.split, task.seed, task.difficulty, 'alt', variant);
  switch (spec.subtype) {
    case 'names': return { names: solveNames(spec, r, variant % 2 === 1 ? 'cv' : 'syll') };
    case 'sentence': return { sentence: solveSentence(spec, r, { allowRepeats: true }) };
    case 'order': return { order: solveOrder(spec, { mode: 'random', rng: r }).solutions[0] };
    case 'schedule': return { schedule: solveSchedule(spec, { mode: 'random', rng: r, maxNodes: 100000 }).solutions[0] };
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
    case 'names': { // one name carries a forbidden letter sequence; everything else is fine
      const names = [...ref.names]; const last = names[names.length - 1]; const f = spec.forbidden[0];
      names[names.length - 1] = last.slice(0, 1) + f + last.slice(1 + f.length);
      return { names };
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
      for (let i = 0; i < ref.order.length - 1; i++) {
        const order = [...ref.order]; [order[i], order[i + 1]] = [order[i + 1], order[i]];
        if (!checkOrder(spec, order).pass) return { order };
      }
      return corruptedFallbackOrder(spec, ref);
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

function wrongField(task) {
  const { spec } = rebuilt(task); const ref = referenceSolve(task);
  const other = SUBTYPES[(SUBTYPES.indexOf(spec.subtype) + 1) % SUBTYPES.length];
  return { [other]: ref[spec.subtype] };
}

export const badControls = [
  { name: 'empty', make: task => emptyFor(rebuilt(task).spec) },
  { name: 'shuffled-or-corrupted', make: corrupted },
  { name: 'plausible-but-wrong', make: nearMiss },
  { name: 'truncated', make: truncated },
  { name: 'wrong-field', make: wrongField },
];
