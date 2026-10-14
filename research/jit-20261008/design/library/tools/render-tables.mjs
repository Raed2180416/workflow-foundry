// render-tables.mjs: markdown tables from out/pattern-census.json (written by pattern-census.mjs). $0, no I/O beyond out/.
//   node research/jit-20261008/design/library/tools/render-tables.mjs > research/jit-20261008/design/library/out/pattern-census.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../out');
const r = JSON.parse(fs.readFileSync(path.join(OUT, 'pattern-census.json'), 'utf8'));
const pct = (x, n) => `${(100 * x / n).toFixed(1)}%`, N = r.items;
const L = [];
L.push(`# Pattern census tables (generated ${r.generated}; ${N} items, ${r.platformCount} platforms, ${r.catalogSize} catalog entries, budget ${r.budget})`, '');
if (r.revision != null) {
  const dc = r.coverage.dashboardCriterion, w = dc?.withoutCriterion?.full;
  L.push(`**A candidate generator, not a measurement** (AUDIT-L1): "flat" + "hier" counts items the rules do not refuse; the measured coverage is AUDIT-L1 §5. Census revision ${r.revision}: detectors removed ${r.removedDetectors.join(', ') || 'none'}; CI event platforms ${r.ciEventPlatforms.join(', ') || 'none'}` +
    (dc?.widgets ? `; dashboard refusal at >= ${dc.widgets} \`ui_*\` widgets refuses ${dc.refusedByCriterion} more items (without it: flat ${w.flat}, hier ${w.hier}, refused ${w.refused}).` : '.'), '');
}
const f = r.coverage.full;
L.push('| status (full catalog) | items | share |', '|---|---|---|');
for (const k of ['flat', 'hier', 'refused', 'uncovered']) L.push(`| ${k} | ${f[k]} | ${pct(f[k], N)} |`);
L.push('', `L0 only (no L1 pattern needed): ${r.coverage.noL1.flat} (${pct(r.coverage.noL1.flat, N)}). Default-rule control nodes: ${r.defaultRuleNodes.n} of ${r.defaultRuleNodes.of} (${pct(r.defaultRuleNodes.n, r.defaultRuleNodes.of)}).`, '');
L.push('| expansion budget (distinct L1 patterns) | items explained flat | share of all items |', '|---|---|---|');
for (const [b, v] of Object.entries(r.coverage.flatAtBudget)) L.push(`| <= ${b} | ${v} | ${pct(v, N)} |`);
L.push('', '| k | pattern added | newly explained | explained (excl. refused) | explained + refused |', '|---|---|---|---|---|');
for (const c of r.curve) L.push(`| ${c.k} | ${c.add} | ${c.gain} | ${pct(c.decided, N)} | ${pct(c.decided + f.refused, N)} |`);
L.push('', '| distinct L1 patterns per item | items |', '|---|---|');
for (const [k, v] of Object.entries(r.patternsPerItem)) L.push(`| ${k} | ${v} |`);
L.push('', '| id | pattern | family | items | by node / token / idiom-only | oracle-bearing | platforms | clusters | top mined edge-case keywords (items) |', '|---|---|---|---|---|---|---|---|---|');
for (const p of r.patterns) {
  const cl = Object.entries(p.clusters).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', ');
  const ed = Object.entries(p.edge).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} ${n}`).join('; ');
  L.push(`| ${p.id} | ${p.name} | ${p.family} | ${p.items} | ${p.viaNode} / ${p.viaToken} / ${p.viaPlumbing} | ${p.oracle} | ${p.nPlatforms} | ${cl} | ${ed} |`);
}
L.push('', '| cluster | platform | items | flat | hier | refused | L0 only | median / max patterns |', '|---|---|---|---|---|---|---|---|');
for (const p of r.platforms) L.push(`| ${p.cl} | ${p.plat} | ${p.items} | ${p.flat} | ${p.hier} | ${p.refused} | ${p.l0only} | ${p.medianPatterns} / ${p.maxPatterns} |`);
L.push('', '| refusal | items | platforms |', '|---|---|---|');
for (const [k, v] of Object.entries(r.refusals)) L.push(`| ${k} | ${v.n} | ${Object.entries(v.platforms).map(([a, b]) => `${a} ${b}`).join(', ')} |`);
if (r.clusters) {
  const c = r.clusters;
  L.push('', `Cross-platform structural clustering (census distance, category|effects labels, theta ${c.theta}, ${c.nodeRange[0]}-${c.nodeRange[1]} nodes, ${c.items} items, ${c.computed} of ${c.pairs} pairs past the lower bound): ${c.familiesGe3} families of >= 3, ${c.crossPlatformGe3} spanning >= 3 platforms.`, '');
  L.push('| size | platforms | oracle | top patterns | sample |', '|---|---|---|---|---|');
  for (const fm of c.families.slice(0, 19)) L.push(`| ${fm.size} | ${Object.entries(fm.platformCounts).map(([a, b]) => `${a} ${b}`).join(', ')} | ${fm.oracle} | ${fm.topPatterns.join('; ')} | ${fm.sample[0]} |`);
}
L.push('', '| rule (category:branch) | assigned | items | nodes |', '|---|---|---|---|');
for (const x of r.rules) L.push(`| ${x.rule} | ${x.p} | ${x.items} | ${x.nodes} |`);
process.stdout.write(L.join('\n') + '\n');
