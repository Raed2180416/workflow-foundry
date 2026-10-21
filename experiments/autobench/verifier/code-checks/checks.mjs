// code-checks verifier: deterministic checks over (request facts, initial world, world diff).
//
// Each check returns { id, family, hard, status: 'pass' | 'fail' | 'na', evidence: [...] }. Checks are generic
// conventions any automation owner could state up front (closed-world scope, verbatim values, known recipients, one
// side effect per intent, named outputs written, no unfinished placeholders). None names a task, an app-specific
// grader field or a hidden assertion (PREREG-AB-v1 H7/H8). World and diff text is untrusted data.
import { BOOKKEEPING_KEY, TRIVIAL_UPDATE_FIELD, EMAIL_RE, leaves, expandJsonText, stripHtml, lower, norm, datesIn, dayNumber,
  numbersIn, round6, knownInWorld } from './lib.mjs';

export const CHECKS_VERSION = 'cc-checks-v1';

// ---------- outputs of a diff ----------
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const MESSAGE_LIST_FIELD = /(^|\.)(conversation_parts|messages|notes|replies|comments|posts|thread|parts|internal_notes|responses)$/;

/** Flatten a diff into effects, outbound messages and output text values. */
export function collectOutputs(diff) {
  const effects = [], messages = [], texts = [], created = [], updated = [], deleted = [], createdIds = new Set();
  for (const c of diff?.changes ?? []) {
    const key = `${c.app}.${c.coll}`;
    if (c.op === 'created') {
      const rec = c.record ?? {};
      created.push({ key, app: c.app, coll: c.coll, id: c.id, record: rec });
      if (c.id !== undefined) createdIds.add(String(c.id));
      for (const k of ['id', 'uuid', 'envelope_id', 'item_id']) if (rec[k] !== undefined) createdIds.add(String(rec[k]));
      effects.push({ key, op: 'created', id: c.id });
      for (const l of leaves(rec, '', [], { skipBookkeeping: true })) for (const t of expandJsonText(l.value)) texts.push({ key, op: 'created', id: c.id, path: l.path, text: t, numeric: l.numeric });
      const m = messageOf(c.app, c.coll, rec);
      if (m) messages.push({ ...m, key, id: c.id });
    } else if (c.op === 'updated') {
      const fields = Object.entries(c.fields ?? {}).filter(([p]) => !TRIVIAL_UPDATE_FIELD.test(p));
      if (!fields.length) continue;
      updated.push({ key, app: c.app, coll: c.coll, id: c.id, ref: c.ref ?? {}, fields: Object.fromEntries(fields) });
      effects.push({ key, op: 'updated', id: c.id });
      for (const [p, [before, after]] of fields) {
        if (Array.isArray(after)) {
          const prior = Array.isArray(before) ? before : [];
          const added = after.filter(x => !prior.some(y => deepEq(x, y)));
          for (const item of added) {
            for (const l of leaves(item, p, [], { skipBookkeeping: true })) for (const t of expandJsonText(l.value)) texts.push({ key, op: 'updated', id: c.id, path: l.path, text: t });
            if (MESSAGE_LIST_FIELD.test(p) && item && typeof item === 'object') {
              const body = item.body ?? item.body_text ?? item.text ?? item.content ?? item.message ?? item.body_html;
              if (typeof body === 'string' && body.trim()) messages.push({ kind: 'reply', key, id: c.id, recipients: [], channel: null, text: stripHtml(body), internal: Boolean(item.private || item.part_type === 'note' || item.visibility === 'internal') });
            }
          }
        } else if (after !== null && after !== undefined && typeof after !== 'object') {
          texts.push({ key, op: 'updated', id: c.id, path: p, text: String(after), numeric: typeof after === 'number' });
        } else if (after && typeof after === 'object') {
          for (const l of leaves(after, p, [], { skipBookkeeping: true })) texts.push({ key, op: 'updated', id: c.id, path: l.path, text: l.value });
        }
      }
    } else if (c.op === 'deleted') {
      deleted.push({ key, app: c.app, coll: c.coll, id: c.id, ref: c.ref ?? {}, record: c.record ?? {} });
      effects.push({ key, op: 'deleted', id: c.id });
    } else if (c.op === 'set') {
      effects.push({ key, op: 'set' });
      for (const l of leaves(c.to, '', [], { skipBookkeeping: true })) texts.push({ key, op: 'set', path: l.path, text: l.value });
    }
  }
  return { effects, messages, texts, created, updated, deleted, createdIds };
}

