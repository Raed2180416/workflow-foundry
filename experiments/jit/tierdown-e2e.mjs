// End-to-end tier-down replay (THESIS-JIT §2.6, task #38): take one compiled solve.mjs, change the tier list of ONE judge,
// rerun the arm's archived dev tasks with the original and the variant, and compare the answers, statuses, costs and the
// bed oracle's verdicts. tierdown.mjs screens a judge in isolation (agreement with the accepted value); this tool checks
// what the change does to the delivered answer.
//
// The rewrite is source-level but not a regex guess: the solver is tokenized (strings, templates, comments, regex
// literals), every `<x>.judge(name, { ... tiers: ... })` call site is located, and only the target sites' `tiers`
// expression is replaced by an array literal. A tiers expression that is neither an array literal nor a const bound once
// to an array literal, an options argument that is not an object literal, a dynamic judge name, a spread that could
// override tiers, or any other use of `judge` is refused. The variant is re-parsed and `node --check`ed, and every other
// judge site must come out byte-identical.
//
//   node experiments/jit/tierdown-e2e.mjs --arm-dir D --version v1-haiku55 --judge rules --tiers claude-haiku-5-5,claude-sonnet-5-5
//        [--limit 8] [--cap-usd 1] [--label name] [--rerun-original] [--all-tasks] [--dry] [--force]
//        [--run-dir <experiments/runs/jit/<exp>/<arm>>] [--work-root /var/tmp/foundry-work/jit/tierdown-e2e] [--minutes 20]
//
// Dev split only: an arm or task whose split is not `dev` (or a seed >= 7001 without a split) is refused before any task
// is generated. The original is reused from its archived run directory when that run used the same solve.mjs (sha) and
// left a readable result; --rerun-original runs it fresh too (then the comparison also holds run-to-run model noise
// constant in kind: both sides are fresh runs). K=1 per task: a small difference is noise.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, compare } from './check-traces.mjs';

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const RUN_ROOT = path.join(REPO, 'experiments/runs/jit');
export const WORK_ROOT = '/var/tmp/foundry-work/jit/tierdown-e2e';
export const FIRST_TEST_SEED = 7001;

export class TierdownError extends Error {
  constructor(code, message, detail = null) { super(`${code}: ${message}`); this.code = code; this.detail = detail; }
}
const fail = (code, message, detail) => { throw new TierdownError(code, message, detail); };
const sha = text => createHash('sha256').update(text).digest('hex');
const round = x => (x == null ? null : Math.round(x * 1e6) / 1e6);
const sum = xs => xs.reduce((s, x) => s + (x ?? 0), 0);
const mean = xs => (xs.length ? sum(xs) / xs.length : null);

// ------------------------------------------------------------------------------------------------ tokenizer
const KW_BEFORE_EXPR = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await', 'extends']);
const PUNCT = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'];
const ID_START = /[A-Za-z_$#\u0080-￿]/, ID_PART = /[\w$\u0080-￿]/;

function skipString(src, i) {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === q) return j + 1;
    if (src[j] === '\n') break;
  }
  return fail('PARSE', `unterminated string at offset ${i}`);
}
function scanTemplate(src, i) {
  const quasis = [], exprs = [];
  let cur = '';
  for (let j = i + 1; j < src.length;) {
    const c = src[j];
    if (c === '\\') { cur += src.slice(j, j + 2); j += 2; continue; }
    if (c === '`') { quasis.push(cur); return { end: j + 1, quasis, exprs }; }
    if (c === '$' && src[j + 1] === '{') {
      quasis.push(cur); cur = '';
      const r = tokenize(src, j + 2, true);
      exprs.push(r.toks); j = r.end + 1; continue;
    }
    cur += c; j++;
  }
  return fail('PARSE', `unterminated template literal at offset ${i}`);
}

// Tokens: {type: ident|num|str|tmpl|regex|punct, value, start, end}. Template tokens carry their quasis and the tokens of
// each ${} expression. With stopAtBrace, returns at the unmatched `}` that closes a template expression.
export function tokenize(src, start = 0, stopAtBrace = false) {
  const toks = [];
  let i = start, depth = 0;
  const regexAllowed = () => {
    const p = toks.at(-1);
    if (!p) return true;
    if (p.type === 'ident') return KW_BEFORE_EXPR.has(p.value);
    if (p.type !== 'punct') return false;
    return p.value !== ')' && p.value !== ']';
  };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { const n = src.indexOf('\n', i); i = n < 0 ? src.length : n; continue; }
    if (c === '/' && src[i + 1] === '*') { const n = src.indexOf('*/', i + 2); if (n < 0) fail('PARSE', `unterminated comment at offset ${i}`); i = n + 2; continue; }
    if (i === 0 && c === '#' && src[1] === '!') { const n = src.indexOf('\n'); i = n < 0 ? src.length : n; continue; }
    const s = i;
    if (c === '"' || c === "'") { i = skipString(src, i); toks.push({ type: 'str', value: src.slice(s, i), start: s, end: i }); continue; }
    if (c === '`') { const t = scanTemplate(src, i); i = t.end; toks.push({ type: 'tmpl', value: src.slice(s, i), start: s, end: i, quasis: t.quasis, exprs: t.exprs }); continue; }
    if (c === '/' && regexAllowed()) {
      let j = i + 1, inClass = false;
      for (; j < src.length; j++) {
        const d = src[j];
        if (d === '\\') { j++; continue; }
        if (d === '\n') fail('PARSE', `unterminated regular expression at offset ${i}`);
        if (d === '[') inClass = true; else if (d === ']') inClass = false; else if (d === '/' && !inClass) break;
      }
      j++;
      while (j < src.length && /[a-z]/i.test(src[j])) j++;
      i = j; toks.push({ type: 'regex', value: src.slice(s, i), start: s, end: i }); continue;
    }
    if (ID_START.test(c)) { i++; while (i < src.length && ID_PART.test(src[i])) i++; toks.push({ type: 'ident', value: src.slice(s, i), start: s, end: i }); continue; }
    if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] ?? ''))) {
      const m = /^(?:0[xXoObB][\da-fA-F_]+n?|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?n?)/.exec(src.slice(i));
      i += m[0].length; toks.push({ type: 'num', value: src.slice(s, i), start: s, end: i }); continue;
    }
    if (stopAtBrace && c === '}' && depth === 0) return { toks, end: i };
    if (stopAtBrace) { if (c === '{') depth++; else if (c === '}') depth--; }
    let p = PUNCT.find(x => src.startsWith(x, i)) ?? c;
    if (p === '?.' && /\d/.test(src[i + 2] ?? '')) p = '?';
    i += p.length; toks.push({ type: 'punct', value: p, start: s, end: i });
  }
  if (stopAtBrace) fail('PARSE', `unterminated template expression at offset ${start}`);
  return { toks, end: i };
}

