// The §12 meter: reservation, refusal, bound charges; reproduces PREREG-NEED-V1 §12's M1 and M1-R figures ($0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Meter, chargeOf, chargeMany } from '../meter.mjs';
import { readJsonl } from '../adapters/util.mjs';

test('chargeOf: observed at max(reported, re-priced); unobserved at the bound', () => {
  assert.equal(chargeOf({ reportedUsd: 0.02, repricedUsd: 0.03, tokens: { input: 10 } }, 1).charged, 0.03);
  const t = chargeOf({ reportedUsd: 0, errorCode: 'MODEL_TIMEOUT' }, 1);
  assert.equal(t.charged, 1); assert.equal(t.observed, false); assert.equal(t.imputed, 1);
  assert.equal(chargeOf({ reportedUsd: 0, costUnknown: true }, 0.4).charged, 0.4);
  // a refusal with no dollars and no tokens (e.g. MODEL_RATE_LIMIT) has no observed cost: its bound
  assert.equal(chargeOf({ reportedUsd: 0, errorCode: 'MODEL_RATE_LIMIT', tokens: { input: 0, output: 0 } }, 0.4).charged, 0.4);
  const m = chargeMany([{ reportedUsd: 0.1, tokens: { input: 1 } }, { reportedUsd: 0, errorCode: 'MODEL_TIMEOUT' }], () => 1);
  assert.equal(m.charged, 1.1); assert.equal(m.unobserved, 1); assert.equal(m.observed, false);
});

test('Meter reserves before launch, refuses over the cap or the in-flight limit, settles and sets aside', () => {
  const m = new Meter({ capUsd: 2, maxInFlight: 2 });
  const a = m.reserve(1), b = m.reserve(1);
  assert.ok(a && b);
  assert.equal(m.reserve(0.01), null, 'in-flight limit');
  assert.equal(m.meterUsd, 2);
  m.settle(a, { reportedUsd: 0.25, tokens: { input: 5 } });
  assert.equal(m.meterUsd, 1.25);
  assert.equal(m.reserve(1), null, 'meter + bound would exceed the cap');
  const e = m.setAside(b, { reportedUsd: 0, errorCode: 'MODEL_RATE_LIMIT' });
  assert.equal(e.charged, 1); assert.equal(e.setAside, true);
  const s = m.snapshot();
  assert.equal(s.inFlightUsd, 0); assert.equal(s.setAsideUsd, 1); assert.equal(s.meterUsd, 1.25, 'the set-aside charge replaces its reservation');
  assert.throws(() => m.settle(a, {}), /unknown or settled/);
});

test('reproduces PREREG-NEED-V1 §12: m1 $28.9957, m1-d5 $33.9199, M1-R final rows $17.8934', () => {
  const tag = d => chargeMany(readJsonl(`research/need-router-20261014/runs/${d}/results.jsonl`).map(x => ({ reportedUsd: (x.costUsd ?? 0) + (x.imputedUsd ?? 0),
    costUnknown: !!x.costUnknown, errorCode: x.error?.code ?? null, tokens: { input: x.meta?.tokensIn ?? 0, output: x.meta?.tokensOut ?? 0 } })), 1).charged;
  assert.ok(Math.abs(tag('m1') - 28.9957) < 1e-4, `m1 ${tag('m1')}`);
  assert.ok(Math.abs(tag('m1-d5') - 33.9199) < 1e-4, `m1-d5 ${tag('m1-d5')}`);
  assert.ok(Math.abs(tag('m1-r') - 17.8934) < 1e-4, `m1-r ${tag('m1-r')}`);
});
