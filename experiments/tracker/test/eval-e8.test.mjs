// The analyst-side scorer (eval-e8.mjs) scores against the frozen SPEC-E only (FIXES Action 3, register E1): the text is
// the committed copy of git 48535bb, its sha256 must be the frozen gold's (and git show 48535bb must give the same bytes
// where the clone has that object), and a moved text, a ledger from another text, or a gold or ledger with no source hash
// is refused instead of crashing or scoring against shifted spans. Also the $0 coverage-list baseline for gleaning (review
// M1) and the sentence-level guard yield (review m10). $0, no model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FROZEN_SPEC_E, GOLD_FILE, frozenSpecE, frozenSpecEGitCheck, scoreExtraction, linesCoverage, coverageListBaseline } from '../eval-e8.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DIR = path.join(ROOT, 'research/need-router-20261014/tracker-e8');
const json = f => JSON.parse(readFileSync(f, 'utf8'));
const sha256 = s => createHash('sha256').update(s).digest('hex');
const GOLD = json(path.join(ROOT, GOLD_FILE));
const S0 = json(path.join(DIR, 'extraction/haiku.s0.json'));
const P = json(path.join(DIR, 'glean/s0.g0.json'));   // run P: s0 gleaned by Haiku (REPORT §10)
const EVAL = path.join(ROOT, 'experiments/tracker/eval-e8.mjs');

test('the frozen SPEC-E hashes to the gold\'s sha256 (fails if either moves)', () => {
  const text = frozenSpecE();
  assert.equal(sha256(text), GOLD.source.sha256, 'the committed copy of 48535bb:beds/ebed/e8/spec/SPEC-E.md is the text gold.json was written against');
  assert.equal(sha256(readFileSync(path.join(ROOT, FROZEN_SPEC_E.copy))), GOLD.source.sha256, 'byte for byte (no line-ending conversion)');
  assert.equal(FROZEN_SPEC_E.sha256, GOLD.source.sha256);
  assert.equal(json(path.join(DIR, 'freeze.json')).specE, GOLD.source.sha256, 'the tracker-e8 freeze recorded the same text');
  assert.equal(GOLD.source.file, FROZEN_SPEC_E.file);
  assert.equal(S0.source.sha256, GOLD.source.sha256, 'the primary sample was extracted from the frozen text');
  assert.throws(() => frozenSpecE({ ...FROZEN_SPEC_E, sha256: '0'.repeat(64) }), /not the frozen/);
  assert.throws(() => frozenSpecE({ ...FROZEN_SPEC_E, copy: 'research/need-router-20261014/tracker-e8/no-such-copy.md' }), /no research/);
});

test('where the clone has git 48535bb, git show gives the committed copy byte for byte (a shallow clone skips, visibly)', t => {
  const g = frozenSpecEGitCheck();
  if (!g.checked) { t.skip(g.why); return; }
  assert.equal(g.sha256, GOLD.source.sha256);
  assert.throws(() => frozenSpecEGitCheck({ ...FROZEN_SPEC_E, sha256: '0'.repeat(64) }), /not the frozen/);
  assert.deepEqual(frozenSpecEGitCheck({ ...FROZEN_SPEC_E, rev: '0'.repeat(40) }).checked, false, 'a missing object reports checked: false, never a pass');
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
  // no hash, no score: a ledger or gold without a source sha256 could refer to any text (review m2)
  const { sha256: _l, ...noLedgerHash } = S0.source;
  assert.throws(() => scoreExtraction({ ...S0, source: noLedgerHash }, GOLD, frozen), /ledger carries no source sha256/);
  assert.throws(() => scoreExtraction({ ...S0, source: undefined }, GOLD, frozen), /ledger carries no source sha256/);
  const { sha256: _g, ...noGoldHash } = GOLD.source;
  assert.throws(() => scoreExtraction(S0, { ...GOLD, source: noGoldHash }, frozen), /gold carries no source sha256/);
});

