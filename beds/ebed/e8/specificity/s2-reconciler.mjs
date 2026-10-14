// E8 specificity solver S2: "stateless reconciler" (written blind to the oracle, the world generator and the other
// solvers; it reads only spec/SPEC-E.md, the bed contract §3, the host README §2-§4, systems.mjs and output.mjs). $0, no
// model calls, no wall clock, no randomness, no dependencies.
//
// DESIGN
// - One order instance per order (started by `order.placed` or by a go-live `migration`). Every other inbound message
//   starts a short-lived instance that normalises the id it names (§3.1), finds the order's open instance with
//   ctx.instances({ subject }) and merges into it; if the order has no open instance (unknown order, or an order whose
//   instance already closed because it ended) the message changes nothing and the instance closes at once.
// - The carry is a minimal fact log of what cannot be re-read from a system of record: the placed order, the edition
//   chosen at p, the allocation and fraud verdict reads, the review tasks created and their events, customer actions and
//   carrier reports (with their times), permanent step failures, renames learned from 400s, and the keys still in
//   flight (emitted, result not yet seen). Everything else is re-derived on every tick:
//     facts --derive()--> the business timeline (cleared, counted action, ready, R6 cancel, R3 timeout, per-fulfilment
//     end, order outcome), all as times;
//     timeline + records (ctx.query of orders, fulfilments, reservations, charges, refunds, shipments, notifications;
//     ctx.status(system, key) for pending/committed keys) --plan()--> the effects that are due now, plus one obligation
//     for the earliest future due time.
//   An effect is "done" when the record shows it (or its key is committed), "busy" while its key is in flight or
//   pending, and emitted only when its chosen due time has come. Keys are deterministic per logical effect, so a re-issue
//   after a 400 reuses the key.
// - Timing: deliberately LATE inside each window (20-45 minutes after the window opens), one saga step per tick (each
//   step waits for the previous step's record), never `after`. Exceptions: reads are issued at once (they are not
//   effects), a review task is re-asked at once, a shipment is cancelled at once on a counted customer cancel (R6.2), and
//   compensation steps after the first follow each other as soon as the previous one shows in the records.
//   Delays: create p+20; review task p+30; fraud cancel +30; R3.1 cleared+25; amend/cancel/refused +20; R3 timeout
//   D+30; R2 review timeout deadline+30; processing ready+25; reserve ready+45; charge last-reservation+30; ship
//   charge+30; dispatched/completed message+30; failure compensation failure+20; order outcome last-end+40.
// - Argument names come from api/<system>.schema.json on every tick (an F5 rename is followed before it bites); a 400
//   `field-renamed` that still arrives (rename between emission and a platform retry) is learned and the effect is
//   re-issued with the same key.
//
// READINGS where the spec could be read more than one way (section references are to SPEC-E)
//  1. R1.3 edition: the published edition (rulebook/<id>/edition.json) with the latest effectiveFrom <= the
//     Europe/Amsterdam date of p, chosen at the order's first tick and kept for the order's life. If no edition.json is
//     visible (older worlds), the lexicographically latest edition visible at that tick is used.
//  2. §3.1 / R1.1: p is the time of the order.placed event; the record's placedAt is that time, formatted with the
//     Europe/Amsterdam offset. Duplicates (same normalised id, open instance or recorded order) close without effect.
//  3. Business state is derived from event times, not from my own (late) effects. An order with no unavailable
//     fulfilment is processing from p (pass) or from the approving answer, even before I set `processing`.
//  4. "Stop the order" (R6.2): when a counted customer cancel arrives before I performed an obligation that only moves
//     the order forward (R4.1 `processing`, R3.1 `customerActionRequired` + `action-required`), that obligation is
//     dropped; only the cancellation effects follow. Likewise a customer action that counts before I performed R3.1
//     makes R3.1 moot (the customer has already acted), so R3.1 is skipped.
//  5. R6.2 "reported collected": a carrier report meaning collected, inTransit or delivered (each implies the carrier
//     has the goods) at or before the cancel's time. A collectionFailed report after such a report is ignored.
//  6. R6.2 applies to a cancel after a counted amend once the order is processing (R3.2's "later actions change
//     nothing" is read as concerning the R3 choice only). An amend for a processing order changes nothing (S5).
//  7. R6.3: cancel-refused is sent once per order, for the first refused cancel; a cancel for an order whose instance
//     already closed (order ended) gets nothing; unknown-order is never sent (both optional).
//  8. R6.4 / R3.2: a customer cancel before the order is cleared counts (R6.4, reason customer), even if the record
//     does not exist yet (the record is created first, then cancelled). An amend before clearing counts as the R3
//     action if it is at or before D; the order is then ready when it is cleared.
//  9. R2.2: an answer counts if it carries decision approve|reject and its time is <= the deadline (first task's
//     creation + fraudReviewHours); `late` is ignored (amended §3.4). My task dueAt is the deadline; an unusable,
//     rejected or withdrawn answer before the deadline is re-asked at once with a new task id.
// 10. Timeouts are taken strictly after their deadline (amended R2.2, R3.2, S1): R3 at D+30, R2 at deadline+30.
// 11. R5.1/R5.2: compensation runs shipment cancel -> refund (the charge's full amount) -> releases, each only for a
//     step the records show committed (S2), waiting while a key of that fulfilment is pending; then the status
//     (failed/cancelled) and the notification. A compensation step that fails permanently is not retried and the chain
//     continues. A shipment cancel refused as already-collected leaves that fulfilment to the carrier (not refunded,
//     not cancelled); the order then ends when that fulfilment ends.
// 12. R5.2 failure time: the attempt's time = result time - the system's latency; a carrier collectionFailed: the
//     message's time. Errors other than 400 that the platform delivers (402, retryable:false, other 4xx) fail the step.
// 13. R4.4: dispatched is due 30 min after the first collected or delivered report; completed 30 min after the
//     delivered report, after dispatched is recorded. inTransit/info change nothing.
// 14. R4.5: the event that ended the last fulfilment is its delivered report, failure time, or cancel time; an
//     unavailable fulfilment ends when it is cancelled by the amend.
// 15. Edge combinations the spec leaves open: an order cleared after D with no counted action skips R3.1 and times out
//     at once after clearing.
//
// Interface: createSolver() -> { id, tick(input, ctx) } (BED-CONTRACT v1.1 §3.1, host README §2).

