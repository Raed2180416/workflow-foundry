// The token counter's calibration (tokens.mjs header): measured Haiku 5.5 input-token counts of 1,243 calls. $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countTokens, estimateTokens, countFromFeatures, featuresOf, SAFETY } from '../tokens.mjs';

const cal = JSON.parse(readFileSync(new URL('../fixtures/token-calibration.json', import.meta.url), 'utf8'));
const intercepts = Object.values(cal.fit.intercepts);
const content = row => row[6] - intercepts[row[0]];   // measured tokens minus the CLI's own fitted overhead
const feats = row => ({ lRuns: row[1], lChars: row[2], dChars: row[3], punct: row[4] });
const ratios = f => cal.rows.map(r => f(r) / content(r)).sort((a, b) => a - b);

test('calibration: the counter is a conservative bound on measured Haiku 5.5 tokens (<= 1% of calls undercounted, median overcount < 25%)', () => {
  assert.ok(cal.rows.length >= 1200, `${cal.rows.length} calibration calls`);
  assert.deepEqual(cal.columns, ['ds', 'lRuns', 'lChars', 'dChars', 'punct', 'chars', 'tokens']);
  const r = ratios(row => countFromFeatures(feats(row)));
  const under = r.filter(x => x < 1).length;
  assert.ok(under / r.length <= 0.01, `${under} of ${r.length} undercounted`);
  assert.ok(r[0] > 0.95, `worst undercount ratio ${r[0]}`);
  const median = r[Math.floor(r.length / 2)];
  assert.ok(median >= 1.0 && median < 1.25, `median ratio ${median}`);
  assert.ok(Math.abs(cal.fit.rmse) < 30, `fit rmse ${cal.fit.rmse}`);
});

test('calibration: chars / 3.5 (LIBRARY-TESTS T1) is NOT conservative for Haiku 5.5 on this data (it undercounts almost every call)', () => {
  const r = ratios(row => Math.ceil(row[5] / 3.5));
  const under = r.filter(x => x < 1).length;
  assert.ok(under / r.length > 0.95, `chars/3.5 undercounts ${under} of ${r.length}`);
  assert.ok(r[Math.floor(r.length / 2)] < 0.8);
});

test('counter: deterministic, monotone in added text, zero for empty, point estimate below the bound', () => {
  assert.equal(countTokens(''), 0); assert.equal(countTokens(null), 0);
  const a = 'Classify each message as invoice, receipt or none-of-these.';
  assert.equal(countTokens(a), countTokens(a));
  assert.ok(countTokens(a + ' And quote it.') > countTokens(a));
  assert.ok(estimateTokens(a) <= countTokens(a));
  assert.equal(countTokens(a), Math.ceil(SAFETY * (featuresOf(a).lRuns + 0.22 * featuresOf(a).lChars + 0.9 * featuresOf(a).dChars + 0.65 * featuresOf(a).punct)));
  assert.deepEqual(featuresOf('ab 12 c,d'), { lRuns: 3, lChars: 4, dChars: 2, punct: 1 });
});
