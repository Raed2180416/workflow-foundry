// Simulated time for the E-bed host (E-BED §2.1; BED-CONTRACT-v1.1 §3.6). Times are ISO 8601 strings with an explicit
// offset at the interface and integer epoch milliseconds inside the host. The host only adds fixed durations (result
// latency, retry backoff, the one-minute clamp); it never computes business time or deadlines for an arm (§4.2).
// No wall clock anywhere: Date is used only to parse and format explicit-offset strings, which is deterministic.

export const MINUTE = 60_000;
export const SECOND = 1_000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;

export class TimeError extends Error {
  constructor(message) { super(message); this.name = 'TimeError'; this.code = 'BAD_TIME'; }
}

/** True when `s` is an ISO 8601 date-time with an explicit offset (or Z) that round-trips through Date. */
export function isIsoTime(s) {
  if (typeof s !== 'string') return false;
  const m = ISO.exec(s);
  if (!m) return false;
  const [, y, mo, d, h, mi, se = '0'] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59 || +se > 59) return false;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return false;
  // Reject impossible calendar dates (Date.parse rolls 2026-02-30 forward on some engines).
  const off = offsetMinutes(s);
  const local = new Date(ms + off * MINUTE);
  return local.getUTCFullYear() === +y && local.getUTCMonth() + 1 === +mo && local.getUTCDate() === +d;
}

/** Offset of an ISO string in minutes east of UTC. */
export function offsetMinutes(s) {
  const m = ISO.exec(s);
  if (!m) throw new TimeError(`not an ISO time with offset: ${JSON.stringify(s)}`);
  if (m[8] === 'Z') return 0;
  const sign = m[8][0] === '-' ? -1 : 1;
  return sign * (Number(m[8].slice(1, 3)) * 60 + Number(m[8].slice(4, 6)));
}

/** Epoch milliseconds of an ISO time with offset; throws on anything else. */
export function toMs(s) {
  if (!isIsoTime(s)) throw new TimeError(`not an ISO time with offset: ${JSON.stringify(s)}`);
  return Date.parse(s);
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
/** Format epoch ms as 'YYYY-MM-DDTHH:MM:SS±HH:MM' at a fixed offset (minutes east of UTC). Second resolution. */
export function fmt(ms, offset = 0) {
  if (!Number.isFinite(ms)) throw new TimeError(`not a time: ${ms}`);
  const d = new Date(Math.floor(ms / SECOND) * SECOND + offset * MINUTE);
  const sign = offset < 0 ? '-' : '+';
  const a = Math.abs(offset);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** ISO + whole minutes (or seconds), keeping the input's offset. */
export const addMinutes = (iso, n) => fmt(toMs(iso) + n * MINUTE, offsetMinutes(iso));
export const addSeconds = (iso, n) => fmt(toMs(iso) + n * SECOND, offsetMinutes(iso));

// ---------------------------------------------------------------------------------------------------------------------
// Agenda: a binary min-heap of scheduled host work. Order is (atMs, phase, source, id, seq): phase 0 is host-internal work
// (world writes, platform retries, form re-entries), phase 1 deliveries (events, timers, task timeouts), phase 2 sweep
// times. Within a phase, deliveries are ordered by (at, source, id) as the contract requires (§3.6); `seq` only breaks
// exact duplicates and is itself deterministic (insertion order).
const before = (a, b) => (a.atMs - b.atMs) || (a.phase - b.phase) || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0)
  || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || (a.seq - b.seq);

export class Agenda {
  #heap = [];
  #seq = 0;
  get size() { return this.#heap.length; }
  push(entry) {
    if (!Number.isFinite(entry.atMs)) throw new TimeError(`agenda entry without a time: ${entry.kind}`);
    const e = { phase: 1, source: '', id: '', ...entry, seq: this.#seq++ };
    const h = this.#heap;
    h.push(e);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (before(h[i], h[p]) >= 0) break;
      [h[i], h[p]] = [h[p], h[i]]; i = p;
    }
    return e;
  }
  peek() { return this.#heap[0] ?? null; }
  pop() {
    const h = this.#heap;
    if (!h.length) return null;
    const top = h[0], last = h.pop();
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < h.length && before(h[l], h[m]) < 0) m = l;
        if (r < h.length && before(h[r], h[m]) < 0) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]]; i = m;
      }
    }
    return top;
  }
  /** Pop every entry at the earliest time, in order. */
  popInstant() {
    const first = this.peek();
    if (!first) return [];
    const out = [];
    while (this.peek() && this.peek().atMs === first.atMs) out.push(this.pop());
    return out;
  }
}

/** Deterministic delivery order of events: (at, source, id) (§3.6). */
export const eventOrder = (a, b) => (toMs(a.at) - toMs(b.at)) || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0)
  || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
