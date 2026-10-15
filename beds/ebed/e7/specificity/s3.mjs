// E7 blind specificity solver #3 (written from SPEC-E.md, the api/*.schema.json files, TASK.md and the arm
// interface of BED-CONTRACT v1.1 §3 only).
//
// Structure: an event-sourced incident log per incident, replayed on every tick into
//   (1) an incident timeline (one snapshot per change instant, deadline consequences as later sub-instants),
//   (2) an OBLIGATIONS TABLE: every effect the rules require, each with a deterministic idempotency key,
//       canonical arguments, a window [from, to] and the key of the effect it must follow,
// and a SCHEDULER that diffs the table against the effect ledger kept in carry (sent / ok / retry / dead),
// emits what is due (chained with `after`), retries what failed with the same key and arguments, and asks for
// exactly one wake-up at the earliest future instant anything becomes due.
// No model or network calls; deterministic (time comes only from input.now and event times).

import * as fs from 'node:fs';
import * as nodePath from 'node:path';

const MS = 60000;
const INF = Number.POSITIVE_INFINITY;
const FINAL = new Set(['resolved', 'closed', 'cancelled']);
const ENDED = new Set(['closed', 'cancelled']);
const ACTIVE = new Set(['inProgress', 'paused']);
const WORKING = new Set(['assigned', 'inProgress', 'onHold']);
const DEF_TZ = 'Europe/Amsterdam';
const CARRY_V = 3;

// ---------------------------------------------------------------- small utilities

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const toMin = (s) => {
  if (typeof s !== 'string') return null;
  const ms = Date.parse(s.trim());
  return Number.isFinite(ms) ? Math.floor(ms / MS) : null;
};
const iso = (m) => new Date((m + 60) * MS).toISOString().slice(0, 19) + '+01:00';
const isoN = (m) => (m == null || !Number.isFinite(m) ? null : iso(m));
const tc = (m) => (Number.isFinite(m) ? m.toString(36) : 'x');
const lc = (s) => (s == null ? '' : String(s).trim().toLowerCase());
const normNum = (s) => {
  if (s == null) return null;
  const v = String(s).trim().replace(/^#+/, '').trim().toUpperCase();
  return v || null;
};
const normId = normNum;
const int = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Math.trunc(Number(v));
  return null;
};
const lvl = (v) => {
  const n = int(v);
  return n == null ? null : Math.min(3, Math.max(1, n));
};
const fnv = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
};
// One key per logical effect; deterministic from the effect's identity, never from the instance.
const K = (...parts) => {
  const k = parts.map((p) => String(p)).join(':');
  return k.length <= 180 ? k : `${k.slice(0, 150)}~${fnv(k)}${fnv(`${k}#`)}`;
};
const eqv = (a, b) => {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  return String(a).toLowerCase() === String(b).toLowerCase();
};
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

// ---------------------------------------------------------------- time zones and calendars

const fmtCache = new Map();
function fmtFor(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    });
    fmtCache.set(tz, f);
  }
  return f;
}
const tzOk = new Map();
function validTz(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  if (tzOk.has(tz)) return tzOk.get(tz);
  let ok = true;
  try { fmtFor(tz); } catch { ok = false; }
  tzOk.set(tz, ok);
  return ok;
}
const offCache = new Map();
// offset (minutes) of local wall clock over UTC at instant m. Transitions happen on quarter hours.
function offsetAt(tz, m) {
  const b = Math.floor(m / 15) * 15;
  const ck = `${tz}|${b}`;
  const hit = offCache.get(ck);
  if (hit !== undefined) return hit;
  const parts = fmtFor(tz).formatToParts(new Date(b * MS));
  let y = 1970, mo = 1, d = 1, h = 0, mi = 0;
  for (const p of parts) {
    if (p.type === 'year') y = +p.value;
    else if (p.type === 'month') mo = +p.value;
    else if (p.type === 'day') d = +p.value;
    else if (p.type === 'hour') h = +p.value % 24;
    else if (p.type === 'minute') mi = +p.value;
  }
  const v = Date.UTC(y, mo - 1, d, h, mi) / MS - b;
  if (offCache.size > 300000) offCache.clear();
  offCache.set(ck, v);
  return v;
}
const localDay = (tz, m) => Math.floor((m + offsetAt(tz, m)) / 1440);
const dayStr = (day) => new Date(day * 86400000).toISOString().slice(0, 10);
const isoWeekday = (day) => ((((day + 3) % 7) + 7) % 7) + 1; // 1970-01-01 was a Thursday (4)
const localDateStr = (tz, m) => dayStr(localDay(tz, m));
// The instant at which the local clock in tz FIRST reads minute-of-day `mod` of local day `day` (mod may be >= 1440).
function zonedToMin(tz, day, mod) {
  const L = day * 1440 + mod;
  const c1 = L - offsetAt(tz, L - 1440);
  const c2 = L - offsetAt(tz, L + 1440);
  const ok = [c1, c2].filter((t) => t + offsetAt(tz, t) === L).sort((a, b) => a - b);
  if (ok.length) return ok[0];
  let lo = Math.min(c1, c2), hi = Math.max(c1, c2); // skipped local time: first instant whose local time is later
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (mid + offsetAt(tz, mid) >= L) hi = mid; else lo = mid + 1;
  }
  return lo;
}
const hm = (s) => {
  if (typeof s === 'number') return s;
  const m = /^\s*(\d{1,2}):(\d{2})/.exec(String(s ?? ''));
  return m ? +m[1] * 60 + +m[2] : null;
};

function normCalendar(raw, id) {
  if (!isObj(raw)) return null;
  const tz = validTz(raw.tz) ? raw.tz : (validTz(raw.timezone) ? raw.timezone : null);
  let bh = raw.businessHours ?? raw.hours ?? '24x7';
  const blocks = [];
  if (typeof bh === 'string') {
    blocks.push({ days: [1, 2, 3, 4, 5, 6, 7], hours: [[0, 1440]] });
  } else {
    for (const b of Array.isArray(bh) ? bh : [bh]) {
      if (!isObj(b)) continue;
      const days = (Array.isArray(b.days) ? b.days : [1, 2, 3, 4, 5, 6, 7]).map((d) => int(d)).filter((d) => d >= 1 && d <= 7);
      const hours = [];
      for (const h of Array.isArray(b.hours) ? b.hours : []) {
        const s = hm(Array.isArray(h) ? h[0] : h?.from ?? h?.start);
        let e = hm(Array.isArray(h) ? h[1] : h?.to ?? h?.end);
        if (s == null || e == null) continue;
        if (e <= s) e += 1440;
        hours.push([s, e]);
      }
      blocks.push({ days, hours });
    }
  }
  const hol = new Map();
  for (const h of Array.isArray(raw.holidays) ? raw.holidays : []) {
    const date = typeof h === 'string' ? h.slice(0, 10) : (h?.date ? String(h.date).slice(0, 10) : null);
    if (!date) continue;
    const from = isObj(h) ? hm(h.from) : null;
    const to = isObj(h) ? hm(h.to) : null;
    const cur = hol.get(date) ?? [];
    if (from == null && to == null) cur.push([0, 1e9]);
    else cur.push([from ?? 0, to == null ? 1440 : (to === 0 ? 1440 : to)]);
    hol.set(date, cur);
  }
  return { id: raw.id ?? id, tz, blocks, hol };
}

const dayCache = new Map();
function dayOpen(cal, tz, day) {
  const ck = `${cal.id}|${tz}|${day}`;
  const hit = dayCache.get(ck);
  if (hit) return hit;
  const wd = isoWeekday(day);
  let loc = [];
  for (const b of cal.blocks) if (b.days.includes(wd)) for (const h of b.hours) loc.push([h[0], h[1]]);
  const hs = cal.hol.get(dayStr(day));
  if (hs) {
    for (const [hf, ht] of hs) {
      const nxt = [];
      for (const [s, e] of loc) {
        if (ht <= s || hf >= e) { nxt.push([s, e]); continue; }
        if (hf > s) nxt.push([s, hf]);
        if (ht < e) nxt.push([ht, e]);
      }
      loc = nxt;
    }
  }
  loc.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of loc) {
    const a = zonedToMin(tz, day, s), b = zonedToMin(tz, day, e);
    if (b > a) out.push([a, b]);
  }
  if (dayCache.size > 100000) dayCache.clear();
  dayCache.set(ck, out);
  return out;
}
// open intervals [s, e) of a schedule, ascending, overlapping [a, b)
function* openFrom(sch, a, b) {
  const start = localDay(sch.tz, a) - 1;
  for (let d = start; d < start + 1200; d++) {
    const iv = dayOpen(sch.cal, sch.tz, d);
    for (const x of iv) {
      if (x[1] <= a) continue;
      if (x[0] >= b) return;
      yield x;
    }
    if (Number.isFinite(b) && zonedToMin(sch.tz, d + 1, 0) >= b + 1440) return;
  }
}
const hasCal = (sch) => !!(sch && sch.cal && sch.tz);
function bizBetween(sch, a, b) {
  if (!(b > a)) return 0;
  if (!hasCal(sch)) return b - a;
  let acc = 0;
  for (const [s, e] of openFrom(sch, a, b)) {
    const lo = Math.max(s, a), hi = Math.min(e, b);
    if (hi > lo) acc += hi - lo;
  }
  return acc;
}
const bizSum = (sch, segs) => segs.reduce((acc, [a, b]) => acc + bizBetween(sch, a, b), 0);
// the first instant at which the business time accrued over `segs` reaches T (closing time when reached there, S4)
function reachOn(sch, segs, T) {
  if (T == null || !Number.isFinite(T) || !segs.length) return null;
  if (T <= 0) return segs[0][0];
  let acc = 0;
  for (const [a, b] of segs) {
    if (!(b > a)) continue;
    if (!hasCal(sch)) {
      if (acc + (b - a) >= T) return a + (T - acc);
      acc += b - a;
      continue;
    }
    for (const [s, e] of openFrom(sch, a, b)) {
      const lo = Math.max(s, a), hi = Math.min(e, b);
      if (hi <= lo) continue;
      if (acc + (hi - lo) >= T) return lo + (T - acc);
      acc += hi - lo;
    }
  }
  return null;
}
// running segments of an SLA: [startAt, end) minus its pauses (an open pause runs to `end`)
function runningSegs(startAt, pauses, end) {
  const ps = pauses.map(([p, q]) => [p, q == null ? end : q]).filter(([p, q]) => q > p).sort((x, y) => x[0] - y[0]);
  const out = [];
  let cur = startAt;
  for (const [p, q] of ps) {
    if (p >= end) break;
    if (p > cur) out.push([cur, Math.min(p, end)]);
    cur = Math.max(cur, q);
  }
  if (end > cur) out.push([cur, end]);
  return out;
}

