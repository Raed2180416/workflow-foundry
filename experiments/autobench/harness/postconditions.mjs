// POSTCONDITIONS and CHECK of arm A1-C (harness/codeowned.mjs). Executable checks over world state, written by code from
// the merged ledger BEFORE the acting session, evaluated by code after it on a fresh read of the world (the same
// enumeration code as the inventory, through the same bridge mailbox). A check grammar per system, filled with values
// code copied from sources:
//   gmail_sent       {to[], cc[], subject[], body[]}    a new message to every address, carrying every literal
//   gmail_not_sent   {to[]}                              no new message to any of these addresses
//   slack_posted     {channel, text[]}                   a new message in the channel carrying every literal
//   slack_not_posted {channel}                           no new message in the channel
//   record_field     {ptr, field, value}                 the record's field equals the value after the work
//   record_created   {app, kind|null, values[]}          a new record of the app (and kind) carrying every value
//   record_deleted   {ptr}                               the record is gone
//   sheet_row        {spreadsheetId|null, values[]}      a new or changed row carrying every value
//   judged           {statement}                         code cannot decide: a clean-context checker call decides
// A check is "hard" (its failure drives a repair round) when a majority of the K ledger readers found its requirement
// and, for a negative, a rule was found verbatim in a source; otherwise it is advisory (evaluated and recorded only).
import { ENUM_PLAN, buildInventory, compactRecord, recordText } from './inventory.mjs';

