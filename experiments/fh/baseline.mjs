// FH-1 baseline ($0): grade every recorded E8 build (the incidents and the regeneration pool) on the grading worlds (oracle +
// contracts) and the practice worlds (contracts; oracle kept for analysis only), twice: the second pass is the RETRY arm (the
// unchanged program re-executed). Writes one JSON per subject under research/heal-20261021/fh1/baseline/.
//   node experiments/fh/baseline.mjs [--only ch-e8-1,...] [--passes 2]
import path from 'node:path';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gradeSubject, GRADING, PRACTICE, ROOT, bedDigest, compare } from './grade.mjs';

// Every Haiku E8 build recorded on 2026-10-14 (B1L-H, research/enterprise-20261014/B1-E8-DEV.md) and 2026-10-21 (COMP-1 C-H and
// C-H-T, research/composition-20261021/RESULT-COMP1.md), with the session cost each build reported. b1nh-* are the two N-version
// repairs of 2026-10-14 (prior heal evidence, not FH-1 arms).
export const BUILDS = Object.freeze({
  'b1lh-e8-1': { spec: 'solver:research/enterprise-20261014/runs/b1lh-e8-1/solver.mjs', arm: 'B1L-H', buildUsd: 0.39 },
  'b1lh-e8-2': { spec: 'solver:research/enterprise-20261014/runs/b1lh-e8-2/solver.mjs', arm: 'B1L-H', buildUsd: 0.62 },
  'b1lh-e8-3': { spec: 'solver:research/enterprise-20261014/runs/b1lh-e8-3/solver.mjs', arm: 'B1L-H', buildUsd: 0.53 },
  'ch-e8-1': { spec: 'program:research/composition-20261021/runs/ch-e8-1/program', arm: 'C-H', buildUsd: 1.73 },
  'ch-e8-2': { spec: 'program:research/composition-20261021/runs/ch-e8-2/program', arm: 'C-H', buildUsd: 0.53 },
  'ch-e8-3': { spec: 'program:research/composition-20261021/runs/ch-e8-3/program', arm: 'C-H', buildUsd: 0.86 },
  'cht-e8-1': { spec: 'program:research/composition-20261021/runs/cht-e8-1/program', arm: 'C-H-T', buildUsd: 1.70 },
  'cht-e8-2': { spec: 'program:research/composition-20261021/runs/cht-e8-2/program', arm: 'C-H-T', buildUsd: 1.12 },
  'cht-e8-3': { spec: 'program:research/composition-20261021/runs/cht-e8-3/program', arm: 'C-H-T', buildUsd: 1.16 },
  'b1nh-e8-2': { spec: 'solver:research/enterprise-20261014/runs/b1nh-e8-2/solver.mjs', arm: 'B1N-H (repair of b1lh-e8-2)', buildUsd: 0.62 + 0.11, prior: true },
  'b1nh-e8-3': { spec: 'solver:research/enterprise-20261014/runs/b1nh-e8-3/solver.mjs', arm: 'B1N-H (repair of b1lh-e8-3)', buildUsd: 0.53 + 0.05, prior: true },
});
export const OUT_DIR = path.join(ROOT, 'research/heal-20261021/fh1/baseline');

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const only = arg('--only', null)?.split(',') ?? Object.keys(BUILDS);
  const passes = Number(arg('--passes', '2'));
  mkdirSync(OUT_DIR, { recursive: true });
  for (const label of only) {
    const b = BUILDS[label];
    const file = path.join(OUT_DIR, `${label}.json`);
    if (existsSync(file) && !process.argv.includes('--force')) { console.log(`${label}: exists, skipped`); continue; }
    const t = Date.now();
    const runs = [];
    for (let p = 0; p < passes; p++) {
      const grading = await gradeSubject(b.spec, { worlds: GRADING, label: `fh-${label}` });
      const practice = await gradeSubject(b.spec, { worlds: PRACTICE, label: `fh-${label}` });
      runs.push({ grading, practice });
      console.log(`${label} pass ${p + 1}: grading oracle ${grading.totals.oraclePassed}/${grading.totals.oracleN}, contracts ${grading.totals.contractsPassed}/${grading.totals.contractsN}; practice oracle ${practice.totals.oraclePassed}/${practice.totals.oracleN}, contracts ${practice.totals.contractsPassed}/${practice.totals.contractsN}`);
    }
    const retry = runs.length > 1 ? {
      identicalJournals: runs[0].grading.worlds.every((w, i) => w.digest === runs[1].grading.worlds[i].digest) && runs[0].practice.worlds.every((w, i) => w.digest === runs[1].practice.worlds[i].digest),
      grading: (({ nRecovered, nRegressed, net }) => ({ nRecovered, nRegressed, net }))(compare(runs[0].grading, runs[1].grading)),
    } : null;
    writeFileSync(file, JSON.stringify({ label, ...b, bedDigest: bedDigest(), at: new Date().toISOString(), wallMs: Date.now() - t,
      grading: runs[0].grading, practice: runs[0].practice, retry }, null, 1));
    console.log(`${label}: written (${Math.round((Date.now() - t) / 1000)} s); retry ${JSON.stringify(retry)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
