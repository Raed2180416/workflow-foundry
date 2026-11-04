// Move 3 tests: the three-valued verdict, release, selection and risk–coverage. Every block has teeth: a broken
// variant (open-world, score-based selection, a threshold chosen on the test task) runs through the same check and must
// fail it. nice -n 15 node --test --test-concurrency=1 experiments/autobench/verifier/tristate/tristate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAILED, POLICIES, SUPPORTED, UNKNOWN, compareVerdicts, obligationStatus, releasedAt, select, verdictOf } from './verdict.mjs';
import { chooseTheta, curve, loto, pointAt, rowSummary } from './riskcov.mjs';
import { ccObligations, canonicalRowsOf, ownObligations, readerVerdicts, rl2Check, rl2Obligations } from './adapters.mjs';
import { indexWorld } from '../requirement-ledger-v2/lib.mjs';

const ob = (o) => ({ id: o.id ?? 'x', source: 'rl2', decidedBy: 'code', polarity: 'must', established: true, pass: true, content: true, ...o });

test('obligation status: decided, soft, judged, self-report, undecided, existence-only', () => {
  assert.equal(obligationStatus(ob({})).status, SUPPORTED);
  assert.equal(obligationStatus(ob({ pass: false })).status, FAILED);
  assert.equal(obligationStatus(ob({ pass: null })).status, UNKNOWN);
  assert.equal(obligationStatus(ob({ established: false, pass: false })).kind, 'soft');
  assert.equal(obligationStatus(ob({ established: false, pass: false })).status, UNKNOWN);
  assert.equal(obligationStatus(ob({ decidedBy: 'judge', pass: true })).status, UNKNOWN, 'a model verdict never supports');
  assert.equal(obligationStatus(ob({ decidedBy: 'judge', pass: false })).status, UNKNOWN, 'T1: a judged failure is an assumption, not a decision');
  assert.equal(obligationStatus(ob({ decidedBy: 'judge', pass: false }), POLICIES.TJ).status, FAILED, 'TJ: the judge may veto');
  assert.equal(obligationStatus(ob({ decidedBy: 'judge', pass: true }), POLICIES.TJ).status, UNKNOWN, 'TJ: the judge never releases');
  assert.equal(obligationStatus(ob({ decidedBy: 'self', pass: true })).kind, 'self-report');
  assert.equal(obligationStatus(ob({ content: false })).status, SUPPORTED, 'T1 accepts existence-only');
  assert.equal(obligationStatus(ob({ content: false }), POLICIES.T2).status, UNKNOWN, 'T2 does not');
  assert.equal(obligationStatus(ob({ unknownKind: 'labelled-null', pass: true })).status, UNKNOWN);
});

test('verdict: closed world (unexplained effects are UNKNOWN); release iff no FAILED; teeth: an open-world verdict releases what this one holds', () => {
  const obs = [ob({ id: 'a' }), ob({ id: 'b', decidedBy: 'judge', pass: null })];
  const v = verdictOf(obs, [{ key: 'gmail.messages:1', explained: true }, { key: 'gmail.messages:2', explained: false }]);
  assert.deepEqual([v.S, v.F, v.U], [1, 0, 2]);
  assert.equal(v.row, UNKNOWN);
  assert.equal(v.release, true, 'no FAILED: released, with its assumption list');
  assert.deepEqual(v.assumptions.map(s => s.kind).sort(), ['judged-only', 'unexplained-effect']);
  assert.equal(releasedAt(v, 0), false, 'fully-supported release holds it');
  assert.equal(verdictOf(obs, [{ key: 'k', explained: false }], POLICIES.T0).U, 1, 'T0 drops the complement');
  // teeth: the open-world verdict of the old pipeline (null / soft -> pass, unexplained effects ignored) marks this
  // run fully supported; the three-valued one must not
  const openWorld = (os) => ({ row: os.every(o => o.pass !== false) ? SUPPORTED : FAILED });
  assert.equal(openWorld(obs).row, SUPPORTED);
  assert.notEqual(v.row, openWorld(obs).row);
  const failing = verdictOf([...obs, ob({ id: 'c', pass: false })]);
  assert.equal(failing.release, false);
  assert.equal(failing.row, FAILED);
  assert.equal(failing.failed[0].id, 'c', 'repair consumes FAILED items only');
});

