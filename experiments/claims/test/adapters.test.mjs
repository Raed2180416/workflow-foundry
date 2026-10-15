// Back-fill adapters: every row valid, and the back-filled numbers reproduce the reports they come from ($0, no live dirs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRows, policyModelIds } from '../schema.mjs';
import { ROOT, readJson } from '../adapters/util.mjs';
import * as e8 from '../adapters/e8.mjs';
import * as nr from '../adapters/need-router.mjs';
import * as ab from '../adapters/automationbench.mjs';
import * as jq from '../adapters/jq.mjs';
import * as jn from '../adapters/jneed2.mjs';
import { MUTATING as AB_MUTATING } from '../../autobench/accounting.mjs';
import { loadSplit } from '../../autobench/split.mjs';

const ids = policyModelIds(JSON.parse(readFileSync(`${ROOT}/policy/models.json`, 'utf8')));
const valid = rows => assert.deepEqual(validateRows(rows, { modelIds: ids }), []);

test('E8: builds, gradings, agent-H rows; the s12 pairing and the set-aside meter', () => {
  const rs = e8.rows();
  valid(rs);
  const s12 = run => rs.find(r => r.run === run && r.task.key === 'ebed-e8:w1232:d2:s12:tail');
  assert.deepEqual([s12('grade-s12-b1lh-e8-1').verdict.successes, s12('grade-s12-b1lh-e8-1').verdict.total], [14, 14]);
  assert.deepEqual([s12('agenth-e8-s12').verdict.successes, s12('agenth-e8-s12').verdict.total], [10, 14]);
  assert.deepEqual([s12('grade-s12-b1o-e8-1').verdict.successes], [5]);
  const ag = s12('agenth-e8-s12');
  assert.equal(ag.timing.wallMs, null);
  assert.deepEqual(ag.timing.wallMsBounds, { lo: 2525184, hi: 2525184 + 3579695 });
  assert.equal(ag.provenance['timing.wallMs'].kind, 'missing');
  const sa = rs.find(r => r.rowKind === 'set-aside');
  assert.equal(sa.verdict.excluded, true);
  assert.deepEqual(sa.envFaults, [{ code: 'MODEL_RATE_LIMIT', n: 13 }]);
  assert.ok(Math.abs(sa.usd.charged - (0.00918383 + 12 * 0.4)) < 1e-9, 'refused ticks with no cost are charged their $0.40 bound');
  // B1-O over the nine full worlds, and the superseded originals
  const b1o = rs.filter(r => r.run === 'b1o-e8-1' && r.rowKind === 'task');
  assert.equal(b1o.reduce((s, r) => s + r.verdict.successes, 0), 281);
  assert.equal(rs.filter(r => r.refs.supersededBy).length, 45);
  // build rows carry the session's model time from the transcript
  const l1 = rs.find(r => r.run === 'b1lh-e8-1' && r.rowKind === 'build');
  assert.equal(l1.timing.wallMs, 1126796);
  assert.equal(l1.timing.components.modelMs, 1059453);
  assert.ok(Math.abs(l1.usd.charged - 0.38794675) < 1e-9);
  const rep = rs.find(r => r.run === 'b1nh-e8-2' && r.rowKind === 'repair');
  assert.equal(rep.refs.build, rs.find(r => r.run === 'b1lh-e8-2' && r.rowKind === 'build').id);
  // killed full-world runs: censored, doc wall time, job-limit fault
  const k = rs.filter(r => r.run.startsWith('agenth-e8-1-run'));
  assert.equal(k.length, 2);
  for (const r of k) { assert.equal(r.verdict.censored, true); assert.equal(r.provenance['timing.wallMs'].kind, 'doc'); }
  // §12: the tick session the job limit killed in flight is not in the tick log; it is charged at its $0.40 bound
  for (const r of k) {
    assert.equal(r.usd.observed, false);
    assert.ok(Math.abs(r.usd.charged - (r.usd.reported + 0.4)) < 1e-9, `${r.run}: killed in-flight tick at its bound`);
    assert.equal(r.usd.reservedUnsettled, 0.4);
  }
  assert.deepEqual(k.map(r => r.usd.starts).sort(), [172, 198]);
});

test('need router: 342 one-call rows; timeouts carry no first effect; tag meters as PREREG §12', () => {
  const rs = nr.rows();
  valid(rs);
  assert.equal(rs.length, 192 + 96 + 54);
  const tag = t => rs.filter(r => r.run === t).reduce((s, r) => s + r.usd.charged, 0);
  assert.ok(Math.abs(tag('m1') - 28.9957) < 1e-4 && Math.abs(tag('m1-d5') - 33.9199) < 1e-4 && Math.abs(tag('m1-r') - 17.8934) < 1e-4);
  const to = rs.filter(r => r.provenance['timing.timeToFirstEffectMs'].kind === 'n/a');
  assert.equal(to.length, 64, 'the 64 MODEL_TIMEOUT rows delivered no answer');
  // the same 64 rows hit the runner's deadline, and their wall time sits at it (truncated, not measured)
  const hit = rs.filter(r => r.timing.deadline.hit);
  assert.equal(hit.length, 64);
  assert.ok(hit.every(r => r.timing.wallMs >= r.timing.deadline.ms && r.timing.wallMs < r.timing.deadline.ms + 1000));
  assert.ok(rs.filter(r => !r.timing.deadline.hit).every(r => r.timing.wallMs < r.timing.deadline.ms));
  assert.ok(rs.every(r => r.timing.concurrency.configured === 4 && r.timing.concurrency.observedMax <= 4));
});

