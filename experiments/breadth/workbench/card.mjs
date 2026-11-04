#!/usr/bin/env node
// WorkBench bed card (PLAN §5.2 "Information", §5.3 item 1; paid, one Opus 5.5 call, about $0.3-1, cap $5). Opus writes the
// card from public material only: the pinned README, the tool schemas and docstrings, the evaluator source, the official
// system prompt and one shipped instance per DEV template (task and gold). Every statement must cite a numbered source line;
// a $0 checker removes any bullet without a valid citation. The card is appended to every arm's system prompt, identical
// for all arms (run.mjs --card), and frozen by sha256 before any sealed run.
//   node experiments/breadth/workbench/card.mjs --dry-run           ($0: the pack, its size and the prompt)
//   node experiments/breadth/workbench/card.mjs --cap 5 [--effort xhigh]
//   node experiments/breadth/workbench/card.mjs --check FILE        ($0: re-run the citation filter on a card)
// The sources are benchmark content (untrusted data): the card is read by a person or a reviewing agent before it is
// frozen, because it goes into every arm's system prompt.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runFacadeSession } from '../facade/session.mjs';
import { armModel } from './arms.mjs';
import { BENCH, CLONE, OFFICIAL_SYSTEM_PROMPT, RESEARCH, catalogFrom, readJson, sha256, shippedTasks, startWorld, writeJson } from './lib.mjs';

export const CARD_VERSION = 'wb-card-v1';
export const MAX_WORDS = 700;

/** The numbered source pack: { sources: Map(id -> text), text } (ids: README.md:N, evaluation.py:N, tool:NAME, dev:ID, prompt). */
export function buildPack({ readme, evaluation, tools, devExamples, officialPrompt }) {
  const sources = new Map();
  const lines = [];
  const add = (id, text) => { sources.set(id, text); lines.push(`[${id}] ${text}`); };
  lines.push('## Source: README.md (WorkBench @49c7dfd0)');
  readme.split('\n').forEach((l, i) => { if (l.trim()) add(`README.md:${i + 1}`, l); });
  lines.push('', '## Source: src/evals/evaluation.py (the official scorer)');
  evaluation.split('\n').forEach((l, i) => { if (l.trim()) add(`evaluation.py:${i + 1}`, l); });
  lines.push('', '## Source: the tools (name, description, parameters)');
  for (const t of tools) add(`tool:${t.bedName}`, `${t.bedName}${t.write ? ' (changes the world)' : ''}: ${t.description.replace(/\s+/g, ' ').slice(0, 1500)} PARAMETERS ${JSON.stringify(t.inputSchema?.properties ?? {})}`);
  lines.push('', '## Source: the official system prompt');
  add('prompt', officialPrompt);
  lines.push('', '## Source: one shipped instance per development template (task and its gold actions)');
  for (const e of devExamples) add(`dev:${e.id}`, `TASK: ${e.task} GOLD: ${JSON.stringify(e.outcome)}`);
  return { sources, text: lines.join('\n') };
}

export const CARD_PROMPT = pack => `You are writing a short "bed card" for AI agents that will work in the WorkBench sandbox: a simulated workplace with calendar, email, analytics, project-management, CRM and company-directory tools. Agents see the card in their system prompt next to the official instructions. The card must help an agent act correctly and be scored correctly; it must not contain answers to specific tasks.

Rules:
- At most ${MAX_WORDS} words, as bullet points under a few headings. Every bullet starts with "- ".
- Every bullet ends with one or more citations of the numbered source lines below, written exactly as they appear, e.g. [README.md:27] or [tool:email.send_email] or [evaluation.py:174] or [dev:email-003]. A bullet without a valid citation will be deleted.
- Use only what the sources say. Do not add facts from memory about this benchmark or its results.
- Cover: what "done" means for the scorer (final world state; extra or duplicate changes; letter case; plots), tool conventions (ids, dates and times, e-mail addresses, field names and allowed values), and common pitfalls visible in the examples. Do not quote gold values of any example.

Sources:
${pack.text}

Write the card now.`;

