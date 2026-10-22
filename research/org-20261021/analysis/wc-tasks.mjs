// OT-0 RESULT analysis (post hoc, $0; research/org-20261021/RESULT-OT0.md). Run from the repository root.
import path from 'node:path';
import { readFileSync } from 'node:fs';
const ROOT = process.cwd(); const imp = p => import(path.join(ROOT, p));
const { buildRegistry } = await imp('experiments/constitution/registry.mjs');
const { runArm } = await imp('experiments/constitution/run.mjs');
const { sandboxArm } = await imp('beds/ebed/host/sandbox-arm.mjs');
const { sha } = await imp('experiments/constitution/port.mjs');
const [L, seed, d, order] = process.argv.slice(2);
const registry = buildRegistry();
const src = readFileSync(path.join(ROOT, 'research/org-20261021/runs', L, 'solver.mjs'), 'utf8');
const run = await runArm({ spec: { seed: Number(seed), d: Number(d), size: null }, arm: 'W-C', registry, workflowHash: sha(src), make: () => sandboxArm({ id: L, solverSource: src, timeoutMs: 20_000 }) });
for (const r of run.rows.filter(r => JSON.stringify(r).includes(order))) {
  if (r.type === 'humanTask.created') console.log('TASK', JSON.stringify({ id: r.task.id, role: r.task.role, exclude: r.task.excludeUsers, q: r.task.question?.slice(0, 160), user: r.user, noise: r.noise?.applied, steps: r.steps }));
  if (r.type === 'deliver' && /^humanTask\./.test(r.event.type)) console.log('  ', r.event.at, r.event.type, JSON.stringify(r.event.payload).slice(0, 160));
  if (r.type === 'ledger' && r.op === 'refund') console.log('REFUND', r.at, r.status, r.committed, r.key);
}
