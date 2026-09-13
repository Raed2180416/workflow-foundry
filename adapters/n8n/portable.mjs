// Small original JSON boundary shared by export validation and generated Code nodes.
// The schema subset is intentional. Unknown semantics cause export rejection.
export function schemaSubset(schema, label = 'schema') {
  if (typeof schema === 'boolean') return [];
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [`${label}: invalid schema`];
  const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'items',
    'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties',
    'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
    'enum', 'const', 'allOf', 'anyOf', 'oneOf', 'not', 'title', 'description', 'default', 'examples', '$comment']);
  const errors = Object.keys(schema).filter(k => !allowed.has(k)).map(k => `${label}: unsupported schema keyword ${k}`);
  for (const [key, value] of Object.entries(schema.properties ?? {})) errors.push(...schemaSubset(value, `${label}.properties.${key}`));
  for (const key of ['items', 'additionalProperties', 'not']) if (Object.hasOwn(schema, key)) errors.push(...schemaSubset(schema[key], `${label}.${key}`));
  for (const key of ['allOf', 'anyOf', 'oneOf']) if (Array.isArray(schema[key])) schema[key].forEach((s, i) => errors.push(...schemaSubset(s, `${label}.${key}[${i}]`)));
  return errors;
}

export function portableHelpers() {
  function fail(code, message) { const error = new Error(`${code}: ${message}`); error.code = code; throw error; }
  function data(value, maxBytes = 2097152) {
    let count = 0;
    const walk = (v, depth) => {
      if (++count > 200000 || depth > 40) fail('DATA_LIMIT', 'Data is too complex');
      if (v === null || typeof v === 'boolean') return;
      if (typeof v === 'string') {
        for (const char of v) if (char.codePointAt(0) >= 0xD800 && char.codePointAt(0) <= 0xDFFF) fail('DATA_STRING', 'Unpaired Unicode surrogate');
        return;
      }
      if (typeof v === 'number') {
        if (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v))) fail('DATA_NUMBER', 'Unsupported numeric value');
        return;
      }
      if (Array.isArray(v)) { for (const item of v) walk(item, depth + 1); return; }
      if (!v || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) fail('DATA_TYPE', 'Only JSON data is permitted');
      for (const [key, item] of Object.entries(v)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('DATA_KEY', 'Forbidden object key');
        walk(key, depth + 1);
        walk(item, depth + 1);
      }
    };
    walk(value, 0);
    // UTF-8 byte count without Node-only Buffer or TextEncoder in a Code sandbox.
    const encoded = JSON.stringify(value);
    let size = 0;
    for (const char of encoded) { const point = char.codePointAt(0); size += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4; }
    if (size > maxBytes) fail('DATA_LIMIT', 'Data exceeds the byte limit');
    return value;
  }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function equal(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== typeof b || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ak = Object.keys(a), bk = Object.keys(b);
    return ak.length === bk.length && ak.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
  }
  function resolve(template, context) {
    if (Array.isArray(template)) return template.map(item => resolve(item, context));
    if (template !== null && typeof template === 'object') {
      if (Object.hasOwn(template, '$ref')) {
        if (typeof template.$ref !== 'string' || !/^(input|nodes)(\.[A-Za-z0-9_-]+)*$/.test(template.$ref) || Object.keys(template).some(k => !['$ref', 'default'].includes(k))) fail('INVALID_REFERENCE', 'Invalid reference');
        let current = context;
        for (const part of template.$ref.split('.')) {
          if (['__proto__', 'prototype', 'constructor'].includes(part)) fail('INVALID_REFERENCE', 'Forbidden reference');
          if (current === null || typeof current !== 'object' || !Object.hasOwn(current, part)) {
            if (Object.hasOwn(template, 'default')) return copy(template.default);
            fail('MISSING_REFERENCE', template.$ref);
          }
          current = current[part];
        }
        return copy(current);
      }
      return Object.fromEntries(Object.entries(template).map(([key, value]) => [key, resolve(value, context)]));
    }
    return template;
  }
  function condition(test, context) {
    if (test.op === 'all') return test.conditions.every(c => condition(c, context));
    if (test.op === 'any') return test.conditions.some(c => condition(c, context));
    if (test.op === 'not') return !condition(test.condition, context);
    if (test.op === 'exists') { try { resolve(test.value, context); return true; } catch (e) { if (e.code === 'MISSING_REFERENCE') return false; throw e; } }
    const left = resolve(test.left, context), right = resolve(test.right, context);
    if (test.op === 'eq') return equal(left, right);
    if (test.op === 'ne') return !equal(left, right);
    if (['gt', 'gte', 'lt', 'lte'].includes(test.op)) {
      if (typeof left !== 'number' || typeof right !== 'number') fail('INVALID_CONDITION', 'Numeric comparison requires numbers');
      return test.op === 'gt' ? left > right : test.op === 'gte' ? left >= right : test.op === 'lt' ? left < right : left <= right;
    }
    if (test.op === 'in') { if (!Array.isArray(right)) fail('INVALID_CONDITION', 'in requires an array'); return right.some(value => equal(value, left)); }
    if (test.op === 'contains') {
      if (Array.isArray(left)) return left.some(value => equal(value, right));
      if (typeof left === 'string' && typeof right === 'string') return left.includes(right);
      fail('INVALID_CONDITION', 'contains requires an array or strings');
    }
    fail('INVALID_CONDITION', 'Unknown operation');
  }
  function valid(schema, value) {
    if (typeof schema === 'boolean') return schema;
    const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
    const hasType = type => type === 'null' ? value === null : type === 'array' ? Array.isArray(value) :
      type === 'object' ? isObject : type === 'integer' ? Number.isInteger(value) : typeof value === type;
    if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).some(hasType)) return false;
    if (schema.enum && !schema.enum.some(entry => equal(entry, value))) return false;
    if (Object.hasOwn(schema, 'const') && !equal(schema.const, value)) return false;
    if (schema.allOf && !schema.allOf.every(s => valid(s, value))) return false;
    if (schema.anyOf && !schema.anyOf.some(s => valid(s, value))) return false;
    if (schema.oneOf && schema.oneOf.filter(s => valid(s, value)).length !== 1) return false;
    if (Object.hasOwn(schema, 'not') && valid(schema.not, value)) return false;
    if (isObject) {
      const keys = Object.keys(value), props = schema.properties ?? {};
      if (keys.length < (schema.minProperties ?? 0) || keys.length > (schema.maxProperties ?? Infinity)) return false;
      if ((schema.required ?? []).some(key => !Object.hasOwn(value, key))) return false;
      for (const key of keys) {
        if (Object.hasOwn(props, key)) { if (!valid(props[key], value[key])) return false; }
        else if (schema.additionalProperties === false || (typeof schema.additionalProperties === 'object' && !valid(schema.additionalProperties, value[key]))) return false;
      }
    }
    if (Array.isArray(value)) {
      if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) return false;
      if (Object.hasOwn(schema, 'items') && !value.every(item => valid(schema.items, item))) return false;
      if (schema.uniqueItems && value.some((item, i) => value.slice(0, i).some(other => equal(item, other)))) return false;
    }
    if (typeof value === 'string') { const length = [...value].length; if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? Infinity)) return false; }
    if (typeof value === 'number') {
      if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) return false;
      if (Object.hasOwn(schema, 'exclusiveMinimum') && value <= schema.exclusiveMinimum) return false;
      if (Object.hasOwn(schema, 'exclusiveMaximum') && value >= schema.exclusiveMaximum) return false;
    }
    return true;
  }
  function validate(schema, value) { data(value); if (!valid(schema, value)) fail('SCHEMA_MISMATCH', 'Value does not satisfy its schema'); }
  return { fail, data, copy, equal, resolve, condition, valid, validate };
}
