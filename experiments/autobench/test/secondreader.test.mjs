// Tests for arm A0+SR, the second reader bolted onto A0 (experiments/autobench/harness/secondreader.mjs, run.mjs --harness
// secondreader). No model is called anywhere ($0): the reader and the sessions are scripted stand-ins
// (harness/secondreader-stubs.mjs). The end-to-end tests need the AutomationBench venv and skip without it.
//   node --test experiments/autobench/test/secondreader.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, VENV_PY, readJson } from '../lib.mjs';
import * as mainRunner from '../run.mjs';
import { loadSplit } from '../split.mjs';
import { ARM, HARNESS_ID, READER_SYSTEM, REVIEW_BEGIN, appsOfUrl, diffReads, hideCodeSteps, manifestFiles, maskClock, nodeModels, pipelineConfig, pipelineManifest, readMailboxFile,
  readReview, readerPrompt, reviewSection, sessionCalls } from '../harness/secondreader.mjs';
import { stubNodeRunner, stubSessionRunner, stubReview, sendEmail } from '../harness/secondreader-stubs.mjs';
import { cliVersion } from '../harness/foundry.mjs';

// The runner with the pipeline registry (PIPELINE_HARNESSES).
const { runTasks, DEFAULTS: RUN_DEFAULTS } = mainRunner;
const tmp = p => mkdtempSync(path.join(os.tmpdir(), `autobench-sr-${p}-`));
const HAVE_VENV = existsSync(VENV_PY);
const quiet = () => {};
const PHONE_TASK = 'simple.email_sf_contact_phone_update';
const rec = (ptr, data, date = null) => ({ ptr, app: ptr.split(':')[0], kind: ptr.split(':')[1], id: ptr.split(':').slice(2).join(':'), date, data });
const INV = { connected: ['gmail', 'salesforce', 'slack'], outOfScope: ['xero'], truncated: [], precedents: [],
  apps: { gmail: { status: 'connected', records: 2 }, salesforce: { status: 'connected', records: 1 }, slack: { status: 'connected', records: 0 }, xero: { status: 'not_connected', records: 0 } },
  records: [
    rec('gmail:message:m1', { from: 'boss@corp.example', subject: 'Routing policy', body_plain: 'Send the weekly summary to ops-team@corp.example with subject "Weekly Ops Digest".' }, '2026-03-01'),
    rec('gmail:message:m2', { from: 'jordan@corp.example', subject: 'New number', body_plain: 'My new direct line is +1-555-0101.' }, '2026-03-02'),
    rec('salesforce:Contact:003A', { Id: '003A', Name: 'Jordan Lee', Phone: '+1-555-0000' }),
  ] };
const REQUEST = 'Please send this week\'s ops summary as our routing policy says, and update Jordan\'s phone from the email.';

// ---------------------------------------------------------------------------------------------------------------
// Validation of the reader's reply

