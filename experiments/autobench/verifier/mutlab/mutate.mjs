// Move 4 (ATTACK §6, D28): trajectory mutants. Pure functions over a stored call log; no I/O, no model.
//
// A call log is the bridge's calls.jsonl read as  steps = [{calls: [{name, arguments (JSON text), orig (stored result
// text, or null)}]}].  Every operator returns {op, cls, intended, note, steps} or null when it does not apply, and never
// changes its input. The official AutomationBench rubric labels each mutant afterwards (replay_batch.py), at $0.
//
// Operators are GENERIC (PREREG-AB-v1 H7/H8): they act on HTTP method, URL, JSON body shape, e-mail addresses, numbers
// and free text, never on a task name, a grader string or a hidden assertion. `intended` is what the edit is meant to
// do to a correct run ("wrong" or "equivalent"); the official grade is the label, and the two are reported side by side
// (a duplicate or an extra write the grader tolerates is "intended wrong, officially passing").
//
// v2 (review, 2026-11-04): dup_write repeats only a SEND or a CREATE (writeKind; v1's isCreate took any POST, so update-like
// POSTs such as modify/label/mark/addTag were "duplicated" too: a repeat of an idempotent update is not a duplicate effect);
// perturb_number moves the last digit of a non-integer number by one (v1 scaled it by 1.1, not a one-digit change); and the
// "add a forbidden row" mutation ATTACK §6 Move 4 lists is built (extra_create: one more send/create, addressed to an
// entity of the initial world the run never referenced). v1 numbers are superseded.
import { createHash } from 'node:crypto';

export const MUTATE_VERSION = 'mutlab-mutate-v2';

export const OPS = Object.freeze({
  drop_write: { cls: 'omission', intended: 'wrong' },
  drop_tail: { cls: 'omission', intended: 'wrong' },
  swap_recipient: { cls: 'misdirection', intended: 'wrong' },
  perturb_number: { cls: 'content', intended: 'wrong' },
  blank_text: { cls: 'content', intended: 'wrong' },
  extra_write: { cls: 'over-action', intended: 'wrong' },
  dup_write: { cls: 'duplicate', intended: 'wrong' },
  extra_create: { cls: 'forbidden-row', intended: 'wrong' },
  drop_reads: { cls: 'equivalent', intended: 'equivalent' },
  reword: { cls: 'equivalent', intended: 'equivalent' },
  noop: { cls: 'omission', intended: 'wrong' },
});

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const RECIPIENT_KEY = /^(to|cc|bcc|recipient|recipients|to_email|to_emails|email|emails|attendees|guests|signers|invitees|participants|assignee_email|contact_email|customer_email|requester_email)$/i;
const PHONE_KEY = /^(to|phone|phone_number|mobile|to_number)$/i;
const TEXT_KEY = /^(text|body|message|description|notes?|comment|content|html|body_plain|body_html|summary|details)$/i;
const READ_PATH = /(\/search|:find|\/query|\/list|batchGet|\/lookup)(\/|$|\?)/i;
const WRITE_TOOL = /(send|create|update|post|delete|add|remove|append|patch|put|reply|tag|archive|mark|insert|move|assign)/i;
const READ_TOOL = /(get|list|search|find|query|history|batchget|lookup|fetch_|read)/i;
// A figure worth perturbing: grouped or decimal numbers, money, or integers of two or more digits that are not part of
// a date, a time, an id, an address, a URL or a phone number.
const FIGURE_RE = /(?<![\w./:@+-])(\$\s?)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|\d{2,})(?![\w/:@-]|\.\d)/g;

export const clone = x => JSON.parse(JSON.stringify(x));
export const seededRank = (seed, s) => createHash('sha256').update(`${seed}\n${s}`).digest('hex');

export function parseArgs(call) {
  if (typeof call.arguments !== 'string') return call.arguments ?? null;
  try { return JSON.parse(call.arguments); } catch { return null; }
}

