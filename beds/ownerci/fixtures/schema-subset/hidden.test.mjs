// ownerci hidden regression tests for src/schema-subset.mjs. Authored for the bed from the
// ORIGINAL module's behaviour at the frozen commit; never shown to solvers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PORTABLE_KEYWORDS, QUARANTINE_MAX_BITS, REJECTED_KEYWORDS, checkPortableSchema, checkQuarantinedSchema, portableSchemaViolations,
  quarantinedSchemaViolations } from './src/schema-subset.mjs';

const obj = (properties, extra = {}) => ({ type: 'object', additionalProperties: false, properties, ...extra });
const at = (sub, extra = {}) => portableSchemaViolations(obj({ a: sub }, extra));
const problems = list => list.map(v => [v.path, v.keyword, v.problem]);
const deep = n => (n === 0 ? 'leaf' : { d: deep(n - 1) });
// Capacity of one sub-schema in bits, read from the cap message after 64 required booleans of padding.
function capacity(sub, required = true) {
  const properties = {};
  for (let i = 0; i < 64; i++) properties[`p${i}`] = { type: 'boolean' };
  properties.x = sub;
  const list = quarantinedSchemaViolations(obj(properties, { required: [...Object.keys(properties).filter(k => k !== 'x'), ...(required ? ['x'] : [])] }));
  const cap = list.find(v => /^output capacity is /.test(v.problem));
  return cap ? Number(/is ([\d.]+) bits/.exec(cap.problem)[1]) - 64 : 0;
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('hidden schema-subset: keyword vocabularies are exact and frozen', () => {
  assert.deepEqual([...PORTABLE_KEYWORDS], ['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minimum', 'maximum', 'minItems',
    'maxItems', 'minLength', 'maxLength', 'description', 'const']);
  assert.deepEqual([...REJECTED_KEYWORDS], ['pattern', 'patternProperties', 'oneOf', 'anyOf', 'allOf', 'not', 'uniqueItems', '$ref', 'format', 'if', 'then', 'else']);
  assert.ok(Object.isFrozen(PORTABLE_KEYWORDS) && Object.isFrozen(REJECTED_KEYWORDS));
  assert.equal(QUARANTINE_MAX_BITS, 64);
});

test('hidden schema-subset: root must be an object schema; non-objects are not walked', () => {
  for (const root of [[], null, 'object', 3]) assert.deepEqual(problems(portableSchemaViolations(root)), [['#', 'type', 'root schema must declare type "object"']]);
  assert.deepEqual(problems(portableSchemaViolations({ type: ['object', 'null'] })), [['#', 'type', 'root schema must declare type "object"']]);
  assert.deepEqual(problems(portableSchemaViolations({ properties: {} })), [['#', 'type', 'root schema must declare type "object"']]);
  assert.deepEqual(portableSchemaViolations({ type: 'object' }), []);
});

test('hidden schema-subset: size and depth limits come from checkData (256 KiB, depth 25)', () => {
  const limit = [['#', null, 'JSON structure exceeds the supported limit']];
  assert.deepEqual(problems(portableSchemaViolations(deep(26))), limit);
  assert.notDeepEqual(problems(portableSchemaViolations(deep(25))), limit);
  const sized = k => ({ type: 'object', description: 'x'.repeat(k) });
  const overhead = JSON.stringify(sized(0)).length;
  assert.deepEqual(portableSchemaViolations(sized(256 * 1024 - overhead)), []);
  assert.deepEqual(problems(portableSchemaViolations(sized(256 * 1024 - overhead + 1))), [['#', null, 'JSON bytes exceed the supported limit']]);
  assert.deepEqual(problems(portableSchemaViolations({ type: 'object', minimum: NaN })), [['#', null, 'Numbers must be finite']]);
});

test('hidden schema-subset: type keyword forms', () => {
  assert.deepEqual(at({ type: ['string', 'null'] }), []);
  assert.deepEqual(at({ type: 'integer' }), []);
  for (const type of [[], ['string', 'string'], 'date', 5, ['string', 'date']]) {
    assert.deepEqual(problems(at({ type })), [['#/properties/a', 'type', 'type must name JSON types']], JSON.stringify(type));
  }
});

test('hidden schema-subset: properties, required and additionalProperties shapes', () => {
  assert.deepEqual(problems(at({ type: 'object', properties: [] })), [['#/properties/a', 'properties', 'properties must be an object']]);
  assert.deepEqual(problems(at({ type: 'object', properties: { b: { type: 'string', title: 'B' } } })), [['#/properties/a/properties/b', 'title', 'keyword is outside the portable allowlist']]);
  assert.deepEqual(at({ type: 'object', required: [] }), []);
  for (const required of [['a', 'a'], [1], 'a', [null]]) assert.deepEqual(problems(at({ type: 'object', required })), [['#/properties/a', 'required', 'required must be unique strings']]);
  assert.deepEqual(at({ type: 'object', additionalProperties: true }), []);
  assert.deepEqual(problems(at({ type: 'object', additionalProperties: 'no' })), [['#/properties/a', 'additionalProperties', 'additionalProperties must be boolean or a schema']]);
  assert.deepEqual(problems(at({ type: 'object', additionalProperties: { type: 'string', format: 'email' } })), [['#/properties/a/additionalProperties', 'format', 'keyword is not portable']]);
  assert.deepEqual(problems(portableSchemaViolations({ type: 'object', additionalProperties: { pattern: 'x' } })), [['#/additionalProperties', 'pattern', 'keyword is not portable']]);
});

test('hidden schema-subset: items, enum, bounds, lengths and description', () => {
  assert.deepEqual(problems(at({ type: 'array', items: [{ type: 'string' }] })), [['#/properties/a', 'items', 'tuple items are not portable']]);
  assert.deepEqual(problems(at({ type: 'array', items: 5 })), [['#/properties/a/items', null, 'sub-schema must be an object']]);
  assert.deepEqual(problems(at({ type: 'array', items: { anyOf: [] } })), [['#/properties/a/items', 'anyOf', 'keyword is not portable']]);
  assert.deepEqual(at({ enum: [null, 1, 'a', true] }), []);
  for (const e of [[], [[1]], [{}], 'a']) assert.deepEqual(problems(at({ enum: e })), [['#/properties/a', 'enum', 'enum must be a non-empty array of scalars']]);
  assert.deepEqual(at({ type: 'number', minimum: -2.5, maximum: 0 }), []);
  assert.deepEqual(problems(at({ type: 'number', minimum: '1' })), [['#/properties/a', 'minimum', 'minimum must be a finite number']]);
  assert.deepEqual(problems(at({ type: 'number', maximum: null })), [['#/properties/a', 'maximum', 'maximum must be a finite number']]);
  assert.deepEqual(at({ type: 'string', minLength: 0, maxLength: 0 }), []);
  for (const v of [-1, 1.5, 2 ** 53, '3']) {
    assert.deepEqual(problems(at({ type: 'array', items: { type: 'string' }, minItems: v })), [['#/properties/a', 'minItems', 'minItems must be a nonnegative integer']], String(v));
    assert.deepEqual(problems(at({ type: 'string', maxLength: v })), [['#/properties/a', 'maxLength', 'maxLength must be a nonnegative integer']], String(v));
  }
  assert.deepEqual(problems(at({ type: 'string', description: 5 })), [['#/properties/a', 'description', 'description must be a string']]);
  assert.deepEqual(problems(at({ const: 'x', pattern: 'x', minItems: -1 })), [['#/properties/a', 'pattern', 'keyword is not portable'], ['#/properties/a', 'minItems', 'minItems must be a nonnegative integer']]);
});

test('hidden schema-subset: checkPortableSchema reports at most five violations in its message', () => {
  const ok = obj({ a: { type: 'string' } });
  assert.equal(checkPortableSchema(ok), ok);
  const bad = obj({ a: { title: 'x' }, b: { pattern: 'x' }, c: { type: 'date' }, d: { enum: [] }, e: { minLength: -1 }, f: { description: 1 } });
  assert.throws(() => checkPortableSchema(bad), e => e.code === 'SCHEMA_NOT_PORTABLE' && e.details.violations.length === 6
    && e.message === 'Output schema is outside the portable subset: #/properties/a title: keyword is outside the portable allowlist; '
      + '#/properties/b pattern: keyword is not portable; #/properties/c type: type must name JSON types; '
      + '#/properties/d enum: enum must be a non-empty array of scalars; #/properties/e minLength: minLength must be a nonnegative integer');
  assert.throws(() => checkPortableSchema(obj({ a: 3 })), e => e.message === 'Output schema is outside the portable subset: #/properties/a: sub-schema must be an object');
});

test('hidden schema-subset: quarantine leaf capacities in bits', () => {
  near(capacity({ type: 'boolean' }), 1);
  near(capacity({ enum: ['a', 'b', 'c', 'd'] }), 2);
  near(capacity({ type: 'string', enum: ['a', 'a', 'b'] }), 1);
  near(capacity({ enum: ['only'] }), 0);
  near(capacity({ const: 'x' }), 0);
  near(capacity({ const: false }), 0);
  near(capacity({ type: 'integer', minimum: 0, maximum: 255 }), 8);
  near(capacity({ type: 'integer', minimum: 0.5, maximum: 3.5 }), 1.6);
  near(capacity({ type: 'integer', minimum: 1, maximum: 1 }), 0);
  near(capacity({ type: 'integer', minimum: 5, maximum: 4 }), 0);
  near(capacity({ type: 'number', minimum: 1, maximum: 2 }), 52);
  near(capacity({ type: 'number', minimum: -1, maximum: 1 }), 63);
  near(capacity({ type: 'number', minimum: 0, maximum: 1 }), 62);
});

test('hidden schema-subset: quarantine container capacities in bits', () => {
  near(capacity({ type: 'boolean' }, false), 1.6);
  near(capacity({ const: 'c' }, false), 1);
  near(capacity({ type: 'array', minItems: 1, maxItems: 3, items: { type: 'boolean' } }), 4.6);
  near(capacity({ type: 'array', maxItems: 2, items: { enum: ['a', 'b', 'c', 'd'] } }), 5.6);
  near(capacity({ type: 'array', maxItems: 0, items: { type: 'boolean' } }), 0);
  near(capacity(obj({ a: { type: 'boolean' }, b: { type: 'boolean' } }, { required: ['a'] })), 2.6);
  near(capacity(obj({})), 0);
  const sixtyFour = {};
  for (let i = 0; i < 64; i++) sixtyFour[`b${i}`] = { type: 'boolean' };
  assert.deepEqual(quarantinedSchemaViolations(obj(sixtyFour, { required: Object.keys(sixtyFour) })), []);
  const fortyOptional = {};
  for (let i = 0; i < 40; i++) fortyOptional[`o${i}`] = { type: 'boolean' };
  assert.deepEqual(quarantinedSchemaViolations(obj(fortyOptional)), []);
  fortyOptional.o40 = { type: 'boolean' };
  assert.deepEqual(problems(quarantinedSchemaViolations(obj(fortyOptional))), [['#', null, 'output capacity is 65 bits; a quarantined output may carry at most 64']]);
});

test('hidden schema-subset: quarantine shape violations and their paths', () => {
  const q = sub => problems(quarantinedSchemaViolations(obj({ a: sub })));
  assert.deepEqual(q({ const: 1 }), [['#/properties/a', null, 'const leaves must be a string or boolean']]);
  assert.deepEqual(q({ const: null }), [['#/properties/a', null, 'const leaves must be a string or boolean']]);
  assert.deepEqual(q({ type: 'integer', enum: ['a'] }), [['#/properties/a', null, 'enum leaves must be string-only']]);
  assert.deepEqual(q({ enum: ['a', 2] }), [['#/properties/a', null, 'enum leaves must be string-only']]);
  assert.deepEqual(q({}), [['#/properties/a', null, 'every quarantined sub-schema needs exactly one type']]);
  assert.deepEqual(q({ type: ['boolean'] }), [['#/properties/a', null, 'every quarantined sub-schema needs exactly one type']]);
  assert.deepEqual(q({ type: 'number', minimum: 0 }), [['#/properties/a', null, 'numbers must declare both minimum and maximum']]);
  assert.deepEqual(q({ type: 'integer', maximum: 3 }), [['#/properties/a', null, 'numbers must declare both minimum and maximum']]);
  assert.deepEqual(q({ type: 'array', items: { type: 'boolean' } }), [['#/properties/a', null, 'arrays must declare maxItems']]);
  assert.deepEqual(q({ type: 'array', maxItems: 2 }), [['#/properties/a', null, 'arrays must declare items']]);
  assert.deepEqual(q({ type: 'array', maxItems: 2, items: { type: 'string' } }), [['#/properties/a/items', null, 'free strings are not allowed; use a string enum']]);
  assert.deepEqual(q({ type: 'null' }), [['#/properties/a', null, 'type null is not allowed']]);
  assert.deepEqual(q({ type: 'object', properties: { b: { type: 'boolean' } } }), [['#/properties/a', null, 'objects must set additionalProperties: false']]);
  assert.deepEqual(problems(quarantinedSchemaViolations({ type: 'object', properties: { s: { type: 'string', pattern: 'x' } } })), [['#/properties/s', 'pattern', 'keyword is not portable']]);
});

test('hidden schema-subset: checkQuarantinedSchema message and return value', () => {
  const ok = obj({ flag: { type: 'boolean' } });
  assert.equal(checkQuarantinedSchema(ok), ok);
  assert.throws(() => checkQuarantinedSchema(obj({ a: { type: 'string' }, b: { type: 'null' } })), e => e.code === 'QUARANTINE_SCHEMA'
    && e.details.violations.length === 2
    && e.message === 'Quarantined output schema may contain only booleans, string enums and bounded numbers within 64 bits of output capacity: '
      + '#/properties/a: free strings are not allowed; use a string enum; #/properties/b: type null is not allowed');
  const many = {};
  for (let i = 0; i < 7; i++) many[`s${i}`] = { type: 'string' };
  assert.throws(() => checkQuarantinedSchema(obj(many)), e => e.details.violations.length === 7 && e.message.split('; use a string enum').length === 6);
});
