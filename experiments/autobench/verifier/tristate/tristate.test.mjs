// Move 3 tests: the three-valued verdict, release, selection and risk–coverage. Every block has teeth: a broken
// variant (open-world, score-based selection, a threshold chosen on the test task) runs through the same check and must
// fail it. nice -n 15 node --test --test-concurrency=1 experiments/autobench/verifier/tristate/tristate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAILED, POLICIES, SUPPORTED, UNKNOWN, compareVerdicts, killClause, obligationStatus, releasedAt, select, verdictOf } from './verdict.mjs';
import { chooseTheta, curve, loto, pointAt, rowSummary, scaledFailures } from './riskcov.mjs';
import { businessToday, ccClock, ccObligations, canonicalRowsOf, clockBlindWorld, matchedEffects, ownObligations, readerAccept, readerVerdicts, rl2Check, rl2Obligations } from './adapters.mjs';
import { analyzeConfig, obligationsFor, RULES, selectPool, selectionManifest, summarizeSelection } from './run.mjs';
import { indexWorld } from '../requirement-ledger-v2/lib.mjs';
import { clopperPearson, headlineRow } from '../../../lib/certify.mjs';

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

// ---------------- review fixes (2026-11-04) ----------------

test('review 1: an unestablished (soft) check is UNKNOWN whether it passed or failed; TC decides it both ways; T2 is not inverted (teeth: v1 asymmetric rule)', () => {
  // v1 (the defect): softPass SUPPORTED in every policy, a soft failure UNKNOWN
  const v1 = (o, policy) => (!o.established && o.decidedBy === 'code' && o.pass !== null ? (o.pass ? { status: SUPPORTED } : { status: UNKNOWN }) : obligationStatus(o, policy));
  const softPass = ob({ established: false, pass: true }), softFail = ob({ established: false, pass: false });
  for (const p of ['T1', 'T2', 'T0', 'TJ']) {
    assert.deepEqual(obligationStatus(softPass, POLICIES[p]), { status: UNKNOWN, kind: 'soft' }, `${p}: a soft pass is an assumption`);
    assert.deepEqual(obligationStatus(softFail, POLICIES[p]), { status: UNKNOWN, kind: 'soft' }, `${p}: a soft failure is an assumption`);
  }
  assert.equal(v1(softPass, POLICIES.T1).status, SUPPORTED, 'the v1 rule supports on a soft pass');
  assert.notEqual(v1(softPass, POLICIES.T1).status, obligationStatus(softPass, POLICIES.T1).status);
  // T2: an established existence-only pass is UNKNOWN; an unestablished one must not be MORE supported than it (v1 inverted this)
  const estExist = ob({ content: false }), softExist = ob({ content: false, established: false });
  assert.equal(obligationStatus(estExist, POLICIES.T2).status, UNKNOWN);
  assert.equal(obligationStatus(softExist, POLICIES.T2).status, UNKNOWN);
  assert.equal(v1(softExist, POLICIES.T2).status, SUPPORTED, 'v1: unestablished existence-only SUPPORTED while the established one is UNKNOWN');
  // TC (post hoc): symmetric the other way
  assert.equal(obligationStatus(softPass, POLICIES.TC).status, SUPPORTED);
  assert.equal(obligationStatus(softFail, POLICIES.TC).status, FAILED);
  assert.equal(obligationStatus(softFail, POLICIES.TC).kind, 'soft-decided');
  assert.equal(POLICIES.TC.postHoc, true);
  // a run whose only evidence is soft passes: held as assumptions under T1, never a SUPPORTED row
  const v = verdictOf([softPass, softPass], []);
  assert.deepEqual([v.S, v.F, v.U, v.row], [0, 0, 2, UNKNOWN]);
  assert.equal(releasedAt(v, 0.5), false, 'at theta 0.5 a 100% assumption run is not released');
});

