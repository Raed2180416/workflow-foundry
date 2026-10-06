#!/usr/bin/env python3
from __future__ import annotations
import json, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from verification_lib import atomic_json, git_root, load_json, needs_verification, paths_changed_since, receipt_path, snapshot
STATE_DIR = Path.home() / '.local/state/grok-research-gate'

def read_event():
    try: return json.load(sys.stdin)
    except Exception: return {}

def state_file(sid):
    safe=''.join(c for c in sid if c.isalnum() or c in '-_')[:255] or 'unknown'
    return STATE_DIR / f'{safe}.json'

def main():
    mode=sys.argv[1] if len(sys.argv)>1 else ''
    event=read_event()
    sid=str(event.get('sessionId') or os.environ.get('GROK_SESSION_ID') or 'unknown')
    cwd=event.get('cwd') or event.get('workspaceRoot') or os.getcwd()
    root=git_root(cwd)
    if mode=='session-start':
        if root is not None:
            STATE_DIR.mkdir(parents=True, exist_ok=True)
            atomic_json(state_file(sid), {'root':str(root), 'baseline':snapshot(root)})
        return 0
    if mode=='session-end':
        try: state_file(sid).unlink(missing_ok=True)
        except Exception: pass
        return 0
    if mode=='post-edit':
        print(json.dumps({'hookSpecificOutput':{'hookEventName':'PostToolUse','additionalContext':'Repository content changed. Run grok-verify after the final edit; a receipt only counts when its diff fingerprint matches the current state.'}}))
        return 0
    if mode!='stop' or root is None:
        return 0
    state=load_json(state_file(sid))
    if not state or 'baseline' not in state:
        return 0
    current=snapshot(root)
    changed=paths_changed_since(state['baseline'], current)
    if not changed or not needs_verification(changed):
        return 0
    receipt=load_json(receipt_path(root))
    if receipt and receipt.get('fingerprint')==current.get('fingerprint'):
        return 0
    shown=changed[:20]
    more=max(0,len(changed)-len(shown))
    path_text=', '.join(shown)+(f' (+{more} more)' if more else '')
    reason='Completion gate: source/configuration state changed during this session and the current diff has no matching verification receipt. Run grok-verify with meaningful project-specific checks, then finish again. Session-changed paths: '+path_text
    print(json.dumps({'decision':'block','reason':reason}))
    return 0
if __name__=='__main__': raise SystemExit(main())
