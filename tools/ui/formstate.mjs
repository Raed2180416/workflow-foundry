// The `formState` adapter: OpenUI-shaped form events -> a typed answer, re-validated on the host.
//
// OpenUI 1.0 events carry `formName` and `formState`, where inside a form each field is `{ value, componentType }`
// and the form's fields sit under the form name: `{ formState: { <formName>: { <field>: { value, componentType } } } }`
// (spec/language.md §6.3, openui@39ce989). componentType is the component's name ("Input", "Select", ...); OpenUI's
// react-ui path may omit it, so an absent componentType is accepted and a present one must match the spec.
//
// Field names are `answer` + the JSON pointer of the leaf ("answer" for a single-answer form, "answer/amount",
// "answer/release/amount"). Values by component:
//   Input / TextArea (text)   string
//   Input (number, integer)   a JSON number, or a string in strict decimal syntax (no "12abc", "0x10", "1,000",
//                             "Infinity", "+1", ".5"); surrounding spaces and tabs are ignored
//   RadioGroup / Select       a member of the enum (strict equality); for a boolean field true/false or "true"/"false"
//   CheckBoxGroup             an array of enum members, or OpenUI's aggregate { <option token>: boolean }
// Blank (null, "", [], an all-false aggregate, or the field absent) means "no answer" for that field, except that a
// required text field that is blank is the empty string (the schema decides whether that is acceptable) and a required
// checkbox group that is blank is []. An optional field group whose fields are all blank is left out of the answer.
import { isPlainObject, own, put, uiError } from './common.mjs';
import { fieldForPath, toUiError, validateAnswer } from './validate.mjs';

const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const PLAIN_INTEGER = /^-?(?:0|[1-9][0-9]*)$/;
const BLANK = Symbol('blank');

/** Parses a number typed into a text box. Returns { value } or { code }. */
export function parseNumberText(text, valueType) {
  const t = text.replace(/^[ \t]+|[ \t]+$/g, '');
  if (t === '') return { value: BLANK };
  if (!NUMBER.test(t)) return { code: 'not-a-number' };
  const n = Number(t);
  if (!Number.isFinite(n)) return { code: 'number-out-of-range' };
  if (n === 0 && /[1-9]/.test(t.split(/[eE]/)[0])) return { code: 'number-out-of-range' }; // underflow to zero
  if (valueType === 'integer' && Number.isInteger(n) && !Number.isSafeInteger(n) && !(PLAIN_INTEGER.test(t) && BigInt(t) === BigInt(n))) return { code: 'number-precision' };
  return { value: n === 0 ? 0 : n };
}

const ADAPTER_TEXT = {
  'unknown-form': ['The event is not for this form', 'Send the fields under formState[formName] for this form'],
  'unknown-field': ['The submission has a field this form does not declare', 'Send only the declared fields'],
  'field-shape': ['A field must be { value, componentType }', 'Wrap each field value as OpenUI does'],
  'component-mismatch': ['The field was sent from a different component type', 'Use the component the form declares'],
  'type-mismatch': ['The value has the wrong type for this field', 'Send the value type the field declares'],
  'not-a-number': ['Enter a number, like 1250.50', 'Use digits with an optional minus sign, decimal point and exponent; no letters, spaces inside, commas, currency signs or hexadecimal'],
  'number-out-of-range': ['The number is too large or too small to store exactly', 'Enter a smaller number'],
  'number-precision': ['The whole number is too large to store exactly', `Enter a whole number between -${Number.MAX_SAFE_INTEGER} and ${Number.MAX_SAFE_INTEGER}`],
  'enum-mismatch': ['Choose one of the listed options', 'The value must be one of the options exactly'],
  'unknown-option': ['The selected option does not exist', 'Choose one of the listed options'],
  'duplicate-field': ['The field was sent more than once', 'Send each field once'],
};
const fieldLabel = field => field?.label ?? 'The answer';
function adapterError(source, code, field, path) {
  const [message, hint] = ADAPTER_TEXT[code] ?? [code, undefined];
  return uiError(source, code, { statementId: field?.name, component: field?.componentType, path: path ?? field?.path, message: field && !['unknown-field', 'unknown-form'].includes(code) ? `${fieldLabel(field)}: ${message[0].toLowerCase()}${message.slice(1)}` : message, hint });
}

