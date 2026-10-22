// Tests of the A1-C v2 review fixes (reviews review:correctness, review:generic-only and review:tests of workflow
// wf_3674d3bc-0a7, orchestrator rulings d-j and the effect-table gap). $0, no model, no bridge: hand-built inventories,
// a stateful in-test mail world behind the real file mailbox, the real gated client, and the pipeline (runPipeline) with
// scripted model nodes and sessions. Each behavioural test fails on the code before the fixes (commit 5559247): modules
// are imported as namespaces so a missing export fails only the tests that use it.
//   nice -n 15 node --test --test-concurrency=1 experiments/autobench/test/codeowned-v2-review.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { REPO } from '../lib.mjs';
import * as V2 from '../harness/v2/codeowned.mjs';
import * as PC from '../harness/v2/postconditions.mjs';
import * as CK from '../harness/v2/checker.mjs';
import * as LG from '../harness/v2/ledger.mjs';
import * as TG from '../harness/v2/tool-gated.mjs';
import * as GT from '../harness/v2/gate.mjs';
import * as STUBS from '../harness/v2/codeowned-stubs.mjs';

const tmp = p => mkdtempSync(path.join(os.tmpdir(), `autobench-c2r-${p}-`));
const V2_DIR = path.join(REPO, 'experiments/autobench/harness/v2');
const SCHEMAS = path.join(REPO, 'corpus/AutomationBench/automationbench/tools/api/schemas');
const HAVE_SCHEMAS = existsSync(path.join(SCHEMAS, 'index.txt'));
const rec = (ptr, data) => ({ ptr, app: ptr.split(':')[0], kind: ptr.split(':')[1], id: ptr.split(':').slice(2).join(':'), data });
/** A read with per-app listing state (what buildInventory records): kinds listed (count of answered listings). */
const read = (apps, records = []) => ({ apps: Object.fromEntries(Object.entries(apps).map(([a, kinds]) => [a, { status: 'connected', kinds, records: 0 }])), records, connected: Object.keys(apps) });

// ---------------------------------------------------------------------------------------------------------------
// (d) Observability is decided from what the first read listed, never from the outcome

test('d1 a kind that was listed but empty is observable: a missing post, record or child FAILS (not null)', () => {
  const post = { id: 'P1', type: 'channel_posted', hard: true, params: { app: 'facebook_pages', channel: null, text: ['Quillfeather'], bodyNot: [] } };
  // Every kind the app's post operations create is listed (feed and photos; re-review 2026-10-21 minor 5, test rr11).
  const feedListed = read({ facebook_pages: { accounts: 1, feed: 1, photos: 1 } }, [rec('facebook_pages:accounts:pg1', { id: 'pg1', name: 'Orchid' })]);
  const e1 = PC.evaluate(post, feedListed, feedListed);
  assert.equal(e1.pass, false, JSON.stringify(e1));
  const card = { id: 'P2', type: 'record_created', hard: true, params: { app: 'trello', kind: 'cards', values: ['Dock repair'] } };
  const cardsListed = read({ trello: { boards: 1, lists: 1, cards: 1 } }, [rec('trello:boards:b1', { id: 'b1' })]);
  assert.equal(PC.evaluate(card, cardsListed, cardsListed).pass, false);
  const comment = { id: 'P3', type: 'child_created', hard: true, params: { parent: 'zendesk:tickets:7', kind: 'comments', values: ['Replace the hinge'] } };
  const tickets = read({ zendesk: { tickets: 1, users: 1, comments: 1 } }, [rec('zendesk:tickets:7', { id: 7 })]);
  assert.equal(PC.evaluate(comment, tickets, tickets).pass, false);
});

test('d2 a kind the first read never listed is unobservable (null), whatever the outcome; the re-read missing it is "not re-read"', () => {
  const post = { id: 'P1', type: 'channel_posted', hard: true, params: { app: 'facebook_pages', channel: null, text: ['Quillfeather'], bodyNot: [] } };
  const accountsOnly = read({ facebook_pages: { accounts: 1 } }, [rec('facebook_pages:accounts:pg1', { id: 'pg1' })]);
  const withPost = read({ facebook_pages: { accounts: 1 } }, [rec('facebook_pages:accounts:pg1', { id: 'pg1' }), rec('facebook_pages:feed:f9', { id: 'f9', message: 'Quillfeather' })]);
  for (const after of [accountsOnly, withPost]) { const e = PC.evaluate(post, accountsOnly, after); assert.equal(e.pass, null); assert.equal(e.unobservable, true); }
  // Listed before, not listed by the bounded re-read: null and marked not re-read (never a pass on missing evidence).
  const feedListed = read({ facebook_pages: { accounts: 1, feed: 1 } });
  const e2 = PC.evaluate(post, feedListed, accountsOnly);
  assert.equal(e2.pass, null);
  assert.equal(e2.notReread, true);
  // A recipient ban whose mailbox the re-read did not reach is not a pass.
  const ban = { id: 'P4', type: 'gmail_not_sent', hard: true, params: { to: ['ivo@orchid.example'] } };
  const mail = read({ gmail: { message_list: 1, draft_list: 1 } });
  const e3 = PC.evaluate(ban, mail, read({ gmail: {} }));
  assert.equal(e3.pass, null, JSON.stringify(e3));
  assert.equal(e3.notReread, true);
  // A record field whose record kind the re-read did not reach: not re-read (null), never "not found" (false).
  const field = { id: 'P5', type: 'record_field', hard: true, params: { ptr: 'salesforce:Contact:C01', field: 'Phone', value: '555-0142' } };
  const sf = read({ salesforce: { Contact: 1 } }, [rec('salesforce:Contact:C01', { Id: 'C01', Phone: '555-0100' })]);
  const e4 = PC.evaluate(field, sf, read({ salesforce: {} }));
  assert.equal(e4.pass, null);
  assert.equal(e4.notReread, true);
});