test('review 2: a verdict with no obligation is vacuous and held (teeth: release = F === 0 releases it)', () => {
  const v = verdictOf([], []);
  assert.equal(v.vacuous, true);
  assert.equal(v.release, false, 'no evidence, no release');
  assert.equal(releasedAt(v, 1), false);
  assert.equal(v.F === 0, true, 'the v1 rule (F === 0) would have released it');
  const w = verdictOf([], [{ key: 'gmail.messages:1', explained: false }]);
  assert.equal(w.vacuous, false);
  assert.equal(w.release, true, 'an unexplained change is an assumption: released with it listed');
  assert.equal(verdictOf([], [{ key: 'k', explained: false }], POLICIES.T0).release, false, 'T0 drops the complement: vacuous again');
  // code-checks alone is a veto source: a candidate it does not veto has no obligation at all and is held
  const cfg = { rl2: false, cc: true, own: false, clock: 'blind' };
  const o = obligationsFor(cfg, { cc: { withClock: { checks: [] }, blind: { checks: [{ id: 'a', hard: true, status: 'pass' }] }, labelledNull: [] } });
  assert.equal(verdictOf(o.obs, o.effects).release, false);
});

test('review 3: every effect a passing check matches is explained; same-content repeats are duplicates; id-less effects can be explained (teeth: v1 first-match explanation)', () => {
  const world0 = { gmail: { messages: [] }, slack: { messages: [] } };
  const mk = (id, to, body) => ({ app: 'gmail', coll: 'messages', op: 'created', id, record: { id, to: [to], subject: 'Report', body_plain: body } });
  const diff = { changes: [
    mk('m1', 'a@corp.example', 'Total 5,600 for March'),
    mk('m2', 'a@corp.example', 'Second note: approved'),
    mk('m3', 'a@corp.example', 'Total 5,600 for March'),
    { app: 'slack', coll: 'messages', op: 'created', id: null, record: { channel: 'ops', text: 'Total 5,600 posted' } },
    mk('m4', 'z@corp.example', 'unrelated'),
  ] };
  const final = { gmail: { messages: diff.changes.filter(c => c.app === 'gmail').map(c => c.record) }, slack: { messages: [diff.changes[3].record] } };
  const ledger = { canonIdx: indexWorld(world0), merged: { readers: 3, judged: [], checks: [
    { key: 'msg_to|a', type: 'msg_to', polarity: 'must', cat: 'positive', hard: true, support: 3, readers: ['r0', 'r1', 'r2'], params: { target: { email: 'a@corp.example' } } },
    { key: 'post_in|ops', type: 'post_in', polarity: 'must', cat: 'positive', hard: true, support: 3, readers: ['r0', 'r1', 'r2'], params: { target: { channel: { id: 'ops', name: 'ops' } } } },
  ] } };
  const r = rl2Check(ledger, { diff, world0, final });
  assert.deepEqual(r.results.map(x => x.pass), [true, true, true]);
  const by = Object.fromEntries(r.effects.map(e => [e.key, [e.explained, e.duplicate]]));
  assert.deepEqual(by['gmail.messages:m1'], [true, false]);
  assert.deepEqual(by['gmail.messages:m2'], [true, false], 'a second, different message to the same addressee is explained (v1: unexplained)');
  assert.deepEqual(by['gmail.messages:m3'], [false, true], 'the same message sent again is a duplicate, not unexplained');
  assert.deepEqual(by['slack.messages:#0'], [true, false], 'an effect without an id can be explained (v1 could never)');
  assert.deepEqual(by['gmail.messages:m4'], [false, false], 'a message nobody asked for stays unexplained');
  assert.deepEqual(r.matchFidelity, { checked: 2, agree: 2 }, 'the first match is the frozen evaluator\'s evidence (null ids print as app.coll:null on both sides)');
  const v = verdictOf(rl2Obligations(r.results), r.effects);
  assert.deepEqual(v.assumptions.map(s => s.kind).sort(), ['duplicate-effect', 'unexplained-effect']);
  // teeth: v1's first-match explanation (the evidence address only) leaves m2, m3 and the id-less post unexplained
  const v1Explained = new Set(r.results.slice(1).filter(x => x.pass).map(x => String(x.evidence)));
  assert.equal(r.effects.filter(e => !v1Explained.has(e.key)).length, 4);
  // a check that constrains nothing keeps only its first match
  const anyMsg = { type: 'msg_to', params: { target: {} } };
  const eff = { created: [{ app: 'x', coll: 'y', id: '1', recipients: new Set(), text: 'a', ids: new Set() }, { app: 'x', coll: 'y', id: '2', recipients: new Set(), text: 'b', ids: new Set() }], updated: [], deleted: [] };
  assert.equal(matchedEffects(anyMsg, eff, () => null).length, 1);
});

