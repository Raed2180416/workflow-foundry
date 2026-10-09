// The decode stage of R5 under the exact solver and under each decode mistake. A mistake is either a format's
// characteristic misreading (run through the format's own decoder with that misreading switched on, so its output is
// what such a reader really gets) or a generic one that applies to every format. The truth is the generator's rows
// and trailer; the tests check that each format's decoder reproduces exactly that from the files.
import { normRow, unitOf, trailerKey, ROW_FIELDS, TEXT_HASH_FIELDS, codeSum } from '../lib/legacy.mjs';
import { DEV_FORMAT_IDS } from './catalogue.mjs';

export const rowKey = r => JSON.stringify(ROW_FIELDS.map(f => normRow(r)[f]));
/** Multiset comparison of two row lists (order free). */
export function rowsDiff(want, got) {
  const g = Array.isArray(got) ? got : [];
  const bag = new Map();
  for (const r of want) { const k = rowKey(r); bag.set(k, (bag.get(k) ?? 0) + 1); }
  let matched = 0, extra = 0;
  for (const r of g) {
    const k = rowKey(r ?? {});
    if (bag.get(k)) { bag.set(k, bag.get(k) - 1); matched++; } else extra++;
  }
  const missing = want.length - matched;
  return { exact: missing === 0 && extra === 0, matched, missing, extra, share: want.length ? matched / Math.max(want.length, g.length) : (g.length ? 0 : 1) };
}
export const rowsEqual = (a, b) => rowsDiff(a, b).exact;

/**
 * The agent node's verify predicate (FLOW-V3 §2.2 shape: null when it holds, else a reason): the decoded rows must
 * reproduce the trailer's record count, row-id hash total, amount total per currency and the four text hash totals.
 * `hashes: false` checks count, row-id total and amounts only (the weaker predicate the notes compare against).
 */
export function verifyPredicate(rows, trailer, { hashes = true } = {}) {
  if (!Array.isArray(rows)) return 'rows is not a list';
  if (!trailer || typeof trailer !== 'object') return 'no trailer';
  const rs = rows.map(normRow);
  if (rs.length !== trailer.records) return `record count ${rs.length} != trailer ${trailer.records}`;
  const rowTotal = rs.reduce((a, r) => a + r.row, 0);
  if (rowTotal !== trailer.row_total) return `row-id total ${rowTotal} != trailer ${trailer.row_total}`;
  const am = {};
  for (const r of rs) am[r.currency] = (am[r.currency] ?? 0) + r.amount_minor;
  const want = trailer.amounts && typeof trailer.amounts === 'object' ? trailer.amounts : {};
  const cur = [...new Set([...Object.keys(am), ...Object.keys(want)])].sort();
  for (const c of cur) if ((am[c] ?? 0) !== want[c]) return `amount total ${c} ${am[c] ?? 0} != trailer ${want[c]}`;
  if (hashes) {
    for (const f of TEXT_HASH_FIELDS) {
      const h = rs.reduce((a, r) => a + codeSum(r[f]), 0);
      if (h !== trailer.hash?.[f]) return `hash total ${f} ${h} != trailer ${trailer.hash?.[f]}`;
    }
  }
  return null;
}

// ---- the decode mistakes
export const GENERIC_MISTAKES = [
  { name: 'decoys-kept', why: 'the records the README excludes (deleted, struck, void copies, re-sent or superseded versions) decoded as invoices: the pack gains invoices that are not in the ledger' },
  { name: 'trailer-as-row', why: 'the trailer record decoded as one more invoice row (count and totals in its fields)' },
  { name: 'totals-forced', why: 'the excluded records kept, then as many genuine rows dropped from the end as were added, so the decoded record count matches the trailer (the amounts and hash totals do not)' },
  { name: 'amount-units-misread', why: 'amounts read in the wrong unit (whole units taken as the smallest unit): every non-yen amount a hundred times too large' },
];
export const NECESSITY_MISTAKE = 'dev-parsers-only';

const trailerRow = t => normRow({ invoice: 'TRAILER', system: '', row: t.records, date_text: '', currency: '', amount_minor: Object.values(t.amounts).reduce((a, b) => a + b, 0), status_text: '' });

/** Decode-stage output { rows, trailer } of `world` under `mistake` (null: the exact decode). */
export function decodeStage(world, mistake = null) {
  const { format, files, rows, trailer, records } = world;
  const truth = () => ({ rows: rows.map(normRow), trailer: structuredClone(trailer) });
  switch (mistake) {
    case null: return truth();
    case 'decoys-kept': return format.decode(files, { keepExtras: true });
    case 'trailer-as-row': return { rows: [...rows.map(normRow), trailerRow(trailer)], trailer: structuredClone(trailer) };
    case 'totals-forced': {
      const all = records.map(x => ({ ...x }));
      let drop = all.filter(x => x.kind === 'extra').length;
      for (let i = all.length - 1; i >= 0 && drop > 0; i--) if (all[i].kind === 'row') { all[i].dropped = true; drop--; }
      return { rows: all.filter(x => !x.dropped).map(x => normRow(x.row)), trailer: structuredClone(trailer) };
    }
    case 'amount-units-misread': return { rows: rows.map(r => normRow({ ...r, amount_minor: r.amount_minor * unitOf(r.currency) })), trailer: structuredClone(trailer) };
    case NECESSITY_MISTAKE: return DEV_FORMAT_IDS.includes(format.id) ? format.decode(files) : { rows: [], trailer: null };
    default:
      if (mistake === format.mistake.name) return format.decode(files, { mistake });
      return truth(); // another format's misreading does not apply to this dump
  }
}

/** Every decode mistake that applies to a world's format (generic ones and the format's own). */
export const mistakesFor = format => [...GENERIC_MISTAKES.map(m => m.name), format.mistake.name];

/** The decode self-check: the format's decoder reproduces the truth exactly. Throws on a generator bug. */
export function assertDecodes(world) {
  const d = world.format.decode(world.files);
  if (!rowsEqual(world.rows, d.rows) || trailerKey(d.trailer) !== trailerKey(world.trailer)) {
    throw new Error(`wbed-r5: format ${world.format.id} does not decode its own dump (seed ${world.spec.seed} d${world.spec.difficulty}): `
      + `${JSON.stringify(rowsDiff(world.rows, d.rows))} trailer ${trailerKey(d.trailer)} vs ${trailerKey(world.trailer)}`);
  }
}
