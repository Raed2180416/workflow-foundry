import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const env = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' };
const save = (file, value) => { mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); writeFileSync(file, json(value), { flag: 'wx', mode: 0o400 }); };
const skip = p => p.split(path.sep).includes('__pycache__') || p.endsWith('.pyc');

export function inventory(directory) {
  const records = {};
  const walk = relative => {
    for (const entry of readdirSync(path.join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const key = path.join(relative, entry.name), file = path.join(directory, key);
      if (entry.isDirectory()) walk(key);
      else if (entry.isSymbolicLink()) records[key] = { link: readlinkSync(file) };
      else if (entry.isFile()) records[key] = { sha256: hash(readFileSync(file)) };
      else throw Error(`Unsupported closure entry: ${key}`);
    }
  };
  walk(''); return records;
}

export function verifyInventory(directory, records) {
  const actual = inventory(directory), errors = [];
  for (const key of new Set([...Object.keys(records), ...Object.keys(actual)])) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(records[key])) errors.push(key);
  }
  return errors;
}

export function systemFingerprint() {
  const records = {};
  const add = file => {
    const target = realpathSync(file);
    if (!Object.hasOwn(records, target)) records[target] = hash(readFileSync(target));
  };
  for (const binary of ['/usr/bin/node', '/usr/bin/python', '/usr/bin/opencode', '/usr/bin/bwrap', '/usr/bin/prlimit']) {
    add(binary);
    const result = spawnSync('/usr/bin/ldd', [binary], { env, encoding: 'utf8', timeout: 5000 });
    for (const match of (result.stdout ?? '').matchAll(/(?:=>\s*)?(\/[^\s()]+)/g)) if (existsSync(match[1])) add(match[1]);
  }
  // Python's standard library remains in the host read-only /usr mount. Record
  // its complete non-site-packages file identity, not merely the interpreter.
  const py = spawnSync('/usr/bin/python', ['-I', '-B', '-c', 'import sysconfig; print(sysconfig.get_path("stdlib"))'], { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(py.status, 0);
  const walk = dir => { for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['site-packages', '__pycache__'].includes(e.name)) continue;
    const file = path.join(dir, e.name);
    if (e.isDirectory()) walk(file); else if (e.isFile() && !skip(file)) add(file);
  } };
  walk(py.stdout.trim());
  return Object.fromEntries(Object.entries(records).sort(([a], [b]) => a.localeCompare(b)));
}

export function verifySystem(records) {
  return Object.entries(records).filter(([file, expected]) => {
    try { return hash(readFileSync(file)) !== expected; } catch { return true; }
  }).map(([file]) => file);
}

export function freezeRevision(directory, { deadline, approval } = {}) {
  assert.ok(Number.isFinite(deadline) && deadline > Date.now(), 'A future bounded deadline is required');
  assert.ok(typeof approval === 'string' && approval.length > 10, 'Explicit prime approval receipt is required');
  assert.equal(existsSync(directory), false, 'Never reuse or overwrite an evidence directory');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const upstream = 'corpus/SWE-agent--mini-swe-agent';
  const revision = spawnSync('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: path.join(ROOT, upstream), env, encoding: 'utf8', timeout: 5000 });
  assert.equal(revision.status, 0); assert.equal(revision.stdout.trim(), '04d809ceab9df28f9adaed044884180159172930');
  const paths = ['src', 'skills', 'schemas', 'node_modules', 'package.json', 'package-lock.json', 'AGENTS.md',
    `${upstream}/src`, `${upstream}/LICENSE.md`, 'tests/reference-swe-contract.test.mjs',
    'research/reference-swe/runs/20260913-reference-01/candidate-workflow.json',
    ...['.venv', 'harness.mjs', 'original_agent.py', 'oracle_runner.py', 'requirements.txt', 'PROTOCOL.md',
      'CONSTRUCTION-RULE-v2.md', 'PROTOCOL-v2.md', 'construction-v2.mjs', 'freeze-v2.mjs', 'revision-v2.mjs']
      .map(name => `research/reference-swe/${name}`)];
  const snapshot = path.join(directory, 'snapshot');
  mkdirSync(snapshot, { mode: 0o700 });
  for (const relative of paths) cpSync(path.join(ROOT, relative), path.join(snapshot, relative), {
    recursive: true, dereference: false, verbatimSymlinks: true, force: false, errorOnExist: true,
    filter: source => { if (path.basename(source) === '.env') throw Error('Unexpected dotenv file in selected closure'); return !skip(source); }
  });
  const records = inventory(snapshot);
  for (const [relative, record] of Object.entries(records)) {
    const original = path.join(ROOT, relative), frozen = path.join(snapshot, relative);
    if (record.link) {
      assert.equal(readlinkSync(original), record.link, `Changed link during capture: ${relative}`);
      const target = realpathSync(frozen);
      assert.ok(target.startsWith(snapshot + path.sep) || target.startsWith('/usr/'), `Snapshot link escapes closure: ${relative}`);
    } else assert.equal(hash(readFileSync(original)), record.sha256, `Source changed during capture: ${relative}`);
  }
  const system = systemFingerprint();
  save(path.join(directory, 'closure.json'), records);
  save(path.join(directory, 'system-dependencies.json'), system);
  const reference01 = path.join(ROOT, 'research/reference-swe/runs/20260913-reference-01');
  const historical = JSON.parse(readFileSync(path.join(reference01, 'SHA256SUMS.json'), 'utf8'));
  const oldErrors = Object.entries(historical).filter(([p, expected]) => hash(readFileSync(path.join(reference01, p))) !== expected).map(([p]) => p);
  assert.deepEqual(oldErrors, [], 'Historical reference-01 changed');
  const receipt = { id: 'reference-02-frozen-diagnostic-v2', createdAt: new Date().toISOString(), deadline,
    approval, upstreamRevision: revision.stdout.trim(), upstreamLicense: 'MIT; preserved LICENSE.md',
    closureFileCount: Object.keys(records).length, closureHash: hash(json(records)),
    systemDependencyCount: Object.keys(system).length, systemHash: hash(json(system)),
    entrypoint: 'research/reference-swe/revision-v2.mjs', node: process.version,
    limits: { architectProviderInvocations: 2, executorInvocationsPerArmTask: 5, taskFamilies: 2, armDurationMs: 300000, providerDurationMs: 150000 },
    historicalReference01: { manifestHash: hash(readFileSync(path.join(reference01, 'SHA256SUMS.json'))), checked: Object.keys(historical).length, changed: oldErrors },
    scope: 'Copied source and package closure; fingerprinted host runtime dependencies, not a hermetic OS or remote-model snapshot' };
  save(path.join(directory, 'freeze-v2.json'), receipt);
  const readonly = dir => { for (const e of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) readonly(file);
    else if (e.isFile()) chmodSync(file, lstatSync(file).mode & 0o111 ? 0o555 : 0o444);
  } chmodSync(dir, 0o555); };
  readonly(snapshot);
  assert.deepEqual(verifyInventory(snapshot, records), []);
  return receipt;
}
