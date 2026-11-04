import json, sys, re
from load import load_all, BASE
from rounds import round_grades
A=load_all()
def short(o,n=220):
    s=json.dumps(o,ensure_ascii=False); return s if len(s)<=n else s[:n]+'…'
def akey(x): return json.dumps([x['type'],x['params']],sort_keys=True)
out=[]
sel=sys.argv[1:] 
for a in A:
    if sel and str(a['idx']) not in sel and a['task'] not in sel: continue
    t=a['task']; G=round_grades(t); ns=sorted(G)
    P=json.load(open(f'{BASE}/prep/{t}/prompt.json'))
    L=[]
    L.append(f"=== [{a['idx']}] {t}  graded={'PASS' if a['passed'] else 'fail'} pc={a['pcred']:.2f} term={a['term']['reason'] if a['term'] else None} rounds={a['rounds']}  per-round pc: "+' '.join(f"r{n}:{G[n]['partial_credit']:.2f}" for n in ns))
    L.append("PROMPT: "+re.sub(r'\s+',' ',P['user'])[:900])
    # assertions: union of scored across rounds
    keys=[]; info={}
    for n in ns:
        for x in G[n]['assertions']:
            k=akey(x)
            if k not in info: keys.append(k); info[k]=x
    L.append("ASSERTIONS (scored; pass per round):")
    for i,k in enumerate(keys):
        x=info[k]
        st=''.join(('T' if {akey(y):y['passed'] for y in G[n]['assertions']}.get(k) else ('F' if k in {akey(y) for y in G[n]['assertions']} else '-')) for n in ns)
        L.append(f"  A{i} [{st}] {x['type']} {short(x['params'],260)}")
    pcs=a['pcs']['pcs']; at={x['id']:x for x in a['pcs']['atStart']}
    L.append("CHECKS (hard; atStart; result per round; final evidence):")
    for p in pcs:
        res=''.join(('T' if r['pass'] is True else 'F' if r['pass'] is False else 'N') for n in sorted(a['checks']) for r in a['checks'][n] if r['id']==p['id'])
        ev=[r['evidence'] for r in a['checks'][max(a['checks'])] if r['id']==p['id']] if a['checks'] else []
        ev0=[r['evidence'] for r in a['checks'][0] if r['id']==p['id']] if a['checks'] else []
        L.append(f"  {p['id']} {'H' if p['hard'] else 'a'} {p['type']} start={at[p['id']]['pass']} res=[{res}] {short(p['params'],300)}")
        L.append(f"      stmt: {p['statement'][:260]}" + (f" | why: {p['why']}" if p['why'] else ''))
        if ev and (res and res[-1]!='T'): L.append(f"      ev-final: {str(ev[0])[:300]}")
        if ev0 and res and res[0]!='T' and ev0!=ev: L.append(f"      ev-r0: {str(ev0[0])[:300]}")
    out.append('\n'.join(L))
print('\n\n'.join(out))
