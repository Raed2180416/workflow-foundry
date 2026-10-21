// E8 order-fulfilment solver (SPEC-E v-current, CONSTITUTION C1-C3).
// Deterministic: no Date.now / Math.random; time comes from input.now and the event times.

const MIN = 60_000;
const HOUR = 60 * MIN;
const ALL_FULFIL_TERMINAL = ['completed', 'failed', 'cancelled'];

// ---------- small helpers ----------
const norm = (id) => (typeof id === 'string' ? id.trim().replace(/^#+/, '').trim().toUpperCase() : id);
const ms = (iso) => Date.parse(iso);
const at = (t) => new Date(t).toISOString();
const plus = (t, minutes) => t + minutes * MIN;

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// Read a json file from ctx.files by suffix-match on its path (tolerates a leading dir).
function fileJson(files, path) {
  if (files[path] !== undefined) return typeof files[path] === 'string' ? parseJson(files[path]) : files[path];
  const key = Object.keys(files).find((k) => k === path || k.endsWith('/' + path));
  if (!key) return null;
  const v = files[key];
  return typeof v === 'string' ? parseJson(v) : v;
}

// Accept either an object map or an array of rows keyed by `keyField` (tables and tables-as-json vary).
function asMap(table, keyField) {
  if (!table) return {};
  if (Array.isArray(table)) {
    const m = {};
    for (const row of table) m[row[keyField]] = row;
    return m;
  }
  if (table.rows) return asMap(table.rows, keyField);
  return table;
}

// CSV with a header row → array of objects (for rulebook tables shipped as csv).
function csvRows(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];
  const head = lines[0].split(',').map((s) => s.trim());
  return lines.slice(1).map((l) => {
    const cells = l.split(',').map((s) => s.trim());
    const o = {};
    head.forEach((h, i) => { o[h] = cells[i]; });
    return o;
  });
}

function rulebookTable(files, edition, name) {
  const json = fileJson(files, `rulebook/${edition}/${name}.json`);
  if (json) return json;
  const csvKey = Object.keys(files).find((k) => k.endsWith(`rulebook/${edition}/${name}.csv`));
  return csvKey ? csvRows(files[csvKey]) : null;
}

// Calendar date (YYYY-MM-DD) of an ISO time in Europe/Amsterdam.
function amsDate(t) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
  return parts;
}

// ---------- rulebook: editions ----------
function editionFor(files, placedMs) {
  const dates = Object.keys(files).filter((k) => /rulebook\/[^/]+\/edition\.json$/.test(k));
  let best = null;
  const day = amsDate(placedMs);
  for (const k of dates) {
    const e = parseJson(typeof files[k] === 'string' ? files[k] : JSON.stringify(files[k]));
    if (!e || !e.effectiveFrom) continue;
    const from = String(e.effectiveFrom).slice(0, 10);
    if (from <= day && (!best || from > best.from)) best = { id: e.id || k.split('/')[1], from };
  }
  return best ? best.id : null;
}

function editionPolicy(files, ed) {
  return fileJson(files, `rulebook/${ed}/policy.json`) || {};
}

