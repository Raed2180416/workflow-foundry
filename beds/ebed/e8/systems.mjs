// E8 systems, pinned by spec/SPEC-E.md §2 (supersedes the provisional host/systems/e8.mjs for the item). Status
// vocabularies follow the reference app (`app/order/api.go:73-94` order statuses, `:161-179` fulfilment statuses,
// `temporalio/reference-app-orders-go@f4420d9`), plus `dispatched` (named in the app's comment at `api.go:149`) and the
// saga's compensation ops. Mocks enforce referential integrity only; every workflow rule is the arm's to keep and the
// oracle's to grade. Reversal ops address their target by business keys (fulfilment, sku), never by generated ids.
import { defineSystem, MockError } from '../host/mocks.mjs';
import { S } from '../host/schema.mjs';
import { mail, notify } from '../host/systems/common.mjs';

const ID = S.str(80, { minLength: 1 });
const TIME = S.str(40);
const MINOR = S.int({ minimum: 1, maximum: 1e13 });
const CUR = S.str(3, { minLength: 3 });
export const ORDER_STATUS = Object.freeze(['pending', 'customerActionRequired', 'processing', 'completed', 'failed', 'cancelled', 'timedOut']);
export const FULFILMENT_STATUS = Object.freeze(['unavailable', 'pending', 'processing', 'dispatched', 'completed', 'cancelled', 'failed']);
export const SHIPMENT_STATUS = Object.freeze(['created', 'collected', 'inTransit', 'delivered', 'cancelled', 'failed']);
const ITEM = S.obj({ sku: ID, qty: S.int({ minimum: 1, maximum: 1000 }) });
const ITEMS = S.arr(ITEM, 50, { minItems: 1 });
const FUL_IN = S.obj({ fulfilmentId: ID, location: S.nullable(S.str(40, { minLength: 1 })), items: ITEMS, amountMinor: MINOR });

export const orders = defineSystem({
  id: 'orders',
  description: 'Orders and their per-location fulfilments.',
  latencyMinutes: 1,
  tables: {
    orders: { pk: 'orderId', fields: { orderId: ID, customerId: ID, status: S.enumOf(ORDER_STATUS), placedAt: TIME, currency: CUR, items: ITEMS, totalMinor: MINOR } },
    fulfilments: { pk: 'fulfilmentId', fields: { fulfilmentId: ID, orderId: ID, location: S.nullable(S.str(40)), items: ITEMS, amountMinor: MINOR, status: S.enumOf(FULFILMENT_STATUS) } },
  },
  ops: {
    create: {
      description: 'Record an order and its fulfilments; the order starts pending, a fulfilment pending (unavailable when its location is null).',
      args: S.obj({ orderId: ID, customerId: ID, placedAt: TIME, currency: CUR, items: ITEMS, fulfilments: S.arr(FUL_IN, 20, { minItems: 1 }), totalMinor: MINOR }),
      keyed: true, subjectArgs: ['orderId'],
      apply(db, a) {
        db.insert('orders', { orderId: a.orderId, customerId: a.customerId, status: 'pending', placedAt: a.placedAt, currency: a.currency, items: a.items, totalMinor: a.totalMinor });
        for (const f of a.fulfilments) {
          db.insert('fulfilments', { fulfilmentId: f.fulfilmentId, orderId: a.orderId, location: f.location, items: f.items, amountMinor: f.amountMinor, status: f.location === null ? 'unavailable' : 'pending' });
        }
        return { orderId: a.orderId, fulfilments: a.fulfilments.map(f => f.fulfilmentId) };
      },
    },
    setStatus: {
      description: 'Set the status of the order (fulfilmentId null) or of one of its fulfilments. Transitions are not checked.',
      args: S.obj({ orderId: ID, fulfilmentId: S.nullable(ID), status: S.str(40, { minLength: 1 }) }),
      keyed: true, subjectArgs: ['orderId'],
      apply(db, a) {
        db.require('orders', a.orderId);
        if (a.fulfilmentId === null) {
          if (!ORDER_STATUS.includes(a.status)) throw new MockError(400, 'bad-status', { status: a.status });
          db.update('orders', a.orderId, { status: a.status });
        } else {
          const f = db.require('fulfilments', a.fulfilmentId);
          if (f.orderId !== a.orderId) throw new MockError(422, 'fulfilment-not-on-order');
          if (!FULFILMENT_STATUS.includes(a.status)) throw new MockError(400, 'bad-status', { status: a.status });
          db.update('fulfilments', a.fulfilmentId, { status: a.status });
        }
        return { orderId: a.orderId, fulfilmentId: a.fulfilmentId, status: a.status };
      },
    },
  },
});

