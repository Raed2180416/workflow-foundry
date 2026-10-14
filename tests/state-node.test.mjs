// Cross-run keyed state (L0 row 27; E3 engine column step 1; src/state.mjs): validation, the seen-set / counter / cursor / record
// semantics across runs, compare-and-swap conflicts, TTL expiry under a simulated clock, bounds, schema refusals, replay determinism,
// crash/resume inside and after the write transaction, isolation between workflows and concurrent writers in separate processes.
// Synthetic local workflows only, no model calls. Development/diagnostic evidence, not sealed evaluation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { Store } from '../src/store.mjs';
import { Runtime } from '../src/runtime.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { validateWorkflow } from '../src/validate.mjs';
import { verifyRun } from '../src/verify-run.mjs';
import { STATE_REFUSALS } from '../src/state.mjs';

const ref = $ref => ({ $ref });
const registry = createDefaultRegistry();
const flow = (id, state, nodes, acceptance, extra = {}) => ({
  schemaVersion: '1.0', id, version: 1, title: `${id} probe`, goal: 'Exercise cross-run state', domain: 'diagnostic',
  envelope: { assumptions: ['Synthetic local input'], risks: [], successCriteria: ['State behaves as declared'] },
  budget: { maxSteps: 200, maxConcurrency: 4, maxDurationMs: 60000 }, state, nodes, acceptance, ...extra });
const st = (id, slot, op, fields = {}, needs = []) => ({ id, kind: 'state', needs, description: `${op} on ${slot}`, slot, op, ...fields });
const exists = id => [{ op: 'exists', value: ref(`nodes.${id}.version`) }];
const ownerSchema = { type: 'object', additionalProperties: false, required: ['owner'], properties: { owner: { type: 'string', maxLength: 64 } } };

function open(t, options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-state-'));
  const store = new Store(root);
  t.after(() => { try { store.close(); } catch {} rmSync(root, { recursive: true, force: true }); });
  return { root, store, runtime: new Runtime(store, registry, {}, options) };
}
const save = (store, ...workflows) => { for (const wf of workflows) store.saveWorkflow(wf); };
const go = (runtime, wf, input = {}, options = {}) => runtime.execute(runtime.create(wf, input, options).id);
const codes = result => result.errors.map(e => e.code);
const stateEvents = (store, runId) => store.events(runId).filter(e => e.type === 'state.op');
// Everything of a workflow's state, for before/after comparisons.
const snapshot = (store, workflowId) => ({
  slots: store.db.prepare('SELECT slot, decl_hash, revision, items, bytes FROM state_slots WHERE workflow_id=? ORDER BY slot').all(workflowId).map(r => ({ ...r })),
  entries: store.db.prepare('SELECT slot, key, value, version, expires_at, bytes FROM state_entries WHERE workflow_id=? ORDER BY slot, key').all(workflowId).map(r => ({ ...r }))
});

// ---- validation ---------------------------------------------------------------------------------------------------------------------

const dedupe = flow('Dedupe', { seen: { type: 'set', maxItems: 100000, ttlDays: 30, writer: 'dedupe' } },
  [st('dedupe', 'seen', 'add', { key: ref('input.id') })], exists('dedupe'));

