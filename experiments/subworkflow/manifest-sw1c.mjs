#!/usr/bin/env node
// SW-1c task manifests (PREREG-SW-1c): fresh golive split-'test' seeds (211+), never used by SW-1 (201-208) or SW-1b
// (201-205 blocks). Two lists, each task with the sha256 of its generated inputs:
//   P'  (parts A and B): d5 and d4 at seeds 211-214, interleaved (8 tasks, 16 backlog nodes per arm);
//   B   (part D, the trigger boundary): d2 and d3 at seeds 211-216, interleaved (12 tasks, 24 backlog nodes: d2 backlogs of
//       28-36 rows, which the frozen size trigger does not route, and d3 backlogs of 44-56 rows, which it does).
//   node experiments/subworkflow/manifest-sw1c.mjs --out-p research/subworkflow-20261021/tasks-sw1c-p.json --out-b research/subworkflow-20261021/tasks-sw1c-b.json
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as bed from '../../beds/golive/index.mjs';
import { canonicalJson } from './dsl.mjs';
import { records, observableTrigger } from './trigger.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const make = (order, note) => {
  const tasks = order.map(({ seed, difficulty }) => {
    const t = bed.generate({ seed, split: 'test', difficulty });
    return { id: t.id, seed, split: 'test', difficulty, inputsSha256: createHash('sha256').update(canonicalJson(t.inputs)).digest('hex'),
      channels: bed.channelKinds(t).map(k => ({ ...k, records: records(t.inputs.channels.find(c => c.channel === k.channel).export), sizeTrigger: observableTrigger(t.inputs.channels.find(c => c.channel === k.channel)) })) };
  });
  return { kind: 'sw1c-task-manifest', bed: `golive@${bed.VERSION}`, split: 'test', note, tasks };
};
const p = [], b = [];
for (let s = 211; s <= 214; s++) p.push({ seed: s, difficulty: 5 }, { seed: s, difficulty: 4 });
for (let s = 211; s <= 216; s++) b.push({ seed: s, difficulty: 3 }, { seed: s, difficulty: 2 });
for (const [key, order, note] of [['out-p', p, "SW-1c P': fresh held-out seeds of a dev bed (not sealed)"], ['out-b', b, 'SW-1c boundary stratum B: fresh held-out seeds of a dev bed (not sealed)']]) {
  const text = JSON.stringify(make(order, note), null, 1) + '\n';
  if (args[key]) writeFileSync(args[key], text);
  console.log(`${key}: ${order.length} tasks; sha256 ${createHash('sha256').update(text).digest('hex')}`);
}
