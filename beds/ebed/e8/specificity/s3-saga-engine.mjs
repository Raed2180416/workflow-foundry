// E8 specificity solver S3: "saga orchestrator with pipelined effects and per-fulfilment child instances avoided".
// Written from beds/ebed/e8/spec/SPEC-E.md only (plus the arm interface: BED-CONTRACT v1.1 §3.1-§3.4, host README
// §2-§4, e8/systems.mjs, host/output.mjs). Pure JS, Node 24 ESM, no dependencies, no wall clock, no randomness, no
// model calls. Purpose: an independent correct arm, to test whether the grader wrongly rejects correct solvers.
//
// DESIGN
// - One instance per order (subject = normalised order id, SPEC §1, §3.1). No per-fulfilment child instances: each
//   fulfilment is a saga *inside* the order instance, described as data (steps reserve -> charge -> ship, each with
//   its undo release <- refund <- cancel, SPEC R4.2, R5.1).
// - A small generic saga engine (bottom of the file) works on "units": one content-addressed idempotency key per
//   logical effect (`create:<order>`, `st:<order>:<fulfilment|->:<status>`, `rsv:<fulfilment>:<sku>`, `chg:<f>`,
//   `shp:<f>`, `cxl:<f>`, `rfd:<f>`, `rel:<f>:<sku>`, `ntf:<about>:<template>`), each with a recorded state
//   (in flight, ok, needs re-issue, unknown, permanently failed). Every tick the business layer re-declares the units
//   the rules require *now* (with ordering dependencies) and the engine emits only the ones not yet done:
//   * forward executor: a dependency emitted in the same output becomes `after: <key>` (pipelining: statuses and the
//     first reservation batch after `create`; ship after charge; `completed` after `dispatched`; order outcome after
//     the fulfilment status that ended the last fulfilment; notifications after their status); a dependency still in
//     flight from an earlier output makes the unit wait (`after` only names effects of the same output); a
//     dependency that ended badly is ignored (business logic decides whether the unit is still wanted).
//   * compensation planner: on failure or stop, it computes the committed forward units of the fulfilment (own
//     results, and `ctx.status(system, key)` for unknown or in-flight outcomes: S2), waits while any of them is
//     still pending (so undo stays in reverse commit order), then emits cancel -> refund (after cancel) -> releases
//     (after refund) as one pipelined group. A committed key is never undone twice (keys are stable, states kept).
// - Reads that are effects (inventory.allocate, fraud.check) carry a correlation key; they are not keyed ops.
// - Field renames (F5): arguments are always built under internal names and adapted to `api/<system>.schema.json`
//   at emission (schema diff by required-ness and name similarity, plus renames learnt from `400 field-renamed`
//   details); a 400 is re-issued with the same key (R4.2). After 3 rejected re-issues the unit is given up.
// - Routing (SPEC §1, §3.2, §3.5): the first tick of a message-started instance merges into the open instance whose
//   declared subject is the normalised order id (customer actions by orderRef, carrier messages without a live ref
//   by fulfilmentRef -> orders.fulfilments -> orderId, duplicate placed orders by orderId); otherwise it handles the
//   message itself (a recorded order: nothing to do; no order: nothing, subject null) and closes. Two same-instant
//   placements of one order: the higher instance id yields (closes before any business effect) on its second tick.
// - Order instances close when the order and all its fulfilments have ended and no unit is in flight.
//
// AMBIGUITY READINGS (each a deliberate choice; cited sections are SPEC-E unless noted)
// A1 R1.3: the edition is chosen once at intake from `rulebook/*/edition.json` (latest effectiveFrom <= local date of
//    p) and kept in the carry for the whole order (fees, policy hours, carrier codes). Carrier codes are matched
//    exactly on (carrier, code) in that edition's table; a code it does not list is `info` (§3.3).
// A2 R1.1/R4.1 "nothing before the order is recorded": every status, reservation and notification of an order created
//    by this arm depends on `create:<order>` (pipelined with `after` when emitted together).
// A3 R2.2 + coordinator amendment: the review deadline is first-task-creation + fraudReviewHours; every task (and
//    re-ask) gets dueAt = that deadline; an answer counts iff it carries decision approve|reject and its event time is
//    <= deadline (the `late` flag is ignored); re-ask (new task id) after answerRejected, withdrawn or an answer
//    without a usable decision, only while now < deadline; timeout cancel is taken by an own timer at deadline + 1 min
//    (strictly after the deadline, S1). answerSchema requires `decision` (enum), extra fields allowed.
// A4 R3.2 + S1: the customer timeout is taken by an own timer at D + 1 min (strictly after D; an action at D wins).
//    If the order is cleared only after D (long fraud review), R3.1 is still done and the timeout follows at once.
// A5 R3.2/S5/R6.2 for orders that had unavailable fulfilments ("R3 orders"): only the first action at or before D
//    counts; any later action (including a cancel while the amended order is processing) changes nothing (R3.2 "later
//    actions and repeats change nothing", S5). R6.2 applies to orders that never had unavailable fulfilments. R6.4
//    (cancel while the review is open) applies to every order, whatever D.
// A6 An amend that counts while the fraud review is still open (time <= D): unavailable fulfilments are cancelled
//    within 60 min of it; the order is then ready when cleared (no R3.1, nothing is unavailable any more); if nothing
//    is available it is cancelled with reason `nothing-available`.
// A7 R6.1 "every fulfilment that is not completed, failed or cancelled" includes `unavailable` ones (set cancelled).
// A8 R6.2/S4/S6/S7: a cancel at time a is refused iff a carrier report meaning collected, inTransit or delivered
//    that has reached the instance when it acts has reportedAt <= a (S7; the shipment record is not consulted).
//    Same-instant reports are processed first (events sorted by time, carrier messages before customer actions). A
//    refused cancel gets one `cancel-refused` per order (key per order and template).
// A9 R6.2 stop: compensation of a fulfilment waits while any of its forward units is still pending (`status(key)`
//    pending or result not yet seen), so a step that commits after the cancel is undone after its commit and undo
//    stays in reverse order. If `carrier.cancel` answers 409 already-collected (collection raced the cancel), the
//    fulfilment cannot be compensated: its `cancelled` status (chained after the cancel) is dropped and it continues
//    on carrier messages. The order's own `cancelled` status and notification are not chained to compensation.
// A10 R5.2 failures: a permanent/declined/non-retryable business error of reserve (item), charge or ship; and a
//    carrier `collectionFailed` unless a collection was already reported for that fulfilment (never regress). 409
//    answers that mean "already in that state" (already-reserved, shipment-exists, no-active-reservation,
//    over-refund, not-cancellable; 404 no-shipment/no-charge on undo) are treated as done, not as failures.
// A11 R4.4: collected / inTransit / delivered are recorded as facts even for a fulfilment already ended; statuses
//    move only forward (each status at most once, by key). `dispatched` is set before `completed` (chained).
// A12 Optional notifications (`unknown-order`, `cancel-refused` for ended orders) are not sent.
// A13 §3.5 go-live: records are taken as committed facts (pseudo unit states for reservations, charges, refunds,
//    shipments, notifications); a recorded order `customerActionRequired` waits for D from p; `processing` continues
//    each fulfilment from its last committed step; a recorded `pending` order re-reads fraud.check; an unrecorded one
//    is a new order at t0. Pre-go-live carrier messages start new instances and are merged by fulfilmentRef.
// A14 Pre-go-live times unknown to the export (when cleared/ready) are taken as p; they only matter for windows
//    already in the past.
// A15 The cancel reason (R2, R3.2, R6) is stated in the notification text and in `decisions.reason`.