test('state: validation accepts the L0 card shape and checks slots, operations, writers and arguments', () => {
  const valid = validateWorkflow(dedupe, { registry });
  assert.equal(valid.valid, true, JSON.stringify(valid.errors));

  const bad = (state, nodes, acceptance = exists(nodes.at(-1).id)) => codes(validateWorkflow(flow('Bad', state, nodes, acceptance), { registry }));
  const seen = { seen: { type: 'set', maxItems: 10, writer: 'w' } };
  assert.ok(bad(seen, [st('w', 'seen', 'add', { key: 'a' }), st('r', 'other', 'get', { key: 'a' }, ['w'])]).includes('STATE_SLOT_UNKNOWN'));
  assert.ok(bad(seen, [st('w', 'seen', 'incr', { key: 'a' })]).includes('STATE_OP'), 'incr is not a set operation');
  assert.ok(bad(seen, [st('w', 'seen', 'add', { key: 'a' }), st('w2', 'seen', 'delete', { key: 'a' }, ['w'])]).includes('STATE_WRITER'), 'an undeclared writer');
  assert.ok(bad(seen, [st('r', 'seen', 'get', { key: 'a' })]).includes('STATE_WRITER'), 'a declared writer that writes nothing');
  const nested = bad({ seen: { type: 'set', maxItems: 10, writer: 'w' } }, [st('w', 'seen', 'add', { key: 'a' }),
    { id: 'm', kind: 'map', needs: ['w'], description: 'again', items: ref('input.ids'), maxItems: 4, body: { nodes: [st('w', 'seen', 'add', { key: ref('item') })], acceptance: exists('w') } }],
    [{ op: 'exists', value: ref('nodes.m.count') }]);
  assert.ok(nested.includes('STATE_WRITER'), 'one writer id written from two places');
  const record = { doc: { type: 'record', maxItems: 10, writer: 'w', schema: ownerSchema } };
  assert.ok(bad(record, [st('w', 'doc', 'put', { key: 'a', value: { owner: 'x' } })]).includes('STATE_CAS_REQUIRED'), 'an overwrite names the version it read');
  assert.ok(bad(record, [st('w', 'doc', 'put', { key: 'a', value: { owner: 5 }, ifVersion: 0 })]).includes('STATE_SCHEMA'), 'a literal value is checked now');
  assert.ok(bad(record, [st('w', 'doc', 'get', { key: 'a', value: { owner: 'x' } })]).includes('WRONG_NODE_FIELD'));
  assert.ok(bad(record, [st('w', 'doc', 'put', { key: 7, value: { owner: 'x' }, ifVersion: 0 })]).includes('STATE_KEY'));
  assert.ok(bad(record, [st('w', 'doc', 'put', { key: 'a', value: { owner: 'x' }, ifVersion: -1 })]).includes('STATE_SCHEMA'));
  assert.ok(bad(record, [st('r', 'doc', 'get', { key: 'a' }), st('w', 'doc', 'put', { key: 'a', value: { owner: 'x' }, ifVersion: ref('nodes.r.version') })]).includes('UNDECLARED_DATA_DEPENDENCY'));
  assert.ok(bad({ doc: { type: 'record', maxItems: 10, writer: 'w' } }, [st('w', 'doc', 'delete', { key: 'a' })]).includes('SCHEMA'), 'a record declares its value schema');
  assert.ok(bad({ s: { type: 'set', maxItems: 10, writer: 'w', schema: {} } }, [st('w', 's', 'add', { key: 'a' })]).includes('SCHEMA'), 'a set has no values');
  assert.ok(bad({ s: { type: 'set', maxItems: 10, writer: 'w', ttlMs: 5, ttlDays: 1 } }, [st('w', 's', 'add', { key: 'a' })]).includes('SCHEMA'), 'one TTL unit');
  assert.ok(bad({ s: { type: 'set', writer: 'w' } }, [st('w', 's', 'add', { key: 'a' })]).includes('SCHEMA'), 'maxItems is required');
  assert.ok(bad({ c: { type: 'record', maxItems: 3, writer: 'w', schema: { type: 'string', pattern: '^a' } } }, [st('w', 'c', 'delete', { key: 'a' })]).includes('UNSUPPORTED_SCHEMA'));
  // The output schema of each operation is closed: a set add has no value.
  assert.ok(bad(seen, [st('w', 'seen', 'add', { key: 'a' })], [{ op: 'eq', left: ref('nodes.w.value'), right: 1 }]).includes('IMPOSSIBLE_REFERENCE'));
  // A slot may name a few writers (an upsert and an expiry), each one node.
  const two = validateWorkflow(flow('Two', { doc: { ...record.doc, writer: ['upsert', 'expire'] } }, [st('r', 'doc', 'get', { key: 'a' }),
    st('upsert', 'doc', 'put', { key: 'a', value: { owner: 'x' }, ifVersion: ref('nodes.r.version') }, ['r']), st('expire', 'doc', 'delete', { key: 'b' }, ['upsert'])], exists('upsert')), { registry });
  assert.equal(two.valid, true, JSON.stringify(two.errors));
});

test('state: integrity labels: untrusted data or control cannot write a trusted slot, and reads carry the slot label', () => {
  const labels = { 'input.id': 'untrusted:feed' };
  const write = (label, extra = {}) => validateWorkflow(flow('Taint', { seen: { type: 'set', maxItems: 10, writer: 'w', ...(label ? { label } : {}) } },
    [st('w', 'seen', 'add', { key: ref('input.id'), ...extra })], exists('w'), { labels }), { registry });
  const refused = write();
  assert.equal(refused.valid, false);
  assert.ok(refused.errors.some(e => e.code === 'LABEL_POLICY' && e.rule === 'UNTRUSTED_STATE_WRITE' && e.label === 'untrusted:feed'), JSON.stringify(refused.errors));
  assert.ok(codes(refused).includes('UNTRUSTED_STATE_WRITE'));
  assert.equal(write('untrusted:feed').valid, true, 'a slot labelled with the source takes the write');
  assert.equal(write('untrusted:feed+mail').valid, true, 'a wider label covers it');
  // Control taint: a trusted key written only when untrusted data says so.
  const guarded = validateWorkflow(flow('Guard', { seen: { type: 'set', maxItems: 10, writer: 'w' } },
    [{ ...st('w', 'seen', 'add', { key: 'fixed' }), when: { op: 'eq', left: ref('input.id'), right: 'x' } }], exists('w'), { labels }), { registry });
  assert.ok(guarded.errors.some(e => e.rule === 'UNTRUSTED_STATE_WRITE'), JSON.stringify(guarded.errors));
  // A read of an untrusted slot that decides whether an ungated effect fires is control taint.
  const effect = validateWorkflow(flow('Effect', { seen: { type: 'set', maxItems: 10, writer: 'w', label: 'untrusted:feed' } }, [
    st('r', 'seen', 'get', { key: 'fixed' }), st('w', 'seen', 'add', { key: 'fixed' }, ['r']),
    { id: 'write', kind: 'task', needs: ['r'], description: 'Write an artifact when the id was seen', when: { op: 'eq', left: ref('nodes.r.found'), right: true },
      tool: 'core.artifact', args: { name: 'seen.txt', content: 'seen' }, timeoutMs: 1000, retry: { maxAttempts: 1 } }], exists('w')), { registry });
  assert.ok(effect.errors.some(e => e.code === 'LABEL_POLICY' && e.rule === 'UNTRUSTED_CONTROL'), JSON.stringify(effect.errors));
});

