// Unit tests for harness/v3 (ATTACK §6 Move 2): the effect registry (entity identity, never the caller's key) and the
// commit gate (P prohibitions of Δ*, K duplicates, O unexplained writes, certificates, settle). Synthetic calls only.
//   nice -n 15 node --test --test-concurrency=1 experiments/autobench/harness/v3/gate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EFFECTS_SHA256, callFacts, createRegistry, decodeRaw, identityOf, identityOfV1, identityOfCreated, isWrite, routeOf } from './registry.mjs';
import { READ_TOOLS, createGate, gateRules, violationsOf, witnessHolds, writeSucceeded } from './gate.mjs';
import { buildDstar } from '../../verifier/requirement-ledger-v3/dstar.mjs';
import { universesFromInventory } from '../../verifier/requirement-ledger-v3/universe.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---- synthetic calls in the stored api_fetch shape
const raw = ({ to, subject, body, cc = null }) => Buffer.from(`To: ${to}\r\n${cc ? `Cc: ${cc}\r\n` : ''}Subject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`, 'utf8').toString('base64url');
const fetchCall = (method, url, body = null) => ({ name: 'api_fetch', arguments: JSON.stringify({ method, url, params: null, body: body === null ? null : typeof body === 'string' ? body : JSON.stringify(body) }) });
const GMAIL_SEND = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const email = (m, extra = {}) => fetchCall('POST', GMAIL_SEND, { raw: raw(m), ...extra });
const slack = (channel, text, extra = {}) => fetchCall('POST', 'https://slack.com/api/chat.postMessage', { channel, text, ...extra });

// ---- a Δ* from a synthetic world (the same fixture shape as rl3.test.mjs)
const SS = 'ss_v', WS = 'ws_vendors';
const rowRec = (row, cells) => ({ ptr: `google_sheets:row:${SS}/${WS}#${row}`, app: 'google_sheets', kind: 'row', id: `${SS}/${WS}#${row}`, data: { spreadsheet: 'Vendors', spreadsheetId: SS, worksheet: 'Active Vendors', row, ...cells } });
const universes = () => universesFromInventory({ records: [
  rowRec(2, { Vendor: 'Acme Supplies Inc', Status: 'Active', Email: 'ap@acme.test' }),
  rowRec(3, { Vendor: 'Globex Corp', Status: 'On Hold', Email: 'billing@globex.test' }),
  rowRec(4, { Vendor: 'Initech LLC', Status: 'Active', Email: 'pay@initech.test' }),
] });
const VENDORS = `google_sheets.row[${SS}/${WS}]`;
// O1: one summary e-mail to the owner about the active vendors (aggregate); O2: a per-vendor reminder to each active vendor
const dstar = () => buildDstar({ request: { user: 'Email owner@corp.test a summary of the active vendors and remind each active vendor.' }, universes: universes(), readers: [{ reader: 'r1', obligations: [
  { id: 'O1', effect: 'send_email', app: 'gmail', target: { emails: ['owner@corp.test'] }, selections: [{ universe: VENDORS, where: `"Status" = 'Active'` }] },
  { id: 'O2', effect: 'send_email', app: 'gmail', target: {}, selections: [{ universe: VENDORS, where: `"Status" = 'Active'`, perItem: true }] },
] }] });

test('registry: routes, MIME decoding and facts of a send', () => {
  assert.match(EFFECTS_SHA256, /^[0-9a-f]{64}$/);
  assert.equal(createHash('sha256').update(readFileSync(path.join(HERE, 'effects.json'))).digest('hex'), EFFECTS_SHA256);
  assert.equal(routeOf('POST', GMAIL_SEND).op, 'gmail.users.messages.send');
  const m = decodeRaw(raw({ to: 'Owner <owner@corp.test>', cc: 'a@x.test', subject: 'Hi', body: 'Body text' }));
  assert.deepEqual([m.to, m.cc, m.subject, m.text.trim()], [['owner@corp.test'], ['a@x.test'], 'Hi', 'Body text']);
  const f = callFacts(email({ to: 'owner@corp.test', subject: 'Vendor summary', body: 'Acme and Initech' }));
  assert.deepEqual([f.op, f.effect, f.channelKind, f.recipients], ['gmail.users.messages.send', 'send', 'email', ['owner@corp.test']]);
  assert.ok(isWrite(f));
  assert.equal(isWrite(callFacts(fetchCall('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages'))), false);
  assert.equal(callFacts(fetchCall('POST', GMAIL_SEND, { raw: '%%%not base64%%%' })), null, 'an undecodable message is not guessed at');
});

