// E8 order fulfilment with compensation (SPEC-E). A pure function of (input, ctx): time is input.now only.
// Each tick replays the events into the carry, then drives every rule whose window is open.

const MIN = 60000;
const TERM = ['completed', 'failed', 'cancelled'];
const INVALID = ['invalid-args', 'field-renamed'];
const MEANINGS = ['collected', 'inTransit', 'delivered', 'collectionFailed', 'info'];
const MAX_TRIES = 5;

export function createSolver() {
  return { id: 'solver', tick: (input, ctx) => tick(input, ctx) };
}

function tick(input, ctx) {
  const now = Date.parse(input.now);
  const T = { now, ctx, fx: [], up: [], cancel: [], ht: [], merge: null, close: false, memo: {} };
  const ev = input.events || [];
  let c = input.carry ? JSON.parse(JSON.stringify(input.carry)) : null;
  if (!c) {
    const early = route(T, input, ev);
    if (early) return early;
    const start = ev.find(e => e.type === 'order.placed' || e.type === 'migration');
    if (!start) return out(T, null, null);
    c = (start.type === 'migration' && fromRecords(T, start)) || newCarry(T, start);
    if (!c.o) { T.close = true; return out(T, null, null); }
  }
  // Carrier reports first: a collection in the same instant as a cancel wins (S4).
  for (const e of ev) if (e.type === 'carrier.status') handle(T, c, e);
  for (const e of ev) if (e.type !== 'carrier.status') handle(T, c, e);
  drive(T, c);
  if (c.ph === 'end' && !pending(c)) {
    T.close = true;
    T.cancel.push(...c.ob);
    c.ob = [];
  }
  return out(T, c, c.o);
}

// ---------- helpers ----------

export function norm(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (s.startsWith('#')) s = s.slice(1).trim();
  return s.toUpperCase();
}

// Amsterdam-local ISO string with offset, minute precision.
function isoAms(t) {
  const d = new Date(t);
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Amsterdam', hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const off = Math.round((local - t) / MIN);
  const a = Math.abs(off);
  const sign = off < 0 ? '-' : '+';
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

function localDay(t) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(t));
}

function fileOf(ctx, path) {
  const f = ctx.files;
  if (!f) return undefined;
  const flat = f instanceof Map ? f.get(path) : f[path];
  if (flat !== undefined) return flat;
  let v = f;
  for (const seg of path.split('/')) {
    if (v === null || v === undefined) return undefined;
    v = v instanceof Map ? v.get(seg) : v[seg];
  }
  return v;
}

function listOf(ctx, dir) {
  const f = ctx.files;
  if (!f) return [];
  const keys = f instanceof Map ? [...f.keys()] : Object.keys(f);
  const names = new Set();
  for (const k of keys) if (k.startsWith(dir + '/')) names.add(k.slice(dir.length + 1).split('/')[0]);
  if (!names.size) {
    const sub = fileOf(ctx, dir);
    if (sub && typeof sub === 'object' && !Array.isArray(sub)) return Object.keys(sub);
  }
  return [...names];
}

function load(ctx, path) {
  const v = fileOf(ctx, path);
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') return v;
  if (path.endsWith('.csv')) return parseCsv(v);
  try { return JSON.parse(v); } catch { return undefined; }
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return [];
  const head = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(l => {
    const cells = l.split(',').map(x => x.trim());
    const row = {};
    head.forEach((h, i) => {
      const v = cells[i];
      row[h] = v !== undefined && v !== '' && !isNaN(Number(v)) ? Number(v) : v;
    });
    return row;
  });
}

function rowsOf(doc) {
  if (Array.isArray(doc)) return doc;
  if (doc && typeof doc === 'object') for (const v of Object.values(doc)) if (Array.isArray(v)) return v;
  return [];
}

function field(row, names) {
  if (!row || typeof row !== 'object') return undefined;
  for (const n of names) if (row[n] !== undefined) return row[n];
  const keys = Object.keys(row);
  for (const n of names) {
    const hit = keys.find(k => k.toLowerCase() === n.toLowerCase());
    if (hit !== undefined) return row[hit];
  }
  return undefined;
}

