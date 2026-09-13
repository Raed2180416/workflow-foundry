import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Original evidence bookkeeping only. Never imports or executes a corpus file.
// --capture fills byte-derived identities once; ordinary invocation is read-only.
const root = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = path.join(root, 'research/manifests/protocol-adapter-evidence.json');
const capture = process.argv.slice(2).includes('--capture');
assert.ok(process.argv.slice(2).every(arg => arg === '--capture'), 'Only --capture is supported');
const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const safeRelative = relative => {
  assert.equal(typeof relative, 'string');
  assert.match(relative, /^[A-Za-z0-9_./@-]+$/);
  assert.ok(!path.isAbsolute(relative) && !relative.split('/').some(part => !part || part === '.' || part === '..'), `Unsafe relative path: ${relative}`);
  return relative;
};
const read = relative => {
  const bytes = readFileSync(path.join(root, safeRelative(relative)));
  assert.ok(bytes.length <= 2 * 1024 * 1024, `Evidence input exceeds two MiB: ${relative}`);
  return bytes;
};
const span = (bytes, item) => {
  assert.ok(bytes.equals(Buffer.from(bytes.toString('utf8'))), 'Source must be valid UTF-8');
  const lines = bytes.toString('utf8').match(/[^\n]*\n|[^\n]+$/g) ?? [];
  assert.ok(Number.isSafeInteger(item.startLine) && Number.isSafeInteger(item.endLine));
  assert.ok(item.startLine >= 1 && item.endLine >= item.startLine && item.endLine <= lines.length, `Invalid line bounds: ${item.id}`);
  return Buffer.from(lines.slice(item.startLine - 1, item.endLine).join(''));
};
const git = (directory, args) => {
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', '-C', path.join(root, safeRelative(directory)), ...args], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
    timeout: 5000, maxBuffer: 2 * 1024 * 1024
  });
  assert.equal(result.status, 0, `Read-only Git command failed: ${directory} ${args[0]} ${result.error?.message ?? ''}`);
  return result.stdout;
};
function checkEvidenceShape(document) {
  assert.equal(document.schemaVersion, '1.0');
  assert.deepEqual(Object.keys(document.repositories).sort(), ['langchain', 'opencode', 'sdk', 'servers']);
  const ids = new Set();
  const ranges = new Set();
  for (const item of document.evidence) {
    assert.match(item.id, /^[A-Z][A-Z0-9-]+$/);
    assert.ok(!ids.has(item.id), `Duplicate evidence id: ${item.id}`); ids.add(item.id);
    assert.ok(Object.hasOwn(document.repositories, item.repo), `Unknown repository: ${item.repo}`);
    safeRelative(item.path);
    const key = `${item.repo}:${item.path}:${item.startLine}-${item.endLine}`;
    assert.ok(!ranges.has(key), `Duplicate evidence span: ${key}`); ranges.add(key);
    assert.equal(typeof item.observation, 'string'); assert.ok(item.observation.length > 0);
  }
  assert.equal(new Set(document.requirements.map(item => item.id)).size, document.requirements.length);
  for (const requirement of document.requirements) {
    assert.ok(requirement.evidenceIds.length > 0);
    for (const id of requirement.evidenceIds) assert.ok(ids.has(id), `Unknown requirement evidence: ${id}`);
    assert.match(requirement.status, /^proposed-not-run/);
  }
}
checkEvidenceShape(manifest);
if (capture) assert.equal(manifest.sealedAt, undefined, 'Already sealed; preserve the prior receipt rather than recapturing it');
else assert.equal(typeof manifest.sealedAt, 'string', 'Capture the reviewed evidence once before verifying it');

