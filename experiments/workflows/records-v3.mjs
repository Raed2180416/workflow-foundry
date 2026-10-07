// Hand-written Foundry workflow for the `records` bed v3.0.0 (difficulty 3-4), Phase 1 exit experiment P1.
//
// Code owns procedure; models make narrow typed judgments. v3 draws five conventions per task and states
// them only in prose in inputs.source_notes (beds/records/README.md). None of them is hard-coded here:
// each is READ by an agent node with an enum output (plus verbatim evidence spans), and code derives the
// final value from what the node returns. Facts the README states as constant across tasks are coded
// (the six line dialects, LEDGR day.month.year, KOBO = Japan with era dates, the fixed status markers
// aktiv/gesperrt/storniert, stage=customer, ZZTEST, DO NOT MIGRATE, flag: SAMPLE, env sandbox/production,
// the VENDEX "Application withdrawn" marker, the mirror being one of BRIGHTDESK/LEDGR/VERITAS, the four
// perspective systems, and the ATLAS order being SWAPPED after its dated vendor move).
//
// Nodes (model nodes marked [M]):
//   prep (code)      split the export into rows; parse the five structured dialects into raw fields; split the
//                    notes into per-system paragraphs; list the extra status tokens that occur in the export;
//                    collect the distinct country strings; chunk the VENDEX rows (memo tails removed).
//   spec (code)      rate tables, calling codes / trunk rules and the nickname appendix from inputs.spec.
//   dates [M]        map over BRIGHTDESK/ATLAS/VENDEX: numeric date order, with its basis (explicit, example,
//                    same as another system, place) and verbatim evidence. Code resolves examples (parse the
//                    example date), references (LEDGR is fixed dmy; others resolve transitively) and places
//                    (US -> mdy, elsewhere dmy). Checks: quote verbatim in that system's paragraph, evidence
//                    spans inside the quote, place/order and LEDGR-reference consistency.
//   atlas_switch [M] the dated ATLAS vendor move (d>=4): present?, date as written, boundary. Checks: quote in
//                    the ATLAS paragraph, date inside the quote.
//   statuses [M]     map over the extra status tokens found in the export: void or live, with the relation to a
//                    fixed marker it is compared with ("treat exactly like SAMPLE" / "do not confuse with
//                    storniert"). Checks: quote in the paragraph, the token's mention inside the quote, and
//                    meaning consistent with the fixed marker's meaning and the stated relation.
//   mirror [M]       map over BRIGHTDESK/LEDGR/VERITAS: are this system's update dates real change dates or
//                    re-stamped (copy/restore/re-import)? Checks: quote in the paragraph; a "restamped" answer
//                    must agree with the data (that system's update dates span <= 120 days). The data never
//                    decides the convention: it only triggers escalation when the reading contradicts it.
//   perspective [M]  map over BRIGHTDESK/LEDGR/ATLAS/KOBO: what a POSITIVE printed balance becomes in the master
//                    (positive/negative), what it means (they owe us / we owe them) and what a NEGATIVE printed
//                    figure means, plus the verbatim span saying what the master does. Checks: quote and span in the
//                    paragraph; the first two agree; positive and negative meanings differ (catches a clause about
//                    "▲"/minus misattributed to positive figures); the span's sign words ("negative in the master",
//                    "opposite", "flip", "change" / "keep", "same way") agree with the answer.
//   vendex [M]       map over chunks of 5 VENDEX free-text rows: verbatim spans (name, birth date, revision date,
//                    phone, balance text, place) + typed place kind / country / balance direction / currency.
//                    Ids are echoed and checked. Code parses every span (date order from `dates`, number words,
//                    currency words; direction from the notes' fixed keyword lists, model enum as fallback).
//   vendex_b [M]     an independent second read of the same chunks (other framing and field order). Code combines
//                    the two reads field by field (combineVendexReads): spans are re-anchored to the entry text
//                    (alignSpan repairs a miscopied word, drops an invented span), a field only one read found is
//                    kept, a disagreement goes to the span that parses, and a country needs a stated place.
//   countries [M]    map over chunks of distinct country strings that are not exact ISO codes (English and
//                    German names, aliases, typos), with the spec's country table as context: the English name
//                    (as the table spells it) then an ISO alpha-2 enum; code takes the table's code for the name,
//                    the enum as fallback. Ids echoed and checked; "other" is rejected (escalation), since every
//                    country of this bed is in the spec's calling-code table.
//   merge (code)     conventions -> void rows, dates (with the ATLAS cutoff), signs, conflict order (mirror rows
//                    last); spec section 3 identity (union-find), section 4 conflicts and accent restoration,
//                    section 6 E.164, section 7 exact FX with half-away-from-zero rounding.
//   check (verify)   structural invariants of the answer + consistency of the conventions with each other and
//                    with the data (exactly one mirror, every status token judged, VENDEX spans verbatim, all
//                    rows accounted for). gate:false: the verdict is recorded, the answer is still emitted.
//                    Where code's evidence rule (example / same-as-system / place, country name) overrode the
//                    model's direct answer, the override is listed as a "note:" reason without failing the check.
//   answer (code)    {records:[...]}.
//
// Deviations from the v2 workflow (experiments/workflows/records-hand.mjs), with reasons:
//   - The five structured dialects are parsed in code, not by an extraction model. Their line formats are fixed
//     by the README and stated identically in every task's notes; reading "a=b | c=d" or "x;y;z" is procedure.
//     The v2 extraction node spent ~1K output tokens per 6 rows re-typing fields that code can read exactly,
//     and every per-task convention it was asked to apply inside that call was a chance to misapply it. The
//     model judgments that remain are the ones code cannot make: reading prose conventions, reading free-text
//     VENDEX entries, and mapping country names / aliases / typos / cities to ISO codes.
//   - Name splitting for structured systems is code (comma forms, capitalised family names, family-first KOBO,
//     title/initial removal); multi-word family names only occur as Dutch particles ("van der Meer"), which the
//     "Title Given [I.] Family" rule handles. VENDEX names come as verbatim spans and use the same rule.
//   - Thinking is off everywhere (skills/micro-harness: narrow extraction is better and cheaper without it).
//   - VENDEX is read twice (vendex, vendex_b) instead of once: on dev seeds the dominant residual error was a
//     field silently omitted by one read (a birth date, a revision date, a nationality), which no per-chunk
//     schema check can detect; omissions of two differently framed reads rarely coincide (+~$0.03 per task).
//   - A failed check on a convention or country node escalates at once (onCheckFail 'escalate'): on dev seed 109
//     (d4) a resample after an inconsistent answer returned a consistent but wrong one. VENDEX chunks (id echo)
//     and nodes already at maxClass resample once instead.
//
// Development evidence (dev split only, seeds 101-125, d3 and d4; /var/tmp/foundry-work/records-v3/dev-log.jsonl):
// code-side derivation corrected the model's direct date-order answer in about 1 of 20 judgments (example and
// same-as-system bases), which is why the order is derived from evidence spans rather than taken as answered.
// Final code, live: Haiku (M, escalation to L) label a8: d3 10/10, d4 10/10 on seeds 101-110, all score 1.000,
// $0.091-0.153 per task (mean $0.111 d3, $0.123 d4), 12 escalations to L (perspective 6, countries 5, atlas_switch 1);
// Sonnet (L) label s8: d3 5/5, d4 5/5 on seeds 106-110, $0.17-0.28 per task (s6, earlier prompts: 101-105, 10/10).
// Recommended for P1: fhand-haiku {extractModelClass:'M', conventionsModelClass:'M', maxClass:'L', concurrency:4,
// maxCost:2, reasoning:'none'}; fhand-sonnet the same with both classes 'L'.
//
// Code-node functions are plain, self-contained JS so they can be unit-tested (records-v3.test.mjs); they are
// serialised into the IR together with the helpers they call (bundle()).

// ------------------------------------------------------------------------------------------------------------
// Fixed facts (README / constant note text). Never per-task conventions.
export const SYSTEMS = ['BRIGHTDESK', 'LEDGR', 'ATLAS', 'VENDEX', 'KOBO', 'VERITAS'];
export const DATE_SYSTEMS = ['BRIGHTDESK', 'ATLAS', 'VENDEX'];
export const PERSPECTIVE_SYSTEMS = ['BRIGHTDESK', 'LEDGR', 'ATLAS', 'KOBO'];
export const MIRROR_CANDIDATES = ['BRIGHTDESK', 'LEDGR', 'VERITAS'];
// Fixed status markers (README "look-alike non-values and live rows"; identical sentences in every task's notes).
export const FIXED_STATUS = {
  BRIGHTDESK: { customer: 'live' },
  LEDGR: { aktiv: 'live', gesperrt: 'live', storniert: 'void' },
  ATLAS: { 'DO NOT MIGRATE': 'void' },
  KOBO: { SAMPLE: 'void' },
  VERITAS: { sandbox: 'void', production: 'live' },
};
// The markers a per-task status sentence may compare a value with, and their fixed meanings.
export const MARKER_ENUM = ['stage=customer', 'ZZTEST', 'aktiv', 'gesperrt', 'storniert', 'DO NOT MIGRATE', 'SAMPLE', 'sandbox', 'production', 'ordinary_live_rows', 'none'];
export const VOID_MARKERS = ['ZZTEST', 'storniert', 'DO NOT MIGRATE', 'SAMPLE', 'sandbox'];
export const LIVE_MARKERS = ['stage=customer', 'aktiv', 'gesperrt', 'production', 'ordinary_live_rows'];
// ISO alpha-2 codes a country judgment may return (the spec's calling-code table plus neighbours, so that a
// country outside the table is reported rather than forced onto the nearest listed one).
export const ISO_ENUM = ['US', 'CA', 'GB', 'IE', 'AU', 'NZ', 'DE', 'AT', 'CH', 'FR', 'BE', 'LU', 'NL', 'ES', 'PT', 'IT', 'MX', 'JP',
  'SE', 'DK', 'NO', 'FI', 'IS', 'PL', 'CZ', 'GR', 'BR', 'AR', 'ZA', 'IN', 'CN', 'other', 'none'];
// Exact ISO 3166 alpha-3 codes (world knowledge, not task data) for the deterministic part of country mapping.
export const ISO3 = { USA: 'US', CAN: 'CA', GBR: 'GB', IRL: 'IE', AUS: 'AU', NZL: 'NZ', DEU: 'DE', AUT: 'AT', CHE: 'CH', FRA: 'FR', BEL: 'BE',
  LUX: 'LU', NLD: 'NL', ESP: 'ES', PRT: 'PT', ITA: 'IT', MEX: 'MX', JPN: 'JP', SWE: 'SE', DNK: 'DK', NOR: 'NO', FIN: 'FI' };

// ------------------------------------------------------------------------------------------------------------
// Pure helpers (bundled into code nodes).
export function monthIndex(word) {
  const m = String(word ?? '').toLowerCase().slice(0, 3);
  return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m) + 1;
}

