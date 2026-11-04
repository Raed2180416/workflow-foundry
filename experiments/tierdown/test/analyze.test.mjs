// Tier-down analysis tests (A10): node and injection tables, the C selection rule, the baselines, and the H
// capability row (cost saved, flips both ways, non-inferiority). Synthetic rows; no archive, no model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeTable, injectTable, selectOnC, baselineAssignments, evaluateOnH, capabilityRow, assignSpec, spearman, leverageCheck, mergeInject } from '../analyze.mjs';
import { leafDiff } from '../leafdiff.mjs';
import { parseAssign, rejectedKeys } from '../inject.mjs';
import { sliceOf, ledgerUse, decodingFor } from '../tier-replay.mjs';
import { openaiChatDecoding, DEFAULT_OUTPUT_ALLOWANCE } from '../../../src/models/providers/openai-chat.mjs';
import { classesOf } from '../classes.mjs';
import { bound2 } from '../policy.mjs';

const bound2Of = meanAgreement => bound2({ disagreement: 1 - meanAgreement, usable: 20, answered: 20 }).holds;

const ans = (site, tier, ok, agreement, extra = {}) => ({ site, tier, ok, agreement: ok ? agreement : undefined, exact: ok && agreement === 1, costUsd: 0.001, refCostUsd: 0.01, latencyMs: 100, refLatencyMs: 1000, samples: 1, ...extra });

test('nodeTable: usable rate, agreement over usable answers only, k-sample charge for model tiers only', () => {
  const t = nodeTable([ans('s', 'mercury-3', true, 1), ans('s', 'mercury-3', true, 0.5), ans('s', 'mercury-3', false, 0, { error: { code: 'MODEL_SCHEMA' } }),
    ans('v', 'claude-haiku-5-5', true, 1, { samples: 5 }), ans('v', 'rule', true, 1, { samples: 5, costUsd: 0 })]);
  const m = t.find(x => x.site === 's');
  assert.equal(m.answered, 3); assert.equal(m.usable, 2); assert.equal(m.agreement, 0.75); assert.equal(m.disagreement, 0.25); assert.equal(m.exactRate, 0.5);
  assert.deepEqual(m.errors, [['MODEL_SCHEMA', 1]]);
  assert.ok(Math.abs(t.find(x => x.site === 'v' && x.tier === 'claude-haiku-5-5').tierUsdPerDecision - 0.005) < 1e-12, 'a 5-sample vote at Haiku costs 5 answers');
  assert.equal(t.find(x => x.site === 'v' && x.tier === 'rule').tierUsdPerDecision, 0);
});

const inj = (assignment, row, outcome, basePass, extra = {}) => ({ assignment, row, status: 'measured', outcome, basePass, pass: outcome === 'flip' ? !basePass : outcome === 'unmeasured' ? null : basePass,
  direction: outcome === 'flip' ? (basePass ? 'pass->fail' : 'fail->pass') : null, judgeUsd: 0.002, refUsd: 0.01, deoptUsd: outcome === 'deopt' ? 0.5 : 0, latencyMs: 10, refLatencyMs: 100, ...extra });

test('injectTable: flips both ways, unmeasured excluded, deopts charged', () => {
  const t = injectTable([inj('a', 1, 'same', true), inj('a', 2, 'flip', true), inj('a', 3, 'flip', false), inj('a', 4, 'unmeasured', true), inj('a', 5, 'deopt', true),
    { assignment: 'a', row: 6, status: 'incomplete' }]).a;
  assert.equal(t.units, 4); assert.equal(t.unmeasured, 1); assert.equal(t.incomplete, 1);
  assert.equal(t.passFail, 1); assert.equal(t.failPass, 1); assert.equal(t.deopts, 1);
  assert.ok(Math.abs(t.judgeUsd - (4 * 0.002 + 0.5)) < 1e-12);
});

