// Small exact tests for the SW-1 analyses (review of RESULT-SW-1, defect 12). The frozen analyzer's McNemar treats the
// two backlog nodes of a task as independent pairs; they share a world, a run and (for the directed arms) a parent. The
// clustered alternative here treats the task as the unit: per task, d = (backlog nodes passed by arm a) - (by arm b), in
// {-2..2}; the exact sign-flip (paired permutation) test flips the sign of every nonzero d and asks how often |sum d| is at
// least the observed one. The task-level sign test counts tasks with d > 0 vs d < 0.

/** Two-sided exact binomial p for k of n at p = 0.5 (the McNemar exact test on discordant pairs). */
export function binom2(k, n) {
  if (!n) return 1;
  const pmf = i => { let c = 1; for (let j = 0; j < i; j++) c = c * (n - j) / (j + 1); return c / 2 ** n; };
  const m = Math.min(k, n - k); let p = 0; for (let i = 0; i <= m; i++) p += pmf(i);
  return Math.min(1, 2 * p);
}

/** Exact two-sided sign-flip test on per-cluster differences. Returns { n (nonzero clusters), sum, p }. */
export function signFlip(diffs) {
  const d = diffs.filter(x => x !== 0), obs = Math.abs(d.reduce((a, b) => a + b, 0));
  if (!d.length) return { n: 0, sum: 0, p: 1 };
  if (d.length > 24) throw new Error('signFlip: too many clusters for exact enumeration');
  let hit = 0;
  for (let mask = 0; mask < 2 ** d.length; mask++) {
    let s = 0;
    for (let i = 0; i < d.length; i++) s += (mask >> i) & 1 ? -d[i] : d[i];
    if (Math.abs(s) >= obs - 1e-12) hit++;
  }
  return { n: d.length, sum: d.reduce((a, b) => a + b, 0), p: hit / 2 ** d.length };
}

/** One-sided Fisher exact p (a/(a+b) greater than c/(c+d)) for the 2x2 table [[a, b], [c, d]]. */
export function fisherGreater(a, b, c, d) {
  const lf = n => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
  const r1 = a + b, r2 = c + d, c1 = a + c, n = r1 + r2;
  const hyp = x => Math.exp(lf(r1) + lf(r2) + lf(c1) + lf(n - c1) - lf(n) - lf(x) - lf(r1 - x) - lf(c1 - x) - lf(r2 - c1 + x));
  let p = 0; for (let x = a; x <= Math.min(r1, c1); x++) p += hyp(x);
  return Math.min(1, p);
}
