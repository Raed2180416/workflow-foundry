// Observer validity at $0 (PREDICTION.md P0): on every already-graded E8 program re-run on the worlds it was graded on,
// on the stored agent-H and agent-H + V journals of the sized world, and on E8's controls, the observer's C1 verdict
// must equal the E8 oracle's critical-violation verdict per case. Base worlds (no overlay): this checks the observer
// against the oracle on exactly the runs the oracle graded. Every disagreement is reported with its kind, not tuned away.
//   node experiments/constitution/validity.mjs [--programs b1lh-e8-1,...] [--controls all|none|a,b] [--agents yes|no]
//        [--worlds all|1232:2] [--out research/org-20261021/runs/validity.json]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { createHost } from '../../beds/ebed/host/host.mjs';
import { sandboxArm } from '../../beds/ebed/host/sandbox-arm.mjs';
import { readJournal, CONTROL_TYPES } from '../../beds/ebed/host/journal.mjs';
import { hashOf } from '../../beds/lib/canonical.mjs';
import { CONTROLS, runControl } from '../../beds/ebed/e8/controls.mjs';
import { baseWorld, worldLabel } from './overlay.mjs';
import { buildRegistry } from './registry.mjs';
import { observe, c1VsOracle } from './observer.mjs';
import { oracleSummary, poolsOf, ROOT } from './run.mjs';

/** The graded programs and the worlds their stored results cover. */
export const GRADED = Object.freeze({
  full: ['b1lh-e8-1', 'b1lh-e8-2', 'b1lh-e8-3', 'b1nh-e8-2', 'b1nh-e8-3', 'b1o-e8-1', 'b1h-e8-1'],      // B1-H last: it is slow (minutes per world) and emits no effect
  sized: ['b1lh-e8-1', 'b1nh-e8-2', 'b1nh-e8-3', 'b1o-e8-1'],          // research/enterprise-20261014/runs/grade-s12-*
});
export const AGENT_JOURNALS = Object.freeze({
  'agenth-e8-s12': '/var/tmp/foundry-work/ebed-arms/agenth-e8-s12/journal-w1232-d2.jsonl',
  'agentv-e8-s12': '/var/tmp/foundry-work/agentv-arms/agentv-e8-s12/journal-w1232-d2.jsonl',
});
const FULL = [2, 3, 5].flatMap(d => [1232, 1233, 1234].map(seed => ({ seed, d, size: null })));
const SIZED = { seed: 1232, d: 2, size: 12 };
const registry = buildRegistry();

function stored(label, spec) {
  const f = path.join(ROOT, 'research/enterprise-20261014/runs', spec.size ? `grade-s12-${label}` : label, 'result.json');
  if (!existsSync(f)) return null;
  const r = JSON.parse(readFileSync(f, 'utf8'));
  const row = r.rows?.find(x => x.seed === spec.seed && x.d === spec.d) ?? null;
  return row ? { completed: row.completed, passed: row.passed, critical: row.critical, armErrors: row.armErrors } : null;
}

