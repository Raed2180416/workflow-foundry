// E-BED §8.1 step 1: the three cards authored blind from outside sources (P58 decision table with hit policies, P59 saga
// planner, P60 SLA / obligation clock), each with the G18 edition convention where it applies. T4-style: each card is an
// executable module with a skeleton and three fixtures (positive, no-match, drift) that run their assembled solve.mjs
// against the real flow-v3 SDK, gateway and call host (stub mode) at $0, the drift fixture deopting with the expected
// kind and name. T3-style: each worked example as a one-node solver fires no checker code, and a mutant per code fires
// exactly that code. Semantics: the hit policies, compensation order and clock rules, run in-process through the same
// skeleton and slot rendering as the assembler (a fake flow whose guard and invariant throw), cross-checked against the
// real runner on every positive fixture. Review of v1 (research/enterprise-20261014/CARDS-P58-P60-REVIEW.md): regression
// tests for the P60 breach instant (R1) and P59 cross-saga keys (R2), boundary cases and a 52-mutant kill check (R3), and
// the card-side readings for the step-3 differential (R4). Freeze: the card files hash to their current entries in
// cards/FROZEN-P58-P60.json (P58 v1, P59 and P60 v2 after amendment A1, v1 kept in history), with a digest copy outside
// cards/, and the catalog is what tools/build-catalog.mjs regenerates. $0; no model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadCard, loadL1, loadCatalog, expandedCard, CARDS_DIR } from '../cards.mjs';
import { checkSlots, assemble, lintFn, HELPERS_SOURCE, fragmentOf, renderSlots, withDefaults } from '../assemble.mjs';
import { runFixture } from '../run.mjs';
import { checkSolver } from '../check.mjs';
import { countTokens, CAP_TABLE } from '../context.mjs';
import { buildIndex } from '../index.mjs';

const EBED = ['P58', 'P59', 'P60'];
const card = Object.fromEntries(EBED.map(id => [id, loadCard(id)]));
const clone = v => JSON.parse(JSON.stringify(v));
const codes = r => [...new Set(r.findings.map(f => f.code))].sort();

// ---- in-process harness: the card's skeleton fragment, the helpers and the rendered slots, as one module ----
class Deopt extends Error { constructor(kind, name, detail) { super(`deopt ${kind}: ${name}`); this.deopt = { kind, name, detail }; } }
const fakeFlow = () => ({
  guard: (name, ok, detail) => { if (!ok) throw new Deopt('guard', name, detail); return true; },
  invariant: (name, ok, detail) => { if (!ok) throw new Deopt('invariant', name, detail); return true; },
  note() {}, flag() {}, step: (name, fn) => fn(),
});
async function solve(c, slots, inputs) {
  const values = withDefaults(c, { ...c.example.slots, ...slots });
  const src = [HELPERS_SOURCE.replace(/^export /gm, ''), fragmentOf(c, 0), `export const S = ${renderSlots(c, values)};`, `export const run = ${c.id}_0;`].join('\n');
  const m = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
  try { return { status: 'ok', output: await m.run(fakeFlow(), { prompt: '', inputs }, inputs, m.S) }; }
  catch (e) { if (e instanceof Deopt) return { status: 'deopt', deopt: e.deopt }; throw e; }
}
const deoptOf = r => (r.status === 'deopt' ? `${r.deopt.kind}/${r.deopt.name}` : `ok ${JSON.stringify(r.output).slice(0, 300)}`);
// Many cases through one module (one skeleton, a rendered S per case): the mutation check below runs every mutant on
// every case. A skeleton that does not import (a broken mutant) throws here rather than counting as a kill.
async function solveAll(c, cases, skeleton = c.skeleton) {
  const Ss = cases.map(k => renderSlots(c, withDefaults(c, { ...c.example.slots, ...(k.slots ?? {}) })));
  const src = [HELPERS_SOURCE.replace(/^export /gm, ''), fragmentOf({ ...c, skeleton }, 0), `export const SS = [${Ss.join(',\n')}];`, `export const run = ${c.id}_0;`].join('\n');
  const m = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
  const out = [];
  for (let i = 0; i < cases.length; i++) {
    const inputs = clone(cases[i].inputs);
    try { out.push({ status: 'ok', output: await m.run(fakeFlow(), { prompt: '', inputs }, inputs, m.SS[i]) }); }
    catch (e) { out.push(e instanceof Deopt ? { status: 'deopt', deopt: e.deopt } : { status: 'error', error: String(e?.message ?? e) }); }
  }
  return out;
}
const sameResult = (a, b) => a.status === b.status && (a.status === 'ok' ? isDeepStrictEqual(a.output, b.output)
  : a.status === 'deopt' ? a.deopt.kind === b.deopt.kind && a.deopt.name === b.deopt.name : a.error === b.error);

// ---- T4-style ----
test('E-bed cards: P58-P60 load as executable L1 cards, each with a skeleton, three fixture kinds and a J1 noul question', () => {
  const l1 = loadL1();
  for (const id of EBED) {
    const c = card[id], entry = l1.find(e => e.id === id);
    assert.ok(c && entry?.executable, `${id} executable`);
    assert.equal(entry.origin, 'authored');
    assert.match(c.skeleton, new RegExp(`export default async function ${id}\\(flow, task, x, S\\)`));
    assert.deepEqual(c.fixtures.map(f => f.name).sort(), ['drift', 'no-match', 'positive']);
    assert.equal(c.fixtures.find(f => f.name === 'drift').expect.status, 'deopt');
    assert.ok(c.when.some(j => j.id === 'J1' && j.type === 'noul'));
    assert.ok(c.checklist.length >= 3 && c.slots.length >= 2);
    const j2 = c.when.find(j => j.type === 'choice');
    assert.ok(j2 && Object.keys(j2.criteria).includes('none'), `${id}: the choice question has a none option`);
  }
});

test('E-bed cards: worked examples pass their slot checks, fn slots lint clean, each assembles, each expanded card fits S6 (<= 1,200 tokens)', () => {
  for (const id of EBED) {
    const c = card[id];
    assert.deepEqual(checkSlots(c, c.example.slots), [], id);
    for (const d of c.slots.filter(d => d.type === 'fn')) assert.equal(lintFn(c.example.slots[d.name]), null, `${id}.${d.name}`);
    for (const [k, src] of Object.entries(c.example.slots.INPUTS ?? {})) assert.equal(lintFn(src), null, `${id}.INPUTS.${k}`);
    const { source, findings } = assemble({ parts: [{ card: c, slots: c.example.slots }] });
    assert.deepEqual(findings, []);
    assert.ok(source.includes(`async function ${id}_0(`) && source.includes('flow.done('));
    const t = countTokens(expandedCard(c));
    assert.ok(t <= CAP_TABLE.S6.parts.expanded, `${id}: ${t} tokens`);
  }
});

for (const id of EBED) {
  test(`E-bed cards: ${id} fixtures (positive, no-match, drift) at $0 through run.mjs, and the in-process harness agrees`, async () => {
    const c = card[id];
    for (const fx of c.fixtures) {
      const r = await runFixture(c, fx);
      assert.ok(r.pass, `${id}/${fx.name}: ${r.problems.join(' | ')}`);
      assert.equal(r.result.liveModelCalls, 0); assert.equal(r.result.spentUsd, 0);
      assert.equal(r.result.overrides.length, 0, 'no judge in these cards');
      if (fx.name === 'drift') assert.equal(r.result.status, 'deopt');
      const h = await solve(c, fx.slots ?? {}, fx.task.inputs);
      assert.equal(h.status, r.result.status, `${id}/${fx.name}: harness status`);
      if (h.status === 'ok') assert.deepEqual(h.output, r.result.output);
      else assert.deepEqual([h.deopt.kind, h.deopt.name], [r.result.deopt.kind, r.result.deopt.name]);
    }
  });
}

