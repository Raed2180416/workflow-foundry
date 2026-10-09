// P07 router by kind (judged classify, then dispatch) — L1-PATTERNS §4. Fragment (flow, task, x, S) -> {routed}.
// Slots: ITEMS (path), KINDS (enum[]), CUE (fn item -> text), KIND_SPEC (judge head: tiers, system[, check]),
// HANDLERS ({kind: fn | hash}), ON_NONE ('review' | 'ignore'), CONCURRENCY (int[1,8]).
// The judge's enum is KINDS plus 'none-of-these' (built here, never by the constructor); its answer must quote the item.
export default async function P07(flow, task, x, S) {
  const items = S.ITEMS(task, x);
  const schema = { type: 'object', required: ['kind', 'quote'], additionalProperties: false,
    properties: { kind: { enum: [...S.KINDS, 'none-of-these'] }, quote: { type: 'string' } } };
  const routed = await flow.map(items, async it => {
    const cue = String(S.CUE(it));
    const v = await flow.judge('kind', judgeSpec(S.KIND_SPEC, it, { prompt: cue, schema,
      check: r => (r.kind === 'none-of-these' || (r.quote && cue.includes(r.quote)) ? null : 'quote not in item') }));
    if (v.kind === 'none-of-these') return { id: it.id, route: S.ON_NONE };
    const h = S.HANDLERS[v.kind];
    if (h == null) return { id: it.id, route: S.ON_NONE, unhandled: v.kind };
    return { id: it.id, route: v.kind, out: typeof h === 'string'
      ? await flow.call(h, it, { name: `handle-${v.kind}`, budgetUsd: 0.05, timeoutMs: 60000 })
      : flow.step(`handle-${v.kind}`, () => h(it)) };
  }, { concurrency: S.CONCURRENCY });
  flow.invariant('routed-once', new Set(routed.map(r => r.id)).size === items.length, { routed: routed.length, items: items.length });
  flow.note('routes', countBy(routed, r => r.route));
  return { routed };
}
