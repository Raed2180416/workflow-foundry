// Per-task FX quotes for W-bed rungs that do not take them from the records world (R3). Same rate shapes as records
// (mulRate: USD per unit, quoted XXX/USD; divRate: units per USD, quoted USD/XXX), the same exact conversion
// (records' toUsdCents, half away from zero to a whole cent), and the same market quote lines (lib/domain quoteLine).
import { mulRate, divRate, toUsdCents, quoteLine, CURRENCIES } from './domain.mjs';
import { USD_PER_UNIT_QUOTED } from '../../records/pools.mjs';

export const USD_RATE = mulRate(1000000);

/** Draw one quote per currency (USD is the identity) within +-3% of the records base rate. */
export function drawQuotes(r, currencies) {
  const cur = { USD: USD_RATE };
  for (const c of [...new Set(currencies)].sort()) {
    if (c === 'USD') continue;
    const rate = CURRENCIES[c].rate * (1 + r.float(-0.03, 0.03));
    cur[c] = USD_PER_UNIT_QUOTED.has(c) ? mulRate(Math.round(rate * 1e6)) : divRate(Math.round(1e4 / rate));
  }
  return cur;
}

export const usdCents = (quotes, currency, minor) => toUsdCents(minor, currency, quotes[currency]);

/** Quote lines for every non-USD currency, sorted. */
export const quoteLines = quotes => Object.keys(quotes).filter(c => c !== 'USD').sort().map(c => quoteLine(c, quotes[c]));
