// Decision-table evaluator with DMN hit-policy semantics (gap G17; BAR-SET §3 "P58, decision table"; E-BED §2.4 shared
// oracle-side library). Written from the text of OMG DMN 1.3 (https://www.omg.org/spec/DMN/1.3/PDF, retrieved
// 2026-10-14, sha256 b591d2417e8320d71cb988c6741fe590a1a85629bf317bc0857ea803bf4bf6a6): §8.2.10 "Hit policy" (printed
// pp. 72-74), §8.2.11 "Default output values", §9 S-FEEL grammar rules 5-12 (p. 83) and semantics (p. 86), §10.3.2.10
// "Decision Table" semantics (pp. 114-115). Independent of the library cards (experiments/library/cards/P58-P60): no
// code shared, cards not read.
//
// Supported exactly (anything else is refused with a code, never approximated):
//   hit policies  UNIQUE (U, the default), ANY (A), PRIORITY (P), FIRST (F), RULE ORDER (R), OUTPUT ORDER (O),
//                 COLLECT (C) with optional aggregation SUM (C+), COUNT (C#), MIN (C<), MAX (C>).
//   input entries S-FEEL simple unary tests (§9 rule 12) with literal endpoints: '-'; 'not(...)'; comma lists of
//                 '< x', '<= x', '> x', '>= x', intervals '[a..b]', '(a..b)', ']a..b[' and mixed ends, and bare
//                 literals (equality). Literals: numbers (-?digits[.digits]), "strings" (escapes \" and \\ only),
//                 true, false, null, date("YYYY-MM-DD"). Qualified names, arithmetic and full FEEL are refused.
//   types         every input declares type number | integer | string | boolean | date; literals must match it
//                 (strings and booleans compare for equality only, S-FEEL p. 86); input values are checked at
//                 runtime (DT_TYPE), null only for inputs declared nullable.
//   outputs       literal output entries (JSON values); output values = an ordered list of literals (decreasing
//                 priority, §8.2.5 "Output values"); default output value per §8.2.11 / §10.3.2.10 step 2.
//
// Readings where the spec text is silent or inconsistent (stated once here; tests pin each):
//   R1 '-' and null. §10.3.2.10 (grammar rule 15.c, p. 115) says '-' is satisfied iff e != null, or, when input values
//      v are given, iff FEEL(e in (v)) (so a nullable input whose input values list null matches '-' with null); the
//      notation passages say '-' is satisfied by every value (§8.1 p. 66, §8.2.7 p. 71, §9 p. 86). Default: the
//      execution-semantics text §10.3.2.10, the only one that addresses null; option dashMatchesNull for the others.
//      Null inputs are refused unless the input is declared nullable. A non-null input outside its input values is
//      refused (DT_DOMAIN) although 15.c would only make '-' unsatisfied for it: stricter on purpose (it means a
//      generator or world bug in a bed).
//   R2 no hit. §10.3.2.10 step 2 applies to every hit policy: no matching rule gives the default output value, else
//      null; so a multi-hit table (R, O, C, C+, C#, C<, C>) with no hit returns null, not [] or 0.
//   R3 COUNT counts outputs, not distinct outputs (§8.2.10 (d) "the number of outputs").
//   R4 COLLECT returns "all hits in arbitrary order"; this evaluator returns rule order (one admissible order).
//      Graders must compare COLLECT lists as multisets.
//   R5 PRIORITY / OUTPUT ORDER compare the outputs that have output values, left to right (§8.2.10, compound
//      outputs); rules equal on every prioritised output keep rule order (stable). PRIORITY with a tie at the top
//      between different outputs is refused at evaluation (HIT_POLICY; the result is undefined, as in R8; review fix:
//      it returned the first in rule order, so permuting rules changed the result) and is a checkTable error. Under
//      OUTPUT ORDER a tie only orders tied rules by rule order (graders compare a tied run as a multiset, as R4) and is
//      a checkTable warning.
//   R6 OUTPUT ORDER with compound outputs is allowed (§8.2.10 lists it and Figure 8-19 shows one); §10.3.2.10 3.a says
//      "SHALL be single output". The §8.2.10 reading is used; the conflict is recorded in README.md.
//   R7 SUM is exact integer arithmetic: outputs must be safe integers (money in minor units). FEEL decimals are not
//      implemented, so non-integer sums are refused (DT_TYPE). MIN / MAX take numbers, or dates for date outputs.
//   R8 UNIQUE with two or more hits, and ANY with unequal outputs, are refused at evaluation (HIT_POLICY): the spec
//      calls the result undefined.
//
// Codes: HIT_POLICY, DT_SYNTAX, DT_TYPE, DT_DOMAIN, DT_OUTPUT_VALUE, DT_INVALID; checker codes TABLE_GAP,
// TABLE_OVERLAP, TABLE_SHADOWED, TABLE_TOO_LARGE (BAR-SET §5 G17 names TABLE_GAP, TABLE_OVERLAP, HIT_POLICY and
// EDITION_UNRESOLVED; the last lives in editions.mjs).
import { fail, freezeDeep } from './errors.mjs';
import { parseDate, dateOf } from './time.mjs';
import { canonical } from '../../lib/canonical.mjs';