function findKey(o, k) {
  if (!o || typeof o !== 'object') return undefined;
  if (o[k] !== undefined) return o[k];
  for (const v of Object.values(o)) {
    const r = findKey(v, k);
    if (r !== undefined) return r;
  }
  return undefined;
}

function editionAt(ctx, t) {
  const day = localDay(t);
  const eds = [];
  for (const d of listOf(ctx, 'rulebook')) {
    const e = load(ctx, `rulebook/${d}/edition.json`);
    if (e && e.effectiveFrom) eds.push({ dir: d, from: String(e.effectiveFrom).slice(0, 10) });
  }
  const ok = eds.filter(e => e.from <= day).sort((a, b) => (a.from < b.from ? 1 : -1));
  return ok.length ? ok[0].dir : null;
}

function policy(T, c, name) {
  const v = findKey(load(T.ctx, `rulebook/${c.ed}/policy.json`), name);
  return Number(v) || 0;
}

function priceOf(T, sku) {
  if (!T.memo.cat) T.memo.cat = rowsOf(load(T.ctx, 'master/catalog.json'));
  const r = T.memo.cat.find(x => String(field(x, ['sku'])) === sku);
  return Number(field(r, ['unitPriceMinor', 'unitPrice', 'priceMinor'])) || 0;
}

function feeOf(T, c, loc) {
  if (!loc) return 0;
  const rows = rowsOf(load(T.ctx, `rulebook/${c.ed}/shipping-fees.json`));
  const r = rows.find(x => String(field(x, ['location'])) === loc);
  return Number(field(r, ['feeMinor', 'fee'])) || 0;
}

function emailOf(T, customerId) {
  const rows = rowsOf(load(T.ctx, 'master/customers.json'));
  const r = rows.find(x => String(field(x, ['customerId'])) === String(customerId));
  return field(r, ['email']) || customerId;
}

function meaningOf(T, c, code) {
  const rows = rowsOf(load(T.ctx, `rulebook/${c.ed}/carrier-codes.json`));
  for (const r of rows) {
    const k = field(r, ['code', 'carrierCode']);
    if (k !== undefined && String(k) === String(code)) {
      const m = field(r, ['meaning', 'status', 'means', 'kind']);
      if (MEANINGS.includes(String(m))) return String(m);
    }
  }
  return 'info';
}

function openOf(T, subject) {
  const list = T.ctx.instances({ subject }) || [];
  return list.map(x => (typeof x === 'string' ? x : x.instance ?? x.id)).filter(Boolean);
}

function queryRows(T, table, where) {
  const r = T.ctx.query(table, { where });
  return Array.isArray(r) ? r : (r && r.rows) || [];
}

function errCode(err) {
  if (!err) return '';
  return typeof err === 'string' ? err : err.code || '';
}

function isInvalid(err) {
  return INVALID.includes(errCode(err)) || (err && typeof err === 'object' && err.status === 400);
}

function pending(c) {
  return Object.values(c.k).some(v => v[3] === 'pend');
}

const STEP_TAGS = ['rsv', 'chg', 'shp', 'shpc', 'ref', 'rel'];

function stepPending(c, fid) {
  return Object.values(c.k).some(v => v[1] === fid && STEP_TAGS.includes(v[0]) && v[3] === 'pend');
}

// ---------- routing of the first tick ----------