test('state: a workflow with state cannot run replay-or-live, and the runtime clock must be a function', t => {
  const { store, runtime } = open(t);
  save(store, dedupe);
  assert.throws(() => runtime.create(dedupe, { id: 'a' }, { modelMode: 'replay-or-live' }), e => e.code === 'RUN_OPTIONS' && /replay-or-live/.test(e.message));
  assert.throws(() => new Runtime(store, registry, {}, { now: 5 }), e => e.code === 'POLICY');
});

// ---- semantics across runs ----------------------------------------------------------------------------------------------------------

test('state: a seen-set, a counter, a monotonic cursor and a keyed record persist across runs of one workflow', async t => {
  const { store, runtime } = open(t);
  const wf = flow('Ledger', {
    seen: { type: 'set', maxItems: 100, writer: 'mark' },
    hits: { type: 'counter', maxItems: 10, writer: 'count' },
    cursor: { type: 'cursor', maxItems: 1, writer: 'advance', monotonic: true, schema: { type: 'integer', minimum: 0 } },
    owners: { type: 'record', maxItems: 10, writer: 'claim', schema: ownerSchema }
  }, [
    st('mark', 'seen', 'add', { key: ref('input.id') }),
    st('count', 'hits', 'incr', { key: 'events', by: 2 }, ['mark']),
    st('position', 'cursor', 'get', { key: 'feed' }),
    st('advance', 'cursor', 'put', { key: 'feed', value: ref('input.offset'), ifVersion: ref('nodes.position.version') }, ['position']),
    st('owner', 'owners', 'get', { key: ref('input.id') }),
    st('claim', 'owners', 'put', { key: ref('input.id'), value: { owner: ref('input.who') }, ifVersion: ref('nodes.owner.version') }, ['owner'])
  ], [{ op: 'exists', value: ref('nodes.advance.version') }, { op: 'exists', value: ref('nodes.claim.version') }, { op: 'gte', left: ref('nodes.count.value'), right: 2 }]);
  save(store, wf);

  const first = await go(runtime, wf, { id: 'evt-1', offset: 10, who: 'ana' });
  assert.equal(first.status, 'succeeded', JSON.stringify(first.error));
  assert.deepEqual(first.outputs.mark, { added: true, version: 1 });
  assert.deepEqual(first.outputs.count, { value: 2, version: 1, previousVersion: 0 });
  assert.deepEqual(first.outputs.position, { found: false, version: 0 });
  assert.deepEqual(first.outputs.advance, { version: 1, previousVersion: 0, changed: true });
  assert.deepEqual(first.outputs.claim, { version: 1, previousVersion: 0, changed: true });

  const second = await go(runtime, wf, { id: 'evt-1', offset: 25, who: 'ben' });
  assert.equal(second.status, 'succeeded', JSON.stringify(second.error));
  assert.deepEqual(second.outputs.mark, { added: false, version: 1 }, 'the second run sees the first run\'s member');
  assert.deepEqual(second.outputs.count, { value: 4, version: 2, previousVersion: 1 });
  assert.deepEqual(second.outputs.position, { found: true, value: 10, version: 1 });
  assert.deepEqual(second.outputs.owner, { found: true, value: { owner: 'ana' }, version: 1 });
  assert.deepEqual(second.outputs.claim, { version: 2, previousVersion: 1, changed: true });

  const back = await go(runtime, wf, { id: 'evt-2', offset: 3, who: 'cy' });
  assert.equal(back.status, 'failed');
  assert.equal(back.error.code, 'STATE_CURSOR_REGRESSION', 'a monotonic cursor never moves back');
  assert.equal(back.nodes.advance.status, 'failed');
  assert.deepEqual(stateEvents(store, back.id).find(e => e.nodeKey === 'root/advance'), { ...stateEvents(store, back.id).find(e => e.nodeKey === 'root/advance'), ok: false, errorCode: 'STATE_CURSOR_REGRESSION' });
  assert.equal(store.state.entries('Ledger', 'cursor')[0].value, 25, 'the refused advance wrote nothing');
  assert.equal(back.verdict.verdict, 'harness_fault');
  for (const run of [first, second, back]) assert.equal(verifyRun(store, run.id).clean, true, JSON.stringify(verifyRun(store, run.id).findings));
});

