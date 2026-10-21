"""Metrics: AUROC (Mann-Whitney with ties), precision/recall/F1, Brier, within-task pair ranking, task bootstrap."""
import numpy as np


def auroc(y, s):
    y, s = np.asarray(y), np.asarray(s, float)
    pos, neg = s[y == 1], s[y == 0]
    if not len(pos) or not len(neg):
        return None
    order = np.argsort(s, kind='mergesort')
    ranks = np.empty(len(s))
    ss = s[order]
    i = 0
    while i < len(ss):
        j = i
        while j + 1 < len(ss) and ss[j + 1] == ss[i]:
            j += 1
        ranks[order[i:j + 1]] = (i + j) / 2 + 1
        i = j + 1
    rp = ranks[y == 1].sum()
    return float((rp - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def prf(y, d):
    y, d = np.asarray(y).astype(bool), np.asarray(d).astype(bool)
    tp, fp = int((d & y).sum()), int((d & ~y).sum())
    fn, tn = int((~d & y).sum()), int((~d & ~y).sum())
    P = tp / (tp + fp) if tp + fp else None
    R = tp / (tp + fn) if tp + fn else None
    F = 2 * P * R / (P + R) if P and R else 0.0
    return {'tp': tp, 'fp': fp, 'fn': fn, 'tn': tn, 'n': len(y), 'precision': P, 'recall': R, 'f1': F,
            'failRecall': tn / (tn + fp) if tn + fp else None, 'rejectPrecision': tn / (tn + fn) if tn + fn else None,
            'acc': (tp + tn) / len(y) if len(y) else None}


def best_f1_threshold(y, p):
    cands = np.unique(np.round(p, 6))
    best = (-1.0, 0.5)
    for t in cands:
        f = prf(y, p >= t)['f1']
        if f > best[0] + 1e-12:
            best = (f, float(t))
    return best[1]


def brier(y, p):
    return float(np.mean((np.asarray(p) - np.asarray(y)) ** 2))


def pair_ranking(tasks, y, s):
    """Within-task: fraction of (pass, fail) pairs where the pass scores higher (ties count 0.5)."""
    tasks, y, s = np.asarray(tasks), np.asarray(y), np.asarray(s, float)
    num = den = 0.0
    for t in np.unique(tasks):
        ix = tasks == t
        pos, neg = s[ix & (y == 1)], s[ix & (y == 0)]
        for a in pos:
            num += (a > neg).sum() + 0.5 * (a == neg).sum()
            den += len(neg)
    return (num / den if den else None), int(den)


def task_bootstrap(tasks, fn, n=2000, seed=7):
    """Percentile CI of fn(task_subset_list) over task resamples."""
    rng = np.random.default_rng(seed)
    uniq = np.unique(tasks)
    vals = []
    for _ in range(n):
        pick = rng.choice(uniq, size=len(uniq), replace=True)
        v = fn(pick)
        if v is not None:
            vals.append(v)
    if not vals:
        return None
    return [float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))]