test('review validation: an item survives only with a quote found in the request or a record read before the work; cap; coverage of an empty list', () => {
  const r = readReview({ apps_checked: ['gmail', 'Salesforce'], unmet: [
    { requirement: 'send the digest', quote: 'weekly  ops digest', source: 'gmail:message:m1', status: 'missing', evidence: 'no new message', fix: 'email ops-team@corp.example' },
    { requirement: 'update the phone', quote: '+1-555-0101', source: 'salesforce:Contact:003A', status: 'wrong', evidence: '', fix: 'set Phone' }, // wrong pointer: found in m2
    { requirement: 'tell the CFO', quote: 'the CFO must always be copied', source: 'gmail:message:m1' },                           // invented rule
    { requirement: 'no quote' },
  ] }, { request: REQUEST, inv: INV, maxItems: 8 });
  assert.equal(r.parsed, true);
  assert.deepEqual(r.items.map(i => [i.id, i.quote, i.source, i.status]), [['U1', 'Weekly Ops Digest', 'gmail:message:m1', 'missing'], ['U2', '+1-555-0101', 'gmail:message:m2', 'wrong']]);
  assert.deepEqual(r.dropped.map(d => d.why), ['quote found in neither the request nor a record read before the work', 'no quote']);
  assert.deepEqual(r.uncovered, []);
  // The cap keeps the first items.
  assert.equal(readReview({ unmet: [1, 2, 3].map(() => ({ requirement: 'x', quote: 'routing policy', source: 'request' })) }, { request: REQUEST, inv: INV, maxItems: 2 }).items.length, 2);
  // An empty list that does not name every connected app holding records is recorded as uncovered.
  const e = readReview({ apps_checked: ['gmail'], unmet: [] }, { request: REQUEST, inv: INV });
  assert.deepEqual(e.uncovered, ['salesforce']);
  assert.equal(e.emptyWithoutCoverage, true);
  assert.equal(readReview({ apps_checked: ['gmail', 'salesforce'], unmet: [] }, { request: REQUEST, inv: INV }).emptyWithoutCoverage, false);
  // A reply that is not the expected object keeps nothing and is marked unparsed.
  assert.deepEqual(readReview(null, { request: REQUEST, inv: INV }).items, []);
  assert.equal(readReview({ verdict: 'done' }, { request: REQUEST, inv: INV }).parsed, false);
  // A quote from text the worker wrote (not in the pre-read records) does not count.
  assert.equal(readReview({ unmet: [{ requirement: 'x', quote: 'Here is the weekly summary', source: 'gmail:message:new1' }] }, { request: REQUEST, inv: INV }).items.length, 0);
});

test('masking and the diff: clock values written during the run become <now>; world dates stay; removals only for complete listings', () => {
  const lo = Date.parse('2026-10-15T11:00:00Z') / 1000, hi = Date.parse('2026-10-15T11:30:00Z') / 1000;
  assert.deepEqual(maskClock({ a: '2026-10-15T11:10:00Z', b: 1792062600000, c: '2026-03-20', d: '2026-10-15', e: 'text 2026-10-15', f: '1792062600', g: 42 }, lo, hi),
    { a: '<now>', b: '<now>', c: '2026-03-20', d: '2026-10-15', e: 'text 2026-10-15', f: '<now>', g: 42 });
  const before = { ...INV, truncated: ['gmail:message_list'] };
  const after = { apps: { salesforce: { status: 'connected' }, gmail: { status: 'connected' } }, truncated: [], records: [
    rec('gmail:message:m1', INV.records[0].data), rec('salesforce:Contact:003A', { Id: '003A', Name: 'Jordan Lee', Phone: '+1-555-0101' }),
    rec('gmail:message:new1', { to: ['ops-team@corp.example'], subject: 'Weekly Ops Digest', date: '2026-10-15T11:05:00Z' }),
  ] };
  const d = diffReads(before, after, { lo, hi });
  assert.equal(d.added, 1);
  assert.equal(d.changed, 1);
  assert.equal(d.removed, 0);                                                   // m2 is absent but gmail's listing was cut: not "removed"
  assert.match(d.text, /^\+ \[gmail:message:new1\] .*"date":"<now>"/m);
  assert.match(d.text, /^~ \[salesforce:Contact:003A\] Phone: "\+1-555-0000" -> "\+1-555-0101"$/m);
  // A clock value present in both reads (set when the world was loaded) is masked on both sides: no spurious change.
  const stamp = { ...INV, records: INV.records.map(r => ({ ...r, data: { ...r.data, created: '2026-10-15T11:01:00Z' } })) };
  const stampAfter = { ...after, records: after.records.map(r => (r.ptr === 'gmail:message:m1' ? { ...r, data: { ...r.data, created: '2026-10-15T11:01:00Z' } } : r)) };
  assert.equal(diffReads(stamp, stampAfter, { lo, hi }).changed, 1);
  const d2 = diffReads(INV, after, { lo, hi });
  assert.equal(d2.removed, 1);
  assert.match(d2.text, /^- \[gmail:message:m2\] removed/m);
  // A record found by a look-up, or of a kind the post-read no longer lists, is never reported removed.
  const withLookup = { ...INV, records: [...INV.records, rec('twitter:tweets:t1', { text: 'x', term: 'Jordan' }), rec('salesforce:Lead:00Q1', { Name: 'L' })] };
  assert.equal(diffReads(withLookup, { ...after, records: [...after.records, rec('twitter:me:me', { id: 'me' })] }, { lo, hi }).removed, 1);
});

