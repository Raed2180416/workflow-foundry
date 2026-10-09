#!/usr/bin/env node
// Row 33 (B14-E3): corpus variant-family census. No model calls, no network. Reads research/corpus-20261006/items.jsonl read-only.
//   node --max-old-space-size=1024 research/jit-20261008/analysis/replication/census/census.mjs
// Writes out/census.json, out/census-families-primary.tsv, out/census-top20.json.
import fs from 'node:fs';
import { normGraph, lowerBound, distance, containers, idStem, titleStem, titleTokens, jaccard } from './lib.mjs';

const CORPUS = new URL('../../../../corpus-20261006/items.jsonl', import.meta.url);
const OUT = new URL('../out/', import.meta.url);
const TAG = process.env.CENSUS_TAG ? `-${process.env.CENSUS_TAG}` : '';
const THETAS = [0.15, 0.25, 0.35], PRIMARY = 0.25, MIN_NODES = 5, LB_CAP = 0.7;   // 0.7 = 2 x the largest theta (lineage-relaxed threshold)
const t0 = Date.now();
const items = fs.readFileSync(CORPUS, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const N = items.length;
const info = items.map(it => ({ id: it.id, plat: it.source.platform, title: it.title, oracle: it.oracle?.kind ?? 'none', hasOracle: (it.oracle?.kind ?? 'none') !== 'none', g: normGraph(it), cont: containers(it), idStem: idStem(it), stem: titleStem(it.title), toks: titleTokens(it.title) }));

// ---- explicit lineage metadata scan (reported, not used for grouping) ----
const LIN_RE = /\b(fork(ed)? (of|from)|adapted from|copy of|derived from|duplicate of|variant of|clone of|modified from|remix(ed)? (of|from))\b/i;
const metaHits = items.filter(it => LIN_RE.test([it.title, it.description?.text, it.oracle?.notes, it.ir?.notes].join(' '))).map(it => it.id);

// ---- pairs within a platform ----
const byPlat = new Map(); info.forEach((x, i) => { if (!byPlat.has(x.plat)) byPlat.set(x.plat, []); byPlat.get(x.plat).push(i); });
const pairs = [];   // {a, b, d, approx, L: {stem,id,dir}}
let nPairsTotal = 0, nPrunedLb = 0, nAssign = 0, nApprox = 0, nLineagePairs = 0;
for (const [plat, ids] of byPlat) {
  for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) {
    const a = ids[x], b = ids[y], A = info[a], B = info[b];
    nPairsTotal++;
    const L = {
      stem: A.stem.length >= 6 && A.stem === B.stem,
      id: A.idStem === B.idStem,
      dir: !!A.cont.dir && A.cont.dir === B.cont.dir && jaccard(A.toks, B.toks) >= 0.5,
    };
    const linked = L.stem || L.id || L.dir;
    if (linked) nLineagePairs++;
    const big = A.g.n >= MIN_NODES && B.g.n >= MIN_NODES;
    let d = null, approx = false;
    if (big) {
      if (lowerBound(A.g, B.g) > LB_CAP) nPrunedLb++;
      else { const r = distance(A.g, B.g); d = r.d; approx = r.approx; if (approx) nApprox++; else nAssign++; }
    }
    if (linked || d !== null) pairs.push({ a, b, d, approx, L, linked });
  }
}

// ---- clustering ----
function components(edges) {
  const p = Array.from({ length: N }, (_, i) => i);
  const find = x => { while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; } return x; };
  for (const [a, b] of edges) { const ra = find(a), rb = find(b); if (ra !== rb) p[ra] = rb; }
  const m = new Map(); for (let i = 0; i < N; i++) { const r = find(i); if (!m.has(r)) m.set(r, []); m.get(r).push(i); }
  return [...m.values()].filter(f => f.length >= 2);
}
// complete linkage: merge two clusters (ascending pair distance) only if every cross pair is known and within its own threshold
function completeLinkage(cands, thr) {
  const dist = new Map(), key = (a, b) => (a < b ? a * N + b : b * N + a);
  for (const c of cands) dist.set(key(c.a, c.b), c);
  const owner = Array.from({ length: N }, (_, i) => i), members = new Map();   // cluster id -> member list (only for clusters of size >= 2)
  const group = i => members.get(owner[i]) ?? [i];
  for (const c of cands.slice().sort((x, y) => x.d - y.d)) {
    if (owner[c.a] === owner[c.b]) continue;
    const ga = group(c.a), gb = group(c.b);
    let ok = true;
    outer: for (const u of ga) for (const v of gb) { const e = dist.get(key(u, v)); if (!e || e.d > thr(e) + 1e-12) { ok = false; break outer; } }
    if (!ok) continue;
    const keep = owner[c.a], drop = owner[c.b], merged = ga.concat(gb);
    for (const v of gb) owner[v] = keep;
    members.delete(drop); members.set(keep, merged);
  }
  return [...members.values()].filter(f => f.length >= 2);
}

