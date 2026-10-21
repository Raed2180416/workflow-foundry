# Compromise register A4 check (2026-10-21, FIXES.md Action 0). $0, no model; reads the stored A0/A1 dev60 runs.
#   python3 -I research/compromises-20261021/action0/a4.py /var/tmp/foundry-work/autobench
# Claim: at a fixed run budget, k>=2 repeats per task buy less power than more tasks at k=1.
# 1) Analytic: with D_i = mean_k(B_i) - mean_k(A_i), Var(mean D) = (s2_between + s2_within/k)/n, and n = N/k,
#    so Var = (k*s2_between + s2_within)/N, which grows with k whenever s2_between > 0.
# 2) Plug-in numbers from the stored A0/A1 dev60 replications, and a Monte Carlo with a paired McNemar-style test
#    (exact binomial on discordant pairs at k=1; sign test on per-task mean differences at k=2), numpy RNG.
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
s0 = np.array([a0[0][t] + a0[1][t] for t in T]); s1 = np.array([a1[0][t] + a1[1][t] for t in T])
print('tasks', n0, 'A0 passes per run', [sum(a0[i][t] for t in T) for i in (0, 1)], 'A1', [sum(a1[i][t] for t in T) for i in (0, 1)])
print('flips A0', int((s0 == 1).sum()), 'A1', int((s1 == 1).sum()))
for name, sm in (('add-half (Jeffreys)', lambda s: (s + 0.5) / 3), ('add-one (Laplace)', lambda s: (s + 1) / 4)):
    p0 = sm(s0); p1 = sm(s1)
    d = p1 - p0
    s2b = d.var(ddof=1)                       # between-task variance of the true paired effect
    s2w = (p0 * (1 - p0) + p1 * (1 - p1)).mean()  # mean within-task Bernoulli variance of one paired run
    print(f'\n[{name}] mean p0 {p0.mean():.3f} p1 {p1.mean():.3f}; s2_between {s2b:.4f}; s2_within {s2w:.4f}')
    for N in (120, 240):
        for k in (1, 2, 3):
            n = N // k
            se = math.sqrt((s2b + s2w / k) / n)
            z = d.mean() / se
            pw = 0.5 * math.erfc((1.96 - z) / math.sqrt(2))
            print(f'  budget {N} runs/arm: n={n} x k={k}: analytic SE {se:.4f}, normal-approx power {pw:.2f}')
    rng = np.random.default_rng(20261021)
    S = 4000
    for N in (120,):
        for k in (1, 2):
            n = N // k
            idx = rng.integers(0, n0, size=(S, n))
            ra = rng.binomial(k, p0[idx]) / k; rb = rng.binomial(k, p1[idx]) / k
            diff = rb - ra
            # sign test on nonzero per-task differences, two-sided exact binomial, alpha 0.05
            pos = (diff > 0).sum(1); neg = (diff < 0).sum(1); m = pos + neg
            from math import comb
            def p2(x, m):
                if m == 0: return 1.0
                lo = min(x, m - x)
                return min(1.0, 2 * sum(comb(m, i) for i in range(lo + 1)) / 2 ** m)
            hits = sum(p2(int(pos[i]), int(m[i])) < 0.05 for i in range(S))
            print(f'  MC sign test, budget {N}: n={n} x k={k}: power {hits / S:.2f}')