const addrList = v => (Array.isArray(v) ? v : v ? [v] : []).flatMap(x => (typeof x === 'string' ? [x] : x && typeof x === 'object' ? [x.email ?? x.address ?? ''] : []))
  .flatMap(x => [...String(x).matchAll(EMAIL_RE)].map(m => m[0].toLowerCase()));

/** The outbound message a created record represents, if any. */
function messageOf(app, coll, rec) {
  if (app === 'gmail' && /messages|drafts/.test(coll)) {
    const draft = coll === 'drafts' || (rec.label_ids ?? []).includes('DRAFT');
    return { kind: 'email', draft, recipients: [...addrList(rec.to), ...addrList(rec.cc), ...addrList(rec.bcc)], to: addrList(rec.to), cc: [...addrList(rec.cc), ...addrList(rec.bcc)],
      channel: null, subject: rec.subject ?? '', text: `${rec.subject ?? ''}\n${rec.body_plain || stripHtml(rec.body_html ?? '')}` };
  }
  if (coll === 'messages' && typeof rec.text === 'string' && (rec.channel_id || rec.channel)) return { kind: 'chat', recipients: [], channel: rec.channel_id ?? rec.channel, text: rec.text };
  if (/posts|tweets|status/.test(coll) && typeof (rec.text ?? rec.commentary ?? rec.content) === 'string') return { kind: 'post', recipients: [], channel: null, text: rec.text ?? rec.commentary ?? rec.content };
  if (/sms|texts/.test(coll) && typeof (rec.body ?? rec.text) === 'string') return { kind: 'sms', recipients: [String(rec.to ?? '')], channel: null, text: rec.body ?? rec.text };
  return null;
}

// Recipients of any created record (emails in address-bearing fields: to, cc, attendees, signers, recipients ...).
function recordRecipients(rec) {
  const out = [];
  for (const l of leaves(rec, '')) {
    if (/(^|\.)(to|cc|bcc|attendees?|signers?|recipients?|cc_recipients|guests?|invitees?|participants?)(\[\d+\])?(\.(email|address))?$/i.test(l.path)
      || /(^|\.)(attendees|signers|cc_recipients|recipients|guests|invitees|participants)\[\d+\]\.email$/i.test(l.path)) {
      for (const m of l.value.matchAll(EMAIL_RE)) out.push(m[0].toLowerCase());
    }
  }
  return out;
}

// ---------- helpers ----------
const SENT_SPLIT = /(?<=[.!?\n])\s+|\n+/;
const NEGATION = /\b(not|never|don't|do not|no longer|must not|should not|shouldn't|cannot|can't|avoid|stop|deprecated|retired|instead|confidential|restricted|exclude[sd]?|prohibited|disallowed|only)\b/i;
/** A request detail that a world document contradicts (it names the same token in a negated sentence). */
export function contested(idx, token) {
  const t = lower(token).replace(/^#/, '');
  if (t.length < 3) return false;
  for (const sent of idx.worldBlob.split(SENT_SPLIT)) {
    if (sent.length > 600 || !sent.includes(t)) continue;
    if (NEGATION.test(sent)) return true;
  }
  return false;
}

const regexEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SLOT_RE = /<[^<>]{1,40}>|\[[^\[\]]{1,40}\]|\{[^{}]{1,40}\}/g;
/** A literal or template from the request as a matcher over output strings. */
export function literalMatcher(lit) {
  const s = norm(lit);
  const parts = s.split(SLOT_RE).map(p => regexEscape(p).replace(/\s+/g, '\\s*'));
  const slots = (s.match(SLOT_RE) ?? []).length;
  const re = new RegExp(parts.join('(.{1,120}?)'), 'i');
  return { re, slots, literal: s, test: text => { const m = norm(text).match(re); if (!m) return false; return m.slice(1).every(g => !/^[<\[{].*[>\]}]$/.test(g.trim())); } };
}

const NAME_KEY = /(^|[._ ])(name|full_?name|first_?name|last_?name|company|company_?name|vendor|employee|customer|account|account_?name|contact|candidate|client|partner|system|title|subject|summary|topic|item_?name|product|organization|org)$/i;
/** Display names of a record: its name-like fields (cells included), strings of 3+ characters. */
export function namesOf(rec) {
  const out = new Set();
  const visit = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 2) return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && NAME_KEY.test(k) && v.trim().length >= 3 && !/@/.test(v)) out.add(v.trim());
      else if (v && typeof v === 'object' && !Array.isArray(v) && (k === 'cells' || k === 'fields' || k === 'properties' || k === 'ref')) visit(v, depth + 1);
    }
    if (typeof o.first_name === 'string' && typeof o.last_name === 'string') out.add(`${o.first_name} ${o.last_name}`.trim());
  };
  visit(rec);
  return [...out];
}
const emailsOf = rec => [...JSON.stringify(rec ?? {}).matchAll(EMAIL_RE)].map(m => m[0].toLowerCase());

