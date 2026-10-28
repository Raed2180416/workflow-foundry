// Module statuses, key: the order id. The only writer of orders.setStatus. Owns R7.2 (forward moves only, each
// status at most once, never moved back by a late or repeated request) and the §2 setStatus row (the system does not
// check transitions, so we do). Local keys: 'order.<status>' and 'f.<fulfilmentId>.<status>' (one key per change).
// Always returns `output`.

const ORDER_TERMINAL = ['completed', 'failed', 'cancelled', 'timedOut'];
const FULFILMENT_TERMINAL = ['completed', 'failed', 'cancelled'];

// Allowed moves (R7.2). The order: pending -> customerActionRequired -> processing -> end. The fulfilment:
// pending -> processing -> dispatched -> completed, with cancelled / failed as other ends, and unavailable -> cancelled.
function allowed(target, current, status) {
  if (current === undefined || current === null) return false;
  if (target === 'order') {
    if (ORDER_TERMINAL.includes(current)) return false;
    if (status === 'cancelled') return true;
    if (status === 'customerActionRequired') return current === 'pending';
    if (status === 'processing') return current === 'pending' || current === 'customerActionRequired';
    if (status === 'completed' || status === 'failed') return current === 'processing';
    if (status === 'timedOut') return current === 'customerActionRequired' || current === 'pending';
    return false;
  }
  if (FULFILMENT_TERMINAL.includes(current)) return false;
  if (status === 'cancelled') return true;
  if (current === 'unavailable') return false;
  if (status === 'processing') return current === 'pending';
  if (status === 'dispatched') return current === 'processing';
  if (status === 'completed') return current === 'processing' || current === 'dispatched';
  if (status === 'failed') return current === 'pending' || current === 'processing' || current === 'dispatched';
  return false;
}

function out(st, applied, busy) {
  return {
    output: {
      applied,
      order: st?.order ?? null,
      fulfilments: st ? Object.entries(st.f).map(([fulfilmentId, status]) => ({ fulfilmentId, status })) : [],
      busy,
    },
  };
}

function readJson(files, path) {
  let v = files?.[path];
  if (v === undefined) { v = files; for (const seg of path.split('/')) v = v?.[seg]; }
  if (typeof v === 'string') return JSON.parse(v);
  return v ?? null;
}

// The API may rename a field during the run; api/<system>.schema.json in ctx.files always shows the current names
// (SPEC-E §4.2). An argument the current schema no longer names moves to the single property that replaces it.
function fit(system, op, args, ctx) {
  const schema = readJson(ctx.files, `api/${system}.schema.json`);
  const a = schema?.ops?.[op]?.args;
  if (!a || !a.properties || !args) return args;
  const props = Object.keys(a.properties);
  const out = { ...args };
  for (const k of Object.keys(args).filter(k => !props.includes(k))) {
    const free = props.filter(p => !(p in out));
    const req = free.filter(p => (a.required ?? []).includes(p));
    const pick = req.length === 1 ? req[0] : free.length === 1 ? free[0] : null;
    if (pick) { out[pick] = out[k]; delete out[k]; }
  }
  return out;
}

export function step(input, ctx) {
  switch (input.op) {
    case 'init': return init(input, ctx);
    case 'set': return set(input, ctx);
    case 'get': return out(ctx.state, false, anyInflight(ctx.state));
    case 'resume': return resume(input, ctx);
  }
  throw new Error(`statuses: unknown op ${input.op}`);
}

export function onEvent(event, ctx) {
  // Result of one setStatus: it is no longer in flight. A refused result is recorded but changes nothing else.
  const st = ctx.state ? { ...ctx.state, inflight: { ...ctx.state.inflight } } : null;
  if (st && event.payload && typeof event.payload.key === 'string') delete st.inflight[event.payload.key];
  return { ...out(st, false, anyInflight(st)), state: st };
}

function anyInflight(st) {
  return !!st && Object.keys(st.inflight ?? {}).length > 0;
}

function init(input, ctx) {
  if (ctx.state) return { ...out(ctx.state, false, anyInflight(ctx.state)) };
  const f = {};
  for (const x of input.fulfilments) f[x.fulfilmentId] = x.location === null ? 'unavailable' : 'pending';
  const st = { order: 'pending', f, inflight: {}, last: null };
  return { ...out(st, false, false), state: st };
}

function set(input, ctx) {
  const st = ctx.state;
  if (!st) return { ...out(null, false, false) };          // before init: refused (R4.1)
  const isOrder = input.fulfilmentId === null || input.fulfilmentId === undefined;
  const target = isOrder ? 'order' : 'fulfilment';
  const fid = isOrder ? null : input.fulfilmentId;
  const cur = isOrder ? st.order : st.f[fid];
  const next = { ...st, f: { ...st.f }, inflight: { ...st.inflight } };
  if (!allowed(target, cur, input.status)) return { ...out(st, false, anyInflight(st)) };
  const key = isOrder ? `order.${input.status}` : `f.${fid}.${input.status}`;
  if (isOrder) next.order = input.status; else next.f[fid] = input.status;
  const effect = { key, system: 'orders', op: 'setStatus', args: fit('orders', 'setStatus', { orderId: ctx.key, fulfilmentId: fid, status: input.status }, ctx) };
  if (input.afterStatus && !isOrder) {
    const earlier = `f.${fid}.${input.afterStatus}`;
    if (next.last && next.last.key === earlier && next.last.now === ctx.now) effect.after = earlier;
  }
  next.last = { key, now: ctx.now };
  next.inflight[key] = true;
  return { ...out(next, true, true), state: next, effects: [effect] };
}

function resume(input, ctx) {
  // §3.5: the statuses already on the records of a migrated order (input.records.statuses: { order, fulfilments }).
  const r = input.records?.statuses ?? {};
  const f = {};
  for (const x of r.fulfilments ?? []) f[x.fulfilmentId] = x.status;
  const st = { order: r.order ?? 'pending', f, inflight: {}, last: null };
  return { ...out(st, false, false), state: st };
}