// ---- T3-style ----
test('E-bed cards: each worked example as a one-node solver fires no checker code', () => {
  for (const id of EBED) {
    const c = card[id];
    const r = checkSolver({ parts: [{ card: c, slots: c.example.slots }], samples: c.fixtures.map(f => f.task) });
    assert.deepEqual(r.findings, [], id);
    assert.deepEqual(r.unchecked, [], id);
  }
});

const mutant = (id, edit) => { const c = card[id], slots = clone(c.example.slots); edit(slots); return checkSolver({ parts: [{ card: c, slots }], samples: c.fixtures.map(f => f.task) }); };
const MUTANTS = {
  'P58 EFFECT_IN_SOLVER': () => mutant('P58', s => { s.INPUTS.type = "(v) => { fetch('https://fines.invalid/' + v.id); return v.type; }"; }),
  'P58 SLOT_TYPE': () => mutant('P58', s => { s.HIT_POLICY = 'COLLECT_SUM'; }),
  'P58 UNBOUNDED': () => mutant('P58', s => { s.MAX_ITEMS = 50000; }),
  'P59 UNBOUNDED': () => mutant('P59', s => { s.MAX_ATTEMPTS = 11; }),
  'P59 UNBOUNDED (loop)': () => mutant('P59', s => { s.KEY = "(sagaId, step, action) => { let k = sagaId; while (k.length < 40) k += step; return k + action; }"; }),
  'P59 SLOT_MISSING': () => mutant('P59', s => { delete s.STEPS[0].undo; }),
  'P60 CREDENTIAL_LITERAL': () => mutant('P60', s => { s.KIND = "(e) => (e.auth === 'Bearer abcdefghijklmnopqrstu' ? 'created' : e.type)"; }),
  'P60 UNBOUNDED': () => mutant('P60', s => { s.HORIZON_DAYS = 5000; }),
  'P60 SLOT_MISSING': () => mutant('P60', s => { delete s.START_ON; }),
};
for (const [name, run] of Object.entries(MUTANTS)) {
  const code = name.split(' ')[1];
  test(`E-bed cards: mutant ${name} fires exactly ${code}`, () => {
    const r = run();
    assert.deepEqual(codes(r), [code], JSON.stringify(r.findings.map(f => `${f.code} ${f.slot ?? ''}: ${f.detail}`)));
  });
}

// ---- P58 semantics ----
const P58 = card.P58;
const credit = (policy, extra = {}) => ({
  ...extra, HIT_POLICY: policy,
  ITEMS: 'inputs.apps', AS_OF: '(a) => a.date', INPUTS: { score: '(a) => a.score', dti: '(a) => a.dti', bankrupt: '(a) => a.bankrupt' },
  OUTPUTS: [{ name: 'decision', values: ['decline', 'refer', 'accept'] }],
  EDITIONS: { editions: [{ edition: 'e1', effectiveFrom: '2026-01-01', rules: [
    { id: 'accept', when: { score: '>= 600' }, then: { decision: 'accept' } },
    { id: 'refer', when: { dti: '> 0.4' }, then: { decision: 'refer' } },
    { id: 'decline', when: { bankrupt: 'true' }, then: { decision: 'decline' } } ] }] },
});
const app = (id, score, dti, bankrupt = false) => ({ id, date: '2026-05-01', score, dti, bankrupt });
const one = async (slots, item) => solve(P58, slots, { apps: [item] });

test('P58: UNIQUE refuses an overlap (guard hit-policy); ANY accepts equal outputs and refuses different ones', async () => {
  assert.equal(deoptOf(await one(credit('UNIQUE'), app('a', 700, 0.5))), 'guard/hit-policy');
  const ok = await one(credit('UNIQUE'), app('a', 700, 0.1));
  assert.deepEqual(ok.output.decisions[0], { id: 'a', edition: 'e1', rules: ['accept'], result: { decision: 'accept' } });
  assert.equal(deoptOf(await one(credit('ANY'), app('a', 700, 0.5))), 'guard/hit-policy');
  const same = credit('ANY');
  same.EDITIONS.editions[0].rules[1].then.decision = 'accept';
  same.OUTPUTS = [{ name: 'decision' }];
  assert.deepEqual((await one(same, app('a', 700, 0.5))).output.decisions[0], { id: 'a', edition: 'e1', rules: ['accept', 'refer'], result: { decision: 'accept' } });
});

test('P58: FIRST, PRIORITY, RULE_ORDER, OUTPUT_ORDER and COLLECT on the same overlapping case', async () => {
  const item = app('a', 700, 0.5);
  const d = async p => (await one(credit(p), item)).output.decisions[0];
  assert.deepEqual(await d('FIRST'), { id: 'a', edition: 'e1', rules: ['accept'], result: { decision: 'accept' } });
  assert.deepEqual(await d('PRIORITY'), { id: 'a', edition: 'e1', rules: ['refer'], result: { decision: 'refer' } }, 'refer outranks accept in the values list');
  assert.deepEqual(await d('RULE_ORDER'), { id: 'a', edition: 'e1', rules: ['accept', 'refer'], result: [{ decision: 'accept' }, { decision: 'refer' }] });
  assert.deepEqual(await d('OUTPUT_ORDER'), { id: 'a', edition: 'e1', rules: ['refer', 'accept'], result: [{ decision: 'refer' }, { decision: 'accept' }] });
  assert.deepEqual(await d('COLLECT'), { id: 'a', edition: 'e1', rules: ['accept', 'refer'], result: [{ decision: 'accept' }, { decision: 'refer' }] });
  const all3 = app('b', 700, 0.5, true);
  assert.deepEqual((await one(credit('PRIORITY'), all3)).output.decisions[0].result, { decision: 'decline' });
  assert.deepEqual((await one(credit('COLLECT', { AGGREGATION: 'COUNT' }), all3)).output.decisions[0].result, { decision: 3 });
});

const surcharge = (agg, distinct = false) => ({
  ITEMS: 'inputs.apps', AS_OF: '(a) => a.date', INPUTS: { age: '(a) => a.age', claims: '(a) => a.claims' }, OUTPUTS: [{ name: 'fee' }],
  HIT_POLICY: 'COLLECT', AGGREGATION: agg, DISTINCT: distinct,
  EDITIONS: { editions: [{ edition: 'e1', effectiveFrom: '2026-01-01', rules: [
    { id: 'young', when: { age: '< 25' }, then: { fee: 10 } },
    { id: 'claims', when: { claims: '[1..3]' }, then: { fee: 10 } },
    { id: 'many', when: { claims: '> 3' }, then: { fee: 40 } },
    { id: 'base', when: {}, then: { fee: 25 } } ] }] },
});
test('P58: COLLECT SUM / COUNT / MIN / MAX, with DISTINCT making the engine difference explicit', async () => {
  const item = { id: 'p', date: '2026-02-02', age: 22, claims: 2 };   // young (10), claims (10), base (25)
  const r = async (agg, distinct) => (await solve(P58, surcharge(agg, distinct), { apps: [item] })).output.decisions[0].result.fee;
  assert.equal(await r('SUM', false), 45);
  assert.equal(await r('SUM', true), 35);
  assert.equal(await r('COUNT', false), 3);
  assert.equal(await r('COUNT', true), 2);
  assert.equal(await r('MIN', false), 10);
  assert.equal(await r('MAX', false), 25);
});

