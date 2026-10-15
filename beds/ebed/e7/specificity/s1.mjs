// E7 blind specificity solver s1 (author #1), written from the arm files alone (SPEC-E.md, CONTRACT.md,
// TASK.md, api/*.schema.json) and BED-CONTRACT v1.1 §3. No model or API calls; deterministic; Node 24 ESM.
//
// Shape: one owner instance per incident keeps a per-incident history of business events in its carry and,
// on every case-tick, replays that history rule by rule (R1-R8) into a timeline of incident snapshots, runs
// the SLA engine (R4) at every change, recomputes all SLA business time from scratch over the calendars,
// derives the full list of effects the rules require (each with a stable idempotency key and its window),
// and emits the ones that are due and not yet committed. Messages that start a new instance are routed to
// the incident's owner with `merge`, or answered with nothing and `close`. Readings are in s1.NOTES.md.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MIN = 60000;
const DAY = 86400000;
const OPEN_STATES = new Set(['assigned', 'inProgress', 'onHold']);
const TERMINAL = new Set(['resolved', 'closed', 'cancelled']);
const ENDED = new Set(['closed', 'cancelled']);
const DEFAULT_TZ = 'Europe/Amsterdam';
const MAX_ATTEMPTS = 8;
const MESSAGE_KINDS = new Set(['report', 'alert', 'caller', 'resolver']);

export function createSolver() {
  return {
    id: 's1',
    tick(input, ctx) { return drive(main(input, ctx)); },
  };
}
export default createSolver;

// ---------------------------------------------------------------------------------------------------------
// Generator driver: runs synchronously when every ctx call returns a plain value, and switches to a
// Promise as soon as one returns a thenable (so the solver works with a sync or an async host).

function drive(gen) {
  let step = gen.next();
  while (!step.done) {
    const v = step.value;
    if (v && typeof v.then === 'function') return driveAsync(gen, v);
    step = gen.next(v);
  }
  return step.value;
}

async function driveAsync(gen, first) {
  let pending = first;
  for (;;) {
    let v, err = null;
    try { v = await pending; } catch (e) { err = e; }
    const step = err ? gen.throw(err) : gen.next(v);
    if (step.done) return step.value;
    pending = step.value;
  }
}

function safe(fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') return r.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
    return { ok: true, v: r };
  } catch (e) {
    return { ok: false, e };
  }
}

// ---------------------------------------------------------------------------------------------------------
// Small helpers

