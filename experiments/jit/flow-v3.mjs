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
export const callKeyOf = ({ callee, inputDigest, parentPath }) => sha(canonical({ callee, inputDigest, parentPath }));
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
  const sub = { n: 0, reservedUsd: 0, ordinals: new Map() };   // flow-v3 calls: count, budget held by calls in flight, span ordinals
  let seen = 0;   // bytes of calls.jsonl already charged
  try { seen = readFileSync(CALLS).length; } catch {}

  // Inside a call scope every event carries the scope's span and parent (unless it names its own, as call-* events do);
  // outside one (every flow-v2 run) nothing is added.
  function event(e) {
    if (state.events >= MAX_EVENTS && !['done', 'deopt', 'crash'].includes(e.kind)) { state.dropped++; return; }
    state.events++;
    const line = scope && e.span === undefined ? { at: new Date().toISOString(), ...e, span: scope.span, parent: scope.parent ?? null } : { at: new Date().toISOString(), ...e };
    try { appendFileSync(TRACE, JSON.stringify(line) + '\n'); } catch {}
  }
  const totals = () => ({ spentUsd: usd(state.spentUsd), calls: state.calls, unknownCostCalls: state.unknownCostCalls, judges: state.judges,
    guards: state.guards, invariants: state.invariants, ms: Date.now() - state.started, ...(state.dropped ? { droppedEvents: state.dropped } : {}),
    ...(state.flags ? { flags: state.flags, flagNames: state.flagNames } : {}), ...(sub.n ? { childCalls: sub.n } : {}) });

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

    async map(items, fn, { concurrency = 4, name = 'map' } = {}) {
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

    // flow-v3: a nested compiled workflow by library hash, run by the host (see the header). Returns the callee's typed
    // output; on a refusal or a child deopt it deopts this run with kind 'call', or returns {refused, detail} /
    // {deopt, status} to the caller's code when onRefuse / onDeopt is 'value' (the caller's fallback).
    async call(ref, input, opts = {}) {
      const callee = typeof ref === 'string' ? ref : ref?.hash, name = opts?.name ?? opts?.label;
      if (typeof callee !== 'string' || !callee) throw new Error('flow.call: ref must be a library hash or { hash }');
      if (typeof name !== 'string' || !name) throw new Error(`flow.call(${callee.slice(0, 24)}): opts.name (the span name) is required`);
      const { budgetUsd: childUsd, timeoutMs = 120000, onDeopt = 'propagate', onRefuse = 'deopt' } = opts;
      if (typeof childUsd !== 'number' || !(childUsd > 0)) throw new Error(`flow.call(${name}): budgetUsd must be a positive number`);
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error(`flow.call(${name}): timeoutMs must be a positive integer`);
      if (!['propagate', 'value'].includes(onDeopt)) throw new Error(`flow.call(${name}): onDeopt must be 'propagate' or 'value' ('interpret-child' is not in slice 1)`);
      if (!['deopt', 'value'].includes(onRefuse)) throw new Error(`flow.call(${name}): onRefuse must be 'deopt' or 'value'`);
      if (JSON.stringify(input) === undefined) throw new Error(`flow.call(${name}): input must be JSON`);
      // The span id is fixed before the first await, so concurrent calls (inside map) get ordinals in call order.
      const ordinal = sub.ordinals.get(name) ?? 0; sub.ordinals.set(name, ordinal + 1);
      const span = `call:${name}#${ordinal}`, parent = scope?.span ?? ROOT_SPAN, parentPath = scope?.path ?? ROOT_SPAN, depth = (scope?.depth ?? 0) + 1;
      const inputDigest = inputDigestOf(input), key = callKeyOf({ callee, inputDigest, parentPath }), t0 = Date.now();
      sub.n++;
      event({ kind: 'call-start', name, span, parent, callee, inputDigest, budgetUsd: childUsd, depth, key });
      const end = (kind, extra) => event({ kind, name, span, parent, callee, ...extra, ms: Date.now() - t0 });
      const refuse = (refused, detail, extra = { spentUsd: 0, reservedUsd: 0 }) => {
        end('call-refused', { ok: false, refused, detail: clip(detail ?? null, 1000), ...extra });
        if (onRefuse === 'value') return { refused, detail: detail ?? null };
        deopt('call', name, { callee, refused, detail: detail ?? null });
      };
      // The SDK's own check (as judge checks the soft budget): a child reservation is strictly below what remains.
      const remaining = budgetUsd - state.spentUsd - sub.reservedUsd;
      if (!(childUsd < remaining)) return refuse('budget-exceeds-parent', { budgetUsd: childUsd, remainingUsd: usd(remaining) }, { by: 'sdk', spentUsd: 0, reservedUsd: 0 });
      sub.reservedUsd += childUsd;
      let r = null, error = null;
      try {
        r = await callModel({ model: CALL_MODEL, prompt: JSON.stringify({ v: CALL_PROTOCOL, op: 'call', callee, input, name, span, parent, budgetUsd: childUsd, timeoutMs, key }), schema: { type: 'object' } });
      } catch (e) { error = short(e); } finally { sub.reservedUsd = Math.max(0, sub.reservedUsd - childUsd); }
      const cost = usd(charge());
      if (error != null) {
        // The gateway refused the request for budget: this run's own budget is spent, as for a judge.
        if (/model call failed: 402\b/.test(error)) {
          end('call-refused', { ok: false, refused: 'gateway-budget', detail: error.slice(0, 300), spentUsd: cost, reservedUsd: childUsd });
          deopt('budget', name, { gateway: 'budget exhausted', callee, spentUsd: usd(state.spentUsd) });
        }
        const d = { kind: 'host-error', name, detail: error };
        end('call-deopt', { ok: false, status: 'host-error', deopt: { kind: d.kind, name }, detail: error, spentUsd: cost, reservedUsd: childUsd });
        if (onDeopt === 'value') return { deopt: d, status: 'host-error' };
        deopt('call', name, { callee, status: 'host-error', child: d });
      }
      const common = { spentUsd: cost, reservedUsd: childUsd, ...(r?.calleeVersion != null ? { calleeVersion: r.calleeVersion } : {}),
        ...(r?.childTrace ? { childTrace: r.childTrace, childTraceSha256: r.childTraceSha256 ?? null } : {}), ...(r?.memo ? { memo: r.memo } : {}) };
      if (r?.status === 'ok') { end('call-end', { ok: true, outDigest: digest(r.output), ...common }); return r.output; }
      if (r?.status === 'refused') return refuse(String(r.refused), r.detail ?? null, common);
      const d = r?.deopt && typeof r.deopt === 'object' ? r.deopt : { kind: 'unknown', name: null, detail: 'the host answered without a status' };
      end('call-deopt', { ok: false, status: String(r?.status ?? 'unknown'), deopt: { kind: d.kind, name: d.name ?? null }, detail: clip(d.detail ?? null, 1000), ...common });
      if (onDeopt === 'value') return { deopt: d, status: r?.status ?? 'unknown' };
      deopt('call', name, { callee, status: r?.status ?? 'unknown', child: { kind: d.kind, name: d.name ?? null, detail: clip(d.detail ?? null, 1000) } });
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
  return flow;
}
