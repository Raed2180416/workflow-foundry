// tool.mjs and check-runner.mjs: the agent's side over the real, unchanged gateway (experiments/lib/services.mjs), the
// transcript scan for nested model use, and the isolated check runs. $0: scripted model port; checks are real code.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Ledger } from '../../lib/services.mjs';
import { nestedModelUses, sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import { createSubflowHost, SUBFLOW_MODEL } from '../subflow.mjs';
import { SUBFLOW_TOOL, installSubflowTool, serveSubflow, withSubflowModel } from '../tool.mjs';
import { processCheckRunner, sandboxCheckRunner, verdictsOf, RUN_CHECK_SOURCE } from '../check-runner.mjs';

const MODEL = 'claude-haiku-5-5';
const POLICY = { models: [{ id: MODEL, provider: 'stub', class: 'M', price: { inputPerMTok: 0, outputPerMTok: 0 } }] };
const port = { policy: POLICY, providers: {}, policyHash: 'stub', calls: 0,
  // unit n sums [n + 1, 1]: no total equals a value of its input (an echo leaf never carries the mutant: subflow.mjs mutantOf)
  async call(req) { this.calls++; const id = /UNIT=(\S+)/.exec(req.prompt)?.[1]; return { ok: true, value: { total: Number(id.slice(1)) + 2 }, costUsd: 0.02, latencyMs: 5, modelId: req.modelId }; } };
const RETURNS = { type: 'object', required: ['total'], properties: { total: { type: 'number' } }, additionalProperties: false };
const tmp = t => { const d = mkdtempSync(path.join(tmpdir(), 'rec-tool-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const runTool = (cwd, file) => new Promise(resolve => {
  const c = spawn(process.execPath, ['tools/subflow.mjs', file], { cwd, env: { PATH: process.env.PATH } });
  let out = '', err = ''; c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { err += d; });
  c.on('close', code => resolve({ code, out, err }));
});

test('end to end: the agent runs node tools/subflow.mjs; the stock gateway hands flow:subflow to the host and charges the node ledger once', async t => {
  const workdir = tmp(t);
  const ledger = new Ledger({ capUsd: 1, label: 'node:agent#0' });
  const host = createSubflowHost({ modelPort: port, ledger, checkRunner: processCheckRunner(),
    node: { id: 'agent#0', taskKey: 'fam:dev:d3:s1', model: MODEL, units: ['u0', 'u1', 'u2', 'u3'], textLabel: 'synthetic', failures: [{ units: ['u0'] }, { units: ['u1'] }] } });
  const svc = await serveSubflow({ host, workdir });
  t.after(() => svc.close({ graceMs: 1000 }));
  assert.ok(existsSync(path.join(workdir, 'tools/subflow.mjs'))); assert.deepEqual(JSON.parse(readFileSync(path.join(workdir, 'tools/gateway.json'), 'utf8')), { url: svc.url, token: svc.token });
  writeFileSync(path.join(workdir, 'check.mjs'), "export default (a, u) => a.total === u.input[0] + u.input[1] ? null : 'wrong total';");
  writeFileSync(path.join(workdir, 'request.json'), JSON.stringify({ name: 'sum', units: [0, 1, 2].map(i => ({ id: `u${i}`, input: [i + 1, 1] })), worker: { prompt: 'UNIT={{id}} add {{unit}}' }, returns: RETURNS, check: 'check.mjs' }));
  const r = await runTool(workdir, 'request.json');
  assert.equal(r.code, 0, r.err);
  const v = JSON.parse(r.out);
  assert.equal(v.status, 'ok'); assert.equal(v.executedAs, 'child'); assert.equal(v.credit, 'verified'); assert.deepEqual(v.units, { u0: { total: 2 }, u1: { total: 3 }, u2: { total: 4 } });
  assert.equal(ledger.calls, 1); assert.equal(Math.round(ledger.spentUsd * 1e6) / 1e6, v.costUsd); assert.equal(v.costUsd, 0.06); assert.equal(ledger.reservedUsd, 0);
  // a refusal reaches the agent as an answer (exit 0), costs nothing
  writeFileSync(path.join(workdir, 'big.json'), JSON.stringify({ name: 'sum', units: [{ id: 'u3', input: [4, 1] }], worker: { prompt: 'UNIT={{id}} add {{unit}}' }, returns: RETURNS, budgetUsd: 5 }));
  const b = await runTool(workdir, 'big.json');
  assert.equal(b.code, 0, b.err); const bv = JSON.parse(b.out);
  assert.equal(bv.refused, 'budget'); assert.equal(Math.round(ledger.spentUsd * 1e6) / 1e6, 0.06);
  // the gateway's model allow-list carries the route; an id outside it is still refused by the stock gateway
  assert.deepEqual(withSubflowModel([MODEL]), [MODEL, SUBFLOW_MODEL]); assert.equal(withSubflowModel(null), null);
  const res = await fetch(svc.url + '/model', { method: 'POST', headers: { authorization: `Bearer ${svc.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-opus-5-5', prompt: 'x' }) });
  assert.equal(res.status, 403);
});

test('the tool and its use are not a nested model use (src/executors/claude-code.mjs NESTED_API and friends)', () => {
  const uses = [
    { name: 'Bash', input: { command: 'node tools/subflow.mjs request.json' } },
    { name: 'Bash', input: { command: 'cat tools/subflow.mjs && node -e "import(\'./tools/subflow.mjs\')"' } },
    { name: 'Write', input: { file_path: 'tools/subflow.mjs', content: SUBFLOW_TOOL } },
    { name: 'Write', input: { file_path: 'run.mjs', content: "import { subflow } from './tools/subflow.mjs';\nconst a = await subflow({ name: 'x', units: [], worker: { prompt: 'p' }, returns: {} });" } },
  ];
  assert.equal(nestedModelUses(uses), 0);
  assert.equal(/api\.anthropic\.com|@anthropic-ai\/|\/v1\/(?:messages|complete)\b|\banthropic\.(?:Anthropic|AsyncAnthropic)\b/.test(SUBFLOW_TOOL), false);
  // control: the scan does fire on a direct API call, so the zero above is not vacuous
  assert.equal(nestedModelUses([{ name: 'Bash', input: { command: 'curl https://api.anthropic.com/v1/messages' } }]), 1);
});

test('installSubflowTool: a unix-socket gateway is written relative to tools/; the tool module parses as an ES module', t => {
  const workdir = tmp(t);
  installSubflowTool(workdir, { socket: path.join(workdir, 'gw.sock'), token: 'abc' });
  assert.deepEqual(JSON.parse(readFileSync(path.join(workdir, 'tools/gateway.json'), 'utf8')), { socket: '../gw.sock', token: 'abc' });
  assert.throws(() => installSubflowTool(workdir, { token: 'abc' }), /url/);
  const r = spawnSync(process.execPath, ['--check', path.join(workdir, 'tools/subflow.mjs')]);
  assert.equal(r.status, 0, String(r.stderr));
  const usage = spawnSync(process.execPath, ['tools/subflow.mjs'], { cwd: workdir });
  assert.equal(usage.status, 2); assert.match(String(usage.stderr), /usage/);
});

test('check runner: verdict forms, a throw, a load error, no export, a timeout, a forged verdict line, no state between runs', async () => {
  const r = processCheckRunner();
  const forms = 'export default (a) => [null, undefined, true, [], false, "bad", ["x", "y"], { ok: false, reasons: "r" }, { ok: true }][a.i];';
  const v = await r.run({ source: forms, cases: Array.from({ length: 9 }, (_, i) => ({ output: { i }, unit: { id: `u${i}`, input: null } })) });
  assert.deepEqual(v.verdicts.map(x => x.ok), [true, true, true, true, false, false, false, false, true]);
  assert.deepEqual(v.verdicts.slice(4, 8).map(x => x.problem), ['check failed', 'bad', 'x; y', 'r']);
  const named = await r.run({ source: 'export function check(a) { return a > 0 ? null : "not positive"; }', cases: [{ output: 1, unit: {} }, { output: -1, unit: {} }] });
  assert.deepEqual(named.verdicts, [{ ok: true }, { ok: false, problem: 'not positive' }]);
  const threw = await r.run({ source: 'export default () => { throw new Error("boom"); };', cases: [{ output: 1, unit: {} }] });
  assert.deepEqual(threw.verdicts, [{ ok: false, problem: 'check threw: boom' }]);
  assert.equal((await r.run({ source: 'export default (', cases: [{ output: 1, unit: {} }] })).error.code, 'CHECK_LOAD');
  assert.equal((await r.run({ source: 'export const x = 1;', cases: [{ output: 1, unit: {} }] })).error.code, 'CHECK_EXPORT');
  assert.equal((await r.run({ source: 'export default () => { for (;;); };', cases: [{ output: 1, unit: {} }], timeoutMs: 1500 })).error.code, 'CHECK_TIMEOUT');
  // a check that prints its own verdict line and exits: no nonce, no verdict
  const forged = await r.run({ source: 'process.stdout.write(JSON.stringify({ verdicts: [{ ok: true }] }) + "\\n"); process.exit(0); export default () => false;', cases: [{ output: 1, unit: {} }] });
  assert.equal(forged.error.code, 'CHECK_RUNNER');
  // a check that swaps the writer after load cannot reach the runner's own
  const swap = await r.run({ source: 'process.stdout.write = () => true; JSON.stringify = () => "{}"; export default () => "no";', cases: [{ output: 1, unit: {} }] });
  assert.deepEqual(swap.verdicts, [{ ok: false, problem: 'no' }]);
  // state: a check that remembers what it saw in a file sees nothing from an earlier run (a fresh directory per run)
  const stateful = "import { existsSync, writeFileSync } from 'node:fs'; export default () => { if (existsSync('seen')) return 'second'; writeFileSync('seen', '1'); return null; };";
  assert.deepEqual((await r.run({ source: stateful, cases: [{ output: 1, unit: {} }] })).verdicts, [{ ok: true }]);
  assert.deepEqual((await r.run({ source: stateful, cases: [{ output: 1, unit: {} }] })).verdicts, [{ ok: true }]);
  assert.equal(verdictsOf('{"nonce":"n","verdicts":[{"ok":true}]}', 'n', 2).error.code, 'CHECK_RUNNER', 'the verdict count must match');
  assert.match(RUN_CHECK_SOURCE, /const write = process\.stdout\.write\.bind/);
});

test('sandbox check runner: the check runs in the executor sandbox (network off, the repository hidden)', { skip: !sandboxAvailable() && 'no user/mount namespaces here' }, async () => {
  const r = sandboxCheckRunner();
  const v = await r.run({ source: "import { existsSync } from 'node:fs'; export default (a) => existsSync(" + JSON.stringify(path.resolve('AGENTS.md')) + ") ? 'saw the repository' : (a.total === 2 ? null : 'wrong');",
    cases: [{ output: { total: 2 }, unit: { id: 'u1', input: [1, 1] } }, { output: { total: 3 }, unit: { id: 'u1', input: [1, 1] } }] });
  assert.deepEqual(v.verdicts, [{ ok: true }, { ok: false, problem: 'wrong' }]);
  const fail = sandboxCheckRunner({ run: async () => { const e = new Error('no namespaces'); e.code = 'SANDBOX_UNAVAILABLE'; throw e; } });
  assert.equal((await fail.run({ source: 'export default () => null;', cases: [{ output: 1, unit: {} }] })).error.code, 'SANDBOX_UNAVAILABLE');
});
