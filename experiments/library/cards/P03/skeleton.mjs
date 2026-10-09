// P03 extract -> normalise -> validate (model reads, code parses) — L1-PATTERNS §4. Fragment (flow, task, x, S) -> {rows, review}.
// Slots: SOURCES (path), PARSE (fn source -> rows; no model call), CONV_JUDGE (judge: enum fields + quote, on the source's
// note), NORMALISE (fn (row, convention) -> row), ROW_SCHEMA (schema), VALIDATE (fn row -> bool), REJECT ('deopt' | 'review'),
// CONCURRENCY (int[1,8]). The convention is read once per source and quoted from its note (conventions-once).
export default async function P03(flow, task, x, S) {
  const sources = S.SOURCES(task, x);
  const perSource = await flow.map(sources, async src => {
    const rows = flow.step(`parse:${src.id}`, () => S.PARSE(src));
    const note = String(src.note ?? '');
    const conv = await flow.judge('convention', judgeSpec(S.CONV_JUDGE, src, {
      check: v => (Object.values(v).includes('none') && v.quote === '') || (v.quote && note.includes(v.quote)) ? null : 'quote not in note' }));
    return rows.map(r => S.NORMALISE(r, conv));
  }, { concurrency: S.CONCURRENCY });
  const rows = perSource.flat();
  const bad = rows.filter(r => !(validates(S.ROW_SCHEMA, r) && S.VALIDATE(r)));
  flow.guard('validated', S.REJECT === 'review' || bad.length === 0, { n: bad.length, first: bad[0]?.id ?? null });
  flow.invariant('rows-conserved', rows.length === sources.reduce((n, s) => n + S.PARSE(s).length, 0), { rows: rows.length });
  return { rows: rows.filter(r => !bad.includes(r)), review: bad.map(r => ({ id: r.id, reason: 'invalid' })) };
}
