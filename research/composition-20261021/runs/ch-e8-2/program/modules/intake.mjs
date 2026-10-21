// intake: R1 (record the order once, with its amounts) and the R2.1 fraud check that follows it.
// Keys are local: 'allocate', 'create', 'fraud'. The parent passes the price and fee tables it read from the rulebook.

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// A result payload: the read result is whatever object the platform put beside the status.
const resultOf = p => {
  for (const k of ['result', 'data', 'value', 'output']) if (isObj(p?.[k])) return p[k];
  return isObj(p) ? p : {};
};

// R1.2: amountMinor = sum(qty * unitPriceMinor) + the location's fee (none when the location is null).
export function priceFulfilment(f, prices, fees) {
  let sum = 0;
  for (const it of f.items ?? []) sum += (it.qty ?? 0) * (prices[it.sku] ?? 0);
  const fee = f.location === null || f.location === undefined ? 0 : (fees[f.location] ?? 0);
  return sum + fee;
}

function stepRaw(input, ctx) {
  if (input.op !== 'place') return { output: null };
  const st = { orderId: input.orderId, customerId: input.customerId, placedAt: input.placedAt, currency: input.currency,
    items: input.items, prices: input.prices, fees: input.fees };
  return {
    state: st,
    effects: [{ key: 'allocate', system: 'inventory', op: 'allocate', args: { orderId: input.orderId } }],
    output: { phase: 'allocating' },
  };
}

function onEventRaw(event, ctx) {
  const st = ctx.state;
  if (event?.type !== 'effect.result' || !st) return { output: null };
  const p = event.payload ?? {};
  if (p.key === 'allocate') {
    if (p.status !== 'ok') return { output: { phase: 'allocate-failed', status: p.status } };
    const plan = resultOf(p);
    const fulfilments = (plan.fulfilments ?? []).map(f => {
      const row = { fulfilmentId: f.fulfilmentId, location: f.location ?? null, items: (f.items ?? []).map(i => ({ sku: i.sku, qty: i.qty })), available: f.available !== false };
      return { ...row, amountMinor: priceFulfilment(row, st.prices, st.fees) };
    });
    const totalMinor = fulfilments.reduce((s, f) => s + f.amountMinor, 0);
    const create = { orderId: st.orderId, customerId: st.customerId, placedAt: st.placedAt, currency: st.currency,
      items: st.items, fulfilments: fulfilments.map(({ available, ...f }) => f), totalMinor };
    return {
      state: { ...st, fulfilments, totalMinor },
      effects: [
        { key: 'create', system: 'orders', op: 'create', args: create },
        { key: 'fraud', system: 'fraud', op: 'check', args: { orderId: st.orderId } },
      ],
      output: { phase: 'recorded', fulfilments, totalMinor },
    };
  }
  if (p.key === 'create') return { output: { phase: 'created', status: p.status } };
  if (p.key === 'fraud') {
    if (p.status !== 'ok') return { output: { phase: 'fraud-failed', status: p.status } };
    const verdict = resultOf(p).verdict ?? p.verdict ?? null;
    return { output: { phase: 'verdict', verdict } };
  }
  return { output: null };
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
