// Run a flow-v3 solver as a plain child process against the real gateway (experiments/lib/services.mjs over loopback)
// whose model port is a call host (experiments/jit/call-host.mjs, mode 'stub': callees run in process) over a stub model
// port. This is the set-up of experiments/jit/test/flow-v3-call.test.mjs part 1, made reusable for fault injection: no
// sandbox, no network, no model spend. The SDK, the gateway, the ledger and the host are the real code.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MODEL_TOOL } from '../../c0/construct.mjs';
import { startServices, Ledger } from '../../lib/services.mjs';
import { createCallHost, createRegistry, FLOW_V3 } from '../../jit/call-host.mjs';
import { HAIKU, SONNET, tmp } from './harness.mjs';

export const STUB_POLICY = { models: [HAIKU, SONNET].map(id => ({ id, provider: 'p', price: { inputPerMTok: 0, outputPerMTok: 0 } })) };
/** A model port whose answer is fn(req) -> {ok, value?, error?, costUsd?} (async allowed); it counts calls per model. */
export function stubPort(fn, { policy = STUB_POLICY } = {}) {
  const port = { policy, providers: {}, policyHash: 'stub', calls: [], active: 0, peak: 0,
    async call(req) {
      port.calls.push(req.modelId); port.active++; port.peak = Math.max(port.peak, port.active);
      try { const r = await fn(req); return { costUsd: 0, modelId: req.modelId, ...r }; } finally { port.active--; }
    } };
  return port;
}
export { createRegistry };
const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return { torn: true }; } }) : []);

/**
 * source: the solver body (after `import { createFlow } from './tools/flow.mjs'`). killAfterMs: SIGKILL the solver after
 * that long (a parent that dies or times out). closeGraceMs: the gateway's close grace (runCompiled uses the default 330 s).
 */
export async function runSolver({ source, registry = createRegistry(), modelPort, budgetUsd = 1, capUsd = budgetUsd, maxDepth = 3, task = { prompt: 'p', inputs: {} },
  killAfterMs = null, closeGraceMs = 330000, hostOptions = {}, dir = tmp('orch-solver-') }) {
  mkdirSync(path.join(dir, 'tools'), { recursive: true });
  const host = createCallHost({ registry, mode: 'stub', maxDepth, modelPort, ...hostOptions });
  const ledger = new Ledger({ capUsd, label: 'root' });
  const svc = await startServices({ modelPort: host.port({ budgetUsd, ledger }), ledger });
  writeFileSync(path.join(dir, 'tools/model.mjs'), MODEL_TOOL); copyFileSync(FLOW_V3, path.join(dir, 'tools/flow.mjs'));
  writeFileSync(path.join(dir, 'tools/gateway.json'), JSON.stringify({ url: svc.url, token: svc.token }));
  writeFileSync(path.join(dir, 'task.json'), JSON.stringify(task));
  writeFileSync(path.join(dir, 'solve.mjs'), `import { createFlow } from './tools/flow.mjs';\n${source}`);
  const t0 = Date.now();
  const child = spawn(process.execPath, ['solve.mjs', 'task.json'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', killed = false;
  child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { if (stderr.length < 200000) stderr += d; });
  const timer = killAfterMs ? setTimeout(() => { killed = true; child.kill('SIGKILL'); }, killAfterMs) : null;
  const { code, signal } = await new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
  clearTimeout(timer);
  const exitedMs = Date.now() - t0;
  const c0 = Date.now();
  await svc.close({ graceMs: closeGraceMs });
  const closeMs = Date.now() - c0;
  const deopt = existsSync(path.join(dir, 'deopt.json')) ? (() => { try { return JSON.parse(readFileSync(path.join(dir, 'deopt.json'), 'utf8')); } catch { return { torn: true }; } })() : null;
  const last = stdout.trim().split('\n').filter(Boolean).at(-1);
  let output; try { output = last === undefined ? undefined : JSON.parse(last); } catch { output = { unparsed: last }; }
  return { code, signal, killed, stderr, trace: lines(path.join(dir, 'trace.jsonl')), deopt, output, host, ledger, exitedMs, closeMs, dir };
}
