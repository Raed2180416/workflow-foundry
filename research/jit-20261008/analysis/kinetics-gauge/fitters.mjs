// Kinetics gauge, Stage A: fitters written from the SOP (SOP-* rev text, section 5), independent of beds/kinetics/fit.mjs.
//
// SOP section 5 (verbatim rules this file implements):
//   - fit each condition separately by UNWEIGHTED NONLINEAR LEAST SQUARES of v = Vmax*[S]/(Km+[S]) to all retained
//     individual wells (every replicate well is its own point; do not average replicates first; no linearised plots);
//   - competitive-inhibitor conditions: fix Vmax to the value fitted for the inhibitor-free condition with the same pH and
//     temperature, fit only the apparent Km, report the shared Vmax.
//
// SOP-compliant fitters (two independent algorithms for the same estimator):
//   fitA  Levenberg-Marquardt on (ln Vmax, ln Km), multi-start, tolerance ~1e-15.
//   fitB  Variable projection: Vmax in closed form, 1-D Brent minimisation over ln Km after a coarse 400-point bracket.
// Neither calls beds/kinetics/fit.mjs.
//
// SOP-violating but plausible variants (what an agent might do instead; used as a sensitivity analysis, never as "the" answer):
//   means    NLLS on replicate means (SOP: "do not average replicates first")
//   wls      weighted NLLS, weights 1/v^2 (minimises relative error)
//   hanes    Hanes-Woolf linearisation S/v vs S
//   lb       Lineweaver-Burk linearisation 1/v vs 1/S   (named and forbidden by the SOP)
//   eadie    Eadie-Hofstee linearisation v vs v/S
//
// A point is { S, v } in the canonical units (uM, uM/s). Every fit returns { vmax, km }.

const finite = p => Number.isFinite(p.S) && Number.isFinite(p.v) && p.S > 0;

// ---------- SOP-compliant fitter A: Levenberg-Marquardt ----------
function sseAt(pts, V, K) { let s = 0; for (const { S, v } of pts) { const r = v - V * S / (K + S); s += r * r; } return s; }
function closedV(pts, K) { let a = 0, b = 0; for (const { S, v } of pts) { const f = S / (K + S); a += f * f; b += v * f; } return a > 0 ? b / a : 0; }

function lm(pts, K0, fixedV) {
  let lnK = Math.log(K0), lnV = Math.log(Math.max(fixedV ?? closedV(pts, K0), 1e-300));
  const free = fixedV == null;
  let lam = 1e-3, cost = sseAt(pts, Math.exp(lnV), Math.exp(lnK));
  for (let it = 0; it < 500; it++) {
    const V = Math.exp(lnV), K = Math.exp(lnK);
    // normal equations for residuals r_i = v_i - V S/(K+S), parameters theta = (lnV, lnK)
    let h11 = 0, h12 = 0, h22 = 0, g1 = 0, g2 = 0;
    for (const { S, v } of pts) {
      const f = S / (K + S), r = v - V * f;
      const j1 = -V * f, j2 = V * S * K / ((K + S) * (K + S));   // d r / d lnV, d r / d lnK
      h11 += j1 * j1; h12 += j1 * j2; h22 += j2 * j2; g1 += j1 * r; g2 += j2 * r;
    }
    let improved = false;
    for (let tries = 0; tries < 40; tries++) {
      let dV = 0, dK;
      if (free) {
        const a = h11 * (1 + lam), d = h22 * (1 + lam), det = a * d - h12 * h12;
        if (!(det > 0)) { lam *= 10; continue; }
        dV = -(d * g1 - h12 * g2) / det; dK = -(a * g2 - h12 * g1) / det;
      } else dK = -g2 / (h22 * (1 + lam));
      const nV = lnV + dV, nK = lnK + dK;
      const c = sseAt(pts, Math.exp(nV), Math.exp(nK));
      if (Number.isFinite(c) && c <= cost) {
        const rel = Math.abs(cost - c) / Math.max(cost, 1e-300), step = Math.hypot(dV, dK);
        lnV = nV; lnK = nK; cost = c; lam = Math.max(lam / 10, 1e-15); improved = true;
        if (step < 1e-14 || rel < 1e-16) return { vmax: Math.exp(lnV), km: Math.exp(lnK), sse: cost };
        break;
      }
      lam *= 10;
    }
    if (!improved) break;
  }
  return { vmax: Math.exp(lnV), km: Math.exp(lnK), sse: cost };
}

