#!/usr/bin/env node
// The simple baseline (AGENTS.md "a capability number against a simple baseline"), $0: per SOP and output column, the most
// frequent label among the 5 BUILD rows (ties: alphabetical), answered as a constant on every dev row (build + repair),
// scored with both graders (scorer.mjs). Needs a prepared dev run (prep/<sop>/rows/<row>/expected.json), e.g. the parity
// oracle run.   node experiments/sopbench/majority.mjs /var/tmp/foundry-work/sopbench/<run>/oracle
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loadSplit } from './split.mjs';
import { finalOutputText, strictVerdict, upstreamVerdict } from './scorer.mjs';

const live = process.argv[2];
const split = loadSplit();
const out = {};
for (const sop of readdirSync(path.join(live, 'prep'))) {
  const e = split.sops[sop];
  const exp = r => JSON.parse(readFileSync(path.join(live, 'prep', sop, 'rows', String(r), 'expected.json'), 'utf8'));
  const cols = exp(e.build[0]).output_columns;
  const answer = Object.fromEntries(cols.map(c => {
    const counts = new Map();
    for (const r of e.build) { const v = exp(r).expected[c]; const k = v.isna ? null : v.str; counts.set(k, (counts.get(k) ?? 0) + 1); }
    return [c, [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0][0]];
  }));
  const text = finalOutputText(answer);
  const rows = [...e.build, ...e.repair];
  const up = rows.map(r => upstreamVerdict(text, exp(r).expected, cols)), st = rows.map(r => strictVerdict(text, exp(r).expected, cols).pass);
  out[sop] = { rows: rows.length, strict: st.filter(Boolean).length / rows.length, upstream: up.every(x => x.covered) ? up.filter(x => x.pass).length / rows.length : null };
}
const vals = Object.values(out);
console.log(JSON.stringify({ bySop: out, macro: { strict: vals.reduce((a, x) => a + x.strict, 0) / vals.length, upstream: vals.reduce((a, x) => a + (x.upstream ?? 0), 0) / vals.length } }, null, 1));
