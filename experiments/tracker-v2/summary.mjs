#!/usr/bin/env node
// Analyst summary (no model call) of BUILDER-1 judge files: per file and arm, defects caught, false alarms (with ids) and misses; and every
// unmet (build, condition) with its first evidence line, for adjudication (PREREG-TRACKER §5).
//   node experiments/tracker-v2/summary.mjs <dir> [--unmet] [--match <substring of judge file name>]
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: a, positionals } = parseArgs({ allowPositionals: true, options: { unmet: { type: 'boolean' }, match: { type: 'string' }, noG3: { type: 'boolean' } } });
const dir = path.resolve(positionals[0] ?? 'research/tracker-20261021/builder1');
for (const f of readdirSync(dir).filter(f => /^judge-.*\.json$/.test(f) && (!a.match || f.includes(a.match))).sort()) {
  const j = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
  const builds = Object.entries(j.builds);
  const bad = builds.filter(([, b]) => !b.verified).map(([id]) => id);
  const arm = pick => {
    const flagged = builds.filter(([, b]) => pick(b)).map(([id]) => id);
    return { caught: flagged.filter(id => bad.includes(id)), fa: flagged.filter(id => !bad.includes(id)), missed: bad.filter(id => !flagged.includes(id)) };
  };
  const show = (name, r) => console.log(`${f.padEnd(62)} ${name.padEnd(7)} caught ${String(r.caught.length).padStart(2)}/${bad.length}  FA ${String(r.fa.length).padStart(2)}  ${r.fa.length ? `FA: ${r.fa.join(' ')}` : ''}`);
  show('T0', arm(b => !b.t0.passed));
  show('T2', arm(b => b.tally.unmet > 0));
  show('T2noG3', arm(b => b.tallyNoG3.unmet > 0));
  show('T0+T2', arm(b => !b.t0.passed || b.tally.unmet > 0));
  if (a.unmet) for (const [id, b] of builds) for (const [cid, s] of Object.entries(a.noG3 ? b.t2NoG3 : b.t2)) if (s.status === 'unmet')
    console.log(`   ${b.verified ? 'FA ' : 'hit'} ${id} ${cid}: ${(s.evidence ?? []).map(e => `${e.item ?? ''} ${e.why}`).join(' | ').slice(0, 220)}`);
}
