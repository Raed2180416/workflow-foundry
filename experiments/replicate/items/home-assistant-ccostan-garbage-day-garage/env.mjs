// Interactive environment for the garbage-day job (beds/CONTRACT.md: createEnv). One episode = the scripted scenarios in order, each
// against a fresh mock Home Assistant on a virtual clock. The solver sees ONE EVENT AT A TIME (a door-group change, a notification
// action from the phone, or one of its own scheduled wake-ups), answers with calls, and ends the run with {call:'done'}. Calls are
// instantaneous in virtual time; there is no blocking sleep, a wait is a scheduled wake-up. Between runs the environment moves the
// clock to the next due item: scripted people and devices first, then internal integrations (a timer finishing), then the solver's
// wake-ups, FIFO among equals.
//
// The environment never tells the solver which scenario it is in, who caused a change, or what is expected. The first event of
// a scenario carries fresh:true (new Home Assistant, empty kv).
import { clone, PRI } from './mocks/ha-core.mjs';
import { buildGarageWorld } from './mocks/garage-world.mjs';
import { scenariosFor } from './scenarios.mjs';
import { CONFIG, LIMITS } from './spec.mjs';

export const API_OPS = Object.freeze(['ha.get_state', 'ha.call_service', 'sched.set', 'sched.cancel', 'kv.get', 'kv.put']);
// "Self-inflicted work" for the T3 cost target: the load a solution puts on the scheduler and on Home Assistant besides the service calls
// the job itself needs (wake-ups delivered are added by the oracle). kv operations are bookkeeping and are not counted, so a stateless
// design is not penalised for keeping its memory in kv.
export const WORK_OPS = Object.freeze(new Set(['sched.set', 'sched.cancel', 'ha.get_state']));

export function scenarioList(task) {
  const { core, probes } = scenariosFor({ seed: task.seed, split: task.split, difficulty: task.difficulty });
  return task.variant === 'T3' ? [...core, ...probes] : core;
}

const subscribed = o => (o.type === 'state_changed' ? CONFIG.subscribe.states.includes(o.entity_id) : CONFIG.subscribe.events.includes(o.event_type));
const freshStats = () => ({ runs: 0, calls: 0, stateReads: 0, kvOps: 0, wakesSet: 0, wakesCancelled: 0, serviceCalls: 0, bad: 0, rejected: 0, capped: false, work: 0 });

