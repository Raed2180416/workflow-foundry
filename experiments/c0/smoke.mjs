// Plumbing smoke for construction sessions (development only; not an experiment).
// Usage: node experiments/c0/smoke.mjs <F|B1> <family> <builderModel> <minutes> <builderBudgetUsd>
import path from 'node:path';
import { construct } from './construct.mjs';
import { createModelPort } from '../lib/models.mjs';
const [arm = 'F', family = 'records', builder = 'claude-haiku-4-5-20251001', minutes = '8', budget = '0.6'] = process.argv.slice(2);
const { port } = createModelPort({ journalFile: path.resolve('experiments/runs/c0-smoke/journal.sqlite') });
const { record, workdir } = await construct({ arm, familyId: family, difficulty: 2, builderModel: builder, builderBudgetUsd: Number(budget), constructionModelUsd: 0.3,
  minutes: Number(minutes), scoreChecks: 4, modelPort: port, workRoot: '/var/tmp/foundry-work/c0-smoke', label: `${arm}-${family}-${Date.now()}`,
  models: ['claude-haiku-4-5-20251001', 'claude-sonnet-5-5'] });
console.log(JSON.stringify(record, null, 1)); console.log('workdir', workdir);
process.exit(0);
