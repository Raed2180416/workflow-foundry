// tools/run-solver.mjs (experiments/sopbench/kit/run-solver.mjs, copied into a builder's workdir): runs ./solve.mjs on one
// example task the way the frozen workflow will run later: a fresh directory holding only the workflow's files (solve.mjs,
// lib/, sections/), task.json and the SDK under tools/, a minimal environment, the SOP's tools through the mailbox.
//   node tools/run-solver.mjs rows/<id> [--quiet]
// Prints the answer line (and the deopt or crash), keeps the run in .runs/<id>/ (trace.jsonl, deopt.json, stdout.txt).
// Exit code: the solver's (0 done, 75 deopt, anything else a crash).
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(TOOLS);
const rowDir = process.argv[2];
const quiet = process.argv.includes('--quiet');
if (!rowDir || !existsSync(path.join(rowDir, 'task.json'))) { console.error('usage: node tools/run-solver.mjs rows/<id>'); process.exit(2); }
if (!existsSync(path.join(ROOT, 'solve.mjs'))) { console.error('no ./solve.mjs yet'); process.exit(2); }
const id = path.basename(path.resolve(rowDir));
const run = path.join(ROOT, '.runs', id);
rmSync(run, { recursive: true, force: true });
mkdirSync(path.join(run, 'tools'), { recursive: true });
cpSync(path.join(ROOT, 'solve.mjs'), path.join(run, 'solve.mjs'));
for (const d of ['lib', 'sections']) if (existsSync(path.join(ROOT, d))) cpSync(path.join(ROOT, d), path.join(run, d), { recursive: true });
for (const f of readdirSync(TOOLS)) if (/^(flow|model|sop)\.mjs$|^(catalog|output-schema|gateway)\.json$/.test(f)) cpSync(path.join(TOOLS, f), path.join(run, 'tools', f));
if (existsSync(path.join(TOOLS, 'gw.sock'))) symlinkSync(path.join(TOOLS, 'gw.sock'), path.join(run, 'tools', 'gw.sock'));
cpSync(path.join(rowDir, 'task.json'), path.join(run, 'task.json'));
const r = spawnSync(process.execPath, ['solve.mjs', 'task.json'], { cwd: run, encoding: 'utf8', timeout: 180_000,
  env: { PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: run, SOP_MAILBOX: path.join(ROOT, '.tools') } });
writeFileSync(path.join(run, 'stdout.txt'), `exit ${r.status}${r.error ? ` (${r.error.code})` : ''}\n--- stdout\n${r.stdout ?? ''}\n--- stderr\n${r.stderr ?? ''}`);
const code = r.status ?? 1;
if (!quiet) {
  if (code === 0) process.stdout.write((r.stdout ?? '').trim().split('\n').at(-1) + '\n');
  else if (code === 75) process.stdout.write(`DEOPT ${existsSync(path.join(run, 'deopt.json')) ? readFileSync(path.join(run, 'deopt.json'), 'utf8') : ''}\n`);
  else process.stdout.write(`CRASH exit ${code}${r.error ? ` ${r.error.code}` : ''}\n${(r.stderr ?? '').slice(-3000)}\n`);
}
process.exit(code);
