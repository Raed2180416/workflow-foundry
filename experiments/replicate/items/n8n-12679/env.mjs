// Interactive environment for the n8n:12679 job (bed contract: createEnv). One episode = the scripted scenarios in
// order, each in a fresh world. The solver sees one trigger event at a time and answers with API calls; the
// call `done` ends the run for that event. Between events the environment applies the scenario script (people
// working in the two UIs), delivers the resulting events FIFO, and moves on when the systems are quiet.
//
// The environment never shows the solver which scenario it is in, who caused an event (UI or API), or the expectation.
import { World, API_OPS, WRITE_OPS } from './world.mjs';
import { scenariosFor, CONFIG } from './scenarios.mjs';
import { normEmail, clone } from './mocks/common.mjs';

export const LIMITS = Object.freeze({ runsPerQuiescence: CONFIG.limits.runsPerQuiescence, callsPerRun: CONFIG.limits.callsPerRun });

export function scenarioList(task) {
  const { core, probes } = scenariosFor({ seed: task.seed, split: task.split, difficulty: task.difficulty });
  return task.variant === 'T3' ? [...core, ...probes] : core;
}

export function createEnv(task) {
  const list = scenarioList(task);
  const cfg = CONFIG;
  let si = 0, stepIdx = -1, world = null, current = null, runsInBlock = 0, blockBudget = 0, callsInRun = 0, blockOpen = false, blockCapped = false, skipped = [], done = false, last = null;
  let records = [], sr = null, runRec = null, episode = [];

  const startScenario = i => {
    si = i; stepIdx = -1;
    const sc = list[i];
    world = new World({ cfg, seed: task.seed, scenarioId: sc.id });
    for (const a of sc.setup) world.ui(a);
    world.queue.length = 0; world.history.length = 0;   // pre-existing state generates no events
    sr = { id: sc.id, kind: sc.kind, steps: [], calls: [], events: [], runs: 0 };
    records.push(sr);
  };
  const openStep = i => {
    stepIdx = i; runsInBlock = 0; blockOpen = true; blockCapped = false; skipped = [];
    for (const a of list[si].steps[i].actions) { const r = world.ui(a); if (r.skipped) skipped.push(r.skipped); }
    blockBudget = LIMITS.runsPerQuiescence * Math.max(1, world.queue.length);   // 20 runs per originating change
  };
  const closeBlock = () => {
    sr.steps.push({ label: list[si].steps[stepIdx].label, state: world.dump(), refs: clone(world.refs), capped: blockCapped, runs: runsInBlock, skipped });
    blockOpen = false;
  };
  const advance = () => {
    for (;;) {
      if (current) return;
      if (world.queue.length) {
        if (runsInBlock >= blockBudget) { blockCapped = true; world.queue.length = 0; continue; }
        current = world.queue.shift(); runsInBlock++; callsInRun = 0; sr.runs++;
        runRec = { step: stepIdx, seq: current.seq, trigger: current.trigger, origin: current.actor === 'api' ? 'api' : 'ui' };
        sr.events.push({ ...runRec, data: current.data });
        return;
      }
      if (blockOpen) closeBlock();
      if (stepIdx + 1 < list[si].steps.length) { openStep(stepIdx + 1); continue; }
      if (si + 1 < list.length) { startScenario(si + 1); openStep(0); continue; }
      done = true; return;
    }
  };
  const view = () => ({ done, event: current ? { seq: current.seq, trigger: current.trigger, data: clone(current.data) } : null, response: last });
  const out = extra => ({ observation: view(), done, reward: 0, info: extra });

  const env = {
    determinism: 'D0',
    reset() {
      records = []; episode = []; done = false; current = null; last = null;
      startScenario(0); openStep(0); advance();
      return view();
    },
    observe: view,
    step(action) {
      if (done) return out({ ignored: true });
      episode.push(clone(action));
      const name = action && typeof action.call === 'string' ? action.call : null;
      if (name === 'done') { current = null; last = null; advance(); return out({ outcome: 'done' }); }
      if (!name) { last = { status: 400, body: { error: 'BAD_ACTION', message: 'an action is {call, args}' } }; sr.calls.push({ ...runRec, name: String(name), status: 400, write: false, effective: false, bad: true }); return out({ outcome: 'invalid' }); }
      if (++callsInRun > LIMITS.callsPerRun) { last = { status: 429, body: { error: 'CALL_CAP', message: `more than ${LIMITS.callsPerRun} calls in one run` } }; sr.calls.push({ ...runRec, name, status: 429, write: false, effective: false, capped: true }); return out({ outcome: 'capped' }); }
      let dupOf = null;
      if (name === 'zoho.createContact') {
        const want = normEmail(action.args?.fields?.Email);
        if (want) for (const c of world.zoho.contacts.values()) if (normEmail(c.Email) === want) dupOf = c.id;
      }
      const { response, effective, emitted } = world.call(name, action.args);
      last = response;
      sr.calls.push({ ...runRec, name, status: response.status, write: WRITE_OPS.has(name), effective, emitted, bad: !API_OPS.includes(name), ...(dupOf && response.status < 300 ? { dupOf } : {}) });
      return out({ outcome: 'call', status: response.status });
    },
    actions: () => (done ? [] : [...API_OPS, 'done'].sort()),
    snapshot: () => clone({ si, stepIdx, world: world.snapshot(), current, runsInBlock, blockBudget, callsInRun, blockOpen, blockCapped, skipped, done, last, records, runRec, episode }),
    restore(s) {
      const c = clone(s);
      si = c.si; stepIdx = c.stepIdx; current = c.current; runsInBlock = c.runsInBlock; blockBudget = c.blockBudget; callsInRun = c.callsInRun; blockOpen = c.blockOpen; blockCapped = c.blockCapped; skipped = c.skipped;
      done = c.done; last = c.last; records = c.records; runRec = c.runRec; episode = c.episode;
      world = new World({ cfg, seed: task.seed, scenarioId: list[si].id }); world.restore(c.world);
      sr = records[si];
    },
    record: () => ({ actions: clone(episode) }),
    // Host-side only: per-scenario facts for the judge. Never hand this to a solver.
    _records: () => records,
    _scenarios: () => list,
  };
  return env;
}

