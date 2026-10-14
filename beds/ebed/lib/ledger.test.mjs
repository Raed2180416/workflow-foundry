// Unit tests for ledger.mjs: allowed-window effect matching with every divergence code, multiplicity and key checks,
// conservation identities and the X12 835 balancing identities on a hand-built remittance. No model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchEffects, allowedWindow, keyViolations, atMostOnce, exactlyOnce, sumMinor, identity, identityByGroup, netsToZero, doubleEntry, balance835,
} from './ledger.mjs';
import { parseInstant } from './time.mjs';
import { codeOf } from './errors.mjs';
import { REMIT_835 } from './fixtures.mjs';

const Z = s => `2026-12-${s}Z`;
const PAY = { lid: 'pay:INV-1', rule: 'spec §4.2', system: 'bank', op: 'pay', match: { invoice: 'INV-1' }, window: { earliest: Z('01T00:00:00'), latest: Z('10T23:59:59') }, money: true };
const NOTICE = { lid: 'notice:INV-1', rule: 'spec §4.3', system: 'mail', op: 'send', match: { invoice: 'INV-1', kind: 'remittance' }, window: { earliest: Z('01T00:00:00'), latest: Z('11T23:59:59') }, after: ['pay:INV-1'] };
const pay = (at, key = 'k1', committed = true, invoice = 'INV-1') => ({ at: Z(at), system: 'bank', op: 'pay', key, args: { invoice, amountMinor: 864000 }, committed });
const mail = (at, kind = 'remittance', key = 'm1') => ({ at: Z(at), system: 'mail', op: 'send', key, args: { invoice: 'INV-1', kind }, committed: true });
const grade = (rows, extra = {}) => matchEffects({ expected: [PAY, NOTICE], rows, end: Z('31T00:00:00'), ...extra });
const codes = r => r.divergences.map(d => d.code);

test('a correct trajectory passes; F3 retry with the same key is one logical effect', () => {
  const r = grade([pay('05T10:00:00'), mail('06T09:00:00')]);
  assert.deepEqual([r.ok, r.first, r.critical], [true, null, []]);
  assert.deepEqual(r.lids['pay:INV-1'], { status: 'satisfied', commitAt: parseInstant(Z('05T10:00:00')), key: 'k1', attempts: 1, lateCommitAt: null });
  const retry = grade([pay('05T10:00:00'), pay('05T10:01:00', 'k1', false), mail('06T09:00:00')]);
  assert.equal(retry.ok, true);
  assert.equal(retry.lids['pay:INV-1'].attempts, 2);
  // Window ends are inclusive.
  assert.equal(grade([pay('01T00:00:00'), mail('11T23:59:59')]).ok, true);
  assert.equal(grade([pay('10T23:59:59'), mail('11T00:00:00')]).ok, true);
});

test('each divergence code on its own hand-built trajectory', () => {
  // Retry under a new key after F3: applied twice. key-split, then duplicate, which is a critical money violation.
  const twice = grade([pay('05T10:00:00'), pay('05T10:01:00', 'k2'), mail('06T09:00:00')]);
  assert.deepEqual(codes(twice), ['key-split', 'duplicate']);
  assert.deepEqual(twice.critical, [{ code: 'duplicate-money', lid: 'pay:INV-1', at: parseInstant(Z('05T10:01:00')), row: 1 }]);
  assert.deepEqual(codes(grade([pay('05T10:00:00'), pay('05T10:01:00', 'k1'), mail('06T09:00:00')])), ['duplicate']); // same key, applied again
  assert.deepEqual(codes(grade([{ ...pay('01T00:00:00'), at: '2026-11-30T23:59:59Z' }, mail('06T09:00:00')])), ['early']);
  // Notice sent on Dec 6 before any payment (order), payment on Dec 12 after its latest of Dec 10 (missed at Dec 10).
  const late = grade([mail('06T09:00:00'), pay('12T09:00:00')]);
  assert.deepEqual(late.divergences.map(d => [d.code, d.at]), [['order', parseInstant(Z('06T09:00:00'))], ['missed', parseInstant(Z('10T23:59:59'))]]);
  assert.deepEqual([late.lids['pay:INV-1'].status, late.lids['pay:INV-1'].lateCommitAt], ['late', parseInstant(Z('12T09:00:00'))]);
  assert.equal(late.first.code, 'order');
  assert.deepEqual(codes(grade([])), ['missed', 'missed']);
  assert.deepEqual(codes(grade([pay('05T10:00:00'), mail('06T09:00:00'), pay('07T10:00:00', 'k9', true, 'INV-2')])), ['outside-allowed']);
  assert.deepEqual(codes(grade([pay('05T10:00:00'), mail('06T09:00:00'), mail('06T09:30:00', 'reminder', 'm2')])), ['outside-allowed']);
  // Two logical effects under one key on one system.
  const PAY2 = { ...PAY, lid: 'pay:INV-2', match: { invoice: 'INV-2' } };
  const reuse = matchEffects({ expected: [PAY, PAY2], rows: [pay('05T10:00:00', 'k1'), pay('05T11:00:00', 'k1', true, 'INV-2')], end: Z('31T00:00:00') });
  assert.deepEqual(codes(reuse), ['key-reuse']);
  // Keys are per system: the same string on two systems is not reuse.
  assert.equal(grade([pay('05T10:00:00', 'x'), mail('06T09:00:00', 'remittance', 'x')]).ok, true);
});

