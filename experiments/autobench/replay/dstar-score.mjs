// Scoring scaffold for the Δ* v1 replays (ATTACK Move 1-2, $0). DEVELOPER TOOL: it reads the official grades
// (grade.json) of stored dev60 runs, so nothing here may be imported by a harness, a verifier or anything that builds a
// model context. Δ* is built BEFORE this module sees a grade (dstar-replay.mjs builds, then scores).
//
// Oracle-implied labels are a scoring scaffold only (ATTACK §6 Move 1, step A): a negative assertion that the run broke
// is a "broken guardrail"; its discriminating literal or id says which member the guardrail protects; a positive
// assertion's literal names a required member. These labels never enter Δ*.
import { readFileSync } from 'node:fs';
import { norm } from '../verifier/requirement-ledger-v3/lib.mjs';

export const SCORE_VERSION = 'dstar-score-v1';
export const isNegative = type => /_not_|not_exists$|_not$/.test(String(type));
// Assertion params that name targets or containers, not the guarded content
const TARGET_KEYS = new Set(['to', 'channel_name', 'channel', 'spreadsheet_id', 'worksheet_id', 'action_key', 'cloudId', 'space_id']);
const ID_KEYS = new Set(['conversation_id', 'ticket_id', 'record_id', 'contact_id', 'message_id', 'email', 'customer_id', 'issue_id']);

export function readGrade(hostDir) { return JSON.parse(readFileSync(`${hostDir}/grade.json`, 'utf8')); }

/** Literal strings and ids of an assertion's params (targets excluded). */
export function assertionTerms(a) {
  const lits = [], ids = [];
  const walk = (k, v) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) return v.forEach(x => walk(k, x));
    if (typeof v === 'object') return Object.entries(v).forEach(([k2, x]) => walk(k2, x));
    const s = String(v).trim();
    if (!s) return;
    if (TARGET_KEYS.has(k)) return;
    if (ID_KEYS.has(k)) ids.push(s); else lits.push(s);
  };
  Object.entries(a.params ?? {}).forEach(([k, v]) => walk(k, v));
  return { lits, ids, to: a.params?.to ?? a.params?.email ?? null, channel: a.params?.channel_name ?? a.params?.channel ?? null };
}

/** Broken guardrails of a graded run: scored negative assertions that failed. */
export function brokenGuardrails(grade) {
  return (grade.assertion_results ?? []).filter(a => !a.excluded && !a.passed && isNegative(a.type)).map((a, i) => ({ i, type: a.type, ...assertionTerms(a) }));
}

/** Message-mention breaks (ATTACK Move 2, the latent-requirements sweep's class): a channel or e-mail body that must not
 *  name something. The preregistered class is the sweep's: slack_message_not_in_channel and body_not_contains. */
export const MENTION_TYPES_PREREG = new Set(['slack_message_not_in_channel', 'gmail_message_sent_to_with_body_not_contains']);
export const MENTION_TYPES_WIDE = new Set([...MENTION_TYPES_PREREG, 'slack_message_not_exists', 'gmail_message_not_sent', 'gmail_message_not_sent_to_with_body_contains']);

const containsEither = (a, b) => { const x = norm(a), y = norm(b); return Boolean(x && y && (x.includes(y) || y.includes(x))); };

/** Does a FAILED Δ* check result explain a broken guardrail? Same protected literal (a form, the evidence or the label
 *  names it), or the same protected record or recipient. */
export function aligns(result, g) {
  const ev = String(result.evidence ?? '');
  const forms = [result.label, ...(result.lits ?? [])].filter(Boolean);
  for (const l of g.lits) {
    if (l.length < 2) continue;
    if (forms.some(f => containsEither(f, l))) return true;
    const named = /names "([^"]+)"/.exec(ev)?.[1] ?? /carries "([^"]+)"/.exec(ev)?.[1];
    if (named && containsEither(named, l)) return true;
  }
  for (const id of g.ids) {
    if (String(result.member ?? '').includes(id) || ev.includes(id)) return true;
    if (result.type === 'msg_none' && norm(result.target ?? '') === norm(id)) return true;
  }
  if (!g.lits.length && !g.ids.length && g.to && result.type === 'msg_none' && norm(result.target ?? '') === norm(g.to)) return true;
  return false;
}

/** Required (per target) and protected members of a task, from the scaffold: [{target, lit, polarity}]. */
export function scaffoldTerms(grade) {
  const out = [];
  for (const a of grade.assertion_results ?? []) {
    const t = assertionTerms(a);
    const target = t.to ? `@${norm(t.to)}` : t.channel ? `#${norm(t.channel)}` : '*';
    for (const l of t.lits) if (l.length >= 2) out.push({ target, lit: l, polarity: isNegative(a.type) ? 'must_not' : 'must', type: a.type, excluded: Boolean(a.excluded), passed: a.passed });
    for (const id of t.ids) out.push({ target, id, polarity: isNegative(a.type) ? 'must_not' : 'must', type: a.type, excluded: Boolean(a.excluded), passed: a.passed });
  }
  return out;
}

