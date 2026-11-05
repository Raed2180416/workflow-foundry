#!/usr/bin/env node
// Held-out requests for the tracker (research/tracker-20261021/PREREG-TRACKER-H.md): written by ANOTHER author than the tracker's,
// Mercury 3 (a different model family from the tracker's Haiku capture and bind), from the template cards alone. It never sees the
// tracker, its prompts, its semantics, BUILDER-1's cases or any run. The requests are kept verbatim; the analyst then writes, BEFORE any
// tracker call on them, the answer key, hidden worlds, oracles, reference slots, bad-slot controls and the gold condition list.
//
//   set -a; . /root/.config/foundry/inception.env; set +a; node experiments/tracker-v2/heldout/author.mjs [--per 2] [--token-cap 40000]
import { parseArgs } from 'node:util';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModelPort } from '../../lib/models.mjs';
import { loadLibrary } from '../../../app/core/library.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const AUTHOR_PROMPT_ID = 'tracker-h-author/1';
export const AUTHOR_SYSTEM = `You write realistic requests that owners and staff of small businesses type into a chat box to get an automation set up.
Each request is in the person's own voice: casual, sometimes terse or messy (typos, arrows, lowercase, run-on sentences), never a spec.
Each request states two to five concrete things the person cares about, in their own words: who receives what, which items are in or out, limits and amounts, timing, what a message must say or how it is signed, what must never happen.
Use made-up but realistic business names, people's first names and e-mail addresses on the business's own domain. Never use example.com.
Vary the industry, the tone and the length (one line to a short paragraph). In some requests leave out one detail the automation would need (for example an e-mail address), the way people do.
Reply with JSON only.`;

/** The cards the author sees: what each automation does and the data it works from. Nothing else. */
export function cardsText(library = loadLibrary()) {
  return library.map(t => `- ${t.id}: ${t.title}. Use it when: ${t.whenToUse} Not for: ${t.notFor} Data it reads: ${Object.entries(t.data ?? {}).map(([k, v]) => `${k} (${v})`).join('; ')}.`).join('\n');
}
const schema = (ids, per) => ({ type: 'object', additionalProperties: false, required: ['requests'], properties: { requests: { type: 'array', minItems: ids.length * per, maxItems: ids.length * per,
  items: { type: 'object', additionalProperties: false, required: ['automation', 'business', 'request'], properties: {
    automation: { type: 'string', enum: ids }, business: { type: 'string', maxLength: 120 }, request: { type: 'string', maxLength: 900 } } } } } });

async function main() {
  const { values: a } = parseArgs({ options: { per: { type: 'string' }, 'token-cap': { type: 'string' }, out: { type: 'string' } } });
  const per = Number(a.per ?? 2);
  const out = path.resolve(a.out ?? path.join(ROOT, 'research/tracker-20261021/heldout'));
  const file = path.join(out, 'requests-mercury-3.json');
  if (existsSync(file)) { console.error(`${file} exists: the held-out requests are written once`); process.exitCode = 1; return; }
  mkdirSync(out, { recursive: true });
  const library = loadLibrary(), ids = library.map(t => t.id);
  const { port, db, tokens } = createModelPort({ journalFile: path.join(out, 'journal', 'mercury-3.sqlite'), allowedModels: ['claude-haiku-5-5', 'mercury-3'], tokenCap: Number(a['token-cap'] ?? 40000), callTokens: 30000 });
  const prompt = `The automations people can ask for:\n${cardsText(library)}\n\nWrite ${per} different requests for each automation (${ids.length * per} in all), each from a different business. A request must be something that automation can do.`;
  try {
    const r = await port.call({ runId: 'tracker-h-author', nodeKey: 'author', attempt: 0, modelId: 'mercury-3', system: AUTHOR_SYSTEM, prompt, schema: schema(ids, per), decoding: { maxTokens: 8000, reasoning: 'none' } });
    if (!r.ok) throw Object.assign(new Error(`author: ${r.error?.code}: ${String(r.error?.message ?? '').slice(0, 300)}`), { code: r.error?.code });
    writeFileSync(file, `${JSON.stringify({ prompt: AUTHOR_PROMPT_ID, model: 'mercury-3', at: new Date().toISOString(), system: AUTHOR_SYSTEM, userPrompt: prompt, usage: r.usage ?? null, tokenMeter: tokens(), requests: r.value.requests }, null, 1)}\n`);
    console.log(`wrote ${path.relative(ROOT, file)}: ${r.value.requests.length} requests; tokens ${JSON.stringify(tokens())}`);
  } finally { db.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`${error.code ?? 'ERROR'}: ${error.message}`); process.exitCode = 1; });
