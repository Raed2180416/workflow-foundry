// LEDGERS node of arm A1-C (harness/codeowned.mjs): K independent clean-context model calls each extract a typed
// requirement ledger from the official request and the inventory; CODE then
//   - copies every literal value VERBATIM from the cited source span (the model only points; code copies),
//   - drops every negative ("must not") item that does not cite an explicit rule found verbatim in a source,
//   - unions the K ledgers for recall and deduplicates them,
//   - settles conflicts by the newer or the more specific source, and asks one adjudication call only for the
//     conflicts code cannot settle (recorded).
// The prompts are identical for every task (task-agnostic); only the request and the inventory are filled in.
import { recordText } from './inventory.mjs';

export const ACTIONS = Object.freeze(['send_email', 'post_message', 'create_record', 'update_record', 'delete_record', 'add_row', 'update_row', 'other']);
export const MULTI_FIELDS = new Set(['body', 'text', 'body_contains', 'message', 'content', 'notes', 'description']);

// ---------------------------------------------------------------------------------------------------------------
// Prompts

export const LEDGER_SYSTEM = `You read a business request and a complete listing of the records in the systems it touches, and you write the request's requirements as JSON. You do not act and you cannot call tools. Reply with one JSON object only.`;

/** The ledger prompt: the request verbatim, the inventory, and the extraction rules (identical for every task). */
export function ledgerPrompt({ request, inventoryText, precedents = [], dateNote = null }) {
  return `<request>
${request}
</request>

<records>
${inventoryText}
</records>
${precedents.length ? `\n<precedents>\nExisting records of the kinds the request may create or change (their format, wording and recipients show the house conventions):\n${precedents.map(p => `- ${p.ptr}`).join('\n')}\n</precedents>\n` : ''}
Every record above has a pointer in square brackets, e.g. [app:kind:id]. The request's own text has the pointer "request".${dateNote ? `\n${dateNote}` : ''}

Write the requirements the request places on the world: what must exist, or must have changed, after the work is done.

1. "today": today's date for this task, taken from the request or the task's own records (never from the machine running you), with the pointer and the exact text it comes from.
2. "requirements": one item per effect. An email to two people is one item; separate emails are separate items; one item per record to create or change.
   - "polarity": "positive" for an effect that must happen; "negative" ONLY when a source states an explicit rule that forbids or limits something (quote that rule in "rule_quote" with its pointer in "rule_source"). Something the request merely does not ask for is not a negative item: leave it out.
   - "action": one of ${ACTIONS.join(', ')}. "app": the app key as listed under Connected apps. "target": the recipient(s), channel, record pointer or sheet.
   - "fields": the values the effect must carry, one entry per value: {"name": "to" | "cc" | "subject" | "body" | "channel" | "text" | <record field name>, "quote": <the value, copied exactly from the source text>, "source": <pointer>}. For text that must appear in a message body, quote the exact words a source requires. When a value must be computed (a sum, a conversion, a date), give {"name": ..., "derived": {"value": <result>, "method": <how>, "inputs": [{"quote": <exact text>, "source": <pointer>}]}} instead of "quote".
   - "candidates": when the request applies to a set (people, records, tickets, rows), list every candidate record you considered: {"record": <pointer>, "eligible": true|false, "deciding_field": <field>, "value": <its value in the record>, "rule_source": <pointer of the rule that decides>}.
   - "source": the pointer that asks for the effect ("request", or the record holding the rule or instruction).
3. "conflicts": where two sources disagree (an older and a newer rule, duplicate or stale records), list both with their dates and say which one wins: the newer one, or the more specific one.

Copy values exactly as they appear in the sources: names, addresses, ids, amounts, dates and required wording. Use only pointers that appear above.

Reply with JSON of this shape and nothing else:
{"today": {"value": "YYYY-MM-DD", "source": "...", "quote": "..."},
 "requirements": [{"id": "R1", "polarity": "positive", "action": "send_email", "app": "...", "target": "...", "statement": "...", "source": "...",
   "fields": [{"name": "to", "quote": "...", "source": "..."}], "candidates": [], "rule_quote": null, "rule_source": null}],
 "conflicts": [{"about": "...", "sources": [{"source": "...", "quote": "...", "date": "..."}], "winner": "...", "why": "newer"}]}`;
}

