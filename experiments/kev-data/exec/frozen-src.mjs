// Frozen copy of the Foundry runtime for the exec-injected family of F1 (JUDGE-PROGRAM.md §1.2 F1 "Families",
// §11 "Runtime drift", JUDGE-BUILD-PLAN.json group failures-code).
//
// Other agents edit src/ while the data factory builds; F1's labels are the outcomes of the healer's checks run
// by the real runtime, so the runtime a build uses is `git archive` of one NAMED COMMIT, extracted to
// .foundry/kev-data/frozen-src/<sha>/ and verified blob by blob. Nothing here writes under src/ and nothing
// runs src/executors/ (the archive carries them as inert files). The commit sha is recorded in every
// exec-injected record's meta and, through the build config (opts.frozenSrc), in the build manifest.
//
// What is archived: src/, schemas/, policy/ (src/engine.mjs hashes the schemas; the owner model policy supplies
// the model ids of the scripted model double), package.json and package-lock.json. node_modules is not part of a
// commit: the copy links the repository's install (the lock file in the copy pins what that install must be;
// the versions that were present are recorded in FROZEN.json).
//
//   freezeSrc({ root, commit, outRoot })   -> { commit, dir, srcTree, hash, files, versions, reused }
//   loadRuntime(frozen)                    -> the frozen modules the exec harness drives (memoised per dir)
//   KEV_DATA_FROZEN_SRC_DIR                an already-frozen directory (tests that run in a copy without .git)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from '../lib/contracts.mjs';

// The last commit that changed src/ at the time this group was built (880c6b9 moved the judge kit out of src/ to
// restore the frozen C0 construction-kit hash). HEAD at build time (a02cd8b) has the identical src/ tree.
export const FROZEN_SRC_COMMIT = '880c6b91f183a569571480d7ff5d297839a8cdac';
export const FROZEN_PATHS = Object.freeze(['src', 'schemas', 'policy', 'package.json', 'package-lock.json']);
export const FROZEN_SRC_VERSION = 1;

const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const fail = (code, message, details) => { const e = new Error(`${code}: ${message}`); e.code = code; if (details) e.details = details; return e; };
const git = (root, args, opts = {}) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_LITERAL_PATHSPECS: '1' }, ...opts });
const gitBlobSha = buf => createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
export const defaultOutRoot = (root = REPO_ROOT) => path.join(root, '.foundry', 'kev-data', 'frozen-src');

function listTree(root, sha) {
  const out = git(root, ['ls-tree', '-r', '-z', sha, '--', ...FROZEN_PATHS]);
  return out.split('\0').filter(Boolean).map(l => {
    const m = /^(\d+) (\w+) ([0-9a-f]{40})\t(.+)$/.exec(l);
    if (!m) throw fail('FROZEN_SRC_TREE', `unreadable ls-tree line ${l}`);
    return { mode: m[1], type: m[2], blob: m[3], path: m[4] };
  }).sort((a, b) => (a.path < b.path ? -1 : 1));
}

// Verify an extracted directory against the commit's tree, file by file (git blob sha1), and refuse extra files.
function verifyDir(dir, entries) {
  const want = new Map(entries.map(e => [e.path, e]));
  const seen = new Set();
  const walk = rel => {
    for (const d of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (!rel && d.name === 'node_modules') continue;                 // linked install, not part of the commit
      if (!rel && d.name === 'FROZEN.json') continue;
      if (d.isDirectory()) walk(r);
      else if (d.isFile()) seen.add(r);
      else throw fail('FROZEN_SRC_SPECIAL', `${r} is neither a file nor a directory`);
    }
  };
  walk('');
  const problems = [];
  for (const e of entries) {
    if (e.type !== 'blob' || !['100644', '100755'].includes(e.mode)) { problems.push(`${e.path}: mode ${e.mode} ${e.type}`); continue; }
    const f = path.join(dir, e.path);
    if (!existsSync(f)) { problems.push(`${e.path}: missing`); continue; }
    if (gitBlobSha(readFileSync(f)) !== e.blob) problems.push(`${e.path}: content differs from commit`);
  }
  for (const r of seen) if (!want.has(r)) problems.push(`${r}: not in the commit`);
  return problems;
}

function versionsOf(modules) {
  const out = {};
  for (const name of ['ajv', 'ajv-formats', 'jsonc-parser']) {
    try { out[name] = JSON.parse(readFileSync(path.join(modules, name, 'package.json'), 'utf8')).version; } catch { out[name] = null; }
  }
  return out;
}

