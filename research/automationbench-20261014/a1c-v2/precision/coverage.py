import json, collections, importlib
import labels
from load import load_all
from universe import universe
from analyze import parse
A=load_all()
rows=json.load(open('check_rows.json'))
byt=collections.defaultdict(list)
for r in rows: byt[r['task']].append(r)
cov=[]
for a in A:
    t=a['task']; U=universe(a); lab=labels.L[t]
    pcs={p['id']:p for p in a['pcs']['pcs']}
    for i,x in enumerate(U):
        scored = (x['cat']=='action') or (x['cat']=='guard' and not all(x['per'].values()))
        fullc=[r for r in byt[t] if i in r['full']]; partc=[r for r in byt[t] if i in r['part']]
        def best(cs):
            if any(r['hard'] for r in cs): return 'hard'
            if any(pcs[r['id']]['type']=='judged' for r in cs): return 'judged'
            return 'advisory' if cs else None
        cov.append(dict(task=t, a=i, type=x['type'], cat=x['cat'], scored=scored, final=x['final'], r0=x['per'][min(x['per'])],
                        full=best(fullc), part=best(partc), fullids=[r['id'] for r in fullc], partids=[r['id'] for r in partc], mcause=lab['m'].get(f'A{i}')))
json.dump(cov, open('coverage.json','w'))
