// E8 order fulfilment solver (SPEC-E), with constitution clauses C1-C3.
// Deterministic: time comes only from input.now and the files in ctx.files.

import { createHash } from 'node:crypto';

const MIN_MS = 60000;

// ---------- small helpers ----------

export function normaliseOrderId(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (s.startsWith('#')) s = s.slice(1).trim();
  return s.toUpperCase();
}

function parseJsonFile(files, path) {
  const text = files[path];
  if (text == null) return null;
  if (typeof text === 'string') {
    try { return JSON.parse(text); } catch { return null; }
  }
  return text;
}

function fileText(files, path) {
  const v = files[path];
  if (v == null) return null;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function minutesBetween(a, b) {
  return (Date.parse(b) - Date.parse(a)) / MIN_MS;
}

function addMinutes(iso, m) {
  return new Date(Date.parse(iso) + m * MIN_MS).toISOString();
}

// Local calendar date (Europe/Amsterdam) of an ISO instant, as YYYY-MM-DD.
function amsterdamDate(iso) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(iso));
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

// ---------- constitution (C3 change control) ----------

// Returns { hash, version, parameters, bounds } for the version in force at instant `at`.
// Version 1 is the founding version; a later version is in force only if it was proposed by
// finance/controller, approved before its effectiveFrom by a controller holder under the version
// then in force who is not the proposer, and stays within bounds (B1).
export function constitutionInForce(files, at) {
  const log = parseJsonFile(files, 'constitution/log.json') || [];
  const versionDocs = [];
  for (const k of Object.keys(files)) {
    if (!k.startsWith('constitution/versions/') || !k.endsWith('.json')) continue;
    const doc = parseJsonFile(files, k);
    if (doc) versionDocs.push(doc);
  }
  const byNum = new Map();
  for (const d of versionDocs) byNum.set(d.version, d);

  const founding = byNum.get(1);
  if (!founding) return null;
  let current = { version: founding, hash: hashFromLog(log, 1) };
  // Walk versions in order; each must pass the gate against the version then in force.
  const nums = [...byNum.keys()].filter((n) => n > 1).sort((a, b) => a - b);
  for (const n of nums) {
    const doc = byNum.get(n);
    const hash = hashFromLog(log, n);
    if (!hash || !doc.effectiveFrom) continue;
    if (Date.parse(doc.effectiveFrom) > Date.parse(at)) continue;
    if (passesChangeGate(log, doc, n, hash, current.version)) {
      current = { version: doc, hash };
    }
  }
  return {
    hash: current.hash,
    version: current.version,
    parameters: current.version.parameters || {},
    bounds: current.version.bounds || [],
  };
}

function hashFromLog(log, n) {
  const p = log.find((e) => e.type === 'proposed' && e.version === n);
  return p ? p.hash : null;
}

function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

function passesChangeGate(log, doc, n, hash, inForce) {
  if (createHash('sha256').update(canonical(doc)).digest('hex') !== hash) return false;
  const proposal = log.find((e) => e.type === 'proposed' && e.version === n && e.hash === hash);
  if (!proposal) return false;
  const proposerRoles = (inForce.change && inForce.change.proposerRoles) || ['finance', 'controller'];
  const principalRoles = (id) => {
    const p = (inForce.principals || []).find((x) => x.id === id);
    return p ? p.roles : [];
  };
  if (!proposerRoles.some((r) => principalRoles(proposal.by).includes(r))) return false;
  const approval = log.find((e) => e.type === 'approval' && e.version === n && e.hash === hash
    && e.by !== proposal.by && principalRoles(e.by).includes('controller'));
  if (!approval) return false;
  if (Date.parse(approval.at) >= Date.parse(doc.effectiveFrom)) return false;
  const bounds = inForce.bounds || [];
  const threshold = doc.parameters && doc.parameters.refundApprovalThresholdMinor;
  if (threshold != null) {
    for (const b of bounds) {
      if (b.parameter === 'refundApprovalThresholdMinor') {
        if (threshold < b.min || threshold > b.max) return false;
      }
    }
  }
  return true;
}

// ---------- rulebook (R1.3 editions) ----------

function listEditions(files) {
  const out = [];
  for (const k of Object.keys(files)) {
    const m = /^rulebook\/([^/]+)\/edition\.json$/.exec(k);
    if (!m) continue;
    const ed = parseJsonFile(files, k);
    if (ed && ed.id && ed.effectiveFrom) out.push({ dir: m[1], ...ed });
  }
  return out;
}

export function editionFor(files, placedAt) {
  const day = amsterdamDate(placedAt);
  const eds = listEditions(files)
    .filter((e) => e.effectiveFrom <= day)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0));
  return eds.length ? eds[0].dir : null;
}

function rulebookTable(files, edition, name) {
  return parseJsonFile(files, `rulebook/${edition}/${name}.json`);
}

