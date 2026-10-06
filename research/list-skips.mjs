#!/usr/bin/env node
// Lists every skipped test and the reason it recorded.
//
//   node research/list-skips.mjs [--json | --markdown] [tests/a.test.mjs ...]
//
// Runs `node --test --test-reporter=tap` once per test file (default:
// tests/*.test.mjs), two files at a time, so every result is attributed to its
// file. Parses `# SKIP <reason>` directives (including nested subtests) and the
// TAP summary counts, then prints a JSON report and a markdown table.
// Exit status: 0 when every skip carries a reason, 1 when any skip lacks one,
// 2 when a file produced no parsable TAP summary (the harness itself failed).
// Test failures are reported in the counts but do not change the exit status;
// `npm test` is the pass/fail authority. The environment is inherited, so
// opt-in lanes (FOUNDRY_PACKAGING_E2E=1 ...) behave exactly as under npm test.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const format = args.includes('--json') ? 'json' : args.includes('--markdown') ? 'markdown' : 'both';
const requested = args.filter(arg => !arg.startsWith('--'));
const files = (requested.length ? requested.map(file => path.relative(root, path.resolve(file)))
  : readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.test.mjs')).sort().map(name => `tests/${name}`));
const CONCURRENCY = 2;
const FILE_TIMEOUT_MS = 20 * 60 * 1000;

// node's TAP reporter writes control characters as \n, \t ... and then doubles
// every backslash and escapes '#'. Undo only the last two steps; a written
// control character stays visible as \n rather than being guessed back.
const unescape = text => text.replace(/\\([\\#])/g, '$1');

function parseTap(tap, file) {
  const skips = [], counts = {}, stack = [];
  for (const line of tap.split(/\r?\n/)) {
    const subtest = /^( *)# Subtest: (.*)$/.exec(line);
    if (subtest) { const depth = subtest[1].length / 4; stack.length = depth; stack[depth] = unescape(subtest[2]); continue; }
    const result = /^( *)(ok|not ok) \d+ - ((?:\\.|[^\\#])*?)(?: # (SKIP|TODO)\b ?(.*))?$/i.exec(line);
    if (result) {
      const depth = result[1].length / 4;
      if (result[4]?.toUpperCase() === 'SKIP') {
        const reason = unescape(result[5] ?? '').trim();
        skips.push({ file, test: [...stack.slice(0, depth), unescape(result[3])].join(' > '), reason: reason || null });
      }
      stack.length = depth;
      continue;
    }
    const count = /^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line);
    if (count) counts[count[1]] = Number(count[2]);
  }
  return { skips, counts };
}

function runFile(file) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', file], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), FILE_TIMEOUT_MS);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { if (stderr.length < 64 * 1024) stderr += chunk; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const { skips, counts } = parseTap(stdout, file);
      resolve({ file, exitCode: code, signal, counts, skips, harnessError: counts.tests === undefined ? (stderr.trim().split('\n')[0] || `no TAP summary (exit ${code ?? signal})`) : null });
    });
  });
}

const results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, async () => {
  while (next < files.length) results.push(await runFile(files[next++]));
}));
results.sort((a, b) => a.file.localeCompare(b.file));

const totals = {};
for (const { counts } of results) for (const [key, value] of Object.entries(counts)) totals[key] = (totals[key] ?? 0) + value;
const skips = results.flatMap(result => result.skips);
const missingReasons = skips.filter(skip => !skip.reason).map(({ file, test }) => ({ file, test }));
const harnessErrors = results.filter(result => result.harnessError).map(({ file, harnessError }) => ({ file, error: harnessError }));
const report = {
  generatedAt: new Date().toISOString(), node: process.version, platform: process.platform,
  command: `node --test --test-reporter=tap <file> (per file, concurrency ${CONCURRENCY})`,
  files: files.length, totals, skipCount: skips.length, skips, missingReasons, harnessErrors,
  perFile: results.map(({ file, exitCode, signal, counts }) => ({ file, exitCode, signal, ...counts })),
};

const cell = text => String(text ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const markdown = [
  `Skipped tests: ${skips.length} of ${totals.tests ?? 0} (pass ${totals.pass ?? 0}, fail ${totals.fail ?? 0}, cancelled ${totals.cancelled ?? 0}, todo ${totals.todo ?? 0}) across ${files.length} files; ${missingReasons.length} without a reason.`,
  '',
  '| File | Test | Reason |',
  '|---|---|---|',
  ...skips.map(skip => `| ${cell(skip.file)} | ${cell(skip.test)} | ${skip.reason ? cell(skip.reason) : '**MISSING REASON**'} |`),
  ...(harnessErrors.length ? ['', 'Harness errors:', ...harnessErrors.map(item => `- ${item.file}: ${cell(item.error)}`)] : []),
].join('\n');

if (format !== 'markdown') console.log(JSON.stringify(report, null, 2));
if (format === 'both') console.log('');
if (format !== 'json') console.log(markdown);
process.exitCode = harnessErrors.length ? 2 : missingReasons.length ? 1 : 0;
