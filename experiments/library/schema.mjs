// schema.mjs: schema checks for the library. Validation uses the repository's own validator (src/validate.mjs
// validateData, Ajv over the portable subset; import only). Subsumption ("every value valid under A is valid under B")
// is new and conservative: it answers true only when it can show it over the portable subset (type, enum, const,
// required, properties, additionalProperties, items, minimum/maximum, minItems/maxItems, minLength/maxLength); anything
// it does not understand in A or B makes it answer false (LIBRARY §6 CALL_TYPE: "schema subsumption over the portable
// subset").
import { validateData } from '../../src/validate.mjs';

export function validate(schema, value) {
  if (schema == null) return { valid: true, errors: null };
  try { validateData(schema, value, 'value', { trustedSchema: true }); return { valid: true, errors: null }; }
  catch (error) { return { valid: false, errors: (error.details ?? [{ message: String(error.message ?? error) }]).slice(0, 5).map(e => `${e.instancePath ?? ''} ${e.message ?? ''}`.trim()) }; }
}

const KNOWN = new Set(['type', 'enum', 'const', 'required', 'properties', 'additionalProperties', 'items', 'minimum', 'maximum', 'minItems', 'maxItems',
  'minLength', 'maxLength', 'description', 'title', '$comment', 'default', 'examples']);
const typesOf = s => (s.type == null ? null : Array.isArray(s.type) ? s.type : [s.type]);
const widen = t => (t === 'integer' ? ['integer', 'number'] : [t]);

// Returns { ok, why } where why names the first reason subsumption could not be shown.
export function subsumes(a, b, at = '') {
  if (b == null || b === true || (typeof b === 'object' && !Object.keys(b).length)) return { ok: true };
  if (a == null || a === true || typeof a !== 'object') return { ok: false, why: `${at || '/'}: the source schema is unconstrained` };
  for (const s of [a, b]) for (const k of Object.keys(s)) if (!KNOWN.has(k)) return { ok: false, why: `${at || '/'}: keyword ${k} is outside the portable subset` };
  const ta = typesOf(a), tb = typesOf(b);
  if (tb) {
    if (!ta && !Array.isArray(a.enum) && a.const === undefined) return { ok: false, why: `${at || '/'}: untyped source, typed target ${tb.join('|')}` };
    if (ta && !ta.every(t => tb.includes(t) || (t === 'integer' && tb.includes('number')))) return { ok: false, why: `${at || '/'}: type ${ta.join('|')} is not within ${tb.join('|')}` };
  }
  const values = Array.isArray(a.enum) ? a.enum : a.const !== undefined ? [a.const] : null;
  if (Array.isArray(b.enum) || b.const !== undefined) {
    const allowed = Array.isArray(b.enum) ? b.enum : [b.const];
    if (!values) return { ok: false, why: `${at || '/'}: target is an enum, source is open` };
    const miss = values.find(v => !allowed.some(x => JSON.stringify(x) === JSON.stringify(v)));
    if (miss !== undefined) return { ok: false, why: `${at || '/'}: value ${JSON.stringify(miss)} is outside the target enum` };
  }
  if (values && tb) { const bad = values.find(v => !tb.some(t => widen(jsonType(v)).includes(t))); if (bad !== undefined) return { ok: false, why: `${at || '/'}: enum value ${JSON.stringify(bad)} has the wrong type` }; }
  for (const [lo, hi] of [['minimum', 'maximum'], ['minItems', 'maxItems'], ['minLength', 'maxLength']]) {
    if (b[lo] != null && !(a[lo] != null && a[lo] >= b[lo])) return { ok: false, why: `${at || '/'}: ${lo} ${b[lo]} not guaranteed` };
    if (b[hi] != null && !(a[hi] != null && a[hi] <= b[hi])) return { ok: false, why: `${at || '/'}: ${hi} ${b[hi]} not guaranteed` };
  }
  const isObj = (ta ?? []).includes('object') || (tb ?? []).includes('object') || a.properties || b.properties;
  if (isObj) {
    const reqA = new Set(a.required ?? []);
    for (const r of b.required ?? []) if (!reqA.has(r)) return { ok: false, why: `${at}/${r}: required by the target, not guaranteed by the source` };
    const pa = a.properties ?? {}, pb = b.properties ?? {};
    for (const [k, sb] of Object.entries(pb)) {
      if (!(k in pa)) { if (a.additionalProperties === false) continue; return { ok: false, why: `${at}/${k}: the target constrains a property the source leaves open` }; }
      const r = subsumes(pa[k], sb, `${at}/${k}`); if (!r.ok) return r;
    }
    if (b.additionalProperties === false) {
      if (a.additionalProperties !== false) return { ok: false, why: `${at || '/'}: the target forbids extra properties, the source allows them` };
      const extra = Object.keys(pa).find(k => !(k in pb)); if (extra) return { ok: false, why: `${at}/${extra}: not allowed by the target` };
    } else if (b.additionalProperties && typeof b.additionalProperties === 'object') {
      for (const k of Object.keys(pa)) if (!(k in pb)) { const r = subsumes(pa[k], b.additionalProperties, `${at}/${k}`); if (!r.ok) return r; }
      if (a.additionalProperties !== false) { const r = subsumes(a.additionalProperties ?? true, b.additionalProperties, `${at}/*`); if (!r.ok) return r; }
    }
  }
  if (b.items) { if (!a.items) return { ok: false, why: `${at}/[]: the target constrains items, the source does not` }; const r = subsumes(a.items, b.items, `${at}/[]`); if (!r.ok) return r; }
  return { ok: true };
}
const jsonType = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);

// The top-level shape of a schema for an index line: "{systems[],invoices[],payments}" (keys, arrays marked []).
export function shapeLabel(schema, max = 4) {
  if (!schema || typeof schema !== 'object') return '?';
  if (schema.type === 'array') return `${shapeLabel(schema.items, max)}[]`;
  const keys = Object.keys(schema.properties ?? {});
  if (!keys.length) return schema.type ?? '?';
  const parts = keys.slice(0, max).map(k => (schema.properties[k]?.type === 'array' ? `${k}[]` : k));
  return `{${parts.join(',')}${keys.length > max ? ',…' : ''}}`;
}
