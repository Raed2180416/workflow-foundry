import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { loadPolicy } from '../../src/models/policy.mjs';
import { ModelPort } from '../../src/models/port.mjs';
import { Journal } from '../../src/journal.mjs';
import { ScriptedProvider } from '../../src/models/providers/scripted.mjs';
import { startServices, Ledger } from './services.mjs';
import { makeTasks, loadFamily } from './beds.mjs';

const { policy } = loadPolicy();
const port = () => new ModelPort({ policy, journal: new Journal(new DatabaseSync(':memory:')),
  providers: { 'claude-cli': new ScriptedProvider(() => ({ value: { text: 'hi' }, costUsd: 0.5 })), 'llama-server': new ScriptedProvider(() => ({ value: { text: 'local' } })) } });

const call = async (svc, path, body, token = svc.token) => {
  const res = await fetch(svc.url + path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test('model gateway enforces token, policy, and the session budget', async t => {
  const ledger = new Ledger({ capUsd: 0.9 });
  const svc = await startServices({ modelPort: port(), ledger });
  t.after(() => svc.close());
  assert.equal((await call(svc, '/model', { model: 'claude-haiku-4-5-20251001', prompt: 'x' }, 'wrong')).status, 401);
  const bad = await call(svc, '/model', { model: 'gpt-unlisted', prompt: 'x' });
  assert.equal(bad.status, 400); assert.equal(bad.body.error.code, 'MODEL_NOT_IN_POLICY');
  const ok = await call(svc, '/model', { model: 'claude-haiku-4-5-20251001', prompt: 'x' });
  assert.equal(ok.body.ok, true); assert.deepEqual(ok.body.value, { text: 'hi' });
  await call(svc, '/model', { model: 'claude-haiku-4-5-20251001', prompt: 'y' });
  const over = await call(svc, '/model', { model: 'claude-haiku-4-5-20251001', prompt: 'z' });
  assert.equal(over.status, 402); assert.equal(ledger.calls, 2); assert.equal(ledger.spentUsd, 1.0);
});

test('score service returns only pass/score for probe tasks and enforces its call limit', async t => {
  const fams = ['records'];
  let fam; try { fam = await loadFamily(fams[0]); } catch { return t.skip('records bed not built yet'); }
  const probes = (await makeTasks('records', { split: 'dev', seeds: [1, 2], difficulty: 1 })).map(x => x.task);
  const svc = await startServices({ modelPort: port(), ledger: new Ledger({ capUsd: 1 }), familyId: 'records', probes, scoreLimit: 2 });
  t.after(() => svc.close());
  const good = await call(svc, '/score', { probe: 0, output: fam.referenceSolve(probes[0]) });
  assert.deepEqual(Object.keys(good.body).sort(), ['pass', 'score', 'scoreCallsLeft']);
  assert.equal(good.body.pass, true);
  const bad = await call(svc, '/score', { probe: 1, output: {} });
  assert.equal(bad.body.pass, false);
  assert.equal((await call(svc, '/score', { probe: 0, output: {} })).status, 429);
});

// --- C0 preflight R3: reservation against the cap, visible refusals, complete ledger on close ---
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { reserveFor, RESERVE_OUTPUT_TOKENS } from './services.mjs';
import { subsetPolicy } from './models.mjs';
import { GatewayProvider } from '../../src/models/providers/gateway.mjs';
import { sandboxAvailable } from '../../src/executors/claude-code.mjs';
import { b1Script } from './arms/b1-script.mjs';

const MODELS = ['claude-haiku-4-5-20251001', 'claude-sonnet-5-5', 'claude-opus-5-5'];
const OPUS = 'claude-opus-5-5';
const slowPort = (costUsd, delayMs, pol = policy) => {
  const provider = new ScriptedProvider(() => ({ value: { text: 'ok' }, costUsd, delayMs }));
  return { provider, port: new ModelPort({ policy: pol, journal: new Journal(new DatabaseSync(':memory:')), providers: { 'claude-cli': provider, 'llama-server': provider } }) };
};

test('reserveFor holds prompt x2 at the input price plus 8000 output tokens, within the per-call cap', () => {
  const opus = policy.models.find(m => m.id === OPUS);
  assert.equal(RESERVE_OUTPUT_TOKENS, 8000);
  const r = reserveFor(policy, { model: OPUS, system: 'a'.repeat(300), prompt: 'b'.repeat(2700) });
  assert.ok(Math.abs(r - ((3000 / 3) * 2 * opus.price.inputPerMTok + 8000 * opus.price.outputPerMTok) / 1e6) < 1e-12);
  assert.equal(reserveFor(policy, { model: OPUS, prompt: 'x'.repeat(9e6) }, 0.5), 0.5, 'capped by the provider per-call budget');
  assert.equal(reserveFor(policy, { model: 'not-a-model', prompt: 'x' }), 0);
});

test('concurrent gateway calls never overshoot the session cap: reservations queue, the rest are refused and counted', async t => {
  const { port: p, provider } = slowPort(0.15, 80);
  const ledger = new Ledger({ capUsd: 0.5 });
  const svc = await startServices({ modelPort: p, ledger });
  t.after(() => svc.close());
  // Opus reserves ~$0.16: three fit under $0.5; the others wait, then no longer fit once the three are charged.
  const all = await Promise.all(Array.from({ length: 6 }, (_, i) => call(svc, '/model', { model: OPUS, prompt: `q${i}` })));
  assert.equal(all.filter(r => r.status === 200).length, 3); assert.equal(all.filter(r => r.status === 402).length, 3);
  assert.equal(provider.calls.length, 3); assert.ok(provider.maxActive <= 3);
  assert.ok(ledger.spentUsd <= ledger.capUsd + 1e-9, `spent ${ledger.spentUsd} > cap`);
  assert.equal(ledger.refusals.GATEWAY_BUDGET, 3); assert.equal(ledger.reservedUsd, 0); assert.equal(ledger.inFlight, 0);
  const budget = await (await fetch(svc.url + '/budget', { headers: { authorization: `Bearer ${svc.token}` } })).json();
  assert.deepEqual(budget.refusals, { GATEWAY_BUDGET: 3 }); assert.equal(budget.reservedUsd, 0);
});

test('the gateway allow-list refuses models outside the session and counts the refusal', async t => {
  const { port: p } = slowPort(0.01, 0);
  const ledger = new Ledger({ capUsd: 1 });
  const svc = await startServices({ modelPort: p, ledger, allowedModels: MODELS });
  t.after(() => svc.close());
  const local = await call(svc, '/model', { model: 'qwen3.5-2b-q4km', prompt: 'x' });
  assert.equal(local.status, 403); assert.equal(ledger.refusals.GATEWAY_MODEL, 1); assert.equal(ledger.calls, 0);
  const unknown = await call(svc, '/model', { model: 'gpt-unlisted', prompt: 'x' });
  assert.equal(unknown.status, 403); assert.equal(ledger.refusals.GATEWAY_MODEL, 2);
});

test('close() lets in-flight calls finish so the ledger is complete, and refuses calls that arrive meanwhile', async t => {
  const { port: p } = slowPort(0.2, 300);
  const ledger = new Ledger({ capUsd: 5 });
  const svc = await startServices({ modelPort: p, ledger });
  const inflight = call(svc, '/model', { model: OPUS, prompt: 'slow' });
  await new Promise(r => setTimeout(r, 50));
  const closing = svc.close();
  await closing;
  assert.equal(ledger.calls, 1, 'the in-flight call was charged before close() resolved'); assert.ok(Math.abs(ledger.spentUsd - 0.2) < 1e-12);
  assert.equal((await inflight).status, 200);
  await assert.rejects(call(svc, '/model', { model: OPUS, prompt: 'late' }));
});

test('close() past its grace cancels an in-flight call and still charges what its journal row records', async () => {
  const { port: p } = slowPort(0.2, 5000);
  const ledger = new Ledger({ capUsd: 5 });
  const svc = await startServices({ modelPort: p, ledger });
  const inflight = call(svc, '/model', { model: OPUS, prompt: 'hang' }).catch(e => ({ status: 'closed', error: e }));
  await new Promise(r => setTimeout(r, 50));
  await svc.close({ graceMs: 100 });
  assert.equal(ledger.calls, 1); assert.equal(ledger.errors.CANCELLED, 1); assert.equal(ledger.inFlight, 0);
  await inflight;
});

test('a gateway call aborted after it was sent reports unknown spend, never a silent $0', async () => {
  let sent = false;
  const fetchImpl = (url, { signal, body }) => new Promise((resolve, reject) => {
    sent = JSON.parse(body).node === 'n1/extract'; signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const gw = new GatewayProvider({ url: 'http://127.0.0.1:1', token: 't', fetchImpl });
  const ac = new AbortController();
  const pending = gw.complete({ modelEntry: { id: OPUS }, system: '', prompt: 'x', schema: {}, signal: ac.signal, nodeKey: 'n1/extract' });
  ac.abort();
  await assert.rejects(pending, e => e.code === 'CANCELLED' && e.costUnknown === true && e.costCapUsd === null);
  assert.equal(sent, true, 'the node key travels to the host for tracing');
});

test('B1 execution: no network, the gateway socket only, and a tiny per-task budget shows as GATEWAY_BUDGET refusals with stderr (G2)', { skip: sandboxAvailable() ? false : 'no user namespaces' }, async t => {
  const pol = subsetPolicy(policy, MODELS);
  const { port: p } = slowPort(0.01, 0, pol);
  const dir = mkdtempSync(nodePath.join(tmpdir(), 'b1-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = nodePath.join(dir, 'solve.mjs');
  writeFileSync(script, `import { callModel } from './tools/model.mjs';
let out = { refused: false };
try { await callModel({ model: '${OPUS}', prompt: 'x' }); } catch (e) { out.refused = true; console.error('callModel: ' + e.message.slice(0, 60)); }
console.log(JSON.stringify(out));`);
  const arm = b1Script({ id: 'B1-t', scriptPath: script, modelPort: p, perTaskUsd: 0.01, allowedModels: MODELS });
  const workdir = nodePath.join(dir, 'run'); mkdirSync(workdir);
  const r = await arm.run({ task: { prompt: 'p', inputs: {} }, taskKey: 'fam:dev:d1:s1', trial: 0, workdir });
  assert.equal(r.error, null, JSON.stringify(r)); assert.deepEqual(r.output, { refused: true });
  assert.equal(r.meta.refusals.GATEWAY_BUDGET, 1); assert.equal(r.costUsd, 0); assert.match(r.meta.stderrTail, /callModel: model call failed: 402/);
  assert.equal(arm.def.policyHash, p.policyHash); assert.deepEqual(arm.def.allowedModels, MODELS);
});
