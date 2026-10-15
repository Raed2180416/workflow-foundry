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
  // Since 2026-10-15 class M's budget is 100,000 (MEMORY-ROUTING-RECURSION.md §2 change 1); S6's 8,000 stays as a deliberate
  // per-step cap below it, to revisit when the library is unpaused. The effective cap is the smaller of the two.
  for (const [call, row] of Object.entries(CAP_TABLE)) {
    assert.equal(capOf(call), row.cap, `${call}: the table cap applies`);
    assert.ok(row.cap <= policy[row.class], `${call}: the table cap is within the class budget`);
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

// The L0 card fit (owner decision PAUSE-20261009 §5.10, taken 2026-10-14: cut the card, keep the 3,000 allocation).
// Before the cut (L0-VOCABULARY.md at 57a5e1d): 3,643 by the bound, 3,167 point estimate; compact 3,406 / 2,962; S6
// refused it. After: 2,962 / 2,576; compact 2,899 / 2,521 (BUILD-ORDER "Implementation status").
const L0_CONSTRUCTS = [[1, 'input', 'E2'], [2, 'step', 'E2'], [3, 'judge', 'E2'], [4, 'guard', 'E2'], [5, 'invariant', 'E2'], [6, 'map', 'E2'],
  [7, 'flag', 'E2'], [8, 'note', 'E2'], [9, 'done', 'E2'], [10, 'if / join / bounded for', 'E2'], [11, 'call', 'E3'], [12, 'agent', 'D'],
  [13, 'wide', 'D'], [14, 'plan', 'D'], [15, 'effect', 'IR'], [16, 'approve', 'IR'], [17, 'ask', 'IR'], [18, 'wait.delay', 'IR'],
  [19, 'wait.signal', 'N'], [20, 'retry', 'IR'], [21, 'route.error', 'IR partial'], [22, 'finally', 'IR partial / N'], [23, 'compensate', 'N'],
  [24, 'trigger.webhook', 'N'], [25, 'trigger.schedule', 'N'], [26, 'trigger.event / trigger.poll', 'N'], [27, 'state', 'N'],
  [28, 'admission', 'N'], [29, 'session', 'N'], [30, 'stream', 'N']];
// Each rule the constructor contract (LIBRARY §5) or the composition checker (L1 §9, LIBRARY §6) relies on, by phrase.
const L0_RULES = {
  closed: 'Build only from these 30 constructs', refusedOutside: 'anything else\nis refused',
  status: ['E2 built', 'E3 built', 'IR an engine node that runs today', 'D designed, not\nbuilt', 'N an engine node not built'],
  EFFECT_IN_SOLVER: 'with no effects, no waits and no approvals', envelope: 'owns triggers, effects, waits,\napprovals, retries and cross-run state',
  proposedEnvelope: 'only the solver runs and an envelope is a proposal', BRANCH_ON_TEXT: 'Never write control flow that untrusted data chooses',
  UNBOUNDED: ['unbounded loop or wait', 'the cap is a literal', 'unbounded `while`', 'a `wait` with no timeout'], stepOnly: 'free-form JavaScript outside a `step` body',
  oneDecision: 'one decision per judge', ENUM_NO_NONE: 'with a none or undecidable member', closedSchema: 'or a closed object',
  JUDGE_NO_CHECK: 'code `check` on every judge whose answer cites the input', tiers: ['tiers go from cheapest to dearest', 'from `policy/models.json` only'],
  samples: '`samples > 1` only for a gate on an effect', judgeIsData: 'its output\nis data', enumOnly: 'only through an enum',
  doneOnce: 'exactly once', mapBounded: 'bounded parallel, fail-fast', agentVerify: 'parent-side verify required', wide: 'planned fan-out ≤ 32',
  ONE_WRITER: 'with one writer', untrustedAsk: 'human input returned as untrusted data', refusals: 'Group chat, full-history handoff and interactive dashboard state',
  scratchpad: 'rewritten as `wide`\nwith a typed reduce', effectInSolver: 'an effect inside a solver', RECURSION: 'recursion\nby hash',
  MUTABLE_TARGET: 'a mutable call target', toolAllowList: 'a model-chosen tool outside the allow-list', selfModification: 'self-modification of the library',
  CREDENTIAL_LITERAL: 'credential in any literal (env-var names only, through the L3 binding)', refuseForm: 'write `refuse:<reason>` instead',
};

test('T2: the L0 card fits its 3,000-token S6 allocation by the bound, with all 30 constructs and every contract and checker rule', () => {
  const v = l0Card(), c = l0Card({ form: 'compact' });
  assert.ok(!v.text.includes('Changes since draft') && !v.text.includes('Provenance (outside the prompt)'), 'the outside-budget block is not in the prompt');
  assert.ok(v.text.startsWith('# L0: the closed vocabulary card'));
  assert.ok(v.tokens <= CAP_TABLE.S6.parts.l0, `verbatim ${v.tokens} (bound) > ${CAP_TABLE.S6.parts.l0}`);
  assert.ok(v.pointTokens < v.tokens && c.tokens < v.tokens && c.text.length < v.text.length, `compact ${c.tokens} / ${c.pointTokens}`);
  assert.equal(CAP_TABLE.S6.parts.l0, 3000, 'the allocation was not raised (decision §5.10: cut, do not raise)');
  // Every construct: one line with its number, name, status and a code example.
  const items = v.text.split('\n').filter(l => /^- \d+ /.test(l));
  assert.equal(items.length, 30, 'one line per construct');
  for (const [n, name, st] of L0_CONSTRUCTS) {
    const line = items.find(l => l.startsWith(`- ${n} `));
    assert.ok(line, `construct ${n} missing`);
    assert.ok(line.startsWith(`- ${n} ${name}`), `construct ${n} is not ${name}: ${line}`);
    for (const s of st.split(' / ')) assert.ok(new RegExp(`[ (]${s.replace(/ /g, '\\s')}[,:) ]`).test(line), `construct ${n} lacks status ${s}`);
    assert.ok(/: `/.test(line), `construct ${n} has no canonical example`);
  }
  for (const [rule, phrase] of Object.entries(L0_RULES)) for (const p of [phrase].flat()) assert.ok(v.text.replace(/\s+/g, ' ').includes(p.replace(/\s+/g, ' ')), `rule ${rule}: "${p}" missing`);
  // S6 assembles the card with every other part at its full allocation; the call stays within the class M cap.
  const p = assemblePrompt('S6', { l0: v.text, index: lines.slice(0, 20), expanded: [textOf(1200)], task: textOf(2500), other: textOf(500) });
  assert.equal(p.tokens.l0, v.tokens);
  assert.ok(p.tokens.total <= 8000, `${p.tokens.total}`);
});
