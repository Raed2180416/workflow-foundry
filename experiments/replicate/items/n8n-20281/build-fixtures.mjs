#!/usr/bin/env node
// Builds the frozen fixtures from source/cases.mjs:  node build-fixtures.mjs [--write]
//   fixtures/emails.json         the 80 scored mails + the probe mails, in provider-native shapes (Gmail trigger item, Microsoft Graph message); no labels
//   fixtures/labels.json         HIDDEN truth per mail (host side; never in a task)
//   fixtures/jira-seed.json      tickets that exist before the stream starts
//   fixtures/model-recordings.json  recorded answers of the mock classifier (tier standard and small), keyed by the mail's reference token
//   fixtures/example-mails.json  the 10 worked-example mails (T2), their seeds and recordings
// Without --write it only checks that the committed files equal a rebuild. FREEZE.json (hashes) is written by freeze.mjs.
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CASES, SEEDS, NEXT_ISSUE_NUMBER, EXAMPLES, EXAMPLE_SEEDS, PROBES } from './source/cases.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
const hex16 = s => sha(s).slice(0, 16);
export const refOf = id => 'MR-' + sha('ref:' + id).slice(0, 5).toUpperCase();
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SUPPORT_ADDR = { name: 'Brightlane Support', address: 'support@brightlane.example' };

const threadIdOf = (c, threadKey) => c.p === 'g' ? hex16('thread:' + threadKey) : 'AAQkAD' + Buffer.from(sha('conv:' + threadKey), 'hex').toString('base64url').slice(0, 42) + 'AAA=';
const domainOf = addr => addr.split('@')[1];

function quoteText(q) {
  const lines = q.text.split('\n').map(l => '> ' + l).join('\n');
  return `\n\nOn ${q.at} ${q.by[0]} <${q.by[1]}> wrote:\n${lines}`;
}
function quoteHtml(q, subject) {
  return `<hr><div><b>From:</b> ${esc(q.by[0])} &lt;${esc(q.by[1])}&gt;<br><b>Sent:</b> ${esc(q.at)}<br><b>To:</b> Brightlane Support<br><b>Subject:</b> ${esc(subject)}</div><p>${esc(q.text)}</p>`;
}

// One mail in provider-native shape. `date` is filled in by the task generator (delivery position), so it is absent here.
export function rawMail(c) {
  const ref = refOf(c.id);
  const threadKey = c.thread ?? c.id;
  const msgId = hex16('msg:' + c.id);
  const fromObj = { name: c.from[0], address: c.from[1] };
  const ccObjs = (c.cc ?? []).map(([name, address]) => ({ name, address }));
  const footer = `Msg-ref: ${ref}`;
  if (c.p === 'g') {
    const text = `${c.body}\n\n--\n${footer}${c.quote ? quoteText(c.quote) : ''}`;
    const m = {
      id: msgId, threadId: threadIdOf(c, threadKey), labelIds: ['INBOX', 'UNREAD'],
      from: { value: [fromObj], text: `${c.from[0]} <${c.from[1]}>` },
      to: { value: [SUPPORT_ADDR], text: `${SUPPORT_ADDR.name} <${SUPPORT_ADDR.address}>` },
      subject: c.subj, messageId: `<${msgId}@mail.${domainOf(c.from[1])}>`,
      text, textAsHtml: '<p>' + esc(text).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>',
    };
    if (ccObjs.length) m.cc = { value: ccObjs, text: ccObjs.map(o => `${o.name} <${o.address}>`).join(', ') };
    if (c.att) m.attachments = [{ filename: 'attachment.png', contentType: 'image/png', size: 48211 }];
    return m;
  }
  const paras = c.body.split('\n\n').map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const html = `<html><head><style>p{margin:0 0 8px}</style></head><body>${paras}<p>${footer}</p>${c.quote ? quoteHtml(c.quote, c.subj) : ''}</body></html>`;
  const id = 'AAMkAD' + Buffer.from(sha('omsg:' + c.id), 'hex').toString('base64url').slice(0, 40) + 'AAA=';
  return {
    id, conversationId: threadIdOf(c, threadKey), subject: c.subj,
    bodyPreview: c.body.replace(/\s+/g, ' ').slice(0, 200),
    body: { contentType: 'html', content: html },
    from: { emailAddress: { name: fromObj.name, address: fromObj.address } },
    sender: { emailAddress: { name: fromObj.name, address: fromObj.address } },
    toRecipients: [{ emailAddress: { name: SUPPORT_ADDR.name, address: SUPPORT_ADDR.address } }],
    ccRecipients: ccObjs.map(o => ({ emailAddress: { name: o.name, address: o.address } })),
    hasAttachments: !!c.att, isRead: false, importance: 'normal',
    internetMessageId: `<${hex16('imid:' + c.id)}@mail.${domainOf(c.from[1])}>`,
    webLink: `https://outlook.office.example/owa/?ItemID=${encodeURIComponent(id)}&exvsurl=1&viewmodel=ReadMessageItem`,
  };
}

