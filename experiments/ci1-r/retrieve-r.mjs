// CI-1 review arms (research/ci1-20261021/r/PREREG-CI1-R.md): wave 1's leave-one-out retrieval (experiments/ci1/retrieve.mjs, frozen
// and unchanged) with the pattern cards read from a GIVEN hints file, plus the static all-cards block of arm A1cH. Only the card source
// differs from retrieve(): same index, exclusions, masked BM25, shape rerank, k = 3 exemplars and 3 cards, same block wording.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, exclusionsFor, maskRequest, shapeOfRequest, shapeOfDraft, jaccard, CATALOG } from '../ci1/retrieve.mjs';
import { bm25Index } from '../library/retrieve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BLIND_HINTS = path.join(here, 'library/pattern-hints-blind.json');

/** Catalog patterns that have a card in hintsFile: {id, name, support, cues, shape, hint}. */
export function loadPatternsFrom(hintsFile = BLIND_HINTS) {
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8')).patterns, hints = JSON.parse(readFileSync(hintsFile, 'utf8'));
  return catalog.filter(p => hints.patterns[p.id]).map(p => ({ id: p.id, name: p.name, support: p.support?.items ?? null, ...hints.patterns[p.id] }));
}
const RETRIEVED_HEAD = 'Patterns from similar automations (retrieved for this request from a public workflow corpus; the corpus examples are structure only, written for another platform, with every name and text removed). Use what applies to THIS request; ignore the rest.';
const card = p => `Pattern ${p.id} "${p.name}"${p.support ? ` (seen in ${p.support} corpus workflows)` : ''}: ${p.hint}`;

/** retrieve() of experiments/ci1/retrieve.mjs with the cards of hintsFile. */
export function retrieveWith({ hintsFile = BLIND_HINTS, request, workspace, targetId, index = buildIndex(), k = 3, kPatterns = 3, draft = null, strict = true }) {
  const ex = exclusionsFor(targetId, index, { strict });
  const pool = index.entries.filter(e => !ex.ids.has(e.id));
  const query = `${maskRequest(request)}\n${Object.keys(workspace?.sheets ?? {}).length ? 'sheet' : ''} ${workspace?.trigger?.kind ?? ''}`;
  const bm = bm25Index(pool.map(e => ({ id: e.id, text: e.text }))).score(query);
  const max = Math.max(1e-9, ...bm.values());
  const shape = shapeOfRequest(request, workspace);
  if (draft) for (const f of shapeOfDraft(draft)) shape.add(f);
  const scored = pool.map(e => { const es = new Set(e.shape); const sj = jaccard(shape, es); return { id: e.id, bm25: (bm.get(e.id) ?? 0) / max, shape: sj, score: (bm.get(e.id) ?? 0) / max + sj, e }; })
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  const exemplars = scored.slice(0, k).map(s => ({ id: s.id, score: Math.round(s.score * 1000) / 1000, bm25: Math.round(s.bm25 * 1000) / 1000, shape: Math.round(s.shape * 1000) / 1000, skeleton: s.e.skeleton }));
  const pats = loadPatternsFrom(hintsFile);
  const pbm = bm25Index(pats.map(p => ({ id: p.id, text: `${p.name} ${p.cues ?? ''}` }))).score(maskRequest(request));
  const pmax = Math.max(1e-9, ...pbm.values());
  const patterns = pats.map(p => ({ p, s: (pbm.get(p.id) ?? 0) / pmax + (p.shape ?? []).filter(f => shape.has(f)).length * 0.5 }))
    .sort((a, b) => b.s - a.s || (a.p.id < b.p.id ? -1 : 1)).slice(0, kPatterns).map(({ p, s }) => ({ id: p.id, name: p.name, hint: p.hint, support: p.support, score: Math.round(s * 1000) / 1000 }));
  const block = [RETRIEVED_HEAD, ...patterns.map(card), ...exemplars.map((e, i) => `Corpus example ${i + 1} (steps; "-> n" is the next step):\n${e.skeleton}`)].join('\n\n');
  return { exemplars: exemplars.map(({ skeleton: _s, ...x }) => x), patterns: patterns.map(({ hint: _h, ...x }) => x), excluded: ex.ids.size - 1, exclusionReasons: ex.reasons, block, shape: [...shape].sort() };
}

/** Arm A1cH: every card of hintsFile in every prompt, nothing retrieved (no index, no exemplars, no ranking). */
export function staticCards(hintsFile = BLIND_HINTS) {
  const pats = loadPatternsFrom(hintsFile);
  const block = ['Patterns from a catalog of workflow patterns mined from public workflow corpora (all of them, not chosen for this request). Use what applies to THIS request; ignore the rest.', ...pats.map(card)].join('\n\n');
  return { block, patterns: pats.map(p => ({ id: p.id, name: p.name, support: p.support })), exemplars: [], excluded: 0 };
}