test('mailbox: the session\'s calls and writes are read host-side without following links; code steps are hidden from the session', () => {
  const box = tmp('box');
  const call = (method, url, body = null) => ({ name: 'api_fetch', arguments: JSON.stringify({ method, url, params: null, body: body && JSON.stringify(body) }) });
  const put = (n, calls, results) => { writeFileSync(path.join(box, `req-${n}.claim`), ''); writeFileSync(path.join(box, `req-${n}.json`), JSON.stringify({ v: 1, calls })); if (results) writeFileSync(path.join(box, `res-${n}.json`), JSON.stringify(results)); };
  put(1, [call('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages')], { results: [{ name: 'api_fetch', content: '{"messages":[]}' }] });  // code
  put(2, [call('GET', 'https://www.googleapis.com/drive/v3/files'), sendEmail('ops-team@corp.example', 'Weekly Ops Digest', 'Body text')],
    { results: [{ name: 'api_fetch', content: '{"files":[]}' }, { name: 'api_fetch', content: '{"id":"s1","labelIds":["SENT"]}' }] });
  put(3, [call('PATCH', 'https://yourinstance.salesforce.com/services/data/v61.0/sobjects/Contact/003A', { Phone: 'x' })], { results: [{ name: 'api_fetch', content: '{"error":{"code":422,"message":"bad"}}' }] });
  put(4, [call('GET', 'https://slack.com/api/conversations.list')], { error: 'step limit' });
  const s = sessionCalls(box, { skip: new Set([1]) });
  assert.equal(s.steps, 2);
  assert.equal(s.refused, 1);
  assert.deepEqual(s.apps, ['gmail', 'google_drive', 'salesforce']);
  assert.deepEqual(s.writes.map(w => [w.method, w.status]), [['POST', 'ok'], ['PATCH', 422]]);
  assert.match(s.writes[0].body, /To: ops-team@corp.example/);                 // base64url raw decoded for the reader
  // Links and hard links are refused.
  writeFileSync(path.join(box, 'secret.json'), '{"results":[{"content":"host"}]}');
  symlinkSync(path.join(box, 'secret.json'), path.join(box, 'res-9.json'));
  linkSync(path.join(box, 'secret.json'), path.join(box, 'res-8.json'));
  assert.equal(readMailboxFile(path.join(box, 'res-9.json')), null);
  assert.equal(readMailboxFile(path.join(box, 'res-8.json')), null);
  assert.equal(readMailboxFile(path.join(box, 'res-2.json')).includes('labelIds'), true);
  // Hiding the code steps: request and answer gone, claim kept (the next client claims the next number).
  assert.equal(hideCodeSteps(box, new Set([1])), 1);
  const left = readdirSync(box);
  assert.ok(left.includes('req-1.claim') && !left.includes('req-1.json') && !left.includes('res-1.json'));
  // URL -> app keys follow the enumeration plan's own URLs.
  assert.deepEqual(appsOfUrl('https://www.googleapis.com/calendar/v3/calendars/primary/events'), ['google_calendar']);
  assert.deepEqual(appsOfUrl('https://sheets.googleapis.com/v4/spreadsheets/x'), ['google_sheets']);
  assert.deepEqual(appsOfUrl('not a url'), []);
});

