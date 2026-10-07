// Offline: freeze the ownerci source modules and their focused node:test suites into
// beds/ownerci/fixtures/<module>/ at one pinned commit, and write fixtures/MANIFEST.json.
//
//   node beds/ownerci/freeze.mjs [commit=HEAD]
//
// Files are read with `git show <sha>:<path>`, so the fixtures are exactly the committed bytes
// of that revision (never the working tree). The repository-relative layout is preserved inside
// each fixture directory, so the frozen tests' relative imports ('../src/verdict.mjs',
// '../../beds/lib/rng.mjs') resolve to the frozen copies and never to the live repository.
// Later edits to src/ cannot change the bed. This script is the only part of the bed that
// reads outside beds/ownerci/, and it is never called by generate() or oracle().
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../lib/canonical.mjs';
import { MODULES } from './modules.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const FIXTURES = path.join(HERE, 'fixtures');
const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// Edits applied to frozen test files. Each must match exactly once.
const TRANSFORMS = {
  'tests/journal.test.mjs': [
    {
      why: 'drops the one test that needs src/store.mjs (a 399-line filesystem store) and a temp workspace; the remaining 4 tests exercise journal.mjs alone',
      from: "import { Store } from '../src/store.mjs';\n",
      to: '',
    },
    {
      why: 'same: removes the Store-backed test body',
      cut: { start: "\ntest('journal lives in the workspace SQLite next to runs and survives reopening'", end: null },
    },
  ],
};

function applyTransforms(file, text) {
  const applied = [];
  for (const t of TRANSFORMS[file] ?? []) {
    if (t.from !== undefined) {
      const n = text.split(t.from).length - 1;
      if (n !== 1) throw new Error(`transform for ${file} matched ${n} times: ${t.why}`);
      text = text.replace(t.from, t.to);
    } else if (t.cut) {
      const i = text.indexOf(t.cut.start);
      if (i < 0 || text.indexOf(t.cut.start, i + 1) >= 0) throw new Error(`cut for ${file} not unique: ${t.why}`);
      const j = t.cut.end === null ? text.length : text.indexOf(t.cut.end, i);
      if (j < 0) throw new Error(`cut end missing for ${file}`);
      text = `${text.slice(0, i)}\n${t.cut.end === null ? '' : text.slice(j + t.cut.end.length)}`;
    }
    applied.push(t.why);
  }
  return { text, applied };
}

function main() {
  const rev = process.argv[2] || 'HEAD';
  const sha = git('rev-parse', '--verify', `${rev}^{commit}`).trim();
  const commitDate = git('show', '-s', '--format=%cI', sha).trim();
  const subject = git('show', '-s', '--format=%s', sha).trim();
  const manifest = {
    note: 'Frozen copies of workflow-foundry modules and their focused node:test suites (ROADMAP §4.2 owner family "CI-failure repair"). '
      + 'Bytes are `git show <commit>:<source>`; repository-relative layout is preserved under fixtures/<module>/. '
      + 'hidden.test.mjs files are authored for this bed from the ORIGINAL behaviour and are not part of the repository at that commit.',
    commit: sha, commitDate, commitSubject: subject, modules: {},
  };
  for (const [id, m] of Object.entries(MODULES)) {
    const dir = path.join(FIXTURES, id);
    const files = {};
    for (const rel of [m.modulePath, m.testPath, ...m.related]) {
      const original = git('show', `${sha}:${rel}`);
      const { text, applied } = applyTransforms(rel, original);
      const out = path.join(dir, rel);
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, text);
      files[rel] = {
        source: rel, role: rel === m.modulePath ? 'module' : rel === m.testPath ? 'visible-tests' : 'related',
        sha256: sha256(text), sourceSha256: sha256(original), transforms: applied,
      };
    }
    const hiddenPath = path.join(dir, 'hidden.test.mjs');
    const hidden = existsSync(hiddenPath) ? readFileSync(hiddenPath, 'utf8') : null;
    manifest.modules[id] = {
      modulePath: m.modulePath, testPath: m.testPath, related: m.related, files,
      hidden: hidden === null ? null : { path: 'hidden.test.mjs', sha256: sha256(hidden), origin: 'authored for this bed from the original module behaviour' },
    };
  }
  writeFileSync(path.join(FIXTURES, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`froze ${Object.keys(MODULES).length} modules at ${sha} (${commitDate})`);
}

main();