test('state: one writer per key: a stale compare-and-swap is a typed, journaled refusal and writes nothing', async t => {
  const { store, runtime } = open(t);
  const nodes = handled => [st('read', 'doc', 'get', { key: 'k' }),
    { id: 'approve', kind: 'human', needs: ['read'], description: 'Who owns it now', question: 'New owner?', answerSchema: { type: 'string', maxLength: 64 } },
    st('write', 'doc', 'put', { key: 'k', value: { owner: ref('nodes.approve.answer') }, ifVersion: ref('nodes.read.version'), ...(handled ? { onError: 'continue' } : {}) }, ['read', 'approve'])];
  const wf = flow('Cas', { doc: { type: 'record', maxItems: 10, writer: 'write', schema: ownerSchema } }, nodes(false), exists('write'));
  save(store, wf);
  // Two runs read version 0, then wait for a person; the one answered second loses.
  const a = await go(runtime, wf), b = await go(runtime, wf);
  assert.deepEqual([a.status, b.status], ['awaiting_human', 'awaiting_human']);
  runtime.answer(b.id, 'root/approve', 'bob');
  const won = await runtime.execute(b.id);
  assert.equal(won.status, 'succeeded', JSON.stringify(won.error));
  runtime.answer(a.id, 'root/approve', 'alice');
  const lost = await runtime.execute(a.id);
  assert.equal(lost.status, 'failed');
  assert.equal(lost.error.code, 'STATE_VERSION_CONFLICT');
  assert.equal(lost.verdict.verdict, 'inconclusive', 'contention is not a harness fault');
  assert.deepEqual(store.state.entries('Cas', 'doc').map(e => [e.key, e.value, e.version]), [['k', { owner: 'bob' }, 1]], 'the loser wrote nothing');
  const [row] = store.state.opsForRun(a.id).filter(op => op.op === 'put');
  assert.deepEqual([row.ok, row.errorCode, row.result.error.details], [false, 'STATE_VERSION_CONFLICT', { slot: 'doc', expected: 0, actual: 1 }]);
  assert.equal(stateEvents(store, a.id).at(-1).errorCode, 'STATE_VERSION_CONFLICT');
  assert.equal(verifyRun(store, a.id).clean, true);

  await t.test('onError "continue" turns the refusal into an {ok:false} output the flow can route', async () => {
    const soft = { ...flow('CasSoft', { doc: { type: 'record', maxItems: 10, writer: 'write', schema: ownerSchema } }, nodes(true),
      [{ op: 'any', conditions: [{ op: 'exists', value: ref('nodes.write.version') }, { op: 'eq', left: ref('nodes.write.error.code'), right: 'STATE_VERSION_CONFLICT' }] }]) };
    save(store, soft);
    const x = await go(runtime, soft), y = await go(runtime, soft);
    runtime.answer(y.id, 'root/approve', 'yan'); await runtime.execute(y.id);
    runtime.answer(x.id, 'root/approve', 'xia');
    const run = await runtime.execute(x.id);
    assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
    assert.equal(run.nodes.write.status, 'handled_error');
    assert.equal(run.outputs.write.ok, false);
    assert.equal(run.outputs.write.error.code, 'STATE_VERSION_CONFLICT');
  });

  await t.test('create-if-absent (ifVersion 0) succeeds once; a delete and re-create never reuses a version', async () => {
    const life = flow('Life', { doc: { type: 'record', maxItems: 10, writer: ['create', 'drop'], schema: ownerSchema } }, [
      st('read', 'doc', 'get', { key: 'k' }),
      { ...st('create', 'doc', 'put', { key: 'k', value: { owner: ref('input.who') }, ifVersion: ref('input.expect'), onError: 'continue' }, ['read']), when: { op: 'eq', left: ref('input.drop'), right: false } },
      { ...st('drop', 'doc', 'delete', { key: 'k' }, ['read']), when: { op: 'eq', left: ref('input.drop'), right: true } }
    ], [{ op: 'exists', value: ref('nodes.read.version') }]);
    save(store, life);
    const one = await go(runtime, life, { who: 'p', expect: 0, drop: false });
    assert.deepEqual(one.outputs.create, { version: 1, previousVersion: 0, changed: true });
    const two = await go(runtime, life, { who: 'q', expect: 0, drop: false });
    assert.equal(two.outputs.create.error.code, 'STATE_VERSION_CONFLICT', 'the key exists');
    const dropped = await go(runtime, life, { drop: true });
    assert.deepEqual(dropped.outputs.drop, { deleted: true, previousVersion: 1 });
    const again = await go(runtime, life, { who: 'r', expect: 0, drop: false });
    assert.deepEqual(again.outputs.create, { version: 3, previousVersion: 0, changed: true }, 'the slot revision moved on: a re-created key gets a new version');
    const stale = await go(runtime, life, { who: 's', expect: 1, drop: false });
    assert.deepEqual(stale.outputs.create.error.code, 'STATE_VERSION_CONFLICT', 'version 1 was the deleted entry\'s; the re-created one is 3 (no ABA)');
    assert.deepEqual(store.state.entries('Life', 'doc').map(e => [e.value.owner, e.version]), [['r', 3]]);
  });
});

