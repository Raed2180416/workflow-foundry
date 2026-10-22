// Tests of the A1-C v2 re-review fixes (re-reviews A "correctness and tests" and B "generic-only, safety and statistics"
// of 2026-10-21, workflow wf_0f3cd2be-450). $0: no model, no paid call; hand-built reads, a fake inventory client, the real
// gated client against an in-test responder, the run.mjs launch path up to its cap checks, and scripted model nodes.
// Each behavioural test fails on the second build (0a5c5ed).
//   nice -n 15 node --test --test-concurrency=1 experiments/autobench/test/codeowned-v2-rereview.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { REPO, VENV_PY } from '../lib.mjs';
import * as V2 from '../harness/v2/codeowned.mjs';
import * as PC from '../harness/v2/postconditions.mjs';
import * as LG from '../harness/v2/ledger.mjs';
import * as TG from '../harness/v2/tool-gated.mjs';
import * as GT from '../harness/v2/gate.mjs';
import * as INVM from '../harness/v2/inventory.mjs';

const tmp = p => mkdtempSync(path.join(os.tmpdir(), `autobench-c2rr-${p}-`));
const V2_DIR = path.join(REPO, 'experiments/autobench/harness/v2');
const HAVE_VENV = existsSync(VENV_PY);
const rec = (ptr, data) => ({ ptr, app: ptr.split(':')[0], kind: ptr.split(':')[1], id: ptr.split(':').slice(2).join(':'), data });
const read = (apps, records = [], extra = {}) => ({ apps: Object.fromEntries(Object.entries(apps).map(([a, kinds]) => [a, { status: 'connected', kinds, records: 0 }])), records, connected: Object.keys(apps), errors: [], ...extra });

// ---------------------------------------------------------------------------------------------------------------
// B-1: the v2-M arm launches (run.mjs wires executor-model roles into codeowned-v2 too)

test('rr1 B-1: a codeowned-v2 launch with Mercury roles passes the pipeline guard and stops at the cap checks; other pipelines are still refused', async () => {
  const { runTasks, EXECUTOR_PIPELINES } = await import('../run.mjs');
  assert.deepEqual([...EXECUTOR_PIPELINES], ['codeowned', 'codeowned-v2']);
  const base = { tasks: ['simple.email_sf_contact_phone_update'], domains: ['simple'], model: 'claude-haiku-5-5', nodeModels: { ledger: 'mercury-3', checker: 'mercury-3' }, liveRoot: tmp('b1'), outDir: null, log: () => {} };
  // No --cap: the dollar cap check, which comes after the pipeline guard.
  await assert.rejects(runTasks({ ...base, harness: 'codeowned-v2' }), /--cap \(hard USD cap for the run\) is required/);
  // A cap but no token cap: the token-cap check names mercury-3, so the Mercury roles were recognised for v2.
  await assert.rejects(runTasks({ ...base, harness: 'codeowned-v2', capUsd: 1 }), /--token-cap .* is required for mercury-3/);
  await assert.rejects(runTasks({ ...base, nodeModels: { reader: 'mercury-3' }, harness: 'secondreader', capUsd: 1, tokenCap: 1000 }), /executor models are wired into the codeowned and codeowned-v2 pipelines only/);
});

test('rr2 B-1: manifest-hash.mjs mirrors the launch guard (no hash for an arm run.mjs would refuse); the v2-M hash differs from v2\'s', () => {
  const tool = path.join(REPO, 'experiments/autobench/replay/manifest-hash.mjs');
  const run = extra => spawnSync(process.execPath, [tool, '--root', REPO, ...extra], { encoding: 'utf8' });
  const v2m = run(['--harness', 'codeowned-v2', '--node-models', 'ledger=mercury-3,checker=mercury-3']);
  assert.equal(v2m.status, 0, v2m.stderr);
  const v2 = run(['--harness', 'codeowned-v2']);
  assert.notEqual(JSON.parse(v2m.stdout).sha256, JSON.parse(v2.stdout).sha256);
  const refused = run(['--harness', 'secondreader', '--node-models', 'reader=mercury-3']);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /run\.mjs would refuse this launch/);
});

