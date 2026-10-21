// code-checks verifier: shared text, number, date and world-index utilities.
//
// Everything here is generic: it reads a task prompt, an initial world and the agent's world diff the way a user's
// own automation could. No task names, no grader strings, no hidden assertions (PREREG-AB-v1 H7/H8). All world and
// prompt text is untrusted data; nothing here executes or follows it.

export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

// Keys whose values are bookkeeping, not content: ids, clocks, flags and rendering hints.
export const BOOKKEEPING_KEY = /^(id|uuid|thread_id|row_id|ts|date|internal_date|created_at|updated_at|created_date|last_modified_date|last_modified_date_time|sent_date_time|modified_at|timestamp|is_read|is_starred|has_attachments|label_ids|snippet|size_estimate|text_format_[a-z]+|timezone|is_bot|is_deleted|bot_name|user_id|reply_count|author_id|author_type|object|model|recipient_id|routing_order|status_code|likes_count|comments_count|shares_count|join_url|start_url|password|h323_password|pstn_password|encrypted_password|host_email|lifecycle_state|visibility|type|approval_type|registration_required|settings_[a-z_]+|all_day|conferencing|reminders__useDefault|recurring|guestsCanModify|eventType|calendarid|completed|private|channel|sender_type|part_type|is_private|is_channel|is_archived|is_general|channel_type|member_ids)$/;

// Update fields that never count as an effect on their own.
export const TRIVIAL_UPDATE_FIELD = /(^|\.)(updated_at|last_modified_date|last_modified_date_time|modified_at|is_read|label_ids|unread|read|last_activity_at|last_viewed_at|seen_at|waiting_since|snoozed_until)$/;

export const norm = s => String(s ?? '').normalize('NFKC').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
  .replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s+/g, ' ').trim();
export const lower = s => norm(s).toLowerCase();

/** All string leaves of a value as [path, string]; numbers become strings too (with numeric: true). */
export function leaves(v, path = '', out = [], { skipBookkeeping = false } = {}) {
  if (v === null || v === undefined) return out;
  if (typeof v === 'string') { if (v.length) out.push({ path, value: v }); return out; }
  if (typeof v === 'number' || typeof v === 'bigint') { out.push({ path, value: String(v), numeric: true }); return out; }
  if (typeof v === 'boolean') return out;
  if (Array.isArray(v)) { v.forEach((x, i) => leaves(x, `${path}[${i}]`, out, { skipBookkeeping })); return out; }
  if (typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (skipBookkeeping && BOOKKEEPING_KEY.test(k)) continue;
      leaves(x, path ? `${path}.${k}` : k, out, { skipBookkeeping });
    }
  }
  return out;
}

/** A string that may hold JSON (some action params carry JSON text): its parsed leaves, else itself. */
export function expandJsonText(s) {
  const t = String(s).trim();
  if ((t.startsWith('[') && t.endsWith(']')) || (t.startsWith('{') && t.endsWith('}'))) {
    try { return leaves(JSON.parse(t), '', [], { skipBookkeeping: true }).map(l => l.value); } catch { /* not JSON */ }
  }
  return [s];
}

export const stripHtml = s => String(s).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');

// ---------- dates ----------
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const monthIndex = m => MONTHS.findIndex(x => x.startsWith(m.toLowerCase().slice(0, 3)));
const iso = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null);