export { parseJsonFile, fileText, minutesBetween, addMinutes, amsterdamDate };

// ---------- readers for master data and rulebook (shapes are unknown; accept the likely ones) ----------

function priceTable(catalog) {
  const rows = Array.isArray(catalog) ? catalog : (catalog.products || catalog.items || catalog.skus || null);
  const map = new Map();
  if (Array.isArray(rows)) {
    for (const r of rows) map.set(r.sku, r.unitPriceMinor);
  } else if (catalog && typeof catalog === 'object') {
    for (const [sku, v] of Object.entries(catalog)) {
      map.set(sku, typeof v === 'number' ? v : v && v.unitPriceMinor);
    }
  }
  return map;
}

function feeOf(fees, location) {
  if (location == null) return 0;
  const rows = Array.isArray(fees) ? fees : (fees.locations || fees.fees || null);
  if (Array.isArray(rows)) {
    const r = rows.find((x) => x.location === location);
    return r ? r.feeMinor : 0;
  }
  if (fees && typeof fees === 'object') {
    const v = fees[location];
    return typeof v === 'number' ? v : (v && v.feeMinor) || 0;
  }
  return 0;
}

function cleanItem(it) {
  return { sku: it.sku, qty: it.qty };
}

// The `result` of an effect as delivered: items or the payload itself.
function resultOf(payload) {
  if (!payload) return null;
  if (payload.items && !Array.isArray(payload.items)) return payload.items;
  if (payload.result) return payload.result;
  return payload;
}

// ---------- tick ----------

const EMPTY_OUT = (subject, carry) => ({
  decisions: { subject, constitution: { pins: {} } },
  effects: [],
  obligations: { upsert: [], cancel: [] },
  humanTasks: [],
  carry,
});

export function createSolver() {
  return {
    id: 'solver',
    tick(input, ctx) {
      const events = input.events || [];
      const carry = input.carry || { order: null };
      const subjectId = carry.order ? carry.order.orderId : null;
      const out = EMPTY_OUT(subjectId, carry);
      const placed = events.find((e) => (e.type === 'order.placed' || e.type === 'message.received') && e.payload && e.payload.orderId && e.payload.items);
      let res;
      if (placed && !carry.order) res = intake(placed, input, ctx, out);
      else if (!carry.order) res = startOther(input, events, ctx, out);
      else res = advance(input, events, ctx, out);
      res.effects = res.effects.map((e) => adaptArgs(ctx, e));
      return res;
    },
  };
}

// Argument names follow api/<system>.schema.json as it is now (F5 renames): a logical name that the
// schema no longer has is mapped to the schema's name, by normalised match or else by the free slot.
function adaptArgs(ctx, eff) {
  if (!eff.args) return eff;
  const sc = parseJsonFile(ctx.files, `api/${eff.system}.schema.json`);
  const op = sc && sc.ops && sc.ops[eff.op];
  const schemaArgs = op && op.args;
  if (!schemaArgs || !schemaArgs.properties) return eff;
  const props = Object.keys(schemaArgs.properties);
  const norm = (x) => x.toLowerCase().replace(/[^a-z]/g, '');
  const args = {};
  const unmatched = [];
  for (const [k, v] of Object.entries(eff.args)) {
    if (props.includes(k)) args[k] = v;
    else {
      const hit = props.find((p) => norm(p) === norm(k));
      if (hit) args[hit] = v; else unmatched.push([k, v]);
    }
  }
  const free = (schemaArgs.required || []).filter((p) => !(p in args));
  unmatched.forEach(([k, v], i) => { if (free[i]) args[free[i]] = v; });
  return { ...eff, args };
}

// R1.1-R1.4: record the order once (duplicates are ignored); allocation comes from inventory.allocate.
function intake(ev, input, ctx, out) {
  const p = ev.payload;
  const orderId = normaliseOrderId(p.orderId);
  // R1.4: a placed order already recorded (or run by another open instance) is a duplicate: no effect.
  const recorded = ctx.query('orders.orders', { where: { orderId }, limit: 1 });
  const others = ctx.instances({ subject: orderId }).filter((i) => i.instance !== input.instance);
  if ((recorded && recorded.length) || others.length) {
    out.decisions.subject = orderId;
    if (others.length) out.merge = { into: others[0].instance };
    out.close = true;
    out.carry = {};
    return out;
  }
  const edition = editionFor(ctx.files, ev.at);
  const pin = constitutionInForce(ctx.files, ev.at);
  out.decisions.subject = orderId;
  out.decisions.constitution = { pins: { [orderId]: pin ? pin.hash : null } };
  out.carry = {
    order: {
      orderId, customerId: p.customerId, placedAt: ev.at, currency: p.currency, items: p.items,
      edition, pinHash: pin ? pin.hash : null, status: 'intake', fulfilments: {},
    },
  };
  out.effects.push({ system: 'inventory', op: 'allocate', args: { orderId } });
  return out;
}

