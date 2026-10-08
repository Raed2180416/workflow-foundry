// R-bench item n8n:20281 - support-email triage: Gmail + Outlook intake, model classification, Jira dedupe/create/comment, Slack/Teams, acknowledgements, audit sheet.
// Exposes the beds/CONTRACT.md (v1) interface for an interactive family:
//   family, outputSchema, generate({seed, split, difficulty, variant}), oracle(task, output), referenceSolve(task), badControls, createEnv(task)
// plus R-bench extras: variant (T1 translate | T2 rebuild from intent | T3 improve), materialize() for the original definition, and the drivers that turn
// a handler into the episode record the oracle judges. Development/diagnostic harness: nothing here is a sealed evaluation set (AGENTS.md).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { configFor, THRESHOLDS } from './spec.mjs';
import { createEnv, driveSync, drive, policyHandler, replay, LIMITS } from './env.mjs';
import { oracle, CODES } from './oracle.mjs';
import { makeFaithful } from './controls/reference.mjs';
import { makeImproved } from './controls/improved.mjs';
import { BROKEN } from './controls/broken.mjs';
import { buildExamples } from './examples.mjs';
import { ORIGINAL, loadOriginal } from './controls/n8n-emulator.mjs';
import { DESCRIPTION, API, PROTOCOL, TASK_TEXT, SKELETON } from './prompts.mjs';

export const VERSION = '0.1.0';
export { ORIGINAL };
export const ITEM = Object.freeze({ id: 'n8n:20281', safeId: 'n8n-20281', title: 'Create Jira tickets from Gmail and Outlook support emails with OpenAI and Slack', url: 'https://n8n.io/workflows/20281', rawSha256: ORIGINAL.sha256 });
export const VARIANTS = Object.freeze(['T1', 'T2', 'T3']);
// T3 cost targets as fractions of the original's numbers on the same stream (frozen before any comparative run; see README "Freezing").
export const T3_TARGET_RULE = Object.freeze({ modelUsdMax: 0.40, externalCallsMax: 1.0, latencyMsMax: 1.0 });

export const family = {
  id: 'rbench-n8n-20281',
  domain: 'workflow replication / support-email triage (Gmail + Outlook -> Jira, Slack, Teams, Sheets) with a model classification step',
  version: VERSION,
  kind: 'interactive',
  description: 'A community-built n8n support-triage automation, replicated against mocks. 80 frozen synthetic mails (15 internal/automated, 10 follow-ups on open tickets, 10 deliberately ambiguous, 2 with failing '
    + 'model calls) are delivered one at a time; the oracle judges the committed effects (tickets, comments, Slack, Teams, replies, audit rows) against the job\'s routing rules and the frozen labels '
    + '(category >= 0.85, priority >= 0.80). T3 adds five fault-injection probes and a cost target.',
};

// The episode record: the service calls made while handling each mail ({call:'done'} ends a run). `meta` is ignored by the oracle.
export const outputSchema = {
  type: 'object',
  required: ['actions'],
  additionalProperties: false,
  properties: {
    actions: { type: 'array', maxItems: 20000, items: { type: 'object', required: ['call'], additionalProperties: false, properties: { call: { type: 'string', maxLength: 64 }, args: { type: 'object' } } } },
    modelTape: { type: 'array', maxItems: 5000, items: { type: 'object' } },
    meta: { type: 'object' },
  },
};

function check({ seed, split, difficulty, variant }) {
  if (!['dev', 'test'].includes(split)) throw new Error(`${family.id}: split must be 'dev' or 'test', got ${split}`);
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) throw new Error(`${family.id}: difficulty must be an integer 1..5, got ${difficulty}`);
  if (!(Number.isInteger(seed) || (typeof seed === 'string' && seed.length > 0))) throw new Error(`${family.id}: seed must be an integer or a non-empty string`);
  if (!VARIANTS.includes(variant)) throw new Error(`${family.id}: variant must be one of ${VARIANTS.join(', ')}, got ${variant}`);
}

let examplesCache = null;
const examples = () => (examplesCache ??= buildExamples());
const baselineCache = new Map();
// The original's cost on the scored stream, measured with the faithful reference (its traces equal the original's; see controls/report.json).
export function baselineCost({ seed, split = 'dev', difficulty = 3 }) {
  const key = `${seed}|${split}|${difficulty}`;
  if (!baselineCache.has(key)) {
    const t = { seed, split, difficulty, variant: 'T2' };
    const r = oracle(t, driveSync(t, makeFaithful(configFor(difficulty))));
    baselineCache.set(key, { modelUsd: r.details.cost.model.usd, modelCalls: r.details.cost.model.calls, externalCalls: r.details.cost.externalCalls, latencyMs: r.details.cost.latencyMs });
  }
  return baselineCache.get(key);
}

export function generate({ seed, split = 'dev', difficulty = 3, variant = 'T2' }) {
  check({ seed, split, difficulty, variant });
  const config = configFor(difficulty);
  const inputs = { config, api: API };
  if (variant !== 'T1') inputs.description = DESCRIPTION;
  if (variant === 'T2') inputs.examples = { note: 'Worked examples from a different mailbox and a different Jira (ticket numbers differ). Each shows the message the integration received, what the classifier answered, and what the automation did.', ...examples() };
  const task = {
    id: `rbench:${ITEM.safeId}:${variant}:${split}:d${difficulty}:s${seed}`,
    family: family.id, seed, split, difficulty, variant,
    prompt: `${TASK_TEXT[variant]}\n\n${PROTOCOL}`,
    inputs,
    files: { 'handler.mjs': SKELETON },
    budget: { callsPerMail: LIMITS.callsPerRun, modelCallsPerMail: LIMITS.modelCallsPerRun },
  };
  if (variant !== 'T2') task.attachments = [{ path: 'original/workflow.json', source: ORIGINAL.rawPath, sha256: ORIGINAL.sha256, how: 'gunzip, take .workflow.workflow (n8n workflow object: nodes, connections, settings); read at task time, never committed (n8n ToS)' }];
  if (variant === 'T3') {
    const b = baselineCost({ seed, split, difficulty });
    task.budget.baseline = b;
    task.budget.target = { modelUsdMax: Number((b.modelUsd * T3_TARGET_RULE.modelUsdMax).toFixed(6)), externalCallsMax: Math.floor(b.externalCalls * T3_TARGET_RULE.externalCallsMax), latencyMsMax: Math.floor(b.latencyMs * T3_TARGET_RULE.latencyMsMax),
      note: 'over the 80-mail scored stream only; the fault-injection probes are judged on correctness, not on cost' };
  }
  return task;
}

// T1/T3: write the original definition into the solver's workspace. Needs the corpus file; verifies its sha256.
export { loadOriginal };
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
  const cfg = configFor(task.difficulty);
  return driveSync(task, task.variant === 'T3' ? makeImproved(cfg) : makeFaithful(cfg));
}
export const badControls = BROKEN.map(({ name, describe, expect, appliesAt, make }) => ({ name, describe, expect, appliesAt, make }));

export { oracle, createEnv, driveSync, drive, policyHandler, replay, LIMITS, CODES, THRESHOLDS, SKELETON };
