// requirement-ledger-v3 (Δ* v1): adapters from STORED reader outputs to Δ*'s reader input (dstar.mjs buildDstar).
//
// The $0 replays of ATTACK Move 1 ask what Δ* reaches with the readers' EXISTING rules, before any reader is asked to
// write predicates. Two stored reader families exist on dev60:
//   - A1-C v1 pipeline ledgers (pipeline/ledgers.json): per requirement a target, fields, a rule quote, and candidates
//     with a deciding field and value (a test code can execute on the member's own row);
//   - requirement-ledger-v2 (RL2) extractions: items with in_scope and a reason, and typed requirements with quotes.
// Adapters only translate shapes. Every claim stays a claim: dstar.mjs verifies tests on the records and quotes in the
// sources, and a claim that does not verify never compiles to a hard check.
// Generic by construction (PREREG-AB-v1 H7/H8). Reader outputs are untrusted data.
import { emailsIn, indexWorld, norm, resolvePtr } from './lib.mjs';
import { universesFromWorld } from './universe.mjs';

/** A bridge from a world pointer (app.coll:id or an alias such as google_sheets.rows:x3, as RL2 wrote them) to the stable
 *  member key (google_sheets:row:<ss>/<ws>#<row>, or app.coll:id), which inventory universes also resolve. */
export function worldBridge(world) {
  const idx = indexWorld(world);
  const keyOf = new Map();
  for (const u of universesFromWorld(world, idx)) for (const m of u.members) { keyOf.set(m.ptr, m.key); if (m.alias) keyOf.set(m.alias, m.key); }
  return p => { const r = resolvePtr(p, idx); return r ? keyOf.get(r.ptr) ?? r.ptr : String(p ?? ''); };
}

export const ADAPTERS_VERSION = 'rl3-adapters-v1';
const str = v => (v === null || v === undefined ? '' : String(v));
const MSG_FIELD = /^(body|text|message|content|subject|summary|description|note|notes|title|comment|reply)$/i;

