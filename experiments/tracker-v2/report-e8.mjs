#!/usr/bin/env node
// Analyst report (no model call) over research/tracker-20261021/e8: bind decisions; expressiveness per frozen gold id (an id counts as
// expressed when a condition located inside its span got a check); the arms from scores.json (run `run-e8.mjs score` first); cost.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? 'research/tracker-20261021/e8');
const readJson = f => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
const gold = JSON.parse(readFileSync(path.resolve('research/need-router-20261014/tracker-e8/gold.json'), 'utf8'));
const conds = readJson('conditions-s0rule.json').conditions;
const bind = readJson('bind-claude-haiku-5-5.json');
const dec = {};
for (const c of Object.values(bind.conditions)) dec[c.decision] = (dec[c.decision] ?? 0) + 1;
const inSpan = ([a, b]) => conds.filter(c => c.span && c.span.line >= a && (c.span.lineEnd ?? c.span.line) <= b);
let covered = 0, expressed = 0;
const rows = [];
for (const [id, span] of Object.entries(gold.ids)) {
  const cs = inSpan(span);
  const checked = cs.filter(c => bind.conditions[c.id]?.decision === 'check');
  if (cs.length) covered++;
  if (checked.length) expressed++;
  rows.push(`${id.padEnd(5)} conditions ${cs.length} checked ${checked.length} ${cs.filter(c => bind.conditions[c.id]?.decision !== 'check').map(c => bind.conditions[c.id]?.decision).join(',')}`);
}
console.log(`bind decisions over ${conds.length} conditions: ${JSON.stringify(dec)}; $${bind.costUsd}`);
console.log(`gold ids with a condition: ${covered}/${Object.keys(gold.ids).length}; with at least one check: ${expressed}/${Object.keys(gold.ids).length}`);
for (const r of rows) console.log(`  ${r}`);
const s = readJson('scores.json');
console.log(`known good: ${s.knownGood.join(' ')} | scored: ${s.scored.join(' ')}`);
for (const [f, a] of Object.entries(s.arms)) for (const [k, x] of Object.entries(a)) {
  if (!x || x.caught === undefined) continue;
  console.log(`${f.padEnd(44)} ${k.padEnd(7)} caught ${x.caught}/${x.defective} FA ${x.falseAlarms} ${x.falseAlarmIds.length ? `(${x.falseAlarmIds.join(' ')})` : ''} missed ${x.missedIds.join(' ')}${a.instances && k === 'T2' ? `  instances: ${JSON.stringify(a.instances)}` : ''}`);
}
const p = readJson('prose-claude-haiku-5-5.json');
console.log(`T1 cost $${p.costUsd} over ${Object.keys(p.builds).length} builds`);