test('d3 child records tie to their parent by an exact field value; a listing that names no parent is unobservable (never a loose pass)', () => {
  const comment = { id: 'P3', type: 'child_created', hard: true, params: { parent: 'zendesk:tickets:7', kind: 'comments', values: ['Replace the hinge'] } };
  const before = read({ zendesk: { tickets: 1, comments: 1 } }, [rec('zendesk:tickets:7', { id: 7 }), rec('zendesk:tickets:77', { id: 77 }), rec('zendesk:comments:c1', { id: 'c1', ticket: 77, body: 'old' })]);
  const onOther = read({ zendesk: { tickets: 1, comments: 1 } }, [...before.records, rec('zendesk:comments:c2', { id: 'c2', ticket: 77, body: 'Replace the hinge (see 7)' })]);
  assert.equal(PC.evaluate(comment, before, onOther).pass, false);          // "7" inside text or another id is no tie
  const onThis = read({ zendesk: { tickets: 1, comments: 1 } }, [...before.records, rec('zendesk:comments:c3', { id: 'c3', ticket: 7, body: 'Replace the hinge' })]);
  assert.equal(PC.evaluate(comment, before, onThis).pass, true);
  // Events listed per calendar carry no calendar id: a new event cannot be tied to the parent calendar.
  const ev = { id: 'P9', type: 'child_created', hard: true, params: { parent: 'google_calendar:calendar_list:team', kind: 'event_list', values: ['Dock inspection'] } };
  const cal = read({ google_calendar: { calendar_list: 1, event_list: 2 } }, [rec('google_calendar:calendar_list:team', { id: 'team' }), rec('google_calendar:event_list:e1', { id: 'e1', summary: 'Standup' })]);
  const added = read({ google_calendar: { calendar_list: 1, event_list: 2 } }, [...cal.records, rec('google_calendar:event_list:e2', { id: 'e2', summary: 'Dock inspection' })]);
  const e = PC.evaluate(ev, cal, added);
  assert.equal(e.pass, null);
  assert.equal(e.unobservable, true);
});

test('d4 the check round never sends a not-re-read check to the checker; the termination names undecided hard checks', async () => {
  const pcs = [{ id: 'P1', item: 'M1', type: 'record_created', hard: true, app: 'trello', params: { app: 'trello', kind: 'cards', values: ['Dock repair'] }, statement: 's', source: 'request' }];
  const inv = read({ trello: { boards: 1, cards: 1 } }, [rec('trello:boards:b1', { id: 'b1' })]);
  let judged = 0;
  // The re-read answers nothing (a refused step): trello cards are not re-read.
  const client = { batch: async () => ({ error: 'refused' }), log: [] };
  const chk = await CK.runChecks({ client, inv, pcs, judge: async () => { judged += 1; return null; } });
  assert.equal(judged, 0);
  assert.equal(chk.results[0].pass, null);
  assert.equal(chk.results[0].notReread, true);
  assert.equal(chk.results[0].by, 'code (not re-read)');
  const base = { responsesUsed: 20, maxResponses: 50, stepsUsed: 10, maxWorldSteps: 49, round: 0, maxRounds: 0, usdLeft: 0.5, msLeft: 600_000 };
  const res = (hard, pass) => ({ pc: { hard }, pass });
  const d1 = CK.terminationDecision({ ...base, results: [res(true, true), res(true, null)] });
  assert.equal(d1.reason, 'all decided checks pass; 1 hard check(s) undecided');
  assert.equal(d1.category, 'hard-undecided');
  assert.equal(CK.terminationDecision({ ...base, results: [] }).reason, 'no checks');
  assert.equal(CK.terminationDecision({ ...base, results: [res(true, false), res(true, null)] }).reason, 'single pass (repairs off): 1 hard check(s) fail; 1 hard check(s) undecided');
  assert.equal(CK.terminationDecision({ ...base, results: [res(true, true)] }).category, 'all-pass');
});