function route(T, input, ev) {
  const e = ev.find(x => ['order.placed', 'customer.action', 'carrier.status'].includes(x.type)) || ev[0];
  const done = (subject, extra) => ({ decisions: { subject }, effects: [], obligations: { upsert: [], cancel: [] }, humanTasks: [], carry: {}, ...extra });
  if (!e || e.type === 'migration') return null;
  if (e.type === 'order.placed') {
    const o = norm(e.payload && e.payload.orderId);
    const open = openOf(T, o).filter(i => i !== input.instance);
    if (open.length) return done(o, { merge: { into: open[0] } });
    if (queryRows(T, 'orders.orders', { orderId: o }).length) return done(o, { close: true });
    return null;
  }
  if (e.type === 'customer.action') {
    const o = norm(e.payload && e.payload.orderRef);
    const open = openOf(T, o).filter(i => i !== input.instance);
    if (open.length) return done(o, { merge: { into: open[0] } });
    const known = queryRows(T, 'orders.orders', { orderId: o }).length > 0;
    return done(known ? o : null, { close: true });
  }
  if (e.type === 'carrier.status') {
    const fid = String((e.payload && e.payload.fulfilmentRef) || '').trim();
    const o = (queryRows(T, 'orders.fulfilments', { fulfilmentId: fid })[0] || {}).orderId ?? null;
    const open = o ? openOf(T, o).filter(i => i !== input.instance) : [];
    if (open.length) return done(o, { merge: { into: open[0] } });
    return done(o, { close: true });
  }
  return done(null, { close: true });
}

// ---------- carry ----------

function newCarry(T, e) {
  // Migration payloads may nest the order fields, so look each one up anywhere in the payload.
  const pl = (e && e.payload) || {};
  const p = (k) => findKey(pl, k);
  const o = norm(p('orderId'));
  const placed = p('placedAt') || e.at;
  const ed = editionAt(T.ctx, placed);
  const c = {
    o, p: placed, cu: p('customerId'), cur: p('currency'), it: p('items') || [], ed,
    R: 0, A: 0, em: null, al: null, fd: null, rec: 'no', fr: null, cl: null,
    ph: 'intake', D: null, act: null, ost: 'pending', stop: null, f: {}, k: {}, tries: {}, ob: [],
  };
  c.R = policy(T, c, 'fraudReviewHours');
  c.A = policy(T, c, 'customerActionHours');
  c.em = emailOf(T, c.cu);
  return c;
}

// ---------- events ----------

function handle(T, c, e) {
  const at = Date.parse(e.at);
  // An effect.result carries its fields at top level or inside payload; accept either.
  if (e.type === 'effect.result') return result(T, c, Object.assign({}, e, e.payload || {}));
  if (e.type === 'customer.action') return action(T, c, e, at);
  if (e.type === 'carrier.status') return carrier(T, c, e, at);
  if (e.type && e.type.startsWith('humanTask.') && c.fr) return task(T, c, e, at);
}

// The batch reserve is unkeyed (its items carry the keys), so it is tracked per fulfilment.
function batchKey(c, e) {
  const its = Array.isArray(e.items) ? e.items : [];
  const hit = its.find(x => x && typeof x.key === 'string' && x.key.startsWith(`${c.o}:ri:`));
  if (hit) return `~inventory.reserve|${hit.key.slice(c.o.length + 4).split(':')[0]}`;
  const pend = Object.keys(c.k).filter(k => k.startsWith('~inventory.reserve|') && c.k[k][3] === 'pend');
  return pend.length === 1 ? pend[0] : '';
}