const POLICY = Object.freeze({
  U: ['UNIQUE'], UNIQUE: ['UNIQUE'], A: ['ANY'], ANY: ['ANY'], P: ['PRIORITY'], PRIORITY: ['PRIORITY'],
  F: ['FIRST'], FIRST: ['FIRST'], R: ['RULE ORDER'], 'RULE ORDER': ['RULE ORDER'], O: ['OUTPUT ORDER'], 'OUTPUT ORDER': ['OUTPUT ORDER'],
  C: ['COLLECT'], COLLECT: ['COLLECT'], 'C+': ['COLLECT', 'SUM'], 'C#': ['COLLECT', 'COUNT'], 'C<': ['COLLECT', 'MIN'], 'C>': ['COLLECT', 'MAX'],
});
const AGGREGATIONS = new Set(['SUM', 'COUNT', 'MIN', 'MAX']);
const TYPES = new Set(['number', 'integer', 'string', 'boolean', 'date']);
const ORDERED = new Set(['number', 'integer', 'date']);
const MULTI = new Set(['RULE ORDER', 'OUTPUT ORDER', 'COLLECT']);

// ---------------------------------------------------------------------------------------------------------------------
// S-FEEL unary tests: tokenizer and parser

function tokenize(src) {
  if (typeof src !== 'string') fail('DT_SYNTAX', `unary tests must be text: ${JSON.stringify(src)}`);
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '"') {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\') {
          if (src[j + 1] === '"' || src[j + 1] === '\\') { s += src[j + 1]; j += 2; continue; }
          fail('DT_SYNTAX', `unsupported escape in ${JSON.stringify(src)}`);
        }
        s += src[j++];
      }
      if (j >= src.length) fail('DT_SYNTAX', `unterminated string in ${JSON.stringify(src)}`);
      toks.push({ t: 'lit', v: { t: 'string', v: s } });
      i = j + 1;
      continue;
    }
    if (src.startsWith('..', i)) { toks.push({ t: '..' }); i += 2; continue; }
    if (src.startsWith('<=', i) || src.startsWith('>=', i)) { toks.push({ t: src.slice(i, i + 2) }); i += 2; continue; }
    const num = /^-?\d+(?:\.\d+)?/.exec(src.slice(i));
    if (num && !(c === '-' && !/\d/.test(src[i + 1] ?? ''))) {
      toks.push({ t: 'lit', v: { t: 'number', v: Number(num[0]) } });
      i += num[0].length;
      continue;
    }
    if ('-<>()[],'.includes(c)) { toks.push({ t: c }); i++; continue; }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (word) {
      const w = word[0];
      if (w === 'true' || w === 'false') toks.push({ t: 'lit', v: { t: 'boolean', v: w === 'true' } });
      else if (w === 'null') toks.push({ t: 'lit', v: { t: 'null', v: null } });
      else if (w === 'not' || w === 'date') toks.push({ t: w });
      else fail('DT_SYNTAX', `names and expressions are not supported (only literal endpoints): ${w} in ${JSON.stringify(src)}`);
      i += w.length;
      continue;
    }
    fail('DT_SYNTAX', `unexpected ${JSON.stringify(c)} in ${JSON.stringify(src)}`);
  }
  return toks;
}

