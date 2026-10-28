// Module intake, key: the order id. Owns R1.1 (allocate and record within 60 min of p), R1.2 (amounts),
// R1.3 (the edition in force at p) and R1.4 (a placed order already recorded is a duplicate). Effects:
// inventory.allocate (key `allocate`), orders.create (key `create`). Always return `output`.
//
// state: { status: 'allocating'|'recording'|'recorded', orderId, customerId, placedAt, currency, items, edition,
//          fulfilments: [{ fulfilmentId, location, available, items, amountMinor }], totalMinor }

// Files arrive as raw text: parse a JSON file (or pass a parsed value through).
function fileJson(files, path) {
  const v = files?.[path];
  return typeof v === 'string' ? JSON.parse(v) : v ?? null;
}

export function step(input, ctx) {
  switch (input.op) {
    case 'placed': return placed(input, ctx);
    case 'resume': return resume(input, ctx);
  }
  throw new Error(`intake: unknown op ${input.op}`);
}

export function onEvent(event, ctx) {
  const p = event.payload ?? {};
  const state = ctx.state;
  if (!state) return { output: idle() };
  if (p.key === 'allocate' && state.status === 'allocating' && p.status === 'ok') {
    return allocated(state, planOf(p), ctx);
  }
  if (p.key === 'create' && state.status === 'recording' && p.status === 'ok') {
    const next = { ...state, status: 'recorded' };
    return { output: view(next), state: next };
  }
  return { output: view(state) };
}

function idle() {
  return { status: 'new', duplicate: false, busy: false };
}

function view(state, extra = {}) {
  return {
    status: state.status,
    duplicate: false,
    orderId: state.orderId,
    customerId: state.customerId,
    placedAt: state.placedAt,
    currency: state.currency,
    edition: state.edition,
    fulfilments: state.fulfilments,
    totalMinor: state.totalMinor,
    busy: state.status !== 'recorded',
    ...extra,
  };
}

function placed(input, ctx) {
  if (ctx.state) return { output: { ...view(ctx.state), duplicate: true } };   // R1.4: already recorded here
  const o = input.order;
  const edition = editionAt(ctx.files, o.placedAt);
  if (!edition) throw new Error(`intake: no published edition in force at ${o.placedAt}`);
  const state = {
    status: 'allocating', orderId: o.orderId, customerId: o.customerId, placedAt: o.placedAt, currency: o.currency,
    items: o.items, edition, fulfilments: [], totalMinor: 0,
  };
  return { output: view(state), state, effects: [{ key: 'allocate', system: 'inventory', op: 'allocate', args: { orderId: o.orderId } }] };
}

function resume(input, ctx) {
  // §3.5: a migrated order that is already recorded: the record says what exists; intake is done.
  const r = input.records ?? {};
  const row = (r['orders.orders'] ?? [])[0];
  if (!row) return { output: idle() };
  const fulfilments = (r['orders.fulfilments'] ?? []).map(f => ({
    fulfilmentId: f.fulfilmentId, location: f.location ?? null, available: (f.location ?? null) !== null,
    items: f.items ?? [], amountMinor: f.amountMinor ?? 0,
  }));
  const state = {
    status: 'recorded', orderId: row.orderId, customerId: row.customerId, placedAt: row.placedAt, currency: row.currency,
    items: row.items ?? [], edition: editionAt(ctx.files, row.placedAt), fulfilments, totalMinor: row.totalMinor ?? 0,
  };
  return { output: view(state), state };
}

// The allocation plan from the inventory result. The result carries the plan as `{ orderId, fulfilments: [...] }`.
function planOf(p) {
  for (const c of [p.plan, p.result, p.value, p.output, p.data, p]) {
    if (c && Array.isArray(c.fulfilments)) return c.fulfilments;
  }
  throw new Error(`intake: allocation result has no fulfilments: ${JSON.stringify(p).slice(0, 120)}`);
}

function allocated(state, planned, ctx) {
  const catalog = fileJson(ctx.files, 'master/catalog.json') ?? [];
  const fees = fileJson(ctx.files, `rulebook/${state.edition}/shipping-fees.json`) ?? [];
  const price = Object.fromEntries(catalog.map(c => [c.sku, c.unitPriceMinor]));
  const fee = Object.fromEntries(fees.map(f => [f.location, f.feeMinor]));
  const fulfilments = planned.map(f => {
    const location = f.location ?? null;
    const items = f.items.map(i => ({ sku: i.sku, qty: i.qty }));
    let amountMinor = 0;
    for (const i of items) amountMinor += i.qty * (price[i.sku] ?? 0);                      // R1.2
    if (location !== null) amountMinor += fee[location] ?? 0;                               // a null location has no fee
    return { fulfilmentId: f.fulfilmentId, location, available: location !== null, items, amountMinor };
  });
  const totalMinor = fulfilments.reduce((s, f) => s + f.amountMinor, 0);                    // R1.2
  const next = { ...state, status: 'recording', fulfilments, totalMinor };
  const args = {
    orderId: state.orderId, customerId: state.customerId, placedAt: state.placedAt, currency: state.currency,
    items: state.items, fulfilments: fulfilments.map(f => ({ fulfilmentId: f.fulfilmentId, location: f.location, items: f.items, amountMinor: f.amountMinor })),
    totalMinor,
  };
  return { output: view(next), state: next, effects: [{ key: 'create', system: 'orders', op: 'create', args }] };
}

// The edition in force at instant `at` (R1.3): published, with the latest effectiveFrom on or before the local date
// of `at` in Europe/Amsterdam. Editions are the rulebook directories that have an edition.json.
export function editionAt(files, at) {
  const day = amsterdamDate(at);
  let best = null;
  for (const k of Object.keys(files ?? {})) {
    const m = /^rulebook\/([^/]+)\/edition\.json$/.exec(k);
    if (!m) continue;
    const ed = fileJson(files, k);
    if (!ed || typeof ed.effectiveFrom !== 'string' || ed.effectiveFrom > day) continue;
    if (!best || ed.effectiveFrom > best.effectiveFrom) best = { id: m[1], effectiveFrom: ed.effectiveFrom };
  }
  return best ? best.id : null;
}

// Local calendar date of an instant in Europe/Amsterdam (EU DST: last Sunday of March to last Sunday of October).
export function amsterdamDate(at) {
  const ms = Date.parse(at);
  const year = new Date(ms).getUTCFullYear();
  const lastSunday = month => {
    const d = new Date(Date.UTC(year, month + 1, 0, 1));                          // last day of month, 01:00 UTC
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.getTime();
  };
  const dst = ms >= lastSunday(2) && ms < lastSunday(9);
  return new Date(ms + (dst ? 2 : 1) * 3600000).toISOString().slice(0, 10);
}
