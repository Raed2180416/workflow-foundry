// E1 procure-to-pay systems (E-BED §3 E1): `erp` (vendors, POs, invoices, match records, holds, approvals, postings,
// payment blocks), `wms` (goods receipts and service entry sheets, written by the world) and `bank` (payments, single
// and as a run). Provisional v1 bindings for the host suite; spec-E (E-BED §8.1 step 4) pins the final field names.
// The match record is product-computed (Track P: the arm computes and writes it; Track C: the product engine does).
// Mocks enforce referential integrity only. Posting a held invoice, paying twice without a key or releasing a hold
// without approval are the arm's mistakes to make; the oracle grades them (critical violations, §2.8).
import { defineSystem, MockError } from '../mocks.mjs';
import { S } from '../schema.mjs';

const ID = S.str(80, { minLength: 1 });
const MINOR = S.int({ minimum: 0, maximum: 1e13 });
const CUR = S.str(3, { minLength: 3 });
const STATUS = S.enumOf(['passed', 'failed', 'notChecked']);
const LINE = S.obj({ lineNo: S.int({ minimum: 1 }), itemId: ID, qty: S.num({ minimum: 0 }), unitPriceMinor: MINOR, netMinor: MINOR },
  ['lineNo', 'itemId', 'qty', 'unitPriceMinor', 'netMinor']);

