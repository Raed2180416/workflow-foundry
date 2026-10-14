// flow-v3 slice 2a end to end (design/FLOW-V3-SLICE2.md): the SDK's new call options (per-call prompt, onRefuse/onDeopt
// 'interpret' and 'skip'), the BUDGET_TREE refusal under map, flow.phase spans, and the gateway's flow:call handling
// (services.mjs: the reservation held on the session Ledger, gatewayHoldUsd, 402 only when spent). Part 1 runs a solver as a
// plain process against startServices with a stub-mode call host; part 2 runs in the B1 sandbox (runCompiled with
// flowScope, a caller-made Ledger, meta.childCalls) and checks run-level resume (createResumePort). No model calls; $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MODEL_TOOL } from '../../c0/construct.mjs';
import { startServices, Ledger, FLOW_CALL_MODEL } from '../../lib/services.mjs';
import { sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { ModelPort } from '../../../src/models/port.mjs';
import { Journal } from '../../../src/journal.mjs';
import { ScriptedProvider } from '../../../src/models/providers/scripted.mjs';
import { subsetPolicy } from '../../lib/models.mjs';
import { runCompiled, createResumePort, requestDigestOf, FLOW_V3 as RC_FLOW_V3, SCOPE_FILE } from '../run-compiled.mjs';
import { createRegistry, createCallHost, withCallModel, CALL_MODEL, FLOW_V3 } from '../call-host.mjs';

const HAIKU = 'claude-haiku-5-5';
const OUT = { type: 'object', required: ['total'], properties: { total: { type: 'number' }, by: { type: 'string' } } };
const ROWS = { rows: [{ amount: 10 }, { amount: 5 }] };
const tmp = (t, p = 'jit-v3s2-') => { const d = mkdtempSync(path.join(tmpdir(), p)); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const STUB_POLICY = { models: [{ id: HAIKU, provider: 'p', price: { inputPerMTok: 0, outputPerMTok: 0 } }] };
const stubModelPort = (costUsd = 0.01) => ({ policy: STUB_POLICY, providers: {}, policyHash: 'stub', async call(r) { return { ok: true, value: { quote: 'hello' }, costUsd, modelId: r.modelId }; } });

async function runRoot(t, { source, registry, budgetUsd = 1, capUsd = budgetUsd, hostOpts = {}, task = { prompt: 'p', inputs: ROWS } }) {
  const dir = tmp(t, 'jit-v3s2p-');
  mkdirSync(path.join(dir, 'tools'));
  const ledger = new Ledger({ capUsd, label: 'root' });
  const host = createCallHost({ registry, mode: 'stub', modelPort: stubModelPort(), ...hostOpts });
  const svc = await startServices({ modelPort: host.port({ budgetUsd, ledger }), ledger, allowedModels: [HAIKU] });   // flow:call needs no allow-list entry now
  writeFileSync(path.join(dir, 'tools/model.mjs'), MODEL_TOOL); copyFileSync(FLOW_V3, path.join(dir, 'tools/flow.mjs'));
  writeFileSync(path.join(dir, 'tools/gateway.json'), JSON.stringify({ url: svc.url, token: svc.token }));
  writeFileSync(path.join(dir, 'task.json'), JSON.stringify(task));
  writeFileSync(path.join(dir, 'solve.mjs'), `import { createFlow } from './tools/flow.mjs';\n${source}`);
  const child = spawn(process.execPath, ['solve.mjs', 'task.json'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
  const code = await new Promise(resolve => child.on('close', resolve));
  await svc.close({ graceMs: 1000 });
  const deopt = existsSync(path.join(dir, 'deopt.json')) ? JSON.parse(readFileSync(path.join(dir, 'deopt.json'), 'utf8')) : null;
  const last = stdout.trim().split('\n').filter(Boolean).at(-1);
  return { code, stderr, trace: lines(path.join(dir, 'trace.jsonl')), deopt, output: last === undefined ? undefined : JSON.parse(last), host, ledger };
}

function library({ during = null } = {}) {
  const registry = createRegistry();
  const prompts = [];
  // A callee that only accepts inputs whose rows have an 'amount' (a profile stand-in: an input-schema refusal is not
  // interpretable, so 'outside' is simulated by revoking a second entry).
  const sum = registry.register({ contract: { output: OUT, taskTemplate: 'Sum the rows.' }, stub: async (input, ctx) => {
    prompts.push(ctx.prompt); if (during) during(); return { output: { total: input.rows.reduce((s, r) => s + r.amount, 0) }, costUsd: 0.03 }; } });
  const old = registry.register({ contract: { output: OUT, taskTemplate: 'Old sum.' }, stub: async () => ({ output: { total: -1 }, costUsd: 0.03 }) });
  registry.revoke(old.hash, 'superseded');
  const guarded = registry.register({ contract: { output: OUT, taskTemplate: 'Guarded.' }, stub: async () => ({ status: 'deopt', deopt: { kind: 'guard', name: 'known-dialects', detail: null }, costUsd: 0.02 }) });
  return { registry, sum, old, guarded, prompts };
}
const interpreter = (costUsd = 0.05) => { const calls = []; return { calls, fn: async a => { calls.push(a); return { answer: { total: a.task.inputs.rows.reduce((s, r) => s + r.amount, 0), by: 'interpreter' }, costUsd, traceId: `it${calls.length}` }; } }; };
const ofKind = (trace, ...kinds) => trace.filter(e => kinds.includes(e.kind));

test('flow.call prompt and onRefuse interpret: a revoked callee is answered by the host\'s interpreter; the trace says interpret-child (localDeopt) and the totals count it; the prompt reaches the child', async t => {
  const lib = library(), it = interpreter(0.05);
  const r = await runRoot(t, { registry: lib.registry, hostOpts: { interpreter: it.fn }, source: `const flow = createFlow({ budgetUsd: 1 });
const task = flow.input();
const a = await flow.call('${lib.sum.hash}', task.inputs, { name: 'S1', budgetUsd: 0.2, prompt: 'Sum the rows of S1.' });
const b = await flow.call('${lib.old.hash}', task.inputs, { name: 'S2', budgetUsd: 0.2, onRefuse: 'interpret' });
const c = await flow.call('${lib.old.hash}', task.inputs, { name: 'S3', budgetUsd: 0.2, onRefuse: 'skip' });
flow.done({ a, b, c, spent: flow.spent() });` });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.output.a, { total: 15 }); assert.deepEqual(r.output.b, { total: 15, by: 'interpreter' });
  assert.deepEqual(r.output.c, { refused: 'revoked', detail: { reason: 'superseded' } }, "'skip' hands the refusal to the caller's code");
  assert.deepEqual(lib.prompts, ['Sum the rows of S1.']);
  assert.equal(r.output.spent.spentUsd, 0.08, 'the child $0.03 and the interpreter $0.05');
  const [s0] = ofKind(r.trace, 'call-start');
  assert.match(s0.promptDigest, /^[0-9a-f]{64}$/);
  const ic = ofKind(r.trace, 'interpret-child')[0];
  assert.equal(ic.ok, true); assert.equal(ic.localDeopt, true); assert.equal(ic.refused, 'revoked'); assert.equal(ic.interpreted.by, 'interpreter'); assert.equal(ic.spentUsd, 0.05); assert.equal(ic.span, 'call:S2#0');
  assert.deepEqual(ofKind(r.trace, 'call-start')[1].localDeopt, { onRefuse: 'interpret', onDeopt: 'propagate' });
  const done = r.trace.at(-1);
  assert.equal(done.childCalls, 3); assert.equal(done.interpretedChildren, 1);
  assert.equal(it.calls[0].reason, 'revoked'); assert.equal(it.calls[0].budgetUsd, 0.2);
  assert.deepEqual(r.host.events.map(e => [e.kind, e.name]), [['call-end', 'S1'], ['interpret-child', 'S2'], ['call-refused', 'S3']]);
  assert.equal(r.ledger.spentUsd, 0.08); assert.equal(r.ledger.reservedUsd, 0);
});

test('onRefuse interpret that the host cannot honour deopts the caller (kind call); onDeopt interpret replaces a child deopt; onDeopt skip returns it', async t => {
  const lib = library();
  const none = await runRoot(t, { registry: lib.registry, source: `const flow = createFlow({ budgetUsd: 1 });
await flow.call('${lib.old.hash}', {}, { name: 'S2', budgetUsd: 0.2, onRefuse: 'interpret' });
flow.done('never');` });
  assert.equal(none.code, 75); assert.equal(none.deopt.kind, 'call'); assert.equal(none.deopt.detail.refused, 'revoked'); assert.deepEqual(none.deopt.detail.detail.interpret, { refused: 'no-interpreter' });
  const it = interpreter(0.04);
  const dd = await runRoot(t, { registry: lib.registry, hostOpts: { interpreter: it.fn }, source: `const flow = createFlow({ budgetUsd: 1 });
const task = flow.input();
const a = await flow.call('${lib.guarded.hash}', task.inputs, { name: 'g', budgetUsd: 0.3, onDeopt: 'interpret' });
const b = await flow.call('${lib.guarded.hash}', { rows: [] }, { name: 'h', budgetUsd: 0.3, onDeopt: 'skip' });
flow.done({ a, b });` });
  assert.equal(dd.code, 0, dd.stderr);
  assert.deepEqual(dd.output.a, { total: 15, by: 'interpreter' }); assert.equal(dd.output.b.status, 'deopt'); assert.equal(dd.output.b.deopt.kind, 'guard');
  const ic = ofKind(dd.trace, 'interpret-child')[0];
  assert.deepEqual(ic.replaced, { kind: 'guard', name: 'known-dialects' }); assert.equal(ic.spentUsd, 0.06, 'child $0.02 + interpreter $0.04');
  assert.equal(it.calls[0].budgetUsd, 0.28);
});

test('budget under map: three concurrent calls of $0.4 under $1: two run, the third is refused BUDGET_TREE (by the SDK) with the shortfall; one at a time all three run', async t => {
  const lib = library();
  const r = await runRoot(t, { registry: lib.registry, source: `const flow = createFlow({ budgetUsd: 1 });
const task = flow.input();
const out = await flow.map([0, 1, 2], i => flow.call('${lib.sum.hash}', { rows: [{ amount: i }] }, { name: 'S' + i, budgetUsd: 0.4, onRefuse: 'skip' }), { concurrency: 3 });
flow.done(out);` });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.output.slice(0, 2), [{ total: 0 }, { total: 1 }]);
  assert.equal(r.output[2].refused, 'BUDGET_TREE');
  assert.deepEqual(r.output[2].detail, { budgetUsd: 0.4, remainingUsd: 0.2, shortfallUsd: 0.2, inFlight: 2, reservedInFlightUsd: 0.8, parentBudgetUsd: 1, parentSpentUsd: 0 });
  assert.equal(ofKind(r.trace, 'call-refused')[0].by, 'sdk');
  const seq = await runRoot(t, { registry: lib.registry, source: `const flow = createFlow({ budgetUsd: 1 });
const out = await flow.map([0, 1, 2], i => flow.call('${lib.sum.hash}', { rows: [{ amount: i }] }, { name: 'S' + i, budgetUsd: 0.4 }), { concurrency: 1 });
flow.done(out);` });
  assert.equal(seq.code, 0, seq.stderr); assert.deepEqual(seq.output, [{ total: 0 }, { total: 1 }, { total: 2 }]);
});

test('the gateway holds a flow:call reservation on the session Ledger while the child runs and tells the host (no double hold); flow:call is outside allowedModels; 402 only when spent', async t => {
  let reservedDuring = null, ledgerRef = null;
  const lib = library({ during: () => { reservedDuring = ledgerRef.reservedUsd; } });
  const dir = tmp(t);
  // Drive the gateway directly: a POST /model with model flow:call, as tools/model.mjs sends it.
  const ledger = new Ledger({ capUsd: 1, label: 'gw' }); ledgerRef = ledger;
  const host = createCallHost({ registry: lib.registry, mode: 'stub', modelPort: stubModelPort() });
  const svc = await startServices({ modelPort: host.port({ budgetUsd: 1, ledger }), ledger, allowedModels: [HAIKU], socketDir: dir });
  t.after(() => svc.close({ graceMs: 100 }));
  const post = async body => {
    const http = await import('node:http');
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const rq = http.request({ socketPath: svc.socket, path: '/model', method: 'POST', headers: { authorization: `Bearer ${svc.token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, res => {
        let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      });
      rq.on('error', reject); rq.end(data);
    });
  };
  // (each request a new input: a repeat of (callee, input, parent path) is a $0 memo hit before any budget check)
  const ask = (budgetUsd, name = 's', input = { rows: [{ amount: budgetUsd }] }) => post({ model: FLOW_CALL_MODEL, prompt: JSON.stringify({ v: 1, op: 'call', callee: lib.sum.hash, input, name, budgetUsd }), schema: { type: 'object' } });
  const ok = await ask(0.4);
  assert.equal(ok.status, 200); assert.equal(ok.body.value.status, 'ok'); assert.equal(reservedDuring, 0.4, 'held once, by the gateway'); assert.equal(ledger.reservedUsd, 0);
  assert.equal(ok.body.costUsd, 0.03); assert.equal(ledger.spentUsd, 0.03);
  const big = await ask(0.98, 'big');
  assert.equal(big.status, 200, JSON.stringify(big.body)); assert.equal(big.body.value?.refused, 'budget-exceeds-parent', 'a reservation that does not fit is passed on unheld: the host refuses it, typed');
  assert.equal((await post({ model: 'claude-opus-5-5', prompt: 'x' })).status, 403, 'other models still need the allow-list');
  assert.equal(CALL_MODEL, FLOW_CALL_MODEL);
  ledger.spentUsd = 1;
  assert.equal((await ask(0.1, 'late')).status, 402);
});

test('flow.phase: phase-start/phase-end span events (nested, ordinals per name), events inside carry phase, a throw ends the phase not ok, totals count phases', async t => {
  const lib = library();
  const r = await runRoot(t, { registry: lib.registry, source: `const flow = createFlow({ budgetUsd: 1 });
const task = flow.input();
const total = await flow.phase('children', async () => {
  const a = await flow.call('${lib.sum.hash}', task.inputs, { name: 'S1', budgetUsd: 0.2 });
  const n = await flow.phase('count', () => flow.step('count', () => task.inputs.rows.length));
  return a.total + n;
});
flow.note('after', { total });
let caught = null;
try { await flow.phase('fails', async () => { throw new Error('boom'); }); } catch (e) { caught = e.message; }
await flow.map([1, 2], x => flow.phase('item', async () => flow.step('item', () => x)), { concurrency: 2 });
flow.done({ total, caught });` });
  assert.equal(r.code, 0, r.stderr); assert.deepEqual(r.output, { total: 17, caught: 'boom' });
  const ph = ofKind(r.trace, 'phase-start', 'phase-end').map(e => [e.kind, e.span, e.parent, e.phase ?? null, e.ok ?? null]);
  assert.deepEqual(ph.slice(0, 4), [['phase-start', 'phase:children#0', 'root', null, null], ['phase-start', 'phase:count#0', 'phase:children#0', 'phase:children#0', null],
    ['phase-end', 'phase:count#0', 'phase:children#0', 'phase:children#0', true], ['phase-end', 'phase:children#0', 'root', null, true]]);
  const failed = ofKind(r.trace, 'phase-end').find(e => e.span === 'phase:fails#0');
  assert.equal(failed.ok, false); assert.equal(failed.error, 'boom');
  assert.equal(ofKind(r.trace, 'call-start')[0].phase, 'phase:children#0'); assert.equal(ofKind(r.trace, 'step').find(e => e.name === 'count').phase, 'phase:count#0');
  assert.equal(ofKind(r.trace, 'phase-end').find(e => e.span === 'phase:children#0').spentUsd, 0.03);
  assert.equal(r.trace.find(e => e.kind === 'note').phase, undefined, 'after the phase, no phase');
  assert.deepEqual(ofKind(r.trace, 'step').filter(e => e.name === 'item').map(e => e.phase).sort(), ['phase:item#0', 'phase:item#1'], 'concurrent phases keep their own context');
  assert.equal(r.trace.at(-1).phases, 5);
});

// ---- part 2: the sandbox (runCompiled) and run-level resume ----
const skip = sandboxAvailable() ? false : 'no user namespaces';
const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5'];
const policy = subsetPolicy(loadPolicy().policy, MODELS);
const scriptedPort = (counter = { n: 0 }) => new ModelPort({ policy, journal: new Journal(new DatabaseSync(':memory:')),
  providers: { 'claude-cli': new ScriptedProvider(() => { counter.n++; return { value: { factor: 2 }, costUsd: 0.02 }; }) } });

test('createResumePort: completed requests come back at $0; the first request the prior run lacks, and everything after it, go live; failed ones rerun; flow:call answers say memo resume', async () => {
  const live = { n: 0, policy: null, async call(r) { this.n++; if (r.prompt === 'fail') return { ok: false, error: { code: 'MODEL_SCHEMA' }, costUsd: 0.01 }; return { ok: true, value: { echo: r.prompt, n: this.n }, costUsd: 0.02 }; } };
  const req = (prompt, modelId = HAIKU) => ({ modelId, system: '', prompt, schema: { type: 'object' }, decoding: {} });
  const first = createResumePort({ live });
  for (const p of ['a', 'b', 'fail', 'c', 'a']) await first.call(req(p));
  const prior = first.rows();
  assert.deepEqual(prior.map(r => [r.seq, r.occurrence, r.ok]), [[0, 0, true], [1, 0, true], [2, 0, false], [3, 0, true], [4, 1, true]]);
  assert.equal(prior[0].digest, requestDigestOf(req('a')));
  // Same requests: served up to the failed one, which reruns, and everything after it is live.
  live.n = 0;
  const same = createResumePort({ prior, live });
  const got = []; for (const p of ['a', 'b', 'fail', 'c', 'a']) got.push(await same.call(req(p)));
  assert.deepEqual(got.map(g => !!g.resumed), [true, true, false, false, false]); assert.equal(got[0].costUsd, 0); assert.deepEqual(got[0].value, { echo: 'a', n: 1 });
  assert.deepEqual(same.stats(), { requests: 5, served: 2, live: 3, diverged: true, divergedAt: { seq: 2, digest: requestDigestOf(req('fail')).slice(0, 16), modelId: HAIKU, reason: 'failed-before' }, priorRows: 5 });
  // A changed second prompt: the first is served, the rest live, even an identical later request ('c').
  const changed = createResumePort({ prior, live });
  const g2 = []; for (const p of ['a', 'B', 'c']) g2.push(await changed.call(req(p)));
  assert.deepEqual(g2.map(g => !!g.resumed), [true, false, false]); assert.equal(changed.stats().divergedAt.reason, 'new-request');
  // flow:call answers are marked memo 'resume' and cost nothing.
  const callLive = { async call() { return { ok: true, value: { status: 'ok', output: { total: 1 }, spentUsd: 0.03 }, costUsd: 0.03 }; } };
  const c1 = createResumePort({ live: callLive }); await c1.call(req('{"v":1}', CALL_MODEL));
  const c2 = createResumePort({ prior: c1.rows(), live: callLive }); const v = await c2.call(req('{"v":1}', CALL_MODEL));
  assert.equal(v.value.memo, 'resume'); assert.equal(v.value.spentUsd, 0); assert.equal(v.costUsd, 0);
  assert.throws(() => createResumePort({}), /live port/);
});

const JUDGES = `import { createFlow } from './tools/flow.mjs';
const flow = createFlow({ budgetUsd: 1 });
const task = flow.input();
const schema = { type: 'object', properties: { factor: { type: 'number' } }, required: ['factor'] };
const a = await flow.judge('a', { tiers: ['${HAIKU}'], prompt: 'first', schema });
const b = await flow.judge('b', { tiers: ['${HAIKU}'], prompt: 'second ' + task.inputs.k, schema });
const c = await flow.judge('c', { tiers: ['${HAIKU}'], prompt: 'third', schema });
flow.done({ total: a.factor + b.factor + c.factor });`;

test('sandboxed: runCompiled resume serves a prior run\'s completed calls; a changed prompt reruns it and everything after', { skip }, async t => {
  const root = tmp(t);
  writeFileSync(path.join(root, 'solve.mjs'), JUDGES);
  const counter = { n: 0 }, port = scriptedPort(counter);
  const run = (k, resume, w) => runCompiled({ solvePath: path.join(root, 'solve.mjs'), task: { prompt: 'p', inputs: { k } }, modelPort: port, perTaskUsd: 1, timeoutMs: 60000,
    workdir: path.join(root, w), outputSchema: OUT, allowedModels: MODELS, flowPath: FLOW_V3, label: w, resume });
  const r1 = await run(1, true, 'r1');
  assert.equal(r1.status, 'ok', JSON.stringify(r1.error)); assert.equal(r1.costUsd, 0.06); assert.equal(counter.n, 3); assert.equal(r1.meta.resume.rows.length, 3);
  const r2 = await run(1, r1.meta.resume.rows, 'r2');
  assert.equal(r2.status, 'ok'); assert.equal(r2.costUsd, 0, 'every call came back from the prior run'); assert.equal(counter.n, 3);
  assert.deepEqual({ served: r2.meta.resume.stats.served, live: r2.meta.resume.stats.live }, { served: 3, live: 0 });
  const r3 = await run(2, r1.meta.resume.rows, 'r3');
  assert.equal(r3.status, 'ok'); assert.equal(r3.costUsd, 0.04, 'the changed second prompt and the third reran'); assert.equal(counter.n, 5);
  assert.deepEqual({ served: r3.meta.resume.stats.served, live: r3.meta.resume.stats.live }, { served: 1, live: 2 });
});

test('sandboxed: runCompiled writes flowScope as tools/flow-scope.json (and clears a stale one), uses a caller-made Ledger, reports meta.childCalls; FLOW_V3 is shared', { skip }, async t => {
  assert.equal(RC_FLOW_V3, FLOW_V3);
  const root = tmp(t);
  const lib = createRegistry();
  writeFileSync(path.join(root, 'leaf.mjs'), `import { createFlow } from './tools/flow.mjs';
const flow = createFlow({ budgetUsd: 0.3 }); const task = flow.input();
const v = await flow.judge('factor', { tiers: ['${HAIKU}'], prompt: 'f', schema: { type: 'object', properties: { factor: { type: 'number' } }, required: ['factor'] } });
flow.done({ total: v.factor * task.inputs.rows.length });`);
  const leaf = lib.register({ solvePath: path.join(root, 'leaf.mjs'), contract: { output: OUT, taskTemplate: 'Leaf.' } });
  writeFileSync(path.join(root, 'root.mjs'), `import { createFlow } from './tools/flow.mjs';
const flow = createFlow({ budgetUsd: 1 }); const task = flow.input();
const a = await flow.call('${leaf.hash}', task.inputs, { name: 'leaf', budgetUsd: 0.3, prompt: 'Leaf for S1.' });
flow.done(a);`);
  const workdir = path.join(root, 'run'); mkdirSync(path.join(workdir, 'tools'), { recursive: true });
  writeFileSync(path.join(workdir, SCOPE_FILE), JSON.stringify({ span: 'call:stale#0', parent: 'root', path: 'root/call:stale#0', depth: 1 }));   // a leftover
  const ledger = new Ledger({ capUsd: 1, label: 'root' });
  const host = createCallHost({ registry: lib, modelPort: scriptedPort(), workRoot: path.join(root, 'calls-root'), allowedModels: MODELS });
  const r = await runCompiled({ solvePath: path.join(root, 'root.mjs'), task: { prompt: 'p', inputs: ROWS }, modelPort: host.port({ budgetUsd: 1, ledger }), perTaskUsd: 1, timeoutMs: 60000,
    workdir, outputSchema: OUT, allowedModels: withCallModel(MODELS), flowPath: FLOW_V3, label: 'root', ledger });
  assert.equal(r.status, 'ok', JSON.stringify(r.error ?? r.deopt)); assert.deepEqual(r.output, { total: 4 });
  assert.equal(existsSync(path.join(workdir, SCOPE_FILE)), false, 'the stale scope file was removed');
  assert.ok(r.trace.filter(e => !e.kind.startsWith('call-')).every(e => !('span' in e)), 'the root run is not in a scope');
  assert.equal(r.meta.childCalls, 1); assert.equal(ledger.spentUsd, 0.02); assert.equal(r.costUsd, 0.02);
  const childTrace = lines(path.join(root, 'calls-root', r.trace.find(e => e.kind === 'call-end').childTrace));
  assert.ok(childTrace.every(e => e.span === 'call:leaf#0' && e.parent === 'root'), 'the child ran in its scope (flowScope)');
  assert.equal(host.events[0].promptDigest.length, 64);
  await assert.rejects(runCompiled({ solvePath: path.join(root, 'root.mjs'), task: { prompt: 'p', inputs: ROWS }, modelPort: scriptedPort(), perTaskUsd: 1, workdir, flowScope: { span: 'x', path: 'root/x', depth: 1 } }), /flowScope needs flow-v3/);
  await assert.rejects(runCompiled({ solvePath: path.join(root, 'root.mjs'), task: { prompt: 'p', inputs: ROWS }, modelPort: scriptedPort(), perTaskUsd: 1, workdir, flowPath: FLOW_V3, ledger: new Ledger({ capUsd: 2 }) }), /capUsd = perTaskUsd/);
});
