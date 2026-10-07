// ownerci hidden regression tests for experiments/lib/distill.mjs. Authored for the bed from the
// ORIGINAL module's behaviour at the frozen commit; never shown to solvers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { leafAgreement, nodeIdOf, referenceCalls, searchNode } from './experiments/lib/distill.mjs';

test('hidden distill: nodeIdOf strips only numeric map indices at segment ends', () => {
  assert.equal(nodeIdOf('a:1'), 'a');
  assert.equal(nodeIdOf('x:12/y:3'), 'x/y');
  assert.equal(nodeIdOf('a:1b/c'), 'a:1b/c');
  assert.equal(nodeIdOf('a:/b'), 'a:/b');
  assert.equal(nodeIdOf('plain/path'), 'plain/path');
});

test('hidden distill: leafAgreement on scalars, empty containers and type mismatches', () => {
  assert.equal(leafAgreement(5, 5), 1);
  assert.equal(leafAgreement('a', ' a '), 1);
  assert.equal(leafAgreement({}, {}), 1);
  assert.equal(leafAgreement({ a: [] }, { a: [] }), 1);
  assert.equal(leafAgreement({ a: {} }, { a: [] }), 0);
  assert.equal(leafAgreement({ a: 1 }, { a: '1' }), 0);
  assert.equal(leafAgreement({ a: null }, { a: null }), 1);
  assert.equal(leafAgreement({ a: true, b: false }, { a: true, b: true }), 0.5);
  assert.equal(leafAgreement({ a: 1 }, null), 0);
  assert.equal(leafAgreement([1, 2, 3, 4], [1, 2]), 0.5);
});

test('hidden distill: extra candidate leaves count against agreement', () => {
  assert.equal(leafAgreement({ a: 1 }, { a: 1, b: 2, c: 3 }), 1 / 3);
  assert.equal(leafAgreement({ a: { b: 1 } }, { a: { b: 1, c: 2 } }), 0.5);
  assert.equal(leafAgreement([1], [1, 2, 3]), 1 / 3);
  assert.equal(leafAgreement({ a: 1, b: 2 }, { b: 2, x: 1 }), 1 / 3);
});

test('hidden distill: numeric tolerance is relative above 1 and absolute below', () => {
  assert.equal(leafAgreement({ x: 1000 }, { x: 1000.0000001 }), 1);
  assert.equal(leafAgreement({ x: 1 }, { x: 1 + 1e-8 }), 0);
  assert.equal(leafAgreement({ x: 0 }, { x: 1e-10 }), 1);
  assert.equal(leafAgreement({ x: -2000 }, { x: -2000.000001 }), 1);
  assert.equal(leafAgreement({ x: 1 }, { x: 1.05 }, { relTol: 0.1 }), 1);
  assert.equal(leafAgreement({ x: 1 }, { x: 1.05 }, { relTol: 0.01 }), 0);
  assert.equal(leafAgreement({ s: 'ABC' }, { s: 'abc' }, { normalize: s => s.toLowerCase() }), 1);
  assert.equal(leafAgreement({ s: 'a ' }, { s: 'a' }, { normalize: s => s }), 0);
});

