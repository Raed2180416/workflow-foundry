// Which Foundry this is, for the IT brief and the evidence file (P4 walkthrough M4, P5 M17): the git commit when this copy is a checkout
// (read with `git rev-parse`, no network), whether app/ or src/ differ from it, a sha256 over every file under app/ and src/ (so a copy
// without git can still be compared), Node, the exact runtime dependencies, and the licence status. Computed once per process.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let cached = null;

function treeHash() {
  const files = [];
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const full = path.join(dir, name), r = `${rel}/${name}`;
      const st = statSync(full);
      if (st.isDirectory()) walk(full, r); else if (st.isFile()) files.push([r, createHash('sha256').update(readFileSync(full)).digest('hex')]);
    }
  };
  for (const top of ['app', 'src']) walk(path.join(ROOT, top), top);
  return { sha256: createHash('sha256').update(files.map(([f, h]) => `${h}  ${f}\n`).join('')).digest('hex'), files: files.length };
}

export function buildInfo() {
  if (cached) return cached;
  const git = args => { const r = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', timeout: 5000 }); return r.status === 0 ? r.stdout.trim() : null; };
  const commit = git(['rev-parse', 'HEAD']);
  const dirty = commit ? !!git(['status', '--porcelain', '--', 'app', 'src']) : null;
  let pkg = {}; try { pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')); } catch { pkg = {}; }
  cached = Object.freeze({
    name: pkg.name ?? 'workflow-foundry', version: pkg.version ?? null, commit, changedSinceCommit: dirty, tree: treeHash(),
    node: process.versions.node, dependencies: pkg.dependencies ?? {},
    licence: pkg.license ?? null,
    licenceNote: pkg.license ? `Licensed ${pkg.license}.` : 'No licence file in this copy yet. Decided: Apache-2.0 for the engine when it is published (research/decisions-20261021.md, D1); until then, ask the person who gave you this copy.',
    installedAt: ROOT
  });
  return cached;
}
