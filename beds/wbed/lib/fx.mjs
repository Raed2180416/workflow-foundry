// Per-task FX quotes for W-bed rungs that do not take them from the records world (R3). Same rate shapes as records
// (mulRate: USD per unit, quoted XXX/USD; divRate: units per USD, quoted USD/XXX), the same exact conversion
// (records' toUsdCents, half away from zero to a whole cent), and the same market quote lines (lib/domain quoteLine).
import { mulRate, divRate, toUsdCents, quoteLine, CURRENCIES } from './domain.mjs';
import { USD_PER_UNIT_QUOTED } from '../../records/pools.mjs';

export const USD_RATE = mulRate(1000000);

/**
 * Draw one quote per currency (USD is the identity) within +-3% of the records base rate. Every rate is exactly the
 * rate its quote line prints (quoteLine): USD per unit is quantized as records quantizes it (records/world.mjs `quant`:
 * six decimals below 0.05, four above), units per USD are four decimals. wbed-r3 1.0.0 stored six decimals and printed
 * four, so its totals were not derivable from the task (references/README.md "R3 bed finding"; fixed in wbed-r3 1.1.0).
 */
export const quantUsdPerUnit = x => (x < 0.05 ? Math.round(x * 1e6) : Math.round(x * 1e4) * 100);
export function drawQuotes(r, currencies) {
  const cur = { USD: USD_RATE };
  for (const c of [...new Set(currencies)].sort()) {
    if (c === 'USD') continue;
    const rate = CURRENCIES[c].rate * (1 + r.float(-0.03, 0.03));
    cur[c] = USD_PER_UNIT_QUOTED.has(c) ? mulRate(quantUsdPerUnit(rate)) : divRate(Math.round(1e4 / rate));
  }
  return cur;
}

export const usdCents = (quotes, currency, minor) => toUsdCents(minor, currency, quotes[currency]);

/** Quote lines for every non-USD currency, sorted. */
export const quoteLines = quotes => Object.keys(quotes).filter(c => c !== 'USD').sort().map(c => quoteLine(c, quotes[c]));

// ---------------------------------------------------------------------------------------------------------------------
// Group translation (added for R4 consolidation). A group rate is quoted against the group currency G the way group
// treasury tables print it: "1 G = x C" with four decimals, stored as q4 = x * 1e4. Translating an amount of C into G
// divides by x; the result is rounded once, half away from zero, to G's minor unit, with exact integer arithmetic.
import { minorDigits as _md } from './domain.mjs';

const _q4Text = q4 => `${Math.floor(q4 / 1e4)}.${String(q4 % 1e4).padStart(4, '0')}`;
export const groupQuoteText = q4 => _q4Text(q4);
/** Base cross rate (units of C per 1 G) from the records rate pool. */
export const baseCross = (group, currency) => CURRENCIES[group].rate / CURRENCIES[currency].rate;

/**
 * Draw a group rate table: for each date key (ascending), for each currency C != group, q4 = round(1e4 * C per G). The
 * rate walks from a base within +-3% of the records cross rate by up to +-`drift` per step.
 */
export function drawGroupRates(r, group, currencies, dateKeys, { drift = 0.015 } = {}) {
  const cs = [...new Set(currencies)].filter(c => c !== group).sort();
  const level = Object.fromEntries(cs.map(c => [c, baseCross(group, c) * (1 + r.float(-0.03, 0.03))]));
  const table = {};
  for (const k of dateKeys) {
    table[k] = {};
    for (const c of cs) {
      level[c] *= 1 + r.float(-drift, drift);
      let q4 = Math.round(level[c] * 1e4);
      if (q4 === 1e4) q4 += 1; // never exactly 1: a direction error must show
      table[k][c] = q4;
    }
  }
  return table;
}

function _roundDiv(num, den) {
  const neg = (num < 0n) !== (den < 0n), an = num < 0n ? -num : num, ad = den < 0n ? -den : den;
  let q = an / ad;
  if ((an % ad) * 2n >= ad) q += 1n;
  return Number(neg ? -q : q);
}
/**
 * Translate `minor` units of `currency` into minor units of `group` at q4 (units of currency per 1 group, x 1e4).
 * opts.inverted multiplies instead of dividing (the direction error); opts.mdOf overrides minor digits (the
 * minor-unit error). Identity when currency === group.
 */
export function translateMinor(minor, currency, group, q4, { inverted = false, mdOf = _md } = {}) {
  if (currency === group) return minor;
  if (!Number.isInteger(q4) || q4 <= 0) throw new Error(`translateMinor: no rate for ${currency} -> ${group}`);
  const mdC = BigInt(mdOf(currency)), mdG = BigInt(mdOf(group)), m = BigInt(minor), q = BigInt(q4);
  return inverted
    ? _roundDiv(m * q * 10n ** mdG, 10000n * 10n ** mdC)
    : _roundDiv(m * 10n ** mdG * 10000n, q * 10n ** mdC);
}
