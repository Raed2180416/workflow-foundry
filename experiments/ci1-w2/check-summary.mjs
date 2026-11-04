#!/usr/bin/env node
// One-line summary of a wave-2 bed check report (bed2.mjs check output): agreement, determinism, mutants killed / killable / total,
// hidden worlds, worlds with outside effects, and the surviving mutants (to audit).
//   node experiments/ci1-w2/check-summary.mjs <check-report.json>
import { readFileSync } from 'node:fs';

const text = readFileSync(process.argv[2], 'utf8');
let r;
try { r = JSON.parse(text.slice(text.indexOf('{'))); } catch { console.log(`${process.argv[2]}: not a report: ${text.slice(0, 600)}`); process.exit(0); }
console.log(JSON.stringify({ id: r.id, agreement: typeof r.agreement === 'string' ? r.agreement : `${r.agreement.pass}/${r.agreement.of} (v1 ${r.agreement.v1Pass})`, deterministic: r.deterministic,
  refErrors: r.refErrors, mutants: `${r.mutation.killedByHidden}/${r.mutation.killable}/${r.mutation.total}`, hidden: r.hidden.length, public: r.public, worldsWithEffects: r.worldsWithEffects,
  survivors: r.mutation.survivors, fails: (r.agreement.fails ?? []).map(f => `${f.world}: ${(f.reasons ?? []).join(' ; ').slice(0, 300)}`) }));
