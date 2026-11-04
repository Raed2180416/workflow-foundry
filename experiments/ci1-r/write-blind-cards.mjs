#!/usr/bin/env node
// Blind pattern cards for the CI-1 review arms (research/ci1-20261021/r/PREREG-CI1-R.md; review finding 4: the original cards in
// experiments/ci1/library/pattern-hints.json were written by the session that had already written every bed item's description).
// ONE fresh `claude -p` call (claude-opus-5-5, reasoning high, isolated CLI config, account variables removed) that sees only:
// the 16 catalog entries the original cards cover (experiments/library/cards/catalog.json, committed 2026-10-14, before the bed
// existed: id, name, gist, the catalog's own "when" questions, support), the IR rules and the capability list every CI-1 arm sees
// (prompt.mjs), and the shape-feature vocabulary retrieve.mjs matches. It never sees a bed item, a description, a run, or the original
// hints. The output keeps the original file's format (cues, shape, hint per pattern) so retrieve-r.mjs can swap it in unchanged.
//   node experiments/ci1-r/write-blind-cards.mjs [--out experiments/ci1-r/library/pattern-hints-blind.json]
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createModelPort } from '../lib/models.mjs';
import { CI1_PRIMER, capabilityCatalog } from '../ci1/prompt.mjs';
import { stripAccountIdentity, nonFixtureAddresses } from './env-guard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.join(here, '../library/cards/catalog.json');
export const BLIND_IDS = Object.freeze(['P02', 'P04', 'P08', 'P12', 'P15', 'P16', 'P17', 'P27', 'P32', 'P36', 'P37', 'P38', 'P39', 'P42', 'P58', 'P60']);
export const SHAPES = Object.freeze(['trigger:schedule', 'trigger:webhook', 'trigger:form', 'trigger:sheet-rows', 'effect:mail', 'effect:chat', 'effect:respond', 'effect:sheet-write', 'logic:branch', 'logic:match']);
const MODEL = 'claude-opus-5-5';

export function catalogEntries() {
  const cat = JSON.parse(readFileSync(CATALOG, 'utf8')).patterns;
  return BLIND_IDS.map(id => { const p = cat.find(x => x.id === id); return { id, name: p.name, gist: p.gist ?? null, when: (p.when ?? []).map(w => w.instructions), seenInCorpusWorkflows: p.support?.items ?? null }; });
}
export const SYSTEM = 'You write short, exact implementation hints for workflow patterns, for a cheap model that will build workflows in the JSON format described. Reply with JSON only.';
export function promptText() {
  const caps = capabilityCatalog().map(c => `- ${c.name}: ${c.description}`).join('\n');
  return [`A cheap model will be asked to build automations for small businesses (spreadsheets as data, e-mail, chat channels, webhooks and forms) in the workflow format below. Before it builds, it may be shown hints for workflow patterns from a catalog mined from public workflow corpora.`,
    `For each of the ${BLIND_IDS.length} catalog patterns below, write:`,
    `- "hint": at most 70 words: how to realise the pattern correctly in THIS workflow format with THESE capabilities (which node kinds, where the logic goes, what to check, common mistakes to avoid). Generic: no business domain, no example names or values.`,
    `- "cues": at most 14 plain words or short phrases a person's request might contain when the pattern applies (space separated).`,
    `- "shape": the subset of these request-shape features that, when present, make the pattern likely to apply (may be empty): ${SHAPES.join(', ')}.`,
    `Catalog patterns (JSON):\n${JSON.stringify(catalogEntries(), null, 1)}`,
    `Capabilities a workflow may use:\n${caps}`,
    CI1_PRIMER,
    'Return {"patterns": {"<id>": {"hint": "...", "cues": "...", "shape": [...]}, ...}} with exactly these ids.'].join('\n\n');
}
export const SCHEMA = { type: 'object', additionalProperties: false, required: ['patterns'], properties: { patterns: { type: 'object', additionalProperties: false, required: [...BLIND_IDS],
  properties: Object.fromEntries(BLIND_IDS.map(id => [id, { type: 'object', additionalProperties: false, required: ['hint', 'cues', 'shape'], properties: { hint: { type: 'string' }, cues: { type: 'string' }, shape: { type: 'array', items: { type: 'string', enum: [...SHAPES] } } } }])) } } };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values: a } = parseArgs({ options: { out: { type: 'string' } } });
  const out = a.out ?? path.join(here, 'library/pattern-hints-blind.json');
  const removed = stripAccountIdentity();
  const configDir = mkdtempSync(path.join(tmpdir(), 'ci1-claude-config-')); process.env.CLAUDE_CONFIG_DIR = configDir;
  const jdir = mkdtempSync(path.join(tmpdir(), 'ci1-blind-'));
  const { port, db } = createModelPort({ journalFile: path.join(jdir, 'journal.sqlite'), allowedModels: [MODEL], maxBudgetUsdPerCall: 2, timeoutMs: 900000 });
  const prompt = promptText();
  let r;
  try { r = await port.call({ runId: `ci1-r-blind-cards-${Date.now()}`, nodeKey: 'cards', attempt: 0, modelId: MODEL, system: SYSTEM, prompt, schema: SCHEMA, decoding: { maxTokens: 16000, reasoning: 'high' } }); }
  finally { db.close(); rmSync(jdir, { recursive: true, force: true }); rmSync(configDir, { recursive: true, force: true }); }
  if (!r.ok) throw new Error(`card call failed: ${r.error?.code} ${r.error?.message}`);
  const doc = { about: `BLIND pattern cards (review finding 4): written ${new Date().toISOString().slice(0, 10)} by ONE fresh claude -p call (${MODEL}, reasoning high, isolated CLI config, account variables removed: ${removed.join(', ') || 'none present'}) that saw only the 2026-10-14 catalog entries, the IR rules and the capability list (write-blind-cards.mjs promptText); never a bed item, a description, a run or the original hints. Same format as experiments/ci1/library/pattern-hints.json. Frozen by hash in research/ci1-20261021/r/MANIFEST-R.json.`,
    model: MODEL, promptSha256: (await import('node:crypto')).createHash('sha256').update(prompt).digest('hex'), costUsd: r.costUsd ?? null, usage: r.usage ?? null, patterns: r.value.patterns };
  const text = `${JSON.stringify(doc, null, 1)}\n`;
  if (nonFixtureAddresses(text).length) throw new Error('refusing to write: the cards hold a non-fixture address');
  writeFileSync(out, text);
  console.log(JSON.stringify({ out, costUsd: doc.costUsd, ids: Object.keys(doc.patterns).length, words: Object.values(doc.patterns).map(p => p.hint.split(/\s+/).length) }));
}
