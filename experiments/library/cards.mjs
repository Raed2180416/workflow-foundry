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
