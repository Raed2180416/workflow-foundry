// POSTCONDITIONS and CHECK of arm A1-C v2 (harness/v2/codeowned.mjs): copy-on-change of harness/postconditions.mjs.
// Unchanged: the checker and mapping system prompts, the checker prompt, worldDiff, certainRemovals, changesText (v1).
// Changes (research/automationbench-20261014/A1C-V2-DESIGN.md):
//   M2  app-faithful compile from the schema-derived effect table (effects.json): a post compiles to its own app (Slack to
//       slack_posted, a DM to the user's im channel, another app with a social, chat or sms operation to channel_posted,
//       anything else judged; never Slack for another app); record kinds come from the table (case-insensitive, singular
//       or plural); a create on an existing record of the parent kind is child_created; list fields pass on membership,
//       long text on containment; a check on an app the re-read cannot list is null ("unobservable"), never failed.
//   M3  hardness per literal (literals.mjs via ledger.mjs typeLedger); tolerant number and date comparison; co-occurrence
//       for record and row checks; a value most row items share becomes one sheet-wide check.
//   M4  content limits: bodyNot on messages, row_not_exists on sheets, record_unchanged on records; satisfiability: a ban
//       on a required recipient is dropped; ineligible candidates become recipient bans only when the recipients are drawn
//       from the candidates.
//   Types added: channel_posted {app, channel|null, text[], bodyNot[]}, child_created {parent, kind, values[]},
//   row_not_exists {spreadsheetId, values[]}, record_unchanged {ptr}; gmail_sent and slack_posted gain bodyNot[].
import { readFileSync } from 'node:fs';
import { CHECKER_SYSTEM, PCMAP_SYSTEM, checkerPrompt, worldDiff, certainRemovals, changesText, LITERAL_MAX } from '../postconditions.mjs';
import { ENUM_PLAN, buildInventory, recordText, compactRecord } from './inventory.mjs';
import { BODY_FIELDS, EMAIL_FIELDS, META_FIELDS, isMessageItem, majorityOf } from './ledger.mjs';
import { EMAIL_RE, hasValue, identifyingValue, norm, sameValue, valueKey, valueType } from './literals.mjs';

export { CHECKER_SYSTEM, PCMAP_SYSTEM, checkerPrompt, worldDiff, certainRemovals, changesText, LITERAL_MAX };

export const TYPES = Object.freeze(['gmail_sent', 'gmail_not_sent', 'slack_posted', 'slack_not_posted', 'channel_posted', 'record_field', 'record_created', 'child_created', 'record_deleted', 'record_unchanged', 'sheet_row', 'row_not_exists', 'judged']);

// ---------------------------------------------------------------------------------------------------------------
// The effect table (generated at build time by build-effects.mjs from the shipped API schemas)

export const EFFECTS = JSON.parse(readFileSync(new URL('./effects.json', import.meta.url), 'utf8'));
const appKey = a => String(a ?? '').toLowerCase();
const rowsOf = app => EFFECTS.rows.filter(r => r.appKey === appKey(app) || r.app === appKey(app));
/** The outgoing messaging channels an app's operations reach (email, chat, dm, sms, social, esign, reply; an internal
 * "note" is not outgoing). */
export const channelsOf = app => new Set(rowsOf(app).map(r => r.channel).filter(c => c && c !== 'note'));
/** Kinds an app's create operations make (a send that also creates a record, such as a comment on a ticket, included),
 * with their parent kind. */
export const createKindsOf = app => rowsOf(app).filter(r => r.effect === 'create' || r.creates).map(r => ({ kind: r.kind, parent: r.parent }));
const singular = w => { const s = String(w ?? '').toLowerCase().replace(/[^a-z0-9_]/g, ''); return s.length > 3 && /ies$/.test(s) ? `${s.slice(0, -3)}y` : s.length > 3 && /(ches|shes|xes|zes|sses)$/.test(s) ? s.slice(0, -2) : s.length > 3 && /s$/.test(s) && !/(ss|us|is)$/.test(s) ? s.slice(0, -1) : s; };
/** Kind names match case-insensitively, singular or plural (ride-along 7). */
/** A record kind's key: singular, case-insensitive, and a listing named '<kind>_list' holds records of <kind>. */
const kindKey = k => singular(String(k ?? '').replace(/_list$/i, ''));
export const sameKind = (a, b) => Boolean(a && b) && kindKey(a) === kindKey(b);
/** Apps the re-read can list (an enumeration plan entry that is not a probe), and google_sheets through google_drive. */
export const observable = app => app === 'google_sheets' || ENUM_PLAN.some(e => e.app === app && !e.probe);
const l0Kinds = app => ENUM_PLAN.filter(e => e.app === app && !e.probe).flatMap(e => e.l0.map(c => c.kind));
// Listings whose records carry another kind name (Slack histories and replies hold messages; sheet values hold rows).
const RECORD_KIND = Object.freeze({ history: 'message', replies: 'message', values: 'row' });
/**
 * The record kinds a read LISTED for an app: every enumeration-plan listing that answered (status 200), even when it
 * returned no record (listable but empty). This is capability, decided before looking at the outcome. Look-ups by
 * search term (the first read's mailbox and social searches) are not listings and are not repeated by the re-read.
 * A read without per-app listing state (hand-built test fixtures) falls back to its records' kinds and the app's
 * first-level plan kinds.
 */
export function listedKinds(read, app) {
  if (read?.apps) return Object.entries(read.apps[app]?.kinds ?? {}).filter(([, n]) => n > 0).map(([k]) => RECORD_KIND[k] ?? k);
  return [...new Set([...(read?.records ?? []).filter(r => r.app === app).map(r => r.kind), ...l0Kinds(app)])];
}
const lists = (read, app, pred) => listedKinds(read, app).some(pred);

// ---------------------------------------------------------------------------------------------------------------
// Channels

const emails = s => [...new Set((String(s ?? '').toLowerCase().match(EMAIL_RE) ?? []))];
export function slackChannels(inv) {
  return (inv?.records ?? []).filter(r => r.app === 'slack' && r.kind === 'channel_list').map(r => ({ id: String(r.data.id ?? r.id), name: String(r.data.name ?? ''), user: r.data.user ? String(r.data.user) : null, im: Boolean(r.data.is_im) }));
}
const slackUsers = inv => (inv?.records ?? []).filter(r => r.app === 'slack' && r.kind === 'user_list').map(r => r.data);
/** A Slack channel spec -> {id, name} (v1), or a user (an @handle, a user id, a member's name or address) -> that user's im
 * channel, {id, name: '@<user>', dm: true}. null when nothing is named. */
