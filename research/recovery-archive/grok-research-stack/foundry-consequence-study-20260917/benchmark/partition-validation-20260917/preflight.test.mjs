import assert from 'node:assert/strict';
import test from 'node:test';
import { validateData } from '/home/raed/Projects/workflow-foundry/src/validate.mjs';
import { INSTRUMENT_DESCRIPTORS } from '../contract.mjs';
import { build } from './suite.mjs';
import { preflight } from './preflight.mjs';

test('98 independent cases satisfy native schema validation, tensor counts, and metamorphic checks', () => {
  const result = preflight();
  assert.equal(result.passed, true);
  assert.equal(result.candidateExecutions, 0);
  assert.equal(result.reservation.sum, 196);
});

test('suite construction is deterministic across fresh constructions', () => {
  assert.deepEqual(build(), build());
});

test('malformed return types lie outside the advertised executable fixture domain', () => {
  const screen = INSTRUMENT_DESCRIPTORS.find(item => item.name === 'lab.screen').outputSchema;
  const reproduction = INSTRUMENT_DESCRIPTORS.find(item => item.name === 'lab.reproduce').outputSchema;
  for (const suspicious of ['true', 1, null]) {
    assert.throws(() => validateData(screen, { ok: true, sampleId: 'type-check', suspicious }));
  }
  for (const patch of [{ independent: 'true' }, { reproduced: 'false' }, { evidenceId: 1 }, { ok: false }]) {
    assert.throws(() => validateData(reproduction, { ok: true, sampleId: 'type-check', ...patch }));
  }
  assert.doesNotThrow(() => validateData(screen, { ok: true, sampleId: 'wrong-string-identity' }));
  assert.doesNotThrow(() => validateData(reproduction, { ok: true, sampleId: 'wrong-string-identity' }));
});

test('a same-input expectation swap is caught without a candidate execution', () => {
  const data = build();
  const swaps = data.index.map((meta, position) => ({ meta, position })).filter(row => row.meta.group === 'same-input-swap');
  const left = swaps[0].position, right = swaps[1].position;
  data.suite.cases[left].expect.artifacts[0].json = structuredClone(data.expected[right].manifest);
  assert.throws(() => preflight(data));
});