const MIN = 60_000;
const HOUR = 3_600_000;
const ID = 's3-saga-engine';

// ---------------------------------------------------------------------------------------------------------------
// Time (Europe/Amsterdam, CET/CEST by the EU rule) and identifiers
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const toMs = s => { const t = Date.parse(s); return Number.isFinite(t) ? t : null; };
function lastSundayUtc(y, m) { const d = new Date(Date.UTC(y, m + 1, 0)); return Date.UTC(y, m, d.getUTCDate() - d.getUTCDay(), 1); }
function offMin(t) { const y = new Date(t).getUTCFullYear(); return t >= lastSundayUtc(y, 2) && t < lastSundayUtc(y, 9) ? 120 : 60; }
function iso(t) { const o = offMin(t); return new Date(t + o * MIN).toISOString().slice(0, 19) + (o === 120 ? '+02:00' : '+01:00'); }
function localDate(t) { return new Date(t + offMin(t) * MIN).toISOString().slice(0, 10); }
const normId = s => (typeof s === 'string' ? s.trim().replace(/^#/, '').trim().toUpperCase() : null);

function jf(ctx, path) {
  const t = ctx.files?.[path];
  if (typeof t !== 'string') return null;
  try { return JSON.parse(t); } catch { return null; }
}

function editions(ctx) {
  const out = [];
  for (const f of Object.keys(ctx.files ?? {}).sort()) {
    const m = /^rulebook\/([^/]+)\/edition\.json$/.exec(f);
    if (!m) continue;
    const j = jf(ctx, f);
    if (j && typeof j.effectiveFrom === 'string') out.push({ dir: m[1], from: j.effectiveFrom.slice(0, 10) });
  }
  return out.sort((a, b) => (a.from < b.from ? 1 : a.from > b.from ? -1 : a.dir < b.dir ? 1 : -1));   // newest first
}

function pickEdition(ctx, pMs) {
  const d = localDate(pMs);
  const e = editions(ctx).find(x => x.from <= d);
  if (e) return e.dir;
  const dirs = [...new Set(Object.keys(ctx.files ?? {}).map(f => /^rulebook\/([^/]+)\//.exec(f)?.[1]).filter(Boolean))].sort();
  return dirs[0] ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Argument adaptation to the current API schema (F5 renames)
const OPTIONAL_ARGS = new Set(['ref', 'key']);
function lcs(a, b) {
  const x = a.toLowerCase().replace(/[^a-z0-9]/g, ''), y = b.toLowerCase().replace(/[^a-z0-9]/g, '');
  const dp = Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) { let prev = 0; for (let j = 1; j <= y.length; j++) { const tmp = dp[j]; dp[j] = x[i - 1] === y[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]); prev = tmp; } }
  return dp[y.length] / Math.max(1, x.length, y.length);
}
function adapt(val, node, learned) {
  if (Array.isArray(val)) return val.map(v => adapt(v, node?.items, learned));
  if (!isObj(val) || !isObj(node) || !isObj(node.properties)) return val;
  const props = Object.keys(node.properties);
  const req = new Set(Array.isArray(node.required) ? node.required : []);
  const out = {};
  const unmatched = [];
  for (const k of Object.keys(val)) {
    if (props.includes(k)) out[k] = adapt(val[k], node.properties[k], learned);
    else if (learned[k] && props.includes(learned[k]) && !(learned[k] in val)) out[learned[k]] = adapt(val[k], node.properties[learned[k]], learned);
    else unmatched.push(k);
  }
  for (const k of unmatched) {
    const free = props.filter(p => !(p in out) && !(p in val));
    const cls = free.filter(p => req.has(p) === !OPTIONAL_ARGS.has(k));
    const pool = cls.length ? cls : free;
    let best = null;
    if (pool.length === 1) best = pool[0];
    else if (pool.length > 1) best = pool.map(p => [lcs(k, p), p]).sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : 1))[0][1];
    if (best) out[best] = adapt(val[k], node.properties[best], learned);
    else out[k] = val[k];
  }
  return out;
}
function apiArgs(ctx, S, system, op, args) {
  const node = jf(ctx, `api/${system}.schema.json`)?.ops?.[op]?.args;
  return node ? adapt(args, node, S.rn?.[`${system}.${op}`] ?? {}) : args;
}

// ---------------------------------------------------------------------------------------------------------------
// Unit keys and systems
const SYS = { alloc: 'inventory', fraud: 'fraud', create: 'orders', st: 'orders', rsv: 'inventory', rel: 'inventory', chg: 'billing', rfd: 'billing', shp: 'carrier', cxl: 'carrier', ntf: 'notify' };
const sysOf = key => SYS[key.slice(0, key.indexOf(':'))];
const K = {
  alloc: o => `alloc:${o}`, fraud: o => `fraud:${o}`, create: o => `create:${o}`,
  st: (o, f, s) => `st:${o}:${f ?? '-'}:${s}`,
  rsv: (f, sku) => `rsv:${f}:${sku}`, rel: (f, sku) => `rel:${f}:${sku}`,
  chg: f => `chg:${f}`, rfd: f => `rfd:${f}`, shp: f => `shp:${f}`, cxl: f => `cxl:${f}`,
  ntf: (about, t) => `ntf:${about}:${t}`,
};

// Outcome classification of one effect result (or batch item): unit state + note.
const DONE_409 = new Set(['already-reserved', 'shipment-exists', 'no-active-reservation', 'over-refund', 'not-cancellable']);
function classify(o) {
  if (o.status === 'ok') return ['ok'];
  if (o.status === 'unknown') return ['q'];
  if (o.status === 'rate-limited') return ['r', 'rate-limited'];
  const e = isObj(o.error) ? o.error : {};
  const code = e.code, reason = e.reason;
  if (code === 'predecessor-failed' || code === 'predecessor-unknown') return ['r', code];
  if (code === 400) return ['r400', String(reason)];
  if (code === 409 && reason === 'already-collected') return ['col', reason];
  if (code === 409 && DONE_409.has(reason)) return ['ok', reason];
  if (code === 404 && (reason === 'no-shipment' || reason === 'no-charge')) return ['ok', reason];
  if (e.retryable === true) return ['r', String(reason)];
  return ['x', `${code}:${reason}`];
}

// ---------------------------------------------------------------------------------------------------------------
// Statuses (R7.2: forward only, each at most once)
const ORANK = { pending: 0, customerActionRequired: 1, processing: 2, completed: 3, failed: 3, cancelled: 3, timedOut: 3 };
const FRANK = { unavailable: 0, pending: 0, processing: 1, dispatched: 2, completed: 3, failed: 3, cancelled: 3 };
const cur = e => (e.path.length ? e.path[e.path.length - 1] : e.base);
const oCur = S => cur(S.os);
const oEnded = S => ORANK[oCur(S)] === 3;
const fEnded = F => FRANK[cur(F)] === 3;
function pushStatus(S, fid, status) {
  const e = fid === null ? S.os : S.f[fid];
  const R = fid === null ? ORANK : FRANK;
  const c = cur(e);
  if (R[c] === 3 || !(R[status] > R[c])) return false;
  e.path.push(status);
  return true;
}
const fids = S => S.fo;

// ---------------------------------------------------------------------------------------------------------------
// Business layer: one order, its fulfilment sagas

function emailOf(ctx, customerId) {
  const rows = jf(ctx, 'master/customers.json');
  return (Array.isArray(rows) ? rows.find(r => r.customerId === customerId)?.email : null) ?? null;
}

function newOrder(input, base) {
  return {
    v: 1, kind: 'order', self: input.instance, ticks: 0, origin: base.origin,
    oid: base.oid, p: base.p, pMs: toMs(base.p), cust: base.cust, cur: base.cur ?? 'EUR', items: base.items,
    ed: null, pol: null, email: null,
    alloc: null, verdict: null, needAlloc: true, needVerdict: true, intake: false, recorded: null,
    os: { base: 'pending', path: [] }, f: {}, fo: [],
    hadUnav: false, cleared: null, ready: null, waiting: false, D: null, amended: null, act: null,
    rv: { first: null, dl: null, n: 0, open: null, decided: null },
    cx: null, refused: false, queue: [], ntf: [], tm: {}, u: {}, rn: {},
  };
}

function setEdition(S, ctx) {
  if (S.ed) return;
  S.ed = pickEdition(ctx, S.pMs);
  const pol = jf(ctx, `rulebook/${S.ed}/policy.json`) ?? {};
  S.pol = { cah: Number(pol.customerActionHours ?? 0), frh: Number(pol.fraudReviewHours ?? 0) };
}

function addF(S, f) {
  S.f[f.id] = { base: f.base, path: [], loc: f.loc, items: f.items, amt: f.amt, av: f.loc !== null,
    col: null, del: null, cf: null, fail: null, comp: false, pivot: false };
  S.fo.push(f.id);
  if (f.loc === null) S.hadUnav = true;
}

function notify(S, ctx, about, template, text, dep, to) {
  const key = K.ntf(about, template);
  if (S.ntf.some(n => n.key === key)) return;
  S.ntf.push({ key, about, template, text, dep: dep ?? null, to: to ?? null });
}

function timer(S, out, id, dueMs, onDue) {
  if (S.tm[id] === dueMs) return;
  S.tm[id] = dueMs;
  out.obligations.upsert.push({ id, kind: 'deadline', anchor: S.oid, dueAt: iso(dueMs), onDue });
}
function dropTimer(S, out, id) {
  if (S.tm[id] === undefined || S.tm[id] === null) return;
  S.tm[id] = null;
  out.obligations.cancel.push(id);
}

// --- transitions -------------------------------------------------------------------------------------------------
function checkOutcome(S) {
  if (oCur(S) !== 'processing') return;
  const fs = fids(S).map(id => S.f[id]);
  if (!fs.every(fEnded)) return;
  const st = fs.some(F => cur(F) === 'completed') ? 'completed' : fs.some(F => cur(F) === 'failed') ? 'failed' : 'cancelled';
  pushStatus(S, null, st);
}

function ready(S, t) {
  if (S.ready !== null || oEnded(S)) return;
  S.ready = t;
  pushStatus(S, null, 'processing');
  for (const id of fids(S)) if (S.f[id].av) pushStatus(S, id, 'processing');
}

function cancelOrder(S, ctx, out, t, reason) {
  if (oEnded(S) || S.cx) return;
  S.cx = { at: t, reason };
  S.waiting = false;
  dropTimer(S, out, 't-action');
  dropTimer(S, out, 't-review');
  for (const id of fids(S)) {
    const F = S.f[id];
    if (fEnded(F)) continue;
    F.comp = true;
    pushStatus(S, id, 'cancelled');
  }
  pushStatus(S, null, 'cancelled');
  notify(S, ctx, S.oid, 'order-cancelled', `Your order ${S.oid} has been cancelled (reason: ${reason}).`, K.st(S.oid, null, 'cancelled'));
}

function timeoutOrder(S, ctx, out) {
  if (oEnded(S)) return;
  S.waiting = false;
  dropTimer(S, out, 't-action');
  for (const id of fids(S)) if (!fEnded(S.f[id])) pushStatus(S, id, 'cancelled');
  pushStatus(S, null, 'timedOut');
  notify(S, ctx, S.oid, 'order-timed-out', `Your order ${S.oid} timed out: no amend or cancel was received in time.`, K.st(S.oid, null, 'timedOut'));
}

function startWaiting(S, ctx, out, now) {
  S.waiting = true;
  pushStatus(S, null, 'customerActionRequired');
  notify(S, ctx, S.oid, 'action-required', `Some items of order ${S.oid} are unavailable: please amend or cancel the order.`, K.st(S.oid, null, 'customerActionRequired'));
  S.D = S.pMs + S.pol.cah * HOUR;
  if (now > S.D) timeoutOrder(S, ctx, out);           // cleared only after D (A4): the window can only be met late
  else timer(S, out, 't-action', S.D + MIN, 'customer-action-timeout');
}

function clear(S, ctx, out, t, now) {
  if (S.cleared !== null || oEnded(S)) return;
  S.cleared = t;
  if (S.amended !== null) return ready(S, t);          // A6: amended during review, nothing unavailable any more
  if (fids(S).some(id => !S.f[id].av && !fEnded(S.f[id]))) return startWaiting(S, ctx, out, now);
  ready(S, t);
}

function failF(S, ctx, fid, t) {
  const F = S.f[fid];
  if (!F || fEnded(F) || F.fail !== null) return;
  F.fail = t;
  F.comp = true;
  pushStatus(S, fid, 'failed');
  notify(S, ctx, fid, 'fulfilment-failed', `Part ${fid} of order ${S.oid} could not be fulfilled; any charge for it is refunded.`, K.st(S.oid, fid, 'failed'));
  checkOutcome(S);
}

function askReview(S, out, now) {
  if (S.rv.first === null) {
    S.rv.first = now;
    S.rv.dl = now + S.pol.frh * HOUR;
    timer(S, out, 't-review', S.rv.dl + MIN, 'fraud-review-timeout');
  }
  if (now >= S.rv.dl) return;
  S.rv.n += 1;
  const id = `fr-${S.oid}-${S.rv.n}`;
  S.rv.open = id;
  out.humanTasks.push({
    id, kind: 'fraudReview', role: 'fraudAnalyst', subject: S.oid,
    question: `Fraud review of order ${S.oid} (customer ${S.cust}, placed ${S.p}): approve or reject the order?`,
    answerSchema: { type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['approve', 'reject'] } } },
    dueAt: iso(S.rv.dl), onTimeout: 'expire',
  });
}

