// R-bench item home-assistant:CCOSTAN/Home-AssistantConfig/config/automation/Speech/garbage_day_garage.yaml#0
// "Garage Garbage Day Reminders": a debounced garage-open trigger, garbage-day (Wed/Sun) and snooze-timer gates, an actionable push with
// two snooze buttons, inside speech and three Alexa announcements that end as soon as the door closes, the day changes or a snooze starts.
//
// Exposes the beds/CONTRACT.md (v1) interface for an interactive family:
//   family, outputSchema, generate({seed, split, difficulty, variant}), oracle(task, output), referenceSolve(task), badControls, createEnv(task)
// plus R-bench extras: variant (T1 translate | T2 rebuild from intent | T3 improve), materialize() for the original definition,
// t3Controls (bad only for T3), and the drivers that turn a solution (a handler factory) into the episode record the oracle judges.
// Development/diagnostic harness: nothing here is a sealed evaluation set (AGENTS.md).
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { CONFIG, SPEC, VERSION, LIMITS, T3_COST } from './spec.mjs';
import { createEnv, driveSync, drive, replay, scenarioList, API_OPS } from './env.mjs';
import { oracle, checkOutput } from './oracle.mjs';
import { makeFaithful, makeImproved } from './controls/reference.mjs';
import { BROKEN, T3_ONLY } from './controls/broken.mjs';
import { ORIGINAL } from './controls/original.mjs';
import { buildExamples } from './examples.mjs';
import { DESCRIPTION, HA_SEMANTICS, API, PROTOCOL, SKELETON, TASK_TEXT, CONFIG_VIEW } from './prompts.mjs';

export { VERSION };
export const ITEM = Object.freeze({
  id: ORIGINAL.id, safeId: 'home-assistant-ccostan-garbage-day-garage', title: 'Garage Garbage Day Reminders', url: ORIGINAL.url, rawSha256: ORIGINAL.sha256,
});
export const VARIANTS = Object.freeze(['T1', 'T2', 'T3']);

export const family = {
  id: 'rbench-home-assistant-garbage-day-garage',
  domain: 'workflow replication / home automation (Home Assistant: debounced trigger, timers, snooze buttons, restart mode)',
  version: VERSION,
  kind: 'interactive',
  description: 'A community-built Home Assistant automation re-posed on an event/wake protocol against a mock Home Assistant on a virtual clock. 15 scripted '
    + 'scenarios (days, flaps, snoozes, midnight, restart, two doors, foreign phone actions) are judged on the ordered, timed trace of service calls the mock recorded '
    + '(+-1 s). T3 adds four reliability probes (a service in an outage window) and a cost cap.',
};

// The episode record: the calls made while handling each event ({call:'done'} ends an event). `meta` is ignored by the oracle.
export const outputSchema = {
  type: 'object',
  required: ['actions'],
  additionalProperties: false,
  properties: {
    actions: {
      type: 'array', maxItems: 100000,
      items: { type: 'object', required: ['call'], additionalProperties: false, properties: { call: { type: 'string', maxLength: 64 }, args: { type: 'object' } } },
    },
    meta: { type: 'object' },
  },
};

function check({ seed, split, difficulty, variant }) {
  if (!['dev', 'test'].includes(split)) throw new Error(`${family.id}: split must be 'dev' or 'test', got ${split}`);
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) throw new Error(`${family.id}: difficulty must be an integer 1..5, got ${difficulty}`);
  if (!(Number.isInteger(seed) || (typeof seed === 'string' && seed.length > 0))) throw new Error(`${family.id}: seed must be an integer or a non-empty string`);
  if (seed === 'examples') throw new Error(`${family.id}: the seed 'examples' is reserved for the worked examples`);
  if (!VARIANTS.includes(variant)) throw new Error(`${family.id}: variant must be one of ${VARIANTS.join(', ')}, got ${variant}`);
}

export function generate({ seed, split = 'dev', difficulty = 3, variant = 'T2' }) {
  check({ seed, split, difficulty, variant });
  const inputs = { config: CONFIG_VIEW(), api: API };
  if (variant === 'T2') {
    const ex = buildExamples();
    inputs.description = DESCRIPTION;
    inputs.eventSamples = ex.eventSamples;
    inputs.examples = { note: 'Worked examples from a different data set (other days, other doors, other times). Each lists what people did, the events the integration received in order (its own wake-ups are not shown) and the service calls the owner\'s setup made, with local times.', scenarios: ex.scenarios };
  } else inputs.haSemantics = HA_SEMANTICS;
  const task = {
    id: `rbench:${ITEM.safeId}:${variant}:${split}:d${difficulty}:s${seed}`,
    family: family.id, seed, split, difficulty, variant,
    prompt: `${TASK_TEXT[variant]}\n\n${PROTOCOL}`,
    inputs,
    files: { 'handler.mjs': SKELETON },
    budget: { maxCallsPerEvent: LIMITS.callsPerRun, maxEventsPerScenario: LIMITS.runsPerScenario },
  };
  if (variant !== 'T2') task.attachments = [{ path: 'original/garbage_day_garage.yaml', source: 'fixtures/original/garbage_day_garage.yaml', sha256: ORIGINAL.sha256, license: ORIGINAL.license, licenseFile: 'fixtures/original/LICENSE', how: 'copy next to the solver workspace; MIT, redistributable' }];
  if (variant === 'T3') task.budget.selfInflictedWork = T3_COST.cap;
  return task;
}

// T1/T3: put the original definition (and its licence) in the solver's workspace. The file is committed under fixtures/original/.
export function materialize(task, dir) {
  const written = [];
  for (const a of task.attachments ?? []) {
    const dest = path.join(dir, a.path);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(new URL(a.source, import.meta.url), dest);
    copyFileSync(new URL(a.licenseFile, import.meta.url), path.join(path.dirname(dest), 'LICENSE'));
    written.push(dest);
  }
  return written;
}

export function referenceSolve(task) {
  return driveSync(task, task.variant === 'T3' ? makeImproved() : makeFaithful());
}

export const badControls = BROKEN.map(({ name, describe, expectFail, make }) => ({ name, describe, expectFail, make }));
export const t3Controls = T3_ONLY.map(({ name, describe, expectFail, expectCostFail, make }) => ({ name, describe, expectFail, expectCostFail, make }));

export { oracle, checkOutput, createEnv, driveSync, drive, replay, scenarioList, makeFaithful, makeImproved, SPEC, CONFIG, LIMITS, T3_COST, API_OPS };
