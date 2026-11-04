#!/usr/bin/env node
// Wave-2 root-cause helper (analysis, $0; kept outside experiments/ci1-w2 so the wave-2 freeze is untouched): rerun one recorded build
// in one hidden world and print the reference's canonical effects beside the built workflow's, with oracle v2's reasons, and, with
// --rows, which world rows each built message mentions (the leak check's view).
//   CI1_BED=/var/tmp/foundry-work/ci1-20261021/bed-w2 node experiments/ci1-posthoc/diag-w2.mjs <label> <item> <k> <world> [--rows] [--data]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BED, foundryCanon } from '../ci1/bed.mjs';
import { judge, declV2 } from '../ci1-w2/bed2.mjs';
import { candTokens } from './oracle-v2.mjs';

const RUNS = process.env.CI1_RUNS ?? '/var/tmp/foundry-work/ci1-20261021/runs';
const [label, item, k, worldId] = process.argv.slice(2);
const flags = new Set(process.argv.slice(2).filter(x => x.startsWith('--')));
const rec = JSON.parse(readFileSync(path.join(RUNS, label, 'records', `${item}-k${k}.json`), 'utf8'));
const o = JSON.parse(readFileSync(path.join(BED, 'oracle', `${item}.json`), 'utf8'));
const h = o.hidden.find(x => x.world.id === worldId);
const f = await foundryCanon(rec.workflow, h.world);
const j = judge(h.reference, f.canon, o.decl, h.world);
const one = s => String(s).replace(/\s*\n\s*/g, ' | ').slice(0, 900);
console.log(`# ${label} ${item} k${k} ${worldId}: v2 ${j.v2.pass ? 'pass' : 'FAIL'}\n${j.v2.reasons.join('\n')}`);
if (flags.has('--data')) console.log(`## world\n${JSON.stringify({ now: h.world.now, event: h.world.event, sheets: h.world.sheets }).slice(0, 3000)}`);
for (const [name, c] of [['REFERENCE', h.reference], ['BUILT', f.canon]]) {
  console.log(`## ${name}${name === 'BUILT' ? ` (status ${f.run.status}${f.run.error ? `, ${f.run.error.code} ${f.run.error.message}` : ''})` : ''}`);
  for (const m of c.mail) console.log(`MAIL ${m.to}: ${one(m.subject)} || ${one(m.body)}`);
  for (const m of c.chat) console.log(`CHAT ${m.channel}: ${one(m.text)}`);
  for (const r of c.respond) console.log(`RESPOND ${r.code}: ${one(JSON.stringify(r.body))}`);
}
if (flags.has('--rows')) {
  const d = declV2(o.decl, h.world);
  for (const m of f.canon.mail) { const tk = new Set(candTokens(`${m.subject}\n${m.body}`)); console.log(`rows mentioned by built mail to ${m.to}: ${JSON.stringify(d.rowsWithAddresses.filter(r => r.ids.some(t => tk.has(t))).map(r => r.ids.slice(0, 4)))}`); }
}
