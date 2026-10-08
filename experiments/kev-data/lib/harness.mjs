// Test-harness helpers for every build group's test file (JUDGE-PROGRAM.md §10: "a test file that
// runs alone with node --test and fails on a seeded defect").
//   tempDir()                     a scratch directory removed when the process exits
//   frozenRepoBeds()              a frozen copy of this repository's pinned beds in a scratch outRoot
//                                 (never the shared .foundry/kev-data, so a test run cannot trip
//                                 BED_DRIFT for a real build) and its import handle
//   tempBedRepo(files)            a throwaway git repository with the given files committed
//   accessSpy()                   records every path the fs module and child processes are given
//   mutantCopy(mutations)         a copy of experiments/kev-data with exact-text mutations applied
//                                 (each must match exactly once), src/research/policy symlinked
//   runTests(file, {pattern})     node --test on one file in a child process (TAP parsed)
//   seededDefect({file, pattern, mutations})   control run (unmutated copy) must pass, mutant must fail
//   checkRecords(records, {slice})             the build's record checks, for a group's own records
//   emptyHeldout()                explicit empty held-out material ({wordings, registry}) for builds whose
//                                 test needs none (buildKev refuses a build without held-out material)
import { spawnSync, execFileSync } from 'node:child_process';
import childProcess from 'node:child_process';
import fs, { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, KEV_DATA, loadSpec } from './contracts.mjs';
import { freezeBeds, frozenBeds } from './pin.mjs';
import { SpanRegistry, WordingGuard } from './leakage.mjs';
import { checkRecord } from '../build.mjs';

export { REPO_ROOT, KEV_DATA };
const SCRATCH = process.env.KEV_DATA_SCRATCH ?? os.tmpdir();
const made = [];
process.once('exit', () => { if (!process.env.KEV_DATA_KEEP_TMP) for (const d of made) rmSync(d, { recursive: true, force: true }); });

export function tempDir(prefix = 'kev-data-') {
  mkdirSync(SCRATCH, { recursive: true });
  const d = mkdtempSync(path.join(SCRATCH, prefix)); made.push(d); return d;
}

let frozenMemo = null;
export function frozenRepoBeds({ root = REPO_ROOT } = {}) {
  if (frozenMemo && frozenMemo.root === root) return frozenMemo;
  const outRoot = tempDir('kev-frozen-');
  const frozen = freezeBeds(root, { outRoot });
  return (frozenMemo = { root, outRoot, frozen, beds: frozenBeds(frozen) });
}

const gitEnv = { GIT_AUTHOR_NAME: 'kev-data test', GIT_AUTHOR_EMAIL: 'kev-data@example.invalid', GIT_COMMITTER_NAME: 'kev-data test',
  GIT_COMMITTER_EMAIL: 'kev-data@example.invalid', GIT_AUTHOR_DATE: '2026-10-07T00:00:00Z', GIT_COMMITTER_DATE: '2026-10-07T00:00:00Z', GIT_CONFIG_NOSYSTEM: '1' };
