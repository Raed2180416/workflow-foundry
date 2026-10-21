// Module `intake` (template skeleton; its rules, interface and effects are in DECOMPOSITION.md §3 and composition.json).
// Keep everything a later tick needs in `state`; use stable local keys (one per logical effect).

export function step(input, ctx) {
  const state = ctx.state ?? {};
  // TODO: handle input.op
  return { state, output: null, effects: [] };
}

export function onEvent(event, ctx) {
  const state = ctx.state ?? {};
  // TODO: results of this instance's effects (event.payload.key is the local key), its timers and task events
  return { state, output: null, effects: [] };
}
