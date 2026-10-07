import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { bypassProxy, proxyFor, readAll, request } from '../cloud/transport.mjs';
import { scratch } from './helpers.mjs';

test('NO_PROXY matching: exact, suffix, wildcard, CIDR, ports', () => {
  const np = 'localhost,127.0.0.0/8,::1,.svc.cluster.local,*.internal.test,example.org,10.0.0.0/8,host.with.port:8443';
  assert.ok(bypassProxy('localhost', 80, np)); assert.ok(bypassProxy('127.0.0.1', 8765, np)); assert.ok(bypassProxy('127.9.9.9', 1, np));
  assert.ok(bypassProxy('[::1]', 80, np)); assert.ok(bypassProxy('a.svc.cluster.local', 443, np)); assert.ok(bypassProxy('x.internal.test', 443, np));
  assert.ok(bypassProxy('example.org', 443, np)); assert.ok(bypassProxy('api.example.org', 443, np)); assert.ok(bypassProxy('10.1.2.3', 443, np));
  assert.ok(bypassProxy('host.with.port', 8443, np)); assert.ok(!bypassProxy('host.with.port', 443, np));
  assert.ok(!bypassProxy('abc.trycloudflare.com', 443, np)); assert.ok(!bypassProxy('notexample.org', 443, np)); assert.ok(!bypassProxy('11.0.0.1', 443, np));
  assert.ok(bypassProxy('anything', 1, '*')); assert.ok(!bypassProxy('anything', 1, ''));
  assert.equal(proxyFor('https://abc.trycloudflare.com/x', { HTTPS_PROXY: 'http://p:1', NO_PROXY: 'localhost' }), 'http://p:1');
  assert.equal(proxyFor('https://localhost/x', { HTTPS_PROXY: 'http://p:1', NO_PROXY: 'localhost' }), null);
  assert.equal(proxyFor('http://127.0.0.1:8765/', { HTTPS_PROXY: 'http://p:1' }), null, 'plain http only uses HTTP_PROXY');
  assert.equal(proxyFor('https://x.test/', { https_proxy: 'http://lower:2' }), 'http://lower:2');
});

function makeCert(dir) {
  const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=bridge-target.test', '-addext', 'subjectAltName=DNS:bridge-target.test'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return { key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) };
}

// A CONNECT proxy that maps bridge-target.test:443 to the local HTTPS server and records requests.
async function connectProxy(t, targetPort, { deny = false, requireAuth = null } = {}) {
  const seen = [];
  const proxy = http.createServer((req, res) => { res.writeHead(405); res.end(); });
  proxy.on('connect', (req, socket) => {
    seen.push({ target: req.url, auth: req.headers['proxy-authorization'] ?? null });
    if (deny) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    if (requireAuth && req.headers['proxy-authorization'] !== requireAuth) { socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'); return; }
    if (req.url !== 'bridge-target.test:443') { socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); return; }
    const up = net.connect(targetPort, '127.0.0.1', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); up.pipe(socket); socket.pipe(up); });
    up.on('error', () => socket.destroy()); socket.on('error', () => up.destroy());
  });
  await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { proxy.closeAllConnections?.(); proxy.close(r); }));
  return { url: `http://127.0.0.1:${proxy.address().port}`, seen };
}

test('HTTPS through a CONNECT proxy, with the target certificate verified against the given CA', async t => {
  const dir = scratch(t, 'tls');
  const pair = makeCert(dir);
  if (!pair) { t.skip('openssl not available to mint a test certificate'); return; }
  const target = https.createServer(pair, (req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json', date: new Date().toUTCString() }); res.end(JSON.stringify({ method: req.method, url: req.url, host: req.headers.host, body, sig: req.headers['x-bridge-sig'] ?? null })); });
  });
  await new Promise(r => target.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { target.closeAllConnections?.(); target.close(r); }));
  const proxy = await connectProxy(t, target.address().port);
  const env = { HTTPS_PROXY: proxy.url };
  const res = await request('https://bridge-target.test/jobs?x=1', { method: 'POST', headers: { 'x-bridge-sig': 'abc' }, body: '{"a":1}', env, ca: [pair.cert] });
  assert.equal(res.status, 200);
  const j = JSON.parse((await readAll(res.body)).toString());
  assert.deepEqual(j, { method: 'POST', url: '/jobs?x=1', host: 'bridge-target.test', body: '{"a":1}', sig: 'abc' });
  assert.deepEqual(proxy.seen, [{ target: 'bridge-target.test:443', auth: null }]);
  // without the CA the certificate is rejected: TLS is verified end to end, never disabled
  await assert.rejects(request('https://bridge-target.test/', { env, ca: [] }), e => e.code === 'TLS_FAILED');
  // streamed bodies (uploads)
  const src = path.join(dir, 'up.bin'); fs.writeFileSync(src, Buffer.alloc(300_000, 9));
  const up = await request('https://bridge-target.test/files/data/up.bin', { method: 'PUT', headers: { 'content-length': '300000' }, body: fs.createReadStream(src), env, ca: [pair.cert] });
  assert.equal(JSON.parse((await readAll(up.body)).toString()).body.length, 300_000);
});

test('proxy credentials in HTTPS_PROXY are sent as Proxy-Authorization; refusals map to clear errors', async t => {
  const dir = scratch(t, 'tls2');
  const pair = makeCert(dir);
  if (!pair) { t.skip('openssl not available'); return; }
  const target = https.createServer(pair, (req, res) => res.end('ok'));
  await new Promise(r => target.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { target.closeAllConnections?.(); target.close(r); }));
  const auth = `Basic ${Buffer.from('u:p w').toString('base64')}`;
  const p1 = await connectProxy(t, target.address().port, { requireAuth: auth });
  const withCreds = p1.url.replace('http://', 'http://u:p%20w@');
  const ok = await request('https://bridge-target.test/', { env: { HTTPS_PROXY: withCreds }, ca: [pair.cert] });
  assert.equal(ok.status, 200);
  await assert.rejects(request('https://bridge-target.test/', { env: { HTTPS_PROXY: p1.url }, ca: [pair.cert] }), e => e.code === 'PROXY_DENIED' && e.status === 407);
  const p2 = await connectProxy(t, target.address().port, { deny: true });
  await assert.rejects(request('https://bridge-target.test/', { env: { HTTPS_PROXY: p2.url }, ca: [pair.cert] }), e => e.code === 'PROXY_DENIED' && e.status === 403);
  await assert.rejects(request('https://bridge-target.test/', { env: { HTTPS_PROXY: 'http://127.0.0.1:1' }, ca: [pair.cert], timeoutMs: 3000 }), e => e.code === 'PROXY_UNREACHABLE');
});

test('loopback http goes direct; timeouts and aborts surface as typed errors', async t => {
  const slow = http.createServer((req, res) => { if (req.url === '/slow') return; res.end('fast'); });
  await new Promise(r => slow.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { slow.closeAllConnections?.(); slow.close(r); }));
  const base = `http://127.0.0.1:${slow.address().port}`;
  const env = { HTTPS_PROXY: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1' };
  const r = await request(`${base}/`, { env });
  assert.equal((await readAll(r.body)).toString(), 'fast');
  await assert.rejects(request(`${base}/slow`, { env, timeoutMs: 300 }), e => e.code === 'TIMEOUT');
  const ac = new AbortController(); setTimeout(() => ac.abort(), 100);
  await assert.rejects(request(`${base}/slow`, { env, signal: ac.signal, timeoutMs: 5000 }), e => e.code === 'ABORTED');
  await assert.rejects(request('ftp://x/'), e => e.code === 'BAD_URL');
});
