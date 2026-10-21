// solver.mjs: E8 order fulfilment with compensation (SPEC-E.md), under the constitution (CONSTITUTION.md, C1-C3).
// One case-tick per call. All state lives in carry (JSON, well under 64 KB). Deterministic: time is input.now.
import { createHash } from 'node:crypto';

const MIN = 60_000;
const HOUR = 60 * MIN;
const RETRY_CAP = 6;
const ORDER_FINAL = new Set(['completed', 'failed', 'cancelled', 'timedOut']);
const FULFIL_TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const ORDER_RANK = { pending: 0, customerActionRequired: 1, processing: 2 };
const FULFIL_RANK = { unavailable: 0, pending: 0, processing: 1, dispatched: 2 };
const COLLECT_TYPES = new Set(['collected', 'inTransit', 'delivered']);
const OPS = {
  al: ['inventory', 'allocate'], fr: ['fraud', 'check'], cr: ['orders', 'create'], st: ['orders', 'setStatus'],
  ntf: ['notify', 'send'], res: ['inventory', 'reserve'], rel: ['inventory', 'release'], chg: ['billing', 'charge'],
  ref: ['billing', 'refund'], ship: ['carrier', 'create'], shc: ['carrier', 'cancel'],
};
const SYS_OF = { ri: 'inventory', rel: 'inventory', chg: 'billing', ref: 'billing', ship: 'carrier', shc: 'carrier', st: 'orders', cr: 'orders', ntf: 'notify' };
// kinds whose retry is re-sent by the planner's sweep; the others are re-sent by the step that needs them
const SWEEP = new Set(['al', 'fr', 'cr', 'st', 'ntf']);
const DECISION_SCHEMA = { type: 'object', required: ['decision'], additionalProperties: false, properties: { decision: { enum: ['approve', 'reject'] } } };
const AMS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });

// ---------- small helpers ----------
const ms = (x) => Date.parse(x);
const iso = (t) => new Date(t).toISOString();
const num = (x) => {
  if (typeof x === 'number') return Number.isFinite(x) ? x : undefined;
  if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x))) return Number(x);
  return undefined;
};
// SPEC-E 3.1: trim, drop a leading '#', upper-case
function normId(s) {
  let x = String(s ?? '').trim();
  while (x.startsWith('#')) x = x.slice(1).trim();
  return x.toUpperCase();
}
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '').replace('fulfillment', 'fulfilment');
const canon = (v) => {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
const sha = (s) => createHash('sha256').update(s).digest('hex');
const amsDate = (t) => AMS.format(new Date(t));
const money = (S, minor) => `${S.u} ${(minor / 100).toFixed(2)} (${minor} minor units)`;
const sortByKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------- files (ctx.files) ----------
function fileOf(ctx, path) {
  const files = ctx.files;
  let v = files && typeof files.get === 'function' ? files.get(path) : files?.[path];
  if (v && typeof v === 'object' && typeof v.content === 'string' && ('path' in v || 'encoding' in v)) v = v.content;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return undefined; }
  }
  return v;
}
function fileKeys(ctx) {
  const f = ctx.files;
  if (!f) return [];
  return typeof f.keys === 'function' ? [...f.keys()] : Object.keys(f);
}
// rows of a table: an array, or an object wrapping one, or a map keyed by id
function rowsOf(d) {
  if (Array.isArray(d)) return d;
  if (!d || typeof d !== 'object') return [];
  for (const k of ['rows', 'items', 'data', 'entries', 'list', 'values', 'records']) if (Array.isArray(d[k])) return d[k];
  const arrs = Object.values(d).filter(Array.isArray);
  if (arrs.length === 1) return arrs[0];
  return Object.entries(d).map(([k, v]) => (v && typeof v === 'object' ? { key: k, ...v } : { key: k, value: v }));
}
function findRow(d, fields, val) {
  const want = String(val);
  return rowsOf(d).find((r) => r && typeof r === 'object' && fields.some((f) => r[f] !== undefined && String(r[f]) === want));
}
function param(d, name) {
  if (!d || typeof d !== 'object') return undefined;
  if (d[name] !== undefined) return d[name];
  for (const k of ['parameters', 'params', 'policy']) if (d[k] && typeof d[k] === 'object' && d[k][name] !== undefined) return d[k][name];
  const r = findRow(d, ['name', 'parameter', 'key'], name);
  return r ? (r.value ?? r[name]) : undefined;
}
function q(ctx, table, where, limit = 200) {
  const r = ctx.query(table, { where, limit });
  return Array.isArray(r) ? r : (r?.rows ?? []);
}
function openOwners(ctx, oid, self) {
  const r = ctx.instances({ subject: oid });
  const arr = Array.isArray(r) ? r : (r?.instances ?? []);
  return arr.map((x) => (typeof x === 'string' ? x : (x?.instance ?? x?.id))).filter((x) => x && x !== self).sort(sortByKey);
}

// ---------- editions and tables (rulebook/, master/) ----------
function editions(ctx) {
  const out = [];
  for (const k of fileKeys(ctx)) {
    const m = /^rulebook\/([^/]+)\/edition\.json$/.exec(k);
    if (!m) continue;
    const e = fileOf(ctx, k);
    if (e && e.effectiveFrom) out.push({ dir: m[1], id: String(e.id ?? m[1]), from: String(e.effectiveFrom) });
  }
  return out;
}
// the edition in force at p: the latest effectiveFrom on or before the Amsterdam date of p (R1.3)
function editionAt(env, p) {
  const d = amsDate(p);
  let best = null;
  for (const e of env.eds) {
    const from = e.from.includes('T') ? amsDate(ms(e.from)) : e.from.slice(0, 10);
    if (from <= d && (!best || from > best.from)) best = { dir: e.dir, id: e.id, from };
  }
  return best;
}
function priceOf(env, sku) {
  const r = findRow(fileOf(env.ctx, 'master/catalog.json'), ['sku', 'key', 'id'], sku);
  return num(r?.unitPriceMinor ?? r?.unitPrice ?? r?.priceMinor ?? r?.price ?? r?.value) ?? 0;
}
function feeOf(env, dir, loc) {
  const r = findRow(fileOf(env.ctx, `rulebook/${dir}/shipping-fees.json`), ['location', 'key', 'id', 'code'], loc);
  return num(r?.feeMinor ?? r?.fee ?? r?.value) ?? 0;
}
function emailOf(env, cust) {
  const r = findRow(fileOf(env.ctx, 'master/customers.json'), ['customerId', 'id', 'key'], cust);
  return String(r?.email ?? cust);
}
// carrier-codes.json -> one of collected | inTransit | delivered | collectionFailed | info (unlisted: info)
function meaningOf(env, dir, carrier, code) {
  const d = fileOf(env.ctx, `rulebook/${dir}/carrier-codes.json`);
  let r;
  if (d && typeof d === 'object' && !Array.isArray(d) && d[carrier] && typeof d[carrier] === 'object') r = d[carrier][code];
  if (r === undefined) {
    const hit = rowsOf(d).find((x) => x && String(x.code ?? x.key) === String(code) && (x.carrier === undefined || x.carrier === carrier));
    r = hit ? (hit.meaning ?? hit.value ?? hit.status ?? hit.translation) : undefined;
  }
  if (r === undefined && d && typeof d === 'object' && !Array.isArray(d)) {
    const hit = Object.entries(d).find(([, v]) => Array.isArray(v) && v.includes(code));
    if (hit) r = hit[0];
  }
  if (r && typeof r === 'object') r = r.meaning;
  return typeof r === 'string' ? r : 'info';
}