test('state: concurrent writers in one run (a map body) serialize: a duplicate id is added once', async t => {
  const { store, runtime } = open(t);
  const wf = flow('Fan', { seen: { type: 'set', maxItems: 10, writer: 'mark' }, n: { type: 'counter', maxItems: 1, writer: 'tally' } }, [
    { id: 'each', kind: 'map', needs: [], description: 'Mark each id', items: ref('input.ids'), maxItems: 16, concurrency: 4,
      body: { nodes: [st('mark', 'seen', 'add', { key: ref('item') }), st('tally', 'n', 'incr', { key: 'all' }, ['mark'])], acceptance: [{ op: 'exists', value: ref('nodes.mark.version') }] } }
  ], [{ op: 'eq', left: ref('nodes.each.count'), right: 6 }]);
  save(store, wf);
  const run = await go(runtime, wf, { ids: ['a', 'b', 'a', 'c', 'b', 'a'] });
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  const added = run.outputs.each.items.map(item => item.mark.added);
  assert.equal(added.filter(Boolean).length, 3, JSON.stringify(added));
  assert.deepEqual(run.outputs.each.items.map(item => item.tally.value).sort((x, y) => x - y), [1, 2, 3, 4, 5, 6], 'every increment applied exactly once');
  assert.deepEqual(store.state.entries('Fan', 'seen').map(e => e.key), ['a', 'b', 'c']);
  assert.equal(verifyRun(store, run.id).clean, true);
});

// ---- TTL, bounds and schemas --------------------------------------------------------------------------------------------------------

test('state: TTL expiry under a simulated clock: an expired entry reads as absent, can be re-added, and frees its room', async t => {
  const clock = { now: 1_000_000 };
  const { store, runtime } = open(t, { now: () => clock.now });
  const wf = flow('Ttl', { seen: { type: 'set', maxItems: 2, ttlMs: 1000, writer: 'mark' } }, [
    st('look', 'seen', 'get', { key: ref('input.id') }), st('mark', 'seen', 'add', { key: ref('input.id') }, ['look'])
  ], exists('mark'));
  save(store, wf);
  const at = async (now, id) => { clock.now = now; return go(runtime, wf, { id }); };
  const first = await at(1_000_000, 'a');
  assert.deepEqual(first.outputs.mark, { added: true, version: 1 });
  const fresh = await at(1_000_999, 'a');
  assert.deepEqual(fresh.outputs.look, { found: true, version: 1, expiresAt: 1_001_000 });
  assert.deepEqual(fresh.outputs.mark, { added: false, version: 1 }, 'not yet expired; an add does not refresh it');
  const expired = await at(1_001_000, 'a');
  assert.deepEqual(expired.outputs.look, { found: false, version: 0 }, 'at expiresAt the entry is gone');
  assert.deepEqual(expired.outputs.mark, { added: true, version: 2 });
  assert.equal(store.state.entries('Ttl', 'seen')[0].expiresAt, 1_002_000);

  await at(1_001_100, 'b');
  const full = await at(1_001_200, 'c');
  assert.equal(full.status, 'failed');
  assert.equal(full.error.code, 'STATE_FULL', 'two live members fill maxItems 2');
  assert.equal(full.verdict.verdict, 'inconclusive');
  assert.deepEqual(store.state.opsForRun(full.id).find(op => op.op === 'add').result.error.details, { slot: 'seen', bound: 'maxItems', limit: 2, items: 3 });
  const roomy = await at(1_002_100, 'c');
  assert.equal(roomy.status, 'succeeded', JSON.stringify(roomy.error));
  assert.deepEqual(store.state.entries('Ttl', 'seen').map(e => e.key), ['c'], 'the expired members were purged to make room');
  assert.equal(store.state.slots('Ttl')[0].items, 1);
  // Every operation journaled the clock it ran at.
  assert.deepEqual(store.state.opsForRun(roomy.id).map(op => op.at), [1_002_100, 1_002_100]);
});