function definitions(theta) {
  const withD = pairs.filter(p => p.d !== null);
  return {
    'F_L lineage only': { single: components(pairs.filter(p => p.linked).map(p => [p.a, p.b])), complete: null },
    'F_S structure only': { single: components(withD.filter(p => p.d <= theta).map(p => [p.a, p.b])), complete: completeLinkage(withD.filter(p => p.d <= theta), () => theta) },
    'F_LS lineage+structure (primary)': {
      single: components(withD.filter(p => p.d <= theta || (p.linked && p.d <= 2 * theta)).map(p => [p.a, p.b])),
      complete: completeLinkage(withD.filter(p => p.d <= theta || (p.linked && p.d <= 2 * theta)), e => (e.linked ? 2 * theta : theta)),
    },
  };
}

const orc = f => f.filter(i => info[i].hasOracle).length;
function summarise(fams) {
  const big = fams.filter(f => f.length >= 3);
  const sizeBins = { '2': 0, '3': 0, '4': 0, '5-9': 0, '10-19': 0, '20+': 0 };
  for (const f of fams) sizeBins[f.length === 2 ? '2' : f.length === 3 ? '3' : f.length === 4 ? '4' : f.length < 10 ? '5-9' : f.length < 20 ? '10-19' : '20+']++;
  return {
    families_ge2: fams.length, families_ge3: big.length, items_in_families_ge3: big.reduce((a, f) => a + f.length, 0), max_size: Math.max(0, ...fams.map(f => f.length)),
    size_distribution: sizeBins,
    ge3_with_ge3_oracle_members: big.filter(f => orc(f) >= 3).length,        // PRIMARY oracle criterion
    ge3_all_members_oracle: big.filter(f => orc(f) === f.length).length,
    ge3_any_member_oracle: big.filter(f => orc(f) >= 1).length,
    ge3_with_ge2_oracle_members: big.filter(f => orc(f) >= 2).length,
  };
}

const results = {};
let primaryFams = null;
for (const theta of THETAS) {
  const defs = definitions(theta);
  results[theta] = {};
  for (const [name, { single, complete }] of Object.entries(defs)) {
    results[theta][name] = { single: summarise(single), complete: complete ? summarise(complete) : null };
    if (theta === PRIMARY && name.startsWith('F_LS')) primaryFams = single;
  }
}

// ---- primary families in detail ----
const dmap = new Map(); for (const p of pairs) if (p.d !== null) dmap.set(p.a * N + p.b, p);
const pd = (a, b) => dmap.get(a < b ? a * N + b : b * N + a);
const fmtFam = (f, rank) => {
  let diam = 0, approx = false, nEdgeS = 0, nEdgeL = 0, nUnknown = 0;
  for (let x = 0; x < f.length; x++) for (let y = x + 1; y < f.length; y++) { const p = pd(f[x], f[y]); if (!p) { nUnknown++; continue; } diam = Math.max(diam, p.d); approx ||= p.approx; if (p.d <= PRIMARY) nEdgeS++; else if (p.linked && p.d <= 2 * PRIMARY) nEdgeL++; }
  const plats = {}; for (const i of f) plats[info[i].plat] = (plats[info[i].plat] ?? 0) + 1;
  const kinds = {}; for (const i of f) kinds[info[i].oracle] = (kinds[info[i].oracle] ?? 0) + 1;
  const nodes = f.map(i => info[i].g.n).sort((a, b) => a - b);
  return { rank, size: f.length, platforms: plats, oracleKinds: kinds, oracleBearing: orc(f), nodesMinMedMax: [nodes[0], nodes[nodes.length >> 1], nodes.at(-1)], diameter: Number(diam.toFixed(3)), pairsAtTheta: nEdgeS, pairsLineageRelaxed: nEdgeL, pairsNotLinked: nUnknown, approxDistance: approx,
    sampleIds: f.slice(0, 4).map(i => info[i].id.slice(0, 90)), sampleTitles: f.slice(0, 3).map(i => info[i].title.slice(0, 70)) };
};
const ranked = primaryFams.slice().sort((a, b) => b.length - a.length || orc(b) - orc(a));
const top20 = ranked.slice(0, 20).map((f, i) => fmtFam(f, i + 1));
const eligible = primaryFams.filter(f => f.length >= 3 && orc(f) >= 3).sort((a, b) => b.length - a.length).map((f, i) => fmtFam(f, i + 1));