test('P58: compound outputs: PRIORITY ranks by the first output with a values list, then the next; aggregation and OUTPUT_ORDER are refused', async () => {
  const slots = {
    ITEMS: 'inputs.apps', AS_OF: '(a) => a.date', INPUTS: { score: '(a) => a.score' }, HIT_POLICY: 'PRIORITY',
    OUTPUTS: [{ name: 'route', values: ['manual', 'auto'] }, { name: 'tier', values: ['gold', 'silver'] }],
    EDITIONS: { editions: [{ edition: 'e1', effectiveFrom: '2026-01-01', rules: [
      { id: 'a', when: { score: '> 100' }, then: { route: 'auto', tier: 'gold' } },
      { id: 'b', when: { score: '> 200' }, then: { route: 'manual', tier: 'silver' } },
      { id: 'c', when: { score: '> 300' }, then: { route: 'manual', tier: 'gold' } } ] }] },
  };
  const item = { id: 'x', date: '2026-03-03', score: 400 };
  assert.deepEqual((await solve(P58, slots, { apps: [item] })).output.decisions[0], { id: 'x', edition: 'e1', rules: ['c'], result: { route: 'manual', tier: 'gold' } });
  assert.equal(deoptOf(await solve(P58, { ...slots, HIT_POLICY: 'COLLECT', AGGREGATION: 'COUNT' }, { apps: [item] })), 'invariant/table-well-formed');
  assert.equal(deoptOf(await solve(P58, { ...slots, HIT_POLICY: 'OUTPUT_ORDER' }, { apps: [item] })), 'invariant/table-well-formed');
});

test('P58: the FEEL unary-test subset (intervals, disjunction, not, !=, null, dates) and refusal of anything else', async () => {
  const base = test1 => ({
    ITEMS: 'inputs.apps', AS_OF: '(a) => a.date', INPUTS: { v: '(a) => a.v' }, OUTPUTS: [{ name: 'hit' }], HIT_POLICY: 'FIRST',
    EDITIONS: { editions: [{ edition: 'e1', effectiveFrom: '2026-01-01', rules: [{ id: 'r', when: { v: test1 }, then: { hit: true } }] }] },
  });
  const hit = async (t, v) => { const r = await solve(P58, base(t), { apps: [{ id: 'i', date: '2026-06-01', v }] }); return r.status === 'ok' ? r.output.decisions[0].result !== null : deoptOf(r); };
  assert.equal(await hit(']1..5[', 1), false); assert.equal(await hit(']1..5[', 2), true); assert.equal(await hit('(1..5]', 5), true); assert.equal(await hit('[1..5)', 5), false);
  assert.equal(await hit('"a", "b"', 'b'), true); assert.equal(await hit('not("a", "b")', 'b'), false); assert.equal(await hit('not("a", "b")', 'c'), true);
  assert.equal(await hit('!= "a"', 'b'), true); assert.equal(await hit('"a,b"', 'a,b'), true);
  assert.equal(await hit('null', null), true); assert.equal(await hit('> 3', null), false); assert.equal(await hit('-', null), true);
  assert.equal(await hit('>= date("2026-01-01")', '2026-03-01'), true); assert.equal(await hit('[date("2026-01-01")..date("2026-01-31")]', '2026-02-01'), false);
  assert.equal(await hit('> 5', '7'), 'guard/input-type', 'a number arriving as text deopts (FEEL would give null and silently not match)');
  assert.equal(await hit('> 5', undefined), 'guard/input-present');
  for (const bad of ['> 5 and < 9', 'contains(?, "x")', 'date("2026-02-30")', '[5..1]', '< true', 'foo']) assert.equal(await hit(bad, 7), 'invariant/table-well-formed', bad);
});

test('P58: G18 editions: effectiveFrom inclusive, effectiveTo exclusive, a gap deopts, an overlap or a malformed edition list is refused', async () => {
  const eds = editions => ({ ...P58.example.slots, EDITIONS: { editions } });
  const rules = P58.example.slots.EDITIONS.editions[0].rules;
  const gap = eds([{ edition: 'a', effectiveFrom: '2026-01-01', effectiveTo: '2026-03-01', rules }, { edition: 'b', effectiveFrom: '2026-04-01', rules }]);
  const v = date => ({ violations: [{ id: 'v', date, type: 'parking', actualSpeed: null, speedLimit: null }] });
  assert.equal((await solve(P58, gap, v('2026-02-28'))).output.decisions[0].edition, 'a');
  assert.equal(deoptOf(await solve(P58, gap, v('2026-03-01'))), 'guard/edition-in-force');
  assert.equal((await solve(P58, gap, v('2026-04-01'))).output.decisions[0].edition, 'b');
  assert.equal(deoptOf(await solve(P58, gap, v('2025-12-31'))), 'guard/edition-in-force');
  assert.equal(deoptOf(await solve(P58, gap, v('2026-13-01'))), 'guard/as-of-date');
  const overlap = eds([{ edition: 'a', effectiveFrom: '2026-01-01', effectiveTo: '2026-05-01', rules }, { edition: 'b', effectiveFrom: '2026-04-01', rules }]);
  assert.equal(deoptOf(await solve(P58, overlap, v('2026-02-01'))), 'invariant/table-well-formed');
  const openFirst = eds([{ edition: 'a', effectiveFrom: '2026-01-01', rules }, { edition: 'b', effectiveFrom: '2026-04-01', rules }]);
  assert.equal(deoptOf(await solve(P58, openFirst, v('2026-02-01'))), 'invariant/table-well-formed');
  assert.equal(deoptOf(await solve(P58, { ...P58.example.slots, ON_NO_MATCH: 'deopt' }, { violations: [{ id: 'v', date: '2026-09-01', type: 'speed', actualSpeed: 135, speedLimit: 130 }] })), 'guard/table-complete');
});

// ---- P59 semantics ----
const P59 = card.P59;
const ev = (step, event, error) => ({ step, event, ...(error ? { error } : {}) });
const done = (...steps) => steps.flatMap(s => [ev(s, 'start'), ev(s, 'ok')]);
const saga = (id, log, definition = 'order-v2') => ({ id, definition, log });
const plan = async (log, slots = {}) => { const r = await solve(P59, slots, { orders: [saga('s', log)] }); return r.status === 'ok' ? r.output.plans[0] : deoptOf(r); };

test('P59: reverse order of completion; PARALLEL_UNDO issues every ready undo at once; COMPENSATE_FAILED never / always', async () => {
  const log = [...done('reserve-stock', 'authorize-card'), ev('book-courier', 'start'), ev('book-courier', 'error', 'timeout')];
  const par = await plan(log, { PARALLEL_UNDO: true });
  assert.deepEqual(par.next.map(c => [c.step, c.call, c.key]), [['book-courier', 'cancel-courier', 's:book-courier:undo'], ['authorize-card', 'void-authorization', 's:authorize-card:undo'], ['reserve-stock', 'release-stock', 's:reserve-stock:undo']]);
  assert.deepEqual((await plan(log, { COMPENSATE_FAILED: 'never' })).undoOrder, ['authorize-card', 'reserve-stock']);
  const declined = [...done('reserve-stock'), ev('authorize-card', 'start'), ev('authorize-card', 'error', 'declined')];
  assert.deepEqual((await plan(declined)).undoOrder, ['reserve-stock'], 'a certain no-effect failure is not undone under if-uncertain');
  assert.deepEqual((await plan(declined, { COMPENSATE_FAILED: 'always' })).undoOrder, ['authorize-card', 'reserve-stock']);
  // Sequential: the next undo waits until the previous one reports.
  const inFlight = await plan([...log, ev('book-courier', 'undo')]);
  assert.deepEqual([inFlight.status, inFlight.next, inFlight.waitingFor], ['compensating', [], ['book-courier']]);
  const second = await plan([...log, ev('book-courier', 'undo'), ev('book-courier', 'undo-ok')]);
  assert.deepEqual(second.next.map(c => [c.action, c.step, c.attempt]), [['undo', 'authorize-card', 1]]);
});

