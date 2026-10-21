# Compromise register A1 and A2 check (2026-10-21, FIXES.md Action 0). $0, no model; reads the stored transcripts of
# the official Mercury 3 dev60 run. Prints aggregates only.
#   python3 -I research/compromises-20261021/action0/a1a2.py /var/tmp/foundry-work/autobench/m3-official-dev60/results.json
import json, sys, collections
r = json.load(open(sys.argv[1]))
tasks = r['tasks']; s = r['summary']
calls = sum(t['num_model_calls'] for t in tasks)
TI, TC, TO = s['total_input_tokens'], s['total_cached_input_tokens'], s['total_output_tokens']
print(f'A1: responses {calls}; input {TI:,}; cached {TC:,}; mean input per response {TI / calls:,.0f}; cached share {TC / TI:.3f}')
print(f'A6: output share of all tokens {TO / (TI + TO):.4f}; reasoning tokens {s["total_reasoning_tokens"]}')

def key(tc):
    fn = json.loads(tc) if isinstance(tc, str) else tc
    fn = fn.get('function', fn)
    a = fn.get('arguments') or '{}'
    try: a = json.dumps(json.loads(a), sort_keys=True)
    except Exception: pass
    return (fn.get('name'), a)

cap = [t for t in tasks if t['steps'] >= 50]
rep3 = 0; after3 = 0; total = 0; first3s = []
for t in cap:
    seen = collections.Counter(); first3 = None; step = 0
    for m in t['messages']:
        if m.get('role') != 'assistant': continue
        step += 1
        for tc in (m.get('tool_calls') or []):
            k = key(tc); seen[k] += 1
            if seen[k] >= 3 and first3 is None: first3 = step
    total += step
    if first3 is not None:
        rep3 += 1; after3 += step - first3; first3s.append(first3)
first3s.sort()
print(f'A2: step-cap tasks {len(cap)}; with an identical (tool, args) call >= 3 times {rep3}; '
      f'share of their steps after the first 3rd repeat {after3 / total:.3f}; median step of the first 3rd repeat {first3s[len(first3s) // 2]}')
last = collections.Counter((t.get('stop_reasons') or ['none'])[-1] for t in tasks)
print(f'A2: final stop reason per task {dict(last)}; tasks ending with "stop" under the cap '
      f'{sum(1 for t in tasks if t["steps"] < 50 and (t.get("stop_reasons") or [""])[-1] == "stop")}'
      f', at the cap {sum(1 for t in tasks if t["steps"] >= 50 and (t.get("stop_reasons") or [""])[-1] == "stop")}')
# Two fields hold the per-response reason (review finding 5): stop_reasons (one per response) and finish_reasons.
sr = [x for t in tasks for x in (t.get('stop_reasons') or [])]
fr = [x for t in tasks for x in (t.get('finish_reasons') or [])]
gap = collections.Counter(len(t.get('stop_reasons') or []) - len(t.get('finish_reasons') or []) for t in tasks)
print(f'A2: stop_reasons entries {len(sr)} {dict(collections.Counter(sr))}; finish_reasons entries {len(fr)} '
      f'{dict(collections.Counter(fr))}, last per task {dict(collections.Counter((t.get("finish_reasons") or ["none"])[-1] for t in tasks))}; '
      f'stop_reasons minus finish_reasons per task {dict(gap)}')
print(f'A6: reasoning_tokens summed over tasks {sum(t.get("reasoning_tokens") or 0 for t in tasks)}')