test('selectOnC: cheapest eligible tier; a C pass->fail flip or a failed Bound 2 disqualifies; order by saving', () => {
  const prereg = { sites: [{ site: 'x', tiers: ['claude-haiku-5-5', 'mercury-3', 'rule'] }, { site: 'y', tiers: ['claude-haiku-5-5'] }, { site: 'z', tiers: ['mercury-3'] }] };
  const nodes = nodeTable([
    ans('x', 'claude-haiku-5-5', true, 1), ans('x', 'mercury-3', true, 0.5), ans('x', 'rule', true, 1, { costUsd: 0 }), ans('x', 'rule', false, 0, { abstain: 'no cue' }),
    ans('y', 'claude-haiku-5-5', true, 0.99), ans('z', 'mercury-3', true, 1)]);
  const injRows = injectTable([inj('x@claude-haiku-5-5', 1, 'same', true), inj('x@mercury-3', 1, 'same', true), inj('x@rule', 1, 'flip', true),
    inj('y@claude-haiku-5-5', 1, 'same', true, { judgeUsd: 0.001 }), inj('z@mercury-3', 1, 'same', true, { judgeUsd: 0.009 })]);
  const sel = selectOnC({ prereg, nodes, inj: injRows, classes: { x: { class: 'high', delta: 0.02 }, y: { class: 'low', delta: 0.1 } } });
  const x = sel.sites.find(s => s.site === 'x');
  assert.equal(x.selected, 'claude-haiku-5-5', 'rule flipped on C, mercury fails Bound 2 (disagreement 0.5)');
  assert.match(x.candidates.find(c => c.tier === 'rule').reason, /flips on C/);
  assert.match(x.candidates.find(c => c.tier === 'mercury-3').reason, /Bound 2/);
  assert.deepEqual(sel.order.map(o => o.site), ['y', 'x', 'z'], 'descending C saving per unit');
  assert.equal(sel.sites.find(s => s.site === 'z').class, 'high', 'a site with no screen class is high');
  assert.deepEqual(sel.screen, { x: 'rule', y: 'claude-haiku-5-5', z: 'mercury-3' }, 'B-screen ignores flips and leverage');
  const b = baselineAssignments({ prereg: { sites: [{ site: 'records/rules', tiers: ['claude-haiku-5-5', 'mercury-3', 'memo'] }, { site: 'records/countries', tiers: ['mercury-3', 'rule', 'memo'] }] }, selection: sel });
  assert.deepEqual(b['B-sink'], { 'records/countries': 'rule' }, 'global readers keep the reference, the rest go cheapest');
  const b2 = baselineAssignments({ prereg: { sites: [{ site: 'records/countries', tiers: ['mercury-3', 'rule', 'memo'] }] }, selection: sel,
    nodes: nodeTable([ans('records/countries', 'memo', false, 0, { abstain: 'none' }), ans('records/countries', 'rule', false, 0, { abstain: 'x' }), ans('records/countries', 'mercury-3', true, 1)]) });
  assert.deepEqual(b2['B-sink'], { 'records/countries': 'mercury-3' }, 'the cheapest tier with a usable C answer, never a tier that only abstained');
  assert.equal(bound2Of(0.95), true, 'a mean agreement of exactly 0.95 meets epsilon 0.05 (floating point)');
  assert.deepEqual(b['B-all-haiku'], { 'records/rules': 'claude-haiku-5-5' });
  assert.deepEqual(parseAssign(assignSpec('p', { 'kinetics/extract:*': 'claude-haiku-5-5', 'records/countries': 'rule' })), [{ name: 'p', map: { 'kinetics/extract:*': 'claude-haiku-5-5', 'records/countries': 'rule' } }]);
});

