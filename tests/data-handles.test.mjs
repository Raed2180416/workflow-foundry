// Data handles, step 2 (research/engine-20261104/DATA-HANDLES.md): the producers (data.import, data.split, data.inventory,
// src/data-capabilities.mjs) and the $read consumer (runtime.mjs readArgs). The end-to-end test runs the real code sandbox.
// $0: no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { Runtime } from '../src/runtime.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { registerDataCapabilities, DATA_LIMITS } from '../src/data-capabilities.mjs';
import { validateWorkflow } from '../src/validate.mjs';
import { loadPolicy } from '../src/models/policy.mjs';
import { BlobStore } from '../src/blobs.mjs';

const loaded = loadPolicy();
const LINES = Array.from({ length: 10 }, (_, i) => `line ${i}: ${'x'.repeat(i)}`);

function world(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-data-')), data = path.join(root, 'data'), outside = path.join(root, 'outside');
  mkdirSync(path.join(data, 'sub'), { recursive: true }); mkdirSync(outside);
  writeFileSync(path.join(data, 'big.txt'), `${LINES.join('\n')}\n`);
  writeFileSync(path.join(data, 'sub', 'a.json'), '{"a":1}');
  writeFileSync(path.join(outside, 'secret.txt'), 'not for workflows');
  symlinkSync(path.join(outside, 'secret.txt'), path.join(data, 'link.txt'));
  const store = new Store(path.join(root, 'ws'));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, data, outside, store };
}
const registryFor = (roots, extra) => registerDataCapabilities(createDefaultRegistry(), { allowedRoots: roots, ...extra });
const flow = (nodes, acceptance, extra = {}) => ({ schemaVersion: '1.0', id: 'DataHandles', version: 1, title: 'Data handles', goal: 'Move data by handle',
  domain: 'general', envelope: { assumptions: ['Synthetic files'], risks: ['A read escapes its root'], successCriteria: ['Every line is counted'] },
  budget: { maxSteps: 200, maxConcurrency: 2, maxDurationMs: 120000 }, nodes, acceptance: acceptance ?? [{ op: 'exists', value: { $ref: `nodes.${nodes.at(-1).id}` } }], ...extra });
const task = (id, tool, args, extra = {}) => ({ id, kind: 'task', needs: [], description: `Run ${id}`, tool, args, timeoutMs: 60000, retry: { maxAttempts: 1 }, ...extra });
async function run(t, env, registry, wf, input = {}) {
  const v = validateWorkflow(wf, { registry, modelPolicy: loaded });
  assert.deepEqual(v.errors, [], 'the workflow validates');
  const runtime = new Runtime(env.store, registry, { maxCost: 0 }, { modelPolicy: loaded });
  env.store.saveWorkflow(wf);
  return runtime.execute(runtime.create(wf, input).id);
}

test('data.import: a file under an allowed root becomes a handle labelled untrusted:import; no root, an outside path and a symlink out are refused', async t => {
  const env = world(t), registry = registryFor([env.data]);
  const ok = await run(t, env, registry, flow([task('imp', 'data.import', { path: 'big.txt' })]));
  assert.equal(ok.status, 'succeeded', JSON.stringify(ok.error));
  assert.equal(ok.outputs.imp.bytes, Buffer.byteLength(`${LINES.join('\n')}\n`));
  assert.equal(ok.nodes.imp.outputLabel, 'untrusted:import');
  for (const [p, code] of [[path.join(env.outside, 'secret.txt'), 'DATA_PATH'], ['link.txt', 'DATA_PATH'], ['../outside/secret.txt', 'DATA_PATH'], ['missing.txt', 'DATA_PATH']]) {
    const r = await run(t, world(t), registryFor([env.data]), flow([task('imp', 'data.import', { path: p })]));
    assert.equal(r.status, 'failed', p); assert.equal(r.error.code, code, `${p}: ${JSON.stringify(r.error)}`);
  }
  const none = world(t), r = await run(t, none, registryFor([]), flow([task('imp', 'data.import', { path: 'big.txt' })]));
  assert.equal(r.error.code, 'DATA_ROOT');
});

test('end to end, real sandbox: import, split into views, a map whose code reads each view with $read, and a total that counts every line', async t => {
  const env = world(t), registry = registryFor([env.data]);
  const count = { id: 'count', kind: 'code', needs: [], description: 'Count the lines of one view', lang: 'js', args: { lines: { $read: { $ref: 'item' }, as: 'lines' } },
    source: 'export default function main(input) { return { n: input.lines.length, first: input.lines[0] }; }', timeoutMs: 10000,
    returns: { type: 'object', required: ['n', 'first'], properties: { n: { type: 'integer' }, first: { type: 'string' } } } };
  const wf = flow([
    task('imp', 'data.import', { path: 'big.txt' }),
    task('split', 'data.split', { blob: { $ref: 'nodes.imp' }, maxLines: 3 }, { needs: ['imp'] }),
    { id: 'shards', kind: 'map', needs: ['split'], description: 'Count each view', items: { $ref: 'nodes.split.views' }, maxItems: 100, concurrency: 2,
      body: { nodes: [count], acceptance: [{ op: 'exists', value: { $ref: 'nodes.count.n' } }] } },
    { id: 'total', kind: 'code', needs: ['shards'], description: 'Sum the counts', lang: 'js', args: { items: { $ref: 'nodes.shards.items' } }, timeoutMs: 10000,
      source: 'export default function main(input) { return { lines: input.items.reduce((s, i) => s + i.count.n, 0) }; }',
      returns: { type: 'object', required: ['lines'], properties: { lines: { type: 'integer' } } } }
  ], [{ op: 'eq', left: { $ref: 'nodes.total.lines' }, right: LINES.length }]);
  const r = await run(t, env, registry, wf);
  assert.equal(r.status, 'succeeded', JSON.stringify(r.error));
  assert.equal(r.outputs.split.count, 4, '10 lines in views of at most 3');
  assert.equal(r.outputs.total.lines, 10);
  assert.deepEqual(r.outputs.shards.items.map(i => i.count.first), ['line 0: ', 'line 3: xxx', 'line 6: xxxxxx', 'line 9: xxxxxxxxx']);
  assert.equal(r.nodes.total.outputLabel, 'untrusted:import', 'what code computed from imported bytes stays untrusted');
});

