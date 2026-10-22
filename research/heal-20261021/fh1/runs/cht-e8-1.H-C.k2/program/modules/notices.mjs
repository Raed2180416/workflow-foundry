// Module notices, key: the order id. Owns §4.8: the only sender of notify.send. Each required notification is sent
// exactly once (one key per notice, kept in state). Effects: notify.send:<template> (keys `<template>.<about>`, or
// `cancel-refused.<eventId>`). Always return `output`.
//
// state: { customerId, sent: [notice key, ...] }

const TEMPLATES = ['action-required', 'order-cancelled', 'order-timed-out', 'fulfilment-failed', 'cancel-refused', 'unknown-order'];

const TEXT = {
  'action-required': 'Some items of your order are unavailable. Reply to amend the order or to cancel it.',
  'order-cancelled': 'Your order has been cancelled.',
  'order-timed-out': 'Your order has timed out because no action was taken on the unavailable items.',
  'fulfilment-failed': 'One part of your order could not be fulfilled and has been cancelled.',
  'cancel-refused': 'Your order can no longer be cancelled because it has already been collected for shipping.',
  'unknown-order': 'We could not find an order with that reference.',
};

// Files arrive as raw text: parse a JSON file (or pass a parsed value through).
function fileJson(files, path) {
  const v = files?.[path];
  return typeof v === 'string' ? JSON.parse(v) : v ?? null;
}

export function step(input, ctx) {
  switch (input.op) {
    case 'init': return init(input, ctx);
    case 'send': return send(input, ctx);
    case 'resume': return resume(input, ctx);
  }
  throw new Error(`notices: unknown op ${input.op}`);
}

export function onEvent(event, ctx) {
  // notify.send results need no action: the platform retries with the same key.
  return { output: { sent: ctx.state?.sent?.length ?? 0, busy: false } };
}

function init(input, ctx) {
  const state = { customerId: input.customerId, sent: ctx.state?.sent ?? [] };
  return { output: { sent: state.sent.length, busy: false }, state };
}

function send(input, ctx) {
  const state = ctx.state ?? { customerId: null, sent: [] };
  if (!TEMPLATES.includes(input.template)) throw new Error(`notices: unknown template ${input.template}`);
  const local = input.occurrence ? `${input.template}.${input.occurrence}` : `${input.template}.${input.about}`;
  if (state.sent.includes(local)) return { output: { sent: state.sent.length, busy: false } };
  const to = input.to ?? customerEmail(ctx.files, state.customerId);
  const e = {
    key: local,
    system: 'notify',
    op: 'send',
    args: { to, about: input.about, template: input.template, text: input.text ?? TEXT[input.template] },
  };
  const sent = [...state.sent, local];
  return { output: { sent: sent.length, busy: false }, state: { ...state, sent }, effects: [e] };
}

function resume(input, ctx) {
  // §3.5: the notices already sent for this order, from the records.
  const state = { customerId: input.customerId ?? null, sent: [...(input.sent ?? [])] };
  return { output: { sent: state.sent.length, busy: false }, state };
}

// The customer's email from master/customers.json (shape read defensively; see tests).
export function customerEmail(files, customerId) {
  const data = fileJson(files, 'master/customers.json');
  if (!data || customerId === null || customerId === undefined) return null;
  const rows = Array.isArray(data) ? data : Array.isArray(data.customers) ? data.customers : Object.values(data);
  for (const c of rows) {
    if (c && (c.customerId === customerId || c.id === customerId) && typeof c.email === 'string') return c.email;
  }
  const direct = data[customerId];
  return direct && typeof direct.email === 'string' ? direct.email : null;
}
