// A small Jinja-style template evaluator for the control, covering what this automation's templates use:
//   {{ expr }}   expressions: literals (strings, numbers, lists, True/False/None), names, .attr, [index], calls, filters
//                (trim, string, int, float, lower, upper, length, list, join, default), operators (== != < > <= >= + - * / ~, and or not,
//                in, not in, is defined), and `a if cond else b`
//   {% if %} {% elif %} {% else %} {% endif %}
// Anything else (for, set, macros, unknown filters, unknown syntax) throws TemplateUnsupported. It does NOT reproduce Home Assistant's
// full environment; it is the minimum needed to run the ORIGINAL definition's templates under the same variables.
// Native rendering: a template that is a single {{ expr }} returns the evaluated value (as Home Assistant's native templates do);
// anything else returns a trimmed string.

export class TemplateUnsupported extends Error {}
export class TemplateError extends Error {}

// ---- tokenizer
const TOKEN = /\s*(?:(\d+\.\d+|\d+)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|([A-Za-z_][A-Za-z0-9_]*)|(==|!=|<=|>=|\/\/|[-+*\/%<>()\[\].,|~:]))/y;
function tokenize(src) {
  const out = [];
  TOKEN.lastIndex = 0;
  let last = 0;
  while (last < src.length) {
    TOKEN.lastIndex = last;
    const m = TOKEN.exec(src);
    if (!m) { if (src.slice(last).trim() === '') break; throw new TemplateUnsupported(`cannot tokenize near: ${src.slice(last, last + 20)}`); }
    last = TOKEN.lastIndex;
    if (m[1] !== undefined) out.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ t: 'str', v: JSON.parse(m[2][0] === '"' ? m[2] : `"${m[2].slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`) });
    else if (m[3] !== undefined) out.push({ t: 'name', v: m[3] });
    else out.push({ t: 'op', v: m[4] });
  }
  return out;
}

// ---- parser (precedence climbing) -> AST
function parseExpr(src) {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i], isOp = v => toks[i]?.t === 'op' && toks[i].v === v, isName = v => toks[i]?.t === 'name' && toks[i].v === v;
  const eat = () => toks[i++];
  const expectOp = v => { if (!isOp(v)) throw new TemplateUnsupported(`expected ${v} in: ${src}`); i++; };

  function ternary() {
    const a = orExpr();
    if (isName('if')) {
      i++; const cond = orExpr();
      let other = { k: 'lit', v: undefined };
      if (isName('else')) { i++; other = ternary(); }
      return { k: 'if', cond, a, b: other };
    }
    return a;
  }
  function orExpr() { let l = andExpr(); while (isName('or')) { i++; l = { k: 'or', l, r: andExpr() }; } return l; }
  function andExpr() { let l = notExpr(); while (isName('and')) { i++; l = { k: 'and', l, r: notExpr() }; } return l; }
  function notExpr() { if (isName('not')) { i++; return { k: 'not', e: notExpr() }; } return compare(); }
  function compare() {
    let l = additive();
    for (;;) {
      const t = peek();
      if (t?.t === 'op' && ['==', '!=', '<', '>', '<=', '>='].includes(t.v)) { i++; l = { k: 'cmp', op: t.v, l, r: additive() }; }
      else if (isName('in')) { i++; l = { k: 'in', l, r: additive(), neg: false }; }
      else if (isName('not') && toks[i + 1]?.v === 'in') { i += 2; l = { k: 'in', l, r: additive(), neg: true }; }
      else if (isName('is')) {
        i++; let neg = false; if (isName('not')) { i++; neg = true; }
        const test = eat();
        if (test?.v !== 'defined' && test?.v !== 'none') throw new TemplateUnsupported(`unsupported test: is ${test?.v}`);
        l = { k: 'is', test: test.v, neg, e: l };
      } else return l;
    }
  }
  function additive() { let l = mult(); while (isOp('+') || isOp('-') || isOp('~')) { const op = eat().v; l = { k: 'bin', op, l, r: mult() }; } return l; }
  function mult() { let l = unary(); while (isOp('*') || isOp('/') || isOp('%') || isOp('//')) { const op = eat().v; l = { k: 'bin', op, l, r: unary() }; } return l; }
  function unary() { if (isOp('-')) { i++; return { k: 'neg', e: unary() }; } return postfix(); }
  function postfix() {
    let e = primary();
    for (;;) {
      if (isOp('.')) { i++; const n = eat(); if (n?.t !== 'name') throw new TemplateUnsupported(`bad attribute in: ${src}`); e = { k: 'attr', e, name: n.v }; }
      else if (isOp('[')) { i++; const idx = ternary(); expectOp(']'); e = { k: 'index', e, idx }; }
      else if (isOp('(')) { i++; const args = []; while (!isOp(')')) { args.push(ternary()); if (isOp(',')) i++; else break; } expectOp(')'); e = { k: 'call', e, args }; }
      else if (isOp('|')) {
        i++; const n = eat(); if (n?.t !== 'name') throw new TemplateUnsupported(`bad filter in: ${src}`);
        const args = []; if (isOp('(')) { i++; while (!isOp(')')) { args.push(ternary()); if (isOp(',')) i++; else break; } expectOp(')'); }
        e = { k: 'filter', e, name: n.v, args };
      } else return e;
    }
  }
  function primary() {
    const t = eat();
    if (!t) throw new TemplateUnsupported(`unexpected end of expression: ${src}`);
    if (t.t === 'num' || t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'name') {
      if (t.v === 'True' || t.v === 'true') return { k: 'lit', v: true };
      if (t.v === 'False' || t.v === 'false') return { k: 'lit', v: false };
      if (t.v === 'None' || t.v === 'none') return { k: 'lit', v: null };
      return { k: 'name', name: t.v };
    }
    if (t.v === '(') { const e = ternary(); expectOp(')'); return e; }
    if (t.v === '[') { const items = []; while (!isOp(']')) { items.push(ternary()); if (isOp(',')) i++; else break; } expectOp(']'); return { k: 'list', items }; }
    throw new TemplateUnsupported(`unexpected token ${t.v} in: ${src}`);
  }
  const e = ternary();
  if (i < toks.length) throw new TemplateUnsupported(`trailing tokens in: ${src}`);
  return e;
}

