// LEDGERS node of arm A1-C v2 (harness/v2/codeowned.mjs): copy-on-change of harness/ledger.mjs. Unchanged exports are
// imported from v1 (the system prompts, the adjudication prompt, readDecisions, conflictSpans, settleByCode).
// Changes (research/automationbench-20261014/A1C-V2-DESIGN.md):
//   M3  values two readers wrote differently but that name the same number or date are one value ("1,000" = "1000");
//       typeLedger types every literal (literals.mjs) and decides which are hard; renderLedger omits clauses, shows slots
//       as "(fill from the record)" and soft literals in a "may mention" tail.
//   M4  readers see the official system prompt as the operator's standing instructions (pointer "system"); a negative
//       item is typed by scope: "effect" (a rule forbids the effect) or "content" (a rule limits what a positive effect
//       may say or cover). A content negative attaches to the positive it limits as exclusions and never forms a polarity
//       conflict; adjudication never supersedes it or its positive. A standing rule from the system text adds the
//       identifying values of the candidates out by majority.
//   M5  "today" and "shown" are checked on business text (load stamps stripped, date note only); items merge only on
//       shared entity keys when both have keys; each reader's items align with the merged items by best match.
//   ride-alongs 1-4: JSON repair of unescaped inner quotes; quotes with an ellipsis verified fragment by fragment;
//       recipients are multi-valued (split into addresses and unioned); "notRules" is now "unsupportedNegatives".
import { ACTIONS, LEDGER_SYSTEM, ADJUDICATE_SYSTEM, adjudicatePrompt, conflictSpans, readDecisions, settleByCode } from '../ledger.mjs';
import { recordText } from '../inventory.mjs';
import { businessText, isLoadStamp } from './inventory.mjs';
import { EMAIL_RE, fillSlot, hasValue, humanRendering, identifyingValue, norm, parseDay, parseNumber, valueKey, valueType } from './literals.mjs';

export { ACTIONS, LEDGER_SYSTEM, ADJUDICATE_SYSTEM, adjudicatePrompt, conflictSpans, readDecisions, settleByCode };

export const EMAIL_FIELDS = new Set(['to', 'cc', 'bcc', 'recipient', 'recipients']);
export const MULTI_FIELDS = new Set(['body', 'text', 'body_contains', 'message', 'content', 'notes', 'description', ...EMAIL_FIELDS]);
export const BODY_FIELDS = new Set(['body', 'text', 'message', 'content', 'body_contains', 'notes', 'description', 'subject']);
export const META_FIELDS = new Set(['to', 'cc', 'bcc', 'recipient', 'recipients', 'email', 'subject', 'body', 'text', 'message', 'content', 'channel', 'target', 'spreadsheet', 'worksheet', 'sheet', 'record', 'id']);

// ---------------------------------------------------------------------------------------------------------------
// Prompt (section 4 of the design: the system block and the typed negatives; the rest is v1's text)

