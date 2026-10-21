# COMP-1 analysis: per-build and pooled tables, reading rules P1-P4 and H-COMP (PREREG-COMP1.md), load flags.
import json, os, sys, re, datetime
R = '/home/user/workflow-foundry/research/composition-20261021/runs/'
def load(p):
    p = R + p
    return json.load(open(p)) if os.path.exists(p) else None
def ts(s): return datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))
ARMS = {'C-H': ['ch-e8-1', 'ch-e8-2', 'ch-e8-3'], 'C-H-T': ['cht-e8-1', 'cht-e8-2', 'cht-e8-3']}
S = '/tmp/claude-0/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/scratchpad/compose/'

def load_flag(label, wall_ms):
    lf = R + label + '/load.log'
    sl = S + label + '.log'
    if not os.path.exists(lf) or not os.path.exists(sl) or not wall_ms: return None
    start = ts(open(sl).readline().split()[0])
    end = start + datetime.timedelta(milliseconds=wall_ms)
    samples = []
    for line in open(lf):
        p = line.split()
        t = ts(p[0])
        if start <= t <= end: samples.append(float(p[1]))
    if not samples: return None
    over = sum(1 for x in samples if x > 8)
    return {'samples': len(samples), 'over8': over, 'share': over / len(samples), 'mean': sum(samples) / len(samples), 'max': max(samples), 'flag': over / len(samples) > 0.5}

def build_row(label):
    r = load(label + '/result.json')
    if not r: return None
    b = r.get('build') or {}
    full = [x for x in r['rows'] if x['size'] is None]
    paired = next((x for x in r['rows'] if x['seed'] == 1232 and x['d'] == 2 and x['size'] == 12), None)
    audit = load(label + '/m3-audit.json')
    faults = load(label + '/m4-faults.json')
    out = {'label': label, 'cost': b.get('costUsd'), 'wallMs': b.get('wallMs'), 'turns': b.get('turns'), 'smokeRuns': b.get('smokeRuns'), 'error': b.get('error'),
           'modules': r['program']['modules'], 'problems': r['program']['problems'], 'tests': r.get('tests'),
           'm1': (sum(x['oracle']['passed'] for x in full), sum(x['oracle']['completed'] for x in full)),
           'critical': sum(x['oracle']['critical'] for x in full),
           'm2': (sum(x['capabilities']['passed'] for x in full), sum(x['capabilities']['completed'] for x in full)),
           'strictViol': sum((x['interface'] or {}).get('violations', 0) for x in full + ([paired] if paired else [])),
           'strictDropped': sum((x['interface'] or {}).get('dropped', 0) for x in full + ([paired] if paired else [])),
           'integrity': sum((x['interface'] or {}).get('integrity', 0) for x in full + ([paired] if paired else [])),
           'armErrors': sum(x['armErrors'] for x in full),
           'paired': (paired['oracle']['passed'], paired['oracle']['completed']) if paired else None,
           'pairedCaps': (paired['capabilities']['passed'], paired['capabilities']['completed']) if paired else None,
           'perWorld': [(x['seed'], x['d'], x['oracle']['passed'], x['oracle']['completed'], x['capabilities']['passed'], x['capabilities']['completed'], (x['interface'] or {}).get('violations'), x['armErrors'], x['oracle']['codes']) for x in full],
           'byCapFails': {}, 'violByCode': {}}
    for x in full:
        for k, v in x['capabilities']['byCapability'].items():
            a, n = map(int, v.split('/'))
            out['byCapFails'][k] = out['byCapFails'].get(k, 0) + (n - a)
        for k, v in ((x['interface'] or {}).get('byCode') or {}).items(): out['violByCode'][k] = out['violByCode'].get(k, 0) + v
    if audit:
        af = [x for x in audit['results'] if x['size'] is None]
        out['audit'] = {'m1': (sum(x['oracle']['passed'] for x in af), sum(x['oracle']['completed'] for x in af)),
                        'm2': (sum(x['capabilities']['passed'] for x in af), sum(x['capabilities']['completed'] for x in af)),
                        'viol': sum((x['interface'] or {}).get('violations', 0) for x in audit['results']),
                        'byCode': {}}
        for x in audit['results']:
            for k, v in ((x['interface'] or {}).get('byCode') or {}).items(): out['audit']['byCode'][k] = out['audit']['byCode'].get(k, 0) + v
    if faults:
        out['m4'] = {}
        for x in faults['results']:
            out['m4'][(x['seed'], x['fault'])] = x
    out['load'] = load_flag(label, b.get('wallMs'))
    tp = R + label + '/transcript.jsonl'
    if os.path.exists(tp):
        import subprocess
        a = json.loads(subprocess.run(['python3', S + 'audit-transcript.py', tp], capture_output=True, text=True).stdout)
        out['outside'] = a['outsideWorkdirOrOracle']
    return out

