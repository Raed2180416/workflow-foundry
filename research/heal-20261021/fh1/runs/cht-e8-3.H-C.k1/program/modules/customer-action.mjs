// Module customer-action, key: the order id. Owns R3.1, R3.2, S1 (DECOMPOSITION 4.4).
// Started when the order is recorded and has an unavailable fulfilment; its clock runs from placedAt (S1).
// An amend or cancel counts while it is at or before D = placedAt + customerActionHours; the timeout is at D + 1 min,
// so it is strictly after D. A customer action before clearance is judged here too (R3.2 says nothing against it).

const MIN = 60000;

export function step(input, ctx) {
  const s = ctx.state ?? { st: 'idle', D: null, placedAt: null, clearedAt: null, at: null, reason: null, advanced: false, fs: [] };
  let obligations;
  if (input.op === 'start') {
    s.placedAt = input.placedAt;
    s.fs = input.fulfilments.map(f => ({ fulfilmentId: f.fulfilmentId, available: f.available }));
    const hours = Number(deep(J(ctx.files, `rulebook/${input.edition}/policy.json`), 'customerActionHours'));
    s.D = plusMin(input.placedAt, hours * 60);
    s.st = 'pending';
    if (input.resumed) s.advanced = true;
    obligations = { upsert: [wake(s)] };
  } else if (input.op === 'cleared') {
    if (s.st === 'pending') {
      s.st = 'waiting';
      s.clearedAt = input.at;
    } else if (s.st === 'overdue') {
      s.clearedAt = input.at;
      advance(s, ctx);
      timeout(s, ctx, input.at);
    }
  } else if (input.op === 'advance') {
    if (s.st === 'waiting' && !s.advanced) advance(s, ctx);
  } else if (input.op === 'action') {
    obligations = action(s, input, ctx);
  } else if (input.op === 'stop') {
    if (s.st === 'pending' || s.st === 'waiting' || s.st === 'overdue') {
      s.st = 'stopped';
      obligations = { cancel: ['deadline'] };
    }
  }
  return { output: outOf(s), state: s, obligations };
}

export function onEvent(event, ctx) {
  const s = ctx.state ?? { st: 'idle', D: null, placedAt: null, clearedAt: null, at: null, reason: null, advanced: false, fs: [] };
  if (event.type === 'timer.fired') {
    if (s.st === 'waiting') timeout(s, ctx, event.at);
    else if (s.st === 'pending') s.st = 'overdue';
  }
  return { output: outOf(s), state: s };
}

function action(s, input, ctx) {
  if (!(s.st === 'pending' || s.st === 'waiting')) return undefined;
  if (Date.parse(input.at) > Date.parse(s.D)) return undefined;
  if (input.action === 'cancel') {
    s.st = 'cancel';
    s.reason = 'customer';
    s.at = input.at;
    return { cancel: ['deadline'] };
  }
  // amend: every unavailable fulfilment is cancelled at once (within 60 min of the amend)
  for (const f of s.fs) if (!f.available) ctx.call('statuses', ctx.key, { op: 'set', fulfilmentId: f.fulfilmentId, status: 'cancelled' });
  s.at = input.at;
  if (s.fs.some(f => f.available)) {
    s.st = 'ready';
  } else {
    s.st = 'cancel';
    s.reason = 'nothing-available';
  }
  return { cancel: ['deadline'] };
}

// R3.1: the order waits for the customer, and the customer is told (once).
function advance(s, ctx) {
  s.advanced = true;
  ctx.call('statuses', ctx.key, { op: 'set', fulfilmentId: null, status: 'customerActionRequired' });
  ctx.call('notices', ctx.key, { op: 'send', template: 'action-required', about: ctx.key });
}

// R3.2: nothing counted by D; every fulfilment is cancelled, the order times out.
function timeout(s, ctx, at) {
  for (const f of s.fs) ctx.call('statuses', ctx.key, { op: 'set', fulfilmentId: f.fulfilmentId, status: 'cancelled' });
  ctx.call('statuses', ctx.key, { op: 'set', fulfilmentId: null, status: 'timedOut' });
  ctx.call('notices', ctx.key, { op: 'send', template: 'order-timed-out', about: ctx.key });
  s.st = 'timedOut';
  s.at = at;
  s.reason = null;
}

function wake(s) {
  return { id: 'deadline', kind: 'customer-deadline', anchor: s.placedAt, dueAt: plusMin(s.D, 1), onDue: 'deadline' };
}

function outOf(s) {
  return { state: s.st, at: s.at ?? null, reason: s.reason ?? null, busy: false };
}

function plusMin(iso, m) {
  const o = offOf(iso);
  const local = new Date(Date.parse(iso) + (m + o) * MIN).toISOString().slice(0, 19);
  const a = Math.abs(o);
  return `${local}${o < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

function offOf(iso) {
  const m = /([+-])(\d\d):(\d\d)$/.exec(iso);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

function J(files, p) {
  let v = files ? files[p] : undefined;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = null; } }
  return v === undefined ? null : v;
}

// The first numeric value of a key anywhere in a rulebook table (policy.json may nest its values).
function deep(x, name, d = 0) {
  if (x === null || typeof x !== 'object' || d > 4) return undefined;
  if (Object.prototype.hasOwnProperty.call(x, name)) return x[name];
  for (const k of Object.keys(x)) { const r = deep(x[k], name, d + 1); if (r !== undefined) return r; }
  return undefined;
}
