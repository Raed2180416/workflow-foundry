// Intake (SPEC-E R1): ask for the allocation of a placed order, then price it and record it (R1.1, R1.2).
// The parent handles duplicates (R1.4) and the edition (R1.3) and passes the edition in.

const fileJson = (files, p) => {
  let v = files?.[p];
  if (v === undefined) v = p.split('/').reduce((o, k) => (o ? o[k] : undefined), files);
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  return v ?? null;
};
const rowsOf = v => (Array.isArray(v) ? v : Array.isArray(v?.rows) ? v.rows : Array.isArray(v?.items) ? v.items
  : Array.isArray(v?.data) ? v.data : []);
const plainItems = items => (items ?? []).map(i => ({ sku: String(i.sku), qty: Number(i.qty) }));

// Σ qty × unitPriceMinor, plus the location's fee (none for an unavailable fulfilment) — R1.2.
const priceOf = (ctx, edition, items, loc) => {
  const catalog = rowsOf(fileJson(ctx.files, 'master/catalog.json'));
  let sum = 0;
  for (const it of items) {
    const row = catalog.find(r => r.sku === it.sku);
    if (!row || typeof row.unitPriceMinor !== 'number') throw new Error(`no unitPriceMinor for ${it.sku}`);
    sum += it.qty * row.unitPriceMinor;
  }
  if (loc !== null) {
    const fees = rowsOf(fileJson(ctx.files, `rulebook/${edition}/shipping-fees.json`));
    const fee = fees.find(r => r.location === loc);
    if (!fee || typeof fee.feeMinor !== 'number') throw new Error(`no feeMinor for location ${loc} in ${edition}`);
    sum += fee.feeMinor;
  }
  return sum;
};

export function step(input, ctx) {
  if (input.op === 'place') {
    return {
      output: { stage: 'allocating' },
      effects: [{ system: 'inventory', op: 'allocate', args: { orderId: input.order.orderId } }],
    };
  }
  if (input.op === 'allocated') {
    const order = input.order;
    const edition = input.edition;
    const raw = input.plan?.fulfilments ?? [];
    if (!raw.length) throw new Error('allocation has no fulfilments');
    const fl = raw.map(f => {
      const loc = f.location ?? null;
      const items = plainItems(f.items);
      const av = loc !== null && f.available !== false;
      return { fid: String(f.fulfilmentId), loc: av ? loc : null, av, amt: priceOf(ctx, edition, items, av ? loc : null), items };
    });
    const total = fl.reduce((s, f) => s + f.amt, 0);
    const customers = rowsOf(fileJson(ctx.files, 'master/customers.json'));
    const cust = customers.find(c => c.customerId === order.customerId);
    if (!cust || !cust.email) throw new Error(`no email for customer ${order.customerId}`);
    return {
      output: { fl, total, em: cust.email, cust: order.customerId, cur: order.currency, p: order.placedAt },
      effects: [{
        key: 'create', system: 'orders', op: 'create',
        args: {
          orderId: order.orderId, customerId: order.customerId, placedAt: order.placedAt, currency: order.currency,
          items: plainItems(order.items),
          fulfilments: fl.map(f => ({ fulfilmentId: f.fid, location: f.loc, items: f.items, amountMinor: f.amt })),
          totalMinor: total,
        },
      }],
    };
  }
  throw new Error(`intake: unknown op ${input.op}`);
}

export function onEvent(event, ctx) {
  // the order record's result: nothing to do but keep the module instance quiet (the parent reads the outcome)
  return { output: null };
}
