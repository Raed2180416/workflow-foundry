// OT-0 RESULT analysis (post hoc, $0; research/org-20261021/RESULT-OT0.md). Run from the repository root.
import path from 'node:path';
import { readFileSync } from 'node:fs';
const ROOT = process.cwd(); const imp = p => import(path.join(ROOT, p));
const { buildRegistry } = await imp('experiments/constitution/registry.mjs');
const { SIZED } = await imp('experiments/constitution/run-agents.mjs');
const { runArm } = await imp('experiments/constitution/run.mjs');
const { sandboxArm } = await imp('beds/ebed/host/sandbox-arm.mjs');
const { sha } = await imp('experiments/constitution/port.mjs');
const registry = buildRegistry();
for (const L of ['wc-e8-1', 'wc-e8-3']) {
  const src = readFileSync(path.join(ROOT, 'research/org-20261021/runs', L, 'solver.mjs'), 'utf8');
  const run = await runArm({ spec: SIZED, arm: 'W-C', registry, workflowHash: sha(src), make: () => sandboxArm({ id: L, solverSource: src, timeoutMs: 20_000 }) });
  const e = run.rows.find(r => r.type === 'effect.emit' && r.effect.op === 'create' && r.effect.args?.orderId === 'ORD-1232-0004');
  console.log(L, JSON.stringify(e?.effect));
  const ops = {}; for (const r of run.rows.filter(r => r.type === 'ledger' && r.subjectCase === 'o0004')) ops[`${r.system}.${r.op}`] = (ops[`${r.system}.${r.op}`] ?? 0) + 1;
  console.log('  ledger ops o0004', JSON.stringify(ops));
}
