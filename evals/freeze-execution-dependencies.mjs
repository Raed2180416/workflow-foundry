#!/usr/bin/env node
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashBytes } from './evidence.mjs';
import { runDirectory } from './opencode-harness.mjs';

// Copy already-installed public runtime dependencies; never install or run hooks.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pair = runDirectory(process.argv[2]);
const receipt = path.join(pair, 'execution-dependencies.json');
if (existsSync(receipt)) throw Error('Execution dependencies already frozen.');
const manifest = JSON.parse(readFileSync(path.join(pair, 'pair.json'), 'utf8'));
for (const id of [manifest.baselineID, manifest.foundryID].filter(Boolean)) {
  if (existsSync(path.join(runDirectory(id), 'construction-execution.json'))) throw Error('Freeze must occur before either arm is executed/scored.');
}
process.umask(0o077);
const originalLock = JSON.parse(readFileSync(path.join(pair, 'frozen/package-lock.json'), 'utf8'));
const packages = {}, files = {};
const pending = ['ajv'];
while (pending.length) {
  const name = pending.shift();
  if (packages[name]) continue;
  if (!/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(name)) throw Error('Invalid dependency name.');
  const source = path.join(root, 'node_modules', name);
  const metadata = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'));
  const expected = originalLock.packages[`node_modules/${name}`]?.version;
  if (!expected || metadata.version !== expected) throw Error(`Installed version drift for ${name}: ${metadata.version} != ${expected}`);
  packages[name] = metadata.version;
  pending.push(...Object.keys(metadata.dependencies ?? {}));
  const walk = relative => {
    const current = path.join(source, relative), stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw Error(`Dependency symlinks require manual review: ${name}/${relative}`);
    if (stat.isDirectory()) { for (const entry of readdirSync(current)) walk(path.join(relative, entry)); return; }
    if (!stat.isFile()) throw Error('Unsupported dependency file kind.');
    const destination = path.join(pair, 'frozen/node_modules', name, relative);
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    copyFileSync(current, destination);
    files[`${name}/${relative}`] = hashBytes(readFileSync(destination));
  };
  walk('');
}
const result = {
  frozenAt: new Date().toISOString(), packages, files,
  originalLockSHA256: hashBytes(readFileSync(path.join(pair, 'frozen/package-lock.json'))),
  reason: 'Prime added jsonc-parser after source freeze. Pinning the unchanged AJV runtime dependency closure locally before either arm executes avoids unrelated root lock changes and future dependency drift.',
};
writeFileSync(receipt, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ pair: process.argv[2], packages, fileCount: Object.keys(files).length, frozenAt: result.frozenAt }, null, 2));