export const TYPES = Object.freeze(['gmail_sent', 'gmail_not_sent', 'slack_posted', 'slack_not_posted', 'record_field', 'record_created', 'record_deleted', 'sheet_row', 'judged']);
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const META_FIELDS = new Set(['to', 'cc', 'bcc', 'recipient', 'recipients', 'email', 'subject', 'body', 'text', 'message', 'content', 'channel', 'target', 'spreadsheet', 'worksheet', 'sheet', 'record', 'id']);
const BODY_FIELDS = new Set(['body', 'text', 'message', 'content', 'body_contains', 'notes', 'description']);
export const LITERAL_MAX = 160;
const norm = s => String(s ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const emails = s => [...new Set((String(s ?? '').toLowerCase().match(EMAIL) ?? []))];
const usable = f => (f.verified === 'cited' || f.verified === 'other' || (f.derived && ((f.support ?? 1) >= 2 || f.adjudicated))) && String(f.value).length <= LITERAL_MAX && String(f.value).trim().length > 0;

/** Channels the inventory knows: [{id, name}]. */
export function channelsOf(inv) {
  return (inv?.records ?? []).filter(r => r.app === 'slack' && r.kind === 'channel_list').map(r => ({ id: String(r.data.id ?? r.id), name: String(r.data.name ?? '') }));
}
function resolveChannel(spec, inv) {
  const s = String(spec ?? '').trim().replace(/^#/, '');
  if (!s) return null;
  const cs = channelsOf(inv);
  const hit = cs.find(c => c.id === s) ?? cs.find(c => c.name.toLowerCase() === s.toLowerCase()) ?? cs.find(c => s.toLowerCase().includes(`#${c.name.toLowerCase()}`) || s.toLowerCase() === c.name.toLowerCase());
  const m = /#([\w-]+)/.exec(String(spec ?? ''));
  return hit ? { id: hit.id, name: hit.name } : { id: null, name: m ? m[1] : s.split(/\s+/)[0] };
}
const candidateEmails = (item, inv, eligible) => item.candidates.filter(c => c.eligible === eligible).flatMap(c => {
  const r = inv?.records?.find(x => x.ptr === c.record);
  return r ? emails(recordText(r.data)).slice(0, 1) : [];
});

/**
 * postconditionsFromLedger(merged, inv) -> [{id, item, type, hard, params, soft: [unenforced literals], why}].
 * Written before acting. `majority` is the support a requirement needs for its check to be hard.
 */
export function postconditionsFromLedger(merged, inv, { majority = Math.ceil((merged?.readers ?? 1) / 2) } = {}) {
  const pcs = [];
  const add = (item, type, params, extra = {}) => pcs.push({ id: `P${pcs.length + 1}`, item: item.id, statement: item.statement, source: item.source, app: item.app ?? null, polarity: item.polarity, type, params, hard: Boolean(extra.hard), soft: extra.soft ?? [], why: extra.why ?? null });
  for (const item of merged?.items ?? []) {
    if (item.superseded) continue;
    const hard = item.support >= majority && (item.polarity === 'positive' || Boolean(item.rule));
    const f = name => item.fields.filter(x => x.name === name);
    const lits = item.fields.filter(x => BODY_FIELDS.has(x.name));
    const soft = lits.filter(x => !usable(x)).map(x => ({ name: x.name, value: String(x.value).slice(0, 300), why: x.derived ? 'computed value without agreement' : String(x.value).length > LITERAL_MAX ? 'long text: checked by the checker' : 'not found verbatim in a source' }));
    const app = item.app;
    if (item.action === 'send_email' || (app === 'gmail' && ['other', 'create_record'].includes(item.action) && f('to').length)) {
      let to = [...new Set([...f('to'), ...f('recipient'), ...f('recipients'), ...f('email')].flatMap(x => emails(x.value)))];
      if (!to.length) to = emails(item.target);
      if (!to.length && item.polarity === 'positive') to = candidateEmails(item, inv, true);
      if (item.polarity === 'negative') { if (to.length) add(item, 'gmail_not_sent', { to }, { hard }); else add(item, 'judged', {}, { hard: false, why: 'negative effect without an address' }); continue; }
      if (!to.length) { add(item, 'judged', {}, { hard: false, why: 'no recipient address' }); continue; }
      add(item, 'gmail_sent', { to, cc: [...new Set(f('cc').flatMap(x => emails(x.value)))], subject: f('subject').filter(usable).map(x => x.value), body: lits.filter(usable).map(x => x.value) }, { hard, soft });
      const out = candidateEmails(item, inv, false).filter(e => !to.includes(e));
      if (out.length) add(item, 'gmail_not_sent', { to: out }, { hard: hard && item.candidates.some(c => c.eligible === false && c.valueInRecord), why: 'candidates the eligibility rule excludes' });
      continue;
    }
    if (item.action === 'post_message' || (app === 'slack' && item.action === 'other')) {
      const ch = resolveChannel(f('channel')[0]?.value ?? item.target, inv);
      if (!ch) { add(item, 'judged', {}, { hard: false, why: 'no channel' }); continue; }
      if (item.polarity === 'negative') { add(item, 'slack_not_posted', { channel: ch }, { hard }); continue; }
      add(item, 'slack_posted', { channel: ch, text: lits.filter(usable).map(x => x.value) }, { hard, soft });
      continue;
    }
    const recFields = item.fields.filter(x => !META_FIELDS.has(x.name));
    const known = p => p && inv?.records?.some(r => r.ptr === p);
    const ptr = [item.target, ...item.fields.map(x => x.value)].flatMap(s => [String(s ?? '').trim().replace(/^\[|\]$/g, ''), /\b[a-z_]+:[A-Za-z_]+:[^\s,;)\]]+/.exec(String(s ?? ''))?.[0]]).find(known) ?? null;
    if (item.polarity === 'negative') { add(item, 'judged', {}, { hard: false, why: 'negative effect on records (advisory: a repair never undoes work on a checker verdict)' }); continue; }
    if ((item.action === 'update_record' || item.action === 'update_row') && ptr && recFields.length) {
      for (const x of recFields) {
        if (usable(x) || (x.verified === false && String(x.value).length <= 40 && (x.support ?? 1) >= majority)) add(item, 'record_field', { ptr, field: x.name, value: x.value }, { hard: hard && usable(x) });
        else add(item, 'judged', { field: x.name }, { hard: false, why: 'field value not copied from a source' });
      }
      continue;
    }
    if (item.action === 'delete_record' && ptr) { add(item, 'record_deleted', { ptr }, { hard }); continue; }
    if (item.action === 'add_row' || (item.action === 'update_row' && !ptr)) {
      const ss = [item.target, ...f('spreadsheet').map(x => x.value)].map(s => /google_sheets:(?:row|spreadsheet|worksheet):([^/\s]+)/.exec(String(s ?? ''))?.[1]).find(Boolean) ?? null;
      const values = recFields.filter(usable).map(x => x.value);
      if (values.length) { add(item, 'sheet_row', { spreadsheetId: ss, values }, { hard, soft: recFields.filter(x => !usable(x)).map(x => ({ name: x.name, value: String(x.value).slice(0, 300), why: 'not copied from a source' })) }); continue; }
    }
    if (item.action === 'create_record' && app) {
      const values = recFields.filter(usable).map(x => x.value);
      const kind = (inv?.records ?? []).find(r => r.app === app && new RegExp(`\\b${r.kind.replace(/[^\w]/g, '')}\\b`, 'i').test(`${item.target} ${item.statement}`))?.kind ?? null;
      if (values.length) { add(item, 'record_created', { app, kind, values }, { hard }); continue; }
    }
    add(item, 'judged', {}, { hard: false, why: 'no executable predicate in the check grammar' });
  }
  return pcs;
}

