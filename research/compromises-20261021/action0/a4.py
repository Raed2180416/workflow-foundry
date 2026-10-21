# Compromise register A4 check (2026-10-21, FIXES.md Action 0; revised after review finding 3). $0, no model; reads the
# stored A0/A1 dev60 runs.
#   python3 -I research/compromises-20261021/action0/a4.py /var/tmp/foundry-work/autobench
# Claim: at a fixed run budget, k>=2 repeats per task buy less power than more tasks at k=1.
# 1) Analytic (the claim itself): with D_i = mean_k(B_i) - mean_k(A_i), Var(D_i) = s2_between + s2_within/k, and
#    n = N/k tasks, so Var(mean D) = (k*s2_between + s2_within)/N, which grows with k whenever s2_between > 0. The SE
#    ratio k=2 : k=1 is sqrt((2b + w)/(b + w)) and does not depend on the effect size.
# 2) The power LEVEL needs an effect size and the variance components, which two replications per arm cannot pin down.
#    Three estimators are reported, each with the effect it implies:
#    - method of moments on the raw outcomes: effect = mean of (s1 - s0)/2; s2_within from the replication pairs
#      (unbiased: (x1 - x2)^2 / 2 per task and arm); s2_between = var(D_i) - s2_within/2, floored at 0;
#    - add-half (Jeffreys) and add-one (Laplace) smoothing of each task's 2-run pass rate, which shrink the effect.
# 3) Monte Carlo ordering check under the two smoothed generators with a paired sign-flip permutation test on the
#    per-task mean differences (two-sided, alpha 0.05, 999 random flips), numpy RNG seed 20261021. The level again
#    depends on the generator; the ordering is what it checks.
import json, sys, math
import numpy as np
R = sys.argv[1]
def load(*dirs):
    out = {}
    for d in dirs:
        for line in open(f'{R}/{d}/results.jsonl'):
            r = json.loads(line); f = r['forks'][0]
            if f.get('sessionError') or f.get('harnessError') or f.get('skipped'):
                continue
            out[r['task']] = int(f['task_completed_correctly'] == 1)
    return out
a0 = [load('a0-dev60'), load('a0-dev60-dn')]
a1 = [load('a1-dev60'), load('a1-dev60-dn', 'a1-dev60-dn-fill')]
T = sorted(set(a0[0]) & set(a0[1]) & set(a1[0]) & set(a1[1]))
n0 = len(T)
x0 = np.array([[a0[0][t], a0[1][t]] for t in T]); x1 = np.array([[a1[0][t], a1[1][t]] for t in T])
s0 = x0.sum(1); s1 = x1.sum(1)
print('tasks', n0, 'A0 passes per run', x0.sum(0).tolist(), 'A1', x1.sum(0).tolist())
print('flips A0', int((s0 == 1).sum()), 'A1', int((s1 == 1).sum()))
print(f'observed pass rate A0 {s0.mean() / 2:.3f}, A1 {s1.mean() / 2:.3f}; observed paired effect {(s1 - s0).mean() / 2:.3f}')

def power(eff, b, w, N, k):
    n = N // k
    se = math.sqrt((b + w / k) / n)
    z = eff / se
    return se, 0.5 * math.erfc((1.96 - z) / math.sqrt(2))

est = {}
d = (s1 - s0) / 2
w_mom = (((x0[:, 0] - x0[:, 1]) ** 2) / 2 + ((x1[:, 0] - x1[:, 1]) ** 2) / 2).mean()
b_mom = max(0.0, d.var(ddof=1) - w_mom / 2)
est['method of moments, raw'] = (d.mean(), b_mom, w_mom, None, None)
for name, sm in (('add-half (Jeffreys)', lambda s: (s + 0.5) / 3), ('add-one (Laplace)', lambda s: (s + 1) / 4)):
    p0 = sm(s0); p1 = sm(s1)
    dd = p1 - p0
    est[name] = (dd.mean(), dd.var(ddof=1), (p0 * (1 - p0) + p1 * (1 - p1)).mean(), p0, p1)

for name, (eff, b, w, _, _) in est.items():
    print(f'\n[{name}] effect {eff:.3f}; s2_between {b:.4f}; s2_within {w:.4f}; SE ratio k=2:k=1 {math.sqrt((2 * b + w) / (b + w)):.3f}')
    for N in (120, 240):
        for k in (1, 2, 3):
            se, pw = power(eff, b, w, N, k)
            print(f'  budget {N} runs/arm: n={N // k} x k={k}: analytic SE {se:.4f}, normal-approx power {pw:.2f}')
pk1 = [power(e, b, w, 120, 1)[1] for e, b, w, _, _ in est.values()]
pk2 = [power(e, b, w, 120, 2)[1] for e, b, w, _, _ in est.values()]
print(f'\nrange across estimators at 120 runs/arm: k=1 power {min(pk1):.2f}-{max(pk1):.2f}; k=2 power {min(pk2):.2f}-{max(pk2):.2f}')

rng = np.random.default_rng(20261021)
S, P = 2000, 999
for name in ('add-half (Jeffreys)', 'add-one (Laplace)'):
    _, _, _, p0, p1 = est[name]
    for N in (120,):
        for k in (1, 2):
            n = N // k
            hits = 0
            for c in range(0, S, 50):
                m = min(50, S - c)
                idx = rng.integers(0, n0, size=(m, n))
                diff = rng.binomial(k, p1[idx]) / k - rng.binomial(k, p0[idx]) / k     # (m, n)
                obs = np.abs(diff.sum(1))                                              # (m,)
                signs = rng.integers(0, 2, size=(m, P, n), dtype=np.int8) * 2 - 1
                null = np.abs((signs * diff[:, None, :]).sum(2))                       # (m, P)
                pval = ((null >= obs[:, None] - 1e-12).sum(1) + 1) / (P + 1)
                hits += int((pval < 0.05).sum())
            print(f'  MC paired permutation test [{name}], budget {N}: n={n} x k={k}: power {hits / S:.2f}')
print('\nReading: the ordering (k=1 has the smaller SE at a fixed budget) holds under every estimator; the power level '
      'depends on the assumed effect and is not identifiable from 2 replications per arm.')
