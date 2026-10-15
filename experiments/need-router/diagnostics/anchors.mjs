// Features of the anchor beds (need-r0pad, need-r3mini, need-stage, need-codefix-noverifier, need-qa, need-constraint) computed now
// with experiments/need-router/features.mjs, for D1's second table and D0's anchor sensitivity: they have no entry in the committed census.
// $0, code only (task generation reads no oracle, no reference, no label). Example seeds 601-603 at difficulty 3 and 5, the census's own recipe.
// A bed that fails to load is reported, never guessed. The anchor beds were still being written (task #56) when the first run was made, so each
// bed's version (family.version) and a sha256 over its generator files (its own directory and every bed directory it imports, tests and READMEs
// left out: bedStamp) are recorded beside the features; a later run that finds another hash says so (currency.mjs) instead of drifting silently.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { familyFeatures } from '../features.mjs';
import { loadFamily } from '../../lib/beds.mjs';
import { ANCHOR_BEDS } from './d1-shortcut.mjs';
import { REPO, assertExampleSeeds } from './common.mjs';

const sha = x => createHash('sha256').update(x).digest('hex');
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm;
/**
 * The files a bed loads: beds/<bed>/index.mjs and every file it reaches through relative static or literal dynamic imports inside beds/ (the module
 * graph the task generator runs in; beds/sealed is never followed). Repository-relative paths, sorted. A file that is not there is skipped.
 */
export function bedGeneratorFiles(bed, { repo = REPO } = {}) {
  const root = path.join(repo, 'beds'), seen = new Set(), queue = [path.join(root, bed, 'index.mjs')];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    const rel = path.relative(root, file);
    if (rel.startsWith('..') || rel.split(path.sep)[0] === 'sealed') continue;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
      const target = path.resolve(path.dirname(file), m[1]);
      if (target.startsWith(root + path.sep) && /\.m?js$/.test(target)) queue.push(target);
    }
  }
  return [...seen].map(f => path.relative(repo, f).split(path.sep).join('/')).sort();
}
/**
 * What produced an anchor bed's features: { bed, version, files, dirs: { <beds/ subdirectory>: { files, sha256 } }, sha256 }. The files are the bed's
 * module graph (bedGeneratorFiles); sha256 is over the sorted (path, content hash) list (first 16 hex), also per top-level directory.
 */
export function bedStamp(bed, { repo = REPO, version = null } = {}) {
  const files = bedGeneratorFiles(bed, { repo }).map(f => `${f}:${sha(readFileSync(path.join(repo, f)))}`), per = {};
  for (const f of files) {
    const dir = f.split('/')[1];
    (per[dir] ??= []).push(f);
  }
  return {
    bed, version, files: files.length,
    dirs: Object.fromEntries(Object.entries(per).sort().map(([d, fs]) => [d, { files: fs.length, sha256: sha(fs.join('\n')).slice(0, 16) }])),
    sha256: sha(files.join('\n')).slice(0, 16),
  };
}

export async function computeAnchorFeatures({ beds = [...new Set(Object.values(ANCHOR_BEDS))], difficulties = [3, 5], seeds = [601, 602, 603], repo = REPO } = {}) {
  // L4 (PREREG §3.3): the seed gate runs for every bed before any task is generated, outside the per-bed try below so that a refusal throws and is not reported as a bed
  // error. need-constraint is a held-out FAMILY: only its example seeds (601-609, purpose need-example) may be generated here, never a label or held-out seed.
  for (const bed of beds) assertExampleSeeds({ bed, seeds });
  const features = {}, errors = [], stamps = {};
  for (const bed of beds) {
    for (const d of difficulties) {
      try { (features[bed] ??= {})[d] = await familyFeatures(bed, { seeds, difficulty: d }); }
      catch (e) { errors.push({ bed, difficulty: d, error: String(e?.message ?? e).slice(0, 200) }); }
    }
    let version = null;
    try { version = (await loadFamily(bed)).family?.version ?? null; } catch { /* reported through errors above */ }
    try { stamps[bed] = bedStamp(bed, { repo, version }); } catch (e) { errors.push({ bed, error: `bed stamp: ${String(e?.message ?? e).slice(0, 160)}` }); }
  }
  return { features, errors, seeds, difficulties, beds: stamps };
}
