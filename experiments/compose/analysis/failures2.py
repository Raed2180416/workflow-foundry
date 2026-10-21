# Compact failure tables: one row per (class, first failure); counts on the 9 full worlds by difficulty, plus the paired world.
import json, sys
from collections import Counter, defaultdict
R = '/home/user/workflow-foundry/research/composition-20261021/runs/'
for label in sys.argv[1:]:
    r = json.load(open(R + label + '/result.json'))
    by = defaultdict(Counter)
    for row in r['rows']:
        col = 'paired' if row['size'] else f"d{row['d']}"
        for f in row['oracle']['failing']:
            fd = f['first'] or {}
            what = f"L{fd.get('layer')} {fd.get('code')}"
            det = fd.get('rule') or ''
            if fd.get('lid'): det = (det + ' ' if det else '') + '`' + fd['lid'].split(':')[0] + '`'
            if fd.get('op'): det = (det + ' ' if det else '') + f"`{fd.get('system')}.{fd.get('op')}`"
            if fd.get('code') == 'decision': det = f"`{fd.get('field')}` expected, got `{json.dumps(fd.get('got'))}`"
            if fd.get('code') == 'order': det = f"`{fd['lid'].split(':')[0]}` before `{fd.get('before', '').split(':')[0]}`"
            by[(f['class'], what, det)][col] += 1
    total = sum(c['d2'] + c['d3'] + c['d5'] for c in by.values())
    print(f"**{label}**: {total} failing completed cases on the nine full worlds.\n")
    print('| case class | first failure | detail | d2 | d3 | d5 | total | paired |')
    print('|---|---|---|---|---|---|---|---|')
    for k, c in sorted(by.items(), key=lambda kv: -(kv[1]['d2'] + kv[1]['d3'] + kv[1]['d5'])):
        print(f"| {k[0]} | {k[1]} | {k[2]} | {c['d2']} | {c['d3']} | {c['d5']} | {c['d2'] + c['d3'] + c['d5']} | {c['paired']} |")
    print()
