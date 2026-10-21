// Group (e): resources and cost. Dollar budgets under concurrency, token budgets for $0-priced models (the 97M-token
// incident), budget carving across flow.call children, the gateway's reservation model. Scripted models; $0.
import path from 'node:path';
import { Store } from '../../../src/store.mjs';
import { Runtime } from '../../../src/runtime.mjs';
import { Journal } from '../../../src/journal.mjs';
import { validateWorkflow } from '../../../src/validate.mjs';
import { agentNode, eq, exists, HAIKU, LOCAL, mapNode, POLICY, probeRegistry, ref, scriptedPort, tmp, wait, wf } from '../lib/harness.mjs';
import { createRegistry, runSolver, stubPort } from '../lib/solver.mjs';

const agents = (id, n, { model, concurrency = 16, budget = {} }) => wf(id, [mapNode('each', ref('input.items'), { nodes: [agentNode('j', { model, input: 'item' })], acceptance: [exists(ref('nodes.j.v'))] }, { concurrency })],
  [eq(ref('nodes.each.count'), n)], budget);
const items = n => ({ items: Array.from({ length: n }, (_, i) => String(i)) });

export default [
  {
    id: 'E1', group: 'e', title: 'dollar budget under concurrency: 40 calls at $0.10, 16 in flight, cap $1.00',
    primitive: 'src runtime checkBudget/preflight (charge after the call) + COST_BUDGET', fault: 'the cap is crossed while 16 calls are in flight',
    invariant: 'spend never exceeds the cap (calls in flight hold reservations); the stop is visible; completed work is kept and the run can continue after the owner raises the budget',
    timeoutMs: 60000,
    async run() {
      const store = new Store(path.join(tmp('orch-e1-'), 'ws'));
      const { registry } = probeRegistry();
      const workflow = agents('Dollars', 40, { model: HAIKU, budget: { maxCost: 1 } });
      store.saveWorkflow(workflow);
      const { port, provider } = scriptedPort(store, () => ({ value: { v: 1 }, delayMs: 100, costUsd: 0.1 }), { concurrency: { 'claude-cli': 16 } });
      const runtime = new Runtime(store, registry, { allowedCapabilities: [], maxCost: 5, maxConcurrency: 16 }, { models: port, modelPolicy: POLICY });
      const run = runtime.create(workflow, items(40));
      const final = await runtime.execute(run.id);
      const journal = new Journal(store).costForRun(run.id);
      store.close();
      return { observed: { status: final.status, code: final.error?.code, runCost: final.cost, journalCost: journal.costUsd, providerCalls: provider.calls.length },
        checks: [
          { name: 'stopped with COST_BUDGET', pass: final.error?.code === 'COST_BUDGET', observed: `${final.status} ${final.error?.code}` },
          { name: 'spend <= cap ($1.00)', pass: journal.costUsd <= 1 + 1e-9, observed: `$${journal.costUsd.toFixed(2)} spent (${provider.calls.length} calls) against a $1.00 cap` },
          { name: 'resumable after raising the budget (not terminal)', pass: final.status !== 'failed', observed: `${final.status}: the policy is bound at birth and a failed run is final` },
        ] };
    },
  },
  {
    id: 'E2', group: 'e', title: '$0-priced model, 3M tokens per call: does any budget stop it? (runtime and flow-v3 gateway)',
    primitive: 'src runtime budgets (maxCost, maxSteps) and experiments/lib/services.mjs Ledger', fault: 'a local/free model priced $0 consumes 3M tokens per call, 30 calls',
    invariant: 'a token (or compute-time) budget bounds a run whatever the model costs in dollars',
    timeoutMs: 60000,
    async run() {
      const store = new Store(path.join(tmp('orch-e2-'), 'ws'));
      const { registry } = probeRegistry();
      const workflow = agents('Tokens', 30, { model: LOCAL, budget: { maxCost: 1 } });
      const schemaHasTokens = !!validateWorkflow({ ...workflow, budget: { ...workflow.budget, maxTokens: 1000000 } }, { registry, modelPolicy: POLICY }).valid;
      store.saveWorkflow(workflow);
      const { port } = scriptedPort(store, () => ({ value: { v: 1 }, usage: { inputTokens: 3000000, outputTokens: 1000 } }));
      const runtime = new Runtime(store, registry, { allowedCapabilities: [], maxCost: 1 }, { models: port, modelPolicy: POLICY });
      const run = runtime.create(workflow, items(30));
      const final = await runtime.execute(run.id);
      const tokens = new Journal(store).costForRun(run.id);
      store.close();
      // The flow-v3 gateway: a $0 model behind the Ledger.
      const gport = stubPort(async () => ({ ok: true, value: { v: 1 }, costUsd: 0, usage: { inputTokens: 3000000, outputTokens: 1000 } }));
      const g = await runSolver({ modelPort: gport, budgetUsd: 0.5, source: `const flow = createFlow({ budgetUsd: 0.5 });
const out = await flow.map(Array.from({ length: 30 }, (_, i) => i), i => flow.judge('j', { tiers: ['claude-haiku-5-5'], prompt: 'item ' + i, schema: { type: 'object' } }), { concurrency: 4 });
flow.done({ n: out.length });` });
      return { observed: { runtime: { status: final.status, inputTokens: tokens.inputTokens, costUsd: tokens.costUsd }, workflowTokenBudgetField: schemaHasTokens, gateway: { exit: g.code, calls: gport.calls.length, spentUsd: g.ledger.spentUsd } },
        checks: [
          { name: 'the workflow IR can declare a token budget', pass: schemaHasTokens, observed: schemaHasTokens },
          { name: 'runtime stops the run before 90M tokens', pass: final.status !== 'succeeded' || tokens.inputTokens < 90e6, observed: `${final.status}, ${(tokens.inputTokens / 1e6).toFixed(0)}M input tokens at $${tokens.costUsd}` },
          { name: 'gateway stops the session before 90M tokens', pass: g.code !== 0 || gport.calls.length < 30, observed: `exit ${g.code}, ${gport.calls.length} calls x 3M tokens at $${g.ledger.spentUsd}` },
        ] };
    },
  },
  {
    id: 'E3', group: 'e', title: 'budget carving: 8 parallel flow.call children asking $0.30 each from a $1.00 parent',
    primitive: 'call-host BUDGET_TREE (reservations in flight) + gateway hold', fault: 'children reserve concurrently; each spends $0.25',
    invariant: 'sum of reservations in flight never exceeds what the parent has left; children refused are typed (BUDGET_TREE); total spend <= parent budget',
    timeoutMs: 60000,
    async run() {
      const reg = createRegistry();
      let active = 0, peak = 0;
      const child = reg.register({ contract: { output: { type: 'object' }, taskTemplate: 'c' }, stub: async input => { active++; peak = Math.max(peak, active); await wait(200); active--; return { output: { i: input.i }, costUsd: 0.25 }; } });
      const r = await runSolver({ registry: reg, modelPort: stubPort(async () => ({ ok: true, value: {} })), budgetUsd: 1, source: `const flow = createFlow({ budgetUsd: 1 });
const out = await flow.map([0,1,2,3,4,5,6,7], i => flow.call('${child.hash}', { i }, { name: 'c', budgetUsd: 0.3, onRefuse: 'skip' }), { concurrency: 8 });
flow.done({ ok: out.filter(x => x && x.i !== undefined).length, refused: out.filter(x => x && x.refused).map(x => x.refused) });` });
      // The SDK refuses a reservation that does not fit next to the calls in flight before it reaches the host (flow-v3 budgetRefusalOf).
      const refusals = [...r.host.events.filter(e => e.kind === 'call-refused').map(e => e.refused), ...(r.output?.refused ?? [])];
      return { observed: { exit: r.code, output: r.output, refusals, peakChildren: peak, spentUsd: r.ledger.spentUsd },
        checks: [
          { name: 'total spend <= parent budget', pass: r.ledger.spentUsd <= 1 + 1e-9, observed: r.ledger.spentUsd },
          { name: 'over-subscribed children refused with a typed budget refusal', pass: refusals.length > 0 && refusals.every(x => ['BUDGET_TREE', 'budget-exceeds-parent'].includes(x)), observed: refusals },
          { name: 'children in flight never held more than the parent had (<= 3 x $0.30 < $1.00)', pass: peak <= 3, observed: peak },
        ] };
    },
  },
  {
    id: 'E4', group: 'e', title: 'gateway hard cap with 10 concurrent priced judges and a soft flow budget',
    primitive: 'experiments/lib/services.mjs Ledger reservations (reserveFor) vs flow-v3 soft budgetUsd', fault: '20 judges, 10 in flight, $0.02 each, session cap $0.10',
    invariant: 'the session never spends past its cap even when the solver\'s soft budget is checked only before each judge',
    timeoutMs: 60000,
    async run() {
      const priced = { models: [{ id: HAIKU, provider: 'p', price: { inputPerMTok: 1, outputPerMTok: 5 } }] };
      const port = stubPort(async () => { await wait(50); return { ok: true, value: { v: 1 }, costUsd: 0.02 }; }, { policy: priced });
      const r = await runSolver({ modelPort: port, budgetUsd: 0.1, capUsd: 0.1, source: `const flow = createFlow({ budgetUsd: 0.1 });
const out = await flow.map(Array.from({ length: 20 }, (_, i) => i), i => flow.judge('j', { tiers: ['${HAIKU}'], prompt: 'item ' + i, schema: { type: 'object' } }), { concurrency: 10, onItemError: 'null', reduce: (r, c) => c });
flow.done(out);` });
      return { observed: { exit: r.code, deopt: r.deopt?.kind ?? null, spent: r.ledger.spentUsd, calls: port.calls.length, refusals: r.ledger.refusals },
        checks: [{ name: 'gateway spend <= $0.10 cap', pass: r.ledger.spentUsd <= 0.1 + 1e-9, observed: r.ledger.spentUsd }] };
    },
  },
];
