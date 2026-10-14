// Shared helpers for the tier-0 human-task form sidecar (G21; OPENUI.md §5.2, spike B1).
// No dependencies beyond node: and the repo's own src/data.mjs (read-only import; this sidecar changes no src/ file).
import { checkData, digest } from '../../src/data.mjs';

export { checkData, digest };

export const SPEC_KIND = 'foundry-ui-form/1';

// The error object borrows OpenUI's wire shape (spec/language.md §8.3, openui@39ce989): structural fields
// `source`, `code`, `statementId`, `component`, `path`, plus text for people (`message`, `hint`) that fixtures
// never compare. `statementId` is the form field's name (OpenUI: the statement name), `component` its
// componentType, `path` a JSON pointer into the answer (validator, adapter) or into the answer schema (schema).
// Sources: 'schema' (compile refusals), 'adapter' (formState -> typed answer), 'validator' (answer vs schema),
// 'host' (the submission envelope: form version, token, body).
export function uiError(source, code, { statementId, component, path, message, hint } = {}) {
  const error = { source, code };
  if (statementId !== undefined) error.statementId = statementId;
  if (component !== undefined) error.component = component;
  if (path !== undefined) error.path = path;
  error.message = message ?? code;
  if (hint !== undefined) error.hint = hint;
  return error;
}

export class FormRefused extends Error {
  constructor(errors) {
    super(`The answer schema cannot be compiled into a tier-0 form: ${errors.slice(0, 3).map(e => `${e.code} at ${e.path || '#'}`).join('; ')}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ''}`);
    this.code = 'UI_FORM_REFUSED';
    this.errors = errors;
  }
}

export const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
export const own = (object, key) => Object.hasOwn(object, key);
// Defines an own data property even for keys such as "__proto__" (plain assignment would set the prototype).
export const put = (object, key, value) => { Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true }); return object; };
export const codePoints = text => { let n = 0; for (const _ of text) n++; return n; };

// JSON pointer (RFC 6901) for one more segment.
export const pointer = (base, segment) => `${base}/${String(segment).replaceAll('~', '~0').replaceAll('/', '~1')}`;

// HTML text and attribute escaping. Every attribute this sidecar writes is double-quoted.
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ESCAPES[c]);

// Display text written by the workflow (question, titles, descriptions, enum labels) is shown as written, except
// characters that can hide or reorder what a person reads: bidi controls, zero-width characters, other control
// characters, lone surrogates and noncharacters become a visible marker ⟦U+XXXX⟧ (the run-view convention).
// Tab and line feed stay; CRLF becomes LF. Values a person typed are echoed back unmarked (escaped only).
const HIDDEN_RANGES = [[0x00, 0x08], [0x0B, 0x1F], [0x7F, 0x9F], [0xAD, 0xAD], [0x61C, 0x61C], [0x180E, 0x180E], [0x200B, 0x200F],
  [0x2028, 0x202E], [0x2060, 0x206F], [0xFEFF, 0xFEFF], [0xFFF9, 0xFFFB], [0xFFFE, 0xFFFF]];
const hiddenUnit = c => (c >= 0xD800 && c <= 0xDFFF) || HIDDEN_RANGES.some(([lo, hi]) => c >= lo && c <= hi);
const marker = c => `\u27E6U+${c.toString(16).toUpperCase().padStart(4, '0')}\u27E7`;
export function displayText(value) {
  const s = String(value).replace(/\r\n/g, '\n');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xDC00 && d <= 0xDFFF) { out += s[i] + s[i + 1]; i++; continue; } // a valid surrogate pair
    }
    out += hiddenUnit(c) ? marker(c) : s[i];
  }
  return out;
}

// A field label from a property name when the schema gives no title: "holdAmount" -> "Hold amount".
export function humanize(name) {
  const words = String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!words) return '(unnamed field)';
  const lower = words.toLowerCase();
  return lower[0].toUpperCase() + lower.slice(1);
}

// Deep-freezes a JSON value (specs are immutable once compiled).
export function deepFreeze(value) {
  if (value && typeof value === 'object') { for (const key of Object.keys(value)) deepFreeze(value[key]); Object.freeze(value); }
  return value;
}

export const sameScalar = (a, b) => a === b; // enum members are scalars; JSON has no NaN, and 0 === -0 as in ajv