test('d5 B4 counts an undecided hard check on a failing assertion as a hidden false accept', async () => {
  const { classify, totals } = await import('../replay/replay-gate.mjs');
  const A = [{ type: 'gmail_message_sent_to_with_body_contains', params: { to: 'finance-lead@orchid.example', body_contains: ['Quillfeather'] }, passed: false }];
  const sent = { type: 'gmail_sent', params: { to: ['finance-lead@orchid.example'], cc: [], subject: [], body: ['Quillfeather Supply'] } };
  assert.equal(classify(sent, null, A).cls, 'undecided-failing');
  const row = { graderPass: false, v1: { checks: 0, hard: 0, rejects: false }, v2: { checks: 2, hard: 2, FRaligned: 0, FRunaligned: 0, FA: 1, TA: 0, TR: 0, neutral: 0, nullHard: 1, nullHardFailing: 1, rejects: false, clauseOrSlotShown: 0, wrongApp: 0 }, today: { changed: false } };
  const T = totals([row]);
  assert.equal(T.v2.honestHardFalseAccepts, 2);
  assert.equal(T.v2.failingWorldsUndecided, 1);
  assert.equal(T.v2.failingWorldsAcceptedClean, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// (e) Batches: a refused call holds the whole batch; the identical resend sends every call once

const b64url = s => Buffer.from(s, 'utf8').toString('base64url');
const sendMail = (to, body) => ({ name: 'api_fetch', arguments: JSON.stringify({ method: 'POST', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', params: null, body: JSON.stringify({ raw: b64url(`To: ${to}\r\nSubject: Summary\r\n\r\n${body}`) }) }) });
const getList = { name: 'api_fetch', arguments: JSON.stringify({ method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages', params: null, body: null }) };
const GATE_PCS = [{ id: 'P1', item: 'M1', type: 'gmail_sent', hard: true, params: { to: ['finance-lead@orchid.example'], cc: [], subject: [], body: [], bodyNot: ['Brackenridge Tools'] } }];
const GATE_MERGED = { items: [{ id: 'M1', exclusions: [{ literal: 'Brackenridge Tools', rule: { source: 'gmail:message:g1', quote: 'Vendors on hold are left out of every summary' } }] }] };
const CFG = GT.gateConfig(GATE_PCS, { merged: GATE_MERGED, perPair: 1, perSession: 2 });

test('e1 decide: a batch with a refused call is held whole; its identical resend sends every call; a call repeated inside one batch is not its own resend', () => {
  const bad = sendMail('finance-lead@orchid.example', 'Brackenridge Tools 980'), ok = sendMail('ops@orchid.example', 'Quillfeather');
  const log = [];
  const note = ds => { for (const x of ds) if (x.action === 'refuse') log.push({ kind: 'refused', rule: x.violation.rule.pid, recipient: x.violation.recipient, hash: x.hash }); return ds.map(x => x.action); };
  assert.deepEqual(note(TG.decide([getList, bad, ok], CFG, log)), ['held', 'refuse', 'held']);
  assert.deepEqual(note(TG.decide([getList, bad, ok], CFG, log)), ['send', 'resend', 'send']);
  assert.deepEqual(TG.decide([bad, bad], CFG, []).map(x => x.action), ['refuse', 'held']);
  const l2 = [{ kind: 'refused', rule: 'P1', recipient: 'finance-lead@orchid.example', hash: TG.callHash(bad) }];
  assert.deepEqual(TG.decide([bad, bad], CFG, l2).map(x => x.action), ['resend', 'resend']);
  assert.match(TG.refusalText(TG.decide([getList, bad], CFG, [])[1], bad, { batch: true }), /No call of this batch was sent\. .*run the identical command again \(do not send its other calls on their own first\): every call will be sent once/);
});

/** The bridge's role for the real client: answers req-N.json files; counts every call it served. */
function responder(box, answer = (c, n, i) => `ok ${n}.${i + 1} ${c.name}`) {
  let stop = false;
  const seen = new Set(), served = [];
  (async () => {
    while (!stop) {
      let files = [];
      try { files = readdirSync(box); } catch { /* not yet */ }
      for (const f of files) {
        const m = /^req-(\d+)\.json$/.exec(f);
        if (!m || seen.has(f)) continue;
        seen.add(f);
        const req = JSON.parse(readFileSync(path.join(box, f), 'utf8'));
        served.push(...req.calls);
        writeFileSync(path.join(box, `res-${m[1]}.json.tmp`), JSON.stringify({ results: req.calls.map((c, i) => ({ name: c.name, content: answer(c, m[1], i) })) }));
        writeFileSync(path.join(box, `res-${m[1]}.json`), readFileSync(path.join(box, `res-${m[1]}.json.tmp`)));
      }
      await new Promise(r => setTimeout(r, 15));
    }
  })();
  return { stop: () => { stop = true; }, served };
}
const runClient = (dir, args, env = {}) => new Promise(res => {
  const c = spawn(process.execPath, ['tool.mjs', ...args], { cwd: dir, env: { PATH: process.env.PATH, AUTOBENCH_TOOL_WAIT_MS: '4000', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let o = '', e = '';
  c.stdout.on('data', x => { o += x; }); c.stderr.on('data', x => { e += x; });
  c.on('close', code => res({ code, stdout: o, stderr: e }));
});

test('e2 the gated client: a mixed batch is refused whole (exit 1, no request); the identical resend sends each call exactly once', { timeout: 60_000 }, async () => {
  const wd = tmp('gated');
  mkdirSync(path.join(wd, '.tools'));
  copyFileSync(path.join(V2_DIR, 'tool-gated.mjs'), path.join(wd, 'tool.mjs'));
  const gdir = tmp('gate');
  GT.writeGate(gdir, CFG);
  GT.writeGate(gdir, CFG);                                                      // a leftover read-only gate.json is replaced
  const resp = responder(path.join(wd, '.tools'));
  try {
    const batch = JSON.stringify([getList, sendMail('finance-lead@orchid.example', 'Brackenridge Tools 980'), sendMail('ops@orchid.example', 'Quillfeather')]);
    const r1 = await runClient(wd, ['batch', batch], { [GT.GATE_ENV]: gdir });
    assert.equal(r1.code, 1);
    assert.equal(r1.stdout, '');
    assert.match(r1.stderr, /No call of this batch was sent/);
    assert.equal(readdirSync(path.join(wd, '.tools')).filter(f => /^req-\d+\.json$/.test(f)).length, 0);
    const r2 = await runClient(wd, ['batch', batch], { [GT.GATE_ENV]: gdir });
    assert.equal(r2.code, 0, r2.stderr);
    assert.match(r2.stdout, /^### result 1: api_fetch\nok (\d+)\.1 api_fetch\n### result 2: api_fetch\nok \1\.2 api_fetch\n### result 3: api_fetch\nok \1\.3 api_fetch\n$/);
    await new Promise(r => setTimeout(r, 100));
    assert.equal(resp.served.length, 3);                                         // no call went out twice
    const lines = GT.readGateLog(path.join(wd, '.tools', GT.GATE_LOG)).lines;
    // The two held calls the resend sent are logged as sent (re-review B minor 8): an identical third batch would be refused.
    assert.deepEqual(lines.map(l => l.kind), ['loaded', 'held', 'refused', 'held', 'loaded', 'resent', 'sent', 'sent']);
    assert.deepEqual(GT.gateSummary(lines), { loaded: 2, refused: 1, held: 2, resentIdentical: 1, capped: 0, duplicatesRefused: 0, heldThenSent: 2 });
  } finally { resp.stop(); }
});

// ---------------------------------------------------------------------------------------------------------------
// (f) Completeness literals: asked for in the item's own source only, hard only, never another recipient's record

const INV = { connected: ['gmail', 'salesforce'], outOfScope: [], truncated: [], precedents: [], records: [
  rec('gmail:message:g1', { from: 'controller@orchid.example', subject: 'Buyer report rule', body_plain: 'Each buyer report names every active buyer.' }),
  rec('salesforce:Contact:C01', { Id: 'C01', Name: 'Tamsin Oakes', Email: 'tamsin.oakes@orchid.example', Status: 'Active' }),
  rec('salesforce:Contact:C02', { Id: 'C02', Name: 'Ivo Marchetti', Email: 'ivo.marchetti@orchid.example', Status: 'Active' }),
  rec('salesforce:Account:A01', { Id: 'A01', Name: 'Quillfeather Supply', Status: 'Active' }),
] };
const REQ = 'Send Tamsin Oakes (tamsin.oakes@orchid.example) her buyer report. List each active account in it.';
const SRC = LG.sourceMap(REQ, INV, { system: 'You automate office work.' });
const item = (asked, extra = {}) => ({ id: 'R1', polarity: 'positive', action: 'send_email', app: 'gmail', target: 'tamsin.oakes@orchid.example', statement: 'send the buyer report', source: 'request',
  fields: [{ name: 'to', quote: 'tamsin.oakes@orchid.example', source: 'request', ...(asked ? { asked_by: asked } : {}) }, { name: 'subject', quote: 'buyer report', source: 'request' }],
  candidates: [{ record: 'salesforce:Contact:C01', eligible: true, deciding_field: 'Status', value: 'Active', rule_source: 'request' }, { record: 'salesforce:Contact:C02', eligible: true, deciding_field: 'Status', value: 'Active', rule_source: 'request' },
    { record: 'salesforce:Account:A01', eligible: true, deciding_field: 'Status', value: 'Active', rule_source: 'request' }], ...extra });
const compile = reqs => { const m = LG.mergeLedgers([1, 2, 3].map(k => LG.normalizeLedger({ requirements: reqs }, SRC, { reader: k })), { sources: SRC }); LG.typeLedger(m, SRC, INV, V2.PIPELINE_DEFAULTS); return { m, pcs: PC.postconditionsFromLedger(m, INV, { sources: SRC, P: V2.PIPELINE_DEFAULTS }) }; };

test('f1 completeness: never another recipient\'s record; only when the item\'s own source asks; never as "may mention"', () => {
  // Asked in the item's own source (the request): the account and the recipient's own record may be named; the other
  // buyer (a record with another person's address) never is.
  let { m, pcs } = compile([item({ quote: 'List each active account in it', source: 'request' })]);
  const body = pcs.find(p => p.type === 'gmail_sent').params.body;
  assert.ok(body.includes('Quillfeather Supply'), JSON.stringify(body));
  assert.ok(!body.includes('Ivo Marchetti'));
  assert.ok(!JSON.stringify(m.items[0].fields).includes('Ivo Marchetti'));
  // Asked only by ANOTHER source (the policy e-mail), not the item's own: nothing is added.
  ({ m, pcs } = compile([item({ quote: 'Each buyer report names every active buyer', source: 'gmail:message:g1' })]));
  assert.ok(!m.items[0].fields.some(f => f.completeness), JSON.stringify(m.items[0].fields));
  // Not asked: nothing is added and nothing is shown as "may mention".
  ({ m, pcs } = compile([item(null)]));
  assert.ok(!m.items[0].fields.some(f => f.completeness));
  assert.doesNotMatch(LG.renderLedger(m), /Quillfeather Supply|Ivo Marchetti/);
});

test('f2 a deciding value the item\'s own source asks for stays in the message (not demoted)', () => {
  const it = item(null, { fields: [{ name: 'to', quote: 'tamsin.oakes@orchid.example', source: 'request' }, { name: 'body', quote: 'Active', source: 'salesforce:Account:A01', asked_by: { quote: 'List each active account in it', source: 'request' } }] });
  const { m } = compile([it]);
  const f = m.items[0].fields.find(x => x.name === 'body' && x.value === 'Active');
  assert.ok(f && !f.demoted && f.hardLit, JSON.stringify(f));
});

// ---------------------------------------------------------------------------------------------------------------
// (h) Degraded readers: majority over the readers that answered

test('h1 one reader of three answered: its items are MUST with hard checks, and the brief says how many answered', () => {
  const ok = LG.normalizeLedger({ requirements: [item(null)] }, SRC, { reader: 1 });
  const dead = k => LG.normalizeLedger(null, SRC, { reader: k });
  const m = LG.mergeLedgers([ok, dead(2), dead(3)], { sources: SRC });
  LG.typeLedger(m, SRC, INV, V2.PIPELINE_DEFAULTS);
  const pcs = PC.postconditionsFromLedger(m, INV, { sources: SRC, P: V2.PIPELINE_DEFAULTS });
  assert.ok(pcs.some(p => p.hard && p.type === 'gmail_sent'), JSON.stringify(pcs));
  assert.match(LG.renderLedger(m), /\[MUST; send_email in gmail; found by 1\/1 readers/);
  const b = CK.briefSection({ inv: INV, merged: m, pcs: pcs.map((p, i) => ({ ...p, id: `P${i + 1}` })), stepsLeft: 40, responseCap: 30, inventoryText: '(records)' });
  assert.match(b, /three independent readers were asked for the request's requirements and one gave a usable answer/);
  assert.equal(LG.majorityOf(m), 1);
  // Every reader answered: v1's 2 of 3.
  const all = LG.mergeLedgers([1, 2, 3].map(k => LG.normalizeLedger({ requirements: [item(null)] }, SRC, { reader: k })), { sources: SRC });
  assert.equal(LG.majorityOf(all), 2);
});

// ---------------------------------------------------------------------------------------------------------------
// The pipeline with scripted nodes and sessions against an in-test mail world (re-ask, degraded readers, mapping
// replies, the lint's activity and batches)

/** A tiny stateful Gmail world answering the file mailbox; every other app is not connected. */
function mailWorld() {
  const msgs = [{ id: 'g1', from: 'controller@orchid.example', to: ['ops@orchid.example'], subject: 'Vendor rule', body_plain: 'Vendors on hold are left out of every summary.', date: 1770109200000 }];
  let n = 0;
  const answer = c => {
    let a = {};
    try { a = JSON.parse(c.arguments); } catch { /* bad */ }
    const u = new URL(String(a.url ?? 'http://x/'));
    if (u.host.endsWith('googleapis.com') && u.pathname.includes('/gmail/v1/users/me/')) {
      if (a.method === 'GET' && /\/messages$/.test(u.pathname)) return { messages: msgs.map(m => ({ id: m.id })) };
      if (a.method === 'GET' && /\/drafts$/.test(u.pathname)) return { drafts: [] };
      const id = /\/messages\/([^/]+)$/.exec(u.pathname)?.[1];
      if (a.method === 'GET' && id) return msgs.find(m => m.id === id) ?? { error: { code: 404, message: 'not found' } };
      if (a.method === 'POST' && /\/messages\/send$/.test(u.pathname)) {
        const raw = Buffer.from(JSON.parse(a.body).raw, 'base64url').toString('utf8');
        const k = raw.search(/\r?\n\r?\n/);
        const to = (/^To:\s*(.*)$/mi.exec(raw.slice(0, k))?.[1] ?? '').split(',').map(s => s.trim()).filter(Boolean);
        const m = { id: `s${++n}`, to, subject: /^Subject:\s*(.*)$/mi.exec(raw.slice(0, k))?.[1] ?? '', body_plain: raw.slice(k).trim(), date: Date.now() };
        msgs.push(m);
        return { id: m.id };
      }
    }
    return { error: { code: 401, message: 'No account is connected for this app' } };
  };
  return { msgs, answer: c => JSON.stringify(answer(c)) };
}

const REQUEST = 'Email the vendor update to ops@orchid.example and to buyers@orchid.example: the quarter totals are final. Leave out Brackenridge Tools.';
const SYSTEM = 'You automate office work.';
/** A reader's reply: two e-mail items (values copied from the request) and, with `limit`, a content rule on the first. */
const ledgerReply = ({ limit = false, value = 'quarter totals are final' } = {}) => ({ today: null, conflicts: [], requirements: [
  { id: 'R1', polarity: 'positive', action: 'send_email', app: 'gmail', target: 'ops@orchid.example', statement: 'email the vendor update to ops', source: 'request', fields: [{ name: 'to', quote: 'ops@orchid.example', source: 'request' }, { name: 'body', quote: value, source: 'request' }] },
  { id: 'R2', polarity: 'positive', action: 'send_email', app: 'gmail', target: 'buyers@orchid.example', statement: 'email the vendor update to buyers', source: 'request', fields: [{ name: 'to', quote: 'buyers@orchid.example', source: 'request' }, { name: 'body', quote: value, source: 'request' }] },
  ...(limit ? [{ id: 'N1', polarity: 'negative', scope: 'content', limits: 'R1', action: 'send_email', app: 'gmail', target: 'ops@orchid.example', statement: 'leave Brackenridge Tools out', source: 'request', rule_quote: 'Leave out Brackenridge Tools', rule_source: 'request', leave_out: [{ quote: 'Brackenridge Tools', source: 'request' }] }] : []),
] });
const nodeName = args => path.basename(args.workdir).replace(/^\d+-/, '');

async function fakeRun({ ledger, pcmap = null, runner = null, pipeline = {}, nodeWrap = null }) {
  const root = tmp('pipe');
  const dirs = Object.fromEntries(['w', 'nodes', 'host', 'guard'].map(d => [d, path.join(root, d)]));
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  mkdirSync(path.join(dirs.w, '.tools'));
  copyFileSync(path.join(REPO, 'experiments/autobench/tool.mjs'), path.join(dirs.w, 'tool.mjs'));
  writeFileSync(path.join(dirs.w, 'tools.json'), '[]');
  const world = mailWorld();
  const resp = responder(path.join(dirs.w, '.tools'), c => world.answer(c));
  const sessions = [];
  let nodeRunner = STUBS.stubNodeRunner({ replies: { ledger, ...(pcmap ? { pcmap } : {}) } });
  if (nodeWrap) nodeRunner = nodeWrap(nodeRunner);
  try {
    const r = await V2.runPipeline({ official: { system: SYSTEM, user: REQUEST }, catalog: [], workdir: dirs.w, nodeRoot: dirs.nodes, hostDir: dirs.host, guardDir: dirs.guard, maxSteps: 50, budgetUsd: 0.75, timeoutMs: 20 * 60_000, dateNote: true,
      models: V2.nodeModels('stub-model'), tools: ['Bash'], runner: runner ?? STUBS.stubSessionRunner({ seen: sessions }), nodeRunner, cliTarget: 'claude', scripted: true, pipeline, log: () => {} });
    const act = readdirSync(path.join(dirs.host, 'pipeline')).find(f => /-act\.system\.txt$/.test(f));
    return { r, p: r.pipeline, world, served: resp.served, brief: act ? readFileSync(path.join(dirs.host, 'pipeline', act), 'utf8') : '', host: dirs.host, sessions };
  } finally { resp.stop(); }
}
const timeoutFor = names => run => async args => (names.includes(nodeName(args)) ? { ok: false, error: { code: 'EXECUTOR_TIMEOUT' }, result: null, costUsd: 0, costUnknown: false, costUpperUsd: 0, turns: 1, toolUses: [] } : run(args));

test('h2 the re-ask fails: the one answering reader still yields hard checks and the brief says so', { timeout: 120_000 }, async () => {
  const replies = { 'ledger-1': 'no json', 'ledger-2': 'still no json', 'ledger-1b': 'no json again' };
  const { p, brief } = await fakeRun({ ledger: (prompt, args) => replies[nodeName(args)] ?? ledgerReply() });
  assert.deepEqual(p.ledger.reasked, { reader: 1, parsed: false });
  assert.equal(p.ledger.readersOk, 1, JSON.stringify({ ledger: p.ledger, nodes: p.nodes.map(n => `${n.name}:${n.parsed}`) }));
  assert.equal(p.ledger.supportNeeded, 1);
  assert.ok(p.ledger.hardChecks >= 2, JSON.stringify(p.ledger));
  assert.match(brief, /one gave a usable answer/);
  assert.ok(p.nodes.some(n => n.name === 'ledger-1b'));
});

test('h3 all three readers fail (parallel): one re-ask, no requirements, and the stop says "no checks" (never "all checks pass")', { timeout: 120_000 }, async () => {
  const { p, brief } = await fakeRun({ ledger: () => 'nothing to parse here' });
  assert.equal(p.ledger.reasked.parsed, false);
  assert.equal(p.nodes.filter(n => /^ledger-\d+b$/.test(n.name)).length, 1);
  assert.equal(p.ledger.readersOk, 0);
  assert.equal(p.termination.reason, 'no checks');
  assert.equal(p.termination.category, 'no-checks');
  assert.match(brief, /none gave a usable answer/);
});

test('h4 timeouts are not re-asked (they would time out again); the readers that answered decide', { timeout: 120_000 }, async () => {
  const { p } = await fakeRun({ ledger: () => ledgerReply(), nodeWrap: timeoutFor(['ledger-1', 'ledger-2']) });
  assert.ok(!p.nodes.some(n => /^ledger-\d+b$/.test(n.name)), JSON.stringify(p.nodes.map(n => n.name)));
  assert.match(p.ledger.reasked.skipped, /no failed reader completed/);
  assert.equal(p.ledger.readersOk, 1);
  assert.ok(p.ledger.hardChecks >= 2);
});

test('j1 a scripted mapping reply whose only value is a minority value gives an advisory check; a majority value a hard one', { timeout: 120_000 }, async () => {
  // A requirement code cannot compile (action "other" on a sheet), so the mapping call maps it; only reader 1 wrote "final".
  const sheetItem = k => ({ id: 'R3', polarity: 'positive', action: 'other', app: 'google_sheets', target: 'the totals sheet', statement: 'log the quarter totals', source: 'request', fields: k === 1 || k === 'all' ? [{ name: 'status', quote: 'final', source: 'request' }] : [] });
  const reader = mode => (prompt, args) => { const k = Number(nodeName(args).split('-')[1]); const r = ledgerReply(); r.requirements.push(sheetItem(mode === 'all' ? 'all' : k)); return r; };
  const pcmap = prompt => ({ checks: [...prompt.matchAll(/^- (M\d+): log the quarter totals/gm)].map(m => ({ requirement: m[1], type: 'sheet_row', params: { spreadsheetId: null, values: ['final'] } })) });
  const minority = await fakeRun({ ledger: reader('one'), pcmap });
  const pcsMinority = JSON.parse(readFileSync(path.join(minority.host, 'pipeline', 'postconditions.json'), 'utf8')).pcs;
  const mapped = pcsMinority.find(p => p.type === 'sheet_row');
  assert.ok(mapped, JSON.stringify(pcsMinority.map(p => p.type)));
  assert.deepEqual(mapped.params.values, []);
  assert.equal(mapped.hard, false);
  assert.ok(mapped.soft.some(s => s.value === 'final'));
  assert.equal(minority.p.ledger.mappedChecks, 1);
  const majority = await fakeRun({ ledger: reader('all'), pcmap });
  const m2 = JSON.parse(readFileSync(path.join(majority.host, 'pipeline', 'postconditions.json'), 'utf8')).pcs.find(p => p.type === 'sheet_row');
  assert.deepEqual(m2.params.values, ['final']);
  assert.equal(m2.hard, true);
});

test('i1 the lint: installed only with a rule; "loaded" lines make it active; a session whose client never loaded it reports active:false', { timeout: 180_000 }, async () => {
  // No content rule: nothing to lint, no gate installed (the plain client runs).
  const none = await fakeRun({ ledger: () => ledgerReply(), pipeline: { preSendLint: true } });
  assert.equal(none.p.gate.installed, false);
  // A rule: installed, every client invocation logs "loaded", the gate row names the installed client.
  const on = await fakeRun({ ledger: () => ledgerReply({ limit: true }), pipeline: { preSendLint: true } });
  assert.equal(on.p.gate.installed, true);
  assert.equal(on.p.gate.active, true, JSON.stringify(on.p.gate));
  assert.ok(on.p.gate.loaded >= 1);
  assert.equal(on.p.gate.client.sha256, createHash('sha256').update(readFileSync(path.join(V2_DIR, 'tool-gated.mjs'))).digest('hex'));
  // The configuration does not reach the client (the variable is dropped): the session still reached the world.
  const dropEnv = STUBS.stubSessionRunner();
  const off = await fakeRun({ ledger: () => ledgerReply({ limit: true }), pipeline: { preSendLint: true }, runner: args => dropEnv({ ...args, env: {} }) });
  assert.equal(off.p.gate.installed, true);
  assert.ok(off.p.gate.worldSteps > 0);
  assert.equal(off.p.gate.active, false, JSON.stringify(off.p.gate));
});

test('e3 end to end: a refused batch holds every call; the identical resend sends each message exactly once (no duplicate to the other recipient)', { timeout: 180_000 }, async () => {
  const { p, world } = await fakeRun({ ledger: () => ledgerReply({ limit: true }), pipeline: { preSendLint: true }, runner: STUBS.stubSessionRunner({ appendLeftOut: true, resendOnGate: true }) });
  assert.equal(p.gate.refused, 1, JSON.stringify(p.gate));
  assert.equal(p.gate.resentIdentical, 1);
  const sent = world.msgs.filter(m => m.id.startsWith('s'));
  assert.equal(sent.filter(m => m.to.includes('buyers@orchid.example')).length, 1, JSON.stringify(sent.map(m => m.to)));
  assert.equal(sent.filter(m => m.to.includes('ops@orchid.example')).length, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// (g) The P0 replay tool: waiting ledger, fixed denominator, faults apart, resume, index-named node folders

const replayRec = task => ({ task, prompt: { system: SYSTEM, user: REQUEST }, grade: { assertion_results: [] }, v1: { postconditions: { pcs: [] }, ledgers: null } });
const replayInv = () => ({ records: [rec('gmail:message:g1', { from: 'controller@orchid.example', subject: 'Vendor rule', body_plain: 'Vendors on hold are left out of every summary.' })], connected: ['gmail'], outOfScope: [], truncated: [], precedents: [], clock: null });
const TASKS = Array.from({ length: 60 }, (_, i) => `${['sales', 'marketing', 'operations', 'support', 'finance', 'hr'][i % 6]}.case_${i}`);

test('g1 simulated cost: 60 tasks at $0.075 reserved per call under a $1.5 cap all complete (calls wait instead of failing); the denominator is 180', { timeout: 120_000 }, async () => {
  const LR = await import('../replay/ledger-replay.mjs');
  const reply = system => (system === LG.LEDGER_SYSTEM ? `\`\`\`json\n${JSON.stringify(ledgerReply())}\n\`\`\`` : '{"checks": [], "decisions": []}');
  // Deterministic waits (re-review 2026-10-21, minor 2: the first version's waits depended on timing): count the calls a
  // replay makes, then price each so the run spends $1.38 in all. When the last task starts, at least 57 tasks are done
  // (spent >= $1.31), so its three parallel readers cannot all reserve $0.075 under $1.5: one must wait; and no single
  // call is ever refused (spent before any call + $0.075 <= $1.455).
  let n = 0;
  await LR.runReplay({ tasks: TASKS, load: async t => ({ rec: replayRec(t), inv: replayInv() }), call: LR.metered(LR.makeLedger(Infinity), 0, async (nm, system) => { n += 1; return { text: reply(system), costUsd: 0, error: null }; }), out: tmp('p0n'), concurrency: 3 });
  const unit = 1.38 / n;
  const ledger = LR.makeLedger(1.5, { pollMs: 1 });
  let i = 0;
  const names = [];
  const raw = async (name, system) => { names.push(name); i += 1; await new Promise(r => setTimeout(r, 1 + (i % 4))); return { text: reply(system), costUsd: unit, error: null, models: ['claude-haiku-5-5'] }; };
  const out = tmp('p0');
  const { rows, stop } = await LR.runReplay({ tasks: TASKS, load: async t => ({ rec: replayRec(t), inv: replayInv() }), call: LR.metered(ledger, 0.075, raw), out, concurrency: 3 });
  assert.equal(names.length, n);
  assert.equal(stop, null);
  const s = LR.summarize({ tasks: TASKS, rows, K: 3, model: 'claude-haiku-5-5', ledger });
  assert.equal(s.complete, true);
  assert.equal(s.readers.of, 180);
  assert.equal(s.readers.parsedAfterReask, 180);
  assert.deepEqual(s.readers.failedTasks, []);
  assert.equal(s.readers.met, true);
  assert.ok(Math.abs(ledger.spent - 1.38) < 1e-6, String(ledger.spent));
  assert.ok(ledger.waits > 0, 'the cap was reached in flight and calls waited');
  assert.ok(Math.abs(s.settledUsd - 1.38) < 1e-6, String(s.settledUsd));            // every row records its settled spend
  // Node folders are named by task index, never by task name.
  assert.ok(names.every(n => /^t\d{3}\//.test(n) && !TASKS.some(t => n.includes(t))), names.slice(0, 3).join(' '));
});

test('g2 an environment fault is never scored: the run stops, lists the fault, and --resume re-runs only faulted and missing tasks; timeouts count apart', { timeout: 120_000 }, async () => {
  const LR = await import('../replay/ledger-replay.mjs');
  const tasks = TASKS.slice(0, 8);
  const out = tmp('p0f');
  const good = `\`\`\`json\n${JSON.stringify(ledgerReply())}\n\`\`\``;
  let faulted = false;
  const raw1 = async (name, system) => {
    if (name.startsWith('t003/') && !faulted) { faulted = true; return { text: null, costUsd: 0, error: 'MODEL_RATE_LIMIT' }; }
    if (name === 't001/ledger-2') return { text: null, costUsd: 0.001, error: 'EXECUTOR_TIMEOUT' };
    return { text: system === LG.LEDGER_SYSTEM ? good : '{}', costUsd: 0.001, error: null, models: ['claude-haiku-5-5'] };
  };
  const ledger = LR.makeLedger(5, { pollMs: 1 });
  const first = await LR.runReplay({ tasks, load: async t => ({ rec: replayRec(t), inv: replayInv() }), call: LR.metered(ledger, 0.075, raw1), out, concurrency: 1 });
  assert.equal(first.stop, 'fault');
  const s1 = LR.summarize({ tasks, rows: first.rows, K: 3 });
  assert.equal(s1.complete, false);
  assert.equal(s1.readers.ruleApplicable, false);
  assert.equal(s1.readers.met, null);
  assert.deepEqual(s1.faults, [{ task: tasks[3], code: 'MODEL_RATE_LIMIT' }]);
  assert.equal(s1.readers.timeouts, 1);                                           // reported apart, never re-asked as a parse failure
  assert.equal(s1.readers.of, 24);
  const again = [];
  const raw2 = async (name, system) => { again.push(name.split('/')[0]); return { text: system === LG.LEDGER_SYSTEM ? good : '{}', costUsd: 0.001, error: null, models: ['claude-haiku-5-5'] }; };
  const second = await LR.runReplay({ tasks, load: async t => ({ rec: replayRec(t), inv: replayInv() }), call: LR.metered(LR.makeLedger(5, { pollMs: 1 }), 0.075, raw2), out, concurrency: 1, resume: true });
  assert.equal(second.stop, null);
  assert.deepEqual([...new Set(again)].sort(), ['t003', 't004', 't005', 't006', 't007']);
  const s2 = LR.summarize({ tasks, rows: second.rows, K: 3 });
  assert.equal(s2.complete, true);
  assert.equal(s2.readers.of, 24);
  assert.equal(s2.readers.parsedAfterReask, 23);                                  // the timed-out reader stays not parsed
});

test('g3 a capped task stays in the denominator as unparsed and stops the run', { timeout: 60_000 }, async () => {
  const LR = await import('../replay/ledger-replay.mjs');
  const tasks = TASKS.slice(0, 4);
  const good = `\`\`\`json\n${JSON.stringify(ledgerReply())}\n\`\`\``;
  const ledger = LR.makeLedger(0.2, { pollMs: 1 });
  const { rows, stop } = await LR.runReplay({ tasks, load: async t => ({ rec: replayRec(t), inv: replayInv() }), call: LR.metered(ledger, 0.075, async (n, s) => ({ text: s === LG.LEDGER_SYSTEM ? good : '{}', costUsd: 0.06, error: null })), out: tmp('p0c'), concurrency: 1 });
  assert.equal(stop, 'cap');
  const s = LR.summarize({ tasks, rows, K: 3 });
  assert.equal(s.readers.of, 12);
  assert.equal(s.readers.failedTasks.length, 1);
  assert.equal(s.readers.failedTasks[0].capped, true);
  assert.ok(s.readers.parsedAfterReask < 12);
  assert.equal(s.complete, false);
});

// ---------------------------------------------------------------------------------------------------------------
// The effect table's messaging column: one stated rule over every operation

test('m1 messaging rule: every channel comes from MESSAGING_RULE over the index description; the e-mail and reply operations the review named are covered; a note is not a reply', { skip: !HAVE_SCHEMAS && 'AutomationBench schemas missing' }, async () => {
  const BE = await import('../harness/v2/build-effects.mjs');
  const index = readFileSync(path.join(SCHEMAS, 'index.txt'), 'utf8').split('\n').filter(Boolean).map(l => l.split('\t'));
  const byOp = new Map(PC.EFFECTS.rows.map(r => [r.op, r]));
  for (const [op, ch] of [['recruitee.mailbox.messages.create', 'email'], ['xero.invoices.email', 'email'], ['quickbooks.invoice.send', 'email'], ['quickbooks.estimate.send', 'email'], ['quickbooks.salesreceipt.send', 'email'], ['wave.invoices.send', 'email'],
    ['zoho_desk.tickets.comment', 'reply'], ['intercom.conversations.reply', 'reply'], ['intercom.conversations.note', 'note'], ['helpscout.conversations.note', 'note'], ['gmail.users.messages.send', 'email'], ['slack.chat.postMessage', 'chat']]) assert.equal(byOp.get(op)?.channel, ch, op);
  assert.equal(byOp.get('gmail.users.messages.trash').channel, null);
  for (const [, op, method, , description] of index) assert.equal(byOp.get(op).channel, BE.channelOf(method, description), op);
  assert.ok(!('CHANNELS' in BE), 'no per-operation channel list');
  assert.deepEqual(PC.EFFECTS.messagingRule.order, ['sms', 'chat', 'dm', 'email', 'esign', 'social', 'reply', 'note']);
  // Calls on the shared reply path are told apart by the schema's body constant: an internal note is not linted as a reply.
  const routes = GT.gateRoutes();
  const url = 'https://api.intercom.io/conversations/5/reply';
  assert.equal(TG.routeOf('POST', url, routes, { message_type: 'comment', type: 'admin', body: 'x' })?.op, 'intercom.conversations.reply');
  assert.equal(TG.routeOf('POST', url, routes, { message_type: 'note', type: 'admin', body: 'x' }), null);
  assert.ok(PC.channelsOf('intercom').has('reply') && !PC.channelsOf('intercom').has('note'));
});

// ---------------------------------------------------------------------------------------------------------------
// Minor fixes

test('n1 minors: a parent kind named elsewhere stays a candidate; an unresolved channel is no channel; DEV_ONLY; paired harm; the brief hides observability', async () => {
  const tr = { records: [rec('trello:cards:k1', { id: 'k1' })] };
  assert.equal(PC.kindFor({ app: 'trello', target: 'the board', statement: 'Create a card and add a comment' }, tr).kind, 'cards');
  assert.equal(PC.kindFor({ app: 'trello', target: 'trello:cards:k1', statement: 'add a comment on the card' }, tr).kind, 'comment');
  assert.equal(PC.resolveChannel('the team', { records: [rec('slack:channel_list:C9', { id: 'C9', name: 'ledger-ops' })] }), null);
  assert.deepEqual(PC.resolveChannel('#new-room', { records: [] }), { id: null, name: 'new-room' });
  assert.equal(V2.DEV_ONLY, true);
  assert.match(readFileSync(path.join(REPO, 'experiments/autobench/run.mjs'), 'utf8'), /!co\?\.DEV_ONLY/);
  const { compareHarm } = await import('../replay/harm.mjs');
  const row = (task, d) => ({ task, duplicates: d, removals: 0, extraMessages: 0, containers: 0, readFlips: 0 });
  const c = compareHarm({ missing: [], rows: [row('a', 1), row('b', 5)] }, { missing: ['b'], rows: [row('a', 1), { task: 'b', missing: true }] });
  assert.equal(c.comparable, false);
  assert.equal(c.paired, 1);
  assert.deepEqual([c.a.duplicates, c.b.duplicates], [1, 1]);
  assert.doesNotMatch(CK.renderChecks([{ id: 'P1', item: 'M1', type: 'record_created', hard: true, params: { app: 'notion', kind: 'page', values: ['x'] } }]), /observable/);
});

test('n2 the lint replay refuses to judge a subset: a task without compiled.json fails the command', { timeout: 60_000 }, () => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'experiments/autobench/replay/replay-gate.mjs'), '--lint', '--from', tmp('nolint'), '--tasks', 'sales.a,sales.b', '--run', tmp('norun')], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /"missing": \[\n\s+"sales\.a",\n\s+"sales\.b"\n\s+\]/);
});

test('n3 the single-pass act session keeps back 4 responses (checker 1 + drift 3), not the 8 repairs needed', { timeout: 120_000 }, async () => {
  const { p } = await fakeRun({ ledger: () => ledgerReply() });
  const act = p.nodes.find(n => n.name === 'act');
  const before = p.nodes.filter(n => n.kind === 'model' && p.nodes.indexOf(n) < p.nodes.indexOf(act)).reduce((s, n) => s + n.responses, 0);
  assert.equal(act.cap, 50 - before - 4);
});

test('k1 held-out rule: look 2 is re-derived by the committed seeded rule and matches the FROZEN plan (D23, D25)', { timeout: 60_000 }, async () => {
  const H = await import('../replay/heldout-look2.mjs');
  const split = { devCheck: ['sales.dc'], dev: ['sales.dc', ...Array.from({ length: 30 }, (_, i) => `sales.t${i}`), ...Array.from({ length: 12 }, (_, i) => `hr.t${i}`)], forcedSources: [{ tasks: ['sales.t0'] }], test: [], sha256: {} };
  const seen = new Map([['sales.t1', new Set(['x'])]]);
  const L = H.look2({ split: { ...split }, look1: ['sales.t2'], briefed: ['sales.t3'], seen, domains: ['sales', 'hr'] });
  assert.equal(L.tasks.length, 20);
  for (const t of ['sales.dc', 'sales.t0', 'sales.t1', 'sales.t2', 'sales.t3']) assert.ok(!L.tasks.includes(t), t);
  assert.deepEqual(H.look2({ split: { ...split }, look1: ['sales.t2'], briefed: ['sales.t3'], seen, domains: ['sales', 'hr'] }).tasks, L.tasks);   // deterministic
  if (existsSync(H.PLAN)) {
    const r = spawnSync(process.execPath, [path.join(REPO, 'experiments/autobench/replay/heldout-look2.mjs')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout.slice(-2000));
    assert.equal(JSON.parse(r.stdout).rederived.matches, true);
  }
});
