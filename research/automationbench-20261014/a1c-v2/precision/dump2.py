import json, sys, re
from load import load_all, BASE
from universe import universe
from autoalign import score
A=load_all()
def short(o,n=220):
    s=json.dumps(o,ensure_ascii=False); return s if len(s)<=n else s[:n]+'…'
sel=sys.argv[1:]
for a in A:
    if sel and str(a['idx']) not in sel and a['task'] not in sel: continue
    t=a['task']; U=universe(a)
    P=json.load(open(f'{BASE}/prep/{t}/prompt.json'))
    rs=sorted(a['checks'])
    print(f"=== [{a['idx']}] {t}  graded={'PASS' if a['passed'] else 'fail'} pc={a['pcred']:.2f} term={a['term']['reason'] if a['term'] else None} rounds={a['rounds']}")
    print("PROMPT: "+re.sub(r'\s+',' ',P['user'])[:1000])
    print("ASSERTIONS (action / guard; truth per round):")
    for i,x in enumerate(U):
        if x['cat']=='guard' and all(x['per'].values()) and x['final']: continue
        st=''.join('T' if x['per'][n] else 'F' for n in sorted(x['per']))
        print(f"  A{i} {x['cat'][0]} [{st}] {x['type']} {short(x['params'],240)}")
    ng=sum(1 for x in U if x['cat']=='guard' and all(x['per'].values()))
    gl=[f"A{i}:{x['type'].replace('_not','!')}:{short(x['params'],70)}" for i,x in enumerate(U) if x['cat']=='guard' and all(x['per'].values())]
    print(f"  intact guards ({ng}): " + ' ; '.join(gl)[:1500])
    at={x['id']:x for x in a['pcs']['atStart']}
    print("CHECKS:")
    for p in a['pcs']['pcs']:
        res=''.join(('T' if r['pass'] is True else 'F' if r['pass'] is False else 'N') for n in rs for r in a['checks'][n] if r['id']==p['id'])
        cand=sorted(((score(p,x),i) for i,x in enumerate(U)), key=lambda z:-z[0][0])
        cand=[f"A{i}{s[1]}" for s,i in cand if s[0]>=2][:6]
        print(f"  {p['id']} {'H' if p['hard'] else 'a'} {p['type']} s={str(at[p['id']]['pass'])[0]} [{res}] {short(p['params'],280)}  ~{','.join(cand)}")
        print(f"      : {p['statement'][:240]}" + (f" | {p['why']}" if p['why'] and p['type']=='judged' else ''))
        last=[r for r in a['checks'][rs[-1]] if r['id']==p['id']] if rs else []
        if last and last[0]['pass'] is not True: print(f"      ev: {str(last[0]['evidence'])[:260]}")
    print()
