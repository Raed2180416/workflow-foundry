// Module notices, key: the order id. The only sender of notify.send. Owns §4.8 (each required notice exactly once,
// `to` is the customer's email, `about` the order id or, for fulfilment-failed, the fulfilment id).
// Local keys: '<template>.<about>' and 'cancel-refused.<occurrence>'. Always returns `output`.

const TEXT = {
  'action-required': 'Some items of your order are not available. Please amend or cancel the order before the deadline.',
  'order-cancelled': 'Your order has been cancelled.',
  'order-timed-out': 'Your order was not confirmed in time and has been closed.',
  'fulfilment-failed': 'Part of your order could not be fulfilled and has been reversed.',
  'cancel-refused': 'Your order has already been collected and can no longer be cancelled.',
  'unknown-order': 'We could not find an order with that reference.',
};

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
    case 'send': return send(input, ctx);
    case 'get': return out(ctx.state, false);
    case 'resume': return resume(input, ctx);
  }
  throw new Error(`notices: unknown op ${input.op}`);
}

export function onEvent(event, ctx) {
  const st = ctx.state ? { ...ctx.state, inflight: { ...ctx.state.inflight } } : null;
  if (st && event.payload && typeof event.payload.key === 'string') delete st.inflight[event.payload.key];
  return { ...out(st, false), state: st };
}

function out(st, sent) {
  return { output: { sent, busy: !!st && Object.keys(st.inflight ?? {}).length > 0 } };
}

function rowsOf(x) {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') {
    const arr = Object.values(x).find(v => Array.isArray(v));
    if (arr) return arr;
    return Object.entries(x).map(([k, v]) => ({ customerId: k, ...(typeof v === 'object' ? v : {}) }));
  }
  return [];
}

function emailOf(ctx, customerId) {
  const f = ctx.files ?? {};
  let c = f['master/customers.json'];
  if (typeof c === 'string') c = JSON.parse(c);
  const row = rowsOf(c).find(r => r && r.customerId === customerId);
  if (!row || typeof row.email !== 'string') throw new Error(`no email for customer ${customerId}`);
  return row.email;
}

function init(input, ctx) {
  if (ctx.state) return out(ctx.state, false);
  const st = { customerId: input.customerId, email: emailOf(ctx, input.customerId), sent: {}, inflight: {} };
  return { ...out(st, false), state: st };
}

function send(input, ctx) {
  const st = ctx.state;
  if (!st) throw new Error('notices.send before init');
  const key = input.template === 'cancel-refused' ? `cancel-refused.${input.occurrence}` : `${input.template}.${input.about}`;
  if (st.sent[key]) return { ...out(st, false) };          // exactly once
  const next = { ...st, sent: { ...st.sent, [key]: true }, inflight: { ...st.inflight, [key]: true } };
  const effect = {
    key, system: 'notify', op: 'send',
    args: fit('notify', 'send', { to: st.email, about: input.about, template: input.template, text: input.text ?? TEXT[input.template], ref: null }, ctx),
  };
  return { ...out(next, true), state: next, effects: [effect] };
}

function resume(input, ctx) {
  // §3.5: notices already on the migrated records count as sent.
  const r = input.records?.notices ?? {};
  const st = { customerId: input.customerId ?? r.customerId, email: r.email ?? emailOf(ctx, input.customerId), sent: {}, inflight: {} };
  for (const k of r.sent ?? []) st.sent[k] = true;
  return { ...out(st, false), state: st };
}
