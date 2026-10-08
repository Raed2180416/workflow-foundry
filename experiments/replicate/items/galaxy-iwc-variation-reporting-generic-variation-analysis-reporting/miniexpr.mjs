// Two tiny expression evaluators the .ga emulator needs, each limited to the syntax the original
// workflow actually uses. Anything outside that subset throws (an unsupported construct is refused, never
// guessed): SnpSift filter expressions (steps 4 and 5) and the Python snippets of Galaxy's Compute and
// Filter tools (steps 9, 15, 16, 19).
import { pyFloat, pyRound6 } from './formats.mjs';

function tokenize(src, re) {
  const out = []; let m; re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    const start = re.lastIndex;
    m = re.exec(src);
    if (!m || m.index !== start) throw new Error(`unsupported syntax near "${src.slice(start, start + 12)}" in: ${src}`);
    if (m[1] !== undefined) out.push(m[1].trim());
  }
  return out;
}

// ---- SnpSift filter expressions: numbers, DP / AF / DP4[i], + - * /, comparisons, & |, parentheses.
export function compileSnpSift(src) {
  const toks = tokenize(src, /\s*(\d+\.?\d*(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*(?:\[\d+\])?|<=|>=|==|!=|&&|\|\||[()+\-*/<>&|!])\s*|\s+/y);
  let i = 0;
  const peek = () => toks[i], next = () => toks[i++];
  const level = (sub, ops) => () => { let l = sub(); while (ops.includes(peek())) { const op = next(), r = sub(); const a = l; l = rec => bin(op, a(rec), r(rec)); } return l; };
  const bin = (op, a, b) => {
    switch (op) {
      case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b;
      case '<': return a < b; case '<=': return a <= b; case '>': return a > b; case '>=': return a >= b;
      case '==': return a === b; case '!=': return a !== b;
      case '&': case '&&': return Boolean(a) && Boolean(b); case '|': case '||': return Boolean(a) || Boolean(b);
      default: throw new Error(`operator ${op}`);
    }
  };
  function primary() {
    const t = next();
    if (t === '(') { const e = or(); if (next() !== ')') throw new Error(`missing ) in: ${src}`); return e; }
    if (t === '!') { const e = primary(); return rec => !e(rec); }
    if (t === '-') { const e = primary(); return rec => -e(rec); }
    if (/^\d/.test(t)) { const v = Number(t); return () => v; }
    const m = /^([A-Za-z_]\w*)(?:\[(\d+)\])?$/.exec(t ?? '');
    if (!m) throw new Error(`unexpected token ${t} in: ${src}`);
    return rec => {
      const raw = rec.info.get(m[1]);
      if (raw === undefined) throw new Error(`field ${m[1]} missing on ${rec.chrom}:${rec.pos}`);
      return m[2] === undefined ? Number(raw) : Number(raw.split(',')[Number(m[2])]);
    };
  }
  const mul = level(primary, ['*', '/']), add = level(mul, ['+', '-']);
  const cmp = level(add, ['<', '<=', '>', '>=', '==', '!=']), and = level(cmp, ['&', '&&']);
  const or = level(and, ['|', '||']);
  const f = or();
  if (i !== toks.length) throw new Error(`trailing tokens in: ${src}`);
  return f;
}

// ---- Python snippets: ints (BigInt), floats (number), strings; c<N> column names; + - * / // %,
// comparisons, and / or / not, round / str / int / float / abs. `cols` maps c<N> to a typed value.
export function compilePython(src) {
  const toks = tokenize(src, /\s*(\d+\.\d*|\.\d+|\d+|'[^']*'|"[^"]*"|[A-Za-z_]\w*|\/\/|==|!=|<=|>=|[()+\-*/%<>,])\s*|\s+/y);
  let i = 0;
  const peek = () => toks[i], next = () => toks[i++];
  const isFloat = v => typeof v === 'number', isInt = v => typeof v === 'bigint';
  const num = v => (isInt(v) ? Number(v) : typeof v === 'boolean' ? Number(v) : v);
  const arith = (op, a, b) => {
    if (op === '+' && typeof a === 'string' && typeof b === 'string') return a + b;
    if (typeof a === 'string' || typeof b === 'string') throw new Error(`TypeError: ${op} on str`);
    if (op === '/') { if (num(b) === 0) throw new Error('ZeroDivisionError'); return num(a) / num(b); }
    const intOp = isInt(a) && isInt(b);
    const x = intOp ? a : num(a), y = intOp ? b : num(b);
    switch (op) {
      case '+': return x + y; case '-': return x - y; case '*': return x * y;
      case '//': if (intOp ? y === 0n : y === 0) throw new Error('ZeroDivisionError'); return intOp ? x / y : Math.floor(x / y);
      case '%': if (intOp ? y === 0n : y === 0) throw new Error('ZeroDivisionError'); return x % y;
      default: throw new Error(`operator ${op}`);
    }
  };
  const compare = (op, a, b) => {
    const x = typeof a === 'string' ? a : num(a), y = typeof b === 'string' ? b : num(b);
    return { '==': x === y, '!=': x !== y, '<': x < y, '<=': x <= y, '>': x > y, '>=': x >= y }[op];
  };
  const pyStr = v => (typeof v === 'string' ? v : typeof v === 'boolean' ? (v ? 'True' : 'False') : isFloat(v) ? pyFloat(v) : String(v));
  const calls = {
    str: ([v]) => pyStr(v),
    int: ([v]) => (typeof v === 'string' ? BigInt(v.trim()) : BigInt(Math.trunc(num(v)))),
    float: ([v]) => (typeof v === 'string' ? Number(v) : num(v)),
    abs: ([v]) => (isInt(v) ? (v < 0n ? -v : v) : Math.abs(v)),
    round: ([v, nd]) => {
      if (nd === undefined) return BigInt(Math.round(num(v)));
      if (nd !== 6n) throw new Error('round() is only modelled for 6 digits');
      return pyRound6(num(v));
    },
  };
  const leftAssoc = (sub, ops, apply) => () => { let l = sub(); while (ops.includes(peek())) { const op = next(), r = sub(), a = l; l = c => apply(op, a(c), r(c)); } return l; };
  function atom() {
    const t = next();
    if (t === '(') { const e = or(); if (next() !== ')') throw new Error(`missing ) in: ${src}`); return e; }
    if (t === '-') { const e = atom(); return c => -e(c); }
    if (/^\d+$/.test(t)) { const v = BigInt(t); return () => v; }
    if (/^(\d+\.\d*|\.\d+)$/.test(t)) { const v = Number(t); return () => v; }
    if (/^['"]/.test(t)) { const v = t.slice(1, -1); return () => v; }
    if (/^c\d+$/.test(t)) return c => { if (!(t in c)) throw new Error(`no column ${t}`); return c[t]; };
    if (calls[t] && peek() === '(') {
      next(); const args = [];
      if (peek() !== ')') { args.push(or()); while (peek() === ',') { next(); args.push(or()); } }
      if (next() !== ')') throw new Error(`missing ) in: ${src}`);
      return c => calls[t](args.map(a => a(c)));
    }
    throw new Error(`unsupported token ${t} in: ${src}`);
  }
  const mul = leftAssoc(atom, ['*', '/', '//', '%'], arith), add = leftAssoc(mul, ['+', '-'], arith);
  const cmp = leftAssoc(add, ['==', '!=', '<', '<=', '>', '>='], compare);
  function not() { if (peek() === 'not') { next(); const e = not(); return c => !e(c); } return cmp(); }
  const and = leftAssoc(not, ['and'], (_, a, b) => a && b);
  function or() { return leftAssoc(and, ['or'], (_, a, b) => a || b)(); }
  const f = or();
  if (i !== toks.length) throw new Error(`trailing tokens in: ${src}`);
  return { eval: f, str: pyStr };
}
