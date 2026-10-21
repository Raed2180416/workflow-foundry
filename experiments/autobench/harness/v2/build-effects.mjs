#!/usr/bin/env node
// Build-time generator of harness/v2/effects.json (A1-C v2, mechanism M2; research/automationbench-20261014/A1C-V2-DESIGN.md).
// NOT imported at run time. It reads ONLY the API schema index the environment ships for api_search
// (corpus/AutomationBench/automationbench/tools/api/schemas/index.txt: app, operation id, METHOD, path, description) and
// the per-app schema files beside it (<app>.jsonc: the API name, the base URL and each endpoint's documented request
// shape). Nothing under impl/, rubric/ or the task definitions is read. One row per index line:
//   {app, appKey, op, method, path, effect: list|get|create|update|delete|send|other, kind, parent: {param, kind}|null,
//    channel, creates?, bodyIs?, bodyIsNot?}
//   effect   from METHOD plus the operation id's last token; an outgoing messaging channel (not "note") makes it "send",
//            and `creates` marks a send that also creates a record of `kind` (a reply or comment on a ticket);
//   kind     the operation id's resource token, singularized (for a create on a sub-collection under a {param}: the
//            sub-collection, with `parent` naming the param and the parent collection's kind); a sub-collection create that
//            shares its METHOD + path with another operation takes the operation id's last token (the path cannot name it);
//   channel  MESSAGING_RULE below, applied to every operation's index description (no per-operation list);
//   bodyIs / bodyIsNot  for operations that share one METHOD + path: the request field the schema pins to a constant
//            (`field: "value" (required)`, e.g. an internal note posted on the reply path with message_type "note"), so a
//            call is matched to the operation its body selects.
//   node experiments/autobench/harness/v2/build-effects.mjs [--check]   (--check: exit 1 when effects.json is stale)
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
export const SCHEMAS = path.join(REPO, 'corpus/AutomationBench/automationbench/tools/api/schemas');
export const OUT = path.join(HERE, 'effects.json');

/**
 * MESSAGING_RULE (stated once, applied to every operation; recorded in effects.json): the channel of a write operation
 * (POST, PUT, PATCH) from its index description. S is the description's first sentence (the operation's summary), D the
 * whole description; SEND is send|sends|deliver|delivers|dispatch|dispatches. The first match wins:
 *   sms     S: SEND ... "SMS" or "text message"
 *   chat    S: SEND ... "message" ... "channel"
 *   dm      S: SEND ... "direct message"
 *   email   S: SEND ... e-mail | draft | campaign | invoice | estimate | receipt; or S starts with "Email a(n)"
 *   esign   S: SEND ... "envelope"
 *   social  S: publish(es); or queue|create|share|schedule a (new) post; or add|upload ... photo|video ... page|feed|profile
 *   reply   S: post|send|append|write|attach ... reply|replies|response; or D: "visible to the requester"
 *   note    S: internal|private ... note|annotation|comment (an agent-only note: not an outgoing message)
 * Every other operation has no channel. GET and DELETE never have one.
 */
