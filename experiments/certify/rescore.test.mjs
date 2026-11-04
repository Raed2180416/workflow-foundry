// Tests for experiments/certify/rescore.mjs (Move 0 re-scores). Each has teeth: the defect the re-score exists to remove
// (span scoring that lets a sibling sentence cover a statement, a heal verdict that trusts the arm's own gate, a dev60
// reader that would open a task outside the draw, a library that names benchmark tasks) is run and must be caught.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ROOT, e8Units, e8GoldUnits, e8Selected, e8SiblingCheck, e8UnitScore, fh1Evidence, mergeRows, m1Cells, RUN_ID_OK, rescoreE8,
} from './rescore.mjs';
import { certifyHeal } from '../lib/certify.mjs';

const TEXT = [
  '# Spec', '',
  '## 3. Platform', '',
  'Every order gets an instance. Continue each from where it stands, under the same rules.', '',
  '## 4. Rules', '',
  '- Within 60 min, record the order.',
  '- Never send a notice twice.', '',
  '## 5. Readings', '',
  'Text with no cue at all.', '',
].join('\n');
const GOLD = {
  clauses: [{ id: 'R1a', anchor: 'record the order' }, { id: 'R2a', anchor: 'Never send a notice twice' }],
  u: { U1: { span: [5, 5], anchor: 'Continue each from where it stands, under the same rules.' } },
};
const ledger = quotes => ({ requirements: quotes.map((q, i) => ({ id: `Q${i}`, quote: q, span: { line: 5, lineEnd: 5 } })) });

test('e8: a statement covered only by a sibling sentence counts by span and not by unit (teeth: the span scorer)', () => {
  const { ix, units } = e8Units(TEXT);
  assert.ok(units.length >= 4);
  const sib = e8SiblingCheck(ledger(['Every order gets an instance.']), ix, units, GOLD);
  assert.deepEqual(sib.bySpan, ['U1'], 'the span scorer counts the sibling quote');
  assert.deepEqual(sib.byUnit, [], 'the unit scorer does not');
  assert.deepEqual(sib.siblingOnly, ['U1']);
  const hit = e8SiblingCheck(ledger(['Continue each from where it stands']), ix, units, GOLD);
  assert.deepEqual(hit.byUnit, ['U1']); assert.deepEqual(hit.siblingOnly, []);
});

test('e8: gold units, selection by overlap, exact recall interval and the random-selection null', () => {
  const { ix, units } = e8Units(TEXT);
  const { byUnit, unlocated } = e8GoldUnits(ix, units, GOLD);
  assert.deepEqual(unlocated, []); assert.equal(byUnit.size, 3);
  const goldSet = new Set(byUnit.keys());
  const sel = e8Selected(ledger(['record the order', 'Never send a notice twice', 'no such text anywhere']), ix, units);
  assert.equal(sel.size, 2);
  const s = e8UnitScore(sel, goldSet, units.length);
  assert.equal(s.hits, 2); assert.equal(s.gold, 3); assert.equal(s.precision, 1);
  assert.ok(s.recall.lo < 2 / 3 && s.recall.hi > 2 / 3);
  // selecting every unit is no better than chance; selecting exactly the gold is
  assert.equal(e8UnitScore(new Set(units.map(u => u.i)), goldSet, units.length).randomSelectionP, 1);
  assert.ok(e8UnitScore(goldSet, goldSet, units.length).randomSelectionP < 0.5);
});

test('e8 on the stored ledgers: U11 is covered by a sibling sentence in haiku.s0; the $0 baselines are scored beside the models', () => {
  const r = rescoreE8();
  assert.equal(r.text.sha256, 'c013c04c80636682f46fd9bdbc2bf436712ed53233b03a06ba74bd88824f8cf1');
  assert.deepEqual(r.designs['haiku.s0'].spanMetrics.uSiblingOnly, ['U11']);
  for (const k of ['cue regex (coverage guard CUES)', 'zone prior ∪ cue regex', 'coverage-list.s0']) assert.ok(r.designs[k], k);
  // the $0 coverage-list baseline is never below the paid gleaning pass it is the baseline for
  assert.ok(r.designs['coverage-list.s0'].hits >= r.designs['glean.s0.g0'].hits);
});

