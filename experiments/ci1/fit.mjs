#!/usr/bin/env node
// Template coverage at $0 (research/ci1-20261021/DOSSIER.md §3 item 4, RetroSim): for each bed item, which of BUILDER-1's 7 templates
// could even bind its data (every sheet the template names exists in the item's workspace with every column it names), and the nearest
// template by column overlap. Prints JSON lines and a summary.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary } from '../../app/core/library.mjs';
import { templateColumns, templateFitsData } from './builders.mjs';
import { BED } from './bed.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const split = JSON.parse(readFileSync(path.join(here, '../../research/ci1-20261021/SPLIT.json'), 'utf8'));
const library = loadLibrary();
let fits = 0;
for (const id of [...split.dev, ...split.test]) {
  const ws = JSON.parse(readFileSync(path.join(BED, 'items', id, 'spec.json'), 'utf8')).workspace;
  const have = new Set(Object.values(ws.sheets ?? {}).flatMap(s => s.columns.map(c => String(c).toLowerCase())));
  const scored = library.map(t => { const need = Object.values(templateColumns(t)).flat(); const hit = need.filter(c => have.has(c.toLowerCase())).length; return { t: t.id, fits: templateFitsData(t, ws), overlap: `${hit}/${need.length}`, share: need.length ? hit / need.length : 0 }; }).sort((a, b) => b.share - a.share);
  const any = scored.filter(s => s.fits).map(s => s.t);
  if (any.length) fits++;
  console.log(JSON.stringify({ id, fitting: any, nearest: scored[0].t, overlap: scored[0].overlap }));
}
console.log(JSON.stringify({ items: split.dev.length + split.test.length, itemsWithAFittingTemplate: fits }));
