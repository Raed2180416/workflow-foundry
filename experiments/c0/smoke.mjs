// Plumbing smoke for construction sessions (development only; not an experiment). Same session policy as run-dev.
// Usage: node experiments/c0/smoke.mjs <F|B1> <family> <builderModel> <minutes> <builderBudgetUsd> [effort] [gatewayUsd]
import path from 'node:path';
import { construct } from './construct.mjs';
import { createModelPort } from '../lib/models.mjs';
const MODELS = ['claude-haiku-4-5-20251001', 'claude-sonnet-5-5', 'claude-opus-5-5'];
const [arm = 'F', family = 'records', builder = 'claude-haiku-4-5-20251001', minutes = '8', budget = '0.6', effort = 'high', gateway = '0.3'] = process.argv.slice(2);
const { port } = createModelPort({ journalFile: path.resolve('experiments/runs/c0-smoke/journal.sqlite'), allowedModels: MODELS, concurrency: { 'claude-cli': 16 } });
const { record, workdir } = await construct({ arm, armId: `${arm}-smoke`, familyId: family, difficulty: 2, builderModel: builder, builderEffort: effort, builderBudgetUsd: Number(budget),
  constructionModelUsd: Number(gateway), minutes: Number(minutes), scoreChecks: 4, modelPort: port, workRoot: '/var/tmp/foundry-work/c0-smoke', label: `${arm}-${family}-${Date.now()}`, models: MODELS });
console.log(JSON.stringify(record, null, 1)); console.log('workdir', workdir);
process.exit(0);
