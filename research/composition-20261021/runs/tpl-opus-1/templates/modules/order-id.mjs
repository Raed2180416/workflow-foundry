// Module order-id: the one normaliser of order ids (SPEC-E §3.1). Pure and stateless; key: any constant ('n').
// Called by the parent and by intake for every order id they read (payloads, migration records, query results).

export function step(input, ctx) {
  // input: { raw }  ->  output: { orderId }
  // Trim spaces, remove a leading '#', upper-case (§3.1: " ord-1001-0007" -> "ORD-1001-0007").
  // raw null or absent -> orderId null. Return no state.
  throw new Error('order-id.step: not implemented');
}
