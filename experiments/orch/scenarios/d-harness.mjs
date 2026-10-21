// Group (d): meta-harness variance. Rate-limit storms and usage limits from a scripted provider, the flow-v3 judge's tier
// escalation on an outage, and the real claude-cli provider (src/models/providers/claude-cli.mjs) against fake `claude`
// binaries: a CLI auto-update in the middle of a run, a CLI that serves another model. $0; no real CLI or API call here
// (the live CLI probes are experiments/orch/probes/).
import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Store } from '../../../src/store.mjs';
import { Runtime } from '../../../src/runtime.mjs';
import { Journal } from '../../../src/journal.mjs';
import { verifyRun } from '../../../src/verify-run.mjs';
import { agentNode, eq, exists, HAIKU, LOCAL, mapNode, POLICY, probeRegistry, ref, scriptedPort, SONNET, task, tmp, wait, wf } from '../lib/harness.mjs';
import { owner } from '../lib/proc.mjs';
import { runSolver, stubPort } from '../lib/solver.mjs';

const fakeCli = (dir, body) => {
  const file = path.join(dir, 'claude');
  writeFileSync(file, `#!/bin/sh\nV=$(cat ${JSON.stringify(path.join(dir, 'version'))} 2>/dev/null || echo 2.1.300)\nif [ "$1" = "--version" ]; then echo "$V (Claude Code)"; exit 0; fi\ncat > /dev/null\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
};
const RESULT = (model, extra = {}) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', structured_output: { v: 1 }, total_cost_usd: 0.001,
  usage: { input_tokens: 10, output_tokens: 5 }, modelUsage: { [model]: {} }, ...extra });
const mapOfAgents = (id, n, model = LOCAL) => wf(id, [mapNode('each', ref('input.items'), { nodes: [agentNode('j', { model, input: 'item' })], acceptance: [exists(ref('nodes.j.v'))] }, { concurrency: 4 })],
  [eq(ref('nodes.each.count'), n)]);

export default [
  {
    id: 'D1', group: 'd', title: 'rate-limit (429) storm for 1.5 s during a 10-item fan-out of agent nodes',
    primitive: 'src runtime modelLoop environmentFaults + ModelPort classifyError', fault: 'the provider answers MODEL_RATE_LIMIT to every call for 1.5 s, then recovers',
    invariant: 'a transient rate-limit storm is absorbed (bounded retry with backoff, honouring retry-after) or parks the run resumable; never a terminal failure; never an escalation to another model',
    timeoutMs: 60000,
    async run() {
      const store = new Store(path.join(tmp('orch-d1-'), 'ws'));
      const { registry } = probeRegistry();
      const workflow = mapOfAgents('Storm', 10);
      store.saveWorkflow(workflow);
      const until = Date.now() + 1500;
      let limited = 0;
      const { port } = scriptedPort(store, () => (Date.now() < until ? (limited++, { error: { code: 'MODEL_RATE_LIMIT', message: '429 rate_limit_error; retry-after: 2' } }) : { value: { v: 1 } }));
      const runtime = new Runtime(store, registry, { allowedCapabilities: [], maxCost: 5 }, { models: port, modelPolicy: POLICY });
      const run = runtime.create(workflow, { items: Array.from({ length: 10 }, (_, i) => String(i)) });
      const first = await runtime.execute(run.id);
      await wait(1600);
      const again = await runtime.execute(run.id);
      const escalated = store.events(run.id).filter(e => e.type === 'model.escalated').length;
      store.close();
      return { observed: { first: { status: first.status, code: first.error?.code, verdict: first.verdict?.code }, limitedCalls: limited, afterStormResume: again.status, escalated },
        checks: [
          { name: 'storm absorbed or run parked resumable (not terminal)', pass: !['failed', 'cancelled'].includes(first.status), observed: `${first.status} ${first.error?.code} after ${limited} limited call(s)` },
          { name: 'resume after the storm completes the run', pass: again.status === 'succeeded', observed: again.status },
          { name: 'no escalation to another model on an outage', pass: escalated === 0, observed: escalated },
        ] };
    },
  },
  {
    id: 'D2', group: 'd', title: 'flow-v3 judge on a rate-limited tier: does an outage escalate to the stronger tier?',
    primitive: 'experiments/jit/flow-v3.mjs flow.judge tiers + gateway', fault: 'Haiku answers 429 (MODEL_RATE_LIMIT); Sonnet would answer',
    invariant: 'an outage never escalates to a stronger (dearer) model (DESIGN §5.1); the run ends as an environment fault, not a deopt',
    timeoutMs: 60000,
    async run() {
      const port = stubPort(async req => (req.modelId === HAIKU ? { ok: false, error: { code: 'MODEL_RATE_LIMIT', message: '429 rate limited' } } : { ok: true, value: { label: 'x' }, costUsd: 0.02 }));
      const r = await runSolver({ modelPort: port, source: `const flow = createFlow({ budgetUsd: 1 });
const v = await flow.judge('classify', { tiers: ['${HAIKU}', '${SONNET}'], prompt: 'classify this', schema: { type: 'object' } });
flow.done(v);` });
      const judge = r.trace.find(e => e.kind === 'judge');
      return { observed: { code: r.code, calls: port.calls, tiersTried: judge?.tiersTried ?? null, deopt: r.deopt?.kind ?? null, ledgerErrors: r.ledger.errors },
        checks: [
          { name: 'no call to the stronger tier after an outage', pass: !port.calls.includes(SONNET), observed: port.calls },
          { name: 'the run ends as an environment fault, not a success or deopt', pass: r.code !== 0 && r.deopt?.kind !== 'judge', observed: `exit ${r.code}, deopt ${r.deopt?.kind ?? 'none'}` },
        ] };
    },
  },
  {
    id: 'D3', group: 'd', title: 'subscription usage limit with a reset time, from the real claude-cli provider (fake binary)',
    primitive: 'src/models/providers/claude-cli.mjs interpretResult + runtime', fault: 'the CLI reports "You\'ve hit your usage limit · resets 3pm (UTC)" (is_error)',
    invariant: 'the run parks until the reset (or is resumable after it) and the user sees the reset time; it is not a terminal failure',
    timeoutMs: 60000,
    async run() {
      const dir = tmp('orch-d3-');
      writeFileSync(path.join(dir, 'limit.json'), JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: "You've hit your usage limit · resets 3pm (UTC)", total_cost_usd: 0 }) + '\n');
      const bin = fakeCli(dir, `cat ${JSON.stringify(path.join(dir, 'limit.json'))}\nexit 1`);
      const ws = path.join(dir, 'ws');
      const r = await owner({ workspace: ws, action: 'create-execute', workflow: wf('Usage', [agentNode('j', { model: HAIKU })], [exists(ref('nodes.j.v'))]), input: { raw: '1' }, cliBinary: bin });
      const res = r.result, parked = Object.values(res?.parked ?? {})[0] ?? null;
      return { observed: res,
        checks: [
          { name: 'classified as an environment fault (MODEL_RATE_LIMIT)', pass: (res?.error?.code ?? parked?.code) === 'MODEL_RATE_LIMIT', observed: res?.error?.code ?? parked?.code },
          { name: 'not a terminal failure (parked or resumable)', pass: !['failed', 'cancelled'].includes(res?.status), observed: res?.status },
          { name: 'the reset time reaches the user', pass: /reset/i.test(res?.error?.message ?? parked?.message ?? ''), observed: res?.error?.message ?? parked?.message ?? null },
        ] };
    },
  },
  {
    id: 'D4', group: 'd', title: 'CLI auto-update in the middle of a run (2.1.300 -> 2.1.306), as happened between runs this week',
    primitive: 'claude-cli provider engineVersion() (cached per binary per process) + journal engineVersion + verify-run', fault: 'the binary changes version after the first call; a second process resumes the run',
    invariant: 'each call records the CLI version that actually served it; a run that spans two harness versions is flagged',
    timeoutMs: 60000,
    async run() {
      const dir = tmp('orch-d4-');
      writeFileSync(path.join(dir, 'version'), '2.1.300');
      const bin = fakeCli(dir, `echo 2.1.306 > ${JSON.stringify(path.join(dir, 'version'))}\nprintf '%s\\n' '${RESULT(HAIKU)}'`);
      const ws = path.join(dir, 'ws');
      // a, b in one process (the update lands after a), then a timer; c after a restart.
      const workflow = wf('Drift', [agentNode('a', { model: HAIKU }), agentNode('b', { model: HAIKU, needs: ['a'] }),
        { id: 'nap', kind: 'wait', needs: ['b'], description: 'pause', delayMs: 300 }, agentNode('c', { model: HAIKU, needs: ['nap'] })], [exists(ref('nodes.c.v'))]);
      const p1 = await owner({ workspace: ws, action: 'create-execute', workflow, input: { raw: '1' }, cliBinary: bin });
      await wait(500);
      const p2 = await owner({ workspace: ws, action: 'tick', runId: p1.lines[0].runId, cliBinary: bin });
      const store = new Store(ws); const runId = p1.lines[0].runId;
      const versions = store.events(runId).filter(e => e.type === 'model.called').map(e => `${e.nodeKey}:${e.engineVersion}`);
      const report = verifyRun(store, runId); store.close();
      return { observed: { first: p1.result?.status, final: p2.result?.run?.status, versions, verifyFindings: (report.findings ?? []).map(f => f.code) },
        checks: [
          { name: 'call b records the version that served it (2.1.306)', pass: versions.some(v => v.startsWith('root/b:') && v.includes('2.1.306')), observed: versions },
          { name: 'the run spanning 2.1.300 and 2.1.306 is flagged (event, verify-run or status)', pass: (report.findings ?? []).some(f => /VERSION|DRIFT|ENGINE/i.test(f.code)), observed: (report.findings ?? []).map(f => f.code) },
        ] };
    },
  },
  {
    id: 'D5', group: 'd', title: 'provider fallback forbidden: the CLI serves another model than the one requested',
    primitive: 'claude-cli provider (no --fallback-model; servedModels check)', fault: 'the fake CLI reports modelUsage for claude-sonnet-5-5 on a Haiku request',
    invariant: 'no silent model substitution: the call fails typed and nothing is charged as the requested model',
    timeoutMs: 60000,
    async run() {
      const dir = tmp('orch-d5-');
      const bin = fakeCli(dir, `printf '%s\\n' '${RESULT(SONNET)}'`);
      const r = await owner({ workspace: path.join(dir, 'ws'), action: 'create-execute', workflow: wf('Substitute', [agentNode('j', { model: HAIKU })], [exists(ref('nodes.j.v'))]), input: { raw: '1' }, cliBinary: bin });
      return { observed: r.result,
        checks: [{ name: 'substitution refused (MODEL_PROTOCOL served-instead)', pass: r.result?.status !== 'succeeded' && /instead of|MODEL_PROTOCOL/.test(`${r.result?.error?.code} ${r.result?.error?.message}`), observed: r.result?.error }] };
    },
  },
];