test('P59: a pivot that fails with no effect dooms the saga; with an uncertain outcome it is retried under the same key; retries are bounded', async () => {
  const upTo = done('reserve-stock', 'authorize-card', 'book-courier');
  const noEffect = await plan([...upTo, ev('capture-payment', 'start'), ev('capture-payment', 'error', 'declined')]);
  assert.deepEqual([noEffect.status, noEffect.undoOrder], ['compensating', ['book-courier', 'authorize-card', 'reserve-stock']]);
  const t = ev('capture-payment', 'error', 'timeout'), s = ev('capture-payment', 'start');
  const retry = await plan([...upTo, s, t, s, t]);
  assert.deepEqual(retry.next, [{ action: 'do', step: 'capture-payment', call: 'capture-payment', key: 's:capture-payment:do', attempt: 3 }]);
  const stuck = await plan([...upTo, s, t, s, t, s, t]);
  assert.deepEqual([stuck.status, stuck.next, stuck.stuck], ['stuck', [], { step: 'capture-payment', action: 'do', attempts: 3 }]);
  const u = ev('reserve-stock', 'undo'), ue = ev('reserve-stock', 'undo-error');
  const undoStuck = await plan([...done('reserve-stock'), ev('authorize-card', 'start'), ev('authorize-card', 'error', 'declined'), u, ue, u, ue, u, ue]);
  assert.deepEqual([undoStuck.status, undoStuck.stuck], ['stuck', { step: 'reserve-stock', action: 'undo', attempts: 3 }]);
});

test('P59: a log that contradicts the definition deopts; a key function that collides is refused; steps must be ordered', async () => {
  assert.equal(await plan([ev('authorize-card', 'start')]), 'guard/log-consistent', 'started before the previous step completed');
  assert.equal(await plan([ev('reserve-stock', 'ok')]), 'guard/log-consistent', 'completed without a start');
  assert.equal(await plan([ev('fraud-check', 'start')]), 'guard/known-entry');
  assert.equal(await plan([ev('reserve-stock', 'begin')]), 'guard/known-entry');
  const log = [...done('reserve-stock', 'authorize-card'), ev('book-courier', 'start'), ev('book-courier', 'error', 'timeout')];
  assert.equal(await plan([...log, ev('reserve-stock', 'undo')]), 'guard/log-consistent', 'undo out of reverse order');
  assert.equal(await plan([...log, ev('capture-payment', 'start')]), 'guard/log-consistent', 'a step started after compensation began');
  assert.equal(await plan(log, { KEY: '(sagaId, step, action) => sagaId + action' }), 'invariant/keys-distinct');
  const steps = clone(P59.example.slots.STEPS); [steps[0], steps[4]] = [steps[4], steps[0]];
  assert.equal(await plan([], { STEPS: steps }), 'invariant/steps-well-formed');
  // Determinism: the same log plans the same commands with the same keys.
  assert.deepEqual(await plan(log), await plan(log));
});

// ---- P60 semantics ----
const P60 = card.P60;
const week = w => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map(d => [d, [w]]));
const CAL = { timezone: 'Europe/London', editions: [{ edition: 'c', effectiveFrom: '2026-01-01', week: week(['09:00', '17:00']), holidays: ['2026-12-25'] }] };
const POL = { editions: [{ edition: 'p', effectiveFrom: '2026-01-01', targets: { P1: 120, P2: 480 }, warnings: [0.5] }] };
const tick = (at, type, to) => ({ at, type, ...(to ? { to } : {}) });
const clk = async (events, asOf, slots = {}, priority = 'P1') => {
  const r = await solve(P60, { CALENDAR: CAL, POLICY: POL, ...slots }, { asOf, tickets: [{ id: 't', priority, events }] });
  return r.status === 'ok' ? r.output.clocks[0] : deoptOf(r);
};

test('P60: business time across the October DST change in Europe/London (Fri BST to Mon GMT) and over a holiday', async () => {
  const k = await clk([tick('2026-10-23T16:00:00+01:00', 'created'), tick('2026-10-26T10:00:00Z', 'status', 'resolved')], '2026-10-26T12:00:00Z');
  assert.deepEqual([k.elapsedMinutes, k.state, k.met, k.breached, k.dueAt], [120, 'stopped', true, false, '2026-10-26T10:00:00.000Z'], 'exactly on target is met, not breached');
  const xmas = await clk([tick('2026-12-24T16:00:00Z', 'created')], '2026-12-28T10:00:00Z', {}, 'P2');
  assert.deepEqual([xmas.elapsedMinutes, xmas.state, xmas.dueAt], [120, 'running', '2026-12-28T16:00:00.000Z'], 'Thu 24th 16-17, Fri 25th a holiday, Mon 28th 09-10; 360 more is 16:00');
});

test('P60: pause / resume no-ops, stop while paused, start after stop, timestamps, events after AS_OF, unknown targets', async () => {
  const evs = [tick('2026-10-14T09:00:00+01:00', 'created'), tick('2026-10-14T09:30:00+01:00', 'status', 'in-progress'), tick('2026-10-14T10:00:00+01:00', 'status', 'waiting-customer'),
    tick('2026-10-14T10:15:00+01:00', 'status', 'waiting-customer'), tick('2026-10-14T11:00:00+01:00', 'status', 'resolved')];
  const k = await clk(evs, '2026-10-14T15:00:00+01:00');
  assert.deepEqual([k.state, k.elapsedMinutes, k.met, k.warnings], ['stopped', 60, true, [{ fraction: 0.5, reached: true, at: '2026-10-14T09:00:00.000Z' }]]);
  assert.equal(await clk([...evs, tick('2026-10-14T12:00:00+01:00', 'created')], '2026-10-14T15:00:00+01:00'), 'guard/single-cycle');
  assert.equal(await clk([tick('2026-10-14 09:00', 'created')], '2026-10-14T15:00:00+01:00'), 'guard/event-time');
  assert.equal(await clk([tick('2026-02-30T09:00:00Z', 'created')], '2026-10-14T15:00:00+01:00'), 'guard/event-time', 'V8 would roll Feb 30 over to Mar 2');
  assert.equal(await clk([tick('2026-10-13T24:00:00Z', 'created')], '2026-10-14T15:00:00+01:00'), 'guard/event-time');
  assert.equal(await clk([tick('2026-10-14T16:00:00+01:00', 'created')], '2026-10-14T15:00:00+01:00'), 'guard/not-after-as-of');
  assert.equal(await clk([tick('2026-10-14T09:00:00+01:00', 'created')], '2026-10-14T15:00:00+01:00', {}, 'P0'), 'guard/target-known');
  assert.equal(await clk([], '2026-10-14 15:00'), 'guard/as-of-time');
});

test('P60: a 24x7 calendar counts wall time; breach while running projects nothing past it; the horizon bounds a projection', async () => {
  const always = { timezone: 'UTC', editions: [{ edition: 'all', effectiveFrom: '2026-01-01', week: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => [d, [['00:00', '24:00']]])) }] };
  const k = await clk([tick('2026-10-17T22:00:00Z', 'created')], '2026-10-18T01:00:00Z', { CALENDAR: always });
  assert.deepEqual([k.elapsedMinutes, k.breached, k.remainingMinutes, k.dueAt], [180, true, -60, '2026-10-18T00:00:00.000Z']);
  const closed = { timezone: 'UTC', editions: [{ edition: 'none', effectiveFrom: '2026-01-01', week: {} }] };
  assert.equal(await clk([tick('2026-10-14T09:00:00Z', 'created')], '2026-10-14T10:00:00Z', { CALENDAR: closed, HORIZON_DAYS: 30 }), 'guard/within-horizon');
  const gap = { timezone: 'UTC', editions: [{ edition: 'a', effectiveFrom: '2026-01-01', effectiveTo: '2026-10-14', week: week(['09:00', '17:00']) }] };
  assert.equal(await clk([tick('2026-10-13T16:00:00Z', 'created')], '2026-10-14T10:00:00Z', { CALENDAR: gap }), 'guard/calendar-edition-in-force');
  assert.equal(await clk([], '2026-10-14T10:00:00Z', { CALENDAR: { ...CAL, timezone: 'Mars/Olympus' } }), 'invariant/calendar-well-formed');
  assert.equal(await clk([], '2026-10-14T10:00:00Z', { PAUSE_ON: ['created'] }), 'invariant/event-sets-disjoint');
});

