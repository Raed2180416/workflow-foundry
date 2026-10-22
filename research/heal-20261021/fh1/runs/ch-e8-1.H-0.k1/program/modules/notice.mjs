// notice (SPEC-E §4.8): one customer notification. The key is derived from the template and what it is about, so a
// repeated emission of the same notice is the same effect and is applied once.

const TEXT = {
  'action-required': 'Some items of your order are unavailable. Please amend or cancel the order to continue.',
  'order-cancelled': 'Your order has been cancelled.',
  'order-timed-out': 'Your order has been cancelled because we did not hear from you in time.',
  'fulfilment-failed': 'Part of your order could not be fulfilled.',
  'cancel-refused': 'Your order has already been collected for delivery and can no longer be cancelled.',
};

const fileJson = (files, p) => {
  let v = files?.[p];
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  return v ?? null;
};

function emailOf(files, customerId) {
  const c = fileJson(files, 'master/customers.json');
  const list = Array.isArray(c) ? c : c?.customers ?? c;
  const hit = Array.isArray(list) ? list.find(x => x.customerId === customerId) : list?.[customerId];
  const email = typeof hit === 'string' ? hit : hit?.email;
  if (!email) throw new Error(`notice: no email for customer ${customerId}`);
  return email;
}

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
  const text = TEXT[input.template];
  if (!text) throw new Error(`notice: unknown template ${input.template}`);
  return {
    output: { template: input.template, about: input.about },
    effects: [{
      key: `n-${input.template}-${input.about}`,
      system: 'notify',
      op: 'send',
      args: { to: emailOf(ctx.files, input.customerId), about: input.about, template: input.template, text },
    }],
  };
}

// A notification's result needs no action: the send is applied or retried by the platform.
function onEventImpl() {
  return { output: null };
}

export function step(input, ctx) { return fitResult(ctx, stepImpl(input, ctx)); }
export function onEvent(ev, ctx) { return fitResult(ctx, onEventImpl(ev, ctx)); }