function intakeDecision(S, ctx, out, now) {
  if (S.intake || !S.alloc || !S.verdict) return;
  S.intake = true;
  if (S.fo.length === 0) {
    const cat = jf(ctx, 'master/catalog.json') ?? [];
    const fees = jf(ctx, `rulebook/${S.ed}/shipping-fees.json`) ?? [];
    const price = sku => Number(cat.find(c => c.sku === sku)?.unitPriceMinor ?? 0);
    for (const a of S.alloc) {
      const loc = a.available === false || a.location === null || a.location === undefined ? null : a.location;
      const amt = a.items.reduce((s, it) => s + it.qty * price(it.sku), 0) + (loc === null ? 0 : Number(fees.find(x => x.location === loc)?.feeMinor ?? 0));
      addF(S, { id: a.fulfilmentId, loc, items: a.items.map(it => ({ sku: it.sku, qty: it.qty })), amt, base: loc === null ? 'unavailable' : 'pending' });
    }
    S.recorded = 'me';
  }
  S.alloc = [];                                                         // the fulfilments now live in S.f
  const q = S.queue.splice(0);
  if (S.verdict === 'reject') cancelOrder(S, ctx, out, now, 'fraud');
  else if (S.verdict === 'pass') clear(S, ctx, out, S.pMs, now);
  else if (S.verdict === 'review' && S.cleared === null) askReview(S, out, now);
  for (const a of q) handleAction(S, ctx, out, a.at, a.action, now);
}

