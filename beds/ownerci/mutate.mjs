// Token-level mutation operators for the ownerci catalog builder (offline) and the edit
// application used by generate()/oracle(). A small JavaScript tokenizer skips comments, string,
// template and regular-expression literals, so operators only ever touch code tokens.

const PUNCT = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||',
  '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '**',
  '{', '}', '(', ')', '[', ']', ';', ',', '<', '>', '+', '-', '*', '/', '%', '&', '|', '^', '!', '~', '?', ':', '=', '.', '@', '#'];
const EXPR_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'function']);
const RESERVED = new Set([...EXPR_KEYWORDS, ...CONTROL, 'const', 'let', 'var', 'class', 'extends', 'import', 'export', 'from', 'default',
  'try', 'finally', 'break', 'continue', 'this', 'super', 'null', 'true', 'false', 'undefined', 'async', 'static', 'get', 'set']);

export function tokenize(src) {
  const toks = [];
  const braces = []; // 'b' for a block/object brace, 't' for a template substitution
  let i = 0, line = 1;
  const push = (type, start, end) => { toks.push({ type, value: src.slice(start, end), start, end, line }); };
  const countLines = (a, b) => { for (let k = a; k < b; k++) if (src[k] === '\n') line++; };
  const prevSig = () => toks[toks.length - 1];
  const regexAllowed = () => {
    const p = prevSig();
    if (!p) return true;
    if (p.type === 'punct') return !/^[)\]}]$/.test(p.value);
    if (p.type === 'ident') return EXPR_KEYWORDS.has(p.value);
    return false;
  };
  const scanTemplate = startAt => { // scans from just after ` or } until ` or ${
    let j = startAt;
    while (j < src.length) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '`') return { end: j + 1, closed: true };
      if (src[j] === '$' && src[j + 1] === '{') return { end: j + 2, closed: false };
      j++;
    }
    throw new Error('unterminated template literal');
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); countLines(i, e + 2); i = e + 2; continue; }
    if (c === '\'' || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      push('string', i, j + 1); i = j + 1; continue;
    }
    if (c === '`' || (c === '}' && braces[braces.length - 1] === 't')) {
      if (c === '}') braces.pop();
      const { end, closed } = scanTemplate(i + 1);
      const l0 = line; countLines(i, end);
      toks.push({ type: 'template', value: src.slice(i, end), start: i, end, line: l0 });
      if (!closed) braces.push('t');
      i = end; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(?:0[xX][0-9a-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?n?)/.exec(src.slice(i));
      push('number', i, i + m[0].length); i += m[0].length; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
      push('ident', i, i + m[0].length); i += m[0].length; continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1, cls = false;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false;
        else if (src[j] === '/' && !cls) break;
        else if (src[j] === '\n') throw new Error(`unterminated regex at line ${line}`);
        j++;
      }
      j++;
      while (/[a-z]/.test(src[j] ?? '')) j++;
      push('regex', i, j); i = j; continue;
    }
    const p = PUNCT.find(x => src.startsWith(x, i));
    if (!p) throw new Error(`unexpected character ${JSON.stringify(c)} at line ${line}`);
    if (p === '{') braces.push('b');
    if (p === '}') braces.pop();
    push('punct', i, i + p.length); i += p.length;
  }
  return toks;
}

// Matching bracket index for every opening bracket token.
function matchBrackets(toks) {
  const match = new Map(), stack = [];
  const pairs = { '(': ')', '[': ']', '{': '}' };
  toks.forEach((t, k) => {
    if (t.type !== 'punct') return;
    if (pairs[t.value]) stack.push(k);
    else if (t.value === ')' || t.value === ']' || t.value === '}') { const o = stack.pop(); match.set(o, k); match.set(k, o); }
  });
  return match;
}

// A '(' that opens a parameter list (arrow function, function declaration/expression, method).
function isParamList(toks, open, match) {
  const close = match.get(open);
  const after = toks[close + 1], before = toks[open - 1], before2 = toks[open - 2];
  if (after?.value === '=>') return true;
  if (before?.value === 'function') return true;
  if (before?.type === 'ident' && before2?.value === 'function') return true;
  if (after?.value === '{' && before?.type === 'ident' && !CONTROL.has(before.value)
    && (!before2 || ['{', '}', ';'].includes(before2.value) || before2.value === 'static' || before2.value === 'async')) return true;
  return false;
}

