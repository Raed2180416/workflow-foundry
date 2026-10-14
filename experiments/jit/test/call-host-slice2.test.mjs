// call-host.mjs slice 2a (design/FLOW-V3-SLICE2.md §1, §3), stub mode: per-call prompts, the per-entry profile check
// options and novelMode, local deopt through the host's interpreter (onRefuse / onDeopt 'interpret', kind interpret-child),
// the budget tree (BUDGET_TREE with the shortfall when siblings in flight hold the difference) and the gateway-held
// reservation. In process, no sandbox, no model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ledger } from '../../lib/services.mjs';
import { learnProfile, PARAMS_V2, TOLERANT_CHECK, SIZE_FEATURES } from '../profile.mjs';
import { createRegistry, createCallHost, callKeyOf, inputDigestOf, promptDigestOf, classifyReuse, CALL_MODEL, REFUSALS, INTERPRETABLE_REFUSALS, DEFAULT_INTERPRET_FLOOR_USD } from '../call-host.mjs';

const OUT = { type: 'object', required: ['total'], properties: { total: { type: 'number' }, by: { type: 'string' } } };
const req = (callee, input, o = {}) => ({ v: 1, op: 'call', callee, input, name: o.name ?? 'sub', budgetUsd: o.budgetUsd ?? 0.2, ...o.extra });
const sumOf = input => input.rows.reduce((s, r) => s + r.amount, 0);
// Values cycle over three, so a longer list differs from the training lists in size only.
const rows = (n, fmt = i => `2026-01-${String(10 + i).padStart(2, '0')}`) => ({ rows: Array.from({ length: n }, (_, i) => ({ date: fmt(i % 3), amount: 10 + (i % 3) })) });
const TRAIN = [3, 4, 5, 4, 3, 5].map(n => ({ prompt: 'Sum the rows.', inputs: rows(n) }));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// An interpreter stub: records its calls; answers {total} (or what `answer` says) at `costUsd`.
function interpreterStub({ costUsd = 0.05, answer = input => ({ total: sumOf(input), by: 'interpreter' }), error = null } = {}) {
  const calls = [];
  const fn = async a => { calls.push(a); if (error) return { answer: null, error, costUsd, traceId: `t${calls.length}` }; return { answer: answer(a.task.inputs, a), costUsd, traceId: `t${calls.length}` }; };
  return { fn, calls };
}

test('per-call prompt: the child task gets it, it joins the idempotency key (promptDigest), and every host event carries the name', async () => {
  const registry = createRegistry();
  const seen = [];
  const sum = registry.register({ contract: { output: OUT, taskTemplate: 'Sum the rows.' }, stub: async (input, ctx) => { seen.push(ctx.prompt); return { output: { total: sumOf(input) }, costUsd: 0.01 }; } });
  const host = createCallHost({ registry, mode: 'stub' });
  host.port({ budgetUsd: 1 });
  const a = await host.request(req(sum.hash, rows(2), { name: 'S1' }));
  const b = await host.request(req(sum.hash, rows(2), { name: 'S2', extra: { prompt: 'Sum the rows of subsidiary S2.' } }));
  const c = await host.request(req(sum.hash, rows(2), { name: 'S3', extra: { prompt: 'Sum the rows of subsidiary S2.' } }));
  assert.deepEqual(seen, ['Sum the rows.', 'Sum the rows of subsidiary S2.'], 'the template by default, the per-call prompt when given; the third is a memo hit');
  assert.equal(a.key, callKeyOf({ callee: sum.hash, inputDigest: inputDigestOf(rows(2)), parentPath: 'root' }), 'without a prompt the key is slice 1\'s');
  assert.equal(b.key, callKeyOf({ callee: sum.hash, inputDigest: inputDigestOf(rows(2)), parentPath: 'root', promptDigest: promptDigestOf('Sum the rows of subsidiary S2.') }));
  assert.notEqual(a.key, b.key); assert.equal(c.memo, 'repeat');
  assert.deepEqual(host.events.map(e => [e.name, e.promptDigest ? 'p' : '-']), [['S1', '-'], ['S2', 'p'], ['S3', 'p']]);
  assert.equal((await host.request({ ...req(sum.hash, rows(1)), prompt: 7 })).refused, 'bad-request', 'a prompt must be a string');
});

