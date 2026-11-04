import json, os
from load import BASE
L=json.load(open(f'{BASE}/launch.json'))
out={}
for t in L['tasks']:
    d=f'{BASE}/host/{t}/fork-0'
    steps=[json.loads(l) for l in open(f'{d}/calls.jsonl')]
    nodes=json.load(open(f'{d}/pipeline/nodes.json'))
    by={n['name']:n for n in nodes}
    cuts={}
    n=0
    while f'check-{n}' in by:
        rep=by.get(f'repair-{n+1}')
        cut=sum(1 for s in steps if s['t']<rep['started']) if rep else len(steps)
        cuts[n]=cut; n+=1
    act=by.get('act')
    actEnd=sum(1 for s in steps if act and s['t']<=act['ended']+0.5)
    out[t]=dict(nsteps=len(steps),cuts=cuts,actEnd=actEnd)
json.dump(out,open('cuts.json','w'),indent=0)
for t,v in out.items(): print(t,v['nsteps'],v['actEnd'],v['cuts'])