test('evaluateOnH: Bound 1 needs enough zero-flip units; fixed sequence stops; provisional is separate', () => {
  const order = [{ site: 'a', tier: 'mercury-3', delta: 0.10 }, { site: 'b', tier: 'rule', delta: 0.10 }];
  const nodes = nodeTable([...Array(30)].map(() => ans('a', 'mercury-3', true, 1)).concat([ans('b', 'rule', true, 1)]));
  const rows = [...Array(29)].map((_, i) => inj('a@mercury-3', i, 'same', true)).concat([...Array(10)].map((_, i) => inj('b@rule', i, 'same', true)));
  const { primary, provisional } = evaluateOnH({ selection: { order }, nodes, inj: injectTable(rows) });
  assert.equal(primary[0].verdict, 'promote', '29 zero-flip units meet delta 0.10');
  assert.equal(primary[1].verdict, 'keep-reference', '10 units cannot');
  assert.ok(provisional.every(p => p.keep), 'both are provisionally kept (zero flips, Bound 2)');
  const r2 = evaluateOnH({ selection: { order: [order[1], order[0]] }, nodes, inj: injectTable(rows) });
  assert.deepEqual(r2.primary.map(p => p.verdict), ['keep-reference', 'not-tested'], 'the sequence stops at the first failure');
});

test('capabilityRow: untouched units keep reference cost and outcome; NI and flips reported', () => {
  const units = [1, 2, 3, 4].map(row => ({ row, basePass: row !== 4, refUsd: 0.01, refLatencyMs: 100 }));
  const rows = [inj('p', 1, 'same', true), inj('p', 2, 'flip', true), inj('p', 4, 'flip', false)];
  const c = capabilityRow('p', rows, units);
  assert.equal(c.units, 4); assert.equal(c.refPass, 3); assert.equal(c.pass, 3); assert.equal(c.passFail, 1); assert.equal(c.failPass, 1);
  assert.ok(Math.abs(c.costSaved - (1 - (3 * 0.002 + 0.01) / 0.04)) < 1e-12);
  assert.equal(c.ni.holds, false, 'four units cannot show non-inferiority');
  const d = capabilityRow('q', [{ assignment: 'q', row: 1, status: 'incomplete' }, inj('q', 2, 'same', true)], units);
  assert.equal(d.incomplete, 1); assert.equal(d.units, 3, 'an incomplete unit is left out, never scored as the reference');
});

test('split, ledger and classes helpers', () => {
  assert.equal(sliceOf('records:dev:d3:s204'), sliceOf('records:dev:d3:s204'));
  const keys = [...Array(200)].map((_, i) => `records:dev:d3:s${i}`), h = keys.filter(k => sliceOf(k) === 'H').length;
  assert.ok(h > 70 && h < 130, `about half in H (${h}/200)`);
  assert.deepEqual(ledgerUse([]), { haikuUsd: 0, mercuryTokens: 0 });
  assert.equal(rejectedKeys({ judges: [{ key: 'a', ok: false }, { key: 'b', ok: true }, { key: 'c', ok: false }] }, new Map([['a', 1], ['b', 1]])).size, 1);
  const cls = classesOf({ rows: [{ status: 'screened', id: 'r1', taskKey: keys.find(k => sliceOf(k) === 'C'), perturbed: [{ site: 's', outcome: 'flip' }, { site: 's', outcome: 'same' }, { site: 's', outcome: 'unmeasured' }] },
    { status: 'screened', id: 'r2', taskKey: keys.find(k => sliceOf(k) === 'H'), perturbed: [{ site: 's', outcome: 'flip' }] }] });
  assert.equal(cls.s.flipRate, 0.5, 'H rows and unmeasured perturbations are excluded'); assert.equal(cls.s.class, 'high'); assert.equal(cls.s.unmeasured, 1);
});

