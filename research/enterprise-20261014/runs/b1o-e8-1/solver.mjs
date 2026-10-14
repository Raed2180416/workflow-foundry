// E8 order fulfilment with compensation (Hollin Retail): one case-tick solver.
// Deterministic: time comes only from input.now / event times; all state lives in carry.
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

const MIN = 60000;
const HOUR = 3600000;
// Timeouts that must happen *after* a deadline are taken this long after it (inside every window).
const AFTER = 20 * MIN;
const RECHECK = 5 * MIN;

// Canonical argument / table field signatures (from the published schemas) for F5 rename detection.
const CANON = {"billing.charge":{"orderId":"string:80","fulfilmentId":"string:80","customerId":"string:80","amountMinor":"integer>1<10000000000000","currency":"string:3"},"billing.refund":{"orderId":"string:80","fulfilmentId":"string:80","amountMinor":"integer>1<10000000000000"},"T:billing.charges":{"chargeId":"string:80","orderId":"string:80","fulfilmentId":"string:80","customerId":"string:80","amountMinor":"integer>1<10000000000000","currency":"string:3","at":"string:40","refundedMinor":"integer>0"},"T:billing.refunds":{"refundId":"string:80","chargeId":"string:80","orderId":"string:80","fulfilmentId":"string:80","amountMinor":"integer>1<10000000000000","at":"string:40"},"carrier.create":{"orderId":"string:80","fulfilmentId":"string:80","location":"string:40","ref":"string|null:120"},"carrier.cancel":{"orderId":"string:80","fulfilmentId":"string:80"},"T:carrier.shipments":{"shipmentId":"string:80","orderId":"string:80","fulfilmentId":"string:80","location":"string:40","carrier":"string:40","status":"enum","createdAt":"string:40","ref":"string|null:120"},"fraud.check":{"orderId":"string:80"},"inventory.allocate":{"orderId":"string:80"},"inventory.reserve":{"orderId":"string:80","fulfilmentId":"string:80","location":"string:40","items":{"s":"array","p":{"key":"string:200","sku":"string:80","qty":"integer>1"}}},"inventory.release":{"orderId":"string:80","fulfilmentId":"string:80","sku":"string:80"},"T:inventory.stock":{"stockId":"string:120","location":"string:40","sku":"string:80","onHand":"integer>0","reserved":"integer>0"},"T:inventory.reservations":{"reservationId":"string:80","orderId":"string:80","fulfilmentId":"string:80","location":"string:40","sku":"string:80","qty":"integer","status":"enum","at":"string:40"},"notify.send":{"to":"string:120","about":"string|null:80","template":"string:80","text":"string:4000","ref":"string|null:120"},"T:notify.notifications":{"notificationId":"string:80","to":"string:120","about":"string|null:80","template":"string:80","text":"string:4000","ref":"string|null:120","sentAt":"string:40"},"orders.create":{"orderId":"string:80","customerId":"string:80","placedAt":"string:40","currency":"string:3","items":{"s":"array","p":{"sku":"string:80","qty":"integer>1<1000"}},"fulfilments":{"s":"array","p":{"fulfilmentId":"string:80","location":"string|null:40","items":{"s":"array","p":{"sku":"string:80","qty":"integer>1<1000"}},"amountMinor":"integer>1<10000000000000"}},"totalMinor":"integer>1<10000000000000"},"orders.setStatus":{"orderId":"string:80","fulfilmentId":"string|null:80","status":"string:40"},"T:orders.orders":{"orderId":"string:80","customerId":"string:80","status":"enum","placedAt":"string:40","currency":"string:3","items":"array","totalMinor":"integer>1<10000000000000"},"T:orders.fulfilments":{"fulfilmentId":"string:80","orderId":"string:80","location":"string|null:40","items":"array","amountMinor":"integer>1<10000000000000","status":"enum"}};

// ---------------------------------------------------------------- entry point

export function createSolver() {
  return {
    id: 'solver',
    tick(input, ctx) {
      const fallback = () => ({
        decisions: { subject: (input && input.carry && input.carry.oid) || null },
        effects: [], obligations: { upsert: [], cancel: [] }, humanTasks: [],
        carry: (input && input.carry) || { k: 'none' },
      });
      try {
        const r = drive(run(input, ctx || {}));
        if (r && typeof r.then === 'function') return r.catch(() => fallback());
        return r;
      } catch {
        return fallback();
      }
    },
  };
}

// Runs a generator that yields thunks (ctx reads). Stays synchronous unless a read returns a promise.
function drive(gen) {
  let res = gen.next();
  while (!res.done) {
    let v, err, threw = false;
    try { v = res.value(); } catch (e) { threw = true; err = e; }
    if (!threw && v && typeof v.then === 'function') {
      return (async () => {
        let cur = v;
        for (;;) {
          let val, er, th = false;
          try { val = await cur; } catch (e) { th = true; er = e; }
          res = th ? gen.throw(er) : gen.next(val);
          if (res.done) return res.value;
          try { cur = res.value(); } catch (e) { cur = Promise.reject(e); }
        }
      })();
    }
    res = threw ? gen.throw(err) : gen.next(v);
  }
  return res.value;
}

// ---------------------------------------------------------------- small helpers

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const clone = (x) => JSON.parse(JSON.stringify(x));
function num(x) {
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x))) return Number(x);
  return null;
}
function ms(t) {
  if (t == null || t === '') return NaN;
  if (typeof t === 'number') return t;
  return Date.parse(String(t));
}
function normId(s) {
  if (s == null) return null;
  const x = String(s).trim().replace(/^#+/, '').trim().toUpperCase();
  return x || null;
}
function hash(s) {
  let h1 = 0x811c9dc5, h2 = 7;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = (Math.imul(h2, 31) + c) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}
const K = (s) => (s.length <= 200 ? s : s.slice(0, 180) + '~' + hash(s));

// Europe/Amsterdam: CET (+01:00), CEST (+02:00) from last Sunday of March 01:00Z to last Sunday of October 01:00Z.
function lastSundayUTC(y, m) {
  const last = new Date(Date.UTC(y, m + 1, 0));
  return Date.UTC(y, m, last.getUTCDate() - last.getUTCDay());
}
function amsOffsetMin(t) {
  const y = new Date(t).getUTCFullYear();
  const s = lastSundayUTC(y, 2) + HOUR, e = lastSundayUTC(y, 9) + HOUR;
  return t >= s && t < e ? 120 : 60;
}
function iso(t) {
  t = Math.ceil(t / 1000) * 1000;
  const off = amsOffsetMin(t);
  return new Date(t + off * MIN).toISOString().slice(0, 19) + (off === 120 ? '+02:00' : '+01:00');
}
const amsDate = (t) => iso(t).slice(0, 10);
function dateOf(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = ms(s);
  return Number.isFinite(t) ? amsDate(t) : s.slice(0, 10);
}

function deepFind(obj, pred, depth = 0) {
  if (obj == null || depth > 8) return undefined;
  if (pred(obj)) return obj;
  if (Array.isArray(obj)) {
    for (const x of obj) { const r = deepFind(x, pred, depth + 1); if (r !== undefined) return r; }
  } else if (typeof obj === 'object') {
    for (const v of Object.values(obj)) { const r = deepFind(v, pred, depth + 1); if (r !== undefined) return r; }
  }
  return undefined;
}

// ---------------------------------------------------------------- files

function parseCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const split = (l) => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const head = split(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = split(l); const o = {};
    head.forEach((h, i) => { const v = cells[i]; o[h] = num(v) != null ? num(v) : v; });
    return o;
  });
}