test('registry: identity is the entity, never the caller\'s key', () => {
  const a = callFacts(slack('C1', 'Daily report: 3 items', { idempotency_key: 'k-1', client_request_id: 'r-1' }));
  const b = callFacts(slack('C1', 'Daily report: 3 items', { idempotency_key: 'k-2', client_request_id: 'r-2' }));
  const c = callFacts(slack('C1', 'Daily report: 4 items', { idempotency_key: 'k-1' }));
  assert.equal(identityOf(a), identityOf(b), 'different caller keys, same effect: one key');
  assert.notEqual(identityOf(a), identityOf(c), 'same caller key, different effect: two keys');
  const e1 = callFacts(email({ to: 'owner@corp.test', subject: 'Vendor summary', body: 'x' }));
  const e2 = callFacts(email({ to: 'OWNER@corp.test', subject: '  vendor   SUMMARY ', body: 'y' }));
  assert.equal(identityOf(e1), identityOf(e2), 'e-mail identity: recipients and normalised subject');
  // the created-record key space agrees with the call key space for the same e-mail
  assert.equal(identityOfCreated({ app: 'gmail', coll: 'messages', record: { to: ['owner@corp.test'], subject: 'Vendor Summary' } }), identityOf(e1));
  const R = createRegistry();
  R.record('k'); R.record('k');
  assert.equal(R.entries.get('k').count, 2);
  R.forget('k'); R.forget('k');
  assert.equal(R.seen('k'), false);
});

test('registry identity v2: a nested reference\'s name is not the entity\'s name; structured attributes separate creates', () => {
  const JIRA = 'https://acme.atlassian.net/rest/api/3/issue';
  const issue = (summary, description) => callFacts(fetchCall('POST', JIRA, { fields: { project: { key: 'SUP' }, issuetype: { name: 'Bug' }, summary, priority: { name: 'High' }, description } }));
  const long = t => `${t} ${'Steps to reproduce, environment, expected and actual behaviour follow in full. '.repeat(2)}`;
  const a = issue('Dashboard crashes on export (c1)', long('First report.')), b = issue('Mobile login broken (c9)', long('Second report.'));
  assert.equal(a.name, 'Dashboard crashes on export (c1)');
  assert.equal(identityOfV1(a), identityOfV1(b), 'v1 keyed both issues by the issue type: a false duplicate');
  assert.notEqual(identityOf(a), identityOf(b));
  assert.equal(identityOf(issue('Dashboard crashes on export (c1)', long('The same problem, reworded at length.'))), identityOf(a), 'a reworded re-send is the same issue');
  const ev = c => callFacts(fetchCall('POST', 'https://api.helpcrunch.com/v1/events', { name: 'bridged', customer: c }));
  assert.notEqual(identityOf(ev('br_1')), identityOf(ev('br_2')), 'one event name, two customers: two effects');
  assert.equal(identityOf(ev('br_1')), identityOf(ev('br_1')));
});

test('gate identity: a message is keyed by the members it is about (per-item messages under one subject are distinct)', () => {
  const g = createGate({ dstar: dstar(), universes: universes() });
  const req = who => email({ to: 'owner@corp.test', subject: 'Approval request', body: `Please approve the adjustment for ${who}.` });
  assert.equal(g.check(req('Acme Supplies Inc')).action, 'admit');
  assert.equal(g.check(req('Initech LLC')).action, 'admit', 'about another member: not a duplicate');
  const again = g.check(email({ to: 'owner@corp.test', subject: 'Approval request', body: 'Reminder: approve the change for Acme Supplies Inc, as requested earlier.' }));
  assert.deepEqual([again.action, again.duplicate], ['refuse', true], 'a reworded re-send about the same member is');
  // without universes the key is recipient + subject only (the first replay's behaviour)
  const g0 = createGate({ dstar: dstar() });
  g0.check(req('Acme Supplies Inc'));
  assert.equal(g0.check(req('Initech LLC')).duplicate, true);
});

