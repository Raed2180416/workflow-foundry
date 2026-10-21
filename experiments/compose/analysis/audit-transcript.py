# usage: python3 audit-transcript.py <transcript.jsonl>  -> JSON: tool uses (Read/Glob/Grep paths, Bash commands), result summary
import json, sys, re
uses = []; result = None
for l in open(sys.argv[1]):
    try: e = json.loads(l)
    except Exception: continue
    if e.get('type') == 'assistant':
        for c in e.get('message', {}).get('content', []):
            if c.get('type') == 'tool_use':
                i = c.get('input', {})
                uses.append({'tool': c.get('name'), 'path': i.get('file_path') or i.get('path') or i.get('pattern'), 'command': (i.get('command') or '')[:300]})
    if e.get('type') == 'result': result = {k: e.get(k) for k in ('subtype', 'is_error', 'num_turns', 'total_cost_usd', 'duration_ms')}
reads = sorted({u['path'] for u in uses if u['tool'] in ('Read', 'Glob', 'Grep') and u['path']})
cmds = [u['command'] for u in uses if u['tool'] == 'Bash']
writes = sorted({u['path'] for u in uses if u['tool'] in ('Write', 'Edit') and u['path']})
suspicious = [x for x in reads + cmds if re.search(r'beds/|oracle|transition|golden|ledger|/home/user|workflow-foundry|research/', x or '')]
print(json.dumps({'toolUses': len(uses), 'reads': reads, 'writes': writes, 'bash': cmds, 'outsideWorkdirOrOracle': suspicious, 'result': result}, indent=1))
