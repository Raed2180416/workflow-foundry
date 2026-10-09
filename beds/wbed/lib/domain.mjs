// Shared primitives of the W-bed back-office world (W-BED §2.1). Everything that already exists in the `records`
// and `kinetics` beds is imported unchanged (those beds are frozen); only what they do not export is written here.
//
//   identity resolution   records/world.mjs   buildWorld (the customer export), clusterRows, rowsLink, ruleSolve
//   dates                 records/render.mjs  dayNum, fromDay, isoDate (+ the date styles below)
//   money / FX            records/world.mjs   toUsdCents, rateFor, mulRate, divRate; records/pools.mjs CURRENCIES
//   amount formats        records/render.mjs  fmtAmount
//   exclusions            stated in prose by each rung (status words with per-task polarity, close-date cut-offs);
//                         kinetics' exclusion machinery is not needed by R0/R1 and is not imported.
import { buildWorld, clusterRows, rowsLink, ruleSolve, toUsdCents, rateFor, mulRate, divRate } from '../../records/world.mjs';
import { dayNum, fromDay, isoDate, fmtAmount } from '../../records/render.mjs';
import { CURRENCIES, MONTHS, MONTHS_SHORT, ordinal } from '../../records/pools.mjs';

export { buildWorld as buildCustomerWorld, clusterRows, rowsLink, ruleSolve, toUsdCents, rateFor, mulRate, divRate };
export { dayNum, fromDay, isoDate, fmtAmount, CURRENCIES, MONTHS, MONTHS_SHORT };

// ---------------------------------------------------------------------------------------------------------------------
// Dates. A "day" is an integer day number (records/render.mjs). A date style is how one system prints a date.
const p2 = n => String(n).padStart(2, '0');
export const isoDay = day => isoDate(fromDay(day));
export const longDay = day => { const { y, m, d } = fromDay(day); return `${d} ${MONTHS[m - 1]} ${y}`; };
export const lastDayOfMonth = (y, m) => dayNum(y, m + 1, 1) - 1; // Date.UTC normalises month 13

export const DATE_STYLES = Object.freeze({
  MDY: 'MM/DD/YYYY', DMY: 'DD/MM/YYYY', DMY_DOT: 'DD.MM.YYYY', YMD_SLASH: 'YYYY/MM/DD', ISO: 'YYYY-MM-DD',
  DMY_DASH_YY: 'DD-MM-YY', WORDS_DMY: 'D Month YYYY', WORDS_MDY: 'Month D, YYYY',
});
export function fmtDate(day, style) {
  const { y, m, d } = fromDay(day);
  switch (style) {
    case 'MDY': return `${p2(m)}/${p2(d)}/${y}`;
    case 'DMY': return `${p2(d)}/${p2(m)}/${y}`;
    case 'DMY_DOT': return `${p2(d)}.${p2(m)}.${y}`;
    case 'YMD_SLASH': return `${y}/${p2(m)}/${p2(d)}`;
    case 'ISO': return `${y}-${p2(m)}-${p2(d)}`;
    case 'DMY_DASH_YY': return `${p2(d)}-${p2(m)}-${String(y).slice(2)}`;
    case 'WORDS_DMY': return `${d} ${MONTHS[m - 1]} ${y}`;
    case 'WORDS_MDY': return `${MONTHS[m - 1]} ${ordinal(d)}, ${y}`;
    default: throw new Error(`unknown date style ${style}`);
  }
}
/** Numeric styles whose day/month order matters (a date with day <= 12 reads two ways). */
export const AMBIGUOUS_STYLES = new Set(['MDY', 'DMY', 'DMY_DASH_YY']);
export const otherOrder = style => ({ MDY: 'DMY', DMY: 'MDY' })[style] ?? null;
/** The day a reader gets by reading `day` with day and month swapped, or null when the swap is not a different valid date. */
export function swappedDay(day) {
  const { y, m, d } = fromDay(day);
  if (d > 12 || d === m) return null;
  return dayNum(y, d, m);
}
/** Parse a date printed in `style` back to a day number (used by the reference parsers and tests). */
export function parseDate(text, style) {
  const t = String(text).trim();
  let y, m, d, g;
  switch (style) {
    case 'MDY': [m, d, y] = t.split('/').map(Number); break;
    case 'DMY': [d, m, y] = t.split('/').map(Number); break;
    case 'DMY_DOT': [d, m, y] = t.split('.').map(Number); break;
    case 'YMD_SLASH': [y, m, d] = t.split('/').map(Number); break;
    case 'ISO': [y, m, d] = t.split('-').map(Number); break;
    case 'DMY_DASH_YY': [d, m, y] = t.split('-').map(Number); y += 2000; break;
    case 'WORDS_DMY': g = t.match(/^(\d+) (\w+) (\d{4})$/); d = +g[1]; m = MONTHS.indexOf(g[2]) + 1; y = +g[3]; break;
    case 'WORDS_MDY': g = t.match(/^(\w+) (\d+)\w*, (\d{4})$/); m = MONTHS.indexOf(g[1]) + 1; d = +g[2]; y = +g[3]; break;
    default: throw new Error(`unknown date style ${style}`);
  }
  return dayNum(y, m, d);
}

// ---------------------------------------------------------------------------------------------------------------------
// Money. Amounts are integers in minor units; conversion to US cents is exact and rounded half away from zero
// (records' toUsdCents). A quote line renders one rate the way markets write it.
const q4Text = q4 => `${Math.floor(q4 / 1e4)}.${String(q4 % 1e4).padStart(4, '0')}`;
const microText = micro => {
  const units = Math.floor(micro / 1e6), frac = String(micro % 1e6).padStart(6, '0');
  return micro < 50000 ? `${units}.${frac}` : `${units}.${frac.slice(0, 4)}`;
};
export function quoteLine(currency, rate) {
  if (rate.perUsd) return `USD/${currency}  ${q4Text(rate.den)}`;
  if (rate.den !== 1000000) throw new Error(`unexpected rate shape for ${currency}`);
  return `${currency}/USD  ${microText(rate.num)}`;
}
export const minorDigits = currency => CURRENCIES[currency].minor;
/** "EUR 1,203.00", "JPY 22,682". */
export const moneyText = (currency, minor, opts) => `${currency} ${minor < 0 ? '-' : ''}${fmtAmount(Math.abs(minor), minorDigits(currency), opts)}`;
/** Round half away from zero of num/den for BigInt-safe integers (used for tax and discount lines). */
export function roundHalfAway(num, den) {
  const n = BigInt(num), dd = BigInt(den);
  const neg = (n < 0n) !== (dd < 0n), an = n < 0n ? -n : n, ad = dd < 0n ? -dd : dd;
  let q = an / ad;
  if ((an % ad) * 2n >= ad) q += 1n;
  return Number(neg ? -q : q);
}

// ---------------------------------------------------------------------------------------------------------------------
// Invoice references. Payment lines quote invoice numbers loosely; the stated matching rule ignores case, spaces,
// hyphens and slashes. The generator guarantees that keys are unique within a task.
export const refKey = s => String(s).toUpperCase().replace(/[\s\-/]/g, '');

// ---------------------------------------------------------------------------------------------------------------------
// The fictional group. Used in prompts only.
export const GROUP_NAME = 'Hollin Group';