function result(T, c, e) {
  // Unkeyed effects are matched by system.op, whatever key the platform echoes back.
  let kk = c.k[e.key] ? e.key : `~${e.system}.${e.op}`;
  if (e.op === 'reserve') kk = batchKey(c, e);
  const m = c.k[kk];
  if (!m) return;
  const [tag, fid, sub] = m;
  const f = fid ? c.f[fid] : null;
  const ok = e.status === 'ok';
  const code = errCode(e.error);
  if (!ok && tag !== 'rsv' && (tag === 'alloc' || tag === 'fraud' || tag === 'create' || isInvalid(e.error))) {
    c.tries[tag] = (c.tries[tag] || 0) + 1;
    if (c.tries[tag] <= MAX_TRIES) { delete c.k[kk]; return; }
  }
  m[3] = ok ? 'ok' : 'err';
  const body = e.items ?? e.result ?? e.output ?? e.value;
  switch (tag) {
    case 'alloc':
      if (ok) plan(T, c, body);
      return;
    case 'fraud': {
      const v = body && typeof body === 'object' ? (body.verdict ?? body) : body;
      c.fd = v === 'pass' ? 'pass' : v === 'reject' ? 'reject' : 'review';
      if (c.fd === 'pass') c.cl = c.p;
      if (c.fd === 'reject') c.stop = 'fraud';
      return;
    }
    case 'create':
      if (ok) c.rec = 'ok';
      return;
    case 'rsv':
      rsvResult(c, f, e);
      // Items still to submit: drop the batch entry so the next drive resubmits them with their own keys.
      if (f.items.some(it => f.rsv[it.sku] === 'no')) delete c.k[kk];
      return;
    case 'chg':
      if (ok) f.chg = 'ok';
      else f.chg = code === 'card-declined' || (e.error && e.error.status === 402) ? 'declined' : 'bad';
      return;
    case 'shp':
      f.shp = ok ? 'ok' : 'bad';
      return;
    case 'shpc':
      f.shpc = ok ? 'ok' : 'refused';
      return;
    case 'ref':
      f.ref = ok ? 'ok' : 'bad';
      return;
    case 'rel':
      f.rel[sub] = ok ? 'ok' : 'bad';
      return;
    default:
      return;
  }
}

function plan(T, c, items) {
  const rows = Array.isArray(items) ? items : (items && items.fulfilments) || [];
  c.f = {};
  for (const r of rows) {
    const fid = String(r.fulfilmentId);
    const avail = r.location !== null && r.location !== undefined && r.available !== false;
    const loc = avail ? String(r.location) : null;
    const its = (r.items || []).map(i => ({ sku: String(i.sku), qty: Number(i.qty) }));
    const amt = its.reduce((s, i) => s + i.qty * priceOf(T, i.sku), 0) + feeOf(T, c, loc);
    c.f[fid] = {
      id: fid, loc, avail, items: its, amt, st: avail ? 'pending' : 'unavailable',
      rsv: Object.fromEntries(its.map(i => [i.sku, 'no'])), rel: {},
      chg: 'no', shp: 'no', shpc: 'no', ref: 'no', coll: null, cd: false, cf: false, dl: false, fail: false,
    };
  }
  c.al = Object.keys(c.f);
}

function rsvResult(c, f, e) {
  const n = (c.tries['rsv' + f.id] = (c.tries['rsv' + f.id] || 0) + 1);
  for (const it of f.items) {
    if (f.rsv[it.sku] === 'ok') continue;
    const ik = `${c.o}:ri:${f.id}:${it.sku}`;
    const r = Array.isArray(e.items) ? e.items.find(x => x && x.key === ik) : undefined;
    if (e.status === 'ok' || (r && r.status === 'ok')) { f.rsv[it.sku] = 'ok'; continue; }
    const rc = (r && r.error) || e.error;
    // Items the batch did not process committed nothing: resubmit them with their original keys. Only a permanent
    // error (retryable: false) fails the fulfilment; an invalid request of ours is resubmitted too.
    const permanent = !!rc && rc.retryable === false && !isInvalid(rc);
    f.rsv[it.sku] = !permanent && n <= MAX_TRIES ? 'no' : 'bad';
  }
}

function action(T, c, e, at) {
  const pl = e.payload || {};
  if (c.ph === 'intake') {
    if (pl.action === 'cancel' && !c.stop) c.stop = 'customer';
    return;
  }
  if (c.ph === 'wait' && !c.act && at <= Date.parse(c.D)) {
    c.act = pl.action === 'amend' ? 'amend' : 'cancel';
    if (c.act === 'cancel') c.stop = 'customer';
    return;
  }
  if (c.ph === 'proc' && pl.action === 'cancel' && !c.stop) {
    const refused = Object.values(c.f).some(f => f.coll !== null && f.coll <= at);
    if (refused) {
      return notify(T, c, 'cancel-refused', null, c.em, 'Your order can no longer be cancelled: it has been collected for shipping.');
    }
    c.stop = 'customer';
  }
}

