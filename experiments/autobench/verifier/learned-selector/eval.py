"""Leave-task-out evaluation of the learned selector on the verifier lab (devTrain dev60, development evidence).

  python3 -I eval.py --vlab <lab dir> --out <out dir> [--cc <code-checks rows.jsonl>] [--judge <haiku judgments.jsonl>]
                     [--exclude-tasks t1,t2,...]   # evaluation-only stratum (hard benchmark defects); never a feature

Protocol (frozen before the first scored run, see learned-selector.md):
  - Outer CV: the lab's 5 leave-task-out folds. Fit on 4 folds (all canonical rows of their tasks), predict the 5th.
  - Inner CV (inside the 4 training folds, leave-one-fold-out): pick the L2 strength (LR) or tree count (GBM) by log
    loss, the accept threshold by F1, and the selection guard margin by training-task selection passes.
  - Primary: LR on the FULL cheap feature set; selector = argmax OOF p per task, ties by the fixed arm order.
"""
import argparse
import json
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from data import build_candidates, load_code_checks, load_judge, load_views_for_consensus  # noqa: E402
from features import FEATURE_VERSION, IDENTITY_PREFIX, consensus_features  # noqa: E402
from metrics import auroc, best_f1_threshold, brier, pair_ranking, prf, task_bootstrap  # noqa: E402
from models import GBM, CondLogit, LogReg  # noqa: E402

ARM_ORDER = ['m3-a1c', 'sonnet-a1', 'haiku-a1c', 'sonnet-a0', 'haiku-a1', 'haiku-a1-pre', 'haiku-a0', 'haiku-a0-v306',
             'haiku-a0-pre', 'sonnet-plan-a1c']
REPORTED6 = ['haiku-a0', 'haiku-a1', 'haiku-a1c', 'sonnet-a0', 'sonnet-a1', 'm3-a1c']
POOLS = {
    'all10': ARM_ORDER,
    'dateNote8': [a for a in ARM_ORDER if not a.endswith('-pre')],
    'reported6': REPORTED6,
    'k3': ['m3-a1c', 'haiku-a1c', 'haiku-a1'],
    'm3+sonnet-a1': ['m3-a1c', 'sonnet-a1'],
    'm3+haiku-a1c': ['m3-a1c', 'haiku-a1c'],
}
LR_GRID = [0.003, 0.01, 0.03, 0.1, 0.3, 1.0]
GBM_STAGES = [25, 50, 100, 200, 400]
DELTA_GRID = [0.0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1.01]
CONDLOGIT_C = 0.1