function parser(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p], take = () => toks[p++];
  const expect = t => { const x = take(); if (!x || x.t !== t) fail('DT_SYNTAX', `expected ${t} in ${JSON.stringify(src)}`); return x; };
  const endpoint = () => {
    const x = take();
    if (!x) fail('DT_SYNTAX', `missing endpoint in ${JSON.stringify(src)}`);
    if (x.t === 'lit') return x.v;
    if (x.t === 'date') {
      expect('(');
      const s = take();
      if (!s || s.t !== 'lit' || s.v.t !== 'string') fail('DT_SYNTAX', `date() takes a string in ${JSON.stringify(src)}`);
      expect(')');
      return { t: 'date', v: parseDate(s.v.v) };
    }
    return fail('DT_SYNTAX', `expected a literal in ${JSON.stringify(src)}`);
  };
  const unit = () => {
    const x = peek();
    if (!x) fail('DT_SYNTAX', `empty test in ${JSON.stringify(src)}`);
    if (['<', '<=', '>', '>='].includes(x.t)) { take(); return { op: { '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge' }[x.t], v: endpoint() }; }
    if (x.t === '[' || x.t === '(' || x.t === ']') {
      take();
      const lo = endpoint();
      expect('..');
      const hi = endpoint();
      const end = take();
      if (!end || ![']', ')', '['].includes(end.t)) fail('DT_SYNTAX', `bad interval end in ${JSON.stringify(src)}`);
      return { op: 'range', lo, hi, loIn: x.t === '[', hiIn: end.t === ']' };
    }
    return { op: 'eq', v: endpoint() };
  };
  const list = () => { const out = [unit()]; while (peek() && peek().t === ',') { take(); out.push(unit()); } return out; };
  let test;
  if (toks.length === 1 && toks[0].t === '-') { p = 1; test = { k: 'any' }; }
  else if (peek() && peek().t === 'not') { take(); expect('('); test = { k: 'not', list: list() }; expect(')'); }
  else test = { k: 'list', list: list() };
  if (p !== toks.length) fail('DT_SYNTAX', `trailing input in ${JSON.stringify(src)}`);
  return test;
}

/** Parse S-FEEL simple unary tests (DMN 1.3 §9 rule 12). */
export const parseUnaryTests = src => parser(src);

/** Parse one S-FEEL literal to a JSON value (date("x") -> "x"). Used for output cells read from CSV. */
export function parseLiteral(src) {
  const t = parser(src);
  if (t.k !== 'list' || t.list.length !== 1 || t.list[0].op !== 'eq') fail('DT_SYNTAX', `not a single literal: ${JSON.stringify(src)}`);
  const v = t.list[0].v;
  return v.t === 'date' ? dateOf(v.v) : v.v;
}

// ---------------------------------------------------------------------------------------------------------------------
// Typed matching (three-valued, as FEEL: true / false / null)

function checkLiteral(v, type, where) {
  if (v.t === 'null') return;
  const ok = (ORDERED.has(type) && type !== 'date' && v.t === 'number') || (type === 'date' && v.t === 'date') || v.t === type;
  if (!ok) fail('DT_TYPE', `${where}: literal of type ${v.t} on a ${type} input`);
}

function checkTest(test, type, where) {
  if (test.k === 'any') return;
  for (const u of test.list) {
    if (u.op === 'range') {
      if (!ORDERED.has(type)) fail('DT_TYPE', `${where}: intervals need an ordered type (number, integer, date), not ${type}`);
      checkLiteral(u.lo, type, where); checkLiteral(u.hi, type, where);
      if (u.lo.t === 'null' || u.hi.t === 'null') fail('DT_TYPE', `${where}: null interval endpoint`);
    } else if (u.op !== 'eq') {
      if (!ORDERED.has(type)) fail('DT_TYPE', `${where}: ${u.op} needs an ordered type (number, integer, date), not ${type}`);
      if (u.v.t === 'null') fail('DT_TYPE', `${where}: comparison with null`);
      checkLiteral(u.v, type, where);
    } else checkLiteral(u.v, type, where);
  }
}

function unitValue(u, x) {
  if (u.op === 'eq') return u.v.t === 'null' ? x === null : x !== null && x === u.v.v;
  if (x === null) return null;
  switch (u.op) {
    case 'lt': return x < u.v.v;
    case 'le': return x <= u.v.v;
    case 'gt': return x > u.v.v;
    case 'ge': return x >= u.v.v;
    case 'range': return (u.loIn ? x >= u.lo.v : x > u.lo.v) && (u.hiIn ? x <= u.hi.v : x < u.hi.v);
    default: return fail('DT_INVALID', `unknown test op ${u.op}`);
  }
}

function listValue(list, x) {
  let sawNull = false;
  for (const u of list) { const r = unitValue(u, x); if (r === true) return true; if (r === null) sawNull = true; }
  return sawNull ? null : false;
}

/**
 * Does typed value x (null allowed) satisfy the compiled input entry, given the input's compiled input values (or
 * null)? (§10.3.2.10 grammar rules 15.a-c; R1)
 */
function satisfies(test, x, dashMatchesNull, values = null) {
  if (test.k === 'any') return dashMatchesNull || (values ? satisfies(values, x, false) : x !== null);
  if (test.k === 'not') return listValue(test.list, x) === false;
  return listValue(test.list, x) === true;
}

function typedInput(inp, raw) {
  if (raw === undefined || raw === null) {
    if (!inp.nullable) fail('DT_TYPE', `input ${inp.name} is null; declare it nullable to allow null`);
    return null;
  }
  switch (inp.type) {
    case 'number': if (typeof raw === 'number' && Number.isFinite(raw)) return raw; break;
    case 'integer': if (Number.isSafeInteger(raw)) return raw; break;
    case 'string': if (typeof raw === 'string') return raw; break;
    case 'boolean': if (typeof raw === 'boolean') return raw; break;
    case 'date': if (typeof raw === 'string') return parseDate(raw); break;
    default: break;
  }
  return fail('DT_TYPE', `input ${inp.name}: ${JSON.stringify(raw)} is not a ${inp.type}`);
}

