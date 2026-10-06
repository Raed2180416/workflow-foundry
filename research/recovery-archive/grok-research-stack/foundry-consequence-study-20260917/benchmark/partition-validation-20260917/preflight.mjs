import assert from 'node:assert/strict';
import { validateData } from '/home/raed/Projects/workflow-foundry/src/validate.mjs';
import { validateSuite } from '/home/raed/Projects/workflow-foundry/src/evaluation.mjs';
import { INPUT_SCHEMA, MANIFEST_SCHEMA, INSTRUMENT_DESCRIPTORS, PUBLIC_BUDGET } from '../contract.mjs';
import { build } from './suite.mjs';
import { expectedCase } from './expectations.mjs';

const count = values => Object.fromEntries([...new Set(values)].sort().map(value => [value, values.filter(item => item === value).length]));

export function preflight(data = build()) {
  const { suite, index, expected } = data;
  validateSuite(suite);
  assert.equal(suite.cases.length, 98);
  assert.equal(suite.cases.length * 2, 196);
  assert.ok(suite.cases.length * 2 <= 200);
  assert.equal(PUBLIC_BUDGET.maxStepsPerRun, 160);
  assert.equal(PUBLIC_BUDGET.instrumentRetries, 0);
  assert.equal(new Set(suite.cases.map(item => item.id)).size, 98);
  const descriptors = new Map(INSTRUMENT_DESCRIPTORS.map(item => [item.name, item]));
  let sampleCount = 0, returnedFixtures = 0, errorFixtures = 0;
  for (const [position, item] of suite.cases.entries()) {
    assert.equal(index[position].id, item.id);
    assert.equal(expected[position].id, item.id);
    validateData(INPUT_SCHEMA, item.input);
    const ids = item.input.samples.map(sample => sample.id);
    sampleCount += ids.length;
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(Object.keys(item.fixture.observations).sort(), [...ids].sort());
    for (const id of ids) {
      const pair = item.fixture.observations[id];
      assert.deepEqual(Object.keys(pair).sort(), ['reproduce', 'screen']);
      for (const instrument of ['screen', 'reproduce']) {
        const fixture = pair[instrument];
        assert.equal(Object.keys(fixture).length, 1);
        if (Object.hasOwn(fixture, 'returned')) {
          validateData(descriptors.get(`lab.${instrument}`).outputSchema, fixture.returned);
          returnedFixtures++;
        } else {
          assert.equal(fixture.error, instrument === 'screen' ? 'SCREEN_ERROR' : 'REPRODUCTION_ERROR');
          errorFixtures++;
        }
      }
    }
    const calculated = expectedCase(item);
    assert.deepEqual(calculated, { manifest: expected[position].manifest, requiredAttempts: expected[position].requiredAttempts, syntheticCost: expected[position].syntheticCost });
    assert.deepEqual(item.expect.artifacts[0].json, calculated.manifest);
    validateData(MANIFEST_SCHEMA, calculated.manifest);
    assert.deepEqual(calculated.manifest.samples.map(row => row.sampleId), ids);
    assert.equal(calculated.requiredAttempts.filter(attempt => attempt.instrument === 'screen').length, ids.length);
  }

  const tensor = index.map((meta, i) => ({ meta, item: suite.cases[i], expected: expected[i] })).filter(row => row.meta.group === 'reproduction-tensor');
  assert.equal(tensor.length, 54);
  assert.equal(new Set(tensor.map(row => JSON.stringify(row.meta.axes))).size, 54);
  for (const row of tensor) {
    const a = row.meta.axes;
    const closed = a.independent === true && a.evidence === 'nonempty' && a.reproduced !== 'absent' && a.identity === 'matched';
    const disposition = closed ? (a.reproduced === true ? 'confirmed' : 'not_reproduced') : 'inconclusive';
    assert.equal(row.expected.manifest.samples[0].disposition, disposition);
    assert.equal(row.expected.requiredAttempts.length, 2);
  }
  assert.deepEqual(count(tensor.map(row => row.expected.manifest.samples[0].disposition)), { confirmed: 1, inconclusive: 52, not_reproduced: 1 });
  for (const [i, meta] of index.entries()) if (meta.group === 'screening-gate') {
    const disposition = meta.screening === 'throw' ? 'error' : meta.screening === 'false-matched' ? 'clear' : 'inconclusive';
    assert.equal(expected[i].manifest.samples[0].disposition, disposition);
    assert.equal(expected[i].requiredAttempts.length, 1);
  }
  const orders = index.map((meta, i) => ({ meta, expected: expected[i] })).filter(row => row.meta.group === 'input-order');
  const byId = rows => [...rows].sort((a, b) => a.sampleId.localeCompare(b.sampleId));
  assert.equal(new Set(orders.map(row => JSON.stringify(row.expected.manifest.samples.map(value => value.sampleId)))).size, 4);
  for (const row of orders) assert.deepEqual(byId(row.expected.manifest.samples), byId(orders[0].expected.manifest.samples));

  const swaps = index.map((meta, i) => ({ meta, item: suite.cases[i], expected: expected[i] })).filter(row => row.meta.group === 'same-input-swap');
  assert.equal(swaps.length, 8);
  assert.equal(new Set(swaps.map(row => JSON.stringify(row.item.input))).size, 1);
  const claimOnly = swaps.find(row => row.meta.variant === 'claims-only');
  assert.deepEqual(claimOnly.expected.manifest, swaps[0].expected.manifest);
  const stripClaims = object => JSON.parse(JSON.stringify(object, (key, value) => key === 'claim' ? undefined : value));
  assert.deepEqual(stripClaims(claimOnly.item.fixture), stripClaims(swaps[0].item.fixture));
  assert.notDeepEqual(claimOnly.item.fixture, swaps[0].item.fixture);
  for (let position = 0; position < 6; position++) {
    assert.equal(new Set(swaps.slice(0, 6).map(row => row.expected.manifest.samples[position].disposition)).size, 5);
  }
  const whitespace = index.map((meta, i) => ({ meta, expected: expected[i] })).filter(row => row.meta.group === 'whitespace-evidence');
  assert.deepEqual(whitespace.map(row => row.expected.manifest.samples[0].disposition), ['not_reproduced', 'confirmed']);
  const lengths = [...new Set(suite.cases.map(item => item.input.samples.length))].sort((a, b) => a - b);
  assert.deepEqual(lengths, [0, 1, 2, 3, 4, 5, 6]);
  return {
    passed: true, candidateExecutions: 0, caseCount: suite.cases.length, sampleCount,
    groups: count(index.map(row => row.group)), batchLengths: count(suite.cases.map(item => item.input.samples.length)),
    expectedDispositions: count(expected.flatMap(item => item.manifest.samples.map(row => row.disposition))),
    requiredAttempts: expected.reduce((sum, item) => sum + item.requiredAttempts.length, 0),
    requiredScreens: sampleCount,
    requiredReproductions: expected.reduce((sum, item) => sum + item.requiredAttempts.filter(attempt => attempt.instrument === 'reproduce').length, 0),
    syntheticCostPerCandidate: expected.reduce((sum, item) => sum + item.syntheticCost, 0),
    declaredFixtures: { returned: returnedFixtures, errors: errorFixtures },
    fullReproductionTensor: { cells: 54, confirmed: 1, not_reproduced: 1, inconclusive: 52 },
    identicalInputSwapCases: 8, unchangedEvidenceClaimContrast: true, sixSamplePermutationCases: 4,
    nativeMaxStepsPerRun: 160, totalCandidateExecutionCap: 200,
    reservation: { primary: 98, counterpart: 98, sum: 196 },
    qualification: 'Finite schema-valid partitions and specified metamorphic contrasts; no universal coverage or proof of causal use.',
  };
}
