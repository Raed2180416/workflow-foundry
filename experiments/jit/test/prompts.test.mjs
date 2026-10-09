// Builder prompt versions (JIT v2). Version 1 is frozen: live dev streams recorded its hash (compile.json promptSha256) and
// will be resumed, so its text must stay byte-identical. Version 2 adds the threshold / flag / autoFlag guidance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { builderPrompt, compilePrompt, recompilePrompt, promptVersionOf, PROMPT_VERSIONS } from '../prompts.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
const A = { traces: 3, regressions: 0, minutes: 30, gatewayUsd: 1.5, perTaskUsd: 1, models: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'] };
const B = { traces: 1, regressions: 2, minutes: 45, gatewayUsd: 1.5, perTaskUsd: 1, models: ['claude-haiku-5-5'] };
// sha256 of the v1 text, taken from the code before promptVersion existed (commit 59938e5).
const FROZEN = { compileA: '5a0172731ef52245913b547fc95cc3189435cb906fe606f89813a8f1af8a0c3a', compileB: 'f38caaa3071706acb5606edbf7a975e25883ba107b3df75961eb564705b1c8af',
  recompileA: 'bcf7e60f91d398a510eca21fae836b4cbc47318d213fcb1f9a94e5791bec007a', recompileB: 'd7b0c1ad9559376aa2334ee71bbb37f64e36a89dd7c6e570fe3de71804dcf094' };

test('promptVersion 1 (the default, or explicit) is byte-identical to the frozen v1 text', () => {
  for (const [name, opts] of [['A', A], ['B', B]]) {
    for (const kind of ['compile', 'recompile']) {
      const want = FROZEN[kind + name];
      assert.equal(sha(builderPrompt(kind, opts)), want, `${kind} ${name} default`);
      assert.equal(sha(builderPrompt(kind, { ...opts, promptVersion: 1 })), want, `${kind} ${name} explicit 1`);
      assert.equal(sha(builderPrompt(kind, { ...opts, promptVersion: undefined })), want, `${kind} ${name} undefined`);
    }
  }
  assert.equal(builderPrompt('compile', A), compilePrompt(A)); assert.equal(builderPrompt('recompile', B), recompilePrompt(B));
  for (const kind of ['compile', 'recompile']) for (const word of ['flow.flag', 'autoFlag', 'near-threshold']) assert.ok(!builderPrompt(kind, A).includes(word), `v1 ${kind} has no ${word}`);
});

test('promptVersion 2 adds the threshold, flag and autoFlag guidance and keeps everything v1 says', () => {
  for (const kind of ['compile', 'recompile']) {
    const v1 = builderPrompt(kind, A), v2 = builderPrompt(kind, { ...A, promptVersion: 2 });
    assert.notEqual(v2, v1);
    assert.match(v2, /heuristic threshold \(fuzzy name or typo matching, a similarity cutoff, a tolerance window\)/);
    assert.match(v2, /decide the\s+clear cases in code and send only the near-threshold candidates to one narrow flow\.judge, batched, with a check code can\s+verify/);
    assert.match(v2, /Call flow\.flag\(name, detail\) for every decision taken on weak evidence/);
    assert.match(v2, /createFlow\(\{ budgetUsd: 1, autoFlag: true \}\)/);
    assert.match(v2, /flow\.flag\('weak-name-match'/);
    // v2 only inserts text: every v1 line is still there, in order.
    const lines = v2.split('\n');
    let at = 0;
    for (const line of v1.split('\n').filter(l => !l.includes('createFlow('))) { const i = lines.indexOf(line, at); assert.ok(i >= at, `v1 line kept: ${line}`); at = i + 1; }
    assert.ok(v2.length - v1.length < 1200, `v2 stays concise (+${v2.length - v1.length} chars)`);
  }
});

// sha256 of the v2 text, taken from the code before promptVersion 3 existed (commit 39623bf).
const FROZEN_V2 = { compileA: '01aa9afb72dfc83d75adc8505dc6c5c666b578b366507d0a1ecec2217020794b', compileB: '0adfeeb2ae3548a877a677c7be13c6be6bc2bce10335bbe8062f54afd78bb92e',
  recompileA: 'ba874cbf1e799dcd9dcd24e32a6a506601ec7e965ed7fea01e1c25382d287229', recompileB: '9feac13ba9cff5e288b315423ca011a2e232a5c9f0cd885328fbf15c83664303' };
const V21 = { compare: 'tolerant', relTol: 0.02, absTol: 1e-6, acceptance: 'strict', minPartial: 0.85 };

test('v2.1: prompt versions 1 and 2 stay byte-identical, also when the v2.1 compile options are passed', () => {
  for (const [name, opts] of [['A', A], ['B', B]]) for (const kind of ['compile', 'recompile']) {
    assert.equal(sha(builderPrompt(kind, { ...opts, promptVersion: 2 })), FROZEN_V2[kind + name], `v2 ${kind} ${name}`);
    assert.equal(sha(builderPrompt(kind, { ...opts, promptVersion: 2, ...V21 })), FROZEN_V2[kind + name], `v2 ${kind} ${name} ignores the v2.1 options`);
    assert.equal(sha(builderPrompt(kind, { ...opts, ...V21 })), FROZEN[kind + name], `v1 ${kind} ${name} ignores the v2.1 options`);
  }
});

test('promptVersion 3 is the v2 text plus inserted lines (every v2 line kept, in order): near-miss scan, deopt calibration, verbatim quotes', () => {
  const inOrder = (small, big, label) => {
    const lines = big.split('\n');
    let at = 0;
    for (const line of small.split('\n')) { const i = lines.indexOf(line, at); assert.ok(i >= at, `${label}: v2 line kept in order: ${line}`); at = i + 1; }
  };
  for (const opts of [A, B]) for (const kind of ['compile', 'recompile']) for (const extra of [{}, V21]) {
    const v2 = builderPrompt(kind, { ...opts, promptVersion: 2 }), v3 = builderPrompt(kind, { ...opts, promptVersion: 3, ...extra });
    inOrder(v2, v3, `${kind} ${JSON.stringify(extra)}`);
    assert.ok(v3.length > v2.length);
    // (a) near-miss groups after grouping -> narrow same-entity judge with a verifiable check, flagged
    assert.match(v3, /After any grouping, dedup, merge or clustering step, scan the result for near-miss groups/);
    assert.match(v3, /share a secondary\s+attribute/); assert.match(v3, /same-entity flow\.judge/); assert.match(v3, /check code can verify/); assert.match(v3, /flow\.flag every such pair/);
    // (c) quotes verbatim from the task
    assert.match(v3, /Quote verbatim: put the deciding sentence in double quotes, copied from that case's prompt\.md or a text value in inputs\.json/);
    // (b) only in a recompile: read the deopts; calibrate or guard; never loosen silently
    const b = /Read the deopts before you change code[\s\S]*calibrate the\s+check[\s\S]*earlier flow\.guard[\s\S]*Never loosen or drop a check silently: each changed check gets a line in\s+BUILD-NOTES\.md/;
    if (kind === 'recompile') assert.match(v3, b); else assert.doesNotMatch(v3, /Read the deopts/);
    // The strict rule and the tolerant comparison are stated only when the compile uses them.
    if (extra.acceptance) assert.match(v3, /text that every case's task shares \(the common instructions\) explains no case,\s+and each case needs its own quote/);
    else assert.doesNotMatch(v3, /explains no case/);
    if (extra.acceptance) assert.match(v3, /Acceptance is checked by code after you finish[\s\S]*at least 0\.85 over the traces, or at least one exact trace[\s\S]*occurs verbatim in that case's task/);
    else assert.doesNotMatch(v3, /Acceptance is checked by code/);
    if (extra.compare) assert.match(v3, /check-traces compares numbers within a tolerance \(relative 0\.02, absolute 0\.000001; two integers exactly\)/);
    else assert.doesNotMatch(v3, /within a tolerance/);
    assert.ok(v3.length - v2.length < (kind === 'recompile' ? 2600 : 1900), `v3 stays concise (+${v3.length - v2.length} chars)`);
  }
});

test('prompt v3 states the comparison it is given: exact numbers at 0/0, the tolerant keys when listed', () => {
  const v3 = extra => builderPrompt('compile', { ...A, promptVersion: 3, compare: 'tolerant', ...extra });
  const zero = v3({ relTol: 0, absTol: 0 });
  assert.match(zero, /Here check-traces trims strings and treats arrays as unordered; numbers must match exactly\./);
  assert.doesNotMatch(zero, /need not match the agent's to the last digit/, 'no tolerance to promise at 0/0');
  assert.match(v3({ relTol: 0.01, absTol: 1e-9, tolerantKeys: ['km', 'vmax'] }), /compares numbers under km, vmax within a tolerance \(relative 0\.01, absolute 1e-9\) and every other number exactly/);
});

test('an unknown promptVersion is refused', () => {
  assert.deepEqual([...PROMPT_VERSIONS], [1, 2, 3, 4]);
  assert.equal(promptVersionOf({}), 1); assert.equal(promptVersionOf({ promptVersion: 2 }), 2);
  for (const bad of [0, 5, '2', 1.5, 'v2']) assert.throws(() => builderPrompt('compile', { ...A, promptVersion: bad }), /promptVersion must be one of 1, 2, 3, 4/);
});

// S0-6 (opt-in): acceptanceIds 'structured' appends the verdicts.json instructions; any other value moves no pinned text.
import { VERDICTS_PROMPT_TEXT, VERDICTS_PROMPT_VERSION, verdictsPromptVersionOf } from '../prompts.mjs';
test('acceptanceIds: the pinned v1 and v2 texts are unchanged for exact, lenient or unset; structured appends the verdicts.json text to any version, keeping every line', () => {
  for (const [name, opts] of [['A', A], ['B', B]]) for (const kind of ['compile', 'recompile']) for (const ids of [undefined, 'exact', 'lenient']) {
    assert.equal(sha(builderPrompt(kind, { ...opts, acceptanceIds: ids })), FROZEN[kind + name], `v1 ${kind} ${name} ${ids}`);
    assert.equal(sha(builderPrompt(kind, { ...opts, promptVersion: 2, acceptanceIds: ids })), FROZEN_V2[kind + name], `v2 ${kind} ${name} ${ids}`);
    for (const v of [3, 4]) assert.equal(builderPrompt(kind, { ...opts, promptVersion: v, ...V21, acceptanceIds: ids }), builderPrompt(kind, { ...opts, promptVersion: v, ...V21 }), `v${v} ${ids}`);
  }
  assert.equal(verdictsPromptVersionOf({ acceptanceIds: 'structured' }), VERDICTS_PROMPT_VERSION); assert.equal(VERDICTS_PROMPT_VERSION, 'verdicts-1');
  for (const ids of [undefined, 'exact', 'lenient']) assert.equal(verdictsPromptVersionOf({ acceptanceIds: ids }), null);
  for (const v of [1, 2, 3, 4]) for (const kind of ['compile', 'recompile']) {
    const base = builderPrompt(kind, { ...A, promptVersion: v, ...(v >= 3 ? V21 : {}) }), s = builderPrompt(kind, { ...A, promptVersion: v, ...(v >= 3 ? V21 : {}), acceptanceIds: 'structured' });
    assert.ok(s.includes(VERDICTS_PROMPT_TEXT.trim()), `v${v} ${kind}: the verdicts text`);
    assert.equal(s.length - base.length, VERDICTS_PROMPT_TEXT.trim().length + 1, 'appended, nothing else');
    const lines = s.split('\n'); let at = 0;
    for (const line of base.split('\n')) { const i = lines.indexOf(line, at); assert.ok(i >= at, `v${v} ${kind}: line kept in order: ${line}`); at = i + 1; }
    assert.ok(s.indexOf('Per-case verdicts (required)') < s.indexOf('You have about'), 'before the time and BUILD-NOTES paragraph');
  }
});