test('reader prompt and review section: request verbatim, records, diff, writes, never-called apps; no grading vocabulary; the review appends after A0\'s prompt', () => {
  const p = readerPrompt({ request: REQUEST, recordsText: '[gmail:message:m1] {...}', changesText: '+ [gmail:message:n1] {...}', writes: '1. POST https://gmail... -> ok', neverCalled: ['google_sheets'], postRead: true, dateNote: 'DATE NOTE' });
  assert.ok(p.includes(`<request>\n${REQUEST}\n</request>`));
  assert.match(p, /<connected_apps_never_called>\ngoogle_sheets\n/);
  assert.match(p, /DATE NOTE/);
  assert.doesNotMatch(`${READER_SYSTEM}\n${p}`, /assertion|rubric|grade|partial.credit|task_completed|score/i);
  const s = reviewSection({ items: [{ requirement: 'send the digest', quote: 'Weekly Ops Digest', source: 'gmail:message:m1', status: 'missing', evidence: 'none', fix: 'email ops-team@corp.example' }], changesText: '+ x', stepsLeft: 30, responseCap: 20 });
  assert.ok(s.startsWith(REVIEW_BEGIN));
  assert.match(s, /must not be done again/);
  assert.match(s, /source gmail:message:m1: "Weekly Ops Digest"/);
  // The default scripted reader lists request addresses that no change shows.
  const st = stubReview(`<request>\nemail a@x.example and b@x.example\n</request>\n<records_before_the_work>\nConnected apps: gmail, slack\n</records_before_the_work>\n<changes>\n+ [gmail:message:n] {"to":["a@x.example"]}\n</changes>\n<write_calls>\n</write_calls>`);
  assert.deepEqual(st.unmet.map(u => u.quote), ['b@x.example']);
  assert.deepEqual(st.apps_checked, ['gmail', 'slack']);
});

test('config and isolation: roles act/reader/repair; manifest pins the files and settings; no module reads task files, grades or assertions', () => {
  assert.deepEqual(nodeModels('claude-haiku-5-5', { reader: 'claude-sonnet-5-5' }), { act: 'claude-haiku-5-5', reader: 'claude-sonnet-5-5', repair: 'claude-haiku-5-5' });
  assert.throws(() => nodeModels('m', { checker: 'x' }), /unknown node role/);
  const base = { model: 'claude-haiku-5-5', effort: 'high', budgetUsd: 0.75, timeoutMin: 20, maxSteps: 50, tools: ['Bash'], det: 'record', k: 1, concurrency: 4, cli: null, dateNote: true };
  const a = pipelineConfig(base);
  assert.equal(a.harness, HARNESS_ID);
  assert.equal(a.version, 'sr-v1');
  assert.notEqual(pipelineManifest(a).sha256, pipelineManifest(pipelineConfig({ ...base, nodeModels: { reader: 'claude-sonnet-5-5' } })).sha256);
  const files = manifestFiles();
  assert.ok(files.some(f => /^experiments\/autobench\/run(-sr-wip)?\.mjs$/.test(f)));            // the runner in use
  for (const f of ['experiments/autobench/harness/secondreader.mjs', 'experiments/autobench/harness/inventory.mjs', 'experiments/autobench/harness/codeowned.mjs',
    'experiments/autobench/accounting.mjs', 'experiments/autobench/bridge.py', 'experiments/autobench/tool.mjs']) assert.ok(files.includes(f), f);
  assert.ok(!files.includes('experiments/autobench/harness/secondreader-stubs.mjs'));
  const src = readFileSync(path.join(REPO, 'experiments/autobench/harness/secondreader.mjs'), 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(src, /assertion|rubric|grade\.json|world0|input\.json|meta\.json|prompt\.json|\bprep\b|SPLIT-v1|loadSplit|families|RECURRING-DESIGN|calls\.jsonl/i);
});

test('L1: no public task name in any file of the A0+SR manifest (or in its scripted stand-ins)', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 120_000 }, async () => {
  const { listTasks } = await import('../lib.mjs');
  const names = (await listTasks(['sales', 'marketing', 'operations', 'support', 'finance', 'hr', 'simple'], { liveDir: tmp('l1') })).map(t => t.task);
  assert.equal(names.length, 800);
  const files = [...manifestFiles(), 'experiments/autobench/harness/secondreader-stubs.mjs', 'experiments/autobench/roundtrip.mjs'];
  const hits = files.flatMap(f => { const text = readFileSync(path.join(REPO, f), 'utf8'); return names.filter(n => text.includes(n)).map(n => `${f}: ${n}`); });
  assert.deepEqual(hits, []);
});

