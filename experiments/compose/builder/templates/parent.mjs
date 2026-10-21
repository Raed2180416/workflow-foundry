// Parent orchestrator (template skeleton; see DECOMPOSITION.md §2). Routing, merge and the order of the phases only:
// it emits nothing itself and reaches every system through the modules.
const norm = s => (typeof s === 'string' ? s.trim().replace(/^#/, '').trim().toUpperCase() : null);

export function tick(input, ctx) {
  const st = input.state ?? { orderId: null, phase: 'new' };
  for (const ev of input.events) {
    if (ctx.ownerOf(ev)) { const out = ctx.deliver(ev); /* act on the owning module's output (phase changes) */ continue; }
    // TODO: order.placed, migration, customer.action, carrier.status (DECOMPOSITION.md §2 steps 1, 3, 4)
  }
  return { decisions: { subject: st.orderId }, state: st };
}