test('permitted patterns, opening, withdrawal and censoring', () => {
  const permitted = [{ rule: 'spec §4.4', system: 'mail', op: 'send', match: { kind: 'reminder' }, window: { earliest: Z('01T00:00:00'), latest: Z('31T00:00:00') } }];
  assert.equal(grade([pay('05T10:00:00'), mail('06T09:00:00'), mail('06T09:30:00', 'reminder', 'm2')], { permitted }).ok, true);
  assert.deepEqual(codes(grade([mail('06T09:30:00', 'reminder', 'm2')], { permitted, end: Z('07T00:00:00') })), []); // windows still open
  // Opened on Dec 2: a payment on Dec 1 acts before the rule requires it.
  const opened = matchEffects({ expected: [{ ...PAY, openedAt: Z('02T00:00:00') }], rows: [pay('01T12:00:00')], end: Z('31T00:00:00') });
  assert.deepEqual(codes(opened), ['outside-allowed', 'missed']);
  // Withdrawn on Dec 3 (the invoice was cancelled): no failure, and paying afterwards is outside the allowed set.
  const W = { ...PAY, withdrawnAt: Z('03T00:00:00') };
  const wd = matchEffects({ expected: [W], rows: [], end: Z('31T00:00:00') });
  assert.deepEqual([wd.ok, wd.lids['pay:INV-1'].status], [true, 'withdrawn']);
  assert.deepEqual(codes(matchEffects({ expected: [W], rows: [pay('04T00:00:00')], end: Z('31T00:00:00') })), ['outside-allowed']);
  assert.equal(matchEffects({ expected: [W], rows: [pay('02T00:00:00')], end: Z('31T00:00:00') }).ok, true); // paid before withdrawal
  // Censoring: a window still open at the grading instant is not graded.
  const open = matchEffects({ expected: [PAY], rows: [], end: Z('08T00:00:00') });
  assert.deepEqual([open.ok, open.lids['pay:INV-1'].status], [true, 'open']);
  assert.equal(matchEffects({ expected: [PAY], rows: [], end: Z('10T23:59:59') }).ok, false); // latest <= end: graded
});

