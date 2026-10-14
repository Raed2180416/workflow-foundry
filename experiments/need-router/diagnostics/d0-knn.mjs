// D0: NR-knn neighbours under leave-one-cluster-out on the feature census, and the L8 share (DESIGN §6 L8, §7 M0 item 10).
// L8 asks whether a kNN router is the family-majority baseline under another name: if, for 80% or more of held-out jobs, the k
// nearest TRAIN neighbours come from one TRAIN cluster, NR-knn only ever inherits that cluster's labels and is demoted (§3).
//   metric   standardised euclidean over the 8 trusted keys (router.knnPredictor's metric: z-scores from the pool, ties by id)
//   points   one per census entry (family at difficulty 3 or 5: a proxy for a job), r4 and r5 excluded (cut from v1)
//   design   queries = held-out clusters' entries (incident, synth, ownerci, r3p); pool = TRAIN clusters' entries (W, kinetics, codefix;
//            need-qa and the anchor jobs have no census entry)
//   loco     queries = every non-cut entry; pool = the entries of every other cluster (leave one cluster out)
//   share    modal-cluster share of the k neighbours; "dominant" = share >= 0.8, "single" = all k from one cluster
//   chance   the same statistics for k pool entries drawn uniformly at random (exact enumeration), because a pool dominated by one
//            big cluster (W: 12 of 16 entries) makes a high share unremarkable
// Sensitivities: the 12-key whitelist (adds the four prose-count keys), family-collapsed points (mean of d3 and d5), k in {3, 5}.
// Evidence grade: dev (census of 2026-10-14; no archived rows).
import { loadCensus, loadStages, nearest, TRUSTED8, KEYS12, CUT_FAMILIES } from './census.mjs';
import { combinations, round, mean } from './common.mjs';

export const DOMINANT = 0.8;   // DESIGN §6 L8

const modal = ids => {
  const c = new Map();
  for (const x of ids) c.set(x, (c.get(x) ?? 0) + 1);
  const [cluster, n] = [...c].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  return { cluster, n, share: n / ids.length, clusters: Object.fromEntries(c) };
};

/** Chance level of the L8 statistics for a pool described by its clusters' sizes: all k-subsets enumerated. */
export function chanceShare(clusterOfPool, k) {
  const n = clusterOfPool.length, kk = Math.min(k, n);
  let total = 0, dominant = 0, single = 0, share = 0;
  for (const idx of combinations(n, kk)) {
    const m = modal(idx.map(i => clusterOfPool[i]));
    total += 1; share += m.share; if (m.share >= DOMINANT - 1e-9) dominant += 1; if (m.n === kk) single += 1;
  }
  return { meanShare: share / total, dominant: dominant / total, single: single / total };
}

function evaluate(queries, poolOf, clusterOf, { k, keys }) {
  const jobs = [], chanceCache = new Map();
  for (const q of queries) {
    const pool = poolOf(q);
    if (!pool.length) continue;
    const nn = nearest(pool, q, { k, keys });
    const cl = nn.map(x => clusterOf(x.entry));
    const m = modal(cl);
    const sig = pool.map(clusterOf).sort().join('|');
    if (!chanceCache.has(sig)) chanceCache.set(sig, chanceShare(pool.map(clusterOf), k));
    jobs.push({
      query: q.id, cluster: clusterOf(q), poolSize: pool.length, k: nn.length,
      neighbours: nn.map((x, i) => ({ id: x.id, cluster: cl[i], d: round(x.d, 3) })),
      modalCluster: m.cluster, modalShare: round(m.share, 3), clusters: m.clusters, single: m.n === nn.length, dominant: m.share >= DOMINANT - 1e-9,
      chance: chanceCache.get(sig),
    });
  }
  const n = jobs.length;
  const stats = {
    queries: n, meanModalShare: round(mean(jobs.map(j => j.modalShare)), 3), dominant: jobs.filter(j => j.dominant).length, single: jobs.filter(j => j.single).length,
    dominantShare: n ? round(jobs.filter(j => j.dominant).length / n, 3) : null, singleShare: n ? round(jobs.filter(j => j.single).length / n, 3) : null,
    chanceMeanShare: n ? round(mean(jobs.map(j => j.chance.meanShare)), 3) : null, chanceDominantShare: n ? round(mean(jobs.map(j => j.chance.dominant)), 3) : null,
    chanceSingleShare: n ? round(mean(jobs.map(j => j.chance.single)), 3) : null,
    modalClusterCounts: jobs.reduce((o, j) => ({ ...o, [j.modalCluster]: (o[j.modalCluster] ?? 0) + 1 }), {}),
    l8Trips: n > 0 && jobs.filter(j => j.dominant).length / n >= DOMINANT - 1e-9,
  };
  return { jobs, stats };
}

