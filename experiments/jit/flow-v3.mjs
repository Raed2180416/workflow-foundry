// flow-v3.mjs: version 3 of the small SDK that compiled solvers (solve.mjs) are written against
// (research/jit-20261008/design/FLOW-V3.md, slice 1: research/jit-20261008/design/FLOW-V3-SLICE1.md). It is flow-v2.mjs
// byte for byte in every v2 primitive (input, step, judge, guard, invariant, map, flag, note, spent, done, the override
// hook) plus flow.call: a nested compiled workflow, named by its library hash, run by the HOST. A solver that never calls
// flow.call, run outside a call scope, gets the same trace, stdout, exit code and deopt.json as under flow-v2.mjs (no
// span/parent keys anywhere). It is one self-contained file because the host copies a single SDK file to tools/flow.mjs.
//
//   const sub = await flow.call('sha256:…', input, {    // a hash string or { hash }
//     name: 'subsidiary-close',                          // span name, required (alias: label)
//     budgetUsd: 0.25,                                   // carved from this run's budget: must be < what remains (host-enforced)
//     timeoutMs: 120_000,
//     onDeopt: 'propagate',                              // 'propagate' (default: deopt kind 'call') | 'value' (return {deopt, status})
//     onRefuse: 'deopt',                                 // 'deopt' (default: deopt kind 'call') | 'value' (return {refused, detail})
//   });
// The request goes over the existing gateway protocol (POST /model with model 'flow:call'; tools/model.mjs unchanged). The
// solver never spawns anything: the host resolves the hash in its library registry, checks it (recursion, depth, input
// schema, input profile, budget), runs the callee in its own sandbox and returns its typed result, a deopt or a refusal.
// The child's cost comes back as the call's costUsd and counts in this run's spend. Events (this trace): call-start, then
// exactly one of call-end (ok), call-deopt (the child deopted, crashed, timed out or returned a value outside its output
// schema) or call-refused (the host or this SDK refused). Each carries span = `call:${name}#${ordinal}` (ordinal per name
// in this run) and parent = the enclosing span ('root' at top level). Inside a call scope (tools/flow-scope.json, written
// by the host), every event of the child also carries span and parent of its scope.
//
// Slice 2a (research/jit-20261008/design/FLOW-V3-SLICE2.md):
//   const r = await flow.call(hash, input, {
//     name: 'S2', budgetUsd: 0.25,
//     prompt: subTask.prompt,                            // the child task's prompt (default: the entry's contract.taskTemplate)
//     onRefuse: 'interpret',                             // 'deopt' (default) | 'interpret' | 'skip' (return {refused, detail}; 'value' is an alias)
//     onDeopt: 'propagate',                              // 'propagate' (default) | 'interpret' | 'skip' (return {deopt, status}; 'value' is an alias)
//   });
// 'interpret' is FLOW-V3 §1.5 local deopt: the host's interpreter solves the child task alone under the call's carved budget
// and its typed answer is returned in place of the child's (event interpret-child, localDeopt: true); only an outside-profile
// or revoked refusal can be interpreted, and a refusal the host could not interpret deopts the caller (kind call). A host in
// novelMode 'warn' runs an outside-profile call and its call-end carries profileWarning. A budget that is not strictly below
// what remains is refused BUDGET_TREE (with the shortfall) when the run's children in flight hold the difference, else
// budget-exceeds-parent.
//   const rows = await flow.phase('extract', async () => { ... });   // a named run stage: phase-start / phase-end span events
// (span 'phase:<name>#<n>', parent: the enclosing phase or scope); every event inside the phase carries phase: <its span>.
// A solver that uses neither gets exactly the flow-v2 trace.
//
// Slice 2b (research/jit-20261008/design/FLOW-V3-SLICE2.md §9-§12):
//   const out = await flow.agent('decode-dump', {
//     instructions: 'Decode the files under files/dump/ ...',   // the node's whole prompt (synthetic task text only, D10)
//     files: { 'dump/': 'dump/S3/' },                     // agent path <- task file or directory (task.files keys), or { text }
//     inputs: { dump_spec },                              // optional JSON the node sees as inputs.json
//     returns: SCHEMA,                                    // required: the typed result (the host validates it)
//   }, {
//     verify: (out, ctx) => predicate(out, ctx.files),     // required: parent-side code over the result; null/true/[] = ok,
//                                                          // a string, a list of strings, false or {ok, reasons} = the problem
//     budgetUsd: 0.3, minutes: 10, stallMs: 120000,       // the node's budget covers every attempt; stallMs: see call-host
//     retries: 1,                                         // a failed verify (or no typed answer) reruns once, with the reason
//     harvest: true, model, tools,                        // the host keeps the scripts the node wrote (sub-compile input)
//     onRefuse: 'deopt' | 'skip', onFail: 'deopt' | 'skip',
//   });
// The host runs the node in its own sandbox (call-host.mjs, agent-node.mjs) and returns its typed answer; this SDK runs
// verify in this process with ctx = {files (the texts the node got), text (all of them joined), inputs, attempt, name}.
// Events agent-start / agent-end (attempt, verify {ok, reasons}, status) or agent-refused; span 'agent:<name>#<n>'.
// After the last attempt the run deopts with kind 'agent' (onFail 'skip': {failed, reasons, attempts}).
// flow.call(..., { verify }) runs the same kind of predicate on a callee's typed output: a failure is a child deopt of kind
// 'verify' (onDeopt 'skip' returns it, so the caller can fall back to an agent node).
//   const table = await flow.wide('statements', {
//     items: list,                                        // or plan: a flow.judge spec whose value is {items} or a list
//     itemSchema, check: items => issues,                 // typed, bounded work list (maxFanout, default 32, at most 64)
//     worker: (item, i) => ... | { judge: {...prompt: (item, i) => ...} } | { call: {hash, budgetUsd, ...} } | { agent: {...} },
//     itemCheck: (result, item, i) => verdict,            // per-item judgment of the result (code)
//     reduce: (results, coverage) => value,               // required code reducer; coverage {n, done, failed, skipped, items}
//     quorum: 1, verify: (value) => verdict, budgetUsd: 0.6, concurrency: 8, itemFloorUsd,
//     onItemError: 'crash' | 'null' | 'retry(n)' | 'retry(n)+null',
//     prefixShare: true, prefixHoldMs: 5000,              // judge workers with one prompt prefix wait for the first response
//   });
// Events wide-start, wide-plan, one wide-item per item, wide-reduce, wide-verify, wide-end; events inside an item carry
// wide: <span> and item: <i>. flow.map(items, fn, { onItemError, reduce }) takes the same per-item failure policy (absent:
// flow-v2's map byte for byte). Under 'null' or 'retry(n)' a deopt inside an item (a judge, guard or call) fails that item
// (event item-deopt) instead of the run, except a gateway budget deopt. A retried item runs its code again: anything it calls
// must be safe to call twice (at-least-once; solvers have no effects, callees are effects: 'none').
//
// The flow-v2 header follows; everything in it holds for flow-v3.
//
//   import { createFlow } from './tools/flow.mjs';
//   const flow = createFlow({ budgetUsd: 0.5 });                     // soft per-task model budget, checked before each judge tier
//   const task = flow.input();                                       // parsed task.json (argv[2]): {prompt, inputs, files?}
//   const rows = flow.step('parse-rows', () => parseRows(task.inputs));   // code step (sync or async)
//   const v = await flow.judge('status-meaning', {
//     tiers: ['claude-haiku-5-5', 'claude-sonnet-5-5'],              // cheapest first; escalate on a call error or a failed check
//     system, prompt, schema,                                        // schema: the portable subset callModel accepts
//     check: v => text.includes(v.quote) ? null : 'quote not in text',   // null = ok, a string = the problem
//     samples: 1,                                                    // >1: majority vote on canonical JSON; no majority escalates
//   });
//   flow.guard('known-systems', cond, detail);     // falsy: this input is outside what the solver was compiled for -> deopt
//   flow.invariant('rows-conserved', cond, detail);   // falsy: the solver's own result broke a property every trace had -> deopt
//   const out = await flow.map(items, async (x, i) => ..., { concurrency: 4 });
//   flow.flag('weak-name-match', { name, score });   // this run took a decision on weak evidence (trace only; never a deopt)
//   flow.done(answer);                             // prints the final JSON line on stdout; call exactly once
//
// createFlow({ autoFlag: true }) (opt-in, default false) also flags 'judge-escalated:<name>' when a judge escalated past
// its first tier or its samples vote was not unanimous (detail.reason: 'escalated', 'split-vote' when two valid samples
// differed, 'failed-sample' when the valid samples agreed but some sample failed its call or check). Flags never change
// the output or the exit code.
// Replay (harness-only; a solver never uses it): if tools/flow-override.mjs exists, its default export override(callSite,
// request) is consulted before every judge model call (so is createFlow({ override })). callSite: {id, name, ordinal,
// digest, tier, tierIndex, sample}; id = `${name}#${ordinal}:${digest16}`, ordinal counts earlier calls with the same name
// and request in this run; request: {model, system, prompt, schema, decoding}; digest = sha256(canonical(request)), no
// salt. It returns undefined (call the model) or {value} / {error} (used instead, at $0; the judge event says overridden).
// Without the file or option nothing changes.
// Exit codes: 0 after done(); 75 = deopt (./deopt.json {kind: guard|invariant|judge|budget|call, name, detail}); anything else
// is a crash (an uncaught exception exits 1). Every event is one JSON line in ./trace.jsonl: {at, kind, name, ...}.
import { readFileSync, writeFileSync, appendFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { callModel } from './model.mjs';

export const DEOPT_EXIT = 75;
const MAX_EVENTS = 5000, MAX_TEXT = 64 * 1024, HEAD_TEXT = 2048, MAX_FLAG_NAMES = 50;
const TRACE = 'trace.jsonl', DEOPT = 'deopt.json';
const CALLS = new URL('./calls.jsonl', import.meta.url);   // model.mjs appends one line per call (with its costUsd) here
const OVERRIDE = new URL('./flow-override.mjs', import.meta.url);   // replay harness only (see the header)
const fileOverride = existsSync(OVERRIDE) ? (await import(OVERRIDE.href)).default : null;
if (fileOverride != null && typeof fileOverride !== 'function') throw new Error('tools/flow-override.mjs must export a default function');
// flow-v3: the call scope this process runs in, written by the host for a child run only: {span, parent, path, depth}.
export const CALL_MODEL = 'flow:call', ROOT_SPAN = 'root', CALL_PROTOCOL = 1;
const SCOPE_FILE = new URL('./flow-scope.json', import.meta.url);
const scope = existsSync(SCOPE_FILE) ? JSON.parse(readFileSync(SCOPE_FILE, 'utf8')) : null;
if (scope != null && (typeof scope.span !== 'string' || typeof scope.path !== 'string' || !Number.isInteger(scope.depth))) throw new Error('tools/flow-scope.json must be {span, parent, path, depth}');

export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
}
const sha = text => createHash('sha256').update(text).digest('hex');
const digest = v => (v === undefined ? null : sha(canonical(v)).slice(0, 16));
// The salt-free request digest the replay override and the host memo port (run-compiled.mjs requestDigestOf) share:
// the request exactly as tools/model.mjs posts it to the gateway.
export const requestOf = ({ model, system = '', prompt, schema, reasoning = 'none', maxTokens }) =>
  ({ model, system: String(system), prompt, schema, decoding: { reasoning, ...(maxTokens ? { maxTokens } : {}) } });
