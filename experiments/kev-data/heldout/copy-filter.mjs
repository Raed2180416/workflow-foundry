// The copy filter (JUDGE-PROGRAM.md §2.4: "Copy filter: maximum 4-gram Jaccard 0.3 against any
// train-pool line or bed template"). Written to be run by a script the author does not read the
// inputs of: it reads the frozen bed copy (string literals of every allow-listed bed file and the
// prose of their READMEs) and the train pools (when they exist), compares every authored text with
// them, and reports ids, counts and the maximum overlap, never the text it matched.
//
//   node experiments/kev-data/heldout/copy-filter.mjs [--heldout DIR] [--pools DIR] [--threshold 0.3]
//
// Word 4-grams after lower-casing, with {slot} placeholders, ${...} expressions and digit runs each
// collapsed to one token, so a pool line with {S} compares equal to a template with ${S}. Jaccard
// is |A n B| / |A u B| over the 4-gram sets; a text of fewer than four words is one gram (its
// whole self), which only matches an identical short string.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT } from '../lib/contracts.mjs';
import { BED_ALLOWLIST, freezeBeds, frozenBeds } from '../lib/pin.mjs';
import { canonical, sha256 } from '../lib/hash.mjs';
import { jaccard, ngramSet } from './pools.mjs';
import { assemble } from './assemble.mjs';
import { HELDOUT_DIR, AUTHORED_DIR } from './author.mjs';

export const COPY_THRESHOLD = 0.3;
const TEXT_EXT = /\.(?:mjs|js|cjs|md|json|txt)$/i;
const MIN_WORDS = 4;

