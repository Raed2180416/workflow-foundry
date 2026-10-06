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
// carry instructions: leaves are booleans, string enums or bounded numbers; containers are closed.
export function quarantinedSchemaViolations(schema) {
  const portable = portableSchemaViolations(schema);
  if (portable.length) return portable;
  const violations = [], add = (path, problem) => violations.push({ path, keyword: null, problem });
  const walk = (node, path) => {
    if (Object.hasOwn(node, 'const')) {
      if (!['string', 'boolean'].includes(typeof node.const)) add(path, 'const leaves must be a string or boolean');
      return;
    }
    if (Object.hasOwn(node, 'enum')) {
      if (!node.enum.every(v => typeof v === 'string') || (node.type !== undefined && node.type !== 'string')) add(path, 'enum leaves must be string-only');
      return;
    }
    const { type } = node;
    if (typeof type !== 'string') { add(path, 'every quarantined sub-schema needs exactly one type'); return; }
    if (type === 'boolean') return;
    if (type === 'number' || type === 'integer') {
      if (!Number.isFinite(node.minimum) || !Number.isFinite(node.maximum)) add(path, 'numbers must declare both minimum and maximum');
      return;
    }
    if (type === 'object') {
      if (node.additionalProperties !== false) add(path, 'objects must set additionalProperties: false');
      for (const [name, child] of Object.entries(node.properties ?? {})) walk(child, `${path}/properties/${name}`);
      return;
    }
    if (type === 'array') {
      if (!Number.isSafeInteger(node.maxItems)) add(path, 'arrays must declare maxItems');
      if (!isObject(node.items)) add(path, 'arrays must declare items'); else walk(node.items, `${path}/items`);
      return;
    }
    add(path, type === 'string' ? 'free strings are not allowed; use a string enum' : `type ${type} is not allowed`);
  };
  walk(schema, '#');
  return violations;
}

export function checkQuarantinedSchema(schema) {
  const violations = quarantinedSchemaViolations(schema);
  if (violations.length) throw new FoundryError('QUARANTINE_SCHEMA', `Quarantined output schema may contain only booleans, string enums and bounded numbers: ${violations.slice(0, 5).map(v => `${v.path}: ${v.problem}`).join('; ')}`, { violations });
  return schema;
}
