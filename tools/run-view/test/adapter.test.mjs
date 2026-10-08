// The store adapter reads the run header in three shapes (blob-v1, the earlier whole-run store; rows-v2, the per-node-row store; unknown) and always agrees with the event chain.
//   node --test tools/run-view/test/adapter.test.mjs
// The real Store writes rows-v2 (src/run-rows.mjs). blob-v1 is derived from what it writes (toBlobV1: the whole record back in runs.body), which the Store still reads; the
// other rows-v2 shapes are SYNTHETIC variants built from it (an index-only body, header columns). The last test runs the REAL store and fails loudly if its shape is not
// recognised. Development evidence only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, copyFileSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Store } from '../../../src/store.mjs';
import { StoreReader, NODE_TABLES } from '../store-adapter.mjs';
import { tempDir, writeRun, storeFile, finished, nested, toBlobV1, toRowsV2, treeDigest } from './fixtures.mjs';
await import('../run-view.js');
await import('../history-core.js');
const C = globalThis.RunViewCore, H = globalThis.HistoryCore;

const near = (a, b) => Math.abs(a - b) < 1e-9;
// A workspace in the earlier whole-run store's shape (the source the synthetic variants are built from).
async function fixture(t, build = nested) {
  const ws = tempDir(t), spec = build(), written = await writeRun(ws, spec.workflow, spec);
  toBlobV1(ws);
  return { ws, ...written };
}
// The header read through the adapter must equal what the event chain says (status, workflow hash, cost to 1e-9, event head).
function assertAgreesWithEvents(reader, runId, { expectShape, expectSource }) {
  reader.snapshot(() => {
    assert.equal(reader.shape, expectShape);
    const header = reader.header(runId), chain = reader.events(runId, { header });
    assert.equal(chain.ok, true, chain.reason);
    const facts = H.foldFacts(chain.events, reader.workflow(header.workflowHash).workflow);
    assert.equal(header.headerSource, expectSource);
    assert.equal(header.workflowHash, facts.workflowHash, 'workflow hash');
    assert.equal(header.status, facts.status, 'status');
    assert.ok(near(header.cost, facts.cost), `cost ${header.cost} vs ${facts.cost}`);
    assert.equal(header.eventHead.seq, chain.count, 'event head sequence');
    if (header.eventHead.hash) assert.equal(header.eventHead.hash, chain.head, 'event head hash');
    // The reducer's node states equal the runtime checkpoint (blob) or the per-node rows (rows-v2).
    if (reader.shape !== 'unknown') {
      const model = new C.RunModel({ workflow: reader.workflow(header.workflowHash).workflow });
      for (const ev of chain.events) model.apply(ev);
      const checkpoint = reader.checkpoint(runId);
      assert.ok(checkpoint.size > 0, 'checkpoint has node rows');
      for (const [key, status] of checkpoint) assert.equal(model.insts.get(key)?.status, status, `${key}: reducer vs checkpoint`);
    }
  });
}

test('blob-v1: a store written by the earlier whole-run store is recognised and its header agrees with the event chain', async t => {
  const { ws, runId } = await fixture(t);
  const reader = StoreReader.open(storeFile(ws));
  t.after(() => reader.close());
  assertAgreesWithEvents(reader, runId, { expectShape: 'blob-v1', expectSource: 'blob' });
  assert.deepEqual(reader.runIds(), [runId]);
});

test('rows-v2 (synthetic, index-only blob + run_nodes + user_version 2): recognised, header read from the body, node rows agree with the reducer', async t => {
  const { ws, runId } = await fixture(t);
  const dst = tempDir(t); toRowsV2(ws, dst, 'body');
  const reader = StoreReader.open(storeFile(dst)); t.after(() => reader.close());
  assert.ok(NODE_TABLES.includes('run_nodes'));
  assertAgreesWithEvents(reader, runId, { expectShape: 'rows-v2', expectSource: 'blob' });
  assert.match(reader.notes.join(' '), /rows-v2 recognised/);
});

test('rows-v2 (synthetic, header columns, no body): the header is read from the columns', async t => {
  const { ws, runId } = await fixture(t);
  const dst = tempDir(t); toRowsV2(ws, dst, 'columns');
  const reader = StoreReader.open(storeFile(dst)); t.after(() => reader.close());
  assertAgreesWithEvents(reader, runId, { expectShape: 'rows-v2', expectSource: 'columns' });
  const chain = reader.snapshot(() => reader.events(runId)), expected = H.foldFacts(chain.events).verdict.verdict;
  assert.equal(reader.header(runId).verdict?.verdict, expected, 'the verdict column agrees with the run.verdict event');
});

test('unknown (events and workflows only, no runs table): the header is derived from the event chain and labelled so', async t => {
  const { ws, runId } = await fixture(t);
  const dst = tempDir(t); toRowsV2(ws, dst, 'events');
  const reader = StoreReader.open(storeFile(dst)); t.after(() => reader.close());
  assertAgreesWithEvents(reader, runId, { expectShape: 'unknown', expectSource: 'events' });
  assert.deepEqual(reader.runIds(), [runId], 'run ids come from the events table');
  assert.match(reader.notes.join(' '), /no runs table/);
});

test('unknown: a store with an unrecognisable runs layout degrades to the events, never throws', async t => {
  const { ws, runId } = await fixture(t);
  const dst = tempDir(t); toRowsV2(ws, dst, 'events');
  const db = new DatabaseSync(storeFile(dst)); db.exec('CREATE TABLE runs(run TEXT, blob BLOB)'); db.exec("INSERT INTO runs VALUES('x', x'00')"); db.close();
  const reader = StoreReader.open(storeFile(dst)); t.after(() => reader.close());
  assert.equal(reader.shape, 'unknown');
  assert.equal(reader.header(runId).headerSource, 'events');
});

