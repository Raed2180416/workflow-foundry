// E8 order-fulfilment systems (E-BED §3 E8; run on the `temporal-like` profile): `orders`, `inventory`, `billing`,
// `carrier`, `fraud`. Status vocabularies are provisional [I]: spec-E pins them from the reference app
// (`app/order/api.go:75–197` [code], E-BED §3 E8). `billing.charge` and `billing.refund` are money movements; the
// carrier reports shipment status through counterparty signals (item actors), never through the mock's own logic.
// The fraud verdict list is a hidden table: `fraud.check` returns the verdict only.
import { defineSystem, MockError } from '../mocks.mjs';
import { S } from '../schema.mjs';

const ID = S.str(80, { minLength: 1 });
const TIME = S.str(40);
const MINOR = S.int({ minimum: 1, maximum: 1e13 });
const CUR = S.str(3, { minLength: 3 });
export const ORDER_STATUS = Object.freeze(['pending', 'customerActionRequired', 'processing', 'completed', 'failed', 'cancelled', 'timedOut']);
export const FULFILMENT_STATUS = Object.freeze(['unavailable', 'pending', 'processing', 'completed', 'cancelled', 'failed']);
const ITEM = S.obj({ sku: ID, qty: S.int({ minimum: 1 }) });

export const orders = defineSystem({
  id: 'orders',
  description: 'Orders and their per-location fulfilments.',
  latencyMinutes: 1,
  tables: {
    orders: { pk: 'orderId', fields: { orderId: ID, customerId: ID, status: S.enumOf(ORDER_STATUS), placedAt: TIME, items: S.arr(ITEM), totalMinor: MINOR, currency: CUR } },
    fulfilments: { pk: 'fulfilmentId', fields: { fulfilmentId: ID, orderId: ID, location: S.str(40), items: S.arr(ITEM), amountMinor: MINOR, status: S.enumOf(FULFILMENT_STATUS) } },
  },
  ops: {
    setStatus: {
      args: S.obj({ orderId: ID, fulfilmentId: S.nullable(ID), status: S.str(40, { minLength: 1 }) }),
      keyed: true, subjectArgs: ['orderId'],
      apply(db, a) {
        const o = db.require('orders', a.orderId);
        if (a.fulfilmentId === null) {
          if (!ORDER_STATUS.includes(a.status)) throw new MockError(400, 'bad-status', { status: a.status });
          db.update('orders', o.orderId, { status: a.status });
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
  description: 'Stock per location and reservations (reserve is a batch: F4 applies k of n items).',
  latencyMinutes: 1,
  tables: {
    stock: { pk: 'stockId', fields: { stockId: S.str(120), location: S.str(40), sku: ID, onHand: S.int({ minimum: 0 }), reserved: S.int({ minimum: 0 }) } },
    reservations: { pk: 'reservationId', fields: { reservationId: ID, orderId: ID, fulfilmentId: ID, location: S.str(40), sku: ID, qty: S.int(), status: S.enumOf(['active', 'released']), at: TIME } },
  },
  ops: {
    reserve: {
      args: S.obj({ orderId: ID, fulfilmentId: ID, location: S.str(40, { minLength: 1 }), items: S.arr(S.obj({ key: S.str(200, { minLength: 1 }), sku: ID, qty: S.int({ minimum: 1 }) }, ['sku', 'qty']), 200, { minItems: 1 }) }),
      keyed: true, batch: true, subjectArgs: ['orderId'], itemContext: ['orderId', 'fulfilmentId', 'location'],
      applyItem(db, item, a, ctx) {
        const stockId = `${a.location}/${item.sku}`;
        const s = db.require('stock', stockId);
        if (s.onHand - s.reserved < item.qty) throw new MockError(409, 'insufficient-stock', { sku: item.sku });
        db.update('stock', stockId, { reserved: s.reserved + item.qty });
        const reservationId = db.nextId('RSV');
        db.insert('reservations', { reservationId, orderId: a.orderId, fulfilmentId: a.fulfilmentId, location: a.location, sku: item.sku, qty: item.qty, status: 'active', at: ctx.now });
        return { reservationId, sku: item.sku };
      },
    },
    release: {
      args: S.obj({ orderId: ID, reservationId: ID }),
      keyed: true, subjectArgs: ['orderId'], reverses: 'inventory.reserve',
      apply(db, a) {
        const r = db.require('reservations', a.reservationId);
        if (r.orderId !== a.orderId) throw new MockError(422, 'reservation-not-on-order');
        if (r.status !== 'active') throw new MockError(409, 'not-active');
        const stockId = `${r.location}/${r.sku}`;
        const s = db.require('stock', stockId);
        db.update('stock', stockId, { reserved: s.reserved - r.qty });
        db.update('reservations', a.reservationId, { status: 'released' });
        return { reservationId: a.reservationId, status: 'released' };
      },
    },
  },
});

export const billing = defineSystem({
  id: 'billing',
  description: 'Customer charges and refunds (money movement).',
  latencyMinutes: 1,
  tables: {
    charges: { pk: 'chargeId', fields: { chargeId: ID, orderId: ID, fulfilmentId: S.nullable(ID), amountMinor: MINOR, currency: CUR, at: TIME, refundedMinor: S.int({ minimum: 0 }) } },
    refunds: { pk: 'refundId', fields: { refundId: ID, chargeId: ID, orderId: ID, amountMinor: MINOR, at: TIME } },
  },
  ops: {
    charge: {
      args: S.obj({ orderId: ID, fulfilmentId: S.nullable(ID), amountMinor: MINOR, currency: CUR }),
      keyed: true, money: true, subjectArgs: ['orderId'],
      apply(db, a, ctx) { const chargeId = db.nextId('CHG'); db.insert('charges', { chargeId, ...a, at: ctx.now, refundedMinor: 0 }); return { chargeId }; },
    },
    refund: {
      args: S.obj({ orderId: ID, chargeId: ID, amountMinor: MINOR }),
      keyed: true, money: true, subjectArgs: ['orderId'], reverses: 'billing.charge',
      apply(db, a, ctx) {
        const c = db.require('charges', a.chargeId);
        if (c.orderId !== a.orderId) throw new MockError(422, 'charge-not-on-order');
        if (c.refundedMinor + a.amountMinor > c.amountMinor) throw new MockError(409, 'over-refund');
        db.update('charges', a.chargeId, { refundedMinor: c.refundedMinor + a.amountMinor });
        const refundId = db.nextId('RFD');
        db.insert('refunds', { refundId, chargeId: a.chargeId, orderId: a.orderId, amountMinor: a.amountMinor, at: ctx.now });
        return { refundId };
      },
    },
  },
});

export const carrier = defineSystem({
  id: 'carrier',
  description: 'Shipment creation and cancellation; status arrives as counterparty signals quoting `ref`.',
  latencyMinutes: 1,
  tables: {
    shipments: { pk: 'shipmentId', fields: { shipmentId: ID, orderId: ID, fulfilmentId: ID, location: S.str(40), status: S.enumOf(['created', 'inTransit', 'delivered', 'cancelled', 'failed']), createdAt: TIME, ref: S.nullable(S.str(120)) } },
  },
  ops: {
    create: {
      args: S.obj({ orderId: ID, fulfilmentId: ID, location: S.str(40, { minLength: 1 }), ref: S.nullable(S.str(120, { minLength: 1 })) }),
      keyed: true, subjectArgs: ['orderId'],
      apply(db, a, ctx) { const shipmentId = db.nextId('SHP'); db.insert('shipments', { shipmentId, ...a, status: 'created', createdAt: ctx.now }); return { shipmentId }; },
    },
    cancel: {
      args: S.obj({ orderId: ID, shipmentId: ID }),
      keyed: true, subjectArgs: ['orderId'], reverses: 'carrier.create',
      apply(db, a) {
        const s = db.require('shipments', a.shipmentId);
        if (s.orderId !== a.orderId) throw new MockError(422, 'shipment-not-on-order');
        if (s.status === 'delivered') throw new MockError(409, 'already-delivered');
        if (s.status === 'cancelled') throw new MockError(409, 'already-cancelled');
        db.update('shipments', a.shipmentId, { status: 'cancelled' });
        return { shipmentId: a.shipmentId, status: 'cancelled' };
      },
    },
  },
});

export const fraud = defineSystem({
  id: 'fraud',
  description: 'Fraud screening; the verdict list is mock-internal.',
  latencyMinutes: 1,
  tables: { verdicts: { pk: 'orderId', fields: { orderId: ID, verdict: S.enumOf(['pass', 'review', 'reject']), score: S.int() }, hidden: true } },
  ops: {
    check: { args: S.obj({ orderId: ID }), readOnly: true, subjectArgs: ['orderId'], apply(db, a) { return { orderId: a.orderId, verdict: db.get('verdicts', a.orderId)?.verdict ?? 'pass' }; } },
  },
});

export const systems = Object.freeze([orders, inventory, billing, carrier, fraud]);
