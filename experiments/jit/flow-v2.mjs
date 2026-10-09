// flow-v2.mjs: version 2 of the small SDK that compiled solvers (solve.mjs) are written against (research/jit-20261008/SPEC.md
// §2). It is copied to tools/flow.mjs beside tools/model.mjs, for arms with compile.promptVersion 2 only (prompts.mjs
// flowFileOf). Plain ESM, no dependencies; its only model access is callModel. It is flow.mjs (version 1, frozen: live
// streams record its hash and their builders read it) plus uncertainty flags: flow.flag and createFlow({ autoFlag }).
// A solver that never flags gets the same trace, stdout and exit code under both versions.
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
// Exit codes: 0 after done(); 75 = deopt (./deopt.json {kind: guard|invariant|judge|budget, name, detail}); anything else
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
  let seen = 0;   // bytes of calls.jsonl already charged
  try { seen = readFileSync(CALLS).length; } catch {}

  function event(e) {
    if (state.events >= MAX_EVENTS && !['done', 'deopt', 'crash'].includes(e.kind)) { state.dropped++; return; }
    state.events++;
    try { appendFileSync(TRACE, JSON.stringify({ at: new Date().toISOString(), ...e }) + '\n'); } catch {}
  }
  const totals = () => ({ spentUsd: usd(state.spentUsd), calls: state.calls, unknownCostCalls: state.unknownCostCalls, judges: state.judges,
    guards: state.guards, invariants: state.invariants, ms: Date.now() - state.started, ...(state.dropped ? { droppedEvents: state.dropped } : {}),
    ...(state.flags ? { flags: state.flags, flagNames: state.flagNames } : {}) });

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
