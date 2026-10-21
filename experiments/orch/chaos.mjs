#!/usr/bin/env node
// Orchestration chaos/conformance suite (research/orch-20261021). Each scenario drives one of OUR primitives (the src
// runtime's map/loop/wait/human/agent nodes, children.mjs reaping, journal resume; flow-v3's call/wide/agent nodes and
// their hosts run-compiled.mjs and call-host.mjs; the experiment runners) under an injected fault, with synthetic
// capabilities and scripted stand-in models ($0, no model calls), and checks a stated invariant. A scenario returns
// checks [{name, pass, observed}]; it passes only when every check passes. Failures are the expected main output: they are
// recorded, never retried until green, and never edited away.
//
//   nice -n 10 node experiments/orch/chaos.mjs [--only B1,C3] [--group a,b] [--out DIR] [--list]
//
// Writes DIR/matrix.json (every observation) and DIR/MATRIX.md (the pass/fail table). Default DIR:
// research/orch-20261021/chaos. Scenarios run one at a time (the machine runs paid jobs; bounded resource use).
// Development/diagnostic evidence, not sealed evaluation.
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { cleanup, ROOT } from './lib/harness.mjs';
import { reapAll } from './lib/proc.mjs';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const only = opt('--only')?.split(',').map(s => s.trim().toUpperCase()) ?? null;
const groups = opt('--group')?.split(',').map(s => s.trim().toLowerCase()) ?? null;
const out = path.resolve(opt('--out') ?? path.join(ROOT, 'research/orch-20261021/chaos'));

const dir = new URL('./scenarios/', import.meta.url).pathname;
const scenarios = [];
for (const file of readdirSync(dir).filter(f => f.endsWith('.mjs')).sort()) {
  const mod = await import(path.join(dir, file));
  for (const s of mod.default ?? []) scenarios.push({ ...s, file });
}
const selected = scenarios.filter(s => (!only || only.includes(s.id.toUpperCase())) && (!groups || groups.includes(s.group)));
if (args.includes('--list')) { for (const s of selected) console.log(`${s.id}\t${s.group}\t${s.title}`); process.exit(0); }

const results = [];
const started = new Date().toISOString();
for (const s of selected) {
  const t0 = Date.now();
  process.stderr.write(`[chaos] ${s.id} ${s.title} ... `);
  let r;
  try {
    r = await Promise.race([
      Promise.resolve().then(() => s.run({ log: m => process.stderr.write(`\n  ${m}`) })),
      new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(`scenario timed out after ${s.timeoutMs ?? 120000} ms`), { code: 'SCENARIO_TIMEOUT' })), s.timeoutMs ?? 120000).unref()),
    ]);
  } catch (error) {
    r = { checks: [{ name: 'scenario ran to its end', pass: false, observed: `${error.code ?? error.name}: ${String(error.message).slice(0, 400)}` }], harnessError: true };
  } finally { try { await s.cleanup?.(); } catch {} reapAll(); cleanup(); }
  const checks = r.checks ?? [];
  // A check marked info is reported but does not decide the scenario (a property no prior art guarantees either).
  const pass = checks.filter(c => !c.info).length > 0 && checks.filter(c => !c.info).every(c => c.pass === true);
  const row = { id: s.id, group: s.group, title: s.title, primitive: s.primitive, fault: s.fault, invariant: s.invariant, pass, checks, observed: r.observed ?? null,
    note: r.note ?? null, harnessError: !!r.harnessError, ms: Date.now() - t0, file: s.file };
  results.push(row);
  process.stderr.write(`${pass ? 'PASS' : 'FAIL'} (${row.ms} ms)\n`);
  for (const c of checks) if (c.pass !== true) process.stderr.write(`    ${c.info ? '(info) ' : ''}`), process.stderr.write(`    - ${c.name}: ${typeof c.observed === 'string' ? c.observed : JSON.stringify(c.observed)}\n`.slice(0, 600));
}

mkdirSync(out, { recursive: true });
const meta = { started, finished: new Date().toISOString(), node: process.version, platform: process.platform, selected: selected.map(s => s.id) };
const file = only || groups ? `matrix-${(only ?? groups).join('_').slice(0, 60)}.json` : 'matrix.json';
writeFileSync(path.join(out, file), JSON.stringify({ meta, results }, null, 1) + '\n');
const cell = v => String(v ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const md = [`# Chaos matrix (${meta.finished})`, '', `node ${meta.node}, ${meta.platform}; ${results.filter(r => r.pass).length}/${results.length} scenarios pass.`, '',
  '| id | scenario | invariant | result | failing checks (observed) |', '|---|---|---|---|---|',
  ...results.map(r => `| ${r.id} | ${cell(r.title)} | ${cell(r.invariant)} | **${r.pass ? 'PASS' : 'FAIL'}** | ${cell(r.checks.filter(c => c.pass !== true).map(c => `${c.info ? '(info) ' : ''}${c.name}: ${typeof c.observed === 'string' ? c.observed : JSON.stringify(c.observed)}`).join('; ').slice(0, 700))} |`)];
writeFileSync(path.join(out, file.replace(/^matrix/, 'MATRIX').replace(/\.json$/, '.md')), md.join('\n') + '\n');
console.log(JSON.stringify({ pass: results.filter(r => r.pass).length, total: results.length, failed: results.filter(r => !r.pass).map(r => r.id), out }, null, 1));
process.exit(0);
