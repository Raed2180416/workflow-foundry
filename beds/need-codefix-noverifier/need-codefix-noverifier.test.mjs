// need-codefix-noverifier: determinism, the absence of any visible verifier, pure subtraction from codefix, verdict equality with
// codefix, oracle health per difficulty, schema rejection, truth isolation and size, and the pinned inherited codefix defects in the
// bug-report transcripts (red-herring sentence, float/dict printing). Dev seeds 601-640 only. $0: no model calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as bed from './index.mjs';
import { classify, entryOf, fidelity, replBlocks } from './fidelity.mjs';
import * as codefix from '../codefix/index.mjs';
import { build } from '../codefix/build.mjs';
import { canonical, estimateTokens, sha256 } from '../lib/canonical.mjs';

const DIFFS = [1, 2, 3, 4, 5];
const seeds = (first, n) => Array.from({ length: n }, (_, i) => first + i);
const HEALTH_SEEDS = seeds(601, 20); // referenceSolve and every bad control, at every difficulty
const EQUALITY_SEEDS_D3 = seeds(601, 24); // verdict equality with codefix at d3 (>= 20 required)
const EQUALITY_SEEDS_OTHER = seeds(601, 3);

// Memoised generation (a pure function of its arguments); tests never mutate the returned tasks.
const taskCache = new Map();
const taskOf = (difficulty, seed, split = 'dev') => {
  const key = `${split}:${difficulty}:${seed}`;
  if (!taskCache.has(key)) taskCache.set(key, bed.generate({ seed, split, difficulty }));
  return taskCache.get(key);
};
const codefixCache = new Map();
const codefixTaskOf = (difficulty, seed, split = 'dev') => {
  const key = `${split}:${difficulty}:${seed}`;
  if (!codefixCache.has(key)) codefixCache.set(key, codefix.generate({ seed, split, difficulty }));
  return codefixCache.get(key);
};
// Verdicts of this bed's oracle on the reference and on every bad control, memoised per (difficulty, seed).
const verdictCache = new Map();
function verdictsOf(difficulty, seed) {
  const key = `${difficulty}:${seed}`;
  if (!verdictCache.has(key)) {
    const task = taskOf(difficulty, seed);
    const outputs = [['reference', bed.referenceSolve(task)], ...bed.badControls.map(c => [c.name, c.make(task)])];
    verdictCache.set(key, outputs.map(([name, output]) => ({ name, output, verdict: bed.oracle(task, output) })));
  }
  return verdictCache.get(key);
}

const publicText = task => [task.prompt, ...Object.values(task.inputs).map(String), ...Object.values(task.files)].join('\n\u0000\n');
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const tokens = t => estimateTokens(t.prompt) + estimateTokens(t.inputs);

// Line-level LCS diff: hunks of reference lines replaced/removed in the buggy module (as in the codefix tests).
function diffHunks(refLines, bugLines) {
  const n = refLines.length; const m = bugLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i][j] = refLines[i] === bugLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const hunks = []; let i = 0; let j = 0; let cur = null;
  while (i < n || j < m) {
    if (i < n && j < m && refLines[i] === bugLines[j]) { if (cur) { hunks.push(cur); cur = null; } i++; j++; continue; }
    cur ??= { refStart: i, refLines: [], bugLines: [] };
    if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) cur.bugLines.push(bugLines[j++]);
    else cur.refLines.push(refLines[i++]);
  }
  if (cur) hunks.push(cur);
  return hunks;
}