/** Validate a predicate proposed by the mapping call (model): only grammar types, only values found verbatim in sources. */
export function validateMapped(p, sources, inv) {
  if (!p || typeof p !== 'object' || !TYPES.includes(p.type) || p.type === 'judged') return null;
  const inSources = v => [...sources.values()].some(s => norm(s.text).includes(norm(v)));
  const ok = v => typeof v === 'string' && v.trim() && v.length <= LITERAL_MAX && inSources(v);
  const P = p.params ?? {};
  switch (p.type) {
    case 'gmail_sent': { const to = (P.to ?? []).flatMap(emails); if (!to.length) return null; return { to, cc: (P.cc ?? []).flatMap(emails), subject: (P.subject ?? []).filter(ok), body: (P.body ?? []).filter(ok) }; }
    case 'gmail_not_sent': { const to = (P.to ?? []).flatMap(emails); return to.length ? { to } : null; }
    case 'slack_posted': { const ch = resolveChannel(P.channel, inv); return ch ? { channel: ch, text: (P.text ?? []).filter(ok) } : null; }
    case 'slack_not_posted': { const ch = resolveChannel(P.channel, inv); return ch ? { channel: ch } : null; }
    case 'record_field': return inv.records.some(r => r.ptr === P.ptr) && P.field && ok(String(P.value ?? '')) ? { ptr: P.ptr, field: String(P.field), value: String(P.value) } : null;
    case 'record_created': { const values = (P.values ?? []).map(String).filter(ok); return P.app && values.length ? { app: String(P.app), kind: P.kind ? String(P.kind) : null, values } : null; }
    case 'record_deleted': return inv.records.some(r => r.ptr === P.ptr) ? { ptr: P.ptr } : null;
    case 'sheet_row': { const values = (P.values ?? []).map(String).filter(ok); return values.length ? { spreadsheetId: P.spreadsheetId ?? null, values } : null; }
    default: return null;
  }
}

