// compose-runtime/2 on the real E8 host: transparency to correct programs and teeth against the COMP-1 defect classes,
// planted at the arm boundary (mutants2.mjs) so the same defect runs with and without the envelope. $0, no model calls,
// dev seed 1161 (size 24). Needs user namespaces for the sandbox (skipped without them).
//   nice -n 15 node --test --test-concurrency=1 experiments/compose/test/runtime2.host.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as e8 from '../../../beds/ebed/e8/index.mjs';
import { sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import { subjectOf2, runUnder2, measure } from '../fault-run2.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../..');
const MONO = `solver:${path.join(ROOT, 'research/enterprise-20261014/runs/b1lh-e8-1/solver.mjs')}`;
const CHT1 = `program:${path.join(ROOT, 'research/composition-20261021/runs/cht-e8-1/program')}`;
const W = e8.generateWorld({ seed: 1161, difficulty: 2, mix: 'tail', size: 24 });
const skip = sandboxAvailable() ? false : 'sandbox (user namespaces) unavailable';

const run = async (spec, opts, fault = 'none') => {
  const subject = subjectOf2(spec, opts);
  const r = await runUnder2(subject, W, fault);
  const m = await measure({ subject, r, fault });
  assert.equal(m.armErrors, 0, `${spec} r${opts.runtime} ${fault}: arm errors (machine load?)`);
  return m;
};

test('transparency: a correct monolith and a correct composed program journal the same behaviour behind the envelope', { skip }, async () => {
  const m1 = await run(MONO, { runtime: 1 });
  const m2 = await run(MONO, { runtime: 2 });
  assert.equal(m2.digest.logical, m1.digest.logical);
  assert.equal(m2.digest.sorTables, m1.digest.sorTables);      // the same business rows at the end
  assert.notEqual(m2.digest.raw, m1.digest.raw);               // the keys did change on the wire
  assert.deepEqual(m2.envelope.byCode, {});
  assert.deepEqual(m2.passing, m1.passing);
  const c1 = await run(CHT1, { runtime: 1 });
  const cb = await run(CHT1, { runtime: 2 });                   // envelope inside the bundle
  const ch = await run(CHT1, { runtime: 2, envelope: 'host' }); // the same envelope as a host-side gateway
  assert.equal(cb.digest.logical, c1.digest.logical);
  assert.equal(ch.digest.logical, c1.digest.logical);
  assert.equal(cb.digest.sorTables, c1.digest.sorTables);
});

test('D2 teeth: a second caller key for each status write commits duplicates without the envelope and none with it', { skip }, async () => {
  const base = await run(MONO, { runtime: 1 });
  const m1 = await run(MONO, { runtime: 1, mutant: 'dupwrites' });
  const m2 = await run(MONO, { runtime: 2, mutant: 'dupwrites' });
  assert.ok(m1.mutantActs > 0 && m2.mutantActs > 0);
  assert.ok(m1.exactlyOnce.duplicates > 0, 'the mutant must duplicate without the envelope');
  assert.equal(m2.exactlyOnce.duplicates, 0);
  assert.equal(m2.exactlyOnce.keyConflicts, 0);
  assert.ok(m2.hostDeduped > 0);
  assert.deepEqual(m2.passing, base.passing);
});

test('distinct refunds: two refunds of one fulfilment are flagged (409 key-conflict, identity-conflict), never merged', { skip }, async () => {
  const m1 = await run(MONO, { runtime: 1, mutant: 'splitrefund' }, 'downstream');
  const m2 = await run(MONO, { runtime: 2, mutant: 'splitrefund' }, 'downstream');
  assert.ok(m1.mutantActs > 0 && m2.mutantActs > 0);
  assert.ok(m1.exactlyOnce.money > 0, 'without the envelope both refunds commit');
  assert.equal(m2.exactlyOnce.duplicates, 0);
  assert.ok(m2.exactlyOnce.keyConflicts > 0, 'the second refund must be refused visibly');
  assert.ok((m2.envelope.byCode['identity-conflict'] ?? 0) > 0);
  assert.ok((m2.envelope.byCode['host-key-conflict'] ?? 0) > 0);
});

test('D3 teeth: under crash-and-redeliver a late-undo program compensates healthy charges without the envelope, never with it', { skip }, async () => {
  const ctl = await run(MONO, { runtime: 1, mutant: 'lateundo' });
  assert.equal(ctl.mutantActs, 0, 'the mutant is inert without the crash');
  const m1 = await run(MONO, { runtime: 1, mutant: 'lateundo' }, 'crash');
  const m2 = await run(MONO, { runtime: 2, mutant: 'lateundo' }, 'crash');
  assert.ok(m1.injected > 0 && m2.injected > 0);
  assert.ok(m1.mutantActs > 0, 'the redelivered result must reach the program twice without the envelope');
  assert.equal(m2.mutantActs, 0);
  assert.ok((m2.envelope.byCode.orphan ?? 0) + (m2.envelope.byCode.surplus ?? 0) > 0);
  assert.ok(m2.oracle.passed > m1.oracle.passed);
});