// --- inbound business events -------------------------------------------------------------------------------------
function handleAction(S, ctx, out, a, action, now) {
  if (!S.intake) { S.queue.push({ at: a, action }); return; }
  if (oEnded(S) || S.cx) return;                                        // R6.3 second sentence, repeats (A12)
  if (action !== 'amend' && action !== 'cancel') return;
  const D = S.pMs + S.pol.cah * HOUR;
  if (S.hadUnav) {                                                      // R3 order (A5)
    if (S.act) return;                                                  // only the first counted action
    if (a > D) {
      if (S.cleared === null && action === 'cancel') cancelOrder(S, ctx, out, a, 'customer');   // R6.4
      return;                                                           // S5
    }
    S.act = { at: a, action };
    if (action === 'cancel') return cancelOrder(S, ctx, out, a, 'customer');
    for (const id of fids(S)) if (!S.f[id].av) pushStatus(S, id, 'cancelled');
    S.waiting = false;
    dropTimer(S, out, 't-action');
    if (!fids(S).some(id => S.f[id].av && !fEnded(S.f[id]))) return cancelOrder(S, ctx, out, a, 'nothing-available');
    if (S.cleared !== null) ready(S, a);
    else S.amended = a;                                                 // A6
    return;
  }
  if (action === 'amend') return;                                       // S5
  if (S.cleared === null) return cancelOrder(S, ctx, out, a, 'customer');                     // R6.4
  const collected = fids(S).some(id => S.f[id].col !== null && S.f[id].col <= a);             // R6.2, S4, S6, S7
  if (collected) {
    if (!S.refused) { S.refused = true; notify(S, ctx, S.oid, 'cancel-refused', `Order ${S.oid} can no longer be cancelled: a shipment has already been collected.`, null); }
    return;
  }
  cancelOrder(S, ctx, out, a, 'customer');                              // R6.2 stop + compensate
}

// §3.3: the order's edition table only (R1.3); a code it does not list is `info`.
function meaningOf(ctx, S, carrier, code) {
  const rows = jf(ctx, `rulebook/${S.ed}/carrier-codes.json`);
  if (!Array.isArray(rows)) return 'info';
  const r = rows.find(x => x.carrier === carrier && x.code === code);
  return ['collected', 'inTransit', 'delivered', 'collectionFailed'].includes(r?.meaning) ? r.meaning : 'info';
}

