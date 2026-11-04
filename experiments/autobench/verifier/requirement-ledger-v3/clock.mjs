// requirement-ledger-v3 (Δ* v1): "today" under the clock ruling (decision D28 (2)).
//
// The simulator's own clock (world meta.current_time) stays hidden: nothing here reads `meta`. "Today" is, in order:
//   1. explicit: a date the request itself gives for the work ("as of 2026-02-12", "today is March 3, 2026");
//   2. anchored: derived from the work items' business dates (convention G6). Event dates (a message's send time, a
//      ticket's or a log row's date) bound today from below, so with events today lies in [latest event, latest + H];
//      without events, the latest business date is only a weak anchor and today lies in [anchor - H, anchor + H];
//   3. unknown: no business date at all. Today is then a labelled null.
// A value with a time of day close to the host's own clock when the world was read (a load stamp: the environment wrote
// it while loading the world) is not a business date (the A1-C v2 rule M5, applied to the value, never to a field name).
// The result is a labelled null with a domain, not a guess: a figure that depends on today is certain only when it is
// the same for every day of the domain (dstar.mjs evaluates it over the domain); otherwise it stays UNKNOWN, with the
// point value at the anchor reported as a soft expectation.
// Generic by construction (PREREG-AB-v1 H7/H8). Every string is untrusted data.

export const CLOCK_VERSION = 'rl3-clock-v2';   // v2: past-event fields only (review of 2026-11-04)
export const HORIZON_DAYS = 30;
export const LOAD_STAMP_BEFORE_MS = 12 * 3600_000;
export const LOAD_STAMP_AFTER_MS = 5 * 60_000;
const DAY = 86_400_000;

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const iso = t => new Date(t).toISOString().slice(0, 10);
const pad = n => String(n).padStart(2, '0');
export const addDays = (d, n) => iso(Date.parse(`${d}T00:00:00Z`) + n * DAY);
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

