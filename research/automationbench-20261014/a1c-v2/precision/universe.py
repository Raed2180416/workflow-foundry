import json
from load import load_all, BASE
from rounds import round_grades
def akey(x): return json.dumps([x['type'],x['params']],sort_keys=True)
def universe(a):
    """All assertions of a task with category (action|guard), truth at start, per round, final."""
    t=a['task']; R0=json.load(open(f'replay0/{t}.json'))['0']
    s0={akey(x) for x in R0['assertions']}
    G=round_grades(t)
    rounds={}
    for n,g in G.items():
        rounds[n]={akey(x):x['passed'] for x in g['assertions']}
    out=[]
    for x in a['grade']['assertion_results']:
        k=akey(x)
        if x['params'].get('scored') is False or x['params'].get('excluded') is True: continue
        cat='action' if k in s0 else 'guard'
        per={}
        for n in sorted(rounds):
            per[n]=rounds[n].get(k, True)  # excluded at that round = free guard intact
        out.append(dict(key=k,type=x['type'],params=x['params'],cat=cat,final=x['passed'],per=per))
    return out