function handleCarrier(S, ctx, ev) {
  const pl = isObj(ev.payload) ? ev.payload : {};
  let fid = normId(pl.fulfilmentRef);
  if (!S.f[fid] && typeof pl.ref === 'string' && pl.ref.startsWith('R-')) fid = pl.ref.slice(2);
  const F = S.f[fid];
  if (!F) return;
  const carrier = pl.carrier ?? (jf(ctx, 'master/locations.json') ?? []).find(l => l.location === F.loc)?.carrier ?? null;
  const m = meaningOf(ctx, S, carrier, pl.code);
  const at = toMs(ev.at);
  const t = toMs(pl.reportedAt) ?? at;                                  // §3.3: the time of a report is its reportedAt
  if (m === 'collected' || m === 'inTransit' || m === 'delivered') F.col = F.col === null ? t : Math.min(F.col, t);
  if (m === 'delivered') F.del = F.del === null ? t : Math.min(F.del, t);
  if (S.u[K.cxl(fid)]?.s === 'ok') return;                             // a shipment we cancelled: nothing
  if (fEnded(F)) return;                                                // completed / failed / cancelled: nothing
  if (m === 'collected') pushStatus(S, fid, 'dispatched');
  else if (m === 'delivered') { pushStatus(S, fid, 'dispatched'); pushStatus(S, fid, 'completed'); checkOutcome(S); }
  else if (m === 'collectionFailed' && F.col === null) { F.cf = t; failF(S, ctx, fid, t); }
}

function handleTask(S, ctx, out, ev, now) {
  const pl = isObj(ev.payload) ? ev.payload : {};
  const mine = typeof pl.taskId === 'string' && pl.taskId.startsWith(`fr-${S.oid}-`);
  if (!mine || S.rv.decided || S.cx || oEnded(S) || S.rv.dl === null) return;
  const at = toMs(ev.at);
  if (ev.type === 'humanTask.answered') {
    const d = isObj(pl.answer) ? pl.answer.decision : undefined;
    if ((d === 'approve' || d === 'reject') && at <= S.rv.dl) {
      S.rv.decided = d;
      dropTimer(S, out, 't-review');
      if (d === 'approve') clear(S, ctx, out, at, now);
      else cancelOrder(S, ctx, out, at, 'fraud');
      return;
    }
    if (d === 'approve' || d === 'reject') return;                    // after the deadline: changes nothing
  } else if (ev.type !== 'humanTask.answerRejected' && ev.type !== 'humanTask.withdrawn') return;
  if (pl.taskId === S.rv.open && now < S.rv.dl) askReview(S, out, now);   // unusable / rejected / withdrawn: ask again
}

function handleTimer(S, ctx, out, ev) {
  const id = ev.payload?.obligationId;
  if (S.tm[id] === undefined || S.tm[id] === null) return;
  S.tm[id] = null;
  if (id === 't-action' && S.waiting && !S.act && !oEnded(S)) timeoutOrder(S, ctx, out);
  if (id === 't-review' && !S.rv.decided && !S.cx && !oEnded(S) && S.cleared === null) {
    S.rv.decided = 'timeout';
    cancelOrder(S, ctx, out, toMs(ev.at), 'fraud-review-timeout');
  }
}

function handleResult(S, ctx, ev) {
  const pl = isObj(ev.payload) ? ev.payload : {};
  const rows = Array.isArray(pl.items) ? pl.items : [pl];
  if (!Array.isArray(pl.items) && typeof pl.key !== 'string' && pl.system === 'inventory' && pl.op === 'reserve') {
    // A batch rejected as a whole (400 before any item, or predecessor-failed) carries no key and no items: note it and
    // reconcile every in-flight reservation item through status(key) once the tick's results are in (reconcileBatches).
    const [s] = classify(pl);
    S.batchErr = { s, e: pl.error ?? null };
    const e = pl.error ?? {};
    if (e.reason === 'field-renamed' && typeof e.field === 'string' && typeof e.renamedTo === 'string') (S.rn['inventory.reserve'] ??= {})[e.field] = e.renamedTo;
    return;
  }
  for (const r of rows) {
    if (typeof r.key !== 'string') continue;
    const key = r.key;
    const [s, note] = classify(r);
    const u = S.u[key] ?? (S.u[key] = {});
    if (s === 'r400') {
      u.n400 = (u.n400 ?? 0) + 1;
      const e = r.error ?? {};
      if (e.reason === 'field-renamed' && typeof e.field === 'string' && typeof e.renamedTo === 'string') {
        const m = (S.rn[`${pl.system}.${pl.op}`] ??= {});
        m[e.field] = e.renamedTo;
      }
      u.s = u.n400 > 3 ? 'x' : 'r';
    } else u.s = s;
    if (note) u.e = note; else delete u.e;
    const kind = key.slice(0, key.indexOf(':'));
    if (s === 'ok' && kind === 'alloc' && isObj(r.result) && Array.isArray(r.result.fulfilments)) S.alloc = r.result.fulfilments;
    if (s === 'ok' && kind === 'fraud' && isObj(r.result)) S.verdict = ['pass', 'review', 'reject'].includes(r.result.verdict) ? r.result.verdict : 'review';
    if (u.s === 'x' && (kind === 'rsv' || kind === 'chg' || kind === 'shp')) {
      const fid = kind === 'rsv' ? key.slice(4, key.lastIndexOf(':')) : key.slice(4);
      const F = S.f[fid];
      if (F && !F.comp) failF(S, ctx, fid, toMs(ev.at) - MIN);            // R5.2: time of the failed attempt
    }
    if (s === 'col' && kind === 'cxl') pivot(S, key.slice(4));
  }
}

// A9: carrier.cancel refused because the carrier already collected: the fulfilment cannot be compensated.
function pivot(S, fid) {
  const F = S.f[fid];
  if (!F || F.pivot) return;
  F.pivot = true;
  F.comp = false;
  const k = K.st(S.oid, fid, 'cancelled');
  if (S.u[k]?.s !== 'ok') F.path = F.path.filter(s => s !== 'cancelled');
  if (fEnded(F) || F.col === null) return;                              // statuses follow the carrier's messages
  pushStatus(S, fid, 'dispatched');
  if (F.del !== null) { pushStatus(S, fid, 'completed'); checkOutcome(S); }
}