const lower = (v) => (v == null ? '' : String(v).trim().toLowerCase());
const str = (v) => (v == null ? null : String(v).trim());
const toNum = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const toInt = (v) => { const n = toNum(v); return n != null && Number.isInteger(n) ? n : null; };
const clampInt = (v, lo, hi) => { const n = toInt(v); return n != null && n >= lo && n <= hi ? n : null; };
const eqId = (a, b) => a != null && b != null && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const eqStr = (a, b) => (a == null || a === '' ? (b == null || b === '') : eqId(a, b));
function eqVal(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}
function normInc(v) {
  if (v == null) return '';
  return String(v).trim().replace(/^#/, '').trim().toUpperCase();
}
const isAwaitingCaller = (r) => lower(r) === 'awaitingcaller';

function hk(s) {
  let h1 = 0x811c9dc5, h2 = 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return h1.toString(36) + h2.toString(36).slice(0, 4);
}
const capKey = (k) => (k.length <= 190 ? k : `${k.slice(0, 160)}~${hk(k)}`);

function cmpInst(a, b) {
  const na = /(\d+)\D*$/.exec(String(a)), nb = /(\d+)\D*$/.exec(String(b));
  if (na && nb && na[1] !== nb[1]) { const d = Number(na[1]) - Number(nb[1]); if (d) return d; }
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------------------
// Time: platform instants are ISO strings at +01:00; we compute in epoch ms and write +01:00 back.

function parseT(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const ms = Date.parse(String(v).trim());
  return Number.isFinite(ms) ? ms : null;
}
const pad = (n) => String(n).padStart(2, '0');
function fmt(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  const d = new Date(ms + 3600000);
  const s = d.getUTCSeconds();
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${s ? ':' + pad(s) : ''}+01:00`;
}
const ceilMin = (ms) => Math.ceil(ms / MIN) * MIN;

const DTF = new Map();
function dtf(tz) {
  let f = DTF.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      f = tz === DEFAULT_TZ ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : dtf(DEFAULT_TZ);
    }
    DTF.set(tz, f);
  }
  return f;
}
function localAsUtc(ms, tz) {
  const p = {};
  for (const x of dtf(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
}
function localDate(ms, tz) { return new Date(localAsUtc(ms, tz)).toISOString().slice(0, 10); }
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function isoWeekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

// The instant at which the local clock (in tz) first reads `minutes` after midnight of dateStr (R4.4). In a
// skipped hour the clock never reads it; we take the instant it first reads a later time (the jump).
const L2I = new Map();
function localToInstant(dateStr, minutes, tz) {
  if (minutes >= 1440) { dateStr = addDays(dateStr, Math.floor(minutes / 1440)); minutes %= 1440; }
  const ck = `${tz}|${dateStr}|${minutes}`;
  const hit = L2I.get(ck);
  if (hit !== undefined) return hit;
  const [y, m, d] = dateStr.split('-').map(Number);
  const L = Date.UTC(y, m - 1, d) + minutes * MIN;
  const o1 = localAsUtc(L - DAY, tz) - (L - DAY);
  const o2 = localAsUtc(L + DAY, tz) - (L + DAY);
  const c1 = L - o1, c2 = L - o2;
  const lo0 = Math.min(c1, c2), hi0 = Math.max(c1, c2);
  let res = null;
  for (const c of [lo0, hi0]) if (localAsUtc(c, tz) === L) { res = c; break; }
  if (res == null) {
    let lo = lo0, hi = hi0;
    while (hi - lo > MIN) {
      const mid = lo + Math.floor((hi - lo) / 2 / MIN) * MIN;
      if (localAsUtc(mid, tz) >= L) hi = mid; else lo = mid;
    }
    res = hi;
  }
  if (L2I.size > 200000) L2I.clear();
  L2I.set(ck, res);
  return res;
}

// ---------------------------------------------------------------------------------------------------------
// Calendars and business time (R4.4). A schedule is { cal, tz } or null for 24x7.

function hm(v) {
  if (typeof v === 'number') return v;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v ?? '').trim());
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}
const DAY_NAMES = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
function dayNum(v) {
  const n = toInt(v);
  if (n != null) return n === 0 ? 7 : n;
  return DAY_NAMES[lower(v).slice(0, 3)] ?? null;
}
function is24x7(bh) { return bh == null || (typeof bh === 'string' && /24\s*[x×]\s*7/i.test(bh)); }

function daySpans(cal, dateStr) {
  const bh = cal.businessHours;
  if (is24x7(bh)) return [[0, 1440]];
  if (typeof bh !== 'object') return [];
  const days = (Array.isArray(bh.days) ? bh.days : [1, 2, 3, 4, 5]).map(dayNum);
  if (!days.includes(isoWeekday(dateStr))) return [];
  const out = [];
  for (const h of Array.isArray(bh.hours) ? bh.hours : []) {
    const a = hm(Array.isArray(h) ? h[0] : (h?.from ?? h?.start));
    let b = hm(Array.isArray(h) ? h[1] : (h?.to ?? h?.end));
    if (a == null || b == null) continue;
    if (b <= a) b += 1440;
    out.push([a, b]);
  }
  return out;
}

function holidayClosures(cal, dateStr, tz) {
  const out = [];
  for (const h of Array.isArray(cal.holidays) ? cal.holidays : []) {
    const date = typeof h === 'string' ? h : h?.date;
    if (!date || String(date).slice(0, 10) !== dateStr) continue;
    const f = typeof h === 'object' && h.from != null ? hm(h.from) : 0;
    const t = typeof h === 'object' && h.to != null ? hm(h.to) : 1440;
    if (f == null || t == null) continue;
    out.push([localToInstant(dateStr, f, tz), localToInstant(dateStr, t, tz)]);
  }
  return out;
}

function mergeIv(list) {
  const s = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
function subtractIv(ivs, cls) {
  let out = ivs;
  for (const [ca, cb] of cls) {
    const next = [];
    for (const [a, b] of out) {
      if (cb <= a || ca >= b) { next.push([a, b]); continue; }
      if (ca > a) next.push([a, ca]);
      if (cb < b) next.push([cb, b]);
    }
    out = next;
  }
  return out;
}

function openBetween(sched, A, B) {
  if (!(B > A)) return [];
  if (!sched) return [[A, B]];
  const { cal, tz } = sched;
  const d0 = addDays(localDate(A, tz), -1);
  const d1 = addDays(localDate(B, tz), 1);
  let ivs = [];
  const cls = [];
  for (let d = d0, n = 0; d <= d1 && n < 4000; d = addDays(d, 1), n++) {
    for (const [a, b] of daySpans(cal, d)) ivs.push([localToInstant(d, a, tz), localToInstant(d, b, tz)]);
    cls.push(...holidayClosures(cal, d, tz));
  }
  ivs = mergeIv(ivs);
  if (cls.length) ivs = subtractIv(ivs, mergeIv(cls));
  const out = [];
  for (const [a, b] of ivs) { const x = Math.max(a, A), y = Math.min(b, B); if (y > x) out.push([x, y]); }
  return out;
}

function bizMinutes(sched, runs) {
  let s = 0;
  for (const [a, b] of runs) for (const [x, y] of openBetween(sched, a, b)) s += (y - x) / MIN;
  return s;
}

// The first instant at which `amount` minutes of business time have accumulated over `runs` (sorted
// [a, b) running intervals; b may be Infinity). An amount reached at a closing time is reached there (S4).
function reach(sched, runs, amount) {
  if (amount == null || !Number.isFinite(amount) || !runs.length) return null;
  if (amount <= 0) return runs[0][0];
  let acc = 0;
  for (const [a, b] of runs) {
    if (!(b > a)) continue;
    if (!sched) {
      const len = (b - a) / MIN;
      if (acc + len >= amount) return a + (amount - acc) * MIN;
      acc += len;
      continue;
    }
    let cur = a, guard = 0;
    while (cur < b) {
      const end = Math.min(b, cur + 14 * DAY);
      for (const [x, y] of openBetween(sched, cur, end)) {
        const len = (y - x) / MIN;
        if (acc + len >= amount) return x + (amount - acc) * MIN;
        acc += len;
      }
      cur = end;
      if (++guard > 130) return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Files (ctx.files may be a flat or nested object, a Map, an array, a reader function, or a directory path).

const FILE_EXT = /\.(json|md|txt|csv)$/i;
const normPath = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');

function flatten(obj, prefix, map, depth) {
  if (depth > 6 || obj == null) return;
  for (const k of Object.keys(obj)) {
    const p = prefix ? `${prefix}/${k}` : k;
    const v = obj[k];
    if (FILE_EXT.test(k)) map.set(normPath(p), v);
    else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array) && typeof v.then !== 'function') flatten(v, p, map, depth + 1);
  }
}
function walkDir(root, rel, map, depth = 0) {
  if (depth > 6) return;
  let ents = [];
  try { ents = readdirSync(join(root, rel)); } catch { return; }
  for (const name of ents) {
    const r = rel ? `${rel}/${name}` : name;
    const full = join(root, r);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walkDir(root, r, map, depth + 1);
    else map.set(normPath(r), () => readFileSync(full, 'utf8'));
  }
}
function parseCsv(text) {
  if (typeof text !== 'string') return text;
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = l.split(',').map((c) => c.trim());
    const o = {};
    head.forEach((h, i) => { const c = cells[i] ?? ''; o[h] = c !== '' && Number.isFinite(Number(c)) ? Number(c) : c; });
    return o;
  });
}
function decode(path, v) {
  if (v == null) return undefined;
  if (v instanceof Uint8Array) v = Buffer.from(v).toString('utf8');
  if (v && typeof v === 'object' && !Array.isArray(v) && 'path' in v && ('content' in v || 'text' in v)) v = v.content ?? v.text;
  if (typeof v === 'string' && /\.json$/i.test(path)) { try { return JSON.parse(v); } catch { return undefined; } }
  if (typeof v === 'string' && /\.csv$/i.test(path)) return parseCsv(v);
  return v;
}

function* fileSource(ctx) {
  const f = ctx ? ctx.files : null;
  const map = new Map();
  let reader = null;
  if (typeof f === 'string') walkDir(f, '', map);
  else if (f instanceof Map) { for (const [k, v] of f) map.set(normPath(k), v); }
  else if (Array.isArray(f)) {
    for (const e of f) {
      if (typeof e === 'string') map.set(normPath(e), undefined);
      else if (e && typeof e === 'object' && (e.path || e.name)) map.set(normPath(e.path ?? e.name), 'content' in e ? e.content : (e.text ?? e.data));
    }
  } else if (f && (typeof f === 'object' || typeof f === 'function')) {
    if (typeof f === 'object') flatten(f, '', map, 0);
    if (typeof f === 'function') reader = (p) => f(p);
    else if (typeof f.read === 'function') reader = (p) => f.read(p);
    else if (typeof f.get === 'function') reader = (p) => f.get(p);
    if (!map.size) {
      for (const m of ['list', 'keys', 'paths']) {
        if (typeof f[m] !== 'function') continue;
        const r = yield safe(() => f[m]());
        if (r.ok && r.v && typeof r.v[Symbol.iterator] === 'function') {
          for (const p of r.v) if (typeof p === 'string') map.set(normPath(p), undefined);
          break;
        }
      }
    }
  }
  const cache = new Map();
  function* read(p0) {
    const p = normPath(p0);
    if (cache.has(p)) return cache.get(p);
    let v = map.get(p);
    if (v === undefined && reader) { const r = yield safe(() => reader(p)); v = r.ok ? r.v : undefined; }
    if (typeof v === 'function') { const r = yield safe(() => v()); v = r.ok ? r.v : undefined; }
    if (v && typeof v.then === 'function') { const r = yield safe(() => v); v = r.ok ? r.v : undefined; }
    const d = decode(p, v);
    cache.set(p, d);
    return d;
  }
  return { paths: [...map.keys()], read };
}

function asList(x) {
  if (x == null) return [];
  if (Array.isArray(x)) return x;
  if (typeof x !== 'object') return [];
  const arrs = Object.values(x).filter(Array.isArray);
  if (arrs.length === 1) return arrs[0];
  const ents = Object.entries(x);
  if (ents.length && ents.every(([, v]) => v && typeof v === 'object' && !Array.isArray(v))) return ents.map(([k, v]) => ({ id: k, ...v }));
  return [];
}

const EMPTY_ED = { dir: '', id: '', from: '', priority: [], assignment: [], alertUrgency: null, slaDefs: [], policy: {} };

function* loadEnv(ctx) {
  const F = yield* fileSource(ctx);
  const env = {
    editions: [], ciList: [], cis: new Map(), services: new Map(), groups: new Map(), groupList: [],
    users: new Map(), userList: [], cals: new Map(), api: {}, sysTz: DEFAULT_TZ,
  };
  const J = function* (p) { return yield* F.read(p); };
  env.ciList = asList(yield* J('master/cis.json'));
  for (const c of env.ciList) if (c && c.id != null) env.cis.set(String(c.id), c);
  for (const s of asList(yield* J('master/services.json'))) if (s && s.id != null) env.services.set(String(s.id), s);
  env.groupList = asList(yield* J('master/groups.json'));
  for (const g of env.groupList) if (g && g.id != null) env.groups.set(String(g.id), g);
  env.userList = asList(yield* J('master/users.json'));
  for (const u of env.userList) if (u && u.id != null) env.users.set(String(u.id), u);
  for (const p of F.paths) {
    const m = /^calendar\/(.+)\.json$/i.exec(p);
    if (!m) continue;
    const c = yield* J(p);
    if (c && typeof c === 'object') env.cals.set(String(c.id ?? m[1]), c);
  }
  const dirs = new Set();
  for (const p of F.paths) { const m = /^rulebook\/([^/]+)\//.exec(p); if (m) dirs.add(m[1]); }
  for (const dir of [...dirs].sort()) {
    const pick = function* (name) {
      let v = yield* J(`rulebook/${dir}/${name}.json`);
      if (v === undefined && F.paths.includes(`rulebook/${dir}/${name}.csv`)) v = yield* J(`rulebook/${dir}/${name}.csv`);
      return v;
    };
    const e = (yield* pick('edition')) ?? {};
    env.editions.push({
      dir,
      id: String(e.id ?? dir),
      from: String(e.effectiveFrom ?? '0000-00-00').slice(0, 10),
      priority: asList(yield* pick('priority')),
      assignment: asList(yield* pick('assignment')),
      alertUrgency: yield* pick('alert-urgency'),
      slaDefs: asList(yield* pick('sla-definitions')),
      policy: (yield* pick('policy')) ?? {},
    });
  }
  for (const s of ['itsm', 'sla', 'notify']) env.api[s] = yield* J(`api/${s}.schema.json`);
  const withTz = env.editions.find((e) => e.policy && e.policy.systemTimeZone);
  if (withTz) env.sysTz = String(withTz.policy.systemTimeZone);
  const findIn = (list, raw, fields) => {
    const k = lower(raw);
    if (!k) return null;
    for (const f of fields) {
      const hit = list.find((x) => x && (f === 'aliases'
        ? (Array.isArray(x.aliases) && x.aliases.some((a) => lower(a) === k))
        : lower(x[f]) === k));
      if (hit) return hit;
    }
    return null;
  };
  env.ciFind = (raw) => findIn(env.ciList, raw, ['id', 'name', 'aliases']);
  env.userFind = (raw) => findIn(env.userList, raw, ['id', 'email']);
  env.groupFind = (raw) => { const g = findIn(env.groupList, raw, ['id', 'name', 'aliases']); return g ? String(g.id) : null; };
  return env;
}

// R0: the published edition with the latest effectiveFrom on or before the local date of `ms`. An edition
// counts as published at an instant from the first tick that saw its files (C.ed), or always when it was
// already there on the instance's first tick.
function edAt(env, C, ms) {
  const date = localDate(ms, env.sysTz);
  let best = null, earliest = null;
  for (const e of env.editions) {
    if (!earliest || e.from < earliest.from) earliest = e;
    const seen = C && C.ed ? C.ed[e.dir] : null;
    if (seen != null && seen > ms) continue;
    if (e.from <= date && (!best || e.from > best.from || (e.from === best.from && e.dir > best.dir))) best = e;
  }
  return best ?? earliest ?? EMPTY_ED;
}

function priorityFor(ed, service, impact, urgency) {
  let best = null;
  for (const r of asList(ed && ed.priority)) {
    if (!r || toInt(r.impact) !== impact || toInt(r.urgency) !== urgency) continue;
    const sv = r.service == null ? '*' : String(r.service).trim();
    if (sv !== '*' && !eqId(sv, service)) continue;
    const o = toNum(r.order) ?? Infinity;
    if (!best || o < best.o) best = { o, p: toInt(r.priority) };
  }
  const p = best ? best.p : null;
  if (p != null && p >= 1 && p <= 5) return p;
  return Math.min(5, Math.max(1, (impact ?? 3) + (urgency ?? 3) - 1));
}

function groupFor(env, ed, category, region, ci) {
  let best = null;
  for (const r of asList(ed && ed.assignment)) {
    if (!r) continue;
    const c = r.category == null ? '*' : String(r.category).trim();
    const g = r.region == null ? '*' : String(r.region).trim();
    if (c !== '*' && !eqId(c, category)) continue;
    if (g !== '*' && !eqId(g, region)) continue;
    const o = toNum(r.order) ?? Infinity;
    if (!best || o < best.o) best = { o, g: r.group };
  }
  if (!best || best.g == null) return null;
  let g = String(best.g).trim();
  if (g === 'ciSupportGroup') g = ci && ci.supportGroup != null ? String(ci.supportGroup) : null;
  if (!g) return null;
  return env.groupFind(g) ?? g;
}

function alertUrgency(ed, sev) {
  const s = lower(sev);
  if (!s) return null;
  const look = (obj, depth) => {
    if (obj == null || depth > 3) return undefined;
    if (Array.isArray(obj)) {
      for (const r of obj) if (r && typeof r === 'object' && lower(r.severity ?? r.id ?? r.key ?? r.name) === s) return r.urgency ?? null;
      return undefined;
    }
    if (typeof obj === 'object') {
      for (const k of Object.keys(obj)) {
        if (k.trim().toLowerCase() !== s) continue;
        const v = obj[k];
        return v && typeof v === 'object' && !Array.isArray(v) ? (v.urgency ?? null) : v;
      }
      for (const v of Object.values(obj)) if (v && typeof v === 'object') { const r = look(v, depth + 1); if (r !== undefined) return r; }
    }
    return undefined;
  };
  return clampInt(look(ed && ed.alertUrgency, 0), 1, 3);
}

function sdSched(env, pol) {
  const id = pol ? pol.serviceDeskCalendar : null;
  if (id == null) return null;
  const cal = env.cals.get(String(id));
  return cal ? { cal, tz: cal.tz || env.sysTz } : null;
}

// ---------------------------------------------------------------------------------------------------------
// Events

function unwrap(p0) {
  for (const k of ['message', 'body', 'data', 'content', 'fields', 'payload']) {
    const v = p0[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) return { ...v, ...p0 };
  }
  return p0;
}

function classify(ev) {
  const type = String(ev && ev.type != null ? ev.type : '');
  const p0 = ev && ev.payload && typeof ev.payload === 'object' ? ev.payload : {};
  if (type === 'migration') return { kind: 'migration', p: p0 };
  if (type === 'effect.result') return { kind: 'result', p: p0 };
  if (type === 'timer.fired') return { kind: 'timer', p: p0 };
  if (type.startsWith('humanTask.')) return { kind: 'ht', sub: type.slice('humanTask.'.length), p: p0 };
  if (type === 'edition.published' || type.startsWith('world.')) return { kind: 'ignore', p: p0 };
  const p = unwrap(p0);
  const hint = [type, p0.type, p0.kind, p0.messageType, p0.eventType, p0.event, p0.name].filter((x) => typeof x === 'string').join(' ').toLowerCase();
  const src = lower(ev && ev.source);
  if (hint.includes('incident.reported')) return { kind: 'report', p };
  if (hint.includes('alert.raised')) return { kind: 'alert', p };
  if (hint.includes('caller.message')) return { kind: 'caller', p };
  if (hint.includes('resolver.update')) return { kind: 'resolver', p };
  if (p.reportId != null) return { kind: 'report', p };
  if (p.alertId != null) return { kind: 'alert', p };
  if (p.incidentRef != null) return { kind: 'caller', p };
  if (p.action != null && p.number != null) return { kind: 'resolver', p };
  if (src === 'portal') return { kind: 'report', p };
  if (src === 'monitor') return { kind: 'alert', p };
  if (src === 'mail') return { kind: 'caller', p };
  if (src === 'workspace') return { kind: 'resolver', p };
  return { kind: 'unknown', p };
}

function htFields(p0) {
  const taskId = p0.taskId ?? p0.humanTaskId ?? (p0.task && typeof p0.task === 'object' ? p0.task.id : p0.task) ?? p0.id ?? null;
  let ans = p0.answer ?? p0.value ?? p0.response ?? p0.result;
  if (typeof ans === 'string') { try { ans = JSON.parse(ans); } catch { /* free text */ } }
  let decision = ans && typeof ans === 'object' ? ans.decision : undefined;
  if (decision === undefined && !(ans && typeof ans === 'object')) decision = p0.decision;
  decision = typeof decision === 'string' ? decision.trim().toLowerCase() : null;
  return { taskId: taskId == null ? null : String(taskId), decision };
}

// Compact history record of one business event (null fields dropped to keep the carry small).
function compact(ev, cls, k, now) {
  const h = compactFull(ev, cls, k, now);
  if (h) for (const key of Object.keys(h)) if (h[key] == null || h[key] === '') delete h[key];
  if (h && h.s == null) h.s = '';
  if (h && h.i == null) h.i = '';
  return h;
}
function compactFull(ev, cls, k, now) {
  const p = cls.p || {};
  const t = parseT(ev.at) ?? now;
  const b = { y: cls.kind, t, k, s: String(ev.source ?? ''), i: String(ev.id ?? '') };
  switch (cls.kind) {
    case 'report':
      return { ...b, reportId: str(p.reportId), callerId: str(p.callerId), ci: str(p.ci), category: str(p.category), urgency: toInt(p.urgency), summary: String(p.summary ?? '').slice(0, 400) };
    case 'alert':
      return { ...b, alertId: str(p.alertId), ci: str(p.ci), check: p.check == null ? null : String(p.check), severity: str(p.severity) };
    case 'caller':
      return { ...b, ref: normInc(p.incidentRef), intent: lower(p.intent), from: str(p.from) };
    case 'resolver':
      return {
        ...b, number: normInc(p.number), group: str(p.group), user: str(p.user), action: lower(p.action),
        holdReason: p.holdReason == null ? null : String(p.holdReason).trim(), toGroup: str(p.toGroup),
        impact: clampInt(p.impact, 1, 3), urgency: clampInt(p.urgency, 1, 3),
        closeCode: p.closeCode == null ? null : String(p.closeCode).trim(),
      };
    case 'ht':
      return { ...b, sub: cls.sub, ...htFields(p) };
    default:
      return null;
  }
}
function sigOf(h) {
  const { k, i, s, ...rest } = h;
  return JSON.stringify(rest);
}
function cmpEv(a, b) {
  return (a.t - b.t) || (a.k - b.k) || (a.s < b.s ? -1 : a.s > b.s ? 1 : 0) || cmpInst(a.i, b.i);
}

// ---------------------------------------------------------------------------------------------------------
// SLA helpers

function fieldVal(s, f) {
  switch (f) {
    case 'source': return s.sourceKind ?? null;
    case 'holdReason': return s.state === 'onHold' ? (s.holdReason ?? null) : null;
    case 'major': return !!s.major;
    default: return s[f] ?? null;
  }
}
function holds(list, s) {
  if (!Array.isArray(list) || list.length === 0 || !s) return false;
  return list.every((c) => c && Array.isArray(c.in) && c.in.some((v) => eqVal(fieldVal(s, c.field), v)));
}
function targetOf(def) {
  if (!def) return null;
  if (typeof def.target === 'number') return def.target;
  return toNum(def.target && def.target.minutes);
}
function runsOf(sla, until) {
  const end = Math.min(until, sla.endAt ?? Infinity);
  const res = [];
  let cur = sla.startAt;
  const ps = sla.pauses.slice().sort((a, b) => a.from - b.from);
  for (const p of ps) {
    if (p.from >= end) break;
    if (p.from > cur) res.push([cur, p.from]);
    cur = Math.max(cur, p.to ?? Infinity);
    if (cur >= end) break;
  }
  if (cur < end) res.push([cur, end]);
  return res;
}

// ---------------------------------------------------------------------------------------------------------
// The per-incident replay. Pure: (env, carry, now) -> timeline state, required effects, wake-ups.

function simulate(env, C, now) {
  const num = C.num;
  const E = (t) => edAt(env, C, t);
  const out = [];
  const outKeys = new Set();
  let S = null;
  const snaps = [];
  const slas = [];
  let lastItsm = null, createKey = null;
  let callerDl = null, confirmDl = null;
  const A = { x: null, moot: false, counted: null, declared: false };
  let everP1 = false;
  let changed = false, creation = false, phaseNo = 0;
  const seq = new Map();
  const hist = (C.hist || []).slice().sort(cmpEv);

  const W15 = (t) => ({ from: t, to: t + 15 * MIN });
  const WD = (t, m) => ({ from: t + MIN, to: t + m * MIN });
  const snapCopy = (s) => ({ ...s, alerts: (s.alerts || []).slice() });
  const seqKey = (op, t) => { const k = `${op}|${t}`; const n = seq.get(k) ?? 0; seq.set(k, n + 1); return `${fmt(t)}#${n}`; };
  const callerEmail = () => (S && S.callerId ? (env.users.get(String(S.callerId)) || env.userFind(S.callerId) || {}).email ?? null : null);
  const ownerOf = () => (S ? (env.services.get(String(S.service)) || {}).owner ?? null : null);

  function pushEff(e) {
    e.key = capKey(e.key);
    if (outKeys.has(e.key)) return false;
    outKeys.add(e.key);
    out.push(e);
    return true;
  }
  function itsm(op, args, win, suffix) {
    const key = `itsm.${op}|${num}${suffix != null ? '|' + suffix : ''}`;
    if (pushEff({ key, sys: 'itsm', op, args, from: win.from, to: win.to, dep: lastItsm })) lastItsm = capKey(key);
  }
  function notify(template, to, text, win, occ) {
    if (!to) return;
    pushEff({ key: `notify.send|${num}|${template}|${occ}`, sys: 'notify', op: 'send', args: { to: String(to), about: num, template, text: String(text).slice(0, 4000) }, from: win.from, to: win.to, dep: createKey });
  }
  function apprPending() { return A.x != null && !A.moot && !A.counted && !A.declared && !!C.appr; }
  function p1Check(t) { if (S.priority === 1 && !everP1) { everP1 = true; A.x = t; } }
  function mootCheck(t) {
    if (!S || A.x == null || A.moot || A.counted || A.declared) return;
    const dl = C.appr ? C.appr.dl : null;
    if (dl == null || t < dl) { if (TERMINAL.has(S.state) || S.priority !== 1) A.moot = true; }
    else if (t === dl && ENDED.has(S.state)) A.moot = true;
  }
  function replyDeadline(h) {
    const pol = E(h).policy || {};
    const days = toNum(pol.callerReplyDays), bdm = toNum(pol.businessDayMinutes);
    if (days == null || bdm == null) return null;
    return reach(sdSched(env, pol), [[h, Infinity]], days * bdm);
  }
  function confirmDeadline(r) {
    const pol = E(r).policy || {};
    const days = toNum(pol.resolvedCloseDays), bdm = toNum(pol.businessDayMinutes);
    if (days == null || bdm == null) return null;
    return reach(sdSched(env, pol), [[r, Infinity]], days * bdm);
  }

  // ---- incident changes (R1-R3, R6, R7)
  function assign(g, t, win) {
    const ref = `${num}~${fmt(t)}~${g}`.slice(0, 120);
    itsm('assign', { number: num, group: g, at: fmt(t), ref }, win, `${fmt(t)}|${g}`);
    notify('assignment', (env.groups.get(String(g)) || {}).mailbox, `Incident ${num} is assigned to ${g}.`, win, `${fmt(t)}|${g}`);
    S.state = 'assigned'; S.assignmentGroup = g; S.assignedTo = null; S.holdReason = null;
    callerDl = null;
    changed = true;
  }
  function reclass(t, impact, urgency, win) {
    const p = priorityFor(E(t), S.service, impact, urgency);
    if (impact === S.impact && urgency === S.urgency && p === S.priority) return;
    itsm('reclassify', { number: num, impact, urgency, priority: p, at: fmt(t) }, win, `${fmt(t)}|${impact}|${urgency}|${p}`);
    S.impact = impact; S.urgency = urgency; S.priority = p;
    changed = true;
    p1Check(t);
  }
  function closeInc(reason, t, win) {
    itsm('close', { number: num, reason, at: fmt(t) }, win);
    S.state = 'closed'; S.closedAt = t; S.closeReason = reason; S.holdReason = null;
    changed = true;
  }
  function setMajor(t, win) {
    if (S.major) return;
    itsm('setMajor', { number: num, at: fmt(t) }, win);
    S.major = true; S.majorAt = t;
    changed = true;
    notify('major-incident', ownerOf(), `Incident ${num} is a major incident.`, win, 'declared');
  }
  function create(ev, kind) {
    const t = ev.t;
    const ed = E(t);
    const ci = env.ciFind(ev.ci);
    const ciId = ci ? String(ci.id) : (String(ev.ci ?? '').trim() || 'unknown');
    const service = ci && ci.service != null ? String(ci.service) : null;
    const svc = service != null ? env.services.get(service) : null;
    const impact = clampInt(svc && svc.impact, 1, 3) ?? 3;
    let urgency, callerId = null, category, region, sourceId, summary;
    if (kind === 'report') {
      urgency = clampInt(ev.urgency, 1, 3) ?? 3;
      const u = ev.callerId ? env.userFind(ev.callerId) : null;
      callerId = u ? String(u.id) : (ev.callerId || null);
      category = ev.category ? String(ev.category).trim().toLowerCase() : 'software';
      region = u ? u.region ?? null : null;
      sourceId = ev.reportId;
      summary = ev.summary || `Report ${ev.reportId}`;
    } else {
      urgency = alertUrgency(ed, ev.severity) ?? 3;
      category = 'monitoring';
      region = ci ? ci.region ?? null : null;
      sourceId = ev.alertId;
      summary = `${ev.severity ?? ''} alert ${ev.check ?? ''} on ${ciId}`.trim();
    }
    const priority = priorityFor(ed, service, impact, urgency);
    S = {
      exists: true, sourceKind: kind, sourceId, callerId, ci: ciId, check: kind === 'alert' ? (ev.check ?? null) : null,
      service, category, impact, urgency, priority, state: 'new', holdReason: null, assignmentGroup: null,
      assignedTo: null, major: false, majorAt: null, openedAt: t, resolvedAt: null, closedAt: null, cancelledAt: null, alerts: [],
    };
    createKey = capKey(`itsm.create|${num}`);
    pushEff({
      key: createKey, sys: 'itsm', op: 'create', from: t, to: t, dep: null,
      args: {
        number: num, source: { kind, id: String(sourceId) }, callerId, ci: ciId, check: S.check,
        service: service || 'unknown', category, impact, urgency, priority, openedAt: fmt(t), summary: String(summary).slice(0, 400),
      },
    });
    lastItsm = createKey;
    creation = true; changed = true;
    const g = groupFor(env, ed, category, region, ci);
    if (g) assign(g, t, W15(t));
    p1Check(t);
  }
  function endsAt(t) {
    return hist.some((h) => h.t === t && ((h.y === 'resolver' && h.action === 'resolve') || (h.y === 'caller' && (h.intent === 'withdraw' || h.intent === 'confirm'))));
  }

  function onReport(h) {
    if (!S) { if (C.mode === 'new' && C.open && C.open.kind === 'report' && normInc('INC-' + h.reportId) === num) create(h, 'report'); return; }
    // R1.4: a report delivered again changes nothing.
  }
  function onAlert(h) {
    const id = String(h.alertId ?? '').trim();
    if (!S) { if (C.mode === 'new' && C.open && C.open.kind === 'alert' && normInc('INC-' + id) === num) create(h, 'alert'); return; }
    if (eqId(id, S.sourceId) || S.alerts.some((a) => eqId(a, id))) return; // R1.4
    const u = alertUrgency(E(h.t), h.severity);
    if (u == null) return; // R1.2 warning
    if (S.sourceKind !== 'alert') return;
    const ci = env.ciFind(h.ci);
    const ciId = ci ? String(ci.id) : String(h.ci ?? '').trim();
    if (!eqId(ciId, S.ci) || !eqStr(h.check, S.check)) return;
    if (h.t < S.openedAt || TERMINAL.has(S.state) || endsAt(h.t)) return; // S8
    itsm('linkAlert', { number: num, alertId: id }, W15(h.t), id);
    S.alerts.push(id);
    if (u < S.urgency) reclass(h.t, S.impact, u, W15(h.t)); // R1.3
  }
  function onResolver(h) {
    if (!S) return;
    const t = h.t;
    if (TERMINAL.has(S.state)) return; // R3.3
    const W = W15(t);
    switch (h.action) {
      case 'accept':
        if (S.state !== 'assigned' || !h.user) return;
        itsm('accept', { number: num, user: h.user, at: fmt(t) }, W, seqKey('accept', t));
        S.state = 'inProgress'; S.assignedTo = h.user; changed = true;
        return;
      case 'hold': {
        if (S.state !== 'inProgress') return;
        const reason = h.holdReason || 'other';
        itsm('hold', { number: num, reason, at: fmt(t) }, W, seqKey('hold', t));
        S.state = 'onHold'; S.holdReason = reason; changed = true;
        if (isAwaitingCaller(reason)) {
          notify('awaiting-caller', callerEmail(), `Incident ${num} is waiting for your reply.`, W, fmt(t));
          callerDl = { h: t, D: replyDeadline(t) };
        }
        return;
      }
      case 'resume':
        if (S.state !== 'onHold') return;
        itsm('resume', { number: num, at: fmt(t) }, W, seqKey('resume', t));
        S.state = 'inProgress'; S.holdReason = null; callerDl = null; changed = true;
        return;
      case 'reassign': {
        if (!OPEN_STATES.has(S.state)) return;
        const g = env.groupFind(h.toGroup) ?? h.toGroup;
        if (!g) return;
        assign(g, t, W);
        return;
      }
      case 'reclassify':
        reclass(t, h.impact ?? S.impact, h.urgency ?? S.urgency, W);
        return;
      case 'resolve':
        if (!OPEN_STATES.has(S.state)) return;
        itsm('resolve', { number: num, closeCode: h.closeCode || 'resolved', at: fmt(t) }, W);
        S.state = 'resolved'; S.resolvedAt = t; S.holdReason = null; callerDl = null; changed = true;
        notify('resolved', callerEmail(), `Incident ${num} is resolved.`, W, fmt(t));
        confirmDl = { r: t, D2: confirmDeadline(t) };
        return;
      default:
    }
  }
  function onCaller(h) {
    if (!S) return;
    const t = h.t, W = W15(t);
    if (h.intent === 'reply') { // R6.2
      if (S.state === 'onHold' && isAwaitingCaller(S.holdReason) && (!callerDl || callerDl.D == null || t <= callerDl.D)) {
        itsm('resume', { number: num, at: fmt(t) }, W, seqKey('resume', t));
        S.state = 'inProgress'; S.holdReason = null; callerDl = null; changed = true;
      }
    } else if (h.intent === 'confirm') { // R6.5
      if (S.state === 'resolved' && (!confirmDl || confirmDl.D2 == null || t <= confirmDl.D2)) {
        closeInc('confirmed', t, W);
        confirmDl = null;
      }
    } else if (h.intent === 'withdraw') { // R6.6
      if (!TERMINAL.has(S.state)) {
        itsm('cancel', { number: num, at: fmt(t) }, W);
        S.state = 'cancelled'; S.cancelledAt = t; S.holdReason = null; callerDl = null; changed = true;
        notify('incident-cancelled', callerEmail(), `Incident ${num} is cancelled at your request.`, W, fmt(t));
      }
    }
  }
  function onTask(h) { // R7.2
    if (h.sub !== 'answered' || !C.appr || !S) return;
    if (h.taskId != null && h.taskId !== C.appr.id) return;
    if (A.x == null || A.moot || A.counted || A.declared) return;
    if (h.t > C.appr.dl) return;
    if (h.decision !== 'approve' && h.decision !== 'reject') return; // unusable
    A.counted = { d: h.decision, t: h.t };
    if (h.decision === 'approve' && !ENDED.has(S.state)) setMajor(h.t, W15(h.t));
  }
  function apply(h) {
    switch (h.y) {
      case 'report': return onReport(h);
      case 'alert': return onAlert(h);
      case 'resolver': return onResolver(h);
      case 'caller': return onCaller(h);
      case 'ht': return onTask(h);
      default:
    }
  }
  // R6.3, R6.5 and R7.2 consequences, taken after their deadline and dated at it.
  function deadlinePhase(t) {
    let win = null;
    const narrow = (w) => { win = win ? { from: Math.max(win.from, w.from), to: Math.min(win.to, w.to) } : w; };
    if (callerDl && callerDl.D === t) {
      if (S.state === 'onHold' && isAwaitingCaller(S.holdReason)) {
        const w = WD(t, 60);
        closeInc('no-caller-response', t, w);
        notify('closed-no-response', callerEmail(), `Incident ${num} is closed: no reply was received.`, w, fmt(t));
        narrow(w);
      }
      callerDl = null;
    }
    if (confirmDl && confirmDl.D2 === t) {
      if (S.state === 'resolved') { const w = WD(t, 60); closeInc('auto', t, w); narrow(w); }
      confirmDl = null;
    }
    if (apprPending() && C.appr.dl === t) {
      mootCheck(t);
      if (!A.moot && !A.counted) { const w = WD(t, 15); setMajor(t, w); narrow(w); }
      A.declared = true;
    }
    return win;
  }
  function nextDeadline() {
    let m = Infinity;
    if (callerDl && callerDl.D != null) m = Math.min(m, callerDl.D);
    if (confirmDl && confirmDl.D2 != null) m = Math.min(m, confirmDl.D2);
    if (apprPending()) m = Math.min(m, C.appr.dl);
    return m;
  }

  // ---- SLA engine (R4)
  function scheduleFor(def, cur) {
    const sch = def.schedule || { source: 'none' };
    const src = sch.source ?? 'none';
    let schedId = null;
    if (src === 'calendar') schedId = sch.calendar ?? null;
    else if (src === 'service') schedId = (env.services.get(String(cur.service)) || {}).supportSchedule ?? null;
    else if (src === 'assignmentGroup') schedId = (env.groups.get(String(cur.assignmentGroup)) || {}).schedule ?? null;
    if (schedId == null || schedId === '') return { schedId: null, tzName: null, sched: null };
    schedId = String(schedId);
    const cal = env.cals.get(schedId) || null;
    let tz = cal && cal.tz ? String(cal.tz) : null;
    if (!tz) {
      const tzd = def.timezone || {};
      for (const s of Array.isArray(tzd.sources) ? tzd.sources : []) {
        if (s === 'caller' && cur.callerId) tz = (env.users.get(String(cur.callerId)) || {}).timezone ?? null;
        else if (s === 'ci') tz = (env.cis.get(String(cur.ci)) || {}).timezone ?? null;
        else if (s === 'definition') tz = tzd.definition ?? null;
        if (tz) break;
      }
    }
    return { schedId, tzName: tz || null, sched: cal ? { cal, tz: tz || env.sysTz } : null };
  }
  function idsOf(sla) { return { number: num, definition: sla.defId, generation: sla.gen }; }
  function pushPause(sla, t, win) {
    sla.pauses.push({ from: t, to: null });
    sla.stage = 'paused';
    sla.recs.push({ op: 'pause', ord: t, kind: 2, args: { ...idsOf(sla), at: fmt(t) }, from: win.from, to: win.to });
  }
  function pushResume(sla, t, win) {
    const lp = sla.pauses[sla.pauses.length - 1];
    if (lp && lp.to == null) lp.to = t;
    sla.stage = 'inProgress';
    const pb = reach(sla.sched, runsOf(sla, Infinity), targetOf(sla.def));
    sla.recs.push({ op: 'resume', ord: t, kind: 2, args: { ...idsOf(sla), at: fmt(t), plannedBreachAt: fmt(pb) }, from: win.from, to: win.to });
  }
  function slaStop(sla, t, win) {
    const runs = runsOf(sla, t);
    const el = runs.reduce((a, [p, q]) => a + (q - p), 0) / MIN;
    const be = bizMinutes(sla.sched, runs);
    const tg = targetOf(sla.def);
    const D = tg == null ? null : reach(sla.sched, runs, tg);
    const breached = !!sla.recBreached || (D != null && D <= t);
    sla.stage = 'completed'; sla.endAt = t;
    sla.recs.push({ op: 'stop', ord: t, kind: 3, args: { ...idsOf(sla), at: fmt(t), elapsedMinutes: Math.max(0, Math.floor(el)), businessElapsedMinutes: Math.max(0, Math.floor(be)), breached }, from: win.from, to: win.to });
  }
  function slaCancel(sla, t, reason, win) {
    sla.stage = 'cancelled'; sla.endAt = t;
    sla.recs.push({ op: 'cancel', ord: t, kind: 3, args: { ...idsOf(sla), at: fmt(t), reason }, from: win.from, to: win.to });
  }
  function pastPauseIntervals(when, a0, b0) {
    const ss = snaps.filter((z) => z.at < b0).sort((p, q) => p.at - q.at);
    const segs = [];
    for (let j = 0; j < ss.length; j++) {
      const a = Math.max(ss[j].at, a0);
      const b = j + 1 < ss.length ? Math.min(ss[j + 1].at, b0) : b0;
      if (!(b > a)) continue;
      if (!holds(when, ss[j].s)) continue;
      const last = segs[segs.length - 1];
      if (last && last[1] === a) last[1] = b; else segs.push([a, b]);
    }
    return segs;
  }
  function activeOf(id) { return slas.some((s) => s.defId === id && (s.stage === 'inProgress' || s.stage === 'paused')); }
  function attach(def, x, cur, win) {
    const id = String(def.id);
    const gen = 1 + slas.filter((s) => s.defId === id).length;
    const startAt = def.start && def.start.from === 'openedAt' ? S.openedAt : x;
    const sc = scheduleFor(def, cur);
    const sla = {
      defId: id, gen, slaId: `${num}/${id}/${gen}`, def, attachAt: x, ph: phaseNo, startAt,
      schedId: sc.schedId, tzName: sc.tzName, sched: sc.sched, pauses: [], stage: 'inProgress', endAt: null,
      recs: [], migrated: false, recBreached: false,
    };
    slas.push(sla);
    const tg = targetOf(def);
    sla.recs.push({
      op: 'start', ord: -Infinity, kind: 0, from: win.from, to: win.to,
      args: { ...idsOf(sla), startAt: fmt(startAt), schedule: sc.schedId, timezone: sc.tzName, plannedBreachAt: fmt(reach(sc.sched, [[startAt, Infinity]], tg)) },
    });
    const pauseWhen = def.pause && Array.isArray(def.pause.when) ? def.pause.when : null;
    const pzNow = !!pauseWhen && holds(pauseWhen, cur);
    if (startAt < x && def.start && def.start.retroactivePause && pauseWhen) {
      const ivs = pastPauseIntervals(pauseWhen, startAt, x);
      for (let j = 0; j < ivs.length; j++) {
        const [f, e] = ivs[j];
        pushPause(sla, f, win);
        if (j === ivs.length - 1 && e === x && pzNow) return; // attaches paused, pause began at f (S14)
        pushResume(sla, e, win);
      }
    }
    if (pzNow) pushPause(sla, x, win); // S14
  }
  function slaEngine(t, prev, cur, win, isCreation) {
    const defs = asList(E(t).slaDefs).filter((d) => d && d.id != null);
    const fieldChanged = (f) => !isCreation && prev != null && !eqVal(fieldVal(prev, f), fieldVal(cur, f));
    for (const sla of slas) {
      if (sla.ph >= phaseNo) continue;
      if (sla.stage !== 'inProgress' && sla.stage !== 'paused') continue;
      const d = sla.def;
      if (!d) continue;
      if (holds(d.cancel && d.cancel.when, cur)) { slaCancel(sla, t, 'cancelled', win); continue; }
      if (d.cancel && d.cancel.whenStartFails && !holds(d.start && d.start.when, cur)) { slaCancel(sla, t, 'start-failed', win); continue; }
      if (holds(d.stop && d.stop.when, cur)) { slaStop(sla, t, win); continue; }
      if (d.reset && d.reset.onChangeOf && fieldChanged(d.reset.onChangeOf)) {
        slaCancel(sla, t, 'reset', win);
        const nd = defs.find((x) => String(x.id) === sla.defId);
        if (nd && holds(nd.start && nd.start.when, cur) && !holds(nd.stop && nd.stop.when, cur) && !activeOf(String(nd.id))) attach(nd, t, cur, win);
        continue;
      }
      const pz = !!d.pause && holds(d.pause.when, cur);
      if (sla.stage === 'inProgress' && pz) pushPause(sla, t, win);
      else if (sla.stage === 'paused' && !pz) pushResume(sla, t, win);
    }
    for (const def of defs) {
      const id = String(def.id);
      if (activeOf(id)) continue;
      if (!holds(def.start && def.start.when, cur) || holds(def.stop && def.stop.when, cur)) continue;
      const before = isCreation || prev == null ? false : holds(def.start && def.start.when, prev);
      if (!before || (def.reset && def.reset.onChangeOf && fieldChanged(def.reset.onChangeOf))) attach(def, t, cur, win);
    }
  }

  // ---- go-live base (§3.6)
  if (C.mode === 'mig' && C.base) {
    const B = C.base;
    S = snapCopy(B.snap);
    for (const p of B.pre || []) snaps.push({ at: p.at, s: { ...snapCopy(S), state: p.state, holdReason: p.holdReason, assignmentGroup: p.group ?? S.assignmentGroup } });
    snaps.push({ at: C.t0, s: snapCopy(S) });
    for (const r of B.slas || []) {
      const def = findDef(env, C, r.def, r.startAt);
      const cal = r.schedule != null ? env.cals.get(String(r.schedule)) : null;
      slas.push({
        defId: r.def, gen: r.gen, slaId: r.id, def, attachAt: r.startAt, ph: 0, startAt: r.startAt,
        schedId: r.schedule ?? null, tzName: r.timezone ?? null,
        sched: cal ? { cal, tz: r.timezone || cal.tz || env.sysTz } : null,
        pauses: (r.pauses || []).map(([f, t]) => ({ from: f, to: t })), stage: r.stage, endAt: r.endAt ?? null,
        recs: [], migrated: true, recBreached: !!r.breached,
      });
    }
    everP1 = !!B.p1;
    if (B.apprX != null) A.x = B.apprX;
    if (S.state === 'onHold' && isAwaitingCaller(S.holdReason)) {
      const h = B.h ?? C.t0;
      callerDl = { h, D: replyDeadline(h) };
      if (B.h != null && B.h + 15 * MIN >= C.t0) notify('awaiting-caller', callerEmail(), `Incident ${num} is waiting for your reply.`, W15(B.h), fmt(B.h));
    }
    if (S.state === 'resolved' && S.resolvedAt != null) {
      confirmDl = { r: S.resolvedAt, D2: confirmDeadline(S.resolvedAt) };
      if (S.resolvedAt + 15 * MIN >= C.t0) notify('resolved', callerEmail(), `Incident ${num} is resolved.`, W15(S.resolvedAt), fmt(S.resolvedAt));
    }
    if (S.major && S.majorAt != null && S.majorAt + 15 * MIN >= C.t0) notify('major-incident', ownerOf(), `Incident ${num} is a major incident.`, W15(S.majorAt), 'declared');
    if (S.state === 'new' && !S.assignmentGroup && S.openedAt != null && S.openedAt + 15 * MIN >= C.t0) {
      const u = S.callerId ? env.userFind(S.callerId) : null;
      const ci = env.ciFind(S.ci);
      const region = S.sourceKind === 'report' ? (u ? u.region : null) : (ci ? ci.region : null);
      const g = groupFor(env, E(S.openedAt), S.category, region, ci);
      if (g) assign(g, S.openedAt, W15(S.openedAt));
    }
  }

  // ---- replay: event phases in (instant, delivery tick) order; a deadline phase after every event phase at
  // its instant, taken only once the deadline has passed (S1, S10, R4.5 last paragraph).
  let i = 0;
  for (let guard = 0; guard < 100000; guard++) {
    const tEv = i < hist.length ? hist[i].t : Infinity;
    const tDl = nextDeadline();
    const dlDue = tDl < now ? tDl : Infinity;
    if (tEv === Infinity && dlDue === Infinity) break;
    const prev = S ? snapCopy(S) : null;
    changed = false; creation = false; phaseNo++;
    let t, win;
    if (tEv <= dlDue) {
      t = tEv;
      const k = hist[i].k;
      while (i < hist.length && hist[i].t === t && hist[i].k === k) { apply(hist[i]); mootCheck(t); i++; }
      win = W15(t);
    } else {
      t = dlDue;
      win = deadlinePhase(t) ?? W15(t);
    }
    if (S && changed) {
      slaEngine(t, creation ? null : prev, S, win, creation);
      snaps.push({ at: t, s: snapCopy(S) });
    }
  }

  // ---- breaches (R4.6) and escalations (R5) from each SLA's running time
  snaps.sort((p, q) => p.at - q.at);
  const snapAt = (t) => { let r = null; for (const z of snaps) { if (z.at <= t) r = z.s; else break; } return r ?? S; };
  const escTo = (n, due) => {
    const s = snapAt(due);
    const g = s ? env.groups.get(String(s.assignmentGroup)) : null;
    const kind = String(n ?? '').trim();
    if (kind === 'group') return g ? g.mailbox ?? null : null;
    if (kind === 'groupManager') return g ? g.managerEmail ?? null : null;
    if (kind === 'incidentManagers') return (E(due).policy || {}).incidentManagersMailbox ?? null;
    return null;
  };
  const slaEff = [], escEff = [];
  const escDone = new Set((C.base && C.base.esc) || []);
  for (const sla of slas) {
    const tg = targetOf(sla.def);
    if (tg != null) {
      const runs = runsOf(sla, Infinity);
      const D = reach(sla.sched, runs, tg);
      if (D != null && !sla.recBreached) {
        const from = Math.max(D, sla.attachAt);
        sla.recs.push({ op: 'breach', ord: D, kind: 1, args: { ...idsOf(sla), at: fmt(D) }, from, to: from + 15 * MIN });
      }
      const seen = new Set();
      for (const e of asList(sla.def && sla.def.escalations)) {
        const pct = toInt(e && e.percent);
        if (pct == null || pct < 1 || seen.has(pct)) continue;
        seen.add(pct);
        if (escDone.has(`${sla.slaId}|${pct}`)) continue;
        const tau = reach(sla.sched, runs, Math.floor((tg * pct) / 100));
        if (tau == null) continue;
        const due = Math.max(tau, sla.attachAt);
        const to = escTo(e.notify, due);
        if (!to) continue;
        escEff.push({
          key: capKey(`sla.escalate|${sla.slaId}|${pct}`), sys: 'sla', op: 'escalate',
          args: { ...idsOf(sla), percent: pct, to: String(to) }, from: due, to: due + 15 * MIN,
          dep: sla.migrated ? null : capKey(`sla.start|${sla.slaId}`),
        });
      }
    }
    const recs = sla.recs.slice().sort((a, b) => (a.ord === b.ord ? 0 : a.ord - b.ord) || a.kind - b.kind);
    let prev = sla.migrated ? null : createKey;
    for (const r of recs) {
      const key = capKey(r.op === 'pause' || r.op === 'resume' ? `sla.${r.op}|${sla.slaId}|${r.args.at}` : `sla.${r.op}|${sla.slaId}`);
      slaEff.push({ key, sys: 'sla', op: r.op, args: r.args, from: r.from, to: r.to, dep: prev });
      prev = key;
    }
  }

  const wakes = [];
  if (callerDl && callerDl.D != null && callerDl.D >= now) wakes.push(callerDl.D + MIN);
  if (confirmDl && confirmDl.D2 != null && confirmDl.D2 >= now) wakes.push(confirmDl.D2 + MIN);
  if (apprPending() && C.appr.dl >= now) wakes.push(C.appr.dl + MIN);
  const needTask = A.x != null && !A.moot && !A.counted && !A.declared && !C.appr ? { x: A.x } : null;
  return { S, desired: [...out, ...slaEff, ...escEff], wakes, needTask };
}

function findDef(env, C, id, at) {
  const ed = edAt(env, C, at ?? 0);
  const hit = asList(ed.slaDefs).find((d) => d && String(d.id) === String(id));
  if (hit) return hit;
  const eds = env.editions.slice().sort((a, b) => (a.from < b.from ? 1 : a.from > b.from ? -1 : 0));
  for (const e of eds) { const d = asList(e.slaDefs).find((x) => x && String(x.id) === String(id)); if (d) return d; }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// API renames: write each argument under the name the current schema file shows (§1 API changes).

const CANON = {
  itsm: {
    create: ['number', 'source', 'callerId', 'ci', 'check', 'service', 'category', 'impact', 'urgency', 'priority', 'openedAt', 'summary'],
    assign: ['number', 'group', 'at', 'ref'], accept: ['number', 'user', 'at'], hold: ['number', 'reason', 'at'],
    resume: ['number', 'at'], reclassify: ['number', 'impact', 'urgency', 'priority', 'at'],
    resolve: ['number', 'closeCode', 'at'], close: ['number', 'reason', 'at'], cancel: ['number', 'at'],
    linkAlert: ['number', 'alertId'], setMajor: ['number', 'at'],
  },
  sla: {
    start: ['number', 'definition', 'generation', 'startAt', 'schedule', 'timezone', 'plannedBreachAt'],
    pause: ['number', 'definition', 'generation', 'at'], resume: ['number', 'definition', 'generation', 'at', 'plannedBreachAt'],
    breach: ['number', 'definition', 'generation', 'at'],
    stop: ['number', 'definition', 'generation', 'at', 'elapsedMinutes', 'businessElapsedMinutes', 'breached'],
    cancel: ['number', 'definition', 'generation', 'at', 'reason'],
    escalate: ['number', 'definition', 'generation', 'percent', 'to'],
  },
  notify: { send: ['to', 'about', 'template', 'text', 'ref'] },
};
const HINT_FIELDS = ['renamedFrom', 'formerly', 'previousName', 'previous', 'oldName', 'was', 'aliasOf', 'replaces', 'deprecatedName', 'x-renamedFrom', 'x-formerly'];

function opSchema(env, sys, op) {
  const s = env.api && env.api[sys];
  if (!s || typeof s !== 'object') return null;
  return (s.ops && s.ops[op]) || (s.effects && s.effects[op]) || null;
}
function renameMap(opS, schema) {
  const m = {};
  const add = (o) => { if (o && typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) if (typeof v === 'string') m[k] = v; };
  if (opS) { add(opS.renames); add(opS.renamed); add(opS.aliases); }
  return m;
}
function lcs(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  let best = 0;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    let k = 0;
    while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
    if (k > best) best = k;
  }
  return best;
}
function typeFits(schema, v) {
  const ts = [].concat(schema && schema.type != null ? schema.type : []);
  if (!ts.length) return true;
  if (v === null) return ts.includes('null');
  if (Number.isInteger(v)) return ts.includes('integer') || ts.includes('number');
  if (typeof v === 'number') return ts.includes('number');
  if (typeof v === 'boolean') return ts.includes('boolean');
  if (typeof v === 'string') return ts.includes('string');
  if (typeof v === 'object') return ts.includes('object');
  return true;
}
function renameArgs(env, sys, op, args) {
  const opS = opSchema(env, sys, op);
  const props = opS && ((opS.args && opS.args.properties) || opS.properties || (opS.schema && opS.schema.properties));
  if (!props || typeof props !== 'object') return args;
  const names = Object.keys(props);
  const canonAll = new Set([...((CANON[sys] && CANON[sys][op]) || []), ...Object.keys(args)]);
  const free = names.filter((n) => !canonAll.has(n));
  const rmap = renameMap(opS, env.api[sys]);
  const used = new Set();
  const outA = {};
  for (const c of Object.keys(args)) {
    if (names.includes(c)) { outA[c] = args[c]; used.add(c); continue; }
    let target = null;
    if (rmap[c] && names.includes(rmap[c])) target = rmap[c];
    if (!target) {
      for (const n of free) {
        const ps = props[n] || {};
        const hit = HINT_FIELDS.some((f) => ps[f] === c || (Array.isArray(ps[f]) && ps[f].includes(c)))
          || (typeof ps.description === 'string' && new RegExp(`\\b${c}\\b`).test(ps.description));
        if (hit && !used.has(n)) { target = n; break; }
      }
    }
    if (!target) {
      const cands = free.filter((n) => !used.has(n) && typeFits(props[n], args[c]));
      if (cands.length === 1) target = cands[0];
      else if (cands.length > 1) target = cands.slice().sort((p, q) => lcs(q, c) - lcs(p, c))[0];
    }
    if (target) { outA[target] = args[c]; used.add(target); } else outA[c] = args[c];
  }
  return outA;
}

// ---------------------------------------------------------------------------------------------------------
// Context reads

function rowsOf(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') for (const k of ['rows', 'items', 'records', 'data', 'results']) if (Array.isArray(v[k])) return v[k];
  return [];
}
function* queryRows(ctx, table, where, limit) {
  if (!ctx || typeof ctx.query !== 'function') return [];
  let r = yield safe(() => ctx.query(table, { where, limit }));
  if (!r.ok) {
    const short = table.includes('.') ? table.split('.').pop() : table;
    r = yield safe(() => ctx.query(short, { where, limit }));
  }
  return r.ok ? rowsOf(r.v) : [];
}
function instList(v) {
  const arr = Array.isArray(v) ? v : (v && typeof v === 'object' ? (v.instances ?? v.rows ?? v.items ?? v.list ?? []) : []);
  const out = [];
  for (const e of Array.isArray(arr) ? arr : []) {
    if (typeof e === 'string') out.push({ id: e, openedAt: null, subject: null });
    else if (e && typeof e === 'object') {
      const id = e.instance ?? e.id ?? e.instanceId ?? null;
      if (id != null) out.push({ id: String(id), openedAt: e.openedAt ?? null, subject: e.subject ?? null });
    }
  }
  return out;
}
function* findOwner(ctx, num, self) {
  if (!ctx || typeof ctx.instances !== 'function' || !num) return null;
  const r = yield safe(() => ctx.instances({ subject: num }));
  if (!r.ok) return null;
  const ids = instList(r.v).filter((x) => x.id !== String(self) && (x.subject == null || normInc(x.subject) === num));
  if (!ids.length) return null;
  ids.sort((a, b) => cmpInst(a.id, b.id));
  return ids[0].id;
}

// ---------------------------------------------------------------------------------------------------------
// Outputs

function baseOut(subject, priority) {
  const p = clampInt(priority, 1, 5);
  return {
    decisions: { subject: subject || null, priority: subject ? p : null },
    effects: [],
    obligations: { upsert: [], cancel: [] },
    humanTasks: [],
  };
}
function closeOut(subject, priority) {
  return { ...baseOut(subject, priority), close: true, carry: { v: 1, role: 'done', num: subject || null } };
}
function mergeOut(subject, priority, into) {
  return { ...baseOut(subject, priority), merge: { into }, carry: { v: 1, role: 'merged', num: subject || null, into } };
}

// ---------------------------------------------------------------------------------------------------------
// Go-live: build the owner's base from the migration export.

function collectRecords(x, f, depth) {
  if (x == null || depth > 7) return;
  if (Array.isArray(x)) { for (const e of x) collectRecords(e, f, depth + 1); return; }
  if (typeof x !== 'object') return;
  if (typeof x.type === 'string' && 'payload' in x) { f.msgs.push(x); return; }
  if ('slaId' in x || ('definition' in x && 'generation' in x && !('percent' in x))) { f.sla.push(x); return; }
  if ('percent' in x && ('slaId' in x || 'definition' in x)) { f.esc.push(x); return; }
  if ('template' in x && 'to' in x) { f.notes.push(x); return; }
  if ('number' in x && ('state' in x || 'openedAt' in x) && !('action' in x)) { f.inc.push(x); return; }
  for (const v of Object.values(x)) collectRecords(v, f, depth + 1);
}

function buildMigCarry(env, ev, now, input) {
  const f = { inc: [], sla: [], esc: [], notes: [], msgs: [] };
  collectRecords(ev.payload, f, 0);
  const rec = f.inc[0] || {};
  const num = normInc(rec.number);
  const state = rec.state || 'assigned';
  const snap = {
    exists: true, sourceKind: (rec.source && rec.source.kind) || (num.startsWith('INC-ALR') ? 'alert' : 'report'),
    sourceId: rec.source && rec.source.id != null ? String(rec.source.id) : num.replace(/^INC-/, ''),
    callerId: rec.callerId ?? null, ci: rec.ci ?? null, check: rec.check ?? null, service: rec.service ?? null,
    category: rec.category ?? null, impact: toInt(rec.impact) ?? 3, urgency: toInt(rec.urgency) ?? 3, priority: toInt(rec.priority) ?? 5,
    state, holdReason: state === 'onHold' ? (rec.holdReason ?? null) : null, assignmentGroup: rec.assignmentGroup ?? null,
    assignedTo: rec.assignedTo ?? null, major: !!rec.major, majorAt: parseT(rec.majorAt), openedAt: parseT(rec.openedAt) ?? now,
    resolvedAt: parseT(rec.resolvedAt), closedAt: parseT(rec.closedAt), cancelledAt: parseT(rec.cancelledAt),
    alerts: Array.isArray(rec.alerts) ? rec.alerts.map(String) : [],
  };
  const slas = f.sla.filter((s) => !s.number || normInc(s.number) === num).map((s) => {
    const def = String(s.definition);
    const gen = toInt(s.generation) ?? 1;
    const stage = s.stage || 'inProgress';
    const pauses = (Array.isArray(s.pauses) ? s.pauses : []).map((p) => [parseT(p.from), parseT(p.to)]).filter((p) => p[0] != null);
    let endAt = parseT(s.endAt);
    if (endAt == null && (stage === 'completed' || stage === 'cancelled')) endAt = now;
    return { id: s.slaId ? String(s.slaId) : `${num}/${def}/${gen}`, def, gen, stage, startAt: parseT(s.startAt) ?? snap.openedAt, schedule: s.schedule ?? null, timezone: s.timezone ?? null, pauses, breached: !!s.breached, endAt };
  });
  const esc = f.esc.map((e) => `${e.slaId ? String(e.slaId) : `${num}/${e.definition}/${e.generation}`}|${toInt(e.percent)}`);
  const notes = f.notes.map((n) => `${lower(n.template)}|${lower(n.to)}`);
  // Messages already received: the state history before go-live (hold intervals) and the hold instant.
  const msgs = f.msgs.map((m) => ({ m, cls: classify(m), t: parseT(m.at) })).filter((x) => x.t != null && x.t < now).sort((a, b) => a.t - b.t);
  let h = null;
  const pre = [];
  let st = { state: 'assigned', holdReason: null, group: snap.assignmentGroup };
  pre.push({ at: snap.openedAt, ...st });
  let taskSeen = false;
  for (const { cls, t } of msgs) {
    if (cls.kind === 'ht') taskSeen = true;
    if (t < snap.openedAt) continue;
    const p = cls.p || {};
    let next = null;
    if (cls.kind === 'resolver') {
      const a = lower(p.action);
      if (a === 'accept') next = { ...st, state: 'inProgress', holdReason: null };
      else if (a === 'hold') { next = { ...st, state: 'onHold', holdReason: p.holdReason ?? null }; if (isAwaitingCaller(p.holdReason)) h = t; }
      else if (a === 'resume') next = { ...st, state: 'inProgress', holdReason: null };
      else if (a === 'reassign') next = { ...st, state: 'assigned', holdReason: null, group: p.toGroup ?? st.group };
      else if (a === 'resolve') next = { ...st, state: 'resolved', holdReason: null };
    } else if (cls.kind === 'caller') {
      const it = lower(p.intent);
      if (it === 'reply' && st.state === 'onHold' && isAwaitingCaller(st.holdReason)) next = { ...st, state: 'inProgress', holdReason: null };
      else if (it === 'withdraw' && !TERMINAL.has(st.state)) next = { ...st, state: 'cancelled', holdReason: null };
      else if (it === 'confirm' && st.state === 'resolved') next = { ...st, state: 'closed' };
    }
    if (next && (next.state !== st.state || next.holdReason !== st.holdReason || next.group !== st.group)) { st = next; pre.push({ at: t, ...st }); }
  }
  if (snap.state === 'onHold' && isAwaitingCaller(snap.holdReason) && h == null) {
    let best = null;
    for (const s of slas) for (const [fr, to] of s.pauses) if (to == null && (best == null || fr > best)) best = fr;
    h = best;
  }
  const p1 = snap.priority === 1 || snap.major;
  const apprX = snap.priority === 1 && !snap.major && !taskSeen && !TERMINAL.has(snap.state) && snap.openedAt + 15 * MIN >= now ? snap.openedAt : null;
  return {
    v: 1, role: 'owner', mode: 'mig', num, inst: String(input.instance ?? ''), t0: now, k: 0, hist: [], fx: {}, appr: null, ed: null, wk: null,
    base: { snap, slas, esc, notes, pre, h, p1, apprX },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Ticks

function* main(input, ctx) {
  const now = parseT(input && input.now) ?? 0;
  const env = yield* loadEnv(ctx);
  let C = input && input.carry && typeof input.carry === 'object' ? input.carry : null;
  if (!C || !C.role) {
    const r = yield* firstTick(input, ctx, env, now);
    if (r.output) return r.output;
    C = r.carry;
  }
  if (C.role === 'owner') return yield* ownerTick(input, ctx, env, now, C);
  return closeOut(C.num ?? null, null);
}

function* firstTick(input, ctx, env, now) {
  const evs = Array.isArray(input.events) ? input.events : [];
  const self = String(input.instance ?? '');
  const mig = evs.find((e) => e && e.type === 'migration');
  if (mig) return { carry: buildMigCarry(env, mig, now, input) };
  let ev = null, cls = null;
  for (const e of evs) { const c = classify(e); if (MESSAGE_KINDS.has(c.kind)) { ev = e; cls = c; break; } }
  if (!ev) return { output: closeOut(null, null) };
  const p = cls.p || {};
  const t = parseT(ev.at) ?? now;
  const incident = function* (n) { return (yield* queryRows(ctx, 'itsm.incidents', { number: n }, 5)).find((r) => r && normInc(r.number) === n) ?? null; };
  const newCarry = (kind, num, srcId) => ({ v: 1, role: 'owner', mode: 'new', num, inst: self, t0: now, k: 0, hist: [], fx: {}, appr: null, ed: null, wk: null, open: { kind, id: srcId } });

  if (cls.kind === 'report') {
    const rid = String(p.reportId ?? '').trim();
    const num = normInc('INC-' + rid);
    const own = yield* findOwner(ctx, num, self);
    const rec = yield* incident(num);
    if (own) return { output: mergeOut(num, rec ? rec.priority : reportPriority(env, p, t), own) };
    if (rec) return { output: closeOut(num, rec.priority) };
    return { carry: newCarry('report', num, rid) };
  }
  if (cls.kind === 'alert') {
    const aid = String(p.alertId ?? '').trim();
    const ed = edAt(env, null, t);
    const u = alertUrgency(ed, p.severity);
    if (u == null) return { output: closeOut(null, null) }; // R1.2
    const own0 = normInc('INC-' + aid);
    let own = yield* findOwner(ctx, own0, self);
    const rec0 = yield* incident(own0);
    if (own) return { output: mergeOut(own0, rec0 ? rec0.priority : null, own) };
    if (rec0) return { output: closeOut(own0, rec0.priority) };
    const ci = env.ciFind(p.ci);
    const ciId = ci ? String(ci.id) : String(p.ci ?? '').trim();
    const rows = yield* queryRows(ctx, 'itsm.incidents', { ci: ciId }, 1000);
    const linked = rows.find((r) => r && Array.isArray(r.alerts) && r.alerts.some((a) => eqId(a, aid)));
    if (linked) {
      const ln = normInc(linked.number);
      own = yield* findOwner(ctx, ln, self);
      return { output: own ? mergeOut(ln, linked.priority, own) : closeOut(ln, linked.priority) };
    }
    const cands = rows.filter((r) => r && r.source && r.source.kind === 'alert' && eqId(r.ci, ciId) && eqStr(r.check, p.check) && openAt(r, t))
      .sort((a, b) => (parseT(a.openedAt) ?? 0) - (parseT(b.openedAt) ?? 0));
    if (cands.length) {
      const c = cands[0];
      const cn = normInc(c.number);
      own = yield* findOwner(ctx, cn, self);
      const cu = toInt(c.urgency), ci2 = toInt(c.impact);
      const np = cu != null && u < cu && ci2 != null ? priorityFor(ed, c.service, ci2, u) : c.priority;
      return { output: own ? mergeOut(cn, np, own) : closeOut(cn, c.priority) };
    }
    return { carry: newCarry('alert', own0, aid) };
  }
  if (cls.kind === 'caller') {
    const num = normInc(p.incidentRef);
    if (!num) return { output: closeOut(null, null) };
    const own = yield* findOwner(ctx, num, self);
    const rec = yield* incident(num);
    if (own) return { output: mergeOut(num, rec ? rec.priority : null, own) };
    if (rec) return { output: closeOut(num, rec.priority) };
    return { output: closeOut(null, null) }; // §3.3 names no incident: answered with nothing
  }
  if (cls.kind === 'resolver') {
    const num = normInc(p.number);
    if (!num) return { output: closeOut(null, null) };
    const own = yield* findOwner(ctx, num, self);
    const rec = yield* incident(num);
    let pr = rec ? rec.priority : null;
    if (rec && !TERMINAL.has(rec.state) && lower(p.action) === 'reclassify') {
      const im = clampInt(p.impact, 1, 3) ?? toInt(rec.impact), ur = clampInt(p.urgency, 1, 3) ?? toInt(rec.urgency);
      if (im != null && ur != null) pr = priorityFor(edAt(env, null, t), rec.service, im, ur);
    }
    if (own) return { output: mergeOut(num, pr, own) };
    if (rec) return { output: closeOut(num, rec.priority) };
    return { output: closeOut(null, null) };
  }
  return { output: closeOut(null, null) };
}

function openAt(r, t) {
  const o = parseT(r.openedAt);
  if (o != null && o > t) return false;
  for (const f of ['resolvedAt', 'closedAt', 'cancelledAt']) { const x = parseT(r[f]); if (x != null && x <= t) return false; }
  if (TERMINAL.has(r.state) && parseT(r.resolvedAt) == null && parseT(r.closedAt) == null && parseT(r.cancelledAt) == null) return false;
  return true;
}

function reportPriority(env, p, t) {
  const ci = env.ciFind(p.ci);
  const svc = ci ? env.services.get(String(ci.service)) : null;
  const impact = clampInt(svc && svc.impact, 1, 3), urgency = clampInt(p.urgency, 1, 3);
  if (impact == null || urgency == null) return null;
  return priorityFor(edAt(env, null, t), ci.service, impact, urgency);
}

function settle(st, s) {
  st.s = s;
  delete st.a; delete st.K; delete st.y; delete st.ra; delete st.t;
}
function errCode(e) {
  if (e == null) return null;
  if (typeof e === 'number') return e;
  if (typeof e === 'object') {
    for (const k of ['code', 'status', 'httpStatus', 'statusCode']) { const n = toInt(e[k]); if (n != null && n >= 100 && n < 600) return n; }
  }
  const m = /\b([45]\d\d)\b/.exec(typeof e === 'string' ? e : JSON.stringify(e));
  return m ? Number(m[1]) : null;
}

function* ownerTick(input, ctx, env, now, C) {
  C.k = (C.k ?? 0) + 1;
  C.hist = Array.isArray(C.hist) ? C.hist : [];
  C.fx = C.fx && typeof C.fx === 'object' ? C.fx : {};
  const self = String(C.inst || input.instance || '');
  const wakeId = `wake:${self}`;
  if (!C.ed) { C.ed = {}; for (const e of env.editions) C.ed[e.dir] = 0; }
  else for (const e of env.editions) if (C.ed[e.dir] == null) C.ed[e.dir] = now;

  // 1. Events: business events go to the history; results and timers update the effect book.
  const results = [];
  const sigs = new Set(C.hist.map(sigOf));
  for (const ev of Array.isArray(input.events) ? input.events : []) {
    if (!ev) continue;
    const cls = classify(ev);
    if (cls.kind === 'result') { results.push(ev); continue; }
    if (cls.kind === 'timer') { if (cls.p && cls.p.obligationId === wakeId) C.wk = null; continue; }
    if (cls.kind === 'ht' || MESSAGE_KINDS.has(cls.kind)) {
      const h = compact(ev, cls, C.k, now);
      if (!h) continue;
      const sg = sigOf(h);
      if (sigs.has(sg)) continue;
      sigs.add(sg);
      C.hist.push(h);
    }
  }
  for (const ev of results) {
    const p = ev.payload || {};
    if (p.key == null) continue;
    const st = C.fx[hk(String(p.key))];
    if (!st || st.s === 'ok' || st.s === 'x') continue;
    const status = lower(p.status);
    const at = parseT(ev.at) ?? now;
    if (status === 'ok') { settle(st, 'ok'); continue; }
    if (status === 'rate-limited') {
      const ra = toNum(p.retryAfter);
      st.s = 'r'; st.ra = ra != null ? ceilMin(at + ra * 1000) : now;
      continue;
    }
    if (status === 'unknown' || status === 'partial') { st.s = 'u'; continue; }
    const es = typeof p.error === 'string' ? p.error : JSON.stringify(p.error ?? '');
    const code = errCode(p.error);
    st.n = (st.n ?? 0) + 1;
    if (/predecessor/i.test(es)) { st.s = 'r'; st.ra = now; st.n -= 1; continue; }
    if (code === 409 || /key-conflict/i.test(es)) { settle(st, 'x'); continue; }
    if (st.n >= MAX_ATTEMPTS) { settle(st, 'x'); continue; }
    if (code == null || code >= 500 || code === 400 || code === 404 || code === 429 || /invalid-args|field-renamed/i.test(es)) { st.s = 'r'; st.ra = now; continue; }
    settle(st, 'x');
  }
  // 2. Unknown outcomes and long-silent requests: ask the system for the key's status.
  for (const st of Object.values(C.fx)) {
    if (!(st.s === 'u' || (st.s === 'p' && st.t != null && now - st.t >= 5 * MIN))) continue;
    st.q = (st.q ?? 0) + 1;
    let v = '';
    if (st.K && st.y && ctx && typeof ctx.status === 'function') {
      const r = yield safe(() => ctx.status(st.y, st.K));
      v = r.ok ? lower(r.v && typeof r.v === 'object' ? (r.v.status ?? r.v.state) : r.v) : '';
    }
    if (v === 'committed') settle(st, 'ok');
    else if (v === 'not-found' || v === 'notfound' || v === 'not_found') { st.s = 'r'; st.ra = now; st.q = 0; }
    else if (st.q >= 15) settle(st, 'ok'); // no answer after a quarter of an hour: stop waiting for it
    else st.s = 'u';
  }

  // 3. A same-instant duplicate owner (two instances started by one report in one round) yields to the first.
  if (C.k > 1 && ctx && typeof ctx.instances === 'function') {
    const r = yield safe(() => ctx.instances({ subject: C.num }));
    if (r.ok) {
      const earlier = instList(r.v).filter((x) => x.id !== self && x.openedAt != null && parseT(x.openedAt) === C.t0
        && (x.subject == null || normInc(x.subject) === C.num) && cmpInst(x.id, self) < 0);
      if (earlier.length) {
        const o = baseOut(C.num, C.lastP ?? null);
        if (C.wk != null) o.obligations.cancel.push(wakeId);
        return { ...o, close: true, carry: { v: 1, role: 'done', num: C.num } };
      }
    }
  }

  // 4. Replay and reconcile.
  const sim = simulate(env, C, now);
  const desiredKeys = new Set(sim.desired.map((d) => d.key));
  const effects = [];
  const emittedKeys = new Set();
  const wakes = [...sim.wakes];
  let open = 0;
  for (const d of sim.desired) {
    const h = hk(d.key);
    let st = C.fx[h];
    if (st && (st.s === 'ok' || st.s === 'x')) continue;
    if (emittedKeys.has(d.key)) continue;
    if (C.mode === 'mig' && !st) {
      const note = d.sys === 'notify' ? `${lower(d.args.template)}|${lower(d.args.to)}` : null;
      if (d.to < C.t0 || (note && C.base && (C.base.notes || []).includes(note))) { C.fx[h] = { s: 'ok' }; continue; }
    }
    if (st && (st.s === 'p' || st.s === 'u')) { open++; continue; }
    if (now < d.from) { wakes.push(d.from); open++; continue; }
    if (st && st.s === 'r' && st.ra != null && now < st.ra) { wakes.push(st.ra); open++; continue; }
    let after = null;
    if (d.dep) {
      const ds = C.fx[hk(d.dep)];
      if (emittedKeys.has(d.dep)) after = d.dep;
      else if (!(ds && (ds.s === 'ok' || ds.s === 'x')) && desiredKeys.has(d.dep)) { open++; continue; }
    }
    const args = st && st.a ? st.a : d.args;
    const eff = { key: d.key, system: d.sys, op: d.op, args: renameArgs(env, d.sys, d.op, args) };
    if (after) eff.after = after;
    effects.push(eff);
    emittedKeys.add(d.key);
    C.fx[h] = { s: 'p', a: args, y: d.sys, K: d.key, t: now, n: st ? st.n ?? 0 : 0 };
    open++;
  }
  for (const [h, st] of Object.entries(C.fx)) {
    if (st.s === 'u') { wakes.push(now + MIN); open++; }
    else if (st.s === 'p' && !emittedKeys.has(st.K)) { wakes.push(Math.max(now + MIN, (st.t ?? now) + 5 * MIN)); open++; }
    else if (st.s === 'r' && !desiredKeys.has(st.K)) delete C.fx[h];
  }

  // 5. Major incident approval task (R7.1).
  const humanTasks = [];
  if (sim.needTask && !C.appr && now >= sim.needTask.x) {
    const pol = edAt(env, C, now).policy || {};
    const mins = toNum(pol.majorApprovalMinutes) ?? 60;
    const id = `${C.num}:majorIncidentApproval:1`;
    C.appr = { id, c: now, dl: now + mins * MIN };
    const task = {
      id, kind: 'majorIncidentApproval', role: 'incidentManager', subject: C.num,
      question: `Declare ${C.num} a major incident? Answer {"decision":"approve"} or {"decision":"reject"}.`,
      answerSchema: { type: 'object', properties: { decision: { type: 'string', enum: ['approve', 'reject'] } }, required: ['decision'] },
      dueAt: fmt(C.appr.dl), onTimeout: 'expire',
    };
    if (sim.S && sim.S.callerId) task.excludeUsers = [String(sim.S.callerId)];
    humanTasks.push(task);
    wakes.push(C.appr.dl + MIN);
    open++;
  }

  // 6. One wake-up obligation at the earliest instant something becomes due.
  const fut = wakes.filter((w) => w != null && Number.isFinite(w) && w > now);
  const next = fut.length ? Math.min(...fut) : null;
  const obligations = { upsert: [], cancel: [] };
  if (next != null) {
    if (C.wk !== next) {
      obligations.upsert.push({ id: wakeId, kind: 'wake', anchor: fmt(now), dueAt: fmt(next), onDue: 'recheck' });
      C.wk = next;
    }
  } else if (C.wk != null) {
    obligations.cancel.push(wakeId);
    C.wk = null;
  }

  const S = sim.S;
  const priority = S && S.exists ? clampInt(S.priority, 1, 5) : null;
  C.lastP = priority;
  const done = !!(S && ENDED.has(S.state)) && open === 0 && next == null && !Object.values(C.fx).some((x) => x.s === 'p' || x.s === 'u');
  const outp = { decisions: { subject: C.num || null, priority: C.num ? priority : null }, effects, obligations, humanTasks, carry: C };
  if (done) outp.close = true;
  return outp;
}

// Internals for the author's own spec-derived unit tests (not part of the arm interface).
export const __internals = { reach, openBetween, bizMinutes, localToInstant, priorityFor, groupFor, alertUrgency, renameArgs, normInc, fmt, parseT, edAt };
