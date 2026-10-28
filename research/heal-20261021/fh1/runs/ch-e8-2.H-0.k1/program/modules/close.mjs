// close: order-level statuses and notices: the order becomes processing (R4.1), its outcome when every fulfilment has
// ended (R4.5), cancelled (R6.1, R6.2, R6.4 and the fraud and nothing-available cases), or a refused cancel (R6.3).
// Keys: 'order-processing', 'order-final', 'order-cancelled', 'notice', 'refuse-<ref>'. The parent calls each op;
// fulfilment-level compensation is done by the fulfil module, called by the parent before 'cancel'.

const TERMINAL = ['completed', 'failed', 'cancelled'];

function stepRaw(input, ctx) {
  const st = ctx.state ?? { orderId: input.orderId, email: input.email, final: null, cancelled: null };
  if (input.op === 'processing') {
    return { state: st, effects: [{ key: 'order-processing', system: 'orders', op: 'setStatus', args: { orderId: input.orderId, fulfilmentId: null, status: 'processing' } }],
      output: { phase: 'processing' } };
  }
  if (input.op === 'cancel') {
    // the order counts as cancelled from the moment the rule decides it (S15): the first decision wins
    if (st.cancelled) return { state: st, output: { phase: 'cancelled', already: true } };
    const next = { ...st, email: input.email, cancelled: input.reason };
    return {
      state: next,
      effects: [
        { key: 'order-cancelled', system: 'orders', op: 'setStatus', args: { orderId: input.orderId, fulfilmentId: null, status: 'cancelled' } },
        { key: 'notice', system: 'notify', op: 'send', args: { to: input.email, about: input.orderId, template: 'order-cancelled', text: `Your order was cancelled (${input.reason}).` } },
      ],
      output: { phase: 'cancelled', reason: input.reason },
    };
  }
  if (input.op === 'refuse') {
    // R6.3: the cancel did not count because a shipment was collected
    return {
      state: st,
      effects: [{ key: `refuse-${input.ref}`, system: 'notify', op: 'send', args: { to: st.email ?? input.email, about: input.orderId, template: 'cancel-refused', text: 'Your order has already been collected and cannot be cancelled.' } }],
      output: { phase: 'refused' },
    };
  }
  if (input.op === 'outcome') {
    // R4.5: every fulfilment ended; the order is completed if one completed, else failed if one failed, else cancelled
    if (st.final || st.cancelled) return { state: st, output: { phase: 'settled', already: true } };
    const all = input.statuses ?? [];
    if (!all.length || !all.every(s => TERMINAL.includes(s))) return { state: st, output: { phase: 'open' } };
    const status = all.includes('completed') ? 'completed' : all.includes('failed') ? 'failed' : 'cancelled';
    return {
      state: { ...st, final: status },
      effects: [{ key: 'order-final', system: 'orders', op: 'setStatus', args: { orderId: input.orderId, fulfilmentId: null, status } }],
      output: { phase: 'final', status },
    };
  }
  return { state: st, output: { phase: 'none' } };
}

// No events of its own: close is driven by the parent's calls.
function onEventRaw(event, ctx) {
  return { output: { phase: ctx.state?.final ?? 'open' } };
}

// The API may rename a field: api/<system>.schema.json in ctx.files shows the current names, so send those.
const fitNorm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
function fitArgs(e, files) {
  const sch = files?.[`api/${e.system}.schema.json`];
  const props = (typeof sch === 'string' ? JSON.parse(sch) : sch)?.ops?.[e.op]?.args?.properties;
  if (!props || e.args === null || typeof e.args !== 'object' || Array.isArray(e.args)) return e;
  const names = Object.keys(props);
  const keys = Object.keys(e.args);
  const extra = keys.filter(k => !names.includes(k));
  const missing = names.filter(n => !keys.includes(n));
  const renamed = {};
  for (const k of extra) renamed[k] = names.find(n => fitNorm(n) === fitNorm(k)) ?? (extra.length === 1 && missing.length === 1 ? missing[0] : k);
  const args = {};
  for (const k of keys) args[renamed[k] ?? k] = e.args[k];
  return { ...e, args };
}
function fitAll(res, files) {
  if (res === null || typeof res !== 'object' || !Array.isArray(res.effects)) return res;
  return { ...res, effects: res.effects.map(e => fitArgs(e, files)) };
}
export function step(input, ctx) { return fitAll(stepRaw(input, ctx), ctx.files); }
export function onEvent(event, ctx) { return fitAll(onEventRaw(event, ctx), ctx.files); }