const baselineDoc = read(manifest.baseline.document);
assert.equal(hash(baselineDoc.subarray(0, manifest.baseline.preservedPrefixBytes)), manifest.baseline.preservedPrefixSha256, 'Original coverage snapshot changed');
assert.ok(baselineDoc.subarray(manifest.baseline.preservedPrefixBytes).toString().includes(manifest.baseline.addendumHeading), 'Dated coverage addendum is missing');
const baselineBytes = read(manifest.baseline.receipt);
assert.equal(hash(baselineBytes), manifest.baseline.receiptSha256, 'Historical coverage receipt changed');
const baseline = JSON.parse(baselineBytes);
assert.deepEqual({ spans: baseline.citations.length, files: baseline.recordedUniqueFiles, repositories: baseline.repositoriesWithRecordedSpans }, manifest.baseline.counts);

const repoReceipts = {};
for (const [key, repo] of Object.entries(manifest.repositories)) {
  assert.match(repo.commit, /^[0-9a-f]{40}$/);
  assert.equal(git(repo.directory, ['rev-parse', 'HEAD']).toString().trim(), repo.commit, `Pinned HEAD mismatch: ${repo.repository}`);
  assert.equal(git(repo.directory, ['status', '--porcelain', '--untracked-files=no']).toString(), '', `Tracked checkout edits: ${repo.repository}`);
  const acquisitionBytes = read(repo.acquisitionManifest);
  const record = JSON.parse(acquisitionBytes).find(item => item.repository === repo.repository);
  assert.ok(record, `Missing acquisition record: ${repo.repository}`);
  assert.equal(record.commit, repo.commit);
  assert.equal(record.outcome, 'cloned-source-not-executed');
  assert.equal(path.resolve(record.directory), path.resolve(root, repo.directory));
  const licenses = record.licenses.map(item => {
    const actual = hash(read(`${repo.directory}/${safeRelative(item.path)}`));
    assert.equal(actual, item.sha256, `Acquired license identity changed: ${repo.repository}/${item.path}`);
    return { path: item.path, sha256: actual };
  });
  repoReceipts[key] = { head: repo.commit, trackedClean: true, acquisitionManifestSha256: hash(acquisitionBytes), acquiredAt: record.acquiredAt, classification: record.classification, licenses };
  if (!capture) assert.deepEqual(repoReceipts[key], repo.acquisitionIdentity, `Acquisition closure changed: ${repo.repository}`);
}

const checkedFiles = new Map();
const dossier = read(manifest.dossier).toString('utf8');
for (const item of manifest.evidence) {
  const repo = manifest.repositories[item.repo];
  const relative = `${repo.directory}/${item.path}`;
  if (!checkedFiles.has(relative)) {
    const bytes = read(relative);
    assert.ok(bytes.equals(git(repo.directory, ['show', `${repo.commit}:${item.path}`])), `Working bytes differ from pinned Git blob: ${relative}`);
    checkedFiles.set(relative, bytes);
  }
  const bytes = checkedFiles.get(relative);
  const derived = {
    fileSha256: hash(bytes), spanSha256: hash(span(bytes, item)),
    url: `https://github.com/${repo.repository}/blob/${repo.commit}/${item.path}#L${item.startLine}-L${item.endLine}`
  };
  assert.ok(dossier.includes(`[${item.id}](${derived.url})`), `Dossier lacks exact pinned reference: ${item.id}`);
  if (capture) Object.assign(item, derived);
  else for (const [key, value] of Object.entries(derived)) assert.equal(item[key], value, `Evidence ${key} mismatch: ${item.id}`);
}

const contextDrift = [];
for (const item of manifest.contextEvidence) {
  const bytes = read(item.path);
  const fileSha256 = hash(bytes);
  if (item.expectedFileSha256) assert.equal(fileSha256, item.expectedFileSha256, `Installed identity changed: ${item.id}`);
  if (item.packageManifest) {
    assert.equal(JSON.parse(read(item.packageManifest)).version, item.expectedPackageVersion);
    if (capture) item.packageManifestSha256 = hash(read(item.packageManifest));
    else assert.equal(hash(read(item.packageManifest)), item.packageManifestSha256);
  }
  if (capture) Object.assign(item, { fileSha256, spanSha256: hash(span(bytes, item)) });
  else if (fileSha256 !== item.fileSha256) contextDrift.push(item.id);
  else assert.equal(hash(span(bytes, item)), item.spanSha256);
}

