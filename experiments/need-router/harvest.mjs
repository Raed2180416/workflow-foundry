// Harvest need-router labels from archived stream runs (research/jit-20261008/runs/<experiment>/<arm>/results.jsonl).
// $0, read-only. Each experiment is one family instance (its own seeds); each arm is one mode. Costs come from the
// rows' own costBreakdown (model-journal spend, never solver reports); compile components are one-off (fixed) costs,
// everything else is per task. A mode's build that happened outside the stream (the static C0 B1-Haiku solver) is
// added as a declared fixed cost with its source.
//
// Pairing: labels must cover the same tasks in every mode (metrics.labelTable throws otherwise). Per family the
// harvest keeps the modes that ran at least `minCoverage` of the family's tasks and restricts every kept mode to the
// tasks all of them completed; every dropped mode and task is reported, never silently lost.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

export const FIXED_COMPONENTS = new Set(['compileBuilder', 'compileCheck', 'compileGateway']);
/** Builds paid outside the stream, by arm slug. */
export const EXTERNAL_BUILDS = {
  'static-B1-haiku-records-k1-solve': { fixedUsd: 1.372, source: 'research/construction-20261006/REPORT-dev.md (C0 dev, records B1-Haiku build; constructions.jsonl $1.372)' },
};
const MODE = slug => slug
  .replace(/^agent-claude-(\w+)-5-5$/, 'agent-$1')
  .replace(/^jit-claude-(\w+)-5-5--claude-(\w+)-5-5$/, (_, a, b) => `jit-${a[0].toUpperCase()}${b[0].toUpperCase()}`)
  .replace(/^static-B1-haiku-.*$/, 'static-b1h');

export function readStreams(root) {
  const out = [];
  for (const exp of readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()) {
    for (const arm of readdirSync(path.join(root, exp), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()) {
      const f = path.join(root, exp, arm, 'results.jsonl');
      if (!existsSync(f)) continue;
      const rows = readFileSync(f, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
      out.push({ family: exp, arm, mode: MODE(arm), rows });
    }
  }
  return out;
}

/**
 * Turn streams into label rows + fixed costs, per family. Returns
 * { rows: [{family, mode, task, success, costUsd}], fixed: [{family, mode, fixedUsd, source}], report }.
 */
export function harvest(streams, { minCoverage = 0.5 } = {}) {
  const rows = [], fixed = [], report = [];
  const byFamily = new Map();
  for (const s of streams) (byFamily.get(s.family) ?? byFamily.set(s.family, []).get(s.family)).push(s);
  for (const [family, arms] of byFamily) {
    const all = new Set(arms.flatMap(a => a.rows.map(r => r.taskKey)));
    const kept = arms.filter(a => new Set(a.rows.map(r => r.taskKey)).size >= minCoverage * all.size);
    const dropped = arms.filter(a => !kept.includes(a)).map(a => ({ mode: a.mode, tasks: a.rows.length }));
    const common = [...all].filter(t => kept.every(a => a.rows.some(r => r.taskKey === t))).sort();
    const notes = [];
    for (const a of kept) {
      let fixedUsd = 0, unknown = 0, outOfPair = 0;
      for (const r of a.rows) {
        const bd = r.costBreakdown ?? {};
        const f = Object.entries(bd).filter(([k]) => FIXED_COMPONENTS.has(k)).reduce((s, [, v]) => s + v, 0);
        fixedUsd += f;   // a compile paid while serving a task outside the pair still happened: keep it
        if (r.costUnknown) unknown += 1;
        if (!common.includes(r.taskKey)) { outOfPair += 1; continue; }
        rows.push({ family, mode: a.mode, task: r.taskKey, success: r.pass === true, costUsd: Math.max(0, r.costUsd - f) + (r.orphanUsd ?? 0) });
      }
      const ext = EXTERNAL_BUILDS[a.arm];
      if (ext) { fixedUsd += ext.fixedUsd; notes.push(`${a.mode}: +$${ext.fixedUsd} build (${ext.source})`); }
      fixed.push({ family, mode: a.mode, fixedUsd, source: ext ? 'stream compile + external build' : 'stream compile components' });
      if (unknown) notes.push(`${a.mode}: ${unknown} row(s) with costUnknown (booked as recorded)`);
      if (outOfPair) notes.push(`${a.mode}: ${outOfPair} task(s) outside the paired set dropped from per-task labels`);
    }
    report.push({ family, tasks: all.size, paired: common.length, modes: kept.map(a => a.mode), dropped, notes });
  }
  return { rows, fixed, report };
}
