// Module order-id: the one normaliser of order ids (SPEC-E 3.1). Pure and stateless; the key is the constant 'n'.
// Trim spaces, remove a leading '#', upper-case: " ord-1001-0007" -> "ORD-1001-0007".

export function step(input, ctx) {
  return { output: { orderId: normalise(input.raw) } };
}

function normalise(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (s.startsWith('#')) s = s.slice(1).trim();
  s = s.toUpperCase();
  return s === '' ? null : s;
}
