// Verify method "ledger" (src/ledger.mjs): the engine-owned coverage check for a fan-out. Pure checks of the verdict,
// validation of the node, and end-to-end runs where a mutated reader (drops a unit, reads one twice, invents one,
// fails) must fail the gate. Development evidence (synthetic inventories), not sealed evaluation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ledgerVerdict, LEDGER_LIMITS } from '../src/ledger.mjs';
import { Store } from '../src/store.mjs';
import { Runtime } from '../src/runtime.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { validateWorkflow } from '../src/validate.mjs';
import { loadPolicy } from '../src/models/policy.mjs';

const loaded = loadPolicy();
const item = ids => ({ read: { readIds: ids } });

test('ledger verdict: every unit read once passes with a full count', () => {
  const v = ledgerVerdict({ items: [item(['a', 'b']), item(['c'])], count: 2 }, ['a', 'b', 'c'], { reads: 'read.readIds' });
  assert.equal(v.pass, true); assert.equal(v.score, 1); assert.deepEqual(v.reasons, []);
  assert.deepEqual({ units: v.ledger.units, covered: v.ledger.covered, missing: v.ledger.missing, items: v.ledger.items }, { units: 3, covered: 3, missing: 0, items: 2 });
});

test('ledger verdict: a unit never read fails, scores the covered share and names the unit', () => {
  const v = ledgerVerdict([item(['a', 'b'])], ['a', 'b', 'c', 'd'], { reads: 'read.readIds' });
  assert.equal(v.pass, false); assert.equal(v.score, 0.5);
  assert.deepEqual(v.ledger.missingIds, ['c', 'd']); assert.match(v.reasons.join(' '), /2 of 4 units were never read: "c", "d"/);
});

test('ledger verdict: reading a unit more than maxReads times fails; maxReads 2 admits a planned second reading', () => {
  const subject = [item(['a', 'b']), item(['b'])];
  const once = ledgerVerdict(subject, ['a', 'b'], { reads: 'read.readIds' });
  assert.equal(once.pass, false); assert.deepEqual(once.ledger.overReadIds, ['b']); assert.match(once.reasons[0], /read more than 1 time/);
  assert.equal(ledgerVerdict(subject, ['a', 'b'], { reads: 'read.readIds', maxReads: 2 }).pass, true);
  // One reader listing a unit twice is one reading of it.
  assert.equal(ledgerVerdict([item(['a', 'a', 'b'])], ['a', 'b'], { reads: 'read.readIds' }).pass, true);
});

test('ledger verdict: a read id outside the inventory fails (a reader invented or mis-copied it)', () => {
  const v = ledgerVerdict([item(['a', 'b', 'zz'])], ['a', 'b'], { reads: 'read.readIds' });
  assert.equal(v.pass, false); assert.equal(v.score, 1); assert.deepEqual(v.ledger.unknownIds, ['zz']);
});

test('ledger verdict: failed and malformed items fail, even when every unit appears elsewhere', () => {
  const failed = ledgerVerdict({ items: [item(['a', 'b']), { $error: { code: 'X' } }], count: 2, failed: 1 }, ['a', 'b'], { reads: 'read.readIds' });
  assert.equal(failed.pass, false); assert.equal(failed.ledger.failedItems, 1); assert.match(failed.reasons[0], /1 item failed/);
  // A map's declared failed count is honoured even if the $error items were filtered out upstream.
  assert.equal(ledgerVerdict({ items: [item(['a', 'b'])], count: 1, failed: 2 }, ['a', 'b'], { reads: 'read.readIds' }).ledger.failedItems, 2);
  const malformed = ledgerVerdict([item(['a', 'b']), { read: { readIds: 'a' } }, { read: {} }, item(['b', 7])], ['a', 'b'], { reads: 'read.readIds' });
  assert.equal(malformed.pass, false); assert.equal(malformed.ledger.malformedItems, 3);
});