test('reading never changes the workspace: not a byte, not a file (an unmodified WAL store gets no -wal or -shm)', async t => {
  const { ws } = await fixture(t);
  const before = treeDigest(ws), listing = readdirSync(path.join(ws, '.foundry')).sort();
  const reader = StoreReader.open(storeFile(ws));
  for (const id of reader.runIds()) reader.snapshot(() => { const h = reader.header(id); reader.events(id, { header: h }); reader.workflow(h.workflowHash); reader.decisions(id); });
  reader.close();
  assert.deepEqual(readdirSync(path.join(ws, '.foundry')).sort(), listing, 'no new files in .foundry');
  assert.deepEqual(treeDigest(ws), before, 'no byte changed');
});

test('a run still being written reads as one snapshot: the header and the event tail agree (the latent race in export-run.mjs)', async t => {
  const ws = tempDir(t);
  const store = new Store(ws); t.after(() => { try { store.close(); } catch { /* closed */ } });
  const spec = nested(); store.saveWorkflow(spec.workflow);
  const run = store.createRun(store.workflow(spec.workflow.id).hash, {}, 'registry-hash', { maxCost: 1, maxDurationMs: 60000, maxSteps: 100, maxConcurrency: 2 });
  store.updateRun(run.id, r => { r.status = 'running'; }, { type: 'runner.acquired' });
  const append = () => store.updateRun(run.id, r => { r.steps += 1; }, { type: 'node.started', nodeKey: 'root/plan', kind: 'task' });
  const reader = StoreReader.open(storeFile(ws)); t.after(() => reader.close());
  // naive order (what export-run.mjs does today): header first, then, a moment later, the events. A writer commits in between.
  const naiveHeader = reader.header(run.id);
  append();
  const naive = reader.events(run.id, { header: naiveHeader });
  assert.equal(naive.ok, false, 'without a snapshot the head the header names is already stale');
  assert.match(naive.reason, /checkpoint head/);
  // snapshot order: one read transaction covers both reads, the writer's commit in between stays invisible to it
  const seen = reader.snapshot(() => {
    const header = reader.header(run.id);
    append();
    const chain = reader.events(run.id, { header });
    return { header, chain };
  });
  assert.equal(seen.chain.ok, true, seen.chain.reason);
  assert.equal(seen.chain.count, seen.header.eventHead.seq);
  // and the next snapshot sees everything the writer committed
  const later = reader.snapshot(() => { const h = reader.header(run.id); return { h, c: reader.events(run.id, { header: h }) }; });
  assert.equal(later.c.ok, true);
  assert.equal(later.c.count, seen.chain.count + 1, 'both appended events are visible to a new snapshot');
});

test('chain tampering is detected: the adapter reports where the chain breaks and returns the verified prefix', async t => {
  const { ws, runId } = await fixture(t);
  const db = new DatabaseSync(storeFile(ws));
  const row = db.prepare('SELECT seq, body FROM events WHERE run_id=? AND seq=5').get(runId);
  db.prepare('UPDATE events SET body=? WHERE run_id=? AND seq=5').run(row.body.replace(/"type":"[^"]+"/, '"type":"node.completed"'), runId);
  db.close();
  const reader = StoreReader.open(storeFile(ws)); t.after(() => reader.close());
  const chain = reader.snapshot(() => reader.events(runId, { header: reader.header(runId) }));
  assert.equal(chain.ok, false);
  assert.equal(chain.reason, 'chain breaks at seq 5');
  assert.equal(chain.events.length, 4, 'the four verified events before the break');
});

test('a workflow body that does not match its hash is never used', async t => {
  const { ws, runId } = await fixture(t);
  const db = new DatabaseSync(storeFile(ws));
  db.prepare("UPDATE workflows SET body = replace(body, 'Replay', 'Hacked')").run(); db.close();
  const reader = StoreReader.open(storeFile(ws)); t.after(() => reader.close());
  const w = reader.workflow(reader.header(runId).workflowHash);
  assert.equal(w.workflow, null);
  assert.match(w.reason, /does not match its hash/);
});

test('the REAL Store (per-node rows) is recognised as rows-v2: its header agrees with the event chain and its node rows with the reducer', async t => {
  const ws = tempDir(t), spec = nested(), { runId } = await writeRun(ws, spec.workflow, spec);
  const reader = StoreReader.open(storeFile(ws)); t.after(() => reader.close());
  assert.notEqual(reader.shape, 'unknown', `the Store's layout is not recognised (tables: ${[...reader.tables]}): update NODE_TABLES / HEADER_COLUMNS in store-adapter.mjs`);
  assertAgreesWithEvents(reader, runId, { expectShape: 'rows-v2', expectSource: 'blob' });
  assert.equal(reader.nodeTable, 'run_nodes');
  assert.deepEqual(reader.runIds(), [runId]);
  // A run another process is still writing: header and chain come from one snapshot, so they agree after every event.
  const store = new Store(ws), run = store.createRun(store.workflow(spec.workflow.id).hash, {}, 'r', { maxCost: 1, maxDurationMs: 60000, maxSteps: 100, maxConcurrency: 2 });
  store.updateRun(run.id, r => { r.status = 'running'; }, { type: 'runner.acquired' });
  store.close();
  const live = StoreReader.open(storeFile(ws)); t.after(() => live.close());
  const header = live.snapshot(() => live.header(run.id));
  assert.equal(header.workflowHash, run.workflowHash);
  assert.ok(live.snapshot(() => live.events(run.id, { header })).ok);
});