/**
 * The closure-expressibility scaffold: for every negative assertion of a task, the member it protects (located in the
 * code-enumerated universes by its literal or id) and the Δ* check closure would compile for that member if a reader had
 * disposed it `exclude` (built from the member's mention forms, never from the assertion's own literal). A guardrail
 * whose protected thing is no member of any universe is not closure-expressible. This measures the grammar and the
 * mention forms, given perfect dispositions; it is an oracle-informed ceiling, not a capability.
 */
export function scaffoldNegatives(grade, universes) {
  const out = [];
  const members = universes.flatMap(u => u.members.map(m => ({ u, m })));
  (grade.assertion_results ?? []).forEach((a, i) => {
    if (!isNegative(a.type)) return;
    const t = assertionTerms(a), P = a.params ?? {};
    // a member is named by id, else by one of its mention forms; a bare attribute value names a member only when exactly
    // one member carries it (a shared value such as a status names no single member)
    let named = members.filter(x => t.ids.some(id => memberNamed(x.m, { id })));
    if (!named.length) named = members.filter(x => t.lits.some(l => { const n = norm(l); return n.length >= 3 && (x.m.forms ?? []).some(f => f === n || (f.length >= 4 && n.includes(f)) || (n.length >= 4 && f.includes(n))); }));
    if (!named.length) { const byAttr = members.filter(x => t.lits.some(l => memberNamed(x.m, { lit: l }))); if (byAttr.length === 1) named = byAttr; }
    const app = String(a.type).split('_')[0];
    const lits = x => x.m.forms;
    // a channel named by the assertion is resolved through the enumerated channel list (id and name), as Δ* resolves targets
    const chName = t.channel ? String(t.channel).replace(/^#/, '') : null;
    const ch = chName ? universes.filter(u => u.app === 'slack' && /channel/.test(u.kind)).flatMap(u => u.members).find(m => norm(m.attrs?.name ?? m.label) === norm(chName) || String(m.attrs?.id ?? m.id) === chName) : null;
    const target = t.to ? { email: String(t.to).toLowerCase() } : chName ? { channel: { id: P.channel_id ?? (ch ? String(ch.attrs?.id ?? ch.id) : null), name: chName } } : null;
    const base = { i, type: a.type, excluded: Boolean(a.excluded), passed: a.passed };
    if (/^(gmail_message_not_sent_to|gmail_email_not_sent_to)$/.test(a.type)) { out.push({ ...base, member: null, check: { type: 'msg_none', params: { target: { email: String(t.to).toLowerCase() } } } }); return; }
    if (!named.length) { out.push({ ...base, member: null, check: null, why: 'no enumerated member carries the protected literal or id' }); return; }
    for (const x of named.slice(0, 3)) {
      let check = null;
      if (/^(gmail_|slack_)/.test(a.type)) check = { type: 'msg_lacks_any', params: { target: target ?? {}, lits: lits(x) } };
      else if (/^google_sheets_row_not_exists$/.test(a.type)) check = { type: 'created_none_any', params: { app: 'google_sheets', container: P.spreadsheet_id ?? null, lits: lits(x) } };
      else if (/^google_sheets_row_not_updated$/.test(a.type)) check = { type: 'rec_unchanged', params: { ptr: x.m.key, scope: 'any' } };
      else if (/(conversation|ticket)_not_has_(note|reply|message)/.test(a.type)) check = { type: 'rec_unchanged', params: { ptr: x.m.key, scope: 'reply' } };
      else if (/_not_has_tag$/.test(a.type)) check = { type: 'rec_field_not', params: { ptr: x.m.key, field: 'tags', value: String(P.tag ?? '') } };
      else if (/_field_not_(equals|changed)$/.test(a.type)) check = { type: 'rec_field_not', params: { ptr: x.m.key, field: String(P.field ?? ''), value: String(P.value ?? P.expected_value ?? '') } };
      else if (/^docusign_envelope_not_(sent_to|has_signer)$/.test(a.type)) check = { type: 'created_none_any', params: { app: 'docusign', container: null, lits: [String(P.email ?? P.signer_email ?? '').toLowerCase()] } };
      else check = { type: 'created_none_any', params: { app, container: null, lits: lits(x) } };
      out.push({ ...base, member: { key: x.m.key, label: x.m.label, uid: x.u.uid }, check });
    }
  });
  return out;
}

/** Is a member named by a scaffold term? (a term literal matches one of its forms or one of its attribute values; an id
 *  term matches its key or id) */
export function memberNamed(member, term) {
  if (term.id) return String(member.key ?? '').includes(term.id) || String(member.id ?? '') === term.id || (member.emails ?? []).includes(String(term.id).toLowerCase());
  const l = norm(term.lit);
  if (l.length < 3) return false;
  if ((member.forms ?? []).some(f => f === l || (f.length >= 4 && l.includes(f)) || (l.length >= 4 && f.includes(l)))) return true;
  return Object.values(member.attrs ?? {}).some(v => typeof v === 'string' && v.length <= 120 && norm(v) === l);
}
