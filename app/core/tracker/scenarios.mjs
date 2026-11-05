// Condition-targeted practice rows (research/tracker-20261021/DOSSIER.md §5): practice data rarely holds the exact case a person's
// condition is about (a lead from Germany, an invoice exactly 10 days overdue, an expense of exactly 50). For every check with a row
// filter, code writes rows ON and just OUTSIDE the edge of that filter, so the condition is exercised on both sides.
//
// Each new row is a copy of a real practice row of the same sheet, preferably one the base run acted on (so the copy has every
// qualifier the flow needs, stated or not, such as status "new"), with the filter's columns set to the edge values and every naming
// column given a fresh value (so effects about the copy can be told apart). The values come only from the check, which comes only from
// the person's words and their data's vocabulary: scenarios add no condition, they only make existing ones testable.
import { actedOn, normText, isFreeText, semanticsLevel } from './checks.mjs';
import { namingColumns } from './practice.mjs';

const DAY = 86_400_000, HOUR = 3_600_000;
const iso = t => new Date(t).toISOString().replace('.000Z', 'Z');
const dateOnly = t => new Date(t).toISOString().slice(0, 10);

/** Values on and just outside one filter condition: [{ value, inside }]. Null when no edge can be written from it. */
function edges(c, { now, sample }) {
  const n = Number(c.n ?? c.value);
  const t = Date.parse(now);
  const isDate = typeof sample === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sample);
  const asTime = ms => (isDate ? dateOnly(ms) : iso(ms));
  switch (c.op) {
    case 'eq': return [{ value: c.value, inside: true }];
    case 'in': return (c.values ?? []).map(v => ({ value: v, inside: true }));
    case 'isTrue': return [{ value: true, inside: true }, { value: false, inside: false }];
    case 'isFalse': return [{ value: false, inside: true }, { value: true, inside: false }];
    case 'contains': return typeof sample === 'string' ? [{ value: `${sample} ${c.value}`, inside: true }] : [{ value: String(c.value), inside: true }];
    // Boundary-value analysis: the ON point, the OFF point just outside, and an IN point well inside (domain testing).
    case 'lt': return [{ value: n - 1, inside: true }, { value: n, inside: false }, { value: Math.floor(n / 2), inside: true }];
    case 'lte': return [{ value: n, inside: true }, { value: n + 1, inside: false }, { value: Math.floor(n / 2), inside: true }];
    case 'gt': return [{ value: n + 1, inside: true }, { value: n, inside: false }, { value: 2 * n + 1, inside: true }];
    case 'gte': return [{ value: n, inside: true }, { value: n - 1, inside: false }, { value: 2 * n, inside: true }];
    case 'ageDaysGte': return [{ value: asTime(t - n * DAY), inside: true }, { value: asTime(t - (n - 1) * DAY), inside: false }, { value: asTime(t - 2 * n * DAY), inside: true }];
    case 'ageDaysLte': return [{ value: asTime(t - n * DAY), inside: true }, { value: asTime(t - (n + 1) * DAY), inside: false }, { value: asTime(t - Math.floor(n / 2) * DAY), inside: true }];
    case 'ageHoursGte': return [{ value: iso(t - n * HOUR), inside: true }, { value: iso(t - (n - 1) * HOUR), inside: false }, { value: iso(t - 2 * n * HOUR), inside: true }];
    case 'ageHoursLte': return [{ value: iso(t - n * HOUR + 60_000), inside: true }, { value: iso(t - (n + 1) * HOUR), inside: false }, { value: iso(t - Math.floor(n / 2) * HOUR), inside: true }];
    default: return null;
  }
}

// v1-v3: the copy's name extends the original's ("P-1 S2", "scenario2.lena@x.de"), so an effect that names the copy also names the
// original under the word-boundary and token matchers of ./checks.mjs (held-out adjudication: scenario-names).
// v4 (./semantics.mjs R-copy-names): the marker is glued to the front of the first word ("S2P-1", "s2lena@x.de", "S2Where is my order"):
// no word of the original survives as a whole token at the start, so neither name contains the other, and the rest of the text (the
// words a flow may classify on) is kept.
function freshNames(row, naming, k, level = 1) {
  const out = { ...row };
  for (const c of naming) {
    const v = String(row[c]);
    if (level >= 4) out[c] = /^[^\s@]+@[^\s@]+$/.test(v) ? `s${k}${v}` : `S${k}${v}`;
    else out[c] = /^[^\s@]+@[^\s@]+$/.test(v) ? `scenario${k}.${v}` : `${v} S${k}`;
  }
  return out;
}

/** The row to copy: one the base run acted on if any, else the first row. */
function templateRow(items, view) {
  const acted = items.filter(it => actedOn(it, view));
  return (acted[0] ?? items[0])?.fields ?? null;
}

/**
 * scenarioRows(checks, baseView, { maxPerCheck }) → { <sheet>: [rows] }. checks: bound checks (with source/filter). Rows are the
 * filter's edges, one condition at a time: the edge value on that condition, every other condition at its first inside value.
 */
export function scenarioRows(checks, baseView, { maxPerCheck = 8, semantics = 'v1' } = {}) {
  const out = {};
  let k = 0;
  const seen = new Set();
  for (const check of checks) {
    const source = check?.source;
    const filter = check?.filter ?? [];
    if (!source || !filter.length || !['when-then', 'scope', 'count'].includes(check.template)) continue;
    const items = baseView.sources?.[source] ?? [];
    const base = templateRow(items, baseView);
    if (!base) continue;
    const naming = namingColumns(items.map(i => i.fields));
    // v2: a keyword in free text (a ticket body that "contains shipping") is no category a copied row can carry: appending it to another
    // row's text makes a chimera (a shipping subject over a password body), so such filters get no synthesized rows.
    if (semanticsLevel(semantics) >= 2 && filter.some(c => ['contains', 'notContains'].includes(c.op) && isFreeText(base[c.path]))) continue;
    const perCond = filter.map(c => edges(c, { now: baseView.now, sample: base[c.path] }));
    if (perCond.some(e => e === null) || filter.some(c => String(c.path).includes('.') || String(c.path).includes('*'))) continue;
    const insideDefaults = perCond.map(e => e.find(x => x.inside)?.value);
    if (insideDefaults.some(v => v === undefined)) continue;
    const rows = [];
    perCond.forEach((list, i) => {
      for (const e of list) {
        const row = { ...base };
        filter.forEach((c, j) => { row[c.path] = j === i ? e.value : insideDefaults[j]; });
        rows.push(row);   // naming columns get fresh values below, except the columns the filter sets
      }
    });
    for (const r of rows.slice(0, maxPerCheck)) {
      const key = `${source}\u0000${JSON.stringify(filter.map(c => r[c.path]))}`;
      if (seen.has(key)) continue;
      seen.add(key);
      (out[source] ??= []).push(freshNames(r, naming.filter(c => !filter.some(f => f.path === c)), ++k, semanticsLevel(semantics)));
    }
  }
  return out;
}
export { normText };
