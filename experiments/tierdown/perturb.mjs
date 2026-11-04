// One-at-a-time perturbations of a judge's decision (A10 / #42; Morris-style elementary effects on decision leaves).
// A perturbation changes ONE decision leaf of the value a judge returned (or adds/drops one list item) and nothing
// else; evidence fields (quotes, reasons, notes: tierdown.mjs EVIDENCE_KEY) are never perturbed, because a cheaper tier
// that quotes differently but decides the same is not an error.
//
// Kinds (each tagged so the screen can report leverage per kind):
//   enum      a schema enum leaf set to another allowed value (both neighbours in the enum list, at most two)
//   bool      a boolean flipped
//   int       an integer +1 (and -1 when > 0)
//   num       a non-integer number x1.25 (a material misreading, not a rounding difference)
//   date      a date string with day and month swapped (DMY <-> MDY misreading), only when both readings are valid
//   swap      a free string set to the same field of a sibling item of the enclosing list (a misattribution)
//   drop      one list item removed (the first, and the last when the list has 3+ items)
//   dup       the first list item repeated (a spurious extra item)
// Free strings with no sibling and nulls are not perturbed (counted as unperturbable leaves).
import { createHash } from 'node:crypto';
import { EVIDENCE_KEY } from '../jit/tierdown.mjs';

const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const typeOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

// The sub-schema at a child key (object property or array item), tolerant of missing schemas.
function childSchema(schema, key) {
  if (!schema || typeof schema !== 'object') return null;
  if (typeof key === 'number') return schema.items && !Array.isArray(schema.items) ? schema.items : null;
  return schema.properties?.[key] ?? (typeof schema.additionalProperties === 'object' ? schema.additionalProperties : null);
}
const enumOf = schema => (Array.isArray(schema?.enum) ? schema.enum : Array.isArray(schema?.anyOf) ? schema.anyOf.flatMap(s => s.enum ?? []) : null);

// Every decision leaf and list of `value` (depth-first), with its path and schema.
export function decisionPoints(value, schema = null, at = [], out = []) {
  const t = typeOf(value);
  if (t === 'array') {
    out.push({ path: at, kind: 'list', value, schema });
    value.forEach((x, i) => decisionPoints(x, childSchema(schema, i), [...at, i], out));
  } else if (t === 'object') {
    for (const [k, x] of Object.entries(value)) if (!EVIDENCE_KEY.test(k)) decisionPoints(x, childSchema(schema, k), [...at, k], out);
  } else out.push({ path: at, kind: 'leaf', value, schema });
  return out;
}

const setAt = (root, p, v) => {
  if (!p.length) return v;
  const r = clone(root);
  let o = r;
  for (const k of p.slice(0, -1)) o = o[k];
  o[p.at(-1)] = v;
  return r;
};
const getAt = (root, p) => p.reduce((o, k) => (o == null ? undefined : o[k]), root);

const DATE_RES = [
  { re: /^(\d{4})-(\d{2})-(\d{2})$/, y: 1, a: 2, b: 3, fmt: (y, a, b) => `${y}-${a}-${b}` },
  { re: /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/, y: 3, a: 1, b: 2, fmt: (y, a, b) => `${a}/${b}/${y}` },
  { re: /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/, y: 3, a: 1, b: 2, fmt: (y, a, b) => `${a}.${b}.${y}` },
];
// A date string with its two small fields swapped, when the swapped reading is a valid, different date.
export function swapDayMonth(s) {
  for (const d of DATE_RES) {
    const m = d.re.exec(s);
    if (!m) continue;
    const a = m[d.a], b = m[d.b];
    if (a === b || Number(a) > 12 || Number(b) > 12 || Number(a) < 1 || Number(b) < 1) return null;
    return d.fmt(m[d.y], b.padStart(a.length, '0'), a.padStart(b.length, '0'));
  }
  return null;
}

// Every perturbation of `value` (no sampling): [{kind, path, from, to, value}].
export function perturbations(value, schema = null) {
  const out = [], push = (kind, p, from, to) => out.push({ kind, path: p, from, to, value: setAt(value, p, to) });
  for (const pt of decisionPoints(value, schema)) {
    const { path: p, value: v } = pt;
    if (pt.kind === 'list') {
      if (v.length >= 1) out.push({ kind: 'drop', path: [...p, 0], from: v[0], to: undefined, value: setAt(value, p, v.slice(1)) });
      if (v.length >= 3) out.push({ kind: 'drop', path: [...p, v.length - 1], from: v.at(-1), to: undefined, value: setAt(value, p, v.slice(0, -1)) });
      if (v.length >= 1) out.push({ kind: 'dup', path: [...p, 0], from: undefined, to: v[0], value: setAt(value, p, [...v, clone(v[0])]) });
      continue;
    }
    const en = enumOf(pt.schema);
    if (en && en.length >= 2 && en.includes(v)) {
      const i = en.indexOf(v), alts = [...new Set([en[(i + 1) % en.length], en[(i - 1 + en.length) % en.length]])].filter(x => x !== v);
      for (const a of alts) push('enum', p, v, a);
      continue;
    }
    if (typeof v === 'boolean') { push('bool', p, v, !v); continue; }
    if (typeof v === 'number' && Number.isInteger(v)) { push('int', p, v, v + 1); if (v > 0) push('int', p, v, v - 1); continue; }
    if (typeof v === 'number' && Number.isFinite(v)) { push('num', p, v, v * 1.25); continue; }
    if (typeof v === 'string') {
      const d = swapDayMonth(v.trim());
      if (d) { push('date', p, v, d); continue; }
      // A sibling's value for the same field: the enclosing list item's index is the last number in the path.
      const li = p.findLastIndex(k => typeof k === 'number');
      if (li >= 0) {
        const list = getAt(value, p.slice(0, li)), rest = p.slice(li + 1);
        const sib = list.map((_, j) => getAt(list[j], rest)).find((x, j) => j !== p[li] && typeof x === 'string' && x !== v);
        if (sib !== undefined) { push('swap', p, v, sib); continue; }
      }
    }
  }
  return out;
}

// A deterministic sample of at most n perturbations, spread over kinds first (round robin over kinds, each kind in a
// seeded order), so a judge with many leaves of one kind still gets its other kinds tried.
export function samplePerturbations(list, n, seed = '') {
  const rank = x => createHash('sha256').update(`${seed}\0${x.kind}\0${JSON.stringify(x.path)}\0${JSON.stringify(x.to ?? null)}`).digest('hex');
  const byKind = new Map();
  for (const x of [...list].sort((a, b) => rank(a).localeCompare(rank(b)))) { if (!byKind.has(x.kind)) byKind.set(x.kind, []); byKind.get(x.kind).push(x); }
  // Kinds in a seeded order too: a fixed (alphabetical) order would always try 'bool' and 'date' before 'enum'.
  const kindRank = k => createHash('sha256').update(`${seed}\0kind\0${k}`).digest('hex');
  const kinds = [...byKind.keys()].sort((a, b) => kindRank(a).localeCompare(kindRank(b))), out = [];
  for (let round = 0; out.length < n && kinds.some(k => byKind.get(k).length > round); round++)
    for (const k of kinds) if (out.length < n && byKind.get(k).length > round) out.push(byKind.get(k)[round]);
  return out;
}