export const inventory = defineSystem({
  id: 'inventory',
  description: 'Stock per location, the fulfilment planner (allocate) and reservations. Reserve is a batch: each item has its own key.',
  latencyMinutes: 1,
  tables: {
    stock: { pk: 'stockId', fields: { stockId: S.str(120), location: S.str(40), sku: ID, onHand: S.int({ minimum: 0 }), reserved: S.int({ minimum: 0 }) } },
    reservations: { pk: 'reservationId', fields: { reservationId: ID, orderId: ID, fulfilmentId: ID, location: S.str(40), sku: ID, qty: S.int(), status: S.enumOf(['active', 'released']), at: TIME } },
    allocations: { pk: 'orderId', hidden: true, fields: { orderId: ID, fulfilments: S.arr(S.obj({ fulfilmentId: ID, location: S.nullable(S.str(40)), items: ITEMS, available: S.bool })) } },
  },
  ops: {
    allocate: {
      description: 'The fulfilment plan of an order (read-only): { orderId, fulfilments: [{ fulfilmentId, location, items, available }] }.',
      args: S.obj({ orderId: ID }), readOnly: true, subjectArgs: ['orderId'],
      apply(db, a) {
        const plan = db.get('allocations', a.orderId);
        if (!plan) throw new MockError(404, 'unknown-order', { orderId: a.orderId });
        return { orderId: plan.orderId, fulfilments: plan.fulfilments };
      },
    },
    reserve: {
      description: 'Reserve each item of one fulfilment at its location. Items: [{ key, sku, qty }].',
      args: S.obj({ orderId: ID, fulfilmentId: ID, location: S.str(40, { minLength: 1 }), items: S.arr(S.obj({ key: S.str(200, { minLength: 1 }), sku: ID, qty: S.int({ minimum: 1 }) }, ['sku', 'qty']), 50, { minItems: 1 }) }),
      keyed: true, batch: true, subjectArgs: ['orderId'], itemContext: ['orderId', 'fulfilmentId', 'location'],
      applyItem(db, item, a, ctx) {
        const stockId = `${a.location}/${item.sku}`;
        const s = db.get('stock', stockId);
        if (!s) throw new MockError(404, 'no-stock-record', { location: a.location, sku: item.sku });
        if (s.onHand - s.reserved < item.qty) throw new MockError(409, 'insufficient-stock', { sku: item.sku });
        const existing = db.rows('reservations').find(r => r.fulfilmentId === a.fulfilmentId && r.sku === item.sku && r.status === 'active');
        if (existing) throw new MockError(409, 'already-reserved', { sku: item.sku });
        db.update('stock', stockId, { reserved: s.reserved + item.qty });
        const reservationId = db.nextId('RSV');
        db.insert('reservations', { reservationId, orderId: a.orderId, fulfilmentId: a.fulfilmentId, location: a.location, sku: item.sku, qty: item.qty, status: 'active', at: ctx.now });
        return { reservationId, sku: item.sku };
      },
    },
    release: {
      description: 'Release the active reservation of one item of one fulfilment.',
      args: S.obj({ orderId: ID, fulfilmentId: ID, sku: ID }),
      keyed: true, subjectArgs: ['orderId'], reverses: 'inventory.reserve',
      apply(db, a) {
        const r = db.rows('reservations').find(x => x.fulfilmentId === a.fulfilmentId && x.sku === a.sku && x.status === 'active');
        if (!r) throw new MockError(409, 'no-active-reservation', { fulfilmentId: a.fulfilmentId, sku: a.sku });
        if (r.orderId !== a.orderId) throw new MockError(422, 'reservation-not-on-order');
        const stockId = `${r.location}/${r.sku}`;
        const s = db.require('stock', stockId);
        db.update('stock', stockId, { reserved: s.reserved - r.qty });
        db.update('reservations', r.reservationId, { status: 'released' });
        return { reservationId: r.reservationId, status: 'released' };
      },
    },
  },
});