// Freeze the named commit. Idempotent: an existing verified copy is reused.
export function freezeSrc({ root = REPO_ROOT, commit = FROZEN_SRC_COMMIT, outRoot = defaultOutRoot(root) } = {}) {
  if (process.env.KEV_DATA_FROZEN_SRC_DIR) return openFrozen(process.env.KEV_DATA_FROZEN_SRC_DIR, commit);
  let sha;
  try { sha = git(root, ['rev-parse', '--verify', `${commit}^{commit}`]).trim(); } catch { throw fail('FROZEN_SRC_COMMIT', `commit ${commit} is not in ${root}`); }
  if (!/^[0-9a-f]{40}$/.test(sha)) throw fail('FROZEN_SRC_COMMIT', `${commit} did not resolve to a commit`);
  const dir = path.join(outRoot, sha), entries = listTree(root, sha);
  if (!entries.some(e => e.path === 'src/foundry.mjs')) throw fail('FROZEN_SRC_TREE', `commit ${sha} has no src/foundry.mjs`);
  const srcTree = git(root, ['rev-parse', `${sha}:src`]).trim();
  if (existsSync(path.join(dir, 'FROZEN.json'))) {
    const frozen = openFrozen(dir, sha);
    if (verifyDir(dir, entries).length === 0) return { ...frozen, reused: true };
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(outRoot, { recursive: true });
  const tmp = mkdtempSync(path.join(outRoot, `.tmp-${sha.slice(0, 8)}-`)), tar = path.join(tmp, 'src.tar'), stage = path.join(tmp, 'tree');
  try {
    mkdirSync(stage);
    git(root, ['archive', '--format=tar', '-o', tar, sha, '--', ...FROZEN_PATHS]);
    execFileSync('tar', ['-xf', tar, '-C', stage]);
    const problems = verifyDir(stage, entries);
    if (problems.length) throw fail('FROZEN_SRC_VERIFY', `${problems.length} problem(s): ${problems.slice(0, 3).join('; ')}`, problems);
    const modules = path.join(realpathSync(root), 'node_modules');
    if (!existsSync(modules)) throw fail('FROZEN_SRC_MODULES', `${modules} does not exist (npm ci --ignore-scripts)`);
    symlinkSync(modules, path.join(stage, 'node_modules'), 'dir');
    const manifest = {
      schema: 'kev-data/frozen-src@1', version: FROZEN_SRC_VERSION, commit: sha, srcTree, paths: FROZEN_PATHS,
      files: entries.map(e => ({ path: e.path, blob: e.blob })), hash: `sha256:${sha256(entries.map(e => `${e.path}\0${e.blob}`).join('\n'))}`,
      nodeModules: 'symlink to the repository install; package-lock.json in the copy pins it', versions: versionsOf(modules),
    };
    writeFileSync(path.join(stage, 'FROZEN.json'), JSON.stringify(manifest, null, 2) + '\n');
    rmSync(dir, { recursive: true, force: true });
    try { renameSync(stage, dir); } catch (e) { if (!existsSync(path.join(dir, 'FROZEN.json'))) throw e; /* a concurrent freeze of the same commit won the rename */ }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  return { ...openFrozen(dir, sha), reused: false };
}

// Read an existing frozen directory's manifest (no git needed).
export function openFrozen(dir, expectCommit = null) {
  const file = path.join(dir, 'FROZEN.json');
  if (!existsSync(file)) throw fail('FROZEN_SRC_MISSING', `${dir} has no FROZEN.json`);
  const m = JSON.parse(readFileSync(file, 'utf8'));
  if (m.schema !== 'kev-data/frozen-src@1') throw fail('FROZEN_SRC_SCHEMA', `${file}: unknown schema ${m.schema}`);
  if (expectCommit && !m.commit.startsWith(expectCommit.slice(0, 12))) throw fail('FROZEN_SRC_COMMIT', `${dir} is ${m.commit}, expected ${expectCommit}`);
  const st = lstatSync(path.join(dir, 'src'), { throwIfNoEntry: false });
  if (!st?.isDirectory()) throw fail('FROZEN_SRC_MISSING', `${dir}/src is missing`);
  return { commit: m.commit, srcTree: m.srcTree, hash: m.hash, files: m.files.length, versions: m.versions, dir, manifest: m };
}

// What the frozen src/ says about itself: recomputed from the extracted files (a record's `engine` field).
export async function loadRuntime(frozen) {
  const dir = frozen.dir ?? frozen;
  if (RUNTIMES.has(dir)) return RUNTIMES.get(dir);
  const imp = rel => import(pathToFileURL(path.join(dir, 'src', rel)).href);
  const [foundry, capabilities, port, journal, policy, scripted, data, validate, engine, sandbox, verdict] = await Promise.all([
    imp('foundry.mjs'), imp('capabilities.mjs'), imp('models/port.mjs'), imp('journal.mjs'), imp('models/policy.mjs'),
    imp('models/providers/scripted.mjs'), imp('data.mjs'), imp('validate.mjs'), imp('engine.mjs'), imp('sandbox.mjs'), imp('verdict.mjs'),
  ]);
  const rt = Object.freeze({
    dir, Foundry: foundry.Foundry, CapabilityRegistry: capabilities.CapabilityRegistry, createDefaultRegistry: capabilities.createDefaultRegistry,
    ModelPort: port.ModelPort, Journal: journal.Journal, loadPolicy: policy.loadPolicy, ScriptedProvider: scripted.ScriptedProvider,
    data, validate, engineHash: engine.engineHash, engineIdentity: engine.engineIdentity, sandbox, verdict,
    policyPath: path.join(dir, 'policy', 'models.json'),
  });
  RUNTIMES.set(dir, rt);
  return rt;
}
const RUNTIMES = new Map();

// Convenience for tests and the generator: freeze (or reuse) and load.
export async function openRuntime(opts = {}) {
  const frozen = freezeSrc(opts);
  return { frozen, rt: await loadRuntime(frozen) };
}

// A scratch workspace root for exec runs (never under the repository's tracked trees).
export const scratchRoot = () => process.env.KEV_DATA_SCRATCH ?? os.tmpdir();