// ---------- constitution registry ----------
// Versions in force: a proposed version is in force from its effectiveFrom only if proposed by a finance/controller
// holder and approved before effectiveFrom by a controller (under the version then in force, not the proposer), and
// its parameters stay within bounds. Each order is pinned to the version in force at placedAt.
function constitutionState(files) {
  const logEntry = fileJson(files, 'constitution/log.json') || [];
  const docs = Object.keys(files)
    .filter((k) => /constitution\/versions\/v\d+-[0-9a-f]+\.json$/.test(k))
    .map((k) => ({ path: k, doc: parseJson(typeof files[k] === 'string' ? files[k] : JSON.stringify(files[k])) }))
    .filter((d) => d.doc)
    .sort((a, b) => a.doc.version - b.doc.version);
  const byVersion = {};
  for (const d of docs) byVersion[d.doc.version] = d.doc;
  const hashOf = (ver) => {
    const p = logEntry.find((e) => e.type === 'proposed' && e.version === ver);
    return p ? p.hash : null;
  };
  const roleOf = (doc, principal) => {
    const pr = (doc.principals || []).find((p) => p.id === principal);
    return pr ? pr.roles || [] : [];
  };
  // version in force at time t (returns { version, hash } or null)
  const inForce = (t, depth = 0) => {
    let cur = null;
    for (const d of docs) {
      const v = d.doc;
      if (ms(v.effectiveFrom) > t || depth > 20) continue;
      const proposal = logEntry.find((e) => e.type === 'proposed' && e.version === v.version);
      const approvals = logEntry.filter((e) => e.type === 'approval' && e.version === v.version && e.hash === proposal?.hash);
      if (v.supersedes == null && cur === null) {
        // initial version: in force if it has an approval by a controller
        if (approvals.some((a) => approvedOk(v, a, null, ms(v.effectiveFrom)))) cur = v;
        continue;
      }
      const under = cur ? cur : null;
      if (!proposal || !(under || v.version === 1)) continue;
      if (!proposalOk(v, proposal, under)) continue;
      if (approvals.some((a) => approvedOk(v, a, under, ms(v.effectiveFrom)))) cur = v;
    }
    return cur ? { version: cur.version, hash: hashOf(cur.version), doc: cur } : null;
  };
  const proposalOk = (v, proposal, under) => {
    const roles = under ? under.roles : [];
    void roles;
    const proposerRoles = under ? (under.change?.proposerRoles || []) : ['finance', 'controller'];
    const pr = (under || v).principals || [];
    const p = pr.find((x) => x.id === proposal.by);
    const rs = p ? p.roles || [] : [];
    return rs.some((r) => proposerRoles.includes(r));
  };
  const approvedOk = (v, a, under, effFrom) => {
    if (effFrom !== undefined && ms(a.at) >= effFrom) return false;
    const base = under || v;
    const pr = (base.principals || []).find((x) => x.id === a.by);
    const rs = pr ? pr.roles || [] : [];
    const proposal = logEntry.find((e) => e.type === 'proposed' && e.version === v.version);
    if (proposal && proposal.by === a.by) return false;
    if (!rs.includes(base.change?.approverRole || 'controller')) return false;
    // bounds
    const bounds = v.bounds || [];
    for (const b of bounds) {
      const val = v.parameters?.[b.parameter];
      if (val !== undefined && (val < b.min || val > b.max)) return false;
    }
    return true;
  };
  return { inForce, byVersion, hashOf };
}

function pinFor(files, placedMs) {
  const cs = constitutionState(files);
  const r = cs.inForce(placedMs);
  return r ? { hash: r.hash, threshold: r.doc.parameters?.refundApprovalThresholdMinor ?? 0, doc: r.doc } : null;
}

// Index an object-or-array table by `field`; a scalar map {id: value} becomes {id: {field: id, value}}.
function indexRows(table, field) {
  if (!table) return {};
  let rows = Array.isArray(table) ? table : null;
  if (!rows) {
    const arr = Object.values(table).find((v) => Array.isArray(v));
    if (arr) rows = arr;
  }
  const m = {};
  if (rows) for (const r of rows) m[r[field]] = r;
  else for (const [k, v] of Object.entries(table)) m[k] = v && typeof v === 'object' ? { [field]: k, ...v } : { [field]: k, value: v };
  return m;
}
const priceOf = (row) => Number(row?.unitPriceMinor ?? row?.priceMinor ?? row?.value ?? 0);
const feeOf = (row) => Number(row?.feeMinor ?? row?.fee ?? row?.value ?? 0);
const meaningOf = (row) => row?.meaning ?? row?.value ?? 'info';

const SRC_ORDER = { actor: 0, carrier: 1, 'customer-portal': 2, shop: 3 };
const TERMINAL = ['completed', 'failed', 'cancelled'];
const COLLECTED = ['collected', 'inTransit', 'delivered'];
const TEXT = {
  'action-required': 'Some items in your order are unavailable. Please amend or cancel the order.',
  'order-cancelled': 'Your order has been cancelled.',
  'order-timed-out': 'Your order timed out and was cancelled.',
  'fulfilment-failed': 'Part of your order could not be fulfilled.',
  'cancel-refused': 'Your order has already been collected and can no longer be cancelled.',
  'unknown-order': 'We could not find that order.',
};

export function createSolver() {
  return { id: 'solver', tick(input, ctx) { return runTick(input, ctx); } };
}

// ---------- instance state (kept in carry) ----------
function newState() {
  return {
    o: null, cust: null, cur: null, p: null, placedAt: null, ed: null, pin: null, thr: 0, fraudH: 24, custH: 48, D: null,
    iss: {}, st: {}, F: {}, allocOk: false, hasUnavail: false, verdict: null, verdictDone: false, created: false,
    cleared: null, ready: null, processing: false, actionNotice: false, act: null, stopped: null, stopEmitted: false,
    timedOut: false, toEmitted: false, ended: false, refusedAt: null, refusedSent: false, rv: null, fraud: null,
    entered: [], obs: [],
  };
}