// ---------------------------------------------------------------- files and the environment of one call

function makeFiles(files) {
  const map = new Map();
  let reader = null, lister = null, dir = null;
  const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  const addFlat = (obj, prefix, depth) => {
    for (const [k, v] of Object.entries(obj)) {
      if (v == null) continue;
      const p = prefix + k;
      if (typeof v === 'string' || v instanceof Uint8Array || /\.[A-Za-z0-9]{1,5}$/.test(k) || depth > 6 || Array.isArray(v)) map.set(norm(p), v);
      else if (isObj(v)) addFlat(v, `${p}/`, depth + 1);
    }
  };
  if (typeof files === 'string') dir = files;
  else if (files instanceof Map) for (const [k, v] of files) map.set(norm(k), v);
  else if (Array.isArray(files)) {
    for (const f of files) if (isObj(f) && f.path) map.set(norm(f.path), f.content ?? f.text ?? f.data ?? f.body);
  } else if (typeof files === 'function') reader = files;
  else if (isObj(files)) {
    const r = ['read', 'get', 'readFile', 'file', 'text', 'json'].find((m) => typeof files[m] === 'function');
    const l = ['list', 'keys', 'paths', 'ls', 'readdir'].find((m) => typeof files[m] === 'function');
    if (r || l) {
      if (r) reader = (p) => files[r](p);
      if (l) lister = () => files[l]();
      if (!r && !l) addFlat(files, '', 0);
    } else addFlat(files, '', 0);
  }
  let listed = null;
  const list = () => {
    if (listed) return listed;
    const s = new Set(map.keys());
    if (lister) {
      try {
        const r = lister();
        if (r && typeof r.then !== 'function') for (const p of (Array.isArray(r) ? r : [...(r[Symbol.iterator] ? r : Object.keys(r))])) s.add(norm(p));
      } catch { /* ignore */ }
    }
    if (dir) {
      const walk = (d, rel, depth) => {
        if (depth > 6) return;
        let ents = [];
        try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) walk(nodePath.join(d, e.name), r, depth + 1);
          else s.add(r);
        }
      };
      walk(dir, '', 0);
    }
    listed = [...s].sort();
    return listed;
  };
  const cache = new Map();
  const get = (p0) => {
    const p = norm(p0);
    if (cache.has(p)) return cache.get(p);
    let raw = map.get(p);
    if (raw === undefined && reader) {
      try { raw = reader(p); } catch { raw = undefined; }
      if (raw && typeof raw.then === 'function') raw = undefined;
    }
    if (raw === undefined && dir) {
      try { raw = fs.readFileSync(nodePath.join(dir, p), 'utf8'); } catch { raw = undefined; }
    }
    if (isObj(raw) && !(raw instanceof Uint8Array) && ('content' in raw || 'text' in raw) && Object.keys(raw).length <= 4 && !p.endsWith('.json')) {
      raw = raw.content ?? raw.text;
    }
    if (raw instanceof Uint8Array) raw = new TextDecoder().decode(raw);
    let v = raw;
    if (typeof raw === 'string' && /\.json$/i.test(p)) {
      try { v = JSON.parse(raw); } catch { v = undefined; }
    } else if (typeof raw === 'string' && /\.csv$/i.test(p)) v = parseCsv(raw);
    cache.set(p, v);
    return v;
  };
  return { list, get };
}
function parseCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const split = (l) => l.split(',').map((x) => x.trim().replace(/^"|"$/g, ''));
  const head = split(lines[0]);
  return lines.slice(1).map((l) => {
    const c = split(l);
    const o = {};
    head.forEach((h, i) => { const v = c[i]; o[h] = v !== undefined && /^-?\d+$/.test(v) ? Number(v) : v; });
    return o;
  });
}
function rowsOf(x, hint) {
  if (Array.isArray(x)) return x.filter(isObj);
  if (!isObj(x)) return [];
  for (const k of [hint, 'items', 'rows', 'records', 'data', 'list', 'entries', 'definitions', 'slas']) {
    if (k && Array.isArray(x[k])) return x[k].filter(isObj);
  }
  const vals = Object.entries(x).filter(([, v]) => isObj(v));
  if (vals.length && vals.length === Object.keys(x).length) return vals.map(([k, v]) => ({ id: k, ...v }));
  return [];
}

function loadEnv(ctx) {
  const F = makeFiles(ctx?.files);
  const paths = F.list();
  const eds = [];
  const seenDirs = new Set();
  for (const p of paths) {
    const m = /^rulebook\/([^/]+)\/edition\.json$/.exec(p);
    if (!m) continue;
    const e = F.get(p);
    seenDirs.add(m[1]);
    const eff = isObj(e) && e.effectiveFrom ? String(e.effectiveFrom).slice(0, 10) : '0000-00-00';
    eds.push({ dir: m[1], id: isObj(e) && e.id != null ? String(e.id) : m[1], eff });
  }
  for (const p of paths) {
    const m = /^rulebook\/([^/]+)\//.exec(p);
    if (m && !seenDirs.has(m[1])) { seenDirs.add(m[1]); eds.push({ dir: m[1], id: m[1], eff: '0000-00-00' }); }
  }
  eds.sort((a, b) => (a.eff < b.eff ? -1 : a.eff > b.eff ? 1 : a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
  const rbFile = (ed, name) => {
    if (!ed) return undefined;
    let v = F.get(`rulebook/${ed.dir}/${name}.json`);
    if (v === undefined) v = F.get(`rulebook/${ed.dir}/${name}.csv`);
    return v;
  };
  let sysTz = DEF_TZ;
  for (let i = eds.length - 1; i >= 0; i--) {
    const pol = rbFile(eds[i], 'policy');
    if (isObj(pol) && validTz(pol.systemTimeZone)) { sysTz = pol.systemTimeZone; break; }
  }
  const edAt = (m) => {
    if (!eds.length) return null;
    const d = localDateStr(sysTz, m);
    let pick = null;
    for (const e of eds) if (e.eff <= d) pick = e;
    return pick ?? eds[0];
  };
  const rb = (m, name) => rbFile(edAt(m), name);

  const index = (rows, extra) => {
    const by = new Map();
    for (const r of rows) {
      const id = r.id ?? r[extra];
      if (id != null && !by.has(lc(id))) by.set(lc(id), r);
    }
    return by;
  };
  const cis = rowsOf(F.get('master/cis.json'), 'cis');
  const ciById = index(cis, 'ci');
  const ciAny = new Map();
  for (const c of cis) {
    for (const a of [c.id, c.name, ...(Array.isArray(c.aliases) ? c.aliases : [])]) if (a != null && !ciAny.has(lc(a))) ciAny.set(lc(a), c);
  }
  const services = index(rowsOf(F.get('master/services.json'), 'services'), 'service');
  const groups = index(rowsOf(F.get('master/groups.json'), 'groups'), 'group');
  const users = index(rowsOf(F.get('master/users.json'), 'users'), 'user');

  const calCache = new Map();
  const cal = (id) => {
    if (id == null) return null;
    if (calCache.has(id)) return calCache.get(id);
    const c = normCalendar(F.get(`calendar/${id}.json`), id);
    calCache.set(id, c);
    return c;
  };
  const api = {};
  for (const sys of ['itsm', 'sla', 'notify']) api[sys] = F.get(`api/${sys}.schema.json`);

  const env = {
    F, sysTz, eds, edAt, rb,
    ci: (ref) => (ref == null ? null : ciById.get(lc(ref)) ?? ciAny.get(lc(ref)) ?? null),
    service: (id) => (id == null ? null : services.get(lc(id)) ?? null),
    group: (id) => (id == null ? null : groups.get(lc(id)) ?? null),
    user: (id) => (id == null ? null : users.get(lc(id)) ?? null),
    cal,
    api,
  };
  env.groupId = (g) => (g == null ? null : (env.group(g)?.id ?? String(g).trim()));
  env.mailbox = (g) => env.group(g)?.mailbox ?? null;
  env.policy = (m) => { const p = rb(m, 'policy'); return isObj(p) ? p : {}; };
  env.policyNum = (m, k, d) => { const v = Number(env.policy(m)[k]); return Number.isFinite(v) ? v : d; };
  env.priority = (svc, imp, urg, m) => {
    const rows = rowsOf(rb(m, 'priority'), 'rows');
    let best = null;
    for (const r of rows) {
      if (int(r.impact) !== imp || int(r.urgency) !== urg) continue;
      if (!(r.service === '*' || eqv(r.service, svc))) continue;
      const o = Number(r.order);
      if (best == null || o < best.o) best = { o, p: int(r.priority) };
    }
    if (best && best.p >= 1 && best.p <= 5) return best.p;
    return Math.min(5, Math.max(1, (imp ?? 3) + (urg ?? 3) - 1));
  };
  env.assignGroup = (category, region, ciRec, m) => {
    const rows = rowsOf(rb(m, 'assignment'), 'rows');
    let best = null;
    for (const r of rows) {
      if (!(r.category === '*' || eqv(r.category, category))) continue;
      if (!(r.region === '*' || eqv(r.region, region))) continue;
      const o = Number(r.order);
      if (best == null || o < best.o) best = { o, g: r.group };
    }
    if (!best || best.g == null) return null;
    if (best.g === 'ciSupportGroup') return ciRec?.supportGroup ? env.groupId(ciRec.supportGroup) : null;
    return env.groupId(best.g);
  };
  env.alertUrg = (sev, m) => {
    const au = rb(m, 'alert-urgency');
    const s = lc(sev);
    const pick = (v) => {
      if (isObj(v)) v = v.urgency;
      const n = int(v);
      return n != null && n >= 1 && n <= 3 ? n : null;
    };
    if (Array.isArray(au)) {
      const r = au.find((x) => isObj(x) && lc(x.severity ?? x.id ?? x.name) === s);
      return r ? pick(r.urgency ?? r) : null;
    }
    if (isObj(au)) {
      for (const k of ['map', 'severities', 'urgency', 'bySeverity', 'rows']) {
        if (Array.isArray(au[k])) {
          const r = au[k].find((x) => isObj(x) && lc(x.severity ?? x.id) === s);
          if (r) return pick(r.urgency ?? r);
        } else if (isObj(au[k]) && Object.keys(au[k]).some((x) => lc(x) === s)) {
          const kk = Object.keys(au[k]).find((x) => lc(x) === s);
          return pick(au[k][kk]);
        }
      }
      const kk = Object.keys(au).find((x) => lc(x) === s);
      return kk ? pick(au[kk]) : null;
    }
    return null;
  };
  env.slaDefs = (m) => rowsOf(rb(m, 'sla-definitions'), 'definitions').filter((d) => d.id != null);
  env.findDef = (id, m) => {
    const here = env.slaDefs(m).find((d) => eqv(d.id, id));
    if (here) return here;
    for (let i = eds.length - 1; i >= 0; i--) {
      const d = rowsOf(rbFile(eds[i], 'sla-definitions'), 'definitions').find((x) => eqv(x.id, id));
      if (d) return d;
    }
    return null;
  };
  env.schedById = (id, tzHint) => {
    if (id == null) return { id: null, tz: null, cal: null };
    const c = cal(id);
    const tz = c?.tz ?? (validTz(tzHint) ? tzHint : sysTz);
    return { id: String(id), tz, cal: c };
  };
  env.deskSched = (m) => {
    const id = env.policy(m).serviceDeskCalendar;
    if (id == null) return { id: null, tz: null, cal: null };
    const c = cal(id);
    return { id: String(id), tz: c?.tz ?? sysTz, cal: c };
  };
  // the instant at which business time on the service desk calendar since t reaches `days` business days (R6)
  env.bizDeadline = (t, daysKey) => {
    const days = env.policyNum(t, daysKey, null);
    if (days == null) return null;
    const bdm = env.policyNum(t, 'businessDayMinutes', 480);
    return reachOn(env.deskSched(t), [[t, INF]], Math.round(days * bdm));
  };
  return env;
}

// SLA schedule and time zone fixed at the attach instant x (R4.3)
function slaSchedule(env, def, s) {
  const src = lc(def?.schedule?.source);
  let id = null;
  if (src === 'calendar') id = def.schedule.calendar ?? null;
  else if (src === 'service') id = env.service(s.service)?.supportSchedule ?? null;
  else if (src === 'assignmentgroup') id = env.group(s.group)?.schedule ?? null;
  if (id == null) return { id: null, tz: null, cal: null };
  const c = env.cal(id);
  let tz = c?.tz ?? null;
  if (!tz) {
    for (const so of Array.isArray(def?.timezone?.sources) ? def.timezone.sources : []) {
      let z = null;
      if (so === 'caller') z = s.callerId ? env.user(s.callerId)?.timezone : null;
      else if (so === 'ci') z = env.ci(s.ci)?.timezone;
      else if (so === 'definition') z = def.timezone?.definition;
      if (validTz(z)) { tz = z; break; }
    }
  }
  if (!tz) tz = env.sysTz;
  return { id: String(id), tz, cal: c };
}

// ---------------------------------------------------------------- argument names (API changes)

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
    pause: ['number', 'definition', 'generation', 'at'],
    resume: ['number', 'definition', 'generation', 'at', 'plannedBreachAt'],
    breach: ['number', 'definition', 'generation', 'at'],
    stop: ['number', 'definition', 'generation', 'at', 'elapsedMinutes', 'businessElapsedMinutes', 'breached'],
    cancel: ['number', 'definition', 'generation', 'at', 'reason'],
    escalate: ['number', 'definition', 'generation', 'percent', 'to'],
  },
  notify: { send: ['to', 'about', 'template', 'text', 'ref'] },
};
const RENAME_HINT_KEYS = ['renamedFrom', 'x-renamedFrom', 'x-renamed-from', 'formerly', 'oldName', 'previousName', 'was', 'alias', 'aliases', 'x-alias'];
function argNames(env, sys, op) {
  const canon = CANON[sys]?.[op] ?? [];
  const opS = env.api?.[sys]?.ops?.[op] ?? env.api?.[sys]?.effects?.[op];
  const props = opS?.args?.properties ?? opS?.properties;
  const out = {};
  for (const c of canon) out[c] = c;
  if (!isObj(props)) return out;
  const cur = Object.keys(props);
  const missing = canon.filter((c) => !cur.includes(c));
  if (!missing.length) return out;
  let extra = cur.filter((p) => !canon.includes(p));
  for (const c of missing) out[c] = null;
  // 1. explicit annotations
  for (const p of [...extra]) {
    const d = props[p] ?? {};
    let hit = null;
    for (const k of RENAME_HINT_KEYS) {
      const v = d[k];
      for (const x of Array.isArray(v) ? v : [v]) if (typeof x === 'string' && missing.includes(x) && out[x] == null) hit = x;
    }
    if (!hit && typeof d.description === 'string') {
      const mm = missing.filter((c) => out[c] == null && new RegExp(`\\b(formerly|was|renamed from|previously|old name)\\W+\`?${c}\\b`, 'i').test(d.description));
      if (mm.length === 1) hit = mm[0];
    }
    if (hit) { out[hit] = p; extra = extra.filter((x) => x !== p); }
  }
  // 2. one missing, one new: the rename
  let left = missing.filter((c) => out[c] == null);
  if (left.length === 1 && extra.length === 1) { out[left[0]] = extra[0]; return out; }
  // 3. several: pair by position in the property order
  if (left.length && left.length === extra.length) {
    const pos = (c) => canon.indexOf(c);
    left.sort((a, b) => pos(a) - pos(b));
    const ex = extra.slice().sort((a, b) => cur.indexOf(a) - cur.indexOf(b));
    left.forEach((c, i) => { out[c] = ex[i]; });
    return out;
  }
  // 4. a field name that merely changed case or punctuation
  for (const c of left) {
    const p = extra.find((x) => x.toLowerCase().replace(/[_-]/g, '') === c.toLowerCase());
    if (p) { out[c] = p; extra = extra.filter((x) => x !== p); }
  }
  return out;
}
function nameArgs(env, sys, op, args) {
  const names = argNames(env, sys, op);
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined) continue;
    const n = names[k] === undefined ? k : names[k];
    if (n == null) {
      if (k === 'ref') continue; // optional and unmappable: leave it out
      out[k] = v;
      continue;
    }
    out[n] = v;
  }
  return out;
}