test('state: bounds and schemas are typed refusals that write nothing; integrity faults are not handleable', async t => {
  const { store, runtime } = open(t);
  const wf = flow('Bounds', {
    doc: { type: 'record', maxItems: 5, maxValueBytes: 40, writer: 'put', schema: ownerSchema },
    n: { type: 'counter', maxItems: 5, writer: 'bump' }
  }, [
    st('read', 'doc', 'get', { key: ref('input.key'), onError: 'continue' }),
    // all_resolved: the put still runs (and refuses on its own) when the read refused.
    { ...st('put', 'doc', 'put', { key: ref('input.key'), value: ref('input.value'), ifVersion: { $ref: 'nodes.read.version', default: 0 }, onError: 'continue' }, ['read']), join: 'all_resolved' },
    st('bump', 'n', 'incr', { key: 'k', by: ref('input.by'), onError: 'continue' })
  ], [{ op: 'exists', value: ref('nodes.read') }]);
  save(store, wf);
  const outcome = async input => { const run = await go(runtime, wf, { key: 'k', value: { owner: 'ok' }, by: 1, ...input }); assert.equal(run.status, 'succeeded', JSON.stringify(run.error)); return run; };
  const before = snapshot(store, 'Bounds');
  const schema = await outcome({ value: { owner: 5 }, by: 0 });
  assert.equal(schema.outputs.put.error.code, 'STATE_SCHEMA');
  const long = await outcome({ value: { owner: 'x'.repeat(70) }, by: 0 });
  assert.equal(long.outputs.put.error.code, 'STATE_SCHEMA', 'maxLength 64');
  const large = await outcome({ value: { owner: 'y'.repeat(40) }, by: 0 });
  assert.equal(large.outputs.put.error.code, 'STATE_VALUE_LIMIT', 'within the schema, beyond maxValueBytes 40');
  const key = await outcome({ key: 'k'.repeat(600), by: 0 });
  assert.deepEqual([key.outputs.read.error.code, key.outputs.put.error.code], ['STATE_KEY', 'STATE_KEY'], 'a read refuses a bad key too');
  const nonString = await outcome({ key: 12, by: 0 });
  assert.equal(nonString.outputs.put.error.code, 'STATE_KEY', 'keys are strings; a number is not coerced');
  const fraction = await outcome({ value: { owner: 5 }, by: 1.5 });
  assert.equal(fraction.outputs.bump.error.code, 'STATE_SCHEMA');
  const after = snapshot(store, 'Bounds');
  assert.deepEqual(after.entries.filter(e => e.slot === 'doc'), before.entries.filter(e => e.slot === 'doc'), 'no refused write reached the slot');
  assert.ok(store.state.opsForRun(schema.id).some(op => op.errorCode === 'STATE_SCHEMA'), 'the refusal is journaled');
  for (const code of ['STATE_SCHEMA', 'STATE_VALUE_LIMIT', 'STATE_KEY']) assert.ok(STATE_REFUSALS.includes(code));

  await outcome({ by: Number.MAX_SAFE_INTEGER - 1, value: { owner: 'zed' } });
  const overflow = await outcome({ by: 5, value: { owner: 5 } });
  assert.equal(overflow.outputs.bump.error.code, 'STATE_SCHEMA', 'a counter never leaves the safe integer range');

  await t.test('a stored value edited outside the runtime is STATE_CORRUPT, which onError "continue" does not hide', async () => {
    store.db.prepare("UPDATE state_entries SET value=? WHERE workflow_id='Bounds' AND slot='doc' AND key='k'").run(JSON.stringify({ owner: 99 }));
    const run = await go(runtime, wf, { key: 'k', value: { owner: 'ok' }, by: 0 });
    assert.equal(run.status, 'failed');
    assert.equal(run.error.code, 'STATE_CORRUPT');
    assert.equal(run.verdict.verdict, 'harness_fault');
    assert.equal(run.nodes.read.status, 'failed');
    assert.deepEqual(store.state.opsForRun(run.id).filter(op => op.nodeKey === 'root/read'), [], 'a fault rolls the operation back: nothing journaled');
  });
});

test('state: a declaration change is refused while the slot holds entries and adopted once it is empty', async t => {
  const clock = { now: 5_000 };
  const { store, runtime } = open(t, { now: () => clock.now });
  const v1 = flow('Drift', { doc: { type: 'record', maxItems: 5, ttlMs: 100, writer: 'put', schema: ownerSchema } }, [
    st('read', 'doc', 'get', { key: 'k' }), st('put', 'doc', 'put', { key: 'k', value: ref('input.value'), ifVersion: ref('nodes.read.version') }, ['read'])
  ], exists('put'));
  const v2 = { ...v1, version: 2, state: { doc: { ...v1.state.doc, schema: { type: 'object', additionalProperties: false, required: ['team'], properties: { team: { type: 'string' } } } } } };
  const { hash } = store.saveWorkflow(v1);
  assert.equal((await go(runtime, v1, { value: { owner: 'ana' } })).status, 'succeeded');
  store.saveWorkflow(v2, { expectedHash: hash });
  const drift = await go(runtime, v2, { value: { team: 'red' } });
  assert.equal(drift.error.code, 'STATE_DRIFT');
  clock.now = 5_100;
  const adopted = await go(runtime, v2, { value: { team: 'red' } });
  assert.equal(adopted.status, 'succeeded', JSON.stringify(adopted.error));
  assert.deepEqual(store.state.entries('Drift', 'doc').map(e => e.value), [{ team: 'red' }]);
});

// ---- isolation ----------------------------------------------------------------------------------------------------------------------

test('state: slots are isolated between workflows and shared by the versions of one workflow', async t => {
  const { store, runtime } = open(t);
  const make = id => flow(id, { seen: { type: 'set', maxItems: 10, writer: 'mark' } }, [st('mark', 'seen', 'add', { key: ref('input.id') })], exists('mark'));
  const a = make('IsoA'), b = make('IsoB'), a2 = { ...a, version: 2, title: 'IsoA probe, second version' };
  const { hash } = store.saveWorkflow(a);
  save(store, b);
  assert.deepEqual((await go(runtime, a, { id: 'x' })).outputs.mark, { added: true, version: 1 });
  assert.deepEqual((await go(runtime, b, { id: 'x' })).outputs.mark, { added: true, version: 1 }, 'the same slot name in another workflow is another slot');
  store.saveWorkflow(a2, { expectedHash: hash });
  assert.deepEqual((await go(runtime, a2, { id: 'x' })).outputs.mark, { added: false, version: 1 }, 'a later version of IsoA sees its state');
  assert.deepEqual(store.state.slots('IsoA').map(s => [s.slot, s.items]), [['seen', 1]]);
  assert.deepEqual(store.state.slots('IsoB').map(s => [s.slot, s.items]), [['seen', 1]]);
  assert.deepEqual(store.state.slots('IsoC'), []);
});

