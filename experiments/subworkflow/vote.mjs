// The note vote (RESULT-SW-1 §7.3 and the review's $0 fix): every failing sub-workflow node in eval-1 failed on one or two
// rows that the batched judge labelled differently from other rows with the identical note text (10 wrong of 21,168 rows,
// 0.05%, but an exact node oracle fails on one). withNoteVote(spec) inserts, after each judge_rows step that shows a text
// field (default "note"), a pure code step that gives every row the majority label of all rows in that step with the
// identical text; a tie keeps the row's own label. Later steps that read the judge step read the voted rows instead. The
// result is an ordinary subworkflow/1 spec (one more pure op), so it is checked, practised, bound by hash and gated like
// any other. Applied by code to template-built specs in the SW-1c arms that set `vote` (node.mjs); the builder never sees it.
// Assumption (stated, bed-checked): rows with identical note text share one true label. golive's phrase banks are
// disjoint across labels, so this holds there by construction; on another bed it is a hypothesis to check before use.
const VOTE_FN = (field, key) => `const FIELD = ${JSON.stringify(field)}, KEY = ${JSON.stringify(key)};
export default ({ rows }) => {
  const tally = new Map();
  for (const r of rows) { const k = String(r[KEY] ?? ''); const m = tally.get(k) ?? new Map(); m.set(r[FIELD], (m.get(r[FIELD]) ?? 0) + 1); tally.set(k, m); }
  const pick = k => { const s = [...tally.get(k).entries()].sort((a, b) => b[1] - a[1]); return s.length > 1 && s[0][1] === s[1][1] ? null : s[0][0]; };
  return rows.map(r => { const m = pick(String(r[KEY] ?? '')); return m === null || m === r[FIELD] ? r : { ...r, [FIELD]: m, voted_from: r[FIELD] }; });
};`;

/** A copy of spec with a vote step after every judge_rows step that shows `keyField`; refs to the judge step are rewired. */
export function withNoteVote(spec, { keyField = 'note' } = {}) {
  const steps = [], renamed = new Map();
  for (const s of spec.steps ?? []) {
    const rewired = { ...s, args: (s.args ?? []).map(a => ({ ...a, ref: rewire(a.ref, renamed) })) };
    steps.push(rewired);
    if (s.op === 'judge_rows' && Array.isArray(s.show) && s.show.includes(keyField) && typeof s.field === 'string') {
      const id = `${s.id}_vote`;
      steps.push({ id, op: 'code', args: [{ name: 'rows', ref: `$${s.id}` }], fn: VOTE_FN(s.field, keyField) });
      renamed.set(s.id, id);
    }
  }
  return { ...spec, steps, output: rewire(spec.output, renamed) };
}
function rewire(ref, renamed) {
  if (typeof ref !== 'string') return ref;
  const m = /^\$([A-Za-z_]\w*)(.*)$/.exec(ref);
  return m && renamed.has(m[1]) ? `$${renamed.get(m[1])}${m[2]}` : ref;
}
