#!/usr/bin/env node
// Template coverage of the wave-2 items at $0 (as experiments/ci1/fit.mjs for wave 1): which of BUILDER-1's 7 templates could bind each
// item's data (every sheet and column a template names exists in the workspace), and the nearest template by column overlap.
//   CI1_BED=/var/tmp/foundry-work/ci1-20261021/bed-w2 node experiments/ci1-w2/fit-w2.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadLibrary } from '../../app/core/library.mjs';
import { templateColumns, templateFitsData } from '../ci1/builders.mjs';
import { BED } from '../ci1/bed.mjs';
import { SPLIT_W2 } from './manifest-w2.mjs';

const split = JSON.parse(readFileSync(SPLIT_W2, 'utf8'));
const library = loadLibrary();
let fits = 0;
for (const id of split.test) {
  const ws = JSON.parse(readFileSync(path.join(BED, 'items', id, 'spec.json'), 'utf8')).workspace;
  const have = new Set(Object.values(ws.sheets ?? {}).flatMap(s => s.columns.map(c => String(c).toLowerCase())));
  const scored = library.map(t => { const need = Object.values(templateColumns(t)).flat(); const hit = need.filter(c => have.has(c.toLowerCase())).length; return { t: t.id, fits: templateFitsData(t, ws), overlap: `${hit}/${need.length}`, share: need.length ? hit / need.length : 0 }; }).sort((a, b) => b.share - a.share);
  const any = scored.filter(s => s.fits).map(s => s.t);
  if (any.length) fits++;
  console.log(JSON.stringify({ id, fitting: any, nearest: scored[0].t, overlap: scored[0].overlap }));
}
console.log(JSON.stringify({ items: split.test.length, itemsWithAFittingTemplate: fits }));