/** api_fetch -> {method, url, params, body (object | string | null)} with the body JSON-decoded when it is JSON text. */
export function fetchOf(call) {
  if (call.name !== 'api_fetch') return null;
  const a = parseArgs(call);
  if (!a || typeof a !== 'object') return null;
  let body = a.body;
  let bodyWasText = false;
  if (typeof body === 'string') { try { body = JSON.parse(body); bodyWasText = true; } catch { /* plain text body */ } }
  return { ...a, body, bodyWasText };
}

function withFetch(call, f) {
  const { bodyWasText, ...a } = f;
  const out = { ...a };
  if (bodyWasText && out.body !== null && typeof out.body === 'object') out.body = JSON.stringify(out.body);
  return { ...call, arguments: JSON.stringify(out) };
}

/** Does a call change the world? Reads: GET, search/find/query/list POSTs, GraphQL queries without a mutation, helper tools. */
export function isWrite(call) {
  if (call.name === 'api_search' || call.name === 'base64_encode') return false;
  const f = fetchOf(call);
  if (f) {
    const m = String(f.method ?? 'GET').toUpperCase();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
    let path = '';
    try { path = new URL(f.url).pathname; } catch { path = String(f.url ?? ''); }
    if (READ_PATH.test(path)) return false;
    if (/graphql/i.test(path)) {
      const q = typeof f.body === 'object' && f.body ? String(f.body.query ?? '') : String(f.body ?? '');
      return /\bmutation\b/i.test(q);
    }
    return true;
  }
  return WRITE_TOOL.test(call.name) && !READ_TOOL.test(call.name.split('.').pop());
}

// The last path segment of a write names what it does: an action on an existing record (update-like), a send, or a create
// (a POST to a collection). Generic HTTP and REST vocabulary only.
const UPDATE_SEG = /^(modify|batchmodify|update|batchupdate|patch|labels?|tags?|mark|markas\w*|trash|untrash|archive|unarchive|move|assign|unassign|close|reopen|complete|star|unstar|read|unread|status|approve|reject|cancel|resolve|merge|watch|unwatch|pin|unpin|snooze|(add|remove|set|clear|update)[A-Z_-]?\w*)$/i;
const SEND_SEG = /^(send|reply|replyall|forward|post|postmessage|chat\.postmessage|messages(\.json)?|envelopes?|sms|notify)$/i;
const lastSegment = url => {
  let p = '';
  try { p = new URL(url).pathname; } catch { p = String(url ?? '').split('?')[0]; }
  const segs = decodeURIComponent(p).split(/[/:]/).filter(Boolean);
  return segs.at(-1) ?? '';
};
/**
 * What a write does: 'send' | 'create' | 'update' | 'delete' (null for a read). A POST whose last segment is an action on
 * a record (modify, label, mark, addTag, ...) is an update; a POST to a send/message endpoint is a send; any other POST
 * is a create. Non-HTTP tools by the verb at the end of their name.
 */
export function writeKind(call) {
  if (!isWrite(call)) return null;
  const f = fetchOf(call);
  if (f) {
    const m = String(f.method ?? 'POST').toUpperCase();
    if (m === 'DELETE') return 'delete';
    if (m === 'PUT' || m === 'PATCH') return 'update';
    if (/graphql/i.test(String(f.url ?? ''))) return 'update';
    const seg = lastSegment(f.url);
    if (SEND_SEG.test(seg)) return 'send';
    if (UPDATE_SEG.test(seg)) return 'update';
    return 'create';
  }
  const verb = String(call.name).split('.').pop();
  if (/(send|reply|forward|postmessage|post$)/i.test(verb)) return 'send';
  if (/(create|insert|append)/i.test(verb)) return 'create';
  if (/(delete|remove|trash)/i.test(verb)) return 'delete';
  return 'update';
}
/** Is a write a create or a send (a new record or message), not an update of an existing one? */
export const isCreate = call => ['send', 'create'].includes(writeKind(call));