export function resolveChannel(spec, inv) {
  const s = String(spec ?? '').trim();
  if (!s) return null;
  const cs = slackChannels(inv);
  const bare = s.replace(/^#/, '');
  const ch = cs.find(c => c.id === bare) ?? cs.find(c => c.name && c.name.toLowerCase() === bare.toLowerCase()) ?? cs.find(c => c.name && bare.toLowerCase().includes(`#${c.name.toLowerCase()}`));
  if (ch && !ch.im) return { id: ch.id, name: ch.name };
  const users = slackUsers(inv);
  const handle = /@([A-Za-z0-9_.-]+)/.exec(s)?.[1]?.toLowerCase();
  const addr = emails(s)[0];
  const u = users.find(x => String(x.id) === bare) ?? users.find(x => handle && [x.name, x.real_name, x.profile?.display_name].some(n => String(n ?? '').toLowerCase() === handle))
    ?? users.find(x => addr && String(x.profile?.email ?? x.email ?? '').toLowerCase() === addr) ?? users.find(x => [x.real_name, x.profile?.real_name].some(n => n && norm(s).includes(norm(n))));
  if (u && !s.startsWith('#')) {
    const im = cs.find(c => c.user === String(u.id));
    return { id: im?.id ?? null, name: `@${u.name ?? u.real_name ?? u.id}`, dm: true, user: String(u.id) };
  }
  // A #channel the records do not list yet (one the work may create) keeps its name; anything else that resolves to no
  // channel or member is no channel (never the first word of the target).
  const m = /#([\w-]+)/.exec(s);
  return m ? { id: null, name: m[1] } : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Compile

const recOf = (inv, ptr) => (inv?.records ?? []).find(r => r.ptr === ptr) ?? null;
const candidateEmails = (item, inv, eligible) => item.candidates.filter(c => c.eligible === eligible).flatMap(c => { const r = recOf(inv, c.record); return r ? emails(recordText(r.data)).slice(0, 1) : []; });
const PTR_RE = /\b[a-z_]+:[A-Za-z_]+:[^\s,;)\]]+/;
const ptrOf = (item, inv) => [item.target, ...item.fields.map(x => x.value)].flatMap(s => [String(s ?? '').trim().replace(/^\[|\]$/g, ''), PTR_RE.exec(String(s ?? ''))?.[0]]).find(p => p && recOf(inv, p)) ?? null;
const lit = f => String(f.value);
const softRow = (f, why) => ({ name: f.name, value: String(f.value).slice(0, 300), why });
const softWhy = f => (f.completeness ? 'completeness value (no source asks for it)' : f.demoted ? f.demoted : f.vtype === 'clause' ? `instruction text (${f.typeReason})` : f.derived ? 'computed value without agreement' : f.verified ? 'minority or unverified' : 'not found verbatim in a source');

/** How a message item compiles (M2): 'gmail' | 'slack' | 'channel' | null (judged). */
export function messageRoute(item, inv) {
  const app = item.app;
  if (item.action === 'post_message' || (app === 'slack' && item.action === 'other')) {
    if (app === 'slack' || (!app && (inv?.connected ?? []).includes('slack'))) return 'slack';
    if (app && [...channelsOf(app)].some(c => ['social', 'chat', 'sms', 'dm'].includes(c))) return 'channel';
    return null;
  }
  // An e-mail item without an app goes to Gmail only when Gmail is connected (else no app can be read for it).
  if (app === 'gmail' || (!app && (!(inv?.connected?.length) || inv.connected.includes('gmail')))) return 'gmail';
  if (!app) return null;
  // Another app: its own posts (social, chat, sms, direct messages) are checked there; anything else (an e-mail or reply
  // the app sends itself, or an app with no messaging operation) is judged, never re-routed to Gmail or Slack.
  return [...channelsOf(app)].some(c => ['social', 'chat', 'sms', 'dm'].includes(c)) ? 'channel' : null;
}
/** Apps that are one app for checks (sheets are listed through Drive). */
export const sameApp = (a, b) => !a || !b || a === b || (['google_sheets', 'google_drive'].includes(a) && ['google_sheets', 'google_drive'].includes(b));

/** Co-occurrence (record and row checks): keep the literals found in the single source record that covers the most of
 * them (ties: the literals' cited source, then the target), plus request literals and agreed computed values. */
export function coOccurring(fs, item, sources) {
  const recLits = fs.filter(f => f.source !== 'request' && f.source !== 'system' && !f.derived);
  if (recLits.length < 2) return { keep: fs, soft: [] };
  const cited = new Map();
  for (const f of recLits) cited.set(f.source, (cited.get(f.source) ?? 0) + 1);
  let best = null;
  for (const [ptr, s] of sources) {
    if (ptr === 'request' || ptr === 'system') continue;
    const n = recLits.filter(f => hasValue(s.text, f.value)).length;
    if (!n) continue;
    const score = [n, cited.get(ptr) ?? 0, String(item.target ?? '').includes(ptr) ? 1 : 0];
    if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && (score[1] > best.score[1] || (score[1] === best.score[1] && score[2] > best.score[2])))) best = { ptr, score, text: s.text };
  }
  if (!best) return { keep: fs.filter(f => !recLits.includes(f)), soft: recLits };
  const keep = fs.filter(f => !recLits.includes(f) || hasValue(best.text, f.value));
  return { keep, soft: fs.filter(f => !keep.includes(f)), record: best.ptr };
}

/**
 * postconditionsFromLedger(merged, inv, { majority, sources, P }) -> [pc] (written before acting), with .satisfiability
 * (the bans dropped as unsatisfiable) and .stats attached. pc: {id, item, statement, source, app, polarity, type, params,
 * hard, soft: [literals not enforced], softNot: [bans not enforced], why}.
 */