// ---- review of v1 (research/enterprise-20261014/CARDS-P58-P60-REVIEW.md): regression tests for the fixed findings ----
// R1 (P1): v1 P60 compared business minutes (elapsed > target), so a target reached at the end of a business window was
// not breached until the next window opened, although dueAt had passed. v2 compares instants.
test('P60 v2 (review R1): breach is the clock running past dueAt, also outside business hours; exactly at dueAt is on time', async () => {
  const start = tick('2026-10-14T15:00:00+01:00', 'created'), due = '2026-10-14T16:00:00.000Z';   // Wed 15:00 BST + 120 business minutes on 09-17
  const at = async (events, asOf) => { const k = await clk(events, asOf); return [k.state, k.elapsedMinutes, k.remainingMinutes, k.met, k.breached, k.dueAt]; };
  assert.deepEqual(await at([start], '2026-10-14T17:00:00+01:00'), ['running', 120, 0, false, false, due], 'a wake-up at dueAt reads not breached');
  assert.deepEqual(await at([start], '2026-10-14T17:00:01+01:00'), ['running', 120, 0, false, true, due], 'one second later it reads breached');
  assert.deepEqual(await at([start], '2026-10-14T18:00:00+01:00'), ['running', 120, 0, false, true, due], 'v1: breached false at 18:00 with dueAt past');
  assert.deepEqual(await at([start, tick('2026-10-14T18:00:00+01:00', 'status', 'resolved')], '2026-10-15T12:00:00+01:00'), ['stopped', 120, 0, false, true, due], 'v1: met');
  assert.deepEqual(await at([start, tick('2026-10-15T08:59:00+01:00', 'status', 'resolved')], '2026-10-15T12:00:00+01:00'), ['stopped', 120, 0, false, true, due], 'v1: met the next morning');
  assert.deepEqual(await at([start, tick('2026-10-14T17:00:00+01:00', 'status', 'resolved')], '2026-10-15T12:00:00+01:00'), ['stopped', 120, 0, true, false, due], 'stopped exactly at dueAt: met');
  const wait = t => tick(t, 'status', 'waiting-customer');
  assert.deepEqual(await at([start, wait('2026-10-14T17:00:00+01:00')], '2026-10-15T10:00:00+01:00'), ['paused', 120, 0, false, false, due], 'paused exactly at dueAt');
  assert.deepEqual(await at([start, wait('2026-10-14T17:30:00+01:00')], '2026-10-15T10:00:00+01:00'), ['paused', 120, 0, false, true, due], 'paused after dueAt');
  assert.deepEqual(await at([start, wait('2026-10-14T17:00:00+01:00'), tick('2026-10-15T09:30:00+01:00', 'status', 'in-progress')], '2026-10-15T09:31:00+01:00'), ['running', 121, -1, false, true, due]);
});

// R2 (P1): v1 P59 checked key distinctness within one saga, so KEY = step + action gave two sagas the same key.
test('P59 v2 (review R2): idempotency keys are distinct across sagas and name their saga', async () => {
  const run = async (ids, KEY) => solve(P59, KEY ? { KEY } : {}, { orders: ids.map(id => saga(id, [])) });
  const why = r => (r.status === 'deopt' ? `${r.deopt.kind}/${r.deopt.name}: ${r.deopt.detail.why ?? ''}` : 'ok');
  const noSaga = "(sagaId, step, action) => step + ':' + action";
  assert.equal(why(await run(['o-1', 'o-2'], noSaga)), 'invariant/keys-distinct: the key does not name the saga', 'v1 returned ok with both next[0].key = reserve-stock:do');
  assert.equal(why(await run(['o-1'], noSaga)), 'invariant/keys-distinct: the key does not name the saga', 'refused in a run of one saga too');
  const stem = "(sagaId, step, action) => sagaId.replace(/-\\d+$/, '') + ':' + step + ':' + action";   // drops the number: o-1 and o-2 collide
  assert.equal(why(await run(['o-1'], stem)), 'ok');
  const two = await run(['o-1', 'o-2'], stem);
  assert.equal(why(two), 'invariant/keys-distinct: two sagas share a key');
  assert.deepEqual([two.deopt.detail.id, two.deopt.detail.other, two.deopt.detail.key], ['o-2', 'o-1', 'o:reserve-stock:do']);
  const ok = await run(['o-1', 'o-2']);
  assert.deepEqual(ok.output.plans.map(p => p.next[0].key), ['o-1:reserve-stock:do', 'o-2:reserve-stock:do']);
});

const FEEL_TABLE = {
  ITEMS: 'inputs.apps', AS_OF: '(a) => a.date', INPUTS: { v: '(a) => a.v', n: '(a) => a.n' }, OUTPUTS: [{ name: 'hit' }], HIT_POLICY: 'RULE_ORDER',
  EDITIONS: { editions: [{ edition: 'e1', effectiveFrom: '2026-01-01', rules: [
    ['le', { v: '<= 5' }], ['lt', { v: '< 5' }], ['ge', { v: '>= 5' }], ['gt', { v: '> 5' }], ['lo-closed', { v: '[5..9]' }], ['lo-open', { v: '(5..9]' }],
    ['hi-closed', { v: '[1..5]' }], ['hi-open', { v: '[1..5)' }], ['ne-null', { n: '!= 5' }], ['eq-null', { n: 'null' }], ['dash', { n: '-' }],
  ].map(([id, when]) => ({ id, when, then: { hit: id } })) }] },
};

// R3 (P1): the v1 fixtures and suite left four semantic mutants alive (relational boundaries, != on null, unsorted
// events). Hand-computed boundary cases first; then the whole mutant set must die.
test('P58 (review R3): relational boundaries in the worked table and the FEEL subset; != on a null input', async () => {
  const fine = async (date, actualSpeed, speedLimit) => (await solve(P58, {}, { violations: [{ id: 'b', date, type: 'speed', actualSpeed, speedLimit }] })).output.decisions[0];
  assert.deepEqual(await fine('2026-03-01', 150, 120), { id: 'b', edition: 'fines-2020', rules: ['r2'], result: { amount: 1000, points: 7 } }, '>= 30 at 30');
  assert.deepEqual(await fine('2026-08-01', 180, 130), { id: 'b', edition: 'fines-2026-07', rules: ['r3'], result: { amount: 2000, points: 12 } }, '>= 50 at 50');
  assert.deepEqual(await fine('2026-08-01', 179, 130), { id: 'b', edition: 'fines-2026-07', rules: ['r2'], result: { amount: 1200, points: 7 } }, '[30..50) at 49');
  const hits = async (v, n) => (await solveAll(P58, [{ slots: FEEL_TABLE, inputs: { apps: [{ id: 'i', date: '2026-06-01', v, n }] } }]))[0].output.decisions[0].rules;
  assert.deepEqual(await hits(5, null), ['le', 'ge', 'lo-closed', 'hi-closed', 'ne-null', 'eq-null', 'dash']);
  assert.deepEqual(await hits(6, 5), ['ge', 'gt', 'lo-closed', 'lo-open', 'dash']);
  assert.deepEqual(await hits(4, 4), ['le', 'lt', 'hi-closed', 'hi-open', 'ne-null', 'dash']);
});