// ---------------------------------------------------------------- conditions (R4.1)

const FIELD = { assignmentGroup: 'group' };
const fval = (s, f) => (s ? s[FIELD[f] ?? f] : undefined);
function holds(conds, s) {
  if (!s || !Array.isArray(conds) || conds.length === 0) return false;
  return conds.every((c) => {
    if (!isObj(c) || typeof c.field !== 'string') return false;
    const v = fval(s, c.field);
    if (Array.isArray(c.in)) return c.in.some((x) => eqv(v, x));
    if ('in' in c) return eqv(v, c.in);
    if (Array.isArray(c.notIn)) return !c.notIn.some((x) => eqv(v, x));
    if ('eq' in c || 'equals' in c) return eqv(v, c.eq ?? c.equals);
    return false;
  });
}
const snap = (S) => ({
  state: S.state, holdReason: S.state === 'onHold' ? S.holdReason ?? null : null, priority: S.priority, impact: S.impact,
  urgency: S.urgency, source: S.source, service: S.service, group: S.group, assignee: S.assignee, major: !!S.major,
  callerId: S.callerId, ci: S.ci, check: S.check, category: S.category,
});

// ---------------------------------------------------------------- the replay: incident log -> obligations table

function replay(ic, env, now) {
  const n = ic.n;
  const duties = [];
  const wakes = [];
  const snaps = [];
  let gi = 0;
  let lastItsm = null;
  const add = (d) => { d.gi = gi++; duties.push(d); return d; };
  const itsm = (op, key, args, from, to) => {
    const d = add({ sys: 'itsm', op, key, args, from, to, dep: lastItsm });
    lastItsm = key;
    return d;
  };
  const note = (template, occ, to, from, toW, dep, ref) => {
    if (!to) return null;
    const args = { to, about: n, template, text: `${template}: ${n}` };
    if (ref) args.ref = ref;
    return add({ sys: 'notify', op: 'send', key: K('N', n, template, occ), args, from, to: toW, dep });
  };
  const owner = ic.own ?? 'i';
  const refFor = (t) => `R|${owner}|${ic.p ?? n}|${n}|${tc(t)}`.slice(0, 120);

  let S;
  const A = { x: null, pre: false, moot: false, counted: null, allow: 0, declared: null, dl: null, used: new Set() };
  let callerD = null, resD2 = null;
  let createKey = null;
  let openedAt;
  const isMig = !ic.cr && !!ic.mb;
  const t0 = isMig ? ic.t0 : null;
  const email = () => (S.callerId ? env.user(S.callerId)?.email ?? null : null);

  if (ic.cr) {
    const c = ic.cr;
    const t = c.t;
    openedAt = t;
    S = {
      state: c.group ? 'assigned' : 'new', holdReason: null, priority: c.priority, impact: c.impact, urgency: c.urgency,
      source: c.source.kind, service: c.service, group: c.group ?? null, assignee: null, major: false, callerId: c.callerId,
      ci: c.ci, check: c.check, category: c.category, alerts: [],
    };
    createKey = K('I', n, 'create');
    itsm('create', createKey, {
      number: n, source: { kind: c.source.kind, id: c.source.id }, callerId: c.callerId, ci: c.ci, check: c.check,
      service: c.service, category: c.category, impact: c.impact, urgency: c.urgency, priority: c.priority,
      openedAt: iso(t), summary: c.summary,
    }, t, t);
    if (c.group) {
      const ref = refFor(t);
      const ka = itsm('assign', K('I', n, 'assign', tc(t), c.group), { number: n, group: c.group, at: iso(t), ref }, t, t + 15);
      note('assignment', `${tc(t)}:${c.group}`, env.mailbox(c.group), t, t + 15, ka.key, ref);
    }
    snaps.push({ t, sub: 0, s: snap(S), create: true });
    if (S.priority === 1) A.x = t;
  } else if (ic.mb) {
    const b = ic.mb;
    openedAt = b.openedAt ?? t0;
    S = {
      state: b.state, holdReason: b.holdReason ?? null, priority: b.priority, impact: b.impact, urgency: b.urgency,
      source: b.srcKind, service: b.service, group: b.group ?? null, assignee: b.assignee ?? null, major: !!b.major,
      callerId: b.callerId ?? null, ci: b.ci, check: b.check ?? null, category: b.category, alerts: [...(b.alerts ?? [])],
    };
    const h0 = { ...S, state: S.state === 'new' ? 'new' : (S.assignee ? 'inProgress' : 'assigned'), holdReason: null };
    if (FINAL.has(S.state) || S.state === 'onHold') h0.state = S.assignee ? 'inProgress' : 'assigned';
    if (openedAt < t0) snaps.push({ t: openedAt, sub: 0, s: snap(h0), hist: true });
    if (S.state === 'onHold' && b.h != null && b.h > openedAt && b.h < t0) snaps.push({ t: b.h, sub: 0, s: snap(S), hist: true });
    if (S.state === 'resolved' && b.resolvedAt != null && b.resolvedAt > openedAt && b.resolvedAt < t0) snaps.push({ t: b.resolvedAt, sub: 0, s: snap(S), hist: true });
    snaps.push({ t: t0, sub: -1, s: snap(S), base: true });
    if (S.state === 'onHold' && S.holdReason === 'awaitingCaller') { const h = b.h ?? t0; callerD = { h, D: env.bizDeadline(h, 'callerReplyDays') }; }
    if (S.state === 'resolved') { const r = b.resolvedAt ?? t0; resD2 = { r, D: env.bizDeadline(r, 'resolvedCloseDays') }; }
    if (S.priority === 1 && !S.major && !FINAL.has(S.state)) { if (openedAt + 15 >= t0) A.x = openedAt; else A.pre = true; }
    if (S.state === 'new' && openedAt + 15 >= t0 && b.group0) {
      const g = b.group0;
      const ref = refFor(openedAt);
      const ka = itsm('assign', K('I', n, 'assign', tc(openedAt), g), { number: n, group: g, at: iso(openedAt), ref }, openedAt, openedAt + 15);
      note('assignment', `${tc(openedAt)}:${g}`, env.mailbox(g), openedAt, openedAt + 15, ka.key, ref);
      S.state = 'assigned'; S.group = g;
    }
  } else {
    return null;
  }

  const tasks = ic.tasks ?? [];
  const taskIdx = new Map(tasks.map((tk, i) => [tk.id, i]));
  if (tasks.length) A.dl = tasks[0].t + env.policyNum(tasks[0].t, 'majorApprovalMinutes', 30);
  const apprOpen = () => A.x != null && !A.pre && !A.moot && !A.counted && A.declared == null;
  const checkMoot = (t) => {
    if (!apprOpen()) return;
    if (!(FINAL.has(S.state) || S.priority !== 1)) return;
    if (A.dl == null || t < A.dl) A.moot = true;
    else if (t === A.dl && ENDED.has(S.state)) A.moot = true; // S16
  };

  let chg = false;
  const reclass = (im, ur, t) => {
    if (FINAL.has(S.state)) return;
    if (im == null || ur == null) return;
    const pr = env.priority(S.service, im, ur, t);
    if (im === S.impact && ur === S.urgency && pr === S.priority) return; // R2.3: nothing changes, nothing recorded
    S.impact = im; S.urgency = ur; S.priority = pr; chg = true;
    itsm('reclassify', K('I', n, 'reclass', tc(t), `${im}${ur}${pr}`), { number: n, impact: im, urgency: ur, priority: pr, at: iso(t) }, t, t + 15);
    if (pr === 1 && A.x == null && !A.pre) A.x = t;
  };
  const doResume = (t) => {
    S.state = 'inProgress'; S.holdReason = null; callerD = null; chg = true;
    itsm('resume', K('I', n, 'resume', tc(t)), { number: n, at: iso(t) }, t, t + 15);
  };
  const doClose = (t, reason, from, to) => {
    S.state = 'closed'; S.holdReason = null; callerD = null; resD2 = null; chg = true;
    return itsm('close', K('I', n, 'close'), { number: n, reason, at: iso(t) }, from, to);
  };
  const applyUpd = (ev, t) => {
    if (FINAL.has(S.state)) return; // R3.3
    switch (ev.a) {
      case 'accept': {
        if (S.state !== 'assigned' || !ev.u) return;
        S.state = 'inProgress'; S.assignee = ev.u; chg = true;
        itsm('accept', K('I', n, 'accept', tc(t), ev.u), { number: n, user: ev.u, at: iso(t) }, t, t + 15);
        return;
      }
      case 'hold': {
        if (S.state !== 'inProgress') return;
        const reason = ev.hr || 'other';
        S.state = 'onHold'; S.holdReason = reason; chg = true;
        const kh = itsm('hold', K('I', n, 'hold', tc(t)), { number: n, reason, at: iso(t) }, t, t + 15);
        if (reason === 'awaitingCaller') {
          callerD = { h: t, D: env.bizDeadline(t, 'callerReplyDays') };
          note('awaiting-caller', tc(t), email(), t, t + 15, kh.key);
        }
        return;
      }
      case 'resume': {
        if (S.state !== 'onHold') return;
        doResume(t);
        return;
      }
      case 'reassign': {
        const g = ev.tg;
        if (!g || !WORKING.has(S.state)) return;
        if (S.state === 'assigned' && S.group === g) return;
        S.state = 'assigned'; S.group = g; S.assignee = null; S.holdReason = null; callerD = null; chg = true;
        const ref = refFor(t);
        const ka = itsm('assign', K('I', n, 'assign', tc(t), g), { number: n, group: g, at: iso(t), ref }, t, t + 15);
        note('assignment', `${tc(t)}:${g}`, env.mailbox(g), t, t + 15, ka.key, ref);
        return;
      }
      case 'reclassify':
        reclass(ev.im ?? S.impact, ev.ur ?? S.urgency, t);
        return;
      case 'resolve': {
        if (!WORKING.has(S.state)) return;
        S.state = 'resolved'; S.holdReason = null; callerD = null; chg = true;
        const kr = itsm('resolve', K('I', n, 'resolve'), { number: n, closeCode: ev.cc || 'resolved', at: iso(t) }, t, t + 15);
        resD2 = { r: t, D: env.bizDeadline(t, 'resolvedCloseDays') };
        if (S.callerId) note('resolved', '', email(), t, t + 15, kr.key);
        return;
      }
      default:
    }
  };
  const applyMsg = (ev, t) => {
    if (ev.i === 'reply') {
      if (S.state === 'onHold' && S.holdReason === 'awaitingCaller' && callerD && t <= (callerD.D ?? INF)) doResume(t);
    } else if (ev.i === 'confirm') {
      if (S.state === 'resolved' && resD2 && t <= (resD2.D ?? INF)) doClose(t, 'confirmed', t, t + 15);
    } else if (ev.i === 'withdraw') {
      if (FINAL.has(S.state)) return;
      S.state = 'cancelled'; S.holdReason = null; callerD = null; chg = true;
      const kc = itsm('cancel', K('I', n, 'cancel'), { number: n, at: iso(t) }, t, t + 15);
      note('incident-cancelled', '', email(), t, t + 15, kc.key);
    }
  };
  const applyJoin = (ev, t) => {
    if (FINAL.has(S.state) || S.alerts.includes(ev.al)) return;
    S.alerts.push(ev.al);
    itsm('linkAlert', K('I', n, 'link', ev.al), { number: n, alertId: ev.al }, t, t + 15);
    if (ev.ur != null && S.urgency != null && ev.ur < S.urgency) reclass(S.impact, ev.ur, t);
  };
  const applyTask = (ev, t) => {
    const ti = taskIdx.get(ev.task);
    if (ti == null) return;
    if (ev.k === 'to' || ev.k === 'dlg') return; // a timeout at our dueAt is no reason to ask again
    if (ev.k === 'ans') { if (A.used.has(ev.task)) return; A.used.add(ev.task); }
    if (!apprOpen() || A.dl == null || t > A.dl) return;
    if (ti > 0 && ti > A.allow) return; // not one of the counted tasks
    if (ev.k === 'ans' && (ev.dec === 'approve' || ev.dec === 'reject')) {
      A.counted = { t, dec: ev.dec };
      if (ev.dec === 'approve') {
        S.major = true; chg = true;
        const km = itsm('setMajor', K('I', n, 'major'), { number: n, at: iso(t) }, t, t + 15);
        note('major-incident', '', env.service(S.service)?.owner ?? null, t, t + 15, km.key);
      }
      return;
    }
    A.allow += 1; // unusable answer, schema rejection or withdrawal: one more ask is allowed
  };

  // deadline consequences, taken strictly after the deadline and dated at it (S1, S10, S16)
  const runDeadlines = (limit) => {
    for (let guard = 0; guard < 8; guard++) {
      const c = [];
      if (callerD && callerD.D != null && S.state === 'onHold' && S.holdReason === 'awaitingCaller' && callerD.D < limit && callerD.D < now) c.push([callerD.D, 0, 'caller']);
      if (resD2 && resD2.D != null && S.state === 'resolved' && resD2.D < limit && resD2.D < now) c.push([resD2.D, 0, 'auto']);
      if (apprOpen() && A.dl != null && A.dl < limit && A.dl < now) c.push([A.dl, 1, 'major']);
      if (!c.length) return;
      c.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const [d, , kind] = c[0];
      chg = false;
      if (kind === 'caller') {
        const kc = doClose(d, 'no-caller-response', d + 1, d + 60);
        note('closed-no-response', '', email(), d + 1, d + 60, kc.key);
        snaps.push({ t: d, sub: 1, s: snap(S), win: [d + 1, d + 60] });
        checkMoot(d);
      } else if (kind === 'auto') {
        doClose(d, 'auto', d + 1, d + 60);
        snaps.push({ t: d, sub: 1, s: snap(S), win: [d + 1, d + 60] });
        checkMoot(d);
      } else {
        checkMoot(d);
        if (!apprOpen()) continue;
        A.declared = d; S.major = true;
        const km = itsm('setMajor', K('I', n, 'major'), { number: n, at: iso(d) }, d + 1, d + 15);
        note('major-incident', '', env.service(S.service)?.owner ?? null, d + 1, d + 15, km.key);
        snaps.push({ t: d, sub: 2, s: snap(S), win: [d + 1, d + 15] });
      }
      chg = false;
    }
  };

  const log = [...(ic.log ?? [])].sort((a, b) => a.t - b.t || a.q - b.q);
  for (let i = 0; i < log.length;) {
    const t = log[i].t;
    let j = i;
    while (j < log.length && log[j].t === t) j++;
    runDeadlines(t);
    chg = false;
    const grp = log.slice(i, j);
    for (const ev of grp) {
      if (ev.k === 'upd') applyUpd(ev, t);
      else if (ev.k === 'msg') applyMsg(ev, t);
      else if (ev.k !== 'join') applyTask(ev, t);
    }
    for (const ev of grp) if (ev.k === 'join') applyJoin(ev, t); // S8: judged after the instant's updates
    if (chg) { snaps.push({ t, sub: 0, s: snap(S) }); checkMoot(t); }
    chg = false;
    i = j;
  }
  runDeadlines(now);

  // human tasks wanted now (R7.1, R7.2 re-asks)
  let wantTasks = 0;
  if (apprOpen() && A.x <= now) {
    if (!tasks.length) wantTasks = 1;
    else if (A.dl != null && now < A.dl) wantTasks = Math.max(0, A.allow - (tasks.length - 1));
  }
  if (apprOpen() && A.dl != null && A.dl >= now) wakes.push(A.dl + 1);
  if (callerD && callerD.D != null && S.state === 'onHold' && S.holdReason === 'awaitingCaller' && callerD.D >= now) wakes.push(callerD.D + 1);
  if (resD2 && resD2.D != null && S.state === 'resolved' && resD2.D >= now) wakes.push(resD2.D + 1);

  const R = { n, duties, wakes, snaps, model: S, openedAt, createKey, wantTasks, appr: A, isMig, t0, add };
  slaPass(ic, R, env, now);
  if (isMig) R.duties = R.duties.filter((d) => !(d.to < t0));
  return R;
}

