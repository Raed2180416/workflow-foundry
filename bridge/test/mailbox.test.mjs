import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { publicKeyPem } from '../common/protocol.mjs';
import { ENDPOINT_SCHEMA, Mailbox, buildEndpoint, initMailbox, parseEndpoint, runGit, validEndpointUrl } from '../mailbox.mjs';
import { discover } from '../cloud/client.mjs';
import { discoverTunnelUrl, lastQuickTunnelUrl } from '../laptop/tunnel.mjs';
import { scratch, signed, startDaemon, testConfig, testKey, waitFor } from './helpers.mjs';

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = async (args, cwd) => { const r = await runGit(args, { cwd, env: ENV }); assert.equal(r.code, 0, r.stderr); return r.stdout.trim(); };

async function bareRepo(t) {
  const root = scratch(t, 'git');
  const remote = path.join(root, 'remote.git');
  await git(['init', '--quiet', '--bare', remote], root);
  // a normal main branch, so the mailbox must be an orphan next to it
  const work = path.join(root, 'main');
  await git(['init', '--quiet', work], root);
  fs.writeFileSync(path.join(work, 'README.md'), 'main\n');
  await git(['add', '.'], work);
  await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'main'], work);
  await git(['push', '--quiet', remote, 'HEAD:refs/heads/main'], work);
  return { root, remote };
}

const NOW = Date.parse('2026-10-07T12:00:00Z');

test('endpoint.json: build and parse, staleness, URL rules', () => {
  const ep = buildEndpoint({ url: 'https://abc-def.trycloudflare.com', daemonVersion: '0.1.0', startedAt: '2026-10-07T11:00:00Z', heartbeatAt: '2026-10-07T11:50:00Z', gpu: { name: 'RTX 4060', memoryTotalMiB: 8188, driver: '581', cuda: '13.0', extra: 'dropped' }, services: [{ id: 'j-1', kind: 'kev.serve', name: null, state: 'running', port: 8008 }], tunnelSource: 'cloudflared-log' });
  assert.equal(ep.schema, ENDPOINT_SCHEMA);
  assert.deepEqual(Object.keys(ep.gpu), ['name', 'memoryTotalMiB', 'driver', 'cuda']);
  assert.deepEqual(ep.services, [{ id: 'j-1', kind: 'kev.serve', name: null, state: 'running' }], 'no ports or paths are published');
  let p = parseEndpoint(JSON.stringify(ep), { now: NOW });
  assert.equal(p.ok, true); assert.equal(p.url, 'https://abc-def.trycloudflare.com'); assert.equal(p.ageMs, 10 * 60_000); assert.equal(p.stale, false);
  p = parseEndpoint(ep, { now: NOW + 3600_000 });
  assert.equal(p.stale, true);
  assert.equal(parseEndpoint('nope').ok, false);
  assert.equal(parseEndpoint({ ...ep, url: 'http://abc.trycloudflare.com' }, { now: NOW }).ok, false);
  assert.equal(parseEndpoint({ ...ep, url: 'https://abc.trycloudflare.com/path' }, { now: NOW }).ok, false);
  assert.equal(parseEndpoint({ ...ep, url: 'https://user@abc.trycloudflare.com' }, { now: NOW }).ok, false);
  assert.equal(parseEndpoint({ ...ep, url: 'http://127.0.0.1:8765' }, { now: NOW }).ok, false);
  assert.equal(parseEndpoint({ ...ep, url: 'http://127.0.0.1:8765' }, { now: NOW, allowHttpLocal: true }).ok, true);
  assert.match(parseEndpoint({ ...ep, url: null }, { now: NOW }).errors.join(), /no tunnel URL/);
  assert.match(parseEndpoint({ ...ep, url: null, state: 'stopped' }, { now: NOW }).errors.join(), /stopped/);
  assert.equal(parseEndpoint({ ...ep, heartbeatAt: 'never' }, { now: NOW }).ok, false);
  assert.equal(parseEndpoint({ ...ep, schema: 'other' }, { now: NOW }).ok, false);
  assert.ok(validEndpointUrl('https://a-b.trycloudflare.com/')); assert.ok(!validEndpointUrl('https://a b.com'));
});