// A message that starts an instance without an order of ours: customer actions and carrier reports
// belong to the open case of their order (merge), or nothing (S11: no order yet, or no order at all).
function startOther(input, events, ctx, out) {
  const ca = events.find((e) => e.type === 'customer.action' || (e.payload && e.payload.orderRef && e.payload.action));
  const cr = events.find((e) => e.type === 'carrier.status' || (e.payload && e.payload.fulfilmentRef && e.payload.code !== undefined));
  let orderId = null;
  if (ca) {
    orderId = normaliseOrderId(ca.payload.orderRef);
  } else if (cr) {
    const rows = ctx.query('orders.fulfilments', { where: { fulfilmentId: cr.payload.fulfilmentRef }, limit: 1 });
    orderId = rows && rows.length ? rows[0].orderId : null;
  }
  if (orderId) {
    const others = ctx.instances({ subject: orderId }).filter((i) => i.instance !== input.instance);
    if (others.length) out.merge = { into: others[0].instance };
  }
  out.decisions.subject = null;
  out.close = true;
  out.carry = {};
  return out;
}

// ---------- events ----------

// Facts from this call's events, in delivery order (S4: a report before a cancel in one instant counts).
function advance(input, events, ctx, out) {
  const o = out.carry.order;
  out.decisions.constitution = { pins: { [o.orderId]: o.pinHash } };
  o.keys = o.keys || {};
  o.setSt = o.setSt || {};
  for (const ev of events) {
    if (ev.type === 'effect.result') onResult(ev, o, ctx);
    else if (ev.type === 'humanTask.answered') (o.answers = o.answers || []).push({ taskId: taskIdOf(ev), at: ev.at, answer: ev.payload.answer, user: ev.payload.user, used: false });
    else if (ev.type === 'humanTask.answerRejected' || ev.type === 'humanTask.timeout' || ev.type === 'humanTask.withdrawn') (o.lost = o.lost || []).push(taskIdOf(ev));
    else if (ev.type === 'timer.fired') (o.fired = o.fired || {})[ev.payload.obligationId] = ev.at;
    else if (isCustomerAction(ev)) onCustomerAction(ev, o);
    else if (isCarrierReport(ev)) onCarrier(ev, o, ctx);
  }
  drive(input, o, ctx, out);
  return out;
}

function taskIdOf(ev) {
  return ev.payload.taskId || ev.payload.id || ev.payload.task || null;
}

function isCustomerAction(ev) {
  return ev.type === 'customer.action' || (ev.payload && ev.payload.orderRef && ev.payload.action);
}

function isCarrierReport(ev) {
  return ev.type === 'carrier.status' || (ev.payload && ev.payload.fulfilmentRef && ev.payload.code !== undefined);
}

function errCode(pl) {
  if (!pl.error) return null;
  return typeof pl.error === 'string' ? pl.error : pl.error.code;
}

// An effect result updates the registry; a batch reserve updates each item.
function onResult(ev, o, ctx) {
  const pl = ev.payload || {};
  if (pl.system === 'inventory' && pl.op === 'allocate') return onAllocate(pl, o, ctx);
  if (pl.system === 'fraud' && pl.op === 'check') {
    if (pl.status === 'ok') o.verdict = (resultOf(pl) || {}).verdict || null;
    return;
  }
  if (pl.system === 'inventory' && pl.op === 'reserve') return onReserve(pl, o);
  const k = pl.key != null ? o.keys[pl.key] : null;
  if (!k) return;
  const code = errCode(pl);
  const perm = !!pl.error && !(pl.error.retryable === true) && !['invalid-args', 'field-renamed'].includes(code);
  if (pl.status === 'ok') k.state = 'ok';
  else if (pl.status === 'unknown') k.state = 'unknown';
  else if (['invalid-args', 'field-renamed'].includes(code)) k.state = 'retry';
  else if (code === 'already-collected') k.state = 'collected';
  else k.state = perm ? 'failed' : 'err';
  k.err = code;
}

// A reserve batch reports one row per item key; each item settles on its own (R4.2).
function onReserve(pl, o) {
  const rows = Array.isArray(pl.items) ? pl.items : [];
  for (const row of rows) {
    const e = o.keys[row.key];
    if (!e) continue;
    const code = row.error ? (row.error.code || row.error) : (pl.error ? errCode(pl) : null);
    const retryable = !!(row.error && row.error.retryable === true);
    if (row.status === 'ok' || (!row.status && pl.status === 'ok')) e.state = 'ok';
    else if (row.status === 'unknown') e.state = 'unknown';
    else if (['invalid-args', 'field-renamed', 'batch-item-not-processed'].includes(code) || retryable) e.state = 'retry';
    else e.state = 'failed';
    e.err = code;
  }
}