// Converts one field's formState value. Returns { value } (possibly BLANK) or { code }.
function convert(field, value) {
  // An enum may list "" or null as a real choice; membership is checked before blank handling.
  if (field.valueType === 'enum') { const hit = field.options.find(o => o.value === value); if (hit) return { value: hit.value }; }
  if (value === null || value === undefined) return { value: BLANK };
  switch (field.valueType) {
    case 'string':
      if (typeof value !== 'string') return { code: 'type-mismatch' };
      return { value: value === '' ? BLANK : value, raw: value };
    case 'number': case 'integer':
      if (typeof value === 'number') return Number.isFinite(value) ? { value: value === 0 ? 0 : value } : { code: 'not-a-number' };
      if (typeof value !== 'string') return { code: 'type-mismatch' };
      return parseNumberText(value, field.valueType);
    case 'boolean':
      if (typeof value === 'boolean') return { value };
      if (value === 'true' || value === 'false') return { value: value === 'true' };
      if (value === '') return { value: BLANK };
      return typeof value === 'string' ? { code: 'enum-mismatch' } : { code: 'type-mismatch' };
    case 'enum': {
      const hit = field.options.find(o => o.value === value);
      if (hit) return { value: hit.value };
      if (value === '') return { value: BLANK };
      return { code: 'enum-mismatch' };
    }
    case 'enum-array': {
      if (Array.isArray(value)) {
        for (const item of value) if (!field.options.some(o => o.value === item)) return { code: 'enum-mismatch' };
        return { value: value.length ? [...value] : BLANK };
      }
      if (!isPlainObject(value)) return { code: 'type-mismatch' };
      for (const [token, on] of Object.entries(value)) {
        if (!field.options.some(o => o.token === token)) return { code: 'unknown-option' };
        if (typeof on !== 'boolean') return { code: 'type-mismatch' };
      }
      const picked = field.options.filter(o => own(value, o.token) && value[o.token] === true).map(o => o.value);
      return { value: picked.length ? picked : BLANK };
    }
    default: return { code: 'type-mismatch' };
  }
}

/** Builds the typed answer from converted field values (Map field.name -> value | BLANK). */
function assemble(spec, converted) {
  const finalValue = field => {
    const v = converted.has(field.name) ? converted.get(field.name) : BLANK;
    if (v !== BLANK) return v;
    if (field.required && field.valueType === 'string') return '';
    if (field.required && field.valueType === 'enum-array') return [];
    return BLANK;
  };
  if (spec.rootKind === 'leaf') { const v = finalValue(spec.fields[0]); return v === BLANK ? undefined : v; }
  const answer = {};
  const groupObjects = new Map();
  for (const group of spec.groups) {
    const members = spec.fields.filter(f => f.group === group.id);
    const touched = members.some(f => converted.has(f.name) && converted.get(f.name) !== BLANK);
    if (group.required || touched) groupObjects.set(group.id, {});
  }
  // Insert in schema order: walk fields and groups by path order of first appearance.
  const placed = new Set();
  for (const field of spec.fields) {
    if (field.group) {
      const group = spec.groups.find(g => g.id === field.group), object = groupObjects.get(group.id);
      if (!object) continue;
      if (!placed.has(group.id)) { put(answer, lastSegment(group.path), object); placed.add(group.id); }
      const v = finalValue(field);
      if (v !== BLANK) put(object, lastSegment(field.path), v);
    } else {
      const v = finalValue(field);
      if (v !== BLANK) put(answer, lastSegment(field.path), v);
    }
  }
  return answer;
}
const lastSegment = path => path.slice(path.lastIndexOf('/') + 1).replaceAll('~1', '/').replaceAll('~0', '~');