test('T3 (post hoc) counts established obligations only', () => {
  const obs = [ob({ id: 'a' }), ob({ id: 's', established: false, pass: false }), ob({ id: 'j', decidedBy: 'judge', established: false })];
  assert.equal(verdictOf(obs, [], POLICIES.T1).U, 2);
  assert.equal(verdictOf(obs, [], POLICIES.T3).U, 0);
  assert.equal(verdictOf(obs, [], POLICIES.T3).row, SUPPORTED);
  assert.equal(POLICIES.T3.postHoc, true);
});

test('selection is lexicographic (FAILED, SUPPORTED, UNKNOWN), ties keep fork order; teeth: a net score (S - F - U) picks differently', () => {
  const A = { id: 'A', verdict: { S: 9, F: 1, U: 0 } }, B = { id: 'B', verdict: { S: 2, F: 0, U: 5 } }, C = { id: 'C', verdict: { S: 2, F: 0, U: 5 } };
  assert.equal(select([A, B, C]).id, 'B', 'fewer FAILED wins whatever SUPPORTED says');
  assert.equal(select([C, B]).id, 'C', 'a tie keeps the default fork');
  assert.ok(compareVerdicts({ S: 3, F: 0, U: 1 }, { S: 2, F: 0, U: 0 }) < 0, 'more SUPPORTED before fewer UNKNOWN');
  const net = cands => cands.reduce((b, c) => (c.verdict.S - c.verdict.F - c.verdict.U > b.verdict.S - b.verdict.F - b.verdict.U ? c : b));
  assert.equal(net([A, B, C]).id, 'A');
  assert.notEqual(net([A, B, C]).id, select([A, B, C]).id);
});

// a synthetic two-population lab: verdict quality depends on the unknown share; tasks are clusters
function synth(seed = 3) {
  let s = seed;
  const r = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const items = [];
  for (let t = 0; t < 40; t++) for (let k = 0; k < 6; k++) {
    const u = r(), f = r() < 0.3 ? 1 : 0;
    const y = f ? r() < 0.1 : r() < 0.95 - u;          // FAILED rows rarely pass; more UNKNOWN, fewer passes
    const U = Math.round(u * 5);
    items.push({ task: `t${t}`, y, v: { S: 5, F: f, U, unknownShare: U / (5 + U), release: f === 0, row: f ? FAILED : U ? UNKNOWN : SUPPORTED } });
  }
  return items;
}

test('risk–coverage: coverage grows with theta; risk is lower at strict thresholds; n_eff never exceeds n', () => {
  const items = synth();
  const c = curve(items);
  for (let i = 1; i < c.length; i++) assert.ok(c[i].coverage >= c[i - 1].coverage);
  const strict = pointAt(items, 0.1), loose = pointAt(items, 1);
  assert.ok(strict.risk < loose.risk, `${strict.risk} < ${loose.risk}`);
  for (const p of c) assert.ok(p.nEffReleased <= p.released + 1e-9);
  const rs = rowSummary(items);
  assert.equal(rs.n, items.length);
  assert.equal(rs.supported + rs.unknown + rs.failed, items.length);
});

