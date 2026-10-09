// P54 compose: call a library item per part — L1-PATTERNS §4 (J4, flow.call). Fragment (flow, task, x, S) -> COMBINE(kids, parts).
// Slots: PARTS (fn (task, x) -> [{key, input}]), REF (a literal library hash, never computed), CHILD_BUDGET (usd per call),
// ON_REFUSE ('deopt' | 'value'), COMBINE (fn (kids, parts) -> out), ARG (schema each part input must meet; checked here and
// by the composition checker against the child's contract: CALL_TYPE), READS (optional schema of what COMBINE reads of a
// child output), CONCURRENCY (int[1,4]). A child deopt comes back as a value and is flagged; the parent decides in COMBINE.
export default async function P54(flow, task, x, S) {
  const parts = S.PARTS(task, x);
  for (const p of parts) flow.invariant('arg-typed', validates(S.ARG, p.input), { key: p.key });
  const kids = await flow.map(parts, p => flow.call(S.REF, p.input, { name: `child:${p.key}`, budgetUsd: S.CHILD_BUDGET, timeoutMs: 300000,
    onDeopt: 'value', onRefuse: S.ON_REFUSE }), { concurrency: S.CONCURRENCY });
  kids.forEach((k, i) => { if (k && k.refused) flow.flag('child-refused', { key: parts[i].key, why: k.refused }); });
  kids.forEach((k, i) => { if (k && k.deopt) flow.flag('child-deopted', { key: parts[i].key, kind: k.deopt.kind }); });
  if (S.READS) kids.forEach((k, i) => { if (!(k && (k.refused || k.deopt))) flow.invariant('reads-typed', validates(S.READS, k), { key: parts[i].key }); });
  return S.COMBINE(kids, parts);
}