function matchBrackets(toks) {
  const match = new Map(), stack = [], pairs = { ')': '(', ']': '[', '}': '{' };
  toks.forEach((t, k) => {
    if (t.type !== 'punct') return;
    if ('([{'.includes(t.value)) stack.push(k);
    else if (pairs[t.value]) {
      const o = stack.pop();
      if (o === undefined || toks[o].value !== pairs[t.value]) fail('PARSE', `unbalanced '${t.value}' at offset ${t.start}`);
      match.set(o, k); match.set(k, o);
    }
  });
  if (stack.length) fail('PARSE', `unclosed '${toks[stack.at(-1)].value}' at offset ${toks[stack.at(-1)].start}`);
  return match;
}
const isP = (t, v) => t?.type === 'punct' && t.value === v;
// Ranges [a, b) of the top-level comma-separated items strictly between open index o and close index c.
function splitTop(toks, match, o, c, sep = ',') {
  const out = [];
  let a = o + 1;
  for (let k = o + 1; k < c; k++) {
    if (toks[k].type === 'punct' && '([{'.includes(toks[k].value)) { k = match.get(k); continue; }
    if (isP(toks[k], sep)) { out.push([a, k]); a = k + 1; }
  }
  if (a < c) out.push([a, c]);
  return out;
}
function decodeStr(body) {
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r\n|[\s\S])/g, (m, e) => {
    if (e[0] === 'u') return String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ''), 16));
    if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0', '\n': '', '\r\n': '' }[e] ?? e;
  });
}
const strValue = t => decodeStr(t.value.slice(1, -1));
const lineOf = (src, offset) => src.slice(0, offset).split('\n').length;
const lineText = (src, line) => src.split('\n')[line - 1];

// ------------------------------------------------------------------------------------------------ judge sites
// A judge's name as a pattern: literal parts kept, every computed part a '*'. 'vendex-' + i and `vendex-${i}` -> 'vendex-*'.
function namePattern(toks, match, [a, b]) {
  if (b <= a) return '*';
  const ranges = [];   // operands of the top-level '+' within [a, b)
  let s = a;
  for (let k = a; k < b; k++) {
    if (toks[k].type === 'punct' && '([{'.includes(toks[k].value)) { k = match.get(k); continue; }
    if (isP(toks[k], '+')) { ranges.push([s, k]); s = k + 1; }
  }
  ranges.push([s, b]);
  const parts = ranges.map(([x, y]) => {
    const t = toks[x];
    if (y - x !== 1) return '*';
    if (t.type === 'str') return strValue(t).replaceAll('*', '\\*');
    if (t.type === 'tmpl') return t.quasis.map(q => decodeStr(q).replaceAll('*', '\\*')).join('*');
    if (t.type === 'num') return t.value;
    return '*';
  });
  return parts.join('').replace(/(?<!\\)\*+/g, '*');
}
const globRe = pattern => new RegExp('^' + pattern.split(/(?<!\\)\*/).map(p => p.replaceAll('\\*', '*').replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 's');
export const nameMatches = (pattern, name) => pattern === name || globRe(pattern).test(name);

function parseProps(toks, match, o, c) {
  return splitTop(toks, match, o, c).map(([a, b]) => {
    const t0 = toks[a];
    if (isP(t0, '...')) return { kind: 'spread', range: [a, b] };
    if (isP(t0, '[')) return { kind: 'computed', range: [a, b] };
    let k = a;
    if (t0.type === 'ident' && ['async', 'get', 'set'].includes(t0.value) && (toks[a + 1]?.type === 'ident' || toks[a + 1]?.type === 'str' || isP(toks[a + 1], '*'))) k = a + 1;
    if (isP(toks[k], '*')) k++;
    const kt = toks[k];
    const key = kt?.type === 'ident' || kt?.type === 'num' ? kt.value : kt?.type === 'str' ? strValue(kt) : null;
    if (key == null) return { kind: 'unknown', range: [a, b] };
    if (isP(toks[k + 1], ':')) return { kind: 'init', key, range: [a, b], value: [k + 2, b] };
    if (isP(toks[k + 1], '(')) return { kind: 'method', key, range: [a, b] };
    if (b - a === 1 && kt.type === 'ident') return { kind: 'shorthand', key, range: [a, b], value: [a, b] };
    return { kind: 'unknown', range: [a, b] };
  });
}
const CONTROL = new Set(['if', 'while', 'for', 'switch', 'with', 'return', 'typeof', 'await', 'yield']);
const MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'length']);

// The array literal an identifier is bound to: exactly one `const NAME = [ ... ]` and no other way NAME could be bound or
// changed (another declaration, an assignment, a parameter, a destructuring, an import, a mutating method).
function resolveBinding(src, toks, match, name, opener = '[') {
  const what = opener === '[' ? 'an array literal' : 'an object literal';
  const decls = [], other = [];
  toks.forEach((t, k) => {
    if (t.type !== 'ident' || t.value !== name) return;
    const prev = toks[k - 1], next = toks[k + 1];
    if (isP(prev, '.') || isP(prev, '?.')) return;   // a property of something else
    if (prev?.type === 'ident' && ['const', 'let', 'var', 'function', 'class'].includes(prev.value)) { decls.push({ k, kw: prev.value }); return; }
    if (next?.type === 'punct' && ['=', '+=', '-=', '||=', '&&=', '??=', '++', '--'].includes(next.value)) { other.push(`assigned at line ${lineOf(src, t.start)}`); return; }
    if (isP(prev, '++') || isP(prev, '--')) { other.push(`updated at line ${lineOf(src, t.start)}`); return; }
    if (isP(next, '=>')) { other.push(`an arrow parameter at line ${lineOf(src, t.start)}`); return; }
    if ((isP(next, '.') && MUTATORS.has(toks[k + 2]?.value)) || (isP(next, '[') && isP(toks[match.get(k + 1) + 1], '='))) { other.push(`mutated at line ${lineOf(src, t.start)}`); return; }
    // a parameter (arrow, function, method or catch binding) or a destructuring pattern
    const follows = ',)=}]'.split('');
    for (const [o, c] of match) {
      if (o >= c || o > k || c < k) continue;
      const open = toks[o].value, after = toks[c + 1], before = toks[o - 1];
      const params = open === '(' && (isP(after, '=>') || (isP(after, '{') && before?.type === 'ident' && !CONTROL.has(before.value)));
      const pattern = (open === '{' || open === '[') && (isP(after, '=') || ['const', 'let', 'var'].includes(before?.value));
      if ((params || pattern) && follows.some(f => isP(next, f))) { other.push(`bound by a parameter or destructuring at line ${lineOf(src, t.start)}`); return; }
    }
  });
  // import { NAME } / import NAME from
  for (let k = 0; k < toks.length; k++) {
    if (toks[k].type !== 'ident' || toks[k].value !== 'import' || isP(toks[k + 1], '(') || isP(toks[k + 1], '.')) continue;
    for (let j = k + 1; j < toks.length && !(toks[j].type === 'str'); j++) if (toks[j].type === 'ident' && toks[j].value === name) other.push(`imported at line ${lineOf(src, toks[j].start)}`);
  }
  if (decls.length !== 1) return { error: decls.length ? `${name} is declared ${decls.length} times (lines ${decls.map(d => lineOf(src, toks[d.k].start)).join(', ')})` : `no declaration of ${name} found` };
  if (other.length) return { error: `${name} is ${other.join('; ')}` };
  const { k, kw } = decls[0];
  if (kw !== 'const') return { error: `${name} is declared with ${kw}, not const` };
  if (!isP(toks[k + 1], '=') || !isP(toks[k + 2], opener)) return { error: `${name} (line ${lineOf(src, toks[k].start)}) is not bound to ${what}: ${src.slice(toks[k].start, toks[Math.min(k + 8, toks.length - 1)].end).replace(/\s+/g, ' ')}` };
  const close = match.get(k + 2), after = toks[close + 1];
  if (after && !isP(after, ';') && !isP(after, ',') && lineOf(src, after.start) === lineOf(src, toks[close].end)) return { error: `${name} is bound to an expression that continues after ${what} (${after.value})` };
  if (opener === '{') return { name, line: lineOf(src, toks[k].start), props: parseProps(toks, match, k + 2, close) };
  const elems = splitTop(toks, match, k + 2, close);
  const values = elems.every(([a, b]) => b - a === 1 && toks[a].type === 'str') ? elems.map(([a]) => strValue(toks[a])) : null;
  return { name, line: lineOf(src, toks[k].start), text: src.slice(toks[k + 2].start, toks[close].end), values };
}

