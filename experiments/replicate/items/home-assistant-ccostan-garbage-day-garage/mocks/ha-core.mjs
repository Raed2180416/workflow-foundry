// Deterministic Home Assistant mock core, written to be reused by the other Home Assistant R-bench items:
// a virtual local clock, an entity state machine, a service registry that records every call, an event bus outbox,
// a time-ordered queue, outage windows for fault injection and a timer helper integration.
// No wall clock, no randomness, no I/O. Plain data only, so a world can be dumped and loaded again.
//
// Evidence status: the semantics below are a re-statement of documented Home Assistant behaviour (state machine, services,
// timer helper). Nothing was executed against a real Home Assistant (not installed here); see the item README.

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const clone = v => (v === undefined ? undefined : structuredClone(v));
const pad = (n, w = 2) => String(n).padStart(w, '0');

// The mock clock is naive local time: an ISO string without offset is read as if it were UTC and never converted back.
export function parseLocal(iso) {
  const ms = Date.parse(`${iso}Z`);
  if (Number.isNaN(ms)) throw new Error(`parseLocal: not a local ISO time: ${iso}`);
  return ms / 1000;
}
export function formatLocal(sec) {
  const d = new Date(Math.round(sec * 1000));
  const ms = d.getUTCMilliseconds();
  return d.toISOString().slice(0, 19) + (ms ? `.${pad(ms, 3)}` : '');
}
export const weekdayOf = sec => DAYS[new Date(Math.round(sec * 1000)).getUTCDay()];

// Python-style strftime for the few directives templates use. Anything else is rejected rather than guessed.
export function strftime(sec, fmt) {
  const d = new Date(Math.round(sec * 1000));
  return fmt.replace(/%(.)/g, (_, c) => {
    switch (c) {
      case 'a': return DAY_LONG[d.getUTCDay()].slice(0, 3);
      case 'A': return DAY_LONG[d.getUTCDay()];
      case 'b': return MON_SHORT[d.getUTCMonth()];
      case 'B': return MON_LONG[d.getUTCMonth()];
      case 'd': return pad(d.getUTCDate());
      case 'H': return pad(d.getUTCHours());
      case 'I': return pad(d.getUTCHours() % 12 || 12);
      case 'M': return pad(d.getUTCMinutes());
      case 'S': return pad(d.getUTCSeconds());
      case 'm': return pad(d.getUTCMonth() + 1);
      case 'Y': return String(d.getUTCFullYear());
      case 'y': return pad(d.getUTCFullYear() % 100);
      case 'w': return String(d.getUTCDay());
      case 'p': return d.getUTCHours() < 12 ? 'AM' : 'PM';
      case '%': return '%';
      default: throw new Error(`strftime: unsupported directive %${c}`);
    }
  });
}

// Home Assistant durations (cv.time_period): 'H:MM:SS(.f)', 'HH:MM' (hours:minutes), a number of seconds, a numeric string, or a dict.
export function parseDuration(v) {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
    const m = /^(\d+):([0-5]?\d)(?::([0-5]?\d)(\.\d+)?)?$/.exec(s);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0) + (m[4] ? Number(m[4]) : 0);
    return null;
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const k = { days: 86400, hours: 3600, minutes: 60, seconds: 1, milliseconds: 0.001 };
    let total = 0;
    for (const [key, val] of Object.entries(v)) { if (!(key in k) || typeof val !== 'number' || val < 0) return null; total += val * k[key]; }
    return total;
  }
  return null;
}
export const formatDuration = sec => `${Math.floor(sec / 3600)}:${pad(Math.floor((sec % 3600) / 60))}:${pad(Math.floor(sec % 60))}`;

export function entityIds(target, data) {
  const out = [];
  for (const src of [target?.entity_id, data?.entity_id]) {
    for (const id of Array.isArray(src) ? src : src == null || src === '' ? [] : String(src).split(',').map(s => s.trim())) if (!out.includes(id)) out.push(id);
  }
  return out;
}

// Queue priorities for items due at the same instant: the world (scripted people and devices) acts first, then internal
// integrations (a timer finishing), then the solver's own scheduled wake-ups.
export const PRI = Object.freeze({ script: 0, internal: 1, wake: 2 });