// S11/S12/S7: a customer action is kept with what was known when it arrived (collections proven so far).
function onCustomerAction(ev, o) {
  const p = ev.payload || {};
  if (normaliseOrderId(p.orderRef) !== o.orderId) return;
  if (p.enteredBy && !String(p.enteredBy).startsWith('cust:')) {
    o.enteredBy = [...new Set([...(o.enteredBy || []), p.enteredBy])];
  }
  const proof = Object.values(o.fulfilments || {}).some((f) => (f.reports || []).some((r) =>
    ['collected', 'inTransit', 'delivered'].includes(r.meaning) && Date.parse(r.at) <= Date.parse(ev.at)));
  (o.pendingCa = o.pendingCa || []).push({ at: ev.at, action: p.action, collectedBefore: proof });
}

// Carrier reports (R4.4): stored with their meaning; the driver turns them into statuses.
function onCarrier(ev, o, ctx) {
  const p = ev.payload || {};
  const f = o.fulfilments && o.fulfilments[p.fulfilmentRef];
  if (!f) return;
  const meaning = carrierMeaning(ctx, o, p.code);
  (f.reports = f.reports || []).push({ meaning, at: p.reportedAt, delivered: ev.at });
}

function carrierMeaning(ctx, o, code) {
  const t = parseJsonFile(ctx.files, `rulebook/${o.edition}/carrier-codes.json`);
  if (!t) return 'info';
  if (Array.isArray(t)) {
    const r = t.find((x) => x.code === code);
    return r ? (r.meaning || 'info') : 'info';
  }
  const v = t[code];
  return typeof v === 'string' ? v : ((v && (v.meaning || v.means)) || 'info');
}

// R1.1-R1.2: the allocation becomes the order record; the fraud check follows the create.
function onAllocate(pl, o, ctx) {
  if (o.allocated) return;
  const plan = resultOf(pl) || {};
  const prices = priceTable(parseJsonFile(ctx.files, 'master/catalog.json') || {});
  const fees = parseJsonFile(ctx.files, `rulebook/${o.edition}/shipping-fees.json`) || {};
  o.allocated = true;
  o.fulfilments = {};
  let total = 0;
  for (const f of plan.fulfilments || []) {
    const items = (f.items || []).map(cleanItem);
    const sub = items.reduce((s, it) => s + it.qty * (prices.get(it.sku) || 0), 0);
    const amountMinor = sub + (f.location == null ? 0 : feeOf(fees, f.location));
    const available = f.location != null && f.available !== false;
    o.fulfilments[f.fulfilmentId] = { location: f.location, items, amountMinor, available, status: available ? 'pending' : 'unavailable' };
    total += amountMinor;
  }
  o.totalMinor = total;
  o.createPending = true;
}

// ---------- driver ----------

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

function setStatus(out, o, fid, status) {
  const key = `st:${o.orderId}:${fid || '-'}:${status}`;
  if (o.setSt[key]) return;
  o.setSt[key] = 1;
  out.effects.push({ key, system: 'orders', op: 'setStatus', args: { orderId: o.orderId, fulfilmentId: fid || null, status } });
}

function notify(out, o, ctx, template, about, text) {
  const key = `ntf:${o.orderId}:${template}:${about}`;
  if (o.setSt[key]) return;
  o.setSt[key] = 1;
  out.effects.push({ key, system: 'notify', op: 'send', args: { to: emailOf(ctx, o.customerId), about, template, text } });
}

function emit(out, o, system, kind, eff) {
  o.keys[eff.key] = { kind, system, state: 'sent' };
  out.effects.push(eff);
}

function st(o, key) {
  const e = o.keys[key];
  return e ? e.state : null;
}

// Pending outcomes that are unknown are settled by status(key) (S2).
function settle(ctx, o) {
  for (const [key, e] of Object.entries(o.keys)) {
    if (e.state !== 'unknown') continue;
    const s = ctx.status(e.system, key);
    e.state = s === 'committed' ? 'ok' : (s === 'pending' ? 'sent' : 'failed');
  }
}

function drive(input, o, ctx, out) {
  settle(ctx, o);
  if (o.createPending) {
    o.createPending = false;
    const fl = Object.entries(o.fulfilments).map(([fulfilmentId, f]) => ({ fulfilmentId, location: f.location, items: f.items, amountMinor: f.amountMinor }));
    out.effects.push({ key: `create:${o.orderId}`, system: 'orders', op: 'create', args: {
      orderId: o.orderId, customerId: o.customerId, placedAt: o.placedAt, currency: o.currency,
      items: o.items.map(cleanItem), fulfilments: fl, totalMinor: o.totalMinor,
    } });
    out.effects.push({ system: 'fraud', op: 'check', args: { orderId: o.orderId } });
    return;
  }
  if (!o.ended) {
    driveFraud(input, o, ctx, out);
    if (!o.ended) driveCustomer(input, o, ctx, out);
    if (!o.ended) driveTimeout(input, o, ctx, out);
    if (!o.ended) driveProcessing(input, o, ctx, out);
    if (!o.ended) driveSaga(input, o, ctx, out);
    if (!o.ended) driveCarrier(input, o, ctx, out);
  }
  driveCompensation(input, o, ctx, out);
  driveOutcome(input, o, ctx, out);
  pruneKeys(o);
  driveClose(o, out);
}