test('family metadata, role and portable output schema', () => {
  assert.deepEqual(Object.keys(bed.family), ['id', 'domain', 'version', 'kind', 'role', 'description']);
  assert.equal(bed.family.id, 'need-codefix-noverifier');
  assert.equal(bed.family.version, '1.0.0');
  assert.equal(bed.family.kind, 'oneshot');
  assert.equal(bed.family.role, 'need-anchor');
  assert.match(bed.family.domain, /routing anchor/);
  assert.match(bed.family.description, /HYPOTHESIS, not a fact/);
  const banned = ['pattern', 'oneOf', 'uniqueItems', '$ref', 'format'];
  const walk = s => { for (const [k, v] of Object.entries(s)) { assert.ok(!banned.includes(k), `schema uses ${k}`); if (v && typeof v === 'object') walk(v); } };
  walk(bed.outputSchema);
  assert.deepEqual(bed.outputSchema.required, ['patched_source']);
  assert.deepEqual(bed.outputSchema, codefix.outputSchema);
  assert.notEqual(bed.outputSchema, codefix.outputSchema, 'schema must be a copy, not the codefix object');
  assert.equal(typeof bed.referenceSolve, 'function');
  assert.ok(bed.badControls.length >= 3);
  for (const name of ['empty', 'shuffled-or-corrupted']) assert.ok(bed.badControls.some(c => c.name === name), `missing control ${name}`);
  assert.ok(bed.badControls.some(c => /near-miss|red-herring/.test(c.name)), 'needs a plausible-but-wrong near miss');
});

test('bound to codefix 1.1.0: a codefix bump changes this bed and needs a re-review', () => {
  // Task content, hidden suite and controls are codefix's. If this fails, codefix changed: re-run measure.mjs, re-check the
  // README tables and the caveats, bump this bed's VERSION (labels paired on the old instances are no longer paired).
  assert.equal(codefix.family.version, '1.1.0');
  assert.deepEqual({ ...bed.UPSTREAM }, { bed: 'codefix', version: '1.1.0' });
});

test('generate is byte-identical on repeat, the split salts the instance, arguments are validated', () => {
  for (const difficulty of DIFFS) for (const seed of [601, 602]) {
    const a = bed.generate({ seed, split: 'dev', difficulty });
    const b = bed.generate({ seed, split: 'dev', difficulty });
    assert.equal(JSON.stringify(a), JSON.stringify(b), `nondeterministic d${difficulty} s${seed}`);
    assert.equal(canonical(a), canonical(b));
    const t = bed.generate({ seed, split: 'test', difficulty });
    assert.notEqual(canonical(a.inputs), canonical(t.inputs), `split did not change d${difficulty} s${seed}`);
    assert.equal(t.id, `need-codefix-noverifier-test-d${difficulty}-s${seed}`);
  }
  assert.throws(() => bed.generate({ seed: 1, split: 'train', difficulty: 1 }), /split/);
  assert.throws(() => bed.generate({ seed: 1, split: 'dev', difficulty: 6 }), /difficulty/);
  assert.throws(() => bed.generate({ seed: 1, split: 'dev', difficulty: 0 }), /difficulty/);
  assert.throws(() => bed.generate({ seed: 1, split: 'dev', difficulty: '3' }), /difficulty/);
  assert.throws(() => bed.generate({ seed: 1.5, split: 'dev', difficulty: 3 }), /seed/);
  assert.throws(() => bed.generate({ seed: null, split: 'dev', difficulty: 3 }), /seed/);
  assert.throws(() => bed.generate(), /seed/);
  assert.throws(() => bed.oracle({ seed: 1, split: 'train', difficulty: 1 }, { patched_source: 'x' }), /split/);
  assert.throws(() => bed.referenceSolve({ seed: 1, split: 'dev', difficulty: 9 }), /difficulty/);
});

test('task shape: contract fields only, consistent inputs and files, no truth fields', () => {
  for (const difficulty of DIFFS) {
    const task = taskOf(difficulty, 607);
    assert.deepEqual(Object.keys(task), ['id', 'family', 'seed', 'split', 'difficulty', 'prompt', 'inputs', 'files', 'budget']);
    assert.equal(task.id, `need-codefix-noverifier-dev-d${difficulty}-s607`);
    assert.equal(task.family, 'need-codefix-noverifier');
    assert.deepEqual([task.seed, task.split, task.difficulty], [607, 'dev', difficulty]);
    assert.match(task.prompt, /patched_source/);
    for (const key of ['module_path', 'source', 'bug_report', 'design_notes']) assert.equal(typeof task.inputs[key], 'string', key);
    assert.equal(task.files[task.inputs.module_path], task.inputs.source);
    assert.equal(task.files['BUG_REPORT.md'], task.inputs.bug_report);
    assert.equal(task.files['docs/DESIGN.md'], task.inputs.design_notes);
    if (task.inputs.changelog) assert.equal(task.files['CHANGELOG.md'], task.inputs.changelog);
    if (task.inputs.service_log) assert.equal(task.files['logs/service.log'], task.inputs.service_log);
    const keys = JSON.stringify(Object.keys(task.inputs)) + JSON.stringify(Object.keys(task.files));
    assert.doesNotMatch(keys, /reference|hidden|truth|answer|solution/i);
    assert.ok(task.budget.suggestedOutputTokens > 0);
  }
});

