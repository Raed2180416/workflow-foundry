// P08 guard -> act (filter before an effect) — L1-PATTERNS §4. Fragment (flow, task, x, S) -> {keep, drop}.
// Slots: ITEMS (path), KEEP (fn item -> true | reason-code string), ON_DROP ('note' | 'flag' | 'deopt'),
// MIN_KEEP (int[0,100000], optional). The filter reads code values only (a judged filter is P07 or P09). The effect, if
// any, happens in the envelope on `keep`: this solver returns the partition with a reason per dropped item.
export default async function P08(flow, task, x, S) {
  const items = S.ITEMS(task, x);
  const keep = [], drop = [];
  for (const it of items) { const r = S.KEEP(it); (r === true ? keep : drop).push({ it, r }); }   // bounded by the input list
  const reasons = countBy(drop, d => String(d.r));
  flow.note('filtered', { kept: keep.length, dropped: drop.length, reasons });
  if (S.ON_DROP === 'flag') drop.forEach(d => flow.flag('dropped', { id: d.it.id ?? null, reason: d.r }));
  if (S.ON_DROP === 'deopt') flow.guard('nothing-dropped', drop.length === 0, { reasons });
  if (S.MIN_KEEP != null) flow.guard('enough-kept', keep.length >= S.MIN_KEEP, { kept: keep.length, reasons });
  flow.invariant('partition', keep.length + drop.length === items.length, {});
  flow.invariant('drop-reasons', drop.every(d => typeof d.r === 'string' && d.r.length > 0), {});
  return { keep: keep.map(k => k.it), drop: drop.map(d => ({ id: d.it.id ?? null, reason: d.r })) };
}