function mkFS(files) {
  const cache = new Map();
  let index = null;
  const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  function walkDir(root) {
    const out = [];
    const rec = (rel, depth) => {
      if (depth > 6) return;
      let ents = [];
      try { ents = nodeFs.readdirSync(nodePath.join(root, rel), { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const r = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) rec(r, depth + 1); else out.push(r);
      }
    };
    rec('', 0);
    return out;
  }
  function flatten(o, prefix, out, depth) {
    for (const [k, v] of Object.entries(o)) {
      const p = prefix ? prefix + '/' + k : k;
      if (/\.(json|csv|txt|md)$/i.test(k) || depth > 5 || !isObj(v)) out.push(p);
      else flatten(v, p, out, depth + 1);
    }
  }
  function keys() {
    if (index) return index;
    index = new Map();
    let ks = [];
    try {
      if (files == null) ks = [];
      else if (typeof files === 'string') ks = walkDir(files);
      else if (files instanceof Map) ks = [...files.keys()];
      else if (Array.isArray(files)) ks = files.map((f) => f && (f.path ?? f.name)).filter(Boolean);
      else if (typeof files.list === 'function') ks = files.list() || [];
      else if (typeof files === 'object') {
        const top = Object.keys(files);
        if (top.some((k) => k.includes('/') || k.includes('.'))) ks = top;
        else { ks = []; flatten(files, '', ks, 0); }
      }
    } catch { ks = []; }
    if (!Array.isArray(ks)) ks = [...ks];
    for (const k of ks) if (typeof k === 'string') index.set(norm(k), k);
    return index;
  }
  function rawGet(p) {
    if (files == null) return undefined;
    try {
      if (typeof files === 'string') return nodeFs.readFileSync(nodePath.join(files, p), 'utf8');
      if (typeof files === 'function') return files(p);
      const idx = keys();
      let rk = idx.get(p);
      if (rk == null) { for (const [nk, k] of idx) if (nk.endsWith('/' + p)) { rk = k; break; } }
      if (files instanceof Map) return files.get(rk ?? p);
      if (Array.isArray(files)) {
        const f = files.find((x) => x && (x.path === (rk ?? p) || x.name === (rk ?? p)));
        return f ? (f.content ?? f.text ?? f.data) : undefined;
      }
      if (typeof files.read === 'function') return files.read(rk ?? p);
      if (typeof files.get === 'function' && !isObj(files[p])) { const v = files.get(rk ?? p); if (v !== undefined) return v; }
      if (rk != null && Object.prototype.hasOwnProperty.call(files, rk)) return files[rk];
      let cur = files;
      for (const part of p.split('/')) {
        if (cur && typeof cur === 'object' && part in cur) cur = cur[part]; else return undefined;
      }
      return cur;
    } catch { return undefined; }
  }
  function decode(p, raw) {
    if (raw == null) return null;
    if (raw && typeof raw.then === 'function') return null;
    if (typeof raw === 'object' && !(raw instanceof Uint8Array)) {
      if (!Array.isArray(raw) && (typeof raw.content === 'string' || typeof raw.text === 'string') && Object.keys(raw).length <= 4) raw = raw.content ?? raw.text;
      else return raw;
    }
    const text = raw instanceof Uint8Array ? Buffer.from(raw).toString('utf8') : String(raw);
    if (/\.json$/i.test(p)) { try { return JSON.parse(text); } catch { return null; } }
    if (/\.csv$/i.test(p)) return parseCsv(text);
    return text;
  }
  return {
    read(p) {
      p = norm(p);
      if (cache.has(p)) return cache.get(p);
      const v = decode(p, rawGet(p));
      cache.set(p, v);
      return v;
    },
    list(prefix) { return [...keys().keys()].filter((k) => k.startsWith(prefix)); },
  };
}

// ---------------------------------------------------------------- master data & rulebook

function editions(fsx) {
  const dirs = new Set();
  for (const k of fsx.list('rulebook/')) {
    const parts = k.split('/');
    if (parts.length >= 3 && parts[1]) dirs.add(parts[1]);
  }
  const res = [];
  for (const dir of [...dirs].sort()) {
    const ej = fsx.read(`rulebook/${dir}/edition.json`);
    const id = (isObj(ej) && ej.id) || dir;
    const eff = isObj(ej) ? dateOf(ej.effectiveFrom ?? ej.effective_from ?? ej.from ?? ej.effective) : null;
    res.push({ dir, id: String(id), eff });
  }
  return res;
}
function pickEdition(fsx, pm) {
  const d = amsDate(pm);
  const eds = editions(fsx);
  let best = null;
  for (const e of eds) {
    if (!e.eff || e.eff > d) continue;
    if (!best || e.eff > best.eff || (e.eff === best.eff && e.dir > best.dir)) best = e;
  }
  if (!best) for (const e of eds) if (!best || (e.eff || '') < (best.eff || '')) best = e;
  return best;
}
function rbTable(fsx, dir, name) {
  if (!dir) return null;
  const j = fsx.read(`rulebook/${dir}/${name}.json`);
  if (j != null) return j;
  return fsx.read(`rulebook/${dir}/${name}.csv`);
}
function lookupNum(tbl, name) {
  let found = null;
  deepFind(tbl, (o) => {
    if (!isObj(o)) return false;
    if (name in o && num(o[name]) != null) { found = num(o[name]); return true; }
    const kk = o.key ?? o.name ?? o.param ?? o.parameter ?? o.id;
    if (kk === name && num(o.value ?? o.val) != null) { found = num(o.value ?? o.val); return true; }
    return false;
  });
  return found;
}
function lookupBy(tbl, idFields, id, valFields) {
  if (tbl == null || id == null) return null;
  const sid = String(id);
  const pick = (o) => { for (const f of valFields) if (o && o[f] != null) return o[f]; return null; };
  for (const ci of [false, true]) {
    const eq = (a) => a != null && (ci ? String(a).trim().toUpperCase() === sid.trim().toUpperCase() : String(a) === sid);
    let found = null;
    deepFind(tbl, (o) => {
      if (!isObj(o)) return false;
      for (const f of idFields) if (eq(o[f])) { const v = pick(o); if (v != null) { found = v; return true; } }
      for (const [k, v] of Object.entries(o)) {
        if (!eq(k)) continue;
        if (typeof v !== 'object' && v != null) { found = v; return true; }
        if (isObj(v)) { const w = pick(v); if (w != null) { found = w; return true; } }
      }
      return false;
    });
    if (found != null) return found;
  }
  return null;
}
function priceOf(fsx, sku) {
  return num(lookupBy(fsx.read('master/catalog.json'), ['sku', 'id', 'code'], sku, ['unitPriceMinor', 'priceMinor', 'unitPrice', 'price'])) ?? 0;
}
function feeOf(tbl, loc) {
  if (loc == null || tbl == null) return 0;
  const v = num(lookupBy(tbl, ['location', 'locationId', 'loc', 'warehouse', 'id', 'code'], loc, ['feeMinor', 'fee', 'amountMinor', 'value']));
  if (v != null) return v;
  const d = num(lookupBy(tbl, ['location', 'id'], 'default', ['feeMinor', 'fee', 'value']));
  return d ?? 0;
}
function emailOf(fsx, cust) {
  const v = lookupBy(fsx.read('master/customers.json'), ['customerId', 'id', 'customer'], cust, ['email', 'mail', 'emailAddress']);
  return v != null ? String(v) : null;
}

const MEANINGS = { collected: 'collected', intransit: 'inTransit', delivered: 'delivered', collectionfailed: 'collectionFailed', info: 'info' };
const meaningOf = (v) => (typeof v === 'string' ? MEANINGS[v.toLowerCase().replace(/[^a-z]/g, '')] || null : null);
function codeEntries(tbl) {
  const out = [];
  const meta = new Set(['codes', 'carriers', 'map', 'mapping', 'mappings', 'table', 'entries', 'rows', 'items', 'data']);
  const mfield = (x) => meaningOf(x.meaning ?? x.means ?? x.maps ?? x.mapsTo ?? x.event ?? x.status ?? x.kind ?? x.to ?? x.value ?? x.translation ?? x.type);
  const walk = (x, carrier, depth) => {
    if (x == null || depth > 6) return;
    if (Array.isArray(x)) { for (const e of x) walk(e, carrier, depth + 1); return; }
    if (!isObj(x)) return;
    const code = x.code ?? x.carrierCode ?? x.statusCode;
    if (code != null && typeof code !== 'object') {
      out.push({ c: x.carrier ?? x.carrierId ?? carrier ?? null, code: String(code), m: mfield(x) || 'info' });
      return;
    }
    const own = typeof (x.carrier ?? x.carrierId ?? x.name) === 'string' ? (x.carrier ?? x.carrierId ?? x.name) : null;
    const here = own ?? carrier;
    for (const [k, v] of Object.entries(x)) {
      if (typeof v === 'string') { const m = meaningOf(v); if (m && !(own && ['carrier', 'carrierId', 'name'].includes(k))) out.push({ c: here ?? null, code: k, m }); }
      else if (isObj(v) && !('code' in v) && mfield(v)) out.push({ c: here ?? null, code: k, m: mfield(v) });
      else if (v && typeof v === 'object') walk(v, meta.has(k) || own ? here : k, depth + 1);
    }
  };
  walk(tbl, null, 0);
  return out;
}
function translateCode(tbl, carrier, code) {
  if (code == null) return 'info';
  const es = codeEntries(tbl);
  const cd = String(code).trim(), cu = cd.toUpperCase();
  const cn = carrier == null ? null : String(carrier).trim().toUpperCase();
  const find = (list) => {
    const a = list.find((e) => e.code === cd) || list.find((e) => e.code.trim().toUpperCase() === cu);
    return a ? a.m : null;
  };
  const byC = cn ? es.filter((e) => e.c != null && String(e.c).trim().toUpperCase() === cn) : [];
  if (byC.length) return find(byC) || 'info';
  const gen = es.filter((e) => e.c == null);
  return find(gen) || find(es) || 'info';
}

// ---------------------------------------------------------------- F5 renames

function sigOf(d) {
  if (!isObj(d)) return '';
  let s = Array.isArray(d.type) ? d.type.join('|') : (d.type || (d.enum ? 'enum' : ''));
  if (d.maxLength != null) s += ':' + d.maxLength;
  if (d.minimum != null) s += '>' + d.minimum;
  if (d.maximum != null) s += '<' + d.maximum;
  return s;
}
function bigrams(s) { s = s.toLowerCase(); const o = []; for (let i = 0; i < s.length - 1; i++) o.push(s.slice(i, i + 2)); return o; }
function sim(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.length || !B.length) return a.toLowerCase() === b.toLowerCase() ? 1 : 0;
  let hit = 0; const pool = [...B];
  for (const g of A) { const i = pool.indexOf(g); if (i >= 0) { hit++; pool.splice(i, 1); } }
  return (2 * hit) / (A.length + B.length);
}
function buildMap(canon, cur, learned) {
  const map = {};
  const used = new Set();
  const cnames = Object.keys(canon), pnames = Object.keys(cur);
  for (const c of cnames) {
    const l = learned && learned[c];
    if (l && !used.has(l) && !(l in canon && l !== c)) { map[c] = l; used.add(l); }
  }
  for (const c of cnames) if (!(c in map) && c in cur && !used.has(c)) { map[c] = c; used.add(c); }
  let missing = cnames.filter((c) => !(c in map));
  if (!missing.length) return map;
  missing = missing.filter((c) => !(c in map));
  for (const c of missing) {
    for (const p of pnames) {
      if (used.has(p)) continue;
      const d = cur[p] || {};
      const hint = [d.renamedFrom, d['x-renamedFrom'], d.formerly, d['x-formerly'], d.was, d.oldName, d.alias, d.description, d.title]
        .filter((x) => typeof x === 'string').join(' ');
      if (hint && new RegExp(`\\b${c}\\b`).test(hint)) { map[c] = p; used.add(p); break; }
    }
  }
  missing = missing.filter((c) => !(c in map));
  const extras = pnames.filter((p) => !used.has(p) && !(p in canon));
  const pairs = [];
  for (const c of missing) {
    const want = typeof canon[c] === 'string' ? canon[c] : canon[c].s;
    for (const p of extras) {
      const same = sigOf(cur[p]) === want || (typeof canon[c] !== 'string' && cur[p] && cur[p].type === 'array');
      pairs.push({ c, p, s: sim(c, p) + (same ? 1 : 0) });
    }
  }
  pairs.sort((a, b) => b.s - a.s || (a.c < b.c ? -1 : 1) || (a.p < b.p ? -1 : 1));
  for (const { c, p } of pairs) {
    if (c in map || used.has(p)) continue;
    map[c] = p; used.add(p);
  }
  return map;
}
function renLevel(obj, canon, cur, learned) {
  const map = buildMap(canon, cur, learned);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    let nk = map[k];
    if (nk == null) { if (k in cur || !(k in canon)) nk = k; else if (learned && learned[k]) nk = learned[k]; else continue; }
    let nv = v;
    const cd = canon[k];
    if (Array.isArray(v) && isObj(cd) && cd.p) {
      const sub = cur[nk] && cur[nk].items && cur[nk].items.properties;
      if (isObj(sub)) nv = v.map((e) => (isObj(e) ? renLevel(e, cd.p, sub, learned) : e));
    }
    out[nk] = nv;
  }
  return out;
}
function schemaOf(R, sys) {
  const j = R.fsx.read(`api/${sys}.schema.json`);
  return isObj(j) ? j : null;
}
// An op missing from the current schema is matched to the most similar op there (F5 safety net).
function resolveOp(R, sys, op) {
  const s = schemaOf(R, sys);
  if (!s || !isObj(s.ops) || s.ops[op]) return op;
  const canon = CANON[`${sys}.${op}`];
  if (!canon) return op;
  const ro = op === 'allocate' || op === 'check', batch = op === 'reserve';
  let best = op, bs = 0.6;
  for (const [name, d] of Object.entries(s.ops)) {
    if (name === 'status' || !isObj(d) || (CANON[`${sys}.${name}`] && name !== op)) continue;
    const props = Object.keys((d.args && d.args.properties) || {});
    const ov = Object.keys(canon).filter((k) => props.includes(k)).length / Object.keys(canon).length;
    const sc = ov + sim(op, name) + (!!d.readOnly === ro ? 0.3 : -1) + (!!d.batch === batch ? 0.3 : -1);
    if (sc > bs) { bs = sc; best = name; }
  }
  return best;
}
function renameArgs(R, sys, op, args) {
  const canon = CANON[`${sys}.${op}`];
  const s = schemaOf(R, sys);
  const rop = resolveOp(R, sys, op);
  const cur = s && s.ops && s.ops[rop] && s.ops[rop].args && s.ops[rop].args.properties;
  const learned = (R.S && R.S.ren && R.S.ren[`${sys}.${op}`]) || {};
  if (!canon || !isObj(cur)) {
    if (!Object.keys(learned).length) return args;
    const o = {}; for (const [k, v] of Object.entries(args)) o[learned[k] || k] = v; return o;
  }
  return renLevel(args, canon, cur, learned);
}
// Last line of defence against an invalid output: bring args in line with the current schema.
function sanitize(v, sch, depth = 0) {
  if (!isObj(sch) || depth > 8 || v == null) return v;
  const types = Array.isArray(sch.type) ? sch.type : sch.type ? [sch.type] : [];
  if (types.includes('object') && isObj(v)) {
    const props = isObj(sch.properties) ? sch.properties : {};
    const req = Array.isArray(sch.required) ? sch.required : [];
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (!(k in props)) { if (sch.additionalProperties !== false) out[k] = x; continue; }
      const d = props[k] || {};
      const dt = Array.isArray(d.type) ? d.type : d.type ? [d.type] : [];
      if (x == null && dt.length && !dt.includes('null')) {
        if (req.includes(k) && dt.includes('string')) out[k] = 'unknown';
        continue;
      }
      out[k] = sanitize(x, d, depth + 1);
    }
    return out;
  }
  if (types.includes('array') && Array.isArray(v)) {
    let a = v.map((x) => sanitize(x, sch.items, depth + 1));
    if (sch.maxItems != null) a = a.slice(0, sch.maxItems);
    return a;
  }
  if (typeof v === 'string' && types.includes('string')) {
    let x = v;
    if (sch.maxLength != null && x.length > sch.maxLength) x = x.slice(0, sch.maxLength);
    if (sch.minLength != null && x.length < sch.minLength) x = x.padEnd(sch.minLength, '_');
    return x;
  }
  if (typeof v === 'number' && (types.includes('integer') || types.includes('number'))) {
    let n = types.includes('number') ? v : Math.round(v);
    if (sch.minimum != null && n < sch.minimum) n = sch.minimum;
    if (sch.maximum != null && n > sch.maximum) n = sch.maximum;
    return n;
  }
  return v;
}
function argSchema(R, sys, op) {
  const s = schemaOf(R, sys);
  const o = s && isObj(s.ops) && s.ops[op];
  return o && isObj(o.args) ? o.args : null;
}
function learnRename(S, sys, op, err) {
  if (!S || err == null) return;
  let from = null, to = null;
  const scan = (e) => {
    if (!isObj(e)) return;
    const f = e.field ?? e.from ?? e.old ?? e.oldName ?? e.oldField ?? e.renamedFrom;
    const t = e.renamedTo ?? e.newName ?? e.newField ?? e.new ?? e.to ?? e.use;
    const ident = (x) => typeof x === 'string' && /^[A-Za-z_]\w*$/.test(x);
    if (ident(f) && ident(t)) { from = f; to = t; }
    for (const v of Object.values(e)) if (!to && isObj(v)) scan(v);
  };
  scan(err);
  if (!to) {
    const txt = typeof err === 'string' ? err : JSON.stringify(err);
    let m = txt.match(/['"`]?([A-Za-z_]\w*)['"`]?\s*(?:has been|was|is|got)?\s*renamed\s*(?:to|->|=>|as|into)\s*['"`]?([A-Za-z_]\w*)/i);
    if (m) { from = m[1]; to = m[2]; }
    else if ((m = txt.match(/use\s+['"`]?([A-Za-z_]\w*)['"`]?\s+instead\s+of\s+['"`]?([A-Za-z_]\w*)/i))) { to = m[1]; from = m[2]; }
    else if ((m = txt.match(/['"`]?([A-Za-z_]\w*)['"`]?\s*(?:->|=>)\s*['"`]?([A-Za-z_]\w*)/))) { from = m[1]; to = m[2]; }
  }
  if (from && to && from !== to && /^[A-Za-z_]\w*$/.test(from) && /^[A-Za-z_]\w*$/.test(to)) {
    const k = `${sys}.${op}`;
    S.ren[k] = Object.assign({}, S.ren[k], { [from]: to });
  }
}
function canonRows(R, table, rows) {
  const [sys, t] = table.split('.');
  const s = schemaOf(R, sys);
  const cur = s && s.tables && s.tables[t] && s.tables[t].fields;
  const canon = CANON['T:' + table];
  if (!isObj(cur) || !canon) return rows;
  const map = buildMap(canon, cur, {});
  return rows.map((r) => {
    if (!isObj(r)) return r;
    const o = Object.assign({}, r);
    for (const [c, p] of Object.entries(map)) if (c !== p && p in r && !(c in o)) o[c] = r[p];
    return o;
  });
}
function whereFor(R, table, where) {
  const [sys, t] = table.split('.');
  const s = schemaOf(R, sys);
  const cur = s && s.tables && s.tables[t] && s.tables[t].fields;
  const canon = CANON['T:' + table];
  if (!isObj(cur) || !canon) return where;
  const map = buildMap(canon, cur, {});
  const o = {};
  for (const [k, v] of Object.entries(where)) o[map[k] || k] = v;
  return o;
}

// ---------------------------------------------------------------- ctx reads (generators)

function rowsOf(r) {
  if (Array.isArray(r)) return r;
  if (isObj(r)) for (const k of ['rows', 'records', 'items', 'data', 'result', 'results', 'instances', 'list']) if (Array.isArray(r[k])) return r[k];
  return [];
}
function* Q(R, table, where, limit = 1000) {
  const ctx = R.ctx;
  if (typeof ctx.query !== 'function') return [];
  try {
    const r = yield () => ctx.query(table, { where: whereFor(R, table, where), limit });
    return canonRows(R, table, rowsOf(r).filter(isObj));
  } catch { return []; }
}
function* ST(R, sys, key) {
  const ctx = R.ctx;
  if (typeof ctx.status !== 'function') return null;
  try {
    const r = yield () => ctx.status(sys, key);
    const s = typeof r === 'string' ? r : isObj(r) ? (r.status ?? r.state ?? r.result) : null;
    if (typeof s !== 'string') return null;
    const l = s.toLowerCase();
    if (l === 'committed' || l === 'not-found' || l === 'pending') return l;
    if (l === 'notfound' || l === 'not_found' || l === 'missing') return 'not-found';
    return null;
  } catch { return null; }
}
function* INST(R, subject) {
  const ctx = R.ctx;
  if (!subject || typeof ctx.instances !== 'function') return [];
  let r;
  try { r = yield () => ctx.instances({ subject }); } catch { return []; }
  const list = rowsOf(r).length ? rowsOf(r) : (Array.isArray(r) ? r : []);
  const out = [];
  for (const x of list) {
    if (typeof x === 'string') out.push({ instance: x, openedAt: '' });
    else if (isObj(x)) {
      const id = x.instance ?? x.id ?? x.instanceId;
      if (!id) continue;
      if (x.subject != null && normId(x.subject) !== normId(subject)) continue;
      if (x.closed === true || x.status === 'closed') continue;
      out.push({ instance: String(id), openedAt: String(x.openedAt ?? '') });
    }
  }
  return out
    .filter((x) => x.instance !== R.input.instance)
    .sort((a, b) => (a.openedAt < b.openedAt ? -1 : a.openedAt > b.openedAt ? 1 : a.instance < b.instance ? -1 : 1));
}
function extractRead(op, r) {
  if (r == null) return null;
  if (op === 'allocate') {
    const isF = (x) => isObj(x) && 'fulfilmentId' in x && Array.isArray(x.items);
    const o = deepFind(r, (x) => isObj(x) && Array.isArray(x.fulfilments) && x.fulfilments.length > 0 && x.fulfilments.every(isF));
    if (o) return { fulfilments: o.fulfilments };
    const a = deepFind(r, (x) => Array.isArray(x) && x.length > 0 && x.every(isF));
    return a ? { fulfilments: a } : null;
  }
  const V = ['pass', 'review', 'reject'];
  const o = deepFind(r, (x) => isObj(x) && typeof x.verdict === 'string' && V.includes(x.verdict.trim().toLowerCase()));
  if (o) return { verdict: o.verdict.trim().toLowerCase() };
  const w = deepFind(r, (x) => isObj(x) && ['result', 'value', 'outcome', 'decision', 'data'].some((k) => typeof x[k] === 'string' && V.includes(x[k].trim().toLowerCase())));
  if (!w) return null;
  for (const k of ['result', 'value', 'outcome', 'decision', 'data']) if (typeof w[k] === 'string' && V.includes(w[k].trim().toLowerCase())) return { verdict: w[k].trim().toLowerCase() };
  return null;
}
function* syncRead(R, sys, op, args) {
  const ctx = R.ctx;
  const tries = [];
  if (typeof ctx.call === 'function') tries.push(() => ctx.call(sys, op, args));
  if (typeof ctx.read === 'function') tries.push(() => ctx.read(sys, op, args));
  if (typeof ctx.invoke === 'function') tries.push(() => ctx.invoke(sys, op, args));
  if (isObj(ctx[sys]) && typeof ctx[sys][op] === 'function') tries.push(() => ctx[sys][op](args));
  if (typeof ctx.query === 'function') {
    tries.push(() => ctx.query(`${sys}.${op}`, { where: args, limit: 1000 }));
    tries.push(() => ctx.query(`${sys}.${op}`, args));
  }
  for (const t of tries) {
    try {
      const r = yield t;
      const d = extractRead(op, r);
      if (d) return d;
    } catch { /* try the next way */ }
  }
  return null;
}

// ---------------------------------------------------------------- events

function sortEvents(evs) {
  return evs.map((e, i) => ({ e, i, t: ms(e && e.at) }))
    .sort((a, b) => {
      const ta = Number.isFinite(a.t) ? a.t : 0, tb = Number.isFinite(b.t) ? b.t : 0;
      return ta - tb || a.i - b.i;
    })
    .map((x) => x.e)
    .filter(isObj);
}
function looksBiz(o) { return isObj(o) && ('orderId' in o || 'orderRef' in o || 'code' in o || 'fulfilmentRef' in o); }
function payloadOf(R, ev) {
  let p = ev.payload;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = null; } }
  for (let depth = 0; depth < 3 && isObj(p) && !looksBiz(p); depth++) {
    const k = ['message', 'body', 'data', 'content', 'doc', 'document', 'payload', 'fields'].find((n) => isObj(p[n]));
    if (!k) break;
    p = p[k];
  }
  if (!looksBiz(p) && isObj(ev.payload)) p = ev.payload;
  if (!looksBiz(p) && ev.id != null && R) {
    const d = R.fsx.read(`docs/${ev.id}.txt`);
    if (typeof d === 'string') {
      try { const j = JSON.parse(d); if (looksBiz(j)) return j; } catch { /* not JSON */ }
    }
  }
  return isObj(p) ? p : {};
}
function bizKind(ev, pl) {
  if (isObj(pl)) {
    if ('orderRef' in pl && 'action' in pl) return 'action';
    if ('code' in pl && ('fulfilmentRef' in pl || 'shipmentId' in pl)) return 'carrier';
    if ('orderId' in pl && Array.isArray(pl.items)) return 'placed';
  }
  const t = [ev.type, ev.kind, ev.subtype, pl && pl.type, pl && pl.kind].filter((x) => typeof x === 'string').join(' ').toLowerCase();
  if (t.includes('order.placed')) return 'placed';
  if (t.includes('customer.action')) return 'action';
  if (t.includes('carrier.status')) return 'carrier';
  return null;
}
const evAt = (R, ev) => { const t = ms(ev.at); return Number.isFinite(t) ? t : R.now; };

// ---------------------------------------------------------------- run

function* run(input, ctx) {
  const R = {
    input, ctx, now: ms(input.now), fsx: mkFS(ctx.files), S: null,
    out: { effects: [], obligations: { upsert: [], cancel: [] }, humanTasks: [] },
    emitted: new Set(), lastFst: null,
  };
  if (!Number.isFinite(R.now)) R.now = 0;
  let events = sortEvents(Array.isArray(input.events) ? input.events : []);
  const carry = isObj(input.carry) ? input.carry : null;

  if (carry && carry.k === 'order') {
    R.S = clone(carry);
  } else if (carry && carry.k === 'none') {
    return finish(R, { subject: carry.subject ?? null, close: true });
  } else {
    const st = yield* firstTick(R, events);
    if (!R.S) return finish(R, st);
    events = events.filter((e) => e !== st.consumed);
  }

  for (const ev of events) yield* handleEvent(R, ev);
  yield* plan(R);
  const close = shouldClose(R);
  timers(R, close);
  return finish(R, { subject: R.S.oid, close });
}

function finish(R, st) {
  const out = {
    decisions: { subject: st.subject ?? null },
    effects: R.out.effects,
    obligations: R.out.obligations,
    humanTasks: R.out.humanTasks,
  };
  if (st.merge) out.merge = { into: st.merge };
  if (st.close) out.close = true;
  if (R.S) {
    const S = R.S;
    if (S.seen.length > 120) S.seen = S.seen.slice(-120);
    let c = JSON.stringify(S);
    if (c.length > 60000) {
      S.seen = S.seen.slice(-20);
      for (const e of Object.values(S.E)) if (e.st === 'ok' && !e.fw) { delete e.t; delete e.at; delete e.af; delete e.rc; }
      c = JSON.stringify(S);
    }
    out.carry = S;
  } else {
    out.carry = { k: 'none', subject: st.subject ?? null };
  }
  return out;
}

// ---------------------------------------------------------------- first tick: routing

function* firstTick(R, events) {
  const mig = events.find((e) => e.type === 'migration');
  if (mig) {
    yield* initMigration(R, mig);
    return R.S ? { consumed: mig } : { subject: null, close: true };
  }
  for (const ev of events) {
    if (['effect.result', 'timer.fired', 'edition.published'].includes(ev.type) || String(ev.type || '').startsWith('humanTask.')) continue;
    const pl = payloadOf(R, ev);
    const kind = bizKind(ev, pl);
    if (kind === 'placed') {
      const oid = normId(pl.orderId);
      if (!oid) continue;
      const others = yield* INST(R, oid);
      if (others.length) return { subject: oid, merge: others[0].instance };
      const recs = yield* Q(R, 'orders.orders', { orderId: oid }, 10);
      if (recs.some((r) => normId(r.orderId) === oid)) return { subject: oid, close: true };
      newOrder(R, oid, pl, ev);
      return { consumed: ev };
    }
    if (kind === 'action') {
      const oid = normId(pl.orderRef);
      if (!oid) return { subject: null, close: true };
      const others = yield* INST(R, oid);
      if (others.length) return { subject: oid, merge: others[0].instance };
      const recs = yield* Q(R, 'orders.orders', { orderId: oid }, 10);
      if (recs.some((r) => normId(r.orderId) === oid)) return { subject: oid, close: true };
      return { subject: null, close: true };
    }
    if (kind === 'carrier') {
      const oid = yield* carrierOrder(R, pl);
      if (!oid) return { subject: null, close: true };
      const others = yield* INST(R, oid);
      if (others.length) return { subject: oid, merge: others[0].instance };
      return { subject: oid, close: true };
    }
  }
  return { subject: null, close: true };
}

function* carrierOrder(R, pl) {
  if (pl.ref != null) {
    const head = String(pl.ref).split('/')[0];
    const cand = normId(head);
    if (cand && (yield* INST(R, cand)).length) return cand;
  }
  const fr = pl.fulfilmentRef;
  if (fr != null) {
    const vals = [...new Set([String(fr), String(fr).trim(), normId(fr)].filter(Boolean))];
    for (const v of vals) {
      const rows = yield* Q(R, 'orders.fulfilments', { fulfilmentId: v }, 10);
      const r = rows.find((x) => normId(x.fulfilmentId) === normId(v) && x.orderId);
      if (r) return normId(r.orderId);
    }
    for (const v of vals) {
      const rows = yield* Q(R, 'carrier.shipments', { fulfilmentId: v }, 10);
      const r = rows.find((x) => normId(x.fulfilmentId) === normId(v) && x.orderId);
      if (r) return normId(r.orderId);
    }
  }
  if (pl.shipmentId != null) {
    const rows = yield* Q(R, 'carrier.shipments', { shipmentId: String(pl.shipmentId).trim() }, 10);
    const r = rows.find((x) => x.orderId && String(x.shipmentId).trim() === String(pl.shipmentId).trim());
    if (r) return normId(r.orderId);
  }
  if (fr != null) {
    const segs = String(normId(fr)).split(/[-_/.:]/);
    const seps = String(normId(fr)).match(/[-_/.:]/g) || [];
    for (let i = segs.length - 1; i >= 1; i--) {
      let cand = segs[0];
      for (let j = 1; j < i; j++) cand += seps[j - 1] + segs[j];
      if ((yield* INST(R, cand)).length) return cand;
    }
  }
  return null;
}

// ---------------------------------------------------------------- order state

function baseState(R, oid, o) {
  const pm = ms(o.p);
  const S = {
    k: 'order', v: 1, oid,
    cust: o.cust, p: o.p, pm, cur: o.cur, items: o.items,
    ed: null, pol: {}, email: null,
    alloc: null, rd: {}, fraud: null, fraudAt: null,
    cleared: null, rev: null, acts: [], counted: null, stop: null,
    ready: null, os: null, F: {}, E: {}, N: {}, T: {}, H: {}, ren: {}, seen: [],
  };
  R.S = S;
  const ed = pickEdition(R.fsx, Number.isFinite(pm) ? pm : R.now);
  if (ed) {
    S.ed = ed.dir;
    const pol = rbTable(R.fsx, ed.dir, 'policy');
    S.pol = {
      frh: lookupNum(pol, 'fraudReviewHours'),
      cah: lookupNum(pol, 'customerActionHours'),
      cut: lookupNum(pol, 'collectionCutoffMinutes'),
    };
  }
  S.email = emailOf(R.fsx, S.cust);
  return S;
}
function placedTime(pl, ev) {
  const a = ev && ev.at, b = pl && pl.placedAt;
  if (a != null && Number.isFinite(ms(a))) {
    if (b != null && ms(b) === ms(a)) return String(b);
    return String(a);
  }
  return b != null ? String(b) : null;
}
function cleanItems(items) {
  return (Array.isArray(items) ? items : []).filter(isObj).map((i) => ({ sku: String(i.sku), qty: Number(i.qty) }));
}
function newOrder(R, oid, pl, ev) {
  baseState(R, oid, {
    p: placedTime(pl, ev) || iso(R.now),
    cust: pl.customerId != null ? String(pl.customerId).trim() : null,
    cur: pl.currency != null ? String(pl.currency).trim().toUpperCase() : 'EUR',
    items: cleanItems(pl.items),
  });
  if (ev.id != null) R.S.seen.push(String(ev.id));
}
function setAlloc(R, fulfilments, keepAmounts) {
  const S = R.S;
  S.alloc = fulfilments.filter(isObj).map((x) => {
    const loc = x.location == null || x.location === '' ? null : String(x.location);
    return { f: String(x.fulfilmentId), loc, items: cleanItems(x.items), av: x.available !== false && loc != null, amt: keepAmounts ? num(x.amountMinor) : null };
  });
  const fees = rbTable(R.fsx, S.ed, 'shipping-fees');
  for (const f of S.alloc) {
    if (f.amt == null || f.amt < 1) {
      let a = 0;
      for (const it of f.items) a += it.qty * priceOf(R.fsx, it.sku);
      if (f.loc != null && f.av) a += feeOf(fees, f.loc);
      f.amt = Math.round(a);
    }
    if (!S.F[f.f]) S.F[f.f] = { cur: f.av ? 'pending' : 'unavailable', res: {}, bn: 0, q: [] };
  }
}
const hasUn = (S) => !!(S.alloc && S.alloc.some((f) => !f.av));
const hasAv = (S) => !!(S.alloc && S.alloc.some((f) => f.av));
const TERM_F = new Set(['completed', 'cancelled', 'failed']);
const TERM_O = new Set(['completed', 'cancelled', 'failed', 'timedOut']);
const RANK_F = { pending: 0, unavailable: 0, processing: 1, dispatched: 2, completed: 9, cancelled: 9, failed: 9 };
const RANK_O = { pending: 0, customerActionRequired: 1, processing: 2, completed: 9, failed: 9, cancelled: 9, timedOut: 9 };
function canMove(isOrder, cur, next) {
  const rk = isOrder ? RANK_O : RANK_F;
  const a = rk[cur ?? 'pending'] ?? 0, b = rk[next];
  if (b == null || a >= 9) return false;
  return b > a;
}
function deadlineD(S) { return S.pm + (S.pol.cah ?? 48) * HOUR; }

// ---------------------------------------------------------------- migration

function collect(x, acc, depth) {
  if (x == null || depth > 8) return;
  if (Array.isArray(x)) { for (const e of x) collect(e, acc, depth + 1); return; }
  if (!isObj(x)) return;
  if (typeof x.type === 'string' && 'payload' in x && ('at' in x || 'id' in x)) { acc.msgs.push(x); return; }
  let c = null;
  if (x.kind === 'fraudReview' && ('createdAt' in x || 'dueAt' in x)) c = 'tasks';
  else if ('reservationId' in x) c = 'reservations';
  else if ('refundId' in x) c = 'refunds';
  else if ('chargeId' in x) c = 'charges';
  else if ('notificationId' in x || ('template' in x && 'to' in x)) c = 'notifications';
  else if ('orderRef' in x && 'action' in x) c = 'raw';
  else if ('code' in x && ('fulfilmentRef' in x || 'reportedAt' in x)) c = 'raw';
  else if ('shipmentId' in x && !('code' in x)) c = 'shipments';
  else if ('fulfilmentId' in x && Array.isArray(x.items) && 'location' in x) c = 'fulfilments';
  else if ('orderId' in x && Array.isArray(x.items) && 'customerId' in x) c = ('status' in x || 'totalMinor' in x) ? 'orders' : 'raw';
  if (c) {
    acc[c].push(x);
    if (c !== 'orders') return;
  }
  for (const v of Object.values(x)) if (v && typeof v === 'object') collect(v, acc, depth + 1);
}
function mergeRows(a, b, pk) {
  const m = new Map();
  for (const r of a) m.set(String(r[pk] ?? JSON.stringify(r)), r);
  for (const r of b) m.set(String(r[pk] ?? JSON.stringify(r)), r);
  return [...m.values()];
}

function* initMigration(R, ev) {
  const pl = isObj(ev.payload) ? ev.payload : {};
  const acc = { orders: [], fulfilments: [], reservations: [], charges: [], refunds: [], shipments: [], notifications: [], raw: [], msgs: [], tasks: [] };
  collect(pl, acc, 0);
  const sorRec = R.fsx.read(`sor/${R.input.instance}.json`);
  const sacc = { orders: [], fulfilments: [], reservations: [], charges: [], refunds: [], shipments: [], notifications: [], raw: [], msgs: [], tasks: [] };
  if (sorRec) collect(sorRec, sacc, 0);
  for (const k of ['orders', 'fulfilments', 'reservations', 'charges', 'refunds', 'shipments', 'notifications']) acc[k] = acc[k].concat(sacc[k]);

  const msgs = [];
  acc.msgs.forEach((m) => msgs.push(m));
  acc.raw.forEach((m, i) => msgs.push({
    id: `mig-${R.input.instance}-${i}`, type: 'message.received',
    at: m.at ?? m.reportedAt ?? m.placedAt ?? ev.at, payload: m, channel: { kind: 'inbound' },
  }));
  const placed = msgs.map((m) => ({ m, p: payloadOf(R, m) })).find((x) => bizKind(x.m, x.p) === 'placed');

  let oid = normId(pl.orderId ?? pl.subject ?? (isObj(pl.order) ? pl.order.orderId : null));
  if (!oid && acc.orders[0]) oid = normId(acc.orders[0].orderId);
  if (!oid && placed) oid = normId(placed.p.orderId);
  if (!oid && acc.fulfilments[0]) oid = normId(acc.fulfilments[0].orderId);
  if (!oid) return;

  const live = {};
  for (const [k, t, w, pk] of [
    ['orders', 'orders.orders', { orderId: oid }, 'orderId'],
    ['fulfilments', 'orders.fulfilments', { orderId: oid }, 'fulfilmentId'],
    ['reservations', 'inventory.reservations', { orderId: oid }, 'reservationId'],
    ['charges', 'billing.charges', { orderId: oid }, 'chargeId'],
    ['refunds', 'billing.refunds', { orderId: oid }, 'refundId'],
    ['shipments', 'carrier.shipments', { orderId: oid }, 'shipmentId'],
  ]) {
    live[k] = yield* Q(R, t, w);
    acc[k] = mergeRows(acc[k].filter((r) => normId(r.orderId) === oid || r.orderId == null), live[k].filter((r) => normId(r.orderId) === oid), pk);
  }
  const orec = acc.orders.find((o) => normId(o.orderId) === oid) || null;
  const fids = acc.fulfilments.map((f) => String(f.fulfilmentId));
  let notes = yield* Q(R, 'notify.notifications', { about: oid });
  for (const fid of fids) notes = notes.concat(yield* Q(R, 'notify.notifications', { about: fid }));
  acc.notifications = mergeRows(acc.notifications, notes, 'notificationId');

  const ppl = placed ? placed.p : {};
  baseState(R, oid, {
    p: (orec && orec.placedAt != null ? String(orec.placedAt) : null) || placedTime(ppl, placed && placed.m) || String(ev.at),
    cust: orec && orec.customerId != null ? String(orec.customerId) : (ppl.customerId != null ? String(ppl.customerId).trim() : null),
    cur: String((orec && orec.currency) || ppl.currency || 'EUR').toUpperCase(),
    items: cleanItems((orec && orec.items) || ppl.items),
  });
  const S = R.S;
  S.mig = 1;
  if (placed && placed.m.id != null) S.seen.push(String(placed.m.id));

  if (acc.fulfilments.length) {
    setAlloc(R, acc.fulfilments.map((f) => ({
      fulfilmentId: f.fulfilmentId, location: f.location, items: f.items, amountMinor: f.amountMinor,
      available: f.location != null && f.status !== 'unavailable',
    })), true);
    for (const f of acc.fulfilments) {
      const F = S.F[String(f.fulfilmentId)];
      if (F && typeof f.status === 'string') F.cur = f.status;
    }
  }
  if (orec) {
    S.E.create = { st: 'ok', mig: 1 };
    S.os = typeof orec.status === 'string' ? orec.status : 'pending';
    if (S.os !== 'pending') {
      S.fraud = 'pass'; S.fraudAt = S.pm; S.cleared = S.pm;
      if (hasUn(S) && S.os !== 'customerActionRequired') S.counted = { k: 'amend', at: S.pm };
      if (S.os !== 'customerActionRequired') S.ready = S.pm;
    }
  }
  for (const r of acc.reservations) {
    const F = S.F[String(r.fulfilmentId)];
    if (!F) continue;
    F.res[String(r.sku)] = 'ok';
    F.mres = Object.assign({}, F.mres, { [String(r.sku)]: 1 });
    if (r.status === 'released') S.E[`rel:${r.fulfilmentId}:${r.sku}`] = { st: 'ok', mig: 1 };
  }
  for (const c of acc.charges) {
    const fid = String(c.fulfilmentId);
    if (!S.F[fid]) continue;
    S.E[`chg:${fid}`] = { st: 'ok', mig: 1 };
    if (num(c.refundedMinor) > 0) S.E[`rfd:${fid}`] = { st: 'ok', mig: 1 };
  }
  for (const r of acc.refunds) if (S.F[String(r.fulfilmentId)]) S.E[`rfd:${r.fulfilmentId}`] = { st: 'ok', mig: 1 };
  for (const sh of acc.shipments) {
    const fid = String(sh.fulfilmentId);
    const F = S.F[fid];
    if (!F) continue;
    S.E[`shp:${fid}`] = { st: 'ok', mig: 1 };
    if (sh.shipmentId != null) F.sid = String(sh.shipmentId);
    if (sh.status === 'cancelled') S.E[`cxl:${fid}`] = { st: 'ok', mig: 1 };
    if (sh.status === 'failed') F.cf = 1;
    if (['collected', 'inTransit', 'delivered'].includes(sh.status)) {
      const t = ms(sh.collectedAt ?? sh.updatedAt ?? sh.createdAt);
      F.proof = Number.isFinite(t) ? t : S.pm;
    }
  }
  for (const n of acc.notifications) if (n.template) S.N[`${n.template}|${normId(n.about)}`] = 1;
  const tasks = acc.tasks.filter((t) => Number.isFinite(ms(t.createdAt))).sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  if (tasks.length && S.os === 'pending') {
    const first = ms(tasks[0].createdAt);
    S.fraud = S.fraud || 'review';
    S.fraudAt = first;
    const last = tasks[tasks.length - 1];
    const open = !['answered', 'withdrawn', 'rejected', 'timedOut', 'timeout', 'closed'].includes(String(last.status || ''));
    S.rev = { n: tasks.length, open: open && last.id != null ? String(last.id) : null, dec: null, decAt: null, first, dl: first + (S.pol.frh ?? 24) * HOUR };
    for (const t of tasks) {
      const d = isObj(t.answer) && typeof t.answer.decision === 'string' ? t.answer.decision.trim().toLowerCase() : null;
      const at = ms(t.answeredAt ?? t.updatedAt);
      if ((d === 'approve' || d === 'reject') && Number.isFinite(at) && at <= S.rev.dl && !S.rev.dec) { S.rev.dec = d; S.rev.decAt = at; }
    }
  }

  const rest = sortEvents(msgs.filter((m) => !(placed && m === placed.m)));
  for (const m of rest) yield* handleEvent(R, m);
}

// ---------------------------------------------------------------- event handling

function tagOf(S, key) {
  if (key == null) return null;
  key = String(key);
  if (S.H[key]) return S.H[key];
  const pre = S.oid + ':';
  return key.startsWith(pre) ? key.slice(pre.length) : key;
}
function fullKey(S, tag) {
  const k = K(`${S.oid}:${tag}`);
  if (k !== `${S.oid}:${tag}`) S.H[k] = tag;
  return k;
}
function matchFid(S, pl) {
  const fr = normId(pl.fulfilmentRef);
  if (fr) for (const fid of Object.keys(S.F)) if (normId(fid) === fr) return fid;
  if (pl.ref != null) {
    const parts = String(pl.ref).split('/');
    if (parts.length >= 2) { const f = normId(parts.slice(1).join('/')); for (const fid of Object.keys(S.F)) if (normId(fid) === f) return fid; }
  }
  if (pl.shipmentId != null) for (const [fid, F] of Object.entries(S.F)) if (F.sid && F.sid === String(pl.shipmentId).trim()) return fid;
  return null;
}
function classify(p) {
  const s = String(p.status ?? p.outcome ?? p.result ?? '').toLowerCase();
  if (s === 'ok' || s === 'success' || s === 'committed') return 'ok';
  if (s === 'partial') return 'partial';
  if (s === 'unknown' || s === 'timeout') return 'unknown';
  const err = p.error;
  const txt = ((typeof err === 'string' ? err : JSON.stringify(err ?? '')) + ' ' + String(p.code ?? '') + ' ' + String(p.reason ?? '')).toLowerCase();
  const cands = isObj(err) ? [err.code, err.status, err.httpStatus, err.statusCode] : [];
  cands.push(p.code, p.httpStatus, (txt.match(/\b([45]\d\d)\b/) || [])[1]);
  let code = null;
  for (const c of cands) { const n = num(c); if (n != null) { code = n; break; } }
  if (s === 'rate-limited' || s === 'ratelimited' || code === 429) return 'rate';
  if (txt.includes('predecessor')) return 'pred';
  if (txt.includes('declined') || code === 402) return 'declined';
  if (txt.includes('already-collected') || txt.includes('already collected')) return 'collected';
  if (txt.includes('key-conflict') || txt.includes('key conflict')) return 'conflict';
  const retry = isObj(err) ? err.retryable : undefined;
  if (code === 400 || txt.includes('invalid-args') || txt.includes('field-renamed') || txt.includes('renamed')) return 'invalid';
  if (txt.includes('invalid') && (retry ?? p.retryable) !== false && (code == null || code === 422)) return 'invalid';
  if (txt.includes('rate-limit') || txt.includes('rate limit')) return 'rate';
  if ((retry ?? p.retryable) === true) return 'transient';
  return 'fail';
}
function retryAfterMs(p, at) {
  const v = p.retryAfter;
  const n = num(v);
  if (n != null) return at + (n > 10000 ? n : n * 1000);
  const t = ms(v);
  return Number.isFinite(t) ? t : at + MIN;
}

function* handleEvent(R, ev) {
  const S = R.S;
  if (ev.id != null) {
    const id = String(ev.id);
    if (S.seen.includes(id)) return;
    S.seen.push(id);
  }
  const t = String(ev.type || '');
  const at = evAt(R, ev);
  const p = isObj(ev.payload) ? ev.payload : {};
  if (t === 'effect.result') return onResult(R, p, at);
  if (t === 'timer.fired') {
    const id = p.obligationId ?? p.id;
    if (id != null) for (const [k, v] of Object.entries(S.T)) if (v.id === id) delete S.T[k];
    return;
  }
  if (t.startsWith('humanTask.')) return onTask(R, t, p, at);
  if (t === 'migration' || t === 'edition.published' || t.startsWith('world.')) return;
  const pl = payloadOf(R, ev);
  const kind = bizKind(ev, pl);
  if (kind === 'placed') return; // R1.4 duplicate: no effect
  if (kind === 'action') {
    if (normId(pl.orderRef) !== S.oid) return;
    const a = String(pl.action || '').trim().toLowerCase();
    if (a !== 'amend' && a !== 'cancel') return;
    S.acts.push({ k: a, at, done: 0 });
    return;
  }
  if (kind === 'carrier') {
    const fid = matchFid(S, pl);
    if (!fid) return;
    const F = S.F[fid];
    const m = translateCode(rbTable(R.fsx, S.ed, 'carrier-codes') ?? latestCodes(R), pl.carrier, pl.code);
    const rt = Number.isFinite(ms(pl.reportedAt)) ? ms(pl.reportedAt) : at;
    if (pl.shipmentId != null && !F.sid) F.sid = String(pl.shipmentId).trim();
    if (m === 'collected' || m === 'inTransit' || m === 'delivered') F.proof = F.proof == null ? rt : Math.min(F.proof, rt);
    if (m === 'collected' || m === 'delivered' || m === 'collectionFailed') {
      if (m === 'collectionFailed' && !TERM_F.has(F.cur)) F.cf = 1;
      F.q = F.q || [];
      F.q.push({ m, at: rt });
    }
  }
}
function latestCodes(R) {
  const eds = editions(R.fsx).filter((e) => rbTable(R.fsx, e.dir, 'carrier-codes') != null);
  eds.sort((a, b) => ((a.eff || '') < (b.eff || '') ? -1 : 1));
  return eds.length ? rbTable(R.fsx, eds[eds.length - 1].dir, 'carrier-codes') : null;
}

function onResult(R, p, at) {
  const S = R.S;
  const op = String(p.op || ''), sys = String(p.system || '');
  const tag = tagOf(S, p.key);
  const e = tag != null ? S.E[tag] : null;
  if (!e) {
    if (sys === 'inventory' && (op === 'allocate' || op === resolveOp(R, 'inventory', 'allocate'))) onReadResult(R, 'alloc', p, at);
    else if (sys === 'fraud' && (op === 'check' || op === resolveOp(R, 'fraud', 'check'))) onReadResult(R, 'fraud', p, at);
    return;
  }
  if (e.o === 'reserve') return onReserveResult(R, e, p, at);
  const c = classify(p);
  if (e.st === 'ok') return;
  const fwStopped = e.fw && (S.stop || (S.F[e.fw] && S.F[e.fw].failAt != null));
  switch (c) {
    case 'ok':
      e.st = 'ok'; e.at = at; delete e.a;
      if (fwStopped) S.F[e.fw].compDone = 0;
      break;
    case 'invalid': learnRename(S, e.s, e.o, p.error ?? p); e.st = 'reissue'; delete e.na; break;
    case 'pred': e.st = 'reissue'; delete e.na; break;
    case 'unknown': case 'conflict': case 'partial': e.st = 'unknown'; break;
    case 'rate': case 'transient': e.st = 'reissue'; e.na = retryAfterMs(p, at); break;
    case 'declined': e.st = 'declined'; e.at = at; break;
    case 'collected': e.st = 'refused'; e.at = at; break;
    default: e.st = 'fail'; e.at = at;
  }
}
function onReserveResult(R, e, p, at) {
  const S = R.S;
  const F = S.F[e.fw];
  if (!F || e.st === 'done') return;
  const c = classify(p);
  const items = Array.isArray(p.items) ? p.items.filter(isObj) : null;
  const keyToSku = {};
  for (const sku of e.items || []) keyToSku[fullKey(S, `rsv:${e.fw}:${sku}`)] = sku;
  const setItem = (sku, ic, ip) => {
    if (F.res[sku] === 'ok') return;
    if (ic === 'ok') F.res[sku] = 'ok';
    else if (ic === 'unknown' || ic === 'conflict') F.res[sku] = 'unknown';
    else if (ic === 'fail' || ic === 'declined' || ic === 'collected') { F.res[sku] = 'fail'; F.resFailAt = F.resFailAt ?? at - MIN; }
    else { if (ic === 'invalid') learnRename(S, 'inventory', 'reserve', ip.error ?? ip); F.res[sku] = 'retry'; }
    if (S.stop || F.failAt != null) F.compDone = 0;
  };
  if (items && items.length && (c === 'ok' || c === 'partial' || items.some((i) => i.status != null))) {
    const seen = new Set();
    for (const ir of items) {
      const sku = keyToSku[String(ir.key)] ?? (ir.sku != null && (e.items || []).includes(String(ir.sku)) ? String(ir.sku) : null);
      if (sku == null) continue;
      seen.add(sku);
      setItem(sku, ir.status == null && c === 'ok' ? 'ok' : classify(ir), ir);
    }
    for (const sku of e.items || []) if (!seen.has(sku)) setItem(sku, c === 'ok' ? 'ok' : c === 'partial' ? 'unknown' : c, p);
    e.st = 'done'; delete e.a;
    return;
  }
  if (c === 'ok') { for (const sku of e.items || []) setItem(sku, 'ok', p); e.st = 'done'; delete e.a; return; }
  if (c === 'invalid') { learnRename(S, 'inventory', 'reserve', p.error ?? p); e.st = 'reissue'; delete e.na; return; }
  if (c === 'pred') { e.st = 'reissue'; return; }
  if (c === 'rate' || c === 'transient') { e.st = 'reissue'; e.na = retryAfterMs(p, at); return; }
  for (const sku of e.items || []) setItem(sku, c === 'partial' ? 'unknown' : c, p);
  e.st = 'done'; delete e.a;
}
function onReadResult(R, w, p, at) {
  const S = R.S;
  const rd = S.rd[w] || (S.rd[w] = { st: null, n: 0 });
  if ((w === 'alloc' && S.alloc) || (w === 'fraud' && S.fraud)) return;
  const d = extractRead(w === 'alloc' ? 'allocate' : 'check', p);
  if (d) { applyRead(R, w, d, at); return; }
  if (classify(p) === 'invalid') learnRename(S, w === 'alloc' ? 'inventory' : 'fraud', w === 'alloc' ? 'allocate' : 'check', p.error ?? p);
  rd.st = 'retry'; rd.na = classify(p) === 'rate' ? retryAfterMs(p, at) : at + MIN;
}
function applyRead(R, w, d, at) {
  const S = R.S;
  if (w === 'alloc') { if (!S.alloc) setAlloc(R, d.fulfilments); }
  else if (!S.fraud) { S.fraud = d.verdict; S.fraudAt = at; }
  S.rd[w] = { st: 'done' };
}

function onTask(R, t, p, at) {
  const S = R.S;
  const rv = S.rev;
  if (!rv) return;
  const tid = p.taskId ?? p.id ?? (isObj(p.task) ? p.task.id : null);
  const isOpen = tid == null || rv.open == null || tid === rv.open;
  if (t === 'humanTask.answered') {
    let ans = p.answer ?? p.value ?? p.response ?? p.data;
    if (typeof ans === 'string') { try { const j = JSON.parse(ans); if (isObj(j)) ans = j; } catch { /* free text */ } }
    let d = isObj(ans) ? ans.decision : (ans === undefined ? p.decision : undefined);
    d = typeof d === 'string' ? d.trim().toLowerCase() : null;
    const when = Number.isFinite(ms(p.answeredAt)) ? ms(p.answeredAt) : at;
    if (d === 'approve' || d === 'reject') {
      if (!rv.dec && !S.stop && when <= rv.dl) { rv.dec = d; rv.decAt = when; }
    }
    if (isOpen) rv.open = null;
    return;
  }
  if (t === 'humanTask.answerRejected' || t === 'humanTask.withdrawn' || t === 'humanTask.timeout') {
    if (isOpen) rv.open = null;
  }
}

// ---------------------------------------------------------------- emission

function emit(R, tag, sys, op, a, afterTag, extra) {
  const S = R.S;
  const key = fullKey(S, tag);
  const rop = resolveOp(R, sys, op);
  const eff = { key, system: sys, op: rop, args: sanitize(renameArgs(R, sys, op, a), argSchema(R, sys, rop)) };
  if (afterTag && R.emitted.has(afterTag)) eff.after = fullKey(S, afterTag);
  R.out.effects.push(eff);
  R.emitted.add(tag);
  const e = { s: sys, o: op, st: 'sent', t: R.now, a };
  if (afterTag) e.af = afterTag;
  if (extra) Object.assign(e, extra);
  S.E[tag] = e;
  return tag;
}
function setSt(R, target, status, afterTag) {
  const S = R.S;
  const isO = target === null;
  const cur = isO ? S.os : S.F[target].cur;
  if (!canMove(isO, cur, status)) return null;
  const tag = `st:${isO ? '-' : target}:${status}`;
  if (S.E[tag]) return null;
  emit(R, tag, 'orders', 'setStatus', { orderId: S.oid, fulfilmentId: isO ? null : target, status }, afterTag);
  if (isO) S.os = status; else { S.F[target].cur = status; R.lastFst = tag; }
  return tag;
}
function notify(R, tpl, about, text) {
  const S = R.S;
  const tag = `ntf:${tpl}:${about}`;
  if (S.E[tag] || S.N[`${tpl}|${normId(about)}`]) return null;
  return emit(R, tag, 'notify', 'send', { to: S.email || S.cust || 'unknown', about, template: tpl, text }, null);
}

// ---------------------------------------------------------------- planning

function* plan(R) {
  const S = R.S, now = R.now;
  yield* resolveUnknowns(R);
  reissuePass(R);

  if (!S.alloc) yield* ensureRead(R, 'alloc');
  if (!S.fraud) yield* ensureRead(R, 'fraud');
  if (!S.alloc) return;

  if (!S.E.create) {
    const total = S.alloc.reduce((a, f) => a + f.amt, 0);
    emit(R, 'create', 'orders', 'create', {
      orderId: S.oid, customerId: S.cust || 'unknown', placedAt: S.p, currency: S.cur,
      items: S.items.length ? S.items : S.alloc.flatMap((f) => f.items),
      fulfilments: S.alloc.map((f) => ({ fulfilmentId: f.f, location: f.loc, items: f.items, amountMinor: f.amt })),
      totalMinor: total,
    });
  }
  if (S.E.create.st !== 'ok') return;
  if (S.os == null) S.os = 'pending';

  fraudLogic(R);
  detectFailures(R);
  evalActions(R);

  if (!S.stop && S.counted && S.counted.k === 'amend' && hasUn(S)) {
    for (const f of S.alloc) if (!f.av) setSt(R, f.f, 'cancelled');
    if (!hasAv(S)) stopOrder(S, 'nothing-available', S.counted.at, 'cancel');
  }
  if (!S.stop && S.cleared != null && S.ready == null) {
    if (!hasUn(S)) S.ready = S.cleared;
    else if (S.counted && S.counted.k === 'amend' && hasAv(S)) S.ready = Math.max(S.cleared, S.counted.at);
  }
  if (!S.stop && S.cleared != null && hasUn(S) && !S.counted && !TERM_O.has(S.os)) {
    setSt(R, null, 'customerActionRequired');
    notify(R, 'action-required', S.oid, `Some items of order ${S.oid} are not available. Please amend or cancel the order by ${iso(deadlineD(S))}.`);
    if (now >= deadlineD(S) + AFTER - MIN) stopOrder(S, 'timeout', now, 'timeout');
  }
  if (S.stop) { yield* doStop(R); return; }
  if (S.ready != null && !TERM_O.has(S.os)) yield* processing(R);
  else if (S.ready != null) yield* lateCompensation(R);
}

// R5.2: a fulfilment fails at the time of the failed attempt or of the carrier's report.
function detectFailures(R) {
  const S = R.S;
  if (S.ready == null) return;
  for (const f of S.alloc) {
    const F = S.F[f.f];
    if (!f.av || F.failAt != null || F.sc || TERM_F.has(F.cur)) continue;
    const bad = (e) => e && (e.st === 'declined' || e.st === 'fail' || e.st === 'refused');
    if (Object.values(F.res).includes('fail')) F.failAt = F.resFailAt ?? R.now;
    else if (bad(S.E[`chg:${f.f}`])) F.failAt = (S.E[`chg:${f.f}`].at ?? R.now) - MIN;
    else if (bad(S.E[`shp:${f.f}`])) F.failAt = (S.E[`shp:${f.f}`].at ?? R.now) - MIN;
    else {
      const cf = (F.q || []).find((r) => r.m === 'collectionFailed');
      const cx = S.E[`cxl:${f.f}`];
      if (cf && !(cx && cx.st !== 'refused' && cx.st !== 'fail')) { F.cf = 1; F.failAt = cf.at; }
    }
  }
}

function stopOrder(S, reason, at, mode) {
  if (S.stop) return;
  S.stop = { r: reason, at, m: mode };
}

function fraudLogic(R) {
  const S = R.S, now = R.now;
  if (S.fraud === 'pass') { if (S.cleared == null) S.cleared = S.pm; return; }
  if (S.fraud === 'reject') { stopOrder(S, 'fraud', S.fraudAt ?? now, 'cancel'); return; }
  if (S.fraud !== 'review') return;
  const rv = S.rev || (S.rev = { n: 0, open: null, dec: null, decAt: null, first: null, dl: null });
  if (rv.first == null) {
    rv.first = now;
    rv.dl = now + (S.pol.frh ?? 24) * HOUR;
    createTask(R);
  }
  if (rv.dec === 'approve') { if (S.cleared == null) S.cleared = rv.decAt; return; }
  if (rv.dec === 'reject') { stopOrder(S, 'fraud', rv.decAt, 'cancel'); return; }
  if (S.stop) return;
  if (now >= rv.dl + AFTER - MIN) { stopOrder(S, 'fraud-review-timeout', now, 'cancel'); return; }
  if (!rv.open && now < rv.dl && !TERM_O.has(S.os)) createTask(R);
}
function createTask(R) {
  const S = R.S, rv = S.rev;
  rv.n += 1;
  const id = K(`FR-${S.oid}-${rv.n}`);
  rv.open = id;
  R.out.humanTasks.push({
    id, kind: 'fraudReview', role: 'fraudAnalyst', subject: S.oid,
    question: `Fraud review for order ${S.oid} (customer ${S.cust}, total ${S.alloc ? S.alloc.reduce((a, f) => a + f.amt, 0) : '?'} minor ${S.cur}). Approve or reject the order by ${iso(rv.dl)}.`,
    answerSchema: {
      type: 'object',
      required: ['decision'],
      properties: { decision: { type: 'string', enum: ['approve', 'reject'] } },
    },
    dueAt: iso(rv.dl),
    onTimeout: 'fraud-review-timeout',
  });
}

function proofAt(S) {
  let m = null;
  for (const F of Object.values(S.F)) if (F.proof != null && (m == null || F.proof < m)) m = F.proof;
  return m;
}
function evalActions(R) {
  const S = R.S;
  if (!S.fraud || !S.alloc) return;
  const D = deadlineD(S);
  S.acts.sort((x, y) => x.at - y.at);
  for (const a of S.acts) {
    if (a.done) continue;
    a.done = 1;
    if (S.stop || TERM_O.has(S.os)) continue; // ended: nothing (cancel-refused is optional)
    const cleared = S.cleared != null && S.cleared <= a.at;
    if (a.k === 'amend') {
      if (!hasUn(S) || S.counted || a.at > D) continue;
      S.counted = { k: 'amend', at: a.at };
      continue;
    }
    if (!cleared) { stopOrder(S, 'customer', a.at, 'cancel'); continue; }
    if (hasUn(S) && !S.counted) {
      if (a.at <= D) { S.counted = { k: 'cancel', at: a.at }; stopOrder(S, 'customer', a.at, 'cancel'); }
      continue;
    }
    const pr = proofAt(S);
    if (pr != null && pr <= a.at) {
      notify(R, 'cancel-refused', S.oid, `Order ${S.oid} can no longer be cancelled: a shipment has already been collected.`);
      continue;
    }
    stopOrder(S, 'customer', a.at, 'cancel');
  }
}

function* processing(R) {
  const S = R.S;
  setSt(R, null, 'processing');
  const av = S.alloc.filter((f) => f.av);
  for (const f of av) setSt(R, f.f, 'processing');
  for (const f of av) applyReports(R, f);
  for (const f of av) forward(R, f);
  for (const f of S.alloc) if (S.F[f.f].failAt != null) yield* handleFail(R, f);
  outcome(R);
}
function* lateCompensation(R) {
  for (const f of R.S.alloc) if (R.S.F[f.f].failAt != null) yield* handleFail(R, f);
}

function applyReports(R, f) {
  const S = R.S, F = S.F[f.f];
  const q = F.q || [];
  F.q = [];
  for (const r of q) {
    if (TERM_F.has(F.cur) || F.failAt != null) continue;
    const cx = S.E[`cxl:${f.f}`];
    if (cx && cx.st !== 'refused' && cx.st !== 'fail') continue;
    if (r.m === 'collected') setSt(R, f.f, 'dispatched');
    else if (r.m === 'delivered') {
      const k1 = setSt(R, f.f, 'dispatched');
      setSt(R, f.f, 'completed', k1);
    } else if (r.m === 'collectionFailed') { F.cf = 1; F.failAt = r.at; }
  }
}

function itemTag(fid, sku) { return `rsv:${fid}:${sku}`; }
function shipRef(S, fid) {
  const r = `${S.oid}/${fid}`;
  return r.length <= 120 ? r : `${S.oid.slice(0, 60)}/${hash(r)}`;
}
function forward(R, f) {
  const S = R.S, F = S.F[f.f];
  if (F.failAt != null || TERM_F.has(F.cur)) return;
  let allOk = true, inflight = false;
  const toSend = [];
  for (const it of f.items) {
    const st = F.res[it.sku];
    if (st === 'ok') continue;
    allOk = false;
    if (st === 'sent' || st === 'unknown' || st === 'wait') inflight = true;
    else if (st === 'fail') { F.failAt = F.resFailAt ?? R.now; return; }
    else toSend.push(it);
  }
  if (!allOk) {
    if (!inflight && toSend.length && (F.bn || 0) < 30) {
      F.bn = (F.bn || 0) + 1;
      emit(R, `rsb:${f.f}:${F.bn}`, 'inventory', 'reserve', {
        orderId: S.oid, fulfilmentId: f.f, location: f.loc,
        items: toSend.map((it) => ({ key: fullKey(S, itemTag(f.f, it.sku)), sku: it.sku, qty: it.qty })),
      }, null, { fw: f.f, items: toSend.map((it) => it.sku) });
      for (const it of toSend) F.res[it.sku] = 'sent';
    }
    return;
  }
  const ce = S.E[`chg:${f.f}`];
  if (!ce) {
    emit(R, `chg:${f.f}`, 'billing', 'charge', { orderId: S.oid, fulfilmentId: f.f, customerId: S.cust || 'unknown', amountMinor: f.amt, currency: S.cur }, null, { fw: f.f });
    return;
  }
  if (ce.st === 'declined' || ce.st === 'fail' || ce.st === 'refused') { F.failAt = ce.at ?? R.now; return; }
  if (ce.st !== 'ok') return;
  const se = S.E[`shp:${f.f}`];
  if (!se) {
    emit(R, `shp:${f.f}`, 'carrier', 'create', { orderId: S.oid, fulfilmentId: f.f, location: f.loc, ref: shipRef(S, f.f) }, null, { fw: f.f });
    return;
  }
  if (se.st === 'fail' || se.st === 'declined' || se.st === 'refused') { F.failAt = se.at ?? R.now; }
}

function* handleFail(R, f) {
  const S = R.S, F = S.F[f.f];
  yield* compensate(R, f);
  if (!TERM_F.has(F.cur)) { if (setSt(R, f.f, 'failed')) F.fu = 1; }
  if (F.fu) notify(R, 'fulfilment-failed', f.f, `Part ${f.f} of order ${S.oid} could not be fulfilled; any payment for it is refunded.`);
}

// committed-ness of one forward step: 'yes' | 'no' | 'wait'
function* committed(R, sys, tag, local) {
  // R5.1: an ok result is committed; anything unresolved is decided by status(key) (S2).
  if (local == null) return 'no';
  if (local === 'mig' || local === 'ok') return 'yes';
  const s = yield* ST(R, sys, fullKey(R.S, tag));
  if (s === 'committed') return 'yes';
  if (s === 'pending') return 'wait';
  if (s === 'not-found') return 'no';
  if (local === 'sent' || local === 'unknown' || local === 'wait') return 'wait';
  return 'no';
}
function localOf(e) {
  if (!e) return null;
  if (e.mig) return 'mig';
  if (e.st === 'reissue' || e.st === 'dead') return 'dead';
  return e.st;
}
function* compensate(R, f) {
  const S = R.S, F = S.F[f.f];
  if (F.compDone) return true;
  const ship = yield* committed(R, 'carrier', `shp:${f.f}`, localOf(S.E[`shp:${f.f}`]));
  const charge = yield* committed(R, 'billing', `chg:${f.f}`, localOf(S.E[`chg:${f.f}`]));
  const items = [];
  for (const it of f.items) {
    const st = F.res[it.sku];
    const local = F.mres && F.mres[it.sku] ? 'mig' : st == null ? null : st === 'retry' || st === 'fail' ? 'dead' : st;
    items.push({ sku: it.sku, c: yield* committed(R, 'inventory', itemTag(f.f, it.sku), local) });
  }
  if (ship === 'wait' || charge === 'wait' || items.some((x) => x.c === 'wait')) { F.compWait = 1; return false; }
  let prev = null;
  if (ship === 'yes' && !F.cf && !S.E[`cxl:${f.f}`]) prev = emit(R, `cxl:${f.f}`, 'carrier', 'cancel', { orderId: S.oid, fulfilmentId: f.f });
  if (charge === 'yes' && !S.E[`rfd:${f.f}`]) prev = emit(R, `rfd:${f.f}`, 'billing', 'refund', { orderId: S.oid, fulfilmentId: f.f, amountMinor: f.amt }, prev);
  for (const x of items) {
    const tag = `rel:${f.f}:${x.sku}`;
    if (x.c === 'yes' && !S.E[tag]) emit(R, tag, 'inventory', 'release', { orderId: S.oid, fulfilmentId: f.f, sku: x.sku }, prev);
  }
  F.compDone = 1; F.compWait = 0;
  return true;
}

function inflight(S, f) {
  const F = S.F[f.f];
  const pend = (e) => e && (e.st === 'sent' || e.st === 'unknown' || e.st === 'wait');
  if (pend(S.E[`chg:${f.f}`]) || pend(S.E[`shp:${f.f}`])) return true;
  for (const st of Object.values(F.res)) if (st === 'sent' || st === 'unknown' || st === 'wait') return true;
  return false;
}
function* doStop(R) {
  const S = R.S;
  R.lastFst = null;
  // A step whose outcome is still open decides whether its fulfilment failed before the stop; wait for it (bounded).
  const patient = R.now - S.stop.at < 30 * MIN;
  let waiting = false;
  for (const f of S.alloc) {
    const F = S.F[f.f];
    if (F.failAt != null && !F.sc && (F.failAt <= S.stop.at || TERM_F.has(F.cur))) { F.q = []; yield* handleFail(R, f); continue; }
    if (!F.sc && !TERM_F.has(F.cur) && patient && inflight(S, f)) { F.compWait = 1; waiting = true; continue; }
    F.q = [];
    if (!TERM_F.has(F.cur)) F.sc = 1;
    if (F.sc) {
      yield* compensate(R, f);
      setSt(R, f.f, 'cancelled');
    }
  }
  if (waiting) return;
  const timeout = S.stop.m === 'timeout';
  setSt(R, null, timeout ? 'timedOut' : 'cancelled', R.lastFst);
  if (timeout) notify(R, 'order-timed-out', S.oid, `Order ${S.oid} was cancelled because no action was taken by ${iso(deadlineD(S))}.`);
  else notify(R, 'order-cancelled', S.oid, `Order ${S.oid} has been cancelled (reason: ${S.stop.r}).`);
}

function outcome(R) {
  const S = R.S;
  if (S.os !== 'processing') return;
  const cs = S.alloc.map((f) => S.F[f.f].cur);
  if (!cs.every((c) => TERM_F.has(c) || c === 'unavailable')) return;
  const res = cs.includes('completed') ? 'completed' : cs.includes('failed') ? 'failed' : 'cancelled';
  setSt(R, null, res, R.lastFst);
}

function* ensureRead(R, w) {
  const S = R.S;
  const rd = S.rd[w] || (S.rd[w] = { st: null, n: 0 });
  if (rd.st === 'done') return;
  if (rd.st === 'sent' && R.now - rd.t < 10 * MIN) return;
  if (rd.st === 'retry' && R.now < rd.na) return;
  const sys = w === 'alloc' ? 'inventory' : 'fraud', op = w === 'alloc' ? 'allocate' : 'check';
  if (!rd.ns) {
    const d = yield* syncRead(R, sys, op, { orderId: S.oid });
    if (d) { applyRead(R, w, d, R.now); return; }
    rd.ns = 1;
  }
  if ((rd.n || 0) >= 8) return;
  rd.n = (rd.n || 0) + 1; rd.st = 'sent'; rd.t = R.now;
  const rop = resolveOp(R, sys, op);
  R.out.effects.push({ system: sys, op: rop, args: sanitize(renameArgs(R, sys, op, { orderId: S.oid }), argSchema(R, sys, rop)) });
}

function* resolveUnknowns(R) {
  const S = R.S, now = R.now;
  for (const [tag, e] of Object.entries(S.E)) {
    const stale = e.st === 'sent' && e.t != null && now - e.t >= 30 * MIN;
    if (!(stale || e.st === 'unknown' || (e.st === 'wait' && now >= (e.na ?? 0)))) continue;
    if (e.o === 'reserve') { if (stale) { e.st = 'done'; for (const sku of e.items || []) if (S.F[e.fw].res[sku] === 'sent') S.F[e.fw].res[sku] = 'unknown'; } continue; }
    const s = yield* ST(R, e.s, fullKey(S, tag));
    if (s === 'committed') {
      e.st = 'ok'; e.at = now; delete e.a;
      if (e.fw && (S.stop || S.F[e.fw].failAt != null)) S.F[e.fw].compDone = 0;
    } else if (s === 'pending') { e.st = 'wait'; e.na = now + RECHECK; }
    else { e.st = 'reissue'; delete e.na; }
  }
  for (const f of S.alloc || []) {
    const F = S.F[f.f];
    for (const it of f.items) {
      const st = F.res[it.sku];
      if (!(st === 'unknown' || (st === 'wait' && now >= (F.rwna ?? 0)))) continue;
      const s = yield* ST(R, 'inventory', fullKey(S, itemTag(f.f, it.sku)));
      if (s === 'committed') { F.res[it.sku] = 'ok'; if (S.stop || F.failAt != null) F.compDone = 0; }
      else if (s === 'pending') { F.res[it.sku] = 'wait'; F.rwna = now + RECHECK; }
      else F.res[it.sku] = 'retry';
    }
  }
}
function reissuePass(R) {
  const S = R.S, now = R.now;
  for (const [tag, e] of Object.entries(S.E)) {
    if (e.st !== 'reissue' || (e.na != null && e.na > now)) continue;
    if (e.fw && (S.stop || (S.F[e.fw] && S.F[e.fw].failAt != null))) {
      e.st = 'dead';
      if (e.o === 'reserve') for (const sku of e.items || []) if (S.F[e.fw].res[sku] === 'sent') S.F[e.fw].res[sku] = 'retry';
      continue;
    }
    if (!e.a || (e.rc || 0) >= 8) { e.st = 'fail'; e.at = now; continue; }
    const extra = { rc: (e.rc || 0) + 1 };
    for (const k of ['fw', 'items']) if (e[k] != null) extra[k] = e[k];
    emit(R, tag, e.s, e.o, e.a, e.af, extra);
  }
}

// ---------------------------------------------------------------- obligations & closing

function shouldClose(R) {
  const S = R.S;
  if (!TERM_O.has(S.os)) return false;
  for (const e of Object.values(S.E)) if (['sent', 'unknown', 'wait', 'reissue'].includes(e.st)) return false;
  for (const f of S.alloc || []) {
    const F = S.F[f.f];
    if ((F.sc || F.failAt != null) && !F.compDone) return false;
    for (const st of Object.values(F.res)) if (st === 'sent' || st === 'unknown' || st === 'wait') return false;
  }
  return true;
}
function timers(R, closing) {
  const S = R.S, now = R.now;
  const want = {};
  if (!closing) {
    if (S.fraud === 'review' && S.rev && S.rev.dl != null && !S.rev.dec && !S.stop) want.rev = { due: S.rev.dl + AFTER, anchor: S.rev.first };
    if (S.alloc && hasUn(S) && !S.counted && !S.stop && !TERM_O.has(S.os)) want.cad = { due: deadlineD(S) + AFTER, anchor: S.pm };
    let re = Infinity;
    for (const e of Object.values(S.E)) {
      if (e.st === 'wait') re = Math.min(re, e.na ?? now + RECHECK);
      if (e.st === 'reissue' && e.na != null && e.na > now) re = Math.min(re, e.na);
      if (e.st === 'sent' && now - (e.t ?? now) >= 30 * MIN) re = Math.min(re, now + RECHECK);
    }
    for (const f of S.alloc || []) {
      const F = S.F[f.f];
      if (Object.values(F.res).includes('wait')) re = Math.min(re, F.rwna ?? now + RECHECK);
      if (F.compWait && !F.compDone) re = Math.min(re, now + RECHECK);
    }
    for (const w of ['alloc', 'fraud']) {
      const rd = S.rd[w];
      if (rd && rd.st === 'retry') re = Math.min(re, rd.na ?? now + MIN);
      if (rd && rd.st === 'sent') re = Math.min(re, rd.t + 10 * MIN);
    }
    if (re < Infinity) want.re = { due: Math.max(re, now + MIN), anchor: now };
  }
  for (const [name, w] of Object.entries(want)) {
    const dueIso = iso(w.due);
    const cur = S.T[name];
    if (cur && cur.due === dueIso) continue;
    if (w.due <= now) continue;
    const id = K(`OB-${S.oid}-${name}`);
    R.out.obligations.upsert.push({ id, kind: 'deadline', anchor: iso(w.anchor), dueAt: dueIso, onDue: name });
    S.T[name] = { id, due: dueIso };
  }
  for (const [name, cur] of Object.entries(S.T)) {
    if (want[name]) continue;
    R.out.obligations.cancel.push(cur.id);
    delete S.T[name];
  }
}