test('review 4: the kill clause is evaluated by a bound over unclassified kinds (teeth: counting only declared unobservable items can never fire)', () => {
  const V = (...kinds) => verdictOf(kinds.map((k, i) => ob({ id: `o${i}`, unknownKind: k })), []);
  const mostlyObservable = [V('soft', 'soft', 'soft'), V('judged-only', 'unexplained-effect')];
  const k1 = killClause(mostlyObservable);
  assert.equal(k1.decision, 'not triggered');
  assert.ok(k1.shareUpper <= 0.5 && k1.byObservability.unclassified === 1);
  const mostlyJudged = [V('judged-only', 'judged-only', 'soft')];
  assert.equal(killClause(mostlyJudged).decision, 'not evaluable', 'unclassified items could dominate');
  const unobs = [V('unobservable', 'unobservable', 'soft')];
  assert.equal(killClause(unobs).decision, 'triggered');
  // teeth: v1's count (only items an adapter labelled 'unobservable', none ever were) reports "not triggered" for mostlyJudged
  const v1 = vs => (vs.flatMap(v => v.assumptions).filter(s => s.kind === 'unobservable').length > vs.flatMap(v => v.assumptions).length / 2 ? 'triggered' : 'not triggered');
  assert.equal(v1(mostlyJudged), 'not triggered');
  assert.notEqual(v1(mostlyJudged), killClause(mostlyJudged).decision);
});

test('review 5: the hidden clock: clock-blind code-checks derive "today" from business dates, else a labelled null (teeth: the lab world leaks meta.current_time)', () => {
  const world0 = { meta: { current_time: '2026-02-15T09:00:00Z', schema_version: 'x' }, crm: { deals: [{ id: 'd1', name: 'Deal', close_date: '2026-01-31', created_at: '2026-03-01T00:00:00Z' }] } };
  assert.equal(businessToday(world0), '2026-03-01', 'the work items\' own dates and timestamps count; meta does not');
  assert.equal(businessToday({ meta: world0.meta, crm: { deals: [{ id: 'd1', close_date: '2026-01-31' }] } }), '2026-01-31');
  assert.equal(clockBlindWorld(world0).meta.current_time, '2026-03-01T00:00:00Z');
  assert.equal(clockBlindWorld(world0, 'null').meta.current_time, undefined);
  assert.equal(clockBlindWorld(world0).meta.schema_version, 'x');
  const noDates = { meta: { current_time: '2026-02-15T09:00:00Z' }, crm: { deals: [{ id: 'd1', name: 'Deal' }] } };
  assert.equal(clockBlindWorld(noDates).meta.current_time, undefined, 'no business date: a labelled null');
  // a created record dated 3 years before the hidden clock: the clock decides the date-anchor check; blind, no date: null
  const view = { prompt: { system: '', user: 'Log the call.' }, services: ['crm'], diff: { changes: [{ app: 'crm', coll: 'notes', op: 'created', id: 'n1', record: { id: 'n1', body: 'Call logged on 2023-01-02 with the client team.' } }] } };
  const c = ccClock({ view, world0: noDates });
  const anchor = id => c.withClock.checks.find(x => x.id === id)?.status;
  assert.equal(anchor('text.date_anchor'), 'fail', 'the hidden clock vetoes the run');
  assert.deepEqual(c.labelledNull, ['text.date_anchor']);
  const obs = ccObligations(c.blind.checks, { labelledNull: c.labelledNull });
  const st = obs.map(o => obligationStatus(o));
  assert.ok(st.some(s => s.kind === 'labelled-null' && s.status === UNKNOWN));
  assert.ok(!st.some(s => s.status === FAILED && obs[st.indexOf(s)].id === 'cc:text.date_anchor'), 'clock-blind: not a veto');
  assert.ok(ccObligations(c.withClock.checks).some(o => o.id === 'cc:text.date_anchor' && o.pass === false), 'teeth: with the clock it is a hard veto');
});