// ---- recorded classifier ------------------------------------------------------------------------------------------------------------
// Entries are [isCustomerRequest, category, priority, confidence]. The standard tier follows the label except where listed in
// STD_CAT / STD_PRI / STD_CONF (hand-picked plausible mistakes: a stand-in for a real model's behaviour, tuned to land near 0.89 / 0.83).
// The small tier is the standard tier plus the extra mistakes below, with lower confidence on its wrong answers.
// Nothing here is evidence about any real model.
const STD_CAT = { b08: 'Issue', i04: 'Bug', n05: 'Issue', a01: 'Issue', a05: 'Other', a09: 'Issue' };
const STD_PRI = { b03: 'Medium', b07: 'Critical', b06: 'High', i01: 'Critical', i07: 'Medium', n03: 'Low', d04: 'Medium', d09: 'Medium', a02: 'Low', a06: 'High' };
const STD_CONF = { b08: 0.74, i04: 0.71, n05: 0.78 };       // confident-looking mistakes
const SMALL_CAT = { b02: ['Issue', 0.57], b05: ['Issue', 0.62], i02: ['New Requirement', 0.55], i06: ['New Requirement', 0.52], n02: ['Issue', 0.6], n04: ['Bug', 0.56],
  n07: ['Issue', 0.58], d06: ['New Requirement', 0.5], p3a: ['Issue', 0.6], b08: [null, 0.8] };
const SMALL_PRI = { b01: ['Medium', 0.66], b04: ['High', 0.64], b09: ['High', 0.68], i08: ['Medium', 0.62], n01: ['Low', 0.7], p4a: ['High', 0.65], x01: ['Medium', 0.69], d02: ['Low', 0.63] };
const SMALL_UNSURE_RIGHT = new Set(['b03', 'i05', 'n06', 'd07', 'p2a', 'o05', 'b06']);   // right but only 0.6..0.74 sure: the cascade pays to double-check these
const pick01 = (id, lo, hi, salt) => lo + (parseInt(sha(salt + id).slice(0, 8), 16) / 0xffffffff) * (hi - lo);
const r2 = x => Math.round(x * 100) / 100;

function recordFor(c) {
  const L = c.L;
  const fail = L.fault ?? null;
  const base = { cr: L.cr, cat: STD_CAT[c.id] ?? L.cat, pri: STD_PRI[c.id] ?? L.pri };
  let sconf;
  if (L.amb) sconf = r2(pick01(c.id, 0.38, 0.57, 'amb'));
  else if (STD_CONF[c.id]) sconf = STD_CONF[c.id];
  else if (!L.cr) sconf = r2(pick01(c.id, 0.88, 0.97, 'oth'));
  else sconf = r2(pick01(c.id, 0.82, 0.97, 'cl'));
  const std = [base.cr, base.cat, base.pri, sconf];
  let small;
  if (L.amb) small = [base.cr, base.cat, base.pri, r2(Math.min(0.6, sconf - 0.03))];
  else if (SMALL_CAT[c.id]) small = [base.cr, SMALL_CAT[c.id][0] ?? base.cat, base.pri, SMALL_CAT[c.id][1]];
  else if (SMALL_PRI[c.id]) small = [base.cr, base.cat, SMALL_PRI[c.id][0], SMALL_PRI[c.id][1]];
  else if (SMALL_UNSURE_RIGHT.has(c.id)) small = [base.cr, base.cat, base.pri, r2(pick01(c.id, 0.6, 0.74, 'sur'))];
  else small = [base.cr, base.cat, base.pri, r2(Math.max(0.76, sconf - 0.04))];
  return { area: L.area || 'General', sentiment: L.sent || 'Neutral', fail, standard: std, small };
}