test('ledger verdict: a bad inventory, subject or path fails closed; an empty inventory needs allowEmpty', () => {
  assert.match(ledgerVerdict([item(['a'])], ['a', 'a'], { reads: 'read.readIds' }).reasons[0], /more than once/);
  assert.match(ledgerVerdict([item(['a'])], ['a', ''], { reads: 'read.readIds' }).reasons[0], /list of unit ids/);
  assert.match(ledgerVerdict([item(['a'])], 'a', { reads: 'read.readIds' }).reasons[0], /list of unit ids/);
  assert.match(ledgerVerdict({ nope: 1 }, ['a'], { reads: 'read.readIds' }).reasons[0], /not a list of items/);
  assert.match(ledgerVerdict([item(['a'])], ['a'], { reads: 'read..readIds' }).reasons[0], /dotted path/);
  const empty = ledgerVerdict([], [], { reads: 'read.readIds' });
  assert.equal(empty.pass, false); assert.match(empty.reasons[0], /inventory is empty/);
  assert.equal(ledgerVerdict([], [], { reads: 'read.readIds', allowEmpty: true }).pass, true);
});

test('ledger verdict: reasons and listed ids stay bounded for very large inventories', () => {
  const units = Array.from({ length: 5000 }, (_, i) => `src/module-${i}/file-${i}.ts`);
  const v = ledgerVerdict([item(units.slice(0, 10))], units, { reads: 'read.readIds' });
  assert.equal(v.pass, false); assert.equal(v.ledger.missing, 4990); assert.equal(v.ledger.missingIds.length, LEDGER_LIMITS.listedIds);
  assert.ok(v.reasons.length <= 32 && v.reasons.every(r => r.length <= 1000)); assert.match(v.reasons.join(' '), /and 4980 more/);
});

// --- the node: validation and end-to-end runs ---------------------------------------------------------------------
const plan = { id: 'plan', kind: 'code', needs: [], description: 'Inventory and shards by code', lang: 'js', args: { units: { $ref: 'input.units' } },
  source: 'export default function main(input) { const u = input.units; const shards = []; for (let i = 0; i < u.length; i += 2) shards.push(u.slice(i, i + 2)); return { units: u, shards }; }',
  returns: { type: 'object', required: ['units', 'shards'], properties: { units: { type: 'array', items: { type: 'string' } }, shards: { type: 'array', items: { type: 'array', items: { type: 'string' } } } } } };
const audit = { id: 'audit', kind: 'map', needs: ['plan'], description: 'Read each shard', items: { $ref: 'nodes.plan.shards' }, maxItems: 100, concurrency: 2, failure: 'collect',
  body: { nodes: [{ id: 'read', kind: 'code', needs: [], description: 'Read the units of one shard and return the ids read', lang: 'js', args: { ids: { $ref: 'item' } },
    source: 'export default function main(input) { return { readIds: input.ids }; }',
    returns: { type: 'object', required: ['readIds'], properties: { readIds: { type: 'array', items: { type: 'string' } } } } }], acceptance: [{ op: 'exists', value: { $ref: 'nodes.read.readIds' } }] } };
const covered = (extra = {}) => ({ id: 'covered', kind: 'verify', needs: ['plan', 'audit'], description: 'Every inventory unit read exactly once', method: 'ledger', independence: 'execution',
  subject: { $ref: 'nodes.audit' }, ledger: { inventory: { $ref: 'nodes.plan.units' }, reads: 'read.readIds' }, ...extra });
const workflow = (nodes, acceptance) => ({ schemaVersion: '1.0', id: 'LedgerProbe', version: 1, title: 'Ledger probe', goal: 'Prove a fan-out covered its inventory', domain: 'general',
  envelope: { assumptions: ['Synthetic unit ids'], risks: ['A shard is dropped or read twice'], successCriteria: ['Every unit read exactly once'] },
  budget: { maxSteps: 200, maxConcurrency: 4, maxDurationMs: 60000 }, nodes, acceptance,
  inputSchema: { type: 'object', required: ['units'], properties: { units: { type: 'array', items: { type: 'string' } } } } });
const gated = [{ op: 'eq', left: { $ref: 'nodes.covered.pass' }, right: true }, { op: 'eq', left: { $ref: 'nodes.audit.failed' }, right: 0 }];
const check = wf => validateWorkflow(wf, { registry: createDefaultRegistry(), modelPolicy: loaded });

