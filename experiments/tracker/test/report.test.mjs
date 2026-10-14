// report.md: refused tick outputs make `untested` rows untrustworthy, and the report says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../report.mjs';

const ledger = { source: { file: 'x.md', sha256: 'a' }, build: { file: 's.mjs', sha256: 'b' }, extractor: { model: 'm', prompt: 'p' },
  requirements: [{ id: 'Q-001', quote: 'Reserve every item within 120 min.', kind: 'deadline', status: 'untested', confirmed: false, evidence: { worlds: { 1: { triggered: 0 } }, flags: [], failing: [] } }] };

test('a build with refused tick outputs gets a warning that its untested rows are not evidence', () => {
  const md = renderReport({ ledger, health: [{ world: 1, difficulty: 2, status: 'complete', ticks: 10, effects: 5, refused: 7, firstRefusal: 'a batch op keys its items, not the batch' }], worlds: ['1'] });
  assert.match(md, /\*\*Warning:\*\* the platform refused 7 tick outputs/);
  assert.match(md, /untested/);
  const clean = renderReport({ ledger, health: [{ world: 1, difficulty: 2, status: 'complete', ticks: 10, effects: 5, refused: 0, firstRefusal: null }], worlds: ['1'] });
  assert.doesNotMatch(clean, /Warning/);
});