test('rr3 B-1: end to end (v2, scripted): ledger and checker roles on mercury-3, act on haiku; each node audited against its role\'s model; tokens by model', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 600_000 }, async () => {
  const { runTasks } = await import('../run.mjs');
  const STUBS = await import('../harness/v2/codeowned-stubs.mjs');
  const seen = [];
  const node = STUBS.stubNodeRunner({ seen });
  const nodeRunner = async args => ({ ...(await node(args)), ...(args.model === 'mercury-3' ? { tokens: { input: 900, output: 100, cachedInput: 0, reasoning: 0, total: 1000, budget: 100000, usageMissing: false } } : {}) });
  const session = STUBS.stubSessionRunner();
  const runner = async args => ({ ...(await session(args)), streamUsage: { inputTokens: 50, outputTokens: 20, cacheReadTokens: 400, cacheWriteTokens: 0 } });
  const { summary, results } = await runTasks({ tasks: ['simple.email_sf_contact_phone_update'], domains: ['simple'], harness: 'codeowned-v2', det: 'record', liveRoot: tmp('e2e'), outDir: null, log: () => {},
    model: 'claude-haiku-5-5', nodeModels: { ledger: 'mercury-3', checker: 'mercury-3' }, runner, nodeRunner, dryRun: false });
  const f = results[0].forks[0];
  assert.equal(f.harnessError ?? null, null, f.harnessError);
  assert.deepEqual([...new Set(seen.filter(s => /^ledger/.test(s.node ?? '')).map(s => s.model))], ['mercury-3'], JSON.stringify(seen.map(s => [s.node, s.model])));
  assert.deepEqual(f.session.violations, []);
  assert.deepEqual([...f.session.models].sort(), ['claude-haiku-5-5', 'mercury-3'], 'each node audited against the model its role names');
  const merc = f.pipeline.nodes.filter(n => n.model === 'mercury-3');
  assert.ok(merc.length >= 3 && merc.every(n => n.tokens === 1000), JSON.stringify(f.pipeline.nodes.map(n => [n.name, n.model, n.tokens])));
  assert.equal(f.tokens.byModel['mercury-3'].total, merc.length * 1000);
  assert.ok(summary.tokens.byModel['mercury-3'].total >= 3000);
});

// ---------------------------------------------------------------------------------------------------------------
// M-1 and B minor 1: the look-2 exposure check (count-valued summaries, every root, this plan's own runs exempt)

test('rr4 M-1: a summary whose `tasks` is a count names no task (no throw); P0 summaries write `taskCount`', async () => {
  const H = await import('../replay/heldout-look2.mjs');
  const root = tmp('roots');
  mkdirSync(path.join(root, 'p0')); writeFileSync(path.join(root, 'p0', 'summary.json'), JSON.stringify({ tasks: 60, complete: true }));
  mkdirSync(path.join(root, 'r1')); writeFileSync(path.join(root, 'r1', 'launch.json'), JSON.stringify({ tasks: ['sales.a', 'sales.b'] }));
  mkdirSync(path.join(root, 'r2', 'prep', 'hr.c'), { recursive: true });
  const { seen } = H.seenTasks([root]);
  assert.deepEqual([...seen.keys()].sort(), ['hr.c', 'sales.a', 'sales.b']);
  const LR = await import('../replay/ledger-replay.mjs');
  const s = LR.summarize({ tasks: ['sales.a'], rows: [], K: 3 });
  assert.equal(s.taskCount, 1);
  assert.equal('tasks' in s, false);
});

test('rr5 B minor 1: exempt only this frozen plan\'s look-2 sidecar runs and the decision-named reference run as launched', async () => {
  const H = await import('../replay/heldout-look2.mjs');
  const look2 = new Set(['sales.a', 'sales.b']);
  const ex = H.look2Exemption({ planSha256: 'P', look2Sha256: 'L', look2Tasks: look2, reference: { 'ref-1': { decision: 'D', model: 'claude-opus-5-5', harness: false }, 'ref-a1': { decision: 'E', model: 'claude-sonnet-5-5', harness: 'any' } } });
  const sc = (o = {}) => ({ 'sequential-look.json': { plan: 'P', look: 2, tasksSha256: 'L', role: 'control', arm: 'A0', ...o } });
  assert.match(ex('a0-look2', sc(), ['sales.a', 'sales.b']), /look-2 run of the frozen plan/);
  assert.equal(ex('x', sc({ plan: 'Q' }), ['sales.a']), null);                     // another plan
  assert.equal(ex('x', sc({ look: 3 }), ['sales.a']), null);                       // another look
  assert.equal(ex('x', sc(), ['sales.a', 'sales.z']), null);                       // a task outside look 2
  const launch = (o = {}) => ({ 'launch.json': { model: 'claude-opus-5-5', harness: null, ...o } });
  assert.match(ex('ref-1', launch(), ['sales.a']), /reference run: D/);
  assert.equal(ex('ref-1', launch({ harness: 'abc' }), ['sales.a']), null);       // a harness arm is not the reference arm
  assert.equal(ex('ref-1', launch({ model: 'claude-haiku-5-5' }), ['sales.a']), null);
  assert.equal(ex('ref-2', launch(), ['sales.a']), null);                          // a run no decision names
  assert.match(ex('ref-a1', launch({ model: 'claude-sonnet-5-5', harness: 'a9fd' }), ['sales.a']), /reference run: E/);   // D27's A1 fork
  assert.deepEqual(Object.keys(H.REFERENCE_RUNS).sort(), ['a0o-look2-1', 'a1s-look2']);
  // A non-exempt run on a look-2 task is exposure; the exempt ones are listed with their reason.
  const root = tmp('ex');
  for (const [d, files] of [['a0-look2', { 'sequential-look.json': { plan: 'P', look: 2, tasksSha256: 'L', role: 'control', arm: 'A0', tasks: ['sales.a', 'sales.b'] } }], ['other', { 'launch.json': { tasks: ['sales.b'] } }]]) {
    mkdirSync(path.join(root, d));
    for (const [f, j] of Object.entries(files)) writeFileSync(path.join(root, d, f), JSON.stringify(j));
  }
  const r = H.seenTasks([root], { exempt: ex });
  assert.deepEqual([...r.seen.keys()], ['sales.b']);
  assert.equal(r.exempted.length, 1);
});

