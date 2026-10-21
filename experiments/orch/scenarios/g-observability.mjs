// Group (g): what the user sees. The run record's verdict after each class of fault (does it say what happened, whether
// the run can continue, and what to do), and Ctrl-C on the real CLI followed by `foundry resume`.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { Store } from '../../../src/store.mjs';
import { Runtime } from '../../../src/runtime.mjs';
import { agentNode, eq, exists, HAIKU, mapNode, POLICY, probeRegistry, ref, ROOT, scriptedPort, task, tmp, wait, wf } from '../lib/harness.mjs';
import { owner, startOwner } from '../lib/proc.mjs';

const NEXT = /resum|retry|re-run|rerun|raise|increase|reset|reconcil|check whether|after|wait until/i;

export default [
  {
    id: 'G1', group: 'g', title: 'what the run record tells the user after four kinds of stop',
    primitive: 'src/verdict.mjs verdictOf + run.error', fault: 'rate limit, cost budget, deadline, effect of unknown outcome (owner killed inside a non-idempotent effect)',
    invariant: 'for each stop the record names the cause, says whether the run can continue, and names the next action (resume after T, raise budget, reconcile effect X)',
    timeoutMs: 120000,
    async run() {
      const { registry } = probeRegistry();
      const cases = {};
      const lib = async (name, workflow, script, input, policy = {}) => {
        const store = new Store(path.join(tmp('orch-g1-'), 'ws'));
        store.saveWorkflow(workflow);
        const { port } = scriptedPort(store, script);
        const runtime = new Runtime(store, registry, { allowedCapabilities: registry.list().map(c => c.name), maxCost: 5, ...policy }, { models: port, modelPolicy: POLICY });
        const run = runtime.create(workflow, input);
        const final = await runtime.execute(run.id);
        cases[name] = { status: final.status, code: final.error?.code ?? null, verdict: final.verdict?.verdict, reason: final.verdict?.reason ?? null, message: final.error?.message ?? null };
        store.close();
      };
      await lib('rate-limit', wf('G1rate', [agentNode('j', { model: HAIKU })], [exists(ref('nodes.j.v'))]), () => ({ error: { code: 'MODEL_RATE_LIMIT', message: '429; retry-after: 30' } }), { raw: '1' });
      await lib('cost-budget', wf('G1cost', [agentNode('j', { model: HAIKU })], [exists(ref('nodes.j.v'))], { maxCost: 0.05 }), () => ({ value: { v: 1 }, costUsd: 0.1 }), { raw: '1' });
      await lib('deadline', wf('G1deadline', [task('slow', 'chaos.work', { ms: 3000 })], [exists(ref('nodes.slow.id'))], { maxDurationMs: 500 }), () => ({}), {});
      // Effect of unknown outcome: kill the owner inside a non-idempotent effect, resume.
      const dir = tmp('orch-g1u-'), ws = path.join(dir, 'ws');
      const c = await owner({ workspace: ws, action: 'create', workflow: wf('G1uncertain', [task('pay', 'chaos.effect', { ms: 3000 })], [exists(ref('nodes.pay.applied'))]) });
      const o = startOwner({ workspace: ws, action: 'execute', runId: c.lines[0].runId });
      await o.waitFor('executing'); await wait(800); o.child.kill('SIGKILL'); await o.done;
      const u = await owner({ workspace: ws, action: 'execute', runId: c.lines[0].runId });
      const s = new Store(ws); const ur = s.run(c.lines[0].runId); s.close();
      cases.uncertain = { status: ur.status, code: ur.error?.code ?? null, verdict: ur.verdict?.verdict, reason: ur.verdict?.reason ?? null, message: ur.error?.message ?? null, resumeSaw: u.result?.status };
      const checks = Object.entries(cases).map(([name, c]) => ({ name: `${name}: cause, continuability and next action stated`, pass: !!c.code && NEXT.test(`${c.reason} ${c.message}`) && /resum|final|cannot continue|can continue/i.test(`${c.reason} ${c.message}`),
        observed: `${c.status}/${c.verdict} ${c.code}: ${String(c.reason).slice(0, 110)}` }));
      return { observed: cases, checks };
    },
  },
  {
    id: 'G2', group: 'g', title: 'Ctrl-C on `foundry run`, then `foundry resume` (real CLI, default registry)',
    primitive: 'bin/foundry.mjs SIGINT handler + resume', fault: 'SIGINT 1 s into a 6-step run',
    invariant: 'exit 130, the run stays resumable, resume completes it and re-runs no completed step',
    timeoutMs: 120000,
    async run() {
      const dir = tmp('orch-g2-'), ws = path.join(dir, 'ws');
      const nodes = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, kind: 'task', needs: i ? [`s${i - 1}`] : [], description: `sleep ${i}`, tool: 'core.sleep', args: { ms: 400 }, timeoutMs: 5000, retry: { maxAttempts: 1 } }));
      const file = path.join(dir, 'wf.json');
      writeFileSync(file, JSON.stringify(wf('CtrlC', nodes, [{ op: 'eq', left: { $ref: 'nodes.s5.sleptMs' }, right: 400 }], { maxCost: 0 })));
      const cli = path.join(ROOT, 'bin/foundry.mjs');
      const child = spawn(process.execPath, [cli, 'run', file, '--input', '{}', '--workspace', ws], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1' } });
      let out = '', err = '';
      child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
      await wait(1300);
      child.kill('SIGINT');
      const code = await new Promise(r => child.on('close', r));
      const runId = (`${err} ${out}`.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) ?? [])[0];
      const res = await new Promise(resolve => {
        const c = spawn(process.execPath, [cli, 'resume', runId ?? 'missing', '--workspace', ws], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1' } });
        let o = '', e = ''; c.stdout.on('data', d => { o += d; }); c.stderr.on('data', d => { e += d; });
        c.on('close', status => resolve({ status, out: o, err: e }));
      });
      let status = null; try { status = JSON.parse(res.out).status; } catch {}
      const store = new Store(ws); const ev = runId ? store.events(runId) : []; store.close();
      const started = ev.filter(e => e.type === 'tool.intent').map(e => e.nodeKey);
      return { observed: { exit: code, stderr: err.slice(-200), runId, resume: { exit: res.status, status, err: res.err.slice(-200) }, starts: started },
        checks: [
          { name: 'exit 130 with the run named', pass: code === 130 && !!runId, observed: { code, runId } },
          { name: 'resume completes the run', pass: status === 'succeeded', observed: status ?? res.err.slice(-200) },
          { name: 'no completed step re-run (one start per step, the interrupted one at most twice)', pass: new Set(started).size === 6 && started.length <= 7, observed: started },
        ] };
    },
  },
];
