#!/usr/bin/env node
// Bed-author helper (CI-1 wave 2): run an item's reference (corpus graph + patches, in n8n-sim, sandboxed) on its first N candidate
// worlds and print each world's data summary and canonical effects; with --tl also run the Foundry transliteration and show the
// oracle's verdict per world. Used while writing a generator, patches and a transliteration. Set CI1_BED to the wave-2 bed.
//   CI1_BED=/var/tmp/foundry-work/ci1-20261021/bed-w2 node experiments/ci1-w2/peek.mjs <id> [--n 6] [--from 0] [--tl] [--world c07] [--data]
import { loadItem, candidates, referenceCanon, foundryCanon } from '../ci1/bed.mjs';
import { staticVocabulary, factsOf } from '../ci1/canon.mjs';
import { judge, itemDecl, N_CANDIDATES } from './bed2.mjs';
import { validateCi1 } from '../ci1/foundry-world.mjs';

const args = process.argv.slice(2);
const id = args[0];
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const n = Number(opt('--n', 6)), from = Number(opt('--from', 0)), only = opt('--world', null);
const item = await loadItem(id);
const vocab = staticVocabulary(item.workflow);
const all = candidates(item, N_CANDIDATES);
const decl = itemDecl(item, all);
let worlds = all;
worlds = only ? worlds.filter(w => w.id === only) : worlds.slice(from, from + n);
const ref = await referenceCanon(item, worlds);
if (args.includes('--tl')) { const v = validateCi1(item.transliteration); if (!v.valid) { console.log('TRANSLITERATION INVALID', JSON.stringify(v.errors).slice(0, 1500)); process.exit(1); } }
const one = s => String(s).replace(/\s*\n\s*/g, ' | ');
let agree = 0;
for (const w of worlds) {
  const r = ref.find(x => x.world === w.id);
  const c = r.canon;
  console.log(`\n## ${w.id} now ${w.now} ok=${c.ok}${c.error ? ` ERROR ${c.error}` : ''} steps=${r.steps}`);
  if (args.includes('--data')) console.log(`   event ${JSON.stringify(w.event ?? null).slice(0, 1500)}\n   sheets ${JSON.stringify(w.sheets ?? {}).slice(0, 3000)}`);
  for (const m of c.mail) console.log(`   MAIL ${m.to}: ${one(m.subject)} || ${one(m.body).slice(0, 900)}\n      facts ${JSON.stringify(factsOf(`${m.subject}\n${m.body}`, vocab))}`);
  for (const m of c.chat) console.log(`   CHAT ${m.channel}: ${one(m.text).slice(0, 900)}\n      facts ${JSON.stringify(factsOf(m.text, vocab))}`);
  for (const x of c.respond) console.log(`   RESPOND ${x.code}: ${JSON.stringify(x.body).slice(0, 900)}`);
  for (const [name, rows] of Object.entries(c.sheets)) { const before = JSON.stringify(w.sheets[name]?.rows ?? []); if (JSON.stringify(rows) !== before) console.log(`   SHEET ${name} after: ${JSON.stringify(rows).slice(0, 1500)}`); }
  if (args.includes('--tl')) {
    const f = await foundryCanon(item.transliteration, w);
    const j = judge(c, f.canon, decl, w), e = j.v2;
    if (e.pass) agree++;
    console.log(`   TL ${e.pass ? 'AGREES' : `DIFFERS: ${e.reasons.join(' ; ').slice(0, 1500)}`}${j.v1.pass ? '' : ` [v1: ${j.v1.reasons.join(' ; ').slice(0, 300)}]`}${f.run.error ? ` (tl error ${f.run.error.code} ${f.run.error.message})` : ''}`);
    if (!e.pass) { for (const m of f.canon.mail) console.log(`      tl MAIL ${m.to}: ${one(m.subject)} || ${one(m.body).slice(0, 600)}`); for (const m of f.canon.chat) console.log(`      tl CHAT ${m.channel}: ${one(m.text).slice(0, 600)}`); for (const x of f.canon.respond) console.log(`      tl RESPOND ${x.code}: ${JSON.stringify(x.body).slice(0, 600)}`); for (const [nm, rows] of Object.entries(f.canon.sheets)) console.log(`      tl SHEET ${nm}: ${JSON.stringify(rows).slice(0, 800)}`); }
  }
}
if (args.includes('--tl')) console.log(`\nagreement ${agree}/${worlds.length}`);