/** The ledger prompt: the standing instructions, the request verbatim, the inventory, and the extraction rules. */
export function ledgerPrompt({ request, system = null, inventoryText, precedents = [], dateNote = null }) {
  return `${system ? `<system>\n${system}\n</system>\n\n` : ''}<request>
${request}
</request>

<records>
${inventoryText}
</records>
${precedents.length ? `\n<precedents>\nExisting records of the kinds the request may create or change (their format, wording and recipients show the house conventions):\n${precedents.map(p => `- ${p.ptr}`).join('\n')}\n</precedents>\n` : ''}
Every record above has a pointer in square brackets, e.g. [app:kind:id]. The request's own text has the pointer "request".${system ? ' The text in <system> is the operator\'s standing instructions for every request; its pointer is "system".' : ''}${dateNote ? `\n${dateNote}` : ''}

Write the requirements the request places on the world: what must exist, or must have changed, after the work is done.

1. "today": today's date for this task, taken from the request or the task's own records (never from the machine running you), with the pointer and the exact text it comes from.
2. "requirements": one item per effect. An email to two people is one item; separate emails are separate items; one item per record to create or change.
   - "polarity": "positive" for an effect that must happen; "negative" ONLY when a source (the request, a record or the standing instructions) states an explicit rule that forbids or limits something (quote that rule in "rule_quote" with its pointer in "rule_source"). Something the request merely does not ask for is not a negative item: leave it out.
   - "scope" (negative items only): "effect" when the rule forbids an effect itself (a message to someone, a change to a record); "content" when it limits what a positive effect may say or cover (a person, record or topic that must be left out of a message, report or sheet). For "content", also give "limits": the id of the positive item it limits, and "leave_out": the values that identify what must be left out, each {"quote": <exact text from a source>, "source": <pointer>}.
   - "action": one of ${ACTIONS.join(', ')}. "app": the app key as listed under Connected apps. "target": the recipient(s), channel, record pointer or sheet.
   - "fields": the values the effect must carry, one entry per value: {"name": "to" | "cc" | "subject" | "body" | "channel" | "text" | <record field name>, "quote": <the value, copied exactly from the source text>, "source": <pointer>}. A value is a name, address, id, amount, date, status or other field value, or wording a source prescribes word for word. Never quote the sentence that asks for the effect, and never a placeholder such as <name> or [date]: give the value that fills it. When a source asks for certain values to appear (for example, to name the records a message covers), add "asked_by": {"quote": <the words that ask>, "source": <pointer>} to each such value. When a value must be computed (a sum, a conversion, a date), give {"name": ..., "derived": {"value": <result>, "method": <how>, "inputs": [{"quote": <exact text>, "source": <pointer>}]}} instead of "quote".
   - "candidates": when the request applies to a set (people, records, tickets, rows), list every candidate record you considered: {"record": <pointer>, "eligible": true|false, "deciding_field": <field>, "value": <its value in the record>, "rule_source": <pointer of the rule that decides>}.
   - "source": the pointer that asks for the effect ("request", or the record holding the rule or instruction).
3. "conflicts": where two sources disagree (an older and a newer rule, duplicate or stale records), list both with their dates and say which one wins: the newer one, or the more specific one.

Copy values exactly as they appear in the sources: names, addresses, ids, amounts, dates and required wording. Use only pointers that appear above.

Reply with JSON of this shape and nothing else:
{"today": {"value": "YYYY-MM-DD", "source": "...", "quote": "..."},
 "requirements": [{"id": "R1", "polarity": "positive", "action": "send_email", "app": "...", "target": "...", "statement": "...", "source": "...",
   "fields": [{"name": "to", "quote": "...", "source": "..."}], "candidates": [], "rule_quote": null, "rule_source": null, "scope": null, "limits": null, "leave_out": []}],
 "conflicts": [{"about": "...", "sources": [{"source": "...", "quote": "...", "date": "..."}], "winner": "...", "why": "newer"}]}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Parsing (ride-along 1)

/** Escape an unescaped `"` inside a JSON string when it is not followed by a structural character (`, } ] :`). */
export function repairJson(s) {
  let out = '', inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!inStr) { out += c; if (c === '"') inStr = true; continue; }
    if (c === '\\') { out += c + (s[i + 1] ?? ''); i += 1; continue; }
    if (c === '"') {
      if (/^\s*[,}\]:]/.test(s.slice(i + 1, i + 40)) || i === s.length - 1) { out += c; inStr = false; }
      else out += '\\"';
      continue;
    }
    if (c === '\n') { out += '\\n'; continue; }
    out += c;
  }
  return out;
}
/** The first JSON object in a model reply (a fenced block, or the outermost braces); a repair pass when none parses. */
export function parseJsonReply(text) {
  const s = String(text ?? '');
  const tries = [];
  for (const m of s.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)) tries.push(m[1]);
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) tries.push(s.slice(a, b + 1));
  for (const t of tries) { try { const j = JSON.parse(t); if (j && typeof j === 'object') return j; } catch { /* next */ } }
  for (const t of tries) { try { const j = JSON.parse(repairJson(t)); if (j && typeof j === 'object') return j; } catch { /* next */ } }
  return null;
}
/** A reader's reply that yields no ledger (re-ask rule: one more reader when >= reaskWhenFailed of K failed). */
export const readerFailed = json => !json || !Array.isArray(json.requirements);

// ---------------------------------------------------------------------------------------------------------------
// Verbatim copying (ride-along 2: fragments of an elided quote, in order, within one source)

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fold = s => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-');
function spanAt(q, t, from = 0) {
  const tokens = fold(q).split(/\s+/).filter(Boolean).map(w => esc(w).replace(/'/g, "['‘’]").replace(/"/g, '["“”]').replace(/-/g, '[-–—]'));
  if (!tokens.length) return null;
  const re = new RegExp(tokens.join('\\s+'), 'gi');
  re.lastIndex = from;
  const m = re.exec(t);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}
export const ELLIPSIS = /\s*(?:…|\.\.\.)\s*/;
/** The exact span of `quote` in `text` (v1's matching), or, for a quote with an ellipsis, the span from its first to its
 * last fragment when every fragment is found in order. Returns the ORIGINAL substring of `text`, or null. */
export function findSpan(quote, text) {
  const q = String(quote ?? '').trim();
  if (!q || q.length > 2000) return null;
  const t = String(text ?? '');
  const whole = spanAt(q, t);
  if (whole) return t.slice(whole.start, whole.end);
  const frags = q.split(ELLIPSIS).map(x => x.trim()).filter(Boolean);
  if (frags.length < 2 && !ELLIPSIS.test(q)) return null;
  if (!frags.length) return null;
  let at = 0, first = null, last = null;
  for (const f of frags) { const h = spanAt(f, t, at); if (!h) return null; first ??= h.start; last = h.end; at = h.end; }
  return t.slice(first, last);
}
/** v1's copyLiteral over findSpan v2; `shown` checks the business text (load stamps stripped) instead of the text. */
export function copyLiteral(quote, cited, sources, { shown = false } = {}) {
  const textOf = s => (shown ? s.shownText ?? s.text : s.text);
  const c = sources.get(cited);
  const hit = c ? findSpan(quote, textOf(c)) : null;
  if (hit !== null) return { value: hit, verified: 'cited', source: cited };
  for (const [ptr, s] of sources) { const h = findSpan(quote, textOf(s)); if (h !== null) return { value: h, verified: 'other', source: ptr }; }
  return { value: String(quote ?? ''), verified: false, source: cited ?? null };
}