test('P60 (review R3): events are replayed in time order, whatever their input order', async () => {
  const evs = [tick('2026-10-14T11:00:00+01:00', 'status', 'resolved'), tick('2026-10-14T10:00:00+01:00', 'status', 'waiting-customer'), tick('2026-10-14T09:00:00+01:00', 'created')];
  const k = await clk(evs, '2026-10-14T15:00:00+01:00');
  assert.deepEqual([k.state, k.elapsedMinutes, k.met, k.breached], ['stopped', 60, true, false]);
});

// The mutant set: the review's 48 semantic mutants (its scratch runner, re-applied to the current skeletons; P60's
// breach mutants rewritten for v2) plus mutants of the v2 fixes. Each must die on the fixtures plus the cases below.
const MUTATIONS = {
  P58: {
    'any-guard-deleted': [["if (P === 'ANY') flow.gua", 'if (false) flow.gua']],
    'dash-rejects-null': [['if (test === null) return true;', 'if (test === null) return v !== null;']],
    'distinct-ignored': [['const vals = S.DISTINCT ? vals0', 'const vals = false ? vals0']],
    'edition-by-run-date': [['const asOf = S.AS_OF(it);', "const asOf = '2026-10-14';"]],
    'edition-latest': [['const ed = table.find(e => e.effectiveFrom <= asOf && (e.effectiveTo === null || asOf < e.effectiveTo));', 'const ed = table[table.length - 1];']],
    'first-takes-last': [['rules: [hits[0].id], result: resultOf(hits[0]) };', 'rules: [hits[hits.length - 1].id], result: resultOf(hits[hits.length - 1]) };']],
    'from-exclusive': [['table.find(e => e.effectiveFrom <= asOf', 'table.find(e => e.effectiveFrom < asOf']],
    'ge-to-gt': [[": u.op === '>' ? lt(a, v) : !lt(v, a);", ": u.op === '>' ? lt(a, v) : lt(a, v);"]],
    'hi-closed-swap': [['(u.hiClosed ? !lt(u.hi.v, v) : lt(v, u.hi.v))', '(u.hiClosed ? lt(v, u.hi.v) : !lt(u.hi.v, v))']],
    'le-to-lt': [["u.op === '<=' ? !lt(a, v)", "u.op === '<=' ? lt(v, a)"]],
    'lo-closed-swap': [['(u.loClosed ? !lt(v, u.lo.v) : lt(u.lo.v, v))', '(u.loClosed ? lt(u.lo.v, v) : !lt(v, u.lo.v))']],
    'mismatch-guard-deleted': [["flow.guard('input-type', !mismatches.length,", "flow.guard('input-type', true,"]],
    'no-match-deopt-deleted': [["flow.guard('table-complete', S.ON_NO_MATCH !== 'deopt',", "flow.guard('table-complete', true,"]],
    'null-never-matches-ne': [["if (v === null) return u.op === '!=';", 'if (v === null) return false;']],
    'output-order-unsorted': [["const listed = P === 'OUTPUT_ORDER' ? [...hits].sort(byPriority) : hits;", 'const listed = hits;']],
    'priority-reversed': [['const w = [...hits].sort(byPriority)[0];', 'const w = [...hits].sort((a, b) => byPriority(b, a))[0];']],
    'scalar-guard-deleted': [["flow.guard('input-type', scalar(v[k]),", "flow.guard('input-type', true,"]],
    'to-inclusive': [['(e.effectiveTo === null || asOf < e.effectiveTo)', '(e.effectiveTo === null || asOf <= e.effectiveTo)']],
    'unique-guard-deleted': [["if (P === 'UNIQUE') flow.gua", 'if (false) flow.gua']],
  },
  P59: {
    'attempt-not-incremented': [["cmd('do', n, st[n].tries + 1)", "cmd('do', n, st[n].tries || 1)"]],
    'failed-step-never-undone': [['|| (n === doomed && kindOf', '|| (false && kindOf']],
    'forward-order-compensation': [['sort((a, b) => st[b].at - st[a].at)', 'sort((a, b) => st[a].at - st[b].at)']],
    'forward-order-no-invariant': [['sort((a, b) => st[b].at - st[a].at)', 'sort((a, b) => st[a].at - st[b].at)'], ["flow.invariant('undo-reverse-order', order.every", "flow.invariant('undo-reverse-order', true || order.every"]],
    'key-per-attempt': [['key: S.KEY(sg.id, step, action), attempt', "key: S.KEY(sg.id, step, action) + ':' + attempt, attempt"]],
    'max-attempts-off-by-one': [["st[n].s === 'failed' && st[n].tries >= S.MAX_ATTEMPTS", "st[n].s === 'failed' && st[n].tries > S.MAX_ATTEMPTS"]],
    'no-wait-for-inflight': [['S.PARALLEL_UNDO ? ready : out.waitingFor.length ? [] : ready.slice(0, 1)', 'S.PARALLEL_UNDO ? ready : ready.slice(0, 1)']],
    'parallel-ignored': [['out.next = (S.PARALLEL_UNDO ? ready :', 'out.next = (false ? ready :']],
    'pin-guard-deleted': [["flow.guard('definition-pinned', sg.definition === S.VERSION,", "flow.guard('definition-pinned', true,"]],
    'pivot-never-dooms': [["|| (kindOf[n] === 'pivot' && st[n].noEffect);", '|| (false);']],
    'retry-compensable-instead': [["const dooms = n => kindOf[n] === 'compensable' ||", 'const dooms = n => false ||']],
    'uncertain-pivot-dooms': [["(kindOf[n] === 'pivot' && st[n].noEffect);", "(kindOf[n] === 'pivot');"]],
    'undo-max-off-by-one': [['st[n].utries >= S.MAX_ATTEMPTS', 'st[n].utries > S.MAX_ATTEMPTS']],
    'v2-keys-probe-deleted': [["flow.invariant('keys-distinct', !keys.some(k => probe.has(k)),", "flow.invariant('keys-distinct', true,"]],
    'v2-keys-across-sagas-deleted': [["flow.invariant('keys-distinct', clash === undefined,", "flow.invariant('keys-distinct', true,"]],
  },
  P60: {
    'after-asof-allowed': [["flow.guard('not-after-as-of', at <= asOf,", "flow.guard('not-after-as-of', true,"]],
    'calendar-by-asof-date': [['inForce(S.CALENDAR.editions, d);', 'inForce(S.CALENDAR.editions, localDate(asOf));']],
    'calendar-by-start-date': [['const calendarUsed = new Set();', 'const calendarUsed = new Set(); let __sd = null;'], ['inForce(S.CALENDAR.editions, d);', 'inForce(S.CALENDAR.editions, __sd ?? d);'], ['const key = S.TARGET_KEY(c);', 'const key = S.TARGET_KEY(c); __sd = localDate(startAt);']],
    'events-unsorted': [['}).sort((a, b) => a.at - b.at || a.i - b.i);', '});']],
    'holidays-ignored': [['if ((ed.holidays ?? []).includes(d)) return [];', '']],
    'pause-ignored': [["if (e.action === 'pause' && state === 'running') {", 'if (false) {']],
    'paused-projects': [["reach(running, need) : state === 'running' ? project(asOf, need - elapsed) : null);", 'reach(running, need) : project(asOf, need - elapsed));']],
    'policy-by-asof': [['inForce(S.POLICY.editions, localDate(startAt));', 'inForce(S.POLICY.editions, localDate(asOf));']],
    'reopen-ignored': [["flow.guard('single-cycle', e.action !== 'start',", "flow.guard('single-cycle', true,"]],
    'resume-ignored': [["else if (e.action === 'resume' && state === 'paused') {", 'else if (false) {']],
    'stop-counts-pause': [["if (e.action === 'stop') { if (state === 'running') running.push", "if (e.action === 'stop') { running.push"]],
    'unknown-event-ignored': [["flow.guard('known-event', typeof name === 'string' && actionOf[name] !== undefined,", "flow.guard('known-event', true,"]],
    'utc-calendar': [["new Intl.DateTimeFormat('en-US', { timeZone: tz,", "new Intl.DateTimeFormat('en-US', { timeZone: 'UTC',"]],
    'wall-time': [['running.reduce((n, [a, b]) => n + segments(a, b).reduce((m, [s, e]) => m + e - s, 0), 0);', 'running.reduce((n, [a, b]) => n + b - a, 0);']],
    'warning-strict': [['reached: elapsed >= need,', 'reached: elapsed > need,']],
    'v2-breach-by-business-time': [['const breached = due !== null && ranUntil > due;', 'const breached = elapsed > target;']],
    'v2-breach-inclusive': [['ranUntil > due;', 'ranUntil >= due;']],
    'v2-breach-at-as-of': [['ranUntil = running.length ? running[running.length - 1][1] : startAt;', 'ranUntil = asOf;']],
  },
};
const mutate = (src, edits, label) => edits.reduce((s, [a, b]) => {
  assert.equal(s.split(a).length - 1, 1, `${label}: the mutation site must occur exactly once: ${a}`);
  return s.replace(a, () => b);
}, src);

