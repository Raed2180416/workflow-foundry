#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Inert source acquisition: no install, hooks, submodules, LFS or authentication.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [group, ...specs] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(group ?? '') || !specs.length) {
  console.error('Usage: node research/acquire.mjs <group> owner/repo[:classification] ...');
  process.exit(2);
}
const manifestPath = path.join(root, 'research/manifests', `${group}.json`);
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
const records = new Map(previous.map(r => [r.repository, r]));
const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' };
const git = (args, timeout = 120000) => spawnSync('git', args, { env, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 });
mkdirSync(path.join(root, 'corpus'), { recursive: true });
for (const spec of specs) {
  const [repository, classification = 'implementation'] = spec.split(':');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw Error(`Invalid repository: ${repository}`);
  const url = `https://github.com/${repository}.git`;
  const directory = path.join(root, 'corpus', repository.replace('/', '--'));
  const record = { repository, url, classification, acquiredAt: new Date().toISOString(), directory, outcome: 'pending' };
  if (!existsSync(directory)) {
    const result = git(['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=never', 'clone', '--depth', '1', '--no-tags', url, directory]);
    if (result.status !== 0) {
      Object.assign(record, { outcome: 'unavailable', error: String(result.error ?? result.stderr).slice(-3000) });
      records.set(repository, record);
      writeFileSync(manifestPath, JSON.stringify([...records.values()], null, 2) + '\n');
      console.log(`${repository}: UNAVAILABLE`);
      continue;
    }
  }
  const remote = git(['-C', directory, 'remote', 'get-url', 'origin']);
  const sha = git(['-C', directory, 'rev-parse', 'HEAD']);
  if (remote.status || sha.status || remote.stdout.trim().toLowerCase() !== url.toLowerCase()) {
    Object.assign(record, { outcome: 'unverified-existing-path', error: 'Existing target does not match the expected Git repository; left untouched.' });
  } else {
    const listing = git(['-C', directory, 'ls-files']);
    const tracked = listing.stdout.trim().split('\n').filter(Boolean);
    const licensePaths = tracked.filter(f => /(^|\/)(LICEN[CS]E|COPYING|NOTICE)(\.[^/]*)?$/i.test(f)).slice(0, 20);
    Object.assign(record, {
      outcome: 'cloned-source-not-executed', commit: sha.stdout.trim(),
      fileCount: tracked.length,
      licenses: licensePaths.map(f => {
        try {
          const data = readFileSync(path.join(directory, f));
          return { path: f, sha256: createHash('sha256').update(data).digest('hex'), excerpt: data.toString('utf8').slice(0, 700) };
        } catch { return { path: f, error: 'unreadable' }; }
      }),
      redistribution: 'not-authorized-by-acquisition; review upstream license',
      execution: 'not-installed-or-run'
    });
  }
  records.set(repository, record);
  writeFileSync(manifestPath, JSON.stringify([...records.values()], null, 2) + '\n');
  console.log(`${repository}: ${record.outcome} ${record.commit ?? ''} (${record.fileCount ?? '?'} files)`);
}