/** The source map: every inventory record's text (and business text), the request, and (M4) the standing instructions. */
export function sourceMap(request, inventory, { system = null, dateNote = false, windowMs = 43_200_000 } = {}) {
  const m = new Map([['request', { text: String(request ?? ''), shownText: String(request ?? ''), date: null }]]);
  if (system) m.set('system', { text: String(system), shownText: String(system), date: null });
  const clock = inventory?.clock ?? null;
  const stamp = dateNote && clock ? v => isLoadStamp(v, clock, windowMs) : null;
  for (const r of inventory?.records ?? []) m.set(r.ptr, { text: recordText(r.data), shownText: businessText(r.data, stamp), date: r.date ?? null });
  return m;
}

// ---------------------------------------------------------------------------------------------------------------
// Normalizing one reader's ledger

const str = v => (v === null || v === undefined ? '' : String(v));
const emailsIn = s => [...new Set((str(s).toLowerCase().match(EMAIL_RE) ?? []))];
/** v1's normalization plus typed negatives (scope, limits, leave_out), asked_by on fields and multi-address recipients. */
export function normalizeLedger(raw, sources, { reader = 0 } = {}) {
  const out = { reader, ok: Boolean(raw && Array.isArray(raw.requirements)), today: null, requirements: [], dropped: [], conflicts: [] };
  if (!raw) return out;
  if (raw.today && typeof raw.today === 'object') {
    const lit = raw.today.quote ? copyLiteral(raw.today.quote, str(raw.today.source), sources, { shown: true }) : { verified: false };
    out.today = { value: str(raw.today.value).slice(0, 40), source: str(raw.today.source) || null, quote: lit.value ?? null, verified: lit.verified };
  }
  (Array.isArray(raw.requirements) ? raw.requirements : []).forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    const item = {
      id: `L${reader}.${str(r.id) || `R${i + 1}`}`, reader, polarity: r.polarity === 'negative' ? 'negative' : 'positive',
      action: ACTIONS.includes(r.action) ? r.action : 'other', app: str(r.app).trim().toLowerCase() || null, target: str(r.target).slice(0, 300),
      statement: str(r.statement).slice(0, 600), source: str(r.source) || 'request', fields: [], candidates: [], rule: null, scope: null, limits: null, leaveOut: [],
    };
    for (const f of Array.isArray(r.fields) ? r.fields : []) {
      if (!f || typeof f !== 'object' || !f.name) continue;
      const name = str(f.name).trim().toLowerCase().slice(0, 80);
      const askedBy = f.asked_by && typeof f.asked_by === 'object' && f.asked_by.quote ? (() => { const a = copyLiteral(f.asked_by.quote, str(f.asked_by.source) || item.source, sources); return { quote: a.value.slice(0, 400), source: a.source, verified: a.verified }; })() : null;
      if (f.derived && typeof f.derived === 'object') {
        const inputs = (Array.isArray(f.derived.inputs) ? f.derived.inputs : []).map(x => ({ ...copyLiteral(x?.quote, str(x?.source), sources) }));
        item.fields.push({ name, value: str(f.derived.value).slice(0, 2000), derived: true, method: str(f.derived.method).slice(0, 300), inputs, verified: inputs.length > 0 && inputs.every(x => x.verified) ? 'derived' : false, source: inputs[0]?.source ?? null, askedBy });
        continue;
      }
      const q = [f.quote, f.value, f.text].find(x => x !== undefined && x !== null && typeof x !== 'object' && str(x).trim());
      if (q === undefined) continue;
      // Recipients are multi-valued: one field per address (ride-along 4).
      const parts = EMAIL_FIELDS.has(name) && emailsIn(q).length > 1 ? emailsIn(q) : [q];
      for (const p of parts) {
        const lit = copyLiteral(p, str(f.source) || item.source, sources);
        item.fields.push({ name, value: lit.value.slice(0, 2000), verified: lit.verified, source: lit.source, modelText: lit.verified ? undefined : str(p).slice(0, 2000), askedBy });
      }
    }
    for (const c of Array.isArray(r.candidates) ? r.candidates : []) {
      if (!c || typeof c !== 'object' || !c.record) continue;
      const ptr = str(c.record).replace(/^\[|\]$/g, '');
      const val = c.value === undefined || c.value === null ? null : str(c.value);
      const inRecord = sources.has(ptr) && val !== null ? findSpan(val, sources.get(ptr).text) !== null : null;
      item.candidates.push({ record: ptr, known: sources.has(ptr), eligible: c.eligible === true, decidingField: str(c.deciding_field) || null, value: val, valueInRecord: inRecord, ruleSource: str(c.rule_source) || null });
    }
    if (item.polarity === 'negative') {
      const rule = r.rule_quote ? copyLiteral(r.rule_quote, str(r.rule_source) || item.source, sources) : null;
      if (!rule || !rule.verified) { out.dropped.push({ id: item.id, statement: item.statement, reason: rule ? 'rule text not found in any source' : 'no cited rule' }); return; }
      item.rule = { quote: rule.value, source: rule.source };
      item.scope = r.scope === 'content' ? 'content' : 'effect';
      if (item.scope === 'content') {
        item.limits = r.limits ? `L${reader}.${str(r.limits).replace(/^L\d+\./, '')}` : null;
        for (const x of Array.isArray(r.leave_out) ? r.leave_out : []) {
          const q = x && typeof x === 'object' ? x.quote : x;
          if (q === undefined || q === null || !str(q).trim()) continue;
          const lit = copyLiteral(q, str(x?.source) || item.rule.source, sources);
          if (lit.verified) item.leaveOut.push({ value: lit.value.slice(0, 300), source: lit.source });
        }
      }
    }
    out.requirements.push(item);
  });
  for (const c of Array.isArray(raw.conflicts) ? raw.conflicts : []) if (c && typeof c === 'object') out.conflicts.push({ about: str(c.about).slice(0, 300), winner: str(c.winner) || null, why: str(c.why) || null, sources: (Array.isArray(c.sources) ? c.sources : []).map(s => ({ source: str(s?.source), date: str(s?.date) || null, quote: str(s?.quote).slice(0, 400) })) });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Same effect: entity keys (M5)