export function createEnv(task, scenarios = scenarioList(task)) {
  let si = -1, sc = null, world = null, deliveries = [], current = null, stats = freshStats(), kv = new Map(), done = false, last = null;
  let callsInRun = 0, eventSeq = 0, fresh = true, episode = [], records = [], wakeLog = [], events = [];

  const stamp = o => ({ seq: ++eventSeq, ...o, at: world.at() });
  const startScenario = i => {
    si = i; sc = scenarios[i];
    world = buildGarageWorld({ start: sc.start, faults: sc.faults });
    world.scheduleScript(sc.script);
    deliveries = []; current = null; stats = freshStats(); kv = new Map(); callsInRun = 0; eventSeq = 0; fresh = true; wakeLog = []; events = [];
  };
  const closeScenario = () => {
    records.push({ id: sc.id, kind: sc.kind, calls: clone(world.calls), log: clone(world.log), stats: { ...stats }, wakes: clone(wakeLog), events: clone(events), scriptTimes: sc.script.map(e => e.t), end: world.t });
  };
  const advance = () => {
    for (;;) {
      if (current) return;
      if (stats.runs >= LIMITS.runsPerScenario && (deliveries.length || world.peek())) { stats.capped = true; deliveries = []; world.queue.length = 0; }
      if (deliveries.length) {
        current = deliveries.shift(); stats.runs++; callsInRun = 0; last = null;
        if (fresh) { current = { ...current, fresh: true }; fresh = false; }
        events.push({ t: world.t, event: clone(current) });
        return;
      }
      const next = world.peek();
      if (!next || next.at > sc.until) {
        closeScenario();
        if (si + 1 < scenarios.length) { startScenario(si + 1); continue; }
        done = true; return;
      }
      world.pop(); world.t = next.at;
      if (next.kind === 'script') world.applyScript(next.entry);
      else if (next.kind === 'wake') { wakeLog.push({ t: world.t, id: next.id }); deliveries.push(stamp({ type: 'wake', id: next.id })); }
      else world.runInternal(next);
      for (const o of world.drain()) if (subscribed(o)) deliveries.push(stamp(o));
    }
  };
  const view = () => ({ done, event: current ? clone(current) : null, response: last });
  const out = info => ({ observation: view(), done, reward: 0, info });
  const respond = (status, body, outcome) => { last = { status, body }; return out({ outcome, status }); };

  const dispatch = (name, args) => {
    stats.calls++;
    if (WORK_OPS.has(name)) stats.work++;
    switch (name) {
      case 'ha.get_state': {
        stats.stateReads++;
        const s = world.getState(String(args.entity_id ?? ''));
        return s ? respond(200, s, 'call') : respond(404, { error: 'ENTITY_NOT_FOUND', entity_id: args.entity_id }, 'call');
      }
      case 'ha.call_service': {
        stats.serviceCalls++;
        const r = world.callService({ service: args.service, target: args.target, data: args.data });
        if (r.status >= 400) stats.rejected++;
        return respond(r.status, r.body, 'call');
      }
      case 'sched.set': {
        const id = args.id, after = args.afterSeconds;
        if (typeof id !== 'string' || id === '' || id.length > 64 || typeof after !== 'number' || !Number.isFinite(after) || after < 0 || after > LIMITS.wakeHorizonSeconds) { stats.bad++; return respond(400, { error: 'BAD_ARGS', message: 'sched.set needs {id: non-empty string, afterSeconds: number in [0, 100000]}' }, 'invalid'); }
        stats.wakesSet++;
        world.unschedule(q => q.kind === 'wake' && q.id === id);
        const item = world.schedule(world.t + after, PRI.wake, 'wake', { id });
        return respond(200, { id, at: world.at(item.at).iso }, 'call');
      }
      case 'sched.cancel': {
        if (typeof args.id !== 'string' || args.id === '') { stats.bad++; return respond(400, { error: 'BAD_ARGS', message: 'sched.cancel needs {id}' }, 'invalid'); }
        stats.wakesCancelled++;
        const n = world.unschedule(q => q.kind === 'wake' && q.id === args.id);
        return respond(200, { cancelled: n > 0 }, 'call');
      }
      case 'kv.get': {
        stats.kvOps++;
        const e = kv.get(String(args.key));
        return e ? respond(200, { value: clone(e.value), version: e.version }, 'call') : respond(404, { error: 'NOT_FOUND' }, 'call');
      }
      case 'kv.put': {
        stats.kvOps++;
        const key = String(args.key), cur = kv.get(key);
        if (args.ifVersion !== undefined && (cur?.version ?? 0) !== args.ifVersion) return respond(409, { error: 'VERSION_MISMATCH', version: cur?.version ?? 0 }, 'call');
        const version = (cur?.version ?? 0) + 1;
        kv.set(key, { value: clone(args.value), version });
        return respond(200, { version }, 'call');
      }
      default: stats.bad++; return respond(400, { error: 'UNKNOWN_CALL', message: `unknown call ${name}`, calls: API_OPS }, 'invalid');
    }
  };

  const env = {
    determinism: 'D0',
    reset() {
      records = []; episode = []; done = false; current = null; last = null;
      startScenario(0); advance();
      return view();
    },
    observe: view,
    step(action) {
      if (done) return out({ ignored: true });
      episode.push(clone(action));
      const name = action && typeof action.call === 'string' ? action.call : null;
      if (name === 'done') { current = null; last = null; advance(); return out({ outcome: 'done' }); }
      if (!name || !current) { stats.bad++; return respond(400, { error: 'BAD_ACTION', message: 'an action is {call, args}; calls are only valid while an event is being handled' }, 'invalid'); }
      if (++callsInRun > LIMITS.callsPerRun) { stats.rejected++; return respond(429, { error: 'CALL_CAP', message: `more than ${LIMITS.callsPerRun} calls in one run` }, 'capped'); }
      const args = action.args && typeof action.args === 'object' && !Array.isArray(action.args) ? action.args : {};
      return dispatch(name, args);
    },
    actions: () => (done ? [] : [...API_OPS, 'done']),
    snapshot: () => clone({ si, world: world.dump(), phone: world.phone, deliveries, current, stats, kv: [...kv], done, last, callsInRun, eventSeq, fresh, episode, records, wakeLog, events }),
    restore(s) {
      const c = clone(s);
      si = c.si; sc = scenarios[si];
      world = buildGarageWorld({ start: sc.start, faults: sc.faults });
      world.load(c.world); world.phone = c.phone;
      deliveries = c.deliveries; current = c.current; stats = c.stats; kv = new Map(c.kv); done = c.done; last = c.last; callsInRun = c.callsInRun;
      eventSeq = c.eventSeq; fresh = c.fresh; episode = c.episode; records = c.records; wakeLog = c.wakeLog; events = c.events;
    },
    record: () => ({ actions: clone(episode) }),
    // Host-side only: per-scenario facts for the judge. Never hand this to a solver.
    _records: () => records,
    _scenarios: () => scenarios,
  };
  return env;
}