export function isoOf(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (![y, m, d].every(Number.isInteger) || m < 1 || m > 12 || d < 1 || d > 31 || y < 1000) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isPlaceholder(value) {
  const t = String(value ?? '').trim();
  return !t || /^(n\/?a|n\/k|n\.k\.|\?+|tbd|unknown|none|—|–|-+|0+[./-]0+[./-]0+|-+\/-+\/-+)$/i.test(t);
}

// Reads one date as written. order ('dmy'|'mdy') is needed only for all-numeric d/m/y forms; century applies to
// two-digit years. Returns 'YYYY-MM-DD' or null (placeholder, unreadable, impossible date, unknown order).
export function parseDate(raw, { order = null, century = 1900 } = {}) {
  let s = String(raw ?? '').trim().replace(/[.,;]+$/, '').trim();
  if (isPlaceholder(s)) return null;
  let k;
  const year = y => (y.length === 2 ? century + Number(y) : Number(y));
  if ((k = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/))) return isoOf(k[1], k[2], k[3]);
  if ((k = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/))) return isoOf(k[1], k[2], k[3]);
  if ((k = s.match(/^([SHR])\s?(\d{1,2})[./-](\d{1,2})[./-](\d{1,2})$/i))) {
    const base = { S: 1925, H: 1988, R: 2018 }[k[1].toUpperCase()];
    return isoOf(base + Number(k[2]), k[3], k[4]);
  }
  if ((k = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})$/))) {
    if (order !== 'dmy' && order !== 'mdy') return null;
    const a = Number(k[1]), b = Number(k[2]);
    return order === 'mdy' ? isoOf(year(k[3]), a, b) : isoOf(year(k[3]), b, a);
  }
  if ((k = s.match(/^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?[\s-]+([A-Za-z]{3,})\.?,?[\s-]+(\d{4}|\d{2})$/i))) {
    const m = monthIndex(k[2]);
    return m ? isoOf(year(k[3]), m, k[1]) : null;
  }
  if ((k = s.match(/^([A-Za-z]{3,})\.?\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4}|\d{2})$/i))) {
    const m = monthIndex(k[1]);
    return m ? isoOf(year(k[3]), m, k[2]) : null;
  }
  return null;
}

// Number words ("fifty-four hundred", "two hundred thirty-five") -> integer, or null.
export function wordsToNumber(text) {
  const UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
    fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, a: 1 };
  const words = String(text ?? '').toLowerCase().replace(/-/g, ' ').split(/[\s,]+/).filter(w => w && w !== 'and');
  if (!words.length) return null;
  let total = 0, current = 0, seen = false;
  for (const w of words) {
    if (Object.hasOwn(UNITS, w)) { current += UNITS[w]; seen = true; }
    else if (w === 'hundred') { current = (current || 1) * 100; seen = true; }
    else if (w === 'thousand') { total += (current || 1) * 1000; current = 0; seen = true; }
    else if (w === 'million') { total += (current || 1) * 1000000; current = 0; seen = true; }
    else return null;
  }
  return seen ? total + current : null;
}

