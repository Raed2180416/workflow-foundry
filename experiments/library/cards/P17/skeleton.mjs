// P17 reconcile two sources (join, diff, classify discrepancies) — L1-PATTERNS §4. Fragment -> {adjustments, unexplained}.
// Slots: LEFT, RIGHT (paths), MATCH (fn (left, right) -> {matched: [{left, right}], onlyLeft, onlyRight}), AMOUNT (fn row ->
// minor units), REASONS (enum[] incl. 'unexplained'), EXPLAIN (judge head + prompt over one difference; the schema
// {reason: REASONS, quote} is built here), ADJUST (fn (matched, diffs, why) -> [{id, reason, amountMinor}]; reads the
// reason enum only), CONCURRENCY (int[1,8]). The difference identity holds exactly: sum(adjustments) = sum(left) - sum(right).
export default async function P17(flow, task, x, S) {
  const left = S.LEFT(task, x), right = S.RIGHT(task, x);
  const unique = rows => new Set(rows.map(r => r.id)).size === rows.length;
  flow.guard('unique-ids', unique(left) && unique(right), { left: left.length, right: right.length });   // a duplicate goes to P16 first
  const { matched, onlyLeft, onlyRight } = flow.step('match', () => S.MATCH(left, right));
  const diffs = [
    ...onlyLeft.map(r => ({ side: 'left', id: r.id, row: r, delta: S.AMOUNT(r) })),
    ...onlyRight.map(r => ({ side: 'right', id: r.id, row: r, delta: -S.AMOUNT(r) })),
    ...matched.filter(m => S.AMOUNT(m.left) !== S.AMOUNT(m.right)).map(m => ({ side: 'both', id: m.left.id, row: m, delta: S.AMOUNT(m.left) - S.AMOUNT(m.right) })),
  ];
  const schema = { type: 'object', required: ['reason', 'quote'], additionalProperties: false, properties: { reason: { enum: S.REASONS }, quote: { type: 'string' } } };
  const why = await flow.map(diffs, d => flow.judge('reason', judgeSpec(S.EXPLAIN, d, { schema })), { concurrency: S.CONCURRENCY });
  const adjusted = flow.step('adjust', () => S.ADJUST(matched, diffs, why));
  const sum = rows => rows.reduce((n, r) => n + S.AMOUNT(r), 0);
  flow.invariant('explains-difference', adjusted.reduce((n, a) => n + a.amountMinor, 0) === sum(left) - sum(right), {});
  why.forEach((w, i) => { if (w.reason === 'unexplained') flow.flag('unexplained', { id: diffs[i].id }); });
  return { adjustments: adjusted, unexplained: diffs.filter((d, i) => why[i].reason === 'unexplained').map(d => d.id) };
}