rows = {arm: [build_row(l) for l in labels] for arm, labels in ARMS.items()}
def pool(rs, key):
    rs = [r for r in rs if r]
    a = sum(r[key][0] for r in rs); n = sum(r[key][1] for r in rs)
    return a, n, (a / n if n else None)

def fmt(x): return f'{x[0]}/{x[1]}' + (f' ({x[0]/x[1]:.3f})' if x[1] else '')
print('## per build')
for arm, rs in rows.items():
    for r in rs:
        if not r: print(arm, 'missing'); continue
        print(json.dumps({k: r[k] for k in ('label', 'cost', 'wallMs', 'turns', 'smokeRuns', 'error', 'modules', 'problems', 'tests', 'm1', 'critical', 'm2', 'strictViol', 'strictDropped', 'integrity', 'armErrors', 'paired', 'pairedCaps', 'byCapFails', 'violByCode', 'load')}, default=str))
        print('   audit', json.dumps(r.get('audit')), 'outside', r.get('outside'))
        for w in r['perWorld']: print('   ', w)
        if r.get('m4'):
            for (seed, fault), x in sorted(r['m4'].items()):
                print('    M4', seed, fault, f"{x['oracle']['passed']}/{x['oracle']['completed']}", 'caps', f"{x['capabilities']['passed']}/{x['capabilities']['completed']}", 'dup', x['exactlyOnce']['duplicates'], x['exactlyOnce']['money'], 'comp', f"{x['compensation']['complete']}/{x['compensation']['due']}", 'same', x['sameJournalAsFaultFree'], 'inj', x['injected'], 'ifc', (x['interface'] or {}).get('violations'), 'armErr', x['armErrors'])

print('\n## reading rules')
ch = [r for r in rows['C-H'] if r]
cht = [r for r in rows['C-H-T'] if r]
def loads_and_clean(r): return (not r['problems']) and r['strictViol'] == 0 and r['integrity'] == 0
def loads(r): return not r['problems'] and r['m1'][0] > 0
p1 = sum(1 for r in ch if loads_and_clean(r))
print('P1 builds that load and pass the interface checks in strict mode:', p1, 'of', len(ch), '| load at all:', sum(1 for r in ch if loads(r)))
pc = pool(ch, 'm1'); print('P2 pooled C-H M1', pc)
pt = pool(cht, 'm1'); print('pooled C-H-T M1', pt)
print('P4 C-H-T M1 >= C-H M1:', pt[2] is not None and pc[2] is not None and pt[2] >= pc[2], '| violations C-H-T', sum(r['strictViol'] for r in cht), 'C-H', sum(r['strictViol'] for r in ch))
for arm, rs in (('C-H', ch), ('C-H-T', cht)):
    lost = [ (r['m4'][(1161, 'dup-same')]['oracle']['completed'] - r['m4'][(1161, 'dup-same')]['oracle']['passed']) for r in rs if r.get('m4') and (1161, 'dup-same') in r['m4']]
    comp = [ (r['m4'][(1161, 'downstream')]['compensation']['complete'], r['m4'][(1161, 'downstream')]['compensation']['due']) for r in rs if r.get('m4') and (1161, 'downstream') in r['m4']]
    print(arm, 'M4d lost on 1161 d2:', lost, '| M4e comp on 1161 d2:', comp)

