// P16 dedupe by identity (blocking + pairwise judge + union-find) — L1-PATTERNS §4. Fragment -> {clusters}.
// Slots: ROWS (path), BLOCK (fn row -> key[]), SIM (fn (a, b) -> 0..1), BAND ([lo, hi]), SAME (judge on a pair:
// {same: enum incl. 'unsure', quote}), CONCURRENCY (int[1,8]). Pairs at or above hi merge by code; pairs inside the
// borderline band go to the judge (FRONTIER-GAPS N4: the R1 error locus had no judge); merges are transitive
// (union-find) and rows are conserved. A row with no blocking key is outside the compiled domain.
export default async function P16(flow, task, x, S) {
  const rows = S.ROWS(task, x);
  flow.guard('blockable', rows.every(r => S.BLOCK(r).length > 0), { unblockable: rows.filter(r => !S.BLOCK(r).length).map(r => r.id) });
  const scored = candidatePairs(rows, S.BLOCK).map(p => ({ ...p, s: S.SIM(p.a, p.b) }));
  const sure = scored.filter(p => p.s >= S.BAND[1]);
  const band = scored.filter(p => p.s >= S.BAND[0] && p.s < S.BAND[1]);
  const judged = await flow.map(band, p => flow.judge('same-entity', judgeSpec(S.SAME, p)), { concurrency: S.CONCURRENCY });
  band.forEach((p, i) => { if (judged[i].same === 'unsure') flow.flag('weak-merge', { a: p.a.id, b: p.b.id }); });
  const clusters = unionFind(rows, [...sure, ...band.filter((p, i) => judged[i].same === 'same')]);
  flow.invariant('rows-conserved', clusters.flat().length === rows.length, {});
  flow.note('dedupe', { pairs: scored.length, sure: sure.length, judged: band.length });
  return { clusters: clusters.map(c => c.map(r => r.id)) };
}
