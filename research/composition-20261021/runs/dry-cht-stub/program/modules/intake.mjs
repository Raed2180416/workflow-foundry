const edition = (files, placedAt) => {
  const eds = Object.keys(files).filter(f => /^rulebook\/[^/]+\/edition\.json$/.test(f)).map(f => JSON.parse(files[f]))
    .filter(e => e.effectiveFrom <= placedAt.slice(0, 10)).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return eds[0]?.id;
};
export function step(input, ctx) {
  if (ctx.state) return { output: null };
  const O = input.placed.orderId.trim().replace(/^#/, '').toUpperCase();
  return { state: { O, placed: input.placed, plan: null, verdict: null, recorded: false }, output: null,
    effects: [{ key: 'alloc', system: 'inventory', op: 'allocate', args: { orderId: O } }, { key: 'fraud', system: 'fraud', op: 'check', args: { orderId: O } }] };
}
export function onEvent(ev, ctx) {
  const s = { ...ctx.state };
  const p = ev.payload;
  if (p.status !== 'ok') return { state: s, output: null };
  if (p.key === 'alloc') s.plan = p.result;
  if (p.key === 'fraud') s.verdict = p.result.verdict;
  if (p.key === 'create') return { state: { ...s, recorded: true }, output: s.verdict === 'pass' && s.plan.fulfilments.every(f => f.available) ? { ready: true, fulfilments: s.fulfilments, customerId: s.placed.customerId } : null };
  if (s.plan && s.verdict && !s.created) {
    const files = ctx.files;
    const ed = edition(files, s.placed.placedAt);
    const fees = JSON.parse(files[`rulebook/${ed}/shipping-fees.json`]);
    const catalog = JSON.parse(files['master/catalog.json']);
    const price = sku => catalog.find(c => c.sku === sku).unitPriceMinor;
    const fuls = s.plan.fulfilments.map(f => ({ fulfilmentId: f.fulfilmentId, location: f.location, items: f.items,
      amountMinor: f.items.reduce((a, i) => a + i.qty * price(i.sku), 0) + (f.location ? fees.find(x => x.location === f.location).feeMinor : 0) }));
    s.created = true; s.fulfilments = fuls;
    return { state: s, output: null, effects: [{ key: 'create', system: 'orders', op: 'create', args: { orderId: s.O, customerId: s.placed.customerId, placedAt: s.placed.placedAt,
      currency: s.placed.currency, items: s.placed.items, fulfilments: fuls, totalMinor: fuls.reduce((a, f) => a + f.amountMinor, 0) } }] };
  }
  return { state: s, output: null };
}