export class HAMock {
  constructor({ start, recorded = {}, faults = [] }) {
    this.start = start;
    this.t0 = parseLocal(start);
    this.t = 0;                       // seconds since the scenario start
    this.states = new Map();          // entity_id -> {state, attributes, last_changed (t)}
    this.stateLog = [];               // every state change: {t, entity_id, old, new}
    this.outbox = [];                 // bus items produced since the last drain
    this.services = new Map();        // 'domain.service' -> fn(world, call) -> {status, body}
    this.calls = [];                  // recorder: every service call, accepted or not
    this.callSeq = 0;
    this.queue = [];
    this.qseq = 0;
    this.internal = new Map();        // kind -> fn(world, item)
    this.recorded = recorded;
    this.faults = faults;             // outage windows [{service, from, to}] in scenario seconds
    this.log = [];                    // free-form host-side log (taps, logbook entries ...)
    this.timers = new Map();          // entity_id -> {token, endsAt}
  }

  // ---- clock
  at(t = this.t) {
    const epoch = this.t0 + t;
    return { iso: formatLocal(epoch), weekday: weekdayOf(epoch), epoch };
  }
  strftime(fmt, t = this.t) { return strftime(this.t0 + t, fmt); }

  // ---- state machine
  init(id, state, attributes = {}) { this.states.set(id, { state, attributes: clone(attributes), last_changed: 0 }); }
  // last_changed is kept internally in scenario seconds and read out, as Home Assistant does, as a timestamp: here the naive local time in
  // the same format as event.at.iso (v0.2.0; before, it leaked the scenario-relative seconds, which no solution could relate to event.at).
  getState(id) { const s = this.states.get(id); return s ? { entity_id: id, ...clone(s), last_changed: formatLocal(this.t0 + s.last_changed) } : null; }
  setState(id, state, attributes) {
    const old = this.states.get(id);
    if (!old) { this.states.set(id, { state, attributes: clone(attributes ?? {}), last_changed: this.t }); this.stateLog.push({ t: this.t, entity_id: id, old: null, new: state }); this.outbox.push({ type: 'state_changed', entity_id: id, old_state: null, new_state: state }); return true; }
    if (attributes !== undefined) old.attributes = clone(attributes);
    if (old.state === state) return false;
    const prev = old.state;
    old.state = state; old.last_changed = this.t;
    this.stateLog.push({ t: this.t, entity_id: id, old: prev, new: state });
    this.outbox.push({ type: 'state_changed', entity_id: id, old_state: prev, new_state: state });
    return true;
  }
  fire(eventType, data = {}) { this.outbox.push({ type: 'event', event_type: eventType, data: clone(data) }); }
  drain() { const o = this.outbox; this.outbox = []; return o; }

  // ---- services
  register(name, fn) { this.services.set(name, fn); }
  outageFor(service) { return this.faults.find(f => f.service === service && this.t >= f.from && this.t <= f.to) ?? null; }
  failure(service) { return clone(this.recorded.fail?.[service] ?? this.recorded.fail?.default ?? { status: 500, body: { error: 'SERVICE_FAILED' } }); }
  success() { return clone(this.recorded.ok?.default ?? { status: 200, body: {} }); }
  callService({ service, target, data } = {}) {
    const rec = { seq: this.callSeq++, t: this.t, service: String(service), target: clone(target ?? {}), data: clone(data ?? {}), entity_ids: entityIds(target, data) };
    let res;
    const fn = typeof service === 'string' ? this.services.get(service) : null;
    if (!fn) res = { status: 404, body: { error: 'SERVICE_NOT_FOUND', message: `service ${service} does not exist` } };
    else if (this.outageFor(service)) res = this.failure(service);
    else res = fn(this, rec) ?? this.success();
    rec.status = res.status;
    this.calls.push(rec);
    return clone(res);
  }