export function fitA(points, { fixedV = null } = {}) {
  const pts = points.filter(finite);
  if (pts.length < 2) return { vmax: NaN, km: NaN };
  const Ss = pts.map(p => p.S).sort((a, b) => a - b);
  let best = null;
  for (const q of [0.1, 0.3, 0.5, 0.7, 0.9]) {            // multi-start on Km0 = quantiles of S
    const r = lm(pts, Ss[Math.min(Ss.length - 1, Math.floor(q * Ss.length))], fixedV);
    if (!best || r.sse < best.sse) best = r;
  }
  return { vmax: fixedV ?? best.vmax, km: best.km };
}

// ---------- SOP-compliant fitter B: variable projection + Brent ----------
function brent(f, a, b, tol = 1e-13, maxIt = 400) {
  const C = 0.3819660112501051;
  let x = a + C * (b - a), w = x, v = x, fx = f(x), fw = fx, fv = fx, d = 0, e = 0;
  for (let it = 0; it < maxIt; it++) {
    const m = 0.5 * (a + b), t1 = tol * Math.abs(x) + 1e-15, t2 = 2 * t1;
    if (Math.abs(x - m) <= t2 - 0.5 * (b - a)) break;
    let useGolden = true;
    if (Math.abs(e) > t1) {
      const r = (x - w) * (fx - fv), q0 = (x - v) * (fx - fw);
      let p = (x - v) * q0 - (x - w) * r, q = 2 * (q0 - r);
      if (q > 0) p = -p; q = Math.abs(q);
      if (Math.abs(p) < Math.abs(0.5 * q * e) && p > q * (a - x) && p < q * (b - x)) {
        e = d; d = p / q; const u = x + d;
        if (u - a < t2 || b - u < t2) d = x < m ? t1 : -t1;
        useGolden = false;
      }
    }
    if (useGolden) { e = (x >= m ? a : b) - x; d = C * e; }
    const u = Math.abs(d) >= t1 ? x + d : x + (d > 0 ? t1 : -t1), fu = f(u);
    if (fu <= fx) { if (u >= x) a = x; else b = x; v = w; fv = fw; w = x; fw = fx; x = u; fx = fu; }
    else {
      if (u < x) a = u; else b = u;
      if (fu <= fw || w === x) { v = w; fv = fw; w = u; fw = fu; } else if (fu <= fv || v === x || v === w) { v = u; fv = fu; }
    }
  }
  return x;
}

// weights default to 1 (unweighted, the SOP's estimator)
function vp(pts, fixedV, wt = null) {
  const W = wt ?? pts.map(() => 1);
  const sse = lk => {
    const K = Math.exp(lk);
    let a = 0, b = 0;
    if (fixedV == null) { for (let i = 0; i < pts.length; i++) { const f = pts[i].S / (K + pts[i].S); a += W[i] * f * f; b += W[i] * pts[i].v * f; } }
    const V = fixedV ?? (a > 0 ? b / a : 0);
    let s = 0;
    for (let i = 0; i < pts.length; i++) { const r = pts[i].v - V * pts[i].S / (K + pts[i].S); s += W[i] * r * r; }
    return s;
  };
  const Ss = pts.map(p => p.S), lo = Math.log(Math.min(...Ss) / 1000), hi = Math.log(Math.max(...Ss) * 1000), N = 400;
  let bi = 0, bv = Infinity;
  for (let i = 0; i <= N; i++) { const val = sse(lo + (hi - lo) * i / N); if (val < bv) { bv = val; bi = i; } }
  const step = (hi - lo) / N, lk = brent(sse, lo + step * Math.max(0, bi - 1), lo + step * Math.min(N, bi + 1));
  const K = Math.exp(lk);
  let a = 0, b = 0;
  for (let i = 0; i < pts.length; i++) { const f = pts[i].S / (K + pts[i].S); a += W[i] * f * f; b += W[i] * pts[i].v * f; }
  return { vmax: fixedV ?? (a > 0 ? b / a : 0), km: K };
}

