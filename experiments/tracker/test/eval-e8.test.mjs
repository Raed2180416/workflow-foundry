// The analyst-side scorer (eval-e8.mjs) scores against the frozen SPEC-E only (FIXES Action 3, register E1): the text is
// read from git 48535bb, its sha256 must be the frozen gold's, and a moved text or a ledger from another text is refused
// instead of crashing or scoring against shifted spans. $0, no model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FROZEN_SPEC_E, GOLD_FILE, frozenSpecE, scoreExtraction, linesCoverage } from '../eval-e8.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DIR = path.join(ROOT, 'research/need-router-20261014/tracker-e8');
const json = f => JSON.parse(readFileSync(f, 'utf8'));
const sha256 = s => createHash('sha256').update(s).digest('hex');
const GOLD = json(path.join(ROOT, GOLD_FILE));
const S0 = json(path.join(DIR, 'extraction/haiku.s0.json'));

test('the frozen SPEC-E hashes to the gold\'s sha256 (fails if either moves)', () => {
  const text = frozenSpecE();
  assert.equal(sha256(text), GOLD.source.sha256, 'git show 48535bb:beds/ebed/e8/spec/SPEC-E.md is the text gold.json was written against');
  assert.equal(FROZEN_SPEC_E.sha256, GOLD.source.sha256);
  assert.equal(json(path.join(DIR, 'freeze.json')).specE, GOLD.source.sha256, 'the tracker-e8 freeze recorded the same text');
  assert.equal(GOLD.source.file, FROZEN_SPEC_E.file);
  assert.equal(S0.source.sha256, GOLD.source.sha256, 'the primary sample was extracted from the frozen text');
  assert.throws(() => frozenSpecE({ ...FROZEN_SPEC_E, sha256: '0'.repeat(64) }), /not the frozen/);
});

test('scoring the primary sample (Haiku s0) on the frozen text reproduces the REPORT §2 row', () => {
  const s = scoreExtraction(S0, GOLD, frozenSpecE());
  assert.deepEqual([s.entries, s.returned, s.dropped, s.idsCovered, s.uncovered], [78, 79, 1, 23, 37]);
  assert.equal(s.idRecall, 23 / 30);
  assert.deepEqual(s.idsMissed, ['R3.1', 'S1', 'S2', 'S3', 'S4', 'S9', 'S7']);
  assert.equal(s.uRecall, 0.8);
  assert.equal(s.clauseCoverage, 56 / 76);
  assert.equal(s.guardYield, 0.5);
  assert.deepEqual([s.gleaned, s.gleanCostUsd], [0, null]);
  // Go-live (§3.5, lines 91–93): only the last of its three normative sentences is quoted by s0.
  assert.deepEqual([s.goLive.normative, s.goLive.all], [{ sentences: 3, covered: 1 }, { sentences: 4, covered: 1 }]);
  const rows = linesCoverage(S0, frozenSpecE()).rows;
  assert.deepEqual(rows.map(r => [r.line, r.normative, r.by]), [[91, false, []], [91, true, []], [92, true, []], [93, true, ['Q-011']]]);
});

test('scoring refuses a text that is not the gold\'s, and a ledger extracted from another text', () => {
  const frozen = frozenSpecE();
  assert.throws(() => scoreExtraction(S0, GOLD, `${frozen}\n`), /not the one the gold was written against/);
  const working = readFileSync(path.join(ROOT, FROZEN_SPEC_E.file), 'utf8');
  if (sha256(working) !== GOLD.source.sha256) assert.throws(() => scoreExtraction(S0, GOLD, working), /frozenSpecE/, 'the moved working-tree SPEC-E is refused, not crashed on');
  const other = { ...S0, source: { ...S0.source, sha256: 'f'.repeat(64) } };
  assert.throws(() => scoreExtraction(other, GOLD, frozen), /extracted from another text/);
});
