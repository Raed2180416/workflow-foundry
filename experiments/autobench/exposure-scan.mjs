#!/usr/bin/env node
// Test-split exposure scan (PREREG-AB-v1 §1.3, §8; added by the 2026-10-15 integrity review). No model, $0.
//
// Lists every file under the given roots that names a test-split task, with the number of distinct test names in it.
// A file naming (nearly) all of them is a listing (names only); a file naming a few is TARGETED: something looked at
// those tasks, and each needs a review (EXPOSURE-20261015.json is the worked example). It prints file names and counts
// only, never task text. The freeze scan covered the repository and /var/tmp/foundry-work; agent transcripts
// (~/.claude/projects) and session scratchpads are where the 2026-10-15 exposure was found, so they are default roots.
//
//   node experiments/autobench/exposure-scan.mjs [--roots a,b,...] [--listing-min 250] [--json]
// Exit code 1 when a targeted file is found that is not covered by a recorded EXPOSURE-*.json.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO } from './lib.mjs';
import { loadSplit } from './split.mjs';

const RESEARCH = path.join(REPO, 'research/automationbench-20261014');
/** Default roots: the repository, the live run directories, this project's agent transcripts. */
export function defaultRoots(home = os.homedir()) {
  const projects = path.join(home, '.claude/projects');
  const mine = existsSync(projects) ? readdirSync(projects).filter(d => d.includes('workflow-foundry')).map(d => path.join(projects, d)) : [];
  return [REPO, '/var/tmp/foundry-work', ...mine].filter(p => existsSync(p));
}
// Never opened: the corpus (it holds every task), git objects, the sealed beds, credentials-like files, the split itself.
const EXCLUDE_DIRS = ['.git', 'corpus', 'sealed', 'node_modules'];
const EXCLUDE_FILES = ['.env*', '*credential*', 'SPLIT-v1.json', 'EXPOSURE-*.json'];

export function scan({ roots = defaultRoots(), names = loadSplit().test, listingMin = 250 } = {}) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'ab-exposure-'));
  const pat = path.join(tmp, 'names.txt');
  writeFileSync(pat, names.join('\n') + '\n');
  const args = ['-rlF', '-f', pat, ...EXCLUDE_DIRS.map(d => `--exclude-dir=${d}`), ...EXCLUDE_FILES.map(f => `--exclude=${f}`), '--', ...roots];
  const r = spawnSync('nice', ['-n', '19', 'grep', ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const files = r.stdout.split('\n').filter(Boolean);
  const rows = files.map(f => {
    let text = '';
    try { text = readFileSync(f, 'utf8'); } catch { return { file: f, testNames: null }; }
    const n = names.filter(x => text.includes(x)).length;
    return { file: f, testNames: n, kind: n >= listingMin ? 'listing' : 'targeted' };
  }).sort((a, b) => (a.kind === b.kind ? b.testNames - a.testNames : a.kind === 'targeted' ? -1 : 1));
  // Files already reviewed in a recorded exposure (matched by their last two path components).
  const recorded = existsSync(RESEARCH) ? readdirSync(RESEARCH).filter(f => /^EXPOSURE-.*\.json$/.test(f)).map(f => readFileSync(path.join(RESEARCH, f), 'utf8')) : [];
  for (const row of rows) row.recorded = recorded.some(t => t.includes(row.file.split(path.sep).slice(-2).join('/')));
  return { roots, testNames: names.length, files: rows.length, targeted: rows.filter(x => x.kind === 'targeted'), listings: rows.filter(x => x.kind === 'listing').length, rows };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const a = Object.fromEntries(argv.map((x, i) => (x.startsWith('--') ? [x.slice(2), argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true] : null)).filter(Boolean));
  const r = scan({ roots: a.roots ? String(a.roots).split(',') : undefined, listingMin: Number(a['listing-min'] ?? 250) });
  if (a.json) process.stdout.write(JSON.stringify(r, null, 1) + '\n');
  else {
    console.log(`roots: ${r.roots.join(', ')}\n${r.files} file(s) name test-split tasks: ${r.listings} listing(s), ${r.targeted.length} targeted`);
    for (const t of r.targeted) console.log(`  targeted ${String(t.testNames).padStart(3)} ${t.recorded ? '(recorded)' : '(NOT RECORDED)'} ${t.file}`);
  }
  if (r.targeted.some(t => !t.recorded)) process.exitCode = 1;
}