test('no visible test file or test command remains (file names, inputs and prompt text)', () => {
  const testish = /(^|[/_.-])tests?([/_.-]|$)|^ci\/|conftest|last_run/i;
  const expectedFiles = d => ['BUG_REPORT.md', 'docs/DESIGN.md', ...(d >= 2 ? ['CHANGELOG.md', 'logs/service.log'] : [])];
  for (const difficulty of DIFFS) for (const seed of HEALTH_SEEDS) {
    const task = taskOf(difficulty, seed);
    const where = `d${difficulty} s${seed}`;
    // 1) File names: only the module, the report, the notes, and (d2+) the changelog and the service log.
    assert.deepEqual(Object.keys(task.files).sort(), [task.inputs.module_path, ...expectedFiles(difficulty)].sort(), `files ${where}`);
    for (const path of [...Object.keys(task.files), task.inputs.module_path]) assert.doesNotMatch(path, testish, `test/CI path ${path} (${where})`);
    // 2) Input keys: the tests path, the test source and the CI log are gone.
    for (const key of ['tests_path', 'visible_tests', 'ci_log']) assert.ok(!(key in task.inputs), `${key} present (${where})`);
    assert.deepEqual(Object.keys(task.inputs).sort(),
      ['bug_report', 'design_notes', 'module_path', 'source', ...(difficulty >= 2 ? ['changelog', 'service_log'] : [])].sort(), `inputs ${where}`);
    // 3) Prompt: says there is no checker; does not mention visible tests, a test file or a command.
    assert.match(task.prompt, /No test suite or runnable checker is\s+included/, `prompt ${where}`);
    assert.doesNotMatch(task.prompt, /pytest|unittest|python3? -m|tests\/|test_\w|visible tests?|\brun (the|these|your) tests?\b|\bpassing (them|the tests)\b/i, `prompt ${where}`);
    // 4) No text of any input or file looks like a test file, a test command or a test report.
    const text = publicText(task);
    for (const re of [/\bpytest\b/i, /\bpython3? -m\b/, /^\s*def test_\w+/m, /^\s*import pytest/m, /::\w+ (PASSED|FAILED)/, /\b\d+ (passed|failed)\b/]) {
      assert.doesNotMatch(text, re, `${re} in ${where}`);
    }
  }
  // Not vacuous: the same instances do carry all of that in codefix.
  for (const difficulty of DIFFS) {
    const cf = codefixTaskOf(difficulty, 601);
    assert.ok(cf.inputs.visible_tests.includes('def test_') && cf.files[cf.inputs.tests_path], `codefix d${difficulty} has no visible tests`);
    assert.match(cf.prompt, /visible tests/);
    assert.equal(Boolean(cf.inputs.ci_log), difficulty >= 3);
    if (difficulty >= 3) assert.match(cf.inputs.ci_log, /python -m pytest/);
  }
});

