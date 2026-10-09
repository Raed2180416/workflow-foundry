// Row 7: recompile non-regression audit, the AST part. Reports deletions and widenings of guard sites between a parent and a
// child solve.mjs. Parser: the acorn copy bundled inside Node itself (no dependency added); run with `node --expose-internals`.
//
// Guard sites (rules frozen before the tool was run on any variant):
//   call   a call whose callee is a non-local name or a member property matching /^(guard|invariant|check|assert|flag|deopt|refuse)/i
//          (flow.guard, flow.invariant, flow.check, flow.flag, flow.deopt in JIT solvers)
//   if     an if statement whose consequent rejects: throw, or return of a string / template / null / false, or a deopt/flag call
//   cond   a conditional expression with a null or string-literal branch (check callbacks returning a problem, value filters)
//   cmp    a comparison (<, <=, >, >=, ===, !==, ==, !=) with a numeric literal operand (thresholds)
// Normalisation, so renames, reorders and extractions do not count as changes:
//   - every locally bound identifier (declarations, parameters) becomes `$`; globals, imports and property names are kept;
//   - a module-level `const NAME = <literal>` is replaced by its literal (constant propagation);
//   - a call to a local function whose body is a single expression (or a single return) is inlined, up to depth 3;
//   - sites inside a local function that is never referenced are dropped (dead guards count as deleted).
// Matching: multiset of site keys, parent against child. An unmatched parent site is paired with an unmatched child site of the
// same kind and skeleton (numeric literals and comparison operators masked) -> 'modified' (widening/tightening by operator or
// literal, see classify), or with a child site whose test is a sub-term of the parent's -> 'widened (term dropped)'. Otherwise it
// is 'deleted'. Additions are reported but never flag. The child is flagged iff any parent site is deleted, modified or widened.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
let acorn, walk;
try {
  acorn = require('internal/deps/acorn/acorn/dist/acorn');
  walk = require('internal/deps/acorn/acorn-walk/dist/walk');
} catch {
  throw new Error('astdiff.mjs needs Node\'s bundled acorn: run with node --expose-internals');
}

const GUARD_NAME = /^(guard|invariant|check|assert|flag|deopt|refuse)/i;
const CMP = new Set(['<', '<=', '>', '>=', '===', '!==', '==', '!=']);

function parse(src) { return acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, allowAwaitOutsideFunction: true }); }

// Collect bindings, single-expression functions, module-level literal constants and function nodes.
function analyse(ast) {
  const locals = new Set(), imports = new Set(), consts = new Map(), simpleFns = new Map(), fnNodes = new Map();
  const addPattern = p => {
    if (!p) return;
    if (p.type === 'Identifier') locals.add(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach(q => addPattern(q.type === 'RestElement' ? q.argument : q.value));
    else if (p.type === 'ArrayPattern') p.elements.forEach(addPattern);
    else if (p.type === 'AssignmentPattern') addPattern(p.left);
    else if (p.type === 'RestElement') addPattern(p.argument);
  };
  const singleExpr = fn => {
    if (fn.body.type !== 'BlockStatement') return fn.body;
    const b = fn.body.body;
    return b.length === 1 && b[0].type === 'ReturnStatement' && b[0].argument ? b[0].argument : null;
  };
  walk.full(ast, node => {
    if (node.type === 'ImportDeclaration') node.specifiers.forEach(s => imports.add(s.local.name));
    if (node.type === 'VariableDeclarator') addPattern(node.id);
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
      if (node.id) locals.add(node.id.name);
      node.params.forEach(addPattern);
    }
    if (node.type === 'CatchClause') addPattern(node.param);
    if (node.type === 'FunctionDeclaration' && node.id) { fnNodes.set(node.id.name, node); const e = singleExpr(node); if (e) simpleFns.set(node.id.name, { params: node.params, body: e }); }
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init && ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.init.type)) {
      fnNodes.set(node.id.name, node.init); const e = singleExpr(node.init); if (e) simpleFns.set(node.id.name, { params: node.init.params, body: e });
    }
  });
  for (const st of ast.body) {
    const decl = st.type === 'ExportNamedDeclaration' ? st.declaration : st;
    if (decl?.type === 'VariableDeclaration' && decl.kind === 'const') {
      for (const d of decl.declarations) if (d.id.type === 'Identifier' && d.init?.type === 'Literal' && !(d.init.regex)) consts.set(d.id.name, d.init);
    }
  }
  for (const i of imports) locals.delete(i);
  return { locals, imports, consts, simpleFns, fnNodes };
}

// Dead local functions: never referenced outside their own body (iterated, so a helper used only by a dead function is dead too).
function deadFunctions(ast, A) {
  const dead = new Set();
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, fn] of A.fnNodes) {
      if (dead.has(name)) continue;
      let refs = 0;
      walk.fullAncestor(ast, (node, _st, anc) => {
        if (node.type !== 'Identifier' || node.name !== name) return;
        const parent = anc[anc.length - 2];
        if (parent && ((parent.type === 'FunctionDeclaration' && parent.id === node) || (parent.type === 'VariableDeclarator' && parent.id === node))) return;
        if (parent && parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
        if (parent && parent.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand) return;
        const inside = anc.some(a => a === fn || [...dead].some(d => A.fnNodes.get(d) === a));
        if (!inside) refs++;
      });
      if (!refs) { dead.add(name); changed = true; }
    }
  }
  return dead;
}

