import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeContext, renderChanges, renderRecords, renderTable } from '../view.mjs';
import { INSTRUCTIONS, OUTPUT_SCHEMA, judgeMessages, parseVerdict } from '../judge.mjs';
import { auroc, confusion, fitLogistic } from '../metrics.mjs';
import { portableSchemaViolations } from '../../../../../src/schema-subset.mjs';

const world = {
  meta: { current_time: '2026-01-01T00:00:00Z', hidden_reference_date: '2026-03-15' },
  gmail: { messages: [{ id: 'm1', to: ['a@x.example'], subject: 'Policy', body_plain: 'Line one\nLine | two', is_read: false }] },
  slack: { channels: [{ id: 'C1', name: 'ops' }], messages: [] },
  twitter: { posts: [{ id: 't1', text: 'not connected' }] },
};
const view = {
  vid: 'v-1', prompt: { system: 'You are an agent.', user: 'Email the policy owner.' }, today: '2026-01-01T00:00:00Z', services: ['gmail', 'slack'],
  diff: { changes: [
    { app: 'gmail', coll: 'messages', op: 'created', id: 'm2', record: { id: 'm2', to: ['b@x.example'], body_plain: 'hello', cc: [] } },
    { app: 'gmail', coll: 'messages', op: 'updated', id: 'm1', fields: { is_read: [false, true] } },
    { app: 'slack', coll: 'channels', op: 'updated', id: 'C1', fields: { topic: ['', 'new topic'], members: [['u1'], ['u1', 'u2']] } },
  ] },
};

test('world meta and apps that are not connected never reach the judge', () => {
  const ctx = judgeContext(view, world);
  const all = ctx.shared + ctx.candidate;
  assert.ok(!all.includes('hidden_reference_date') && !all.includes('2026-03-15'));
  assert.ok(!all.includes('not connected'));
  assert.ok(all.includes('Policy'));
});

test('records render as bounded tables; line breaks and pipes are escaped', () => {
  const t = renderTable(world.gmail.messages, 100);
  assert.equal(t.split('\n').length, 2);
  assert.ok(t.includes('Line one⏎Line ¦ two'));
  const big = { gmail: { messages: Array.from({ length: 500 }, (_, i) => ({ id: `m${i}`, body_plain: 'x'.repeat(2000) })) } };
  const r = renderRecords(big, { services: ['gmail'], capChars: 5000 });
  assert.ok(r.chars <= 5000 + 64 && r.truncated);
});

test('changes: created and updated are shown, touch-only updates are counted, list fields show what was added', () => {
  const { text } = renderChanges(view.diff, world);
  assert.match(text, /\+ created gmail\.messages id=m2/);
  assert.match(text, /1 gmail\.messages record only had read flags or timestamps changed/);
  assert.match(text, /members: added \["u2"\]/);
  assert.match(text, /topic: "" → "new topic"|topic: null → "new topic"/);
});

test('an empty diff says so', () => {
  assert.match(renderChanges({ changes: [] }, world).text, /no changes/);
});

test('the output schema is in the portable subset and the instructions name no task', () => {
  assert.deepEqual(portableSchemaViolations(OUTPUT_SCHEMA), []);
  const m = judgeMessages(judgeContext(view, world));
  assert.ok(m.system.startsWith(INSTRUCTIONS));
  assert.ok(m.prompt.includes('<changes>'));
});

test('parseVerdict normalizes p_done and derives requirement scores', () => {
  const v = parseVerdict({ requirements: [{ kind: 'must', requirement: 'a', verdict: 'met', evidence: '' }, { kind: 'must_not', requirement: 'b', verdict: 'unclear', evidence: '' }], overall: 'pass', p_done: 80, summary: 's' });
  assert.equal(v.confidence, 0.8);
  assert.equal(v.reqScore, 0.75);
  assert.equal(v.strictPass, false);
  assert.equal(parseVerdict({ requirements: [], overall: 'fail', p_done: 'x', summary: '' }).confidence, 0.25);
});

test('metrics: AUROC with ties, confusion, logistic fit', () => {
  assert.equal(auroc([{ y: 1, s: 0.9 }, { y: 0, s: 0.1 }]), 1);
  assert.equal(auroc([{ y: 1, s: 0.5 }, { y: 0, s: 0.5 }]), 0.5);
  const c = confusion([{ y: 1, d: true }, { y: 0, d: true }, { y: 1, d: false }]);
  assert.equal(c.precision, 0.5); assert.equal(c.recall, 0.5);
  const m = fitLogistic([[-2], [-1], [1], [2]], [0, 0, 1, 1], { l2: 0.1 });
  assert.ok(m.predict([2]) > 0.8 && m.predict([-2]) < 0.2);
});
