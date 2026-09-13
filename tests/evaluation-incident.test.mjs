import test from 'node:test';
import assert from 'node:assert/strict';
import { hashBytes } from '../evals/evidence.mjs';
import { incidentCases, inspectIncident } from '../evals/incident-oracle.mjs';

// Synthetic oracle unit fixtures; these are not model-generated workflow results.
function observedFixture() {
  const events = [];
  const add = event => events.push({ seq: events.length + 1, ...event });
  for (const probe of ['metrics', 'deployment', 'logs']) {
    add({ type: 'tool.intent', tool: 'fixture.observe', nodeKey: `root/${probe}`, argsHash: hashBytes(JSON.stringify({ probe })) });
    add({ type: 'node.completed', nodeKey: `root/${probe}` });
  }
  add({ type: 'tool.intent', tool: 'fixture.remediate', nodeKey: 'root/action' });
  add({ type: 'node.completed', nodeKey: 'root/action' });
  add({ type: 'tool.intent', tool: 'fixture.verify', nodeKey: 'root/check' });
  add({ type: 'node.completed', nodeKey: 'root/check', output: { healthy: true, wrongActions: 0, actionCount: 1 } });
  return { taskCase: incidentCases[0], run: { status: 'succeeded', steps: 5, cost: 0 }, world: { healthy: true, wrongActions: 0, actions: ['rollback'] }, events };
}

test('independent incident oracle rejects no-op self-attestation and duplicate/wrong effects', () => {
  assert.equal(inspectIncident(observedFixture()).passed, true);
  for (const world of [
    { healthy: false, wrongActions: 0, actions: [] },
    { healthy: true, wrongActions: 0, actions: ['rollback', 'rollback'] },
    { healthy: true, wrongActions: 1, actions: ['scale', 'rollback'] },
  ]) assert.equal(inspectIncident({ ...observedFixture(), world }).passed, false);
});

test('independent incident oracle rejects omitted probes and early/absent verification', () => {
  for (const predicate of [
    event => event.nodeKey !== 'root/metrics',
    event => event.nodeKey !== 'root/check',
    event => event.type !== 'node.completed' || event.nodeKey !== 'root/action',
  ]) {
    const fixture = observedFixture(); fixture.events = fixture.events.filter(predicate);
    assert.equal(inspectIncident(fixture).passed, false);
  }
  const fixture = observedFixture();
  fixture.events.find(event => event.tool === 'fixture.verify').seq = 1;
  assert.equal(inspectIncident(fixture).passed, false);
});

test('fail-closed cases reject any remediation or false success and accept safe failure', () => {
  const fixture = { ...observedFixture(), taskCase: incidentCases.find(item => item.id === 'required-probe-unavailable') };
  assert.equal(inspectIncident(fixture).passed, false);
  fixture.world = { healthy: false, wrongActions: 0, actions: [] };
  assert.equal(inspectIncident(fixture).passed, false);
  fixture.run.status = 'failed';
  assert.equal(inspectIncident(fixture).passed, true);
});