/** Collapse census entries to one point per family (mean features over the difficulties). */
export function collapseFamilies(entries) {
  const by = new Map();
  for (const e of entries) (by.get(e.family) ?? by.set(e.family, []).get(e.family)).push(e);
  return [...by].map(([family, es]) => ({ id: family, family, difficulty: null, features: Object.fromEntries(Object.keys(es[0].features).map(key => [key, mean(es.map(e => e.features[key]))])) }));
}

export function runD0({ census = loadCensus(), stagesInfo = loadStages(), ks = [3, 5] } = {}) {
  const { stages, familyCluster } = stagesInfo;
  const clusterOf = e => familyCluster.get(e.family) ?? `unclustered:${e.family}`;
  const splitOf = e => stages.clusters[clusterOf(e)]?.split ?? 'unknown';
  const live = census.entries.filter(e => !CUT_FAMILIES.includes(e.family));
  const variants = [];
  for (const level of ['entries', 'families']) {
    const pts = level === 'entries' ? live : collapseFamilies(live);
    for (const keysName of ['trusted8', 'keys12']) {
      const keys = keysName === 'trusted8' ? TRUSTED8 : KEYS12;
      for (const k of ks) {
        const design = evaluate(pts.filter(e => splitOf(e) === 'heldout'), () => pts.filter(e => splitOf(e) === 'train'), clusterOf, { k, keys });
        const loco = evaluate(pts, q => pts.filter(e => clusterOf(e) !== clusterOf(q)), clusterOf, { k, keys });
        variants.push({ level, keys: keysName, k, design, loco });
      }
    }
  }
  const primary = variants.filter(v => v.level === 'entries' && v.keys === 'trusted8');
  const sizes = {};
  for (const e of live.filter(e => splitOf(e) === 'train')) sizes[clusterOf(e)] = (sizes[clusterOf(e)] ?? 0) + 1;
  const strip = v => ({ level: v.level, keys: v.keys, k: v.k, design: v.design.stats, loco: v.loco.stats });
  return {
    id: 'D0', grade: 'dev', question: 'Do NR-knn neighbours come from one TRAIN cluster (L8)?',
    sources: [census.source, stagesInfo.source], censusErrors: census.errors,
    pool: { trainEntries: Object.values(sizes).reduce((a, b) => a + b, 0), clusterSizes: sizes, queries: live.filter(e => splitOf(e) === 'heldout').map(e => e.id), excluded: CUT_FAMILIES, noCensus: ['need-qa', 'need-constraint', 'r0-pad', 'r3-mini', 'wbed-stage', 'codefix-notests'] },
    primary: primary.map(v => ({ k: v.k, design: v.design, loco: { stats: v.loco.stats, jobs: v.loco.jobs } })),
    sensitivities: variants.filter(v => !(v.level === 'entries' && v.keys === 'trusted8')).map(strip),
    summary: Object.fromEntries(primary.map(v => [`k${v.k}`, {
      designDominantShare: v.design.stats.dominantShare, designSingleShare: v.design.stats.singleShare, designChanceDominant: v.design.stats.chanceDominantShare,
      designL8Trips: v.design.stats.l8Trips, locoDominantShare: v.loco.stats.dominantShare, locoChanceDominant: v.loco.stats.chanceDominantShare, locoL8Trips: v.loco.stats.l8Trips,
    }])),
  };
}