// ---------- constitution registry (CONSTITUTION.md, C3 change rule) ----------
// A version is in force only if proposed by a finance/controller holder, approved before its effectiveFrom by a
// controller holder (under the version then in force) who is not the proposer, and within the bounds of its base.
function registry(ctx) {
  const log = fileOf(ctx, 'constitution/log.json');
  const entries = Array.isArray(log) ? log : [];
  const cands = [];
  for (const pr of entries) {
    if (pr?.type !== 'proposed') continue;
    const hash = String(pr.hash ?? '');
    const doc = fileOf(ctx, `constitution/versions/v${pr.version}-${hash.slice(0, 12)}.json`);
    if (!doc || typeof doc !== 'object' || sha(canon(doc)) !== hash) continue;
    cands.push({
      n: Number(pr.version), hash, by: pr.by, doc, from: ms(doc.effectiveFrom),
      apps: entries.filter((a) => a?.type === 'approval' && a.version === pr.version && a.hash === hash)
        .map((a) => ({ by: a.by, at: ms(a.at) })).sort((x, y) => x.at - y.at),
    });
  }
  cands.sort((a, b) => a.n - b.n);
  const valid = [];
  for (const c of cands) {
    if (c.apps.some((ap) => validApproval(c, ap, valid))) valid.push({ n: c.n, hash: c.hash, from: c.from, doc: c.doc });
  }
  return valid;
}
function validApproval(c, ap, valid) {
  if (!(ap.at < c.from)) return false;
  let base = inForceIn(valid, ap.at);
  if (!base) {
    if (c.n !== 1 || valid.length) return false;
    base = { doc: c.doc }; // genesis version: judged by its own principals
  }
  const change = base.doc.change ?? {};
  const proposerRoles = change.proposerRoles ?? ['finance', 'controller'];
  const approverRole = change.approverRole ?? 'controller';
  if (!rolesIn(base.doc, c.by).some((r) => proposerRoles.includes(r))) return false;
  if (!rolesIn(base.doc, ap.by).includes(approverRole) || ap.by === c.by) return false;
  for (const b of base.doc.bounds ?? []) {
    const v = c.doc.parameters?.[b.parameter];
    if (v !== undefined && (typeof v !== 'number' || v < b.min || v > b.max)) return false;
  }
  return true;
}
function inForceIn(valid, t) {
  return valid.filter((v) => v.from <= t).sort((a, b) => b.from - a.from || b.n - a.n)[0] ?? null;
}
function rolesIn(doc, id) {
  return doc?.principals?.find((p) => p.id === id)?.roles ?? [];
}
// the version pinned to an order placed at p (C3); T is the refund-approval threshold of that version (C2)
function pinAt(env, p) {
  const k = String(p);
  if (!env.pins.has(k)) {
    const v = inForceIn(env.reg, p);
    env.pins.set(k, { hash: v?.hash ?? null, T: num(v?.doc?.parameters?.refundApprovalThresholdMinor) ?? 0, doc: v?.doc ?? {} });
  }
  return env.pins.get(k);
}

