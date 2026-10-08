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
  assert.equal(w.incident.passing.length, 35); assert.deepEqual(w.incident.failing.map(t => t.key), [KEY]); assert.deepEqual(w.incident.excluded, []);
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