// ---------------------------------------------------------------- the SLA engine (R4, R5) over the timeline

function slaPass(ic, R, env, now) {
  const n = R.n;
  const snaps = R.snaps;
  const isMig = R.isMig;
  // distinct-instant timeline (last snapshot of each instant) for "the state at tau"
  const tl = [];
  for (const sn of snaps) {
    if (tl.length && tl[tl.length - 1][0] === sn.t) tl[tl.length - 1][1] = sn.s;
    else tl.push([sn.t, sn.s]);
  }
  const stateAt = (tau) => {
    let s = tl.length ? tl[0][1] : null;
    for (const [t, x] of tl) { if (t <= tau) s = x; else break; }
    return s;
  };
  const L = [];
  if (isMig) for (const r of ic.mb.slas ?? []) L.push(migSla(r, env, n, R.openedAt));

  const pastPauses = (pw, startAt, x, curHolds) => {
    const closed = [];
    let v = holds(pw, stateAt(startAt));
    let p = v ? startAt : null;
    for (const [t, s] of tl) {
      if (t <= startAt) continue;
      if (t >= x) break;
      const nv = holds(pw, s);
      if (nv && !v) p = t;
      if (!nv && v) { closed.push([p, t]); p = null; }
      v = nv;
    }
    let openStart = null;
    if (curHolds) openStart = v ? p : x;
    else if (v && x > p) closed.push([p, x]);
    return { closed, openStart };
  };

  const pushRec = (z, rec) => { z.recs.push(rec); };
  const pauseSla = (z, t, win) => {
    z.stage = 'paused';
    z.pauses.push([t, null]);
    pushRec(z, { op: 'pause', at: t, rank: 2, args: { at: iso(t) }, win });
  };
  const resumeSla = (z, t, win) => {
    const lp = z.pauses[z.pauses.length - 1];
    if (lp && lp[1] == null) lp[1] = t;
    z.stage = 'inProgress';
    const pb = reachOn(z.sched, runningSegs(z.startAt, z.pauses, t).concat([[t, INF]]), z.target);
    pushRec(z, { op: 'resume', at: t, rank: 1, args: { at: iso(t), plannedBreachAt: isoN(pb) }, win });
  };
  const endSla = (z, kind, t, reason, win) => {
    const lp = z.pauses[z.pauses.length - 1];
    if (z.stage === 'paused' && lp && lp[1] == null) lp[1] = t;
    z.end = t;
    z.stage = kind === 'stop' ? 'completed' : 'cancelled';
    if (kind === 'stop') {
      const segs = runningSegs(z.startAt, z.pauses, t);
      const el = segs.reduce((a, [s, e]) => a + (e - s), 0);
      const be = bizSum(z.sched, segs);
      const D = z.migBreachAt ?? reachOn(z.sched, segs, z.target);
      const breached = !!z.migBreached || (D != null && D <= t);
      pushRec(z, { op: 'stop', at: t, rank: 3, args: { at: iso(t), elapsedMinutes: Math.max(0, el), businessElapsedMinutes: Math.max(0, be), breached }, win });
    } else {
      pushRec(z, { op: 'cancel', at: t, rank: 3, args: { at: iso(t), reason }, win });
    }
  };
  const attach = (d, i, x, win, s) => {
    const gen = 1 + L.filter((z) => eqv(z.defId, d.id)).length;
    const retro = d.start?.from === 'openedAt';
    const startAt = retro ? Math.min(R.openedAt, x) : x;
    const sched = slaSchedule(env, d, s);
    const target = Number(d.target?.minutes);
    const pauseNow = !!(d.pause && holds(d.pause.when, s));
    let closed = [];
    let openStart = null;
    if (retro && d.start?.retroactivePause && d.pause && startAt < x) ({ closed, openStart } = pastPauses(d.pause.when, startAt, x, pauseNow));
    else if (pauseNow) openStart = x;
    const z = {
      id: `${n}/${d.id}/${gen}`, defId: String(d.id), gen, def: d, x, idx: i, startAt, sched,
      target: Number.isFinite(target) ? target : null, pauses: [], stage: 'inProgress', end: null, recs: [], win,
    };
    pushRec(z, {
      op: 'start', at: x, rank: -1, win,
      args: { startAt: iso(startAt), schedule: sched.id, timezone: sched.id ? sched.tz : null, plannedBreachAt: isoN(reachOn(sched, [[startAt, INF]], z.target)) },
    });
    for (const [p, q] of closed) {
      z.pauses.push([p, null]);
      pushRec(z, { op: 'pause', at: p, rank: 2, args: { at: iso(p) }, win });
      z.pauses[z.pauses.length - 1][1] = q;
      const pb = reachOn(sched, runningSegs(startAt, z.pauses, q).concat([[q, INF]]), z.target);
      pushRec(z, { op: 'resume', at: q, rank: 1, args: { at: iso(q), plannedBreachAt: isoN(pb) }, win });
    }
    if (openStart != null) {
      z.stage = 'paused';
      z.pauses.push([openStart, null]);
      pushRec(z, { op: 'pause', at: openStart, rank: 2, args: { at: iso(openStart) }, win });
    }
    L.push(z);
  };

  for (let i = 0; i < snaps.length; i++) {
    const sn = snaps[i];
    if (sn.hist || sn.base) continue;
    const prev = i > 0 ? snaps[i - 1].s : null;
    const t = sn.t;
    const s = sn.s;
    const win = sn.win ?? [t, t + 15];
    const changed = (f) => !!prev && !sn.create && !eqv(fval(prev, f), fval(s, f));
    const resetAttach = new Set();
    for (const z of L) {
      if (z.idx >= i || !ACTIVE.has(z.stage) || !z.def) continue;
      const d = z.def;
      if (holds(d.cancel?.when, s)) endSla(z, 'cancel', t, 'cancelled', win);
      else if (d.cancel?.whenStartFails && !holds(d.start?.when, s)) endSla(z, 'cancel', t, 'start-failed', win);
      else if (holds(d.stop?.when, s)) endSla(z, 'stop', t, null, win);
      else if (d.reset?.onChangeOf && changed(d.reset.onChangeOf)) { endSla(z, 'cancel', t, 'reset', win); resetAttach.add(lc(z.defId)); }
      else if (z.stage === 'inProgress' && d.pause && holds(d.pause.when, s)) pauseSla(z, t, win);
      else if (z.stage === 'paused' && !(d.pause && holds(d.pause.when, s))) resumeSla(z, t, win);
    }
    for (const d of env.slaDefs(t)) {
      if (L.some((z) => eqv(z.defId, d.id) && ACTIVE.has(z.stage))) continue;
      if (!holds(d.start?.when, s) || holds(d.stop?.when, s)) continue;
      const before = !sn.create && prev ? holds(d.start?.when, prev) : false;
      const resetTrig = !!(d.reset?.onChangeOf && changed(d.reset.onChangeOf));
      if (!before || resetTrig || resetAttach.has(lc(d.id))) attach(d, i, t, win, s);
    }
  }

  // time-driven records: breach at D (R4.6) and escalations at their thresholds (R5)
  const escs = [];
  for (const z of L) {
    if (z.target == null) continue;
    const endT = z.end;
    const segs = runningSegs(z.startAt, z.pauses, endT ?? INF);
    const D = z.migBreachAt ?? reachOn(z.sched, segs, z.target);
    if (D != null && !z.migBreached && (endT == null || D <= endT)) {
      const u = Math.max(D, z.x);
      pushRec(z, { op: 'breach', at: D, rank: 0, args: { at: iso(D) }, win: [u, u + 15] });
    }
    for (const e of Array.isArray(z.def?.escalations) ? z.def.escalations : []) {
      const pct = int(e?.percent);
      if (!pct || pct < 1) continue;
      if (z.migEsc && z.migEsc.includes(pct)) continue;
      const T = Math.floor((z.target * pct) / 100);
      const y = reachOn(z.sched, segs, T);
      if (y == null || (endT != null && y > endT)) continue;
      const u = Math.max(y, z.x);
      const s = stateAt(u) ?? R.model;
      let to = null;
      const who = lc(e.notify);
      if (who === 'group') to = env.mailbox(s.group);
      else if (who === 'groupmanager') to = env.group(s.group)?.managerEmail ?? null;
      else if (who === 'incidentmanagers') to = env.policy(u).incidentManagersMailbox ?? null;
      if (!to) continue;
      escs.push({ z, pct, u, to });
    }
  }

  // records -> obligations, chained per SLA (start first, then by instant; breach before a same-instant stop)
  const startKeys = new Map();
  for (const z of L) {
    const recs = [...z.recs].sort((a, b) => (a.op === 'start' ? 0 : 1) - (b.op === 'start' ? 0 : 1) || a.at - b.at || a.rank - b.rank);
    let prevKey = z.mig ? null : R.createKey;
    for (const r of recs) {
      const sfx = r.op === 'pause' || r.op === 'resume' ? `:${tc(r.at)}` : '';
      const key = K('S', z.id, r.op) + sfx;
      R.add({
        sys: 'sla', op: r.op, key, from: r.win[0], to: r.win[1], dep: prevKey,
        args: { number: n, definition: z.defId, generation: z.gen, ...r.args },
      });
      if (r.op === 'start') startKeys.set(z.id, key);
      prevKey = key;
    }
  }
  for (const { z, pct, u, to } of escs) {
    R.add({
      sys: 'sla', op: 'escalate', key: K('S', z.id, 'esc', pct), from: u, to: u + 15, dep: startKeys.get(z.id) ?? null,
      args: { number: n, definition: z.defId, generation: z.gen, percent: pct, to },
    });
  }
  R.slas = L;
}