test('AutomationBench: dev-train or pre-split runs only; verdicts and dollars as the summaries; no live dirs needed', () => {
  assert.deepEqual([...ab.MUTATING], [...AB_MUTATING]);
  const { runs, skipped } = ab.discoverRuns();
  assert.ok(runs.includes('a1-dev-first6') && runs.includes('raw-haiku/subset60'));
  assert.ok(skipped.every(s => !runs.includes(s.dir)));
  const rs = ab.rows({ live: false });
  valid(rs);
  for (const run of runs) {
    const s = readJson(`research/automationbench-20261014/runs/${run}/summary.json`);
    assert.equal(s.testSplitTasks ?? 0, 0);
    const mine = rs.filter(r => r.run === s.runId);
    assert.equal(mine.length, s.n * (s.k ?? 1));
    assert.ok(Math.abs(mine.reduce((a, r) => a + r.usd.reported, 0) - s.cost.spentUsd) < 1e-9, run);
    assert.equal(mine.filter(r => r.verdict.pass).length, Math.round(s.pass_rate * s.n));
  }
  assert.ok(rs.every(r => r.origin.group === 'third-party' && r.timing.timeToFirstEffectMs === null && r.provenance['timing.timeToFirstEffectMs'].kind === 'missing'));
  assert.equal(ab.firstWriteT([{ t: 1, calls: [{ name: 'api_fetch', arguments: '{"method":"GET"}' }] }, { t: 2, calls: [{ name: 'api_fetch', arguments: '{"method":"post"}' }] }]), 2);
  assert.equal(ab.firstWriteT([{ t: 1, calls: [{ name: 'api_search', arguments: '{}' }] }]), null);
  // the AutomationBench world is served by our bridge, whose cost was never recorded: world cost is missing, not $0
  assert.ok(rs.every(r => r.usd.world === null && r.provenance['usd.world'].kind === 'missing'));
});

test('AutomationBench guard: only dev-train tasks (SPLIT-v1 dev minus devCheck) or simple.* sanity tasks pass', () => {
  const split = loadSplit();
  const devCheck = new Set(split.devCheck);
  const devTrain = split.dev.find(t => !devCheck.has(t));
  assert.equal(ab.devTrainOnly([devTrain, 'simple.anything'], split), true);
  assert.equal(ab.devTrainOnly([devTrain, split.devCheck[0]], split), false, 'devCheck is sealed until the go/no-go');
  assert.equal(ab.devTrainOnly([devTrain, split.test[0]], split), false, 'a test task');
  assert.equal(ab.devTrainOnly(['sales.not-a-task'], split), false, 'an unknown task');
  assert.equal(ab.devTrainOnly([], split), false);
  // every run the back-fill reads passes the guard, and none is k > 1
  const { runs } = ab.discoverRuns();
  for (const run of runs) {
    const s = readJson(`research/automationbench-20261014/runs/${run}/summary.json`);
    assert.equal(ab.devTrainOnly(s.tasks, split), true, run);
    assert.equal(s.k ?? 1, 1, run);
  }
});

test('J-Q: 600 rows; recall and FPR per screen reproduce result.json', () => {
  const rs = jq.rows();
  valid(rs);
  const res = readJson('research/architecture-20261014/runs/jq/result.json');
  const rate = (arm, planted) => rs.filter(r => r.arm === arm && r.task.family.startsWith('planted') === planted && (planted ? r.verdict.pass : !r.verdict.pass)).length;
  assert.equal(rate('jq-b1-regex', true), res.b1.recall.k); assert.equal(rate('jq-b1-regex', false), res.b1.fpr.k);
  assert.equal(rate('jq-jev@0.5', true), res.jev.at05.recall.k); assert.equal(rate('jq-jev@0.5', false), res.jev.at05.fpr.k);
  assert.equal(rate('jq-haiku', true), res.haiku.flag.recall.k); assert.equal(rate('jq-haiku', false), res.haiku.flag.fpr.k);
});

test('J-NEED-2: task-level property answers match the report (Jev 612/864, Haiku 474/864)', () => {
  const rs = jn.rows();
  valid(rs);
  const cells = arm => rs.filter(r => r.arm === arm).reduce((s, r) => s + r.verdict.successes, 0);
  assert.equal(cells('jneed2-jev'), 612);
  assert.equal(cells('jneed2-haiku'), 474);
  assert.equal(jn.argmax({ yes: 0.4, no: 0.4, cannot_tell: 0.2 }), null);
  assert.equal(jn.matchCells({ S1: 'yes', S2: 'cannot_tell', S3: 'no', S4: null, S5: 'no', S6: 'yes' }, { S1: 'yes', S2: 'no', S3: 'no', S4: 'no', S5: 'yes', S6: 'yes' }), 3);
});
