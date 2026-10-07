// The six workflow-foundry modules frozen into this bed (see README.md, "Source modules").
// Paths are repository-relative and are preserved inside fixtures/<id>/.
export const MODULES = Object.freeze({
  verdict: Object.freeze({
    modulePath: 'src/verdict.mjs', testPath: 'tests/verdict.test.mjs', related: Object.freeze(['src/data.mjs']),
    title: 'run verdicts and authority vocabulary',
  }),
  context: Object.freeze({
    modulePath: 'src/context.mjs', testPath: 'tests/context.test.mjs', related: Object.freeze(['src/data.mjs', 'src/schema-subset.mjs']),
    title: 'deterministic context compiler with integrity labels and token budgets',
  }),
  'schema-subset': Object.freeze({
    modulePath: 'src/schema-subset.mjs', testPath: 'tests/context.test.mjs', related: Object.freeze(['src/data.mjs', 'src/context.mjs']),
    title: 'portable JSON Schema subset and quarantined-output capacity check',
  }),
  journal: Object.freeze({
    modulePath: 'src/journal.mjs', testPath: 'tests/journal.test.mjs', related: Object.freeze(['src/data.mjs']),
    title: 'model-call record/replay journal on node:sqlite',
  }),
  stats: Object.freeze({
    modulePath: 'experiments/lib/stats.mjs', testPath: 'experiments/lib/stats.test.mjs', related: Object.freeze(['beds/lib/rng.mjs']),
    title: 'experiment statistics (pass@k, Wilson, paired bootstrap, McNemar)',
  }),
  distill: Object.freeze({
    modulePath: 'experiments/lib/distill.mjs', testPath: 'experiments/lib/distill.test.mjs', related: Object.freeze(['src/data.mjs']),
    title: 'procedure distillation: leaf agreement and successive-halving model search',
  }),
});
export const MODULE_IDS = Object.freeze(Object.keys(MODULES));
