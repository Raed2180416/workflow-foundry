// s2: blind specificity solver #2 for E-bed item E7 slice 1 (ITSM incidents + SLA engine).
// Written from SPEC-E.md, CONTRACT.md, TASK.md and api/*.schema.json alone (see s2.NOTES.md).
// Design: event-sourced. Each instance keeps the raw facts it has received (reports, alerts, resolver updates,
// caller messages, human-task events) in its carry, and on every tick replays the incident's history from those
// facts, deriving every business record the rules require (with its window). Effects are the derived records that are
// due and not yet committed. Business time comes from the calendar module below (time zones, DST, holidays).
// Deterministic: no Date.now, no Math.random; time is input.now. No dependencies beyond node built-ins.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------------------------------------------
// Part A: small utilities (instants, normalisation, lists)
// ---------------------------------------------------------------------------------------------------------------

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const SYSTEM_TZ_DEFAULT = 'Europe/Amsterdam';

function parseInstant(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(s);
  if (m) {
    const [, y, mo, d, h, mi, se, frac, z] = m;
    let ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, se ? +se : 0, frac ? Math.round(+('0.' + frac) * 1000) : 0);
    if (z && z.toUpperCase() !== 'Z') {
      const sign = z[0] === '-' ? -1 : 1;
      const digits = z.slice(1).replace(':', '');
      ms -= sign * (+digits.slice(0, 2) * 60 + +digits.slice(2, 4)) * MIN;
    } else if (!z) {
      // No offset: the platform writes +01:00 everywhere (SPEC-E §1 Time); read it that way.
      ms -= HOUR;
    }
    return ms;
  }
  const p = Date.parse(s);
  return Number.isFinite(p) ? p : NaN;
}

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

// Instants are written like the platform writes them: offset +01:00, minute precision (seconds only if non-zero).
function fmt(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  const d = new Date(ms + HOUR);
  let s = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const sec = d.getUTCSeconds(), msec = d.getUTCMilliseconds();
  if (sec || msec) s += ':' + pad(sec) + (msec ? '.' + pad(msec, 3) : '');
  return s + '+01:00';
}

function normId(v) {
  if (v == null) return null;
  return String(v).trim().replace(/^#+/, '').trim().toUpperCase();
}

// SPEC-E §3: trim spaces, remove a leading '#', upper-case.
function normIncident(v) {
  const s = normId(v);
  return s ? s.replace(/\s+/g, '') : null;
}

function lc(v) { return v == null ? '' : String(v).trim().toLowerCase(); }

function asList(v, keys = []) {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'object') {
    for (const k of keys) if (Array.isArray(v[k])) return v[k];
    for (const k of ['rows', 'items', 'records', 'list', 'data', 'entries', 'values']) if (Array.isArray(v[k])) return v[k];
    const vals = Object.entries(v);
    if (vals.length && vals.every(([, x]) => x && typeof x === 'object' && !Array.isArray(x))) {
      return vals.map(([k, x]) => (x.id == null ? { id: k, ...x } : x));
    }
  }
  return [];
}

function toInt(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function sameValue(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function stableStr(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStr).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStr(v[k])).join(',') + '}';
}

function ceilMinute(ms) { return Math.ceil(ms / MIN) * MIN; }
function afterInstant(ms) { return Math.floor(ms / MIN) * MIN + MIN; } // first whole minute strictly after ms

// ---------------------------------------------------------------------------------------------------------------
// Part B: business-calendar module (SPEC-E R4.4, R6). Written from the spec: a calendar is
// { id, tz, businessHours: "24x7" | { days: [ISO weekday], hours: [["HH:MM","HH:MM"], ...] }, holidays: [{ date, from?, to? }] }.
// Intervals are local wall-clock times in the schedule's zone, start included, end excluded. On a clock-change day an
// interval runs from the instant the local clock FIRST reads its start to the instant it FIRST reads its end; a skipped
// hour is not business time, a repeated hour counts for the real time it lasts.
// ---------------------------------------------------------------------------------------------------------------

const tzFormatters = new Map();
const tzOffsetCache = new Map();
const QUARTER = 15 * MIN;

function validTz(tz) {
  if (!tz || typeof tz !== 'string') return null;
  if (tzFormatters.has(tz)) return tzFormatters.get(tz) ? tz : null;
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    tzFormatters.set(tz, f);
    return tz;
  } catch {
    tzFormatters.set(tz, null);
    return null;
  }
}

// Offset (local minus UTC, ms) of zone tz at instant ms. Zone transitions fall on quarter hours, so the offset is
// constant inside each 15-minute bucket and is cached per bucket.
function tzOffset(tz, ms) {
  if (!validTz(tz)) return 0;
  let cache = tzOffsetCache.get(tz);
  if (!cache) { cache = new Map(); tzOffsetCache.set(tz, cache); }
  const bucket = Math.floor(ms / QUARTER);
  const hit = cache.get(bucket);
  if (hit !== undefined) return hit;
  const at = bucket * QUARTER;
  const parts = tzFormatters.get(tz).formatToParts(new Date(at));
  const get = (t) => +parts.find((p) => p.type === t).value;
  let h = get('hour');
  if (h === 24) h = 0;
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), h, get('minute'), get('second'));
  const off = Math.round((local - at) / MIN) * MIN;
  if (cache.size > 200000) cache.clear();
  cache.set(bucket, off);
  return off;
}

function localDayIndex(ms, tz) { return Math.floor((ms + tzOffset(tz, ms)) / DAY); }
function isoWeekday(dayIndex) { return (((dayIndex + 3) % 7) + 7) % 7 + 1; } // 1970-01-01 was a Thursday (4)
function dayIndexOfDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY) : null;
}
function dateOfDayIndex(di) {
  const d = new Date(di * DAY);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function localDateStr(ms, tz) { return dateOfDayIndex(localDayIndex(ms, tz)); }

// The first real instant at which the local clock of tz reads `minutes` after midnight of local day dayIndex.
function localToInstant(dayIndex, minutes, tz) {
  const localMs = dayIndex * DAY + minutes * MIN;
  if (!validTz(tz)) return localMs;
  const before = tzOffset(tz, localMs - 15 * HOUR);
  const after = tzOffset(tz, localMs + 15 * HOUR);
  const mid = tzOffset(tz, localMs);
  let best = null;
  for (const o of new Set([before, mid, after])) {
    const inst = localMs - o;
    if (tzOffset(tz, inst) === o && (best === null || inst < best)) best = inst;
  }
  if (best !== null) return best;
  // The local time does not exist (skipped by a forward change): the clock first reads it (or later) at the change.
  let lo = localMs - Math.max(before, after) - HOUR;
  let hi = localMs - Math.min(before, after) + HOUR;
  lo = Math.floor(lo / MIN); hi = Math.ceil(hi / MIN);
  const target = after;
  while (lo < hi) {
    const m = Math.floor((lo + hi) / 2);
    if (tzOffset(tz, m * MIN) === target) hi = m; else lo = m + 1;
  }
  return lo * MIN;
}

function hhmm(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v).trim());
  return m ? +m[1] * 60 + +m[2] : null;
}

const WEEKDAY_NAMES = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
function weekdayNum(d) {
  if (typeof d === 'number') return d === 0 ? 7 : d;
  const s = lc(d);
  if (/^\d+$/.test(s)) return +s === 0 ? 7 : +s;
  return WEEKDAY_NAMES[s.slice(0, 3)] || null;
}

function is24x7(bh) {
  if (bh == null) return true;
  if (typeof bh === 'string') return /24\s*x\s*7|24\/7/i.test(bh);
  if (typeof bh === 'object' && (bh.type === '24x7' || bh.kind === '24x7' || bh['24x7'] === true)) return true;
  return false;
}

function hoursList(bh) {
  const raw = bh.hours ?? bh.intervals ?? bh.ranges ?? [];
  const out = [];
  for (const h of asList(raw)) {
    let s, e;
    if (Array.isArray(h)) [s, e] = h;
    else if (h && typeof h === 'object') { s = h.from ?? h.start ?? h.open; e = h.to ?? h.end ?? h.close; }
    const a = hhmm(s), b = hhmm(e);
    if (a != null && b != null) out.push([a, b]);
  }
  return out;
}

// A schedule: { id, tz, cal } with cal null for 24x7 with no holidays (schedule `none`).
class Schedule {
  constructor(id, cal, tz) {
    this.id = id ?? null;
    this.cal = cal || null;
    this.tz = validTz(tz) || null;
    this.pure = !this.cal || (is24x7(this.cal.businessHours) && asList(this.cal.holidays).length === 0);
    this.dayCache = new Map();
    if (this.cal) {
      const bh = this.cal.businessHours;
      this.all = is24x7(bh);
      this.days = this.all ? null : new Set(asList(bh?.days).map(weekdayNum).filter(Boolean));
      this.hours = this.all ? null : hoursList(bh);
      this.holidays = new Map();
      for (const h of asList(this.cal.holidays)) {
        const date = typeof h === 'string' ? h : (h?.date ?? h?.day);
        const di = dayIndexOfDate(date);
        if (di == null) continue;
        const from = typeof h === 'object' ? hhmm(h.from ?? h.start) : null;
        const to = typeof h === 'object' ? hhmm(h.to ?? h.end) : null;
        if (!this.holidays.has(di)) this.holidays.set(di, []);
        this.holidays.get(di).push(from == null && to == null ? null : [from ?? 0, to ?? 1440]);
      }
    }
  }

  // Open intervals [a, b) (instants) of local day di, holidays removed.
  day(di) {
    if (this.dayCache.has(di)) return this.dayCache.get(di);
    const tz = this.tz || 'UTC';
    let iv = [];
    if (this.all) iv.push([localToInstant(di, 0, tz), localToInstant(di + 1, 0, tz)]);
    else if (this.days.has(isoWeekday(di))) {
      for (const [s, e] of this.hours) {
        const a = localToInstant(di, s, tz);
        const b = e > s ? localToInstant(di, e, tz) : localToInstant(di + 1, e, tz);
        if (b > a) iv.push([a, b]);
      }
    }
    const hol = this.holidays.get(di);
    if (hol && iv.length) {
      if (hol.some((x) => x === null)) iv = [];
      else {
        for (const [f, t] of hol) {
          const ha = localToInstant(di, f, tz), hb = localToInstant(di, t, tz);
          const next = [];
          for (const [a, b] of iv) {
            if (hb <= a || ha >= b) { next.push([a, b]); continue; }
            if (a < ha) next.push([a, ha]);
            if (hb < b) next.push([hb, b]);
          }
          iv = next;
        }
      }
    }
    iv.sort((x, y) => x[0] - y[0]);
    this.dayCache.set(di, iv);
    return iv;
  }

