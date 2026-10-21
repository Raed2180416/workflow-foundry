#!/usr/bin/env node
// BUILDER-1 freeze manifest: sha256 of every file that decides a result (the cases and their oracle, the simulated person, the metric
// formulas, the runner, both builders and their prompts, the templates, the capabilities, the policy). `--write` writes
// research/surface-20261021/eval/MANIFEST.json; `--check` (default) recomputes and reports any file that changed since the freeze.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(root, 'research/surface-20261021/eval/MANIFEST.json');
export const FROZEN = [
  'research/surface-20261021/eval/cases.json',
  'experiments/surface/oracle.mjs', 'experiments/surface/person.mjs', 'experiments/surface/metrics.mjs', 'experiments/surface/run-builder-eval.mjs', 'experiments/surface/b0.mjs',
  'experiments/surface/test/oracle-validity.test.mjs', 'experiments/surface/test/harness.test.mjs',
  'app/core/builder-model.mjs', 'app/core/library.mjs', 'app/core/practice.mjs', 'app/core/stand-ins.mjs', 'app/core/capabilities.mjs', 'app/core/explain.mjs',
  ...readdirSync(path.join(root, 'app/core/templates')).filter(f => f.endsWith('.json')).sort().map(f => `app/core/templates/${f}`),
  'experiments/lib/models.mjs', 'policy/models.json'
];
const sha = rel => createHash('sha256').update(readFileSync(path.join(root, rel))).digest('hex');
const git = args => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; } };

export function manifest() {
  return { schema: 'builder-1-manifest/1', frozenAt: new Date().toISOString(), gitHead: git(['rev-parse', 'HEAD']),
    srcUncommittedChanges: git(['status', '--porcelain', '--', 'src']) || 'none', claudeCli: git(['--version']) && (() => { try { return execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(); } catch { return null; } })(),
    node: process.versions.node, files: Object.fromEntries(FROZEN.map(f => [f, sha(f)])) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) {
    writeFileSync(OUT, `${JSON.stringify(manifest(), null, 1)}\n`);
    process.stdout.write(`${createHash('sha256').update(readFileSync(OUT)).digest('hex')}  ${path.relative(root, OUT)}\n`);
  } else {
    const frozen = JSON.parse(readFileSync(OUT, 'utf8')), changed = Object.entries(frozen.files).filter(([f, h]) => sha(f) !== h).map(([f]) => f);
    process.stdout.write(changed.length ? `CHANGED since the freeze: ${changed.join(', ')}\n` : `all ${Object.keys(frozen.files).length} frozen files unchanged\n`);
    process.exitCode = changed.length ? 1 : 0;
  }
}