// ---------------------------------------------------------------------------------------------------------------
// End to end through the real bridge (scripted reader and sessions; no model)

/** A scripted reader for the phone task, from its prompt only: the contact and the number in the email, unless the changes
 * already show the contact changed. */
function phoneReview(prompt) {
  const recs = prompt.split('\n').filter(l => l.startsWith('['));
  const contact = recs.find(l => /^\[salesforce:Contact:/.test(l) && /Jordan/.test(l))?.match(/^\[([^\]]+)\]/)[1];
  const mail = recs.find(l => /^\[gmail:message:/.test(l) && /Jordan|jordan/.test(l) && /phone|line/i.test(l));
  const mptr = mail?.match(/^\[([^\]]+)\]/)[1];
  const number = mail?.match(/(\+?\d[\d().-]{6,}\d)/)?.[1];
  const changes = prompt.split('<changes>')[1]?.split('</changes>')[0] ?? '';
  const connected = (/Connected apps: ([^\n]*)/.exec(prompt)?.[1] ?? '').split(',').map(s => s.trim());
  if (/~ \[salesforce:Contact:/.test(changes)) return { apps_checked: connected, unmet: [] };
  return { apps_checked: connected, unmet: contact && number ? [{ requirement: 'update the contact\'s phone from the email', quote: ` ${number} `, source: mptr, status: 'missing', evidence: 'no change to the contact', fix: `set Phone of ${contact} to ${number}` }] : [] };
}
const sfPatch = (ptr, value) => { const [, type, id] = ptr.split(':'); return { name: 'api_fetch', arguments: JSON.stringify({ method: 'PATCH', url: `https://yourinstance.salesforce.com/services/data/v61.0/sobjects/${type}/${id}`, params: null, body: JSON.stringify({ Phone: value }) }) }; };
const repairFromReview = text => { const m = /still needed: set Phone of (\S+) to (\S+)/.exec(text); return m ? [[sfPatch(m[1], m[2])]] : []; };

test('end to end (A0+SR, scripted): pre-read, A0 act, post-read, reader, one repair on a cited item; accounting on the sum; nothing grader-side reaches any node', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 600_000 }, async () => {
  const live = tmp('e2e'), seenNodes = [], seenSessions = [];
  const { summary, results } = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'secondreader', det: 'record', liveRoot: live, outDir: path.join(live, 'out'), log: quiet, dateNote: true,
    runner: stubSessionRunner({ seen: seenSessions, repair: repairFromReview }), nodeRunner: stubNodeRunner({ seen: seenNodes, replies: { reader: phoneReview } }) });
  const r = results[0], f = r.forks[0], p = f.pipeline;
  assert.equal(r.final.task_completed_correctly, 1, JSON.stringify(f.session?.violations));
  assert.deepEqual(f.session.nodes.map(n => n.name), ['pre-read', 'act', 'post-read', 'reader', 'repair']);
  assert.deepEqual(seenNodes.map(s => [s.node, s.tools.length, s.maxTurns]), [['reader', 0, 1]]);
  assert.equal(f.session.modelResponses, 2 + 1 + 2);                       // act (1 step + final text), reader, repair (1 step + final)
  assert.deepEqual(f.session.violations, []);
  assert.equal(f.steps, f.session.codeSteps + f.session.sessionSteps);     // every bridge step attributed to a node
  assert.equal(f.session.sessionSteps, 2);
  assert.equal(p.reader.items, 1);
  assert.equal(p.repair.ran, true);
  // The reader quoted the number with stray spaces; code kept the source's own text.
  const review = readJson(path.join(live, 'host', PHONE_TASK, 'fork-0', 'pipeline', 'review.json'));
  assert.equal(review.items[0].quote, review.items[0].quote.trim());
  assert.match(review.items[0].source, /^gmail:message:/);
  // The act session is A0's: official system prompt + A0's tool section, nothing appended; no guard; the workdir as A0's.
  const prep = path.join(live, 'prep', PHONE_TASK);
  const official = readJson(path.join(prep, 'prompt.json'));
  const act = seenSessions[0], repair = seenSessions[1];
  assert.ok(act.system.startsWith(`${official.system}\n\n## Tools in this environment`));
  assert.doesNotMatch(act.system, /Review \(begin\)|Work brief/);
  assert.equal(act.prompt, official.user);
  assert.equal(act.maxTurns, null);
  assert.equal(act.binary, null);
  assert.deepEqual(act.files, ['tool.mjs', 'tools.json']);
  // The repair session: A0's prompt + the review, the official user message again, REVIEW.md and RECORDS.md, a guard.
  assert.ok(repair.system.startsWith(act.system + '\n\n## Review (begin)'));
  assert.equal(repair.prompt, official.user);
  assert.deepEqual(repair.files, ['tool.mjs', 'tools.json', 'REVIEW.md', 'RECORDS.md']);
  assert.equal(repair.maxTurns, 50 - 3 - 1);
  assert.ok(repair.binary);
  // The reader saw the request, the pre-read records and the never-called apps, never the transcript or the final reply.
  assert.ok(seenNodes[0].prompt.includes(official.user));
  assert.doesNotMatch(seenNodes[0].prompt, /Done\.|tool_use|node tool\.mjs/);
  // No grader-side text reaches any node (as in the A1-C test).
  const info = JSON.parse(readJson(path.join(prep, 'input.json')).info);
  const served = readFileSync(path.join(live, 'host', PHONE_TASK, 'fork-0', 'calls.jsonl'), 'utf8');
  const inputs = [...seenNodes, ...seenSessions].map(s => `${s.system}\n${s.prompt}`).join('\n');
  for (const a of info.assertions) {
    assert.ok(!inputs.includes(a.type), `assertion type reachable: ${a.type}`);
    const vals = []; const walk = v => { if (typeof v === 'string' && v.length >= 6) vals.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    const { type, ...rest } = a; walk(rest);
    for (const v of vals) if (inputs.includes(v)) assert.ok(official.user.includes(v) || served.includes(v) || served.includes(JSON.stringify(v).slice(1, -1)), `value reached a node from outside the world: ${v}`);
  }
  assert.ok(!inputs.includes(PHONE_TASK));
  assert.equal(summary.arm, ARM);
  assert.equal(summary.harness.id, 'secondreader');
  const copied = readFileSync(path.join(live, 'out', 'results.jsonl'), 'utf8');
  assert.ok(!copied.includes('assertion_results') && !copied.includes('Jordan'));
});

