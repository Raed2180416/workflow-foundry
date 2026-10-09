// T8 (LIBRARY-TESTS §2): lifecycle rules hold (LIBRARY §7). The registry is the call host's registry (createCallHost
// from experiments/jit/call-host.mjs, unchanged, stub mode). $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCallHost } from '../../jit/call-host.mjs';
import { openLibrary, TRANSITIONS, STATUSES, breakerCheck } from '../store.mjs';
import { buildIndex } from '../index.mjs';
import { tmp, clock, registerSum, makeKept, IN, OUT } from './helpers.mjs';

const ENV = { policyHash: 'p1', engineTree: 'e1', models: ['claude-haiku-5-5'] };
const callOf = (hash, input = { rows: [{ amount: 12 }, { amount: 5 }] }) => ({ v: 1, op: 'call', callee: hash, input, name: 'sum', budgetUsd: 0.1 });

test('T8: a revoked hash is refused by the call host (and stays revoked when the library is reopened)', async t => {
  const dir = tmp(t);
  const lib = openLibrary(dir, { now: clock() });
  const e = registerSum(lib);
  const host1 = createCallHost({ registry: lib.registry, mode: 'stub' }); host1.port({ budgetUsd: 1 });
  const ok = await host1.request(callOf(e.hash));
  assert.equal(ok.status, 'ok'); assert.deepEqual(ok.output, { total: 17 });
  lib.revoke(e.hash, 'security finding');
  assert.equal(lib.get(e.hash).status, 'revoked');
  const host2 = createCallHost({ registry: lib.registry, mode: 'stub' }); host2.port({ budgetUsd: 1 });
  const r = await host2.request(callOf(e.hash));
  assert.equal(r.status, 'refused'); assert.equal(r.refused, 'revoked'); assert.equal(r.detail.reason, 'security finding');
  const again = openLibrary(dir);
  assert.equal(again.get(e.hash).revoked, true); assert.equal(again.get(e.hash).status, 'revoked');
  assert.equal(JSON.parse(readFileSync(again.files.revocations, 'utf8').trim()).hash, e.hash, 'revocations.jsonl is the block list');
  assert.throws(() => again.transition(e.hash, 'kept'), /not allowed/);
});

