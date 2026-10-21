// Module intake, key: the order id. Owns R1.1, R1.2, R1.3, R1.4 and the placedAt rule of 3.1 (DECOMPOSITION 4.2).
// Effects: inventory.allocate (key 'allocate'), orders.create (key 'create'). Both keys are per order, so a retry or a
// repeated delivery reuses them.

const MIN = 60000;

export function step(input, ctx) {
  const s = ctx.state ?? fresh();
  if (input.op === 'placed') {
    if (s.st !== 'new') return { output: { ...outOf(s), duplicate: true }, state: s };
    const o = input.order;
    s.st = 'allocating';
    s.orderId = o.orderId;
    s.customerId = o.customerId;
    s.placedAt = o.placedAt;
    s.currency = o.currency ?? 'EUR';
    s.items = o.items.map(i => ({ sku: i.sku, qty: i.qty }));
    const effects = [allocateEffect(s)];
    conformAll(ctx.files, effects);
    return { output: outOf(s), state: s, effects };
  }
  return { output: outOf(s), state: s };
}

export function onEvent(event, ctx) {
  const s = ctx.state ?? fresh();
  const p = event.payload ?? {};
  const effects = [];
  if (event.type === 'effect.result') {
    if (p.key === 'allocate' && s.st === 'allocating') {
      if (p.status === 'ok') {
        const d = [p.result, p.data, p.value, p.output].find(x => x && typeof x === 'object') ?? p;
        s.edition = chooseEdition(ctx.files, s.placedAt);
        buildPlan(s, d.fulfilments ?? [], ctx.files);
        s.st = 'recording';
        effects.push(createEffect(s));
      } else {
        effects.push(allocateEffect(s));
      }
    } else if (p.key === 'create' && s.st === 'recording') {
      if (p.status === 'ok') {
        s.st = 'recorded';
      } else if (s.tries < 5) {
        s.tries = (s.tries ?? 0) + 1;
        effects.push(createEffect(s));
      }
    }
  }
  conformAll(ctx.files, effects);
  return { output: outOf(s), state: s, effects };
}

// SPEC-E 4.6: effect arguments follow the system's current schema (api/<system>.schema.json, after any F5 rename).
function conformAll(files, effects) {
  for (const e of effects) e.args = conform(files, e.system, e.op, e.args);
}

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
  for (const k of Object.keys(out)) {
    const p = props[k];
    if (p && p.items && p.items.properties && Array.isArray(out[k])) out[k] = out[k].map(x => (x && typeof x === 'object' ? fit(x, p.items) : x));
  }
  return out;
}

function allocateEffect(s) {
  return { key: 'allocate', system: 'inventory', op: 'allocate', args: { orderId: s.orderId } };
}

function createEffect(s) {
  return {
    key: 'create',
    system: 'orders',
    op: 'create',
    args: {
      orderId: s.orderId,
      customerId: s.customerId,
      placedAt: s.placedAt,
      currency: s.currency,
      items: s.items,
      fulfilments: s.plan.map(f => ({ fulfilmentId: f.fulfilmentId, location: f.location, items: f.items, amountMinor: f.amountMinor })),
      totalMinor: s.totalMinor,
    },
  };
}

// R1.2: amounts in integer minor units; the fee applies only when the location is not null.
function buildPlan(s, fulfilments, files) {
  const catalog = J(files, 'master/catalog.json');
  const fees = J(files, `rulebook/${s.edition}/shipping-fees.json`);
  let total = 0;
  s.plan = fulfilments.map(f => {
    const location = f.location ?? null;
    const available = location !== null && f.available !== false;
    const items = (f.items ?? []).map(i => ({ sku: i.sku, qty: i.qty }));
    let amountMinor = items.reduce((a, i) => a + i.qty * Number(lookup(catalog, 'sku', i.sku, 'unitPriceMinor') ?? 0), 0);
    if (available) amountMinor += Number(lookup(fees, 'location', location, 'feeMinor') ?? 0);
    total += amountMinor;
    return { fulfilmentId: f.fulfilmentId, location, available, items, amountMinor };
  });
  s.totalMinor = total;
}

// R1.3: the published edition with the latest effectiveFrom on or before the date of p (Europe/Amsterdam).
function chooseEdition(files, at) {
  const day = amsDate(at);
  let best = null;
  let bestFrom = '';
  for (const k of Object.keys(files ?? {})) {
    const m = /^rulebook\/([^/]+)\/edition\.json$/.exec(k);
    if (!m) continue;
    const from = String(J(files, k)?.effectiveFrom ?? '').slice(0, 10);
    if (from <= day && from >= bestFrom) { best = m[1]; bestFrom = from; }
  }
  if (best === null) throw new Error(`no edition in force at ${at}`);
  return best;
}

function amsDate(iso) {
  const t = Date.parse(iso);
  const y = new Date(t).getUTCFullYear();
  const lastSunday = mo => { const d = new Date(Date.UTC(y, mo + 1, 0)); return d.getUTCDate() - d.getUTCDay(); };
  const start = Date.UTC(y, 2, lastSunday(2), 1);
  const end = Date.UTC(y, 9, lastSunday(9), 1);
  const off = t >= start && t < end ? 120 : 60;
  return new Date(t + off * MIN).toISOString().slice(0, 10);
}

function fresh() {
  return { st: 'new', orderId: null, customerId: null, placedAt: null, currency: null, items: [], edition: null, plan: [], totalMinor: null, tries: 0 };
}

function outOf(s) {
  return {
    status: s.st,
    duplicate: false,
    busy: s.st === 'allocating' || s.st === 'recording',
    orderId: s.orderId,
    customerId: s.customerId,
    placedAt: s.placedAt,
    currency: s.currency,
    edition: s.edition,
    totalMinor: s.totalMinor,
    fulfilments: s.st === 'recorded' ? s.plan : null,
  };
}

function J(files, p) {
  let v = files ? files[p] : undefined;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = null; } }
  return v === undefined ? null : v;
}

// The value of `valueField` on the row whose `keyField` is `key`, in an array of rows or a map keyed by `key`.
function lookup(data, keyField, key, valueField) {
  const pick = e => (e && typeof e === 'object' ? (valueField in e ? e[valueField] : e) : e);
  const walk = (x, d) => {
    if (x === null || typeof x !== 'object' || d > 3) return undefined;
    if (Array.isArray(x)) {
      const hit = x.find(e => e && typeof e === 'object' && e[keyField] === key);
      if (hit !== undefined) return pick(hit);
      for (const y of x) { const r = walk(y, d + 1); if (r !== undefined) return r; }
      return undefined;
    }
    if (Object.prototype.hasOwnProperty.call(x, key)) return pick(x[key]);
    for (const k of Object.keys(x)) { const r = walk(x[k], d + 1); if (r !== undefined) return r; }
    return undefined;
  };
  return walk(data, 0);
}