export const PCMAP_SYSTEM = `You turn business requirements into checks over the state of software systems, using a fixed list of check types. You cannot call tools. Reply with one JSON object only.`;
export function pcmapPrompt({ items, inventoryText, dateNote = null }) {
  return `Each requirement below could not be turned into a check automatically. For each one, choose the check type that tests it on the systems' state after the work, and fill in its parameters with values copied exactly from the records (or from the requirement). Use "judged" when none fits.

Check types:
- gmail_sent {"to": [addresses], "cc": [addresses], "subject": [exact words the subject must contain], "body": [exact phrases the body must contain]}
- gmail_not_sent {"to": [addresses]}
- slack_posted {"channel": "<name or id>", "text": [exact phrases]}
- slack_not_posted {"channel": "<name or id>"}
- record_field {"ptr": "<record pointer>", "field": "<field name>", "value": "<value after the work>"}
- record_created {"app": "<app>", "kind": "<record kind or null>", "values": [exact values the new record carries]}
- record_deleted {"ptr": "<record pointer>"}
- sheet_row {"spreadsheetId": "<id or null>", "values": [exact cell values of the row]}
${dateNote ? `\n${dateNote}\n` : ''}
<requirements>
${items.map(i => `- ${i.id}: ${i.statement} (action ${i.action}${i.app ? `, app ${i.app}` : ''}; target ${i.target || '?'}; values ${i.fields.map(f => `${f.name}=${JSON.stringify(f.value)}`).join(', ') || 'none'})`).join('\n')}
</requirements>

<records>
${inventoryText}
</records>

Reply with JSON only: {"checks": [{"requirement": "<id>", "type": "...", "params": {...}}]}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Re-reading the world and evaluating

/** The apps a set of checks needs re-read (google_sheets needs google_drive to list spreadsheets). */
export function appsToRead(pcs, inv) {
  const apps = new Set();
  for (const p of pcs) {
    if (p.type.startsWith('gmail')) apps.add('gmail');
    else if (p.type.startsWith('slack')) apps.add('slack');
    else if (p.type === 'sheet_row') { apps.add('google_drive'); apps.add('google_sheets'); }
    else if (p.type === 'record_field' || p.type === 'record_deleted') { const a = p.params.ptr.split(':')[0]; apps.add(a); if (a === 'google_sheets') apps.add('google_drive'); }
    else if (p.type === 'record_created') apps.add(p.params.app);
    else if (p.type === 'judged') { if (p.app) apps.add(p.app); else for (const a of inv?.connected ?? []) apps.add(a); }
  }
  return [...apps].filter(a => ENUM_PLAN.some(e => e.app === a && !e.probe) || a === 'google_sheets');
}

/** A fresh read of the given apps through the same enumeration code (no look-ups, no precedents). */
export async function rereadWorld({ client, apps, maxSteps = 3, node = 'check' }) {
  if (!apps.length) return { records: [], steps: 0, apps: {}, connected: [], outOfScope: [], errors: [] };
  return buildInventory({ request: '', client, maxSteps, node, only: apps });
}

/** New and changed records between two reads: { added: [rec], changed: [{before, after}], removed: [rec] }. */
export function worldDiff(before, after, apps = null) {
  const inApps = r => !apps || apps.includes(r.app);
  const b = new Map(before.records.filter(inApps).map(r => [r.ptr, r]));
  const a = new Map(after.records.filter(inApps).map(r => [r.ptr, r]));
  const added = [], changed = [], removed = [];
  for (const [p, r] of a) { const o = b.get(p); if (!o) added.push(r); else if (JSON.stringify(o.data) !== JSON.stringify(r.data)) changed.push({ before: o, after: r }); }
  for (const [p, r] of b) if (!a.has(p) && (!apps || apps.includes(r.app))) removed.push(r);
  return { added, changed, removed };
}

/** The removals that are certain: the record's app was listed completely in both reads, it was not found by a look-up,
 * the fresh read still lists records of its kind, and (a sheet row) its spreadsheet was read again. Anything else that is
 * absent from the fresh read was only not re-read (a capped or partial re-read, a look-up hit, a sheet opened by title). */
export function certainRemovals(before, after, removed) {
  const truncated = new Set([...(before?.truncated ?? []), ...(after?.truncated ?? [])].map(t => String(t).split(':')[0]));
  const sheetsAfter = new Set((after?.records ?? []).filter(r => r.app === 'google_sheets').map(r => r.data?.spreadsheetId).filter(Boolean));
  const kinds = new Set((after?.records ?? []).map(r => `${r.app}:${r.kind}`));
  return removed.filter(r => !truncated.has(r.app) && r.data?.term === undefined && kinds.has(`${r.app}:${r.kind}`) && (r.app !== 'google_sheets' || sheetsAfter.has(r.data?.spreadsheetId)));
}

const has = (text, lit) => norm(text).includes(norm(lit));
const recipientsOf = d => emails([d.to, d.cc, d.bcc].flat().filter(Boolean).join(' '));
const fieldValue = (data, field) => {
  const want = String(field).toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [k, v] of Object.entries(data ?? {})) if (k.toLowerCase().replace(/[^a-z0-9]/g, '') === want) return v;
  for (const v of Object.values(data ?? {})) if (v && typeof v === 'object' && !Array.isArray(v)) { const x = fieldValue(v, field); if (x !== undefined) return x; }
  return undefined;
};
const sameValue = (a, b) => {
  const na = Number(String(a).replace(/[$,%\s]/g, '')), nb = Number(String(b).replace(/[$,%\s]/g, ''));
  if (String(a).trim() !== '' && String(b).trim() !== '' && Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 1e-9;
  return norm(a) === norm(b);
};

/** Evaluate one check on (initial inventory, fresh read). -> {pass: true|false|null (judged), evidence} */
export function evaluate(pc, before, after) {
  const d = worldDiff(before, after);
  const P = pc.params;
  switch (pc.type) {
    case 'gmail_sent': {
      const sent = d.added.filter(r => r.app === 'gmail' && r.kind === 'message');
      const toAll = sent.filter(r => P.to.every(e => recipientsOf(r.data).includes(e)));
      if (!toAll.length) return { pass: false, evidence: `no new message to ${P.to.join(', ')} (${sent.length} new message(s): ${sent.map(r => `to ${recipientsOf(r.data).join(', ')}`).slice(0, 5).join('; ') || 'none'})` };
      const scored = toAll.map(r => { const text = `${r.data.subject ?? ''}\n${r.data.body_plain ?? r.data.snippet ?? ''}\n${r.data.body_html ?? ''}`; const miss = [...P.subject.filter(s => !has(r.data.subject ?? '', s)).map(s => `subject "${s}"`), ...P.body.filter(s => !has(text, s)).map(s => `"${s}"`), ...P.cc.filter(e => !recipientsOf(r.data).includes(e)).map(e => `cc ${e}`)]; return { r, miss }; }).sort((x, y) => x.miss.length - y.miss.length);
      return scored[0].miss.length ? { pass: false, evidence: `message ${scored[0].r.ptr} to ${P.to.join(', ')} lacks ${scored[0].miss.join(', ')}` } : { pass: true, evidence: `message ${scored[0].r.ptr}` };
    }
    case 'gmail_not_sent': {
      const bad = d.added.filter(r => r.app === 'gmail' && r.kind === 'message' && P.to.some(e => recipientsOf(r.data).includes(e)));
      return bad.length ? { pass: false, evidence: `new message(s) to ${P.to.join(', ')}: ${bad.map(r => r.ptr).join(', ')}` } : { pass: true, evidence: 'no new message to these addresses' };
    }
    case 'slack_posted':
    case 'slack_not_posted': {
      const inCh = d.added.filter(r => r.app === 'slack' && r.kind === 'message' && (r.data.channel === P.channel.id || (P.channel.name && String(r.data.name ?? '').toLowerCase() === P.channel.name.toLowerCase()) || (!P.channel.id && String(r.ptr).split(':')[2]?.split('/')[0] === P.channel.name)));
      if (pc.type === 'slack_not_posted') return inCh.length ? { pass: false, evidence: `new message(s) in #${P.channel.name ?? P.channel.id}: ${inCh.map(r => r.ptr).join(', ')}` } : { pass: true, evidence: 'no new message in the channel' };
      if (!inCh.length) return { pass: false, evidence: `no new message in #${P.channel.name ?? P.channel.id}` };
      const scored = inCh.map(r => ({ r, miss: P.text.filter(s => !has(r.data.text ?? recordText(r.data), s)) })).sort((x, y) => x.miss.length - y.miss.length);
      return scored[0].miss.length ? { pass: false, evidence: `message ${scored[0].r.ptr} lacks ${scored[0].miss.map(s => `"${s}"`).join(', ')}` } : { pass: true, evidence: `message ${scored[0].r.ptr}` };
    }
    case 'record_field': {
      const r = after.records.find(x => x.ptr === P.ptr);
      if (!r) return { pass: false, evidence: `record ${P.ptr} not found on re-read` };
      const v = fieldValue(r.data, P.field);
      return v !== undefined && sameValue(v, P.value) ? { pass: true, evidence: `${P.field} = ${JSON.stringify(v)}` } : { pass: false, evidence: `${P.ptr} ${P.field} = ${JSON.stringify(v ?? null)}, expected ${JSON.stringify(P.value)}` };
    }
    case 'record_deleted': {
      if (after.records.some(x => x.ptr === P.ptr)) return { pass: false, evidence: `${P.ptr} still present` };
      const was = before.records.filter(x => x.ptr === P.ptr);
      // Absent from a re-read that did not cover it is not "gone": undecided (the checker decides, or nobody).
      return certainRemovals(before, after, was).length ? { pass: true, evidence: 'gone' } : { pass: null, evidence: `${P.ptr} not re-read: cannot tell` };
    }
    case 'record_created': {
      const fresh = d.added.filter(r => r.app === P.app && (!P.kind || r.kind === P.kind));
      const best = fresh.map(r => ({ r, miss: P.values.filter(v => !has(recordText(r.data), v)) })).sort((x, y) => x.miss.length - y.miss.length)[0];
      if (!best) return { pass: false, evidence: `no new ${P.app}${P.kind ? ` ${P.kind}` : ''} record` };
      return best.miss.length ? { pass: false, evidence: `new record ${best.r.ptr} lacks ${best.miss.map(v => `"${v}"`).join(', ')}` } : { pass: true, evidence: `record ${best.r.ptr}` };
    }
    case 'sheet_row': {
      const rows = [...d.added, ...d.changed.map(c => c.after)].filter(r => r.app === 'google_sheets' && r.kind === 'row' && (!P.spreadsheetId || r.data.spreadsheetId === P.spreadsheetId));
      const best = rows.map(r => ({ r, miss: P.values.filter(v => !Object.values(r.data).some(c => sameValue(c, v) || has(String(c), v))) })).sort((x, y) => x.miss.length - y.miss.length)[0];
      if (!best) return { pass: false, evidence: `no new or changed row${P.spreadsheetId ? ` in ${P.spreadsheetId}` : ''}` };
      return best.miss.length ? { pass: false, evidence: `row ${best.r.ptr} lacks ${best.miss.map(v => `"${v}"`).join(', ')}` } : { pass: true, evidence: `row ${best.r.ptr}` };
    }
    default: return { pass: null, evidence: 'decided by the checker' };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The checker call (clean context): only for checks code cannot decide. It sees the requirement, the cited source span and
