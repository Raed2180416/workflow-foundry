// Checks: the property sandbox, the contrast pair (G2), the writer with rewrites and one logged escalation (scripted
// model, no paid call), the status rules (§3), G3, and G1 (a written property is never rewritten unless the user edits).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { ModelPort } from '../../../src/models/port.mjs';
import { Journal } from '../../../src/journal.mjs';
import { ScriptedProvider } from '../../../src/models/providers/scripted.mjs';
import { subsetPolicy } from '../../lib/models.mjs';
import { runProperties, runContrast, contrastVerdict, writeCheck, needsCheck, statusOf, suspects, instancesOf } from '../checks.mjs';
import { buildLedger, applyEdits } from '../ledger.mjs';
import { budgetedPort, defaultModels } from '../extract.mjs';
import { writeChecks } from '../run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SPEC = readFileSync(path.join(here, '../../../beds/ebed/e8/spec/SPEC-E.md'), 'utf8');
const skip = !sandboxAvailable() && 'sandbox unavailable';
const { writer: HAIKU, escalate: SONNET } = defaultModels();
const L162 = 'If a batch comes back `partial`, resubmit only the failed items, with their original keys, inside the same window.';

// A property for line 162 (shape of TRACKER-DESIGN §2.2, shortened) and its contrast pair.
const GOOD = `(t, h) => t.effects.filter(e => e.system === 'inventory' && e.op === 'reserve' && e.result && e.result.status === 'partial').map(e => {
  const failed = e.result.items.filter(i => i.status !== 'ok').map(i => e.args.items[i.index]);
  const later = t.effects.filter(x => x !== e && x.system === 'inventory' && x.args && x.args.fulfilmentId === e.args.fulfilmentId && h.ms(x.at) >= h.ms(e.result.at));
  const first = later[0];
  const ok = !!first && first.op === 'reserve' && failed.every(f => typeof f.key === 'string' && first.args.items.some(i => i.key === f.key));
  return { subject: e.subject, at: e.at, ok, why: ok ? 'resubmitted with original keys' : 'released or not resubmitted', refs: [e.id] };
})`;
const TOOTHLESS = `(t, h) => t.effects.filter(e => e.op === 'reserve' && e.result && e.result.status === 'partial').map(e => ({ subject: e.subject, at: e.at, ok: true, why: 'fine', refs: [e.id] }))`;
const reserve = { id: 'e1', at: '2026-03-05T15:23:00+01:00', subject: 'O1', system: 'inventory', op: 'reserve', args: { fulfilmentId: 'O1-F1', items: [{ sku: 'A', key: 'kA' }, { sku: 'B', key: 'kB' }] },
  result: { at: '2026-03-05T15:24:00+01:00', status: 'partial', items: [{ index: 0, key: 'kA', status: 'error', error: { code: 503 } }, { index: 1, key: 'kB', status: 'ok' }] } };
const SAT = JSON.stringify({ horizon: '2026-03-06T00:00:00+01:00', effects: [reserve, { id: 'e2', at: '2026-03-05T15:24:00+01:00', subject: 'O1', system: 'inventory', op: 'reserve', args: { fulfilmentId: 'O1-F1', items: [{ sku: 'A', key: 'kA' }] }, result: { at: '2026-03-05T15:25:00+01:00', status: 'ok' } }] });
const VIOL = JSON.stringify({ horizon: '2026-03-06T00:00:00+01:00', effects: [reserve, { id: 'e2', at: '2026-03-05T15:24:00+01:00', subject: 'O1', system: 'inventory', op: 'release', args: { fulfilmentId: 'O1-F1', sku: 'B' }, result: { at: '2026-03-05T15:25:00+01:00', status: 'ok' } }] });
const answer = (fn, satisfies = SAT, violates = VIOL, observable = true) => ({ value: { observable, fn, satisfies, violates }, costUsd: 0.001 });

