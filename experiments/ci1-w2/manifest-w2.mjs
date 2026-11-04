#!/usr/bin/env node
// CI-1 wave 2 freeze (research/ci1-20261021/w2/PREREG-CI1-W2.md): sha256 of every input a wave-2 comparative run depends on, written
// BEFORE the first wave-2 builder call. Covers the wave-2 bed files (descriptions, specs, generators, transliterations, answer keys,
// oracles with the hidden worlds and reference effects; outside git, committed by digest), the retrieval index, the wave-1 arm code
// (experiments/ci1, imported unchanged), the wave-2 scorer and runner, oracle v2, templates, policy and the engine files the arms run on.
//   node experiments/ci1-w2/manifest-w2.mjs build   (writes research/ci1-20261021/w2/MANIFEST-W2.json)
//   node experiments/ci1-w2/manifest-w2.mjs check
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BED } from '../ci1/bed.mjs';
import { INDEX_FILE } from '../ci1/retrieve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
export const MANIFEST_W2 = path.join(root, 'research/ci1-20261021/w2/MANIFEST-W2.json');
export const SPLIT_W2 = path.join(root, 'research/ci1-20261021/w2/SPLIT-W2.json');
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
// analysis code is hashed under "analysis" and does not gate a run (as in wave 1)
const ANALYSIS = new Set(['experiments/ci1/report.mjs', 'experiments/ci1/failures.mjs', 'experiments/ci1/bed-summary.mjs', 'experiments/ci1-w2/report-w2.mjs',
  'experiments/ci1-w2/peek.mjs', 'experiments/ci1-w2/show.mjs', 'experiments/ci1-w2/check-summary.mjs', 'experiments/ci1-w2/check-items.sh',
  'experiments/ci1-w2/survivor-audit.mjs', 'experiments/ci1-w2/show-mutant.mjs', 'experiments/ci1-w2/agree-why.mjs', 'experiments/ci1-w2/retrieval-w2.mjs',
  'experiments/ci1-w2/fit-w2.mjs', 'experiments/ci1-w2/pooled.mjs', 'experiments/ci1-w2/oracle-summary.mjs']);
const walk = dir => readdirSync(dir).flatMap(f => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const isTest = p => p.includes(`${path.sep}test${path.sep}`);

/** Every file the wave-2 freeze covers: { key: absolute path }. "bed:" keys are relative to the wave-2 bed. */
export function frozenFilesW2(bed = BED) {
  const split = JSON.parse(readFileSync(SPLIT_W2, 'utf8'));
  const files = {};
  for (const id of split.test) {
    for (const f of ['description.md', 'spec.json', 'gen.mjs', 'ref.foundry.json', 'answers.json']) { const p = path.join(bed, 'items', id, f); if (existsSync(p)) files[`bed:items/${id}/${f}`] = p; }
    files[`bed:oracle/${id}.json`] = path.join(bed, 'oracle', `${id}.json`);
  }
  files['index:retrieval-index.json'] = INDEX_FILE;
  const code = [...walk(path.join(root, 'experiments/ci1')), ...walk(path.join(root, 'experiments/ci1-w2')), path.join(root, 'experiments/ci1-posthoc/oracle-v2.mjs'),
    ...walk(path.join(root, 'app/core/templates')), path.join(root, 'app/core/builder-model.mjs'), path.join(root, 'app/core/library.mjs'), path.join(root, 'app/core/stand-ins.mjs'),
    path.join(root, 'app/core/capabilities.mjs'), path.join(root, 'experiments/library/cards/catalog.json'), path.join(root, 'experiments/library/retrieve.mjs'),
    path.join(root, 'experiments/lib/models.mjs'), SPLIT_W2, path.join(root, 'policy/models.json'), path.join(root, 'src/validate.mjs'), path.join(root, 'src/runtime.mjs')]
    .filter(p => !isTest(p) && !ANALYSIS.has(path.relative(root, p)) && !p.endsWith('.json.tmp'));
  for (const p of code) files[path.relative(root, p)] = p;
  return files;
}
export function buildManifestW2(bed = BED) {
  const files = frozenFilesW2(bed);
  const analysis = Object.fromEntries([...ANALYSIS].map(f => path.join(root, f)).filter(existsSync).map(p => [path.relative(root, p), sha(p)]));
  return { schema: 'foundry.ci1.manifest-w2/1', frozenAt: new Date().toISOString(), bed, files: Object.fromEntries(Object.entries(files).sort().map(([k, p]) => [k, sha(p)])), analysis };
}
/** Mismatches between the manifest and the files now: [] when everything is unchanged (a new frozen-tree file is a mismatch). */
export function checkManifestW2(file = MANIFEST_W2, bed = BED) {
  const m = JSON.parse(readFileSync(file, 'utf8')), now = frozenFilesW2(bed), bad = [];
  if (path.resolve(m.bed) !== path.resolve(bed)) bad.push(`bed: manifest has ${m.bed}, run uses ${bed}`);
  for (const [k, digest] of Object.entries(m.files)) {
    const p = now[k] ?? (k.startsWith('bed:') ? path.join(bed, k.slice(4)) : k.startsWith('index:') ? INDEX_FILE : path.join(root, k));
    if (!existsSync(p)) bad.push(`${k}: missing`); else if (sha(p) !== digest) bad.push(`${k}: changed`);
  }
  for (const k of Object.keys(now)) if (!(k in m.files)) bad.push(`${k}: not in the manifest`);
  return bad;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd] = process.argv.slice(2);
  if (cmd === 'build') { const m = buildManifestW2(); writeFileSync(MANIFEST_W2, `${JSON.stringify(m, null, 1)}\n`); console.log(JSON.stringify({ out: MANIFEST_W2, files: Object.keys(m.files).length, sha256: sha(MANIFEST_W2) })); }
  else if (cmd === 'check') { const bad = checkManifestW2(); console.log(bad.length ? bad.join('\n') : 'manifest matches'); process.exitCode = bad.length ? 1 : 0; }
  else console.log('usage: manifest-w2.mjs build|check');
}