/** Merges adapter errors and validator errors: a field with an adapter error gets no validator error. Sorted by field order. */
function finish(spec, adapterErrors, answer) {
  const blocked = new Set(adapterErrors.filter(e => e.statementId).map(e => e.statementId));
  const blockedPaths = spec.fields.filter(f => blocked.has(f.name)).map(f => f.path);
  const validatorErrors = validateAnswer(spec, answer).filter(e => !blockedPaths.some(p => e.path === p || (p !== '' && e.path.startsWith(`${p}/`)) || p === ''));
  const order = new Map(spec.fields.map((f, i) => [f.name, i]));
  const errors = [...adapterErrors, ...validatorErrors].map((e, i) => [e, i])
    .sort(([a, i], [b, j]) => (order.get(a.statementId) ?? -1) - (order.get(b.statementId) ?? -1) || i - j).map(([e]) => e);
  return errors.length ? { ok: false, errors } : { ok: true, answer, errors: [] };
}

/**
 * OpenUI-shaped event or formState -> { ok, answer?, errors }.
 * Accepts `{ formName, formState: { [formName]: fields } }` or a bare `{ [formName]: fields }`.
 */
export function answerFromFormState(spec, input) {
  const errors = [];
  let state = input;
  if (isPlainObject(input) && own(input, 'formState')) {
    if (input.formName !== spec.formName) return { ok: false, errors: [adapterError('adapter', 'unknown-form', null, '')] };
    state = input.formState;
  }
  if (!isPlainObject(state) || !own(state, spec.formName) || Object.keys(state).length !== 1 || !isPlainObject(state[spec.formName]))
    return { ok: false, errors: [adapterError('adapter', 'unknown-form', null, '')] };
  const fields = state[spec.formName];
  const byName = new Map(spec.fields.map(f => [f.name, f]));
  const converted = new Map();
  for (const name of Object.keys(fields)) {
    const field = byName.get(name);
    if (!field) { errors.push({ ...adapterError('adapter', 'unknown-field', null, ''), statementId: name }); continue; }
    const entry = fields[name];
    if (!isPlainObject(entry) || !own(entry, 'value') || Object.keys(entry).some(k => k !== 'value' && k !== 'componentType')) { errors.push(adapterError('adapter', 'field-shape', field)); continue; }
    if (own(entry, 'componentType') && entry.componentType !== undefined && entry.componentType !== field.componentType) { errors.push(adapterError('adapter', 'component-mismatch', field)); continue; }
    const result = convert(field, entry.value);
    if (result.code) { errors.push(adapterError('adapter', result.code, field)); continue; }
    converted.set(name, result.value);
  }
  return finish(spec, errors, assemble(spec, converted));
}

// ---- The browser route: application/x-www-form-urlencoded -> formState -------------------------------------------

/**
 * Parses a form submission (string body or URLSearchParams) into OpenUI-shaped formState, plus host errors and the
 * raw values to echo back into a re-rendered form. Option controls carry tokens ("0", "1", ...), mapped here to the
 * enum members; text areas have CRLF normalised to LF (browsers send CRLF).
 */
