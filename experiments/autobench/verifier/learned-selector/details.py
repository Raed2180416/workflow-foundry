"""Post-hoc detail tables from a finished eval run (scoring only; reads labels, never feeds anything back).

  python3 -I details.py --vlab <lab dir> --run <eval out dir> [--variant 'LR-FULL (primary)']
Prints: per-arm accept counts against true passes, and for each selection pool the tasks where the selector moved off
the default fork (m3-a1c) with the outcome of the move.
"""
import argparse
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eval import ARM_ORDER, POOLS, groups_for, pick  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--vlab', required=True)
    ap.add_argument('--run', required=True)
    ap.add_argument('--variant', default='LR-FULL (primary)')
    a = ap.parse_args()
    R = json.load(open(os.path.join(a.run, 'eval.json')))
    oof = {}
    for line in open(os.path.join(a.run, 'oof.jsonl')):
        x = json.loads(line)
        oof[x['rid']] = x['p'].get(a.variant)
    meta = json.load(open(os.path.join(a.run, 'features-cache.json')))['meta']
    meta = [m for m in meta if oof.get(m['rid']) is not None]
    score = np.array([oof[m['rid']] for m in meta])
    thr = {f['fold']: f['threshold'] for f in R['variants'][a.variant]['folds']}
    out = {'variant': a.variant, 'perArm': {}, 'moves': {}}
    for arm in ARM_ORDER:
        ix = [i for i, m in enumerate(meta) if m['arm'] == arm]
        if not ix:
            continue
        acc = [i for i in ix if score[i] >= thr[meta[i]['fold']]]
        out['perArm'][arm] = {'rows': len(ix), 'truePass': sum(meta[i]['y'] for i in ix), 'accepted': len(acc),
                              'acceptedAndPass': sum(meta[i]['y'] for i in acc),
                              'meanP': round(float(np.mean(score[ix])), 3)}
    for pname, arms in POOLS.items():
        if 'm3-a1c' not in arms:
            continue
        g = groups_for(meta, arms)
        mv = {'pass->pass': 0, 'pass->fail': 0, 'fail->pass': 0, 'fail->fail': 0, 'stay': 0, 'rescuable': 0,
              'rescuedOf': 0}
        for t, ix in g.items():
            d = [i for i in ix if meta[i]['arm'] == 'm3-a1c']
            if not d:
                continue
            p = pick(meta, ix, score)
            if not meta[d[0]]['y'] and any(meta[i]['y'] for i in ix):
                mv['rescuable'] += 1
                mv['rescuedOf'] += meta[p]['y']
            if p == d[0]:
                mv['stay'] += 1
                continue
            k = ('pass' if meta[d[0]]['y'] else 'fail') + '->' + ('pass' if meta[p]['y'] else 'fail')
            mv[k] += 1
        out['moves'][pname] = mv
    print(json.dumps(out, indent=1))


if __name__ == '__main__':
    main()