test('profile check options per entry over the host defaults; tolerant needs a v2 profile; novelMode warn runs the call and logs profile-warn', async () => {
  const registry = createRegistry();
  const stub = async input => ({ output: { total: sumOf(input) }, costUsd: 0.01 });
  assert.throws(() => registry.register({ contract: { output: OUT }, stub, profile: learnProfile(TRAIN), checkOptions: TOLERANT_CHECK }), /PARAMS_V2/);
  assert.throws(() => registry.register({ contract: { output: OUT }, stub, profile: learnProfile(TRAIN), novelMode: 'shrug' }), /novelMode/);
  const strict = registry.register({ contract: { output: OUT, taskTemplate: 'Sum the rows.' }, stub, profile: learnProfile(TRAIN, PARAMS_V2) });
  const sized = registry.register({ contract: { output: OUT, taskTemplate: 'Sum the rows.' }, stub: async input => ({ output: { total: sumOf(input) + 0 }, costUsd: 0.01 }), profile: learnProfile(TRAIN, PARAMS_V2),
    checkOptions: { ignore: SIZE_FEATURES } });
  assert.deepEqual(sized.checkOptions, { ignore: [...SIZE_FEATURES].sort() }); assert.equal(strict.checkOptions, undefined, 'no options: none stored');
  const many = rows(40);   // 40 rows: an array-length (size) novelty only
  const h1 = createCallHost({ registry, mode: 'stub' }); h1.port({ budgetUsd: 1 });
  assert.equal((await h1.request(req(strict.hash, many))).refused, 'outside-profile', 'host default: the v1 check');
  assert.equal((await h1.request(req(sized.hash, many))).status, 'ok', 'the entry ignores size features');
  assert.deepEqual(h1.events[1].applicability.options, { ignore: [...SIZE_FEATURES].sort() });
  const h2 = createCallHost({ registry, mode: 'stub', profileCheck: { ignore: SIZE_FEATURES } }); h2.port({ budgetUsd: 1 });
  assert.equal((await h2.request(req(strict.hash, many))).status, 'ok', 'host-level options apply to entries without their own');
  // novelMode warn: a novel input (dates in another format) still runs; profile-warn is logged and the answer carries the warning.
  const us = rows(4, i => `01/${10 + i}/2026`);
  const h3 = createCallHost({ registry, mode: 'stub', novelMode: 'warn' }); h3.port({ budgetUsd: 1 });
  const w = await h3.request(req(strict.hash, us));
  assert.equal(w.status, 'ok'); assert.equal(w.warning.novel, true); assert.ok(w.warning.reasons.length);
  assert.deepEqual(h3.events.map(e => e.kind), ['profile-warn', 'call-end']); assert.equal(h3.events[1].warned, true);
  const warnEntry = registry.register({ contract: { output: OUT, taskTemplate: 'Sum the rows.' }, stub, profile: learnProfile(TRAIN, PARAMS_V2), novelMode: 'warn', evidence: { n: 1 } });
  const h4 = createCallHost({ registry, mode: 'stub' }); h4.port({ budgetUsd: 1 });
  assert.equal((await h4.request(req(warnEntry.hash, us))).status, 'ok', 'the entry\'s novelMode over the host default');
  assert.throws(() => createCallHost({ registry, mode: 'stub', novelMode: 'maybe' }), /novelMode/);
});

test('onRefuse interpret: an outside-profile refusal is answered by the interpreter on the child task under the carved budget (interpret-child); the reservation returns; classifyReuse keeps the refusal', async () => {
  const registry = createRegistry();
  const sum = registry.register({ contract: { output: OUT, taskTemplate: 'Sum the rows.' }, stub: async input => ({ output: { total: sumOf(input) }, costUsd: 0.01 }), profile: learnProfile(TRAIN, PARAMS_V2) });
  const it = interpreterStub({ costUsd: 0.07 });
  const ledger = new Ledger({ capUsd: 1, label: 'root' });
  const host = createCallHost({ registry, mode: 'stub', interpreter: it.fn, ledger }); host.port({ budgetUsd: 1 });
  const us = rows(4, i => `01/${10 + i}/2026`);
  const v = await host.request(req(sum.hash, us, { name: 'S2', budgetUsd: 0.3, extra: { onRefuse: 'interpret', prompt: 'Sum S2.' } }));
  assert.equal(v.status, 'interpreted'); assert.deepEqual(v.output, { total: sumOf(us), by: 'interpreter' });
  assert.equal(v.refused, 'outside-profile'); assert.equal(v.interpreted.ok, true); assert.equal(v.spentUsd, 0.07); assert.equal(v.reservedUsd, 0.3);
  assert.equal(it.calls.length, 1);
  const a = it.calls[0];
  assert.deepEqual(a.task, { prompt: 'Sum S2.', inputs: us }); assert.equal(a.budgetUsd, 0.3); assert.deepEqual(a.outputSchema, OUT); assert.equal(a.reason, 'outside-profile');
  assert.equal(a.callee, sum.hash); assert.equal(a.span, 'call:S2#0');
  const e = host.events[0];
  assert.equal(e.kind, 'interpret-child'); assert.equal(e.outcome, 'refused'); assert.equal(e.refused, 'outside-profile'); assert.equal(e.localDeopt, true); assert.equal(e.spentUsd, 0.07);
  assert.equal(classifyReuse(e), 'refused-profile'); assert.equal(classifyReuse(e, { calleeWouldPass: true }), 'missed');
  assert.deepEqual(host.spans().map(s => [s.path, s.spentUsd, s.reservedUsd]), [['root', 0.07, 0]]);
  assert.equal(ledger.reservedUsd, 0, 'the host held and released the reservation on the root Ledger');
  // without 'interpret' the same call is refused, as in slice 1
  assert.equal((await host.request(req(sum.hash, us, { name: 'S9' }))).refused, 'outside-profile');
});