export const ADJUDICATE_SYSTEM = `You settle disagreements between independent readings of a business request, using only the quoted sources. You cannot call tools. Reply with one JSON object only.`;

export function adjudicatePrompt({ request, conflicts, sourceSpans, dateNote = null }) {
  return `<request>
${request}
</request>
${dateNote ? `\n${dateNote}\n` : ''}
Independent readers disagreed on the points below. For each, choose the option the sources support. Prefer the newer source when two sources give different rules for the same thing, and the more specific source (one naming this exact case) over a general one. Choose "none" when no option is supported by a source.

${conflicts.map((c, i) => `### Point ${i + 1}: ${c.about}\n${c.options.map((o, k) => `  option ${k + 1}: ${o.label}${o.source ? ` (source ${o.source}${o.date ? `, dated ${o.date}` : ''})` : ''}`).join('\n')}`).join('\n\n')}

<sources>
${sourceSpans.map(s => `[${s.ptr}]${s.date ? ` (${s.date})` : ''} ${s.text}`).join('\n')}
</sources>

Reply with JSON only: {"decisions": [{"point": 1, "option": 1, "why": "...", "quote": "<exact text from a source>", "source": "<pointer>"}]} (use "option": "none" when nothing supports any option).`;
}

// ---------------------------------------------------------------------------------------------------------------
// Parsing

/** The first JSON object in a model reply (a fenced block, or the outermost braces). null when none parses. */
export function parseJsonReply(text) {
  const s = String(text ?? '');
  const tries = [];
  for (const m of s.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)) tries.push(m[1]);
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) tries.push(s.slice(a, b + 1));
  for (const t of tries) { try { const j = JSON.parse(t); if (j && typeof j === 'object') return j; } catch { /* next */ } }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Verbatim copying (code owns the literal)

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The exact span of `quote` inside `text`: case-insensitive, any run of whitespace matches any run, typographic quotes and
 * dashes fold to plain ones. Returns the ORIGINAL substring of `text` (so the literal is copied from the source), or null. */
export function findSpan(quote, text) {
  const q = String(quote ?? '').trim();
  if (!q || q.length > 2000) return null;
  const fold = s => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-');
  const t = String(text ?? '');
  const tokens = fold(q).split(/\s+/).filter(Boolean).map(w => esc(w).replace(/'/g, "['‘’]").replace(/"/g, '["“”]').replace(/-/g, '[-–—]'));
  if (!tokens.length) return null;
  const m = new RegExp(tokens.join('\\s+'), 'i').exec(t);
  return m ? m[0] : null;
}

/** sources: Map pointer -> {text, date}; 'request' -> the official request. Resolve one quote: the cited source first, then
 * any source. -> {value, verified: 'cited'|'other'|false, source} */
export function copyLiteral(quote, cited, sources) {
  const c = sources.get(cited);
  const hit = c ? findSpan(quote, c.text) : null;
  if (hit !== null) return { value: hit, verified: 'cited', source: cited };
  for (const [ptr, s] of sources) { const h = findSpan(quote, s.text); if (h !== null) return { value: h, verified: 'other', source: ptr }; }
  return { value: String(quote ?? ''), verified: false, source: cited ?? null };
}

/** The source map for verbatim checks: every inventory record's plain text, plus the request. */
export function sourceMap(request, inventory) {
  const m = new Map([['request', { text: String(request ?? ''), date: null }]]);
  for (const r of inventory?.records ?? []) m.set(r.ptr, { text: recordText(r.data), date: r.date ?? null });
  return m;
}

const str = v => (v === null || v === undefined ? '' : String(v));
/** Normalize one parsed ledger: typed fields, literals copied verbatim by code, unsupported negatives dropped. */
export function normalizeLedger(raw, sources, { reader = 0 } = {}) {
  const out = { reader, ok: Boolean(raw && Array.isArray(raw.requirements)), today: null, requirements: [], dropped: [], conflicts: [] };
  if (!raw) return out;
  if (raw.today && typeof raw.today === 'object') {
    const lit = raw.today.quote ? copyLiteral(raw.today.quote, str(raw.today.source), sources) : { verified: false };
    out.today = { value: str(raw.today.value).slice(0, 40), source: str(raw.today.source) || null, quote: lit.value ?? null, verified: lit.verified };
  }
  (Array.isArray(raw.requirements) ? raw.requirements : []).forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    const item = {
      id: `L${reader}.${str(r.id) || `R${i + 1}`}`, reader, polarity: r.polarity === 'negative' ? 'negative' : 'positive',
      action: ACTIONS.includes(r.action) ? r.action : 'other', app: str(r.app).trim().toLowerCase() || null, target: str(r.target).slice(0, 300),
      statement: str(r.statement).slice(0, 600), source: str(r.source) || 'request', fields: [], candidates: [], rule: null,
    };
    for (const f of Array.isArray(r.fields) ? r.fields : []) {
      if (!f || typeof f !== 'object' || !f.name) continue;
      const name = str(f.name).trim().toLowerCase().slice(0, 80);
      if (f.derived && typeof f.derived === 'object') {
        const inputs = (Array.isArray(f.derived.inputs) ? f.derived.inputs : []).map(x => ({ ...copyLiteral(x?.quote, str(x?.source), sources) }));
        item.fields.push({ name, value: str(f.derived.value).slice(0, 2000), derived: true, method: str(f.derived.method).slice(0, 300), inputs, verified: inputs.length > 0 && inputs.every(x => x.verified) ? 'derived' : false, source: inputs[0]?.source ?? null });
      } else {
        // A reader that wrote "value" (or "text") instead of "quote" is read the same way: code still copies the span.
        const q = [f.quote, f.value, f.text].find(x => x !== undefined && x !== null && typeof x !== 'object' && str(x).trim());
        if (q === undefined) continue;
        const lit = copyLiteral(q, str(f.source) || item.source, sources);
        item.fields.push({ name, value: lit.value.slice(0, 2000), verified: lit.verified, source: lit.source, modelText: lit.verified ? undefined : str(q).slice(0, 2000) });
      }
    }
    for (const c of Array.isArray(r.candidates) ? r.candidates : []) {
      if (!c || typeof c !== 'object' || !c.record) continue;
      const ptr = str(c.record);
      const val = c.value === undefined || c.value === null ? null : str(c.value);
      const inRecord = sources.has(ptr) && val !== null ? findSpan(val, sources.get(ptr).text) !== null : null;
      item.candidates.push({ record: ptr, known: sources.has(ptr), eligible: c.eligible === true, decidingField: str(c.deciding_field) || null, value: val, valueInRecord: inRecord, ruleSource: str(c.rule_source) || null });
    }
    if (item.polarity === 'negative') {
      const rule = r.rule_quote ? copyLiteral(r.rule_quote, str(r.rule_source) || item.source, sources) : null;
      if (!rule || !rule.verified) { out.dropped.push({ id: item.id, statement: item.statement, reason: rule ? 'rule text not found in any source' : 'no cited rule' }); return; }
      item.rule = { quote: rule.value, source: rule.source };
    }
    out.requirements.push(item);
  });
  for (const c of Array.isArray(raw.conflicts) ? raw.conflicts : []) if (c && typeof c === 'object') out.conflicts.push({ about: str(c.about).slice(0, 300), winner: str(c.winner) || null, why: str(c.why) || null, sources: (Array.isArray(c.sources) ? c.sources : []).map(s => ({ source: str(s?.source), date: str(s?.date) || null, quote: str(s?.quote).slice(0, 400) })) });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Union, dedup, conflicts

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const norm = s => str(s).toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const emailsOf = item => new Set([item.target, ...item.fields.filter(f => ['to', 'cc', 'recipient', 'recipients', 'email'].includes(f.name)).map(f => f.value)].flatMap(s => str(s).toLowerCase().match(EMAIL) ?? []));
const ptrsOf = item => new Set([item.target, ...item.fields.map(f => f.value)].flatMap(s => str(s).match(/\b[a-z_]+:[A-Za-z_]+:[^\s,;)\]]+/g) ?? []));
const words = s => new Set(norm(s).split(/[^a-z0-9@._-]+/).filter(w => w.length > 2));
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i += 1; return i / (a.size + b.size - i); };
const family = a => (a === 'add_row' || a === 'update_row' ? 'row' : a);

/** Same effect? Same polarity and action family, and the same recipients, the same record, or near-identical targets. */
export function sameEffect(a, b) {
  if (a.polarity !== b.polarity || family(a.action) !== family(b.action)) return false;
  if (a.app && b.app && a.app !== b.app) return false;
  const ea = emailsOf(a), eb = emailsOf(b);
  if (ea.size && eb.size) return [...ea].every(x => eb.has(x)) && [...eb].every(x => ea.has(x));
  const pa = ptrsOf(a), pb = ptrsOf(b);
  if (pa.size && pb.size) return [...pa].some(x => pb.has(x));
  return jaccard(words(a.target), words(b.target)) >= 0.5 || (norm(a.target) && norm(a.target) === norm(b.target));
}

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/**
 * mergeLedgers(ledgers, { sources, hostDate }) -> { items, conflicts, today, dropped }.
 * Union for recall: every effect any reader found is kept, with its support (readers that found it). Single-valued
 * fields that disagree across readers, eligibility that disagrees, and a positive/negative pair on the same effect become
 * conflicts. Multi-valued fields (body text) are unioned.
 */
export function mergeLedgers(ledgers, { sources = new Map(), hostDate = null } = {}) {
  const items = [];
  const K = ledgers.length;
  for (const L of ledgers) for (const r of L.requirements) {
    const hit = items.find(it => sameEffect(it, r) && !it.readers.has(r.reader));
    if (hit) { hit.members.push(r); hit.readers.add(r.reader); } else items.push({ ...r, members: [r], readers: new Set([r.reader]) });
  }
  const conflicts = [];
  const merged = items.map((it, i) => {
    const id = `M${i + 1}`;
    const byName = new Map();
    for (const m of it.members) for (const f of m.fields) { if (!byName.has(f.name)) byName.set(f.name, []); byName.get(f.name).push({ ...f, reader: m.reader }); }
    const fields = [];
    for (const [name, vals] of byName) {
      const distinct = [];
      for (const v of vals) { const d = distinct.find(x => norm(x.value) === norm(v.value)); if (d) d.readers.add(v.reader); else distinct.push({ ...v, readers: new Set([v.reader]) }); }
      if (MULTI_FIELDS.has(name) || distinct.length === 1) for (const d of distinct) fields.push({ name, value: d.value, verified: d.verified, source: d.source, derived: Boolean(d.derived), support: d.readers.size });
      else conflicts.push({ kind: 'value', item: id, field: name, about: `${it.statement || it.action} — field "${name}"`, options: distinct.map(d => ({ label: d.value, value: d.value, verified: d.verified, source: d.source, date: sources.get(d.source)?.date ?? null, support: d.readers.size, derived: Boolean(d.derived) })) });
    }
    const cands = new Map();
    for (const m of it.members) for (const c of m.candidates) { const e = cands.get(c.record) ?? { ...c, votes: [] }; e.votes.push(c.eligible); cands.set(c.record, e); }
    const candidates = [];
    for (const [rec, c] of cands) {
      const yes = c.votes.filter(Boolean).length, no = c.votes.length - yes;
      if (yes && no) conflicts.push({ kind: 'eligibility', item: id, record: rec, about: `${it.statement || it.action} — is ${rec} eligible (deciding field ${c.decidingField ?? '?'} = ${c.value ?? '?'})?`, options: [{ label: 'eligible', value: true, source: c.ruleSource, support: yes }, { label: 'not eligible', value: false, source: c.ruleSource, support: no }] });
      candidates.push({ record: rec, known: c.known, eligible: yes >= no ? (yes > no ? true : null) : false, decidingField: c.decidingField, value: c.value, valueInRecord: c.valueInRecord, ruleSource: c.ruleSource, votes: `${yes}/${c.votes.length}` });
    }
    return { id, polarity: it.polarity, action: it.action, app: it.app, target: it.target, statement: it.statement, source: it.source, rule: it.members.find(m => m.rule)?.rule ?? null,
      fields, candidates, support: it.readers.size, of: K, readers: [...it.readers].sort(), memberIds: it.members.map(m => m.id) };
  });
  // A positive and a negative item on the same effect.
  for (const p of merged.filter(x => x.polarity === 'positive')) for (const n of merged.filter(x => x.polarity === 'negative')) {
    if (sameEffect({ ...p, polarity: 'x' }, { ...n, polarity: 'x' })) conflicts.push({ kind: 'polarity', item: p.id, other: n.id, about: `"${p.statement}" vs the rule "${n.rule?.quote ?? n.statement}"`, options: [{ label: `do it: ${p.statement}`, value: p.id, source: p.source, support: p.support }, { label: `do not: ${n.rule?.quote ?? n.statement}`, value: n.id, source: n.rule?.source ?? n.source, support: n.support }] });
  }
  // "today" counts only when its quote was found in a source, and a value equal to the machine's own date (the CLI injects
  // it, AM-9) only when a source shows that date: an anchored reader must not set the task's date with the brief's authority.
  const hostDates = new Set([hostDate ?? new Date().toISOString().slice(0, 10), localDate()]);
  const shown = d => [...sources.values()].some(s => String(s.text ?? '').includes(d));
  const todays = ledgers.map(L => L.today).filter(t => t?.value && t.verified && !(hostDates.has(t.value.slice(0, 10)) && !shown(t.value.slice(0, 10))));
  const todayVotes = new Map();
  for (const t of todays) { const k = t.value.slice(0, 10); const e = todayVotes.get(k) ?? { ...t, value: k, votes: 0 }; e.votes += 1; todayVotes.set(k, e); }
  const today = [...todayVotes.values()].sort((a, b) => b.votes - a.votes || Number(Boolean(b.verified)) - Number(Boolean(a.verified)))[0] ?? null;
  return { items: merged, conflicts, today, dropped: ledgers.flatMap(L => L.dropped), readers: K, readersOk: ledgers.filter(L => L.ok).length };
}

/**
 * Settle conflicts in code where a rule decides: an option whose literal is verified in a source beats an unverified one;
 * the request beats a record (more specific to this task); between two dated sources the newer wins. What remains needs
 * the adjudication call. Returns { settled: [{conflict, choice, rule}], open: [conflict] }.
 */
export function settleByCode(conflicts, sources) {
  const settled = [], open = [];
  for (const c of conflicts) {
    if (c.kind === 'value') {
      const verified = c.options.filter(o => o.verified && o.verified !== false);
      if (verified.length === 1) { settled.push({ conflict: c, choice: verified[0], rule: 'only option copied from a source' }); continue; }
      const pool = verified.length ? verified : c.options;
      const fromRequest = pool.filter(o => o.source === 'request');
      if (fromRequest.length === 1) { settled.push({ conflict: c, choice: fromRequest[0], rule: 'more specific: the request itself' }); continue; }
      const dated = pool.filter(o => o.date);
      if (dated.length === pool.length && dated.length > 1) {
        const sorted = [...dated].sort((a, b) => String(b.date).localeCompare(String(a.date)));
        if (String(sorted[0].date) !== String(sorted[1].date) && norm(sorted[0].value) !== norm(sorted[1].value)) { settled.push({ conflict: c, choice: sorted[0], rule: `newer source (${sorted[0].date})` }); continue; }
      }
    }
    open.push(c);
  }
  return { settled, open };
}

/** Apply settled and adjudicated choices to the merged ledger (in place); records every adjudication. */
export function applyDecisions(merged, decisions) {
  const log = [];
  for (const d of decisions) {
    const c = d.conflict;
    const item = merged.items.find(x => x.id === c.item);
    if (!item) continue;
    if (d.choice === null) { log.push({ about: c.about, decided: 'none', by: d.by, rule: d.rule ?? null }); if (c.kind === 'value') item.unresolved = [...(item.unresolved ?? []), c.field]; continue; }
    if (c.kind === 'value') item.fields.push({ name: c.field, value: d.choice.value, verified: d.choice.verified, source: d.choice.source, derived: Boolean(d.choice.derived), support: d.choice.support, adjudicated: d.by });
    else if (c.kind === 'eligibility') { const cand = item.candidates.find(x => x.record === c.record); if (cand) cand.eligible = d.choice.value; }
    else if (c.kind === 'polarity') { const loser = d.choice.value === c.item ? c.other : c.item; const l = merged.items.find(x => x.id === loser); if (l) l.superseded = { by: d.choice.value, how: d.by }; }
    log.push({ about: c.about, decided: d.choice.label, by: d.by, rule: d.rule ?? null, why: d.why ?? null });
  }
  merged.adjudications = [...(merged.adjudications ?? []), ...log];
  return merged;
}

/** Source spans an adjudicator needs: the records the conflicting options cite (plain text, capped). */
export function conflictSpans(conflicts, sources, maxChars = 3000) {
  const ptrs = [...new Set(conflicts.flatMap(c => c.options.map(o => o.source)).filter(p => p && sources.has(p)))];
  return ptrs.map(p => ({ ptr: p, date: sources.get(p).date, text: sources.get(p).text.replace(/\s+/g, ' ').slice(0, maxChars) }));
}

/** Map an adjudication reply onto the open conflicts: [{conflict, choice|null, by: 'adjudication', why}]. */
export function readDecisions(reply, open) {
  const ds = Array.isArray(reply?.decisions) ? reply.decisions : [];
  return open.map((c, i) => {
    const d = ds.find(x => Number(x?.point) === i + 1);
    const k = d && d.option !== 'none' ? Number(d.option) - 1 : -1;
    return { conflict: c, choice: k >= 0 && k < c.options.length ? c.options[k] : null, by: d ? 'adjudication' : 'adjudication (no answer)', why: d?.why ? String(d.why).slice(0, 300) : null };
  });
}

/** The merged ledger as prompt text for the acting session (and the brief). */
export function renderLedger(merged) {
  const live = merged.items.filter(i => !i.superseded);
  const line = i => {
    const fs = i.fields.map(f => `${f.name}=${JSON.stringify(f.value)}${f.verified === 'cited' || f.verified === 'other' ? '' : f.derived ? ' (computed)' : ' (not found verbatim in a source)'}`).join('; ');
    const cs = i.candidates.length ? ` | candidates: ${i.candidates.map(c => `${c.record} ${c.eligible === true ? 'eligible' : c.eligible === false ? 'not eligible' : 'undecided'} (${c.decidingField ?? '?'}=${c.value ?? '?'})`).join(', ')}` : '';
    const label = i.polarity === 'negative' ? 'MUST NOT' : i.support >= Math.ceil((i.of ?? 1) / 2) ? 'MUST' : 'POSSIBLE: only one reader found it; act only if the sources confirm it';
    return `- ${i.id} [${label}; ${i.action}${i.app ? ` in ${i.app}` : ''}; found by ${i.support}/${i.of} readers; source ${i.source}] ${i.statement}${i.rule ? ` (rule ${i.rule.source}: "${i.rule.quote}")` : ''}${fs ? ` | ${fs}` : ''}${cs}`;
  };
  return live.map(line).join('\n');
}
