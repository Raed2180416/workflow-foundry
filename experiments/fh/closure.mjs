// FH-1 freeze closure (review finding m4; $0; written after the result). FREEZE.json hashed 34 named files; the code those
// files import, and the files the session workdirs and the worlds are built from at run time, were not in it. This computes the
// full closure: every relative ESM import reachable from the frozen entry points, plus the data files read at run time (session
// workdir files, the policy, the build arms' kit and templates, the bed), and attests at $0 that none of them changed between the
// freeze commit and a later commit (git), so the FH-1 runs used exactly the frozen closure. A future preregistration should freeze
// `closureFiles()` itself (FREEZE.json lists the frozen set; this file does not change it).
//   node experiments/fh/closure.mjs [--from 38e42fb7] [--to HEAD] [--out research/heal-20261021/fh1/FREEZE-CLOSURE.json]
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ENTRY = Object.freeze(['grade', 'baseline', 'heal', 'analyse', 'ensemble', 'freeze', 'baseline-table'].map(f => `experiments/fh/${f}.mjs`));
// Read at run time with readFileSync / readdirSync (not imports): the session workdir (composedBuildFiles, buildFiles, CLIENT),
// the policy, and the recorded programs under test.
export const RUNTIME_READS = Object.freeze(['policy/models.json', 'experiments/compose/builder/COMPOSE.md', 'experiments/compose/kit', 'experiments/compose/builder/templates',
  'research/enterprise-20261014/BED-CONTRACT-v1.1.md', 'beds/ebed/host/README.md', 'research/composition-20261021/runs/ch-e8-1/program', 'research/composition-20261021/runs/ch-e8-2/program',
  'research/composition-20261021/runs/ch-e8-3/program', 'research/composition-20261021/runs/cht-e8-1/program', 'research/composition-20261021/runs/cht-e8-2/program',
  'research/composition-20261021/runs/cht-e8-3/program', 'research/enterprise-20261014/runs/b1lh-e8-1/solver.mjs', 'research/enterprise-20261014/runs/b1lh-e8-2/solver.mjs',
  'research/enterprise-20261014/runs/b1lh-e8-3/solver.mjs', 'research/enterprise-20261014/runs/b1nh-e8-2/solver.mjs', 'research/enterprise-20261014/runs/b1nh-e8-3/solver.mjs']);

const IMPORT = /(?:^|[\s;])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm;
/** Relative import specifiers of one ESM source (static imports, re-exports and literal dynamic imports). */
export function importsOf(text) {
  const out = [];
  for (const m of text.matchAll(IMPORT)) { const s = m[1] ?? m[2] ?? m[3]; if (s && (s.startsWith('./') || s.startsWith('../'))) out.push(s); }
  return out;
}

/** Every repo file reachable from `entries` by relative imports. */
export function importClosure(entries = ENTRY, root = ROOT) {
  const seen = new Set(), stack = [...entries];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    const abs = path.join(root, f);
    if (!existsSync(abs)) continue;
    seen.add(f);
    for (const s of importsOf(readFileSync(abs, 'utf8'))) stack.push(path.relative(root, path.resolve(path.dirname(abs), s)));
  }
  return [...seen].sort();
}

const walk = (root, rel) => { const abs = path.join(root, rel); if (!existsSync(abs)) return []; if (!statSync(abs).isDirectory()) return [rel];
  return readdirSync(abs).sort().flatMap(n => walk(root, path.join(rel, n))); };

export function closureFiles(root = ROOT) {
  const files = new Set(importClosure(ENTRY, root));
  for (const r of RUNTIME_READS) for (const f of walk(root, r)) files.add(f);
  // the bed the worlds and the oracle come from (the bed digest covers e8, oracle, host and lib; the closure adds what they import)
  for (const f of importClosure([...files].filter(f => f.endsWith('.mjs')), root)) files.add(f);
  return [...files].filter(f => !f.includes('/test/') && !f.endsWith('.test.mjs')).sort();
}

const sha = b => createHash('sha256').update(b).digest('hex');
// FREEZE.json's bed digest (grade.mjs bedDigest) covers every .mjs/.md/.json under these directories except test/.
const inBed = f => ['beds/ebed/e8/', 'beds/ebed/oracle/', 'beds/ebed/host/', 'beds/ebed/lib/'].some(d => f.startsWith(d)) && /\.(mjs|md|json)$/.test(f);
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const from = arg('--from', '38e42fb7'), to = arg('--to', 'HEAD');
  const files = closureFiles();
  const frozen = Object.keys(JSON.parse(readFileSync(path.join(ROOT, 'research/heal-20261021/fh1/FREEZE.json'), 'utf8')).files);
  const changed = execFileSync('git', ['diff', '--name-only', from, to, '--', ...files], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const res = { schema: 'fh1-freeze-closure/1', at: new Date().toISOString(), from: execFileSync('git', ['rev-parse', from], { cwd: ROOT, encoding: 'utf8' }).trim(), to: execFileSync('git', ['rev-parse', to], { cwd: ROOT, encoding: 'utf8' }).trim(),
    entries: ENTRY, files: files.length, inFreeze: files.filter(f => frozen.includes(f)).length,
    inBedDigest: files.filter(f => !frozen.includes(f) && inBed(f)).length, uncovered: files.filter(f => !frozen.includes(f) && !inBed(f)),
    changedBetween: changed, unchanged: changed.length === 0, sha256: Object.fromEntries(files.map(f => [f, sha(readFileSync(path.join(ROOT, f)))])) };
  const out = arg('--out', null);
  if (out) writeFileSync(out, JSON.stringify(res, null, 1) + '\n');
  console.log(JSON.stringify({ from: res.from, to: res.to, files: res.files, inFreeze: res.inFreeze, inBedDigest: res.inBedDigest, uncovered: res.uncovered.length, changedBetween: res.changedBetween, unchanged: res.unchanged }, null, 1));
}
