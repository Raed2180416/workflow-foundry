// Pools the three seed sets (primary 100-129, replicate 130-159, tuning seeds 0-29) for the
// kill-rule contrast only. Supplementary; the pre-declared analysis is the 100-129 set.
import { readFileSync, writeFileSync } from 'node:fs';
import { bootstrap } from './lib.mjs';
const dir = new URL('./out/', import.meta.url).pathname;
const sets = { 'A 100-129 (primary)': 'rows.json', 'B 130-159 (replicate)': 'rows-b130-159.json', 'C 0-29 (seeds the bed tuned its agents on)': 'rows-c0-29.json' };
const load = f => JSON.parse(readFileSync(dir + f, 'utf8')).rows;
const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const pct = x => (100 * x).toFixed(1);
const L = ['| task set | n | P2 | P3 | P4 | P3 - P2 [95% CI] | P4 - P2 [95% CI] | P4c - P2 [95% CI] | P1 (fresh env) |', '|---|---|---|---|---|---|---|---|---|'];
const run = (name, rs) => {
  const v = k => rs.map(r => r.res[`ii.${k}`].pass ? 1 : 0);
  const d = (k) => { const a = v(k), b = v('P2'); const x = a.map((q, i) => q - b[i]); const [lo, hi] = bootstrap(x.length, idx => mean(idx.map(i => x[i]))); return `${mean(x) >= 0 ? '+' : ''}${pct(mean(x))} [${pct(lo)}, ${pct(hi)}]`; };
  L.push(`| ${name} | ${rs.length} | ${pct(mean(v('P2')))}% | ${pct(mean(v('P3')))}% | ${pct(mean(v('P4')))}% | ${d('P3')} | ${d('P4')} | ${d('P4c')} | ${pct(mean(v('P1')))}% |`);
};
const all = {};
for (const [n, f] of Object.entries(sets)) { all[n] = load(f); run(n, all[n]); }
const keys = Object.keys(all);
run('A+B pooled (fresh seeds)', [...all[keys[0]], ...all[keys[1]]]);
run('A+B+C pooled', keys.flatMap(k => all[k]));
for (const d of [3, 4, 5]) run(`A+B, d${d}`, [...all[keys[0]], ...all[keys[1]]].filter(r => r.d === d));
writeFileSync(dir + 'combined.md', L.join('\n') + '\n');
console.log(L.join('\n'));