export function postconditionsFromLedger(merged, inv, { majority = majorityOf(merged), sources = new Map(), P = {} } = {}) {
  const pcs = [], satisfiability = [];
  const stats = { contentLimits: 0, satisfiabilityDrops: 0, coSoft: 0, sheetWide: 0, unobservableAtCompile: 0 };
  const add = (item, type, params, extra = {}) => pcs.push({ id: `P${pcs.length + 1}`, item: item.id, statement: item.statement, source: item.source, app: extra.app ?? item.app ?? null, polarity: item.polarity, type, params, hard: Boolean(extra.hard), soft: extra.soft ?? [], softNot: extra.softNot ?? [], why: extra.why ?? null });
  const typed = f => f.hardLit !== null && f.hardLit !== undefined;
  // v1's usable() when value typing is off (an ablation); else the per-literal rule.
  const hardLit = f => (typed(f) ? f.hardLit && !f.coSoft : (f.verified === 'cited' || f.verified === 'other' || (f.derived && ((f.support ?? 1) >= 2 || f.adjudicated))) && String(f.value).length <= LITERAL_MAX && String(f.value).trim().length > 0);
  const shownSoft = f => !hardLit(f) && f.vtype !== 'clause' && !(f.vtype === 'slot' && !f.slotFilled);
  for (const item of merged?.items ?? []) {
    if (item.superseded) continue;
    const hard = item.support >= majority && (item.polarity === 'positive' || Boolean(item.rule));
    const f = name => item.fields.filter(x => x.name === name);
    const lits = item.fields.filter(x => BODY_FIELDS.has(x.name) && x.name !== 'subject');
    const soft = item.fields.filter(x => !EMAIL_FIELDS.has(x.name) && x.name !== 'channel' && shownSoft(x)).map(x => softRow(x, softWhy(x)));
    const excl = P.contentConstraints === false ? [] : (item.exclusions ?? []);
    const bodyNot = excl.filter(e => e.hard).map(e => e.literal), softNot = excl.filter(e => !e.hard).map(e => e.literal);
    if (excl.length) stats.contentLimits += excl.length;
    const app = item.app;

    if (isMessageItem(item)) {
      const route = messageRoute(item, inv);
      if (route === 'gmail') {
        let to = [...new Set([...f('to'), ...f('recipient'), ...f('recipients'), ...f('email')].flatMap(x => emails(x.value)))];
        if (!to.length) to = emails(item.target);
        let fromCandidates = false;
        if (!to.length && item.polarity === 'positive') { to = candidateEmails(item, inv, true); fromCandidates = to.length > 0; }
        if (item.polarity === 'negative') { if (to.length) add(item, 'gmail_not_sent', { to }, { hard, app: 'gmail' }); else add(item, 'judged', {}, { hard: false, why: 'negative effect without an address' }); continue; }
        if (!to.length) { add(item, 'judged', {}, { hard: false, why: 'no recipient address' }); continue; }
        add(item, 'gmail_sent', { to, cc: [...new Set(f('cc').filter(x => !typed(x) || hardLit(x)).flatMap(x => emails(x.value)))], subject: f('subject').filter(hardLit).map(lit), body: lits.filter(hardLit).map(lit), bodyNot }, { hard, soft, softNot, app: 'gmail' });
        // Ineligible candidates become recipient bans only when this item's recipients are drawn from the candidates.
        const eligibleTo = candidateEmails(item, inv, true);
        if (fromCandidates || to.some(e => eligibleTo.includes(e))) {
          const out = candidateEmails(item, inv, false).filter(e => !to.includes(e));
          if (out.length) add(item, 'gmail_not_sent', { to: out }, { hard: hard && item.candidates.some(c => c.eligible === false && c.valueInRecord), why: 'candidates the eligibility rule excludes', app: 'gmail' });
        }
        continue;
      }
      if (route === 'slack') {
        const ch = resolveChannel(f('channel')[0]?.value ?? item.target, inv);
        if (!ch) { add(item, 'judged', {}, { hard: false, why: 'no channel' }); continue; }
        if (item.polarity === 'negative') { add(item, 'slack_not_posted', { channel: ch }, { hard, app: 'slack' }); continue; }
        add(item, 'slack_posted', { channel: ch, text: lits.filter(hardLit).map(lit), bodyNot }, { hard, soft, softNot, app: 'slack' });
        continue;
      }
      if (route === 'channel') {
        if (item.polarity === 'negative') { add(item, 'judged', {}, { hard: false, why: `negative post in ${app}` }); continue; }
        const chv = f('channel')[0]?.value ?? null;
        add(item, 'channel_posted', { app, channel: chv ? String(chv) : null, text: lits.filter(hardLit).map(lit), bodyNot }, { hard, soft, softNot, app });
        continue;
      }
      add(item, 'judged', {}, { hard: false, why: `no observable message channel for ${app ?? 'this item'}` });
      continue;
    }

    const recFields = item.fields.filter(x => !META_FIELDS.has(x.name));
    const ptr = ptrOf(item, inv);
    if (item.polarity === 'negative') { add(item, 'judged', {}, { hard: false, why: 'negative effect on records (advisory: a repair never undoes work on a checker verdict)' }); continue; }
    // App-faithful (M2): a record in another app than the requirement's is not this requirement's record.
    if (ptr && !sameApp(app, ptr.split(':')[0])) { add(item, 'judged', {}, { hard: false, why: `the record ${ptr} is in another app than the requirement's (${app})` }); continue; }
    // Content limits on records and rows (M4).
    const limits = (kindOf) => {
      for (const e of excl) {
        if (kindOf === 'row') { add(item, 'row_not_exists', { spreadsheetId: sheetIdOf(item), values: [e.literal] }, { hard: hard && e.hard, why: `left out by rule ${e.rule?.source ?? '?'}`, app: 'google_sheets' }); continue; }
        const rec = (inv?.records ?? []).find(r => r.app === (app ?? r.app) && identifyingValue(r.data) && norm(identifyingValue(r.data)) === norm(e.literal));
        if (rec) add(item, 'record_unchanged', { ptr: rec.ptr }, { hard: hard && e.hard, why: `left out by rule ${e.rule?.source ?? '?'}`, app: rec.app });
      }
    };
    if ((item.action === 'update_record' || item.action === 'update_row') && ptr && recFields.length) {
      const { keep, soft: co } = coOccurring(recFields.filter(hardLit), item, sources);
      for (const x of co) { x.coSoft = true; stats.coSoft += 1; }
      for (const x of recFields) {
        const usable = keep.includes(x);
        if (usable || (!typed(x) && x.verified === false && String(x.value).length <= 40 && (x.support ?? 1) >= majority) || shownSoft(x) || x.coSoft) add(item, 'record_field', { ptr, field: x.name, value: lit(x) }, { hard: hard && usable, app: ptr.split(':')[0] });
        else add(item, 'judged', { field: x.name }, { hard: false, why: x.vtype === 'clause' ? `field value is instruction text (${x.typeReason})` : 'field value not copied from a source' });
      }
      limits('record');
      continue;
    }
    if (item.action === 'delete_record' && ptr) { add(item, 'record_deleted', { ptr }, { hard, app: ptr.split(':')[0] }); continue; }
    // A row in another app (a board, a base) is a record of that app, not a sheet row (app-faithful).
    const sheetApp = sameApp(app ?? 'google_sheets', 'google_sheets');
    if ((item.action === 'add_row' || (item.action === 'update_row' && !ptr)) && sheetApp) {
      const { keep, soft: co } = coOccurring(recFields.filter(hardLit), item, sources);
      for (const x of co) { x.coSoft = true; stats.coSoft += 1; }
      if (keep.length || recFields.some(shownSoft) || co.length) { add(item, 'sheet_row', { spreadsheetId: sheetIdOf(item), values: keep.map(lit) }, { hard: hard && keep.length > 0, soft: recFields.filter(x => !keep.includes(x) && x.vtype !== 'clause').map(x => softRow(x, x.coSoft ? 'not in the same source record as the other values' : softWhy(x))), app: 'google_sheets' }); limits('row'); continue; }
    }
    if ((item.action === 'create_record' || (item.action === 'add_row' && !sheetApp)) && app) {
      // A new record's values include its text fields (a note's or comment's body is what it carries).
      const valFields = item.fields.filter(x => !META_FIELDS.has(x.name) || (BODY_FIELDS.has(x.name) && x.name !== 'subject'));
      const { keep, soft: co } = coOccurring(valFields.filter(hardLit), item, sources);
      for (const x of co) { x.coSoft = true; stats.coSoft += 1; }
      const k = kindFor(item, inv);
      const parent = k?.parent ? parentRecord(item, inv, k.parent.kind) : null;
      const softRows = valFields.filter(x => !keep.includes(x) && x.vtype !== 'clause').map(x => softRow(x, x.coSoft ? 'not in the same source record as the other values' : softWhy(x)));
      if (parent) { add(item, 'child_created', { parent: parent.ptr, kind: k.kind, values: keep.map(lit) }, { hard, soft: softRows, app }); limits('record'); continue; }
      if (keep.length || softRows.length) { add(item, 'record_created', { app, kind: k?.kind ?? null, values: keep.map(lit) }, { hard: hard && (keep.length > 0 || Boolean(k)), soft: softRows, app }); limits('record'); continue; }
    }
    add(item, 'judged', {}, { hard: false, why: 'no executable predicate in the check grammar' });
  }
  // Satisfiability (M4): a hard recipient ban on a required recipient can never hold together with the send.
  const required = new Set(pcs.filter(p => p.type === 'gmail_sent' && p.hard).flatMap(p => [...p.params.to, ...p.params.cc]));
  for (const p of pcs.filter(x => x.type === 'gmail_not_sent' && x.hard)) {
    const clash = p.params.to.filter(e => required.has(e));
    if (clash.length) { satisfiability.push({ check: p.id, item: p.item, dropped: 'gmail_not_sent', addresses: clash, why: 'a required message goes to this address' }); p.dropped = true; }
  }
  const kept = pcs.filter(p => !p.dropped);
  stats.satisfiabilityDrops = satisfiability.length;
  // Sheet-wide values (M3): a literal in >= 50% of >= 3 row checks of one spreadsheet becomes one check.
  const bySheet = new Map();
  for (const p of kept.filter(x => x.type === 'sheet_row' && x.params.spreadsheetId)) { if (!bySheet.has(p.params.spreadsheetId)) bySheet.set(p.params.spreadsheetId, []); bySheet.get(p.params.spreadsheetId).push(p); }
  for (const [ss, rows] of bySheet) {
    if (rows.length < 3) continue;
    const count = new Map();
    for (const p of rows) for (const k of new Set(p.params.values.map(valueKey))) count.set(k, (count.get(k) ?? 0) + 1);
    const wide = [...count].filter(([, n]) => n / rows.length >= 0.5).map(([k]) => k);
    if (!wide.length) continue;
    const values = wide.map(k => rows.flatMap(p => p.params.values).find(v => valueKey(v) === k));
    for (const p of rows) p.params = { ...p.params, values: p.params.values.filter(v => !wide.includes(valueKey(v))) };
    kept.push({ id: 'P', item: rows.map(p => p.item).join('+'), statement: `rows of ${ss} carry ${values.map(v => JSON.stringify(v)).join(', ')}`, source: rows[0].source, app: 'google_sheets', polarity: 'positive', type: 'sheet_row', params: { spreadsheetId: ss, values }, hard: rows.filter(p => p.hard).length * 2 > rows.length, soft: [], softNot: [], why: `a value ${wide.length > 1 ? 'set ' : ''}shared by most row items (one sheet-wide check)` });
    for (const p of rows.filter(x => !x.params.values.length)) { p.dropped = true; p.why = 'all its values are sheet-wide'; }
    stats.sheetWide += 1;
  }
  const out = kept.filter(p => !p.dropped).map((p, i) => ({ ...p, id: `P${i + 1}` }));
  out.satisfiability = satisfiability;
  out.stats = stats;
  return out;
}
const sheetIdOf = item => [item.target, ...item.fields.filter(x => x.name === 'spreadsheet').map(x => x.value)].map(s => /google_sheets:(?:row|spreadsheet|worksheet):([^/\s]+)/.exec(String(s ?? ''))?.[1]).find(Boolean) ?? null;
/** The record kind a create makes: the effect table's create kinds of the app (and the kinds its listing shows), matched
 * against the target, then the statement, case-insensitively, singular or plural. A kind named in the target wins; else
 * the first kind named after a create verb in the statement; else the first named. */