const K = (S, ...parts) => [S.o, ...parts].join('/');

function runTick(input, ctx) {
  const now = ms(input.now);
  const files = ctx.files || {};
  const events = [...(input.events || [])].sort((a, b) =>
    (SRC_ORDER[a.source] ?? 4) - (SRC_ORDER[b.source] ?? 4) || String(a.id).localeCompare(String(b.id)));
  const fresh = !(input.carry && input.carry.o);
  const S = fresh ? newState() : input.carry;
  const out = { decisions: { subject: null }, effects: [], obligations: { upsert: [], cancel: [] }, humanTasks: [], carry: null };
  const X = { now, files, ctx, S, out, self: input.instance };

  if (fresh) {
    const placed = events.find((e) => e.type === 'order.placed');
    const route = routeFresh(X, events, placed);
    if (route) return { ...out, ...route, carry: { routed: true } };
    startOrder(X, placed);
  }
  for (const ev of events) ingest(X, ev);
  drive(X);
  return finish(X);
}

// A message that starts a new instance: merge it into the case it belongs to, or close it.
function routeFresh(X, events, placed) {
  const { ctx, S } = X;
  let o = null;
  if (placed) {
    o = norm(placed.payload.orderId);
    if (rowsOf(ctx.query('orders.orders', { where: { orderId: o }, limit: 1 })).length === 0) return null;
  } else {
    const ev = events[0];
    if (!ev) return { close: true };
    if (ev.type === 'customer.action') o = norm(ev.payload.orderRef);
    else if (ev.type === 'carrier.status') {
      const rows = rowsOf(ctx.query('orders.fulfilments', { where: { fulfilmentId: ev.payload.fulfilmentRef }, limit: 1 }));
      o = rows[0]?.orderId ?? null;
    }
  }
  const target = o ? findInstance(X, o) : null;
  void S;
  return target ? { merge: { into: target } } : { close: true };
}

function findInstance(X, o) {
  const ids = (X.ctx.instances({ subject: o }) || []).map((x) => (typeof x === 'string' ? x : x.instance ?? x.id));
  return ids.find((id) => id && id !== X.self) || null;
}

// Rows of a query result (an array, or an object holding the rows).
const rowsOf = (r) => (Array.isArray(r) ? r : r?.rows ?? []);

// Whether an event mentions a given id anywhere (task ids, obligation ids: the payload layout is not fixed).
function mentions(ev, id) {
  return JSON.stringify(ev).includes(JSON.stringify(id));
}

function startOrder(X, placed) {
  const { S, files } = X;
  const p = placed.payload;
  S.o = norm(p.orderId);
  S.cust = p.customerId;
  S.cur = p.currency;
  S.items = p.items;
  S.p = ms(placed.at);
  S.placedAt = placed.at;
  S.ed = editionFor(files, S.p);
  const pol = S.ed ? fileJson(files, `rulebook/${S.ed}/policy.json`) || {} : {};
  S.fraudH = pol.fraudReviewHours ?? 24;
  S.custH = pol.customerActionHours ?? 48;
  S.D = S.p + S.custH * HOUR;
  const pin = pinFor(files, S.p);
  S.pin = pin ? { hash: pin.hash, threshold: pin.threshold } : { hash: null, threshold: 0 };
  S.thr = S.pin.threshold;
  X.out.effects.push({ system: 'inventory', op: 'allocate', args: { orderId: S.o } });
  X.out.effects.push({ system: 'fraud', op: 'check', args: { orderId: S.o } });
}

function ingest(X, ev) {
  switch (ev.type) {
    case 'effect.result': return applyResult(X, ev);
    case 'customer.action': return onAction(X, ev);
    case 'carrier.status': return onCarrier(X, ev);
    case 'humanTask.answered': case 'humanTask.answerRejected': case 'humanTask.withdrawn':
    case 'humanTask.timeout': case 'humanTask.delegated': return onTask(X, ev);
    case 'timer.fired': return onTimer(X, ev);
    default: return undefined; // order.placed (own or duplicate), migration: nothing more to do here
  }
}

