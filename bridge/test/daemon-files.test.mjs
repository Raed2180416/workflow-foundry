import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { H, sha256hex, signRequest } from '../common/protocol.mjs';
import { raw, signed, startDaemon } from './helpers.mjs';

test('upload, list and download round-trip with sha256', async t => {
  const { url, key, cfg } = await startDaemon(t);
  const body = '{"state":"x","questions":{}}\n'.repeat(50);
  const put = await signed(url, key, { method: 'PUT', path: '/files/data/sets/train.jsonl', body });
  assert.equal(put.status, 201, put.text);
  assert.deepEqual(put.json, { path: 'data/sets/train.jsonl', size: Buffer.byteLength(body), sha256: sha256hex(body) });
  assert.equal(fs.readFileSync(path.join(cfg.workdir, 'data', 'sets', 'train.jsonl'), 'utf8'), body);
  const get = await signed(url, key, { path: '/files/data/sets/train.jsonl' });
  assert.equal(get.status, 200); assert.equal(get.text, body);
  assert.equal(get.headers['x-bridge-sha256'], sha256hex(body));
  const ls = await signed(url, key, { path: '/files?dir=data&recursive=1' });
  assert.deepEqual(ls.json.entries.map(e => [e.path, e.type]), [['data/sets', 'dir'], ['data/sets/train.jsonl', 'file']]);
  const top = await signed(url, key, { path: '/files' });
  assert.deepEqual(top.json.entries.map(e => e.path), ['data', 'runs', 'logs']);
});

test('existing files are only replaced with ?overwrite=1', async t => {
  const { url, key } = await startDaemon(t);
  assert.equal((await signed(url, key, { method: 'PUT', path: '/files/data/a.txt', body: 'one' })).status, 201);
  const again = await signed(url, key, { method: 'PUT', path: '/files/data/a.txt', body: 'two' });
  assert.equal(again.status, 409); assert.equal(again.json.error, 'exists');
  assert.equal((await signed(url, key, { method: 'PUT', path: '/files/data/a.txt?overwrite=1', body: 'two' })).status, 201);
  assert.equal((await signed(url, key, { path: '/files/data/a.txt' })).text, 'two');
});

test('an upload whose bytes differ from the announced hash is discarded', async t => {
  const { url, key, cfg } = await startDaemon(t);
  const h = signRequest({ privateKey: key.privateKey, keyId: key.keyId, method: 'PUT', path: '/files/data/x.bin', body: 'expected' });
  const r = await raw(url, { method: 'PUT', path: '/files/data/x.bin', headers: { ...h, 'content-length': '8' }, body: 'tampered' });
  assert.equal(r.status, 400); assert.equal(r.json.error, 'body_hash_mismatch');
  assert.deepEqual(fs.readdirSync(path.join(cfg.workdir, 'data')), [], 'no file and no leftover temp file');
});

test('path traversal variants are refused on GET and PUT', async t => {
  const { url, key, cfg } = await startDaemon(t);
  fs.writeFileSync(path.join(cfg.workdir, 'data', 'ok.txt'), 'ok');
  fs.writeFileSync(path.join(cfg.workdir, 'data', '.hidden'), 'secret');
  const variants = [
    '/files/data/../jobs/x.json', '/files/data/%2e%2e/%2e%2e/etc/passwd', '/files/data/%2E%2E%2Fjobs', '/files/..%2fjobs',
    '/files/data/..%5c..%5cetc', '/files/data\\..\\jobs', '/files//etc/passwd', '/files/%2Fetc%2Fpasswd', '/files/data/ok.txt%00.png',
    '/files/data/.hidden', '/files/data/%2ehidden', '/files/jobs/x.json', '/files/etc/passwd', '/files/data/./ok.txt', '/files/data//ok.txt',
    '/files/C:/Windows', '/files/data/%E0%A4%A'
  ];
  for (const p of variants) {
    const g = await signed(url, key, { path: p });
    assert.ok([400, 403, 404].includes(g.status) && g.status !== 200, `GET ${p} -> ${g.status}`);
    assert.ok(!g.text.includes('secret'), p);
    const u = await signed(url, key, { method: 'PUT', path: p, body: 'pwn' });
    assert.ok(u.status >= 400 && u.status < 500, `PUT ${p} -> ${u.status}`);
  }
  const ls = await signed(url, key, { path: '/files?dir=data/..' });
  assert.equal(ls.status, 400);
  const lsData = await signed(url, key, { path: '/files?dir=data' });
  assert.deepEqual(lsData.json.entries.map(e => e.path), ['data/ok.txt'], 'dotfiles are not listed');
  // nothing was written outside data/ and runs/
  assert.deepEqual(fs.readdirSync(cfg.workdir).sort(), ['data', 'jobs', 'logs', 'runs']);
});