  // Business milliseconds inside [a, b).
  between(a, b) {
    if (!(b > a)) return 0;
    if (this.pure) return b - a;
    const tz = this.tz || 'UTC';
    let sum = 0;
    const d0 = localDayIndex(a, tz) - 1, d1 = localDayIndex(b, tz) + 1;
    let last = -Infinity; // guard against overlap between overnight intervals of adjacent days
    for (let di = d0; di <= d1; di++) {
      for (const [s, e] of this.day(di)) {
        const lo = Math.max(s, a, last), hi = Math.min(e, b);
        if (hi > lo) { sum += hi - lo; last = hi; }
      }
    }
    return sum;
  }

  // The first instant at or after a at which the business time counted from a reaches ms (S4: a target reached at
  // a closing time is reached at that closing time). bound: stop searching at this instant (returns null).
  reach(a, ms, bound = Infinity) {
    if (ms <= 0) return a;
    if (this.pure) { const t = a + ms; return t <= bound ? t : null; }
    const tz = this.tz || 'UTC';
    let left = ms;
    let last = -Infinity;
    const start = localDayIndex(a, tz) - 1;
    for (let di = start; di < start + 8000; di++) {
      for (const [s, e] of this.day(di)) {
        const lo = Math.max(s, a, last);
        if (lo >= bound) return null;
        if (e <= lo) continue;
        const hi = Math.min(e, bound);
        if (hi - lo >= left) return lo + left;
        if (hi > lo) { left -= hi - lo; last = hi; }
        if (hi >= bound) return null;
      }
    }
    return null;
  }
}

// Business time over running intervals [[a, b], ...] (b may be Infinity) of an SLA, up to instant `upTo`.
function runningBusiness(sched, running, upTo) {
  let sum = 0;
  for (const [a, b] of running) {
    const hi = Math.min(b, upTo);
    if (hi > a) sum += sched.between(a, hi);
  }
  return sum;
}
function runningWall(running, upTo) {
  let sum = 0;
  for (const [a, b] of running) { const hi = Math.min(b, upTo); if (hi > a) sum += hi - a; }
  return sum;
}
// First instant at which the business time over the running intervals reaches ms, or null.
function runningReach(sched, running, ms) {
  let left = ms;
  for (const [a, b] of running) {
    if (left <= 0) return a;
    const t = sched.reach(a, left, b);
    if (t != null) return t;
    left -= sched.between(a, b);
  }
  return left <= 0 && running.length ? running[running.length - 1][1] : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Part C: the call's files (rulebook editions, master data, calendars, API schemas) and API renames
// ---------------------------------------------------------------------------------------------------------------

function textOf(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (v instanceof Uint8Array) return Buffer.from(v).toString('utf8');
  if (typeof v === 'object' && typeof v.content === 'string') return v.content;
  if (typeof v === 'object' && typeof v.text === 'string') return v.text;
  return null;
}

class Files {
  constructor(src) { this.src = src; this.memo = new Map(); this.listing = null; }

  raw(path) {
    const s = this.src;
    if (s == null) return null;
    try {
      if (typeof s === 'string') {
        try { return readFileSync(join(s, path), 'utf8'); } catch { return null; }
      }
      if (typeof s === 'function') return s(path);
      if (s instanceof Map) return s.get(path) ?? null;
      if (typeof s === 'object') {
        if (Object.prototype.hasOwnProperty.call(s, path)) return s[path];
        for (const m of ['read', 'get', 'readFile']) {
          if (typeof s[m] === 'function') { try { const r = s[m](path); if (r != null) return r; } catch { /* next */ } }
        }
        // nested object form: { rulebook: { ed: { 'policy.json': ... } } }
        let cur = s;
        for (const seg of path.split('/')) {
          if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, seg)) cur = cur[seg];
          else { cur = undefined; break; }
        }
        if (cur !== undefined) return cur;
      }
    } catch { /* unreadable */ }
    return null;
  }

  json(path) {
    if (this.memo.has(path)) return this.memo.get(path);
    const r = this.raw(path);
    let out = null;
    if (r != null) {
      const t = textOf(r);
      if (t != null) { try { out = JSON.parse(t); } catch { out = null; } }
      else if (typeof r === 'object') out = r;
    }
    this.memo.set(path, out);
    return out;
  }

  list() {
    if (this.listing) return this.listing;
    const s = this.src;
    let keys = [];
    try {
      if (typeof s === 'string') {
        const walk = (dir, pre) => {
          for (const n of readdirSync(join(s, dir))) {
            const rel = pre ? pre + '/' + n : n;
            if (statSync(join(s, dir, n)).isDirectory()) walk(join(dir, n), rel); else keys.push(rel);
          }
        };
        walk('.', '');
      } else if (s instanceof Map) keys = [...s.keys()];
      else if (s && typeof s === 'object') {
        if (typeof s.list === 'function') { try { keys = [...(s.list() || [])]; } catch { keys = []; } }
        if (!keys.length && typeof s.keys === 'function') { try { keys = [...s.keys()]; } catch { keys = []; } }
        if (!keys.length) {
          const walk = (o, pre) => {
            for (const [k, v] of Object.entries(o)) {
              const rel = pre ? pre + '/' + k : k;
              if (v && typeof v === 'object' && !Array.isArray(v) && !/\.(json|csv|txt|md)$/i.test(k)) walk(v, rel);
              else keys.push(rel);
            }
          };
          walk(s, '');
        }
      } else if (typeof s === 'function' && typeof s.list === 'function') keys = [...(s.list() || [])];
    } catch { keys = []; }
    this.listing = keys.map(String);
    return this.listing;
  }
}

// Canonical argument names of every op (api/*.schema.json as delivered with the task).
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
const RENAME_META = ['renamedFrom', 'formerly', 'previousName', 'oldName', 'was', 'replaces', 'aliasOf', 'x-renamedFrom', 'x-formerly'];

class Env {
  constructor(files) {
    this.files = files instanceof Files ? files : new Files(files);
    this.renameMemo = new Map();
    this.schedMemo = new Map();
    this.loadEditions();
    this.loadMaster();
  }

