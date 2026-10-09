// call-host.mjs in stub mode (FLOW-V3 §1–2.1, slice 1): the library registry and the host's handling of call requests,
// in process, with stub callees (no sandbox, no gateway, no model calls). The SDK side over a real gateway and sandboxed
// children is in flow-v3-call.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Ledger } from '../../lib/services.mjs';
import { learnProfile } from '../profile.mjs';
import { createRegistry, createCallHost, libraryHashOf, callKeyOf, inputDigestOf, classifyReuse, withCallModel, CALL_MODEL, REGISTRY_FILE, HARD_MAX_DEPTH, REFUSALS } from '../call-host.mjs';

const OUT = { type: 'object', required: ['total'], properties: { total: { type: 'number' }, note: { type: 'string' } } };
const IN = { type: 'object', required: ['rows'], properties: { rows: { type: 'array', items: { type: 'object' } } } };
const req = (callee, input, o = {}) => ({ v: 1, op: 'call', callee, input, name: o.name ?? 'sub', budgetUsd: o.budgetUsd ?? 0.2, ...(o.span ? { span: o.span } : {}), ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) });
const tmp = t => { const d = mkdtempSync(path.join(tmpdir(), 'jit-ch-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const sumRows = input => input.rows.reduce((s, r) => s + r.amount, 0);
const ROWS = { rows: [{ date: '2026-01-10', amount: 10 }, { date: '2026-01-11', amount: 5 }] };

test('registry: the hash is sha256(solver bytes, NUL, canonical contract); rows are append-only and persist; re-registering bumps the version; revoke; the compiler index', t => {
  const dir = tmp(t);
  writeFileSync(path.join(dir, 'solve.mjs'), 'console.log(1)');
  const reg = createRegistry({ dir });
  const contract = { output: OUT, input: IN, taskTemplate: 'Sum the rows.' };
  const e1 = reg.register({ solvePath: 'solve.mjs', contract, evidence: { runs: 8, rung: 'R1' } });
  assert.equal(e1.hash, libraryHashOf('console.log(1)', { input: IN, output: OUT, taskTemplate: 'Sum the rows.' }));
  assert.match(e1.hash, /^sha256:[0-9a-f]{64}$/); assert.equal(e1.version, 1); assert.equal(e1.revoked, false); assert.equal(e1.solvePath, path.join(dir, 'solve.mjs'));
  assert.equal(libraryHashOf('console.log(1)', { taskTemplate: 'Sum the rows.', output: OUT, input: IN }), e1.hash, 'key order does not matter');
  assert.notEqual(libraryHashOf('console.log(2)', contract), e1.hash); assert.notEqual(libraryHashOf('console.log(1)', { ...contract, taskTemplate: 'x' }), e1.hash);
  const e2 = reg.register({ solvePath: 'solve.mjs', contract, evidence: { runs: 16, rung: 'R1' } });
  assert.equal(e2.hash, e1.hash); assert.equal(e2.version, 2); assert.deepEqual(e2.evidence, { runs: 16, rung: 'R1' });
  assert.throws(() => reg.register({ solvePath: 'solve.mjs', contract, hash: 'sha256:00' }), /does not match/);
  assert.throws(() => reg.register({ solvePath: 'solve.mjs', contract: { input: IN } }), /contract.output/);
  assert.throws(() => reg.register({ solvePath: 'solve.mjs', contract, profile: { n: 1 } }), /profile/);
  reg.revoke(e1.hash, 'silent miss on task 12');
  const again = createRegistry({ dir });   // reloaded from registry.jsonl
  assert.equal(again.get(e1.hash).revoked, true); assert.equal(again.get(e1.hash).revokedReason, 'silent miss on task 12'); assert.equal(again.get(e1.hash).version, 2);
  assert.deepEqual(readFileSync(path.join(dir, REGISTRY_FILE), 'utf8').trim().split('\n').map(l => JSON.parse(l).op), ['register', 'register', 'revoke']);
  assert.deepEqual(again.list().map(x => [x.hash, x.version, x.revoked, x.profileTasks]), [[e1.hash, 2, true, 0]]);
  assert.equal(again.get('sha256:nope'), null);
  assert.deepEqual(withCallModel(['m']), ['m', CALL_MODEL]); assert.equal(withCallModel(null), null);
});

test('createCallHost: maxDepth defaults to 3 and may not exceed the hard ceiling 8; sandbox mode needs a workRoot; one root scope', () => {
  const registry = createRegistry();
  assert.equal(createCallHost({ registry, mode: 'stub' }).maxDepth, 3);
  assert.equal(createCallHost({ registry, mode: 'stub', maxDepth: HARD_MAX_DEPTH }).maxDepth, 8);
  assert.throws(() => createCallHost({ registry, mode: 'stub', maxDepth: 9 }), /1\.\.8/);
  assert.throws(() => createCallHost({ registry }), /workRoot/);
  const host = createCallHost({ registry, mode: 'stub' });
  assert.throws(() => host.port({}), /budgetUsd/);
  host.port({ budgetUsd: 1 }); assert.throws(() => host.port({ budgetUsd: 1 }), /one root scope/);
});

test('nested two levels: budgets are carved (strictly below the remaining), spend rolls up span by span, reservations return; at the third level an unknown hash and a recursion are refused', async () => {
  const registry = createRegistry();
  const seen = {};
  const leaf = registry.register({ contract: { input: IN, output: OUT }, stub: async (input, ctx) => {
    seen.leaf = { depth: ctx.depth, path: ctx.path, budgetUsd: ctx.budgetUsd };
    const deeper = await ctx.call(req(leaf.hash + 'x', input, { name: 'too-deep', budgetUsd: 0.01 }));   // unknown, but depth is checked after the hash
    const self = await ctx.call(req(mid.hash, input, { name: 'back-up', budgetUsd: 0.01 }));
    return { output: { total: sumRows(input), note: `${deeper.refused}/${self.refused}` }, costUsd: 0.03 };
  } });
  const mid = registry.register({ contract: { input: IN, output: OUT }, stub: async (input, ctx) => {
    seen.mid = { depth: ctx.depth, path: ctx.path, budgetUsd: ctx.budgetUsd };
    const tooBig = await ctx.call(req(leaf.hash, input, { name: 'leaf', budgetUsd: 0.4 }));    // = mid's whole budget: not strictly below
    const r = await ctx.call(req(leaf.hash, input, { name: 'leaf', budgetUsd: 0.25 }));
    return { output: { total: r.output.total * 2, note: `${tooBig.refused}; ${r.output.note}` }, costUsd: 0.05 };
  } });
  const ledger = new Ledger({ capUsd: 1, label: 'root' });
  const host = createCallHost({ registry, mode: 'stub', maxDepth: 2, ledger, arm: 'cur-1', taskKey: 'wbed-r4:dev:d3:1' });
  host.port({ budgetUsd: 1 });
  const holds = [];
  const origHold = ledger.hold.bind(ledger); ledger.hold = usd => { holds.push(usd); origHold(usd); };
  const v = await host.request(req(mid.hash, ROWS, { name: 'mid', budgetUsd: 0.4 }));
  assert.equal(v.status, 'ok'); assert.deepEqual(v.output, { total: 30, note: 'budget-exceeds-parent; unknown-hash/recursion' });
  assert.equal(v.span, 'call:mid#0'); assert.equal(v.path, 'root/call:mid#0'); assert.equal(v.depth, 1); assert.equal(v.spentUsd, 0.08); assert.equal(v.reservedUsd, 0.4);
  assert.deepEqual(seen.mid, { depth: 1, path: 'root/call:mid#0', budgetUsd: 0.4 });
  assert.deepEqual(seen.leaf, { depth: 2, path: 'root/call:mid#0/call:leaf#1', budgetUsd: 0.25 }, 'the refused request used ordinal 0');
  assert.deepEqual(holds, [0.4], 'the root gateway ledger held the child reservation while it ran');
  assert.equal(ledger.reservedUsd, 0, 'and released it');
  // Events, innermost first (a call's event is written when it ends).
  const ev = host.events.map(e => [e.kind, e.path ?? e.name, e.refused ?? null, e.depth, e.spentUsd]);
  assert.deepEqual(ev, [
    ['call-refused', 'root/call:mid#0/call:leaf#0', 'budget-exceeds-parent', 2, 0],
    ['call-refused', 'root/call:mid#0/call:leaf#1/call:too-deep#0', 'unknown-hash', 3, 0],
    ['call-refused', 'root/call:mid#0/call:leaf#1/call:back-up#0', 'recursion', 3, 0],
    ['call-end', 'root/call:mid#0/call:leaf#1', null, 2, 0.03],
    ['call-end', 'root/call:mid#0', null, 1, 0.08]]);
  assert.deepEqual(host.events[0].refusedDetail, { budgetUsd: 0.4, remainingUsd: 0.4 });
  assert.deepEqual(host.spans().map(s => [s.path, s.spentUsd, s.reservedUsd]), [
    ['root', 0.08, 0], ['root/call:mid#0', 0.03, 0], ['root/call:mid#0/call:leaf#1', 0, 0]]);
  for (const e of host.events) { assert.equal(e.arm, 'cur-1'); assert.equal(e.taskKey, 'wbed-r4:dev:d3:1'); }
});

test('depth: the call that would run at depth maxDepth + 1 is refused with reason depth; maxDepth 1 refuses any grandchild', async () => {
  const registry = createRegistry();
  const c = registry.register({ contract: { output: OUT }, stub: async (input, ctx) => ({ output: { total: ctx.depth } }) });
  const b = registry.register({ contract: { output: OUT }, evidence: { id: 'b' }, stub: async (input, ctx) => {
    const x = await ctx.call(req(c.hash, input, { name: 'c', budgetUsd: 0.05 })); return { output: { total: x.output?.total ?? -1, note: x.refused ?? 'ran' } }; } });
  const run = async maxDepth => {
    const host = createCallHost({ registry, mode: 'stub', maxDepth });
    host.port({ budgetUsd: 1 });
    return { v: await host.request(req(b.hash, {}, { name: 'b', budgetUsd: 0.1 })), host };
  };
  const one = await run(1);
  assert.deepEqual(one.v.output, { total: -1, note: 'depth' });
  assert.deepEqual(one.host.events[0].refusedDetail, { depth: 2, maxDepth: 1 });
  const two = await run(2);
  assert.deepEqual(two.v.output, { total: 2, note: 'ran' });
});

test('idempotency: a repeat of (callee, input, parent span path) is served from the memo at $0 without running the callee; another parent path runs it; a journal replays it', async () => {
  const registry = createRegistry();
  let runs = 0;
  const sum = registry.register({ contract: { input: IN, output: OUT }, stub: async input => { runs++; return { output: { total: sumRows(input) }, costUsd: 0.02 }; } });
  const wrap = registry.register({ contract: { input: IN, output: OUT }, stub: async (input, ctx) => ({ output: (await ctx.call(req(sum.hash, input, { name: 'sum', budgetUsd: 0.05 }))).output }) });
  const host = createCallHost({ registry, mode: 'stub' });
  host.port({ budgetUsd: 1 });
  const a = await host.request(req(sum.hash, ROWS, { name: 'sum', budgetUsd: 0.1 }));
  const b = await host.request(req(sum.hash, JSON.parse(JSON.stringify({ rows: ROWS.rows.map(r => ({ amount: r.amount, date: r.date })) })), { name: 'sum', budgetUsd: 0.1 }));
  assert.deepEqual(b.output, a.output); assert.equal(runs, 1, 'the repeat did not run the callee');
  assert.equal(a.key, b.key); assert.equal(a.key, callKeyOf({ callee: sum.hash, inputDigest: inputDigestOf(ROWS), parentPath: 'root' }));
  assert.equal(b.memo, 'repeat'); assert.equal(b.spentUsd, 0); assert.equal(b.reservedUsd, 0); assert.equal(a.spentUsd, 0.02);
  assert.equal(b.span, 'call:sum#1', 'a memo hit still gets its own span');
  await host.request(req(wrap.hash, ROWS, { name: 'wrap', budgetUsd: 0.1 }));
  assert.equal(runs, 2, 'the same callee and input under another parent path is another key');
  assert.equal(host.spans()[0].spentUsd, 0.04);
  // Replay: a fresh host given the journal serves both keys at $0.
  const rows = host.journalRows();
  assert.equal(rows.length, 3);
  const replay = createCallHost({ registry, mode: 'stub', journal: rows });
  replay.port({ budgetUsd: 1 });
  const c = await replay.request(req(sum.hash, ROWS, { name: 'sum', budgetUsd: 0.1 }));
  assert.equal(c.memo, 'replay'); assert.deepEqual(c.output, a.output); assert.equal(runs, 2);
  assert.equal(replay.events[0].memo, 'replay');
});

test('applicability: an input outside the callee\'s proven profile is refused (outside-profile) with the fields the reuse metrics need; an input inside it runs', async t => {
  const workRoot = tmp(t);
  const T = 'Close the books for one subsidiary.';
  const iso = (i, k) => `2026-0${1 + (i % 9)}-${String(10 + k).padStart(2, '0')}`, dmy = (i, k) => `${10 + k}/0${1 + (i % 9)}/2026`;
  const mk = (i, date) => ({ entity: `S${i}`, rows: Array.from({ length: 3 + (i % 3) }, (_, k) => ({ date: date(i, k), amount: 100 + i * 7 + k })) });
  const profile = learnProfile(Array.from({ length: 6 }, (_, i) => ({ prompt: T, inputs: mk(i, iso) })));
  const registry = createRegistry();
  const r1 = registry.register({ contract: { input: IN, output: OUT, taskTemplate: T }, profile, evidence: { rung: 'R1', runs: 6 }, stub: async input => ({ output: { total: sumRows(input) } }) });
  const host = createCallHost({ registry, mode: 'stub', workRoot, arm: 'cur-1', taskKey: 't1' });
  host.port({ budgetUsd: 1 });
  const inside = await host.request(req(r1.hash, mk(7, iso), { name: 'close' }));
  assert.equal(inside.status, 'ok');
  const out = await host.request(req(r1.hash, mk(7, dmy), { name: 'close' }));
  assert.equal(out.status, 'refused'); assert.equal(out.refused, 'outside-profile'); assert.equal(out.spentUsd, 0);
  assert.deepEqual(out.detail.reasons.map(r => [r.feature, r.path]), [['pattern-class', 'inputs.rows[].date'], ['shape', 'inputs.rows[].date']]);
  const [okEv, refEv] = host.events;
  assert.deepEqual(okEv.applicability.checked && okEv.applicability.novel, false);
  assert.equal(okEv.kind, 'call-end'); assert.equal(refEv.kind, 'call-refused'); assert.equal(refEv.refused, 'outside-profile');
  assert.equal(refEv.applicability.novel, true); assert.equal(refEv.applicability.n, 6); assert.ok(refEv.applicability.score > 1);
  // What the oracle pass needs: callee + version + evidence, the input (content addressed under workRoot), the output.
  assert.equal(refEv.callee, r1.hash); assert.equal(refEv.calleeVersion, 1); assert.deepEqual(refEv.calleeEvidence, { rung: 'R1', runs: 6 });
  assert.deepEqual(JSON.parse(readFileSync(path.join(workRoot, refEv.inputFile), 'utf8')), mk(7, dmy));
  assert.equal(refEv.inputDigest, inputDigestOf(mk(7, dmy)));
  assert.deepEqual(JSON.parse(readFileSync(path.join(workRoot, okEv.outputFile), 'utf8')), { total: sumRows(mk(7, iso)) });
  assert.equal(classifyReuse(okEv, { oraclePass: true }), 'correct'); assert.equal(classifyReuse(okEv, { oraclePass: false }), 'wrong');
  assert.equal(classifyReuse(refEv), 'refused-profile'); assert.equal(classifyReuse(refEv, { calleeWouldPass: true }), 'missed');
  assert.equal(classifyReuse(refEv, { calleeWouldPass: false }), 'refused-correctly');
  const file = path.join(workRoot, 'events.jsonl');
  assert.equal(host.writeEvents(file), 2); assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 2);
});

test('typed return: an output outside contract.output is a child deopt of kind output-schema (never memoised); a callee deopt and a crash surface as deopts', async () => {
  const registry = createRegistry();
  let runs = 0;
  const bad = registry.register({ contract: { output: OUT }, stub: async () => { runs++; return { output: { total: 'twelve' }, costUsd: 0.01 }; } });
  const guard = registry.register({ contract: { output: OUT }, evidence: { g: 1 }, stub: async () => ({ status: 'deopt', deopt: { kind: 'guard', name: 'known-dialects', detail: { unseen: ['x'] } }, costUsd: 0.02 }) });
  const boom = registry.register({ contract: { output: OUT }, evidence: { g: 2 }, stub: async () => { throw new Error('boom'); } });
  const host = createCallHost({ registry, mode: 'stub' });
  host.port({ budgetUsd: 1 });
  const a = await host.request(req(bad.hash, {}, { name: 'bad' }));
  assert.equal(a.status, 'deopt'); assert.equal(a.childStatus, 'invalid'); assert.equal(a.deopt.kind, 'output-schema'); assert.match(JSON.stringify(a.deopt.detail), /total/);
  assert.equal(a.spentUsd, 0.01, 'a deopted child is still charged');
  await host.request(req(bad.hash, {}, { name: 'bad' }));
  assert.equal(runs, 2, 'a failed call is not memoised');
  const g = await host.request(req(guard.hash, {}, { name: 'g' }));
  assert.deepEqual([g.status, g.childStatus, g.deopt], ['deopt', 'deopt', { kind: 'guard', name: 'known-dialects', detail: { unseen: ['x'] } }]);
  const c = await host.request(req(boom.hash, {}, { name: 'boom' }));
  assert.deepEqual([c.status, c.childStatus, c.deopt.kind], ['deopt', 'crash', 'crash']); assert.match(c.deopt.detail.message, /boom/);
  assert.deepEqual(host.events.map(e => e.kind), ['call-deopt', 'call-deopt', 'call-deopt', 'call-deopt']);
  assert.equal(host.spans()[0].spentUsd, 0.04);
});

test('refusals: bad-request, unknown-hash, revoked, recursion (the root\'s own hash), effects, input-schema, BUDGET_TOO_SMALL, budget-exceeds-parent, tree-size', async () => {
  const registry = createRegistry();
  const okStub = async input => ({ output: { total: sumRows(input) } });
  const good = registry.register({ contract: { input: IN, output: OUT }, stub: okStub });
  const gone = registry.register({ contract: { input: IN, output: OUT, taskTemplate: 'gone' }, stub: okStub });   // the hash covers bytes + contract
  registry.revoke(gone.hash, 'superseded');
  const fx = registry.register({ contract: { input: IN, output: OUT, taskTemplate: 'fx' }, effects: 'writes-ledger', stub: okStub });
  const pricey = registry.register({ contract: { input: IN, output: OUT, taskTemplate: 'pricey' }, minBudgetUsd: 0.5, stub: okStub });
  const host = createCallHost({ registry, mode: 'stub', maxChildren: 1 });
  host.port({ budgetUsd: 1, selfHash: good.hash });
  const why = async r => { const v = await host.request(r); return v.status === 'refused' ? v.refused : v.status; };
  assert.equal(await why({ op: 'call' }), 'bad-request');
  assert.equal(await why({ ...req(good.hash, ROWS), budgetUsd: 0 }), 'bad-request');
  assert.equal(await why(req('sha256:' + '0'.repeat(64), ROWS)), 'unknown-hash');
  assert.equal(await why(req(gone.hash, ROWS)), 'revoked');
  assert.equal(await why(req(good.hash, ROWS)), 'recursion');
  assert.equal(await why(req(fx.hash, ROWS)), 'effects');
  assert.equal(await why(req(pricey.hash, { rows: 'nope' })), 'input-schema');
  assert.equal(await why(req(pricey.hash, ROWS, { budgetUsd: 0.2 })), 'BUDGET_TOO_SMALL');
  assert.equal(await why(req(pricey.hash, ROWS, { budgetUsd: 1 })), 'budget-exceeds-parent');
  assert.equal(await why(req(pricey.hash, ROWS, { budgetUsd: 0.6 })), 'ok');
  assert.equal(await why(req(pricey.hash, { rows: [] }, { budgetUsd: 0.3 })), 'tree-size', 'one child per tree here');
  const seen = new Set(host.events.filter(e => e.kind === 'call-refused').map(e => e.refused));
  for (const r of seen) assert.ok(REFUSALS.includes(r), r);
  assert.equal(host.events.at(-1).spentUsd, 0);
});

test('the port: model requests pass through to the real port and are booked under the scope; while a child holds budget, a model call that does not fit next to it is refused', async () => {
  const registry = createRegistry();
  const calls = [];
  const modelPort = { policy: { models: [{ id: 'm', provider: 'p', price: { inputPerMTok: 0, outputPerMTok: 10 } }] }, providers: {}, policyHash: 'ph',
    async call(r) { calls.push(r.modelId); return { ok: true, value: { x: 1 }, costUsd: 0.01, modelId: r.modelId }; } };
  let release;
  const slow = registry.register({ contract: { output: OUT }, stub: () => new Promise(res => { release = () => res({ output: { total: 1 } }); }) });
  const host = createCallHost({ registry, modelPort, mode: 'stub' });
  const port = host.port({ budgetUsd: 0.2 });
  assert.equal(port.policyHash, 'ph');
  const r = await port.call({ modelId: 'm', prompt: 'p', schema: {} });
  assert.equal(r.costUsd, 0.01); assert.deepEqual(calls, ['m']);
  const pending = port.call({ modelId: CALL_MODEL, prompt: JSON.stringify(req(slow.hash, {}, { name: 'slow', budgetUsd: 0.15 })) });
  await new Promise(res => setImmediate(res));
  // 0.01 spent + 0.15 held + this call's reservation (8000 output tokens at $10/MTok = 0.08) > 0.2
  await assert.rejects(port.call({ modelId: 'm', prompt: 'p', schema: {} }), e => e.code === 'GATEWAY_BUDGET');
  release();
  const done = await pending;
  assert.equal(done.ok, true); assert.equal(done.modelId, CALL_MODEL); assert.equal(done.value.status, 'ok'); assert.deepEqual(done.value.output, { total: 1 });
  await port.call({ modelId: 'm', prompt: 'p', schema: {} });
  assert.equal(host.spans()[0].spentUsd, 0.02); assert.equal(host.spans()[0].calls, 2);
});