// Replays an episode record in a fresh environment; actions beyond the end are `done` (the solver stopped answering).
export function replay(task, actions, scenarios) {
  const env = createEnv(task, scenarios);
  env.reset();
  let n = 0;
  for (const a of actions) { if (env.observe().done) break; env.step(a); n++; }
  let idle = 0;
  while (!env.observe().done) { env.step({ call: 'done' }); idle++; }
  return { env, replayed: n, unansweredRuns: idle };
}

const makeApi = call => {
  const api = {};
  for (const name of API_OPS) { const [svc, op] = name.split('.'); (api[svc] ??= {})[op] = args => call(name, args); }
  return api;
};
// A solution is a factory: createHandler() -> handler(event, api). The factory is called again for every scenario (event.fresh).
// driveSync takes a synchronous handler, drive an async one. Both return the episode record plus host-side meta.
export function driveSync(task, createHandler, scenarios) {
  const env = createEnv(task, scenarios);
  let obs = env.reset(), handler = null;
  const errors = [];
  const api = makeApi((name, args) => clone(env.step({ call: name, args: clone(args ?? {}) }).observation.response));
  while (!obs.done) {
    if (obs.event.fresh || !handler) handler = createHandler();
    try { const r = handler(clone(obs.event), api); if (r && typeof r.then === 'function') throw new Error('driveSync: handler returned a promise; use drive()'); }
    catch (e) { errors.push(String(e?.message ?? e).slice(0, 200)); }
    obs = env.step({ call: 'done' }).observation;
  }
  return { ...env.record(), meta: { handlerErrors: errors.slice(0, 20), handlerErrorCount: errors.length } };
}
export async function drive(task, createHandler, scenarios) {
  const env = createEnv(task, scenarios);
  let obs = env.reset(), handler = null;
  const errors = [];
  const api = makeApi((name, args) => clone(env.step({ call: name, args: clone(args ?? {}) }).observation.response));
  while (!obs.done) {
    if (obs.event.fresh || !handler) handler = await createHandler();
    try { await handler(clone(obs.event), api); } catch (e) { errors.push(String(e?.message ?? e).slice(0, 200)); }
    obs = env.step({ call: 'done' }).observation;
  }
  return { ...env.record(), meta: { handlerErrors: errors.slice(0, 20), handlerErrorCount: errors.length } };
}
