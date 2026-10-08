// V2 and V0 scans (DESIGN §8, §11.2, §11.3). All code, all deterministic:
//   weakening()    nothing is loosened: no check/node removed, no acceptance predicate dropped, no gate/escalation reduced, no label
//                  declassified, no input schema/oracle/tool/budget change beyond the bound
//   scanLeaks()    a patch must not carry literals of the failing tasks (instructions, code constants, check constants)
//   codeSafety()   added code lines stay inside the sandbox's allowlist
//   quoteInContract()  a relaxation must quote the task's own contract
// Each violation has a stable HEAL_* code. The proposer sees only the code, never the detail.
import { clone, canonical, digest, refsIn, isRef } from './ir.mjs';

export const CODES = Object.freeze(['HEAL_CHECK_REMOVED', 'HEAL_NODE_REMOVED', 'HEAL_ACCEPTANCE_WEAKENED', 'HEAL_GATE_LOOSENED', 'HEAL_RELAX_UNPROVEN', 'HEAL_LITERAL_LEAK', 'HEAL_LOCUS_EXCEEDED',
  'HEAL_FORBIDDEN_FIELD', 'HEAL_GRADER_CHANGED', 'HEAL_CANARY_ACCEPTED', 'HEAL_CODE_UNSAFE']);
const CLASS_ORDER = ['S', 'M', 'L', 'F'];
const v = (code, path, message) => ({ code, path, message });

// path -> node, for the root flow and every nested body
function flat(workflow, prefix = '', out = new Map()) {
  for (const n of workflow.nodes ?? []) { out.set(`${prefix}${n.id}`, n); if (n.body) flat(n.body, `${prefix}${n.id}/`, out); }
  return out;
}
const classIndex = n => CLASS_ORDER.indexOf(n?.model?.class ?? 'M');
const maxIndex = n => CLASS_ORDER.indexOf(n?.model?.maxClass ?? n?.model?.class ?? 'M');

