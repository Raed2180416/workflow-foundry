// solver.mjs - E8 order fulfilment with compensation (SPEC-E).
// Deterministic: the only clock is input.now and event times. Each tick rebuilds what is due from
// carry + events + ctx; keyed effects are issued once (carry.issued) and each notification is sent once.

const MIN = 60_000;
const TERMINAL_F = new Set(['completed', 'failed', 'cancelled']);
const PERMANENT_OK_CODES = new Set(['invalid-args', 'field-renamed']);

// ---------- small helpers ----------
const clone = (v) => JSON.parse(JSON.stringify(v));
const plusMin = (iso, m) => new Date(Date.parse(iso) + m * MIN).toISOString();
const normaliseId = (s) => String(s ?? '').trim().replace(/^#/, '').trim().toUpperCase();
const amsDate = (iso) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

// ---------- files (ctx.files) ----------
function fileValue(ctx, path) {
  const f = ctx.files;
  let v = f instanceof Map ? f.get(path) : f?.[path];
  if (v && typeof v === 'object' && 'content' in v) v = v.content;
  if (typeof v === 'string' && path.endsWith('.json')) return JSON.parse(v);
  return v;
}
function filePaths(ctx) {
  const f = ctx.files;
  return f instanceof Map ? [...f.keys()] : Object.keys(f ?? {});
}
function csvRows(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const head = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = l.split(',').map((c) => c.trim());
    const row = {};
    head.forEach((h, i) => {
      const c = cells[i];
      row[h] = c !== undefined && /^-?\d+$/.test(c) ? Number(c) : c;
    });
    return row;
  });
}
// <base>.json or <base>.csv; undefined when neither exists.
function loadTable(ctx, base) {
  const j = fileValue(ctx, `${base}.json`);
  if (j !== undefined) return j;
  const c = fileValue(ctx, `${base}.csv`);
  return c === undefined ? undefined : csvRows(c);
}
// Table (array of rows, or an object map) -> Map(key -> row/value).
function indexTable(table, keyFields) {
  const m = new Map();
  if (Array.isArray(table)) {
    for (const row of table) {
      const k = keyFields.map((f) => row?.[f]).find((x) => x !== undefined && x !== null);
      if (k !== undefined) m.set(String(k), row);
    }
  } else if (table && typeof table === 'object') {
    for (const [k, v] of Object.entries(table)) m.set(k, v);
  }
  return m;
}
function policyValue(policy, name) {
  if (Array.isArray(policy)) return policy.find((r) => r.key === name || r.name === name)?.value;
  return policy?.[name];
}

// R1.3: edition in force at p = published edition with the latest effectiveFrom <= date(p) in Amsterdam.
function editionFor(ctx, p) {
  const day = amsDate(p);
  let best = null;
  for (const path of filePaths(ctx)) {
    const m = /^rulebook\/([^/]+)\/edition\.json$/.exec(path);
    if (!m) continue;
    const ed = fileValue(ctx, path);
    const from = String(ed?.effectiveFrom ?? '').slice(0, 10);
    if (!from || from > day) continue;
    if (!best || from > best.effectiveFrom) best = { dir: `rulebook/${m[1]}`, id: ed.id ?? m[1], effectiveFrom: from };
  }
  return best;
}
const rb = (ctx, ed, name) => loadTable(ctx, `${ed.dir}/${name}`);

// Reads of read-only systems (inventory.allocate, fraud.check). The contract gives no read call for
// them, so they are taken from the instance's record file sor/<instance>.json (see final notes).
function readRO(ctx, instance, kind) {
  const sor = fileValue(ctx, `sor/${instance}.json`);
  if (!sor) return undefined;
  return sor[kind] ?? sor.reads?.[kind];
}

// ---------- state ----------
function freshState() {
  return {
    v: 1,
    subject: null,
    order: null, // { id, customerId, placedAt, currency, items, status, phase, recorded, edition, email, clearedAt, cust }
    fulfilments: {}, // fid -> { location, items, amountMinor, status, res: {sku: state}, batchN, charge, ship, collectedAt, delivered, collFailed, shipCancelled, wantComp, failReason }
    fraud: null, // { verdict } or { review: { attempt, taskId, createdAt, deadline, answer, reask } }
    actions: [], // customer actions seen: { id, type, at }
    carrierQueue: [], // carrier messages not yet applied: { fid, code, shipmentId, at }
    batches: {}, // batch effect key -> item keys
    attempts: {}, // effect key -> number of re-issues
    results: {}, // effect (or item) key -> { status, error }
    issued: {}, // effect key -> true
    notified: {}, // notification key -> true
    timers: [], // obligation ids currently scheduled
  };
}

