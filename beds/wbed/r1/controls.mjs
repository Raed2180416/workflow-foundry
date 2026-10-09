// Bad controls for W-bed R1. Each is a plausible mistake reproduced by the bed's own pipeline with one option set, so
// each has a full trace. The generator re-draws the ledger until every control fails the oracle on the task
// (world.mjs setVerifier), so each fails on every seed at every difficulty it applies to.
//
// kind 'stage':    the mistake is visible to one stage oracle (a parse, a per-document value, the customer partition).
// kind 'relation': every stage oracle passes on the control's own trace, and so do the report's local checks
//                  (open = invoiced - paid, totals = sums, one entry per customer). Only a cross-stage relation
//                  (X1-X3 in stages.mjs) and the end-to-end oracle catch it. FRONTIER-GAPS §1 item 2: the errors
//                  live in relations between inputs.
export const CONTROL_DEFS = [
  // CONTRACT minimums
  { name: 'empty', kind: 'stage', make: () => ({ customers: [], totals: { customers: 0, invoiced_usd_cents: 0, paid_usd_cents: 0, open_usd_cents: 0 } }) },
  { name: 'shuffled-or-corrupted', kind: 'stage', corrupt: true,
    why: 'right customers and right totals, but every invoiced amount rotated to the next customer (open recomputed): a mis-joined report whose sums still tie out' },
  // stage mistakes
  { name: 'ignore-close-date', kind: 'stage', stage: 'normalise', opts: { ignoreClose: true },
    why: 'the most common close error: everything in the lists and the feed is taken, including next period\'s invoices and receipts' },
  { name: 'atlas-invoice-dates-flipped', kind: 'stage', stage: 'normalise', opts: { atlasFlip: true },
    why: 'ATLAS numeric invoice dates read in the other order (e.g. the customer export\'s ATLAS birth-date rule carried over, or the UK default assumed); planted invoices just inside / outside the close flip' },
  { name: 'unconverted-amounts', kind: 'stage', stage: 'normalise', opts: { unconverted: true },
    why: 'amounts summed in their own currencies as if they were dollars' },
  { name: 'void-status-counted', kind: 'stage', stage: 'normalise', opts: { voidStatusCounted: true },
    why: 'status words ignored: storniert / CANCELLED / voided invoices kept' },
  { name: 'no-dedup-customers', kind: 'stage', stage: 'reconcile', opts: { noDedup: true },
    why: 'every customer row treated as its own customer (no identity resolution)' },
  { name: 'flag-meaning-flipped', kind: 'stage', stage: 'normalise', minDifficulty: 4, opts: { flagFlipped: true },
    why: 'the per-task status word read with the opposite meaning (its name suggests one, the notes say the other)' },
  { name: 'atlas-switch-ignored', kind: 'stage', stage: 'normalise', minDifficulty: 4, opts: { atlasOldOrder: true },
    why: 'the ATLAS print-server switch missed: every ATLAS date read with the order that held before it' },
  { name: 'tally-dates-month-first', kind: 'stage', stage: 'normalise', minDifficulty: 4, opts: { tallyMonthFirst: true },
    why: 'the new TALLY system\'s DD-MM-YY dates read month first' },
  // relation mistakes: pass every stage oracle and the report's local checks
  { name: 'canonical-row-only', kind: 'relation', opts: { canonicalOnly: true },
    why: 'invoices joined to customers on customer_id only, so invoices booked to a customer\'s other rows (and their payments) are dropped; breaks X1/X3' },
  { name: 'payer-credited', kind: 'relation', opts: { payerCredited: true },
    why: 'payments credited to the payer named in the bank feed instead of the customer whose invoice they settle; sums still tie out, breaks X3' },
  { name: 'remittance-double-count', kind: 'relation', opts: { remitDouble: true },
    why: 'REMIT advices counted as money next to the PAY line with the same bank reference; every line parses correctly, breaks X2' },
  { name: 'void-row-invoices-kept', kind: 'relation', opts: { voidRowKept: true },
    why: 'invoices booked to a void customer row attached to the real customer that row resembles (its twin); breaks X1' },
  { name: 'round-at-end', kind: 'relation', opts: { roundAtEnd: true },
    why: 'each customer\'s amounts summed per currency and converted once instead of per document; off by cents, breaks X1/X3' },
  { name: 'status-paid-trusted', kind: 'relation', opts: { statusPaidTrusted: true },
    why: 'an invoice whose billing status says paid is taken as paid in full; the bank feed shows a part payment; breaks X2/X3' },
];

export const appliesAt = (def, difficulty) => difficulty >= (def.minDifficulty ?? 0);