// Canonical string of an expression/statement. subst: param name -> canonical string (inlining).
function norm(node, A, subst = new Map(), depth = 0) {
  const N = n => norm(n, A, subst, depth);
  if (!node) return '∅';
  switch (node.type) {
    case 'Identifier':
      if (subst.has(node.name)) return subst.get(node.name);
      if (A.consts.has(node.name)) return norm(A.consts.get(node.name), A);
      return A.locals.has(node.name) ? '$' : node.name;
    case 'Literal':
      if (node.regex) return `/${node.regex.pattern}/${node.regex.flags}`;
      if (typeof node.value === 'number' || typeof node.value === 'bigint') return `#${String(node.value)}`;
      return JSON.stringify(node.value);
    case 'TemplateLiteral': return '`' + node.quasis.map((q, i) => q.value.cooked + (i < node.expressions.length ? '${' + N(node.expressions[i]) + '}' : '')).join('') + '`';
    case 'MemberExpression': return `${N(node.object)}${node.optional ? '?.' : ''}${node.computed ? `[${N(node.property)}]` : `.${node.property.name}`}`;
    case 'ChainExpression': return N(node.expression);
    case 'CallExpression': {
      if (node.callee.type === 'Identifier' && A.simpleFns.has(node.callee.name) && !subst.has(node.callee.name) && depth < 3) {
        const f = A.simpleFns.get(node.callee.name);
        if (f.params.every(p => p.type === 'Identifier')) {
          const s = new Map(f.params.map((p, i) => [p.name, node.arguments[i] ? N(node.arguments[i]) : 'undefined']));
          return norm(f.body, A, s, depth + 1);   // binary/logical/conditional forms carry their own parentheses
        }
      }
      return `${N(node.callee)}${node.optional ? '?.' : ''}(${node.arguments.map(N).join(',')})`;
    }
    case 'NewExpression': return `new ${N(node.callee)}(${node.arguments.map(N).join(',')})`;
    case 'BinaryExpression': case 'LogicalExpression': return `(${N(node.left)} ${node.operator} ${N(node.right)})`;
    case 'UnaryExpression': return `${node.operator}${node.operator.length > 1 ? ' ' : ''}${N(node.argument)}`;
    case 'UpdateExpression': return node.prefix ? `${node.operator}${N(node.argument)}` : `${N(node.argument)}${node.operator}`;
    case 'AssignmentExpression': return `${N(node.left)} ${node.operator} ${N(node.right)}`;
    case 'ConditionalExpression': return `(${N(node.test)} ? ${N(node.consequent)} : ${N(node.alternate)})`;
    case 'ArrayExpression': return `[${node.elements.map(N).join(',')}]`;
    case 'ObjectExpression': return `{${node.properties.map(p => p.type === 'SpreadElement' ? `...${N(p.argument)}` : `${p.computed ? `[${N(p.key)}]` : (p.key.name ?? JSON.stringify(p.key.value))}:${N(p.value)}`).join(',')}}`;
    case 'SpreadElement': return `...${N(node.argument)}`;
    case 'ArrowFunctionExpression': case 'FunctionExpression': return `fn(${node.params.length})`;
    case 'AwaitExpression': return `await ${N(node.argument)}`;
    case 'SequenceExpression': return node.expressions.map(N).join(',');
    case 'ThrowStatement': return `throw ${N(node.argument)}`;
    case 'ReturnStatement': return `return ${N(node.argument)}`;
    case 'ExpressionStatement': return N(node.expression);
    case 'BlockStatement': return `{${node.body.map(N).join(';')}}`;
    default: return node.type;
  }
}

const isRejectValue = a => !a || (a.type === 'Literal' && (a.value === null || a.value === false || typeof a.value === 'string')) || a.type === 'TemplateLiteral';
function rejectKind(stmt) {
  const s = stmt?.type === 'BlockStatement' ? stmt.body[0] : stmt;
  if (!s) return null;
  if (s.type === 'ThrowStatement') return 'throw';
  if (s.type === 'ReturnStatement' && s.argument && isRejectValue(s.argument)) return s.argument.type === 'Literal' && s.argument.value === null ? 'return-null' : s.argument.value === false ? 'return-false' : 'return-problem';
  if (s.type === 'ExpressionStatement' && s.expression.type === 'CallExpression') {
    const c = s.expression.callee, name = c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && !c.computed ? c.property.name : '';
    if (/^(deopt|flag|refuse)/i.test(name)) return `call-${name}`;
  }
  return null;
}

