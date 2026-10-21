// Module notices, key: the order id. The only sender of notify.send. Owns §4.8.
// Local keys: '<template>.<about>'; 'cancel-refused.<occurrence>' (the order id is already the instance key; full
// name within 200 characters, COMPOSE.md). Always return `output`.

export function step(input, ctx) {
  switch (input.op) {
    case 'init': return init(input, ctx);
    case 'send': return send(input, ctx);
    case 'resume': return resume(input, ctx);
  }
  throw new Error(`notices: unknown op ${input.op}`);
}

export function onEvent(event, ctx) {
  // notify.send results: record them; busy while any is pending. A 400: correct from api/notify.schema.json,
  // same key.
  throw new Error('notices.onEvent: not implemented');
}

function init(input, ctx) {
  // Keep customerId; `to` is that customer's email in master/customers.json (§4.8).
  throw new Error('notices.init: not implemented');
}

function send(input, ctx) {
  // Emit notify.send { to, about, template, text, ref: null } once per key (each required notification exactly
  // once, §4.8). about: the order id, or the fulfilment id for 'fulfilment-failed' (§4.8). sent false if the key
  // was already emitted.
  throw new Error('notices.send: not implemented');
}

function resume(input, ctx) {
  // §3.5: notifications already in the migrated records count as sent.
  throw new Error('notices.resume: not implemented');
}