export const MESSAGING_RULE = Object.freeze({
  scope: 'write operations (POST, PUT, PATCH); S = the index description\'s first sentence, D = the whole description; first match wins',
  order: ['sms', 'chat', 'dm', 'email', 'esign', 'social', 'reply', 'note'],
  outgoing: ['sms', 'chat', 'dm', 'email', 'esign', 'social', 'reply'],
});
const SEND_VERB = '(?:send|sends|deliver|delivers|dispatch|dispatches)';
const RULES = [
  ['sms', s => new RegExp(`\\b${SEND_VERB}\\b[^.]*\\b(sms|text message)\\b`, 'i').test(s)],
  ['chat', s => new RegExp(`\\b${SEND_VERB}\\b[^.]*\\bmessage\\b[^.]*\\bchannel\\b`, 'i').test(s)],
  ['dm', s => new RegExp(`\\b${SEND_VERB}\\b[^.]*\\bdirect message\\b`, 'i').test(s)],
  ['email', s => new RegExp(`\\b${SEND_VERB}\\b[^.]*\\b(e-?mail|draft|campaign|invoice|estimate|receipt)s?\\b`, 'i').test(s) || /^e-?mail an? /i.test(s)],
  ['esign', s => new RegExp(`\\b${SEND_VERB}\\b[^.]*\\benvelope\\b`, 'i').test(s)],
  ['social', s => /\b(publish|publishes)\b/i.test(s) || /\b(queue|create|share|schedule)s? (a|an) (new )?post\b/i.test(s) || /\b(add|adds|upload|uploads)\b[^.]*\b(photo|video)\b[^.]*\b(page|feed|profile)\b/i.test(s)],
  ['reply', (s, d) => /\b(post|posts|send|sends|append|appends|write|writes|attach|attaches)\b[^.]*\b(reply|replies|response)\b/i.test(s) || /\bvisible to the requester\b/i.test(d)],
  ['note', s => /\b(internal|private)\b[^.]*\b(note|annotation|comment)s?\b/i.test(s)],
];
/** The messaging channel of one operation by MESSAGING_RULE (null: not a messaging operation). */
export function channelOf(method, description) {
  if (!['POST', 'PUT', 'PATCH'].includes(String(method).toUpperCase())) return null;
  const d = String(description ?? '');
  const s = (d.match(/^[^.]*\./) ?? [d])[0];
  for (const [ch, test] of RULES) if (test(s, d)) return ch;
  return null;
}
/** Request fields the schema pins to a constant: `{field: "value" (required), ...}` -> {field: value}. */
export function requestConstants(request) {
  const out = {};
  for (const m of String(request ?? '').matchAll(/(\w+):\s*"([^"]+)"\s*\(required\)/g)) out[m[1]] = m[2];
  return out;
}

const sha256 = b => createHash('sha256').update(b).digest('hex');
const stripComments = t => t.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
export function singular(w) {
  const s = String(w ?? '').toLowerCase();
  if (s.length <= 3) return s;
  if (/ies$/.test(s)) return s.slice(0, -3) + 'y';
  if (/(ss|us|is)$/.test(s)) return s;
  if (/(ches|shes|xes|zes|sses|uses)$/.test(s)) return s.slice(0, -2);
  if (s.endsWith('s')) return s.slice(0, -1);
  return s;
}
const CREATE = /^(create|insert|add|append|upload|comment|note|post|publish|copy|quickadd|invite|follow|like|findorcreate|addrow|addnote|addmessage|addtask|addtag|addcontact|addcompany|run|launch|convertlead|tweet)/i;
const UPDATE = /^(update|patch|modify|set|move|changestatus|tag|untag|addlabel|idlabels|untrash|operate|mutate|submit|approve|status|updatecolumn|updatefield|updaterow|removemembers|removeemail|removetag)/i;
const DELETE = /^(delete|remove|trash|archive|cancel|clear|void)/i;
const READ = /^(search|find|query|list|get|retrieve|read|show|info|view|history|replies|calculator|changed|whosout|directory|search_|batchget)/i;
const SEND = /^(send|reply|postmessage|emailsimple|create_message)/i;
/** effect from METHOD + the operation id's last token. */
export function effectOf(method, op, p, channel) {
  const last = String(op).split('.').at(-1).replace(/[^A-Za-z_]/g, '');
  if (channel && channel !== 'note') return 'send';
  if (method === 'DELETE') return 'delete';
  if (method === 'GET') return /\}$/.test(p) || /^(get|retrieve|read|show|info|view)/i.test(last) ? 'get' : 'list';
  if (SEND.test(last)) return 'send';
  if (READ.test(last) && !CREATE.test(last)) return 'list';
  if (DELETE.test(last)) return 'delete';
  if (UPDATE.test(last)) return 'update';
  if (CREATE.test(last)) return 'create';
  if (method === 'PUT' || method === 'PATCH') return 'update';
  return 'other';
}
/** kind and parent: a create posting to a sub-collection under a {param} names the sub-collection; otherwise the
 * operation's resource token. */