function migSla(r, env, n, openedAt) {
  const startAt = r.startAt ?? openedAt;
  const def = env.findDef(r.def, startAt);
  const sched = r.sched != null ? env.schedById(r.sched, r.tz) : { id: null, tz: null, cal: null };
  const target = Number(def?.target?.minutes);
  const stage = r.stage;
  const pauses = (r.pauses ?? []).map(([p, q]) => [p, q]);
  return {
    id: `${n}/${r.def}/${r.gen}`, defId: String(r.def), gen: r.gen, def, x: startAt, idx: -1, startAt, sched,
    target: Number.isFinite(target) ? target : null, pauses, stage, end: ACTIVE.has(stage) ? null : (r.endAt ?? startAt),
    recs: [], mig: true, migBreached: !!r.breached, migBreachAt: r.breachAt ?? null, migEsc: r.esc ?? [],
  };
}

// ---------------------------------------------------------------- reading events

const KEYF = ['reportId', 'alertId', 'incidentRef', 'intent', 'action'];
function unwrap(p0) {
  if (!isObj(p0)) return {};
  if (KEYF.some((k) => k in p0)) return p0;
  for (const k of ['payload', 'body', 'data', 'message', 'fields', 'content']) if (isObj(p0[k]) && KEYF.some((f) => f in p0[k])) return p0[k];
  return p0;
}
function bizOf(e) {
  const type = String(e?.type ?? '');
  const p0 = isObj(e?.payload) ? e.payload : {};
  if (type === 'effect.result') return { kind: 'result', p: p0 };
  if (type === 'timer.fired') return { kind: 'timer', p: p0 };
  if (type === 'migration') return { kind: 'migration', p: p0 };
  if (type.startsWith('humanTask.')) return { kind: 'task', sub: type.slice(10), p: p0 };
  if (type === 'edition.published') return { kind: 'edition', p: p0 };
  const p = unwrap(p0);
  const names = `${type} ${p0.type ?? ''} ${p0.kind ?? ''} ${p.type ?? ''}`.toLowerCase();
  if (names.includes('incident.reported') || 'reportId' in p) return { kind: 'report', p };
  if (names.includes('alert.raised') || 'alertId' in p) return { kind: 'alert', p };
  if (names.includes('caller.message') || 'incidentRef' in p || 'intent' in p) return { kind: 'caller', p };
  if (names.includes('resolver.update') || 'action' in p) return { kind: 'resolver', p };
  const src = lc(e?.source);
  if (src === 'portal') return { kind: 'report', p };
  if (src === 'monitor') return { kind: 'alert', p };
  if (src === 'mail') return { kind: 'caller', p };
  if (src === 'workspace') return { kind: 'resolver', p };
  return { kind: 'other', p };
}
function prepEvents(events, now) {
  return (Array.isArray(events) ? events : []).map((e, i) => ({ e, i, id: e?.id ?? null, t: toMin(e?.at) ?? now, biz: bizOf(e) }))
    .sort((a, b) => a.t - b.t || a.i - b.i);
}
// fields of a printable report, as a fallback for missing payload fields
function docFields(env, eventId) {
  if (!eventId) return {};
  const txt = env.F.get(`docs/${eventId}.txt`);
  if (typeof txt !== 'string') return {};
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z][A-Za-z ]{0,30}?)\s*[:=]\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase().replace(/\s+/g, '');
    out[k] = m[2];
  }
  return {
    reportId: out.reportid ?? out.report ?? out.id, callerId: out.callerid ?? out.caller ?? out.user,
    ci: out.ci ?? out.configurationitem ?? out.system, category: out.category, urgency: out.urgency, summary: out.summary,
  };
}