// ---- values
const truthy = v => v !== undefined && v !== null && v !== false && v !== 0 && v !== '' && !(Array.isArray(v) && v.length === 0) && !(typeof v === 'object' && !Array.isArray(v) && typeof v !== 'function' && Object.keys(v).length === 0);
const pyRepr = v => (typeof v === 'string' ? `'${v.replaceAll("'", "\\'")}'` : pyStr(v));
export function pyStr(v) {
  if (v === undefined) return '';
  if (v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(', ')}]`;
  if (typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x)}`).join(', ')}}`;
  return String(v);
}
const FILTERS = {
  trim: v => pyStr(v).trim(), string: v => pyStr(v), lower: v => pyStr(v).toLowerCase(), upper: v => pyStr(v).toUpperCase(),
  int: (v, d = 0) => { const n = parseInt(pyStr(v), 10); return Number.isNaN(n) ? d : n; }, float: (v, d = 0) => { const n = parseFloat(pyStr(v)); return Number.isNaN(n) ? d : n; },
  length: v => (v == null ? 0 : v.length ?? Object.keys(v).length), list: v => (Array.isArray(v) ? [...v] : typeof v === 'string' ? [...v] : Object.keys(v ?? {})),
  join: (v, sep = '') => (v ?? []).map(pyStr).join(sep),
  default: (v, d = '', boolean = false) => (boolean ? (truthy(v) ? v : d) : v === undefined ? d : v),
};

function evaluate(n, ctx) {
  switch (n.k) {
    case 'lit': return n.v;
    case 'name': return Object.hasOwn(ctx, n.name) ? ctx[n.name] : undefined;
    case 'list': return n.items.map(x => evaluate(x, ctx));
    case 'attr': { const o = evaluate(n.e, ctx); if (o === undefined || o === null) throw new TemplateError(`cannot read .${n.name} of ${o}`); return typeof o === 'object' || typeof o === 'function' ? o[n.name] : undefined; }
    case 'index': { const o = evaluate(n.e, ctx); if (o == null) throw new TemplateError('cannot index None'); return o[evaluate(n.idx, ctx)]; }
    case 'call': {
      if (n.e.k === 'attr') { const o = evaluate(n.e.e, ctx), f = o?.[n.e.name]; if (typeof f !== 'function') throw new TemplateError(`${n.e.name} is not callable`); return f.apply(o, n.args.map(a => evaluate(a, ctx))); }
      const f = evaluate(n.e, ctx);
      if (typeof f !== 'function') throw new TemplateError(`${n.e.name ?? 'value'} is not callable`);
      return f(...n.args.map(a => evaluate(a, ctx)));
    }
    case 'filter': {
      const f = FILTERS[n.name];
      if (!f) throw new TemplateUnsupported(`unsupported filter ${n.name}`);
      return f(evaluate(n.e, ctx), ...n.args.map(a => evaluate(a, ctx)));
    }
    case 'if': return truthy(evaluate(n.cond, ctx)) ? evaluate(n.a, ctx) : evaluate(n.b, ctx);
    case 'or': { const l = evaluate(n.l, ctx); return truthy(l) ? l : evaluate(n.r, ctx); }
    case 'and': { const l = evaluate(n.l, ctx); return truthy(l) ? evaluate(n.r, ctx) : l; }
    case 'not': return !truthy(evaluate(n.e, ctx));
    case 'neg': return -evaluate(n.e, ctx);
    case 'is': { const v = evaluate(n.e, ctx); const r = n.test === 'defined' ? v !== undefined : v === null; return n.neg ? !r : r; }
    case 'in': { const l = evaluate(n.l, ctx), r = evaluate(n.r, ctx); const res = typeof r === 'string' ? r.includes(String(l)) : Array.isArray(r) ? r.some(x => x === l) : r != null && Object.hasOwn(r, l); return n.neg ? !res : res; }
    case 'cmp': {
      const l = evaluate(n.l, ctx), r = evaluate(n.r, ctx);
      switch (n.op) { case '==': return l === r; case '!=': return l !== r; case '<': return l < r; case '>': return l > r; case '<=': return l <= r; default: return l >= r; }
    }
    case 'bin': {
      const l = evaluate(n.l, ctx), r = evaluate(n.r, ctx);
      switch (n.op) { case '~': return pyStr(l) + pyStr(r); case '+': return l + r; case '-': return l - r; case '*': return l * r; case '/': return l / r; case '%': return l % r; default: return Math.floor(l / r); }
    }
    default: throw new TemplateUnsupported(`node ${n.k}`);
  }
}

// ---- template = text | {{ expr }} | {% if %}...{% elif %}...{% else %}...{% endif %}
function parseTemplate(src) {
  const re = /\{\{([\s\S]*?)\}\}|\{%([\s\S]*?)%\}|\{#[\s\S]*?#\}/g;
  const tokens = []; let last = 0, m;
  while ((m = re.exec(src))) {
    if (m.index > last) tokens.push({ k: 'text', v: src.slice(last, m.index) });
    if (m[0].startsWith('{#')) { /* comment */ }
    else if (m[1] !== undefined) tokens.push({ k: 'out', e: parseExpr(m[1].trim()) });
    else tokens.push({ k: 'tag', v: m[2].trim() });
    last = re.lastIndex;
  }
  if (last < src.length) tokens.push({ k: 'text', v: src.slice(last) });
  let p = 0;
  const body = stop => {
    const nodes = [];
    while (p < tokens.length) {
      const t = tokens[p];
      if (t.k === 'tag' && stop.some(s => t.v === s || t.v.startsWith(`${s} `))) return nodes;
      p++;
      if (t.k === 'text' || t.k === 'out') nodes.push(t);
      else if (t.v.startsWith('if ')) {
        const branches = [{ cond: parseExpr(t.v.slice(3)), body: body(['elif', 'else', 'endif']) }];
        for (;;) {
          const e = tokens[p++];
          if (!e) throw new TemplateUnsupported('unterminated {% if %}');
          if (e.v === 'endif') break;
          if (e.v === 'else') { branches.push({ cond: null, body: body(['endif']) }); continue; }
          branches.push({ cond: parseExpr(e.v.slice(5)), body: body(['elif', 'else', 'endif']) });
        }
        nodes.push({ k: 'if', branches });
      } else throw new TemplateUnsupported(`unsupported tag {% ${t.v} %}`);
    }
    if (stop.length && !stop.includes('')) throw new TemplateUnsupported('unterminated block');
    return nodes;
  };
  return body([]);
}

const cache = new Map();
const compiled = src => { let c = cache.get(src); if (!c) { c = parseTemplate(src); cache.set(src, c); } return c; };

function renderNodes(nodes, ctx) {
  let out = '';
  for (const n of nodes) {
    if (n.k === 'text') out += n.v;
    else if (n.k === 'out') out += pyStr(evaluate(n.e, ctx));
    else for (const b of n.branches) if (b.cond === null || truthy(evaluate(b.cond, ctx))) { out += renderNodes(b.body, ctx); break; }
  }
  return out;
}

export function isTemplate(s) { return typeof s === 'string' && /\{\{|\{%/.test(s); }
export function render(src, ctx) {
  if (!isTemplate(src)) return src;
  const nodes = compiled(src);
  const meaningful = nodes.filter(n => !(n.k === 'text' && n.v.trim() === ''));
  if (meaningful.length === 1 && meaningful[0].k === 'out') return evaluate(meaningful[0].e, ctx);    // native result
  return renderNodes(nodes, ctx).trim();
}
export const evalCondition = (src, ctx) => truthy(isTemplate(src) ? render(src, ctx) : src);
export { truthy };
