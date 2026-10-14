// T2 full (LIBRARY-TESTS §2; BUILD-ORDER step 6): the constructor loop S1–S11 end to end with a SCRIPTED model on the
// W-bed R0–R3 fixture tasks (dev seeds 373–378). Every prompt is intercepted (assemblePrompt's log) and must be within its
// call's cap and every part within its allocation; an oversized prompt is refused with CONTEXT_OVER_CLASS_BUDGET, never
// truncated. Also the loop's other checks: S1 verbatim spans, S5 plan checks and none-fits, S5b decomposition, S8 repair and
// its limits, S9 smoke, S10 registration under verify-before-store, S11 escalation, and the S3 route. $0: no model call
// leaves the process (the scripted model), no oracle is imported (beds are used through generate() only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { construct, scriptedModel, renderTask, checkPlan, LIMITS } from '../construct.mjs';
import { SCRIPTS, R1 } from '../fixtures/construct-scripts.mjs';
import { CAP_TABLE, REFUSAL, countTokens } from '../context.mjs';
import { openLibrary } from '../store.mjs';
import { learnProfile } from '../../jit/profile.mjs';
import { tmp, clock, makeKept } from './helpers.mjs';

const SEEDS = [373, 374, 375, 376, 377, 378];
const beds = {};
const bed = async r => (beds[r] ??= await import(new URL(`../../../beds/wbed/${r}/index.mjs`, import.meta.url).href));
const taskOf = async (r, seed) => { const m = await bed(r); const t = m.generate({ seed, split: 'dev', difficulty: 3 }); return { task: { prompt: t.prompt, inputs: t.inputs }, outputSchema: m.outputSchema }; };
const within = rec => {
  const row = CAP_TABLE[rec.call];
  assert.ok(rec.tokens.total <= rec.cap && rec.cap <= row.cap, `${rec.call}: ${rec.tokens.total} > cap ${rec.cap}`);
  for (const [part, n] of Object.entries(rec.tokens)) if (part in row.parts) assert.ok(n <= row.parts[part], `${rec.call}.${part}: ${n} > ${row.parts[part]}`);
};
const run = async (t, r, seed, { script = SCRIPTS[`wbed-${r}`](), ...opts } = {}) => {
  const { task, outputSchema } = await taskOf(r, seed);
  const model = scriptedModel(script), library = openLibrary(tmp(t), { now: clock() });
  const rec = await construct({ task, outputSchema, model, library, smoke: { answers: script.answers ?? {} }, label: `wbed-${r}-${seed}`, ...opts });
  return { rec, model, library, task };
};

test('T2 full: the loop end to end on W-bed R0–R3 fixture tasks (seeds 373–378); every prompt within its cap, nothing refused or truncated', async t => {
  const stats = {};
  for (const r of ['r0', 'r1', 'r2', 'r3']) for (const seed of SEEDS) {
    const { rec, model, library } = await run(t, r, seed);
    // Every model request came through the assembler, one record each, and none was refused.
    const assembled = rec.prompts.filter(p => !p.refused);
    assert.equal(rec.prompts.length, assembled.length, `${r}/${seed}: no refusal`);
    assert.equal(model.requests.length, assembled.length, `${r}/${seed}: every request was assembled`);
    model.requests.forEach((q, i) => { assert.equal(q.call, assembled[i].call); assert.equal(countTokens(q.system) + countTokens(q.prompt), assembled[i].tokens.total, 'the model saw exactly the assembled prompt'); });
    for (const p of assembled) { within(p); (stats[p.call] ??= []).push(p.tokens.total); }
    if (r === 'r0') {
      assert.equal(rec.outcome, 'none'); assert.equal(rec.route.answer, 'none');
      assert.deepEqual(model.requests.map(q => q.call), ['S1'], 'R0: intake only, then route none');
      continue;
    }
    assert.equal(rec.outcome, 'registered', `${r}/${seed}: ${JSON.stringify(rec.escalation)}`);
    assert.equal(rec.route.answer, 'template');
    assert.ok(rec.calls.length <= LIMITS.maxCalls);
    // S9 smoke: ok, schema-valid, $0, no live model call.
    assert.equal(rec.smoke.ok, true);
    for (const s of rec.smoke.runs) { assert.equal(s.status, 'ok'); assert.equal(s.liveModelCalls, 0); assert.equal(s.spentUsd, 0); }
    // S10: a candidate whose verify-before-store is not met (live probes and an independent check are paid steps).
    const e = library.get(rec.registered.hash);
    assert.equal(e.status, 'candidate'); assert.equal(rec.registered.status, 'candidate');
    assert.deepEqual(rec.registered.admission.missing, ['probesPass', 'verifiedBy', 'profileFromAccepted']);
    assert.equal(e.evidence.admission.fixturesPass, true);
    assert.deepEqual(e.patterns, [...new Set(e.patterns)]);
    assert.equal(readFileSync(e.solvePath, 'utf8'), rec.source, 'the registered bytes are the assembled solver');
    if (r === 'r1') {   // S8: the scripted fill omits the none member; the checker fires ENUM_NO_NONE and one repair fixes it
      assert.deepEqual(rec.repairs.map(x => `${x.role}.${x.slot}:${x.code}`), ['extract.CONV_JUDGE:ENUM_NO_NONE']);
      assert.deepEqual(rec.findings.at(-1).findings, []);
      assert.deepEqual(e.patterns.sort(), ['P01', 'P03', 'P12']);
    }
    if (r === 'r2') assert.deepEqual(rec.events.filter(x => x.step === 'S1').map(x => x.accepted), [false, true], 'S1 rejected a non-verbatim span and asked once more');
    if (r === 'r3') {   // S5b: one child, called through the P54 role code inserted, 16 child calls in the smoke run
      assert.deepEqual(rec.events.find(x => x.step === 'S5b').parent, ['split:P01', 'call-statement:P54']);
      assert.equal(rec.children.length, 1);
      const child = library.get(rec.children[0].hash);
      assert.deepEqual(child.contract.input.required, ['file', 'text']); assert.deepEqual(child.contract.output.required, ['lines', 'currency']);
      assert.ok(rec.smoke.runs[0].calls['call-end'] >= 10, JSON.stringify(rec.smoke.runs[0].calls));
      assert.equal(rec.source.includes(rec.children[0].hash), true, 'REF resolved to the child\'s literal hash');
    }
  }
  const sum = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, { n: v.length, max: Math.max(...v), mean: Math.round(v.reduce((a, b) => a + b, 0) / v.length), cap: CAP_TABLE[k].cap }]));
  t.diagnostic(`prompt tokens by call (bound): ${JSON.stringify(sum)}`);
  for (const k of ['S1', 'S5', 'S6', 'S8']) assert.ok(sum[k]?.n > 0, `${k} exercised`);
});