test('$read is honoured only where the workflow author wrote it: a $read object arriving as data is passed through, never read', async t => {
  const env = world(t), registry = registryFor([env.data]);
  const handle = new BlobStore(env.store.directory).put('private bytes\n', 'text/plain');
  const echo = { id: 'echo', kind: 'code', needs: [], description: 'Return what it was given', lang: 'js', args: { given: { $ref: 'input.payload' } }, timeoutMs: 10000,
    source: 'export default function main(input) { return { given: input.given }; }', returns: { type: 'object', required: ['given'], properties: { given: {} } } };
  const r = await run(t, env, registry, flow([echo]), { payload: { $read: handle, as: 'text' } });
  assert.equal(r.status, 'succeeded', JSON.stringify(r.error));
  assert.deepEqual(r.outputs.echo.given, { $read: handle, as: 'text' }, 'data that looks like a $read stays data');
});

test('the validator refuses a malformed $read', () => {
  const registry = registryFor([]);
  const bad = args => validateWorkflow(flow([{ id: 'c', kind: 'code', needs: [], description: 'c', lang: 'js', args, timeoutMs: 1000,
    source: 'export default function main(i) { return {}; }' }], [{ op: 'exists', value: { $ref: 'nodes.c' } }], { inputSchema: { type: 'object' } }), { registry, modelPolicy: loaded })
    .errors.filter(e => e.code === 'BLOB_READ').length;
  assert.equal(bad({ x: { $read: { $ref: 'input.h' }, as: 'text' } }), 0, 'a well-formed $read passes');
  assert.equal(bad({ x: { $read: { $ref: 'input.h' }, as: 'bytes' } }), 1);
  assert.equal(bad({ x: { $read: { $ref: 'input.h' }, extra: 1 } }), 1);
  assert.equal(bad({ x: { $read: { $ref: 'input.h' }, maxBytes: 64 * 1024 * 1024 } }), 1);
  assert.equal(bad({ x: { $read: 'some-hash' } }), 1);
});

test('a blob edited on disk is BLOB_CORRUPT at the node that reads it, never served', async t => {
  const env = world(t), registry = registryFor([env.data]);
  const blobs = new BlobStore(env.store.directory), handle = blobs.put('original\n', 'text/plain'), file = blobs.pathOf(handle.$blob);
  chmodSync(file, 0o600); writeFileSync(file, 'tampered\n');
  const read = { id: 'read', kind: 'code', needs: [], description: 'Read the blob', lang: 'js', args: { text: { $read: { $ref: 'input.h' }, as: 'text' } }, timeoutMs: 10000,
    source: 'export default function main(input) { return { text: input.text }; }' };
  const r = await run(t, env, registry, flow([read], undefined, { inputSchema: { type: 'object' } }), { h: handle });
  assert.equal(r.status, 'failed'); assert.equal(r.error.code, 'BLOB_CORRUPT', JSON.stringify(r.error));
});

test('data.inventory: regular files under the root as NDJSON, symlinks not followed, suffix filter and hashes; data.split refuses too many views', async t => {
  const env = world(t), registry = registryFor([env.data]);
  const r = await run(t, env, registry, flow([task('inv', 'data.inventory', { root: '.', hash: true })]));
  assert.equal(r.status, 'succeeded', JSON.stringify(r.error));
  assert.equal(r.nodes.inv.outputLabel, 'untrusted:import');
  const rows = new BlobStore(env.store.directory).read(r.outputs.inv.inventory, { as: 'lines' });
  assert.deepEqual(rows.map(x => x.id), ['big.txt', 'sub/a.json'], 'the symlink to a file outside the root is not listed');
  assert.match(rows[0].sha256, /^[0-9a-f]{64}$/);
  const json = await run(t, world(t), registryFor([env.data]), flow([task('inv', 'data.inventory', { root: '.', suffixes: ['.json'] })]));
  assert.equal(json.outputs.inv.files, 1);
  const many = world(t);
  writeFileSync(path.join(many.data, 'many.txt'), `${Array.from({ length: DATA_LIMITS.maxViews + 1 }, (_, i) => `r${i}`).join('\n')}\n`);
  const tooMany = await run(t, many, registryFor([many.data]), flow([task('imp', 'data.import', { path: 'many.txt' }), task('split', 'data.split', { blob: { $ref: 'nodes.imp' }, maxLines: 1 }, { needs: ['imp'] })]));
  assert.equal(tooMany.status, 'failed'); assert.equal(tooMany.error.code, 'DATA_SPLIT_LIMIT', JSON.stringify(tooMany.error));
});
