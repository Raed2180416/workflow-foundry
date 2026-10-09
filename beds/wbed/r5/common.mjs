// Shared pieces of the R5 dump formats: billing-system codes, the key=value trailer most formats use, README framing and
// the vagueness levels. A format is { id, name, tier, grade, layoutWhere, mistake: {name, why}, encode(ctx), decode(files,
// opts) }. encode receives the records in dump order ({kind: 'row' | 'extra', row, month, extraKind}) and returns
// { files: {name: text}, params }. decode(files, { keepExtras, mistake }) is the bed's white-box decoder: it reads only
// the files (per-task parameters come from the README, a code table, a copybook, a manifest or a dictionary, never from
// the hidden world) and returns { rows, trailer }; with `mistake` set to the format's characteristic misreading it
// returns what that misreading decodes. The tests check decode(files) == generator truth on every task.
import { ROW_FIELDS, TEXT_HASH_FIELDS, normRow, unitOf } from '../lib/legacy.mjs';

export { ROW_FIELDS, normRow };

export const SYS_CODE = Object.freeze({ BRIGHTDESK: 'BD', LEDGR: 'LG', ATLAS: 'AT', VENDEX: 'VX', KOBO: 'KB', VERITAS: 'VR', TALLY: 'TL' });
export const SYS_OF_CODE = Object.freeze(Object.fromEntries(Object.entries(SYS_CODE).map(([k, v]) => [v, k])));
export const sysName = code => SYS_OF_CODE[code] ?? code;
export const CODE_LIST = Object.entries(SYS_CODE).map(([n, c]) => `${c} = ${n}`).join(', ');

// ---- key=value trailer (labels fixed per convention; values integers in the smallest currency unit)
const HASH_KEY = { invoice: 'INVOICE', system: 'SYSTEM', date_text: 'DATE', status_text: 'STATUS' };
/** Trailer as key=value pairs. `style` picks the key spelling: 'dash' (AMT-EUR, HASH-DATE) or 'dot' (amt.EUR, hash.date). */
export function kvPairs(t, style = 'dash') {
  const k = style === 'dot' ? (a, b) => (b ? `${a}.${b}`.toLowerCase() : a.toLowerCase()) : (a, b) => (b ? `${a}-${b}` : a);
  const pairs = [[k('RECORDS'), t.records], [k('ROWSUM'), t.row_total]];
  for (const [c, v] of Object.entries(t.amounts)) pairs.push([style === 'dot' ? `amt.${c}` : `AMT-${c}`, v]);
  for (const f of TEXT_HASH_FIELDS) pairs.push([k('HASH', HASH_KEY[f]), t.hash[f]]);
  return pairs;
}
/** Parse key=value pairs (either spelling) back to the canonical trailer; null when no RECORDS key is present. */
export function parseKv(text) {
  const t = { records: NaN, row_total: NaN, amounts: {}, hash: Object.fromEntries(TEXT_HASH_FIELDS.map(f => [f, NaN])) };
  let seen = false;
  for (const m of String(text).matchAll(/([A-Za-z]+)(?:[-.]([A-Za-z]+))?\s*=\s*(-?\d+)/g)) {
    const a = m[1].toUpperCase(), b = m[2], v = Number(m[3]);
    if (a === 'RECORDS' && !b) { t.records = v; seen = true; } else if (a === 'ROWSUM' && !b) t.row_total = v;
    else if (a === 'AMT' && b) t.amounts[b.toUpperCase()] = v;
    else if (a === 'HASH' && b) { const f = TEXT_HASH_FIELDS.find(x => HASH_KEY[x] === b.toUpperCase()); if (f) t.hash[f] = v; }
  }
  if (!seen) return null;
  t.amounts = Object.fromEntries(Object.keys(t.amounts).sort().map(c => [c, t.amounts[c]]));
  return t;
}

// ---- README framing. Vagueness 0: every convention stated plainly. 1: stated in running prose. 2: stated as operators'
// notes that leave the reader to connect them (the layout facts the decoder needs are still all there).
export const TRAILER_MEANING = 'the number of invoice records, the sum of their customer row ids, the amount total per currency (smallest unit) and four hash totals: the sums of the Unicode code points of the invoice numbers, of the billing-system names (full names, not codes), of the printed invoice dates and of the status texts';
export function readmeHead(sub, title, vague) {
  const intro = [
    `${sub.short.toUpperCase()} — ${title}`,
    '',
    vague === 0
      ? `This directory is a dump of the invoice records of every billing system of ${sub.name}, written by the old receivables extract job because the billing exports could not be produced for this close. There is one record per invoice; dates and status texts are exactly as each billing system printed them.`
      : vague === 1
        ? `The receivables extract job of ${sub.name} wrote this dump when the billing exports could not be produced. It holds the invoice records of all billing systems, with each system's own printed dates and status texts.`
        : `Archive pull for ${sub.short} (receivables, all billing systems). Produced by the legacy extract when the exports failed; dates and statuses are passed through from the billing systems unchanged.`,
  ];
  return intro.join('\n');
}
export const trailerSentence = (where, vague) => (vague === 0
  ? `The trailer (${where}) carries the control totals of the extract: ${TRAILER_MEANING}. Records that are not invoices of the ledger are not counted in it.`
  : vague === 1
    ? `${where[0].toUpperCase()}${where.slice(1)} is the trailer with the extract's control totals (${TRAILER_MEANING}); it covers the invoice records only.`
    : `Control totals: ${where} (${TRAILER_MEANING}). The job computes them over what it extracted as invoices.`);

/** Amount of a row in a format that misreads units: whole units read as the smallest unit or the reverse. */
export const timesUnit = row => ({ ...row, amount_minor: row.amount_minor * unitOf(row.currency) });

export const isRecord = x => x.kind === 'row' || x.kind === 'extra';
export const rowsOf = records => records.filter(x => x.kind === 'row').map(x => x.row);
export const finish = (rows, trailer) => ({ rows: rows.map(normRow), trailer });
export const linesOf = text => String(text ?? '').split('\n');
export const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