test('quick-tunnel URL discovery from flag, metrics and log', async t => {
  assert.equal(lastQuickTunnelUrl('Requesting new quick Tunnel on https://api.trycloudflare.com...\n|  https://old-one.trycloudflare.com  |\nlater |  https://new-two.trycloudflare.com |'), 'https://new-two.trycloudflare.com');
  assert.equal(lastQuickTunnelUrl('https://api.trycloudflare.com only'), null);
  const root = scratch(t, 'tunnel');
  const log = path.join(root, 'cloudflared.log');
  fs.writeFileSync(log, '2026-10-07T12:00:00Z INF |  https://seven-words-go-here.trycloudflare.com  |\n');
  assert.deepEqual(await discoverTunnelUrl({ log }), { url: 'https://seven-words-go-here.trycloudflare.com', source: 'cloudflared-log' });
  assert.deepEqual(await discoverTunnelUrl({ publicUrl: 'https://named.example.com/', log }), { url: 'https://named.example.com', source: 'flag' });
  const metrics = http.createServer((req, res) => { res.end(req.url === '/quicktunnel' ? JSON.stringify({ hostname: 'from-metrics.trycloudflare.com' }) : '404'); });
  await new Promise(r => metrics.listen(0, '127.0.0.1', r));
  t.after(() => metrics.close());
  assert.deepEqual(await discoverTunnelUrl({ metrics: `http://127.0.0.1:${metrics.address().port}`, log }), { url: 'https://from-metrics.trycloudflare.com', source: 'cloudflared-metrics' });
  assert.deepEqual(await discoverTunnelUrl({ metrics: 'http://127.0.0.1:1', log }), { url: 'https://seven-words-go-here.trycloudflare.com', source: 'cloudflared-log' }, 'falls back to the log');
  assert.deepEqual(await discoverTunnelUrl({ log: path.join(root, 'missing.log') }), { url: null, source: null });
});

test('initMailbox creates an orphan branch with only bridge-state/, idempotently', async t => {
  const { root, remote } = await bareRepo(t);
  const k1 = testKey(), k2 = testKey();
  const r1 = await initMailbox({ remote, keys: [{ label: 'cloud', pem: publicKeyPem(k1.publicKey) }], scratch: root, env: ENV });
  assert.equal(r1.created, true); assert.equal(r1.pushed, true);
  const clone = path.join(root, 'inspect');
  await git(['clone', '--quiet', '--branch', 'foundry-bridge', remote, clone], root);
  assert.deepEqual((await git(['ls-files'], clone)).split('\n').sort(), ['bridge-state/README.md', `bridge-state/keys/cloud-${k1.keyId}.pub`]);
  assert.equal(await git(['rev-list', '--count', 'HEAD'], clone), '1');
  assert.equal(await git(['log', '--format=%P', '-1'], clone), '', 'orphan: no parent');
  const main = await git(['ls-remote', remote, 'refs/heads/main'], root);
  assert.ok(main.length > 0, 'main untouched');
  const again = await initMailbox({ remote, keys: [{ label: 'cloud', pem: publicKeyPem(k1.publicKey) }], scratch: root, env: ENV });
  assert.equal(again.created, false); assert.equal(again.pushed, false);
  const add = await initMailbox({ remote, keys: [{ label: 'second', pem: publicKeyPem(k2.publicKey) }], scratch: root, env: ENV });
  assert.equal(add.pushed, true);
  const dry = await initMailbox({ remote, keys: [{ label: 'x', pem: publicKeyPem(testKey().publicKey) }], scratch: root, env: ENV, dryRun: true });
  assert.equal(dry.exists, true); assert.equal(dry.pushed, false);
  assert.deepEqual(fs.readdirSync(root).filter(n => n.startsWith('mailbox-')), [], 'scratch clones are removed');
});

test('Mailbox: publish, keys, revoke, kill; cloud discover() reads it', async t => {
  const { root, remote } = await bareRepo(t);
  const k = testKey();
  await initMailbox({ remote, keys: [{ label: 'cloud', pem: publicKeyPem(k.publicKey) }], scratch: root, env: ENV });
  const laptop = new Mailbox({ dir: path.join(root, 'laptop-mb'), remote, env: ENV });
  await laptop.refresh();
  assert.deepEqual(laptop.readKeys().keys.map(x => x.id), [k.keyId]);
  const ep = buildEndpoint({ url: 'https://abc-def.trycloudflare.com', daemonVersion: '0.1.0', startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() });
  const pub = await laptop.publishEndpoint(ep);
  assert.equal(pub.pushed, true);
  assert.equal((await laptop.publishEndpoint(ep)).pushed, false, 'identical content is not re-committed');
  const d = await discover({ mailboxDir: path.join(root, 'cloud-mb'), remote, env: ENV });
  assert.equal(d.ok, true); assert.equal(d.url, 'https://abc-def.trycloudflare.com'); assert.equal(d.stale, false);
  assert.deepEqual(d.keys, [k.keyId]); assert.equal(d.killed, false);
  const cloud = new Mailbox({ dir: path.join(root, 'cloud-mb'), remote, env: ENV });
  assert.equal((await cloud.setKill(true)).pushed, true);
  await laptop.refresh(); assert.equal(laptop.isKilled(), true);
  await cloud.setKill(false); await laptop.refresh(); assert.equal(laptop.isKilled(), false);
  assert.equal((await cloud.revokeKey(k.keyId)).pushed, true);
  await laptop.refresh(); assert.deepEqual(laptop.readKeys().keys, []);
  await assert.rejects(new Mailbox({ dir: path.join(root, 'wrong'), remote, branch: 'nope', env: ENV }).refresh(), e => e.code === 'MAILBOX_MISSING');
  await assert.rejects(new Mailbox({ dir: path.join(root, 'laptop-mb'), remote: `${remote}-other`, env: ENV }).refresh(), e => e.code === 'MAILBOX_REMOTE_MISMATCH');
});

