// Interactive environment for the n8n:20281 job (bed contract: createEnv). One episode = the scenario list of the task in order, each in a fresh world.
// The solver sees ONE new mail at a time (a Gmail trigger item or a Microsoft Graph message), answers with service calls, and ends the run with {call:'done'}.
// It never sees labels, case ids, the scenario it is in, or the faults. The environment is deterministic (D0) for the recorded model; with a live
// modelBackend the observed answers are kept in the record (modelTape) so the oracle can replay the episode exactly.
import { World, API_OPS, WRITE_OPS } from './mocks/world.mjs';
import { scenariosFor, fixtures } from './scenarios.mjs';
import { CALL_CAP, MODEL_CALL_CAP } from './spec.mjs';
import { clone } from './mocks/common.mjs';
import { hashOf } from '../../../../beds/lib/canonical.mjs';

// Records of live-model episodes made by THIS process (host side). The oracle replays a model tape only from such a record (or when host code passes
// trustModelTape): a tape in a solver-supplied output is otherwise ignored, so it cannot set the model's answers or cost (v0.2.0).
const HOST_TAPES = new Set();
export const hostRecordedTape = out => Array.isArray(out?.modelTape) && Array.isArray(out?.actions) && HOST_TAPES.has(hashOf({ actions: out.actions, modelTape: out.modelTape }));

export { API_OPS };
export const LIMITS = Object.freeze({ callsPerRun: CALL_CAP, modelCallsPerRun: MODEL_CALL_CAP });

export function scenarioList(task) { return scenariosFor({ seed: task.seed, split: task.split, difficulty: task.difficulty, variant: task.variant }); }

export function createEnv(task, { modelBackend = null, modelTape = null } = {}) {
  const { config, scenarios } = scenarioList(task);
  const { recordings } = fixtures();
  let si = 0, ei = -1, world = null, current = null, callsInRun = 0, modelCallsInRun = 0, done = false, last = null;
  let records = [], sr = null, er = null, episode = [], tape = [];

  const startScenario = i => {
    si = i; ei = -1;
    const sc = scenarios[i];
    world = new World({ config, entries: sc.entries, recordings, seeds: sc.seeds, nextIssueNumber: sc.nextIssueNumber, faults: sc.faults, modelBackend, modelTape });
    sr = { id: sc.id, kind: sc.kind, entries: sc.entries.map(e => ({ caseId: e.caseId, ref: e.ref, provider: e.provider, thread: e.thread, id: e.provider === 'gmail' ? e.mail.id : e.mail.id,
      threadId: e.provider === 'gmail' ? e.mail.threadId : e.mail.conversationId, fromEmail: e.provider === 'gmail' ? e.mail.from.value[0].address : e.mail.from.emailAddress.address,
      fromName: (e.provider === 'gmail' ? e.mail.from.value[0].name : e.mail.from.emailAddress.name) ?? '',
      subject: e.mail.subject, plain: e.plain })), events: [], dump: null };
    records.push(sr);
  };
  const closeScenario = () => { sr.dump = world.dump(); };
  const advance = () => {
    for (;;) {
      if (current) return;
      const sc = scenarios[si];
      if (ei + 1 < sc.events.length) {
        ei++;
        const ev = sc.events[ei];
        current = { seq: ev.seq, trigger: ev.trigger, at: ev.at, data: sc.entries[ev.entryIndex].mail, entryIndex: ev.entryIndex };
        callsInRun = 0; modelCallsInRun = 0;
        er = { seq: ev.seq, entryIndex: ev.entryIndex, calls: [], capped: false, answered: false };
        sr.events.push(er);
        return;
      }
      closeScenario();
      if (si + 1 < scenarios.length) { startScenario(si + 1); continue; }
      done = true; return;
    }
  };
  const view = () => ({ done, event: current ? { seq: current.seq, trigger: current.trigger, at: current.at, data: clone(current.data) } : null, response: last });
  const out = extra => ({ observation: view(), done, reward: 0, info: extra });

  const env = {
    determinism: 'D0',
    reset() { records = []; episode = []; tape = []; done = false; current = null; last = null; startScenario(0); advance(); return view(); },
    observe: view,
    step(action) {
      if (done) return out({ ignored: true });
      episode.push(clone(action));
      const name = action && typeof action.call === 'string' ? action.call : null;
      if (name === 'done') { er.answered = true; current = null; last = null; advance(); return out({ outcome: 'done' }); }
      if (!name) { last = { status: 400, body: { error: 'BAD_ACTION', message: 'an action is {call, args}' } }; er.calls.push({ name: String(name), bad: true, status: 400, effects: [] }); return out({ outcome: 'invalid' }); }
      if (++callsInRun > LIMITS.callsPerRun || (name === 'model.complete' && ++modelCallsInRun > LIMITS.modelCallsPerRun)) {
        er.capped = true; last = { status: 429, body: { error: 'CALL_CAP', message: `at most ${LIMITS.callsPerRun} calls (${LIMITS.modelCallsPerRun} model calls) per mail` } };
        er.calls.push({ name, bad: false, capped: true, status: 429, effects: [] });
        return out({ outcome: 'capped' });
      }
      const args = action.args ?? {};
      const { response, meta } = world.call(name, args);
      last = response;
      if (name === 'model.complete' && modelBackend) tape.push(clone({ status: response.status, body: response.body, latencyMs: meta.latencyMs }));
      er.calls.push({ name, args: clone(args), status: response.status, known: meta.known, latencyMs: meta.latencyMs, usage: meta.usage, costUsd: meta.costUsd, effects: meta.effects, write: WRITE_OPS.has(name),
        ...(name === 'model.complete' && response.status === 200 ? { answer: clone(response.body?.content ?? null) } : {}) });
      return out({ outcome: 'call', status: response.status });
    },
    actions: () => (done ? [] : [...API_OPS, 'done'].sort()),
    snapshot: () => clone({ si, ei, world: world.snapshot(), current, callsInRun, modelCallsInRun, done, last, records, episode, tape }),
    restore(s) {
      const c = clone(s);
      si = c.si; ei = c.ei; current = c.current; callsInRun = c.callsInRun; modelCallsInRun = c.modelCallsInRun; done = c.done; last = c.last; records = c.records; episode = c.episode; tape = c.tape;
      const sc = scenarios[si];
      world = new World({ config, entries: sc.entries, recordings, seeds: sc.seeds, nextIssueNumber: sc.nextIssueNumber, faults: sc.faults, modelBackend, modelTape });
      world.restore(c.world);
      sr = records[si]; er = sr.events[sr.events.length - 1] ?? null;
    },
    record: () => {
      const r = { actions: clone(episode), ...(modelBackend ? { modelTape: clone(tape) } : {}) };
      if (modelBackend) HOST_TAPES.add(hashOf(r));
      return r;
    },
    // Host side only (never hand these to a solver).
    _records: () => records,
    _config: () => config,
    _scenarios: () => scenarios,
  };
  return env;
}