// ---- replay -------------------------------------------------------------------------------------------------------------------------

test('state: replay serves every recorded read and write, refusals included, and writes no state', async t => {
  const { store, runtime } = open(t);
  const wf = flow('Replay', { seen: { type: 'set', maxItems: 10, writer: 'mark' }, n: { type: 'counter', maxItems: 2, writer: 'bump' },
    doc: { type: 'record', maxItems: 5, writer: 'put', schema: ownerSchema } }, [
    st('look', 'seen', 'get', { key: ref('input.id') }), st('mark', 'seen', 'add', { key: ref('input.id') }, ['look']),
    st('bump', 'n', 'incr', { key: 'all' }, ['mark']), st('read', 'doc', 'get', { key: ref('input.id') }),
    st('put', 'doc', 'put', { key: ref('input.id'), value: ref('input.value'), ifVersion: ref('nodes.read.version'), onError: 'continue' }, ['read'])
  ], [{ op: 'exists', value: ref('nodes.bump.value') }]);
  save(store, wf);
  const first = await go(runtime, wf, { id: 'a', value: { owner: 'ana' } });
  const second = await go(runtime, wf, { id: 'a', value: { owner: 7 } });
  assert.deepEqual([first.status, second.status], ['succeeded', 'succeeded']);
  assert.deepEqual([first.outputs.mark.added, second.outputs.mark.added, first.outputs.bump.value, second.outputs.bump.value], [true, false, 1, 2]);
  assert.equal(second.outputs.put.error.code, 'STATE_SCHEMA');
  const recorded = snapshot(store, 'Replay');

  for (const original of [first, second]) {
    const replay = await go(runtime, wf, original.input, { modelMode: 'replay', sampleSalt: original.sampleSalt });
    assert.equal(replay.status, 'succeeded', JSON.stringify(replay.error));
    assert.deepEqual(replay.outputs, original.outputs, 'the replay reproduces what the recording read and wrote');
    assert.deepEqual(replay.nodes.put.status, original.nodes.put.status);
    const events = stateEvents(store, replay.id);
    assert.equal(events.length, 5);
    assert.ok(events.every(e => e.replayed === true && e.replaySource.check === 'bound' && e.replaySource.runId === original.id), JSON.stringify(events));
    assert.deepEqual(events.map(e => [e.nodeKey, e.ok, e.errorCode ?? null]), stateEvents(store, original.id).map(e => [e.nodeKey, e.ok, e.errorCode ?? null]));
    assert.equal(verifyRun(store, replay.id).clean, true, JSON.stringify(verifyRun(store, replay.id).findings));
  }
  assert.deepEqual(snapshot(store, 'Replay'), recorded, 'replays wrote no state');

  await t.test('a replay whose request differs from every recording misses and stops as a harness fault', async () => {
    const miss = await go(runtime, wf, { id: 'z', value: { owner: 'zed' } }, { modelMode: 'replay', sampleSalt: first.sampleSalt });
    assert.equal(miss.error.code, 'REPLAY_MISS');
    assert.equal(miss.verdict.verdict, 'harness_fault');
    assert.deepEqual(snapshot(store, 'Replay'), recorded);
  });
  await t.test('an edited recording is refused, and verify-run reports the edit on the recording run', async () => {
    const op = store.state.opsForRun(first.id).find(o => o.op === 'add');
    store.db.prepare('UPDATE state_ops SET result=? WHERE id=?').run(JSON.stringify({ ok: true, output: { added: false, version: 1 } }), op.id);
    const refused = await go(runtime, wf, first.input, { modelMode: 'replay', sampleSalt: first.sampleSalt });
    assert.equal(refused.error.code, 'JOURNAL_TAMPERED');
    const report = verifyRun(store, first.id);
    assert.equal(report.ok, false);
    assert.ok(report.findings.some(f => f.code === 'STATE_OP_EDITED' && f.opId === op.id), JSON.stringify(report.findings));
  });
  await t.test('a row planted for a run is reported unbound', () => {
    store.db.prepare("INSERT INTO state_ops(replay_key, run_id, node_key, workflow_id, slot, op, request, result, ok, error_code, at, replayed_from, created_at) VALUES('x', ?, 'root/mark', 'Replay', 'seen', 'add', '{}', '{}', 1, NULL, 0, NULL, 0)").run(second.id);
    assert.ok(verifyRun(store, second.id).findings.some(f => f.code === 'STATE_OP_UNBOUND'));
  });
});

// ---- crash and resume ---------------------------------------------------------------------------------------------------------------

const src = file => JSON.stringify(new URL(`../src/${file}`, import.meta.url).href);
const childCode = `import { Store } from ${src('store.mjs')};
import { Runtime } from ${src('runtime.mjs')};
import { createDefaultRegistry } from ${src('capabilities.mjs')};
const [workspace, runId] = process.argv.slice(1);
await new Runtime(new Store(workspace), createDefaultRegistry(), {}).execute(runId);`;
const childEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', NODE_NO_WARNINGS: '1' };
const counter = flow('Crash', { n: { type: 'counter', maxItems: 2, writer: 'count' } }, [
  st('count', 'n', 'incr', { key: 'all' }), st('look', 'n', 'get', { key: 'all' }, ['count'])
], [{ op: 'eq', left: ref('nodes.look.value'), right: ref('nodes.count.value') }]);

