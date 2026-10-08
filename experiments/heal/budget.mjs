// Spend accounting for heal (DESIGN §11.4): every dollar goes through the model layer and its journal; this ledger adds the cap.
// `costUnknown` calls are charged at their bound (the P1 lesson): an unobservable spend is never recorded as a silent $0.
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export class Budget {
  constructor(capUsd = 0, { file = null } = {}) { this.capUsd = capUsd; this.file = file; this.spent = 0; this.lines = []; this.reserved = 0; }
  remaining() { return Math.max(0, this.capUsd - this.spent - this.reserved); }
  // Refuse before a live step that could not be paid for; returns a release function that settles the reservation.
  reserve(estimateUsd, label = 'step') {
    if (estimateUsd > this.remaining() + 1e-9) throw Object.assign(new Error(`HEAL_BUDGET_EXHAUSTED: ${label} needs about $${estimateUsd.toFixed(3)} and $${this.remaining().toFixed(3)} is left of $${this.capUsd}`), { code: 'HEAL_BUDGET_EXHAUSTED' });
    this.reserved += estimateUsd;
    let released = false;
    return () => { if (!released) { released = true; this.reserved = Math.max(0, this.reserved - estimateUsd); } };
  }
  charge(usd, label, detail = {}) {
    const amount = Number.isFinite(usd) && usd > 0 ? usd : 0;
    this.spent += amount;
    const line = { at: new Date().toISOString(), label, usd: +amount.toFixed(6), totalUsd: +this.spent.toFixed(6), ...detail };
    this.lines.push(line);
    if (this.file) { mkdirSync(path.dirname(this.file), { recursive: true }); appendFileSync(this.file, JSON.stringify(line) + '\n'); }
    return line;
  }
  // The live dollars of a replay result: known spend plus the bound of any call whose spend the provider could not observe.
  chargeRun(r, label) { return this.charge((r.liveUsd ?? 0) + (r.unknownUpperUsd ?? 0), label, { liveCalls: r.liveCalls ?? 0 }); }
  summary() { return { capUsd: this.capUsd, spentUsd: +this.spent.toFixed(6), remainingUsd: +this.remaining().toFixed(6), lines: this.lines.length }; }
}
