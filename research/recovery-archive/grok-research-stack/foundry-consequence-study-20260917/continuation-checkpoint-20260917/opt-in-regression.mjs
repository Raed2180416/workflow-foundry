import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyFreeze } from '../benchmark/oracle-v2.mjs';

// The original opt-in test sources are unchanged. These are local synthetic
// integration controls, not model construction, upstream app use or publication.
const root = path.dirname(fileURLToPath(import.meta.url)), repo = '/home/raed/Projects/workflow-foundry';
const sha = value => createHash('sha256').update(value).digest('hex');
const testFiles = ['mcp-repair-lifecycle-audit', 'packaging', 'ui-browser', 'ui-trials-browser'].map(name => `tests/${name}.test.mjs`);
const files = ['bin/foundry.mjs', 'package.json', 'package-lock.json', ...testFiles,
  ...['src', 'web'].flatMap(dir => readdirSync(path.join(repo, dir)).filter(name => /\.(mjs|js|html|css)$/.test(name)).map(name => `${dir}/${name}`))];
const snapshot = () => Object.fromEntries(files.map(file => [file, sha(readFileSync(path.join(repo, file)))]));
const before = snapshot(); verifyFreeze();
assert.ok(existsSync('/usr/bin/chromium')); assert.ok(existsSync('/usr/bin/bwrap'));
const artifacts = path.join(root, 'opt-in-browser-artifacts'); mkdirSync(artifacts, { mode: 0o700 });
const args = ['--test', '--test-reporter=tap', '--test-concurrency=1', ...testFiles];
const start = Date.now();
const result = spawnSync(process.execPath, args, { cwd: repo, encoding: 'utf8', timeout: 480000,
  maxBuffer: 16 * 1024 * 1024, env: { ...process.env, FOUNDRY_MCP_REPAIR_AUDIT: '1', FOUNDRY_PACKAGING_E2E: '1',
    FOUNDRY_UI_E2E: '1', FOUNDRY_UI_TRIALS_E2E: '1', FOUNDRY_UI_ARTIFACTS: artifacts } });
writeFileSync(path.join(root, 'OPT_IN_REGRESSION.stdout'), result.stdout, { flag: 'wx', mode: 0o600 });
writeFileSync(path.join(root, 'OPT_IN_REGRESSION.stderr'), result.stderr, { flag: 'wx', mode: 0o600 });
const counts = Object.fromEntries([...result.stdout.matchAll(/^# (tests|pass|fail|skipped|cancelled) (\d+)/gm)].map(m => [m[1], Number(m[2])]));
const after = snapshot(), changed = files.filter(file => before[file] !== after[file]);
const passed = result.status === 0 && counts.fail === 0 && counts.skipped === 0 && counts.tests > 0 && changed.length === 0;
const report = { passed, at: new Date().toISOString(), command: [process.execPath, ...args], exitCode: result.status,
  signal: result.signal, error: result.error?.message ?? null, elapsedMs: Date.now() - start, counts,
  stdoutSHA256: sha(result.stdout), stderrSHA256: sha(result.stderr), sourceBefore: before, sourceAfter: after,
  changedDuringVerification: changed, modelCalls: 0, publicRelease: false,
  scope: 'Existing opt-in suites: actual local MCP stdio, local tarball/project installation using existing pinned dependencies, and real Chromium/local HTTP. Scripted workflow/provider controls; not real-model generation or upstream client qualification.',
  browserArtifacts: artifacts };
writeFileSync(path.join(root, 'OPT_IN_REGRESSION.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
verifyFreeze(); console.log(JSON.stringify({ ...report, sourceBefore: undefined, sourceAfter: undefined }, null, 2));
assert.ok(passed, 'Opt-in integration failed; preserve and inspect the original outputs');