// the five pilots
const PILOTS = ['n8n:12679', 'n8n:20281', 'home-assistant:CCOSTAN/Home-AssistantConfig/config/automation/Speech/garbage_day_garage.yaml#0', 'galaxy:iwc/variation-reporting/Generic-variation-analysis-reporting', 'github-actions:shafthq/shaft_engine/.github/workflows/update-selenium-grid-versions.yml'];
const famOf = new Map(); primaryFams.forEach((f, k) => f.forEach(i => famOf.set(i, k)));
const pilots = PILOTS.map(id => {
  const i = info.findIndex(x => x.id === id);
  if (i < 0) return { id, found: false };
  const f = famOf.has(i) ? primaryFams[famOf.get(i)] : null;
  return { id, found: true, nodes: info[i].g.n, oracle: info[i].oracle, familySize: f ? f.length : 1, familyOracleBearing: f ? orc(f) : info[i].hasOracle ? 1 : 0, familyPlatforms: f ? [...new Set(f.map(j => info[j].plat))] : [info[i].plat] };
});

// platform / oracle profile
const platProfile = {}; for (const x of info) { const p = (platProfile[x.plat] ??= { items: 0, oracle: 0, small: 0, inPrimaryFamGe3: 0 }); p.items++; p.oracle += x.hasOracle; p.small += x.g.n < MIN_NODES; }
for (const f of primaryFams) if (f.length >= 3) for (const i of f) platProfile[info[i].plat].inPrimaryFamGe3++;
const kindCounts = {}; for (const x of info) kindCounts[x.oracle] = (kindCounts[x.oracle] ?? 0) + 1;

const out = {
  generatedBy: 'research/jit-20261008/analysis/replication/census/census.mjs', corpus: 'research/corpus-20261006/items.jsonl', items: N, seconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
  parameters: { thetas: THETAS, primaryTheta: PRIMARY, minNodes: MIN_NODES, lineageRelaxedThreshold: '2 x theta', largeGraphNodes: Number(process.env.CENSUS_LARGE ?? 120), lbCap: LB_CAP,
    nodeSubCost: 'label equal 0; same category+effects 0.4; same category 0.8; else 1', edgeProfileCost: '0.5 x L1 over (direction, kind, neighbour category) multisets', distance: 'bipartite assignment upper bound / max(nodes+edges)' },
  metadataScan: { explicitLineageHits: metaHits.length, hits: metaHits.slice(0, 50), note: 'phrase scan over title, description, oracle and IR notes; none of the schema fields records a fork or template parent' },
  pairs: { withinPlatformPairs: nPairsTotal, prunedByLowerBound: nPrunedLb, assignmentDistances: nAssign, signatureDistances: nApprox, lineageLinkedPairs: nLineagePairs },
  smallGraphsExcluded: { under5Nodes: info.filter(x => x.g.n < MIN_NODES).length, ofWhichWithOracle: info.filter(x => x.g.n < MIN_NODES && x.hasOracle).length },
  oracleKindCounts: kindCounts, platformProfile: platProfile, results, top20, eligibleFamilies: eligible, pilots,
  killRule: { text: 'fewer than 10 families with >=3 variants and shipped oracles', primaryDefinition: 'F_LS single linkage, theta 0.25, >=3 members with an oracle', count: eligible.length, fires: eligible.length < 10 },
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(new URL(`census${TAG}.json`, OUT), JSON.stringify(out, null, 1));
fs.writeFileSync(new URL(`census-top20${TAG}.json`, OUT), JSON.stringify(top20, null, 1));
const tsv = ['family\tsize\toracleBearing\tplatforms\tdiameter\tsampleIds'];
ranked.forEach((f, i) => { const r = fmtFam(f, i + 1); tsv.push([r.rank, r.size, r.oracleBearing, Object.entries(r.platforms).map(([k, v]) => `${k}:${v}`).join(','), r.diameter, r.sampleIds.slice(0, 3).join(' | ')].join('\t')); });
fs.writeFileSync(new URL(`census-families-primary${TAG}.tsv`, OUT), tsv.join('\n') + '\n');
console.log(JSON.stringify({ items: N, seconds: out.seconds, pairs: out.pairs, small: out.smallGraphsExcluded, metaHits: metaHits.length, killRule: out.killRule }, null, 1));
for (const th of THETAS) for (const [n, r] of Object.entries(results[th])) console.log(th, n.padEnd(34), 'single: ge3', r.single.families_ge3, 'oracle>=3', r.single.ge3_with_ge3_oracle_members, 'all', r.single.ge3_all_members_oracle, 'any', r.single.ge3_any_member_oracle, '| complete:', r.complete ? `ge3 ${r.complete.families_ge3} oracle>=3 ${r.complete.ge3_with_ge3_oracle_members}` : '-');