function applyResult(X, raw) {
  const { S } = X;
  // The result fields (key, status, items, error) arrive under `payload`.
  const ev = { ...raw, ...(raw.payload || {}) };
  // A field-renamed refusal names the new field: remember it for every later call of this op (carry).
  if (ev.error && ev.error.reason === 'field-renamed' && ev.error.field && ev.error.renamedTo) {
    const id = `${ev.system}.${ev.op}`;
    S.ren = S.ren || {};
    S.ren[id] = { ...(S.ren[id] || {}), [ev.error.field]: ev.error.renamedTo };
  }
  // Read-only results (allocate, fraud check) are recognised by their content: the plan, then the verdict.
  if (!S.allocOk) {
    const fl = findFulfilments(ev);
    if (Array.isArray(fl) && fl.length) { buildPlan(X, fl); S.allocOk = true; return; }
  }
  if (!S.verdict) {
    const v = findVerdict(ev);
    if (v) { S.verdict = v; return; }
  }
  const keys = [];
  if (ev.key) keys.push([ev.key, ev.status, ev.error]);
  for (const it of ev.items || []) if (it && it.key) keys.push([it.key, it.status ?? ev.status, it.error ?? ev.error]);
  for (const [k, status, error] of keys) {
    const st = S.st[k];
    if (!st) continue;
    if (status === 'ok') st.state = 'ok';
    else if (status === 'unknown') st.state = 'unknown';
    else if (status === 'rate-limited' || status === 'partial') continue;
    else {
      const code = typeof error === 'string' ? error : error?.code ?? null;
      const retryable = error && typeof error === 'object' ? error.retryable : undefined;
      st.state = 'err';
      st.code = code;
      st.perm = retryable === false && !['invalid-args', 'field-renamed'].includes(code);
    }
  }
}

// The payload of a read-only result, wherever the platform put it.
function bodyOf(ev) {
  for (const v of [ev.items, ev.value, ev.result, ev.output, ev.body]) if (v !== undefined && v !== null) return v;
  return ev;
}

