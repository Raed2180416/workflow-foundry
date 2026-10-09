// P13 batched extract (map with a judge body, id echo) — L1-PATTERNS §4. Fragment (flow, task, x, S) -> {items}.
// Slots: ITEMS (path), TEXT (fn item -> text), READ (judge over a batch: schema {items: [{id, ...fields, quote}]}),
// PACK (int[1,20]), CONCURRENCY (int[1,8]). Every answer echoes exactly the batch's ids and quotes its own item; the
// loop exit is code (all batches read), never "the model says done".
export default async function P13(flow, task, x, S) {
  const items = S.ITEMS(task, x);
  const textOf = id => String(S.TEXT(items.find(it => String(it.id) === String(id)) ?? {}));
  const batches = chunk(items, S.PACK);
  const read = await flow.map(batches, b => flow.judge('read-batch', judgeSpec(S.READ, b, {
    check: v => (sameIds(v?.items, b) && v.items.every(r => textOf(r.id).includes(String(r.quote ?? ''))) ? null : 'id echo or quote failed') })),
  { concurrency: S.CONCURRENCY });
  const out = read.flatMap(v => v.items);
  flow.invariant('all-read', out.length === items.length, { read: out.length, items: items.length });
  return { items: out };
}
