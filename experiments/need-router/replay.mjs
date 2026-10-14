// $0 label replay on archived streams: per family, the best mode at each slider value V and horizon H, with
// label confidence from a paired task bootstrap. Development evidence only (every stream here is dev or rehearsal, K = 1).
//   node experiments/need-router/replay.mjs [--root research/jit-20261008/runs] [--json out.json]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStreams, harvest } from './harvest.mjs';
import { labelTable, utilities, labelConfidence } from './metrics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
export const VS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];
export const HS = [null, 100, 1000];

export function replay(streams, { Vs = VS, Hs = HS, reps = 1000 } = {}) {
  const { rows, fixed, report } = harvest(streams);
  const out = [];
  for (const fam of report) {
    const T = labelTable(rows.filter(r => r.family === fam.family), fixed.filter(x => x.family === fam.family));
    const grid = [];
    for (const H of Hs) for (const V of Vs) {
      const U = utilities(T, V, { horizon: H }).get(fam.family);
      const ranked = [...U].sort((a, b) => b[1] - a[1]);
      const conf = labelConfidence(T, V, { horizon: H, reps })[0];
      grid.push({ H: H ?? fam.paired, V, best: ranked[0][0], utility: Object.fromEntries(ranked.map(([m, u]) => [m, +u.toFixed(3)])), confident: conf.confident, share: conf.share[conf.top], acceptable: conf.acceptable });
    }
    const cell = m => { const c = T.cell(fam.family, m); const v = [...c.tasks.values()]; return { p: v.filter(x => x.success).length / v.length, perTaskUsd: v.reduce((s, x) => s + x.costUsd, 0) / v.length, fixedUsd: c.fixedUsd }; };
    out.push({ ...fam, cells: Object.fromEntries(T.modes.map(m => [m, cell(m)])), grid });
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const res = replay(readStreams(path.resolve(ROOT, arg('--root', 'research/jit-20261008/runs'))));
  for (const f of res) {
    console.log(`\n${f.family}: ${f.paired}/${f.tasks} paired tasks; modes ${f.modes.join(', ')}${f.dropped.length ? `; dropped ${f.dropped.map(d => `${d.mode} (${d.tasks} tasks)`).join(', ')}` : ''}`);
    for (const n of f.notes) console.log(`  note: ${n}`);
    for (const [m, c] of Object.entries(f.cells)) console.log(`  ${m.padEnd(12)} p=${c.p.toFixed(2)} per-task $${c.perTaskUsd.toFixed(3)} fixed $${c.fixedUsd.toFixed(2)}`);
    for (const H of [...new Set(f.grid.map(g => g.H))]) console.log(`  H=${String(H).padEnd(5)} ${f.grid.filter(g => g.H === H).map(g => `V=${g.V}:${g.best}${g.confident ? '' : '?'}`).join('  ')}`);
  }
  const j = arg('--json', null);
  if (j) writeFileSync(j, JSON.stringify(res, null, 1));
}