test('a concurrent writer causes a non-fast-forward; the update re-applies on the new tip without force-pushing', async t => {
  const { root, remote } = await bareRepo(t);
  await initMailbox({ remote, keys: [], scratch: root, env: ENV });
  const a = new Mailbox({ dir: path.join(root, 'a'), remote, env: ENV });
  const b = new Mailbox({ dir: path.join(root, 'b'), remote, env: ENV });
  await a.refresh(); await b.refresh();
  let raced = false;
  const r = await b.update(async dir => {
    if (!raced) { raced = true; await a.addKey({ label: 'racer', pem: publicKeyPem(testKey().publicKey) }); }   // lands between b's fetch and push
    fs.writeFileSync(path.join(dir, 'bridge-state', 'endpoint.json'), '{"x":1}\n');
    return true;
  }, { baseDelayMs: 10 });
  assert.equal(r.pushed, true); assert.equal(r.attempts, 2);
  await a.refresh();
  assert.equal(a.readKeys().keys.length, 1, "the racer's key survived");
  assert.equal(a.readEndpointRaw(), '{"x":1}\n');
  const log = await git(['log', '--format=%s', 'foundry-bridge'], remote);
  assert.equal(log.split('\n').length, 3, 'linear history: init, racer, update');
});

test('daemon + mailbox: keys come from the branch, the tunnel URL is published, revocation and KILL apply on refresh', async t => {
  const { root, remote } = await bareRepo(t);
  const k = testKey();
  await initMailbox({ remote, keys: [{ label: 'cloud', pem: publicKeyPem(k.publicKey) }], scratch: root, env: ENV });
  const tunnelLog = path.join(root, 'cloudflared.log');
  fs.writeFileSync(tunnelLog, 'INF |  https://first-tunnel.trycloudflare.com  |\n');
  const cfg = testConfig(root, { mailbox: { enabled: true, remote, dir: path.join(root, 'laptop-mb'), refreshMinutes: 60, heartbeatMinutes: 60 }, tunnel: { metrics: null, log: tunnelLog, pollSeconds: 1 } });
  const mailbox = new Mailbox({ dir: cfg.mailbox.dir, remote, env: ENV });
  const { d, url } = await startDaemon(t, { root, config: cfg, keysDir: path.join(root, 'unused-keys'), key: k, daemonOpts: { mailbox, keysDir: null } });
  const cloudDir = path.join(root, 'cloud-mb');
  const seen = await waitFor(async () => { const x = await discover({ mailboxDir: cloudDir, remote, env: ENV }); return x.url === 'https://first-tunnel.trycloudflare.com' && x; }, { timeoutMs: 20_000, everyMs: 300, what: 'first publish' });
  assert.equal(seen.endpoint.state, 'up'); assert.equal(seen.endpoint.daemonVersion, '0.1.0');
  assert.equal((await signed(url, k, { path: '/ping' })).status, 200, 'key loaded from the mailbox');
  // the tunnel restarts with a new URL: published within a poll or two
  fs.appendFileSync(tunnelLog, 'INF |  https://second-tunnel.trycloudflare.com  |\n');
  await waitFor(async () => (await discover({ mailboxDir: cloudDir, remote, env: ENV })).url === 'https://second-tunnel.trycloudflare.com', { timeoutMs: 20_000, everyMs: 300, what: 'URL change publish' });
  // revoke through the cloud's clone; the daemon picks it up on its next refresh (here: the git.refresh job)
  const cloud = new Mailbox({ dir: cloudDir, remote, env: ENV });
  const k2 = testKey();
  await cloud.addKey({ label: 'next', pem: publicKeyPem(k2.publicKey) });
  await cloud.revokeKey(k.keyId);
  const job = (await signed(url, k, { method: 'POST', path: '/jobs', body: JSON.stringify({ kind: 'git.refresh', params: {} }) })).json;
  const done = await waitFor(async () => { const r = await signed(url, k2, { path: `/jobs/${job.id}` }); return r.status === 200 && r.json.state === 'succeeded' && r.json; }, { what: 'git.refresh' });
  assert.deepEqual(done.result.keys, [k2.keyId]);
  assert.equal((await signed(url, k, { path: '/ping' })).json.reason, 'unknown_key');
  await cloud.setKill(true);
  await d.refresh();
  assert.equal((await signed(url, k2, { path: '/ping' })).status, 403);
  await cloud.setKill(false);
  await d.refresh();
  assert.equal((await signed(url, k2, { path: '/ping' })).status, 200);
  const info = (await signed(url, k2, { path: '/info' })).json;
  assert.equal(info.keys.source, 'mailbox'); assert.equal(info.tunnel.url, 'https://second-tunnel.trycloudflare.com');
  // on shutdown the daemon publishes state=stopped with no URL
  await d.close();
  const after = await discover({ mailboxDir: cloudDir, remote, env: ENV });
  assert.equal(after.state, 'stopped'); assert.equal(after.url, null);
});
