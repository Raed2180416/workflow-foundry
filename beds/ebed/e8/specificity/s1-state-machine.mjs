// E8 specificity solver S1: an explicit per-order state machine kept in the carry. $0, no model calls, no wall clock,
// no randomness, no dependencies (Node 24 ESM). Written from beds/ebed/e8/spec/SPEC-E.md (as amended 2026-10-14:
// R1.3 edition.json, R2.2/R3.2/S1 strict timeouts, §3.4 `late`), BED-CONTRACT v1.1 §3.1-§3.4, host README §2-§4,
// beds/ebed/e8/systems.mjs and beds/ebed/host/output.mjs only. Its purpose is to check that the item's grader accepts
// a correct solver that was built independently of the reference transition and the oracle.
//
// DESIGN
// - One instance per order. The first tick of an instance started by an inbound message routes it: an order id is
//   normalised (§3.1), `ctx.instances({ subject })` names the open instance of that order and the message is merged
//   into it; a duplicate whose order is already recorded and closed (`ctx.query('orders.orders')`) is closed with no
//   effect (R1.4); an action or carrier message for no open order is closed with no effect. Carrier messages without
//   my ref (pre-go-live shipments, §3.5) are matched by fulfilmentRef -> orders.fulfilments -> orderId.
// - The carry is the state machine: order data and its edition (fixed at intake, R1.3), the fulfilment plan, the
//   fraud and review state, the counted customer action, the decided cancellation / timeout, per-fulfilment saga facts
//   (carrier reports, failure, compensation mode, collected-lock) and `E`, an observed-outcome ledger of every keyed
//   effect (in flight / ok / 400 to re-issue / retryable to resubmit / skipped / permanent error with code / unknown).
//   Statuses are never stored as "current": they are derived from the migrated base plus the status keys that are in
//   flight or ok, so a skipped or failed status change never counts and nothing regresses (R7.2).
// - Each tick: apply events in (time, kind) order, then run `transitions` (fraud verdict, clearing, queued customer
//   actions, timers, review re-asks, obligations), then a planner that derives the effects still missing from the
//   state. The planner only emits an effect whose key was never emitted or must be re-issued (400 field-renamed,
//   retryable batch item, unknown outcome whose status(key) is not-found); keys are deterministic business keys
//   (`s1|chg|<fulfilment>`, `s1|st|<order>|<target>|<status>`, `s1|ntf|<about>|<template>`, ...), one per logical
//   effect, reused on every attempt.
// - Forward saga steps (reserve -> charge -> ship) are emitted one at a time on the observed commit of the previous
//   step, never chained with `after`: a step chained behind a predecessor the platform is still retrying could be
//   applied after a customer cancel, which R6.2 forbids. `after` is used only where nothing new can be booked:
//   compensation in reverse order (carrier.cancel -> refund -> releases), the fulfilment's `cancelled` status behind
//   its shipment cancel, `dispatched` -> `completed`, and the order outcome behind the last fulfilment status.
// - Compensation (R5.1) decides "committed" per step: observed ok, or (for any other final outcome) `ctx.status`
//   says committed (S2); a step still pending is waited for, so reverse order holds and an in-flight step that commits
//   after a cancel is compensated after its commit (R6.2). A permanently failed step is never retried.
// - Timers: customer deadline at D + 1 min, fraud-review deadline at deadline + 1 min (both strictly after the
//   deadline, so an action or answer exactly at the deadline is processed first; S1). Review tasks have dueAt = the
//   rule deadline.
// - F5: every effect's arguments are fitted to the current `api/<system>.schema.json` at emission (a canonical name
//   missing from the schema is mapped to the unused property of matching type, preferring required ones and name
//   similarity); a 400 result is re-issued with the same key and refitted arguments (at most 6 attempts per key).
// - The instance closes when the order's final status is set (or permanently refused) and nothing is in flight.
//
// READINGS (where the spec left a choice; section cited)
// 1. §3.3/R6.2/S6 "reported collected": a carrier report meaning `inTransit` or `delivered` also proves collection,
//    so it ends the right to cancel like `collected` does (a delivery can be reported before the collection, §3.3).
//    Only the `collected` meaning (or `delivered`) sets `dispatched` (R4.4).
// 2. R4.4/§3.3 `collectionFailed` after any collection evidence for that shipment is contradictory and changes nothing.
// 3. R6.2 vs R3.2 "later actions change nothing": an order that was amended is processing (ready at the amend, R3.2),
//    so a later cancel is judged by R6.2 (and S6), not refused by R3.2. S5 is read as scoped to orders still waiting
//    under R3 (or timed out).
// 4. R3.2 timeout is unconditional: an order with an unavailable fulfilment and no counted action is timed out in
//    (D, D + 60 min] even if it was never cleared (fraud review still open at D); a later review answer changes
//    nothing. An amend counted before clearing cancels the unavailable fulfilments at once; the order is ready when
//    it is cleared (max(amend, clearing)), and R3.1 is skipped because the customer already acted.
// 5. R6.4 is applied to any cancel before clearing (also while intake reads are in flight); the order is recorded
//    first and then cancelled (R6.1, reason customer).
// 6. R6.2 in-flight steps: a charge/booking/reservation whose result arrives after a counted cancel is compensated if
//    it committed; if it failed (e.g. 402) the fulfilment is still `cancelled` (the customer's cancel decided its
//    fate), with no `fulfilment-failed`.
// 7. R6.2 edge: if carrier.cancel answers `409 already-collected` (collected but not yet reported), the fulfilment
//    passed its point of no return (R4.3): it is not compensated, keeps following carrier messages, the order is not
//    set cancelled, `cancel-refused` is sent, and R4.5 decides the order at the end. Other fulfilments stay cancelled.
//    A carrier.cancel failing for another reason (shipment not live) does not stop the refund and releases.
// 8. R6.3 / §4.8 "exactly once": `cancel-refused` is sent at most once per order (later refused cancels are repeats);
//    the optional `cancel-refused` for an ended order and the optional `unknown-order` are not sent.
// 9. R2.1/R6.1 "reason": no system field carries a reason, so it is written in the notification text only.
// 10. R2.2: an answer counts if its event time is at or before the deadline and it carries decision approve|reject;
//    an unusable answer, a rejected answer or a withdrawal of the open task is re-asked with a new task id (same
//    deadline) while time remains. `humanTask.timeout` itself does nothing; the deadline timer decides.
// 11. R4.1: if a counted cancel arrives before `processing` was set, `processing` is skipped (the order goes straight
//    to `cancelled`).
// 12. Migration (§3.5): a recorded order is continued from its records (statuses as base, reservations / charges /
//    shipments as committed steps, sent notifications as sent); `customerActionRequired` means cleared and waiting;
//    `processing` means ready (an unavailable fulfilment there means an amend was counted); a recorded `pending`
//    order is re-screened with fraud.check (a review gets its first task now, since a pre-go-live task is not exported).
//    An unrecorded one is a new order. A collected/inTransit/delivered shipment record counts as collection evidence.
// 13. Unknown carrier codes (not in the order's edition, nor in any other published edition) are `info`. Code and
//    carrier match exactly first, then trimmed and case-insensitively.
// 14. R1.2: a location missing from the edition's fee table has fee 0; R1.3: if no edition has effectiveFrom on or
//    before date(p), the earliest published edition is used.

