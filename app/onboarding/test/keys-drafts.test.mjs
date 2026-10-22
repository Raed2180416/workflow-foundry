// Keys go to the keychain or nowhere; drafts are files the person sends; the IT brief, the evidence bundle, the doctor's detection and
// the n8n import report. nice -n 15 node --test app/onboarding/test/keys-drafts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Keychain, detectBackend } from '../keychain.mjs';
import { Keys, providerBaseUrl } from '../keys.mjs';
import { eml, mailto, listDrafts, draft } from '../drafts.mjs';
import { detect, admission, managedDirs } from '../detect.mjs';
import { briefData, briefMarkdown, briefHtml, SAME_USER_LIMIT } from '../brief.mjs';
import { evidenceBundle } from '../evidence.mjs';
import { Batches, listDigest } from '../batch.mjs';
import { importReport } from '../importers.mjs';
import { connectInstructions } from '../../cli.mjs';
import { withApp, invoiceFlowOn, liveInvoices, fixture, FIXTURES, NOW } from './helpers.mjs';

const CANARY = 'CANARY-k3y-0000-1111-2222-zzzz';
async function fakeProvider(validKey) {
  const seen = [];
  const server = createServer((req, res) => { seen.push(req.headers.authorization); const ok = req.headers.authorization === `Bearer ${validKey}`; res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' }); res.end(JSON.stringify(ok ? { data: [{ id: 'mercury-3' }] } : { error: 'no' })); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}/v1`, seen, close: () => new Promise(r => server.close(r)) };
}

test('no keychain: the key is refused and written nowhere; FOUNDRY_KEYCHAIN chooses the backend', async () => withApp(async (app, dir) => {
  assert.equal(detectBackend({ env: { FOUNDRY_KEYCHAIN: 'none' } }), 'none');
  assert.equal(detectBackend({ env: { FOUNDRY_KEYCHAIN: 'ephemeral' } }), 'ephemeral');
  assert.equal(detectBackend({ env: { PATH: '' }, os: 'linux' }), 'none', 'headless Linux without a Secret Service: no keychain');
  const keys = new Keys({ root: dir, keychain: new Keychain({ backend: 'none' }) });
  await assert.rejects(keys.save('inception', CANARY), { code: 'KEYCHAIN_NONE' });
  const all = readdirSync(dir, { recursive: true }).filter(f => !f.endsWith('.sqlite') && !f.includes('sqlite')).map(f => path.join(dir, f)).filter(f => { try { return readFileSync(f).length >= 0; } catch { return false; } });
  assert.ok(all.every(f => !readFileSync(f, 'utf8').includes(CANARY)), 'the key is in no file');
}));

test('ephemeral keychain: check against the provider, store, report last four only, remove', async () => withApp(async (_app, dir) => {
  const fake = await fakeProvider(CANARY);
  try {
    const keys = new Keys({ root: dir, keychain: new Keychain({ backend: 'ephemeral' }), checkBaseUrl: fake.base });
    await assert.rejects(keys.save('inception', 'short'), { code: 'KEY_SHAPE' });
    await assert.rejects(keys.save('inception', 'WRONG-key-0000-1111-2222'), { code: 'KEY_REJECTED' });
    await assert.rejects(keys.save('anthropic', CANARY), { code: 'KEY_PLANNED' });
    const r = await keys.save('inception', CANARY);
    assert.deepEqual([r.saved, r.last4, r.backend], [true, 'zzzz', 'ephemeral']);
    assert.equal(JSON.stringify(keys.status()).includes(CANARY), false, 'status never carries the key');
    assert.equal(readFileSync(path.join(dir, 'keys.json'), 'utf8').includes(CANARY), false, 'the reference file holds no key');
    assert.equal(keys.keychain.get('inception'), CANARY);
    keys.remove('inception');
    assert.equal(keys.keychain.get('inception'), null);
    assert.throws(() => providerBaseUrl('inception', { override: 'https://evil.example/v1' }), { code: 'KEY_CHECK_URL' });
    assert.equal(providerBaseUrl('inception'), 'https://api.inceptionlabs.ai/v1', 'the real check URL comes from the owner policy');
  } finally { await fake.close(); }
}));

test('drafts: an unsent .eml (X-Unsent: 1) and a mailto link; long drafts are offered as a download', async () => withApp(async app => {
  const p = await invoiceFlowOn(app); liveInvoices(app);
  const b = new Batches(app, { now: () => NOW });
  { const list = await b.preview(p.flowId); await b.approve(list.batchId, { listDigest: listDigest(list) }); }
  const list = listDrafts(app);
  assert.equal(list.length, 4);
  const d = draft(app, list[0].id);
  const lines = d.eml.split('\r\n');
  assert.equal(lines[0], 'X-Unsent: 1'); assert.equal(lines[1], `To: ${d.to}`); assert.equal(lines[2], `Subject: ${d.subject}`);
  assert.equal(Buffer.from(d.eml.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8'), d.body.replace(/\n/g, '\r\n'));
  assert.match(mailto({ to: 'a@b.example', subject: 'Hi there', body: 'x' }), /^mailto:a@b\.example\?subject=Hi%20there&body=x$/);
  assert.equal(mailto({ to: 'a@b.example', subject: 's', body: 'x'.repeat(3000) }), null);
  assert.match(eml({ to: 'a@b.example\r\nBcc: evil@x.example', subject: 'Grüße', body: 'x' }), /To: a@b\.example Bcc: evil@x\.example\r\nSubject: =\?UTF-8\?B\?/, 'no header injection; non-ASCII subjects are encoded');
  assert.throws(() => draft(app, '../../etc/passwd'), { code: 'NOT_FOUND' });
}));

test('doctor detection: managed Claude Code policy by stat; with consent, would Foundry\'s exact command be admitted', async () => {
  const argv = ['/usr/bin/node', '/x/app/cli.mjs', 'mcp', '--dashboard', '--workspace', '/home/u/.foundry'];
  const env = { PATH: '', FOUNDRY_MANAGED_DIR: path.join(FIXTURES, 'managed', 'etc-claude-code'), FOUNDRY_HOME_DIR: '/nonexistent-home' };
  const quiet = await detect({ env, argv, port: 0 });
  assert.equal(quiet.managed.present, true); assert.equal(quiet.managed.admission, undefined, 'without consent nothing is parsed');
  const d = await detect({ env, argv, consent: true, port: 0 });
  assert.equal(d.managed.admission.admitted, 'no', 'an allowlist that does not list the exact command keeps Foundry out');
  assert.deepEqual(managedDirs({ env: {}, os: 'darwin' }), ['/Library/Application Support/ClaudeCode']);
  assert.equal(admission({ settings: { allowedMcpServers: [{ serverCommand: argv }] } }, argv).admitted, 'yes');
  assert.equal(admission({ settings: { allowedMcpServers: [{ serverName: 'foundry' }] } }, argv).admitted, 'unknown', 'a name is not a control');
  assert.equal(admission({ settings: { allowedMcpServers: [{ serverCommand: [...argv.slice(0, -1), '/other'] }] } }, argv).admitted, 'no', 'every argument must match');
  assert.equal(admission({ mcp: { mcpServers: { foundry: { command: argv[0], args: argv.slice(1) } } } }, argv).admitted, 'yes');
  assert.deepEqual(d.envKeyNames, []);
});

test('the IT brief names the exact version, the actions, the same-user limit, pilot terms and the exact argv', async () => withApp(async (app, dir) => {
  const p = await invoiceFlowOn(app);
  const c = connectInstructions(dir);
  const b = briefData(app, { flowId: p.flowId, connect: c, date: new Date(NOW) });
  assert.equal(b.workflowHash, p.workflowHash);
  assert.deepEqual(b.serverCommand, c.allowlist.serverCommand);
  const md = briefMarkdown(b), html = briefHtml(b);
  for (const s of ['Every action', 'What it never does', 'Suggested pilot terms', 'Allowlist entry (exact)', 'The honest limit', p.workflowHash]) assert.ok(md.includes(s), s);
  assert.ok(md.includes(SAME_USER_LIMIT));
  assert.ok(html.startsWith('<!doctype html>') && !/<script/i.test(html));
  const general = briefData(app, { flowId: null, connect: c });
  assert.equal(general.workflowHash, null); assert.ok(briefMarkdown(general).includes(SAME_USER_LIMIT));
}));

test('evidence: the chain head, the turn-on decision with its channel, each action decision, the batch, the gaps', async () => withApp(async app => {
  const p = await invoiceFlowOn(app); liveInvoices(app);
  const batches = new Batches(app, { now: () => NOW });
  const list = await batches.preview(p.flowId);
  const r = await batches.approve(list.batchId, { listDigest: listDigest(list) });
  const e = evidenceBundle(app, r.runId, { batches, date: new Date(NOW) });
  assert.equal(e.chain.verified, true); assert.match(e.chain.head, /^[a-f0-9]{64}$/);
  assert.equal(e.turnedOn.channel, 'dashboard'); assert.equal(e.workflow.hash, p.workflowHash);
  assert.equal(e.actionDecisions.filter(x => x.type === 'approval.decided').length, 4);
  assert.equal(e.batch.items, 4); assert.equal(e.batch.decision.channel, 'dashboard');
  assert.ok(e.gaps.length >= 3); assert.equal(e.practice.passed, true);
}));

test('n8n import report: an honest verdict, plain reasons, a risk card that says what it read and what it inferred, nothing run', () => {
  const r = importReport(fixture('n8n-synthetic.json'));
  assert.equal(r.executed, false);
  assert.equal(r.lines.find(l => l.key === 'wrap').yes, true);
  assert.ok(r.risk.every(x => ['read', 'inferred'].includes(x.source)));
  assert.match(r.risk[0].answer, /Send thank-you/);
  assert.match(r.risk[1].answer, /^No: Send thank-you retries/);
  assert.throws(() => importReport('not json'), { code: 'IMPORT_JSON' });
  assert.ok(existsSync(path.join(FIXTURES, 'n8n-synthetic.json')));
});
