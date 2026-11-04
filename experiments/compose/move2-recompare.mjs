// The post-review re-run against the pre-review rows, cell by cell (research/blockers-20261021/MOVE2-COMP.md §8). $0,
// reads JSON only. For every (subject, runtime, world, fault) cell of the re-run directory that the earlier directory
// also has: passed cases, critical findings, the oracle's outside-allowed count, duplicates, key conflicts, whether the
// logical journal and the key-free business rows are equal, and the envelope's findings before and after.
//   node experiments/compose/move2-recompare.mjs --old research/blockers-20261021/move2/runs --new research/blockers-20261021/move2/runs-v2 [--out <json>]
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');

function cells(dir) {
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter(x => x.endsWith('.json'))) {
    const d = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    const rt2 = d.harness?.['experiments/compose/runtime2.mjs']?.slice(0, 8) ?? null;
    for (const r of d.results) out.set(`${d.subject}|r${d.runtime}|${r.seed}|${r.fault}`, { ...r, subject: d.subject, runtime: d.runtime, rt2 });
  }
  return out;
}

export function recompare(oldDir, newDir) {
  const a = cells(oldDir), b = cells(newDir);
  const rows = [];
  for (const [k, n] of b) {
    const o = a.get(k) ?? null;
    const none = b.get(`${n.subject}|r${n.runtime}|${n.seed}|none`) ?? a.get(`${n.subject}|r${n.runtime}|${n.seed}|none`) ?? null;
    rows.push({ subject: n.subject, runtime: n.runtime, seed: n.seed, fault: n.fault, runtime2: [o?.rt2 ?? null, n.rt2],
      passed: [o?.oracle.passed ?? null, n.oracle.passed], completed: n.oracle.completed,
      lossVsNone: none ? [o && a.get(`${n.subject}|r${n.runtime}|${n.seed}|none`) ? a.get(`${n.subject}|r${n.runtime}|${n.seed}|none`).oracle.passed - o.oracle.passed : null, none.oracle.passed - n.oracle.passed] : null,
      critical: [o?.oracle.critical ?? null, n.oracle.critical],
      outsideAllowed: [o?.oracle.codes?.['L2:outside-allowed'] ?? (o ? 0 : null), n.oracle.codes?.['L2:outside-allowed'] ?? 0],
      duplicates: [o?.exactlyOnce.duplicates ?? null, n.exactlyOnce.duplicates], keyConflicts: [o?.exactlyOnce.keyConflicts ?? null, n.exactlyOnce.keyConflicts],
      logicalEqual: o ? o.digest.logical === n.digest.logical : null, sorTablesEqual: o ? o.digest.sorTables === n.digest.sorTables : null,
      passingEqual: o ? JSON.stringify(o.passing) === JSON.stringify(n.passing) : null,
      env: [o?.envelope.byCode ?? null, n.envelope.byCode], armErrors: [o?.armErrors ?? null, n.armErrors] });
  }
  rows.sort((x, y) => `${x.subject}|${x.fault}|${x.seed}`.localeCompare(`${y.subject}|${y.fault}|${y.seed}`));
  const by = {};
  for (const r of rows) {
    const g = `${r.subject.includes('+readback') ? 'readback' : `r${r.runtime}`}:${r.fault}`;
    const t = (by[g] ??= { cells: 0, compared: 0, logicalEqual: 0, passingEqual: 0, passedOld: 0, passedNew: 0, conflictingResults: 0, surplusOld: 0, surplusNew: 0, reissued: 0, armErrors: 0 });
    t.cells += 1;
    t.armErrors += r.armErrors[1] ?? 0;
    t.conflictingResults += (r.env[1]['conflicting-result'] ?? 0) + (r.env[1]['conflicting-result-in-batch'] ?? 0);
    t.surplusNew += (r.env[1].surplus ?? 0) + (r.env[1]['surplus-after-commit'] ?? 0);
    t.reissued += r.env[1]['readback-reissued'] ?? 0;
    if (r.logicalEqual === null) continue;
    t.compared += 1;
    t.logicalEqual += r.logicalEqual ? 1 : 0;
    t.passingEqual += r.passingEqual ? 1 : 0;
    t.passedOld += r.passed[0];
    t.passedNew += r.passed[1];
    t.surplusOld += r.env[0]?.surplus ?? 0;
  }
  return { summary: by, rows };
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const res = recompare(path.resolve(ROOT, arg('--old', 'research/blockers-20261021/move2/runs')), path.resolve(ROOT, arg('--new', 'research/blockers-20261021/move2/runs-v2')));
  const o = arg('--out', null);
  if (o) writeFileSync(path.resolve(ROOT, o), JSON.stringify({ evidence: 'development (dev worlds), $0; pre-review vs post-review runtime2 rows', ...res }, null, 1));
  console.log(JSON.stringify(res.summary, null, 1));
}