test('gate: rules come only from HARD prohibitions of Δ*; obligations become expectations', () => {
  const D = dstar();
  const rules = gateRules(D);
  assert.ok(rules.prohibit.some(r => r.kind === 'mention' && r.target.email === 'owner@corp.test' && r.lits.includes('globex')));
  assert.ok(rules.prohibit.some(r => r.kind === 'recipient' && r.email === 'billing@globex.test'));
  assert.ok(rules.expect.some(e => e.kind === 'recipient' && e.email === 'owner@corp.test'));
  // a soft prohibition never refuses
  const soft = { assertions: [{ id: 's', polarity: 'must_not', status: 'soft', check: { type: 'msg_none', params: { target: { email: 'x@y.test' } } } }] };
  assert.equal(gateRules(soft).prohibit.length, 0);
  assert.equal(violationsOf(callFacts(email({ to: 'x@y.test', subject: 's', body: 'b' })), gateRules(soft)).length, 0);
});

test('gate: admit with a certificate, refuse P (mention and recipient), refuse K duplicates, report unexplained writes', () => {
  const g = createGate({ dstar: dstar(), holdUnexplained: false });
  const ok = g.check(email({ to: 'owner@corp.test', subject: 'Vendor summary', body: 'Active: Acme Supplies, Initech.' }));
  assert.equal(ok.action, 'admit');
  assert.ok(ok.discharges.length > 0);
  assert.equal(ok.unexplained, false);
  assert.deepEqual([ok.certificate.witness.recipients, ok.certificate.witness.status], [['owner@corp.test'], 'pending']);
  const dup = g.check(email({ to: 'owner@corp.test', subject: 'Vendor summary', body: 'Active: Acme Supplies, Initech.' }, { idempotency_key: 'retry-2' }));
  assert.deepEqual([dup.action, dup.duplicate, dup.violations.length], ['refuse', true, 0]);
  const leak = g.check(email({ to: 'owner@corp.test', subject: 'Vendor summary v2', body: 'Active: Acme, Initech. Globex is on hold.' }));
  assert.equal(leak.action, 'refuse');
  assert.match(leak.violations[0].why, /names "globex/);
  const banned = g.check(email({ to: 'billing@globex.test', subject: 'Reminder', body: 'Please pay.' }));
  assert.equal(banned.action, 'refuse');
  assert.match(banned.violations.map(v => v.why).join(' '), /a message to billing@globex\.test/);
  // the summary's ban is on the summary's target: a reminder to another recipient may name the held vendor
  assert.equal(g.check(email({ to: 'ap@acme.test', subject: 'Reminder (cc Globex account)', body: 'Please pay; Globex Corp is handled separately.' })).action, 'admit');
  const remind = g.check(email({ to: 'ap@acme.test', subject: 'Reminder', body: 'Please pay.' }));
  assert.equal(remind.action, 'admit', 'a per-item obligation to an included member');
  // a refused write is not recorded: the identical call is refused again by the rule, not by a counter
  assert.equal(g.check(email({ to: 'billing@globex.test', subject: 'Reminder', body: 'Please pay.' })).duplicate, false);
  const stray = g.check(slack('C9', 'FYI: vendor run done'));
  assert.deepEqual([stray.action, stray.unexplained], ['admit', true]);
  const held = createGate({ dstar: dstar() }).check(slack('C9', 'FYI: vendor run done'));
  assert.equal(held.action, 'hold', 'by default an unexplained write is held (ATTACK Move 2)');
  assert.equal(g.check(fetchCall('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages')).action, 'read');
  assert.deepEqual([g.check(fetchCall('POST', GMAIL_SEND, { raw: '%%%' })).action, g.check(fetchCall('POST', GMAIL_SEND, { raw: '%%%' })).undecodable], ['hold', true]);
});

test('gate (review finding 10): fail closed: unknown tools, unparseable arguments, a body without a method and undecodable writes are held', () => {
  const g = createGate({ dstar: dstar(), holdUnexplained: false });
  const send = { method: 'POST', url: 'https://slack.com/api/chat.postMessage', body: JSON.stringify({ channel: 'C9', text: 'Globex Corp is on hold' }) };
  // the reviewer's probes: an object argument, malformed JSON and a missing method all read as "read" before
  assert.equal(g.check({ name: 'api_fetch', arguments: send }).action, 'admit', 'an object argument is decoded like a JSON string');
  assert.equal(g.check({ name: 'api_fetch', arguments: '{"method": "POST", "url": ' }).action, 'hold');
  assert.equal(g.check({ name: 'api_fetch', arguments: JSON.stringify({ url: send.url, body: send.body }) }).action, 'hold');
  assert.equal(g.check({ name: 'api_fetch', arguments: JSON.stringify({ method: 'DELETE', url: 'not a url' }) }).action, 'hold');
  assert.equal(g.check({ name: 'send_slack_message', arguments: JSON.stringify({ channel: 'C9', text: 'hi' }) }).action, 'hold', 'a tool the gate does not know may write');
  for (const t of READ_TOOLS) assert.equal(g.check({ name: t, arguments: '{"query": "x"}' }).action, 'read');
  assert.equal(g.check({ name: 'api_fetch', arguments: JSON.stringify({ url: 'https://slack.com/api/conversations.list' }) }).action, 'read', 'no method and no body: the tool default, GET');
  // a sheet-row ban that no call-level rule enforces is listed and travels with every write of its app
  const D = { assertions: [{ id: 'B1', polarity: 'must_not', status: 'hard', origin: 'closure', check: { type: 'rec_unchanged', params: { ptr: 'google_sheets:row:ss/ws#4', scope: 'any' } } }] };
  const rules = gateRules(D);
  assert.deepEqual([rules.prohibit.length, rules.unenforced.length, rules.unenforced[0].app], [0, 1, 'google_sheets']);
  const sheets = createGate({ dstar: D, holdUnexplained: false }).check(fetchCall('PUT', 'https://sheets.googleapis.com/v4/spreadsheets/ss/values/ws!A4:C4', { values: [['x']] }));
  assert.deepEqual(sheets.unverified, ['B1']);
});

test('gate (review finding 11): a certificate\'s witness is a read-back spec, confirmed only by the world\'s own changes', () => {
  const g = createGate({ dstar: dstar(), holdUnexplained: false });
  const d = g.check(email({ to: 'owner@corp.test', subject: 'Vendor summary', body: 'Acme, Initech' }));
  const w = d.certificate.witness;
  assert.equal(witnessHolds(w, { changes: [{ op: 'created', app: 'gmail', coll: 'messages', id: 'n1', record: { to: ['owner@corp.test'], subject: 'Vendor summary' } }] }), true);
  assert.equal(witnessHolds(w, { changes: [{ op: 'created', app: 'gmail', coll: 'messages', id: 'n1', record: { to: ['someone@else.test'] } }] }), false, 'a message to someone else is not the witness');
  assert.equal(witnessHolds(w, { changes: [] }), false, 'the tool said ok, the world shows nothing: no witness');
  const u = g.check(fetchCall('PATCH', 'https://api.hubapi.com/crm/v3/objects/contacts/501', { properties: { lifecyclestage: 'customer' } }));
  assert.equal(u.action, 'admit');
  assert.equal(witnessHolds(u.certificate.witness, { changes: [{ op: 'updated', app: u.facts.app, coll: 'contacts', id: '501', fields: {} }] }), true);
  assert.equal(witnessHolds(u.certificate.witness, { changes: [{ op: 'updated', app: u.facts.app, coll: 'contacts', id: '999', fields: {} }] }), false);
});

test('gate: a failed write releases its key (the effect did not happen); a successful one keeps it', () => {
  const g = createGate({ dstar: dstar() });
  const call = email({ to: 'owner@corp.test', subject: 'Vendor summary', body: 'Acme, Initech' });
  const d1 = g.check(call);
  g.settle(d1, writeSucceeded({ content: JSON.stringify({ error: { code: 500, message: 'backend' } }) }));
  const d2 = g.check(call);
  assert.equal(d2.action, 'admit', 'the retry of a failed send is not a duplicate');
  g.settle(d2, writeSucceeded({ content: JSON.stringify({ id: 'm-1', threadId: 't-1' }) }));
  assert.equal(g.check(call).action, 'refuse', 'the resend of a delivered message is');
  assert.deepEqual([writeSucceeded('{"ok": false}'), writeSucceeded('{"status": 404}'), writeSucceeded('Error: not found'), writeSucceeded('{"ok": true}')], [false, false, false, true]);
});

test('gate: the decision is a pure function of Δ*, the registry and the call (no plan, brief or self-report input)', () => {
  assert.equal(createGate.length, 0);
  const g1 = createGate({ dstar: dstar() }), g2 = createGate({ dstar: dstar() });
  const call = email({ to: 'owner@corp.test', subject: 'S', body: 'Globex' });
  const a = g1.check(call), b = g2.check(call);
  assert.deepEqual([a.action, a.key, a.violations.map(v => v.why)], [b.action, b.key, b.violations.map(v => v.why)]);
});