// --- go-live (§3.5) ------------------------------------------------------------------------------------------------
function fromMigration(input, ctx, ev, out, now) {
  const pl = isObj(ev.payload) ? ev.payload : {};
  const recs = isObj(pl.records) ? pl.records : {};
  const evs = (Array.isArray(pl.events) ? pl.events : []).slice().sort((a, b) => (toMs(a.at) - toMs(b.at)) || (a.id < b.id ? -1 : 1));
  const placed = evs.find(e => e.type === 'order.placed')?.payload ?? {};
  const o = (recs['orders.orders'] ?? [])[0];
  const oid = normId(o?.orderId ?? placed.orderId);
  const S = newOrder(input, { origin: 'migration', oid, p: placed.placedAt ?? o?.placedAt, cust: o?.customerId ?? placed.customerId, cur: o?.currency ?? placed.currency, items: o?.items ?? placed.items });
  setEdition(S, ctx);
  S.email = emailOf(ctx, S.cust);
  if (o) {
    S.recorded = 'pre';
    S.needAlloc = false;
    S.alloc = [];
    S.os.base = o.status;
    for (const f of recs['orders.fulfilments'] ?? []) {
      if (normId(f.orderId) !== oid) continue;
      addF(S, { id: f.fulfilmentId, loc: f.location ?? null, items: f.items, amt: f.amountMinor, base: f.status });
      S.alloc.push({ fulfilmentId: f.fulfilmentId, location: f.location, items: f.items, available: f.location !== null });
    }
    const ok = key => { S.u[key] = { s: 'ok', pre: 1 }; };
    for (const r of recs['inventory.reservations'] ?? []) { if (!S.f[r.fulfilmentId]) continue; ok(K.rsv(r.fulfilmentId, r.sku)); if (r.status === 'released') ok(K.rel(r.fulfilmentId, r.sku)); }
    for (const c of recs['billing.charges'] ?? []) { if (!S.f[c.fulfilmentId]) continue; ok(K.chg(c.fulfilmentId)); if ((c.refundedMinor ?? 0) >= c.amountMinor) ok(K.rfd(c.fulfilmentId)); }
    for (const r of recs['billing.refunds'] ?? []) if (S.f[r.fulfilmentId]) ok(K.rfd(r.fulfilmentId));
    for (const sh of recs['carrier.shipments'] ?? []) {
      const F = S.f[sh.fulfilmentId];
      if (!F) continue;
      ok(K.shp(sh.fulfilmentId));
      if (sh.status === 'cancelled') ok(K.cxl(sh.fulfilmentId));
      if (['collected', 'inTransit', 'delivered'].includes(sh.status) && F.col === null) F.col = toMs(sh.createdAt) ?? 0;
      if (sh.status === 'delivered' && F.del === null) F.del = toMs(sh.createdAt) ?? 0;
      if (sh.status === 'failed') F.cf = toMs(sh.createdAt) ?? 0;
    }
    for (const n of recs['notify.notifications'] ?? []) if (typeof n.about === 'string') {
      ok(K.ntf(n.about, n.template));
      S.ntf.push({ key: K.ntf(n.about, n.template), about: n.about, template: n.template, text: n.text ?? '', dep: null, to: n.to ?? null });
    }
    const st = o.status;
    if (st === 'pending') { S.needVerdict = true; }
    else {
      S.needVerdict = false;
      S.intake = true;
      S.verdict = 'pass';
      if (st === 'customerActionRequired') {
        S.cleared = S.pMs;
        S.waiting = true;
        S.D = S.pMs + S.pol.cah * HOUR;
        notify(S, ctx, S.oid, 'action-required', `Some items of order ${S.oid} are unavailable: please amend or cancel the order.`, null);
        if (now > S.D) timeoutOrder(S, ctx, out); else timer(S, out, 't-action', S.D + MIN, 'customer-action-timeout');
      } else if (st === 'processing') {
        S.cleared = S.pMs;
        S.ready = S.pMs;
        for (const id of fids(S)) { const F = S.f[id]; if (F.base === 'failed' || F.base === 'cancelled') F.comp = false; }
      }
    }
  }
  for (const e of evs) {
    if (e.type === 'carrier.status') handleCarrier(S, ctx, { ...e, payload: e.payload });
    else if (e.type === 'customer.action') handleAction(S, ctx, out, toMs(e.at), e.payload?.action, now);
  }
  return S;
}

// --- planner: the units the rules require now -------------------------------------------------------------------
function commitOf(S, ctx, key) {
  const s = S.u[key]?.s;
  if (s === 'ok') return 'c';
  if (s === 'f' || s === 'q') {
    let r = 'not-found';
    try { r = ctx.status(sysOf(key), key); } catch { r = 'not-found'; }
    if (r === 'committed') return 'c';
    if (r === 'pending' || s === 'f') return 'w';
    return 'n';
  }
  return 'n';
}

function reconcileBatches(S, ctx) {
  const be = S.batchErr;
  if (!be) return;
  delete S.batchErr;
  for (const [key, u] of Object.entries(S.u)) {
    if (!key.startsWith('rsv:') || u.s !== 'f') continue;
    let r = 'not-found';
    try { r = ctx.status('inventory', key); } catch { r = 'not-found'; }
    if (r === 'committed') { u.s = 'ok'; continue; }
    if (r === 'pending') continue;
    if (be.s === 'r400') { u.n400 = (u.n400 ?? 0) + 1; u.s = u.n400 > 3 ? 'x' : 'r'; }
    else if (be.s === 'x') u.s = 'x';
    else u.s = 'r';
    if (u.s === 'x') {
      const fid = key.slice(4, key.lastIndexOf(':'));
      if (S.f[fid] && !S.f[fid].comp) failF(S, ctx, fid, null);
    }
  }
}

function reconcileUnknown(S, ctx) {
  for (const [key, u] of Object.entries(S.u)) {
    if (u.s !== 'q') continue;
    let r = 'not-found';
    try { r = ctx.status(sysOf(key), key); } catch { r = 'not-found'; }
    if (r === 'committed') u.s = 'ok';
    else if (r === 'not-found') u.s = 'r';
  }
}

