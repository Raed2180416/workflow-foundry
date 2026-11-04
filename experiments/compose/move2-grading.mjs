// Move 2 on composition: M1 transparency on the nine COMP-1 grading worlds (1232-1234 x d2, d3, d5; 1,022 completed
// cases per build). Each of the six composed builds runs fault-free under the frozen runtime 1 and under runtime 2; the
// logical journal digest, the key-free business-row digest and the per-case pass vector must be equal, so compose-
// runtime/2 cannot have moved the M1 numbers PREREG-COMP1 reported. $0, development evidence, resumable.
//   nice -n 15 node experiments/compose/move2-grading.mjs [--only <label,...>] [--out research/blockers-20261021/move2/grading]
//        [--runtimes 1,2] [--baseline <an earlier grading.json>]
// --runtimes 2 --baseline research/blockers-20261021/move2/grading/grading.json is the post-review re-run (MOVE2-COMP.md
// §8): runtime 1 is unchanged, so its rows come from the baseline; the earlier runtime-2 rows are compared too.
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { subjectOf2, runUnder2, measure } from './fault-run2.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
export const GRADING = Object.freeze([1232, 1233, 1234].flatMap(seed => [2, 3, 5].map(d => ({ seed, d }))));
const COMPOSED = ['ch-e8-1', 'ch-e8-2', 'ch-e8-3', 'cht-e8-1', 'cht-e8-2', 'cht-e8-3'];
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.chdir(ROOT);
  const outDir = path.resolve(ROOT, arg('--out', 'research/blockers-20261021/move2/grading'));
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'grading.json');
  const doc = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { evidence: 'development (COMP-1 grading worlds), $0, runtime1 vs runtime2 fault-free', rows: [] };
  const only = arg('--only', null)?.split(',') ?? null;
  const runtimes = arg('--runtimes', '1,2').split(',').map(Number);
  const baseFile = arg('--baseline', null);
  const base = baseFile ? JSON.parse(readFileSync(path.resolve(ROOT, baseFile), 'utf8')).rows : [];
  if (baseFile) doc.baseline = path.relative(ROOT, path.resolve(ROOT, baseFile));
  const poolsCache = new Map();
  // the harness each new row ran under (rows written before this field existed ran under runtime2.mjs 1c4a6398…, the
  // version committed with the battery; the read-back option added later leaves the default carry byte-identical)
  const harness = Object.fromEntries(['experiments/compose/runtime2.mjs', 'experiments/compose/effects.registry.json', 'experiments/compose/bundle2.mjs', 'experiments/compose/fault-run2.mjs']
    .map(p => [p, createHash('sha256').update(readFileSync(path.join(ROOT, p))).digest('hex').slice(0, 16)]));
  for (const w of GRADING) {
    const W = e8.generateWorld({ seed: w.seed, difficulty: w.d, mix: 'tail' });
    for (const label of COMPOSED) {
      if (only && !only.includes(label)) continue;
      for (const runtime of runtimes) {
        if (doc.rows.some(r => r.label === label && r.runtime === runtime && r.seed === w.seed && r.d === w.d)) continue;
        const subject = subjectOf2(`program:research/composition-20261021/runs/${label}/program`, { runtime, label });
        const t = Date.now();
        const r = await runUnder2(subject, W, 'none');
        const m = await measure({ subject, r, fault: 'none', poolsCache });
        doc.rows.push({ label, runtime, seed: w.seed, d: w.d, ms: Date.now() - t, passed: m.oracle.passed, completed: m.oracle.completed, critical: m.oracle.critical,
          harness, digest: m.digest, passing: m.passing, envelope: m.envelope.byCode, hostDeduped: m.hostDeduped, armErrors: m.armErrors, carryBytes: m.carryBytes });
        writeFileSync(`${file}.tmp`, JSON.stringify(doc)); renameSync(`${file}.tmp`, file);
        console.log(`${label} r${runtime} ${w.seed} d${w.d}: oracle ${m.oracle.passed}/${m.oracle.completed} | env ${JSON.stringify(m.envelope.byCode)} | arm errors ${m.armErrors} | ${Date.now() - t} ms`);
      }
    }
  }
  // the comparison
  const cmp = [];
  for (const label of COMPOSED) for (const w of GRADING) {
    const find = (rows, rt) => rows.find(r => r.label === label && r.runtime === rt && r.seed === w.seed && r.d === w.d);
    const a = find(doc.rows, 1) ?? find(base, 1);
    const b = find(doc.rows, 2);
    const b0 = baseFile ? find(base, 2) : null;          // the earlier runtime-2 row, when re-running against a baseline
    if (a && b) cmp.push({ label, seed: w.seed, d: w.d, passed: [a.passed, b.passed], completed: a.completed, logicalEqual: a.digest.logical === b.digest.logical, sorTablesEqual: a.digest.sorTables === b.digest.sorTables, passingEqual: JSON.stringify(a.passing) === JSON.stringify(b.passing),
      envelope: b.envelope, armErrors: b.armErrors, ...(b0 ? { earlierR2LogicalEqual: b0.digest.logical === b.digest.logical, earlierR2PassingEqual: JSON.stringify(b0.passing) === JSON.stringify(b.passing) } : {}) });
  }
  const rowsOf = (l, rt) => { const own = doc.rows.filter(r => r.label === l && r.runtime === rt); return own.length || rt === 2 ? own : base.filter(r => r.label === l && r.runtime === rt); };
  const pooled = Object.fromEntries(COMPOSED.map(l => [l, [1, 2].map(rt => rowsOf(l, rt).reduce((s, r) => [s[0] + r.passed, s[1] + r.completed], [0, 0]))]));
  const summary = { cells: cmp.length, allEqual: cmp.length > 0 && cmp.every(c => c.logicalEqual && c.sorTablesEqual && c.passingEqual), envelopeFindings: cmp.reduce((n, c) => n + Object.values(c.envelope ?? {}).reduce((a, x) => a + x, 0), 0),
    armErrors: cmp.reduce((n, c) => n + (c.armErrors ?? 0), 0), ...(baseFile ? { earlierR2Equal: cmp.filter(c => c.earlierR2LogicalEqual && c.earlierR2PassingEqual).length } : {}), pooled };
  writeFileSync(path.join(outDir, 'comparison.json'), JSON.stringify({ ...summary, cmp }, null, 1));
  console.log(JSON.stringify(summary));
}