  // ---- time-ordered queue (scenario script, internal integrations, solver wake-ups)
  schedule(at, pri, kind, payload = {}) {
    const item = { at, pri, seq: ++this.qseq, kind, ...clone(payload) };
    let i = this.queue.length;
    while (i > 0 && (this.queue[i - 1].at > at || (this.queue[i - 1].at === at && (this.queue[i - 1].pri > pri || (this.queue[i - 1].pri === pri && this.queue[i - 1].seq > item.seq))))) i--;
    this.queue.splice(i, 0, item);
    return item;
  }
  unschedule(pred) { const n = this.queue.length; this.queue = this.queue.filter(q => !pred(q)); return n - this.queue.length; }
  peek() { return this.queue[0] ?? null; }
  pop() { return this.queue.shift() ?? null; }
  runInternal(item) {
    const fn = this.internal.get(item.kind);
    if (!fn) throw new Error(`no internal handler for ${item.kind}`);
    fn(this, item);
  }

  // ---- persistence
  dump() {
    return clone({ t: this.t, states: [...this.states], stateLog: this.stateLog, outbox: this.outbox, calls: this.calls, callSeq: this.callSeq, queue: this.queue, qseq: this.qseq, log: this.log, timers: [...this.timers] });
  }
  load(d) {
    const c = clone(d);
    this.t = c.t; this.states = new Map(c.states); this.stateLog = c.stateLog; this.outbox = c.outbox; this.calls = c.calls; this.callSeq = c.callSeq;
    this.queue = c.queue; this.qseq = c.qseq; this.log = c.log; this.timers = new Map(c.timers);
  }
}

// The timer helper integration (documented behaviour): timer.start on an idle timer makes it active for the duration; on an active
// timer it restarts with the new duration; when time is up the timer goes idle and a timer.finished event is fired.
export function installTimer(world, entityId, defaultSeconds) {
  world.init(entityId, 'idle', { duration: formatDuration(defaultSeconds) });
  const targets = (w, rec) => rec.entity_ids.length ? rec.entity_ids : null;
  const bad = (w, msg) => ({ status: 400, body: { error: 'INVALID_DATA', message: msg } });
  world.register('timer.start', (w, rec) => {
    const ids = targets(w, rec);
    if (!ids || ids.some(id => !id.startsWith('timer.') || !w.states.has(id))) return { status: 404, body: { error: 'ENTITY_NOT_FOUND', message: `timer.start needs an existing timer.* entity, got ${JSON.stringify(rec.entity_ids)}` } };
    let seconds;
    if (rec.data.duration === undefined) seconds = defaultSeconds;
    else { seconds = parseDuration(rec.data.duration); if (seconds === null || seconds <= 0) return bad(w, `invalid duration ${JSON.stringify(rec.data.duration)}`); }
    for (const id of ids) {
      const token = (w.timers.get(id)?.token ?? 0) + 1;
      w.timers.set(id, { token, endsAt: w.t + seconds });
      w.setState(id, 'active', { duration: formatDuration(seconds), finishes_at: formatLocal(w.t0 + w.t + seconds), remaining: formatDuration(seconds) });
      w.schedule(w.t + seconds, PRI.internal, 'timer_expire', { entity_id: id, token });
    }
    return undefined;
  });
  const stop = (name, event) => world.register(name, (w, rec) => {
    const ids = targets(w, rec);
    if (!ids || ids.some(id => !id.startsWith('timer.') || !w.states.has(id))) return { status: 404, body: { error: 'ENTITY_NOT_FOUND', message: `${name} needs an existing timer.* entity` } };
    for (const id of ids) {
      const cur = w.timers.get(id);
      if (cur) w.timers.set(id, { token: cur.token + 1, endsAt: null });
      w.setState(id, 'idle', { duration: formatDuration(defaultSeconds) });
      w.fire(event, { entity_id: id });
    }
    return undefined;
  });
  stop('timer.cancel', 'timer.cancelled');
  stop('timer.finish', 'timer.finished');
  world.internal.set('timer_expire', (w, item) => {
    const cur = w.timers.get(item.entity_id);
    if (!cur || cur.token !== item.token) return;       // restarted or cancelled since
    w.timers.set(item.entity_id, { token: cur.token, endsAt: null });
    w.setState(item.entity_id, 'idle', { duration: formatDuration(defaultSeconds) });
    w.fire('timer.finished', { entity_id: item.entity_id });
  });
}
