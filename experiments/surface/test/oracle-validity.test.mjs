// BUILDER-1 evaluator validity ($0, no model): before any paid call, every fit case's reference flow must be verified in its hidden
// world without tripping its trap, every bad control must fail, and the person and oracle must behave as declared.
// node --test --test-concurrency=1 experiments/surface/test/oracle-validity.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CASES_FILE, runCase, referenceBuilder } from '../run-builder-eval.mjs';
import { templateById, instantiate } from '../../../app/core/library.mjs';
import { judge } from '../oracle.mjs';
import { respond, FALLBACK } from '../person.mjs';
import { summarize } from '../metrics.mjs';

const doc = JSON.parse(readFileSync(CASES_FILE, 'utf8'));
const worlds = mkdtempSync(path.join(tmpdir(), 'builder1-validity-'));
test.after(() => rmSync(worlds, { recursive: true, force: true }));

test('the frozen set: 24 requests, 3 per template and 3 that no template fits, each with an answer key, a hidden world and an oracle', () => {
  assert.equal(doc.cases.length, 24);
  const by = {}; for (const c of doc.cases) by[c.template] = (by[c.template] ?? 0) + 1;
  assert.deepEqual(Object.values(by), Array(8).fill(3));
  for (const c of doc.cases.filter(x => x.template !== 'none')) { assert.ok(c.hidden && c.oracle && c.reference && c.controls.length, c.id); assert.ok(templateById(c.template), c.id); }
  assert.equal(doc.cases.filter(c => c.trap).length, 5);
  assert.equal(doc.cases.reduce((s, c) => s + c.questions.length, 0), 9);
});

test('every reference flow is verified in its hidden world and avoids its trap; the none cases refuse', async () => {
  const records = [];
  for (const c of doc.cases) {
    const rec = await runCase(c, { arm: 'REF', builder: referenceBuilder(c), worldsRoot: worlds });
    records.push(rec);
    if (c.template === 'none') assert.equal(rec.judgement.correctRefusal, true, c.id);
    else assert.equal(rec.judgement.verified, true, `${c.id}: ${rec.judgement.reasons.join('; ')}`);
    if (c.trap) assert.equal(rec.judgement.trap.violated, false, c.id);
  }
  const s = summarize(records, doc.cases);
  assert.deepEqual([s.verified, s.correctRefusals, s.traps.avoided], [21, 3, 5]);
});

test('every bad control fails the oracle (a wrong slot changes what happens in the hidden world)', async () => {
  for (const c of doc.cases.filter(x => x.template !== 'none')) for (const control of c.controls) {
    const slots = { ...c.reference, ...control.slots };
    const b = { id: 'control', build: async () => ({ status: 'ready', template: c.template, workflow: instantiate(templateById(c.template), slots), understood: { slots }, buildReport: null }) };
    const rec = await runCase(c, { arm: 'CONTROL', builder: b, worldsRoot: worlds });
    assert.equal(rec.judgement.verified, false, `${c.id} control "${control.why}" should fail`);
  }
});

test('traps fire on the over-reach they describe', () => {
  const c = id => doc.cases.find(x => x.id === id);
  const ran = effects => ({ status: 'ready', built: true, run: { status: 'succeeded', verdict: 'pass', effects: { outbox: [], chat: {}, appended: {}, ...effects } } });
  assert.equal(judge(c('I1'), ran({ outbox: [{ to: 'finance@birchevents.example', subject: 'x', body: 'LF-205' }] })).trap.violated, true);
  assert.equal(judge(c('S1'), ran({ outbox: [{ to: 'amir@post.example', subject: 'x', body: 'y' }] })).trap.violated, true);
  assert.equal(judge(c('E1'), ran({ appended: { 'expense-decisions': [{ id: 'X-3', decision: 'Approved' }] } })).trap.violated, true);
  assert.equal(judge(c('C1'), ran({ appended: { newsletter: [{ email: 'cleo@sundial.example' }] } })).trap.violated, true);
  assert.equal(judge(c('N1'), { status: 'ready', built: true, run: null }).trap.violated, true);
  assert.equal(judge(c('N1'), { status: 'unsupported', built: false, run: null }).correctRefusal, true);
  assert.deepEqual(judge(c('W1'), ran({ outbox: [{ to: 'priya.n@kestrel-labs.io', subject: 'Weekly', body: 'Redesign onboarding screens, Icon set v2, Pricing page mockups' }], appended: { tracker: [{ title: 'x' }] } })).reasons,
    ['sheet tracker: the flow appended 1 row(s) to a source sheet']);
});

test('the simulated person answers only from the answer key, by slot or by wording', () => {
  const c = id => doc.cases.find(x => x.id === id);
  assert.deepEqual(respond(c('W3'), { slot: 'recipient', question: 'Who?' }).matched, ['recipient']);
  assert.deepEqual(respond(c('W3'), { question: 'What e-mail address should the report go to?' }).matched, ['recipient']);
  assert.equal(respond(c('W3'), { question: 'Which day should it run?' }).text, FALLBACK);
  assert.deepEqual(respond(c('L3'), { question: "What are the email addresses for Lena, Paul and you?" }).matched.sort(), ['defaultAssignee', 'rules']);
  assert.deepEqual(respond(c('E1'), { question: 'What amount counts as small?' }).matched, ['autoApproveUpTo']);
  assert.deepEqual(respond(c('O3'), { question: 'Which Slack channel should I post to?' }).matched, ['channel']);
  assert.deepEqual(respond(c('W1'), { question: 'Who should get the report?' }).matched, [], 'W1 has no required question: anything asked is unnecessary');
});