test('logs/ is readable but not writable; uploads go to data/ or runs/', async t => {
  const { url, key } = await startDaemon(t);
  const w = await signed(url, key, { method: 'PUT', path: '/files/logs/bridge-access.log', body: 'x' });
  assert.equal(w.status, 400); assert.equal(w.json.reason, 'outside_roots');
  assert.equal((await signed(url, key, { method: 'PUT', path: '/files/runs/mine/head.pt', body: 'h' })).status, 201);
  const r = await signed(url, key, { path: '/files/logs/bridge-access.log' });
  assert.equal(r.status, 200);
});

test('symlinks cannot escape the top directories', async t => {
  const { url, key, cfg, root } = await startDaemon(t);
  const outside = path.join(root, 'outside'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(cfg.workdir, 'data', 'link.txt'));
  fs.symlinkSync(outside, path.join(cfg.workdir, 'data', 'outdir'));
  fs.mkdirSync(path.join(cfg.workdir, 'data', 'real'));
  fs.writeFileSync(path.join(cfg.workdir, 'data', 'real', 'in.txt'), 'inside');
  fs.symlinkSync(path.join(cfg.workdir, 'data', 'real'), path.join(cfg.workdir, 'data', 'alias'));
  let r = await signed(url, key, { path: '/files/data/link.txt' });
  assert.equal(r.status, 403); assert.equal(r.json.error, 'symlink_escape');
  r = await signed(url, key, { path: '/files/data/outdir/secret.txt' });
  assert.equal(r.status, 403);
  r = await signed(url, key, { path: '/files?dir=data/outdir' });
  assert.equal(r.status, 403);
  r = await signed(url, key, { method: 'PUT', path: '/files/data/outdir/planted.txt', body: 'x' });
  assert.equal(r.status, 403);
  assert.equal(fs.existsSync(path.join(outside, 'planted.txt')), false);
  r = await signed(url, key, { method: 'PUT', path: '/files/data/link.txt?overwrite=1', body: 'x' });
  assert.equal(r.status, 403); assert.equal(r.json.error, 'symlink_target');
  assert.equal(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8'), 'top secret');
  // a symlink that stays inside data/ is fine
  r = await signed(url, key, { path: '/files/data/alias/in.txt' });
  assert.equal(r.status, 200); assert.equal(r.text, 'inside');
  const ls = await signed(url, key, { path: '/files?dir=data' });
  assert.ok(ls.json.entries.find(e => e.path === 'data/link.txt').type === 'symlink');
});

test('directories are listed, not downloaded; missing files are 404', async t => {
  const { url, key } = await startDaemon(t);
  assert.equal((await signed(url, key, { path: '/files/runs' })).status, 400);
  assert.equal((await signed(url, key, { path: '/files/data/nope.txt' })).status, 404);
  assert.equal((await signed(url, key, { path: '/files?dir=data/nope' })).status, 404);
  assert.equal((await signed(url, key, { method: 'PUT', path: '/files/data', body: 'x' })).status, 400);
});

test('signature is over the raw request target, so percent-encoding is part of what is signed', async t => {
  const { url, key } = await startDaemon(t);
  await signed(url, key, { method: 'PUT', path: '/files/data/a+b.txt', body: 'plus' });
  const r = await signed(url, key, { path: '/files/data/a%2Bb.txt', signPath: '/files/data/a+b.txt' });
  assert.equal(r.status, 401);
  const ok = await signed(url, key, { path: '/files/data/a%2Bb.txt' });
  assert.equal(ok.status, 200); assert.equal(ok.text, 'plus');
  void H;
});
