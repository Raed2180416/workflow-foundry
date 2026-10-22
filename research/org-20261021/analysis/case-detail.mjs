// OT-0 RESULT analysis (post hoc, $0; research/org-20261021/RESULT-OT0.md). Run from the repository root.
import path from 'node:path';
import { readFileSync } from 'node:fs';
const ROOT = process.cwd(); const imp = p => import(path.join(ROOT, p));
const { baseWorld, overlayWorld } = await imp('experiments/constitution/overlay.mjs');
const { buildRegistry } = await imp('experiments/constitution/registry.mjs');
const { SIZED } = await imp('experiments/constitution/run-agents.mjs');
const { runArm } = await imp('experiments/constitution/run.mjs');
const { sandboxArm } = await imp('beds/ebed/host/sandbox-arm.mjs');
const { sha } = await imp('experiments/constitution/port.mjs');
const registry = buildRegistry();
const W = overlayWorld(baseWorld(SIZED), { registry });
const want = process.argv.slice(3);
for (const c of want) { const t = W.truth.cases[c]; console.log(c, JSON.stringify({ class: t.class, start: t.start, orderId: t.orderId ?? t.subject, epoch: t.epoch }).slice(0, 300)); }
const L = process.argv[2];
const src = readFileSync(path.join(ROOT, 'research/org-20261021/runs', L, 'solver.mjs'), 'utf8');
const run = await runArm({ spec: SIZED, arm: 'W-C', registry, workflowHash: sha(src), make: () => sandboxArm({ id: L, solverSource: src, timeoutMs: 20_000 }) });
const oid = c => `ORD-1232-${c.slice(1)}`;
for (const c of want) {
  const o = oid(c);
  console.log(`\n--- ${c} (${o}) rows mentioning it`);
  for (const r of run.rows.filter(r => JSON.stringify(r).includes(o)).slice(0, 14)) console.log(' ', JSON.stringify(r).slice(0, 330));
}
