// Bad controls and structure-necessity controls for W-bed R3. Each is a plausible mistake reproduced by the bed's own
// pipeline with one option set, so each has a full trace. The generator re-draws the audit until every applicable
// control fails the oracle (world.mjs setVerifier).
//
// kind 'stage':    visible to one stage oracle (the ledger split, a parsed statement, a reason code).
// kind 'relation': every stage oracle and the reduce stage's local checks pass on the control's own trace; only a
//                  cross-stage relation (Z1-Z4) and the end-to-end oracle catch it.
// NECESSITY_DEFS (W-BED §2.4 item 3): the best workflow WITHOUT fan-out/fan-in. A sequential single-context solve that
// runs out of attention past a token budget (size-gated: d >= 4), and reducer-less solves whose fan-in is done "in the
// head" rather than by a code reducer, which must fail the fan-in conservation relation Z3.
export const SEQUENTIAL_BUDGET_TOKENS = 32000;

export const CONTROL_DEFS = [
  { name: 'empty', kind: 'stage', make: () => ({ statements: [], by_reason: [], totals: { statements: 0, discrepancies: 0, difference_usd_cents: 0, adjustments_usd_cents: 0 } }) },
  { name: 'shuffled-or-corrupted', kind: 'stage', corrupt: true,
    why: 'right discrepancies and totals; adjusted balances rotated by one supplier: a mis-joined report whose totals still tie out' },
  // stage mistakes
  { name: 'split-exact-name-only', kind: 'stage', stage: 'split', minDifficulty: 3, opts: { exactNameOnly: true },
    why: 'ledger lines under a supplier\'s other name (abbreviation, former name) not attributed to it' },
  { name: 'duplicate-collapsed', kind: 'stage', stage: 'match', opts: { duplicateCollapsed: true },
    why: 'statement lines de-duplicated by reference while parsing, so a supplier\'s double billing disappears' },
  { name: 'cr-suffix-ignored', kind: 'stage', stage: 'match', minDifficulty: 4, opts: { crIgnored: true },
    why: 'credits and payments printed "1,234.50 CR" read as positive amounts' },
  { name: 'timing-window-ignored', kind: 'stage', stage: 'classify', opts: { timingIgnored: true },
    why: 'in-transit items near the statement date classified UNEXPLAINED (the cut-off rule skipped)' },
  { name: 'timing-all-one-sided', kind: 'stage', stage: 'classify', opts: { timingAll: true },
    why: 'every one-sided document called TIMING, including old ones dated just before the cut-off' },
  { name: 'memo-means-price', kind: 'stage', stage: 'classify', opts: { memoMeansPrice: true },
    why: 'any invoice difference at a supplier whose notes mention a price change called PRICE, though the note explains another invoice' },
  { name: 'credit-always-missing', kind: 'stage', stage: 'classify', opts: { creditAlwaysMissing: true },
    why: 'every statement-only credit note called MISSING_CREDIT, with or without a note that it was agreed' },
  { name: 'payment-diff-always-fx', kind: 'stage', stage: 'classify', minDifficulty: 3, opts: { paymentDiffFx: true },
    why: 'every payment difference called FX, with or without a note that the payment was converted' },
  // relation mistakes (pass every stage oracle and the reduce stage's local checks)
  { name: 'adjusted-accept-all', kind: 'relation', opts: { acceptAll: true },
    why: 'adjusted balance set to the supplier\'s statement balance (every discrepancy accepted); breaks Z2' },
  { name: 'adjusted-timing-accepted', kind: 'relation', opts: { timingAccepted: true },
    why: 'in-transit (TIMING) items posted as well; breaks Z2' },
  { name: 'reduce-rate-rounded', kind: 'relation', opts: { rateRounded: true },
    why: 'quotes rounded to two decimals before converting (EUR/USD 1.0874 -> 1.09); breaks Z3' },
  { name: 'exceptions-only', kind: 'relation', opts: { exceptionsOnly: true },
    why: 'clean suppliers left out of the report ("report exceptions"); counts still tie out; breaks Z4' },
  { name: 'sign-flipped', kind: 'relation', opts: { signFlipped: true },
    why: 'discrepancies reported as ledger minus statement (our perspective), totals recomputed from them; breaks Z1/Z3' },
];

export const NECESSITY_DEFS = [
  { name: 'sequential-single-context', kind: 'necessity', minDifficulty: 4, sequential: true,
    why: `one context reads the statements in order; past ${SEQUENTIAL_BUDGET_TOKENS} tokens it skims (takes each closing balance, assumes the ledger agrees). Stand-in for the size failure of a one-call solve; the measured sizes are in the notes` },
  { name: 'no-reducer-lost-middle', kind: 'necessity', opts: { lostMiddle: true },
    why: 'per-item results right, fan-in done without a code reducer: the middle third of the items drops out of the totals; breaks Z3' },
  { name: 'no-reducer-currency-mixed', kind: 'necessity', opts: { currencyMixed: true },
    why: 'per-item results right, fan-in done without a code reducer: amounts added across currencies as if they were US cents; breaks Z3' },
];

export const appliesAt = (def, difficulty) => difficulty >= (def.minDifficulty ?? 0);