const portWith = script => {
  const provider = new ScriptedProvider(script);
  return { port: new ModelPort({ policy: subsetPolicy(loadPolicy().policy, [HAIKU, SONNET]), journal: new Journal(new DatabaseSync(':memory:')), providers: { 'claude-cli': provider } }), provider };
};
const ledgerOf = () => buildLedger({ text: SPEC, entries: [{ quote: L162, kind: 'when-then', summary: 'partial -> resubmit failed items, original keys', context: ['**Reserve** every item of the fulfilment at its location (`inventory.reserve`), within **120 min** of t.'] }] });

test('the property sandbox: no I/O, no network, no code generation, no clock, no randomness, a time limit; a frozen trace', { skip }, async () => {
  const trace = JSON.parse(SAT);
  const props = {
    good: GOOD,
    fs: '(t, h) => { const fs = process.binding("fs"); return []; }',
    require: '(t, h) => { require("node:fs").readFileSync("/home/user/workflow-foundry/AGENTS.md", "utf8"); return []; }',
    escape: '(t, h) => { const F = h.ms.constructor; return F("return process")().mainModule ? [] : []; }',
    net: '(t, h) => { fetch("https://example.com"); return []; }',
    loop: '(t, h) => { for (;;) {} }',
    clock: '(t, h) => [{ subject: null, at: null, ok: Date.now() > 0, why: "", refs: [] }]',
    random: '(t, h) => [{ subject: null, at: null, ok: Math.random() > 2, why: "", refs: [] }]',
    async: 'async (t, h) => []',
    shape: '(t, h) => [{ ok: "yes" }]',
    notfn: '42',
    mutate: '(t, h) => { t.effects.length = 0; t.effects[0].op = "x"; return [{ subject: null, at: null, ok: t.effects.length === 2 && t.effects[0].op === "reserve", why: "frozen", refs: [] }]; }',
    dyn: '(t, h) => { import("node:fs"); return []; }',
  };
  const res = await runProperties({ props, traces: [{ id: 'w', trace }], perPropMs: 800 });
  const r = id => res.get(`w\u0000${id}`);
  assert.equal(r('good').ok, true);
  assert.deepEqual(r('good').instances.map(i => i.ok), [true]);
  assert.match(r('fs').error, /process is not defined/);
  assert.match(r('require').error, /require is not defined/);
  assert.match(r('escape').error, /Code generation from strings disallowed/);
  assert.match(r('net').error, /fetch is not defined/);
  assert.equal(r('loop').timeout, true);
  assert.match(r('clock').error, /nondeterministic: Date\.now/);
  assert.match(r('random').error, /nondeterministic: Math\.random/);
  assert.match(r('async').error, /must return an array/);
  assert.match(r('shape').error, /ok must be true, false or null/);
  assert.match(r('notfn').error, /not a function/);
  assert.deepEqual(r('mutate').instances.map(i => i.ok), [true], 'the trace is frozen');
  assert.deepEqual(r('dyn').instances, [], 'a dynamic import neither loads anything nor ends the run');
  assert.deepEqual(instancesOf('[{"ok":null,"refs":[1,"a"]}]').instances[0], { subject: null, at: null, ok: null, why: '', refs: ['a'] });
});

test('G2 contrast pair: a property with teeth passes; a toothless one, an untriggered pair or a broken pair does not', { skip }, async () => {
  const v = await runContrast([
    { id: 'good', fn: GOOD, satisfies: SAT, violates: VIOL },
    { id: 'toothless', fn: TOOTHLESS, satisfies: SAT, violates: VIOL },
    { id: 'untriggered', fn: GOOD, satisfies: JSON.stringify({ effects: [] }), violates: VIOL },
    { id: 'notjson', fn: GOOD, satisfies: '{effects: [', violates: VIOL },
    { id: 'nofn', fn: '', satisfies: SAT, violates: VIOL },
  ]);
  assert.deepEqual(v.get('good'), { ok: true, why: 'contrast pair ok' });
  assert.match(v.get('toothless').why, /violating trace no instance was ok: false/);
  assert.match(v.get('untriggered').why, /satisfying trace the property returned no instance/);
  assert.match(v.get('notjson').why, /satisfying trace is not JSON/);
  assert.equal(v.get('nofn').ok, false);
  assert.match(contrastVerdict({ ok: false, error: 'boom' }, { ok: true, instances: [] }).why, /failed to run: boom/);
});

