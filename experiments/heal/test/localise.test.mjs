import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { localise, finish, defectClasses, wilsonLower, generateCandidates, varianceTest, DEFAULTS } from '../localise.mjs';
import { openCtx } from '../replay.mjs';
import { world, skipReason, byKey } from './helpers.mjs';

const flatten = x => x.flat();

test('H-cfx: flipping check1.ok is the only single-node change that fixes codefix s6004 t0; root check1, clone locus check1+check2, routed veto', { skip: skipReason }, async () => {
  const { kit, trials, wf } = await world();
  const trial = byKey(trials, 'F-haiku/codefix:test:d3:s6004/0');
  const loc = await localise({ trial, workflow: wf.codefix, kit, trials, only: c => c.node === 'check1' || c.node === 'check2' });
  assert.equal(loc.blocked, undefined); assert.equal(loc.fidelity.identical, true);
  assert.equal(loc.base.pass, false);
  assert.deepEqual(loc.flippers.length, 1);
  assert.equal(loc.root.node, 'check1'); assert.equal(loc.root.confidence, 'high');
  assert.deepEqual(loc.root.locus, ['check1', 'check2'], 'identical clone nodes are one locus (R-16 read as one locus)');
  assert.deepEqual(loc.root.sample.from, false); assert.deepEqual(loc.root.sample.to, true);
  const codes = loc.classes.map(c => c.code);
  assert.deepEqual(codes, ['OVERSTRICT_CHECK', 'CHECK_VETO_ROUTING']);
  assert.deepEqual(loc.classes[0].routedTo.sort(), ['check2', 'repair']);
  assert.deepEqual(loc.classes[0].intermediatesPassing, ['fix'], 'the output of fix already passes the oracle on its own');
  const flip = loc.candidates.find(c => c.id === loc.flippers[0]);
  assert.equal(flip.pass, true); assert.equal(flip.calls, 1, 'the Opus repair is skipped'); assert.equal(flip.needsLive, false);
  assert.equal(loc.candidates.filter(c => c.node === 'check2').every(c => !c.pass), true, 'flipping the clone check2 does not fix the failure');
});

test('H-rec: of the single-field flips of the conf read exactly one fixes s6001 t0: BRIGHTDESK numeric order MDY->DMY (high confidence, unguarded global read)', { skip: skipReason }, async () => {
  const { kit, trials, wf } = await world();
  const trial = byKey(trials, 'F-haiku/records:test:d3:s6001/0');
  const loc = await localise({ trial, workflow: wf.records, kit, trials, only: c => c.node === 'conf' && c.type === 'inject' });
  assert.equal(loc.candidates.length, 24, '6 systems x (3 other date orders + sign)');
  assert.equal(loc.flippers.length, 1);
  const f = loc.candidates.find(c => c.id === loc.flippers[0]);
  assert.deepEqual([f.node, f.path, f.from, f.to], ['conf', 'orders.0.numeric_order', 'MDY', 'DMY']);
  assert.deepEqual(f.identity, { system: 'BRIGHTDESK' });
  assert.equal(f.score, 1); assert.ok(f.changedShare > 0.2);
  assert.equal(loc.root.node, 'conf'); assert.equal(loc.root.confidence, 'high');
  assert.equal(loc.classes[0].code, 'UNGUARDED_GLOBAL_READ');
  assert.equal(loc.candidates.filter(c => c.pass).length, 1);
  assert.ok(loc.candidates.filter(c => c.score > 0.5 && !c.pass).length >= 20, 'the other flips score 0.577-0.789');
  assert.equal(loc.mode, 'failure');
});

test('H-p1: flipping one map item meaning live->void fixes the false pass; relation flips need a live escalation (escalation-dependent); other recorded samples also pass', { skip: skipReason }, async () => {
  const { kit, trials, wf } = await world();
  const trial = byKey(trials, 'fhand-haiku/records:test:d3:s5002/1');
  const loc = await localise({ trial, workflow: wf.p1, kit, trials, only: c => c.nodeKey.startsWith('root/statuses:') && (c.path[0] === 'meaning' || c.path[0] === 'relation' || c.type === 'recorded-alt') });
  const flips = loc.candidates.filter(c => c.flips);
  assert.ok(flips.some(c => c.type === 'inject' && c.path === 'meaning' && c.from === 'live' && c.to === 'void'));
  assert.equal(loc.root.node, 'statuses'); assert.equal(loc.root.confidence, 'high');
  assert.equal(loc.classes[0].code, 'CHECK_ESCAPE_HATCH'); assert.equal(loc.classes[0].bodyNode, 'judge'); assert.equal(loc.classes[0].field, 'meaning');
  const rel = loc.candidates.filter(c => c.path === 'relation');
  assert.ok(rel.length >= 2 && rel.every(c => c.needsLive && !c.flips), 'relation flips fail the node check and need an unjournaled escalation');
  assert.ok(loc.needsLive >= 2);
  assert.ok(flips.filter(c => c.type === 'recorded-alt').length >= 1, 'other recorded samples of the same prompt carry the passing value: variance evidence');
  assert.equal(loc.variance.source, 'recorded'); assert.equal(loc.variance.decisive, false, 'two samples are suggestive, not decisive');
});

