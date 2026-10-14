// Host-side re-validation of a typed answer against the answer schema (the form subset). The answer is untrusted:
// it may come from a browser, an OpenUI-shaped client or a scripted actor. Semantics follow JSON Schema as ajv 8
// applies it in src/validate.mjs (the engine's own gate, runtime.mjs `answer`): types (integer = a number with no
// fraction), enum/const by strict equality of scalars, inclusive minimum/maximum, minLength/maxLength in Unicode code
// points, pattern as an unanchored `u`-flag RegExp, minItems/maxItems, required (own properties),
// additionalProperties: false. tests/ui-form-adapter.test.mjs checks acceptance against src/validate.mjs on
// thousands of generated schema/answer pairs.
//
// One deliberate difference in order, not in outcome: maxLength is checked before pattern, and a pattern never runs
// on a string over maxLength (the answer is rejected either way).
import { checkData, codePoints, isPlainObject, own, pointer, uiError } from './common.mjs';

const typeOk = (type, v) => type === 'string' ? typeof v === 'string'
  : type === 'number' ? typeof v === 'number' && Number.isFinite(v)
  : type === 'integer' ? typeof v === 'number' && Number.isInteger(v)
  : type === 'boolean' ? typeof v === 'boolean'
  : type === 'array' ? Array.isArray(v)
  : type === 'object' ? isPlainObject(v)
  : type === 'null' ? v === null : false;

/** Raw errors [{ code, path, detail }] of `value` against `schema` (a subset schema). Stops at the first failing
 *  rule per value, as OpenUI does per field (spec/language.md §5.4); acceptance does not depend on that order. */
export function valueErrors(schema, value, path = '') {
  const out = [];
  walk(schema, value, path, out);
  return out;
}

function walk(schema, value, path, out) {
  const fail = (code, detail) => { out.push({ code, path, detail }); };
  if (own(schema, 'type') && !typeOk(schema.type, value)) {
    return fail(schema.type === 'integer' && typeof value === 'number' ? 'not-an-integer' : 'type-mismatch', { expected: schema.type });
  }
  if (own(schema, 'const') && value !== schema.const) return fail('enum-mismatch', { options: [schema.const] });
  if (own(schema, 'enum') && !schema.enum.some(m => m === value)) return fail('enum-mismatch', { options: schema.enum });
  if (typeof value === 'string') {
    const length = codePoints(value);
    if (own(schema, 'minLength') && length < schema.minLength) return fail('too-short', { minLength: schema.minLength, length });
    if (own(schema, 'maxLength') && length > schema.maxLength) return fail('too-long', { maxLength: schema.maxLength, length });
    if (own(schema, 'pattern') && !new RegExp(schema.pattern, 'u').test(value)) return fail('pattern-mismatch', { pattern: schema.pattern });
  }
  if (typeof value === 'number') {
    if (own(schema, 'minimum') && value < schema.minimum) return fail('below-minimum', { minimum: schema.minimum });
    if (own(schema, 'maximum') && value > schema.maximum) return fail('above-maximum', { maximum: schema.maximum });
  }
  if (Array.isArray(value)) {
    if (own(schema, 'minItems') && value.length < schema.minItems) return fail('too-few-items', { minItems: schema.minItems });
    if (own(schema, 'maxItems') && value.length > schema.maxItems) return fail('too-many-items', { maxItems: schema.maxItems });
    if (own(schema, 'items')) value.forEach((item, i) => walk(schema.items, item, pointer(path, i), out));
  }
  if (isPlainObject(value)) {
    const props = schema.properties ?? {};
    for (const name of schema.required ?? []) if (!own(value, name)) out.push({ code: 'missing-required', path: pointer(path, name), detail: {} });
    for (const name of Object.keys(value)) {
      if (own(props, name)) walk(props[name], value[name], pointer(path, name), out);
      else if (schema.additionalProperties === false) out.push({ code: 'unknown-property', path: pointer(path, name), detail: {} });
    }
  }
}

const MESSAGES = {
  'type-mismatch': (l, d) => [`${l} must be ${article(d.expected)}`, `Give ${article(d.expected)}`],
  'not-an-integer': l => [`${l} must be a whole number`, 'Remove the decimal part'],
  'enum-mismatch': (l, d) => [`${l} must be one of the listed options`, d.options.length <= 8 ? `Options: ${d.options.map(o => JSON.stringify(o)).join(', ')}` : 'Choose one of the listed options'],
  'too-short': (l, d) => [`${l} must be at least ${d.minLength} character${d.minLength === 1 ? '' : 's'}`, `It has ${d.length}`],
  'too-long': (l, d) => [`${l} must be at most ${d.maxLength} character${d.maxLength === 1 ? '' : 's'}`, `It has ${d.length}; characters are counted as Unicode code points`],
  'pattern-mismatch': (l, d) => [`${l} is not in the required format`, `It must match ${d.pattern}`],
  'below-minimum': (l, d) => [`${l} must be ${d.minimum} or more`, `Enter a value of at least ${d.minimum}`],
  'above-maximum': (l, d) => [`${l} must be ${d.maximum} or less`, `Enter a value of at most ${d.maximum}`],
  'too-few-items': (l, d) => [`Select at least ${d.minItems} for ${l}`, `Select ${d.minItems} or more options`],
  'too-many-items': (l, d) => [`Select at most ${d.maxItems} for ${l}`, `Clear options until ${d.maxItems} or fewer remain`],
  'missing-required': l => [`${l} is required`, 'Give an answer'],
  'unknown-property': () => ['The answer has a property the form does not declare', 'Remove it'],
  'answer-limit': (l, d) => [`The answer is not bounded JSON: ${d.reason}`, 'Send a smaller answer'],
  'unsafe-key': (l, d) => [`The answer uses a key the engine refuses: ${d.reason}`, 'Remove the key'],
};
const article = t => ({ string: 'text', number: 'a number', integer: 'a whole number', boolean: 'yes or no', array: 'a list', object: 'an object', null: 'null' })[t] ?? t;

/** Turns a raw error into the OpenUI-shaped error object for a spec. */
export function toUiError(spec, source, raw, fieldOf) {
  const field = fieldOf(raw.path);
  const label = field ? (field.label ?? 'The answer') : raw.path === '' ? 'The answer' : `The value at ${raw.path}`;
  const [message, hint] = (MESSAGES[raw.code] ?? (() => [`${label}: ${raw.code}`, undefined]))(label, raw.detail ?? {});
  return uiError(source, raw.code, { statementId: field?.name, component: field?.componentType, path: raw.path, message, hint });
}

/** Validates a typed answer against a compiled spec. Returns OpenUI-shaped errors; [] means accepted. */
export function validateAnswer(spec, answer, { fieldOf = path => fieldForPath(spec, path) } = {}) {
  if (answer === undefined) return [toUiError(spec, 'validator', { code: 'missing-required', path: '', detail: {} }, fieldOf)];
  try { checkData(answer); } catch (error) { return [toUiError(spec, 'validator', { code: error.code === 'UNSAFE_KEY' ? 'unsafe-key' : 'answer-limit', path: '', detail: { reason: error.message } }, fieldOf)]; }
  return valueErrors(spec.schema, answer).map(raw => toUiError(spec, 'validator', raw, fieldOf));
}

/** The field that owns an answer path: the exact field, else its closest ancestor field (array items), or null. */
export function fieldForPath(spec, path) {
  let best = null;
  for (const f of spec.fields) if (path === f.path || f.path === '' || path.startsWith(`${f.path}/`)) if (!best || f.path.length > best.path.length) best = f;
  return best;
}