const added = manifest.evidence.map(item => ({ repository: manifest.repositories[item.repo].repository, revision: manifest.repositories[item.repo].commit, path: item.path, start: item.startLine, end: item.endLine }));
const counts = items => ({
  spans: new Set(items.map(item => `${item.repository.toLowerCase()}@${item.revision}:${item.path}:${item.start}-${item.end}`)).size,
  files: new Set(items.map(item => `${item.repository.toLowerCase()}@${item.revision}:${item.path}`)).size,
  repositories: new Set(items.map(item => item.repository.toLowerCase())).size
});
const coverage = { baseline: counts(baseline.citations), added: counts(added), combined: counts([...baseline.citations, ...added]), perRepository: Object.fromEntries(Object.entries(manifest.repositories).map(([key, repo]) => [repo.repository, counts(added.filter(item => item.repository === repo.repository))])) };
assert.deepEqual(coverage.baseline, manifest.baseline.counts);
assert.equal(coverage.combined.repositories, baseline.uniqueRepositories);
assert.equal(coverage.combined.spans, coverage.baseline.spans + coverage.added.spans, 'These four formerly empty repositories must add disjoint citations');
if (capture) manifest.coverage = coverage;
else assert.deepEqual(manifest.coverage, coverage);

// Negative controls for this bookkeeping verifier only, never upstream runtime tests.
const duplicate = structuredClone(manifest); duplicate.evidence.push(duplicate.evidence[0]);
assert.throws(() => checkEvidenceShape(duplicate));
assert.throws(() => safeRelative('../outside'));
assert.throws(() => span(Buffer.from('one\n'), { id: 'BAD-RANGE', startLine: 1, endLine: 2 }));
assert.throws(() => assert.equal(hash(Buffer.from('changed')), hash(Buffer.from('original'))));
const unknown = structuredClone(manifest); unknown.requirements[0].evidenceIds.push('MISSING');
assert.throws(() => checkEvidenceShape(unknown));

for (const [relative, bytes] of checkedFiles) assert.equal(hash(read(relative)), hash(bytes), `Source changed while verifying: ${relative}`);
assert.equal(hash(read(manifest.baseline.document)), hash(baselineDoc), 'Coverage document changed during verification');
if (capture) {
  manifest.sealedAt = new Date().toISOString();
  for (const [key, receipt] of Object.entries(repoReceipts)) manifest.repositories[key].acquisitionIdentity = receipt;
  const temp = `${manifestPath}.capture.tmp`;
  writeFileSync(temp, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  renameSync(temp, manifestPath);
}
console.log(JSON.stringify({
  id: manifest.id, recordedAt: new Date().toISOString(), mode: capture ? 'initial-byte-capture' : 'verification',
  passed: true, verificationScope: 'Pinned Git blobs, file/span hashes, acquisition identities, preserved historical prefix, citation references and finite bookkeeping negative controls only',
  manifestSha256: hash(readFileSync(manifestPath)), dossierSha256: hash(read(manifest.dossier)), verifierSha256: hash(read(manifest.verificationScript)),
  coverageDocumentSha256: hash(baselineDoc), coverage, checkedUpstreamFiles: checkedFiles.size,
  checkedSpans: manifest.evidence.length, sourcesStableDuringVerification: true, preservedOldSnapshot: true,
  bookkeepingNegativeControlsPassed: 5, contextDrift, upstreamExecutions: 0, modelCalls: 0,
  runtimeQualified: false, warning: 'A byte-accurate citation is not proof of behavioral correctness; context drift does not rewrite the captured observation.'
}, null, 2));