test('localise on a passing run: latent mode ranks the answer-changing, unguarded flips (fragility) without an oracle verdict', { skip: skipReason }, async () => {
  const { kit, trials, wf } = await world();
  const trial = byKey(trials, 'F-haiku/records:test:d3:s6002/0');
  const loc = await localise({ trial, workflow: wf.records, kit, trials, only: c => c.node === 'conf' && c.type === 'inject' });
  assert.equal(loc.mode, 'latent'); assert.equal(loc.base.pass, true);
  const fragile = loc.candidates.filter(c => !c.pass && c.changedShare >= 0.05 && c.path.endsWith('numeric_order'));
  assert.ok(fragile.length >= 3, 'flipping a date order changes at least 5% of the answer and fails the oracle');
  assert.ok(loc.suspects[0].node === 'conf' && loc.flippers.length >= 3);
  const ledgr = loc.candidates.filter(c => c.identity?.system === 'LEDGR' && c.path.endsWith('numeric_order'));
  assert.ok(ledgr.every(c => c.changedShare === 0 && c.pass), 'LEDGR flips change nothing and still pass');
});

test('finish(): confidence rules and classes are pure functions of the candidate table', () => {
  const wfl = { nodes: [{ id: 'a', kind: 'agent', needs: [], checks: [] }, { id: 'b', kind: 'agent', needs: ['a'], checks: [{ op: 'eq', left: 1, right: 1 }] }, { id: 'c', kind: 'code', needs: ['b'] }, { id: 'd', kind: 'agent', needs: [] }] };
  const head = { base: { pass: false, score: 0.5 } };
  const row = (id, node, over = {}) => ({ id, node, nodeKey: `root/${node}`, type: 'inject', path: 'x', from: 1, to: 2, ran: true, pass: false, score: 0.5, deltaScore: 0, changedShare: 0.1, needsLive: false, ...over });
  let r = finish({ head, workflow: wfl, rows: [row('c1', 'a', { pass: true, score: 1 })] });
  assert.equal(r.root.confidence, 'high'); assert.equal(r.classes[0].code, 'UNGUARDED_GLOBAL_READ');
  r = finish({ head, workflow: wfl, rows: [row('c1', 'a', { pass: true }), row('c2', 'b', { pass: true })] });
  assert.equal(r.root.node, 'a'); assert.equal(r.root.confidence, 'medium', 'a is upstream of b');
  r = finish({ head, workflow: wfl, rows: [row('c1', 'a', { pass: true }), row('c2', 'd', { pass: true })] });
  assert.equal(r.root.confidence, 'low');
  r = finish({ head, workflow: wfl, rows: [row('c1', 'b', { pass: true })] });
  assert.equal(r.classes[0].code, 'CHECK_ESCAPE_HATCH', 'b has checks and the flipped value passed them');
  r = finish({ head, workflow: wfl, rows: [row('c1', 'a', { needsLive: true, pass: false })] });
  assert.equal(r.root, null); assert.equal(r.unknown, true); assert.match(r.note, /need a live escalation/);
  r = finish({ head, workflow: wfl, rows: [row('c1', 'a', { pass: true, needsLive: true })] });
  assert.equal(r.root, null, 'an escalation-dependent candidate is never a root');
});

test('wilsonLower and the offline variance estimate', () => {
  assert.ok(wilsonLower(2, 2) > 0.3 && wilsonLower(2, 2) < 0.4);
  assert.ok(wilsonLower(0, 8) === 0);
  assert.ok(wilsonLower(8, 8) > 0.6);
  assert.ok(wilsonLower(1, 8) < 0.2, 'one hit in eight is not model variance at tau 0.2');
});

test('varianceTest resamples the recorded call K times through a journaled port and reports the Wilson bound', { skip: skipReason }, async () => {
  const { kit, trials, wf } = await world();
  const trial = byKey(trials, 'F-haiku/records:test:d3:s6001/0');
  const ctx = await openCtx(trial.source, { kit, name: 'var' });
  try {
    const row = ctx.journal.forRun(trial.runId).find(r => r.nodeKey === 'root/conf');
    const good = structuredClone(row.response.value), bad = structuredClone(row.response.value);
    good.orders[0].numeric_order = 'DMY'; bad.orders[0].numeric_order = 'MDY';
    let i = 0;
    const provider = new kit.ScriptedProvider(() => ({ value: i++ % 2 ? good : bad, costUsd: 0.01 }));
    const j = kit.emptyJournal(path.join(mkdtempSync(path.join(tmpdir(), 'heal-var-')), 'journal.sqlite'));   // a fresh journal: an already-journaled attempt is recovered, never paid twice
    const port = new kit.ModelPort({ policy: ctx.policy, providers: { 'claude-cli': provider }, journal: j.journal, mode: 'live' });
    const v = await varianceTest({ journal: ctx.journal, port, workflow: wf.records, trial, rowId: row.id, path: ['orders', 0, 'numeric_order'], passingValue: 'DMY', k: 8 });
    assert.equal(v.k, 8); assert.equal(v.hits, 4); assert.equal(v.errors, 0); assert.equal(v.class, 'model-variance'); assert.ok(v.wilsonLower > 0.2);
    assert.ok(Math.abs(v.costUsd - 0.08) < 1e-9);
    assert.equal(j.journal.forRun(`heal-resample:${trial.runId}`).length, 8, 'every resample is journaled (the spend is durable)');
    assert.deepEqual(new Set(provider.calls.map(c => c.modelId)), new Set([row.modelId]), 'the same model id as the recorded call');
    j.db.close();
  } finally { ctx.close(); }
});