export function formStateFromSubmission(spec, body, { token = null } = {}) {
  const params = body instanceof URLSearchParams ? body : new URLSearchParams(String(body));
  const errors = [], values = {}, fields = {};
  const byName = new Map(spec.fields.map(f => [f.name, f]));
  const counts = new Map();
  for (const [name] of params) counts.set(name, (counts.get(name) ?? 0) + 1);
  if (params.getAll('_spec').length !== 1 || params.get('_spec') !== spec.specHash)
    errors.push(uiError('host', 'stale-form', { path: '', message: 'This form is out of date or for another task', hint: 'Reload the page and answer again' }));
  if (token !== null && (params.getAll('_token').length !== 1 || !safeEqual(params.get('_token'), token)))
    errors.push(uiError('host', 'bad-token', { path: '', message: 'The form token is missing or wrong', hint: 'Reload the page and answer again' }));
  for (const [name, count] of counts) {
    if (name === '_spec' || name === '_token') continue;
    const field = byName.get(name);
    if (!field) { errors.push({ ...adapterError('host', 'unknown-field', null, ''), statementId: name }); continue; }
    if (count > 1 && field.componentType !== 'CheckBoxGroup') errors.push(adapterError('host', 'duplicate-field', field));
  }
  for (const field of spec.fields) {
    const raw = params.getAll(field.name);
    if (field.componentType === 'CheckBoxGroup') {
      values[field.name] = raw;
      if (new Set(raw).size !== raw.length) { errors.push(adapterError('host', 'duplicate-field', field)); continue; }
      if (raw.some(t => !field.options.some(o => o.token === t))) { errors.push(adapterError('host', 'unknown-option', field)); continue; }
      fields[field.name] = { value: Object.fromEntries(field.options.map(o => [o.token, raw.includes(o.token)])), componentType: field.componentType };
      continue;
    }
    if (raw.length) values[field.name] = raw[0];
    if (raw.length !== 1) continue; // absent: blank; duplicates were reported above
    const text = raw[0];
    if (field.componentType === 'RadioGroup' || field.componentType === 'Select') {
      if (text === '' && field.componentType === 'Select') continue; // the "Choose an option" placeholder
      const option = field.options.find(o => o.token === text);
      if (!option) { errors.push(adapterError('host', 'unknown-option', field)); continue; }
      fields[field.name] = { value: option.value, componentType: field.componentType };
      continue;
    }
    fields[field.name] = { value: field.componentType === 'TextArea' ? text.replace(/\r\n/g, '\n') : text, componentType: field.componentType };
  }
  return { formState: { [spec.formName]: fields }, errors, values };
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** The whole host route: parse, adapt, re-validate. { ok, answer?, errors, values }. */
export function acceptSubmission(spec, body, { token = null } = {}) {
  const parsed = formStateFromSubmission(spec, body, { token });
  const envelope = parsed.errors.filter(e => e.code === 'stale-form' || e.code === 'bad-token');
  if (envelope.length) return { ok: false, errors: envelope, values: parsed.values };
  const adapted = answerFromFormState(spec, parsed.formState);
  const seen = new Set(parsed.errors.map(e => e.statementId).filter(Boolean));
  const errors = [...parsed.errors, ...adapted.errors.filter(e => !seen.has(e.statementId))];
  return errors.length ? { ok: false, errors, values: parsed.values } : { ok: true, answer: adapted.answer, errors: [], values: parsed.values, formState: parsed.formState };
}

// ---- Encoders: what a person (or a scripted actor) filling the form would send ------------------------------------

const valueAt = (answer, path) => {
  if (path === '') return { present: answer !== undefined, value: answer };
  let v = answer;
  for (const seg of path.slice(1).split('/').map(s => s.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    if (!isPlainObject(v) || !own(v, seg)) return { present: false };
    v = v[seg];
  }
  return { present: true, value: v };
};

// Ways a valid answer can differ from anything the form produces (README "Completability").
function representationGaps(spec, answer) {
  const gaps = [];
  if (spec.rootKind === 'object' && isPlainObject(answer)) {
    const top = new Set(spec.fields.filter(f => !f.group).map(f => lastSegment(f.path)).concat(spec.groups.map(g => lastSegment(g.path))));
    for (const k of Object.keys(answer)) if (!top.has(k)) gaps.push('undeclared-property');
    for (const g of spec.groups) {
      const { present, value } = valueAt(answer, g.path);
      if (!present || !isPlainObject(value)) continue;
      const names = new Set(spec.fields.filter(f => f.group === g.id).map(f => lastSegment(f.path)));
      for (const k of Object.keys(value)) if (!names.has(k)) gaps.push('undeclared-property');
      const members = spec.fields.filter(f => f.group === g.id);
      const blank = members.every(f => { const at = valueAt(answer, f.path); return !at.present || at.value === '' || (Array.isArray(at.value) && at.value.length === 0); });
      if (!g.required && blank) gaps.push('empty-optional-group');
    }
  }
  for (const f of spec.fields) {
    const { present, value } = valueAt(answer, f.path);
    if (!present) continue;
    if (!f.required && value === '' && f.valueType === 'string') gaps.push('optional-empty-text');
    if (!f.required && Array.isArray(value) && value.length === 0) gaps.push('optional-empty-selection');
  }
  return gaps;
}

/**
 * The OpenUI-shaped event a client would send for `answer`. mode 'typed' sends JSON values; mode 'text' sends what
 * text widgets hold (numbers and booleans as strings, checkbox groups as the aggregate map). Returns
 * { event, gaps } where gaps lists why the form cannot reproduce the answer exactly (empty when it can).
 */
export function formStateFromAnswer(spec, answer, { mode = 'typed' } = {}) {
  const fields = {}, gaps = representationGaps(spec, answer);
  for (const f of spec.fields) {
    const { present, value } = valueAt(answer, f.path);
    if (!present) continue;
    let v = value;
    if (mode === 'text') {
      if (f.valueType === 'number' || f.valueType === 'integer') v = typeof value === 'number' ? String(value) : value;
      if (f.valueType === 'boolean') v = typeof value === 'boolean' ? String(value) : value;
      if (f.valueType === 'enum-array' && Array.isArray(value)) {
        v = Object.fromEntries(f.options.map(o => [o.token, value.includes(o.value)]));
        if (!sameSelection(f, value)) gaps.push('selection-order-or-duplicates');
      }
    }
    fields[f.name] = { value: v, componentType: f.componentType };
  }
  return { event: { type: 'submit', formName: spec.formName, formState: { [spec.formName]: fields } }, gaps: [...new Set(gaps)] };
}

const sameSelection = (f, value) => {
  const canonical = f.options.filter(o => value.includes(o.value)).map(o => o.value);
  return canonical.length === value.length && canonical.every((v, i) => v === value[i]);
};

/** The urlencoded body a browser sends when a person enters `answer` into the rendered form, and the gaps. */
export function submissionFromAnswer(spec, answer, { token = null } = {}) {
  const params = new URLSearchParams(), gaps = representationGaps(spec, answer);
  params.append('_spec', spec.specHash);
  if (token !== null) params.append('_token', token);
  for (const f of spec.fields) {
    const { present, value } = valueAt(answer, f.path);
    switch (f.componentType) {
      case 'Input': case 'TextArea': {
        const text = !present ? '' : typeof value === 'number' ? String(value) : String(value);
        if (f.componentType === 'Input' && /[\r\n]/.test(text)) gaps.push('line-break-in-single-line-input');
        if (f.componentType === 'TextArea' && /\r/.test(text)) gaps.push('carriage-return');
        if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)) gaps.push('lone-surrogate');
        params.append(f.name, f.componentType === 'TextArea' ? text.replace(/\n/g, '\r\n') : text);
        break;
      }
      case 'Select': {
        const option = present ? f.options.find(o => o.value === value) : null;
        params.append(f.name, option ? option.token : '');
        break;
      }
      case 'RadioGroup': {
        const option = present ? f.options.find(o => o.value === value) : null;
        if (option) params.append(f.name, option.token);
        break;
      }
      case 'CheckBoxGroup': {
        if (!present || !Array.isArray(value)) break;
        if (!sameSelection(f, value)) gaps.push('selection-order-or-duplicates');
        for (const o of f.options) if (value.includes(o.value)) params.append(f.name, o.token);
        break;
      }
    }
  }
  return { params, body: params.toString(), gaps: [...new Set(gaps)] };
}

export { fieldForPath, toUiError, BLANK };
