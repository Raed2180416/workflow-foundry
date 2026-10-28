// intake (SPEC-E §4.1 R1.1-R1.3, §4.2 R2.1): a placed order is read against its allocation and its fraud verdict,
// priced in the edition in force at placedAt, and recorded with orders.create. Nothing is recorded before both reads.

const AMS = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Amsterdam', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const wall = t => Object.fromEntries(AMS.formatToParts(new Date(Math.floor(t / 1000) * 1000)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
const dayOf = t => { const p = wall(t); return `${p.year}-${p.month}-${p.day}`; };
const ms = s => new Date(s).getTime();

const fileJson = (files, p) => {
  let v = files?.[p];
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  return v ?? null;
};

// The published edition with the latest effectiveFrom on or before the date of t (Europe/Amsterdam).
function editionAt(files, t) {
  const day = dayOf(t);
  let best = null;
  for (const k of Object.keys(files ?? {})) {
    const m = /^rulebook\/([^/]+)\/edition\.json$/.exec(k);
    const e = m ? fileJson(files, k) : null;
    if (!e || typeof e.effectiveFrom !== 'string') continue;
    const from = e.effectiveFrom.slice(0, 10);
    if (from <= day && (!best || from > best.from)) best = { dir: m[1], from };
  }
  if (!best) throw new Error('intake: no rulebook edition in force');
  return best.dir;
}

// Lets a read result carry its data at the top level or under result/data/output.
const pick = (p, name) => [p?.[name], p?.result?.[name], p?.data?.[name], p?.output?.[name]].find(x => x !== undefined && x !== null);

function priceOf(cat, sku) {
  const row = Array.isArray(cat) ? cat.find(r => r.sku === sku) : (cat?.[sku] ?? cat?.skus?.[sku] ?? cat?.items?.[sku]);
  const v = typeof row === 'number' ? row : row?.unitPriceMinor;
  if (!Number.isInteger(v)) throw new Error(`intake: no unit price for ${sku}`);
  return v;
}

function feeOf(tbl, loc) {
  const rows = Array.isArray(tbl) ? tbl : tbl?.fees ?? tbl?.locations ?? null;
  const row = Array.isArray(rows) ? rows.find(r => r.location === loc) : tbl?.[loc];
  const v = typeof row === 'number' ? row : row?.feeMinor;
  if (!Number.isInteger(v)) throw new Error(`intake: no shipping fee for ${loc}`);
  return v;
}

const plain = items => items.map(it => ({ sku: it.sku, qty: it.qty }));

// The API may rename a field (api/<system>.schema.json in ctx.files shows the current names): each field is sent under
// the name the current schema gives it, matched by type when it is the only one left.
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const squash = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const words = s => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const near = (a, b) => {
  if (squash(a) === squash(b)) return 3;
  if (squash(a).includes(squash(b)) || squash(b).includes(squash(a))) return 2;
  return words(a).filter(w => words(b).includes(w)).length;
};
function fit(ctx, system, op, args) {
  let api = ctx.files?.[`api/${system}.schema.json`];
  if (typeof api === 'string') { try { api = JSON.parse(api); } catch { api = null; } }
  const props = api?.ops?.[op]?.args?.properties;
  if (!props || !args || Object.keys(args).every(k => hasOwn(props, k))) return args;
  const spare = Object.keys(props).filter(k => !hasOwn(args, k));
  const out = {};
  for (const k of Object.keys(args)) {
    if (hasOwn(props, k)) { out[k] = args[k]; continue; }
    const t = typeof args[k] === 'number' ? ['integer', 'number'] : [typeof args[k]];
    const ok = spare.filter(s => [].concat(props[s].type ?? []).some(x => t.includes(x)));
    const scored = ok.map(s => [near(k, s), s]).sort((a, b) => b[0] - a[0]);
    const pick = scored.length && scored[0][0] > 0 && (scored.length === 1 || scored[1][0] < scored[0][0]) ? scored[0][1] : (ok.length === 1 ? ok[0] : null);
    if (pick) { out[pick] = args[k]; spare.splice(spare.indexOf(pick), 1); } else out[k] = args[k];
  }
  return out;
}
const fitResult = (ctx, r) => (r && Array.isArray(r.effects) ? { ...r, effects: r.effects.map(e => ({ ...e, args: fit(ctx, e.system, e.op, e.args) })) } : r);

function stepImpl(input, ctx) {
  if (input.op !== 'place') return { output: null };
  const o = input.order;
  const state = { o: { orderId: o.orderId, customerId: o.customerId, placedAt: o.placedAt, currency: o.currency, items: plain(o.items) }, plan: null, verdict: null, recorded: false };
  return {
    output: { status: 'waiting' },
    state,
    effects: [
      { key: 'allocate', system: 'inventory', op: 'allocate', args: { orderId: o.orderId } },
      { key: 'fraud', system: 'fraud', op: 'check', args: { orderId: o.orderId } },
    ],
  };
}

function onEventImpl(ev, ctx) {
  const st = ctx.state;
  if (!st || st.recorded || ev.type !== 'effect.result') return { output: null };
  const p = ev.payload;
  if (p.key === 'allocate' && p.status === 'ok') st.plan = pick(p, 'fulfilments') ?? null;
  if (p.key === 'fraud' && p.status === 'ok') st.verdict = pick(p, 'verdict') ?? 'review';
  if (!Array.isArray(st.plan) || !st.verdict) return { output: { status: 'waiting' }, state: st };

  const o = st.o;
  const ed = editionAt(ctx.files, ms(o.placedAt));
  const cat = fileJson(ctx.files, 'master/catalog.json');
  const fees = fileJson(ctx.files, `rulebook/${ed}/shipping-fees.json`);
  const fulfilments = st.plan.map(f => {
    const location = f.location ?? null;
    const items = plain(f.items);
    let amountMinor = 0;
    for (const it of items) amountMinor += it.qty * priceOf(cat, it.sku);
    if (location !== null) amountMinor += feeOf(fees, location);
    return { fulfilmentId: f.fulfilmentId, location, items, amountMinor, available: location !== null };
  });
  const totalMinor = fulfilments.reduce((s, f) => s + f.amountMinor, 0);
  st.recorded = true;
  return {
    output: { status: 'recorded', verdict: st.verdict, edition: ed, totalMinor, fulfilments },
    state: st,
    effects: [{
      key: 'create',
      system: 'orders',
      op: 'create',
      args: {
        orderId: o.orderId,
        customerId: o.customerId,
        placedAt: o.placedAt,
        currency: o.currency,
        items: o.items,
        fulfilments: fulfilments.map(f => ({ fulfilmentId: f.fulfilmentId, location: f.location, items: f.items, amountMinor: f.amountMinor })),
        totalMinor,
      },
    }],
  };
}

export function step(input, ctx) { return fitResult(ctx, stepImpl(input, ctx)); }
export function onEvent(ev, ctx) { return fitResult(ctx, onEventImpl(ev, ctx)); }
