// requirement-ledger-v2 verifier: text, number and world-index utilities.
//
// Generic by construction (PREREG-AB-v1 H7/H8): nothing here names a task, a grader check or a hidden assertion. All
// request and world text is untrusted data; nothing here executes or follows it. Kept self-contained (no imports from
// sibling verifier designs, which other agents edit) so a frozen version stays reproducible.

export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

export const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Text normal form for literal matching: diacritics dropped, NFKC, typographic quotes and dashes folded, whitespace collapsed, lower case. */
export const norm = s => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').normalize('NFKC').replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"')
  .replace(/[‐-―−]/g, '-').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

export const stripHtml = s => String(s ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');

export const emailsIn = s => [...new Set([...String(s ?? '').matchAll(EMAIL_RE)].map(m => m[0].toLowerCase()))];

// Keys that are bookkeeping rather than business content (ids, clocks, flags, rendering hints).
export const BOOKKEEPING_KEY = /^(id|uuid|thread_id|row_id|ts|internal_date|date|created_at|updated_at|created_date|last_modified_date|last_modified_date_time|sent_date_time|modified_at|timestamp|is_read|is_starred|has_attachments|label_ids|snippet|size_estimate|text_format_[a-z]+|timezone|is_bot|is_deleted|bot_name|user_id|reply_count|object|date_created|date_updated|date_sent|sid|account_sid|num_segments|api_version|uri|overwrite)$/;

// Update fields that only record that something was touched.
export const TOUCH_FIELD = /(^|\.)(updated_at|last_modified(_date|_time|_date_time)?|modified_at|modified_time|is_read|read|unread|label_ids|last_activity(_at)?|last_viewed(_at)?|seen_at|waiting_since|snoozed_until|updated_time|last_updated|statistics.*)$/;

/** String leaves of a value: [{path, value}] (numbers as strings). skipBookkeeping drops bookkeeping keys. */
export function leaves(v, path = '', out = [], { skipBookkeeping = false } = {}) {
  if (v === null || v === undefined) return out;
  if (typeof v === 'string') { if (v.length) out.push({ path, value: v }); return out; }
  if (typeof v === 'number' || typeof v === 'bigint') { out.push({ path, value: String(v), numeric: true }); return out; }
  if (typeof v === 'boolean') return out;
  if (Array.isArray(v)) { v.forEach((x, i) => leaves(x, `${path}[${i}]`, out, { skipBookkeeping })); return out; }
  if (typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (skipBookkeeping && BOOKKEEPING_KEY.test(k)) continue; leaves(x, path ? `${path}.${k}` : k, out, { skipBookkeeping }); }
  return out;
}

/** A string that holds JSON (some action params carry JSON text) expands to its leaves' text. */
export function expandJsonText(s) {
  const t = String(s).trim();
  if ((t.startsWith('[') && t.endsWith(']')) || (t.startsWith('{') && t.endsWith('}'))) {
    try { return leaves(JSON.parse(t)).map(l => l.value).join('\n'); } catch { /* not JSON */ }
  }
  return String(s);
}

/** All content text of a value (for literal search): string leaves, JSON text expanded, HTML stripped. */
export function contentText(v, { skipBookkeeping = true } = {}) {
  return leaves(v, '', [], { skipBookkeeping }).map(l => stripHtml(expandJsonText(l.value))).join('\n');
}

// ---------- numbers ----------
const NUM_RE = /(?<![\w.])-?\$?\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\w])/g;
/** Numeric values in a text (money and grouping removed). */
export function numbersIn(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(NUM_RE)) { const v = Number(m[1].replace(/,/g, '')); if (Number.isFinite(v)) out.push(v); }
  return out;
}
/** A literal that is a single number, possibly with currency, grouping or percent ("$8,400", "12.5%", "1,250.00"). */
export function numericLiteral(s) {
  const t = String(s ?? '').trim();
  const m = /^(?:[A-Z]{3}\s?)?[-−]?[$€£¥]?\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(%|[A-Z]{3})?$/.exec(t);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

/** Does `text` contain `literal`? Normalized substring; a numeric literal also matches an equal number in the text; a
 *  person's name also matches by first name. -> 'exact' | 'numeric' | 'first-name' | null */
export function containsLiteral(text, literal, { person = false } = {}) {
  const t = norm(text), l = norm(literal);
  if (!l) return 'exact';
  if (t.includes(l)) {
    // a literal that starts or ends with a letter or digit must not match inside a longer word or number ("hr" in "three")
    const re = new RegExp(`${/^[a-z0-9]/.test(l) ? '(?<![a-z0-9])' : ''}${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${/[a-z0-9]$/.test(l) ? '(?![a-z0-9])' : ''}`);
    if (re.test(t)) return 'exact';
  }
  const n = numericLiteral(literal);
  if (n !== null && numbersIn(text).some(x => Math.abs(x - n) < 1e-9)) return 'numeric';
  // a person's full name (the grounding step marks names that the world's own people records or addresses show to be a
  // person's) is matched by the first name as a whole word: people are addressed by first name in messages
  if (person) {
    const first = norm(String(literal).trim().split(/\s+/)[0]);
    if (first.length >= 3 && new RegExp(`(?<![a-z0-9])${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`).test(t)) return 'first-name';
  }
  return null;
}

// ---------- verbatim spans (grounding) ----------
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The span of `quote` inside `text` (case-insensitive; any whitespace run matches any run; typographic quotes and dashes
 *  fold). Returns the original substring, or null. */
export function findSpan(quote, text) {
  const q = String(quote ?? '').trim();
  if (!q || q.length > 3000) return null;
  const fold = s => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-');
  const tokens = fold(q).split(/\s+/).filter(Boolean).map(w => esc(w).replace(/'/g, "['‘’]").replace(/"/g, '["“”]').replace(/-/g, '[-–—]'));
  if (!tokens.length) return null;
  const m = new RegExp(tokens.join('\\s+'), 'i').exec(String(text ?? ''));
  return m ? m[0] : null;
}
/** A quote is grounded when it occurs (findSpan) in the text, or when its normalized form does (after dropping ellipses
 *  a model may insert between two exact pieces, each piece must occur). */