const rk = (o, fid, sku) => `res:${o.orderId}:${fid}:${sku}`;
const ck = (o, fid) => `chg:${o.orderId}:${fid}`;
const sk = (o, fid) => `shp:${o.orderId}:${fid}`;
const shk = (o, fid) => `shc:${o.orderId}:${fid}`;
const rfk = (o, fid) => `ref:${o.orderId}:${fid}`;
const relK = (o, fid, sku) => `rel:${o.orderId}:${fid}:${sku}`;

function policyOf(ctx, o) {
  return parseJsonFile(ctx.files, `rulebook/${o.edition}/policy.json`) || {};
}

function emailOf(ctx, customerId) {
  const c = parseJsonFile(ctx.files, 'master/customers.json');
  const row = Array.isArray(c) ? c.find((x) => x.customerId === customerId) : (c && c[customerId]);
  return (row && row.email) || String(customerId);
}

function setFStatus(out, o, fid, status) {
  o.fulfilments[fid].status = status;
  setStatus(out, o, fid, status);
}

// R2.1-R2.2: fraud verdict; a review asks once, answers and re-asks only before the deadline.
function driveFraud(input, o, ctx, out) {
  if (o.cleared) return;
  const now = input.now;
  if (o.verdict === 'pass') return clear(o, o.placedAt, ctx, out);
  if (o.verdict === 'reject') return cancelOrder(o, 'fraud', now, ctx, out);
  if (o.verdict !== 'review') return;
  const pol = policyOf(ctx, o);
  if (!o.rev) return askReview(o, now, pol, out);
  for (const a of o.answers || []) {
    if (a.used || a.taskId !== o.rev.open) continue;
    a.used = true;
    if (minutesBetween(o.rev.deadline, a.at) > 0) continue; // after the deadline: changes nothing
    const d = a.answer && a.answer.decision;
    if (d === 'approve') return clear(o, a.at, ctx, out);
    if (d === 'reject') return cancelOrder(o, 'fraud', a.at, ctx, out);
    return askReview(o, now, pol, out); // unusable answer: ask again (same deadline)
  }
  if (o.rev.open && (o.lost || []).includes(o.rev.open) && minutesBetween(now, o.rev.deadline) >= 0) {
    return askReview(o, now, pol, out);
  }
  if (o.fired && o.fired[`fr-deadline:${o.orderId}`] !== undefined) {
    return cancelOrder(o, 'fraud-review-timeout', now, ctx, out);
  }
}

function askReview(o, now, pol, out) {
  if (!o.rev) o.rev = { n: 0, open: null, deadline: addMinutes(now, (pol.fraudReviewHours || 24) * 60) };
  o.rev.n += 1;
  o.rev.open = `fraudReview:${o.orderId}:${o.rev.n}`;
  out.humanTasks.push({
    id: o.rev.open, kind: 'fraudReview', role: 'fraudAnalyst', subject: o.orderId,
    question: `Review order ${o.orderId} of customer ${o.customerId}: approve or reject.`,
    answerSchema: { type: 'object', required: ['decision'], additionalProperties: false, properties: { decision: { enum: ['approve', 'reject'] } } },
    dueAt: addMinutes(o.rev.deadline, 1), onTimeout: { action: 'escalate' },
  });
  out.obligations.upsert.push({ id: `fr-deadline:${o.orderId}`, kind: 'timer', anchor: o.placedAt, dueAt: addMinutes(o.rev.deadline, 1), onDue: 'fr-deadline' });
}

// R2.1 / R2.2 cleared: unavailable items start the customer window (R3), otherwise the order is ready (R4.1).
function clear(o, at, ctx, out) {
  o.cleared = true;
  o.clearedAt = at;
  if (Object.values(o.fulfilments).some((f) => !f.available)) {
    o.waiting = true;
    const pol = policyOf(ctx, o);
    o.dl = addMinutes(o.placedAt, (pol.customerActionHours || 48) * 60);
    setStatus(out, o, null, 'customerActionRequired');
    notify(out, o, ctx, 'action-required', o.orderId, `Some items of order ${o.orderId} are unavailable: please amend or cancel.`);
    out.obligations.upsert.push({ id: `cust-deadline:${o.orderId}`, kind: 'timer', anchor: o.placedAt, dueAt: addMinutes(o.dl, 1), onDue: 'cust-deadline' });
  } else {
    o.readyAt = at;
  }
}