test('review 13: an independent reader is its own ledger, not its share of the merged one', () => {
  const world0 = { gmail: { messages: [] } };
  const diff = { changes: [{ app: 'gmail', coll: 'messages', op: 'created', id: 'm1', record: { id: 'm1', to: ['a@corp.example'], subject: 'S', body_plain: 'Hello' } }] };
  const final = { gmail: { messages: [diff.changes[0].record] } };
  const solo = { readers: ['r1'], canonIdx: indexWorld(world0), merged: { readers: 1, judged: [], checks: [
    { key: 'msg_to|b', type: 'msg_to', polarity: 'must', cat: 'positive', hard: true, support: 1, readers: ['r1'], params: { target: { email: 'b@corp.example' } } }] } };
  assert.equal(readerAccept(solo, { diff, world0, final }).accept, false, 'its own hard check fails');
  // in a 3-reader merge the same single-reader item is soft: the share-of-merged signal accepts
  const results = [{ type: 'effect_any', pass: true }, { pass: false, hard: false }];
  assert.equal(readerVerdicts(results, { checks: [{ readers: ['r1'] }] }).r1.accept, false, 'v1 share counts the failed soft item too');
  assert.equal(readerAccept({ readers: [] }, { diff, world0, final }), null, 'no extraction: no verdict');
});

test('review 15: bounds read at n_eff round failures up; nothing released has risk null', () => {
  assert.equal(scaledFailures(1, 13, 6), 1, 'risk 0.077 at n_eff 6: one failure, not zero');
  assert.ok(Math.abs(clopperPearson(scaledFailures(1, 13, 6), 6, { sides: 1 }).hi - 0.582) < 0.01);
  assert.ok(clopperPearson(Math.round((1 / 13) * 6), 6, { sides: 1 }).hi < 0.4, 'teeth: rounding to nearest gives the anti-conservative 0.39');
  assert.equal(scaledFailures(0, 12, 6), 0);
  assert.equal(scaledFailures(12, 12, 6), 6);
  const items = [{ task: 't', y: true, v: { S: 0, F: 1, U: 0, unknownShare: 1, release: false, row: FAILED } }];
  assert.equal(pointAt(items, 1).released, 0);
  assert.equal(pointAt(items, 1).risk, null);
  assert.equal(pointAt(items, 1).riskUpper, null);
});