test('T2: an oversized prompt is refused with CONTEXT_OVER_CLASS_BUDGET and the construction escalates; nothing is truncated', async t => {
  // (a) A TaskSpec over its 1,000-token S5 allocation (long verbatim spans that S1 accepts).
  const { task } = await taskOf('r1', 373);
  const long = task.inputs.ledger_spec.slice(0, 6000);
  const script = R1(); script.S1[0].rules.push({ span: long, kind: 'other' });
  const a = await run(t, 'r1', 373, { script });
  assert.equal(a.rec.outcome, 'escalated'); assert.equal(a.rec.escalation.to, 'host-agent');
  const refused = a.rec.prompts.filter(p => p.refused);
  assert.equal(refused.length, 1); assert.equal(refused[0].refused, REFUSAL); assert.equal(refused[0].call, 'S5'); assert.equal(refused[0].part, 'task');
  assert.ok(refused[0].tokens > CAP_TABLE.S5.parts.task, 'the refused part is whole');
  assert.ok(!a.model.requests.some(q => q.call === 'S5'), 'the oversized prompt never reached the model');
  // (b) A request that alone exceeds S1's 3,000-token task allocation: refused, never cut.
  const big = { prompt: Array.from({ length: 2600 }, (_, i) => `word${i % 50}`).join(' '), inputs: { a: 'x' } };
  assert.equal(renderTask(big, 3000).includes(big.prompt), true, 'the request comes back whole');
  const m = scriptedModel(R1()), b = await construct({ task: big, model: m, label: 'big' });
  assert.equal(b.outcome, 'escalated'); assert.equal(b.prompts[0].refused, REFUSAL); assert.equal(b.prompts[0].part, 'task'); assert.equal(m.requests.length, 0);
});

test('T2: S1 code-renders a sample of the inputs within 3,000 tokens and counts what it leaves out', async () => {
  const { task } = await taskOf('r1', 374);
  const text = renderTask(task, 3000);
  assert.ok(countTokens(text) <= 3000);
  assert.ok(text.startsWith(`REQUEST\n${task.prompt}`), 'the request verbatim first');
  for (const k of Object.keys(task.inputs)) assert.ok(text.includes(`inputs.${k}`), `field ${k} shown`);
  assert.ok(/…\[\d+ more lines\]/.test(text), 'left-out lines are counted');
});

