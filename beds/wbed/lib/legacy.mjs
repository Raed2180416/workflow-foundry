// Legacy-text helpers for W-bed R5 "legacy dump" (W-BED §3.5). Added for R5; no existing lib export changed. Pure
// functions over strings and integers: control totals in the canonical trailer shape, hash totals over text, signed
// zoned decimal (COBOL overpunch), number words, UTF-8 hex with an XOR mask, CSV quoting, major-unit amounts.
import { fmtAmount, minorDigits } from './domain.mjs';

// ---- the row shape a dump decodes to (identical to W-bed R1's extract-stage invoice record)
export const ROW_FIELDS = Object.freeze(['invoice', 'system', 'row', 'date_text', 'currency', 'amount_minor', 'status_text']);
export const TEXT_HASH_FIELDS = Object.freeze(['invoice', 'system', 'date_text', 'status_text']);

/** Hash total of a text: the sum of its Unicode code points (a legacy "hash total" over a non-numeric field). */
export function codeSum(text) {
  let s = 0;
  for (const ch of String(text)) s += ch.codePointAt(0);
  return s;
}

/** A row coerced to the row shape: strings stay strings, a number that does not parse is reported as 0. */
export function normRow(x) {
  const int = v => { const n = typeof v === 'number' ? v : Number(String(v ?? '').trim()); return Number.isSafeInteger(n) ? n : 0; };
  const s = v => (v === undefined || v === null ? '' : String(v));
  return { invoice: s(x?.invoice), system: s(x?.system), row: int(x?.row), date_text: s(x?.date_text), currency: s(x?.currency),
    amount_minor: int(x?.amount_minor), status_text: s(x?.status_text) };
}

/**
 * The canonical trailer of a set of rows: record count, hash total of the customer row ids, amount totals per currency
 * (smallest unit), and hash totals (code-point sums) of the four text fields. Every dump format writes these numbers in
 * its own convention; decoded to this shape they are what the agent node's verify predicate compares.
 */
export function trailerOf(rows) {
  const amounts = {};
  const hash = Object.fromEntries(TEXT_HASH_FIELDS.map(f => [f, 0]));
  let rowTotal = 0;
  for (const r of rows) {
    rowTotal += r.row;
    amounts[r.currency] = (amounts[r.currency] ?? 0) + r.amount_minor;
    for (const f of TEXT_HASH_FIELDS) hash[f] += codeSum(r[f]);
  }
  return { records: rows.length, row_total: rowTotal, amounts: Object.fromEntries(Object.keys(amounts).sort().map(k => [k, amounts[k]])), hash };
}

/** Canonical comparison key of a trailer (currency order free). */
export function trailerKey(t) {
  if (!t || typeof t !== 'object') return 'null';
  const am = t.amounts && typeof t.amounts === 'object' ? Object.keys(t.amounts).sort().map(k => `${k}=${t.amounts[k]}`).join(',') : '';
  const h = t.hash && typeof t.hash === 'object' ? TEXT_HASH_FIELDS.map(f => t.hash[f]).join(',') : '';
  return `${t.records}|${t.row_total}|${am}|${h}`;
}

// ---- signed zoned decimal with the sign overpunched on the last digit (IBM/COBOL "PIC S9(n)" DISPLAY)
const POS = '{ABCDEFGHI', NEG = '}JKLMNOPQR';
/** Zoned decimal of `n` in `width` characters, sign overpunched on the last digit. */
export function overpunch(n, width) {
  const neg = n < 0, digits = String(Math.abs(n)).padStart(width, '0');
  if (digits.length > width) throw new Error(`overpunch: ${n} does not fit ${width}`);
  const last = Number(digits[digits.length - 1]);
  return digits.slice(0, -1) + (neg ? NEG : POS)[last];
}
/** Parse zoned decimal with overpunch; NaN when it does not parse. */
export function unOverpunch(text) {
  const t = String(text).trim();
  if (!t) return NaN;
  const c = t[t.length - 1], head = t.slice(0, -1);
  if (!/^\d*$/.test(head)) return NaN;
  let i = POS.indexOf(c);
  if (i >= 0) return Number(head + i);
  i = NEG.indexOf(c);
  if (i >= 0) return -Number(head + i);
  return /\d/.test(c) ? Number(t) : NaN;
}

// ---- number words (prose READMEs at higher vagueness)
const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
export function numberWord(n) {
  if (!Number.isInteger(n) || n < 0 || n > 99) throw new Error(`numberWord: ${n}`);
  if (n < 20) return UNITS[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${UNITS[n % 10]}` : '');
}
export function parseNumberWord(text) {
  const t = String(text).trim().toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  for (let n = 0; n < 100; n++) if (numberWord(n) === t) return n;
  return NaN;
}

// ---- UTF-8 bytes as hex, each byte XOR-ed with a mask
export function utf8Hex(text, mask = 0) {
  return [...Buffer.from(String(text), 'utf8')].map(b => (b ^ mask).toString(16).padStart(2, '0').toUpperCase()).join('');
}
export function hexUtf8(hex, mask = 0) {
  const bytes = [];
  for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16) ^ mask);
  return Buffer.from(bytes).toString('utf8');
}

// ---- CSV (RFC 4180 quoting) with a chosen separator
export function csvField(v, sep = ',') {
  const s = String(v);
  return s.includes(sep) || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}
export function parseCsvLine(line, sep = ',') {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"' && cur === '') q = true;
    else if (c === sep) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

// ---- amounts in major units ("1234.50", "1,234.50"; yen have no decimals)
export const majorText = (minor, currency, { group = false } = {}) => `${minor < 0 ? '-' : ''}${fmtAmount(Math.abs(minor), minorDigits(currency), { group })}`;
/** Minor units of a major-unit text in `currency` ("1,234.50" -> 123450); NaN when it does not parse. */
export function parseMajor(text, currency) {
  const t = String(text).trim().replace(/,/g, '');
  const m = t.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!m) return NaN;
  let md;
  try { md = minorDigits(currency); } catch { md = 2; }
  const frac = (m[3] ?? '').padEnd(md, '0');
  if (frac.length > md) return NaN;
  const v = Number(m[2] + frac);
  return m[1] ? -v : v;
}
/** 10^(minor digits) of a currency (2 when the currency is unknown). */
export function unitOf(currency) {
  try { return 10 ** minorDigits(currency); } catch { return 100; }
}
