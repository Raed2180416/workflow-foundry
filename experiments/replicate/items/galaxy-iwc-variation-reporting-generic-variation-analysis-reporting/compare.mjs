// Table comparison at three levels of strictness. The primary pass criterion is `strict`.
//
//  exact  : identical text (line endings and trailing blank lines normalised).
//  strict : identical header, identical multiset of rows, and the rows are in the order the workflow's own
//           sort steps define. Ties inside a sort key are NOT constrained (the original leaves them to the
//           unspecified tie-break of GNU sort), and the two unsorted tables must match line for line.
//  diff6  : Galaxy's shipped criterion (`compare: diff`, `lines_diff: 6`): at most 6 added plus removed lines in a
//           line diff (here a minimal LCS diff; Galaxy uses difflib, which can only report more differences).

// order: 'exact' (line for line) or a list of sort keys { col, numeric? } that the rows must be non-decreasing in.
export const TABLE_SPECS = {
  af_recalculated: { order: 'exact' },
  all_variants_all_samples: { order: 'exact' },
  by_variant_report: { order: [{ col: 0, numeric: true }] }, // sort -g on POS
  combined_variant_report: { order: [{ col: 0 }, { col: 1, numeric: true }] }, // sort by Sample, then POS numerically
};
export const LINES_DIFF = 6;

export const toLines = text => {
  const ls = text.replace(/\r\n/g, '\n').split('\n');
  while (ls.length && ls[ls.length - 1] === '') ls.pop();
  return ls;
};

export function diffLineCount(a, b) {
  const n = a.length, m = b.length;
  let prev = new Int32Array(m + 1), cur = new Int32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    [prev, cur] = [cur, prev];
  }
  const lcs = prev[m];
  return n - lcs + (m - lcs);
}

const cmpKey = (x, y, numeric) => (numeric ? Number(x) - Number(y) : x < y ? -1 : x > y ? 1 : 0);

export function compareTable(name, expectedText, actualText) {
  const spec = TABLE_SPECS[name];
  if (typeof actualText !== 'string') return { level: 'fail', exact: false, strict: false, diff6: false, why: 'table is not a string' };
  const e = toLines(expectedText), a = toLines(actualText);
  const exact = e.length === a.length && e.every((l, i) => l === a[i]);
  let strict = false, why = null;
  if (exact) strict = true;
  else if (a[0] !== e[0]) why = `header differs: expected "${e[0]}" got "${(a[0] ?? '').slice(0, 200)}"`;
  else if (a.length !== e.length) why = `${a.length - 1} data rows, expected ${e.length - 1}`;
  else {
    const count = rows => { const m = new Map(); for (const r of rows) m.set(r, (m.get(r) ?? 0) + 1); return m; };
    const ce = count(e.slice(1)), ca = count(a.slice(1));
    const missing = [...ce].find(([r, k]) => ca.get(r) !== k);
    if (missing) why = `row differs: expected "${missing[0].slice(0, 200)}" (x${missing[1]}), found x${ca.get(missing[0]) ?? 0}`;
    else if (spec.order === 'exact') why = 'same rows in a different order (this table is not re-sorted by the workflow)';
    else {
      strict = true;
      for (let i = 2; i < a.length && strict; i++) {
        const p = a[i - 1].split('\t'), q = a[i].split('\t');
        for (const k of spec.order) { const c = cmpKey(p[k.col], q[k.col], k.numeric); if (c > 0) { strict = false; why = `rows ${i} and ${i + 1} are out of order on column ${k.col + 1}`; break; } if (c < 0) break; }
      }
    }
  }
  let diff6 = exact;
  if (!exact && Math.abs(a.length - e.length) <= LINES_DIFF) diff6 = diffLineCount(e, a) <= LINES_DIFF;
  return { level: exact ? 'exact' : strict ? 'strict' : diff6 ? 'diff6' : 'fail', exact, strict, diff6, why };
}

export const LEVEL_RANK = { fail: 0, diff6: 1, strict: 2, exact: 3 };
