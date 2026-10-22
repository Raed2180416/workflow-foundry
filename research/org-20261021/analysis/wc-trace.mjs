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
  if (r.type === 'world.write' && r.source === 'initial') continue;
  if (r.type === 'call') { const o = r.output ?? {}; console.log('CALL', r.at, (o.effects ?? []).map(e => `${e.system}.${e.op}${e.args?.amountMinor ? '(' + e.args.amountMinor + ')' : ''}`).join(','), 'tasks', (o.humanTasks ?? []).map(t => t.kind + ':' + t.subject).join(','), r.error ? JSON.stringify(r.error) : ''); continue; }
  if (r.type === 'ledger') { console.log('LEDGER', r.at, `${r.system}.${r.op}`, r.status, r.committed); continue; }
  if (r.type === 'deliver') { console.log('DELIVER', r.event.at, r.event.type, JSON.stringify(r.event.payload).slice(0, 160)); continue; }
  console.log(r.type, JSON.stringify(r).slice(0, 200));
}