// Walks an allocation result (strings parsed as JSON) for the fulfilment list: an array of { fulfilmentId, ... }.
function findFulfilments(v, depth = 0) {
  if (typeof v === 'string' && depth < 6 && /^\s*[\[{]/.test(v)) v = parseJson(v);
  if (!v || typeof v !== 'object' || depth > 6) return null;
  if (Array.isArray(v)) {
    if (v.length && v.every((x) => x && typeof x === 'object' && 'fulfilmentId' in x)) return v;
    for (const x of v) { const r = findFulfilments(x, depth + 1); if (r) return r; }
    return null;
  }
  if (Array.isArray(v.fulfilments) && v.fulfilments.length) return v.fulfilments;
  for (const x of Object.values(v)) { const r = findFulfilments(x, depth + 1); if (r) return r; }
  return null;
}

// Walks a fraud result for the verdict: the value of `verdict`, or a bare verdict string.
function findVerdict(v, depth = 0) {
  if (typeof v === 'string') {
    const t = v.trim();
    if (['pass', 'review', 'reject'].includes(t)) return t;
    if (depth < 6 && /^\s*[\[{]/.test(v)) return findVerdict(parseJson(v), depth + 1);
    return null;
  }
  if (!v || typeof v !== 'object' || depth > 6) return null;
  if (typeof v.verdict === 'string') return findVerdict(v.verdict, depth + 1);
  for (const x of Object.values(v)) { const r = findVerdict(x, depth + 1); if (r) return r; }
  return null;
}

// First value stored under `key` anywhere in a result (JSON strings are parsed on the way down).
function deepFind(v, key, depth = 0) {
  if (typeof v === 'string' && depth < 4 && /^[\[{]/.test(v.trim())) v = parseJson(v);
  if (!v || typeof v !== 'object' || depth > 4) return undefined;
  if (!Array.isArray(v) && key in v) return v[key];
  for (const x of Object.values(v)) {
    const r = deepFind(x, key, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

function buildPlan(X, fl) {
  const { S, files } = X;
  const catalog = indexRows(fileJson(files, 'master/catalog.json'), 'sku');
  const fees = indexRows(rulebookTable(files, S.ed, 'shipping-fees'), 'location');
  for (const f of fl) {
    const loc = f.available === false || f.location == null ? null : f.location;
    const agg = {};
    for (const it of f.items || []) agg[it.sku] = (agg[it.sku] || 0) + it.qty;
    const items = Object.entries(agg).map(([sku, qty]) => ({ sku, qty }));
    let amt = 0;
    for (const it of items) amt += it.qty * priceOf(catalog[it.sku]);
    if (loc) amt += feeOf(fees[loc]);
    S.F[f.fulfilmentId] = {
      id: f.fulfilmentId, loc, avail: loc !== null, lines: f.items, items, amt,
      st: loc !== null ? 'pending' : 'unavailable', mode: null, term: null, rel: {},
      shipCancelled: false, collFail: false, collAt: null, collected: false,
      dispatchWant: false, completeWant: false, refundDone: false, apprN: 0, apprOpen: null, appr: false, failT: null,
    };
  }
  S.hasUnavail = Object.values(S.F).some((f) => !f.avail);
}

function clearAt(X, t) {
  const { S } = X;
  if (S.cleared != null) return;
  S.cleared = t;
  if (!S.hasUnavail) S.ready = t;
}

function stop(X, t, reason) {
  const { S } = X;
  if (S.stopped || S.timedOut) return;
  S.stopped = { t, reason };
  for (const f of Object.values(S.F)) if (!f.term && !f.mode) f.mode = 'cancel';
}

function timeOut(X) {
  const { S } = X;
  if (S.stopped || S.timedOut) return;
  S.timedOut = true;
  for (const f of Object.values(S.F)) if (!f.term && !f.mode) f.mode = 'cancel';
}

function collectedBy(S, t) {
  return Object.values(S.F).some((f) => f.collAt != null && f.collAt <= t);
}

function waiting(S) {
  return S.cleared != null && S.hasUnavail && S.ready == null && !S.stopped && !S.timedOut;
}

function onAction(X, ev) {
  const { S } = X;
  const a = ev.payload || {};
  const t = ms(ev.at);
  if (a.enteredBy && !String(a.enteredBy).startsWith('cust:') && !S.entered.includes(a.enteredBy)) S.entered.push(a.enteredBy);
  if (S.stopped || S.timedOut || S.ended) return;
  if (S.cleared == null) { if (a.action === 'cancel') stop(X, t, 'customer'); return; }
  if (waiting(S)) {
    if (t > S.D) return;
    if (a.action === 'amend') {
      S.act = { kind: 'amend', t };
      for (const f of Object.values(S.F)) if (!f.avail && !f.term && !f.mode) f.mode = 'cancel';
      if (Object.values(S.F).some((f) => f.avail)) S.ready = t;
      else stop(X, t, 'nothing-available');
    } else if (a.action === 'cancel') {
      S.act = { kind: 'cancel', t };
      stop(X, t, 'customer');
    }
    return;
  }
  if (S.ready != null && a.action === 'cancel') {
    if (collectedBy(S, t)) S.refusedAt = t;
    else stop(X, t, 'customer');
  }
}

function onCarrier(X, ev) {
  const { S } = X;
  const p = ev.payload || {};
  const f = S.F[p.fulfilmentRef];
  if (!f || f.shipCancelled) return;
  const meaning = meaningOf(indexRows(rulebookTable(X.files, S.ed, 'carrier-codes'), 'code')[p.code]);
  const rep = ms(p.reportedAt);
  if (COLLECTED.includes(meaning) && (f.collAt == null || rep < f.collAt)) f.collAt = rep;
  if (f.term || f.mode) return;
  if (meaning === 'collected') { f.collected = true; f.dispatchWant = true; }
  else if (meaning === 'delivered') f.completeWant = true;
  else if (meaning === 'collectionFailed' && f.st !== 'completed') { f.collFail = true; f.mode = 'fail'; f.failT = rep; }
}

function onTask(X, ev) {
  const { S } = X;
  const p = ev.payload || {};
  const dec = deepFind(p, 'decision');
  const usable = ev.type === 'humanTask.answered' && (dec === 'approve' || dec === 'reject');
  const t = ms(ev.at);
  if (S.rv && S.rv.open && mentions(ev, S.rv.open)) {
    S.rv.open = null;
    if (S.cleared != null || S.stopped) return;
    if (usable && t <= S.rv.deadline) {
      if (dec === 'approve') clearAt(X, t);
      else stop(X, t, 'fraud');
      return;
    }
    if (X.now < S.rv.deadline && ev.type !== 'humanTask.timeout') askReview(X);
    return;
  }
  for (const f of Object.values(S.F)) {
    if (!f.apprOpen || !mentions(ev, f.apprOpen)) continue;
    f.apprOpen = null;
    const user = deepFind(p, 'user');
    const roles = rolesOf(X, user);
    const need = f.apprN > 3 ? 'controller' : 'finance-approver';
    const staff = user && !S.entered.includes(user);
    if (usable && dec === 'approve' && staff && roles.includes(need)) f.appr = true;
    return;
  }
}

function rolesOf(X, user) {
  const pin = X.S.pin;
  const doc = pinDoc(X);
  const pr = doc && (doc.principals || []).find((x) => x.id === user);
  void pin;
  return pr ? pr.roles || [] : [];
}

function pinDoc(X) {
  const r = pinFor(X.files, X.S.p);
  return r ? r.doc : null;
}

function askReview(X) {
  const { S } = X;
  S.rv.n = (S.rv.n || 1) + 1;
  S.rv.open = K(S, 'rv', S.rv.n);
  X.out.humanTasks.push({
    id: S.rv.open, kind: 'fraudReview', role: 'fraudAnalyst', subject: S.o,
    question: `Fraud review of order ${S.o}: approve or reject.`,
    answerSchema: { type: 'object', required: ['decision'], additionalProperties: false, properties: { decision: { enum: ['approve', 'reject'] } } },
    dueAt: at(S.rv.deadline), onTimeout: { action: 'timeout' },
  });
}

function onTimer(X, ev) {
  const { S } = X;
  const id = [`${S.o}/rv`, `${S.o}/cd`].find((x) => mentions(ev, x));
  S.obs = S.obs.filter((x) => x !== id);
  if (id === `${S.o}/rv`) { if (S.cleared == null && !S.stopped) { S.rv.open = null; stop(X, X.now, 'fraud-review-timeout'); } }
  else if (id === `${S.o}/cd`) { if (waiting(S)) timeOut(X); }
}

function setStatus(X, fid, status) {
  const { S } = X;
  const key = K(S, 'st', fid || 'order', status);
  if (S.iss[key]) return;
  S.iss[key] = 1;
  X.out.effects.push({ key, system: 'orders', op: 'setStatus', args: { orderId: S.o, fulfilmentId: fid || null, status } });
  if (fid) S.F[fid].st = status;
}

function notify(X, template, about) {
  const { S } = X;
  const key = K(S, 'n', template, about || '-');
  if (S.iss[key]) return;
  S.iss[key] = 1;
  X.out.effects.push({ key, system: 'notify', op: 'send', args: { to: custEmail(X.files, S.cust), about, template, text: TEXT[template] || template } });
}

function custEmail(files, cust) {
  const row = indexRows(fileJson(files, 'master/customers.json'), 'customerId')[cust];
  return row?.email ?? `cust:${cust}`;
}

// Unknown outcomes, and steps still in flight after two minutes (a result that did not reach us), are settled
// from the platform's own record (S2) before any decision.
function settleUnknown(X) {
  for (const [k, st] of Object.entries(X.S.st)) {
    const stale = st.state === 'issued' && st.at != null && X.now >= st.at + 2 * MIN;
    if (st.state !== 'unknown' && !stale) continue;
    const r = X.ctx.status(st.sys, k);
    if (r === 'committed') st.state = 'ok';
    else if (r === 'not-found') { st.state = 'err'; st.code = 'not-found'; st.perm = false; }
  }
}

function emitCreate(X) {
  const { S } = X;
  const fulfilments = Object.values(S.F).map((f) => ({ fulfilmentId: f.id, location: f.loc, items: f.items, amountMinor: f.amt }));
  const body = {
    orderId: S.o, customerId: S.cust, placedAt: S.placedAt, currency: S.cur,
    items: (S.items || []).map((i) => ({ sku: i.sku, qty: i.qty })),
    fulfilments, totalMinor: fulfilments.reduce((a, f) => a + f.amountMinor, 0),
  };
  X.out.effects.push({ key: K(S, 'create'), system: 'orders', op: 'create', args: body });
}

function applyVerdict(X) {
  const { S } = X;
  if (S.stopped) return;
  if (S.verdict === 'reject') stop(X, X.now, 'fraud');
  else if (S.verdict === 'pass') clearAt(X, S.p);
  else {
    S.fraud = 'review';
    S.rv = { deadline: X.now + S.fraudH * HOUR, n: 0, open: null };
    askReview(X);
  }
}

function drive(X) {
  const { S, out } = X;
  if (!S.o) return;
  settleUnknown(X);
  if (!S.created && S.allocOk && S.verdict) {
    emitCreate(X);
    S.created = true;
    applyVerdict(X);
  }
  if (!S.created) return; // nothing is done before the order is recorded (R1.1)

  if (S.cleared != null && S.hasUnavail && S.ready == null && !S.stopped && !S.act && !S.actionNotice) {
    setStatus(X, null, 'customerActionRequired');
    notify(X, 'action-required', S.o);
    S.actionNotice = true;
  }
  if (S.ready != null && !S.stopped && !S.timedOut && !S.processing) {
    S.processing = true;
    setStatus(X, null, 'processing');
    for (const f of Object.values(S.F)) if (f.avail && !f.term && !f.mode) setStatus(X, f.id, 'processing');
  }
  if (S.stopped && !S.stopEmitted) {
    S.stopEmitted = true;
    setStatus(X, null, 'cancelled');
    notify(X, 'order-cancelled', S.o);
  }
  if (S.timedOut && !S.toEmitted) {
    S.toEmitted = true;
    setStatus(X, null, 'timedOut');
    notify(X, 'order-timed-out', S.o);
  }
  if (S.refusedAt != null && !S.refusedSent) {
    S.refusedSent = true;
    notify(X, 'cancel-refused', S.o);
  }

  for (const f of Object.values(S.F)) {
    if (f.term) continue;
    if (!f.mode && S.processing && !S.stopped && !S.timedOut && f.avail) saga(X, f);
    if (!f.mode && f.completeWant) {
      if (f.st !== 'dispatched') setStatus(X, f.id, 'dispatched');
      setStatus(X, f.id, 'completed');
      f.term = 'completed';
    } else if (!f.mode && f.dispatchWant && f.st === 'processing') {
      setStatus(X, f.id, 'dispatched');
    }
    if (f.mode) compensate(X, f);
  }

  const all = Object.values(S.F).every((f) => f.term);
  if (all && !S.ended) {
    if (!S.stopped && !S.timedOut && S.processing) {
      const ts = Object.values(S.F).map((f) => f.term);
      setStatus(X, null, ts.includes('completed') ? 'completed' : ts.includes('failed') ? 'failed' : 'cancelled');
      S.ended = true;
    } else if ((S.stopped && S.stopEmitted) || (S.timedOut && S.toEmitted)) {
      S.ended = true;
    }
  }
  obligations(X);
  void out;
}

function fail(X, f) {
  f.mode = 'fail';
  f.failT = X.now;
}

// One fulfilment's forward saga (R4.2): reserve every item, charge, ship; each step after the previous one committed.
function saga(X, f) {
  const { S, out } = X;
  let allOk = true;
  const send = [];
  for (const it of f.items) {
    const k = K(S, f.id, 'res', it.sku);
    const st = S.st[k];
    if (st && st.state === 'ok') continue;
    allOk = false;
    if (!st) send.push(it);
    else if (st.state === 'err') {
      if (st.perm || st.n >= 3) return fail(X, f);
      send.push(it);
    }
  }
  if (send.length) {
    const items = send.map((it) => ({ key: K(S, f.id, 'res', it.sku), sku: it.sku, qty: it.qty }));
    for (const it of items) S.st[it.key] = { sys: 'inventory', state: 'issued', n: (S.st[it.key]?.n || 0) + 1, at: X.now };
    out.effects.push({ system: 'inventory', op: 'reserve', args: { orderId: S.o, fulfilmentId: f.id, location: f.loc, items } });
    return;
  }
  if (!allOk) return;

  const ck = K(S, f.id, 'chg');
  const c = S.st[ck];
  if (!c || (c.state === 'err' && !c.perm && c.code !== 'card-declined' && c.n < 3)) {
    S.st[ck] = { sys: 'billing', state: 'issued', n: (c?.n || 0) + 1, at: X.now };
    out.effects.push({ key: ck, system: 'billing', op: 'charge', args: { orderId: S.o, fulfilmentId: f.id, customerId: S.cust, amountMinor: f.amt, currency: S.cur } });
    return;
  }
  if (c.state === 'err') return fail(X, f); // declined or permanent (R5.2)
  if (c.state !== 'ok') return;

  const sk = K(S, f.id, 'ship');
  const sh = S.st[sk];
  if (!sh || (sh.state === 'err' && !sh.perm && sh.n < 3)) {
    S.st[sk] = { sys: 'carrier', state: 'issued', n: (sh?.n || 0) + 1, at: X.now };
    out.effects.push({ key: sk, system: 'carrier', op: 'create', args: { orderId: S.o, fulfilmentId: f.id, location: f.loc, ref: f.id } });
    return;
  }
  if (sh.state === 'err') return fail(X, f);
}

// Compensation (R5.1 / R6.2): undo committed steps in reverse order, once each; wait for in-flight steps.
function compensate(X, f) {
  const { S, out } = X;
  const fwd = [K(S, f.id, 'chg'), K(S, f.id, 'ship'), ...f.items.map((it) => K(S, f.id, 'res', it.sku))];
  if (fwd.some((k) => S.st[k] && (S.st[k].state === 'issued' || S.st[k].state === 'unknown'))) return;
  const chOk = S.st[K(S, f.id, 'chg')]?.state === 'ok';
  const shOk = S.st[K(S, f.id, 'ship')]?.state === 'ok';
  if (shOk && !f.collFail && !f.shipCancelled) {
    f.shipCancelled = true;
    out.effects.push({ key: K(S, f.id, 'shipcancel'), system: 'carrier', op: 'cancel', args: { orderId: S.o, fulfilmentId: f.id } });
  }
  if (chOk && !f.refundDone) {
    if (f.amt > S.thr && !f.appr) { ensureApproval(X, f); return; }
    f.refundDone = true;
    out.effects.push({ key: K(S, f.id, 'refund'), system: 'billing', op: 'refund', args: { orderId: S.o, fulfilmentId: f.id, amountMinor: f.amt } });
  }
  for (const it of f.items) {
    if (S.st[K(S, f.id, 'res', it.sku)]?.state !== 'ok' || f.rel[it.sku]) continue;
    f.rel[it.sku] = 1;
    out.effects.push({ key: K(S, f.id, 'rel', it.sku), system: 'inventory', op: 'release', args: { orderId: S.o, fulfilmentId: f.id, sku: it.sku } });
  }
  if (f.term) return;
  const status = f.mode === 'fail' ? 'failed' : 'cancelled';
  setStatus(X, f.id, status);
  f.term = status;
  if (status === 'failed') notify(X, 'fulfilment-failed', f.id);
}

// C2: a refund above T waits for a finance-approver's approval task (controller break-glass after three misses).
function ensureApproval(X, f) {
  const { S } = X;
  if (f.apprOpen) return;
  f.apprN += 1;
  f.apprOpen = K(S, f.id, 'appr', f.apprN);
  const role = f.apprN > 3 ? 'controller' : 'finance-approver';
  X.out.humanTasks.push({
    id: f.apprOpen, kind: 'refundApproval', role, excludeUsers: S.entered.slice(), subject: f.id,
    question: `Approve refund of ${f.amt} minor units (${S.cur}) on order ${S.o}, fulfilment ${f.id}.` +
      (role === 'controller' ? ' Break-glass: three requests got no valid finance approval.' : ''),
    answerSchema: { type: 'object', required: ['decision'], additionalProperties: false, properties: { decision: { enum: ['approve', 'reject'] } } },
    dueAt: at(X.now + 48 * HOUR), onTimeout: { action: 'escalate' },
  });
}

function obligations(X) {
  const { S, out } = X;
  const want = {};
  if (S.rv && S.cleared == null && !S.stopped) want[`${S.o}/rv`] = S.rv.deadline + MIN;
  if (waiting(S)) want[`${S.o}/cd`] = S.D + MIN;
  for (const [id, dueMs] of Object.entries(want)) {
    out.obligations.upsert.push({ id, kind: 'deadline', anchor: S.o, dueAt: at(dueMs), onDue: id.endsWith('/rv') ? 'review-timeout' : 'customer-timeout' });
  }
  for (const id of S.obs) if (!want[id]) out.obligations.cancel.push(id);
  S.obs = Object.keys(want);
}

// Argument names follow api/<system>.schema.json as it is at run time (a renamed field keeps its old name in the
// schema's rename hints, or is found by a looser match of the name).
const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
function renameTo(k, props, hints = {}) {
  if (k in props) return k;
  if (hints[k] && props[hints[k]]) return hints[k];
  const hit = Object.keys(props).find((p) => props[p]?.renamedFrom === k || (props[p]?.aliases || []).includes(k) || squash(p) === squash(k));
  return hit ?? k;
}
function apiArgs(files, sys, op, args, ren = {}) {
  const def = fileJson(files, `api/${sys}.schema.json`)?.ops?.[op]?.args;
  if (!def?.properties && !Object.keys(ren).length) return args;
  const props = def?.properties || {};
  const hints = def?.renamed || def?.renames || {};
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    const t = ren[k] ?? renameTo(k, props, hints);
    const item = props[t]?.items?.properties;
    out[t] = t === 'items' && Array.isArray(v) && item
      ? v.map((it) => Object.fromEntries(Object.entries(it).map(([ik, iv]) => [renameTo(ik, item), iv])))
      : v;
  }
  return out;
}

function finish(X) {
  const { S, out } = X;
  out.effects = out.effects.map((e) => (e.args ? { ...e, args: apiArgs(X.files, e.system, e.op, e.args, (S.ren || {})[`${e.system}.${e.op}`]) } : e));
  if (S.o) {
    out.decisions.subject = S.o;
    out.decisions.constitution = { pins: { [S.o]: S.pin?.hash || '' } };
  }
  const inFlight = Object.values(S.st).some((st) => st.state === 'issued' || st.state === 'unknown');
  if (S.ended && !inFlight) out.close = true;
  out.carry = S;
  return out;
}
