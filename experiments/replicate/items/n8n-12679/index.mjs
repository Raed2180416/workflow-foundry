// R-bench item n8n:12679 - two-way contact sync between Zoho CRM and KlickTipp.
// Exposes the beds/CONTRACT.md (v1) interface for an interactive family:
//   family, outputSchema, generate({seed, split, difficulty, variant}), oracle(task, output), referenceSolve(task),
//   badControls, createEnv(task)
// plus R-bench extras: variant (T1 translate | T2 rebuild from intent | T3 improve), materialize() for the original
// definition, and the drivers that turn a handler into the episode record the oracle judges.
// Development/diagnostic harness: nothing here is a sealed evaluation set (AGENTS.md).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CONFIG } from './scenarios.mjs';
import { createEnv, driveSync, drive, policyHandler, LIMITS } from './env.mjs';
import { oracle, baselineCalls, T3_COST_RATIO } from './oracle.mjs';
import { makeFaithful, makeImproved } from './controls/reference.mjs';
import { BROKEN } from './controls/broken.mjs';
import { ORIGINAL, loadOriginal } from './controls/original.mjs';
import { buildExamples } from './examples.mjs';
import { DESCRIPTION, FIELD_MAP, API, PROTOCOL, TASK_TEXT, SKELETON } from './prompts.mjs';

export const VERSION = '0.1.0';
export const ITEM = Object.freeze({ id: 'n8n:12679', safeId: 'n8n-12679', title: 'Sync contacts two-way between Zoho CRM and KlickTipp', url: 'https://n8n.io/workflows/12679', rawSha256: ORIGINAL.sha256 });
export const VARIANTS = Object.freeze(['T1', 'T2', 'T3']);

export const family = {
  id: 'rbench-n8n-12679',
  domain: 'workflow replication / two-system contact sync (Zoho CRM <-> KlickTipp)',
  version: VERSION,
  kind: 'interactive',
  description: 'Event-driven two-way sync between a CRM and an email-marketing tool, replicated from a community-built n8n workflow. 15 scripted scenarios '
    + '(creates, edits, opt-in modes, opt-out, deletions, segment tags, a mixed soak) judged on the state of both mock systems after every step and on the call trace '
    + '(echo loops, duplicate creates). T3 adds four reliability probes the original fails and a cost cap.',
};

// The episode record: the API calls made while handling each event ({call:'done'} ends a run). `meta` is ignored by the oracle.
export const outputSchema = {
  type: 'object',
  required: ['actions'],
  additionalProperties: false,
  properties: {
    actions: {
      type: 'array', maxItems: 10000,
      items: { type: 'object', required: ['call'], additionalProperties: false, properties: { call: { type: 'string', maxLength: 64 }, args: { type: 'object' } } },
    },
    meta: { type: 'object' },
  },
};

const clientConfig = () => ({
  apiUserName: CONFIG.apiUserName,
  zoho: CONFIG.zoho,
  klicktipp: CONFIG.klicktipp,
  segments: CONFIG.segments,
  note: 'The ids below are this environment\'s account. Segment tags carry over by name pair: Zoho tag name <-> KlickTipp tag id.',
});

function check({ seed, split, difficulty, variant }) {
  if (!['dev', 'test'].includes(split)) throw new Error(`${family.id}: split must be 'dev' or 'test', got ${split}`);
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) throw new Error(`${family.id}: difficulty must be an integer 1..5, got ${difficulty}`);
  if (!(Number.isInteger(seed) || (typeof seed === 'string' && seed.length > 0))) throw new Error(`${family.id}: seed must be an integer or a non-empty string`);
  if (seed === 'examples') throw new Error(`${family.id}: the seed 'examples' is reserved for the worked examples`);
  if (!VARIANTS.includes(variant)) throw new Error(`${family.id}: variant must be one of ${VARIANTS.join(', ')}, got ${variant}`);
}

let examplesCache = null;
const examples = () => (examplesCache ??= buildExamples());

export function generate({ seed, split = 'dev', difficulty = 3, variant = 'T2' }) {
  check({ seed, split, difficulty, variant });
  const ex = examples();
  const inputs = { config: clientConfig(), api: API, eventSamples: ex.eventSamples };
  if (variant !== 'T1') inputs.description = DESCRIPTION;
  if (variant === 'T2') { inputs.fieldMap = FIELD_MAP; inputs.examples = { note: 'Worked examples from a different data set. Each step lists what people did, the events delivered to the integration (in order; the events with modifiedBy equal to the integration user are the echoes of its own writes), and the state both systems ended in.', scenarios: ex.scenarios }; }
  const task = {
    id: `rbench:${ITEM.safeId}:${variant}:${split}:d${difficulty}:s${seed}`,
    family: family.id, seed, split, difficulty, variant,
    prompt: `${TASK_TEXT[variant]}\n\n${PROTOCOL}`,
    inputs,
    files: { 'handler.mjs': SKELETON },
    budget: { maxEventsPerChange: LIMITS.runsPerQuiescence, maxCallsPerEvent: LIMITS.callsPerRun },
  };
  if (variant !== 'T2') task.attachments = [{ path: 'original/workflow.json', source: ORIGINAL.rawPath, sha256: ORIGINAL.sha256, how: 'gunzip, take .workflow.workflow (n8n workflow object); read at task time, never committed (n8n ToS)' }];
  if (variant === 'T3') task.budget.externalCalls = baselineCalls(task);
  return task;
}

// T1/T3: write the original definition into the solver's workspace. Needs the corpus file; verifies its sha256.
export function materialize(task, dir) {
  const written = [];
  for (const a of task.attachments ?? []) {
    const wf = loadOriginal({ rawPath: a.source, sha256: a.sha256 });
    const file = path.join(dir, a.path);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ name: ITEM.title, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }, null, 1));
    written.push(file);
  }
  return written;
}

export function referenceSolve(task) {
  return driveSync(task, task.variant === 'T3' ? makeImproved(CONFIG) : makeFaithful(CONFIG));
}

export const badControls = BROKEN.map(({ name, describe, expect, make }) => ({ name, describe, expect, make }));

export { oracle, createEnv, driveSync, drive, policyHandler, T3_COST_RATIO, LIMITS, CONFIG };