test('state: a process killed inside the write transaction loses the whole operation; resume applies it exactly once', async t => {
  const { root, store, runtime } = open(t);
  save(store, counter);
  const created = runtime.create(counter, {}, { extra: { crashInStateOp: 'root/count' } });
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childCode, root, created.id], { encoding: 'utf8', timeout: 20000, env: childEnv });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  assert.deepEqual(snapshot(store, 'Crash').entries, [], 'the increment did not commit');
  assert.deepEqual(store.state.opsForRun(created.id), [], 'nor did its journal row');
  const crashed = store.run(created.id);
  assert.equal(crashed.nodes.count.status, 'running');
  assert.equal(stateEvents(store, created.id).length, 0);
  store.updateRun(created.id, run => { delete run.extra.crashInStateOp; }, { type: 'test.crash-injection-disabled' });
  const run = await runtime.execute(created.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual([run.outputs.count.value, run.outputs.look.value], [1, 1]);
  assert.equal(run.nodes.count.attempts, 1, 'the resumed node was not charged again');
  assert.deepEqual(store.state.opsForRun(created.id).map(op => op.op), ['incr', 'get']);
  assert.equal(verifyRun(store, run.id).clean, true, JSON.stringify(verifyRun(store, run.id).findings));
});

test('state: a process killed right after the write committed is not re-applied on resume', async t => {
  const { root, store, runtime } = open(t);
  save(store, counter);
  const created = runtime.create(counter, {}, { extra: { crashAfterStateOp: 'root/count' } });
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childCode, root, created.id], { encoding: 'utf8', timeout: 20000, env: childEnv });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  assert.deepEqual(store.state.entries('Crash', 'n').map(e => e.value), [1], 'the increment committed with its node');
  assert.equal(store.run(created.id).nodes.count.status, 'completed');
  store.updateRun(created.id, run => { delete run.extra.crashAfterStateOp; }, { type: 'test.crash-injection-disabled' });
  const run = await runtime.execute(created.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual([run.outputs.count.value, run.outputs.look.value], [1, 1]);
  assert.deepEqual(store.state.entries('Crash', 'n').map(e => e.value), [1], 'resume did not increment again');
  assert.deepEqual(store.state.opsForRun(created.id).map(op => op.op), ['incr', 'get']);
  assert.equal(verifyRun(store, run.id).clean, true);
});

test('state: writers in separate processes serialize: every increment lands once and one claim wins', async t => {
  const { root, store } = open(t);
  const wf = flow('Concurrent', { n: { type: 'counter', maxItems: 1, writer: 'count' }, claims: { type: 'set', maxItems: 1, writer: 'claim' } }, [
    st('count', 'n', 'incr', { key: 'all' }), st('claim', 'claims', 'add', { key: 'winner' })
  ], exists('count'));
  save(store, wf);
  const perProcess = 6, processes = 3;
  const code = `import { Store } from ${src('store.mjs')};
import { Runtime } from ${src('runtime.mjs')};
import { createDefaultRegistry } from ${src('capabilities.mjs')};
const [workspace, count] = process.argv.slice(1);
const store = new Store(workspace), runtime = new Runtime(store, createDefaultRegistry(), {}), { workflow } = store.workflow('Concurrent'), out = [];
for (let i = 0; i < Number(count); i++) { const run = await runtime.execute(runtime.create(workflow, {}).id); out.push({ status: run.status, error: run.error, count: run.outputs.count, claim: run.outputs.claim }); }
process.stdout.write(JSON.stringify(out));`;
  const results = await Promise.all(Array.from({ length: processes }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, root, String(perProcess)], { env: childEnv });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', status => status === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(`child exited ${status}: ${stderr}`)));
  })));
  const runs = results.flat();
  assert.equal(runs.length, perProcess * processes);
  assert.ok(runs.every(r => r.status === 'succeeded'), JSON.stringify(runs.filter(r => r.status !== 'succeeded')));
  assert.deepEqual(runs.map(r => r.count.value).sort((a, b) => a - b), Array.from({ length: runs.length }, (_, i) => i + 1), 'no increment lost or doubled');
  assert.equal(runs.filter(r => r.claim.added).length, 1, 'exactly one run added the claim');
  assert.deepEqual(store.state.entries('Concurrent', 'n').map(e => e.value), [runs.length]);
});

test('state: a read of an untrusted slot carries its label at run time', async t => {
  const { store, runtime } = open(t);
  const wf = flow('Label', { seen: { type: 'set', maxItems: 10, writer: 'mark', label: 'untrusted:feed' } }, [
    st('mark', 'seen', 'add', { key: ref('input.id') }), st('look', 'seen', 'get', { key: ref('input.id') }, ['mark'])
  ], exists('look'), { labels: { 'input.id': 'untrusted:feed' } });
  save(store, wf);
  const run = await go(runtime, wf, { id: 'evt' });
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(run.nodes.look.outputLabel, 'untrusted:feed');
  assert.equal(run.nodes.mark.outputLabel, 'untrusted:feed');
});
