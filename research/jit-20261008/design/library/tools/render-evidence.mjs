// render-evidence.mjs: per-pattern evidence and companion tables for L1-PATTERNS.md §8 and LIBRARY.md §4 (retrieval priors).
// $0, reads only out/pattern-census.json and out/pattern-census-items.jsonl (written by pattern-census.mjs), prints markdown.
//   node research/jit-20261008/design/library/tools/render-evidence.mjs > research/jit-20261008/design/library/out/pattern-evidence.md
//
// Evidence grade (a rule, not a judgement):
//   A  >= 50 items detected by a control node or verdict token, on >= 10 platforms
//   B  >= 15 items detected by node/token, on >= 4 platforms
//   C  detected by node/token below B, or support-only (idiom keyword/shape detector, precision unmeasured)
//   D  zero genuine support (census count 0, or every hit a known false positive)
// Companions: for each pattern, the patterns most often required by the same items (lift = P(B|A) / P(B)), from `needs`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../out');
const r = JSON.parse(fs.readFileSync(path.join(OUT, 'pattern-census.json'), 'utf8'));
const rows = fs.readFileSync(path.join(OUT, 'pattern-census-items.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const KNOWN_FALSE = new Set(['P30']);   // L1-PATTERNS §1 item 3: all 7 P30 hits are spurious

const grade = p => {
  const detected = p.viaNode + p.viaToken;
  if (p.items === 0 || KNOWN_FALSE.has(p.id)) return 'D';
  if (detected >= 50 && p.nPlatforms >= 10) return 'A';
  if (detected >= 15 && p.nPlatforms >= 4) return 'B';
  return 'C';
};

// pattern sets per non-refused item (required patterns only; L0 constructs excluded)
const sets = rows.filter(x => x.status !== 'refused').map(x => new Set(Object.keys(x.needs ?? {}).filter(k => !k.startsWith('L0'))));
const N = sets.length, freq = {};
for (const s of sets) for (const p of s) freq[p] = (freq[p] ?? 0) + 1;
const companions = id => {
  const withA = sets.filter(s => s.has(id)), co = {};
  for (const s of withA) for (const p of s) if (p !== id) co[p] = (co[p] ?? 0) + 1;
  return Object.entries(co).filter(([, n]) => n >= 5)
    .map(([p, n]) => ({ p, n, lift: (n / withA.length) / (freq[p] / N) }))
    .sort((a, b) => b.lift - a.lift || b.n - a.n).slice(0, 3);
};

const L = [];
L.push(`# Pattern evidence and companions (from pattern-census.json, generated ${r.generated}; ${r.items} items)`, '');
L.push('| id | pattern | grade | items (node / token / idiom) | oracle-bearing | platforms | top edge keywords (share of the pattern\'s items) | companions (lift, co-items) | examples |');
L.push('|---|---|---|---|---|---|---|---|---|');
const order = [...r.patterns].sort((a, b) => a.id.localeCompare(b.id));
const counts = { A: 0, B: 0, C: 0, D: 0 };
for (const p of order) {
  const g = grade(p); counts[g]++;
  const ed = Object.entries(p.edge).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, n]) => `${k} ${n}${p.items ? ` (${Math.round(100 * n / p.items)}%)` : ''}`).join('; ') || '—';
  const comp = companions(p.id).map(c => `${c.p} ×${c.lift.toFixed(1)} (${c.n})`).join(', ') || '—';
  const ex = p.examples.slice(0, 2).map(e => `\`${e.replace(' [oracle]', '')}\`${e.endsWith('[oracle]') ? ' [o]' : ''}`).join(', ') || '—';
  L.push(`| ${p.id} | ${p.name} | ${g} | ${p.items} (${p.viaNode} / ${p.viaToken} / ${p.viaPlumbing}) | ${p.oracle} | ${p.nPlatforms} | ${ed} | ${comp} | ${ex} |`);
}
L.push('', `Grades: A ${counts.A}, B ${counts.B}, C ${counts.C}, D ${counts.D}. Non-refused items in the companion base: ${N}.`);

// Buildability tiers (L1-PATTERNS §7): which items could be built if only the patterns whose L0 constructs exist at a tier
// were available. Tier membership is the hand classification in L1-PATTERNS §7 (kept here as data, one list per tier).
const TIER = {
  S: 'P01 P03 P04 P05 P06 P07 P08 P09 P12 P13 P14 P15 P16 P17 P18 P20 P22 P25 P46 P48 P49 P50 P51 P53 P54',   // solver, flow-v2/v3 today
  IR: 'P02 P10 P21 P26 P27 P28 P29 P32 P34 P41 P55 P56',                                                          // envelope on today's engine IR
  HOST: 'P36 P37 P38',                                                                                            // trigger owned by the host harness (L3)
  D: 'P19 P35 P45 P47 P57',                                                                                       // designed flow-v3 primitive, not built
  N: 'P23 P30 P31 P33 P39 P40 P42 P43 P44',                                                                       // engine node not built
};
const all = rows.filter(x => x.status !== 'refused'), total = rows.length;
const steps = [['solver today (S)', ['S']], ['+ engine IR today (IR)', ['S', 'IR']], ['+ host-owned triggers (HOST)', ['S', 'IR', 'HOST']],
  ['+ designed flow-v3 (D)', ['S', 'IR', 'HOST', 'D']], ['+ unbuilt engine nodes (N)', ['S', 'IR', 'HOST', 'D', 'N']]];
L.push('', '| buildability tier (cumulative) | items buildable | share of all items |', '|---|---|---|');
for (const [name, ts] of steps) {
  const cat = new Set(ts.flatMap(t => TIER[t].split(' ')));
  const ok = all.filter(x => Object.keys(x.needs ?? {}).filter(p => !p.startsWith('L0')).every(p => cat.has(p))).length;
  L.push(`| ${name} | ${ok} | ${(100 * ok / total).toFixed(1)}% |`);
}
const short = {}, catD = new Set(['S', 'IR', 'HOST', 'D'].flatMap(t => TIER[t].split(' ')));
for (const x of all) for (const p of Object.keys(x.needs ?? {})) if (!p.startsWith('L0') && !catD.has(p)) short[p] = (short[p] ?? 0) + 1;
L.push('', 'Items blocked only by unbuilt engine nodes, per blocking pattern (an item can count under several): ' +
  Object.entries(short).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} ${n}`).join(', ') + '.');
process.stdout.write(L.join('\n') + '\n');
