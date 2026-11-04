// Value typing for arm A1-C v2 (harness/v2/codeowned.mjs), mechanism M3 of research/automationbench-20261014/A1C-V2-DESIGN.md.
// A literal a ledger reader quoted is a VALUE only when it has the shape of one: an address, an id, an amount, a date,
// wording a source puts in quotes (or names as exact wording), or a short phrase. Instruction sentences ("clauses") and
// template placeholders ("slots") are not values: a slot is filled from the record it stands for, or demoted; a clause is
// never a check literal (the requirement's statement keeps it). Thresholds are frozen in PIPELINE_DEFAULTS (clauseWords,
// clauseLenRatio, clauseMinChars) before any scoring. Pure functions: no I/O, no task content.

export const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const EMAIL_ONLY = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/;
export const norm = s => String(s ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
const words = s => String(s ?? '').split(/\s+/).filter(Boolean);
const contentWords = s => new Set(norm(s).split(/[^a-z0-9@._-]+/).filter(w => w.length > 2));

// ---------------------------------------------------------------------------------------------------------------
// Slots (template placeholders) and alternatives

export const SLOT_RE = /<[^<>]{1,40}>|\[[^[\]]{1,40}\]|\{[^{}]{1,40}\}|\b[Xx](\.[Xx])+\b|\bX{2,}\b|_{3,}/;
// A run of <= 3 alternatives joined by "or" or "/" ("Approved/Rejected", "Yes or No"); each alternative a word of >= 2 letters.
const ALT_RE = /^\s*([A-Za-z][A-Za-z'-]+)(?:\s*(?:\/|\s+or\s+)\s*([A-Za-z][A-Za-z'-]+))(?:\s*(?:\/|\s+or\s+)\s*([A-Za-z][A-Za-z'-]+))?\s*$/i;
export function slotOf(value) {
  const v = String(value ?? '').trim();
  const alt = ALT_RE.exec(v);
  if (alt) return { kind: 'alternatives', options: alt.slice(1).filter(Boolean) };
  const m = SLOT_RE.exec(v);
  if (!m) return null;
  const whole = m[0].length === v.length;
  const inner = m[0].replace(/^[<[{]|[>\]}]$/g, '').trim();
  return { kind: whole ? 'placeholder' : 'template', inner: /^[Xx._]+$/.test(inner) ? '' : inner };
}

// ---------------------------------------------------------------------------------------------------------------
// Numbers and dates (tolerant comparison)

const CUR = '(?:[$€£¥]|USD|EUR|GBP|CAD|AUD)';
const NUM_FULL = new RegExp(`^\\(?\\s*([-+−])?\\s*${CUR}?\\s*([-+−])?\\s*(\\d{1,3}(?:,\\d{3})+|\\d+)(\\.\\d+)?\\s*(%|${CUR})?\\s*\\)?$`, 'i');
/** A number written as an amount, count or percentage ("1000", "1,000", "$1,000.00", "-5,200", "(5,200)", "18.5%") or null. */
export function parseNumber(s) {
  const t = String(s ?? '').trim();
  if (!t || t.length > 40) return null;
  const m = NUM_FULL.exec(t);
  if (!m) return null;
  const n = Number(`${m[3].replace(/,/g, '')}${m[4] ?? ''}`);
  if (!Number.isFinite(n)) return null;
  const neg = Boolean(m[1] || m[2]) || (/^\(/.test(t) && /\)$/.test(t));
  return neg ? -n : n;
}
const NUM_IN_TEXT = /\(?[-+−]?\s?(?:[$€£¥]\s?)?\d{1,3}(?:,\d{3})+(?:\.\d+)?\)?|\(?[-+−]?(?:[$€£¥]\s?)?\d+(?:\.\d+)?\)?/g;
export const numbersIn = text => [...String(text ?? '').matchAll(NUM_IN_TEXT)].map(m => parseNumber(m[0].trim())).filter(n => n !== null);
export const sameNumber = (a, b) => a !== null && b !== null && Math.abs(a - b) < 0.005;

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?';
const monthNo = s => MONTHS.findIndex(m => m.startsWith(String(s).toLowerCase().replace(/\.$/, '').slice(0, 3))) + 1;
const pad = n => String(n).padStart(2, '0');
const ymd = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2200 ? `${y}-${pad(m)}-${pad(d)}` : null);
const DATE_PATTERNS = [
  [/\b(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?/g, m => ymd(+m[1], +m[2], +m[3])],
  [new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'), m => ymd(+m[3], monthNo(m[1]), +m[2])],
  [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON},?\\s+(\\d{4})\\b`, 'gi'), m => ymd(+m[3], monthNo(m[2]), +m[1])],
  [/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, m => ymd(+m[3], +m[1], +m[2])],
];
export const MACHINE_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const EPOCH = /^\d{10}(\d{3})?(\.\d+)?$/;
/** The day ('YYYY-MM-DD') a value names: ISO date or datetime, "Month D, YYYY", "D Month YYYY", "MM/DD/YYYY", epoch
 * seconds or milliseconds (as a whole value). null otherwise. */
export function parseDay(s) {
  const t = String(s ?? '').trim();
  if (!t || t.length > 60) return null;
  if (EPOCH.test(t)) { const n = Number(t); const ms = n > 1e11 ? n : n * 1000; const d = new Date(ms); return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null; }
  for (const [re, f] of DATE_PATTERNS) { re.lastIndex = 0; const m = re.exec(t); if (m && m[0].trim().length >= t.replace(/[.,]+$/, '').length - 1) return f(m); }
  return null;
}
export function daysIn(text) {
  const out = new Set();
  for (const [re, f] of DATE_PATTERNS) { re.lastIndex = 0; for (const m of String(text ?? '').matchAll(re)) { const d = f(m); if (d) out.add(d); } }
  return out;
}
export const isMachineValue = v => MACHINE_DATETIME.test(String(v ?? '').trim()) || EPOCH.test(String(v ?? '').trim());

/** Does `text` carry `lit`? Numbers compare as numbers, dates by day across formats, everything else as normalized text. */
export function hasValue(text, lit) {
  const t = String(text ?? ''), l = String(lit ?? '');
  // A number is matched as a number (so "1,000" is not found inside "21,000"); a date by its day or its exact text.
  const n = parseNumber(l);
  if (n !== null) return numbersIn(t).some(x => sameNumber(x, n));
  if (norm(t).includes(norm(l))) return true;
  const d = parseDay(l);
  if (d) return daysIn(t).has(d);
  return false;
}
/** Is a field value equal to an expected value? Numbers as numbers, dates by day, else normalized text. */
export function sameValue(a, b) {
  const na = parseNumber(a), nb = parseNumber(b);
  if (na !== null && nb !== null) return sameNumber(na, nb);
  const da = parseDay(a), db = parseDay(b);
  if (da && db) return da === db;
  return norm(a) === norm(b);
}
/** The grouping key two readers' values share when they name the same value ("1,000" and "1000"). */
export function valueKey(v) {
  const n = parseNumber(v);
  if (n !== null) return `n:${Math.round(n * 1000) / 1000}`;
  const d = parseDay(v);
  if (d && String(v).trim().length <= 40) return `d:${d}`;
  return `t:${norm(v)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Quoted wording, clauses, ids

const QUOTED_SEG = /["“«]([^"”»\n]{1,500})["”»]/g;
const CUE = /\b(subject|titled|title|named|called|label(?:l)?ed|with the (?:words|phrase|text)|the phrase|verbatim|exactly|reads)\b/gi;
/** Is the span of `value` in `sourceText` exact wording: inside quote marks, or within 40 characters after a cue? */
export function quotedIn(value, sourceText) {
  const t = String(sourceText ?? ''), v = String(value ?? '').trim();
  if (!v || !t) return false;
  const at = spanIndex(v, t);
  if (!at) return false;
  for (const m of t.matchAll(QUOTED_SEG)) { const s = m.index + 1, e = s + m[1].length; if (at.start >= s && at.end <= e) return true; }
  CUE.lastIndex = 0;
  for (const m of t.slice(Math.max(0, at.start - 80), at.start).matchAll(CUE)) {
    const cueEnd = Math.max(0, at.start - 80) + m.index + m[0].length;
    if (at.start - cueEnd <= 40 && at.start >= cueEnd) return true;
  }
  return false;
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The [start, end) of `value` in `text` (case-insensitive; any whitespace run matches any run; typographic quotes fold). */
export function spanIndex(value, text) {
  const fold = s => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-');
  const toks = fold(String(value ?? '').trim()).split(/\s+/).filter(Boolean).map(w => esc(w).replace(/'/g, "['‘’]").replace(/"/g, '["“”]').replace(/-/g, '[-–—]'));
  if (!toks.length || String(value).length > 2000) return null;
  const m = new RegExp(toks.join('\\s+'), 'i').exec(String(text ?? ''));
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

export const IMPERATIVES = Object.freeze(['send', 'post', 'create', 'update', 'include', 'notify', 'make', 'ensure', 'add', 'mark', 'set', 'use', 'copy', 'reply', 'email', 'schedule', 'assign', 'flag', 'move', 'tag', 'log', 'record', 'remove', 'delete', 'close', 'escalate', 'follow']);
const MODAL = /\b(must|should|shall|please|needs? to|make sure)\b/i;
const SENTENCE_BREAK = /[.!?;]\s+\S/;
const ID_RE = /^(?=[^\s]*[\d_#:/-])[A-Za-z0-9#][\w.:#/-]{1,63}$/;

/**
 * Why a literal is an instruction clause rather than a value (null when it is not one).
 * o: { statement, recordField, columnValues, clauseWords, clauseLenRatio, clauseMinChars }.
 */
export function clauseReason(value, { statement = '', recordField = false, columnValues = null, clauseWords = 9, clauseLenRatio = 3, clauseMinChars = 40 } = {}) {
  const v = String(value ?? '').trim();
  const w = words(v);
  if (w.length >= clauseWords) return `${w.length} words`;
  if (SENTENCE_BREAK.test(v)) return 'internal sentence break';
  if (IMPERATIVES.includes(w[0]?.toLowerCase().replace(/[^a-z]/g, ''))) return `imperative "${w[0]}"`;
  if (MODAL.test(v)) return 'modal';
  const sw = contentWords(statement);
  // A restatement of the requirement (guard: a phrase of >= 5 words; a short value can share words with a short statement).
  if (w.length >= 5 && sw.size) { const lw = contentWords(v); let i = 0; for (const x of sw) if (lw.has(x)) i += 1; if (i / sw.size >= 0.6) return 'restates the requirement'; }
  if (recordField && v.length > clauseMinChars && Array.isArray(columnValues)) {
    const longest = Math.max(0, ...columnValues.map(x => String(x ?? '').length));
    if (v.length > clauseLenRatio * longest) return `longer than ${clauseLenRatio}x the column's longest value (${longest})`;
  }
  return null;
}

/**
 * valueType(value, ctx) -> { type, accepted, reason?, slot?, machine? }.
 * type: slot | quoted | email | number | date | id | short | clause | empty. accepted: email, id, number, date, quoted, short.
 * ctx: { sourceText (the cited source's text), statement, recordField, columnValues, clauseWords, clauseLenRatio, clauseMinChars }.
 */
export function valueType(value, ctx = {}) {
  const v = String(value ?? '').trim();
  if (!v) return { type: 'empty', accepted: false, reason: 'empty' };
  const slot = slotOf(v);
  if (slot) return { type: 'slot', accepted: false, reason: slot.kind, slot };
  if (quotedIn(v, ctx.sourceText)) return { type: 'quoted', accepted: true };
  if (EMAIL_ONLY.test(v)) return { type: 'email', accepted: true };
  if (parseNumber(v) !== null) return { type: 'number', accepted: true };
  if (parseDay(v)) return { type: 'date', accepted: true, machine: isMachineValue(v) };
  const clause = clauseReason(v, ctx);
  if (clause) return { type: 'clause', accepted: false, reason: clause };
  if (ID_RE.test(v)) return { type: 'id', accepted: true };
  if (words(v).length <= 8) return { type: 'short', accepted: true };
  return { type: 'clause', accepted: false, reason: 'long text' };
}

// ---------------------------------------------------------------------------------------------------------------
// Records: identifying values, slot filling, human renderings of machine dates

export const IDENTIFYING_KEYS = Object.freeze(['name', 'Name', 'full_name', 'title', 'subject', 'company', 'email', 'id']);
/** A record's identifying value: the first of name, Name, full_name, title, subject, company, email, id (>= 3 characters). */
export function identifyingValue(data) {
  for (const k of IDENTIFYING_KEYS) {
    const v = data?.[k];
    if ((typeof v === 'string' || typeof v === 'number') && String(v).trim().length >= 3) return String(v).trim();
  }
  return null;
}
const keyTokens = k => String(k).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const scalarFields = (data, depth = 0, out = []) => {
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' || typeof v === 'number') out.push([k, String(v)]);
    else if (v && typeof v === 'object' && !Array.isArray(v) && depth < 1) scalarFields(v, depth + 1, out);
  }
  return out;
};
/** Fill a slot from a record: a placeholder from the field its words name; alternatives from the one option the record
 * holds. -> { value, field } or null. */
export function fillSlot(slot, data) {
  if (!slot || !data) return null;
  const fields = scalarFields(data).filter(([, v]) => v.trim() && v.length <= 160);
  if (slot.kind === 'alternatives') {
    const hits = slot.options.filter(o => fields.some(([, v]) => norm(v) === norm(o)));
    return hits.length === 1 ? { value: hits[0], field: fields.find(([, v]) => norm(v) === norm(hits[0]))[0] } : null;
  }
  if (slot.kind !== 'placeholder' || !slot.inner) return null;
  const want = keyTokens(slot.inner);
  let best = null;
  for (const [k, v] of fields) {
    const kt = keyTokens(k);
    const common = want.filter(t => kt.includes(t)).length;
    if (!common) continue;
    const score = common / Math.max(want.length, kt.length) + (kt.join(' ') === want.join(' ') ? 1 : 0);
    if (!best || score > best.score) best = { score, value: v, field: k };
  }
  return best ? { value: best.value, field: best.field } : null;
}
/** A human rendering of a machine date found in the same record's text (same day, a non-ISO format), or null. */
export function humanRendering(value, recordText) {
  const day = parseDay(value);
  if (!day) return null;
  for (const [re, f] of DATE_PATTERNS.slice(1)) {
    re.lastIndex = 0;
    for (const m of String(recordText ?? '').matchAll(re)) if (f(m) === day) return m[0];
  }
  return null;
}