test('end to end (A0+SR, scripted): work already done -> the post-read diff shows it and nothing is repaired; an uncited item never triggers a repair', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 600_000 }, async () => {
  // The act stand-in does the work itself (the contact and number of this simple task, as the repair test found them).
  const seenNodes = [];
  const a = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'secondreader', det: 'record', liveRoot: tmp('done'), outDir: null, log: quiet,
    runner: stubSessionRunner({ act: () => [[sfPatch('salesforce:Contact:003001', '+1-555-0101')]] }), nodeRunner: stubNodeRunner({ seen: seenNodes, replies: { reader: phoneReview } }) });
  const f = a.results[0].forks[0];
  assert.equal(a.results[0].final.task_completed_correctly, 1);
  assert.deepEqual(f.session.nodes.map(n => n.name), ['pre-read', 'act', 'post-read', 'reader']);
  assert.match(seenNodes[0].prompt, /~ \[salesforce:Contact:003001\] .*phone.*\+1-555-0000.* -> .*\+1-555-0101/i);
  assert.match(seenNodes[0].prompt, /1\. PATCH https:\/\/yourinstance\.salesforce\.com\/services\/data\/v61\.0\/sobjects\/Contact\/003001 .* -> ok/);
  assert.deepEqual(f.pipeline.repair, { ran: false, reason: 'no unmet item' });
  // A reader that invents a requirement (its quote is in no source) is ignored by code.
  const b = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'secondreader', det: 'record', liveRoot: tmp('uncited'), outDir: null, log: quiet,
    runner: stubSessionRunner(), nodeRunner: stubNodeRunner({ replies: { reader: () => ({ apps_checked: [], unmet: [{ requirement: 'email the CEO', quote: 'always copy the CEO on phone changes', source: 'request' }] }) } }) });
  const g = b.results[0].forks[0];
  assert.equal(g.pipeline.reader.items, 0);
  assert.equal(g.pipeline.reader.dropped, 1);
  assert.equal(g.pipeline.repair.reason, 'no unmet item');
  assert.equal(b.results[0].final.task_completed_correctly, 0);
});