test('Learn-then-Test picks a certified theta; leave-one-task-out never lets a task choose its own threshold (teeth)', () => {
  const items = synth();
  const ch = chooseTheta(items, { alpha: 0.3, delta: 0.1 });
  assert.notEqual(ch.theta, null);
  assert.ok(pointAt(items, ch.theta).risk <= 0.3 + 0.05);
  const L = loto(items, { alpha: 0.3, delta: 0.1 });
  assert.equal(L.n, items.length);
  assert.ok(L.released > 0 && L.released < items.length);
  // teeth: an in-sample variant (each task picks the theta that maximises its own coverage at zero observed risk)
  // reports a better operating point than the honest leave-one-task-out one
  let rel = 0, bad = 0;
  for (const t of new Set(items.map(i => i.task))) {
    const its = items.filter(i => i.task === t);
    const best = [1, 0.75, 0.5, 0.4, 0.3, 0.2, 0.1, 0].find(th => its.filter(i => releasedAt(i.v, th)).every(i => i.y)) ?? 0;
    const rr = its.filter(i => releasedAt(i.v, best)); rel += rr.length; bad += rr.filter(i => !i.y).length;
  }
  assert.ok(rel > L.released && bad / Math.max(1, rel) <= L.risk + 1e-12, `the in-sample choice looks better than the honest one (${rel} vs ${L.released} released)`);
  // nothing certifiable at a tiny alpha: everything is held, no task releases
  const none = loto(items, { alpha: 0.01, delta: 0.1 });
  assert.equal(none.released, 0);
  assert.equal(none.abstainedTasks, 40);
});

test('a two-row strictest point stops a fixed sequence; Holm over the usable grid still certifies (the first-run defect)', () => {
  const items = synth();
  // two failing rows that only theta 0 releases (no UNKNOWN, no FAILED, label fail)
  items.push({ task: 'z1', y: false, v: { S: 5, F: 0, U: 0, unknownShare: 0, release: true, row: SUPPORTED } }, { task: 'z2', y: false, v: { S: 5, F: 0, U: 0, unknownShare: 0, release: true, row: SUPPORTED } });
  for (const it of items) if (it.task !== 'z1' && it.task !== 'z2' && it.v.U === 0) { it.v.U = 1; it.v.unknownShare = 1 / 6; it.v.row = UNKNOWN; }
  assert.equal(pointAt(items, 0).released, 2);
  assert.equal(chooseTheta(items, { alpha: 0.4, delta: 0.1, method: 'fixed_sequence' }).theta, null, 'the sequence stops at its first point');
  const holm = chooseTheta(items, { alpha: 0.4, delta: 0.1 });
  assert.notEqual(holm.theta, null);
  // one hypothesis per distinct release set with n_eff >= 5: the 2-row point and the duplicate thetas are not tested
  const distinct = new Set(holm.pts.filter(p => p.released > 0 && p.nEffReleased >= 5).map(p => p.released));
  assert.equal(holm.ltt.pValues.length, distinct.size);
});

test('leave-one-task-out: a task whose own rows alone would certify the threshold is held (teeth: in-sample calibration releases it)', () => {
  const v = (y, task) => ({ task, y, v: { S: 5, F: 0, U: 5, unknownShare: 0.5, release: true, row: UNKNOWN } });
  const items = [...Array.from({ length: 60 }, () => v(true, 'big')), ...Array.from({ length: 3 }, () => v(false, 's1')), ...Array.from({ length: 3 }, () => v(false, 's2'))];
  const L = loto(items, { alpha: 0.3, delta: 0.1 });
  assert.ok(L.released <= 6, `the big task must not certify itself (released ${L.released})`);
  assert.equal(L.passesHeld, 60);
  // every task's threshold is the one chosen without it; a pivot task whose rows change the choice proves the exclusion
  const base = synth();
  const pivot = Array.from({ length: 30 }, () => ({ task: 'pivot', y: false, v: { S: 5, F: 0, U: 0, unknownShare: 0, release: true, row: SUPPORTED } }));
  const all = [...base, ...pivot];
  const P = loto(all, { alpha: 0.3, delta: 0.1, keepPerTask: true });
  for (const t of ['pivot', 't0', 't7']) assert.equal(P.perTask.find(p => p.task === t).theta, chooseTheta(all.filter(i => i.task !== t), { alpha: 0.3, delta: 0.1 }).theta, t);
  assert.notEqual(P.perTask.find(p => p.task === 'pivot').theta, chooseTheta(all, { alpha: 0.3, delta: 0.1 }).theta, 'the pivot would change its own threshold');
});