// ---- string extraction ----------------------------------------------------------------------------
const unescape = s => s.replace(/\\(?:n|t|r)/g, ' ').replace(/\\(['"`\\])/g, '$1');
export function jsStrings(src) {
  const out = [];
  const re = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1|`((?:\\.|\$\{(?:[^{}]|\{[^{}]*\})*\}|[^`\\])*)`/g;
  for (const m of src.matchAll(re)) {
    const raw = m[2] ?? m[3] ?? '';
    out.push(unescape(raw.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, ' {x} ')));
  }
  return out;
}
export function proseStrings(src) {
  return src.split(/\n+/).flatMap(l => l.replace(/^[\s>*#\-|]+/, '').split(/(?<=[.!?])\s+/)).map(s => s.trim()).filter(Boolean);
}
const jsonStrings = src => {
  const out = [];
  try { const walk = v => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); }; walk(JSON.parse(src)); } catch { out.push(...proseStrings(src)); }
  return out;
};
const keep = s => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length >= MIN_WORDS;

// ---- corpora ----------------------------------------------------------------------------------------
function walkFiles(root, rel, accept) {
  const out = [], abs = path.join(root, rel);
  let st; try { st = lstatSync(abs); } catch { return out; }
  if (st.isSymbolicLink()) return out;
  if (st.isDirectory()) { for (const n of readdirSync(abs).sort()) if (n !== 'node_modules') out.push(...walkFiles(root, path.join(rel, n), accept)); }
  else if (st.isFile() && accept(rel)) out.push(rel);
  return out;
}
// The frozen bed copy: every allow-listed text file (beds/sealed/ is not on the allow-list).
export function bedCorpus(beds) {
  const strings = []; let files = 0;
  for (const dir of BED_ALLOWLIST) {
    const rels = dir.endsWith('.md') ? [dir] : walkFiles(beds.dir, dir, r => TEXT_EXT.test(r));
    for (const rel of rels) {
      let src; try { src = beds.read(rel); } catch { continue; }
      files++;
      const ss = /\.(?:mjs|js|cjs)$/i.test(rel) ? jsStrings(src) : /\.json$/i.test(rel) ? jsonStrings(src) : proseStrings(src);
      for (const s of ss) if (keep(s)) strings.push(s);
    }
  }
  return { strings, files };
}
export function trainPoolCorpus(dir) {
  if (!dir || !existsSync(dir)) return { present: false, strings: [], files: 0 };
  const rels = walkFiles(dir, '.', r => /\.(?:jsonl|json|txt|md)$/i.test(r));
  const strings = [];
  for (const rel of rels) {
    const src = readFileSync(path.join(dir, rel), 'utf8');
    const ss = /\.jsonl$/i.test(rel) ? src.split('\n').filter(Boolean).flatMap(jsonStrings) : /\.json$/i.test(rel) ? jsonStrings(src) : proseStrings(src);
    for (const s of ss) if (keep(s)) strings.push(s);
  }
  return { present: true, strings, files: rels.length };
}

// ---- the check ----------------------------------------------------------------------------------------
export function buildIndex(strings) {
  const grams = strings.map(s => ngramSet(s, 4)), index = new Map();
  grams.forEach((g, i) => { for (const x of g) { let l = index.get(x); if (!l) index.set(x, l = []); l.push(i); } });
  return { grams, index, n: strings.length };
}
export function maxOverlap(text, idx) {
  const g = ngramSet(text, 4); if (!g.size) return 0;
  const seen = new Set(); let best = 0;
  for (const x of g) for (const i of idx.index.get(x) ?? []) {
    if (seen.has(i)) continue; seen.add(i);
    const j = jaccard(g, idx.grams[i]); if (j > best) best = j;
  }
  return best;
}
// Every text a unit contributes (the line itself, an X5 assumption, an S5 type label's context).
export function textsOf(u) {
  if (u.role === 'type-name') return [u.type_label, u.title];
  return [u.text, u.assumption].filter(Boolean);
}
export function runCopyFilter({ units, wordings = [], corpora, threshold = COPY_THRESHOLD }) {
  const idx = Object.fromEntries(Object.entries(corpora).filter(([, c]) => c.strings.length).map(([k, c]) => [k, buildIndex(c.strings)]));
  const failing = []; let checked = 0, max = 0;
  const lookup = new Map(Object.entries(corpora).map(([k, c]) => [k, new Set(c.strings.map(s => s.toLowerCase().trim()))]));
  const check = (id, port, role, texts) => {
    for (const t of texts) {
      checked++;
      for (const [k, ix] of Object.entries(idx)) {
        const j = maxOverlap(t, ix); max = Math.max(max, j);
        const exact = role === 'type-name' && t === texts[0] && lookup.get(k).has(t.toLowerCase().trim());
        if (j > threshold || exact) failing.push({ id, port, role, against: k, jaccard: exact ? 1 : Number(j.toFixed(3)) });
      }
    }
  };
  for (const u of units) check(u.id, u.port, u.role, textsOf(u));
  for (const w of wordings) check(`${w.port}/${w.id}`, w.port, 'wording', [w.text]);
  return { threshold, checked, maxJaccard: Number(max.toFixed(3)), failing,
    bedCorpus: { files: corpora.bed?.files ?? 0, strings: corpora.bed?.strings.length ?? 0 },
    trainPools: { present: corpora.trainPools?.present ?? false, files: corpora.trainPools?.files ?? 0, strings: corpora.trainPools?.strings.length ?? 0 } };
}

// The frozen bed copy goes to a scratch outRoot (like the test harness), so running the filter never
// touches the shared .foundry/kev-data/frozen or drift records of a real build.
export function frozenForFilter(root = REPO_ROOT, scratch) {
  const outRoot = scratch ?? path.join(process.env.KEV_DATA_SCRATCH ?? (process.env.TMPDIR || '/tmp'), `kev-copyfilter-${process.pid}`);
  mkdirSync(outRoot, { recursive: true });
  return frozenBeds(freezeBeds(root, { outRoot }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), opt = Object.fromEntries(args.map((a, i) => (a.startsWith('--') ? [a.slice(2), args[i + 1]] : null)).filter(Boolean));
  const heldout = path.resolve(opt.heldout ?? HELDOUT_DIR), pools = path.resolve(opt.pools ?? path.join(REPO_ROOT, '.foundry', 'kev-data', 'pools', 'train'));
  const model = assemble(path.join(heldout, 'authored'), { lenient: true });
  const units = Object.values(model.surface).flat();
  const corpora = { bed: bedCorpus(frozenForFilter()), trainPools: trainPoolCorpus(pools) };
  const report = runCopyFilter({ units, wordings: model.wordings, corpora, threshold: Number(opt.threshold ?? COPY_THRESHOLD) });
  const out = path.join(heldout, 'copy-filter.json');
  writeFileSync(out, JSON.stringify({ ...report, sha256: sha256(canonical(report)) }, null, 1) + '\n');
  console.log(JSON.stringify({ checked: report.checked, maxJaccard: report.maxJaccard, failing: report.failing.length, bedCorpus: report.bedCorpus, trainPools: report.trainPools }));
  process.exitCode = report.failing.length ? 1 : 0;
}
