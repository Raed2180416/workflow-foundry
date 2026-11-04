#!/usr/bin/env node
// Wave-2 two-reference diagnosis (analysis, $0): on the first N candidate worlds of one item, run reference 1 (corpus graph in n8n-sim)
// and reference 2 (the Foundry transliteration) and print oracle v1's and v2's reasons where they disagree, so a v1-only disagreement
// can be attributed to one of oracle v2's declared changes rather than to a behaviour difference.
//   CI1_BED=/var/tmp/foundry-work/ci1-20261021/bed-w2 node experiments/ci1-w2/agree-why.mjs <id> [N=8]
import { fileURLToPath } from 'node:url';
import { loadItem, candidates, referenceCanon, foundryCanon } from '../ci1/bed.mjs';
import { itemDecl, judge } from './bed2.mjs';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [id, nArg] = process.argv.slice(2);
  const item = await loadItem(id);
  const all = candidates(item, 32), cands = all.slice(0, Number(nArg ?? 8));
  const decl = itemDecl(item, all);
  const ref = await referenceCanon(item, cands);
  for (const w of cands) {
    const r = ref.find(x => x.world === w.id).canon, f = await foundryCanon(item.transliteration, w);
    const j = judge(r, f.canon, decl, w);
    console.log(`${w.id}: v1 ${j.v1.pass ? 'pass' : 'FAIL'} v2 ${j.v2.pass ? 'pass' : 'FAIL'}${j.v1.pass ? '' : ` | v1: ${j.v1.reasons.join(' ; ').slice(0, 400)}`}${j.v2.pass ? '' : ` | v2: ${j.v2.reasons.join(' ; ').slice(0, 400)}`}`);
  }
}