test('adapters: RL2 results, judged items, code-checks veto, own checks, readers', () => {
  const results = [
    { key: 'effect_any', type: 'effect_any', hard: true, pass: true },
    { key: 'm1', type: 'msg_has', hard: true, pass: true },
    { key: 'm2', type: 'msg_to', hard: true, pass: false },
    { key: 'n1', type: 'msg_none', hard: false, pass: true },
  ];
  const obs = rl2Obligations(results, { judged: [{ id: 'J1', hard: true, kind: 'must' }], verdicts: { J1: { verdict: 'not_met' } } });
  assert.equal(obs.length, 4, 'effect_any passing is not an obligation');
  assert.deepEqual(obs.map(o => [o.decidedBy, o.polarity, o.content]), [['code', 'must', true], ['code', 'must', false], ['code', 'must_not', false], ['judge', 'must', true]]);
  assert.equal(rl2Obligations([{ key: 'effect_any', type: 'effect_any', hard: true, pass: false }])[0].pass, false, 'nothing changed is FAILED');
  const cc = ccObligations([{ id: 'a', hard: true, status: 'fail' }, { id: 'b', hard: false, status: 'fail' }, { id: 'c', hard: true, status: 'pass' }]);
  assert.deepEqual(cc.map(o => [o.id, o.established, o.pass]), [['cc:a', true, false], ['cc:b', false, false]], 'passing sanity checks are not task obligations');
  const own = ownObligations({ kind: 'a1c-checks', checks: [{ id: 1, hard: true, pass: true, by: 'code' }, { id: 2, hard: true, pass: true, by: 'checker' }] });
  assert.deepEqual(own.map(o => o.decidedBy), ['code', 'self']);
  assert.equal(verdictOf(own).U, 1, 'the checker verdict is a self-report: UNKNOWN');
  const merged = { checks: [{ readers: ['r0', 'r1'] }, { readers: ['r1'] }, { readers: ['r0'] }] };
  const rv = readerVerdicts([{ type: 'effect_any', pass: true }, { pass: true }, { pass: false }, { pass: true }], merged);
  assert.deepEqual(rv, { r0: { accept: true, fails: 0 }, r1: { accept: false, fails: 1 } });
  const can = canonicalRowsOf([{ task: 't', arm: 'b', worlds: {} }, { task: 't', arm: 'a', worlds: { initialRebuilt: true } }, { task: 't', arm: 'c', worlds: {} }], ['a', 'b', 'c']);
  assert.equal(can.get('t').arm, 'b', 'first arm in order whose initial world was not rebuilt');
});

test('rl2Check: a passing positive check explains the effect it cites; any other change is an unexplained effect (closed world)', () => {
  const world0 = { gmail: { messages: [{ id: 'm0', to: ['x@corp.example'], subject: 'old', body_plain: 'hello' }] } };
  const diff = { changes: [
    { app: 'gmail', coll: 'messages', op: 'created', id: 'm1', record: { id: 'm1', to: ['a@corp.example'], subject: 'Report', body_plain: 'Total 5,600' } },
    { app: 'gmail', coll: 'messages', op: 'created', id: 'm2', record: { id: 'm2', to: ['b@corp.example'], subject: 'Report', body_plain: 'Total 5,600' } },
  ] };
  const final = { gmail: { messages: [...world0.gmail.messages, diff.changes[0].record, diff.changes[1].record] } };
  const ledger = { canonIdx: indexWorld(world0), merged: { readers: 3, judged: [], checks: [
    { key: 'msg_to|@a@corp.example', type: 'msg_to', polarity: 'must', cat: 'positive', hard: true, support: 3, readers: ['r0', 'r1', 'r2'], params: { target: { email: 'a@corp.example' } } },
  ] } };
  const r = rl2Check(ledger, { diff, world0, final });
  assert.deepEqual(r.results.map(x => x.pass), [true, true]);
  assert.deepEqual(r.effects.map(e => [e.key, e.explained]), [['gmail.messages:m1', true], ['gmail.messages:m2', false]]);
  const v = verdictOf(rl2Obligations(r.results), r.effects);
  assert.deepEqual([v.S, v.F, v.U], [1, 0, 1], 'the message nobody asked for is an assumption, not a pass');
  // teeth: without the complement the same run is fully supported
  assert.equal(verdictOf(rl2Obligations(r.results), r.effects, POLICIES.T0).row, SUPPORTED);
});