test('S5: plan checks (ids in the shown set and executable, roles once, <= 5 with child calls); refused twice -> escalate; none-fits -> trace-first', async t => {
  const shown = new Set(['P01', 'P03', 'P12', 'P14', 'P54']);
  assert.deepEqual(checkPlan({ plan: [{ role: 'a', patternId: 'P99' }] }, shown), ['P99 is not in the shown set']);
  assert.deepEqual(checkPlan({ plan: [{ role: 'a', patternId: 'P14' }] }, shown), ['P14 has no executable card']);
  assert.deepEqual(checkPlan({ plan: [{ role: 'a', patternId: 'P01' }, { role: 'a', patternId: 'P03' }] }, shown), ['role a is named twice']);
  assert.match(checkPlan({ plan: Array.from({ length: 5 }, (_, i) => ({ role: `r${i}`, patternId: 'P01' })), decompose: [{ child: 'c', plan: [{ role: 'k', patternId: 'P12' }] }] }, shown)[0], /> 5/);
  assert.deepEqual(checkPlan({ plan: [{ role: 'a', patternId: 'P01' }], decompose: [{ child: 'c', after: 'zz', plan: [{ role: 'k', patternId: 'P12' }] }] }, shown), ['child c: after names no parent role (zz)']);
  assert.deepEqual(checkPlan({ noneFits: true }, shown), []);
  const bad = R1(); bad.S5 = [{ plan: [{ role: 'x', patternId: 'P99' }] }, { plan: [{ role: 'x', patternId: 'P45' }] }];
  const a = await run(t, 'r1', 375, { script: bad });
  assert.equal(a.rec.outcome, 'escalated'); assert.match(a.rec.escalation.reason, /choose/);
  assert.deepEqual(a.rec.events.filter(e => e.step === 'S5').map(e => e.accepted), [false, false]);
  const none = R1(); none.S5 = [{ noneFits: true }];
  const b = await run(t, 'r1', 375, { script: none });
  assert.equal(b.rec.escalation.to, 'construct'); assert.match(b.rec.escalation.reason, /none-fits/);
});

test('S8: repairs are limited (2 per slot, 6 in total); an exhausted slot escalates', async t => {
  const s = R1(); const broken = s.S6.extract.slots.CONV_JUDGE;
  s.S8['extract.CONV_JUDGE'] = [broken, broken, broken];
  const r = await run(t, 'r1', 376, { script: s });
  assert.equal(r.rec.outcome, 'escalated'); assert.match(r.rec.escalation.reason, /repair: limit reached \(extract\.CONV_JUDGE 2\/2/);
  assert.equal(r.rec.repairs.length, LIMITS.repairsPerSlot);
});

test('S9: a smoke run that deopts escalates (no registration)', async t => {
  const s = R1(); s.S6.report.slots.MAX_ITEMS = 5;
  const r = await run(t, 'r1', 377, { script: s });
  assert.equal(r.rec.outcome, 'escalated'); assert.match(r.rec.escalation.reason, /smoke: deopt guard\/bounded/);
  assert.equal(r.rec.registered, null);
  assert.equal(r.library.list().length, 0);
});

test('S3: R0 routes none before any reuse; reuse (when switched on) needs the code gates; off by default', async t => {
  const { task, outputSchema } = await taskOf('r1', 373);
  const library = openLibrary(tmp(t), { now: clock() });
  const e = library.register({ layer: 'L2', name: 'r1-close', contract: { input: { type: 'object', required: ['invoices'] }, output: outputSchema, taskTemplate: task.prompt },
    stub: async () => ({ output: { customers: [], totals: { customers: 0, invoiced_usd_cents: 0, paid_usd_cents: 0, open_usd_cents: 0 } } }), profile: learnProfile([task]),
    tags: ['spine', 'P01'], patterns: ['P01'], provenance: { source: 'own-trace', ref: 'test', licence: 'internal', redistributable: false } });
  makeKept(library, e.hash);
  const on = await construct({ task, outputSchema, model: scriptedModel(R1()), library, reuse: true });
  assert.equal(on.outcome, 'reuse'); assert.equal(on.route.hash, e.hash);
  const off = await construct({ task, outputSchema, model: scriptedModel(R1()), library, smoke: { answers: R1().answers } });
  assert.equal(off.route.answer, 'template'); assert.match(off.route.why, /reuse is off/);
  const r0 = await taskOf('r0', 373);
  const n = await construct({ task: r0.task, model: scriptedModel(SCRIPTS['wbed-r0']()), library, reuse: true });
  assert.equal(n.outcome, 'none', 'an R0 task is never routed to the R1 component');
});

test('S11: the call budget is a hard stop (escalates to the host agent)', async t => {
  const r = await run(t, 'r1', 378, { maxCalls: 3 });
  assert.equal(r.rec.outcome, 'escalated'); assert.equal(r.rec.escalation.to, 'host-agent'); assert.match(r.rec.escalation.reason, /call budget 3/);
  assert.equal(r.model.requests.length, 3);
});
