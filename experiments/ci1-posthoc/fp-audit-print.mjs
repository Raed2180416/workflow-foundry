#!/usr/bin/env node
// False-pass audit helper (analysis, $0): for a PASSING build, rerun it in the hidden world with the most outside effects and print the
// reference's and the build's messages and answers side by side, so a human reader can judge whether the oracle's pass (facts, counts,
// no leaks, sheets) hides a wrong behaviour that wording carries (a wrong tier label, "overdue" vs "due", a missing instruction).
//   node experiments/ci1-posthoc/fp-audit-print.mjs <label> <item> <k>
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BED, foundryCanon } from '../ci1/bed.mjs';

const RUNS = process.env.CI1_RUNS ?? '/var/tmp/foundry-work/ci1-20261021/runs';
const [label, item, k] = process.argv.slice(2);
const rec = JSON.parse(readFileSync(path.join(RUNS, label, 'records', `${item}-k${k}.json`), 'utf8'));
const oracle = JSON.parse(readFileSync(path.join(BED, 'oracle', `${item}.json`), 'utf8'));
const size = h => h.reference.mail.length + h.reference.chat.length + h.reference.respond.length;
const h = [...oracle.hidden].sort((a, b) => size(b) - size(a))[0];
const f = await foundryCanon(rec.workflow, h.world);
const one = s => String(s).replace(/\s*\n\s*/g, ' | ').slice(0, 700);
console.log(`# ${label} ${item} k${k} (pass ${rec.pass}) world ${h.world.id} now ${h.world.now}`);
for (const [name, c] of [['REFERENCE', h.reference], ['BUILT', f.canon]]) {
  console.log(`## ${name}`);
  for (const m of [...c.mail].sort((a, b) => a.to.localeCompare(b.to))) console.log(`MAIL ${m.to}: ${one(m.subject)} || ${one(m.body)}`);
  for (const m of c.chat) console.log(`CHAT ${m.channel}: ${one(m.text)}`);
  for (const r of c.respond) console.log(`RESPOND ${r.code}: ${one(JSON.stringify(r.body))}`);
}
