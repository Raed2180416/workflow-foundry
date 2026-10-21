// Fault and drift harness (HARNESS.md §4). $0, no model calls, dev seeds. The sandboxed crash probe needs user
// namespaces (skipped without them).
//   node --test --test-concurrency=1 experiments/compose/test/faults.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as e8 from '../../../beds/ebed/e8/index.mjs';
import { runControl } from '../../../beds/ebed/e8/controls.mjs';
import { runReference } from '../../../beds/ebed/oracle/policy.mjs';
import { gradeStream } from '../../../beds/ebed/oracle/grade.mjs';
import { sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import { exactlyOnce, duplicateWorld, failureWorld, withCrash, withRestart } from '../faults.mjs';
import { subjectOf, faultRun } from '../fault-run.mjs';
import { DRIFTS, driftedSpec, driftedItem, driftedBinding, driftWorld, patchLocality } from '../drift.mjs';
import { evaluateCapabilities } from '../capabilities.mjs';
import { poolsFor, assess } from '../run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const W = e8.generateWorld({ seed: 1161, difficulty: 2, mix: 'tail', size: 24 });

test('exactly-once counts a second committed charge as money', async () => {
  const rows = await runControl('charge-twice', W);
  const x = exactlyOnce(W, rows);
  assert.ok(x.money > 0 && x.duplicates.every(d => /^charge:/.test(d.id)));
  assert.equal(exactlyOnce(W, (await runReference({ item: e8.oracleItem, binding: e8.binding, world: W })).rows).duplicates.length, 0);
});

test('faulted worlds: duplicate deliveries and downstream failures are real world changes the reference still passes', async () => {
  const dup = duplicateWorld(W, 'delayed');
  assert.ok(dup.copies > 0 && dup.world.arrivals.length > W.arrivals.length);
  const down = failureWorld(W);
  assert.ok(down.injected.length > 0);
  for (const fw of [dup, down]) {
    const r = await runReference({ item: e8.oracleItem, binding: fw.binding, world: fw.world });
    const { pools } = await poolsFor(fw.world, { binding: fw.binding });
    const a = assess({ world: fw.world, rows: r.rows, pools });
    assert.equal(a.oracle.passed, a.oracle.completed);
    assert.equal(a.faults.compensation.complete, a.faults.compensation.due);
  }
});

test('crash and restart wrappers: restart keeps the journal; crash replays the tick\'s events once', async () => {
  let made = 0;
  const calls = [];
  const inner = () => ({ id: 'x', tick(input) { made += 1; calls.push(input.events.map(e => e.id)); return { decisions: { subject: null }, effects: [{ key: 'k', system: 'billing', op: 'charge', args: {} }], carry: { n: (input.carry?.n ?? 0) + 1 } }; } });
  const crash = withCrash(inner(), inner, { every: 1 });
  const o1 = await crash.tick({ instance: 'i', now: 't1', events: [{ id: 'a' }], carry: null }, {});
  assert.equal(o1.carry, null, 'the carry rolled back');
  await crash.tick({ instance: 'i', now: 't2', events: [{ id: 'b' }], carry: null }, {});
  assert.deepEqual(calls.at(-1), ['a', 'b'], 'the crashed tick\'s events come again first');
  assert.equal(crash.faults.length, 1);
  const rs = withRestart(inner(), inner, { every: 2 });
  for (let i = 0; i < 4; i++) await rs.tick({ instance: 'i', now: 't', events: [], carry: null }, {});
  assert.equal(rs.faults.length, 2);
});

test('crash fault on a sandboxed composed program: stable keys stay exactly-once, emission-time keys double-charge', { skip: !sandboxAvailable() }, async () => {
  const dir = path.join(here, '..', 'fixtures', 'straight-saga');
  const worlds = [{ seed: 1161, d: 2, size: 12 }];
  const quiet = () => {};
  const stable = await faultRun({ subject: subjectOf(`program:${dir}`), worlds, faults: ['none', 'restart', 'crash'], log: quiet });
  const r = Object.fromEntries(stable.results.map(x => [x.fault, x]));
  assert.ok(r.crash.injected > 0);
  assert.equal(r.crash.exactlyOnce.duplicates, 0);
  assert.equal(r.restart.sameJournalAsFaultFree, true);
  const timed = await faultRun({ subject: subjectOf(`program:${dir}`, { setKey: 'saga.mjs:KEYED=time' }), worlds, faults: ['none', 'crash'], log: quiet });
  const t = Object.fromEntries(timed.results.map(x => [x.fault, x]));
  assert.equal(t.none.exactlyOnce.duplicates, 0, 'correct without faults');
  assert.ok(t.crash.exactlyOnce.money > 0, 'double charges after crashes');
});

test('drift D1 (R2.2 review timeout clears): one rule, one capability; the stale policy fails exactly the changed cases', async () => {
  const id = 'review-timeout-clears';
  assert.notEqual(driftedSpec(id), e8.specE.text);
  assert.equal(driftedBinding(id).specE, driftedSpec(id));
  const dir = mkdtempSync(path.join(os.tmpdir(), 'compose-drift-'));
  try {
    const item = await driftedItem(id, dir);
    const { world, converted } = driftWorld(e8.generateWorld({ seed: 1165, difficulty: 2, mix: 'tail', size: 24 }), id, { n: 3 });
    assert.equal(converted.length, 3);
    const B = driftedBinding(id);
    const { pools } = await poolsFor(world, { item, binding: B });
    const fresh = await runReference({ item, binding: B, world });
    assert.equal(assess({ world, rows: fresh.rows, pools, item, rules: DRIFTS[id].rules }).capabilities.failing.length, 0);
    const stale = await runReference({ item: e8.oracleItem, binding: B, world });
    const v = gradeStream({ item, world, rows: stale.rows, pools });
    assert.deepEqual(v.cases.filter(c => c.pool === 'completed' && !c.pass).map(c => c.case).sort(), [...converted].sort());
    const caps = evaluateCapabilities(world, stale.rows, { pools, rules: DRIFTS[id].rules, canonicalArgs: item.canonicalArgs });
    const failed = caps.cases.filter(c => c.pool === 'completed' && !c.pass);
    assert.deepEqual(failed.map(c => c.case).sort(), [...converted].sort());
    assert.ok(failed.every(c => c.failed.includes('fraud')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('patch locality: which modules a rebuild touched, against the modules owning the rule', () => {
  const m = { version: 1, parent: { file: 'p.mjs', calls: ['a', 'b'] }, modules: { a: { file: 'a.mjs', rules: ['R2.2'] }, b: { file: 'b.mjs', rules: ['R4.2'] } } };
  const before = { manifest: m, sources: { 'p.mjs': 'p', 'a.mjs': 'a1', 'b.mjs': 'b' } };
  assert.deepEqual(patchLocality(before, { manifest: m, sources: { 'p.mjs': 'p', 'a.mjs': 'a2', 'b.mjs': 'b' } }, { rule: 'R2.2' }), { changedFiles: ['a.mjs'], changedModules: ['a'], owners: ['a'], manifestChanged: false, local: true, localStrict: true, outside: [] });
  assert.equal(patchLocality(before, { manifest: m, sources: { 'p.mjs': 'p2', 'a.mjs': 'a2', 'b.mjs': 'b2' } }, { rule: 'R2.2' }).local, false);
});
