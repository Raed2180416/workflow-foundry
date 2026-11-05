// Held-out evaluator validity ($0, no model), PREREG-TRACKER-H §2: before any paid call on the held-out set, each reference flow is
// verified in its hidden world (except the two cases whose words ask for what no template flow can do: their reference must FAIL), every
// bad-slot control fails, and the simulated person answers each required question by wording.
//   nice -n 15 node --test --test-concurrency=1 experiments/tracker-v2/test/heldout-validity.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCase } from '../../surface/run-builder-eval.mjs';
import { respond } from '../../surface/person.mjs';
import { templateById } from '../../../app/core/library.mjs';
import { loadHeldout, slotsBuilder, controlSlots, BY_DESIGN_DEFECTIVE } from '../heldout/cases.mjs';

const cases = loadHeldout();
const worlds = mkdtempSync(path.join(tmpdir(), 'tracker-h-validity-'));
test.after(() => rmSync(worlds, { recursive: true, force: true }));

test('14 held-out requests, 2 per template, each with a hidden world, an oracle, reference slots and at least two controls', () => {
  assert.equal(cases.length, 14);
  const by = {}; for (const c of cases) by[c.template] = (by[c.template] ?? 0) + 1;
  assert.deepEqual(Object.values(by), Array(7).fill(2));
  for (const c of cases) { assert.ok(templateById(c.template), c.id); assert.ok(c.hidden && c.oracle && c.reference && c.controls.length >= 2, c.id); }
});

test('every reference flow is verified in its hidden world, except the two that cannot do what the words ask', async () => {
  for (const c of cases) {
    const rec = await runCase(c, { arm: 'REF', builder: slotsBuilder(c, c.reference), worldsRoot: worlds });
    if (BY_DESIGN_DEFECTIVE.includes(c.id)) assert.equal(rec.judgement.verified, false, `${c.id} reference should fail by design`);
    else assert.equal(rec.judgement.verified, true, `${c.id}: ${rec.judgement.reasons.join('; ')}`);
  }
});

test('every bad-slot control fails the oracle', async () => {
  for (const c of cases) for (const [k, control] of c.controls.entries()) {
    const rec = await runCase(c, { arm: 'CONTROL', builder: slotsBuilder(c, controlSlots(c, k), 'control'), worldsRoot: worlds });
    assert.equal(rec.judgement.verified, false, `${c.id} control "${control.why}" should fail`);
  }
});

test('the simulated person answers required questions by wording', () => {
  const c = id => cases.find(x => x.id === id);
  assert.deepEqual(respond(c('HE2'), { question: "What is Owen's email address?" }).matched, ['approver']);
  assert.deepEqual(respond(c('HO2'), { question: 'Which Teams channel should I post the summary to?' }).matched, ['channel']);
  assert.deepEqual(respond(c('HS1'), { question: 'What should the refund reply say?' }).matched, ['answers']);
  assert.deepEqual(respond(c('HW2'), { question: 'What email address should the report go to?' }).matched, ['recipient']);
  assert.deepEqual(respond(c('HL1'), { question: 'What are the e-mail addresses for Marcus and Priya?' }).matched, ['rules']);
});
