# Compromise register A6 check (2026-10-21, review finding 6). $0, no model. Does Mercury report reasoning tokens inside
# completion_tokens? Reads the raw `usage` objects our own executor (src/executors/openai-chat.mjs) stores in its
# transcripts; prints counts only, no message content.
#   python3 -I research/compromises-20261021/action0/a6.py /var/tmp/foundry-work/autobench/m3-a1c-probe-20261021
# The official AutomationBench harness reads reasoning tokens only from Responses-style output_tokens_details
# (corpus/AutomationBench/automationbench/clients.py:245-251), not from chat-completions completion_tokens_details, so
# its total_reasoning_tokens of 0 on the Mercury run says nothing about whether Mercury reasoned.
import json, sys, pathlib, statistics
def usages(o):
    if isinstance(o, dict):
        if o.get('raw_usage'): yield o['raw_usage']
        for v in o.values(): yield from usages(v)
    elif isinstance(o, list):
        for v in o: yield from usages(v)
rows = []
for f in sorted(pathlib.Path(sys.argv[1]).rglob('.executor-transcript.jsonl')):
    for line in open(f):
        try: r = json.loads(line)
        except ValueError: continue
        for u in usages(r):
            ct = u.get('completion_tokens'); rt = (u.get('completion_tokens_details') or {}).get('reasoning_tokens')
            if isinstance(ct, int) and isinstance(rt, int): rows.append((ct, rt))
print(f'A6: responses with completion_tokens and reasoning_tokens {len(rows)}; completion >= reasoning in '
      f'{sum(c >= r for c, r in rows)}; median reasoning share of completion '
      f'{statistics.median(r / c for c, r in rows if c) if rows else float("nan"):.2f}; '
      f'reasoning tokens min {min((r for _, r in rows), default=0)} max {max((r for _, r in rows), default=0)}')
