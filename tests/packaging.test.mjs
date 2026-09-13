import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Default: bounded, offline skill-reference audit. Opt in to one tarball and five
// sequential local MCP processes: FOUNDRY_PACKAGING_E2E=1 node --test tests/packaging.test.mjs
// Reuses the already-installed exact-pinned Node dependencies; it is not a clean
// registry install, upstream application test, model test or publication step.
const root = fileURLToPath(new URL('..', import.meta.url));
const enabled = process.env.FOUNDRY_PACKAGING_E2E === '1';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const normalize = value => value.trim().replace(/\s+/g, ' ').toLowerCase();
const inDirectory = (directory, target) => target === directory || target.startsWith(`${directory}${path.sep}`);
const tree = directory => readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
  const target = path.join(directory, entry.name);
  if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in package content: ${target}`);
  return entry.isDirectory() ? tree(target) : [target];
});
const webFiles = ['web/index.html', 'web/app.js', 'web/style.css'];
const exampleFiles = ['examples/hello.json', 'examples/incident.json', 'examples/incident-world.json', 'examples/batch-suite.json', 'examples/batch-task.md'];
const documentationFiles = ['docs/ARCHITECTURE.md', 'docs/IMPLEMENTATION-PLAN.md', 'docs/PACKAGING.md', 'docs/REPAIR-LIFECYCLE.md', 'docs/UI-TRIALS.md', 'docs/PRODUCT-DEMO-PROTOCOL.md', 'docs/SOURCE-COVERAGE.md'];
const publicationPath = relative => {
  if (/(?:^|\/)(?:\.[^/]+|private|credentials|corpus|research|evals|tests|artifacts|__pycache__|node_modules)(?:\/|$)/i.test(relative)) return false;
  if (['package.json', 'README.md', 'bin/foundry.mjs', 'schemas/workflow.schema.json', 'adapters/index.mjs', ...webFiles, ...exampleFiles, ...documentationFiles].includes(relative)) return true;
  return /^src\/[a-z][a-z0-9-]*\.mjs$/.test(relative)
    || /^skills\/[a-z][a-z0-9-]*\/(?:SKILL\.md|references\/[A-Za-z0-9_./-]+\.(?:md|json|txt))$/.test(relative)
    || /^adapters\/(?:langgraph|n8n)\/[A-Za-z0-9_-]+\.(?:mjs|md)$/.test(relative)
    || /^adapters\/langgraph\/(?:[A-Za-z0-9_-]+\.py|requirements\.(?:in|txt))$/.test(relative);
};
// Snapshot every product source, including newly added files between snapshots.
// Evidence folders are deliberately excluded from this source inventory.
const sourceHashes = () => {
  const candidates = ['package.json', 'package-lock.json', 'tests/packaging.test.mjs', ...webFiles,
    ...['README.md', '.npmignore'].filter(file => existsSync(path.join(root, file))),
    ...['bin', 'src', 'schemas', 'skills', 'adapters', 'docs', 'examples'].flatMap(directory => tree(path.join(root, directory))
      .map(file => path.relative(root, file)).filter(file => !file.split(path.sep).includes('__pycache__') && /\.(?:mjs|py|md|json|txt|in)$/.test(file)))];
  return [...new Set(candidates)].sort().map(relative => ({ path: relative, sha256: sha256(readFileSync(path.join(root, relative))) }));
};
const blank = text => text.replace(/[^\n]/g, ' ');
const withoutFences = text => text.replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[^\n]*(?:\n|$)/gm, blank);

// Covers the syntax present in these skills: inline/image links, angle-bracket
// destinations, reference definitions and explicit references/*.md code paths.
// Unsupported inline destination syntax is an error, never silently a pass.
function markdownReferences(text) {
  const unfenced = withoutFences(text), refs = [], problems = [];
  const line = offset => unfenced.slice(0, offset).split('\n').length;
  for (const match of unfenced.matchAll(/`((?:\.\.?\/)?references\/[^`\s]+\.(?:md|json|txt)(?:#[^`\s]+)?)`/g)) refs.push({ target: match[1], line: line(match.index), kind: 'code-reference' });
  const plain = unfenced.replace(/(`+)([^\n]*?)\1/g, blank);
  const definitions = new Map();
  for (const match of plain.matchAll(/^ {0,3}\[([^\]\n]+)\]:\s*(<[^>\n]+>|[^\s]+)(?:\s+.*)?$/gm)) {
    const target = match[2].replace(/^<|>$/g, '');
    definitions.set(normalize(match[1]), target);
    refs.push({ target, line: line(match.index), kind: 'definition' });
  }
  const consumed = new Set();
  for (const match of plain.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>\n]*>|(?:\\.|[^\s()])+)(?:\s+["'][^\n]*?["'])?\s*\)/g)) {
    refs.push({ target: match[1].replace(/^<|>$/g, '').replace(/\\([()])/g, '$1'), line: line(match.index), kind: 'link' });
    consumed.add(match.index + match[0].indexOf(']('));
  }
  for (const match of plain.matchAll(/\]\(/g)) if (!consumed.has(match.index)) problems.push({ line: line(match.index), error: 'UNSUPPORTED_LINK_SYNTAX' });
  for (const match of plain.matchAll(/!?\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
    const label = normalize(match[2] || match[1]);
    if (!definitions.has(label)) problems.push({ line: line(match.index), error: 'UNDEFINED_REFERENCE', label });
  }
  return { refs, problems };
}

function anchors(text) {
  const result = new Set(), seen = new Map();
  for (const match of withoutFences(text).matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const slug = match[1].replace(/<[^>]*>/g, '').toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1); result.add(count ? `${slug}-${count}` : slug);
  }
  for (const match of text.matchAll(/<(?:a|h[1-6])\b[^>]*\b(?:id|name)=["']([^"']+)["']/gi)) result.add(match[1]);
  return result;
}