// Path segments that name an action, not a collection; params that scope an account, not a parent record.
const VERB_SEG = /^(quickadd|add[a-z]*|send|run|publish|move|search|create|update|cancel(lation)?|copy(to)?|append|clear|find|launch|convertlead|emailsimple|mutate|removemembers)$/i;
const SCOPE_PARAM = /^(userid|accountid|accountsid|companyid|company_id|customerid|workspaceid|pixelid|pageid|businessid|teamid|companydomain|baseid|brand|account)$/i;
export function kindOf(op, p, effect) {
  const toks = String(op).split('.');
  const resource = singular(toks.length >= 3 ? toks.at(-2) : toks.at(-1));
  const segs = String(p).split('/').filter(Boolean).map(s => s.replace(/:.*$/, '').replace(/\.json$/, ''));
  const isParam = s => /^\{[^}]+\}$/.test(s);
  const lastParam = segs.map((s, i) => (isParam(s) && !SCOPE_PARAM.test(s.slice(1, -1)) ? i : -1)).filter(i => i >= 0).at(-1);
  if (effect === 'create' && lastParam !== undefined && lastParam > 0) {
    const sub = segs.slice(lastParam + 1).filter(s => s && !isParam(s) && !/^(actions|v\d+(\.\d+)?)$/i.test(s) && !VERB_SEG.test(s)).at(-1);
    if (sub) {
      const before = segs[lastParam - 1];
      const pk = before && !isParam(before) && !/^v\d/i.test(before) ? singular(before) : resource;
      return { kind: singular(sub), parent: { param: segs[lastParam].slice(1, -1), kind: pk } };
    }
  }
  return { kind: resource, parent: null };
}

export function buildEffects({ schemas = SCHEMAS } = {}) {
  const indexText = readFileSync(path.join(schemas, 'index.txt'), 'utf8');
  const apps = {}, files = {}, requests = {};
  for (const f of readdirSync(schemas).filter(x => x.endsWith('.jsonc')).sort()) {
    const raw = readFileSync(path.join(schemas, f));
    files[f] = sha256(raw);
    const j = JSON.parse(stripComments(raw.toString('utf8')));
    apps[j.api] = { appKey: f.replace(/\.jsonc$/, ''), baseUrl: j.baseUrl ?? null };
    for (const e of Array.isArray(j.endpoints) ? j.endpoints : []) if (e?.id) requests[e.id] = e.request ?? null;
  }
  const rows = [];
  for (const line of indexText.split('\n')) {
    if (!line.trim()) continue;
    const [app, op, method, p, description] = line.split('\t');
    if (!app || !op || !method || !p) continue;
    const channel = channelOf(method, description);
    // The record an operation writes comes from its own effect; an outgoing message is a "send" on top of that.
    const base = effectOf(method.toUpperCase(), op, p, null);
    const effect = effectOf(method.toUpperCase(), op, p, channel);
    const { kind, parent } = kindOf(op, p, base);
    rows.push({ app, appKey: apps[app]?.appKey ?? app, op, method: method.toUpperCase(), path: p, effect, kind, parent, channel, ...(base === 'create' && effect !== 'create' ? { creates: true } : {}) });
  }
  // Operations sharing one METHOD + path: the operation id names the kind, and the schema's pinned request constants
  // tell the calls apart (the operation with a constant matches calls carrying it; the others, calls that do not).
  const byRoute = new Map();
  for (const r of rows) { const k = `${r.method} ${r.path}`; if (!byRoute.has(k)) byRoute.set(k, []); byRoute.get(k).push(r); }
  for (const group of byRoute.values()) {
    if (group.length < 2) continue;
    const consts = group.map(r => requestConstants(requests[r.op]));
    group.forEach((r, i) => {
      if (r.parent) r.kind = singular(String(r.op).split('.').at(-1).replace(/[^A-Za-z_]/g, ''));
      if (Object.keys(consts[i]).length) r.bodyIs = consts[i];
      else { const not = Object.assign({}, ...consts.filter((c, j) => j !== i)); if (Object.keys(not).length) r.bodyIsNot = not; }
    });
  }
  let commit = null;
  try { commit = spawnSync('git', ['-C', path.resolve(schemas, '../../../..'), 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 20_000 }).stdout.trim() || null; } catch { /* no git */ }
  return { generatedBy: 'experiments/autobench/harness/v2/build-effects.mjs', source: { indexTxtSha256: sha256(indexText), corpusCommit: commit, schemaFiles: files },
    messagingRule: MESSAGING_RULE, apps, rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = JSON.stringify(buildEffects(), null, 1) + '\n';
  if (process.argv.includes('--check')) {
    let cur = null; try { cur = readFileSync(OUT, 'utf8'); } catch { /* missing */ }
    if (cur !== out) { process.stderr.write('effects.json is stale: rebuild with node experiments/autobench/harness/v2/build-effects.mjs\n'); process.exit(1); }
    process.stdout.write('effects.json is current\n');
  } else { writeFileSync(OUT, out); process.stdout.write(`wrote ${OUT}\n`); }
}
