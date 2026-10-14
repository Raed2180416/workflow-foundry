import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harvest, readStreams } from '../harvest.mjs';
import { replay } from '../replay.mjs';
import { labelTable } from '../metrics.mjs';

const row = (taskKey, pass, costUsd, costBreakdown = {}, extra = {}) => ({ taskKey, pass, costUsd, costBreakdown, orphanUsd: 0, ...extra });

test('compile spend is a fixed cost, the rest per task; pairing keeps only tasks every kept mode ran', () => {
  const streams = [
    { family: 'f', arm: 'agent-claude-haiku-5-5', mode: 'agent-haiku', rows: ['a', 'b', 'c', 'd'].map(t => row(t, true, 0.1, { interpreter: 0.1 })) },
    { family: 'f', arm: 'jit-claude-opus-5-5--claude-haiku-5-5', mode: 'jit-OH', rows: [
      row('a', true, 3.2, { interpreter: 0.2, compileBuilder: 2, compileCheck: 0.5, compileGateway: 0.5 }),
      row('b', true, 0.05, { compiled: 0.05 }), row('c', false, 0.05, { compiled: 0.05 }) ] },
    { family: 'f', arm: 'agent-claude-opus-5-5', mode: 'agent-opus', rows: [row('a', true, 1)] },   // 1/4 < 50%: dropped
  ];
  const h = harvest(streams);
  assert.deepEqual(h.report[0].modes, ['agent-haiku', 'jit-OH']);
  assert.deepEqual(h.report[0].dropped, [{ mode: 'agent-opus', tasks: 1 }]);
  assert.equal(h.report[0].paired, 3);
  const jit = h.rows.filter(r => r.mode === 'jit-OH');
  assert.deepEqual(jit.map(r => +r.costUsd.toFixed(6)), [0.2, 0.05, 0.05]);
  assert.equal(h.fixed.find(x => x.mode === 'jit-OH').fixedUsd, 3);
  assert.ok(h.report[0].notes.some(n => /agent-haiku: 1 task/.test(n)));
  labelTable(h.rows, h.fixed);   // paired and complete
});

test('an external build is added to the static arm with its source', () => {
  const streams = [
    { family: 'r', arm: 'static-B1-haiku-records-k1-solve', mode: 'static-b1h', rows: [row('a', true, 0.05, { compiled: 0.05 })] },
    { family: 'r', arm: 'agent-claude-haiku-5-5', mode: 'agent-haiku', rows: [row('a', true, 0.1)] },
  ];
  const h = harvest(streams);
  assert.equal(h.fixed.find(x => x.mode === 'static-b1h').fixedUsd, 1.372);
  assert.ok(h.report[0].notes.some(n => /construction-20261006/.test(n)));
});

test('the archived streams harvest into paired, complete label tables (regression on committed data)', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../research/jit-20261008/runs');
  const res = replay(readStreams(root), { Vs: [0.1, 10], Hs: [null], reps: 50 });
  const rec = res.find(f => f.family === 'jit-dev-records-1');
  assert.equal(rec.paired, 24);
  assert.equal(rec.modes.length, 7);
  // Low value per success: a cheap mode; high value: the most reliable one (Opus agent, 24/24).
  assert.equal(rec.grid.find(g => g.V === 10).best, 'agent-opus');
  assert.notEqual(rec.grid.find(g => g.V === 0.1).best, 'agent-opus');
});