function auditSkillReferences(directory) {
  const files = tree(directory), targets = new Set(files), failures = [], references = [];
  const markdown = files.filter(file => file.endsWith('.md'));
  let externalLinks = 0;
  for (const file of markdown) {
    const parsed = markdownReferences(readFileSync(file, 'utf8'));
    failures.push(...parsed.problems.map(problem => ({ file: path.relative(directory, file), ...problem })));
    for (const ref of parsed.refs) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref.target)) { externalLinks++; continue; }
      const record = { file: path.relative(directory, file), ...ref };
      let location, fragment;
      try { const parts = ref.target.split('#'); location = decodeURIComponent(parts.shift().split('?')[0]); fragment = parts.length ? decodeURIComponent(parts.join('#')) : ''; }
      catch { failures.push({ ...record, error: 'INVALID_URL_ENCODING' }); continue; }
      const resolved = location ? path.resolve(path.dirname(file), location) : file;
      if (!inDirectory(directory, resolved)) failures.push({ ...record, error: 'OUTSIDE_INSTALLED_SKILLS' });
      else if (!targets.has(resolved)) failures.push({ ...record, error: 'MISSING_TARGET' });
      else if (fragment && resolved.endsWith('.md') && !anchors(readFileSync(resolved, 'utf8')).has(fragment)) failures.push({ ...record, error: 'MISSING_ANCHOR' });
      references.push(record);
    }
  }
  return { fileCount: files.length, markdownFiles: markdown.length, localReferenceCount: references.length, externalLinks, references, failures };
}

function packRecord(output, packageName) {
  const value = JSON.parse(output);
  // npm 12 emits a package-name map; older npm emits an array.
  const entry = Array.isArray(value) ? value[0] : value[packageName];
  assert.ok(entry && Array.isArray(entry.files), 'npm pack did not return a usable file inventory');
  return entry;
}

