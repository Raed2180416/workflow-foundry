// Module notices, key: the order id. Owns SPEC-E 4.8: the only sender of notify.send. Each required notice is sent
// exactly once: its key is the template and its subject ('cancel-refused.<eventId>' for a refused cancel).

const TEXT = {
  'action-required': 'Please confirm how you want to proceed with the unavailable items of your order.',
  'order-cancelled': 'Your order has been cancelled.',
  'order-timed-out': 'Your order was not confirmed in time and has been cancelled.',
  'fulfilment-failed': 'Part of your order could not be fulfilled.',
  'cancel-refused': 'Your order has already been collected and can no longer be cancelled.',
};

export function step(input, ctx) {
  const s = ctx.state ?? { customerId: null, sent: {}, pend: {} };
  const eff = [];
  let sent = false;
  if (input.op === 'init') {
    s.customerId = input.customerId;
  } else if (input.op === 'send') {
    const key = input.template === 'cancel-refused' ? `cancel-refused.${input.occurrence}` : `${input.template}.${input.about}`;
    if (!s.sent[key]) {
      s.sent[key] = true;
      const cid = input.customerId ?? s.customerId ?? ctx.key;
      const email = lookup(J(ctx.files, 'master/customers.json'), 'customerId', cid, 'email');
      const args = { to: typeof email === 'string' ? email : cid, about: input.about, template: input.template, text: TEXT[input.template] };
      s.pend[key] = args;
      eff.push({ key, system: 'notify', op: 'send', args: conform(ctx.files, 'notify', 'send', args) });
      sent = true;
    }
  }
  return { output: { sent, busy: Object.keys(s.pend).length > 0 }, state: s, effects: eff };
}

export function onEvent(event, ctx) {
  const s = ctx.state ?? { customerId: null, sent: {}, pend: {} };
  const eff = [];
  if (event.type === 'effect.result') {
    const p = event.payload ?? {};
    const args = s.pend[p.key];
    if (args !== undefined) {
      const e = p.error;
      const permanent = e && typeof e === 'object' && e.retryable === false;
      if (p.status === 'ok' || permanent) delete s.pend[p.key];
      else eff.push({ key: p.key, system: 'notify', op: 'send', args: conform(ctx.files, 'notify', 'send', args) });
    }
  }
  return { output: { sent: false, busy: Object.keys(s.pend).length > 0 }, state: s, effects: eff };
}

// SPEC-E 4.6: effect arguments follow the system's current schema (api/<system>.schema.json, after any F5 rename).
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
  return out;
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