// ---------------------------------------------------------------- host reads (defensive)

function rowsFrom(r) {
  if (Array.isArray(r)) return r.filter(isObj);
  if (isObj(r)) for (const k of ['rows', 'items', 'records', 'data', 'result']) if (Array.isArray(r[k])) return r[k].filter(isObj);
  return [];
}
function query(ctx, table, where) {
  try {
    if (typeof ctx?.query !== 'function') return [];
    const r = ctx.query(table, { where, limit: 1000 });
    if (r && typeof r.then === 'function') return [];
    return rowsFrom(r);
  } catch { return []; }
}
function instancesFor(ctx, subject, self) {
  try {
    if (typeof ctx?.instances !== 'function') return [];
    const r = ctx.instances({ subject });
    if (r && typeof r.then === 'function') return [];
    const arr = Array.isArray(r) ? r : rowsFrom(r);
    return arr.map((x) => (typeof x === 'string' ? { id: x, subject } : { id: x?.instance ?? x?.id, subject: x?.subject ?? subject }))
      .filter((x) => x.id && x.id !== self && (x.subject == null || normNum(x.subject) === normNum(subject)))
      .map((x) => x.id).sort();
  } catch { return []; }
}
function keyStatus(ctx, sys, key) {
  try {
    if (typeof ctx?.status !== 'function') return null;
    const r = ctx.status(sys, key);
    if (r && typeof r.then === 'function') return null;
    const v = typeof r === 'string' ? r : r?.status ?? r?.state;
    return typeof v === 'string' ? v.toLowerCase() : null;
  } catch { return null; }
}
function incRecord(ctx, num) {
  const rows = query(ctx, 'itsm.incidents', { number: num });
  return rows.find((r) => normNum(r.number) === num) ?? null;
}
// the open instance that runs incident `num`: by declared subject, else by the owner written on its assignment notice
function openInstanceFor(ctx, num, self) {
  const ids = instancesFor(ctx, num, self);
  if (ids.length) return ids[0];
  for (const r of query(ctx, 'notify.notifications', { about: num })) {
    const m = /^R\|([^|]+)\|([^|]+)\|([^|]+)\|/.exec(String(r.ref ?? ''));
    if (!m || normNum(m[3]) !== num || m[1] === self) continue;
    if (instancesFor(ctx, m[2], self).includes(m[1])) return m[1];
  }
  return null;
}

// ---------------------------------------------------------------- incidents from records (migration, adoption)

function harvest(root) {
  const out = { inc: [], sla: [], esc: [], note: [], msg: [] };
  const seen = new Set();
  const walk = (x, depth) => {
    if (depth > 6 || x == null || typeof x !== 'object' || seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) { for (const y of x) walk(y, depth + 1); return; }
    if (typeof x.type === 'string' && 'at' in x && isObj(x.payload)) { out.msg.push(x); return; }
    if (x.number != null && x.state != null && x.openedAt != null) out.inc.push(x);
    else if (x.definition != null && x.generation != null && x.stage != null) out.sla.push(x);
    else if (x.percent != null && (x.slaId != null || x.escalationId != null || x.sentAt != null)) out.esc.push(x);
    else if (x.template != null && 'about' in x) out.note.push(x);
    for (const v of Object.values(x)) if (v && typeof v === 'object') walk(v, depth + 1);
  };
  walk(root, 0);
  return out;
}
function compactSla(r, escs) {
  const id = r.slaId ?? `${r.number}/${r.definition}/${r.generation}`;
  const pcts = escs.filter((e) => (e.slaId != null ? String(e.slaId) === String(id)
    : normNum(e.number) === normNum(r.number) && eqv(e.definition, r.definition) && int(e.generation) === int(r.generation)))
    .map((e) => int(e.percent)).filter((x) => x != null);
  const pauses = (Array.isArray(r.pauses) ? r.pauses : []).map((p) => [toMin(p?.from), p?.to == null ? null : toMin(p.to)]).filter(([p]) => p != null);
  return {
    def: String(r.definition), gen: int(r.generation) ?? 1, stage: r.stage, startAt: toMin(r.startAt), sched: r.schedule ?? null,
    tz: r.timezone ?? null, pauses, breached: !!r.breached, breachAt: toMin(r.breachAt), endAt: toMin(r.endAt), esc: [...new Set(pcts)],
  };
}
function buildBase(env, num, recs, t0, inst) {
  const rec = recs.inc.find((r) => normNum(r.number) === num) ?? recs.inc[0];
  if (!rec) return null;
  const n = normNum(rec.number);
  const slas = recs.sla.filter((r) => normNum(r.number) === n).map((r) => compactSla(r, recs.esc))
    .sort((a, b) => (a.startAt ?? 0) - (b.startAt ?? 0) || a.gen - b.gen);
  const state = rec.state;
  const holdReason = state === 'onHold' ? rec.holdReason ?? null : null;
  let h = null;
  if (state === 'onHold') {
    for (const m of recs.msg) {
      const b = bizOf(m);
      if (b.kind !== 'resolver' || lc(b.p.action) !== 'hold' || normNum(b.p.number) !== n) continue;
      const t = toMin(m.at);
      if (t != null && t <= t0 && (h == null || t > h)) h = t;
    }
    if (h == null) for (const z of slas) for (const [p, q] of z.pauses) if (q == null && (h == null || p > h)) h = p;
    if (h == null) for (const x of recs.note) if (normNum(x.about) === n && x.template === 'awaiting-caller') { const t = toMin(x.sentAt); if (t != null && (h == null || t > h)) h = t; }
  }
  const ciRec = env.ci(rec.ci);
  const openedAt = toMin(rec.openedAt) ?? t0;
  let group0 = null;
  if (state === 'new') {
    const region = rec.source?.kind === 'alert' ? ciRec?.region : (env.user(rec.callerId)?.region ?? ciRec?.region);
    group0 = env.assignGroup(rec.category, region, ciRec, openedAt);
  }
  return {
    n, t0, own: inst, log: [], tasks: [], sigs: [],
    mb: {
      state, holdReason, priority: int(rec.priority), impact: int(rec.impact), urgency: int(rec.urgency),
      srcKind: rec.source?.kind ?? (rec.check != null ? 'alert' : 'report'), srcId: normId(rec.source?.id), service: rec.service,
      group: rec.assignmentGroup ?? null, assignee: rec.assignedTo ?? null, major: !!rec.major, callerId: rec.callerId ?? null,
      ci: rec.ci, check: rec.check ?? null, category: rec.category, openedAt, resolvedAt: toMin(rec.resolvedAt),
      alerts: (Array.isArray(rec.alerts) ? rec.alerts : []).map(normId), h, slas, group0,
    },
  };
}
function adoptFromRecords(ctx, env, num, now, inst) {
  const recs = { inc: [], sla: [], esc: [], note: [], msg: [] };
  recs.inc = query(ctx, 'itsm.incidents', { number: num });
  recs.sla = query(ctx, 'sla.slas', { number: num });
  recs.esc = query(ctx, 'sla.escalations', { number: num });
  recs.note = query(ctx, 'notify.notifications', { about: num });
  return buildBase(env, num, recs, now, inst);
}

// ---------------------------------------------------------------- new incidents (R1)