export function grounded(quote, text) {
  if (findSpan(quote, text) !== null) return true;
  const pieces = String(quote ?? '').split(/\s*(?:\.\.\.|…)\s*/).map(s => s.trim()).filter(s => s.length >= 4);
  return pieces.length > 1 && pieces.every(p => findSpan(p, text) !== null);
}

// ---------- world index ----------
/** The record id a pointer uses: id, else row_id, else ts, else the position. */
export const recordKey = (rec, i) => (rec && (rec.id ?? rec.row_id ?? rec.ts ?? rec.uuid)) ?? `#${i}`;

/** Every record of a world as {ptr: 'app.coll:id', app, coll, id, record, text}. Nested collections one level down
 *  (app.coll.sub) are included. meta is skipped (simulator bookkeeping the agent cannot read). */
export function indexWorld(world) {
  const recs = [];
  for (const [app, colls] of Object.entries(world ?? {})) {
    if (app === 'meta' || !isObj(colls)) continue;
    for (const [coll, x] of Object.entries(colls)) {
      const list = Array.isArray(x) ? x : isObj(x) && Object.values(x).every(isObj) ? Object.values(x) : null;
      if (!list) continue;
      list.forEach((rec, i) => {
        if (!isObj(rec)) return;
        const id = String(recordKey(rec, i));
        recs.push({ ptr: `${app}.${coll}:${id}`, app, coll, id, record: rec, text: contentText(rec, { skipBookkeeping: false }) });
      });
    }
  }
  // Long opaque ids (uuids, hex) get short aliases (x1, x2, ...) for the model's view: fewer tokens, fewer copy errors.
  let k = 0;
  for (const r of recs) if (/^[0-9a-f-]{20,}$/i.test(r.id)) { r.alias = `x${++k}`; r.aliasPtr = `${r.app}.${r.coll}:${r.alias}`; }
  const byPtr = new Map(recs.map(r => [r.ptr, r]));
  for (const r of recs) if (r.aliasPtr) byPtr.set(r.aliasPtr, r);
  const byId = new Map();
  for (const r of recs) for (const id of [r.id, r.alias].filter(Boolean)) { if (!byId.has(id)) byId.set(id, []); byId.get(id).push(r); }
  const channels = (world?.slack?.channels ?? []).filter(isObj).map(c => ({ id: String(c.id ?? ''), name: String(c.name ?? '') }));
  const allText = recs.map(r => r.text).join('\n');
  return { recs, byPtr, byId, channels, allText, emails: new Set(emailsIn(allText)) };
}