export function git(root, ...args) {
  return execFileSync('git', ['-C', root, '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env: { ...process.env, ...gitEnv, HOME: root } });
}
export function writeFiles(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    if (body === null) { rmSync(abs, { force: true }); continue; }
    mkdirSync(path.dirname(abs), { recursive: true }); writeFileSync(abs, body);
  }
}
// A git repository holding `files` ({relative path: content}) in one commit.
export function tempBedRepo(files) {
  const root = tempDir('kev-bedrepo-');
  git(root, 'init', '-q');
  writeFiles(root, files);
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'fixture');
  return root;
}
export function commitAll(root, message = 'update') { git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', message); }

// Every path argument the fs module receives and every argument list given to a child process,
// while installed. ESM named imports of node:fs are live bindings once syncBuiltinESMExports runs.
export function accessSpy() {
  const paths = [], commands = [], saved = [];
  const wrap = (obj, name, record) => {
    const orig = obj[name]; if (typeof orig !== 'function') return;
    saved.push([obj, name, orig]);
    obj[name] = function (...args) { record(args); return orig.apply(this, args); };
  };
  // Path arguments only: the first, and the second for two-path calls (never data buffers or fds).
  const TWO = /^(rename|copyFile|link|symlink|cp)(Sync)?$/;
  for (const name of Object.keys(fs)) {
    if (/^[a-z]/.test(name) && typeof fs[name] === 'function') {
      wrap(fs, name, args => { for (const a of args.slice(0, TWO.test(name) ? 2 : 1)) if (typeof a === 'string' || a instanceof URL) paths.push(String(a)); });
    }
  }
  for (const name of ['spawnSync', 'execFileSync', 'spawn', 'execFile', 'execSync', 'exec']) {
    wrap(childProcess, name, args => commands.push([args[0], ...(Array.isArray(args[1]) ? args[1] : [])].map(String)));
  }
  syncBuiltinESMExports();
  return {
    paths, commands,
    restore() { for (const [obj, name, orig] of saved.reverse()) obj[name] = orig; syncBuiltinESMExports(); },
    touched(pattern) { return [...paths.filter(p => pattern.test(p)), ...commands.filter(c => c.some(a => pattern.test(a))).map(c => c.join(' '))]; },
  };
}

// A copy of experiments/kev-data with mutations [{file, from, to}] applied (file relative to
// experiments/kev-data). The copy sits at <tmp>/experiments/kev-data with <tmp>/src, research and
// policy symlinked to this repository, so relative imports and REPO_ROOT-relative reads behave as
// in the original. beds/ is not linked (nothing under beds/sealed/ becomes reachable).
export function mutantCopy(mutations = []) {
  const root = tempDir('kev-mutant-');
  const dst = path.join(root, 'experiments', 'kev-data');
  cpSync(KEV_DATA, dst, { recursive: true, filter: src => !src.split(path.sep).includes('.foundry') });
  for (const d of ['src', 'research', 'policy']) symlinkSync(path.join(REPO_ROOT, d), path.join(root, d), 'dir');
  for (const m of mutations) {
    const f = path.join(dst, m.file), text = readFileSync(f, 'utf8');
    const n = text.split(m.from).length - 1;
    if (n !== 1) throw new Error(`mutation ${m.file}: ${JSON.stringify(m.from).slice(0, 60)} matches ${n} times (needs exactly 1)`);
    writeFileSync(f, text.replace(m.from, () => m.to));
  }
  return { root, dir: dst };
}

// node --test on one file; returns exit status, TAP lines and the names of passed and failed tests.
export function runTests(file, { pattern = null, env = {}, timeoutMs = 10 * 60 * 1000 } = {}) {
  const args = ['--test', '--test-reporter=tap', ...(pattern ? [`--test-name-pattern=${pattern}`] : []), file];
  // A test file run by `node --test` sees NODE_TEST_CONTEXT; a nested `node --test` that inherits it
  // reports to its parent's channel instead of printing TAP, so it is removed.
  const { NODE_TEST_CONTEXT, ...base } = process.env;
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...base, ...env }, timeout: timeoutMs, maxBuffer: 1 << 28 });
  const out = `${r.stdout ?? ''}`;
  const lines = out.split('\n'), pick = re => lines.map(l => re.exec(l)).filter(Boolean);
  const skipped = m => / # (SKIP|TODO)\b/i.test(m[0]);
  return { status: r.status, signal: r.signal, stdout: out, stderr: r.stderr ?? '',
    passed: pick(/^\s*ok \d+ - (.+?)(?: # .*)?$/).filter(m => !skipped(m)).map(m => m[1].trim()),
    skipped: pick(/^\s*ok \d+ - (.+?)(?: # .*)?$/).filter(skipped).map(m => m[1].trim()),
    failed: pick(/^\s*not ok \d+ - (.+?)(?: # .*)?$/).map(m => m[1].trim()) };
}

// The seeded-defect acceptance: the unmutated copy passes the selected tests, each mutant fails them.
export function seededDefect({ file, pattern, mutants, env = {} }) {
  const rel = path.relative(KEV_DATA, file);
  const control = mutantCopy([]);
  const controlRun = runTests(path.join(control.dir, rel), { pattern, env });
  const runs = mutants.map(m => ({ name: m.name, ...runTests(path.join(mutantCopy(m.mutations).dir, rel), { pattern: m.pattern ?? pattern, env }) }));
  return { control: controlRun, mutants: runs };
}

// The build's record checks over a group's records for one slice (shape, forbidden keys, contract
// options and wordings, labels, label source, reserved worlds, seed ranges). Returns the errors.
export function checkRecords(records, { slice, spec = loadSpec(), wordings = null, registry = null } = {}) {
  const errors = [];
  records.forEach((r, i) => { for (const e of checkRecord(r, { slice, contracts: spec.contracts, variants: spec.spec.conventions.variants, wordings, registry }).errors) errors.push({ index: i, ...e }); });
  return errors;
}
export const here = url => path.dirname(fileURLToPath(url));
export const emptyHeldout = () => ({ wordings: new WordingGuard([]), registry: new SpanRegistry() });