const lineStart = (src, pos) => src.lastIndexOf('\n', pos - 1) + 1;
const lineEnd = (src, pos) => { const e = src.indexOf('\n', pos); return e < 0 ? src.length : e; };

/** Enumerate candidate mutations of `src`. Each is { operator, start, end, replacement, line, note }. */
export function enumerateMutations(src) {
  const toks = tokenize(src);
  const match = matchBrackets(toks);
  const out = [];
  const add = (operator, start, end, replacement, note) => {
    if (src.slice(start, end) === replacement) return;
    out.push({ operator, start, end, replacement, line: src.slice(0, start).split('\n').length, note });
  };
  const CMP = { '<': '<=', '<=': '<', '>': '>=', '>=': '>', '===': '!==', '!==': '===' };
  // parameter-list membership for default-argument mutations
  const paramDepth = new Array(toks.length).fill(false);
  toks.forEach((t, k) => {
    if (t.value === '(' && t.type === 'punct' && isParamList(toks, k, match)) for (let q = k + 1; q < match.get(k); q++) paramDepth[q] = true;
  });
  toks.forEach((t, k) => {
    const prev = toks[k - 1], next = toks[k + 1];
    if (t.type === 'punct') {
      if (CMP[t.value]) add('cmp-flip', t.start, t.end, CMP[t.value], `${t.value} -> ${CMP[t.value]}`);
      if (t.value === '&&') add('logic-swap', t.start, t.end, '||', '&& -> ||');
      if (t.value === '||') add('logic-swap', t.start, t.end, '&&', '|| -> &&');
      if (t.value === '!') add('negation-removal', t.start, t.end, '', 'remove !');
      if (t.value === '.' && next?.type === 'ident' && next.value === 'length') {
        const after = toks[k + 2];
        if (!after || !['=', '(', '.', '++', '--', '+=', '-=', '*', '/', '%', '**', '?.'].includes(after.value)) {
          add('off-by-one', next.end, next.end, ' + 1', '.length -> .length + 1');
          add('off-by-one', next.end, next.end, ' - 1', '.length -> .length - 1');
        }
      }
      // default arguments: `name = <literal>` inside a parameter list
      if (t.value === '=' && paramDepth[k] && prev?.type === 'ident' && next && [',', ')', '}'].includes(toks[k + 2]?.value)) {
        let rep = null;
        if (next.type === 'number' && /^\d+$/.test(next.value)) rep = String(Number(next.value) + 1);
        else if (next.type === 'number' && /^[\d.]+(e-?\d+)?$/i.test(next.value)) { const v = Number(next.value); rep = String(v < 1 ? v / 2 : v + 1); }
        else if (next.type === 'ident' && (next.value === 'true' || next.value === 'false')) rep = next.value === 'true' ? 'false' : 'true';
        else if (next.type === 'string' && next.value.length > 2) rep = `${next.value[0]}${next.value[0]}`;
        if (rep !== null) add('default-arg', next.start, next.end, rep, `default ${prev.value} = ${next.value} -> ${rep}`);
      }
      // swap the first two arguments of a call
      if (t.value === '(' && match.has(k) && !isParamList(toks, k, match)
        && (prev?.type === 'ident' ? !RESERVED.has(prev.value) && toks[k - 2]?.value !== 'function' : [')', ']'].includes(prev?.value))) {
        const close = match.get(k);
        const args = []; let from = k + 1, depth = 0;
        for (let q = k + 1; q < close; q++) {
          const v = toks[q].value;
          if (toks[q].type === 'punct' && ['(', '[', '{'].includes(v)) depth++;
          else if (toks[q].type === 'punct' && [')', ']', '}'].includes(v)) depth--;
          else if (toks[q].type === 'punct' && v === ',' && depth === 0) { args.push([from, q - 1]); from = q + 1; }
        }
        if (from <= close - 1) args.push([from, close - 1]);
        if (args.length >= 2) {
          const [a, b] = args;
          const aText = src.slice(toks[a[0]].start, toks[a[1]].end), bText = src.slice(toks[b[0]].start, toks[b[1]].end);
          const between = src.slice(toks[a[1]].end, toks[b[0]].start);
          if (aText !== bText && !aText.startsWith('...') && !bText.startsWith('...') && !/\n/.test(aText + bText + between)
            && aText.length <= 80 && bText.length <= 80) {
            add('arg-swap', toks[a[0]].start, toks[b[1]].end, `${bText}${between}${aText}`, `swap ${aText} <-> ${bText}`);
          }
        }
      }
    }
    if (t.type === 'number' && /^\d+$/.test(t.value) && Number(t.value) <= 100 && prev?.value !== '.' ) {
      const v = Number(t.value);
      if (!(prev?.value === '=' && paramDepth[k])) {
        add('off-by-one', t.start, t.end, String(v + 1), `${v} -> ${v + 1}`);
        if (v >= 1) add('off-by-one', t.start, t.end, String(v - 1), `${v} -> ${v - 1}`);
      }
    }
    if (t.type === 'ident' && (t.value === 'true' || t.value === 'false') && !(prev?.value === '=' && paramDepth[k])) {
      const ctx = prev && (prev.value === 'return' || prev.value === '=>') ? 'return' : 'literal';
      add('bool-swap', t.start, t.end, t.value === 'true' ? 'false' : 'true', `${ctx} ${t.value} -> ${t.value === 'true' ? 'false' : 'true'}`);
    }
    // delete a guard clause that throws: `if (...) throw ...;` or `if (...) { throw ...; }`
    if (t.type === 'ident' && t.value === 'if' && prev?.value !== 'else' && next?.value === '(') {
      const close = match.get(k + 1);
      const body = toks[close + 1];
      let endTok = null;
      if (body?.value === 'throw') {
        let depth = 0;
        for (let q = close + 2; q < toks.length; q++) {
          const v = toks[q].value;
          if (toks[q].type === 'punct' && ['(', '[', '{'].includes(v)) depth++;
          else if (toks[q].type === 'punct' && [')', ']', '}'].includes(v)) { if (depth === 0) { endTok = q - 1; break; } depth--; }
          else if (v === ';' && depth === 0) { endTok = q; break; }
        }
      } else if (body?.value === '{' && toks[close + 2]?.value === 'throw') {
        const bclose = match.get(close + 1);
        const semis = toks.slice(close + 2, bclose).filter(x => x.value === ';').length;
        if (semis <= 1) endTok = bclose;
      }
      if (endTok !== null) {
        let start = t.start, end = toks[endTok].end;
        const ls = lineStart(src, start), le = lineEnd(src, end);
        if (/^\s*$/.test(src.slice(ls, start)) && /^\s*$/.test(src.slice(end, le))) { start = ls; end = Math.min(src.length, le + 1); }
        else if (src[end] === ' ') end++;
        add('guard-delete', start, end, '', `delete guard: ${src.slice(t.start, toks[endTok].end).replace(/\s+/g, ' ').slice(0, 100)}`);
      }
    }
  });
  return out;
}

/** Apply non-overlapping edits { start, end, replacement } to src. */
export function applyEdits(src, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  for (let q = 1; q < sorted.length; q++) if (sorted[q].end > sorted[q - 1].start) throw new Error('overlapping edits');
  let out = src;
  for (const e of sorted) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  return out;
}

/** Minimal unified-style diff of the lines touched by an edit set (for the catalog record). */
export function lineDiff(original, mutated, path) {
  const a = original.split('\n'), b = mutated.split('\n');
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length - 1, eb = b.length - 1;
  while (ea >= s && eb >= s && a[ea] === b[eb]) { ea--; eb--; }
  const minus = a.slice(s, ea + 1).map(l => `-${l}`), plus = b.slice(s, eb + 1).map(l => `+${l}`);
  return `--- a/${path}\n+++ b/${path}\n@@ -${s + 1},${minus.length} +${s + 1},${plus.length} @@\n${[...minus, ...plus].join('\n')}`;
}
