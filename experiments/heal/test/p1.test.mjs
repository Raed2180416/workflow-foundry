import test from 'node:test';
import assert from 'node:assert/strict';
import { incidentFor, envOf, runVerify } from './fixtures.mjs';
import { mechanicalProposal } from '../propose.mjs';
import { decide } from '../promote.mjs';
import { acceptedCalls } from '../replay.mjs';
import { digest } from '../ir.mjs';
import { skipReason } from './helpers.mjs';

const KEY = 'fhand-haiku/records:test:d3:s5002/1';
const flip = (ctx0, trial) => { const row = acceptedCalls(ctx0.journal, trial.runId).find(r => r.nodeKey === 'root/statuses:1/judge');
  return { id: 'c36', node: 'judge', nodeKey: row.nodeKey, type: 'inject', path: 'meaning', pathArr: ['meaning'], rowId: row.id, from: 'live', to: 'void', ran: true, pass: true, score: 1, deltaScore: 0.054, changedShare: 0.05, needsLive: false }; };

test('records-v3 (P1): the eleven-op mechanical lint-debt proposal passes V0-V3 on the recorded failure; partial verification never promotes', { skip: skipReason }, async () => {
  const w = await incidentFor(KEY, 'p1', flip), { wf, gate } = w;
  // 2026-10-21: one run under load ~20 saw 30 of 35 (not reproduced in three reruns); the exclusions are printed if it recurs
  // 2026-11-04: recurred at load 20.6 (27 of 35); every exclusion ended CODE_TIMEOUT, a code node's wall-clock budget crossed by a
  // CPU-starved strict replay (frozen kit src/sandbox.mjs:166), not a divergence of the evidence (RESULT-FH1 §10.8 m8)
  assert.equal(w.incident.passing.length, 35, JSON.stringify(w.incident.excluded)); assert.deepEqual(w.incident.failing.map(t => t.key), [KEY]); assert.deepEqual(w.incident.excluded, []);
  const m = mechanicalProposal({ base: wf.p1, baseHash: digest(wf.p1), lint: gate.lintWorkflow(wf.p1, { modelPolicy: w.policy }), env: envOf(w) }), proposal = m.proposal;
  assert.equal(proposal.ops.length, 11);
  const v = await runVerify(w, { base: wf.p1, proposal, extra: { stages: ['V0', 'V1', 'V2', 'V3'] } });
  assert.deepEqual(v.stages.map(s => [s.id, s.ok]), [['V0', true], ['V1', true], ['V2', true], ['V3', true]], JSON.stringify(v.stages.filter(s => s.ok !== true)));
  assert.deepEqual(v.stages.find(s => s.id === 'V1').errors, [11, 0]);
  const row = v.data.replicas[0].rows[0];
  assert.equal(row.liveCalls, 0); assert.equal(row.pass, false, 'the lint debt does not claim to fix the false pass');
  assert.equal(row.status, 'succeeded', 'the structural gates accept this answer: only the acceptance got stronger');
  assert.equal(v.partial, true); assert.equal(decide(v, proposal).decision, 'pending');
});

test('records-v3 (P1): V5 sends the bed controls through the gating verify; the lint-debt acceptance accepts the reference and rejects 4 of 14 wrong answers (a partial gate)', { skip: skipReason }, async () => {
  const w = await incidentFor(KEY, 'p1', flip), { wf, gate } = w;
  // controls are hosted by a recorded PASSING run (its evidence agrees with the truth), not by the failing one
  assert.notEqual(w.incident.controls.trialKey, KEY);
  assert.ok(w.incident.passing.some(t => t.key === w.incident.controls.trialKey));
  const proposal = mechanicalProposal({ base: wf.p1, baseHash: digest(wf.p1), lint: gate.lintWorkflow(wf.p1, { modelPolicy: w.policy }), env: envOf(w) }).proposal;
  const v = await runVerify(w, { base: wf.p1, proposal, extra: { stages: ['V0', 'V1', 'V2', 'V5'] } });   // V3/V4 are exercised by the test above and by the incident run
  assert.deepEqual(v.stages.map(s => [s.id, s.ok]), ['V0', 'V1', 'V2', 'V5'].map(id => [id, true]), JSON.stringify(v.stages.filter(s => s.ok !== true)));
  const v5 = v.stages.find(s => s.id === 'V5'), table = v.data.controls, by = n => table.find(t => t.name === n);
  assert.equal(v5.grade, 'gating'); assert.equal(by('reference').cand.accepted, true, 'the bed reference passes the strengthened acceptance');
  assert.ok(table.every(t => t.base.accepted === true), 'existence-only acceptance accepts every control: that is the lint debt');
  const rejected = table.filter(t => t.expect === 'reject' && t.cand.accepted === false).map(t => t.name).sort();
  assert.deepEqual(rejected, ['empty', 'ignore-void-markers', 'status-meaning-flipped', 'unknown-status-live']);
  assert.equal(v5.badControls, 14); assert.equal(v5.rejectsBad, 4, 'the structural verify cannot see date-order, dedup or amount errors: gating, but not a correctness oracle');
  assert.equal(decide(v, proposal).decision, 'pending');
});
