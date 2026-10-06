import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './suite.mjs';
import { preflight } from './preflight.mjs';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = value => JSON.stringify(value, null, 2) + '\n';
export const writeNew = (file, value) => writeFileSync(file, json(value), { flag: 'wx', mode: 0o600 });
const sources = ['expectations.mjs', 'suite.mjs', 'preflight.mjs', 'preflight.test.mjs', 'freeze.mjs', 'run.mjs', 'NOTE.md'];
const interfaces = ['contract.mjs', 'PUBLIC.json', 'oracle-v2.mjs'].map(file => path.resolve(ROOT, '..', file));

export function verifyPartitionFreeze() {
  const freezeBytes = readFileSync(path.join(ROOT, 'FREEZE.json'));
  const freeze = JSON.parse(freezeBytes);
  assert.equal(freeze.nodeVersion, process.version);
  assert.equal(freeze.caseCount, 98);
  assert.equal(freeze.nativeMaxStepsPerRun, 160);
  for (const entry of freeze.files) assert.equal(sha(readFileSync(path.join(ROOT, entry.name))), entry.sha256, `Frozen owned file changed: ${entry.name}`);
  for (const entry of freeze.interfaces) assert.equal(sha(readFileSync(entry.path)), entry.sha256, `Frozen public interface changed: ${entry.path}`);
  return { freeze, freezeSha256: sha(freezeBytes) };
}

export function freezePartition() {
  assert.equal(existsSync(path.join(ROOT, 'FREEZE.json')), false, 'A completed freeze is immutable');
  const data = build();
  const checks = preflight(data);
  for (const name of sources) assert.ok(existsSync(path.join(ROOT, name)), `Missing authored source: ${name}`);
  const outputs = {
    'SUITE.json': data.suite,
    'EXPECTATIONS.json': data.expected,
    'INDEX.json': data.index,
    'PREFLIGHT.json': checks,
  };
  for (const [name, value] of Object.entries(outputs)) writeNew(path.join(ROOT, name), value);
  const freeze = {
    schemaVersion: 'partition-validation-worker7-freeze-v1', createdAt: new Date().toISOString(),
    author: 'worker-7', nodeVersion: process.version, caseCount: checks.caseCount,
    nativeMaxStepsPerRun: 160, totalCandidateExecutionCap: 200, reservation: checks.reservation,
    construction: 'Public prose decision rules; no model candidate, builder packet, prior suite/result, or oracle.mjs implementation inspected during construction.',
    expectationAuthority: 'expectations.mjs; existing expectedFromObservations was not imported or called for authoring or preflight.',
    files: [...sources, ...Object.keys(outputs)].map(name => ({ name, sha256: sha(readFileSync(path.join(ROOT, name))) })),
    interfaces: interfaces.map(file => ({ path: file, sha256: sha(readFileSync(file)) })),
  };
  writeNew(path.join(ROOT, 'FREEZE.json'), freeze);
  const verified = verifyPartitionFreeze();
  const ready = {
    status: 'READY', frozenAt: freeze.createdAt, freezeSha256: verified.freezeSha256,
    suitePath: path.join(ROOT, 'SUITE.json'), sourcePath: path.join(ROOT, 'suite.mjs'),
    expectationsPath: path.join(ROOT, 'EXPECTATIONS.json'), notePath: path.join(ROOT, 'NOTE.md'),
    caseCount: 98, candidateExecutionsSoFar: 0, reservation: checks.reservation,
    blocker: 'Candidate file must be explicitly supplied by prime after this freeze.',
  };
  writeNew(path.join(ROOT, 'READY.json'), ready);
  console.log(json({ ...ready, preflight: checks }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) freezePartition();