function carrier(T, c, e, at) {
  const p = e.payload || {};
  const f = c.f[String(p.fulfilmentRef || '').trim()];
  if (!f || TERM.includes(f.st) || f.st === 'unavailable') return;
  const mean = meaningOf(T, c, p.code);
  const t = Date.parse(p.reportedAt || e.at) || at;
  if (['collected', 'inTransit', 'delivered'].includes(mean)) {
    f.coll = f.coll === null ? t : Math.min(f.coll, t);
    if (mean !== 'inTransit') f.cd = true;
    if (mean === 'delivered') f.dl = true;
  } else if (mean === 'collectionFailed' && f.coll === null) {
    f.cf = true;
    f.fail = true;
  }
}

function task(T, c, e, at) {
  // A rejected or withdrawn task is asked again (same deadline); timeout and delegation change nothing here.
  if (e.type === 'humanTask.answerRejected' || e.type === 'humanTask.withdrawn') {
    c.fr.redo = true;
    return;
  }
  if (e.type !== 'humanTask.answered') return;
  const pl = e.payload || {};
  const raw = pl.answer !== undefined ? pl.answer : pl;
  const d = typeof raw === 'string' ? raw : raw && raw.decision;
  if (!c.fr.ans && c.fd === 'review' && (d === 'approve' || d === 'reject') && at <= c.fr.due) {
    c.fr.ans = { d, at };
    if (d === 'approve') c.cl = isoAms(at);
    else c.stop = 'fraud';
  } else if (!c.fr.ans) {
    c.fr.redo = true;
  }
}

// ---------- effects ----------

// Field names follow the live api schema in ctx.files (a system may rename a field mid-run).
const norm2 = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const tokens = s => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function renamedTo(props, k, args) {
  const have = Object.keys(props);
  const free = have.filter(h => !(h in args));
  const byNorm = free.find(h => norm2(h) === norm2(k));
  if (byNorm) return byNorm;
  const byNote = free.find(h => [].concat(props[h].renamedFrom || [], props[h].formerly || []).includes(k));
  if (byNote) return byNote;
  const kt = tokens(k);
  let best = null;
  let bestScore = 0;
  for (const h of free) {
    const ht = tokens(h);
    const score = kt.filter(t => ht.includes(t)).length;
    if (score > bestScore) { best = h; bestScore = score; }
  }
  return best;
}

function adapt(T, system, op, args) {
  const sch = load(T.ctx, `api/${system}.schema.json`);
  const a = sch && sch.ops && sch.ops[op] && sch.ops[op].args;
  if (!a || !a.properties) return args;
  const props = a.properties;
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (k in props) out[k] = v;
    else {
      const nk = renamedTo(props, k, out);
      out[nk || k] = v;
    }
  }
  const itp = props.items && props.items.items && props.items.items.properties;
  if (Array.isArray(out.items) && itp) {
    out.items = out.items.map(it => {
      const r = {};
      for (const [k, v] of Object.entries(it)) {
        if (k in itp) r[k] = v;
        else r[renamedTo(itp, k, r) || k] = v;
      }
      return r;
    });
  }
  return out;
}

function send(T, c, tag, fid, sub, system, op, args, keyed = true) {
  const key = keyed ? `${c.o}:${tag}:${fid || '-'}:${sub || '-'}` : `~${system}.${op}`;
  if (c.k[key]) return false;
  const e = { system, op, args: adapt(T, system, op, args) };
  if (keyed) e.key = key;
  T.fx.push(e);
  c.k[key] = [tag, fid || null, sub || null, 'pend'];
  return true;
}

function setOrd(T, c, status) {
  if (c.ost === status) return;
  c.ost = status;
  send(T, c, 'os', null, status, 'orders', 'setStatus', { orderId: c.o, fulfilmentId: null, status });
}

function setF(T, c, f, status) {
  if (f.st === status || TERM.includes(f.st)) return;
  f.st = status;
  send(T, c, 'fs', f.id, status, 'orders', 'setStatus', { orderId: c.o, fulfilmentId: f.id, status });
}

