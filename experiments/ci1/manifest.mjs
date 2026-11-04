#!/usr/bin/env node
// CI-1 freeze (research/ci1-20261021/PREREG-CI1.md §2): sha256 of every input a comparative run depends on, written BEFORE the first
// test-split builder call. The bed files (descriptions, answer keys, specs, generators, transliterations, oracles with the hidden worlds
// and reference effects) and the retrieval index stay outside git; the manifest commits their digests.
//   node experiments/ci1/manifest.mjs build [--out research/ci1-20261021/MANIFEST.json]
//   node experiments/ci1/manifest.mjs check [--file research/ci1-20261021/MANIFEST.json]
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BED } from './bed.mjs';
import { INDEX_FILE } from './retrieve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const ANALYSIS = ['report.mjs', 'failures.mjs', 'bed-summary.mjs'];
const walk = dir => readdirSync(dir).flatMap(f => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

/** Every file the freeze covers: { key: absolute path }. Keys are repo-relative for code and BED-relative ("bed:") for the bed. */
export function frozenFiles() {
  const split = JSON.parse(readFileSync(path.join(root, 'research/ci1-20261021/SPLIT.json'), 'utf8'));
  const ids = [...split.dev, ...split.test];
  const files = {};
  for (const id of ids) {
    for (const f of ['description.md', 'spec.json', 'gen.mjs', 'ref.foundry.json', 'answers.json']) { const p = path.join(BED, 'items', id, f); if (existsSync(p)) files[`bed:items/${id}/${f}`] = p; }
    files[`bed:oracle/${id}.json`] = path.join(BED, 'oracle', `${id}.json`);
  }
  files['index:retrieval-index.json'] = INDEX_FILE;
  // analysis code (report.mjs) is hashed under "analysis" and does not gate a run (a fix there is a documented deviation, not a re-freeze)
  const code = [...walk(path.join(root, 'experiments/ci1')).filter(p => !p.includes(`${path.sep}test${path.sep}`) && !ANALYSIS.includes(path.basename(p))),
    ...walk(path.join(root, 'app/core/templates')), path.join(root, 'app/core/builder-model.mjs'), path.join(root, 'app/core/library.mjs'), path.join(root, 'app/core/stand-ins.mjs'),
    path.join(root, 'app/core/capabilities.mjs'), path.join(root, 'experiments/library/cards/catalog.json'), path.join(root, 'experiments/library/retrieve.mjs'),
    path.join(root, 'research/ci1-20261021/SPLIT.json'), path.join(root, 'policy/models.json'), path.join(root, 'src/validate.mjs'), path.join(root, 'src/runtime.mjs')];
  for (const p of code) files[path.relative(root, p)] = p;
  return files;
}
export function buildManifest() {
  const files = frozenFiles();
  const analysis = Object.fromEntries(ANALYSIS.map(f => path.join(here, f)).filter(existsSync).map(p => [path.relative(root, p), sha(p)]));
  return { schema: 'foundry.ci1.manifest/1', frozenAt: new Date().toISOString(), bed: BED, files: Object.fromEntries(Object.entries(files).sort().map(([k, p]) => [k, sha(p)])), analysis };
}
/** Mismatches between the manifest and the files now: [] when everything is unchanged. */
export function checkManifest(file) {
  const m = JSON.parse(readFileSync(file, 'utf8')), now = frozenFiles(), bad = [];
  for (const [k, digest] of Object.entries(m.files)) {
    const p = now[k] ?? (k.startsWith('bed:') ? path.join(BED, k.slice(4)) : k.startsWith('index:') ? INDEX_FILE : path.join(root, k));
    if (!existsSync(p)) bad.push(`${k}: missing`); else if (sha(p) !== digest) bad.push(`${k}: changed`);
  }
  for (const k of Object.keys(now)) if (!(k in m.files)) bad.push(`${k}: not in the manifest`);
  return bad;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  const opt = (name, d) => args.includes(name) ? args[args.indexOf(name) + 1] : d;
  if (cmd === 'build') { const out = path.resolve(root, opt('--out', 'research/ci1-20261021/MANIFEST.json')); const m = buildManifest(); writeFileSync(out, `${JSON.stringify(m, null, 1)}\n`); console.log(JSON.stringify({ out, files: Object.keys(m.files).length, sha256: sha(out) })); }
  else if (cmd === 'check') { const bad = checkManifest(path.resolve(root, opt('--file', 'research/ci1-20261021/MANIFEST.json'))); console.log(bad.length ? bad.join('\n') : 'manifest matches'); process.exitCode = bad.length ? 1 : 0; }
  else console.log('usage: manifest.mjs build|check');
}