test('spearman and the screen-vs-injection kill rule', () => {
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.ok(Math.abs(spearman([1, 1, 2, 3], [1, 2, 3, 4]) - 0.9486832980505138) < 1e-12, 'average ranks for ties');
  assert.equal(spearman([1, 2], [1, 2]), null, 'too few pairs');
  assert.equal(spearman([1, 1, 1], [1, 2, 3]), null, 'a constant side has no rank order');
  const classes = { a: { flipRate: 0.4 }, b: { flipRate: 0.2 }, c: { flipRate: 0.0 }, d: { flipRate: null } };
  const row = (site, tier, outcome, status = 'measured') => ({ assignment: `${site}@${tier}`, status, outcome });
  const rows = [row('a', 'claude-haiku-5-5', 'flip'), row('a', 'mercury-3', 'deopt'), row('b', 'claude-haiku-5-5', 'flip'), row('b', 'claude-haiku-5-5', 'same'),
    row('c', 'rule', 'same'), row('c', 'memo', 'flip'), row('c', 'rule', 'unmeasured'), row('d', 'rule', 'flip'), { assignment: 'selected', status: 'measured', outcome: 'flip' }, row('c', 'rule', null, 'incomplete')];
  const k = leverageCheck(classes, rows);
  assert.deepEqual(k.rows.map(r => [r.site, r.units, r.moved]), [['a', 2, 2], ['b', 2, 1], ['c', 1, 0]], 'memo, unmeasured, incomplete, combined and unclassed rows are left out; a deopt moves the outcome');
  assert.equal(k.rho, 1); assert.equal(k.keepScreen, true);
  const k2 = leverageCheck({ a: { flipRate: 0 }, b: { flipRate: 0.2 }, c: { flipRate: 0.4 } }, rows);
  assert.equal(k2.rho, -1); assert.equal(k2.keepScreen, false, 'an inverted ranking drops the screen');
});

test('mergeInject: a second pass adds its assignments; reference units are never doubled; a name in two files is refused', () => {
  const ref = row => ({ assignment: 'B-ref', row, status: 'reference', basePass: true, rowRefUsd: 0.01, refLatencyMs: 1 });
  const a = { slice: 'H', rows: [ref(1), ref(2), inj('selected', 1, 'flip', true)] }, b = { slice: 'H', rows: [ref(1), ref(2), inj('provisional', 1, 'same', true)] };
  const m = mergeInject([a, b]);
  assert.equal(m.rows.filter(r => r.assignment === 'B-ref').length, 2);
  assert.deepEqual(Object.keys(injectTable(m.rows)).sort(), ['B-ref', 'provisional', 'selected']);
  assert.equal(capabilityRow('provisional', m.rows, [1, 2].map(row => ({ row, basePass: true, refUsd: 0.01, refLatencyMs: 1 }))).units, 2);
  assert.throws(() => mergeInject([a, a]), /in two files/);
  assert.throws(() => mergeInject([a, { ...b, slice: 'C' }]), /different slices/);
});

test('leafDiff: decision leaves only, lists as multisets, tolerant numbers, evidence ignored', () => {
  assert.deepEqual(leafDiff({ a: 'DMY', quote: 'x' }, { a: 'DMY', quote: 'y' }), [], 'an evidence key never counts');
  assert.deepEqual(leafDiff({ l: [{ s: 'A', m: 1 }, { s: 'B', m: 2 }] }, { l: [{ s: 'B', m: 2 }, { s: 'A', m: 1 }] }), [], 'a reordered list is the same answer');
  assert.deepEqual(leafDiff({ v: 100 }, { v: 100.5 }), [], 'within relTol 0.01');
  assert.deepEqual(leafDiff({ date_order: { ATLAS: 'DMY' } }, { date_order: { ATLAS: 'MDY' } }), [{ path: 'date_order/ATLAS', ref: 'DMY', tier: 'MDY' }]);
  const d = leafDiff({ l: [1, 2, 3] }, { l: [1, 2] });
  assert.ok(d.some(x => x.path === 'l[]' && x.ref === 3 && x.tier === 2), 'a dropped list item shows as a length change');
  assert.ok(leafDiff({ k: 'x' }, {}).some(x => x.path === 'k' && x.tier === '(absent)'));
});

test('decodingFor: a Mercury request carries max_tokens equal to the allowance the provider reserves (F2), Claude tiers unchanged', () => {
  const m = openaiChatDecoding(decodingFor('mercury-3'));
  assert.equal(m.maxTokens, DEFAULT_OUTPUT_ALLOWANCE, 'the endpoint is asked for no more output than the run cap reserved for it');
  assert.equal(openaiChatDecoding({ reasoning: 'none' }).maxTokens, 'provider-default', 'the pre-fix request left the output limit to the endpoint (~24K observed)');
  assert.deepEqual(decodingFor('claude-haiku-5-5'), { reasoning: 'none' }, 'the Haiku request is the one every H answer was asked with');
});
