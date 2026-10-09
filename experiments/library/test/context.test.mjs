// T2 (partial; LIBRARY-TESTS §2): the per-call cap table (LIBRARY §5.2) is code, and an oversized prompt is refused with
// CONTEXT_OVER_CLASS_BUDGET, never truncated. The full T2 (the constructor loop end to end with a scripted model) is
// BUILD-ORDER step 6. $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemblePrompt, CAP_TABLE, CLASS_BUDGETS, capOf, l0Card, REFUSAL, PART_REFUSAL, countTokens } from '../context.mjs';
import { loadL1 } from '../cards.mjs';
import { buildIndex } from '../index.mjs';

const lines = buildIndex({ l1: loadL1() }).map(r => r.line);
const words = n => Array.from({ length: n }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}`).join(' ');   // ~1.4 tokens per word
const textOf = tokens => { let n = Math.floor(tokens / 1.5); while (countTokens(words(n + 1)) <= tokens) n++; while (countTokens(words(n)) > tokens) n--; return words(n); };
const refusedWith = (fn, code, part) => assert.throws(fn, e => e.code === code && (part == null || e.details?.part === part), `${code} on ${part}`);

test('T2: the cap table is LIBRARY §5.2 and agrees with policy/models.json class budgets; allocations fit inside each cap', () => {
  const policy = JSON.parse(readFileSync(new URL('../../../policy/models.json', import.meta.url), 'utf8')).inputBudgetTokensByClass;
  assert.deepEqual(CLASS_BUDGETS, policy);
  assert.deepEqual(Object.fromEntries(Object.entries(CAP_TABLE).map(([k, r]) => [k, [r.class, r.cap]])), { S1: ['S', 4000], S5: ['S', 4000], S6: ['M', 8000], S8: ['S', 4000] });
  for (const [call, row] of Object.entries(CAP_TABLE)) {
    assert.equal(capOf(call), policy[row.class], `${call}: the table cap is the class budget`);
    assert.ok(Object.values(row.parts).reduce((a, b) => a + b, 0) <= row.cap, `${call}: allocations sum within the cap`);
  }
  assert.deepEqual(CAP_TABLE.S6.parts, { l0: 3000, index: 600, expanded: 1200, task: 2500, other: 500 });
  assert.equal(CAP_TABLE.S6.maxExpanded, 1, 'one expanded card per fill call');
  assert.equal(CAP_TABLE.S5.maxIndexLines, 20);
});

test('T2: a prompt within its caps is assembled with every part verbatim and its token counts', () => {
  const log = [];
  const task = textOf(900), other = 'Return the slot values as JSON matching the slot-group schema.';
  const p = assemblePrompt('S5', { index: lines.slice(0, 20), expanded: lines.slice(0, 20).map((l, i) => `J1 ${i}: Does the task need this?`), task, other }, { log });
  assert.equal(p.cap, 4000); assert.equal(p.class, 'S');
  for (const l of lines.slice(0, 20)) assert.ok(p.prompt.includes(l));
  assert.ok(p.prompt.includes(task) && p.prompt.includes(other), 'nothing truncated');
  assert.ok(p.tokens.total <= 4000 && p.tokens.total >= p.tokens.task + p.tokens.index);
  assert.equal(log.length, 1); assert.equal(log[0].call, 'S5'); assert.equal(log[0].refused, undefined);
});

test('T2: every over-allocation is refused with CONTEXT_OVER_CLASS_BUDGET naming the part, never truncated', () => {
  const log = [];
  refusedWith(() => assemblePrompt('S1', { task: textOf(3100) }, { log }), REFUSAL, 'task');
  refusedWith(() => assemblePrompt('S1', { task: textOf(100), other: textOf(320) }), REFUSAL, 'other');
  refusedWith(() => assemblePrompt('S5', { index: lines.slice(0, 21) }), REFUSAL, 'index');
  refusedWith(() => assemblePrompt('S5', { index: ['P99 ' + textOf(40)] }), REFUSAL, 'index');
  refusedWith(() => assemblePrompt('S6', { expanded: ['card one', 'card two'] }), REFUSAL, 'expanded');
  refusedWith(() => assemblePrompt('S6', { expanded: [textOf(1250)] }), REFUSAL, 'expanded');
  refusedWith(() => assemblePrompt('S6', { task: textOf(2600) }), REFUSAL, 'task');
  refusedWith(() => assemblePrompt('S8', { expanded: textOf(2100) }), REFUSAL, 'expanded');
  // The class cap itself: allocations widened by an experiment arm, the total still refused.
  refusedWith(() => assemblePrompt('S8', { expanded: textOf(1900), task: textOf(1900), other: textOf(450) }, { caps: { parts: { expanded: 4000, task: 4000 } } }), REFUSAL, 'total');
  assert.equal(log.length, 1); assert.equal(log[0].refused, REFUSAL); assert.equal(log[0].part, 'task');
  // A part the call does not take is refused, not dropped.
  refusedWith(() => assemblePrompt('S1', { l0: 'card', task: 'x' }), PART_REFUSAL, 'l0');
  refusedWith(() => assemblePrompt('S9', {}), 'CONTEXT_UNKNOWN_CALL');
});

test('T2 finding: the L0 card as written measures over its 3,000-token allocation under the calibrated counter, so S6 refuses it', () => {
  const v = l0Card(), c = l0Card({ form: 'compact' });
  assert.ok(!v.text.includes('Changes since draft'), 'the changes block sits outside the budget');
  assert.ok(v.text.startsWith('# L0: the closed vocabulary card') && v.text.includes('credential in any literal'));
  assert.ok(c.tokens < v.tokens && c.text.length < v.text.length);
  // Recorded numbers (BUILD-ORDER "Implementation status"): bound / point estimate.
  assert.ok(v.tokens > 3000 && v.pointTokens > 3000, `verbatim ${v.tokens} / ${v.pointTokens}`);
  assert.ok(c.tokens > 3000, `compact ${c.tokens} / ${c.pointTokens}`);
  assert.ok(Math.ceil(v.text.length / 3.5) < 3000, 'under chars/3.5 it would have fitted, which is how the allocation looked feasible');
  refusedWith(() => assemblePrompt('S6', { l0: v.text, task: 'x' }), REFUSAL, 'l0');
  // With the allocation an owner decision would set, the rest of the S6 budget still holds.
  const p = assemblePrompt('S6', { l0: v.text, index: lines.slice(0, 20), expanded: ['P07 card text'], task: textOf(2000), other: 'fill' }, { caps: { parts: { l0: 3700 } } });
  assert.ok(p.tokens.total <= 8000, `${p.tokens.total}`);
});
