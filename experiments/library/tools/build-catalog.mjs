// Rebuild experiments/library/cards/catalog.json: the 54 L1 catalog entries (L1-PATTERNS.md) as data, so the index
// covers every L1 item even where no executable card exists (BUILD-ORDER §2: a card is made executable when first
// retrieved). $0; reads the design directory only:
//   out/pattern-census.json   id, name, family, support counts, platforms (the census numbers)
//   out/pattern-evidence.md   grade and companions (lift, co-items)
//   L1-PATTERNS.md §7 matrix  L0 constructs composed, tier, rung;  §4 / §5  the J1 question
//
//   node experiments/library/tools/build-catalog.mjs > experiments/library/cards/catalog.json
import { readFileSync } from 'node:fs';

const DESIGN = new URL('../../../research/jit-20261008/design/library/', import.meta.url);
const read = rel => readFileSync(new URL(rel, DESIGN), 'utf8');
const census = JSON.parse(read('out/pattern-census.json'));
const evidence = read('out/pattern-evidence.md'), l1 = read('L1-PATTERNS.md');
const cells = line => line.split('|').slice(1, -1).map(c => c.trim());

const grade = {}, companions = {};
for (const line of evidence.split('\n')) {
  const c = cells(line);
  if (!/^P\d\d$/.test(c[0] ?? '')) continue;
  grade[c[0]] = /^[A-DU]$/.test(c[2]) ? c[2] : null;   // U: unmeasured, detector removed by L1-a (census revision 1)
  companions[c[0]] = [...(c[7] ?? '').matchAll(/(P\d\d) ×([\d.]+) \((\d+)\)/g)].map(m => ({ id: m[1], lift: Number(m[2]), n: Number(m[3]) }));
}
const matrix = {};
const s7 = l1.slice(l1.indexOf('## 7.'), l1.indexOf('## 8.'));
for (const line of s7.split('\n')) {
  const c = cells(line);
  if (!/^P\d\d$/.test(c[0] ?? '') || c.length < 4) continue;
  const constructs = [...new Set((c[1].replace(/[<>] *\d+/g, '').match(/\d+/g) ?? []).map(Number).filter(n => n >= 1 && n <= 30))];
  const tier = (c[2].match(/\b(HOST|IR|S|D|N)\b/) ?? [])[1] ?? null;
  matrix[c[0]] = { constructs, tier, tierRaw: c[2], rung: c[3] === '—' ? null : c[3] };
}
const j1 = {};
const s5 = l1.slice(l1.indexOf('## 5.'), l1.indexOf('## 6.'));
for (const line of s5.split('\n')) { const c = cells(line); if (/^P\d\d$/.test(c[0] ?? '') && c[5]) j1[c[0]] = c[5].replace(/^"|"$/g, ''); }
const s4 = l1.slice(l1.indexOf('## 4.'), l1.indexOf('## 5.'));
for (const sec of s4.split(/\n### /).slice(1)) {
  const id = sec.slice(0, 3), m = sec.match(/J1 \(noul\): "([^"]+)"/);
  if (/^P\d\d$/.test(id) && m) j1[id] = m[1];
}
const shortName = name => name.replace(/\s*\(.*$/, '').replace(/->/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
const gist = name => (name.match(/\(([^)]*)\)/)?.[1] ?? '').replace(/->/g, '>').trim() || null;

const patterns = census.patterns.map(p => ({
  id: p.id, layer: 'L1', name: p.name, short: shortName(p.name), gist: gist(p.name), family: p.family,
  tier: matrix[p.id]?.tier ?? null, tierRaw: matrix[p.id]?.tierRaw ?? null, rung: matrix[p.id]?.rung ?? null, constructs: matrix[p.id]?.constructs ?? [],
  support: { items: p.items, viaNode: p.viaNode, viaToken: p.viaToken, viaPlumbing: p.viaPlumbing, oracle: p.oracle, platforms: p.nPlatforms ?? Object.keys(p.platforms ?? {}).length, grade: grade[p.id] ?? null },
  companions: companions[p.id] ?? [], when: j1[p.id] ? [{ id: 'J1', type: 'noul', instructions: j1[p.id] }] : [],
})).sort((a, b) => a.id.localeCompare(b.id));
process.stdout.write(JSON.stringify({ schema: 'l1-catalog/1', generated: census.generated, generatedBy: 'experiments/library/tools/build-catalog.mjs', patterns }, null, 1) + '\n');