function tiersOf(src, toks, match, prop) {
  const [a, b] = prop.value;
  if (isP(toks[a], '[') && match.get(a) === b - 1) {
    const elems = splitTop(toks, match, a, b - 1);
    const values = elems.every(([x, y]) => y - x === 1 && toks[x].type === 'str') ? elems.map(([x]) => strValue(toks[x])) : null;
    return { kind: 'literal', span: [toks[a].start, toks[b - 1].end], text: src.slice(toks[a].start, toks[b - 1].end), values };
  }
  if (b - a === 1 && toks[a].type === 'ident') {
    const binding = resolveBinding(src, toks, match, toks[a].value);
    if (binding.error) return { kind: prop.kind === 'shorthand' ? 'shorthand' : 'identifier', error: binding.error, text: toks[a].value };
    return { kind: prop.kind === 'shorthand' ? 'shorthand' : 'identifier', span: [toks[a].start, toks[a].end], text: toks[a].value, values: binding.values, binding };
  }
  return { kind: 'expression', text: src.slice(toks[a].start, toks[b - 1].end), error: `tiers is \`${src.slice(toks[a].start, toks[b - 1].end).replace(/\s+/g, ' ').slice(0, 120)}\`: not an array literal or an identifier bound to one` };
}

// Every judge call site in a solver, plus every use of `judge` that is not a recognisable call (any such use blocks a rewrite).
export function findJudges(source) {
  const { toks } = tokenize(source);
  const match = matchBrackets(toks);
  const sites = [], unrecognized = [];
  const nested = list => list.flatMap(t => (t.type === 'tmpl' ? t.exprs.flatMap(e => [...e, ...nested(e)]) : []));
  for (const t of nested(toks)) if (t.type === 'ident' && t.value === 'judge') unrecognized.push({ line: lineOf(source, t.start), text: 'judge inside a template literal expression' });
  // `judge` spelled as a string ("flow['judge'](...)", `const k = 'judge'; flow[k](...)`) is a call this scan cannot see:
  // refuse it, except as the literal name argument of a recognised judge call (flow.judge('judge', ...)).
  const nameArgs = new Set();
  toks.forEach((t, k) => { if (t.type === 'ident' && t.value === 'judge' && (isP(toks[k - 1], '.') || isP(toks[k - 1], '?.'))) nameArgs.add(k + (isP(toks[k + 1], '?.') ? 3 : 2)); });
  const judgeString = t => (t.type === 'str' && strValue(t) === 'judge') || (t.type === 'tmpl' && !t.exprs.length && decodeStr(t.quasis[0] ?? '') === 'judge');
  const strUse = (list, top) => list.forEach((t, k) => {
    if (judgeString(t) && !(top && nameArgs.has(k) && (isP(list[k + 1], ',') || isP(list[k + 1], ')')))) unrecognized.push({ line: lineOf(source, t.start), text: `the string ${t.value} (a judge call this scan cannot see)` });
    if (t.type === 'tmpl') t.exprs.forEach(e => strUse(e, false));
  });
  strUse(toks, true);
  toks.forEach((t, k) => {
    if (t.type !== 'ident' || t.value !== 'judge') return;
    const prev = toks[k - 1];
    let open = k + 1;
    if (isP(toks[open], '?.')) open++;
    const isCall = (isP(prev, '.') || isP(prev, '?.')) && isP(toks[open], '(');
    const line = lineOf(source, t.start);
    if (!isCall) { unrecognized.push({ line, text: lineText(source, line).trim().slice(0, 160) }); return; }
    const close = match.get(open), args = splitTop(toks, match, open, close);
    const receiver = toks[k - 2] ? source.slice(toks[k - 2].start, toks[k - 2].end) : '';
    const site = { index: sites.length, line, receiver, nameText: args[0] ? source.slice(toks[args[0][0]].start, toks[args[0][1] - 1].end) : '', pattern: args[0] ? namePattern(toks, match, args[0]) : '*',
      span: [toks[k - 2]?.start ?? t.start, toks[close].end], tiers: null, error: null };
    site.dynamic = site.pattern === '*';
    const opt = args[1];
    if (!opt || !isP(toks[opt[0]], '{') || match.get(opt[0]) !== opt[1] - 1) site.error = `options of judge ${site.nameText} (line ${line}) are not an object literal`;
    else {
      const props = parseProps(toks, match, opt[0], opt[1] - 1);
      const tiersProps = props.map((p, i) => ({ ...p, i })).filter(p => p.key === 'tiers');
      const unsafe = props.filter(p => p.kind === 'computed' || p.kind === 'unknown');
      // A spread after tiers is safe only when it is a const bound once to an object literal with no tiers, spread or computed key.
      const spreadRisk = props.filter((p, i) => p.kind === 'spread' && i > (tiersProps[0]?.i ?? Infinity)).find(p => {
        const [a, b] = p.range;
        if (b - a !== 2 || toks[a + 1].type !== 'ident') return true;
        const bound = resolveBinding(source, toks, match, toks[a + 1].value, '{');
        return !!bound.error || bound.props.some(q => q.key === 'tiers' || ['spread', 'computed', 'unknown'].includes(q.kind));
      });
      if (unsafe.length) site.error = `judge ${site.nameText} (line ${line}) has a computed or unparsed option key, which could be tiers`;
      else if (tiersProps.length !== 1) site.error = `judge ${site.nameText} (line ${line}) has ${tiersProps.length} tiers properties`;
      else if (tiersProps[0].kind === 'method') site.error = `judge ${site.nameText} (line ${line}): tiers is a method`;
      else if (spreadRisk) site.error = `judge ${site.nameText} (line ${line}): the spread ${source.slice(toks[spreadRisk.range[0]].start, toks[spreadRisk.range[1] - 1].end)} after tiers could override it`;
      else {
        site.tiers = tiersOf(source, toks, match, tiersProps[0]);
        if (site.tiers.error) site.error = `judge ${site.nameText} (line ${line}): ${site.tiers.error}`;
      }
    }
    sites.push(site);
  });
  return { sites, unrecognized };
}

const tierLiteral = tiers => `[${tiers.map(t => `'${t}'`).join(', ')}]`;
export const MODEL_ID = /^[a-z0-9][a-z0-9._-]*$/;