test('review 7: run.mjs selection, analysis and manifest functions (teeth: score-only selection, R1 ties, manifest without verifier nodes)', () => {
  const V = (S, F, U) => ({ S, F, U, unknownShare: S + U ? U / (S + U) : 1, release: F === 0 && S + F + U > 0, row: F ? FAILED : U ? UNKNOWN : S ? SUPPORTED : UNKNOWN, vacuous: S + F + U === 0, assumptions: Array.from({ length: U }, () => ({ kind: 'soft' })) });
  const row = (task, arm, y, v, rl2v, fold = 0) => ({ task, arm, y, v, rl2v, fold, ownAllPass: null });
  const its = [
    row('t1', 'A', false, V(1, 1, 0), { accept: false, score: 0.9 }), row('t1', 'B', true, V(0, 0, 3), { accept: true, score: 0.5 }),
    row('t2', 'A', true, V(2, 0, 1), { accept: true, score: 0.8 }, 3), row('t2', 'B', false, V(1, 0, 1), { accept: true, score: 0.9 }, 3),
    row('t3', 'A', true, V(1, 0, 0), { accept: true, score: 1 }), row('t3', 'B', true, V(1, 0, 0), { accept: true, score: 1 }),
  ];
  const byTask = new Map(['t1', 't2', 't3'].map(t => [t, its.filter(i => i.task === t)]));
  const tri = selectPool(byTask, ['A', 'B'], RULES.tri);
  assert.deepEqual([tri.passes, tri.gains, tri.losses, tri.oracle], [3, 1, 0, 3]);
  assert.deepEqual(tri.per.map(p => p.arm), ['B', 'A', 'A'], 'fewer FAILED first; more SUPPORTED next; a tie keeps the default');
  const r1 = selectPool(byTask, ['A', 'B'], RULES.R1);
  assert.deepEqual([r1.passes, r1.gains, r1.losses], [2, 1, 1], 'R1 follows the RL2 score on t2 and loses it');
  const score = selectPool(byTask, ['A', 'B'], (c, b) => c.v.S - c.v.U > b.v.S - b.v.U);
  assert.notEqual(score.passes, tri.passes, 'teeth: a net score picks differently');
  const s = summarizeSelection(tri, { heldout: new Set([3]), hard: new Set(['t3']) });
  assert.deepEqual([s.all.passes, s.heldout.n, s.reachable.n, s.reachable.passes], [3, 1, 2, 2]);
  const res = analyzeConfig(its, { heldout: new Set([3]), hard: new Set(['t3']), pools: { P: ['A', 'B'] } });
  assert.equal(res.selection.P.tri.all.passes, 3);
  assert.equal(res.kill.decision, 'not triggered');
  assert.equal(res.rows.n, 6);
  assert.equal(res.unknownKinds.soft, 5);
  assert.equal(analyzeConfig(its, { selection: false }).selection, undefined);
  // manifest: every fork node that is a model or a session, plus the rule's verifier nodes; headlineRow accepts it as legacy
  const m = selectionManifest({ forks: [{ arm: 'A', model: 'm-a', effort: null, cap: 1, pipelineNodes: [{ name: 'inv', kind: 'code' }, { name: 'ledger-1', kind: 'model', model: 'mercury-3' }, { name: 'act', kind: 'session', model: 'claude-haiku-5-5', cap: 39 }] },
    { arm: 'B', model: 'm-b', effort: null, cap: 2, pipelineNodes: null }], verifierNodes: [{ name: 'rl2-reader-0', kind: 'model', model: 'claude-haiku-5-5', effort: 'reasoning:low' }] });
  assert.deepEqual(m.nodes.map(n => n.name), ['A:ledger-1', 'A:act', 'B:session', 'rl2-reader-0']);
  const h = headlineRow({ label: 'x', passes: 3, n: 3, reachable: { passes: 2, n: 2 }, manifest: m, costUsd: 0.3, legacy: 'pre-D28' });
  assert.equal(h.manifest.conforming, false);
  assert.deepEqual(h.manifest.missingEffort, ['A:ledger-1', 'A:act', 'B:session'], 'the verifier node records its effort; the legacy forks do not');
  assert.ok(Math.abs(h.costPerSuccess - 0.1) < 1e-12);
  assert.throws(() => headlineRow({ label: 'x', passes: 3, n: 3, reachable: { passes: 2, n: 2 }, manifest: m }), /effort/i, 'teeth: without the legacy flag the unset effort is an error');
});
