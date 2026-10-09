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

test('an unknown promptVersion is refused', () => {
  assert.deepEqual([...PROMPT_VERSIONS], [1, 2]);
  assert.equal(promptVersionOf({}), 1); assert.equal(promptVersionOf({ promptVersion: 2 }), 2);
  for (const bad of [0, 3, '2', 1.5, 'v2']) assert.throws(() => builderPrompt('compile', { ...A, promptVersion: bad }), /promptVersion must be one of 1, 2/);
});
