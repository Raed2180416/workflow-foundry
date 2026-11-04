// Data handles (src/blobs.mjs): content addressing, integrity, views, bounded reads, quotas, splitting.
// $0, synthetic data; development evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BlobStore, isHandle } from '../src/blobs.mjs';

function store(t, limits) {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-blobs-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return new BlobStore(dir, limits);
}
const code = fn => { try { fn(); } catch (e) { return e.code; } return null; };

test('put is content-addressed and idempotent; the handle has exactly three fields', t => {
  const s = store(t);
  const a = s.put('alpha\nbeta\n', 'text/plain'), b = s.put(Buffer.from('alpha\nbeta\n'), 'text/plain');
  assert.deepEqual(a, b); assert.equal(a.bytes, 11); assert.match(a.$blob, /^[0-9a-f]{64}$/);
  assert.equal(isHandle(a), true); assert.equal(isHandle({ ...a, extra: 1 }), false); assert.equal(isHandle({ ...a, range: [0, 99] }), false);
  assert.equal(isHandle({ ...a, range: [0, 5], lines: [0, 1] }), false); assert.equal(isHandle({ ...a, $blob: 'ABC' }), false);
  assert.equal(code(() => s.put('{bad', 'application/json')), 'BLOB_HANDLE');
  assert.equal(code(() => s.put('x', 'image/png')), 'BLOB_HANDLE');
});

test('an edited, truncated or missing blob is refused, never served', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-blobs-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const s = new BlobStore(dir), h = s.put('one\ntwo\nthree\n', 'text/plain'), file = s.pathOf(h.$blob);
  chmodSync(file, 0o600); writeFileSync(file, 'one\ntwo\nthreE\n');
  assert.equal(code(() => new BlobStore(dir).read(h)), 'BLOB_CORRUPT');            // same size, one byte changed
  truncateSync(file, 4);
  assert.equal(code(() => new BlobStore(dir).read(h)), 'BLOB_CORRUPT');            // size differs
  rmSync(file);
  assert.equal(code(() => new BlobStore(dir).read(h)), 'BLOB_MISSING');
});

test('views read byte ranges and line ranges exactly, with or without a final newline', t => {
  const s = store(t);
  for (const text of ['a1\nb22\nc333\n', 'a1\nb22\nc333']) {
    const h = s.put(text, 'text/plain');
    assert.equal(s.read({ ...h, range: [3, 6] }), 'b22');
    assert.equal(s.read({ ...h, lines: [1, 2] }), 'b22\n');
    assert.deepEqual(s.read({ ...h, lines: [1, 3] }, { as: 'lines' }), ['b22', 'c333']);
    assert.deepEqual(s.read(h, { as: 'lines' }), ['a1', 'b22', 'c333']);
    assert.equal(s.read({ ...h, lines: [2, 2] }), '');
    assert.equal(code(() => s.read({ ...h, lines: [2, 4] })), 'BLOB_RANGE');
  }
  const empty = s.put('', 'text/plain');
  assert.deepEqual(s.read(empty, { as: 'lines' }), []); assert.deepEqual(s.split(empty, { maxLines: 2 }), []);
});

test('JSON and NDJSON blobs parse on read; a broken NDJSON line is refused', t => {
  const s = store(t);
  assert.deepEqual(s.read(s.put('{"a":[1,2]}', 'application/json'), { as: 'json' }), { a: [1, 2] });
  const nd = s.put('{"id":"u1"}\n{"id":"u2"}\n', 'application/x-ndjson');
  assert.deepEqual(s.read({ ...nd, lines: [1, 2] }, { as: 'lines' }), [{ id: 'u2' }]);
  assert.equal(code(() => s.read(s.put('{"id":1}\nnot json\n', 'application/x-ndjson'), { as: 'lines' })), 'BLOB_HANDLE');
});

test('reads, blobs and the store are bounded by typed refusals', t => {
  const s = store(t, { maxReadBytes: 10, maxBlobBytes: 32, maxStoreBytes: 40 });
  const h = s.put('0123456789abcdef', 'text/plain');
  assert.equal(code(() => s.read(h)), 'BLOB_READ_LIMIT');
  assert.equal(s.read({ ...h, range: [0, 10] }), '0123456789');
  assert.equal(code(() => s.read({ ...h, range: [0, 10] }, { maxBytes: 5 })), 'BLOB_READ_LIMIT');
  assert.equal(code(() => s.put('x'.repeat(33), 'text/plain')), 'BLOB_TOO_LARGE');
  s.put('y'.repeat(20), 'text/plain');
  assert.equal(code(() => s.put('z'.repeat(20), 'text/plain')), 'BLOB_QUOTA');
  assert.equal(s.put('0123456789abcdef', 'text/plain').bytes, 16, 'storing existing content costs no quota');
});

test('split cuts at line boundaries, covers every line exactly once, and respects both bounds', t => {
  const s = store(t);
  const lines = Array.from({ length: 103 }, (_, i) => `{"id":"unit-${i}","path":"src/m${i % 7}/f${i}.ts"}`);
  const h = s.put(`${lines.join('\n')}\n`, 'application/x-ndjson');
  const byLines = s.split(h, { maxLines: 10 });
  assert.equal(byLines.length, 11); assert.ok(byLines.every(v => v.lines[1] - v.lines[0] <= 10));
  const seen = byLines.flatMap(v => s.read(v, { as: 'lines' }).map(u => u.id));
  assert.deepEqual(seen, lines.map(l => JSON.parse(l).id));
  const byBytes = s.split(h, { maxBytes: 200 });
  assert.ok(byBytes.every(v => { const [a, b] = s.rangeOf(v); return b - a <= 200; }));
  assert.equal(byBytes.reduce((n, v) => n + v.lines[1] - v.lines[0], 0), 103);
  assert.equal(code(() => s.split(h, { maxBytes: 10 })), 'BLOB_RANGE');
  assert.equal(code(() => s.split(byLines[0], { maxLines: 2 })), 'BLOB_HANDLE');
});

test('a blob verified earlier in this process and then truncated is still refused (the size check, not the cache)', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-blobs-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const s = new BlobStore(dir), h = s.put('kept\nwhole\n', 'text/plain');
  assert.equal(s.read(h), 'kept\nwhole\n');
  chmodSync(s.pathOf(h.$blob), 0o600); truncateSync(s.pathOf(h.$blob), 5);
  assert.equal(code(() => s.read(h)), 'BLOB_CORRUPT');
});