// R3.2 / R6.2 / R6.3 / R6.4 / S11: the first counted action in the waiting period, cancels while processing.
function driveCustomer(input, o, ctx, out) {
  const list = o.pendingCa || [];
  o.pendingCa = [];
  for (const a of list) {
    if (o.ended) break;
    if (!o.cleared) { // R6.4: the cancel counts for a recorded order that is not yet cleared
      if (a.action === 'cancel') cancelOrder(o, 'customer', a.at, ctx, out);
      continue;
    }
    if (o.waiting) {
      if (minutesBetween(o.dl, a.at) > 0) continue; // after D (S1)
      o.waiting = false;
      if (a.action === 'cancel') cancelOrder(o, 'customer', a.at, ctx, out);
      else if (a.action === 'amend') amendOrder(o, a.at, ctx, out);
      continue;
    }
    if (a.action === 'cancel' && o.readyAt) { // R6.2 (S11: the ready instant counts as processing)
      if (a.collectedBefore) cancelRefused(o, a.at, ctx, out);
      else stopProcessing(o, a.at, ctx, out);
    }
  }
}

// R3.2 amend: the unavailable fulfilments are cancelled and the rest is ready at the amend's time.
function amendOrder(o, at, ctx, out) {
  for (const [fid, f] of Object.entries(o.fulfilments)) {
    if (!f.available && !TERMINAL.has(f.status)) setFStatus(out, o, fid, 'cancelled');
  }
  if (!Object.values(o.fulfilments).some((f) => f.available)) return cancelOrder(o, 'nothing-available', at, ctx, out);
  o.readyAt = at;
}

// R6.1: cancel before any step committed.
function cancelOrder(o, reason, at, ctx, out) {
  o.ended = 'cancelled';
  o.endReason = reason;
  o.endAt = at;
  for (const [fid, f] of Object.entries(o.fulfilments)) {
    if (!TERMINAL.has(f.status)) setFStatus(out, o, fid, 'cancelled');
  }
  setStatus(out, o, null, 'cancelled');
  notify(out, o, ctx, 'order-cancelled', o.orderId, `Order ${o.orderId} has been cancelled (${reason}).`);
}

// R6.2: a counted cancel while processing; in-flight steps are compensated when they commit.
function stopProcessing(o, at, ctx, out) {
  o.ended = 'cancelled';
  o.endReason = 'customer';
  o.endAt = at;
  o.stopped = true;
  setStatus(out, o, null, 'cancelled');
  notify(out, o, ctx, 'order-cancelled', o.orderId, `Order ${o.orderId} has been cancelled at your request.`);
  for (const f of Object.values(o.fulfilments)) {
    if (!TERMINAL.has(f.status)) f.cancelling = true;
  }
}

// R6.3: a cancel that does not count because a shipment was collected.
function cancelRefused(o, at, ctx, out) {
  out.effects.push({ key: `cr:${o.orderId}:${at}`, system: 'notify', op: 'send', args: { to: emailOf(ctx, o.customerId), about: o.orderId, template: 'cancel-refused', text: `Order ${o.orderId} cannot be cancelled: a shipment was already collected.` } });
}

// R3.2 timeout: nothing counted by D.
function driveTimeout(input, o, ctx, out) {
  if (!o.waiting || !o.fired || o.fired[`cust-deadline:${o.orderId}`] === undefined) return;
  o.waiting = false;
  o.ended = 'timedOut';
  o.endAt = input.now;
  for (const [fid, f] of Object.entries(o.fulfilments)) {
    if (!TERMINAL.has(f.status)) setFStatus(out, o, fid, 'cancelled');
  }
  setStatus(out, o, null, 'timedOut');
  notify(out, o, ctx, 'order-timed-out', o.orderId, `Order ${o.orderId} timed out: no action was taken in time.`);
}

// R4.1: once ready, the order and its available fulfilments become processing.
function driveProcessing(input, o, ctx, out) {
  if (!o.readyAt || o.started) return;
  o.started = true;
  setStatus(out, o, null, 'processing');
  for (const [fid, f] of Object.entries(o.fulfilments)) {
    if (f.available && !TERMINAL.has(f.status)) setFStatus(out, o, fid, 'processing');
  }
}

function failFulfilment(o, fid, reason, at) {
  const f = o.fulfilments[fid];
  if (f.failing || f.cancelling) return;
  f.failing = reason;
  f.failAt = at;
}

