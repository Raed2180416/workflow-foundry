// Value of information for the need router's probes (mechanism design §3.4). $0, pure. Before committing a family to a
// mode, the router may buy information: run k tasks with mode j and check them with a DEPLOYABLE verifier (the task's own
// tests, schema + invariants, smoke worlds; never the bed oracle, which would be a label peek). Probing pays when the
// expected improvement of the decision exceeds what the probe costs.
//
// Model. Mode m has an unknown per-task success rate p_m ~ Beta(a_m, b_m) (from the predictor's evidence, e.g. kNN counts
// plus a Beta(1,1) prior), a per-task cost c_m, an optional per-task silent-miss charge wq_m = W * q_m in dollars (the
// expected cost of delivered wrong answers; default 0) and a one-off cost F_m (build/compile). Over a horizon of H tasks
// at value V per verified success: U_m = H * (V * p_m - c_m - wq_m) - F_m, so E[U_m] uses the posterior mean of p_m.
// A probe (j, k) runs k tasks of mode j and observes s successes ~ BetaBinomial(k, a_j, b_j). It costs k * (c_j + cVerify)
// plus F_j once (a built artifact is kept if j is then chosen): dollars only, because a probe that is not delivered
// cannot deliver a wrong answer (review 2026-10-15: folding W * q into c priced every example probe k * W * q too high).
// If the probe's tasks are real tasks of the family (`deliverable`), each earns V * p_j - wq_j in expectation and the
// decision covers the remaining H - k tasks.
// EVSI(j, k) = E_s[ max_m E[U_m | s] ] - max_m E[U_m]; the net value subtracts the probe cost (and adds delivered value).
// Exact enumeration over s (k is small), so tests can check it against brute-force simulation.

/** log Beta function via lgamma (Lanczos). */
function lgamma(x) {
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
const lbeta = (a, b) => lgamma(a) + lgamma(b) - lgamma(a + b);
const lchoose = (n, k) => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);

/** P(s successes in k trials) under Beta(a, b): the Beta-Binomial pmf, for s = 0..k. */
export function betaBinomial(k, a, b) {
  const out = [];
  for (let s = 0; s <= k; s++) out.push(Math.exp(lchoose(k, s) + lbeta(a + s, b + k - s) - lbeta(a, b)));
  return out;
}

/** Expected utility of each mode over `H` tasks given Beta parameters. modes: [{ id, a, b, c, F, wq? }]. */
export function expectedUtilities(modes, { V, H }) {
  return new Map(modes.map(m => [m.id, H * (V * (m.a / (m.a + m.b)) - m.c - (m.wq ?? 0)) - m.F]));
}

const best = U => [...U].reduce((x, y) => (y[1] > x[1] ? y : x));

/**
 * Value of probing mode j with k tasks. Returns { j, k, evsi, cost, delivered, net, after: [{ s, prob, choose }] }.
 * cVerify: per-task cost of the deployable verifier. deliverable: probe tasks are real tasks of the family.
 */
export function probeValue(modes, j, k, { V, H, cVerify = 0, deliverable = false }) {
  const mj = modes.find(m => m.id === j);
  if (!mj) throw new Error(`unknown mode ${j}`);
  if (!(k >= 1 && k <= H)) throw new Error(`k must be in 1..H (${k})`);
  const Hrest = deliverable ? H - k : H;
  const prior = best(expectedUtilities(modes, { V, H }));
  const pmf = betaBinomial(k, mj.a, mj.b);
  let eMax = 0;
  const after = [];
  for (let s = 0; s <= k; s++) {
    const post = modes.map(m => (m.id === j ? { ...m, a: m.a + s, b: m.b + k - s, F: 0 } : m));   // j's one-off cost is sunk in the probe
    const [choose, u] = best(expectedUtilities(post, { V, H: Hrest }));
    eMax += pmf[s] * u;
    after.push({ s, prob: pmf[s], choose });
  }
  const cost = k * (mj.c + cVerify) + mj.F;                                   // dollars; no silent-miss charge (nothing delivered)
  const delivered = deliverable ? k * (V * (mj.a / (mj.a + mj.b)) - (mj.wq ?? 0)) : 0;
  // Without the probe: max_m E[U_m] over H. With it: delivered value of the probe tasks + E[max over the rest] - cost.
  // (When j is chosen afterwards its F was paid by the probe, which is why post-probe utilities use F_j = 0.)
  const net = delivered + eMax - cost - prior[1];
  // EVSI in the textbook sense: same horizon, no costs, no delivery.
  const evsi = (() => { let e = 0; for (let s = 0; s <= k; s++) { const post = modes.map(m => (m.id === j ? { ...m, a: m.a + s, b: m.b + k - s } : m)); e += pmf[s] * best(expectedUtilities(post, { V, H }))[1]; } return e - prior[1]; })();
  return { j, k, evsi, cost, delivered, net, priorChoice: prior[0], after };
}

/** The best probe plan over modes and k = 1..kMax (or none). Returns { probe: { j, k } | null, net, priorChoice, plans }. */
export function bestProbe(modes, { V, H, kMax = 5, cVerify = 0, deliverable = false, probeable = modes.map(m => m.id) }) {
  const plans = [];
  for (const j of probeable) for (let k = 1; k <= Math.min(kMax, H); k++) plans.push(probeValue(modes, j, k, { V, H, cVerify, deliverable }));
  const top = plans.reduce((x, y) => (y.net > x.net ? y : x), { net: 0, j: null, k: 0 });
  const priorChoice = best(expectedUtilities(modes, { V, H }))[0];
  return { probe: top.j === null || top.net <= 1e-12 ? null : { j: top.j, k: top.k }, net: top.j === null ? 0 : Math.max(0, top.net), priorChoice, plans };
}

/** Monte Carlo check of probeValue.evsi (for tests): sample p_j, then s, then decide on the posterior. */
export function evsiMonteCarlo(modes, j, k, { V, H }, { draws = 20000, rand }) {
  const mj = modes.find(m => m.id === j);
  // Beta sampling via two Gamma draws (Marsaglia-Tsang), Binomial by Bernoulli sums.
  const gamma = a => { if (a < 1) return gamma(a + 1) * rand() ** (1 / a); const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d); for (;;) { let x, v; do { const u1 = rand(), u2 = rand(); x = Math.sqrt(-2 * Math.log(u1 || 1e-12)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = rand(); if (Math.log(u || 1e-12) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v; } };
  const prior = best(expectedUtilities(modes, { V, H }))[1];
  let tot = 0;
  for (let i = 0; i < draws; i++) {
    const g1 = gamma(mj.a), g2 = gamma(mj.b), p = g1 / (g1 + g2);
    let s = 0; for (let t = 0; t < k; t++) s += rand() < p ? 1 : 0;
    const post = modes.map(m => (m.id === j ? { ...m, a: m.a + s, b: m.b + k - s } : m));
    tot += best(expectedUtilities(post, { V, H }))[1];
  }
  return tot / draws - prior;
}