function notify(T, c, template, fid, to, text) {
  return send(T, c, 'n', fid, template, 'notify', 'send', {
    to, about: fid || c.o, template, text,
  });
}

// ---------- the driver ----------

function drive(T, c) {
  const { now } = T;
  if (c.al === null) send(T, c, 'alloc', null, null, 'inventory', 'allocate', { orderId: c.o }, false);
  if (c.fd === null) send(T, c, 'fraud', null, null, 'fraud', 'check', { orderId: c.o }, false);
  if (c.al && c.rec === 'no') {
    const fs = Object.values(c.f);
    send(T, c, 'create', null, null, 'orders', 'create', {
      orderId: c.o, customerId: c.cu, placedAt: c.p, currency: c.cur, items: c.it,
      fulfilments: fs.map(f => ({ fulfilmentId: f.id, location: f.loc, items: f.items, amountMinor: f.amt })),
      totalMinor: fs.reduce((s, f) => s + f.amt, 0),
    });
  }
  if (c.rec !== 'ok') return;

  // R2 fraud review
  if (c.fd === 'review' && !c.fr && !c.stop) {
    c.fr = { n: 1, emitted: 0, due: now + c.R * 60 * MIN, ans: null, redo: false };
  }
  if (c.fr && !c.fr.ans && c.fd === 'review' && !c.stop) {
    if (now > c.fr.due) c.stop = 'fraud-review-timeout';
    else {
      if (c.fr.redo) { c.fr.n += 1; c.fr.redo = false; }
      if (c.fr.emitted < c.fr.n) {
        c.fr.emitted = c.fr.n;
        T.ht.push({
          id: `${c.o}:fr${c.fr.n}`, kind: 'fraudReview', role: 'fraudAnalyst', subject: c.o,
          question: `Review order ${c.o} and answer approve or reject.`,
          answerSchema: { type: 'object', required: ['decision'], properties: { decision: { enum: ['approve', 'reject'] } } },
          dueAt: isoAms(c.fr.due), onTimeout: 'fraudReviewTimeout',
        });
      }
      obligation(T, c, `${c.o}:fr`, c.fr.due + MIN, 'fraudReviewDeadline');
    }
  }

  // R2/R3 clearing
  if (c.cl && c.ph === 'intake' && !c.stop) {
    const unav = Object.values(c.f).some(f => !f.avail);
    if (unav) {
      c.ph = 'wait';
      c.D = isoAms(Date.parse(c.p) + c.A * 60 * MIN);
      setOrd(T, c, 'customerActionRequired');
      notify(T, c, 'action-required', null, c.em, 'Some items of your order are unavailable. Please amend or cancel within the deadline.');
    } else {
      ready(T, c);
    }
  }

  // R3.2 waiting for the customer
  if (c.ph === 'wait') {
    if (c.act === 'amend') {
      for (const f of Object.values(c.f)) if (!f.avail) setF(T, c, f, 'cancelled');
      if (!Object.values(c.f).some(f => f.avail)) c.stop = 'nothing-available';
      else ready(T, c);
    } else if (!c.act && now > Date.parse(c.D)) {
      for (const f of Object.values(c.f)) setF(T, c, f, 'cancelled');
      setOrd(T, c, 'timedOut');
      notify(T, c, 'order-timed-out', null, c.em, 'Your order timed out and was not shipped.');
      c.ph = 'end';
    } else if (!c.act) {
      obligation(T, c, `${c.o}:cust`, Date.parse(c.D) + MIN, 'customerDeadline');
    }
  }
  if (c.ph === 'end') return;

  // R6 stop: compensate every fulfilment not yet terminal
  if (c.stop) {
    if (c.ost !== 'cancelled') {
      setOrd(T, c, 'cancelled');
      notify(T, c, 'order-cancelled', null, c.em, `Your order was cancelled (${c.stop}).`);
    }
    for (const f of Object.values(c.f)) {
      if (TERM.includes(f.st)) continue;
      if (compensate(T, c, f)) setF(T, c, f, 'cancelled');
    }
    if (Object.values(c.f).every(f => TERM.includes(f.st))) c.ph = 'end';
    return;
  }

  if (c.ph !== 'proc') return;
  for (const f of Object.values(c.f)) {
    if (!f.avail || TERM.includes(f.st)) continue;
    saga(T, c, f);
    if (f.fail) {
      if (compensate(T, c, f)) { setF(T, c, f, 'failed'); failNotice(T, c, f); }
      continue;
    }
    if (f.cd && f.st === 'processing') setF(T, c, f, 'dispatched');
    if (f.dl && f.st === 'dispatched') setF(T, c, f, 'completed');
  }
  const fs = Object.values(c.f);
  if (fs.every(f => TERM.includes(f.st))) {
    const st = fs.some(f => f.st === 'completed') ? 'completed' : fs.some(f => f.st === 'failed') ? 'failed' : 'cancelled';
    setOrd(T, c, st);
    c.ph = 'end';
  }
}

