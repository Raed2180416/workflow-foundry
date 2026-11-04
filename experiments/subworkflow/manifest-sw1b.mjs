#!/usr/bin/env node
// SW-1b task manifest (PREREG-SW-1b.md): golive split 'test' d4 seeds 201-208 in the 'blocks' layout, the same worlds as
// eval-1's d4 tasks. Each task carries the sha256 of its generated inputs, so a bed change after the freeze shows.
//   node experiments/subworkflow/manifest-sw1b.mjs --out research/subworkflow-20261021/tasks-sw1b.json
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as bed from '../../beds/golive/index.mjs';
import * as layouts from '../../beds/golive/layouts.mjs';
import { canonicalJson } from './dsl.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const tasks = [201, 202, 203, 204, 205, 206, 207, 208].map(seed => {
  const t = layouts.generate({ seed, split: 'test', difficulty: 4, layout: 'blocks' });
  return { id: t.id, seed, split: 'test', difficulty: 4, layout: 'blocks', inputsSha256: createHash('sha256').update(canonicalJson(t.inputs)).digest('hex'),
    channels: bed.channelKinds(t) };
});
const manifest = { kind: 'sw1b-task-manifest', bed: `golive@${bed.VERSION}+layouts`, split: 'test', layout: 'blocks',
  note: 'the eval-1 d4 worlds (split test seeds 201-208) re-rendered in the blocks layout; exploratory development evidence', tasks };
const text = JSON.stringify(manifest, null, 1);
if (args.out) writeFileSync(args.out, text + '\n');
console.log(`${tasks.length} tasks; manifest sha256 ${createHash('sha256').update(text + '\n').digest('hex')}`);
