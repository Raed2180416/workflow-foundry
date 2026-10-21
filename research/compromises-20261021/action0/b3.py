# Compromise register B3 check (2026-10-21, FIXES.md Action 0): rater agreement recomputed from the label files
# (not from RATER2.md's confusion table). $0.
#   python3 -I research/compromises-20261021/action0/b3.py research/intent-20261021
# 3-class (L1/L2/L3) Cohen's kappa, and the boundary-only (L2 vs L3, units both raters put in L2 or L3) kappa, Gwet AC1,
# with a percentile bootstrap CI (10,000 resamples of units, seed 20261021).
import json, sys, random, collections
d = sys.argv[1]
r2 = {x['id']: x['label'] for x in json.load(open(f'{d}/rater2-labels.json'))['labels']}
tr = {x['id']: x['layer'] for x in json.load(open(f'{d}/truth-e8-seed1.json'))['items']}
def lab2(s):
    s = s.lower()
    for k in ('l1', 'l2', 'l3'):
        if s.startswith(k): return int(k[1])
    return 4 if 'unwanted' in s or 'not' in s else None
pairs = []
for i, l1 in tr.items():
    if i not in r2: print('missing r2', i); continue
    pairs.append((l1, lab2(r2[i])))
print('units', len(pairs), 'r1 layers', collections.Counter(a for a, _ in pairs), 'r2 layers', collections.Counter(b for _, b in pairs))
def kappa(ps):
    n = len(ps); po = sum(a == b for a, b in ps) / n
    ca = collections.Counter(a for a, _ in ps); cb = collections.Counter(b for _, b in ps)
    pe = sum(ca[k] * cb[k] for k in set(ca) | set(cb)) / n / n
    return (po - pe) / (1 - pe) if pe < 1 else float('nan')
def ac1(ps):
    n = len(ps); po = sum(a == b for a, b in ps) / n
    cats = sorted(set(a for a, _ in ps) | set(b for _, b in ps)); q = len(cats)
    pi = {k: (sum(a == k for a, _ in ps) + sum(b == k for _, b in ps)) / (2 * n) for k in cats}
    pe = sum(p * (1 - p) for p in pi.values()) / (q - 1)
    return (po - pe) / (1 - pe)
three = [(a, b) for a, b in pairs if a in (1, 2, 3)]
print('3-class: n', len(three), 'agree', sum(a == b for a, b in three), 'kappa %.3f' % kappa(three), 'AC1 %.3f' % ac1(three))
cm = collections.Counter(three); print('confusion r1->r2', {f'{a}->{b}': c for (a, b), c in sorted(cm.items())})
bnd = [(a, b) for a, b in three if a in (2, 3) and b in (2, 3)]
print('boundary L2/L3 (both raters in L2 or L3): n', len(bnd), 'agree', sum(a == b for a, b in bnd), 'kappa %.3f' % kappa(bnd), 'AC1 %.3f' % ac1(bnd))
rng = random.Random(20261021); ks = []; acs = []
for _ in range(10000):
    s = [bnd[rng.randrange(len(bnd))] for _ in bnd]
    k = kappa(s)
    if k == k: ks.append(k)
    acs.append(ac1(s))
ks.sort(); acs.sort()
q = lambda v, p: v[int(p * (len(v) - 1))]
print('boundary kappa 95%% bootstrap CI %.2f-%.2f; AC1 CI %.2f-%.2f' % (q(ks, .025), q(ks, .975), q(acs, .025), q(acs, .975)))
l4 = [(a, b) for a, b in pairs if a == 4]; print('L4 units', len(l4), 'r2 unwanted', sum(b == 4 for _, b in l4))
