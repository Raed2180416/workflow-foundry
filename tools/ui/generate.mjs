// Seeded generators for property and differential tests: random answer schemas inside the tier-0 subset, valid
// answers by construction, and mutated answers. No dependency; mulberry32 PRNG. Development evidence only.
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = list => list[int(0, list.length - 1)];
  const chance = p => next() < p;
  return { next, int, pick, chance };
}

// Each entry is exactly one code point, so a string of n picks has n code points (minLength/maxLength hold).
const ASTRAL = String.fromCodePoint(0x1F600), CJK = String.fromCodePoint(0x4E2D), ACCENT = String.fromCodePoint(0x00E9);
const CHARS = ['a', 'b', 'Z', '0', '7', ' ', '-', '_', '"', "'", '<', '>', '&', '/', '\\', '\n', '\t', ACCENT, CJK, ASTRAL];
// Patterns the compiler admits, each with a generator of matching strings and a non-matching example.
const PATTERNS = [
  { pattern: '^[A-Z]{2}-[0-9]{1,6}$', make: r => `${'AB'}-${String(r.int(0, 999999))}`, miss: 'ab-1', max: 9 },
  { pattern: '^[a-z]+$', make: r => 'abc'.slice(0, r.int(1, 3)), miss: 'A', max: 40 },
  { pattern: '^[0-9]{4}$', make: r => String(r.int(1000, 9999)), miss: '123', max: 4 },
  { pattern: '^(?:yes|no)$', make: r => r.pick(['yes', 'no']), miss: 'maybe', max: 3 },
  { pattern: 'INV', make: () => 'xINVx', miss: 'inv', max: 20 },
];

function text(r, min, max) {
  const n = r.int(min, Math.min(max, min + 12));
  let s = '';
  for (let i = 0; i < n; i++) s += r.pick(CHARS);
  return s;
}

function scalarPool(r) {
  return r.pick([
    () => ['approve', 'reject', 'undecidable', '', 'a b', `${CJK}`, '1', '<b>x</b>'],
    () => [1, 2, 3, 0, -1, 2.5, 1e6],
    () => [true, false],
    () => ['1', 1, null, true, 'null', ''],
  ])();
}

function enumSchema(r) {
  const pool = scalarPool(r);
  const n = r.int(1, Math.min(pool.length, 9));
  const members = [];
  for (const v of pool) if (members.length < n && !members.some(m => m === v) && r.chance(0.8)) members.push(v);
  if (!members.length) members.push(pool[0]);
  const schema = { enum: members };
  const types = new Set(members.map(m => (m === null ? 'null' : typeof m)));
  if (types.size === 1 && !types.has('null') && r.chance(0.5)) schema.type = types.has('number') ? (members.every(Number.isInteger) && r.chance(0.5) ? 'integer' : 'number') : [...types][0];
  return schema;
}

export function leafSchema(r) {
  const kind = r.pick(['string', 'string', 'number', 'integer', 'boolean', 'enum', 'enum', 'array', 'const']);
  const s = {};
  if (r.chance(0.2)) s.description = text(r, 0, 20);
  if (r.chance(0.2)) s.title = text(r, 1, 10);
  switch (kind) {
    case 'string': {
      s.type = 'string';
      if (r.chance(0.3)) { const p = r.pick(PATTERNS); s.pattern = p.pattern; s.maxLength = p.max + r.int(0, 5); return s; }
      if (r.chance(0.5)) s.minLength = r.int(0, 4);
      if (r.chance(0.6)) s.maxLength = (s.minLength ?? 0) + r.pick([0, 1, 5, 20, 200]);
      return s;
    }
    case 'number': case 'integer': {
      s.type = kind;
      const lo = kind === 'integer' ? r.int(-100, 100) : Math.round((r.next() * 200 - 100) * 100) / 100;
      if (r.chance(0.6)) s.minimum = lo;
      if (r.chance(0.6)) s.maximum = (s.minimum ?? lo) + (kind === 'integer' ? r.int(0, 1000) : Math.round(r.next() * 100000) / 100);
      return s;
    }
    case 'boolean': s.type = 'boolean'; return s;
    case 'enum': return Object.assign(s, enumSchema(r));
    case 'const': s.const = r.pick(['v1', 1, true, null, '']); return s;
    case 'array': {
      const items = { enum: ['a', 'b', 'c', 'd', 'e'].slice(0, r.int(1, 5)) };
      Object.assign(s, { type: 'array', items });
      if (r.chance(0.5)) s.minItems = r.int(0, items.enum.length);
      if (r.chance(0.5)) s.maxItems = (s.minItems ?? 0) + r.int(0, 3);
      return s;
    }
  }
  return s;
}