function ready(T, c) {
  c.ph = 'proc';
  setOrd(T, c, 'processing');
  for (const f of Object.values(c.f)) if (f.avail) setF(T, c, f, 'processing');
}

function failNotice(T, c, f) {
  notify(T, c, 'fulfilment-failed', f.id, c.em, `Fulfilment ${f.id} failed and was refunded.`);
}

function obligation(T, c, id, dueMs, onDue) {
  if (c.ob.includes(id)) return;
  c.ob.push(id);
  T.up.push({ id, kind: 'deadline', anchor: c.p, dueAt: isoAms(dueMs), onDue });
}

// R4.2 steps of one fulfilment, each only after the previous one committed.
function saga(T, c, f) {
  if (stepPending(c, f.id)) return;
  const need = f.items.filter(it => f.rsv[it.sku] === 'no');
  if (need.length) {
    const kk = `~inventory.reserve|${f.id}`;
    if (!c.k[kk]) {
      T.fx.push({
        system: 'inventory', op: 'reserve', args: adapt(T, 'inventory', 'reserve', {
          orderId: c.o, fulfilmentId: f.id, location: f.loc,
          items: need.map(it => ({ key: `${c.o}:ri:${f.id}:${it.sku}`, sku: it.sku, qty: it.qty })),
        }),
      });
      c.k[kk] = ['rsv', f.id, null, 'pend'];
    }
    return;
  }
  if (f.items.some(it => f.rsv[it.sku] === 'bad')) { f.fail = true; return; }
  if (f.chg === 'no') {
    send(T, c, 'chg', f.id, null, 'billing', 'charge', {
      orderId: c.o, fulfilmentId: f.id, customerId: c.cu, amountMinor: f.amt, currency: c.cur,
    });
    return;
  }
  if (f.chg === 'declined' || f.chg === 'bad') { f.fail = true; return; }
  if (f.shp === 'no') {
    send(T, c, 'shp', f.id, null, 'carrier', 'create', { orderId: c.o, fulfilmentId: f.id, location: f.loc, ref: f.id });
    return;
  }
  if (f.shp === 'bad') f.fail = true;
}

// R5.1 compensation in reverse order. Returns true once nothing is left to undo.
function compensate(T, c, f) {
  if (stepPending(c, f.id)) return false;
  if (f.shp === 'ok' && f.shpc === 'no') {
    if (f.coll !== null || f.cf) f.shpc = f.cf ? 'na' : 'refused';
    else send(T, c, 'shpc', f.id, null, 'carrier', 'cancel', { orderId: c.o, fulfilmentId: f.id });
    if (f.shpc === 'no') return false;
  }
  if (f.shp !== 'ok' && f.shpc === 'no') f.shpc = 'na';
  if (f.chg === 'ok' && f.ref === 'no') {
    send(T, c, 'ref', f.id, null, 'billing', 'refund', { orderId: c.o, fulfilmentId: f.id, amountMinor: f.amt });
    return false;
  }
  if (f.chg !== 'ok' && f.ref === 'no') f.ref = 'na';
  for (const it of f.items) {
    if (f.rsv[it.sku] === 'ok' && !f.rel[it.sku]) f.rel[it.sku] = 'no';
  }
  for (const it of f.items) {
    if (f.rel[it.sku] === 'no') {
      send(T, c, 'rel', f.id, it.sku, 'inventory', 'release', { orderId: c.o, fulfilmentId: f.id, sku: it.sku });
      return false;
    }
  }
  return true;
}

