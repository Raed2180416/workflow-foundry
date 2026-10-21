// SOP-Bench scoring in JS (experiments/sopbench; research/sopbench-20261021/NOTES.md §4). Two verdicts per answer:
//
//  upstream  A port of upstream's verdict for an answer given as <final_output>{JSON}</final_output>: the parser's first
//            branch (parser.py:98-186, _parse_final_output_json) and the comparison (parser.py:438-584, compare_decisions
//            with fuzzy_match=True), as Evaluator.run_single_task combines them (evaluator.py:306-357). Python semantics
//            are reproduced where they matter: str() of json.loads values (True, None, 1.0, big ints), str.lower/strip
//            and the re `\s` class (Python's isspace set), last match wins, key lookup case-insensitive. When upstream
//            would fall through to its other parsers (no tag, invalid JSON, no output column in the object) or a value
//            is a JSON array/object, the port returns { covered: false } and the Python bridge's verdict (upstream's own
//            code) is the only one: the port never guesses.
//  strict    Our metric: the last <final_output> must parse and hold every output column; per column the value equals the
//            ground truth (both null-like; or both finite numbers with the same value; or the same text after lower-case,
//            '_'/'-' -> space, whitespace collapsed and trimmed). No substring containment. Identical to bridge.py
//            strict_verdict (parity-tested).
//
// Ground truth comes from expected.json (bridge prepare): per output column { str: Python str(value), isna }.

// Python str.isspace() / re `\s` code points (CPython 3.13).
const WS = '\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const WS_SET = new RegExp(`[${WS}]`);
const isWs = c => WS_SET.test(c);
export const pyStrip = s => { let a = 0, b = s.length; while (a < b && isWs(s[a])) a++; while (b > a && isWs(s[b - 1])) b--; return s.slice(a, b); };
const FINAL_RE = new RegExp(`<final_output>[${WS}]*(\\{[\\s\\S]*?\\})[${WS}]*</final_output>`, 'gi');
const WS_RUN = new RegExp(`[${WS}]+`, 'g');
export const NULLS = new Set(['none', 'null', 'na', 'n/a', 'nan', 'unknown', '']);

// ---- json.loads with Python value semantics ------------------------------------------------------------------------
class JsonError extends Error {}
/** Parse like Python's json.loads (strict=True): returns tagged values {t: 'str'|'int'|'float'|'bool'|'null'|'list'|'dict', ...}. */
export function pyJsonLoads(text) {
  let i = 0;
  const s = text;
  const ws = () => { while (i < s.length && ' \t\n\r'.includes(s[i])) i++; };
  const fail = m => { throw new JsonError(`${m} at ${i}`); };
  function str() {
    i++; // opening quote
    let out = '';
    for (;;) {
      if (i >= s.length) fail('unterminated string');
      const c = s[i];
      if (c === '"') { i++; return out; }
      if (c === '\\') {
        const e = s[i + 1];
        const map = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (e in map) { out += map[e]; i += 2; continue; }
        if (e === 'u') {
          const h = s.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(h)) fail('bad \\u escape');
          out += String.fromCharCode(parseInt(h, 16)); i += 6; continue;
        }
        fail('bad escape');
      }
      if (c.charCodeAt(0) < 0x20) fail('control character in string');
      out += c; i++;
    }
  }
  function value() {
    ws();
    const c = s[i];
    if (c === '"') return { t: 'str', v: str() };
    if (c === '{') {
      i++; const entries = []; ws();
      if (s[i] === '}') { i++; return { t: 'dict', v: entries }; }
      for (;;) {
        ws(); if (s[i] !== '"') fail('expected key');
        const k = str(); ws(); if (s[i] !== ':') fail('expected :'); i++;
        entries.push([k, value()]); ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === '}') { i++; return { t: 'dict', v: entries }; }
        fail('expected , or }');
      }
    }
    if (c === '[') {
      i++; const items = []; ws();
      if (s[i] === ']') { i++; return { t: 'list', v: items }; }
      for (;;) {
        items.push(value()); ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === ']') { i++; return { t: 'list', v: items }; }
        fail('expected , or ]');
      }
    }
    for (const [lit, val] of [['true', { t: 'bool', v: true }], ['false', { t: 'bool', v: false }], ['null', { t: 'null' }], ['NaN', { t: 'float', v: NaN }], ['Infinity', { t: 'float', v: Infinity }], ['-Infinity', { t: 'float', v: -Infinity }]]) {
      if (s.startsWith(lit, i)) { i += lit.length; return val; }
    }
    const m = /^(-?(?:0|[1-9]\d*))(\.\d+)?([eE][-+]?\d+)?/.exec(s.slice(i));
    if (m && m[0]) {
      i += m[0].length;
      if (m[2] || m[3]) return { t: 'float', v: Number(m[0]) };
      return { t: 'int', v: BigInt(m[1]).toString() };
    }
    fail('expecting value');
  }
  const v = value(); ws();
  if (i !== s.length) fail('extra data');
  return v;
}

/** Python repr() of a float. */
export function pyFloatRepr(x) {
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const sign = x < 0 ? '-' : '';
  const [mant, expStr] = Math.abs(x).toExponential().split('e');
  const digits = mant.replace('.', '');
  const decpt = Number(expStr) + 1;
  let body;
  if (decpt <= -4 || decpt > 16) {
    const e = decpt - 1;
    body = `${digits[0]}${digits.length > 1 ? '.' + digits.slice(1) : ''}e${e >= 0 ? '+' : '-'}${String(Math.abs(e)).padStart(2, '0')}`;
  } else if (decpt <= 0) body = `0.${'0'.repeat(-decpt)}${digits}`;
  else if (decpt >= digits.length) body = `${digits}${'0'.repeat(decpt - digits.length)}.0`;
  else body = `${digits.slice(0, decpt)}.${digits.slice(decpt)}`;
  return sign + body;
}