test('end to end (A0+SR, scripted): the response budget is the sum over every call; no repair when it does not fit; an A0 session over the cap fails H3; an environment fault stops the task', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 600_000 }, async () => {
  // maxSteps 10: act uses 1 + 6 extra + final = 8 responses, the reader 1 -> 9; a repair would need >= 3 more.
  const a = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'secondreader', det: 'record', maxSteps: 10, liveRoot: tmp('budget'), outDir: null, log: quiet,
    runner: stubSessionRunner({ extraResponses: 6 }), nodeRunner: stubNodeRunner({ replies: { reader: phoneReview } }) });
  const f = a.results[0].forks[0];
  assert.equal(f.pipeline.reader.items, 1);
  assert.deepEqual(f.pipeline.repair, { ran: false, reason: 'response budget exhausted' });
  assert.equal(f.session.modelResponses, 9);
  assert.deepEqual(f.session.violations, []);
  // The act session is A0's (no guard): if it alone exceeds the cap, the reader is skipped and the task-run fails H3.
  const b = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'secondreader', det: 'record', maxSteps: 10, liveRoot: tmp('over'), outDir: null, log: quiet,
    runner: stubSessionRunner({ extraResponses: 12 }), nodeRunner: stubNodeRunner() });
  const rb = b.results[0];
  assert.equal(rb.forks[0].pipeline.skipped, 'no response left for the reader');
  assert.match(rb.headlineOverride, /H3 step cap: model responses \d+ > 10/);
  // ... and no world step follows the spent budget: the post-read (it serves only the reader) is skipped too.
  assert.equal(rb.forks[0].pipeline.postRead.done, false);
  assert.ok(!rb.forks[0].session.violations.some(v => /code-issued/.test(v)), rb.forks[0].session.violations.join('; '));
  // An environment fault in the reader, i.e. after the act session changed the world: no repair, and the task is NOT
  // rerun (a rerun would be a second attempt, drawn more often for unfinished-looking work): the world is graded as it
  // stands and the fault is recorded.
  const seen = [], live = tmp('fault');
  const c = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'secondreader', det: 'record', liveRoot: live, outDir: null, log: quiet,
    runner: stubSessionRunner({ seen }), nodeRunner: stubNodeRunner({ fault: 'MODEL_RATE_LIMIT' }) });
  assert.deepEqual(seen.map(s => s.node), ['act']);
  const nodes = readJson(path.join(live, 'host', PHONE_TASK, 'fork-0', 'pipeline', 'nodes.json'));
  assert.equal(nodes.find(n => n.error)?.error, 'MODEL_RATE_LIMIT');
  assert.equal(c.summary.stopped, undefined);
  assert.equal(c.results.length, 1);
  assert.equal(c.results[0].forks[0].sessionError, null);
  assert.equal(c.results[0].forks[0].pipeline.envFaultAfterAct, 'MODEL_RATE_LIMIT');
  assert.ok(c.results[0].final);
  // A fault in the act session itself (the A0 session) is not an outcome: the task is deferred (rerun on --resume), as for A0.
  const limited = async args => { const r = await stubSessionRunner()(args); return { ...r, ok: false, error: { code: 'MODEL_RATE_LIMIT' } }; };
  const d = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'secondreader', det: 'record', liveRoot: tmp('fault-act'), outDir: null, log: quiet,
    runner: limited, nodeRunner: stubNodeRunner() });
  assert.equal(d.results.length, 0);
  assert.match(String(d.summary.stopped), /MODEL_RATE_LIMIT/);
});