// R4.2: reserve (per item), charge, ship; each step only after the previous one committed.
function driveSaga(input, o, ctx, out) {
  for (const [fid, f] of Object.entries(o.fulfilments)) {
    if (!f.available || f.failing || f.cancelling || TERMINAL.has(f.status)) continue;
    f.tries = f.tries || {};
    const rs = f.items.map((it) => st(o, rk(o, fid, it.sku)));
    if (rs.includes('failed')) { failFulfilment(o, fid, 'reserve', input.now); continue; }
    if (rs.includes('sent')) continue;
    const retry = f.items.filter((it, i) => rs[i] === null || rs[i] === 'retry');
    if (retry.length) {
      if (retry.some((it) => (f.tries[it.sku] || 0) >= 3)) { failFulfilment(o, fid, 'reserve', input.now); continue; }
      sendReserve(o, out, fid, f, retry);
      continue;
    }
    const cs = st(o, ck(o, fid));
    if (cs === 'failed') { failFulfilment(o, fid, 'charge', input.now); continue; }
    if (cs === 'sent') continue;
    if (cs !== 'ok') {
      emit(out, o, 'billing', 'chg', { key: ck(o, fid), system: 'billing', op: 'charge', args: { orderId: o.orderId, fulfilmentId: fid, customerId: o.customerId, amountMinor: f.amountMinor, currency: o.currency } });
      continue;
    }
    const ss = st(o, sk(o, fid));
    if (ss === 'failed') { failFulfilment(o, fid, 'ship', input.now); continue; }
    if (ss === 'sent' || ss === 'ok') continue;
    emit(out, o, 'carrier', 'shp', { key: sk(o, fid), system: 'carrier', op: 'create', args: { orderId: o.orderId, fulfilmentId: fid, location: f.location, ref: fid } });
  }
}

function sendReserve(o, out, fid, f, list) {
  const batch = [];
  const items = list.map((it) => {
    const k = rk(o, fid, it.sku);
    f.tries[it.sku] = (f.tries[it.sku] || 0) + 1;
    batch.push(k);
    o.keys[k] = { kind: 'res', system: 'inventory', state: 'sent' };
    return { key: k, sku: it.sku, qty: it.qty };
  });
  out.effects.push({ system: 'inventory', op: 'reserve', args: { orderId: o.orderId, fulfilmentId: fid, location: f.location, items } });
}

// R4.4 / R4.5-adjacent: carrier reports set dispatched/completed; a collection failure fails the fulfilment.
function driveCarrier(input, o, ctx, out) {
  for (const [fid, f] of Object.entries(o.fulfilments)) {
    if (!f.reports || TERMINAL.has(f.status)) continue;
    const news = f.reports.slice(f.procIdx || 0);
    f.procIdx = f.reports.length;
    for (const r of news) {
      if (f.failing || f.cancelling || TERMINAL.has(f.status)) break;
      if (r.meaning === 'collectionFailed') { failFulfilment(o, fid, 'collection-failed', r.delivered); break; }
      if (r.meaning === 'collected' && f.status === 'processing') setFStatus(out, o, fid, 'dispatched');
      if (r.meaning === 'delivered') {
        if (f.status !== 'dispatched') setFStatus(out, o, fid, 'dispatched');
        setFStatus(out, o, fid, 'completed');
      }
    }
  }
}

// R5.1 / R6.2: compensate a failing or cancelled fulfilment: shipment, then refund, then releases.
function driveCompensation(input, o, ctx, out) {
  for (const [fid, f] of Object.entries(o.fulfilments)) {
    if (!(f.failing || f.cancelling) || f.compDone) continue;
    const pending = [ck(o, fid), sk(o, fid), shk(o, fid), rfk(o, fid), ...f.items.map((it) => rk(o, fid, it.sku))];
    if (pending.some((k) => st(o, k) === 'sent')) continue; // an in-flight step decides what to undo (S2, S14)
    // 1. the shipment, unless the carrier already reported a collection failure
    if (st(o, sk(o, fid)) === 'ok' && !f.collectionFailed) {
      const s = st(o, shk(o, fid));
      if (s === null || s === 'retry') {
        emit(out, o, 'carrier', 'shc', { key: shk(o, fid), system: 'carrier', op: 'cancel', args: { orderId: o.orderId, fulfilmentId: fid } });
        continue;
      }
    }
    // 2. the refund of the charge, with the C2 approval above the pinned threshold
    if (st(o, ck(o, fid)) === 'ok' && !['ok', 'failed'].includes(st(o, rfk(o, fid)))) {
      const pin = constitutionInForce(ctx.files, o.placedAt);
      const T = pin && pin.parameters ? pin.parameters.refundApprovalThresholdMinor : undefined;
      if (T === undefined || f.amountMinor > T) {
        if (!approvedRefund(o, fid, f, input.now, pin, out)) continue;
      }
      emit(out, o, 'billing', 'ref', { key: rfk(o, fid), system: 'billing', op: 'refund', args: { orderId: o.orderId, fulfilmentId: fid, amountMinor: f.amountMinor } });
      continue;
    }
    // 3. release every reserved item
    let relPending = false;
    for (const it of f.items) {
      if (st(o, rk(o, fid, it.sku)) !== 'ok') continue;
      const s = st(o, relK(o, fid, it.sku));
      if (s === null || s === 'retry') {
        emit(out, o, 'inventory', 'rel', { key: relK(o, fid, it.sku), system: 'inventory', op: 'release', args: { orderId: o.orderId, fulfilmentId: fid, sku: it.sku } });
        relPending = true;
      } else if (s === 'sent') relPending = true;
    }
    if (relPending) continue;
    f.compDone = true;
    if (f.failing) {
      setFStatus(out, o, fid, 'failed');
      notify(out, o, ctx, 'fulfilment-failed', fid, `Fulfilment ${fid} of order ${o.orderId} failed (${f.failing}); it has been compensated.`);
    } else {
      setFStatus(out, o, fid, 'cancelled');
    }
  }
}