// ---- V2a: nothing is loosened ----------------------------------------------------------------------------------------------
// `proofs` carry what the verifier proved for tighten/relax/patch ops: { type, node, index, verified }.
export function weakening(base, cand, { proofs = [] } = {}) {
  const out = [], bn = flat(base), cn = flat(cand);
  const verified = (type, node, index) => proofs.some(p => p.type === type && p.node === node && (index === undefined || p.index === index) && p.verified === true);
  for (const [path, b] of bn) {
    const c = cn.get(path);
    if (!c) { out.push(v(b.kind === 'assert' || b.kind === 'verify' || (b.checks ?? []).length ? 'HEAL_CHECK_REMOVED' : 'HEAL_NODE_REMOVED', path, `node ${path} was removed`)); continue; }
    // k-sample agreement moves the original node to `<id>__s1`: its checks live on there.
    const holder = cn.get(`${path}__s1`) ?? cn.get(path.replace(/[^/]+$/, m => `${m}__s1`));
    const have = [...(c.checks ?? []), ...(holder?.checks ?? [])].map(canonical);
    (b.checks ?? []).forEach((chk, i) => {
      if (have.includes(canonical(chk))) return;
      if (b.kind === 'agent' && verified('tighten', path, i)) return;
      if (b.kind === 'agent' && verified('relax', path, i)) return;
      out.push(v('HEAL_CHECK_REMOVED', `${path}.checks[${i}]`, `check ${i} of ${path} is gone or changed without a proof`));
    });
    if (b.kind === 'verify' && b.gate !== false && c.gate === false) out.push(v('HEAL_GATE_LOOSENED', path, 'a gating verify was made non-gating'));
    if (b.kind === 'verify' && (b.subject !== undefined) && canonical(b.subject) !== canonical(c.subject)) out.push(v('HEAL_GATE_LOOSENED', path, 'verify subject changed'));
    if (b.kind === 'map' && b.failure !== 'collect' && c.failure === 'collect') out.push(v('HEAL_GATE_LOOSENED', path, 'failure fail_fast -> collect'));
    if (b.onError !== 'continue' && c.onError === 'continue') out.push(v('HEAL_GATE_LOOSENED', path, 'onError became continue'));
    if (b.join !== 'all_resolved' && c.join === 'all_resolved' && c.kind !== 'code') out.push(v('HEAL_GATE_LOOSENED', path, 'join all_success -> all_resolved'));
    if (b.when !== undefined && canonical(b.when) !== canonical(c.when)) out.push(v('HEAL_GATE_LOOSENED', path, 'when condition changed or removed'));
    if (b.kind === 'agent' && c.kind === 'agent') {
      if (classIndex(c) < classIndex(b) || maxIndex(c) < maxIndex(b)) out.push(v('HEAL_GATE_LOOSENED', path, 'model class or maxClass lowered'));
      if (b.model?.id !== c.model?.id && b.model?.id !== undefined) out.push(v('HEAL_FORBIDDEN_FIELD', path, 'model id changed (use classes)'));
      if ((c.escalation?.maxEscalations ?? 2) < (b.escalation?.maxEscalations ?? 2)) out.push(v('HEAL_GATE_LOOSENED', path, 'maxEscalations lowered'));
      if ((c.escalation?.schemaRetries ?? 1) < (b.escalation?.schemaRetries ?? 1)) out.push(v('HEAL_GATE_LOOSENED', path, 'schemaRetries lowered'));
      if (b.escalation?.onCheckFail && c.escalation?.onCheckFail && b.escalation.onCheckFail !== c.escalation.onCheckFail && c.escalation.onCheckFail !== 'fail') out.push(v('HEAL_GATE_LOOSENED', path, 'onCheckFail changed'));
      if (Boolean(b.quarantined) !== Boolean(c.quarantined)) out.push(v('HEAL_FORBIDDEN_FIELD', path, 'quarantine changed'));
      const bl = Object.fromEntries((b.context?.inputs ?? []).filter(i => i.label).map(i => [i.name, i.label]));
      for (const i of c.context?.inputs ?? []) if (bl[i.name] !== undefined && i.label !== bl[i.name]) out.push(v('HEAL_FORBIDDEN_FIELD', `${path}.context.${i.name}`, 'input label changed'));
      for (const name of Object.keys(bl)) if (!(c.context?.inputs ?? []).some(i => i.name === name && i.label === bl[name])) out.push(v('HEAL_FORBIDDEN_FIELD', `${path}.context.${name}`, 'labelled input dropped'));
    }
    if (b.kind === 'assert' && canonical(b.checks) !== canonical(c.checks) && !(b.checks ?? []).every(x => (c.checks ?? []).map(canonical).includes(canonical(x)))) out.push(v('HEAL_CHECK_REMOVED', path, 'assert check removed'));
  }
  const acc = (cand.acceptance ?? []).map(canonical);
  (base.acceptance ?? []).forEach((p, i) => { if (!acc.includes(canonical(p))) out.push(v('HEAL_ACCEPTANCE_WEAKENED', `acceptance[${i}]`, 'an acceptance predicate was dropped or changed')); });
  // forbidden fields
  if (canonical(base.inputSchema ?? null) !== canonical(cand.inputSchema ?? null)) out.push(v('HEAL_FORBIDDEN_FIELD', 'inputSchema', 'inputSchema changed'));
  if (cand.oracle !== undefined && canonical(cand.oracle) !== canonical(base.oracle ?? null)) out.push(v('HEAL_FORBIDDEN_FIELD', 'oracle', 'oracle declaration changed'));
  for (const k of ['id', 'schemaVersion', 'domain']) if (base[k] !== cand[k]) out.push(v('HEAL_FORBIDDEN_FIELD', k, `${k} changed`));
  for (const [key, label] of Object.entries(base.labels ?? {})) if (cand.labels?.[key] !== label) out.push(v('HEAL_FORBIDDEN_FIELD', `labels.${key}`, 'label declassified or removed'));
  for (const [path, c] of cn) {
    const b = bn.get(path);
    if (c.kind === 'task' && (!b || b.tool !== c.tool)) out.push(v('HEAL_FORBIDDEN_FIELD', path, 'a tool/capability was added or changed'));
  }
  const bb = base.budget ?? {}, cb = cand.budget ?? {};
  if (bb.maxCost !== undefined && (cb.maxCost ?? Infinity) > bb.maxCost * 1.25 + 1e-9) out.push(v('HEAL_FORBIDDEN_FIELD', 'budget.maxCost', 'budget raised beyond 1.25x'));
  if (cb.maxDurationMs > bb.maxDurationMs * 1.25) out.push(v('HEAL_FORBIDDEN_FIELD', 'budget.maxDurationMs', 'budget raised beyond 1.25x'));
  if (cb.maxSteps > Math.max(bb.maxSteps * 1.25, cn.size * 4)) out.push(v('HEAL_FORBIDDEN_FIELD', 'budget.maxSteps', 'budget raised beyond the bound'));
  if (cb.maxConcurrency > bb.maxConcurrency) out.push(v('HEAL_FORBIDDEN_FIELD', 'budget.maxConcurrency', 'concurrency raised'));
  return out;
}