const emailsOf = item => new Set([item.target, ...item.fields.filter(f => ['to', 'cc', 'recipient', 'recipients', 'email'].includes(f.name)).map(f => f.value)].flatMap(s => str(s).toLowerCase().match(EMAIL_RE) ?? []));
const PTR_RE = /\b[a-z_]+:[A-Za-z_]+:[^\s,;)\]]+/g;
const ID_TOKEN_RE = /\b(?=[A-Za-z0-9_-]*\d)[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)+\b|\b[A-Z]{2,}\d+\b|#\d{2,}\b/g;
/** Entity keys of an item: record pointers (rows included), @handles and id-like tokens in its target and non-body values;
 * e-mail addresses separately. */
export function entityKeys(item) {
  const texts = [item.target, ...item.fields.filter(f => !BODY_FIELDS.has(f.name)).map(f => f.value)].map(str);
  const others = new Set();
  for (const t of texts) {
    for (const m of t.match(PTR_RE) ?? []) others.add(m.toLowerCase());
    for (const m of t.replace(EMAIL_RE, ' ').match(/(?:^|\s)@[A-Za-z0-9_.-]{2,}/g) ?? []) others.add(m.trim().toLowerCase());
    for (const m of t.replace(PTR_RE, ' ').replace(EMAIL_RE, ' ').match(ID_TOKEN_RE) ?? []) others.add(m.toLowerCase());
  }
  return { emails: emailsOf(item), others };
}
const words = s => new Set(norm(s).split(/[^a-z0-9@._-]+/).filter(w => w.length > 2));
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i += 1; return i / (a.size + b.size - i); };
const family = a => (a === 'add_row' || a === 'update_row' ? 'row' : a);
const setEq = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
const meets = (a, b) => [...a].some(x => b.has(x));

/** Same effect? Same polarity, action family and app; then entity keys decide when both items have keys (they must share
 * one; addresses must be the same set), an item with keys never merges with one without, and two items without keys
 * merge on near-identical targets (v1). entityKeyMerge false: v1's rule. */
export function sameEffect(a, b, { entityKeyMerge = true } = {}) {
  if (a.polarity !== b.polarity || family(a.action) !== family(b.action)) return false;
  if (a.app && b.app && a.app !== b.app) return false;
  if (!entityKeyMerge) {
    const ea = emailsOf(a), eb = emailsOf(b);
    if (ea.size && eb.size) return setEq(ea, eb);
    const pa = new Set(str([a.target, ...a.fields.map(f => f.value)].join(' ')).match(PTR_RE) ?? []), pb = new Set(str([b.target, ...b.fields.map(f => f.value)].join(' ')).match(PTR_RE) ?? []);
    if (pa.size && pb.size) return meets(pa, pb);
    return jaccard(words(a.target), words(b.target)) >= 0.5 || Boolean(norm(a.target) && norm(a.target) === norm(b.target));
  }
  const ka = entityKeys(a), kb = entityKeys(b);
  const hasA = ka.emails.size + ka.others.size > 0, hasB = kb.emails.size + kb.others.size > 0;
  if (hasA && hasB) {
    if (ka.emails.size && kb.emails.size && !setEq(ka.emails, kb.emails)) return false;
    if (ka.emails.size && kb.emails.size) return !(ka.others.size && kb.others.size) || meets(ka.others, kb.others);
    return meets(ka.others, kb.others);
  }
  if (hasA !== hasB) return false;
  return jaccard(words(a.target), words(b.target)) >= 0.5 || Boolean(norm(a.target) && norm(a.target) === norm(b.target));
}
/** Similarity for best-match alignment: target and statement words, plus shared field values. */
export function similarity(a, b) {
  const t = jaccard(words(a.target), words(b.target)), s = jaccard(words(a.statement), words(b.statement));
  const va = new Set(a.fields.map(f => valueKey(f.value))), vb = new Set(b.fields.map(f => valueKey(f.value)));
  return t + s + jaccard(va, vb);
}

// ---------------------------------------------------------------------------------------------------------------
// Union, dedup, conflicts

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/**
 * mergeLedgers(ledgers, { sources, hostDate, entityKeyMerge }) -> { items, conflicts, today, dropped, readers, readersOk,
 * unattachedContent }. As v1, with best-match alignment, number/date-grouped values, unioned recipients, and content
 * negatives attached to the positive they limit as `exclusions` [{literal, support, rule, source, readers}].
 */
