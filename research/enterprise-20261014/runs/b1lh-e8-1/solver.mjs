// E8 order fulfilment solver (SPEC-E). Deterministic: time comes from input.now, no randomness.

const MIN = 60_000;
const TERMINAL = ['completed', 'failed', 'cancelled'];
const RANK = { pending: 0, processing: 1, dispatched: 2, completed: 3 };

// ---------- small helpers ----------

export function normaliseOrderId(raw) {
  if (raw == null) return null;
  return String(raw).trim().replace(/^#+/, '').trim().toUpperCase();
}

function addMin(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * MIN).toISOString();
}

function parseJsonFile(ctx, path) {
  const f = ctx.files?.[path];
  if (f == null) return null;
  return typeof f === 'string' ? JSON.parse(f) : f;
}

function rulebookTable(ctx, edition, name) {
  return edition ? parseJsonFile(ctx, `rulebook/${edition.dir}/${name}`) : null;
}

// Depth-first lookup of a key anywhere in a parsed document or result.
function findKey(obj, name) {
  if (obj == null || typeof obj !== 'object') return undefined;
  if (name in obj) return obj[name];
  for (const v of Object.values(obj)) {
    const hit = findKey(v, name);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

// Editions are discovered from rulebook/<dir>/edition.json.
function listEditions(ctx) {
  const out = [];
  for (const path of Object.keys(ctx.files ?? {})) {
    const m = /^rulebook\/([^/]+)\/edition\.json$/.exec(path);
    if (!m) continue;
    const e = parseJsonFile(ctx, path);
    if (e && e.id && e.effectiveFrom) out.push({ id: e.id, dir: m[1], effectiveFrom: e.effectiveFrom });
  }
  return out;
}

// YYYY-MM-DD of an ISO instant in Europe/Amsterdam.
function localDate(iso) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(Date.parse(iso)));
  const get = (t) => parts.find((x) => x.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// The edition in force at p: latest effectiveFrom on or before the local date of p.
function pickEdition(ctx, p) {
  const day = localDate(p);
  let best = null;
  for (const e of listEditions(ctx)) {
    if (e.effectiveFrom <= day && (best === null || e.effectiveFrom > best.effectiveFrom)) best = e;
  }
  return best;
}

function policyValue(ctx, edition, name) {
  return findKey(rulebookTable(ctx, edition, 'policy.json'), name);
}

// Per-item outcomes of a batch result.
function batchItems(r) {
  return Array.isArray(r.items) ? r.items : r.items?.items ?? [];
}

// Classifies an error result by the code it carries.
function errOf(r) {
  const text = JSON.stringify(r.error ?? r.items ?? '');
  return {
    text,
    cardDeclined: text.includes('card-declined'),
    fieldRenamed: text.includes('field-renamed'),
    invalidArgs: text.includes('invalid-args'),
    permanent: r.error?.retryable === false || text.includes('permanent'),
  };
}

function customerEmail(ctx, customerId) {
  const customers = parseJsonFile(ctx, 'master/customers.json');
  const rows = Array.isArray(customers) ? customers : customers?.customers ?? Object.entries(customers ?? {}).map(([id, v]) => ({ id, ...v }));
  return rows.find((c) => c.id === customerId || c.customerId === customerId)?.email ?? null;
}

// Argument names follow the live schema (api/<system>.schema.json, renames included). Unmatched names are kept.
function conformArgs(ctx, system, op, args) {
  const schema = parseJsonFile(ctx, `api/${system}.schema.json`);
  const props = schema?.ops?.[op]?.args?.properties;
  if (!props) return args;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const out = {};
  const unmatchedArgs = Object.keys(args).filter((k) => !(k in props));
  const unmatchedProps = Object.keys(props).filter((p) => !(p in args));
  for (const k of Object.keys(args)) {
    if (k in props) {
      out[k] = args[k];
      continue;
    }
    const byName = unmatchedProps.find((p) => norm(p) === norm(k));
    const byType = unmatchedArgs.length === 1 && unmatchedProps.length === 1 ? unmatchedProps[0] : undefined;
    out[byName ?? byType ?? k] = args[k];
  }
  return out;
}

// ---------- R1 amounts ----------

function catalogPrices(ctx) {
  const catalog = parseJsonFile(ctx, 'master/catalog.json');
  const rows = Array.isArray(catalog) ? catalog : catalog?.items ?? catalog?.products ?? [];
  const price = new Map();
  if (Array.isArray(rows)) {
    for (const p of rows) price.set(p.sku, p.unitPriceMinor);
  } else {
    for (const [sku, v] of Object.entries(catalog ?? {})) price.set(sku, typeof v === 'object' ? v.unitPriceMinor : v);
  }
  return price;
}

function feeTable(table) {
  const m = new Map();
  if (!table) return m;
  const rows = Array.isArray(table) ? table : table.locations ?? table.fees ?? Object.entries(table).map(([location, feeMinor]) => ({ location, feeMinor }));
  for (const r of rows) m.set(r.location, typeof r.feeMinor === 'number' ? r.feeMinor : r.fee ?? 0);
  return m;
}

function computeAmounts(ctx, edition, plan) {
  const price = catalogPrices(ctx);
  const fees = feeTable(rulebookTable(ctx, edition, 'shipping-fees.json'));
  const fulfilments = plan.map((f) => {
    let amount = 0;
    for (const it of f.items) amount += it.qty * price.get(it.sku);
    if (f.location != null) amount += fees.get(f.location) ?? 0;
    return { fulfilmentId: f.fulfilmentId, location: f.location ?? null, items: f.items, amountMinor: amount };
  });
  const totalMinor = fulfilments.reduce((s, f) => s + f.amountMinor, 0);
  return { fulfilments, totalMinor };
}

// ---------- effect helpers (each effect is emitted at most once; the guard names it) ----------

// guard: the dedupe name of the effect; batch ops carry no effect key, so they pass one explicitly.
// Keyed effects are remembered in carry (sent) so that a re-issue repeats the same key and arguments.
function emit(out, state, eff, guard = eff.key) {
  state.emitted ??= [];
  if (state.emitted.includes(guard)) return false;
  state.emitted.push(guard);
  out.effects.push(eff);
  if (eff.key) {
    state.sent ??= {};
    state.sent[eff.key] = { system: eff.system, op: eff.op, args: eff.args };
  }
  return true;
}

// Re-issues a keyed effect already sent, with the same key and arguments (the rejected or unknown one was not applied).
function repush(out, state, key) {
  const s = state.sent?.[key];
  if (!s) return false;
  out.effects.push({ key, ...s });
  return true;
}

// Sets a fulfilment or order status forward only (R7.2); a status is set at most once.
function setStatus(out, state, fulfilmentId, status) {
  const f = fulfilmentId ? fulfilmentOf(state, fulfilmentId) : null;
  if (f) {
    if (TERMINAL.includes(f.status)) return;
    if (status in RANK && (f.status ?? 'pending') in RANK && RANK[status] <= RANK[f.status ?? 'pending']) return;
    f.status = status;
  }
  const key = fulfilmentId ? `st:${state.orderId}:${fulfilmentId}:${status}` : `st:${state.orderId}:order:${status}`;
  emit(out, state, { key, system: 'orders', op: 'setStatus', args: { orderId: state.orderId, fulfilmentId: fulfilmentId ?? null, status } });
}

function notify(out, state, template, about) {
  emit(out, state, {
    key: `notify:${state.orderId}:${template}:${about ?? ''}`,
    system: 'notify',
    op: 'send',
    args: { to: state.email, about, template, text: notifyText(template, about) },
  });
}

function notifyText(template, about) {
  const text = {
    'action-required': `Action is needed for order ${about}.`,
    'order-cancelled': 'Your order has been cancelled.',
    'order-timed-out': 'Your order timed out and was cancelled.',
    'fulfilment-failed': `A fulfilment of your order could not be completed (${about}).`,
    'cancel-refused': 'Your order has already been collected and cannot be cancelled.',
    'unknown-order': 'We could not find that order.',
  };
  return text[template] ?? template;
}

function fulfilmentOf(state, id) {
  return (state.fulfilments ?? []).find((f) => f.fulfilmentId === id);
}

// ---------- R1 intake ----------

// First tick of a placed-order message. Duplicates of a case already running are merged into it (R1.4).
function handlePlaced(ev, input, ctx, out, state) {
  const payload = ev.payload;
  const oid = normaliseOrderId(payload.orderId);
  if (state.orderId != null) return;
  const others = (ctx.instances?.({ subject: oid }) ?? []).filter((i) => i.instance !== input.instance);
  if (others.length > 0) {
    out.merge = { into: others[0].instance };
    out.decisions.subject = oid;
    return;
  }
  state.orderId = oid;
  state.placedAt = payload.placedAt ?? ev.at;
  state.customerId = payload.customerId;
  state.currency = payload.currency;
  state.items = payload.items;
  state.email = customerEmail(ctx, payload.customerId) ?? String(payload.customerId);
  state.stage = 'await-allocation';
  out.effects.push({ key: `alloc:${oid}`, system: 'inventory', op: 'allocate', args: { orderId: oid } });
}

// Allocation result: compute amounts, record the order (R1.1), and run the fraud check (R2.1).
function handleAllocResult(r, ctx, out, state) {
  const planned = findKey(r, 'fulfilments') ?? [];
  const edition = pickEdition(ctx, state.placedAt);
  const amounts = computeAmounts(ctx, edition, planned.map((p) => ({ ...p, items: p.items ?? [] })));
  state.edition = edition?.id ?? null;
  state.fulfilments = amounts.fulfilments.map((f) => {
    const p = planned.find((x) => x.fulfilmentId === f.fulfilmentId);
    return { ...f, available: f.location != null && p?.available !== false, status: null };
  });
  state.totalMinor = amounts.totalMinor;
  state.D = addMin(state.placedAt, Number(policyValue(ctx, edition, 'customerActionHours')) * 60);
  state.stage = 'recording';
  out.effects.push({
    key: `order:${state.orderId}`,
    system: 'orders',
    op: 'create',
    args: {
      orderId: state.orderId,
      customerId: state.customerId,
      placedAt: state.placedAt,
      currency: state.currency,
      items: state.items,
      fulfilments: state.fulfilments.map((f) => ({
        fulfilmentId: f.fulfilmentId, location: f.location, items: f.items, amountMinor: f.amountMinor,
      })),
      totalMinor: state.totalMinor,
    },
  });
  out.effects.push({ key: `fraud:${state.orderId}`, system: 'fraud', op: 'check', args: { orderId: state.orderId } });
}

// ---------- R2 fraud decision ----------

function handleFraudVerdict(verdict, ctx, out, state, now) {
  if (verdict === 'pass') {
    onCleared(out, state, state.placedAt);
  } else if (verdict === 'reject') {
    cancelOrder(out, state, 'fraud');
  } else if (verdict === 'review') {
    // S3: one deadline per order, counted from the first review task.
    const hours = policyValue(ctx, pickEdition(ctx, state.placedAt), 'fraudReviewHours');
    state.review = { deadline: addMin(now, Number(hours) * 60), attempts: 1, decided: false };
    openReviewTask(out, state, `review:${state.orderId}:1`);
    timer(out, state, 'reviewDeadline', addMin(state.review.deadline, 1));
  }
}

// R2.2: an unusable, withdrawn or rejected answer is asked again (new task id), deadline unchanged.
function askReviewAgain(out, state, at) {
  if (!state.review || state.review.decided || Date.parse(at) > Date.parse(state.review.deadline)) return;
  state.review.attempts += 1;
  openReviewTask(out, state, `review:${state.orderId}:${state.review.attempts}`);
}

function handleReviewAnswer(ev, out, state) {
  if (!state.review || state.review.decided) return;
  if (Date.parse(ev.at) > Date.parse(state.review.deadline)) return;
  const decision = findKey(ev.payload ?? ev, 'decision');
  if (decision === 'approve') {
    state.review.decided = true;
    onCleared(out, state, ev.at);
  } else if (decision === 'reject') {
    state.review.decided = true;
    cancelOrder(out, state, 'fraud');
  } else {
    askReviewAgain(out, state, ev.at);
  }
}

function openReviewTask(out, state, id) {
  out.humanTasks.push({
    id,
    kind: 'fraudReview',
    role: 'fraudAnalyst',
    subject: state.orderId,
    question: `Review fraud check for order ${state.orderId}: approve or reject?`,
    answerSchema: {
      type: 'object',
      required: ['decision'],
      properties: { decision: { enum: ['approve', 'reject'] } },
      additionalProperties: false,
    },
    dueAt: state.review.deadline,
    onTimeout: 'fraudReviewTimeout',
  });
}

// Cancel the whole order (R6.1, R6.2, R2): every non-terminal fulfilment is compensated (R5.1) and cancelled,
// then the order, then the notice. Steps still in flight are compensated when they commit (see handleSagaResult).
function cancelOrder(out, state, reason) {
  if (state.cancelRequested) return;
  state.cancelRequested = reason;
  state.stopped = true;
  for (const f of state.fulfilments ?? []) {
    if (TERMINAL.includes(f.status)) continue;
    compensate(out, state, f);
    setStatus(out, state, f.fulfilmentId, 'cancelled');
  }
  state.finalStatus = 'cancelled';
  setStatus(out, state, null, 'cancelled');
  notify(out, state, 'order-cancelled', state.orderId);
}

// R3.2 timeout: nothing counted by D.
function timeOut(out, state) {
  state.stopped = true;
  for (const f of state.fulfilments ?? []) {
    if (!TERMINAL.includes(f.status)) setStatus(out, state, f.fulfilmentId, 'cancelled');
  }
  state.finalStatus = 'timedOut';
  setStatus(out, state, null, 'timedOut');
  notify(out, state, 'order-timed-out', state.orderId);
}

// ---------- R3/R4 ready and processing ----------

// R3.1: an unavailable fulfilment means the customer must act by D = p + customerActionHours.
// R4.1: otherwise the order is ready now.
function onCleared(out, state, at) {
  if (state.cancelRequested) return; // a cancel that came first wins; a later verdict or answer changes nothing
  state.cleared = at;
  if (state.fulfilments.some((f) => !f.available)) {
    state.waiting = true;
    setStatus(out, state, null, 'customerActionRequired');
    notify(out, state, 'action-required', state.orderId);
    timer(out, state, 'customerDeadline', addMin(state.D, 1));
  } else {
    startProcessing(out, state, at);
  }
}

// A timer that wakes this instance at dueAt (obligations are wake-ups only).
function timer(out, state, onDue, dueAt) {
  const id = `${onDue}:${state.orderId}`;
  if (state.timers?.includes(id)) return;
  state.timers ??= [];
  state.timers.push(id);
  out.obligations.upsert.push({ id, kind: 'timer', anchor: state.placedAt, dueAt, onDue });
}

// R4.1: the order and every available fulfilment go processing; then each fulfilment reserves its items.
function startProcessing(out, state, at) {
  if (state.ready || state.cancelRequested) return;
  state.ready = at;
  setStatus(out, state, null, 'processing');
  for (const f of state.fulfilments) {
    if (f.available) setStatus(out, state, f.fulfilmentId, 'processing');
  }
  for (const f of state.fulfilments) {
    if (f.available) reserveItems(out, state, f, 1, f.items);
  }
}

// R4.2.1: one batch per fulfilment; items keep their original keys across resubmissions.
function reserveItems(out, state, f, attempt, items) {
  f.reserveAttempt = attempt;
  emit(out, state, {
    system: 'inventory',
    op: 'reserve',
    args: {
      orderId: state.orderId,
      fulfilmentId: f.fulfilmentId,
      location: f.location,
      items: items.map((it) => ({ key: itemKey(state, f, it.sku), sku: it.sku, qty: it.qty })),
    },
  }, `res:${state.orderId}:${f.fulfilmentId}:${attempt}`);
}

function itemKey(state, f, sku) {
  return `rsv:${state.orderId}:${f.fulfilmentId}:${sku}`;
}

function handleReserveResult(r, out, state, f) {
  f.reservedSkus ??= [];
  const outcomes = batchItems(r);
  for (const o of outcomes) {
    if (o.status === 'ok' && !f.reservedSkus.includes(o.sku ?? o.key?.split(':').pop())) {
      f.reservedSkus.push(o.sku ?? o.key?.split(':').pop());
    }
  }
  const failed = outcomes.filter((o) => o.status !== 'ok' && o.ok !== true);
  if (r.status === 'partial' && failed.length > 0) {
    const retry = f.items.filter((it) => failed.some((o) => o.key === itemKey(state, f, it.sku)));
    reserveItems(out, state, f, f.reserveAttempt + 1, retry);
    return;
  }
  if (r.status === 'ok' || r.status === 'partial') {
    f.reserved = true;
    chargeFulfilment(out, state, f);
  }
}

// R4.2.2
function chargeFulfilment(out, state, f) {
  emit(out, state, {
    key: `chg:${state.orderId}:${f.fulfilmentId}`,
    system: 'billing',
    op: 'charge',
    args: {
      orderId: state.orderId,
      fulfilmentId: f.fulfilmentId,
      customerId: state.customerId,
      amountMinor: f.amountMinor,
      currency: state.currency,
    },
  });
}

// R4.2.3. The shipment ref is the fulfilment id, so the carrier's messages route back here.
function shipFulfilment(out, state, f) {
  emit(out, state, {
    key: `ship:${state.orderId}:${f.fulfilmentId}`,
    system: 'carrier',
    op: 'create',
    args: { orderId: state.orderId, fulfilmentId: f.fulfilmentId, location: f.location, ref: f.fulfilmentId },
  });
}

// ---------- R5 failure and compensation ----------

// R5.1: undo committed steps in reverse order: shipment, charge, reservations.
function compensate(out, state, f) {
  if (f.shipped && !f.collectionFailed) {
    emit(out, state, {
      key: `cxl:${state.orderId}:${f.fulfilmentId}`,
      system: 'carrier',
      op: 'cancel',
      args: { orderId: state.orderId, fulfilmentId: f.fulfilmentId },
    });
  }
  if (f.charged) {
    emit(out, state, {
      key: `ref:${state.orderId}:${f.fulfilmentId}`,
      system: 'billing',
      op: 'refund',
      args: { orderId: state.orderId, fulfilmentId: f.fulfilmentId, amountMinor: f.amountMinor },
    });
  }
  for (const sku of f.reservedSkus ?? []) {
    emit(out, state, {
      key: `rel:${state.orderId}:${f.fulfilmentId}:${sku}`,
      system: 'inventory',
      op: 'release',
      args: { orderId: state.orderId, fulfilmentId: f.fulfilmentId, sku },
    });
  }
}

// R5.2: the fulfilment fails; compensate it, set it failed, and tell the customer.
function failFulfilment(out, state, f) {
  if (TERMINAL.includes(f.status)) return;
  compensate(out, state, f);
  f.failed = true;
  setStatus(out, state, f.fulfilmentId, 'failed');
  emit(out, state, {
    key: `notify:${state.orderId}:fulfilment-failed:${f.fulfilmentId}`,
    system: 'notify',
    op: 'send',
    args: { to: state.email, about: f.fulfilmentId, template: 'fulfilment-failed', text: notifyText('fulfilment-failed', f.fulfilmentId) },
  });
  checkOrderOutcome(out, state);
}

// R4.5: once every fulfilment is terminal, the order takes its outcome.
function checkOrderOutcome(out, state) {
  if (!state.ready || state.finalStatus) return;
  if (!state.fulfilments.every((f) => TERMINAL.includes(f.status))) return;
  const statuses = state.fulfilments.map((f) => f.status);
  const outcome = statuses.includes('completed') ? 'completed' : statuses.includes('failed') ? 'failed' : 'cancelled';
  state.finalStatus = outcome;
  setStatus(out, state, null, outcome);
}

// ---------- saga results (R4.2 steps, with R5 on failure) ----------

// A step that commits after the order was stopped is compensated at once (R6.2); nothing new is started.
function handleAfterStop(r, out, state, kind, f) {
  if (r.status !== 'ok' && r.status !== 'partial') return;
  if (kind === 'res') {
    f.reservedSkus ??= [];
    for (const o of batchItems(r)) {
      const sku = o.sku ?? String(o.key ?? '').split(':').pop();
      if (o.status === 'ok' && !f.reservedSkus.includes(sku)) f.reservedSkus.push(sku);
    }
  } else if (kind === 'chg' && r.status === 'ok') {
    f.charged = true;
  } else if (kind === 'ship' && r.status === 'ok') {
    f.shipped = true;
  } else {
    return;
  }
  compensate(out, state, f);
}

// Routes one effect result to the saga step it belongs to. Returns true when it was handled.
function handleSagaResult(r, out, state) {
  // A reserve batch has no key of its own; its items carry keys that name the fulfilment.
  const idSource = r.op === 'reserve' ? batchItems(r).find((o) => String(o.key ?? '').startsWith('rsv:'))?.key : r.key;
  const parts = String(idSource ?? '').split(':');
  if (parts.length < 3 || parts[1] !== state.orderId) return false;
  const kind = r.op === 'reserve' ? 'res' : parts[0];
  const f = fulfilmentOf(state, parts[2]);
  if (!f) return false;
  if (state.stopped) {
    handleAfterStop(r, out, state, kind, f);
    return true;
  }
  if (TERMINAL.includes(f.status)) return false;

  if (kind === 'res' && (r.status === 'ok' || r.status === 'partial')) {
    handleReserveResult(r, out, state, f);
    return true;
  }
  if (kind === 'res' && r.status === 'error') {
    const e = errOf(r);
    if ((e.permanent && !e.invalidArgs && !e.fieldRenamed) || f.reserveAttempt >= 5) {
      failFulfilment(out, state, f);
    } else {
      // Items already reserved keep their keys; resubmit only the rest.
      const rest = f.items.filter((it) => !(f.reservedSkus ?? []).includes(it.sku));
      reserveItems(out, state, f, f.reserveAttempt + 1, rest);
    }
    return true;
  }
  if (kind === 'chg') {
    const e = errOf(r);
    if (r.status === 'ok') {
      f.charged = true;
      shipFulfilment(out, state, f);
    } else if ((e.fieldRenamed || e.invalidArgs) && (f.chargeReissues ?? 0) < 3) {
      f.chargeReissues = (f.chargeReissues ?? 0) + 1;
      repush(out, state, r.key);
    } else if (e.cardDeclined || e.permanent) {
      failFulfilment(out, state, f);
    }
    return true;
  }
  if (kind === 'ship') {
    const e = errOf(r);
    if (r.status === 'ok') {
      f.shipped = true;
    } else if ((e.fieldRenamed || e.invalidArgs) && (f.shipReissues ?? 0) < 3) {
      f.shipReissues = (f.shipReissues ?? 0) + 1;
      repush(out, state, r.key);
    } else if (e.permanent && !e.invalidArgs) {
      failFulfilment(out, state, f);
    }
    return true;
  }
  return false;
}

// ---------- R4.4 carrier messages ----------

function carrierMeaning(ctx, edition, code) {
  const table = rulebookTable(ctx, edition, 'carrier-codes.json');
  const rows = Array.isArray(table) ? table : table ? Object.entries(table).map(([c, v]) => ({ code: c, meaning: typeof v === 'string' ? v : v.meaning })) : [];
  return rows.find((r) => r.code === code)?.meaning ?? 'info';
}

function handleCarrier(ev, ctx, out, state) {
  const p = ev.payload;
  const f = fulfilmentOf(state, p.fulfilmentRef);
  if (!f || TERMINAL.includes(f.status)) return;
  const edition = pickEdition(ctx, state.placedAt);
  const meaning = carrierMeaning(ctx, edition, p.code);
  if (meaning === 'collected' || meaning === 'inTransit' || meaning === 'delivered') {
    // S7: any of these proves collection, judged by reportedAt; the earliest proof counts.
    const at = p.reportedAt ?? ev.at;
    if (state.collectedAt == null || Date.parse(at) < Date.parse(state.collectedAt)) state.collectedAt = at;
  }
  if (meaning === 'collected') {
    setStatus(out, state, f.fulfilmentId, 'dispatched');
  } else if (meaning === 'delivered') {
    setStatus(out, state, f.fulfilmentId, 'dispatched');
    setStatus(out, state, f.fulfilmentId, 'completed');
    checkOrderOutcome(out, state);
  } else if (meaning === 'collectionFailed') {
    f.collectionFailed = true;
    failFulfilment(out, state, f);
  }
}

// ---------- customer actions (R3.2, R6.2-R6.4) ----------

function handleCustomerAction(ev, out, state) {
  const p = ev.payload;
  if (normaliseOrderId(p.orderRef) !== state.orderId) return;
  if (!state.fulfilments || state.finalStatus || state.cancelRequested) return; // not recorded yet: nothing to act on
  const a = ev.at;

  if (state.waiting) {
    // R3.2: the first amend or cancel at or before D counts; later ones change nothing.
    if (Date.parse(a) > Date.parse(state.D)) return;
    state.waiting = false;
    if (p.action === 'cancel') {
      cancelOrder(out, state, 'customer');
      return;
    }
    if (p.action === 'amend') {
      for (const f of state.fulfilments) {
        if (!f.available) setStatus(out, state, f.fulfilmentId, 'cancelled');
      }
      if (state.fulfilments.some((f) => f.available)) startProcessing(out, state, a);
      else cancelOrder(out, state, 'nothing-available');
    }
    return;
  }

  if (p.action !== 'cancel') return;
  if (state.ready) {
    // R6.2 / S4 / S7: a collection reported at or before the cancel wins.
    if (state.collectedAt != null && Date.parse(state.collectedAt) <= Date.parse(a)) {
      notify(out, state, 'cancel-refused', state.orderId);
      return;
    }
    cancelOrder(out, state, 'customer');
    return;
  }
  if (state.cleared == null) cancelOrder(out, state, 'customer'); // R6.4: fraud review still open
}

function handleTimer(onDue, out, state) {
  if (onDue === 'customerDeadline' && state.waiting) {
    state.waiting = false;
    timeOut(out, state);
  } else if (onDue === 'reviewDeadline' && state.review && !state.review.decided && !state.cancelRequested) {
    state.review.decided = true;
    cancelOrder(out, state, 'fraud-review-timeout');
  }
}

// ---------- messages that start a new instance (inbound channel) ----------

// Merges a message that belongs to an open order into that order's instance (§1 Routing).
function routeToOrder(oid, input, ctx, out) {
  const others = (ctx.instances?.({ subject: oid }) ?? []).filter((i) => i.instance !== input.instance);
  if (others.length > 0) {
    out.merge = { into: others[0].instance };
    out.decisions.subject = oid;
  }
}

// A carrier message without a ref of ours (e.g. booked before go-live) is matched by its fulfilmentRef.
function routeCarrier(ev, input, ctx, out) {
  const rows = ctx.query?.('orders.fulfilments', { where: { fulfilmentId: ev.payload.fulfilmentRef }, limit: 1 }) ?? [];
  const oid = rows[0]?.orderId;
  if (oid) routeToOrder(normaliseOrderId(oid), input, ctx, out);
}

// ---------- go-live (§3.5): an order already in flight, continued from its recorded state ----------

function restoreMigration(ev, input, ctx, out, state) {
  const records = ev.payload?.records ?? parseJsonFile(ctx, `sor/${input.instance}.json`) ?? {};
  const rows = (name) => {
    const [sys, tbl] = name.split('.');
    const hit = [records[name], records[sys]?.[tbl], records.tables?.[name], findKey(records, name), findKey(records, tbl)]
      .find((v) => Array.isArray(v));
    return hit ?? [];
  };
  const order = rows('orders.orders')[0] ?? {};
  const oid = normaliseOrderId(order.orderId ?? ev.payload?.orderId);
  if (!oid) return;
  state.orderId = oid;
  state.placedAt = order.placedAt ?? ev.payload?.placedAt ?? ev.at;
  state.customerId = order.customerId ?? ev.payload?.customerId;
  state.currency = order.currency ?? ev.payload?.currency;
  state.items = order.items ?? [];
  state.email = customerEmail(ctx, state.customerId) ?? String(state.customerId);
  state.totalMinor = order.totalMinor;
  state.stage = 'checked';

  const edition = pickEdition(ctx, state.placedAt);
  state.edition = edition?.id ?? null;
  state.D = addMin(state.placedAt, Number(policyValue(ctx, edition, 'customerActionHours')) * 60);

  const charges = rows('billing.charges');
  const refunds = rows('billing.refunds');
  const reservations = rows('inventory.reservations');
  const shipments = rows('carrier.shipments');
  state.fulfilments = rows('orders.fulfilments')
    .filter((fr) => fr.orderId == null || normaliseOrderId(fr.orderId) === oid)
    .map((fr) => {
      const fid = fr.fulfilmentId;
      const ship = shipments.find((s) => s.fulfilmentId === fid && s.status !== 'cancelled');
      return {
        fulfilmentId: fid,
        location: fr.location ?? null,
        items: fr.items ?? [],
        amountMinor: fr.amountMinor,
        available: fr.status !== 'unavailable' && fr.location != null,
        status: fr.status === 'unavailable' ? null : fr.status,
        charged: charges.some((c) => c.fulfilmentId === fid) && !refunds.some((r) => r.fulfilmentId === fid),
        reservedSkus: reservations.filter((r) => r.fulfilmentId === fid && r.status === 'active').map((r) => r.sku),
        shipped: !!ship,
      };
    });
  // A collection proven by any shipment report counts as of the migration (S7): later cancels are refused.
  if (shipments.some((s) => ['collected', 'inTransit', 'delivered'].includes(s.status))) state.collectedAt = ev.at;

  const st = order.status;
  if (['completed', 'failed', 'cancelled', 'timedOut'].includes(st)) {
    state.finalStatus = st;
    state.stopped = true;
    state.cancelRequested = st;
  } else if (st === 'customerActionRequired') {
    state.cleared = state.placedAt;
    state.waiting = true;
    timer(out, state, 'customerDeadline', addMin(state.D, 1));
  } else if (st === 'processing') {
    state.cleared = state.placedAt;
    resumeProcessing(out, state, ev.at);
  } else {
    // Not yet cleared: the fraud check is run again and its verdict handled as usual.
    state.stage = 'recording';
    out.effects.push({ key: `fraud:${oid}`, system: 'fraud', op: 'check', args: { orderId: oid } });
  }
}

// Continues the saga of a migrated processing order: only the steps not yet committed are sent.
function resumeProcessing(out, state, at) {
  state.ready = at;
  for (const f of state.fulfilments) {
    if (!f.available || TERMINAL.includes(f.status)) continue;
    const missing = f.items.filter((it) => !f.reservedSkus.includes(it.sku));
    if (missing.length > 0) {
      reserveItems(out, state, f, 1, missing);
    } else if (!f.charged) {
      chargeFulfilment(out, state, f);
    } else if (!f.shipped) {
      shipFulfilment(out, state, f);
    }
  }
}

// ---------- tick ----------

export function createSolver() {
  return {
    id: 'solver',
    tick(input, ctx) {
      const { now, events } = input;
      const state = input.carry ?? { orderId: null };
      const out = {
        decisions: { subject: state.orderId ?? null },
        effects: [],
        obligations: { upsert: [], cancel: [] },
        humanTasks: [],
        carry: state,
      };
      // A migration event restores the instance; the messages it carries are then handled as ordinary events.
      const queue = [...events];
      for (let i = 0; i < queue.length; i++) {
        const ev = queue[i];
        if (ev.type === 'migration') {
          restoreMigration(ev, input, ctx, out, state);
          queue.push(...(ev.payload?.messages ?? ev.payload?.events ?? []));
          continue;
        }
        const r = resultOf(ev);
        if (r?.status === 'unknown' && state.sent?.[r.key]) {
          // S2: an unknown outcome counts as committed only if status(key) says so; otherwise the same request is sent again.
          const sys = state.sent[r.key].system;
          if (ctx.status?.(sys, r.key) === 'committed') {
            r.status = 'ok';
          } else {
            state.resent ??= {};
            state.resent[r.key] = (state.resent[r.key] ?? 0) + 1;
            if (state.resent[r.key] <= 3) repush(out, state, r.key);
            continue;
          }
        }
        if (r) {
          if (state.stage === 'await-allocation' && r.key === `alloc:${state.orderId}`) {
            handleAllocResult(r, ctx, out, state);
          } else if (state.orderId && r.key === `fraud:${state.orderId}` && state.stage === 'recording') {
            state.stage = 'checked';
            handleFraudVerdict(findKey(r, 'verdict'), ctx, out, state, now);
          } else if (state.orderId) {
            handleSagaResult(r, out, state);
          }
        } else if (ev.type === 'timer.fired' && state.orderId) {
          handleTimer(findKey(ev, 'onDue'), out, state);
        } else if (ev.type?.startsWith('humanTask.') && state.orderId) {
          if (ev.type === 'humanTask.answered') handleReviewAnswer(ev, out, state);
          else if (ev.type === 'humanTask.answerRejected' || ev.type === 'humanTask.withdrawn') askReviewAgain(out, state, ev.at);
        } else if (ev.source === 'shop' && ev.payload?.orderId != null) {
          handlePlaced(ev, input, ctx, out, state);
        } else if (ev.source === 'customer-portal' && ev.payload?.orderRef != null) {
          if (state.orderId) handleCustomerAction(ev, out, state);
          else routeToOrder(normaliseOrderId(ev.payload.orderRef), input, ctx, out);
        } else if (ev.source === 'carrier') {
          if (state.orderId) handleCarrier(ev, ctx, out, state);
          else routeCarrier(ev, input, ctx, out);
        }
      }
      // Effects are written against the live API schemas (renames included).
      out.effects = out.effects.map((e) => ({ ...e, args: conformArgs(ctx, e.system, e.op, e.args) }));
      out.decisions.subject = state.orderId ?? null;
      out.carry = state;
      return out;
    },
  };
}

// Effect results carry { key, system, op, status, items?, error? }, either on the event or under its payload.
// Returns that result object, or null when the event is not an effect result.
function resultOf(ev) {
  if (ev.type !== 'effect.result') return null;
  const p = ev.payload ?? {};
  return { ...ev, ...p, key: p.key ?? ev.key };
}
