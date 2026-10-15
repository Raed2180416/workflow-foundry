// The one cap meter for F-program runners and for back-filled claim rows (FIRST-CLASS-PROGRAMS §0.3 "Metering";
// PREREG-NEED-V1 §12 K5 "The one cap meter"). It reuses the need router's rule as code, imported read-only from the stamped
// file experiments/need-router/prereg-rules.mjs (rowCharge, hasObservedCost, mayStart), so the convention cannot drift:
//   - a row with an observed cost is charged max(reported, re-priced);
//   - a row with no observed cost (a timeout or killed session, costUnknown, or no dollars and no tokens) is charged its bound;
//   - every start in flight is reserved at its bound before launch; a start is refused when meter + bound > cap;
//   - a set-aside attempt (an environment-fault or invalid attempt kept out of the results) is charged like a row.
// $0: no model, no network. The Meter keeps an in-memory ledger; a runner persists it (spend.jsonl) itself.
import { rowCharge, hasObservedCost, mayStart } from '../need-router/prereg-rules.mjs';

const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

/**
 * Charge one start on the meter. cost: {reportedUsd, repricedUsd, imputedUsd, costUnknown, errorCode, tokens: {input, output}}.
 * Returns {charged, observed, reported, repriced, imputed} where imputed = the bound's excess over what was observed.
 */
export function chargeOf(cost, bound) {
  const row = {
    usdReported: num(cost?.reportedUsd), usdImputed: num(cost?.imputedUsd), usdRepriced: num(cost?.repricedUsd),
    costUnknown: !!cost?.costUnknown, error: cost?.errorCode ? { code: cost.errorCode } : null,
    tokens: { input: num(cost?.tokens?.input), output: num(cost?.tokens?.output) },
  };
  const charged = rowCharge(row, num(bound));
  const observed = hasObservedCost(row);
  const reported = row.usdReported + row.usdImputed;
  return { charged, observed, reported, repriced: row.usdRepriced, imputed: Math.max(0, charged - Math.max(reported, row.usdRepriced)) };
}

/** Sum chargeOf over several starts that form one claim row (e.g. the ticks of one agent world). */
export function chargeMany(costs, boundOf) {
  let charged = 0, reported = 0, repriced = 0, imputed = 0, unobserved = 0;
  costs.forEach((c, i) => {
    const b = typeof boundOf === 'function' ? boundOf(c, i) : boundOf;
    const x = chargeOf(c, b);
    charged += x.charged; reported += x.reported; repriced += x.repriced; imputed += x.imputed; if (!x.observed) unobserved += 1;
  });
  return { charged, reported, repriced, imputed, starts: costs.length, unobserved, observed: unobserved === 0 };
}

/**
 * A live meter with reservation (for new runners). reserve() before launch; settle() after; setAside() for an attempt kept
 * out of the results. snapshot().meterUsd = settled charges + every in-flight reservation.
 */
export class Meter {
  constructor({ capUsd, maxInFlight = 4 } = {}) {
    if (!(capUsd >= 0)) throw new Error('Meter needs capUsd >= 0');
    this.capUsd = capUsd; this.maxInFlight = maxInFlight;
    this.entries = []; this.inFlight = new Map(); this.seq = 0;
  }
  get settledUsd() { return this.entries.reduce((s, x) => s + x.charged, 0); }
  get inFlightUsd() { let s = 0; for (const x of this.inFlight.values()) s += x.bound; return s; }
  get meterUsd() { return this.settledUsd + this.inFlightUsd; }
  /** Reserve a start's bound. Returns a token, or null when the start would exceed the cap or the in-flight limit. */
  reserve(boundUsd, meta = {}) {
    if (!(boundUsd >= 0)) throw new Error('reserve needs a bound >= 0');
    if (this.inFlight.size >= this.maxInFlight) return null;
    if (!mayStart({ meterUsd: this.meterUsd, boundUsd, capUsd: this.capUsd })) return null;
    const token = ++this.seq;
    this.inFlight.set(token, { bound: boundUsd, meta, at: Date.now() });
    return token;
  }
  #close(token, cost, setAside) {
    const r = this.inFlight.get(token);
    if (!r) throw new Error(`unknown or settled token ${token}`);
    this.inFlight.delete(token);
    const c = chargeOf(cost, r.bound);
    const entry = { token, bound: r.bound, ...c, setAside, meta: r.meta, wallMs: Date.now() - r.at };
    this.entries.push(entry);
    return entry;
  }
  settle(token, cost) { return this.#close(token, cost, false); }
  setAside(token, cost) { return this.#close(token, cost, true); }
  snapshot() {
    const settled = this.entries;
    return {
      capUsd: this.capUsd, starts: settled.length + this.inFlight.size, settled: settled.length, inFlight: this.inFlight.size,
      observedUsd: settled.filter(x => x.observed).reduce((s, x) => s + x.charged, 0),
      boundUsd: settled.filter(x => !x.observed).reduce((s, x) => s + x.charged, 0),
      setAsideUsd: settled.filter(x => x.setAside).reduce((s, x) => s + x.charged, 0),
      reportedUsd: settled.reduce((s, x) => s + x.reported, 0),
      inFlightUsd: this.inFlightUsd, meterUsd: this.meterUsd,
    };
  }
}
