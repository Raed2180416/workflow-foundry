import json, collections
from analyze import canon, FA_CANON
cov=json.load(open('coverage.json')); rows=json.load(open('check_rows.json'))
R={(r['task'],r['id']):r for r in rows}
def classify(c):
    t=c['task']
    fs=[R[(t,i)] for i in c['fullids']]; ps=[R[(t,i)] for i in c['partids']]
    if any(r['fin']=='FA' for r in fs): 
        r=[r for r in fs if r['fin']=='FA'][0]; return 'FA-full', canon(r['cause'],FA_CANON), r['id']
    if any(r['fin']=='TR' and r['hard'] for r in fs): return 'caught-hard (repair failed)', [r['cause'] for r in fs if r['fin']=='TR' and r['hard']][0][:70], ''
    if any(r['fin'] in ('TR','N') for r in fs): return 'caught-advisory (no repair)', [r['cause'] for r in fs][0][:70], ''
    if any(r['fin']=='FA' for r in ps): 
        r=[r for r in ps if r['fin']=='FA'][0]; return 'FA-partial (weak check passed)', canon(r['cause'],FA_CANON), r['id']
    if any(r['fin']=='TR' and r['hard'] for r in ps): return 'caught-hard (repair failed)', [r['cause'] for r in ps if r['fin']=='TR'][0][:70], ''
    if fs or ps: return 'other', str([(r['id'],r['fin']) for r in fs+ps]), ''
    return 'missing', (c['mcause'] or 'NO M LABEL').split(':')[0], ''
out=[]
for c in cov:
    if not c['scored'] or c['final']: continue
    k,why,pid=classify(c); out.append(dict(c, k=k, why=why, pid=pid))
json.dump(out,open('failing.json','w'))