test('review P2: lid assignment is independent of list order; key, permitted-window and withdrawal boundaries', () => {
  // Two payments with the same match, windows A [Jan 1-10] and B [Jan 5-31]; rows on Jan 3 and Jan 20 satisfy both
  // whichever way the lids are listed (the old first-in-list rule gave early:B, missed:A for the order B, A).
  const lid = (id, e, l) => ({ lid: id, system: 'bank', op: 'pay', match: { loan: 'L1' }, window: { earliest: `2026-01-${e}T00:00:00Z`, latest: `2026-01-${l}T23:59:59Z` } });
  const row = (d, key, committed = true) => ({ at: `2026-01-${d}T12:00:00Z`, system: 'bank', op: 'pay', key, args: { loan: 'L1' }, committed });
  const A = lid('A', '01', '10'), B = lid('B', '05', '31');
  for (const order of [[A, B], [B, A]]) {
    const g = matchEffects({ expected: order, rows: [row('03', 'k1'), row('20', 'k2')], end: '2026-02-01T00:00:00Z' });
    assert.deepEqual([g.ok, g.lids.A.commitAt, g.lids.B.commitAt], [true, parseInstant('2026-01-03T12:00:00Z'), parseInstant('2026-01-20T12:00:00Z')], order.map(x => x.lid).join());
    // Both windows contain Jan 6: the earlier deadline (A) takes it, so Jan 20 can still satisfy B.
    assert.equal(matchEffects({ expected: order, rows: [row('06', 'k1'), row('20', 'k2')], end: '2026-02-01T00:00:00Z' }).ok, true);
  }
  // A retry keeps its key's lid: B's F3 retry under k2 is not taken by A (first by deadline), which would be a
  // key-split and key-reuse.
  const twin = [A, { ...A, lid: 'A2' }];
  assert.deepEqual(codes(matchEffects({ expected: twin, rows: [row('02', 'k1'), row('03', 'k2'), row('04', 'k2', false)], end: '2026-02-01T00:00:00Z' })), []);
  // A permitted pattern outside its window is not permitted.
  const permitted = [{ system: 'mail', op: 'send', match: { kind: 'reminder' }, window: { earliest: Z('01T00:00:00'), latest: Z('05T00:00:00') } }];
  assert.deepEqual(codes(grade([pay('05T10:00:00'), mail('06T09:00:00'), mail('06T09:30:00', 'reminder', 'm2')], { permitted })), ['outside-allowed']);
  assert.deepEqual(codes(grade([mail('04T09:30:00', 'reminder', 'm2'), pay('05T10:00:00'), mail('06T09:00:00')], { permitted })), []);
  // Withdrawal boundaries: acting at the withdrawal instant is outside the allowed set; a withdrawal exactly at the
  // window's latest still withdraws the obligation (not missed).
  const W = { ...PAY, withdrawnAt: Z('03T00:00:00') };
  assert.deepEqual(codes(matchEffects({ expected: [W], rows: [pay('03T00:00:00')], end: Z('31T00:00:00') })), ['outside-allowed']);
  const atLatest = matchEffects({ expected: [{ ...PAY, withdrawnAt: PAY.window.latest }], rows: [], end: Z('31T00:00:00') });
  assert.deepEqual([atLatest.ok, atLatest.lids['pay:INV-1'].status], [true, 'withdrawn']);
});

test('input validation', () => {
  assert.equal(codeOf(() => grade([pay('06T00:00:00'), pay('05T00:00:00')])), 'LEDGER_ORDER');
  assert.equal(codeOf(() => matchEffects({ expected: [PAY, PAY] })), 'LEDGER_INVALID');
  assert.equal(codeOf(() => matchEffects({ expected: [{ ...PAY, after: ['nope'] }] })), 'LEDGER_INVALID');
  assert.equal(codeOf(() => matchEffects({ expected: [{ ...PAY, window: undefined }] })), 'LEDGER_INVALID');
  assert.equal(codeOf(() => allowedWindow(Z('02T00:00:00'), Z('01T00:00:00'))), 'LEDGER_INVALID');
  assert.equal(codeOf(() => grade([{ at: Z('05T00:00:00'), system: 'bank', op: 'pay', args: {} }])), 'LEDGER_INVALID'); // no committed flag
  assert.equal(codeOf(() => grade([{ ...pay('05T00:00:00'), at: '2026-12-05T00:00:00' }])), 'TIME_INVALID'); // no offset
});

test('key and multiplicity invariants', () => {
  const rows = [
    { system: 'bank', op: 'pay', key: 'k1', args: { a: 1 }, committed: true },
    { system: 'bank', op: 'pay', key: 'k1', args: { a: 2 }, committed: false },
    { system: 'bank', op: 'pay', key: 'k2', args: { a: 1 }, committed: true },
    { system: 'bank', op: 'pay', key: 'k2', args: { a: 1 }, committed: true },
    { system: 'mail', op: 'send', key: 'k1', args: { a: 1 }, committed: true },
  ];
  assert.deepEqual(keyViolations(rows), [{ code: 'key-conflict', system: 'bank', key: 'k1', rows: [0, 1] }, { code: 'double-apply', system: 'bank', key: 'k2', rows: [2, 3] }]);
  const pays = [{ op: 'pay', args: { invoice: 'A' }, committed: true }, { op: 'pay', args: { invoice: 'A' }, committed: false }, { op: 'pay', args: { invoice: 'B' }, committed: true }, { op: 'pay', args: { invoice: 'B' }, committed: true }];
  assert.deepEqual(atMostOnce(pays, { keyOf: r => r.args.invoice }), [{ code: 'more-than-once', key: 'B', rows: [2, 3] }]);
  assert.deepEqual(exactlyOnce(pays, { keyOf: r => r.args.invoice, required: ['A', 'B', 'C'] }).map(v => [v.code, v.key]), [['more-than-once', 'B'], ['missing', 'C']]);
});