test('rr6 B minor 1: on this checkout the frozen plan, LOOK2-TASKS.json and HELDOUT-LOOK2.json agree (a8c1ed5c…), the rule re-derives look 2 and no other run holds a look-2 task', { timeout: 120_000, skip: !existsSync(path.join(REPO, 'research/automationbench-20261014/SEQUENTIAL-PLAN-v1.json')) && 'plan missing' }, () => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'experiments/autobench/replay/heldout-look2.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout.slice(-3000) + r.stderr.slice(-1000));
  const j = JSON.parse(r.stdout);
  assert.equal(j.plan.planSha256, '3cd586bd7994a4a4bd0de00e771568516eeda808dc45b0297575d9a659cd2ea4');
  assert.equal(j.look2Sha256, 'a8c1ed5c8b18606c97feb7fcdd83115eab8cbdffa6e7956d9ee6d9d0974e916f');
  assert.equal(j.rederived.matches, true);
  assert.ok(j.exposure.roots.length >= 3);
});

// ---------------------------------------------------------------------------------------------------------------
// B M3: completeness values only for records that link to no person outside the item's recipients

test('rr7 B M3: an account owned by another user (by id or by name) never goes into this recipient\'s message; an unowned record still may', () => {
  const INV = { connected: ['gmail', 'salesforce'], outOfScope: [], truncated: [], precedents: [], records: [
    rec('salesforce:User:U1', { Id: 'U1', Name: 'Tamsin Oakes', Email: 'tamsin.oakes@orchid.example' }),
    rec('salesforce:User:U2', { Id: 'U2', Name: 'Ivo Marchetti', Email: 'ivo.marchetti@orchid.example' }),
    rec('salesforce:Account:A01', { Id: 'A01', Name: 'Quillfeather Supply', OwnerId: 'U1', Status: 'At Risk' }),
    rec('salesforce:Account:A02', { Id: 'A02', Name: 'Brindlewood Clinic', OwnerId: 'U2', Status: 'At Risk' }),
    rec('salesforce:Account:A03', { Id: 'A03', Name: 'Harrowgate Mills', Owner: 'Ivo Marchetti', Status: 'At Risk' }),
    rec('salesforce:Account:A04', { Id: 'A04', Name: 'Saltmarsh Dairy', Status: 'At Risk' }),
  ] };
  const REQ = 'Email each account owner the list of their at-risk accounts. Include the account names.';
  const SRC = LG.sourceMap(REQ, INV, { system: 'You automate office work.' });
  const it = { id: 'R1', polarity: 'positive', action: 'send_email', app: 'gmail', target: 'tamsin.oakes@orchid.example', statement: 'email the owner their at-risk accounts', source: 'request',
    fields: [{ name: 'to', quote: 'tamsin.oakes@orchid.example', source: 'salesforce:User:U1', asked_by: { quote: 'Include the account names', source: 'request' } }],
    candidates: ['A01', 'A02', 'A03', 'A04'].map(a => ({ record: `salesforce:Account:${a}`, eligible: true, deciding_field: 'Status', value: 'At Risk', rule_source: 'request' })) };
  const m = LG.mergeLedgers([1, 2, 3].map(k => LG.normalizeLedger({ requirements: [it] }, SRC, { reader: k })), { sources: SRC });
  LG.typeLedger(m, SRC, INV, V2.PIPELINE_DEFAULTS);
  const body = PC.postconditionsFromLedger(m, INV, { sources: SRC, P: V2.PIPELINE_DEFAULTS }).find(p => p.type === 'gmail_sent').params.body;
  assert.ok(body.includes('Quillfeather Supply'), JSON.stringify(body));           // owned by the recipient (by id)
  assert.ok(!body.includes('Brindlewood Clinic'), JSON.stringify(body));           // owned by another user (by id)
  assert.ok(!body.includes('Harrowgate Mills'), JSON.stringify(body));             // owned by another user (by name)
  assert.ok(body.includes('Saltmarsh Dairy'), JSON.stringify(body));               // links to nobody: a list for one audience
  assert.deepEqual([...LG.linkedAddresses(INV.records[3], INV)], ['ivo.marchetti@orchid.example']);
});

// ---------------------------------------------------------------------------------------------------------------
// A minor 1: a re-read cut by its step budget, a listing cap or a later page is no evidence of absence