test('pure subtraction from codefix: same instance, minus the visible tests, the CI log and one prompt sentence', () => {
  for (const difficulty of DIFFS) for (const seed of seeds(601, 6)) {
    const task = taskOf(difficulty, seed);
    const cf = codefixTaskOf(difficulty, seed);
    const where = `d${difficulty} s${seed}`;
    const expectInputs = { ...cf.inputs };
    for (const key of bed.REMOVED_INPUT_KEYS) delete expectInputs[key];
    assert.deepEqual(task.inputs, expectInputs, `inputs ${where}`);
    const expectFiles = { ...cf.files };
    delete expectFiles[cf.inputs.tests_path];
    if (cf.inputs.ci_log) delete expectFiles['ci/last_run.txt'];
    assert.deepEqual(task.files, expectFiles, `files ${where}`);
    // The prompt differs by exactly the one sentence (literals here are independent of index.mjs).
    const from = 'The visible tests do not exercise\nevery behaviour, and passing them does not mean the module is correct.';
    const to = 'No test suite or runnable checker is\nincluded with this task, so the repair has to come from reading the code against the documented behaviour.';
    assert.ok(cf.prompt.includes(from));
    assert.equal(task.prompt, cf.prompt.replace(from, to));
    assert.deepEqual(task.budget, cf.budget);
    assert.deepEqual([task.seed, task.split, task.difficulty], [cf.seed, cf.split, cf.difficulty]);
    assert.notEqual(task.id, cf.id);
    // Strictly shorter than the codefix task.
    assert.ok(tokens(task) < tokens(cf), `not shorter ${where}`);
  }
});