// The variant source: only the target judge's tiers change. Throws TierdownError when the target cannot be located
// unambiguously or the result fails its own checks.
export function rewriteJudgeTiers(source, judge, tiers, { syntaxCheck = true } = {}) {
  if (typeof judge !== 'string' || !judge) fail('BAD_JUDGE', 'a judge name is required');
  if (!Array.isArray(tiers) || !tiers.length || tiers.some(t => typeof t !== 'string' || !MODEL_ID.test(t))) fail('BAD_TIERS', `tiers must be a non-empty list of model ids, got ${JSON.stringify(tiers)}`);
  if (new Set(tiers).size !== tiers.length) fail('BAD_TIERS', `tiers repeat a model: ${tiers.join(',')}`);
  const found = findJudges(source);
  if (found.unrecognized.length) fail('UNRECOGNIZED_JUDGE_USE', `judge is used other than as <flow>.judge(name, {...}): ${found.unrecognized.map(u => `line ${u.line}: ${u.text}`).join(' | ')}`, found.unrecognized);
  const hits = found.sites.filter(s => nameMatches(s.pattern, judge) || s.pattern === judge);
  if (!hits.length) fail('JUDGE_NOT_FOUND', `no judge call matches ${judge}; judges: ${found.sites.map(s => s.pattern).join(', ') || 'none'}`);
  const dyn = hits.filter(s => s.dynamic);
  if (dyn.length) fail('AMBIGUOUS', `judge ${judge}: the call at line ${dyn.map(s => s.line).join(', ')} has a computed name (${dyn.map(s => s.nameText).join(', ')}), which could be it`);
  const patterns = [...new Set(hits.map(s => s.pattern))];
  if (patterns.length > 1) fail('AMBIGUOUS', `judge ${judge} matches different call sites: ${hits.map(s => `${s.pattern} (line ${s.line})`).join(', ')}`);
  const broken = hits.filter(s => s.error);
  if (broken.length) fail('TIERS_UNRESOLVED', broken.map(s => s.error).join(' | '), broken);
  const oldTiers = hits.map(s => s.tiers.values);
  if (oldTiers.every(v => v && canonical(v) === canonical(tiers))) fail('SAME_TIERS', `judge ${judge} already uses ${tiers.join(',')}`);
  // Replace from the end so earlier spans keep their offsets.
  let out = source;
  const edits = hits.map(s => ({ site: s, start: s.tiers.span[0], end: s.tiers.span[1], text: s.tiers.kind === 'shorthand' ? `tiers: ${tierLiteral(tiers)}` : tierLiteral(tiers) }));
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  // Diff by line, in source order.
  const srcLines = source.split('\n'), outLines = out.split('\n');
  let shift = 0;
  const diff = edits.sort((a, b) => a.start - b.start).map(e => {
    const l0 = lineOf(source, e.start), l1 = lineOf(source, e.end), added = e.text.split('\n').length - source.slice(e.start, e.end).split('\n').length;
    const d = { line: l0, before: srcLines.slice(l0 - 1, l1).join('\n'), after: outLines.slice(l0 - 1 + shift, l1 + shift + added).join('\n'), was: e.site.tiers.text,
      wasValues: e.site.tiers.values, binding: e.site.tiers.binding ? { name: e.site.tiers.binding.name, line: e.site.tiers.binding.line, text: e.site.tiers.binding.text } : null };
    shift += added;
    return d;
  });
  const unified = diff.map(d => `@@ line ${d.line} @@\n${d.before.split('\n').map(l => `-${l}`).join('\n')}\n${d.after.split('\n').map(l => `+${l}`).join('\n')}`).join('\n');
  // Verify: the variant parses, has the same judge sites in the same order, the target sites carry exactly the new list,
  // and every other site's name and tiers text is unchanged.
  const again = findJudges(out);
  if (again.sites.length !== found.sites.length) fail('VERIFY', `the variant has ${again.sites.length} judge sites, the original ${found.sites.length}`);
  const hitIdx = new Set(hits.map(s => s.index));
  for (const [i, s] of found.sites.entries()) {
    const v = again.sites[i];
    if (v.pattern !== s.pattern || v.receiver !== s.receiver) fail('VERIFY', `judge site ${i} changed name or receiver`);
    if (hitIdx.has(i)) { if (v.tiers?.kind !== 'literal' || canonical(v.tiers.values) !== canonical(tiers)) fail('VERIFY', `judge site ${i} does not carry the new tiers`); }
    else if ((v.tiers?.text ?? v.error) !== (s.tiers?.text ?? s.error)) fail('VERIFY', `judge site ${i} (${s.pattern}) changed`);
  }
  if (syntaxCheck) {
    const dir = mkdtempSync(path.join(tmpdir(), 'tierdown-e2e-check-'));
    try {
      writeFileSync(path.join(dir, 'solve.mjs'), out);
      const r = spawnSync(process.execPath, ['--check', path.join(dir, 'solve.mjs')], { encoding: 'utf8', timeout: 30000 });
      if (r.status !== 0) fail('VERIFY', `node --check rejects the variant: ${(r.stderr || r.error?.message || '').slice(0, 600)}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  return { source: out, judge, pattern: patterns[0], scope: patterns[0].includes('*') ? `every instance of ${patterns[0]}` : 'one judge', sites: hits.map(s => ({ line: s.line, nameText: s.nameText, kind: s.tiers.kind })),
    oldTiers: oldTiers.length === 1 ? oldTiers[0] : oldTiers, newTiers: [...tiers], diff, unified, originalSha256: sha(source), variantSha256: sha(out),
    otherJudges: found.sites.filter(s => !hitIdx.has(s.index)).map(s => ({ pattern: s.pattern, line: s.line, tiers: s.tiers?.values ?? s.tiers?.text ?? null })),
    otherPatterns: [...new Set(found.sites.filter(s => !hitIdx.has(s.index)).map(s => s.pattern))] };
}

// ------------------------------------------------------------------------------------------------ records and comparison
const readLines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);
const lastJsonLine = text => { try { return JSON.parse(text.trim().split('\n').filter(Boolean).at(-1) ?? 'null'); } catch { return null; } };

// The target judge's events in a trace: count, cost, tiers used, and whether every tier tried is in `allowed`. `exclude`:
// the other call sites' name patterns; an event whose name one of them also matches (a templated target `v-*` and a
// literal `v-total`) cannot be attributed to the target and is counted apart (ambiguous), never as the target's.
export function judgeStats(trace, pattern, allowed = null, exclude = []) {
  const named = (trace ?? []).filter(e => e?.kind === 'judge' && typeof e.name === 'string' && nameMatches(pattern, e.name));
  const other = e => exclude.some(p => p !== pattern && nameMatches(p, e.name));
  const evs = named.filter(e => !other(e)), ambiguous = named.length - evs.length;
  const tiersUsed = {};
  for (const e of evs) if (e.tier) tiersUsed[e.tier] = (tiersUsed[e.tier] ?? 0) + 1;
  const tried = evs.flatMap(e => (e.tiersTried ?? []).map(t => t.model));
  return { calls: evs.length, ok: evs.filter(e => e.ok).length, costUsd: round(sum(evs.map(e => e.costUsd))), tiersUsed, escalations: sum(evs.map(e => e.escalations ?? 0)),
    offList: allowed ? tried.filter(m => !allowed.includes(m)).length : null, ...(ambiguous ? { ambiguous } : {}) };
}

// A compiled run as its archived directory left it (stream.mjs ArmRun.compiled): null when it cannot be read back.
export function readArchived(dir, { validate = null } = {}) {
  const trace = readLines(path.join(dir, 'trace.jsonl'));
  const calls = readLines(path.join(dir, 'tools/calls.jsonl'));
  const end = [...trace].reverse().find(e => ['done', 'deopt', 'crash'].includes(e.kind));
  const costUsd = calls.length ? sum(calls.map(c => (typeof c.costUsd === 'number' ? c.costUsd : 0))) : end?.spentUsd ?? null;
  const costUnknown = calls.some(c => c.ok && typeof c.costUsd !== 'number');
  let status, output = null, deopt = null;
  if (existsSync(path.join(dir, 'deopt.json'))) {
    status = 'deopt';
    try { deopt = JSON.parse(readFileSync(path.join(dir, 'deopt.json'), 'utf8')); } catch { deopt = { kind: 'unknown' }; }
  } else if (trace.some(e => e.kind === 'crash')) status = 'crash';
  else if (existsSync(path.join(dir, '.solve.stdout'))) {
    // ok/invalid need exit 0, and flow.mjs exits 0 only after done(): without a done event the run timed out or was
    // killed, and a JSON line it printed earlier is not its answer. Not reusable.
    if (!trace.some(e => e.kind === 'done')) return null;
    output = lastJsonLine(readFileSync(path.join(dir, '.solve.stdout'), 'utf8'));
    if (output == null) status = 'invalid';
    else status = !validate || validate(output) ? 'ok' : 'invalid';
  } else return null;
  return { status, output: status === 'ok' || status === 'invalid' ? output : null, deopt, trace, costUsd: round(costUsd), costUnknown, source: 'archived', dir };
}

// Order-insensitive canonical form (every array as a sorted multiset), as stream.mjs's 'unordered' compare.
const unorderedCanon = v => (Array.isArray(v) ? `[${v.map(unorderedCanon).sort().join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${unorderedCanon(v[k])}`).join(',')}}` : canonical(v));

// One task: original vs variant. Agreement is measured with the original as the reference, and only when both delivered.
export function compareTask(original, variant, { pattern, oldTiers = null, newTiers = null, otherPatterns = [] } = {}) {
  const both = original?.status === 'ok' && variant?.status === 'ok';
  const cmp = both ? compare(variant.output, original.output, { maxDiffs: 5 }) : null;
  const jo = original ? judgeStats(original.trace, pattern, Array.isArray(oldTiers) && oldTiers.every(x => typeof x === 'string') ? oldTiers : null, otherPatterns) : null;
  const jv = variant ? judgeStats(variant.trace, pattern, newTiers, otherPatterns) : null;
  return {
    statuses: { original: original?.status ?? null, variant: variant?.status ?? null }, bothOk: both,
    exact: both ? canonical(original.output) === canonical(variant.output) : null,
    exactUnordered: both ? unorderedCanon(original.output) === unorderedCanon(variant.output) : null,
    partial: cmp ? round(cmp.partial) : null, diffs: cmp?.diffs ?? [],
    judge: { original: jo, variant: jv },
    costUsd: { original: original?.costUsd ?? null, variant: variant?.costUsd ?? null },
    judgeUsd: { original: jo?.costUsd ?? null, variant: jv?.costUsd ?? null },
  };
}

const countBy = xs => xs.reduce((m, x) => { if (x != null) m[x] = (m[x] ?? 0) + 1; return m; }, {});
// rows: [{ compare, oracle: {original: {pass, score}|null, variant: ...} }]
export function summarize(rows) {
  const done = rows.filter(r => r.compare?.statuses.original && r.compare?.statuses.variant);
  const c = done.map(r => r.compare), both = c.filter(x => x.bothOk);
  const side = s => {
    const scored = done.map(r => r.oracle?.[s]).filter(Boolean);
    return {
      statuses: countBy(c.map(x => x.statuses[s])),
      judgeUsd: round(sum(c.map(x => x.judgeUsd[s]))), meanJudgeUsd: round(mean(c.map(x => x.judgeUsd[s] ?? 0))),
      totalUsd: round(sum(c.map(x => x.costUsd[s]))), meanTotalUsd: round(mean(c.map(x => x.costUsd[s] ?? 0))),
      judgeCalls: sum(c.map(x => x.judge[s]?.calls ?? 0)), tiersUsed: c.reduce((m, x) => { for (const [k, v] of Object.entries(x.judge[s]?.tiersUsed ?? {})) m[k] = (m[k] ?? 0) + v; return m; }, {}),
      offListTiers: sum(c.map(x => x.judge[s]?.offList ?? 0)),
      oracle: scored.length ? { n: scored.length, pass: scored.filter(o => o.pass).length, passRate: round(scored.filter(o => o.pass).length / scored.length), meanScore: round(mean(scored.map(o => o.score ?? 0))) } : null,
    };
  };
  const pairs = done.filter(r => r.oracle?.original && r.oracle?.variant);
  return {
    tasks: rows.length, compared: done.length, bothOk: both.length,
    exact: both.filter(x => x.exact).length, exactUnordered: both.filter(x => x.exactUnordered).length,
    exactRateBothOk: both.length ? round(both.filter(x => x.exact).length / both.length) : null,
    exactRateAll: done.length ? round(both.filter(x => x.exact).length / done.length) : null,
    meanPartialBothOk: both.length ? round(mean(both.map(x => x.partial))) : null,
    transitions: countBy(c.map(x => `${x.statuses.original}->${x.statuses.variant}`)),
    original: side('original'), variant: side('variant'),
    delta: {
      judgeUsd: round(sum(c.map(x => x.judgeUsd.variant)) - sum(c.map(x => x.judgeUsd.original))),
      totalUsd: round(sum(c.map(x => x.costUsd.variant)) - sum(c.map(x => x.costUsd.original))),
      meanScore: pairs.length ? round(mean(pairs.map(r => (r.oracle.variant.score ?? 0) - (r.oracle.original.score ?? 0)))) : null,
      passToFail: pairs.filter(r => r.oracle.original.pass && !r.oracle.variant.pass).length,
      failToPass: pairs.filter(r => !r.oracle.original.pass && r.oracle.variant.pass).length,
    },
  };
}

const fmt$ = x => (x == null ? '-' : `$${x.toFixed(4)}`);
const fmtO = o => (o ? `${o.pass ? 'PASS' : 'fail'} ${o.score == null ? '' : Number(o.score).toFixed(3)}`.trim() : '-');
export function markdown(report) {
  const s = report.summary, rw = report.rewrite;
  const out = [`# Tier-down e2e: judge \`${rw.pattern}\` ${JSON.stringify(rw.oldTiers)} -> ${JSON.stringify(rw.newTiers)}`, '',
    `- arm: \`${report.arm.experiment}/${report.arm.slug}\` (${report.arm.familyId}, split ${report.arm.split}); version \`${report.version.name}\` sha ${report.version.sha256.slice(0, 12)}`,
    `- variant sha ${rw.variantSha256.slice(0, 12)}; scope: ${rw.scope}; sites: ${rw.sites.map(x => `line ${x.line}`).join(', ')}`,
    `- original: ${report.options.rerunOriginal ? 'fresh runs' : 'archived run reused where it ran this sha, otherwise fresh'}; live spend $${report.spentUsd.toFixed(4)} of cap $${report.options.capUsd}`,
    `- dev split, K=1 per task: development evidence only; a gap of one or two tasks is noise.`, '',
    '| idx | task | original | variant | exact | partial | judge $ orig | judge $ var | total $ orig | total $ var | oracle orig | oracle var |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of report.tasks) {
    if (!r.compare) { out.push(`| ${r.idx} | ${r.taskKey ?? '-'} | ${r.skipped ?? '-'} | | | | | | | | | |`); continue; }
    const c = r.compare;
    out.push(`| ${r.idx} | ${r.taskKey} | ${c.statuses.original ?? '-'}${r.originalSource === 'archived' ? '*' : ''} | ${c.statuses.variant ?? '-'} | ${c.exact == null ? '-' : c.exact ? 'yes' : 'no'} | ${c.partial == null ? '-' : c.partial.toFixed(3)} | ${fmt$(c.judgeUsd.original)} | ${fmt$(c.judgeUsd.variant)} | ${fmt$(c.costUsd.original)} | ${fmt$(c.costUsd.variant)} | ${fmtO(r.oracle?.original)} | ${fmtO(r.oracle?.variant)} |`);
  }
  out.push('', '`*` = archived original run reused.', '', '| metric | original | variant |', '|---|---|---|',
    `| statuses | ${JSON.stringify(s.original.statuses)} | ${JSON.stringify(s.variant.statuses)} |`,
    `| oracle pass | ${s.original.oracle ? `${s.original.oracle.pass}/${s.original.oracle.n}` : '-'} | ${s.variant.oracle ? `${s.variant.oracle.pass}/${s.variant.oracle.n}` : '-'} |`,
    `| oracle mean score | ${s.original.oracle?.meanScore ?? '-'} | ${s.variant.oracle?.meanScore ?? '-'} |`,
    `| judge $ (total / mean) | ${fmt$(s.original.judgeUsd)} / ${fmt$(s.original.meanJudgeUsd)} | ${fmt$(s.variant.judgeUsd)} / ${fmt$(s.variant.meanJudgeUsd)} |`,
    `| run $ (total / mean) | ${fmt$(s.original.totalUsd)} / ${fmt$(s.original.meanTotalUsd)} | ${fmt$(s.variant.totalUsd)} / ${fmt$(s.variant.meanTotalUsd)} |`,
    `| judge tiers used | ${JSON.stringify(s.original.tiersUsed)} | ${JSON.stringify(s.variant.tiersUsed)} |`, '',
    `Answer agreement: exact ${s.exact}/${s.bothOk} where both ran ok (${s.exactUnordered} ignoring array order), ${s.exact}/${s.compared} of all compared; mean partial ${s.meanPartialBothOk ?? '-'}. ` +
    `Transitions ${JSON.stringify(s.transitions)}. Oracle flips: pass->fail ${s.delta.passToFail}, fail->pass ${s.delta.failToPass}; mean score delta ${s.delta.meanScore ?? '-'}; judge $ delta ${fmt$(s.delta.judgeUsd)}; run $ delta ${fmt$(s.delta.totalUsd)}.`);
  if (s.variant.offListTiers) out.push('', `WARNING: the variant tried ${s.variant.offListTiers} tier(s) outside the new list for this judge: the rewrite did not take effect as intended.`);
  return out.join('\n') + '\n';
}

// ------------------------------------------------------------------------------------------------ the run
const TASK_KEY = /^([^:]+):([^:]+):d(\d+):s(\d+)$/;
export function parseTaskKey(key) {
  const m = TASK_KEY.exec(key ?? '');
  return m ? { familyId: m[1], split: m[2], difficulty: Number(m[3]), seed: Number(m[4]) } : null;
}
// Dev only. Refuses on any sign of a held-out task: a split other than dev, or a seed in the test range without a split.
export function assertDev({ split, seed = null, where }) {
  if (split === 'test' || split === 'held-out' || split === 'sealed') fail('TEST_SPLIT', `${where} is on the ${split} split: tier-down e2e runs on dev tasks only`);
  if (split == null && seed != null && seed >= FIRST_TEST_SEED) fail('TEST_SPLIT', `${where} has seed ${seed} (test range) and no split`);
  if (split !== 'dev') fail('NOT_DEV', `${where} has split ${JSON.stringify(split)}, not dev`);
}

export function resolveVersion({ armDir, runArmDir, version }) {
  if (!version) fail('BAD_VERSION', '--version is required');
  if (/[\\/]/.test(version) || version.endsWith('.mjs')) {
    const file = version.endsWith('.mjs') ? version : path.join(version, 'solve.mjs');
    if (!existsSync(file)) fail('VERSION_NOT_FOUND', `${file} does not exist`);
    return { name: path.basename(version.endsWith('.mjs') ? path.dirname(file) : version), path: path.resolve(file), sha256: sha(readFileSync(file)), candidates: [path.resolve(file)], note: null };
  }
  const cands = [runArmDir && path.join(runArmDir, 'versions', version, 'solve.mjs'), path.join(armDir, 'compile', version, 'solve.mjs')].filter(f => f && existsSync(f));
  if (!cands.length) fail('VERSION_NOT_FOUND', `no solve.mjs for ${version} under ${runArmDir ? path.join(runArmDir, 'versions') + ' or ' : ''}${path.join(armDir, 'compile')}`);
  const shas = cands.map(f => sha(readFileSync(f)));
  return { name: version, path: cands[0], sha256: shas[0], candidates: cands, note: new Set(shas).size > 1 ? `the archived versions/ copy (used) and compile/ copy differ: ${shas.map(x => x.slice(0, 12)).join(' vs ')}` : null };
}

// The arm's compiled-run directories (i<idx>-compiled-<id>), one per idx: the latest that ran `sha` (or any, with allTasks).
export function compiledDirs(armDir, { sha256 = null, allTasks = false } = {}) {
  const byIdx = new Map();
  for (const name of readdirSync(armDir)) {
    const m = /^i(\d{3,})-compiled-[0-9a-z]+$/.exec(name);
    const dir = path.join(armDir, name);
    if (!m || !existsSync(path.join(dir, 'task.json'))) continue;
    const solve = path.join(dir, 'solve.mjs'), dsha = existsSync(solve) ? sha(readFileSync(solve)) : null;
    const rec = { idx: Number(m[1]), dir, name, sha256: dsha, sameVersion: sha256 != null && dsha === sha256, mtimeMs: statSync(dir).mtimeMs };
    if (!rec.sameVersion && !allTasks) continue;
    const prev = byIdx.get(rec.idx);
    if (!prev || (rec.sameVersion && !prev.sameVersion) || (rec.sameVersion === prev.sameVersion && rec.mtimeMs > prev.mtimeMs)) byIdx.set(rec.idx, rec);
  }
  return [...byIdx.values()].sort((a, b) => a.idx - b.idx);
}

const DEP_KEYS = ['runCompiled', 'createModelPort', 'makeTasks', 'score', 'loadFamily', 'validateOutput', 'policyIds'];
async function liveDeps() {
  const beds = await import('../lib/beds.mjs');
  const { loadPolicy } = await import('../../src/models/policy.mjs');
  const { validateOutput } = await import('./interpret.mjs');
  return {
    runCompiled: async a => (await import('./run-compiled.mjs')).runCompiled(a),
    createModelPort: async a => (await import('../lib/models.mjs')).createModelPort(a),
    makeTasks: beds.makeTasks, score: beds.score, loadFamily: beds.loadFamily, validateOutput,
    policyIds: loadPolicy().policy.models.map(m => m.id),
  };
}

const slugify = s => String(s).replace(/^claude-/, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60);

export async function tierdownE2E({ armDir, version, judge, tiers, limit = null, capUsd = 1, label = null, runArmDir = null, runRoot = RUN_ROOT, workRoot = WORK_ROOT,
  rerunOriginal = false, allTasks = false, minutes = null, perTaskUsd = null, dry = false, force = false, log = () => {} } = {}, injected = {}) {
  if (!armDir || !existsSync(armDir)) fail('BAD_ARM', `arm directory ${armDir} does not exist`);
  if (!(Number(capUsd) > 0)) fail('BAD_CAP', '--cap-usd must be positive');
  // A NaN budget would disable the gateway's cap (every comparison with NaN is false): every number is checked.
  for (const [flag, v] of [['--per-task-usd', perTaskUsd], ['--minutes', minutes], ['--limit', limit]]) if (v != null && !(Number.isFinite(Number(v)) && Number(v) > 0)) fail('USAGE', `${flag} must be a positive number, got ${v}`);
  if (label != null && (/^\.*$/.test(String(label)) || /[\\/]/.test(String(label)))) fail('USAGE', `--label ${JSON.stringify(label)} is not a plain name`);
  const tierList = Array.isArray(tiers) ? tiers : String(tiers ?? '').split(',').map(s => s.trim()).filter(Boolean);
  armDir = path.resolve(armDir);
  const experiment = path.basename(path.dirname(armDir)), slug = path.basename(armDir);
  runArmDir = runArmDir ? path.resolve(runArmDir) : path.join(runRoot, experiment, slug);
  // The split comes first: nothing is read, generated or run for a held-out arm.
  const armFile = path.join(runArmDir, 'arm.json');
  if (!existsSync(armFile)) fail('NO_ARM_RECORD', `${armFile} is missing: the arm's family and split cannot be verified`);
  const arm = JSON.parse(readFileSync(armFile, 'utf8'));
  const def = arm.def ?? {};
  assertDev({ split: def.split, where: `arm ${arm.spec ?? slug}` });
  const familyId = def.familyId;
  if (!familyId) fail('NO_ARM_RECORD', `${armFile} names no familyId`);
  if (familyId.startsWith('sealed-')) fail('TEST_SPLIT', `family ${familyId} is a sealed bed: tier-down e2e runs on dev tasks only`);
  // The run record must be this work directory's arm (a --run-dir of another arm would vouch for the wrong tasks).
  if ((arm.experiment && arm.experiment !== experiment) || (arm.slug && arm.slug !== slug)) fail('ARM_MISMATCH', `${armFile} is ${arm.experiment}/${arm.slug}, the work directory is ${experiment}/${slug}`);
  const fullBudget = Number(perTaskUsd ?? def.perTaskUsd ?? 1);
  if (!(Number.isFinite(fullBudget) && fullBudget > 0)) fail('NO_ARM_RECORD', `per-task budget ${fullBudget} is not a positive number`);
  const deps = { ...(DEP_KEYS.every(k => k in injected) ? {} : await liveDeps()), ...injected };
  const unknown = tierList.filter(t => !deps.policyIds.includes(t));
  if (unknown.length) fail('BAD_TIERS', `not in the owner model policy: ${unknown.join(', ')}`);
  const ver = resolveVersion({ armDir, runArmDir, version });
  const original = readFileSync(ver.path, 'utf8');
  const rw = rewriteJudgeTiers(original, judge, tierList);
  label = slugify(label ?? `${experiment}--${slug}--${ver.name}--${judge}--${tierList.map(slugify).join('+')}`);
  const outDir = path.join(workRoot, label);
  if (existsSync(path.join(outDir, 'report.json')) && !force && !dry) fail('EXISTS', `${outDir}/report.json exists: pass --force or a new --label`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'original.solve.mjs'), original);
  mkdirSync(path.join(outDir, 'variant'), { recursive: true });
  const variantPath = path.join(outDir, 'variant', 'solve.mjs');
  writeFileSync(variantPath, rw.source);
  const { source: _src, ...rewrite } = rw;
  writeFileSync(path.join(outDir, 'rewrite.json'), JSON.stringify(rewrite, null, 1));
  writeFileSync(path.join(outDir, 'rewrite.diff'), rw.unified + '\n');
  log(rw.unified);

  // Tasks: the arm's compiled runs, their recorded rows (taskKey), dev only, regenerated and checked against task.json.
  const rows = new Map();
  for (const r of readLines(path.join(runArmDir, 'results.jsonl'))) if (!arm.experiment || r.experiment === arm.experiment) rows.set(r.idx, r);
  const dirs = compiledDirs(armDir, { sha256: ver.sha256, allTasks });
  for (const d of dirs) {   // refuse the whole run on any held-out task before generating anything
    const key = parseTaskKey(rows.get(d.idx)?.taskKey);
    if (key) assertDev({ split: key.split, seed: key.seed, where: `task #${d.idx} (${rows.get(d.idx).taskKey})` });
  }
  const schema = (await deps.loadFamily(familyId)).outputSchema;
  const validate = out => deps.validateOutput(schema, out).valid;
  const tasks = [];
  for (const d of dirs) {
    if (limit != null && tasks.filter(t => !t.skipped).length >= Number(limit)) break;
    const row = rows.get(d.idx), key = parseTaskKey(row?.taskKey);
    const base = { idx: d.idx, dir: d.dir, archivedSha: d.sha256, sameVersion: d.sameVersion, taskKey: row?.taskKey ?? null, recordedStatus: row?.compiledStatus ?? null };
    if (!key) { tasks.push({ ...base, skipped: 'no results row with a taskKey for this idx' }); continue; }
    if (key.familyId !== familyId) { tasks.push({ ...base, skipped: `taskKey family ${key.familyId} is not ${familyId}` }); continue; }
    const [gen] = await deps.makeTasks(familyId, { split: key.split, seeds: [key.seed], difficulty: key.difficulty });
    const view = JSON.parse(JSON.stringify({ prompt: gen.task.prompt, inputs: gen.task.inputs ?? {}, ...(gen.task.files ? { files: gen.task.files } : {}) }));
    const archivedView = JSON.parse(readFileSync(path.join(d.dir, 'task.json'), 'utf8'));
    if (canonical(view) !== canonical(archivedView)) { tasks.push({ ...base, skipped: 'regenerated task differs from the archived task.json' }); continue; }
    if (row.taskHash && gen.taskHash && row.taskHash !== gen.taskHash) { tasks.push({ ...base, skipped: 'regenerated task hash differs from the recorded one' }); continue; }
    tasks.push({ ...base, key, task: gen.task, taskHash: gen.taskHash });
  }
  const runnable = tasks.filter(t => !t.skipped);
  log(`${runnable.length} task(s) to compare (${tasks.length - runnable.length} skipped); judge ${rw.pattern}: ${JSON.stringify(rw.oldTiers)} -> ${JSON.stringify(rw.newTiers)}`);
  const report = {
    kind: 'tierdown-e2e', at: new Date().toISOString(), label, outDir,
    arm: { experiment, slug, spec: arm.spec ?? null, familyId, split: def.split, workDir: armDir, runDir: runArmDir },
    version: { name: ver.name, path: ver.path, sha256: ver.sha256, note: ver.note },
    rewrite, options: { judge, tiers: tierList, limit, capUsd: Number(capUsd), rerunOriginal, allTasks, dry },
    spentUsd: 0, stopped: null, tasks: [], summary: null,
  };
  if (dry) {
    report.tasks = tasks.map(({ task, key, ...t }) => t);
    report.summary = summarize([]);
    writeFileSync(path.join(outDir, 'plan.json'), JSON.stringify(report, null, 1));
    return report;
  }

  const allowedModels = [...new Set([...(def.models ?? []), ...tierList])];
  const { port, db } = await deps.createModelPort({ journalFile: path.join(outDir, 'journal.sqlite'), allowedModels });
  let spent = 0, live = 0, capRefused = 0;
  const cap = Number(capUsd);
  // Belt and braces over the per-run gateway cap: no model call starts once the session cap is reached, counting the
  // calls of the run in progress (live) and not only finished runs.
  const metered = new Proxy(port, { get(t, k) {
    if (k === 'call') return async req => {
      if (spent + live >= cap) { capRefused++; throw new TierdownError('CAP', `tier-down e2e cap $${cap} reached`); }
      const r = await t.call(req);
      live += typeof r?.costUsd === 'number' ? r.costUsd : typeof r?.costUpperUsd === 'number' ? r.costUpperUsd : 0;
      return r;
    };
    const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
  } });
  const timeoutMs = (minutes ?? def.compiledMinutes ?? 20) * 60 * 1000;
  // Prompt version 2 solvers run on flow-v2.mjs, exactly as stream.mjs JitRun.flowPath does; version 1 passes nothing.
  const pv = def.compile?.promptVersion ?? 1;
  const flowPath = pv >= 2 ? path.join(path.dirname(fileURLToPath(import.meta.url)), (await import('./prompts.mjs')).flowFileOf({ promptVersion: pv })) : null;
  if (flowPath && !existsSync(flowPath)) fail('NO_FLOW', `${flowPath} (prompt version ${pv}) does not exist`);
  const runOne = async (t, side, solvePath) => {
    const remaining = cap - spent;
    if (remaining <= 0) return null;
    const workdir = path.join(outDir, 'runs', `i${String(t.idx).padStart(3, '0')}-${side}`);
    rmSync(workdir, { recursive: true, force: true }); mkdirSync(workdir, { recursive: true });
    const budget = Math.min(fullBudget, remaining), refusedBefore = capRefused;
    live = 0;
    const rc = await deps.runCompiled({ solvePath, task: t.task, modelPort: metered, perTaskUsd: budget, timeoutMs, workdir, familyId, outputSchema: schema, allowedModels,
      label: `tierdown-e2e:${label}:${t.idx}:${side}`, ...(flowPath ? { flowPath } : {}) });
    live = 0;
    spent += rc.costUsd ?? 0;
    // A run the session cap cut short (a budget below the arm's per-task budget that the gateway refused or that did not
    // deliver, or a call the cap wrapper refused) is not a measurement of the solver: it is excluded from the comparison.
    const truncated = capRefused > refusedBefore || (budget < fullBudget - 1e-9 && (rc.status !== 'ok' || (rc.meta?.refusals?.GATEWAY_BUDGET ?? 0) > 0));
    log(`#${t.idx} ${side}: ${rc.status}${truncated ? ' (cut short by the cap)' : ''} $${(rc.costUsd ?? 0).toFixed(4)} (spent $${spent.toFixed(4)} of $${cap})`);
    return { status: rc.status, output: rc.output ?? null, deopt: rc.deopt ?? null, trace: rc.trace ?? [], costUsd: round(rc.costUsd ?? 0), costUnknown: !!rc.costUnknown, source: 'fresh', dir: workdir,
      perTaskUsd: budget, error: rc.error ?? null, truncated };
  };
  const originalPath = path.join(outDir, 'original.solve.mjs');
  try {
    for (const t of tasks) {
      if (t.skipped) { report.tasks.push({ idx: t.idx, taskKey: t.taskKey, dir: t.dir, skipped: t.skipped }); continue; }
      if (spent >= cap) { report.stopped ??= `cap $${cap} reached before task #${t.idx}`; report.tasks.push({ idx: t.idx, taskKey: t.taskKey, dir: t.dir, skipped: 'cap reached' }); continue; }
      let orig = !rerunOriginal && t.sameVersion ? readArchived(t.dir, { validate }) : null, archivedRejected = null;
      if (!rerunOriginal && t.sameVersion && !orig) archivedRejected = 'the archived run left no readable result (no done, deopt or crash)';
      // The archived directory must be the run the stream recorded for this idx; otherwise rerun the original.
      if (orig && t.recordedStatus && orig.status !== t.recordedStatus) { archivedRejected = `archived status ${orig.status} is not the recorded compiledStatus ${t.recordedStatus}`; orig = null; }
      if (!orig) orig = await runOne(t, 'original', originalPath);
      const vari = orig && !orig.truncated ? await runOne(t, 'variant', variantPath) : null;
      if (!orig || !vari || orig.truncated || vari.truncated) {
        report.stopped ??= `cap $${cap} reached at task #${t.idx}`;
        report.tasks.push({ idx: t.idx, taskKey: t.taskKey, dir: t.dir, skipped: orig?.truncated || vari?.truncated ? 'cap reached during the run: excluded' : 'cap reached',
          ...(archivedRejected ? { archivedRejected } : {}), original: orig && { status: orig.status, source: orig.source, costUsd: orig.costUsd, perTaskUsd: orig.perTaskUsd ?? null },
          variant: vari && { status: vari.status, costUsd: vari.costUsd, perTaskUsd: vari.perTaskUsd } });
        continue;
      }
      const scoreOf = async r => (!r ? null : r.status === 'ok' && r.output != null ? await deps.score(familyId, t.task, r.output) : { pass: false, score: 0, details: { status: r.status } });
      const oracle = { original: await scoreOf(orig), variant: await scoreOf(vari) };
      const strip = r => (r ? { status: r.status, source: r.source, dir: r.dir, costUsd: r.costUsd, costUnknown: r.costUnknown, deopt: r.deopt ? { kind: r.deopt.kind, name: r.deopt.name } : null,
        error: r.error?.code ?? null, perTaskUsd: r.perTaskUsd ?? null } : null);
      report.tasks.push({ idx: t.idx, taskKey: t.taskKey, seed: t.key.seed, difficulty: t.key.difficulty, dir: t.dir, recordedStatus: t.recordedStatus, originalSource: orig?.source ?? null,
        ...(archivedRejected ? { archivedRejected } : {}),
        original: strip(orig), variant: strip(vari), compare: orig && vari ? compareTask(orig, vari, { pattern: rw.pattern, oldTiers: rw.oldTiers, newTiers: rw.newTiers, otherPatterns: rw.otherPatterns }) : null,
        oracle: { original: oracle.original && { pass: !!oracle.original.pass, score: oracle.original.score ?? null }, variant: oracle.variant && { pass: !!oracle.variant.pass, score: oracle.variant.score ?? null } } });
    }
  } finally { try { db?.close?.(); } catch {} }
  report.spentUsd = round(spent);
  report.summary = summarize(report.tasks.filter(r => r.compare).map(r => ({ compare: r.compare, oracle: r.oracle })));
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
  writeFileSync(path.join(outDir, 'report.md'), markdown(report));
  return report;
}

// ------------------------------------------------------------------------------------------------ CLI
export function parseArgs(argv) {
  const o = {}, flags = new Set(['--rerun-original', '--all-tasks', '--dry', '--force', '--json']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (flags.has(a)) { o[a.slice(2)] = true; continue; }
    if (!a.startsWith('--') || i + 1 >= argv.length) fail('USAGE', `unexpected argument ${a}`);
    o[a.slice(2)] = argv[++i];
  }
  return o;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const o = parseArgs(process.argv.slice(2));
    if (!o['arm-dir'] || !o.version || !o.judge || !o.tiers) fail('USAGE', 'tierdown-e2e.mjs --arm-dir D --version v --judge name --tiers a,b [--limit N] [--cap-usd 1] [--label name] [--rerun-original] [--all-tasks] [--dry]');
    const report = await tierdownE2E({ armDir: o['arm-dir'], version: o.version, judge: o.judge, tiers: o.tiers, limit: o.limit != null ? Number(o.limit) : null,
      capUsd: o['cap-usd'] != null ? Number(o['cap-usd']) : 1, label: o.label ?? null, runArmDir: o['run-dir'] ?? null, workRoot: o['work-root'] ?? WORK_ROOT,
      rerunOriginal: !!o['rerun-original'], allTasks: !!o['all-tasks'], minutes: o.minutes != null ? Number(o.minutes) : null,
      perTaskUsd: o['per-task-usd'] != null ? Number(o['per-task-usd']) : null, dry: !!o.dry, force: !!o.force, log: m => console.error(m) });
    if (o.dry) console.log(JSON.stringify({ outDir: report.outDir, tasks: report.tasks.map(t => ({ idx: t.idx, taskKey: t.taskKey, sameVersion: t.sameVersion, skipped: t.skipped ?? null })), rewrite: report.rewrite.diff }, null, 1));
    else { console.log(markdown(report)); console.log(JSON.stringify({ report: path.join(report.outDir, 'report.json'), spentUsd: report.spentUsd, summary: report.summary })); }
  } catch (e) {
    console.error(e instanceof TierdownError ? e.message : e?.stack ?? e);
    process.exitCode = e instanceof TierdownError ? 2 : 1;
  }
}