const CREATE_VERB = /^(create|add|log|open|new|insert|schedule|make|file|raise|book|submit|record|post|enter|set)$/;
export function kindFor(item, inv) {
  const toks = s => String(s ?? '').replace(new RegExp(PTR_RE.source, 'g'), ' ').toLowerCase().replace(/[^a-z0-9_]+/g, ' ').trim().split(' ').filter(Boolean);
  const tt = toks(item.target), st = toks(item.statement);   // record pointers name the parent, not the new kind
  const forms = k => { const s = kindKey(k); return s.length >= 3 ? new Set([s, `${s}s`, `${s}es`, s.replace(/y$/, 'ies')]) : new Set(); };
  const at = (k, ws, from = 0) => { const f = forms(k); const i = ws.findIndex((w, j) => j >= from && f.has(w)); return i; };
  const table = createKindsOf(item.app);
  const listed = [...new Set((inv?.records ?? []).filter(r => r.app === item.app).map(r => r.kind))].map(k => ({ kind: k, parent: null }));
  let named = [...table, ...listed].filter(k => at(k.kind, tt) >= 0 || at(k.kind, st) >= 0);
  // A kind named next to its own parent kind ("a calendar event", "a note on the card") is the child: that parent kind is
  // dropped. A parent named elsewhere ("create a card and add a comment") stays a candidate.
  const LINK_WORD = /^(on|to|for|in|under|of|onto)$/;
  const nextTo = (child, parent, ws) => { const c = forms(child), p = forms(parent); return ws.some((w, i) => (p.has(w) && c.has(ws[i + 1] ?? '')) || (c.has(w) && LINK_WORD.test(ws[i + 1] ?? '') && [ws[i + 2], ws[i + 3]].some(x => p.has(x ?? '')))); };
  const parents = new Set(table.filter(t => t.parent && named.some(n => sameKind(n.kind, t.kind)) && [tt, st].some(ws => nextTo(t.kind, t.parent.kind, ws))).map(t => kindKey(t.parent.kind)));
  if (named.some(n => !parents.has(kindKey(n.kind)))) named = named.filter(n => !parents.has(kindKey(n.kind)));
  if (!named.length) return null;
  const verb = st.findIndex(w => CREATE_VERB.test(w));
  const rank = k => (at(k.kind, tt) >= 0 ? at(k.kind, tt) : 1000 + (verb >= 0 && at(k.kind, st, verb) >= 0 ? at(k.kind, st, verb) : 1000 + at(k.kind, st)));
  const all = [...named].sort((a, b) => rank(a) - rank(b) || singular(b.kind).length - singular(a.kind).length);
  // Prefer the kind the listing uses (so a re-read compares like with like), keep the table's parent.
  const best = all[0];
  const listedName = listed.find(l => sameKind(l.kind, best.kind))?.kind;
  const withParent = table.find(t => sameKind(t.kind, best.kind) && t.parent);
  return { kind: listedName ?? best.kind, parent: withParent?.parent ?? null };
}
function parentRecord(item, inv, parentKind) {
  const p = ptrOf(item, inv);
  const r = p ? recOf(inv, p) : null;
  return r && sameKind(r.kind, parentKind) ? r : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The mapping call (model) for the requirements code could not compile

/** Validate a mapped check: grammar types only, values found in sources, typed (no instruction text or placeholder), and
 * app-faithful (the check's app is the requirement's). Literals keep only values a majority of readers wrote. */
export function validateMapped(p, sources, inv, { item = null, majority = 2, P = {} } = {}) {
  if (!p || typeof p !== 'object' || !TYPES.includes(p.type) || p.type === 'judged') return null;
  const inSources = v => [...sources.values()].some(s => norm(s.text).includes(norm(v)));
  const typedOk = v => valueType(v, { statement: item?.statement ?? '', clauseWords: P.clauseWords ?? 9 }).accepted || [...sources.values()].some(s => norm(s.text).includes(`"${norm(v)}"`));
  const ok = v => typeof v === 'string' && v.trim() && v.length <= LITERAL_MAX && inSources(v) && typedOk(v);
  const majorityValue = v => !item || item.fields.some(f => valueKey(f.value) === valueKey(v) && ((f.support ?? 1) >= majority || f.adjudicated));
  const split = vs => { const good = (vs ?? []).map(String).filter(ok); return { hard: good.filter(majorityValue), soft: good.filter(v => !majorityValue(v)) }; };
  const appOfType = { gmail_sent: 'gmail', gmail_not_sent: 'gmail', slack_posted: 'slack', slack_not_posted: 'slack' }[p.type];
  const Pm = p.params ?? {};
  // App-faithful: a check in another app than the requirement's is refused (a post is never checked in Slack for another app).
  const want = item?.app ?? null;
  const checkApp = appOfType ?? (p.type === 'record_field' || p.type === 'record_deleted' || p.type === 'record_unchanged' ? String(Pm.ptr ?? '').split(':')[0] : p.type === 'child_created' ? String(Pm.parent ?? '').split(':')[0] : p.type === 'sheet_row' || p.type === 'row_not_exists' ? 'google_sheets' : Pm.app ? String(Pm.app) : null);
  if (want && checkApp && want !== checkApp && !(want === 'google_drive' && checkApp === 'google_sheets')) return null;
  let r = null;
  // A positive check whose value list is empty once minority values are split off is not hard (hardValue false): it would
  // pass on any message, post, row or record of its kind (review of 2026-10-21, M4).
  switch (p.type) {
    case 'gmail_sent': { const to = (Pm.to ?? []).flatMap(emails); if (!to.length) return null; const s = split(Pm.subject), b = split(Pm.body); r = { params: { to, cc: (Pm.cc ?? []).flatMap(emails), subject: s.hard, body: b.hard, bodyNot: [] }, soft: [...s.soft, ...b.soft], hardValue: s.hard.length + b.hard.length > 0 }; break; }
    case 'gmail_not_sent': { const to = (Pm.to ?? []).flatMap(emails); r = to.length ? { params: { to }, soft: [] } : null; break; }
    case 'slack_posted': { const ch = resolveChannel(Pm.channel, inv); const t = split(Pm.text); r = ch ? { params: { channel: ch, text: t.hard, bodyNot: [] }, soft: t.soft, hardValue: t.hard.length > 0 } : null; break; }
    case 'slack_not_posted': { const ch = resolveChannel(Pm.channel, inv); r = ch ? { params: { channel: ch }, soft: [] } : null; break; }
    case 'channel_posted': { if (!Pm.app) return null; const t = split(Pm.text); r = { params: { app: String(Pm.app), channel: Pm.channel ? String(Pm.channel) : null, text: t.hard, bodyNot: [] }, soft: t.soft, hardValue: t.hard.length > 0 }; break; }
    case 'record_field': r = inv.records.some(x => x.ptr === Pm.ptr) && Pm.field && ok(String(Pm.value ?? '')) ? { params: { ptr: Pm.ptr, field: String(Pm.field), value: String(Pm.value) }, soft: [], hardValue: majorityValue(String(Pm.value)) } : null; break;
    case 'record_created': { const v = split(Pm.values); r = Pm.app && (v.hard.length || v.soft.length) ? { params: { app: String(Pm.app), kind: Pm.kind ? String(Pm.kind) : null, values: v.hard }, soft: v.soft, hardValue: v.hard.length > 0 } : null; break; }
    case 'child_created': { const v = split(Pm.values); r = inv.records.some(x => x.ptr === Pm.parent) && Pm.kind ? { params: { parent: Pm.parent, kind: String(Pm.kind), values: v.hard }, soft: v.soft, hardValue: v.hard.length > 0 } : null; break; }
    case 'record_deleted': r = inv.records.some(x => x.ptr === Pm.ptr) ? { params: { ptr: Pm.ptr }, soft: [] } : null; break;
    case 'record_unchanged': r = inv.records.some(x => x.ptr === Pm.ptr) ? { params: { ptr: Pm.ptr }, soft: [] } : null; break;
    case 'sheet_row': { const v = split(Pm.values); r = v.hard.length || v.soft.length ? { params: { spreadsheetId: Pm.spreadsheetId ?? null, values: v.hard }, soft: v.soft, hardValue: v.hard.length > 0 } : null; break; }
    case 'row_not_exists': { const v = (Pm.values ?? []).map(String).filter(ok); r = v.length ? { params: { spreadsheetId: Pm.spreadsheetId ?? null, values: v }, soft: [] } : null; break; }
    default: return null;
  }
  return r;
}

/**
 * Apply a mapping reply to the compiled checks: each mapped check replaces its item's judged check when validateMapped
 * accepts it. Shared by the pipeline (codeowned.mjs) and the replay tools (replay/lib.mjs), so B4 and P0 measure the
 * pipeline's own compile. `itemFor(c)` names the requirement a mapped check answers (the pipeline: by id; a recorded
 * reply: by statement). Hard only when the item has majority support and validateMapped keeps a hard value; minority
 * values join the check's soft list. -> { pcs, mapped }
 */
export function applyMapped(pcs, reply, { itemFor, sources, inv, majority, P = {}, why = 'mapped by the mapping call; values found in sources' }) {
  const out = [...pcs];
  let mapped = 0;
  for (const c of Array.isArray(reply?.checks) ? reply.checks : []) {
    const item = itemFor(c);
    const v = item ? validateMapped(c, sources, inv, { item, majority, P }) : null;
    if (!v) continue;
    const idx = out.findIndex(p => p.item === item.id && p.type === 'judged');
    if (idx < 0) continue;
    out[idx] = { ...out[idx], type: c.type, params: v.params, app: c.type.startsWith('gmail') ? 'gmail' : c.type.startsWith('slack') ? 'slack' : v.params.app ?? out[idx].app, hard: item.support >= majority && (v.hardValue ?? true),
      soft: [...(out[idx].soft ?? []), ...v.soft.map(value => ({ name: 'value', value, why: 'a value fewer than a majority of readers wrote' }))], why };
    mapped += 1;
  }
  out.satisfiability = pcs.satisfiability; out.stats = pcs.stats;
  return { pcs: out, mapped };
}

export function pcmapPrompt({ items, inventoryText, dateNote = null }) {
  return `Each requirement below could not be turned into a check automatically. For each one, choose the check type that tests it on the systems' state after the work, in the requirement's own app, and fill in its parameters with values copied exactly from the records (or from the requirement). A value is a name, address, id, amount, date or prescribed wording, never an instruction sentence or a placeholder. Use "judged" when no type fits the requirement's app.

Check types:
- gmail_sent {"to": [addresses], "cc": [addresses], "subject": [exact words the subject must contain], "body": [exact phrases the body must contain]}
- gmail_not_sent {"to": [addresses]}
- slack_posted {"channel": "<name or id>", "text": [exact phrases]}
- slack_not_posted {"channel": "<name or id>"}
- record_field {"ptr": "<record pointer>", "field": "<field name>", "value": "<value after the work>"}
- record_created {"app": "<app>", "kind": "<record kind or null>", "values": [exact values the new record carries]}
- record_deleted {"ptr": "<record pointer>"}
- sheet_row {"spreadsheetId": "<id or null>", "values": [exact cell values of the row]}
- channel_posted {"app": "<app>", "channel": "<page, profile, number or channel, or null>", "text": [exact phrases]}  (posts and messages in apps other than gmail and slack)
- child_created {"parent": "<record pointer>", "kind": "<note, comment, reply, task, tag or event>", "values": [exact values]}
${dateNote ? `\n${dateNote}\n` : ''}
<requirements>
${items.map(i => `- ${i.id}: ${i.statement} (action ${i.action}${i.app ? `, app ${i.app}` : ''}; target ${i.target || '?'}; values ${i.fields.filter(f => f.vtype !== 'clause').map(f => `${f.name}=${JSON.stringify(f.value)}`).join(', ') || 'none'})`).join('\n')}
</requirements>

<records>
${inventoryText}
</records>

Reply with JSON only: {"checks": [{"requirement": "<id>", "type": "...", "params": {...}}]}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Re-reading the world and evaluating

/** The app a check reads (null: the connected apps, for a judged check without an app). */
export function checkApp(pc) {
  const P = pc.params ?? {};
  switch (pc.type) {
    case 'gmail_sent': case 'gmail_not_sent': return 'gmail';
    case 'slack_posted': case 'slack_not_posted': return 'slack';
    case 'sheet_row': case 'row_not_exists': return 'google_sheets';
    case 'record_field': case 'record_deleted': case 'record_unchanged': return String(P.ptr ?? '').split(':')[0] || null;
    case 'child_created': return String(P.parent ?? '').split(':')[0] || null;
    case 'record_created': case 'channel_posted': return P.app ?? null;
    default: return pc.app ?? null;
  }
}
/** Can the re-read observe this check? (M2: a check on an app with no listing is unobservable, never failed.) */
export const isObservable = pc => { const a = checkApp(pc); return a === null || observable(a); };

/** The apps a set of checks needs re-read (google_sheets needs google_drive to list spreadsheets). */
export function appsToRead(pcs, inv) {
  const apps = new Set();
  for (const p of pcs) {
    const a = checkApp(p);
    if (a === null) { if (p.type === 'judged') for (const x of inv?.connected ?? []) apps.add(x); continue; }
    apps.add(a);
    if (a === 'google_sheets') apps.add('google_drive');
  }
  return [...apps].filter(a => ENUM_PLAN.some(e => e.app === a && !e.probe) || a === 'google_sheets');
}
/** A fresh read of the given apps through the v2 enumeration code (no look-ups, no precedents). */
export async function rereadWorld({ client, apps, maxSteps = 3, node = 'check' }) {
  if (!apps.length) return { records: [], steps: 0, apps: {}, connected: [], outOfScope: [], errors: [] };
  return buildInventory({ request: '', client, maxSteps, node, only: apps });
}

const recipientsOf = d => emails([d.to, d.cc, d.bcc].flat().filter(Boolean).join(' '));
const fieldValue = (data, field) => {
  const want = singular(String(field).toLowerCase().replace(/[^a-z0-9]/g, ''));
  for (const [k, v] of Object.entries(data ?? {})) if (singular(k.toLowerCase().replace(/[^a-z0-9]/g, '')) === want) return v;
  for (const v of Object.values(data ?? {})) if (v && typeof v === 'object' && !Array.isArray(v)) { const x = fieldValue(v, field); if (x !== undefined) return x; }
  return undefined;
};
/** A field equals the expected value: tolerant scalar comparison; membership for a list; containment for text > 80 chars. */
export function fieldMatches(v, expected) {
  if (Array.isArray(v)) return v.some(x => (x && typeof x === 'object' ? Object.values(x).some(y => sameValue(y, expected)) : sameValue(x, expected)));
  if (v === undefined || v === null) return false;
  if (typeof v === 'object') return hasValue(JSON.stringify(v), expected);
  if (sameValue(v, expected)) return true;
  return String(expected).length > 80 && hasValue(String(v), expected);
}
const MSG_TEXT = d => `${d.subject ?? ''}\n${d.body_plain ?? d.snippet ?? ''}\n${d.body_html ?? ''}`;
const POST_KINDS = /feed|update|post|tweet|message|status|share|media/i;
const banned = (text, list) => (list ?? []).filter(s => hasValue(text, s));

// Two kinds of undecided verdict, both null and both decided before the outcome is looked at:
//   unobservable  the first read never LISTED what the check reads (no listing for the app or kind, or a listing that
//                 cannot tie a child to its parent): capability, never a failure;
//   notReread     the first read listed it but the bounded re-read did not reach it (its step cap): no evidence either way.
// A kind that was listed, even empty, is observable: a missing post or record then FAILS.
const FIXED_KIND = Object.freeze({ gmail_sent: ['gmail', 'message'], gmail_not_sent: ['gmail', 'message'], slack_posted: ['slack', 'message'], slack_not_posted: ['slack', 'message'], sheet_row: ['google_sheets', 'row'], row_not_exists: ['google_sheets', 'row'] });
const unobs = why => ({ pass: null, evidence: `unobservable: ${why}`, unobservable: true });
const notReread = why => ({ pass: null, evidence: `not re-read: ${why}`, notReread: true });
/** Evaluate one check on (initial inventory, fresh read). -> {pass: true|false|null, evidence, unobservable?, notReread?} */
export function evaluate(pc, before, after) {
  if (!isObservable(pc)) return { pass: null, evidence: 'unobservable', unobservable: true };
  const P = pc.params;
  const fixed = FIXED_KIND[pc.type];
  if (fixed && lists(before, fixed[0], k => sameKind(k, fixed[1])) && !lists(after, fixed[0], k => sameKind(k, fixed[1]))) return notReread(`${fixed[0]} ${fixed[1]} records were not listed again`);
  const d = worldDiff(before, after);
  switch (pc.type) {
    case 'gmail_sent': {
      const sent = d.added.filter(r => r.app === 'gmail' && r.kind === 'message');
      const toAll = sent.filter(r => P.to.every(e => recipientsOf(r.data).includes(e)));
      if (!toAll.length) return { pass: false, evidence: `no new message to ${P.to.join(', ')} (${sent.length} new message(s): ${sent.map(r => `to ${recipientsOf(r.data).join(', ')}`).slice(0, 5).join('; ') || 'none'})` };
      const scored = toAll.map(r => { const text = MSG_TEXT(r.data); const miss = [...(P.subject ?? []).filter(s => !hasValue(r.data.subject ?? '', s)).map(s => `subject "${s}"`), ...(P.body ?? []).filter(s => !hasValue(text, s)).map(s => `"${s}"`), ...(P.cc ?? []).filter(e => !recipientsOf(r.data).includes(e)).map(e => `cc ${e}`), ...banned(text, P.bodyNot).map(s => `left-out "${s}" present`)]; return { r, miss }; }).sort((x, y) => x.miss.length - y.miss.length);
      return scored[0].miss.length ? { pass: false, evidence: `message ${scored[0].r.ptr} to ${P.to.join(', ')}: ${scored[0].miss.join(', ')}` } : { pass: true, evidence: `message ${scored[0].r.ptr}` };
    }
    case 'gmail_not_sent': {
      const bad = d.added.filter(r => r.app === 'gmail' && r.kind === 'message' && P.to.some(e => recipientsOf(r.data).includes(e)));
      return bad.length ? { pass: false, evidence: `new message(s) to ${P.to.join(', ')}: ${bad.map(r => r.ptr).join(', ')}` } : { pass: true, evidence: 'no new message to these addresses' };
    }
    case 'slack_posted':
    case 'slack_not_posted': {
      // A direct message: any im channel of that member in the fresh read (one may have been opened by the work).
      const ims = new Set(P.channel.user ? after.records.filter(r => r.app === 'slack' && r.kind === 'channel_list' && String(r.data.user ?? '') === P.channel.user).map(r => String(r.data.id)) : []);
      const inCh = d.added.filter(r => r.app === 'slack' && r.kind === 'message' && ((P.channel.id && r.data.channel === P.channel.id) || ims.has(String(r.data.channel)) || (!P.channel.dm && P.channel.name && String(r.data.name ?? '').toLowerCase() === String(P.channel.name).toLowerCase()) || (!P.channel.id && !P.channel.dm && String(r.ptr).split(':')[2]?.split('/')[0] === P.channel.name)));
      if (pc.type === 'slack_not_posted') return inCh.length ? { pass: false, evidence: `new message(s) in #${P.channel.name ?? P.channel.id}: ${inCh.map(r => r.ptr).join(', ')}` } : { pass: true, evidence: 'no new message in the channel' };
      if (!inCh.length) return { pass: false, evidence: `no new message in ${P.channel.dm ? '' : '#'}${P.channel.name ?? P.channel.id}` };
      const scored = inCh.map(r => { const text = r.data.text ?? recordText(r.data); return { r, miss: [...(P.text ?? []).filter(s => !hasValue(text, s)).map(s => `"${s}"`), ...banned(text, P.bodyNot).map(s => `left-out "${s}" present`)] }; }).sort((x, y) => x.miss.length - y.miss.length);
      return scored[0].miss.length ? { pass: false, evidence: `message ${scored[0].r.ptr}: ${scored[0].miss.join(', ')}` } : { pass: true, evidence: `message ${scored[0].r.ptr}` };
    }
    case 'channel_posted': {
      // Capability from the first read: an app whose listings hold no post-like kind (only the account) cannot show a post.
      const postKind = k => POST_KINDS.test(String(k));
      if (!lists(before, P.app, postKind)) return unobs(`the ${P.app} listings hold no posts`);
      if (!lists(after, P.app, postKind)) return notReread(`the ${P.app} posts were not listed again`);
      const fresh = d.added.filter(r => r.app === P.app && postKind(r.kind) && (!P.channel || hasValue(recordText(r.data), P.channel) || String(r.ptr).includes(P.channel)));
      if (!fresh.length) return { pass: false, evidence: `no new ${P.app} post${P.channel ? ` in ${P.channel}` : ''}` };
      const scored = fresh.map(r => { const text = recordText(r.data); return { r, miss: [...(P.text ?? []).filter(s => !hasValue(text, s)).map(s => `"${s}"`), ...banned(text, P.bodyNot).map(s => `left-out "${s}" present`)] }; }).sort((x, y) => x.miss.length - y.miss.length);
      return scored[0].miss.length ? { pass: false, evidence: `post ${scored[0].r.ptr}: ${scored[0].miss.join(', ')}` } : { pass: true, evidence: `post ${scored[0].r.ptr}` };
    }
    case 'record_field': {
      const r = after.records.find(x => x.ptr === P.ptr);
      const [rApp, rKind] = String(P.ptr).split(':');
      if (!r && !lists(after, rApp, k => k === rKind || sameKind(k, rKind))) return notReread(`${rApp} ${rKind} records were not listed again`);
      if (!r) return { pass: false, evidence: `record ${P.ptr} not found on re-read` };
      const v = fieldValue(r.data, P.field);
      return fieldMatches(v, P.value) ? { pass: true, evidence: `${P.field} = ${JSON.stringify(v).slice(0, 200)}` } : { pass: false, evidence: `${P.ptr} ${P.field} = ${JSON.stringify(v ?? null).slice(0, 200)}, expected ${JSON.stringify(P.value)}` };
    }
    case 'record_deleted': {
      if (after.records.some(x => x.ptr === P.ptr)) return { pass: false, evidence: `${P.ptr} still present` };
      const was = before.records.filter(x => x.ptr === P.ptr);
      return certainRemovals(before, after, was).length ? { pass: true, evidence: 'gone' } : { pass: null, evidence: `${P.ptr} not re-read: cannot tell` };
    }
    case 'record_unchanged': {
      const was = before.records.find(x => x.ptr === P.ptr), now = after.records.find(x => x.ptr === P.ptr);
      if (!was) return { pass: null, evidence: `${P.ptr} not in the first read` };
      if (!now) return certainRemovals(before, after, [was]).length ? { pass: false, evidence: `${P.ptr} removed` } : { pass: null, evidence: `${P.ptr} not re-read: cannot tell` };
      return JSON.stringify(was.data) === JSON.stringify(now.data) ? { pass: true, evidence: 'unchanged' } : { pass: false, evidence: `${P.ptr} changed` };
    }
    case 'record_created': {
      // Capability from the first read: the kind was listed (even empty), else no new record of it can be seen.
      const kindOk = k => !P.kind || sameKind(k, P.kind);
      if (P.kind && !lists(before, P.app, kindOk)) return unobs(`${P.app} ${P.kind} records are not listed`);
      if (!lists(after, P.app, kindOk)) return notReread(`${P.app}${P.kind ? ` ${P.kind}` : ''} records were not listed again`);
      const fresh = d.added.filter(r => r.app === P.app && kindOk(r.kind));
      const best = fresh.map(r => ({ r, miss: P.values.filter(v => !hasValue(recordText(r.data), v)) })).sort((x, y) => x.miss.length - y.miss.length)[0];
      if (!best) return { pass: false, evidence: `no new ${P.app}${P.kind ? ` ${P.kind}` : ''} record` };
      return best.miss.length ? { pass: false, evidence: `new record ${best.r.ptr} lacks ${best.miss.map(v => `"${v}"`).join(', ')}` } : { pass: true, evidence: `record ${best.r.ptr}` };
    }
    case 'child_created': {
      const app = String(P.parent).split(':')[0], parentKind = String(P.parent).split(':')[1], pid = String(P.parent).split(':').slice(2).join(':');
      const kindOk = k => sameKind(k, P.kind);
      const scalar = v => typeof v === 'string' || typeof v === 'number';
      // Capability from the first read: the child kind was listed (even empty), and its listing ties a record to its
      // parent by an exact field value (records of the kind there name a record of the parent kind; an empty listing is
      // a per-parent listing, which carries the parent's id). The parent's own change is never read as the child.
      if (!lists(before, app, kindOk)) return unobs(`${app} ${P.kind} records are not listed`);
      const parentIds = new Set(before.records.filter(r => r.app === app && sameKind(r.kind, parentKind)).map(r => String(r.id)));
      const ofKind = before.records.filter(r => r.app === app && kindOk(r.kind));
      if (ofKind.length && !ofKind.some(r => Object.values(r.data ?? {}).some(v => scalar(v) && parentIds.has(String(v))))) return unobs(`the ${app} ${P.kind} listing does not name its parent`);
      if (!lists(after, app, kindOk)) return notReread(`${app} ${P.kind} records were not listed again`);
      const kids = d.added.filter(r => r.app === app && kindOk(r.kind) && Object.values(r.data ?? {}).some(v => scalar(v) && String(v) === pid));
      const best = kids.map(r => ({ r, miss: P.values.filter(v => !hasValue(recordText(r.data), v)) })).sort((x, y) => x.miss.length - y.miss.length)[0];
      if (best) return best.miss.length ? { pass: false, evidence: `new ${P.kind} ${best.r.ptr} lacks ${best.miss.map(v => `"${v}"`).join(', ')}` } : { pass: true, evidence: `${P.kind} ${best.r.ptr}` };
      return { pass: false, evidence: `no new ${P.kind} on ${P.parent}` };
    }
    case 'sheet_row':
    case 'row_not_exists': {
      const rows = [...d.added, ...d.changed.map(c => c.after)].filter(r => r.app === 'google_sheets' && r.kind === 'row' && (!P.spreadsheetId || r.data.spreadsheetId === P.spreadsheetId));
      const carries = r => P.values.filter(v => !Object.values(r.data).some(c => sameValue(c, v) || hasValue(String(c), v)));
      if (pc.type === 'row_not_exists') { const bad = rows.filter(r => !carries(r).length); return bad.length ? { pass: false, evidence: `row(s) ${bad.map(r => r.ptr).join(', ')} carry ${P.values.map(v => JSON.stringify(v)).join(', ')}` } : { pass: true, evidence: 'no new or changed row carries it' }; }
      const best = rows.map(r => ({ r, miss: carries(r) })).sort((x, y) => x.miss.length - y.miss.length)[0];
      if (!best) return { pass: false, evidence: `no new or changed row${P.spreadsheetId ? ` in ${P.spreadsheetId}` : ''}` };
      return best.miss.length ? { pass: false, evidence: `row ${best.r.ptr} lacks ${best.miss.map(v => `"${v}"`).join(', ')}` } : { pass: true, evidence: `row ${best.r.ptr}` };
    }
    default: return { pass: null, evidence: 'decided by the checker' };
  }
}

export const _internal = { singular, fieldValue, compactRecord, RECORD_KIND };
