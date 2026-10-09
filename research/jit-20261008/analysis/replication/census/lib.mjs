// Graph normalisation, bipartite (Riesen-Bunke) graph edit distance upper bound, and lineage proxies for the corpus census (row 33).
// Pure functions, no I/O. Corpus text is data: only structure fields are used for the distance; title/id strings only for lineage proxies.

// ---------------------------------------------------------------- normalisation
// Node label = category | effects | normalised type. Normalised type: lower case, uuids and digit runs (ids, versions, counters) replaced by '#'.
export const typeNorm = t => String(t ?? '').toLowerCase().replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '#').replace(/\d+/g, '#').replace(/#+/g, '#').trim();
export function normGraph(item) {
  const nodes = item.graph.nodes, idx = new Map(nodes.map((n, i) => [n.id, i]));
  const lab = nodes.map(n => `${n.category}|${n.effects}|${typeNorm(n.type)}`);
  const cls = nodes.map(n => `${n.category}|${n.effects}`);
  const cat = nodes.map(n => n.category);
  const edges = [];
  for (const e of item.graph.edges ?? []) { const a = idx.get(e.from), b = idx.get(e.to); if (a !== undefined && b !== undefined) edges.push([a, b, e.kind]); }
  // edge profile of a node: multiset of (direction, kind, neighbour category)
  const prof = nodes.map(() => new Map());
  const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const [a, b, k] of edges) { bump(prof[a], `o|${k}|${cat[b]}`); bump(prof[b], `i|${k}|${cat[a]}`); }
  const deg = prof.map(p => [...p.values()].reduce((x, y) => x + y, 0));
  return { n: nodes.length, m: edges.length, lab, cls, cat, prof, deg, size: nodes.length + edges.length, edges };
}

// ---------------------------------------------------------------- distance
const l1 = (p, q) => { let s = 0; for (const [k, v] of p) s += Math.abs(v - (q.get(k) ?? 0)); for (const [k, v] of q) if (!p.has(k)) s += v; return s; };
const subCost = (A, i, B, j) => (A.lab[i] === B.lab[j] ? 0 : A.cls[i] === B.cls[j] ? 0.4 : A.cat[i] === B.cat[j] ? 0.8 : 1);
const maxSize = (A, B) => Math.max(A.size, B.size, 1);

/** Cheap lower bounds on the edit distance, normalised: size difference and node-class multiset. Valid for the cost model above. */
export function lowerBound(A, B) {
  const sizeLb = Math.abs(A.n - B.n) + Math.abs(A.m - B.m);
  const c = new Map();
  for (const k of A.cls) c.set(k, (c.get(k) ?? 0) + 1);
  for (const k of B.cls) c.set(k, (c.get(k) ?? 0) - 1);
  let ex = 0; for (const v of c.values()) ex += Math.abs(v);
  return Math.max(sizeLb, 0.5 * ex) / maxSize(A, B);
}

// Hungarian algorithm (min cost perfect matching on a square matrix), O(N^3).
function hungarian(a, N) {
  const INF = 1e18, u = new Float64Array(N + 1), v = new Float64Array(N + 1), p = new Int32Array(N + 1), way = new Int32Array(N + 1);
  for (let i = 1; i <= N; i++) {
    p[0] = i; let j0 = 0;
    const minv = new Float64Array(N + 1).fill(INF), used = new Uint8Array(N + 1);
    do {
      used[j0] = 1; const i0 = p[j0]; let delta = INF, j1 = 0;
      for (let j = 1; j <= N; j++) if (!used[j]) {
        const cur = a[(i0 - 1) * N + (j - 1)] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= N; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  return -v[0];
}

export const LARGE = Number(process.env.CENSUS_LARGE ?? 120);   // graphs above this many nodes use the signature distance instead of the assignment (cost O(N^3)); env CENSUS_LARGE raises it for the robustness run

/** Upper bound on the graph edit distance (bipartite assignment over nodes with local edge-profile costs), exact for identical graphs. */
export function gedUpper(A, B) {
  const n = A.n, m = B.n, N = n + m;
  const C = new Float64Array(N * N);
  const big = 1e9;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) C[i * N + j] = subCost(A, i, B, j) + 0.5 * l1(A.prof[i], B.prof[j]);
    for (let j = 0; j < n; j++) C[i * N + m + j] = i === j ? 1 + 0.5 * A.deg[i] : big;   // delete node i with its incident edges
  }
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) C[(n + i) * N + j] = i === j ? 1 + 0.5 * B.deg[i] : big;   // insert node i
    // dummy-dummy block stays 0
  }
  return hungarian(C, N);
}

/** Signature distance for large graphs: node-label multiset + edge-profile multiset mismatch, normalised. A lower-bound-flavoured proxy, flagged approx. */
export function sigDistance(A, B) {
  const ms = (xs) => { const m = new Map(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return m; };
  const nl = l1(ms(A.lab), ms(B.lab)) / 2;           // nodes to insert/delete/relabel
  const profs = g => ms(g.prof.map(p => [...p].sort().map(([k, v]) => `${k}:${v}`).join(',')));
  const ep = l1(profs(A), profs(B)) / 2;
  return Math.max(nl + Math.abs(A.m - B.m), ep) / maxSize(A, B);
}

/** Normalised distance in [0,1]-ish: edit cost / larger graph's (nodes+edges). Returns {d, approx}. */
export function distance(A, B) {
  if (A.n > LARGE || B.n > LARGE) return { d: Math.min(1, sigDistance(A, B)), approx: true };
  return { d: Math.max(0, Math.min(1, gedUpper(A, B) / maxSize(A, B))) || 0, approx: false };
}

// ---------------------------------------------------------------- lineage proxies
const STOP = new Set(['v', 'ver', 'version', 'copy', 'final', 'new', 'old', 'test', 'example', 'the', 'a', 'an', 'of', 'and', 'for', 'to', 'with', 'in', 'on']);
export const titleTokens = t => String(t ?? '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[0-9]+/g, ' ').split(/[^\p{L}]+/u).filter(w => w.length > 1 && !STOP.has(w));
export const titleStem = t => titleTokens(t).join(' ');
export const jaccard = (a, b) => { const A = new Set(a), B = new Set(b); if (!A.size && !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i); };

/** Source containers from id/url: repo (owner/repo), dir (repo + directory of the file), file (path before '#'). Null where the source has no container. */
export function containers(item) {
  const id = item.id, url = item.source.url ?? '', plat = item.source.platform;
  const gh = /github\.com\/([^/]+)\/([^/]+)\/blob\/[^/]+\/(.+)$/.exec(url);
  if (gh) { const path = decodeURIComponent(gh[3]); const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''; return { repo: `${gh[1]}/${gh[2]}`, dir: `${gh[1]}/${gh[2]}/${dir}`, file: `${gh[1]}/${gh[2]}/${path}` }; }
  const body = id.slice(plat.length + 1).split('#')[0];
  if (plat === 'airflow' || plat === 'galaxy' || plat === 'nextflow' || plat === 'cwl' || plat === 'snakemake' || plat === 'argo' || plat === 'prefect' || plat === 'langgraph') {
    const parts = body.split('/'); const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
    return { repo: parts.length > 1 ? parts[0] : null, dir: dir ? `${plat}:${dir}` : null, file: `${plat}:${body}` };
  }
  return { repo: null, dir: null, file: null };
}
/** Id stem: the id without a trailing version (@x.y.z), so two releases of one pipeline share it. */
export const idStem = item => item.id.replace(/@[^/@]+$/, '');
