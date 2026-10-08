#!/usr/bin/env node
// Scores one handler module against this item.
//   node experiments/replicate/items/n8n-12679/run-handler.mjs <handler.mjs> [--variant T2] [--seed 1] [--difficulty 3] [--split dev] [--policy] [--record out.json]
// <handler.mjs> default-exports handle(event, api) (or, with --policy, policy({event, history})). It is IMPORTED AND RUN IN THIS PROCESS:
// only use it for code you trust. Arms that run model-written code must execute it in their sandbox and hand only the resulting
// {actions} record to oracle() (see README, "Running untrusted solutions").
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import * as bed from './index.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? dflt : process.argv[i + 1]; };
const file = process.argv[2];
if (!file || file.startsWith('--')) { console.error('usage: run-handler.mjs <handler.mjs> [--variant T2] [--seed 1] [--difficulty 3] [--split dev] [--policy] [--record out.json]'); process.exit(2); }
const seedArg = arg('seed', '1');
const task = bed.generate({ seed: /^-?\d+$/.test(seedArg) ? Number(seedArg) : seedArg, split: arg('split', 'dev'), difficulty: Number(arg('difficulty', '3')), variant: arg('variant', 'T2') });
let handler = (await import(pathToFileURL(path.resolve(file)).href)).default;
if (typeof handler !== 'function') { console.error('the module must default-export a function'); process.exit(2); }
if (process.argv.includes('--policy')) handler = bed.policyHandler(handler);
const t0 = Date.now();
const out = await bed.drive(task, handler);
const verdict = bed.oracle(task, out);
if (arg('record')) writeFileSync(arg('record'), JSON.stringify(out));
console.log(JSON.stringify({ task: task.id, pass: verdict.pass, score: verdict.score, coreFailed: verdict.details.coreFailed, probesFailed: verdict.details.probesFailed, cost: { externalCalls: verdict.details.cost.externalCalls, target: verdict.details.cost.target, failedCalls: verdict.details.cost.failedCalls }, handlerErrors: out.meta.handlerErrorCount, wallMs: Date.now() - t0 }, null, 1));
process.exit(verdict.pass ? 0 : 1);
