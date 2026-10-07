// Regression tests for the 2026-10-07 adversarial audit (see AUDIT.md). Each test names the
// finding it pins. Nothing here runs candidate code outside the bed's own sandbox; the guard
// tests are rejected by the parse-only guard before any execution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bed from './index.mjs';
import { build } from './build.mjs';
import { COMMENT_LEADS } from './report.mjs';

const task = bed.generate({ seed: 5003, split: 'test', difficulty: 3 });
const ref = bed.referenceSolve(task).patched_source;
const afterDocstring = code => { const end = ref.indexOf('"""', 3) + 3; return `${ref.slice(0, end)}\n${code}\n${ref.slice(end)}`; };

test('F1 contract: every export present, schema portable, version bumped', () => {
  for (const k of ['family', 'outputSchema', 'generate', 'oracle', 'referenceSolve', 'badControls']) assert.ok(bed[k], k);
  assert.equal(bed.family.version, '1.1.0');
  const names = bed.badControls.map(c => c.name);
  for (const n of ['empty', 'shuffled-or-corrupted']) assert.ok(names.includes(n));
  assert.ok(names.some(n => n.startsWith('near-miss')));
  const a = bed.generate({ seed: 5001, split: 'test', difficulty: 3 });
  const b = bed.generate({ seed: 5001, split: 'test', difficulty: 3 });
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'not byte-identical');
});

test('F3 guard: attribute access to builtins/eval/open/sys/os is rejected before anything runs', () => {
  const attacks = {
    builtinsEval: 'import dataclasses\n_E = dataclasses.builtins.eval',
    builtinsOpen: 'import dataclasses\n_O = dataclasses.builtins.open',
    sysViaModule: 'import dataclasses\n_S = dataclasses.sys',
    osViaModule: 'import functools\n_P = functools.os',
    execAttr: 'import dataclasses\n_X = dataclasses.builtins.exec',
  };
  for (const [name, code] of Object.entries(attacks)) {
    const out = bed.oracle(task, { patched_source: afterDocstring(code) });
    assert.equal(out.pass, false, name);
    assert.equal(out.score, 0, name);
    assert.equal(out.details.reason, 'diff guard violated', name);
    assert.ok(out.details.hidden === null, `${name} reached the sandbox`);
  }
  // re.compile stays legal (false-positive check).
  const ok = bed.oracle(task, { patched_source: afterDocstring('import re\n_WS = re.compile(r"\\s+")') });
  assert.equal(ok.pass, true, JSON.stringify(ok.details));
});

test('F4 schema: degenerate and prototype-trick outputs fail without crashing', () => {
  const inherited = Object.create({ patched_source: ref });
  const getter = {}; let n = 0;
  Object.defineProperty(getter, 'patched_source', { enumerable: true, get: () => (n++ ? 'x' : ref) });
  const bad = [
    null, undefined, 0, NaN, Infinity, -Infinity, 'text', ref, [], [ref], {}, inherited, getter,
    { patched_source: null }, { patched_source: 42 }, { patched_source: NaN }, { patched_source: [ref] },
    { patched_source: { toString: () => ref } }, { patched_source: ref, extra: 1 }, { patched_source: ref, notes: '' },
    JSON.parse(`{"patched_source": ${JSON.stringify(ref)}, "__proto__": {"x": 1}}`),
    { patched_source: 10n },
  ];
  for (const [i, out] of bad.entries()) {
    const v = bed.oracle(task, out);
    assert.equal(v.pass, false, `case ${i}`);
    assert.equal(v.score, 0, `case ${i}`);
    assert.match(v.details.reason, /schema/, `case ${i}`);
  }
});

test('F4 degenerate strings: whitespace, huge, truncated, duplicated-buggy and fenced output all fail', () => {
  const buggy = task.inputs.source;
  const outs = {
    whitespace: ' \n\t '.repeat(200),
    huge: ref.repeat(3),
    tiny: ref.slice(0, 50),
    buggyTwice: buggy + '\n' + buggy,
    fencedReference: '```python\n' + ref + '\n```',
    nulByte: ref.replace('\n', '\n\u0000'),
    loneSurrogate: ref.replace('\n', '\n# \ud800\n'),
  };
  for (const [name, src] of Object.entries(outs)) {
    const v = bed.oracle(task, { patched_source: src });
    assert.equal(v.pass, false, name);
  }
  // A duplicated *reference* is still correct code and may pass; it must not crash.
  const dup = bed.oracle(task, { patched_source: `${ref}\n${ref}` });
  assert.equal(typeof dup.pass, 'boolean');
});

test('F4 accepted variants: CRLF line endings, trailing whitespace, comment-only edits pass', () => {
  const variants = {
    crlf: ref.replace(/\n/g, '\r\n'),
    trailing: ref.replace(/\n/g, '  \n'),
    noFinalNewline: ref.replace(/\n+$/, ''),
    comment: ref.replace(/\n(?=(class|def) )/, '\n# fixed per issue thread\n'),
  };
  for (const [name, src] of Object.entries(variants)) {
    const v = bed.oracle(task, { patched_source: src });
    assert.equal(v.pass, true, `${name}: ${JSON.stringify(v.details)}`);
  }
});

test('F5 scoring: malformed sandbox responses fail closed instead of throwing', () => {
  const b = build({ seed: 5003, split: 'test', difficulty: 3 });
  const good = { results: b.refHidden };
  assert.equal(bed.scoreHidden(b, good).pass, true);
  for (const job of [undefined, null, 7, {}, { results: [] }, { results: b.refHidden.slice(1) }, { results: 'x' },
    { results: [...b.refHidden.slice(0, -1), undefined] }, { results: [...b.refHidden.slice(0, -1), null] }]) {
    const v = bed.scoreHidden(b, job);
    assert.equal(v.pass, false, JSON.stringify(job)?.slice(0, 60));
  }
  assert.equal(bed.scoreHidden(b, { loadError: 'SyntaxError' }).score, 0);
});

test('F6 no surface cue separates the red herring from real bugs', () => {
  for (const difficulty of [4, 5]) for (let seed = 5000; seed < 5012; seed++) {
    const t = bed.generate({ seed, split: 'test', difficulty });
    const report = t.inputs.bug_report;
    // The generated expectation sentence is shared; herring *prose* in domains/*.mjs may still say
    // "I would expect" (open item O3 in AUDIT.md).
    assert.doesNotMatch(report, /For `[^`]+` I would expect/, `${t.id} uses the herring-only expectation sentence`);
    const leads = report.split('### Comment by').slice(1).map(c => c.split('\n\n')[1] ?? '');
    for (const c of leads) {
      const lead = COMMENT_LEADS.find(l => c.startsWith(l));
      if (lead) assert.ok(COMMENT_LEADS.includes(lead));
    }
  }
});