// Replays an episode record in a fresh environment; runs left without an answer end with no effect.
export function replay(task, actions, { modelTape = null } = {}) {
  const env = createEnv(task, { modelTape });
  env.reset();
  let n = 0;
  for (const a of actions) { if (env.observe().done) break; env.step(a); n++; }
  let unanswered = 0;
  while (!env.observe().done) { env.step({ call: 'done' }); unanswered++; }
  return { env, replayed: n, unanswered };
}

const makeApi = call => {
  const api = { call };
  for (const name of API_OPS) { const [svc, op] = name.split('.'); (api[svc] ??= {})[op] = args => call(name, args); }
  return api;
};
// Drives a handler `(event, api) -> void` through the environment and returns the episode record. driveSync needs a handler without promises.
export function driveSync(task, handler, opts = {}) {
  const env = createEnv(task, opts);
  let obs = env.reset();
  const handlerErrors = [];
  const api = makeApi((name, args) => clone(env.step({ call: name, args: clone(args ?? {}) }).observation.response));
  while (!obs.done) {
    try { const r = handler(clone(obs.event), api); if (r && typeof r.then === 'function') throw new Error('driveSync: handler returned a promise; use drive()'); }
    catch (e) { handlerErrors.push(String(e?.message ?? e).slice(0, 200)); }
    obs = env.step({ call: 'done' }).observation;
  }
  return { ...env.record(), meta: { handlerErrors: handlerErrors.slice(0, 20), handlerErrorCount: handlerErrors.length } };
}
export async function drive(task, handler, opts = {}) {
  const env = createEnv(task, opts);
  let obs = env.reset();
  const handlerErrors = [];
  const api = makeApi((name, args) => Promise.resolve(clone(env.step({ call: name, args: clone(args ?? {}) }).observation.response)));
  while (!obs.done) {
    try { await handler(clone(obs.event), api); } catch (e) { handlerErrors.push(String(e?.message ?? e).slice(0, 200)); }
    obs = env.step({ call: 'done' }).observation;
  }
  return { ...env.record(), meta: { handlerErrors: handlerErrors.slice(0, 20), handlerErrorCount: handlerErrors.length } };
}

// A pure step policy ({event, history} -> {call, args} | {done: true}) is what a Foundry `code` node can express today (code nodes are pure: no network).
// This adapter replays the policy with the growing call history until it says done.
export function policyHandler(policy, { maxSteps = LIMITS.callsPerRun } = {}) {
  return (event, api) => {
    const history = [];
    for (let i = 0; i < maxSteps; i++) {
      const next = policy({ event, history: clone(history) });
      if (!next || next.done) return;
      const [svc, op] = String(next.call).split('.');
      const response = api[svc]?.[op] ? api[svc][op](next.args) : { status: 400, body: { error: 'UNKNOWN_CALL' } };
      history.push({ call: next.call, args: next.args, response });
    }
  };
}
