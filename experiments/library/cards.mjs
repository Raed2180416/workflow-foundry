// cards.mjs: load the L1 layer. Every one of the 54 catalog entries comes from cards/catalog.json (built from the
// census by tools/build-catalog.mjs); a card that has been made executable also has cards/Pxx/{card.json, skeleton.mjs,
// fixtures/*.json} (LIBRARY §3.2; BUILD-ORDER step 3), whose fields take precedence over the catalog's.
import path from 'node:path';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const CARDS_DIR = path.resolve(new URL('./cards/', import.meta.url).pathname);
const sha = s => createHash('sha256').update(s).digest('hex');

export function loadCatalog(dir = CARDS_DIR) {
  const j = JSON.parse(readFileSync(path.join(dir, 'catalog.json'), 'utf8'));
  if (j.schema !== 'l1-catalog/1') throw new Error('cards: catalog.json is not l1-catalog/1');
  return j.patterns;
}

// One executable card: card.json, the skeleton source (and its sha256), and its fixtures (sorted by file name).
export function loadCard(id, dir = CARDS_DIR) {
  const root = path.join(dir, id);
  if (!existsSync(path.join(root, 'card.json'))) return null;
  const card = JSON.parse(readFileSync(path.join(root, 'card.json'), 'utf8'));
  if (card.id !== id) throw new Error(`cards: ${id}/card.json names ${card.id}`);
  const skeletonPath = path.join(root, 'skeleton.mjs'), skeleton = readFileSync(skeletonPath, 'utf8');
  const fxDir = path.join(root, 'fixtures');
  const fixtures = existsSync(fxDir) ? readdirSync(fxDir).filter(f => f.endsWith('.json')).sort().map(f => ({ file: f, ...JSON.parse(readFileSync(path.join(fxDir, f), 'utf8')) })) : [];
  return { ...card, dir: root, skeletonPath, skeleton, skeletonSha256: sha(skeleton), fixtures };
}

// The whole L1 layer: catalog entries merged with executable cards where they exist.
export function loadL1(dir = CARDS_DIR) {
  return loadCatalog(dir).map(entry => {
    const card = loadCard(entry.id, dir);
    return card ? { ...entry, ...card, catalog: entry, executable: true } : { ...entry, executable: false };
  });
}

// The expanded card an S6 fill call sees (LIBRARY §5.1–5.2: one card, ≤ 1,200 tokens): the card's head, the J questions,
// every slot with its type, bounds and doc, and the checklist lines. Not the skeleton (the constructor fills slots, it
// never edits structure) and not the worked example (the slot-group schema carries the shapes). `slots` narrows the slot
// table to one slot group; the rest of the card stays.
export function expandedCard(card, { slots = null } = {}) {
  const bounds = d => [d.range ? `[${d.range.join(',')}]` : '', d.options ? `{${d.options.join('|')}}` : '', d.values ? `<${d.values.join('|')}>` : '',
    d.params ? `(${d.params.join(', ')})` : '', d.fields ? `{${d.fields.join(', ')}}` : '', d.required ? '' : '?', d.default !== undefined ? ` = ${JSON.stringify(d.default)}` : ''].join('');
  const shown = card.slots.filter(d => !slots || slots.includes(d.name));
  return [
    `${card.id} ${card.name} (${card.family}, tier ${card.tier}, v${card.version})`,
    ...card.when.map(j => `${j.id} ${j.type}: ${j.instructions}${j.criteria ? ' [' + Object.keys(j.criteria).join(' | ') + ']' : ''}`),
    'Slots:',
    ...shown.map(d => `- ${d.name}: ${d.type}${bounds(d)}${d.doc ? ' — ' + d.doc : ''}`),
    'Checklist:',
    ...card.checklist.map(c => `- ${c.text}${c.code ? ' (' + c.code + ')' : ''}`),
  ].join('\n');
}
