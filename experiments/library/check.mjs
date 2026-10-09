// check.mjs: the composition checker (LIBRARY §6; L1-PATTERNS §9; BUILD-ORDER step 4; LIBRARY-TESTS T3).
//
// Static checks, at S7 and before every registration, over a composed tree of assembled solvers. The call host checks the
// same things at run time (experiments/jit/call-host.mjs: recursion, depth, effects, input-schema, outside-profile,
// BUDGET_TOO_SMALL, budget-exceeds-parent); this checker finds them before anything runs. Pure code, $0, no network.
//
//   checkTree(tree, { registry?, maxDepth?, hardDepth?, budgetFloorUsd? }) -> { ok, findings, unchecked, edges }
//
// tree = { root: '<node name>', nodes: { <name>: node }, effectPlan?: [{ binding, target, writer }] }
// node = { budgetUsd, effects?: 'none', hash?: 'sha256:…' (once registered), parts: [{ card, slots }] (card = loadCard()),
//          contract?: { input, output, taskTemplate? } (required for a node that is called),
//          samples?: [task {prompt, inputs}] (for the root: tasks it will see; for a child: the accepted inputs its
//          profile is learned from), writes?: [state key | file path] }
// A call target in a slot is '@node:<name>' (a node of this tree), or a literal library hash resolved through `registry`
// (store.mjs openLibrary().registry or call-host createRegistry: get(hash) -> {contract, profile, effects, minBudgetUsd,
// revoked}). Anything else in a hash slot is MUTABLE_TARGET (assemble.mjs checkSlot).
//
// Findings: { code, node, part?, card?, slot?, detail }. Codes: the slot codes of assemble.mjs (SLOT_*, UNBOUNDED,
// MUTABLE_TARGET), LIBRARY §6 (CALL_TYPE, EFFECT_IN_SOLVER, BUDGET_TREE, ONE_WRITER, DEPTH, RECURSION, MUTABLE_TARGET,
// PROFILE_UNREACHABLE) and L1-PATTERNS §9 (JUDGE_NO_CHECK, ENUM_NO_NONE, BRANCH_ON_TEXT, UNBOUNDED, VERIFY_NOT_GATING,
// NO_CONSERVATION, SILENT_DROP, EFFECT_IN_SOLVER, MAP_NO_ECHO_CHECK, REASONING_ON_EXTRACTION, ONE_WRITER,
// CREDENTIAL_LITERAL). `unchecked` lists what could not be shown either way (a call argument with no declared type).
//
// Per-edge order follows the host's (FLOW-V3 §2.1): recursion, depth, effects, input type, profile, budget. An edge that
// fails recursion or depth is not checked further (the host would refuse it before typing it).
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { checkSlots, withDefaults, renderValue, HASH_RE } from './assemble.mjs';
import { subsumes, validate } from './schema.mjs';
import { learnProfile, checkProfile } from '../jit/profile.mjs';
import { DEFAULT_MAX_DEPTH, HARD_MAX_DEPTH, DEFAULT_BUDGET_FLOOR_USD } from '../jit/call-host.mjs';

export const CODES = Object.freeze(['CALL_TYPE', 'EFFECT_IN_SOLVER', 'BUDGET_TREE', 'ONE_WRITER', 'DEPTH', 'RECURSION', 'MUTABLE_TARGET',
  'PROFILE_UNREACHABLE', 'JUDGE_NO_CHECK', 'ENUM_NO_NONE', 'BRANCH_ON_TEXT', 'UNBOUNDED', 'VERIFY_NOT_GATING', 'NO_CONSERVATION',
  'SILENT_DROP', 'MAP_NO_ECHO_CHECK', 'REASONING_ON_EXTRACTION', 'CREDENTIAL_LITERAL']);
