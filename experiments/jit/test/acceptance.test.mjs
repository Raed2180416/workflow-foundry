// acceptance.mjs: the default 'named' rule (unchanged) and the opt-in 'strict' rule (JIT v2.1). No model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeAcceptance, explainCase, noteBlocks, quotesIn, quoteOccurs, taskTexts, caseTasks, namedUnexplained, acceptanceModeOf, minPartialOf, MIN_QUOTE_CHARS } from '../acceptance.mjs';

const TASK0 = { prompt: 'Fit each substrate.\nReport   Vmax in µmol/min and Km in mM.\nIgnore runs flagged as "bad baseline".', inputs: { runs: [{ id: 'r1', note: 'Replicate 3 was diluted twofold before reading.' }] } };
const TASK1 = { prompt: 'Merge duplicate customers. Two records are the same person when the names differ by one typo and the phone matches.', inputs: {}, files: { 'notes.txt': 'Phones are compared on digits only.' } };
const REG0 = { prompt: 'A regression task: totals are rounded to cents.', inputs: { x: 1 } };
const tasks = caseTasks([{ task: TASK0 }, { task: TASK1 }], [{ task: REG0 }]);
const summary = (cases, extra = {}) => ({ clean: true, perCase: cases.map(([id, status, partial]) => ({ id, kind: id.startsWith('case-') ? 'regression' : 'trace', status, partial })), ...extra });

test('the default rule is the pre-v2.1 rule: clean and every diff case named (no detail object)', () => {
  const s = summary([['trace-0', 'diff', 0.5], ['trace-1', 'exact', 1], ['trace-10', 'diff', 0.2]]);
  assert.deepEqual(judgeAcceptance({ summary: s, notes: 'trace-0: the agent rounded early.' }), { unexplained: ['trace-10'], accepted: false });
  assert.deepEqual(judgeAcceptance({ summary: s, notes: 'trace-0 and trace-10 differ.' }), { unexplained: [], accepted: true }, 'partial 0.5 passes: the rule D4 criticised');
  assert.deepEqual(judgeAcceptance({ summary: { ...s, clean: false }, notes: 'trace-0 trace-10' }), { unexplained: [], accepted: false });
  assert.deepEqual(namedUnexplained(s.perCase, 'trace-1'), ['trace-0', 'trace-10'], '\\btrace-1\\b does not name trace-10');
  assert.deepEqual(judgeAcceptance({ summary: null, notes: null }), { unexplained: [], accepted: false });
  assert.equal(acceptanceModeOf(undefined), 'named'); assert.throws(() => acceptanceModeOf('lenient'), /acceptance must be one of named, strict/);
  assert.equal(minPartialOf(undefined), 0.9); assert.throws(() => minPartialOf(1.5), /minPartial must be a number in \[0, 1\]/);
});

test('strict: a quote must occur verbatim (whitespace-normalised) in that case\'s own prompt or inputs', () => {
  const s = summary([['trace-0', 'diff', 0.95], ['trace-1', 'exact', 1]]);
  const strict = notes => judgeAcceptance({ summary: s, notes, mode: 'strict', tasks });
  const ok = strict('- trace-0, vmax units: the prompt says "Report Vmax in µmol/min and Km in mM." so the agent\'s nmol/min is wrong.');
  assert.equal(ok.accepted, true); assert.deepEqual(ok.acceptance.passed, ['clean', 'agreement', 'explained']); assert.deepEqual(ok.acceptance.failed, []);
  assert.equal(ok.acceptance.criteria.explained.cases[0].verified, 'Report Vmax in µmol/min and Km in mM.', 'the triple space in the prompt is normalised');
  // A paraphrase, a quote from another case's task, a named case without a quote, and an unnamed case all fail.
  const para = strict('- trace-0: the prompt says "report Vmax in micromol per minute".');
  assert.equal(para.accepted, false); assert.deepEqual(para.unexplained, ['trace-0']); assert.deepEqual(para.acceptance.failed, ['explained']);
  assert.equal(para.acceptance.criteria.explained.cases[0].reason, 'no quote occurs verbatim in this case\'s prompt or inputs');
  const other = strict('- trace-0: "Two records are the same person when the names differ by one typo"');
  assert.equal(other.accepted, false, 'a sentence from trace-1\'s task does not explain trace-0');
  assert.equal(strict('- trace-0: the units in the prompt decide it.').acceptance.criteria.explained.cases[0].reason, 'named, but nothing quoted');
  assert.equal(strict('Units: "Report Vmax in µmol/min and Km in mM."').acceptance.criteria.explained.cases[0].reason, 'not named in BUILD-NOTES.md');
  // The quote must sit in the note that names the case, not in another case's note.
  assert.equal(strict('- trace-1: "Report Vmax in µmol/min and Km in mM."\n- trace-0: see above.').accepted, false);
  // Inputs (string leaves and the inputs.json text) and task files count; a too-short quote does not.
  assert.equal(strict('- trace-0: "Replicate 3 was diluted twofold" (inputs.runs[0].note)').accepted, true);
  assert.equal(strict('- trace-0: "Fit each"').accepted, false, `quotes under ${MIN_QUOTE_CHARS} characters are ignored`);
  assert.equal(strict('- trace-0: “Ignore runs flagged as "bad baseline".”').accepted, true, 'curly quotes around a sentence with straight quotes inside');
  assert.equal(strict('- trace-0:\n  > Report Vmax in µmol/min\n  > and Km in mM.').accepted, true, 'a blockquote across lines');
  assert.equal(strict('- trace-0: "...Report Vmax in µmol/min and Km in mM..."').accepted, true, 'edge ellipses and a final period are forgiven');
  assert.equal(strict('- trace-0: "Report Vmax ... Km in mM."').accepted, false, 'an inner elision is not verbatim');
  assert.equal(strict('- TRACE-0: "Report Vmax in µmol/min and Km in mM."').accepted, false, 'the case id is matched as written by check-traces');
});