// The cases that, with the fixtures, must kill every mutant (each hand-checked in the semantic tests above).
const credit2 = (policy, extra) => ({ slots: credit(policy, extra), inputs: { apps: [app('a', 700, 0.5), app('b', 700, 0.5, true), app('c', 700, 0.1)] } });
const P59_LOG = [...done('reserve-stock', 'authorize-card'), ev('book-courier', 'start'), ev('book-courier', 'error', 'timeout')];
const pivotTry = [ev('capture-payment', 'start'), ev('capture-payment', 'error', 'timeout')];
const undoTry = [ev('reserve-stock', 'undo'), ev('reserve-stock', 'undo-error')];
const sagas = (...logs) => ({ orders: logs.map((log, i) => saga(`s${i}`, log)) });
const clockCase = (events, asOf, slots = {}) => ({ slots: { CALENDAR: CAL, POLICY: POL, ...slots }, inputs: { asOf, tickets: [{ id: 't', priority: 'P1', events }] } });
const KILLERS = {
  P58: [
    { inputs: { violations: [{ id: 'b1', date: '2026-03-01', type: 'speed', actualSpeed: 150, speedLimit: 120 }, { id: 'b2', date: '2026-08-01', type: 'speed', actualSpeed: 180, speedLimit: 130 }] } },
    { slots: FEEL_TABLE, inputs: { apps: [{ id: 'i', date: '2026-06-01', v: 5, n: null }, { id: 'j', date: '2026-06-01', v: 6, n: 5 }, { id: 'k', date: '2026-06-01', v: 4, n: 4 }] } },
    ...['UNIQUE', 'ANY', 'FIRST', 'PRIORITY', 'OUTPUT_ORDER', 'RULE_ORDER'].map(p => credit2(p)), credit2('COLLECT', { AGGREGATION: 'COUNT' }),
    { slots: surcharge('SUM', true), inputs: { apps: [{ id: 'p', date: '2026-02-02', age: 22, claims: 2 }] } },
    { slots: { ON_NO_MATCH: 'deopt' }, inputs: { violations: [{ id: 'v', date: '2026-09-01', type: 'speed', actualSpeed: 135, speedLimit: 130 }] } },
    { slots: { INPUTS: { type: '(v) => v.type', overSpeed: '(v) => (v.type === "speed" ? String(v.actualSpeed - v.speedLimit) : null)' } }, inputs: { violations: [{ id: 'v', date: '2026-09-01', type: 'speed', actualSpeed: 145, speedLimit: 130 }] } },
  ],
  P59: [
    { inputs: sagas([...done('reserve-stock', 'authorize-card', 'book-courier'), ev('capture-payment', 'start'), ev('capture-payment', 'error', 'declined')]) },
    { inputs: sagas([...done('reserve-stock', 'authorize-card', 'book-courier'), ...pivotTry, ...pivotTry], [...done('reserve-stock', 'authorize-card', 'book-courier'), ...pivotTry, ...pivotTry, ...pivotTry]) },
    { inputs: sagas([...done('reserve-stock'), ev('authorize-card', 'start'), ev('authorize-card', 'error', 'declined'), ...undoTry, ...undoTry, ...undoTry]) },
    { inputs: sagas([...P59_LOG, ev('book-courier', 'undo')]) },
    { slots: { PARALLEL_UNDO: true }, inputs: sagas(P59_LOG) },
    { slots: { KEY: "(sagaId, step, action) => step + ':' + action" }, inputs: { orders: [saga('o-1', [])] } },
    { slots: { KEY: "(sagaId, step, action) => sagaId.replace(/-\\d+$/, '') + ':' + step + ':' + action" }, inputs: { orders: [saga('o-1', []), saga('o-2', [])] } },
  ],
  P60: [
    clockCase([tick('2026-10-14T11:00:00+01:00', 'status', 'resolved'), tick('2026-10-14T10:00:00+01:00', 'status', 'waiting-customer'), tick('2026-10-14T09:00:00+01:00', 'created')], '2026-10-14T15:00:00+01:00'),
    clockCase([tick('2026-10-14T15:00:00+01:00', 'created')], '2026-10-14T18:00:00+01:00'),
    clockCase([tick('2026-10-14T15:00:00+01:00', 'created'), tick('2026-10-14T17:00:00+01:00', 'status', 'waiting-customer')], '2026-10-15T10:00:00+01:00'),
    clockCase([tick('2026-10-23T16:00:00+01:00', 'created'), tick('2026-10-26T10:00:00Z', 'status', 'resolved')], '2026-10-26T12:00:00Z'),
    clockCase([tick('2026-10-14T09:00:00+01:00', 'created'), tick('2026-10-14T10:00:00+01:00', 'status', 'resolved')], '2026-10-14T15:00:00+01:00'),
    clockCase([tick('2026-10-14T16:00:00+01:00', 'created')], '2026-10-14T15:00:00+01:00'),
    clockCase([tick('2026-10-14T09:00:00+01:00', 'created'), tick('2026-10-14T10:00:00+01:00', 'status', 'resolved'), tick('2026-10-14T11:00:00+01:00', 'created')], '2026-10-14T15:00:00+01:00'),
  ],
};

test('E-bed cards (review R3, E-BED §9.5): every semantic mutant dies on the fixtures plus the boundary cases; the identity mutant lives', async t => {
  const report = {};
  for (const id of EBED) {
    const c = card[id], fx = c.fixtures.map(f => ({ slots: f.slots ?? {}, inputs: f.task.inputs }));
    const cases = [...fx, ...KILLERS[id]];
    const base = await solveAll(c, cases);
    base.forEach((r, i) => assert.notEqual(r.status, 'error', `${id} case ${i}: ${r.error}`));
    fx.forEach((_, i) => { const f = c.fixtures[i]; assert.equal(base[i].status, f.expect.status, `${id}/${f.name}`); });
    const same = await solveAll(c, cases, `${c.skeleton}\n// identity mutant\n`);
    assert.ok(same.every((r, i) => sameResult(r, base[i])), `${id}: the identity mutant must survive (the comparison is sound)`);
    let byFixtures = 0;
    for (const [name, edits] of Object.entries(MUTATIONS[id])) {
      const got = await solveAll(c, cases, mutate(c.skeleton, edits, `${id} ${name}`));
      const killers = got.map((r, i) => (sameResult(r, base[i]) ? null : i)).filter(i => i !== null);
      assert.ok(killers.length > 0, `${id} mutant ${name} survives the fixtures and the boundary cases`);
      if (killers[0] < fx.length) byFixtures++;
    }
    report[id] = `${Object.keys(MUTATIONS[id]).length} killed, ${byFixtures} by the frozen fixtures alone`;
  }
  t.diagnostic(JSON.stringify(report));
});