export const billing = defineSystem({
  id: 'billing',
  description: 'Customer charges and refunds (money movement). A declined card answers 402 card-declined, permanently.',
  latencyMinutes: 1,
  tables: {
    charges: { pk: 'chargeId', fields: { chargeId: ID, orderId: ID, fulfilmentId: ID, customerId: ID, amountMinor: MINOR, currency: CUR, at: TIME, refundedMinor: S.int({ minimum: 0 }) } },
    refunds: { pk: 'refundId', fields: { refundId: ID, chargeId: ID, orderId: ID, fulfilmentId: ID, amountMinor: MINOR, at: TIME } },
    cards: { pk: 'customerId', hidden: true, fields: { customerId: ID, status: S.enumOf(['ok', 'declined']) } },
  },
  ops: {
    charge: {
      args: S.obj({ orderId: ID, fulfilmentId: ID, customerId: ID, amountMinor: MINOR, currency: CUR }),
      keyed: true, money: true, subjectArgs: ['orderId'],
      apply(db, a, ctx) {
        if (db.get('cards', a.customerId)?.status === 'declined') throw new MockError(402, 'card-declined', { retryable: false });
        const chargeId = db.nextId('CHG');
        db.insert('charges', { chargeId, orderId: a.orderId, fulfilmentId: a.fulfilmentId, customerId: a.customerId, amountMinor: a.amountMinor, currency: a.currency, at: ctx.now, refundedMinor: 0 });
        return { chargeId };
      },
    },
    refund: {
      description: 'Refund (part of) the charge of one fulfilment.',
      args: S.obj({ orderId: ID, fulfilmentId: ID, amountMinor: MINOR }),
      keyed: true, money: true, subjectArgs: ['orderId'], reverses: 'billing.charge',
      apply(db, a, ctx) {
        const c = db.rows('charges').find(x => x.fulfilmentId === a.fulfilmentId);
        if (!c) throw new MockError(404, 'no-charge', { fulfilmentId: a.fulfilmentId });
        if (c.orderId !== a.orderId) throw new MockError(422, 'charge-not-on-order');
        if (c.refundedMinor + a.amountMinor > c.amountMinor) throw new MockError(409, 'over-refund');
        db.update('charges', c.chargeId, { refundedMinor: c.refundedMinor + a.amountMinor });
        const refundId = db.nextId('RFD');
        db.insert('refunds', { refundId, chargeId: c.chargeId, orderId: a.orderId, fulfilmentId: a.fulfilmentId, amountMinor: a.amountMinor, at: ctx.now });
        return { refundId };
      },
    },
  },
});

export const carrier = defineSystem({
  id: 'carrier',
  description: 'Shipments with the carrier of each location. Status changes arrive as carrier messages (quoting `ref` when you set one).',
  latencyMinutes: 1,
  tables: {
    shipments: { pk: 'shipmentId', fields: { shipmentId: ID, orderId: ID, fulfilmentId: ID, location: S.str(40), carrier: S.str(40), status: S.enumOf(SHIPMENT_STATUS), createdAt: TIME, ref: S.nullable(S.str(120)) } },
    routes: { pk: 'location', hidden: true, fields: { location: S.str(40), carrier: S.str(40) } },
  },
  ops: {
    create: {
      args: S.obj({ orderId: ID, fulfilmentId: ID, location: S.str(40, { minLength: 1 }), ref: S.nullable(S.str(120, { minLength: 1 })) }, ['orderId', 'fulfilmentId', 'location']),
      keyed: true, subjectArgs: ['orderId'],
      apply(db, a, ctx) {
        const route = db.get('routes', a.location);
        if (!route) throw new MockError(422, 'unknown-location', { location: a.location });
        const live = db.rows('shipments').find(s => s.fulfilmentId === a.fulfilmentId && !['cancelled', 'failed'].includes(s.status));
        if (live) throw new MockError(409, 'shipment-exists', { fulfilmentId: a.fulfilmentId });
        const shipmentId = db.nextId('SHP');
        db.insert('shipments', { shipmentId, orderId: a.orderId, fulfilmentId: a.fulfilmentId, location: a.location, carrier: route.carrier, status: 'created', createdAt: ctx.now, ref: a.ref ?? null });
        return { shipmentId, carrier: route.carrier };
      },
    },
    cancel: {
      description: 'Cancel the shipment of one fulfilment; refused once the carrier has collected it.',
      args: S.obj({ orderId: ID, fulfilmentId: ID }),
      keyed: true, subjectArgs: ['orderId'], reverses: 'carrier.create',
      apply(db, a) {
        const s = db.rows('shipments').filter(x => x.fulfilmentId === a.fulfilmentId).sort((x, y) => (x.shipmentId < y.shipmentId ? 1 : -1))[0];
        if (!s) throw new MockError(404, 'no-shipment', { fulfilmentId: a.fulfilmentId });
        if (s.orderId !== a.orderId) throw new MockError(422, 'shipment-not-on-order');
        if (['collected', 'inTransit', 'delivered'].includes(s.status)) throw new MockError(409, 'already-collected', { retryable: false });
        if (s.status !== 'created') throw new MockError(409, 'not-cancellable', { status: s.status, retryable: false });
        db.update('shipments', s.shipmentId, { status: 'cancelled' });
        return { shipmentId: s.shipmentId, status: 'cancelled' };
      },
    },
  },
});

export const fraud = defineSystem({
  id: 'fraud',
  description: 'Fraud screening (read-only); the verdict list is internal.',
  latencyMinutes: 1,
  tables: { verdicts: { pk: 'orderId', hidden: true, fields: { orderId: ID, verdict: S.enumOf(['pass', 'review', 'reject']) } } },
  ops: {
    check: { args: S.obj({ orderId: ID }), readOnly: true, subjectArgs: ['orderId'], apply(db, a) { return { orderId: a.orderId, verdict: db.get('verdicts', a.orderId)?.verdict ?? 'pass' }; } },
  },
});

export { notify, mail };
export const systems = Object.freeze([orders, inventory, billing, carrier, fraud, notify]);
