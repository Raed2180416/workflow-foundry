// Module order-id, key: constant `n`. Owns SPEC-E §3.1: normalise every order id read anywhere.
// Pure and stateless: no effects, no timers, no calls. Always return `output`.

export function step(input, ctx) {
  return { output: { orderId: normalise(input.raw) } };
}

export function onEvent(event, ctx) {
  return { output: { orderId: null } };
}

// Trim spaces, drop a leading '#', upper-case (§3.1: " ord-1001-0007" -> "ORD-1001-0007").
function normalise(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (s.startsWith('#')) s = s.slice(1).trim();
  s = s.toUpperCase();
  return s.length ? s : null;
}