const MIN = 60_000;
const HOUR = 60 * MIN;
const ORANK = { pending: 0, customerActionRequired: 1, processing: 2, completed: 3, failed: 3, cancelled: 3, timedOut: 3 };
const FRANK = { unavailable: 0, pending: 0, processing: 1, dispatched: 2, completed: 3, cancelled: 3, failed: 3 };
const DELAY = { create: 20, task: 30, fraudCancel: 30, r31: 25, custAct: 20, timeout: 30, reviewTimeout: 30, processing: 25,
  reserve: 45, charge: 30, ship: 30, carrier: 30, failComp: 20, outcome: 40, r62Rest: 10, refused: 20 };
const CANON = {
  'orders.create': ['orderId', 'customerId', 'placedAt', 'currency', 'items', 'fulfilments', 'totalMinor'],
  'orders.setStatus': ['orderId', 'fulfilmentId', 'status'],
  'inventory.allocate': ['orderId'],
  'inventory.reserve': ['orderId', 'fulfilmentId', 'location', 'items'],
  'inventory.reserve#item': ['key', 'sku', 'qty'],
  'inventory.release': ['orderId', 'fulfilmentId', 'sku'],
  'billing.charge': ['orderId', 'fulfilmentId', 'customerId', 'amountMinor', 'currency'],
  'billing.refund': ['orderId', 'fulfilmentId', 'amountMinor'],
  'carrier.create': ['orderId', 'fulfilmentId', 'location', 'ref'],
  'carrier.cancel': ['orderId', 'fulfilmentId'],
  'fraud.check': ['orderId'],
  'notify.send': ['to', 'about', 'template', 'text', 'ref'],
};
const ANSWER_SCHEMA = Object.freeze({ type: 'object', properties: { decision: { type: 'string', enum: ['approve', 'reject'] } }, required: ['decision'] });

