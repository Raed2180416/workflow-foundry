// construction_guide (the MCP tool that replaced list_templates; app/FRONT-DOOR.md): what a coding agent reads to build an automation for
// ANY request. Progressive disclosure, as the skill pack is meant to be read:
//   always   the skill core (skills/foundry-construct/SKILL.md, about 900 words), this app's rules (./freeform.mjs FRONT_DOOR_RULES, kept
//            beside the code that enforces them) and the capability catalogue of this workspace's live registry (names, effects, whether
//            each asks the person, input and output schemas)
//   by name  one reference (references/*.md) or one worked example (exemplars/app/*.json on this app's capabilities, with practice
//            cases from exemplars/app/practice/; exemplars/*.json for engine-level patterns)
// Read-only, $0, no model. The examples are worked examples to learn from or start from, never a menu: Foundry builds what the
// workflow says, within the capabilities listed.
import { readFileSync, readdirSync, existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FoundryError } from '../../src/data.mjs';
import { capabilityCatalog, FRONT_DOOR_RULES } from './freeform.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.join(here, '..', '..', 'skills', 'foundry-construct');
const NAME = /^(references\/[a-z0-9-]+\.md|exemplars\/(app\/)?[a-z0-9-]+\.json)$/;

const firstLine = text => (String(text).split('\n').find(l => l.trim() && !l.startsWith('---')) ?? '').replace(/^#+\s*/, '').trim().slice(0, 200);
/** The references and worked examples an agent can load by name, with one line on what each is for. */
export function guideIndex(dir = SKILL_DIR) {
  const references = readdirSync(path.join(dir, 'references')).filter(f => f.endsWith('.md')).sort()
    .map(f => ({ name: `references/${f}`, about: firstLine(readFileSync(path.join(dir, 'references', f), 'utf8')) }));
  const list = sub => existsSync(path.join(dir, 'exemplars', ...sub)) ? readdirSync(path.join(dir, 'exemplars', ...sub)).filter(f => f.endsWith('.json')).sort().map(f => {
    const w = JSON.parse(readFileSync(path.join(dir, 'exemplars', ...sub, f), 'utf8'));
    return { name: ['exemplars', ...sub, f].join('/'), title: w.title, shows: String(w.goal ?? '').slice(0, 300), withPractice: existsSync(path.join(dir, 'exemplars', ...sub, 'practice', f)) };
  }) : [];
  // exemplars/app/: everyday automations on this app's capabilities; exemplars/*.json: engine-level patterns (default registry).
  const exemplars = [...list(['app']), ...list([])];
  return { references, exemplars };
}

/** The guide: everything an agent needs always, or one named reference / example. */
export function constructionGuide(app, { name = null } = {}, dir = SKILL_DIR) {
  if (name !== null && name !== undefined) {
    if (typeof name !== 'string' || !NAME.test(name)) throw new FoundryError('GUIDE_NAME', 'name is one of the references or exemplars the guide lists (references/<name>.md, exemplars/<name>.json)');
    const root = realpathSync(dir), file = path.join(root, name);
    if (!existsSync(file)) throw new FoundryError('NOT_FOUND', `The guide has no ${name}`);
    const real = realpathSync(file);
    if (!real.startsWith(`${root}${path.sep}`) || statSync(real).size > 200000) throw new FoundryError('GUIDE_NAME', 'That file is not part of the guide');
    if (name.startsWith('references/')) return { ok: true, name, text: readFileSync(real, 'utf8') };
    const practiceFile = path.join(path.dirname(real), 'practice', path.basename(name));
    return { ok: true, name, workflow: JSON.parse(readFileSync(real, 'utf8')), ...(existsSync(practiceFile) ? { practiceInput: JSON.parse(readFileSync(practiceFile, 'utf8')).practiceInput } : {}),
      note: 'A worked example: learn from it or start from it, then build what THIS person asked for. Every address in it must be replaced by one the person gave.' };
  }
  const { references, exemplars } = guideIndex(dir);
  return { ok: true, skill: readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), rules: [...FRONT_DOOR_RULES], capabilities: capabilityCatalog(app.registry), references, exemplars,
    next: 'Build the workflow for the person\'s request, then call propose_flow with their exact words, the workflow and practiceInput. Load a reference or example by name only when a step needs it.' };
}
