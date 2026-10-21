export function step(input, ctx) {
  return { output: null, effects: [{ key: `st-${input.status}`, system: 'orders', op: 'setStatus', args: { orderId: ctx.key, fulfilmentId: null, status: input.status } }] };
}
export function onEvent() { return { output: null }; }
