import json, os, glob
BASE='/var/tmp/foundry-work/autobench/a1c-dev60-dn'
def load_all():
    rows={}
    for l in open(f'{BASE}/results.jsonl'):
        r=json.loads(l); rows[r['task']]=r
    L=json.load(open(f'{BASE}/launch.json'))
    out=[]
    for i,t in enumerate(L['tasks']):
        r=rows[t]; f=r['forks'][0]; d=f'{BASE}/host/{t}/fork-0'
        g=json.load(open(f'{d}/grade.json'))
        pc=json.load(open(f'{d}/pipeline/postconditions.json')) if os.path.exists(f'{d}/pipeline/postconditions.json') else None
        checks={}
        for p in sorted(glob.glob(f'{d}/pipeline/check-*.json')):
            n=int(p.split('check-')[1].split('.')[0]); checks[n]=json.load(open(p))
        out.append(dict(idx=i,task=t,row=r,fork=f,dir=d,grade=g,pcs=pc,checks=checks,
            passed=bool(r['final']['task_completed_correctly']), pcred=r['final']['partial_credit'],
            term=(f.get('pipeline') or {}).get('termination'), rounds=(f.get('pipeline') or {}).get('rounds')))
    return out