export function mergeLedgers(ledgers, { sources = new Map(), hostDate = null, entityKeyMerge = true } = {}) {
  const items = [], contentNegs = [];
  const K = ledgers.length;
  // Support is counted over the readers that answered (a reply that yielded a ledger), at least one (review M2).
  const answered = Math.max(1, ledgers.filter(L => L.ok).length);
  for (const L of ledgers) {
    const reqs = L.requirements.filter(r => !(r.polarity === 'negative' && r.scope === 'content'));
    contentNegs.push(...L.requirements.filter(r => r.polarity === 'negative' && r.scope === 'content'));
    const pairs = [];
    reqs.forEach((r, ri) => items.forEach((it, ii) => { if (!it.readers.has(r.reader) && sameEffect(it, r, { entityKeyMerge })) pairs.push({ ri, ii, s: similarity(it, r) }); }));
    pairs.sort((x, y) => y.s - x.s || x.ri - y.ri || x.ii - y.ii);
    const usedR = new Set(), usedI = new Set();
    for (const p of pairs) {
      if (usedR.has(p.ri) || usedI.has(p.ii)) continue;
      usedR.add(p.ri); usedI.add(p.ii);
      items[p.ii].members.push(reqs[p.ri]); items[p.ii].readers.add(reqs[p.ri].reader);
    }
    reqs.forEach((r, ri) => { if (!usedR.has(ri)) items.push({ ...r, members: [r], readers: new Set([r.reader]) }); });
  }
  const conflicts = [];
  const merged = items.map((it, i) => {
    const id = `M${i + 1}`;
    const byName = new Map();
    for (const m of it.members) for (const f of m.fields) { if (!byName.has(f.name)) byName.set(f.name, []); byName.get(f.name).push({ ...f, reader: m.reader }); }
    const fields = [];
    for (const [name, vals] of byName) {
      const distinct = [];
      for (const v of vals) {
        const key = EMAIL_FIELDS.has(name) ? `t:${norm(v.value)}` : valueKey(v.value);
        const d = distinct.find(x => x.key === key);
        if (d) { d.readers.add(v.reader); if (!d.askedBy?.verified && v.askedBy?.verified) d.askedBy = v.askedBy; if (!d.verified && v.verified) Object.assign(d, { value: v.value, verified: v.verified, source: v.source }); }
        else distinct.push({ ...v, key, readers: new Set([v.reader]) });
      }
      if (MULTI_FIELDS.has(name) || distinct.length === 1) for (const d of distinct) fields.push({ name, value: d.value, verified: d.verified, source: d.source, derived: Boolean(d.derived), support: d.readers.size, ...(d.askedBy ? { askedBy: d.askedBy } : {}) });
      else conflicts.push({ kind: 'value', item: id, field: name, about: `${it.statement || it.action} — field "${name}"`, options: distinct.map(d => ({ label: d.value, value: d.value, verified: d.verified, source: d.source, date: sources.get(d.source)?.date ?? null, support: d.readers.size, derived: Boolean(d.derived) })) });
    }
    const cands = new Map();
    for (const m of it.members) for (const c of m.candidates) { const e = cands.get(c.record) ?? { ...c, votes: [] }; e.votes.push(c.eligible); cands.set(c.record, e); }
    const candidates = [];
    for (const [rec, c] of cands) {
      const yes = c.votes.filter(Boolean).length, no = c.votes.length - yes;
      if (yes && no) conflicts.push({ kind: 'eligibility', item: id, record: rec, about: `${it.statement || it.action} — is ${rec} eligible (deciding field ${c.decidingField ?? '?'} = ${c.value ?? '?'})?`, options: [{ label: 'eligible', value: true, source: c.ruleSource, support: yes }, { label: 'not eligible', value: false, source: c.ruleSource, support: no }] });
      candidates.push({ record: rec, known: c.known, eligible: yes >= no ? (yes > no ? true : null) : false, decidingField: c.decidingField, value: c.value, valueInRecord: c.valueInRecord, ruleSource: c.ruleSource, votes: `${yes}/${c.votes.length}`, yes, no });
    }
    return { id, polarity: it.polarity, action: it.action, app: it.app, target: it.target, statement: it.statement, source: it.source, rule: it.members.find(m => m.rule)?.rule ?? null, scope: it.scope ?? null,
      fields, candidates, support: it.readers.size, of: answered, readers: [...it.readers].sort(), memberIds: it.members.map(m => m.id), exclusions: [] };
  });
  // Content negatives (M4): attached to the positive they limit (its reader's item id, else the same effect); never a
  // polarity conflict.
  const unattachedContent = [];
  for (const n of contentNegs) {
    let target = n.limits ? merged.find(m => m.polarity === 'positive' && m.memberIds.includes(n.limits)) : null;
    target ??= merged.find(m => m.polarity === 'positive' && sameEffect({ ...m, polarity: 'x' }, { ...n, polarity: 'x' }, { entityKeyMerge }));
    if (!target) { unattachedContent.push({ id: n.id, statement: n.statement, limits: n.limits, reason: 'no positive item to limit' }); continue; }
    target.contentRules = [...(target.contentRules ?? []), { id: n.id, reader: n.reader, rule: n.rule }];
    for (const lo of n.leaveOut) {
      const key = valueKey(lo.value);
      const e = target.exclusions.find(x => x.key === key);
      if (e) e.readers.add(n.reader); else target.exclusions.push({ key, literal: lo.value, source: lo.source, rule: n.rule, readers: new Set([n.reader]) });
    }
  }
  for (const m of merged) {
    m.exclusions = m.exclusions.map(({ key, readers, ...e }) => ({ ...e, support: readers.size, readers: [...readers].sort() }));
    m.contentSupport = new Set((m.contentRules ?? []).map(r => r.reader)).size;
  }
  // A positive and an EFFECT negative on the same effect.
  for (const p of merged.filter(x => x.polarity === 'positive')) for (const n of merged.filter(x => x.polarity === 'negative')) {
    if (sameEffect({ ...p, polarity: 'x' }, { ...n, polarity: 'x' }, { entityKeyMerge })) conflicts.push({ kind: 'polarity', item: p.id, other: n.id, about: `"${p.statement}" vs the rule "${n.rule?.quote ?? n.statement}"`, options: [{ label: `do it: ${p.statement}`, value: p.id, source: p.source, support: p.support }, { label: `do not: ${n.rule?.quote ?? n.statement}`, value: n.id, source: n.rule?.source ?? n.source, support: n.support }] });
  }
  // "today": quoted from business text (normalizeLedger), and the machine's own date only when business text shows it.
  const hostDates = new Set([hostDate ?? new Date().toISOString().slice(0, 10), localDate()]);
  const shown = d => [...sources.values()].some(s => String(s.shownText ?? s.text ?? '').includes(d));
  const todays = ledgers.map(L => L.today).filter(t => t?.value && t.verified && !(hostDates.has(t.value.slice(0, 10)) && !shown(t.value.slice(0, 10))));
  const todayVotes = new Map();
  for (const t of todays) { const k = t.value.slice(0, 10); const e = todayVotes.get(k) ?? { ...t, value: k, votes: 0 }; e.votes += 1; todayVotes.set(k, e); }
  const today = [...todayVotes.values()].sort((a, b) => b.votes - a.votes || Number(Boolean(b.verified)) - Number(Boolean(a.verified)))[0] ?? null;
  return { items: merged, conflicts, today, dropped: ledgers.flatMap(L => L.dropped), readers: K, readersOk: ledgers.filter(L => L.ok).length, unattachedContent };
}

