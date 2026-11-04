import json, collections
from analyze import canon, FR_CANON, FA_CANON
from fixmap import fix_of_check, fix_of_missing, NAMES
rows=json.load(open('check_rows.json')); cov=json.load(open('coverage.json')); F=json.load(open('failing.json')); T=json.load(open('tasks.json'))
out=[]
P=out.append
def conf(sel, key):
    c=collections.Counter(r[key] for r in rows if sel(r) and r[key] is not None)
    return c
P('### T1. Check verdicts against the grader (618 compiled checks, 372 hard)\n')
P('| Checks | Round | n | correct accept (TA) | correct reject (TR) | neutral pass (no graded counterpart) | **false accept** | **false reject** (aligned / unaligned) | undecided |')
P('|---|---|---|---|---|---|---|---|---|')
for nm,sel in [('all',lambda r:True),('hard',lambda r:r['hard']),('advisory',lambda r:not r['hard'])]:
    for key,lab in (('r0','0 (act world)'),('fin','final')):
        c=conf(sel,key); n=sum(c.values())
        P(f"| {nm} | {lab} | {n} | {c['TA']} | {c['TR']} | {c['U+']} | **{c['FA']}** | **{c['FR']+c['FRu']}** ({c['FR']} / {c['FRu']}) | {c['N']} |")
P('')
P('### T2. Round-0 verdict quality by check type\n')
P('| Check type | n | hard | TA | TR | neutral | FA | FR | P(correct \\| check fails) | P(correct \\| check passes) |')
P('|---|---|---|---|---|---|---|---|---|---|')
bt=collections.defaultdict(collections.Counter); hd=collections.Counter()
for r in rows: bt[r['type']][r['r0']]+=1; hd[r['type']]+=r['hard']
for t,v in sorted(bt.items(), key=lambda kv:-sum(kv[1].values())):
    n=sum(v.values()); fr=v['FR']+v['FRu']; fail=fr+v['TR']; pas=v['TA']+v['U+']+v['FA']
    P(f"| {t} | {n} | {hd[t]} | {v['TA']} | {v['TR']} | {v['U+']} | {v['FA']} | {fr} | {v['TR']/fail:.2f} ({v['TR']}/{fail}) | {(v['TA']+v['U+'])/pas:.2f} |" if fail else f"| {t} | {n} | {hd[t]} | {v['TA']} | {v['TR']} | {v['U+']} | {v['FA']} | {fr} | – | {(v['TA']+v['U+'])/pas:.2f} |")
P('')
P('### T3. Grader assertions and the checks that cover them\n')
P('Scored assertions = assertions false in the initial world (action) plus guards (true at start) that the agent broke. "Full" = a check on the same entity and effect that tests the asserted value; "partial" = same entity/effect, asserted value not tested; "missing" = no check at all.\n')
P('| Assertions | n | full, hard | full, judged | full, advisory | partial only | **missing** |')
P('|---|---|---|---|---|---|---|')
def lvl(c):
    if c['full']: return 'full-'+c['full']
    if c['part']: return 'partial'
    return 'missing'
for nm,sel in [('action, passed',lambda c:c['cat']=='action' and c['final']),('action, failed',lambda c:c['cat']=='action' and not c['final']),('guards broken (failed)',lambda c:c['cat']=='guard' and not c['final']),('guards intact (not scored)',lambda c:c['cat']=='guard' and c['final'])]:
    cc=collections.Counter(lvl(c) for c in cov if sel(c)); n=sum(cc.values())
    P(f"| {nm} | {n} | {cc['full-hard']} | {cc['full-judged']} | {cc['full-advisory']} | {cc['partial']} | **{cc['missing']}** |")
sc=[c for c in cov if c['scored']]
P(f"| **all scored** | {len(sc)} | {sum(lvl(c)=='full-hard' for c in sc)} | {sum(lvl(c)=='full-judged' for c in sc)} | {sum(lvl(c)=='full-advisory' for c in sc)} | {sum(lvl(c)=='partial' for c in sc)} | **{sum(lvl(c)=='missing' for c in sc)}** |")
P('')
P('### T4. False rejects by cause (a check that fails a world the grader passes, or demands an effect nobody asked for)\n')
P('| Cause | checks ever FR | of them hard | tasks | tasks with a hard FR | hard FR at round 0 |')
P('|---|---|---|---|---|---|')
c=collections.defaultdict(lambda: [0,0,set(),set(),0])
for r in rows:
    vs=set(r['per'].values())
    if vs & {'FR','FRu'}:
        k=canon(r['cause'],FR_CANON); c[k][0]+=1; c[k][1]+=r['hard']; c[k][2].add(r['task'])
        if r['hard']: c[k][3].add(r['task'])
        if r['hard'] and r['r0'] in ('FR','FRu'): c[k][4]+=1
tot=[0,0,set(),set(),0]
for k,v in sorted(c.items(), key=lambda kv:(-len(kv[1][3]),-kv[1][0])):
    P(f"| {k} | {v[0]} | {v[1]} | {len(v[2])} | {len(v[3])} | {v[4]} |"); tot[0]+=v[0]; tot[1]+=v[1]; tot[2]|=v[2]; tot[3]|=v[3]; tot[4]+=v[4]
P(f"| **total** | {tot[0]} | {tot[1]} | {len(tot[2])} | {len(tot[3])} | {tot[4]} |")
P('')
P('### T5. Why the 121 failing scored assertions were not fixed\n')
P('| Class | assertions | tasks | causes (assertions) |')
P('|---|---|---|---|')
by=collections.defaultdict(list)
for f in F: by[f['k'].split(' (')[0]].append(f)
for k,v in sorted(by.items(), key=lambda kv:-len(kv[1])):
    cc=collections.Counter(f['why'].split(':')[0] if f['k']=='missing' or f['k'].startswith('caught') else f['why'] for f in v)
    P(f"| {k} | {len(v)} | {len({f['task'] for f in v})} | " + '; '.join(f'{w or "advisory judged"} {n}' for w,n in cc.most_common()) + ' |')
P('')
open('tables.md','w').write('\n'.join(out))
print('\n'.join(out))