// ---------- api schemas: argument names as the platform now shows them (F5 renames) ----------
function schemaArgs(env, system, op) {
  const k = `${system}.${op}`;
  if (!env.schemas.has(k)) {
    const s = fileOf(env.ctx, `api/${system}.schema.json`);
    env.schemas.set(k, s?.ops?.[op]?.args ?? null);
  }
  return env.schemas.get(k);
}
// a field the platform renamed (F5): match by normalised name, else by shared words and value type
const words = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
function typeOk(ps, x) {
  const t = ps?.type;
  if (!t) return true;
  const types = Array.isArray(t) ? t : [t];
  const kind = x === null ? 'null' : Number.isInteger(x) ? 'integer' : typeof x;
  return types.includes(kind) || (kind === 'integer' && types.includes('number')) || (x === null && types.includes('null'));
}
function mapName(k, props, obj) {
  const names = Object.keys(props);
  const exact = names.find((n) => norm(n) === norm(k));
  if (exact) return exact;
  const free = names.filter((n) => !(n in obj) && typeOk(props[n], obj[k]));
  const kw = words(k);
  const scored = free.map((n) => ({ n, s: words(n).filter((w) => kw.includes(w)).length })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  if (scored.length) return scored[0].n;
  return free.length === 1 ? free[0] : null;
}
function fit(schema, v) {
  if (Array.isArray(v)) return v.map((x) => fit(schema?.items, x));
  if (!v || typeof v !== 'object') return v;
  const props = schema?.properties ?? null;
  const out = {};
  for (const k of Object.keys(v)) {
    if (v[k] === undefined) continue;
    let name = k;
    if (props && !(k in props)) name = mapName(k, props, v) ?? k;
    out[name] = fit(props ? props[name] : undefined, v[k]);
  }
  return out;
}

// ---------- effect results ----------
function errInfo(x) {
  const e = x?.error;
  const code = String(typeof e === 'string' ? e : (e?.code ?? x?.code ?? ''));
  let retryable;
  if (e && typeof e === 'object' && 'retryable' in e) retryable = !!e.retryable;
  else if (x && 'retryable' in x) retryable = !!x.retryable;
  // an HTTP status may be given as a field or as the code's prefix ("503 batch-item-not-processed")
  const http = Number(e?.http ?? e?.httpStatus ?? x?.httpStatus ?? (/^(\d{3})\b/.exec(code)?.[1] ?? NaN));
  if (retryable === undefined && (http === 429 || http >= 500)) retryable = true;
  return {
    code,
    retryable,
    invalid: /invalid-args|field-renamed/.test(code) || http === 400,
  };
}
function findPlan(r) {
  for (const b of [r, r.result, r.value, r.data, r.output, r.plan]) {
    if (!b || typeof b !== 'object') continue;
    if (Array.isArray(b.fulfilments)) return b.fulfilments;
    if (b.plan && Array.isArray(b.plan.fulfilments)) return b.plan.fulfilments;
    if (Array.isArray(b.items) && b.items.length && b.items[0] && b.items[0].fulfilmentId !== undefined) return b.items;
  }
  return null;
}
function findVerdict(r) {
  for (const b of [r, r.result, r.value, r.data, r.output]) if (b && typeof b === 'object' && b.verdict !== undefined) return b.verdict;
  return undefined;
}

// ---------- keys (one per logical effect; reused by every attempt) ----------
const itemKey = (S, f, i) => `${S.o}|${f}|r${i}`;
const relKey = (S, f, i) => `${S.o}|${f}|rel${i}`;
const chgKey = (S, f) => `${S.o}|${f}|chg`;
const shipKey = (S, f) => `${S.o}|${f}|ship`;
const shcKey = (S, f) => `${S.o}|${f}|shc`;
const refKey = (S, f) => `${S.o}|${f}|ref`;
function queueKey(S, qi) {
  if (qi.k === 'st') return `${S.o}|s|${qi.f ?? '-'}|${qi.t}`;
  if (qi.t === 'cancel-refused') return `${S.o}|n|cr|${qi.id}`;
  return `${S.o}|n|${qi.t}|${qi.a}`;
}

// ---------- state changes (forward only; each status set once) ----------
const fl = (S) => S.fo.map((id) => S.f[id]);
const purge = (S, mv) => { S.q = S.q.filter((x) => x.mv !== mv); };

function setO(S, status, mv) {
  if (ORDER_FINAL.has(S.os)) return;
  if (!ORDER_FINAL.has(status) && (ORDER_RANK[status] ?? 9) <= (ORDER_RANK[S.os] ?? -1)) return;
  S.os = status;
  S.q.push({ k: 'st', f: null, t: status, mv: mv ?? null });
}
function setF(S, id, status, mv) {
  const f = S.f[id];
  if (!f || FULFIL_TERMINAL.has(f.st)) return;
  if (!FULFIL_TERMINAL.has(status) && (FULFIL_RANK[status] ?? 9) <= (FULFIL_RANK[f.st] ?? -1)) return;
  f.st = status;
  S.q.push({ k: 'st', f: id, t: status, mv: mv ?? null });
}
function failF(S, id) {
  const f = S.f[id];
  if (!f || FULFIL_TERMINAL.has(f.st)) return;
  setF(S, id, 'failed');
  f.comp = true;
  S.q.push({ k: 'ntf', t: 'fulfilment-failed', a: id, f: id, mv: null });
}
// a cancel (or fraud reject, or timeout of an unanswered review) decided: nothing new is booked from here on
function decideCancel(S, t) {
  if (S.dec) return;
  S.dec = { k: 'cancel', at: t };
  purge(S, 'r31');
  purge(S, 'ready');
  for (const f of fl(S)) {
    if (!FULFIL_TERMINAL.has(f.st)) { setF(S, f.id, 'cancelled'); f.comp = true; }
  }
  setO(S, 'cancelled');
  S.q.push({ k: 'ntf', t: 'order-cancelled', a: S.o, mv: null });
}
function decideTimeout(S, t) {
  if (S.dec) return;
  S.dec = { k: 'timeout', at: t };
  for (const f of fl(S)) {
    if (!FULFIL_TERMINAL.has(f.st)) { setF(S, f.id, 'cancelled'); f.comp = true; }
  }
  setO(S, 'timedOut');
  S.q.push({ k: 'ntf', t: 'order-timed-out', a: S.o, mv: null });
}
function enterReady(S, t) {
  S.stg = 'ready';
  S.rd = t;
  setO(S, 'processing', 'ready');
  for (const f of fl(S)) if (f.av) setF(S, f.id, 'processing', 'ready');
}
// a counted amend (R3.2): unavailable items go, the rest proceed, ready at max(a, cleared)
function amendNow(S, a) {
  S.amd = true;
  purge(S, 'r31');
  for (const f of fl(S)) if (!f.av) setF(S, f.id, 'cancelled');
  if (!fl(S).some((f) => f.av)) { decideCancel(S, a); return; }
  enterReady(S, Math.max(a, S.cl));
}
// cleared (R2) and the customer's window (R3): drives the stage, the time-based decisions only at the tick end
function progress(S, t, final) {
  if (S.dec || ORDER_FINAL.has(S.os)) return;
  if (S.cl == null) {
    if (S.fr === 'pass') S.cl = S.p;
    else if (S.rv && S.rv.ans === 'approve') S.cl = S.rv.at;
    else if (final && S.fr === 'review' && S.rv && !S.rv.ans && t > S.rv.dl) { decideCancel(S, t); return; }
    else return;
  }
  if (!S.fo.length) return; // allocation not known yet
  if (!S.stg) {
    if (fl(S).some((f) => !f.av)) {
      if (S.am != null) amendNow(S, S.am);
      else {
        S.stg = 'wait';
        setO(S, 'customerActionRequired', 'r31');
        S.q.push({ k: 'ntf', t: 'action-required', a: S.o, mv: 'r31' });
      }
    } else {
      enterReady(S, S.cl);
    }
  }
  if (!final || S.dec) return;
  if (S.stg === 'wait' && t > S.D) { decideTimeout(S, t); return; }
  if (S.stg === 'ready' && S.os === 'processing') {
    const fs = fl(S);
    if (fs.every((f) => FULFIL_TERMINAL.has(f.st))) {
      setO(S, fs.some((f) => f.st === 'completed') ? 'completed' : fs.some((f) => f.st === 'failed') ? 'failed' : 'cancelled');
    }
  }
}

// ---------- events ----------
function newOrder(env, oid, p, pl) {
  const pin = pinAt(env, p);
  const ed = editionAt(env, p);
  const pol = ed ? fileOf(env.ctx, `rulebook/${ed.dir}/policy.json`) : undefined;
  const fh = num(param(pol, 'fraudReviewHours')) ?? 24;
  const ah = num(param(pol, 'customerActionHours')) ?? 48;
  return {
    v: 1, o: oid, c: String(pl.customerId ?? ''), u: String(pl.currency ?? 'EUR'), p,
    it: (Array.isArray(pl.items) ? pl.items : []).map((x) => ({ sku: x.sku, qty: x.qty })),
    ed: ed?.dir ?? null, fh, ah, D: p + ah * HOUR, hp: pin.hash, T: pin.T,
    fo: [], f: {}, E: {}, q: [], tot: 0,
    os: 'pending', stg: null, cl: null, am: null, amd: false, rd: null, dec: null,
    fr: null, rv: null, ex: [], aid: [], tm: [], rc: false,
  };
}
function onPlan(S, plan, env) {
  if (S.fo.length) return;
  for (const pf of plan) {
    const id = String(pf.fulfilmentId);
    const loc = pf.location ?? null;
    const items = (Array.isArray(pf.items) ? pf.items : []).map((x) => ({ sku: x.sku, qty: x.qty }));
    const av = loc !== null && pf.available !== false;
    let amt = 0;
    for (const it of items) amt += (num(it.qty) ?? 0) * priceOf(env, it.sku);
    if (loc !== null) amt += feeOf(env, S.ed, loc); // R1.2: the fee only when a location is set
    S.f[id] = { id, l: loc, it: items, a: amt, av, st: av ? 'pending' : 'unavailable', col: null, cf: false, comp: false };
    S.fo.push(id);
  }
  S.tot = fl(S).reduce((s, f) => s + f.a, 0);
  if (S.dec) for (const f of fl(S)) if (!FULFIL_TERMINAL.has(f.st)) { setF(S, f.id, 'cancelled'); f.comp = true; }
}
function onFraud(S, verdict, t) {
  if (S.fr != null) return;
  S.fr = verdict;
  if (S.dec) return;
  if (verdict === 'reject') decideCancel(S, t);
  else if (verdict === 'review') S.rv = { n: 1, tk: `${S.o}|rv|1`, em: false, dl: t + S.fh * HOUR, ans: null, at: null, re: false };
}
function onBatch(S, e, r) {
  const f = S.f[e.f];
  const items = Array.isArray(r.items) ? r.items : null;
  const x = errInfo(r);
  for (const i of e.ix) {
    const ik = itemKey(S, e.f, i);
    const it = S.E[ik];
    if (!it) continue;
    let s;
    if (r.status === 'ok') s = 'ok';
    else if (r.status === 'unknown') s = 'unk';
    else if (r.status === 'rate-limited') s = 'retry';
    else if (items) {
      const res = items.find((z) => z && z.key === ik) ?? items.find((z) => z && z.key === undefined && z.sku === f.it[i].sku);
      if (!res) s = 'unk';
      else if (res.status === 'ok') s = 'ok';
      else if (res.status === 'unknown') s = 'unk';
      else { const y = errInfo(res); s = (y.invalid || y.retryable === true) ? 'retry' : 'err'; }
    } else if (r.status === 'error') s = (x.invalid || x.retryable === true) ? 'retry' : 'err';
    else s = 'unk';
    it.s = s;
  }
  e.s = 'done';
}
function onResult(S, ev, env) {
  const r = ev.payload ?? {};
  let key = r.key ?? ev.key;
  if (key === undefined && Array.isArray(r.items) && r.items.length) {
    // a batch result carries its items' keys; the batch is the one those items were sent in
    const ie = S.E[r.items[0]?.key];
    if (ie && ie.k === 'ri') key = ie.b;
  }
  const e = S.E[key];
  if (!e) return;
  if (e.k === 'res') return onBatch(S, e, r);
  const st = r.status;
  if (st === 'ok') {
    if (e.k === 'al') {
      const plan = findPlan(r);
      if (!plan) { e.s = 'retry'; return; }
      e.s = 'ok';
      return onPlan(S, plan, env);
    }
    if (e.k === 'fr') {
      const v = findVerdict(r);
      if (!['pass', 'review', 'reject'].includes(v)) { e.s = 'retry'; return; }
      e.s = 'ok';
      return onFraud(S, v, ms(ev.at));
    }
    e.s = 'ok';
    return;
  }
  if (st === 'unknown') { e.s = 'unk'; return; }
  if (st === 'rate-limited') { e.s = 'retry'; return; }
  if (st === 'error') {
    const x = errInfo(r);
    if (x.invalid || x.retryable === true) e.s = 'retry';
    else { e.s = 'err'; e.code = x.code; }
  }
}
function onCarrier(S, ev, env) {
  const p = ev.payload ?? {};
  const id = String(p.fulfilmentRef ?? '');
  const f = S.f[id];
  if (!f) return;
  const m = meaningOf(env, S.ed, p.carrier, p.code);
  if (COLLECT_TYPES.has(m)) {
    const rep = ms(p.reportedAt ?? ev.at);
    if (f.col == null || rep < f.col) f.col = rep;
  }
  if (m === 'collected') {
    if (f.st === 'processing') setF(S, id, 'dispatched');
  } else if (m === 'delivered') {
    if (f.st === 'processing') setF(S, id, 'dispatched');
    if (f.st === 'dispatched') setF(S, id, 'completed');
  } else if (m === 'collectionFailed') {
    if (f.st === 'processing' && !S.dec) { f.cf = true; failF(S, id); }
  }
}
function collectedBy(S, a) {
  return fl(S).some((f) => f.col != null && f.col <= a);
}
function onAction(S, ev) {
  const p = ev.payload ?? {};
  const dk = `${p.action}@${ev.at}|${p.enteredBy ?? ''}`;
  if (S.aid.includes(dk)) return;
  S.aid.push(dk);
  const by = typeof p.enteredBy === 'string' ? p.enteredBy : null;
  if (by && !by.startsWith('cust:') && !S.ex.includes(by)) S.ex.push(by);
  const a = ms(ev.at);
  if (p.action === 'cancel') onCancel(S, dk, a);
  else if (p.action === 'amend') onAmend(S, a);
}
// R3.2: the first amend or cancel at or before D counts; R6.2 / R6.4 for cancels after
function onAmend(S, a) {
  if (S.dec || ORDER_FINAL.has(S.os)) return;
  if (a > S.D) return;
  if (S.am == null) S.am = a;
  if (S.stg === 'wait' && !S.amd) amendNow(S, a);
}
function onCancel(S, dk, a) {
  if (S.dec) return;
  if (ORDER_FINAL.has(S.os) && S.os !== 'completed') return;
  if (S.cl == null) { decideCancel(S, a); return; }                  // R6.4: not yet cleared
  if (S.stg === 'wait') { if (a <= S.D) decideCancel(S, a); return; } // R3.2
  if (S.stg === 'ready' || S.os === 'completed') {                  // R6.2 / R6.3
    if (collectedBy(S, a)) S.q.push({ k: 'ntf', t: 'cancel-refused', a: S.o, id: dk, mv: null });
    else if (fl(S).every((f) => FULFIL_TERMINAL.has(f.st))) return; // S13: the order has already ended
    else decideCancel(S, a);
  }
}
function eligible(env, S, user, kind) {
  if (typeof user !== 'string' || !user || user.startsWith('cust:') || S.ex.includes(user)) return false;
  return rolesIn(pinAt(env, S.p).doc, user).includes(kind === 'bg' ? 'controller' : 'finance-approver');
}
function onReviewAnswer(S, p, kind, t) {
  const rv = S.rv;
  rv.tk = null;
  if (S.dec || rv.ans) return;
  if (t > rv.dl) return; // late: the deadline decides (R2.2)
  if (kind === 'answered') {
    const d = p.answer?.decision;
    if (d === 'approve' || d === 'reject') {
      rv.ans = d;
      rv.at = t;
      if (d === 'reject') decideCancel(S, t);
      return;
    }
    rv.re = true; // unusable: ask again with the same deadline
    return;
  }
  if (kind === 'timeout') return;
  rv.re = true; // rejected by the schema, or withdrawn
}
function onRefundAnswer(S, f, p, kind, env) {
  const ap = f.ap;
  ap.tk = null;
  if (kind === 'answered' && p.answer?.decision === 'approve' && eligible(env, S, p.user, ap.kind)) { ap.ok = true; return; }
  ap.em = false; // not usable: the next request goes out in the planner
}
// the task an answer or timeout belongs to: the open task whose id the event carries
function onAnswer(S, ev, env, kind) {
  const p = ev.payload ?? {};
  const txt = JSON.stringify(p);
  const open = [S.rv?.tk, ...fl(S).map((f) => f.ap?.tk)].filter(Boolean);
  const tid = open.find((id) => txt.includes(JSON.stringify(id)));
  if (!tid) return;
  const t = ms(ev.at);
  if (S.rv && S.rv.tk === tid) return onReviewAnswer(S, p, kind, t);
  const f = fl(S).find((x) => x.ap && x.ap.tk === tid);
  if (f) onRefundAnswer(S, f, p, kind, env);
}
function handleEvent(S, ev, env) {
  switch (ev.type) {
    case 'effect.result': return onResult(S, ev, env);
    case 'carrier.status': return onCarrier(S, ev, env);
    case 'customer.action': return onAction(S, ev);
    case 'humanTask.answered': return onAnswer(S, ev, env, 'answered');
    case 'humanTask.answerRejected': return onAnswer(S, ev, env, 'rejected');
    case 'humanTask.withdrawn': return onAnswer(S, ev, env, 'withdrawn');
    case 'humanTask.timeout': return onAnswer(S, ev, env, 'timeout');
    default: return; // timers are handled by progress; order.placed duplicates change nothing
  }
}

// ---------- emission ----------
function argsOf(S, env, e) {
  switch (e.k) {
    case 'al': case 'fr': return { orderId: S.o };
    case 'cr': return {
      orderId: S.o, customerId: S.c, placedAt: iso(S.p), currency: S.u, items: S.it,
      fulfilments: fl(S).map((f) => ({ fulfilmentId: f.id, location: f.l, items: f.it, amountMinor: f.a })),
      totalMinor: S.tot,
    };
    case 'st': return { orderId: S.o, fulfilmentId: e.f ?? null, status: e.t };
    case 'ntf': return { to: emailOf(env, S.c), about: e.a ?? null, template: e.t, text: noticeText(S, e) };
    case 'rel': return { orderId: S.o, fulfilmentId: e.f, sku: S.f[e.f].it[e.i].sku };
    case 'chg': return { orderId: S.o, fulfilmentId: e.f, customerId: S.c, amountMinor: S.f[e.f].a, currency: S.u };
    case 'ref': return { orderId: S.o, fulfilmentId: e.f, amountMinor: S.f[e.f].a };
    case 'ship': return { orderId: S.o, fulfilmentId: e.f, location: S.f[e.f].l, ref: `${S.o}/${e.f}` };
    case 'shc': return { orderId: S.o, fulfilmentId: e.f };
    default: return {};
  }
}
function noticeText(S, e) {
  switch (e.t) {
    case 'action-required': return `Some items in order ${S.o} are unavailable. Amend or cancel the order by ${iso(S.D)}.`;
    case 'order-cancelled': return `Your order ${S.o} has been cancelled.`;
    case 'order-timed-out': return `Your order ${S.o} was not confirmed in time and has been closed.`;
    case 'fulfilment-failed': return `Part of your order ${S.o} (${e.a}) could not be fulfilled.`;
    case 'cancel-refused': return `Your order ${S.o} has already been collected by the carrier and can no longer be cancelled.`;
    default: return `Order ${S.o}.`;
  }
}
// emit an effect unless it was already emitted (a retry, after an error, is emitted again with the same key)
function fire(S, out, env, key, kind, extra) {
  const e = S.E[key];
  if (e && e.s !== 'retry') return false;
  const n = (e?.n ?? 0) + 1;
  if (n > RETRY_CAP) { S.E[key] = { ...e, k: kind, s: 'err', code: 'gave-up' }; return false; }
  const ent = { ...(e ?? {}), ...(extra ?? {}), k: kind, s: 'em', n };
  delete ent.code;
  S.E[key] = ent;
  const [system, op] = OPS[kind];
  const eff = { key, system, op, args: fit(schemaArgs(env, system, op), argsOf(S, env, ent)) };
  if (kind === 'ref') eff.compensates = chgKey(S, ent.f);
  if (kind === 'shc') eff.compensates = shipKey(S, ent.f);
  if (kind === 'rel') eff.compensates = itemKey(S, ent.f, ent.i);
  out.effects.push(eff);
  return true;
}
// R4.2 reserve: one batch for the items listed in ixs, each with its own item key
function emitBatch(S, out, env, f, ixs) {
  f.bn = (f.bn ?? 0) + 1;
  const bk = `${S.o}|${f.id}|b${f.bn}`;
  S.E[bk] = { k: 'res', f: f.id, ix: ixs, s: 'em', n: 1 };
  for (const i of ixs) {
    const ik = itemKey(S, f.id, i);
    S.E[ik] = { k: 'ri', f: f.id, i, b: bk, s: 'em', n: (S.E[ik]?.n ?? 0) + 1 };
  }
  const [system, op] = OPS.res;
  const args = fit(schemaArgs(env, system, op), {
    orderId: S.o, fulfilmentId: f.id, location: f.l,
    items: ixs.map((i) => ({ key: itemKey(S, f.id, i), sku: f.it[i].sku, qty: f.it[i].qty })),
  });
  // a batch op is keyed by its items, not by the batch: no top-level key
  out.effects.push({ system, op, args });
}
// R4.2 steps of one available fulfilment: reserve (per item), then charge, then ship
function stepsFor(S, out, env, f) {
  if (!f.av || f.st !== 'processing' || S.dec) return;
  const keys = f.it.map((_, i) => itemKey(S, f.id, i));
  const states = keys.map((k) => S.E[k]?.s);
  if (states.some((s) => s === 'err') || keys.some((k) => S.E[k]?.s === 'retry' && S.E[k].n >= RETRY_CAP)) {
    failF(S, f.id);
    return;
  }
  const need = f.it.map((_, i) => i).filter((i) => !S.E[keys[i]] || S.E[keys[i]].s === 'retry');
  const busy = states.some((s) => s === 'em' || s === 'unk');
  if (need.length && !busy) emitBatch(S, out, env, f, need);
  if (!states.every((s) => s === 'ok')) return;
  const ck = chgKey(S, f.id);
  fire(S, out, env, ck, 'chg', { f: f.id });
  const c = S.E[ck];
  if (!c) return;
  if (c.s === 'err') { failF(S, f.id); return; }
  if (c.s !== 'ok') return;
  const sk = shipKey(S, f.id);
  fire(S, out, env, sk, 'ship', { f: f.id });
  if (S.E[sk]?.s === 'err') failF(S, f.id);
}
// C2: a refund above T is applied only after a finance-approver approves a refundApproval task (C2-X1 after three)
function approvalStep(S, out, env, f) {
  const ap = f.ap ?? (f.ap = { rq: 0, bgUsed: false, ok: false, tk: null, em: false, kind: null });
  if (ap.ok) return;
  if (!ap.tk) {
    if (ap.rq < 3) { ap.rq += 1; ap.kind = 'std'; ap.tk = `${S.o}|ap|${f.id}|${ap.rq}`; ap.em = false; }
    else if (!ap.bgUsed) { ap.bgUsed = true; ap.kind = 'bg'; ap.tk = `${S.o}|ap|${f.id}|bg`; ap.em = false; }
    else return;
  }
  if (ap.em) return;
  ap.em = true;
  const bg = ap.kind === 'bg';
  const question = bg
    ? `Break-glass (C2-X1): no valid finance approval after three requests. Justification: refund of ${money(S, f.a)} for fulfilment ${f.id} of order ${S.o} is needed to return the captured charge (C1).`
    : `Approve refund of ${money(S, f.a)} for fulfilment ${f.id} of order ${S.o}. Approver must not have entered an amend or cancel of this order.`;
  out.humanTasks.push({
    id: ap.tk, kind: 'refundApproval', role: bg ? 'controller' : 'finance-approver',
    excludeUsers: S.ex.slice(), subject: f.id, question, answerSchema: DECISION_SCHEMA,
    dueAt: iso(env.now + 24 * HOUR), onTimeout: { action: 'escalate' },
  });
}
// C1 / R5.1: compensate in reverse order: shipment cancel, refund, then release each reserved item
function undoFor(S, out, env, f) {
  const sp = S.E[shipKey(S, f.id)];
  const cg = S.E[chgKey(S, f.id)];
  const rk = refKey(S, f.id);
  const hk = shcKey(S, f.id);
  const settled = (e) => !e || ['ok', 'err', 'retry', 'done'].includes(e.s);
  const shipOk = sp?.s === 'ok';
  const shcNeeded = shipOk && !f.cf;
  if (shcNeeded) fire(S, out, env, hk, 'shc', { f: f.id });
  const hc = S.E[hk];
  const shcDone = !shcNeeded || (hc && ['ok', 'err'].includes(hc.s));
  if (cg?.s === 'ok') {
    if (f.a > S.T && !(f.ap && f.ap.ok)) approvalStep(S, out, env, f);
    else fire(S, out, env, rk, 'ref', { f: f.id });
  }
  const rf = S.E[rk];
  const refDone = cg?.s !== 'ok' || (rf && ['ok', 'err'].includes(rf.s));
  const shipSettled = !sp || ['ok', 'err', 'retry'].includes(sp.s);
  const itemsSettled = f.it.every((_, i) => settled(S.E[itemKey(S, f.id, i)]));
  if (!shipSettled || !shcDone || !settled(cg) || !refDone || !itemsSettled) return;
  f.it.forEach((_, i) => {
    if (S.E[itemKey(S, f.id, i)]?.s === 'ok') fire(S, out, env, relKey(S, f.id, i), 'rel', { f: f.id, i });
  });
}
function resolveUnknown(S, env) {
  for (const [key, e] of Object.entries(S.E)) {
    if (e.s !== 'unk') continue;
    if (e.k === 'al' || e.k === 'fr') { e.s = 'retry'; continue; } // read-only, no status: ask again
    const sys = SYS_OF[e.k];
    if (!sys) continue;
    let st;
    try { st = env.ctx.status(sys, key); } catch { st = 'pending'; }
    if (st === 'committed') e.s = 'ok';
    else if (st === 'not-found') e.s = 'retry';
    else S.rc = true; // still pending: look again later
  }
}
function flushQueue(S, out, env) {
  const rank = (x) => (x.k === 'st' ? (x.f ? 0 : 1) : 2);
  const items = S.q.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i).map((y) => y.x);
  S.q = [];
  for (const x of items) {
    const key = queueKey(S, x);
    if (S.E[key]) continue;
    if (x.k === 'st') fire(S, out, env, key, 'st', { f: x.f, t: x.t });
    else fire(S, out, env, key, 'ntf', { t: x.t, a: x.a, id: x.id });
  }
}
function reviewStep(S, out, env, now) {
  const rv = S.rv;
  if (!rv || S.dec || S.fr !== 'review' || rv.ans) return;
  if (rv.re && !rv.tk && now < rv.dl) { rv.n += 1; rv.tk = `${S.o}|rv|${rv.n}`; rv.em = false; rv.re = false; }
  if (rv.tk && !rv.em) {
    rv.em = true;
    out.humanTasks.push({
      id: rv.tk, kind: 'fraudReview', role: 'fraudAnalyst', subject: S.o,
      question: `Fraud review of order ${S.o} (customer ${S.c}, ${money(S, S.tot)}): approve or reject.`,
      answerSchema: DECISION_SCHEMA, dueAt: iso(rv.dl), onTimeout: { action: 'escalate' },
    });
  }
}
function obligations(S, out, now) {
  const want = {};
  if (S.rv && S.fr === 'review' && !S.rv.ans && !S.dec && S.cl == null) {
    want[`${S.o}|rv`] = { dueAt: S.rv.dl + MIN, anchor: S.rv.dl - S.fh * HOUR, onDue: 'review-deadline' };
  }
  if (S.stg === 'wait' && !S.dec) want[`${S.o}|ac`] = { dueAt: S.D + MIN, anchor: S.p, onDue: 'action-deadline' };
  if (S.rc) want[`${S.o}|rc`] = { dueAt: now + 2 * MIN, anchor: now, onDue: 'recheck' };
  const ids = Object.keys(want);
  for (const id of S.tm) if (!ids.includes(id)) out.obligations.cancel.push(id);
  for (const id of ids) out.obligations.upsert.push({ id, kind: 'timer', anchor: iso(want[id].anchor), dueAt: iso(want[id].dueAt), onDue: want[id].onDue });
  S.tm = ids;
}
function busy(S) {
  if (Object.values(S.E).some((e) => e.s === 'em' || e.s === 'unk')) return true;
  if (S.q.length) return true;
  if (fl(S).some((f) => f.ap && f.ap.tk)) return true;
  return fl(S).some((f) => {
    if (!f.comp) return false;
    const sp = S.E[shipKey(S, f.id)];
    const cg = S.E[chgKey(S, f.id)];
    if (sp?.s === 'ok' && !f.cf && !S.E[shcKey(S, f.id)]) return true;
    if (cg?.s === 'ok' && !S.E[refKey(S, f.id)]) return true;
    return f.it.some((_, i) => S.E[itemKey(S, f.id, i)]?.s === 'ok' && !S.E[relKey(S, f.id, i)]);
  });
}
function plan(S, env, out) {
  S.rc = false;
  resolveUnknown(S, env);
  fire(S, out, env, `${S.o}|al`, 'al');
  fire(S, out, env, `${S.o}|fr`, 'fr');
  if (S.E[`${S.o}|al`]?.s === 'ok') fire(S, out, env, `${S.o}|cr`, 'cr');
  for (const [key, e] of Object.entries(S.E)) {
    if (e.s === 'retry' && SWEEP.has(e.k)) fire(S, out, env, key, e.k);
  }
  if (S.E[`${S.o}|cr`]?.s === 'ok') {
    flushQueue(S, out, env);
    for (const f of fl(S)) stepsFor(S, out, env, f);
  }
  for (const f of fl(S)) if (f.comp) undoFor(S, out, env, f);
  reviewStep(S, out, env, env.now);
  obligations(S, out, env.now);
}