/** $0 citation filter: keep headings and bullets whose citations all exist in the pack (at least one). */
export function filterCard(card, sources) {
  const kept = [], removed = [];
  const cite = /\[([^\]\s]+)\]/g;
  for (const line of String(card).split('\n')) {
    if (!line.trim().startsWith('- ')) { if (/^#{1,4} /.test(line.trim()) || !line.trim()) kept.push(line); else removed.push({ line, why: 'not a bullet' }); continue; }
    const ids = [...line.matchAll(cite)].map(m => m[1]);
    if (!ids.length) { removed.push({ line, why: 'no citation' }); continue; }
    const bad = ids.filter(id => !sources.has(id));
    if (bad.length) { removed.push({ line, why: `unknown source ${bad.join(', ')}` }); continue; }
    kept.push(line);
  }
  return { card: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n', removed };
}

async function loadPack() {
  const split = readJson(path.join(RESEARCH, 'SPLIT.json'));
  const devSet = new Set(split.devTemplates);
  const shipped = await shippedTasks({ cwd: path.join(BENCH, 'work') });
  const devExamples = [];
  for (const tid of split.devTemplates) {
    const inst = shipped.filter(t => t.template_id === tid).sort((a, b) => (sha256(`${split.salt.sha}:card:${a.id}`) < sha256(`${split.salt.sha}:card:${b.id}`) ? -1 : 1))[0];
    if (inst && devSet.has(inst.template_id)) devExamples.push(inst);
  }
  const live = path.join(BENCH, 'live', `card-${Date.now()}`);
  const world = startWorld(path.join(live, 'world'));
  await world.ready;
  const { bedTools } = await catalogFrom(world);
  await world.close();
  rmSync(live, { recursive: true, force: true });
  return buildPack({ readme: readFileSync(path.join(CLONE, 'README.md'), 'utf8'), evaluation: readFileSync(path.join(CLONE, 'src/evals/evaluation.py'), 'utf8'), tools: bedTools, devExamples, officialPrompt: OFFICIAL_SYSTEM_PROMPT });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  const pack = await loadPack();
  const prompt = CARD_PROMPT(pack);
  if (argv.includes('--check')) {
    const r = filterCard(readFileSync(opt('check'), 'utf8'), pack.sources);
    console.log(JSON.stringify({ removed: r.removed, words: r.card.split(/\s+/).length }, null, 1));
    process.exit(0);
  }
  if (argv.includes('--dry-run')) {
    console.log(JSON.stringify({ version: CARD_VERSION, sources: pack.sources.size, packChars: pack.text.length, promptChars: prompt.length, approxTokens: Math.round(prompt.length / 3.6),
      promptSha256: sha256(prompt), estimateUsd: 'about 0.3-1 (Opus 5.5 xhigh, one call: ~16K prompt tokens written to cache plus thinking and a ~1K-token card)' }, null, 1));
    process.exit(0);
  }
  const cap = Number(opt('cap', 0));
  if (!(cap > 0)) throw new Error('--cap USD is required');
  const arm = armModel('A-O');
  const workdir = path.join(BENCH, 'live', `card-session-${Date.now()}`);
  mkdirSync(workdir, { recursive: true });
  const r = await runFacadeSession({ model: arm.model, effort: opt('effort', 'xhigh'), prompt, workdir, mcpConfig: { mcpServers: {} }, builtinTools: [], budgetUsd: cap, maxTurns: 1,
    systemPrompt: 'You write concise, sourced technical briefs. Cite only the numbered sources you are given.', timeoutMs: 15 * 60_000 });
  rmSync(workdir, { recursive: true, force: true });
  if (!r.ok) throw new Error(`card session failed: ${r.error?.code}`);
  const f = filterCard(r.result, pack.sources);
  const out = path.join(RESEARCH, 'CARD.md');
  writeFileSync(out, f.card);
  writeJson(path.join(RESEARCH, 'CARD.json'), { version: CARD_VERSION, model: arm.model, effort: opt('effort', 'xhigh'), costUsd: r.costUsd, promptSha256: sha256(prompt), rawSha256: sha256(String(r.result)),
    cardSha256: sha256(f.card), words: f.card.split(/\s+/).length, removed: f.removed, at: new Date().toISOString(),
    rule: 'frozen by sha256 before any sealed run; a later edit only on dev evidence, as a logged diff (PLAN §5.3 item 1)' });
  console.log(JSON.stringify({ cardSha256: sha256(f.card), removed: f.removed.length, costUsd: r.costUsd }, null, 1));
}