export const erp = defineSystem({
  id: 'erp',
  description: 'Accounts payable: invoice register, matching record, holds, approvals, postings, payment blocks.',
  latencyMinutes: 1,
  tables: {
    vendors: { pk: 'vendorId', fields: { vendorId: ID, name: S.str(120), group: S.str(40), terms: S.str(40) } },
    purchaseOrders: { pk: 'poNumber', fields: { poNumber: ID, vendorId: ID, legalEntity: S.str(20), currency: CUR, status: S.str(20),
      lines: S.arr(S.obj({ lineNo: S.int(), itemId: ID, itemGroup: S.str(40), qty: S.num(), unitPriceMinor: MINOR, priceUnit: S.num(), netMinor: MINOR })) } },
    invoices: { pk: 'invoiceId', fields: { invoiceId: ID, vendorId: ID, vendorInvoiceNo: S.str(80), poNumber: S.nullable(ID), invoiceDate: S.str(10),
      lines: S.arr(LINE), chargesMinor: MINOR, totalMinor: MINOR, currency: CUR,
      status: S.enumOf(['registered', 'posted', 'reversed', 'cancelled']), registeredAt: S.str(40), sourceDoc: S.nullable(S.str(80)) } },
    matches: { pk: 'matchId', fields: { matchId: S.str(100), invoiceId: ID, lineNo: S.int(), priceTotals: STATUS, netUnitPrice: STATUS,
      quantity: STATUS, charges: STATUS, invoiceTotals: STATUS, updatedAt: S.str(40) },
    computed: ['priceTotals', 'netUnitPrice', 'quantity', 'charges', 'invoiceTotals'] },
    holds: { pk: 'holdId', fields: { holdId: ID, invoiceId: ID, lineNo: S.nullable(S.int()), reason: S.str(80), status: S.enumOf(['active', 'released']),
      setAt: S.str(40), releasedAt: S.nullable(S.str(40)), releaseReason: S.nullable(S.str(200)) } },
    approvals: { pk: 'approvalId', fields: { approvalId: ID, invoiceId: ID, approver: S.str(80), decision: S.enumOf(['approve', 'reject']), taskId: S.nullable(S.str(80)), at: S.str(40) } },
    postings: { pk: 'postingId', fields: { postingId: ID, invoiceId: ID, amountMinor: MINOR, currency: CUR, postedAt: S.str(40), reversed: S.bool, reversedAt: S.nullable(S.str(40)) } },
    paymentBlocks: { pk: 'blockId', fields: { blockId: ID, invoiceId: ID, reason: S.str(80), status: S.enumOf(['active', 'removed']), setAt: S.str(40), removedAt: S.nullable(S.str(40)) } },
  },
  ops: {
    registerInvoice: {
      args: S.obj({ invoiceId: ID, vendorId: ID, vendorInvoiceNo: S.str(80, { minLength: 1 }), poNumber: S.nullable(ID), invoiceDate: S.str(10, { minLength: 10 }),
        lines: S.arr(LINE, 1000), chargesMinor: MINOR, totalMinor: MINOR, currency: CUR, sourceDoc: S.nullable(S.str(80)) }),
      keyed: true, subjectArgs: ['invoiceId'],
      apply(db, a, ctx) {
        if (!db.has('vendors', a.vendorId)) throw new MockError(422, 'unknown-vendor', { vendorId: a.vendorId });
        if (a.poNumber !== null && !db.has('purchaseOrders', a.poNumber)) throw new MockError(422, 'unknown-po', { poNumber: a.poNumber });
        db.insert('invoices', { ...a, status: 'registered', registeredAt: ctx.now });
        return { invoiceId: a.invoiceId, status: 'registered' };
      },
    },
    setMatch: {
      description: 'Write the product-computed match record of one invoice line.',
      args: S.obj({ invoiceId: ID, lineNo: S.int({ minimum: 1 }), priceTotals: STATUS, netUnitPrice: STATUS, quantity: STATUS, charges: STATUS, invoiceTotals: STATUS }),
      keyed: true, subjectArgs: ['invoiceId'],
      apply(db, a, ctx) {
        db.require('invoices', a.invoiceId);
        const matchId = `${a.invoiceId}/${a.lineNo}`;
        db.upsert('matches', { matchId, ...a, updatedAt: ctx.now });
        return { matchId };
      },
    },
    hold: {
      args: S.obj({ holdId: ID, invoiceId: ID, lineNo: S.nullable(S.int({ minimum: 1 })), reason: S.str(80, { minLength: 1 }) }),
      keyed: true, subjectArgs: ['invoiceId'],
      apply(db, a, ctx) {
        db.require('invoices', a.invoiceId);
        db.insert('holds', { ...a, status: 'active', setAt: ctx.now, releasedAt: null, releaseReason: null });
        return { holdId: a.holdId, status: 'active' };
      },
    },
    release: {
      args: S.obj({ holdId: ID, invoiceId: ID, reason: S.str(200) }),
      keyed: true, subjectArgs: ['invoiceId'], reverses: 'erp.hold',
      apply(db, a, ctx) {
        const h = db.require('holds', a.holdId);
        if (h.invoiceId !== a.invoiceId) throw new MockError(422, 'hold-not-on-invoice');
        if (h.status !== 'active') throw new MockError(409, 'hold-not-active');
        db.update('holds', a.holdId, { status: 'released', releasedAt: ctx.now, releaseReason: a.reason });
        return { holdId: a.holdId, status: 'released' };
      },
    },
    block: {
      args: S.obj({ blockId: ID, invoiceId: ID, reason: S.str(80, { minLength: 1 }) }),
      keyed: true, subjectArgs: ['invoiceId'],
      apply(db, a, ctx) { db.require('invoices', a.invoiceId); db.insert('paymentBlocks', { ...a, status: 'active', setAt: ctx.now, removedAt: null }); return { blockId: a.blockId }; },
    },
    unblock: {
      args: S.obj({ blockId: ID, invoiceId: ID }),
      keyed: true, subjectArgs: ['invoiceId'], reverses: 'erp.block',
      apply(db, a, ctx) {
        const b = db.require('paymentBlocks', a.blockId);
        if (b.status !== 'active') throw new MockError(409, 'block-not-active');
        db.update('paymentBlocks', a.blockId, { status: 'removed', removedAt: ctx.now });
        return { blockId: a.blockId, status: 'removed' };
      },
    },
    recordApproval: {
      args: S.obj({ approvalId: ID, invoiceId: ID, approver: S.str(80, { minLength: 1 }), decision: S.enumOf(['approve', 'reject']), taskId: S.nullable(S.str(80)) }),
      keyed: true, subjectArgs: ['invoiceId'],
      apply(db, a, ctx) { db.require('invoices', a.invoiceId); db.insert('approvals', { ...a, at: ctx.now }); return { approvalId: a.approvalId }; },
    },
    post: {
      args: S.obj({ postingId: ID, invoiceId: ID, amountMinor: MINOR, currency: CUR }),
      keyed: true, subjectArgs: ['invoiceId'],
      apply(db, a, ctx) {
        const inv = db.require('invoices', a.invoiceId);
        if (inv.status === 'cancelled') throw new MockError(409, 'invoice-cancelled');
        db.insert('postings', { ...a, postedAt: ctx.now, reversed: false, reversedAt: null });
        db.update('invoices', a.invoiceId, { status: 'posted' });
        return { postingId: a.postingId };
      },
    },
    reverse: {
      args: S.obj({ postingId: ID, invoiceId: ID }),
      keyed: true, subjectArgs: ['invoiceId'], reverses: 'erp.post',
      apply(db, a, ctx) {
        const p = db.require('postings', a.postingId);
        if (p.reversed) throw new MockError(409, 'already-reversed');
        db.update('postings', a.postingId, { reversed: true, reversedAt: ctx.now });
        db.update('invoices', a.invoiceId, { status: 'reversed' });
        return { postingId: a.postingId, reversed: true };
      },
    },
    cancelInvoice: {
      args: S.obj({ invoiceId: ID, reason: S.str(200) }),
      keyed: true, subjectArgs: ['invoiceId'],
      apply(db, a) { db.require('invoices', a.invoiceId); db.update('invoices', a.invoiceId, { status: 'cancelled' }); return { invoiceId: a.invoiceId, status: 'cancelled' }; },
    },
    getInvoice: {
      args: S.obj({ invoiceId: ID }), readOnly: true, subjectArgs: ['invoiceId'],
      apply(db, a) { const inv = db.require('invoices', a.invoiceId); return { invoice: inv }; },
    },
  },
});

