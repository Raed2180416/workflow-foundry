import { checkData, FoundryError } from './data.mjs';

// DESIGN §5.3: output schemas that every Phase 1 serving engine enforces as written.
// llama.cpp silently drops unsupported keywords, so anything outside this allowlist is rejected.
export const PORTABLE_KEYWORDS = Object.freeze(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum',
  'minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'description', 'const']);
export const REJECTED_KEYWORDS = Object.freeze(['pattern', 'patternProperties', 'oneOf', 'anyOf', 'allOf', 'not', 'uniqueItems',
  '$ref', 'format', 'if', 'then', 'else']);
const allowed = new Set(PORTABLE_KEYWORDS), types = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const scalar = v => v === null || ['string', 'number', 'boolean'].includes(typeof v);

export function portableSchemaViolations(schema) {
  const violations = [], add = (path, keyword, problem) => violations.push({ path, keyword, problem });
  try { checkData(schema, { maxBytes: 256 * 1024, maxDepth: 25 }); }
  catch (error) { return [{ path: '#', keyword: null, problem: error.message }]; }
  if (!isObject(schema) || schema.type !== 'object') add('#', 'type', 'root schema must declare type "object"');
  const walk = (node, path) => {
    if (!isObject(node)) { add(path, null, 'sub-schema must be an object'); return; }
    for (const [key, value] of Object.entries(node)) {
      if (!allowed.has(key)) { add(path, key, REJECTED_KEYWORDS.includes(key) ? 'keyword is not portable' : 'keyword is outside the portable allowlist'); continue; }
      if (key === 'type' && !(typeof value === 'string' ? types.has(value) : Array.isArray(value) && value.length > 0 && value.every(t => types.has(t)) && new Set(value).size === value.length)) add(path, key, 'type must name JSON types');
      if (key === 'properties') {
        if (!isObject(value)) add(path, key, 'properties must be an object');
        else for (const [name, child] of Object.entries(value)) walk(child, `${path}/properties/${name}`);
      }
      if (key === 'required' && !(Array.isArray(value) && value.every(x => typeof x === 'string') && new Set(value).size === value.length)) add(path, key, 'required must be unique strings');
      if (key === 'additionalProperties') { if (isObject(value)) walk(value, `${path}/additionalProperties`); else if (typeof value !== 'boolean') add(path, key, 'additionalProperties must be boolean or a schema'); }
      if (key === 'items') { if (Array.isArray(value)) add(path, key, 'tuple items are not portable'); else walk(value, `${path}/items`); }
      if (key === 'enum' && !(Array.isArray(value) && value.length > 0 && value.every(scalar))) add(path, key, 'enum must be a non-empty array of scalars');
      if (['minimum', 'maximum'].includes(key) && !Number.isFinite(value)) add(path, key, `${key} must be a finite number`);
      if (['minItems', 'maxItems', 'minLength', 'maxLength'].includes(key) && !(Number.isSafeInteger(value) && value >= 0)) add(path, key, `${key} must be a nonnegative integer`);
      if (key === 'description' && typeof value !== 'string') add(path, key, 'description must be a string');
    }
  };
  if (isObject(schema)) walk(schema, '#');
  return violations;
}

export function checkPortableSchema(schema) {
  const violations = portableSchemaViolations(schema);
  if (violations.length) throw new FoundryError('SCHEMA_NOT_PORTABLE', `Output schema is outside the portable subset: ${violations.slice(0, 5).map(v => `${v.path}${v.keyword ? ` ${v.keyword}` : ''}: ${v.problem}`).join('; ')}`, { violations });
  return schema;
}

// A quarantined node may read untrusted content because its output has too little capacity to
// carry instructions: leaves are booleans, string enums or bounded numbers; containers are closed,
// and the whole output admits at most 2^QUARANTINE_MAX_BITS distinct values. Capacity is an upper
// bound in bits: boolean 1, enum log2(distinct values), const 0, integer log2(integers in range),
// number log2(IEEE doubles in range) (about 62 for [0, 1]: a float is not a small channel),
// optional property log2(values + 1), array log2(length choices) + maxItems × item. JSON key order
// is not counted (objects are unordered; ≤ log2(k!) bits for k properties).
export const QUARANTINE_MAX_BITS = 64;
const doubleOrdinal = x => { const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, Math.abs(x)); const n = view.getBigUint64(0); return x < 0 ? -n : n; };
const log2Count = n => n > 0 ? Math.log2(Number(n)) : 0;
export function quarantinedSchemaViolations(schema) {
  const portable = portableSchemaViolations(schema);
  if (portable.length) return portable;
  const violations = [], add = (path, problem) => { violations.push({ path, keyword: null, problem }); return 0; };
  const walk = (node, path) => {
    if (Object.hasOwn(node, 'const')) return ['string', 'boolean'].includes(typeof node.const) ? 0 : add(path, 'const leaves must be a string or boolean');
    if (Object.hasOwn(node, 'enum')) {
      if (!node.enum.every(v => typeof v === 'string') || (node.type !== undefined && node.type !== 'string')) return add(path, 'enum leaves must be string-only');
      return log2Count(new Set(node.enum).size);
    }
    const { type } = node;
    if (typeof type !== 'string') return add(path, 'every quarantined sub-schema needs exactly one type');
    if (type === 'boolean') return 1;
    if (type === 'number' || type === 'integer') {
      const { minimum: lo, maximum: hi } = node;
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return add(path, 'numbers must declare both minimum and maximum');
      return type === 'integer' ? log2Count(Math.floor(hi) - Math.ceil(lo) + 1) : log2Count(doubleOrdinal(hi) - doubleOrdinal(lo) + 1n);
    }
    if (type === 'object') {
      if (node.additionalProperties !== false) add(path, 'objects must set additionalProperties: false');
      const required = new Set(node.required ?? []);
      return Object.entries(node.properties ?? {}).reduce((sum, [name, child]) => {
        const bits = walk(child, `${path}/properties/${name}`);
        return sum + (required.has(name) ? bits : bits + Math.log2(1 + 2 ** -bits));
      }, 0);
    }
    if (type === 'array') {
      const { maxItems: max, minItems: min = 0 } = node;
      const bits = isObject(node.items) ? walk(node.items, `${path}/items`) : add(path, 'arrays must declare items');
      if (!Number.isSafeInteger(max)) return add(path, 'arrays must declare maxItems');
      return log2Count(max - min + 1) + (max > 0 ? max * bits : 0);
    }
    return add(path, type === 'string' ? 'free strings are not allowed; use a string enum' : `type ${type} is not allowed`);
  };
  const bits = walk(schema, '#');
  if (bits > QUARANTINE_MAX_BITS) add('#', `output capacity is ${Math.round(bits * 10) / 10} bits; a quarantined output may carry at most ${QUARANTINE_MAX_BITS}`);
  return violations;
}

export function checkQuarantinedSchema(schema) {
  const violations = quarantinedSchemaViolations(schema);
  if (violations.length) throw new FoundryError('QUARANTINE_SCHEMA', `Quarantined output schema may contain only booleans, string enums and bounded numbers within ${QUARANTINE_MAX_BITS} bits of output capacity: ${violations.slice(0, 5).map(v => `${v.path}: ${v.problem}`).join('; ')}`, { violations });
  return schema;
}