# ---------------- markdown tables ----------------
def pct(a, n): return f'{a}/{n} ({a/n:.3f})' if n else '—'
md = []
md.append('| build | modules | $ | wall min | turns | smoke runs | load >8 share (flag) | tests | M1 full (9 worlds) | critical | M2 contracts | paired 1232 d2 s12 | M3 strict violations (dropped) | M3 audit violations | M1 under audit | arm errors |')
md.append('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for arm, rs in rows.items():
    for r in rs:
        if not r: md.append(f'| {arm} (missing) |' + ' |' * 15); continue
        ld = r['load']
        a = r.get('audit') or {}
        md.append(f"| {r['label']} | {len(r['modules'])}: {', '.join(r['modules'])} | {r['cost']:.2f} | {r['wallMs']/60000:.1f} | {r['turns']} | {r['smokeRuns']} | {ld['share']:.2f} ({'FLAG' if ld['flag'] else 'no'}) | {r['tests']['pass']}/{r['tests']['pass']+r['tests']['fail']} in {r['tests']['modulesWithTests']}/{r['tests']['modules']} modules | {pct(*r['m1'])} | {r['critical']} | {pct(*r['m2'])} | {r['paired'][0]}/{r['paired'][1]} | {r['strictViol']} ({r['strictDropped']}) | {a.get('viol','—')} | {pct(*a['m1']) if a.get('m1') else '—'} | {r['armErrors']} |")
print('\nTABLE-BUILDS'); print('\n'.join(md))
md = ['| arm | builds | pooled M1 | pooled M2 | per-build M1 | strict violations | $ total | $ mean |', '|---|---|---|---|---|---|---|---|']
for arm, rs in rows.items():
    rs = [r for r in rs if r]
    if not rs: continue
    a, n, _ = pool(rs, 'm1'); a2, n2, _ = pool(rs, 'm2')
    md.append(f"| {arm} | {len(rs)} | {pct(a, n)} | {pct(a2, n2)} | {', '.join(f'{r['m1'][0]/r['m1'][1]:.3f}' for r in rs)} | {sum(r['strictViol'] for r in rs)} | {sum(r['cost'] for r in rs):.2f} | {sum(r['cost'] for r in rs)/len(rs):.2f} |")
    flagged = [r for r in rs if r['load'] and r['load']['flag']]
    if flagged:
        keep = [r for r in rs if r not in flagged]
        a3, n3, _ = pool(keep, 'm1') if keep else (0, 0, None)
        md.append(f"| {arm} without load-flagged builds ({', '.join(r['label'] for r in flagged)}) | {len(keep)} | {pct(a3, n3)} | | | | | |")
print('\nTABLE-POOLED'); print('\n'.join(md))
F = ['none', 'restart', 'crash', 'dup-delayed', 'dup-same', 'downstream']
def m4cell(x):
    s = f"{x['oracle']['passed']}/{x['oracle']['completed']}"
    if x.get('sameJournalAsFaultFree') is True: s += ' ='
    if x.get('sameJournalAsFaultFree') is False: s += ' ≠'
    if x['exactlyOnce']['duplicates']: s += f", dup {x['exactlyOnce']['duplicates']}({x['exactlyOnce']['money']})"
    if x['fault'] == 'downstream' or x['compensation']['complete'] != x['compensation']['due']: s += f", comp {x['compensation']['complete']}/{x['compensation']['due']}"
    if x['oracle']['critical']: s += f", crit {x['oracle']['critical']}"
    if (x.get('interface') or {}).get('violations'): s += f", ifc {x['interface']['violations']}"
    return s
md = ['| subject | world | ' + ' | '.join(F) + ' |', '|---|---|' + '---|' * len(F)]
subjects = [(r['label'], r.get('m4')) for arm, rs in rows.items() for r in rs if r]
for name in ['b1lh-e8-1', 'b1nh-e8-2', 'b1nh-e8-3']:
    d = load(f'm4-monolith-{name}.json')
    if d: subjects.append((name.upper().replace('-E8-', ' l'), {(x['seed'], x['fault']): x for x in d['results']}))
for name, m4 in subjects:
    if not m4: continue
    for seed in (1161, 1162, 1164):
        cells = [m4cell(m4[(seed, f)]) if (seed, f) in m4 else '—' for f in F]
        md.append(f"| {name} | {seed} | " + ' | '.join(cells) + ' |')
print('\nTABLE-M4'); print('\n'.join(md))
md = ['| monolith row | M1 full | M2 contracts | paired | source |', '|---|---|---|---|---|']
for name, m1 in [('b1lh-e8-1', '1022/1022'), ('b1nh-e8-2', '1022/1022'), ('b1nh-e8-3', '1022/1022'), ('b1lh-e8-2', '974/1022'), ('b1lh-e8-3', '1015/1022')]:
    d = load(f'm2-monolith-{name}.json')
    if d:
        full = [x for x in d['results'] if x['size'] is None]
        pa = next((x for x in d['results'] if x['size'] == 12), None)
        o = (sum(x['oracle']['passed'] for x in full), sum(x['oracle']['completed'] for x in full))
        c = (sum(x['capabilities']['passed'] for x in full), sum(x['capabilities']['completed'] for x in full))
        md.append(f"| {name} | {pct(*o)} (recorded {m1}) | {pct(*c)} | {pa['oracle']['passed']}/{pa['oracle']['completed']} | re-graded at $0 here |")
print('\nTABLE-MONO'); print('\n'.join(md))
