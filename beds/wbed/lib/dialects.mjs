// The billing-system dialects of the W-bed back office, shared across rungs. R1 introduced them for invoice lists
// (beds/wbed/r1/vocab.mjs BASE_STYLE, r1/render.mjs amount formats); R3 prints vendor statements in the same dialects,
// so an R1 parser/normaliser module is a correct per-item module of an R3 solution (W-BED §5 curriculum). R1's files are
// unchanged; the amount rule below reproduces r1/render.mjs `amountText` and the tests pin the two agree.
import { fmtAmount, minorDigits } from './domain.mjs';
export { BASE_STYLE } from '../r1/vocab.mjs';

/** Currencies a vendor printing from each system bills in. */
export const DIALECT_CURRENCIES = {
  BRIGHTDESK: ['USD'], LEDGR: ['EUR', 'CHF'], ATLAS: ['GBP'], VENDEX: ['USD', 'EUR'], KOBO: ['JPY'], VERITAS: ['USD', 'EUR'],
  TALLY: ['EUR', 'USD', 'GBP'],
};

/** An amount (absolute value, minor units) the way `system` prints it (R1 invoice-list convention). */
export function amountIn(system, currency, absMinor, rr) {
  const md = minorDigits(currency);
  switch (system) {
    case 'BRIGHTDESK': return `"${fmtAmount(absMinor, md)}"`;
    case 'LEDGR': return `${fmtAmount(absMinor, md, { thou: '.', dec: ',' })} ${currency}`;
    case 'KOBO': return rr.chance(0.5) ? `¥${fmtAmount(absMinor, md)}` : `${fmtAmount(absMinor, md)}円`;
    case 'VERITAS': return fmtAmount(absMinor, md, { group: false });
    default: return `${currency} ${fmtAmount(absMinor, md)}`;
  }
}

/** A plain number in a system's number format, without currency (balances columns). */
export function numberIn(system, currency, minor) {
  const md = minorDigits(currency), abs = Math.abs(minor), sign = minor < 0 ? '-' : '';
  if (system === 'LEDGR') return `${sign}${fmtAmount(abs, md, { thou: '.', dec: ',' })}`;
  if (system === 'VERITAS') return `${sign}${fmtAmount(abs, md, { group: false })}`;
  return `${sign}${fmtAmount(abs, md)}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Date dialects outside R1's profile (added for R4, W-BED §3.4 composition test). R1 invoice lists print dates in
// BASE_STYLE (MDY, DMY_DOT, WORDS, YMD_SLASH, ISO, DMY_DASH_YY) plus ATLAS's per-task DMY/MDY; R3 statements use the same
// set. No R1 or R3 draw uses the dialect below, so a solver whose input profile was learned on R1 streams has never seen
// it. R4 re-renders one billing system of a planted subsidiary pack in it (the truth is unchanged: same days). Nothing
// above this line changed, so every R1/R2/R3 draw is byte-identical.
import { dayNum as _dayNum, fromDay as _fromDay } from './domain.mjs';

/** Mainframe-style Julian date CYYDDD: century digit (0 = 19YY, 1 = 20YY), two-digit year, day of the year (001-366). */
export const OUTSIDE_R1_DATE_STYLES = Object.freeze({ JULIAN_CYYDDD: 'CYYDDD' });
export function fmtJulian(day) {
  const { y } = _fromDay(day);
  const doy = day - _dayNum(y, 1, 1) + 1;
  return `${Math.floor((y - 1900) / 100)}${String(y % 100).padStart(2, '0')}${String(doy).padStart(3, '0')}`;
}
export function parseJulian(text) {
  const m = /^(\d)(\d{2})(\d{3})$/.exec(String(text).trim());
  if (!m) throw new Error(`not a CYYDDD date: ${text}`);
  const y = 1900 + 100 * Number(m[1]) + Number(m[2]);
  return _dayNum(y, 1, 1) + Number(m[3]) - 1;
}
/** How the notes of a planted pack state the dialect (the convention is always stated; the solver must read it). */
export const JULIAN_TEXT = 'CYYDDD Julian dates (C is the century digit, 1 for the years 2000-2099; YY is the year; DDD is the day of the year, 001-366; for example 125032 is 1 February 2025)';
