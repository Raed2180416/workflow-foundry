"""Look-2 audit ($0, descriptive): for the tasks A1-C v2 failed and no arm passed, list the assertions that no arm ever
passed (the blocking requirements). Reads the grade files of every look-2 arm's run directory (outside git) and VL-1's
pass vectors. Run with:  python3 -I experiments/autobench/replay/look2_blocking.py [OUT.json]
"""
import glob, json, os, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
LIVE = os.environ.get('AB_LIVE_ROOT', '/var/tmp/foundry-work/autobench')
ARMS = ['a0o-look2-1', 'a0-look2', 'a1c-v1-look2', 'a1c-v2-look2', 'a1c-v1m-look2', 'a1c-v2m-look2', 'a1s-look2']
RUNS = os.path.join(REPO, 'research/automationbench-20261014/runs')

def rows(name):
    with open(os.path.join(RUNS, name, 'results.jsonl')) as fh:
        return [json.loads(line) for line in fh if line.strip()]

pv = json.load(open(os.path.join(RUNS, 'vl1-look2/pass-vectors.json')))
any_pass = {t['task'] for t in pv['perTask'] if any(f['pass'] for f in t['forks'].values())}
any_pass |= {r['task'] for r in rows('a1c-v1-look2') if r['final']['task_completed_correctly']}
v2_fail = {r['task'] for r in rows('a1c-v2-look2') if not r['final']['task_completed_correctly']}
out = {}
for task in sorted(v2_fail - any_pass):
    seen = {}
    for arm in ARMS:
        for grade in glob.glob(os.path.join(LIVE, arm, 'host', task, 'fork-*', 'grade.json')):
            for a in json.load(open(grade)).get('assertion_results', []):
                if a.get('excluded'):
                    continue
                key = a['type'] + ' ' + json.dumps(a.get('params'), sort_keys=True)
                s = seen.setdefault(key, {'type': a['type'], 'params': a.get('params'), 'passed': 0, 'runs': 0})
                s['runs'] += 1
                s['passed'] += 1 if a.get('passed') else 0
    blocking = [v for v in seen.values() if v['runs'] and not v['passed']]
    out[task] = {'assertions': len(seen), 'blocking': blocking,
                 'blockingForbidden': sum(1 for b in blocking if '_not_' in b['type'] or b['type'].endswith('_not_exists'))}
dest = sys.argv[1] if len(sys.argv) > 1 else None
text = json.dumps({'arms': ARMS, 'tasks': out}, indent=1)
if dest:
    open(dest, 'w').write(text + '\n')
print(f"{len(out)} tasks failed by every arm; {sum(1 for v in out.values() if v['blocking'])} have at least one assertion no arm passed; "
      f"{sum(1 for v in out.values() if v['blockingForbidden'])} of those include a forbidden-effect assertion")
