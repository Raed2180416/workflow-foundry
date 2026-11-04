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
import { createHash } from 'node:crypto';

export const MUTATE_VERSION = 'mutlab-mutate-v1';

export const OPS = Object.freeze({
  drop_write: { cls: 'omission', intended: 'wrong' },
  drop_tail: { cls: 'omission', intended: 'wrong' },
  swap_recipient: { cls: 'misdirection', intended: 'wrong' },
  perturb_number: { cls: 'content', intended: 'wrong' },
  blank_text: { cls: 'content', intended: 'wrong' },
  extra_write: { cls: 'over-action', intended: 'wrong' },
  dup_write: { cls: 'duplicate', intended: 'wrong' },
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

/** Is a write a create/send (a POST without a record id at the end of its path)? */
export function isCreate(call) {
  const f = fetchOf(call);
  if (!f) return /(send|create|post|append|insert|add)/i.test(call.name);
  return String(f.method).toUpperCase() === 'POST';
}

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
    if (sl.kind === 'number' && Number.isFinite(sl.value) && Math.abs(sl.value) >= 2) cands.push({ w, sl, apply: () => sl.apply(Number.isInteger(sl.value) ? sl.value + 1 : Math.round(sl.value * 110) / 100) });
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

/** Send one create/send write twice (the copy has no stored result, so it adds no id mapping). */
export function dupWrite(steps, { seed } = {}) {
  const cands = writesOf(steps).filter(w => isCreate(w.call));
  if (!cands.length) return [];
  const [w] = pickBy(`${seed}|dup`, cands, x => `${x.s}.${x.c}`);
  const out = steps.map((st, s) => (s !== w.s ? st : { ...st, calls: st.calls.flatMap((x, c) => (c === w.c ? [x, { ...x, orig: null }] : [x])) }));
  return [result('dup_write', out, 'one create/send repeated')];
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

/** Every applicable mutant of one seed trajectory. ctx: {seed, worldEmails, records}. */
export function mutantsOf(steps, ctx) {
  return [
    ...dropWrite(steps, ctx), ...dropTail(steps), ...swapRecipient(steps, ctx), ...perturbNumber(steps, ctx), ...blankText(steps, ctx),
    ...extraWrite(steps, ctx), ...dupWrite(steps, ctx), ...dropReads(steps), ...reword(steps, ctx),
  ];
}
