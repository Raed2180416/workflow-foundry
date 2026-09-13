import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const readJSON = file => JSON.parse(readFileSync(file, 'utf8'));
export const writeJSON = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });

function entries(root, relative) {
  const file = path.join(root, relative), stat = lstatSync(file);
  if (stat.isDirectory()) return readdirSync(file).sort().flatMap(name => entries(root, path.join(relative, name)));
  if (stat.isSymbolicLink()) {
    const link = readlinkSync(file), target = realpathSync(file);
    if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error(`Snapshot input symlink escapes its root: ${relative}`);
    return [{ path: relative, kind: 'symlink', link }];
  }
  if (!stat.isFile()) throw new Error(`Unsupported snapshot input: ${relative}`);
  return [{ path: relative, kind: 'file', bytes: stat.size, sha256: sha256(readFileSync(file)) }];
}

/** Verify only declared executable/input closure; unrelated research may evolve. */
export function verifyClosure(root, manifest, { external = false } = {}) {
  const changed = [];
  for (const item of manifest.files) {
    const file = path.join(root, item.path);
    try {
      const stat = lstatSync(file);
      const equal = item.kind === 'symlink'
        ? stat.isSymbolicLink() && readlinkSync(file) === item.link
        : stat.isFile() && stat.size === item.bytes && sha256(readFileSync(file)) === item.sha256;
      if (!equal) changed.push(item.path);
    } catch { changed.push(item.path); }
  }
  if (external) for (const item of manifest.executables) {
    try { if (sha256(readFileSync(item.path)) !== item.sha256) changed.push(item.path); }
    catch { changed.push(item.path); }
  }
  return { verified: changed.length === 0, checkedFiles: manifest.files.length, checkedExecutables: external ? manifest.executables.length : 0, changed };
}

export function revisionSuite(original) {
  const suite = structuredClone(original);
  suite.id = 'batch-summary-with-totals-diagnostic-v2';
  suite.task += ' Also include batchTotals, preserving each input batch order, in summary.json.';
  for (const item of suite.cases) {
    const artifact = item.expect.artifacts?.find(entry => entry.name === 'summary.json' && entry.json);
    if (artifact) artifact.json.batchTotals = item.input.batches.map(batch => batch.reduce((total, value) => total + value, 0));
  }
  return suite;
}

export function freezeDemo(root) {
  const runs = path.join(root, 'research/product-demo/runs');
  mkdirSync(runs, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(path.join(runs, `${new Date().toISOString().replace(/[:.]/g, '-')}-`));
  const snapshot = path.join(directory, 'snapshot');
  mkdirSync(snapshot, { mode: 0o700 });
  const selection = ['AGENTS.md', 'package.json', 'package-lock.json', 'bin', 'src', 'schemas', 'skills', 'adapters', 'node_modules', 'examples', 'web/app.js', 'web/index.html', 'web/style.css', 'tests/ui-browser.test.mjs', 'tests/ui-contract.test.mjs', 'tests/ui-live-contract.test.mjs', 'docs/ARCHITECTURE.md', 'docs/PRODUCT-DEMO-PROTOCOL.md', 'research/product-demo/freeze.mjs', 'research/product-demo/contract.mjs', 'research/product-demo/offline-fixtures.mjs', 'research/product-demo/run.mjs'];
  const files = selection.flatMap(relative => entries(root, relative)).sort((a, b) => a.path.localeCompare(b.path));
  const executables = [...new Set([process.execPath, '/usr/bin/opencode', '/usr/bin/bwrap', '/usr/bin/chromium', '/usr/lib/chromium/chromium'].filter(file => existsSync(file)).map(file => realpathSync(file)))]
    .map(file => ({ path: file, bytes: lstatSync(file).size, sha256: sha256(readFileSync(file)) }));
  const manifest = { schemaVersion: 1, kind: 'diagnostic browser product demonstration', createdAt: new Date().toISOString(), originalRoot: root, snapshot, selection, files, executables, node: process.version, versions: process.versions, platform: process.platform, arch: process.arch,
    scope: 'Copied JS/JSON/skills/web/dependency bytes; installed Node/OpenCode/bubblewrap/Chromium binaries checked before model dispatch and after completion. OS shared libraries and remote provider weights are observed environment, not copied or frozen.',
    closureSHA256: sha256(JSON.stringify({ files, executables })) };
  for (const relative of selection) {
    mkdirSync(path.dirname(path.join(snapshot, relative)), { recursive: true });
    cpSync(path.join(root, relative), path.join(snapshot, relative), { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false });
  }
  const initial = readJSON(path.join(snapshot, 'examples/batch-suite.json'));
  const revised = revisionSuite(initial);
  const initialText = readFileSync(path.join(snapshot, 'examples/batch-task.md'), 'utf8');
  const revisionText = 'Add an ordered batchTotals array to summary.json, containing the sum of each input batch in the original input order. Keep batchCount and grandTotal, preserve every input bound and malformed-input rejection, and retain maxSteps 150, maxConcurrency 2, maxDurationMs 60000, maxCost 0. Create the next version without migrating or altering existing runs. Use the actual native output contracts and independently check the new artifact contents.';
  const inputs = { initialSuite: initial, revisionSuite: revised, initialText, revisionText,
    initialRunInput: { batches: [[2, 5.5], [-3], []] }, initialRunExpected: { batchCount: 3, grandTotal: 4.5 },
    revisionRunInput: { batches: [[-2, 1], [7]] }, revisionRunExpected: { batchCount: 2, grandTotal: 6, batchTotals: [-1, 7] },
    model: 'opencode/ling-3.0-flash-fin-free', maxCallsPerStage: 3, maxDurationMsPerStage: 300000,
    assistance: 'Fresh initial natural-language task; no historical candidates in the prompt. Repair feedback comes only from this generator and the fixed diagnostic evaluator.',
    experiment: 'Actual browser UI and isolated noninteractive OpenCode transport. Separate from actual-TUI campaign; diagnostic, not held out.' };
  writeJSON(path.join(directory, 'inputs.json'), inputs);
  writeJSON(path.join(directory, 'initial-suite.json'), initial);
  writeJSON(path.join(directory, 'revision-suite.json'), revised);
  manifest.inputsSHA256 = sha256(readFileSync(path.join(directory, 'inputs.json')));
  manifest.sourceAtCopy = verifyClosure(root, manifest, { external: true });
  manifest.snapshotAtCopy = verifyClosure(snapshot, manifest);
  writeJSON(path.join(directory, 'closure.json'), manifest);
  if (!manifest.sourceAtCopy.verified || !manifest.snapshotAtCopy.verified) throw new Error(`Source changed during freeze; preserved rejected snapshot at ${directory}`);
  return { directory, snapshot, closureSHA256: manifest.closureSHA256, files: files.length, inputsSHA256: manifest.inputsSHA256 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  console.log(JSON.stringify(freezeDemo(root), null, 2));
}