export function fitB(points, { fixedV = null } = {}) {
  const pts = points.filter(finite);
  return pts.length < 2 ? { vmax: NaN, km: NaN } : vp(pts, fixedV);
}

// ---------- SOP-violating variants ----------
function ols(xs, ys) { const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n; let sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); } const slope = sxy / sxx; return { slope, icpt: my - slope * mx }; }
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

export function fitMeans(points, o = {}) {
  const by = new Map();
  for (const p of points.filter(finite)) { const k = p.S.toPrecision(10); if (!by.has(k)) by.set(k, []); by.get(k).push(p); }
  return fitB([...by.values()].map(g => ({ S: g[0].S, v: mean(g.map(p => p.v)) })), o);
}
export function fitWLS(points, { fixedV = null } = {}) {
  const pts = points.filter(p => finite(p) && p.v > 0);
  return vp(pts, fixedV, pts.map(p => 1 / (p.v * p.v)));
}
export function fitHanes(points, { fixedV = null } = {}) {
  const pts = points.filter(p => finite(p) && p.v > 0);
  if (fixedV != null) return { vmax: fixedV, km: fixedV * mean(pts.map(p => p.S / p.v - p.S / fixedV)) };
  const { slope, icpt } = ols(pts.map(p => p.S), pts.map(p => p.S / p.v));
  return { vmax: 1 / slope, km: icpt / slope };
}
export function fitLB(points, { fixedV = null } = {}) {
  const pts = points.filter(p => finite(p) && p.v > 0);
  if (fixedV != null) { const x = pts.map(p => 1 / p.S), y = pts.map((p, i) => 1 / p.v - 1 / fixedV); return { vmax: fixedV, km: fixedV * x.reduce((s, xi, i) => s + xi * y[i], 0) / x.reduce((s, xi) => s + xi * xi, 0) }; }
  const { slope, icpt } = ols(pts.map(p => 1 / p.S), pts.map(p => 1 / p.v));
  return { vmax: 1 / icpt, km: slope / icpt };
}
export function fitEadie(points, { fixedV = null } = {}) {
  const pts = points.filter(p => finite(p) && p.v > 0);
  const x = pts.map(p => p.v / p.S);
  if (fixedV != null) { const y = pts.map(p => p.v - fixedV); return { vmax: fixedV, km: -x.reduce((s, xi, i) => s + xi * y[i], 0) / x.reduce((s, xi) => s + xi * xi, 0) }; }
  const { slope, icpt } = ols(x, pts.map(p => p.v));
  return { vmax: icpt, km: -slope };
}

export const SOP_FITTERS = { A: fitA, B: fitB };
export const VARIANT_FITTERS = { means: fitMeans, wls: fitWLS, hanes: fitHanes, lb: fitLB, eadie: fitEadie };

// ---------- from retained points to the answer object ----------
// retained: { condId: [{S, v}] } already cleaned; conds: [{ id, parentId }] (parentId set for inhibitor conditions).
// Returns { conditions: [{condition_id, vmax, km}], excluded_samples }.
export function fitAnswer(conds, retained, excluded, fitter) {
  const fits = {};
  for (const c of conds.filter(c => !c.parentId)) fits[c.id] = fitter(retained[c.id] ?? []);
  for (const c of conds.filter(c => c.parentId)) fits[c.id] = fitter(retained[c.id] ?? [], { fixedV: fits[c.parentId].vmax });
  return {
    conditions: conds.map(c => ({ condition_id: c.id, vmax: fits[c.id].vmax, km: fits[c.id].km })),
    excluded_samples: [...excluded].sort(),
  };
}

export const sigfig = (x, n) => (x === 0 || !Number.isFinite(x) ? x : Number(x.toPrecision(n)));