// ---------- go-live (migration): rebuild the carry from the records that exist ----------

function fromRecords(T, e) {
  const o = norm(findKey(e.payload, 'orderId'));
  const ord = o ? queryRows(T, 'orders.orders', { orderId: o })[0] : null;
  if (!ord) return null;
  const c = newCarry(T, { at: ord.placedAt || e.at, payload: { orderId: o, customerId: ord.customerId, currency: ord.currency, items: ord.items, placedAt: ord.placedAt } });
  const rows = queryRows(T, 'orders.fulfilments', { orderId: o });
  const res = queryRows(T, 'inventory.reservations', { orderId: o });
  const charges = queryRows(T, 'billing.charges', { orderId: o });
  const refunds = queryRows(T, 'billing.refunds', { orderId: o });
  const ships = queryRows(T, 'carrier.shipments', { orderId: o });
  const placedMs = Date.parse(c.p);
  for (const r of rows) {
    const fid = String(r.fulfilmentId);
    const avail = r.location !== null && r.location !== undefined;
    const its = (r.items || []).map(i => ({ sku: String(i.sku), qty: Number(i.qty) }));
    const f = {
      id: fid, loc: avail ? String(r.location) : null, avail, items: its, amt: Number(r.amountMinor) || 0, st: r.status,
      rsv: Object.fromEntries(its.map(i => [i.sku, 'no'])), rel: {},
      chg: 'no', shp: 'no', shpc: 'no', ref: 'no', coll: null, cd: false, cf: false, dl: false, fail: false,
    };
    for (const x of res.filter(x => x.fulfilmentId === fid)) {
      if (x.status === 'active' && f.rsv[x.sku] !== undefined) f.rsv[x.sku] = 'ok';
      if (x.status === 'released' && f.rsv[x.sku] !== undefined) { f.rsv[x.sku] = 'ok'; f.rel[x.sku] = 'ok'; }
    }
    const ch = charges.find(x => x.fulfilmentId === fid);
    if (ch) f.chg = 'ok';
    if (ch && refunds.some(x => x.fulfilmentId === fid)) f.ref = 'ok';
    const sh = ships.find(x => x.fulfilmentId === fid);
    if (sh) {
      f.shp = 'ok';
      if (sh.status === 'cancelled') f.shpc = 'ok';
      if (['collected', 'inTransit', 'delivered'].includes(sh.status)) f.coll = placedMs;
      if (['collected', 'delivered'].includes(sh.status)) f.cd = true;
      if (sh.status === 'delivered') f.dl = true;
    }
    c.f[fid] = f;
  }
  c.al = Object.keys(c.f);
  c.rec = 'ok';
  c.ost = ord.status;
  if (ord.status === 'pending') return c;
  c.fd = 'pass';
  c.cl = c.p;
  if (ord.status === 'customerActionRequired') {
    c.ph = 'wait';
    c.D = isoAms(placedMs + c.A * 60 * MIN);
  } else if (ord.status === 'processing') {
    c.ph = 'proc';
  } else {
    c.ph = 'end';
  }
  return c;
}

// ---------- output ----------

function out(T, c, subject) {
  const o = { decisions: { subject }, effects: T.fx, obligations: { upsert: T.up, cancel: T.cancel }, humanTasks: T.ht, carry: c || {} };
  if (T.merge) o.merge = { into: T.merge };
  if (T.close) o.close = true;
  return o;
}
