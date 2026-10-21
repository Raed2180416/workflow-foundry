#!/usr/bin/env node
// SPEC-0 command line. $0: no model call, no network.
//   node experiments/specbiz/cli.mjs gates --seeds 1-20 [--json FILE]     leak, coverage, precedent and quota gates
//   node experiments/specbiz/cli.mjs render --seed 1 --out DIR            write a pack: the builder's files under DIR/files,
//                                                                         the analyst side (truth) in DIR/pack-truth.json
//   node experiments/specbiz/cli.mjs truth --seed 1 [--json FILE]         the four-layer E8 truth for that pack
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderPack } from './render.mjs';
import { leakTest } from './leak.mjs';
import { coverageTest } from './coverage.mjs';
import { discriminates } from './precedent.mjs';
import { QUOTAS } from './carriers.mjs';
import { truthE8 } from './truth-e8.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const range = s => { const [a, b] = s.split('-').map(Number); return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i); };

export async function gates(seeds) {
  const rows = [];
  for (const seed of seeds) {
    const pack = renderPack({ seed });
    const leak = leakTest(pack), cov = await coverageTest(pack);
    const prec = Object.entries(pack.precedents).map(([id, r]) => discriminates(id, r));
    const quotas = Object.entries(QUOTAS).every(([c, n]) => pack.assignment.counts[c] === n);
    rows.push({ seed, digest: pack.digest, unauthorised: pack.meta.unauthorised, files: pack.meta.files, bytes: pack.meta.bytes,
      leak: { pass: leak.pass, L1: leak.leaks.L1.length, L2: leak.leaks.L2.length, L3: leak.leaks.L3.length, verbatimMax: leak.stats.verbatimShareMax, verbatimMean: leak.stats.verbatimShareMean },
      coverage: { pass: cov.pass, ...cov.gold, platformUMissing: cov.platformU.missing },
      precedent: { pass: prec.every(p => p.ok), n: prec.length }, quotas,
      carriers: Object.fromEntries(Object.entries(pack.assignment.units).filter(([, u]) => u.gold && u.carrier !== 'sop').map(([id, u]) => [id, u.carrier])) });
  }
  const all = k => rows.every(r => r[k].pass);
  return { seeds: seeds.length, pass: all('leak') && all('coverage') && all('precedent') && rows.every(r => r.quotas), rows };
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'gates') {
    const g = await gates(range(arg('--seeds', '1-20')));
    for (const r of g.rows) console.log(`seed ${r.seed}: leak ${r.leak.pass ? 'pass' : 'FAIL'} (L1 ${r.leak.L1}, L2 ${r.leak.L2}, L3 ${r.leak.L3}, verbatim max ${r.leak.verbatimMax.toFixed(2)}), coverage ${r.coverage.pass ? 'pass' : 'FAIL'} (${r.coverage.recoverable}/${r.coverage.n}, without asking ${r.coverage.withoutAsking}), precedent ${r.precedent.pass ? 'pass' : 'FAIL'} (${r.precedent.n}), quotas ${r.quotas ? 'ok' : 'BAD'}, ${r.unauthorised}, ${r.files} files, ${r.bytes} bytes`);
    console.log(`gates: ${g.pass ? 'PASS' : 'FAIL'} over ${g.seeds} seeds`);
    if (arg('--json')) writeFileSync(arg('--json'), `${JSON.stringify(g, null, 1)}\n`);
    process.exitCode = g.pass ? 0 : 1;
  } else if (cmd === 'render') {
    const seed = Number(arg('--seed', '1')), out = arg('--out');
    if (!out) throw new Error('--out DIR required');
    const pack = renderPack({ seed });
    for (const [f, t] of Object.entries(pack.files)) { mkdirSync(path.dirname(path.join(out, 'files', f)), { recursive: true }); writeFileSync(path.join(out, 'files', f), t); }
    const { files, ...truth } = pack;
    writeFileSync(path.join(out, 'pack-truth.json'), `${JSON.stringify({ ...truth, fileList: Object.keys(files) }, null, 1)}\n`);
    console.log(`pack ${pack.digest}: ${pack.meta.files} files, ${pack.meta.bytes} bytes -> ${out}`);
  } else if (cmd === 'truth') {
    const t = truthE8(Number(arg('--seed', '1')));
    if (arg('--json')) writeFileSync(arg('--json'), `${JSON.stringify(t, null, 1)}\n`);
    console.log(JSON.stringify(t.counts, null, 1));
  } else {
    console.log('usage: cli.mjs gates|render|truth (see the header)');
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) await main();
