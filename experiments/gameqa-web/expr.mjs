// A small, closed expression language for model-written invariant checks (the gameqa-web QA workflow's check node).
// A model writes text; code parses and evaluates it. There is no assignment, no `new`, no global access and no call of
// anything but the functions below, so a check can read an observation and nothing else. Grammar (a JavaScript subset):
//   ternary  := or ('?' ternary ':' ternary)?          or := and ('||' and)*      and := eq ('&&' eq)*
//   eq       := rel (('=='|'!='|'==='|'!==') rel)*     rel := add (('<'|'<='|'>'|'>=') add)*
//   add      := mul (('+'|'-') mul)*                   mul := unary (('*'|'/'|'%') unary)*
//   unary    := ('!'|'-') unary | postfix              postfix := primary ('.' name | '[' expr ']')*
//   primary  := number | 'string' | "string" | true | false | null | name | name '(' args ')' | '(' expr ')' | '[' items ']'
//   args     := (expr | name '=>' expr) (',' ...)*     (a lambda is allowed only as a call argument)
// Semantics: member access on null/undefined gives undefined (never throws); == and === are deep (JSON) equality, != and
// !== its negation; && and || return booleans; + concatenates when either side is a string.
export const FUNCTIONS = Object.freeze({
  abs: x => Math.abs(x), min: (...a) => Math.min(...a), max: (...a) => Math.max(...a), floor: x => Math.floor(x), round: x => Math.round(x),
  sign: x => Math.sign(x), len: v => (typeof v === 'string' || Array.isArray(v)) ? v.length : undefined,
  includes: (c, v) => (typeof c === 'string' ? c.includes(String(v)) : Array.isArray(c) ? c.some(x => deepEq(x, v)) : false),
  num: s => { const m = /-?\d+/.exec(String(s ?? '')); return m ? Number(m[0]) : NaN; },
  str: v => (v === undefined ? 'undefined' : typeof v === 'string' ? v : JSON.stringify(v)),
  tile: (obs, x, y) => { const row = obs?.state?.tiles?.[y]; return typeof row === 'string' && Number.isInteger(x) && x >= 0 && x < row.length ? row[x] : '#'; },
  any: (a, f) => Array.isArray(a) && a.some(x => truthy(f(x))), all: (a, f) => !Array.isArray(a) || a.every(x => truthy(f(x))),
  count: (a, f) => (Array.isArray(a) ? a.filter(x => truthy(f(x))).length : 0), find: (a, f) => (Array.isArray(a) ? a.find(x => truthy(f(x))) : undefined),
});
const LAMBDA_FUNCS = new Set(['any', 'all', 'count', 'find']);
const BLOCKED = new Set(['__proto__', 'constructor', 'prototype', '__defineGetter__', '__lookupGetter__']);
const truthy = v => Boolean(v);
export function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export class ExprError extends Error { constructor(msg, pos) { super(pos === undefined ? msg : `${msg} at ${pos}`); this.name = 'ExprError'; } }

function tokenize(src) {
  if (typeof src !== 'string' || !src.trim()) throw new ExprError('empty expression');
  if (src.length > 2000) throw new ExprError('expression longer than 2000 characters');
  const out = [], ops = ['===', '!==', '==', '!=', '<=', '>=', '&&', '||', '=>', '<', '>', '+', '-', '*', '/', '%', '!', '?', ':', '.', ',', '(', ')', '[', ']'];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c)) { const m = /^\d+(\.\d+)?/.exec(src.slice(i)); out.push({ t: 'num', v: Number(m[0]), p: i }); i += m[0].length; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c) { if (src[j] === '\\' && j + 1 < src.length) { s += src[j + 1]; j += 2; } else s += src[j++]; }
      if (j >= src.length) throw new ExprError('unterminated string', i);
      out.push({ t: 'str', v: s, p: i }); i = j + 1; continue;
    }
    if (/[A-Za-z_$]/.test(c)) { const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i)); out.push({ t: 'id', v: m[0], p: i }); i += m[0].length; continue; }
    const op = ops.find(o => src.startsWith(o, i));
    if (!op) throw new ExprError(`unexpected character '${c}'`, i);
    out.push({ t: 'op', v: op, p: i }); i += op.length;
  }
  out.push({ t: 'end', p: src.length });
  return out;
}

