import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JudgmentPort } from '../src/ports.mjs';
import { SystemOneClient, JudgmentLedger, calibrationReport, toSystemOneQuestion, fromSystemOneAnswer } from '../src/judgment.mjs';

const fakeServer = (respond) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const { status = 200, body } = await respond(url, init);
    return { status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  return { calls, fetchImpl };
};

test('System One question maps options to choice criteria and keeps criteria in the instructions', () => {
  const q = toSystemOneQuestion({ question: 'Does the workflow apply?', criteria: ['inputs match', 'no unsupported effects'], options: ['yes', 'no'], optionDescriptions: { yes: 'applies' } });
  assert.deepEqual(q, { type: 'choice', instructions: 'Does the workflow apply?\nCriteria:\n- inputs match\n- no unsupported effects', criteria: { yes: 'applies', no: '' } });
});

test('System One answers are renormalised over exactly the offered options', () => {
  const out = fromSystemOneAnswer({ type: 'choice', choice: 'b', probabilities: { a: 0.2, b: 0.6, c: 0.2 } }, ['a', 'b', 'c']);
  assert.equal(out.chosen, 'b'); assert.equal(out.confidence, 0.6);
  assert.throws(() => fromSystemOneAnswer({ type: 'choice', probabilities: { a: 0.5, z: 0.5 } }, ['a', 'b']), /exactly the offered options/);
  assert.throws(() => fromSystemOneAnswer({ type: 'noul', noul: 0.4 }, ['a', 'b']), /not a choice/);
  assert.throws(() => fromSystemOneAnswer({ type: 'choice', probabilities: { a: 0, b: 0 } }, ['a', 'b']), /sum to zero/);
  assert.throws(() => fromSystemOneAnswer({ type: 'choice', probabilities: { a: -1, b: 2 } }, ['a', 'b']), /exactly the offered options/);
});

test('JudgmentPort systemone engine: request shape, probabilities, ledger row, no credential leak', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'judg-'));
  try {
    const srv = fakeServer(async () => ({ body: { model: 'kev-latest', answers: { applicability: { type: 'choice', choice: 'no', confidence: 0.5, probabilities: { yes: 0.25, no: 0.75 } } }, latency_ms: 12 } }));
    const client = new SystemOneClient({ url: 'http://127.0.0.1:9', fetchImpl: srv.fetchImpl, env: { FOUNDRY_SYSTEMONE_API_KEY: 'k-test' } });
    const ledger = new JudgmentLedger(path.join(dir, 'ledger.jsonl'));
    const port = new JudgmentPort({ engine: 'systemone', systemOne: client, systemOneModel: 'kev-0.8b@v1.0', ledger });
    const r = await port.judge({ port: 'applicability', question: 'Does workflow W apply to this task?', options: ['yes', 'no'], state: { task: 'reconcile invoices' }, split: 'calibration' });
    assert.equal(r.chosen, 'no'); assert.equal(r.confidence, 0.75); assert.equal(r.model, 'kev-0.8b@v1.0'); assert.equal(r.engine, 'systemone');
    assert.equal(srv.calls[0].url, 'http://127.0.0.1:9/v1/systemone');
    assert.equal(srv.calls[0].init.headers.authorization, 'Bearer k-test');
    assert.deepEqual(srv.calls[0].body.state, { task: 'reconcile invoices' });
    assert.equal(srv.calls[0].body.questions.applicability.type, 'choice');
    ledger.label(r.ledgerId, 'no');
    const rows = ledger.rows();
    assert.equal(rows.length, 1); assert.equal(rows[0].truth, 'no'); assert.equal(rows[0].split, 'calibration');
    assert.ok(!JSON.stringify(rows).includes('k-test'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('SystemOneClient maps HTTP failures to stable error codes', async () => {
  for (const [status, code] of [[401, 'MODEL_AUTH'], [422, 'MODEL_CONTEXT'], [429, 'MODEL_QUOTA'], [503, 'MODEL_UNAVAILABLE'], [404, 'MODEL_FAILED']]) {
    const srv = fakeServer(async () => ({ status, body: 'nope' }));
    const client = new SystemOneClient({ url: 'http://x.invalid', fetchImpl: srv.fetchImpl, env: {} });
    await assert.rejects(client.ask({ state: 's', questions: { q: { type: 'noul', instructions: 'x' } } }), e => e.code === code);
  }
  const down = new SystemOneClient({ url: 'http://x.invalid', fetchImpl: async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); }, env: {} });
  await assert.rejects(down.ask({ state: 's', questions: { q: { type: 'noul', instructions: 'x' } } }), e => e.code === 'MODEL_UNAVAILABLE' && /ECONNREFUSED/.test(e.message));
  assert.throws(() => new SystemOneClient({ url: 'file:///etc/passwd' }), /http\(s\) url/);
});

test('calibrationReport: accuracy, Brier, ECE and the error-budget threshold', () => {
  const opts = ['yes', 'no'];
  const row = (pYes, truth) => ({ options: opts, probabilities: { yes: pYes, no: 1 - pYes }, chosen: pYes >= 0.5 ? 'yes' : 'no', confidence: Math.max(pYes, 1 - pYes), truth });
  // 10 confident and right, 4 unsure with 2 wrong
  const rows = [...Array.from({ length: 10 }, () => row(0.95, 'yes')), row(0.6, 'yes'), row(0.6, 'no'), row(0.4, 'no'), row(0.4, 'yes')];
  const rep = calibrationReport(rows, { bins: 10, errorBudget: 0.05 });
  assert.equal(rep.n, 14);
  assert.ok(Math.abs(rep.accuracy - 12 / 14) < 1e-12);
  const expectedBrier = (10 * 2 * 0.05 ** 2 + 2 * (2 * 0.4 ** 2) + 2 * (2 * 0.6 ** 2)) / 14;
  assert.ok(Math.abs(rep.brier - expectedBrier) < 1e-12);
  assert.equal(rep.threshold, 0.95); assert.ok(Math.abs(rep.coverageAtBudget - 10 / 14) < 1e-12);
  const at06 = rep.curve.find(c => c.threshold === 0.6);
  assert.equal(at06.coverage, 1); assert.ok(Math.abs(at06.risk - 2 / 14) < 1e-12);
  const at95 = rep.curve.find(c => c.threshold === 0.95);
  assert.equal(at95.falseAbstainRate, 0.5);
  // ECE: bin [0.9,1): conf .95 acc 1 (10 rows); bin [0.6,0.7): conf .6 acc .5 (4 rows)
  assert.ok(Math.abs(rep.ece - ((10 / 14) * 0.05 + (4 / 14) * 0.1)) < 1e-12);
  assert.deepEqual(calibrationReport([{ options: opts, probabilities: {}, chosen: 'yes', confidence: 1, truth: null }]), { n: 0 });
});

const liveUrl = process.env.FOUNDRY_SYSTEMONE_URL;
test('live: a System One server (Kev or Jev) answers a typed question', { skip: liveUrl ? false : 'requires FOUNDRY_SYSTEMONE_URL (a running kev.serve or Jev endpoint)' }, async () => {
  const client = new SystemOneClient({ url: liveUrl });
  const port = new JudgmentPort({ engine: 'systemone', systemOne: client });
  const r = await port.judge({ port: 'failure_class', question: 'What kind of failure does this log show?', options: ['network', 'assertion', 'timeout'],
    state: { log: 'AssertionError: expected 3 but got 4 at test_total (tests/test_cart.py:41)' } });
  assert.ok(['network', 'assertion', 'timeout'].includes(r.chosen));
  assert.ok(Math.abs(Object.values(r.probabilities).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});
