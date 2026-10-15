// The MUTANTS.md survivor table (the 109 survivors of 2026-10-14, the 2026-10-14 kills that changed verdict, and
// the mutants added after k300) from classes.json, the manifest, the golden/unit-check matrix and reasons.mjs.
import { readFileSync } from 'node:fs';
const S = process.argv[2] ?? '.';   // the work directory: classes.json, new/manifest.json, golden-matrix.jsonl
const E8 = new URL('../../../', import.meta.url).pathname;
const { R } = await import('./reasons.mjs');
const C = JSON.parse(readFileSync(`${S}/classes.json`, 'utf8'));
const man = JSON.parse(readFileSync(`${S}/new/manifest.json`, 'utf8'));
const gm = Object.fromEntries(readFileSync(`${S}/${process.argv[3] ?? 'golden-matrix.jsonl'}`, 'utf8').trim().split('\n').map(l => JSON.parse(l)).map(r => [r.k, r]));
const old = JSON.parse(readFileSync(`${E8}ledger/mutation-20261014.json`, 'utf8'));
const surv = new Set(old.survivors.map(s => s.k));
const rows = [], tally = {};
for (const c of C) {
  if (!(surv.has(c.k) || c.k > 300 || c.v !== 'killed')) continue;
  const kind = R[c.k]?.[0];
  if (c.v === 'killed' && kind) console.error(`WARN k${c.k} killed but reason says ${kind}`);
  if (c.v !== 'killed' && !kind) console.error(`WARN k${c.k} ${c.v} without a kind`);
  const label = c.v === 'killed' ? 'killed' : `equivalent (grader: ${kind})`;
  if (surv.has(c.k)) tally[label] = (tally[label] ?? 0) + 1;
  const unit = Object.keys(gm[c.k]?.unit ?? {});
  let ev = c.ev;
  if (c.v !== 'killed' && unit.length) ev += `; unit check \`${unit[0]}\` fails it`;
  rows.push(`| ${c.k} | ${man[c.k].line} | ${label} | ${(R[c.k]?.[1] ?? '?').replaceAll('|', '\\|')} | ${ev.replaceAll('|', '\\|').replace(/ORD-1001-/g, '')} |`);
}
console.log(rows.join('\n'));
console.error(JSON.stringify(tally));