function journalFile(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'distill-hidden-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'journal.db');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE model_calls(id INTEGER PRIMARY KEY, run_id TEXT, node_key TEXT, model_id TEXT, request TEXT, response TEXT, ok INT,
    cost_usd REAL, imputed_usd REAL, latency_ms INT)`);
  const ins = db.prepare('INSERT INTO model_calls(run_id,node_key,model_id,request,response,ok,cost_usd,imputed_usd,latency_ms) VALUES(?,?,?,?,?,?,?,?,?)');
  const J = v => (v === undefined ? null : JSON.stringify(v));
  ins.run('r1', 'root/extract:0/read', 'big', J({ system: 'S', prompt: 'P1', schema: { type: 'object' } }), J({ value: { a: 1 } }), 1, 0.1, 0.2, 30);
  ins.run('r1', 'root/extract:1/read', 'big', J({ prompt: 'failed' }), J({ value: 0 }), 0, 0.1, 0, 5);
  ins.run('r1', 'root/extract:1/read', 'big', J({ prompt: 'P2' }), J({ value: 2 }), 1, null, null, null);
  ins.run('r2', 'root/summarise', 'big', J({ prompt: 'P3' }), J({ value: 3 }), 1, 0.3, 0, 7);
  ins.run('r2', 'root/summarise', 'big', J({ system: 'no prompt' }), J({ value: 4 }), 1, 0, 0, 1);
  ins.run('r2', 'root/summarise', 'big', J({ prompt: 'P4', replayOf: 5 }), J({ value: 5 }), 1, 0, 0, 1);
  ins.run('r2', 'root/summarise', 'big', J({ prompt: 'P5' }), J({ value: 6, replayedFrom: 2 }), 1, 0, 0, 1);
  ins.run('r3', 'root/extract:2/read', 'mid', J({ prompt: 'P6', replayOf: null }), J({ value: 7 }), 1, 0, 0, 2);
  ins.run('r3', 'root/extract:3/read', 'mid', null, J({ value: 8 }), 1, 0, 0, 2);
  db.close();
  return file;
}

test('hidden distill: referenceCalls keeps successful, non-replayed agent calls grouped by node', t => {
  const file = journalFile(t);
  const all = referenceCalls(file);
  assert.deepEqual([...all.keys()], ['root/extract/read', 'root/summarise']);
  assert.deepEqual(all.get('root/extract/read'), [
    { runId: 'r1', nodeKey: 'root/extract:0/read', modelId: 'big', system: 'S', prompt: 'P1', schema: { type: 'object' }, value: { a: 1 }, costUsd: 0.1, imputedUsd: 0.2, latencyMs: 30 },
    { runId: 'r1', nodeKey: 'root/extract:1/read', modelId: 'big', system: '', prompt: 'P2', schema: undefined, value: 2, costUsd: 0, imputedUsd: 0, latencyMs: 0 },
    { runId: 'r3', nodeKey: 'root/extract:2/read', modelId: 'mid', system: '', prompt: 'P6', schema: undefined, value: 7, costUsd: 0, imputedUsd: 0, latencyMs: 2 }]);
  assert.deepEqual(all.get('root/summarise').map(c => c.prompt), ['P3']);
  assert.deepEqual([...referenceCalls(file, { runIds: ['r1'] }).keys()], ['root/extract/read']);
  assert.equal(referenceCalls(file, { runIds: ['r1'] }).get('root/extract/read').length, 2);
  assert.deepEqual([...referenceCalls(file, { nodes: ['root/summarise'] }).keys()], ['root/summarise']);
  assert.equal(referenceCalls(file, { runIds: ['r9'] }).size, 0);
  assert.throws(() => referenceCalls(path.join(path.dirname(file), 'missing.db')));
});

const callsOf = n => Array.from({ length: n }, (_, i) => ({ system: `s${i}`, prompt: `p${i}`, schema: { type: 'object' }, value: { v: i } }));
function port(behaviour) {
  const seen = [];
  return { seen, call: async req => { seen.push(req); return behaviour(req, Number(req.prompt.slice(1))); } };
}

test('hidden distill: searchNode request shape, rounds beyond the sample and the cheapest survivor', async () => {
  const p = port(({ modelId }, i) => (modelId === 'flaky' && i === 3 ? { ok: false, error: { code: 'MODEL_TIMEOUT' } }
    : { ok: true, value: { v: i }, costUsd: 0.5, imputedUsd: 0.25, latencyMs: 10 }));
  const lines = [];
  const r = await searchNode({ node: 'n', calls: callsOf(5), candidates: ['flaky', 'good'], modelPort: p, runId: 'run', rounds: [2, 4, 16], log: l => lines.push(l) });
  assert.equal(r.node, 'n'); assert.equal(r.sampleSize, 5); assert.equal(r.threshold, 0.98); assert.equal(r.assigned, 'good');
  const [flaky, good] = r.candidates;
  assert.deepEqual([flaky.n, flaky.errors, flaky.alive, flaky.agreement], [4, 1, false, 0.75]);
  assert.deepEqual([good.n, good.errors, good.alive, good.agreement], [5, 0, true, 1]);
  assert.equal(good.costUsd, 2.5); assert.equal(good.imputedUsd, 1.25); assert.equal(good.latencyMs, 50); assert.equal(good.unitCostUsd, 0.75);
  assert.deepEqual(flaky.samples[3], { index: 3, ok: false, agreement: 0, error: 'MODEL_TIMEOUT' });
  assert.deepEqual(good.samples.map(s => s.index), [0, 1, 2, 3, 4]);
  assert.deepEqual(p.seen[0], { runId: 'run', nodeKey: 'distill/n/flaky/0', attempt: 0, modelId: 'flaky', system: 's0', prompt: 'p0', schema: { type: 'object' }, decoding: { reasoning: 'none' } });
  assert.deepEqual(p.seen.map(s => s.nodeKey).slice(4, 8), ['distill/n/flaky/2', 'distill/n/flaky/3', 'distill/n/good/2', 'distill/n/good/3']);
  assert.equal(p.seen.length, 4 + 5);
  assert.deepEqual(lines, ['n flaky n=2 agreement=1.0000 errors=0 alive', 'n good n=2 agreement=1.0000 errors=0 alive',
    'n flaky n=4 agreement=0.7500 errors=1 dropped', 'n good n=4 agreement=1.0000 errors=0 alive', 'n good n=5 agreement=1.0000 errors=0 alive']);
});

test('hidden distill: threshold and error-rate boundaries are inclusive for survival', async () => {
  const exact = await searchNode({ node: 'n', calls: callsOf(4), candidates: ['a'], modelPort: port(() => ({ ok: true, value: {} })), runId: 'r',
    rounds: [4], agreement: () => 0.98 });
  assert.equal(exact.assigned, 'a');
  const below = await searchNode({ node: 'n', calls: callsOf(4), candidates: ['a'], modelPort: port(() => ({ ok: true, value: {} })), runId: 'r',
    rounds: [4], agreement: () => 0.979 });
  assert.equal(below.assigned, null);
  const halfErrors = await searchNode({ node: 'n', calls: callsOf(2), candidates: ['a'], modelPort: port((req, i) => ({ ok: i === 0, value: {} })), runId: 'r',
    rounds: [2], threshold: 0, maxErrorRate: 0.5 });
  assert.equal(halfErrors.assigned, 'a');
  assert.equal(halfErrors.candidates[0].errors, 1);
  const tooMany = await searchNode({ node: 'n', calls: callsOf(3), candidates: ['a'], modelPort: port((req, i) => ({ ok: i === 0, value: {} })), runId: 'r',
    rounds: [3], threshold: 0, maxErrorRate: 0.5 });
  assert.equal(tooMany.assigned, null);
});

test('hidden distill: searchNode stops early when every candidate is dropped and handles empty samples', async () => {
  const p = port(() => ({ ok: true, value: { v: -1 } }));
  const r = await searchNode({ node: 'n', calls: callsOf(10), candidates: ['x', 'y'], modelPort: p, runId: 'r', rounds: [2, 6, 10] });
  assert.equal(r.assigned, null); assert.equal(r.sampleSize, 2); assert.equal(p.seen.length, 4);
  assert.deepEqual(r.candidates.map(c => [c.model, c.n, c.alive]), [['x', 2, false], ['y', 2, false]]);
  const none = await searchNode({ node: 'n', calls: [], candidates: ['x', 'y'], modelPort: p, runId: 'r', rounds: [2] });
  assert.equal(none.sampleSize, 0); assert.equal(none.assigned, 'x');
  assert.deepEqual(none.candidates.map(c => [c.n, c.agreement, c.unitCostUsd]), [[0, 0, null], [0, 0, null]]);
  const short = await searchNode({ node: 'n', calls: callsOf(3), candidates: ['z'], modelPort: port((req, i) => ({ ok: true, value: { v: i } })), runId: 'r', rounds: [8] });
  assert.equal(short.assigned, 'z'); assert.equal(short.sampleSize, 3); assert.equal(short.candidates[0].n, 3);
  assert.equal(short.candidates[0].unitCostUsd, 0);
});

// ---- added by the 2026-10-07 audit (AUDIT.md F7)
test('hidden distill: the tolerance comparison is inclusive and its absolute floor is exactly 1', () => {
  assert.equal(leafAgreement(1, 1, { relTol: 0 }), 1);
  assert.equal(leafAgreement({ x: 3 }, { x: 3 }, { relTol: 0 }), 1);
  assert.equal(leafAgreement({ x: 0.5 }, { x: 0.5 + 1.5e-9 }), 0);
  assert.equal(leafAgreement({ x: 2 }, { x: 2 + 1.5e-9 }), 1);
});

test('hidden distill: searchNode defaults (rounds 4/8/16, error rate 0.1) and missing cost fields', async () => {
  const p = port(({ modelId }, i) => (modelId === 'flaky' && i === 9 ? { ok: false, error: { code: 'MODEL_TIMEOUT' } } : { ok: true, value: { v: i } }));
  const r = await searchNode({ node: 'n', calls: callsOf(10), candidates: ['flaky', 'good'], modelPort: p, runId: 'run', threshold: 0.5 });
  const [flaky, good] = r.candidates;
  assert.deepEqual([flaky.n, flaky.errors, flaky.alive], [10, 1, true], 'an error rate of exactly 0.1 survives the default');
  assert.equal(r.assigned, 'flaky');
  assert.deepEqual([good.costUsd, good.imputedUsd, good.latencyMs, good.unitCostUsd], [0, 0, 0, 0]);
  const big = await searchNode({ node: 'n', calls: callsOf(20), candidates: ['good'], modelPort: port((req, i) => ({ ok: true, value: { v: i } })), runId: 'run' });
  assert.equal(big.sampleSize, 16);
  const seen = [];
  await searchNode({ node: 'n', calls: callsOf(20), candidates: ['bad'], modelPort: port((req, i) => (seen.push(i), { ok: true, value: { v: -1 } })), runId: 'run' });
  assert.equal(seen.length, 4, 'the first default round has 4 calls');
  const second = await searchNode({ node: 'n', calls: callsOf(20), candidates: ['late'], modelPort: port((req, i) => (i === 5 ? { ok: false, error: { code: 'X' } } : { ok: true, value: { v: i } })),
    runId: 'run', threshold: 0 });
  assert.deepEqual([second.candidates[0].n, second.candidates[0].alive], [8, false], 'the second default round ends at 8 calls (1/8 errors > 0.1)');
});
