// Michaelis-Menten fitting for the `kinetics` bed: unweighted nonlinear least squares by
// variable projection (Vmax solved in closed form for each Km), a log-spaced Km grid and a
// golden-section refinement. Deterministic, dependency-free, fast enough for rejection loops.

const PHI = (Math.sqrt(5) - 1) / 2;

function sseFor(points, km, fixedV) {
  let sff = 0, svf = 0;
  for (const { S, v } of points) { const f = S / (km + S); sff += f * f; svf += v * f; }
  const vmax = fixedV ?? (sff > 0 ? svf / sff : 0);
  let sse = 0;
  for (const { S, v } of points) { const r = v - vmax * S / (km + S); sse += r * r; }
  return { sse, vmax };
}

function golden(fn, a, b, iters = 80) {
  let c = b - PHI * (b - a), d = a + PHI * (b - a);
  let fc = fn(c), fd = fn(d);
  for (let i = 0; i < iters; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - PHI * (b - a); fc = fn(c); }
    else { a = c; c = d; fc = fd; d = a + PHI * (b - a); fd = fn(d); }
  }
  return (a + b) / 2;
}

// points: [{ S, v }] in any consistent units. Returns { vmax, km, sse, n }.
// With fixedV, only Km is fitted (competitive-inhibitor rule in the SOP).
export function fitMM(points, { fixedV = null } = {}) {
  const pts = points.filter(p => Number.isFinite(p.S) && Number.isFinite(p.v) && p.S > 0);
  if (pts.length < 2) return { vmax: NaN, km: NaN, sse: NaN, n: pts.length };
  const Ss = pts.map(p => p.S);
  const lo = Math.log(Math.min(...Ss) / 200), hi = Math.log(Math.max(...Ss) * 200);
  const N = 160;
  const obj = lk => sseFor(pts, Math.exp(lk), fixedV).sse;
  let best = 0, bestVal = Infinity;
  const grid = [];
  for (let i = 0; i <= N; i++) { const lk = lo + (hi - lo) * i / N; const val = obj(lk); grid.push(lk); if (val < bestVal) { bestVal = val; best = i; } }
  const a = grid[Math.max(0, best - 1)], b = grid[Math.min(N, best + 1)];
  const lk = golden(obj, a, b);
  const km = Math.exp(lk);
  const { sse, vmax } = sseFor(pts, km, fixedV);
  return { vmax, km, sse, n: pts.length };
}

// Fit on replicate means (grouped by S) — a common alternative analysis used as a robustness check.
export function fitMMMeans(points, opts) {
  const by = new Map();
  for (const p of points) { const k = p.S.toPrecision(10); if (!by.has(k)) by.set(k, []); by.get(k).push(p); }
  const means = [...by.values()].map(g => ({ S: g[0].S, v: g.reduce((s, p) => s + p.v, 0) / g.length }));
  return fitMM(means, opts);
}

export const relErr = (x, truth) => Math.abs(x - truth) / Math.abs(truth);