export function build() {
  const scored = CASES.map(c => ({ c, raw: rawMail(c) }));
  const probe = PROBES.map(c => ({ c, raw: rawMail(c) }));
  const example = EXAMPLES.map(c => ({ c, raw: rawMail(c) }));
  const emails = {
    schema: 'rbench-n8n-20281-emails/1',
    note: 'Synthetic. Provider-native trigger payloads (Gmail trigger item with simple=false, Microsoft Graph message). `date`/`receivedDateTime` is added by the task generator. No labels here.',
    scored: scored.map(({ c, raw }) => ({ caseId: c.id, provider: c.p === 'g' ? 'gmail' : 'outlook', ref: refOf(c.id), thread: c.thread ?? null, plain: c.body, mail: raw })),
    probes: probe.map(({ c, raw }) => ({ caseId: c.id, provider: c.p === 'g' ? 'gmail' : 'outlook', ref: refOf(c.id), thread: c.thread ?? null, plain: c.body, mail: raw })),
  };
  const examples = {
    schema: 'rbench-n8n-20281-example-mails/1',
    mails: example.map(({ c, raw }) => ({ caseId: c.id, provider: c.p === 'g' ? 'gmail' : 'outlook', ref: refOf(c.id), thread: c.thread ?? null, plain: c.body, mail: raw, labels: c.L })),
    seeds: EXAMPLE_SEEDS.map(s => seedRecord(s, example.map(e => e.c))),
  };
  const labels = {
    schema: 'rbench-n8n-20281-labels/1',
    note: 'HIDDEN truth. Written together with the mail text before any control or solver ran. Single annotator (see ANNOTATION.md).',
    scored: Object.fromEntries(CASES.map(c => [c.id, { ...c.L, ref: refOf(c.id), filtered: c.L.route === 'filtered', thread: c.thread ?? null }])),
    probes: Object.fromEntries(PROBES.map(c => [c.id, { ...c.L, ref: refOf(c.id), filtered: false, thread: c.thread ?? null }])),
  };
  const seed = {
    schema: 'rbench-n8n-20281-jira-seed/1',
    nextIssueNumber: NEXT_ISSUE_NUMBER,
    note: 'Tickets that exist before the stream. key = <project key>-<n>. `threadId` is the raw thread id of the mail thread the ticket belongs to (its label is derived with the author\'s convention).',
    tickets: SEEDS.map(s => seedRecord(s, CASES)),
  };
  const recordings = {
    schema: 'rbench-n8n-20281-model-recordings/1',
    note: 'Recorded answers of the mock classifier, keyed by the mail\'s reference token (the mock finds the token in the prompt). [isCustomerRequest, category, priority, confidence]. fail: permanent = every call fails, transient = the first call fails. Not evidence about any real model.',
    byRef: Object.fromEntries([...CASES, ...PROBES, ...EXAMPLES].filter(c => c.L.route !== 'filtered').map(c => [refOf(c.id), recordFor(c)])),
  };
  return { emails, labels, seed, recordings, examples };
}

function seedRecord(s, cases) {
  const owner = cases.find(c => (c.thread ?? c.id) === s.thread);
  const provider = owner ? owner.p : 'g';
  const threadId = owner ? threadIdOf(owner, s.thread) : hex16('thread:' + s.thread);
  return { id: s.id, n: s.n, category: s.cat, summary: s.summary, status: s.status, statusCategory: s.statusCategory, threadId, provider };
}

const FILES = { 'fixtures/emails.json': 'emails', 'fixtures/labels.json': 'labels', 'fixtures/jira-seed.json': 'seed', 'fixtures/model-recordings.json': 'recordings', 'fixtures/example-mails.json': 'examples' };
if (import.meta.url === `file://${process.argv[1]}`) {
  const built = build();
  let drift = 0;
  for (const [file, key] of Object.entries(FILES)) {
    const url = new URL('./' + file, import.meta.url);
    const text = JSON.stringify(built[key], null, 1) + '\n';
    if (process.argv.includes('--write')) { writeFileSync(url, text); console.log('wrote', file, text.length); }
    else { let old = ''; try { old = readFileSync(url, 'utf8'); } catch {} if (old !== text) { drift++; console.log('DIFFERS', file); } }
  }
  if (!process.argv.includes('--write')) console.log(drift ? `${drift} fixture file(s) differ from a rebuild` : 'fixtures equal a rebuild');
}