function planSpecs(S, ctx) {
  const specs = [];
  const o = S.oid;
  const createDep = S.recorded === 'me' ? [K.create(o)] : [];
  if (S.needAlloc && !S.alloc) specs.push({ key: K.alloc(o), system: 'inventory', op: 'allocate', args: { orderId: o }, deps: [] });
  if (S.needVerdict && !S.verdict) specs.push({ key: K.fraud(o), system: 'fraud', op: 'check', args: { orderId: o }, deps: [] });
  if (S.recorded === 'me') {
    specs.push({ key: K.create(o), system: 'orders', op: 'create', deps: [], args: {
      orderId: o, customerId: S.cust, placedAt: S.p, currency: S.cur, items: S.items,
      fulfilments: fids(S).map(id => ({ fulfilmentId: id, location: S.f[id].loc, items: S.f[id].items, amountMinor: S.f[id].amt })),
      totalMinor: fids(S).reduce((s, id) => s + S.f[id].amt, 0) } });
  }
  const hold = new Set();
  const cxlDep = {};
  for (const id of fids(S)) {
    const F = S.f[id];
    const rk = F.items.map(it => K.rsv(id, it.sku));
    if (F.comp) {                                                       // compensation planner (R5.1)
      const states = [...rk, K.chg(id), K.shp(id)].map(k => commitOf(S, ctx, k));
      if (states.includes('w')) { hold.add(id); continue; }
      const shipC = commitOf(S, ctx, K.shp(id)) === 'c' && F.cf === null;
      const chgC = commitOf(S, ctx, K.chg(id)) === 'c';
      let prev = null;
      if (shipC) { specs.push({ key: K.cxl(id), system: 'carrier', op: 'cancel', args: { orderId: o, fulfilmentId: id }, deps: [] }); prev = K.cxl(id); cxlDep[id] = prev; }
      if (chgC) { specs.push({ key: K.rfd(id), system: 'billing', op: 'refund', args: { orderId: o, fulfilmentId: id, amountMinor: F.amt }, deps: prev ? [prev] : [] }); prev = K.rfd(id); }
      for (const it of F.items) if (commitOf(S, ctx, K.rsv(id, it.sku)) === 'c') specs.push({ key: K.rel(id, it.sku), system: 'inventory', op: 'release', args: { orderId: o, fulfilmentId: id, sku: it.sku }, deps: prev ? [prev] : [] });
      continue;
    }
    const forward = S.ready !== null && !S.cx && F.av && F.fail === null && !fEnded(F) && !F.pivot;
    if (!forward) continue;                                             // R4.2 forward executor
    const rsvAll = rk.every(k => S.u[k]?.s === 'ok');
    if (!rsvAll) {
      specs.push({ batch: true, system: 'inventory', op: 'reserve', deps: createDep, itemKeys: rk,
        args: { orderId: o, fulfilmentId: id, location: F.loc }, items: F.items.map(it => ({ key: K.rsv(id, it.sku), sku: it.sku, qty: it.qty })) });
      continue;
    }
    specs.push({ key: K.chg(id), system: 'billing', op: 'charge', args: { orderId: o, fulfilmentId: id, customerId: S.cust, amountMinor: F.amt, currency: S.cur }, deps: [] });
    if (S.u[K.chg(id)]?.s !== 'x') specs.push({ key: K.shp(id), system: 'carrier', op: 'create', args: { orderId: o, fulfilmentId: id, location: F.loc, ref: `R-${id}` }, deps: [K.chg(id)] });
  }
  const statusSpecs = (fid, e) => {
    e.path.forEach((st, i) => {
      const deps = [...createDep];
      if (i > 0) deps.push(K.st(o, fid, e.path[i - 1]));
      if (fid !== null && st === 'cancelled' && cxlDep[fid]) deps.push(cxlDep[fid]);
      if (fid === null && ORANK[st] === 3 && st !== 'timedOut' && !S.cx) for (const id of fids(S)) { const F = S.f[id]; const last = F.path[F.path.length - 1]; if (last && FRANK[last] === 3) deps.push(K.st(o, id, last)); }
      specs.push({ key: K.st(o, fid, st), system: 'orders', op: 'setStatus', args: { orderId: o, fulfilmentId: fid, status: st }, deps,
        hold: fid !== null && FRANK[st] === 3 && hold.has(fid) });
    });
  };
  for (const id of fids(S)) statusSpecs(id, S.f[id]);
  statusSpecs(null, S.os);
  for (const n of S.ntf) {
    const deps = [...createDep];
    if (n.dep) deps.push(n.dep);
    specs.push({ key: n.key, system: 'notify', op: 'send', args: { to: n.to ?? S.email ?? 'unknown@invalid', about: n.about, template: n.template, text: n.text }, deps });
  }
  return { specs, waitingComp: hold.size > 0 };
}

// ---------------------------------------------------------------------------------------------------------------
// Generic saga engine: emit the declared units that are due, pipelining same-output dependencies with `after`.
function runEngine(S, ctx, specs, now) {
  const effects = [];
  const pos = new Map();             // keyed effect emitted in this output -> index
  const batchKeys = new Set();       // batch item keys emitted in this output (cannot be named by `after`)
  const declared = new Map();
  specs.forEach((sp, i) => { for (const k of sp.batch ? sp.itemKeys : [sp.key]) declared.set(k, i); });
  const result = new Array(specs.length).fill(null);   // 'emit' | 'wait' | 'done'
  const st = k => S.u[k]?.s;
  const decide = i => {
    const sp = specs[i];
    if (sp.hold) return 'wait';
    let need;
    if (sp.batch) {
      need = sp.items.filter(it => st(it.key) === undefined || st(it.key) === 'r');
      if (!need.length) return sp.items.some(it => st(it.key) === 'f' || st(it.key) === 'q') ? 'wait' : 'done';
    } else {
      const s = st(sp.key);
      if (s === 'ok' || s === 'x' || s === 'col') return 'done';
      if (s === 'f' || s === 'q') return 'wait';
    }
    let after = null, afterPos = -1;
    for (const d of sp.deps) {
      const ds = st(d);
      if (pos.has(d)) { if (pos.get(d) > afterPos) { afterPos = pos.get(d); after = d; } continue; }
      if (batchKeys.has(d)) return 'wait';
      if (ds === 'ok' || ds === 'x' || ds === 'col') continue;
      if (declared.has(d) && result[declared.get(d)] === null) return 'defer';
      return 'wait';
    }
    const eff = { system: sp.system, op: sp.op };
    if (sp.batch) eff.args = apiArgs(ctx, S, sp.system, sp.op, { ...sp.args, items: need });
    else { eff.key = sp.key; eff.args = apiArgs(ctx, S, sp.system, sp.op, sp.args); }
    if (after) eff.after = after;
    effects.push(eff);
    for (const k of sp.batch ? need.map(it => it.key) : [sp.key]) {
      const u = S.u[k] ?? (S.u[k] = {});
      u.s = 'f';
      u.t = now;
      if (sp.batch) batchKeys.add(k); else pos.set(k, effects.length - 1);
    }
    return 'emit';
  };
  for (let progress = true; progress;) {
    progress = false;
    for (let i = 0; i < specs.length; i++) {
      if (result[i] !== null) continue;
      const r = decide(i);
      if (r !== 'defer') { result[i] = r; progress = true; }
    }
  }
  const busy = result.some(r => r === null || r === 'wait' || r === 'emit');
  return { effects, busy };
}