// ---------- checks ----------
const result = (id, family, hard, status, evidence = []) => ({ id, family, hard, status, evidence: evidence.slice(0, 6) });

const INCOMPLETE_STRONG = [
  /\b(?:could not|couldn't|cannot|can't|can not|unable to|was unable to|were unable to|not able to|wasn't able to|weren't able to|failed to)\s+(?:be\s+)?(?:fully\s+)?(?:complete[d]?|calculate[d]?|determine[d]?|find|found|locate[d]?|access(?:ed)?|verif(?:y|ied)|confirm(?:ed)?|process(?:ed)?|total(?:ed|led)?|retrieve[d]?|identif(?:y|ied)|create[d]?|send|sent|schedule[d]?|book(?:ed)?|post(?:ed)?|update[d]?|add(?:ed)?|pull(?:ed)?|compute[d]?|establish(?:ed)?|obtain(?:ed)?|resolve[d]?|perform(?:ed)?|finish(?:ed)?|generate[d]?|run|load(?:ed)?|read|open(?:ed)?|match(?:ed)?)\b/i,
  /\b(?:TBD|TBA|to be determined|to be confirmed)\b/,
  /\bwill be (?:sent|provided|shared|completed|calculated|updated|scheduled|finali[sz]ed) (?:once|when|after)\b/i,
  /\bonce (?:the |we |you |it |this |that )?[^.\n]{0,50}\b(?:is|are|has been|have been) (?:confirmed|established|available|provided|connected|resolved|fixed)\b/i,
  /\bnot (?:yet )?(?:been )?(?:completed|done|implemented|created|posted|calculated|finali[sz]ed)\b/i,
  /\b(?:pending manual|requires? manual|manual (?:posting|entry|follow-?up|step|action)s? (?:is |are )?(?:required|needed|pending))\b/i,
  /\b(?:no (?:connected )?(?:credentials|access|integration)|(?:is|are|was|were) not (?:connected|accessible)|not connected)\b/i,
];
const INCOMPLETE_WEAK = [
  /\b(?:please (?:confirm|verify|provide|advise|let (?:me|us) know))\b/i,
  /\b(?:has no|there is no|there are no|does not exist|doesn't exist|not found|no matching|could not be found)\b/i,
  /\b(?:I|we) (?:did not|didn't|could not|couldn't|was unable|were unable)\b/,
];

const PLACEHOLDER_GENERIC = [
  /\[(?:your|recipient|customer|company|name|first ?name|last ?name|date|amount|insert|employee|manager|vendor|contact|client|title|link|url|phone|signature|sender)[^\]\n]{0,25}\]/i,
  /\{\{\s*[\w .-]{1,40}\s*\}\}/,
  /<(?:your |insert |recipient|customer|company|name|first name|last name|employee|manager|vendor|contact|client|system)[A-Za-z ]{0,25}>/i,
  /\blorem ipsum\b/i, /\bXXX+\b/,
];

const EXCLUSION_WORDING = /\b(?:skip(?:ped|ping)?|exclud(?:ed|ing)|exclusions?|not eligible|ineligible|did(?: not|n't) qualify|does(?: not|n't) qualify|disqualified|not processed|(?:were|was) not (?:included|processed|scheduled|selected|approved)|reject(?:ed|ion)|declined|on hold|not included|left out|omitted)\b/i;

