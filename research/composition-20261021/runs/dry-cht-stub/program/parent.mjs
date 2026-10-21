// A deliberately partial composed solver (straight orders only): the fault harness's carry-dependent probe program.
const norm = s => (typeof s === 'string' ? s.trim().replace(/^#/, '').toUpperCase() : null);
export function tick(input, ctx) {
  const st = input.state ?? { O: null, fs: [], done: [] };
  let close = false;
  for (const ev of input.events) {
    if (ctx.ownerOf(ev)) {
      const out = ctx.deliver(ev);
      if (out && out.ready) { st.fs = out.fulfilments.map(f => f.fulfilmentId); ctx.call('order', st.O, { status: 'processing' }); for (const f of out.fulfilments) ctx.call('saga', f.fulfilmentId, { start: { orderId: st.O, customerId: out.customerId, ...f } }); }
      if (out && out.done) { if (!st.done.includes(out.fulfilmentId)) st.done.push(out.fulfilmentId); }
      continue;
    }
    if (ev.type === 'order.placed') {
      const O = norm(ev.payload.orderId);
      if (st.O === null && input.state === null) {
        const other = ctx.instances({ subject: O }).find(r => r.instance !== input.instance);
        if (other) return { decisions: { subject: O }, merge: { into: other.instance }, state: null };
      }
      if (st.O === null) { st.O = O; ctx.call('intake', O, { placed: ev.payload }); }
    }
    if (ev.type === 'carrier.status' && st.fs.includes(ev.payload.fulfilmentRef)) {
      const out = ctx.call('saga', ev.payload.fulfilmentRef, { report: ev.payload });
      if (out && out.done && !st.done.includes(ev.payload.fulfilmentRef)) st.done.push(ev.payload.fulfilmentRef);
    }
  }
  if (st.fs.length && st.done.length === st.fs.length && !st.closed) { ctx.call('order', st.O, { status: 'completed' }); st.closed = true; }
  if (st.O === null) close = true;
  return { decisions: { subject: st.O }, state: st, ...(close ? { close: true } : {}) };
}