function checkOutputValue(out, v, where) {
  if (v === null) return;
  const t = out.type;
  if (!t) { if (!['number', 'string', 'boolean'].includes(typeof v)) fail('DT_TYPE', `${where}: output entries must be JSON scalars`); return; }
  const ok = (t === 'number' && typeof v === 'number' && Number.isFinite(v)) || (t === 'integer' && Number.isSafeInteger(v))
    || (t === 'string' && typeof v === 'string') || (t === 'boolean' && typeof v === 'boolean')
    || (t === 'date' && typeof v === 'string' && (parseDate(v), true));
  if (!ok) fail('DT_TYPE', `${where}: ${JSON.stringify(v)} is not a ${t}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Compilation (validation happens once per table object)

const compiled = new WeakMap();

/**
 * Validate and compile a table (memoised per table object, which is deep-frozen on first successful compile). Throws
 * HIT_POLICY, DT_SYNTAX, DT_TYPE, DT_OUTPUT_VALUE or DT_INVALID.
 */
export function compileTable(table) {
  if (table && typeof table === 'object' && compiled.has(table)) return compiled.get(table);
  if (!table || typeof table !== 'object') fail('DT_INVALID', 'table must be an object');
  const id = table.id ?? '(table)';
  const hp = table.hitPolicy === undefined ? 'U' : table.hitPolicy;
  if (!Object.hasOwn(POLICY, hp)) fail('HIT_POLICY', `${id}: unknown hit policy ${JSON.stringify(hp)}`);
  let [policy, aggregation = null] = POLICY[hp];
  if (table.aggregation !== undefined && table.aggregation !== null) {
    if (!AGGREGATIONS.has(table.aggregation)) fail('HIT_POLICY', `${id}: unknown aggregation ${table.aggregation}`);
    if (policy !== 'COLLECT') fail('HIT_POLICY', `${id}: aggregation ${table.aggregation} needs the COLLECT hit policy`);
    if (aggregation && aggregation !== table.aggregation) fail('HIT_POLICY', `${id}: hit policy ${hp} conflicts with aggregation ${table.aggregation}`);
    aggregation = table.aggregation;
  }
  if (!Array.isArray(table.inputs) || !Array.isArray(table.outputs) || !table.outputs.length) fail('DT_INVALID', `${id}: inputs and a non-empty outputs list are required`);
  const names = new Set();
  const inputs = table.inputs.map((x, i) => {
    if (!x || typeof x.name !== 'string' || !x.name) fail('DT_INVALID', `${id}: input ${i} needs a name`);
    if (!TYPES.has(x.type)) fail('DT_TYPE', `${id}: input ${x.name} needs a type among ${[...TYPES].join(', ')}`);
    if (names.has(x.name)) fail('DT_INVALID', `${id}: duplicate column name ${x.name}`);
    names.add(x.name);
    let values = null;
    if (x.values !== undefined && x.values !== null) {
      values = parser(x.values);
      if (values.k === 'any') fail('DT_INVALID', `${id}: input values of ${x.name} cannot be '-'`);
      checkTest(values, x.type, `${id}: input values of ${x.name}`);
    }
    return Object.freeze({ name: x.name, type: x.type, nullable: x.nullable === true, values });
  });
  const outputs = table.outputs.map((x, i) => {
    if (!x || typeof x.name !== 'string' || !x.name) fail('DT_INVALID', `${id}: output ${i} needs a name`);
    if (names.has(x.name)) fail('DT_INVALID', `${id}: duplicate column name ${x.name}`);
    names.add(x.name);
    if (x.type !== undefined && !TYPES.has(x.type)) fail('DT_TYPE', `${id}: output ${x.name}: unknown type ${x.type}`);
    let values = null;
    if (x.values !== undefined && x.values !== null) {
      if (!Array.isArray(x.values) || !x.values.length) fail('DT_INVALID', `${id}: output values of ${x.name} must be a non-empty array of literals`);
      values = x.values.map(v => canonical(v));
      if (new Set(values).size !== values.length) fail('DT_INVALID', `${id}: duplicate output values in ${x.name}`);
      x.values.forEach(v => checkOutputValue(x, v, `${id}: output values of ${x.name}`));
    }
    return Object.freeze({ name: x.name, type: x.type ?? null, values });
  });
  if (aggregation && outputs.length !== 1) fail('HIT_POLICY', `${id}: aggregation is undefined over compound outputs (DMN 1.3 §8.2.10)`);
  if ((policy === 'PRIORITY' || policy === 'OUTPUT ORDER') && !outputs.some(o => o.values)) {
    fail('HIT_POLICY', `${id}: ${policy} needs output values on at least one output (priorities come from them)`);
  }
  if (!Array.isArray(table.rules)) fail('DT_INVALID', `${id}: rules must be an array`);
  const outCheck = (vals, where) => vals.forEach((v, k) => {
    checkOutputValue(outputs[k], v, where);
    if (outputs[k].values && !outputs[k].values.includes(canonical(v))) fail('DT_OUTPUT_VALUE', `${where}: ${JSON.stringify(v)} is not among the output values of ${outputs[k].name}`);
  });
  const rules = table.rules.map((r, ri) => {
    const where = `${id}: rule ${ri + 1}`;
    if (!r || !Array.isArray(r.when) || r.when.length !== inputs.length) fail('DT_INVALID', `${where}: 'when' must list ${inputs.length} input entries`);
    const then = outputs.length === 1 && !Array.isArray(r.then) ? [r.then] : r.then;
    if (!Array.isArray(then) || then.length !== outputs.length) fail('DT_INVALID', `${where}: 'then' must list ${outputs.length} output entries`);
    const entries = r.when.map((e, k) => {
      const t = parser(typeof e === 'string' ? e : canonical(e));
      checkTest(t, inputs[k].type, `${where}, input ${inputs[k].name}`);
      return t;
    });
    outCheck(then, where);
    return Object.freeze({ index: ri, id: r.id === undefined || r.id === null ? String(ri + 1) : String(r.id), entries, out: Object.freeze([...then]) });
  });
  if (new Set(rules.map(r => r.id)).size !== rules.length) fail('DT_INVALID', `${id}: duplicate rule ids`);
  let dflt = null, hasDefault = false;
  if (table.default !== undefined) {
    hasDefault = true;
    const vals = outputs.length === 1 ? [table.default] : outputs.map(o => {
      if (!table.default || typeof table.default !== 'object' || !Object.hasOwn(table.default, o.name)) fail('DT_INVALID', `${id}: default must give every output`);
      return table.default[o.name];
    });
    outCheck(vals, `${id}: default output`);
    dflt = Object.freeze(vals);
  }
  if (aggregation === 'SUM') rules.forEach(r => { if (!Number.isSafeInteger(r.out[0])) fail('DT_TYPE', `${id}: rule ${r.id}: SUM needs integer outputs (exact minor units), got ${JSON.stringify(r.out[0])}`); });
  if (aggregation === 'MIN' || aggregation === 'MAX') {
    const dateOut = outputs[0].type === 'date';
    rules.forEach(r => { if (!(dateOut ? typeof r.out[0] === 'string' : typeof r.out[0] === 'number')) fail('DT_TYPE', `${id}: rule ${r.id}: ${aggregation} needs ${dateOut ? 'date' : 'number'} outputs`); });
  }
  const c = Object.freeze({ id, policy, aggregation, inputs: Object.freeze(inputs), outputs: Object.freeze(outputs), rules: Object.freeze(rules), hasDefault, dflt });
  compiled.set(freezeDeep(table), c);
  return c;
}

const outputOf = (c, vals) => (c.outputs.length === 1 ? vals[0] : Object.fromEntries(c.outputs.map((o, k) => [o.name, vals[k]])));
const priorityOf = (c, r) => c.outputs.map((o, k) => (o.values ? o.values.indexOf(canonical(r.out[k])) : 0));
function comparePriority(c, a, b) {
  const pa = priorityOf(c, a), pb = priorityOf(c, b);
  for (let k = 0; k < pa.length; k++) if (pa[k] !== pb[k]) return pa[k] - pb[k];
  return a.index - b.index; // R5: stable by rule order
}

function readInputs(c, input) {
  if (!input || typeof input !== 'object') fail('DT_TYPE', `${c.id}: input must be an object`);
  return c.inputs.map(inp => {
    const x = typedInput(inp, input[inp.name]);
    if (x !== null && inp.values && !satisfies(inp.values, x, false)) fail('DT_DOMAIN', `${c.id}: input ${inp.name} = ${JSON.stringify(input[inp.name])} is outside its input values`);
    return x;
  });
}

const ruleMatches = (c, r, xs, dashMatchesNull) => r.entries.every((t, k) => satisfies(t, xs[k], dashMatchesNull, c.inputs[k].values));
const samePriority = (c, a, b) => canonical(priorityOf(c, a)) === canonical(priorityOf(c, b));

function aggregate(c, hits) {
  const vals = hits.map(r => r.out[0]);
  switch (c.aggregation) {
    case 'COUNT': return hits.length;
    case 'SUM': {
      const s = vals.reduce((a, v) => a + BigInt(v), 0n);
      if (s > BigInt(Number.MAX_SAFE_INTEGER) || s < BigInt(Number.MIN_SAFE_INTEGER)) fail('DT_TYPE', `${c.id}: SUM overflows a safe integer`);
      return Number(s);
    }
    case 'MIN': case 'MAX': {
      const key = c.outputs[0].type === 'date' ? v => parseDate(v) : v => v;
      let best = vals[0];
      for (const v of vals.slice(1)) if (c.aggregation === 'MIN' ? key(v) < key(best) : key(v) > key(best)) best = v;
      return best;
    }
    default: return fail('HIT_POLICY', `${c.id}: unknown aggregation ${c.aggregation}`);
  }
}

/**
 * Evaluate a table and explain the result: { result, matched: [ruleId], hits: [ruleId], usedDefault }. `hits` are the
 * rules whose outputs make up the result, in result order. Options: dashMatchesNull (R1, default false).
 */
export function decide(table, input, { dashMatchesNull = false } = {}) {
  const c = compileTable(table);
  const xs = readInputs(c, input);
  const matched = c.rules.filter(r => ruleMatches(c, r, xs, dashMatchesNull));
  const ids = rs => rs.map(r => r.id);
  if (!matched.length) return { result: c.hasDefault ? outputOf(c, c.dflt) : null, matched: [], hits: [], usedDefault: c.hasDefault };
  let hits;
  switch (c.policy) {
    case 'UNIQUE':
      if (matched.length > 1) fail('HIT_POLICY', `${c.id}: UNIQUE table matched rules ${ids(matched).join(', ')}`, { rules: ids(matched) });
      hits = matched; break;
    case 'ANY': {
      const first = canonical(matched[0].out);
      if (matched.some(r => canonical(r.out) !== first)) fail('HIT_POLICY', `${c.id}: ANY table matched rules with different outputs: ${ids(matched).join(', ')}`, { rules: ids(matched) });
      hits = [matched[0]]; break;
    }
    case 'PRIORITY': {
      const s = [...matched].sort((a, b) => comparePriority(c, a, b));
      const top = s.filter(r => samePriority(c, r, s[0]));
      if (top.some(r => canonical(r.out) !== canonical(s[0].out))) fail('HIT_POLICY', `${c.id}: PRIORITY tie at the top between rules ${ids(top).join(', ')} with different outputs`, { rules: ids(top) });
      hits = [s[0]]; break;
    }
    case 'FIRST': hits = [matched[0]]; break;
    case 'RULE ORDER': hits = matched; break;
    case 'OUTPUT ORDER': hits = [...matched].sort((a, b) => comparePriority(c, a, b)); break;
    case 'COLLECT': hits = matched; break;
    default: fail('HIT_POLICY', `${c.id}: unknown policy ${c.policy}`);
  }
  let result;
  if (!MULTI.has(c.policy)) result = outputOf(c, hits[0].out);
  else if (c.aggregation) result = aggregate(c, hits);
  else result = hits.map(r => outputOf(c, r.out));
  return { result, matched: ids(matched), hits: ids(hits), usedDefault: false };
}

/** Evaluate a table: the DMN result value only. */
export const evaluate = (table, input, opts) => decide(table, input, opts).result;

/**
 * Precedence levels (D365-style "Table, then Group, then All"; E1 tolerance hierarchy): `levels` is
 * [{ id, table }] in precedence order; the first level with a matching rule decides. Level tables may not carry a
 * default (it would stop the search). Returns { level, result, decision } or { level: null, result: null }.
 */
export function firstLevel(levels, input, opts) {
  for (const lv of levels) {
    const c = compileTable(lv.table);
    if (c.hasDefault) fail('HIT_POLICY', `level ${lv.id}: a precedence level table cannot have a default output`);
    const d = decide(lv.table, input, opts);
    if (d.matched.length) return { level: lv.id, result: d.result, decision: d };
  }
  return { level: null, result: null, decision: null };
}

// ---------------------------------------------------------------------------------------------------------------------
// Static checks: completeness (gaps), overlaps by hit policy, priority ties, rules that never hit.
//
// Exact for this S-FEEL subset: every test compares against literal boundaries, so each input's domain splits into
// finitely many cells on which every test is constant. One witness per cell suffices; the search assigns inputs one at
// a time and prunes branches where no rule can still match.

const OTHER = '\u0000other';

function witnessesFor(c, k) {
  const inp = c.inputs[k];
  const lits = [];
  const collect = t => { if (t && t.k !== 'any') for (const u of t.list) { if (u.op === 'range') lits.push(u.lo, u.hi); else lits.push(u.v); } };
  collect(inp.values);
  for (const r of c.rules) collect(r.entries[k]);
  const vals = lits.filter(v => v.t !== 'null').map(v => v.v);
  let raw;
  if (inp.type === 'boolean') raw = [true, false];
  else if (inp.type === 'string') {
    let other = OTHER;
    while (vals.includes(other)) other += '\u0000';
    raw = [...new Set(vals)].sort().concat([other]);
  } else {
    const b = [...new Set(vals)].sort((x, y) => x - y);
    let w;
    if (inp.type === 'number') {
      if (!b.length) w = [0];
      else {
        w = [b[0] - 1];
        for (let j = 0; j < b.length; j++) {
          w.push(b[j]);
          if (j + 1 < b.length) { const m = (b[j] + b[j + 1]) / 2; if (m > b[j] && m < b[j + 1]) w.push(m); }
        }
        w.push(b[b.length - 1] + 1);
      }
    } else {
      // integer and date (day numbers): the integers ceil(b)-1, b (when integral), floor(b)+1 hit every cell.
      w = b.length ? [...new Set(b.flatMap(x => [Math.ceil(x) - 1, ...(Number.isInteger(x) ? [x] : []), Math.floor(x) + 1]))].sort((x, y) => x - y) : [0];
    }
    raw = inp.type === 'date' ? w.flatMap(d => { try { return [dateOf(d)]; } catch { return []; } }) : w;
  }
  if (inp.nullable) raw = [...raw, null];
  return raw.filter(v => v === null || !inp.values || satisfies(inp.values, typedInput(inp, v), false));
}

/**
 * Static issues of a table: [{ code, severity, detail, rules?, witness? }], sorted. Errors make evaluation undefined
 * for some input (UNIQUE overlap, ANY conflict, an invalid table); warnings are gaps (no hit and no default),
 * priority ties between different outputs, and rules that never hit. Options: maxCells (default 1e6), maxWitnesses
 * (gap witnesses reported, default 20), dashMatchesNull.
 */
export function checkTable(table, { maxCells = 1e6, maxWitnesses = 20, dashMatchesNull = false } = {}) {
  let c;
  try { c = compileTable(table); } catch (e) {
    if (e && typeof e.code === 'string') return [{ code: e.code, severity: 'error', detail: e.message }];
    throw e;
  }
  const W = c.inputs.map((_, k) => witnessesFor(c, k));
  const issues = [];
  const pairSeen = new Set();
  const everMatched = new Set(), everHit = new Set();
  let cells = 0, gaps = 0, truncated = false;
  const asInput = xs => Object.fromEntries(c.inputs.map((inp, k) => [inp.name, xs[k]]));
  const typedOf = (k, v) => (v === null ? null : typedInput(c.inputs[k], v));
  const pair = (code, severity, a, b, xs, detail) => {
    const key = `${code}|${a.id}|${b.id}`;
    if (pairSeen.has(key)) return;
    pairSeen.add(key);
    issues.push({ code, severity, detail, rules: [a.id, b.id], witness: asInput(xs) });
  };
  const leaf = (active, xs) => {
    for (const r of active) everMatched.add(r.id);
    if (!active.length) return;
    switch (c.policy) {
      case 'UNIQUE':
        for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) pair('TABLE_OVERLAP', 'error', active[i], active[j], xs, 'UNIQUE rules overlap');
        for (const r of active) everHit.add(r.id); break;
      case 'ANY':
        for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
          if (canonical(active[i].out) !== canonical(active[j].out)) pair('TABLE_OVERLAP', 'error', active[i], active[j], xs, 'ANY rules overlap with different outputs');
        }
        for (const r of active) everHit.add(r.id); break;
      case 'PRIORITY': case 'OUTPUT ORDER': {
        const s = [...active].sort((a, b) => comparePriority(c, a, b));
        for (let i = 0; i + 1 < s.length; i++) {
          const a = s[i], b = s[i + 1];
          if (!samePriority(c, a, b) || canonical(a.out) === canonical(b.out)) continue;
          if (c.policy === 'OUTPUT ORDER') pair('HIT_POLICY', 'warning', a, b, xs, 'priority tie between different outputs (ordered by rule order)');
          else if (samePriority(c, a, s[0])) pair('HIT_POLICY', 'error', a, b, xs, 'PRIORITY tie at the top between different outputs (refused at evaluation)');
        }
        if (c.policy === 'PRIORITY') everHit.add(s[0].id); else s.forEach(r => everHit.add(r.id));
        break;
      }
      case 'FIRST': everHit.add(active[0].id); break;
      default: for (const r of active) everHit.add(r.id);
    }
  };
  const search = (k, active, xs) => {
    if (truncated) return;
    if (!active.length) {
      if (!c.hasDefault) {
        gaps++;
        if (gaps <= maxWitnesses) issues.push({ code: 'TABLE_GAP', severity: 'warning', detail: 'no rule matches and there is no default output', witness: asInput([...xs, ...W.slice(k).map(w => w[0])]) });
      }
      cells++;
      if (cells > maxCells) truncated = true;
      return;
    }
    if (k === c.inputs.length) {
      cells++;
      if (cells > maxCells) { truncated = true; return; }
      leaf(active, xs);
      return;
    }
    for (const v of W[k]) {
      const x = typedOf(k, v);
      search(k + 1, active.filter(r => satisfies(r.entries[k], x, dashMatchesNull, c.inputs[k].values)), [...xs, v]);
    }
  };
  if (W.some(w => !w.length)) issues.push({ code: 'TABLE_GAP', severity: 'warning', detail: 'an input has an empty domain' });
  else search(0, [...c.rules], []);
  if (truncated) issues.push({ code: 'TABLE_TOO_LARGE', severity: 'error', detail: `more than ${maxCells} cells; check incomplete` });
  else {
    for (const r of c.rules) {
      if (!everMatched.has(r.id)) issues.push({ code: 'TABLE_SHADOWED', severity: 'warning', detail: 'rule matches no input in the domain', rules: [r.id] });
      else if (!everHit.has(r.id)) issues.push({ code: 'TABLE_SHADOWED', severity: 'warning', detail: `rule never contributes to the result under ${c.policy}`, rules: [r.id] });
    }
    if (gaps > maxWitnesses) issues.push({ code: 'TABLE_GAP', severity: 'warning', detail: `${gaps - maxWitnesses} more gap regions not listed` });
  }
  const order = { error: 0, warning: 1 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity] || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

// ---------------------------------------------------------------------------------------------------------------------
// CSV tables (rulebook/<edition>/<table>.csv)

/** Strict RFC 4180 CSV: quoted fields with "" escapes, CRLF or LF rows; a final newline is optional. */
export function parseCsv(text) {
  if (typeof text !== 'string') fail('DT_SYNTAX', 'CSV must be text');
  const rows = [];
  let row = [], field = '', i = 0, quoted = false, fieldStarted = false;
  const endField = () => { row.push(field); field = ''; fieldStarted = false; quoted = false; };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; if (i < text.length && ![',', '\n', '\r'].includes(text[i])) fail('DT_SYNTAX', `CSV: text after a closing quote at ${i}`); continue; }
      field += ch; i++; continue;
    }
    if (ch === '"') { if (fieldStarted) fail('DT_SYNTAX', `CSV: quote inside an unquoted field at ${i}`); quoted = true; fieldStarted = true; i++; continue; }
    if (ch === ',') { endField(); i++; continue; }
    if (ch === '\r' || ch === '\n') {
      endField(); rows.push(row); row = [];
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch; fieldStarted = true; i++;
  }
  if (quoted) fail('DT_SYNTAX', 'CSV: unterminated quoted field');
  if (fieldStarted || row.length) { endField(); rows.push(row); }
  const width = rows.length ? rows[0].length : 0;
  rows.forEach((r, k) => { if (r.length !== width) fail('DT_SYNTAX', `CSV: row ${k + 1} has ${r.length} fields, header has ${width}`); });
  return rows;
}

/**
 * Build a table from CSV text: the header must list the input names then the output names (meta.inputs /
 * meta.outputs), plus any meta.annotations columns (ignored for evaluation). Input cells are unary tests; output cells
 * are S-FEEL literals ("text", numbers, true, false, null, date("...")).
 */
export function tableFromCsv(text, meta) {
  const rows = parseCsv(text);
  if (!rows.length) fail('DT_SYNTAX', 'CSV: no header');
  const [header, ...body] = rows;
  const ann = meta.annotations ?? [];
  const want = [...meta.inputs.map(x => x.name), ...meta.outputs.map(x => x.name), ...ann];
  if (canonical(header.map(h => h.trim())) !== canonical(want)) fail('DT_SYNTAX', `CSV header ${JSON.stringify(header)} != ${JSON.stringify(want)}`);
  const ni = meta.inputs.length, no = meta.outputs.length;
  const table = {
    id: meta.id, hitPolicy: meta.hitPolicy, aggregation: meta.aggregation, inputs: meta.inputs, outputs: meta.outputs,
    rules: body.map((r, k) => ({ id: String(k + 1), when: r.slice(0, ni).map(s => s.trim()), then: r.slice(ni, ni + no).map(s => parseLiteral(s.trim())) })),
  };
  if (meta.default !== undefined) table.default = meta.default;
  compileTable(table);
  return table;
}
