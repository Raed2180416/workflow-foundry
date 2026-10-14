// need-qa shared helpers: generated names, exact rational arithmetic, answer normalisation and comparison,
// and a validator for the portable JSON-Schema subset. Pure; no Math.random, no wall clock.

export const SUBTYPES = Object.freeze(['ledger', 'lookup', 'calendar', 'convert']);
// Rows of the main table per size level 1..5 (tuned so difficulty 5 stays under 2K tokens for every subtype).
export const ROWS = Object.freeze([6, 9, 12, 16, 22]);

const ONSETS = ['Br', 'Cal', 'Dor', 'Fen', 'Gal', 'Hav', 'Jor', 'Kel', 'Lum', 'Mar', 'Nev', 'Or', 'Pel', 'Quin', 'Rav', 'Sol', 'Tam', 'Vel', 'Wyn', 'Zor', 'Ash', 'Bel', 'Cor', 'Dun', 'Eld', 'Fal', 'Gry', 'Hol', 'Ith', 'Kor'];
const MIDS = ['a', 'e', 'i', 'o', 'u', 'ar', 'el', 'in', 'or', 'un', 'al', 'em'];
const CODAS = ['dan', 'mere', 'wick', 'vane', 'thorn', 'lis', 'ford', 'mont', 'ra', 'ton', 'vale', 'mar', 'rest', 'haven', 'dell'];
const ADJECTIVES = ['cobalt', 'amber', 'quartz', 'teal', 'ivory', 'slate', 'umber', 'saffron', 'indigo', 'russet'];
const NOUNS = ['spool', 'gasket', 'lantern', 'valve', 'coil', 'bracket', 'flask', 'hinge', 'rotor', 'wedge'];
const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';

/** `count` distinct capitalised invented names (one word). `used` (a Set of lowercase names) is shared across calls. */
export function uniqueNames(r, count, used = new Set()) {
  const out = [];
  for (let guard = 0; out.length < count; guard++) {
    if (guard > 20000) throw new Error('need-qa: name pool exhausted');
    const name = r.pick(ONSETS) + r.pick(MIDS) + r.pick(CODAS);
    const key = name.toLowerCase();
    if (used.has(key)) continue;
    used.add(key);
    out.push(name);
  }
  return out;
}

/** `count` distinct invented weekday names such as "Brinday". */
export function weekdayNames(r, count, used = new Set()) {
  const out = [];
  for (let guard = 0; out.length < count; guard++) {
    if (guard > 20000) throw new Error('need-qa: weekday pool exhausted');
    const name = `${r.pick(ONSETS)}${r.pick(['a', 'e', 'i', 'o', 'u'])}${r.pick(['n', 'r', 'l', 's', 'm'])}day`;
    const key = name.toLowerCase();
    if (used.has(key)) continue;
    used.add(key);
    out.push(name);
  }
  return out;
}

