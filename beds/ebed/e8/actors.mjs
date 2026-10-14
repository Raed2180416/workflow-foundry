// E8 actors (BED-CONTRACT v1.1 §4.4): the fraud analyst (human tasks) and the carriers (counterparties). Policies are
// keyed by (world, truth case, role, kind, ordinal) or by the fulfilment the arm booked, never by request text. Carriers
// react on-policy to the shipments an arm books: collection at the location's next collection run at least the
// cut-off after booking, guarded (H-29) so a shipment cancelled before its collection is never collected; then
// in-transit and delivery reports, or a collection failure, as the world's scenario for the fulfilment says. Repeats
// (W1) and out-of-order reports (W2) are world behaviour at d3 and above.
import { rng } from '../../lib/rng.mjs';
import { CARRIER_CODES, collectionRuns, iso } from './world.mjs';

const CUTOFF = 30;
const codeOf = (carrier, meaning) => CARRIER_CODES.find(c => c.carrier === carrier && c.meaning === meaning)?.code ?? meaning;

function answer(world, ctx) {
  if (ctx.kind !== 'fraudReview') return null;
  const t = world.truth.cases[ctx.case];
  if (!t || t.subject === null) return null;
  const r = rng('ebed/e8/analyst', world.id, ctx.case, ctx.ordinal);
  if (!t.review) return { value: { decision: 'approve' }, delayMinutes: r.int(30, 180), text: 'approve - nothing suspicious' };
  const delay = ctx.ordinal === 1 ? t.review.delay : r.int(30, 240);
  return { value: { decision: t.review.decision }, delayMinutes: delay, text: `${t.review.decision} - reviewed the order and the customer history` };
}

function counterparty(world, ctx) {
  if (ctx.effect.system !== 'carrier' || ctx.effect.op !== 'create') return null;
  const a = ctx.effect.args;
  const c = world.truth.objectCase?.[a.fulfilmentId];
  const sc = c ? world.truth.cases[c]?.fulfilments?.[a.fulfilmentId] : null;
  const loc = world.truth.locations.find(l => l.location === a.location);
  if (!sc || !loc) return null;                      // a shipment for no known fulfilment or location: the carrier stays silent
  const exact = (Date.parse(ctx.at) - Date.parse(world.t0)) / 60_000;          // commit time in minutes (may carry seconds)
  const commit = Math.ceil(exact);
  const R = collectionRuns(loc).find(m => m >= exact + CUTOFF) ?? null;
  if (R === null) return null;
  const r = rng('ebed/e8/carrier', world.id, a.fulfilmentId, ctx.ordinal);
  const shipmentId = ctx.result?.shipmentId;
  const row = status => ({ shipmentId, orderId: a.orderId, fulfilmentId: a.fulfilmentId, location: a.location, carrier: loc.carrier, status, createdAt: ctx.at, ref: a.ref ?? null });
  const msg = (meaning, reportedAt) => ({ type: 'carrier.status', source: 'carrier', quoteRef: true,
    payload: { carrier: loc.carrier, code: codeOf(loc.carrier, meaning), shipmentId, fulfilmentRef: a.fulfilmentId, reportedAt: iso(reportedAt) } });
  const g = statuses => ({ system: 'carrier', table: 'shipments', pk: shipmentId, field: 'status', in: statuses });
  const w = status => ({ system: 'carrier', table: 'shipments', row: row(status) });
  const steps = [];
  const at = m => iso(m);
  if (sc.info) steps.push({ at: at(commit + 5), guard: g(['created']), event: msg('info', commit + 5) });
  if (sc.scenario === 'collectionFailed') {
    steps.push({ at: at(R), guard: g(['created']), write: w('failed'), event: msg('collectionFailed', R) });
    if (sc.dup) steps.push({ at: at(R + r.int(5, 60)), guard: g(['failed']), event: msg('collectionFailed', R) });
    return { steps };
  }
  const T1 = R + sc.inTransitAfter, T2 = R + sc.transit;
  if (!sc.ooo) {
    steps.push({ at: at(R), guard: g(['created']), write: w('collected'), event: msg('collected', R) });
    steps.push({ at: at(T1), guard: g(['collected']), write: w('inTransit'), event: msg('inTransit', T1) });
    steps.push({ at: at(T2), guard: g(['collected', 'inTransit']), write: w('delivered'), event: msg('delivered', T2) });
  } else {
    // W2: the collection and in-transit reports are held up and reach the shop after the delivery report.
    steps.push({ at: at(R), guard: g(['created']), write: w('collected') });
    steps.push({ at: at(T1), guard: g(['collected']), write: w('inTransit') });
    steps.push({ at: at(T2), guard: g(['collected', 'inTransit']), write: w('delivered'), event: msg('delivered', T2) });
    steps.push({ at: at(T2 + r.int(10, 180)), guard: g(['delivered']), event: msg('collected', R) });
    steps.push({ at: at(T2 + r.int(200, 400)), guard: g(['delivered']), event: msg('inTransit', T1) });
  }
  if (sc.dup) {
    steps.push({ at: at(R + r.int(5, 60)), guard: g(['collected', 'inTransit', 'delivered']), event: msg('collected', R) });
    steps.push({ at: at(T2 + r.int(5, 120)), guard: g(['delivered']), event: msg('delivered', T2) });
  }
  return { steps };
}

export const actors = Object.freeze({ answer, counterparty });