function objectSchema(r, depth) {
  const props = {}, n = r.int(1, 6);
  const names = ['decision', 'amount', 'reason', 'note', 'tags', 'flag', 'level', 'code', 'a/b', 'x~y', '', 'two words'];
  for (let i = 0; i < n; i++) {
    const name = r.chance(0.8) ? `${r.pick(names)}${r.chance(0.5) ? i : ''}` : `p${i}`;
    if (Object.hasOwn(props, name)) continue;
    Object.defineProperty(props, name, { value: depth === 0 && r.chance(0.15) ? objectSchema(r, 1) : leafSchema(r), enumerable: true, writable: true, configurable: true });
  }
  const schema = { type: 'object', properties: props };
  const keys = Object.keys(props);
  const required = keys.filter(() => r.chance(0.5));
  if (required.length) schema.required = required;
  const ap = r.pick([undefined, true, false]);
  if (ap !== undefined) schema.additionalProperties = ap;
  return schema;
}

export const genSchema = r => (r.chance(0.3) ? leafSchema(r) : objectSchema(r, 0));

/** A value valid against `schema` (by construction), or undefined for an unsatisfiable leaf. */
export function genValid(r, schema) {
  if (Object.hasOwn(schema, 'const')) return schema.const;
  if (Object.hasOwn(schema, 'enum')) return r.pick(schema.enum);
  switch (schema.type) {
    case 'string': {
      if (schema.pattern) return PATTERNS.find(p => p.pattern === schema.pattern).make(r);
      return text(r, schema.minLength ?? 0, schema.maxLength ?? 30);
    }
    case 'integer': {
      const lo = schema.minimum ?? -1000, hi = schema.maximum ?? lo + 2000;
      return r.int(Math.ceil(lo), Math.floor(hi));
    }
    case 'number': {
      const lo = schema.minimum ?? -1000, hi = schema.maximum ?? lo + 2000;
      const v = r.chance(0.3) ? r.pick([lo, hi]) : Math.round((lo + r.next() * (hi - lo)) * 100) / 100;
      return Math.min(hi, Math.max(lo, v));
    }
    case 'boolean': return r.chance(0.5);
    case 'array': {
      const options = [...schema.items.enum], lo = schema.minItems ?? 0, hi = Math.min(schema.maxItems ?? options.length, options.length);
      const n = r.int(lo, hi), out = [];
      while (out.length < n) { const v = options.splice(r.int(0, options.length - 1), 1)[0]; out.push(v); }
      return out; // a random order of distinct members
    }
    case 'object': {
      const out = {}, required = new Set(schema.required ?? []);
      for (const [name, child] of Object.entries(schema.properties)) {
        if (required.has(name) || r.chance(0.6)) Object.defineProperty(out, name, { value: genValid(r, child), enumerable: true, writable: true, configurable: true });
      }
      if (schema.additionalProperties !== false && r.chance(0.1)) out.extraKey = 'extra';
      return out;
    }
  }
  return undefined;
}

/** A mutation of a value; usually invalid (the differential test decides, not this function). */
export function mutate(r, schema, value) {
  const leafMutants = s => {
    const out = [r.pick(['12abc', 1.5, -1e9, 1e9, null, true, [], {}, '', 'x'.repeat(300)])];
    if (s.enum) out.push('not-a-member', 0);
    if (s.type === 'string') out.push(42, text(r, (s.maxLength ?? 10) + 1, (s.maxLength ?? 10) + 3));
    if (s.pattern) out.push(PATTERNS.find(p => p.pattern === s.pattern).miss);
    if (s.type === 'integer') out.push(0.5, (s.maximum ?? 0) + 1);
    if (s.type === 'number') out.push((s.minimum ?? 0) - 1, '1');
    if (s.type === 'array') out.push(['zz'], new Array((s.maxItems ?? 5) + 1).fill(s.items.enum[0]));
    return r.pick(out);
  };
  if (schema.type !== 'object' || value === null || typeof value !== 'object' || Array.isArray(value)) return leafMutants(schema);
  const out = structuredClone(value);
  const names = Object.keys(schema.properties);
  const choice = r.int(0, 3);
  if (choice === 0 && schema.required?.length) { delete out[r.pick(schema.required)]; return out; }
  if (choice === 1) { out.injected = '<script>x</script>'; return out; }
  const name = r.pick(names), child = schema.properties[name];
  Object.defineProperty(out, name, { value: child.type === 'object' ? mutate(r, child, genValid(r, child)) : leafMutants(child), enumerable: true, writable: true, configurable: true });
  return out;
}

// Strings planted in number fields (E-BED §2.7 "planted invalid entries"), with what two simple client rules say.
export const PLANTED_NUMBER_TEXT = ['12abc', '0x10', '1,000', '1 000', 'EUR 12', '12.', '.5', '+5', 'Infinity', '-Infinity', 'NaN', '1e400', '12e', '--1', '1_000', '0b101', String.fromCodePoint(0x0661, 0x0662), '12' + String.fromCodePoint(0x00A0), String.fromCodePoint(0xFF11, 0xFF12), '1.2.3'];
// OpenUI 1.0 `numeric` as specified (spec/language.md §5.4): a non-blank string whose parseFloat is not NaN.
export const openuiNumeric = v => typeof v === 'number' ? !Number.isNaN(v) : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number.parseFloat(v));
// web/app.js readAnswer (lines 608-611 at this commit): non-blank and Number(v) finite.
export const webAppNumber = v => v.trim() !== '' && Number.isFinite(Number(v));