export function parse(src) {
  const toks = tokenize(src);
  let k = 0;
  const peek = () => toks[k], next = () => toks[k++];
  const isOp = v => peek().t === 'op' && peek().v === v;
  const expect = v => { if (!isOp(v)) throw new ExprError(`expected '${v}'`, peek().p); return next(); };
  const binary = (sub, opsList, kind = 'bin') => () => {
    let left = sub();
    while (peek().t === 'op' && opsList.includes(peek().v)) { const op = next().v; left = { k: kind, op, a: left, b: sub() }; }
    return left;
  };
  const primary = () => {
    const tk = next();
    if (tk.t === 'num' || tk.t === 'str') return { k: 'lit', v: tk.v };
    if (tk.t === 'id') {
      if (tk.v === 'true' || tk.v === 'false') return { k: 'lit', v: tk.v === 'true' };
      if (tk.v === 'null') return { k: 'lit', v: null };
      if (tk.v === 'undefined') return { k: 'lit', v: undefined };
      if (isOp('(')) {
        if (!Object.hasOwn(FUNCTIONS, tk.v)) throw new ExprError(`unknown function '${tk.v}'`, tk.p);
        next();
        const args = [];
        if (!isOp(')')) {
          do {
            if (peek().t === 'id' && toks[k + 1]?.t === 'op' && toks[k + 1].v === '=>') {
              if (!LAMBDA_FUNCS.has(tk.v)) throw new ExprError(`${tk.v}() takes no lambda`, peek().p);
              const param = next().v; next();
              args.push({ k: 'lambda', param, body: ternary() });
            } else args.push(ternary());
          } while (isOp(',') && next());
        }
        expect(')');
        if (LAMBDA_FUNCS.has(tk.v) && args[1]?.k !== 'lambda') throw new ExprError(`${tk.v}(list, x => expr) needs a lambda`, tk.p);
        return { k: 'call', fn: tk.v, args };
      }
      return { k: 'var', name: tk.v };
    }
    if (tk.t === 'op' && tk.v === '(') { const e = ternary(); expect(')'); return e; }
    if (tk.t === 'op' && tk.v === '[') {
      const items = [];
      if (!isOp(']')) do items.push(ternary()); while (isOp(',') && next());
      expect(']');
      return { k: 'arr', items };
    }
    throw new ExprError(`unexpected '${tk.v ?? tk.t}'`, tk.p);
  };
  const postfix = () => {
    let e = primary();
    for (;;) {
      if (isOp('.')) { next(); const n = next(); if (n.t !== 'id') throw new ExprError('expected a property name', n.p); if (BLOCKED.has(n.v)) throw new ExprError(`property '${n.v}' is not allowed`, n.p); e = { k: 'get', o: e, key: { k: 'lit', v: n.v } }; }
      else if (isOp('[')) { next(); const key = ternary(); expect(']'); e = { k: 'get', o: e, key }; }
      else return e;
    }
  };
  const unary = () => (isOp('!') || isOp('-')) ? { k: 'un', op: next().v, a: unary() } : postfix();
  const mul = binary(unary, ['*', '/', '%']), add = binary(mul, ['+', '-']), rel = binary(add, ['<', '<=', '>', '>=']);
  const eq = binary(rel, ['==', '!=', '===', '!==']), and = binary(eq, ['&&'], 'and'), or = binary(and, ['||'], 'or');
  function ternary() {
    const c = or();
    if (!isOp('?')) return c;
    next(); const a = ternary(); expect(':'); return { k: 'cond', c, a, b: ternary() };
  }
  const ast = ternary();
  if (peek().t !== 'end') throw new ExprError(`unexpected '${peek().v}'`, peek().p);
  return ast;
}

// Free variables (to know which observation parts a check needs, e.g. `ui`).
export function freeNames(ast, bound = new Set(), out = new Set()) {
  if (!ast || typeof ast !== 'object') return out;
  if (ast.k === 'var' && !bound.has(ast.name)) out.add(ast.name);
  if (ast.k === 'lambda') { freeNames(ast.body, new Set([...bound, ast.param]), out); return out; }
  for (const v of Object.values(ast)) if (v && typeof v === 'object') (Array.isArray(v) ? v : [v]).forEach(x => freeNames(x, bound, out));
  return out;
}
export const mentions = (src, word) => new RegExp(`\\b${word}\\b`).test(src);

export function evaluate(ast, env, budget = { steps: 200000 }) {
  const ev = (n, scope) => {
    if (--budget.steps < 0) throw new ExprError('evaluation step budget exceeded');
    switch (n.k) {
      case 'lit': return n.v;
      case 'var': if (Object.hasOwn(scope, n.name)) return scope[n.name]; throw new ExprError(`unknown name '${n.name}'`);
      case 'arr': return n.items.map(x => ev(x, scope));
      case 'get': {
        const o = ev(n.o, scope), key = ev(n.key, scope);
        if (o === null || o === undefined) return undefined;
        if (typeof key !== 'string' && typeof key !== 'number') return undefined;
        if (BLOCKED.has(String(key))) throw new ExprError(`property '${key}' is not allowed`);
        if (typeof o === 'string') return key === 'length' ? o.length : (Number.isInteger(key) ? o[key] : undefined);
        if (typeof o !== 'object') return undefined;
        if (Array.isArray(o) && key === 'length') return o.length;
        return Object.hasOwn(o, key) ? o[key] : undefined;
      }
      case 'un': { const a = ev(n.a, scope); return n.op === '!' ? !truthy(a) : -a; }
      case 'and': return truthy(ev(n.a, scope)) && truthy(ev(n.b, scope));
      case 'or': return truthy(ev(n.a, scope)) || truthy(ev(n.b, scope));
      case 'cond': return truthy(ev(n.c, scope)) ? ev(n.a, scope) : ev(n.b, scope);
      case 'bin': {
        const a = ev(n.a, scope), b = ev(n.b, scope);
        switch (n.op) {
          case '+': return (typeof a === 'string' || typeof b === 'string') ? String(a) + String(b) : a + b;
          case '-': return a - b; case '*': return a * b; case '/': return a / b; case '%': return a % b;
          case '<': return a < b; case '<=': return a <= b; case '>': return a > b; case '>=': return a >= b;
          case '==': case '===': return deepEq(a, b);
          case '!=': case '!==': return !deepEq(a, b);
        }
        throw new ExprError(`bad operator ${n.op}`);
      }
      case 'call': {
        const args = n.args.map(a => a.k === 'lambda' ? (x => ev(a.body, { ...scope, [a.param]: x })) : ev(a, scope));
        return FUNCTIONS[n.fn](...args);
      }
      default: throw new ExprError(`bad node ${n.k}`);
    }
  };
  return ev(ast, env);
}

/** Compile a check source once; returns a function (env) => value. */
export function compile(src) {
  const ast = parse(src);
  return Object.assign(env => evaluate(ast, env), { ast, src });
}
