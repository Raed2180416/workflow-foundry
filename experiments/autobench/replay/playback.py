"""Replay a prefix of a recorded A1-C rollout with the recorded generator values played back, then grade.
usage: python -I playback.py <bridge.py> <input.json> <host-fork-dir> <out.json> <cut1,cut2,...> [diff|probe]
cut = number of calls.jsonl lines (steps) to apply before grading; 'all' = every line. Writes {cut: grade}; a numeric cut
also carries the world at that point ('world'), which replay-gate.mjs serves to re-read.

Developer tool (experiments/autobench/replay/; moved from the 2026-10-21 check-precision study's scratchpad, unchanged
except this docstring). It reads host-side records (calls.jsonl, generated.json) and grades with the official rubric:
no harness module may import it or anything in this directory (test/codeowned-v2.test.mjs, isolation).
Validation in the study: 60/60 dev60 tasks reproduce the live final grade per assertion, with byte-identical tool results."""
import sys, json, asyncio, importlib.util, uuid as U, datetime as D
bridge_path, inp, hostdir, out, cuts = sys.argv[1:6]
spec = importlib.util.spec_from_file_location('bridge_mod', bridge_path)
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
gen = json.load(open(f'{hostdir}/generated.json'))
steps = [json.loads(l) for l in open(f'{hostdir}/calls.jsonl')]
B.SHIM.install('record')
res = {}
for cut in cuts.split(','):
    n = len(steps) if cut == 'all' else int(cut)
    uu = list(gen['uuid']); rr = list(gen['rand']); cc = list(gen['clock'])
    S = B.SHIM
    S.reset(0, None)
    st = {'u': 0, 'r': 0, 'c': 0, 'under': [], 'live': False}
    def uuid4():
        if st['u'] < len(uu) and not st['live']:
            v = U.UUID(hex=uu[st['u']]); st['u'] += 1
        else:
            v = B.REAL_UUID4(); st['under'].append('uuid')
        S.gen['uuid'].append(v.hex); return v
    def clk():
        if st['c'] < len(cc) and not st['live']:
            v = cc[st['c']]; st['c'] += 1; return v
        st['under'].append('clock'); return B.REAL_TIME()
    def now(tz=None):
        ts = clk(); v = D.datetime.fromtimestamp(ts, tz) if tz is not None else D.datetime.fromtimestamp(ts)
        S.gen['clock'].append(ts); return v
    def utcnow():
        ts = clk(); S.gen['clock'].append(ts); return D.datetime.fromtimestamp(ts, D.timezone.utc).replace(tzinfo=None)
    def time_():
        ts = clk(); S.gen['clock'].append(ts); return ts
    def rand(name, *a, **k):
        if st['r'] < len(rr) and name != 'shuffle' and not st['live']:
            v = rr[st['r']]; st['r'] += 1
        else:
            v = B.REAL_RANDOM[name](*a, **k); st['under'].append('rand:' + name)
        S.gen['rand'].append(v); return v
    S.uuid4 = uuid4; S.now = now; S.utcnow = utcnow; S.time = time_; S.rand = rand
    row = B.load_json(inp)
    r = B.Rollout(row, 50, B.load_world(inp.replace('input.json', 'world0.json')), 0)
    asyncio.run(r.setup())
    mism = 0
    for i, s in enumerate(steps[:n]):
        o = asyncio.run(r.batch(s['calls']))
        got = [x['content'] for x in o.get('results', [])]
        if got != s["results"]:
            mism += 1
            if mism <= 2 and len(sys.argv) > 6:
                for a_, b_ in zip(got, s["results"]):
                    if a_ != b_:
                        import difflib; print("STEP", i + 1, [l for l in difflib.unified_diff(b_.split(","), a_.split(","), lineterm="", n=0)][:12], file=sys.stderr)
    used = dict(u=st['u'], c=st['c'], r=st['r'])
    st['live'] = True  # grading draws real values, as in the live run (the generator log was snapshotted before grading)
    if len(sys.argv) > 6 and sys.argv[6] == 'probe':
        from automationbench.rubric.registry import AssertionRegistry
        info = r.state['info']; info = json.loads(info) if isinstance(info, str) else info
        for a_ in info['assertions']:
            try: AssertionRegistry.check(r.state['world'], a_)
            except Exception as e: print('EXC', a_['type'], type(e).__name__, str(e)[:400], file=sys.stderr)
        try:
            from automationbench.schema.world import WorldState
            WorldState(**r.state['initial_state'])
        except Exception as e: print('INIT EXC', type(e).__name__, str(e)[:400], file=sys.stderr)
    g = asyncio.run(r.grade())
    res[cut] = {'n': n, 'mismatchedSteps': mism, 'used': used, 'under': sorted(set(st['under'])), 'partial_credit': g['partial_credit'], 'pass': g['task_completed_correctly'],
                'assertions': [{'type': a['type'], 'params': a.get('params'), 'passed': a['passed']} for a in g['assertion_results'] if not a.get('excluded')], 'error': g['error'],
                'world': r.world() if cut != 'all' else None}
json.dump(res, open(out, 'w'))
print(json.dumps({k: {kk: v[kk] for kk in ('n', 'mismatchedSteps', 'partial_credit', 'pass', 'under', 'used')} for k, v in res.items()}))
