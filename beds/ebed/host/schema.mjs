// Portable-subset JSON Schema validation for the E-bed host (BED-CONTRACT-v1.1 §3.1, §4.4). The host validates every arm
// output and re-validates every human answer against the arm's own `answerSchema`; the answer and the form state are
// untrusted (OPENUI.md §5.2). The keyword set is the engine's portable subset (src/schema-subset.mjs PORTABLE_KEYWORDS):
// type, properties, required, additionalProperties, items, enum, const, minimum, maximum, minItems, maxItems, minLength,
// maxLength, description. Anything else is refused, so a schema can never be "accepted" by silently ignoring a keyword.
// Written independently of src/ (the host must not move with the engine); the host suite checks it differentially
// against src/validate.mjs validateData (ajv) on seeded random schemas and values.
//
// Semantics follow ajv 8 on this subset: `required` and `properties` look at own properties only; string lengths count
// Unicode code points; `integer` is Number.isInteger; enum/const use deep JSON equality; bounds are inclusive.

export const PORTABLE_KEYWORDS = Object.freeze(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum',
  'minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'description', 'const']);
const ALLOWED = new Set(PORTABLE_KEYWORDS);
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const MAX_ERRORS = 32;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const scalar = v => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/** Structural problems of a schema under the portable subset ([] when portable). `root: 'object'` also requires the
 *  root to be an object schema, as the engine's human-node answerSchema does. */
export function schemaProblems(schema, { root = null, maxNodes = 1000, maxDepth = 25 } = {}) {
  const problems = [];
  let nodes = 0;
  const walk = (node, path, depth) => {
    if (problems.length >= MAX_ERRORS) return;
    if (++nodes > maxNodes) { problems.push(`${path}: too many sub-schemas`); return; }
    if (depth > maxDepth) { problems.push(`${path}: nested too deeply`); return; }
    if (!isObj(node)) { problems.push(`${path}: sub-schema must be an object`); return; }
    for (const k of Object.keys(node)) if (!ALLOWED.has(k)) problems.push(`${path}: keyword ${k} is outside the portable subset`);
    if (own(node, 'type')) {
      const ts = [].concat(node.type);
      if (!ts.length || ts.some(t => !TYPES.has(t)) || new Set(ts).size !== ts.length) problems.push(`${path}: bad type`);
    }
    if (own(node, 'properties')) {
      if (!isObj(node.properties)) problems.push(`${path}.properties: must be an object`);
      else for (const [k, sub] of Object.entries(node.properties)) {
        if (FORBIDDEN_KEYS.has(k)) problems.push(`${path}.properties: forbidden key ${k}`);
        walk(sub, `${path}.properties.${k}`, depth + 1);
      }
    }
    if (own(node, 'required') && !(Array.isArray(node.required) && node.required.every(x => typeof x === 'string') && new Set(node.required).size === node.required.length)) problems.push(`${path}.required: must be unique strings`);
    if (own(node, 'additionalProperties') && typeof node.additionalProperties !== 'boolean') walk(node.additionalProperties, `${path}.additionalProperties`, depth + 1);
    if (own(node, 'items')) walk(node.items, `${path}.items`, depth + 1);
    if (own(node, 'enum') && !(Array.isArray(node.enum) && node.enum.length && node.enum.every(scalar))) problems.push(`${path}.enum: must be a non-empty array of scalars`);
    for (const k of ['minimum', 'maximum']) if (own(node, k) && !Number.isFinite(node[k])) problems.push(`${path}.${k}: must be a number`);
    for (const k of ['minItems', 'maxItems', 'minLength', 'maxLength']) if (own(node, k) && !(Number.isSafeInteger(node[k]) && node[k] >= 0)) problems.push(`${path}.${k}: must be a non-negative integer`);
    if (own(node, 'description') && typeof node.description !== 'string') problems.push(`${path}.description: must be a string`);
  };
  walk(schema, '#', 0);
  if (root === 'object' && !(isObj(schema) && schema.type === 'object')) problems.push('#: root schema must declare type "object"');
  return problems;
}

function typeOk(t, v) {
  switch (t) {
    case 'null': return v === null;
    case 'object': return isObj(v);
    case 'array': return Array.isArray(v);
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'string': return typeof v === 'string';
    case 'boolean': return typeof v === 'boolean';
    default: return false;
  }
}

/** Deep equality on JSON values (key order ignored), as JSON Schema enum/const require. */
export function jsonEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => own(b, k) && jsonEqual(a[k], b[k]));
}

const codePoints = s => { let n = 0; for (const _ of s) n++; return n; };

