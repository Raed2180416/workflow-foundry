#!/usr/bin/env node
// Build time and cost per build and per VERIFIED build (CI-1 review findings 3 and 8: the owner's [67] asks "how much time does it take
// to cheaply build accurate" workflows). From committed summaries only ($0): wallMs is the builder's wall time per build (all model
// calls, validation and practice runs; not the hidden-world scoring), recorded by run-arm.mjs / run-w2.mjs / run-r.mjs. Verified = the
// build passes every hidden world under the named oracle. Wall time depends on host load (4 shared CPUs, load average 15 to 50) and on
// how many builds ran at once (2 or 3 per arm), so it is an upper bound on what an idle machine would take.
//   node experiments/ci1-r/walltime.mjs A0=test-A0+w2-A0 A2=test-A2+w2-A2 ... [--w2x --exclude 16312,17545] [--json out.json]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v2Records } from '../ci1-w2/pooled.mjs';

const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
export function timeCost(records) {
  const n = records.length, pass = records.filter(r => r.pass).length;
  const wall = records.reduce((s, r) => s + (r.wallMs ?? 0), 0), usd = records.reduce((s, r) => s + (r.usd ?? 0), 0);
  return { builds: n, verified: pass, pass1: n ? pass / n : null, medianWallS: median(records.map(r => (r.wallMs ?? 0) / 1000)), meanWallS: n ? wall / n / 1000 : null,
    wallPerVerifiedS: pass ? wall / pass / 1000 : null, usdPerBuild: n ? usd / n : null, usdPerVerified: pass ? usd / pass : null };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = n => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
  const exclude = opt('--exclude')?.split(',') ?? [], w2x = args.includes('--w2x');
  const specs = args.filter((x, i) => x.includes('=') && !['--exclude', '--json'].includes(args[i - 1]));
  const out = {};
  console.log(`| Arm | builds | verified | median s / build | mean s / build | s / verified build | $ / build | $ / verified build |\n|---|---|---|---|---|---|---|---|`);
  for (const s of specs) {
    const [arm, l] = s.split('=');
    const recs = l.split('+').flatMap(x => v2Records(x, { w2x })).filter(r => !exclude.includes(r.item));
    const t = timeCost(recs); out[arm] = t;
    console.log(`| ${arm} | ${t.builds} | ${t.verified} | ${t.medianWallS?.toFixed(0)} | ${t.meanWallS?.toFixed(0)} | ${t.wallPerVerifiedS?.toFixed(0) ?? '-'} | $${t.usdPerBuild?.toFixed(4)} | ${t.usdPerVerified === null ? '-' : `$${t.usdPerVerified.toFixed(4)}`} |`);
  }
  if (opt('--json')) writeFileSync(opt('--json'), `${JSON.stringify({ oracle: w2x ? 'corrected (v2 wave 1, w2x wave 2)' : 'v2', exclude, arms: out }, null, 1)}\n`);
}