test('conservation identities in exact minor units', () => {
  assert.equal(sumMinor([9007199254740000, 991]), 9007199254740991);
  assert.equal(sumMinor([9007199254740991, 1]), '9007199254740992'); // beyond 2^53: exact, as a string
  assert.equal(codeOf(() => sumMinor([0.1, 0.2])), 'LEDGER_INVALID');
  assert.deepEqual(identity([500, 100], [300, 200, 100]), { ok: true, lhs: 600, rhs: 600, diff: 0 });
  // Per PO line: Σ invoiced = Σ matched + Σ held. Line L2 is 10 short.
  const lines = [{ line: 'L1', invoiced: 500, matched: 300, held: 200 }, { line: 'L1', invoiced: 100, matched: 100, held: 0 }, { line: 'L2', invoiced: 50, matched: 40, held: 0 }];
  assert.deepEqual(identityByGroup(lines, { group: r => r.line, lhs: r => r.invoiced, rhs: r => [r.matched, r.held] }), [{ code: 'identity', group: 'L2', ok: false, lhs: 50, rhs: 40, diff: 10 }]);
  const elim = [{ pair: 'P1', amount: 1000 }, { pair: 'P1', amount: -1000 }, { pair: 'P2', amount: 700 }, { pair: 'P2', amount: -699 }];
  assert.deepEqual(netsToZero(elim, { group: r => r.pair, amount: r => r.amount }).map(v => [v.code, v.group, v.diff]), [['nonzero', 'P2', 1]]);
  const je = [
    { id: 'J1', lines: [{ account: '1200', side: 'debit', amount: 100, currency: 'USD' }, { account: '4000', side: 'credit', amount: 100, currency: 'USD' }] },
    { id: 'J2', lines: [{ account: '1200', side: 'debit', amount: 100, currency: 'EUR' }, { account: '4000', side: 'credit', amount: 99, currency: 'EUR' }] },
    { id: 'J3', lines: [{ account: '1200', side: 'debit', amount: 100, currency: 'USD' }, { account: '4000', side: 'credit', amount: 100, currency: 'EUR' }] },
  ];
  assert.deepEqual(doubleEntry(je).map(v => [v.entry, v.currency, v.diff]), [['J2', 'EUR', 1], ['J3', 'EUR', -100], ['J3', 'USD', 100]]);
  assert.equal(codeOf(() => doubleEntry([{ id: 'J4', lines: [{ side: 'debit', amount: -5, currency: 'USD' }] }])), 'LEDGER_INVALID');
});

test('X12 835 balancing on a hand-built remittance', () => {
  assert.deepEqual(balance835(REMIT_835), []);
  const mut = f => { const r = structuredClone(REMIT_835); f(r); return balance835(r).map(v => [v.code, v.diff]); };
  assert.deepEqual(mut(r => { r.claims[0].lines[0].svc03 = 10001; }), [['line', 1]]); // only the line breaks
  assert.deepEqual(mut(r => { r.claims[0].clp04 = 17201; }), [['claim', 1], ['transaction', -1]]);
  assert.deepEqual(mut(r => { r.plb[0].amount = 150; }), [['transaction', 300]]); // interest sign error
  assert.deepEqual(mut(r => { r.claims[0].lines[1].svc02 = 10001; }), [['line', -1], ['line-charges', 1]]);
  assert.deepEqual(mut(r => { r.claims[1].adjustments[0].amount = 4999; }), [['claim', -1]]);
  // Charges not itemised at line level but balanced at claim level: only the line-charge rule objects.
  const split = structuredClone(REMIT_835);
  split.claims[0].clp03 = 25100; split.claims[0].adjustments = [{ group: 'CO', reason: '45', amount: 100 }];
  assert.deepEqual(balance835(split).map(v => v.code), ['line-charges']);
  assert.deepEqual(balance835(split, { requireLineChargeSum: false }), []);
  assert.equal(codeOf(() => mut(r => { r.bpr02 = 153.5; })), 'LEDGER_INVALID');
  // A reversal (negative charge and payment) balances the same way.
  assert.deepEqual(balance835({ bpr02: -17200, claims: [{ id: 'R1', clp03: -25000, clp04: -17200, adjustments: [{ group: 'CO', reason: '45', amount: -7800 }], lines: [] }], plb: [] }), []);
});