/** Errors of `value` against a portable `schema` ([] when valid). Assumes a portable schema (check schemaProblems). */
export function validate(schema, value, path = '$', errs = []) {
  if (errs.length >= MAX_ERRORS || schema === true) return errs;
  if (schema === false) { errs.push(`${path}: not allowed`); return errs; }
  if (own(schema, 'type')) {
    const ts = [].concat(schema.type);
    if (!ts.some(t => typeOk(t, value))) { errs.push(`${path}: expected ${ts.join('|')}`); return errs; }
  }
  if (own(schema, 'enum') && !schema.enum.some(x => jsonEqual(x, value))) errs.push(`${path}: not in enum`);
  if (own(schema, 'const') && !jsonEqual(schema.const, value)) errs.push(`${path}: not the constant`);
  if (typeof value === 'number') {
    if (own(schema, 'minimum') && value < schema.minimum) errs.push(`${path}: below ${schema.minimum}`);
    if (own(schema, 'maximum') && value > schema.maximum) errs.push(`${path}: above ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    const n = (own(schema, 'minLength') || own(schema, 'maxLength')) ? codePoints(value) : 0;
    if (own(schema, 'minLength') && n < schema.minLength) errs.push(`${path}: shorter than ${schema.minLength}`);
    if (own(schema, 'maxLength') && n > schema.maxLength) errs.push(`${path}: longer than ${schema.maxLength}`);
  }
  if (Array.isArray(value)) {
    if (own(schema, 'minItems') && value.length < schema.minItems) errs.push(`${path}: fewer than ${schema.minItems} items`);
    if (own(schema, 'maxItems') && value.length > schema.maxItems) { errs.push(`${path}: more than ${schema.maxItems} items`); return errs; }
    if (own(schema, 'items')) for (let i = 0; i < value.length && errs.length < MAX_ERRORS; i++) validate(schema.items, value[i], `${path}[${i}]`, errs);
  } else if (isObj(value)) {
    for (const k of schema.required ?? []) if (!own(value, k)) errs.push(`${path}: missing ${k}`);
    const props = schema.properties ?? {};
    for (const [k, sub] of Object.entries(props)) if (own(value, k)) validate(sub, value[k], `${path}.${k}`, errs);
    if (own(schema, 'additionalProperties')) {
      const ap = schema.additionalProperties;
      for (const k of Object.keys(value)) {
        if (own(props, k)) continue;
        if (ap === false) errs.push(`${path}: unexpected ${k}`);
        else if (ap !== true) validate(ap, value[k], `${path}.${k}`, errs);
      }
    }
  }
  return errs;
}

/** Plain-data copy of a caller value; undefined when it is not plain JSON data (functions, symbols, cycles, NaN,
 *  getters that throw). Accessors and prototypes cannot show the validator one value and the host another. */
export function plainCopy(value) {
  let text;
  try { text = JSON.stringify(value); } catch { return undefined; }
  if (text === undefined) return undefined;
  const copy = JSON.parse(text);
  // JSON.stringify drops undefined and maps NaN/Infinity to null silently; refuse those instead of repairing them.
  return sameShape(value, copy) ? copy : undefined;
}
function sameShape(a, b, depth = 0) {
  if (depth > 200) return false;
  if (typeof a === 'number') return Number.isFinite(a) && a === b;
  if (a === null || typeof a !== 'object') return a === b;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameShape(x, b[i], depth + 1));
  if (Object.getPrototypeOf(a) !== Object.prototype && Object.getPrototypeOf(a) !== null) return false;
  // An object property whose value is undefined is dropped, as JSON does; everything else must survive unchanged.
  const ka = Object.keys(a).filter(k => a[k] !== undefined);
  return isObj(b) && ka.length === Object.keys(b).length && ka.every(k => own(b, k) && sameShape(a[k], b[k], depth + 1));
}

// Shared schema builders (portable subset).
export const S = Object.freeze({
  str: (maxLength = 200, extra = {}) => ({ type: 'string', maxLength, ...extra }),
  int: (extra = {}) => ({ type: 'integer', ...extra }),
  num: (extra = {}) => ({ type: 'number', ...extra }),
  bool: { type: 'boolean' },
  enumOf: values => ({ enum: [...values] }),
  arr: (items, maxItems = 1000, extra = {}) => ({ type: 'array', items, maxItems, ...extra }),
  obj: (properties, required = Object.keys(properties), extra = {}) => ({ type: 'object', required, properties, additionalProperties: false, ...extra }),
  nullable: s => (s.type !== undefined ? { ...s, type: [].concat(s.type, 'null') }
    : s.enum ? { ...s, enum: [...s.enum, null] } : s),
});
