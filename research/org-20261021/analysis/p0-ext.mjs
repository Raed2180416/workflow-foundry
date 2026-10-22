// P0 extension at $0 (labelled post-hoc): observer C1 vs the E8 oracle's critical verdict per case on the paid-run
// subjects: the W-C programs on their 10 overlay worlds (arm W-C) and the agent arms' committed journals.
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
const ROOT = process.cwd(); const imp = p => import(path.join(ROOT, p));
const { checkRows } = await imp('experiments/constitution/validity.mjs');
const { OT0_WORLDS, baseWorld, overlayWorld } = await imp('experiments/constitution/overlay.mjs');
const { buildRegistry } = await imp('experiments/constitution/registry.mjs');
const { runArm } = await imp('experiments/constitution/run.mjs');
const { sandboxArm } = await imp('beds/ebed/host/sandbox-arm.mjs');
const { sha } = await imp('experiments/constitution/port.mjs');
const { CONTROL_TYPES } = await imp('beds/ebed/host/journal.mjs');
const { SIZED, LIVE_ROOT } = await imp('experiments/constitution/run-agents.mjs');
const registry = buildRegistry();
const tot = {};
const add = (k, r) => { const t = (tot[k] ??= { runs: 0, cases: 0, both: 0, dis: 0, byKind: {} }); t.runs++; t.cases += r.cases; t.both += r.bothCritical; t.dis += r.disagreements; for (const [x, n] of Object.entries(r.byKind)) t.byKind[x] = (t.byKind[x] ?? 0) + n; };
for (const L of process.argv.slice(2).filter(x => x.startsWith('wc-'))) {
  const src = readFileSync(path.join(ROOT, 'research/org-20261021/runs', L, 'solver.mjs'), 'utf8');
  for (const spec of OT0_WORLDS) {
    const run = await runArm({ spec, arm: 'W-C', registry, workflowHash: sha(src), make: () => sandboxArm({ id: L, solverSource: src, timeoutMs: 20_000 }) });
    const r = await checkRows({ subject: L, kind: 'W-C program', spec, W: run.world, rows: run.rows });
    add(L, r);
  }
}
for (const L of process.argv.slice(2).filter(x => !x.startsWith('wc-'))) {
  const f = path.join(LIVE_ROOT, L, 'journal.jsonl'); if (!existsSync(f)) continue;
  const rows = readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => !CONTROL_TYPES.has(r.type)).map(({ seq, prev, hash, ...c }) => c);
  const W = overlayWorld(baseWorld(SIZED), { registry });
  add(L, await checkRows({ subject: L, kind: 'agent journal', spec: SIZED, W, rows }));
}
for (const [k, t] of Object.entries(tot)) console.log(`${k}: runs ${t.runs}, cases ${t.cases}, both critical ${t.both}, disagreements ${t.dis} ${JSON.stringify(t.byKind)}`);
