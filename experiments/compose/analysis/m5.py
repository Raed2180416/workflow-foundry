# M5 table from runs/<label>-d1/result.json.
import json, os
R = '/home/user/workflow-foundry/research/composition-20261021/runs/'
rows = []; spend = 0
print('| Program | Patch $ | Turns | Session | Smoke runs | Changed (files) | R2.2 owners | Manifest changed | Module tests | Changed cases pass, patched (unpatched) | Drifted M1, patched | Drifted M1, unpatched | Other cases changed |')
print('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for p in ['ch-e8-1', 'ch-e8-2', 'ch-e8-3', 'cht-e8-1', 'cht-e8-2', 'cht-e8-3']:
    f = R + p + '-d1/result.json'
    if not os.path.exists(f): print(f'| {p} | not run |' + ' |' * 11); continue
    r = json.load(open(f)); s = r['session']; L = r['locality'] or {}; t = r['tests'] or {}
    spend += s['costUsd'] or 0
    P = r['patched'] or []; U = r['unpatched']
    pa = sum(int(w['oracle'].split('/')[0]) for w in P); pn = sum(int(w['oracle'].split('/')[1]) for w in P)
    ua = sum(int(w['oracle'].split('/')[0]) for w in U); un = sum(int(w['oracle'].split('/')[1]) for w in U)
    cp = sum(w['changedCasesPass'] for w in P); cu = sum(w['changedCasesPass'] for w in U); cn = sum(len(w['converted']) for w in U)
    other = (pa - ua) - (cp - cu)
    print(f"| {p} | {s['costUsd']:.3f} | {s['turns']} | {s['wallMs']/60000:.1f} min | {s['smokeRuns']} | {', '.join(L.get('changedModules', [])) or 'none'} ({', '.join(L.get('changedFiles', []))}) | {', '.join(L.get('owners', []))} | {'yes' if L.get('manifestChanged') else 'no'} | {t.get('pass')}/{(t.get('pass') or 0) + (t.get('fail') or 0)} | {cp}/{cn} ({cu}/{cn}) | {pa}/{pn} ({', '.join(w['oracle'] for w in P)}) | {ua}/{un} ({', '.join(w['oracle'] for w in U)}) | {other:+d} |")
print(f'\nM5 spend: {spend:.3f}')
