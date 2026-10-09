// P12 map -> code reduce (for-each with typed coverage) — L1-PATTERNS §4. Fragment (flow, task, x, S) -> REDUCE(results).
// Slots: ITEMS (path), BODY (fn item -> object; code only), REDUCE (fn results -> output), MAX_ITEMS (int[1,1000]),
// CONCURRENCY (int[1,16]). Every result echoes its item id; map stays fail-fast (partial coverage is P19 wide).
export default async function P12(flow, task, x, S) {
  const items = S.ITEMS(task, x);
  flow.guard('bounded', items.length <= S.MAX_ITEMS, { n: items.length, max: S.MAX_ITEMS });
  const res = await flow.map(items, async (it, i) => ({ ...S.BODY(it), id: it.id ?? i }), { concurrency: S.CONCURRENCY });
  flow.invariant('one-per-item', res.length === items.length, {});
  flow.invariant('ids-echoed', res.every((r, i) => r.id === (items[i].id ?? i)), {});
  return S.REDUCE(res);
}