test('T8: verify-before-store and the keep thresholds gate shadow and kept (LIBRARY §7.2-7.3)', t => {
  const lib = openLibrary(tmp(t), { now: clock() });
  const e = registerSum(lib);
  assert.equal(e.status, 'candidate');
  assert.throws(() => lib.transition(e.hash, 'shadow'), /verify-before-store failed \(fixturesPass/);
  assert.throws(() => lib.transition(e.hash, 'kept'), /candidate -> kept is not allowed/);
  lib.addEvidence(e.hash, { kind: 'admission', checks: { fixturesPass: true, probesPass: true, resetEnv: true, verifiedBy: 'independent-oracle', manifestWithinProbes: true, profileFromAccepted: true } });
  lib.transition(e.hash, 'shadow');
  for (let i = 0; i < 9; i++) lib.addEvidence(e.hash, { kind: 'run', ok: true, oracle: 'pass' });
  assert.throws(() => lib.transition(e.hash, 'kept'), /runs 9 < 10/);
  lib.addEvidence(e.hash, { kind: 'run', ok: true, oracle: 'pass' });
  for (let i = 0; i < 3; i++) lib.addEvidence(e.hash, { kind: 'shadow', agree: true });
  lib.addEvidence(e.hash, { kind: 'shadow', agree: false });
  assert.throws(() => lib.transition(e.hash, 'kept'), /shadow agreement 0.75 < 0.9/);
  for (let i = 0; i < 6; i++) lib.addEvidence(e.hash, { kind: 'shadow', agree: true });
  assert.equal(lib.transition(e.hash, 'kept').status, 'kept');
  // Every status and transition is from LIBRARY §7.1.
  assert.deepEqual(Object.keys(TRANSITIONS).sort(), [...STATUSES].sort());
});

test('T8: the circuit breaker demotes a kept item after 3 consecutive failures, or at success <= 0.5 after >= 5 uses', t => {
  const lib = openLibrary(tmp(t), { now: clock() });
  const a = registerSum(lib); makeKept(lib, a.hash);
  lib.addEvidence(a.hash, { kind: 'run', ok: false, deopt: 'guard' });
  lib.addEvidence(a.hash, { kind: 'run', ok: true, oracle: 'fail' });
  assert.equal(lib.get(a.hash).status, 'kept', 'two failures: still kept');
  const after = lib.addEvidence(a.hash, { kind: 'run', ok: false, deopt: 'invariant' });
  assert.equal(after.status, 'demoted'); assert.match(after.statusReason, /circuit-breaker: 3 consecutive failures/);
  assert.deepEqual(after.evidence.deopts, { guard: 1, invariant: 1 });
  // A success between failures resets the streak, but the success rate rule still trips.
  const b = registerSum(lib, { contract: { input: IN, output: OUT, taskTemplate: 'Sum the rows (b).' } });
  makeKept(lib, b.hash);
  for (const ok of [false, true, false, true, false, false, true, false, false, true, false]) lib.addEvidence(b.hash, { kind: 'run', ok });
  assert.equal(lib.get(b.hash).status, 'kept', '10 good runs + this mix: 14/21 > 0.5, no 3-streak');
  lib.addEvidence(b.hash, { kind: 'run', ok: false });
  assert.equal(lib.get(b.hash).status, 'kept');
  lib.addEvidence(b.hash, { kind: 'run', ok: false });
  assert.equal(lib.get(b.hash).status, 'demoted', 'three in a row');
  // The success-rate rule on its own (no streak): 3 of 6 uses.
  assert.deepEqual(breakerCheck({ consecutiveFailures: 1, uses: 6, successes: 3 }), { trip: true, why: 'success 3/6' });
  assert.deepEqual(breakerCheck({ consecutiveFailures: 1, uses: 4, successes: 1 }), { trip: false });
  const c = registerSum(lib, { contract: { input: IN, output: OUT, taskTemplate: 'Sum the rows (c).' } });
  lib.addEvidence(c.hash, { kind: 'admission', checks: { fixturesPass: true, probesPass: true, resetEnv: true, verifiedBy: 'agreeing-shadow', manifestWithinProbes: true, profileFromAccepted: true } });
  lib.transition(c.hash, 'shadow');
  for (const ok of [true, false, true, false, true, false, true, false, true, false]) lib.addEvidence(c.hash, { kind: 'run', ok });
  for (let i = 0; i < 4; i++) lib.addEvidence(c.hash, { kind: 'shadow', agree: true });
  lib.transition(c.hash, 'kept', { force: true });   // forced past the oracle-less keep rule to reach the breaker
  const d = lib.addEvidence(c.hash, { kind: 'run', ok: false });   // a streak of 2 only; 5 of 11 succeeded
  assert.equal(d.status, 'demoted'); assert.match(d.statusReason, /success 5\/11/);
});

test('T8: a policy-hash (or engine / model) change drops kept items to shadow; unchanged env keeps them', t => {
  const lib = openLibrary(tmp(t), { now: clock() });
  const a = registerSum(lib, { env: ENV }); makeKept(lib, a.hash);
  const b = registerSum(lib, { env: { ...ENV, policyHash: 'p2' }, contract: { input: IN, output: OUT, taskTemplate: 'Sum the rows (b).' } }); makeKept(lib, b.hash);
  assert.deepEqual(lib.requalify({ policyHash: 'p2', engineTree: 'e1', models: ['claude-haiku-5-5'] }), [a.hash]);
  assert.equal(lib.get(a.hash).status, 'shadow'); assert.match(lib.get(a.hash).statusReason, /requalify: policyHash changed/);
  assert.equal(lib.get(b.hash).status, 'kept');
  assert.deepEqual(lib.requalify({ models: ['claude-haiku-5-6'] }), [b.hash]);
});

test('T8: a retired item leaves the index but keeps its evidence', t => {
  const now = clock();
  const lib = openLibrary(tmp(t), { now });
  const a = registerSum(lib); makeKept(lib, a.hash);
  const b = registerSum(lib, { contract: { input: IN, output: OUT, taskTemplate: 'Sum the rows (b).' } }); makeKept(lib, b.hash);
  assert.equal(buildIndex({ library: lib }).length, 2);
  now.advanceDays(20); lib.addEvidence(b.hash, { kind: 'reuse', class: 'correct' });
  now.advanceDays(15);
  assert.deepEqual(lib.retireUnused(), [a.hash], 'a: 35 days unused; b: used 15 days ago');
  const rows = buildIndex({ library: lib });
  assert.deepEqual(rows.map(r => r.id), [b.hash]);
  assert.equal(lib.get(a.hash).status, 'retired');
  assert.equal(lib.evidenceOf(a.hash).runs, 10, 'negatives and positives are kept');
  assert.equal(lib.get(b.hash).evidence.reuse.correct, 1);
  assert.throws(() => lib.transition(a.hash, 'kept'), /retired -> kept is not allowed/);
});

test('judgments.jsonl: JEV-PORTS §8 rows are written through JudgmentLedger and never consulted by the lifecycle', t => {
  const lib = openLibrary(tmp(t), { now: clock() });
  const a = registerSum(lib); makeKept(lib, a.hash);
  const request = { options: ['false', 'true'], state: { task: 'Sum the rows.' } };
  const id = lib.recordJudgment({ port: 'applicability', engine: 'jev', model: 'jev-1.13.0', request, result: { probabilities: { false: 0.9, true: 0.1 }, chosen: 'false', confidence: 0.9 },
    split: 'calibration', meta: { portVersion: 'app-1', questionId: 'pre_0', item: { layer: 'L2', id: a.hash, version: 1 }, read: 1, optionOrder: ['false', 'true'],
      baseline: { b1: 'admit' }, decision: { taken: 'reuse', by: 'code', propensity: 1 }, untrustedFields: [] } });
  lib.labelJudgment(id, 'true', { source: 'retro-sweep' });
  const rows = lib.judgmentRows();
  assert.equal(rows.length, 1); assert.equal(rows[0].truth, 'true'); assert.equal(rows[0].labelSource, 'retro-sweep'); assert.equal(rows[0].meta.decision.by, 'code');
  // A Jev "no" changes nothing: status, evidence and the call host's answer are code's.
  assert.equal(lib.get(a.hash).status, 'kept');
  assert.throws(() => lib.recordJudgment({ port: 'x', engine: 'jev', request, result: { probabilities: {}, chosen: 'true', confidence: 1 }, meta: { verdict: 'admit' } }), /unknown meta fields verdict/);
  assert.throws(() => lib.labelJudgment(id, 'true', { source: 'model-said-so' }), /source must be one of/);
  assert.throws(() => lib.recordJudgment({ port: 'x', engine: 'jev', request: { options: ['a', 'b'], state: { hint: { b1: 'admit' } } }, result: { probabilities: { a: 1, b: 0 }, chosen: 'a', confidence: 1 }, meta: { baseline: { b1: 'admit' } } }), /never inside it/);
});

test('register: closed tags, provenance, purity of L2, names', t => {
  const lib = openLibrary(tmp(t), { now: clock() });
  assert.throws(() => registerSum(lib, { tags: ['cool-stuff'] }), /closed tag list/);
  assert.throws(() => registerSum(lib, { provenance: { source: 'internet', redistributable: true } }), /provenance.source/);
  assert.throws(() => registerSum(lib, { effects: 'write' }), /pure/);
  assert.throws(() => registerSum(lib, { name: 'Has Spaces' }), /name must match/);
  const a = registerSum(lib), again = registerSum(lib);
  assert.equal(again.hash, a.hash); assert.equal(again.version, 2, 'same bytes and contract: a new version of the same hash');
});
