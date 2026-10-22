// Module intake, key: the order id. Owns R1.1 (allocate and record within 60 min of placedAt), R1.2 (amounts and
// fees), R1.3 (the edition in force at placedAt, fixed for the life of the order) and R1.4 (a placed order already
// recorded is a duplicate: no effect). Effects: inventory.allocate (key 'allocate'), orders.create (key 'create').
// Always returns `output`.

const MIN = 60000;

function lastSunday(y, m) {
  const last = new Date(Date.UTC(y, m + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}

function amsOffsetMin(ms) {
  const y = new Date(ms).getUTCFullYear();
  const start = Date.UTC(y, 2, lastSunday(y, 2), 1);
  const end = Date.UTC(y, 9, lastSunday(y, 9), 1);
  return ms >= start && ms < end ? 120 : 60;
}

// The calendar date of an instant in Europe/Amsterdam, YYYY-MM-DD.
function amsDate(ms) {
  const d = new Date(ms + amsOffsetMin(ms) * MIN);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function readJson(files, path) {
  let v = files?.[path];
  if (v === undefined) { v = files; for (const seg of path.split('/')) v = v?.[seg]; }
  if (typeof v === 'string') return JSON.parse(v);
  return v ?? null;
}

// Rows of a master or rulebook table, whether it is an array, an object holding an array, or a map keyed by id.
function rowsOf(x) {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') {
    const arr = Object.values(x).find(v => Array.isArray(v));
    if (arr) return arr;
    return Object.entries(x).map(([k, v]) => (v && typeof v === 'object' ? { key: k, ...v } : { key: k, value: v }));
  }
  return [];
}

function editionDirs(files) {
  const dirs = new Set();
  for (const k of Object.keys(files ?? {})) {
    const m = /^rulebook\/([^/]+)\/edition\.json$/.exec(k);
    if (m) dirs.add(m[1]);
  }
  if (dirs.size === 0 && files?.rulebook && typeof files.rulebook === 'object') {
    for (const k of Object.keys(files.rulebook)) if (files.rulebook[k]?.['edition.json'] !== undefined) dirs.add(k);
  }
  return [...dirs];
}

// R1.3: the published edition with the latest effectiveFrom on or before the Amsterdam date of placedAt.
function editionAt(files, placedAt) {
  const day = amsDate(Date.parse(placedAt));
  let best = null;
  for (const dir of editionDirs(files)) {
    const e = readJson(files, `rulebook/${dir}/edition.json`);
    if (!e || typeof e.effectiveFrom !== 'string' || e.effectiveFrom > day) continue;
    if (!best || e.effectiveFrom > best.from) best = { dir, from: e.effectiveFrom };
  }
  if (!best) throw new Error(`no edition in force at ${placedAt}`);
  return best.dir;
}

function priceOf(files, sku) {
  const r = rowsOf(readJson(files, 'master/catalog.json')).find(x => (x.sku ?? x.key) === sku);
  if (!r || typeof r.unitPriceMinor !== 'number') throw new Error(`no unit price for ${sku}`);
  return r.unitPriceMinor;
}

function feeOf(files, edition, location) {
  const r = rowsOf(readJson(files, `rulebook/${edition}/shipping-fees.json`)).find(x => (x.location ?? x.key) === location);
  const fee = r?.feeMinor ?? r?.value;
  if (typeof fee !== 'number') throw new Error(`no shipping fee for ${location} in ${edition}`);
  return fee;
}

// R1.2: Σ qty × unit price, plus the location's fee when the fulfilment has a location.
function amountOf(files, edition, f) {
  const goods = f.items.reduce((sum, it) => sum + it.qty * priceOf(files, it.sku), 0);
  return f.location === null ? goods : goods + feeOf(files, edition, f.location);
}

function outOf(st, duplicate) {
  const plan = st && st.status !== 'new' ? {
    orderId: st.order.orderId,
    customerId: st.order.customerId,
    placedAt: st.order.placedAt,
    currency: st.order.currency,
    edition: st.edition,
    totalMinor: st.totalMinor,
    fulfilments: st.fulfilments ?? [],
  } : {};
  const output = { status: st?.status ?? 'new', duplicate, busy: !!st && Object.keys(st.inflight ?? {}).length > 0 };
  for (const [k, v] of Object.entries(plan)) if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) output[k] = v;
  return { output };
}

function fitEffect(e, ctx) {
  return { ...e, args: fit(e.system, e.op, e.args, ctx) };
}

function createEffect(st) {
  return {
    key: 'create', system: 'orders', op: 'create',
    args: {
      orderId: st.order.orderId,
      customerId: st.order.customerId,
      placedAt: st.order.placedAt,
      currency: st.order.currency,
      items: st.order.items,
      fulfilments: st.fulfilments.map(f => ({ fulfilmentId: f.fulfilmentId, location: f.location, items: f.items, amountMinor: f.amountMinor })),
      totalMinor: st.totalMinor,
    },
  };
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
    case 'placed': return placed(input, ctx);
    case 'resume': return resume(input, ctx);
  }
  throw new Error(`intake: unknown op ${input.op}`);
}

