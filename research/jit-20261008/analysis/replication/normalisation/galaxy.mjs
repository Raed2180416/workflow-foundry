// Declared normalisations for the Galaxy item. Frozen before scoring.
//   G: item-agnostic. Every table is a sequence of rows (untimed stream), cells compared as written (text normalisation only).
//   I: the job's own declared ordering semantics. The two tables the workflow SORTS (by_variant_report on POS; combined_variant_report on Sample,
//      POS) leave ties inside a sort key unspecified, so their rows are compared as a bag and the sort is checked by a derived effect
//      'tsv.sorted' (true iff rows are non-decreasing on the declared sort columns). The other tables stay sequences.
//      Sort columns are the declaration (identical to the oracle's compare.mjs TABLE_SPECS; this is item knowledge, i.e. oracle-like work).
export const G = { name: 'G', timeTolerance: null, order: 'auto' };

const SORTED = { by_variant_report: [{ col: 0, numeric: true }], combined_variant_report: [{ col: 0 }, { col: 1, numeric: true }] };
const cmp = (x, y, numeric) => (numeric ? Number(x) - Number(y) : x < y ? -1 : x > y ? 1 : 0);
function prepare(log) {
  const out = [], rows = new Map();
  for (const e of log) {
    out.push(e);
    if (e.type === 'tsv.row' && SORTED[e.key.table]) { const k = `${e.case}\u0000${e.stream}`; if (!rows.has(k)) rows.set(k, { e, list: [] }); rows.get(k).list.push(e.key.cells); }
  }
  for (const { e, list } of rows.values()) {
    const spec = SORTED[e.key.table];
    let ok = true;
    for (let i = 1; i < list.length && ok; i++) for (const s of spec) { const c = cmp(list[i - 1][s.col], list[i][s.col], s.numeric); if (c > 0) { ok = false; break; } if (c < 0) break; }
    out.push({ case: e.case, stream: `${e.stream}#sorted`, type: 'tsv.sorted', key: { table: e.key.table, sorted: ok } });
  }
  // a sorted table that is absent entirely still has to be reported sorted-or-not: expected always has the event when it has rows
  return out;
}
export const I = { name: 'I:galaxy (sorted tables as bags + sortedness predicate)', timeTolerance: null, order: 'auto', prepare,
  streamOrder: s => (s === 'by_variant_report' || s === 'combined_variant_report' ? 'bag' : undefined) };