function newIncident(env, { num, kind, id, callerId, ciRec, ciRaw, check, category, urgency, t, summary, inst, primary }) {
  const ciId = ciRec?.id != null ? String(ciRec.id) : String(ciRaw ?? '').trim() || 'unknown';
  const svc = ciRec?.service ?? null;
  const svcRec = env.service(svc);
  const service = svcRec?.id ?? svc ?? 'unknown';
  const impact = lvl(svcRec?.impact) ?? 3;
  const urg = lvl(urgency) ?? 3;
  const priority = env.priority(service, impact, urg, t);
  const region = kind === 'alert' ? ciRec?.region : (env.user(callerId)?.region ?? ciRec?.region);
  const group = env.assignGroup(category, region, ciRec, t);
  return {
    n: num, own: inst, p: primary ?? num, log: [], tasks: [], sigs: [],
    cr: {
      t, source: { kind, id }, callerId: callerId ?? null, ci: ciId, check: kind === 'alert' ? (check ?? null) : null, service,
      category, impact, urgency: urg, priority, group, summary: String(summary ?? '').slice(0, 400),
    },
  };
}
function reportIncident(env, ev, inst) {
  const p = ev.biz.p;
  const doc = docFields(env, ev.id);
  const rid = normId(p.reportId ?? doc.reportId);
  if (!rid) return null;
  const callerRaw = p.callerId ?? doc.callerId;
  const callerId = callerRaw == null ? null : (env.user(callerRaw)?.id ?? String(callerRaw).trim());
  const ciRaw = p.ci ?? doc.ci;
  const ciRec = env.ci(ciRaw);
  const category = lc(p.category ?? doc.category) || 'software';
  return newIncident(env, {
    num: `INC-${rid}`, kind: 'report', id: rid, callerId, ciRec, ciRaw, check: null, category,
    urgency: p.urgency ?? doc.urgency, t: ev.t, summary: p.summary ?? doc.summary ?? `report ${rid}`, inst,
  });
}
function alertOf(env, p) {
  const ciRec = env.ci(p.ci);
  return { id: normId(p.alertId), ciRec, ci: ciRec?.id != null ? String(ciRec.id) : String(p.ci ?? '').trim(), check: p.check == null ? null : String(p.check), sev: p.severity };
}
function alertIncident(env, a, urg, t, inst, primary) {
  return newIncident(env, {
    num: `INC-${a.id}`, kind: 'alert', id: a.id, callerId: null, ciRec: a.ciRec, ciRaw: a.ci, check: a.check,
    category: 'monitoring', urgency: urg, t, summary: `${a.check ?? 'check'} on ${a.ci} (${a.sev ?? ''})`, inst, primary,
  });
}

// ---------------------------------------------------------------- the tick

const emptyOut = (subject, priority, carry, extra) => ({
  decisions: { subject: subject ?? null, priority: priority ?? null },
  effects: [], obligations: { upsert: [], cancel: [] }, humanTasks: [], ...extra, carry,
});

function routeFirst(ev, ctx, env, now, inst, C) {
  const b = ev.biz;
  const t = ev.t;
  const merged = (into, num, pri) => emptyOut(num, pri, { v: CARRY_V, merged: into }, { merge: { into } });
  const dropped = (num, pri) => emptyOut(num, pri, { v: CARRY_V, done: true }, { close: true });
  if (b.kind === 'report') {
    const ic = reportIncident(env, ev, inst);
    if (!ic) return dropped(null, null);
    const num = ic.n;
    const oi = openInstanceFor(ctx, num, inst);
    const rec = incRecord(ctx, num);
    if (oi) return merged(oi, num, int(rec?.priority) ?? ic.cr.priority);
    if (rec) return dropped(num, int(rec.priority)); // R1.4: a report delivered again changes nothing
    C.incs.push(ic);
    C.subj = num;
    return null;
  }
  if (b.kind === 'alert') {
    const a = alertOf(env, b.p);
    if (!a.id) return dropped(null, null);
    const urg = env.alertUrg(a.sev, t);
    if (urg == null) return dropped(null, null); // R1.2 warning: belongs to no incident
    const num = `INC-${a.id}`;
    let oi = openInstanceFor(ctx, num, inst);
    const rec = incRecord(ctx, num);
    if (oi) return merged(oi, num, int(rec?.priority));
    if (rec) return dropped(num, int(rec.priority));
    const sameCi = query(ctx, 'itsm.incidents', { ci: a.ci });
    const linked = sameCi.find((r) => (Array.isArray(r.alerts) ? r.alerts : []).some((x) => normId(x) === a.id));
    if (linked) {
      const ln = normNum(linked.number);
      oi = openInstanceFor(ctx, ln, inst);
      return oi ? merged(oi, ln, int(linked.priority)) : dropped(ln, int(linked.priority));
    }
    const cands = sameCi.filter((r) => (r.source?.kind ?? 'alert') === 'alert' && r.check != null && eqv(r.check, a.check) && !FINAL.has(r.state))
      .sort((x, y) => (toMin(y.openedAt) ?? 0) - (toMin(x.openedAt) ?? 0));
    for (const r of cands) {
      const cn = normNum(r.number);
      oi = openInstanceFor(ctx, cn, inst);
      if (oi) return merged(oi, cn, int(r.priority)); // the incident's own instance judges S8 with its full log
    }
    if (cands.length) {
      const ic = adoptFromRecords(ctx, env, normNum(cands[0].number), now, inst);
      if (ic) { C.incs.push(ic); C.subj = ic.n; return null; }
    }
    C.incs.push(alertIncident(env, a, urg, t, inst));
    C.subj = num;
    return null;
  }
  if (b.kind === 'caller' || b.kind === 'resolver') {
    const num = normNum(b.kind === 'caller' ? b.p.incidentRef : b.p.number);
    if (!num) return dropped(null, null);
    const oi = openInstanceFor(ctx, num, inst);
    const rec = incRecord(ctx, num);
    if (oi) return merged(oi, num, int(rec?.priority));
    if (!rec) return dropped(null, null); // §3.3: names no incident; the optional notice is not sent
    if (ENDED.has(rec.state) || (rec.state === 'resolved' && b.kind === 'resolver')) return dropped(num, int(rec.priority));
    const ic = adoptFromRecords(ctx, env, num, now, inst);
    if (!ic) return dropped(num, int(rec.priority));
    C.incs.push(ic);
    C.subj = num;
    return null;
  }
  return null;
}

function onMigration(C, ev, ctx, env, now, inst) {
  const recs = harvest(ev.biz.p);
  const sor = env.F.get(`sor/${inst}.json`);
  if (sor) {
    const more = harvest(sor);
    for (const k of Object.keys(recs)) recs[k].push(...more[k]);
  }
  let nums = [...new Set(recs.inc.map((r) => normNum(r.number)).filter(Boolean))];
  if (!nums.length) {
    const guess = normNum(ev.biz.p.number ?? ev.biz.p.subject ?? ev.biz.p.incident);
    if (guess) {
      for (const [k, tb, f] of [['inc', 'itsm.incidents', 'number'], ['sla', 'sla.slas', 'number'], ['esc', 'sla.escalations', 'number'], ['note', 'notify.notifications', 'about']]) {
        recs[k].push(...query(ctx, tb, { [f]: guess }));
      }
      nums = [guess];
    }
  }
  for (const num of nums) {
    if (C.incs.some((i) => i.n === num)) continue;
    const ic = buildBase(env, num, recs, ev.t, inst);
    if (ic) { C.incs.push(ic); if (!C.subj) C.subj = ic.n; }
  }
}

function sigOf(kind, p, t) {
  const keys = Object.keys(p).sort();
  return fnv(`${kind}|${t}|${JSON.stringify(keys.map((k) => [k, p[k]]))}`);
}
function onMessage(C, ev, env) {
  const p = ev.biz.p;
  let ic = null;
  if (ev.biz.kind === 'resolver' && p.ref) {
    const m = /^R\|[^|]+\|[^|]+\|([^|]+)\|/.exec(String(p.ref));
    if (m) ic = C.incs.find((i) => i.n === normNum(m[1])) ?? null;
  }
  if (!ic) {
    const num = normNum(ev.biz.kind === 'resolver' ? p.number : p.incidentRef);
    ic = C.incs.find((i) => i.n === num) ?? null;
  }
  if (!ic) return;
  const sg = sigOf(ev.biz.kind, p, ev.t);
  ic.sigs = ic.sigs ?? [];
  if (ic.sigs.includes(sg)) return; // the same message delivered again (W1)
  ic.sigs.push(sg);
  if (ev.biz.kind === 'resolver') {
    ic.log.push({
      t: ev.t, q: C.q++, k: 'upd', a: lc(p.action), u: p.user == null ? null : String(p.user).trim(),
      hr: p.holdReason == null ? null : String(p.holdReason).trim(), tg: p.toGroup == null ? null : env.groupId(String(p.toGroup).trim()),
      im: lvl(p.impact), ur: lvl(p.urgency), cc: p.closeCode == null ? null : String(p.closeCode).trim(),
    });
  } else {
    ic.log.push({ t: ev.t, q: C.q++, k: 'msg', i: lc(p.intent) });
  }
}
function onTask(C, ev) {
  const p = ev.biz.p;
  const cands = [p.taskId, p.humanTaskId, p.task?.id, p.id, p.task].filter((x) => typeof x === 'string');
  let ic = null, tid = null;
  for (const c of cands) {
    ic = C.incs.find((i) => (i.tasks ?? []).some((tk) => tk.id === c));
    if (ic) { tid = c; break; }
  }
  if (!ic) return;
  const sub = ev.biz.sub;
  const k = sub === 'answered' ? 'ans' : sub === 'answerRejected' ? 'rej' : sub === 'withdrawn' ? 'wd' : sub === 'timeout' ? 'to' : 'dlg';
  const ans = p.answer ?? p.value ?? p.response ?? p.result ?? p.data;
  let dec = isObj(ans) ? ans.decision : (p.decision ?? null);
  dec = typeof dec === 'string' ? dec.trim().toLowerCase() : null;
  const sg = `${k}|${tid}|${ev.t}`;
  ic.sigs = ic.sigs ?? [];
  if (ic.sigs.includes(sg)) return;
  ic.sigs.push(sg);
  ic.log.push({ t: ev.t, q: C.q++, k, task: tid, dec });
}
function onAlert(C, ev, env, now, inst) {
  const a = alertOf(env, ev.biz.p);
  if (!a.id) return;
  const known = C.incs.some((i) => (i.cr?.source?.kind === 'alert' && i.cr.source.id === a.id) || (i.mb?.srcKind === 'alert' && i.mb.srcId === a.id)
    || (i.mb?.alerts ?? []).includes(a.id) || (i.log ?? []).some((x) => x.k === 'join' && x.al === a.id));
  if (known) return; // R1.4
  const urg = env.alertUrg(a.sev, ev.t);
  if (urg == null) return;
  const cands = C.incs.filter((i) => {
    const src = i.cr?.source?.kind ?? i.mb?.srcKind;
    const ci = i.cr?.ci ?? i.mb?.ci;
    const ck = i.cr ? i.cr.check : i.mb?.check;
    return src === 'alert' && eqv(ci, a.ci) && ck != null && eqv(ck, a.check);
  });
  for (const ic of cands.reverse()) {
    const R = replay(ic, env, now);
    if (!R) continue;
    let st = null;
    for (const sn of R.snaps) if (sn.t <= ev.t) st = sn.s;
    if (st && !FINAL.has(st.state)) { ic.log.push({ t: ev.t, q: C.q++, k: 'join', al: a.id, ur: urg }); return; }
  }
  // no open incident of this CI and check at the alert's time: the alert opens one (R1.2)
  if (C.incs.some((i) => i.n === `INC-${a.id}`)) return;
  C.incs.push(alertIncident(env, a, urg, ev.t, inst, C.subj));
  if (!C.subj) C.subj = `INC-${a.id}`;
}

