#!/usr/bin/env node
// Run Foundry's attack test for every property in properties.json and print the conformance matrix ($0, no models).
//   node experiments/conformance/run.mjs [--json]
// A property passes only if every attack test named for it runs and passes (a skipped test is not a pass).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const spec = JSON.parse(readFileSync(path.join(root, 'experiments/conformance/properties.json'), 'utf8'));
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rows = [];
for (const p of spec.properties) {
  const results = [];
  for (const t of p.foundry) {
    const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', `--test-name-pattern=${escape(t.name)}`, t.file], { cwd: root, encoding: 'utf8', timeout: 600000 });
    const count = k => Number((r.stdout.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) ?? [])[1] ?? NaN);
    const pass = count('pass'), fail = count('fail'), skipped = count('skipped');
    results.push({ ...t, pass, fail, skipped, ok: r.status === 0 && pass >= 1 && fail === 0 && skipped === 0 });
  }
  rows.push({ id: p.id, name: p.name, ok: results.every(x => x.ok), tests: results, limits: p.limits ?? null });
}
if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify({ schema: 'foundry.conformance.result/1', system: 'foundry', rows }, null, 1)}\n`);
else for (const r of rows) process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}  ${r.name}${r.limits ? `  (limits: ${r.limits})` : ''}\n${r.tests.map(t => `        ${t.ok ? 'ok ' : 'NOT'} ${t.file} :: ${t.name} (pass ${t.pass}, fail ${t.fail}, skipped ${t.skipped})`).join('\n')}\n`);
process.exitCode = rows.every(r => r.ok) ? 0 : 1;