test('strict: agreement needs mean trace partial >= minPartial or one exact trace; regressions do not count toward it', () => {
  const notes = '## trace-0\nThe prompt: "Report Vmax in µmol/min and Km in mM."\n\n## trace-1\n"Phones are compared on digits only."\n\n## case-0\n"totals are rounded to cents"';
  const v = (cases, opts = {}) => judgeAcceptance({ summary: summary(cases), notes, mode: 'strict', tasks, ...opts });
  const low = v([['trace-0', 'diff', 0.546], ['trace-1', 'diff', 0.6]]);
  assert.equal(low.accepted, false); assert.deepEqual(low.acceptance.failed, ['agreement']);
  assert.deepEqual(low.acceptance.criteria.agreement, { ok: false, partial: 0.573, minPartial: 0.9, partialOk: false, exactTraces: 0, labelledTraces: 2, exactOk: false });
  assert.equal(low.acceptance.criteria.explained.ok, true, 'headings name the case for the paragraph under them; task files count');
  const high = v([['trace-0', 'diff', 0.95], ['trace-1', 'diff', 0.9]]);
  assert.equal(high.accepted, true); assert.equal(high.acceptance.criteria.agreement.partialOk, true, 'the threshold is inclusive');
  const oneExact = v([['trace-0', 'diff', 0.2], ['trace-1', 'exact', 1]]);
  assert.equal(oneExact.accepted, true); assert.equal(oneExact.acceptance.criteria.agreement.exactOk, true); assert.equal(oneExact.acceptance.criteria.agreement.partialOk, false);
  const regOnly = v([['case-0', 'exact', 1], ['trace-0', 'diff', 0.2], ['trace-1', 'diff', 0.3]]);
  assert.equal(regOnly.accepted, false, 'a passing regression case is not an exact trace');
  assert.equal(v([['trace-0', 'diff', 0.85]], { minPartial: 0.8 }).accepted, true);
  assert.equal(v([['trace-0', 'diff', 0.85]], { minPartial: 0.8 }).acceptance.criteria.agreement.minPartial, 0.8);
  const unclean = judgeAcceptance({ summary: summary([['trace-0', 'exact', 1]], { clean: false }), notes, mode: 'strict', tasks });
  assert.equal(unclean.accepted, false); assert.deepEqual(unclean.acceptance.failed, ['clean']);
  const none = judgeAcceptance({ summary: { clean: true, perCase: [{ id: 'trace-0', kind: 'trace', status: 'unlabeled' }] }, notes: '', mode: 'strict', tasks });
  assert.equal(none.accepted, false); assert.equal(none.acceptance.criteria.agreement.partial, null, 'no labelled trace: no agreement');
  assert.equal(judgeAcceptance({ summary: { ...summary([['trace-0', 'exact', 1]]), compare: { mode: 'tolerant' } }, notes: '', mode: 'strict', tasks }).acceptance.compare, 'tolerant');
});

test('note blocks: list items (with sub-items), headings with their paragraph, table rows, blockquotes after a line', () => {
  const md = '# Build notes\nProcedure in code.\n\n- trace-0: units\n  - quote: "x"\n- trace-1: "y"\n| trace-2 | "z" |\n| trace-3 | "w" |\nPlain line.\n\n> a quoted line\n';
  const b = noteBlocks(md);
  assert.deepEqual(b, ['# Build notes\nProcedure in code.', '- trace-0: units\n  - quote: "x"', '- trace-1: "y"', '| trace-2 | "z" |', '| trace-3 | "w" |', 'Plain line.\n> a quoted line'],
    'a table row is a block of its own; the blockquote after a blank line joins the block before it');
  assert.deepEqual(quotesIn('a "one two" b “three” «four»\n> five\n> six'), ['one two', 'three', 'four', 'five six']);
  assert.ok(taskTexts(TASK1).includes('Phones are compared on digits only.'));
  assert.equal(quoteOccurs('Phones are compared', taskTexts(TASK1)), true); assert.equal(quoteOccurs('phones are compared', taskTexts(TASK1)), false);
  assert.deepEqual(explainCase('trace-9', '- trace-9: "anything at all here"', null), { id: 'trace-9', mentioned: true, quotes: ['anything at all here'], verified: null, ok: false, reason: 'no task text for this case' });
});