// C2: a refund above T waits for an approval by finance-approver (not an excluded principal). After three
// unusable answers, the controller may authorise it (C2-X1). Returns true once an approval is in hand.
function approvedRefund(o, fid, f, now, pin, out) {
  o.approv = o.approv || {};
  const a = o.approv[fid] || (o.approv[fid] = { n: 0, open: null, bad: 0 });
  if (a.open) {
    const ans = (o.answers || []).find((x) => x.taskId === a.open && !x.used);
    if (ans) {
      ans.used = true;
      if (ans.answer && ans.answer.decision === 'approve' && approverOk(pin, ans.user, o, a.bad >= 3)) {
        a.open = null;
        a.approved = true;
        return true;
      }
      a.bad += 1;
      a.open = null;
    } else if ((o.lost || []).includes(a.open)) {
      a.bad += 1;
      a.open = null;
    } else {
      return false; // still waiting for the analyst
    }
  }
  if (a.bad >= 3 && a.role !== 'controller') a.role = 'controller';
  a.n += 1;
  a.open = `refundApproval:${o.orderId}:${fid}:${a.n}`;
  out.humanTasks.push({
    id: a.open, kind: 'refundApproval', role: a.role || 'finance-approver', excludeUsers: o.enteredBy || [], subject: fid,
    question: `Approve refund of ${f.amountMinor} minor units (EUR) for fulfilment ${fid} of order ${o.orderId}.`,
    answerSchema: { type: 'object', required: ['decision'], additionalProperties: false, properties: { decision: { enum: ['approve', 'reject'] } } },
    dueAt: addMinutes(now, 24 * 60), onTimeout: { action: 'escalate' },
  });
  return false;
}

function approverOk(pin, user, o, breakGlass) {
  if (!user || (o.enteredBy || []).includes(user)) return false;
  const pr = ((pin && pin.version && pin.version.principals) || []).find((x) => x.id === user);
  if (!pr) return false;
  const roles = pr.roles || [];
  return roles.includes('finance-approver') || (breakGlass && roles.includes('controller'));
}

// R4.5: all fulfilments terminal, the order takes the outcome.
function driveOutcome(input, o, ctx, out) {
  if (o.ended || !o.started) return;
  const fs = Object.values(o.fulfilments);
  if (!fs.every((f) => TERMINAL.has(f.status))) return;
  const final = fs.some((f) => f.status === 'completed') ? 'completed' : (fs.some((f) => f.status === 'failed') ? 'failed' : 'cancelled');
  o.ended = final;
  setStatus(out, o, null, final);
}

// Settled fulfilments need no registry entries any more (the carry is capped at 64 KB).
function pruneKeys(o) {
  for (const [fid, f] of Object.entries(o.fulfilments || {})) {
    if (!TERMINAL.has(f.status) || f.cancelling || (f.failing && !f.compDone)) continue;
    const exact = [ck(o, fid), sk(o, fid), shk(o, fid), rfk(o, fid)];
    const prefixes = [`res:${o.orderId}:${fid}:`, `rel:${o.orderId}:${fid}:`];
    for (const k of Object.keys(o.keys)) {
      if (o.keys[k].state === 'sent') continue;
      if (exact.includes(k) || prefixes.some((p) => k.startsWith(p))) delete o.keys[k];
    }
  }
}

// Close once the order has ended, its compensations are settled, and nothing is in flight.
function driveClose(o, out) {
  if (!o.ended) return;
  const busy = Object.values(o.keys || {}).some((e) => e.state === 'sent' && !e.batch)
    || Object.values(o.fulfilments || {}).some((f) => (f.failing || f.cancelling) && !f.compDone);
  if (busy) return;
  if (!o.timersCancelled) {
    o.timersCancelled = true;
    out.obligations.cancel.push(`fr-deadline:${o.orderId}`, `cust-deadline:${o.orderId}`);
  }
  out.close = true;
}