// ---------- instance start (first tick) ----------
function startInstance(input, ctx, env, ev0, rest, out) {
  const at = ev0.at;
  const pl = ev0.payload ?? {};
  if (ev0.type === 'order.placed') {
    const oid = normId(pl.orderId);
    const owners = openOwners(ctx, oid, input.instance);
    if (owners.length) return merged(out, env, oid, owners[0], at);
    if (q(ctx, 'orders.orders', { orderId: oid }, 1).length) return closed(out, env, oid, at); // R1.4 duplicate
    const p = ms(pl.placedAt ?? ev0.at);
    return { S: newOrder(env, oid, p, pl), rest };
  }
  if (ev0.type === 'customer.action') {
    const oid = normId(pl.orderRef);
    const owners = openOwners(ctx, oid, input.instance);
    if (owners.length) return merged(out, env, oid, owners[0], at);
    return closed(out, env, q(ctx, 'orders.orders', { orderId: oid }, 1).length ? oid : null, at); // S11 / 3.2
  }
  if (ev0.type === 'carrier.status') {
    const hit = q(ctx, 'orders.fulfilments', { fulfilmentId: String(pl.fulfilmentRef ?? '') }, 1)[0];
    const oid = hit ? normId(hit.orderId) : null;
    const owners = oid ? openOwners(ctx, oid, input.instance) : [];
    if (owners.length) return merged(out, env, oid, owners[0], at);
    return closed(out, env, oid, at);
  }
  if (ev0.type === 'migration') {
    const S = fromMigration(env, ev0);
    return S ? { S, rest } : closed(out, env, null, at);
  }
  return closed(out, env, null, at);
}
// the subject's pin (C3) on a tick that only merges or closes: placedAt from the record, else the event
function pinDecision(env, oid, fallbackAt) {
  if (!oid) return { subject: null };
  const rec = q(env.ctx, 'orders.orders', { orderId: oid }, 1)[0];
  const t = rec?.placedAt ? ms(rec.placedAt) : ms(fallbackAt);
  const hash = pinAt(env, t).hash;
  return { subject: oid, ...(hash ? { constitution: { pins: { [oid]: hash } } } : {}) };
}
function merged(out, env, oid, into, at) {
  out.decisions = pinDecision(env, oid, at);
  out.merge = { into };
  out.carry = { v: 1, m: oid };
  return { done: true };
}
function closed(out, env, oid, at) {
  out.decisions = pinDecision(env, oid, at);
  out.close = true;
  out.carry = { v: 1, x: oid };
  return { done: true };
}
// go-live (3.5): continue from the records that exist for the order
function fromMigration(env, ev) {
  const ctx = env.ctx;
  const pl = ev.payload ?? {};
  const oid = normId(pl.orderId ?? pl.order?.orderId);
  if (!oid) return null;
  const ord = q(ctx, 'orders.orders', { orderId: oid }, 1)[0] ?? {};
  const p = ms(ord.placedAt ?? pl.placedAt ?? ev.at);
  const S = newOrder(env, oid, p, { customerId: ord.customerId ?? pl.customerId, currency: ord.currency ?? pl.currency, items: ord.items ?? pl.items });
  S.E[`${oid}|al`] = { k: 'al', s: 'ok', n: 1 };
  S.E[`${oid}|cr`] = { k: 'cr', s: 'ok', n: 1 };
  for (const fr of q(ctx, 'orders.fulfilments', { orderId: oid })) {
    const id = String(fr.fulfilmentId);
    const loc = fr.location ?? null;
    const st = fr.status ?? 'pending';
    S.f[id] = {
      id, l: loc, it: (fr.items ?? []).map((x) => ({ sku: x.sku, qty: x.qty })), a: num(fr.amountMinor) ?? 0,
      av: st !== 'unavailable' && loc !== null, st: st === 'pending' && loc !== null && ord.status === 'processing' ? 'processing' : st,
      col: null, cf: st === 'failed', comp: ['failed', 'cancelled'].includes(st),
    };
    S.fo.push(id);
  }
  S.tot = fl(S).reduce((s, f) => s + f.a, 0);
  for (const r of q(ctx, 'inventory.reservations', { orderId: oid }, 500)) {
    const f = S.f[r.fulfilmentId];
    if (!f) continue;
    const i = f.it.findIndex((x, j) => x.sku === r.sku && !S.E[itemKey(S, f.id, j)]);
    if (i < 0) continue;
    S.E[itemKey(S, f.id, i)] = { k: 'ri', f: f.id, i, s: 'ok', n: 1 };
    if (r.status === 'released') S.E[relKey(S, f.id, i)] = { k: 'rel', f: f.id, i, s: 'ok', n: 1 };
  }
  for (const c of q(ctx, 'billing.charges', { orderId: oid }, 500)) {
    const f = S.f[c.fulfilmentId];
    if (f) S.E[chgKey(S, f.id)] = { k: 'chg', f: f.id, s: 'ok', n: 1 };
  }
  for (const r of q(ctx, 'billing.refunds', { orderId: oid }, 500)) {
    const f = S.f[r.fulfilmentId];
    if (f) S.E[refKey(S, f.id)] = { k: 'ref', f: f.id, s: 'ok', n: 1 };
  }
  for (const sh of q(ctx, 'carrier.shipments', { orderId: oid }, 500)) {
    const f = S.f[sh.fulfilmentId];
    if (!f) continue;
    S.E[shipKey(S, f.id)] = { k: 'ship', f: f.id, s: 'ok', n: 1 };
    if (sh.status === 'cancelled') S.E[shcKey(S, f.id)] = { k: 'shc', f: f.id, s: 'ok', n: 1 };
    if (['collected', 'inTransit', 'delivered'].includes(sh.status)) f.col = 0;
    if (sh.status === 'failed') f.cf = true;
  }
  for (const n of q(ctx, 'notify.notifications', { about: oid }, 500)) {
    S.E[`${oid}|n|${n.template}|${n.about}`] = { k: 'ntf', t: n.template, a: n.about, s: 'ok', n: 1 };
  }
  const os = ord.status ?? 'pending';
  S.os = os;
  // past the fraud check already: do not check again
  if (os === 'customerActionRequired') { S.fr = 'pass'; S.cl = S.p; S.stg = 'wait'; S.E[`${oid}|fr`] = { k: 'fr', s: 'ok', n: 1 }; }
  else if (os === 'processing') { S.fr = 'pass'; S.cl = S.p; S.stg = 'ready'; S.rd = S.p; S.E[`${oid}|fr`] = { k: 'fr', s: 'ok', n: 1 }; }
  if (ORDER_FINAL.has(os)) S.dec = { k: 'done', at: S.p };
  return S;
}