/** Resolve a pointer the model wrote ("app.coll:id", "[app.coll:id]", "app:coll:id", a bare id) to a record of the index. */
export function resolvePtr(ptr, idx) {
  const s = String(ptr ?? '').trim().replace(/^\[|\]$/g, '');
  if (!s) return null;
  if (idx.byPtr.has(s)) return idx.byPtr.get(s);
  const m = /^([a-z0-9_]+)[.:]([A-Za-z0-9_.]+?)[:/](.+)$/.exec(s);
  if (m) { const p = `${m[1]}.${m[2]}:${m[3]}`; if (idx.byPtr.has(p)) return idx.byPtr.get(p); const c = idx.byId.get(m[3]); if (c?.length === 1) return c[0]; }
  const c = idx.byId.get(s);
  return c?.length === 1 ? c[0] : null;
}

/** Map a record of one world to the same record of another prepare of the same task. Prepares draw fresh setup ids and
 *  setup-clock timestamps, so records are matched by content: same app and collection, then the most equal non-id,
 *  non-clock fields (sheet rows: same spreadsheet, worksheet and row number first). */
export function remapRecord(rec, dstIdx) {
  if (!rec) return null;
  const same = dstIdx.byPtr.get(rec.ptr);
  if (same && contentText(same.record) === contentText(rec.record)) return same;
  const cands = dstIdx.recs.filter(r => r.app === rec.app && r.coll === rec.coll);
  const a = rec.record;
  if (a.spreadsheet_id !== undefined && a.row_id !== undefined) {
    const hit = cands.find(r => r.record.spreadsheet_id === a.spreadsheet_id && r.record.worksheet_id === a.worksheet_id && r.record.row_id === a.row_id);
    if (hit) return hit;
  }
  const fields = x => new Map(leaves(x, '', [], { skipBookkeeping: true }).filter(l => !/(^|\.)(created_at|updated_at|.*_date|.*_time)$/.test(l.path)).map(l => [l.path, l.value]));
  const fa = fields(a);
  let best = null, bestScore = 0;
  for (const r of cands) {
    const fb = fields(r.record);
    let eq = 0;
    for (const [k, v] of fa) if (fb.get(k) === v) eq++;
    const score = eq / Math.max(1, Math.max(fa.size, fb.size));
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return bestScore >= 0.6 ? best : same ?? null;
}

/** Is this literal a person's name in this world? Two or three words, and an address local part or a first/last name
 *  record field pair in the world carries its first and last word. */
export function isPersonName(literal, idx) {
  const words = norm(literal).split(' ').filter(Boolean);
  if (words.length < 2 || words.length > 3 || words.some(w => !/^[a-z'.-]+$/.test(w))) return false;
  const first = words[0], last = words.at(-1).replace(/[.']/g, '');
  if (first.length < 2 || last.length < 2) return false;
  for (const e of idx.emails) { const local = e.split('@')[0]; if (local.includes(last) && (local.includes(first) || local.startsWith(first[0]))) return true; }
  return idx.recs.some(r => norm(r.record.first_name ?? r.record.firstName ?? '') === first && norm(r.record.last_name ?? r.record.lastName ?? '') === words.at(-1));
}

export const sha = async s => (await import('node:crypto')).createHash('sha256').update(String(s)).digest('hex');
