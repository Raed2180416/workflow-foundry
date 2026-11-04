import json, collections, re
rows=json.load(open('check_rows.json')); F=json.load(open('failing.json')); T={t['task']:t for t in json.load(open('tasks.json'))}
def fix_of_check(r):
    c=r['cause'].lower()
    if not c: return None
    if re.search(r'compile-neg|negcand', c): return 'D'
    if 'fa-judged' in c and 'exclu' in c: return 'D'
    if re.search(r'fa-weak', c) and re.search(r'exclusion|excluded', c): return 'D'
    if re.search(r'unobservable|not re-read|blind|noevidence', c): return 'B'
    if re.search(r'fr-kind|mech-field|mech-dm|na-vacuous', c): return 'A'
    if re.search(r'fa-weak', c): return 'E'
    if re.search(r'instruction|template|merge|overstrict|notstored|fr-wronglit|header', c): return 'C'
    if re.search(r'fa-wrong|wrongent|inverse|wronglit-policy|fa-judged', c): return 'F'
    if re.search(r'ungraded|notasked|na-', c): return 'G'
    if re.search(r'advisory-', c): return 'H'
    return '?'
def fix_of_missing(x):
    w=(x['mcause'] or '')
    if re.search(r'negative', w): return 'D'
    if re.search(r'M-count', w): return 'R'
    if re.search(r'derived|format|noposcheck', w): return 'E'
    if re.search(r'convention', w): return 'I'
    if re.search(r'M-world', w): return 'J'
    return 'F'
NAMES={'A':'effect-typed compile from the API schema (app, record kind, child-of-record, list membership)',
 'B':'observable checks: read back the written record by id; a blind app is never a hard code check',
 'C':'literal hygiene: values only (no instruction/rationale/template text); all literals of a check from one item; row vs sheet scope',
 'D':'negative compile: "X must not appear" -> body/row-must-not-contain on the same artifact; excluded-recipient sets minus required recipients',
 'E':'literal completeness: compile every named value incl. code-computed derived values (sums, counts, day differences) and subject/format words',
 'F':'ledger scope/precedence: closed-world in/out per entity; newest policy wins; precedent format; one target per selection',
 'G':'drop or demote requirements no source asks for (ungraded inventions)',
 'H':'advisory checks with a correct fail verdict are ignored (judged / negative / no-address)',
 'R':'repair idempotency: an exactly-once effect is not re-created by a repair',
 'I':'convention: read in full (open) every record a decision rests on',
 'J':'policy/config recall: every action a policy or config document prescribes becomes a requirement (tag, log event, Jira issue, row update)'}
agg=collections.defaultdict(lambda: dict(tasks=set(), frhard=set(), fr=set(), fa=set(), miss=set(), trwr=set(), checks=0))
for r in rows:
    f=fix_of_check(r)
    if not f: continue
    vs=set(r['per'].values()); d=agg[f]
    if vs & {'FR','FRu'}: d['fr'].add(r['task']); d['tasks'].add(r['task']); d['checks']+=1
    if (vs & {'FR','FRu'}) and r['hard']: d['frhard'].add(r['task'])
    if 'FA' in vs: d['fa'].add(r['task']); d['tasks'].add(r['task']); d['checks']+= (0 if vs & {'FR','FRu'} else 1)
    if 'TR' in vs and 'wrongreason' in r['cause'].lower(): d['trwr'].add(r['task']); d['tasks'].add(r['task'])
    if f=='H' and vs & {'TR'}: d['tasks'].add(r['task'])
for x in F:
    if x['k']=='missing':
        f=fix_of_missing(x); agg[f]['miss'].add(x['task']); agg[f]['tasks'].add(x['task'])
out={}
for k in sorted(agg, key=lambda k:-len(agg[k]['tasks'])):
    d=agg[k]; out[k]={kk:(sorted(v) if isinstance(v,set) else v) for kk,v in d.items()}
    print(f"{k} tasks={len(d['tasks']):2d} hardFR={len(d['frhard']):2d} FR={len(d['fr']):2d} FA={len(d['fa']):2d} missing={len(d['miss']):2d} TRwrongreason={len(d['trwr']):2d} checks={d['checks']:3d}  {NAMES.get(k,k)}")
json.dump(dict(fixes=out,names=NAMES),open('fixes.json','w'),indent=1)
unk=[(r['task'],r['id'],r['cause'][:50]) for r in rows if fix_of_check(r)=='?']; print('unmapped', unk)