// R4 (cross-part; the differential itself belongs to the step-3 owner): four card readings the review asked to pin as
// ledger rows before the step-3 differential runs. Pinned here so a change to any of them is a visible card change.
test('E-bed cards (review R4): card-side ledger readings for the step-3 differential', async () => {
  const dash = await solveAll(P58, [{ slots: FEEL_TABLE, inputs: { apps: [{ id: 'i', date: '2026-06-01', v: 0, n: null }] } }]);
  assert.ok(dash[0].output.decisions[0].rules.includes('dash'), 'reading 1: the dash matches a null input');
  const compound = { ...credit('OUTPUT_ORDER'), OUTPUTS: [{ name: 'decision', values: ['decline', 'refer', 'accept'] }, { name: 'tier', values: ['a', 'b'] }] };
  compound.EDITIONS = { editions: [{ ...compound.EDITIONS.editions[0], rules: compound.EDITIONS.editions[0].rules.map(r => ({ ...r, then: { ...r.then, tier: 'a' } })) }] };
  assert.equal(deoptOf(await one(compound, app('a', 700, 0.5))), 'invariant/table-well-formed', 'reading 2: OUTPUT_ORDER over compound outputs is refused, not ranked');
  const uncertain = await plan([...done('reserve-stock', 'authorize-card'), ev('book-courier', 'start'), ev('book-courier', 'error', 'timeout')]);
  assert.deepEqual(uncertain.next.map(c => [c.action, c.step]), [['undo', 'book-courier']], 'reading 3a: an uncertain compensable failure is undone (if-uncertain), with no status query first');
  const pivot = await plan([...done('reserve-stock', 'authorize-card', 'book-courier'), ev('capture-payment', 'start'), ev('capture-payment', 'error', 'timeout')]);
  assert.deepEqual(pivot.next.map(c => [c.action, c.step, c.key, c.attempt]), [['do', 'capture-payment', 's:capture-payment:do', 2]], 'reading 3b: an uncertain pivot is retried under the same key');
  const exact = await clk([tick('2026-10-14T09:00:00+01:00', 'created'), tick('2026-10-14T11:00:00+01:00', 'status', 'resolved')], '2026-10-14T15:00:00+01:00');
  assert.deepEqual([exact.elapsedMinutes, exact.met, exact.breached], [120, true, false], 'reading 4: stopping exactly at dueAt is on time (exclusive boundary)');
});

// ---- freeze and catalog ----
const FROZEN = JSON.parse(readFileSync(path.join(CARDS_DIR, 'FROZEN-P58-P60.json'), 'utf8'));
const sha = b => createHash('sha256').update(b).digest('hex');
const filesOf = id => { const walk = d => readdirSync(path.join(CARDS_DIR, d), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`])); return walk(id).sort(); };

const digestOf = f => sha(Object.keys(f.files).sort().map(rel => `${rel} ${f.files[rel]}\n`).join(''));
const REVIEW_DOC = new URL('../../../research/enterprise-20261014/CARDS-P58-P60-REVIEW.md', import.meta.url);

test('E-bed cards: every card file hashes to its current entry in cards/FROZEN-P58-P60.json (the cards are frozen before any spec-E)', () => {
  assert.equal(FROZEN.schema, 'card-freeze/2');
  assert.deepEqual(Object.keys(FROZEN.cards).sort(), EBED);
  for (const id of EBED) {
    const f = FROZEN.cards[id], files = filesOf(id);
    assert.deepEqual(Object.keys(f.files).sort(), files, `${id}: the frozen file list`);
    for (const rel of files) assert.equal(sha(readFileSync(path.join(CARDS_DIR, rel))), f.files[rel], `${rel} changed after the freeze`);
    assert.equal(f.sha256, digestOf(f), `${id}: card digest`);
    assert.equal(f.skeletonSha256, card[id].skeletonSha256);
    assert.equal(f.version, card[id].version, `${id}: the frozen version is the card's version`);
  }
  assert.equal(FROZEN.cards.P58.sha256, '414717d390705ed1f19d7d2631fb47d372a16fdd9db80c8d59975f92b116c7f7', 'P58 is still the blind v1');
});

test('E-bed cards: amendment A1 (review R1, R2): superseded versions keep their digests, the amendment names exactly the changed files, and the digests have a copy outside cards/', t => {
  assert.deepEqual(FROZEN.history.map(h => [h.card, h.version, h.supersededBy]), [['P59', 1, 2], ['P60', 1, 2]]);
  const changed = [];
  for (const h of FROZEN.history) {
    assert.equal(digestOf(h), h.sha256, `${h.card} v${h.version}: digest`);
    const now = FROZEN.cards[h.card];
    assert.equal(now.version, h.supersededBy);
    assert.deepEqual(Object.keys(now.files).sort(), Object.keys(h.files).sort(), `${h.card}: same file list`);
    for (const rel of Object.keys(h.files)) if (h.files[rel] !== now.files[rel]) changed.push(rel);
  }
  const [a1] = FROZEN.amendments;
  assert.equal(FROZEN.amendments.length, 1);
  assert.deepEqual([a1.id, a1.versions], ['A1', { P59: [1, 2], P60: [1, 2] }]);
  assert.deepEqual(changed.sort(), [...a1.files].sort(), 'fixtures are byte-identical to v1; only card.json and skeleton.mjs changed');
  assert.match(a1.provenance, /^Not blind\./);
  // A copy outside cards/ (review finding 14): editing the cards and FROZEN together cannot go unnoticed.
  const doc = readFileSync(REVIEW_DOC, 'utf8');
  for (const f of [...Object.values(FROZEN.cards), ...FROZEN.history]) assert.ok(doc.includes(f.sha256), `${f.name} v${f.version}: ${f.sha256} is copied in ${REVIEW_DOC.pathname}`);
  // Where git history is present, the v1 files at the freeze commit hash to the recorded v1 digests.
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  let checked = 0;
  for (const h of FROZEN.history) for (const [rel, want] of Object.entries(h.files)) {
    let blob;
    try { blob = execFileSync('git', ['-C', repo, 'show', `${h.commit}:experiments/library/cards/${rel}`], { stdio: ['ignore', 'pipe', 'ignore'] }); } catch { continue; }
    assert.equal(sha(blob), want, `${rel} at ${h.commit.slice(0, 7)}`); checked++;
  }
  t.diagnostic(`v1 files checked against git: ${checked}`);
});

test('E-bed cards: the catalog is what tools/build-catalog.mjs regenerates, with P58-P60 as authored entries indexed like the rest', () => {
  const built = execFileSync(process.execPath, [new URL('../tools/build-catalog.mjs', import.meta.url).pathname], { encoding: 'utf8' });
  assert.equal(built, readFileSync(path.join(CARDS_DIR, 'catalog.json'), 'utf8'));
  const cat = loadCatalog();
  for (const id of EBED) {
    const e = cat.find(p => p.id === id);
    assert.deepEqual([e.layer, e.origin, e.support.grade, e.support.items, e.companions], ['L1', 'authored', 'U', 0, []]);
  }
  const rows = buildIndex({ l1: loadL1() }).filter(r => EBED.includes(r.id));
  assert.equal(rows.length, 3);
  for (const r of rows) assert.ok(r.executable && r.tokens <= 30 && r.line.startsWith(`${r.id} `), r.line);
});