// A plain decimal number as written ("50,042.72", "1.365,81", "2090332"); german: '.' groups and ',' decimals.
export function parseNumber(token, german = false) {
  let t = String(token ?? '').replace(/[\s'’]/g, '');
  if (!/\d/.test(t)) return null;
  if (german) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t) || /^\d+,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

// A structured-system balance as written -> {value (signed by the printed markers), currency} or null.
export function parseMoney(raw, { german = false, currency = null } = {}) {
  const s = String(raw ?? '').trim();
  if (isPlaceholder(s)) return null;
  const num = (s.match(/\d[\d.,'’\s]*\d|\d/g) ?? []).map(x => x.trim()).sort((a, b) => b.length - a.length)[0];
  if (!num) return null;
  const magnitude = parseNumber(num, german);
  if (magnitude === null) return null;
  const negative = /\(\s*[^)]*\d[^)]*\)/.test(s) || /\bCR\b/.test(s) || /▲/.test(s) || /^[^\d]*[-−]/.test(s) || /\d\s*[-−](?!\d)/.test(s);
  let ccy = currency;
  const code = s.match(/\b(USD|EUR|GBP|JPY|CHF|CAD|AUD|SEK|DKK|NOK|MXN|NZD)\b/);
  if (code) ccy = code[1];
  else if (/€/.test(s)) ccy = 'EUR';
  else if (/£/.test(s)) ccy = 'GBP';
  else if (/[¥円]/.test(s)) ccy = 'JPY';
  else if (/\$/.test(s) && !ccy) ccy = 'USD';
  return { value: negative ? -Math.abs(magnitude) : Math.abs(magnitude), currency: ccy };
}

// A VENDEX balance phrase as written ("in credit by two hundred euros and sixteen cents", "USD 1,000.00",
// "fifty-four hundred euros") -> {value (unsigned), currency} or null. The direction is applied separately.
export function parseVendexMoney(raw) {
  const s = String(raw ?? '').trim();
  if (!s || /not (recorded|on file)|no balance/i.test(s)) return null;
  const lower = s.toLowerCase();
  let currency = null;
  const code = s.match(/\b(USD|EUR|GBP|JPY|CHF|CAD|AUD|SEK|DKK|NOK|MXN)\b/);
  if (code) currency = code[1];
  else if (/dollar|\$/.test(lower)) currency = 'USD';
  else if (/euro|€/.test(lower)) currency = 'EUR';
  else if (/pound|sterling|£/.test(lower)) currency = 'GBP';
  else if (/\byen\b|¥/.test(lower)) currency = 'JPY';
  else if (/franc/.test(lower)) currency = 'CHF';
  const digits = s.match(/\d[\d,]*(?:\.\d+)?/);
  if (digits) return { value: parseNumber(digits[0], false), currency };
  const cleaned = lower.replace(/\b(owes us|open balance( of)?|outstanding|balance due|in credit by|holding a credit of|credit balance of|we owe them|of)\b/g, ' ');
  const [main, minor] = cleaned.split(/\b(?:us dollars?|dollars?|euros?|pounds sterling|pounds?|sterling|yen|swiss francs?|francs?)\b/);
  const whole = wordsToNumber((main ?? '').trim());
  if (whole === null) return null;
  const centsMatch = (minor ?? '').match(/^\s*(?:and\s+)?(.+?)\s+(?:cents?|pence|penny)\b/);
  const cents = centsMatch ? wordsToNumber(centsMatch[1]) : 0;
  if (cents === null) return null;
  return { value: Math.round((whole + cents / 100) * 100) / 100, currency };
}

// Returns the verbatim substring of `line` that a model span was meant to copy: the span itself when it is
// verbatim, else the word window of the line with the smallest edit distance (a miscopied word), or null when no
// window is close (an invented span).
export function alignSpan(span, line) {
  if (span == null) return null;
  const s = String(span).trim(), text = String(line ?? '');
  if (!s) return null;
  if (text.includes(s)) return s;
  const lev = (a, b) => {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  };
  const words = [...text.matchAll(/\S+/g)].map(m => ({ i: m.index, j: m.index + m[0].length }));
  const n = s.split(/\s+/).length;
  let best = null;
  for (let a = 0; a < words.length; a++) for (let len = Math.max(1, n - 2); len <= n + 2 && a + len <= words.length; len++) {
    const cand = text.slice(words[a].i, words[a + len - 1].j).replace(/[.,;:]+$/, '');
    const dist = lev(cand, s);
    if (!best || dist < best.dist) best = { cand, dist };
  }
  return best && best.dist <= Math.max(2, Math.floor(s.length * 0.25)) ? best.cand : null;
}

// Direction of a VENDEX balance phrase from the fixed keyword lists of the VENDEX notes; null when none occurs.
export function vendexDirection(text) {
  const t = String(text ?? '').toLowerCase();
  if (/in credit by|holding a credit|credit balance|we owe them/.test(t)) return 'credit';
  if (/owes us|open balance|outstanding|balance due/.test(t)) return 'owed_to_us';
  return null;
}

// Combines two independent reads of one VENDEX entry field by field. Spans are re-anchored to the entry text; a
// span only one read found is kept (omissions are the common error), and when both found different spans the one
// that parses wins (then read A). The country follows the read whose place is actually stated in the entry.
export function combineVendexReads(a, b, text, { order = null } = {}) {
  const reads = [a, b].filter(x => x && typeof x === 'object');
  if (!reads.length) return null;
  const out = { row: reads[0].row }, notes = [];
  const parses = (k, v) => (k === 'birth_date' || k === 'revised' ? parseDate(v, { order, century: k === 'revised' ? 2000 : 1900 }) !== null
    : k === 'balance_text' ? parseVendexMoney(v) !== null : true);
  for (const k of ['name', 'birth_date', 'revised', 'phone', 'balance_text', 'place']) {
    const spans = reads.map(r => (typeof r[k] === 'string' && r[k].trim() ? alignSpan(r[k], text) : null));
    const found = spans.filter(Boolean);
    let pick = found[0] ?? null;
    if (found.length === 2 && found[0] !== found[1]) {
      pick = found.find(v => parses(k, v)) ?? found[0];
      notes.push(`${k}: "${found[0]}" vs "${found[1]}"`);
    } else if (found.length === 1 && reads.length === 2) notes.push(`${k}: only one read`);
    out[k] = pick;
  }
  const withPlace = reads.find(r => typeof r.place === 'string' && r.place.trim() && alignSpan(r.place, text) !== null);
  out.country = withPlace && /^[A-Z]{2}$/.test(withPlace.country ?? '') ? withPlace.country : null;
  const kinds = reads.map(r => r.balance_kind).filter(x => x && x !== 'none');
  out.balance_kind = kinds[0] ?? 'none';
  const ccys = reads.map(r => r.currency).filter(x => x && x !== 'none');
  out.currency = ccys[0] ?? null;
  return { read: out, notes };
}

// Splits a name as written into {given, family}. form: 'comma' (Family, Given ...), 'caps' (Given FAMILY with a
// capitalised family), 'familyFirst' (KOBO), 'givenFirst' (Title Given [I.] Family), or 'auto' (structured rows).
export function splitName(raw, form = 'auto') {
  const TITLE = /^(mr|mrs|ms|miss|mx|dr|prof|herr|frau|sir|madam|mme)\.?$/i;
  const INITIAL = /^\p{Lu}\.?$/u;
  // Titles are only ever leading tokens; a later "dr" can be a typo of the particle "der".
  const lead = tokens => { const t = tokens.filter(Boolean); while (t.length > 1 && TITLE.test(t[0])) t.shift(); return t; };
  let s = String(raw ?? '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return { given: '', family: '' };
  if (form === 'auto') form = s.includes(',') ? 'comma' : 'givenFirst';
  if (form === 'comma') {
    const [fam, rest = ''] = s.split(/,(.*)/s);
    const given = lead(rest.trim().split(' '));
    return { given: given[0] ?? '', family: fam.trim() };
  }
  const tokens = lead(s.split(' '));
  if (form === 'familyFirst') return { family: tokens[0] ?? '', given: tokens.slice(1).filter(t => !INITIAL.test(t)).join(' ') };
  const isCaps = t => /\p{L}.*\p{L}/u.test(t) && t === t.toUpperCase() && t !== t.toLowerCase();
  if (form === 'caps' && tokens.some(isCaps)) {
    const fam = tokens.filter(isCaps), rest = tokens.filter(t => !isCaps(t) && !INITIAL.test(t));
    return { given: rest[0] ?? '', family: fam.join(' ') };
  }
  const rest = tokens.slice(1).filter(t => !INITIAL.test(t));
  return { given: tokens[0] ?? '', family: rest.join(' ') };
}

// Splits the source notes into the general paragraph and one paragraph per system ("SYSTEM. ...").
export function splitParagraphs(notes) {
  const out = { GENERAL: '' };
  const parts = String(notes ?? '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  for (const p of parts) {
    const k = p.match(/^([A-Z]{4,})\.\s/);
    if (k && ['BRIGHTDESK', 'LEDGR', 'ATLAS', 'VENDEX', 'KOBO', 'VERITAS'].includes(k[1])) out[k[1]] = out[k[1]] ? `${out[k[1]]}\n\n${p}` : p;
    else out.GENERAL = out.GENERAL ? `${out.GENERAL}\n\n${p}` : p;
  }
  return out;
}

// Parses one export line of a structured system into raw fields (as written). VENDEX lines keep their text.
export function parseLine(line) {
  const text = String(line ?? '').trim();
  const system = (text.match(/^[A-Za-z]+/) ?? [''])[0].toUpperCase();
  const r = { row: Number((text.match(/\d+/) ?? ['-1'])[0]), system, line: text, name: '', dob: '', country: '', phone: '', balance: '', updated: '', status: null, memo: '' };
  if (system === 'BRIGHTDESK') {
    const fields = {};
    for (const part of text.split(' | ').slice(1)) {
      const k = part.match(/^([a-z_]+)=(.*)$/s);
      if (k && !Object.hasOwn(fields, k[1])) fields[k[1]] = k[2].trim();
    }
    Object.assign(r, { name: fields.name ?? '', dob: fields.dob ?? '', country: fields.country ?? '', phone: fields.phone ?? '', balance: fields.balance ?? '',
      updated: fields.updated ?? '', status: fields.stage ?? null, memo: fields.memo ?? '' });
  } else if (system === 'LEDGR') {
    const f = text.split(';');
    Object.assign(r, { name: f[2] ?? '', salutation: f[3] ?? '', dob: f[4] ?? '', country: f[5] ?? '', phone: f[6] ?? '', balance: f[7] ?? '',
      status: (f[8] ?? '').trim() || null, updated: f[9] ?? '' });
  } else if (system === 'ATLAS') {
    const seg = text.split(' :: ');
    r.name = seg[1] ?? '';
    for (const s of seg.slice(2)) {
      const t = s.trim();
      if (/^born\b/.test(t)) r.dob = t.replace(/^born\s*/, '');
      else if (/^tel\b/.test(t)) r.phone = t.replace(/^tel\s*/, '');
      else if (/^owed\b/.test(t)) r.balance = t.replace(/^owed\s*/, '');
      else if (/^last change\b/.test(t)) r.updated = t.replace(/^last change\s*/, '');
      else if (/^note:/.test(t)) r.memo = t.replace(/^note:\s*/, '');
      else if (r.updated && /^[A-Z][A-Z ]*[A-Z]$/.test(t)) r.status = t;
      else if (!r.updated && !r.phone && r.dob) r.country = t;
    }
  } else if (system === 'KOBO') {
    const parts = text.split(' | ');
    r.name = (parts[0].match(/member:\s*(.*)$/) ?? ['', ''])[1];
    for (const p of parts.slice(1)) {
      const k = p.match(/^([a-z]+):\s?(.*)$/s);
      if (!k) continue;
      if (k[1] === 'birth') r.dob = k[2]; else if (k[1] === 'tel') r.phone = k[2]; else if (k[1] === 'balance') r.balance = k[2];
      else if (k[1] === 'upd') r.updated = k[2]; else if (k[1] === 'flag') r.status = k[2].trim(); else if (k[1] === 'note') r.memo = k[2];
    }
  } else if (system === 'VERITAS') {
    let j = {};
    try { j = JSON.parse(text.slice(text.indexOf('{'))); } catch { j = {}; }
    Object.assign(r, { row: Number.isInteger(j.row) ? j.row : r.row, given: j.given ?? '', family: j.family ?? '', dob: j.dob ?? '', country: j.country ?? '',
      phone: j.msisdn ?? '', amount: j.amount ?? null, currency: j.ccy ?? null, updated: j.ts ?? '', status: j.env ?? null, memo: j.note ?? '' });
  } else if (system === 'VENDEX') {
    r.text = text.replace(/\s*Remark:.*$/s, '').trim();
    r.withdrawn = /\(Application withdrawn\s*[—–-]+\s*never onboarded\.?\)\s*$/i.test(text.replace(/\s*Remark:.*$/s, '').trim());
  }
  for (const k of ['name', 'dob', 'country', 'phone', 'balance', 'updated']) if (typeof r[k] === 'string') r[k] = r[k].trim();
  return r;
}

// How a status token is mentioned in that system's paragraph of the notes (dialect constant).
export function statusMention(system, token) {
  return ({ BRIGHTDESK: `stage=${token}`, LEDGR: `"${token}"`, ATLAS: `:: ${token}`, KOBO: `flag: ${token}`, VERITAS: `"env":"${token}"` })[system] ?? token;
}

// Deterministic country mapping for exact codes only (ISO alpha-2 in the table, "UK", ISO alpha-3).
export function exactCountry(text, iso2List) {
  const t = String(text ?? '').trim().replace(/\./g, '').toUpperCase();
  if (!t) return null;
  if (t === 'UK') return 'GB';
  if (/^[A-Z]{2}$/.test(t) && iso2List.includes(t)) return t;
  const ISO3 = { USA: 'US', CAN: 'CA', GBR: 'GB', IRL: 'IE', AUS: 'AU', NZL: 'NZ', DEU: 'DE', AUT: 'AT', CHE: 'CH', FRA: 'FR', BEL: 'BE',
    LUX: 'LU', NLD: 'NL', ESP: 'ES', PRT: 'PT', ITA: 'IT', MEX: 'MX', JPN: 'JP', SWE: 'SE', DNK: 'DK', NOR: 'NO', FIN: 'FI' };
  if (/^[A-Z]{3}$/.test(t) && Object.hasOwn(ISO3, t) && iso2List.includes(ISO3[t])) return ISO3[t];
  return null;
}

// Spec tables: FX (one or two dated tables), calling codes / trunk rules, nicknames. Reused from v2.
export function parseSpec(input) {
  const text = String(input.spec ?? '');
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const isoDay = phrase => {
    const m = phrase.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    if (!m) return null;
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    return mi < 0 ? null : `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  };
  const phones = {}, nick = {}, tables = [], names = {};
  let current = null, inRates = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (/^\s*7\.\s*Balances/i.test(line)) { inRates = true; current = { upTo: null, from: null, rates: {} }; tables.push(current); }
    if (/^Appendix/i.test(line.trim())) inRates = false;
    const tableHead = line.match(/^\s*Table\s+\S+,\s*for rows updated (up to and including|on or after)\s+(.+?):\s*$/i);
    if (inRates && tableHead) {
      current = { upTo: /up to/i.test(tableHead[1]) ? isoDay(tableHead[2]) : null, from: /on or after/i.test(tableHead[1]) ? isoDay(tableHead[2]) : null, rates: {} };
      tables.push(current);
    }
    const quote = line.match(/^\s*([A-Z]{3})\/([A-Z]{3})\s+([0-9]+(?:\.[0-9]+)?)\s*$/);
    const plain = line.match(/^\s*([A-Z]{3})\s+([0-9]+(?:\.[0-9]+)?)\s*$/);
    if (inRates && quote) {
      const [, base, q, x] = quote;
      if (q === 'USD') current.rates[base] = { op: 'mul', x };
      else if (base === 'USD') current.rates[q] = { op: 'div', x };
    } else if (inRates && plain) current.rates[plain[1]] = { op: 'mul', x: plain[2] };
    const ph = line.match(/^\s*(.+?)\s{2,}([A-Z]{2})\s+\+(\d+)\s+trunk prefix:\s*(.*)$/);
    if (ph) { phones[ph[2]] = { cc: ph[3], trunk: /^0\b/.test(ph[4].trim()) ? '0' : 'none', keepZero: /kept/i.test(ph[4]) }; names[ph[2]] = ph[1].trim(); }
  }
  const appendix = text.split(/Appendix A/i).pop() ?? '';
  for (const group of appendix.split(/[;\n]/)) {
    const m = group.match(/^\s*([^=:]+?)\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    for (const n of m[1].split('/')) if (n.trim()) nick[n.trim().toLowerCase()] = m[2].trim();
  }
  return { tables: tables.filter(t => Object.keys(t.rates).length), phones, nick, iso2: Object.keys(phones),
    countryNames: names, countryList: Object.entries(names).map(([iso, name]) => `${iso} = ${name}`).join('\n') };
}

// Spec section 6. international: the number carries an international prefix or is a full international number.
export function toE164(phone, { country = null, system = '', international = false, phones = {} } = {}) {
  const p = String(phone ?? '').trim();
  if (isPlaceholder(p)) return null;
  let d = p.replace(/\D/g, '');
  if (!d || /^0+$/.test(d)) return null;
  let intl = international;
  if (/^\+/.test(p)) intl = true;
  else if (/^00/.test(d)) { intl = true; d = d.slice(2); }
  else if (system === 'BRIGHTDESK' && /^011/.test(d)) { intl = true; d = d.slice(3); }
  const table = Object.entries(phones).map(([iso, v]) => ({ iso, ...v }));
  if (intl) {
    const hit = table.filter(c => d.startsWith(c.cc)).sort((a, b) => b.cc.length - a.cc.length)[0];
    if (!hit) return `+${d}`;
    let national = d.slice(hit.cc.length);
    const info = table.find(c => c.cc === hit.cc && c.iso === country) ?? hit;
    if (national.startsWith('0') && info.trunk === '0' && !info.keepZero) national = national.slice(1);
    return `+${hit.cc}${national}`;
  }
  const info = phones[country];
  if (!info) return null;
  let national = d;
  if (info.cc === '1' && national.length === 11 && national.startsWith('1')) national = national.slice(1);
  else if (info.trunk === '0' && national.startsWith('0') && !info.keepZero) national = national.slice(1);
  return `+${info.cc}${national}`;
}

// Order of an example "03/02/1958 is 3 February 1958" / "10/09/1991 ... born in September": 'dmy'|'mdy'|null.
export function orderFromExample(numeric, meaning) {
  const k = String(numeric ?? '').match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (!k) return null;
  const a = Number(k[1]), b = Number(k[2]);
  const words = String(meaning ?? '').match(/[A-Za-z]{3,}/g) ?? [];
  let m = 0;
  for (const w of words) { const i = monthIndex(w); if (i && /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(w)) { m = i; break; } }
  if (!m) return null;
  if (b === m && a !== m) return 'dmy';
  if (a === m && b !== m) return 'mdy';
  return null;
}

// Final conventions from the judgment nodes' outputs. Every per-task value comes from a model answer; code only
// resolves examples, references and places, and records disagreements as diagnostics.
export function resolveConventions(input) {
  const ok = x => x && typeof x === 'object' && !x.$error && x.ok !== false;
  const byItem = (items, key, metaList) => {
    const out = {};
    (items ?? []).forEach((it, i) => { const v = it && it[key]; out[metaList[i]] = ok(it) && ok(v) ? v : null; });
    return out;
  };
  // diagnostics: missing or inconsistent judgments (verify reasons). overrides: the model's direct order answer
  // disagreed with the order code derived from its own evidence (example, reference, place); the derived value is used.
  const diagnostics = [], overrides = [];
  const dateAns = byItem(input.dates, 'judge', (input.dateItems ?? []).map(x => x.system));
  const resolveOrder = (sys, depth = 0) => {
    if (sys === 'LEDGR') return { order: 'dmy', how: 'fixed' };
    const a = dateAns[sys];
    if (!a) return null;
    if (a.basis === 'example') {
      const d = orderFromExample(a.example_numeric, a.example_meaning);
      if (d) { if (d !== a.order) overrides.push(`${sys}: example gives ${d}, model said ${a.order}`); return { order: d, how: 'example' }; }
    }
    if (a.basis === 'same_as_system' && a.same_as_system && a.same_as_system !== sys && depth < 4) {
      const r = resolveOrder(a.same_as_system, depth + 1);
      if (r) { if (r.order !== a.order) overrides.push(`${sys}: same as ${a.same_as_system} (${r.order}), model said ${a.order}`); return { order: r.order, how: `same_as:${a.same_as_system}` }; }
    }
    if (a.basis === 'place' && typeof a.place_in_united_states === 'boolean') {
      const d = a.place_in_united_states ? 'mdy' : 'dmy';
      if (d !== a.order) overrides.push(`${sys}: place gives ${d}, model said ${a.order}`);
      return { order: d, how: 'place' };
    }
    return a.order === 'dmy' || a.order === 'mdy' ? { order: a.order, how: 'stated' } : null;
  };
  const orders = {}, orderHow = {};
  for (const sys of ['BRIGHTDESK', 'ATLAS', 'VENDEX']) {
    const r = resolveOrder(sys);
    orders[sys] = r ? r.order : null; orderHow[sys] = r ? r.how : 'missing';
    if (!r) diagnostics.push(`${sys}: date order unresolved`);
  }
  // ATLAS dated swap (README: the order is swapped for rows changed on or after the vendor move).
  let atlasCutoff = null;
  const sw = ok(input.atlasSwitch) ? input.atlasSwitch : null;
  if (sw && sw.present) {
    const day = parseDate(sw.switch_date, { order: 'dmy', century: 2000 });
    const flipped = orders.ATLAS === 'dmy' ? 'mdy' : orders.ATLAS === 'mdy' ? 'dmy' : null;
    const stated = sw.after === 'day_first' ? 'dmy' : sw.after === 'month_first' ? 'mdy' : flipped;
    if (stated && flipped && stated !== flipped) diagnostics.push(`ATLAS switch: notes say ${stated} after the move, but the base order is ${orders.ATLAS}`);
    if (day && flipped) atlasCutoff = { from: day, inclusive: sw.boundary !== 'after', order: flipped };
    else diagnostics.push('ATLAS switch present but unreadable');
  } else if (!sw) diagnostics.push('ATLAS switch judgment missing');
  // Status values.
  const statusMeaning = {};
  for (const [sys, map] of Object.entries({ BRIGHTDESK: { customer: 'live' }, LEDGR: { aktiv: 'live', gesperrt: 'live', storniert: 'void' }, ATLAS: { 'DO NOT MIGRATE': 'void' },
    KOBO: { SAMPLE: 'void' }, VERITAS: { sandbox: 'void', production: 'live' } })) statusMeaning[sys] = { ...map };
  (input.statusItems ?? []).forEach((item, i) => {
    const v = input.statuses?.[i]?.judge;
    if (!ok(input.statuses?.[i]) || !ok(v)) { diagnostics.push(`status ${item.system} ${item.token}: no judgment (treated as live)`); statusMeaning[item.system][item.token] = 'live'; return; }
    statusMeaning[item.system][item.token] = v.meaning === 'void' ? 'void' : 'live';
  });
  // Mirror.
  const mirror = [];
  (input.mirrorItems ?? []).forEach((item, i) => {
    const v = input.mirror?.[i]?.judge;
    if (!ok(input.mirror?.[i]) || !ok(v)) { diagnostics.push(`mirror ${item.system}: no judgment`); return; }
    if (v.update_dates === 'restamped') mirror.push(item.system);
  });
  if (mirror.length !== 1) diagnostics.push(`mirror systems: ${mirror.length ? mirror.join(',') : 'none'} (expected exactly one)`);
  // Perspective.
  const flip = { BRIGHTDESK: false, LEDGR: false, ATLAS: false, KOBO: false, VENDEX: false, VERITAS: false };
  (input.perspectiveItems ?? []).forEach((item, i) => {
    const v = input.perspective?.[i]?.judge;
    if (!ok(input.perspective?.[i]) || !ok(v)) { diagnostics.push(`perspective ${item.system}: no judgment (kept)`); return; }
    flip[item.system] = v.positive_in_master === 'negative';
  });
  if (!Object.values(flip).some(Boolean)) diagnostics.push('no system flips its balance sign (README: at least one per task)');
  return { orders, orderHow, atlasCutoff, statusMeaning, mirror, flip, diagnostics, overrides };
}

// Spec sections 3, 4, 6, 7 over normalised rows. rows: [{row, system, void, given, family, dob, country, e164, money, updated}].
export function resolveIdentities(rows, spec) {
  const RENDER = { 'ä': ['a', 'ae'], 'ö': ['o', 'oe'], 'ü': ['u', 'ue'], 'ß': ['ss'], 'ø': ['o', 'oe'], 'å': ['a', 'aa'], 'æ': ['ae'], 'ō': ['o', 'ou'], 'ū': ['u', 'uu'] };
  const strip = s => String(s ?? '').normalize('NFC').toLowerCase().replace(/[\s'’`.\-]/g, '');
  const deaccent = ch => ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const renderings = s => {
    let outs = [''];
    for (const ch of s) {
      const opts = RENDER[ch] ?? [/[^\x00-\x7f]/.test(ch) ? deaccent(ch) : ch];
      outs = outs.flatMap(o => opts.map(x => o + x));
      if (outs.length > 64) outs = outs.slice(0, 64);
    }
    return outs;
  };
  const dl = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[a.length][b.length];
  };
  const formal = g => spec.nick?.[strip(g)] ?? g;
  const cache = new Map();
  const partDist = (a, b) => {
    const key = `${a}\u0000${b}`;
    if (cache.has(key)) return cache.get(key);
    const A = renderings(strip(a)), B = renderings(strip(b));
    let best = Infinity;
    for (const x of A) for (const y of B) { best = Math.min(best, dl(x, y)); if (best === 0) break; }
    cache.set(key, best);
    return best;
  };
  const namesMatch = (r, s) => partDist(formal(r.given), formal(s.given)) + partDist(r.family, s.family) <= 1;
  const live = rows.filter(r => r && !r.void && Number.isInteger(r.row));
  const parent = new Map(live.map(r => [r.row, r.row]));
  const find = x => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j];
    const linked = a.dob && b.dob ? a.dob === b.dob : (a.e164 && a.e164 === b.e164);
    if (linked && namesMatch(a, b)) parent.set(find(a.row), find(b.row));
  }
  const clusters = new Map();
  for (const r of live) { const k = find(r.row); if (!clusters.has(k)) clusters.set(k, []); clusters.get(k).push(r); }
  const hasAccent = s => /[^\x00-\x7f]/.test(s);
  const roundDiv = (num, den) => { const neg = (num < 0n) !== (den < 0n); const a = num < 0n ? -num : num, b = den < 0n ? -den : den; const q = (2n * a + b) / (2n * b); return neg ? -q : q; };
  const dec = x => { const [i, f = ''] = String(x).split('.'); return { n: BigInt(i + f), scale: 10n ** BigInt(f.length) }; };
  const toUsd = row => {
    const ccy = String(row.money.currency ?? '').toUpperCase(), value = Number(row.money.value);
    if (!Number.isFinite(value)) return null;
    const cents = BigInt(Math.round(value * 100));
    if (ccy === 'USD') return Number(cents) / 100;
    const day = String(row.updated ?? '').slice(0, 10);
    const table = (spec.tables ?? []).find(t => (t.upTo ? day <= t.upTo : true) && (t.from ? day >= t.from : true) && t.rates[ccy]) ?? (spec.tables ?? []).find(t => t.rates[ccy]);
    if (!table) return null;
    const { op, x } = table.rates[ccy], r = dec(x);
    const usdCents = op === 'mul' ? roundDiv(cents * r.n, r.scale) : roundDiv(cents * r.scale, r.n);
    return Number(usdCents) / 100;
  };
  const records = [];
  for (const members of clusters.values()) {
    // Conflict order: most recent first; rows of a re-stamped system after all others (spec 4).
    const ordered = [...members].sort((a, b) => (a.mirror !== b.mirror ? (a.mirror ? 1 : -1) : a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
    const latest = ordered[0];
    const restore = (part, key, mapNick) => {
      const v = mapNick ? formal(part) : part;
      if (hasAccent(v)) return v;
      for (const m of ordered) {
        const other = mapNick ? formal(m[key]) : m[key];
        if (hasAccent(other) && renderings(strip(other)).includes(strip(v))) return other;
      }
      return v;
    };
    const first = f => ordered.find(m => m[f] != null && m[f] !== '');
    const bal = ordered.find(m => m.money && Number.isFinite(Number(m.money.value)) && m.money.currency);
    records.push({
      entity_id: Math.min(...members.map(m => m.row)), source_rows: members.map(m => m.row).sort((a, b) => a - b),
      given_name: restore(latest.given, 'given', true), family_name: restore(latest.family, 'family', false),
      birth_date: first('dob')?.dob ?? null,
      country: first('country')?.country ?? null,
      phone_e164: first('e164')?.e164 ?? null,
      amount_usd: bal ? toUsd(bal) : null,
    });
  }
  records.sort((a, b) => a.entity_id - b.entity_id);
  return records;
}

// ------------------------------------------------------------------------------------------------------------
// Code-node mains.
export function prepMain(input) {
  const rows = String(input.export ?? '').split('\n').map(l => l.trim()).filter(Boolean).map(parseLine);
  const paragraphs = splitParagraphs(input.source_notes);
  const para = sys => paragraphs[sys] || String(input.source_notes ?? '');
  const FIXED = { BRIGHTDESK: ['customer'], LEDGR: ['aktiv', 'gesperrt', 'storniert'], ATLAS: ['DO NOT MIGRATE'], KOBO: ['SAMPLE'], VERITAS: ['sandbox', 'production'] };
  const seen = new Set(), statusItems = [];
  for (const r of rows) {
    if (r.system === 'VENDEX' || r.status == null || r.status === '') continue;
    const key = `${r.system}\u0000${r.status}`;
    if (seen.has(key) || (FIXED[r.system] ?? []).includes(r.status)) continue;
    seen.add(key);
    statusItems.push({ system: r.system, token: r.status, mention: statusMention(r.system, r.status), paragraph: para(r.system) });
  }
  const dateItems = ['BRIGHTDESK', 'ATLAS', 'VENDEX'].map(system => ({ system, paragraph: para(system) }));
  const perspectiveItems = ['BRIGHTDESK', 'LEDGR', 'ATLAS', 'KOBO'].map(system => ({ system, paragraph: para(system) }));
  // Span of each candidate system's update dates (data used only to check a "re-stamped" reading).
  const updDay = r => (r.system === 'LEDGR' ? parseDate(r.updated, { order: 'dmy', century: 2000 }) : parseDate(r.updated, { century: 2000 }));
  const mirrorItems = ['BRIGHTDESK', 'LEDGR', 'VERITAS'].map(system => {
    const days = rows.filter(r => r.system === system).map(updDay).filter(Boolean).map(d => Date.parse(`${d}T00:00:00Z`) / 86400000);
    const spanDays = days.length ? Math.round(Math.max(...days) - Math.min(...days)) : 0;
    return { system, paragraph: para(system), spanDays, rows: days.length };
  });
  const iso2 = input.iso2 ?? [];
  const countryStrings = [];
  for (const r of rows) {
    if (!['BRIGHTDESK', 'LEDGR', 'ATLAS'].includes(r.system)) continue;
    const c = String(r.country ?? '').trim();
    if (!c || isPlaceholder(c) || exactCountry(c, iso2) || countryStrings.includes(c)) continue;
    countryStrings.push(c);
  }
  const countryChunks = [];
  for (let i = 0; i < countryStrings.length; i += input.countryChunk) {
    const part = countryStrings.slice(i, i + input.countryChunk);
    countryChunks.push({ ids: part.map((_, j) => i + j + 1), lines: part.map((c, j) => `${i + j + 1}. ${c}`).join('\n'), known: String(input.countryList ?? '') });
  }
  const vendex = rows.filter(r => r.system === 'VENDEX');
  const vendexChunks = [];
  for (let i = 0; i < vendex.length; i += input.vendexChunk) {
    const part = vendex.slice(i, i + input.vendexChunk);
    vendexChunks.push({ ids: part.map(r => r.row), lines: part.map(r => r.text).join('\n'), known: String(input.countryList ?? '') });
  }
  return { rows, paragraphs, statusItems, dateItems, perspectiveItems, mirrorItems, countryStrings, countryChunks, vendexChunks,
    atlasParagraph: para('ATLAS'), counts: { rows: rows.length, vendex: vendex.length, statusTokens: statusItems.length, countryStrings: countryStrings.length } };
}

export function mergeMain(input) {
  const spec = input.spec;
  const conv = resolveConventions(input);
  const diagnostics = [...conv.diagnostics], overrides = [...(conv.overrides ?? [])];
  // Country strings -> ISO (exact codes in code; everything else from the countries judgment).
  const countryOf = new Map();
  (input.countryChunks ?? []).forEach((chunk, ci) => {
    const out = input.countries?.[ci]?.judge;
    if (!out || out.$error || !Array.isArray(out.codes)) { diagnostics.push(`country chunk ${ci}: no judgment`); return; }
    // The name is written first and decides when it is a name of the spec's table; the code is the fallback.
    const byName = new Map(Object.entries(spec.countryNames ?? {}).map(([iso, name]) => [String(name).toLowerCase(), iso]));
    chunk.ids.forEach((id, j) => {
      const named = byName.get(String(out.names?.[j] ?? '').trim().toLowerCase()), code = out.codes[j];
      if (named && typeof code === 'string' && code !== named) overrides.push(`country "${input.countryStrings[id - 1]}": name ${out.names[j]} (${named}) vs code ${code}`);
      const pick = named ?? (typeof code === 'string' && /^[A-Z]{2}$/.test(code) ? code : null);
      if (pick) countryOf.set(input.countryStrings[id - 1], pick);
    });
  });
  const iso = text => {
    const t = String(text ?? '').trim();
    if (!t || isPlaceholder(t)) return null;
    return exactCountry(t, spec.iso2 ?? []) ?? countryOf.get(t) ?? null;
  };
  // Two independent reads of every VENDEX chunk (vendex, vendex_b); either may be missing.
  const readsOf = list => {
    const m = new Map();
    (input.vendexChunks ?? []).forEach((chunk, ci) => {
      const out = list?.[ci]?.judge;
      if (!out || out.$error || !Array.isArray(out.rows)) return;
      for (const r of out.rows) if (r && Number.isInteger(r.row) && chunk.ids.includes(r.row) && !m.has(r.row)) m.set(r.row, r);
    });
    return m;
  };
  const readA = readsOf(input.vendex), readB = readsOf(input.vendexB);
  (input.vendexChunks ?? []).forEach((chunk, ci) => {
    if (!input.vendex?.[ci]?.judge) diagnostics.push(`vendex chunk ${ci}: read A missing`);
    if (input.vendexB && !input.vendexB?.[ci]?.judge) diagnostics.push(`vendex chunk ${ci}: read B missing`);
  });
  const vendexRead = new Map();
  for (const id of new Set([...readA.keys(), ...readB.keys()])) vendexRead.set(id, { a: readA.get(id) ?? null, b: readB.get(id) ?? null });
  const notMigrated = new Set();
  const normal = [], repaired = [], vendexFinal = [];
  const unparsed = { dob: 0, updated: 0, money: 0 };
  for (const r of input.rows ?? []) {
    const sys = r.system;
    const n = { row: r.row, system: sys, void: false, given: '', family: '', dob: null, country: null, e164: null, money: null, updated: '', mirror: conv.mirror.includes(sys) };
    // Void markers: fixed markers and the per-task status meanings.
    if (r.status != null && r.status !== '' && conv.statusMeaning[sys]?.[r.status] === 'void') n.void = true;
    if (sys === 'BRIGHTDESK' && /^\s*ZZTEST/i.test(r.name)) n.void = true;
    if (sys === 'VENDEX' && r.withdrawn) n.void = true;
    let updatedRaw = r.updated;
    if (sys === 'VENDEX') {
      const pair = vendexRead.get(r.row);
      const combined = pair ? combineVendexReads(pair.a, pair.b, r.text, { order: conv.orders.VENDEX }) : null;
      if (!combined) { n.void = true; notMigrated.add(r.row); diagnostics.push(`vendex row ${r.row}: not read`); normal.push(n); continue; }
      // Spans are re-anchored to the entry text: a miscopied word is replaced by what the entry actually says.
      const v = combined.read;
      for (const x of combined.notes) repaired.push(`${r.row} ${x}`);
      vendexFinal.push(v);
      const nm = splitName(v.name, 'givenFirst');
      n.given = nm.given; n.family = nm.family;
      n.dob = parseDate(v.birth_date, { order: conv.orders.VENDEX, century: 1900 });
      if (v.birth_date && !isPlaceholder(v.birth_date) && !/unknown|not on file/i.test(v.birth_date) && !n.dob) unparsed.dob++;
      // A country needs its evidence: a place that the entry actually states (combineVendexReads).
      n.country = v.country;
      n.e164 = toE164(v.phone, { country: n.country, system: sys, phones: spec.phones });
      const m = parseVendexMoney(v.balance_text);
      const direction = vendexDirection(v.balance_text) ?? (v.balance_kind === 'none' ? null : v.balance_kind);
      if (m && m.value !== null && direction) n.money = { value: direction === 'credit' ? -Math.abs(m.value) : Math.abs(m.value), currency: m.currency ?? v.currency ?? null };
      else if (v.balance_text && !/not (recorded|on file)|no balance/i.test(v.balance_text)) unparsed.money++;
      updatedRaw = v.revised;
      n.updated = parseDate(v.revised, { order: conv.orders.VENDEX, century: 2000 }) ?? '';
    } else {
      const form = sys === 'KOBO' ? 'familyFirst' : sys === 'BRIGHTDESK' ? (r.name.includes(',') ? 'comma' : 'caps') : sys === 'LEDGR' ? 'comma' : 'auto';
      const nm = sys === 'VERITAS' ? { given: r.given, family: r.family } : splitName(r.name, form);
      n.given = String(nm.given ?? ''); n.family = String(nm.family ?? '');
      if (sys === 'LEDGR') n.updated = parseDate(r.updated, { order: 'dmy', century: 2000 }) ?? '';
      else if (sys === 'VERITAS') n.updated = String(r.updated ?? '');
      else n.updated = parseDate(r.updated, { century: 2000 }) ?? '';
      let order = null;
      if (sys === 'LEDGR') order = 'dmy';
      else if (sys === 'BRIGHTDESK') order = conv.orders.BRIGHTDESK;
      else if (sys === 'ATLAS') {
        order = conv.orders.ATLAS;
        const c = conv.atlasCutoff, day = n.updated.slice(0, 10);
        if (c && day && (c.inclusive ? day >= c.from : day > c.from)) order = c.order;
      }
      n.dob = parseDate(r.dob, { order, century: 1900 });
      if (n.dob === '1900-01-01') n.dob = null;
      if (r.dob && !isPlaceholder(r.dob) && !n.dob && !(sys === 'VERITAS' && r.dob === '1900-01-01')) unparsed.dob++;
      n.country = sys === 'KOBO' ? 'JP' : iso(r.country);
      n.e164 = toE164(r.phone, { country: n.country, system: sys, international: sys === 'VERITAS', phones: spec.phones });
      if (sys === 'VERITAS') {
        const v = r.amount == null || r.amount === '' ? null : Number(r.amount);
        n.money = v === null || !Number.isFinite(v) || !r.currency ? null : { value: v, currency: String(r.currency).toUpperCase() };
      } else {
        const defaults = { BRIGHTDESK: 'USD', LEDGR: 'EUR', ATLAS: 'GBP', KOBO: 'JPY' };
        n.money = parseMoney(r.balance, { german: sys === 'LEDGR', currency: defaults[sys] });
        if (r.balance && !isPlaceholder(r.balance) && !n.money) unparsed.money++;
      }
    }
    if (n.dob === '1900-01-01') n.dob = null;
    if (n.money && conv.flip[sys]) n.money = { ...n.money, value: -n.money.value };
    if (!n.updated) { unparsed.updated++; diagnostics.push(`row ${r.row}: update date unreadable (${String(updatedRaw ?? '').slice(0, 40)})`); }
    normal.push(n);
  }
  const records = resolveIdentities(normal, spec);
  const voided = normal.filter(n => n.void).map(n => n.row);
  return { answer: { records }, conventions: { orders: conv.orders, orderHow: conv.orderHow, atlasCutoff: conv.atlasCutoff, statusMeaning: conv.statusMeaning, mirror: conv.mirror, flip: conv.flip },
    diagnostics: diagnostics.slice(0, 40), overrides: overrides.slice(0, 40), vendexDisagreements: repaired.slice(0, 40), unparsed, voided, notRead: [...notMigrated], rowIds: normal.map(n => n.row), vendexRead: vendexFinal, vendexLines: (input.rows ?? []).filter(r => r.system === 'VENDEX').map(r => ({ row: r.row, text: r.text })) };
}

export function verifyMain(input) {
  const s = input.subject ?? {};
  const recs = s.answer?.records ?? [];
  const reasons = [];
  const seen = new Set();
  for (const r of recs) {
    if (!Array.isArray(r.source_rows) || !r.source_rows.length) { reasons.push(`record ${r.entity_id} has no rows`); continue; }
    for (const id of r.source_rows) { if (seen.has(id)) reasons.push(`row ${id} in two records`); seen.add(id); }
    if (r.entity_id !== Math.min(...r.source_rows)) reasons.push(`entity ${r.entity_id} is not its smallest row`);
    if (r.birth_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(r.birth_date)) reasons.push(`bad birth date for ${r.entity_id}`);
    if (r.phone_e164 != null && !/^\+\d{6,15}$/.test(r.phone_e164)) reasons.push(`bad phone for ${r.entity_id}`);
    if (r.amount_usd != null && !Number.isFinite(r.amount_usd)) reasons.push(`bad amount for ${r.entity_id}`);
    if (r.country != null && !/^[A-Z]{2}$/.test(r.country)) reasons.push(`bad country for ${r.entity_id}`);
    if (!r.given_name || !r.family_name) reasons.push(`missing name for ${r.entity_id}`);
  }
  const voided = new Set(s.voided ?? []);
  for (const id of s.rowIds ?? []) if (!voided.has(id) && !seen.has(id)) reasons.push(`row ${id} neither void nor merged`);
  for (const id of seen) if (voided.has(id)) reasons.push(`void row ${id} merged`);
  // VENDEX spans must be verbatim (a misplaced span is a misread).
  const lines = new Map((s.vendexLines ?? []).map(l => [l.row, l.text]));
  for (const v of s.vendexRead ?? []) {
    for (const k of ['name', 'birth_date', 'phone', 'balance_text', 'revised', 'place']) {
      const t = v[k];
      if (typeof t === 'string' && t && !(lines.get(v.row) ?? '').includes(t)) reasons.push(`vendex ${v.row} ${k} not verbatim`);
    }
    if (!v.revised) reasons.push(`vendex ${v.row} has no revision date`);
  }
  for (const d of s.diagnostics ?? []) reasons.push(`diagnostic: ${d}`);
  for (const [k, n] of Object.entries(s.unparsed ?? {})) if (n) reasons.push(`${n} unparsed ${k} value(s)`);
  // Overrides are listed but do not fail the check: code used the order its evidence rule derived from the model's own
  // quoted example/reference/place (dev a6+a8r: 7 of 43 runs had one; every derived value was correct).
  const notes = (s.overrides ?? []).slice(0, 8).map(x => `note: override ${String(x).slice(0, 300)}`);
  return { pass: recs.length > 0 && reasons.length === 0, score: reasons.length ? Math.max(0, 1 - reasons.length / 20) : 1,
    reasons: [...reasons.slice(0, 32 - notes.length), ...notes].map(x => String(x).slice(0, 900)) };
}

// ------------------------------------------------------------------------------------------------------------
// Bundling: a code node's source holds the helpers it calls plus `export default main`.
const HELPERS = [monthIndex, isoOf, isPlaceholder, parseDate, wordsToNumber, parseNumber, parseMoney, parseVendexMoney, alignSpan, vendexDirection, combineVendexReads, splitName, splitParagraphs,
  parseLine, statusMention, exactCountry, parseSpec, toE164, orderFromExample, resolveConventions, resolveIdentities];
export const bundle = main => `${HELPERS.filter(f => f !== main).map(f => f.toString()).join('\n\n')}\n\n${main.toString()}\n\nexport default ${main.name};\n`;

// ------------------------------------------------------------------------------------------------------------
// Judgment nodes: instructions and schemas.
const S = (maxLength = 400) => ({ type: ['string', 'null'], maxLength });
const SYS_ENUM = ['BRIGHTDESK', 'LEDGR', 'ATLAS', 'VENDEX', 'KOBO', 'VERITAS', 'none'];

export const DATE_INSTRUCTIONS = `You read one paragraph of source notes (input block "paragraph") that describes a legacy system (named in "system"). Decide how this system writes NUMERIC dates such as 03/04/1990: day first ("dmy") or month first ("mdy"). For VENDEX the question covers all its numeric dates; for BRIGHTDESK and ATLAS it covers numeric birth dates.
Return:
- basis: how the paragraph settles it:
  "explicit" = it states the order itself (day first / month first, DD/MM/YYYY / MM/DD/YYYY, UK or US locale, European or American convention, including negated forms such as "does not use the American order");
  "example" = it gives an example numeric date and says what it means (a full date, or only the month someone was born in / a date falls in);
  "same_as_system" = it says the order is the same as another system's;
  "place" = it gives only a place (the city the team works in now, or the country where the servers stand) and says dates are written the way people there do.
- order: your reading, "dmy" or "mdy".
- quote: the one sentence that settles it, copied exactly, character for character, from the paragraph.
- example_numeric / example_meaning: for basis "example", the example numeric date exactly as written (e.g. "03/02/1958") and the words that say what it means exactly as written (e.g. "3 February 1958" or "September"); otherwise null.
- same_as_system: for basis "same_as_system", the other system's name; otherwise "none".
- moved_from / place / place_in_united_states: for basis "place". If the text says the team moved ("moved from A to B"), moved_from is A, the place it moved FROM, exactly as written, and place is B, the place it moved TO and works in now; otherwise moved_from is null and place is the place given (where the team works, or the country where the servers stand), exactly as written. place_in_united_states says whether "place" (B, not A) is in the United States. All three are null for other bases.
If the paragraph also says the order changed at some date (a vendor move), answer for the order BEFORE that change ("the order described above"). Ignore sentences about other kinds of dates (update dates, era dates, ISO dates).`;

export const DATE_RETURNS = {
  type: 'object', additionalProperties: false,
  required: ['basis', 'order', 'quote', 'example_numeric', 'example_meaning', 'same_as_system', 'moved_from', 'place', 'place_in_united_states'],
  properties: {
    basis: { type: 'string', enum: ['explicit', 'example', 'same_as_system', 'place'] }, order: { type: 'string', enum: ['dmy', 'mdy'] },
    quote: { type: 'string', minLength: 8, maxLength: 600 }, example_numeric: S(40), example_meaning: S(80), same_as_system: { type: 'string', enum: SYS_ENUM },
    moved_from: S(80), place: S(80), place_in_united_states: { type: ['boolean', 'null'] },
  },
};
const out = p => ({ $ref: `output.${p}` });
export const DATE_CHECKS = [
  { op: 'contains', left: { $ref: 'item.paragraph' }, right: out('quote') },
  { op: 'any', conditions: [{ op: 'ne', left: out('basis'), right: 'example' }, { op: 'all', conditions: [
    { op: 'contains', left: out('quote'), right: out('example_numeric') }, { op: 'contains', left: out('quote'), right: out('example_meaning') }] }] },
  { op: 'any', conditions: [{ op: 'ne', left: out('basis'), right: 'same_as_system' }, { op: 'all', conditions: [
    { op: 'ne', left: out('same_as_system'), right: 'none' }, { op: 'ne', left: out('same_as_system'), right: { $ref: 'item.system' } }, { op: 'contains', left: out('quote'), right: out('same_as_system') }] }] },
  { op: 'any', conditions: [{ op: 'ne', left: out('basis'), right: 'same_as_system' }, { op: 'ne', left: out('same_as_system'), right: 'LEDGR' }, { op: 'eq', left: out('order'), right: 'dmy' }] },
  { op: 'any', conditions: [{ op: 'ne', left: out('basis'), right: 'place' }, { op: 'all', conditions: [
    { op: 'contains', left: out('quote'), right: out('place') },
    { op: 'any', conditions: [{ op: 'eq', left: out('moved_from'), right: null }, { op: 'all', conditions: [
      { op: 'contains', left: out('quote'), right: out('moved_from') }, { op: 'ne', left: out('moved_from'), right: out('place') }] }] },
    { op: 'any', conditions: [{ op: 'all', conditions: [{ op: 'eq', left: out('place_in_united_states'), right: true }, { op: 'eq', left: out('order'), right: 'mdy' }] },
      { op: 'all', conditions: [{ op: 'eq', left: out('place_in_united_states'), right: false }, { op: 'eq', left: out('order'), right: 'dmy' }] }] }] }] },
];

export const SWITCH_INSTRUCTIONS = `You read the source-notes paragraph of the ATLAS ledger (input block "paragraph"). Some ATLAS installations changed how they write numeric birth dates on a given day (for example when the hosting vendor changed): rows last changed on or after that day use a different order. Decide whether this paragraph describes such a dated change.
Return:
- present: true only if the paragraph says numeric birth dates are written differently in rows changed on/after a certain date.
- quote: that sentence copied exactly, character for character (null if not present).
- switch_date: the date of the change exactly as written in that sentence, e.g. "5 May 2020" (null if not present). Other dates in the paragraph (for example the date ATLAS went live) are not the change date.
- after: how numeric birth dates are written in rows changed on/after the change: "swapped" (day and month the other way round from before), "day_first" or "month_first"; "none" if not present.
- boundary: "on_or_after" if rows changed ON that day already use the new order, "after" if only rows changed strictly later do; "none" if not present.`;

export const SWITCH_RETURNS = {
  type: 'object', additionalProperties: false, required: ['present', 'quote', 'switch_date', 'after', 'boundary'],
  properties: { present: { type: 'boolean' }, quote: S(800), switch_date: S(40), after: { type: 'string', enum: ['swapped', 'day_first', 'month_first', 'none'] },
    boundary: { type: 'string', enum: ['on_or_after', 'after', 'none'] } },
};
export const switchChecks = paragraphRef => [
  { op: 'any', conditions: [{ op: 'eq', left: out('present'), right: false }, { op: 'all', conditions: [
    { op: 'contains', left: { $ref: paragraphRef }, right: out('quote') }, { op: 'contains', left: out('quote'), right: out('switch_date') },
    { op: 'ne', left: out('after'), right: 'none' }, { op: 'ne', left: out('boundary'), right: 'none' }] }] },
];

export const STATUS_INSTRUCTIONS = `You read the source-notes paragraph of one legacy system (input block "paragraph") and one status value ("token") that occurs in that system's rows. Decide what the notes say about rows carrying this value: "void" (not a real account: excluded from the migration, dropped, left out) or "live" (a real account: kept and migrated). Labels can be misleading; only what the notes say counts.
Return:
- meaning: "void" or "live".
- relation / compared_with: if the notes define the value by comparison with one of the system's fixed markers, give the relation and that marker:
  relation "same_as" for "treat rows marked X exactly like Y" (X means the same as Y);
  relation "different_from" for "do not confuse X with Y" (X is NOT like Y);
  compared_with is Y, one of: "stage=customer", "ZZTEST", "aktiv", "gesperrt", "storniert", "DO NOT MIGRATE", "SAMPLE", "sandbox", "production", or "ordinary_live_rows" (ordinary member/customer rows). Otherwise relation "none" and compared_with "none".
- quote: the sentence about this value copied exactly, character for character, from the paragraph.
Fixed meanings for reference: stage=customer, aktiv, gesperrt and production are live; ZZTEST, storniert, DO NOT MIGRATE, SAMPLE and sandbox are void.`;

export const STATUS_RETURNS = {
  type: 'object', additionalProperties: false, required: ['meaning', 'relation', 'compared_with', 'quote'],
  properties: { meaning: { type: 'string', enum: ['void', 'live'] }, relation: { type: 'string', enum: ['same_as', 'different_from', 'none'] },
    compared_with: { type: 'string', enum: MARKER_ENUM }, quote: { type: 'string', minLength: 8, maxLength: 600 } },
};
export const STATUS_CHECKS = [
  { op: 'contains', left: { $ref: 'item.paragraph' }, right: out('quote') },
  { op: 'contains', left: out('quote'), right: { $ref: 'item.mention' } },
  { op: 'any', conditions: [
    { op: 'eq', left: out('relation'), right: 'none' },
    { op: 'all', conditions: [{ op: 'eq', left: out('relation'), right: 'same_as' }, { op: 'any', conditions: [
      { op: 'all', conditions: [{ op: 'in', left: out('compared_with'), right: VOID_MARKERS }, { op: 'eq', left: out('meaning'), right: 'void' }] },
      { op: 'all', conditions: [{ op: 'in', left: out('compared_with'), right: LIVE_MARKERS }, { op: 'eq', left: out('meaning'), right: 'live' }] }] }] },
    { op: 'all', conditions: [{ op: 'eq', left: out('relation'), right: 'different_from' }, { op: 'any', conditions: [
      { op: 'all', conditions: [{ op: 'in', left: out('compared_with'), right: VOID_MARKERS }, { op: 'eq', left: out('meaning'), right: 'live' }] },
      { op: 'all', conditions: [{ op: 'in', left: out('compared_with'), right: LIVE_MARKERS }, { op: 'eq', left: out('meaning'), right: 'void' }] }] }] }] },
];

export const MIRROR_INSTRUCTIONS = `You read the source-notes paragraph of one legacy system (input block "paragraph"; the system is named in "system"). Each row has an update date (updated / Geändert / ts). Decide whether the paragraph says this system's update dates are real change dates or not:
- "restamped": the dates are NOT real change dates; a copy job, mirror rebuild, restore from backup, migration to new hardware or re-import rewrote them (so they show copy/restore times).
- "real": the paragraph says the dates are real change dates (including "was restored once but the restore kept the original dates", or "is not a read-only mirror").
- "not_stated": the paragraph says nothing about whether its update dates are reliable.
Return update_dates and quote: the sentence that settles it, copied exactly, character for character (null for not_stated).`;

export const MIRROR_RETURNS = {
  type: 'object', additionalProperties: false, required: ['update_dates', 'quote'],
  properties: { update_dates: { type: 'string', enum: ['restamped', 'real', 'not_stated'] }, quote: S(800) },
};
export const MIRROR_CHECKS = [
  { op: 'any', conditions: [{ op: 'eq', left: out('update_dates'), right: 'not_stated' }, { op: 'contains', left: { $ref: 'item.paragraph' }, right: out('quote') }] },
  // Data cross-check only: a re-stamped system's update dates lie in its copy/restore window.
  { op: 'any', conditions: [{ op: 'ne', left: out('update_dates'), right: 'restamped' }, { op: 'lte', left: { $ref: 'item.spanDays' }, right: 120 }] },
];

export const PERSPECTIVE_INSTRUCTIONS = `You read the source-notes paragraph of one legacy system (input block "paragraph"; the system is named in "system"). Its rows print a balance (balance / Saldo / owed). The canonical master stores money the account holder owes US as a positive number and money WE owe them (a credit they hold with us) as a negative number. Decide what happens to a POSITIVE printed balance of this system in the master:
- positive_in_master: "positive" if the master keeps a positive printed figure positive (the printed figure is what they owe us: a receivable, an open invoice, unpaid orders, read literally); "negative" if it becomes negative (the printed figure is what we owe them: a credit, prepaid deposit, store credit, a payable; or the notes say the balances change sign / are printed the opposite way / must be flipped for the master).
- positive_printed_balance_means: "they_owe_us" (goes with "positive") or "we_owe_them" (goes with "negative"). A paragraph that only says the sign changes in the master means a positive printed figure is money we owe them.
- negative_printed_balance_means: what a NEGATIVE printed figure (one marked with a minus, parentheses, "CR" or "▲") means according to the paragraph: "they_owe_us" or "we_owe_them".
- master_span: the words of the paragraph that say what the MASTER does with this system's balances, copied exactly (for example a phrase saying the balance is negative or positive in the master, keeps its sign, changes sign, is flipped, is recorded with the opposite sign, or is printed the same way as the master); null if the paragraph says nothing about the master.
- quote: the sentence that settles it, copied exactly, character for character, from the paragraph.
Read the positive and the negative case separately: a sentence may describe the positive figure first and then say how negative figures are marked.`;

export const PERSPECTIVE_RETURNS = {
  type: 'object', additionalProperties: false, required: ['positive_in_master', 'positive_printed_balance_means', 'negative_printed_balance_means', 'master_span', 'quote'],
  properties: { positive_in_master: { type: 'string', enum: ['positive', 'negative'] }, positive_printed_balance_means: { type: 'string', enum: ['they_owe_us', 'we_owe_them'] },
    negative_printed_balance_means: { type: 'string', enum: ['they_owe_us', 'we_owe_them'] }, master_span: S(300),
    quote: { type: 'string', minLength: 8, maxLength: 600 } },
};
export const PERSPECTIVE_CHECKS = [
  { op: 'contains', left: { $ref: 'item.paragraph' }, right: out('quote') },
  { op: 'any', conditions: [
    { op: 'all', conditions: [{ op: 'eq', left: out('positive_printed_balance_means'), right: 'they_owe_us' }, { op: 'eq', left: out('positive_in_master'), right: 'positive' }] },
    { op: 'all', conditions: [{ op: 'eq', left: out('positive_printed_balance_means'), right: 'we_owe_them' }, { op: 'eq', left: out('positive_in_master'), right: 'negative' }] }] },
  // A negative printed figure always means the opposite of a positive one: equal answers expose a misattributed clause.
  { op: 'ne', left: out('positive_printed_balance_means'), right: out('negative_printed_balance_means') },
  // The master span is verbatim, and a span that says the sign changes cannot go with "positive" (nor "keeps" with
  // "negative"): a lexical sanity check on the model's own evidence that escalates a consistent but wrong reading.
  { op: 'any', conditions: [{ op: 'eq', left: out('master_span'), right: null }, { op: 'contains', left: { $ref: 'item.paragraph' }, right: out('master_span') }] },
  { op: 'any', conditions: [{ op: 'eq', left: out('master_span'), right: null }, { op: 'eq', left: out('positive_in_master'), right: 'negative' }, { op: 'not', condition: { op: 'any', conditions: [
    { op: 'all', conditions: [{ op: 'contains', left: out('master_span'), right: 'negative' }, { op: 'contains', left: out('master_span'), right: 'in the master' }] },
    { op: 'contains', left: out('master_span'), right: 'becomes negative' }, { op: 'contains', left: out('master_span'), right: 'opposite' },
    { op: 'contains', left: out('master_span'), right: 'flip' }, { op: 'contains', left: out('master_span'), right: 'change' }] } }] },
  { op: 'any', conditions: [{ op: 'eq', left: out('master_span'), right: null }, { op: 'eq', left: out('positive_in_master'), right: 'positive' }, { op: 'not', condition: { op: 'any', conditions: [
    { op: 'contains', left: out('master_span'), right: 'keep' }, { op: 'contains', left: out('master_span'), right: 'same way' }] } }] },
];

export const VENDEX_INSTRUCTIONS = `You read free-text entries of the VENDEX contact register, one entry per line ("Vendex <row id> — ..."). For EACH entry return one object with the row id and these fields. Text fields are spans copied EXACTLY, character for character, from the entry (do not reformat, translate or complete them):
- name: the person's name as written, including any title and middle initial (e.g. "Ms. Femke Visser", "Mattia M. Ferraro").
- birth_date: the birth date as written, without the words around it (e.g. "13 April 1988", "the 27th of April 1996", "June 12th, 1957", "5/9/1952", "21-Dec-58"); null if the entry has none or says it is unknown / not on file.
- revised: the date the entry was revised as written (for "Spoke with <name> on <date>" it is the call date; it may stand at the start, in the middle or at the end of the entry, e.g. "Revised on ...", "last revised ...", "Entry revised ..."); e.g. "19 March 2020", "08/03/2019", "June 13, 2019". Every entry has one.
- phone: the phone number as written (e.g. "+33 1 95 59 16 95", "02 563 30 11"); null if none.
- balance_text: the whole balance phrase as written, including the direction words and currency (e.g. "in credit by two hundred thirty-five euros and sixteen cents", "Balance due USD 50,042.72", "owes us fifty-eight US dollars and forty-three cents"); null if no balance is recorded.
- balance_kind: "owed_to_us" for "owes us", "open balance", "outstanding", "balance due"; "credit" for "in credit by", "holding a credit of", "credit balance of", "we owe them"; "none" if no balance.
- currency: "USD" for dollars, "EUR" for euros, "GBP" for pounds/pence, or the ISO code written; "none" if no balance.
- place_kind: how the entry says where the person is: "city", "country", "nationality" or "not_stated". Look everywhere in the entry: a word in parentheses right after the name ("(Amsterdam)", "(Norwegian)"), "based in ...", "a/an ... supplier" or "... contact" with a nationality adjective, or a "— ... —" segment after the name. "location not stated" means not_stated.
- place: that city, country or nationality as written (e.g. "Kelowna", "the UK", "Norwegian", "Italian supplier"); null if not stated.
- country: the ISO 3166-1 alpha-2 code of the country of that place (the country a city lies in; the country of a nationality; GB for the United Kingdom; when several cities share a name, the best-known, largest one); "none" if not stated. The input block "known_countries" lists the countries of this migration.
Ignore any staff remarks; they are not data about the person.`;

// Second, independent read of the same entries: other framing and field order, so that its omissions are not the
// first read's omissions (combined field by field in code).
export const VENDEX_B_INSTRUCTIONS = `You check free-text entries of the VENDEX contact register, one entry per line ("Vendex <row id> — ..."). Go through each entry from left to right and copy every field when you meet it. Copy spans EXACTLY, character for character; never reformat or complete them. For each entry return:
- row: its row id.
- revised: the revision date (every entry has one: "Entry revised <date>", "Revised on <date>", "last revised <date>", or the call date in "Spoke with <name> on <date>").
- name: the person's name with any title and middle initial.
- birth_date: the birth date without the words around it (after "b.", "born", "DOB", "date of birth", "Born"); null only if the entry gives none or says it is unknown / not on file.
- place_kind and place: where the person is, as written: a city, a country or a nationality ("(Oslo)", "(Norwegian)", "based in ...", "a Dutch supplier", "Swiss supplier", "— Geelong —"); place_kind "not_stated" and place null if nothing is stated ("location not stated").
- country: ISO 3166-1 alpha-2 code of that place (country of a city or nationality; GB for the United Kingdom; for a city name shared by several countries, the best-known, largest city); "none" if not stated. The block "known_countries" lists this migration's countries.
- phone: the phone number as written; null if none / not on file.
- balance_text: the whole balance phrase with its direction words and currency ("owes us ...", "open balance ...", "outstanding ...", "balance due ...", "in credit by ...", "holding a credit of ...", "credit balance of ...", "we owe them ..."); null if not recorded.
- balance_kind: "owed_to_us" or "credit" from those direction words; "none" if no balance.
- currency: "USD" for dollars, "EUR" for euros, "GBP" for pounds/pence, or the ISO code written; "none" if no balance.
Ignore staff remarks.`;

const VENDEX_ROW = {
  type: 'object', additionalProperties: false,
  required: ['row', 'name', 'birth_date', 'revised', 'phone', 'balance_text', 'balance_kind', 'currency', 'place_kind', 'place', 'country'],
  properties: {
    row: { type: 'integer' }, name: { type: 'string', maxLength: 120 }, birth_date: S(60), revised: { type: 'string', minLength: 4, maxLength: 60 }, phone: S(60), balance_text: S(200),
    balance_kind: { type: 'string', enum: ['owed_to_us', 'credit', 'none'] }, currency: { type: 'string', enum: ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'SEK', 'DKK', 'NOK', 'MXN', 'none'] },
    place_kind: { type: 'string', enum: ['city', 'country', 'nationality', 'not_stated'] }, place: S(80), country: { type: 'string', enum: ISO_ENUM },
  },
};
export const VENDEX_RETURNS = { type: 'object', additionalProperties: false, required: ['ids', 'rows'],
  properties: { ids: { type: 'array', items: { type: 'integer' }, maxItems: 20 }, rows: { type: 'array', items: VENDEX_ROW, maxItems: 20 } } };
const VENDEX_B_ORDER = ['row', 'revised', 'name', 'birth_date', 'place_kind', 'place', 'country', 'phone', 'balance_text', 'balance_kind', 'currency'];
const VENDEX_ROW_B = { ...VENDEX_ROW, required: VENDEX_B_ORDER, properties: Object.fromEntries(VENDEX_B_ORDER.map(k => [k, VENDEX_ROW.properties[k]])) };
export const VENDEX_B_RETURNS = { type: 'object', additionalProperties: false, required: ['ids', 'rows'],
  properties: { ids: { type: 'array', items: { type: 'integer' }, maxItems: 20 }, rows: { type: 'array', items: VENDEX_ROW_B, maxItems: 20 } } };

export const COUNTRY_INSTRUCTIONS = `Each numbered line is a country as written in a legacy system: an English or German country name, an official or local name, an alias or abbreviation, possibly with a typing error (a letter wrong, missing, extra or two letters swapped, e.g. "Itlay", "Swedn"). Watch confusable names (Austria/Australia, Schweiz = Switzerland / Schweden = Sweden, Irland = Ireland) and German abbreviations. The input block "known_countries" lists the countries of this migration with their codes; the country meant is almost always one of them.
For each line, in order, return in "names" the English name of the country meant, spelled exactly as in known_countries when it is listed there, and in "codes" its ISO 3166-1 alpha-2 code (GB for the United Kingdom); "other" only for a country that is not listed, "none" if the line names no country. Return the line numbers you processed, in order, in "ids". The three arrays have the same length and order.`;
export const COUNTRY_RETURNS = { type: 'object', additionalProperties: false, required: ['ids', 'names', 'codes'],
  properties: { ids: { type: 'array', items: { type: 'integer' }, maxItems: 40 }, names: { type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 40 },
    codes: { type: 'array', items: { type: 'string', enum: ISO_ENUM }, maxItems: 40 } } };

// ------------------------------------------------------------------------------------------------------------
export function buildRecordsV3Workflow({ extractModelClass = 'M', conventionsModelClass = 'M', maxClass = 'L', concurrency = 4, maxCost = 1, reasoning = 'none',
  vendexChunk = 5, countryChunk = 30 } = {}) {
  const notes = { name: 'paragraph', ref: 'item.paragraph', label: 'untrusted:notes', render: 'text' };
  const order = ['S', 'M', 'L', 'F'];
  // A failed consistency check is escalated at once (a resample of the same model can return a consistent but wrong
  // answer); at the top permitted class the only recovery left is one resample. VENDEX id-echo slips are resampled.
  const onFail = (id, modelClass) => (id === 'vendex' || order.indexOf(modelClass) >= order.indexOf(maxClass) ? 'resample' : 'escalate');
  const judge = (id, description, instructions, inputs, returns, checks, modelClass, maxTokens = 1200) => ({
    id: 'judge', kind: 'agent', needs: [], description, role: ['vendex', 'countries'].includes(id) ? 'extract' : 'classify', instructions,
    context: { inputs, budget: { maxInputTokens: 6000, onOverflow: 'fail' } },
    returns, model: { class: modelClass, maxClass }, decoding: { reasoning, maxTokens }, checks,
    escalation: { schemaRetries: 1, onCheckFail: onFail(id, modelClass), maxResamples: 1, maxEscalations: 2 }, timeoutMs: 300000,
  });
  const mapOf = (id, needs, description, itemsRef, body, maxItems = 40) => ({
    id, kind: 'map', needs, description, items: { $ref: itemsRef }, maxItems, concurrency, failure: 'collect',
    body: { nodes: [body], acceptance: [{ op: 'exists', value: { $ref: 'nodes.judge' } }] },
  });
  const systemInput = { name: 'system', ref: 'item.system', render: 'text' };
  const knownCountries = { name: 'known_countries', ref: 'item.known', label: 'untrusted:spec', render: 'text' };
  return {
    schemaVersion: '1.0', id: 'records-v3-hand', version: 1, title: 'Records migration v3 (hand-written)',
    goal: 'Merge messy legacy customer rows into one canonical record per real person, reading every per-task convention from the source notes and following the spec exactly.',
    domain: 'data',
    envelope: { assumptions: ['one export per task', 'bed records v3 dialects'], risks: ['prompt-injection lines inside rows', 'misread per-task conventions'], successCriteria: ['one record per real person with correct canonical fields'] },
    budget: { maxSteps: 4000, maxConcurrency: Math.max(concurrency, 1), maxDurationMs: 3600000, maxCost },
    inputSchema: { type: 'object', required: ['inputs'], properties: { inputs: { type: 'object' }, prompt: { type: 'string' } } },
    labels: { 'input.inputs.export': 'untrusted:export', 'input.inputs.source_notes': 'untrusted:notes', 'input.inputs.spec': 'untrusted:spec' },
    nodes: [
      { id: 'spec', kind: 'code', needs: [], description: 'Parse rate tables, calling codes and nicknames from the spec', lang: 'js', source: bundle(parseSpec),
        args: { spec: { $ref: 'input.inputs.spec' } }, timeoutMs: 20000 },
      { id: 'prep', kind: 'code', needs: ['spec'], description: 'Split rows, parse structured dialects, split notes, list status tokens and country strings', lang: 'js', source: bundle(prepMain),
        args: { export: { $ref: 'input.inputs.export' }, source_notes: { $ref: 'input.inputs.source_notes' }, iso2: { $ref: 'nodes.spec.iso2' }, countryList: { $ref: 'nodes.spec.countryList' }, vendexChunk, countryChunk }, timeoutMs: 30000 },
      mapOf('dates', ['prep'], 'Read the numeric date order of BRIGHTDESK, ATLAS and VENDEX from the notes', 'nodes.prep.dateItems',
        judge('dates', 'Numeric date order of this system', DATE_INSTRUCTIONS, [systemInput, notes], DATE_RETURNS, DATE_CHECKS, conventionsModelClass)),
      { ...judge('atlas_switch', 'Dated change of the ATLAS birth-date order', SWITCH_INSTRUCTIONS, [{ name: 'paragraph', ref: 'nodes.prep.atlasParagraph', label: 'untrusted:notes', render: 'text' }],
        SWITCH_RETURNS, switchChecks('nodes.prep.atlasParagraph'), conventionsModelClass), id: 'atlas_switch', needs: ['prep'], onError: 'continue' },
      mapOf('statuses', ['prep'], 'Read the meaning of each extra status value from the notes', 'nodes.prep.statusItems',
        judge('statuses', 'Meaning of this status value', STATUS_INSTRUCTIONS, [systemInput, { name: 'token', ref: 'item.mention', render: 'text' }, notes], STATUS_RETURNS, STATUS_CHECKS, conventionsModelClass)),
      mapOf('mirror', ['prep'], 'Read whether each candidate system\'s update dates are re-stamped', 'nodes.prep.mirrorItems',
        judge('mirror', 'Are this system\'s update dates real change dates?', MIRROR_INSTRUCTIONS, [systemInput, notes], MIRROR_RETURNS, MIRROR_CHECKS, conventionsModelClass)),
      mapOf('perspective', ['prep'], 'Read the balance perspective of BRIGHTDESK, LEDGR, ATLAS and KOBO', 'nodes.prep.perspectiveItems',
        judge('perspective', 'Which side this system prints balances from', PERSPECTIVE_INSTRUCTIONS, [systemInput, notes], PERSPECTIVE_RETURNS, PERSPECTIVE_CHECKS, conventionsModelClass)),
      mapOf('vendex', ['prep'], 'Read VENDEX free-text entries into verbatim spans', 'nodes.prep.vendexChunks',
        judge('vendex', 'Read these VENDEX entries', VENDEX_INSTRUCTIONS, [knownCountries, { name: 'entries', ref: 'item.lines', label: 'untrusted:export', render: 'text' }], VENDEX_RETURNS,
          [{ op: 'eq', left: out('ids'), right: { $ref: 'item.ids' } }], extractModelClass, 3000), 60),
      mapOf('vendex_b', ['prep'], 'Second, independent read of the VENDEX entries', 'nodes.prep.vendexChunks',
        judge('vendex', 'Read these VENDEX entries from left to right', VENDEX_B_INSTRUCTIONS, [knownCountries, { name: 'entries', ref: 'item.lines', label: 'untrusted:export', render: 'text' }], VENDEX_B_RETURNS,
          [{ op: 'eq', left: out('ids'), right: { $ref: 'item.ids' } }], extractModelClass, 3000), 60),
      mapOf('countries', ['prep'], 'Map country strings to ISO codes', 'nodes.prep.countryChunks',
        judge('countries', 'ISO code of each country as written', COUNTRY_INSTRUCTIONS, [knownCountries, { name: 'countries', ref: 'item.lines', label: 'untrusted:export', render: 'text' }], COUNTRY_RETURNS,
          // Every country of this bed is in the spec's table: "other" signals a misread name, so it is resampled/escalated.
          [{ op: 'eq', left: out('ids'), right: { $ref: 'item.ids' } }, { op: 'not', condition: { op: 'contains', left: out('codes'), right: 'other' } }], extractModelClass, 1500), 20),
      { id: 'merge', kind: 'code', needs: ['prep', 'spec', 'dates', 'atlas_switch', 'statuses', 'mirror', 'perspective', 'vendex', 'vendex_b', 'countries'],
        description: 'Apply the conventions and the spec: void rows, dates, signs, identity, conflicts, phones, FX', lang: 'js', source: bundle(mergeMain),
        args: {
          spec: { $ref: 'nodes.spec' }, rows: { $ref: 'nodes.prep.rows' },
          dateItems: { $ref: 'nodes.prep.dateItems' }, dates: { $ref: 'nodes.dates.items' }, atlasSwitch: { $ref: 'nodes.atlas_switch' },
          statusItems: { $ref: 'nodes.prep.statusItems' }, statuses: { $ref: 'nodes.statuses.items' },
          mirrorItems: { $ref: 'nodes.prep.mirrorItems' }, mirror: { $ref: 'nodes.mirror.items' },
          perspectiveItems: { $ref: 'nodes.prep.perspectiveItems' }, perspective: { $ref: 'nodes.perspective.items' },
          vendexChunks: { $ref: 'nodes.prep.vendexChunks' }, vendex: { $ref: 'nodes.vendex.items' }, vendexB: { $ref: 'nodes.vendex_b.items' },
          countryStrings: { $ref: 'nodes.prep.countryStrings' }, countryChunks: { $ref: 'nodes.prep.countryChunks' }, countries: { $ref: 'nodes.countries.items' },
        }, timeoutMs: 120000 },
      { id: 'check', kind: 'verify', needs: ['merge'], description: 'Structural invariants and convention consistency', method: 'code', lang: 'js', source: bundle(verifyMain),
        subject: { $ref: 'nodes.merge' }, independence: 'execution', gate: false, timeoutMs: 30000 },
      { id: 'answer', kind: 'code', needs: ['merge', 'check'], description: 'Emit the final answer', lang: 'js',
        source: 'export default function main(input) { return input.answer; }', args: { answer: { $ref: 'nodes.merge.answer' } }, timeoutMs: 10000 },
    ],
    acceptance: [{ op: 'exists', value: { $ref: 'nodes.answer.records' } }],
  };
}