/** Run every check. view: {prompt, today, services, diff}; idx: indexWorld(world0); det: deterministicFacts; hf: Haiku facts or null. */
export function runChecks({ view, idx, det, hf = null, world0 = null }) {
  const out = collectOutputs(view.diff);
  const checks = [];
  const outText = out.texts.map(t => t.text);
  const msgs = out.messages.filter(m => !m.draft);
  const msgText = msgs.map(m => m.text).join('\n');
  const allOutLower = lower(outText.join('\n') + '\n' + msgText);
  const promptIds = new Set(det.ids);
  const createdRecipients = new Set([...msgs.flatMap(m => m.recipients), ...out.created.flatMap(c => recordRecipients(c.record))]);

  // 1. Something was done.
  checks.push(result('effect.nonempty', 'effect', true, out.effects.length ? 'pass' : 'fail', out.effects.length ? [] : ['no effectful change in the world']));

  // 2. The agent's own outputs admit the work is unfinished.
  {
    const strong = [], weak = [];
    const scan = [...msgs.filter(m => !m.internal).map(m => m.text), ...out.texts.filter(t => !/^gmail\.|^slack\./.test(t.key)).map(t => t.text)];
    // When the request asks for outcome notices, "could not / unable to <verb>" is how a decline is worded: not counted.
    const strongRes = det.outcomeNoticesRequested || hf?.outcome_notices_requested === true ? INCOMPLETE_STRONG.slice(1) : INCOMPLETE_STRONG;
    for (const t of scan) {
      const s = stripHtml(t);
      for (const re of strongRes) { const m = s.match(re); if (m) strong.push(m[0]); }
      for (const re of INCOMPLETE_WEAK) { const m = s.match(re); if (m) weak.push(m[0]); }
    }
    checks.push(result('text.incomplete', 'text', true, !out.effects.length ? 'na' : strong.length ? 'fail' : 'pass', strong));
    checks.push(result('text.incomplete_weak', 'text', false, !out.effects.length ? 'na' : weak.length ? 'fail' : 'pass', weak));
  }

  // 3. Unfilled template slots or generic placeholders in outputs.
  {
    const hits = [];
    const slotLits = det.slots.map(s => lower(s));
    for (const t of [...outText, ...msgs.map(m => m.text)]) {
      const l = lower(t);
      for (const s of slotLits) if (l.includes(s)) hits.push(s);
      for (const re of PLACEHOLDER_GENERIC) { const m = String(t).match(re); if (m) hits.push(m[0]); }
    }
    checks.push(result('text.placeholder', 'text', true, !out.effects.length ? 'na' : hits.length ? 'fail' : 'pass', hits));
  }

  // 4. Dates in outputs anchored to the task's own time (a wall-clock date leaking into records is a classic defect).
  {
    const metaDay = typeof idx.meta.current_time === 'string' ? idx.meta.current_time.slice(0, 10) : null;
    const today = det.today ?? metaDay;
    const worldDays = [...idx.dates].map(dayNumber).filter(Number.isFinite);
    const maxWorld = worldDays.length ? Math.max(...worldDays) : null;
    const bad = [];
    if (today) {
      const t0 = dayNumber(today);
      const anchorMax = Math.max(t0, maxWorld ?? t0);
      for (const t of [...outText, ...msgs.map(m => m.text)]) for (const d of datesIn(t)) {
        if (idx.dates.has(d)) continue;
        const dn = dayNumber(d);
        if (dn - anchorMax > 120 || t0 - dn > 730) bad.push(d);
      }
    }
    checks.push(result('text.date_anchor', 'text', true, !today || !out.effects.length ? 'na' : bad.length ? 'fail' : 'pass', [...new Set(bad)]));
  }

  // 5. Every recipient exists in the world or the request (no invented addresses).
  {
    const unknown = [...createdRecipients].filter(a => !idx.emails.has(a));
    checks.push(result('target.recipients_known', 'target', true, createdRecipients.size ? (unknown.length ? 'fail' : 'pass') : 'na', unknown));
  }

  // 6. References in created records resolve (to the world, the request, or something created in this session).
  {
    // Entity references only (containers and records); schema fields such as column ids and service-minted values such
    // as author ids are not references the agent chose.
    const REF_KEY = /(^|\.)(board|board_id|boardId|list|list_id|listId|project|projects|project_id|projectId|workspace|workspace_id|parent_page|parent_id|parentId|page_id|pageId|space|space_id|spaceId|cloudId|calendar|calendar_id|calendarId|spreadsheet_id|spreadsheetId|worksheet_id|worksheetId|base|base_id|baseId|applicationId|table|table_id|tableId|tableName|recordId|record_id|folder|folder_id|folderId|database_id|databaseId|pipeline_id|account_id|accountId|contact_id|contactId|opportunity_id|lead_id|deal_id|ticket_id|conversation_id|customer_id|item_id|itemId|card_id|task_id|channel_id|channelId|template_id|templateId|who_id|what_id)(\[\d+\])?$/;
    const unresolved = [], composite = [];
    for (const c of out.created) for (const l of leaves(c.record, '')) {
      if (!REF_KEY.test(l.path) || l.numeric) continue;
      const v = l.value.trim();
      if (!v || v.length > 80 || /\s{2,}/.test(v)) continue;
      if (idx.strings.has(v) || promptIds.has(v) || out.createdIds.has(v) || idx.lowerStrings.has(lower(v))) continue;
      if (v.length >= 3 && !v.includes('/') && /[A-Z0-9_]/.test(v) && new RegExp(`(^|[^A-Za-z0-9_])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_]|$)`).test(idx.promptText)) continue;
      if (/^[#@]/.test(v) && (idx.strings.has(v.slice(1)) || [...idx.channels.values()].includes(v.slice(1)))) continue;
      if (v.includes('/')) {
        const parts = v.split('/').map(p => p.trim()).filter(Boolean);
        if (parts.length >= 2 && parts.every(p => promptIds.has(p) || idx.strings.has(p))) { composite.push(`${l.path}=${v}`); continue; }
      }
      if (/^\d+$/.test(v) || /^[0-9a-f-]{16,}$/i.test(v)) continue; // ids minted by a service in this session
      unresolved.push(`${l.path}=${v}`);
    }
    checks.push(result('target.refs_composite', 'target', true, out.created.length ? (composite.length ? 'fail' : 'pass') : 'na', composite));
    checks.push(result('target.refs_resolve', 'target', false, out.created.length ? (unresolved.length ? 'fail' : 'pass') : 'na', unresolved));
  }

  // 7. Outputs the request names explicitly were written: addresses, #channels, target ids.
  {
    const missing = [], skippedContested = [];
    const sentTo = new Set([...msgs.filter(m => m.kind === 'email').flatMap(m => m.recipients), ...createdRecipients]);
    for (const e of det.emails.filter(e => e.role !== 'source')) {
      if (sentTo.has(e.address)) continue;
      if (contested(idx, e.address)) { skippedContested.push(e.address); continue; }
      missing.push(`email ${e.address}`);
    }
    const chatChannels = new Set(msgs.filter(m => m.kind === 'chat').map(m => String(m.channel)));
    const chanNames = new Set([...chatChannels].map(c => lower(idx.channels.get(c) ?? createdChannelName(out, c) ?? c).replace(/^#/, '')));
    for (const ch of det.channels) {
      if (chanNames.has(ch) || chatChannels.has(ch)) continue;
      if (contested(idx, '#' + ch) || contested(idx, ch)) { skippedContested.push('#' + ch); continue; }
      missing.push(`#${ch}`);
    }
    // Ids that exist nowhere in the world can only be places to write to.
    const written = new Set(out.texts.map(t => t.text.trim()).concat(out.updated.flatMap(u => Object.values(u.ref ?? {}).map(String))));
    const writtenBlob = [...written].join('\n');
    for (const id of det.ids) {
      if (idx.strings.has(id)) continue;
      if (written.has(id) || writtenBlob.includes(id)) continue;
      missing.push(`id ${id}`);
    }
    // Haiku facts: per output, at least one effect in its app; explicit target tokens written.
    if (hf?.outputs?.length) {
      const appsTouched = new Set(out.effects.map(e => e.key.split('.')[0]));
      for (const o of hf.outputs) {
        const app = String(o.app ?? '').toLowerCase();
        if (!app || app === 'unknown' || !(view.services ?? []).includes(app)) continue;
        if (appsTouched.has(app)) continue;
        if (o.target && contested(idx, o.target)) { skippedContested.push(o.target); continue; }
        if (app === 'google_drive') continue;
        missing.push(`app ${app} (${o.action})`);
      }
    }
    const any = det.emails.length || det.channels.length || det.ids.some(id => !idx.strings.has(id)) || hf?.outputs?.length;
    checks.push(result('target.named_outputs', 'target', true, !any ? 'na' : missing.length ? 'fail' : 'pass', [...missing, ...skippedContested.map(s => `contested:${s}`)]));
  }

  // 8. Literal texts and templates the request prescribes appear in the outputs.
  {
    const lits = new Set(det.quoted.filter(q => q.output).map(q => q.text));
    for (const o of hf?.outputs ?? []) for (const l of o.literals ?? []) if (typeof l === 'string' && l.trim().length >= 2 && l.length <= 120) lits.add(l.trim());
    const pool = [...outText, ...msgs.map(m => m.subject ?? ''), ...msgs.map(m => m.text)].filter(Boolean);
    const missing = [];
    for (const lit of lits) {
      if (!/[A-Za-z]/.test(lit)) continue;
      const m = literalMatcher(lit);
      if (pool.some(t => m.test(t))) continue;
      // A bare value (no slot) that already sits in the world unchanged is a lookup key, not an output: skip it.
      if (!m.slots && knownInWorld(idx, lit) && !det.quoted.some(q => q.output && q.text === lit)) continue;
      if (contested(idx, lit)) continue;
      missing.push(lit);
    }
    checks.push(result('target.literals', 'target', true, !lits.size || !out.effects.length ? 'na' : missing.length ? 'fail' : 'pass', missing));
  }

  // 9. Values copied from the source are not rounded or truncated.
  {
    const src = idx.numbers.filter(n => Math.abs(n.value) >= 1);
    const rounded = [];
    const seen = new Set();
    for (const t of [...msgs.map(m => m.text), ...out.texts.filter(x => !x.numeric).map(x => x.text)]) for (const n of numbersIn(stripHtml(t))) {
      if (idx.numberValues.has(round6(n.value)) || Math.abs(n.value) < 10 || seen.has(n.raw)) continue;
      seen.add(n.raw);
      const near = src.find(s => s.decimals > n.decimals && s.value !== n.value && Math.abs(s.value - n.value) <= 0.5 * 10 ** -n.decimals + 1e-9 && Math.abs(s.value) >= 10);
      if (near) rounded.push(`${n.raw}~${near.raw}`);
    }
    checks.push(result('value.verbatim_numbers', 'value', false, !msgs.length && !out.texts.length ? 'na' : rounded.length ? 'fail' : 'pass', rounded));
  }

  // 10. No duplicate side effects (the same message or record twice).
  {
    const sig = new Map(), dups = [];
    for (const c of out.created) {
      const r = c.record;
      let s;
      if (c.app === 'gmail') s = `${c.key}|${[...addrList(r.to)].sort().join(',')}|${lower(r.subject ?? '')}`;
      else if (c.coll.startsWith('actions.')) s = `${c.key}|${lower(JSON.stringify(Object.fromEntries(Object.entries(r.params ?? {}).filter(([k]) => /name|title|summary|topic|item_name|subject/i.test(k)))))}`;
      else s = `${c.key}|${lower(leaves(r, '', [], { skipBookkeeping: true }).filter(l => !/(^|\.)(row_id|id)$/.test(l.path)).map(l => `${l.path}=${l.value}`).join('|'))}`;
      if (s.endsWith('|{}') || s.endsWith('|')) continue;
      if (sig.has(s)) dups.push(s.slice(0, 140)); else sig.set(s, c.id);
    }
    for (const m of msgs.filter(x => x.kind === 'reply')) {
      const s = `${m.key}|${m.id}|${lower(m.text).slice(0, 300)}`;
      if (sig.has(s)) dups.push(s.slice(0, 140)); else sig.set(s, m.id);
    }
    checks.push(result('effect.duplicates', 'effect', false, out.created.length + msgs.length ? (dups.length ? 'fail' : 'pass') : 'na', dups));
  }

  // 11. Skipped or excluded items are not enumerated in outbound messages (the request's own reporting rule), unless the
  //     request asks for outcome or rejection notices.
  {
    const outcome = det.outcomeNoticesRequested || hf?.outcome_notices_requested === true;
    const hits = [];
    for (const m of msgs.filter(x => !x.internal)) { const h = stripHtml(m.text).match(EXCLUSION_WORDING); if (h) hits.push(h[0]); }
    checks.push(result('scope.no_skip_enumeration', 'scope', false, outcome || !msgs.length ? 'na' : hits.length ? 'fail' : 'pass', hits));
  }

  // 12. When the request asks for names of affected entities, every updated entity is named in some message.
  {
    let status = 'na'; const unnamed = [];
    const affected = [
      ...out.updated.map(u => [...namesOf(u.ref), ...namesOf(findRecord(world0, u.app, u.coll, u.id) ?? {})]),
      ...out.created.filter(c => !messageOf(c.app, c.coll, c.record) && !/channels$/.test(c.coll)).map(c => namesOf(c.coll.startsWith('actions.') ? (c.record.params ?? {}) : c.record)),
    ].map(ns => [...new Set(ns)].filter(n => n.length >= 3 && !/^\d+$/.test(n))).filter(ns => ns.length);
    if (det.namesRequired && msgs.length && affected.length) {
      const text = lower(msgText);
      for (const names of affected) if (!names.some(n => text.includes(lower(n)))) unnamed.push(names[0]);
      status = unnamed.length ? 'fail' : 'pass';
    }
    checks.push(result('scope.names_in_messages', 'scope', false, status, unnamed));
  }

  // 13. When the request asks for amounts from the source, each outbound message carries at least one source number verbatim.
  {
    let status = 'na'; const without = [];
    if (det.amountsRequired && msgs.length) {
      for (const m of msgs.filter(x => x.kind !== 'reply' || !x.internal)) {
        const ns = numbersIn(stripHtml(m.text));
        if (!ns.some(n => idx.numberRaws.has(n.raw.replace(/^-?\$/, '')) || (Math.abs(n.value) >= 10 && idx.numberValues.has(round6(n.value))))) without.push(lower(m.text).slice(0, 60));
      }
      status = without.length ? 'fail' : 'pass';
    }
    checks.push(result('value.amounts_in_messages', 'value', false, status, without));
  }

  // 14. No deletions unless the request asks for removal; no writes to records the request names as read-only sources.
  {
    const bad = [];
    if (!det.deletionRequested && hf?.deletions_requested !== true) for (const d of out.deleted) bad.push(`deleted ${d.key}:${d.id}`);
    const sources = new Set((hf?.sources ?? []).map(s => String(s).trim()).filter(s => /^[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+$/.test(s)));
    const targets = new Set((hf?.outputs ?? []).map(o => String(o.target ?? '')).concat(hf?.tracker?.target ?? '').flatMap(t => t.split(/[\/,\s]+/)));
    for (const u of out.updated) {
      const refVals = Object.values(u.ref ?? {}).map(String);
      const base = findRecord(world0, u.app, u.coll, u.id);
      const containers = [...refVals, ...['spreadsheet_id', 'worksheet_id', 'base_id', 'table_id', 'board_id', 'list_id'].map(k => base?.[k]).filter(Boolean)];
      const hit = containers.find(c => sources.has(c) && !targets.has(c));
      if (hit) bad.push(`updated read-only ${hit}:${u.id}`);
    }
    checks.push(result('scope.no_unrequested_mutation', 'scope', false, !out.effects.length ? 'na' : bad.length ? 'fail' : 'pass', bad));
  }

  // 15. A tracker or log the request names was written (and, per item, as often as the per-item messages).
  {
    let status = 'na'; const ev = [];
    const tr = hf?.tracker;
    if (tr?.present) {
      const toks = String(tr.target ?? '').split(/[\/,\s]+/).filter(t => /_/.test(t));
      const writes = out.effects.filter(e => !/^gmail\.|^slack\./.test(e.key));
      let hit;
      if (toks.length) hit = toks.some(t => out.texts.some(x => x.text.includes(t)) || out.updated.some(u => Object.values(u.ref ?? {}).map(String).includes(t)) || updatedIn(world0, out, t));
      else hit = writes.length > 0;
      if (!hit) ev.push(`no write to tracker ${tr.target || '(unnamed)'}`);
      status = hit ? 'pass' : 'fail';
    }
    checks.push(result('log.tracker_written', 'log', true, status, ev));
  }

  // 16. Per-item outputs agree in count (closed world across channels: every item that got one per-item effect got the others).
  {
    let status = 'na'; const ev = [];
    const per = (hf?.outputs ?? []).filter(o => o.per_entity && (view.services ?? []).includes(String(o.app).toLowerCase()));
    if (per.length >= 2) {
      const fixed = new Set(det.emails.map(e => e.address));
      const counts = per.map(o => ({ o, n: countFor(o, out, msgs, fixed) })).filter(x => x.n !== null);
      if (counts.length >= 2) {
        const ns = counts.map(x => x.n), mx = Math.max(...ns), mn = Math.min(...ns);
        status = mx > 0 && mn === 0 ? 'fail' : 'pass';
        ev.push(...counts.map(x => `${x.o.app}:${x.o.action}=${x.n}`));
      }
    }
    checks.push(result('scope.per_entity_consistency', 'scope', false, status, status === 'fail' ? ev : []));
  }

  // 17. Closed-world scope: the request's explicit selection (all/each X where field = value) is fully handled and
  //     nothing outside it in the same collection was changed.
  {
    let status = 'na'; const ev = [];
    const sc = hf?.scope;
    if (sc && (sc.conditions ?? []).length && world0) {
      const res = scopeCoverage(world0, sc, out, msgText);
      if (res) {
        const missed = ['all', 'each'].includes(sc.quantifier) ? res.missing : [];
        checks.push(result('scope.closed_world_missed', 'scope', false, missed.length ? 'fail' : 'pass', missed.map(m => `missed ${m}`)));
        checks.push(result('scope.closed_world_outside', 'scope', false, res.outside.length ? 'fail' : 'pass', res.outside.map(m => `outside ${m}`)));
        status = 'done';
      }
    }
    if (status !== 'done') for (const id of ['scope.closed_world_missed', 'scope.closed_world_outside']) checks.push(result(id, 'scope', false, 'na', ev));
  }
  return { checks, outputs: { nEffects: out.effects.length, nMessages: msgs.length, nCreated: out.created.length, nUpdated: out.updated.length, nDeleted: out.deleted.length } };
}

function createdChannelName(out, id) {
  const c = out.created.find(x => x.key === 'slack.channels' && String(x.id) === String(id));
  return c?.record?.name ?? null;
}

export function findRecord(world, app, coll, id) {
  const arr = world?.[app]?.[coll];
  if (!Array.isArray(arr)) return null;
  return arr.find(r => r && String(r.id) === String(id)) ?? null;
}
function updatedIn(world0, out, token) {
  return out.updated.some(u => { const b = findRecord(world0, u.app, u.coll, u.id); return b && Object.values(b).map(String).includes(token); })
    || out.created.some(c => Object.values(c.record ?? {}).map(String).includes(token));
}

function countFor(o, out, msgs, fixed) {
  const app = String(o.app).toLowerCase();
  if (app === 'gmail') { const r = new Set(msgs.filter(m => m.kind === 'email').flatMap(m => m.to.length ? m.to : m.recipients).filter(a => !fixed.has(a))); return r.size || null; }
  if (app === 'slack') return null; // channel posts are usually summaries, not per item
  const eff = out.effects.filter(e => e.key.split('.')[0] === app && (e.op === 'created' || e.op === 'updated'));
  return new Set(eff.map(e => `${e.key}:${e.id}`)).size;
}

/** Records matching the request's explicit conditions in the best-matching collection, and how they were handled. */
export function scopeCoverage(world0, scope, out, msgText) {
  const conds = scope.conditions.filter(c => c && String(c.value ?? '').trim());
  if (!conds.length) return null;
  const groups = [];
  for (const [app, v] of Object.entries(world0)) {
    if (app === 'meta' || !v || typeof v !== 'object') continue;
    for (const [coll, arr] of Object.entries(v)) {
      if (!Array.isArray(arr) || !arr.length || typeof arr[0] !== 'object') continue;
      const byContainer = new Map();
      for (const r of arr) { const k = r.worksheet_id ? `${coll}:${r.worksheet_id}` : coll; if (!byContainer.has(k)) byContainer.set(k, []); byContainer.get(k).push(r); }
      for (const [k, rs] of byContainer) groups.push({ app, coll, key: `${app}.${k}`, records: rs });
    }
  }
  const flat = r => Object.entries({ ...r, ...(r.cells ?? {}), ...(r.fields ?? {}), ...(r.properties ?? {}) });
  const matches = (r, c) => {
    const want = lower(c.value), fld = lower(c.field).replace(/[^a-z0-9]/g, '');
    const kv = flat(r).filter(([, v]) => typeof v === 'string' || typeof v === 'number');
    const fieldHits = kv.filter(([k]) => { const kk = lower(k).replace(/[^a-z0-9]/g, ''); return fld && (kk === fld || kk.includes(fld) || fld.includes(kk)); });
    const pool = fieldHits.length ? fieldHits : kv;
    return pool.some(([, v]) => lower(v) === want);
  };
  const hasField = (r, c) => { const fld = lower(c.field).replace(/[^a-z0-9]/g, ''); return fld && flat(r).some(([k]) => { const kk = lower(k).replace(/[^a-z0-9]/g, ''); return kk === fld || kk.includes(fld) || fld.includes(kk); }); };
  const touchedIds = new Set([...out.updated.map(u => `${u.app}.${u.coll}:${u.id}`), ...out.deleted.map(d => `${d.app}.${d.coll}:${d.id}`)]);
  const text = lower(msgText + '\n' + out.texts.map(t => t.text).join('\n'));
  let best = null;
  for (const g of groups) {
    if (!g.records.some(r => conds.every(c => hasField(r, c)))) continue;
    const inScope = g.records.filter(r => conds.every(c => matches(r, c)));
    if (!inScope.length || inScope.length === g.records.length && g.records.length > 1 && false) continue;
    const touched = g.records.filter(r => touchedIds.has(`${g.app}.${g.coll}:${r.id}`));
    const score = inScope.length + 2 * touched.length;
    if (!best || score > best.score) best = { g, inScope, touched, score };
  }
  if (!best || !best.touched.length && !best.inScope.some(r => mentioned(r, text))) return null;
  const label = r => namesOf(r)[0] ?? String(r.id);
  const missing = best.inScope.filter(r => !touchedIds.has(`${best.g.app}.${best.g.coll}:${r.id}`) && !mentioned(r, text)).map(label);
  const outside = best.touched.filter(r => !best.inScope.includes(r)).map(label);
  return { collection: best.g.key, inScope: best.inScope.length, missing, outside };
}
function mentioned(r, text) {
  const names = namesOf(r).filter(n => n.length >= 4);
  const em = emailsOf(r);
  return names.some(n => text.includes(lower(n))) || em.some(e => text.includes(e));
}
