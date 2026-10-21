// OT-0 re-grading at $0 (research/org-20261021/PREDICTION.md): the stored blind builds (arm W-blind) on the overlay
// worlds, with the shield (W-S) and with the necessity guard (G), plus the base world without the overlay (base) for the
// invisibility check. Per lineage, world and arm: the E8 oracle (unchanged), E8 + C2 overlay, the observer's C1-C3,
// interventions, the stale-rule window and the scripted auditor (today's journal and the OT-0 evidence pack).
//   node experiments/constitution/run.mjs [--lineages b1lh-e8-1,b1nh-e8-2,b1nh-e8-3] [--arms base,W-blind,W-S,G]
//        [--worlds all | 1232:2:12,1233:3] [--out research/org-20261021/runs/regrade.json]
// Dev rehearsal worlds 1232-1234 only (overlay.mjs refuses anything else). No model call.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { createHost } from '../../beds/ebed/host/host.mjs';
import { sandboxArm } from '../../beds/ebed/host/sandbox-arm.mjs';
import { OT0_WORLDS, baseWorld, overlayWorld, overlayBinding, overlayOracle, worldLabel } from './overlay.mjs';
import { buildRegistry } from './registry.mjs';
import { shieldArm } from './shield.mjs';
import { guardArm } from './guard.mjs';
import { observe } from './observer.mjs';
import { audit, groundTruth, compare } from './auditor.mjs';
import { sha } from './port.mjs';
import { withConstitutionFiles } from './arms.mjs';
import { existsSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const LINEAGES = Object.freeze({ L1: 'b1lh-e8-1', L2: 'b1nh-e8-2', L3: 'b1nh-e8-3' });
export const BESIDE = Object.freeze({ 'L2-pre': 'b1lh-e8-2', 'L3-pre': 'b1lh-e8-3' });
export const ARMS = Object.freeze(['base', 'W-blind', 'W-S', 'G']);           // W-C and W-CS (constitution-aware builds) too, on request
const SHIELDED = new Set(['W-S', 'W-CS']), WITH_FILES = new Set(['W-C', 'W-CS']);
/** A stored program: the blind builds under research/enterprise-20261014/runs/, OT-0's W-C builds under research/org-20261021/runs/. */
export const solverPath = label => [path.join(ROOT, 'research/org-20261021/runs', label, 'solver.mjs'), path.join(ROOT, 'research/enterprise-20261014/runs', label, 'solver.mjs')].find(existsSync)
  ?? path.join(ROOT, 'research/enterprise-20261014/runs', label, 'solver.mjs');

/** Summarise one oracle verdict on the completed pool. */
export function oracleSummary(v) {
  const comp = v.cases.filter(c => c.pool === 'completed');
  const codes = {};
  for (const c of comp.filter(x => !x.pass)) { const k = c.firstDivergence ? `L${c.firstDivergence.layer}:${c.firstDivergence.code}` : 'unfinished'; codes[k] = (codes[k] ?? 0) + 1; }
  return { completed: comp.length, passed: comp.filter(c => c.pass).length, critical: v.critical.length, codes, failing: comp.filter(c => !c.pass).map(c => c.case) };
}

const poolCache = new Map();
export async function poolsOf(W) {
  const k = `${W.id}|${W.arrivals.length}`;
  if (!poolCache.has(k)) poolCache.set(k, (await e8.referenceRuns(W)).pools);
  return poolCache.get(k);
}

/**
 * Run one subject (a tick/1 arm factory) on one world under one arm. `make()` returns a fresh inner arm (closed after).
 * Returns { rows (content), full (hash-chained rows), status, port, world }.
 */
export async function runArm({ spec, arm, make, registry, workflowHash = null }) {
  const B = baseWorld(spec);
  const W = arm === 'base' ? B : overlayWorld(B, { registry });
  const raw = make();
  const inner = WITH_FILES.has(arm) ? withConstitutionFiles(raw, registry) : raw;
  const wrapped = SHIELDED.has(arm) ? shieldArm(inner, { registry, workflowHash }) : arm === 'G' ? guardArm(inner, { registry }) : inner;
  const host = createHost({ item: arm === 'base' ? e8.binding : overlayBinding, world: W, arm: wrapped, callTimeoutMs: 25_000 });
  let status;
  try { status = (await host.run()).status; } catch (e) { status = `host-error: ${String(e?.message ?? e).slice(0, 200)}`; } finally { raw.close?.(); }
  return { world: W, rows: host.journal.contentRows(), full: host.journal.rows.map(r => ({ ...r })), status, port: wrapped === inner ? null : wrapped };
}

/** Everything OT-0 measures on one run. */
export async function assessRun({ spec, arm, run, registry, workflowHash }) {
  const { world: W, rows, full, port } = run;
  const pools = await poolsOf(W);
  const ref = { catalog: W.master.catalog, editions: W.rulebook.editions };
  const e8v = oracleSummary(e8.oracle(W, rows, { pools }));
  const ov = arm === 'base' ? null : oracleSummary(overlayOracle(W, rows, { pools }));
  const obs = arm === 'base' ? null : observe({ rows, registry, ref }).verdict;
  const holds = port?.holds ?? [];
  const interventions = port ? {
    holds: holds.length, released: holds.filter(h => h.state === 'released').length, openAtHorizon: holds.filter(h => ['asking', 'approved'].includes(h.state)).length,
    refused: holds.filter(h => h.state === 'refused').length, abandoned: holds.filter(h => h.state === 'abandoned').length,
    verified: port.log.reduce((s, l) => s + l.interventions.filter(x => x.action === 'verified').length, 0),
    asks: holds.reduce((s, h) => s + h.asks.length, 0), reAsks: holds.reduce((s, h) => s + Math.max(0, h.asks.length - 1), 0), breakGlass: holds.filter(h => h.asks.some(a => a.breakGlass)).length,
    closeDeferred: port.log.reduce((s, l) => s + l.interventions.filter(x => x.action === 'close-deferred').length, 0),
    mergeWithHold: port.log.reduce((s, l) => s + l.interventions.filter(x => x.action === 'merge-with-hold').length, 0),
    approvers: holds.filter(h => h.approvedBy).reduce((m, h) => ({ ...m, [h.approvedBy]: (m[h.approvedBy] ?? 0) + 1 }), {}),
  } : null;
  let auditor = null;
  if (arm !== 'base') {
    const g = groundTruth({ world: W, rows, registry, port, workflowHash: SHIELDED.has(arm) ? workflowHash : null });
    auditor = { pack: compare(audit({ host: full, registry: registry.journal() }), g) };
    if (arm === 'W-blind') auditor.today = compare(audit({ host: full, registry: null }), g);
  }
  return {
    world: worldLabel(spec), arm, status: run.status, armErrors: rows.filter(r => r.type === 'arm.error').length, ticks: rows.filter(r => r.type === 'call').length,
    e8: e8v, overlay: ov,
    observer: obs && { C1: obs.C1.byCode, C2: { ...obs.C2.byCode, refundsAboveT: obs.C2.refundsAboveT, compliant: obs.C2.compliant, exceptions: obs.C2.exceptions.length },
      C3: { ...obs.C3.byCode, unpinnedRuns: obs.C3.unpinnedRuns, unpinnedGovernedRuns: obs.C3.unpinnedGovernedRuns }, staleWindow: obs.C3.staleWindow,
      overEscalation: obs.overEscalation, violations: { C1: obs.C1.violations, C2: obs.C2.violations, C3: obs.C3.violations } },
    interventions, auditor,
    plant: W.truth.ot0?.plant ?? null,
  };
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
async function main() {
  const lineages = (arg('--lineages', null)?.split(',') ?? [...Object.values(LINEAGES), ...Object.values(BESIDE)]);
  const arms = arg('--arms', ARMS.join(',')).split(',');
  const ws = arg('--worlds', 'all');
  const worlds = ws === 'all' ? OT0_WORLDS : ws.split(',').map(x => { const [seed, d, size] = x.split(':').map(Number); return { seed, d, size: size || null }; });
  const out = arg('--out', path.join(ROOT, 'research/org-20261021/runs/regrade.json'));
  mkdirSync(path.dirname(out), { recursive: true });
  const registry = buildRegistry();
  const result = { date: new Date().toISOString().slice(0, 10), evidence: 'development (dev rehearsal worlds 1232-1234); $0; no model call', registry: registry.versions.map(v => ({ version: v.version, hash: v.hash, decision: v.decision, reasons: v.reasons })),
    lineages: Object.fromEntries(lineages.map(l => [l, { solverSha256: sha(readFileSync(solverPath(l), 'utf8')) }])), arms, worlds: worlds.map(worldLabel), rows: [] };
  for (const label of lineages) {
    const source = readFileSync(solverPath(label), 'utf8');
    const workflowHash = sha(source);
    for (const spec of worlds) for (const arm of arms) {
      const t = Date.now();
      const run = await runArm({ spec, arm, registry, workflowHash, make: () => sandboxArm({ id: label, solverSource: source, timeoutMs: 20_000 }) });
      const a = await assessRun({ spec, arm, run, registry, workflowHash });
      result.rows.push({ lineage: label, ms: Date.now() - t, ...a });
      const o = a.observer;
      console.log(`${label} ${a.world} ${arm}: E8 ${a.e8.passed}/${a.e8.completed}${a.overlay ? ` | +C2 ${a.overlay.passed}/${a.overlay.completed}` : ''} crit ${a.e8.critical}`
        + (o ? ` | C1 ${JSON.stringify(o.C1)} C2 ${JSON.stringify(o.C2)} C3 ${JSON.stringify(o.C3)} stale ${o.staleWindow.handledUnderT1}/${o.staleWindow.orders}` : '')
        + (a.interventions ? ` | holds ${a.interventions.holds} rel ${a.interventions.released} open ${a.interventions.openAtHorizon}` : '') + ` | ${Date.now() - t} ms`);
      writeFileSync(out, JSON.stringify(result, null, 1));
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