const MIN = 60_000;
const HOUR = 3_600_000;
const FEND = new Set(['completed', 'cancelled', 'failed']);
const OEND = new Set(['completed', 'cancelled', 'failed', 'timedOut']);
const F_RANK = { unavailable: 0, pending: 0, processing: 1, dispatched: 2, completed: 3, cancelled: 3, failed: 3 };
const O_RANK = { pending: 0, customerActionRequired: 1, processing: 2, completed: 3, failed: 3, cancelled: 3, timedOut: 3 };
const EV_RANK = { migration: 0, 'effect.result': 1, 'carrier.status': 2, 'humanTask.answered': 3, 'humanTask.answerRejected': 3,
  'humanTask.withdrawn': 3, 'humanTask.delegated': 3, 'humanTask.timeout': 3, 'order.placed': 4, 'customer.action': 5, 'timer.fired': 6 };
const REISSUE = new Set(['4', 'r', 'n']); // 400 / retryable batch item / unknown outcome that did not commit
const MAX_ATTEMPTS = 6;
const ANSWER_SCHEMA = { type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['approve', 'reject'] } }, additionalProperties: false };

// ---------------------------------------------------------------------------------------------------------- basics

const t = s => Date.parse(s);
const norm = s => (typeof s === 'string' ? s.trim().replace(/^#+/, '').trim().toUpperCase() : null);
const cmpEv = (a, b) => (t(a.at) - t(b.at)) || ((EV_RANK[a.type] ?? 9) - (EV_RANK[b.type] ?? 9)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function lastSundayOneUtc(y, month) { // month 0-based; the last Sunday of that month, 01:00 UTC (EU summer-time switch)
  const d = new Date(Date.UTC(y, month + 1, 0, 1));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.getTime();
}
function amsOffsetMin(ms) {
  const y = new Date(ms).getUTCFullYear();
  return ms >= lastSundayOneUtc(y, 2) && ms < lastSundayOneUtc(y, 9) ? 120 : 60;
}
function iso(ms) {
  const off = amsOffsetMin(ms);
  return `${new Date(ms + off * MIN).toISOString().slice(0, 19)}+${String(off / 60).padStart(2, '0')}:00`;
}
const amsDate = ms => new Date(ms + amsOffsetMin(ms) * MIN).toISOString().slice(0, 10);

function J(ctx, path) {
  const v = ctx.files?.[path];
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
}
const natCmp = (a, b) => a.localeCompare(b, 'en', { numeric: true });

const K = {
  create: oid => `s1|create|${oid}`,
  st: (oid, target, status) => `s1|st|${oid}|${target}|${status}`,
  rsv: (fid, sku) => `s1|rsv|${fid}|${sku}`,
  rel: (fid, sku) => `s1|rel|${fid}|${sku}`,
  chg: fid => `s1|chg|${fid}`,
  rfd: fid => `s1|rfd|${fid}`,
  shp: fid => `s1|shp|${fid}`,
  cxl: fid => `s1|cxl|${fid}`,
  ntf: (about, tpl) => `s1|ntf|${about}|${tpl}`,
};
const ORDER_TARGET = '-';

// ----------------------------------------------------------------------------------------------- reference data

function editionAt(ctx, pAt) {
  const eds = [];
  for (const k of Object.keys(ctx.files ?? {})) {
    const m = /^rulebook\/([^/]+)\/edition\.json$/.exec(k);
    if (m) eds.push({ id: m[1], from: J(ctx, k)?.effectiveFrom ?? null });
  }
  const d = amsDate(pAt);
  const inForce = eds.filter(e => typeof e.from === 'string' && e.from <= d)
    .sort((a, b) => (a.from < b.from ? 1 : a.from > b.from ? -1 : natCmp(b.id, a.id)));
  if (inForce.length) return inForce[0].id;
  if (eds.length) return eds.sort((a, b) => String(a.from).localeCompare(String(b.from)) || natCmp(a.id, b.id))[0].id;
  const dirs = [...new Set(Object.keys(ctx.files ?? {}).map(k => /^rulebook\/([^/]+)\//.exec(k)?.[1]).filter(Boolean))].sort(natCmp);
  return dirs[dirs.length - 1] ?? null;
}
const policy = (st, ctx) => J(ctx, `rulebook/${st.ed}/policy.json`) ?? {};

function meaningOf(st, ctx, carrier, code) {
  const eds = [st.ed, ...[...new Set(Object.keys(ctx.files ?? {}).map(k => /^rulebook\/([^/]+)\/carrier-codes\.json$/.exec(k)?.[1]).filter(Boolean))].sort(natCmp).reverse()];
  const lc = v => String(v ?? '').trim().toLowerCase();
  for (const strict of [true, false]) {
    for (const ed of eds) {
      const rows = J(ctx, `rulebook/${ed}/carrier-codes.json`);
      if (!Array.isArray(rows)) continue;
      const hit = rows.find(r => (strict ? r.carrier === carrier && r.code === code : lc(r.carrier) === lc(carrier) && lc(r.code) === lc(code)));
      if (hit) return hit.meaning;
    }
  }
  return 'info';
}

function emailOf(st, ctx) {
  const rows = J(ctx, 'master/customers.json');
  const hit = Array.isArray(rows) ? rows.find(c => c.customerId === st.cust) ?? rows.find(c => norm(c.customerId) === norm(st.cust)) : null;
  return hit?.email ?? st.email ?? null;
}

function priceAndFees(st, ctx, fulfilments) {
  const cat = J(ctx, 'master/catalog.json') ?? [];
  const price = new Map(cat.map(c => [c.sku, c.unitPriceMinor]));
  const priceOf = sku => price.get(sku) ?? price.get(norm(sku)) ?? 0;
  const fees = J(ctx, `rulebook/${st.ed}/shipping-fees.json`) ?? [];
  const feeOf = loc => fees.find(f => f.location === loc)?.feeMinor ?? 0;
  return fulfilments.map(f => f.items.reduce((s, it) => s + it.qty * priceOf(it.sku), 0) + (f.location == null ? 0 : feeOf(f.location)));
}

// F5: fit canonical argument names to the current API schema.
function typeOk(v, schema) {
  const ty = schema?.type;
  if (!ty) return true;
  const tys = Array.isArray(ty) ? ty : [ty];
  const actual = v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v;
  return tys.includes(actual) || (actual === 'integer' && tys.includes('number'));
}
function similarity(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++;
  return p + (a.includes(b) || b.includes(a) ? 2 : 0);
}
function fit(v, schema) {
  if (Array.isArray(v)) return schema?.items ? v.map(x => fit(x, schema.items)) : v;
  if (!v || typeof v !== 'object' || !schema?.properties) return v;
  const props = schema.properties, req = new Set(schema.required ?? []);
  const spare = Object.keys(props).filter(k => !(k in v));
  const out = {};
  for (const k of Object.keys(v)) {
    let name = k;
    if (!(k in props)) {
      const cands = spare.filter(s => typeOk(v[k], props[s]))
        .sort((a, b) => (Number(req.has(b)) - Number(req.has(a))) || (similarity(k, b) - similarity(k, a)) || a.localeCompare(b));
      if (cands.length) { name = cands[0]; spare.splice(spare.indexOf(name), 1); }
    }
    out[name] = fit(v[k], props[name]);
  }
  return out;
}
function adapt(ctx, system, op, args) {
  const schema = J(ctx, `api/${system}.schema.json`)?.ops?.[op]?.args;
  return schema ? fit(args, schema) : args;
}

// ----------------------------------------------------------------------------------------------------- the carry

function blank(oid, cust, cur, items, p) {
  return {
    v: 1, oid, cust, cur, items, p, pAt: t(p), ed: null, email: null,
    fo: [], F: {}, E: {}, rd: { a: 0, f: 0 }, nf: false, rec: false, fraud: null, fv: false,
    ob: 'pending', cleared: null, ready: null, D: null, act: null, cx: null, to: null, car: false, refuse: false,
    rv: null, q: [], obl: {}, tm: {},
  };
}
function addFulfilment(st, { fulfilmentId, location, items, amountMinor, status }) {
  const fid = fulfilmentId;
  if (!st.F[fid]) st.fo.push(fid);
  st.F[fid] = { id: fid, loc: location ?? null, items: (items ?? []).map(i => ({ sku: i.sku, qty: i.qty })), amt: amountMinor, av: location != null,
    base: status ?? (location == null ? 'unavailable' : 'pending'), col: null, colRep: null, del: null, cfail: null,
    mode: null, failAt: null, locked: false, shipId: null, m: null };
}

function fromPlaced(ev, ctx) {
  const pl = ev.payload ?? {};
  const p = typeof pl.placedAt === 'string' && !Number.isNaN(t(pl.placedAt)) ? pl.placedAt : ev.at;
  const st = blank(norm(pl.orderId), pl.customerId, pl.currency, pl.items, p);
  st.ed = editionAt(ctx, st.pAt);
  st.nf = true;
  return st;
}

function fromMigration(ev, ctx) {
  const rec = ev.payload?.records ?? {};
  const evs = [...(ev.payload?.events ?? [])].sort(cmpEv);
  const o = (rec['orders.orders'] ?? [])[0];
  const placed = evs.find(e => e.type === 'order.placed');
  const oid = norm(o?.orderId ?? placed?.payload?.orderId);
  if (!oid) return { st: null, evs };
  let st;
  if (!o) {
    st = fromPlaced(placed, ctx);
  } else {
    st = blank(oid, o.customerId, o.currency, o.items, o.placedAt ?? placed?.at);
    st.ed = editionAt(ctx, st.pAt);
    st.rec = true;
    st.ob = o.status;
    for (const f of rec['orders.fulfilments'] ?? []) if (norm(f.orderId) === oid) addFulfilment(st, f);
    for (const r of rec['inventory.reservations'] ?? []) {
      const f = st.F[r.fulfilmentId]; if (!f) continue;
      f.m ??= {}; f.m.rsv ??= {};
      if (f.m.rsv[r.sku] !== 'active') f.m.rsv[r.sku] = r.status;
    }
    for (const c of rec['billing.charges'] ?? []) {
      const f = st.F[c.fulfilmentId]; if (!f) continue;
      f.m ??= {}; f.m.chg = true; f.m.chgAmt = c.amountMinor; f.m.refunded = (c.refundedMinor ?? 0) >= c.amountMinor;
    }
    for (const r of rec['billing.refunds'] ?? []) { const f = st.F[r.fulfilmentId]; if (f?.m?.chg) f.m.refunded = true; }
    for (const s of rec['carrier.shipments'] ?? []) {
      const f = st.F[s.fulfilmentId]; if (!f) continue;
      f.m ??= {}; f.m.shp = true; f.m.shpSt = s.status; f.shipId = s.shipmentId;
      if (['collected', 'inTransit', 'delivered'].includes(s.status)) f.col ??= st.pAt;
      if (s.status === 'delivered') f.del ??= t(ev.at);
    }
    for (const n of rec['notify.notifications'] ?? []) {
      if (n.about && n.template) st.E[K.ntf(n.about, n.template)] = { s: 'ok', n: 0 };
      if (n.about === oid && n.to) st.email ??= n.to;
    }
    if (o.status === 'pending') st.nf = true;
    else if (o.status === 'customerActionRequired') { st.cleared = st.pAt; st.fv = true; st.car = true; }
    else if (o.status === 'processing') {
      st.cleared = st.pAt; st.ready = st.pAt; st.fv = true;
      if (st.fo.some(fid => !st.F[fid].av)) st.act = { k: 'amend', at: st.pAt };
    } else { st.fv = true; }
  }
  return { st, evs };
}

// ----------------------------------------------------------------------------------------------- derived status

const live = e => e && (e.s === 'f' || e.s === 'ok');
function fstat(st, fid) {
  const f = st.F[fid];
  let best = f.base;
  if (FEND.has(best)) return best;
  for (const s of ['processing', 'dispatched', 'completed', 'cancelled', 'failed']) {
    if (live(st.E[K.st(st.oid, fid, s)]) && F_RANK[s] >= F_RANK[best]) { best = s; if (FEND.has(s)) return s; }
  }
  return best;
}
function fEndKey(st, fid) { // the key of the fulfilment's end status, or null when it came with the migration
  const s = fstat(st, fid);
  return st.F[fid].base === s ? null : K.st(st.oid, fid, s);
}
function ostat(st) {
  let best = st.ob;
  if (OEND.has(best)) return best;
  for (const s of ['customerActionRequired', 'processing', 'completed', 'failed', 'cancelled', 'timedOut']) {
    if (live(st.E[K.st(st.oid, ORDER_TARGET, s)]) && O_RANK[s] >= O_RANK[best]) { best = s; if (OEND.has(s)) return s; }
  }
  return best;
}
function orderDone(st) {
  if (OEND.has(ostat(st))) return true;
  return [...OEND].some(s => st.E[K.st(st.oid, ORDER_TARGET, s)]?.s === 'x');
}
const hasU = st => st.fo.some(fid => !st.F[fid].av);
const anyAv = st => st.fo.some(fid => st.F[fid].av);
const isOver = st => Boolean(st.to || (st.cx && !st.cx.void) || OEND.has(ostat(st)));
const cxActive = st => Boolean(st.cx && !st.cx.void);

// -------------------------------------------------------------------------------------------------- the output

class Out {
  constructor(st, ctx, now) {
    this.st = st; this.ctx = ctx; this.now = now;
    this.effects = []; this.emitted = new Set(); this.tasks = []; this.up = []; this.cancel = []; this.sc = new Map();
  }
  status(system, key) {
    const k = `${system}\u0000${key}`;
    if (!this.sc.has(k)) { let s = 'not-found'; try { s = this.ctx.status(system, key); } catch { s = 'unknown'; } this.sc.set(k, s); }
    return this.sc.get(k);
  }
  /** State of a key after reconciling an unknown outcome with status(key). */
  settle(system, key) {
    const e = this.st.E[key];
    if (e?.s === 'u') {
      const s = this.status(system, key);
      if (s === 'committed') e.s = 'ok'; else if (s === 'not-found') e.s = 'n';
    }
    return this.st.E[key]?.s ?? null;
  }
  /** Did the step commit (S2)? true / false / null (still pending). */
  committed(system, key) {
    const s = this.settle(system, key);
    if (!s) return false;
    if (s === 'ok') return true;
    if (s === 'f' || s === 'u') return null;
    const r = this.status(system, key);
    return r === 'committed' ? true : r === 'pending' ? null : false;
  }
  canEmit(key) {
    if (this.emitted.has(key)) return false;
    const e = this.st.E[key];
    return !e || ((REISSUE.has(e.s) || e.s === 's') && e.n < MAX_ATTEMPTS);
  }
  push(key, system, op, args, after) {
    if (!this.canEmit(key)) return false;
    const eff = { key, system, op, args: adapt(this.ctx, system, op, args) };
    if (after && this.emitted.has(after)) eff.after = after;
    this.effects.push(eff);
    this.emitted.add(key);
    this.st.E[key] = { s: 'f', n: (this.st.E[key]?.n ?? 0) + 1 };
    return true;
  }
  read(system, op, args) { this.effects.push({ system, op, args: adapt(this.ctx, system, op, args) }); }
  reserve(f, items) {
    const st = this.st;
    const its = items.filter(it => this.canEmit(K.rsv(f.id, it.sku)));
    if (!its.length) return;
    this.effects.push({ system: 'inventory', op: 'reserve', args: adapt(this.ctx, 'inventory', 'reserve',
      { orderId: st.oid, fulfilmentId: f.id, location: f.loc, items: its.map(it => ({ key: K.rsv(f.id, it.sku), sku: it.sku, qty: it.qty })) }) });
    for (const it of its) { const k = K.rsv(f.id, it.sku); this.emitted.add(k); st.E[k] = { s: 'f', n: (st.E[k]?.n ?? 0) + 1 }; }
  }
  /** Can an effect that must follow `key` go now, and with which `after`? */
  dep(key) {
    if (!key) return { go: true };
    if (this.emitted.has(key)) return { go: true, after: key };
    const s = this.st.E[key]?.s;
    return { go: !(s === 'f' || s === 'u') };
  }
  setF(fid, status, after) {
    const st = this.st, cur = fstat(st, fid);
    if (cur === status) return st.F[fid].base === status ? null : K.st(st.oid, fid, status);
    if (FEND.has(cur) || F_RANK[status] < F_RANK[cur] || (F_RANK[status] === F_RANK[cur] && !FEND.has(status))) return null;
    const key = K.st(st.oid, fid, status);
    this.push(key, 'orders', 'setStatus', { orderId: st.oid, fulfilmentId: fid, status }, after);
    return key;
  }
  setO(status, after) {
    const st = this.st, cur = ostat(st);
    if (cur === status) return st.ob === status ? null : K.st(st.oid, ORDER_TARGET, status);
    if (OEND.has(cur) || O_RANK[status] <= O_RANK[cur] && !OEND.has(status)) return null;
    const key = K.st(st.oid, ORDER_TARGET, status);
    this.push(key, 'orders', 'setStatus', { orderId: st.oid, fulfilmentId: null, status }, after);
    return key;
  }
  notify(about, template, text) {
    const to = emailOf(this.st, this.ctx);
    if (!to) return;
    this.push(K.ntf(about, template), 'notify', 'send', { to, about, template, text });
  }
}

// ------------------------------------------------------------------------------------------------------ events

function onResult(st, p, ctx) {
  const code = p.error?.code, reason = String(p.error?.reason ?? '');
  if (p.system === 'inventory' && p.op === 'allocate' && !p.key) {
    if (p.status === 'ok' && p.result) {
      if (!st.fo.length) {
        const fs = (p.result.fulfilments ?? []).map(f => ({ ...f, location: f.available === false ? null : f.location }));
        const amts = priceAndFees(st, ctx, fs);
        fs.forEach((f, i) => addFulfilment(st, { fulfilmentId: f.fulfilmentId, location: f.location, items: f.items, amountMinor: amts[i] }));
      }
      st.rd.a = 2;
    } else st.rd.a = code === 400 || p.status === 'rate-limited' || p.status === 'unknown' ? 4 : 3;
    return;
  }
  if (p.system === 'fraud' && p.op === 'check' && !p.key) {
    if (p.status === 'ok' && p.result) { st.fraud = p.result.verdict ?? 'review'; st.rd.f = 2; }
    else st.rd.f = code === 400 || p.status === 'rate-limited' || p.status === 'unknown' ? 4 : 3;
    return;
  }
  if (Array.isArray(p.items)) { for (const it of p.items) mark(st, it.key, it.status, it.error, it.result); return; }
  if (p.key) mark(st, p.key, p.status, p.error, p.result);
  void reason;
}

function mark(st, key, status, error, result) {
  if (!key) return;
  const e = st.E[key] ?? (st.E[key] = { s: 'f', n: 1 });
  delete e.c; delete e.r;
  if (status === 'ok') {
    e.s = 'ok';
    const parts = key.split('|');
    if (parts[1] === 'shp' && st.F[parts[2]] && result?.shipmentId) st.F[parts[2]].shipId = result.shipmentId;
    if (parts[1] === 'create') st.rec = true;
  } else if (status === 'unknown') e.s = 'u';
  else if (status === 'rate-limited') e.s = 'r';
  else {
    const code = error?.code, reason = String(error?.reason ?? '');
    if (code === 400 || reason === 'field-renamed' || reason === 'invalid-args') e.s = '4';
    else if (reason.startsWith('predecessor') || String(code).startsWith('predecessor')) e.s = 's';
    else if (error?.retryable === true) e.s = 'r';
    else { e.s = 'x'; e.c = code ?? null; e.r = reason; }
  }
}

function matchFulfilment(st, pl) {
  const fr = norm(pl.fulfilmentRef);
  if (fr && st.F[fr]) return fr;
  const byRef = norm(pl.ref);
  if (byRef && st.F[byRef]) return byRef;
  if (pl.shipmentId) for (const fid of st.fo) if (st.F[fid].shipId && st.F[fid].shipId === pl.shipmentId) return fid;
  return null;
}

function onCarrier(st, ev, ctx) {
  const pl = ev.payload ?? {};
  const fid = matchFulfilment(st, pl);
  if (!fid) return;
  const f = st.F[fid], at = t(ev.at);
  if (st.E[K.cxl(fid)]?.s === 'ok' || f.m?.shpSt === 'cancelled') return; // a shipment I cancelled (§3.3)
  const fs = fstat(st, fid);
  if (fs === 'completed' || fs === 'failed') return;
  const m = meaningOf(st, ctx, pl.carrier, pl.code);
  if (m === 'collected' || m === 'inTransit' || m === 'delivered') f.col = f.col == null ? at : Math.min(f.col, at);
  if (m === 'collected') f.colRep ??= at;
  if (m === 'delivered') f.del ??= at;
  if (m === 'collectionFailed' && f.col == null) f.cfail ??= at;
}

function taskIdOf(pl) { return pl?.taskId ?? pl?.task?.id ?? pl?.id ?? null; }
function decisionOf(pl) {
  for (const a of [pl?.answer, pl?.value, pl?.data, pl?.result]) {
    if (a && typeof a === 'object' && typeof a.decision === 'string') return a.decision.trim().toLowerCase();
  }
  return null;
}

function handle(st, ev, ctx) {
  const pl = ev.payload ?? {};
  switch (ev.type) {
    case 'effect.result': onResult(st, pl, ctx); break;
    case 'carrier.status': onCarrier(st, ev, ctx); break;
    case 'customer.action': {
      const k = String(pl.action ?? '').trim().toLowerCase();
      if ((k === 'amend' || k === 'cancel') && norm(pl.orderRef) === st.oid) st.q.push({ k, at: t(ev.at) });
      break;
    }
    case 'timer.fired': { const id = pl.obligationId; if (id) { st.tm[id] = true; delete st.obl[id]; } break; }
    case 'humanTask.answered': {
      const rv = st.rv, at = t(ev.at);
      if (!rv || rv.dec || isOver(st) || at > rv.dl) break;
      const dec = decisionOf(pl);
      if (dec === 'approve') { rv.dec = 'approve'; rv.at = at; clear(st, at); }
      else if (dec === 'reject') { rv.dec = 'reject'; rv.at = at; st.cx = { at, reason: 'fraud', kind: 'R61' }; }
      else if (taskIdOf(pl) === rv.open) rv.reask = true;
      break;
    }
    case 'humanTask.answerRejected':
    case 'humanTask.withdrawn':
      if (st.rv && !st.rv.dec && taskIdOf(pl) === st.rv.open) st.rv.reask = true;
      break;
    default: break; // order.placed duplicates (R1.4), humanTask.timeout / delegated, migration: nothing
  }
}

// ------------------------------------------------------------------------------------------------- transitions

function clear(st, at) {
  if (st.cleared != null) return;
  st.cleared = at;
  if (hasU(st)) {
    if (st.act?.k === 'amend') { if (anyAv(st)) st.ready = Math.max(st.act.at, at); }
    else if (!st.act && !isOver(st)) st.car = true;
  } else st.ready = at;
}

function anyCollectedBy(st, a) { return st.fo.some(fid => st.F[fid].col != null && st.F[fid].col <= a); }

function classify(st, a, k) {
  if (isOver(st)) return; // R6.3 second sentence, S5: changes nothing
  const cleared = st.cleared != null && st.cleared <= a;
  if (k === 'cancel') {
    if (st.ready != null && st.ready <= a) { // processing: R6.2 / R6.3 / S4 / S6
      if (anyCollectedBy(st, a)) { st.refuse = true; return; }
      const set = st.fo.filter(fid => !FEND.has(fstat(st, fid)) && st.F[fid].mode !== 'fail');
      for (const fid of set) st.F[fid].mode = 'cancel';
      st.cx = { at: a, reason: 'customer', kind: 'R62', set };
      return;
    }
    if (!cleared) { // R6.4
      if (hasU(st) && !st.act && st.D != null && a <= st.D) st.act = { k: 'cancel', at: a };
      st.cx = { at: a, reason: 'customer', kind: 'R61' };
      return;
    }
    if (!st.act && st.D != null && a <= st.D) { st.act = { k: 'cancel', at: a }; st.cx = { at: a, reason: 'customer', kind: 'R61' }; }
    return;
  }
  if (k === 'amend') {
    if (!hasU(st) || st.act || st.D == null || a > st.D) return; // S5
    st.act = { k: 'amend', at: a };
    if (!anyAv(st)) { st.cx = { at: a, reason: 'nothing-available', kind: 'R61' }; return; }
    if (cleared) st.ready = a;
  }
}

function newTask(st, P) {
  const rv = st.rv;
  rv.n += 1;
  rv.open = `s1|fraudReview|${st.oid}|${rv.n}`;
  P.tasks.push({ id: rv.open, kind: 'fraudReview', role: 'fraudAnalyst', subject: st.oid,
    question: `Fraud review for order ${st.oid} (customer ${st.cust}). Approve or reject the order.`,
    answerSchema: ANSWER_SCHEMA, dueAt: iso(rv.dl), onTimeout: 'cancel-order-fraud-review-timeout' });
}

function transitions(st, P) {
  const pol = policy(st, P.ctx);
  if (st.fo.length && st.D == null && hasU(st)) st.D = st.pAt + Number(pol.customerActionHours ?? 0) * HOUR;
  // fraud verdict, once the plan is known
  if (st.fraud && !st.fv && st.fo.length) {
    st.fv = true;
    if (st.fraud === 'pass') clear(st, st.pAt);
    else if (st.fraud === 'reject') { if (!isOver(st)) st.cx = { at: P.now, reason: 'fraud', kind: 'R61' }; }
    else if (!isOver(st)) { st.rv = { first: P.now, dl: P.now + Number(pol.fraudReviewHours ?? 0) * HOUR, n: 0, open: null, dec: null }; newTask(st, P); }
  }
  // customer actions, in time order, once the order's state at their time is known
  if (st.q.length && st.fo.length && (st.fv || st.cleared != null || isOver(st))) {
    for (const a of st.q.sort((x, y) => x.at - y.at)) classify(st, a.at, a.k);
    st.q = [];
  }
  // timers (strictly after their deadline)
  if (st.tm.cad) {
    delete st.tm.cad;
    if (hasU(st) && !st.act && !isOver(st) && st.D != null && P.now > st.D) st.to = { at: P.now };
  }
  if (st.tm.frd) {
    delete st.tm.frd;
    if (st.rv && !st.rv.dec && !isOver(st) && P.now > st.rv.dl) { st.rv.dec = 'timeout'; st.cx = { at: P.now, reason: 'fraud-review-timeout', kind: 'R61' }; }
  }
  if (st.rv && !st.rv.dec && isOver(st)) st.rv.dec = 'void';
  if (st.rv?.reask) { st.rv.reask = false; if (!st.rv.dec && !isOver(st) && P.now < st.rv.dl) newTask(st, P); }
  // obligations
  const want = {};
  if (st.D != null && hasU(st) && !st.act && !isOver(st)) want.cad = iso(st.D + MIN);
  if (st.rv && !st.rv.dec && !isOver(st)) want.frd = iso(st.rv.dl + MIN);
  for (const [id, dueAt] of Object.entries(want)) {
    if (st.obl[id] === dueAt) continue;
    P.up.push({ id, kind: id === 'cad' ? 'customerActionDeadline' : 'fraudReviewDeadline', anchor: st.oid, dueAt, onDue: { orderId: st.oid } });
    st.obl[id] = dueAt;
  }
  for (const id of Object.keys(st.obl)) if (!(id in want)) { P.cancel.push(id); delete st.obl[id]; }
}

// ----------------------------------------------------------------------------------------------------- planner

function createArgs(st) {
  const fulfilments = st.fo.map(fid => { const f = st.F[fid]; return { fulfilmentId: fid, location: f.loc, items: f.items, amountMinor: f.amt }; });
  return { orderId: st.oid, customerId: st.cust, placedAt: st.p, currency: st.cur, items: st.items, fulfilments,
    totalMinor: fulfilments.reduce((s, f) => s + f.amountMinor, 0) };
}

function rsvCommitted(P, f, sku) {
  const m = f.m?.rsv?.[sku];
  if (m === 'active') return true;
  if (m === 'released') return false;
  return P.committed('inventory', K.rsv(f.id, sku));
}
function chgCommitted(P, f) { return f.m?.chg ? !f.m.refunded : P.committed('billing', K.chg(f.id)); }
function shpCommitted(P, f) { return f.m?.shp ? !['cancelled', 'failed'].includes(f.m.shpSt) : P.committed('carrier', K.shp(f.id)); }

/** R5.1 compensation of one fulfilment, newest step first. */
function chain(P, f) {
  const st = P.st, oid = st.oid, fid = f.id;
  if (f.locked) return { locked: true };
  const rC = f.items.map(it => rsvCommitted(P, f, it.sku));
  const cC = chgCommitted(P, f), sC = shpCommitted(P, f);
  if (rC.includes(null) || cC === null || sC === null) return { wait: true, sC };
  let prev = null;
  const needCxl = sC === true && f.cfail == null;
  if (needCxl) {
    const k = K.cxl(fid), s = P.settle('carrier', k);
    if (!s || REISSUE.has(s) || s === 's') { if (P.push(k, 'carrier', 'cancel', { orderId: oid, fulfilmentId: fid })) prev = k; else return { wait: true, sC }; }
    else if (s === 'f' || s === 'u') return { wait: true, sC };
    else if (s === 'x' && st.E[k].r === 'already-collected') { f.locked = true; return { locked: true }; }
  }
  if (cC === true) {
    const k = K.rfd(fid), s = P.settle('billing', k);
    if (!s || REISSUE.has(s) || s === 's') { if (P.push(k, 'billing', 'refund', { orderId: oid, fulfilmentId: fid, amountMinor: f.m?.chgAmt ?? f.amt }, prev)) prev = k; else return { wait: true, sC }; }
    else if (s === 'f' || s === 'u') return { wait: true, sC };
    else prev = null;
  }
  f.items.forEach((it, i) => {
    if (rC[i] !== true) return;
    const k = K.rel(fid, it.sku), s = P.settle('inventory', k);
    if (!s || REISSUE.has(s) || s === 's') P.push(k, 'inventory', 'release', { orderId: oid, fulfilmentId: fid, sku: it.sku }, prev);
  });
  return { done: true, sC, needCxl };
}

function compensateFail(P, f) {
  chain(P, f);
  P.setF(f.id, 'failed');
  P.notify(f.id, 'fulfilment-failed', `Part ${f.id} of order ${P.st.oid} could not be fulfilled; any payment for it is refunded.`);
}

function compensateCancel(P, f) {
  const r = chain(P, f);
  if (r.locked) return;
  if (r.sC === true && f.cfail == null) { // a booked shipment: cancelled only behind its shipment cancel
    const d = P.dep(K.cxl(f.id));
    if (P.st.E[K.cxl(f.id)] && d.go) P.setF(f.id, 'cancelled', d.after);
    return;
  }
  P.setF(f.id, 'cancelled');
}

function failNow(P, f) { f.mode = 'fail'; f.failAt = P.now; compensateFail(P, f); }

function saga(P, f) {
  const st = P.st, fid = f.id;
  if (FEND.has(fstat(st, fid))) return;
  if (f.cfail != null && f.col == null) return failNow(P, f);
  if (f.del != null) { const d = P.dep(P.setF(fid, 'dispatched')); if (d.go) P.setF(fid, 'completed', d.after); return; }
  if (f.colRep != null) { P.setF(fid, 'dispatched'); return; }
  if (f.col != null || f.locked || cxActive(st)) return;
  // 1. reserve every item
  const states = f.items.map(it => (f.m?.rsv?.[it.sku] === 'active' ? 'ok' : P.settle('inventory', K.rsv(fid, it.sku))));
  if (states.includes('x')) return failNow(P, f);
  if (!states.every(s => s === 'ok')) {
    P.reserve(f, f.items.filter((it, i) => !states[i] || REISSUE.has(states[i])));
    return;
  }
  // 2. charge
  const cs = f.m?.chg ? 'ok' : P.settle('billing', K.chg(fid));
  if (cs === 'x') return failNow(P, f);
  if (cs !== 'ok') {
    if (!cs || REISSUE.has(cs)) P.push(K.chg(fid), 'billing', 'charge', { orderId: st.oid, fulfilmentId: fid, customerId: st.cust, amountMinor: f.amt, currency: st.cur });
    return;
  }
  // 3. ship
  const ss = f.m?.shp ? 'ok' : P.settle('carrier', K.shp(fid));
  if (ss === 'x') return failNow(P, f);
  if (ss !== 'ok' && (!ss || REISSUE.has(ss))) P.push(K.shp(fid), 'carrier', 'create', { orderId: st.oid, fulfilmentId: fid, location: f.loc, ref: fid });
}

function cancelOrderR62(P) {
  const st = P.st;
  let blocked = false, locked = false;
  for (const fid of st.cx.set ?? []) {
    const f = st.F[fid];
    if (f.locked) { locked = true; continue; }
    const sC = shpCommitted(P, f);
    if (sC === null) { blocked = true; continue; }
    if (sC === true && f.cfail == null) { const s = st.E[K.cxl(fid)]?.s; if (s !== 'ok' && s !== 'x') blocked = true; }
  }
  if (blocked) return;
  if (locked) { st.cx.void = true; st.refuse = true; return; }
  P.setO('cancelled');
  P.notify(st.oid, 'order-cancelled', `Order ${st.oid} is cancelled (reason: ${st.cx.reason}); any payment is refunded.`);
}

function outcomeR45(P) {
  const st = P.st;
  const ss = st.fo.map(fid => fstat(st, fid));
  if (!ss.length || !ss.every(s => FEND.has(s))) return;
  let after;
  for (const fid of st.fo) {
    const k = fEndKey(st, fid);
    if (!k) continue;
    if (P.emitted.has(k)) after = k;
    else if (st.E[k]?.s !== 'ok' && st.E[k]?.s !== 'x') return;
  }
  P.setO(ss.includes('completed') ? 'completed' : ss.includes('failed') ? 'failed' : 'cancelled', after);
}

function plan(P) {
  const st = P.st;
  // R1.1 intake, R2.1 screening read
  if (!st.rec && !st.fo.length && (st.rd.a === 0 || st.rd.a === 4)) { P.read('inventory', 'allocate', { orderId: st.oid }); st.rd.a = 1; }
  if (st.nf && st.fraud == null && (st.rd.f === 0 || st.rd.f === 4)) { P.read('fraud', 'check', { orderId: st.oid }); st.rd.f = 1; }
  if (!st.rec && st.fo.length) {
    const s = P.settle('orders', K.create(st.oid));
    if (s === 'ok') st.rec = true;
    else P.push(K.create(st.oid), 'orders', 'create', createArgs(st));
  }
  if (!st.rec) return;
  const cxA = cxActive(st);
  // R3.1
  if (st.car && !st.act && !isOver(st)) {
    P.setO('customerActionRequired');
    P.notify(st.oid, 'action-required', `Some items of order ${st.oid} are unavailable: amend the order to continue without them, or cancel it.`);
  }
  // R3.2 amend: the unavailable fulfilments end
  if (st.act?.k === 'amend') for (const fid of st.fo) if (!st.F[fid].av) P.setF(fid, 'cancelled');
  // R6.1 cancel / R3.2 timeout
  if ((cxA && st.cx.kind === 'R61') || st.to) {
    for (const fid of st.fo) if (!FEND.has(fstat(st, fid))) P.setF(fid, 'cancelled');
    if (st.to) {
      P.setO('timedOut');
      P.notify(st.oid, 'order-timed-out', `Order ${st.oid} timed out: no amend or cancel arrived by the deadline.`);
    } else {
      P.setO('cancelled');
      P.notify(st.oid, 'order-cancelled', `Order ${st.oid} is cancelled (reason: ${st.cx.reason}).`);
    }
  } else if (st.ready != null) {
    // R4.1 processing, R4.2-R4.4 sagas, R5 failures, R6.2 compensation, R4.5 outcome
    if (!cxA && !OEND.has(ostat(st))) {
      P.setO('processing');
      for (const fid of st.fo) if (st.F[fid].av && fstat(st, fid) === 'pending') P.setF(fid, 'processing');
    }
    for (const fid of st.fo) {
      const f = st.F[fid];
      if (!f.av) continue;
      if (f.mode === 'cancel') compensateCancel(P, f);
      else if (f.mode === 'fail') compensateFail(P, f);
      if (f.mode !== 'cancel' || f.locked) { if (f.mode !== 'fail') saga(P, f); }
    }
    if (cxActive(st)) cancelOrderR62(P);
    else outcomeR45(P);
  }
  if (st.refuse) P.notify(st.oid, 'cancel-refused', `Order ${st.oid} can no longer be cancelled: part of it has been collected by the carrier.`);
}

// ------------------------------------------------------------------------------------------------------ routing

function openInstanceOf(ctx, oid, self) {
  if (!oid) return null;
  let rows = [];
  try { rows = ctx.instances({ subject: oid }) ?? []; } catch { rows = []; }
  return rows.filter(r => r.instance !== self).sort((a, b) => String(a.openedAt).localeCompare(String(b.openedAt)) || String(a.instance).localeCompare(String(b.instance)))[0] ?? null;
}
function queryOne(ctx, table, where) {
  try { return (ctx.query(table, { where, limit: 5 }) ?? [])[0] ?? null; } catch { return null; }
}
function orderOfCarrierMessage(ctx, pl) {
  const fr = norm(pl.fulfilmentRef) ?? norm(pl.ref);
  const f = fr ? queryOne(ctx, 'orders.fulfilments', { fulfilmentId: fr }) : null;
  if (f?.orderId) return norm(f.orderId);
  const s = pl.shipmentId ? queryOne(ctx, 'carrier.shipments', { shipmentId: pl.shipmentId }) : null;
  if (s?.orderId) return norm(s.orderId);
  const m = fr ? /^(.+)-F\d+$/.exec(fr) : null;
  return m ? m[1] : null;
}

/** First tick of an instance started by an inbound message: merge, close, or null to start an order here. */
function route(input, ctx, ev) {
  const pl = ev?.payload ?? {};
  const closeWith = subject => ({ decisions: { subject }, close: true, carry: null });
  const mergeInto = (oid, target) => ({ decisions: { subject: oid }, merge: { into: target.instance }, carry: null });
  const recorded = oid => Boolean(oid && queryOne(ctx, 'orders.orders', { orderId: oid }));
  switch (ev?.type) {
    case 'order.placed': {
      const oid = norm(pl.orderId);
      if (!oid) return closeWith(null);
      const target = openInstanceOf(ctx, oid, input.instance);
      if (target) return mergeInto(oid, target);
      if (recorded(oid)) return closeWith(oid); // R1.4
      return null;
    }
    case 'customer.action': {
      const oid = norm(pl.orderRef);
      const target = openInstanceOf(ctx, oid, input.instance);
      if (target) return mergeInto(oid, target);
      return closeWith(recorded(oid) ? oid : null); // §3.2: an unknown order is answered with nothing
    }
    case 'carrier.status': {
      const oid = orderOfCarrierMessage(ctx, pl);
      const target = openInstanceOf(ctx, oid, input.instance);
      if (target) return mergeInto(oid, target);
      return closeWith(recorded(oid) ? oid : null); // the order has ended: the message changes nothing
    }
    default: return closeWith(null);
  }
}

// --------------------------------------------------------------------------------------------------------- tick

function tick(input, ctx) {
  const now = t(input.now);
  const evs = [...(input.events ?? [])].sort(cmpEv);
  let st = input.carry;
  if (!st) {
    const first = evs[0];
    if (!first) return { decisions: { subject: null }, carry: null };
    if (first.type === 'migration') {
      const { st: s, evs: past } = fromMigration(first, ctx);
      if (!s) return { decisions: { subject: null }, close: true, carry: null };
      st = s;
      evs.shift();
      for (const e of past) if (e.type !== 'order.placed') handle(st, e, ctx);
    } else {
      const routed = route(input, ctx, first);
      if (routed) return routed;
      st = fromPlaced(first, ctx);
      evs.shift();
    }
  }
  for (const ev of evs) handle(st, ev, ctx);
  const P = new Out(st, ctx, now);
  transitions(st, P);
  plan(P);
  const out = { decisions: { subject: st.oid } };
  if (P.effects.length) out.effects = P.effects;
  if (P.up.length || P.cancel.length) out.obligations = { upsert: P.up, cancel: P.cancel };
  if (P.tasks.length) out.humanTasks = P.tasks;
  const inFlight = Object.values(st.E).some(e => e.s === 'f') || st.rd.a === 1 || st.rd.f === 1;
  if (orderDone(st) && !inFlight && !P.effects.length && !P.tasks.length && !st.q.length) { out.close = true; out.carry = null; }
  else out.carry = st;
  return out;
}

export function createSolver() {
  return { id: 's1-state-machine', tick };
}
