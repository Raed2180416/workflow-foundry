// Tests for the frozen AutomationBench dev/test split (experiments/autobench/split.mjs). No model, no venv, $0.
//   node --test experiments/autobench/test/split.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO, PUBLIC_DOMAINS } from '../lib.mjs';
import { SALTS, SPLIT_PATH, assertDevOnly, computeSplit, key, listSha256, loadSplit, splitOf } from '../split.mjs';

const synth = (domains, n) => domains.flatMap(d => Array.from({ length: n }, (_, i) => ({ task: `${d}.t${i}`, domain: d })));

test('computeSplit: test = first N non-forced tasks per domain in hash order; forced always in dev; deterministic', () => {
  const u = synth(['a', 'b'], 20);
  const order = d => u.filter(x => x.domain === d).map(x => x.task).sort((p, q) => (key(SALTS.split, p) < key(SALTS.split, q) ? -1 : 1));
  const forced = new Set([order('a')[0], order('a')[3], order('a')[12], order('b')[1]]);
  const r = computeSplit(u, forced, { domains: ['a', 'b'], perDomainTest: 10, perDomainDevCheck: 2, perDomainRef: 2 });
  for (const d of ['a', 'b']) {
    const want = order(d).filter(t => !forced.has(t)).slice(0, 10).sort();
    assert.deepEqual(r.test.filter(t => t.startsWith(`${d}.`)), want);
  }
  for (const f of forced) assert.ok(r.dev.includes(f) && !r.test.includes(f));
  // One swap per forced task that sat in the base test set; the replacement is the lowest-hash eligible dev task.
  assert.deepEqual(r.swaps.map(s => s.out), [order('a')[0], order('a')[3], order('b')[1]]);
  assert.deepEqual(r.swaps.map(s => s.in), [order('a')[10], order('a')[11], order('b')[10]]);
  assert.deepEqual(computeSplit(u, forced, { domains: ['a', 'b'], perDomainTest: 10, perDomainDevCheck: 2, perDomainRef: 2 }), r);
  for (const t of r.devCheck) assert.ok(r.dev.includes(t) && !forced.has(t));
  for (const t of r.testRef) assert.ok(r.test.includes(t));
});

test('SPLIT-v1.json: hashes, counts, exposure and recomputation from its own universe', () => {
  const s = loadSplit();
  assert.equal(s.corpusCommit, '4a8e1061254004d9dac807054eed33fad7d1ff14');
  assert.equal(s.dev.length, 300); assert.equal(s.test.length, 300);
  assert.equal(new Set([...s.dev, ...s.test]).size, 600);
  assert.equal(listSha256([...s.dev, ...s.test]), s.universe.sha256);
  for (const d of PUBLIC_DOMAINS) {
    assert.equal(s.test.filter(t => t.startsWith(`${d}.`)).length, 50, d);
    assert.equal(s.dev.filter(t => t.startsWith(`${d}.`)).length, 50, d);
    assert.equal(s.devCheck.filter(t => t.startsWith(`${d}.`)).length, 10, d);
    assert.equal(s.testRef.filter(t => t.startsWith(`${d}.`)).length, 10, d);
  }
  // Every task of the raw-haiku subset60 run is in dev (the brief's minimum), and so is every other exposed task.
  const seen = JSON.parse(readFileSync(path.join(REPO, 'research/automationbench-20261014/runs/raw-haiku/subset60/summary.json'), 'utf8')).tasks;
  assert.equal(seen.length, 60);
  for (const t of seen) assert.equal(splitOf(t, s), 'dev', t);
  const forced = new Set(s.forcedSources.flatMap(f => f.tasks));
  for (const t of forced) assert.equal(splitOf(t, s), 'dev', t);
  for (const t of s.devCheck) assert.ok(!forced.has(t), `devCheck holds an exposed task ${t}`);
  // Recompute from the recorded universe and forced set: identical lists.
  const universe = [...s.dev, ...s.test].map(t => ({ task: t, domain: t.split('.')[0] }));
  const r = computeSplit(universe, forced);
  for (const k of ['dev', 'test', 'devCheck', 'testRef']) assert.equal(listSha256(r[k]), s.sha256[k], k);
  assert.equal(r.swaps.length, s.swaps.length);
  assert.equal(s.swaps.filter(x => x.outReasons.includes('S1-raw-haiku-subset60')).length, s.swapsIfOnlySubset60.n);
});

test('assertDevOnly refuses test tasks and unknown names, accepts dev and simple', () => {
  const s = loadSplit();
  assert.doesNotThrow(() => assertDevOnly([s.dev[0], s.dev[1], 'simple.anything'], s));
  assert.throws(() => assertDevOnly([s.dev[0], s.test[0]], s), /not dev-split/);
  assert.throws(() => assertDevOnly(['sales.no_such_task'], s), /not dev-split/);
  assert.ok(SPLIT_PATH.endsWith('SPLIT-v1.json'));
});