// the re-read state; never the acting transcript.

export const CHECKER_SYSTEM = `You check whether work on software systems meets stated requirements, from the systems' state only. You cannot call tools. Reply with one JSON object only.`;
export function checkerPrompt({ items, dateNote = null }) {
  return `For each requirement, decide from the state shown whether it is met. "Changes" lists every record that is new or changed since before the work${'' /* no transcript */}.${dateNote ? `\n${dateNote}` : ''}

${items.map(x => `### ${x.id}: ${x.statement}
Source ${x.source}: ${x.sourceText || '(the request)'}
Changes in ${x.apps.join(', ') || 'the connected apps'}:
${x.changes || '(no new or changed record)'}`).join('\n\n')}

Reply with JSON only: {"verdicts": [{"id": "<id>", "pass": true|false, "why": "<one sentence citing a record pointer>"}]}`;
}

/** The re-read state a checker needs for one check: new/changed records (compact), capped. */
export function changesText(before, after, apps = null, maxChars = 12_000) {
  const d = worldDiff(before, after, apps);
  const lines = [...d.added.map(r => `+ [${r.ptr}] ${compactRecord(r.data, 2500)}`), ...d.changed.map(c => `~ [${c.after.ptr}] ${compactRecord(c.after.data, 2500)}`), ...certainRemovals(before, after, d.removed).map(r => `- [${r.ptr}] removed`)];
  let s = lines.join('\n');
  if (s.length > maxChars) s = s.slice(0, maxChars) + '\n…(more changes cut)';
  return s;
}
