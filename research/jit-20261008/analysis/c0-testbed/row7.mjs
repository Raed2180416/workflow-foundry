// Row 7: run the AST guard diff (astdiff.mjs) on every hand-made variant of the C0 solver (variants.mjs) and report detection
// on mutants and false alarms on refactors. Kill rule: flags >= 50% of the behaviour-preserving refactors.
// Usage: node --expose-internals row7.mjs  -> outputs/row7.json + a markdown table on stdout
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { VARIANTS, applyVariant, PARENT } from './variants.mjs';
import { diffGuards } from './astdiff.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const parent = readFileSync(PARENT, 'utf8');
const rows = VARIANTS.map(v => {
  const r = diffGuards(parent, applyVariant(parent, v));
  return { id: v.id, kind: v.kind, cls: v.cls ?? 'refactor', what: v.what, flagged: r.flagged,
    findings: r.findings.map(f => `${f.type} ${f.kind} L${f.line}${f.change ? ` (${f.change})` : ''}: ${f.parent}${f.child ? ` -> ${f.child}` : ''}`),
    added: r.added.length, sites: `${r.parentSites}->${r.childSites}`, dead: r.deadChild };
});
const mut = rows.filter(r => r.kind === 'mutant'), ref = rows.filter(r => r.kind === 'refactor');
const det = mut.filter(r => r.flagged).length, fa = ref.filter(r => r.flagged).length;
const out = {
  detection: `${det}/${mut.length}`, detectionRate: +(det / mut.length).toFixed(3),
  byClass: Object.fromEntries(['deletion', 'widening'].map(c => [c, `${mut.filter(r => r.cls === c && r.flagged).length}/${mut.filter(r => r.cls === c).length}`])),
  falseAlarms: `${fa}/${ref.length}`, falseAlarmRate: +(fa / ref.length).toFixed(3),
  verdict: fa / ref.length >= 0.5 ? 'KILL (flags >= 50% of refactors)' : 'survives the kill rule (flags < 50% of refactors)',
  rows,
};
mkdirSync(path.join(HERE, 'outputs'), { recursive: true });
writeFileSync(path.join(HERE, 'outputs', 'row7.json'), JSON.stringify(out, null, 1));
console.log('| variant | class | flagged | finding(s) |\n|---|---|---|---|');
for (const r of rows) console.log(`| ${r.id} | ${r.cls} | ${r.flagged ? 'yes' : 'no'} | ${r.findings.map(f => f.replace(/\|/g, '\\|').slice(0, 160)).join('<br>') || '-'} |`);
console.log(`\ndetection ${out.detection} (${JSON.stringify(out.byClass)}), false alarms ${out.falseAlarms}: ${out.verdict}`);