def logloss(y, p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def matrix(cands, names, extra=None):
    X = np.zeros((len(cands), len(names)))
    col = {n: j for j, n in enumerate(names)}
    for i, c in enumerate(cands):
        for k, v in c['feat'].items():
            if k in col:
                X[i, col[k]] = v
        if extra is not None:
            for k, v in (extra[i] or {}).items():
                if k in col:
                    X[i, col[k]] = v
    return X


# ---------------------------------------------------------------------------------------------------------------
# Cross-validated predictions
# ---------------------------------------------------------------------------------------------------------------
def _fit_predict(kind, hp, Xtr, ytr, Xte_list):
    if kind == 'lr':
        m = LogReg(C=hp).fit(Xtr, ytr)
        return [m.predict_proba(X) for X in Xte_list], m
    m = GBM(n_estimators=max(GBM_STAGES)).fit(Xtr, ytr)
    return [m.staged_proba(X, GBM_STAGES) for X in Xte_list], m


def cv_predict(kind, X, y, folds, rows_mask=None):
    """Outer leave-fold-out with inner leave-fold-out model selection. Returns OOF p (NaN outside rows_mask), the
    per-outer-fold inner OOF p for training rows (for guard tuning), thresholds and chosen hyperparameters."""
    n = len(y)
    mask = np.ones(n, bool) if rows_mask is None else rows_mask
    oof = np.full(n, np.nan)
    info = []
    inner_oof_by_fold = {}
    for k in sorted(set(folds[mask])):
        tr = mask & (folds != k)
        te = mask & (folds == k)
        tr_folds = sorted(set(folds[tr]))
        # inner OOF for each hyperparameter
        inner = {}
        for f in tr_folds:
            itr, ite = tr & (folds != f), tr & (folds == f)
            if kind == 'lr':
                for C in LR_GRID:
                    p = LogReg(C=C).fit(X[itr], y[itr]).predict_proba(X[ite])
                    inner.setdefault(C, np.full(n, np.nan))[ite] = p
            else:
                staged = GBM(n_estimators=max(GBM_STAGES)).fit(X[itr], y[itr]).staged_proba(X[ite], GBM_STAGES)
                for s, p in staged.items():
                    inner.setdefault(s, np.full(n, np.nan))[ite] = p
        losses = {hp: logloss(y[tr], v[tr]) for hp, v in inner.items()}
        hp = min(losses, key=lambda h: (losses[h], h if kind == 'lr' else -h))
        thr = best_f1_threshold(y[tr], inner[hp][tr])
        if kind == 'lr':
            (p_te,), _ = _fit_predict('lr', hp, X[tr], y[tr], [X[te]])
        else:
            (staged,), _ = _fit_predict('gbm', hp, X[tr], y[tr], [X[te]])
            p_te = staged[hp]
        oof[te] = p_te
        inner_oof_by_fold[k] = inner[hp]
        info.append({'fold': int(k), 'hp': hp, 'threshold': thr, 'innerLogloss': losses[hp]})
    return oof, inner_oof_by_fold, info


def cv_condlogit(X, y, folds, tasks, rows_mask):
    n = len(y)
    out = np.full(n, np.nan)
    for k in sorted(set(folds[rows_mask])):
        tr, te = rows_mask & (folds != k), rows_mask & (folds == k)
        m = CondLogit(C=CONDLOGIT_C).fit(X[tr], y[tr], tasks[tr])
        out[te] = m.decision(X[te])
    return out


# ---------------------------------------------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------------------------------------------
def groups_for(meta, arms):
    g = {}
    for i, m in enumerate(meta):
        if m['arm'] in arms:
            g.setdefault(m['task'], []).append(i)
    return {t: ix for t, ix in g.items() if len({meta[i]['arm'] for i in ix}) >= 2}


def pick(meta, ix, score, default_arm=None, delta=0.0):
    order = sorted(ix, key=lambda i: (-score[i], ARM_ORDER.index(meta[i]['arm'])))
    best = order[0]
    if default_arm is not None and delta > 0:
        d = [i for i in ix if meta[i]['arm'] == default_arm]
        if d and score[best] < score[d[0]] + delta:
            return d[0]
    return best


def select(meta, groups, score, tasks=None, default_arm=None, delta=0.0):
    res = {}
    for t, ix in groups.items():
        if tasks is not None and t not in tasks:
            continue
        res[t] = meta[pick(meta, ix, score, default_arm, delta)]['y']
    return res


def baselines(meta, groups, tasks=None):
    ts = [t for t in groups if tasks is None or t in tasks]
    arms = sorted({meta[i]['arm'] for t in ts for i in groups[t]}, key=ARM_ORDER.index)
    per_arm = {a: sum(meta[i]['y'] for t in ts for i in groups[t] if meta[i]['arm'] == a) for a in arms}
    best_arm = max(arms, key=lambda a: (per_arm[a], -ARM_ORDER.index(a)))
    oracle = sum(max(meta[i]['y'] for i in groups[t]) for t in ts)
    rnd = sum(np.mean([meta[i]['y'] for i in groups[t]]) for t in ts)
    mixed = sum(1 for t in ts if 0 < sum(meta[i]['y'] for i in groups[t]) < len(groups[t]))
    best_vec = {t: max([meta[i]['y'] for i in groups[t] if meta[i]['arm'] == best_arm] or [0]) for t in ts}
    return {'tasks': len(ts), 'perArm': per_arm, 'bestArm': best_arm, 'best': per_arm[best_arm], 'oracle': oracle,
            'random': round(float(rnd), 2), 'mixed': mixed}, best_vec


def tune_delta(meta, groups, inner_scores, train_tasks, default_arm):
    best = (-1, 0.0)
    for d in DELTA_GRID:
        r = select(meta, groups, inner_scores, train_tasks, default_arm, d)
        s = sum(r.values())
        if s > best[0] or (s == best[0] and d > best[1]):
            best = (s, d)
    return best[1]


def selection_report(meta, pools, scores, inner_by_fold=None, tasks_subset=None, guard=True):
    """For each pool: selector passes (argmax, ties by arm order), guarded selector (default arm unless another
    candidate beats it by a margin tuned on training tasks), baselines, and a paired task-bootstrap CI vs best arm."""
    out = {}
    fold_of = {m['task']: m['fold'] for m in meta}
    for name, arms in pools.items():
        g = groups_for(meta, arms)
        if tasks_subset is not None:
            g = {t: ix for t, ix in g.items() if t in tasks_subset}
        if not g:
            continue
        base, best_vec = baselines(meta, g)
        sel = select(meta, g, scores)
        r = {**base, 'selector': int(sum(sel.values()))}
        diff = {t: sel[t] - best_vec[t] for t in g}
        r['wins'] = int(sum(1 for v in diff.values() if v > 0))
        r['losses'] = int(sum(1 for v in diff.values() if v < 0))
        r['ciVsBest'] = task_bootstrap(np.array(list(g)), lambda pickt: float(sum(diff[t] for t in pickt)))
        if guard and inner_by_fold is not None and 'm3-a1c' in arms:
            gsel, deltas = {}, {}
            for k, inner in inner_by_fold.items():
                train_tasks = {t for t in g if fold_of[t] != k}
                test_tasks = {t for t in g if fold_of[t] == k}
                d = tune_delta(meta, g, np.nan_to_num(inner, nan=-1.0), train_tasks, 'm3-a1c')
                deltas[int(k)] = d
                gsel.update(select(meta, g, scores, test_tasks, 'm3-a1c', d))
            r['guarded'] = int(sum(gsel.values()))
            r['guardDeltas'] = deltas
        out[name] = r
    return out


# ---------------------------------------------------------------------------------------------------------------
# Classification report
# ---------------------------------------------------------------------------------------------------------------
def cls_report(meta, p, thr_by_fold, mask, label):
    y = np.array([m['y'] for m in meta])
    folds = np.array([m['fold'] for m in meta])
    tasks = np.array([m['task'] for m in meta])
    ok = mask & ~np.isnan(p)
    thr = np.array([thr_by_fold.get(int(f), 0.5) for f in folds])
    d = p >= thr
    r = {'set': label, 'rows': int(ok.sum()), 'baseRate': float(y[ok].mean()) if ok.any() else None}
    r['atCvThreshold'] = prf(y[ok], d[ok])
    r['atHalf'] = prf(y[ok], p[ok] >= 0.5)
    r['auroc'] = auroc(y[ok], p[ok])
    r['aurocCI'] = task_bootstrap(np.unique(tasks[ok]), lambda pt: auroc(
        np.concatenate([y[ok & (tasks == t)] for t in pt]), np.concatenate([p[ok & (tasks == t)] for t in pt])))
    r['brier'] = brier(y[ok], p[ok])
    pr, npairs = pair_ranking(tasks[ok], y[ok], p[ok])
    r['pairRanking'] = pr
    r['pairs'] = npairs
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--vlab', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--cc', default=None, help='code-checks rows.jsonl (v1 frozen) for the +cc variant')
    ap.add_argument('--judge', default=None, help='diverse-judges Haiku judgments jsonl for the +judge variant')
    ap.add_argument('--exclude-tasks', default='', help='evaluation-only stratum: tasks with known label defects')
    ap.add_argument('--shuffle-seeds', type=int, default=5)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    t_start = time.time()

    cands, meta, timing = build_candidates(a.vlab, os.path.join(a.out, 'features-cache.json'))
    n = len(meta)
    y = np.array([m['y'] for m in meta], float)
    folds = np.array([m['fold'] for m in meta])
    tasks = np.array([m['task'] for m in meta])
    arms = np.array([m['arm'] for m in meta])
    hard = set(t for t in a.exclude_tasks.split(',') if t)
    all_names = sorted({k for c in cands for k in c['feat']})
    sets = {
        'FULL': all_names,
        'NOID': [k for k in all_names if not k.startswith(IDENTITY_PREFIX)],
        'WORLD': [k for k in all_names if k.split('.')[0] in ('d', 't', 'dt', 'p', 'w')],
        'ID': [k for k in all_names if k.startswith(IDENTITY_PREFIX)],
    }
    masks = {
        'all': np.ones(n, bool),
        'k3': np.isin(arms, POOLS['k3']),
        'reported6': np.isin(arms, REPORTED6),
        'm3': arms == 'm3-a1c',
        'all-minus-hard': ~np.isin(tasks, list(hard)),
        'k3-minus-hard': np.isin(arms, POOLS['k3']) & ~np.isin(tasks, list(hard)),
        'heldout-folds-3-4': np.isin(folds, [3, 4]),
    }
    R = {'protocol': {'featureVersion': FEATURE_VERSION, 'nRows': n, 'nFeatures': {k: len(v) for k, v in sets.items()},
                      'lrGrid': LR_GRID, 'gbmStages': GBM_STAGES, 'deltaGrid': DELTA_GRID, 'condlogitC': CONDLOGIT_C,
                      'excludedTasksForStratum': sorted(hard), 'featureTiming': timing},
         'variants': {}, 'selection': {}, 'controls': {}}
    oof_dump = {m['rid']: {} for m in meta}

    def run(name, kind, names, mask=None, extra=None, pools=POOLS, cls_masks=None):
        X = matrix(cands, names, extra)
        p, inner, info = cv_predict(kind, X, y, folds, mask)
        thr = {i['fold']: i['threshold'] for i in info}
        rep = {'kind': kind, 'features': len(names), 'folds': info, 'cls': {}}
        for mk in (cls_masks or masks):
            mm = masks[mk] & (mask if mask is not None else True)
            if mm.any() and not np.isnan(p[mm]).all():
                rep['cls'][mk] = cls_report(meta, p, thr, mm, mk)
        sc = np.nan_to_num(p, nan=-1.0)
        rep['selection'] = selection_report(meta, pools, sc, inner)
        R['variants'][name] = rep
        for i, m in enumerate(meta):
            if not np.isnan(p[i]):
                oof_dump[m['rid']][name] = round(float(p[i]), 5)
        return p, X

    # Primary and ablations (all rows).
    p_lr, X_full = run('LR-FULL (primary)', 'lr', sets['FULL'])
    run('GBM-FULL', 'gbm', sets['FULL'])
    run('LR-NOID', 'lr', sets['NOID'])
    run('LR-WORLD', 'lr', sets['WORLD'])
    run('LR-ID (arm prior only)', 'lr', sets['ID'])

    # Listwise conditional logit (selection only).
    cl = cv_condlogit(X_full, y, folds, tasks, np.ones(n, bool))
    R['variants']['CondLogit-FULL'] = {'kind': 'condlogit', 'features': len(sets['FULL']),
                                       'selection': selection_report(meta, POOLS, cl, None, guard=False)}

    # +code-checks (v1 frozen outputs as features).
    cc = load_code_checks(a.cc)
    if cc:
        extra = [cc.get(m['rid']) for m in meta]
        names = sets['FULL'] + sorted({k for e in extra if e for k in e})
        run('LR-FULL+cc', 'lr', names, extra=extra)
        R['variants']['LR-FULL+cc']['caveat'] = ('code-checks v1 was hand-designed reading folds 0-2 rows; only the '
                                                  'folds 3-4 rows are clean of that design leakage')
        R['variants']['LR-FULL+cc']['selectionHeldout34'] = selection_report(
            meta, POOLS, np.nan_to_num(oof_from(oof_dump, meta, 'LR-FULL+cc')), None,
            tasks_subset={m['task'] for m in meta if m['fold'] in (3, 4)}, guard=False)
        R['variants']['LR-FULL (primary)']['selectionHeldout34'] = selection_report(
            meta, POOLS, np.nan_to_num(p_lr, nan=-1.0), None,
            tasks_subset={m['task'] for m in meta if m['fold'] in (3, 4)}, guard=False)

    # +Haiku judge (only the 6 reported arms were judged): compare on the same rows.
    J = load_judge(a.judge)
    if J:
        m6 = masks['reported6']
        extra = [J.get(m['rid']) for m in meta]
        jn = sorted({k for e in extra if e for k in e})
        pools6 = {k: v for k, v in POOLS.items() if set(v) <= set(REPORTED6)}
        run('LR-FULL [6 arms]', 'lr', sets['FULL'], mask=m6, pools=pools6, cls_masks=['reported6', 'k3', 'm3'])
        run('LR-FULL+judge [6 arms]', 'lr', sets['FULL'] + jn, mask=m6, extra=extra, pools=pools6,
            cls_masks=['reported6', 'k3', 'm3'])
        run('LR-judge-only [6 arms]', 'lr', jn, mask=m6, extra=extra, pools=pools6, cls_masks=['reported6', 'k3', 'm3'])
        jp = np.array([(J.get(m['rid']) or {}).get('x.j_p', np.nan) for m in meta])
        R['variants']['raw judge p_done [6 arms]'] = {
            'cls': {k: cls_report(meta, jp, {f: 0.5 for f in range(5)}, masks[k] & m6, k) for k in ('reported6', 'k3', 'm3')},
            'selection': selection_report(meta, pools6, np.nan_to_num(jp, nan=-1.0), None, guard=False)}

    # Pool consensus (pool-dependent): trained per pool on that pool's rows.
    light = load_views_for_consensus(a.vlab)
    cons = {}
    for pname, parms in POOLS.items():
        if pname == 'dateNote8':
            continue
        pm = np.isin(arms, parms)
        extra = [None] * n
        for t in set(tasks[pm]):
            ix = [i for i in range(n) if pm[i] and tasks[i] == t]
            fs = consensus_features([light[meta[i]['rid']] for i in ix])
            for i, f in zip(ix, fs):
                extra[i] = f
        kn = sorted({k for e in extra if e for k in e})
        X = matrix(cands, sets['FULL'] + kn, extra)
        p, inner, info = cv_predict('lr', X, y, folds, pm)
        sel = selection_report(meta, {pname: parms}, np.nan_to_num(p, nan=-1.0), inner)
        thr = {i['fold']: i['threshold'] for i in info}
        cons[pname] = {'selection': sel.get(pname), 'cls': cls_report(meta, p, thr, pm, pname)}
    R['variants']['LR-FULL+consensus (per pool)'] = cons

    # Baselines that are not learned.
    sc_allpass = np.array([np.nan] * n)
    for i, c in enumerate(cands):
        if c['feat'].get('sc.is_a1c'):
            sc_allpass[i] = c['feat'].get('sc.term_all_pass', 0.0)
    a1c = ~np.isnan(sc_allpass)
    R['controls']['ownChecksAllPass (A1-C rows)'] = cls_report(meta, sc_allpass, {f: 0.5 for f in range(5)}, a1c, 'A1-C rows')
    nonempty = np.array([1.0 - c['feat']['d.empty'] for c in cands])
    R['controls']['nonemptyDiff'] = cls_report(meta, nonempty, {f: 0.5 for f in range(5)}, np.ones(n, bool), 'all')
    R['controls']['nonemptyDiff']['selection'] = selection_report(meta, POOLS, nonempty, None, guard=False)
    for mk in ('m3', 'k3'):
        R['controls'][f'primary on {mk} rows'] = R['variants']['LR-FULL (primary)']['cls'][mk]

    # Label-shuffle control: permute training labels (row level) and re-run the primary; AUROC should be ~0.5.
    sh = []
    for s in range(a.shuffle_seeds):
        rng = np.random.default_rng(1000 + s)
        ps = np.full(n, np.nan)
        for k in range(5):
            tr, te = folds != k, folds == k
            ytr = y[tr].copy()
            rng.shuffle(ytr)
            ps[te] = LogReg(C=0.03).fit(X_full[tr], ytr).predict_proba(X_full[te])
        sel = selection_report(meta, {'k3': POOLS['k3'], 'all10': POOLS['all10']}, ps, None, guard=False)
        sh.append({'seed': 1000 + s, 'auroc': auroc(y, ps), 'k3': sel['k3']['selector'], 'all10': sel['all10']['selector']})
    R['controls']['labelShuffle'] = sh

    # Descriptive: the primary model's coefficients when fit on all rows (C = the most chosen inner value).
    Cs = [i['hp'] for i in R['variants']['LR-FULL (primary)']['folds']]
    Cbest = max(set(Cs), key=Cs.count)
    m = LogReg(C=Cbest).fit(X_full, y)
    co = sorted(zip(sets['FULL'], m.coef()), key=lambda t: -abs(t[1]))
    R['descriptive'] = {'lrC': Cbest, 'topCoefficients': [(k, round(float(v), 3)) for k, v in co[:25]]}
    g = GBM(n_estimators=200).fit(X_full, y)
    imp = g.importance(len(sets['FULL']))
    R['descriptive']['gbmTopImportance'] = [(sets['FULL'][j], round(float(imp[j]), 2)) for j in np.argsort(-imp)[:20]]

    # Cost per task (stored fork costs; the selector itself makes no model call).
    cost = {}
    for arm in ARM_ORDER:
        ix = [i for i in range(n) if meta[i]['arm'] == arm]
        if ix:
            cost[arm] = {'usdPerTask': float(np.mean([meta[i]['cost'] for i in ix])),
                         'mercuryTokensPerTask': float(np.mean([meta[i]['mercuryTokens'] for i in ix]))}
    jcost = None
    if a.judge and os.path.exists(a.judge):
        js = [json.loads(l) for l in open(a.judge)]
        jcost = float(np.mean([j.get('costUsd') or 0.0 for j in js]))
    R['cost'] = {'perArm': cost, 'selectorUsdPerCandidate': 0.0, 'selectorMsPerCandidate': timing['meanFeatureMs'],
                 'judgeUsdPerCandidate': jcost,
                 'k3UsdPerTask': sum(cost[a]['usdPerTask'] for a in POOLS['k3']),
                 'k3MercuryTokensPerTask': sum(cost[a]['mercuryTokensPerTask'] for a in POOLS['k3'])}
    R['elapsedSec'] = round(time.time() - t_start, 1)

    json.dump(R, open(os.path.join(a.out, 'eval.json'), 'w'), indent=1, default=float)
    with open(os.path.join(a.out, 'oof.jsonl'), 'w') as fh:
        for rid, v in oof_dump.items():
            fh.write(json.dumps({'rid': rid, 'p': v}) + '\n')
    print(summary(R))


