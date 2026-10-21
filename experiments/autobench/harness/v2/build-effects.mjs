#!/usr/bin/env node
// Build-time generator of harness/v2/effects.json (A1-C v2, mechanism M2; research/automationbench-20261014/A1C-V2-DESIGN.md).
// NOT imported at run time. It reads ONLY the API schema index the environment ships for api_search
// (corpus/AutomationBench/automationbench/tools/api/schemas/index.txt: app, operation id, METHOD, path, description) and
// the per-app schema files beside it (<app>.jsonc: the API name and base URL). Nothing under impl/, rubric/ or the task
// definitions is read. One row per index line:
//   {app, appKey, op, method, path, effect: list|get|create|update|delete|send|other, kind, parent: {param, kind}|null, channel}
//   effect   from METHOD plus the operation id's last token;
//   kind     the operation id's resource token, singularized (for a create on a sub-collection under a {param}: the
//            sub-collection, with `parent` naming the param and the parent collection's kind);
//   channel  hand-written for the messaging operations below (email, chat, dm, sms, social, esign, reply), from the schemas.
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

/** Messaging operations (hand-written from the schema descriptions): operation id -> channel. */
export const CHANNELS = Object.freeze({
  'gmail.users.messages.send': 'email', 'gmail.users.drafts.send': 'email', 'salesforce.actions.emailSimple': 'email', 'mailchimp.campaigns.send': 'email',
  'slack.chat.postMessage': 'chat',
  'linkedin.messages.create': 'dm',
  'twilio.messages.create': 'sms',
  'twitter.tweets.create': 'social', 'linkedin.ugcPosts.create': 'social', 'linkedin.companyUpdates.create': 'social', 'facebook_pages.feed.create': 'social',
  'facebook_pages.photos.create': 'social', 'instagram.media.publish': 'social', 'buffer.updates.create': 'social',
  'docusign.envelopes.create': 'esign',
  'helpscout.conversations.reply': 'reply', 'intercom.conversations.reply': 'reply', 'reamaze.conversations.addMessage': 'reply', 'gorgias.tickets.create_message': 'reply',
});

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
  if (channel) return 'send';
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
  const apps = {}, files = {};
  for (const f of readdirSync(schemas).filter(x => x.endsWith('.jsonc')).sort()) {
    const raw = readFileSync(path.join(schemas, f));
    files[f] = sha256(raw);
    const j = JSON.parse(stripComments(raw.toString('utf8')));
    apps[j.api] = { appKey: f.replace(/\.jsonc$/, ''), baseUrl: j.baseUrl ?? null };
  }
  const rows = [];
  for (const line of indexText.split('\n')) {
    if (!line.trim()) continue;
    const [app, op, method, p] = line.split('\t');
    if (!app || !op || !method || !p) continue;
    const channel = CHANNELS[op] ?? null;
    const effect = effectOf(method.toUpperCase(), op, p, channel);
    const { kind, parent } = kindOf(op, p, effect);
    rows.push({ app, appKey: apps[app]?.appKey ?? app, op, method: method.toUpperCase(), path: p, effect, kind, parent, channel });
  }
  let commit = null;
  try { commit = spawnSync('git', ['-C', path.resolve(schemas, '../../../..'), 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 20_000 }).stdout.trim() || null; } catch { /* no git */ }
  return { generatedBy: 'experiments/autobench/harness/v2/build-effects.mjs', source: { indexTxtSha256: sha256(indexText), corpusCommit: commit, schemaFiles: files },
    channels: CHANNELS, apps, rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = JSON.stringify(buildEffects(), null, 1) + '\n';
  if (process.argv.includes('--check')) {
    let cur = null; try { cur = readFileSync(OUT, 'utf8'); } catch { /* missing */ }
    if (cur !== out) { process.stderr.write('effects.json is stale: rebuild with node experiments/autobench/harness/v2/build-effects.mjs\n'); process.exit(1); }
    process.stdout.write('effects.json is current\n');
  } else { writeFileSync(OUT, out); process.stdout.write(`wrote ${OUT}\n`); }
}