// ---------------------------------------------------------------------------------------------------------------
// Routing of message-started instances (first tick)
const EV_RANK = { migration: 0, 'effect.result': 1, 'carrier.status': 2, 'humanTask.answered': 3, 'humanTask.answerRejected': 3,
  'humanTask.withdrawn': 3, 'humanTask.timeout': 3, 'humanTask.delegated': 3, 'customer.action': 4, 'order.placed': 5, 'timer.fired': 6 };

function route(input, ctx, ev) {
  const self = input.instance;
  const openFor = oid => {
    if (!oid) return null;
    let rows = [];
    try { rows = ctx.instances({ subject: oid }); } catch { rows = []; }
    return rows.map(r => r.instance).filter(i => i !== self).sort()[0] ?? null;
  };
  const q = (table, where) => { try { return ctx.query(table, { where, limit: 5 }); } catch { return []; } };
  const recorded = oid => !!oid && q('orders.orders', { orderId: oid }).length > 0;
  const done = (subject, extra = {}) => ({ decisions: { subject, stage: 'message', ...extra }, effects: [], carry: null, ...(extra.merge ? { merge: extra.merge } : { close: true }) });
  const pl = isObj(ev.payload) ? ev.payload : {};
  if (ev.type === 'order.placed') {
    const oid = normId(pl.orderId);
    const tgt = openFor(oid);
    if (tgt) return { decisions: { subject: oid, stage: 'duplicate-merged' }, carry: null, merge: { into: tgt } };
    if (recorded(oid)) return { decisions: { subject: oid, stage: 'duplicate' }, carry: null, close: true };
    return null;                                                        // a new order: this instance runs it
  }
  if (ev.type === 'customer.action') {
    const oid = normId(pl.orderRef);
    const tgt = openFor(oid);
    if (tgt) return { decisions: { subject: oid, stage: 'action-merged' }, carry: null, merge: { into: tgt } };
    return done(recorded(oid) ? oid : null);
  }
  if (ev.type === 'carrier.status') {
    let fid = normId(pl.fulfilmentRef);
    let rows = fid ? q('orders.fulfilments', { fulfilmentId: fid }) : [];
    if (!rows.length && typeof pl.fulfilmentRef === 'string') rows = q('orders.fulfilments', { fulfilmentId: pl.fulfilmentRef });
    if (!rows.length && typeof pl.ref === 'string' && pl.ref.startsWith('R-')) { fid = pl.ref.slice(2); rows = q('orders.fulfilments', { fulfilmentId: fid }); }
    const oid = rows[0]?.orderId ? normId(rows[0].orderId) : (fid ? fid.replace(/-F\d+$/, '') : null);
    const tgt = openFor(oid);
    if (tgt) return { decisions: { subject: oid, stage: 'carrier-merged' }, carry: null, merge: { into: tgt } };
    return done(recorded(oid) ? oid : null);
  }
  return done(null);
}

// ---------------------------------------------------------------------------------------------------------------
function tick(input, ctx) {
  const now = toMs(input.now);
  const out = { humanTasks: [], obligations: { upsert: [], cancel: [] } };
  const events = (Array.isArray(input.events) ? input.events : []).slice()
    .sort((a, b) => (toMs(a.at) - toMs(b.at)) || ((EV_RANK[a.type] ?? 9) - (EV_RANK[b.type] ?? 9)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let S;
  if (input.carry === null || input.carry === undefined) {
    const mig = events.find(e => e.type === 'migration');
    if (mig) S = fromMigration(input, ctx, mig, out, now);
    else {
      const first = events.find(e => e.channel?.kind === 'inbound') ?? events[0];
      if (!first) return { decisions: { subject: null }, carry: null, close: true };
      const routed = route(input, ctx, first);
      if (routed) return routed;
      const pl = first.payload ?? {};
      S = newOrder(input, { origin: 'placed', oid: normId(pl.orderId), p: pl.placedAt ?? first.at, cust: pl.customerId, cur: pl.currency, items: pl.items });
      setEdition(S, ctx);
      S.email = emailOf(ctx, S.cust);
    }
  } else S = structuredClone(input.carry);
  S.ticks += 1;

  // A same-instant duplicate placement started a twin instance: the higher id yields before any business effect.
  if (S.origin === 'placed' && S.ticks === 2 && S.recorded === null) {
    let twins = [];
    try { twins = ctx.instances({ subject: S.oid }).map(r => r.instance).filter(i => i !== input.instance && i < input.instance); } catch { twins = []; }
    if (twins.length) return { decisions: { subject: S.oid, stage: 'twin-yielded' }, carry: null, close: true };
  }

  for (const ev of events) {
    switch (ev.type) {
      case 'migration': case 'order.placed': break;                   // migration handled above; duplicates: R1.4
      case 'effect.result': handleResult(S, ctx, ev); break;
      case 'carrier.status': handleCarrier(S, ctx, ev); break;
      case 'customer.action': handleAction(S, ctx, out, toMs(ev.at), ev.payload?.action, now); break;
      case 'timer.fired': handleTimer(S, ctx, out, ev); break;
      default: if (ev.type?.startsWith('humanTask.')) handleTask(S, ctx, out, ev, now);
    }
  }
  reconcileBatches(S, ctx);
  intakeDecision(S, ctx, out, now);
  reconcileUnknown(S, ctx);
  const { specs, waitingComp } = planSpecs(S, ctx);
  const { effects, busy } = runEngine(S, ctx, specs, now);
  const inflight = Object.values(S.u).some(u => u.s === 'f' || u.s === 'q');
  const ended = S.intake && oEnded(S) && fids(S).every(id => fEnded(S.f[id]));
  const idle = ended && !busy && !inflight && !waitingComp && effects.length === 0 && out.humanTasks.length === 0;
  // Close on an own timer at a half-minute instant: inbound messages arrive on whole minutes, so a message that is
  // being merged into this instance in the same instant cannot find it closed (that merge would be an arm error).
  const closeFired = events.some(e => e.type === 'timer.fired' && e.payload?.obligationId === 't-close');
  const close = idle && closeFired;
  if (idle && !close) timer(S, out, 't-close', Math.floor((now + MIN) / MIN) * MIN + 30_000, 'close-instance');
  const output = {
    decisions: { subject: S.oid, stage: oCur(S), reason: S.cx?.reason ?? null, edition: S.ed },
    effects, carry: close ? null : S,
  };
  if (out.humanTasks.length) output.humanTasks = out.humanTasks;
  if (out.obligations.upsert.length || out.obligations.cancel.length) output.obligations = out.obligations;
  if (close) output.close = true;
  return output;
}

export function createSolver() {
  return { id: ID, tick };
}