def oof_from(oof_dump, meta, name):
    return np.array([oof_dump[m['rid']].get(name, -1.0) for m in meta])


def summary(R):
    L = []
    f = lambda x: '-' if x is None else (f'{x:.3f}' if isinstance(x, float) else str(x))
    L.append('variant | set | rows | P | R | F1 | AUROC [CI] | pairRank | P@.5 R@.5')
    for name, v in R['variants'].items():
        for k, c in (v.get('cls') or {}).items():
            if not isinstance(c, dict) or 'atCvThreshold' not in c:
                continue
            t, h = c['atCvThreshold'], c['atHalf']
            L.append(f"{name} | {k} | {c['rows']} | {f(t['precision'])} | {f(t['recall'])} | {f(t['f1'])} | "
                     f"{f(c['auroc'])} {c['aurocCI'] and [round(x, 3) for x in c['aurocCI']]} | {f(c['pairRanking'])} | "
                     f"{f(h['precision'])} {f(h['recall'])}")
    L.append('')
    L.append('variant | pool | tasks | best(arm) | oracle | random | selector (w/l) [CI] | guarded')
    for name, v in R['variants'].items():
        sel = v.get('selection') or {}
        if name.startswith('LR-FULL+consensus'):
            sel = {k: x['selection'] for k, x in v.items() if x.get('selection')}
        for p, s in sel.items():
            L.append(f"{name} | {p} | {s['tasks']} | {s['best']} ({s['bestArm']}) | {s['oracle']} | {s['random']} | "
                     f"{s['selector']} (+{s['wins']}/-{s['losses']}) {s.get('ciVsBest')} | {s.get('guarded', '-')}")
    L.append('')
    L.append('controls: ' + json.dumps({k: (v.get('auroc') if isinstance(v, dict) else v) for k, v in R['controls'].items()},
                                       default=float)[:2000])
    return '\n'.join(L)


if __name__ == '__main__':
    main()
