// Module customer-action, key: the order id. Owns R3.1 (action-required within 120 min of clearing), R3.2 (the
// customer's deadline D = placedAt + customerActionHours, the first amend or cancel at or before D counts, the timeout
// after D) and S1 (D is anchored at placedAt, inclusive for the customer, exclusive for the timeout).
// Calls statuses and notices only. Wake-up 'deadline' is set after D (D + 1 min), never at D. Always returns `output`.

const MIN = 60000;

function lastSunday(y, m) {
  const last = new Date(Date.UTC(y, m + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}

// Europe/Amsterdam offset in minutes at an instant (EU rule: DST from the last Sunday of March to the last Sunday of
// October, at 01:00 UTC).
function amsOffsetMin(ms) {
  const y = new Date(ms).getUTCFullYear();
  const start = Date.UTC(y, 2, lastSunday(y, 2), 1);
  const end = Date.UTC(y, 9, lastSunday(y, 9), 1);
  return ms >= start && ms < end ? 120 : 60;
}

function amsIso(ms) {
  const off = amsOffsetMin(ms);
  const d = new Date(ms + off * MIN);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+${p(Math.floor(off / 60))}:${p(off % 60)}`;
}

function readJson(files, path) {
  let v = files?.[path];
  if (v === undefined) { v = files; for (const seg of path.split('/')) v = v?.[seg]; }
  if (typeof v === 'string') return JSON.parse(v);
  return v ?? null;
}

function policyParam(files, edition, name) {
  const p = readJson(files, `rulebook/${edition}/policy.json`) ?? {};
  const v = p[name] ?? p.policy?.[name];
  if (typeof v !== 'number') throw new Error(`policy ${edition} has no ${name}`);
  return v;
}

function outOf(st) {
  return { output: { state: st?.state ?? 'idle', at: st?.at ?? null, reason: st?.reason ?? null, busy: false } };
}

export function step(input, ctx) {
  switch (input.op) {
    case 'start': return start(input, ctx);
    case 'advance': return advance(input, ctx);
    case 'action': return action(input, ctx);
    case 'resume': return resume(input, ctx);
  }
  throw new Error(`customer-action: unknown op ${input.op}`);
}

export function onEvent(event, ctx) {
  const st = ctx.state;
  const fired = event.type === 'timer.fired' && event.payload?.obligationId === 'deadline';
  if (!st || st.state !== 'waiting' || !fired) return outOf(st);
  // Nothing counted by D: every fulfilment cancelled, the order timedOut, one notice (R3.2).
  for (const f of st.fulfilments) ctx.call('statuses', ctx.key, { op: 'set', fulfilmentId: f.fulfilmentId, status: 'cancelled' });
  ctx.call('statuses', ctx.key, { op: 'set', fulfilmentId: null, status: 'timedOut' });
  ctx.call('notices', ctx.key, { op: 'send', template: 'order-timed-out', about: ctx.key });
  const next = { ...st, state: 'timedOut', at: amsIso(event.at ? Date.parse(event.at) : Date.parse(ctx.now)) };
  return { ...outOf(next), state: next };
}

function start(input, ctx) {
  // D from placedAt, the edition in force at placedAt (R3.2, S1). The wake-up is one minute after D.
  if (ctx.state) return outOf(ctx.state);
  const hours = policyParam(ctx.files, input.edition, 'customerActionHours');
  const D = Date.parse(input.placedAt) + hours * 60 * MIN;
  const st = { state: 'waiting', D: amsIso(D), clearedAt: input.clearedAt, advanced: false, fulfilments: input.fulfilments, at: null, reason: null };
  return {
    ...outOf(st),
    state: st,
    obligations: { upsert: [{ id: 'deadline', kind: 'deadline', anchor: 'D', dueAt: amsIso(D + MIN), onDue: 'deadline' }] },
  };
}

function advance(input, ctx) {
  // R3.1: the order customerActionRequired and the action-required notice, once, while the customer has not acted.
  const st = ctx.state;
  if (!st || st.state !== 'waiting' || st.advanced) return outOf(st);
  ctx.call('statuses', ctx.key, { op: 'set', fulfilmentId: null, status: 'customerActionRequired' });
  ctx.call('notices', ctx.key, { op: 'send', template: 'action-required', about: ctx.key });
  const next = { ...st, advanced: true };
  return { ...outOf(next), state: next };
}

function action(input, ctx) {
  // The first amend or cancel at or before D counts (D itself counts, S1). Later actions change nothing.
  const st = ctx.state;
  if (!st || st.state !== 'waiting') return outOf(st);
  if (Date.parse(input.at) > Date.parse(st.D)) return outOf(st);
  const cancelTimer = { cancel: ['deadline'] };
  if (input.action === 'cancel') {
    const next = { ...st, state: 'cancel', reason: 'customer', at: input.at };
    return { ...outOf(next), state: next, obligations: cancelTimer };
  }
  // amend (R3.2): every unavailable fulfilment cancelled; the rest continue, ready at the amend's time.
  for (const f of st.fulfilments) {
    if (!f.available) ctx.call('statuses', ctx.key, { op: 'set', fulfilmentId: f.fulfilmentId, status: 'cancelled' });
  }
  const anyAvailable = st.fulfilments.some(f => f.available);
  const next = anyAvailable
    ? { ...st, state: 'ready', at: input.at, reason: null }
    : { ...st, state: 'cancel', at: input.at, reason: 'nothing-available' };
  return { ...outOf(next), state: next, obligations: cancelTimer };
}

function resume(input, ctx) {
  // §3.5: a migrated order that is still waiting for its customer keeps its deadline (the wake-up is re-set).
  const r = input.records?.customerAction;
  if (!r) return outOf(null);
  const st = { state: r.state, D: r.D, clearedAt: r.clearedAt, advanced: true, fulfilments: r.fulfilments, at: r.at ?? null, reason: r.reason ?? null };
  if (st.state !== 'waiting') return { ...outOf(st), state: st };
  return {
    ...outOf(st),
    state: st,
    obligations: { upsert: [{ id: 'deadline', kind: 'deadline', anchor: 'D', dueAt: amsIso(Math.max(Date.parse(st.D) + MIN, Date.parse(ctx.now) + MIN)), onDue: 'deadline' }] },
  };
}