// ---------- the tick ----------
function sortEvents(evs) {
  return evs.map((e, i) => ({ e, i })).sort((a, b) => {
    const dt = (ms(a.e.at) || 0) - (ms(b.e.at) || 0);
    if (dt) return dt;
    const ds = sortByKey(String(a.e.source ?? ''), String(b.e.source ?? ''));
    if (ds) return ds;
    return sortByKey(String(a.e.id ?? ''), String(b.e.id ?? '')) || a.i - b.i;
  }).map((x) => x.e);
}
function makeEnv(input, ctx) {
  return {
    ctx, now: ms(input.now), reg: registry(ctx), eds: editions(ctx), schemas: new Map(), pins: new Map(),
  };
}

export function createSolver() {
  return {
    id: 'solver',
    tick(input, ctx) {
      const env = makeEnv(input, ctx);
      const events = sortEvents(input.events ?? []);
      const out = { decisions: { subject: null }, effects: [], obligations: { upsert: [], cancel: [] }, humanTasks: [], carry: input.carry ?? null };
      let S = input.carry ?? null;
      let rest = events;
      if (S === null) {
        const ev0 = events[0];
        if (!ev0) { closed(out, env, null, env.now); return out; }
        const start = startInstance(input, ctx, env, ev0, events.slice(1), out);
        if (start.done) return out;
        S = start.S;
        rest = start.rest;
      }
      for (const ev of rest) {
        progress(S, ms(ev.at), false);
        handleEvent(S, ev, env);
      }
      progress(S, env.now, true);
      plan(S, env, out);
      out.decisions = { subject: S.o, ...(S.hp ? { constitution: { pins: { [S.o]: S.hp } } } : {}) };
      const idle = ORDER_FINAL.has(S.os) && !busy(S);
      if (idle) {
        out.close = true;
        out.obligations.cancel = S.tm;
        out.obligations.upsert = [];
        S.tm = [];
      }
      out.carry = S;
      return out;
    },
  };
}