export const wms = defineSystem({
  id: 'wms',
  description: 'Goods receipts and service entry sheets; written by the warehouse (world), read by the arm.',
  latencyMinutes: 1,
  tables: {
    goodsReceipts: { pk: 'grId', fields: { grId: ID, poNumber: ID, lineNo: S.int(), qty: S.num(), receivedAt: S.str(40), cancelled: S.bool } },
    serviceEntrySheets: { pk: 'sesId', fields: { sesId: ID, poNumber: ID, lineNo: S.int(), amountMinor: MINOR, acceptedAt: S.str(40) } },
  },
  ops: {},
});

const PAYMENT = { invoiceId: ID, vendorId: ID, amountMinor: S.int({ minimum: 1, maximum: 1e13 }), currency: CUR };
function pay(db, a, ctx, runId) {
  if (!db.has('vendorAccounts', a.vendorId)) throw new MockError(422, 'no-vendor-account', { vendorId: a.vendorId });
  const paymentId = db.nextId('PAY');
  db.insert('payments', { paymentId, ...a, paidAt: ctx.now, runId });
  return { paymentId };
}

export const bank = defineSystem({
  id: 'bank',
  description: 'Outgoing vendor payments (money movement). Keyed payments are exactly-once; payment runs key each item.',
  latencyMinutes: 2,
  tables: {
    vendorAccounts: { pk: 'vendorId', fields: { vendorId: ID, iban: S.str(40) } },
    payments: { pk: 'paymentId', fields: { paymentId: ID, ...PAYMENT, paidAt: S.str(40), runId: S.nullable(ID) } },
  },
  ops: {
    pay: { args: S.obj(PAYMENT), keyed: true, money: true, subjectArgs: ['invoiceId'], apply: (db, a, ctx) => pay(db, a, ctx, null) },
    payRun: {
      description: 'A payment run; each item is applied on its own and may carry its own key (F4: k of n applied).',
      args: S.obj({ runId: ID, items: S.arr(S.obj({ key: S.str(200, { minLength: 1 }), ...PAYMENT }, Object.keys(PAYMENT)), 500, { minItems: 1 }) }),
      keyed: true, money: true, batch: true, subjectArgs: ['invoiceId'],
      applyItem: (db, item, a, ctx) => { const { key, ...p } = item; return pay(db, p, ctx, a.runId); },
    },
  },
});

export const systems = Object.freeze([erp, wms, bank]);
