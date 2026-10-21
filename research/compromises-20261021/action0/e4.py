# Compromise register E4 check (2026-10-21, FIXES.md Action 0): print the grading, cost and interface-violation fields
# of each composed build's result.json. $0.
#   python3 -I research/compromises-20261021/action0/e4.py research/composition-20261021/runs/ch-e8-{1,2,3}
import json, sys, os
for d in sys.argv[1:]:
    r = json.load(open(os.path.join(d, 'result.json')))
    print('==', os.path.basename(d), 'top keys', list(r.keys())[:25])
    def w(o, p=''):
        if isinstance(o, dict):
            for k, v in o.items(): w(v, p + '.' + k)
        elif isinstance(o, list):
            if len(o) <= 3:
                for i, v in enumerate(o): w(v, f'{p}[{i}]')
        else:
            pl = p.lower()
            if any(s in pl for s in ('pass', 'costusd', 'violation', 'completed', 'cases', 'grade', 'status', 'interface', 'total')) and len(p) < 90:
                print('  ', p, str(o)[:100])
    w(r)
