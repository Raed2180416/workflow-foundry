#!/usr/bin/env node
// SW-1 task manifest: the frozen evaluation task list (split 'test' seeds of the golive bed; held-out from the dev seeds the
// pilots used, not sealed). Each task carries the sha256 of its generated inputs, so a bed change after the freeze shows.
//   node experiments/subworkflow/manifest.mjs --out research/subworkflow-20261021/tasks-eval.json
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as bed from '../../beds/golive/index.mjs';
import { canonicalJson } from './dsl.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
// Interleaved d5/d4 first (the primary stratum), then the d3 no-need stratum: a cap stop leaves a balanced primary set.
const order = [];
for (let s = 201; s <= 208; s++) order.push({ seed: s, difficulty: 5 }, { seed: s, difficulty: 4 });
for (let s = 201; s <= 204; s++) order.push({ seed: s, difficulty: 3 });
const tasks = order.map(({ seed, difficulty }) => {
  const t = bed.generate({ seed, split: 'test', difficulty });
  return { id: t.id, seed, split: 'test', difficulty, inputsSha256: createHash('sha256').update(canonicalJson(t.inputs)).digest('hex'),
    channels: bed.channelKinds(t) };
});
const manifest = { kind: 'sw1-task-manifest', bed: `golive@${bed.VERSION}`, split: 'test', note: 'held-out seeds of a dev bed (not sealed); pilots used split dev seeds 11-14', tasks };
const text = JSON.stringify(manifest, null, 1);
if (args.out) writeFileSync(args.out, text + '\n');
console.log(`${tasks.length} tasks; manifest sha256 ${createHash('sha256').update(text + '\n').digest('hex')}`);
