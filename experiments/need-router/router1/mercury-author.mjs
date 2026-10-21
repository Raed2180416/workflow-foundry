// ROUTER-1 independent-text slice: Mercury 3 writes requests a user might type, per category, BEFORE any router code
// exists. The prompt names only a category description (no rubric, no primitive list, no router). The gold label of each
// generated request is written afterwards by hand, item by item, under RUBRIC.md: the category is a generation prompt,
// not a label. Token cap 60,000 for the whole run (budget line: Mercury <= 0.5M tokens for ROUTER-1).
//
//   set -a; . /root/.config/foundry/inception.env; set +a; node experiments/need-router/router1/mercury-author.mjs
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModelPort } from '../../lib/models.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'research/need-router-20261014/router1/mercury-raw.json');
const MODEL = 'mercury-3';

export const CATEGORIES = Object.freeze([
  ['m-code', 'routine requests to an AI coding assistant working in a repository: bug fixes, small features, tests, refactors of one file, config edits'],
  ['m-bigcode', 'large one-off software engineering projects a developer hands to an AI coding agent: big refactors, rewrites, ports to another language, new subsystems, performance work'],
  ['m-devops', 'requests from a growing startup about how they ship software: release processes, deployments, CI/CD with approvals, on-call and incident follow-up, backups, change management'],
  ['m-oss', 'requests from maintainers of an open-source project: handling issues and pull requests, releases, contributors, documentation, community'],
  ['m-research', 'requests from researchers or a lab: literature, experiments, evaluations, protocols, data handling, reviews, reporting'],
  ['m-question', 'one-off questions, explanations, writing, editing, translation or analysis requests to an AI assistant'],
  ['m-bizauto', 'requests from staff at a company (finance, HR, sales, support, operations, marketing) asking an AI agent to take care of business processes across their tools (email, CRM, spreadsheets, Slack, ticketing, accounting)'],
  ['m-bizone', 'single small business actions asked of an AI agent with access to company tools: send one email, update one record, book one meeting, create one ticket'],
  ['m-tricky', 'requests that mention schedules, recurring events, workflows, approvals, automation or compliance, but that are actually a question, a piece of writing, or a single action'],
  ['m-casual', 'short, casual, lowercase chat messages to an AI assistant from busy people asking it to handle something for them, the way people text a colleague']
]);

const SYSTEM = 'You write realistic test data: requests that real people type to an AI assistant or agent. Output JSON only.';
const promptFor = desc => `Write 8 different realistic requests that a person might send to an AI assistant or AI agent, of this kind:\n\n${desc}\n\n` +
  'Vary the length (from one short line to a detailed paragraph of up to 6 sentences), the tone, the industry and the specifics (names, numbers, tools). ' +
  'Write each request exactly as the person would type it, in their voice. Do not number them and do not add commentary.';
const SCHEMA = { type: 'object', additionalProperties: false, required: ['requests'], properties: { requests: { type: 'array', items: { type: 'string' } } } };

async function main() {
  if (existsSync(OUT) && !process.argv.includes('--force')) { console.log(`exists: ${path.relative(ROOT, OUT)} (pass --force to regenerate)`); return; }
  mkdirSync('/var/tmp/foundry-work/need/router1', { recursive: true });
  const { port, tokens } = createModelPort({ journalFile: '/var/tmp/foundry-work/need/router1/mercury-author.sqlite', allowedModels: [MODEL], tokenCap: 60000, callTokens: 6000 });
  const out = { model: MODEL, at: new Date().toISOString(), system: SYSTEM, promptTemplate: promptFor('<category description>'), categories: [] };
  for (const [id, desc] of CATEGORIES) {
    const r = await port.call({ runId: `router1-mercury-author:${id}`, nodeKey: 'author', modelId: MODEL, system: SYSTEM, prompt: promptFor(desc), schema: SCHEMA,
      decoding: { maxTokens: 3000 }, salt: 'router1-mercury-author-v1' });
    if (!r.ok) { console.log(`${id}: ERROR ${r.error?.code} ${r.error?.message?.slice(0, 200)}`); out.categories.push({ id, description: desc, ok: false, error: r.error }); continue; }
    console.log(`${id}: ${r.value.requests.length} requests, ${r.usage.inputTokens}+${r.usage.outputTokens} tokens`);
    out.categories.push({ id, description: desc, ok: true, requests: r.value.requests, usage: r.usage, servedModel: r.meta?.servedModel ?? null, journalId: r.journalId });
  }
  out.tokens = tokens();
  writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`wrote ${path.relative(ROOT, OUT)}; tokens ${JSON.stringify(out.tokens)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
