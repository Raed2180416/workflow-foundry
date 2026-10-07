// Smoke test for the Kev probe plumbing (no Kev server, no model calls):
//   node --test experiments/kev-probe/kev-probe.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'kev-probe-'));
process.env.KEV_PROBE_RUN_DIR = dir; // keep budget and ledgers out of the real run directory
const { jaroWinkler, median, quantile, spend, budget, CAPS } = await import('./lib.mjs');
const { buildFailureClass, FAILURE_CLASSES } = await import('./datasets.mjs');
const { QUESTIONS, requestFor, modelRequestFor } = await import('./questions.mjs');
const { RULES } = await import('./rules.mjs');
const { JudgmentPort } = await import('../../src/ports.mjs');
const { toSystemOneQuestion } = await import('../../src/judgment.mjs');
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('string similarity and order statistics', () => {
  assert.equal(jaroWinkler('martha', 'martha'), 1);
  assert.ok(Math.abs(jaroWinkler('martha', 'marhta') - 0.961) < 0.001);
  assert.equal(jaroWinkler('', 'x'), 0);
  assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
});

test('the budget refuses to exceed its cap', () => {
  spend('hosted', CAPS.hosted - 1, 'test');
  spend('hosted', 1, 'test');
  assert.throws(() => spend('hosted', 1, 'test'), /exceed cap/);
  assert.equal(budget().hosted, CAPS.hosted);
});

test('generated failure-class items are balanced, split by seed parity and labelled with an offered option', () => {
  const items = buildFailureClass();
  const generated = items.filter(i => !i.meta.real);
  assert.equal(generated.length, 200);
  for (const c of FAILURE_CLASSES) {
    assert.equal(generated.filter(i => i.truth === c && i.half === 'calibration').length, 20);
    assert.equal(generated.filter(i => i.truth === c && i.half === 'evaluation').length, 20);
  }
  for (const i of items) { assert.ok(i.options.includes(i.truth)); assert.equal(i.half, i.seed % 2 ? 'calibration' : 'evaluation'); }
  assert.deepEqual(buildFailureClass(), items, 'deterministic');
});

test('every dataset has two wordings that render to valid System One and judgment requests', () => {
  const item = { dataset: 'applicability', options: ['yes', 'no'], state: { source_note: 'x' }, slots: { system: 'ATLAS', assumed: 'day/month/year' } };
  const r = requestFor(item, 'A');
  assert.match(r.question, /ATLAS writes numeric birth dates as day\/month\/year/);
  const q = toSystemOneQuestion(r);
  assert.equal(q.type, 'choice'); assert.deepEqual(Object.keys(q.criteria), ['yes', 'no']);
  for (const [name, spec] of Object.entries(QUESTIONS)) for (const w of ['A', 'B']) assert.ok(spec[w].question, `${name} ${w}`);
  const m = modelRequestFor({ dataset: 'injection', options: ['yes', 'no'], state: { text: 't' } }, 'A');
  assert.match(m.criteria.at(-1), /^Options: yes = /);
});

test('rule baselines score exactly the offered options through the rule engine', async () => {
  const port = new JudgmentPort({ engine: 'rule', rule: RULES['failure-class'] });
  const item = buildFailureClass()[0];
  const req = requestFor(item, 'A');
  const res = await port.judge({ port: req.port, question: req.question, criteria: req.criteria, options: req.options, state: req.state });
  assert.ok(FAILURE_CLASSES.includes(res.chosen));
  assert.ok(Math.abs(Object.values(res.probabilities).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  const pair = await new JudgmentPort({ engine: 'rule', rule: RULES['records-pair'] }).judge({ port: 'p', question: 'q', options: ['yes', 'no'],
    state: { row_a: 'LEDGR;1890;Dreßler, Klaus;Herr Dr.;6.10.1972;Irland;+41 44 589 17 34;537,11- EUR;aktiv;07.01.2025', row_b: 'Vendex 1318 — Klaus Dressler — Neuchâtel — DOB 10/6/1972 — reach at 0041 44 589 17 34 — balance due fifty dollars — last revised November 25, 2016.', conventions: '' } });
  assert.equal(pair.chosen, 'yes');
});