test('rr8 A minor 1: the inventory records listings it left unissued and listings that name a later page', async () => {
  const msgs = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}` }));
  const answer = c => { const u = JSON.parse(c.arguments).url; return /\/messages$/.test(u) ? { messages: msgs, nextPageToken: 'p2' } : /\/drafts$/.test(u) ? { drafts: [] } : { id: u.split('/').pop(), payload: {} }; };
  const client = { batch: async calls => ({ results: calls.map(c => ({ name: c.name, content: JSON.stringify(answer(c)) })) }), log: [] };
  const cut = await INVM.buildInventory({ request: '', client, maxSteps: 1, only: ['gmail'] });
  assert.ok(cut.notIssued['gmail:message'] >= 6, JSON.stringify(cut.notIssued));
  assert.ok(cut.paged.includes('gmail:message_list'), JSON.stringify(cut.paged));
  assert.equal(INVM.morePages({ has_more: true }), true);
  assert.equal(INVM.morePages({ response_metadata: { next_cursor: '' } }), false);
  assert.equal(INVM.morePages([1, 2]), false);
  const whole = await INVM.buildInventory({ request: '', client: { ...client, batch: async calls => ({ results: calls.map(c => ({ name: c.name, content: JSON.stringify(/\/messages$/.test(JSON.parse(c.arguments).url) ? { messages: [] } : { drafts: [] }) })) }) }, maxSteps: 4, only: ['gmail'] });
  assert.deepEqual(whole.notIssued, {});
  assert.deepEqual(whole.paged, []);
});

test('rr9 A minor 1: a cut re-read gives "not re-read" for an absence (send, post, missing record), never a FAIL; what was read still decides', () => {
  const before = read({ gmail: { message_list: 1, draft_list: 1, message: 1 } }, [rec('gmail:message:m1', { to: 'a@x.example', subject: 'old', body_plain: 'old' })]);
  const sent = { id: 'P1', type: 'gmail_sent', hard: true, params: { to: ['b@y.example'], cc: [], subject: [], body: ['Q3'], bodyNot: [] } };
  const cutAfter = read({ gmail: { message_list: 1, draft_list: 1, message: 1 } }, [...before.records], { notIssued: { 'gmail:message': 150 } });
  const e1 = PC.evaluate(sent, before, cutAfter);
  assert.equal(e1.pass, null, JSON.stringify(e1)); assert.equal(e1.notReread, true);
  const found = read({ gmail: { message_list: 1, draft_list: 1, message: 1 } }, [...before.records, rec('gmail:message:m2', { to: 'b@y.example', subject: 'Q3', body_plain: 'Q3 totals' })], { notIssued: { 'gmail:message': 3 } });
  assert.equal(PC.evaluate(sent, before, found).pass, true);                       // what was read decides
  const ban = { id: 'P2', type: 'gmail_not_sent', hard: true, params: { to: ['b@y.example'] } };
  assert.equal(PC.evaluate(ban, before, found).pass, false);                        // a violation that was read fails
  const banCut = PC.evaluate(ban, before, cutAfter);
  assert.equal(banCut.pass, null); assert.equal(banCut.notReread, true);           // nothing seen on a cut read: no pass
  const whole = read({ gmail: { message_list: 1, draft_list: 1, message: 1 } }, [...before.records], { notIssued: {} });
  assert.equal(PC.evaluate(sent, before, whole).pass, false);                       // a whole re-read still fails
  // Slack: the history of the channel was cut.
  const sb = read({ slack: { channel_list: 1, history: 2 } }, [rec('slack:channel_list:C1', { id: 'C1', name: 'general' }), rec('slack:channel_list:C2', { id: 'C2', name: 'ops' })]);
  const sa = read({ slack: { channel_list: 1, history: 1 } }, [...sb.records], { notIssued: { 'slack:history': 1 } });
  const post = { id: 'P3', type: 'slack_posted', hard: true, params: { channel: { id: 'C2', name: 'ops' }, text: ['Q3'], bodyNot: [] } };
  assert.equal(PC.evaluate(post, sb, sa).notReread, true);
  // A record missing from a listing cut at its cap, or from one that names a later page.
  const hb = read({ hubspot: { deals: 1 } }, [rec('hubspot:deals:9', { id: '9', dealstage: 'open' })]);
  const field = { id: 'P4', type: 'record_field', hard: true, params: { ptr: 'hubspot:deals:9', field: 'dealstage', value: 'closedwon' } };
  for (const extra of [{ notIssued: {}, truncated: ['hubspot:deals'] }, { notIssued: {}, paged: ['hubspot:deals'] }]) {
    const e = PC.evaluate(field, hb, read({ hubspot: { deals: 1 } }, [], extra));
    assert.equal(e.pass, null, JSON.stringify(e)); assert.equal(e.notReread, true);
  }
  assert.equal(PC.evaluate(field, hb, read({ hubspot: { deals: 1 } }, [], { notIssued: {} })).pass, false);   // a whole listing without it fails
  // A record that WAS read with the wrong value fails even on a cut read.
  assert.equal(PC.evaluate(field, hb, read({ hubspot: { deals: 1 } }, [rec('hubspot:deals:9', { id: '9', dealstage: 'open' })], { notIssued: {}, truncated: ['hubspot:deals'] })).pass, false);
});

// ---------------------------------------------------------------------------------------------------------------
// A minor 3: mapped checks pinned by a recipient, channel, parent, kind or sheet stay hard

test('rr10 A minor 3: a mapped check with only minority values is advisory only when nothing else pins it', () => {
  const sources = new Map([['request', { text: 'Send the "Q3 totals" to ops@orchid.example, post "Q3 totals" in #ops, log "Q3 totals" on sheet S1, add a card "Q3 totals" and a comment "Q3 totals" on ticket 7.' }]]);
  const inv = { records: [rec('slack:channel_list:C2', { id: 'C2', name: 'ops' }), rec('zendesk:tickets:7', { id: 7 })], connected: ['gmail', 'slack', 'trello', 'zendesk', 'google_sheets'] };
  // The item's only majority field is the recipient; "Q3 totals" was written by one reader (a minority value).
  const item = app => ({ app, statement: 'send the totals', fields: [{ name: 'to', value: 'ops@orchid.example', support: 3 }, { name: 'body', value: 'Q3 totals', support: 1 }] });
  const hv = (p, app) => PC.validateMapped(p, sources, inv, { item: item(app), majority: 2 })?.hardValue;
  assert.equal(hv({ type: 'gmail_sent', params: { to: ['ops@orchid.example'], body: ['Q3 totals'] } }, 'gmail'), true);
  assert.equal(hv({ type: 'slack_posted', params: { channel: '#ops', text: ['Q3 totals'] } }, 'slack'), true);
  assert.equal(hv({ type: 'child_created', params: { parent: 'zendesk:tickets:7', kind: 'comments', values: ['Q3 totals'] } }, 'zendesk'), true);
  assert.equal(hv({ type: 'record_created', params: { app: 'trello', kind: 'cards', values: ['Q3 totals'] } }, 'trello'), true);
  assert.equal(hv({ type: 'sheet_row', params: { spreadsheetId: 'S1', values: ['Q3 totals'] } }, 'google_sheets'), true);
  // Pinned by nothing but a minority value: advisory.
  assert.equal(hv({ type: 'record_created', params: { app: 'trello', kind: null, values: ['Q3 totals'] } }, 'trello'), false);
  assert.equal(hv({ type: 'sheet_row', params: { spreadsheetId: null, values: ['Q3 totals'] } }, 'google_sheets'), false);
  assert.equal(hv({ type: 'channel_posted', params: { app: 'trello', channel: null, text: ['Q3 totals'] } }, 'trello'), false);
});

// ---------------------------------------------------------------------------------------------------------------
// A minor 5: a post is observable per kind its operations create

test('rr11 A minor 5: a post is judged only in a listing of the kind its operations create (Buffer queues, Facebook photos)', () => {
  assert.deepEqual(PC.postKindsOf('facebook_pages').sort(), ['feed', 'photo']);
  assert.deepEqual(PC.postKindsOf('buffer'), ['update']);
  const fb = { id: 'P1', type: 'channel_posted', hard: true, params: { app: 'facebook_pages', channel: null, text: ['Launch'], bodyNot: [] } };
  const feedOnly = read({ facebook_pages: { accounts: 1, feed: 1 } }, [rec('facebook_pages:accounts:pg1', { id: 'pg1', name: 'Orchid' })]);
  const e1 = PC.evaluate(fb, feedOnly, feedOnly);
  assert.equal(e1.pass, null, JSON.stringify(e1)); assert.equal(e1.unobservable, true);   // the post may be a photo the read never lists
  const withPost = read({ facebook_pages: { accounts: 1, feed: 1 } }, [...feedOnly.records, rec('facebook_pages:feed:f1', { id: 'f1', message: 'Launch day' })]);
  assert.equal(PC.evaluate(fb, feedOnly, withPost).pass, true);                     // a post seen in the feed decides
  const both = read({ facebook_pages: { accounts: 1, feed: 1, photos: 1 } }, [...feedOnly.records]);
  assert.equal(PC.evaluate(fb, both, both).pass, false);                            // every post kind listed and empty: FAIL
  const buf = { id: 'P2', type: 'channel_posted', hard: true, params: { app: 'buffer', channel: null, text: ['Launch'], bodyNot: [] } };
  const sentOnly = read({ buffer: { profiles: 1, sent_updates: 1 } }, [rec('buffer:profiles:p1', { id: 'p1' })]);
  const e2 = PC.evaluate(buf, sentOnly, sentOnly);
  assert.equal(e2.pass, null, JSON.stringify(e2)); assert.equal(e2.unobservable, true);   // a queued update is never in sent.json
});

// ---------------------------------------------------------------------------------------------------------------
// B minor 8: a held call sent on its own is never sent again with its batch

const b64url = s => Buffer.from(s, 'utf8').toString('base64url');
const sendMail = (to, body) => ({ name: 'api_fetch', arguments: JSON.stringify({ method: 'POST', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', params: null, body: JSON.stringify({ raw: b64url(`To: ${to}\r\nSubject: Summary\r\n\r\n${body}`) }) }) });
const GATE_PCS = [{ id: 'P1', item: 'M1', type: 'gmail_sent', hard: true, params: { to: ['finance-lead@orchid.example'], cc: [], subject: [], body: [], bodyNot: ['Brackenridge Tools'] } }];
const GATE_MERGED = { items: [{ id: 'M1', exclusions: [{ literal: 'Brackenridge Tools', rule: { source: 'gmail:message:g1', quote: 'Vendors on hold are left out of every summary' } }] }] };
const CFG = GT.gateConfig(GATE_PCS, { merged: GATE_MERGED, perPair: 1, perSession: 2 });

test('rr12 B minor 8: decide refuses the batch whole when a held call was sent on its own since; the rest of the batch goes out once', () => {
  const bad = sendMail('finance-lead@orchid.example', 'Brackenridge Tools 980'), ok = sendMail('ops@orchid.example', 'Quillfeather');
  const h = TG.callHash(ok), hb = TG.callHash(bad);
  const log = [{ kind: 'refused', rule: 'P1', recipient: 'finance-lead@orchid.example', hash: hb }, { kind: 'held', hash: h }];
  assert.deepEqual(TG.decide([ok, bad], CFG, log).map(d => d.action), ['send', 'resend']);              // nothing sent since: the resend sends both
  const sentSince = [...log, { kind: 'sent', hash: h }];
  const ds = TG.decide([ok, bad], CFG, sentSince);
  assert.deepEqual(ds.map(d => d.action), ['duplicate', 'held']);
  assert.match(TG.duplicateText(ds[0], ok), /already sent on its own .* would send it twice/);
  assert.deepEqual(TG.decide([bad], CFG, sentSince).map(d => d.action), ['resend']);                   // the refused call alone goes out
  assert.deepEqual(GT.gateSummary([...sentSince, { kind: 'duplicate' }]), { loaded: 0, refused: 1, held: 1, resentIdentical: 0, capped: 0, duplicatesRefused: 1, heldThenSent: 1 });
});

function responder(box) {
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
        writeFileSync(path.join(box, `res-${m[1]}.json.tmp`), JSON.stringify({ results: req.calls.map((c, i) => ({ name: c.name, content: `ok ${m[1]}.${i + 1}` })) }));
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

test('rr13 B minor 8: the real client: a refused batch, its held call sent alone, then the identical batch again: refused (no request); each message goes out exactly once', { timeout: 60_000 }, async () => {
  const wd = tmp('dup');
  mkdirSync(path.join(wd, '.tools'));
  copyFileSync(path.join(V2_DIR, 'tool-gated.mjs'), path.join(wd, 'tool.mjs'));
  const gdir = tmp('gate');
  GT.writeGate(gdir, CFG);
  const resp = responder(path.join(wd, '.tools'));
  const bad = sendMail('finance-lead@orchid.example', 'Brackenridge Tools 980'), ok = sendMail('ops@orchid.example', 'Quillfeather');
  const env = { [GT.GATE_ENV]: gdir };
  try {
    const r1 = await runClient(wd, ['batch', JSON.stringify([ok, bad])], env);
    assert.equal(r1.code, 1);
    const r2 = await runClient(wd, ['batch', JSON.stringify([ok])], env);                             // the held call on its own
    assert.equal(r2.code, 0, r2.stderr);
    const r3 = await runClient(wd, ['batch', JSON.stringify([ok, bad])], env);                        // the identical batch again
    assert.equal(r3.code, 1);
    assert.match(r3.stderr, /already sent on its own/);
    const r4 = await runClient(wd, ['batch', JSON.stringify([bad])], env);                            // the rest, as the note says
    assert.equal(r4.code, 0, r4.stderr);
    await new Promise(r => setTimeout(r, 100));
    const to = resp.served.map(c => Buffer.from(JSON.parse(JSON.parse(c.arguments).body).raw, 'base64url').toString().split('\r\n')[0]);
    assert.deepEqual(to, ['To: ops@orchid.example', 'To: finance-lead@orchid.example']);
    const lines = GT.readGateLog(path.join(wd, '.tools', GT.GATE_LOG)).lines;
    // r4's call was held by r3, so its send is recorded too: a later identical batch would not send it again.
    assert.deepEqual(lines.map(l => l.kind), ['loaded', 'held', 'refused', 'loaded', 'sent', 'loaded', 'duplicate', 'held', 'loaded', 'resent', 'sent']);
  } finally { resp.stop(); }
});

// ---------------------------------------------------------------------------------------------------------------
// B minor 9: app-less routing

test('rr14 B minor 9: an app-less e-mail goes to Gmail only when Gmail is connected; an app-less post to Slack only when Slack is the one posting app', () => {
  const mail = { action: 'send_email', app: null };
  assert.equal(PC.messageRoute(mail, { connected: [] }), null);
  assert.equal(PC.messageRoute(mail, { connected: ['salesforce'] }), null);
  assert.equal(PC.messageRoute(mail, { connected: ['gmail', 'salesforce'] }), 'gmail');
  assert.equal(PC.messageRoute(mail, {}), 'gmail');                                  // a hand-built inventory without the list
  const post = { action: 'post_message', app: null };
  assert.equal(PC.messageRoute(post, { connected: ['slack', 'gmail'] }), 'slack');
  assert.equal(PC.messageRoute(post, { connected: ['slack', 'facebook_pages'] }), null);
  assert.equal(PC.messageRoute(post, { connected: ['facebook_pages'] }), null);
  assert.equal(PC.messageRoute({ action: 'post_message', app: 'facebook_pages' }, { connected: ['slack', 'facebook_pages'] }), 'channel');
});

// ---------------------------------------------------------------------------------------------------------------
// B minor 7: the KNOWLEDGE block names the thresholds and rules tuned in-sample (D21)

test('rr15 B minor 7: KNOWLEDGE names the value-typing thresholds as the code has them, the routing and kind rules, the re-review rules and the P0 lint decision', () => {
  const K = V2.KNOWLEDGE.join('\n');
  const lit = readFileSync(path.join(V2_DIR, 'literals.mjs'), 'utf8'), led = readFileSync(path.join(V2_DIR, 'ledger.mjs'), 'utf8');
  assert.match(lit, /w\.length >= 5 && sw\.size\) .*>= 0\.6\) return 'restates the requirement'/);
  assert.match(K, />= 60% of the statement's content words appear in a value of >= 5 words/);
  assert.match(lit, /words\(v\)\.length <= 8\) return \{ type: 'short'/); assert.match(K, /<= 8 words is short text/);
  assert.match(lit, /A run of <= 3 alternatives/); assert.match(K, /<= 3 alternatives/);
  assert.match(led, /String\(f\.value\)\.trim\(\)\.length <= 160/); assert.match(K, /at most 160 characters/);
  for (const rule of [/without an app goes to Gmail only when Gmail is connected/, /unresolved channel is no channel/, /parent kind is dropped only when named next to its child/, /deciding value the item's own source asks for stays/, /internal note .* is its own channel/,
    /not re-read/, /per kind its operations create/, /Slack only when Slack is the one connected app that posts/, /links to no person outside the item's recipients/, /spreadsheet/, /never resent with its batch/, /preSendLint/]) assert.match(K, rule);
  assert.ok(V2.KNOWLEDGE.filter(k => k.startsWith('D21')).length >= 9);
});

// ---------------------------------------------------------------------------------------------------------------
// A minor 4: the P0 replay's cap is a hard total across resumes

test('rr16 A minor 4: a faulted or capped attempt keeps its settled spend; a resumed ledger starts at every earlier attempt\'s total', { timeout: 60_000 }, async () => {
  const LR = await import('../replay/ledger-replay.mjs');
  const REQUEST = 'Send ops@orchid.example the weekly summary.';
  const recOf = task => ({ task, prompt: { system: 'You automate office work.', user: REQUEST }, grade: { assertion_results: [] }, v1: { postconditions: { pcs: [] }, ledgers: null } });
  const inv = () => ({ records: [], connected: ['gmail'], outOfScope: [], truncated: [], precedents: [], clock: null });
  const tasks = ['sales.r0', 'sales.r1'];
  const out = tmp('p0spend');
  let calls = 0;
  // Task 2's second reader call faults after its first reader spent $0.01 (and reports no cost: settled at its reservation).
  // Reader 3 of that task answers after the fault (a sibling still in flight when the readers' Promise.all rejects).
  const raw1 = async name => { calls += 1; if (name === 't001/ledger-2') return { text: null, costUsd: 0, error: 'MODEL_RATE_LIMIT' }; if (name === 't001/ledger-3') await new Promise(r => setTimeout(r, 50)); return { text: '{"requirements": []}', costUsd: name === 't001/ledger-1' ? null : 0.01, error: null }; };
  const first = await LR.runReplay({ tasks, load: async t => ({ rec: recOf(t), inv: inv() }), call: LR.metered(LR.makeLedger(5, { pollMs: 1 }), 0.05, raw1), out, concurrency: 1 });
  assert.equal(first.stop, 'fault');
  const faultRow = JSON.parse(readFileSync(path.join(out, 'sales.r1', 'row.json'), 'utf8'));
  assert.equal(faultRow.fault, 'MODEL_RATE_LIMIT');
  assert.ok(Math.abs(faultRow.settledUsd - 0.06) < 1e-9, JSON.stringify(faultRow));  // reader 1 at its reservation ($0.05, no cost reported) + reader 3 ($0.01, after the fault)
  const okRow = JSON.parse(readFileSync(path.join(out, 'sales.r0', 'row.json'), 'utf8'));
  const prior = LR.priorSpend(out, tasks);
  assert.ok(Math.abs(prior - (okRow.settledUsd + faultRow.settledUsd)) < 1e-9);
  // Resume: the ledger starts at the earlier total; the re-run row carries its earlier attempt's spend.
  const ledger = LR.makeLedger(5, { spent: prior, pollMs: 1 });
  const second = await LR.runReplay({ tasks, load: async t => ({ rec: recOf(t), inv: inv() }), call: LR.metered(ledger, 0.05, async () => ({ text: '{"requirements": []}', costUsd: 0.01, error: null })), out, concurrency: 1, resume: true });
  assert.equal(second.stop, null);
  const again = JSON.parse(readFileSync(path.join(out, 'sales.r1', 'row.json'), 'utf8'));
  assert.equal(again.attempts, 2);
  assert.ok(again.settledUsd > faultRow.settledUsd);
  const s = LR.summarize({ tasks, rows: second.rows, K: 3 });
  assert.ok(Math.abs(s.settledUsd - ledger.spent) < 1e-9, `${s.settledUsd} vs ledger ${ledger.spent}`);
});

// ---------------------------------------------------------------------------------------------------------------
// B M1: the P1 analysis is fixed in code before any P1 run

test('rr17 B M1: look2-analysis reads only sidecar-carrying repo copies; confirmatory v2 vs A0 by the plan; exact McNemar descriptive; sensitivity without the exposed tasks; faults are never scored', { timeout: 120_000, skip: !existsSync(path.join(REPO, 'research/automationbench-20261014/SEQUENTIAL-PLAN-v1.json')) && 'plan missing' }, async () => {
  const S = await import('../sequential.mjs');
  const A = await import('../replay/look2-analysis.mjs');
  const plan = S.readPlan(path.join(REPO, A.PLAN_REL));
  const tasks = plan.looks[1].tasks;
  const root = tmp('look2');
  // Synthetic outcomes (names only): v2 passes the first 20 tasks, v1 the first 12, A0 the first 8.
  const passes = { A0: 8, v1: 12, v2: 20, 'v1-M': 10, 'v2-M': 16 };
  const make = (key, { fault = null } = {}) => {
    const a = A.ARMS.find(x => x.key === key), dir = path.join(root, a.runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'results.jsonl'), tasks.map((t, i) => JSON.stringify({ task: t, forks: [t === fault ? { sessionError: 'MODEL_RATE_LIMIT', harnessError: null, skipped: false, deferred: true } : {}], final: { task_completed_correctly: i < passes[key] ? 1 : 0, partial_credit: i < passes[key] ? 1 : 0.25 } })).join('\n') + '\n');
    writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ tasks, n: 60, cost: { spentUsd: key === 'v2' ? 1.8 : 2.1 }, tokens: { byModel: {} } }));
    writeFileSync(path.join(dir, 'sequential-look.json'), JSON.stringify(S.lookSidecar(plan, 2, { role: a.role, arm: a.arm, firstLook: a.role === 'treatment' ? a.firstLook : null, runId: a.runId, live: dir, out: dir })));
    return dir;
  };
  const dirs = Object.fromEntries(['A0', 'v1', 'v2', 'v1-M', 'v2-M'].map(k => [k, make(k)]));
  const r = A.analyze({ plan, dirs, S });
  assert.deepEqual(r.absent, []);
  assert.equal(r.t3, undefined);
  const row = r.confirmatory.rows[0];
  assert.equal(row.look, 2);
  assert.deepEqual([row.strict.treatment, row.strict.control, row.strict.b, row.strict.c], [20, 8, 12, 0]);
  assert.equal(row.nominal.strict.toFixed(4), '0.0180');
  const vv = r.descriptive.find(d => d.a === 'v2' && d.b === 'v1');
  assert.deepEqual([vv.all.a, vv.all.b, vv.all.aOnly, vv.all.bOnly], [20, 12, 8, 0]);
  assert.ok(Math.abs(vv.all.p - 2 * 0.5 ** 8) < 1e-12);                             // exact two-sided McNemar, 8:0
  assert.equal(vv.sensitivity.n, 54);
  assert.equal(r.gate.strictDiff, 8); assert.equal(r.gate.strictOk, true); assert.equal(r.gate.costPerTask.ok, true);
  // A sidecar for another arm name, or a run without a sidecar, is refused; a fault row leaves the comparison incomplete.
  const wrong = make('v2'); writeFileSync(path.join(wrong, 'sequential-look.json'), JSON.stringify(S.lookSidecar(plan, 2, { role: 'treatment', arm: 'A1-C v3', firstLook: 2, runId: 'x', live: wrong, out: wrong })));
  assert.throws(() => A.analyze({ plan, dirs: { ...dirs, v2: wrong }, S }), /names arm "A1-C v3"/);
  const bare = path.join(root, 'bare'); mkdirSync(bare); copyFileSync(path.join(dirs.v1, 'results.jsonl'), path.join(bare, 'results.jsonl')); copyFileSync(path.join(dirs.v1, 'summary.json'), path.join(bare, 'summary.json'));
  assert.throws(() => A.analyze({ plan, dirs: { ...dirs, v1: bare }, S }), /no sequential-look\.json/);
  rmSync(path.join(root, 'a1c-v2-look2'), { recursive: true });
  const faulted = make('v2', { fault: tasks[5] });
  const rf = A.analyze({ plan, dirs: { ...dirs, v2: faulted }, S });
  assert.equal(rf.confirmatory.incomplete, true);
  assert.equal(rf.descriptive.find(d => d.a === 'v2' && d.b === 'v1').all.incomplete, true);
});