/** Readers whose reply yielded a ledger (at least one), and the majority over them: floor(n / 2) + 1 (2 of 3, 2 of 2,
 * 1 of 1). With every reader answering this is v1's 2 of 3; with readers lost it does not silently drop every item and
 * literal to "possible" (review of 2026-10-21, M2). */
export const answeredOf = merged => Math.max(1, merged?.readersOk ?? merged?.readers ?? 1);
export const majorityOf = merged => Math.floor(answeredOf(merged) / 2) + 1;

/** v1's applyDecisions, except that a polarity decision never supersedes a content-limited positive (M4). */
export function applyDecisions(merged, decisions) {
  const log = [];
  for (const d of decisions) {
    const c = d.conflict;
    const item = merged.items.find(x => x.id === c.item);
    if (!item) continue;
    if (d.choice === null) { log.push({ about: c.about, decided: 'none', by: d.by, rule: d.rule ?? null }); if (c.kind === 'value') item.unresolved = [...(item.unresolved ?? []), c.field]; continue; }
    if (c.kind === 'value') item.fields.push({ name: c.field, value: d.choice.value, verified: d.choice.verified, source: d.choice.source, derived: Boolean(d.choice.derived), support: d.choice.support, adjudicated: d.by });
    else if (c.kind === 'eligibility') { const cand = item.candidates.find(x => x.record === c.record); if (cand) cand.eligible = d.choice.value; }
    else if (c.kind === 'polarity') {
      const loser = d.choice.value === c.item ? c.other : c.item;
      const l = merged.items.find(x => x.id === loser);
      if (l && !(l.scope === 'content' || (l.polarity === 'positive' && (l.contentRules?.length ?? 0) > 0))) l.superseded = { by: d.choice.value, how: d.by };
      else if (l) { log.push({ about: c.about, decided: d.choice.label, by: d.by, rule: d.rule ?? null, why: d.why ?? null, kept: `${loser} (content-limited: never superseded)` }); continue; }
    }
    log.push({ about: c.about, decided: d.choice.label, by: d.by, rule: d.rule ?? null, why: d.why ?? null });
  }
  merged.adjudications = [...(merged.adjudications ?? []), ...log];
  return merged;
}

// ---------------------------------------------------------------------------------------------------------------
// M3: value typing over the merged ledger, completeness literals, slot filling, standing rules (M4c)

const MESSAGE_ACTIONS = new Set(['send_email', 'post_message']);
/** A message item (v1's routing condition): send_email, post_message, a gmail item with recipients, or another Slack item. */
export const isMessageItem = i => MESSAGE_ACTIONS.has(i.action) || (i.app === 'gmail' && ['other', 'create_record'].includes(i.action) && (i.fields ?? []).some(f => f.name === 'to')) || (i.app === 'slack' && i.action === 'other');
const recOf = (inv, ptr) => (inv?.records ?? []).find(r => r.ptr === ptr) ?? null;
const columnValues = (inv, app, field) => {
  const want = String(field).toLowerCase().replace(/[^a-z0-9]/g, '');
  const out = [];
  for (const r of inv?.records ?? []) {
    if (app && r.app !== app) continue;
    for (const [k, v] of Object.entries(r.data ?? {})) if (k.toLowerCase().replace(/[^a-z0-9]/g, '') === want && (typeof v === 'string' || typeof v === 'number')) out.push(String(v));
  }
  return out;
};

/**
 * typeLedger(merged, sources, inv, P) annotates every live item's fields in place: vtype, accepted, typeReason, hardLit
 * (the per-literal rule), slotFilled / demoted, machine / display; adds completeness literals (completeness: true) to
 * message items and standing-rule exclusions (standing: true). Returns statistics.
 */
