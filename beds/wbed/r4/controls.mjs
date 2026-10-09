// Bad controls for W-bed R4. Each is a plausible mistake reproduced by the bed's own pipeline with one option set, so
// each has a full trace (children, translate, pair, eliminate, report). The generator re-draws the group layer until
// every applicable control fails the oracle (world.mjs setVerifier), so each fails on every seed at every difficulty it
// applies to. The child layer is never re-drawn: a child control fails because its rung's own control does.
//
// kind 'stage':    visible to a stage oracle (a child's composed oracle, translate, pair, eliminate or report-local).
// kind 'relation': every child and parent stage oracle passes on the control's own trace, and so do the report's local
//                  checks; only a cross-stage relation (W1-W4, stages.mjs) and the end-to-end oracle catch it.
export const CONTROL_DEFS = [
  // CONTRACT minimums
  { name: 'empty', kind: 'stage', make: world => ({ group_currency: world.groupCurrency, subsidiaries: [], eliminations: [],
    consolidated: { subsidiaries: 0, receivables_minor: 0, payables_minor: 0, eliminated_minor: 0, eliminations: 0 } }) },
  { name: 'shuffled-or-corrupted', kind: 'relation', opts: { shuffled: true },
    why: 'every balance, elimination and total right, but the receivables-close reports rotated by one subsidiary: each pack carries another pack\'s result; breaks W1' },
  // child mistakes (the nested sub-workflow is wrong; the parent carries it)
  { name: 'child-error-propagated', kind: 'stage', stage: 'children', opts: { childError: true },
    why: 'one receivables pack solved by an R1 workflow that counts remittance advices next to their PAY line (R1 control remittance-double-count); the parent translates and consolidates it faithfully' },
  { name: 'outside-profile-reused', kind: 'stage', stage: 'children', minDifficulty: 3, opts: { outsideReused: true },
    why: 'the planted pack (a billing system printing CYYDDD dates, a dialect no R1 stream saw) run through the R1 solver anyway: its dates do not parse and the close-date filter lets every invoice of that system through (wrong reuse)' },
  // translation mistakes
  { name: 'fx-direction-inverted', kind: 'stage', stage: 'translate', opts: { fxInverted: true },
    why: '"1 G = x C" read as "1 C = x G": amounts multiplied by the rate instead of divided' },
  { name: 'translate-per-item', kind: 'stage', stage: 'translate', opts: { perItem: true },
    why: 'each intercompany item translated and rounded on its own, then added (the spec says: per currency sum, translated once); off by minor units' },
  { name: 'jpy-minor-digits', kind: 'stage', stage: 'translate', minDifficulty: 5, opts: { jpyCents: true },
    why: 'yen amounts read with two decimals like every other currency (the yen has none): JPY balances shrink a hundredfold' },
  // pairing mistakes (the judged step)
  { name: 'amount-only-pairing', kind: 'stage', stage: 'pair', opts: { amountOnly: true },
    why: 'pairs matched on counterparties, currency and amount only, memos unread: a flat fee booked for two periods pairs with the wrong one, and equal-amount items of different charges are eliminated' },
  { name: 'memo-only-pairing', kind: 'stage', stage: 'pair', opts: { memoOnly: true },
    why: 'pairs matched on memo meaning only: a charge the buyer booked at a disputed (different) amount is eliminated' },
  // elimination and conservation mistakes
  { name: 'elimination-not-applied', kind: 'stage', stage: 'report', opts: { elimNotApplied: true },
    why: 'pairs found and listed, but the consolidated balances are the gross sums (missed elimination)' },
  { name: 'double-elimination', kind: 'stage', stage: 'eliminate', opts: { doubleElim: true },
    why: 'one elimination per item instead of per pair: every pair removed twice from both sides' },
  { name: 'elimination-untranslated', kind: 'stage', stage: 'eliminate', opts: { elimUntranslated: true },
    why: 'eliminations at the transaction-currency amount, not translated to the group currency' },
  { name: 'all-ic-removed', kind: 'stage', stage: 'report', opts: { allIcRemoved: true },
    why: 'every intercompany balance dropped from the consolidated figures, paired or not (unmatched items in transit vanish): gross != consolidated + eliminated' },
  // relation mistakes: pass every stage oracle and the report's local checks
  { name: 'receivables-at-invoiced', kind: 'relation', opts: { recAtInvoiced: true },
    why: 'a receivables pack consolidated at its invoiced total instead of its open balance; every stage output and the report arithmetic still tie out; breaks W2' },
  { name: 'external-per-line-rounding', kind: 'relation', opts: { extPerLine: true },
    why: 'each customer\'s open balance (and each supplier\'s adjusted balance) translated and rounded on its own instead of the pack total per currency; off by minor units; breaks W2' },
  { name: 'payables-at-statement-balance', kind: 'relation', minDifficulty: 3, opts: { payAtStatement: true },
    why: 'an audited pack consolidated at the suppliers\' statement balances instead of the adjusted (audited) balances; breaks W2' },
  { name: 'rate-date-group-close', kind: 'relation', minDifficulty: 4, opts: { rateDateGroup: true },
    why: 'every pack translated at the consolidation-date rate instead of the rate of its own reporting date; breaks W2' },
  { name: 'report-uses-candidate-pairs', kind: 'relation', opts: { reportCandidatePairs: true },
    why: 'the judge\'s pairs are computed but the report is built from the amount-matched candidate list (the verdict is lost on the way to the report); breaks W3 and W4' },
  { name: 'child-report-trimmed', kind: 'relation', opts: { childTrimmed: true },
    why: 'pack reports trimmed before they are carried (customers with nothing invoiced, suppliers with no discrepancy dropped); balances were computed from the full reports; breaks W1' },
];

export const appliesAt = (def, difficulty) => difficulty >= (def.minDifficulty ?? 0);