// ---------------------------------------------------------------------------------------------------------------------
// time (Europe/Amsterdam: CET +01:00, CEST +02:00 from the last Sunday of March 01:00 UTC to the last Sunday of October)
const ms = s => Date.parse(s);
function lastSundayUtc(year, month) {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return Date.UTC(year, month, last.getUTCDate() - last.getUTCDay(), 1, 0, 0);
}
function amsOffset(t) {
  const y = new Date(t).getUTCFullYear();
  return t >= lastSundayUtc(y, 2) && t < lastSundayUtc(y, 9) ? 120 : 60;
}
const p2 = n => String(n).padStart(2, '0');
function iso(t) {
  const off = amsOffset(t);
  const d = new Date(t + off * MIN);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}+${p2(off / 60)}:00`;
}
const amsDate = t => iso(t).slice(0, 10);
const minOf = (...xs) => { const v = xs.filter(x => x !== null && x !== undefined); return v.length ? Math.min(...v) : null; };
const byAtId = (a, b) => (ms(a.at) - ms(b.at)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** §3.1: trim, drop a leading '#', upper-case. */
export function normId(s) {
  return String(s ?? '').trim().replace(/^#+/, '').trim().toUpperCase();
}

// ---------------------------------------------------------------------------------------------------------------------
// files
function makeEnv(ctx, cache) {
  const files = ctx.files ?? {};
  const json = path => {
    const t = files[path];
    if (typeof t !== 'string') return null;
    if (cache.has(t)) return cache.get(t);
    let v = null;
    try { v = JSON.parse(t); } catch { v = null; }
    if (cache.size > 200) cache.clear();
    cache.set(t, v);
    return v;
  };
  const editionIds = [...new Set(Object.keys(files).map(p => /^rulebook\/([^/]+)\//.exec(p)?.[1]).filter(Boolean))].sort();
  const env = {
    json,
    editionIds,
    editionFor(pMs) {
      const date = amsDate(pMs);
      const dated = editionIds.map(id => ({ id, from: json(`rulebook/${id}/edition.json`)?.effectiveFrom }))
        .filter(e => typeof e.from === 'string').map(e => ({ id: e.id, from: e.from.slice(0, 10) }));
      if (dated.length) {
        const ok = dated.filter(e => e.from <= date).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.id < b.id ? -1 : 1));
        if (ok.length) return ok.at(-1).id;
        return dated.sort((a, b) => (a.from < b.from ? -1 : 1))[0].id;
      }
      return editionIds.at(-1) ?? null;
    },
    policy(ed) {
      const p = json(`rulebook/${ed}/policy.json`) ?? {};
      return { cah: Number(p.customerActionHours ?? 4), frh: Number(p.fraudReviewHours ?? 24), cutoff: Number(p.collectionCutoffMinutes ?? 30) };
    },
    fee(ed, location) {
      const rows = json(`rulebook/${ed}/shipping-fees.json`) ?? [];
      return Number(rows.find(r => r.location === location)?.feeMinor ?? 0);
    },
    price(sku) {
      const rows = json('master/catalog.json') ?? [];
      return Number(rows.find(r => r.sku === sku)?.unitPriceMinor ?? 0);
    },
    email(customerId) {
      const rows = json('master/customers.json') ?? [];
      return rows.find(r => r.customerId === customerId)?.email ?? null;
    },
    meaning(ed, carrier, code) {
      const tables = [ed, ...editionIds.filter(x => x !== ed)].map(id => json(`rulebook/${id}/carrier-codes.json`) ?? []);
      for (const rows of tables) {
        const hit = rows.find(r => r.carrier === carrier && r.code === code)
          ?? rows.find(r => String(r.carrier).toUpperCase() === String(carrier).toUpperCase() && String(r.code).toUpperCase() === String(code).toUpperCase());
        if (hit) return hit.meaning;
      }
      return 'info';
    },
    latency(sys) { return Number(json(`api/${sys}.schema.json`)?.latencyMinutes ?? 1); },
    /** canonical arg name -> current name for one op (F5), from the API file plus renames learned from 400s. */
    names(sys, op, learned = {}, item = false) {
      const api = json(`api/${sys}.schema.json`);
      const opArgs = api?.ops?.[op]?.args;
      const canon = CANON[`${sys}.${op}${item ? '#item' : ''}`] ?? [];
      let props;
      if (!item) props = opArgs?.properties;
      else {
        const itemsName = env.names(sys, op, learned, false).items ?? 'items';
        props = opArgs?.properties?.[itemsName]?.items?.properties;
      }
      const map = {};
      if (!props) { for (const k of canon) map[k] = learned[k] ?? k; return map; }
      const present = Object.keys(props);
      const missing = canon.filter(k => !present.includes(k));
      const extra = present.filter(k => !canon.includes(k));
      for (const k of canon) if (present.includes(k)) map[k] = k;
      const free = new Set(extra);
      for (const k of missing) {
        const l = learned[k];
        if (l && free.has(l)) { map[k] = l; free.delete(l); }
      }
      let rest = missing.filter(k => !map[k]);
      if (rest.length === 1 && free.size === 1) { map[rest[0]] = [...free][0]; free.clear(); rest = []; }
      for (const k of rest) {
        const lk = k.toLowerCase();
        const cand = [...free].find(x => { const lx = x.toLowerCase().replace(/[^a-z0-9]/g, ''); return lx.includes(lk.replace(/minor$/, '')) || lk.includes(lx) || lx.startsWith(lk.slice(0, 4)); });
        if (cand) { map[k] = cand; free.delete(cand); } else map[k] = learned[k] ?? k;
      }
      return map;
    },
  };
  return env;
}

function mapArgs(env, c, sys, op, args) {
  const learned = c?.rn?.[`${sys}.${op}`] ?? {};
  const m = env.names(sys, op, learned, false);
  const out = {};
  for (const [k, v] of Object.entries(args)) out[m[k] ?? k] = v;
  if (sys === 'inventory' && op === 'reserve') {
    const learnedItem = c?.rn?.['inventory.reserve#item'] ?? {};
    const mi = env.names(sys, op, { ...learned, ...learnedItem }, true);
    const itemsName = m.items ?? 'items';
    out[itemsName] = args.items.map(it => { const o = {}; for (const [k, v] of Object.entries(it)) o[mi[k] ?? k] = v; return o; });
  }
  return out;
}

const K = {
  alloc: oid => `S2|alloc|${oid}`,
  fraud: oid => `S2|fraud|${oid}`,
  create: oid => `S2|create|${oid}`,
  st: (oid, fid, status) => `S2|st|${oid}|${fid ?? '-'}|${status}`,
  rsv: (fid, sku) => `S2|rsv|${fid}|${sku}`,
  rel: (fid, sku) => `S2|rel|${fid}|${sku}`,
  chg: fid => `S2|chg|${fid}`,
  rfd: fid => `S2|rfd|${fid}`,
  shp: fid => `S2|shp|${fid}`,
  shc: fid => `S2|shc|${fid}`,
  ntf: (about, template) => `S2|ntf|${about}|${template}`,
};
const keyParts = key => String(key ?? '').split('|');

// ---------------------------------------------------------------------------------------------------------------------
export function createSolver() {
  const cache = new Map();
  return {
    id: 's2-reconciler',
    tick(input, ctx) {
      const env = makeEnv(ctx, cache);
      const carry = input.carry;
      if (carry && carry.r === 'o') return orderTick(input, ctx, env, carry);
      const evs = [...(input.events ?? [])].sort(byAtId);
      const first = evs[0];
      if (!first) return { decisions: { subject: null }, carry: null };
      if (first.type === 'migration') {
        const c = fromMigration(first, env, ctx, input);
        if (!c) return { decisions: { subject: null }, carry: null, close: true };
        return orderTick(input, ctx, env, c, evs.slice(1));
      }
      if (first.type === 'order.placed') {
        const oid = normId(first.payload?.orderId);
        if (!oid) return { decisions: { subject: null }, carry: null, close: true };
        const open = openInstance(ctx, oid, input.instance);
        const recorded = safeQuery(ctx, 'orders.orders', { orderId: oid }).length > 0;
        if (open || recorded) return { decisions: { subject: oid }, carry: null, close: true };     // R1.4 duplicate
        const p = first.at;
        const c = newCarry(oid, p, { customerId: first.payload.customerId, currency: first.payload.currency, items: first.payload.items }, env.editionFor(ms(p)));
        return orderTick(input, ctx, env, c, evs.slice(1));
      }
      if (first.type === 'customer.action') {
        const oid = normId(first.payload?.orderRef);
        const open = oid ? openInstance(ctx, oid, input.instance) : null;
        if (open) return { decisions: { subject: oid }, merge: { into: open }, carry: null };
        const known = oid && safeQuery(ctx, 'orders.orders', { orderId: oid }).length > 0;
        return { decisions: { subject: known ? oid : null }, carry: null, close: true };
      }
      if (first.type === 'carrier.status') {
        const fid = normId(first.payload?.fulfilmentRef);
        const row = fid ? safeQuery(ctx, 'orders.fulfilments', { fulfilmentId: fid })[0] : null;
        const oid = row?.orderId ?? null;
        const open = oid ? openInstance(ctx, oid, input.instance) : null;
        if (open) return { decisions: { subject: oid }, merge: { into: open }, carry: null };
        return { decisions: { subject: oid }, carry: null, close: true };
      }
      return { decisions: { subject: null }, carry: null, close: true };
    },
  };
}

function safeQuery(ctx, table, where) {
  try { return ctx.query(table, { where }) ?? []; } catch { return []; }
}
function safeStatus(ctx, sys, key) {
  try { return ctx.status(sys, key); } catch { return 'not-found'; }
}
function openInstance(ctx, oid, self) {
  let rows = [];
  try { rows = ctx.instances({ subject: oid }) ?? []; } catch { rows = []; }
  return rows.find(r => r.instance !== self)?.instance ?? null;
}

function newCarry(oid, p, pl, ed) {
  return { r: 'o', oid, p, pl, ed, alloc: null, verdict: null, cl0: null, ready0: null, tasks: [], tev: [], acts: [], rep: {}, fails: {},
    blk: {}, fl: {}, rb: [], rn: {}, bad: {}, pf: {}, wake: null };
}

function fromMigration(ev, env, ctx, input) {
  const recs = ev.payload?.records ?? {};
  const raw = [...(ev.payload?.events ?? [])].sort(byAtId);
  const placed = raw.find(e => e.type === 'order.placed');
  const ordRow = (recs['orders.orders'] ?? [])[0] ?? null;
  const oid = normId(placed?.payload?.orderId ?? ordRow?.orderId);
  if (!oid) return null;
  const p = placed?.at ?? ordRow?.placedAt;
  const pl = { customerId: placed?.payload?.customerId ?? ordRow?.customerId, currency: placed?.payload?.currency ?? ordRow?.currency, items: placed?.payload?.items ?? ordRow?.items };
  const c = newCarry(oid, p, pl, env.editionFor(ms(p)));
  c.mig = true;
  // The order's current record (the system of record is the truth; the export is the same data at t0).
  const live = safeQuery(ctx, 'orders.orders', { orderId: oid })[0] ?? ordRow;
  if (live && live.status !== 'pending') { c.cl0 = p; c.verdict = 'pass'; }
  if (live && ORANK[live.status] >= 2) c.ready0 = p;
  for (const e of raw) if (e.type !== 'order.placed') c.pre = [...(c.pre ?? []), e];
  return c;
}

// ---------------------------------------------------------------------------------------------------------------------
function readDb(ctx, oid) {
  const order = safeQuery(ctx, 'orders.orders', { orderId: oid })[0] ?? null;
  const fuls = safeQuery(ctx, 'orders.fulfilments', { orderId: oid });
  return {
    order, fuls,
    res: safeQuery(ctx, 'inventory.reservations', { orderId: oid }),
    chg: safeQuery(ctx, 'billing.charges', { orderId: oid }),
    rfd: safeQuery(ctx, 'billing.refunds', { orderId: oid }),
    shp: safeQuery(ctx, 'carrier.shipments', { orderId: oid }),
    ntf: safeQuery(ctx, 'notify.notifications', { about: { in: [oid, ...fuls.map(f => f.fulfilmentId)] } }),
  };
}

function applyEvent(c, ev, env, db, migrating = false) {
  const p = ev.payload ?? {};
  switch (ev.type) {
    case 'effect.result': return applyResult(c, ev, env);
    case 'timer.fired': if (p.obligationId === 'wake') c.wake = null; return;
    case 'customer.action': {
      if (normId(p.orderRef) !== c.oid) return;
      if (p.action !== 'amend' && p.action !== 'cancel') return;
      if (c.acts.some(a => a.id === ev.id)) return;
      // R6.2 / S4 / S6: has the carrier collected any of the order's shipments at or before this action? Decided now, from
      // the system of record (a shipment already collected, in transit or delivered) and from reports whose reportedAt
      // is at or before the action; frozen in the fact so a later report cannot flip the decision.
      const a = ms(ev.at);
      const reported = Object.values(c.rep).some(r => ['col', 'tr', 'del'].some(s => r[s] && r[s].r <= a));
      const recorded = !migrating && db.shp.some(s => ['collected', 'inTransit', 'delivered'].includes(s.status));
      c.acts.push({ id: ev.id, at: ev.at, a: p.action, col: reported || recorded });
      return;
    }
    case 'carrier.status': {
      const fid = normId(p.fulfilmentRef);
      if (!fid) return;
      const fulIds = db.fuls.length ? db.fuls.map(f => f.fulfilmentId) : (c.alloc ?? []).map(f => f.fulfilmentId);
      if (!fulIds.includes(fid)) return;
      // §3.3: a message about a shipment I cancelled changes nothing.
      if (db.shp.some(s => s.shipmentId === p.shipmentId && s.status === 'cancelled')) return;
      const m = env.meaning(c.ed, p.carrier, p.code);
      const slot = { collected: 'col', inTransit: 'tr', delivered: 'del', collectionFailed: 'cf' }[m];
      if (!slot) return;
      const r = (c.rep[fid] ??= {});
      const t = ms(ev.at);                                   // the message's time (R4.4 / R5.2 windows)
      const rt = Number.isFinite(ms(p.reportedAt)) ? ms(p.reportedAt) : t;   // the carrier's own time of the report
      if (!r[slot]) r[slot] = { a: t, r: rt };
      else { r[slot].a = Math.min(r[slot].a, t); r[slot].r = Math.min(r[slot].r, rt); }
      return;
    }
    case 'humanTask.answered': {
      const d = p.answer && typeof p.answer === 'object' && (p.answer.decision === 'approve' || p.answer.decision === 'reject') ? p.answer.decision : null;
      c.tev.push({ id: p.taskId, t: 'ans', at: ev.at, d });
      return;
    }
    case 'humanTask.answerRejected': c.tev.push({ id: p.taskId, t: 'rej', at: ev.at, d: null }); return;
    case 'humanTask.withdrawn': c.tev.push({ id: p.taskId, t: 'wd', at: ev.at, d: null }); return;
    case 'humanTask.timeout': c.tev.push({ id: p.taskId, t: 'to', at: ev.at, d: null }); return;
    default: return;
  }
}

function learn400(c, sys, op, err) {
  if (err && err.reason === 'field-renamed' && typeof err.field === 'string' && typeof err.renamedTo === 'string') {
    const isItem = sys === 'inventory' && op === 'reserve' && !['orderId', 'fulfilmentId', 'location', 'items'].includes(err.field);
    const slot = `${sys}.${op}${isItem ? '#item' : ''}`;
    (c.rn[slot] ??= {})[err.field] = err.renamedTo;
  }
}

function applyResult(c, ev, env) {
  const r = ev.payload ?? {};
  const sys = r.system, op = r.op;
  const at = ms(ev.at) - env.latency(sys) * MIN;          // the time of the (final) attempt
  if (sys === 'inventory' && op === 'reserve') {
    const batch = c.rb.shift() ?? { fid: null, keys: [] };
    if (!Array.isArray(r.items)) {
      for (const k of batch.keys) {
        delete c.fl[k];
        if (r.error?.code === 400) { c.bad[k] = (c.bad[k] ?? 0) + 1; }
        else if (!isRetryableErr(r)) failStep(c, batch.fid, at, 'reserve');
      }
      if (r.error?.code === 400) learn400(c, sys, op, r.error);
      return;
    }
    for (const it of r.items) {
      const key = it.key ?? null;
      if (key) delete c.fl[key];
      if (it.status === 'ok') continue;
      if (it.status === 'unknown' || it.status === 'rate-limited' || it.error?.retryable === true) continue;   // reconcile from records
      if (it.error?.code === 400) { if (key) c.bad[key] = (c.bad[key] ?? 0) + 1; learn400(c, sys, op, it.error); continue; }
      failStep(c, keyParts(key)[2] ?? batch.fid, at, 'reserve');
    }
    for (const k of batch.keys) if (!r.items.some(it => it.key === k)) delete c.fl[k];
    return;
  }
  const key = r.key;
  if (key) delete c.fl[key];
  if (op === 'allocate') { if (r.status === 'ok' && Array.isArray(r.result?.fulfilments)) c.alloc = r.result.fulfilments; else c.bad[key] = (c.bad[key] ?? 0) + 1; return; }
  if (sys === 'fraud' && op === 'check') { if (r.status === 'ok' && r.result?.verdict) c.verdict = r.result.verdict; else c.bad[key] = (c.bad[key] ?? 0) + 1; return; }
  if (r.status === 'ok' || !key) return;
  if (r.status === 'unknown' || r.status === 'rate-limited' || r.error?.retryable === true) return;    // reconcile from records
  if (r.error?.code === 400) { c.bad[key] = (c.bad[key] ?? 0) + 1; learn400(c, sys, op, r.error); return; }
  const parts = keyParts(key);
  const kind = parts[1];
  if (kind === 'chg' || kind === 'shp') { failStep(c, parts[2], at, kind === 'chg' ? 'charge' : 'ship'); return; }
  if (kind === 'shc' && r.error?.reason === 'already-collected') { c.blk[parts[2]] = at; return; }
  c.pf[key] = 1;                                           // permanent failure of a status, notification or compensation step
}
const isRetryableErr = r => r.status === 'unknown' || r.status === 'rate-limited' || r.error?.retryable === true;
function failStep(c, fid, at, step) {
  if (!fid) return;
  if (!c.fails[fid] || at < c.fails[fid].at) c.fails[fid] = { at, step };
}

// ---------------------------------------------------------------------------------------------------------------------
/** The business timeline from the facts (all times in ms). */
function derive(c, db, now, pol) {
  const P = ms(c.p);
  const D = P + pol.cah * HOUR;
  const fuls = db.fuls.length ? db.fuls
    : (c.alloc ?? []).map(f => ({ fulfilmentId: f.fulfilmentId, location: f.location, items: f.items, status: f.location === null ? 'unavailable' : 'pending' }));
  const unav = fuls.filter(f => f.location === null).map(f => f.fulfilmentId);
  const avail = fuls.filter(f => f.location !== null).map(f => f.fulfilmentId);
  const hasUnav = unav.length > 0;
  const known = fuls.length > 0;

  // R2 fraud
  let cleared = null, fraudEnd = null, review = null;
  if (c.cl0 !== null) cleared = ms(c.cl0);
  else if (c.verdict === 'pass') cleared = P;
  else if (c.verdict === 'reject') fraudEnd = { at: P, incl: true, due: P + DELAY.fraudCancel * MIN, reason: 'fraud' };
  else if (c.verdict === 'review' && c.tasks.length) {
    const first = ms(c.tasks[0].at);
    const dl = first + pol.frh * HOUR;
    review = { first, dl };
    const ans = c.tev.filter(e => e.t === 'ans' && e.d && ms(e.at) <= dl).sort(byAtId)[0] ?? null;
    review.ans = ans;
    if (ans && ans.d === 'approve') cleared = ms(ans.at);
    else if (ans) fraudEnd = { at: ms(ans.at), incl: true, due: ms(ans.at) + DELAY.fraudCancel * MIN, reason: 'fraud' };
    else if (now > dl) fraudEnd = { at: dl, incl: false, due: dl + DELAY.reviewTimeout * MIN, reason: 'fraud-review-timeout' };
  }
  const fraudEndBy = a => fraudEnd && (fraudEnd.incl ? fraudEnd.at <= a : fraudEnd.at < a);

  // carrier reports (message times)
  const rep = fid => c.rep[fid] ?? {};
  const postCol = fid => minOf(rep(fid).col?.a, rep(fid).tr?.a, rep(fid).del?.a);

  // per-fulfilment end of an available fulfilment, given an R6.2 cancel time (or null)
  const fulEnd = (fid, r62) => {
    const rp = rep(fid);
    let failAt = c.fails[fid] ? c.fails[fid].at : null;
    if (rp.cf && (postCol(fid) === null || postCol(fid) > rp.cf.a)) failAt = minOf(failAt, rp.cf.a);
    const cands = [];
    if (failAt !== null) cands.push({ kind: 'failed', at: failAt, o: 0 });
    if (rp.del) cands.push({ kind: 'completed', at: rp.del.a, o: 1 });
    if (r62 !== null && r62 !== undefined && !c.blk[fid]) cands.push({ kind: 'cancelled', at: r62, o: 2 });
    cands.sort((a, b) => a.at - b.at || a.o - b.o);
    return cands[0] ?? null;
  };

  // R3 / R6 customer actions, in time order
  let counted = null, cancel = null, refusedAt = null;
  const readyOf = () => {
    if (c.ready0 !== null) return ms(c.ready0);
    if (cleared === null) return null;
    if (!hasUnav) return cleared;
    if (counted && counted.a === 'amend' && avail.length) return Math.max(counted.at, cleared);
    return null;
  };
  const outcomeOf = r62 => {
    const ready = readyOf();
    if (ready === null || !avail.length) return null;
    const ends = avail.map(f => fulEnd(f, r62));
    if (ends.some(e => e === null)) return null;
    const at = Math.max(...ends.map(e => e.at), ...(hasUnav && counted ? [counted.at] : []));
    const kind = ends.some(e => e.kind === 'completed') ? 'completed' : ends.some(e => e.kind === 'failed') ? 'failed' : 'cancelled';
    return { at, kind };
  };
  const r3Done = c.ready0 !== null;
  for (const act of [...c.acts].sort(byAtId)) {
    const a = ms(act.at);
    if (cancel && cancel.at <= a) continue;
    if (fraudEndBy(a)) continue;
    const isCleared = cleared !== null && cleared <= a;
    if (!isCleared) {
      if (act.a === 'cancel') { cancel = { at: a, kind: 'R61', reason: 'customer', due: a + DELAY.custAct * MIN }; continue; }
      if (hasUnav && !counted && !r3Done && a <= D) {
        counted = { a: 'amend', at: a };
        if (!avail.length) cancel = { at: a, kind: 'R61', reason: 'nothing-available', due: a + DELAY.custAct * MIN };
      }
      continue;
    }
    if (hasUnav && !counted && !r3Done) {
      if (a > D || cleared > D) continue;                  // the order timed out at D (S5)
      counted = { a: act.a, at: a };
      if (act.a === 'cancel') cancel = { at: a, kind: 'R61', reason: 'customer', due: a + DELAY.custAct * MIN };
      else if (!avail.length) cancel = { at: a, kind: 'R61', reason: 'nothing-available', due: a + DELAY.custAct * MIN };
      continue;
    }
    if (act.a !== 'cancel') continue;                      // S5: an amend now changes nothing
    const ready = readyOf();
    if (ready === null || ready > a) continue;
    const out = outcomeOf(null);
    if (colAt !== null && colAt <= a) { refusedAt ??= a; continue; }   // R6.3 (S4: a report in the same instant wins)
    if (out && out.at <= a) continue;                      // already ended
    cancel = { at: a, kind: 'R62', reason: 'customer', due: a };
  }

  // R3.2 timeout
  let timeout = null;
  if (hasUnav && !r3Done && cleared !== null && !counted && !(cancel && cancel.at <= Math.max(D, cleared)) && !fraudEnd) {
    const at = Math.max(D, cleared);
    timeout = { at, due: at + DELAY.timeout * MIN, effective: now > at };
  }

  // the order's end (earliest wins)
  const ready = (cancel && cancel.kind === 'R61') || fraudEnd ? null : readyOf();
  const r62 = cancel && cancel.kind === 'R62' ? cancel.at : null;
  const ends = {};
  if (ready !== null) for (const f of avail) ends[f] = fulEnd(f, r62);
  const outcome = ready !== null && r62 === null ? outcomeOf(null) : null;
  return { P, D, fuls, unav, avail, hasUnav, known, cleared, fraudEnd, review, counted, cancel, refusedAt, timeout, ready, r62, ends, outcome, colAt };
}

// ---------------------------------------------------------------------------------------------------------------------
function orderTick(input, ctx, env, c, extraEvents = null) {
  const now = ms(input.now);
  const events = extraEvents ?? [...(input.events ?? [])].sort(byAtId);
  const db0 = readDb(ctx, c.oid);
  if (c.pre) { for (const e of c.pre) applyEvent(c, e, env, db0); delete c.pre; }
  // carrier reports before customer actions at the same instant (S4); results first so failures are known
  const order = { 'effect.result': 0, 'carrier.status': 1, 'customer.action': 2 };
  for (const ev of [...events].sort((a, b) => (ms(a.at) - ms(b.at)) || ((order[a.type] ?? 1) - (order[b.type] ?? 1)) || (a.id < b.id ? -1 : 1))) applyEvent(c, ev, env, db0);
  const db = db0;
  const pol = env.policy(c.ed);
  const d = derive(c, db, now, pol);
  const pl = planOrder(input, ctx, env, c, db, d, now, pol);
  const out = { decisions: { subject: c.oid }, carry: c };
  if (pl.effects.length) out.effects = pl.effects;
  if (pl.tasks.length) out.humanTasks = pl.tasks;
  const next = pl.wakes.length ? Math.min(...pl.wakes) : null;
  const obl = {};
  if (next !== null && iso(next) !== c.wake) { obl.upsert = [{ id: 'wake', kind: 'reconcile', anchor: 'next-due', dueAt: iso(next), onDue: 'reconcile' }]; c.wake = iso(next); }
  if (next === null && c.wake) { obl.cancel = ['wake']; c.wake = null; }
  if (obl.upsert || obl.cancel) out.obligations = obl;
  if (pl.closable && !pl.effects.length && !pl.tasks.length && !Object.keys(c.fl).length) { out.close = true; delete out.obligations; }
  return out;
}

function planOrder(input, ctx, env, c, db, d, now, pol) {
  const oid = c.oid;
  const effects = [], tasks = [], wakes = [];
  let work = false;                                        // anything still outstanding
  const stat = (sys, key) => safeStatus(ctx, sys, key);
  const busy = (sys, key) => c.fl[key] !== undefined || stat(sys, key) === 'pending';
  const mk = (sys, op, args, key) => ({ ...(key ? { key } : {}), system: sys, op, args: mapArgs(env, c, sys, op, args) });
  /** Emit `build()` under `key` at `due` unless done/busy. Returns 'done' | 'wait'. */
  const want = (sys, key, due, build) => {
    if (c.pf[key]) return 'done';
    if (stat(sys, key) === 'committed') return 'done';
    work = true;
    if (busy(sys, key) || (c.bad[key] ?? 0) >= 3) return 'wait';
    if (due > now) { wakes.push(due); return 'wait'; }
    effects.push(build());
    c.fl[key] = input.now;
    return 'wait';
  };
  const later = t => { work = true; if (t > now) wakes.push(t); };

  const orderRow = db.order;
  const fRow = fid => db.fuls.find(f => f.fulfilmentId === fid) ?? null;
  const fFinal = fid => { const r = fRow(fid); return !r || FRANK[r.status] === 3 || ['cancelled', 'failed', 'completed'].some(s => c.pf[K.st(oid, fid, s)]); };
  const oRank = () => (orderRow ? ORANK[orderRow.status] ?? 0 : -1);
  const setF = (fid, status, due) => {
    const r = fRow(fid);
    if (!r) return 'wait';
    if (FRANK[r.status] >= FRANK[status] || r.status === status) return 'done';
    if (FRANK[r.status] === 3) return 'done';
    const key = K.st(oid, fid, status);
    return want('orders', key, due, () => mk('orders', 'setStatus', { orderId: oid, fulfilmentId: fid, status }, key));
  };
  const setO = (status, due) => {
    if (!orderRow) return 'wait';
    if (ORANK[orderRow.status] >= ORANK[status] || orderRow.status === status) return 'done';
    const key = K.st(oid, null, status);
    return want('orders', key, due, () => mk('orders', 'setStatus', { orderId: oid, fulfilmentId: null, status }, key));
  };
  const customerId = orderRow?.customerId ?? c.pl.customerId;
  const notify = (about, template, due, text) => {
    if (db.ntf.some(n => n.about === about && n.template === template)) return 'done';
    const key = K.ntf(about, template);
    const to = env.email(customerId);
    if (!to) return 'done';
    return want('notify', key, due, () => mk('notify', 'send', { to, about, template, text, ref: null }, key));
  };

  // ---- reads (not effects; issued at once)
  if (!orderRow && !c.alloc) {
    const key = K.alloc(oid);
    work = true;
    if (c.fl[key] === undefined && (c.bad[key] ?? 0) < 5) { effects.push({ key, system: 'inventory', op: 'allocate', args: mapArgs(env, c, 'inventory', 'allocate', { orderId: oid }) }); c.fl[key] = input.now; }
  }
  if (!c.verdict && c.cl0 === null) {
    const key = K.fraud(oid);
    work = true;
    if (c.fl[key] === undefined && (c.bad[key] ?? 0) < 5) { effects.push({ key, system: 'fraud', op: 'check', args: mapArgs(env, c, 'fraud', 'check', { orderId: oid }) }); c.fl[key] = input.now; }
  }

  // ---- R1.1 record the order
  if (!orderRow) {
    work = true;
    if (c.alloc) {
      const ed = c.ed;
      const fulfilments = c.alloc.map(f => ({ fulfilmentId: f.fulfilmentId, location: f.location ?? null, items: f.items,
        amountMinor: f.items.reduce((s, it) => s + it.qty * env.price(it.sku), 0) + (f.location ? env.fee(ed, f.location) : 0) }));
      const totalMinor = fulfilments.reduce((s, f) => s + f.amountMinor, 0);
      const key = K.create(oid);
      want('orders', key, d.P + DELAY.create * MIN, () => mk('orders', 'create', { orderId: oid, customerId: c.pl.customerId, placedAt: iso(d.P),
        currency: c.pl.currency, items: c.pl.items, fulfilments, totalMinor }, key));
    }
    return { effects, tasks, wakes, closable: false };
  }

  // ---- R2.2 review tasks
  const orderEnded = () => ORANK[orderRow.status] === 3;
  if (c.verdict === 'review' && c.cl0 === null && !d.cancel && !d.review?.ans && !orderEnded()) {
    if (!c.tasks.length) {
      const due = d.P + DELAY.task * MIN;
      work = true;
      if (due > now) wakes.push(due);
      else tasks.push(reviewTask(c, now, now + pol.frh * HOUR));
    } else if (now <= d.review.dl) {
      const last = c.tasks.at(-1);
      const closed = c.tev.some(e => e.id === last.id && (e.t === 'rej' || e.t === 'wd' || e.t === 'to' || (e.t === 'ans' && !e.d)));
      work = true;
      if (closed && now < d.review.dl) tasks.push(reviewTask(c, now, d.review.dl));
      wakes.push(d.review.dl + DELAY.reviewTimeout * MIN);
    }
  }

  // ---- the order's end by R6.1 (fraud, customer before processing, nothing available) or R3.2 timeout
  const r61 = d.fraudEnd && !(d.cancel && d.cancel.at <= d.fraudEnd.at)
    ? { at: d.fraudEnd.at, due: d.fraudEnd.due, reason: d.fraudEnd.reason }
    : d.cancel && d.cancel.kind === 'R61' ? { at: d.cancel.at, due: d.cancel.due, reason: d.cancel.reason } : null;
  if (r61) {
    let all = true;
    for (const f of d.fuls) if (!fFinal(f.fulfilmentId)) { all = false; setF(f.fulfilmentId, 'cancelled', r61.due); }
    if (all) {
      setO('cancelled', r61.due);
      notify(oid, 'order-cancelled', r61.due, `Order ${oid} has been cancelled (reason: ${r61.reason}).`);
    } else later(r61.due);
    return finish();
  }
  if (d.timeout) {
    if (d.timeout.effective) {
      const due = d.timeout.due;
      let all = true;
      for (const f of d.fuls) if (!fFinal(f.fulfilmentId)) { all = false; setF(f.fulfilmentId, 'cancelled', due); }
      if (all) {
        setO('timedOut', due);
        notify(oid, 'order-timed-out', due, `Order ${oid} timed out: no amend or cancel was received in time.`);
      }
      return finish();
    }
    later(d.timeout.due);
  }

  // ---- R3.1 (skipped once a customer action counted: the customer has acted, reading 4)
  if (d.hasUnav && d.cleared !== null && c.ready0 === null && !d.counted && !d.cancel && d.cleared <= d.D) {
    const due = d.cleared + DELAY.r31 * MIN;
    setO('customerActionRequired', due);
    notify(oid, 'action-required', due, `Some items of order ${oid} are unavailable: please amend or cancel the order.`);
  }
  // ---- R3.2 amend: cancel the unavailable fulfilments
  if (d.counted && d.counted.a === 'amend') {
    const due = d.counted.at + DELAY.custAct * MIN;
    for (const fid of d.unav) if (!fFinal(fid)) setF(fid, 'cancelled', due);
  }

  if (d.ready === null) return finish();

  // ---- R4.1 processing (dropped if a counted cancel came first, reading 4)
  const stopped = d.r62 !== null;
  if (!stopped) {
    const due = d.ready + DELAY.processing * MIN;
    setO('processing', due);
    for (const fid of d.avail) { const r = fRow(fid); if (r && r.status === 'pending') setF(fid, 'processing', due); }
  }

  // ---- per fulfilment: saga, carrier, failure
  for (const fid of d.avail) {
    const r = fRow(fid);
    if (!r) continue;
    const end = d.ends[fid];
    const res = db.res.filter(x => x.fulfilmentId === fid);
    const active = res.filter(x => x.status === 'active');
    const charge = db.chg.find(x => x.fulfilmentId === fid) ?? null;
    const ships = db.shp.filter(x => x.fulfilmentId === fid).sort((a, b) => (a.shipmentId < b.shipmentId ? -1 : 1));
    const ship = ships.at(-1) ?? null;
    const rp = c.rep[fid] ?? {};

    if (end && end.kind === 'failed') {
      const due = end.at + DELAY.failComp * MIN;
      if (compensate(fid, due, due, { noShipCancel: rp.cf !== undefined }) === true) {
        setF(fid, 'failed', due);
        notify(fid, 'fulfilment-failed', due, `Fulfilment ${fid} of order ${oid} failed.`);
      }
      continue;
    }
    if (end && end.kind === 'cancelled') {
      const hasShipToCancel = ship && ship.status === 'created';
      const dueRest = hasShipToCancel ? end.at : end.at + DELAY.r62Rest * MIN;
      if (compensate(fid, end.at, dueRest, {}) === true) setF(fid, 'cancelled', dueRest);
      continue;
    }
    // carrier reports (completed end included)
    const dispFrom = minOf(rp.col, rp.del);
    if (dispFrom !== null) {
      const s1 = setF(fid, 'dispatched', dispFrom + DELAY.carrier * MIN);
      if (s1 === 'done' && rp.del !== undefined) setF(fid, 'completed', rp.del + DELAY.carrier * MIN);
      continue;
    }
    if (end || stopped || FRANK[r.status] < 1) continue;
    // saga step 1: reserve
    const items = r.items ?? [];
    const missing = items.filter(it => !active.some(x => x.sku === it.sku));
    if (missing.length) {
      if (res.some(x => x.status === 'released')) continue;
      const keys = missing.map(it => K.rsv(fid, it.sku));
      work = true;
      if (keys.some(k => busy('inventory', k))) continue;
      const send = missing.filter(it => !c.pf[K.rsv(fid, it.sku)] && (c.bad[K.rsv(fid, it.sku)] ?? 0) < 3);
      const due = d.ready + DELAY.reserve * MIN;
      if (due > now) { wakes.push(due); continue; }
      if (!send.length) continue;
      const sendKeys = send.map(it => K.rsv(fid, it.sku));
      effects.push(mk('inventory', 'reserve', { orderId: oid, fulfilmentId: fid, location: r.location, items: send.map(it => ({ key: K.rsv(fid, it.sku), sku: it.sku, qty: it.qty })) }, null));
      for (const k of sendKeys) c.fl[k] = input.now;
      c.rb.push({ fid, keys: sendKeys });
      continue;
    }
    // saga step 2: charge
    if (!charge) {
      const cR = Math.max(...active.map(x => ms(x.at)));
      const key = K.chg(fid);
      want('billing', key, cR + DELAY.charge * MIN, () => mk('billing', 'charge', { orderId: oid, fulfilmentId: fid, customerId, amountMinor: r.amountMinor, currency: orderRow.currency }, key));
      continue;
    }
    // saga step 3: ship
    if (!ship) {
      const key = K.shp(fid);
      want('carrier', key, ms(charge.at) + DELAY.ship * MIN, () => mk('carrier', 'create', { orderId: oid, fulfilmentId: fid, location: r.location, ref: `S2:${fid}` }, key));
      continue;
    }
    work = true;                                           // booked: waiting for the carrier
  }

  // ---- R6.2: unavailable fulfilments, then the order
  if (stopped) {
    for (const fid of d.unav) if (!fFinal(fid)) setF(fid, 'cancelled', d.r62 + DELAY.r62Rest * MIN);
    if (d.fuls.every(f => fFinal(f.fulfilmentId))) {
      const due = d.r62 + DELAY.r62Rest * MIN;
      if (Object.values(d.ends).some(e => e && e.kind === 'completed') && Object.keys(c.blk).length) setO('completed', due);
      else {
        setO('cancelled', due);
        notify(oid, 'order-cancelled', due, `Order ${oid} has been cancelled at the customer's request.`);
      }
    } else work = true;
  }
  // ---- R6.3 refused cancel
  if (d.refusedAt !== null) notify(oid, 'cancel-refused', d.refusedAt + DELAY.refused * MIN, `Order ${oid} can no longer be cancelled: it has been collected by the carrier.`);
  // ---- R4.5 outcome
  if (!stopped && d.outcome) {
    if (d.fuls.every(f => fFinal(f.fulfilmentId))) setO(d.outcome.kind, d.outcome.at + DELAY.outcome * MIN);
    else work = true;
  }
  return finish();

  function finish() {
    const final = orderRow && ORANK[orderRow.status] === 3 && d.fuls.every(f => fFinal(f.fulfilmentId));
    return { effects, tasks, wakes, closable: !!final && !work };
  }

  /** R5.1 for one fulfilment: true when every committed step is undone. */
  function compensate(fid, dueShip, dueRest, { noShipCancel = false } = {}) {
    const res = db.res.filter(x => x.fulfilmentId === fid);
    const active = res.filter(x => x.status === 'active');
    const charge = db.chg.find(x => x.fulfilmentId === fid) ?? null;
    const ship = db.shp.filter(x => x.fulfilmentId === fid).sort((a, b) => (a.shipmentId < b.shipmentId ? -1 : 1)).at(-1) ?? null;
    if (busy('carrier', K.shp(fid))) { work = true; return false; }
    if (ship && ship.status === 'created' && !noShipCancel && !c.blk[fid] && !c.pf[K.shc(fid)]) {
      want('carrier', K.shc(fid), dueShip, () => mk('carrier', 'cancel', { orderId: oid, fulfilmentId: fid }, K.shc(fid)));
      return false;
    }
    if (c.blk[fid]) return 'blocked';
    if (busy('billing', K.chg(fid))) { work = true; return false; }
    const refunded = db.rfd.some(x => x.fulfilmentId === fid) || (charge && charge.refundedMinor >= charge.amountMinor);
    if (charge && !refunded && !c.pf[K.rfd(fid)]) {
      want('billing', K.rfd(fid), dueRest, () => mk('billing', 'refund', { orderId: oid, fulfilmentId: fid, amountMinor: charge.amountMinor }, K.rfd(fid)));
      return false;
    }
    const rf = fRow(fid);
    const rkeys = (rf?.items ?? []).map(it => K.rsv(fid, it.sku));
    if (rkeys.some(k => busy('inventory', k))) { work = true; return false; }
    const todo = active.filter(x => !c.pf[K.rel(fid, x.sku)]);
    if (todo.length) {
      for (const x of todo) want('inventory', K.rel(fid, x.sku), dueRest, () => mk('inventory', 'release', { orderId: oid, fulfilmentId: fid, sku: x.sku }, K.rel(fid, x.sku)));
      return false;
    }
    return true;
  }
}

function reviewTask(c, now, deadline) {
  const id = `S2-fraud-${c.oid}-${c.tasks.length + 1}`;
  c.tasks.push({ id, at: iso(now) });
  return { id, kind: 'fraudReview', role: 'fraudAnalyst', subject: c.oid,
    question: `Fraud review for order ${c.oid}: approve or reject the order.`, answerSchema: ANSWER_SCHEMA, dueAt: iso(deadline), onTimeout: 'cancel-order' };
}
