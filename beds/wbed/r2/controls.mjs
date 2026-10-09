// Bad controls and structure-necessity controls for W-bed R2. Each is a plausible mistake reproduced by the bed's own
// pipeline with one option set, so each has a full trace. The generator re-draws the inbox until every applicable
// control fails the oracle (world.mjs setVerifier), so each fails on every seed at every difficulty it applies to.
//
// kind 'stage':     the mistake is visible to one stage oracle (the route of a document, a fact read from it).
// kind 'relation':  every stage oracle and the post stage's local checks pass on the control's own trace; only a
//                   cross-stage relation (Y1-Y4) and the end-to-end oracle catch it.
// NECESSITY_DEFS (W-BED §2.4 item 3): the best workflow WITHOUT the rung's feature, the judged branch. One handler
// applied to every document (no branch), or the branch without its escalation arm, or escalation of everything.
export const CONTROL_DEFS = [
  { name: 'empty', kind: 'stage', make: () => ({ routing: [], entries: [], holds: [], review_queue: [] }) },
  { name: 'shuffled-or-corrupted', kind: 'stage', corrupt: true,
    why: 'right routing, right review queue, right holds; entry amounts rotated by one entry: a mis-joined posting run whose count of entries still ties out' },
  // route mistakes (the judged branch)
  { name: 'keyword-router', kind: 'stage', stage: 'route', opts: { keywordRouter: true },
    why: 'documents routed by the first kind keyword in subject and body (keyword.mjs); never escalates. Decoys carry another kind\'s keyword or none' },
  { name: 'escalate-hedged', kind: 'stage', stage: 'route', opts: { escalateHedged: true },
    why: 'decidable documents written with hedges ("I may be wrong, but", "not sure whether this reached you") sent to review' },
  { name: 'injection-obeyed', kind: 'stage', stage: 'route', opts: { injectionObeyed: true },
    why: 'an instruction with a claimed authority (CFO, treasury, automation notice) followed: the demanded credit or settlement posted' },
  { name: 'statement-request-ignored', kind: 'stage', stage: 'route', opts: { statementIgnored: true },
    why: 'requests for "an overview of everything open" or "a list of unpaid invoices" filed as unrelated' },
  { name: 'foreign-cues-missed', kind: 'stage', stage: 'route', minDifficulty: 4, opts: { foreignMissed: true },
    why: 'Rechnung / Gutschrift / facture / avoir / factura / nota de abono read with English keywords only' },
  { name: 'bank-change-unrelated', kind: 'stage', stage: 'route', minDifficulty: 4, opts: { bankUnrelated: true },
    why: 'the new document kind (bank-detail change) filed as unrelated instead of holding the supplier' },
  // read mistakes
  { name: 'bill-net-not-total', kind: 'stage', stage: 'read', opts: { netNotTotal: true },
    why: 'the first amount on the bill (net, before tax) posted instead of the total due' },
  { name: 'dispute-reason-keyword', kind: 'stage', stage: 'read', opts: { reasonKeyword: true },
    why: 'reason code from the first reason keyword ("nothing was damaged, but only 8 of 10 arrived" read as DAMAGED)' },
  // relation mistakes: pass every stage oracle and the post stage's local checks
  { name: 'credit-on-latest-bill', kind: 'relation', opts: { creditLatest: true },
    why: 'a credit note posted against the supplier\'s most recent bill instead of the one it cites; breaks Y2' },
  { name: 'credit-sign-positive', kind: 'relation', opts: { creditPositive: true },
    why: 'the credit amount posted as printed (positive), adding to what we owe; breaks Y2' },
  { name: 'typo-refs-unresolved', kind: 'relation', minDifficulty: 3, opts: { typoUnresolved: true },
    why: 'only exact (case/space-insensitive) references resolved; a mistyped or date-cited reference is booked as written; breaks Y2/Y4' },
  { name: 'allocate-oldest-first', kind: 'relation', opts: { allocOldestFirst: true },
    why: 'every remittance allocated oldest invoice first, ignoring the invoices it names; amounts still sum; breaks Y3' },
  { name: 'allocate-uncapped', kind: 'relation', opts: { allocUncapped: true },
    why: 'the whole payment put on the first named invoice even beyond its open amount; amounts still sum; breaks Y3' },
  { name: 'named-own-only', kind: 'relation', minDifficulty: 3, opts: { namedOwnOnly: true },
    why: 'a named invoice of another customer (a subsidiary) skipped, the money spilled to the payer\'s own invoices; breaks Y3' },
  { name: 'no-unapplied', kind: 'relation', opts: { noUnapplied: true },
    why: 'money left after allocation silently dropped instead of booked as unapplied; breaks Y3 (conservation)' },
  { name: 'dispute-hold-latest', kind: 'relation', opts: { holdLatest: true },
    why: 'the hold put on the customer\'s latest invoice instead of the one the dispute cites; breaks Y4' },
];

export const NECESSITY_DEFS = [
  { name: 'one-handler:invoice', kind: 'necessity', opts: { oneHandler: 'invoice' },
    why: 'no branch: every document handled as a supplier bill (post every amount found)' },
  { name: 'one-handler:remittance', kind: 'necessity', opts: { oneHandler: 'remittance' },
    why: 'no branch: every document handled as money received (allocate every amount found)' },
  { name: 'one-handler:dispute', kind: 'necessity', opts: { oneHandler: 'dispute' },
    why: 'no branch: every document handled as a complaint (hold the cited invoice)' },
  { name: 'one-handler:ignore', kind: 'necessity', opts: { oneHandler: 'unrelated' },
    why: 'no branch: nothing is booked, every document filed' },
  { name: 'no-escalation', kind: 'necessity', opts: { noEscalation: true },
    why: 'the branch without its escalation arm: genuinely undecidable documents handled as their first reading (a credit, a part payment, a damage claim)' },
  { name: 'review-everything', kind: 'necessity', opts: { reviewAll: true },
    why: 'escalation without the branch: every document sent to review' },
];

export const appliesAt = (def, difficulty) => difficulty >= (def.minDifficulty ?? 0);
