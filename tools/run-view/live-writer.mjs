#!/usr/bin/env node
// Executes the scripted game-QA fixture run in ITS OWN PROCESS against a workspace whose run already exists, so a viewer watching through serve.mjs
// sees a writer that is separate from the server (the realistic case: `foundry serve` or the CLI writes, a viewer tails).
//   node tools/run-view/live-writer.mjs --workspace DIR --run RUN_ID
import { parseArgs } from 'node:util';
import { registryWith, environment, finishedScript } from './make-fixtures.mjs';
const { values: a } = parseArgs({ options: { workspace: { type: 'string' }, run: { type: 'string' } } });
const env = environment(a.workspace, finishedScript(), {}, registryWith());
const result = await env.runtime.execute(a.run);
env.store.close();
console.log(JSON.stringify({ run: a.run, status: result.status }));