test('writer: a failed pair is rewritten with its own feedback; G1: it sees the quote, its context and the trace API only', { skip }, async () => {
  const { port, provider } = portWith({ [HAIKU]: [answer(TOOTHLESS), answer(GOOD)] });
  const ledger = ledgerOf(), entry = ledger.requirements[0];
  const escalations = [];
  const check = await writeCheck({ port, ledger, entry, writer: HAIKU, escalate: SONNET, onEscalate: e => escalations.push(e) });
  assert.equal(check.contrastOk, true);
  assert.equal(check.fn, GOOD);
  assert.equal(check.escalated, false);
  assert.deepEqual(check.attempts.map(a => a.ok), [false, true]);
  assert.equal(escalations.length, 0);
  assert.equal(check.writer, HAIKU);
  assert.equal(check.traceApi, '1');
  assert.match(check.quoteHash, /^[0-9a-f]{64}$/);
  const [first, second] = provider.calls;
  assert.match(first.prompt, /comes back `partial`/);
  assert.match(first.prompt, /\*\*Reserve\*\* every item/, 'the context quote is given');
  assert.match(first.system, /# Trace API v1/);
  assert.doesNotMatch(first.prompt + first.system, /createSolver|em-0000|b1lh|oracle\(/, 'no build, trace or oracle');
  assert.match(second.prompt, /failed its own contrast pair: on your violating trace no instance was ok: false/);
  assert.equal(needsCheck({ ...entry, check }), false, 'a written property is not rewritten');
});

test('writer: after 1 + 2 failed attempts there is ONE logged escalation to the next class; if that fails too, the check is not trustworthy', { skip }, async () => {
  const bad = answer(TOOTHLESS);
  {
    const { port, provider } = portWith({ [HAIKU]: [bad, bad, bad], [SONNET]: [answer(GOOD)] });
    const ledger = ledgerOf(), escalations = [];
    const check = await writeCheck({ port, ledger, entry: ledger.requirements[0], writer: HAIKU, escalate: SONNET, onEscalate: e => escalations.push(e) });
    assert.equal(check.contrastOk, true);
    assert.equal(check.escalated, true);
    assert.equal(check.writer, SONNET);
    assert.deepEqual(provider.calls.map(c => c.modelId), [HAIKU, HAIKU, HAIKU, SONNET]);
    assert.equal(escalations.length, 1);
    assert.deepEqual([escalations[0].from, escalations[0].to, escalations[0].after], [HAIKU, SONNET, 3]);
  }
  {
    const { port, provider } = portWith({ [HAIKU]: [bad, { value: { wrong: 1 } }, bad], [SONNET]: [bad] });
    const ledger = ledgerOf();
    const check = await writeCheck({ port, ledger, entry: ledger.requirements[0], writer: HAIKU, escalate: SONNET });
    assert.equal(provider.calls.length, 4, 'never more than 1 + 2 rewrites + 1 escalation');
    assert.equal(check.contrastOk, false);
    assert.equal(check.fn, null);
    assert.equal(check.unclear, 'check not trustworthy');
    assert.match(check.attempts[1].why, /model error MODEL_SCHEMA/);
    assert.deepEqual(statusOf(check, {}), { status: 'unclear', reason: 'check not trustworthy', flags: [], worlds: {} });
    assert.equal(needsCheck({ check }), false, 'an untrustworthy check stays unclear until the user edits the entry');
  }
  {
    const { port } = portWith({ [HAIKU]: [answer('', '{}', '{}', false)] });
    const ledger = ledgerOf();
    const check = await writeCheck({ port, ledger, entry: ledger.requirements[0], writer: HAIKU, escalate: SONNET });
    assert.equal(check.observable, false);
    assert.equal(statusOf(check, {}).reason, 'not observable in a run');
  }
});

test('G1: only a user edit makes a written property be rewritten (version bump)', () => {
  const ledger = ledgerOf();
  ledger.requirements[0].check = { version: 1, fn: GOOD, contrastOk: true, observable: true };
  assert.equal(needsCheck(ledger.requirements[0]), false);
  const edited = applyEdits(ledger, SPEC, [{ op: 'edit', id: 'Q-001', summary: 'never release before resubmitting' }]);
  assert.equal(needsCheck(edited.requirements[0]), true);
  assert.equal(edited.requirements[0].check.version, 2);
  assert.equal(needsCheck({ check: null }), true);
});

test('writeChecks stops at the spend cap and leaves the rest pending', { skip }, async () => {
  const text = SPEC;
  const ledger = buildLedger({ text, entries: [
    { quote: L162, kind: 'when-then', summary: 'a', context: [] },
    { quote: 'R2.1 Read `fraud.check` for every new order.', kind: 'must', summary: 'b', context: [] },
    { quote: 'Never undo a step that did not commit; never undo a step twice.', kind: 'never', summary: 'c', context: [] },
  ] });
  const { port } = portWith({ [HAIKU]: () => ({ ...answer(GOOD), costUsd: 0.5 }) });
  const capped = budgetedPort(port, { capUsd: 0.9 });
  const w = await writeChecks({ ledger, port: capped, writer: HAIKU, escalate: SONNET, concurrency: 1 });
  assert.ok(w.stopped, 'stopped by the cap');
  assert.equal(w.written, 2);
  assert.equal(w.pending, 1);
  assert.equal(capped.spentUsd, 1);
});

test('status rules (§3): untested is never pass; any counterexample fails; errors make it unclear; thin under 3', () => {
  const ck = { fn: '(t,h)=>[]', contrastOk: true, observable: true };
  const ok = n => ({ ok: true, instances: Array.from({ length: n }, () => ({ ok: true })) });
  assert.equal(statusOf(null).reason, 'no check');
  assert.deepEqual(statusOf(ck, { a: { ok: true, instances: [] }, b: { ok: true, instances: [] } }).status, 'untested');
  assert.equal(statusOf(ck, { a: { ok: true, instances: [{ ok: null }] } }).reason, 'every instance censored');
  assert.deepEqual([statusOf(ck, { a: ok(2) }).status, statusOf(ck, { a: ok(2) }).flags], ['pass', ['thin']]);
  assert.deepEqual([statusOf(ck, { a: ok(1), b: ok(2) }).status, statusOf(ck, { a: ok(1), b: ok(2) }).flags], ['pass', []]);
  const f = statusOf(ck, { a: ok(5), b: { ok: true, instances: [{ ok: true }, { ok: false }, { ok: null }] } });
  assert.equal(f.status, 'fail');
  assert.deepEqual(f.worlds.b, { triggered: 3, pass: 1, fail: 1, censored: 1 });
  assert.deepEqual(f.worlds.a, { triggered: 5, pass: 5, fail: 0, censored: 0 });
  const e = statusOf(ck, { a: ok(5), b: { ok: false, error: 'boom' } });
  assert.deepEqual([e.status, e.flags], ['unclear', ['errored']]);
  assert.match(e.reason, /threw or timed out on world b/);
  const ef = statusOf(ck, { a: { ok: true, instances: [{ ok: false }] }, b: { ok: false, error: 'boom' } });
  assert.deepEqual([ef.status, ef.flags], ['fail', ['errored']]);
});

test('G3: a requirement every one of K >= 3 builds fails is suspect', () => {
  assert.deepEqual([...suspects([{ A: 'fail', B: 'fail' }, { A: 'fail', B: 'pass' }, { A: 'fail', B: 'fail' }])], ['A']);
  assert.deepEqual([...suspects([{ A: 'fail' }, { A: 'fail' }])], []);
});