export function createSolver() {
  return { id: 'solver', tick: (input, ctx) => tick(input, ctx) };
}

// ---------- routing (inbound messages that start a new instance) ----------
const KIND_BY_SOURCE = { shop: 'order.placed', 'customer-portal': 'customer.action', carrier: 'carrier.status' };
const kindOf = (e) => (e.type === 'message.received' ? KIND_BY_SOURCE[e.source] : e.type);
const byAt = (a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Open instances with this subject (other than ours), earliest first.
function openInstancesFor(ctx, oid, self) {
  const list = (ctx.instances({ subject: oid }) ?? []).map((i) => (typeof i === 'string' ? { instance: i } : i));
  return list
    .map((i) => ({ instance: i.instance ?? i.id, openedAt: i.openedAt ?? null }))
    .filter((i) => i.instance && i.instance !== self)
    .sort((a, b) => (a.openedAt ?? '') < (b.openedAt ?? '') ? -1 : (a.openedAt ?? '') > (b.openedAt ?? '') ? 1 : a.instance < b.instance ? -1 : 1);
}

// First tick of an instance started by an inbound message: merge into the case it belongs to, or close.
// Returns null when this instance owns the message.
function routeNewInstance(input, ctx, ev) {
  const kind = kindOf(ev);
  let oid = null;
  if (kind === 'migration') return null; // go-live: this instance owns its order (see ingest)
  if (kind === 'order.placed') oid = normaliseId(ev.payload?.orderId);
  else if (kind === 'customer.action') oid = normaliseId(ev.payload?.orderRef);
  else if (kind === 'carrier.status') {
    const row = ctx.query('orders.fulfilments', { where: { fulfilmentId: ev.payload?.fulfilmentRef }, limit: 1 })[0];
    oid = row ? normaliseId(row.orderId) : null;
  }
  if (!oid) return { close: true, subject: null };
  // Tie-break for two instances opened in the same instant: the smaller instance id owns the case.
  const others = openInstancesFor(ctx, oid, input.instance).filter((o) => {
    if (!o.openedAt) return true;
    const d = Date.parse(o.openedAt) - Date.parse(input.now);
    return d < 0 || (d === 0 && o.instance < input.instance);
  });
  if (others.length) return { merge: others[0].instance, subject: oid };
  if (kind === 'order.placed') {
    const recorded = ctx.query('orders.orders', { where: { orderId: oid }, limit: 1 }).length > 0;
    if (recorded) return { close: true, subject: oid }; // duplicate of a finished order
    return null; // the first placed event of this order: we own it
  }
  return { close: true, subject: oid };
}

// ---------- ingest (fold this tick's events into the carry) ----------
function ingest(st, events) {
  for (const e of events) {
    const kind = kindOf(e);
    const p = e.payload ?? {};
    if (kind === 'order.placed') {
      if (!st.order) {
        st.subject = normaliseId(p.orderId);
        st.order = {
          id: st.subject, customerId: p.customerId, placedAt: e.at, currency: p.currency, items: p.items ?? [],
          status: 'pending', phase: 'open', recorded: false, edition: null, email: null, clearedAt: null, cust: null,
        };
      }
    } else if (kind === 'customer.action') {
      if (!st.actions.some((a) => a.id === e.id)) st.actions.push({ id: e.id, type: p.action, at: e.at });
    } else if (kind === 'carrier.status') {
      st.carrierQueue.push({
        fid: String(p.fulfilmentRef ?? '').trim(), code: p.code, shipmentId: p.shipmentId ?? null,
        at: p.reportedAt ?? e.at,
      });
    } else if (e.type === 'effect.result') {
      applyResult(st, e);
    } else if (String(e.type).startsWith('humanTask.')) {
      applyTask(st, e);
    }
  }
}

// Results are keyed by effect key; a batch's per-item outcomes are keyed by item key.
function applyResult(st, e) {
  const batchItems = st.batches[e.key] ?? [];
  if (Array.isArray(e.items) && e.items.length) {
    for (const it of e.items) st.results[it.key] = { status: it.status, error: it.error ?? e.error };
  } else {
    for (const k of batchItems) st.results[k] = { status: e.status, error: e.error };
  }
  if (e.key) st.results[e.key] = { status: e.status, error: e.error };
}

function applyTask(st, e) {
  const rv = st.fraud?.review;
  if (!rv) return;
  const taskId = e.payload?.taskId ?? e.payload?.id;
  if (e.type === 'humanTask.answered') {
    const ans = e.payload?.answer ?? e.payload ?? {};
    const ok = (ans.decision === 'approve' || ans.decision === 'reject') && (!taskId || taskId === rv.taskId);
    if (ok && !rv.answer) rv.answer = { decision: ans.decision, at: e.at };
    else if (!ok && !rv.answer) rv.reask = true; // unusable answer: ask again
  } else if (e.type === 'humanTask.answerRejected' || e.type === 'humanTask.withdrawn') {
    if (!rv.answer) rv.reask = true;
  }
}

// ---------- tick ----------
function tick(input, ctx) {
  const instance = input.instance;
  const events = [...(input.events ?? [])].sort(byAt);
  const out = { decisions: { subject: null }, effects: [], obligations: { upsert: [], cancel: [] }, humanTasks: [], carry: null };

  if (!input.carry) {
    const first = events.find((e) => e.channel?.kind !== 'instance') ?? events[0];
    const r = first ? routeNewInstance(input, ctx, first) : { close: true, subject: null };
    if (r) {
      out.decisions.subject = r.subject ?? null;
      if (r.merge) out.merge = { into: r.merge };
      if (r.close) out.close = true;
      if (r.merge || r.close) {
        out.carry = freshState();
        out.carry.subject = r.subject ?? null;
        return out;
      }
    }
  }

  const st = input.carry ? clone(input.carry) : freshState();
  ingest(st, events);
  decide(st, ctx, input.now, out, instance);
  out.decisions.subject = st.subject ?? null;
  out.decisions.status = st.order?.status ?? null;
  out.carry = st;
  return out;
}

// ---------- results and carrier codes ----------
// 'ok' | 'failed' (permanent) | 'retry' (not committed, may be re-issued) | 'pending'
// A re-issue that keeps failing after MAX_REISSUES is treated as a failure, so a case cannot loop forever.
const MAX_REISSUES = 5;
function retryOrFail(st, key) {
  return (st.attempts?.[key] ?? 0) >= MAX_REISSUES ? 'failed' : 'retry';
}
function outcomeOf(ctx, system, key, st) {
  const r = st.results[key];
  if (!r) return 'pending';
  if (r.status === 'ok') return 'ok';
  if (r.status === 'unknown') {
    const s = ctx.status(system, key);
    return s === 'committed' ? 'ok' : s === 'pending' ? 'pending' : retryOrFail(st, key);
  }
  if (r.status === 'error') {
    const code = r.error?.code;
    if (PERMANENT_OK_CODES.has(code) || r.error?.status === 400) return retryOrFail(st, key); // our request was wrong
    if (r.error?.retryable === false || code === 'card-declined' || r.error?.status === 402) return 'failed';
    return retryOrFail(st, key);
  }
  return 'pending';
}

function carrierMeaning(ctx, ed, code) {
  const r = indexTable(rb(ctx, ed, 'carrier-codes'), ['code']).get(String(code));
  if (r === undefined) return 'info';
  return typeof r === 'string' ? r : (r.meaning ?? 'info');
}

const earliest = (a, b) => (!a ? b : Date.parse(b) < Date.parse(a) ? b : a);

// ---------- decide ----------
function decide(st, ctx, now, out, instance) {
  const o = st.order;
  if (!o) return; // no order yet (e.g. a migrated instance without an order record): nothing to do
  const oid = o.id;
  const want = {}; // obligation id -> { dueAt, anchor, onDue }
  const K = (s) => `${oid}:${s}`;

  const emit = (system, op, args, key) => {
    if (st.issued[key]) return;
    st.issued[key] = 1;
    out.effects.push({ key, system, op, args });
  };
  const setFul = (fid, status) => {
    const f = st.fulfilments[fid];
    if (!f || f.status === status) return;
    f.status = status;
    emit('orders', 'setStatus', { orderId: oid, fulfilmentId: fid, status }, K(`${fid}:s:${status}`));
  };
  const setOrd = (status) => {
    if (o.status === status) return;
    o.status = status;
    emit('orders', 'setStatus', { orderId: oid, fulfilmentId: null, status }, K(`s:${status}`));
  };
  const notify = (template, about, text, tag = '') => {
    const key = K(`n:${template}:${about}:${tag}`);
    if (st.notified[key]) return;
    st.notified[key] = 1;
    emit('notify', 'send', { to: o.email ?? o.customerId, about, template, text }, key);
  };
  const failFul = (fid, reason) => {
    const f = st.fulfilments[fid];
    f.wantComp = true;
    f.failReason = reason;
    setFul(fid, 'failed');
    notify('fulfilment-failed', fid, `Fulfilment ${fid} of order ${oid} failed (${reason}).`);
  };
  const cancelOrder = (reason) => {
    for (const [fid, f] of Object.entries(st.fulfilments)) {
      if (!TERMINAL_F.has(f.status)) {
        f.wantComp = true;
        setFul(fid, 'cancelled');
      }
    }
    setOrd('cancelled');
    notify('order-cancelled', oid, `Your order ${oid} was cancelled (${reason}).`);
    o.phase = 'ended';
  };
  const startProcessing = () => {
    o.phase = 'processing';
    setOrd('processing');
    for (const [fid, f] of Object.entries(st.fulfilments)) if (f.location) setFul(fid, 'processing');
  };
  const timeoutOrder = () => {
    for (const [fid, f] of Object.entries(st.fulfilments)) if (!TERMINAL_F.has(f.status)) setFul(fid, 'cancelled');
    setOrd('timedOut');
    notify('order-timed-out', oid, `Your order ${oid} timed out: no action was taken.`);
    o.phase = 'ended';
  };

  // 1. Intake (R1.1-R1.2): needs the edition, the plan (allocate) and the catalog/fees.
  if (!o.recorded) {
    if (!o.edition) o.edition = editionFor(ctx, o.placedAt);
    const ed = o.edition;
    const alloc = ed ? readRO(ctx, instance, 'allocate') : undefined;
    const cat = ed && indexTable(loadTable(ctx, 'master/catalog'), ['sku']);
    const fees = ed && indexTable(rb(ctx, ed, 'shipping-fees'), ['location']);
    const cust = indexTable(loadTable(ctx, 'master/customers'), ['customerId', 'id']);
    const unit = (sku) => { const r = cat?.get(sku); return typeof r === 'number' ? r : r?.unitPriceMinor; };
    const plan = alloc?.fulfilments?.map((a) => {
      const location = a.available === false ? null : (a.location ?? null);
      const items = (a.items ?? []).map((i) => ({ sku: i.sku, qty: i.qty }));
      const goods = items.reduce((s, i) => s + i.qty * unit(i.sku), 0);
      const fee = location === null ? 0 : fees?.get(location);
      const feeMinor = typeof fee === 'number' ? fee : fee?.feeMinor;
      return { fulfilmentId: a.fulfilmentId, location, items, amountMinor: goods + (location === null ? 0 : feeMinor) };
    });
    // Wait (retry later) until every price and fee the plan needs is known.
    const known = plan && plan.length > 0 && plan.every((p) => Number.isInteger(p.amountMinor) && p.items.every((i) => Number.isInteger(unit(i.sku))));
    if (known) {
      const totalMinor = plan.reduce((s, p) => s + p.amountMinor, 0);
      emit('orders', 'create', {
        orderId: oid, customerId: o.customerId, placedAt: o.placedAt, currency: o.currency,
        items: o.items.map((i) => ({ sku: i.sku, qty: i.qty })),
        fulfilments: plan.map((p) => ({ fulfilmentId: p.fulfilmentId, location: p.location, items: p.items, amountMinor: p.amountMinor })),
        totalMinor,
      }, K('create'));
      for (const p of plan) {
        st.fulfilments[p.fulfilmentId] = {
          location: p.location, items: p.items, amountMinor: p.amountMinor, status: p.location ? 'pending' : 'unavailable',
          res: {}, batchN: 0, charge: 'todo', ship: 'todo', collectedAt: null, delivered: false, collFailed: false,
          shipCancelled: false, wantComp: false, failReason: null,
        };
      }
      const cr = cust.get(o.customerId);
      o.totalMinor = totalMinor;
      o.email = cr?.email ?? null;
      o.recorded = true;
    }
  }

  // Policy of the order's edition (R1.3); the edition is fixed at intake.
  const policy = o.edition ? rb(ctx, o.edition, 'policy') : undefined;
  const reviewHours = Number(policyValue(policy, 'fraudReviewHours'));
  const custHours = Number(policyValue(policy, 'customerActionHours'));

  // 2. Fraud (R2.1, R2.2): verdict of the fraud check, then the review task and its answer.
  const reviewStep = () => {
    const rv = st.fraud.review ?? (st.fraud.review = {
      attempt: 0, taskId: null, createdAt: now, deadline: plusMin(now, reviewHours * 60), answer: null, reask: false,
    });
    const usable = rv.answer && Date.parse(rv.answer.at) <= Date.parse(rv.deadline) ? rv.answer : null;
    if (usable?.decision === 'approve') o.clearedAt = usable.at;
    else if (usable?.decision === 'reject') cancelOrder('fraud');
    else if (Date.parse(now) > Date.parse(rv.deadline)) cancelOrder('fraud-review-timeout');
    else {
      if (!rv.taskId || rv.reask) {
        rv.attempt += 1;
        rv.taskId = `${oid}:review:${rv.attempt}`;
        rv.reask = false;
        out.humanTasks.push({
          id: rv.taskId, kind: 'fraudReview', role: 'fraudAnalyst', subject: oid,
          question: `Fraud review of order ${oid}: approve or reject?`,
          answerSchema: { type: 'object', required: ['decision'], properties: { decision: { enum: ['approve', 'reject'] } }, additionalProperties: false },
          dueAt: rv.deadline, onTimeout: 'fraud-review-timeout',
        });
      }
      want['fraud-deadline'] = { dueAt: plusMin(rv.deadline, 1), anchor: rv.createdAt, onDue: 'fraud-review-deadline' };
    }
  };
  if (o.recorded && o.phase === 'open') {
    if (!st.fraud) {
      const v = readRO(ctx, instance, 'fraud');
      if (v?.verdict) st.fraud = { verdict: v.verdict, review: null };
    }
    if (st.fraud?.verdict === 'pass') o.clearedAt = o.clearedAt ?? o.placedAt;
    else if (st.fraud?.verdict === 'reject') cancelOrder('fraud');
    else if (st.fraud?.verdict === 'review') reviewStep();
  }

  // 3. Customer cancel before the order is cleared counts (R6.4).
  const acts = [...st.actions].sort(byAt);
  if (o.recorded && o.phase === 'open' && acts.some((a) => a.type === 'cancel' && (!o.clearedAt || Date.parse(a.at) < Date.parse(o.clearedAt)))) {
    cancelOrder('customer');
  }

  // 4. Clearance (R3.1, R4.1): unavailable items -> wait for the customer; otherwise ready now.
  if (o.recorded && o.phase === 'open' && o.clearedAt) {
    if (Object.values(st.fulfilments).some((f) => !f.location)) {
      o.phase = 'waiting';
      setOrd('customerActionRequired');
      notify('action-required', oid, `Some items of order ${oid} are unavailable: amend or cancel the order within ${custHours} hours.`);
      o.cust = { deadline: plusMin(o.placedAt, custHours * 60), resolved: null };
    } else {
      startProcessing();
    }
  }

  // 5. Carrier messages (R4.4): translate, then apply to their fulfilment.
  if (o.edition) {
    for (const m of st.carrierQueue) {
      const f = st.fulfilments[m.fid];
      if (!f || f.shipCancelled || TERMINAL_F.has(f.status)) continue;
      const meaning = carrierMeaning(ctx, o.edition, m.code);
      if (meaning === 'collected') f.collectedAt = earliest(f.collectedAt, m.at);
      else if (meaning === 'delivered') { f.collectedAt = earliest(f.collectedAt, m.at); f.delivered = true; }
      else if (meaning === 'collectionFailed') f.collFailed = true;
    }
    st.carrierQueue = [];
    for (const [fid, f] of Object.entries(st.fulfilments)) {
      if (TERMINAL_F.has(f.status) || f.shipCancelled) continue;
      if (f.collFailed) { failFul(fid, 'collectionFailed'); continue; }
      if (f.collectedAt && f.status === 'processing') setFul(fid, 'dispatched');
      if (f.delivered) {
        if (f.status === 'processing') setFul(fid, 'dispatched');
        setFul(fid, 'completed');
      }
    }
  }

  // 6. Customer action on unavailable items (R3.2, S1, S5): first counted action at or before D.
  if (o.phase === 'waiting' && o.cust && !o.cust.resolved) {
    const D = Date.parse(o.cust.deadline);
    const act = acts.find((a) => (a.type === 'amend' || a.type === 'cancel') && Date.parse(a.at) <= D);
    if (act) {
      o.cust.resolved = { type: act.type, at: act.at };
      if (act.type === 'cancel') {
        cancelOrder('customer');
      } else {
        for (const [fid, f] of Object.entries(st.fulfilments)) if (!f.location) setFul(fid, 'cancelled');
        if (Object.values(st.fulfilments).every((f) => !f.location)) cancelOrder('nothing-available');
        else startProcessing();
      }
    } else if (Date.parse(now) > D) {
      timeoutOrder();
    }
  }

  // 7. Customer cancel during processing (R6.2, R6.3): counts only if no shipment was collected by then (S4, S6).
  if (o.phase === 'processing') {
    for (const a of acts.filter((x) => x.type === 'cancel')) {
      const collected = Object.values(st.fulfilments).some((f) => f.collectedAt && Date.parse(f.collectedAt) <= Date.parse(a.at));
      if (collected) {
        notify('cancel-refused', oid, `Order ${oid} can no longer be cancelled: a shipment has been collected.`, a.id);
      } else {
        cancelOrder('customer');
        break;
      }
    }
  }

  // A result we re-issue must not be judged by its stale outcome.
  const reissue = (key) => {
    st.attempts[key] = (st.attempts[key] ?? 0) + 1;
    delete st.issued[key];
    delete st.results[key];
  };

  // 8. Saga (R4.2): reserve every item, then charge, then ship. Failures start compensation (R5.2).
  const saga = (fid, f) => {
    let blocked = false;
    const todo = [];
    for (const it of f.items) {
      const s = f.res[it.sku] ?? 'todo';
      if (s === 'todo') {
        todo.push(it);
      } else if (s === 'issued') {
        const r = outcomeOf(ctx, 'inventory', K(`${fid}:r:${it.sku}`), st);
        if (r === 'ok') f.res[it.sku] = 'ok';
        else if (r === 'failed') { failFul(fid, 'reserve-failed'); return; }
        else if (r === 'retry') { reissue(K(`${fid}:r:${it.sku}`)); f.res[it.sku] = 'todo'; todo.push(it); }
        else blocked = true;
      }
    }
    if (blocked) return;
    if (todo.length) {
      // Batch: one call per attempt; the item keys stay the same for every attempt.
      f.batchN += 1;
      const bk = K(`${fid}:res:${f.batchN}`);
      const items = todo.map((it) => ({ key: K(`${fid}:r:${it.sku}`), sku: it.sku, qty: it.qty }));
      for (const i of items) delete st.results[i.key];
      st.batches[bk] = items.map((i) => i.key);
      for (const it of todo) f.res[it.sku] = 'issued';
      emit('inventory', 'reserve', { orderId: oid, fulfilmentId: fid, location: f.location, items }, bk);
      return;
    }
    if (!f.items.every((it) => f.res[it.sku] === 'ok')) return;

    const ck = K(`${fid}:charge`);
    if (f.charge === 'issued') {
      const r = outcomeOf(ctx, 'billing', ck, st);
      if (r === 'ok') f.charge = 'ok';
      else if (r === 'failed') { failFul(fid, 'card-declined'); return; }
      else if (r === 'retry') { reissue(ck); f.charge = 'todo'; }
      else return;
    }
    if (f.charge === 'todo') {
      emit('billing', 'charge', { orderId: oid, fulfilmentId: fid, customerId: o.customerId, amountMinor: f.amountMinor, currency: o.currency }, ck);
      f.charge = 'issued';
      return;
    }
    if (f.charge !== 'ok') return;

    const sk = K(`${fid}:ship`);
    if (f.ship === 'issued') {
      const r = outcomeOf(ctx, 'carrier', sk, st);
      if (r === 'ok') f.ship = 'ok';
      else if (r === 'failed') { failFul(fid, 'carrier-failed'); return; }
      else if (r === 'retry') { reissue(sk); f.ship = 'todo'; }
      else return;
    }
    if (f.ship === 'todo') {
      emit('carrier', 'create', { orderId: oid, fulfilmentId: fid, location: f.location, ref: fid }, sk);
      f.ship = 'issued';
    }
  };
  if (o.phase === 'processing') {
    for (const [fid, f] of Object.entries(st.fulfilments)) {
      if (f.status === 'processing' && !f.wantComp) saga(fid, f);
    }
  }

  // 9. Compensation (R5.1, R6.2): undo what committed, in reverse order; in-flight steps wait for their result.
  const settle = (fid, f) => {
    const kk = (s) => K(`${fid}:${s}`);
    if (f.charge === 'issued') {
      const r = outcomeOf(ctx, 'billing', kk('charge'), st);
      if (r === 'ok') f.charge = 'ok';
      else if (r !== 'pending') f.charge = 'none';
    }
    if (f.ship === 'issued') {
      const r = outcomeOf(ctx, 'carrier', kk('ship'), st);
      if (r === 'ok') f.ship = 'ok';
      else if (r !== 'pending') f.ship = 'none';
    }
    for (const sku of Object.keys(f.res)) {
      if (f.res[sku] !== 'issued') continue;
      const r = outcomeOf(ctx, 'inventory', kk(`r:${sku}`), st);
      if (r === 'ok') f.res[sku] = 'ok';
      else if (r !== 'pending') f.res[sku] = 'none';
    }
  };
  const compensate = (fid, f) => {
    const kk = (s) => K(`${fid}:${s}`);
    if (f.ship === 'ok' && !f.collFailed) {
      emit('carrier', 'cancel', { orderId: oid, fulfilmentId: fid }, kk('shipcancel'));
      f.ship = 'cancelled';
      f.shipCancelled = true;
    }
    if (f.charge === 'ok') {
      emit('billing', 'refund', { orderId: oid, fulfilmentId: fid, amountMinor: f.amountMinor }, kk('refund'));
      f.charge = 'refunded';
    }
    for (const sku of Object.keys(f.res)) {
      if (f.res[sku] !== 'ok') continue;
      emit('inventory', 'release', { orderId: oid, fulfilmentId: fid, sku }, kk(`rel:${sku}`));
      f.res[sku] = 'released';
    }
  };
  for (const [fid, f] of Object.entries(st.fulfilments)) {
    if (!f.wantComp) continue;
    settle(fid, f);
    compensate(fid, f);
  }

  // 10. Order outcome (R4.5).
  if (o.phase === 'processing') {
    const fs = Object.values(st.fulfilments);
    if (fs.every((f) => TERMINAL_F.has(f.status))) {
      setOrd(fs.some((f) => f.status === 'completed') ? 'completed' : fs.some((f) => f.status === 'failed') ? 'failed' : 'cancelled');
      o.phase = 'ended';
    }
  }

  // 11. Close once the order has ended and every effect has reported back (compensations included).
  if (o.phase === 'ended' && Object.keys(st.issued).every((k) => k in st.results)) {
    out.close = true;
    out.obligations.cancel = [...st.timers];
    st.timers = [];
    return;
  }

  // 12. Wake-ups (obligations): retry reads, fraud review deadline, customer deadline.
  if (!o.recorded || (o.phase === 'open' && !st.fraud)) {
    want['read-retry'] = { dueAt: plusMin(now, 2), anchor: o.placedAt, onDue: 'retry-read' };
  }
  if (o.phase === 'waiting' && o.cust && !o.cust.resolved) {
    want['customer-deadline'] = { dueAt: plusMin(o.cust.deadline, 1), anchor: o.placedAt, onDue: 'customer-deadline' };
  }
  out.obligations.cancel = st.timers.filter((id) => !(id in want));
  out.obligations.upsert = Object.entries(want).map(([id, w]) => ({ id, kind: 'deadline', anchor: w.anchor, dueAt: w.dueAt, onDue: w.onDue }));
  st.timers = Object.keys(want);
}
