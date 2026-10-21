import json, collections, io, contextlib
with contextlib.redirect_stdout(io.StringIO()):
    from fixmap import fix_of_check, fix_of_missing
from analyze import canon, FR_CANON, FA_CANON
rows=json.load(open('check_rows.json')); F=json.load(open('failing.json')); T=json.load(open('tasks.json'))
RW=json.load(open('repair_wdiff.json'))
by=collections.defaultdict(list)
for r in rows: by[r['task']].append(r)
fb=collections.defaultdict(list)
for f in F: fb[f['task']].append(f)
rw=collections.defaultdict(list)
for t,k,n,sig,apps in RW: rw[t].append(sig)
L=['| # | Task | r0 grade (pc) | final grade (pc) | termination | rounds | hard checks FR @r0 (fix) | failing assertions: class (fix) | repair rounds that changed the world |','|---|---|---|---|---|---|---|---|---|']
for i,t in enumerate(T):
    k=t['task']
    fr=collections.Counter(fix_of_check(r) for r in by[k] if r['hard'] and r['r0'] in ('FR','FRu'))
    fs=collections.Counter()
    for f in fb[k]:
        if f['k']=='missing': fs[('missing',fix_of_missing(f))]+=1
        else:
            ids=f['fullids']+f['partids']
            fx=sorted({fix_of_check(r) for r in by[k] if r['id'] in ids and r['fin'] in ('FA','TR','N')} - {None})
            fs[(f['k'].split(' (')[0], '+'.join(fx) or '-')]+=1
    ch=sum(1 for s in rw.get(k,[]) if s>0)
    L.append(f"| {i} | {k} | {'PASS' if t['r0pass'] else 'fail'} ({t['pc0']:.2f}) | {'PASS' if t['final'] else 'fail'} ({t['pcF']:.2f}) | {t['term']} | {t['rounds']} | " + (', '.join(f'{n}×{f}' for f,n in fr.items()) or '–') + ' | ' + (', '.join(f'{n}× {c} ({x})' for (c,x),n in fs.items()) or '–') + f" | {ch}/{t['rounds']} |")
open('appendix.md','w').write('\n'.join(L)); print('\n'.join(L[:8]))