export function guardSites(src) {
  const ast = parse(src);
  const A = analyse(ast);
  const dead = deadFunctions(ast, A);
  const deadNodes = new Set([...dead].map(d => A.fnNodes.get(d)));
  const sites = [];
  walk.fullAncestor(ast, (node, _st, anc) => {
    if (anc.some(a => deadNodes.has(a))) return;
    const line = acorn.getLineInfo(src, node.start).line;
    if (node.type === 'CallExpression') {
      const c = node.callee;
      const name = c.type === 'Identifier' && !A.locals.has(c.name) ? c.name : c.type === 'MemberExpression' && !c.computed ? c.property.name : null;
      if (name && GUARD_NAME.test(name)) sites.push({ kind: 'call', key: `call:${norm(node, A)}`, test: norm(node, A), line });
    }
    if (node.type === 'IfStatement') {
      const rk = rejectKind(node.consequent);
      if (rk) sites.push({ kind: 'if', key: `if:${norm(node.test, A)}=>${rk}`, test: norm(node.test, A), rk, line });
    }
    if (node.type === 'ConditionalExpression') {
      const cr = isRejectValue(node.consequent) && node.consequent, ar = isRejectValue(node.alternate) && node.alternate;
      if ((cr && node.consequent) || (ar && node.alternate)) {
        const which = cr ? 'then' : 'else';
        sites.push({ kind: 'cond', key: `cond:${norm(node.test, A)}=>${which}:${norm(cr ? node.consequent : node.alternate, A).startsWith('"') ? 'problem' : norm(cr ? node.consequent : node.alternate, A)}`, test: norm(node.test, A), rk: which, line });
      }
    }
    if (node.type === 'BinaryExpression' && CMP.has(node.operator)) {
      const lit = n => (n.type === 'Literal' && typeof n.value === 'number') || (n.type === 'Identifier' && A.consts.has(n.name) && typeof A.consts.get(n.name).value === 'number')
        || (n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'Literal');
      if (lit(node.left) || lit(node.right)) sites.push({ kind: 'cmp', key: `cmp:${norm(node, A)}`, test: norm(node, A), line });
    }
  });
  return { sites, dead: [...dead] };
}

const skeleton = key => key.replace(/#-?[\d.e+]+/g, '#').replace(/ (<=|>=|<|>|===|!==|==|!=) /g, ' CMP ');
const nums = s => (s.match(/#-?[\d.e+]+/g) ?? []).map(x => Number(x.slice(1)));
function classify(pKey, cKey) {
  const a = nums(pKey), b = nums(cKey);
  const ops = s => (s.match(/ (<=|>=|<|>|===|!==|==|!=) /g) ?? []).map(x => x.trim());
  const changes = [];
  if (a.join() !== b.join()) changes.push(`literal ${a.join('/')} -> ${b.join('/')}`);
  if (ops(pKey).join() !== ops(cKey).join()) changes.push(`operator ${ops(pKey).join('/')} -> ${ops(cKey).join('/')}`);
  return changes.join('; ') || 'changed';
}

export function diffGuards(parentSrc, childSrc) {
  const P = guardSites(parentSrc), C = guardSites(childSrc);
  const count = list => { const m = new Map(); for (const s of list) m.set(s.key, (m.get(s.key) ?? 0) + 1); return m; };
  const pc = count(P.sites), cc = count(C.sites);
  const unP = [], unC = [];
  for (const s of P.sites) { const k = cc.get(s.key) ?? 0; if (k > 0) cc.set(s.key, k - 1); else unP.push(s); }
  const pc2 = count(P.sites);
  for (const s of C.sites) { const k = pc2.get(s.key) ?? 0; if (k > 0) pc2.set(s.key, k - 1); else unC.push(s); }
  const findings = [], usedC = new Set();
  for (const s of unP) {
    let j = unC.findIndex((c, i) => !usedC.has(i) && c.kind === s.kind && skeleton(c.key) === skeleton(s.key));
    if (j >= 0) { usedC.add(j); findings.push({ type: 'modified', kind: s.kind, line: s.line, parent: s.key, child: unC[j].key, change: classify(s.key, unC[j].key) }); continue; }
    j = unC.findIndex((c, i) => !usedC.has(i) && c.kind === s.kind && c.rk === s.rk && c.test && s.test.includes(c.test) && c.test !== s.test);
    if (j >= 0) { usedC.add(j); findings.push({ type: 'widened (term dropped)', kind: s.kind, line: s.line, parent: s.key, child: unC[j].key }); continue; }
    findings.push({ type: 'deleted', kind: s.kind, line: s.line, parent: s.key });
  }
  const added = unC.filter((_, i) => !usedC.has(i)).map(c => ({ type: 'added', kind: c.kind, line: c.line, child: c.key }));
  return { flagged: findings.length > 0, findings, added, parentSites: P.sites.length, childSites: C.sites.length, deadParent: P.dead, deadChild: C.dead };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [parent, child] = process.argv.slice(2);
  if (!parent || !child) { console.error('usage: node --expose-internals astdiff.mjs <parent solve.mjs> <child solve.mjs>'); process.exit(2); }
  const r = diffGuards(readFileSync(parent, 'utf8'), readFileSync(child, 'utf8'));
  console.log(JSON.stringify(r, null, 1));
  process.exitCode = r.flagged ? 1 : 0;
}
