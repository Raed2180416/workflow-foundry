// flow.call end to end (FLOW-V3 §2.1, slice 1). Part 1: a flow-v3 solver run as a plain child process against the real
// gateway (startServices over loopback, a Ledger) whose model port is the call host's (stub callees in process). Part 2:
// the B1 sandbox throughout: runCompiled runs the root solver, and the host runs each callee as its own nested runCompiled
// (own sandbox, workdir, trace, carved budget) against a scripted model port. No live model calls; $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { MODEL_TOOL } from '../../c0/construct.mjs';
import { startServices, Ledger } from '../../lib/services.mjs';
import { sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { ModelPort } from '../../../src/models/port.mjs';
import { Journal } from '../../../src/journal.mjs';
import { ScriptedProvider } from '../../../src/models/providers/scripted.mjs';
import { subsetPolicy } from '../../lib/models.mjs';
import { runCompiled } from '../run-compiled.mjs';
import { createRegistry, createCallHost, withCallModel, callKeyOf, inputDigestOf, FLOW_V3 } from '../call-host.mjs';

const HAIKU = 'claude-haiku-5-5';
const OUT = { type: 'object', required: ['total'], properties: { total: { type: 'number' }, note: { type: 'string' } } };
const ROWS = { rows: [{ amount: 10 }, { amount: 5 }] };
const tmp = (t, p = 'jit-v3-') => { const d = mkdtempSync(path.join(tmpdir(), p)); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

// ---- part 1: plain process, real gateway, stub callees ----
const STUB_POLICY = { models: [{ id: HAIKU, provider: 'p', price: { inputPerMTok: 0, outputPerMTok: 0 } }] };
const stubModelPort = (costUsd = 0.01) => ({ policy: STUB_POLICY, providers: {}, policyHash: 'stub', async call(r) { return { ok: true, value: { quote: 'hello' }, costUsd, modelId: r.modelId }; } });

async function runRoot(t, { source, registry, budgetUsd = 1, capUsd = budgetUsd, modelCostUsd = 0.01, maxDepth = 3 }) {
  const dir = tmp(t, 'jit-v3p-');
  mkdirSync(path.join(dir, 'tools'));
  const host = createCallHost({ registry, mode: 'stub', maxDepth, modelPort: stubModelPort(modelCostUsd) });
  const ledger = new Ledger({ capUsd, label: 'root' });
  const svc = await startServices({ modelPort: host.port({ budgetUsd, ledger }), ledger });
  writeFileSync(path.join(dir, 'tools/model.mjs'), MODEL_TOOL); copyFileSync(FLOW_V3, path.join(dir, 'tools/flow.mjs'));
  writeFileSync(path.join(dir, 'tools/gateway.json'), JSON.stringify({ url: svc.url, token: svc.token }));
  writeFileSync(path.join(dir, 'task.json'), JSON.stringify({ prompt: 'p', inputs: ROWS }));
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
const calls = trace => trace.filter(e => e.kind.startsWith('call-'));

function library() {
  const registry = createRegistry();
  let sumRuns = 0;
  const sum = registry.register({ contract: { output: OUT, taskTemplate: 'Sum the rows.' }, stub: async input => { sumRuns++; return { output: { total: input.rows.reduce((s, r) => s + r.amount, 0) }, costUsd: 0.03 }; } });
  const wrongType = registry.register({ contract: { output: OUT, taskTemplate: 'wrong' }, stub: async () => ({ output: { total: 'fifteen' }, costUsd: 0.01 }) });
  const guarded = registry.register({ contract: { output: OUT, taskTemplate: 'guarded' }, stub: async () => ({ status: 'deopt', deopt: { kind: 'guard', name: 'known-dialects', detail: { unseen: ['VENDEX'] } }, costUsd: 0.02 }) });
  return { registry, sum, wrongType, guarded, runs: () => sumRuns };
}

test('flow.call over the gateway: the typed result comes back; call-start/call-end carry span, parent, key and depth; the child\'s cost is charged to the caller', async t => {
  const lib = library();
  const r = await runRoot(t, { registry: lib.registry, source: `const flow = createFlow({ budgetUsd: 1 });
const task = flow.input();
const a = await flow.call('${lib.sum.hash}', task.inputs, { name: 'sum', budgetUsd: 0.2 });
const b = await flow.call({ hash: '${lib.sum.hash}' }, task.inputs, { label: 'sum', budgetUsd: 0.2 });   // the same key: memo
const v = await flow.judge('q', { tiers: ['${HAIKU}'], prompt: 'q', schema: { type: 'object' } });
flow.done({ a, b, v, spent: flow.spent() });` });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.output.a, { total: 15 }); assert.deepEqual(r.output.b, { total: 15 }); assert.equal(lib.runs(), 1, 'the repeat was served from the host memo');
  assert.equal(r.output.spent.spentUsd, 0.04, 'child $0.03 + judge $0.01; the memo hit is $0');
  const [s0, e0, s1, e1] = calls(r.trace);
  const key = callKeyOf({ callee: lib.sum.hash, inputDigest: inputDigestOf(ROWS), parentPath: 'root' });
  assert.deepEqual({ ...s0, at: 0 }, { at: 0, kind: 'call-start', name: 'sum', span: 'call:sum#0', parent: 'root', callee: lib.sum.hash, inputDigest: inputDigestOf(ROWS), budgetUsd: 0.2, depth: 1, key });
  assert.equal(e0.kind, 'call-end'); assert.equal(e0.ok, true); assert.equal(e0.span, 'call:sum#0'); assert.equal(e0.parent, 'root'); assert.equal(e0.spentUsd, 0.03); assert.equal(e0.reservedUsd, 0.2);
  assert.equal(e0.calleeVersion, 1); assert.match(e0.outDigest, /^[0-9a-f]{16}$/); assert.equal(typeof e0.ms, 'number');
  assert.equal(s1.span, 'call:sum#1'); assert.equal(s1.key, key, 'same callee, input and parent path: same key');
  assert.equal(e1.memo, 'repeat'); assert.equal(e1.spentUsd, 0);
  assert.equal(r.host.events[0].key, key, 'the host computed the same key as the SDK');
  assert.deepEqual(r.host.events.map(e => e.span), ['call:sum#0', 'call:sum#1'], 'the host used the SDK\'s span ids');
  const done = r.trace.at(-1);
  assert.equal(done.kind, 'done'); assert.equal(done.childCalls, 2); assert.equal(done.spentUsd, 0.04);
  for (const e of r.trace.filter(e => !e.kind.startsWith('call-'))) assert.equal('span' in e, false, 'only call events carry spans at the root');
  assert.equal(r.ledger.spentUsd, 0.04, 'the gateway ledger charged the child and the judge'); assert.equal(r.ledger.reservedUsd, 0);
});

test('refusals: by default a refusal deopts the caller with kind call; onRefuse value hands it to the caller\'s code; the SDK refuses a child budget not below what remains', async t => {
  const lib = library();
  const dflt = await runRoot(t, { registry: lib.registry, source: `const flow = createFlow({ budgetUsd: 1 });
await flow.call('sha256:${'0'.repeat(64)}', {}, { name: 'ghost', budgetUsd: 0.1 });
flow.done('never');` });
  assert.equal(dflt.code, 75); assert.equal(dflt.output, undefined);
  assert.deepEqual([dflt.deopt.kind, dflt.deopt.name, dflt.deopt.detail.refused], ['call', 'ghost', 'unknown-hash']);
  assert.deepEqual(calls(dflt.trace).map(e => [e.kind, e.refused ?? null]), [['call-start', null], ['call-refused', 'unknown-hash']]);
  assert.equal(dflt.trace.at(-1).deopt, 'call');
  const val = await runRoot(t, { registry: lib.registry, source: `const flow = createFlow({ budgetUsd: 0.5 });
const a = await flow.call('sha256:${'0'.repeat(64)}', {}, { name: 'ghost', budgetUsd: 0.1, onRefuse: 'value' });
const b = await flow.call('${lib.sum.hash}', { rows: [] }, { name: 'sum', budgetUsd: 0.5, onRefuse: 'value' });
flow.done({ a, b });` });
  assert.equal(val.code, 0, val.stderr);
  assert.deepEqual(val.output, { a: { refused: 'unknown-hash', detail: null }, b: { refused: 'budget-exceeds-parent', detail: { budgetUsd: 0.5, remainingUsd: 0.5 } } });
  const sdkRefusal = calls(val.trace).at(-1);
  assert.equal(sdkRefusal.by, 'sdk'); assert.equal(val.host.events.length, 1, 'the SDK refusal never reached the host');
});

test('a callee that deopts surfaces as call-deopt; onDeopt value lets the caller fall back; a return outside contract.output is a deopt (output-schema) that propagates as kind call', async t => {
  const lib = library();
  const fb = await runRoot(t, { registry: lib.registry, source: `const flow = createFlow({ budgetUsd: 1 });
const task = flow.input();
const r = await flow.call('${lib.guarded.hash}', task.inputs, { name: 'close', budgetUsd: 0.2, onDeopt: 'value' });
const total = r.deopt ? flow.step('fallback-sum', () => task.inputs.rows.reduce((s, x) => s + x.amount, 0)) : r.total;
flow.done({ total, why: r.deopt?.name ?? null, status: r.status ?? null });` });
  assert.equal(fb.code, 0, fb.stderr); assert.deepEqual(fb.output, { total: 15, why: 'known-dialects', status: 'deopt' });
  const d = calls(fb.trace).at(-1);
  assert.equal(d.kind, 'call-deopt'); assert.equal(d.ok, false); assert.equal(d.status, 'deopt'); assert.deepEqual(d.deopt, { kind: 'guard', name: 'known-dialects' });
  assert.deepEqual(d.detail, { unseen: ['VENDEX'] }); assert.equal(d.spentUsd, 0.02);
  assert.equal(fb.trace.at(-1).spentUsd, 0.02, 'a deopted child is still paid for');
  const bad = await runRoot(t, { registry: lib.registry, source: `const flow = createFlow({ budgetUsd: 1 });
const r = await flow.call('${lib.wrongType.hash}', {}, { name: 'typed', budgetUsd: 0.2 });
flow.done(r);` });
  assert.equal(bad.code, 75); assert.equal(bad.deopt.kind, 'call'); assert.equal(bad.deopt.detail.status, 'deopt'); assert.equal(bad.deopt.detail.child.kind, 'output-schema');
  assert.equal(calls(bad.trace).at(-1).deopt.kind, 'output-schema');
});

test('a gateway 402 on a call deopts the caller with kind budget, as a judge does', async t => {
  const lib = library();
  const r = await runRoot(t, { registry: lib.registry, capUsd: 0.05, modelCostUsd: 0.06, source: `const flow = createFlow({ budgetUsd: 1 });
await flow.judge('q', { tiers: ['${HAIKU}'], prompt: 'q', schema: { type: 'object' } });
await flow.call('${lib.sum.hash}', {}, { name: 'sum', budgetUsd: 0.1 });
flow.done('never');` });
  assert.equal(r.code, 75); assert.equal(r.deopt.kind, 'budget'); assert.equal(r.deopt.detail.gateway, 'budget exhausted');
  assert.equal(calls(r.trace).at(-1).refused, 'gateway-budget'); assert.equal(lib.runs(), 0);
});

// ---- part 2: the sandbox throughout (runCompiled for the root and for every callee) ----
const skip = sandboxAvailable() ? false : 'no user namespaces';
const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5'];
const policy = subsetPolicy(loadPolicy().policy, MODELS);
const scriptedPort = () => new ModelPort({ policy, journal: new Journal(new DatabaseSync(':memory:')),
  providers: { 'claude-cli': new ScriptedProvider(() => ({ value: { factor: 2 }, costUsd: 0.02 })) } });
const SOLVERS = {
  // B: one judge (the scripted port says factor 2), a guard on the row count, returns the doubled total.
  b: `import { createFlow } from './tools/flow.mjs';
const flow = createFlow({ budgetUsd: 0.2 });
const task = flow.input();
flow.guard('few-rows', task.inputs.rows.length < 5, { n: task.inputs.rows.length });
const v = await flow.judge('factor', { tiers: ['${HAIKU}'], prompt: 'factor?', schema: { type: 'object', properties: { factor: { type: 'number' } }, required: ['factor'] } });
flow.done({ total: v.factor * task.inputs.rows.reduce((s, r) => s + r.amount, 0) });`,
  // A: calls B by hash (its hash is in task.inputs.b, as a compiled solver would have it as a literal), falls back on a deopt.
  a: `import { createFlow } from './tools/flow.mjs';
const flow = createFlow({ budgetUsd: 0.4 });
const task = flow.input();
const r = await flow.call(task.inputs.b, { rows: task.inputs.rows }, { name: 'b', budgetUsd: 0.3, onDeopt: 'value' });
const total = r.deopt ? flow.step('fallback', () => -1) : r.total;
flow.done({ total, note: r.deopt ? r.deopt.kind + ':' + (r.deopt.name ?? '') : 'b ok' });`,
  root: `import { createFlow } from './tools/flow.mjs';
const flow = createFlow({ budgetUsd: 1 });
const task = flow.input();
const out = await flow.call(task.inputs.a, { b: task.inputs.b, rows: task.inputs.rows }, { name: 'a', budgetUsd: 0.5, onDeopt: 'value' });
flow.done(out.deopt ? { total: -2, note: 'root fallback: ' + out.deopt.kind } : out);`,
  typed: `import { createFlow } from './tools/flow.mjs';
const flow = createFlow(); flow.input(); flow.done({ total: 'not a number' });`,
};

async function nested(t, { rows = ROWS.rows, maxDepth = 3, rootSource = SOLVERS.root } = {}) {
  const root = tmp(t, 'jit-v3s-');
  for (const [k, src] of Object.entries(SOLVERS)) writeFileSync(path.join(root, `${k}.mjs`), src);
  const registry = createRegistry({ dir: path.join(root, 'library') });
  const b = registry.register({ solvePath: path.join(root, 'b.mjs'), contract: { output: OUT, taskTemplate: 'Double the total.' } });
  const a = registry.register({ solvePath: path.join(root, 'a.mjs'), contract: { output: OUT, taskTemplate: 'Close via B.' } });
  const typed = registry.register({ solvePath: path.join(root, 'typed.mjs'), contract: { output: OUT, taskTemplate: 'Typed.' } });
  writeFileSync(path.join(root, 'root.mjs'), rootSource);
  const workRoot = path.join(root, 'calls-root'), workdir = path.join(root, 'run');
  mkdirSync(workdir, { recursive: true });
  const host = createCallHost({ registry, modelPort: scriptedPort(), maxDepth, workRoot, allowedModels: MODELS, arm: 'cur-1', taskKey: 't' });
  const r = await runCompiled({ solvePath: path.join(root, 'root.mjs'), task: { prompt: 'p', inputs: { a: a.hash, b: b.hash, typed: typed.hash, rows } }, modelPort: host.port({ budgetUsd: 1 }),
    perTaskUsd: 1, timeoutMs: 60000, workdir, outputSchema: OUT, allowedModels: withCallModel(MODELS), flowPath: FLOW_V3, label: 't-root' });
  return { r, host, workRoot, a, b, typed };
}

test('sandboxed: root -> A -> B, each its own runCompiled; budgets carved per level; spans link the child traces; cost rolls up to the root run', { skip }, async t => {
  const { r, host, workRoot, a, b } = await nested(t);
  assert.equal(r.status, 'ok', JSON.stringify(r.error ?? r.deopt)); assert.deepEqual(r.output, { total: 30, note: 'b ok' });
  assert.equal(r.costUsd, 0.02, 'B\'s one judge, charged through B, A and the root gateways'); assert.equal(r.meta.exitCode, 0);
  const rootCalls = r.trace.filter(e => e.kind.startsWith('call-'));
  assert.deepEqual(rootCalls.map(e => [e.kind, e.span, e.parent]), [['call-start', 'call:a#0', 'root'], ['call-end', 'call:a#0', 'root']]);
  const end = rootCalls[1];
  assert.equal(end.spentUsd, 0.02); assert.equal(end.reservedUsd, 0.5); assert.equal(end.calleeVersion, 1);
  // A's trace: a file under workRoot, named by the root's call-end, every event in A's scope.
  const aTrace = lines(path.join(workRoot, end.childTrace));
  assert.equal(createHash('sha256').update(readFileSync(path.join(workRoot, end.childTrace))).digest('hex'), end.childTraceSha256);
  assert.deepEqual([...new Set(aTrace.filter(e => !e.kind.startsWith('call-')).map(e => `${e.span}<${e.parent}`))], ['call:a#0<root']);
  const aCall = aTrace.filter(e => e.kind.startsWith('call-'));
  assert.deepEqual(aCall.map(e => [e.kind, e.span, e.parent, e.depth ?? null]), [['call-start', 'call:b#0', 'call:a#0', 2], ['call-end', 'call:b#0', 'call:a#0', null]]);
  assert.equal(aCall[0].key, callKeyOf({ callee: b.hash, inputDigest: inputDigestOf({ rows: ROWS.rows }), parentPath: 'root/call:a#0' }));
  const bTrace = lines(path.join(workRoot, aCall[1].childTrace));
  assert.ok(bTrace.some(e => e.kind === 'judge' && e.span === 'call:b#0' && e.parent === 'call:a#0'));
  // Host log: one row per call, innermost first; the carved budgets are the children's gateway caps.
  assert.deepEqual(host.events.map(e => [e.kind, e.path, e.callee === a.hash ? 'a' : 'b', e.budgetUsd, e.spentUsd]),
    [['call-end', 'root/call:a#0/call:b#0', 'b', 0.3, 0.02], ['call-end', 'root/call:a#0', 'a', 0.5, 0.02]]);
  assert.deepEqual(host.spans().map(s => [s.path, s.budgetUsd, s.spentUsd, s.reservedUsd]),
    [['root', 1, 0.02, 0], ['root/call:a#0', 0.5, 0.02, 0], ['root/call:a#0/call:b#0', 0.3, 0.02, 0]]);
});

test('sandboxed: a guard deopt (exit 75) in B surfaces in A as call-deopt and A falls back; maxDepth 1 refuses A\'s call to B for depth', { skip }, async t => {
  const deopt = await nested(t, { rows: [1, 2, 3, 4, 5, 6].map(amount => ({ amount })) });
  assert.equal(deopt.r.status, 'ok', JSON.stringify(deopt.r.error ?? deopt.r.deopt)); assert.deepEqual(deopt.r.output, { total: -1, note: 'guard:few-rows' });
  assert.deepEqual(deopt.host.events.map(e => [e.kind, e.childStatus ?? null, e.deopt?.kind ?? null]), [['call-deopt', 'deopt', 'guard'], ['call-end', null, null]]);
  const aTrace = lines(path.join(deopt.workRoot, deopt.r.trace.find(e => e.kind === 'call-end').childTrace));
  const d = aTrace.find(e => e.kind === 'call-deopt');
  assert.deepEqual([d.status, d.deopt], ['deopt', { kind: 'guard', name: 'few-rows' }]); assert.deepEqual(d.detail, { n: 6 });
  const shallow = await nested(t, { maxDepth: 1 });
  // A's call to B (depth 2) is refused; A's onRefuse is the default, so A deopts with kind call; the root falls back.
  assert.deepEqual(shallow.r.output, { total: -2, note: 'root fallback: call' });
  assert.deepEqual(shallow.host.events.map(e => [e.kind, e.refused ?? e.deopt?.kind]), [['call-refused', 'depth'], ['call-deopt', 'call']]);
  assert.deepEqual(shallow.host.events[0].refusedDetail, { depth: 2, maxDepth: 1 });
});

test('sandboxed: a callee whose output fails contract.output deopts the caller with kind call (output-schema)', { skip }, async t => {
  const { r, host } = await nested(t, { rootSource: `import { createFlow } from './tools/flow.mjs';
const flow = createFlow({ budgetUsd: 1 });
const task = flow.input();
flow.done(await flow.call(task.inputs.typed, {}, { name: 'typed', budgetUsd: 0.2 }));` });
  assert.equal(r.status, 'deopt'); assert.equal(r.deopt.kind, 'call'); assert.equal(r.deopt.detail.child.kind, 'output-schema');
  assert.deepEqual(host.events.map(e => [e.kind, e.childStatus]), [['call-deopt', 'invalid']]);
});
