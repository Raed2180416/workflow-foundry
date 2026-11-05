// scripts/identity-scan.mjs: finds a host identity by hash only, never by a stored address. The address below is a made-up test value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { identityHashes, findIdentities, replaceIdentities, scan, sha256, mask } from '../scripts/identity-scan.mjs';

const ADDR = 'pat.host99@mailhost.test';
const H = new Set([sha256(ADDR)]);

test('identities come only from the environment: a digest list and/or the session account variable', () => {
  assert.equal(identityHashes({}).size, 0);
  assert.deepEqual([...identityHashes({ FOUNDRY_IDENTITY_SHA256: sha256(ADDR) })], [sha256(ADDR)]);
  assert.deepEqual([...identityHashes({ CLAUDE_CODE_USER_EMAIL: ' Pat.Host99@MailHost.test ' })], [sha256(ADDR)]);
  assert.throws(() => identityHashes({ FOUNDRY_IDENTITY_SHA256: 'not-a-digest' }), /sha256/);
});

test('finds the address in prose, JSON and glued to other text; leaves other addresses alone', () => {
  const text = `line one\n"to": "${ADDR}", "cc": "other@mailhost.test"\nBcc the user (${ADDR}). x.${ADDR}.\nPAT.HOST99@MAILHOST.TEST`;
  const f = findIdentities(text, H);
  assert.equal(f.length, 4);
  assert.deepEqual(f.map(x => x.line), [2, 3, 3, 4]);
  assert.equal(f[0].masked, 'p*********@mailhost.test');
  assert.equal(findIdentities('other@mailhost.test and pat.host98@mailhost.test', H).length, 0, 'a near miss is not a match');
});

test('replacement keeps every byte offset: the placeholder must have the same length', () => {
  const text = `{"to":"${ADDR}","n":1}`;
  const placeholder = 'requester@example.test'.padEnd(ADDR.length, 'x').slice(0, ADDR.length);
  const r = replaceIdentities(text, H, placeholder);
  assert.equal(r.replaced, 1);
  assert.equal(r.text.length, text.length);
  assert.equal(findIdentities(r.text, H).length, 0);
  assert.throws(() => replaceIdentities(text, H, 'short@x.test'), /length/);
  assert.equal(mask(ADDR).length, ADDR.length);
});

test('scan skips binary files and reports file and line, never the address', () => {
  const files = { 'a.json': Buffer.from(`{\n"x": "${ADDR}"\n}`), 'b.bin': Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(ADDR)]), 'c.md': Buffer.from('nothing here') };
  const r = scan({ files: Object.keys(files), read: f => files[f], hashes: H });
  assert.deepEqual(r.findings, [{ file: 'a.json', line: 2, masked: mask(ADDR) }]);
  assert.ok(!JSON.stringify(r).includes(ADDR));
});