export function onEvent(event, ctx) {
  const st = ctx.state;
  if (!st) return outOf(null, false);
  const p = event.payload ?? {};
  if (event.type !== 'effect.result') return outOf(st, false);

  if (p.key === 'allocate' && st.status === 'allocating') {
    if (p.status !== 'ok') return outOf(st, false);                 // permanent failure: stays allocating
    const plan = p.result ?? p;
    const edition = editionAt(ctx.files, st.order.placedAt);
    const fulfilments = plan.fulfilments.map(f => {
      const available = f.location !== null && f.available !== false;
      const location = f.location;
      const item = { fulfilmentId: f.fulfilmentId, location, available, items: f.items };
      return { ...item, amountMinor: amountOf(ctx.files, edition, { items: f.items, location }) };
    });
    const totalMinor = fulfilments.reduce((sum, f) => sum + f.amountMinor, 0);
    const next = { ...st, status: 'recording', edition, fulfilments, totalMinor, inflight: { create: true } };
    return { ...outOf(next, false), state: next, effects: [fitEffect(createEffect(next), ctx)] };
  }

  if (p.key === 'create' && st.status === 'recording') {
    if (p.status === 'ok') {
      const next = { ...st, status: 'recorded', inflight: {} };
      return { ...outOf(next, false), state: next };
    }
    if (p.error?.status === 400 || p.error?.code === 'invalid-args' || p.error?.code === 'field-renamed') {
      return { ...outOf(st, false), effects: [fitEffect(createEffect(st), ctx)] };   // our request was wrong: same key, same args, again
    }
    return outOf(st, false);
  }
  return outOf(st, false);
}

function placed(input, ctx) {
  if (ctx.state) return outOf(ctx.state, true);                    // already placed in this instance: duplicate
  const orderId = ctx.call('order-id', 'n', { raw: input.order.orderId }).orderId;
  const recorded = ctx.query('orders.orders', { where: { orderId }, limit: 1 });
  if (recorded.length > 0) return outOf({ status: 'recorded', order: { orderId }, inflight: {} }, true);   // R1.4
  const order = { ...input.order, orderId };
  const st = { status: 'allocating', order, edition: null, fulfilments: [], totalMinor: null, inflight: { allocate: true } };
  return {
    ...outOf(st, false),
    state: st,
    effects: [fitEffect({ key: 'allocate', system: 'inventory', op: 'allocate', args: { orderId } }, ctx)],
  };
}

function resume(input, ctx) {
  // §3.5: a migrated order that is already recorded keeps its plan.
  const r = input.records?.intake;
  if (!r) return outOf(null, false);
  const edition = editionAt(ctx.files, r.order.placedAt);
  const st = { status: 'recorded', order: r.order, edition, fulfilments: r.fulfilments, totalMinor: r.totalMinor, inflight: {} };
  return { ...outOf(st, false), state: st };
}
