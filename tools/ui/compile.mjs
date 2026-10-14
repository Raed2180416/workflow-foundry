// Tier 0: compile a human task's answerSchema + question into a typed form spec (`foundry-ui-form/1`). Code only, no
// model; deterministic (same input, same spec and specHash). Anything outside the subset is refused with a reason,
// never flattened (AGENTS.md build discipline).
//
// Subset (a portable JSON-Schema subset; README "Subset"):
//   leaf    string (minLength, maxLength, pattern) | number | integer (minimum, maximum) | boolean
//           | enum / const of scalars (with an optional matching type and constraints every member satisfies)
//           | array whose items are an enum leaf (minItems, maxItems): a checkbox group
//   object  properties (leaves or one level of nested objects), required, additionalProperties: boolean
//   notes   title (label) and description (hint) on any node
import { FormRefused, SPEC_KIND, codePoints, deepFreeze, digest, humanize, isPlainObject, own, pointer, uiError, checkData } from './common.mjs';
import { patternProblems, PATTERN_MAX_INPUT } from './pattern.mjs';
import { valueErrors } from './validate.mjs';

export const LIMITS = Object.freeze({ fields: 60, options: 200, schemaBytes: 64 * 1024, questionCodePoints: 20000, noteCodePoints: 2000, inputMaxLength: 120 });
const ALLOWED = new Set(['type', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'items', 'minimum', 'maximum',
  'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'title', 'description']);
const APPLIES = {
  string: ['minLength', 'maxLength', 'pattern'], number: ['minimum', 'maximum'], integer: ['minimum', 'maximum'], boolean: [],
  array: ['items', 'minItems', 'maxItems'], object: ['properties', 'required', 'additionalProperties'],
};
const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);
const FORM_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;
const BIND_KEYS = ['workflowHash', 'nodeKey', 'runId', 'taskId'];
const RADIO_MAX = 6;

const isScalar = v => v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
const sortKey = v => `${v === null ? 'null' : typeof v}:${String(v)}`;

/** Compile, throwing FormRefused (with .errors in the OpenUI error shape) on anything outside the subset. */
export function compileForm(input) {
  const result = tryCompileForm(input);
  if (!result.ok) throw new FormRefused(result.errors);
  return result.spec;
}

/** Compile without throwing: { ok: true, spec } or { ok: false, errors }. */
export function tryCompileForm({ answerSchema, question, formName = 'task', bind = null, allowPattern = true } = {}) {
  const errors = [];
  const refuse = (code, path, message, hint) => errors.push(uiError('schema', code, { path, message, hint }));
  if (typeof question !== 'string' || question.trim() === '' || codePoints(question) > LIMITS.questionCodePoints)
    refuse('invalid-question', '', `question must be a non-empty string of at most ${LIMITS.questionCodePoints} code points`);
  if (typeof formName !== 'string' || !FORM_NAME.test(formName)) refuse('invalid-form-name', '', 'formName must match ^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$');
  let binding = null;
  if (bind !== null && bind !== undefined) {
    if (!isPlainObject(bind) || Object.keys(bind).some(k => !BIND_KEYS.includes(k) || typeof bind[k] !== 'string' || bind[k].length > 256))
      refuse('invalid-bind', '', `bind may only hold string ${BIND_KEYS.join(', ')} (each at most 256 characters)`);
    else binding = Object.fromEntries(BIND_KEYS.filter(k => own(bind, k)).map(k => [k, bind[k]]));
  }
  try { checkData(answerSchema, { maxBytes: LIMITS.schemaBytes, maxDepth: 12 }); }
  catch (error) { refuse('schema-limit', '', `answerSchema is not bounded JSON: ${error.message}`); return { ok: false, errors }; }
  if (errors.length) return { ok: false, errors };

  const fields = [], groups = [], warnings = [];
  const ctx = { refuse, allowPattern, fields, groups, warnings };
  const root = classify(answerSchema, '', 0, ctx);
  if (root && root.kind === 'object') buildObject(root, '', null, 0, ctx);
  else if (root) addField(root, { name: 'answer', path: '', label: null, required: true, group: null }, ctx);
  if (fields.length > LIMITS.fields) refuse('schema-limit', '', `the form would have ${fields.length} fields; at most ${LIMITS.fields} are supported`);
  if (errors.length) return { ok: false, errors };

  const spec = {
    kind: SPEC_KIND,
    formName,
    question,
    bind: binding,
    schemaHash: `sha256:${digest(answerSchema)}`,
    schema: structuredClone(answerSchema),
    rootKind: root.kind === 'object' ? 'object' : 'leaf',
    groups,
    fields,
    warnings,
  };
  spec.specHash = `sha256:${digest(spec)}`;
  return { ok: true, spec: deepFreeze(spec) };
}

// Checks one schema node and returns { kind, schema, ...facts } or null after recording refusals.
function classify(schema, path, depth, ctx) {
  const { refuse } = ctx;
  if (!isPlainObject(schema)) { refuse('invalid-schema', path || '', 'every sub-schema must be a JSON object'); return null; }
  let ok = true;
  for (const key of Object.keys(schema)) if (!ALLOWED.has(key)) {
    refuse('unsupported-keyword', pointer(path, key), `keyword "${key}" is outside the tier-0 form subset`, 'Remove it, or express the rule with type, enum, required, minimum/maximum, minLength/maxLength, pattern or minItems/maxItems');
    ok = false;
  }
  for (const key of ['title', 'description']) if (own(schema, key) && (typeof schema[key] !== 'string' || codePoints(schema[key]) > LIMITS.noteCodePoints)) {
    refuse('invalid-schema', pointer(path, key), `${key} must be a string of at most ${LIMITS.noteCodePoints} code points`); ok = false;
  }
  const { type } = schema;
  if (own(schema, 'type') && (typeof type !== 'string' || !TYPES.has(type))) {
    refuse('unsupported-type', pointer(path, 'type'), Array.isArray(type) ? 'union types are not supported; give one type' : `type ${JSON.stringify(type)} is not supported (string, number, integer, boolean, array, object)`);
    return null;
  }
  for (const key of ['minimum', 'maximum']) if (own(schema, key) && !(typeof schema[key] === 'number' && Number.isFinite(schema[key]))) { refuse('invalid-schema', pointer(path, key), `${key} must be a finite number`); ok = false; }
  for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems']) if (own(schema, key) && !(Number.isSafeInteger(schema[key]) && schema[key] >= 0)) { refuse('invalid-schema', pointer(path, key), `${key} must be a nonnegative integer`); ok = false; }
  if (!ok) return null;

  if (own(schema, 'enum') || own(schema, 'const')) return classifyEnum(schema, path, ctx);
  if (!own(schema, 'type')) { refuse('unsupported-type', path || '', 'a field needs a type or an enum'); return null; }
  for (const key of Object.keys(schema)) if (!['type', 'title', 'description', ...APPLIES[type]].includes(key)) {
    refuse('keyword-not-applicable', pointer(path, key), `keyword "${key}" does not apply to type ${type}`); ok = false;
  }
  if (!ok) return null;
  if (type === 'string') {
    if (own(schema, 'minLength') && own(schema, 'maxLength') && schema.minLength > schema.maxLength) { refuse('unsatisfiable', path || '', 'minLength is greater than maxLength'); return null; }
    if (own(schema, 'pattern')) {
      if (!ctx.allowPattern) { refuse('unsupported-keyword', pointer(path, 'pattern'), 'pattern is not allowed in this profile (the engine refuses untrusted patterns)'); return null; }
      const problems = patternProblems(schema.pattern);
      for (const p of problems) refuse(p.code, pointer(path, 'pattern'), p.message);
      if (problems.length) return null;
      if (!own(schema, 'maxLength') || schema.maxLength > PATTERN_MAX_INPUT) { refuse('pattern-needs-max-length', pointer(path, 'pattern'), `a field with a pattern must declare maxLength <= ${PATTERN_MAX_INPUT}`); return null; }
    }
    return { kind: 'string', schema };
  }
  if (type === 'number' || type === 'integer') {
    const { minimum: lo, maximum: hi } = schema;
    if (lo !== undefined && hi !== undefined && (lo > hi || (type === 'integer' && Math.ceil(lo) > Math.floor(hi)))) { refuse('unsatisfiable', path || '', `no ${type} lies between minimum and maximum`); return null; }
    return { kind: type, schema };
  }
  if (type === 'boolean') return { kind: 'boolean', schema };
  if (type === 'array') {
    if (!own(schema, 'items')) { refuse('unsupported-array-items', path || '', 'an array needs items that are an enum (a checkbox group)'); return null; }
    const items = classify(schema.items, pointer(path, 'items'), depth + 1, ctx);
    if (!items) return null;
    if (items.kind !== 'enum') { refuse('unsupported-array-items', pointer(path, 'items'), 'array items must be an enum or const of scalars (a checkbox group); free-text lists and repeaters are not in tier 0'); return null; }
    const n = items.options.length;
    if (own(schema, 'minItems') && own(schema, 'maxItems') && schema.minItems > schema.maxItems) { refuse('unsatisfiable', path || '', 'minItems is greater than maxItems'); return null; }
    if ((schema.minItems ?? 0) > n) { refuse('unsatisfiable', pointer(path, 'minItems'), `minItems (${schema.minItems}) exceeds the ${n} options; a checkbox group selects each option at most once`); return null; }
    return { kind: 'enum-array', schema, items };
  }
  // object
  if (depth > 1) { refuse('unsupported-nesting', path || '', 'objects may nest one level below the answer (a field group); deeper nesting is not in tier 0'); return null; }
  const props = schema.properties;
  if (!isPlainObject(props) || Object.keys(props).length === 0) { refuse('no-fields', path || '', 'an object answer needs at least one declared property'); return null; }
  if (own(schema, 'additionalProperties') && typeof schema.additionalProperties !== 'boolean') { refuse('unsupported-keyword', pointer(path, 'additionalProperties'), 'additionalProperties must be true or false; a schema there would accept keys the form cannot enter'); return null; }
  const required = schema.required ?? [];
  if (!Array.isArray(required) || required.some(r => typeof r !== 'string') || new Set(required).size !== required.length) { refuse('invalid-schema', pointer(path, 'required'), 'required must be an array of unique strings'); return null; }
  for (const name of required) if (!own(props, name)) refuse('required-undeclared', pointer(path, 'required'), `required property "${name}" is not declared in properties, so the form cannot enter it`);
  const children = [];
  for (const [name, child] of Object.entries(props)) {
    const c = classify(child, pointer(pointer(path, 'properties'), name), depth + 1, ctx);
    if (c) children.push({ name, node: c, required: required.includes(name) });
    else ok = false;
  }
  return ok ? { kind: 'object', schema, children } : null;
}

function classifyEnum(schema, path, ctx) {
  const { refuse } = ctx;
  if (own(schema, 'enum') && own(schema, 'const')) { refuse('unsupported-keyword', pointer(path, 'const'), 'give enum or const, not both'); return null; }
  const members = own(schema, 'const') ? [schema.const] : schema.enum;
  const at = pointer(path, own(schema, 'const') ? 'const' : 'enum');
  if (!Array.isArray(members) || members.length === 0) { refuse('invalid-schema', at, 'enum must be a non-empty array'); return null; }
  if (!members.every(isScalar)) { refuse('unsupported-type', at, 'enum members must be scalars (string, number, boolean, null); object and array members are not in tier 0'); return null; }
  if (members.length > LIMITS.options) { refuse('schema-limit', at, `at most ${LIMITS.options} options are supported`); return null; }
  const seen = new Set();
  for (const m of members) { const k = sortKey(m); if (seen.has(k)) { refuse('enum-duplicate', at, `enum lists ${JSON.stringify(m)} more than once`); return null; } seen.add(k); }
  const { type } = schema;
  if (type === 'object' || type === 'array') { refuse('unsupported-type', pointer(path, 'type'), 'an enum of objects or arrays is not in tier 0'); return null; }
  const allowed = ['enum', 'const', 'type', 'title', 'description', ...(type ? APPLIES[type] : [])];
  for (const key of Object.keys(schema)) if (!allowed.includes(key)) { refuse('keyword-not-applicable', pointer(path, key), `keyword "${key}" does not apply to ${type ? `type ${type}` : 'an enum without a type'}`); return null; }
  if (own(schema, 'pattern')) {
    if (!ctx.allowPattern) { refuse('unsupported-keyword', pointer(path, 'pattern'), 'pattern is not allowed in this profile'); return null; }
    const problems = patternProblems(schema.pattern);
    for (const p of problems) refuse(p.code, pointer(path, 'pattern'), p.message);
    if (problems.length) return null;
  }
  // Every member must itself be a valid answer: an option the host would reject could never be completed.
  const { pattern, ...noPattern } = schema; // a member is checked against the pattern below without the maxLength gate
  for (const m of members) {
    const bad = valueErrors(noPattern, m).length > 0 || (pattern !== undefined && typeof m === 'string' && !new RegExp(pattern, 'u').test(m));
    if (bad) { refuse('enum-member-invalid', at, `enum member ${JSON.stringify(m)} does not satisfy the rest of its own schema, so choosing it could never be accepted`); return null; }
  }
  // When an enum mixes JSON types, every label is JSON text, so the string "1" and the number 1 read differently.
  const mixed = new Set(members.map(m => (m === null ? 'null' : typeof m))).size > 1;
  const label = value => mixed || typeof value !== 'string' ? JSON.stringify(value) : value === '' ? '(empty text)' : value;
  const options = members.map((value, index) => ({ token: String(index), value, label: label(value) }));
  return { kind: 'enum', schema, options };
}

function buildObject(node, path, groupId, depth, ctx) {
  for (const { name, node: child, required } of node.children) {
    const childPath = pointer(path, name);
    const label = child.schema.title ?? humanize(name);
    if (child.kind === 'object') {
      const id = `g${ctx.groups.length}`;
      ctx.groups.push({ id, path: childPath, label, description: child.schema.description ?? null, required });
      buildObject(child, childPath, id, depth + 1, ctx);
    } else addField(child, { name: `answer${childPath}`, path: childPath, label, required, group: groupId }, ctx);
  }
}

function addField(node, { name, path, label, required, group }, ctx) {
  const index = ctx.fields.length, schema = node.schema;
  const field = { id: `f${index}`, name, path, label, description: schema.description ?? null, group, required, valueType: node.kind, componentType: null, constraints: {} };
  if (node.kind === 'string') {
    for (const k of ['minLength', 'maxLength', 'pattern']) if (own(schema, k)) field.constraints[k] = schema[k];
    field.componentType = own(schema, 'maxLength') && schema.maxLength <= LIMITS.inputMaxLength ? 'Input' : 'TextArea';
    if (required && !(schema.minLength >= 1)) ctx.warnings.push({ code: 'required-text-may-be-blank', path, message: `${label}: a blank entry satisfies the schema (no minLength), so "required" cannot stop an empty answer; add minLength: 1 if a blank answer is not acceptable` });
  } else if (node.kind === 'number' || node.kind === 'integer') {
    for (const k of ['minimum', 'maximum']) if (own(schema, k)) field.constraints[k] = schema[k];
    field.componentType = 'Input';
    field.inputMode = node.kind === 'integer' && (schema.minimum ?? -1) >= 0 ? 'numeric' : node.kind === 'integer' ? 'text' : 'decimal';
  } else if (node.kind === 'boolean') {
    field.componentType = 'RadioGroup';
    field.options = [{ token: 'true', value: true, label: 'Yes' }, { token: 'false', value: false, label: 'No' }];
  } else if (node.kind === 'enum') {
    field.options = node.options;
    field.componentType = node.options.length <= RADIO_MAX ? 'RadioGroup' : 'Select';
    if (schema.type) field.constraints.type = schema.type;
  } else if (node.kind === 'enum-array') {
    field.options = node.items.options;
    for (const k of ['minItems', 'maxItems']) if (own(schema, k)) field.constraints[k] = schema[k];
    field.componentType = 'CheckBoxGroup';
  }
  if (path === '') field.label = null; // the question labels a single-answer form
  ctx.fields.push(field);
}