// ---- relaxation needs the task's own words -----------------------------------------------------------------------------------
const squash = s => String(s).toLowerCase().replace(/[`*_>#|]/g, ' ').replace(/\s+/g, ' ').trim();
export function quoteInContract(quote, texts) {
  const q = squash(quote);
  return q.length >= 20 && texts.some(t => squash(t).includes(q));
}
export function taskTexts(task) {
  const out = [task.prompt ?? ''];
  const walk = x => { if (typeof x === 'string') out.push(x); else if (x && typeof x === 'object') Object.values(x).forEach(walk); };
  walk(task.inputs); walk(task.files);
  return out;
}

// ---- code safety (added lines only) -------------------------------------------------------------------------------------------
const PY_ALLOWED = new Set(['re', 'json', 'math', 'ast', 'types', 'collections', 'itertools', 'functools', 'string', 'typing', 'difflib', 'textwrap', 'traceback', 'sys', 'dataclasses', 'enum', 'operator', 'datetime', 'decimal', 'fractions', 'statistics', 'unicodedata']);
const PY_BAD = /(?<![.\w])(?:__import__|eval\s*\(|exec\s*\(|compile\s*\(|open\s*\()|\b(?:subprocess|socket|importlib|ctypes|shutil|pickle|urllib|requests)\b|\bos\./;
const JS_BAD = /(?<![.\w])(?:require\s*\(|import\s*\(|fetch\s*\(|eval\s*\(|Function\s*\()|\b(?:process\.|child_process|node:fs|node:net|node:http|new\s+Function|globalThis|WebAssembly)/;
const DUNDER_OK = new Set(['__init__', '__name__', '__dict__', '__file__', '__traceback__', '__enter__', '__exit__', '__eq__', '__main__', '__str__', '__repr__']);
export function codeSafety(addedText, lang) {
  const out = [];
  for (const line of String(addedText).split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('//')) continue;
    if (lang === 'python') {
      const imp = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w., ]+))/.exec(line);
      if (imp) for (const m of (imp[1] ?? imp[2]).split(',').map(s => s.trim().split(/[ .]/)[0])) if (m && !PY_ALLOWED.has(m)) out.push(`import ${m}`);
      if (PY_BAD.test(line)) out.push(t.slice(0, 60));
      for (const d of line.match(/__\w+__/g) ?? []) if (!DUNDER_OK.has(d)) out.push(`dunder ${d}`);
    } else if (JS_BAD.test(line)) out.push(t.slice(0, 60));
  }
  return out;
}

// ---- what a patch adds -----------------------------------------------------------------------------------------------------------
const lines = s => String(s ?? '').split('\n');
function literalsOf(value, out = []) {
  if (typeof value === 'string') out.push(value); else if (typeof value === 'number') out.push(String(value));
  else if (Array.isArray(value)) value.forEach(x => literalsOf(x, out));
  else if (value && typeof value === 'object') for (const [k, x] of Object.entries(value)) { if (k === '$ref') continue; literalsOf(x, out); }
  return out;
}
export function addedContent(base, cand) {
  const out = [], bn = flat(base), cn = flat(cand);
  for (const [path, n] of cn) {
    // A k-sample sibling (`<id>__s1`, `__s2`, `__esc`) is a copy of base node `<id>`: what it repeats is not added by the patch
    // (live run 1, 2026-10-08: the clone's whole `returns` was scanned as new and rule 3 fired on the schema's own enum values).
    const b = bn.get(path) ?? bn.get(path.replace(/__(?:s\d+|esc)$/, ''));
    for (const field of ['instructions', 'source', 'description']) {
      if (typeof n[field] !== 'string') continue;
      const old = new Set(lines(b?.[field]).map(l => l.trim()));
      const added = lines(n[field]).filter(l => !old.has(l.trim())).join('\n');
      if (added.trim()) out.push({ path: `${path}.${field}`, kind: field === 'source' ? 'code' : 'text', lang: n.lang, text: added });
    }
    for (const key of ['checks', 'returns', 'when', 'args']) {
      if (n[key] === undefined) continue;
      const old = new Set(literalsOf(b?.[key]));
      const added = literalsOf(n[key]).filter(s => !old.has(s));
      if (added.length) out.push({ path: `${path}.${key}`, kind: 'constants', text: added.join('\n') });
    }
  }
  const oldAcc = new Set(literalsOf(base.acceptance)), added = literalsOf(cand.acceptance).filter(s => !oldAcc.has(s));
  if (added.length) out.push({ path: 'acceptance', kind: 'constants', text: added.join('\n') });
  return out;
}

// ---- literal-leak scanner (DESIGN §11.3) -----------------------------------------------------------------------------------------
const STOP = new Set('a an and are as at be by for from has have in is it its of on or that the their this to was were will with not no if then than but can may must each per any all one two into out up so'.split(' '));
const tokens = s => String(s).toLowerCase().match(/[a-z0-9]+/g) ?? [];
const trigramsOf = toks => { const out = new Set(); for (let i = 0; i + 3 <= toks.length; i++) { const g = toks.slice(i, i + 3); if (g.filter(t => !STOP.has(t) && t.length > 1).length >= 2 && g.join(' ').length >= 12) out.add(g.join(' ')); } return out; };
const numbersOf = s => new Set(String(s).match(/\d{3,}/g) ?? []);

// The index is built by the scanner, never shown to the proposer: failing tasks' prompts/inputs/files, their recorded node
// outputs, and the bed's hidden truth for them. `publicText` = family description + schemas + text common to the family.
export function buildLeakIndex({ tasks = [], outputs = [], truthStrings = [], truthPairs = [], publicTexts = [], baseWorkflow = null, familyConstant = () => false }) {
  const taskText = [...tasks.flatMap(taskTexts), ...outputs.map(o => typeof o === 'string' ? o : JSON.stringify(o)), ...truthStrings].join('\n');
  const exempt = [...publicTexts, baseWorkflow ? JSON.stringify(baseWorkflow) : ''].join('\n');
  return { tri: trigramsOf(tokens(taskText)), exemptTri: trigramsOf(tokens(exempt)), nums: numbersOf(taskText), exemptNums: numbersOf(exempt), tokens: new Set(tokens(taskText)), exemptTokens: new Set(tokens(exempt)),
    pairs: truthPairs, familyConstant };
}
export function scanLeaks(base, cand, index, { maxTable = 8 } = {}) {
  const out = [];
  for (const a of addedContent(base, cand)) {
    const toks = tokens(a.text);
    // rule 1: a run of task text (three consecutive words, at least two of them content words, 12+ characters) that is not already
    // in the base workflow or the public description
    for (const g of trigramsOf(toks)) if (index.tri.has(g) && !index.exemptTri.has(g)) { out.push({ code: 'HEAL_LITERAL_LEAK', rule: 1, path: a.path, sample: g.slice(0, 40), message: 'text copied from a failing task' }); break; }
    // rule 2: a number of 3+ digits that is a value of the failing tasks
    for (const n of numbersOf(a.text)) if (index.nums.has(n) && !index.exemptNums.has(n)) { out.push({ code: 'HEAL_LITERAL_LEAK', rule: 2, path: a.path, sample: n, message: 'numeric literal from a failing task' }); break; }
    // rule 3: an identifier next to the value the hidden truth assigns it (unless it holds for the whole family)
    const low = squash(a.text);
    for (const p of index.pairs) {
      const id = squash(p.id), val = squash(p.value), at = [...low.matchAll(new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].map(m => m.index);
      if (at.some(i => low.slice(Math.max(0, i - 40), i + id.length + 40).includes(val)) && !index.familyConstant(p)) { out.push({ code: 'HEAL_LITERAL_LEAK', rule: 3, path: a.path, sample: `${p.id}..${p.value}`, message: 'a task variable and its hidden value appear together' }); break; }
    }
    // rule 4: a code literal table drawn from the index
    if (a.kind === 'code') {
      const lits = [...a.text.matchAll(/(['"])((?:\\.|(?!\1).){3,})\1|\b(\d{3,})\b/g)].map(m => (m[2] ?? m[3]).toLowerCase());
      const drawn = lits.filter(l => (index.tokens.has(l) || index.nums.has(l)) && !index.exemptTokens.has(l) && !index.exemptNums.has(l));
      if (drawn.length > maxTable) out.push({ code: 'HEAL_LITERAL_LEAK', rule: 4, path: a.path, sample: `${drawn.length} literals`, message: 'a literal table drawn from a failing task' });
    }
  }
  return out;
}

export function unsafeAdditions(base, cand) {
  const out = [];
  for (const a of addedContent(base, cand)) if (a.kind === 'code') for (const s of codeSafety(a.text, a.lang ?? 'js')) out.push(v('HEAL_CODE_UNSAFE', a.path, s));
  return out;
}