// Replays an episode record in a fresh environment; actions beyond the end are `done` (the solver stopped answering).
export function replay(task, actions) {
  const env = createEnv(task);
  env.reset();
  let n = 0;
  for (const a of actions) { if (env.observe().done) break; env.step(a); n++; }
  let idle = 0;
  while (!env.observe().done) { env.step({ call: 'done' }); idle++; }
  return { env, replayed: n, unansweredRuns: idle };
}

// Drives a handler (event, api) -> void through the environment and returns the episode record.
// A sync handler (no promises) can use driveSync; an async one drive.
const makeApi = call => {
  const api = {};
  for (const name of API_OPS) {
    const [svc, op] = name.split('.');
    (api[svc] ??= {})[op] = args => call(name, args);
  }
  return api;
};
export function driveSync(task, handler) {
  const env = createEnv(task);
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
export async function drive(task, handler) {
  const env = createEnv(task);
  let obs = env.reset();
  const handlerErrors = [];
  const api = makeApi((name, args) => clone(env.step({ call: name, args: clone(args ?? {}) }).observation.response));   // calls are synchronous; `await` on them is harmless
  while (!obs.done) {
    try { await handler(clone(obs.event), api); } catch (e) { handlerErrors.push(String(e?.message ?? e).slice(0, 200)); }
    obs = env.step({ call: 'done' }).observation;
  }
  return { ...env.record(), meta: { handlerErrors: handlerErrors.slice(0, 20), handlerErrorCount: handlerErrors.length } };
}

// A pure step policy ({event, history} -> {call, args} | {done:true}) is what a Foundry `code` node can express today
// (code nodes are pure: no network). This adapter replays the policy with the growing call history until it says done.
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

// The reverse transform, to show the pure-policy protocol can express any sync handler: policyFromHandler(h) is a pure function of
// {event, history} that replays h against the recorded responses and returns the first call it makes beyond the history (or done).
// h must be deterministic in its calls and must not swallow exceptions.
export function policyFromHandler(handler) {
  return ({ event, history }) => {
    let i = 0;
    const api = makeApi((name, args) => {
      if (i < history.length) {
        const h = history[i++];
        if (h.call !== name || JSON.stringify(h.args ?? {}) !== JSON.stringify(args ?? {})) throw new Error('handler is not deterministic in its calls');
        return clone(h.response);
      }
      throw Object.assign(new Error('NEED_CALL'), { need: { call: name, args: clone(args ?? {}) } });
    });
    try { handler(clone(event), api); return { done: true }; } catch (e) { if (e.need) return e.need; throw e; }
  };
}
