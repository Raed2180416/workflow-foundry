// render.mjs: markdown tables from summary.json and labels.jsonl for AUDIT-L1B-HELDOUT.md. $0.
// Usage (repo root):  node research/jit-20261008/design/library/out/heldout/render.mjs > research/jit-20261008/design/library/out/heldout/tables.generated.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const s = JSON.parse(fs.readFileSync(path.join(HERE, 'summary.json'), 'utf8'));
const labels = new Map(); for (const l of fs.readFileSync(path.join(HERE, 'labels.jsonl'), 'utf8').trim().split('\n')) { const r = JSON.parse(l); labels.set(r.id, r); }
const P = ['windmill', 'kestra', 'power-automate', 'step-functions', 'logic-apps'];
const NAME = { windmill: 'Windmill', kestra: 'Kestra', 'power-automate': 'Power Automate', 'step-functions': 'AWS Step Functions', 'logic-apps': 'Azure Logic Apps' };
const w = (a) => `${a[0]}–${a[1]}`;
const out = [];
out.push('### T1 per platform and pooled (strict = `yes` only)\n');
out.push('| platform | n | yes / partly / no | strict | Wilson 95% | lenient (yes + partly) | Wilson 95% | pooled without this platform |');
out.push('|---|---|---|---|---|---|---|---|');
for (const p of P) { const v = s.perPlatform[p]; out.push(`| ${NAME[p]} | ${v.n} | ${v.yes} / ${v.partly} / ${v.no} | ${v.strict.p}% | ${w(v.strict.wilson)} | ${v.lenient.p}% | ${w(v.lenient.wilson)} | ${s.leaveOnePlatformOut[p].p}% |`); }
out.push(`| **pooled** | **${s.n}** | **${P.reduce((a, p) => a + s.perPlatform[p].yes, 0)} / ${P.reduce((a, p) => a + s.perPlatform[p].partly, 0)} / ${P.reduce((a, p) => a + s.perPlatform[p].no, 0)}** | **${s.pooled.strict.p}%** | **${w(s.pooled.strict.wilson)}** | ${s.pooled.lenient.p}% | ${w(s.pooled.lenient.wilson)} | |`);
out.push('\n### T2 pooled sensitivities\n');
out.push('| reading | x / n | % | Wilson 95% |');
out.push('|---|---|---|---|');
const r = (name, c) => out.push(`| ${name} | ${c.x} / ${c.n} | ${c.p}% | ${w(c.wilson)} |`);
r('strict (yes only): the J1 statistic', s.pooled.strict);
r('lenient (yes + partly)', s.pooled.lenient);
r('non-trivial workflows only (size ≥ 3 steps by the mechanical count), strict', s.pooled.nonTrivial_sizeGE3);
r('S3: yes and no gap that needs a vocabulary change (construct, field or binding, lacks yes or partial)', s.pooled.S3_noVocabularyChange);
r('S4: yes and no gap that needs a construct or a field (bindings excluded)', s.pooled.S4_noConstructOrField);
out.push('\n### T3 in-sample comparators (sonnet-60 hand labels, revision-1 strata, post-stratified, strict, dashboard app = refusal)\n');
out.push('| in-sample subset | labels | corpus items | coverage | Wilson 95% at Kish n |');
out.push('|---|---|---|---|---|');
const ins = s.inSample;
const row = (n, v) => out.push(`| ${n} | ${v.labels} | ${v.items} | ${v.p}% | ${w(v.wilsonAtKish)} (n ${v.kishN}) |`);
row('all five clusters (the comparator: 93.6%)', ins.all);
row('non-agentic clusters (automation, orchestration, science, consumer-creative)', ins.nonAgentic.conservative);
row('automation + orchestration (the nearest to the five J1 platforms)', ins.automationOrchestration.conservative);
row('automation + orchestration, dashboard app read as explained', ins.automationOrchestration.dashboardExplained);
row('agentic', ins.agentic);
const needs = s.missing.filter((m) => m.lacks.includes('yes') || m.lacks.includes('partial'));
const noChange = s.missing.filter((m) => !(m.lacks.includes('yes') || m.lacks.includes('partial')));
out.push('\n### T4a gaps that would need a vocabulary change (lacks = yes or partial; counts are workflows, of 50)\n');
out.push('| tag | what the vocabulary lacks | workflows | platforms | kind | class | lacks |');
out.push('|---|---|---|---|---|---|---|');
for (const m of needs) out.push(`| \`${m.tag}\` | ${m.label} | ${m.items} | ${m.platforms.map((p) => NAME[p]).join(', ')} | ${m.kinds.join(', ')} | ${m.classes.join(', ')} | ${m.lacks.join(', ')} |`);
out.push('\n### T4b gaps recorded that need no vocabulary change (rewrites into existing constructs, L3 binding detail, latent defects of the definition)\n');
out.push('| tag | what it is | workflows | platforms | kind |');
out.push('|---|---|---|---|---|');
for (const m of noChange) out.push(`| \`${m.tag}\` | ${m.label} | ${m.items} | ${m.platforms.map((p) => NAME[p]).join(', ')} | ${m.kinds.join(', ')} |`);
out.push('\n### T5 needs profile per platform (hand labels)\n');
out.push('| platform | n | trivial (≤ 2 steps) | patterns per workflow: median / max / over 5 | most used patterns | most used L0 rows | nearest in-corpus platforms by pattern-share cosine (census) |');
out.push('|---|---|---|---|---|---|---|');
for (const p of P) { const v = s.profile[p]; out.push(`| ${NAME[p]} | ${v.n} | ${v.trivial} | ${v.patternsPerItem.median} / ${v.patternsPerItem.max} / ${v.patternsPerItem.over5} | ${v.topPatterns.map(([k, c]) => `${k} ${c}`).join(', ')} | ${v.l0Top.slice(0, 6).map(([k, c]) => `${k} ${c}`).join(', ')} | ${v.nearestPlatforms.map((n) => `${n.platform} (${n.cluster}) ${n.cosine}`).join('; ')} |`); }
out.push('\n### T6 L1 patterns used by the 50 workflows, with the corpus census support (candidate-generator counts)\n');
out.push('| pattern | J1 workflows | corpus items (census) |');
out.push('|---|---|---|');
for (const x of s.pooledPatterns) out.push(`| ${x.pattern} | ${x.workflows} | ${x.corpusItems} |`);
out.push('\n### T7 L0 rows used (workflows naming the row)\n');
out.push(s.pooledL0.map(([k, c]) => `${k} ${c}`).join(' · '));
out.push('\n### A1 every label (strict reading: yes only)\n');
out.push('| # | platform | workflow | size | explained | L1 patterns | gap tags (class) |');
out.push('|---|---|---|---|---|---|---|');
let i = 0;
const tagsOf = new Map(); for (const g of s.gapRows) { const a = tagsOf.get(g.id) ?? []; a.push(`${g.tag}${g.class === 'stops' ? ' (stops)' : ''}`); tagsOf.set(g.id, a); }
for (const row2 of s.sizes) {
  i++; const l = labels.get(row2.id); const short = row2.id.replace(/^[^:]+:/, '').replace(/^samples\//, '').replace(/\/solution\/.*#.*$/, '').replace(/^templates\//, '').replace(/^flows\//, '').replace(/\/statemachines?\/.*$/, '').replace(/\.yaml$|\.json$/, '');
  out.push(`| ${i} | ${NAME[row2.platform]} | ${short} | ${row2.size} | ${l.explained} | ${l.patterns.join(' ')} | ${(tagsOf.get(row2.id) ?? []).join(', ') || '–'} |`);
}
console.log(out.join('\n'));