export function typeLedger(merged, sources, inv, P = {}) {
  const o = { clauseWords: P.clauseWords ?? 9, clauseLenRatio: P.clauseLenRatio ?? 3, clauseMinChars: P.clauseMinChars ?? 40 };
  const derivedAgreement = P.derivedAgreement ?? 2;
  const majority = majorityOf(merged);
  const stats = { demotedLiterals: 0, slotsFilled: 0, softLiterals: 0, clauseLiterals: 0, slotLiterals: 0, completenessLiterals: 0, standingExclusions: 0 };
  for (const item of merged.items) {
    if (item.superseded) continue;
    const message = isMessageItem(item);
    const eligible = item.candidates.filter(c => c.eligible === true);
    const single = eligible.length === 1 ? recOf(inv, eligible[0].record) : null;
    const decidingKeys = new Set(item.candidates.map(c => c.value).filter(v => v !== null && v !== undefined && String(v).trim()).map(valueKey));
    const itemMajority = item.support >= majority;
    // A value is asked for only when its asked_by quote is found in the item's own cited source (not in another source).
    const askedOwn = f => Boolean(f.askedBy && f.askedBy.verified === 'cited' && f.askedBy.source === item.source);
    for (const f of item.fields) {
      const recordField = !META_FIELDS.has(f.name);
      const ctx = { ...o, sourceText: sources.get(f.source)?.text ?? '', statement: item.statement, recordField, columnValues: recordField ? columnValues(inv, item.app, f.name) : null };
      let vt = valueType(f.value, ctx);
      if (vt.type === 'slot') {
        stats.slotLiterals += 1;
        const filled = P.valueTyping === false ? null : fillSlot(vt.slot, single?.data);
        if (filled) { Object.assign(f, { slot: f.value, value: filled.value, verified: 'cited', source: single.ptr, slotFilled: { from: single.ptr, field: filled.field } }); stats.slotsFilled += 1; vt = valueType(f.value, { ...ctx, sourceText: sources.get(single.ptr)?.text ?? '' }); }
        else { f.demoted = 'unfilled slot'; stats.demotedLiterals += 1; }
      }
      if (vt.type === 'clause') { stats.clauseLiterals += 1; stats.demotedLiterals += 1; }
      f.vtype = vt.type; f.accepted = vt.accepted; f.typeReason = vt.reason ?? null;
      if (message && BODY_FIELDS.has(f.name) && f.name !== 'subject' && decidingKeys.has(valueKey(f.value)) && !askedOwn(f)) f.demoted ??= 'a deciding-field value (not required in the message)';
      if (message && BODY_FIELDS.has(f.name) && vt.type === 'date' && vt.machine && P.humanizeMachineValues !== false) { f.machine = true; f.display = humanRendering(f.value, sources.get(f.source)?.text) ?? null; }
      const verified = f.verified === 'cited' || f.verified === 'other' || Boolean(f.slotFilled);
      const supported = f.derived ? (f.support ?? 1) >= derivedAgreement || Boolean(f.adjudicated) : (f.support ?? 1) >= majority || Boolean(f.adjudicated);
      f.hardLit = P.valueTyping === false ? null : Boolean(vt.accepted && (verified || (f.derived && supported)) && supported && itemMajority && !f.demoted && String(f.value).trim().length <= 160);
      if (!f.hardLit && vt.type !== 'clause' && !(vt.type === 'slot' && !f.slotFilled)) stats.softLiterals += 1;
    }
    // Completeness literals (privacy over grader fit, review of 2026-10-21): the identifying value of a majority-eligible
    // candidate of a message item is added ONLY when the item's own cited source asks for values to appear (asked_by
    // verified there), only as a hard value (never as "may mention"), and never for a candidate whose record carries a
    // different recipient's address (another person's record does not go into this recipient's message).
    if (message && P.completeness !== 'off' && itemMajority && item.fields.some(askedOwn)) {
      const have = new Set(item.fields.map(f => valueKey(f.value)));
      const to = new Set(item.fields.filter(f => EMAIL_FIELDS.has(f.name)).flatMap(f => emailsIn(f.value)).concat(emailsIn(item.target)));
      for (const c of eligible) {
        const r = recOf(inv, c.record);
        const idv = r ? identifyingValue(r.data) : null;
        if (!idv || have.has(valueKey(idv))) continue;
        const own = emailsIn(recordText(r.data));
        if (own.length && !own.some(e => to.has(e))) continue;   // another recipient's record
        const vt = valueType(idv, { ...o, sourceText: sources.get(r.ptr)?.text ?? '', statement: item.statement });
        if (!(vt.accepted && (c.yes ?? 1) >= majority)) continue;
        have.add(valueKey(idv));
        item.fields.push({ name: item.action === 'post_message' ? 'text' : 'body', value: idv, verified: 'cited', source: r.ptr, derived: false, support: c.yes ?? 1, completeness: true, vtype: vt.type, accepted: vt.accepted, hardLit: true });
        stats.completenessLiterals += 1;
      }
    }
    // Standing rule (M4c): a content negative citing the standing instructions excludes the identifying values of the
    // candidates out by majority with a verified rule source; never for recipients, never where a source asks for the
    // exclusion notice.
    const systemRules = (item.contentRules ?? []).filter(r => r.rule?.source === 'system');
    if (systemRules.length && P.contentConstraints !== false) {
      const support = new Set(systemRules.map(r => r.reader)).size;
      const to = new Set(item.fields.filter(f => EMAIL_FIELDS.has(f.name)).flatMap(f => emailsIn(f.value)).concat(emailsIn(item.target)));
      const noticeKeys = new Set(item.fields.filter(f => f.askedBy?.verified).map(f => valueKey(f.value)));
      for (const c of item.candidates.filter(x => x.eligible === false && x.ruleSource && sources.has(x.ruleSource))) {
        const r = recOf(inv, c.record);
        const idv = r ? identifyingValue(r.data) : null;
        if (!idv) continue;
        if (emailsIn(recordText(r.data)).some(e => to.has(e))) continue;
        if (noticeKeys.has(valueKey(idv))) continue;
        if (item.exclusions.some(e => valueKey(e.literal) === valueKey(idv))) continue;
        item.exclusions.push({ literal: idv, source: r.ptr, rule: systemRules[0].rule, support, readers: [...new Set(systemRules.map(x => x.reader))].sort(), standing: true });
        stats.standingExclusions += 1;
      }
    }
    // A banned literal that is part of (or contains) an in-scope identifying value or a hard positive literal is dropped.
    const inScope = eligible.map(c => recOf(inv, c.record)).filter(Boolean).map(r => identifyingValue(r.data)).filter(Boolean).map(norm);
    const hardPos = item.fields.filter(f => f.hardLit).map(f => norm(f.value));
    item.exclusions = item.exclusions.filter(e => {
      const n = norm(e.literal);
      const clash = [...inScope, ...hardPos].find(x => x && (x.includes(n) || n.includes(x)));
      if (clash) { (item.droppedExclusions ??= []).push({ literal: e.literal, why: `overlaps the required value "${clash}"` }); return false; }
      return n.length >= 3;
    });
    for (const e of item.exclusions) e.hard = e.support >= majority && Boolean(e.rule);
  }
  return stats;
}