test('the $0 coverage-list baseline: every uncovered sentence becomes an entry by pointer, no model call (review M1)', async () => {
  const text = frozenSpecE();
  const b = await coverageListBaseline(S0, text, { at: '2026-10-21T00:00:00.000Z' });
  const g = b.gleaning.at(-1);
  assert.deepEqual([g.sent, g.answered, g.added, g.none, g.unanswered, g.invalid, g.costUsd, g.model, g.prompt, g.baseline],
    [37, 37, 37, 0, 0, [], 0, null, null, 'all-uncovered']);
  assert.equal(b.log.at(-1).by, 'baseline');
  assert.deepEqual(b.uncovered, [], 'nothing is left on the coverage list');
  // the old entries are untouched; each new entry quotes one coverage-list sentence, verbatim
  assert.deepEqual(b.requirements.filter(r => !r.gleaned), S0.requirements);
  const added = b.requirements.filter(r => r.gleaned);
  assert.deepEqual(added.map(r => [r.span.line, r.quote]).sort(), S0.uncovered.map(u => [u.line, u.text]).sort());
  assert.ok(added.every(r => r.kind === 'must' && r.summary === ''), 'the baseline judges nothing: placeholder kind, no summary');
  // It reaches Haiku gleaning's recall on s0 (run P): 28/30 ids, go-live 3/3, and more U and as many clauses.
  const [sb, sp] = [scoreExtraction(b, GOLD, text), scoreExtraction(P, GOLD, text)];
  assert.deepEqual([sb.idsCovered, Math.round(sb.uRecall * 15), Math.round(sb.clauseCoverage * 76), sb.goLive.normative.covered, sb.nonNormative.length], [28, 14, 65, 3, 2]);
  assert.deepEqual([sp.idsCovered, Math.round(sp.uRecall * 15), Math.round(sp.clauseCoverage * 76), sp.goLive.normative.covered, sp.nonNormative.length], [28, 13, 65, 3, 1]);
  assert.deepEqual(sb.idsMissed, sp.idsMissed);
  // Haiku's entries are a subset of the baseline's: its call only filters the list (22 of 37 kept on P)
  const quotes = new Set(added.map(r => r.quote));
  assert.ok(P.requirements.filter(r => r.gleaned).every(r => quotes.has(r.quote)));
  assert.equal(P.requirements.filter(r => r.gleaned).length, 22);
});

test('guard yield: line-level as in PREREG §a, and by offsets inside an uncovered sentence (review m10)', () => {
  const text = frozenSpecE();
  const s0 = scoreExtraction(S0, GOLD, text);
  assert.equal(s0.uncoveredUnlocated, 0, 'every coverage-list sentence locates in the frozen text');
  assert.deepEqual([s0.guardYield, s0.guardYieldSentence], [10 / 20, 9 / 20]);
  // R6.2a's anchor (line 208) only shares a line with the uncovered sentence on 207-208; it is not inside it
  assert.deepEqual(s0.guardCaught.filter(id => !s0.guardCaughtSentence.includes(id)), ['R6.2a']);
  assert.ok(s0.guardCaughtSentence.every(id => s0.guardCaught.includes(id)));
  const p = scoreExtraction(P, GOLD, text);
  assert.deepEqual([p.clausesMissed.length, p.guardCaught, p.guardCaughtSentence, p.guardYieldSentence], [11, ['R6.2a'], [], 0]);
  assert.equal(p.guardYield, 1 / 11, 'the 0.09 reported for P in §10 is that line-level artifact');
});

test('eval-e8 baseline CLI: writes a new ledger, never over its input or a path git tracks', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tracker-baseline-'));
  try {
    const input = path.join(DIR, 'extraction/haiku.s0.json');
    const before = readFileSync(input);
    const run = (...args) => spawnSync(process.execPath, [EVAL, 'baseline', ...args], { cwd: ROOT, encoding: 'utf8' });
    const out = path.join(dir, 's0.baseline.json');
    const ok = run('--ledger', input, '--out', out);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /37 coverage-list sentences became entries \(78 -> 115\), \$0/);
    assert.equal(scoreExtraction(json(out), GOLD, frozenSpecE()).idsCovered, 28);
    const inPlace = run('--ledger', input, '--out', input);
    assert.notEqual(inPlace.status, 0);
    assert.match(inPlace.stderr, /over its input ledger/);
    const tracked = run('--ledger', out, '--out', path.join(DIR, 'extraction/haiku.s1.json'));
    assert.notEqual(tracked.status, 0);
    assert.match(tracked.stderr, /git tracks it/);
    assert.ok(readFileSync(input).equals(before), 'the committed extraction is unchanged');
    assert.equal(run('--ledger', input).status, 2, 'no --out: usage');
    assert.ok(!existsSync(path.join(DIR, 'extraction/haiku.s0.baseline.json')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
