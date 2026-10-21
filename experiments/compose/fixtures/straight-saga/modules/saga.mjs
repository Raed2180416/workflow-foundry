// One fulfilment's forward saga. KEYED selects the idempotency keys: 'stable' (one key per logical effect) or 'time'
// (a key carrying the emission time: correct without faults, double-charging after a crash) for the fault harness.
const KEYED = 'stable';
const k = (name, ctx) => (KEYED === 'time' && name === 'charge' ? `charge@${ctx.now}` : name);
export function step(input, ctx) {
  const s = ctx.state ?? { phase: 'new' };
  if (input.start && s.phase === 'new') {
    const f = input.start;
    return { state: { phase: 'reserving', f, dispatched: false, completed: false }, output: null, effects: [
      { key: 'st-processing', system: 'orders', op: 'setStatus', args: { orderId: f.orderId, fulfilmentId: f.fulfilmentId, status: 'processing' } },
      { system: 'inventory', op: 'reserve', args: { orderId: f.orderId, fulfilmentId: f.fulfilmentId, location: f.location, items: f.items.map(i => ({ key: `rsv-${i.sku}`, sku: i.sku, qty: i.qty })) } }] };
  }
  if (input.report && s.f) {
    const code = input.report.code;
    const effects = [];
    const st = { ...s };
    const collected = ['COLLECTED', 'PU', 'picked', 'IN_TRANSIT', 'IT', 'moving'].includes(code), delivered = ['DELIVERED', 'DL', 'handed-over'].includes(code);
    if ((collected || delivered) && !st.dispatched) { st.dispatched = true; effects.push({ key: 'st-dispatched', system: 'orders', op: 'setStatus', args: { orderId: s.f.orderId, fulfilmentId: s.f.fulfilmentId, status: 'dispatched' } }); }
    if (delivered && !st.completed) { st.completed = true; effects.push({ key: 'st-completed', system: 'orders', op: 'setStatus', args: { orderId: s.f.orderId, fulfilmentId: s.f.fulfilmentId, status: 'completed' } }); }
    return { state: st, output: { done: st.completed, fulfilmentId: s.f.fulfilmentId }, effects };
  }
  return { output: null };
}
export function onEvent(ev, ctx) {
  const s = ctx.state;
  if (!s || !s.f) return { output: null };
  const p = ev.payload, f = s.f;
  if (p.op === 'reserve' && s.phase === 'reserving' && (p.items ?? []).every(i => i.status === 'ok')) {
    return { state: { ...s, phase: 'charging' }, output: null, effects: [{ key: k('charge', ctx), system: 'billing', op: 'charge', args: { orderId: f.orderId, fulfilmentId: f.fulfilmentId, customerId: f.customerId, amountMinor: f.amountMinor, currency: 'EUR' } }] };
  }
  if (p.op === 'charge' && p.status === 'ok' && s.phase === 'charging') {
    return { state: { ...s, phase: 'shipping' }, output: null, effects: [{ key: 'ship', system: 'carrier', op: 'create', args: { orderId: f.orderId, fulfilmentId: f.fulfilmentId, location: f.location, ref: `ref-${f.fulfilmentId}` } }] };
  }
  return { output: null };
}