test('onRefuse interpret, the cases it cannot honour: no interpreter, a budget below the floor or not below what remains, a refusal that is not about applicability; a wrong answer deopts (interpret-child); a revoked callee', async () => {
  const registry = createRegistry();
  const sum = registry.register({ contract: { output: OUT, taskTemplate: 'Sum the rows.' }, stub: async input => ({ output: { total: sumOf(input) }, costUsd: 0.01 }), profile: learnProfile(TRAIN, PARAMS_V2) });
  const us = rows(4, i => `01/${10 + i}/2026`), interp = { onRefuse: 'interpret' };
  const bare = createCallHost({ registry, mode: 'stub' }); bare.port({ budgetUsd: 1 });
  const n1 = await bare.request(req(sum.hash, us, { extra: interp }));
  assert.equal(n1.status, 'refused'); assert.equal(n1.refused, 'outside-profile'); assert.deepEqual(n1.detail.interpret, { refused: 'no-interpreter' });
  const it = interpreterStub();
  const host = createCallHost({ registry, mode: 'stub', interpreter: it.fn }); host.port({ budgetUsd: 1 });
  const floor = await host.request(req(sum.hash, us, { budgetUsd: 0.05, extra: interp }));
  assert.equal(floor.refused, 'outside-profile'); assert.deepEqual(floor.detail.interpret, { refused: 'BUDGET_TOO_SMALL', budgetUsd: 0.05, floorUsd: DEFAULT_INTERPRET_FLOOR_USD });
  const big = await host.request(req(sum.hash, us, { budgetUsd: 1, extra: interp }));
  assert.equal(big.detail.interpret.refused, 'budget-exceeds-parent');
  assert.equal((await host.request(req('sha256:' + '0'.repeat(64), us, { extra: interp }))).refused, 'unknown-hash');
  assert.equal(it.calls.length, 0, 'the interpreter never ran');
  assert.deepEqual([...INTERPRETABLE_REFUSALS], ['outside-profile', 'revoked']);
  // A wrong-typed answer: a deopt of kind interpret-child, paid for.
  const bad = interpreterStub({ answer: () => ({ total: 'many' }), costUsd: 0.04 });
  const h2 = createCallHost({ registry, mode: 'stub', interpreter: bad.fn }); h2.port({ budgetUsd: 1 });
  const d = await h2.request(req(sum.hash, us, { extra: interp }));
  assert.equal(d.status, 'deopt'); assert.equal(d.deopt.kind, 'interpret-child'); assert.equal(d.childStatus, 'interpret-failed'); assert.equal(d.interpreted.ok, false); assert.equal(d.spentUsd, 0.04);
  assert.equal(h2.events[0].kind, 'interpret-child'); assert.equal(h2.events[0].outcome, 'refused');
  // Revoked: refused as before unless the caller asks for the interpreter.
  registry.revoke(sum.hash, 'silent miss');
  const h3 = createCallHost({ registry, mode: 'stub', interpreter: it.fn }); h3.port({ budgetUsd: 1 });
  assert.equal((await h3.request(req(sum.hash, rows(3)))).refused, 'revoked');
  const r = await h3.request(req(sum.hash, rows(3), { name: 'again', extra: interp }));
  assert.equal(r.status, 'interpreted'); assert.equal(r.refused, 'revoked'); assert.equal(it.calls.at(-1).reason, 'revoked');
});

