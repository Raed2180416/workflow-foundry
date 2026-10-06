import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CapabilityRegistry, createDefaultRegistry } from '/home/raed/Projects/workflow-foundry/src/capabilities.mjs';
import { FoundryError, clone, digest } from '/home/raed/Projects/workflow-foundry/src/data.mjs';
import { CORE_NAMES, INSTRUMENT_DESCRIPTORS } from './contract.mjs';

// Only observations are exposed. Expected answers are never read here. Logs are
// module-private, per registry/run, and unavailable as a workflow capability.
const receipts = new WeakMap();
const implementationHash = createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
export function instrumentLog(registry, runId) {
  const state = receipts.get(registry);
  if (!state) throw new FoundryError('BENCHMARK_REGISTRY', 'Registry was not created by this benchmark');
  return clone(state.get(runId) ?? []);
}

/** Compatible with evaluateWorkflow and suiteEvaluator. For Foundry trials,
 * pass only public development cases as {trialCases: developmentSuite.cases}.
 * Never pass heldout cases to a generator or a trial-visible registry.
 */
export function registryFactory({ trialCases = [] } = {}) {
  const registry = new CapabilityRegistry();
  const log = new Map(); receipts.set(registry, log);
  const trialWorlds = new Map();
  for (const item of trialCases) {
    const key = digest(item.input);
    if (trialWorlds.has(key)) throw new FoundryError('AMBIGUOUS_TRIAL', 'Trial inputs must identify one public development fixture');
    trialWorlds.set(key, clone({ observations: item.fixture.observations }));
  }
  const defaults = createDefaultRegistry();
  for (const name of CORE_NAMES) {
    const { handlerHash, ...spec } = defaults.get(name);
    registry.register(spec);
  }
  const observe = (instrument, args, ctx) => {
    const run = ctx.store.run(ctx.runId);
    const world = ctx.store.fixture(ctx.runId) ?? trialWorlds.get(digest(run.input));
    const events = log.get(ctx.runId) ?? []; log.set(ctx.runId, events);
    const entry = { ordinal: events.length + 1, instrument, sampleId: args.sampleId,
      nodeKey: ctx.nodeKey, idempotencyKey: ctx.idempotencyKey,
      syntheticCost: instrument === 'screen' ? 1 : 10, outcome: 'pending' };
    events.push(entry);
    try {
      if (ctx.signal?.aborted) throw new FoundryError('CANCELLED', 'Cancelled before local observation');
      if (!run.input.samples.some(item => item.id === args.sampleId)) throw new FoundryError('UNKNOWN_SAMPLE', 'Requested sample is not in this batch');
      const supplied = world?.observations?.[args.sampleId]?.[instrument];
      if (!supplied) throw new FoundryError('NO_SCENARIO', 'No local observation attached to this run; trial requires a public development input');
      if (supplied.error) throw new FoundryError(supplied.error, 'Synthetic instrument unavailable');
      const observation = clone(supplied.returned);
      entry.outcome = 'returned'; entry.observation = observation;
      return observation;
    } catch (error) {
      entry.outcome = 'threw'; entry.errorCode = error.code ?? 'ERROR'; throw error;
    }
  };
  for (const descriptor of INSTRUMENT_DESCRIPTORS) {
    const execute = descriptor.name === 'data.one'
      ? async ({ values }) => {
          const kept = values.filter(value => value !== null);
          if (kept.length !== 1) throw new FoundryError('ONE_VALUE', 'Exactly one non-null value is required');
          return { value: kept[0] };
        }
      : async (args, ctx) => observe(descriptor.name === 'lab.screen' ? 'screen' : 'reproduce', args, ctx);
    registry.register({ ...descriptor, implementation: `foundry-consequence-benchmark/1/${implementationHash}`, execute });
  }
  return registry;
}
