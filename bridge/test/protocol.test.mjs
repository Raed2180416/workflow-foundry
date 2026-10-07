import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  EMPTY_SHA256, H, NonceCache, canonicalString, constantTimeEqualHex, generateKeyPair, keyId, newNonce,
  publicKeyPem, rawPublicKey, sha256hex, signRequest, toPublicKey, verifySignature
} from '../common/protocol.mjs';
import { parseRelPath, isRelPath } from '../common/relpath.mjs';

test('canonical string is METHOD, path-with-query, ts, nonce, body hash joined by LF', () => {
  const nonce = 'ab'.repeat(16);
  const s = canonicalString({ method: 'POST', path: '/jobs?x=1', ts: '1700000000000', nonce, bodySha256: sha256hex('{"a":1}') });
  assert.equal(s, `POST\n/jobs?x=1\n1700000000000\n${nonce}\n${sha256hex('{"a":1}')}`);
  assert.equal(EMPTY_SHA256, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('canonical string rejects ambiguous or malformed components', () => {
  const ok = { method: 'GET', path: '/info', ts: '1', nonce: 'a'.repeat(32), bodySha256: EMPTY_SHA256 };
  assert.throws(() => canonicalString({ ...ok, method: 'get' }));
  assert.throws(() => canonicalString({ ...ok, path: 'info' }));
  assert.throws(() => canonicalString({ ...ok, path: '/a\nGET' }));
  assert.throws(() => canonicalString({ ...ok, ts: '12a' }));
  assert.throws(() => canonicalString({ ...ok, nonce: 'A'.repeat(32) }));
  assert.throws(() => canonicalString({ ...ok, nonce: 'a'.repeat(30) }));
  assert.throws(() => canonicalString({ ...ok, bodySha256: 'xyz' }));
});

test('key id is the first 16 hex of sha256 over the raw 32-byte public key', () => {
  const k = generateKeyPair();
  const raw = rawPublicKey(k.publicKey);
  assert.equal(raw.length, 32);
  assert.equal(k.keyId, crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16));
  assert.equal(keyId(publicKeyPem(k.publicKey)), k.keyId);
  assert.equal(keyId(k.privateKey), k.keyId);
});

test('only Ed25519 keys are accepted', () => {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  assert.throws(() => toPublicKey(publicKey), /Ed25519/);
});

test('signRequest headers verify against the canonical string, and any change breaks them', () => {
  const k = generateKeyPair();
  const body = '{"kind":"sys.selftest"}';
  const h = signRequest({ privateKey: k.privateKey, method: 'post', path: '/jobs', body, ts: 1700000000000, nonce: 'cd'.repeat(16) });
  assert.equal(h[H.key], k.keyId); assert.equal(h[H.ts], '1700000000000'); assert.equal(h[H.bodySha], sha256hex(body));
  const c = { method: 'POST', path: '/jobs', ts: '1700000000000', nonce: 'cd'.repeat(16), bodySha256: sha256hex(body) };
  assert.ok(verifySignature(k.publicKey, canonicalString(c), h[H.sig]));
  for (const tweak of [{ method: 'PUT' }, { path: '/jobs?x' }, { ts: '1700000000001' }, { nonce: 'ce'.repeat(16) }, { bodySha256: sha256hex(body + ' ') }])
    assert.equal(verifySignature(k.publicKey, canonicalString({ ...c, ...tweak }), h[H.sig]), false, JSON.stringify(tweak));
  assert.equal(verifySignature(generateKeyPair().publicKey, canonicalString(c), h[H.sig]), false, 'other key');
  assert.equal(verifySignature(k.publicKey, canonicalString(c), 'not base64!'), false);
  assert.equal(verifySignature(k.publicKey, canonicalString(c), Buffer.alloc(64).toString('base64')), false);
});

test('nonces are 16 random bytes in hex', () => {
  const a = newNonce(), b = newNonce();
  assert.match(a, /^[0-9a-f]{32}$/); assert.notEqual(a, b);
});

test('NonceCache: duplicates refused, entries expire, and a full cache refuses instead of evicting', () => {
  let now = 0;
  const c = new NonceCache({ ttlMs: 1000, maxSize: 2, now: () => now });
  assert.equal(c.add('a'), true); assert.equal(c.add('a'), false); assert.ok(c.has('a'));
  assert.equal(c.add('b'), true);
  assert.throws(() => c.add('c'), e => e.code === 'NONCE_CACHE_FULL');
  now = 1001;
  assert.equal(c.has('a'), false); assert.equal(c.add('c'), true); assert.equal(c.size, 1);
});

test('constantTimeEqualHex', () => {
  assert.ok(constantTimeEqualHex('ab', 'ab'));
  assert.ok(!constantTimeEqualHex('ab', 'ac'));
  assert.ok(!constantTimeEqualHex('ab', 'abc'));
  assert.ok(!constantTimeEqualHex(null, 'ab'));
});

test('relative paths: accepted forms', () => {
  assert.deepEqual(parseRelPath('data/train.jsonl'), { rel: 'data/train.jsonl', segments: ['data', 'train.jsonl'] });
  assert.equal(parseRelPath('runs/j-1/sub/head.pt').rel, 'runs/j-1/sub/head.pt');
  assert.equal(parseRelPath('data/a%2Bb.jsonl', { decode: true }).rel, 'data/a+b.jsonl');
  assert.equal(parseRelPath('data/kev-0.8b@v1.0,x=1.json').rel, 'data/kev-0.8b@v1.0,x=1.json');
});

test('relative paths: every traversal and smuggling variant is refused', () => {
  const bad = {
    '': 'empty', '/etc/passwd': 'absolute', 'data/../etc': 'dot_segment', '../data/x': 'dot_segment', 'data/./x': 'dot_segment',
    'data//x': 'empty_segment', 'data/x/': 'empty_segment', 'data\\..\\x': 'backslash', 'data/x\0': 'nul', 'C:/x': 'drive_letter',
    'data/.ssh': 'hidden', 'data/.env': 'hidden', 'etc/passwd': 'outside_roots', 'jobs/j-1.json': 'outside_roots',
    'data/-rf': 'bad_name', 'data/a b': 'bad_name', 'data/a%2e': 'bad_name', 'data/ü': 'bad_name'
  };
  for (const [p, reason] of Object.entries(bad)) assert.throws(() => parseRelPath(p), e => e.reason === reason, `${JSON.stringify(p)} -> ${reason}`);
  const encoded = {
    'data/%2e%2e/etc': 'dot_segment', 'data/%2E%2E/x': 'dot_segment', 'data/a%2Fb': 'encoded_separator', 'data/a%5Cb': 'encoded_separator',
    'data/%00': 'nul', 'data/%2essh': 'hidden', 'data/%E0%A4%A': 'bad_encoding', '%2Fetc/passwd': 'encoded_separator', 'data/%252e%252e': 'bad_name'
  };
  for (const [p, reason] of Object.entries(encoded)) assert.throws(() => parseRelPath(p, { decode: true }), e => e.reason === reason, `${p} -> ${reason}`);
  assert.ok(!isRelPath('logs/x', { tops: ['data', 'runs'] }));
  assert.ok(!isRelPath('a/'.repeat(40) + 'x'));
});