test('a ledger verifier validates; it must be an execution check with an inventory in reach and a dotted reads path', () => {
  const ok = check(workflow([plan, audit, covered()], gated));
  assert.equal(ok.valid, true, JSON.stringify(ok.errors));
  const codes = wf => check(wf).errors.map(e => e.code);
  assert.ok(codes(workflow([plan, audit, covered({ independence: 'different-model' })], gated)).includes('VERIFY_INDEPENDENCE'));
  const { ledger: _, ...noLedger } = covered();
  assert.ok(codes(workflow([plan, audit, noLedger], gated)).length > 0, 'a ledger verifier without ledger must not validate');
  // The inventory must come from a node the verifier depends on (directly or through its ancestors).
  const other = { ...plan, id: 'other', description: 'An unrelated inventory' };
  assert.ok(codes(workflow([plan, other, audit, covered({ ledger: { inventory: { $ref: 'nodes.other.units' }, reads: 'read.readIds' } })], gated)).includes('UNDECLARED_DATA_DEPENDENCY'));
  assert.ok(codes(workflow([plan, audit, covered({ source: 'x', lang: 'js' })], gated)).includes('WRONG_NODE_FIELD'));
  assert.ok(codes(workflow([plan, audit, covered({ ledger: { inventory: { $ref: 'nodes.plan.units' }, reads: 'read..readIds' } })], gated)).length > 0);
  assert.ok(codes(workflow([plan, audit, covered({ ledger: { inventory: { $ref: 'nodes.plan.units' }, reads: 'read.readIds', maxReads: 0 } })], gated)).length > 0);
});

// The plan and reader code run through a code-runner double here (the sandbox itself is tested elsewhere); `mutate`
// changes what a reader returns for a given shard index, to show the gate catches each kind of coverage defect.
function run(t, wf, units, mutate = () => null) {
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-ledger-'));
  const store = new Store(root), registry = createDefaultRegistry();
  let shard = 0;
  const codeRunner = async spec => {
    if (spec.input.units) { const u = spec.input.units, shards = []; for (let i = 0; i < u.length; i += 2) shards.push(u.slice(i, i + 2)); return { value: { units: u, shards }, stderr: '', elapsedMs: 0 }; }
    const index = shard++, changed = mutate(index, spec.input.ids);
    if (changed instanceof Error) throw changed;
    return { value: { readIds: changed ?? spec.input.ids }, stderr: '', elapsedMs: 0 };
  };
  const runtime = new Runtime(store, registry, { maxCost: 0, allowedCapabilities: [] }, { modelPolicy: loaded, codeRunner });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const v = check(wf); assert.equal(v.valid, true, JSON.stringify(v.errors));
  store.saveWorkflow(wf);
  const created = runtime.create(wf, { units });
  return runtime.execute(created.id).then(r => ({ r, store }));
}
const units = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'];

test('end to end: a fan-out that reads every unit once passes the ledger gate and records the ledger', async t => {
  const { r } = await run(t, workflow([plan, audit, covered()], gated), units);
  assert.equal(r.status, 'succeeded', JSON.stringify(r.error));
  assert.equal(r.outputs.covered.pass, true); assert.equal(r.outputs.covered.independence, 'execution');
  assert.equal(r.outputs.covered.ledger.units, 5); assert.equal(r.outputs.covered.ledger.covered, 5); assert.equal(r.outputs.covered.ledger.items, 3);
});

for (const [name, mutate, field] of [
  ['drops a unit', (i, ids) => (i === 1 ? ids.slice(1) : null), 'missing'],
  ['reads a unit already read', (i, ids) => (i === 2 ? [...ids, 'a.ts'] : null), 'overRead'],
  ['invents a unit', (i, ids) => (i === 0 ? [...ids, 'z.ts'] : null), 'unknown'],
]) {
  test(`end to end: a reader that ${name} fails the gated run`, async t => {
    const { r, store } = await run(t, workflow([plan, audit, covered()], gated), units, mutate);
    assert.equal(r.status, 'failed'); assert.equal(r.error.code, 'VERIFY_FAILED');
    const failed = store.events(r.id).find(e => e.type === 'verify.failed');
    assert.ok(failed, 'the verify.failed event carries the verdict'); assert.equal(failed.output.ledger[field], 1);
  });
}

test('end to end: a failed shard (failure collect) fails the ledger even though the map completed', async t => {
  const { r } = await run(t, workflow([plan, audit, covered({ gate: false })], [{ op: 'eq', left: { $ref: 'nodes.covered.pass' }, right: false }]), units,
    i => (i === 1 ? new Error('reader crashed') : null));
  assert.equal(r.status, 'succeeded', JSON.stringify(r.error));
  assert.equal(r.outputs.audit.failed, 1); assert.equal(r.outputs.covered.pass, false);
  assert.equal(r.outputs.covered.ledger.failedItems, 1); assert.deepEqual(r.outputs.covered.ledger.missingIds, ['c.ts', 'd.ts']);
});