test('onDeopt interpret: a child that deopts is interpreted with what it left of the reservation; the call costs the child plus the interpreter', async () => {
  const registry = createRegistry();
  const guarded = registry.register({ contract: { output: OUT, taskTemplate: 'Sum.' }, stub: async () => ({ status: 'deopt', deopt: { kind: 'guard', name: 'known-dialects', detail: null }, costUsd: 0.02 }) });
  const it = interpreterStub({ costUsd: 0.05 });
  const host = createCallHost({ registry, mode: 'stub', interpreter: it.fn }); host.port({ budgetUsd: 1 });
  const v = await host.request(req(guarded.hash, rows(3), { budgetUsd: 0.2, extra: { onDeopt: 'interpret' } }));
  assert.equal(v.status, 'interpreted'); assert.deepEqual(v.output, { total: 33, by: 'interpreter' }); assert.equal(v.spentUsd, 0.07);
  assert.deepEqual(v.deopt, { kind: 'guard', name: 'known-dialects', detail: null }, 'the answer names the deopt it replaced');
  assert.equal(it.calls[0].budgetUsd, 0.18); assert.equal(it.calls[0].reason, 'deopt');
  assert.equal(host.events[0].kind, 'interpret-child'); assert.equal(host.events[0].outcome, 'deopt'); assert.equal(classifyReuse(host.events[0]), 'deopted');
  // what is left is below the floor: no interpretation, the deopt stands (interpret-child, ok false)
  const pricey = registry.register({ contract: { output: OUT, taskTemplate: 'Sum!' }, stub: async () => ({ status: 'deopt', deopt: { kind: 'guard', name: 'g' }, costUsd: 0.15 }) });
  const d = await host.request(req(pricey.hash, rows(3), { name: 'p', budgetUsd: 0.2, extra: { onDeopt: 'interpret' } }));
  assert.equal(d.status, 'deopt'); assert.equal(d.interpreted.ok, false); assert.equal(d.interpreted.error.code, 'BUDGET_TOO_SMALL'); assert.equal(d.spentUsd, 0.15);
  assert.equal(it.calls.length, 1);
});

test('budget tree: siblings in flight hold their reservations; a call that would fit without them is refused BUDGET_TREE with the shortfall; one too big alone is budget-exceeds-parent', async () => {
  const registry = createRegistry();
  const slow = registry.register({ contract: { output: OUT }, stub: async input => { await sleep(30); return { output: { total: sumOf(input) }, costUsd: 0.1 }; } });
  const host = createCallHost({ registry, mode: 'stub' }); host.port({ budgetUsd: 1 });
  const [a, b, c] = await Promise.all([0.4, 0.4, 0.4].map((usd, i) => host.request(req(slow.hash, rows(i + 1), { name: `S${i}`, budgetUsd: usd }))));
  assert.equal(a.status, 'ok'); assert.equal(b.status, 'ok');
  assert.equal(c.refused, 'BUDGET_TREE');
  assert.deepEqual({ ...c.detail, rule: undefined }, { budgetUsd: 0.4, remainingUsd: 0.2, shortfallUsd: 0.2, inFlight: 2, reservedInFlightUsd: 0.8, parentBudgetUsd: 1, parentSpentUsd: 0, rule: undefined });
  assert.ok(REFUSALS.includes('BUDGET_TREE'));
  // Sequentially every call fits; a single call above what remains is budget-exceeds-parent, as in slice 1.
  const seq = createCallHost({ registry, mode: 'stub' }); seq.port({ budgetUsd: 1 });
  for (let i = 0; i < 3; i++) assert.equal((await seq.request(req(slow.hash, rows(i + 1), { name: `S${i}`, budgetUsd: 0.4 }))).status, 'ok');
  const over = await seq.request(req(slow.hash, rows(9), { name: 'big', budgetUsd: 0.75 }));
  assert.equal(over.refused, 'budget-exceeds-parent'); assert.deepEqual(over.detail, { budgetUsd: 0.75, remainingUsd: 0.7 });
});

test('a gateway that holds the call\'s reservation (gatewayHoldUsd) is not held twice, and remaining counts that hold back in', async () => {
  const registry = createRegistry();
  let during = null;
  const ledger = new Ledger({ capUsd: 1, label: 'root' });
  const sum = registry.register({ contract: { output: OUT }, stub: async input => { during = ledger.reservedUsd; return { output: { total: sumOf(input) }, costUsd: 0.1 }; } });
  const host = createCallHost({ registry, mode: 'stub', ledger });
  const port = host.port({ budgetUsd: 1 });
  // As services.mjs does: hold 0.6 on the Ledger, then pass the request with gatewayHoldUsd.
  ledger.hold(0.6);
  const r = await port.call({ modelId: CALL_MODEL, prompt: JSON.stringify(req(sum.hash, rows(2), { budgetUsd: 0.6 })), gatewayHoldUsd: 0.6 });
  ledger.release(0.6);
  assert.equal(r.value.status, 'ok', JSON.stringify(r.value)); assert.equal(during, 0.6, 'held once (by the gateway), not 1.2');
  // The same request without the gateway hold: the host holds it itself.
  const h2 = createCallHost({ registry, mode: 'stub', ledger }); const p2 = h2.port({ budgetUsd: 1 });
  const r2 = await p2.call({ modelId: CALL_MODEL, prompt: JSON.stringify(req(sum.hash, rows(3), { budgetUsd: 0.6 })) });
  assert.equal(r2.value.status, 'ok'); assert.equal(during, 0.6); assert.equal(ledger.reservedUsd, 0);
});
