// FH-1 ($0): the baseline table of PREREG-FH1.md §1.1 from research/heal-20261021/fh1/baseline/*.json (grading oracle, failing cases by
// class, contracts, practice worlds, retry identity), as markdown on stdout.
//   node experiments/fh/baseline-table.mjs
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { ROOT } from './grade.mjs';
import { BUILDS } from './baseline.mjs';

const BASE = path.join(ROOT, 'research/heal-20261021/fh1/baseline');
const rows = ['| Build | Arm | Build $ | Grading oracle (9 worlds) | Failing cases by class | Grading contracts | Practice oracle (3 worlds) | Practice contract-failing orders | Retry (2nd execution) |', '|---|---|---|---|---|---|---|---|---|'];
for (const [label, b] of Object.entries(BUILDS)) {
  const f = path.join(BASE, `${label}.json`);
  if (!existsSync(f)) { rows.push(`| ${label} | ${b.arm} | | (not graded) | | | | | |`); continue; }
  const j = JSON.parse(readFileSync(f, 'utf8'));
  const g = j.grading.totals, p = j.practice.totals;
  const byClass = {};
  for (const w of j.grading.worlds) for (const c of w.cases) if (c.oracle === false) byClass[c.class] = (byClass[c.class] ?? 0) + 1;
  const cls = Object.entries(byClass).sort((a, b2) => b2[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || '—';
  rows.push(`| ${label} | ${b.arm} | ${b.buildUsd.toFixed(2)} | ${g.oraclePassed}/${g.oracleN} | ${cls} | ${g.contractsPassed}/${g.contractsN} | ${p.oraclePassed}/${p.oracleN} | ${p.contractsN - p.contractsPassed} | ${j.retry?.identicalJournals ? `identical journals; +${j.retry.grading.nRecovered}/−${j.retry.grading.nRegressed}` : JSON.stringify(j.retry)} |`);
}
console.log(rows.join('\n'));