export const requestDigest = request => sha(canonical(request));
// flow-v3: a call's idempotency key (calleeHash, inputDigest, parentSpanPath), as the host (call-host.mjs callKeyOf)
// computes it. inputDigest is the full sha256 of the input's canonical JSON.
export const inputDigestOf = input => sha(canonical(input));
export const callKeyOf = ({ callee, inputDigest, parentPath, promptDigest }) => sha(canonical({ callee, inputDigest, parentPath, promptDigest }));
// Slice 2a: a per-call prompt joins the key as its full sha256 (call-host.mjs promptDigestOf); without one the key is slice 1's.
export const promptDigestOf = prompt => (typeof prompt === 'string' ? sha(prompt) : undefined);
const ON_REFUSE = { deopt: 'deopt', interpret: 'interpret', skip: 'skip', value: 'skip' };
const ON_DEOPT = { propagate: 'propagate', interpret: 'interpret', 'interpret-child': 'interpret', skip: 'skip', value: 'skip' };

// ---- slice 2b helpers (exported for tests; the host has its own copies in agent-node.mjs)
export const AGENT_MAX_RETRIES = 2, DEFAULT_MAX_FANOUT = 32, HARD_MAX_FANOUT = 64, DEFAULT_PREFIX_HOLD_MS = 5000;
// A verify / check result as {ok, reasons}: null, undefined, true or [] is ok; false, a string, a list of strings or
// {ok: false, reasons} is the problem; a throw is a problem too.
export function verdictOf(fn) {
  let r;
  try { r = fn(); } catch (e) { return { ok: false, reasons: [`verify threw: ${short(e)}`] }; }
  if (r === null || r === undefined || r === true) return { ok: true, reasons: [] };
  if (r === false) return { ok: false, reasons: ['verify failed'] };
  if (typeof r === 'string') return { ok: false, reasons: [r.slice(0, 500)] };
  if (Array.isArray(r)) return r.length ? { ok: false, reasons: r.map(x => short(x, 500)) } : { ok: true, reasons: [] };
  if (typeof r === 'object' && typeof r.ok === 'boolean') {
    const reasons = Array.isArray(r.reasons) ? r.reasons.map(x => short(x, 500)) : r.reasons != null ? [short(r.reasons, 500)] : [];
    return r.ok ? { ok: true, reasons: [] } : { ok: false, reasons: reasons.length ? reasons : ['verify failed'] };
  }
  return { ok: false, reasons: [`verify returned ${typeof r}`] };
}
// The per-item failure policy of map and wide: {retries, then: 'crash' | 'null'}.
export function itemPolicyOf(p) {
  if (p === undefined || p === 'crash') return { retries: 0, then: 'crash' };
  if (p === 'null') return { retries: 0, then: 'null' };
  const m = typeof p === 'string' ? /^retry\(([1-5])\)(\+null)?$/.exec(p) : null;
  if (!m) throw new Error(`onItemError must be 'crash', 'null', 'retry(n)' or 'retry(n)+null' with n in 1..5, got ${JSON.stringify(p)}`);
  return { retries: Number(m[1]), then: m[2] ? 'null' : 'crash' };
}
// Agent file handles: {agentPath: handle}; a handle is a task file path, a task directory prefix ending in '/' (both as keys
// of task.files, a leading 'files/' allowed), or {text}. Returns {files: {agentPath: text}, sources: {agentPath: 'task:<key>'
// | 'literal'}}; throws on an unsafe path or a handle that names no task file.
const SAFE_REL = /^(?![/\\])(?!.*(?:^|[/\\])\.\.(?:[/\\]|$))[^\0\\]+$/;
export function resolveAgentFiles(taskFiles, spec) {
  const files = {}, sources = {}, tf = taskFiles && typeof taskFiles === 'object' ? taskFiles : {};
  if (spec == null) return { files, sources };
  if (typeof spec !== 'object' || Array.isArray(spec)) throw new Error('files must be an object {agentPath: handle}');
  for (const [to, h] of Object.entries(spec)) {
    if (!SAFE_REL.test(to)) throw new Error(`unsafe agent path ${JSON.stringify(to)}`);
    if (h && typeof h === 'object' && typeof h.text === 'string') {
      if (to.endsWith('/')) throw new Error(`a literal text needs a file path, not ${to}`);
      files[to] = h.text; sources[to] = 'literal'; continue;
    }
    if (typeof h !== 'string' || !h) throw new Error(`the handle of ${to} must be a task file path, a directory ending in '/', or {text}`);
    const from = h.replace(/^files\//, '');
    if (from.endsWith('/')) {
      if (!to.endsWith('/')) throw new Error(`a directory handle (${h}) needs an agent directory ending in '/' (got ${to})`);
      const hits = Object.keys(tf).filter(k => k.startsWith(from)).sort();
      if (!hits.length) throw new Error(`no task file under ${h}`);
      for (const k of hits) { files[to + k.slice(from.length)] = tf[k]; sources[to + k.slice(from.length)] = `task:${k}`; }
    } else {
      if (!Object.hasOwn(tf, from)) throw new Error(`no task file ${h}`);
      const p = to.endsWith('/') ? to + from.split('/').pop() : to;
      files[p] = tf[from]; sources[p] = `task:${from}`;
    }
  }
  return { files, sources };
}
// A small structural check of a JSON value against the portable schema subset (type, enum, const, required, properties,
// additionalProperties false, items, min/maxItems, minimum/maximum). Returns up to five error strings.
export function schemaErrors(schema, v, at = '$', out = []) {
  if (!schema || typeof schema !== 'object' || out.length >= 5) return out;
  const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
  const types = schema.type == null ? null : [].concat(schema.type);
  if (types && !types.some(x => x === t || (x === 'integer' && Number.isInteger(v)) || (x === 'number' && t === 'number'))) { out.push(`${at}: ${t} is not ${types.join('|')}`); return out; }
  if (schema.enum && !schema.enum.some(e => canonical(e) === canonical(v))) out.push(`${at}: not one of the enum`);
  if ('const' in schema && canonical(schema.const) !== canonical(v)) out.push(`${at}: not the const`);
  if (t === 'number' && typeof schema.minimum === 'number' && v < schema.minimum) out.push(`${at}: below ${schema.minimum}`);
  if (t === 'number' && typeof schema.maximum === 'number' && v > schema.maximum) out.push(`${at}: above ${schema.maximum}`);
  if (t === 'array') {
    if (typeof schema.minItems === 'number' && v.length < schema.minItems) out.push(`${at}: fewer than ${schema.minItems} items`);
    if (typeof schema.maxItems === 'number' && v.length > schema.maxItems) out.push(`${at}: more than ${schema.maxItems} items`);
    if (schema.items) v.forEach((x, i) => schemaErrors(schema.items, x, `${at}[${i}]`, out));
  }
  if (t === 'object') {
    for (const k of schema.required ?? []) if (!Object.hasOwn(v, k)) out.push(`${at}: missing ${k}`);
    for (const [k, s] of Object.entries(schema.properties ?? {})) if (Object.hasOwn(v, k)) schemaErrors(s, v[k], `${at}.${k}`, out);
    if (schema.additionalProperties === false) for (const k of Object.keys(v)) if (!Object.hasOwn(schema.properties ?? {}, k)) out.push(`${at}: unexpected ${k}`);
  }
  return out.slice(0, 5);
}
// A deopt raised inside a map/wide item whose policy catches it ('null', 'retry(n)'): the item fails, the run goes on.
class ItemDeopt extends Error {
  constructor(kind, name, detail) { super(`deopt ${kind}: ${name}`); this.name = 'ItemDeopt'; this.deopt = { kind, name, detail }; }
}
const usd = x => Math.round(x * 1e6) / 1e6;
const short = (v, n = 300) => String(v?.message ?? v).slice(0, n);
// A detail object in deopt.json and the trace stays small; a long one keeps its head.
const clip = (v, n = 4000) => { const s = JSON.stringify(v ?? null) ?? 'null'; return s.length <= n ? JSON.parse(s) : { truncated: true, head: s.slice(0, n) }; };
// Full prompt text for replay on cheaper tiers (tier-down); a text over 64 KB keeps its sha256 and first 2 KB.
const keepText = (field, text, into) => {
  if (text.length <= MAX_TEXT) into[field] = text;
  else { into[field] = text.slice(0, HEAD_TEXT); into[`${field}Sha256`] = sha(text); into.truncated = true; }
};

let created = false;

export function createFlow({ budgetUsd = 0.5, autoFlag = false, override = fileOverride } = {}) {
  if (created) throw new Error('createFlow() may be called once per process');
  created = true;
  if (override != null && typeof override !== 'function') throw new Error('createFlow({ override }) must be a function');
  const ordinals = new Map();   // `${name}\0${digest}` -> calls so far (replay call-site ids)
  const state = { started: Date.now(), spentUsd: 0, calls: 0, unknownCostCalls: 0, events: 0, dropped: 0, done: false, deopted: false,
    guards: {}, invariants: {}, judges: 0, flags: 0, flagNames: [], task: undefined };
  // A fresh trace per run; a stale deopt.json from an earlier run in the same directory must not be read as this run's.
  try { writeFileSync(TRACE, ''); rmSync(DEOPT, { force: true }); } catch {}
  const sub = { n: 0, reservedUsd: 0, inFlight: 0, ordinals: new Map(), interpreted: 0 };   // flow-v3 calls: count, budget held by calls in flight, span ordinals
  const phases = { n: 0, ordinals: new Map(), als: new AsyncLocalStorage() };   // flow-v3 phases: count, span ordinals, the current phase
  // Slice 2b: agent nodes and wide operators (count, span ordinals), and the item context of map (with a failure policy) and
  // wide (ALS: {wide, i, acc: spend accumulators, catchDeopt}). `used` stays false in every run that has neither.
  const agents = { n: 0, ordinals: new Map() }, wides = { n: 0, ordinals: new Map() }, items = { used: false, als: new AsyncLocalStorage() };
  let seen = 0;   // bytes of calls.jsonl already charged
  try { seen = readFileSync(CALLS).length; } catch {}

  // Inside a call scope every event carries the scope's span and parent (unless it names its own, as call-* events do);
  // outside one (every flow-v2 run) nothing is added.
  function event(e) {
    if (state.events >= MAX_EVENTS && !['done', 'deopt', 'crash'].includes(e.kind)) { state.dropped++; return; }
    state.events++;
    const ph = phases.n ? phases.als.getStore() : undefined;
    let base = ph && e.phase === undefined ? { ...e, phase: ph.span } : e;
    const it = items.used ? items.als.getStore() : undefined;
    if (it?.wide && base.wide === undefined) base = { ...base, wide: it.wide, item: it.wideItem };
    const line = scope && base.span === undefined ? { at: new Date().toISOString(), ...base, span: scope.span, parent: scope.parent ?? null } : { at: new Date().toISOString(), ...base };
    try { appendFileSync(TRACE, JSON.stringify(line) + '\n'); } catch {}
  }
  const totals = () => ({ spentUsd: usd(state.spentUsd), calls: state.calls, unknownCostCalls: state.unknownCostCalls, judges: state.judges,
    guards: state.guards, invariants: state.invariants, ms: Date.now() - state.started, ...(state.dropped ? { droppedEvents: state.dropped } : {}),
    ...(state.flags ? { flags: state.flags, flagNames: state.flagNames } : {}), ...(sub.n ? { childCalls: sub.n } : {}), ...(sub.interpreted ? { interpretedChildren: sub.interpreted } : {}),
    ...(phases.n ? { phases: phases.n } : {}), ...(agents.n ? { agentNodes: agents.n } : {}), ...(wides.n ? { wides: wides.n } : {}) });
  // The span a new scope-opening event names as its parent: the enclosing phase, else the call scope, else 'root'.
  const parentSpan = () => (phases.n ? phases.als.getStore()?.span : undefined) ?? scope?.span ?? ROOT_SPAN;

  // An uncertainty mark (a decision taken on weak evidence). It is counted in the totals and traced; it never throws,
  // and never changes the output or the exit code.
  function flag(name, detail, extra = {}) {
    try {
      const n = String(name ?? 'flag').slice(0, 200);
      state.flags++;
      if (!state.flagNames.includes(n) && state.flagNames.length < MAX_FLAG_NAMES) state.flagNames.push(n);
      let d; try { d = clip(typeof detail === 'function' ? detail() : detail); } catch (e) { d = { unserializable: short(e, 200) }; }
      event({ kind: 'flag', name: n, detail: d, ...extra });
    } catch {}
  }

  function deopt(kind, name, detail) {
    // Slice 2b: inside an item whose failure policy catches deopts, the item fails and the run goes on (never for budget).
    const it = items.used ? items.als.getStore() : undefined;
    if (it?.catchDeopt && kind !== 'budget') {
      event({ kind: 'item-deopt', name, deopt: kind, detail: clip(detail) });
      throw new ItemDeopt(kind, name, detail);
    }
    state.deopted = true;
    const d = { kind, name, detail: clip(detail), spentUsd: usd(state.spentUsd), at: new Date().toISOString() };
    try { writeFileSync(DEOPT, JSON.stringify(d, null, 1)); } catch {}
    event({ kind: 'deopt', name, deopt: kind, detail: d.detail, ...totals() });
    process.exit(DEOPT_EXIT);
  }

  // Cost of the calls that finished since the last look. model.mjs appends a call's line just before callModel returns or
  // throws, and no other response can be handled in between, so the new lines are this call's (none if the request failed).
  function charge() {
    let buf; try { buf = readFileSync(CALLS); } catch { return 0; }
    const fresh = buf.subarray(seen).toString('utf8'); seen = buf.length;
    let cost = 0;
    for (const line of fresh.split('\n').filter(Boolean)) {
      let row; try { row = JSON.parse(line); } catch { continue; }
      state.calls++;
      if (typeof row.costUsd === 'number') cost += row.costUsd; else if (row.ok) state.unknownCostCalls++;
    }
    state.spentUsd += cost;
    // Slice 2b: inside a wide item (or a map item with a policy) the cost is also booked to the item and its operator.
    const it = items.used ? items.als.getStore() : undefined;
    if (it?.acc) for (const a of it.acc) a.spent += cost;
    return cost;
  }

  process.on('uncaughtExceptionMonitor', error => event({ kind: 'crash', name: 'uncaught', error: short(error?.stack ?? error, 1200), ...totals() }));
  process.on('exit', code => {
    if (code === 0 && !state.done && !state.deopted) {
      event({ kind: 'crash', name: 'no-done', error: 'the script ended without calling flow.done()', ...totals() });
      process.exitCode = 1;
    }
  });

  const flow = {
    input(file = process.argv[2] ?? 'task.json') {
      if (state.task === undefined) {
        state.task = JSON.parse(readFileSync(file, 'utf8'));
        event({ kind: 'input', name: file, digest: digest(state.task) });
      }
      return state.task;
    },

    step(name, fn) {
      const t0 = Date.now();
      const finish = (ok, out, error) => event({ kind: 'step', name, ok, ms: Date.now() - t0,
        ...(ok ? { out: digest(out), ...(Array.isArray(out) ? { n: out.length } : {}) } : { error: short(error) }) });
      let r;
      try { r = fn(); } catch (error) { finish(false, null, error); throw error; }
      if (r && typeof r.then === 'function') return r.then(v => { finish(true, v); return v; }, error => { finish(false, null, error); throw error; });
      finish(true, r);
      return r;
    },

    guard(name, cond, detail) {
      if (cond) { state.guards[name] = (state.guards[name] ?? 0) + 1; return true; }
      deopt('guard', name, typeof detail === 'function' ? detail() : detail);
    },

    invariant(name, cond, detail) {
      if (cond) { state.invariants[name] = (state.invariants[name] ?? 0) + 1; return true; }
      deopt('invariant', name, typeof detail === 'function' ? detail() : detail);
    },

    async judge(name, { tiers, system = '', prompt, schema, check = null, samples = 1, reasoning = 'none', maxTokens } = {}) {
      if (!Array.isArray(tiers) || !tiers.length) throw new Error(`flow.judge(${name}): tiers must be a non-empty list of model ids`);
      if (!schema || typeof schema !== 'object') throw new Error(`flow.judge(${name}): a schema is required`);
      if (!Number.isInteger(samples) || samples < 1) throw new Error(`flow.judge(${name}): samples must be a positive integer`);
      const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
      const t0 = Date.now(), tiersTried = [];
      let costUsd = 0, overridden = 0;
      const record = extra => {
        const e = { kind: 'judge', name, ...extra, tiersTried, samples, costUsd: usd(costUsd), ms: Date.now() - t0, ...(overridden ? { overridden } : {}) };
        keepText('system', String(system), e); keepText('prompt', text, e); e.schema = schema;
        event(e);
      };
      // One sample: the value, or the problem (a failed call or a failed check). A check may return null/undefined/true (ok),
      // false or a string (the problem); a check that throws is a problem too.
      const ask = async (model, tierIndex, sample) => {
        let value, error = null, problem = null, response;
        if (override) {
          // The call-site id is fixed before the first await, so concurrent samples get ordinals in sample order.
          const request = requestOf({ model, system, prompt: text, schema, reasoning, maxTokens }), d = requestDigest(request), key = `${name}\0${d}`;
          const ordinal = ordinals.get(key) ?? 0; ordinals.set(key, ordinal + 1);
          const callSite = { id: `${name}#${ordinal}:${d.slice(0, 16)}`, name, ordinal, digest: d, tier: model, tierIndex, sample };
          try { response = await override(callSite, request); } catch (e) { response = { error: 'override threw: ' + short(e) }; }
          if (response !== undefined && (response === null || typeof response !== 'object' || !('value' in response || 'error' in response))) response = { error: 'override returned neither {value} nor {error}' };
        }
        if (response !== undefined) { overridden++; if (response.error != null) error = short(response.error); else value = response.value; }
        else try { value = await callModel({ model, system: String(system), prompt: text, schema, reasoning, maxTokens }); } catch (e) { error = short(e); }
        const cost = response !== undefined ? 0 : charge(); costUsd += cost;
        if (!error && check) {
          try { const r = check(value); problem = r === null || r === undefined || r === true ? null : r === false ? 'check failed' : String(r); }
          catch (e) { problem = 'check threw: ' + short(e); }
        }
        return { value, error, problem, cost };
      };
      for (const [k, model] of tiers.entries()) {
        if (state.spentUsd >= budgetUsd) { record({ ok: false }); deopt('budget', name, { spentUsd: usd(state.spentUsd), budgetUsd, tiersTried }); }
        const results = await Promise.all(Array.from({ length: samples }, (_, i) => ask(model, k, i)));
        const cost = usd(results.reduce((s, r) => s + r.cost, 0));
        // The gateway refused the call for budget: no stronger tier can help.
        if (results.some(r => /model call failed: 402\b/.test(r.error ?? ''))) {
          tiersTried.push({ model, ok: false, error: 'gateway budget exhausted', costUsd: cost });
          record({ ok: false }); deopt('budget', name, { gateway: 'budget exhausted', spentUsd: usd(state.spentUsd), tiersTried });
        }
        const groups = new Map();
        for (const r of results) if (!r.error && !r.problem) { const key = canonical(r.value); groups.set(key, [...(groups.get(key) ?? []), r.value]); }
        const ranked = [...groups.values()].sort((a, b) => b.length - a.length);
        if (ranked[0] && ranked[0].length * 2 > samples) {
          tiersTried.push({ model, ok: true, costUsd: cost, ...(samples > 1 ? { votes: ranked.map(g => g.length) } : {}) });
          state.judges++;
          const value = ranked[0][0];
          record({ ok: true, tier: model, escalations: k, value, agreement: ranked[0].length / samples });
          if (autoFlag && (k > 0 || ranked[0].length < samples)) {
            flag(`judge-escalated:${name}`, { reason: k > 0 ? 'escalated' : ranked.length > 1 ? 'split-vote' : 'failed-sample', tier: model, escalations: k, agreement: ranked[0].length / samples,
              ...(samples > 1 ? { votes: ranked.map(g => g.length) } : {}) }, { auto: true });
          }
          return value;
        }
        const bad = results.find(r => r.problem || r.error), first = bad ? (bad.problem ?? bad.error) : null;
        const why = ranked.length ? { problem: first ? `no majority; ${first}` : 'no majority' } : bad?.problem ? { problem: bad.problem } : { error: bad?.error ?? 'no value' };
        tiersTried.push({ model, ok: false, costUsd: cost, ...why, ...(samples > 1 ? { votes: ranked.map(g => g.length) } : {}) });
      }
      record({ ok: false });
      deopt('judge', name, { tiersTried });
    },

    // flow-v2's map, byte for byte (fail-fast: the first failing body is rethrown after the items in flight settle). Slice 2b:
    // a per-item failure policy (onItemError) or a coverage reducer (reduce) runs the items under mapWithPolicy instead.
    async map(items, fn, opts = {}) {
      if (opts?.onItemError !== undefined || opts?.reduce !== undefined) return mapWithPolicy(items, fn, opts);
      const { concurrency = 4, name = 'map' } = opts ?? {};
      const list = [...items], out = new Array(list.length), t0 = Date.now();
      let next = 0, failure = null;
      const worker = async () => {
        while (!failure && next < list.length) {
          const i = next++;
          try { out[i] = await fn(list[i], i); } catch (error) { failure ??= { error }; }
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, worker));
      event({ kind: 'map', name, n: list.length, concurrency, ok: !failure, ms: Date.now() - t0 });
      if (failure) throw failure.error;
      return out;
    },

    // flow-v3: a nested compiled workflow by library hash (callNode below); slice 2b: agent nodes and the wide operator.
    async call(ref, input, opts = {}) { return callNode(ref, input, opts); },
    async agent(name, spec, opts) { return agentNode(name, spec, opts); },
    async wide(name, spec) { return wideNode(name, spec); },

    // flow-v3 slice 2a: a named run stage (Managed Agents workflow_run.phase_started/ended). Runs fn and returns its result;
    // phase-start / phase-end carry span 'phase:<name>#<n>' (ordinal per name, fixed before the first await) and parent (the
    // enclosing phase, else the call scope, else 'root'); every event emitted inside fn (also across awaits and inside map)
    // carries phase: <span>. A throw inside fn ends the phase with ok: false and is rethrown; a deopt ends the run as usual
    // (no phase-end). phase-end's spentUsd and calls are the run's spend and calls while the phase was open, so phases
    // running concurrently (inside map) each count the others' spend too.
    async phase(name, fn) {
      if (typeof name !== 'string' || !name) throw new Error('flow.phase: a name is required');
      if (typeof fn !== 'function') throw new Error(`flow.phase(${name}): fn must be a function`);
      const ordinal = phases.ordinals.get(name) ?? 0; phases.ordinals.set(name, ordinal + 1);
      phases.n++;
      const outer = phases.als.getStore(), span = `phase:${name}#${ordinal}`, parent = outer?.span ?? scope?.span ?? ROOT_SPAN;
      const t0 = Date.now(), spent0 = state.spentUsd, calls0 = state.calls;
      // Both events are emitted outside the new phase's context, so they carry the enclosing phase (if any) as phase.
      event({ kind: 'phase-start', name, span, parent });
      const close = (ok, error) => event({ kind: 'phase-end', name, span, parent, ok, spentUsd: usd(state.spentUsd - spent0), calls: state.calls - calls0, ms: Date.now() - t0,
        ...(error ? { error: short(error) } : {}) });
      try { const v = await phases.als.run({ span }, fn); close(true); return v; }
      catch (error) { close(false, error); throw error; }
    },

    // A free-form trace event (what the solver decided and why), e.g. flow.note('systems', { names }).
    note(name, data) { event({ kind: 'note', name, data: clip(data) }); },

    // This run took a decision on weak evidence (a near-threshold fuzzy match, a value inferred from one weak cue): the
    // harness may shadow it with the interpreter. Trace and totals only, e.g. flow.flag('weak-name-match', { name, score }).
    flag(name, detail) { flag(name, detail); },

    spent() { return { spentUsd: usd(state.spentUsd), calls: state.calls, budgetUsd }; },

    done(value) {
      if (state.done) throw new Error('flow.done() may be called only once');
      const line = JSON.stringify(value);
      if (line === undefined) throw new Error('flow.done(value): value must be JSON');
      state.done = true;
      event({ kind: 'done', name: 'done', out: digest(value), ...totals() });
      process.stdout.write(line + '\n');
      return value;
    },
  };



    // flow-v3: a nested compiled workflow by library hash, run by the host (see the header). Returns the callee's typed
    // output (or, with onRefuse/onDeopt 'interpret', the interpreter's typed answer for the child task); on a refusal or a
    // child deopt it deopts this run with kind 'call', or returns {refused, detail} / {deopt, status} to the caller's code
    // when onRefuse / onDeopt is 'skip' (alias 'value': the caller's fallback).
  async function callNode(ref, input, opts = {}) {
      const callee = typeof ref === 'string' ? ref : ref?.hash, name = opts?.name ?? opts?.label;
      if (typeof callee !== 'string' || !callee) throw new Error('flow.call: ref must be a library hash or { hash }');
      if (typeof name !== 'string' || !name) throw new Error(`flow.call(${callee.slice(0, 24)}): opts.name (the span name) is required`);
      const { budgetUsd: childUsd, timeoutMs = 120000, prompt } = opts;
      const onDeopt = ON_DEOPT[opts.onDeopt ?? 'propagate'], onRefuse = ON_REFUSE[opts.onRefuse ?? 'deopt'];
      if (typeof childUsd !== 'number' || !(childUsd > 0)) throw new Error(`flow.call(${name}): budgetUsd must be a positive number`);
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error(`flow.call(${name}): timeoutMs must be a positive integer`);
      if (!onDeopt) throw new Error(`flow.call(${name}): onDeopt must be 'propagate', 'interpret' or 'skip'`);
      if (!onRefuse) throw new Error(`flow.call(${name}): onRefuse must be 'deopt', 'interpret' or 'skip'`);
      if (prompt !== undefined && typeof prompt !== 'string') throw new Error(`flow.call(${name}): prompt must be a string`);
      if (JSON.stringify(input) === undefined) throw new Error(`flow.call(${name}): input must be JSON`);
      if (opts.verify !== undefined && typeof opts.verify !== 'function') throw new Error(`flow.call(${name}): verify must be a function (result, ctx) => verdict`);
      // The span id is fixed before the first await, so concurrent calls (inside map) get ordinals in call order.
      const ordinal = sub.ordinals.get(name) ?? 0; sub.ordinals.set(name, ordinal + 1);
      const span = `call:${name}#${ordinal}`, parent = scope?.span ?? ROOT_SPAN, parentPath = scope?.path ?? ROOT_SPAN, depth = (scope?.depth ?? 0) + 1;
      const promptDigest = promptDigestOf(prompt);
      const inputDigest = inputDigestOf(input), key = callKeyOf({ callee, inputDigest, parentPath, promptDigest }), t0 = Date.now();
      sub.n++;
      event({ kind: 'call-start', name, span, parent, callee, inputDigest, ...(promptDigest ? { promptDigest } : {}), budgetUsd: childUsd, depth, key,
        ...(onRefuse === 'interpret' || onDeopt === 'interpret' ? { localDeopt: { onRefuse, onDeopt } } : {}) });
      const end = (kind, extra) => event({ kind, name, span, parent, callee, ...extra, ms: Date.now() - t0 });
      const refuse = (refused, detail, extra = { spentUsd: 0, reservedUsd: 0 }) => {
        end('call-refused', { ok: false, refused, detail: clip(detail ?? null, 1000), ...extra });
        if (onRefuse === 'skip') return { refused, detail: detail ?? null };
        // 'deopt', or 'interpret' that the host could not honour (not an applicability refusal, no budget, no interpreter).
        deopt('call', name, { callee, refused, detail: detail ?? null });
      };
      // The SDK's own check (as judge checks the soft budget): a child reservation is strictly below what remains, where
      // remaining already holds back the reservations of this run's calls in flight.
      const remaining = budgetUsd - state.spentUsd - sub.reservedUsd;
      if (!(childUsd < remaining)) {
        if (sub.inFlight > 0 && childUsd < remaining + sub.reservedUsd) {
          return refuse('BUDGET_TREE', { budgetUsd: childUsd, remainingUsd: usd(remaining), shortfallUsd: usd(childUsd - remaining), inFlight: sub.inFlight, reservedInFlightUsd: usd(sub.reservedUsd),
            parentBudgetUsd: budgetUsd, parentSpentUsd: usd(state.spentUsd) }, { by: 'sdk', spentUsd: 0, reservedUsd: 0 });
        }
        return refuse('budget-exceeds-parent', { budgetUsd: childUsd, remainingUsd: usd(remaining) }, { by: 'sdk', spentUsd: 0, reservedUsd: 0 });
      }
      sub.reservedUsd += childUsd; sub.inFlight++;
      let r = null, error = null;
      try {
        r = await callModel({ model: CALL_MODEL, prompt: JSON.stringify({ v: CALL_PROTOCOL, op: 'call', callee, input, name, span, parent, budgetUsd: childUsd, timeoutMs, key,
          ...(prompt !== undefined ? { prompt } : {}), ...(onRefuse !== 'deopt' ? { onRefuse } : {}), ...(onDeopt !== 'propagate' ? { onDeopt } : {}) }), schema: { type: 'object' } });
      } catch (e) { error = short(e); } finally { sub.reservedUsd = Math.max(0, sub.reservedUsd - childUsd); sub.inFlight--; }
      const cost = usd(charge());
      if (error != null) {
        // The gateway refused the request for budget: this run's own budget is spent, as for a judge.
        if (/model call failed: 402\b/.test(error)) {
          end('call-refused', { ok: false, refused: 'gateway-budget', detail: error.slice(0, 300), spentUsd: cost, reservedUsd: childUsd });
          deopt('budget', name, { gateway: 'budget exhausted', callee, spentUsd: usd(state.spentUsd) });
        }
        const d = { kind: 'host-error', name, detail: error };
        end('call-deopt', { ok: false, status: 'host-error', deopt: { kind: d.kind, name }, detail: error, spentUsd: cost, reservedUsd: childUsd });
        if (onDeopt === 'skip') return { deopt: d, status: 'host-error' };
        deopt('call', name, { callee, status: 'host-error', child: d });
      }
      const common = { spentUsd: cost, reservedUsd: childUsd, ...(r?.calleeVersion != null ? { calleeVersion: r.calleeVersion } : {}),
        ...(r?.childTrace ? { childTrace: r.childTrace, childTraceSha256: r.childTraceSha256 ?? null } : {}), ...(r?.memo ? { memo: r.memo } : {}),
        ...(r?.warning ? { profileWarning: clip(r.warning, 1000) } : {}) };
      // A locally interpreted child (FLOW-V3 §1.5): the host's interpreter answered in place of the refused or deopted callee.
      const local = r?.interpreted && typeof r.interpreted === 'object' ? { localDeopt: true, interpreted: clip(r.interpreted, 600), ...(r.refused ? { refused: String(r.refused) } : {}),
        ...(r.status === 'interpreted' && r.deopt ? { replaced: { kind: r.deopt.kind, name: r.deopt.name ?? null } } : {}) } : null;
      // Slice 2b: the caller's verify on the typed output (either path); a failure is a child deopt of kind 'verify'.
      const failedVerify = (r?.status === 'ok' || r?.status === 'interpreted') && opts.verify ? verdictOf(() => opts.verify(r.output, { name, input, prompt, status: r.status })) : null;
      if (failedVerify && !failedVerify.ok) {
        const d = { kind: 'verify', name, detail: { reasons: failedVerify.reasons } };
        if (r.status === 'interpreted') sub.interpreted++;
        end('call-deopt', { ok: false, status: 'verify-failed', deopt: { kind: 'verify', name }, verify: { ok: false, reasons: failedVerify.reasons }, outDigest: digest(r.output), ...(local ?? {}), ...common });
        if (onDeopt === 'skip') return { deopt: d, status: 'verify-failed' };
        deopt('call', name, { callee, status: 'verify-failed', child: d });
      }
      const vok = failedVerify ? { verify: { ok: true } } : {};
      if (r?.status === 'ok') { end('call-end', { ok: true, outDigest: digest(r.output), ...vok, ...common }); return r.output; }
      if (r?.status === 'interpreted') { sub.interpreted++; end('interpret-child', { ok: true, outDigest: digest(r.output), ...local, ...vok, ...common }); return r.output; }
      if (r?.status === 'refused') return refuse(String(r.refused), r.detail ?? null, common);
      const d = r?.deopt && typeof r.deopt === 'object' ? r.deopt : { kind: 'unknown', name: null, detail: 'the host answered without a status' };
      end(local ? 'interpret-child' : 'call-deopt', { ok: false, status: String(r?.status ?? 'unknown'), deopt: { kind: d.kind, name: d.name ?? null }, detail: clip(d.detail ?? null, 1000), ...(local ?? {}), ...common });
      if (onDeopt === 'skip') return { deopt: d, status: r?.status ?? 'unknown' };
      deopt('call', name, { callee, status: r?.status ?? 'unknown', child: { kind: d.kind, name: d.name ?? null, detail: clip(d.detail ?? null, 1000) } });
  }

  // ---- slice 2b ---------------------------------------------------------------------------------------------------
  // The SDK budget rule for a reservation of `amount` from this run (as flow.call checks it): null when it fits, else
  // [refusal, detail]. Remaining already holds back the reservations of this run's calls and agent nodes in flight.
  function budgetRefusalOf(amount) {
    const remaining = budgetUsd - state.spentUsd - sub.reservedUsd;
    if (amount < remaining) return null;
    if (sub.inFlight > 0 && amount < remaining + sub.reservedUsd) {
      return ['BUDGET_TREE', { budgetUsd: amount, remainingUsd: usd(remaining), shortfallUsd: usd(amount - remaining), inFlight: sub.inFlight, reservedInFlightUsd: usd(sub.reservedUsd),
        parentBudgetUsd: budgetUsd, parentSpentUsd: usd(state.spentUsd) }];
    }
    return ['budget-exceeds-parent', { budgetUsd: amount, remainingUsd: usd(remaining) }];
  }
  const taskFilesNow = () => {
    if (state.task !== undefined) return state.task?.files ?? {};
    try { return JSON.parse(readFileSync(process.argv[2] ?? 'task.json', 'utf8'))?.files ?? {}; } catch { return {}; }
  };

  // flow.agent (FLOW-V3 §2.2): a node that owns a sandboxed subagent, run by the host; verify runs here (see the header).
  async function agentNode(name, spec, opts) {
    if (typeof name !== 'string' || !name) throw new Error('flow.agent: a name is required');
    const s = spec ?? {}, o = opts ?? {};
    if (typeof s.instructions !== 'string' || !s.instructions.trim()) throw new Error(`flow.agent(${name}): spec.instructions (a string) is required`);
    if (!s.returns || typeof s.returns !== 'object' || Array.isArray(s.returns)) throw new Error(`flow.agent(${name}): spec.returns (the schema of the typed result) is required (refused: no-returns)`);
    if (typeof o.verify !== 'function') throw new Error(`flow.agent(${name}): opts.verify (a code predicate over the result) is required (refused: no-verify)`);
    const childUsd = o.budgetUsd;
    if (typeof childUsd !== 'number' || !(childUsd > 0)) throw new Error(`flow.agent(${name}): budgetUsd must be a positive number`);
    const timeoutMs = o.timeoutMs ?? (o.minutes != null ? Math.round(o.minutes * 60000) : 600000), retries = o.retries ?? 1;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error(`flow.agent(${name}): timeoutMs (or minutes) must be positive`);
    if (!Number.isInteger(retries) || retries < 0 || retries > AGENT_MAX_RETRIES) throw new Error(`flow.agent(${name}): retries must be an integer in 0..${AGENT_MAX_RETRIES}`);
    if (o.stallMs !== undefined && !(Number.isInteger(o.stallMs) && o.stallMs > 0)) throw new Error(`flow.agent(${name}): stallMs must be a positive integer`);
    if (o.tools !== undefined && (!Array.isArray(o.tools) || o.tools.some(t => typeof t !== 'string'))) throw new Error(`flow.agent(${name}): tools must be a list of tool names`);
    if (o.model !== undefined && typeof o.model !== 'string') throw new Error(`flow.agent(${name}): model must be a model id`);
    if (o.harvest !== undefined && typeof o.harvest !== 'boolean') throw new Error(`flow.agent(${name}): harvest must be true or false`);
    if (s.inputs !== undefined && JSON.stringify(s.inputs) === undefined) throw new Error(`flow.agent(${name}): inputs must be JSON`);
    const onRefuse = { deopt: 'deopt', skip: 'skip', value: 'skip' }[o.onRefuse ?? 'deopt'], onFail = { deopt: 'deopt', skip: 'skip' }[o.onFail ?? 'deopt'];
    if (!onRefuse || !onFail) throw new Error(`flow.agent(${name}): onRefuse must be 'deopt' or 'skip', onFail 'deopt' or 'skip'`);
    const ordinal = agents.ordinals.get(name) ?? 0; agents.ordinals.set(name, ordinal + 1);
    const span = `agent:${name}#${ordinal}`, parent = parentSpan(), t0 = Date.now();
    agents.n++;
    const refuse = (refused, detail, extra = {}) => {
      event({ kind: 'agent-refused', name, span, parent, ok: false, refused, detail: clip(detail ?? null, 1000), spentUsd: 0, ...extra, ms: Date.now() - t0 });
      if (onRefuse === 'skip') return { refused, detail: detail ?? null };
      deopt('agent', name, { refused, detail: detail ?? null });
    };
    let resolved;
    try { resolved = resolveAgentFiles(taskFilesNow(), s.files); } catch (e) { return refuse('bad-files', { error: short(e) }, { by: 'sdk' }); }
    const fileNames = Object.keys(resolved.files).sort(), filesDigest = sha(canonical(resolved.files)), instructionsDigest = sha(s.instructions);
    const ctx = { name, files: Object.freeze({ ...resolved.files }), text: fileNames.map(k => resolved.files[k]).join('\n'), inputs: s.inputs };
    const no = budgetRefusalOf(childUsd);
    if (no) return refuse(no[0], no[1], { by: 'sdk' });
    let spentNode = 0, reasons = ['no attempt ran'], retryReason, attempts = 0, lastStatus = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const left = usd(childUsd - spentNode);
      if (attempt > 0 && !(left > 0)) break;
      attempts++;
      event({ kind: 'agent-start', name, span, parent, attempt, model: o.model ?? null, budgetUsd: left, tools: o.tools ?? null, files: fileNames.length, filesDigest, instructionsDigest,
        ...(retryReason ? { retryReason } : {}) });
      sub.reservedUsd += left; sub.inFlight++;
      let r = null, error = null;
      try {
        r = await callModel({ model: CALL_MODEL, prompt: JSON.stringify({ v: CALL_PROTOCOL, op: 'agent', name, span, parent, attempt, instructions: s.instructions, files: resolved.files,
          fileSources: resolved.sources, ...(s.inputs !== undefined ? { inputs: s.inputs } : {}), returns: s.returns, ...(o.model ? { model: o.model } : {}), ...(o.tools ? { tools: o.tools } : {}),
          budgetUsd: left, timeoutMs, ...(o.stallMs ? { stallMs: o.stallMs } : {}), harvest: o.harvest ?? true, ...(retryReason ? { retryReason } : {}) }), schema: { type: 'object' } });
      } catch (e) { error = short(e); } finally { sub.reservedUsd = Math.max(0, sub.reservedUsd - left); sub.inFlight--; }
      const cost = usd(charge()); spentNode = usd(spentNode + cost);
      const end = extra => event({ kind: 'agent-end', name, span, parent, attempt, costUsd: cost, ...extra, ms: Date.now() - t0 });
      if (error != null) {
        if (/model call failed: 402\b/.test(error)) { end({ ok: false, status: 'gateway-budget', error: error.slice(0, 300) }); deopt('budget', name, { gateway: 'budget exhausted', spentUsd: usd(state.spentUsd) }); }
        end({ ok: false, status: 'host-error', error: error.slice(0, 300) });
        reasons = [`host error: ${error.slice(0, 300)}`]; lastStatus = 'host-error';
        break;
      }
      if (r?.status === 'refused') return refuse(String(r.refused), attempt ? { ...(r.detail ?? {}), after: reasons } : r.detail ?? null, { attempt, spentUsd: cost });
      const a = r?.agent ?? {};
      const info = { model: r?.model ?? o.model ?? null, turns: a.turns ?? null, transcriptSha256: a.transcriptSha256 ?? null, scripts: a.scripts ?? 0,
        nestedModelAttempts: a.nestedModelAttempts ?? 0, hiddenPathAttempts: a.hiddenPathAttempts ?? 0, ...(a.stalled ? { stalled: a.stalled, restarts: a.restarts ?? 0 } : {}),
        ...(r?.memo ? { memo: r.memo } : {}), ...(r?.key ? { key: r.key } : {}) };
      lastStatus = String(r?.status ?? 'unknown');
      if (r?.status === 'ok') {
        const v = verdictOf(() => o.verify(r.output, { ...ctx, attempt }));
        if (v.ok) { end({ ok: true, status: 'ok', verify: { ok: true }, outDigest: digest(r.output), ...info }); return r.output; }
        reasons = v.reasons; lastStatus = 'verify-failed';
        end({ ok: false, status: 'verify-failed', verify: { ok: false, reasons }, outDigest: digest(r.output), ...info });
      } else {
        reasons = [r?.status === 'void' ? `void: ${r.void}` : `no typed answer (${short(r?.error?.code ?? r?.error ?? r?.status ?? 'unknown', 200)})`];
        end({ ok: false, status: lastStatus, ...(r?.void ? { void: r.void } : {}), ...(r?.error ? { error: clip(r.error, 600) } : {}), ...info });
      }
      // A retry carries the reason (W-BED-R5-NOTES item 11): a decoding mistake repeats unless the node is told what failed.
      retryReason = reasons.join('; ').slice(0, 1000);
    }
    if (onFail === 'skip') return { failed: true, status: lastStatus, reasons, attempts, spentUsd: spentNode };
    deopt('agent', name, { status: lastStatus, reasons, attempts, spentUsd: spentNode });
  }

  // Run one item of map (with a policy) or wide: retries, then 'crash' (rethrow, or the deopt it raised) or 'null'.
  // Returns {ok, value, attempts, error?, deopt?}.
  async function runItem(store, fn, policy) {
    let attempts = 0, last = null;
    for (let k = 0; k <= policy.retries; k++) {
      attempts++;
      try { return { ok: true, value: await items.als.run(store, fn), attempts }; }
      catch (error) { last = error; }
    }
    return { ok: false, attempts, error: last, ...(last instanceof ItemDeopt ? { deopt: last.deopt } : {}) };
  }
  const failItem = r => {
    // 'crash': the operator fails as flow-v2's map would: a deopt raised in the item deopts the run (or the enclosing item).
    if (r.deopt) deopt(r.deopt.kind, r.deopt.name, r.deopt.detail);
    throw r.error;
  };
  const itemStore = (extra = {}) => {
    const outer = items.used ? items.als.getStore() : undefined;
    // A nested item keeps the enclosing wide item's tags and spend accumulators; a policy that does not catch deopts passes
    // them on to an enclosing item that does.
    return { wide: outer?.wide, wideItem: outer?.wideItem, ...extra, acc: [...(outer?.acc ?? []), ...(extra.acc ?? [])], catchDeopt: !!(extra.catchDeopt || outer?.catchDeopt) };
  };

  // flow.map with onItemError and/or reduce (slice 2b item 3b).
  async function mapWithPolicy(list0, fn, { concurrency = 4, name = 'map', onItemError, reduce } = {}) {
    const policy = itemPolicyOf(onItemError);
    if (reduce !== undefined && typeof reduce !== 'function') throw new Error(`flow.map(${name}): reduce must be a function (results, coverage) => value`);
    if (policy.then === 'null' && typeof reduce !== 'function') throw new Error(`flow.map(${name}): onItemError '${onItemError}' needs a reduce(results, coverage) that reports coverage`);
    items.used = true;
    const list = [...list0], out = new Array(list.length).fill(null), status = new Array(list.length).fill('skipped'), tries = new Array(list.length).fill(0), why = [], t0 = Date.now();
    let next = 0, failure = null;
    const worker = async () => {
      while (!failure && next < list.length) {
        const i = next++;
        const r = await runItem(itemStore({ catchDeopt: policy.retries > 0 || policy.then === 'null' }), () => fn(list[i], i), policy);
        tries[i] = r.attempts;
        if (r.ok) { out[i] = r.value; status[i] = 'done'; continue; }
        status[i] = 'failed'; why.push({ i, reason: r.deopt ? `deopt ${r.deopt.kind}: ${r.deopt.name}` : short(r.error) });
        if (policy.then === 'crash') failure ??= r;
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, worker));
    const coverage = coverageOf(status, tries, why);
    event({ kind: 'map', name, n: list.length, concurrency, ok: !failure, ms: Date.now() - t0, onItemError: onItemError ?? 'crash', done: coverage.done, failed: coverage.failed, retried: coverage.retried });
    if (failure) failItem(failure);
    return reduce ? reduce(out, coverage) : out;
  }
  const coverageOf = (status, tries, why) => ({ n: status.length, done: status.filter(s => s === 'done').length, failed: status.filter(s => s === 'failed').length,
    skipped: status.filter(s => s === 'skipped').length, retried: tries.filter(t => t > 1).length,
    items: status.map((s, i) => ({ i, status: s, attempts: tries[i], ...(why.find(w => w.i === i) ? { reason: why.find(w => w.i === i).reason } : {}) })) });

  // flow.wide (FLOW-V3 §2.3, slice 2b item 6): a bounded, typed work list, a worker per item, typed coverage, a code reducer.
  async function wideNode(name, spec) {
    if (typeof name !== 'string' || !name) throw new Error('flow.wide: a name is required');
    const w = spec ?? {};
    if ((w.items === undefined) === (w.plan === undefined)) throw new Error(`flow.wide(${name}): give exactly one of items (a list) or plan (a judge spec)`);
    if (w.items !== undefined && !Array.isArray(w.items) && typeof w.items?.[Symbol.iterator] !== 'function') throw new Error(`flow.wide(${name}): items must be a list`);
    const maxFanout = w.maxFanout ?? DEFAULT_MAX_FANOUT;
    if (!Number.isInteger(maxFanout) || maxFanout < 1 || maxFanout > HARD_MAX_FANOUT) throw new Error(`flow.wide(${name}): maxFanout must be an integer in 1..${HARD_MAX_FANOUT}`);
    const wk = w.worker, kind = typeof wk === 'function' ? 'code' : wk?.judge ? 'judge' : wk?.call ? 'call' : wk?.agent ? 'agent' : null;
    if (!kind) throw new Error(`flow.wide(${name}): worker must be a function or {judge} | {call} | {agent}`);
    if (typeof w.reduce !== 'function') throw new Error(`flow.wide(${name}): reduce (a code reducer (results, coverage) => value) is required`);
    if (w.verify !== undefined && typeof w.verify !== 'function') throw new Error(`flow.wide(${name}): verify must be a code predicate (a panel verifier is not built yet)`);
    for (const k of ['check', 'itemCheck']) if (w[k] !== undefined && typeof w[k] !== 'function') throw new Error(`flow.wide(${name}): ${k} must be a function`);
    // Agent workers run at most two at a time anyway (the host's limit); more in flight would only hold reservations.
    const quorum = w.quorum ?? 1, wideUsd = w.budgetUsd, concurrency = Math.min(w.concurrency ?? 8, maxFanout, kind === 'agent' ? 2 : Infinity), floor = w.itemFloorUsd ?? 0;
    if (!(quorum > 0 && quorum <= 1)) throw new Error(`flow.wide(${name}): quorum must be in (0, 1]`);
    if (typeof wideUsd !== 'number' || !(wideUsd > 0)) throw new Error(`flow.wide(${name}): budgetUsd (the operator's total budget) must be a positive number`);
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error(`flow.wide(${name}): concurrency must be a positive integer`);
    if (typeof floor !== 'number' || floor < 0) throw new Error(`flow.wide(${name}): itemFloorUsd must be a number >= 0`);
    const policy = itemPolicyOf(w.onItemError);
    const ordinal = wides.ordinals.get(name) ?? 0; wides.ordinals.set(name, ordinal + 1);
    const span = `wide:${name}#${ordinal}`, parent = parentSpan(), t0 = Date.now(), acc = { spent: 0 };
    wides.n++; items.used = true;
    const fail = (refused, detail) => { event({ kind: 'wide-end', name, span, parent, ok: false, refused, detail: clip(detail ?? null, 1000), spentUsd: usd(acc.spent), budgetUsd: wideUsd, ms: Date.now() - t0 }); deopt('wide', name, { refused, detail: detail ?? null }); };
    // The operator's budget is checked against what the run has left (the SDK rule); items then spend inside it.
    const no = budgetRefusalOf(wideUsd);
    if (no) { event({ kind: 'wide-start', name, span, parent, budgetUsd: wideUsd, worker: kind }); return fail(no[0], no[1]); }
    event({ kind: 'wide-start', name, span, parent, budgetUsd: wideUsd, worker: kind, maxFanout, concurrency, quorum, onItemError: w.onItemError ?? 'crash', planned: w.plan !== undefined });
    // 1. The work list: given, or planned by one judge with one replan on issues (check, fanout, item schema).
    const issuesOf = list => {
      const issues = [];
      if (!Array.isArray(list)) return ['the plan is not a list'];
      if (list.length > maxFanout) issues.push(`${list.length} items; at most ${maxFanout}`);
      if (w.itemSchema) list.forEach((x, i) => { for (const e of schemaErrors(w.itemSchema, x, `items[${i}]`)) if (issues.length < 8) issues.push(e); });
      if (w.check) { const v = verdictOf(() => w.check(list)); if (!v.ok) issues.push(...v.reasons); }
      return issues;
    };
    let list, issues, replanned = false;
    if (w.plan !== undefined) {
      const ask = async extra => { const p = typeof w.plan.prompt === 'string' ? w.plan.prompt : JSON.stringify(w.plan.prompt);
        const v = await flow.judge(`${name}:plan`, { ...w.plan, prompt: extra ? `${p}\n\nThe previous list had these problems; fix them:\n- ${extra.join('\n- ')}` : p });
        return Array.isArray(v) ? v : v?.items; };
      list = await items.als.run(itemStore({ acc: [acc] }), () => ask(null));
      issues = issuesOf(list);
      if (issues.length) { replanned = true; list = await items.als.run(itemStore({ acc: [acc] }), () => ask(issues)); issues = issuesOf(list); }
    } else { list = [...w.items]; issues = issuesOf(list); }
    const n = Array.isArray(list) ? list.length : 0;
    event({ kind: 'wide-plan', name, span, n, digest: digest(list), issues: issues.slice(0, 8), replanned, planned: w.plan !== undefined, spentUsd: usd(acc.spent) });
    if (issues.length) return fail(Array.isArray(list) && list.length > maxFanout ? 'fanout' : w.itemSchema && issues.some(x => /^items\[/.test(x)) ? 'item-schema' : 'check-failed', { issues: issues.slice(0, 8) });
    if (floor > 0 && n * floor > wideUsd - acc.spent + 1e-12) return fail('BUDGET_TOO_SMALL', { n, itemFloorUsd: floor, budgetUsd: wideUsd, spentUsd: usd(acc.spent) });
    if (kind === 'agent' && n > 16) return fail('agent-workers-over-limit', { n, maxAgents: 16 });
    // 2. The items. Judge workers with one prompt prefix (model, system, schema, reasoning) share it: siblings wait for the
    // first response of their group (at most prefixHoldMs), so they read one cached prefix (6b).
    const out = new Array(n).fill(null), status = new Array(n).fill('skipped'), tries = new Array(n).fill(0), why = [], groups = new Map(), prefix = { groups: 0, held: 0, heldMs: 0 };
    const holdMs = w.prefixHoldMs ?? DEFAULT_PREFIX_HOLD_MS, share = kind === 'judge' && w.prefixShare !== false;
    let next = 0, failure = null, inFlight = 0, doneCost = 0, doneN = 0;
    const runWorker = (item, i) => {
      if (kind === 'code') return wk(item, i, { name, span });
      if (kind === 'judge') {
        const j = wk.judge, at = f => (typeof f === 'function' ? f(item, i) : f);
        return flow.judge(`${name}:item`, { ...j, system: at(j.system ?? ''), prompt: at(j.prompt), ...(j.check ? { check: v => j.check(v, item, i) } : {}) });
      }
      if (kind === 'call') {
        const c = wk.call, at = f => (typeof f === 'function' ? f(item, i) : f);
        return callNode(c.hash, c.input ? c.input(item, i) : item, { ...c, hash: undefined, input: undefined, name: at(c.name) ?? `${name}-${i}`, prompt: at(c.prompt), verify: c.verify ? (v, x) => c.verify(v, { ...x, item, i }) : undefined });
      }
      const ag = wk.agent;
      return agentNode(ag.name ? ag.name(item, i) : `${name}-${i}`, ag.spec(item, i), ag.opts ? (typeof ag.opts === 'function' ? ag.opts(item, i) : ag.opts) : {});
    };
    const gateOf = item => {
      if (!share) return null;
      const j = wk.judge;
      const key = canonical({ model: j.tiers?.[0], system: typeof j.system === 'function' ? null : j.system ?? '', schema: j.schema, reasoning: j.reasoning ?? 'none' });
      if (typeof j.system === 'function') return null;   // a per-item system prompt has no shared prefix
      let g = groups.get(key);
      if (!g) {
        let resolve; g = { isOpen: false, released: new Promise(r => { resolve = r; }), open: () => { g.isOpen = true; resolve(); } };
        groups.set(key, g); prefix.groups++; return { leader: g };
      }
      return g.isOpen ? null : { follower: g };
    };
    const worker = async () => {
      while (!failure && next < n) {
        // Budget: an item starts only while the operator's spend plus an estimate for the items in flight and this one fits.
        const est = Math.max(floor, doneN ? doneCost / doneN : 0);
        if (acc.spent >= wideUsd - 1e-12 || acc.spent + (inFlight + 1) * est > wideUsd + 1e-12) break;
        const i = next++, item = list[i], t1 = Date.now(), gate = gateOf(item), itemAcc = { spent: 0 };
        let held = 0;
        if (gate?.follower) {
          const h0 = Date.now();
          let timer; await Promise.race([gate.follower.released, new Promise(r => { timer = setTimeout(r, holdMs); })]); clearTimeout(timer);
          held = Math.max(1, Date.now() - h0); prefix.held++; prefix.heldMs += held;
        }
        inFlight++;
        const r = await runItem(itemStore({ wide: span, wideItem: i, acc: [acc, itemAcc], catchDeopt: policy.retries > 0 || policy.then === 'null' }), async () => {
          try { return await runWorker(item, i); } finally { gate?.leader?.open(); }
        }, policy);
        inFlight--;
        let ok = r.ok, reason = null;
        if (ok && w.itemCheck) { const v = verdictOf(() => w.itemCheck(r.value, item, i)); if (!v.ok) { ok = false; reason = `item check: ${v.reasons.join('; ')}`; } }
        tries[i] = r.attempts; doneCost += itemAcc.spent; doneN++;
        if (ok) { out[i] = r.value; status[i] = 'done'; }
        else { status[i] = 'failed'; reason ??= r.deopt ? `deopt ${r.deopt.kind}: ${r.deopt.name}` : short(r.error); why.push({ i, reason }); }
        event({ kind: 'wide-item', name, span, i, status: status[i], attempts: r.attempts, costUsd: usd(itemAcc.spent), ms: Date.now() - t1, ...(held ? { heldMs: held } : {}),
          ...(ok ? { outDigest: digest(r.value) } : { reason: String(reason).slice(0, 300) }) });
        if (!ok && policy.then === 'crash') failure ??= r.ok ? { ok: false, error: new Error(`flow.wide(${name}) item ${i}: ${reason}`) } : r;
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, n)) }, worker));
    for (const g of groups.values()) g.open();
    if (failure) { event({ kind: 'wide-end', name, span, parent, ok: false, failedItem: true, spentUsd: usd(acc.spent), budgetUsd: wideUsd, ms: Date.now() - t0 }); failItem(failure); }
    // 3. Typed coverage, quorum, the code reducer, the verify.
    const coverage = coverageOf(status, tries, why);
    if (n && coverage.done / n < quorum) return fail('quorum', { done: coverage.done, failed: coverage.failed, skipped: coverage.skipped, n, quorum });
    const value = await items.als.run(itemStore({ acc: [acc] }), () => w.reduce(out, coverage));
    event({ kind: 'wide-reduce', name, span, done: coverage.done, failed: coverage.failed, skipped: coverage.skipped, retried: coverage.retried, outDigest: digest(value) });
    if (w.verify) {
      const v = verdictOf(() => w.verify(value, { coverage, items: list }));
      event({ kind: 'wide-verify', name, span, verifier: 'code', ok: v.ok, ...(v.ok ? {} : { reasons: v.reasons }) });
      if (!v.ok) return fail('verify', { reasons: v.reasons });
    }
    event({ kind: 'wide-end', name, span, parent, ok: true, n, done: coverage.done, failed: coverage.failed, skipped: coverage.skipped, spentUsd: usd(acc.spent), budgetUsd: wideUsd,
      ms: Date.now() - t0, ...(prefix.groups ? { prefix } : {}) });
    return value;
  }

  return flow;
}