export const NONE_LIKE = /^(none|none-of-these|no-match|nomatch|undecidable|unexplained|unsure|unknown|other|n\/a)$/i;
export const REASONING_FIELDS = /^(reasoning|rationale|thoughts?|thinking|chain_of_thought|chainOfThought|cot|explanation|scratchpad)$/i;
export const CITATION_FIELDS = /^(quote|quotes|evidence|citation|cite|span|excerpt)$/i;
// Effects a pure solver body must not reach for (the forbidden-identifier lint of assemble.mjs already refuses process,
// require, import, eval, timers, ...). 'B:' names an L3 binding: bindings are envelope-only.
export const EFFECT_RE = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|navigator|sendBeacon|child_process|execSync|spawnSync|writeFileSync|appendFileSync|unlinkSync|rmSync|localStorage|indexedDB)\b|['"]B:[\w.-]+['"]/;
export const LOOP_RE = /\bwhile\s*\(|\bdo\s*\{|\bfor\s*\(\s*[^;)]*;\s*;/;
// Obvious credential shapes only (provider key prefixes, bearer tokens, a secret-named key with a literal value). The
// owner rule is stricter (credentials only from env vars through an L3 binding); this is the literal tripwire.
export const CREDENTIAL_RE = /\b(sk-(?:ant-)?[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,})|\bBearer\s+[A-Za-z0-9._~+/-]{16,}|\b(password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b\s*['"]?\s*[:=]\s*['"][^'"\s]{6,}['"]/i;

const sha = s => createHash('sha256').update(s).digest('hex');
const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
const NODE_REF = /^@node:(.+)$/;
export const placeholderHash = name => `sha256:${sha(`node:${name}`)}`;
const stripStrings = src => String(src).replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
const stripComments = src => String(src).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

// A fn:pure body: its parameter names and its body text (strings kept; use stripStrings for token scans).
export function fnParts(src) {
  const s = String(src).trim();
  let m = s.match(/^(?:async\s+)?function\s*[\w$]*\s*\(([^)]*)\)\s*\{([\s\S]*)\}\s*$/);
  if (m) return { params: idents(m[1]), body: m[2] };
  m = s.match(/^\(([^)]*)\)\s*=>\s*([\s\S]*)$/) ?? s.match(/^([A-Za-z_$][\w$]*)\s*=>\s*([\s\S]*)$/);
  if (m) return { params: idents(m[1]), body: m[2] };
  return { params: [], body: s };
}
const idents = s => [...new Set((String(s).replace(/=[^,]*/g, '').match(/[A-Za-z_$][\w$]*/g) ?? []))];
const usesParam = (src, name) => new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(stripStrings(fnParts(src).body));

// Run a fn:pure slot on JSON arguments in an empty context (no globals, 1 s): only for slots that passed lintFn.
export function runPure(src, args, timeout = 1000) {
  const ctx = vm.createContext(Object.create(null));
  ctx.__a = JSON.stringify(args);
  return JSON.parse(vm.runInContext(`JSON.stringify((${src}\n)(...JSON.parse(__a)) ?? null)`, ctx, { timeout }));
}

// Every judge value in a part's slots: top-level judge slots and judge fields of list items (P01 stages).
function judgesOf(card, values) {
  const out = [];
  for (const d of card.slots) {
    const v = values[d.name];
    if (v == null) continue;
    if (d.type === 'judge' && isObj(v)) out.push({ slot: d.name, at: d.name, value: v });
    if (d.type === 'list' && Array.isArray(v)) v.forEach((item, i) => { for (const [k, sub] of Object.entries(d.item ?? {})) if (sub.type === 'judge' && isObj(item?.[k])) out.push({ slot: d.name, at: `${d.name}[${i}].${k}`, value: item[k] }); });
  }
  return out;
}
// Every fn:pure source in a part's slots (fn slots, judge prompt/check, map handler fns, list item fns).
function fnsOf(card, values) {
  const out = [];
  const judgeFns = (at, j) => { for (const k of ['prompt', 'check']) if (typeof j?.[k] === 'string') out.push({ at: `${at}.${k}`, src: j[k] }); };
  for (const d of card.slots) {
    const v = values[d.name];
    if (v == null) continue;
    if (d.type === 'fn' && typeof v === 'string') out.push({ slot: d.name, at: d.name, src: v });
    else if (d.type === 'judge') judgeFns(d.name, v);
    else if (d.type === 'map' && isObj(v)) for (const [k, x] of Object.entries(v)) { if (typeof x === 'string' && !x.startsWith('sha256:') && !x.startsWith('@')) out.push({ slot: d.name, at: `${d.name}.${k}`, src: x }); }
    else if (d.type === 'list' && Array.isArray(v)) v.forEach((item, i) => { for (const [k, sub] of Object.entries(d.item ?? {})) {
      if (sub.type === 'fn' && typeof item?.[k] === 'string') out.push({ slot: d.name, at: `${d.name}[${i}].${k}`, src: item[k] });
      if (sub.type === 'judge') judgeFns(`${d.name}[${i}].${k}`, item?.[k]);
    } });
  }
  return out;
}
// Every string anywhere in the slot values (credential scan).
const stringsOf = (v, at = '') => typeof v === 'string' ? [{ at, s: v }] : Array.isArray(v) ? v.flatMap((x, i) => stringsOf(x, `${at}[${i}]`))
  : isObj(v) ? Object.entries(v).flatMap(([k, x]) => [{ at: `${at}.${k}`, s: k }, ...stringsOf(x, at ? `${at}.${k}` : k)]) : [];
// Schema walk: [{path, schema}] for every subschema.
const walk = (s, p = '') => !isObj(s) ? [] : [{ path: p, schema: s }, ...Object.entries(s.properties ?? {}).flatMap(([k, x]) => walk(x, `${p}.${k}`)), ...(isObj(s.items) ? walk(s.items, `${p}[]`) : [])];
const textFieldsOf = s => walk(s).filter(w => w.path && (w.schema.type === 'string' || (Array.isArray(w.schema.type) && w.schema.type.includes('string'))) && !w.schema.enum && w.schema.const === undefined).map(w => w.path.split('.').pop().replace('[]', ''));
const ruleFor = (card, code, key, name) => (card.rules ?? []).find(r => r.code === code && r[key] === name);

// Call sites a part declares through its card's CALLS rule: [{slot, at, target, budgetUsd, concurrency, argSchema,
// reads, onRefuse, argsFn}]. Targets are the raw slot strings ('@node:x', a hash, or a non-literal already refused).
export function callSitesOf(card, values) {
  const sites = [];
  for (const r of (card.rules ?? []).filter(r => r.code === 'CALLS')) {
    const conc = r.concurrencySlot ? values[r.concurrencySlot] ?? 1 : 1;
    if (r.hashSlot) sites.push({ slot: r.hashSlot, at: r.hashSlot, target: values[r.hashSlot], budgetUsd: values[r.budgetSlot], concurrency: conc,
      argSchema: r.argSlot ? values[r.argSlot] ?? null : null, reads: r.readsSlot ? values[r.readsSlot] ?? null : null,
      onRefuse: r.onRefuseSlot ? values[r.onRefuseSlot] ?? 'deopt' : 'deopt', argsFn: r.argsSlot ? values[r.argsSlot] : null });
    if (r.mapSlot && isObj(values[r.mapSlot])) for (const [k, v] of Object.entries(values[r.mapSlot]))
      if (typeof v === 'string' && (v.startsWith('sha256:') || v.startsWith('@'))) sites.push({ slot: r.mapSlot, at: `${r.mapSlot}.${k}`, target: v, budgetUsd: r.budgetUsd, concurrency: conc, argSchema: null, reads: null, onRefuse: 'deopt', argsFn: null });
    if (r.listSlot && Array.isArray(values[r.listSlot])) values[r.listSlot].forEach((s, i, all) => {
      if (s?.kind !== r.kind) return;
      sites.push({ slot: r.listSlot, at: `${r.listSlot}[${i}]`, target: s.hash, budgetUsd: s.budgetUsd, concurrency: 1,
        argSchema: r.argFromPrevOut && i > 0 ? all[i - 1].out ?? null : null, reads: s.out ?? null, onRefuse: 'deopt', argsFn: null });
    });
  }
  return sites;
}

// The per-part checks: slots, then the L1 §9 universal codes (generic, plus each card's declared rules).
export function checkPart(card, slots, { samples = [], first = false } = {}) {
  const f = [], add = (code, slot, detail) => f.push({ code, card: card.id, ...(slot ? { slot } : {}), detail });
  // Node refs are tree-level targets: the slot check sees a literal placeholder hash for them.
  const literal = JSON.parse(JSON.stringify(slots ?? {}), (k, v) => (typeof v === 'string' && NODE_REF.test(v) ? placeholderHash(v.slice(6)) : v));
  f.push(...checkSlots(card, literal));
  const values = withDefaults(card, slots ?? {});
  const fns = fnsOf(card, values), judges = judgesOf(card, values);

  // EFFECT_IN_SOLVER and UNBOUNDED over fn bodies and the skeleton (helpers are reviewed library code, not scanned).
  for (const fn of fns) {
    const code = stripStrings(fn.src);
    if (EFFECT_RE.test(code) || /['"]B:[\w.-]+['"]/.test(fn.src)) add('EFFECT_IN_SOLVER', fn.at, `fn body reaches for an effect (${(fn.src.match(EFFECT_RE) ?? ['B:'])[0]}); effects belong in the envelope`);
    if (LOOP_RE.test(code)) add('UNBOUNDED', fn.at, 'a while / do / for(;;) loop in a fn:pure body has no literal cap');
  }
  const skel = stripStrings(stripComments(card.skeleton ?? ''));
  if (EFFECT_RE.test(skel)) add('EFFECT_IN_SOLVER', null, `${card.id} skeleton reaches for an effect`);
  if (LOOP_RE.test(skel)) add('UNBOUNDED', null, `${card.id} skeleton has an uncapped loop`);

  // CREDENTIAL_LITERAL over every string in the slot values.
  for (const { at, s } of stringsOf(values)) if (CREDENTIAL_RE.test(s)) add('CREDENTIAL_LITERAL', at.split(/[.[]/)[0] || null, `a credential-shaped literal at ${at}; credentials come from env vars through an L3 binding`);

  // Judges: JUDGE_NO_CHECK, ENUM_NO_NONE, REASONING_ON_EXTRACTION, MAP_NO_ECHO_CHECK.
  for (const j of judges) {
    const skCheck = ruleFor(card, 'JUDGE_NO_CHECK', 'judgeSlot', j.slot)?.skeletonCheck === true;
    const skSchema = ruleFor(card, 'JUDGE_NO_CHECK', 'judgeSlot', j.slot)?.skeletonSchema ?? null;
    const schema = j.value.schema ?? skSchema;
    const cites = walk(schema).some(w => CITATION_FIELDS.test(w.path.split('.').pop().replace('[]', '')));
    if (cites && !skCheck && typeof j.value.check !== 'string') add('JUDGE_NO_CHECK', j.at, 'the judge answer cites its input but has no code check (quote present, id echoed)');
    const skNone = ruleFor(card, 'ENUM_NO_NONE', 'judgeSlot', j.slot)?.skeletonNone;
    if (!skNone) for (const w of walk(schema)) if (Array.isArray(w.schema.enum) && !w.schema.enum.some(e => e === null || NONE_LIKE.test(String(e))))
      add('ENUM_NO_NONE', j.at, `judged enum ${w.path || '/'} [${w.schema.enum.join(', ')}] has no none / undecidable member`);
    for (const w of walk(schema)) if (w.path && REASONING_FIELDS.test(w.path.split('.').pop().replace('[]', ''))) add('REASONING_ON_EXTRACTION', j.at, `schema field ${w.path} asks for reasoning in an extraction`);
    const echo = ruleFor(card, 'MAP_NO_ECHO_CHECK', 'judgeSlot', j.slot);
    if (echo) {
      const [arr, field] = echo.echo.split('[].');
      const items = schema?.properties?.[arr]?.items;
      if (!items || !(items.required ?? []).includes(field) || !items.properties?.[field]) add('MAP_NO_ECHO_CHECK', j.at, `a judge over a batch must echo ${echo.echo} (required in its schema) so the batch check can match answers to items`);
    }
  }
  // Enum slots that must carry a no-match member.
  for (const r of (card.rules ?? []).filter(r => r.code === 'ENUM_NO_NONE' && r.enumSlot)) {
    const v = values[r.enumSlot];
    if (Array.isArray(v) && !v.includes(r.mustInclude)) add('ENUM_NO_NONE', r.enumSlot, `${r.enumSlot} must include '${r.mustInclude}'`);
  }
  // BRANCH_ON_TEXT: a control fn reading a free-text field of a judge answer.
  for (const r of (card.rules ?? []).filter(r => r.code === 'BRANCH_ON_TEXT' && r.fnSlot)) {
    const src = values[r.fnSlot];
    if (typeof src !== 'string') continue;
    const fields = new Set(r.textFields ?? []);
    for (const judgeSlot of Object.values(r.reads ?? {})) for (const t of textFieldsOf(values[judgeSlot]?.schema)) fields.add(t);
    const code = stripStrings(src);
    const hit = [...fields].find(t => new RegExp(`\\.${t}\\b`).test(code) || new RegExp(`\\[\\s*['"]${t}['"]\\s*\\]`).test(src));
    if (hit) add('BRANCH_ON_TEXT', r.fnSlot, `${r.fnSlot} reads the free-text field '${hit}' of a judge answer; control flow reads answers only through an enum`);
  }
  // VERIFY_NOT_GATING: a verifier / invariant fn that ignores its inputs is constant.
  for (const r of (card.rules ?? []).filter(r => r.code === 'VERIFY_NOT_GATING' && r.fnSlot)) {
    const src = values[r.fnSlot];
    if (typeof src !== 'string') continue;
    const { params } = fnParts(src);
    if (!params.some(p => usesParam(src, p))) add('VERIFY_NOT_GATING', r.fnSlot, `${r.fnSlot} reads none of its inputs, so it cannot fail (constant verifier)`);
  }
  // NO_CONSERVATION: the card's conservation slot must be filled.
  for (const r of (card.rules ?? []).filter(r => r.code === 'NO_CONSERVATION' && r.requireSlot)) if (values[r.requireSlot] == null) add('NO_CONSERVATION', r.requireSlot, `${card.id} transforms a collection without a count or sum invariant (${r.requireSlot})`);
  // SILENT_DROP: a filter that returns a bare false drops without a reason code (static, then on samples).
  for (const r of (card.rules ?? []).filter(r => r.code === 'SILENT_DROP' && r.fnSlot)) {
    const src = values[r.fnSlot];
    if (typeof src !== 'string') continue;
    let why = new RegExp(`\\b${r.forbidReturn}\\b`).test(stripStrings(src)) ? `returns the literal ${r.forbidReturn}` : null;
    const itemsDef = card.slots.find(d => d.name === 'ITEMS' && d.type === 'path');
    if (!why && first && itemsDef && values.ITEMS) for (const t of samples) {
      let items = []; try { items = runPure(renderValue(itemsDef, values.ITEMS).slice(1, -1), [t, t.inputs]) ?? []; } catch { items = []; }
      for (const it of Array.isArray(items) ? items : []) { let out; try { out = runPure(src, [it]); } catch { continue; } if (out !== true && (typeof out !== 'string' || !out)) { why = `returns ${JSON.stringify(out)} for a sample item`; break; } }
      if (why) break;
    }
    if (why) add('SILENT_DROP', r.fnSlot, `${r.fnSlot} ${why}: every drop needs a reason code`);
  }
  return { findings: f, sites: callSitesOf(card, values), values };
}

// The whole tree.
export function checkTree(tree, { registry = null, maxDepth = DEFAULT_MAX_DEPTH, hardDepth = HARD_MAX_DEPTH, budgetFloorUsd = DEFAULT_BUDGET_FLOOR_USD } = {}) {
  const findings = [], unchecked = [], edges = [], seen = new Set();
  const add = (code, node, extra) => { const f = { code, node, ...extra }; const k = JSON.stringify(f); if (!seen.has(k)) { seen.add(k); findings.push(f); } };
  const nodes = tree.nodes ?? {};
  if (!nodes[tree.root]) throw new Error(`check: root ${tree.root} is not a node`);

  // Per node: part checks and call sites (computed once).
  const info = {};
  for (const [name, n] of Object.entries(nodes)) {
    const parts = (n.parts ?? []).map((p, i) => ({ i, card: p.card, ...checkPart(p.card, p.slots, { samples: n.samples ?? [], first: i === 0 }) }));
    for (const p of parts) for (const f of p.findings) add(f.code, name, { part: p.i, ...f });
    if (n.effects != null && n.effects !== 'none') add('EFFECT_IN_SOLVER', name, { detail: `node effects '${n.effects}': every node in a solver tree is effects: 'none'` });
    const profile = n.contract && (n.samples ?? []).length && name !== tree.root ? learnProfile(n.samples.map(s => ({ prompt: n.contract.taskTemplate ?? '', inputs: s.inputs ?? s }))) : null;
    info[name] = { parts, profile, sites: parts.flatMap(p => p.sites.map(s => ({ ...s, part: p.i, card: p.card.id }))) };
  }

  // A callee: a tree node or a registry entry.
  const callee = target => {
    if (typeof target !== 'string') return null;
    const m = target.match(NODE_REF);
    if (m) { const n = nodes[m[1]]; return n ? { kind: 'node', name: m[1], key: `node:${m[1]}`, hash: n.hash ?? null, contract: n.contract ?? null, effects: n.effects ?? 'none', profile: info[m[1]].profile, minBudgetUsd: n.minBudgetUsd ?? null, budgetUsd: n.budgetUsd } : { kind: 'missing', key: target }; }
    if (!HASH_RE.test(target)) return null;   // non-literal: MUTABLE_TARGET from the slot check
    const e = registry?.get?.(target);
    if (!e) return { kind: 'missing', key: target };
    return { kind: 'hash', key: target, hash: target, contract: e.contract ?? null, effects: e.effects ?? 'none', profile: e.profile ?? null, minBudgetUsd: e.minBudgetUsd ?? null, revoked: !!e.revoked };
  };

  // DFS over the call graph from the root along each path: ancestors (names and hashes), depth, effective budget.
  const visit = (name, depth, ancestors, budget) => {
    const n = nodes[name], me = info[name];
    const effective = Math.min(n.budgetUsd ?? Infinity, budget);
    const reserved = me.sites.reduce((s, x) => s + (typeof x.budgetUsd === 'number' ? x.budgetUsd * (Number.isInteger(x.concurrency) ? x.concurrency : 1) : 0), 0);
    if (me.sites.length && !(reserved < effective)) add('BUDGET_TREE', name, { detail: `child reservations ${round(reserved)} (budget × concurrency per site) are not below this node's budget ${round(effective)}` });
    for (const s of me.sites) {
      const c = callee(s.target);
      if (!c) continue;
      const at = { part: s.part, card: s.card, slot: s.slot };
      edges.push({ from: name, at: s.at, to: c.key, depth: depth + 1 });
      if (c.kind === 'missing') { add('CALL_TYPE', name, { ...at, detail: `${s.at}: callee ${c.key} is not in the tree or the library; there is no contract to check against` }); continue; }
      const anc = [...ancestors, `node:${name}`, ...(n.hash ? [n.hash] : [])];
      if (anc.includes(c.key) || (c.hash && anc.includes(c.hash))) { add('RECURSION', name, { ...at, detail: `${s.at}: ${c.key} is on its own ancestor chain (${anc.filter(a => a.startsWith('node:')).map(a => a.slice(5)).join(' -> ')})` }); continue; }
      if (depth + 1 > maxDepth) { add('DEPTH', name, { ...at, detail: `${s.at}: call depth ${depth + 1} > ${maxDepth}${depth + 1 > hardDepth ? ` (over the hard ceiling ${hardDepth})` : ''}` }); continue; }
      if (c.revoked) add('CALL_TYPE', name, { ...at, detail: `${s.at}: callee ${c.key.slice(0, 20)}… is revoked` });
      if (c.effects !== 'none') add('EFFECT_IN_SOLVER', name, { ...at, detail: `${s.at}: callee has effects '${c.effects}'; effects run in the envelope only` });
      // Types: the argument conforms to the callee's input; what the caller reads is guaranteed by the callee's output.
      if (!c.contract) add('CALL_TYPE', name, { ...at, detail: `${s.at}: callee ${c.key} has no contract` });
      else {
        if (s.argSchema) { const r = subsumes(s.argSchema, c.contract.input); if (!r.ok) add('CALL_TYPE', name, { ...at, detail: `${s.at}: argument type not within the callee's contract.input: ${r.why}` }); }
        else if (c.contract.input) unchecked.push({ node: name, at: s.at, what: 'argument type (the site declares none; checked at run time by the host: input-schema)' });
        if (s.reads) { const r = subsumes(c.contract.output, s.reads); if (!r.ok) add('CALL_TYPE', name, { ...at, detail: `${s.at}: the callee's contract.output does not guarantee what the caller reads: ${r.why}` }); }
      }
      // Samples: arguments computed from the root's (or this node's) sample tasks, where the site's args are pure code
      // over the task (P54 PARTS in the first part of the node).
      if (s.argsFn && s.part === 0 && (n.samples ?? []).length) {
        for (const t of n.samples) {
          let args; try { args = runPure(s.argsFn, [t, t.inputs]); } catch (e) { add('CALL_TYPE', name, { ...at, detail: `${s.at}: computing the call arguments on a sample failed: ${String(e.message).slice(0, 120)}` }); continue; }
          for (const a of Array.isArray(args) ? args : []) {
            const input = a?.input ?? a;
            if (c.contract?.input) { const v = validate(c.contract.input, input); if (!v.valid) add('CALL_TYPE', name, { ...at, detail: `${s.at}: a sample argument fails the callee's contract.input: ${v.errors.join('; ')}` }); }
            if (c.profile) {
              const p = checkProfile(c.profile, { prompt: c.contract?.taskTemplate ?? '', inputs: input });
              if (p.novel && s.onRefuse !== 'value') add('PROFILE_UNREACHABLE', name, { ...at, detail: `${s.at}: a sample argument is outside the callee's profile (score ${round(p.score)}) and the site has no fallback (onRefuse 'deopt'; 'interpret-child' is not in flow-v3 slice 1)` });
            }
          }
        }
      }
      // Budgets: every child at or above its floor; recurse with the site's reservation as the child's budget.
      const floor = Math.max(budgetFloorUsd, c.minBudgetUsd ?? 0);
      if (typeof s.budgetUsd !== 'number' || s.budgetUsd < floor) add('BUDGET_TREE', name, { ...at, detail: `${s.at}: child budget ${s.budgetUsd} is below the floor ${floor}` });
      if (c.kind === 'node') visit(c.name, depth + 1, anc, typeof s.budgetUsd === 'number' ? s.budgetUsd : 0);
    }
  };
  visit(tree.root, 0, [], Infinity);

  // ONE_WRITER over the effect plan and the nodes' declared writes.
  const writers = new Map();
  for (const e of tree.effectPlan ?? []) { if (!writers.has(e.target)) writers.set(e.target, new Set()); writers.get(e.target).add(e.writer ?? 'envelope'); }
  for (const [name, n] of Object.entries(nodes)) for (const t of n.writes ?? []) { if (!writers.has(t)) writers.set(t, new Set()); writers.get(t).add(name); }
  for (const [t, w] of writers) if (w.size > 1) add('ONE_WRITER', [...w][0], { detail: `target ${t} has ${w.size} writers (${[...w].join(', ')}); exactly one writer per state key, file or effect target` });

  return { ok: findings.length === 0, findings, unchecked, edges };
}
const round = x => Math.round(x * 1e6) / 1e6;

// One assembled solver as a one-node tree (a convenience for S7 on a single solver).
export const checkSolver = ({ parts, budgetUsd = 0.5, samples = [], writes = [], effectPlan = [] }, opts) =>
  checkTree({ root: 'solver', nodes: { solver: { budgetUsd, parts, samples, writes } }, effectPlan }, opts);
