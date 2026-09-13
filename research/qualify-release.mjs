#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';

// Reproducible LOCAL qualification. No model/provider request, registry fallback,
// publishing or global installation. Test fixtures explicitly exercise actual
// stdio/HTTP/Chromium and the restricted LangGraph adapter where installed.
const root = path.resolve(import.meta.dirname, '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const base = path.join(root, '.foundry/release-qualification'); mkdirSync(base, { recursive: true });
const directory = mkdtempSync(path.join(base, 'candidate-'));
const write = (name, value) => writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
function inventory() {
  const command = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  if (command.status !== 0) throw new Error(`Cannot inventory source: ${command.stderr}`);
  return Object.fromEntries([...new Set(command.stdout.split('\0').filter(Boolean))].sort().map(file => {
    const target = path.join(root, file), stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unexpected source file type: ${file}`);
    return [file, sha(readFileSync(target))];
  }));
}
const report = { scope: 'Current source and explicit local integration controls; not new model results or universal deployment qualification', startedAt: new Date().toISOString(), node: process.version, modelCalls: 0, directory, commands: [] };
const before = inventory(); write('source-before.json', before);
const env = { ...process.env, FOUNDRY_PACKAGING_E2E: '1', FOUNDRY_MCP_REPAIR_AUDIT: '1', FOUNDRY_UI_E2E: '1', FOUNDRY_UI_TRIALS_E2E: '1', FOUNDRY_UI_ARTIFACTS: path.join(directory, 'browser'), NODE_NO_WARNINGS: '1' };
function run(label, program, args, timeout = 240000) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(program, args, { cwd: root, env, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(path.join(directory, `${label}.stdout.txt`), result.stdout ?? '', { flag: 'wx', mode: 0o600 });
  writeFileSync(path.join(directory, `${label}.stderr.txt`), result.stderr ?? '', { flag: 'wx', mode: 0o600 });
  const record = { label, program, args, startedAt, finishedAt: new Date().toISOString(), exit: result.status, signal: result.signal, error: result.error?.message ?? null, stdoutSHA256: sha(result.stdout ?? ''), stderrSHA256: sha(result.stderr ?? '') };
  report.commands.push(record); write(`${label}.command.json`, record);
  return result;
}
try {
  const testFiles = Object.keys(before).filter(file => /^tests\/[^/]+\.test\.mjs$/.test(file));
  const suite = run('complete-suite', process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', ...testFiles]);
  report.testCounts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => [key, Number(suite.stdout?.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? NaN)]));
  const counts = Object.values(report.testCounts);
  if (suite.status !== 0 || counts.some(value => !Number.isFinite(value)) || report.testCounts.fail || report.testCounts.cancelled || report.testCounts.skipped || report.testCounts.todo) throw new Error('All-opt-in suite did not completely pass; preserve its exact output before any repair');
  const fresh = run('fresh-install', process.execPath, ['research/qualify-fresh-install.mjs']);
  if (fresh.status !== 0) throw new Error('Fresh offline dependency installation did not qualify; no online retry');
  report.freshInstall = JSON.parse(fresh.stdout.trim());
  if (report.freshInstall.passed !== true) throw new Error('Fresh installed package receipt is not passing');
  const provenance = run('protocol-source-evidence', process.execPath, ['research/verify-protocol-adapter-evidence.mjs']);
  if (provenance.status !== 0) throw new Error('Pinned protocol source evidence no longer matches its declared identities');
  const doctor = run('doctor', process.execPath, ['bin/foundry.mjs', 'doctor'], 15000);
  if (doctor.status !== 0) throw new Error('CLI doctor failed');
  report.passed = true;
} catch (error) { report.passed = false; report.error = error.message; }
finally {
  const after = inventory(); write('source-after.json', after);
  report.sourceChanged = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file]);
  report.sourceIdentity = sha(JSON.stringify(before)); report.sourceFileCount = Object.keys(before).length;
  report.sourceStable = report.sourceChanged.length === 0; report.passed = report.passed && report.sourceStable;
  report.finishedAt = new Date().toISOString(); write('report.json', report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
