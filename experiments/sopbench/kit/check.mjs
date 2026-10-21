// tools/check.mjs (experiments/sopbench/kit/check.mjs, copied into a builder's workdir): runs ./solve.mjs on every example
// task under rows/ (tools/run-solver.mjs) and compares each answer with rows/<id>/expected.json under the strict rule the
// workflow is scored by later (tools/strict.mjs: every output column; same text after case, '_'/'-' and whitespace
// folding; numbers by value; null-likes only match null-likes; no partial credit).
//   node tools/check.mjs [rows/<id> ...]      (default: every rows/<id>)
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { finalOutputText, strictVerdict } from './strict.mjs';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(TOOLS);
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(path.join(ROOT, 'rows')).sort((a, b) => Number(a) - Number(b)).map(d => path.join('rows', d));
const runOne = dir => new Promise(res => {
  const c = spawn(process.execPath, [path.join(TOOLS, 'run-solver.mjs'), dir, '--quiet'], { cwd: ROOT });
  c.on('close', code => res(code));
});
let pass = 0;
const lines = [];
const queue = [...dirs];
await Promise.all([0, 1].map(async () => {
  while (queue.length) {
    const dir = queue.shift();
    const id = path.basename(dir), run = path.join(ROOT, '.runs', id);
    const code = await runOne(dir);
    const exp = JSON.parse(readFileSync(path.join(ROOT, dir, 'expected.json'), 'utf8'));
    const cols = Object.keys(exp);
    const expected = Object.fromEntries(cols.map(c => [c, { str: exp[c] === null ? 'nan' : String(exp[c]), isna: exp[c] === null }]));
    let line;
    if (code === 0) {
      const out = readFileSync(path.join(run, 'stdout.txt'), 'utf8').split('--- stdout\n')[1].split('\n--- stderr')[0].trim().split('\n').at(-1);
      let answer = null; try { answer = JSON.parse(out); } catch {}
      const v = answer ? strictVerdict(finalOutputText(answer), expected, cols) : { pass: false };
      if (v.pass) { pass++; line = `${id}: PASS`; }
      else line = `${id}: FAIL ${answer ? cols.filter(c => !v.fields?.[c]).map(c => `${c}: expected ${JSON.stringify(exp[c])}, got ${JSON.stringify(answer[c])}`).join('; ') : 'unparseable answer line'}`;
    } else if (code === 75) line = `${id}: DEOPT ${existsSync(path.join(run, 'deopt.json')) ? readFileSync(path.join(run, 'deopt.json'), 'utf8').replace(/\s+/g, ' ').slice(0, 600) : ''}`;
    else line = `${id}: CRASH exit ${code} ${readFileSync(path.join(run, 'stdout.txt'), 'utf8').split('--- stderr\n')[1]?.slice(-800).replace(/\s+/g, ' ') ?? ''}`;
    lines.push([Number(id), line]);
  }
}));
for (const [, l] of lines.sort((a, b) => a[0] - b[0])) console.log(l);
console.log(JSON.stringify({ pass, of: dirs.length }));
process.exit(pass === dirs.length ? 0 : 1);