function corpusCoverage() {
  const groups = ['software', 'science', 'protocols', 'opencode', 'sre-security', 'sre-security-extra', 'sre-security-telemetry'];
  const documentGroups = ['docs-public-science', 'sre-security-docs', 'sre-security-adjacent-docs'];
  const manifests = [], records = [], documents = [];
  for (const group of [...groups, ...documentGroups]) {
    const relative = `research/manifests/${group}.json`, content = readFileSync(path.join(root, relative));
    const rows = JSON.parse(content);
    manifests.push({ path: relative, sha256: sha256(content), entries: rows.length });
    for (const row of rows) (groups.includes(group) ? records : documents).push({ ...row, manifest: relative });
  }
  const repositories = new Map();
  for (const record of records) {
    const key = record.repository.toLowerCase();
    if (!repositories.has(key)) repositories.set(key, { repository: record.repository, records: [] });
    repositories.get(key).records.push(record);
  }
  const inspectedFiles = [
    'research/dossiers/software-browser-skills.md', 'research/dossiers/software-browser-evidence.md',
    'research/dossiers/science-robotics-healthcare.md', 'research/dossiers/sre-security.md',
    'skills/domain-science/references/source-map.md', 'skills/domain-robotics/references/source-map.md',
    'skills/domain-healthcare/references/source-map.md', 'skills/domain-sre/references/source-notes.md',
    'skills/domain-security/references/source-notes.md'
  ];
  const inspected = inspectedFiles.map(relative => {
    const bytes = readFileSync(path.join(root, relative));
    return { path: relative, sha256: sha256(bytes), text: bytes.toString('utf8') };
  });
  const citations = new Map();
  const add = (repo, revision, source, start, end, origin) => {
    const key = `${repo.toLowerCase()}@${revision}:${source}:${start}-${end}`;
    if (!citations.has(key)) citations.set(key, { repository: repo, revision, path: source, start: Number(start), end: Number(end), origins: [] });
    const entry = citations.get(key); if (!entry.origins.includes(origin)) entry.origins.push(origin);
  };
  for (const source of inspected) {
    for (const match of source.text.matchAll(/https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/blob\/([0-9a-f]{40})\/([^\s)#]+)#L(\d+)(?:-L(\d+))?/g)) add(match[1], match[2], match[3], match[4], match[5] ?? match[4], source.path);
  }
  const evidencePath = 'research/dossiers/software-browser-evidence.json', evidenceBytes = readFileSync(path.join(root, evidencePath));
  const evidence = JSON.parse(evidenceBytes);
  for (const item of evidence.evidence) add(item.repository, item.commit, item.path, item.startLine, item.endLine, evidencePath);
  const sreAliases = { H: 'HolmesGPT/holmesgpt', R: 'rootlyhq/rootly-mcp-server', V: 'resolve-ai-oss/resolve-ai-plugins', S: 'KeygraphHQ/shannon', X: 'xbow-engineering/validation-benchmarks', N: 'horizon3ai/h3-cli', D: 'DataDog/datadog-agent' };
  const sre = inspected.find(source => source.path.endsWith('/sre-security.md'));
  for (const match of sre.text.matchAll(/\b([HRVSXND]):([^`\s:]+):(\d+)[–-](\d+)/g)) {
    const repo = sreAliases[match[1]], revision = repositories.get(repo.toLowerCase()).records[0].commit;
    add(repo, revision, match[2], match[3], match[4], sre.path);
  }
  const rows = [...repositories.values()].map(({ repository, records: repoRecords }) => {
    const revisions = [...new Set(repoRecords.map(item => item.commit).filter(Boolean))];
    const licenseEntries = [...new Map(repoRecords.flatMap(item => item.licenses ?? []).map(item => [`${item.path}:${item.sha256}`, { path: item.path, sha256: item.sha256 ?? null }])).values()];
    const spans = [...citations.values()].filter(item => item.repository.toLowerCase() === repository.toLowerCase() && revisions.includes(item.revision));
    return { repository, revisions, classifications: [...new Set(repoRecords.map(item => item.classification))].sort(), outcomes: [...new Set(repoRecords.map(item => item.outcome))], manifests: repoRecords.map(item => item.manifest), trackedFiles: repoRecords[0].fileCount ?? null, directoryPresent: existsSync(path.join(root, 'corpus', repository.replace('/', '--'), '.git')), licenseEntries, licenseHeuristicReachedCap: repoRecords.some(item => item.licenses?.length === 20), recordedSpans: spans.length, recordedFiles: new Set(spans.map(item => item.path)).size, inspectionDossiers: inspected.filter(item => item.path.startsWith('research/dossiers/') && item.text.toLowerCase().includes(repository.toLowerCase())).map(item => item.path) };
  }).sort((a, b) => a.repository.localeCompare(b.repository));
  const classifications = {};
  for (const row of rows) { const label = row.classifications.join(' / '); classifications[label] = (classifications[label] ?? 0) + 1; }
  const documentOutcomes = {};
  for (const doc of documents) documentOutcomes[doc.outcome] = (documentOutcomes[doc.outcome] ?? 0) + 1;
  const observedDirectories = readdirSync(path.join(root, 'corpus'), { withFileTypes: true }).filter(item => item.isDirectory());
  const gitDirectories = observedDirectories.filter(item => existsSync(path.join(root, 'corpus', item.name, '.git'))).map(item => item.name);
  return { recordedAt: new Date().toISOString(), method: 'Deduplicated repository identities and revision/path/line citations from current public manifests and selected public dossiers/source maps. Citation presence is recorded inspection evidence, not a new upstream audit or full-file coverage.', manifests, inspectionSources: [...inspected.map(({ text, ...source }) => source), { path: evidencePath, sha256: sha256(evidenceBytes) }], acquisitionRecords: records.length, uniqueRepositories: rows.length, gitDirectories: gitDirectories.length, unmanifestedGitDirectories: gitDirectories.filter(name => !rows.some(row => row.repository.replace('/', '--') === name)), trackedFiles: rows.reduce((sum, row) => sum + (row.trackedFiles ?? 0), 0), classifications, repositoriesWithLicenseEvidence: rows.filter(row => row.licenseEntries.length).length, repositoriesWithoutLicenseEvidence: rows.filter(row => !row.licenseEntries.length).map(row => row.repository), licenseEntries: rows.reduce((sum, row) => sum + row.licenseEntries.length, 0), cappedLicenseInventories: rows.filter(row => row.licenseHeuristicReachedCap).map(row => row.repository), repositoriesWithRecordedSpans: rows.filter(row => row.recordedSpans).length, repositoriesWithoutRecordedSpans: rows.filter(row => !row.recordedSpans).map(row => row.repository), recordedUniqueSpans: citations.size, recordedUniqueFiles: new Set([...citations.values()].map(item => `${item.repository.toLowerCase()}@${item.revision}:${item.path}`)).size, documentRecords: documents.length, documentSnapshotsWithHashes: documents.filter(doc => doc.sha256 && doc.localPath).length, documentOutcomes, unavailableDocumentSnapshots: documents.filter(doc => !doc.sha256 || !doc.localPath).map(doc => ({ id: doc.id, manifest: doc.manifest, outcome: doc.outcome })), repositories: rows, citations: [...citations.values()] };
}

test('packaging reference checker detects missing files, anchors and escaped bundle paths', () => {
  mkdirSync(path.join(root, 'evals/runs'), { recursive: true });
  const workspace = mkdtempSync(path.join(root, 'evals/runs/packaging-parser-'));
  try {
    mkdirSync(path.join(workspace, 'references'));
    writeFileSync(path.join(workspace, 'SKILL.md'), '[Good](references/a.md#some-heading)\n[Missing](references/missing.md)\n[Escape](../dossier.md)\n[Anchor](references/a.md#absent)\n[Named][map]\n[map]: references/a.md\n`references/a.md`\n[External](https://example.invalid/a)\n```md\n[Example](not-a-required-file.md)\n```\n');
    writeFileSync(path.join(workspace, 'references/a.md'), '# Some heading\n');
    const result = auditSkillReferences(workspace);
    assert.deepEqual(result.failures.map(item => item.error), ['MISSING_TARGET', 'OUTSIDE_INSTALLED_SKILLS', 'MISSING_ANCHOR']);
    assert.equal(result.externalLinks, 1);
    assert.ok(result.references.some(item => item.kind === 'code-reference'));
    assert.equal(markdownReferences('[x][unresolved]').problems[0].error, 'UNDEFINED_REFERENCE');
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test('packaging all shipped skill Markdown references stay within the portable bundle', t => {
  const audit = auditSkillReferences(path.join(root, 'skills'));
  t.diagnostic(JSON.stringify({ markdownFiles: audit.markdownFiles, localReferences: audit.localReferenceCount, failures: audit.failures }));
  assert.deepEqual(audit.failures, [], 'Installed copies do not include repository-only research dossiers/manifests.');
});

test('packaging source-map headers preserve repository-only provenance and pinned public sources', () => {
  for (const domain of ['science', 'robotics', 'healthcare']) {
    const text = readFileSync(path.join(root, `skills/domain-${domain}/references/source-map.md`), 'utf8');
    const header = text.split('\n')[2];
    assert.ok(header.includes('2026-09-13'));
    for (const ledger of ['science.json', 'docs-public-science.json']) assert.ok(header.includes(`\`research/manifests/${ledger}\``), `${domain}: preserve ${ledger}`);
    assert.match(header, /repository-only provenance/);
    assert.match(text, /https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[a-f0-9]{40}\/[^)]+#L\d+/);
  }
});

test('packaging inventory gate rejects private state and evidence even under otherwise published roots', () => {
  for (const relative of ['web/artifacts/screenshot.png', 'adapters/langgraph/__pycache__/runtime.pyc', 'src/.env', 'src/private/key.mjs', 'skills/workflow-foundry/references/private/token.txt', 'docs/private.md', 'corpus/vendor/LICENSE', 'evals/runs/receipt.json', '.npmrc']) assert.equal(publicationPath(relative), false, relative);
  for (const relative of [...webFiles, ...exampleFiles, 'src/generator.mjs', 'adapters/langgraph/runtime.py', 'adapters/langgraph/requirements.txt', 'skills/domain-science/references/source-map.md']) assert.equal(publicationPath(relative), true, relative);
});

test('packaging actual tarball, project installers and generated stdio MCP commands', { skip: !enabled, timeout: 90000 }, async t => {
  const evidenceRoot = path.join(root, 'evals/runs'); mkdirSync(evidenceRoot, { recursive: true });
  const evidence = mkdtempSync(path.join(evidenceRoot, 'packaging-evidence-'));
  const stage = mkdtempSync(path.join(evidenceRoot, 'packaging-stage-'));
  mkdirSync(path.join(evidence, 'commands'));
  const report = { scope: 'Offline packaging/install/MCP transport conformance; no model calls, publication, upstream execution or clean dependency installation', recordedAt: new Date().toISOString(), node: process.version, modelCalls: 0, externalServiceCalls: 0, dependencyMode: 'Existing exact-pinned node_modules reused by one staging-only symlink', checks: [], commands: [], installs: [] };
  const hashes = sourceHashes;
  report.sourcesBefore = hashes();
  // Separate empty config files avoid npm 12's duplicate-config-path rejection
  // and prevent reading the operator's npm account configuration.
  const userConfig = path.join(stage, 'empty-user.npmrc'), globalConfig = path.join(stage, 'empty-global.npmrc');
  writeFileSync(userConfig, ''); writeFileSync(globalConfig, '');
  const isolatedHome = path.join(stage, 'home'); mkdirSync(isolatedHome);
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: isolatedHome, XDG_CONFIG_HOME: path.join(isolatedHome, 'config'), XDG_DATA_HOME: path.join(isolatedHome, 'data'), XDG_CACHE_HOME: path.join(isolatedHome, 'cache'), NPM_CONFIG_USERCONFIG: userConfig, NPM_CONFIG_GLOBALCONFIG: globalConfig, NPM_CONFIG_CACHE: path.join(stage, 'npm-cache'), NPM_CONFIG_IGNORE_SCRIPTS: 'true', NPM_CONFIG_OFFLINE: 'true' };
  const run = (command, args, cwd = root, { input, expectedExit = 0 } = {}) => {
    const startedAt = Date.now();
    const result = spawnSync(command, args, { cwd, env, input, encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    const receiptFile = `commands/${String(report.commands.length + 1).padStart(3, '0')}.json`;
    const receipt = { command, args, cwd, expectedExit, exit: result.status, signal: result.signal, milliseconds: Date.now() - startedAt, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.message ?? null };
    writeFileSync(path.join(evidence, receiptFile), JSON.stringify(receipt, null, 2) + '\n');
    report.commands.push({ command: path.basename(command), args, exit: result.status, expectedExit, signal: result.signal, milliseconds: receipt.milliseconds, receipt: receiptFile, stdoutSha256: sha256(receipt.stdout), stderr: receipt.stderr.slice(-2500) });
    assert.equal(result.status, expectedExit, `${path.basename(command)} ${args.join(' ')}\n${result.error ?? ''}\n${result.stderr}`);
    return result.stdout;
  };
  const check = async (name, fn) => {
    const outcome = { name, passed: false }; report.checks.push(outcome);
    await t.test(name, async () => { try { await fn(); outcome.passed = true; } catch (error) { outcome.error = error.message; throw error; } });
  };
  t.after(() => {
    report.sourcesAfter = hashes();
    report.sourceStable = JSON.stringify(report.sourcesBefore) === JSON.stringify(report.sourcesAfter);
    report.allChecksPassed = report.checks.length > 0 && report.checks.every(check => check.passed) && report.sourceStable;
    writeFileSync(path.join(evidence, 'packaging-report.json'), JSON.stringify(report, null, 2) + '\n');
    if (process.env.FOUNDRY_PACKAGING_KEEP_STAGE === '1') {
      report.retainedStage = stage;
      writeFileSync(path.join(evidence, 'packaging-report.json'), JSON.stringify(report, null, 2) + '\n');
      t.diagnostic(`Staging kept for an explicit local quality scan: ${stage}`);
    } else rmSync(stage, { recursive: true, force: true });
    t.diagnostic(`Packaging evidence: ${path.relative(root, evidence)}/packaging-report.json`);
  });
  const coverage = corpusCoverage();
  writeFileSync(path.join(evidence, 'source-coverage.json'), JSON.stringify(coverage, null, 2) + '\n');
  const pkg = json(path.join(root, 'package.json'));
  const dryOutput = run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--offline']);
  writeFileSync(path.join(evidence, 'pack-dry-run.json'), dryOutput);
  const dry = packRecord(dryOutput, pkg.name);
  report.pack = { entries: dry.files.length, compressedBytes: dry.size, unpackedBytes: dry.unpackedSize, integrity: dry.integrity };
  await check('private package excludes corpus, receipts, caches and upstream license payloads', () => {
    assert.equal(pkg.private, true);
    assert.equal(pkg.scripts?.prepack, undefined); assert.equal(pkg.scripts?.postpack, undefined);
    const forbidden = dry.files.filter(file => !publicationPath(file.path));
    report.pack.excludedPathViolations = forbidden.map(file => file.path);
    const licenseHashes = new Set(coverage.repositories.flatMap(row => row.licenseEntries.map(item => item.sha256)).filter(Boolean));
    report.pack.upstreamLicensePayloads = dry.files.filter(file => licenseHashes.has(sha256(readFileSync(path.join(root, file.path))))).map(file => file.path);
    assert.deepEqual(report.pack.upstreamLicensePayloads, []);
    assert.deepEqual(report.pack.excludedPathViolations, []);
  });
  const packedOutput = run('npm', ['pack', '--json', '--ignore-scripts', '--offline', '--pack-destination', stage]);
  writeFileSync(path.join(evidence, 'pack-actual.json'), packedOutput);
  const packed = packRecord(packedOutput, pkg.name), tarball = path.join(stage, packed.filename);
  report.tarballSha256 = sha256(readFileSync(tarball));
  copyFileSync(tarball, path.join(evidence, packed.filename));
  report.tarballPath = path.relative(root, path.join(evidence, packed.filename));
  const entries = run('tar', ['-tzf', tarball]).trim().split('\n');
  assert.ok(entries.every(file => file.startsWith('package/') && !file.split('/').includes('..')), 'Unexpected tarball path');
  run('tar', ['-xzf', tarball, '-C', stage]);
  const distribution = path.join(stage, 'package');
  report.packedFileHashes = tree(distribution).map(file => ({ path: path.relative(distribution, file), sha256: sha256(readFileSync(file)) }));
  await check('actual extracted archive matches the npm inventory and permitted source bytes', () => {
    const files = report.packedFileHashes.map(file => file.path).sort();
    assert.deepEqual(files, packed.files.map(file => file.path).sort());
    report.extractedPathViolations = files.filter(file => !publicationPath(file));
    assert.deepEqual(report.extractedPathViolations, []);
    for (const item of report.packedFileHashes) assert.equal(item.sha256, sha256(readFileSync(path.join(root, item.path))), item.path);
  });
  // No symlink payloads before the intentional dependency bridge.
  symlinkSync(path.join(root, 'node_modules'), path.join(distribution, 'node_modules'), 'dir');
  const cli = path.join(distribution, 'bin/foundry.mjs');
  await check('tarball contains actual runtime assets and exact installed dependency versions', () => {
    assert.deepEqual(packed.files.map(item => item.path).sort(), dry.files.map(item => item.path).sort());
    const required = ['src/install.mjs', 'src/mcp.mjs', 'src/http.mjs', 'src/generator.mjs', 'src/opencode-free.mjs', 'src/process.mjs', 'src/evaluation.mjs', 'schemas/workflow.schema.json', ...webFiles, ...exampleFiles, ...documentationFiles,
      ...tree(path.join(root, 'adapters')).filter(file => /\.(?:mjs|py|md|txt|in)$/.test(file) && !file.split(path.sep).includes('__pycache__')).map(file => path.relative(root, file)),
      ...[...Object.values(pkg.exports), ...Object.values(pkg.bin)].map(file => file.replace(/^\.\//, '')),
      ...['README.md'].filter(file => existsSync(path.join(root, file)))];
    for (const relative of required) assert.ok(existsSync(path.join(distribution, relative)), relative);
    report.requiredAssets = [...new Set(required)].sort();
    for (const [name, version] of Object.entries(pkg.dependencies ?? {})) assert.equal(json(path.join(root, 'node_modules', name, 'package.json')).version, version, name);
    const doctor = JSON.parse(run(process.execPath, [cli, 'doctor'], stage));
    assert.equal(doctor.source, distribution); assert.equal(doctor.supportedNode, true); assert.equal(doctor.published, false);
    report.doctor = doctor;
  });
  await check('packed CLI runs an example, verifies its artifact and initializes both adapter exports', () => {
    const workspace = path.join(stage, 'cli workspace'); mkdirSync(workspace);
    const helloFile = path.join(distribution, 'examples/hello.json');
    assert.deepEqual(JSON.parse(run(process.execPath, [cli, 'schema'], workspace)), json(path.join(distribution, 'schemas/workflow.schema.json')));
    assert.equal(JSON.parse(run(process.execPath, [cli, 'skills'], workspace)).length, report.doctor.skillCount);
    assert.ok(JSON.parse(run(process.execPath, [cli, 'capabilities'], workspace)).capabilities.some(item => item.name === 'core.artifact'));
    const prompt = run(process.execPath, [cli, 'prompt', '--task', 'Construct a local greeting workflow.', '--workspace', workspace], workspace);
    assert.ok(prompt.includes('core.artifact')); assert.ok(prompt.includes('workflowSchema'));
    assert.equal(JSON.parse(run(process.execPath, [cli, 'validate', helloFile], workspace)).valid, true);
    const name = 'portable π $(literal)';
    const execution = JSON.parse(run(process.execPath, [cli, 'run', helloFile, '--input', JSON.stringify({ name }), '--workspace', workspace], workspace));
    assert.equal(execution.status, 'succeeded');
    const artifact = readFileSync(path.join(workspace, '.foundry/artifacts', execution.id, 'greeting.txt'), 'utf8');
    assert.equal(artifact, `Hello, ${name}!`);
    assert.equal(execution.outputs.write.sha256, sha256(artifact));
    const inspection = JSON.parse(run(process.execPath, [cli, 'inspect', execution.id, '--workspace', workspace], workspace));
    assert.equal(inspection.workflowHash, execution.workflowHash);
    assert.equal(inspection.events.length, execution.events.length);
    report.cliExecution = { runId: execution.id, status: execution.status, workflowHash: execution.workflowHash, artifactSha256: sha256(artifact), eventCount: inspection.events.length };
    const suiteFile = path.join(workspace, 'packaging-suite.json');
    writeFileSync(suiteFile, JSON.stringify({ schemaVersion: '1.0', id: 'packaging-greeting', split: 'diagnostic', task: 'Write the exact requested local greeting.', cases: [{ id: 'unicode-and-literal', input: { name }, expect: { statuses: ['succeeded'], checks: [], artifacts: [{ name: 'greeting.txt', content: `Hello, ${name}!` }] } }] }));
    const evaluation = JSON.parse(run(process.execPath, [cli, 'evaluate', helloFile, '--suite', suiteFile, '--workspace', workspace], workspace));
    assert.equal(evaluation.passed, true); assert.equal(evaluation.workflowHash, execution.workflowHash);
    report.cliEvaluation = { id: evaluation.id, evaluatorId: evaluation.evaluatorId, workflowHash: evaluation.workflowHash, passed: evaluation.passed, scope: 'One diagnostic greeting case, no model performance or deployment qualification' };
    // Hand-authored export-only fixture. No Python, n8n or model execution.
    const portable = json(helloFile); portable.budget.maxConcurrency = 1; portable.nodes = [portable.nodes[0]];
    portable.nodes[0].retry = { maxAttempts: 1 };
    portable.acceptance = [{ op: 'exists', value: { $ref: 'nodes.compose.text' } }];
    const portableFile = path.join(workspace, 'portable.json'); writeFileSync(portableFile, JSON.stringify(portable));
    report.adapterExports = [];
    for (const target of ['langgraph', 'n8n']) {
      const exported = JSON.parse(run(process.execPath, [cli, 'export', portableFile, '--target', target, '--workspace', workspace], workspace));
      assert.equal(exported.supported.ready, false, 'Trusted target bindings were deliberately not supplied.');
      assert.ok(exported.files.length >= 4);
      assert.ok(exported.files.every(file => typeof file.content === 'string' && file.content.length > 0));
      report.adapterExports.push({ target, ready: exported.supported.ready, files: exported.files.map(file => file.path) });
    }
  });
  const sourceSkillFiles = tree(path.join(root, 'skills')).map(file => path.relative(path.join(root, 'skills'), file)).sort();
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const { parse: parseJsonc } = await import('jsonc-parser');
  for (const clientName of ['generic', 'opencode', 'claude', 'cursor', 'codex']) {
    const project = path.join(stage, `${clientName} project`); mkdirSync(project);
    const prefix = clientName === 'claude' ? '.claude/skills' : '.agents/skills';
    const installInfo = { client: clientName, prefix }; report.installs.push(installInfo);
    const originals = { '.gitignore': '# Preserve packaging fixture comments\n/retained-local-cache/\n', 'keep.txt': 'Unrelated temporary project content.\n' };
    if (clientName === 'opencode') originals['opencode.jsonc'] = '// Preserve existing OpenCode comment\n{"mcp":{"dummy":{"type":"local","command":["never-invoked-fixture"],"enabled":false}},"share":"disabled"}\n';
    if (clientName === 'claude') {
      originals['.mcp.json'] = '// Preserve existing Claude MCP comment\n{"mcpServers":{"dummy":{"command":"never-invoked-fixture","args":[]}}}\n';
      originals['.claude/settings.json'] = '// Preserve existing Claude hook comment\n{"hooks":{"PostToolUse":[{"matcher":"Read","hooks":[{"type":"command","command":"never-invoked-fixture"}]}]}}\n';
    }
    if (clientName === 'cursor') originals['.cursor/mcp.json'] = '// Preserve existing Cursor comment\n{"mcpServers":{"dummy":{"command":"never-invoked-fixture","args":[]}}}\n';
    if (clientName === 'codex') originals['.codex/config.toml'] = '# Preserve existing Codex comment\n[mcp_servers.dummy]\ncommand = "never-invoked-fixture"\nargs = []\n';
    for (const [relative, text] of Object.entries(originals)) { const filename = path.join(project, relative); mkdirSync(path.dirname(filename), { recursive: true }); writeFileSync(filename, text); }
    installInfo.originalFiles = Object.entries(originals).map(([relative, text]) => ({ path: relative, sha256: sha256(text) }));
    const preview = JSON.parse(run(process.execPath, [cli, 'install', '--project', project, '--client', clientName, '--dry-run'], stage));
    assert.equal(preview.dryRun, true); assert.equal(existsSync(path.join(project, prefix)), false);
    const installed = JSON.parse(run(process.execPath, [cli, 'install', '--project', project, '--client', clientName], stage));
    installInfo.changedFiles = installed.fileCount;
    const copied = tree(path.join(project, prefix)).map(file => path.relative(path.join(project, prefix), file)).sort();
    await check(`${clientName}: actual copied skill files and Markdown references`, () => {
      assert.deepEqual(copied, sourceSkillFiles);
      for (const relative of copied) assert.equal(sha256(readFileSync(path.join(project, prefix, relative))), sha256(readFileSync(path.join(root, 'skills', relative))), relative);
      installInfo.references = auditSkillReferences(path.join(project, prefix));
      assert.deepEqual(installInfo.references.failures, []);
    });
    let config, entry;
    if (clientName === 'codex') {
      const text = readFileSync(path.join(project, '.codex/config.toml'), 'utf8');
      config = { format: 'toml', text };
      const managed = text.match(/# BEGIN workflow-foundry managed MCP\n([\s\S]*?)# END workflow-foundry managed MCP/)[1];
      entry = { command: JSON.parse(managed.match(/^command = (.+)$/m)[1]), args: JSON.parse(managed.match(/^args = (.+)$/m)[1]) };
    } else {
      const filename = { generic: 'workflow-foundry.mcp.json', opencode: 'opencode.jsonc', claude: '.mcp.json', cursor: '.cursor/mcp.json' }[clientName];
      config = parseJsonc(readFileSync(path.join(project, filename), 'utf8'));
      entry = clientName === 'opencode' ? { command: config.mcp['workflow-foundry'].command[0], args: config.mcp['workflow-foundry'].command.slice(1) } : config.mcpServers['workflow-foundry'];
    }
    installInfo.config = config;
    await check(`${clientName}: existing project comments, dummy servers and advisory hooks are preserved`, () => {
      for (const [relative, original] of Object.entries(originals)) {
        const installedText = readFileSync(path.join(project, relative), 'utf8');
        assert.ok(installedText.includes(original.split('\n')[0]), relative);
        if (original.includes('never-invoked-fixture')) assert.ok(installedText.includes('never-invoked-fixture'), relative);
      }
      assert.equal(readFileSync(path.join(project, 'keep.txt'), 'utf8'), originals['keep.txt']);
      if (clientName === 'opencode') { assert.deepEqual(config.mcp.dummy, parseJsonc(originals['opencode.jsonc']).mcp.dummy); assert.equal(config.share, 'disabled'); }
      if (clientName === 'claude' || clientName === 'cursor') assert.equal(config.mcpServers.dummy.command, 'never-invoked-fixture');
      if (clientName === 'codex') assert.ok(config.text.startsWith(originals['.codex/config.toml']));
      if (clientName === 'claude') assert.deepEqual(parseJsonc(readFileSync(path.join(project, '.claude/settings.json'), 'utf8')).hooks.PostToolUse[0], parseJsonc(originals['.claude/settings.json']).hooks.PostToolUse[0]);
    });
    await check(`${clientName}: generated configuration launches the packed MCP and reads every skill Markdown`, async () => {
      assert.equal(entry.command, process.execPath); assert.deepEqual(entry.args, [cli, 'mcp', '--workspace', project]);
      const transport = new StdioClientTransport({ command: entry.command, args: entry.args, cwd: project, env, stderr: 'pipe' });
      const client = new Client({ name: 'foundry-packaging-test', version: '1.0.0' });
      let stderr = ''; transport.stderr?.on('data', data => { stderr = (stderr + data.toString()).slice(-2500); });
      try {
        await client.connect(transport, { timeout: 5000 });
        const tools = await client.listTools({}, { timeout: 5000 });
        installInfo.toolNames = tools.tools.map(tool => tool.name);
        assert.ok(installInfo.toolNames.includes('foundry_read_skill'));
        assert.ok(!installInfo.toolNames.some(name => /approve|answer|shell|spawn|exec/.test(name)));
        const catalog = await client.callTool({ name: 'foundry_skills', arguments: {} }, undefined, { timeout: 5000 });
        assert.notEqual(catalog.isError, true); const skills = JSON.parse(catalog.content[0].text);
        assert.equal(skills.length, sourceSkillFiles.filter(file => file.endsWith('/SKILL.md')).length);
        installInfo.mcpMarkdownReads = 0;
        for (const relative of copied.filter(file => file.endsWith('.md'))) {
          const [name, ...parts] = relative.split(path.sep);
          const result = await client.callTool({ name: 'foundry_read_skill', arguments: { name, reference: parts.join('/') } }, undefined, { timeout: 5000 });
          assert.notEqual(result.isError, true, relative);
          assert.equal(JSON.parse(result.content[0].text).sha256, sha256(readFileSync(path.join(project, prefix, relative))), relative);
          installInfo.mcpMarkdownReads++;
        }
        const schema = await client.readResource({ uri: 'foundry://schema/workflow' }, { timeout: 5000 });
        assert.equal(JSON.parse(schema.contents[0].text).title, json(path.join(distribution, 'schemas/workflow.schema.json')).title);
        const calls = [];
        const call = async (name, args) => {
          const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 5000 });
          calls.push({ name, arguments: args, response: result });
          writeFileSync(path.join(evidence, `${clientName}-mcp-execution.json`), JSON.stringify(calls, null, 2) + '\n');
          assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(result)}`);
          return JSON.parse(result.content[0].text);
        };
        const workflow = json(path.join(distribution, 'examples/hello.json'));
        const validated = await call('foundry_validate', { workflow }); assert.equal(validated.valid, true);
        const saved = await call('foundry_save', { workflow }); assert.equal(saved.hash, validated.hash);
        const name = `${clientName} π $(literal)`;
        const execution = await call('foundry_run', { workflowId: workflow.id, input: { name } });
        assert.equal(execution.status, 'succeeded'); assert.equal(execution.workflowHash, saved.hash);
        const inspected = await call('foundry_inspect', { runId: execution.id });
        assert.ok(inspected.events.length > 0); assert.equal(inspected.independentTaskVerified, false);
        const artifact = readFileSync(path.join(project, '.foundry/artifacts', execution.id, 'greeting.txt'), 'utf8');
        assert.equal(artifact, `Hello, ${name}!`); assert.equal(execution.outputs.write.sha256, sha256(artifact));
        installInfo.execution = { runId: execution.id, status: execution.status, workflowHash: saved.hash, artifactSha256: sha256(artifact), eventCount: inspected.events.length, receipt: `${clientName}-mcp-execution.json` };
        const unknown = await client.callTool({ name: 'foundry_shell', arguments: { command: 'never-invoked-fixture' } }, undefined, { timeout: 5000 });
        assert.equal(unknown.isError, true); assert.equal(JSON.parse(unknown.content[0].text).error.code, 'UNKNOWN_TOOL');
      } finally { await client.close(); installInfo.mcpStderr = stderr; }
    });
    await check(`${clientName}: installer is idempotent and rollback restores only installed files`, () => {
      const again = JSON.parse(run(process.execPath, [cli, 'install', '--project', project, '--client', clientName, '--dry-run'], stage));
      assert.deepEqual(again.changes, []);
      const repeated = JSON.parse(run(process.execPath, [cli, 'install', '--project', project, '--client', clientName], stage));
      assert.equal(repeated.fileCount, 0);
      assert.equal(JSON.parse(run(process.execPath, [cli, 'uninstall', repeated.id, '--project', project], stage)).restoredFiles, 0);
      if (clientName === 'opencode') {
        const hook = readFileSync(path.join(project, '.opencode/plugins/workflow-foundry.js'), 'utf8');
        assert.ok(hook.includes('src/hooks.mjs')); assert.ok(hook.includes('tool.execute.after'));
      }
      if (clientName === 'claude') {
        const settings = parseJsonc(readFileSync(path.join(project, '.claude/settings.json'), 'utf8'));
        assert.equal(settings.hooks.PostToolUse.at(-1).matcher, 'Write|Edit');
        assert.ok(settings.hooks.PostToolUse.at(-1).hooks[0].command.includes(cli));
      }
      const undo = JSON.parse(run(process.execPath, [cli, 'uninstall', installed.id, '--project', project], stage));
      assert.equal(undo.uninstalled, true);
      assert.equal(tree(path.join(project, prefix)).length, 0);
      for (const [relative, text] of Object.entries(originals)) assert.equal(readFileSync(path.join(project, relative), 'utf8'), text, relative);
      installInfo.originalFilesRestored = true;
    });
  }
  await check('packed installer rejects conflicting configs and symlink ancestors without partial writes', () => {
    const conflicting = path.join(stage, 'conflicting generic project'); mkdirSync(conflicting);
    const filename = path.join(conflicting, 'workflow-foundry.mcp.json');
    const original = '{"mcpServers":{"dummy":{"command":"never-invoked-fixture"}}}\n'; writeFileSync(filename, original);
    run(process.execPath, [cli, 'install', '--project', conflicting, '--client', 'generic'], stage, { expectedExit: 1 });
    assert.match(report.commands.at(-1).stderr, /INSTALL_CONFLICT/);
    assert.equal(readFileSync(filename, 'utf8'), original);
    assert.equal(existsSync(path.join(conflicting, '.agents')), false);
    const linked = path.join(stage, 'symlink cursor project'), target = path.join(stage, 'synthetic symlink target');
    mkdirSync(linked); mkdirSync(target);
    const marker = path.join(target, 'keep.txt'); writeFileSync(marker, 'original synthetic bytes');
    symlinkSync(target, path.join(linked, '.cursor'), 'dir');
    run(process.execPath, [cli, 'install', '--project', linked, '--client', 'cursor'], stage, { expectedExit: 1 });
    assert.match(report.commands.at(-1).stderr, /INSTALL_SYMLINK/);
    assert.equal(readFileSync(marker, 'utf8'), 'original synthetic bytes');
    assert.deepEqual(readdirSync(target), ['keep.txt']);
    assert.equal(existsSync(path.join(linked, '.agents')), false);
    report.installerNegativeControls = { configConflict: 'rejected-without-writes', symlinkAncestor: 'rejected-without-writes' };
  });
  await check('packed uninstall preserves user edits on conflict and then restores the original installation', () => {
    const project = path.join(stage, 'uninstall conflict project'); mkdirSync(project);
    const installed = JSON.parse(run(process.execPath, [cli, 'install', '--project', project, '--client', 'generic'], stage));
    const skills = path.join(project, '.agents/skills'), files = tree(skills);
    const original = readFileSync(files[0], 'utf8'), edited = `${original}\nTemporary user-edit conflict fixture.\n`;
    writeFileSync(files[0], edited);
    const before = files.map(file => sha256(readFileSync(file)));
    run(process.execPath, [cli, 'uninstall', installed.id, '--project', project], stage, { expectedExit: 1 });
    assert.match(report.commands.at(-1).stderr, /UNINSTALL_CONFLICT/);
    assert.deepEqual(files.map(file => sha256(readFileSync(file))), before);
    assert.equal(readFileSync(files[0], 'utf8'), edited);
    // Undo only this test's temporary edit, then exercise the normal rollback.
    writeFileSync(files[0], original);
    assert.equal(JSON.parse(run(process.execPath, [cli, 'uninstall', installed.id, '--project', project], stage)).uninstalled, true);
    assert.equal(tree(skills).length, 0);
    report.installerNegativeControls.uninstallConflict = 'preserved-all-installed-bytes';
  });
  await check('source files remained stable during package/install verification', () => assert.deepEqual(hashes(), report.sourcesBefore));
});
