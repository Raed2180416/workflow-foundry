#!/usr/bin/env node
// Inert, sparse source acquisition for the orchestration prior-art study (research/orch-20261021/PRIOR-ART.md).
// Shallow (depth 1), blob-filtered, sparse: only the named paths are checked out. No hooks (core.hooksPath=/dev/null),
// no submodules, no LFS smudge, no install, nothing executed. Clones go to corpus/orch-20261021/ (gitignored) and are
// deleted after study (--delete); the record (URL, commit SHA, date, license, paths, size, outcome) stays in
// research/orch-20261021/ACQUISITION.json.
//
//   node experiments/orch/acquire.mjs owner/repo path1 path2 ...     acquire (or re-verify) one repository
//   node experiments/orch/acquire.mjs --delete owner/repo            delete the clone, keep the record (outcome += deleted)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const ledgerFile = path.join(root, 'research/orch-20261021/ACQUISITION.json');
const records = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, 'utf8')) : [];
const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' };
const git = (args, cwd) => spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=never', '-c', 'submodule.recurse=false', ...args], { cwd, env, encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
const save = () => { mkdirSync(path.dirname(ledgerFile), { recursive: true }); writeFileSync(ledgerFile, JSON.stringify(records, null, 1) + '\n'); };
const du = dir => Number(spawnSync('du', ['-sk', dir], { encoding: 'utf8' }).stdout.split('\t')[0]) * 1024;

const args = process.argv.slice(2);
if (args[0] === '--delete') {
  const repo = args[1], dir = path.join(root, 'corpus/orch-20261021', repo.replace('/', '--'));
  rmSync(dir, { recursive: true, force: true });
  for (const r of records) if (r.repository === repo && !r.outcome.includes('deleted')) { r.outcome += '; deleted-after-study'; r.deletedAt = new Date().toISOString(); }
  save(); console.log(`${repo}: deleted`); process.exit(0);
}
const [repo, ...paths] = args;
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? '')) { console.error('usage: acquire.mjs owner/repo path...'); process.exit(2); }
const url = `https://github.com/${repo}.git`, dir = path.join(root, 'corpus/orch-20261021', repo.replace('/', '--'));
const record = { repository: repo, url, acquiredAt: new Date().toISOString(), method: 'git clone --depth 1 --filter=blob:none --sparse --no-tags (hooks off, no submodules, no LFS); sparse-checkout --no-cone', paths, outcome: 'pending' };
mkdirSync(path.dirname(dir), { recursive: true });
let r = existsSync(dir) ? { status: 0 } : git(['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--no-tags', '--no-recurse-submodules', url, dir]);
if (r.status !== 0) { Object.assign(record, { outcome: 'unavailable', error: String(r.stderr ?? r.error).slice(-1500) }); records.push(record); save(); console.log(`${repo}: UNAVAILABLE`); process.exit(1); }
const patterns = ['/LICENSE*', '/LICENCE*', '/NOTICE*', '/COPYING*', '/README*', ...paths.map(p => (p.startsWith('/') ? p : `/${p}`))];
r = git(['sparse-checkout', 'set', '--no-cone', ...patterns], dir);
if (r.status !== 0) { Object.assign(record, { outcome: 'sparse-checkout-failed', error: String(r.stderr).slice(-1500) }); records.push(record); save(); process.exit(1); }
const sha = git(['rev-parse', 'HEAD'], dir).stdout.trim(), date = git(['log', '-1', '--format=%cI'], dir).stdout.trim();
const files = git(['ls-files'], dir).stdout.split('\n').filter(Boolean);
const licenses = files.filter(f => /^(LICEN[CS]E|COPYING|NOTICE)(\.[^/]*)?$/i.test(f)).map(f => ({ path: f, firstLine: (() => { try { return readFileSync(path.join(dir, f), 'utf8').split('\n').find(l => l.trim())?.trim().slice(0, 120); } catch { return null; } })() }));
Object.assign(record, { commit: sha, commitDate: date, checkedOutFiles: files.length, bytesOnDisk: du(dir), licenses, outcome: 'cloned-sparse-source-not-executed' });
const prior = records.findIndex(x => x.repository === repo && !x.outcome.includes('deleted'));
if (prior >= 0) records[prior] = record; else records.push(record);
save();
console.log(JSON.stringify({ repo, sha: sha.slice(0, 12), files: files.length, mb: (record.bytesOnDisk / 1e6).toFixed(1), licenses: licenses.map(l => l.firstLine) }));
