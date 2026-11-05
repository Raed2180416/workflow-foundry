#!/usr/bin/env node
// Record a deviation's file hashes (PREREG-TRACKER §8): every file of the freeze whose current sha256 differs from freeze.json and from
// every hash an earlier deviation recorded is written under the named deviation in deviations.json, with its reason. freeze.mjs --check
// then accepts exactly those bytes; any later edit drifts again.
//   node experiments/tracker-v2/record-deviation.mjs D3 --at 2026-10-28T19:30:00Z --why "..." [--dry]
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'research/tracker-20261021');
const { values: a, positionals } = parseArgs({ allowPositionals: true, options: { at: { type: 'string' }, why: { type: 'string' }, dry: { type: 'boolean' } } });
const name = positionals[0];
if (!/^D\d+$/.test(name ?? '')) throw new Error('usage: record-deviation.mjs D<n> --at ISO --why TEXT');
const freeze = JSON.parse(readFileSync(path.join(DIR, 'freeze.json'), 'utf8'));
const devFile = path.join(DIR, 'deviations.json');
const devs = JSON.parse(readFileSync(devFile, 'utf8'));
const recorded = new Set(Object.entries(devs).filter(([k]) => /^D\d+$/.test(k) && k !== name).flatMap(([, d]) => Object.entries(d.files ?? {}).map(([f, h]) => `${f}\u0000${h}`)));
const files = {};
for (const k of ['code', 'inputs']) for (const [f, h] of Object.entries(freeze[k])) {
  const now = createHash('sha256').update(readFileSync(path.join(ROOT, f))).digest('hex');
  if (now !== h && !recorded.has(`${f}\u0000${now}`)) files[f] = now;
}
const entry = { at: a.at ?? new Date().toISOString(), why: a.why ?? '', files };
console.log(JSON.stringify({ [name]: entry }, null, 1));
if (!a.dry) { devs[name] = entry; writeFileSync(devFile, `${JSON.stringify(devs, null, 1)}\n`); console.log(`recorded ${name} in ${path.relative(ROOT, devFile)}`); }