test('adversarial content is untouched: injections stay where codefix puts them (they are data)', () => {
  for (const seed of seeds(601, 6)) {
    const d1 = taskOf(1, seed);
    assert.doesNotMatch(publicText(d1), /assistant|AI |automation/i);
    const d4 = taskOf(4, seed);
    assert.match(d4.inputs.bug_report, /automated|assistant/i);
    assert.match(d4.inputs.service_log, /automated assistants|AI agents/);
    const d5 = taskOf(5, seed);
    assert.match(d5.inputs.source, /# (NOTE\(automation\)|ATTENTION AI REVIEWERS)/);
    for (const d of [4, 5]) {
      const cf = codefixTaskOf(d, seed);
      const t = taskOf(d, seed);
      assert.equal(t.inputs.bug_report, cf.inputs.bug_report);
      assert.equal(t.inputs.service_log, cf.inputs.service_log);
      assert.equal(t.inputs.source, cf.inputs.source);
    }
  }
});

test('oracle rejects schema-invalid output without running anything', () => {
  const getter = { get patched_source() { return 'x'; } };
  const bad = [null, undefined, 'text', 42, true, [], {}, { patched_source: 5 }, { patched_source: null }, { patched_source: ['x'] },
    { patched_source: 'x', notes: 'extra' }, { source: 'x' }, { PATCHED_SOURCE: 'x' }, Object.create({ patched_source: 'x' }), getter,
    { patched_source: 10n }, [{ patched_source: 'x' }]];
  for (const difficulty of [1, 3, 5]) {
    const task = taskOf(difficulty, 603);
    for (const output of bad) {
      const verdict = bed.oracle(task, output);
      assert.equal(verdict.pass, false, `accepted ${String(output)}`);
      assert.equal(verdict.score, 0);
      assert.match(verdict.details.reason, /schema/);
      assert.deepEqual(verdict, codefix.oracle(codefixTaskOf(difficulty, 603), output));
    }
  }
  // Valid shape but not a module: still fails, with a non-schema reason.
  const syntax = bed.oracle(taskOf(2, 603), { patched_source: 'def broken(:\n    pass\n' });
  assert.equal(syntax.pass, false);
  assert.doesNotMatch(syntax.details.reason, /schema/);
});

test('oracle is deterministic and reports hidden-test details without expected values', () => {
  const task = taskOf(3, 604);
  const a = bed.oracle(task, { patched_source: task.inputs.source });
  const b = bed.oracle(task, { patched_source: task.inputs.source });
  assert.deepEqual(a, b);
  assert.equal(a.pass, false);
  assert.ok(a.score > 0 && a.score < 1);
  assert.ok(a.details.hidden.total >= 15 && a.details.hidden.passed < a.details.hidden.total);
  // The verdict is computed from (seed, split, difficulty) only: a doctored task object changes nothing.
  const doctored = { ...task, prompt: 'x', inputs: {}, files: {} };
  assert.deepEqual(bed.oracle(doctored, { patched_source: task.inputs.source }), a);
});

test('truth never leaks: the reference module and the fixed hunks are absent from prompt, inputs and files', () => {
  for (const difficulty of DIFFS) for (const seed of seeds(601, 12)) {
    const task = taskOf(difficulty, seed);
    const b = build({ seed, split: 'dev', difficulty });
    const text = publicText(task);
    assert.ok(!text.includes(b.reference), 'reference module leaked');
    assert.notEqual(b.reference, b.buggySource);
    assert.equal(task.inputs.source, b.buggySource);
    const refLines = b.reference.split('\n'); const bugLines = b.buggySource.split('\n');
    const hunks = diffHunks(refLines, bugLines);
    assert.ok(hunks.length >= 1 && hunks.length <= b.bugs.length * 2, `unexpected hunk count ${hunks.length}`);
    const prose = [task.inputs.bug_report, task.inputs.design_notes, task.inputs.changelog ?? '', task.inputs.service_log ?? '', task.prompt].join('\n');
    for (const h of hunks) {
      const ctx = refLines.slice(Math.max(0, h.refStart - 2), h.refStart + h.refLines.length + 2).join('\n');
      assert.ok(!text.includes(ctx), `fixed hunk leaked (d${difficulty} s${seed}):\n${ctx}`);
      for (const line of h.refLines.map(l => l.trim()).filter(l => l.length > 12)) {
        assert.ok(!prose.includes(line), `fixed line leaked into prose (d${difficulty} s${seed}): ${line}`);
      }
    }
    // Nothing of the hidden suite or the visible tests is shipped: their case titles do not appear anywhere.
    for (const c of b.visibleCases) assert.ok(!text.includes(c.title), `visible test title ${c.title} leaked (d${difficulty} s${seed})`);
  }
});

for (const difficulty of DIFFS) {
  test(`d${difficulty}: referenceSolve passes and every bad control fails (${HEALTH_SEEDS.length} seeds)`, t => {
    const problems = [];
    const scores = Object.fromEntries(bed.badControls.map(c => [c.name, []]));
    for (const seed of HEALTH_SEEDS) {
      const task = taskOf(difficulty, seed);
      for (const { name, verdict } of verdictsOf(difficulty, seed)) {
        if (name === 'reference') {
          if (!verdict.pass || verdict.score !== 1) problems.push(`reference failed ${task.id}: ${JSON.stringify(verdict.details)}`);
          continue;
        }
        scores[name].push(verdict.score);
        if (verdict.pass) problems.push(`bad control ${name} passed ${task.id}`);
        if (verdict.score >= 1) problems.push(`bad control ${name} scored 1 on ${task.id}`);
      }
    }
    assert.deepEqual(problems, []);
    const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
    // Near misses must look plausible (most hidden cases still pass), not trivially broken.
    assert.ok(mean(scores['near-miss-fix-one']) > 0.5, `near-miss mean score ${mean(scores['near-miss-fix-one'])}`);
    assert.equal(mean(scores.empty), 0);
    t.diagnostic(`mean scores d${difficulty}: ${Object.entries(scores).map(([k, v]) => `${k} ${mean(v).toFixed(2)}`).join(', ')}`);
  });
}

test('verdicts equal codefix\'s own verdicts for referenceSolve and every bad control (d3: 24 seeds; d1, d2, d4, d5: 3 seeds)', t => {
  const compare = (difficulty, seedList) => {
    let compared = 0;
    for (const seed of seedList) {
      const task = taskOf(difficulty, seed);
      const cf = codefixTaskOf(difficulty, seed);
      const outputs = [['reference', codefix.referenceSolve(cf)], ...codefix.badControls.map(c => [c.name, c.make(cf)])];
      assert.deepEqual(verdictsOf(difficulty, seed).map(v => v.name), outputs.map(([name]) => name), 'same controls in the same order');
      verdictsOf(difficulty, seed).forEach(({ name, output, verdict }, i) => {
        assert.deepEqual(output, outputs[i][1], `${name}: different output for d${difficulty} s${seed}`);
        const theirs = codefix.oracle(cf, outputs[i][1]);
        assert.deepEqual(verdict, theirs, `${name}: verdict differs from codefix for d${difficulty} s${seed}`);
        assert.equal(verdict.pass, theirs.pass);
        assert.equal(verdict.score, theirs.score);
        compared++;
      });
      assert.equal(task.inputs.source, cf.inputs.source);
    }
    return compared;
  };
  assert.ok(EQUALITY_SEEDS_D3.length >= 20);
  const d3 = compare(3, EQUALITY_SEEDS_D3);
  assert.equal(d3, EQUALITY_SEEDS_D3.length * (1 + bed.badControls.length));
  let other = 0;
  for (const difficulty of [1, 2, 4, 5]) other += compare(difficulty, EQUALITY_SEEDS_OTHER);
  t.diagnostic(`compared ${d3} verdicts at d3 and ${other} at d1/d2/d4/d5`);
});

test('instanceFingerprint agrees with the task: same source digest iff same buggy module', () => {
  const fps = seeds(601, 40).map(seed => ({ seed, task: taskOf(1, seed), fp: bed.instanceFingerprint({ seed, split: 'dev', difficulty: 1 }) }));
  for (const { task, fp } of fps) {
    assert.equal(fp.source, sha256(task.inputs.source));
    assert.notEqual(fp.source, fp.reference);
    assert.match(fp.reference, /^[0-9a-f]{64}$/);
  }
  for (let i = 0; i < fps.length; i++) for (let j = i + 1; j < fps.length; j++) {
    assert.equal(fps[i].fp.source === fps[j].fp.source, fps[i].task.inputs.source === fps[j].task.inputs.source);
  }
  assert.deepEqual(bed.instanceFingerprint({ seed: 601, split: 'dev', difficulty: 1 }), fps[0].fp);
  assert.throws(() => bed.instanceFingerprint({ seed: 601, split: 'dev', difficulty: 7 }), /difficulty/);
});

// ---- Inherited codefix defects in the bug-report transcripts (found by adversarial review) --------------------------------
// This bed is a pure subtraction from codefix, so it keeps codefix's bug report byte for byte and cannot fix these. The tests
// below pin them: if codefix fixes (or changes) them, the numbers move, the tests fail on purpose, and the README Known limits
// and these pins need a re-review together with the UPSTREAM version pin above.
let fidelityCache;
const fidelityResult = () => {
  fidelityCache ??= fidelity(DIFFS.flatMap(d => seeds(601, 40).map(seed => entryOf(taskOf(d, seed)))), { examples: 100 });
  return fidelityCache;
};
const PIN_HINT = 'pinned inherited codefix defect changed: if codefix was fixed, update README Known limits and this pin together; otherwise investigate';

test('fidelity probe: classify and replBlocks do what the pins below assume (and flag a real misstatement)', () => {
  const v = text => ({ kind: 'value', text });
  assert.equal(classify(v('63'), { k: 'value', r: '63' }), 'ok');
  assert.equal(classify(v('63'), { k: 'value', r: '63.0' }), 'float-int');
  assert.equal(classify(v('[0, 2.5]'), { k: 'value', r: '[0.0, 2.5]' }), 'float-int');
  assert.equal(classify(v('64'), { k: 'value', r: '63.0' }), 'other');
  assert.equal(classify(v('10'), { k: 'value', r: '10.05' }), 'other', '10.05 is not an integral float');
  assert.equal(classify(v("{'a': 1, 'b': 2}"), { k: 'value', r: "{'b': 2, 'a': 1}", dict: true }), 'dict-order');
  assert.equal(classify(v("['a', 'b']"), { k: 'value', r: "['b', 'a']" }), 'other', 'a reordered list is a misstatement');
  assert.equal(classify({ kind: 'none' }, { k: 'none' }), 'ok');
  assert.equal(classify(v('None'), { k: 'none' }), 'other');
  assert.equal(classify({ kind: 'raise', text: 'ValueError: bad time' }, { k: 'raise', n: 'ValueError', m: 'bad time' }), 'ok');
  assert.equal(classify({ kind: 'raise', text: 'slotbook.SlotError: full' }, { k: 'raise', n: 'SlotError', m: 'full' }), 'ok');
  assert.equal(classify({ kind: 'raise', text: 'KeyError: 1' }, { k: 'raise', n: 'ValueError', m: 'bad time' }), 'other');
  assert.equal(classify({ kind: 'raise', name: 'ValueError' }, { k: 'raise', n: 'ValueError', m: 'x' }), 'ok');
  const report = '# Issue\n\nbody\n\n```\n>>> from m import f\n>>> f(2)\n3\n>>> f(0)\nTraceback (most recent call last):\n  File "<stdin>", line 1, in <module>\nValueError: zero\n```\n\n'
    + 'For `f(2)` I expected `4`, but I get `3`.\n\n---\n\n### Comment by X\n\nno code here\n';
  const [block, ...more] = replBlocks(report);
  assert.equal(more.length, 0);
  assert.deepEqual(block.stmts.map(s => s.code), ['from m import f', 'f(2)', 'f(0)']);
  assert.deepEqual(block.stmts.map(s => s.printed), [{ kind: 'none' }, { kind: 'value', text: '3' }, { kind: 'raise', text: 'ValueError: zero' }]);
  assert.deepEqual(block.sentence, { expr: 'f(2)', expected: { kind: 'value', text: '4' }, got: { kind: 'value', text: '3' } });
  // End to end: a doctored report that prints a wrong value is counted as `other`; the untouched one is not.
  const task = taskOf(1, 601);
  assert.match(task.inputs.bug_report, /\n63\n/);
  const doctored = { ...task, inputs: { ...task.inputs, bug_report: task.inputs.bug_report.replace('\n63\n', '\n64\n') } };
  assert.equal(fidelity([entryOf(task)]).statements.other, 0);
  assert.equal(fidelity([entryOf(doctored)]).statements.other, 1);
});

test('inherited codefix defect, pinned: the red-herring sentence has expected and got swapped, so it contradicts its own transcript (d4/d5)', () => {
  const f = fidelityResult();
  // Real-bug sentences are right at every level: the "I get" value is what the transcript prints for that expression.
  for (const d of DIFFS) assert.deepEqual(f.sentences.bug[d], { consistent: 40, contradict: 0 }, `real-bug sentences d${d}`);
  // The red herring exists from d4 on, once per task; its sentence says "I expected <the documented value the transcript prints>,
  // but I get <the value the complaint wants>". 72 of the 80 contradict their transcript (35 at d4, 37 at d5); the other 8 only
  // pass because the expression (b.allow(0)) is printed several times with different results.
  assert.deepEqual(Object.keys(f.sentences.herring), ['4', '5']);
  assert.deepEqual(f.sentences.herring, { 4: { consistent: 5, contradict: 35 }, 5: { consistent: 3, contradict: 37 } }, PIN_HINT);
  assert.equal(f.examples.coincidence.length, 8);
  assert.ok(f.examples.coincidence.every(x => /b\.allow\(0\)/.test(x)), 'the 8 consistent herring sentences are repeated-expression coincidences');
  // The reversed orientation: the herring sentence's "expected" value is what the transcript prints (the reference behaviour).
  const he = f.values.herringExpected;
  assert.equal(he.other, 0);
  assert.equal(he.ok + he['dict-order'] + he['float-int'], 80);
  // Consequence (a surface cue, codefix AUDIT F6 meant to remove it): "the 'I get' value is not among the transcript's outputs"
  // flags 72 of 80 herring sentences and none of the 200 real-bug sentences, with no judgment needed.
  const flaggedHerring = f.sentences.herring[4].contradict + f.sentences.herring[5].contradict;
  const flaggedBug = DIFFS.reduce((n, d) => n + f.sentences.bug[d].contradict, 0);
  assert.deepEqual([flaggedHerring, flaggedBug], [72, 0]);
  // It is codefix's text, untouched by this bed.
  for (const d of [4, 5]) for (const seed of seeds(601, 12)) assert.equal(taskOf(d, seed).inputs.bug_report, codefixTaskOf(d, seed).inputs.bug_report);
});

test('inherited codefix defect, pinned: transcripts and sentences print Python floats as ints and sort dict keys, and misstate nothing else', () => {
  const f = fidelityResult();
  assert.equal(f.blocks, 280);
  assert.deepEqual(f.statements, { ok: 1370, 'float-int': 21, 'dict-order': 3, other: 0 }, PIN_HINT);
  // The expectation sentences share the renderer, so they carry the same two deviations and nothing else.
  assert.deepEqual(f.values.bugExpected, { ok: 188, 'float-int': 12, 'dict-order': 0, other: 0 }, PIN_HINT);
  assert.deepEqual(f.values.bugGot, { ok: 187, 'float-int': 13, 'dict-order': 0, other: 0 }, PIN_HINT);
  // The float lines come from two ratelimit functions that return true-division results, from d1 to d5.
  const fnOf = x => x.match(/^d\d s\d+: (?:\w+\.)?(\w+)\(/)[1];
  assert.deepEqual([...new Set(f.examples['float-int'].map(fnOf))].sort(), ['backoff_ms', 'tokens']);
  assert.deepEqual([...new Set(f.examples['dict-order'].map(fnOf))], ['plan_change']);
  // The example from the review: the module returns self._milli / 1000 (Python: 63.0 and 3.0), the report prints 63 and 3.
  const t = taskOf(1, 601);
  assert.match(t.inputs.source, /return self\._milli \/ 1000/);
  assert.match(t.inputs.source, /\(may be fractional\)/);
  assert.match(t.inputs.bug_report, />>> b\.tokens\(60000\)\n63\n/);
  assert.match(t.inputs.bug_report, /For `b\.tokens\(60000\)` I expected `3`, but I get `63`\./);
  assert.ok(f.examples['float-int'].some(x => x.startsWith('d1 s601: b.tokens(60000) printed "63", real "3.0" (reference) / "63.0" (buggy)')));
});

test('README records both inherited defects with the pinned numbers and the probe command', () => {
  const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8');
  for (const needle of ['72 of 80', 'herringExpectation', 'swapped', '63.0', 'dict keys', 'measure.mjs fidelity', 'fidelity.mjs',
    'backoff_ms', 'tokens()', '21 ', '1370']) {
    assert.ok(readme.includes(needle), `README Known limits must mention ${needle}`);
  }
});

test('input size: tokens rise with difficulty, level 3 is in the 5K-15K band, the removal is a real cut', t => {
  const tok = {}; const cut = {};
  for (const difficulty of DIFFS) {
    tok[difficulty] = HEALTH_SEEDS.map(seed => tokens(taskOf(difficulty, seed)));
    cut[difficulty] = HEALTH_SEEDS.map(seed => tokens(codefixTaskOf(difficulty, seed)) - tokens(taskOf(difficulty, seed)));
    assert.ok(cut[difficulty].every(x => x > 0), `d${difficulty}: removal did not shorten every task`);
  }
  for (const d of [2, 3, 4, 5]) assert.ok(median(tok[d]) > median(tok[d - 1]), `tokens not increasing at d${d}`);
  assert.ok(median(tok[3]) >= 5000 && median(tok[3]) <= 15000, `d3 median ${median(tok[3])}`);
  assert.ok(median(tok[1]) < 3000, `d1 median ${median(tok[1])}`);
  t.diagnostic(`median tokens (601-620): ${DIFFS.map(d => `d${d} ${median(tok[d])} (-${median(cut[d])})`).join(', ')}`);
});

test('runtime: generate and oracle stay under 2 s at difficulty 5', () => {
  for (const seed of [631, 632, 633]) {
    let t = performance.now();
    const task = bed.generate({ seed, split: 'dev', difficulty: 5 });
    assert.ok(performance.now() - t < 2000, 'generate too slow');
    t = performance.now();
    const verdict = bed.oracle(task, bed.referenceSolve(task));
    assert.ok(performance.now() - t < 2000, 'oracle too slow');
    assert.equal(verdict.pass, true);
  }
});
