// solver.mjs: E8 order fulfilment with compensation (SPEC-E.md).
//
// Each tick rebuilds what is due from the carry, the events that arrived and the
// outcome of earlier effects. Effect keys come from ids, so an effect is emitted
// once; it is re-issued only after a 400 (invalid request) or an unknown outcome
// that the platform did not commit. Times are epoch milliseconds in the carry and
// ISO 8601 with the Europe/Amsterdam offset in the output.

const MIN = 60_000;
const FINAL = new Set(['completed', 'failed', 'cancelled']);
const FUL_ORDER = ['pending', 'unavailable', 'processing', 'dispatched', 'completed', 'failed', 'cancelled'];

// ---------- time ----------
const fmtAms = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Amsterdam', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const pad = n => String(n).padStart(2, '0');
const T = v => (typeof v === 'number' ? v : Date.parse(v));

function isoAms(t) {
  const base = Math.floor(t / 1000) * 1000;
  const g = {};
  for (const p of fmtAms.formatToParts(new Date(base))) g[p.type] = p.value;
  const local = Date.UTC(+g.year, +g.month - 1, +g.day, +g.hour, +g.minute, +g.second);
  const off = Math.round((local - base) / MIN);
  const a = Math.abs(off);
  return `${g.year}-${g.month}-${g.day}T${g.hour}:${g.minute}:${g.second}${off < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
const dayOf = t => isoAms(t).slice(0, 10);

// Order ids as the spec normalises them: trim, drop leading '#', upper-case.
const normId = s => String(s ?? '').trim().replace(/^#+/, '').trim().toUpperCase();

// ---------- files: ctx.files holds the rulebook, master data and api files (JSON or CSV) ----------
function listFiles(ctx) {
  const f = ctx.files;
  try {
    if (f instanceof Map) return [...f.keys()];
    if (Array.isArray(f)) return f.map(x => (typeof x === 'string' ? x : x.path));
    if (typeof f?.list === 'function') return f.list('') || [];
    if (f && typeof f === 'object') return Object.keys(f);
  } catch { /* no listing: no editions visible */ }
  return [];
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length === 0) return [];
  const head = lines[0].split(',').map(s => s.trim());
  return lines.slice(1).map(l => {
    const cells = l.split(',').map(s => s.trim());
    return Object.fromEntries(head.map((h, i) => [h, cells[i]]));
  });
}

function load(ctx, path) {
  const f = ctx.files;
  let v;
  try {
    if (typeof f === 'function') v = f(path);
    else if (typeof f?.read === 'function') v = f.read(path);
    else if (typeof f?.get === 'function') v = f.get(path);
    else if (f instanceof Map) v = f.get(path);
    else if (f && typeof f === 'object') v = f[path];
  } catch { return undefined; }
  if (v && typeof v === 'object' && typeof v.content === 'string') v = v.content;
  if (typeof v !== 'string') return v;
  if (path.endsWith('.csv')) return parseCsv(v);
  try { return JSON.parse(v); } catch { return undefined; }
}

// Rows of a table: an array, the first array inside an object, or an object keyed by id.
function rows(x) {
  if (Array.isArray(x)) return x;
  if (!x || typeof x !== 'object') return [];
  const arr = Object.values(x).find(Array.isArray);
  if (arr) return arr;
  return Object.entries(x).map(([k, v]) => (v && typeof v === 'object' ? { _key: k, ...v } : { _key: k, _value: v }));
}
const firstOf = (r, names) => {
  for (const n of names) if (r && r[n] != null) return r[n];
  return undefined;
};

function pickEdition(ctx, t) {
  const day = dayOf(t);
  let best = null;
  for (const p of listFiles(ctx)) {
    const m = /^rulebook\/([^/]+)\/edition\.json$/.exec(p);
    if (!m) continue;
    const e = load(ctx, p) || {};
    const from = String(e.effectiveFrom ?? '').slice(0, 10);
    if (from && from <= day && (!best || from > best.from)) best = { dir: m[1], from, id: e.id ?? m[1] };
  }
  return best;
}

function priceMap(ctx) {
  const m = {};
  for (const r of rows(load(ctx, 'master/catalog.json'))) {
    m[String(firstOf(r, ['sku', '_key']))] = Number(firstOf(r, ['unitPriceMinor', 'priceMinor', '_value'])) || 0;
  }
  return m;
}

function feeMap(ctx, dir) {
  const m = {};
  for (const r of rows(load(ctx, `rulebook/${dir}/shipping-fees.json`))) {
    m[String(firstOf(r, ['location', '_key']))] = Number(firstOf(r, ['feeMinor', 'fee', '_value'])) || 0;
  }
  return m;
}

function codeMap(ctx, dir) {
  const m = {};
  for (const r of rows(load(ctx, `rulebook/${dir}/carrier-codes.json`))) {
    const meaning = firstOf(r, ['meaning', 'kind', 'status', '_value']);
    m[String(firstOf(r, ['code', '_key']))] = typeof meaning === 'string' ? meaning : 'info';
  }
  return m;
}

function emailOf(ctx, cust) {
  const r = rows(load(ctx, 'master/customers.json')).find(x => String(firstOf(x, ['customerId', '_key'])) === cust);
  return r ? firstOf(r, ['email']) : undefined;
}

// ---------- state ----------
function newState(oid, p) {
  return {
    v: 1, oid, ph: 'new', p, ed: null, pol: null, D: null, cust: null, em: null, cur: null, items: [],
    fl: [], tot: 0, fr: null, rv: null, cl: null, ac: [], stopped: false, oend: false,
    os: {}, ek: {}, nt: {}, tk: {}, ob: {},
  };
}

// Keys: one per logical effect, derived from ids only.
const fk = (C, F, suffix) => `${C.oid}|${F.id}|${suffix}`;

// fitArgs: the api schema in ctx.files carries the current field names (a rename may be active).
// Our names missing from the schema are mapped to the schema's unclaimed names, by substring
// match first and by position when exactly one is left.
function fitArgs(w, sys, op, args) {
  if (!w.sch) w.sch = {};
  if (!(sys in w.sch)) w.sch[sys] = load(w.ctx, `api/${sys}.schema.json`) || null;
  const props = w.sch[sys] && w.sch[sys].ops && w.sch[sys].ops[op] && w.sch[sys].ops[op].args
    ? w.sch[sys].ops[op].args.properties : undefined;
  if (!props) return args;
  const have = Object.keys(args);
  let missing = have.filter(k => !(k in props));
  if (!missing.length) return args;
  const norm = s => s.toLowerCase().replace(/[^a-z]/g, '');
  let free = Object.keys(props).filter(k => !have.includes(k));
  const out = { ...args };
  for (const m of missing) {
    const pick = free.find(f => norm(f).includes(norm(m)) || norm(m).includes(norm(f)));
    if (pick === undefined) continue;
    out[pick] = args[m];
    delete out[m];
    free = free.filter(f => f !== pick);
  }
  missing = Object.keys(out).filter(k => !(k in props));
  if (missing.length === 1 && free.length === 1) {
    out[free[0]] = out[missing[0]];
    delete out[missing[0]];
  }
  return out;
}

// emit: one output effect plus the tracking entry used to read its result.
function emit(w, sys, op, args, key, meta = {}) {
  const prev = w.C.ek[key];
  w.out.effects.push({ key, system: sys, op, args: fitArgs(w, sys, op, args) });
  w.C.ek[key] = { s: sys, r: null, p: false, c: null, n: prev ? (prev.n || 0) + 1 : 0, ...meta };
}

// track: a tracking entry without its own effect (per-item keys of a batch reserve).
function track(w, key, sys) {
  const prev = w.C.ek[key];
  w.C.ek[key] = { s: sys, r: null, p: false, c: null, n: prev ? (prev.n || 0) + 1 : 0, t: 'it' };
}

// settle: 'none' not emitted, 'pend' in flight, 'ok' committed, 'no' not committed.
function settle(w, key) {
  const e = w.C.ek[key];
  if (!e) return 'none';
  if (e.r === 'ok') return 'ok';
  if (e.r === 'err') return 'no';
  let st = 'pending';
  try { st = w.ctx.status(e.s, key); } catch { /* status unreadable: keep waiting */ }
  if (st === 'committed') return 'ok';
  if (e.r === 'unk' && st === 'not-found') return 'no';
  return 'pend';
}

const invalidArgs = e => /invalid|renamed|400/.test(e.c || '');

// A failure is permanent when the platform says so (retryable: false) or when it is a
// declined card (402, permanent by the api). Anything else may be re-issued (R4.2, R5.2).
const permanent = (retryable, code) => retryable === false || /declined/.test(code || '');

// run1: emit a keyed step once; re-issue it (same key, same args) only after a 400 or an
// unknown outcome that did not commit. Returns 'pend' | 'ok' | 'no' | 'fail' | 'none'.
function run1(w, key, sys, op, args, meta, go) {
  const e = w.C.ek[key];
  if (!e) {
    if (!go) return 'none';
    emit(w, sys, op, args, key, meta);
    return 'pend';
  }
  const s = settle(w, key);
  if (s !== 'no') return s;
  if (e.p && !invalidArgs(e)) return 'fail';
  if (go && e.n < 3) {
    emit(w, sys, op, args, key, meta);
    return 'pend';
  }
  return 'fail';
}

function planOf(x) {
  return Array.isArray(x) ? x : (x && Array.isArray(x.fulfilments) ? x.fulfilments : []);
}

// itemResult: the outcome of one item of a batch reserve (a batch op keys its items, not the batch).
function itemResult(C, k, ent, st, err, retry) {
  const ie = C.ek[k];
  const es = ent ? ent.status : undefined;
  if (st === 'ok' || es === 'ok' || es === 'committed') {
    ie.r = 'ok';
    ie.p = false;
  } else if (st === 'error' || es === 'error') {
    const ec = ent && ent.error ? ent.error : err;
    ie.r = 'err';
    ie.c = ec && typeof ec === 'object' ? String(ec.code ?? '') : String(ec ?? '');
    const eCode = ec && typeof ec === 'object' ? String(ec.code ?? '') : String(ec ?? '');
    ie.p = permanent(ent ? (ent.retryable ?? (ent.error && ent.error.retryable)) : retry, eCode);
  } else {
    ie.r = 'unk';
  }
}

// onResult: an effect.result. A batch reserve has no key of its own, so its result is matched
// by item key; without item detail the pending items defer to status(key).
function onResult(w, P) {
  const C = w.C;
  const err = P.error;
  const code = err && typeof err === 'object' ? String(err.code ?? '') : String(err ?? '');
  const retry = P.retryable ?? (err && typeof err === 'object' ? err.retryable : undefined);
  const perm = permanent(retry, code);
  const st = P.status;
  const e = C.ek[P.key];
  if (!e) {
    const keys = (P.items || []).map(x => x && x.key).filter(k => k && C.ek[k] && C.ek[k].t === 'it');
    if (keys.length) {
      for (const k of keys) itemResult(C, k, (P.items || []).find(x => x && x.key === k), st, err, retry);
    } else {
      for (const k of Object.keys(C.ek)) if (C.ek[k].t === 'it' && C.ek[k].r == null) C.ek[k].r = 'unk';
    }
    return;
  }
  e.r = st === 'ok' ? 'ok' : st === 'error' ? 'err' : 'unk';
  e.p = perm;
  e.c = code;
  if (st === 'ok' && e.t === 'al') e.plan = [P.result, P.items, P].find(x => x && typeof x === 'object' && (Array.isArray(x) || Array.isArray(x.fulfilments)));
  if (st === 'ok' && e.t === 'fr') {
    const b = [P.result, P.items, P].find(x => x && typeof x === 'object' && 'verdict' in x);
    if (b && ['pass', 'review', 'reject'].includes(b.verdict)) C.fr = b.verdict;
  }
}

// ---------- inbound events ----------
const isPlaced = P => 'orderId' in P && 'items' in P && 'customerId' in P;
const isAction = P => 'orderRef' in P && 'action' in P;
const isCarrier = P => 'fulfilmentRef' in P && 'code' in P;

function applyEvent(w, e) {
  const C = w.C;
  const P = e.payload || {};
  if (e.type === 'effect.result') return onResult(w, P);
  if (e.type === 'humanTask.answered') return onAnswer(C, e, P);
  if (e.type === 'humanTask.answerRejected' || e.type === 'humanTask.withdrawn') {
    if (C.rv) C.rv.reask = true;
    return;
  }
  if (isPlaced(P)) {
    if (C.cust == null) {
      C.cust = String(P.customerId);
      C.cur = String(P.currency);
      C.items = P.items.map(i => ({ sku: String(i.sku), qty: Number(i.qty) }));
      C.em = emailOf(w.ctx, C.cust) ?? null;
    }
    return;
  }
  if (isAction(P)) {
    const t = T(e.at);
    if (!C.ac.some(a => a.t === t && a.a === String(P.action))) C.ac.push({ t, a: String(P.action), u: false });
    return;
  }
  if (isCarrier(P)) return onCarrier(w, e, P);
}

function onAnswer(C, e, P) {
  const rv = C.rv;
  if (!rv) return;
  const ans = P.answer ?? P.value ?? P;
  const d = ans && typeof ans === 'object' ? ans.decision : undefined;
  if ((d === 'approve' || d === 'reject') && !rv.ans) rv.ans = { d, t: T(e.at) };
  else if (d !== 'approve' && d !== 'reject') rv.reask = true;
}

function codeMeaning(w, code) {
  if (!w.codes) w.codes = codeMap(w.ctx, w.C.ed);
  return w.codes[String(code)] || 'info';
}

function onCarrier(w, e, P) {
  const F = w.C.fl.find(f => f.id === String(P.fulfilmentRef).trim());
  if (!F) return;
  const m = codeMeaning(w, P.code);
  const t = T(P.reportedAt ?? e.at);
  if (m === 'collected' || m === 'inTransit' || m === 'delivered') F.coll = F.coll == null ? t : Math.min(F.coll, t);
  if (FINAL.has(F.st) || F.xs) return;
  if (m === 'collectionFailed') {
    F.cfl = true;
    return failFul(w, F, 'collection');
  }
  if (m === 'collected') return setFul(w, F, 'dispatched');
  if (m === 'delivered') {
    setFul(w, F, 'dispatched');
    setFul(w, F, 'completed');
  }
}

// migration (R3.5): an order already in flight. Its state is read back from the records, and the
// steps those records show as committed are marked so they are not issued again.
function rebuild(w, oid, e) {
  const ctx = w.ctx;
  const q = (table, where) => {
    try { return ctx.query(table, { where, limit: 1000 }) || []; } catch { return []; }
  };
  const [o] = q('orders.orders', { orderId: oid });
  if (!o) return false;
  const C = newState(oid, T(o.placedAt ?? e.at));
  C.cust = String(o.customerId);
  C.cur = String(o.currency);
  C.items = (o.items || []).map(i => ({ sku: String(i.sku), qty: Number(i.qty) }));
  C.em = emailOf(ctx, C.cust) ?? null;
  w.C = C;
  initRules(w);
  C.tot = Number(o.totalMinor) || 0;
  C.fl = q('orders.fulfilments', { orderId: oid }).map(r => {
    const loc = r.location ?? null;
    const F = {
      id: String(r.fulfilmentId), loc, av: loc !== null,
      items: (r.items || []).map(i => ({ sku: String(i.sku), qty: Number(i.qty) })),
      amt: Number(r.amountMinor) || 0, st: r.status, resOk: false, na: 0, fail: null, cfl: false, coll: null, xs: false,
    };
    const held = q('inventory.reservations', { fulfilmentId: F.id }).filter(x => x.status === 'active');
    for (const it of F.items) {
      if (held.some(x => x.sku === it.sku)) C.ek[fk(C, F, `r|${it.sku}`)] = { s: 'inventory', r: 'ok', p: false, c: null, n: 0, t: 'it' };
    }
    F.resOk = F.items.every(it => held.some(x => x.sku === it.sku));
    if (q('billing.charges', { fulfilmentId: F.id }).length) C.ek[fk(C, F, 'ch')] = { s: 'billing', r: 'ok', p: false, c: null, n: 0, t: 'ch' };
    const [sh] = q('carrier.shipments', { fulfilmentId: F.id });
    if (sh) {
      C.ek[fk(C, F, 'sh')] = { s: 'carrier', r: 'ok', p: false, c: null, n: 0, t: 'sh' };
      if (['collected', 'inTransit', 'delivered'].includes(sh.status)) F.coll = 0;
      if (sh.status === 'cancelled') F.xs = true;
      if (sh.status === 'failed') F.cfl = true;
    }
    if (F.st === 'failed') F.fail = { why: 'migrated' };
    return F;
  });
  C.os[o.status] = true;
  if (['completed', 'failed', 'cancelled', 'timedOut'].includes(o.status)) {
    C.oend = true;
    C.ph = 'end';
  } else if (o.status === 'customerActionRequired') {
    C.ph = 'wait';
    C.cl = C.p;
    C.nt[`${oid}|n|action-required|${oid}`] = true;
  } else if (o.status === 'processing') {
    C.ph = 'proc';
    C.cl = C.p;
    for (const F of C.fl) if (F.av && F.st === 'pending') setFul(w, F, 'processing');
  } else {
    C.ph = 'fraud';
    C.ek[`${oid}|alloc`] = { s: 'inventory', r: 'ok', p: false, c: null, n: 0, t: 'al' };
    C.ek[`${oid}|create`] = { s: 'orders', r: 'ok', p: false, c: null, n: 0, t: 'cr' };
  }
  return true;
}

// Routing for the first tick of an instance (no carry yet). Returns an output or null.
function route(w, events) {
  for (const e of events) {
    const P = e.payload || {};
    if (e.type === 'migration') {
      const oid = normId(P.orderId ?? P.orderRef);
      if (!oid) continue;
      const other = openFor(w, oid)[0];
      if (other) return mergeInto(oid, other);
      if (!rebuild(w, oid, e)) return closeOut(null);
      return w.C.oend ? closeOut(oid) : null;
    }
    if (isPlaced(P)) {
      const oid = normId(P.orderId);
      const other = openFor(w, oid)[0];
      if (other) return mergeInto(oid, other);
      if (recorded(w, oid)) return closeOut(oid);
      w.C = newState(oid, T(e.at));
      return null;
    }
    if (isAction(P)) {
      const oid = normId(P.orderRef);
      const other = openFor(w, oid)[0];
      if (other) return mergeInto(oid, other);
      return closeOut(recorded(w, oid) ? oid : null);
    }
    if (isCarrier(P)) {
      const oid = orderOfFulfilment(w, String(P.fulfilmentRef).trim());
      const other = oid ? openFor(w, oid)[0] : undefined;
      if (other) return mergeInto(oid, other);
      return closeOut(oid);
    }
  }
  return closeOut(null);
}

function openFor(w, oid) {
  let l = [];
  try { l = w.ctx.instances({ subject: oid }) || []; } catch { l = []; }
  return l.map(x => (typeof x === 'string' ? x : x?.instance ?? x?.id)).filter(x => x && x !== w.instance);
}

function recorded(w, oid) {
  try { return (w.ctx.query('orders.orders', { where: { orderId: oid }, limit: 1 }) || []).length > 0; } catch { return false; }
}

function orderOfFulfilment(w, fid) {
  try {
    const r = w.ctx.query('orders.fulfilments', { where: { fulfilmentId: fid }, limit: 1 }) || [];
    return r[0] ? normId(r[0].orderId) : null;
  } catch { return null; }
}

const emptyOut = () => ({ decisions: { subject: null }, effects: [], obligations: { upsert: [], cancel: [] }, humanTasks: [] });
const mergeInto = (oid, into) => ({ ...emptyOut(), decisions: { subject: oid }, merge: { into }, carry: { v: 1, merged: true } });
const closeOut = oid => ({ ...emptyOut(), decisions: { subject: oid }, close: true, carry: { v: 1, closed: true } });

function initRules(w) {
  const C = w.C;
  const ed = pickEdition(w.ctx, C.p);
  C.ed = ed ? ed.dir : null;
  const pol = (C.ed && load(w.ctx, `rulebook/${C.ed}/policy.json`)) || {};
  C.pol = { fh: Number(pol.fraudReviewHours) || 0, ca: Number(pol.customerActionHours) || 0 };
  C.D = C.p + C.pol.ca * 60 * MIN;
}

// ---------- fulfilments and order statuses ----------
function buildFulfilments(w, plan) {
  const C = w.C;
  const price = priceMap(w.ctx);
  const fee = C.ed ? feeMap(w.ctx, C.ed) : {};
  C.fl = plan.map(f => {
    const loc = f.location ?? null;
    const av = loc !== null;
    const items = (f.items || []).map(i => ({ sku: String(i.sku), qty: Number(i.qty) }));
    const amt = items.reduce((s, i) => s + i.qty * (price[i.sku] || 0), 0) + (av ? (fee[loc] || 0) : 0);
    return { id: String(f.fulfilmentId), loc, av, items, amt, st: av ? 'pending' : 'unavailable',
      resOk: false, na: 0, fail: null, cfl: false, coll: null, xs: false };
  });
  C.tot = C.fl.reduce((s, F) => s + F.amt, 0);
}

// R1.1 record: the order and its fulfilments as allocated, with the amounts of R1.2.
function createArgs(C) {
  return {
    orderId: C.oid, customerId: C.cust, placedAt: isoAms(C.p), currency: C.cur, items: C.items,
    fulfilments: C.fl.map(F => ({ fulfilmentId: F.id, location: F.loc, items: F.items, amountMinor: F.amt })),
    totalMinor: C.tot,
  };
}

function setFul(w, F, s) {
  if (F.st === s || FINAL.has(F.st) || FUL_ORDER.indexOf(s) <= FUL_ORDER.indexOf(F.st)) return;
  F.st = s;
  emit(w, 'orders', 'setStatus', { orderId: w.C.oid, fulfilmentId: F.id, status: s }, `${w.C.oid}|f|${F.id}|${s}`);
}

function setOrd(w, s) {
  const C = w.C;
  if (C.os[s] || C.oend) return;
  C.os[s] = true;
  if (['completed', 'failed', 'cancelled', 'timedOut'].includes(s)) C.oend = true;
  emit(w, 'orders', 'setStatus', { orderId: C.oid, fulfilmentId: null, status: s }, `${C.oid}|o|${s}`);
}

function notify(w, template, about, text, suffix = '') {
  const C = w.C;
  const key = `${C.oid}|n|${template}|${about}${suffix}`;
  if (C.nt[key]) return;
  C.nt[key] = true;
  emit(w, 'notify', 'send', { to: C.em || C.cust || 'unknown', about, template, text }, key);
}

function failFul(w, F, why) {
  if (F.fail || FINAL.has(F.st)) return;
  F.fail = { why };
  setFul(w, F, 'failed');
  notify(w, 'fulfilment-failed', F.id, `Fulfilment ${F.id} of order ${w.C.oid} could not be completed (${why}).`);
}

// R6.1 (also R6.2 once the order is stopped): nothing of the order is left to ship.
function cancelOrder(w, reason) {
  const C = w.C;
  for (const F of C.fl) if (!FINAL.has(F.st)) setFul(w, F, 'cancelled');
  setOrd(w, 'cancelled');
  notify(w, 'order-cancelled', C.oid, `Your order ${C.oid} was cancelled (${reason}).`);
  C.stopped = true;
  C.ph = 'end';
}

// R3.2: nothing counted by D.
function timeOut(w) {
  const C = w.C;
  for (const F of C.fl) if (!FINAL.has(F.st)) setFul(w, F, 'cancelled');
  setOrd(w, 'timedOut');
  notify(w, 'order-timed-out', C.oid, `Your order ${C.oid} timed out: no change was requested in time.`);
  C.ph = 'end';
}

function startProcessing(w) {
  const C = w.C;
  setOrd(w, 'processing');
  for (const F of C.fl) if (F.av) setFul(w, F, 'processing');
  C.ph = 'proc';
}

// R2 / R2.2: the order is cleared at t.
function clearOrder(w, t) {
  const C = w.C;
  C.cl = t;
  if (C.fl.some(F => !F.av)) {
    setOrd(w, 'customerActionRequired');
    notify(w, 'action-required', C.oid, `Some items of order ${C.oid} are unavailable. Reply by ${isoAms(C.D)} to amend or cancel.`);
    C.ph = 'wait';
  } else {
    startProcessing(w);
  }
}

// R3.2 amend: drop the unavailable fulfilments; the rest is ready at t.
function amend(w) {
  const C = w.C;
  for (const F of C.fl) if (!F.av) setFul(w, F, 'cancelled');
  if (!C.fl.some(F => F.av)) return cancelOrder(w, 'nothing-available');
  startProcessing(w);
}

function openTask(w) {
  const C = w.C;
  const rv = C.rv;
  const id = `${C.oid}-rv${rv.n}`;
  if (C.tk[id]) return;
  C.tk[id] = true;
  w.out.humanTasks.push({
    id, kind: 'fraudReview', role: 'fraudAnalyst', subject: C.oid,
    question: `Fraud review of order ${C.oid}: approve or reject.`,
    answerSchema: {
      type: 'object', required: ['decision'], additionalProperties: false,
      properties: { decision: { type: 'string', enum: ['approve', 'reject'] } },
    },
    dueAt: isoAms(rv.dl), onTimeout: 'cancel',
  });
}

function openReview(w) {
  const C = w.C;
  C.rv = { dl: w.now + C.pol.fh * 60 * MIN, n: 1, ans: null, reask: false };
  C.ph = 'review';
  openTask(w);
}

// Customer cancels not yet used, for the pre-clearing rules (R6.4).
function takeCancel(C) {
  let hit = false;
  for (const a of C.ac) if (!a.u && a.a === 'cancel') { a.u = true; hit = true; }
  return hit;
}

const collectedBy = (C, t) => C.fl.some(F => F.coll != null && F.coll <= t);

// ---------- phases of the order ----------
// ph: new -> alloc -> create -> fraud -> (review) -> wait? -> proc -> end
function phaseStep(w) {
  const C = w.C;
  const now = w.now;
  if (C.ph === 'new') {
    C.ph = 'alloc';
    emit(w, 'inventory', 'allocate', { orderId: C.oid }, `${C.oid}|alloc`, { t: 'al' });
    return;
  }
  if (C.ph === 'alloc') {
    const e = C.ek[`${C.oid}|alloc`];
    if (!e || e.r !== 'ok' || !e.plan) return;
    buildFulfilments(w, planOf(e.plan));
    delete e.plan;
    C.ph = 'create';
    run1(w, `${C.oid}|create`, 'orders', 'create', createArgs(C), { t: 'cr' }, true);
    return;
  }
  if (C.ph === 'create') {
    if (run1(w, `${C.oid}|create`, 'orders', 'create', createArgs(C), { t: 'cr' }, true) === 'ok') C.ph = 'fraud';
    return;
  }
  if (C.ph === 'fraud') {
    const frK = `${C.oid}|fr`;
    if (!C.ek[frK]) emit(w, 'fraud', 'check', { orderId: C.oid }, frK, { t: 'fr' });
    if (!C.fr) {
      if (takeCancel(C)) cancelOrder(w, 'customer');
      return;
    }
    if (C.fr === 'reject') return cancelOrder(w, 'fraud');
    if (C.fr === 'review') return openReview(w);
    return clearOrder(w, C.p);
  }
  if (C.ph === 'review') {
    const rv = C.rv;
    // The answer reaches us before a cancel of the same instant (S12): a reject decides the
    // order for fraud, and an approve clears it so that the cancel is judged afterwards.
    if (rv.ans && rv.ans.t <= rv.dl) {
      if (rv.ans.d === 'reject') return cancelOrder(w, 'fraud');
      return clearOrder(w, rv.ans.t);
    }
    if (takeCancel(C)) return cancelOrder(w, 'customer');
    if (now > rv.dl) return cancelOrder(w, 'fraud-review-timeout');
    if (rv.reask) {
      rv.reask = false;
      rv.n += 1;
      openTask(w);
    }
    return;
  }
  if (C.ph === 'wait') {
    const D = C.D;
    const due = C.ac.filter(a => !a.u && a.t <= D).sort((x, y) => x.t - y.t);
    const first = due.find(a => a.a === 'amend' || a.a === 'cancel');
    if (first) {
      // Only the counted action is used up: a later cancel at or before D is judged as a cancel
      // during processing after a counted amend (S8).
      first.u = true;
      if (first.a === 'cancel') {
        for (const a of due) a.u = true;
        return cancelOrder(w, 'customer');
      }
      return amend(w);
    }
    if (now > D) timeOut(w);
    return;
  }
  if (C.ph === 'proc') {
    // A fulfilment that ended in this instant (S13) ends the order before a cancel of that instant.
    if (C.fl.length && C.fl.every(F => FINAL.has(F.st))) return;
    const cancels = C.ac.filter(a => !a.u && a.a === 'cancel').sort((x, y) => x.t - y.t);
    for (const a of C.ac) if (a.a === 'amend') a.u = true;
    for (const a of cancels) {
      a.u = true;
      if (collectedBy(C, a.t)) {
        notify(w, 'cancel-refused', C.oid, `Your order ${C.oid} can no longer be cancelled: it has been collected.`, `|${a.t}`);
      } else {
        return cancelOrder(w, 'customer');
      }
    }
  }
}

// ---------- R4.2 forward steps (one saga per fulfilment) ----------
function stepReserve(w, F, go) {
  const C = w.C;
  const ik = sku => fk(C, F, `r|${sku}`);
  const rs = F.items.map(i => ({ sku: i.sku, qty: i.qty, s: settle(w, ik(i.sku)) }));
  if (rs.some(x => x.s === 'pend')) return;
  if (rs.every(x => x.s === 'ok')) {
    F.resOk = true;
    return;
  }
  if (rs.some(x => x.s === 'no' && C.ek[ik(x.sku)].p && !invalidArgs(C.ek[ik(x.sku)]))) return failFul(w, F, 'reserve');
  if (!go) return;
  if (F.na >= 4) return failFul(w, F, 'reserve');
  const need = rs.filter(x => x.s !== 'ok');
  F.na += 1;
  for (const x of need) track(w, ik(x.sku), 'inventory');
  // A batch carries no top-level key: each item is keyed (R4.2, api/inventory.schema.json).
  w.out.effects.push({
    system: 'inventory', op: 'reserve',
    args: fitArgs(w, 'inventory', 'reserve', {
      orderId: C.oid, fulfilmentId: F.id, location: F.loc, items: need.map(x => ({ key: ik(x.sku), sku: x.sku, qty: x.qty })),
    }),
  });
}

function forward(w, F) {
  const C = w.C;
  const go = !C.stopped && !F.fail;
  if (!F.resOk) {
    stepReserve(w, F, go);
    if (!F.resOk) return;
  }
  if (!go) return;
  const c = run1(w, fk(C, F, 'ch'), 'billing', 'charge', {
    orderId: C.oid, fulfilmentId: F.id, customerId: C.cust, amountMinor: F.amt, currency: C.cur,
  }, { t: 'ch' }, true);
  if (c === 'fail') return failFul(w, F, 'charge');
  if (c !== 'ok') return;
  const s = run1(w, fk(C, F, 'sh'), 'carrier', 'create', {
    orderId: C.oid, fulfilmentId: F.id, location: F.loc, ref: F.id,
  }, { t: 'sh' }, true);
  if (s === 'fail') failFul(w, F, 'ship');
}

// R5.1 compensation in reverse order: shipment, then refund, then releases. Each step
// waits for the one before it to settle; a step that never committed is not undone.
function compensate(w, F) {
  const C = w.C;
  const xs = fk(C, F, 'xs'), sh = fk(C, F, 'sh'), ch = fk(C, F, 'ch'), rf = fk(C, F, 'rf');
  if (settle(w, sh) === 'pend') return;
  if (settle(w, sh) === 'ok' && !F.cfl && !C.ek[xs]) {
    F.xs = true;
    emit(w, 'carrier', 'cancel', { orderId: C.oid, fulfilmentId: F.id }, xs, { t: 'xs' });
  }
  if (C.ek[xs] && settle(w, xs) === 'pend') return;
  const chS = settle(w, ch);
  if (chS === 'pend') return;
  if (chS === 'ok' && !C.ek[rf]) {
    emit(w, 'billing', 'refund', { orderId: C.oid, fulfilmentId: F.id, amountMinor: F.amt }, rf, { t: 'rf' });
  }
  if (C.ek[rf] && settle(w, rf) === 'pend') return;
  for (const sku of [...new Set(F.items.map(i => i.sku))]) {
    const s = settle(w, fk(C, F, `r|${sku}`));
    if (s === 'pend') return;
    const rl = fk(C, F, `rl|${sku}`);
    if (s === 'ok' && !C.ek[rl]) emit(w, 'inventory', 'release', { orderId: C.oid, fulfilmentId: F.id, sku }, rl, { t: 'rl' });
  }
}

function advance(w) {
  for (let i = 0; i < 6; i++) {
    const before = w.C.ph;
    phaseStep(w);
    if (w.C.ph === before) break;
  }
  const C = w.C;
  if (C.ph === 'proc') for (const F of C.fl) if (F.av) forward(w, F);
  for (const F of C.fl) if (F.av && (F.fail || C.stopped) && F.st !== 'completed') compensate(w, F);
  if (C.ph === 'proc' && C.fl.length && C.fl.every(F => FINAL.has(F.st))) {
    setOrd(w, C.fl.some(F => F.st === 'completed') ? 'completed' : C.fl.some(F => F.st === 'failed') ? 'failed' : 'cancelled');
    C.ph = 'end';
  }
}

// ---------- obligations (wake-ups at deadlines; each fires one minute after its deadline) ----------
function obligations(w) {
  const C = w.C;
  const want = {};
  if (C.ph === 'review' && C.rv) want[`${C.oid}-review-deadline`] = { due: C.rv.dl + MIN, on: 'fraudReviewDeadline' };
  if (C.ph === 'wait') want[`${C.oid}-customer-deadline`] = { due: C.D + MIN, on: 'customerDeadline' };
  for (const [id, o] of Object.entries(want)) {
    if (C.ob[id] === o.due) continue;
    C.ob[id] = o.due;
    w.out.obligations.upsert.push({ id, kind: 'deadline', anchor: isoAms(C.p), dueAt: isoAms(o.due), onDue: o.on });
  }
  for (const id of Object.keys(C.ob)) {
    if (want[id]) continue;
    delete C.ob[id];
    w.out.obligations.cancel.push(id);
  }
}

function finish(w) {
  const C = w.C;
  obligations(w);
  const pending = Object.entries(C.ek).some(([k, e]) => e.r == null || (e.r === 'unk' && settle(w, k) === 'pend'));
  w.out.decisions = { subject: C.oid };
  w.out.carry = C;
  if (C.ph === 'end' && !pending) w.out.close = true;
  return w.out;
}

// ---------- the arm ----------
function tick(input, ctx) {
  const w = {
    C: input.carry && typeof input.carry === 'object' ? input.carry : null,
    out: emptyOut(), ctx, now: T(input.now), instance: input.instance, codes: null,
  };
  const events = input.events || [];
  if (!w.C) {
    const early = route(w, events);
    if (early) return early;
    initRules(w);
  }
  for (const e of events) applyEvent(w, e);
  advance(w);
  return finish(w);
}

export function createSolver() {
  return { id: 'solver', tick };
}