// ---------------------------------------------------------------------------------------------------------------
// Rendering (the brief)

const q = v => JSON.stringify(String(v));
/** How the brief shows a field: 'omit' (instruction text: the statement keeps it), 'fill' (a placeholder to fill from the
 * record), 'date' (a machine timestamp: a date to write in words), 'exact' (a value to copy), 'may' (soft: may mention). */
export function displayOf(f) {
  if (f.vtype === 'clause') return 'omit';
  if (f.vtype === 'slot' && !f.slotFilled) return 'fill';
  if (f.machine) return 'date';
  if (EMAIL_FIELDS.has(f.name) || f.name === 'channel' || f.hardLit === null || f.hardLit === undefined) return 'exact';
  return f.hardLit && !f.coSoft ? 'exact' : 'may';
}
/** The merged ledger as brief text: hard values to copy, slots to fill, soft values as "may mention", exclusions as
 * "leave out"; clause literals are omitted (the statement keeps them). */
export function renderLedger(merged) {
  const live = merged.items.filter(i => !i.superseded);
  const line = i => {
    const shownFields = [], may = [];
    for (const f of i.fields) {
      const d = displayOf(f);
      if (d === 'omit') continue;
      if (d === 'fill') { shownFields.push(`${f.name}=(fill from the record)`); continue; }
      if (d === 'date') { shownFields.push(`${f.name}: the date ${f.display ? q(f.display) : q(f.value)} (write it in words)`); continue; }
      if (d === 'may') { may.push(q(f.value)); continue; }
      const plain = EMAIL_FIELDS.has(f.name) || f.name === 'channel' || f.hardLit === null || f.hardLit === undefined;
      shownFields.push(`${f.name}=${q(f.value)}${f.derived ? ' (computed)' : plain && !(f.verified === 'cited' || f.verified === 'other') ? ' (not found verbatim in a source)' : ''}`);
    }
    const fs = shownFields.join('; ');
    const cs = i.candidates.length ? ` | candidates: ${i.candidates.map(c => `${c.record} ${c.eligible === true ? 'eligible' : c.eligible === false ? 'not eligible' : 'undecided'} (${c.decidingField ?? '?'}=${c.value ?? '?'})`).join(', ')}` : '';
    const label = i.polarity === 'negative' ? 'MUST NOT' : i.support >= Math.floor(Math.max(1, i.of ?? 1) / 2) + 1 ? 'MUST' : 'POSSIBLE: fewer than a majority of readers found it; act only if the sources confirm it';
    // Only exclusions a majority of readers found (with a verbatim rule) are shown: a single reader's exclusion could
    // remove required content.
    const ex = (i.exclusions ?? []).filter(e => e.hard);
    const leave = ex.length ? ` | leave out of this item: ${ex.map(e => q(e.literal)).join(', ')} (rule ${ex[0].rule?.source ?? '?'}: ${q(String(ex[0].rule?.quote ?? '').slice(0, 200))})` : '';
    const mayT = may.length ? ` | may mention (no source requires it; use only where it belongs, never as a bare list): ${[...new Set(may)].slice(0, 12).join(', ')}` : '';
    return `- ${i.id} [${label}; ${i.action}${i.app ? ` in ${i.app}` : ''}; found by ${i.support}/${i.of} readers; source ${i.source}] ${i.statement}${i.rule ? ` (rule ${i.rule.source}: "${i.rule.quote}")` : ''}${fs ? ` | ${fs}` : ''}${cs}${leave}${mayT}`;
  };
  return live.map(line).join('\n');
}

export const _internal = { emailsOf, words, jaccard, hasValue, parseDay, parseNumber };