test('A0+SR\'s act call is A0\'s runner call: same model, prompts, workdir, budget, effort, tools, no guard (only the wall timeout keeps a reserve); A0+SR refuses test tasks', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 300_000 }, async () => {
  const capture = seen => async args => { seen.push({ ...args, box: readdirSync(path.join(args.workdir, '.tools')).sort(), dir: readdirSync(args.workdir).sort() }); return { ok: true, error: null, costUsd: 0, costUnknown: false, costUpperUsd: 0, turns: 0, durationMs: 1, toolUses: [], label: 'capture' }; };
  for (const dateNote of [false, true]) {
    const out = [];
    for (const harness of [null, 'secondreader']) {
      const live = tmp('ident'), seen = [];
      await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], det: 'record', model: 'claude-haiku-5-5', effort: 'high', liveRoot: live, outDir: null, log: quiet, runner: capture(seen), nodeRunner: stubNodeRunner(), harness, dateNote });
      out.push(JSON.parse(JSON.stringify(seen[0]).replaceAll(live, '<live>')));
    }
    const [a0, sr] = out;
    for (const k of ['model', 'prompt', 'systemPrompt', 'workdir', 'files', 'budgetUsd', 'effort', 'tools']) assert.deepEqual(sr[k], a0[k], k);
    for (const k of ['maxTurns', 'binary', 'keepRo']) assert.equal(sr[k], undefined, k);
    assert.ok(sr.timeoutMs < a0.timeoutMs && sr.timeoutMs >= a0.timeoutMs - 5 * 60_000);
    // The working directory at the session's start: A0's files; the mailbox holds only empty claim markers of the pre-read.
    assert.deepEqual(sr.dir, a0.dir);
    assert.deepEqual(a0.box, []);
    assert.ok(sr.box.length > 0 && sr.box.every(f => /^req-\d+\.claim$/.test(f)), sr.box.join(','));
  }
  const testTask = loadSplit().test[0]; // a name only: nothing of the task is opened
  const never = async () => { throw new Error('must not run'); };
  await assert.rejects(runTasks({ harness: 'secondreader', tasks: [testTask], runner: never, nodeRunner: never, liveRoot: tmp('guards'), outDir: null, log: quiet }), /not dev-split tasks/);
  await assert.rejects(runTasks({ harness: 'secondreader', tasks: [PHONE_TASK], k: 2, runner: never, nodeRunner: never, liveRoot: tmp('guards2'), outDir: null, log: quiet }), /forked rehearsal/);
  await assert.rejects(runTasks({ harness: 'secondreader', tasks: [PHONE_TASK], nodeModels: { checker: 'x' }, runner: never, nodeRunner: never, liveRoot: tmp('guards3'), outDir: null, log: quiet }), /unknown node role/);
  // AM-4: a scripted run is never exempt, even given the hash it recomputes (the hash check runs first, so /not dev-split/
  // also proves the hash matched; shown on an unknown name, so no test task could be touched).
  const hash = pipelineManifest(pipelineConfig({ ...RUN_DEFAULTS, cli: null })).sha256;
  await assert.rejects(runTasks({ harness: 'secondreader', tasks: ['sales.__not_a_task__'], harnessHash: hash, runner: never, nodeRunner: never, liveRoot: tmp('guards4'), outDir: null, log: quiet }), /not dev-split tasks/);
  // A0+SR is a dev-only probe (not a PREREG §3 arm): even a model run given the hash it recomputes is refused test tasks.
  const model = 'claude-haiku-5-5', cli = cliVersion();
  const modelHash = pipelineManifest(pipelineConfig({ ...RUN_DEFAULTS, model, cli })).sha256;
  await assert.rejects(runTasks({ harness: 'secondreader', model, capUsd: 1, tasks: ['sales.__not_a_task__'], harnessHash: modelHash, liveRoot: tmp('guards5'), outDir: null, log: quiet }), /not dev-split tasks/);
});