/** Calendar dates mentioned in a text, as ISO yyyy-mm-dd strings (ISO, "Month d, yyyy", "d Month yyyy", m/d/yyyy). */
export function datesIn(text) {
  const s = String(text), out = [];
  for (const m of s.matchAll(/\b(20\d\d)-(\d\d)-(\d\d)/g)) out.push(iso(+m[1], +m[2], +m[3]));
  for (const m of s.matchAll(new RegExp(`\\b${MON_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*[-\\u2013]\\s*\\d{1,2})?,?\\s+(20\\d\\d)\\b`, 'gi'))) out.push(iso(+m[3], monthIndex(m[1]) + 1, +m[2]));
  for (const m of s.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON_RE}\\.?,?\\s+(20\\d\\d)\\b`, 'gi'))) out.push(iso(+m[3], monthIndex(m[2]) + 1, +m[1]));
  for (const m of s.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(20\d\d)\b/g)) out.push(iso(+m[3], +m[1], +m[2]));
  return out.filter(Boolean);
}
export const dayNumber = isoDate => Math.floor(Date.parse(isoDate + 'T00:00:00Z') / 86400000);

/** The task's "today" as stated in the request ("Today is ...", "It's February 2026", "as of ..."), or null. */
export function promptToday(text) {
  const s = String(text);
  const m = s.match(/\btoday(?:'s date)? is\s+([^.\n]{4,40})/i) || s.match(/\bas of\s+([A-Z][a-z]+\.? \d{1,2},? 20\d\d|20\d\d-\d\d-\d\d)/);
  if (m) { const d = datesIn(m[1]); if (d.length) return d[0]; }
  const mm = s.match(new RegExp(`\\bit(?:'s| is)\\s+${MON_RE}\\s+(20\\d\\d)\\b`, 'i'));
  if (mm) return iso(+mm[2], monthIndex(mm[1]) + 1, 1);
  return null;
}

// ---------- numbers ----------
// Tokens that look like identifiers or clocks are removed before numbers are read (INV-2026-0452, 10:00, 2026-02-11).
const NOISE_RE = new RegExp([
  String.raw`\b20\d\d-\d\d-\d\d(?:[T ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?Z?)?`,
  String.raw`\b\d{1,2}:\d\d(?::\d\d)?\s*(?:am|pm|AM|PM)?`,
  String.raw`\b[A-Za-z]+[-_#]?\d[\w-]*`,
  String.raw`\b\d+[A-Za-z][\w-]*`,
  String.raw`[\w.+-]+@[\w.-]+`,
  String.raw`https?://\S+`,
  String.raw`\b\d{1,2}/\d{1,2}/20\d\d\b`,
  `${MON_RE}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s*-\\s*\\d{1,2})?(?:,?\\s+20\\d\\d)?`,
  String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+20\d\d`,
].join('|'), 'gi');
const NUM_RE = /(?<![\w.])(-?\$?-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\$?-?\d+(?:\.\d+)?)(%?)/g;

/** Numeric tokens of a text: {raw, value, money, percent, decimals}. */
export function numbersIn(text) {
  const s = String(text).replace(NOISE_RE, ' ');
  const out = [];
  for (const m of s.matchAll(NUM_RE)) {
    const raw = m[1] + m[2];
    const digits = m[1].replace(/[$,]/g, '');
    const value = Number(digits);
    if (!Number.isFinite(value)) continue;
    out.push({ raw, value, money: m[1].includes('$'), percent: m[2] === '%', decimals: (digits.split('.')[1] ?? '').length });
  }
  return out;
}

// ---------- world index ----------
/** Index of an initial world: its content strings, emails, ids, numbers, dates, channels and record collections. */
export function indexWorld(world, promptText = '') {
  const apps = Object.entries(world ?? {}).filter(([k]) => k !== 'meta');
  const all = [], content = [];
  for (const [app, v] of apps) {
    leaves(v, app, all);
    leaves(v, app, content, { skipBookkeeping: true });
  }
  const strings = new Set(), lowerStrings = new Set();
  for (const l of all) { strings.add(l.value); lowerStrings.add(lower(l.value)); }
  const contentText = content.map(l => l.value).join('\n');
  const blob = lower(contentText + '\n' + promptText);
  const emails = new Set([...(contentText + '\n' + all.map(l => l.value).join('\n') + '\n' + promptText).matchAll(EMAIL_RE)].map(m => m[0].toLowerCase()));
  const numbers = [];
  for (const l of content) {
    if (l.numeric) numbers.push({ raw: l.value, value: Number(l.value), money: false, percent: false, decimals: (l.value.split('.')[1] ?? '').length });
    else for (const t of expandJsonText(l.value)) numbers.push(...numbersIn(stripHtml(t)));
  }
  numbers.push(...numbersIn(promptText));
  const numberValues = new Set(numbers.map(n => round6(n.value)));
  const numberRaws = new Set(numbers.map(n => n.raw.replace(/^-?\$/, '')));
  const dates = new Set([...datesIn(contentText), ...datesIn(promptText)]);
  const channels = new Map();
  for (const c of world?.slack?.channels ?? []) channels.set(c.id, c.name ?? c.id);
  const collections = new Map();
  for (const [app, v] of apps) {
    if (!v || typeof v !== 'object') continue;
    for (const [coll, x] of Object.entries(v)) if (Array.isArray(x) && x.length && typeof x[0] === 'object') collections.set(`${app}.${coll}`, x);
  }
  const meta = world?.meta ?? {};
  return { strings, lowerStrings, blob, worldBlob: lower(contentText), promptLower: lower(promptText), emails, numbers, numberValues, numberRaws, dates, channels, collections, meta, promptText };
}
export const round6 = x => Math.round(x * 1e6) / 1e6;

/** Does a value appear in the world or prompt (exact string, or case-insensitive substring of the content blob)? */
export function knownInWorld(idx, value) {
  const v = String(value);
  if (idx.strings.has(v) || idx.lowerStrings.has(lower(v))) return true;
  return v.length >= 3 && idx.blob.includes(lower(v));
}
