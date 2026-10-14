// Answer-neutrality guards for the need-r0pad padding (host code, used by the generator to redraw offending documents and
// by the tests to audit the result).
//   forbiddenOf(truth)   the strings of ONE task's truth that no padding document may contain: the invoice number and its
//                        digit tail, the customer row, the ISO issue date and its day/month-swapped twin, and net / tax /
//                        gross in every printed form (plain, "," grouped, "." grouped with a decimal comma, raw minor units).
//   hitsOf(text, forb)   which of them occur in a text (empty = clean). Dates inside a text are masked first, so a year in
//                        a date can never collide with a four-digit customer row such as 2025.
//   denyHits(text)       rule-like or status-like vocabulary that must not appear in a non-invoice padding document: the
//                        status words of the four billing systems, tax / discount / rounding / number-format / date-order
//                        phrases and reader-addressed instructions. A padding document that said any of these could
//                        change (or appear to change) how the R0 notes are read.
const MONTH_RE = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const DATE_MASKS = [
  /\b\d{4}-\d{2}-\d{2}\b/g, /\b\d{1,2} MONTH \d{4}\b/g, /\bMONTH \d{1,2}, \d{4}\b/g, /\bMONTH \d{4}\b/g,
  /\b\d{2}[/.-]\d{2}[/.-](?:\d{4}|\d{2})\b/g,
].map(re => new RegExp(re.source.replaceAll('MONTH', MONTH_RE), 'g'));
export const maskDates = text => DATE_MASKS.reduce((t, re) => t.replace(re, ' <date> '), String(text));

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const group = (n, sep) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);

/** Printed forms of an amount in minor units (two minor digits, the only case R0 draws). */
export function amountForms(minor) {
  const major = Math.floor(minor / 100), cents = String(minor % 100).padStart(2, '0');
  const forms = new Set([`${major}.${cents}`, `${group(major, ',')}.${cents}`, `${group(major, '.')},${cents}`]);
  return { formatted: [...forms], raw: String(minor).length >= 5 ? String(minor) : null };
}

export function forbiddenOf(truth) {
  const [y, m, d] = truth.issue_date.split('-');
  const tail = String(truth.invoice_number).match(/(\d+)\D*$/)?.[1] ?? null;
  return {
    invoiceNumber: String(truth.invoice_number), invoiceTail: tail, customerRow: String(truth.customer_row),
    dates: [truth.issue_date, `${y}-${d}-${m}`],
    amounts: { net: amountForms(truth.net_minor), tax: amountForms(truth.tax_minor), gross: amountForms(truth.gross_minor) },
  };
}

const runRe = digits => new RegExp(`(?<!\\d)${esc(digits)}(?!\\d)`);
const amtRe = form => new RegExp(`(?<![\\d.,])${esc(form)}(?!\\d)`);

export function hitsOf(text, forb) {
  const masked = maskDates(text);
  const out = [];
  if (text.toLowerCase().includes(forb.invoiceNumber.toLowerCase())) out.push('invoice-number');
  if (forb.invoiceTail && runRe(forb.invoiceTail).test(masked)) out.push('invoice-digits');
  if (runRe(forb.customerRow).test(masked)) out.push('customer-row');
  for (const iso of forb.dates) if (text.includes(iso)) out.push('issue-date');
  for (const [name, a] of Object.entries(forb.amounts)) {
    if (a.formatted.some(f => amtRe(f).test(text))) out.push(`${name}-formatted`);
    if (a.raw && runRe(a.raw).test(masked)) out.push(`${name}-raw`);
  }
  return out;
}

// Status vocabulary of the four R0 billing systems (ordinary words, void words and the per-task flag words).
export const STATUS_WORDS = ['open', 'void', 'voided', 'offen', 'storniert', 'cancelled', 'canceled', 'active', 'held', 'rebill', 'klarung', 'klärung', 'prufung', 'prüfung',
  'query', 'paused', 'queued', 'status', 'withdrawn'];
export const DENY = [
  ['status-word', new RegExp(`(?<![\\p{L}-])(?:${STATUS_WORDS.join('|')})(?![\\p{L}-])`, 'iu')],
  ['tax-or-discount', /\b(?:tax|taxes|vat|ust|mwst|discount|discounts|rebate|surcharge)\b/i],
  ['rounding-or-format', /\b(?:round(?:ed|ing)?|half away|minor unit|decimal|thousands|separator|grouping|number format)\b/i],
  ['date-order', /\b(?:day\/month|month\/day|dd\/mm|mm\/dd|dd-mm|dd\.mm|date order|date format|day first|month first|prints? (?:invoice )?dates?)\b/i],
  ['billing-rule', /\b(?:gross|net amount|line total|credited|credit note|invoice date|customer row|quantity x)\b/i],
  ['reader-instruction', /\b(?:ignore|disregard|instructions?|system prompt|previous|assistant|json|return only|you must|override)\b/i],
];
export const denyHits = text => DENY.filter(([, re]) => re.test(text)).map(([id]) => id);