export async function checkRows({ subject, kind, spec, W, rows, extra = {} }) {
  const pools = await poolsOf(W);
  const v = e8.oracle(W, rows, { pools });
  const { verdict } = observe({ rows, registry, ref: { catalog: W.master.catalog, editions: W.rulebook.editions } });
  const all = c1VsOracle({ world: W, verdict, oracleVerdict: v });
  const comp = c1VsOracle({ world: W, verdict, oracleVerdict: v, onlyCompleted: true });
  return { subject, kind, world: worldLabel(spec), oracle: oracleSummary(v), observerC1: verdict.C1.byCode,
    cases: all.cases, bothCritical: all.bothCritical, disagreements: all.disagreements.length, byKind: all.byKind,
    completed: { cases: comp.cases, bothCritical: comp.bothCritical, disagreements: comp.disagreements.length, byKind: comp.byKind },
    examples: all.disagreements.slice(0, 5), ...extra };
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
async function main() {
  const out = arg('--out', path.join(ROOT, 'research/org-20261021/runs/validity.json'));
  mkdirSync(path.dirname(out), { recursive: true });
  const progs = arg('--programs', null)?.split(',') ?? null;
  const ctl = arg('--controls', 'all');
  const ws = arg('--worlds', 'all');
  const fullWorlds = ws === 'all' ? FULL : ws.split(',').map(x => { const [seed, d] = x.split(':').map(Number); return { seed, d, size: null }; });
  const res = { date: new Date().toISOString().slice(0, 10), evidence: 'development; $0; base E8 worlds (no overlay)', rows: [] };
  const save = () => writeFileSync(out, JSON.stringify(res, null, 1));
  const log = r => console.log(`${r.kind} ${r.subject} ${r.world}: oracle ${r.oracle.passed}/${r.oracle.completed} crit ${r.oracle.critical} | observer C1 ${JSON.stringify(r.observerC1)} | cases ${r.cases}, both critical ${r.bothCritical}, disagreements ${r.disagreements} ${JSON.stringify(r.byKind)}${r.stored ? ` | stored ${r.stored.passed}/${r.stored.completed} crit ${r.stored.critical}` : ''}`);
  // 1. Graded programs, re-run as graded (sandbox, base world, E8 binding).
  for (const [set, specs] of [['full', fullWorlds], ['sized', [SIZED]]]) {
    for (const label of GRADED[set].filter(l => !progs || progs.includes(l))) {
      const source = readFileSync(path.join(ROOT, 'research/enterprise-20261014/runs', label, 'solver.mjs'), 'utf8');
      for (const spec of specs) {
        const W = baseWorld(spec);
        const arm = sandboxArm({ id: label, solverSource: source, timeoutMs: 20_000 });
        const host = createHost({ item: e8.binding, world: W, arm, callTimeoutMs: 25_000 });
        try { await host.run(); } catch (e) { console.log(`  host error ${label}: ${e.message}`); } finally { arm.close(); }
        const r = await checkRows({ subject: label, kind: 'program', spec, W, rows: host.journal.contentRows(), extra: { stored: stored(label, spec) } });
        res.rows.push(r); log(r); save();
      }
    }
  }
  // 2. The stored agent journals of the sized world (outside the repository; read, never written).
  if (arg('--agents', 'yes') === 'yes') {
    for (const [label, file] of Object.entries(AGENT_JOURNALS)) {
      if (!existsSync(file)) { res.rows.push({ subject: label, kind: 'agent-journal', missing: file }); continue; }
      const W = baseWorld(SIZED);
      const raw = readJournal(file);
      const start = raw.find(r => r.type === 'run.start');
      const rows = raw.filter(r => !CONTROL_TYPES.has(r.type)).map(({ seq, prev, hash, ...c }) => c);
      const r = await checkRows({ subject: label, kind: 'agent-journal', spec: SIZED, W, rows, extra: { worldDigestMatches: start?.world?.digest === hashOf(W), journalRows: raw.length } });
      res.rows.push(r); log(r); save();
    }
  }
  // 3. E8's controls on the same worlds (bad, gaming, necessity, c-oss; each must fail).
  if (ctl !== 'none') {
    const ids = ctl === 'all' ? CONTROLS.map(c => c.id) : ctl.split(',');
    for (const spec of fullWorlds) {
      const W = baseWorld(spec);
      for (const id of ids) {
        const c = CONTROLS.find(x => x.id === id);
        if (spec.d < (c.minDifficulty ?? 2)) continue;
        const rows = await runControl(id, W);
        const r = await checkRows({ subject: id, kind: `control:${c.kind}`, spec, W, rows });
        res.rows.push(r); log(r); save();
      }
    }
  }
  const progRows = res.rows.filter(r => r.kind !== undefined && !r.missing);
  res.summary = {
    runs: progRows.length, cases: progRows.reduce((s, r) => s + r.cases, 0), bothCritical: progRows.reduce((s, r) => s + r.bothCritical, 0),
    disagreements: progRows.reduce((s, r) => s + r.disagreements, 0),
    byKind: progRows.reduce((m, r) => { for (const [k, v] of Object.entries(r.byKind)) m[k] = (m[k] ?? 0) + v; return m; }, {}),
    byRunKind: Object.fromEntries([...new Set(progRows.map(r => r.kind.split(':')[0]))].map(k => [k, (() => { const rs = progRows.filter(r => r.kind.split(':')[0] === k); return { runs: rs.length, cases: rs.reduce((s, r) => s + r.cases, 0), bothCritical: rs.reduce((s, r) => s + r.bothCritical, 0), disagreements: rs.reduce((s, r) => s + r.disagreements, 0) }; })()])),
  };
  save();
  console.log(`summary: ${JSON.stringify(res.summary)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