// ------------------------------------------------------------------------------------------------ heal (FH-1 mapping)
const base = (fails = { a: 6, b: 4 }) => ({
  retry: { identicalJournals: true },
  practice: { worlds: [{}, {}, {}] },
  grading: { worlds: [{ cases: [...Object.entries(fails).flatMap(([k, n]) => Array.from({ length: n }, () => ({ class: k, oracle: false }))), { class: 'ok', oracle: true }] }] },
});
const rec = ({ fixedPractice, kept, gate = true }) => ({
  practice: { before: { oracleN: 20, oraclePassed: 15 }, after: { oracleN: 20, oraclePassed: 15 + fixedPractice } },
  grading: { before: { oraclePassed: 90 }, kept: { nRecovered: Object.values(kept).reduce((s, x) => s + x, 0), nRegressed: 0, recoveredByClass: kept } },
  gate: { accept: gate },
});

test('heal: FH-1 attempts map to deterministic evidence; a partial fix is not a heal even when the arm\'s own gate accepts (teeth)', () => {
  const full = fh1Evidence(rec({ fixedPractice: 5, kept: { a: 6, b: 4 } }), base());
  assert.deepEqual(full.determinism, { replays: 4, identical: 4 });
  assert.deepEqual(full.failing, { n: 5, fixed: 5 });
  assert.equal(certifyHeal(full).verdict, 'accept');
  const partialRec = rec({ fixedPractice: 5, kept: { a: 6 } });
  assert.equal(partialRec.gate.accept, true, 'the arm\'s gate accepted it');
  assert.equal(certifyHeal(fh1Evidence(partialRec, base())).label, 'partial-fix');
  // an arm with no correctness signal that changed nothing: its gate says accept, the evidence counts only what the
  // oracle shows fixed, and the certificate rejects
  const idle = fh1Evidence(rec({ fixedPractice: 0, kept: {} }), base());
  assert.deepEqual(idle.failing, { n: 5, fixed: 0 });
  assert.equal(certifyHeal(idle).verdict, 'reject');
  // a base that is not deterministic cannot use the deterministic mode at all
  const flaky = { ...base(), retry: { identicalJournals: false } };
  assert.equal(certifyHeal(fh1Evidence(rec({ fixedPractice: 5, kept: { a: 6, b: 4 } }), flaky)).label, 'not-deterministic');
});

// ------------------------------------------------------------------------------------------------ dev60 and need
test('dev60: the reader refuses run ids and tasks outside the dev60 draw (teeth: a look-2 or devCheck name)', () => {
  for (const id of ['a0-dev60-dn', 'm3-a1c-dev60-dn-fill']) assert.ok(RUN_ID_OK(id), id);
  for (const id of ['a0o-look2-1', 'a0-devcheck-1', 'a1c-dev60-test', 'sealed-dev60']) assert.equal(RUN_ID_OK(id), false, id);
  const dev60 = new Set(['d.one', 'd.two']);
  const by = mergeRows([[{ task: 'd.one', final: { task_completed_correctly: 0 } }, { task: 'd.two', final: { task_completed_correctly: 0 } }],
    [{ task: 'd.one', final: { task_completed_correctly: 1 } }]], dev60);
  assert.equal(by.get('d.one').final.task_completed_correctly, 1, 'the fill row replaces the main row');
  assert.throws(() => mergeRows([[{ task: 'x.not_in_draw' }]], dev60), /not in the dev60 selection/);
});

test('need: M1 cells pool a task\'s arms (one call suffices if any one-call arm passed)', () => {
  const rows = [
    { taskKey: 'fam:dev:d3:s1', pass: true }, { taskKey: 'fam:dev:d3:s1', pass: false },
    { taskKey: 'fam:dev:d3:s2', pass: false }, { taskKey: 'fam:dev:d5:s3', pass: true },
  ];
  assert.deepEqual(m1Cells(rows), [{ cell: 'fam@d3', n: 2, pass: 1 }, { cell: 'fam@d5', n: 1, pass: 1 }]);
});

test('hygiene: the certification library and the re-score code name no benchmark task and no ceiling stratum (teeth)', () => {
  const strata = JSON.parse(readFileSync(path.join(ROOT, 'research/blockers-20261021/move0/dev60-ceiling-strata.json'), 'utf8'));
  const names = [...strata.hard, ...strata.soft];
  const files = ['experiments/lib/certify.mjs', 'experiments/lib/gauntlet.mjs', 'experiments/certify/rescore.mjs'];
  const leak = (src, list) => list.filter(n => src.includes(n) || src.includes(n.split('.')[1]));
  for (const f of files) {
    const src = readFileSync(path.join(ROOT, f), 'utf8');
    assert.deepEqual(leak(src, names), [], f);
    // no path to a look-2/look-3 task list, a look-2 run or a sealed bed
    assert.doesNotMatch(src, /LOOK[23]-TASKS|-look[23]-\d|beds\/sealed/i, f);
  }
  // teeth: the scan finds a name when one is present
  assert.deepEqual(leak(`const t = '${names[0]}';`, names), [names[0]]);
});