/** Python str() of a scalar json.loads value; null for a list or dict (not ported). */
export function pyStr(v) {
  switch (v.t) {
    case 'str': return v.v;
    case 'int': return v.v;
    case 'float': return pyFloatRepr(v.v);
    case 'bool': return v.v ? 'True' : 'False';
    case 'null': return 'None';
    default: return null;
  }
}

/** The last <final_output>{...}</final_output> JSON object (upstream's regex), or null. */
export function lastFinalOutput(text) {
  const all = [...String(text ?? '').matchAll(FINAL_RE)];
  if (!all.length) return { found: false };
  const raw = pyStrip(all.at(-1)[1]);
  try {
    const v = pyJsonLoads(raw);
    if (v.t !== 'dict') return { found: true, ok: false };
    return { found: true, ok: true, entries: v.v };
  } catch (e) { if (e instanceof JsonError) return { found: true, ok: false }; throw e; }
}

/** {lowered key -> value} as Python builds it: json.loads makes a dict (a repeated key keeps its first position and
 * its last value), then {k.lower(): v for k, v in d.items()} (a later item overrides). */
const lowerMap = entries => {
  const raw = new Map();
  for (const [k, v] of entries) raw.set(k, v);
  const m = new Map();
  for (const [k, v] of raw) m.set(k.toLowerCase(), v);
  return m;
};

/** parser.py:464-519 (_compare_single_value, fuzzy_match=True); predicted is a Python str or null (None). */
export function compareSingle(predicted, exp) {
  const p = predicted === null ? '' : pyStrip(predicted.toLowerCase());
  const e = pyStrip(exp.str.toLowerCase());
  const pNull = NULLS.has(p), eNull = exp.isna || NULLS.has(e);
  if (pNull && eNull) return true;
  if (pNull || eNull) return false;
  if (p === e) return true;
  const pc = p.replaceAll('_', ' ').replaceAll('-', ' '), ec = e.replaceAll('_', ' ').replaceAll('-', ' ');
  if (pc === ec) return true;
  return pc.includes(ec) || ec.includes(pc);
}

/** Upstream's verdict for one answer text (see header). expected: {col: {str, isna}}; outputColumns: metadata order. */
export function upstreamVerdict(text, expected, outputColumns) {
  const fo = lastFinalOutput(text);
  if (!fo.found || !fo.ok) return { covered: false, reason: fo.found ? 'final_output is not valid JSON (upstream falls back)' : 'no final_output (upstream falls back)' };
  const low = lowerMap(fo.entries);
  const decisions = new Map();
  for (const col of outputColumns) {
    const v = low.get(col.toLowerCase());
    if (v === undefined) continue;
    const s = pyStr(v);
    if (s === null) return { covered: false, reason: 'a list or object value (not ported)' };
    decisions.set(col, s.toLowerCase());
  }
  if (!decisions.size) return { covered: false, reason: 'no output column in final_output (upstream falls back)' };
  if (outputColumns.length === 1) {
    // Single field: the decision value against the scalar ground truth.
    return { covered: true, pass: compareSingle([...decisions.values()][0], expected[outputColumns[0]]) };
  }
  // Multi field: run_single_task takes parsed["decisions"], which exists only when 2+ columns were found.
  if (decisions.size < 2) return { covered: true, pass: false };
  const pass = outputColumns.every(col => {
    const k = [...decisions.keys()].find(x => x.toLowerCase() === col.toLowerCase());
    return k !== undefined && compareSingle(decisions.get(k), expected[col]);
  });
  return { covered: true, pass };
}

/** Python float() of a stripped string, finite only (decimal digits with optional single underscores). */
export function pyFiniteFloat(s) {
  if (!/^[+-]?(?:(?:\d(?:_?\d)*)?\.\d(?:_?\d)*|\d(?:_?\d)*\.?)(?:[eE][+-]?\d(?:_?\d)*)?$/.test(s)) return null;
  const x = Number(s.replaceAll('_', ''));
  return Number.isFinite(x) ? x : null;
}
const normText = s => pyStrip(s.replaceAll('_', ' ').replaceAll('-', ' ').replace(WS_RUN, ' '));

/** One strict field comparison (bridge.py strict_field). */
export function strictField(pStr, exp) {
  const pRaw = pyStrip(pStr), eRaw = pyStrip(exp.str);
  const pLow = pRaw.toLowerCase(), eLow = eRaw.toLowerCase();
  const pNull = NULLS.has(pLow), eNull = exp.isna || NULLS.has(eLow);
  if (pNull || eNull) return pNull && eNull;
  const pn = pyFiniteFloat(pRaw), en = pyFiniteFloat(eRaw);
  if (pn !== null && en !== null) return pn === en;
  return normText(pLow) === normText(eLow);
}

export function strictVerdict(text, expected, outputColumns) {
  const fo = lastFinalOutput(text);
  if (!fo.found) return { pass: false, reason: 'no <final_output> JSON' };
  if (!fo.ok) return { pass: false, reason: 'final_output is not valid JSON' };
  const low = lowerMap(fo.entries);
  const fields = {};
  for (const col of outputColumns) {
    const v = low.get(col.toLowerCase());
    const s = v === undefined ? null : pyStr(v);
    fields[col] = s === null ? false : strictField(s, expected[col]);
  }
  return { pass: Object.values(fields).every(Boolean), fields };
}

/** The final answer text for a structured answer {col: value}: what a workflow arm emits and the scripted policies use. */
export const finalOutputText = obj => `<final_output>${JSON.stringify(obj)}</final_output>`;
