import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { H, generateKeyPair, newNonce, sha256hex, signRequest } from '../common/protocol.mjs';
import { raw, scratch, signed, startDaemon, testConfig, testKey } from './helpers.mjs';

test('GET /health needs no signature and reveals only ok and version', async t => {
  const { url } = await startDaemon(t);
  const r = await raw(url, { path: '/health' });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(), ['ok', 'version']);
  assert.equal(r.json.ok, true);
  assert.ok(r.headers.date, 'Date header lets clients measure clock skew');
});

test('a correctly signed request is accepted', async t => {
  const { url, key } = await startDaemon(t);
  const r = await signed(url, key, { path: '/ping' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.keyId, key.keyId);
});

test('unsigned and partially signed requests are refused before routing', async t => {
  const { url, key } = await startDaemon(t);
  for (const p of ['/info', '/ping', '/no/such/route', '/files/data/x', '/svc/kev/v1/models']) {
    const r = await raw(url, { path: p });
    assert.equal(r.status, 401, p); assert.equal(r.json.reason, 'unsigned');
  }
  for (const drop of [H.key, H.ts, H.nonce, H.sig]) {
    const r = await signed(url, key, { path: '/ping', mutate: h => { delete h[drop]; } });
    assert.equal(r.status, 401, drop); assert.equal(r.json.reason, 'unsigned');
  }
});

test('unknown key ids and signatures by an untrusted key are refused', async t => {
  const { url, key } = await startDaemon(t);
  const stranger = generateKeyPair();
  let r = await signed(url, stranger, { path: '/ping' });
  assert.equal(r.status, 401); assert.equal(r.json.reason, 'unknown_key');
  // claim the trusted key id but sign with another key
  r = await signed(url, { ...stranger, keyId: key.keyId }, { path: '/ping' });
  assert.equal(r.status, 401); assert.equal(r.json.reason, 'bad_signature');
  r = await signed(url, key, { path: '/ping', mutate: h => { h[H.key] = 'ZZZZ'; } });
  assert.equal(r.json.reason, 'unknown_key');
});

test('timestamps more than 120 s away are refused, in both directions', async t => {
  const { url, key } = await startDaemon(t);
  for (const ts of [Date.now() - 121_000, Date.now() + 121_000]) {
    const r = await signed(url, key, { path: '/ping', ts });
    assert.equal(r.status, 401); assert.equal(r.json.reason, 'stale_timestamp');
  }
  const ok = await signed(url, key, { path: '/ping', ts: Date.now() - 100_000 });
  assert.equal(ok.status, 200);
  const bad = await signed(url, key, { path: '/ping', mutate: h => { h[H.ts] = '17e11'; } });
  assert.equal(bad.json.reason, 'bad_timestamp');
});

test('a nonce is accepted once; replays and malformed nonces are refused', async t => {
  const { url, key } = await startDaemon(t);
  const nonce = newNonce(); const ts = Date.now();
  const first = await signed(url, key, { path: '/ping', nonce, ts });
  assert.equal(first.status, 200);
  const replay = await signed(url, key, { path: '/ping', nonce, ts });
  assert.equal(replay.status, 401); assert.equal(replay.json.reason, 'replayed_nonce');
  const short = await signed(url, key, { path: '/ping', mutate: h => { h[H.nonce] = 'abcd'; } });
  assert.equal(short.json.reason, 'bad_nonce');
  // a replay of the same nonce for a different request is still a replay
  const other = await signed(url, key, { path: '/info', nonce, ts });
  assert.equal(other.json.reason, 'replayed_nonce');
});

test('a failed signature does not burn the nonce (so an attacker cannot block a legitimate request)', async t => {
  const { url, key } = await startDaemon(t);
  const nonce = newNonce(); const ts = Date.now();
  const forged = await signed(url, key, { path: '/ping', nonce, ts, mutate: h => { h[H.sig] = Buffer.alloc(64, 1).toString('base64'); } });
  assert.equal(forged.json.reason, 'bad_signature');
  const real = await signed(url, key, { path: '/ping', nonce, ts });
  assert.equal(real.status, 200);
});

test('tampering with method, path, query or body breaks the signature', async t => {
  const { url, key } = await startDaemon(t);
  const body = JSON.stringify({ kind: 'sys.selftest', params: {} });
  let r = await signed(url, key, { method: 'POST', path: '/jobs', body, signBody: body.replace('selftest', 'selftezt'), announce: false });
  assert.equal(r.status, 401); assert.equal(r.json.reason, 'bad_signature');
  r = await signed(url, key, { method: 'POST', path: '/jobs', body, signBody: body.replace('selftest', 'selftezt') });
  assert.equal(r.status, 401); assert.equal(r.json.reason, 'body_hash_mismatch', 'announced hash differs from the body');
  r = await signed(url, key, { path: '/files?dir=data', signPath: '/files?dir=runs' });
  assert.equal(r.json.reason, 'bad_signature');
  r = await signed(url, key, { path: '/info', signPath: '/ping' });
  assert.equal(r.json.reason, 'bad_signature');
  r = await signed(url, key, { method: 'POST', path: '/jobs/j-20260101-000000-abcdef/cancel', signMethod: 'GET' });
  assert.equal(r.json.reason, 'bad_signature');
  r = await signed(url, key, { path: '/ping', mutate: h => { h[H.bodySha] = 'nothex'; } });
  assert.equal(r.status, 400); assert.equal(r.json.error, 'bad_body_hash');
});

test('bodies over the limit are refused with 413 (declared or streamed)', async t => {
  const root = scratch(t, 'limit');
  const { url, key } = await startDaemon(t, { root, config: testConfig(root, { limits: { jsonBytes: 1024, unannouncedBodyBytes: 512, fileBytes: 4096 } }) });
  const big = JSON.stringify({ kind: 'sys.selftest', params: { pad: 'x'.repeat(2000) } });
  let r = await signed(url, key, { method: 'POST', path: '/jobs', body: big });
  assert.equal(r.status, 413);
  // chunked: no content-length, the daemon counts bytes as they arrive
  const h = signRequest({ privateKey: key.privateKey, keyId: key.keyId, method: 'POST', path: '/jobs', body: big });
  r = await raw(url, { method: 'POST', path: '/jobs', headers: { ...h, 'transfer-encoding': 'chunked' }, body: big });
  assert.equal(r.status, 413);
  // uploads have their own limit
  const file = 'y'.repeat(5000);
  r = await signed(url, key, { method: 'PUT', path: '/files/data/big.bin', body: file });
  assert.equal(r.status, 413);
});

test('uploads must announce the body hash so the signature is checked before any byte hits the disk', async t => {
  const { url, key, cfg } = await startDaemon(t);
  const r = await signed(url, key, { method: 'PUT', path: '/files/data/a.txt', body: 'hello', announce: false });
  assert.equal(r.status, 400); assert.equal(r.json.error, 'body_hash_required');
  assert.equal(fs.existsSync(path.join(cfg.workdir, 'data', 'a.txt')), false);
});

test('an authenticated request to an unknown route gets 404, an unauthenticated one 401', async t => {
  const { url, key } = await startDaemon(t);
  assert.equal((await raw(url, { path: '/admin' })).status, 401);
  assert.equal((await signed(url, key, { path: '/admin' })).status, 404);
  assert.equal((await signed(url, key, { method: 'DELETE', path: '/info' })).status, 404);
});

test('revoking a key (deleting its file) takes effect on the next refresh', async t => {
  const { d, url, key, keysDir } = await startDaemon(t);
  assert.equal((await signed(url, key, { path: '/ping' })).status, 200);
  for (const f of fs.readdirSync(keysDir)) fs.rmSync(path.join(keysDir, f));
  await d.refresh();
  const r = await signed(url, key, { path: '/ping' });
  assert.equal(r.status, 401); assert.equal(r.json.reason, 'unknown_key');
  // a newly added key works after refresh
  const k2 = testKey(keysDir, 'second');
  await d.refresh();
  assert.equal((await signed(url, k2, { path: '/ping' })).status, 200);
});

test('the kill switch refuses all signed work and stops jobs; /health reports ok=false', async t => {
  const { d, url, key } = await startDaemon(t);
  d.setKilled(true);
  assert.equal((await raw(url, { path: '/health' })).json.ok, false);
  const r = await signed(url, key, { path: '/info' });
  assert.equal(r.status, 403); assert.equal(r.json.error, 'killed');
  d.setKilled(false);
  assert.equal((await signed(url, key, { path: '/info' })).status, 200);
});

test('malformed key files are skipped, not fatal', async t => {
  const root = scratch(t, 'badkeys');
  const keysDir = path.join(root, 'keys'); fs.mkdirSync(keysDir);
  fs.writeFileSync(path.join(keysDir, 'junk.pub'), 'not a key');
  fs.writeFileSync(path.join(keysDir, 'big.pub'), 'x'.repeat(5000));
  const { url, key } = await startDaemon(t, { root, keysDir });
  assert.equal((await signed(url, key, { path: '/ping' })).status, 200);
  const info = await signed(url, key, { path: '/info' });
  assert.equal(info.json.keys.count, 1); assert.equal(info.json.keys.errors, 2);
});

test('the access log records requests without bodies, signatures or nonces', async t => {
  const { url, key, cfg } = await startDaemon(t);
  const nonce = newNonce();
  await signed(url, key, { method: 'POST', path: '/jobs', body: JSON.stringify({ kind: 'nope', params: { secret: 'BODY-SECRET' } }), nonce });
  await raw(url, { path: '/info' });
  const log = fs.readFileSync(path.join(cfg.workdir, 'logs', 'bridge-access.log'), 'utf8');
  assert.match(log, /"path":"\/jobs"/); assert.match(log, /"reason":"unsigned"/);
  assert.doesNotMatch(log, /BODY-SECRET/); assert.ok(!log.includes(nonce));
  assert.ok(!log.includes('x-bridge-sig')); assert.ok(!/[A-Za-z0-9+/]{86}==/.test(log), 'no signature in log');
  void sha256hex;
});

test('the daemon refuses to bind a non-loopback address', async t => {
  const root = scratch(t, 'bind');
  assert.throws(() => testConfig(root, { host: '0.0.0.0' }), /loopback/);
});