/** `count` distinct two-word item names such as "cobalt spool". */
export function itemNames(r, count) {
  const seen = new Set(), out = [];
  for (let guard = 0; out.length < count; guard++) {
    if (guard > 20000) throw new Error('need-qa: item pool exhausted');
    const name = `${r.pick(ADJECTIVES)} ${r.pick(NOUNS)}`;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** `count` distinct codes such as "KV-42". */
export function uniqueCodes(r, count) {
  const seen = new Set(), out = [];
  for (let guard = 0; out.length < count; guard++) {
    if (guard > 20000) throw new Error('need-qa: code pool exhausted');
    const code = `${r.pick([...CODE_LETTERS])}${r.pick([...CODE_LETTERS])}-${r.int(10, 99)}`;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

/** `count` distinct integers in [lo, hi], ascending. */
export function uniqueInts(r, count, lo, hi) {
  const seen = new Set();
  for (let guard = 0; seen.size < count; guard++) {
    if (guard > 100000) throw new Error('need-qa: integer pool exhausted');
    seen.add(r.int(lo, hi));
  }
  return [...seen].sort((a, b) => a - b);
}

export const ordinal = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')}`;
export const sum = xs => xs.reduce((a, b) => a + b, 0);

// ---- exact rational arithmetic over BigInt (no floating point anywhere in a truth) ----
const abs = x => (x < 0n ? -x : x);
export function gcd(a, b) { a = abs(a); b = abs(b); while (b) [a, b] = [b, a % b]; return a; }
export function frac(n, d = 1n) {
  if (d === 0n) throw new Error('need-qa: zero denominator');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}
export const fmul = (a, b) => frac(a.n * b.n, a.d * b.d);
export const fadd = (a, b) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
export const finv = a => frac(a.d, a.n);
export const FZERO = frac(0n);
export const FONE = frac(1n);
/** Plain non-negative decimal text ("2.5") to a fraction. */
export function fracOfDecimal(text) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new Error(`need-qa: not a plain decimal: ${text}`);
  const f = m[2] ?? '';
  return frac(BigInt(m[1] + f), 10n ** BigInt(f.length));
}
/** round-half-up(f * 10^dp) for f >= 0, as a BigInt. */
export function roundHalfUpScaled(f, dp) { return (2n * f.n * 10n ** BigInt(dp) + f.d) / (2n * f.d); }
export function floorScaled(f, dp) { return (f.n * 10n ** BigInt(dp)) / f.d; }
/** True when f * 10^dp is within 0.02 of a rounding tie (such truths are rejected: float solvers could land on either side). */
export function nearTie(f, dp) {
  const rem = (f.n * 10n ** BigInt(dp)) % f.d;
  return abs(2n * rem - f.d) * 50n < f.d;
}
export function scaledToText(s, dp) {
  const str = s.toString().padStart(dp + 1, '0');
  return dp === 0 ? str : `${str.slice(0, -dp)}.${str.slice(-dp)}`;
}

// ---- answer normalisation and comparison (README "Answer comparison") ----
const PLAIN_NUMBER = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
const THOUSANDS = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/;

/** Exact value of a submitted number or numeric string: { neg, digits, scale } meaning digits / 10^scale, or null. */
export function parseNumeric(input) {
  let s;
  if (typeof input === 'number') { if (!Number.isFinite(input)) return null; s = String(input); }
  else if (typeof input === 'string') { s = input.trim(); if (THOUSANDS.test(s)) s = s.replace(/,/g, ''); }
  else return null;
  const m = PLAIN_NUMBER.exec(s);
  if (!m) return null;
  const fracDigits = m[3] ?? '';
  let digits = BigInt(m[2] + fracDigits), scale = fracDigits.length;
  if (m[4] !== undefined) { const e = Number(m[4]); if (Math.abs(e) > 400) return null; scale -= e; }
  if (scale < 0) { digits *= 10n ** BigInt(-scale); scale = 0; }
  return { neg: m[1] === '-' && digits !== 0n, digits, scale };
}

function roundedScaled(p, dp) {
  if (p.scale <= dp) return p.digits * 10n ** BigInt(dp - p.scale);
  const div = 10n ** BigInt(p.scale - dp);
  return (2n * p.digits + div) / (2n * div);
}

/** Lowercase, trim, collapse whitespace, drop wrapping quotes and a final full stop. */
export function normText(value) {
  return String(value).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '').replace(/\.$/, '').trim();
}

/** "Aldemere 5, year 301" (also "Aldemere 5 301", "aldemere 5, 301") -> { month, day, year } or null. */
export function parseDateAnswer(text) {
  const s = String(text).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  const m = /^([a-z][a-z'-]*)\s+(\d{1,3})\s*,?\s*(?:year\s+|yr\.?\s*)?(\d{1,5})\.?$/.exec(s);
  return m ? { month: m[1], day: Number(m[2]), year: Number(m[3]) } : null;
}

/**
 * Compare a submitted answer with a truth { kind, value, dp? } (kind: 'int' | 'round' | 'text' | 'date').
 *  int   exact: the submitted number must have no fractional part and equal the truth ("1,234", "1234.0" and 1234 all match).
 *  round the submitted number is rounded half-up to `dp` decimals and must then equal the truth; so any value in
 *        [truth - 0.5*10^-dp, truth + 0.5*10^-dp) matches and nothing a full last-place unit away does.
 *  text  trim + lowercase + whitespace collapse + wrapping quotes and a final full stop removed, then exact.
 *  date  "<month> <day>, year <year>" with the comma and the word "year" optional; month name case-insensitive.
 * Returns { ok, reason, normalized } (reason: 'match' | 'empty' | 'not-a-number' | 'negative' | 'fractional' | 'rounds-differently' | 'mismatch' | 'not-a-date').
 */
export function compareAnswer(given, truth) {
  if (typeof given === 'string' && given.trim() === '') return { ok: false, reason: 'empty', normalized: '' };
  if (truth.kind === 'int' || truth.kind === 'round') {
    const p = parseNumeric(given);
    if (!p) return { ok: false, reason: 'not-a-number', normalized: normText(given) };
    if (p.neg) return { ok: false, reason: 'negative', normalized: normText(given) };
    const normalized = `${p.digits}e-${p.scale}`;
    if (truth.kind === 'int') {
      const unit = 10n ** BigInt(p.scale);
      if (p.digits % unit !== 0n) return { ok: false, reason: 'fractional', normalized };
      return p.digits / unit === BigInt(truth.value) ? { ok: true, reason: 'match', normalized } : { ok: false, reason: 'mismatch', normalized };
    }
    const t = parseNumeric(truth.value);
    const tScaled = t.digits * 10n ** BigInt(truth.dp - t.scale);
    return roundedScaled(p, truth.dp) === tScaled ? { ok: true, reason: 'match', normalized } : { ok: false, reason: 'rounds-differently', normalized };
  }
  if (truth.kind === 'date') {
    if (typeof given !== 'string') return { ok: false, reason: 'not-a-date', normalized: normText(given) };
    const g = parseDateAnswer(given), t = parseDateAnswer(truth.value);
    if (!g) return { ok: false, reason: 'not-a-date', normalized: normText(given) };
    const normalized = `${g.month} ${g.day} ${g.year}`;
    return g.month === t.month && g.day === t.day && g.year === t.year ? { ok: true, reason: 'match', normalized } : { ok: false, reason: 'mismatch', normalized };
  }
  const normalized = normText(given);
  return normalized === normText(truth.value) ? { ok: true, reason: 'match', normalized } : { ok: false, reason: 'mismatch', normalized };
}

/** A truth as the answer value a perfect solver would submit. */
export const answerOf = truth => (truth.kind === 'int' || truth.kind === 'round' ? Number(truth.value) : truth.value);

/** Numeric tokens (e.g. "120", "12.35") that appear in a text, normalised so "12.30" and "12.3" compare equal. */
export function numberTokens(text) {
  const out = new Set();
  for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) out.add(String(Number(m[0])));
  return out;
}

// ---- prompt assembly ----
export const FORM = Object.freeze({
  number: 'Reply with only a JSON object {"answer": <number>} holding the number alone, with no units.',
  text: 'Reply with only a JSON object {"answer": "<text>"}, spelled exactly as in the data.',
  date: 'Reply with only a JSON object {"answer": "<month> <day>, year <year>"} naming the month as in the calendar.',
});
export const composePrompt = (intro, question, form) => `${intro}\nQuestion: ${question}\n${form}`;
export const roundingPhrase = dp => `Round half up to ${dp === 0 ? 'a whole number' : dp === 1 ? '1 decimal place' : `${dp} decimal places`}.`;

// ---- portable JSON-Schema subset validator (type, enum, required, properties, additionalProperties:false, maxLength, min/max, items) ----
const typeOf = v => v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v === 'number' && !Number.isFinite(v) ? 'non-finite number' : typeof v;
export function schemaErrors(schema, value, path = '$', out = []) {
  if (out.length > 20) return out;
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const t = typeOf(value);
    if (!types.some(x => x === t || (x === 'number' && t === 'integer'))) { out.push(`${path}: expected ${types.join('|')}, got ${t}`); return out; }
  }
  if (schema.enum && !schema.enum.includes(value)) out.push(`${path}: not one of the allowed values`);
  if (typeof value === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) out.push(`${path}: longer than ${schema.maxLength}`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) out.push(`${path}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) out.push(`${path}: above ${schema.maximum}`);
  }
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => schemaErrors(schema.items, v, `${path}[${i}]`, out));
  if (typeOf(value) === 'object') {
    for (const k of schema.required ?? []) if (!Object.hasOwn(value, k)) out.push(`${path}: missing ${k}`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) schemaErrors(schema.properties[k], v, `${path}.${k}`, out);
      else if (schema.additionalProperties === false) out.push(`${path}: unexpected property ${k}`);
    }
  }
  return out;
}
