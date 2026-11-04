#!/usr/bin/env node
// SW-1 post hoc check ($0, analysis side; not part of the frozen pipeline). The parent-directed arms (A1F, A1TF, A2F,
// A2OF) route a node to a sub-workflow when bed.channelKinds(task) says the channel is a backlog: the world's own field,
// a trigger that is right by construction. This asks whether a trigger computed only from what the parent observes in the
// node's input would have routed the same nodes. The primitives live in trigger.mjs (frozen for SW-1c):
//   format: the export is not a JSON list (simple channels hand over a JSON list; backlogs are legacy text reports);
//   size:   the export holds more than ROWS records (lines that look like data rows, or @@ RECORD blocks).
// Reported per (layout, difficulty): agreement of each primitive and of "format OR size" with the world's kind.
// Caveat (review defect 3): the threshold 40 was chosen after seeing the record ranges below, so agreement on these
// manifests is a fit, not a test; PREREG-SW-1c freezes it before a stratum where it can be wrong.
//   node experiments/subworkflow/trigger-check.mjs [--manifests research/subworkflow-20261021/tasks-eval.json,research/subworkflow-20261021/tasks-sw1b.json] [--rows 40]
import { readFileSync } from 'node:fs';
import * as bed from '../../beds/golive/index.mjs';
import * as layouts from '../../beds/golive/layouts.mjs';
import { records, primitives, SIZE_ROWS } from './trigger.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const manifests = (args.manifests ?? 'research/subworkflow-20261021/tasks-eval.json,research/subworkflow-20261021/tasks-sw1b.json').split(',');
const ROWS = Number(args.rows ?? SIZE_ROWS);
export { records };
export const trigger = { format: primitives.format, size: input => primitives.size(input, ROWS) };

const cells = new Map();
for (const m of manifests) for (const t of JSON.parse(readFileSync(m, 'utf8')).tasks) {
  const task = layouts.generate({ seed: t.seed, split: t.split, difficulty: t.difficulty, layout: t.layout ?? 'delimited' });
  const kinds = new Map(bed.channelKinds(task).map(k => [k.channel, k.kind]));
  for (const input of task.inputs.channels) {
    const truth = kinds.get(input.channel) === 'backlog';
    const key = `${t.layout ?? 'delimited'} d${t.difficulty}`;
    const c = cells.get(key) ?? { nodes: 0, format: 0, size: 0, either: 0, backlogRows: [], simpleRows: [] };
    const f = trigger.format(input), s = trigger.size(input);
    c.nodes++; c.format += f === truth; c.size += s === truth; c.either += (f || s) === truth;
    (truth ? c.backlogRows : c.simpleRows).push(records(input.export));
    cells.set(key, c);
  }
}
const range = xs => (xs.length ? `${Math.min(...xs)}-${Math.max(...xs)}` : '-');
console.log(`| tasks | nodes | format agrees | size > ${ROWS} agrees | format or size agrees | backlog records | simple records |`);
console.log('|---|---|---|---|---|---|---|');
for (const [k, c] of cells) console.log(`| ${k} | ${c.nodes} | ${c.format}/${c.nodes} | ${c.size}/${c.nodes} | ${c.either}/${c.nodes} | ${range(c.backlogRows)} | ${range(c.simpleRows)} |`);