function retryAfterMin(p) {
  const v = Number(p?.retryAfter);
  return Number.isFinite(v) && v > 0 ? Math.ceil(v / 60) : 0;
}
function classifyErr(p) {
  const s = `${JSON.stringify(p?.error ?? '')} ${JSON.stringify(p?.code ?? '')} ${JSON.stringify(p?.httpStatus ?? p?.statusCode ?? '')}`.toLowerCase();
  if (s.includes('predecessor')) return 'retry';
  if (s.includes('key-conflict') || s.includes('key conflict')) return 'dead';
  if (/\b409\b/.test(s) || s.includes('conflict') || s.includes('stage')) return 'dead';
  if (/\b5\d\d\b/.test(s) || s.includes('unavailable') || s.includes('internal') || s.includes('timeout') || s.includes('retry')) return 'retry';
  if (/\b400\b/.test(s) || s.includes('invalid') || s.includes('renamed') || s.includes('bad request')) return 'retry';
  if (/\b4\d\d\b/.test(s) || s.includes('not-found') || s.includes('forbidden')) return 'dead';
  return 'retry';
}
function onResult(C, ev) {
  const p = ev.biz.p;
  const key = p.key;
  if (typeof key !== 'string') return;
  const f = C.fx[key] ?? (C.fx[key] = { s: 's', a: ev.t - 1, n: 1, y: p.system ?? null });
  if (f.s === 'k') return;
  const st = lc(p.status);
  const ra = retryAfterMin(p);
  if (st === 'ok') { f.s = 'k'; return; }
  if (st === 'unknown' || st === 'partial') { f.s = 'u'; return; }
  if (st === 'rate-limited') { f.s = 'r'; f.nb = ev.t + ra; f.nb1 = f.a + ra; }
  else if (st === 'error') {
    if (classifyErr(p) === 'dead') { f.s = 'd'; return; }
    f.s = 'r'; f.nb = ev.t + ra; f.nb1 = f.a + ra;
  } else { f.s = 'u'; return; }
  if ((f.n ?? 0) >= 8) f.s = 'd';
}

function newCarry(inst, now) {
  return { v: CARRY_V, inst, t0: now, subj: null, incs: [], fx: {}, seen: [], q: 0, wake: null };
}

function tickImpl(input, ctx) {
  const now = toMin(input?.now) ?? 0;
  const inst = String(input?.instance ?? 'i');
  const env = loadEnv(ctx);
  const prior = isObj(input?.carry) && input.carry.v === CARRY_V && Array.isArray(input.carry.incs) ? clone(input.carry) : null;
  const first = !prior;
  const C = prior ?? newCarry(inst, now);
  if (C.wake != null && C.wake <= now) C.wake = null;
  const evs = prepEvents(input?.events, now);

  if (first && !evs.some((e) => e.biz.kind === 'migration')) {
    const ib = evs.find((e) => ['report', 'alert', 'caller', 'resolver'].includes(e.biz.kind));
    if (ib) {
      const out = routeFirst(ib, ctx, env, now, inst, C);
      if (out) return out;
    }
  }
  const alerts = [];
  for (const e of evs) {
    if (e.id != null) {
      if (C.seen.includes(e.id)) continue;
      C.seen.push(e.id);
    }
    switch (e.biz.kind) {
      case 'result': onResult(C, e); break;
      case 'migration': onMigration(C, e, ctx, env, now, inst); break;
      case 'alert': alerts.push(e); break;
      case 'caller': case 'resolver': onMessage(C, e, env); break;
      case 'task': onTask(C, e); break;
      default: break;
    }
  }
  for (const e of alerts) onAlert(C, e, env, now, inst);
  if (C.seen.length > 120) C.seen = C.seen.slice(-80);
  return schedule(C, env, ctx, now, inst);
}

function schedule(C, env, ctx, now, inst) {
  // 1. settle in-flight effects whose result is overdue or unknown, from the system's own status
  for (const [key, f] of Object.entries(C.fx)) {
    if (f.s !== 's' && f.s !== 'u') continue;
    const st = keyStatus(ctx, f.y, key);
    if (st === 'committed') f.s = 'k';
    else if (st === 'not-found' && (f.s === 'u' || now > f.a + 1)) { f.s = 'r'; f.nb = now; }
    // (a same-instant not-found means it was refused: its result, due a minute later, says when to retry)
  }
  // 2. replay every incident into the obligations table; create human tasks it asks for
  const humanTasks = [];
  const results = [];
  for (const ic of C.incs) {
    let R = replay(ic, env, now);
    if (!R) continue;
    if (R.wantTasks > 0) {
      ic.tasks = ic.tasks ?? [];
      for (let k = 0; k < R.wantTasks; k++) {
        const id = `${ic.n}|major|${ic.tasks.length + 1}`;
        ic.tasks.push({ id, t: now });
      }
      R = replay(ic, env, now);
      const dl = R.appr.dl ?? now + 30;
      for (const tk of ic.tasks.filter((x) => x.t === now)) {
        const ht = {
          id: tk.id, kind: 'majorIncidentApproval', role: 'incidentManager', subject: ic.n,
          question: `Approve declaring ${ic.n} a major incident? Answer with decision approve or reject.`,
          answerSchema: { type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['approve', 'reject'] } } },
          dueAt: iso(dl), onTimeout: 'timeout',
        };
        if (R.model.callerId) ht.excludeUsers = [R.model.callerId];
        humanTasks.push(ht);
      }
    }
    results.push({ ic, R });
  }
  // 3. scheduler: emit what is due, in dependency order, each key once until it fails
  const desired = new Map();
  for (const { R } of results) for (const d of R.duties) if (!desired.has(d.key)) desired.set(d.key, d);
  const order = [...desired.values()];
  const wakes = [];
  for (const { R } of results) wakes.push(...R.wakes);
  const effects = [];
  const now_ = new Set();
  for (const d of order) {
    const f = C.fx[d.key];
    if (f && (f.s === 'k' || f.s === 'd' || f.s === 's' || f.s === 'u')) {
      if (f.s === 'u') wakes.push(now + 1);
      continue;
    }
    if (d.from > now) { wakes.push(d.from); continue; }
    if (f && f.s === 'r') {
      let nb = f.nb ?? now;
      if (nb > d.to && f.nb1 != null && f.nb1 <= d.to) nb = Math.max(f.nb1, now);
      if (nb > now) { wakes.push(nb); continue; }
    }
    if (d.dep && desired.has(d.dep)) {
      const df = C.fx[d.dep];
      const ok = (df && (df.s === 'k' || df.s === 'd')) || now_.has(d.dep);
      if (!ok) continue; // waits for its predecessor; that one's result or wake-up brings us back
    }
    const eff = { key: d.key, system: d.sys, op: d.op, args: nameArgs(env, d.sys, d.op, d.args) };
    if (d.dep && now_.has(d.dep)) eff.after = d.dep;
    effects.push(eff);
    now_.add(d.key);
    C.fx[d.key] = { s: 's', a: now, n: (f?.n ?? 0) + 1, y: d.sys };
  }
  // 4. one wake-up at the earliest future instant anything becomes due
  for (const f of Object.values(C.fx)) if (f.s === 's' && now >= f.a + 1) wakes.push(now + 1); // a result that never came
  const next = wakes.filter((w) => Number.isFinite(w) && w > now).reduce((a, b) => Math.min(a, b), INF);
  const obligations = { upsert: [], cancel: [] };
  const oid = `${inst}:wake`;
  const allEnded = results.length > 0 && results.every(({ R }) => ENDED.has(R.model.state));
  const inFlight = Object.values(C.fx).some((f) => f.s === 's' || f.s === 'u' || f.s === 'r');
  const pending = order.some((d) => { const f = C.fx[d.key]; return !f || (f.s !== 'k' && f.s !== 'd'); });
  const close = (allEnded && !inFlight && !pending && humanTasks.length === 0 && !Number.isFinite(next)) || C.incs.length === 0;
  if (Number.isFinite(next) && !close) {
    if (C.wake !== next) { obligations.upsert.push({ id: oid, kind: 'wake', anchor: iso(now), dueAt: iso(next), onDue: 'wake' }); C.wake = next; }
  } else if (C.wake != null) { obligations.cancel.push(oid); C.wake = null; }
  // keep the carry small: committed keys of finished incidents are no longer needed once everything settled
  if (JSON.stringify(C).length > 56000) {
    for (const [k, f] of Object.entries(C.fx)) if ((f.s === 'k' || f.s === 'd') && !desired.has(k)) delete C.fx[k];
    for (const ic of C.incs) if (ic.sigs?.length > 40) ic.sigs = ic.sigs.slice(-40);
  }
  const primary = results.find(({ ic }) => ic.n === C.subj)?.R ?? results[0]?.R ?? null;
  const out = {
    decisions: { subject: C.subj ?? null, priority: primary ? (primary.model.priority ?? null) : null },
    effects, obligations, humanTasks, carry: C,
  };
  if (close) out.close = true;
  return out;
}

function tick(input, ctx) {
  try {
    return tickImpl(input, ctx);
  } catch (err) {
    // never crash: keep the previous carry and look again in a minute
    const now = toMin(input?.now) ?? 0;
    const carry = isObj(input?.carry) ? input.carry : newCarry(String(input?.instance ?? 'i'), now);
    const subj = carry.subj ?? null;
    return {
      decisions: { subject: subj, priority: null },
      effects: [],
      obligations: { upsert: [{ id: `${input?.instance ?? 'i'}:wake`, kind: 'wake', anchor: iso(now), dueAt: iso(now + 1), onDue: 'wake' }], cancel: [] },
      humanTasks: [],
      carry: { ...carry, wake: now + 1, lastError: String(err?.message ?? err).slice(0, 200) },
    };
  }
}

export function createSolver() {
  return { id: 's3', tick };
}
// internals for the author's own spec-derived unit tests (not part of the arm interface)
export const __test = { reachOn, bizBetween, runningSegs, normCalendar, zonedToMin, offsetAt, argNames, holds, iso, toMin, normNum };
export default createSolver;