/** A v1 target text -> {emails, channel, container, ptr}. */
export function parseV1Target(t, fields = []) {
  const s = str(t).trim();
  const out = { emails: emailsIn(s), channel: null, container: null, ptr: null };
  for (const f of fields) if (/^(to|cc|recipient|recipients|email)$/i.test(str(f.name))) for (const e of emailsIn(f.value)) if (!out.emails.includes(e)) out.emails.push(e);
  const ch = /#([a-z0-9][a-z0-9_-]*)/i.exec(s) ?? null;
  const chId = /\b(C[A-Z0-9_]{2,})\b/.exec(s);
  const chField = fields.find(f => /^channel$/i.test(str(f.name)));
  if (ch || chId || chField) out.channel = { id: chId?.[1] ?? null, name: ch?.[1] ?? (str(chField?.value).replace(/^#/, '') || null) };
  if (!out.emails.length && !out.channel) {
    const p = /([a-z0-9_]+:[A-Za-z0-9_]+:[^\s()]+|[A-Za-z0-9_]+\/[A-Za-z0-9_ -]+#\d+)/.exec(s);
    if (p) out.ptr = p[1];
    const c = /^([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)$/.exec(s);
    if (c) out.container = c[1];
  }
  return out;
}

/** One A1-C v1 reader ledger (an element of ledgers.json `ledgers`) -> a Δ* reader input. */
export function adaptA1cLedger(ledger, { tag = 'a1c' } = {}) {
  const reader = `${tag}:${ledger.reader}`;
  const R = { reader, today: ledger.today?.value ? { value: ledger.today.value, quote: ledger.today.quote, source: ledger.today.source } : null, obligations: [], exclusions: [], prohibitions: [] };
  for (const q of ledger.requirements ?? []) {
    const fields = q.fields ?? [];
    const target = parseV1Target(q.target, fields);
    const quote = q.rule?.quote ? { text: q.rule.quote, source: q.rule.source } : null;
    if (q.polarity === 'negative') {
      const lits = fields.filter(f => MSG_FIELD.test(str(f.name)) && str(f.value).trim().length >= 2).map(f => str(f.value));
      if (target.ptr && /^(update_row|update_record|delete_record|other)$/.test(q.action)) R.exclusions.push({ id: q.id, effect: q.action === 'other' ? 'update_record' : q.action, app: q.app, members: [{ ptr: target.ptr, quote }], perItem: true, quote });
      else R.prohibitions.push({ id: q.id, effect: q.action, app: q.app, target, literals: lits, quote, statement: str(q.statement) });
      continue;
    }
    const literals = fields.filter(f => MSG_FIELD.test(str(f.name)) && str(f.value).trim().length >= 2 && !f.derived).map(f => str(f.value));
    const setField = fields.find(f => !MSG_FIELD.test(str(f.name)) && !/^(to|cc|bcc|recipient|recipients|email|channel|record|row|id)$/i.test(str(f.name)) && str(f.value).trim() && !f.derived);
    const noteField = fields.find(f => /^(note|notes|comment|comments|reply|body|text|message)$/i.test(str(f.name)));
    const set = /^(update_row|update_record)$/.test(q.action) ? (noteField && /note|comment|reply/i.test(str(noteField.name)) ? { field: noteField.name, value: '' } : setField ? { field: setField.name, value: setField.value } : null) : null;
    const ob = { id: q.id, effect: q.action, app: q.app, target, literals, quote, source: q.source, set, selections: [], figures: [] };
    const cands = (q.candidates ?? []).filter(c => c && c.record);
    if (cands.length) ob.selections.push({ members: cands.map(c => ({ ptr: c.record, in: c.eligible === true, test: c.decidingField ? { field: c.decidingField, value: c.value } : null, quote: null })), perItem: null });
    R.obligations.push(ob);
  }
  return R;
}

/**
 * One stored RL2 extraction (`value` of an extract.jsonl row) -> a Δ* reader input. `bridge(ptr)` maps an RL2 world
 * pointer (app.coll:id or an alias) to a pointer the target universes resolve (the stable key); identity by default.
 * Items become the selection of every obligation that names at least one item (by pointer, label or literal); an item's
 * exclusion carries a quote only when an RL2 must_not requirement cites that item with one.
 */
export function adaptRl2Extraction(value, { tag = 'rl2', reader = 0, bridge = p => p } = {}) {
  const R = { reader: `${tag}:${reader}`, today: value?.today && /\d{4}-\d{2}-\d{2}/.test(str(value.today)) ? { value: str(value.today).replace(/"/g, ''), quote: null, source: null } : null, obligations: [], exclusions: [], prohibitions: [] };
  const items = (value?.items ?? []).filter(i => i && i.ptr);
  const itemQuote = new Map();
  for (const q of value?.requirements ?? []) if (q?.kind === 'must_not' && q.item && q.quote) itemQuote.set(str(q.item), { text: q.quote, source: q.source && q.source !== 'request' ? bridge(q.source) : 'request' });
  // an obligation names an item by pointer, by the item's label, or by a literal it must carry that the item's own label or
  // reason holds (an amount, an id)
  const labelHit = (q) => {
    const text = norm([q.statement, ...(q.must_include ?? []), q.value].map(str).join(' '));
    const lits = (q.must_include ?? []).map(x => norm(x)).filter(x => x.length >= 3);
    return items.filter(i => (q.item && str(q.item) === str(i.ptr)) || (i.label && norm(i.label).length >= 3 && text.includes(norm(i.label)))
      || lits.some(l => norm(`${i.label} ${i.reason}`).includes(l)));
  };
  for (const q of value?.requirements ?? []) {
    if (!q || typeof q !== 'object') continue;
    const target = { emails: (q.recipients ?? []).flatMap(emailsIn), channel: q.channel ? { id: null, name: str(q.channel).replace(/^#/, '') } : null, container: q.container ? str(q.container) : null, ptr: q.record ? bridge(q.record) : null };
    const quote = q.quote ? { text: q.quote, source: q.source && q.source !== 'request' ? bridge(q.source) : 'request' } : null;
    if (q.kind === 'must_not') {
      if (q.item && !target.emails.length && !target.channel) R.exclusions.push({ id: q.id, effect: q.effect, app: q.app, members: [{ ptr: bridge(q.item), quote }], perItem: true, quote });
      else R.prohibitions.push({ id: q.id, effect: q.effect, app: q.app, target, literals: (q.must_not_include ?? []).map(str), quote, statement: str(q.statement) });
      continue;
    }
    const set = /^(update_record|update_row)$/.test(q.effect) && str(q.field).trim() ? { field: str(q.field), value: str(q.value) } : null;
    const ob = { id: q.id, effect: q.effect, app: q.app, target, literals: (q.must_include ?? []).map(str), quote, source: q.source, set, selections: [], figures: [] };
    // a per-item requirement (an item and that item's own recipient) is about that item only; an aggregate one that names
    // at least one item enumerates the items' set, so the excluded items are its complement (all-and-only)
    if (q.item && (target.emails.length || target.ptr)) ob.selections.push({ members: [{ ptr: bridge(q.item), in: true, test: null, quote: null }], perItem: true, partial: true });
    else if (items.length && labelHit(q).length) {
      ob.selections.push({ members: items.map(i => ({ ptr: bridge(i.ptr), in: i.in_scope === true, test: null, quote: i.in_scope === true ? null : itemQuote.get(str(i.ptr)) ?? null })), perItem: null });
    }
    R.obligations.push(ob);
  }
  return R;
}