  loadEditions() {
    const eds = [];
    const seen = new Set();
    for (const p of this.files.list()) {
      const m = /^(?:\.\/)?rulebook\/([^/]+)\/edition\.json$/.exec(p);
      if (m && !seen.has(m[1])) { seen.add(m[1]); eds.push(m[1]); }
    }
    this.editions = [];
    for (const dir of eds) {
      const e = this.files.json(`rulebook/${dir}/edition.json`) || {};
      const get = (n) => this.files.json(`rulebook/${dir}/${n}`);
      this.editions.push({
        dir, id: e.id ?? dir, effectiveFrom: String(e.effectiveFrom ?? '0000-00-00').slice(0, 10),
        priority: asList(get('priority.json'), ['priority', 'rows']),
        assignment: asList(get('assignment.json'), ['assignment', 'rows']),
        alertUrgency: get('alert-urgency.json'),
        definitions: asList(get('sla-definitions.json'), ['definitions', 'slaDefinitions', 'slas']),
        policy: get('policy.json') || {},
      });
    }
    this.editions.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : (a.id < b.id ? -1 : 1)));
    const anyPolicy = this.editions.map((e) => e.policy).find((p) => p && p.systemTimeZone);
    this.systemTz = validTz(anyPolicy?.systemTimeZone) || SYSTEM_TZ_DEFAULT;
  }

  // R0: the published edition with the latest effectiveFrom on or before the date of the instant (system zone).
  edition(ms) {
    if (!this.editions.length) return null;
    const date = localDateStr(ms, this.systemTz);
    let best = null;
    for (const e of this.editions) if (e.effectiveFrom <= date) best = e;
    return best || this.editions[0];
  }

  loadMaster() {
    const idx = (name, keys) => {
      const list = asList(this.files.json(`master/${name}.json`), keys);
      const map = new Map();
      for (const r of list) if (r && r.id != null) map.set(String(r.id), r);
      return { list, map };
    };
    this.cis = idx('cis', ['cis', 'items']);
    this.services = idx('services', ['services']);
    this.groups = idx('groups', ['groups']);
    this.users = idx('users', ['users']);
  }

  ci(id) { return id == null ? null : this.cis.map.get(String(id)) || null; }
  service(id) { return id == null ? null : this.services.map.get(String(id)) || null; }
  group(id) { return id == null ? null : this.groups.map.get(String(id)) || null; }
  user(id) { return id == null ? null : this.users.map.get(String(id)) || null; }

  // SPEC-E §3.1: a CI is named by its id, its name or one of its aliases (case-insensitive after trimming).
  resolveCi(text) {
    const k = lc(text);
    if (!k) return null;
    for (const c of this.cis.list) if (lc(c.id) === k) return c;
    for (const c of this.cis.list) if (lc(c.name) === k) return c;
    for (const c of this.cis.list) {
      const al = Array.isArray(c.aliases) ? c.aliases : (c.alias != null ? [c.alias] : []);
      if (al.some((a) => lc(a) === k)) return c;
    }
    return null;
  }

  // R2.1: alert severity -> urgency (null when the severity maps to no urgency).
  alertUrgency(ms, severity) {
    const e = this.edition(ms);
    const au = e?.alertUrgency;
    const sev = lc(severity);
    if (au == null) return null;
    let v;
    if (Array.isArray(au)) {
      const row = au.find((r) => lc(r.severity ?? r.id ?? r.name) === sev);
      v = row ? (row.urgency ?? row.value) : undefined;
    } else if (typeof au === 'object') {
      const m = au.map ?? au.severities ?? au.urgency ?? au;
      if (Array.isArray(m)) {
        const row = m.find((r) => lc(r.severity ?? r.id) === sev);
        v = row ? row.urgency : undefined;
      } else {
        const key = Object.keys(m).find((k) => lc(k) === sev);
        v = key != null ? m[key] : undefined;
        if (v && typeof v === 'object') v = v.urgency;
      }
    }
    const n = toInt(v);
    return n != null && n >= 1 && n <= 3 ? n : null;
  }

  // R2.2: lowest `order` among rows matching impact, urgency and service (or "*").
  priority(ms, service, impact, urgency) {
    const e = this.edition(ms);
    let best = null;
    for (const r of e?.priority || []) {
      if (toInt(r.impact) !== impact || toInt(r.urgency) !== urgency) continue;
      if (!(r.service === '*' || sameValue(r.service, service))) continue;
      if (best === null || Number(r.order) < Number(best.order)) best = r;
    }
    return best ? toInt(best.priority) : null;
  }

  // R3.1: lowest `order` among rows matching category and region ("*" matches any).
  assignmentGroup(ms, category, region, ci) {
    const e = this.edition(ms);
    let best = null;
    for (const r of e?.assignment || []) {
      if (!(r.category === '*' || sameValue(r.category, category))) continue;
      if (!(r.region === '*' || sameValue(r.region, region))) continue;
      if (best === null || Number(r.order) < Number(best.order)) best = r;
    }
    let g = best ? best.group : 'ciSupportGroup';
    if (g === 'ciSupportGroup') g = ci?.supportGroup ?? null;
    return g == null ? null : String(g);
  }

  policy(ms) { return this.edition(ms)?.policy || {}; }

  calendar(id) {
    if (id == null) return null;
    return this.files.json(`calendar/${id}.json`) || null;
  }

  schedule(id, tz) {
    const k = `${id}|${tz}`;
    if (this.schedMemo.has(k)) return this.schedMemo.get(k);
    const s = new Schedule(id, id == null ? null : (this.calendar(id) || { businessHours: '24x7', holidays: [] }), tz);
    this.schedMemo.set(k, s);
    return s;
  }

  // R6: business time on the service-desk calendar (edition at the instant the clock starts).
  deskSchedule(ms) {
    const p = this.policy(ms);
    const id = p.serviceDeskCalendar ?? null;
    const cal = this.calendar(id);
    const tz = validTz(cal?.tz) || validTz(p.systemTimeZone) || this.systemTz;
    return this.schedule(id, tz);
  }

  email(userId) { const u = this.user(userId); return u?.email ?? u?.mail ?? null; }

  // A recipient named in master data may be an address or a user id.
  address(v) {
    if (v == null) return null;
    const s = String(v);
    if (s.includes('@')) return s;
    const u = this.user(s);
    return u?.email ?? s;
  }

  // Current argument names for an op: canonical name -> name the schema file shows now.
  argNames(system, op) {
    const k = system + '.' + op;
    if (this.renameMemo.has(k)) return this.renameMemo.get(k);
    const canon = CANON[system]?.[op] || [];
    const map = Object.fromEntries(canon.map((c) => [c, c]));
    const sch = this.files.json(`api/${system}.schema.json`);
    const opSch = sch?.ops?.[op] ?? sch?.effects?.[op];
    const props = opSch?.args?.properties;
    if (props && typeof props === 'object') {
      const names = Object.keys(props);
      const missing = canon.filter((c) => !names.includes(c));
      const extra = names.filter((n) => !canon.includes(n));
      const take = (c, n) => { map[c] = n; missing.splice(missing.indexOf(c), 1); extra.splice(extra.indexOf(n), 1); };
      // explicit rename maps anywhere on the op or system
      for (const src of [opSch.renames, opSch.renamed, sch.renames?.[op], sch.renamed?.[op]]) {
        if (src && typeof src === 'object') for (const [o, n] of Object.entries(src)) if (missing.includes(o) && extra.includes(n)) take(o, n);
      }
      for (const n of [...extra]) {
        const ps = props[n] || {};
        for (const mk of RENAME_META) {
          const v = ps[mk];
          if (typeof v === 'string' && missing.includes(v)) { take(v, n); break; }
        }
      }
      for (const n of [...extra]) {
        const d = String(props[n]?.description || '');
        const c = missing.find((m) => new RegExp('\\b' + m + '\\b').test(d));
        if (c) take(c, n);
      }
      if (missing.length === 1 && extra.length === 1) take(missing[0], extra[0]);
      else if (missing.length && missing.length === extra.length) {
        const order = (arr, ref) => [...arr].sort((a, b) => ref.indexOf(a) - ref.indexOf(b));
        const ms = order(missing, canon), es = order(extra, names);
        ms.forEach((m, i) => take(m, es[i]));
      }
    }
    this.renameMemo.set(k, map);
    return map;
  }

  renderArgs(system, op, args) {
    const map = this.argNames(system, op);
    const out = {};
    for (const [k, v] of Object.entries(args)) {
      if (v === undefined) continue;
      out[map[k] ?? k] = v;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Part D: replay of one incident's history. Input: the frozen intake facts (carry.inc or carry.mig), the raw facts
// received so far (carry.facts), the approval tasks created (carry.tasks) and `now`. Output: every business record
// the rules require so far (with the instant it describes and its window), planned records (future windows), the
// approval tasks wanted now, wake-up instants, and the incident's current values.
// ---------------------------------------------------------------------------------------------------------------

const ACTIVE_STATES = ['new', 'assigned', 'inProgress', 'onHold'];
const ENDED_STATES = ['resolved', 'closed', 'cancelled'];

function condValues(S) {
  return {
    priority: S.priority, impact: S.impact, urgency: S.urgency, state: S.state,
    holdReason: S.state === 'onHold' ? (S.holdReason ?? null) : null,
    source: S.source, service: S.service, assignmentGroup: S.group ?? null, major: !!S.major,
  };
}

// R4.1: a list of conditions holds when every condition holds; a list with no condition never holds.
function holds(conds, v) {
  const list = Array.isArray(conds) ? conds : (conds && Array.isArray(conds.when) ? conds.when : null);
  if (!list || list.length === 0) return false;
  for (const c of list) {
    if (!c || c.field == null) return false;
    const val = v[c.field];
    if (Array.isArray(c.in)) { if (!c.in.some((x) => sameValue(x, val))) return false; }
    else if (Array.isArray(c.values)) { if (!c.values.some((x) => sameValue(x, val))) return false; }
    else if (Array.isArray(c.notIn)) { if (c.notIn.some((x) => sameValue(x, val))) return false; }
    else if ('eq' in c || 'equals' in c || 'value' in c) { if (!sameValue(c.eq ?? c.equals ?? c.value, val)) return false; }
    else return false;
  }
  return true;
}

function normalWin(t) { return { ws: t, we: t + 15 * MIN }; }
function afterWin(t, minutes) { return { ws: afterInstant(t), we: t + minutes * MIN }; }

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
function shortKey(k) { return k.length <= 190 ? k : k.slice(0, 150) + '~' + fnv(k); }

class Replay {
  constructor(env, c, now) {
    this.env = env;
    this.c = c;
    this.now = now;
    this.N = c.number;
    this.records = [];
    this.seq = 0;
    this.slas = [];
    this.segments = [];
    this.wakes = [];
    this.keyUse = new Map();
    this.migDone = new Set();
    this.ap = null;
    this.t0 = c.mig ? parseInstant(c.mig.t0) : null;
    this.lastT = -Infinity;
  }

  // ---- record helpers -------------------------------------------------------------------------------------
  key(base) {
    const n = this.keyUse.get(base) || 0;
    this.keyUse.set(base, n + 1);
    return shortKey(n ? `${base}~${n}` : base);
  }

  rec(sys, op, args, at, win, rank, keyBase, sla = null) {
    const key = this.key(keyBase);
    const r = { key, sys, op, args, at, ws: win.ws, we: win.we, rank, seq: this.seq++, sla };
    this.records.push(r);
    return r;
  }

  itsm(op, extra, at, win, keyBase) {
    return this.rec('itsm', op, { number: this.N, ...extra }, at, win, 0, keyBase ?? `${this.N}:${op}:${Math.floor(at / MIN)}`);
  }

  notify(template, to, at, win, text) {
    if (!to) return null;
    const r = this.rec('notify', 'send', { to: String(to), about: this.N, template, text }, at, win, 0,
      `${this.N}:n:${template}:${Math.floor(at / MIN)}`);
    const m = this.c.mig;
    if (m && at < this.t0 && Array.isArray(m.notes)) {
      if (m.notes.some(([tpl, sent]) => tpl === template && sent >= at)) this.migDone.add(r.key);
    }
    return r;
  }

  callerEmail() { return this.c.inc.callerId ? this.env.email(this.c.inc.callerId) : null; }

  values() { return condValues(this.S); }

  pushSegment(t) {
    const v = this.values();
    const last = this.segments[this.segments.length - 1];
    if (last && last.t === t) last.v = v; else this.segments.push({ t, v });
  }

  valuesAt(t) {
    let v = null;
    for (const s of this.segments) { if (s.t <= t) v = s.v; else break; }
    return v || this.values();
  }

  // ---- run ------------------------------------------------------------------------------------------------
  run() {
    const c = this.c;
    this.openedAt = parseInstant(c.inc.openedAt);
    const facts = [...(c.facts || [])].sort((a, b) => a.t - b.t || a.q - b.q);
    if (c.mig) this.migBaseline(facts);
    else {
      this.S = {
        state: 'new', priority: c.inc.priority, impact: c.inc.impact, urgency: c.inc.urgency, holdReason: null,
        group: null, assignee: null, major: false, source: c.inc.source.kind, service: c.inc.service,
        alerts: new Set(c.inc.source.kind === 'alert' ? [c.inc.source.id] : []), callerDl: null, d2: null,
      };
    }
    const post = c.mig ? facts.filter((f) => f.t >= this.t0) : facts;
    if (!c.mig) post.unshift({ t: this.openedAt, q: -1, k: 'create' });
    else if (this.migNeedsAssign) post.unshift({ t: this.openedAt, q: -1, k: 'r31' });
    this.loop(post);
    this.thresholds();
    this.approvalWants();
    return this;
  }

  nextDerived() {
    const S = this.S;
    const cands = [];
    if (S.state === 'onHold' && S.holdReason === 'awaitingCaller' && S.callerDl && S.callerDl.D != null) cands.push(S.callerDl.D);
    if (S.state === 'resolved' && S.d2 != null) cands.push(S.d2);
    const ap = this.ap;
    if (ap && !ap.moot && !ap.counted && ap.deadline != null) cands.push(ap.deadline);
    let best = Infinity;
    for (const d of cands) if (d > this.lastT && d < best) best = d;
    return best;
  }

  loop(facts) {
    let i = 0;
    for (let guard = 0; guard < 100000; guard++) {
      const tf = i < facts.length ? facts[i].t : Infinity;
      let td = this.nextDerived();
      if (!(td < this.now)) td = Infinity; // a deadline consequence is taken only after the deadline (S1)
      const t = Math.min(tf, td);
      if (!Number.isFinite(t)) break;
      const before = this.values();
      let changed = false, creation = false, factChange = false;
      while (i < facts.length && facts[i].t === t) {
        const f = facts[i++];
        if (f.k === 'create') { this.create(t); creation = true; changed = true; factChange = true; continue; }
        if (this.applyFact(f)) { changed = true; factChange = true; }
        this.checkMoot(t);
      }
      let win = normalWin(t);
      if (t < this.now) {
        const d = this.derivedAt(t);
        if (d.changed) { changed = true; if (!factChange) win = d.win; }
      }
      this.lastT = t;
      if (changed) { this.pushSegment(t); this.engine(t, before, creation, win); }
    }
    // wake-ups for deadlines not yet passed
    const S = this.S;
    if (S.state === 'onHold' && S.holdReason === 'awaitingCaller' && S.callerDl?.D != null && S.callerDl.D >= this.now) this.wakes.push(afterInstant(S.callerDl.D));
    if (S.state === 'resolved' && S.d2 != null && S.d2 >= this.now) this.wakes.push(afterInstant(S.d2));
    const ap = this.ap;
    if (ap && !ap.moot && !ap.counted && ap.deadline != null && ap.deadline >= this.now) this.wakes.push(afterInstant(ap.deadline));
  }

  // ---- intake ---------------------------------------------------------------------------------------------
  create(t) {
    const inc = this.c.inc;
    this.itsm('create', {
      source: { kind: inc.source.kind, id: inc.source.id }, callerId: inc.callerId ?? null, ci: inc.ci,
      check: inc.check ?? null, service: inc.service, category: inc.category, impact: inc.impact, urgency: inc.urgency,
      priority: inc.priority, openedAt: fmt(t), summary: inc.summary ?? '',
    }, t, { ws: t, we: t }, `${this.N}:create`);
    if (inc.group) this.assign(inc.group, t, normalWin(t));
    this.checkFirstP1(t);
  }

  assign(group, t, win) {
    const S = this.S;
    S.state = 'assigned'; S.group = group; S.assignee = null; S.holdReason = null; S.callerDl = null;
    this.itsm('assign', { group, at: fmt(t), ref: `${this.N}|A|${Math.floor(t / MIN)}` }, t, win);
    const g = this.env.group(group);
    this.notify('assignment', g?.mailbox ?? g?.email ?? null, t, win, `Incident ${this.N} is assigned to ${group}.`);
  }

  canonGroup(g) {
    if (g == null) return null;
    const s = String(g).trim();
    if (this.env.group(s)) return s;
    const hit = this.env.groups.list.find((x) => lc(x.id) === lc(s));
    return hit ? String(hit.id) : s;
  }

  applyFact(f) {
    const S = this.S;
    if (f.k === 'ht') return this.taskEvent(f);
    if (S.state === 'closed' || S.state === 'cancelled') return false;
    if (f.k === 'rsv') return this.resolverUpdate(f);
    if (f.k === 'msg') return this.callerMessage(f);
    if (f.k === 'alr') return this.joinAlert(f);
    if (f.k === 'r31') {
      const g = this.c.inc.group;
      if (!g || S.state !== 'new') return false;
      this.assign(g, f.t, normalWin(f.t));
      return true;
    }
    return false;
  }

  resolverUpdate(f) {
    const S = this.S, t = f.t, env = this.env;
    if (S.state === 'resolved') return false; // R3.3
    const win = normalWin(t);
    switch (lc(f.a)) {
      case 'accept': {
        if (S.state !== 'assigned' || !f.u) return false;
        S.state = 'inProgress'; S.assignee = f.u;
        this.itsm('accept', { user: f.u, at: fmt(t) }, t, win);
        return true;
      }
      case 'hold': {
        if (S.state !== 'inProgress') return false;
        const reason = f.hr ? String(f.hr) : 'other';
        S.state = 'onHold'; S.holdReason = reason;
        this.itsm('hold', { reason, at: fmt(t) }, t, win);
        if (reason === 'awaitingCaller') {
          this.notify('awaiting-caller', this.callerEmail(), t, win, `Incident ${this.N} is waiting for your reply.`);
          S.callerDl = { h: t, D: this.deskDeadline(t, 'callerReplyDays') };
        }
        return true;
      }
      case 'resume': {
        if (S.state !== 'onHold') return false;
        S.state = 'inProgress'; S.holdReason = null; S.callerDl = null;
        this.itsm('resume', { at: fmt(t) }, t, win);
        return true;
      }
      case 'reassign': {
        if (!['assigned', 'inProgress', 'onHold'].includes(S.state)) return false;
        const g = this.canonGroup(f.tg);
        if (!g) return false;
        this.assign(g, t, win);
        return true;
      }
      case 'reclassify': {
        if (!ACTIVE_STATES.includes(S.state)) return false;
        const im = f.im != null && toInt(f.im) >= 1 && toInt(f.im) <= 3 ? toInt(f.im) : S.impact;
        const ur = f.ur != null && toInt(f.ur) >= 1 && toInt(f.ur) <= 3 ? toInt(f.ur) : S.urgency;
        return this.reclassify(im, ur, t, win);
      }
      case 'resolve': {
        if (!['assigned', 'inProgress', 'onHold'].includes(S.state)) return false;
        S.state = 'resolved'; S.holdReason = null; S.callerDl = null; S.resolvedAt = t;
        this.itsm('resolve', { closeCode: f.cc ? String(f.cc) : 'resolved', at: fmt(t) }, t, win);
        this.notify('resolved', this.callerEmail(), t, win, `Incident ${this.N} is resolved.`);
        S.d2 = this.deskDeadline(t, 'resolvedCloseDays');
        return true;
      }
      default:
        return false;
    }
  }

  // R6.1 / R6.4: the instant at which business time on the service-desk calendar since t reaches N business days.
  deskDeadline(t, field) {
    const p = this.env.policy(t);
    const days = Number(p[field]);
    const bdm = Number(p.businessDayMinutes);
    if (!Number.isFinite(days) || !Number.isFinite(bdm)) return null;
    return this.env.deskSchedule(t).reach(t, Math.round(days * bdm) * MIN);
  }

  reclassify(im, ur, t, win) {
    const S = this.S;
    const p = this.env.priority(t, S.service, im, ur) ?? S.priority;
    if (im === S.impact && ur === S.urgency && p === S.priority) return false;
    S.impact = im; S.urgency = ur; S.priority = p;
    this.itsm('reclassify', { impact: im, urgency: ur, priority: p, at: fmt(t) }, t, win);
    this.checkFirstP1(t);
    return true;
  }

  callerMessage(f) {
    const S = this.S, t = f.t, win = normalWin(t);
    const intent = lc(f.i);
    if (intent === 'reply') {
      if (S.state === 'onHold' && S.holdReason === 'awaitingCaller' && (S.callerDl?.D == null || t <= S.callerDl.D)) {
        S.state = 'inProgress'; S.holdReason = null; S.callerDl = null;
        this.itsm('resume', { at: fmt(t) }, t, win);
        return true;
      }
      return false;
    }
    if (intent === 'confirm') {
      if (S.state === 'resolved' && (S.d2 == null || t <= S.d2)) {
        S.state = 'closed';
        this.itsm('close', { reason: 'confirmed', at: fmt(t) }, t, win);
        return true;
      }
      return false;
    }
    if (intent === 'withdraw') {
      if (ACTIVE_STATES.includes(S.state)) {
        S.state = 'cancelled'; S.callerDl = null;
        this.itsm('cancel', { at: fmt(t) }, t, win);
        this.notify('incident-cancelled', this.callerEmail(), t, win, `Incident ${this.N} is cancelled as you asked.`);
        return true;
      }
      return false;
    }
    return false;
  }

  joinAlert(f) {
    const S = this.S, t = f.t, win = normalWin(t);
    if (!f.id || S.alerts.has(f.id)) return false; // R1.4
    if (ENDED_STATES.includes(S.state)) return false; // S8: not open at the alert's time
    S.alerts.add(f.id);
    this.itsm('linkAlert', { alertId: f.id }, t, win, `${this.N}:link:${f.id}`);
    if (f.u != null && S.urgency != null && f.u < S.urgency) return this.reclassify(S.impact, f.u, t, win);
    return false;
  }

  // Consequences taken only after a deadline (R6.3, R6.5, R7.2); dated at the deadline.
  derivedAt(t) {
    const S = this.S;
    let changed = false, win = null;
    if (S.state === 'onHold' && S.holdReason === 'awaitingCaller' && S.callerDl && S.callerDl.D === t) {
      win = afterWin(t, 60);
      S.state = 'closed'; S.callerDl = null;
      this.itsm('close', { reason: 'no-caller-response', at: fmt(t) }, t, win);
      this.notify('closed-no-response', this.callerEmail(), t, win, `Incident ${this.N} is closed: no reply was received.`);
      changed = true;
    }
    if (S.state === 'resolved' && S.d2 === t) {
      win = afterWin(t, 60);
      S.state = 'closed';
      this.itsm('close', { reason: 'auto', at: fmt(t) }, t, win);
      changed = true;
    }
    if (changed) this.checkMoot(t);
    const ap = this.ap;
    if (ap && !ap.moot && !ap.counted && ap.deadline === t) {
      if (S.state === 'closed' || S.state === 'cancelled') ap.moot = true; // S16
      else {
        const w = afterWin(t, 15);
        ap.counted = 'deadline';
        this.declareMajor(t, w);
        win = win ? { ws: Math.max(win.ws, w.ws), we: Math.min(win.we, w.we) } : w;
        changed = true;
      }
    }
    return { changed, win };
  }

  declareMajor(t, win) {
    const S = this.S;
    S.major = true;
    this.itsm('setMajor', { at: fmt(t) }, t, win);
    const svc = this.env.service(S.service);
    this.notify('major-incident', this.env.address(svc?.owner), t, win, `Incident ${this.N} is a major incident.`);
  }

  // ---- R7 approval ------------------------------------------------------------------------------------------
  checkFirstP1(t) {
    if (this.ap || this.S.priority !== 1) return;
    this.ap = { x: t, deadline: null, moot: false, counted: null, allowance: 0 };
    const tasks = this.c.tasks || [];
    if (tasks.length) {
      const c1 = tasks[0].c;
      const mins = Number(this.env.policy(c1).majorApprovalMinutes);
      this.ap.deadline = Number.isFinite(mins) ? c1 + mins * MIN : null;
    }
  }

  // R7.3: moot when, before an answer counts and before the deadline, the incident is resolved, closed or cancelled
  // or its priority is no longer 1.
  checkMoot(t) {
    const ap = this.ap, S = this.S;
    if (!ap || ap.moot || ap.counted) return;
    if (ap.deadline != null && t >= ap.deadline) return;
    if (ENDED_STATES.includes(S.state) || S.priority !== 1) ap.moot = true;
  }

  taskEvent(f) {
    const ap = this.ap;
    if (!ap || ap.moot || ap.counted || ap.blocked) return false;
    const tasks = this.c.tasks || [];
    if (!tasks.some((x) => x.id === f.id)) return false;
    if (ap.deadline != null && f.t > ap.deadline) return false;
    if (f.e === 'answered') {
      const d = lc(f.d);
      if (d === 'approve' || d === 'reject') {
        ap.counted = d;
        if (d === 'approve') { this.declareMajor(f.t, normalWin(f.t)); return true; }
        return false;
      }
      ap.allowance++;
      return false;
    }
    if (f.e === 'answerRejected' || f.e === 'withdrawn') ap.allowance++;
    return false;
  }

  approvalWants() {
    this.taskWants = [];
    const ap = this.ap, S = this.S;
    if (!ap || ap.moot || ap.counted || ap.blocked) return;
    const tasks = this.c.tasks || [];
    if (!tasks.length) {
      if (ACTIVE_STATES.includes(S.state) && S.priority === 1) this.taskWants.push({ first: true, x: ap.x });
      return;
    }
    if (ap.deadline != null && this.now <= ap.deadline && tasks.length - 1 < ap.allowance) this.taskWants.push({ first: false });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Part E: the SLA engine (R4, R5) and the go-live baseline (§3.6), as Replay methods.
// ---------------------------------------------------------------------------------------------------------------

Object.assign(Replay.prototype, {
  // R4.2: at a change instant, after every change of the instant: each SLA attached before it (cancel, stop,
  // reset, pause/resume), then attach.
  engine(t, before, creation, win) {
    const now = this.values();
    const ed = this.env.edition(t);
    for (const sla of this.slas) {
      if (sla.end || !(sla.mig || sla.x < t) || !sla.def) continue;
      const def = sla.def;
      const startHolds = holds(def.start?.when, now);
      if (holds(def.cancel?.when, now)) { this.slaCancel(sla, t, 'cancelled', win); continue; }
      if (def.cancel?.whenStartFails && !startHolds) { this.slaCancel(sla, t, 'start-failed', win); continue; }
      if (holds(def.stop?.when, now)) { this.slaStop(sla, t, win); continue; }
      const rf = def.reset?.onChangeOf;
      if (rf && !creation && !sameValue(before[rf], now[rf])) { this.slaCancel(sla, t, 'reset', win); continue; }
      const p = def.pause ? holds(def.pause.when, now) : false;
      if (!sla.paused && p) this.slaPause(sla, t, win);
      else if (sla.paused && !p) this.slaResume(sla, t, win);
    }
    for (const def of ed?.definitions || []) {
      if (def?.id == null) continue;
      const id = String(def.id);
      if (this.slas.some((s) => s.defId === id && !s.end)) continue;
      if (!holds(def.start?.when, now) || holds(def.stop?.when, now)) continue;
      const rf = def.reset?.onChangeOf;
      const resetChange = !!rf && !creation && !sameValue(before[rf], now[rf]);
      const heldBefore = creation ? false : holds(def.start?.when, before);
      if (!heldBefore || resetChange) this.slaAttach(def, t, win);
    }
  },

  resolveSchedule(def, x) {
    const sch = def.schedule || { source: 'none' };
    const src = lc(typeof sch === 'string' ? sch : sch.source);
    let id = null;
    if (src === 'calendar') id = sch.calendar ?? sch.id ?? null;
    else if (src === 'service') id = this.env.service(this.S.service)?.supportSchedule ?? null;
    else if (src === 'assignmentgroup') id = this.env.group(this.S.group)?.schedule ?? null;
    if (id == null || lc(id) === 'none') return { schedId: null, tz: null };
    const cal = this.env.calendar(id);
    let tz = validTz(cal?.tz);
    if (!tz) {
      const tzs = def.timezone || {};
      for (const s of asList(tzs.sources)) {
        const k = lc(s);
        if (k === 'caller') tz = validTz(this.env.user(this.c.inc.callerId)?.timezone);
        else if (k === 'ci') tz = validTz(this.env.ci(this.c.inc.ci)?.timezone);
        else if (k === 'definition') tz = validTz(tzs.definition);
        if (tz) break;
      }
    }
    return { schedId: String(id), tz: tz || this.env.systemTz };
  },

  recSla(sla, op, extra, at, win, rank, suffix) {
    return this.rec('sla', op, { number: this.N, definition: sla.defId, generation: sla.gen, ...extra }, at, win, rank,
      `${sla.id}:${suffix}`, sla.id);
  },

  // R4.3
  slaAttach(def, x, win) {
    const defId = String(def.id);
    const gen = 1 + this.slas.filter((s) => s.defId === defId).length;
    const retro = def.start?.from === 'openedAt';
    const startAt = retro ? Math.min(this.openedAt, x) : x;
    const { schedId, tz } = this.resolveSchedule(def, x);
    const sched = this.env.schedule(schedId, tz);
    const target = toInt(def.target?.minutes ?? def.target) ?? 0;
    const sla = { id: `${this.N}/${defId}/${gen}`, defId, gen, def, x, startAt, schedId, tz, sched, target, pauses: [], paused: false, end: null };
    this.slas.push(sla);
    const planned = sched.reach(startAt, target * MIN); // S13: as of startAt, as if never paused
    this.recSla(sla, 'start', { startAt: fmt(startAt), schedule: schedId, timezone: schedId == null ? null : tz, plannedBreachAt: fmt(planned) }, x, win, 2, 'start');
    const pNow = def.pause ? holds(def.pause.when, this.values()) : false;
    if (retro && def.start?.retroactivePause && def.pause && startAt < x) {
      for (const [a, b] of this.pauseIntervals(def.pause.when, startAt, x)) {
        sla.pauses.push([a, b]);
        this.recSla(sla, 'pause', { at: fmt(a) }, a, win, 2, `pause:${Math.floor(a / MIN)}`);
        if (b != null) {
          this.recSla(sla, 'resume', { at: fmt(b), plannedBreachAt: fmt(this.plannedAsOf(sla, b)) }, b, win, 2, `resume:${Math.floor(b / MIN)}`);
        } else sla.paused = true;
      }
    }
    if (pNow && !sla.paused) { // S14
      sla.pauses.push([x, null]);
      sla.paused = true;
      this.recSla(sla, 'pause', { at: fmt(x) }, x, win, 2, `pause:${Math.floor(x / MIN)}`);
    }
  },

  // Intervals of [from, x] in which the condition list held, from the incident's history; [a, null] when it still
  // holds at x (after the changes of x).
  pauseIntervals(conds, from, x) {
    const segs = this.segments.filter((s) => s.t <= x);
    const out = [];
    let cur = null;
    for (let i = 0; i < segs.length; i++) {
      const next = i + 1 < segs.length ? segs[i + 1].t : Infinity;
      if (next <= from) continue;
      const a = Math.max(segs[i].t, from);
      const h = holds(conds, segs[i].v);
      if (h && cur == null) cur = a;
      if (!h && cur != null) { if (a > cur) out.push([cur, a]); cur = null; }
    }
    if (cur != null) out.push([cur, null]);
    return out;
  },

  runningOf(sla, upTo = Infinity) {
    const end = Math.min(upTo, sla.end ? sla.end.t : Infinity);
    const out = [];
    let cur = sla.startAt;
    const ps = [...sla.pauses].sort((p, q) => p[0] - q[0]);
    for (const [a, b] of ps) {
      if (cur >= end) break;
      if (a > cur) out.push([cur, Math.min(a, end)]);
      cur = Math.max(cur, b == null ? Infinity : b);
    }
    if (cur < end) out.push([cur, end]);
    return out.filter(([a, b]) => b > a);
  },

  // R4.4 / S13: D as of instant t: business time of the running intervals before t, then counted on from t.
  plannedAsOf(sla, t) {
    const r = this.runningOf(sla, t);
    const target = sla.target * MIN;
    const b0 = runningBusiness(sla.sched, r, t);
    if (b0 >= target) return runningReach(sla.sched, r, target);
    return sla.sched.reach(t, target - b0);
  },

  slaPause(sla, t, win) {
    sla.pauses.push([t, null]);
    sla.paused = true;
    this.recSla(sla, 'pause', { at: fmt(t) }, t, win, 2, `pause:${Math.floor(t / MIN)}`);
  },

  slaResume(sla, t, win) {
    const open = sla.pauses.find((p) => p[1] == null);
    if (open) open[1] = t;
    sla.paused = false;
    this.recSla(sla, 'resume', { at: fmt(t), plannedBreachAt: fmt(this.plannedAsOf(sla, t)) }, t, win, 2, `resume:${Math.floor(t / MIN)}`);
  },

  slaStop(sla, t, win) {
    sla.end = { k: 'stop', t };
    const r = this.runningOf(sla, t);
    const D = runningReach(sla.sched, r, sla.target * MIN);
    this.recSla(sla, 'stop', {
      at: fmt(t),
      elapsedMinutes: Math.floor(runningWall(r, t) / MIN),
      businessElapsedMinutes: Math.floor(runningBusiness(sla.sched, r, t) / MIN),
      breached: D != null && D <= t,
    }, t, win, 2, 'stop');
  },

  slaCancel(sla, t, reason, win) {
    sla.end = { k: 'cancel', t, reason };
    this.recSla(sla, 'cancel', { at: fmt(t), reason }, t, win, 2, 'cancel');
  },

  // R4.6 breach and R5 escalations, from each SLA's running intervals (open-ended while it runs; records with a
  // future window are planned and only drive wake-ups).
  thresholds() {
    for (const sla of this.slas) {
      if (!sla.def || sla.target == null) continue;
      const r = this.runningOf(sla);
      const endT = sla.end ? sla.end.t : Infinity;
      const D = runningReach(sla.sched, r, sla.target * MIN);
      if (D != null && D <= endT) {
        const ws = Math.max(D, sla.x);
        this.recSla(sla, 'breach', { at: fmt(D) }, D, { ws, we: ws + 15 * MIN }, D <= sla.x ? 3 : 1, 'breach');
      }
      const seen = new Set();
      for (const e of asList(sla.def.escalations)) {
        const pct = toInt(e?.percent);
        if (!pct || seen.has(pct)) continue;
        seen.add(pct);
        const thr = Math.floor((sla.target * pct) / 100);
        const T = runningReach(sla.sched, r, thr * MIN);
        if (T == null || T > endT) continue;
        const due = Math.max(T, sla.x);
        const to = this.recipient(e.notify, due);
        if (!to) continue;
        this.recSla(sla, 'escalate', { percent: pct, to }, T, { ws: due, we: due + 15 * MIN }, T <= sla.x ? 3 : 1, `esc:${pct}`);
      }
    }
  },

  // R5.2: fixed at the instant the notice becomes due.
  recipient(kind, at) {
    const k = lc(kind);
    if (k === 'incidentmanagers') return this.env.policy(at).incidentManagersMailbox ?? null;
    const g = this.env.group(this.valuesAt(at).assignmentGroup);
    if (k === 'group') return g?.mailbox ?? null;
    if (k === 'groupmanager') return this.env.address(g?.managerEmail ?? g?.manager ?? null);
    return null;
  },

  findDef(defId, at) {
    const e = Number.isFinite(at) ? this.env.edition(at) : null;
    const pick = (ed) => (ed?.definitions || []).find((d) => String(d?.id) === defId);
    let d = pick(e);
    if (!d) for (const ed of [...this.env.editions].reverse()) { d = pick(ed); if (d) break; }
    return d || null;
  },

  // §3.6: continue a migrated incident from its records. The messages already received are replayed in shadow
  // (no records) only to recover the history the records do not carry (hold instants, past values for a later
  // retroactive pause, whether priority was ever 1).
  migBaseline(facts) {
    const m = this.c.mig, rec = m.rec || {}, inc = this.c.inc, t0 = this.t0, env = this.env;
    const srcKind = inc.source?.kind ?? 'report';
    const base = () => ({
      state: 'assigned', priority: toInt(rec.priority), impact: toInt(rec.impact), urgency: toInt(rec.urgency), holdReason: null,
      group: rec.assignmentGroup ?? null, assignee: null, major: false, source: srcKind, service: inc.service,
      alerts: new Set(), callerDl: null, d2: null,
    });
    this.S = base();
    this.pushSegment(this.openedAt);
    for (const f of facts) {
      if (f.t >= t0 || f.k === 'ht') continue;
      if (this.applyFact(f)) this.pushSegment(f.t);
    }
    const shadowHold = this.S.state === 'onHold' && this.S.holdReason === 'awaitingCaller' ? this.S.callerDl?.h ?? null : null;
    const everP1 = !!this.ap;
    this.records = []; this.keyUse = new Map(); this.ap = null; this.seq = 0; this.migDone = new Set();

    const state = rec.state || 'assigned';
    this.migNeedsAssign = state === 'new' && !rec.assignmentGroup && !!inc.group;
    this.S = {
      state, priority: toInt(rec.priority), impact: toInt(rec.impact), urgency: toInt(rec.urgency),
      holdReason: state === 'onHold' ? (rec.holdReason ?? null) : null, group: rec.assignmentGroup ?? null,
      assignee: rec.assignedTo ?? null, major: !!rec.major, source: srcKind, service: inc.service,
      alerts: new Set([...(Array.isArray(rec.alerts) ? rec.alerts : []), ...(srcKind === 'alert' && inc.source?.id ? [inc.source.id] : [])]),
      callerDl: null, d2: null, resolvedAt: parseInstant(rec.resolvedAt),
    };
    if (this.migNeedsAssign) this.segments = [];
    else this.pushSegment(Math.max(t0, this.segments.length ? this.segments[this.segments.length - 1].t : t0));

    // SLAs from their records (they keep running from their records).
    for (const r of m.slas || []) {
      const defId = String(r.definition);
      const gen = toInt(r.generation) || 1;
      const startAt = parseInstant(r.startAt);
      if (!Number.isFinite(startAt)) continue;
      const def = this.findDef(defId, startAt);
      const schedId = r.schedule ?? null;
      const cal = schedId == null ? null : env.calendar(schedId);
      const tz = schedId == null ? null : (validTz(r.timezone) || validTz(cal?.tz) || env.systemTz);
      const pauses = (Array.isArray(r.pauses) ? r.pauses : []).map((p) => [parseInstant(p.from), p.to == null ? null : parseInstant(p.to)])
        .filter((p) => Number.isFinite(p[0]));
      const stage = r.stage || 'inProgress';
      let end = null;
      if (stage === 'completed' || stage === 'cancelled') {
        const et = parseInstant(r.endAt);
        end = { k: stage === 'completed' ? 'stop' : 'cancel', t: Number.isFinite(et) ? et : t0, reason: r.cancelReason ?? null };
      }
      const paused = stage === 'paused';
      if (paused && !pauses.some((p) => p[1] == null)) pauses.push([t0, null]);
      if (!paused && !end) for (const p of pauses) if (p[1] == null) p[1] = t0;
      const sla = {
        id: `${this.N}/${defId}/${gen}`, defId, gen, def, x: startAt, mig: true, startAt, schedId, tz,
        sched: env.schedule(schedId, tz), target: def ? (toInt(def.target?.minutes ?? def.target) ?? null) : null,
        pauses, paused, end,
      };
      this.slas.push(sla);
      if (r.breached || r.breachAt) this.migDone.add(`${sla.id}:breach`);
      for (const [slaId, pct] of m.esc || []) if (slaId === sla.id || slaId === `${defId}/${gen}`) this.migDone.add(`${sla.id}:esc:${pct}`);
    }

    // Deadlines already running at go-live.
    const S = this.S;
    if (S.state === 'onHold' && S.holdReason === 'awaitingCaller') {
      let h = shadowHold;
      if (h == null) {
        const opens = this.slas.flatMap((s) => s.pauses.filter((p) => p[1] == null).map((p) => p[0])).filter((x) => x < t0);
        if (opens.length) h = Math.max(...opens);
      }
      if (h == null) {
        const sent = (m.notes || []).filter(([tpl]) => tpl === 'awaiting-caller').map(([, s]) => s);
        if (sent.length) h = Math.max(...sent);
      }
      if (h == null) h = t0;
      S.callerDl = { h, D: this.deskDeadline(h, 'callerReplyDays') };
    }
    if (S.state === 'resolved') {
      const r = Number.isFinite(S.resolvedAt) ? S.resolvedAt : t0;
      S.d2 = this.deskDeadline(r, 'resolvedCloseDays');
    }
    // R7 for a migrated incident: only a priority that first becomes 1 after go-live starts an approval, except an
    // incident opened at priority 1 whose approval window is still open at go-live.
    if (S.priority === 1 && !S.major && ACTIVE_STATES.includes(S.state) && this.openedAt + 15 * MIN >= t0 && !rec.majorAt) {
      this.ap = null;
      this.checkFirstP1(this.openedAt);
    } else if (S.priority === 1 || S.major || everP1) {
      this.ap = { x: null, deadline: null, moot: true, counted: null, allowance: 0, blocked: true };
    }
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Part F: the solver: routing and intake (§1 Routing, §3, R1), event ingestion, effect results and retries (§1
// Platform), emission of due records, human tasks (R7), wake-up obligations, carry.
// ---------------------------------------------------------------------------------------------------------------

const KNOWN_KEYS = ['reportId', 'alertId', 'incidentRef', 'intent', 'action', 'number'];

function bodyOf(ev) {
  const p = ev?.payload;
  if (!p || typeof p !== 'object') return {};
  if (KNOWN_KEYS.some((k) => k in p)) return p;
  for (const k of ['payload', 'message', 'body', 'data', 'content']) {
    const q = p[k];
    if (q && typeof q === 'object' && KNOWN_KEYS.some((x) => x in q)) return q;
  }
  return p;
}

function classify(ev) {
  const type = String(ev?.type || '');
  if (type === 'migration') return 'migration';
  if (type === 'effect.result') return 'result';
  if (type === 'timer.fired') return 'timer';
  if (type.startsWith('humanTask.')) return 'task';
  if (type === 'edition.published') return 'edition';
  const p = ev?.payload || {};
  const pt = String(p.type || p.kind || p.messageType || '');
  const b = bodyOf(ev);
  const is = (n) => type === n || pt === n;
  if (is('incident.reported') || b.reportId != null) return 'report';
  if (is('alert.raised') || (b.alertId != null && b.severity != null)) return 'alert';
  if (is('caller.message') || b.incidentRef != null || b.intent != null) return 'caller';
  if (is('resolver.update') || b.action != null) return 'resolver';
  const src = lc(ev?.source);
  if (src === 'portal') return 'report';
  if (src === 'monitor') return 'alert';
  if (src === 'mail') return 'caller';
  if (src === 'workspace') return 'resolver';
  return 'other';
}

function evTime(ev, fallback) {
  const t = parseInstant(ev?.at ?? ev?.payload?.at ?? ev?.receivedAt);
  return Number.isFinite(t) ? t : fallback;
}

function q(ctx, table, where, limit = 1000) {
  try {
    const r = ctx.query(table, { where, limit });
    return Array.isArray(r) ? r : asList(r, ['rows', 'records', 'items', 'results']);
  } catch { return []; }
}
function openInstances(ctx, subject, self) {
  if (!subject) return [];
  try {
    const r = ctx.instances({ subject });
    return asList(r, ['instances']).map((x) => String(typeof x === 'string' ? x : (x?.instance ?? x?.id ?? ''))).filter((x) => x && x !== self).sort(cmpInstance);
  } catch { return []; }
}
// Instance ids compare by their number when both carry one (i-000099 < i-000100), else as strings.
function cmpInstance(a, b) {
  const na = /(\d+)\D*$/.exec(a), nb = /(\d+)\D*$/.exec(b);
  if (na && nb && +na[1] !== +nb[1]) return +na[1] - +nb[1];
  return a < b ? -1 : a > b ? 1 : 0;
}
function keyStatus(ctx, sys, key) {
  try {
    const r = ctx.status(sys, key);
    return typeof r === 'string' ? r : (r?.status ?? null);
  } catch { return null; }
}
function incidentRecord(ctx, number) {
  if (!number) return null;
  const rows = q(ctx, 'itsm.incidents', { number });
  return rows.find((r) => normIncident(r.number) === number) || null;
}

function emptyOut(subject, priority, carry) {
  return { decisions: { subject: subject ?? null, priority: priority ?? null }, effects: [], obligations: { upsert: [], cancel: [] }, humanTasks: [], carry };
}

// A fact (compact, kept in carry) from an inbound event delivered to an incident instance.
function toFact(env, ev, kind, t, seq) {
  const b = bodyOf(ev);
  if (kind === 'resolver') {
    return { k: 'rsv', t, q: seq, a: lc(b.action), u: b.user ?? null, hr: b.holdReason ?? null, tg: b.toGroup ?? null, im: b.impact ?? null, ur: b.urgency ?? null, cc: b.closeCode ?? null };
  }
  if (kind === 'caller') return { k: 'msg', t, q: seq, i: lc(b.intent), f: b.from ?? null };
  if (kind === 'alert') return { k: 'alr', t, q: seq, id: normId(b.alertId), u: env.alertUrgency(t, b.severity) };
  if (kind === 'task') {
    const p = ev.payload || {};
    const ans = p.answer ?? p.value ?? p.response ?? p.result ?? null;
    let d = null;
    if (ans && typeof ans === 'object') d = ans.decision ?? null;
    else if (p.decision != null) d = p.decision;
    const e = String(ev.type).replace(/^humanTask\./, '');
    return { k: 'ht', t, q: seq, e, id: String(p.taskId ?? p.id ?? p.task?.id ?? p.humanTaskId ?? ''), d: d == null ? null : String(d) };
  }
  return null;
}

function pickArray(p, names) {
  const scopes = [p, p?.records, p?.sor, p?.export, p?.data, p?.state].filter((x) => x && typeof x === 'object');
  for (const s of scopes) {
    for (const n of names) {
      const v = s[n];
      if (v == null) continue;
      if (Array.isArray(v)) return v;
      if (typeof v === 'object') return 'number' in v || 'slaId' in v || 'notificationId' in v || 'escalationId' in v ? [v] : Object.values(v);
    }
  }
  return [];
}

class Solver {
  constructor() { this.id = 's2'; }

  tick(input, ctx) {
    const env = new Env(ctx?.files);
    const now = parseInstant(input.now);
    const events = Array.isArray(input.events) ? input.events : [];
    let carry = input.carry && typeof input.carry === 'object' ? input.carry : null;

    if (carry && carry.role === 'incident') return this.incidentTick(env, ctx, input, now, carry, events);
    if (carry && carry.role) {
      return { ...emptyOut(carry.subject ?? null, null, carry), close: true };
    }

    // First tick of an instance.
    const mig = events.find((e) => classify(e) === 'migration');
    if (mig) {
      carry = this.fromMigration(env, mig, now);
      if (!carry) return { ...emptyOut(null, null, { v: 2, role: 'inert' }), close: true };
      return this.incidentTick(env, ctx, input, now, carry, events.filter((e) => e !== mig));
    }
    const first = events.find((e) => ['report', 'alert', 'caller', 'resolver'].includes(classify(e)));
    if (!first) {
      // Not a message start (e.g. a stray result): nothing to do here.
      return { ...emptyOut(null, null, { v: 2, role: 'inert' }), close: true };
    }
    const kind = classify(first);
    const t = evTime(first, now);
    const b = bodyOf(first);
    if (kind === 'report') return this.intakeReport(env, ctx, input, now, first, b, t);
    if (kind === 'alert') return this.intakeAlert(env, ctx, input, now, first, b, t);
    const number = normIncident(kind === 'caller' ? b.incidentRef : b.number);
    return this.routeToIncident(env, ctx, input, now, number, kind, b, t);
  }

  mergeOrClose(env, ctx, input, number, kind, b, t) {
    const rec = incidentRecord(ctx, number);
    const prio = this.mergePriority(env, rec, kind, b, t);
    const open = openInstances(ctx, number, input.instance);
    if (open.length) {
      return { ...emptyOut(number, prio, { v: 2, role: 'merged', subject: number, into: open[0] }), merge: { into: open[0] } };
    }
    if (rec) return { ...emptyOut(number, prio, { v: 2, role: 'inert', subject: number }), close: true };
    return null;
  }

  mergePriority(env, rec, kind, b, t) {
    if (!rec) return null;
    let p = toInt(rec.priority);
    const open = ACTIVE_STATES.includes(rec.state);
    if (kind === 'alert' && open) {
      const u = env.alertUrgency(t, b.severity);
      if (u != null && u < toInt(rec.urgency)) p = env.priority(t, rec.service, toInt(rec.impact), u) ?? p;
    }
    if (kind === 'resolver' && open && lc(b.action) === 'reclassify') {
      const im = toInt(b.impact) ?? toInt(rec.impact), ur = toInt(b.urgency) ?? toInt(rec.urgency);
      p = env.priority(t, rec.service, im, ur) ?? p;
    }
    return p;
  }

  routeToIncident(env, ctx, input, now, number, kind, b, t) {
    const r = number ? this.mergeOrClose(env, ctx, input, number, kind, b, t) : null;
    if (r) return r;
    // §3.3: a message naming no incident is answered with nothing (the optional unknown-incident notice is not sent).
    return { ...emptyOut(null, null, { v: 2, role: 'inert' }), close: true };
  }

  intakeReport(env, ctx, input, now, ev, b, t) {
    const reportId = normId(b.reportId);
    if (!reportId) return { ...emptyOut(null, null, { v: 2, role: 'inert' }), close: true };
    const number = `INC-${reportId}`;
    const r = this.mergeOrClose(env, ctx, input, number, 'report', b, t); // R1.4: a repeated report changes nothing
    if (r) return r;
    const ci = env.resolveCi(b.ci);
    const service = ci?.service ?? null;
    const impact = toInt(env.service(service)?.impact) ?? 3;
    const urgency = Math.min(3, Math.max(1, toInt(b.urgency) ?? 3));
    let callerId = b.callerId == null ? null : String(b.callerId).trim();
    if (callerId && !env.user(callerId)) {
      const u = env.users.list.find((x) => lc(x.id) === lc(callerId));
      if (u) callerId = String(u.id);
    }
    const caller = env.user(callerId);
    const category = lc(b.category) || 'software';
    const region = caller?.region ?? ci?.region ?? null;
    const inc = {
      source: { kind: 'report', id: reportId }, callerId, ci: ci?.id != null ? String(ci.id) : String(b.ci ?? '').trim() || 'unknown',
      check: null, service: service != null ? String(service) : 'unknown', category, impact, urgency,
      priority: env.priority(t, service, impact, urgency) ?? 5, openedAt: fmt(t),
      summary: String(b.summary ?? '').slice(0, 400), group: env.assignmentGroup(t, category, region, ci),
    };
    const carry = { v: 2, role: 'incident', number, inc, mig: null, facts: [], tasks: [], fx: {}, q: 0, wake: null };
    return this.incidentTick(env, ctx, input, now, carry, input.events.filter((e) => e !== ev));
  }

  intakeAlert(env, ctx, input, now, ev, b, t) {
    const alertId = normId(b.alertId);
    const u = env.alertUrgency(t, b.severity);
    // R1.2: an alert whose severity maps to no urgency changes nothing and belongs to no incident.
    if (u == null || !alertId) return { ...emptyOut(null, null, { v: 2, role: 'inert' }), close: true };
    const own = `INC-${alertId}`;
    const r = this.mergeOrClose(env, ctx, input, own, 'alert', b, t); // R1.4 (the alert that opened an incident)
    if (r) return r;
    const ciRaw = String(b.ci ?? '').trim();
    const ci = env.ci(ciRaw) || env.resolveCi(ciRaw);
    const ciId = ci?.id != null ? String(ci.id) : ciRaw;
    const check = b.check == null ? null : String(b.check);
    let rows = q(ctx, 'itsm.incidents', { ci: ciId });
    if (!rows.length && ciRaw && ciRaw !== ciId) rows = q(ctx, 'itsm.incidents', { ci: ciRaw });
    rows = rows.filter((x) => lc(x.ci) === lc(ciId) || lc(x.ci) === lc(ciRaw));
    // R1.4: an alert already linked to an incident
    const linked = rows.find((x) => Array.isArray(x.alerts) && x.alerts.some((a) => normId(a) === alertId));
    if (linked) {
      const n = normIncident(linked.number);
      const open = openInstances(ctx, n, input.instance);
      if (open.length) return { ...emptyOut(n, toInt(linked.priority), { v: 2, role: 'merged', into: open[0] }), merge: { into: open[0] } };
      return { ...emptyOut(n, toInt(linked.priority), { v: 2, role: 'inert', subject: n }), close: true };
    }
    // R1.2 / S8: the open incident of the same CI and check (opened by an alert, not resolved/closed/cancelled at t)
    const isOpen = (x) => {
      if (lc(x.source?.kind) !== 'alert' || !sameValue(x.check ?? null, check)) return false;
      if (!ACTIVE_STATES.includes(x.state)) return false;
      const o = parseInstant(x.openedAt);
      if (Number.isFinite(o) && o > t) return false;
      for (const f of ['resolvedAt', 'closedAt', 'cancelledAt']) { const v = parseInstant(x[f]); if (Number.isFinite(v) && v <= t) return false; }
      return true;
    };
    const cands = rows.filter(isOpen).sort((a, c) => parseInstant(c.openedAt) - parseInstant(a.openedAt));
    if (cands.length) {
      const target = cands[0];
      const n = normIncident(target.number);
      const prio = this.mergePriority(env, target, 'alert', b, t);
      const open = openInstances(ctx, n, input.instance);
      if (open.length) return { ...emptyOut(n, prio, { v: 2, role: 'merged', into: open[0] }), merge: { into: open[0] } };
      return { ...emptyOut(n, toInt(target.priority), { v: 2, role: 'inert', subject: n }), close: true };
    }
    const service = ci?.service ?? null;
    const impact = toInt(env.service(service)?.impact) ?? 3;
    const inc = {
      source: { kind: 'alert', id: alertId }, callerId: null, ci: ciId || 'unknown', check, service: service != null ? String(service) : 'unknown',
      category: 'monitoring', impact, urgency: u, priority: env.priority(t, service, impact, u) ?? 5, openedAt: fmt(t),
      summary: `${b.check ?? 'check'} ${b.severity ?? ''} on ${ciId}`.trim().slice(0, 400),
      group: env.assignmentGroup(t, 'monitoring', ci?.region ?? null, ci),
    };
    const carry = { v: 2, role: 'incident', number: own, inc, mig: null, facts: [], tasks: [], fx: {}, q: 0, wake: null };
    return this.incidentTick(env, ctx, input, now, carry, input.events.filter((e) => e !== ev));
  }

  fromMigration(env, ev, now) {
    const p = ev.payload || {};
    const incs = pickArray(p, ['itsm.incidents', 'incidents', 'incident']);
    const rec = incs[0];
    if (!rec || !rec.number) return null;
    const number = normIncident(rec.number);
    const slas = pickArray(p, ['sla.slas', 'slas']).filter((s) => !s.number || normIncident(s.number) === number);
    const escs = pickArray(p, ['sla.escalations', 'escalations']).filter((s) => !s.number || normIncident(s.number) === number);
    const notes = pickArray(p, ['notify.notifications', 'notifications']).filter((s) => !s.about || normIncident(s.about) === number);
    const msgs = pickArray(p, ['messages', 'events', 'inbound', 'received', 'history']);
    const srcKind = rec.source?.kind ?? (/^INC-ALR/i.test(number) ? 'alert' : 'report');
    const ci = env.ci(rec.ci) || env.resolveCi(rec.ci);
    const caller = env.user(rec.callerId);
    const openedAt = parseInstant(rec.openedAt);
    const inc = {
      source: { kind: srcKind, id: rec.source?.id ?? number.replace(/^INC-/, '') }, callerId: rec.callerId ?? null,
      ci: rec.ci, check: rec.check ?? null, service: rec.service ?? ci?.service ?? null, category: rec.category ?? null,
      impact: toInt(rec.impact), urgency: toInt(rec.urgency), priority: toInt(rec.priority), openedAt: fmt(openedAt), summary: rec.summary ?? '',
      group: (rec.state === 'new' && !rec.assignmentGroup && Number.isFinite(openedAt))
        ? env.assignmentGroup(openedAt, rec.category, srcKind === 'alert' ? ci?.region : (caller?.region ?? ci?.region), ci) : null,
    };
    const carry = {
      v: 2, role: 'incident', number, inc,
      mig: {
        t0: fmt(now),
        rec: {
          state: rec.state, priority: rec.priority, impact: rec.impact, urgency: rec.urgency, holdReason: rec.holdReason ?? null,
          assignmentGroup: rec.assignmentGroup ?? null, assignedTo: rec.assignedTo ?? null, major: !!rec.major, majorAt: rec.majorAt ?? null,
          resolvedAt: rec.resolvedAt ?? null, alerts: Array.isArray(rec.alerts) ? rec.alerts.map(normId) : [],
        },
        slas: slas.map((s) => ({
          definition: s.definition, generation: s.generation, stage: s.stage, startAt: s.startAt, schedule: s.schedule ?? null,
          timezone: s.timezone ?? null, pauses: Array.isArray(s.pauses) ? s.pauses : [], breached: !!s.breached, breachAt: s.breachAt ?? null,
          endAt: s.endAt ?? null, cancelReason: s.cancelReason ?? null,
        })),
        esc: escs.map((e) => [e.slaId ?? `${number}/${e.definition}/${e.generation}`, toInt(e.percent)]),
        notes: notes.map((n) => [n.template, parseInstant(n.sentAt)]).filter((n) => Number.isFinite(n[1])),
      },
      facts: [], tasks: [], fx: {}, q: 0, wake: null,
    };
    for (const m of msgs) {
      const e = m && typeof m === 'object' && m.payload ? m : { payload: m, at: m?.at, type: m?.type, source: m?.source };
      const kind = classify(e);
      if (!['resolver', 'caller', 'alert'].includes(kind)) continue;
      const t = evTime(e, NaN);
      if (!Number.isFinite(t)) continue;
      const f = toFact(env, e, kind, t, carry.q++);
      if (f) carry.facts.push(f);
    }
    return carry;
  }

  ingest(env, now, c, events) {
    for (const ev of events) {
      const kind = classify(ev);
      const t = evTime(ev, now);
      if (kind === 'result') { this.onResult(c, ev.payload || {}, t, now); continue; }
      if (kind === 'timer') {
        const id = ev.payload?.obligationId ?? ev.payload?.id;
        if (c.wake && (id == null || id === c.wake.id)) c.wake = null;
        continue;
      }
      if (kind === 'task' || kind === 'resolver' || kind === 'caller' || kind === 'alert') {
        const f = toFact(env, ev, kind, t, c.q++);
        if (f) c.facts.push(f);
      }
      // reports delivered again (R1.4), editions and anything else change nothing
    }
  }

  // §1 Platform: a rate-limited or retryable error was not applied; re-issue with the same key and arguments.
  onResult(c, p, t, now) {
    const key = p.key;
    if (!key) return;
    const prev = c.fx[key] || {};
    const st = lc(p.status);
    const errText = lc(typeof p.error === 'string' ? p.error : JSON.stringify(p.error ?? '')) + ' ' + lc(p.code ?? '') + ' ' + lc(p.message ?? '');
    const n = prev.n || 1;
    const retry = (at) => (n >= 6 ? { s: 'x', n } : { s: 'r', r: at, n });
    if (st === 'ok') c.fx[key] = { s: 'ok' };
    else if (st === 'rate-limited') {
      const ra = Number(p.retryAfter);
      c.fx[key] = retry(ceilMinute(t + (Number.isFinite(ra) ? ra * 1000 : MIN)));
    } else if (st === 'unknown' || st === 'partial') c.fx[key] = { s: 'u', n };
    else if (st === 'error') {
      if (/predecessor/.test(errText)) c.fx[key] = retry(now);
      else if (/\b5\d\d\b|unavailable|timeout|timed out|internal|transient|retry/.test(errText)) {
        const ra = Number(p.retryAfter);
        c.fx[key] = retry(Number.isFinite(ra) ? ceilMinute(t + ra * 1000) : now);
      } else if (/\b400\b|invalid-args|field-renamed|renamed|invalid/.test(errText)) c.fx[key] = retry(now);
      else if (/\b409\b|conflict|\b4\d\d\b|not-found|refused/.test(errText)) c.fx[key] = { s: 'x', n };
      else c.fx[key] = retry(now);
    } else c.fx[key] = { s: 'u', n };
  }

  incidentTick(env, ctx, input, now, c, events) {
    c.facts = c.facts || []; c.tasks = c.tasks || []; c.fx = c.fx || {}; c.q = c.q || 0;
    this.ingest(env, now, c, events);
    const N = c.number;

    // A duplicate instance of the same incident (the same message delivered twice in one instant): the instance
    // with the smallest id keeps the incident; the other ends (its keyed effects were identical).
    if (c.facts.length || Object.keys(c.fx).length) {
      const others = openInstances(ctx, N, input.instance);
      if (others.length && cmpInstance(others[0], String(input.instance)) < 0 && !c.mig) {
        const rp0 = new Replay(env, c, now).run();
        return { ...emptyOut(N, rp0.S.priority ?? null, { v: 2, role: 'inert', subject: N }), close: true, obligations: { upsert: [], cancel: c.wake ? [c.wake.id] : [] } };
      }
    }

    const rp = new Replay(env, c, now).run();
    const t0 = c.mig ? parseInstant(c.mig.t0) : -Infinity;
    const effects = [];
    const wakes = rp.wakes.filter((w) => w > now);
    const lastBySla = new Map();
    let createKey = null;
    let outstanding = false;
    const recs = [...rp.records].sort((a, b) => a.ws - b.ws || a.rank - b.rank || a.seq - b.seq);
    for (const r of recs) {
      if (r.we < t0) continue; // before go-live
      if (rp.migDone.has(r.key)) continue;
      let st = c.fx[r.key];
      if (st?.s === 'ok' || st?.s === 'x') continue;
      if (r.ws > now) { wakes.push(r.ws); outstanding = true; continue; }
      if (st?.s === 'p') {
        outstanding = true;
        if (now - (st.t ?? now) < 3 * MIN) continue;
        st = { s: 'u', n: st.n };
      }
      if (st?.s === 'r' && st.r > now) { wakes.push(st.r); outstanding = true; continue; }
      if (!st || st.s === 'u') {
        const s = keyStatus(ctx, r.sys, r.key);
        if (s === 'committed') { c.fx[r.key] = { s: 'ok' }; continue; }
        if (s === 'pending') { c.fx[r.key] = { s: 'p', t: now, n: st?.n }; wakes.push(now + MIN); outstanding = true; continue; }
      }
      const eff = { key: r.key, system: r.sys, op: r.op, args: env.renderArgs(r.sys, r.op, r.args) };
      if (r.sla && lastBySla.has(r.sla)) eff.after = lastBySla.get(r.sla);
      else if (r.sys === 'itsm' && r.op !== 'create' && createKey) eff.after = createKey;
      if (r.sys === 'itsm' && r.op === 'create') createKey = r.key;
      if (r.sla) lastBySla.set(r.sla, r.key);
      effects.push(eff);
      c.fx[r.key] = { s: 'p', t: now, n: (st?.n || 0) + 1 };
      outstanding = true;
    }

    // R7 approval tasks
    const humanTasks = [];
    for (const w of rp.taskWants) {
      const k = c.tasks.length + 1;
      const id = `${N}:approval:${k}`;
      let due;
      if (w.first) {
        const mins = Number(env.policy(now).majorApprovalMinutes);
        due = now + (Number.isFinite(mins) ? mins : 60) * MIN;
      } else due = rp.ap.deadline;
      const task = {
        id, kind: 'majorIncidentApproval', role: 'incidentManager', subject: N,
        question: `Declare ${N} a major incident? Answer with decision "approve" or "reject".`,
        answerSchema: { type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['approve', 'reject'] } } },
        dueAt: fmt(due), onTimeout: 'expire',
      };
      if (c.inc.callerId) task.excludeUsers = [c.inc.callerId];
      humanTasks.push(task);
      c.tasks.push({ id, c: now });
      if (w.first) wakes.push(afterInstant(due));
    }

    // Close the instance once the incident is closed or cancelled and nothing is left to record.
    const done = (rp.S.state === 'closed' || rp.S.state === 'cancelled') && !outstanding && !humanTasks.length && !wakes.length;

    const obligations = { upsert: [], cancel: [] };
    const next = wakes.length ? Math.min(...wakes) : null;
    if (done) {
      if (c.wake) { obligations.cancel.push(c.wake.id); c.wake = null; }
    } else if (next == null) {
      if (c.wake) { obligations.cancel.push(c.wake.id); c.wake = null; }
    } else if (!c.wake || c.wake.at !== next) {
      if (c.wake) obligations.cancel.push(c.wake.id);
      const id = `wake-${Math.floor(next / MIN)}`;
      obligations.upsert.push({ id, kind: 'wake', anchor: fmt(next), dueAt: fmt(next), onDue: 'replay' });
      c.wake = { id, at: next };
    }

    this.compact(c);
    const out = { decisions: { subject: N, priority: rp.S.priority ?? null }, effects, obligations, humanTasks, carry: c };
    if (done) out.close = true;
    return out;
  }

  // Keep the carry under 64 KB: committed keys can be recovered with status().
  compact(c) {
    let size = JSON.stringify(c).length;
    if (size < 56000) return;
    for (const [k, v] of Object.entries(c.fx)) if (v.s === 'ok') delete c.fx[k];
    size = JSON.stringify(c).length;
    if (size < 60000) return;
    for (const f of c.facts) { delete f.f; }
  }
}

export function createSolver() {
  const s = new Solver();
  return { id: s.id, tick: (input, ctx) => s.tick(input, ctx) };
}

export const __test = { parseInstant, fmt, Schedule, localToInstant, tzOffset, Env, Files, Replay, holds, Solver, classify, runningReach, runningBusiness };
