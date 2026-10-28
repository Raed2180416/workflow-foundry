// Module statuses, key: the order id. Owns R7.2. The only writer of orders.setStatus (DECOMPOSITION 4.8).
// Transitions are checked here (the system does not check them, SPEC-E 2). Each status is set at most once; a late
// or repeated request never moves a status back. Effect keys: 'order.<status>', 'f.<fulfilmentId>.<status>'.

const FUL = {
  unavailable: ['cancelled'],
  pending: ['processing', 'cancelled', 'failed'],
  processing: ['dispatched', 'completed', 'cancelled', 'failed'],
  dispatched: ['completed'],
};
const ORD = {
  pending: ['customerActionRequired', 'processing', 'cancelled'],
  customerActionRequired: ['processing', 'cancelled', 'timedOut'],
  processing: ['completed', 'failed', 'cancelled'],
};

export function step(input, ctx) {
  const s = ctx.state ?? { order: null, fs: {}, pend: {} };
  const eff = [];
  let applied = false;
  if (input.op === 'init') {
    if (s.order === null) {
      s.order = input.orderStatus ?? 'pending';
      for (const f of input.fulfilments ?? []) {
        s.fs[f.fulfilmentId] = f.status ?? (f.location === null || f.location === undefined ? 'unavailable' : 'pending');
      }
    }
  } else if (input.op === 'set') {
    applied = setStatus(s, ctx.key, input.fulfilmentId ?? null, input.status, eff);
  }
  for (const e of eff) e.args = conform(ctx.files, e.system, e.op, e.args);
  return { output: outOf(s, applied), state: s, effects: eff };
}

export function onEvent(event, ctx) {
  const s = ctx.state ?? { order: null, fs: {}, pend: {} };
  const eff = [];
  if (event.type === 'effect.result') {
    const p = event.payload ?? {};
    const args = s.pend[p.key];
    if (args !== undefined) {
      if (p.status === 'ok' || errInfo(p).permanent) delete s.pend[p.key];
      else eff.push({ key: p.key, system: 'orders', op: 'setStatus', args: conform(ctx.files, 'orders', 'setStatus', args) });
    }
  }
  return { output: outOf(s, false), state: s, effects: eff };
}

// SPEC-E 4.6: effect arguments follow the system's current schema (api/<system>.schema.json, after any F5 rename).
function conform(files, system, op, args) {
  const schema = J(files, `api/${system}.schema.json`)?.ops?.[op]?.args;
  return schema && schema.properties ? fit(args, schema) : args;
}

function fit(obj, schema) {
  const props = schema.properties;
  const norm = x => x.toLowerCase().replace(/minor/g, '').replace(/[^a-z0-9]/g, '');
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const out = {};
  const left = [];
  for (const k of Object.keys(obj)) { if (has(props, k)) out[k] = obj[k]; else left.push(k); }
  const free = Object.keys(props).filter(p => !has(obj, p));
  const rest = [];
  for (const k of left) {
    const hit = free.find(p => norm(p) === norm(k)) ?? free.find(p => norm(p).includes(norm(k)) || norm(k).includes(norm(p)));
    if (hit !== undefined) { out[hit] = obj[k]; free.splice(free.indexOf(hit), 1); } else rest.push(k);
  }
  if (rest.length === 1 && free.length === 1) { out[free[0]] = obj[rest[0]]; rest.length = 0; }
  for (const k of rest) out[k] = obj[k];
  return out;
}

function J(files, p) {
  let v = files ? files[p] : undefined;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = null; } }
  return v === undefined ? null : v;
}

function setStatus(s, oid, fid, status, eff) {
  const isOrder = fid === null;
  const from = isOrder ? s.order : s.fs[fid];
  const table = isOrder ? ORD : FUL;
  if (!from || !(table[from] ?? []).includes(status)) return false;
  if (isOrder) s.order = status; else s.fs[fid] = status;
  const key = isOrder ? `order.${status}` : `f.${fid}.${status}`;
  const args = { orderId: oid, fulfilmentId: fid, status };
  s.pend[key] = args;
  eff.push({ key, system: 'orders', op: 'setStatus', args });
  return true;
}

function outOf(s, applied) {
  return {
    applied,
    order: s.order,
    fulfilments: Object.keys(s.fs).map(k => ({ fulfilmentId: k, status: s.fs[k] })),
    busy: Object.keys(s.pend).length > 0,
  };
}

function errInfo(p) {
  const e = p.error;
  const code = typeof e === 'string' ? e : (e?.code ?? p.code ?? null);
  const retryable = e && typeof e === 'object' && 'retryable' in e ? e.retryable : p.retryable;
  const invalid = code === 'invalid-args' || code === 'field-renamed';
  return { code, invalid, permanent: !invalid && retryable === false };
}
