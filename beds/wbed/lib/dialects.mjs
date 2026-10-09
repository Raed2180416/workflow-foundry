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
