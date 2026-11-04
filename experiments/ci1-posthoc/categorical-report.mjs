#!/usr/bin/env node
// Which columns oracle v2 treats as categorical (never row identity) on each bed item, so the change can be audited: a column that
// identifies rows (a name, an id, an address) must not appear here. Analysis, $0.
//   node experiments/ci1-posthoc/categorical-report.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BED } from '../ci1/bed.mjs';
import { categoricalColumns } from './oracle-v2.mjs';

const split = JSON.parse(readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '../../research/ci1-20261021/SPLIT.json'), 'utf8'));
for (const id of [...split.dev, ...split.test]) {
  const o = JSON.parse(readFileSync(path.join(BED, 'oracle', `${id}.json`), 'utf8'));
  const cat = categoricalColumns([...o.hidden.map(h => h.world), o.public.world]);
  console.log(`${id}: ${[...cat].sort().join(', ') || '-'}`);
}