/** Flat index of calls: [{s, c, call}] in log order. */
export function flat(steps) {
  const out = [];
  steps.forEach((st, s) => (st.calls ?? []).forEach((call, c) => out.push({ s, c, call })));
  return out;
}
export const writesOf = steps => flat(steps).filter(x => isWrite(x.call));

function rebuild(steps, keep) {
  return steps.map((st, s) => ({ ...st, calls: (st.calls ?? []).filter((_, c) => keep(s, c)) })).filter(st => st.calls.length);
}

// ---------- Gmail raw MIME (base64url) ----------
export function b64urlDecode(s) { return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
export function b64urlEncode(s) { return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
/** Split a MIME text into {head, sep, body}; null when the body is itself encoded (base64 / quoted-printable / multipart). */
export function mimeParts(text) {
  const m = /\r?\n\r?\n/.exec(text);
  if (!m) return null;
  const head = text.slice(0, m.index), body = text.slice(m.index + m[0].length);
  if (/content-transfer-encoding:\s*(base64|quoted-printable)/i.test(head) || /multipart\//i.test(head)) return { head, sep: m[0], body, encoded: true };
  return { head, sep: m[0], body, encoded: false };
}

// ---------- editable text slots of one write ----------
// A slot is {get(), set(v), kind: 'text' | 'recipient' | 'phone' | 'number' | 'mime-to' | 'mime-body', key}.
export function slotsOf(call) {
  const f = fetchOf(call);
  const slots = [];
  if (f && f.body && typeof f.body === 'object') {
    const raw = typeof f.body.raw === 'string' ? f.body.raw : null;
    if (raw) {
      const text = b64urlDecode(raw);
      const p = mimeParts(text);
      if (p) {
        const write = (head, body) => { const g = clone(f); g.body.raw = b64urlEncode(head + p.sep + body); return withFetch(call, g); };
        const to = /^(to|cc|bcc):(.*)$/gim;
        let mm;
        while ((mm = to.exec(p.head)) !== null) {
          const line = mm[0], start = mm.index;
          for (const e of line.match(EMAIL_RE) ?? []) {
            slots.push({ kind: 'recipient', key: mm[1].toLowerCase(), value: e,
              apply: v => write(p.head.slice(0, start) + line.replace(e, v) + p.head.slice(start + line.length), p.body) });
          }
        }
        if (!p.encoded) slots.push({ kind: 'text', key: 'mime-body', value: p.body, apply: v => write(p.head, v) });
      }
    }
    walk(f.body, [], (path, key, value) => {
      if (path[0] === 'raw') return;
      const set = v => { const g = clone(f); setPath(g.body, path, v); return withFetch(call, g); };
      if (typeof value === 'string') {
        if (RECIPIENT_KEY.test(key)) for (const e of value.match(EMAIL_RE) ?? []) slots.push({ kind: 'recipient', key, value: e, apply: v => set(value.replace(e, v)) });
        else if (PHONE_KEY.test(key) && /^\+?\d[\d\s()-]{7,}$/.test(value)) slots.push({ kind: 'phone', key, value, apply: v => set(v) });
        if (TEXT_KEY.test(key) || (value.length >= 40 && /\s/.test(value))) slots.push({ kind: 'text', key, value, apply: v => set(v) });
        else if (value.length && !/^[A-Za-z0-9_-]{6,}$/.test(value)) slots.push({ kind: 'short', key, value, apply: v => set(v) });
      } else if (typeof value === 'number' && !/(^|_)(id|ids|row|index|limit|page|count|size|offset|version)$/i.test(key)) {
        slots.push({ kind: 'number', key, value, apply: v => set(v) });
      }
    });
  } else if (!f) {
    const a = parseArgs(call);
    if (a && typeof a === 'object') walk(a, [], (path, key, value) => {
      const set = v => { const g = clone(a); setPath(g, path, v); return { ...call, arguments: JSON.stringify(g) }; };
      if (typeof value === 'string' && RECIPIENT_KEY.test(key)) for (const e of value.match(EMAIL_RE) ?? []) slots.push({ kind: 'recipient', key, value: e, apply: v => set(value.replace(e, v)) });
      else if (typeof value === 'string' && (TEXT_KEY.test(key) || value.length >= 40)) slots.push({ kind: 'text', key, value, apply: v => set(v) });
    });
  }
  return slots;
}

// Scalar leaves with the nearest object key (array elements inherit their array's key: a sheet cell is a 'values' leaf).
function walk(v, path, fn, key = '') {
  if (Array.isArray(v)) v.forEach((x, i) => (x && typeof x === 'object' ? walk(x, [...path, i], fn, key) : fn([...path, i], key, x)));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
    if (x && typeof x === 'object') walk(x, [...path, k], fn, k);
    else fn([...path, k], k, x);
  }
}
function setPath(o, path, v) { let x = o; for (const k of path.slice(0, -1)) x = x[k]; x[path.at(-1)] = v; }

/** Figures in a text that a perturbation may change: [{index, text, value}]. */
export function figuresIn(text) {
  const out = [];
  const s = String(text);
  for (const m of s.matchAll(FIGURE_RE)) {
    // dates, times, ranges and ids are excluded by FIGURE_RE's look-around (a digit next to '-', ':', '/', '.' or a word)
    const digits = m[2].replace(/,/g, '');
    if (/^(19|20)\d\d$/.test(digits) && !m[1]) continue;                            // a bare year
    out.push({ index: m.index, text: m[0], value: Number(digits), money: Boolean(m[1]) });
  }
  return out;
}
/** The minimal visible change of a figure: the last significant digit moves by one, the format is kept. */
export function bumpFigure(text) {
  const t = String(text);
  for (let i = t.length - 1; i >= 0; i--) {
    if (/\d/.test(t[i])) { const d = Number(t[i]); return t.slice(0, i) + String(d === 9 ? 8 : d + 1) + t.slice(i + 1); }
  }
  return t;
}

/** A number with its last written digit moved by one (12.5 -> 12.6, 40 -> 41, 19 -> 18): bumpFigure on its decimal text. */
export function bumpNumber(v) {
  const t = Number.isInteger(v) ? String(v) : String(v).replace(/e.*$/i, '');
  const out = Number(bumpFigure(t));
  return Number.isFinite(out) ? out : v;
}

const pickBy = (seed, items, key) => [...items].sort((a, b) => (seededRank(seed, key(a)) < seededRank(seed, key(b)) ? -1 : 1));
const replaceCall = (steps, s, c, call) => steps.map((st, i) => (i !== s ? st : { ...st, calls: st.calls.map((x, j) => (j === c ? call : x)) }));
const result = (op, steps, note) => ({ op, cls: OPS[op].cls, intended: OPS[op].intended, note, steps });

// ---------- operators ----------

/** Drop one write (up to `n` variants, chosen by seeded rank). */
export function dropWrite(steps, { seed, n = 2 } = {}) {
  const ws = writesOf(steps);
  return pickBy(`${seed}|drop`, ws, w => `${w.s}.${w.c}`).slice(0, n)
    .map(w => result('drop_write', rebuild(steps, (s, c) => !(s === w.s && c === w.c)), `write ${ws.indexOf(w) + 1} of ${ws.length}`));
}

/** Keep the first half of the writes and stop there (an unfinished run). */
export function dropTail(steps) {
  const ws = writesOf(steps);
  if (ws.length < 2) return [];
  const keep = Math.floor(ws.length / 2), last = ws[keep - 1];
  return [result('drop_tail', rebuild(steps, (s, c) => s < last.s || (s === last.s && c <= last.c)), `kept ${keep} of ${ws.length} writes`)];
}

/** Address one recipient of one write to another address of the initial world that no write uses. */
export function swapRecipient(steps, { seed, worldEmails = [] } = {}) {
  const ws = writesOf(steps);
  const used = new Set(ws.flatMap(w => (JSON.stringify(w.call.arguments).match(EMAIL_RE) ?? []).map(e => e.toLowerCase())));
  for (const w of ws) for (const sl of slotsOf(w.call)) if (sl.kind === 'recipient') used.add(sl.value.toLowerCase());
  const pool = [...new Set(worldEmails.map(e => e.toLowerCase()))].filter(e => !used.has(e)).sort();
  if (!pool.length) return [];
  const cands = ws.flatMap(w => slotsOf(w.call).filter(sl => sl.kind === 'recipient').map(sl => ({ w, sl })));
  if (!cands.length) return [];
  const [{ w, sl }] = pickBy(`${seed}|swap`, cands, x => `${x.w.s}.${x.w.c}.${x.sl.value}`);
  const to = pickBy(`${seed}|swapto`, pool, x => x)[0];
  return [result('swap_recipient', replaceCall(steps, w.s, w.c, sl.apply(to)), `one ${sl.key} recipient replaced`)];
}

/** Move one figure of one write by its last significant digit (minimal-edit content error). */
export function perturbNumber(steps, { seed, n = 1 } = {}) {
  const cands = [];
  for (const w of writesOf(steps)) for (const sl of slotsOf(w.call)) {
    if (sl.kind === 'number' && Number.isFinite(sl.value) && Math.abs(sl.value) >= 2 && Math.abs(sl.value) < 1e15) cands.push({ w, sl, apply: () => sl.apply(bumpNumber(sl.value)) });
    if (sl.kind === 'text' || sl.kind === 'short') for (const fg of figuresIn(sl.value)) cands.push({ w, sl, fg, apply: () => sl.apply(sl.value.slice(0, fg.index) + bumpFigure(fg.text) + sl.value.slice(fg.index + fg.text.length)) });
  }
  return pickBy(`${seed}|num`, cands, x => `${x.w.s}.${x.w.c}.${x.sl.key}.${x.fg?.index ?? 'n'}`).slice(0, n)
    .map(x => result('perturb_number', replaceCall(steps, x.w.s, x.w.c, x.apply()), `figure in ${x.sl.kind}:${x.sl.key}`));
}

/** Empty the longest free-text field of one write. */
export function blankText(steps, { seed } = {}) {
  const cands = writesOf(steps).flatMap(w => slotsOf(w.call).filter(sl => sl.kind === 'text' && sl.value.trim().length >= 10).map(sl => ({ w, sl })));
  if (!cands.length) return [];
  const [x] = pickBy(`${seed}|blank`, cands, c => `${c.w.s}.${c.w.c}.${c.sl.key}`);
  return [result('blank_text', replaceCall(steps, x.w.s, x.w.c, x.sl.apply('')), `emptied ${x.sl.key}`)];
}

/** Append a neutral closing line to one message-like text (meaning kept; no literal touched). */
export function reword(steps, { seed } = {}) {
  const cands = writesOf(steps).flatMap(w => slotsOf(w.call).filter(sl => sl.kind === 'text' && sl.value.trim().length >= 40).map(sl => ({ w, sl })));
  if (!cands.length) return [];
  const [x] = pickBy(`${seed}|reword`, cands, c => `${c.w.s}.${c.w.c}.${c.sl.key}`);
  const html = /<\/?[a-z][^>]*>/i.test(x.sl.value);
  return [result('reword', replaceCall(steps, x.w.s, x.w.c, x.sl.apply(x.sl.value + (html ? '<p>Thank you.</p>' : '\n\nThank you.'))), `closing line on ${x.sl.key}`)];
}

/** Send one send/create write twice (the copy has no stored result, so it adds no id mapping). */
export function dupWrite(steps, { seed } = {}) {
  const cands = writesOf(steps).filter(w => isCreate(w.call));
  if (!cands.length) return [];
  const [w] = pickBy(`${seed}|dup`, cands, x => `${x.s}.${x.c}`);
  const out = steps.map((st, s) => (s !== w.s ? st : { ...st, calls: st.calls.flatMap((x, c) => (c === w.c ? [x, { ...x, orig: null }] : [x])) }));
  return [{ ...result('dup_write', out, `one ${writeKind(w.call)} repeated`), sub: writeKind(w.call) }];
}

/**
 * "Add a forbidden row" (ATTACK §6 Move 4): one more send/create, a copy of one the run made, addressed to an entity of the
 * initial world the run never referenced: its recipient swapped to an unused address of the world, else a referenced
 * record id swapped to an untouched record of the same collection, else a referenced record's display name swapped to an
 * untouched record's. The copy carries no stored result. records = [{app, coll, id, name}] of the initial world.
 */
/** Every recipient of one write replaced by `to` (slots recomputed after each replacement; at most 20). */
export function readdress(call, to) {
  const orig = new Set(slotsOf(call).filter(sl => sl.kind === 'recipient').map(sl => sl.value.toLowerCase()));
  let out = call;
  for (let i = 0; i < 20; i++) {
    const sl = slotsOf(out).find(x => x.kind === 'recipient' && orig.has(x.value.toLowerCase()) && x.value.toLowerCase() !== to);
    if (!sl) break;
    out = sl.apply(to);
  }
  return out;
}
export function extraCreate(steps, { seed, worldEmails = [], records = [] } = {}) {
  const all = flat(steps);
  const text = all.map(x => (typeof x.call.arguments === 'string' ? x.call.arguments : JSON.stringify(x.call.arguments))).join('\n');
  const ws = writesOf(steps).filter(w => isCreate(w.call));
  if (!ws.length) return [];
  const usedEmails = new Set((text.match(EMAIL_RE) ?? []).map(e => e.toLowerCase()));
  for (const w of writesOf(steps)) for (const sl of slotsOf(w.call)) if (sl.kind === 'recipient') usedEmails.add(sl.value.toLowerCase());
  const freeEmails = [...new Set(worldEmails.map(e => e.toLowerCase()))].filter(e => !usedEmails.has(e)).sort();
  const idOk = id => typeof id === 'string' && id.length >= 4 && !/^\d{1,3}$/.test(id);
  const nameOk = n => typeof n === 'string' && n.trim().length >= 4;
  const byColl = new Map();
  for (const r of records) { const k = `${r.app}.${r.coll}`; if (!byColl.has(k)) byColl.set(k, []); byColl.get(k).push(r); }
  const cands = [];
  for (const w of ws) {
    const argText = typeof w.call.arguments === 'string' ? w.call.arguments : JSON.stringify(w.call.arguments);
    const rec = slotsOf(w.call).filter(sl => sl.kind === 'recipient');
    if (rec.length && freeEmails.length) { cands.push({ w, how: 'recipient', make: to => readdress(w.call, to), pool: freeEmails }); continue; }
    let done = false;
    for (const [k, rs] of byColl) {
      const hit = rs.find(r => idOk(r.id) && argText.includes(r.id));
      const free = rs.filter(r => idOk(r.id) && !text.includes(r.id)).map(r => r.id);
      if (hit && free.length) { cands.push({ w, how: `id:${k.split('.')[0]}`, make: id => ({ ...w.call, arguments: argText.split(hit.id).join(id) }), pool: free }); done = true; break; }
    }
    if (done) continue;
    for (const [k, rs] of byColl) {
      const hit = rs.find(r => nameOk(r.name) && argText.includes(r.name));
      const free = rs.filter(r => nameOk(r.name) && !text.includes(r.name)).map(r => r.name);
      if (hit && free.length) { cands.push({ w, how: `name:${k.split('.')[0]}`, make: n => ({ ...w.call, arguments: argText.split(hit.name).join(n) }), pool: free }); break; }
    }
  }
  if (!cands.length) return [];
  const [x] = pickBy(`${seed}|forbid`, cands, c => `${c.w.s}.${c.w.c}.${c.how}`);
  const to = pickBy(`${seed}|forbid-to`, x.pool, v => String(v))[0];
  const copy = { ...x.make(to), orig: null };
  const out = steps.map((st, s) => (s !== x.w.s ? st : { ...st, calls: st.calls.flatMap((y, c) => (c === x.w.c ? [y, copy] : [y])) }));
  return [{ ...result('extra_create', out, `one more ${writeKind(x.w.call)} for an entity the run never referenced (${x.how.split(':')[0]})`), sub: x.how.split(':')[0] }];
}

/**
 * Over-action: repeat one write that targets a record of the initial world, retargeted to another record of the same
 * collection that no call references. `records` = [{app, coll, id}] of the initial world's id-records.
 */
export function extraWrite(steps, { seed, records = [] } = {}) {
  const all = flat(steps);
  const text = all.map(x => (typeof x.call.arguments === 'string' ? x.call.arguments : JSON.stringify(x.call.arguments))).join('\n');
  const idOk = id => typeof id === 'string' && id.length >= 4 && !/^\d{1,3}$/.test(id);
  const byColl = new Map();
  for (const r of records) if (idOk(r.id)) { const k = `${r.app}.${r.coll}`; if (!byColl.has(k)) byColl.set(k, []); byColl.get(k).push(r.id); }
  const cands = [];
  for (const w of writesOf(steps)) {
    const f = fetchOf(w.call);
    if (!f) continue;
    for (const [k, ids] of byColl) {
      const target = ids.find(id => String(f.url).includes(id));
      if (!target) continue;
      const free = ids.filter(id => id !== target && !text.includes(id));
      if (free.length) cands.push({ w, k, target, free });
    }
  }
  if (!cands.length) return [];
  const [x] = pickBy(`${seed}|extra`, cands, c => `${c.w.s}.${c.w.c}.${c.k}`);
  const other = pickBy(`${seed}|extra-to`, x.free, id => id)[0];
  const argText = typeof x.w.call.arguments === 'string' ? x.w.call.arguments : JSON.stringify(x.w.call.arguments);
  const copy = { ...x.w.call, arguments: argText.split(x.target).join(other), orig: null };
  const out = steps.map((st, s) => (s !== x.w.s ? st : { ...st, calls: st.calls.flatMap((y, c) => (c === x.w.c ? [y, copy] : [y])) }));
  return [result('extra_write', out, `same write on an untouched record of ${x.k.split('.')[0]}`)];
}

/** Remove every read (the end state should not change). */
export function dropReads(steps) {
  const all = flat(steps);
  if (!all.some(x => !isWrite(x.call)) || !all.some(x => isWrite(x.call))) return [];
  return [result('drop_reads', rebuild(steps, (s, c) => isWrite(steps[s].calls[c])), 'reads removed')];
}

/** No call at all (one per task: its outcome does not depend on the arm). */
export const noop = () => [result('noop', [], 'empty trajectory')];

/** Every applicable mutant of one seed trajectory. ctx: {seed, worldEmails, records: [{app, coll, id, name}]}. */
export function mutantsOf(steps, ctx) {
  return [
    ...dropWrite(steps, ctx), ...dropTail(steps), ...swapRecipient(steps, ctx), ...perturbNumber(steps, ctx), ...blankText(steps, ctx),
    ...extraWrite(steps, ctx), ...dupWrite(steps, ctx), ...extraCreate(steps, ctx), ...dropReads(steps), ...reword(steps, ctx),
  ];
}
