// Module order-id, key: 'n'. The one normaliser of order ids (SPEC-E §3.1). Pure and stateless.
// Owns: §3.1 normalisation (trim spaces, drop a leading '#', upper-case).

export function step(input, ctx) {
  const raw = input.raw;
  if (raw === null || raw === undefined) return { output: { orderId: null } };
  const orderId = String(raw).trim().replace(/^#/, '').trim().toUpperCase();
  return { output: { orderId: orderId === '' ? null : orderId } };
}