function validDate(y, m, d) {
  const t = Date.UTC(y, m - 1, d);
  const x = new Date(t);
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** A date the request gives for the work: "today is <date>", "as of <date>", "current date: <date>", "for <date>" right
 *  after a reference to today. Returns {value, quote} or null. Only full dates count (a month alone is not "today"). */
export function requestDate(text) {
  const t = String(text ?? '');
  const DATE = `(\\d{4}-\\d{2}-\\d{2}|(?:${MONTHS.join('|')})\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{1,2}\\s+(?:${MONTHS.join('|')})\\s+\\d{4})`;
  const re = new RegExp(`(?:today(?:'s date)?\\s*(?:is|:)\\s*|as of\\s+|current date\\s*(?:is|:)\\s*|the date is\\s+|date today\\s*(?:is|:)\\s*)${DATE}`, 'i');
  const m = re.exec(t);
  if (!m) return null;
  const v = parseDate(m[1]);
  return v ? { value: v, quote: m[0] } : null;
}

/** A calendar date in a text value: ISO date or datetime, "March 3, 2026", "3 March 2026". Returns YYYY-MM-DD or null. */
export function parseDate(s) {
  const x = String(s ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(x);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = new RegExp(`^(${MONTHS.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})$`, 'i').exec(x);
  if (m) return validDate(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  m = new RegExp(`^(\\d{1,2})\\s+(${MONTHS.join('|')})\\s+(\\d{4})$`, 'i').exec(x);
  if (m) return validDate(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  return null;
}

/** Epoch ms of a value that carries a time of day (ISO datetime, epoch s or ms, a Slack ts), else null. */
export function instantOf(v) {
  if (typeof v === 'number') return v > 1e11 && v < 1e14 ? v : v > 1e8 && v < 1e11 ? v * 1000 : null;
  const s = String(v ?? '').trim();
  if (/^\d{9,10}\.\d+$/.test(s)) return Number(s) * 1000;
  if (/^\d{12,13}$/.test(s)) return Number(s);
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) return null;
  const t = Date.parse(s.replace(' ', 'T'));
  return Number.isFinite(t) ? t : null;
}

// Kinds whose dates record something that HAPPENED (a message sent, a ticket opened, a row logged). Scheduled kinds
// (calendar events, meetings, invitees, registrants) are not here: their dates may lie in the future, so they are only
// business dates (review of 2026-11-04, finding 13: a future meeting's start pushed "today" forward and made a figure
// certain and wrong).
const EVENT_KIND = /(message|mail|conversation|ticket|post|comment|note|log|activity|request|submission|case|chat|sms|call|envelope|history|thread|reply)/i;
// Fields that carry the moment a past event happened; start, start_time and other schedule fields are not among them.
const EVENT_FIELD = /(^|\.)(date|sent|sent_?at|sent_?date(_?time)?|received(_?at)?|internal_?date|ts|timestamp|submitted(_?at)?|requested(_?at)?|request_?date|logged(_?at)?|reported(_?at)?|occurred(_?at)?|created_?time|date_?sent)$/i;
const SCHEDULE_FIELD = /(^|\.)(start|start_?time|start_?date|start\.date(time)?|end|end_?time|end_?date|end\.date(time)?|due|due_?date|scheduled(_?at|_?for)?|deadline|expires?(_?at)?|expiry|starts_?at|ends_?at)$/i;
const BOOKKEEPING_FIELD = /(^|\.)(created_?at|createdat|createddate|created|updated_?at|updatedat|lastmodifieddate|last_?modified(_?date(_?time)?)?|modified(_?at|_?time)?|last_?activity(_?at)?|last_?viewed(_?at)?|seen_?at|date_?created|date_?updated|system_?modstamp|last_?referenced_?date)$/i;

/**
 * Business dates of members: [{date, kind: 'event'|'business', field, ptr}]. `hostNow` (epoch ms) is the host's clock
 * when the world was read; values with a time of day inside [hostNow - 12 h, hostNow + 5 min] are load stamps and
 * skipped, as are bookkeeping fields (created/updated stamps) that carry a load-stamp date. Members: {ptr, kind, attrs}.
 */
export function businessDates(members, { hostNow = null } = {}) {
  const out = [];
  const stamp = t => hostNow !== null && t >= hostNow - LOAD_STAMP_BEFORE_MS && t <= hostNow + LOAD_STAMP_AFTER_MS;
  const hostDay = hostNow !== null ? iso(hostNow) : null;
  for (const m of members) {
    const eventKind = EVENT_KIND.test(m.kind ?? '');
    for (const [field, v] of Object.entries(m.attrs ?? {})) {
      if (v === null || v === undefined || v === '') continue;
      if (/^_/.test(field)) continue;
      let date = null, instant = null;
      const numeric = typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v));
      if (numeric) {
        // a bare number is a date only in a date-named field (epoch ms or s, or a Slack ts)
        if (!(EVENT_FIELD.test(field) || BOOKKEEPING_FIELD.test(field) || /date|time|_at$/i.test(field))) continue;
        instant = instantOf(v);
        if (instant === null) continue;
        date = iso(instant);
      } else {
        const s = String(v);
        if (s.length > 40) continue;   // dates inside prose are not work-item dates
        instant = instantOf(s);
        date = instant !== null ? iso(instant) : parseDate(s);
        if (!date) continue;
      }
      if (instant !== null && stamp(instant)) continue;
      if (BOOKKEEPING_FIELD.test(field)) {
        if (hostDay && date === hostDay) continue;   // a creation or update stamp written on the day the world was loaded
        if (!eventKind) continue;   // bookkeeping stamps of reference records are not work-item dates
      }
      const kind = eventKind && !SCHEDULE_FIELD.test(field) && (EVENT_FIELD.test(field) || BOOKKEEPING_FIELD.test(field) || instant !== null) ? 'event' : 'business';
      out.push({ date, kind, field, ptr: m.ptr });
    }
  }
  return out;
}

/**
 * Today for the work: {status: 'explicit'|'anchored'|'weak'|'unknown', value, domain: [lo, hi] | null, basis}.
 *   explicit: the request's own date (domain is that one day);
 *   anchored: latest event date (domain [anchor, anchor + H]);
 *   weak:     latest business date without events (domain [anchor - H, anchor + H]);
 *   unknown:  labelled null (value null, domain null).
 */
export function deriveToday({ request = '', members = [], hostNow = null, horizonDays = HORIZON_DAYS } = {}) {
  const ex = requestDate(request);
  if (ex) return { status: 'explicit', value: ex.value, domain: [ex.value, ex.value], basis: { quote: ex.quote } };
  const dates = businessDates(members, { hostNow });
  const ev = dates.filter(d => d.kind === 'event').sort((a, b) => a.date.localeCompare(b.date));
  if (ev.length) {
    const a = ev.at(-1);
    return { status: 'anchored', value: a.date, domain: [a.date, addDays(a.date, horizonDays)], basis: { latestEvent: a, events: ev.length, business: dates.length - ev.length } };
  }
  const bz = dates.filter(d => d.kind === 'business').sort((a, b) => a.date.localeCompare(b.date));
  if (bz.length) {
    const a = bz.at(-1);
    return { status: 'weak', value: a.date, domain: [addDays(a.date, -horizonDays), addDays(a.date, horizonDays)], basis: { latestBusiness: a, business: bz.length } };
  }
  return { status: 'unknown', value: null, domain: null, basis: { why: 'no business date in the request or the work items' } };
}

/** Every day of a domain, in order (at most `max` days). */
export function domainDays(domain, max = 400) {
  if (!domain) return [];
  const n = Math.min(max, daysBetween(domain[0], domain[1]) + 1);
  return Array.from({ length: Math.max(0, n) }, (_, i) => addDays(domain[0], i));
}
