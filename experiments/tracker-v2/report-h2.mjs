#!/usr/bin/env node
// Print the PREREG-TRACKER-H2 tables from research/tracker-20261021/heldout/h2/scores-h2.json (remeasure.mjs score). $0, read-only.
//   node experiments/tracker-v2/report-h2.mjs [--scores FILE]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: a } = parseArgs({ options: { scores: { type: 'string' } } });
const d = JSON.parse(readFileSync(path.resolve(a.scores ?? 'research/tracker-20261021/heldout/h2/scores-h2.json'), 'utf8'));
const f3 = x => (x === null || x === undefined ? '-' : Number(x).toFixed(3));
const cell = x => (x ? `${x.caught}/${x.defective} caught, ${x.falseAlarms} FA, p ${f3(x.precision)}` : '-');
for (const [name, s] of Object.entries(d.settings)) {
  console.log(`\n== ${name}: ${s.builds} builds (${s.defective} defective); model-built ${s.modelBuilt} (${s.modelDefective} defective)`);
  console.log(`T0                    all: ${cell(s.T0)}   model: ${cell(s.T0model)}`);
  console.log(`T-lit ($0)            all: ${cell(s.Tlit)}   model: ${cell(s.TlitModel)}`);
  if (s.TlitTolerantPostHoc) console.log(`T-lit± ($0, post hoc) all: ${cell(s.TlitTolerantPostHoc)}   model: ${cell(s.TlitTolerantPostHocModel)}`);
  (s.T1 ?? []).forEach((t, k) => t && console.log(`T1 k${k}                 all: ${cell(t.all)}   model: ${cell(t.model)}`));
  if (s.T1majority) console.log(`T1 majority of 3      all: ${cell(s.T1majority.all)}   model: ${cell(s.T1majority.model)}`);
  for (const [k, v] of Object.entries(s.T2)) {
    console.log(`T2solo ${k.padEnd(7)}      all: ${cell(v.T2solo)}   model: ${cell(v.T2soloModel)}   T0+T2solo: ${cell(v['T0+T2solo'])}${v.G3modelPool ? `   G3 model pool: ${cell(v.G3modelPool)}` : ''}${v.missing?.length ? `   MISSING ${v.missing.length}` : ''}`);
    console.log(`   FA ids: ${v.T2solo.falseAlarmIds.join(' ') || '-'}`);
  }
  for (const [k, r] of Object.entries(s.rules)) console.log(`rules ${k.padEnd(7)} H1 ${r.H1 ? 'pass' : 'fail'}  H2 ${r.H2 ? 'pass' : 'fail'}  H3 ${r.H3 ? 'pass' : 'fail'}  H4 ${r.H4 ? 'pass' : 'fail'} (vs ${r.H4against} T1 views)`);
}
console.log(`\nH5 pointer recall (key captures): ${Object.entries(d.H5).map(([s, x]) => `${s} ${x.covered}/${x.total}`).join(', ')}`);
console.log(`H7 on B0-H2: ${Object.entries(d.H7).map(([k, x]) => `${k}: repaired ${x.repaired}, fixed ${x.fixed.length} [${x.fixed.join(' ')}], broken ${x.broken.length} [${x.broken.join(' ')}], $${x.costUsd}`).join('; ')}`);
console.log(`B0-H2: ${d.b0h2.builds} builds, ${d.b0h2.defective} defective; host identity occurrences per record: ${JSON.stringify(d.b0h2.hostIdentity)}`);
console.log(`conversations: ${JSON.stringify(d.conversations)}`);
console.log(`spend (USD): ${JSON.stringify(d.spendUsd)}`);
