#!/usr/bin/env node
// Size a fan-out from measured probes (src/sizing.mjs). Usage:
//   node tools/sizing/plan.mjs --probes probes.json --units N --budget USD --recall 0.95 [--classes S,M,L] [--min-known 20]
// probes.json: [{ "modelClass": "S", "shardSize": 40, "known": 25, "found": 25, "costUsd": 0.03 }, ...], one row per probe
// shard whose answers are known. Prints the plan as JSON. Exit 0: a plan (fan-out or single); 2: a refusal (no size meets
// the recall bar, or over budget: filter more by code, sample, or ask); 1: bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { planFanOut } from '../../src/sizing.mjs';

try {
  const { values } = parseArgs({ options: { probes: { type: 'string' }, units: { type: 'string' }, budget: { type: 'string' }, recall: { type: 'string' },
    classes: { type: 'string' }, 'min-known': { type: 'string' } }, strict: true });
  for (const k of ['probes', 'units', 'budget', 'recall']) if (values[k] === undefined) throw new Error(`--${k} is required`);
  const plan = planFanOut({ probes: JSON.parse(readFileSync(values.probes, 'utf8')), units: Number(values.units), budgetUsd: Number(values.budget),
    recallBar: Number(values.recall), classOrder: values.classes ? values.classes.split(',') : [],
    ...(values['min-known'] === undefined ? {} : { minKnownPerSize: Number(values['min-known']) }) });
  process.stdout.write(`${JSON.stringify(plan, null, 1)}\n`);
  process.exitCode = plan.decision === 'refuse' ? 2 : 0;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: { code: 'SIZING_INPUT', message: error.message } })}\n`);
  process.exitCode = 1;
}
